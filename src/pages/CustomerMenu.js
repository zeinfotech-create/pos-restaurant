// ============================================================
// CustomerMenu.js — the self-order QR menu a customer scans at their table.
// Reached anonymously (no login — see router.js's non-Electron allowlist +
// db.js's hasPermission() public-page exemption), over LAN via
// http://<shop-pc-lan-ip>:3030/#customer-menu/<tableId> (or the short alias
// #menu/<tableId>) — same LAN entry point Kitchen Display's #kd already
// established, server/index.js's static-file serving (v9y) makes it work
// with zero extra server wiring.
//
// Deliberately does NOT touch store.cart or write anything into a table's
// live order directly — a customer's own device has no business writing
// straight into staff's order state (a race with staff editing
// simultaneously, or a mistaken/spam submission, could corrupt a real
// order), and sending a request does NOT deduct stock or change anything
// else in the main app either — it only creates a MenuRequest, visible to
// staff as a badge/notification, that they must explicitly Accept before
// it becomes a real cart line (RestaurantPOS.js's openMenuRequestsModal())
// — same trust boundary as every other customer-facing input in this app.
// ============================================================

import { getProducts, getCategories, getTables, saveMenuRequest, getSettings, getMenuRequests, getKots } from '../db.js';
import { isProductAvailable } from './RestaurantPOS.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { foodTypeIconHtml } from '../utils/foodType.js';
import { showToast } from '../components/Toast.js';
import { tableDisplayNameWithSection } from '../utils/tableDisplay.js';

let localCart = []; // [{productId, name, price, qty}] — this page's OWN cart, never store.cart
let activeCategory = '';
let viewMode = 'menu'; // 'menu' | 'cart' | 'submitted' — cart is a review step before Send Request actually fires
let trackedRequestId = null; // the MenuRequest id being shown as the CURRENT order on the 'submitted' tracking screen
let sessionRequestIds = []; // every request id this device has sent for the current table — newest last
let trackListenerRegistered = false; // registerTrackingLiveRefresh() guard — only ever attach the listeners once

// This device's own order history for one table, persisted in localStorage
// (scoped per-origin+device already — never visible to another customer's
// phone or to staff) so it survives a page reload or the customer re-opening
// the same QR link later in their visit, not just staying alive across
// "Send Another Order" clicks within one tab session. Wrapped in try/catch —
// a private-browsing tab or blocked site data must never break ordering
// itself, just silently lose the "remembered on this device" convenience.
function historyStorageKey(tableId) { return `cm_order_history_${tableId}`; }
function loadSessionRequestIds(tableId) {
  try {
    const raw = localStorage.getItem(historyStorageKey(tableId));
    const ids = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids : [];
  } catch { return []; }
}
function saveSessionRequestIds(tableId, ids) {
  try { localStorage.setItem(historyStorageKey(tableId), JSON.stringify(ids)); } catch { /* ignore */ }
}

// Order-tracking stages shown on the 'submitted' screen once a request has
// been sent — 'sent' is reached the instant Send fires; everything after it
// depends on what staff actually do with the request (see computeStage()).
const ORDER_STAGES = [
  { key: 'sent', icon: '📨', label: 'Order Sent', desc: 'Your order reached the counter' },
  { key: 'accepted', icon: '👍', label: 'Accepted', desc: 'Counter staff confirmed your order' },
  { key: 'preparing', icon: '👨‍🍳', label: 'Preparing', desc: 'The kitchen is cooking your order' },
  { key: 'ready', icon: '🍽️', label: 'Ready to Serve', desc: 'Your order is ready and on its way' },
  { key: 'served', icon: '🎉', label: 'Served', desc: 'Enjoy your meal!' },
];

// Looks up every KOT item any of this table's tickets carries that was
// tagged with `requestId` (RestaurantPOS.js stamps this on Accept, then
// carries it forward onto the real kitchen ticket item in sendToKitchen())
// — this is what lets a customer's own device see PAST "accepted" into the
// real kitchen prep/ready/served lifecycle, not just the request's own
// pending/accepted/dismissed status.
async function findKitchenItemsForRequest(requestId, tableId) {
  const kots = await getKots();
  const matched = [];
  kots.filter(k => k.tableId === tableId).forEach(k => {
    (k.items || []).forEach(it => {
      if ((it.sourceRequestIds || []).includes(requestId)) matched.push(it);
    });
  });
  return matched;
}

// Single source of truth for "what stage is this request at right now" —
// a request's own status (pending/accepted/dismissed) covers the first
// step; once accepted, the matched kitchen ticket items' itemStatus
// (pending/ready/served) carries the rest of the journey.
function computeStage(request, kitchenItems) {
  if (!request || request.status === 'pending') return 'sent';
  if (request.status === 'dismissed') return 'dismissed';
  if (kitchenItems.length === 0) return 'accepted'; // accepted, not yet fired to the kitchen
  if (kitchenItems.every(it => it.itemStatus === 'served')) return 'served';
  if (kitchenItems.every(it => it.itemStatus === 'ready' || it.itemStatus === 'served')) return 'ready';
  return 'preparing';
}

// One listener pair for the whole page's lifetime — re-renders the tracking
// screen live as staff accept/dismiss the request or the kitchen updates its
// items, the same 'storage-change'/'data-synced' pairing every other
// live-refresh spot in this codebase uses (a LOCAL write on this exact
// device fires the former, an incoming LAN sync fires the latter — a
// customer's phone only ever sees the latter, since it never writes
// menu_requests/kots itself once past Send).
function registerTrackingLiveRefresh(container, tableId) {
  if (trackListenerRegistered) return;
  const onChange = (e) => {
    if (!['menu_requests', 'kots'].includes(e.detail?.store)) return;
    if (viewMode !== 'submitted' || !trackedRequestId) return;
    renderContent(container, tableId);
  };
  window.addEventListener('storage-change', onChange);
  window.addEventListener('data-synced', onChange);
  trackListenerRegistered = true;
}

// Shared +/- quantity stepper look — a filled pill with solid circular
// buttons (the same visual language food-delivery apps use), replacing the
// original plain bordered-square buttons. One shared block so the grid's
// small in-card stepper and the cart-review screen's bigger one can't drift
// apart. Appended once per screen that uses it (menu grid + cart review).
const STEPPER_STYLES = `
  <style>
    .cm-stepper { display:inline-flex; align-items:center; justify-content:center; border-radius:999px; background:var(--bg-elevated); border:1.5px solid var(--primary); box-shadow:0 2px 6px rgba(0,0,0,.10); }
    .cm-step-btn { display:flex; align-items:center; justify-content:center; border:none; border-radius:999px; cursor:pointer; flex-shrink:0; background:var(--primary); color:#fff; transition:transform .12s ease; }
    .cm-step-btn:active { transform:scale(0.8); }
    .cm-step-qty { text-align:center; font-weight:800; color:var(--primary); }
    .cm-stepper-sm { padding:3px; gap:2px; }
    .cm-stepper-sm .cm-step-btn { width:23px; height:23px; font-size:9.5px; }
    .cm-stepper-sm .cm-step-qty { min-width:20px; font-size:12px; }
    .cm-stepper-lg { padding:3px; gap:4px; }
    .cm-stepper-lg .cm-step-btn { width:30px; height:30px; font-size:11px; }
    .cm-stepper-lg .cm-step-qty { min-width:26px; font-size:14px; }
  </style>
`;

export async function renderCustomerMenu(container, subPage) {
  const tableId = subPage || '';
  // Settings > KOT > "Self-Order QR Menu" — checked BEFORE anything else,
  // so turning it off makes every table's QR link (even an old printed
  // one, or a customer's already-bookmarked page) stop working immediately
  // — this is the actual page a scanned QR loads, not just the button that
  // shows it, so a client-side gate here is the real enforcement point.
  const settings = await getSettings();
  if (settings.enableSelfOrderMenu === false) {
    container.innerHTML = scrollShell(`
      <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:24px; text-align:center;">
        <div style="font-size:44px; margin-bottom:16px; opacity:.4;">🚫</div>
        <div style="font-size:17px; font-weight:800; margin-bottom:8px;">Ordering here isn't available right now</div>
        <div style="font-size:13px; color:var(--text-muted); max-width:320px;">Please ask a staff member to take your order.</div>
      </div>
    `);
    return;
  }
  localCart = [];
  // A returning visit (page reload, or the customer re-opening the same QR
  // link later) should land straight on "where's my order" rather than
  // making them re-find the menu — this device's own remembered history for
  // THIS table (see loadSessionRequestIds()) decides that; a genuinely first
  // visit (nothing remembered) still goes straight to the menu as before.
  sessionRequestIds = loadSessionRequestIds(tableId);
  if (sessionRequestIds.length > 0) {
    trackedRequestId = sessionRequestIds[sessionRequestIds.length - 1];
    viewMode = 'submitted';
  } else {
    trackedRequestId = null;
    viewMode = 'menu';
  }
  registerTrackingLiveRefresh(container, tableId);
  await renderContent(container, tableId);
}

// Every screen in this page shares the SAME standalone-page scroll fix
// (style.css locks #page-container to overflow:hidden — see the long
// comment on the menu screen below) — wraps whatever's passed in.
function scrollShell(innerHtml, extra = '') {
  return `<div style="height:100vh; height:100dvh; overflow-y:auto; box-sizing:border-box; display:flex; flex-direction:column; background:var(--bg-app); ${extra}">${innerHtml}</div>`;
}

async function renderContent(container, tableId) {
  const [allProducts, rawCategories, tables] = await Promise.all([getProducts(), getCategories(), getTables()]);
  const table = tables.find(t => t.id === tableId);
  // De-duped by name for display only, same reasoning/fix as
  // RestaurantPOS.js's own category chips — a device that spent any time on
  // the placeholder 'LOCAL_EXE' tenant before this page's licenseKey
  // pre-adoption (main.js) can carry genuinely duplicated category records.
  const seenCategoryNames = new Set();
  const categories = rawCategories.filter(c => {
    const key = (c.name || '').trim().toLowerCase();
    if (!key || seenCategoryNames.has(key)) return false;
    seenCategoryNames.add(key);
    return true;
  });
  const products = allProducts.filter(p => {
    if (activeCategory && p.category !== activeCategory) return false;
    return isProductAvailable(p, allProducts);
  });
  const cartCount = localCart.reduce((s, i) => s + i.qty, 0);
  const cartTotal = localCart.reduce((s, i) => s + i.price * i.qty, 0);

  // Section/Area-aware label (e.g. "AC Hall · Table 3") — this shop has
  // multiple sections whose tables reuse the same plain numbers/names (AC
  // Hall's "1", Ground Floor's "1", ...), so the bare name alone is
  // ambiguous both to the customer confirming they scanned the right table
  // and to staff reviewing a request. Skips the prefix entirely for an
  // unsectioned/"Main" table — same helper RestaurantPOS.js's own header
  // already uses, so this can't drift from how staff see the same table.
  const tableLabel = table ? tableDisplayNameWithSection(table, tables) : 'Menu';

  if (viewMode === 'submitted') {
    const allRequests = await getMenuRequests();
    const request = allRequests.find(r => r.id === trackedRequestId) || null;
    const kitchenItems = request ? await findKitchenItemsForRequest(request.id, tableId) : [];
    const stage = computeStage(request, kitchenItems);

    // Per-request price total — shared by the big current-order summary and
    // every row of the history list below it.
    const reqTotal = (r) => (r.items || []).reduce((s, i) => s + i.price * i.qty, 0);
    const statusLabel = (s) => s === 'dismissed' ? 'Not Accepted' : (ORDER_STAGES.find(o => o.key === s)?.label || s);
    const statusColor = (s) => s === 'dismissed' ? 'var(--danger)' : (s === 'served' ? 'var(--success)' : 'var(--text-muted)');
    // A compact horizontal version of the same 5-stage tracker shown big for
    // the current order — a past order in History should still visibly show
    // HOW FAR it got, not just a plain status word next to it.
    const miniTrackHtml = (s) => {
      if (s === 'dismissed') return `<div style="font-size:10.5px; color:var(--danger); margin-top:6px;"><i class="fa-solid fa-circle-xmark" style="margin-right:4px;"></i>Not accepted</div>`;
      const idx = ORDER_STAGES.findIndex(o => o.key === s);
      return `<div style="display:flex; align-items:center; margin-top:6px;">
        ${ORDER_STAGES.map((_, i) => `
          <span style="width:7px; height:7px; border-radius:50%; flex-shrink:0; background:${i <= idx ? 'var(--primary)' : 'var(--border)'};"></span>
          ${i < ORDER_STAGES.length - 1 ? `<span style="width:12px; height:2px; flex-shrink:0; background:${i < idx ? 'var(--primary)' : 'var(--border)'};"></span>` : ''}
        `).join('')}
      </div>`;
    };

    // Every OTHER order this device has sent for this table, newest first —
    // the current one is already shown in full above, so it's excluded here.
    // Lets a customer glance back at everything ordered so far this visit,
    // not just whatever's currently in flight — this device's own
    // remembered history (loadSessionRequestIds()), never another
    // customer's or staff's.
    const historyIds = sessionRequestIds.filter(id => id !== trackedRequestId).slice().reverse();
    const historyEntries = (await Promise.all(historyIds.map(async (id) => {
      const r = allRequests.find(x => x.id === id);
      if (!r) return null;
      const kItems = await findKitchenItemsForRequest(id, tableId);
      return { request: r, stage: computeStage(r, kItems) };
    }))).filter(Boolean);
    const historyHtml = historyEntries.length > 0 ? `
      <div style="padding:4px 20px 20px;">
        <div style="font-size:11.5px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:.4px; margin-bottom:10px;">Your Order History</div>
        ${historyEntries.map(({ request: r, stage: s }) => `
          <div class="cm-history-row">
            <div style="min-width:0;">
              <div style="font-size:11px; color:var(--text-muted);">${new Date(r.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
              <div style="font-size:12.5px; font-weight:700; overflow-wrap:break-word;">${(r.items || []).map(i => `${i.qty}x ${escapeHtml(i.name)}`).join(', ')}</div>
              ${miniTrackHtml(s)}
            </div>
            <div style="text-align:right; flex-shrink:0; margin-left:10px;">
              <div style="font-size:14px; font-weight:800;">₹${reqTotal(r).toFixed(2)}</div>
              <div style="font-size:10.5px; font-weight:700; color:${statusColor(s)};">${statusLabel(s)}</div>
            </div>
          </div>
        `).join('')}
      </div>
    ` : '';
    const historyStyles = `
      <style>
        .cm-history-row { display:flex; justify-content:space-between; align-items:flex-start; gap:10px; padding:10px 0; border-bottom:1px solid var(--border); }
        .cm-history-row:last-child { border-bottom:none; }
      </style>
    `;

    if (stage === 'dismissed') {
      container.innerHTML = scrollShell(`
        <div style="padding:24px 24px 0; text-align:center;">
          <div style="font-size:52px; margin-bottom:16px;">😕</div>
          <div style="font-size:19px; font-weight:800; margin-bottom:8px;">Your order couldn't be accepted</div>
          <div style="font-size:13.5px; color:var(--text-muted); max-width:320px; margin:0 auto;">Please check with a staff member at the counter.</div>
          <button id="cmNewRequestBtn" class="btn btn-primary" style="margin-top:24px;">Send a New Order</button>
        </div>
        ${historyHtml}
      ` + historyStyles);
      document.getElementById('cmNewRequestBtn')?.addEventListener('click', () => {
        viewMode = 'menu';
        trackedRequestId = null;
        renderContent(container, tableId);
      });
      return;
    }

    const currentIndex = ORDER_STAGES.findIndex(s => s.key === stage);
    container.innerHTML = scrollShell(`
      <div style="padding:16px; background:var(--bg-elevated); border-bottom:1px solid var(--border); position:sticky; top:0; z-index:5; flex-shrink:0; text-align:center;">
        <div style="font-size:16px; font-weight:800;">📋 Your Order Status</div>
        <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">${escapeHtml(tableLabel)} — updates automatically</div>
      </div>
      <div style="padding:20px 20px 0;">
        <div class="card" style="padding:16px;">
          <div style="font-size:11px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:.4px; margin-bottom:8px;">Current Order</div>
          ${(request?.items || []).map(i => `<div style="display:flex; justify-content:space-between; font-size:13px; padding:4px 0;"><span>${i.qty}x ${escapeHtml(i.name)}</span><span style="color:var(--text-muted);">₹${(i.price * i.qty).toFixed(2)}</span></div>`).join('')}
          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; padding-top:10px; border-top:1px solid var(--border);">
            <span style="font-size:13px; font-weight:700;">Total</span>
            <span style="font-size:26px; font-weight:900; color:var(--primary);">₹${reqTotal(request || {}).toFixed(2)}</span>
          </div>
        </div>
      </div>
      <div style="padding:24px 20px 0;">
        <div class="cm-track">
          ${ORDER_STAGES.map((s, idx) => {
            const state = idx < currentIndex ? 'done' : idx === currentIndex ? 'active' : 'upcoming';
            return `
            <div class="cm-track-row cm-track-${state}">
              <div class="cm-track-dot">${state === 'done' ? '<i class="fa-solid fa-check"></i>' : s.icon}</div>
              <div class="cm-track-line"></div>
              <div class="cm-track-text">
                <div class="cm-track-label">${s.label}</div>
                ${state !== 'upcoming' ? `<div class="cm-track-desc">${s.desc}</div>` : ''}
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
      ${historyHtml}
      <div style="padding:16px; flex-shrink:0;">
        <button id="cmNewRequestBtn" class="btn btn-ghost" style="width:100%;">Send Another Order</button>
      </div>
    ` + `
      <style>
        .cm-track-row { display:flex; gap:14px; position:relative; padding-bottom:28px; }
        .cm-track-row:last-child { padding-bottom:0; }
        .cm-track-dot { width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:16px; flex-shrink:0; background:var(--bg-app); border:2px solid var(--border); color:var(--text-muted); z-index:1; }
        .cm-track-done .cm-track-dot, .cm-track-active .cm-track-dot { background:var(--primary); border-color:var(--primary); color:#fff; }
        .cm-track-active .cm-track-dot { animation: cmPulse 1.4s ease-in-out infinite; }
        .cm-track-line { position:absolute; left:17px; top:36px; bottom:-28px; width:2px; background:var(--border); }
        .cm-track-done .cm-track-line { background:var(--primary); }
        .cm-track-row:last-child .cm-track-line { display:none; }
        .cm-track-text { padding-top:6px; }
        .cm-track-label { font-size:13.5px; font-weight:800; color:var(--text-muted); }
        .cm-track-done .cm-track-label, .cm-track-active .cm-track-label { color:var(--text-main); }
        .cm-track-desc { font-size:11.5px; color:var(--text-muted); margin-top:2px; }
        @keyframes cmPulse { 0%,100% { transform:scale(1); opacity:1; } 50% { transform:scale(1.08); opacity:.85; } }
      </style>
    ` + historyStyles);
    document.getElementById('cmNewRequestBtn')?.addEventListener('click', () => {
      viewMode = 'menu';
      trackedRequestId = null;
      renderContent(container, tableId);
    });
    return;
  }

  if (viewMode === 'cart') {
    container.innerHTML = scrollShell(`
      <div style="padding:16px; background:var(--bg-elevated); border-bottom:1px solid var(--border); position:sticky; top:0; z-index:5; flex-shrink:0; display:flex; align-items:center; gap:10px;">
        <button id="cmBackToMenuBtn" class="btn-icon" style="font-size:16px;"><i class="fa-solid fa-arrow-left"></i></button>
        <div>
          <div style="font-size:16px; font-weight:800;">Your Order</div>
          <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">${escapeHtml(tableLabel)} — check quantities before sending</div>
        </div>
      </div>
      <div style="flex:1; padding:16px; padding-bottom:110px;">
        ${localCart.length === 0 ? `<div style="text-align:center; padding:40px; color:var(--text-muted);">Your cart is empty</div>` : localCart.map(i => `
          <div class="card" data-id="${i.productId}" style="padding:12px 14px; margin-bottom:10px; display:flex; align-items:center; gap:12px;">
            <div style="flex:1; min-width:0;">
              <div style="font-size:13.5px; font-weight:700; overflow-wrap:break-word;">${escapeHtml(i.name)}</div>
              <div style="font-size:12px; color:var(--primary); font-weight:800; margin-top:2px;">₹${(i.price * i.qty).toFixed(2)}</div>
            </div>
            <div class="cm-stepper cm-stepper-lg">
              <button class="cm-step-btn cm-qty-minus" data-id="${i.productId}"><i class="fa-solid fa-minus"></i></button>
              <span class="cm-step-qty">${i.qty}</span>
              <button class="cm-step-btn cm-qty-plus" data-id="${i.productId}"><i class="fa-solid fa-plus"></i></button>
            </div>
          </div>
        `).join('')}
      </div>
      ${localCart.length > 0 ? `
        <div style="position:fixed; bottom:0; left:0; right:0; background:var(--bg-elevated); border-top:1px solid var(--border); padding:14px 16px; box-shadow:0 -4px 16px rgba(0,0,0,.08);">
          <div style="display:flex; justify-content:space-between; font-size:14px; font-weight:800; margin-bottom:10px;">
            <span>Total</span><span>₹${cartTotal.toFixed(2)}</span>
          </div>
          <button id="cmSendRequestBtn" class="btn btn-primary" style="width:100%; padding:14px; font-size:15px; font-weight:800;">
            <i class="fa-solid fa-bag-shopping mr-8"></i> Place My Order
          </button>
        </div>
      ` : ''}
    ` + STEPPER_STYLES);

    document.getElementById('cmBackToMenuBtn')?.addEventListener('click', () => {
      viewMode = 'menu';
      renderContent(container, tableId);
    });
    container.querySelectorAll('.cm-qty-plus').forEach(el => el.addEventListener('click', () => {
      const item = localCart.find(i => String(i.productId) === el.dataset.id);
      if (item) item.qty += 1;
      renderContent(container, tableId);
    }));
    container.querySelectorAll('.cm-qty-minus').forEach(el => el.addEventListener('click', () => {
      const item = localCart.find(i => String(i.productId) === el.dataset.id);
      if (!item) return;
      item.qty -= 1;
      if (item.qty <= 0) localCart = localCart.filter(i => i !== item);
      renderContent(container, tableId);
    }));
    document.getElementById('cmSendRequestBtn')?.addEventListener('click', async () => {
      if (localCart.length === 0) return;
      const btn = document.getElementById('cmSendRequestBtn');
      btn.disabled = true;
      try {
        const saved = await saveMenuRequest({ tableId, items: localCart.map(i => ({ ...i })) });
        trackedRequestId = saved.id;
        sessionRequestIds = [...sessionRequestIds, saved.id];
        saveSessionRequestIds(tableId, sessionRequestIds);
        // A pre-existing bug this made newly visible: localCart was never
        // cleared after a successful send, only on a fresh page load — so
        // "Send Another Order" silently carried the just-sent items into
        // the next request too (the menu grid still showed them as "in
        // cart"), and a customer sending a 2nd order would end up
        // re-sending the 1st order's items bundled in with it. Confirmed
        // live: sending Rice, then Milk+Egg via "Send Another Order",
        // produced a 2nd request containing all three.
        localCart = [];
        viewMode = 'submitted';
        renderContent(container, tableId);
      } catch (err) {
        console.error('[CustomerMenu] saveMenuRequest failed', err);
        showToast('Could not send — please try again.', 'error');
        btn.disabled = false;
      }
    });
    return;
  }

  // This whole page is a STANDALONE route (router.js) — style.css locks
  // every standalone page's #page-container (the `container` this function
  // receives) to `overflow:hidden; height:100vh`, correct for a page like
  // RestaurantPOS.js that builds its own internal scroll regions, but this
  // page had never had one — with no scroll container of its own, the menu
  // grid had nowhere for its overflow to go on a real phone (touch-scroll
  // did nothing once there were more products than fit one screen), even
  // though it looked fine in a desktop browser's short product list. Same
  // fix as Kitchen.js's own popout-window scroll fix (v9q): a nested
  // `height:100vh/100dvh; overflow-y:auto` region of this page's own —
  // shared by every screen here via scrollShell() above.
  container.innerHTML = scrollShell(`
      <div style="padding:16px; background:var(--bg-elevated); border-bottom:1px solid var(--border); position:sticky; top:0; z-index:5; flex-shrink:0;">
        <div style="font-size:16px; font-weight:800;">🍽️ ${escapeHtml(tableLabel)}</div>
        <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">Browse the menu and send your order request to the counter — no login needed.</div>
      </div>
      <div style="display:flex; gap:8px; overflow-x:auto; padding:12px 16px; background:var(--bg-elevated); border-bottom:1px solid var(--border); flex-shrink:0;">
        <button class="cm-cat-tab ${!activeCategory ? 'active' : ''}" data-cat="">All</button>
        ${categories.map(c => `<button class="cm-cat-tab ${activeCategory === c.name ? 'active' : ''}" data-cat="${escapeHtml(c.name)}">${escapeHtml(c.name)}</button>`).join('')}
      </div>
      <div style="flex:1; padding:16px; display:grid; grid-template-columns:repeat(auto-fill, minmax(150px,1fr)); gap:12px; padding-bottom:${cartCount > 0 ? '90px' : '16px'};">
        ${products.length === 0 ? `<div style="grid-column:1/-1; text-align:center; padding:30px; color:var(--text-muted);">No items in this category</div>` : products.map(p => {
          const inCart = localCart.find(i => i.productId === p.id);
          return `
          <div class="card cm-product-card" data-id="${p.id}" style="padding:12px; text-align:center; cursor:pointer; position:relative;">
            <div style="font-size:26px; margin-bottom:6px;">${p.emoji || '🍽️'}</div>
            <div style="font-size:12.5px; font-weight:700;">${foodTypeIconHtml(p.foodType, 9)}${escapeHtml(p.name)}</div>
            <div style="font-size:12px; color:var(--primary); font-weight:800; margin-top:2px;">₹${Number(p.price || 0).toFixed(2)}</div>
            ${inCart ? `
              <div class="cm-stepper cm-stepper-sm" style="width:100%; margin-top:8px; justify-content:space-between;">
                <button class="cm-step-btn cm-grid-minus" data-id="${p.id}"><i class="fa-solid fa-minus"></i></button>
                <span class="cm-step-qty">${inCart.qty}</span>
                <button class="cm-step-btn cm-grid-plus" data-id="${p.id}"><i class="fa-solid fa-plus"></i></button>
              </div>
            ` : `<button class="btn btn-ghost btn-sm cm-grid-add" data-id="${p.id}" style="width:100%; margin-top:8px; font-size:11px; padding:5px;"><i class="fa-solid fa-plus"></i> Add</button>`}
          </div>
        `; }).join('')}
      </div>
      ${cartCount > 0 ? `
        <div style="position:fixed; bottom:0; left:0; right:0; background:var(--bg-elevated); border-top:1px solid var(--border); padding:14px 16px; box-shadow:0 -4px 16px rgba(0,0,0,.08);">
          <button id="cmViewCartBtn" class="btn btn-primary" style="width:100%; padding:14px; font-size:15px; font-weight:800; display:flex; align-items:center; justify-content:space-between;">
            <span><i class="fa-solid fa-cart-shopping mr-8"></i>${cartCount} item${cartCount === 1 ? '' : 's'} — ₹${cartTotal.toFixed(2)}</span>
            <span>View Cart <i class="fa-solid fa-arrow-right mr-4"></i></span>
          </button>
        </div>
      ` : ''}
    `, '') + `
    <style>
      .cm-cat-tab { flex-shrink:0; padding:7px 14px; border-radius:999px; border:1px solid var(--border); background:var(--bg-app); font-size:12.5px; font-weight:700; color:var(--text-muted); cursor:pointer; white-space:nowrap; }
      .cm-cat-tab.active { background:var(--primary); color:#fff; border-color:var(--primary); }
      .cm-product-card:active { transform:scale(0.97); }
    </style>
  ` + STEPPER_STYLES;

  const addOne = (productId) => {
    const product = products.find(p => String(p.id) === String(productId));
    if (!product) return;
    const existing = localCart.find(i => i.productId === product.id);
    if (existing) existing.qty += 1;
    else localCart.push({ productId: product.id, name: product.name, price: Number(product.price) || 0, qty: 1 });
    renderContent(container, tableId);
  };
  const removeOne = (productId) => {
    const item = localCart.find(i => String(i.productId) === String(productId));
    if (!item) return;
    item.qty -= 1;
    if (item.qty <= 0) localCart = localCart.filter(i => i !== item);
    renderContent(container, tableId);
  };

  container.querySelectorAll('.cm-cat-tab').forEach(el => el.addEventListener('click', () => {
    activeCategory = el.dataset.cat;
    renderContent(container, tableId);
  }));
  // Tapping the card ANYWHERE except its own +/- stepper adds one — the
  // stepper's own buttons stop propagation so a tap meant to decrement
  // doesn't also fire the card's add-one handler.
  container.querySelectorAll('.cm-product-card').forEach(el => el.addEventListener('click', (e) => {
    if (e.target.closest('.cm-grid-minus') || e.target.closest('.cm-grid-plus')) return;
    addOne(el.dataset.id);
  }));
  container.querySelectorAll('.cm-grid-plus').forEach(el => el.addEventListener('click', (e) => { e.stopPropagation(); addOne(el.dataset.id); }));
  container.querySelectorAll('.cm-grid-minus').forEach(el => el.addEventListener('click', (e) => { e.stopPropagation(); removeOne(el.dataset.id); }));
  document.getElementById('cmViewCartBtn')?.addEventListener('click', () => {
    viewMode = 'cart';
    renderContent(container, tableId);
  });
}
