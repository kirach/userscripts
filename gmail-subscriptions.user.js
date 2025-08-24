// ==UserScript==
// @name         Gmail: Subscriptions — Purge & Unsubscribe
// @namespace    gmail-subscriptions
// @version      0.1
// @description  On "Manage subscriptions", adds a button to purge all messages for a sender (across pages) and then unsubscribe.
// @match        https://mail.google.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ======== CONFIG ========
  const CONFIG = {
    // Detect “Manage subscriptions” page
    subscriptionsHeading: 'Subscriptions', // visible heading text on the page

    // Button label we inject
    actionLabel: 'Purge + Unsub',

    // Labels/buttons on message list pages
    selectAllBanner: 'Select all conversations that match this search',
    deleteAria: 'Delete',

    // Paginator controls (Gmail list view)
    olderAria: 'Older',
    newerAria: 'Newer',

    // Toolbar container (message list)
    toolbarSelector: "div[gh='mtb']",

    // Confirmations
    confirmStart: (name) =>
      `Purge ALL emails for “${name}” and then unsubscribe?\n\nEmails will move to Trash (recoverable for 30 days).`,

    doneMsg: (name, usedBanner, pages) =>
      `Done with “${name}”.\n• Deletion: ${usedBanner ? 'All in one go via banner' : `Paginated: ${pages} page(s)`}\n• Unsubscribe attempted.`
  };

  // ======== UTILITIES ========
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const waitFor = (selector, { root = document, timeoutMs = 15000 } = {}) =>
    new Promise((resolve, reject) => {
      const found = root.querySelector(selector);
      if (found) return resolve(found);
      const obs = new MutationObserver(() => {
        const el = root.querySelector(selector);
        if (el) { obs.disconnect(); resolve(el); }
      });
      obs.observe(root, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); reject(new Error('Timeout waiting for ' + selector)); }, timeoutMs);
    });

  const queryByText = (selector, text, { root = document } = {}) => {
    text = (text || '').toLowerCase();
    return [...root.querySelectorAll(selector)].find(el =>
      (el.textContent || '').trim().toLowerCase().includes(text)
    ) || null;
  };

  const isSubscriptionsPage = () => {
    console.log(" >>> isSubscriptionsPage")
    const hash = location.hash || ''
    console.log(" >>> hash=", hash)
    if (/#.*subscriptions/i.test(hash)) return true;
    const heading = queryByText('h2, h1, div, span', CONFIG.subscriptionsHeading);
    return !!heading && /subscriptions/i.test(heading.textContent || '');
  };

  // ======== INJECT BUTTONS ON SUBSCRIPTIONS LIST ========
  function injectButtonsOnSubscriptions() {
    if (!isSubscriptionsPage()) return;

    const rows = document.querySelectorAll('a, div[role="link"], div[role="button"]');
    for (const row of rows) {
      if (!row.offsetParent) continue;
      const li = row.closest('[role="listitem"], .subscription, .nH, .aDP, div');
      if (!li) continue;

      const name = (row.textContent || '').trim();
      if (!name) continue;

      if (li.querySelector('.gm-sub-purge-btn')) continue;

      const btn = document.createElement('button');
      btn.className = 'gm-sub-purge-btn';
      btn.textContent = CONFIG.actionLabel;
      Object.assign(btn.style, {
        marginLeft: '8px',
        padding: '4px 8px',
        border: '1px solid #dadce0',
        borderRadius: '6px',
        cursor: 'pointer',
        fontSize: '12px'
      });

      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        try {
          if (!confirm(CONFIG.confirmStart(name))) return;

          const subscriptionsUrl = location.href;
          row.click();

          const { usedBanner, pagesProcessed } = await purgeAllOnCurrentList();

          history.back();
          await sleep(600);
          if (!isSubscriptionsPage()) {
            history.back();
            await sleep(800);
            if (!isSubscriptionsPage()) {
              location.assign(subscriptionsUrl);
              await waitFor(() => isSubscriptionsPage(), { timeoutMs: 8000 }).catch(() => {});
            }
          }

          await tryUnsubscribeOnList(name);
          alert(CONFIG.doneMsg(name, usedBanner, pagesProcessed));
        } catch (e) {
          console.error(e);
          alert('Error: ' + e.message);
        }
      });

      (li || row).appendChild(btn);
    }
  }

  // ======== PURGE ALL ON CURRENT MESSAGE LIST ========
  async function purgeAllOnCurrentList() {
    await waitFor("div[role='main']");
    await waitFor(CONFIG.toolbarSelector);

    const main = document.querySelector("div[role='main']");
    const pageCheckbox = main && main.querySelector("span[role='checkbox'][aria-label]");
    if (!pageCheckbox) throw new Error('Could not find the page checkbox.');
    pageCheckbox.click();
    await sleep(300);

    const bannerLink = queryByText('span', CONFIG.selectAllBanner);
    if (bannerLink && bannerLink.offsetParent) {
      bannerLink.click();
      await sleep(250);
      await clickDelete();
      return { usedBanner: true, pagesProcessed: 1 };
    }

    let pages = 0;
    await clickDelete();
    pages++;

    while (true) {
      const older = findPaginator(CONFIG.olderAria);
      if (!older || older.getAttribute('aria-disabled') === 'true' || (older.getAttribute('aria-disabled') === 'false' && !older.offsetParent)) {
        break;
      }
      older.click();
      await waitFor("div[role='main']");
      await sleep(450);

      const main2 = document.querySelector("div[role='main']");
      const pageCheckbox2 = main2 && main2.querySelector("span[role='checkbox'][aria-label]");
      if (!pageCheckbox2) break;
      pageCheckbox2.click();
      await sleep(200);

      await clickDelete();
      pages++;
    }
    return { usedBanner: false, pagesProcessed: pages };
  }

  async function clickDelete() {
    let delBtn = document.querySelector(`div[aria-label='${CONFIG.deleteAria}'], div[aria-label='${CONFIG.deleteAria} selected conversations']`);
    if (!delBtn) {
      delBtn = [...document.querySelectorAll(`${CONFIG.toolbarSelector} [aria-label], ${CONFIG.toolbarSelector} [data-tooltip]`)]
        .find(el => /delete/i.test(el.getAttribute('aria-label') || el.getAttribute('data-tooltip') || ''));
    }
    if (!delBtn) throw new Error('Delete button not found.');
    delBtn.click();
    await sleep(800);
  }

  function findPaginator(ariaLabelText) {
    const toolbar = document.querySelector(CONFIG.toolbarSelector);
    if (!toolbar) return null;
    const byAria = [...toolbar.querySelectorAll('[aria-label]')].find(el => {
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      return aria.includes(ariaLabelText.toLowerCase());
    });
    if (byAria) return byAria;

    const byTooltip = [...toolbar.querySelectorAll('[data-tooltip]')].find(el => {
      const tip = (el.getAttribute('data-tooltip') || '').toLowerCase();
      return tip.includes(ariaLabelText.toLowerCase());
    });
    return byTooltip || null;
  }

  async function tryUnsubscribeOnList(name) {
    for (let i = 0; i < 20; i++) {
      if (isSubscriptionsPage()) break;
      await sleep(300);
    }
    if (!isSubscriptionsPage()) return false;

    const candidates = [...document.querySelectorAll('[role="listitem"], a, div')]
      .filter(el => el.offsetParent && (el.textContent || '').toLowerCase().includes((name || '').toLowerCase()));
    if (!candidates.length) return false;

    for (const el of candidates) {
      const container = el.closest('[role="listitem"]') || el;
      const unsub = [...container.querySelectorAll('button, a, div, span')]
        .find(n => {
          if (!n.offsetParent) return false;
          const t = (n.textContent || '').toLowerCase();
          const aria = (n.getAttribute('aria-label') || '').toLowerCase();
          return /unsubscribe/.test(t) || /unsubscribe/.test(aria);
        });
      if (unsub) { unsub.click(); return true; }
    }
    return false;
  }

  function observeSubscriptions() {
    const obs = new MutationObserver(() => {
      if (isSubscriptionsPage()) injectButtonsOnSubscriptions();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }

  observeSubscriptions();
  injectButtonsOnSubscriptions();
})();
