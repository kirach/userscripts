// ==UserScript==
// @name         Gmail: Subscriptions — Purge & Unsubscribe
// @namespace    gmail-subscriptions
// @version      0.1
// @description  On "Manage subscriptions", adds a button to purge all messages for a sender (across pages) and then unsubscribe.
// @match        https://mail.google.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

;(function () {
  'use strict'

  // --- config / debug toggles -------------------------------------------------
  const CONFIG = {
    DEBUG: false, // set true to see logs
  }
  const log = (...a) => CONFIG.DEBUG && console.log('[subs]', ...a)

  // --- basic predicates -------------------------------------------------------
  const isSubs = () => (location.hash || '').startsWith('#sub')
  const isVisible = (el) => !!el && el.offsetParent !== null

  // --- styles (injected once) -------------------------------------------------
  function injectStylesOnce() {
    if (document.getElementById('gm-sub-btn-styles')) return
    const css = `
      .gm-sub-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 0 10px;                 /* height set via JS to match native */
        border: 1px solid #dadce0;
        border-radius: 16px;             /* adjusted via JS to height/2 */
        background: #fff;
        color: #1f1f1f;
        font: 500 12px/1 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        cursor: pointer;
        user-select: none;
        vertical-align: middle;
        transition: background-color .12s ease, box-shadow .12s ease, border-color .12s ease, color .12s ease;
      }
      .gm-sub-btn:hover { background: rgba(60,64,67,0.08); }
      .gm-sub-btn:active { background: rgba(60,64,67,0.16); }
      .gm-sub-btn:focus-visible {
        outline: none;
        box-shadow: 0 0 0 3px rgba(26,115,232,0.3);
        border-color: #1a73e8;
      }
      .gm-sub-btn[disabled] { opacity: .55; cursor: default; }
      .gm-sub-btn .gm-sub-icon { font-size: 14px; line-height: 1; }

      /* Compact variant when native unsub is icon-only */
      .gm-sub-btn.gm-compact {
        padding: 0 8px;
        font-size: 11px;
      }

      @media (prefers-color-scheme: dark) {
        .gm-sub-btn { background: #2a2a2a; color: #e8eaed; border-color: #3c4043; }
        .gm-sub-btn:hover { background: rgba(232,234,237,0.08); }
        .gm-sub-btn:active { background: rgba(232,234,237,0.16); }
      }
    `
    const style = document.createElement('style')
    style.id = 'gm-sub-btn-styles'
    style.textContent = css
    document.head.appendChild(style)
  }

  // --- native "Unsubscribe" finders ------------------------------------------
  function findUnsubscribeButton(root) {
    if (!root) return null

    // Prefer a visible text button "Unsubscribe"
    const textBtn = [...root.querySelectorAll('button,[role="button"]')].find(
      (el) => isVisible(el) && /^unsubscribe\b/i.test((el.textContent || '').trim())
    )
    if (textBtn) return textBtn

    // Fallback: visible icon-only button with aria-label "Unsubscribe"
    const ariaBtn = [...root.querySelectorAll('button[aria-label],[role="button"][aria-label]')].find(
      (el) => isVisible(el) && /unsubscribe/i.test(el.getAttribute('aria-label') || '')
    )
    return ariaBtn || null
  }

  function findUnsubscribeCell(row) {
    // Rows are <tr role="row"> with <td role="gridcell">; look for a cell that contains Unsubscribe
    const cells = row.querySelectorAll('td[role="gridcell"], [role="gridcell"]')
    for (const cell of cells) {
      const btn = findUnsubscribeButton(cell)
      if (btn) return { cell, btn }
    }
    // Fallback: search entire row
    const btn = findUnsubscribeButton(row)
    return btn ? { cell: btn.closest('td,[role="gridcell"]') || row, btn } : null
  }

  // --- our button + sizing synced to native anchor ---------------------------
  function makeBtn() {
    const btn = document.createElement('button')
    btn.className = 'gm-sub-btn'
    const icon = document.createElement('span')
    icon.className = 'gm-sub-icon'
    icon.textContent = '🧹' // change to 🗑️/✉️ if you prefer
    const label = document.createElement('span')
    label.textContent = 'Purge + Unsub'
    btn.append(icon, label)
    return btn
  }

  // Anchor (native unsub button) -> { buttons: Set<HTMLButtonElement>, ro: ResizeObserver, lastHeight: number }
  const anchorRegistry = new WeakMap()

  function attachAnchorObserver(anchor) {
    if (anchorRegistry.has(anchor)) return anchorRegistry.get(anchor)

    const entry = { buttons: new Set(), ro: null, lastHeight: 0 }
    const ro = new ResizeObserver(() => syncForAnchor(anchor))
    ro.observe(anchor)
    entry.ro = ro

    anchorRegistry.set(anchor, entry)
    return entry
  }

  function syncForAnchor(anchor) {
    const entry = anchorRegistry.get(anchor)
    if (!entry) return

    const cs = getComputedStyle(anchor)
    const h = parseFloat(cs.height) || Math.round(anchor.getBoundingClientRect().height) || 28

    if (Math.abs(h - entry.lastHeight) < 0.5) return // no-op if unchanged
    entry.lastHeight = h

    const hasText = (anchor.textContent || '').trim().length > 0

    for (const btn of entry.buttons) {
      btn.style.height = `${h}px`
      btn.style.lineHeight = `${h}px`
      btn.style.borderRadius = `${Math.max(12, Math.round(h / 2))}px`
      btn.classList.toggle('gm-compact', !hasText)
    }
  }

  // --- enhance a single row exactly once ------------------------------------
  function enhanceRow(row) {
    if (!row || row.dataset.gmInjected === '1') return

    const ourBtn = makeBtn()

    ourBtn.addEventListener('click', async (ev) => {
      ev.stopPropagation()
      ev.preventDefault()
      try {
        ourBtn.disabled = true
        ourBtn.textContent = 'Working…'
        await runPurgeFlowForRow(row)
        ourBtn.textContent = 'Done ✓'
      } catch (e) {
        console.error('[subs] test-flow error:', e)
        alert('Error: ' + (e?.message || e))
        ourBtn.textContent = 'Purge + Unsub'
      } finally {
        ourBtn.disabled = false
      }
    })

    // Try to place right after the native Unsubscribe control
    const unsub = findUnsubscribeCell(row)
    if (unsub && unsub.btn && unsub.btn.insertAdjacentElement) {
      unsub.btn.insertAdjacentElement('afterend', ourBtn)

      // Register our button with the anchor and sync size now
      const entry = attachAnchorObserver(unsub.btn)
      entry.buttons.add(ourBtn)
      syncForAnchor(unsub.btn)
    } else {
      // Fallback: append at end of row
      row.appendChild(ourBtn)
    }

    row.dataset.gmInjected = '1'
  }

  // --- scan/enhance all current rows ----------------------------------------
  function enhanceAllRows() {
    const main = document.querySelector('div[role="main"]')
    if (!main) return

    const rows = main.querySelectorAll('[role="row"]')
    let injected = 0
    rows.forEach((r) => {
      const before = r.dataset.gmInjected === '1'
      enhanceRow(r)
      if (!before && r.dataset.gmInjected === '1') injected++
    })
    if (injected) log('enhanced rows:', injected)
  }

  // --- observe main area only while on #sub ----------------------------------
  let mainObserver = null

  function startObserver() {
    if (mainObserver) return
    injectStylesOnce()

    const main = document.querySelector('div[role="main"]')
    if (!main) {
      // main not ready yet; try shortly after
      setTimeout(() => {
        if (isSubs()) startObserver()
      }, 200)
      return
    }

    // Initial pass
    enhanceAllRows()

    // Observe async renders under main
    mainObserver = new MutationObserver(() => {
      // small debounce
      if (startObserver._t) clearTimeout(startObserver._t)
      startObserver._t = setTimeout(enhanceAllRows, 80)
    })
    mainObserver.observe(main, { childList: true, subtree: true })

    log('observer started')
  }

  function stopObserver() {
    if (mainObserver) {
      mainObserver.disconnect()
      mainObserver = null
      log('observer stopped')
    }
    // Anchor observers are attached to DOM nodes inside Gmail; when Gmail tears
    // down that subtree on navigation, they’ll GC with it. Explicit teardown
    // usually isn’t needed here.
  }

  // --- boot: run only on subscriptions view ----------------------------------
  if (isSubs()) startObserver()

  window.addEventListener('hashchange', () => {
    if (isSubs()) {
      startObserver()
    } else {
      stopObserver()
    }
  })

  /*
   * --- purge flow for a subscription -----------------------------------------
   */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const q = (sel, root = document) => root.querySelector(sel)
  const qq = (sel, root = document) => Array.from(root.querySelectorAll(sel))
  const textOf = (el) => (el?.textContent || '').trim()

  function waitFor(selector, { root = document, timeout = 15000 } = {}) {
    return new Promise((resolve, reject) => {
      const found = root.querySelector(selector)
      if (found) return resolve(found)
      const obs = new MutationObserver(() => {
        const el = root.querySelector(selector)
        if (el) {
          obs.disconnect()
          resolve(el)
        }
      })
      obs.observe(root, { childList: true, subtree: true })
      setTimeout(() => {
        obs.disconnect()
        reject(new Error('Timeout: ' + selector))
      }, timeout)
    })
  }

  // Toolbar buttons by aria-label or tooltip
  function findToolbarButton(regex) {
    const tb = q('div[gh="mtb"]') || document
    const candidates = qq('[aria-label],[data-tooltip]', tb)
    return candidates.find((el) => regex.test(el.getAttribute('aria-label') || el.getAttribute('data-tooltip') || ''))
  }

  // “Select page” checkbox
  function findPageCheckbox() {
    const main = q('div[role="main"]')
    if (!main) return null
    const cands = qq('[role="checkbox"]', main).filter((el) => el.offsetParent !== null)
    // Prefer ones that say “Select”
    return cands.find((el) => /select/i.test(el.getAttribute('aria-label') || '')) || cands[0] || null
  }

  // Banner: “Select all conversations that match this search”
  function findSelectAllBannerLink() {
    const main = q('div[role="main"]') || document
    const link = qq('a, span', main).find((el) => /select all conversations that match this search/i.test(textOf(el)))
    return link && link.offsetParent ? link : null
  }

  // Older pagination
  function clickOlderIfPossible() {
    const older = findToolbarButton(/older/i)
    if (!older || older.getAttribute('aria-disabled') === 'true') return false
    older.click()
    return true
  }

  // Get row email and open search
  function getRowEmail(row) {
    const attr = row.getAttribute('data-row-id')
    if (attr) return attr.trim()
    const dataEmail = row.querySelector('[data-email]')?.getAttribute('data-email')
    if (dataEmail) return dataEmail.trim()
    const m = textOf(row).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
    return m ? m[0] : null
  }

  function openSenderSearchFromRow(row) {
    const link = row.querySelector('a[href*="#search/"]')
    if (link) {
      link.click()
      return true
    }
    const email = getRowEmail(row)
    if (!email) return false
    const m = location.pathname.match(/\/mail\/u\/(\d+)\//)
    const u = m ? m[1] : '0'
    location.href = `https://mail.google.com/mail/u/${u}/#search/from:${encodeURIComponent(email)}`
    return true
  }

  // Back to subscriptions
  async function goBackToSubscriptions(maxSteps = 4) {
    for (let i = 0; i < maxSteps; i++) {
      if ((location.hash || '').startsWith('#sub')) return true
      history.back()
      await sleep(600)
    }
    return (location.hash || '').startsWith('#sub')
  }

  // Click native Unsubscribe on the row by email (no confirm)
  async function clickUnsubscribeOnEmail(email) {
    const main = q('div[role="main"]')
    if (!main) return false

    const row = main.querySelector(`[role="row"][data-row-id="${CSS.escape(email)}"]`)
    if (!row) return false

    // Reuse your existing finder (we assume findUnsubscribeButton/findUnsubscribeCell exist)
    const cells = row.querySelectorAll('td[role="gridcell"], [role="gridcell"]')
    for (const cell of cells) {
      const btn =
        [...cell.querySelectorAll('button,[role="button"]')].find(
          (el) => el.offsetParent !== null && /^unsubscribe\b/i.test(textOf(el))
        ) ||
        [...cell.querySelectorAll('button[aria-label],[role="button"][aria-label]')].find(
          (el) => el.offsetParent !== null && /unsubscribe/i.test(el.getAttribute('aria-label') || '')
        )
      if (btn) {
        btn.click()
        await sleep(400)
        return true
      }
    }
    return false
  }

  // Put this near the top of your helpers
  const STEP_DELAY = 3000 // milliseconds, adjust as needed

  // Try to click like a human: pointer + mouse sequence at the element's center
  async function humanClick(el) {
    console.log('[subs] humanClick', el)

    if (!el) return false
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
    el.focus?.()

    const r = el.getBoundingClientRect()
    const x = Math.floor(r.left + r.width / 2)
    const y = Math.floor(r.top + r.height / 2)

    const base = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: 1,
      composed: true,
    }

    // Pointer events first (Gmail often listens to pointerdown/up)
    el.dispatchEvent(new PointerEvent('pointerover', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }))
    el.dispatchEvent(new MouseEvent('mouseover', base))
    el.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }))
    el.dispatchEvent(new MouseEvent('mousedown', base))
    el.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }))
    el.dispatchEvent(new MouseEvent('mouseup', base))
    el.dispatchEvent(new MouseEvent('click', base))
    await sleep(STEP_DELAY)
    return true
  }

  // Use the exact toolbar markup you shared
  async function clickDelete() {
    // Prefer the explicit aria/tooltip Delete in the toolbar
    const tb = q('div[gh="mtb"]') || document
    let delBtn = tb.querySelector('[role="button"][aria-label="Delete"], [role="button"][data-tooltip="Delete"]')

    if (!delBtn) {
      // Fallback: scan visible role=button candidates for Delete text/tooltip (just in case)
      delBtn = qq('[role="button"][aria-label], [role="button"][data-tooltip]', tb)
        .filter((el) => el.offsetParent !== null)
        .find((el) => /delete/i.test(el.getAttribute('aria-label') || el.getAttribute('data-tooltip') || ''))
    }
    if (!delBtn) {
      console.warn('[subs] Delete button not found.')
      return false
    }
    if (delBtn.getAttribute('aria-disabled') === 'true') {
      console.warn('[subs] Delete button is disabled.')
      return false
    }

    // 1) native click on the container
    delBtn.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
    delBtn.focus?.()
    delBtn.click()
    await sleep(STEP_DELAY)

    // If that didn’t trigger, try the inner hit target (the <div class="Bn">Delete</div> you showed)
    const inner = delBtn.querySelector('.Bn')
    if (inner) {
      inner.click()
      await sleep(STEP_DELAY)
    }

    // 3) Fallback: simulate full pointer/mouse sequence
    await humanClick(delBtn)
    return true
  }

  async function runPurgeFlowForRow(row) {
    const senderEmail = getRowEmail(row)
    if (!openSenderSearchFromRow(row)) {
      throw new Error('Could not open sender search for this row')
    }

    // Wait for list view
    await waitFor('div[role="main"]')
    await waitFor('div[gh="mtb"]')
    await sleep(STEP_DELAY)

    // Select all on current page
    const pageCb = findPageCheckbox()
    if (pageCb) {
      pageCb.click()
      console.log('[subs] clicked page checkbox')
      await sleep(STEP_DELAY)
    }

    // If banner appears, select all conversations
    const banner = findSelectAllBannerLink()
    if (banner) {
      banner.click()
      console.log('[subs] clicked select-all banner')
      await sleep(STEP_DELAY)

      // Delete all at once
      const ok = await clickDelete()
      if (!ok) throw new Error('Delete button not found')

      console.log('[subs] clicked delete for all conversations')
      await sleep(STEP_DELAY)
    } else {
      // Otherwise, page through and delete per page
      let page = 1
      let keepGoing = true

      while (keepGoing) {
        const ok = await clickDelete()
        if (!ok) throw new Error('Delete button not found')

        console.log(`[subs] clicked delete on page ${page}`)
        await sleep(STEP_DELAY)

        // Try Older
        keepGoing = clickOlderIfPossible()
        if (!keepGoing) break
        page++
        console.log(`[subs] moved to page ${page}`)
        await waitFor('div[gh="mtb"]')
        await sleep(STEP_DELAY)

        // Select all on this page
        const cb = findPageCheckbox()
        if (cb) {
          cb.click()
          console.log(`[subs] clicked page checkbox on page ${page}`)
          await sleep(STEP_DELAY)
        }
      }
    }

    // Go back to subscriptions
    await goBackToSubscriptions(4)
    console.log('[subs] navigated back to subscriptions')
    await waitFor('div[role="main"]')
    await sleep(STEP_DELAY)

    // Click native Unsubscribe for that sender (no confirm)
    if (senderEmail) {
      await clickUnsubscribeOnEmail(senderEmail)
      console.log('[subs] clicked unsubscribe button')
      await sleep(STEP_DELAY)
    }
  }
})()
