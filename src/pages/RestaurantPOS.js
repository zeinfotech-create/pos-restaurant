// ============================================================
// RestaurantPOS.js — Order-taking flow for a restaurant: pick an order type
// (Dine-in / Takeaway / Delivery), pick a table for dine-in, browse the menu,
// add items (with optional modifiers/notes), send to the kitchen (KOT), and
// bill. Deliberately a NEW, separate page rather than a modification of
// POS.js/QuickPOS.js — it reuses their underlying plumbing (store.js's cart
// operations, CheckoutService.confirmOrder(), the print pipeline) but never
// touches their own files, so the existing retail flow is completely
// unaffected by anything here.
// ============================================================

import { getTables, saveTable, getCategories, getProducts, saveKot, getKots, updateKotStatus, getSettings, getCurrentBranch } from '../db.js';
import { store, addToCart, removeFromCart, updateQty, updateCartItem, getCartTotals, onCartUpdate, loadTableOrderIntoCart } from '../store.js';
import { confirmOrder, printReceiptHtml } from '../services/CheckoutService.js';
import { openModal, closeModal, showConfirm } from '../components/Modal.js';
import { showToast } from '../components/Toast.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { navigate } from '../router.js';

// A fixed, common set of toggle-able modifiers — every menu item shares the
// same list rather than per-product-configured modifier groups. Simpler to
// build and to use at the counter; still covers the common "no onion / extra
// spicy / less sugar" customization requests a per-product config would.
const COMMON_MODIFIERS = ['No Onion', 'No Garlic', 'Extra Spicy', 'Less Spicy', 'Extra Cheese', 'Less Sugar', 'No Ice'];

let view = 'picker'; // 'picker' | 'ordering' | 'kitchen'
let orderType = null; // 'dine-in' | 'takeaway' | 'delivery'
let selectedTable = null; // full table doc, only for dine-in
let activeCategory = null;
let takeawayContact = { name: '', phone: '' };
let cartListenerRegistered = false;

export async function renderRestaurantPOS(container, subPage) {
  // Reset per-visit state every time the page is (re)entered fresh via nav
  // (not on internal re-renders — those call the render*View() functions
  // directly) so a leftover table/orderType from a previous visit never
  // silently carries over into what looks like a brand-new order.
  if (!cartListenerRegistered) {
    onCartUpdate(() => { if (view === 'ordering') renderOrderingView(); });
    cartListenerRegistered = true; // onCartUpdate() already de-dupes by function identity — this just avoids even attempting a re-registration (a new closure, so it WOULDN'T actually be de-duped) on every nav into this page
  }

  if (subPage) {
    // Came from Tables.js's own table click — jump straight into ordering
    // that table, re-reading its live status/currentOrder rather than
    // trusting anything the caller already had.
    const table = (await getTables()).find(t => t.id === subPage);
    if (table) {
      selectedTable = table;
      orderType = 'dine-in';
      loadTableOrderIntoCart(table);
      view = 'ordering';
    }
  } else {
    view = 'picker';
    orderType = null;
    selectedTable = null;
  }

  await render(container);
}

// Sub-view handlers that switch `view` and re-render only their own
// #rposContent (renderPickerView() picking an order type, etc.) call this
// afterward so the topbar's Back-button label stays correct without needing
// a full shell re-render (which would also needlessly re-fetch the KOT
// badge count).
function updateBackButtonLabel() {
  const btn = document.getElementById('rposBackBtn');
  if (btn) btn.innerHTML = `<i class="fa-solid fa-arrow-left"></i> ${view === 'picker' ? 'Dashboard' : 'Change Table'}`;
}

async function render(container) {
  container.innerHTML = `
    <div class="rpos-shell">
      <div class="rpos-topbar">
        <button class="btn btn-ghost btn-sm" id="rposBackBtn"><i class="fa-solid fa-arrow-left"></i> ${view === 'picker' ? 'Dashboard' : 'Change Table'}</button>
        <div class="rpos-topbar-title"><i class="fa-solid fa-utensils"></i> Restaurant POS</div>
        <button class="btn btn-ghost btn-sm" id="rposKitchenBtn"><i class="fa-solid fa-kitchen-set"></i> Kitchen<span id="rposKotBadge"></span></button>
      </div>
      <div id="rposContent"></div>
    </div>
    <style>
      .rpos-shell { height: 100vh; display: flex; flex-direction: column; background: var(--bg-main); }
      .rpos-topbar { display:flex; align-items:center; justify-content:space-between; padding:12px 20px; border-bottom:1px solid var(--border); background:var(--bg-elevated); flex-shrink:0; }
      .rpos-topbar-title { font-size:15px; font-weight:800; }
      #rposContent { flex:1; overflow:auto; padding:20px; }
      .rpos-order-type-btn { padding:28px; border-radius:16px; border:2px solid var(--border); background:var(--bg-elevated); cursor:pointer; text-align:center; transition:all .15s; }
      .rpos-order-type-btn:hover { border-color:var(--primary); transform:translateY(-2px); }
      .rpos-table-card { padding:16px; border-radius:12px; cursor:pointer; transition:all .15s; }
      .rpos-table-card:hover { transform:translateY(-2px); }
      .rpos-layout { display:grid; grid-template-columns: 1fr 380px; gap:16px; height:100%; align-items:start; }
      @media (max-width: 900px) { .rpos-layout { grid-template-columns: 1fr; } }
      .rpos-cat-tab { padding:8px 16px; border-radius:999px; border:1px solid var(--border); background:var(--bg-elevated); cursor:pointer; font-size:12px; font-weight:700; white-space:nowrap; }
      .rpos-cat-tab.active { background:var(--primary); color:white; border-color:var(--primary); }
      .rpos-product-card { padding:14px; border-radius:12px; border:1px solid var(--border); background:var(--bg-elevated); cursor:pointer; transition:all .15s; }
      .rpos-product-card:hover { border-color:var(--primary); transform:translateY(-2px); }
      .rpos-cart-item { padding:10px 0; border-bottom:1px solid var(--border); }
      .rpos-kot-badge { display:inline-block; min-width:16px; padding:1px 5px; border-radius:999px; background:var(--danger); color:white; font-size:10px; font-weight:800; margin-left:4px; }
    </style>
  `;

  document.getElementById('rposBackBtn')?.addEventListener('click', handleBack);
  // Re-renders the WHOLE shell (topbar included) rather than just swapping
  // #rposContent, so the Back button's label ("Dashboard"/"Change Table")
  // stays in sync with the view it's about to switch away from.
  document.getElementById('rposKitchenBtn')?.addEventListener('click', () => { view = 'kitchen'; render(container); });
  await refreshKotBadge();

  if (view === 'picker') await renderPickerView();
  else if (view === 'ordering') await renderOrderingView();
  else if (view === 'kitchen') await renderKitchenView();
}

async function refreshKotBadge() {
  const badge = document.getElementById('rposKotBadge');
  if (!badge) return;
  const pending = (await getKots()).filter(k => k.status !== 'served');
  badge.innerHTML = pending.length > 0 ? `<span class="rpos-kot-badge">${pending.length}</span>` : '';
}

function handleBack() {
  const container = document.getElementById('page-container');
  // Calling the internal render(container) here (not the exported
  // renderRestaurantPOS()) is deliberate — renderRestaurantPOS() always
  // resets view/orderType/selectedTable back to a fresh 'picker' state
  // (it's the entry point for a brand-new nav into this page), which would
  // silently undo the state changes just made below. render() just
  // re-renders the shell + current sub-view from whatever module state
  // already is.
  if (view === 'kitchen') {
    view = orderType ? 'ordering' : 'picker';
    return render(container);
  }
  if (view === 'ordering') {
    // Dine-in with items already sent to the kitchen (table is 'occupied')
    // just steps back to the table picker — the order lives safely on the
    // table doc. A brand-new/empty order can leave with nothing lost either
    // way, so no confirmation needed in that case.
    view = 'picker';
    orderType = null;
    selectedTable = null;
    return render(container);
  }
  navigate('dashboard');
}

// ── Picker view: order type, then (for dine-in) the table grid ───────────
async function renderPickerView() {
  const area = document.getElementById('rposContent');
  if (!area) return;

  if (!orderType) {
    area.innerHTML = `
      <div style="max-width:700px; margin:60px auto; text-align:center;">
        <h2 style="font-size:20px; font-weight:800; margin-bottom:24px;">What kind of order is this?</h2>
        <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:16px;">
          <div class="rpos-order-type-btn" data-type="dine-in"><i class="fa-solid fa-utensils" style="font-size:28px; color:var(--primary);"></i><div style="margin-top:10px; font-weight:700;">Dine-in</div></div>
          <div class="rpos-order-type-btn" data-type="takeaway"><i class="fa-solid fa-bag-shopping" style="font-size:28px; color:var(--primary);"></i><div style="margin-top:10px; font-weight:700;">Takeaway</div></div>
          <div class="rpos-order-type-btn" data-type="delivery"><i class="fa-solid fa-motorcycle" style="font-size:28px; color:var(--primary);"></i><div style="margin-top:10px; font-weight:700;">Delivery</div></div>
        </div>
      </div>
    `;
    document.querySelectorAll('.rpos-order-type-btn').forEach(el => {
      el.addEventListener('click', async () => {
        orderType = el.dataset.type;
        if (orderType === 'dine-in') {
          await renderPickerView();
        } else {
          selectedTable = null;
          loadTableOrderIntoCart(null);
          view = 'ordering';
          updateBackButtonLabel();
          await renderOrderingView();
        }
      });
    });
    return;
  }

  // orderType === 'dine-in', no table chosen yet — show the table grid.
  const STATUS_META = {
    free: { label: 'Free', color: 'var(--success)', bg: 'rgba(34,197,94,0.08)' },
    occupied: { label: 'Occupied', color: 'var(--warning)', bg: 'rgba(245,158,11,0.08)' },
    billed: { label: 'Billed', color: 'var(--danger)', bg: 'rgba(239,68,68,0.08)' },
  };
  const tables = (await getTables()).sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true }));
  area.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
      <h2 style="font-size:16px; font-weight:800;">Select a Table</h2>
      <a href="#tables" style="font-size:12px; color:var(--primary); font-weight:700;"><i class="fa-solid fa-gear"></i> Manage Tables</a>
    </div>
    ${tables.length === 0 ? `
      <div class="card" style="padding:40px; text-align:center; color:var(--text-muted);">
        No tables set up yet. <a href="#tables" style="color:var(--primary); font-weight:700;">Add tables</a> to get started.
      </div>
    ` : `
      <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(160px,1fr)); gap:14px;">
        ${tables.map(t => {
          const status = STATUS_META[t.status] || STATUS_META.free;
          return `
            <div class="rpos-table-card" data-id="${t.id}" style="background:${status.bg}; border:1px solid var(--border);">
              <div style="font-weight:800; font-size:15px;"><i class="fa-solid fa-chair" style="opacity:.4; margin-right:6px; font-size:12px;"></i>${escapeHtml(t.name)}</div>
              <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">Seats ${t.capacity || 4}</div>
              <div style="margin-top:10px; font-size:11px; font-weight:700; color:${status.color};"><i class="fa-solid fa-circle" style="font-size:6px; margin-right:5px;"></i>${status.label}${t.status === 'occupied' && t.currentOrder?.items?.length ? ` · ${t.currentOrder.items.length} item(s)` : ''}</div>
            </div>
          `;
        }).join('')}
      </div>
    `}
  `;
  document.querySelectorAll('.rpos-table-card').forEach(el => {
    el.addEventListener('click', async () => {
      selectedTable = tables.find(t => t.id === el.dataset.id);
      loadTableOrderIntoCart(selectedTable);
      view = 'ordering';
      updateBackButtonLabel();
      await renderOrderingView();
    });
  });
}

// ── Ordering view: menu + cart ────────────────────────────────────────────
async function renderOrderingView() {
  const area = document.getElementById('rposContent');
  if (!area) return;

  const settings = store.settings || await getSettings();
  const cur = settings.currency || '₹';
  const categories = await getCategories();
  const products = (await getProducts()).filter(p => !activeCategory || p.category === activeCategory);
  const totals = getCartTotals();

  area.innerHTML = `
    <div class="rpos-layout">
      <div>
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
          <div style="font-size:14px; font-weight:800;">
            ${orderType === 'dine-in' ? `<i class="fa-solid fa-chair"></i> ${escapeHtml(selectedTable?.name || 'Table')}` : orderType === 'takeaway' ? '<i class="fa-solid fa-bag-shopping"></i> Takeaway' : '<i class="fa-solid fa-motorcycle"></i> Delivery'}
          </div>
          ${orderType !== 'dine-in' ? `
            <div style="display:flex; gap:8px;">
              <input class="form-input" id="rposContactName" placeholder="Customer name (optional)" value="${escapeHtml(takeawayContact.name)}" style="max-width:160px; font-size:12px;" />
              <input class="form-input" id="rposContactPhone" placeholder="Phone (optional)" value="${escapeHtml(takeawayContact.phone)}" style="max-width:130px; font-size:12px;" />
            </div>
          ` : ''}
        </div>
        <div style="display:flex; gap:8px; overflow-x:auto; padding-bottom:10px; margin-bottom:14px;">
          <div class="rpos-cat-tab ${!activeCategory ? 'active' : ''}" data-cat="">All</div>
          ${categories.map(c => `<div class="rpos-cat-tab ${activeCategory === c.name ? 'active' : ''}" data-cat="${escapeHtml(c.name)}">${escapeHtml(c.name)}</div>`).join('')}
        </div>
        <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(140px,1fr)); gap:12px;">
          ${products.length === 0 ? `<div style="grid-column:1/-1; text-align:center; padding:30px; color:var(--text-muted);">No items in this category</div>` : products.map(p => `
            <div class="rpos-product-card" data-id="${p.id}">
              <div style="font-size:24px; text-align:center;">${p.emoji || '🍽️'}</div>
              <div style="font-size:12px; font-weight:700; margin-top:6px; text-align:center;">${escapeHtml(p.name)}</div>
              <div style="font-size:12px; color:var(--primary); font-weight:800; text-align:center; margin-top:2px;">${cur}${Number(p.price || 0).toFixed(2)}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="card" style="padding:16px; position:sticky; top:0;">
        <div style="font-size:13px; font-weight:800; margin-bottom:10px;">🛒 Order (${store.cart.length} item${store.cart.length === 1 ? '' : 's'})</div>
        <div style="max-height:40vh; overflow-y:auto;">
          ${store.cart.length === 0 ? `<div style="text-align:center; padding:24px; color:var(--text-muted); font-size:12px;">No items yet — tap a menu item to add it</div>` : store.cart.map(i => `
            <div class="rpos-cart-item">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                <div style="font-size:12.5px; font-weight:700; flex:1;">${escapeHtml(i.name)}</div>
                <button class="btn-icon rpos-remove-item" data-cart-id="${i.cartId}" title="Remove"><i class="fa-solid fa-xmark" style="font-size:11px; color:var(--danger);"></i></button>
              </div>
              ${(i.modifiers?.length || i.notes) ? `<div style="font-size:10.5px; color:var(--text-muted); margin-top:2px;">${[...(i.modifiers || []), i.notes].filter(Boolean).map(escapeHtml).join(' · ')}</div>` : ''}
              <div style="display:flex; align-items:center; justify-content:space-between; margin-top:6px;">
                <div style="display:flex; align-items:center; gap:8px;">
                  <button class="btn-icon rpos-qty-minus" data-cart-id="${i.cartId}"><i class="fa-solid fa-minus" style="font-size:10px;"></i></button>
                  <span style="font-size:12px; font-weight:700; min-width:18px; text-align:center;">${i.qty}</span>
                  <button class="btn-icon rpos-qty-plus" data-cart-id="${i.cartId}"><i class="fa-solid fa-plus" style="font-size:10px;"></i></button>
                  <button class="btn-icon rpos-customize-item" data-cart-id="${i.cartId}" title="Customize"><i class="fa-solid fa-sliders" style="font-size:10px;"></i></button>
                </div>
                <div style="font-size:12px; font-weight:800;">${cur}${(i.price * i.qty).toFixed(2)}</div>
              </div>
            </div>
          `).join('')}
        </div>
        <div style="border-top:1px solid var(--border); margin-top:12px; padding-top:12px; display:flex; justify-content:space-between; font-size:14px; font-weight:800;">
          <span>Total</span><span>${cur}${totals.total.toFixed(2)}</span>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px; margin-top:14px;">
          <button class="btn btn-secondary" id="rposSendKitchenBtn" ${store.cart.length === 0 ? 'disabled' : ''}><i class="fa-solid fa-kitchen-set"></i> Send to Kitchen</button>
          <button class="btn btn-primary" id="rposBillBtn" ${store.cart.length === 0 ? 'disabled' : ''}><i class="fa-solid fa-receipt"></i> Bill Now — ${cur}${totals.total.toFixed(2)}</button>
        </div>
      </div>
    </div>
  `;

  document.querySelectorAll('.rpos-cat-tab').forEach(el => {
    el.addEventListener('click', async () => { activeCategory = el.dataset.cat || null; await renderOrderingView(); });
  });
  document.querySelectorAll('.rpos-product-card').forEach(el => {
    el.addEventListener('click', async () => {
      const product = products.find(p => String(p.id) === el.dataset.id);
      if (product) addToCart(product);
    });
  });
  document.querySelectorAll('.rpos-remove-item').forEach(el => el.addEventListener('click', () => removeFromCart(el.dataset.cartId)));
  document.querySelectorAll('.rpos-qty-plus').forEach(el => el.addEventListener('click', () => updateQty(el.dataset.cartId, 1)));
  document.querySelectorAll('.rpos-qty-minus').forEach(el => el.addEventListener('click', () => updateQty(el.dataset.cartId, -1)));
  document.querySelectorAll('.rpos-customize-item').forEach(el => el.addEventListener('click', () => openModifierModal(el.dataset.cartId)));

  document.getElementById('rposContactName')?.addEventListener('input', e => { takeawayContact.name = e.target.value; });
  document.getElementById('rposContactPhone')?.addEventListener('input', e => { takeawayContact.phone = e.target.value; });

  document.getElementById('rposSendKitchenBtn')?.addEventListener('click', sendToKitchen);
  document.getElementById('rposBillBtn')?.addEventListener('click', openPaymentPanel);
}

function openModifierModal(cartId) {
  const item = store.cart.find(i => i.cartId === cartId);
  if (!item) return;
  const selected = new Set(item.modifiers || []);
  openModal({
    title: `<i class="fa-solid fa-sliders mr-8"></i> Customize — ${escapeHtml(item.name)}`,
    body: `
      <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px;">
        ${COMMON_MODIFIERS.map(m => `
          <button type="button" class="rpos-mod-chip ${selected.has(m) ? 'active' : ''}" data-mod="${escapeHtml(m)}"
            style="padding:7px 12px; border-radius:999px; border:1px solid ${selected.has(m) ? 'var(--primary)' : 'var(--border)'}; background:${selected.has(m) ? 'var(--primary)' : 'var(--bg-elevated)'}; color:${selected.has(m) ? 'white' : 'inherit'}; font-size:12px; font-weight:600; cursor:pointer;">
            ${escapeHtml(m)}
          </button>
        `).join('')}
      </div>
      <div class="form-group">
        <label class="form-label">Special Instructions</label>
        <textarea class="form-input" id="rposModNotes" rows="2" placeholder="e.g. Extra crispy, on the side...">${escapeHtml(item.notes || '')}</textarea>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="rposModSaveBtn">Save</button>
    `
  });
  setTimeout(() => {
    document.querySelectorAll('.rpos-mod-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const m = chip.dataset.mod;
        if (selected.has(m)) { selected.delete(m); chip.classList.remove('active'); chip.style.background = 'var(--bg-elevated)'; chip.style.color = 'inherit'; chip.style.borderColor = 'var(--border)'; }
        else { selected.add(m); chip.classList.add('active'); chip.style.background = 'var(--primary)'; chip.style.color = 'white'; chip.style.borderColor = 'var(--primary)'; }
      });
    });
    document.getElementById('rposModSaveBtn')?.addEventListener('click', () => {
      const notes = document.getElementById('rposModNotes')?.value.trim() || '';
      updateCartItem(cartId, { modifiers: Array.from(selected), notes });
      closeModal();
    });
  }, 50);
}

// ── Send to Kitchen ────────────────────────────────────────────────────────
async function sendToKitchen() {
  if (store.cart.length === 0) return;
  const branchId = store.branch?.id || (await getCurrentBranch())?.id || 'b1';
  const settings = store.settings || await getSettings();

  const kot = await saveKot({
    tableId: selectedTable?.id || null,
    tableName: selectedTable?.name || null,
    orderType,
    contactName: takeawayContact.name || '',
    items: store.cart.map(i => ({ name: i.name, qty: i.qty, modifiers: i.modifiers || [], notes: i.notes || '' })),
    branchId,
  });

  if (orderType === 'dine-in' && selectedTable) {
    selectedTable = await saveTable({ ...selectedTable, status: 'occupied', currentOrder: { items: store.cart, orderType } });
  }

  await printReceiptHtml(renderKotHtml(kot, settings), `KOT - ${kot.id}`);
  showToast('Sent to kitchen 🍳', 'success');
  await refreshKotBadge();
  await renderOrderingView();
}

function renderKotHtml(kot, settings) {
  return `
    <div class="receipt">
      <div class="receipt-header">
        <div class="receipt-store-name">KITCHEN ORDER TICKET</div>
        <div class="receipt-row" style="font-size:11px; opacity:.7;">${new Date(kot.createdAt).toLocaleString()}</div>
      </div>
      <div class="receipt-divider"></div>
      <div style="font-size:14px; font-weight:800; text-align:center; margin:6px 0;">
        ${kot.orderType === 'dine-in' ? `TABLE: ${escapeHtml(kot.tableName || '')}` : (kot.orderType || '').toUpperCase()}
      </div>
      <div class="receipt-divider"></div>
      ${kot.items.map(i => `
        <div style="margin:8px 0;">
          <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:700;">
            <span>${escapeHtml(i.name)}</span><span>x${i.qty}</span>
          </div>
          ${(i.modifiers?.length || i.notes) ? `<div style="font-size:11px; opacity:.75; padding-left:8px;">${[...(i.modifiers || []), i.notes].filter(Boolean).map(escapeHtml).join(', ')}</div>` : ''}
        </div>
      `).join('')}
      <div class="receipt-divider"></div>
      <div style="text-align:center; font-size:10px; opacity:.6;">KOT #${kot.id}</div>
    </div>
  `;
}

// ── Bill Now — a small self-contained payment panel (no shared payment-modal
// component exists elsewhere in this codebase to reuse — see architecture
// notes) — then hands off to the SAME confirmOrder() POS.js/QuickPOS.js use. ──
function openPaymentPanel() {
  const settings = store.settings || {};
  const totals = getCartTotals();
  const cur = settings.currency || '₹';
  const methods = (settings.paymentMethods?.length ? settings.paymentMethods : ['Cash']);
  let rows = [{ method: methods[0], amount: totals.total }];

  const renderRows = () => {
    const sum = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const balance = Math.round((totals.total - sum) * 100) / 100;
    return `
      <div id="rposPayRows" style="display:flex; flex-direction:column; gap:8px;">
        ${rows.map((r, i) => `
          <div style="display:flex; gap:8px;">
            <select class="form-input rpos-pay-method" data-idx="${i}" style="flex:1;">
              ${methods.map(m => `<option value="${escapeHtml(m)}" ${r.method === m ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
            </select>
            <input type="number" class="form-input rpos-pay-amount" data-idx="${i}" value="${r.amount}" style="max-width:110px;" />
            ${rows.length > 1 ? `<button type="button" class="btn-icon rpos-pay-remove" data-idx="${i}"><i class="fa-solid fa-xmark" style="color:var(--danger);"></i></button>` : ''}
          </div>
        `).join('')}
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px;">
        <button type="button" class="btn btn-ghost btn-sm" id="rposAddSplitBtn"><i class="fa-solid fa-plus"></i> Add Split</button>
        <div style="font-size:12px; font-weight:700; color:${Math.abs(balance) < 0.01 ? 'var(--success)' : 'var(--danger)'};">
          Balance: ${cur}${balance.toFixed(2)}
        </div>
      </div>
    `;
  };

  openModal({
    title: `<i class="fa-solid fa-receipt mr-8"></i> Bill — ${cur}${totals.total.toFixed(2)}`,
    body: `<div id="rposPayBody">${renderRows()}</div>`,
    footer: `
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="rposConfirmBillBtn" style="min-width:140px;"><i class="fa-solid fa-check mr-4"></i> Complete Bill</button>
    `
  });

  const rebind = () => {
    const bodyEl = document.getElementById('rposPayBody');
    if (bodyEl) bodyEl.innerHTML = renderRows();
    document.querySelectorAll('.rpos-pay-method').forEach(el => el.addEventListener('change', e => { rows[+el.dataset.idx].method = e.target.value; }));
    document.querySelectorAll('.rpos-pay-amount').forEach(el => el.addEventListener('input', e => { rows[+el.dataset.idx].amount = Number(e.target.value) || 0; rebind(); }));
    document.querySelectorAll('.rpos-pay-remove').forEach(el => el.addEventListener('click', () => { rows.splice(+el.dataset.idx, 1); rebind(); }));
    document.getElementById('rposAddSplitBtn')?.addEventListener('click', () => {
      const sum = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
      const remaining = Math.max(0, Math.round((totals.total - sum) * 100) / 100);
      const usedMethods = rows.map(r => r.method);
      const nextMethod = methods.find(m => !usedMethods.includes(m)) || methods[0];
      rows.push({ method: nextMethod, amount: remaining });
      rebind();
    });
  };
  setTimeout(rebind, 50);

  document.getElementById('rposConfirmBillBtn')?.addEventListener('click', async () => {
    const sum = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    if (Math.abs(sum - totals.total) > 0.01) {
      return showToast('Payment amount must match the total.', 'error');
    }
    const payments = rows.filter(r => r.amount > 0).map(r => ({ method: r.method, amount: Number(r.amount) }));
    closeModal();
    await completeBill(payments);
  });
}

async function completeBill(payments) {
  const settings = store.settings || await getSettings();
  const cur = settings.currency || '₹';
  const restaurantMeta = { orderType, tableId: selectedTable?.id || null, tableName: selectedTable?.name || null };

  const succeeded = await confirmOrder(payments, getCartTotals(), settings, cur, { isCredit: false, creditInfo: '' }, restaurantMeta);
  if (!succeeded) return; // confirmOrder() already showed its own error toast

  if (orderType === 'dine-in' && selectedTable) {
    await saveTable({ ...selectedTable, status: 'free', currentOrder: null });
  }

  takeawayContact = { name: '', phone: '' };
  view = 'picker';
  orderType = null;
  selectedTable = null;
  await renderRestaurantPOS(document.getElementById('page-container'));
}

// ── Kitchen view — pending/preparing KOTs, advance status ─────────────────
async function renderKitchenView() {
  const area = document.getElementById('rposContent');
  if (!area) return;
  const kots = (await getKots()).filter(k => k.status !== 'served');

  area.innerHTML = `
    <h2 style="font-size:16px; font-weight:800; margin-bottom:16px;">🍳 Kitchen — ${kots.length} active ticket${kots.length === 1 ? '' : 's'}</h2>
    ${kots.length === 0 ? `
      <div class="card" style="padding:40px; text-align:center; color:var(--text-muted);">Nothing pending — all caught up 🎉</div>
    ` : `
      <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(260px,1fr)); gap:14px;">
        ${kots.map(k => `
          <div class="card" style="padding:16px; border-left:4px solid ${k.status === 'preparing' ? 'var(--warning)' : 'var(--primary)'};">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div style="font-weight:800; font-size:13px;">${k.orderType === 'dine-in' ? escapeHtml(k.tableName || 'Table') : (k.orderType || '').toUpperCase()}</div>
              <div style="font-size:10px; color:var(--text-muted);">${new Date(k.createdAt).toLocaleTimeString()}</div>
            </div>
            <div style="margin-top:10px; display:flex; flex-direction:column; gap:4px;">
              ${k.items.map(i => `<div style="font-size:12px;"><b>${i.qty}x</b> ${escapeHtml(i.name)}${(i.modifiers?.length || i.notes) ? `<div style="font-size:10.5px; color:var(--text-muted); padding-left:14px;">${[...(i.modifiers || []), i.notes].filter(Boolean).map(escapeHtml).join(', ')}</div>` : ''}</div>`).join('')}
            </div>
            <div style="margin-top:12px; display:flex; gap:8px;">
              ${k.status === 'pending' ? `<button class="btn btn-secondary btn-sm rpos-kot-advance" data-id="${k.id}" data-next="preparing" style="flex:1;">Start Preparing</button>` : ''}
              ${k.status === 'preparing' ? `<button class="btn btn-primary btn-sm rpos-kot-advance" data-id="${k.id}" data-next="served" style="flex:1;">Mark Served</button>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `}
  `;

  document.querySelectorAll('.rpos-kot-advance').forEach(el => {
    el.addEventListener('click', async () => {
      await updateKotStatus(el.dataset.id, el.dataset.next);
      await refreshKotBadge();
      await renderKitchenView();
    });
  });
}
