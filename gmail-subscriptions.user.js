// ==UserScript==
// @name         Gmail: Subscriptions — Purge & Unsubscribe (observer)
// @namespace    gmail-subscriptions
// @version      0.1
// @description  Add a button per subscription on the Manage Subscriptions page.
// @match        https://mail.google.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

;(function () {
  'use strict'

  const log = (...a) => console.log('[subs]', ...a)
  const isSubs = () => (location.hash || '').startsWith('#sub')
  const isVisible = (el) => !!el && el.offsetParent !== null

  function injectStylesOnce() {
    if (document.getElementById('gm-sub-btn-styles')) return
    const css = `
      .gm-sub-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 28px;
        padding: 0 10px;
        border: 1px solid #dadce0;
        border-radius: 16px;
        background: #fff;
        color: #1f1f1f;
        font: 500 12px/28px system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        cursor: pointer;
        user-select: none;
        vertical-align: middle;
        transition: background-color .12s ease, box-shadow .12s ease, border-color .12s ease, color .12s ease;
      }
      .gm-sub-btn:hover {
        background: rgba(60,64,67,0.08);
      }
      .gm-sub-btn:active {
        background: rgba(60,64,67,0.16);
      }
      .gm-sub-btn:focus-visible {
        outline: none;
        box-shadow: 0 0 0 3px rgba(26,115,232,0.3);
        border-color: #1a73e8;
      }
      .gm-sub-btn[disabled] {
        opacity: .55;
        cursor: default;
      }
      .gm-sub-btn .gm-sub-icon {
        font-size: 14px;
        line-height: 1;
      }

      /* Dark mode tweak */
      @media (prefers-color-scheme: dark) {
        .gm-sub-btn {
          background: #2a2a2a;
          color: #e8eaed;
          border-color: #3c4043;
        }
        .gm-sub-btn:hover { background: rgba(232,234,237,0.08); }
        .gm-sub-btn:active { background: rgba(232,234,237,0.16); }
      }
    `
    const style = document.createElement('style')
    style.id = 'gm-sub-btn-styles'
    style.textContent = css
    document.head.appendChild(style)
  }

  function findUnsubscribeButton(row) {
    if (!row) return null

    // Prefer a visible button with visible text "Unsubscribe"
    const textBtn = [...row.querySelectorAll('button,[role="button"]')].find((el) => {
      if (!isVisible(el)) return false
      const t = (el.textContent || '').trim().toLowerCase()
      return t === 'unsubscribe' || t.startsWith('unsubscribe ')
    })
    if (textBtn) return textBtn

    // Fallback: a visible button with aria-label "Unsubscribe"
    const ariaBtn = [...row.querySelectorAll('button[aria-label],[role="button"][aria-label]')].find(
      (el) => isVisible(el) && /unsubscribe/i.test(el.getAttribute('aria-label') || '')
    )
    if (ariaBtn) return ariaBtn

    return null
  }

  function findUnsubscribeCell(row) {
    // The cell in your snippet is: <td role="gridcell"> ... (buttons) ... </td>
    // Find a gridcell that contains an Unsubscribe button
    const cells = row.querySelectorAll('td[role="gridcell"], [role="gridcell"]')
    for (const cell of cells) {
      const btn = findUnsubscribeButton(cell)
      if (btn) return { cell, btn }
    }
    // Fallback: search whole row
    const btn = findUnsubscribeButton(row)
    return btn ? { cell: btn.closest('td,[role="gridcell"]') || row, btn } : null
  }

  // Create the small action button
  function makeBtn() {
    const btn = document.createElement('button')
    btn.className = 'gm-sub-btn'
    // Optional: small emoji icon that fits Gmail vibe
    const icon = document.createElement('span')
    icon.className = 'gm-sub-icon'
    icon.textContent = '🧹' // or '🗑️' / '✉️'
    const label = document.createElement('span')
    label.textContent = 'Purge + Unsub'
    btn.append(icon, label)
    return btn
  }

  // Enhance a single row exactly once
  function enhanceRow(row) {
    if (!row || row.dataset.gmInjected === '1') return

    const btn = makeBtn()
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation()
      ev.preventDefault()
      log('clicked purge for:', (row.textContent || '').trim().slice(0, 120))
      // TODO: open sender search -> purge -> back -> unsubscribe
    })

    const unsub = findUnsubscribeCell(row)
    if (unsub) {
      // Place right after the native Unsubscribe button
      unsub.btn.insertAdjacentElement('afterend', btn)
    } else {
      // Fallback: append to the row end if the structure changes
      row.appendChild(btn)
    }

    row.dataset.gmInjected = '1'
  }

  // Scan current rows and enhance
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

  // Observer management
  let observer = null

  function startObserver() {
    if (observer) return
    const main = document.querySelector('div[role="main"]')
    if (!main) {
      // main not ready yet; try once shortly after
      setTimeout(startObserver, 200)
      return
    }
    observer = new MutationObserver(() => {
      // minimal debounce to batch bursts
      if (startObserver._t) clearTimeout(startObserver._t)
      startObserver._t = setTimeout(enhanceAllRows, 80)
    })
    observer.observe(main, { childList: true, subtree: true })
    enhanceAllRows() // initial pass
    log('observer started')
  }

  function stopObserver() {
    if (!observer) return
    observer.disconnect()
    observer = null
    log('observer stopped')
  }

  // Initial load
  if (isSubs()) startObserver()

  injectStylesOnce()

  // React to SPA navigation
  window.addEventListener('hashchange', () => {
    if (isSubs()) {
      startObserver()
    } else {
      stopObserver()
    }
  })
})()
