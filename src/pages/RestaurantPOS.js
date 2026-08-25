// ============================================================
// RestaurantPOS.js — Order-taking flow for a restaurant: pick an order type
// (Dine-in / Takeaway / Delivery), pick a table for dine-in, browse the menu,
// add items (with optional modifiers/notes/course), assign a waiter, send to
// the kitchen (KOT, whole order or course-by-course), preview or take a bill.
// Deliberately a NEW, separate page rather than a modification of
// POS.js/QuickPOS.js — it reuses their underlying plumbing (store.js's cart
// operations, CheckoutService.confirmOrder(), the print pipeline) but never
// touches their own files, so the existing retail flow is completely
// unaffected by anything here.
// ============================================================

import { getTables, saveTable, getCategories, getProducts, saveKot, getKots, updateKotStatus, getSettings, getCurrentBranch, getStaff } from '../db.js';
import { store, addToCart, removeFromCart, updateQty, updateCartItem, getCartTotals, onCartUpdate, loadTableOrderIntoCart, setStaff } from '../store.js';
import { confirmOrder, printReceiptHtml } from '../services/CheckoutService.js';
import { openModal, closeModal, showConfirm } from '../components/Modal.js';
import { showToast } from '../components/Toast.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { navigate } from '../router.js';
import { STATUS_META, visibleTables, tableDisplayName, tableDisplayCapacity, groupBySection, occupiedElapsedMs, formatElapsed, timerTier } from '../utils/tableDisplay.js';

// A fixed, common set of toggle-able modifiers — every menu item shares the
// same list rather than per-product-configured modifier groups. Simpler to
// build and to use at the counter; still covers the common "no onion / extra
// spicy / less sugar" customization requests a per-product config would.
const COMMON_MODIFIERS = ['No Onion', 'No Garlic', 'Extra Spicy', 'Less Spicy', 'Extra Cheese', 'Less Sugar', 'No Ice'];
const COURSES = ['Starters', 'Mains', 'Desserts', 'Other'];

let view = 'picker'; // 'picker' | 'ordering' | 'kitchen'
let orderType = null; // 'dine-in' | 'takeaway' | 'delivery'
let selectedTable = null; // full table doc, only for dine-in
let activeCategory = null;
let menuSearch = '';
let guestCount = null; // dine-in only
let voidLog = []; // {name, qty, reason, at, by} — audit trail for cancelled-after-fired items
let takeawayContact = { name: '', phone: '', address: '', pickupTime: '' };
let cartListenerRegistered = false;
let tablesTimerInterval = null;

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
      await enterTable(table);
    }
  } else {
    view = 'picker';
    orderType = null;
    selectedTable = null;
    guestCount = null;
    voidLog = [];
    setStaff(null);
  }

  await render(container);
}

async function enterTable(table) {
  selectedTable = table;
  orderType = 'dine-in';
  loadTableOrderIntoCart(table);
  if (table.currentOrder) {
    guestCount = table.currentOrder.guestCount || null;
    voidLog = table.currentOrder.voidLog || [];
    if (table.currentOrder.waiterId) {
      const waiter = (await getStaff()).find(s => s.id === table.currentOrder.waiterId);
      setStaff(waiter || null);
    } else {
      setStaff(null);
    }
  } else {
    voidLog = [];
    setStaff(null);
  }
  view = 'ordering';
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
    guestCount = null;
    voidLog = [];
    setStaff(null);
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
          guestCount = null;
          voidLog = [];
          loadTableOrderIntoCart(null);
          view = 'ordering';
          updateBackButtonLabel();
          await renderOrderingView();
        }
      });
    });
    return;
  }

  // orderType === 'dine-in', no table chosen yet — show the table grid,
  // grouped by section, with an occupied-timer badge on busy tables.
  const allTables = await getTables();
  const tables = visibleTables(allTables).sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true }));
  const grouped = groupBySection(tables);

  area.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
      <h2 style="font-size:16px; font-weight:800;">Select a Table</h2>
      <a href="#tables" style="font-size:12px; color:var(--primary); font-weight:700;"><i class="fa-solid fa-gear"></i> Manage Tables</a>
    </div>
    ${tables.length === 0 ? `
      <div class="card" style="padding:40px; text-align:center; color:var(--text-muted);">
        No tables set up yet. <a href="#tables" style="color:var(--primary); font-weight:700;">Add tables</a> to get started.
      </div>
    ` : grouped.map(({ section, tables: sectionTables }) => `
      <div style="margin-bottom:22px;">
        ${grouped.length > 1 ? `<div style="font-size:11px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:.5px; margin-bottom:10px;"><i class="fa-solid fa-layer-group" style="margin-right:6px; opacity:.5;"></i>${escapeHtml(section)}</div>` : ''}
        <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(160px,1fr)); gap:14px;">
          ${sectionTables.map(t => {
            const status = STATUS_META[t.status] || STATUS_META.free;
            const elapsed = t.status === 'occupied' ? occupiedElapsedMs(t) : null;
            return `
              <div class="rpos-table-card" data-id="${t.id}" style="background:${status.bg}; border:1px solid var(--border);">
                <div style="font-weight:800; font-size:15px;"><i class="fa-solid fa-chair" style="opacity:.4; margin-right:6px; font-size:12px;"></i>${escapeHtml(tableDisplayName(t, allTables))}</div>
                <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">Seats ${tableDisplayCapacity(t, allTables)}</div>
                <div style="display:flex; align-items:center; justify-content:space-between; margin-top:10px;">
                  <div style="font-size:11px; font-weight:700; color:${status.color};"><i class="fa-solid fa-circle" style="font-size:6px; margin-right:5px;"></i>${status.label}${t.status === 'occupied' && t.currentOrder?.items?.length ? ` · ${t.currentOrder.items.length} item(s)` : ''}</div>
                  ${elapsed !== null ? `<div class="rpos-table-timer" data-occupied-at="${t.occupiedAt}" style="font-size:11px; font-weight:800; color:${timerTier(elapsed).color};">${formatElapsed(elapsed)}</div>` : ''}
                </div>
                ${t.currentOrder?.guestCount ? `<div style="font-size:10.5px; color:var(--text-muted); margin-top:4px;"><i class="fa-solid fa-users" style="margin-right:4px; opacity:.5;"></i>${t.currentOrder.guestCount} guests</div>` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `).join('')}
  `;
  document.querySelectorAll('.rpos-table-card').forEach(el => {
    el.addEventListener('click', async () => {
      const table = tables.find(t => t.id === el.dataset.id);
      if (!table) return;
      if (table.currentOrder) {
        await enterTable(table);
        updateBackButtonLabel();
        await renderOrderingView();
      } else {
        // Fresh order on a free table — capture party size before landing on
        // the menu, matching how a host stand normally seats a table.
        promptGuestCount(async (count) => {
          await enterTable(table);
          guestCount = count; // fresh table has no currentOrder to read a guest count from
          updateBackButtonLabel();
          await renderOrderingView();
        });
      }
    });
  });
  startTablesTimerLoop();
}

function startTablesTimerLoop() {
  if (tablesTimerInterval) clearInterval(tablesTimerInterval);
  tablesTimerInterval = setInterval(() => {
    const area = document.getElementById('rposContent');
    if (!area) { clearInterval(tablesTimerInterval); tablesTimerInterval = null; return; }
    const timers = area.querySelectorAll('.rpos-table-timer');
    if (timers.length === 0) { clearInterval(tablesTimerInterval); tablesTimerInterval = null; return; }
    timers.forEach(el => {
      const occupiedAt = el.dataset.occupiedAt;
      if (!occupiedAt) return;
      const ms = Date.now() - new Date(occupiedAt).getTime();
      el.textContent = formatElapsed(ms);
      el.style.color = timerTier(ms).color;
    });
  }, 30000);
}

function promptGuestCount(onConfirm) {
  openModal({
    title: '<i class="fa-solid fa-users mr-8"></i> Party Size',
    body: `
      <div class="form-group">
        <label class="form-label">Number of guests</label>
        <input class="form-input" id="rposGuestCountInput" type="number" min="1" value="2" autofocus />
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="rposGuestCountConfirm">Start Order</button>
    `
  });
  setTimeout(() => {
    const input = document.getElementById('rposGuestCountInput');
    input?.focus(); input?.select();
    const confirm = () => {
      const count = Math.max(1, parseInt(input?.value, 10) || 1);
      closeModal();
      onConfirm(count);
    };
    document.getElementById('rposGuestCountConfirm')?.addEventListener('click', confirm);
    input?.addEventListener('keydown', e => { if (e.key === 'Enter') confirm(); });
  }, 50);
}

// ── Ordering view: menu + cart ────────────────────────────────────────────
async function renderOrderingView() {
  const area = document.getElementById('rposContent');
  if (!area) return;

  const settings = store.settings || await getSettings();
  const cur = settings.currency || '₹';
  const categories = await getCategories();
  const staffList = await getStaff();
  const allTables = orderType === 'dine-in' ? await getTables() : [];
  const tableLabel = selectedTable ? tableDisplayName(selectedTable, allTables) : null;
  const search = menuSearch.trim().toLowerCase();
  const products = (await getProducts()).filter(p => (!activeCategory || p.category === activeCategory) && (!search || (p.name || '').toLowerCase().includes(search)));
  const totals = getCartTotals();
  const unsent = store.cart.filter(i => !i.sentToKitchen);
  const coursesPresent = [...new Set(unsent.map(i => i.course).filter(Boolean))];

  area.innerHTML = `
    <div class="rpos-layout">
      <div>
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
          <div style="font-size:14px; font-weight:800; display:flex; align-items:center; gap:8px;">
            ${orderType === 'dine-in' ? `<i class="fa-solid fa-chair"></i> ${escapeHtml(tableLabel || 'Table')}` : orderType === 'takeaway' ? '<i class="fa-solid fa-bag-shopping"></i> Takeaway' : '<i class="fa-solid fa-motorcycle"></i> Delivery'}
            ${orderType === 'dine-in' ? `<button class="btn-icon" id="rposEditGuestsBtn" style="font-size:11px; font-weight:600; color:var(--text-muted);" title="Edit party size"><i class="fa-solid fa-users" style="margin-right:4px;"></i>${guestCount || '—'}<i class="fa-solid fa-pen" style="font-size:9px; margin-left:4px; opacity:.5;"></i></button>` : ''}
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
            <select class="form-input" id="rposWaiterSelect" style="max-width:150px; font-size:12px;">
              <option value="">Waiter (optional)</option>
              ${staffList.map(s => `<option value="${s.id}" ${store.selectedStaff?.id === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
            </select>
            ${orderType !== 'dine-in' ? `
              <input class="form-input" id="rposContactName" placeholder="Customer name" value="${escapeHtml(takeawayContact.name)}" style="max-width:140px; font-size:12px;" />
              <input class="form-input" id="rposContactPhone" placeholder="Phone" value="${escapeHtml(takeawayContact.phone)}" style="max-width:120px; font-size:12px;" />
              ${orderType === 'delivery' ? `<input class="form-input" id="rposContactAddress" placeholder="Delivery address" value="${escapeHtml(takeawayContact.address)}" style="max-width:200px; font-size:12px;" />` : ''}
              ${orderType === 'takeaway' ? `<input class="form-input" id="rposPickupTime" type="time" value="${escapeHtml(takeawayContact.pickupTime)}" title="Pickup time" style="max-width:110px; font-size:12px;" />` : ''}
            ` : ''}
          </div>
        </div>
        <div style="margin-bottom:12px;">
          <input class="form-input" id="rposMenuSearch" placeholder="🔍 Search menu…" value="${escapeHtml(menuSearch)}" style="font-size:13px;" />
        </div>
        <div style="display:flex; gap:8px; overflow-x:auto; padding-bottom:10px; margin-bottom:14px;">
          <div class="rpos-cat-tab ${!activeCategory ? 'active' : ''}" data-cat="">All</div>
          ${categories.map(c => `<div class="rpos-cat-tab ${activeCategory === c.name ? 'active' : ''}" data-cat="${escapeHtml(c.name)}">${escapeHtml(c.name)}</div>`).join('')}
        </div>
        <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(140px,1fr)); gap:12px;">
          ${products.length === 0 ? `<div style="grid-column:1/-1; text-align:center; padding:30px; color:var(--text-muted);">No items match</div>` : products.map(p => `
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
        <div style="max-height:36vh; overflow-y:auto;">
          ${store.cart.length === 0 ? `<div style="text-align:center; padding:24px; color:var(--text-muted); font-size:12px;">No items yet — tap a menu item to add it</div>` : store.cart.map(i => `
            <div class="rpos-cart-item">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                <div style="font-size:12.5px; font-weight:700; flex:1;">${escapeHtml(i.name)}</div>
                <button class="btn-icon rpos-remove-item" data-cart-id="${i.cartId}" title="Remove"><i class="fa-solid fa-xmark" style="font-size:11px; color:var(--danger);"></i></button>
              </div>
              ${(i.modifiers?.length || i.notes) ? `<div style="font-size:10.5px; color:var(--text-muted); margin-top:2px;">${[...(i.modifiers || []), i.notes].filter(Boolean).map(escapeHtml).join(' · ')}</div>` : ''}
              <div style="display:flex; align-items:center; justify-content:space-between; margin-top:6px; flex-wrap:wrap; gap:6px;">
                ${i.sentToKitchen ? `
                  <div style="font-size:10px; font-weight:700; color:var(--success);"><i class="fa-solid fa-check"></i> Sent to kitchen${i.course ? ` · ${escapeHtml(i.course)}` : ''} · x${i.qty}</div>
                ` : `
                  <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                    <button class="btn-icon rpos-qty-minus" data-cart-id="${i.cartId}"><i class="fa-solid fa-minus" style="font-size:10px;"></i></button>
                    <span style="font-size:12px; font-weight:700; min-width:18px; text-align:center;">${i.qty}</span>
                    <button class="btn-icon rpos-qty-plus" data-cart-id="${i.cartId}"><i class="fa-solid fa-plus" style="font-size:10px;"></i></button>
                    <button class="btn-icon rpos-customize-item" data-cart-id="${i.cartId}" title="Customize"><i class="fa-solid fa-sliders" style="font-size:10px;"></i></button>
                    <select class="form-input rpos-course-select" data-cart-id="${i.cartId}" style="font-size:10px; padding:2px 4px; max-width:82px;">
                      <option value="">Course</option>
                      ${COURSES.map(c => `<option value="${c}" ${i.course === c ? 'selected' : ''}>${c}</option>`).join('')}
                    </select>
                  </div>
                `}
                <div style="font-size:12px; font-weight:800;">${cur}${(i.price * i.qty).toFixed(2)}</div>
              </div>
            </div>
          `).join('')}
        </div>
        <div style="border-top:1px solid var(--border); margin-top:12px; padding-top:10px; display:flex; flex-direction:column; gap:4px; font-size:12px;">
          <div style="display:flex; justify-content:space-between; color:var(--text-muted);"><span>Subtotal</span><span>${cur}${totals.subtotal.toFixed(2)}</span></div>
          ${totals.discount > 0 ? `<div style="display:flex; justify-content:space-between; color:var(--success);"><span>Discount</span><span>-${cur}${totals.discount.toFixed(2)}</span></div>` : ''}
          <div style="display:flex; justify-content:space-between; color:var(--text-muted);"><span>Tax</span><span>${cur}${(totals.itemTax + totals.orderTax).toFixed(2)}</span></div>
          ${totals.roundOff ? `<div style="display:flex; justify-content:space-between; color:var(--text-muted);"><span>Round Off</span><span>${totals.roundOff > 0 ? '+' : ''}${cur}${totals.roundOff.toFixed(2)}</span></div>` : ''}
          <div style="display:flex; justify-content:space-between; font-size:15px; font-weight:800; margin-top:4px; padding-top:6px; border-top:1px solid var(--border);"><span>Total</span><span>${cur}${totals.total.toFixed(2)}</span></div>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px; margin-top:14px;">
          ${renderSendControls(unsent, coursesPresent)}
          <button class="btn btn-ghost" id="rposPreviewBillBtn" ${store.cart.length === 0 ? 'disabled' : ''}><i class="fa-solid fa-print"></i> Preview Bill</button>
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
      if (!product) return;
      addToCart(product);
      // If this line had already been fired to the kitchen, adding more of
      // it "un-fires" the whole line again — the kitchen needs to know
      // about the extra quantity, so it goes out on the next Send.
      const cartId = variantCartId(product);
      const item = store.cart.find(i => i.cartId === cartId);
      if (item?.sentToKitchen) { item.sentToKitchen = false; await renderOrderingView(); }
    });
  });
  document.querySelectorAll('.rpos-remove-item').forEach(el => el.addEventListener('click', () => requestRemoveItem(el.dataset.cartId)));
  document.querySelectorAll('.rpos-qty-plus').forEach(el => el.addEventListener('click', () => updateQty(el.dataset.cartId, 1)));
  document.querySelectorAll('.rpos-qty-minus').forEach(el => el.addEventListener('click', () => requestQtyMinus(el.dataset.cartId)));
  document.querySelectorAll('.rpos-customize-item').forEach(el => el.addEventListener('click', () => openModifierModal(el.dataset.cartId)));
  document.querySelectorAll('.rpos-course-select').forEach(el => el.addEventListener('change', e => { updateCartItem(el.dataset.cartId, { course: e.target.value || null }); }));
  document.querySelectorAll('.rpos-send-course').forEach(el => el.addEventListener('click', () => sendToKitchen(el.dataset.course || null)));

  document.getElementById('rposMenuSearch')?.addEventListener('input', async e => {
    menuSearch = e.target.value;
    await renderOrderingView();
    const el = document.getElementById('rposMenuSearch');
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  });
  document.getElementById('rposWaiterSelect')?.addEventListener('change', e => {
    const staff = staffList.find(s => s.id === e.target.value);
    setStaff(staff || null);
  });
  document.getElementById('rposEditGuestsBtn')?.addEventListener('click', () => {
    promptGuestCount(async (count) => {
      guestCount = count;
      await persistOrderStateIfDineIn();
      await renderOrderingView();
    });
  });
  document.getElementById('rposContactName')?.addEventListener('input', e => { takeawayContact.name = e.target.value; });
  document.getElementById('rposContactPhone')?.addEventListener('input', e => { takeawayContact.phone = e.target.value; });
  document.getElementById('rposContactAddress')?.addEventListener('input', e => { takeawayContact.address = e.target.value; });
  document.getElementById('rposPickupTime')?.addEventListener('input', e => { takeawayContact.pickupTime = e.target.value; });

  document.getElementById('rposPreviewBillBtn')?.addEventListener('click', previewBill);
  document.getElementById('rposBillBtn')?.addEventListener('click', openPaymentPanel);
}

function variantCartId(product, variant = null) {
  return variant ? `${product.id}_${variant.name}` : String(product.id);
}

// Multiple courses are only worth surfacing once staff actually start using
// them (per-item Course pickers) — until then this stays the plain single
// "Send to Kitchen" button so a shop that doesn't care about courses sees no
// extra complexity.
function renderSendControls(unsent, coursesPresent) {
  if (unsent.length === 0) {
    return store.cart.length === 0 ? '' : `<button class="btn btn-secondary" disabled><i class="fa-solid fa-check"></i> All Sent to Kitchen</button>`;
  }
  if (coursesPresent.length === 0) {
    return `<button class="btn btn-secondary rpos-send-course" data-course=""><i class="fa-solid fa-kitchen-set"></i> Send to Kitchen (${unsent.length})</button>`;
  }
  return `
    <div style="display:flex; gap:6px; flex-wrap:wrap;">
      <button class="btn btn-secondary btn-sm rpos-send-course" data-course="" style="flex:1 1 100%;"><i class="fa-solid fa-kitchen-set"></i> Send All Pending (${unsent.length})</button>
      ${coursesPresent.map(c => `<button class="btn btn-ghost btn-sm rpos-send-course" data-course="${escapeHtml(c)}" style="flex:1;">${escapeHtml(c)} (${unsent.filter(i => i.course === c).length})</button>`).join('')}
    </div>
  `;
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

// ── Void / cancel with mandatory reason (only enforced once an item has
// actually been fired to the kitchen — cancelling something that never left
// the cart has no kitchen/food-cost impact, so no audit friction there). ──
function promptVoidReason(item, onConfirm) {
  openModal({
    title: `<i class="fa-solid fa-triangle-exclamation mr-8" style="color:var(--danger);"></i> Cancel Item`,
    body: `
      <div style="font-size:12px; color:var(--text-muted); margin-bottom:10px;"><b>${escapeHtml(item.name)}</b> was already sent to the kitchen. Please note why it's being cancelled — this is kept on the order record.</div>
      <div class="form-group">
        <label class="form-label required">Reason</label>
        <textarea class="form-input" id="rposVoidReason" rows="2" placeholder="e.g. Customer changed mind, wrong item sent..." autofocus></textarea>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" onclick="closeModal()">Keep Item</button>
      <button class="btn btn-danger" id="rposVoidConfirmBtn"><i class="fa-solid fa-trash mr-4"></i> Cancel Item</button>
    `
  });
  setTimeout(() => {
    const reasonInput = document.getElementById('rposVoidReason');
    reasonInput?.focus();
    document.getElementById('rposVoidConfirmBtn')?.addEventListener('click', () => {
      const reason = reasonInput?.value.trim();
      if (!reason) return showToast('Please enter a reason', 'error');
      closeModal();
      onConfirm(reason);
    });
  }, 50);
}

function logVoid(item, reason) {
  voidLog.push({ name: item.name, qty: item.qty, reason, at: new Date().toISOString(), by: store.user?.name || store.user?.username || '' });
}

function requestRemoveItem(cartId) {
  const item = store.cart.find(i => i.cartId === cartId);
  if (!item) return;
  if (item.sentToKitchen) {
    promptVoidReason(item, async (reason) => {
      logVoid(item, reason);
      removeFromCart(cartId);
      await persistOrderStateIfDineIn();
    });
  } else {
    removeFromCart(cartId);
  }
}

function requestQtyMinus(cartId) {
  const item = store.cart.find(i => i.cartId === cartId);
  if (!item) return;
  if (item.sentToKitchen && item.qty <= 1) {
    promptVoidReason(item, async (reason) => {
      logVoid(item, reason);
      await updateQty(cartId, -1);
      await persistOrderStateIfDineIn();
    });
  } else {
    updateQty(cartId, -1);
  }
}

async function persistOrderStateIfDineIn() {
  if (orderType === 'dine-in' && selectedTable) {
    selectedTable = await saveTable({
      ...selectedTable,
      currentOrder: { ...(selectedTable.currentOrder || {}), items: store.cart, orderType, guestCount, voidLog, waiterId: store.selectedStaff?.id || null, waiterName: store.selectedStaff?.name || null }
    });
  }
}

// ── Send to Kitchen — optionally scoped to one course, so Starters can go
// out well ahead of Mains instead of the whole order firing at once. ──────
async function sendToKitchen(courseFilter = null) {
  const unsent = store.cart.filter(i => !i.sentToKitchen && (!courseFilter || i.course === courseFilter));
  if (unsent.length === 0) return;
  const branchId = store.branch?.id || (await getCurrentBranch())?.id || 'b1';
  const settings = store.settings || await getSettings();

  const kot = await saveKot({
    tableId: selectedTable?.id || null,
    tableName: selectedTable?.name || null,
    orderType,
    course: courseFilter || null,
    contactName: takeawayContact.name || '',
    waiterName: store.selectedStaff?.name || null,
    items: unsent.map(i => ({ name: i.name, qty: i.qty, modifiers: i.modifiers || [], notes: i.notes || '', course: i.course || null })),
    branchId,
  });

  unsent.forEach(i => { i.sentToKitchen = true; });

  if (orderType === 'dine-in' && selectedTable) {
    selectedTable = await saveTable({
      ...selectedTable,
      status: 'occupied',
      occupiedAt: selectedTable.occupiedAt || new Date().toISOString(),
      currentOrder: { items: store.cart, orderType, guestCount, voidLog, waiterId: store.selectedStaff?.id || null, waiterName: store.selectedStaff?.name || null }
    });
  }

  await printReceiptHtml(renderKotHtml(kot, settings), `KOT - ${kot.id}`);
  showToast(`Sent to kitchen 🍳${courseFilter ? ` — ${courseFilter}` : ''}`, 'success');
  await refreshKotBadge();
  await renderOrderingView();
}

function renderKotHtml(kot, settings) {
  return `
    <div class="receipt">
      <div class="receipt-header">
        <div class="receipt-store-name">KITCHEN ORDER TICKET${kot.course ? ` — ${escapeHtml(kot.course.toUpperCase())}` : ''}</div>
        <div class="receipt-row" style="font-size:11px; opacity:.7;">${new Date(kot.createdAt).toLocaleString()}</div>
      </div>
      <div class="receipt-divider"></div>
      <div style="font-size:14px; font-weight:800; text-align:center; margin:6px 0;">
        ${kot.orderType === 'dine-in' ? `TABLE: ${escapeHtml(kot.tableName || '')}` : (kot.orderType || '').toUpperCase()}
      </div>
      ${kot.waiterName ? `<div style="text-align:center; font-size:11px; opacity:.75;">Waiter: ${escapeHtml(kot.waiterName)}</div>` : ''}
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

// ── Bill Preview — a proforma print with no payment collection and no order
// saved, so the customer can review the bill before it's finalized. ──────
async function previewBill() {
  if (store.cart.length === 0) return;
  const settings = store.settings || await getSettings();
  const cur = settings.currency || '₹';
  const totals = getCartTotals();
  const allTables = orderType === 'dine-in' ? await getTables() : [];
  const tableLabel = selectedTable ? tableDisplayName(selectedTable, allTables) : null;
  await printReceiptHtml(renderProformaHtml(totals, settings, cur, tableLabel), 'Bill Preview');
}

function renderProformaHtml(totals, settings, cur, tableLabel) {
  return `
    <div class="receipt">
      <div class="receipt-header">
        <div class="receipt-store-name">${escapeHtml(settings.storeName || 'Bill Preview')}</div>
        <div class="receipt-row" style="font-size:11px; opacity:.7;">${new Date().toLocaleString()}</div>
      </div>
      <div style="text-align:center; font-size:11px; font-weight:800; letter-spacing:.5px; margin:6px 0;">PROFORMA — NOT A TAX INVOICE</div>
      <div class="receipt-divider"></div>
      <div style="font-size:12px; font-weight:700; text-align:center;">
        ${orderType === 'dine-in' ? escapeHtml(tableLabel || 'Table') : (orderType || '').toUpperCase()}${guestCount ? ` · ${guestCount} guests` : ''}
      </div>
      <div class="receipt-divider"></div>
      ${store.cart.map(i => `
        <div style="display:flex; justify-content:space-between; font-size:12px; margin:4px 0;">
          <span>${escapeHtml(i.name)} x${i.qty}</span><span>${cur}${(i.price * i.qty).toFixed(2)}</span>
        </div>
      `).join('')}
      <div class="receipt-divider"></div>
      <div style="display:flex; justify-content:space-between; font-size:12px;"><span>Subtotal</span><span>${cur}${totals.subtotal.toFixed(2)}</span></div>
      ${totals.discount > 0 ? `<div style="display:flex; justify-content:space-between; font-size:12px;"><span>Discount</span><span>-${cur}${totals.discount.toFixed(2)}</span></div>` : ''}
      <div style="display:flex; justify-content:space-between; font-size:12px;"><span>Tax</span><span>${cur}${(totals.itemTax + totals.orderTax).toFixed(2)}</span></div>
      <div class="receipt-divider"></div>
      <div style="display:flex; justify-content:space-between; font-size:14px; font-weight:800;"><span>Total</span><span>${cur}${totals.total.toFixed(2)}</span></div>
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
  const allTables = orderType === 'dine-in' ? await getTables() : [];
  const tableLabel = selectedTable ? tableDisplayName(selectedTable, allTables) : null;
  const restaurantMeta = {
    orderType,
    tableId: selectedTable?.id || null,
    tableName: tableLabel,
    guestCount: guestCount || null,
    contactName: takeawayContact.name || undefined,
    contactPhone: takeawayContact.phone || undefined,
    deliveryAddress: orderType === 'delivery' ? (takeawayContact.address || undefined) : undefined,
    pickupTime: orderType === 'takeaway' ? (takeawayContact.pickupTime || undefined) : undefined,
    voidLog: voidLog.length ? voidLog : undefined,
  };

  const succeeded = await confirmOrder(payments, getCartTotals(), settings, cur, { isCredit: false, creditInfo: '' }, restaurantMeta);
  if (!succeeded) return; // confirmOrder() already showed its own error toast

  if (orderType === 'dine-in' && selectedTable) {
    // Billing ends the dine-in session for every table involved, including
    // any merged into this one — all of them go back to free together.
    const freedIds = [selectedTable.id, ...(selectedTable.mergedTableIds || [])];
    for (const id of freedIds) {
      const t = allTables.find(x => x.id === id) || (id === selectedTable.id ? selectedTable : null);
      if (t) await saveTable({ ...t, status: 'free', occupiedAt: null, currentOrder: null, mergedTableIds: [], mergedInto: null });
    }
  }

  takeawayContact = { name: '', phone: '', address: '', pickupTime: '' };
  view = 'picker';
  orderType = null;
  selectedTable = null;
  guestCount = null;
  voidLog = [];
  setStaff(null);
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
              <div style="font-weight:800; font-size:13px;">${k.orderType === 'dine-in' ? escapeHtml(k.tableName || 'Table') : (k.orderType || '').toUpperCase()}${k.course ? ` · ${escapeHtml(k.course)}` : ''}</div>
              <div style="font-size:10px; color:var(--text-muted);">${new Date(k.createdAt).toLocaleTimeString()}</div>
            </div>
            ${k.waiterName ? `<div style="font-size:10.5px; color:var(--text-muted); margin-top:2px;"><i class="fa-solid fa-user" style="margin-right:4px; opacity:.5;"></i>${escapeHtml(k.waiterName)}</div>` : ''}
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
