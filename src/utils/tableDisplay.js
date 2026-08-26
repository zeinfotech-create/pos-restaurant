// ============================================================
// tableDisplay.js — small shared helpers for rendering restaurant tables,
// used by both Tables.js (table management) and RestaurantPOS.js (the
// dine-in table picker) so the two views never drift out of sync on how
// status colors, occupied-timers, sections, and merged tables are shown.
// ============================================================

export const STATUS_META = {
  free: { label: 'Free', color: 'var(--success)', bg: 'rgba(34,197,94,0.08)' },
  occupied: { label: 'Occupied', color: 'var(--warning)', bg: 'rgba(245,158,11,0.08)' },
  billed: { label: 'Billed', color: 'var(--danger)', bg: 'rgba(239,68,68,0.08)' },
  merged: { label: 'Merged', color: 'var(--text-muted)', bg: 'rgba(148,163,184,0.08)' },
};

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
  const usedSeats = parties.reduce((sum, p) => sum + (p.guestCount || 0), 0);
  const totalItems = parties.reduce((sum, p) => sum + (p.items?.length || 0), 0);
  const oldest = parties.reduce((oldest, p) => (!oldest || new Date(p.createdAt) < new Date(oldest.createdAt)) ? p : oldest, null);
  return {
    parties,
    isOccupied: parties.length > 0,
    partyCount: parties.length,
    usedSeats,
    totalItems,
    oldestCreatedAt: oldest?.createdAt || null,
  };
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
