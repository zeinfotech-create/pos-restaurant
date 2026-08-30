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
// order). Instead this builds its own local cart and submits it as a
// MenuRequest for staff to explicitly review and Accept/Dismiss
// (RestaurantPOS.js) — same trust boundary as every other customer-facing
// input in this app.
// ============================================================

import { getProducts, getCategories, getTables, saveMenuRequest } from '../db.js';
import { isProductAvailable } from './RestaurantPOS.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { foodTypeIconHtml } from '../utils/foodType.js';
import { showToast } from '../components/Toast.js';

let localCart = []; // [{productId, name, price, qty}] — this page's OWN cart, never store.cart
let activeCategory = '';
let submitted = false;

export async function renderCustomerMenu(container, subPage) {
  const tableId = subPage || '';
  submitted = false;
  localCart = [];
  await renderContent(container, tableId);
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

  if (submitted) {
    container.innerHTML = `
      <div style="min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:24px; text-align:center; background:var(--bg-app);">
        <div style="font-size:56px; margin-bottom:16px;">✅</div>
        <div style="font-size:20px; font-weight:800; margin-bottom:8px;">Sent to the counter!</div>
        <div style="font-size:14px; color:var(--text-muted); max-width:320px;">Your order request has been sent — a staff member will confirm it shortly. No need to do anything else.</div>
        <button id="cmNewRequestBtn" class="btn btn-primary" style="margin-top:24px;">Send another request</button>
      </div>
    `;
    document.getElementById('cmNewRequestBtn')?.addEventListener('click', () => {
      submitted = false;
      renderContent(container, tableId);
    });
    return;
  }

  container.innerHTML = `
    <div style="min-height:100vh; display:flex; flex-direction:column; background:var(--bg-app);">
      <div style="padding:16px; background:var(--bg-elevated); border-bottom:1px solid var(--border); position:sticky; top:0; z-index:5;">
        <div style="font-size:16px; font-weight:800;">🍽️ ${table ? escapeHtml(table.name) : 'Menu'}</div>
        <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">Browse the menu and send your order request to the counter — no login needed.</div>
      </div>
      <div style="display:flex; gap:8px; overflow-x:auto; padding:12px 16px; background:var(--bg-elevated); border-bottom:1px solid var(--border);">
        <button class="cm-cat-tab ${!activeCategory ? 'active' : ''}" data-cat="">All</button>
        ${categories.map(c => `<button class="cm-cat-tab ${activeCategory === c.name ? 'active' : ''}" data-cat="${escapeHtml(c.name)}">${escapeHtml(c.name)}</button>`).join('')}
      </div>
      <div style="flex:1; padding:16px; display:grid; grid-template-columns:repeat(auto-fill, minmax(150px,1fr)); gap:12px; padding-bottom:${cartCount > 0 ? '90px' : '16px'};">
        ${products.length === 0 ? `<div style="grid-column:1/-1; text-align:center; padding:30px; color:var(--text-muted);">No items in this category</div>` : products.map(p => {
          const inCart = localCart.find(i => i.productId === p.id);
          return `
          <div class="card cm-product-card" data-id="${p.id}" style="padding:12px; text-align:center; cursor:pointer; position:relative;">
            ${inCart ? `<div style="position:absolute; top:6px; right:6px; background:var(--primary); color:#fff; font-size:11px; font-weight:800; width:20px; height:20px; border-radius:50%; display:flex; align-items:center; justify-content:center;">${inCart.qty}</div>` : ''}
            <div style="font-size:26px; margin-bottom:6px;">${p.emoji || '🍽️'}</div>
            <div style="font-size:12.5px; font-weight:700;">${foodTypeIconHtml(p.foodType, 9)}${escapeHtml(p.name)}</div>
            <div style="font-size:12px; color:var(--primary); font-weight:800; margin-top:2px;">₹${Number(p.price || 0).toFixed(2)}</div>
          </div>
        `; }).join('')}
      </div>
      ${cartCount > 0 ? `
        <div style="position:fixed; bottom:0; left:0; right:0; background:var(--bg-elevated); border-top:1px solid var(--border); padding:14px 16px; box-shadow:0 -4px 16px rgba(0,0,0,.08);">
          <button id="cmSendRequestBtn" class="btn btn-primary" style="width:100%; padding:14px; font-size:15px; font-weight:800; display:flex; align-items:center; justify-content:space-between;">
            <span>${cartCount} item${cartCount === 1 ? '' : 's'} — ₹${cartTotal.toFixed(2)}</span>
            <span>Send Request <i class="fa-solid fa-arrow-right mr-4"></i></span>
          </button>
        </div>
      ` : ''}
    </div>
    <style>
      .cm-cat-tab { flex-shrink:0; padding:7px 14px; border-radius:999px; border:1px solid var(--border); background:var(--bg-app); font-size:12.5px; font-weight:700; color:var(--text-muted); cursor:pointer; white-space:nowrap; }
      .cm-cat-tab.active { background:var(--primary); color:#fff; border-color:var(--primary); }
      .cm-product-card:active { transform:scale(0.97); }
    </style>
  `;

  container.querySelectorAll('.cm-cat-tab').forEach(el => el.addEventListener('click', () => {
    activeCategory = el.dataset.cat;
    renderContent(container, tableId);
  }));
  container.querySelectorAll('.cm-product-card').forEach(el => el.addEventListener('click', () => {
    const product = products.find(p => String(p.id) === el.dataset.id);
    if (!product) return;
    const existing = localCart.find(i => i.productId === product.id);
    if (existing) existing.qty += 1;
    else localCart.push({ productId: product.id, name: product.name, price: Number(product.price) || 0, qty: 1 });
    renderContent(container, tableId);
  }));
  document.getElementById('cmSendRequestBtn')?.addEventListener('click', async () => {
    if (localCart.length === 0) return;
    const btn = document.getElementById('cmSendRequestBtn');
    btn.disabled = true;
    try {
      await saveMenuRequest({ tableId, items: localCart.map(i => ({ ...i })) });
      submitted = true;
      renderContent(container, tableId);
    } catch (err) {
      console.error('[CustomerMenu] saveMenuRequest failed', err);
      showToast('Could not send — please try again.', 'error');
      btn.disabled = false;
    }
  });
}
