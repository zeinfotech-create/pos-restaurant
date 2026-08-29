// ============================================================
// tableDisplay.js — small shared helpers for rendering restaurant tables,
// used by both Tables.js (table management) and RestaurantPOS.js (the
// dine-in table picker) so the two views never drift out of sync on how
// status colors, occupied-timers, sections, and merged tables are shown.
// ============================================================

export const STATUS_META = {
  // 'free' uses --info rather than --primary/--success deliberately — some
  // themes retint --primary (e.g. green/purple/teal storefronts), which
  // would make "free" and "occupied" hard to tell apart at a glance on
  // those themes. --info is never re-themed, so free tables read as the
  // same light blue everywhere.
  free: { label: 'Free', color: 'var(--info)', bg: 'rgba(59,130,246,0.08)' },
  occupied: { label: 'Occupied', color: 'var(--warning)', bg: 'rgba(245,158,11,0.08)' },
  // A table can have open boxes but still have spare seats (see
  // tableOccupancy()) — that's still 'occupied' (orange). Only once every
  // seat is actually taken does it become 'full' (gray) — there's no more
  // room to seat a new party here without freeing something up first.
  full: { label: 'Full', color: 'var(--text-muted)', bg: 'rgba(100,116,139,0.12)' },
  billed: { label: 'Billed', color: 'var(--danger)', bg: 'rgba(239,68,68,0.08)' },
  merged: { label: 'Merged', color: 'var(--text-muted)', bg: 'rgba(148,163,184,0.08)' },
};

// Which STATUS_META key a table's card should render as — 'free' (no
// parties at all), 'full' (every seat taken, no room for a new party
// without one first freeing up), or 'occupied' (some parties seated, but
// seats still remain). `occ` is a tableOccupancy() result; `capacity` is
// that table's own effective (merge-aware) capacity.
export function tableStatusKey(occ, capacity) {
  if (!occ.isOccupied) return 'free';
  if (occ.usedSeats >= capacity) return 'full';
  return 'occupied';
}

// A table merged into another is absorbed into its primary's card (see
// tableDisplayName()) and hidden from grids entirely — it only resurfaces
// once explicitly unmerged from Tables.js.
export function visibleTables(tables) {
  return tables.filter(t => t.status !== 'merged');
}

export function tableDisplayName(table, allTables) {
  if (!table.mergedTableIds?.length) return table.name;
  const names = table.mergedTableIds.map(id => allTables.find(t => t.id === id)?.name).filter(Boolean);
  return [table.name, ...names].join(' + ');
}

export function tableDisplayCapacity(table, allTables) {
  if (!table.mergedTableIds?.length) return table.capacity || 4;
  const extra = table.mergedTableIds.reduce((sum, id) => sum + (allTables.find(t => t.id === id)?.capacity || 4), 0);
  return (table.capacity || 4) + extra;
}

// Groups tables by their `section` field (e.g. "Terrace", "AC Hall"),
// defaulting anything unset to "Main" — "Main" always sorts first, the rest
// alphabetically, so a shop with no sections configured sees one plain group.
export function groupBySection(tables) {
  const groups = {};
  tables.forEach(t => {
    const section = t.section?.trim() || 'Main';
    (groups[section] = groups[section] || []).push(t);
  });
  return Object.keys(groups)
    .sort((a, b) => (a === 'Main' ? -1 : b === 'Main' ? 1 : a.localeCompare(b)))
    .map(section => ({ section, tables: groups[section] }));
}

// How long a table has been occupied — colour-tiered so a glance at the
// floor tells staff which tables need a bill-check, not just food.
export function occupiedElapsedMs(table) {
  if (!table.occupiedAt) return null;
  return Date.now() - new Date(table.occupiedAt).getTime();
}

// A table's occupancy is derived live from whatever CounterOrder docs
// reference it as `tableId` — table SHARING (multiple independent parties,
// each their own order/bill, on one physical table's capacity) means a
// table can have 0, 1, or several of these at once, so there's no single
// "is this table occupied" flag to trust on the Table doc itself anymore.
// `allParties` is every CounterOrder currently open (across every table);
// pass the same array in for every table you're computing this for in one
// render rather than re-fetching per table.
export function tableOccupancy(table, allParties) {
  const parties = allParties.filter(p => p.tableId === table.id);
  // A party with a guest count entered but ZERO items ever added — someone
  // opened the table (by mistake, or just to look), never actually ordered
  // anything — shouldn't hold seats/occupied-status hostage indefinitely.
  // Excluded from every stat below; the RAW `parties` list (unfiltered)
  // is still returned as-is so the box picker can still show/resume it —
  // this only affects whether it counts as "occupying" the table.
  const activeParties = parties.filter(p => (p.items?.length || 0) > 0);
  const usedSeats = activeParties.reduce((sum, p) => sum + (p.guestCount || 0), 0);
  const totalItems = activeParties.reduce((sum, p) => sum + (p.items?.length || 0), 0);
  const oldest = activeParties.reduce((oldest, p) => (!oldest || new Date(p.createdAt) < new Date(oldest.createdAt)) ? p : oldest, null);
  return {
    parties,
    isOccupied: activeParties.length > 0,
    partyCount: activeParties.length,
    usedSeats,
    totalItems,
    oldestCreatedAt: oldest?.createdAt || null,
  };
}

// A slim rounded fill bar for seats-used-vs-capacity — reused by both
// Tables.js's card grid and RestaurantPOS.js's table grid so occupancy
// reads at a glance instead of needing to parse "X/Y seated" text first.
// Shown at 0% width (not omitted) for a free table so every card in a grid
// keeps the same rhythm/height rather than some having the bar and others
// not.
export function capacityBarHtml(used, total, color) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return `<div style="height:5px; border-radius:999px; background:rgba(100,116,139,0.16); overflow:hidden; margin-top:9px;"><div style="height:100%; width:${pct}%; background:${color}; border-radius:999px; transition:width .3s ease;"></div></div>`;
}

// A small rounded status/label pill — shared markup so every "Cancelled" /
// "Served" / "Ready to Bill" / "Add-on" style badge across Tables.js,
// RestaurantPOS.js and Kitchen.js looks like the same visual language
// instead of each screen inventing its own inline span styling. `bg` is
// passed explicitly (rather than derived from `color`) to avoid relying on
// CSS color-mix()/relative-color support — plain rgba() literals, same as
// STATUS_META above, work everywhere this app runs.
export function pillHtml(text, color, bg, opts = {}) {
  const { icon = null, filled = false } = opts;
  const style = filled ? `background:${color}; color:white;` : `background:${bg}; color:${color};`;
  return `<span style="display:inline-flex; align-items:center; gap:4px; font-size:10px; font-weight:800; padding:2px 8px; border-radius:999px; white-space:nowrap; letter-spacing:.2px; ${style}">${icon ? `<i class="fa-solid ${icon}"></i>` : ''}${text}</span>`;
}

export function formatElapsed(ms) {
  const mins = Math.max(0, Math.floor(ms / 60000));
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function timerTier(ms) {
  const mins = ms / 60000;
  if (mins < 30) return { color: 'var(--success)' };
  if (mins < 60) return { color: 'var(--warning)' };
  return { color: 'var(--danger)' };
}

// ============================================================
// Kitchen-status derivation — shared by RestaurantPOS.js (its box picker
// and live cart) and any table GRID that wants to show a "Ready to Bill"
// state without the cashier needing to drill into each table first
// (Tables.js's own grid, RestaurantPOS.js's table-picker grid). Moved here
// from RestaurantPOS.js's own private copies specifically so a table
// grid's "is this table ready to bill" check and a box's own "is THIS box
// ready" check can never quietly drift apart into two different answers —
// one shared definition of "served" for the whole app.
// ============================================================

// Collapses every "did the kitchen serve this portion" entry for one cart
// line into a single status word. A cartId can end up with MORE than one
// KOT entry — re-adding an already-sent item un-fires the whole line, and
// Modify voids the old entry and creates a fresh one on the next Send —
// so "served" only applies once every non-voided entry is served.
export function summarizeCartIdStatus(statuses) {
  // No entry at all is NOT the same as "queued" — a genuinely pending item
  // always has a real KOT entry (sendToKitchen() creates one before
  // marking the cart item sent). Zero entries means the link between this
  // cart item and its kitchen ticket is broken.
  if (!statuses || statuses.length === 0) return 'not_found';
  const live = statuses.filter(s => s !== 'voided');
  if (live.length === 0) return 'served'; // every portion of this line was cancelled — nothing left to wait on
  if (live.every(s => s === 'served')) return 'served';
  if (live.some(s => s === 'ready')) return 'ready'; // at least one portion ready, though not everything is done yet
  return 'pending';
}

// Every KOT item entry for one order session (or table, for backward
// compatibility with pre-table-sharing builds where orderSessionId was the
// TABLE's id), keyed by cartId -> array of itemStatus strings. `allKots` is
// every currently-open KOT — fetch once via getKots() and pass the SAME
// array in for every party/session being checked in one render, rather
// than re-fetching per party (this is what lets a whole table grid's worth
// of "is this table ready" checks cost one getKots() call, not N).
export function buildKitchenStatusMapFor(allKots, sessionId, tableId = null) {
  const map = new Map();
  if (!sessionId) return map;
  const kots = allKots.filter(k =>
    k.orderSessionId === sessionId ||
    (tableId && k.orderSessionId === tableId) ||
    (!k.orderSessionId && tableId && k.tableId === tableId)
  );
  kots.forEach(kot => (kot.items || []).forEach(i => {
    if (!i.cartId) return;
    const arr = map.get(i.cartId) || [];
    arr.push(i.itemStatus || 'pending');
    map.set(i.cartId, arr);
  }));
  return map;
}

// Is EVERY item in this party/box's own saved `items` snapshot actually
// served (not just cooked)? Lets a table grid or the box picker mark a box
// "Ready to Bill" the moment its kitchen work is genuinely done, without
// the cashier needing to open its cart first.
export function partyServeStatus(party, allKots) {
  const items = party.items || [];
  if (items.length === 0) return { outstanding: 0, fullyServed: false }; // nothing ordered yet isn't "ready to bill" either
  const kitchenStatusMap = buildKitchenStatusMapFor(allKots, party.id, party.tableId);
  let outstanding = 0;
  items.forEach(i => {
    if (i.qty > (i.sentQty || 0)) { outstanding++; return; }
    if (summarizeCartIdStatus(kitchenStatusMap.get(i.cartId)) !== 'served') outstanding++;
  });
  return { outstanding, fullyServed: outstanding === 0 };
}

// A table's own "ready to bill" flag for grid cards — true only once
// EVERY active (non-empty — see tableOccupancy()) party at this table is
// fully served. A single-box table simply mirrors that box's own status;
// a shared table with several boxes only counts as ready once ALL of them
// are, since there's still genuinely occupied/active work at the table
// otherwise. `occ` is this table's own tableOccupancy() result (its
// `.parties` field, unfiltered, is what gets checked here).
export function tableReadyToBill(occ, allKots) {
  const activeParties = occ.parties.filter(p => (p.items?.length || 0) > 0);
  if (activeParties.length === 0) return false;
  return activeParties.every(p => partyServeStatus(p, allKots).fullyServed);
}

// "Box N" is a cashier/front-of-house term (RestaurantPOS.js's own table
// party picker — "Add Party", Box 1/2/3 cards) — a KOT's own tableName
// field is stamped with that exact same string at sendToKitchen() time
// (currentOrderLabel()), so it shows up verbatim on the Kitchen board and
// printed ticket too, where "Box" means nothing to kitchen staff. This is
// a DISPLAY-ONLY relabel for those two kitchen-facing spots specifically —
// the underlying stored tableName (and every cashier-facing screen) is
// untouched, so "Box 1"/"Add Party"/etc. still read exactly as before
// everywhere a cashier actually looks. "Party" chosen to match the
// concept's own existing name elsewhere in this app (the "Add Party"
// button, the partyNumber field itself) rather than inventing a new,
// unrelated word just for this one spot.
export function kitchenFacingOrderLabel(tableName) {
  if (!tableName) return tableName;
  return tableName.replace(/ · Box (\d+)$/, ' · Party $1');
}
