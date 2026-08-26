// ============================================================
// RestaurantPOS.js — Order-taking flow for a restaurant: pick an order type
// (Dine-in / Takeaway / Delivery), pick a table for dine-in, browse the menu,
// add items (with optional modifiers/notes/course), assign a waiter, send to
// the kitchen (KOT, whole order or course-by-course), preview or take a bill.
// The Kitchen prep board itself lives in its own page (Kitchen.js) — this
// file only reads live per-item kitchen status to gate billing and to offer
// cancel/modify on already-sent items.
//
// A physical table can host more than one independent party at once (table
// SHARING — a 4-seat table can have a 2-guest box and, once seated, a
// second 2-guest box, each its own order and bill) — so a dine-in "order in
// progress" is really the exact same CounterOrder concept takeaway/delivery
// already uses, just with a `tableId` attached. There is no more
// table.currentOrder — a table's occupancy/seat usage is always derived
// live from whichever CounterOrder docs reference it (see
// utils/tableDisplay.js's tableOccupancy()), never stored on the table
// itself, so it can never drift out of sync with reality.
//
// Deliberately a NEW, separate page rather than a modification of
// POS.js/QuickPOS.js — it reuses their underlying plumbing (store.js's cart
// operations, CheckoutService.confirmOrder(), the print pipeline) but never
// touches their own files, so the existing retail flow is completely
// unaffected by anything here.
// ============================================================

import { getTables, getCategories, getProducts, saveKot, getKots, getSettings, getCurrentBranch, getStaff, getCounterOrders, saveCounterOrder, deleteCounterOrder } from '../db.js';
import { store, addToCart, removeFromCart, updateQty, updateCartItem, getCartTotals, onCartUpdate, loadTableOrderIntoCart, setStaff } from '../store.js';
import { confirmOrder, printReceiptHtml } from '../services/CheckoutService.js';
import { openModal, closeModal, showConfirm } from '../components/Modal.js';
import { showToast } from '../components/Toast.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { navigate } from '../router.js';
import { STATUS_META, visibleTables, tableDisplayName, tableDisplayCapacity, groupBySection, tableOccupancy, formatElapsed, timerTier } from '../utils/tableDisplay.js';

// A fixed, common set of toggle-able modifiers — every menu item shares the
// same list rather than per-product-configured modifier groups. Simpler to
// build and to use at the counter; still covers the common "no onion / extra
// spicy / less sugar" customization requests a per-product config would.
const COMMON_MODIFIERS = ['No Onion', 'No Garlic', 'Extra Spicy', 'Less Spicy', 'Extra Cheese', 'Less Sugar', 'No Ice'];
const COURSES = ['Starters', 'Mains', 'Desserts', 'Other'];

const KITCHEN_ITEM_META = {
  pending: { label: 'In kitchen queue', icon: 'fa-hourglass-half', color: 'var(--text-muted)' },
  ready: { label: 'Ready — pickup!', icon: 'fa-bell', color: 'var(--success)' },
  served: { label: 'Served', icon: 'fa-check-double', color: 'var(--primary)' },
  // A "sent" item that genuinely has no matching KOT entry anywhere — should
  // never happen if sendToKitchen() and Kitchen.js stay in sync, but if it
  // ever does, this makes the mismatch visible and one-click recoverable
  // (Resend) instead of silently looking like a normal queued item forever
  // while actually blocking Bill Now for a ticket the kitchen never sees.
  not_found: { label: 'Not showing in Kitchen — resend', icon: 'fa-triangle-exclamation', color: 'var(--danger)' },
};

let view = 'picker'; // 'picker' | 'ordering'
let orderType = null; // 'dine-in' | 'takeaway' | 'delivery'
let selectedTable = null; // full table doc — dine-in only, purely for capacity/name/section, never holds order data itself
let drillTable = null; // dine-in only — a table whose box picker is currently showing (null = show the full table grid instead)
let selectedCounterOrder = null; // the ACTUAL in-progress order for every order type now — a dine-in "box", a takeaway order, or a delivery order all live here
let activeCategory = null;
let menuSearch = '';
let guestCount = null; // dine-in only
let changeLog = []; // {type:'cancel'|'modify', name, qty, reason, at, by} — audit trail for anything edited after being fired to the kitchen
let orderSessionId = null; // ties every KOT sent during this one order together — always the current order's own persisted id, deterministic
let takeawayContact = { name: '', phone: '', address: '', pickupTime: '' };
let cartListenerRegistered = false;
let tablesTimerInterval = null;
let counterOrdersTimerInterval = null;

function backButtonLabel() {
  if (view === 'picker') return 'Dashboard';
  return orderType === 'dine-in' ? 'Change Table' : 'Change Order';
}

// A takeaway/delivery order's display name — the contact name once given,
// otherwise a stable per-type number assigned when it was created.
function counterOrderLabel(order) {
  if (order.contactName) return order.contactName;
  return `${order.orderType === 'delivery' ? 'Delivery' : 'Takeaway'} #${order.orderNumber || '?'}`;
}

// The current order's display label, for KOTs/receipts/the ordering-view
// header — a table name (plus "Box N" once that table has more than one
// party sharing it) for dine-in, or the counter-order label otherwise. This
// is what lets Kitchen.js and printed tickets tell two boxes on the same
// table, or two simultaneous takeaway orders, apart.
function currentOrderLabel(allTables) {
  if (selectedTable) {
    const base = tableDisplayName(selectedTable, allTables);
    return selectedCounterOrder?.partyNumber ? `${base} · Box ${selectedCounterOrder.partyNumber}` : base;
  }
  return selectedCounterOrder ? counterOrderLabel(selectedCounterOrder) : null;
}

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
    // Came from Tables.js's own table click — jump straight into that
    // table's box picker (or a fresh box if it's empty), re-reading live
    // occupancy rather than trusting anything the caller already had.
    const table = (await getTables()).find(t => t.id === subPage);
    if (table) {
      orderType = 'dine-in';
      await openTable(table);
    }
  } else {
    // Every order type persists its own resumable record now — a table's
    // box is just a CounterOrder with a tableId, exactly like a takeaway/
    // delivery order — so a plain nav into this page can always safely
    // reset to the picker. Anything genuinely in progress is sitting right
    // there to resume, never silently thrown away just because the cashier
    // stepped away to check Kitchen and came back.
    view = 'picker';
    orderType = null;
    selectedTable = null;
    drillTable = null;
    selectedCounterOrder = null;
    guestCount = null;
    changeLog = [];
    orderSessionId = null;
    setStaff(null);
  }

  await render(container);
}

// A cart item saved by a build before per-quantity sent-tracking existed
// only has the old `sentToKitchen` boolean — treat that as "the whole
// current quantity was already sent" so an order resumed mid-flight on this
// build doesn't suddenly think everything needs re-sending.
function migrateLegacySentFlags() {
  store.cart.forEach(i => {
    if (i.sentQty === undefined && i.sentToKitchen) i.sentQty = i.qty;
  });
}

// Resume an existing order — a dine-in box (pass `table`) or a takeaway/
// delivery order (leave `table` null). orderSessionId is the order's own
// id, always, so it can never drift from what its KOTs were saved with.
async function enterCounterOrder(order, table = null) {
  selectedCounterOrder = order;
  selectedTable = table;
  orderType = order.orderType;
  orderSessionId = order.id;
  guestCount = order.guestCount || null;
  takeawayContact = {
    name: order.contactName || '',
    phone: order.contactPhone || '',
    address: order.deliveryAddress || '',
    pickupTime: order.pickupTime || '',
  };
  changeLog = order.changeLog || [];
  loadTableOrderIntoCart(order.items?.length ? { currentOrder: { items: order.items } } : null);
  migrateLegacySentFlags();
  if (order.waiterId) {
    const waiter = (await getStaff()).find(s => s.id === order.waiterId);
    setStaff(waiter || null);
  } else {
    setStaff(null);
  }
  view = 'ordering';
}

// Creates a brand-new takeaway/delivery order slot and enters it. orderNumber
// is just a display label (see counterOrderLabel()), never used to identify
// the order itself — only `id` is.
async function startNewCounterOrder(type) {
  const existing = await getCounterOrders();
  const orderNumber = existing.filter(o => o.orderType === type).length + 1;
  const order = await saveCounterOrder({ orderType: type, orderNumber, items: [], contactName: '', contactPhone: '', deliveryAddress: '', pickupTime: '', changeLog: [] });
  await enterCounterOrder(order);
}

// Creates a brand-new dine-in box on `table` and enters it. partyNumber is
// scoped per table (1 for the table's first box, 2 for its second, …) —
// again just a display label, stamped onto every KOT this box sends so
// Kitchen.js and printed tickets can tell two boxes on the same table apart.
async function startNewParty(table, count) {
  const existingAtTable = (await getCounterOrders()).filter(o => o.tableId === table.id);
  const partyNumber = existingAtTable.length + 1;
  const order = await saveCounterOrder({ orderType: 'dine-in', tableId: table.id, partyNumber, guestCount: count, items: [], changeLog: [] });
  await enterCounterOrder(order, table);
}

// Clicking a table from the grid — jump straight to a fresh box if it's
// currently empty (matching how a host stand normally seats a table with
// no extra friction), otherwise show its box picker so an existing party
// can be resumed or a new one added within the remaining capacity.
async function openTable(table) {
  const allTables = await getTables();
  const capacity = tableDisplayCapacity(table, allTables);
  const parties = (await getCounterOrders()).filter(o => o.tableId === table.id);
  if (parties.length === 0) {
    promptGuestCount(async (count) => {
      await startNewParty(table, count);
      updateBackButtonLabel();
      await renderOrderingView();
    }, capacity);
    return;
  }
  drillTable = table;
  view = 'picker';
}

// Sub-view handlers that switch `view` and re-render only their own
// #rposContent (renderPickerView() picking an order type, etc.) call this
// afterward so the topbar's Back-button label stays correct without needing
// a full shell re-render (which would also needlessly re-fetch the KOT
// badge count).
function updateBackButtonLabel() {
  const btn = document.getElementById('rposBackBtn');
  if (btn) btn.innerHTML = `<i class="fa-solid fa-arrow-left"></i> ${backButtonLabel()}`;
}

async function render(container) {
  container.innerHTML = `
    <div class="rpos-shell">
      <div class="rpos-topbar">
        <button class="btn btn-ghost btn-sm" id="rposBackBtn"><i class="fa-solid fa-arrow-left"></i> ${backButtonLabel()}</button>
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
      .rpos-add-party-card { cursor:pointer; transition:all .15s; }
      .rpos-add-party-card:hover { border-color:var(--primary); transform:translateY(-2px); }
      .rpos-layout { display:grid; grid-template-columns: 1fr 380px; gap:16px; height:100%; align-items:start; }
      @media (max-width: 900px) { .rpos-layout { grid-template-columns: 1fr; } }
      .rpos-cat-tab { padding:8px 16px; border-radius:999px; border:1px solid var(--border); background:var(--bg-elevated); cursor:pointer; font-size:12px; font-weight:700; white-space:nowrap; }
      .rpos-cat-tab.active { background:var(--primary); color:white; border-color:var(--primary); }
      .rpos-product-card { padding:14px; border-radius:12px; border:1px solid var(--border); background:var(--bg-elevated); cursor:pointer; transition:all .15s; }
      .rpos-product-card:hover { border-color:var(--primary); transform:translateY(-2px); }
      .rpos-cart-item { padding:10px 0; border-bottom:1px solid var(--border); }
      .rpos-kot-badge { display:inline-block; min-width:16px; padding:1px 5px; border-radius:999px; background:var(--danger); color:white; font-size:10px; font-weight:800; margin-left:4px; }
      /* A billed box gets a little green "confirmed" pop, then fades and
         shrinks away in place — so completing ONE box on a shared table
         reads as that one box being done, not the whole screen just
         changing under the cashier with no acknowledgement. */
      @keyframes rposBoxBilled {
        0%   { opacity:1; transform:scale(1); box-shadow:0 0 0 0 rgba(34,197,94,0); }
        18%  { transform:scale(1.035); box-shadow:0 0 0 4px rgba(34,197,94,0.35); }
        45%  { opacity:1; transform:scale(1.01); box-shadow:0 0 0 4px rgba(34,197,94,0.15); }
        100% { opacity:0; transform:scale(0.82) translateY(10px); box-shadow:0 0 0 0 rgba(34,197,94,0); }
      }
      .rpos-box-exit { animation:rposBoxBilled 620ms cubic-bezier(.4,0,.2,1) forwards; pointer-events:none; }
      @keyframes rposBoxEnter { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
      .rpos-box-enter { animation:rposBoxEnter 240ms ease; }
    </style>
  `;

  document.getElementById('rposBackBtn')?.addEventListener('click', handleBack);
  document.getElementById('rposKitchenBtn')?.addEventListener('click', () => navigate('kitchen'));
  await refreshKotBadge();

  if (view === 'picker') await renderPickerView();
  else if (view === 'ordering') await renderOrderingView();
}

async function refreshKotBadge() {
  const badge = document.getElementById('rposKotBadge');
  if (!badge) return;
  const pending = (await getKots()).filter(k => k.status !== 'served');
  badge.innerHTML = pending.length > 0 ? `<span class="rpos-kot-badge">${pending.length}</span>` : '';
}

function handleBack() {
  const container = document.getElementById('page-container');
  if (view === 'ordering') {
    if (orderType === 'dine-in' && selectedTable) {
      // Step back to THIS table's box picker, not the whole table grid —
      // there's likely another box (or a free seat) at the same table.
      drillTable = selectedTable;
      view = 'picker';
      selectedCounterOrder = null;
      guestCount = null;
      changeLog = [];
      orderSessionId = null;
      setStaff(null);
      return render(container);
    }
    // Every order type persists its own record now — stepping back never
    // loses anything, it's one click away again from the picker.
    view = 'picker';
    orderType = null;
    selectedTable = null;
    drillTable = null;
    selectedCounterOrder = null;
    guestCount = null;
    changeLog = [];
    orderSessionId = null;
    setStaff(null);
    return render(container);
  }
  navigate('dashboard');
}

// ── Picker view: order type, then (for dine-in) the table grid or a table's
// own box picker — for takeaway/delivery, the list of open orders. ────────
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
        await renderPickerView();
      });
    });
    return;
  }

  if (orderType !== 'dine-in') {
    // Takeaway/delivery — a list of whatever's already open (so more than
    // one can be handled at once, each billed independently) plus a way to
    // start a brand-new one.
    await renderCounterOrderPicker();
    return;
  }

  if (drillTable) {
    await renderTablePartyPicker(drillTable);
    return;
  }

  // orderType === 'dine-in', no table drilled into yet — show the table
  // grid, grouped by section, occupancy derived live from open boxes.
  const allTables = await getTables();
  const tables = visibleTables(allTables).sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true }));
  const grouped = groupBySection(tables);
  const allParties = (await getCounterOrders()).filter(o => o.orderType === 'dine-in');

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
            const occ = tableOccupancy(t, allParties);
            const status = occ.isOccupied ? STATUS_META.occupied : STATUS_META.free;
            const elapsed = occ.oldestCreatedAt ? Date.now() - new Date(occ.oldestCreatedAt).getTime() : null;
            const capacity = tableDisplayCapacity(t, allTables);
            return `
              <div class="rpos-table-card" data-id="${t.id}" style="background:${status.bg}; border:1px solid var(--border);">
                <div style="font-weight:800; font-size:15px;"><i class="fa-solid fa-chair" style="opacity:.4; margin-right:6px; font-size:12px;"></i>${escapeHtml(tableDisplayName(t, allTables))}</div>
                <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">Seats ${capacity}</div>
                <div style="display:flex; align-items:center; justify-content:space-between; margin-top:10px;">
                  <div style="font-size:11px; font-weight:700; color:${status.color};"><i class="fa-solid fa-circle" style="font-size:6px; margin-right:5px;"></i>${occ.isOccupied ? `${occ.usedSeats}/${capacity} seated${occ.partyCount > 1 ? ` · ${occ.partyCount} boxes` : ''}` : status.label}</div>
                  ${elapsed !== null ? `<div class="rpos-table-timer" data-created-at="${occ.oldestCreatedAt}" style="font-size:11px; font-weight:800; color:${timerTier(elapsed).color};">${formatElapsed(elapsed)}</div>` : ''}
                </div>
                ${occ.totalItems > 0 ? `<div style="font-size:10.5px; color:var(--text-muted); margin-top:4px;">${occ.totalItems} item(s)</div>` : ''}
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
      await openTable(table);
      updateBackButtonLabel();
      if (view === 'ordering') await renderOrderingView();
      else await renderPickerView();
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
      const createdAt = el.dataset.createdAt;
      if (!createdAt) return;
      const ms = Date.now() - new Date(createdAt).getTime();
      el.textContent = formatElapsed(ms);
      el.style.color = timerTier(ms).color;
    });
  }, 30000);
}

// ── A single table's box picker — every independent party currently seated
// there, each its own resumable order, plus "+ Add Party" while seats
// remain within the table's (or merged group's) total capacity. ──────────
async function renderTablePartyPicker(table) {
  const area = document.getElementById('rposContent');
  if (!area) return;
  const allTables = await getTables();
  const capacity = tableDisplayCapacity(table, allTables);
  const parties = (await getCounterOrders()).filter(o => o.tableId === table.id).sort((a, b) => (a.partyNumber || 0) - (b.partyNumber || 0));
  const usedSeats = parties.reduce((s, p) => s + (p.guestCount || 0), 0);
  const remaining = Math.max(0, capacity - usedSeats);

  area.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; flex-wrap:wrap; gap:10px;">
      <h2 style="font-size:16px; font-weight:800;"><i class="fa-solid fa-chair"></i> ${escapeHtml(tableDisplayName(table, allTables))} — ${usedSeats}/${capacity} seated</h2>
      <button class="btn btn-ghost btn-sm" id="rposBackToTablesBtn"><i class="fa-solid fa-arrow-left"></i> All Tables</button>
    </div>
    <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(180px,1fr)); gap:14px;">
      ${parties.map(p => {
        const elapsed = Date.now() - new Date(p.createdAt).getTime();
        return `
          <div class="rpos-table-card rpos-box-enter" data-id="${p.id}" style="background:${STATUS_META.occupied.bg}; border:1px solid var(--border);">
            <div style="font-weight:800; font-size:15px;">Box ${p.partyNumber || '?'}</div>
            <div style="font-size:11px; color:var(--text-muted); margin-top:2px;"><i class="fa-solid fa-users" style="margin-right:4px; opacity:.5;"></i>${p.guestCount || '—'} guests · ${p.items?.length || 0} item(s)</div>
            <div style="display:flex; align-items:center; justify-content:space-between; margin-top:10px;">
              <div class="rpos-box-status" style="font-size:11px; font-weight:700; color:${STATUS_META.occupied.color};"><i class="fa-solid fa-circle" style="font-size:6px; margin-right:5px;"></i>In progress</div>
              <div class="rpos-table-timer" data-created-at="${p.createdAt}" style="font-size:11px; font-weight:800; color:${timerTier(elapsed).color};">${formatElapsed(elapsed)}</div>
            </div>
          </div>
        `;
      }).join('')}
      ${remaining > 0 ? `
        <div class="rpos-table-card rpos-add-party-card" id="rposAddPartyCard" style="border:2px dashed var(--border); display:flex; align-items:center; justify-content:center; text-align:center; color:var(--primary); font-weight:700;">
          <div><i class="fa-solid fa-plus" style="font-size:20px; display:block; margin-bottom:6px;"></i>Add Party<div style="font-size:10.5px; font-weight:600; opacity:.7;">${remaining} seat${remaining === 1 ? '' : 's'} left</div></div>
        </div>
      ` : ''}
    </div>
  `;

  document.getElementById('rposBackToTablesBtn')?.addEventListener('click', async () => { drillTable = null; await renderPickerView(); });
  document.querySelectorAll('.rpos-table-card[data-id]').forEach(el => {
    el.addEventListener('click', async () => {
      const party = parties.find(p => p.id === el.dataset.id);
      if (!party) return;
      await enterCounterOrder(party, table);
      updateBackButtonLabel();
      await renderOrderingView();
    });
  });
  document.getElementById('rposAddPartyCard')?.addEventListener('click', () => {
    promptGuestCount(async (count) => {
      await startNewParty(table, count);
      updateBackButtonLabel();
      await renderOrderingView();
    }, remaining, `${remaining} seat${remaining === 1 ? '' : 's'} left on this table`);
  });
  startTablesTimerLoop();
}

// ── Takeaway/Delivery picker: a list of open orders of this type + a way to
// start a new one — so several takeaway (or delivery) orders can be open
// and billed independently instead of the page only ever tracking one at a
// time. ────────────────────────────────────────────────────────────────
async function renderCounterOrderPicker() {
  const area = document.getElementById('rposContent');
  if (!area) return;
  const typeLabel = orderType === 'delivery' ? 'Delivery' : 'Takeaway';
  const icon = orderType === 'delivery' ? 'fa-motorcycle' : 'fa-bag-shopping';
  const orders = (await getCounterOrders()).filter(o => o.orderType === orderType);

  area.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
      <h2 style="font-size:16px; font-weight:800;"><i class="fa-solid ${icon}"></i> ${typeLabel} Orders</h2>
      <button class="btn btn-primary btn-sm" id="rposNewCounterOrderBtn"><i class="fa-solid fa-plus"></i> New ${typeLabel} Order</button>
    </div>
    ${orders.length === 0 ? `
      <div class="card" style="padding:40px; text-align:center; color:var(--text-muted);">
        No ${typeLabel.toLowerCase()} orders open right now. Click "New ${typeLabel} Order" to start one.
      </div>
    ` : `
      <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(180px,1fr)); gap:14px;">
        ${orders.map(o => {
          const elapsed = Date.now() - new Date(o.createdAt).getTime();
          return `
            <div class="rpos-table-card" data-id="${o.id}" style="background:rgba(59,130,246,0.06); border:1px solid var(--border);">
              <div style="font-weight:800; font-size:15px;"><i class="fa-solid ${icon}" style="opacity:.4; margin-right:6px; font-size:12px;"></i>${escapeHtml(counterOrderLabel(o))}</div>
              <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">${o.items?.length || 0} item(s)</div>
              <div style="display:flex; align-items:center; justify-content:space-between; margin-top:10px;">
                <div style="font-size:11px; font-weight:700; color:var(--warning);"><i class="fa-solid fa-circle" style="font-size:6px; margin-right:5px;"></i>In progress</div>
                <div class="rpos-counter-order-timer" data-created-at="${o.createdAt}" style="font-size:11px; font-weight:800; color:${timerTier(elapsed).color};">${formatElapsed(elapsed)}</div>
              </div>
              ${o.contactPhone ? `<div style="font-size:10.5px; color:var(--text-muted); margin-top:4px;"><i class="fa-solid fa-phone" style="margin-right:4px; opacity:.5;"></i>${escapeHtml(o.contactPhone)}</div>` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `}
  `;

  document.getElementById('rposNewCounterOrderBtn')?.addEventListener('click', async () => {
    await startNewCounterOrder(orderType);
    updateBackButtonLabel();
    await renderOrderingView();
  });
  document.querySelectorAll('.rpos-table-card').forEach(el => {
    el.addEventListener('click', async () => {
      const order = orders.find(o => o.id === el.dataset.id);
      if (!order) return;
      await enterCounterOrder(order);
      updateBackButtonLabel();
      await renderOrderingView();
    });
  });
  startCounterOrdersTimerLoop();
}

function startCounterOrdersTimerLoop() {
  if (counterOrdersTimerInterval) clearInterval(counterOrdersTimerInterval);
  counterOrdersTimerInterval = setInterval(() => {
    const area = document.getElementById('rposContent');
    if (!area) { clearInterval(counterOrdersTimerInterval); counterOrdersTimerInterval = null; return; }
    const timers = area.querySelectorAll('.rpos-counter-order-timer');
    if (timers.length === 0) { clearInterval(counterOrdersTimerInterval); counterOrdersTimerInterval = null; return; }
    timers.forEach(el => {
      const createdAt = el.dataset.createdAt;
      if (!createdAt) return;
      const ms = Date.now() - new Date(createdAt).getTime();
      el.textContent = formatElapsed(ms);
      el.style.color = timerTier(ms).color;
    });
  }, 30000);
}

// `capacity`, when given, is checked against what's entered — exceeding it
// isn't blocked outright (a shop might genuinely pull up an extra chair),
// but it needs an explicit confirmation instead of silently being accepted.
// `capacityLabel` overrides the default "seats up to N" wording — used when
// `capacity` actually means "seats left on this table", not its total.
function promptGuestCount(onConfirm, capacity = null, capacityLabel = null) {
  openModal({
    title: '<i class="fa-solid fa-users mr-8"></i> Party Size',
    body: `
      <div class="form-group">
        <label class="form-label">Number of guests</label>
        <input class="form-input" id="rposGuestCountInput" type="number" min="1" value="2" autofocus />
        ${capacity ? `<p style="font-size:11px; color:var(--text-muted); margin-top:6px;">${capacityLabel || `This table seats up to ${capacity}.`}</p>` : ''}
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
    const confirm = async () => {
      const count = Math.max(1, parseInt(input?.value, 10) || 1);
      if (capacity && count > capacity) {
        const proceed = await showConfirm({
          title: 'Party size exceeds seating',
          message: `Only ${capacity} seat${capacity === 1 ? '' : 's'} available here, but ${count} guests were entered. Continue anyway, or cancel and seat the extra guests as a separate party/table?`,
          okText: 'Continue Anyway'
        });
        if (!proceed) return;
      }
      closeModal();
      onConfirm(count);
    };
    document.getElementById('rposGuestCountConfirm')?.addEventListener('click', confirm);
    input?.addEventListener('keydown', e => { if (e.key === 'Enter') confirm(); });
  }, 50);
}

// ── Live kitchen status for this order — used both to label each sent cart
// item (pending/ready/served) and to gate Bill Now until every single dish
// has actually been served, not just cooked. Reads straight from the KOT
// docs (the Kitchen page's own source of truth) rather than trusting
// anything cached on the cart item itself, so it can never go stale.
//
// A cartId can end up with MORE than one KOT entry — re-adding an
// already-sent item un-fires the whole line, and Modify voids the old entry
// and creates a fresh one on the next Send — so this maps each cartId to
// the *array* of every entry it has ever had, and summarizeCartIdStatus()
// below only calls it "served" once every non-voided entry is served. ─────
async function buildKitchenStatusMap() {
  const map = new Map();
  if (!orderSessionId) return map;
  const kots = (await getKots()).filter(k =>
    k.orderSessionId === orderSessionId ||
    // Backward compatibility for a dine-in order resumed from a build where
    // orderSessionId was the TABLE's id (before table sharing existed, one
    // order per table) rather than this specific box's own id — without
    // this, every KOT sent under that older scheme would look orphaned the
    // moment this build's box-based ids take over.
    (selectedTable && k.orderSessionId === selectedTable.id) ||
    (!k.orderSessionId && orderType === 'dine-in' && selectedTable && k.tableId === selectedTable.id)
  );
  kots.forEach(kot => (kot.items || []).forEach(i => {
    if (!i.cartId) return;
    const arr = map.get(i.cartId) || [];
    arr.push(i.itemStatus || 'pending');
    map.set(i.cartId, arr);
  }));
  return map;
}

function summarizeCartIdStatus(statuses) {
  // No entry at all is NOT the same as "queued" — a genuinely pending item
  // always has a real KOT entry (sendToKitchen() creates one before marking
  // the cart item sent). Zero entries means the link between this cart item
  // and its kitchen ticket is broken, which needs to be visible and
  // recoverable, not silently indistinguishable from normal pending.
  if (!statuses || statuses.length === 0) return 'not_found';
  const live = statuses.filter(s => s !== 'voided');
  if (live.length === 0) return 'served'; // every portion of this line was cancelled — nothing left to wait on
  if (live.every(s => s === 'served')) return 'served';
  if (live.some(s => s === 'ready')) return 'ready'; // at least one portion ready, though not everything is done yet
  return 'pending';
}

async function getOrderServeStatus() {
  const kitchenStatusMap = await buildKitchenStatusMap();
  let outstanding = 0;
  store.cart.forEach(i => {
    if (i.qty > (i.sentQty || 0)) { outstanding++; return; } // still has an un-sent pending portion
    if (summarizeCartIdStatus(kitchenStatusMap.get(i.cartId)) !== 'served') outstanding++;
  });
  return { kitchenStatusMap, outstanding, fullyServed: store.cart.length > 0 && outstanding === 0 };
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
  const orderLabel = currentOrderLabel(allTables);
  const search = menuSearch.trim().toLowerCase();
  const products = (await getProducts()).filter(p => (!activeCategory || p.category === activeCategory) && (!search || (p.name || '').toLowerCase().includes(search)));
  const totals = getCartTotals();
  // "Pending" means QUANTITY still owed to the kitchen, not just whether the
  // line has ever been sent at all — a line already partly sent (e.g. 1 of
  // an eventual 3 went out already) still shows up here for the remaining
  // 2, so a second Send never re-fires what's already on its way.
  const pendingItems = store.cart.filter(i => i.qty > (i.sentQty || 0));
  const coursesPresent = [...new Set(pendingItems.map(i => i.course).filter(Boolean))];
  const serveStatus = await getOrderServeStatus();

  area.innerHTML = `
    <div class="rpos-layout">
      <div>
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
          <div style="font-size:14px; font-weight:800; display:flex; align-items:center; gap:8px;">
            ${orderType === 'dine-in'
              ? `<i class="fa-solid fa-chair"></i> ${escapeHtml(orderLabel || 'Table')}`
              : `<i class="fa-solid ${orderType === 'delivery' ? 'fa-motorcycle' : 'fa-bag-shopping'}"></i> ${escapeHtml(orderLabel || (orderType === 'delivery' ? 'Delivery' : 'Takeaway'))}`}
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
          ${store.cart.length === 0 ? `<div style="text-align:center; padding:24px; color:var(--text-muted); font-size:12px;">No items yet — tap a menu item to add it</div>` : store.cart.map(i => {
            const sentQty = i.sentQty || 0;
            const pendingQty = Math.max(0, parseFloat((i.qty - sentQty).toFixed(3)));
            let sentBadge = '';
            if (sentQty > 0) {
              const kStatus = summarizeCartIdStatus(serveStatus.kitchenStatusMap.get(i.cartId));
              if (kStatus === 'not_found') console.error(`[RestaurantPOS] "${i.name}" is marked sent but has no matching KOT entry (orderSessionId=${orderSessionId}) — offering Resend.`);
              const meta = KITCHEN_ITEM_META[kStatus] || KITCHEN_ITEM_META.pending;
              sentBadge = `
                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                  <span style="font-size:10px; font-weight:700; color:${meta.color};"><i class="fa-solid ${meta.icon}"></i> ${sentQty}x ${meta.label}${i.course ? ` · ${escapeHtml(i.course)}` : ''}</span>
                  ${pendingQty > 0 ? `<span style="font-size:10px; font-weight:700; color:var(--warning);">+${pendingQty} new</span>` : ''}
                  ${kStatus === 'not_found' ? `<button class="btn-icon rpos-resend-item" data-cart-id="${i.cartId}" title="Resend to kitchen"><i class="fa-solid fa-rotate-right" style="font-size:10px; color:var(--danger);"></i></button>` : ''}
                  ${pendingQty <= 0 && kStatus !== 'served' && kStatus !== 'not_found' ? `<button class="btn-icon rpos-modify-item" data-cart-id="${i.cartId}" title="Modify"><i class="fa-solid fa-pen" style="font-size:10px;"></i></button>` : ''}
                </div>
              `;
            }
            return `
            <div class="rpos-cart-item">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                <div style="font-size:12.5px; font-weight:700; flex:1;">${escapeHtml(i.name)}</div>
                <button class="btn-icon rpos-remove-item" data-cart-id="${i.cartId}" title="Remove"><i class="fa-solid fa-xmark" style="font-size:11px; color:var(--danger);"></i></button>
              </div>
              ${(i.modifiers?.length || i.notes) ? `<div style="font-size:10.5px; color:var(--text-muted); margin-top:2px;">${[...(i.modifiers || []), i.notes].filter(Boolean).map(escapeHtml).join(' · ')}</div>` : ''}
              <div style="display:flex; align-items:center; justify-content:space-between; margin-top:6px; flex-wrap:wrap; gap:6px;">
                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                  <button class="btn-icon rpos-qty-minus" data-cart-id="${i.cartId}"><i class="fa-solid fa-minus" style="font-size:10px;"></i></button>
                  <span style="font-size:12px; font-weight:700; min-width:18px; text-align:center;">${i.qty}</span>
                  <button class="btn-icon rpos-qty-plus" data-cart-id="${i.cartId}"><i class="fa-solid fa-plus" style="font-size:10px;"></i></button>
                  ${sentQty <= 0 ? `
                    <button class="btn-icon rpos-customize-item" data-cart-id="${i.cartId}" title="Customize"><i class="fa-solid fa-sliders" style="font-size:10px;"></i></button>
                    <select class="form-input rpos-course-select" data-cart-id="${i.cartId}" style="font-size:10px; padding:2px 4px; max-width:82px;">
                      <option value="">Course</option>
                      ${COURSES.map(c => `<option value="${c}" ${i.course === c ? 'selected' : ''}>${c}</option>`).join('')}
                    </select>
                  ` : ''}
                </div>
                ${sentBadge}
                <div style="font-size:12px; font-weight:800;">${cur}${(i.price * i.qty).toFixed(2)}</div>
              </div>
            </div>
          `;
          }).join('')}
        </div>
        <div style="border-top:1px solid var(--border); margin-top:12px; padding-top:10px; display:flex; flex-direction:column; gap:4px; font-size:12px;">
          <div style="display:flex; justify-content:space-between; color:var(--text-muted);"><span>Subtotal</span><span>${cur}${totals.subtotal.toFixed(2)}</span></div>
          ${totals.discount > 0 ? `<div style="display:flex; justify-content:space-between; color:var(--success);"><span>Discount</span><span>-${cur}${totals.discount.toFixed(2)}</span></div>` : ''}
          <div style="display:flex; justify-content:space-between; color:var(--text-muted);"><span>Tax</span><span>${cur}${(totals.itemTax + totals.orderTax).toFixed(2)}</span></div>
          ${totals.roundOff ? `<div style="display:flex; justify-content:space-between; color:var(--text-muted);"><span>Round Off</span><span>${totals.roundOff > 0 ? '+' : ''}${cur}${totals.roundOff.toFixed(2)}</span></div>` : ''}
          <div style="display:flex; justify-content:space-between; font-size:15px; font-weight:800; margin-top:4px; padding-top:6px; border-top:1px solid var(--border);"><span>Total</span><span>${cur}${totals.total.toFixed(2)}</span></div>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px; margin-top:14px;">
          ${renderSendControls(pendingItems, coursesPresent)}
          <button class="btn btn-ghost" id="rposPreviewBillBtn" ${store.cart.length === 0 ? 'disabled' : ''}><i class="fa-solid fa-print"></i> Preview Bill</button>
          <button class="btn btn-primary" id="rposBillBtn" ${store.cart.length === 0 || !serveStatus.fullyServed ? 'disabled' : ''}><i class="fa-solid fa-receipt"></i> Bill Now — ${cur}${totals.total.toFixed(2)}</button>
          ${store.cart.length > 0 && !serveStatus.fullyServed ? `<div style="font-size:11px; color:var(--warning); text-align:center; display:flex; align-items:center; justify-content:center; gap:6px;"><i class="fa-solid fa-hourglass-half"></i> ${serveStatus.outstanding} dish${serveStatus.outstanding === 1 ? '' : 'es'} still not served — check Kitchen</div>` : ''}
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
      // addToCart() just increments qty on the existing line — sentQty is
      // untouched, so the increase automatically becomes a new pending
      // delta the next Send to Kitchen picks up. Nothing already sent gets
      // touched or re-fired, so quantities can never double up.
      addToCart(product);
    });
  });
  document.querySelectorAll('.rpos-remove-item').forEach(el => el.addEventListener('click', () => requestRemoveItem(el.dataset.cartId)));
  document.querySelectorAll('.rpos-qty-plus').forEach(el => el.addEventListener('click', () => updateQty(el.dataset.cartId, 1)));
  document.querySelectorAll('.rpos-qty-minus').forEach(el => el.addEventListener('click', () => requestQtyMinus(el.dataset.cartId)));
  document.querySelectorAll('.rpos-customize-item').forEach(el => el.addEventListener('click', () => openModifierModal(el.dataset.cartId)));
  document.querySelectorAll('.rpos-modify-item').forEach(el => el.addEventListener('click', () => openModifyModal(el.dataset.cartId)));
  document.querySelectorAll('.rpos-resend-item').forEach(el => el.addEventListener('click', () => resendItem(el.dataset.cartId)));
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
    if (!selectedTable) return;
    const capacity = tableDisplayCapacity(selectedTable, allTables);
    (async () => {
      const otherParties = (await getCounterOrders()).filter(o => o.tableId === selectedTable.id && o.id !== selectedCounterOrder?.id);
      const usedByOthers = otherParties.reduce((s, p) => s + (p.guestCount || 0), 0);
      const remaining = Math.max(0, capacity - usedByOthers);
      promptGuestCount(async (count) => {
        guestCount = count;
        await persistOrderState();
        await renderOrderingView();
      }, remaining, `${remaining} seat${remaining === 1 ? '' : 's'} available for this box (table seats ${capacity} total).`);
    })();
  });
  // 'input' keeps takeawayContact live as the cashier types (so an
  // immediately-following Send/Bill click always reads the latest value);
  // 'change' (fires on blur/Enter, not every keystroke) persists it to the
  // counter order's own doc so contact/pickup info survives navigating away
  // and back the same way the rest of the order already does.
  document.getElementById('rposContactName')?.addEventListener('input', e => { takeawayContact.name = e.target.value; });
  document.getElementById('rposContactName')?.addEventListener('change', () => persistOrderState());
  document.getElementById('rposContactPhone')?.addEventListener('input', e => { takeawayContact.phone = e.target.value; });
  document.getElementById('rposContactPhone')?.addEventListener('change', () => persistOrderState());
  document.getElementById('rposContactAddress')?.addEventListener('input', e => { takeawayContact.address = e.target.value; });
  document.getElementById('rposContactAddress')?.addEventListener('change', () => persistOrderState());
  document.getElementById('rposPickupTime')?.addEventListener('input', e => { takeawayContact.pickupTime = e.target.value; });
  document.getElementById('rposPickupTime')?.addEventListener('change', () => persistOrderState());

  document.getElementById('rposPreviewBillBtn')?.addEventListener('click', previewBill);
  document.getElementById('rposBillBtn')?.addEventListener('click', openPaymentPanel);
}

// Recovery action for the 'not_found' kitchen-status case — un-fires the
// item locally so the next Send to Kitchen creates a fresh, properly-linked
// KOT entry for it, instead of leaving it silently stuck forever.
async function resendItem(cartId) {
  const item = store.cart.find(i => i.cartId === cartId);
  if (!item) return;
  item.sentQty = 0;
  showToast('Ready to resend — tap Send to Kitchen again.', 'info');
  await renderOrderingView();
}

// Multiple courses are only worth surfacing once staff actually start using
// them (per-item Course pickers) — until then this stays the plain single
// "Send to Kitchen" button so a shop that doesn't care about courses sees no
// extra complexity.
function renderSendControls(pendingItems, coursesPresent) {
  if (pendingItems.length === 0) {
    return store.cart.length === 0 ? '' : `<button class="btn btn-secondary" disabled><i class="fa-solid fa-check"></i> All Sent to Kitchen</button>`;
  }
  if (coursesPresent.length === 0) {
    return `<button class="btn btn-secondary rpos-send-course" data-course=""><i class="fa-solid fa-kitchen-set"></i> Send to Kitchen (${pendingItems.length})</button>`;
  }
  return `
    <div style="display:flex; gap:6px; flex-wrap:wrap;">
      <button class="btn btn-secondary btn-sm rpos-send-course" data-course="" style="flex:1 1 100%;"><i class="fa-solid fa-kitchen-set"></i> Send All Pending (${pendingItems.length})</button>
      ${coursesPresent.map(c => `<button class="btn btn-ghost btn-sm rpos-send-course" data-course="${escapeHtml(c)}" style="flex:1;">${escapeHtml(c)} (${pendingItems.filter(i => i.course === c).length})</button>`).join('')}
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

// ── Modify a dish already sent to the kitchen — qty/modifiers/notes, gated
// behind a mandatory reason (same audit-trail spirit as Cancel). Saving
// voids the old kitchen instructions for this line and un-fires it, so the
// updated version goes out fresh on the next Send to Kitchen. Blocked once
// the kitchen has actually served it — at that point it's a new item, not
// an edit. ──────────────────────────────────────────────────────────────
async function openModifyModal(cartId) {
  const item = store.cart.find(i => i.cartId === cartId);
  if (!item) return;
  const statusMap = await buildKitchenStatusMap();
  const kStatus = summarizeCartIdStatus(statusMap.get(cartId));
  if (kStatus === 'served') return showToast('Already served — cancel it and add a fresh item instead.', 'error');

  const selected = new Set(item.modifiers || []);
  openModal({
    title: `<i class="fa-solid fa-pen mr-8"></i> Modify — ${escapeHtml(item.name)}`,
    body: `
      <div style="font-size:11.5px; color:var(--text-muted); margin-bottom:12px;">Already sent to the kitchen${kStatus === 'ready' ? ' and marked ready' : ''}. Saving this re-sends updated instructions on the next Send to Kitchen.</div>
      <div class="form-group">
        <label class="form-label">Quantity</label>
        <input class="form-input" id="rposModifyQty" type="number" min="0.001" step="1" value="${item.qty}" />
      </div>
      <div style="display:flex; flex-wrap:wrap; gap:8px; margin:12px 0;">
        ${COMMON_MODIFIERS.map(m => `
          <button type="button" class="rpos-mod-chip ${selected.has(m) ? 'active' : ''}" data-mod="${escapeHtml(m)}"
            style="padding:7px 12px; border-radius:999px; border:1px solid ${selected.has(m) ? 'var(--primary)' : 'var(--border)'}; background:${selected.has(m) ? 'var(--primary)' : 'var(--bg-elevated)'}; color:${selected.has(m) ? 'white' : 'inherit'}; font-size:12px; font-weight:600; cursor:pointer;">
            ${escapeHtml(m)}
          </button>
        `).join('')}
      </div>
      <div class="form-group">
        <label class="form-label">Special Instructions</label>
        <textarea class="form-input" id="rposModifyNotes" rows="2">${escapeHtml(item.notes || '')}</textarea>
      </div>
      <div class="form-group mt-8">
        <label class="form-label required">Reason for change</label>
        <textarea class="form-input" id="rposModifyReason" rows="2" placeholder="e.g. Customer asked for less spicy after ordering" autofocus></textarea>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="rposModifyConfirmBtn"><i class="fa-solid fa-rotate mr-4"></i> Save & Re-send</button>
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
    document.getElementById('rposModifyConfirmBtn')?.addEventListener('click', async () => {
      const reason = document.getElementById('rposModifyReason')?.value.trim();
      if (!reason) return showToast('Please enter a reason for the change', 'error');
      const qty = Math.max(0.001, parseFloat(document.getElementById('rposModifyQty')?.value) || item.qty);
      const notes = document.getElementById('rposModifyNotes')?.value.trim() || '';
      logChange(item, reason, 'modify');
      await voidCartItemInKots(cartId);
      closeModal();
      updateCartItem(cartId, { qty, modifiers: Array.from(selected), notes, sentQty: 0 });
      await persistOrderState();
      showToast('Updated — will go out on next Send to Kitchen', 'info');
    });
  }, 50);
}

// ── Cancel with mandatory reason (only enforced once an item has actually
// been fired to the kitchen — cancelling something that never left the cart
// has no kitchen/food-cost impact, so no audit friction there). ──────────
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

function logChange(item, reason, type) {
  changeLog.push({ type, name: item.name, qty: item.qty, reason, at: new Date().toISOString(), by: store.user?.name || store.user?.username || '' });
}

// Flags every not-yet-served KOT item matching this cartId (within the
// current order session) as voided, so a cancelled/modified dish stops
// silently blocking the "fully served" billing gate — and so the Kitchen
// page immediately shows it as cancelled instead of still cooking it.
async function voidCartItemInKots(cartId) {
  if (!orderSessionId) return;
  const kots = (await getKots()).filter(k => k.orderSessionId === orderSessionId);
  for (const kot of kots) {
    let changed = false;
    (kot.items || []).forEach(i => {
      if (i.cartId === cartId && i.itemStatus !== 'served' && i.itemStatus !== 'voided') { i.itemStatus = 'voided'; changed = true; }
    });
    if (changed) {
      if ((kot.items || []).every(i => i.itemStatus === 'served' || i.itemStatus === 'voided')) kot.status = 'served';
      await saveKot(kot);
    }
  }
}

function requestRemoveItem(cartId) {
  const item = store.cart.find(i => i.cartId === cartId);
  if (!item) return;
  if ((item.sentQty || 0) > 0) {
    promptVoidReason(item, async (reason) => {
      logChange(item, reason, 'cancel');
      await voidCartItemInKots(cartId);
      removeFromCart(cartId);
      await persistOrderState();
    });
  } else {
    removeFromCart(cartId);
  }
}

function requestQtyMinus(cartId) {
  const item = store.cart.find(i => i.cartId === cartId);
  if (!item) return;
  const nextQty = parseFloat((item.qty - 1).toFixed(3));
  if ((item.sentQty || 0) > 0 && nextQty < item.sentQty) {
    // This reduction eats into what's already been sent — needs a reason,
    // and the old kitchen ticket (sized for the higher quantity) is now
    // wrong, so void it entirely; whatever quantity remains goes out fresh
    // on the next Send rather than trying to shrink an already-fired ticket.
    promptVoidReason(item, async (reason) => {
      logChange(item, reason, 'cancel');
      await voidCartItemInKots(cartId);
      item.sentQty = 0;
      await updateQty(cartId, -1);
      await persistOrderState();
    });
  } else {
    updateQty(cartId, -1);
  }
}

// Every order type — a dine-in box or a takeaway/delivery order — is a
// CounterOrder now, so there's exactly one save path regardless of type.
async function persistOrderState() {
  if (!selectedCounterOrder) return;
  selectedCounterOrder = await saveCounterOrder({
    ...selectedCounterOrder,
    items: store.cart,
    guestCount: orderType === 'dine-in' ? guestCount : undefined,
    contactName: orderType !== 'dine-in' ? (takeawayContact.name || '') : undefined,
    contactPhone: orderType !== 'dine-in' ? (takeawayContact.phone || '') : undefined,
    deliveryAddress: orderType === 'delivery' ? (takeawayContact.address || '') : undefined,
    pickupTime: orderType === 'takeaway' ? (takeawayContact.pickupTime || '') : undefined,
    changeLog,
    waiterId: store.selectedStaff?.id || null,
    waiterName: store.selectedStaff?.name || null,
  });
}

// ── Send to Kitchen — optionally scoped to one course, so Starters can go
// out well ahead of Mains instead of the whole order firing at once. ──────
async function sendToKitchen(courseFilter = null) {
  // Send exactly the un-sent DELTA of each line, not its whole current
  // quantity — a line already partly sent (say 1 of an eventual 3) only
  // owes the kitchen 2 more, never the full 3 again. This is what actually
  // fixes double-counting when more of an already-fired item gets added:
  // the earlier ticket for the first 1 stays exactly as it was, and this
  // send only ever asks for what genuinely hasn't gone out yet.
  const pending = store.cart
    .map(i => ({ item: i, sendQty: Math.max(0, parseFloat((i.qty - (i.sentQty || 0)).toFixed(3))) }))
    .filter(({ item, sendQty }) => sendQty > 0 && (!courseFilter || item.course === courseFilter));
  if (pending.length === 0) return;
  const branchId = store.branch?.id || (await getCurrentBranch())?.id || 'b1';
  const settings = store.settings || await getSettings();

  // The KOT's own display label — this box's table (+ box number, if the
  // table has more than one) for dine-in, or the counter order's label for
  // takeaway/delivery, so Kitchen.js can tell two simultaneous tickets on
  // the same table (or two takeaway orders) apart.
  const allTables = orderType === 'dine-in' ? await getTables() : [];
  const ticketLabel = currentOrderLabel(allTables);

  let kot;
  try {
    kot = await saveKot({
      tableId: selectedTable?.id || null,
      tableName: ticketLabel,
      orderType,
      orderSessionId,
      course: courseFilter || null,
      contactName: takeawayContact.name || '',
      waiterName: store.selectedStaff?.name || null,
      items: pending.map(({ item, sendQty }) => ({ name: item.name, qty: sendQty, modifiers: item.modifiers || [], notes: item.notes || '', course: item.course || null, cartId: item.cartId, itemStatus: 'pending' })),
      branchId,
    });
  } catch (err) {
    // Nothing marked sent, cart untouched — safe for the cashier to just
    // retry. Silently failing here (or marking items sent regardless) is
    // exactly how a cart item could end up permanently stuck looking "sent"
    // with no real kitchen ticket behind it.
    console.error('[RestaurantPOS] sendToKitchen: saveKot() failed', err);
    showToast('Could not send to kitchen — please try again.', 'error');
    return;
  }

  pending.forEach(({ item }) => { item.sentQty = item.qty; });

  try {
    await persistOrderState();
  } catch (err) {
    // The KOT itself already saved — the kitchen WILL see it. Only the
    // order's own items snapshot failed to persist, which self-corrects on
    // the very next save (any later Send/Modify/Cancel/Bill re-saves it) —
    // a warning, not a hard stop.
    console.error('[RestaurantPOS] sendToKitchen: order-state save failed', err);
    showToast('Sent to kitchen, but the order status may be out of date — it will self-correct shortly.', 'warning');
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
        ${kot.orderType === 'dine-in' ? `TABLE: ${escapeHtml(kot.tableName || '')}` : escapeHtml(kot.tableName || (kot.orderType || '').toUpperCase())}
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
// saved, so the customer can review the bill before it's finalized. Not
// gated on serve-status — a preview is purely informational. ────────────
async function previewBill() {
  if (store.cart.length === 0) return;
  const settings = store.settings || await getSettings();
  const cur = settings.currency || '₹';
  const totals = getCartTotals();
  const allTables = orderType === 'dine-in' ? await getTables() : [];
  const orderLabel = currentOrderLabel(allTables);
  await printReceiptHtml(renderProformaHtml(totals, settings, cur, orderLabel), 'Bill Preview');
}

function renderProformaHtml(totals, settings, cur, orderLabel) {
  return `
    <div class="receipt">
      <div class="receipt-header">
        <div class="receipt-store-name">${escapeHtml(settings.storeName || 'Bill Preview')}</div>
        <div class="receipt-row" style="font-size:11px; opacity:.7;">${new Date().toLocaleString()}</div>
      </div>
      <div style="text-align:center; font-size:11px; font-weight:800; letter-spacing:.5px; margin:6px 0;">PROFORMA — NOT A TAX INVOICE</div>
      <div class="receipt-divider"></div>
      <div style="font-size:12px; font-weight:700; text-align:center;">
        ${escapeHtml(orderLabel || (orderType || '').toUpperCase())}${guestCount ? ` · ${guestCount} guests` : ''}
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
// notes) — then hands off to the SAME confirmOrder() POS.js/QuickPOS.js use.
// The button itself is only enabled once getOrderServeStatus() (checked in
// renderOrderingView()) confirms every dish has been served. ────────────
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

// Plays the box-billed animation on a specific box card IF it's actually on
// screen right now (data-id match inside #rposContent) — a quiet no-op
// otherwise (e.g. billed for a table whose picker isn't currently showing).
// Resolves once the animation finishes (or a fallback timeout, in case
// 'animationend' never fires — e.g. the element got removed from the DOM
// by something else mid-flight) so the caller can safely delete the
// underlying record and re-render only AFTER the card has visibly gone.
function animateBoxExit(partyId) {
  return new Promise(resolve => {
    const card = document.querySelector(`#rposContent .rpos-table-card[data-id="${partyId}"]`);
    if (!card) return resolve();
    const statusLine = card.querySelector('.rpos-box-status');
    if (statusLine) statusLine.innerHTML = '<i class="fa-solid fa-check" style="margin-right:5px;"></i>Billed';
    if (statusLine) statusLine.style.color = 'var(--success)';
    card.classList.add('rpos-box-exit');
    let done = false;
    const finish = () => { if (done) return; done = true; resolve(); };
    card.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, 700);
  });
}

async function completeBill(payments) {
  const settings = store.settings || await getSettings();
  const cur = settings.currency || '₹';
  const allTables = orderType === 'dine-in' ? await getTables() : [];
  const orderLabel = currentOrderLabel(allTables);
  const restaurantMeta = {
    orderType,
    tableId: selectedTable?.id || null,
    tableName: orderLabel,
    guestCount: guestCount || null,
    contactName: takeawayContact.name || undefined,
    contactPhone: takeawayContact.phone || undefined,
    deliveryAddress: orderType === 'delivery' ? (takeawayContact.address || undefined) : undefined,
    pickupTime: orderType === 'takeaway' ? (takeawayContact.pickupTime || undefined) : undefined,
    changeLog: changeLog.length ? changeLog : undefined,
  };

  const succeeded = await confirmOrder(payments, getCartTotals(), settings, cur, { isCredit: false, creditInfo: '' }, restaurantMeta);
  if (!succeeded) return; // confirmOrder() already showed its own error toast

  const container = document.getElementById('page-container');
  const wasDineIn = orderType === 'dine-in';
  const billedTable = selectedTable;
  const billedPartyId = selectedCounterOrder?.id;

  if (wasDineIn && billedTable) {
    // Land back on THIS table's own box picker — still showing the
    // just-billed box — before deleting anything, so its departure plays
    // out as a visible animation instead of the box just being silently
    // absent the next time this screen renders (see animateBoxExit()).
    drillTable = billedTable;
    view = 'picker';
    updateBackButtonLabel();
    await renderTablePartyPicker(billedTable);
    await animateBoxExit(billedPartyId);
  }

  // Billed — this box/order is done. The table (or any other box sharing
  // it) isn't touched at all: occupancy is always derived live from
  // whichever CounterOrder docs still reference a table, so removing just
  // this one is enough for it to correctly stop counting toward that
  // table's used seats, whether or not other boxes are still active there.
  if (selectedCounterOrder) {
    await deleteCounterOrder(selectedCounterOrder.id);
  }

  takeawayContact = { name: '', phone: '', address: '', pickupTime: '' };
  selectedTable = null;
  selectedCounterOrder = null;
  guestCount = null;
  changeLog = [];
  orderSessionId = null;
  setStaff(null);

  if (wasDineIn && billedTable) {
    // Stay drilled into this table if it still has other boxes open; pop
    // back out to the full table grid once it's genuinely empty again.
    const stillHasParties = (await getCounterOrders()).some(o => o.tableId === billedTable.id);
    orderType = 'dine-in';
    drillTable = stillHasParties ? billedTable : null;
    view = 'picker';
    await render(container); // in-place re-render — no full state reset needed, we're already back at the picker
  } else {
    view = 'picker';
    orderType = null;
    drillTable = null;
    await renderRestaurantPOS(container);
  }
}
