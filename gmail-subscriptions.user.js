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

    // Wire up click (placeholder for your full flow)
    ourBtn.addEventListener('click', async (ev) => {
      ev.stopPropagation()
      ev.preventDefault()
      // TODO: implement your purge flow here
      alert('Purge flow not implemented yet for this sender.')
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
})()
