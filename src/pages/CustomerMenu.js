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

import { getProducts, getCategories, getTables, saveMenuRequest, getSettings } from '../db.js';
import { isProductAvailable } from './RestaurantPOS.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { foodTypeIconHtml } from '../utils/foodType.js';
import { showToast } from '../components/Toast.js';
import { tableDisplayNameWithSection } from '../utils/tableDisplay.js';

let localCart = []; // [{productId, name, price, qty}] — this page's OWN cart, never store.cart
let activeCategory = '';
let viewMode = 'menu'; // 'menu' | 'cart' | 'submitted' — cart is a review step before Send Request actually fires

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
  viewMode = 'menu';
  localCart = [];
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
    container.innerHTML = scrollShell(`
      <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:24px; text-align:center;">
        <div style="font-size:56px; margin-bottom:16px;">✅</div>
        <div style="font-size:20px; font-weight:800; margin-bottom:8px;">Sent to the counter!</div>
        <div style="font-size:14px; color:var(--text-muted); max-width:320px;">Your order request has been sent — a staff member will confirm it shortly. No need to do anything else.</div>
        <button id="cmNewRequestBtn" class="btn btn-primary" style="margin-top:24px;">Send another request</button>
      </div>
    `);
    document.getElementById('cmNewRequestBtn')?.addEventListener('click', () => {
      viewMode = 'menu';
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
            <div style="display:flex; align-items:center; gap:10px; flex-shrink:0;">
              <button class="btn-icon cm-qty-minus" data-id="${i.productId}" style="width:32px; height:32px; border:1px solid var(--border); border-radius:8px;"><i class="fa-solid fa-minus"></i></button>
              <span style="font-size:14px; font-weight:800; min-width:18px; text-align:center;">${i.qty}</span>
              <button class="btn-icon cm-qty-plus" data-id="${i.productId}" style="width:32px; height:32px; border:1px solid var(--border); border-radius:8px;"><i class="fa-solid fa-plus"></i></button>
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
            <i class="fa-solid fa-paper-plane mr-8"></i> Send Request to Counter
          </button>
        </div>
      ` : ''}
    `);

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
        await saveMenuRequest({ tableId, items: localCart.map(i => ({ ...i })) });
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
            ${inCart ? `
              <div style="position:absolute; top:6px; left:6px; right:6px; display:flex; align-items:center; justify-content:space-between; background:var(--bg-elevated); border:1px solid var(--primary); border-radius:8px; padding:2px;">
                <button class="btn-icon cm-grid-minus" data-id="${p.id}" style="width:22px; height:22px; font-size:10px;"><i class="fa-solid fa-minus"></i></button>
                <span style="font-size:11px; font-weight:800; color:var(--primary);">${inCart.qty}</span>
                <button class="btn-icon cm-grid-plus" data-id="${p.id}" style="width:22px; height:22px; font-size:10px;"><i class="fa-solid fa-plus"></i></button>
              </div>
            ` : ''}
            <div style="font-size:26px; margin-bottom:6px; margin-top:${inCart ? '22px' : '0'};">${p.emoji || '🍽️'}</div>
            <div style="font-size:12.5px; font-weight:700;">${foodTypeIconHtml(p.foodType, 9)}${escapeHtml(p.name)}</div>
            <div style="font-size:12px; color:var(--primary); font-weight:800; margin-top:2px;">₹${Number(p.price || 0).toFixed(2)}</div>
            ${!inCart ? `<button class="btn btn-ghost btn-sm cm-grid-add" data-id="${p.id}" style="width:100%; margin-top:8px; font-size:11px; padding:5px;"><i class="fa-solid fa-plus"></i> Add</button>` : ''}
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
  `;

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
