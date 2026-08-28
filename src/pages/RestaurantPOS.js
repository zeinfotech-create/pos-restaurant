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
import { STATUS_META, visibleTables, tableDisplayName, tableDisplayCapacity, groupBySection, tableOccupancy, tableStatusKey, capacityBarHtml, formatElapsed, timerTier, summarizeCartIdStatus, buildKitchenStatusMapFor, partyServeStatus, tableReadyToBill } from '../utils/tableDisplay.js';

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

// Set once per page-entry (renderRestaurantPOS()) from location.hash — true
// for the LAN/phone entry point (#mobile-order / #mo, router.js), false for
// the normal in-app 'restaurant-pos' tab. Same component either way, same
// state machine below, only render()/renderPickerView()/renderOrderingView()
// branch their MARKUP on this — a waiter's phone gets a bottom tab bar and a
// bottom-sheet cart instead of the desktop two-column layout, but every
// business rule (sendToKitchen, table sharing, kitchen-status gating, ...)
// is the exact same code path, never duplicated.
let isMobile = false;
// Mobile-only: is the bottom-sheet cart currently expanded? Reset to closed
// on every fresh page-entry and on Back, so it never carries over open from
// a previous table/order.
let mobileCartOpen = false;
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
  isMobile = location.hash.startsWith('#mobile-order') || location.hash.startsWith('#mo');
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
    mobileCartOpen = false;
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
  if (!btn) return;
  // See render()'s hideBackBtn comment — same rule, kept in sync here since
  // this is the OTHER place the button's state can change (a sub-view
  // switching 'view' without a full shell re-render).
  if (isMobile && view === 'picker') { btn.style.display = 'none'; return; }
  btn.style.display = '';
  btn.innerHTML = `<i class="fa-solid fa-arrow-left"></i> ${backButtonLabel()}`;
}

async function render(container) {
  // On mobile (LAN/phone entry — #mo/#mobile-order), the topbar's own
  // Back button only ever makes sense at the 'ordering' level (stepping
  // back to the table/order picker) — at the top-level picker its label is
  // always "Dashboard" (backButtonLabel()), and 'dashboard' sits OUTSIDE
  // router.js's mobile lockdown whitelist, so tapping it would black-screen
  // this same device. Hidden there entirely; the bottom tab bar is this
  // route's only navigation. The topbar's Kitchen button is hidden on
  // mobile too — the bottom tab bar's own Kitchen tab replaces it (and
  // correctly points at 'kd', not the desktop-only 'kitchen' route).
  const hideBackBtn = isMobile && view === 'picker';
  container.innerHTML = `
    <div class="rpos-shell${isMobile ? ' rpos-mobile' : ''}">
      <div class="rpos-topbar">
        <button class="btn btn-ghost btn-sm" id="rposBackBtn" style="${hideBackBtn ? 'display:none;' : ''}"><i class="fa-solid fa-arrow-left"></i> ${backButtonLabel()}</button>
        <div class="rpos-topbar-title"><i class="fa-solid fa-utensils"></i> ${isMobile ? 'Order' : 'Restaurant POS'}</div>
        ${!isMobile ? `<button class="btn btn-ghost btn-sm" id="rposKitchenBtn"><i class="fa-solid fa-kitchen-set"></i> Kitchen<span id="rposKotBadge"></span></button>` : `<span id="rposKotBadge" style="display:none;"></span>`}
      </div>
      <div id="rposContent"></div>
      ${isMobile ? `
        <div class="rpos-mobile-navbar">
          <button class="rpos-mobile-nav-btn active" id="rposMobileNavOrders"><i class="fa-solid fa-utensils"></i><span>Orders</span></button>
          <button class="rpos-mobile-nav-btn" id="rposMobileNavKitchen"><i class="fa-solid fa-kitchen-set"></i><span>Kitchen</span><span id="rposMobileKotBadge"></span></button>
          <button class="rpos-mobile-nav-btn" id="rposMobileNavRefresh"><i class="fa-solid fa-rotate-right"></i><span>Refresh</span></button>
          <button class="rpos-mobile-nav-btn" id="rposMobileNavLogout" style="color:var(--danger);"><i class="fa-solid fa-right-from-bracket"></i><span>Logout</span></button>
        </div>
      ` : ''}
    </div>
    <style>
      /* 100dvh right after 100vh, not instead of it — see style.css's
         standalone-view rules for the full explanation: 100vh on a real
         phone can measure taller than what's actually visible (mobile
         browser chrome), pushing the bottom nav bar below the visible
         screen with no way to scroll to it — invisible on a real device,
         while a desktop browser's mobile emulation (no dynamic chrome)
         shows it fine. dvh tracks the real visible viewport; unsupported
         browsers just ignore the invalid unit and keep 100vh. */
      .rpos-shell { height: 100vh; height: 100dvh; display: flex; flex-direction: column; background: var(--bg-app); }
      .rpos-topbar { display:flex; align-items:center; justify-content:space-between; padding:12px 20px; border-bottom:1px solid var(--border); background:var(--bg-elevated); flex-shrink:0; }
      .rpos-topbar-title { font-size:15px; font-weight:800; }
      #rposContent { flex:1; overflow:auto; padding:20px; }
      /* Mobile (#mo/#mobile-order) only, below — the desktop/tablet 'restaurant-pos'
         tab is completely unaffected since none of these selectors match
         without .rpos-mobile on .rpos-shell. */
      .rpos-mobile-navbar { display:flex; border-top:1px solid var(--border); background:var(--bg-elevated); flex-shrink:0; height:64px; }
      .rpos-mobile-nav-btn { flex:1; border:none; background:none; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; font-size:10.5px; font-weight:700; color:var(--text-muted); cursor:pointer; position:relative; transition:color .15s; }
      .rpos-mobile-nav-btn i { font-size:18px; transition:transform .15s; }
      .rpos-mobile-nav-btn.active { color:var(--primary); }
      .rpos-mobile-nav-btn.active i { transform:scale(1.1); }
      /* Bottom padding clears the collapsed cart's peek bar (fixed to the
         viewport — see .rpos-cart-panel below) so the last row of menu
         items never ends up permanently hidden behind it.
         overflow-x:hidden + touch-action:pan-y is the actual fix for a real
         bug found on a real phone (not caught by the earlier Playwright
         checks, which drive clicks, not touch swipes): #rposContent's base
         rule above is overflow:auto for BOTH axes — so on a real
         touchscreen, a swipe meant for .rpos-cat-bar's own horizontal
         scroll (below) could drag the ENTIRE content area sideways instead,
         leaving the whole screen scrolled off to one side (table label,
         search box, and product rows all blank/cut-off, only whatever sat
         at the far right — a dropdown, a "+" button — still visible). Locking
         the outer content to vertical-only panning here, then explicitly
         re-opening horizontal panning ONLY on .rpos-cat-bar just below,
         fixes it at the actual source instead of guessing at symptoms. */
      .rpos-mobile #rposContent { padding:12px; padding-bottom:84px; overflow-x:hidden; touch-action:pan-y; }
      /* THE actual root cause of the horizontal-scroll bug above, found by
         measuring: .rpos-layout is a CSS grid, and a grid item's default
         min-width is auto (its content's min-content size), not 0 — so
         .rpos-cat-bar's nowrap category chips (needed for ITS OWN
         overflow-x:auto to work) were forcing their full unwrapped width as
         a MINIMUM up through every block ancestor, blowing this grid
         column out to ~6800px instead of the intended 1fr. min-width:0
         is the standard fix for this exact grid/flexbox gotcha. */
      /* height:auto overrides the base .rpos-layout's height:100% (a
         desktop-only leftover — there .rpos-layout naturally fills
         #rposContent's flex height and desktop's own vertical scrollbar
         handles the rest). On mobile that height:100% fought the grid's
         own content-based row sizing (the row still auto-sized to the
         product list's real, taller content height regardless), producing
         an internal overflow whose extent didn't line up with
         #rposContent's reserved padding-bottom below — the actual bug
         behind the product list's last row peeking out from under the
         collapsed cart bar. auto lets the grid size itself to its real
         content height with nothing fighting it, so the padding-bottom
         now creates the intended, correctly-sized gap above the cart. */
      .rpos-mobile .rpos-layout { grid-template-columns: 1fr !important; height: auto !important; }
      .rpos-mobile .rpos-layout > div:first-child { min-width: 0; }
      /* Category chips stick to the top of the scrolling menu (under the
         search bar) once you scroll past them — switching category no
         longer means scrolling all the way back up first, the #1 mobile
         "category choose" complaint this addresses.
         The gap to the product grid below is deliberately PADDING here,
         not the element's own inline margin-bottom:14px (which still
         applies as-is on desktop, where this bar is never sticky) —
         margin is empty, unpainted space with no background of its own,
         so once this bar is pinned via position:sticky, a plain margin
         gap can end up showing whatever's scrolling underneath right
         through it. padding-bottom is part of THIS element's own painted
         box (background:var(--bg-app) fully covers it, guaranteed), so
         there's no seam for anything to show through, however this
         scrolls. margin-bottom:0 zeroes the inline 14px so it can't
         additionally stack with this padding. */
      .rpos-mobile .rpos-cat-bar { position:sticky; top:0; z-index:20; background:var(--bg-app); touch-action:pan-x; margin-bottom:0 !important; padding-bottom:24px !important; }
      .rpos-mobile .rpos-cat-tab { padding:11px 20px; font-size:13.5px; min-height:40px; display:flex; align-items:center; }
      /* Product "choose" — small square tiles read fine on a tablet but are
         fiddly to scan/tap with a thumb on a phone; mobile switches to a
         single-column list of full-width rows instead (same
         .rpos-product-card class + click handler as desktop, only the
         inner layout differs — see renderOrderingView()'s isMobile branch). */
      .rpos-mobile .rpos-product-card.rpos-product-row { display:flex; align-items:center; gap:12px; padding:12px 14px; }
      .rpos-mobile .rpos-product-emoji { width:46px; height:46px; border-radius:12px; background:var(--bg-app); display:flex; align-items:center; justify-content:center; font-size:22px; flex-shrink:0; }
      .rpos-mobile .rpos-product-info { flex:1; min-width:0; }
      .rpos-mobile .rpos-product-name { font-size:13.5px; font-weight:700; }
      .rpos-mobile .rpos-product-price { font-size:12.5px; color:var(--primary); font-weight:800; margin-top:2px; }
      .rpos-mobile .rpos-product-add-btn { width:34px; height:34px; border-radius:50%; background:var(--primary); color:#fff; font-size:14px; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
      /* The order cart, sticky-positioned on desktop, becomes a proper
         bottom SHEET on mobile — collapsed to just its "🛒 Order (N items)"
         header (peeking above the bottom nav) until tapped, then slides up
         to cover most of the screen. !important beats the element's own
         inline position:sticky/top:0 (this same cart panel's markup,
         unchanged for desktop) since this is the one thing that must win
         regardless of selector specificity.
         grid-row/grid-column: 1 — a real bug found by measuring the live
         DOM: .rpos-layout is a grid with exactly one explicit column on
         mobile, but this panel is its SECOND item — position:fixed takes
         it out of normal layout visually, but per the grid spec it can
         still occupy an (empty, but gap-contributing) implicit second row,
         quietly inflating #rposContent's scrollable height by however
         much. Pinning it into the SAME cell as the product-list column
         (row 1) stops that — the padding-bottom reserved on #rposContent
         below now actually corresponds to real, visible space above the
         collapsed cart bar instead of being partly eaten by this phantom
         row, which is what let the bottom product row peek out from
         underneath the cart on a real device. */
      .rpos-mobile .rpos-cart-panel {
        position: fixed !important;
        top: auto !important;
        left: 0; right: 0; bottom: 64px;
        margin: 0 !important;
        padding: 18px 16px !important;
        max-height: 78vh;
        overflow-y: auto;
        border-radius: 20px 20px 0 0;
        box-shadow: 0 -10px 30px rgba(0,0,0,.25);
        z-index: 300;
        grid-row: 1;
        grid-column: 1;
        transform: translateY(calc(100% - 66px));
        transition: transform .3s cubic-bezier(.4,0,.2,1);
      }
      .rpos-mobile .rpos-cart-panel.rpos-cart-open { transform: translateY(0); }
      .rpos-mobile #rposCartPeekHeader { cursor: pointer; }
      /* Bigger touch targets inside the cart sheet itself — qty +/-,
         remove, and the Send/Preview/Bill action buttons all need real
         thumb-sized hit areas, not the same compact ones the mouse-driven
         desktop cart panel uses. */
      .rpos-mobile .rpos-cart-panel .rpos-cart-item { padding:14px 0; }
      .rpos-mobile .rpos-cart-panel .btn { min-height:48px; font-size:14px; }
      .rpos-mobile .rpos-cart-panel .btn-sm { min-height:40px; font-size:12.5px; }
      /* Same shadow scale the app's own .card class uses (style.css) —
         every card on this page reuses it instead of inventing its own,
         so the whole ordering screen reads as one consistent surface
         language rather than each card type looking subtly different. */
      .rpos-order-type-btn { padding:28px; border-radius:16px; border:2px solid var(--border); background:var(--bg-elevated); cursor:pointer; text-align:center; transition:transform .2s cubic-bezier(.4,0,.2,1), box-shadow .2s cubic-bezier(.4,0,.2,1), border-color .2s; box-shadow:0 4px 12px rgba(0,0,0,.05); }
      .rpos-order-type-btn:hover { border-color:var(--primary); transform:translateY(-3px); box-shadow:0 8px 24px rgba(0,0,0,.1); }
      .rpos-table-card { padding:16px; border-radius:12px; cursor:pointer; transition:transform .2s cubic-bezier(.4,0,.2,1), box-shadow .2s cubic-bezier(.4,0,.2,1); box-shadow:0 4px 12px rgba(0,0,0,.05); }
      .rpos-table-card:hover { transform:translateY(-2px); box-shadow:0 8px 24px rgba(0,0,0,.1); }
      .rpos-add-party-card { cursor:pointer; transition:all .15s; }
      .rpos-add-party-card:hover { border-color:var(--primary); transform:translateY(-2px); }
      .rpos-layout { display:grid; grid-template-columns: 1fr 380px; gap:16px; height:100%; align-items:start; }
      @media (max-width: 900px) { .rpos-layout { grid-template-columns: 1fr; } }
      .rpos-cat-tab { padding:8px 16px; border-radius:999px; border:1px solid var(--border); background:var(--bg-elevated); cursor:pointer; font-size:12px; font-weight:700; white-space:nowrap; transition:all .15s; }
      .rpos-cat-tab:hover:not(.active) { border-color:var(--primary); color:var(--primary); }
      .rpos-cat-tab.active { background:var(--primary); color:white; border-color:var(--primary); box-shadow:0 2px 8px rgba(0,0,0,.18); }
      .rpos-product-card { padding:14px; border-radius:12px; border:1px solid var(--border); background:var(--bg-elevated); cursor:pointer; transition:transform .2s cubic-bezier(.4,0,.2,1), box-shadow .2s cubic-bezier(.4,0,.2,1), border-color .2s; box-shadow:0 2px 6px rgba(0,0,0,.04); }
      .rpos-product-card:hover { border-color:var(--primary); transform:translateY(-3px); box-shadow:0 8px 20px rgba(0,0,0,.1); }
      .rpos-product-card:active { transform:translateY(-1px) scale(.98); }
      /* Cart item row redesign — was a single flex-wrap row cramming qty
         controls, kitchen-status text, a modify button and the price
         together, which read as cluttered on both desktop and (worse) on
         mobile's narrower cart sheet. Same three logical zones, clearer
         separation: name+remove on top, an optional kitchen-status PILL of
         its own (was plain colored text), then a bottom row pairing a
         proper qty stepper (was three separate boxy buttons) against the
         price. One shared design for both — the .rpos-mobile overrides
         further down only bump sizing for touch, the shape is identical. */
      .rpos-cart-item { padding:12px 0; border-bottom:1px solid var(--border); }
      .rpos-cart-item-top { display:flex; align-items:center; justify-content:space-between; gap:8px; }
      .rpos-cart-item-name { font-size:13px; font-weight:700; flex:1; }
      .rpos-cart-item-remove { width:26px; height:26px; flex-shrink:0; border:none; background:none; border-radius:50%; display:flex; align-items:center; justify-content:center; color:var(--text-muted); font-size:12px; cursor:pointer; transition:background-color .15s, color .15s; }
      .rpos-cart-item-remove:hover { background:rgba(239,68,68,0.12); color:var(--danger); }
      .rpos-cart-status-chip { display:inline-flex; align-items:center; gap:6px; flex-wrap:wrap; margin-top:6px; padding:4px 10px; border-radius:999px; background:var(--bg-app); font-size:10.5px; font-weight:700; }
      .rpos-cart-chip-action { width:20px; height:20px; border:none; background:var(--bg-elevated); border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:9.5px; cursor:pointer; }
      .rpos-cart-item-bottom { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:8px; flex-wrap:wrap; }
      .rpos-qty-stepper { display:inline-flex; align-items:center; gap:2px; background:var(--bg-app); border-radius:999px; padding:3px; }
      .rpos-qty-stepper button { width:24px; height:24px; border:none; background:var(--bg-elevated); border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:9.5px; color:var(--text-main); cursor:pointer; box-shadow:0 1px 2px rgba(0,0,0,.08); }
      .rpos-qty-stepper span { min-width:22px; text-align:center; font-size:12.5px; font-weight:700; }
      .rpos-cart-item-customize { width:26px; height:26px; border:1px solid var(--border); background:var(--bg-elevated); border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:10px; color:var(--text-muted); cursor:pointer; }
      .rpos-cart-item-price { font-size:13px; font-weight:800; margin-left:auto; }
      .rpos-mobile .rpos-cart-panel .rpos-qty-stepper button,
      .rpos-mobile .rpos-cart-panel .rpos-cart-item-customize { width:30px; height:30px; }
      .rpos-mobile .rpos-cart-panel .rpos-cart-item-remove { width:30px; height:30px; }
      .rpos-mobile .rpos-cart-panel .rpos-cart-status-chip { font-size:11.5px; }
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
      /* A box that's fully served — every dish actually eaten-ready, not
         just cooked — gets a slow, continuous glow so it visually stands
         apart from the rest of the table's still-in-progress boxes without
         the cashier needing to open each one to check. */
      @keyframes rposBoxReadyPulse {
        0%, 100% { box-shadow:0 0 0 0 rgba(34,197,94,0.35); }
        50%      { box-shadow:0 0 0 7px rgba(34,197,94,0); }
      }
      .rpos-box-ready { animation:rposBoxReadyPulse 1.8s ease-in-out infinite; }
    </style>
  `;

  document.getElementById('rposBackBtn')?.addEventListener('click', handleBack);
  document.getElementById('rposKitchenBtn')?.addEventListener('click', () => navigate('kitchen'));
  // Mobile bottom tab bar — 'kd' (not 'kitchen') since this device is on
  // the LAN/phone lockdown; 'kitchen' isn't in that whitelist and would
  // black-screen it. "Orders" is just the active tab (you're already here);
  // no-op beyond the visual state, which render() already sets on entry.
  document.getElementById('rposMobileNavKitchen')?.addEventListener('click', () => navigate('kd'));
  document.getElementById('rposMobileNavRefresh')?.addEventListener('click', () => window.location.reload());
  document.getElementById('rposMobileNavLogout')?.addEventListener('click', () => window.logout?.());
  await refreshKotBadge();
  registerKotBadgeLiveRefresh();

  if (view === 'picker') await renderPickerView();
  else if (view === 'ordering') await renderOrderingView();
}

async function refreshKotBadge() {
  const pending = (await getKots()).filter(k => k.status !== 'served');
  const badgeHtml = pending.length > 0 ? `<span class="rpos-kot-badge">${pending.length}</span>` : '';
  const badge = document.getElementById('rposKotBadge');
  if (badge) badge.innerHTML = badgeHtml;
  // Mobile's bottom-nav Kitchen tab carries its own copy of this same badge
  // (the topbar one is hidden entirely on mobile — see render()).
  const mobileBadge = document.getElementById('rposMobileKotBadge');
  if (mobileBadge) mobileBadge.innerHTML = badgeHtml;
}

let kotBadgeLiveListenerRegistered = false;
// The topbar badge element itself persists across content-only re-renders
// (renderPickerView()/renderOrderingView() only replace #rposContent, not
// the whole shell render() builds) — so unlike those two, this doesn't
// need a full render() call, just refreshKotBadge() again directly. Same
// 'storage-change' + 'data-synced' pairing as the other three live-refresh
// fixes this session, so the count updates whether a ticket was resolved
// on this device or arrived via LAN sync from a separate one.
function registerKotBadgeLiveRefresh() {
  if (kotBadgeLiveListenerRegistered) return;
  const onKotChange = (e) => {
    if (e.detail?.store !== 'kots') return;
    if (!document.getElementById('rposKotBadge')) return;
    refreshKotBadge();
  };
  window.addEventListener('storage-change', onKotChange);
  window.addEventListener('data-synced', onKotChange);
  kotBadgeLiveListenerRegistered = true;
}

function handleBack() {
  const container = document.getElementById('page-container');
  mobileCartOpen = false;
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
  // The LAN/phone entry point has no 'dashboard' to go back to — it's
  // outside the mobile lockdown whitelist (router.js's
  // lockOutNonKitchenAccess()), so navigating there would black-screen this
  // same device. Nothing to do at the top level on mobile; the Back button
  // is hidden there anyway (see render()) — this is just the defensive floor.
  if (isMobile) return;
  navigate('dashboard');
}

// ── Picker view: order type, then (for dine-in) the table grid or a table's
// own box picker — for takeaway/delivery, the list of open orders. ────────
async function renderPickerView() {
  const area = document.getElementById('rposContent');
  if (!area) return;

  if (!orderType) {
    // "ethulaiyachum order iruka ilayanu mention pannanum" — before picking
    // a type, show whether it already has anything open, so staff don't
    // have to click in just to find out. Same open-order count Takeaway/
    // Delivery's own picker (renderCounterOrderPicker) and dine-in's table
    // grid both already compute from getCounterOrders() — just surfaced a
    // level earlier here.
    const openOrders = await getCounterOrders();
    const orderTypeCount = {
      'dine-in': openOrders.filter(o => o.orderType === 'dine-in').length,
      takeaway: openOrders.filter(o => o.orderType === 'takeaway').length,
      delivery: openOrders.filter(o => o.orderType === 'delivery').length,
    };
    const orderTypeCard = (type, icon, label) => {
      const count = orderTypeCount[type];
      return `
        <div class="rpos-order-type-btn" data-type="${type}" style="position:relative;">
          ${count > 0 ? `<span class="rpos-kot-badge" style="position:absolute; top:10px; right:10px;">${count}</span>` : ''}
          <i class="fa-solid ${icon}" style="font-size:28px; color:var(--primary);"></i>
          <div style="margin-top:10px; font-weight:700;">${label}</div>
          <div style="margin-top:3px; font-size:11px; color:var(--text-muted);">${count > 0 ? `${count} open` : 'Nothing open'}</div>
        </div>
      `;
    };
    area.innerHTML = `
      <div style="max-width:700px; margin:${isMobile ? '12px' : '60px'} auto; text-align:center;">
        <h2 style="font-size:${isMobile ? '17px' : '20px'}; font-weight:800; margin-bottom:${isMobile ? '16px' : '24px'};">What kind of order is this?</h2>
        <div style="display:grid; grid-template-columns:${isMobile ? '1fr' : 'repeat(3,1fr)'}; gap:${isMobile ? '12px' : '16px'};">
          ${orderTypeCard('dine-in', 'fa-utensils', 'Dine-in')}
          ${orderTypeCard('takeaway', 'fa-bag-shopping', 'Takeaway')}
          ${orderTypeCard('delivery', 'fa-motorcycle', 'Delivery')}
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
  // Fetched once for every table's tableReadyToBill() check below — a
  // table whose every active box is fully served gets the same green
  // "Ready to Bill" treatment the box picker already gives a single box,
  // right on the grid card, so staff can see which tables need collecting
  // without drilling into each one first.
  const kotsForReadyCheck = await getKots();

  area.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
      <h2 style="font-size:16px; font-weight:800;">Select a Table</h2>
      ${!isMobile ? `<a href="#tables" style="font-size:12px; color:var(--primary); font-weight:700;"><i class="fa-solid fa-gear"></i> Manage Tables</a>` : ''}
    </div>
    ${tables.length === 0 ? `
      <div class="card" style="padding:40px; text-align:center; color:var(--text-muted);">
        ${isMobile ? 'No tables set up yet — ask the shop owner to add tables from the main POS.' : 'No tables set up yet. <a href="#tables" style="color:var(--primary); font-weight:700;">Add tables</a> to get started.'}
      </div>
    ` : grouped.map(({ section, tables: sectionTables }) => `
      <div style="margin-bottom:22px;">
        ${grouped.length > 1 ? `<div style="display:flex; align-items:center; gap:8px; margin-bottom:12px; padding-bottom:6px; border-bottom:1px solid var(--border);"><span style="font-size:11px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:.5px;"><i class="fa-solid fa-layer-group" style="margin-right:6px; opacity:.5;"></i>${escapeHtml(section)}</span><span style="font-size:10.5px; color:var(--text-muted); background:var(--bg-elevated); border:1px solid var(--border); border-radius:999px; padding:1px 8px;">${sectionTables.length}</span></div>` : ''}
        <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(160px,1fr)); gap:14px;">
          ${sectionTables.map(t => {
            const occ = tableOccupancy(t, allParties);
            const capacity = tableDisplayCapacity(t, allTables);
            const statusKey = tableStatusKey(occ, capacity);
            const status = STATUS_META[statusKey];
            const elapsed = occ.oldestCreatedAt ? Date.now() - new Date(occ.oldestCreatedAt).getTime() : null;
            // Overrides the occupied/full styling above (not free/empty —
            // an unoccupied table has nothing to bill) once every active
            // box at this table is fully served. Same visual language the
            // box picker already uses for one box (rpos-box-ready's pulse,
            // the green tint) so "this needs collecting" reads the same
            // way everywhere on this screen.
            const ready = occ.isOccupied && tableReadyToBill(occ, kotsForReadyCheck);
            const cardBg = ready ? 'rgba(34,197,94,0.1)' : status.bg;
            const cardBorder = ready ? 'var(--success)' : 'var(--border)';
            const statusColor = ready ? 'var(--success)' : status.color;
            const statusLabel = ready ? 'Ready to Bill' : (occ.isOccupied ? `${occ.usedSeats}/${capacity} seated${occ.partyCount > 1 ? ` · ${occ.partyCount} boxes` : ''}` : status.label);
            return `
              <div class="rpos-table-card ${ready ? 'rpos-box-ready' : ''}" data-id="${t.id}" style="background:${cardBg}; border:1px solid ${cardBorder};">
                <div style="font-weight:800; font-size:16px;">${escapeHtml(tableDisplayName(t, allTables))}</div>
                <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">Seats ${capacity}</div>
                <div style="display:flex; align-items:center; justify-content:space-between; margin-top:12px; gap:8px;">
                  <div style="font-size:11px; font-weight:700; color:${statusColor};"><i class="fa-solid ${ready ? 'fa-circle-check' : 'fa-circle'}" style="font-size:${ready ? '11px' : '6px'}; margin-right:5px;"></i>${statusLabel}</div>
                  ${elapsed !== null ? `<div class="rpos-table-timer" data-created-at="${occ.oldestCreatedAt}" style="font-size:11px; font-weight:800; color:${timerTier(elapsed).color}; white-space:nowrap;">${formatElapsed(elapsed)}</div>` : ''}
                </div>
                ${occ.totalItems > 0 ? `<div style="font-size:10.5px; color:var(--text-muted); margin-top:6px;">${occ.totalItems} item(s)</div>` : ''}
                ${capacityBarHtml(occ.usedSeats, capacity, statusColor)}
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
  // Same "empty box shouldn't hold seats hostage" rule as tableOccupancy()
  // (utils/tableDisplay.js) — a party with zero items never actually ordered
  // anything, so its guest count doesn't count against remaining capacity
  // here either. The box itself still shows below either way (still
  // resumable) — this only affects the seat math.
  const usedSeats = parties.filter(p => (p.items?.length || 0) > 0).reduce((s, p) => s + (p.guestCount || 0), 0);
  const remaining = Math.max(0, capacity - usedSeats);
  // Checked per-box (not just "has this box been opened and looked at") so
  // a box that finished cooking while the cashier was elsewhere in the app
  // still shows up here as ready the moment this screen is looked at. One
  // getKots() call for every box on this table (partyServeStatus() takes
  // the already-fetched array), not one per box.
  const kotsForStatus = await getKots();
  const partiesWithStatus = parties.map(p => ({ p, serve: partyServeStatus(p, kotsForStatus) }));

  area.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; flex-wrap:wrap; gap:10px;">
      <h2 style="font-size:16px; font-weight:800;"><i class="fa-solid fa-chair"></i> ${escapeHtml(tableDisplayName(table, allTables))} — ${usedSeats}/${capacity} seated</h2>
      <button class="btn btn-ghost btn-sm" id="rposBackToTablesBtn"><i class="fa-solid fa-arrow-left"></i> All Tables</button>
    </div>
    <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(180px,1fr)); gap:14px;">
      ${partiesWithStatus.map(({ p, serve }) => {
        const elapsed = Date.now() - new Date(p.createdAt).getTime();
        const ready = serve.fullyServed;
        // A box with zero items — guest count entered, nothing ever
        // ordered — isn't really "in progress" (nothing's actually
        // happening, no timer worth watching). Shown with the same free/
        // neutral styling tableOccupancy() now treats it as, with its own
        // "Empty" label rather than the orange "In progress" one, and no
        // ticking elapsed timer implying urgency that isn't there.
        const isEmpty = (p.items?.length || 0) === 0;
        const cardBg = isEmpty ? STATUS_META.free.bg : (ready ? 'rgba(34,197,94,0.1)' : STATUS_META.occupied.bg);
        const cardBorder = isEmpty ? 'var(--border)' : (ready ? 'var(--success)' : 'var(--border)');
        const statusColor = isEmpty ? STATUS_META.free.color : (ready ? 'var(--success)' : STATUS_META.occupied.color);
        const statusLabel = isEmpty ? 'Empty — no order yet' : (ready ? 'Ready to Bill' : 'In progress');
        return `
          <div class="rpos-table-card rpos-box-enter ${ready ? 'rpos-box-ready' : ''}" data-id="${p.id}" style="background:${cardBg}; border:1px solid ${cardBorder};">
            <div style="font-weight:800; font-size:16px;">Box ${p.partyNumber || '?'}</div>
            <div style="font-size:11px; color:var(--text-muted); margin-top:2px;"><i class="fa-solid fa-users" style="margin-right:4px; opacity:.5;"></i>${p.guestCount || '—'} guests · ${p.items?.length || 0} item(s)</div>
            <div style="display:flex; align-items:center; justify-content:space-between; margin-top:12px; gap:8px;">
              <div class="rpos-box-status" style="font-size:11px; font-weight:700; color:${statusColor};"><i class="fa-solid ${ready ? 'fa-circle-check' : 'fa-circle'}" style="font-size:${ready ? '11px' : '6px'}; margin-right:5px;"></i>${statusLabel}</div>
              ${!isEmpty ? `<div class="rpos-table-timer" data-created-at="${p.createdAt}" style="font-size:11px; font-weight:800; color:${timerTier(elapsed).color}; white-space:nowrap;">${formatElapsed(elapsed)}</div>` : ''}
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
    }, remaining, `${remaining} seat${remaining === 1 ? '' : 's'} left on this table`, true);
  });
  startTablesTimerLoop();
  registerPartyPickerLiveRefresh();
}

let partyPickerLiveListenerRegistered = false;
// Kitchen staff marking a dish served (or another till adding/billing a box)
// happens completely outside this screen — without this, "Ready to Bill"
// would only ever update the next time the cashier happens to navigate away
// and back. Listens for BOTH 'storage-change' (a write made on this device)
// and 'data-synced' (the same write arriving here over LAN sync from a
// separate device — see the matching comment in Kitchen.js's own live
// refresh for why these are two different events, not one) — a genuinely
// separate Kitchen-display PC marking something ready should update this
// screen too, not just a change made locally. Guarded/self-checking the
// same way Kitchen.js's own live refresh is, since this page has no
// unmount hook to unregister it with.
function registerPartyPickerLiveRefresh() {
  if (partyPickerLiveListenerRegistered) return;
  const onRelevantChange = (e) => {
    if (e.detail?.store !== 'kots' && e.detail?.store !== 'counter_orders') return;
    if (!(view === 'picker' && drillTable)) return;
    if (!document.getElementById('rposContent')) return;
    renderTablePartyPicker(drillTable);
  };
  window.addEventListener('storage-change', onRelevantChange);
  window.addEventListener('data-synced', onRelevantChange);
  partyPickerLiveListenerRegistered = true;
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
  // Same two rules dine-in's table grid/box picker already got (see
  // tableOccupancy()/tableReadyToBill(), utils/tableDisplay.js) — a slot
  // opened but never actually ordered into shouldn't sit there forever
  // claiming to be "In progress" (this screen's version of the same "empty
  // box holding a table hostage" bug), and once everything's genuinely
  // served this card should say so at a glance, not just after opening it.
  const kotsForStatus = await getKots();

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
          const isEmpty = (o.items?.length || 0) === 0;
          const ready = !isEmpty && partyServeStatus(o, kotsForStatus).fullyServed;
          const cardBg = isEmpty ? STATUS_META.free.bg : (ready ? 'rgba(34,197,94,0.1)' : 'rgba(59,130,246,0.06)');
          const cardBorder = isEmpty ? 'var(--border)' : (ready ? 'var(--success)' : 'var(--border)');
          const statusColor = isEmpty ? STATUS_META.free.color : (ready ? 'var(--success)' : 'var(--warning)');
          const statusLabel = isEmpty ? 'Empty — no order yet' : (ready ? 'Ready to Bill' : 'In progress');
          return `
            <div class="rpos-table-card ${ready ? 'rpos-box-ready' : ''}" data-id="${o.id}" style="background:${cardBg}; border:1px solid ${cardBorder};">
              <div style="font-weight:800; font-size:16px;"><i class="fa-solid ${icon}" style="opacity:.4; margin-right:6px; font-size:13px;"></i>${escapeHtml(counterOrderLabel(o))}</div>
              <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">${o.items?.length || 0} item(s)</div>
              <div style="display:flex; align-items:center; justify-content:space-between; margin-top:12px; gap:8px;">
                <div style="font-size:11px; font-weight:700; color:${statusColor};"><i class="fa-solid ${ready ? 'fa-circle-check' : 'fa-circle'}" style="font-size:${ready ? '11px' : '6px'}; margin-right:5px;"></i>${statusLabel}</div>
                ${!isEmpty ? `<div class="rpos-counter-order-timer" data-created-at="${o.createdAt}" style="font-size:11px; font-weight:800; color:${timerTier(elapsed).color}; white-space:nowrap;">${formatElapsed(elapsed)}</div>` : ''}
              </div>
              ${o.contactPhone ? `<div style="font-size:10.5px; color:var(--text-muted); margin-top:6px;"><i class="fa-solid fa-phone" style="margin-right:4px; opacity:.5;"></i>${escapeHtml(o.contactPhone)}</div>` : ''}
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

// `capacity`, when given, is checked against what's entered. By default,
// exceeding it needs an explicit confirmation rather than being blocked
// outright (a shop might genuinely pull up an extra chair for a fresh,
// otherwise-empty table). Pass `hardCap: true` when `capacity` represents
// seats already taken by OTHER boxes on this same table (the "Add Party"
// and "edit this box's guest count" flows) — there's no "pull up a chair"
// option there, those seats are physically occupied by someone else's
// order right now, so this blocks outright instead of offering to
// override; the guidance is to free a seat (bill/move the other box) or
// increase the table's own capacity from Tables.js first, then come back —
// exactly what the user asked for after finding the soft "Continue Anyway"
// confirm let a second box claim seats that weren't actually free.
// `capacityLabel` overrides the default "seats up to N" wording — used when
// `capacity` actually means "seats left on this table", not its total.
function promptGuestCount(onConfirm, capacity = null, capacityLabel = null, hardCap = false) {
  const defaultCount = capacity ? Math.min(2, capacity) : 2;
  openModal({
    title: '<i class="fa-solid fa-users mr-8"></i> Party Size',
    body: `
      <div class="form-group">
        <label class="form-label">Number of guests</label>
        <input class="form-input" id="rposGuestCountInput" type="number" min="1" ${hardCap && capacity ? `max="${capacity}"` : ''} value="${defaultCount}" autofocus />
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
        if (hardCap) {
          showToast(`Only ${capacity} seat${capacity === 1 ? '' : 's'} left on this table — free one up, or increase this table's capacity from Tables first.`, 'error');
          return;
        }
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
// buildKitchenStatusMapFor()/summarizeCartIdStatus()/partyServeStatus() now
// live in utils/tableDisplay.js (shared with the table grids' own "Ready to
// Bill" check — see tableReadyToBill()) — this is just the thin wrapper
// bound to this module's live orderSessionId/selectedTable state. ─────────
async function buildKitchenStatusMap() {
  const kots = await getKots();
  return buildKitchenStatusMapFor(kots, orderSessionId, selectedTable?.id || null);
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
  // De-duped by name before rendering the filter chips. A device that spent
  // any time on the placeholder 'LOCAL_EXE' tenant before identifying with
  // its real licenseKey (see syncEngine.js's register_success handler and
  // db.js's getSettings() recovery — the LOCAL_EXE architecture notes) can
  // end up with genuinely duplicated category records locally (seen live:
  // one real device had "Food"/"Beverages"/"Desserts" each repeated 19-25
  // times) — nothing about picking a menu filter needs to show the same
  // category as several identical chips, regardless of how many duplicate
  // records exist underneath, so this collapses them for DISPLAY only
  // (doesn't touch/merge the underlying records — Categories.js's own
  // management page is still the right place to actually clean those up).
  const seenCategoryNames = new Set();
  const categories = (await getCategories()).filter(c => {
    const key = (c.name || '').trim().toLowerCase();
    if (!key || seenCategoryNames.has(key)) return false;
    seenCategoryNames.add(key);
    return true;
  });
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
          <input class="form-input" id="rposMenuSearch" placeholder="🔍 Search menu…" value="${escapeHtml(menuSearch)}" style="font-size:13px; ${isMobile ? 'height:44px; font-size:14px;' : ''}" />
        </div>
        <div class="rpos-cat-bar" style="display:flex; gap:8px; overflow-x:auto; padding-bottom:10px; margin-bottom:14px;">
          <div class="rpos-cat-tab ${!activeCategory ? 'active' : ''}" data-cat="">All</div>
          ${categories.map(c => `<div class="rpos-cat-tab ${activeCategory === c.name ? 'active' : ''}" data-cat="${escapeHtml(c.name)}">${escapeHtml(c.name)}</div>`).join('')}
        </div>
        <div style="${isMobile ? 'display:flex; flex-direction:column; gap:10px;' : 'display:grid; grid-template-columns:repeat(auto-fill, minmax(140px,1fr)); gap:12px;'}">
          ${products.length === 0 ? `<div style="${isMobile ? '' : 'grid-column:1/-1;'} text-align:center; padding:30px; color:var(--text-muted);">No items match</div>` : products.map(p => isMobile ? `
            <div class="rpos-product-card rpos-product-row" data-id="${p.id}">
              <div class="rpos-product-emoji">${p.emoji || '🍽️'}</div>
              <div class="rpos-product-info">
                <div class="rpos-product-name">${escapeHtml(p.name)}</div>
                <div class="rpos-product-price">${cur}${Number(p.price || 0).toFixed(2)}</div>
              </div>
              <div class="rpos-product-add-btn"><i class="fa-solid fa-plus"></i></div>
            </div>
          ` : `
            <div class="rpos-product-card" data-id="${p.id}">
              <div style="width:44px; height:44px; margin:0 auto; border-radius:12px; background:var(--bg-app); display:flex; align-items:center; justify-content:center; font-size:22px;">${p.emoji || '🍽️'}</div>
              <div style="font-size:12px; font-weight:700; margin-top:8px; text-align:center; line-height:1.3;">${escapeHtml(p.name)}</div>
              <div style="font-size:12px; color:var(--primary); font-weight:800; text-align:center; margin-top:3px;">${cur}${Number(p.price || 0).toFixed(2)}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="card rpos-cart-panel${isMobile && mobileCartOpen ? ' rpos-cart-open' : ''}" id="rposCartPanel" style="padding:16px; position:sticky; top:0;">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;" id="rposCartPeekHeader">
          <div style="width:28px; height:28px; border-radius:8px; background:var(--bg-app); display:flex; align-items:center; justify-content:center; font-size:13px;">🛒</div>
          <div style="font-size:13px; font-weight:800; flex:1;">Order <span style="color:var(--text-muted); font-weight:600;">(${store.cart.length} item${store.cart.length === 1 ? '' : 's'})</span></div>
          ${isMobile ? `
            <div style="font-size:13px; font-weight:800; color:var(--primary);">${cur}${totals.total.toFixed(2)}</div>
            <i class="fa-solid ${mobileCartOpen ? 'fa-chevron-down' : 'fa-chevron-up'}" style="font-size:12px; color:var(--text-muted);"></i>
          ` : ''}
        </div>
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
                <div class="rpos-cart-status-chip" style="color:${meta.color};">
                  <i class="fa-solid ${meta.icon}"></i> ${sentQty}x ${meta.label}${i.course ? ` · ${escapeHtml(i.course)}` : ''}
                  ${pendingQty > 0 ? `<span style="color:var(--warning); margin-left:2px;">+${pendingQty} new</span>` : ''}
                  ${kStatus === 'not_found' ? `<button class="rpos-cart-chip-action rpos-resend-item" data-cart-id="${i.cartId}" title="Resend to kitchen"><i class="fa-solid fa-rotate-right" style="color:var(--danger);"></i></button>` : ''}
                  ${pendingQty <= 0 && kStatus !== 'served' && kStatus !== 'not_found' ? `<button class="rpos-cart-chip-action rpos-modify-item" data-cart-id="${i.cartId}" title="Modify"><i class="fa-solid fa-pen"></i></button>` : ''}
                </div>
              `;
            }
            return `
            <div class="rpos-cart-item">
              <div class="rpos-cart-item-top">
                <div class="rpos-cart-item-name">${escapeHtml(i.name)}</div>
                <button class="rpos-cart-item-remove rpos-remove-item" data-cart-id="${i.cartId}" title="Remove"><i class="fa-solid fa-xmark"></i></button>
              </div>
              ${(i.modifiers?.length || i.notes) ? `<div style="font-size:10.5px; color:var(--text-muted); margin-top:2px;">${[...(i.modifiers || []), i.notes].filter(Boolean).map(escapeHtml).join(' · ')}</div>` : ''}
              ${sentBadge}
              <div class="rpos-cart-item-bottom">
                <div class="rpos-qty-stepper">
                  <button class="rpos-qty-minus" data-cart-id="${i.cartId}"><i class="fa-solid fa-minus"></i></button>
                  <span>${i.qty}</span>
                  <button class="rpos-qty-plus" data-cart-id="${i.cartId}"><i class="fa-solid fa-plus"></i></button>
                </div>
                ${sentQty <= 0 ? `
                  <button class="rpos-cart-item-customize rpos-customize-item" data-cart-id="${i.cartId}" title="Customize"><i class="fa-solid fa-sliders"></i></button>
                  <select class="form-input rpos-course-select" data-cart-id="${i.cartId}" style="font-size:10px; padding:2px 4px; max-width:82px; height:auto;">
                    <option value="">Course</option>
                    ${COURSES.map(c => `<option value="${c}" ${i.course === c ? 'selected' : ''}>${c}</option>`).join('')}
                  </select>
                ` : ''}
                <div class="rpos-cart-item-price">${cur}${(i.price * i.qty).toFixed(2)}</div>
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
          ${!isMobile ? `
            <button class="btn btn-ghost" id="rposPreviewBillBtn" ${store.cart.length === 0 ? 'disabled' : ''}><i class="fa-solid fa-print"></i> Preview Bill</button>
            <button class="btn btn-primary" id="rposBillBtn" ${store.cart.length === 0 || !serveStatus.fullyServed ? 'disabled' : ''}><i class="fa-solid fa-receipt"></i> Bill Now — ${cur}${totals.total.toFixed(2)}</button>
            ${store.cart.length > 0 && !serveStatus.fullyServed ? `<div style="font-size:11px; color:var(--warning); text-align:center; display:flex; align-items:center; justify-content:center; gap:6px;"><i class="fa-solid fa-hourglass-half"></i> ${serveStatus.outstanding} dish${serveStatus.outstanding === 1 ? '' : 'es'} still not served — check Kitchen</div>` : ''}
          ` : ''}
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
      // Same "empty box doesn't hold seats hostage" rule as tableOccupancy() —
      // another box with zero items shouldn't shrink how many seats this
      // box can claim for itself.
      const usedByOthers = otherParties.filter(p => (p.items?.length || 0) > 0).reduce((s, p) => s + (p.guestCount || 0), 0);
      const remaining = Math.max(0, capacity - usedByOthers);
      promptGuestCount(async (count) => {
        guestCount = count;
        await persistOrderState();
        await renderOrderingView();
      }, remaining, `${remaining} seat${remaining === 1 ? '' : 's'} available for this box (table seats ${capacity} total).`, true);
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
  // Mobile-only: tapping the cart's peek header (the bit that's still
  // visible when the sheet is collapsed) expands/collapses it. A plain
  // class toggle — nothing about the cart's actual content changed, so no
  // need to re-render it, just flip the CSS transform (.rpos-cart-open,
  // see render()'s <style>) and swap the chevron.
  if (isMobile) {
    document.getElementById('rposCartPeekHeader')?.addEventListener('click', () => {
      mobileCartOpen = !mobileCartOpen;
      document.getElementById('rposCartPanel')?.classList.toggle('rpos-cart-open', mobileCartOpen);
      const chevron = document.querySelector('#rposCartPeekHeader .fa-chevron-up, #rposCartPeekHeader .fa-chevron-down');
      if (chevron) chevron.className = `fa-solid ${mobileCartOpen ? 'fa-chevron-down' : 'fa-chevron-up'}`;
    });
  }
  registerOrderingViewLiveRefresh();
}

let orderingViewLiveListenerRegistered = false;
// Marking a dish served happens on the KITCHEN side — Kitchen.js's own
// board, or the popped-out Kitchen Display window, both completely outside
// this screen — without this, a cart item's "In kitchen queue"/"Served"
// badge and the Bill Now button's disabled state only ever updated on the
// NEXT unrelated action that happened to re-render this view (a qty
// tap, a search keystroke), not the moment the dish was actually served.
// Same 'storage-change' (this device) + 'data-synced' (arrived via LAN
// sync from a separate device) pairing as Kitchen.js's and the box
// picker's own live refresh, for the same reason. Guarded/self-checking
// the same way, since this page has no unmount hook to unregister it with.
function registerOrderingViewLiveRefresh() {
  if (orderingViewLiveListenerRegistered) return;
  const onKotChange = (e) => {
    if (e.detail?.store !== 'kots') return;
    if (!(view === 'ordering')) return;
    if (!document.getElementById('rposContent')) return;
    renderOrderingView();
  };
  window.addEventListener('storage-change', onKotChange);
  window.addEventListener('data-synced', onKotChange);
  orderingViewLiveListenerRegistered = true;
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

  // This order's Nth ticket ever (1 = the original send). Without this,
  // items added after the first Send to Kitchen produce a ticket that
  // looks identical to a brand-new order with the same name — kitchen
  // staff have no way to tell "more for the order already in progress"
  // from "a second, separate order that happens to share a label". Counted
  // against every KOT this order has ever had (not just what's still on
  // the Kitchen board), so the number stays right even once an earlier
  // wave has already been fully served and dropped off.
  const priorWaves = orderSessionId ? (await getKots()).filter(k => k.orderSessionId === orderSessionId).length : 0;
  const waveNumber = priorWaves + 1;

  let kot;
  try {
    kot = await saveKot({
      tableId: selectedTable?.id || null,
      tableName: ticketLabel,
      orderType,
      orderSessionId,
      waveNumber,
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
      ${kot.waveNumber > 1 ? `<div style="text-align:center; font-size:12px; font-weight:800; border:1px solid #000; padding:3px; margin:4px 0;">⚠ ADD-ON #${kot.waveNumber} — MORE FOR AN ORDER ALREADY IN PROGRESS</div>` : ''}
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
