// ============================================================
// Tables.js — Restaurant table management (add/edit/delete/merge tables,
// see live status + occupied timers, grouped by section). The actual
// order-taking happens in RestaurantPOS.js — this page only manages the
// table *definitions* and lets staff glance at who's occupied/free, same
// separation as Categories.js manages category definitions while POS.js
// does the actual selling.
// ============================================================

import { getTables, saveTable, deleteTable, getCounterOrders, getKots, getReservations, saveReservation, updateReservationStatus, deleteReservation, getWaitlist, saveWaitlistEntry, updateWaitlistStatus, deleteWaitlistEntry } from '../db.js';
import { openModal, closeModal, showConfirm } from '../components/Modal.js';
import { showToast } from '../components/Toast.js';
import { navigate } from '../router.js';
import { STATUS_META, visibleTables, tableDisplayName, tableDisplayCapacity, groupBySection, tableOccupancy, tableStatusKey, capacityBarHtml, formatElapsed, timerTier, tableReadyToBill, formatReservationTime } from '../utils/tableDisplay.js';
import { syncEngine } from '../services/syncEngine.js';
import QRCode from 'qrcode';

let timerInterval = null;
// 'tables' | 'reservations' | 'waitlist' — a plain in-page tab, not a
// route, so this page's own back-button/nav-item behavior doesn't need to
// change at all.
let activeTablesTab = 'tables';

export async function renderTables(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Tables</div>
        <div class="page-subtitle">Manage your dining tables — click a free table to start taking an order</div>
      </div>
      <button class="btn btn-primary" id="addTableBtn" style="${activeTablesTab !== 'tables' ? 'display:none' : ''}">
        <i class="fa-solid fa-plus"></i> New Table
      </button>
      <button class="btn btn-primary" id="addReservationBtn" style="${activeTablesTab !== 'reservations' ? 'display:none' : ''}">
        <i class="fa-solid fa-calendar-plus"></i> New Reservation
      </button>
      <button class="btn btn-primary" id="addWaitlistBtn" style="${activeTablesTab !== 'waitlist' ? 'display:none' : ''}">
        <i class="fa-solid fa-user-plus"></i> Add to Waitlist
      </button>
    </div>
    <div style="display:flex; gap:8px; margin-bottom:18px; border-bottom:1px solid var(--border);">
      <button class="btn btn-ghost tables-tab-btn ${activeTablesTab === 'tables' ? 'active-tab' : ''}" data-tab="tables" style="border-radius:8px 8px 0 0; ${activeTablesTab === 'tables' ? 'border-bottom:2px solid var(--primary); color:var(--primary);' : ''}"><i class="fa-solid fa-chair"></i> Tables</button>
      <button class="btn btn-ghost tables-tab-btn ${activeTablesTab === 'reservations' ? 'active-tab' : ''}" data-tab="reservations" style="border-radius:8px 8px 0 0; ${activeTablesTab === 'reservations' ? 'border-bottom:2px solid var(--primary); color:var(--primary);' : ''}"><i class="fa-solid fa-calendar-check"></i> Reservations</button>
      <button class="btn btn-ghost tables-tab-btn ${activeTablesTab === 'waitlist' ? 'active-tab' : ''}" data-tab="waitlist" style="border-radius:8px 8px 0 0; ${activeTablesTab === 'waitlist' ? 'border-bottom:2px solid var(--primary); color:var(--primary);' : ''}"><i class="fa-solid fa-users-line"></i> Waitlist</button>
    </div>
    <div id="tablesContent"></div>
  `;
  container.querySelectorAll('.tables-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => { activeTablesTab = btn.dataset.tab; renderTables(container); });
  });
  document.getElementById('addReservationBtn')?.addEventListener('click', () => openReservationForm(null));
  document.getElementById('addWaitlistBtn')?.addEventListener('click', () => openWaitlistForm());
  if (activeTablesTab === 'reservations') {
    await renderReservationsContent();
  } else if (activeTablesTab === 'waitlist') {
    await renderWaitlistContent();
  } else {
    await renderTablesContent();
  }
}

async function renderTablesContent() {
  const area = document.getElementById('tablesContent');
  if (!area) return;

  const allTables = await getTables();
  const tables = visibleTables(allTables).sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true }));
  const grouped = groupBySection(tables);
  // Occupancy is derived live from open dine-in CounterOrders (table
  // SHARING means a table can have several independent parties/"boxes" at
  // once) — never trusted off the table doc itself, see tableOccupancy().
  const allParties = (await getCounterOrders()).filter(o => o.orderType === 'dine-in');
  // For renderTableCard()'s "Ready to Bill" check below (tableReadyToBill())
  // — fetched once for the whole grid, not once per card.
  const allKots = await getKots();
  // Today's still-upcoming confirmed reservations, keyed by table — lets a
  // FREE table's card flag "someone's booked this for later today" instead
  // of looking indistinguishable from a table nobody's coming for, without
  // touching anything about how an already-OCCUPIED table displays (that
  // status stays the more urgent thing to show).
  const todayStr = new Date().toISOString().slice(0, 10);
  const todaysReservations = (await getReservations()).filter(r => r.status === 'confirmed' && r.reservationDate === todayStr && r.tableIds?.length);
  const reservationsByTable = new Map();
  todaysReservations.forEach(r => {
    // A combined-table booking flags EVERY table it covers, not just the
    // first — a guest is still coming for Table 4 even if Table 3 is the
    // one whose id happens to sort first in the array.
    r.tableIds.forEach(tid => {
      if (!reservationsByTable.has(tid)) reservationsByTable.set(tid, []);
      reservationsByTable.get(tid).push(r);
    });
  });
  reservationsByTable.forEach(list => list.sort((a, b) => a.reservationTime.localeCompare(b.reservationTime)));

  area.innerHTML = `
    ${tables.length === 0 ? `
      <div class="card" style="padding:48px; text-align:center; color:var(--text-muted);">
        <i class="fa-solid fa-chair" style="font-size:36px; opacity:0.2; margin-bottom:12px; display:block"></i>
        <div style="font-size:14px; font-weight:700">No tables yet</div>
        <div style="font-size:12px; margin-top:4px">Click "New Table" to add your first one</div>
      </div>
    ` : grouped.map(({ section, tables: sectionTables }) => `
      <div style="margin-bottom:22px;">
        ${grouped.length > 1 ? `<div style="display:flex; align-items:center; gap:8px; margin-bottom:12px; padding-bottom:6px; border-bottom:1px solid var(--border);"><span style="font-size:12px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:.5px;"><i class="fa-solid fa-layer-group" style="margin-right:6px; opacity:.5;"></i>${escapeAttr(section)}</span><span style="font-size:10.5px; color:var(--text-muted); background:var(--bg-elevated); border:1px solid var(--border); border-radius:999px; padding:1px 8px;">${sectionTables.length}</span></div>` : ''}
        <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:14px;">
          ${sectionTables.map(t => renderTableCard(t, allTables, allParties, allKots, reservationsByTable.get(t.id))).join('')}
        </div>
      </div>
    `).join('')}
    <style>
      /* Same shadow scale the app's own .card class uses (style.css) —
         reused here rather than inventing new numbers, so a table card
         reads as visually consistent with every other card in the app. */
      .table-card { box-shadow:0 4px 12px rgba(0,0,0,.05); transition:transform .2s cubic-bezier(.4,0,.2,1), box-shadow .2s cubic-bezier(.4,0,.2,1); }
      .table-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,.1); }
      /* Edit/merge/delete stay findable at reduced opacity (not fully
         hidden — a touchscreen till has no real hover to reveal them with)
         but step forward on hover/focus so the default floor view reads as
         "which tables are free" first, not a wall of identical buttons. */
      .table-card-actions { opacity:.4; transition:opacity .15s ease; }
      .table-card:hover .table-card-actions, .table-card:focus-within .table-card-actions { opacity:1; }
      /* A table whose every active box is fully served gets a slow,
         continuous glow so "this needs collecting" stands out from the
         rest of the grid without opening each table first. Same
         keyframes/class name as RestaurantPOS.js's own box picker and
         table grid (each page injects its own scoped <style>, so this is
         a deliberate copy, not a shared import) — kept pixel-identical on
         purpose so the same state reads the same way everywhere. */
      @keyframes rposBoxReadyPulse {
        0%, 100% { box-shadow:0 0 0 0 rgba(34,197,94,0.35); }
        50%      { box-shadow:0 0 0 7px rgba(34,197,94,0); }
      }
      .rpos-box-ready { animation:rposBoxReadyPulse 1.8s ease-in-out infinite; }
    </style>
  `;

  await setupTablesListeners();
  startTimerLoop();
}

// ── Reservations — advance table bookings ("6pm, party of 4"). Deliberately
// NOT pinned to a specific table (see db.js's KEYS.RESERVATIONS comment) —
// this is a reminder/pre-booking list; staff seat the party into whichever
// table's actually free when they arrive, same as any walk-in, and mark
// the reservation Seated here purely as a record-keeping step. ──────────
const RESERVATION_STATUS_META = {
  confirmed: { label: 'Confirmed', color: 'var(--info, #3b82f6)', bg: 'rgba(59,130,246,0.08)' },
  seated: { label: 'Seated', color: 'var(--success)', bg: 'rgba(34,197,94,0.08)' },
  cancelled: { label: 'Cancelled', color: 'var(--text-muted)', bg: 'var(--bg-app)' },
  'no-show': { label: 'No-show', color: 'var(--danger)', bg: 'rgba(239,68,68,0.08)' },
};

async function renderReservationsContent() {
  const area = document.getElementById('tablesContent');
  if (!area) return;

  const all = await getReservations();
  // Upcoming first (today/future, still confirmed), then everything else
  // (past, seated, cancelled, no-show) below as history — a reservation
  // list that's useful for "what's coming up" first, without deleting the
  // record of what already happened.
  const todayStr = new Date().toISOString().slice(0, 10);
  const upcoming = all.filter(r => r.status === 'confirmed' && r.reservationDate >= todayStr);
  const history = all.filter(r => !(r.status === 'confirmed' && r.reservationDate >= todayStr))
    .sort((a, b) => `${b.reservationDate} ${b.reservationTime}`.localeCompare(`${a.reservationDate} ${a.reservationTime}`));

  const groupByDate = (list) => {
    const map = new Map();
    list.forEach(r => {
      if (!map.has(r.reservationDate)) map.set(r.reservationDate, []);
      map.get(r.reservationDate).push(r);
    });
    return [...map.entries()];
  };

  const formatDateLabel = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00');
    const isToday = dateStr === todayStr;
    const isTomorrow = dateStr === new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const base = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    return isToday ? `Today · ${base}` : isTomorrow ? `Tomorrow · ${base}` : base;
  };

  const reservationCard = (r) => {
    const meta = RESERVATION_STATUS_META[r.status] || RESERVATION_STATUS_META.confirmed;
    return `
      <div class="table-card" data-res-id="${r.id}" style="padding:14px 16px; border-radius:12px; border:1px solid var(--border); background:${meta.bg}; cursor:default;">
        <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px;">
          <div>
            <div style="font-size:15px; font-weight:800;">${escapeAttr(r.customerName || 'Guest')}</div>
            <div style="font-size:11.5px; color:var(--text-muted); margin-top:2px;">${escapeAttr(r.customerPhone || '')}</div>
          </div>
          <div style="font-size:10.5px; font-weight:800; color:${meta.color}; white-space:nowrap;">${meta.label}</div>
        </div>
        <div style="display:flex; align-items:center; gap:14px; margin-top:10px; font-size:12px; color:var(--text-secondary); flex-wrap:wrap;">
          <span><i class="fa-solid fa-clock" style="opacity:.6; margin-right:4px;"></i>${formatReservationTime(r.reservationTime)}</span>
          <span><i class="fa-solid fa-user-group" style="opacity:.6; margin-right:4px;"></i>${r.guestCount || 1} guest${(r.guestCount || 1) === 1 ? '' : 's'}</span>
        </div>
        ${r.tableNames?.length ? `<div style="font-size:11.5px; font-weight:700; color:var(--primary); margin-top:6px;"><i class="fa-solid fa-chair" style="opacity:.7; margin-right:4px;"></i>${escapeAttr(r.tableSection && r.tableSection !== 'Main' ? `${r.tableSection} · ${r.tableNames.join(' + ')}` : r.tableNames.join(' + '))}${r.tableNames.length > 1 ? ` (${r.tableCapacity} seats combined)` : ''}</div>` : ''}
        ${r.notes ? `<div style="font-size:11px; color:var(--text-muted); margin-top:6px; font-style:italic;">${escapeAttr(r.notes)}</div>` : ''}
        <div style="display:flex; gap:6px; margin-top:12px; flex-wrap:wrap;">
          ${r.status === 'confirmed' ? `
            <button class="btn btn-primary btn-sm seat-reservation-btn" data-id="${r.id}"><i class="fa-solid fa-chair"></i> Seat Now</button>
            <button class="btn btn-ghost btn-sm edit-reservation-btn" data-id="${r.id}"><i class="fa-solid fa-pen"></i></button>
            <button class="btn btn-ghost btn-sm noshow-reservation-btn" data-id="${r.id}" title="Mark No-show"><i class="fa-solid fa-user-slash"></i></button>
            <button class="btn btn-ghost btn-sm cancel-reservation-btn" data-id="${r.id}" style="color:var(--danger)" title="Cancel"><i class="fa-solid fa-xmark"></i></button>
          ` : `
            <button class="btn btn-ghost btn-sm del-reservation-btn" data-id="${r.id}" style="color:var(--danger)"><i class="fa-solid fa-trash"></i> Remove</button>
          `}
        </div>
      </div>
    `;
  };

  const renderGroup = (list, emptyText) => {
    if (list.length === 0) return `<div style="text-align:center; padding:24px; color:var(--text-muted); font-size:12.5px;">${emptyText}</div>`;
    return groupByDate(list).map(([date, reservations]) => `
      <div style="margin-bottom:18px;">
        <div style="font-size:12px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:.5px; margin-bottom:10px; padding-bottom:6px; border-bottom:1px solid var(--border);">${formatDateLabel(date)}</div>
        <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap:12px;">
          ${reservations.map(reservationCard).join('')}
        </div>
      </div>
    `).join('');
  };

  area.innerHTML = `
    ${renderGroup(upcoming, 'No upcoming reservations — tap "New Reservation" to book one.')}
    ${history.length > 0 ? `
      <div style="margin-top:8px;">
        <button class="btn btn-ghost btn-sm" id="toggleReservationHistoryBtn"><i class="fa-solid fa-clock-rotate-left"></i> Show past &amp; cancelled (${history.length})</button>
        <div id="reservationHistoryArea" style="display:none; margin-top:14px;">${renderGroup(history, '')}</div>
      </div>
    ` : ''}
  `;

  document.getElementById('toggleReservationHistoryBtn')?.addEventListener('click', (e) => {
    const histArea = document.getElementById('reservationHistoryArea');
    if (!histArea) return;
    const show = histArea.style.display === 'none';
    histArea.style.display = show ? '' : 'none';
    e.currentTarget.innerHTML = `<i class="fa-solid fa-clock-rotate-left"></i> ${show ? 'Hide' : 'Show'} past & cancelled (${history.length})`;
  });

  area.querySelectorAll('.seat-reservation-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const reservation = all.find(r => r.id === btn.dataset.id);
      await updateReservationStatus(btn.dataset.id, 'seated');
      if (reservation?.tableIds?.length) {
        // Jump straight into the ordering screen for the reserved table —
        // already merged into one unit if this booking combined more than
        // one — using the exact same hand-off Tables.js's own table-card
        // click already uses (see setupTablesListeners() below), instead of
        // just flipping a status flag and leaving staff to go find and
        // click the right table themselves right after being told to seat it.
        navigate(`restaurant-pos/${reservation.tableIds[0]}`);
      } else {
        showToast('Marked seated — pick a free table to start their order (no specific table was booked for this one).', 'success');
        await renderReservationsContent();
      }
    });
  });
  area.querySelectorAll('.noshow-reservation-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      // Guest isn't coming — free up any tables this booking auto-merged,
      // same reasoning as cancelling below.
      await undoAutoMergeForReservation(all.find(r => r.id === btn.dataset.id));
      await updateReservationStatus(btn.dataset.id, 'no-show');
      await renderReservationsContent();
    });
  });
  area.querySelectorAll('.cancel-reservation-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await undoAutoMergeForReservation(all.find(r => r.id === btn.dataset.id));
      await updateReservationStatus(btn.dataset.id, 'cancelled');
      showToast('Reservation cancelled', 'info');
      await renderReservationsContent();
    });
  });
  area.querySelectorAll('.del-reservation-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await showConfirm({ title: 'Remove Reservation', message: 'Permanently remove this reservation record?', okText: 'Remove' });
      if (!ok) return;
      // Only shown for non-confirmed reservations (seated/cancelled/
      // no-show) — a Cancel/No-show click already unmerges via its own
      // handler above, so this is normally a no-op safety net by the time
      // Remove is even clickable. The one real gap it closes: a SEATED
      // reservation (merge deliberately left in place while the party's
      // there) being cleaned up via Remove once they're done, with no
      // Cancel/No-show step in between to have unmerged it already.
      await undoAutoMergeForReservation(all.find(r => r.id === btn.dataset.id));
      await deleteReservation(btn.dataset.id);
      await renderReservationsContent();
    });
  });
  area.querySelectorAll('.edit-reservation-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = all.find(x => x.id === btn.dataset.id);
      if (r) openReservationForm(r);
    });
  });
}

// ── Waitlist — parties physically waiting RIGHT NOW for the next free
// table, distinct from Reservations (a pre-booking for a FUTURE time).
// Deliberately no table assignment, ever — that's the whole point of a
// waitlist: staff decide which table a waiting party gets at the moment
// one actually frees up, not in advance. ─────────────────────────────────
const WAITLIST_STATUS_META = {
  waiting: { label: 'Waiting', color: 'var(--warning)', bg: 'rgba(234,179,8,0.08)' },
  seated: { label: 'Seated', color: 'var(--success)', bg: 'rgba(34,197,94,0.08)' },
  left: { label: 'Left', color: 'var(--text-muted)', bg: 'var(--bg-app)' },
};

async function renderWaitlistContent() {
  const area = document.getElementById('tablesContent');
  if (!area) return;

  const all = await getWaitlist();
  const waiting = all.filter(w => w.status === 'waiting');
  const history = all.filter(w => w.status !== 'waiting')
    .sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));

  const waitlistCard = (w) => {
    const meta = WAITLIST_STATUS_META[w.status] || WAITLIST_STATUS_META.waiting;
    return `
      <div class="table-card" data-wl-id="${w.id}" style="padding:14px 16px; border-radius:12px; border:1px solid var(--border); background:${meta.bg}; cursor:default;">
        <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px;">
          <div>
            <div style="font-size:15px; font-weight:800;">${escapeAttr(w.customerName || 'Guest')}</div>
            <div style="font-size:11.5px; color:var(--text-muted); margin-top:2px;">${escapeAttr(w.customerPhone || '')}</div>
          </div>
          <div style="font-size:10.5px; font-weight:800; color:${meta.color}; white-space:nowrap;">${meta.label}</div>
        </div>
        <div style="display:flex; align-items:center; gap:14px; margin-top:10px; font-size:12px; color:var(--text-secondary); flex-wrap:wrap;">
          <span><i class="fa-solid fa-user-group" style="opacity:.6; margin-right:4px;"></i>${w.partySize || 1} guest${(w.partySize || 1) === 1 ? '' : 's'}</span>
          ${w.status === 'waiting' ? `<span class="table-timer" data-occupied-at="${escapeAttr(w.addedAt)}" style="font-weight:700; color:${timerTier(Date.now() - new Date(w.addedAt).getTime()).color};">${formatElapsed(Date.now() - new Date(w.addedAt).getTime())} waiting</span>` : `<span>Added ${new Date(w.addedAt).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' })}</span>`}
        </div>
        ${w.notes ? `<div style="font-size:11px; color:var(--text-muted); margin-top:6px; font-style:italic;">${escapeAttr(w.notes)}</div>` : ''}
        <div style="display:flex; gap:6px; margin-top:12px; flex-wrap:wrap;">
          ${w.status === 'waiting' ? `
            <button class="btn btn-primary btn-sm seat-waitlist-btn" data-id="${w.id}"><i class="fa-solid fa-chair"></i> Seat Now</button>
            <button class="btn btn-ghost btn-sm left-waitlist-btn" data-id="${w.id}" style="color:var(--danger)" title="Left without a table"><i class="fa-solid fa-xmark"></i></button>
          ` : `
            <button class="btn btn-ghost btn-sm del-waitlist-btn" data-id="${w.id}" style="color:var(--danger)"><i class="fa-solid fa-trash"></i> Remove</button>
          `}
        </div>
      </div>
    `;
  };

  const renderGrid = (list, emptyText) => {
    if (list.length === 0) return `<div style="text-align:center; padding:24px; color:var(--text-muted); font-size:12.5px;">${emptyText}</div>`;
    return `<div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap:12px;">${list.map(waitlistCard).join('')}</div>`;
  };

  area.innerHTML = `
    ${renderGrid(waiting, 'Nobody waiting right now — tap "Add to Waitlist" when a walk-in party needs to wait for a table.')}
    ${history.length > 0 ? `
      <div style="margin-top:18px;">
        <button class="btn btn-ghost btn-sm" id="toggleWaitlistHistoryBtn"><i class="fa-solid fa-clock-rotate-left"></i> Show seated &amp; left (${history.length})</button>
        <div id="waitlistHistoryArea" style="display:none; margin-top:14px;">${renderGrid(history, '')}</div>
      </div>
    ` : ''}
  `;

  document.getElementById('toggleWaitlistHistoryBtn')?.addEventListener('click', (e) => {
    const histArea = document.getElementById('waitlistHistoryArea');
    if (!histArea) return;
    const show = histArea.style.display === 'none';
    histArea.style.display = show ? '' : 'none';
    e.currentTarget.innerHTML = `<i class="fa-solid fa-clock-rotate-left"></i> ${show ? 'Hide' : 'Show'} seated & left (${history.length})`;
  });

  area.querySelectorAll('.seat-waitlist-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await updateWaitlistStatus(btn.dataset.id, 'seated');
      // Unlike a reservation (which can carry a pre-picked table), a
      // waitlist party never has one — jump to the dine-in table grid so
      // staff can pick whichever table actually just freed up, instead of
      // a specific table id that doesn't exist here.
      navigate('restaurant-pos');
    });
  });
  area.querySelectorAll('.left-waitlist-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await updateWaitlistStatus(btn.dataset.id, 'left');
      await renderWaitlistContent();
    });
  });
  area.querySelectorAll('.del-waitlist-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await showConfirm({ title: 'Remove Entry', message: 'Permanently remove this waitlist record?', okText: 'Remove' });
      if (!ok) return;
      await deleteWaitlistEntry(btn.dataset.id);
      await renderWaitlistContent();
    });
  });

  startTimerLoop();
}

function openWaitlistForm() {
  openModal({
    title: `<i class="fa-solid fa-user-plus mr-8"></i> Add to Waitlist`,
    body: `
      <div class="form-group">
        <label class="form-label required">Guest Name</label>
        <input class="form-input" id="wlName" placeholder="e.g. Ramesh" autofocus />
      </div>
      <div class="form-grid" style="margin-top:10px;">
        <div class="form-group mb-0">
          <label class="form-label">Phone</label>
          <input class="form-input" id="wlPhone" placeholder="e.g. 9876543210" />
        </div>
        <div class="form-group mb-0">
          <label class="form-label required">Party Size</label>
          <input class="form-input" id="wlPartySize" type="number" min="1" value="2" />
        </div>
      </div>
      <div class="form-group mt-8">
        <label class="form-label">Notes (optional)</label>
        <textarea class="form-input" id="wlNotes" rows="2" placeholder="e.g. Prefers AC Hall"></textarea>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="saveWaitlistBtn"><i class="fa-solid fa-user-plus mr-4"></i> Add to Waitlist</button>
    `
  });
  document.getElementById('saveWaitlistBtn')?.addEventListener('click', async () => {
    const customerName = document.getElementById('wlName').value.trim();
    const partySize = parseInt(document.getElementById('wlPartySize').value, 10) || 1;
    if (!customerName) {
      showToast('Guest name is required', 'error');
      return;
    }
    await saveWaitlistEntry({
      customerName,
      customerPhone: document.getElementById('wlPhone').value.trim(),
      partySize,
      notes: document.getElementById('wlNotes').value.trim(),
    });
    closeModal();
    showToast('Added to waitlist', 'success');
    await renderWaitlistContent();
  });
}

async function openReservationForm(reservation) {
  const isEdit = !!reservation;
  const todayStr = new Date().toISOString().slice(0, 10);

  // Real, live tables/sections/capacities — the exact same source Tables.js's
  // own grid reads, grouped the same way (groupBySection() defaults an
  // unset section to "Main", sorts Main first then alphabetically) so this
  // list can never show a section/capacity this shop hasn't actually
  // configured. Multi-select (checkboxes, not a single dropdown) so a
  // party bigger than one table can be booked as a COMBINATION directly —
  // each row also shows that table's live right-now occupancy, so picking
  // one that's mid-service isn't done blind. "No table selected" stays
  // valid — table SHARING means pinning one is a convenience, not a
  // requirement (see db.js's KEYS.RESERVATIONS comment) — Guests then has
  // no capacity ceiling at all.
  const allTables = await getTables();
  const groupedTables = groupBySection(visibleTables(allTables));
  const allParties = (await getCounterOrders()).filter(o => o.orderType === 'dine-in');
  const initialSelectedIds = new Set(reservation?.tableIds || (reservation?.tableId ? [reservation.tableId] : []));

  openModal({
    title: `<i class="fa-solid fa-calendar-plus mr-8"></i> ${isEdit ? 'Edit' : 'New'} Reservation`,
    body: `
      <div class="form-group">
        <label class="form-label required">Guest Name</label>
        <input class="form-input" id="resName" value="${escapeAttr(reservation?.customerName || '')}" placeholder="e.g. Ramesh" autofocus />
      </div>
      <div class="form-group">
        <label class="form-label">Phone</label>
        <input class="form-input" id="resPhone" type="tel" value="${escapeAttr(reservation?.customerPhone || '')}" placeholder="e.g. 9876543210" />
      </div>
      <div class="form-group">
        <label class="form-label">Table(s) (optional — tick more than one to combine)</label>
        <div id="resTableList" style="max-height:220px; overflow-y:auto; border:1px solid var(--border); border-radius:8px; padding:6px 8px;">
          ${groupedTables.map(({ section, tables }) => `
            <div style="font-size:10.5px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:.5px; margin:8px 2px 4px;">${escapeAttr(section)}</div>
            ${tables.map(t => {
              const isOccupiedNow = tableOccupancy(t, allParties).isOccupied;
              // Already merged into another combo BEFORE this form ever
              // opened (a plain manual merge, or a different reservation's)
              // — ticking it books/reserves that existing combined unit as
              // one thing, it does NOT create a new merge of its own, and
              // removing/cancelling THIS reservation won't unmerge it
              // either (see undoAutoMergeForReservation()'s reservation.
              // autoMerged guard) — flagged here so that's not a surprise.
              const alreadyMerged = t.mergedTableIds?.length > 0;
              // A table that's occupied RIGHT NOW can't seat this booking's
              // party today — ticking it would just be picking a table
              // that's already busy. Disabled, not hidden, so staff still
              // see it exists and why it's unavailable. An already-checked
              // occupied table (editing an older reservation whose table
              // got occupied by something else since) stays checked but
              // still locked — querySelectorAll(':checked') still finds a
              // disabled-but-checked box fine, so its own pick isn't lost.
              return `
              <label style="display:flex; align-items:center; gap:8px; padding:6px 4px; border-radius:6px; ${isOccupiedNow ? 'opacity:.5; cursor:not-allowed;' : 'cursor:pointer;'}">
                <input type="checkbox" class="res-table-checkbox" value="${t.id}" data-capacity="${tableDisplayCapacity(t, allTables)}" ${initialSelectedIds.has(t.id) ? 'checked' : ''} ${isOccupiedNow ? 'disabled' : ''} />
                <span style="flex:1; font-size:13px;">${escapeAttr(tableDisplayName(t, allTables))} — Seats ${tableDisplayCapacity(t, allTables)}${alreadyMerged ? ' <span style="opacity:.6; font-weight:400;">(already merged)</span>' : ''}</span>
                <span style="font-size:10px; font-weight:700; color:${isOccupiedNow ? 'var(--warning)' : 'var(--success)'}; white-space:nowrap;">${isOccupiedNow ? '● Occupied now' : '● Free now'}</span>
              </label>
            `;
            }).join('')}
          `).join('')}
        </div>
        <p class="form-help-text" id="resCombinedCapacityText" style="margin-top:6px"></p>
      </div>
      <div class="form-grid">
        <div class="form-group mb-0">
          <label class="form-label required">Date</label>
          <input class="form-input" id="resDate" type="date" min="${todayStr}" value="${reservation?.reservationDate || todayStr}" />
        </div>
        <div class="form-group mb-0">
          <label class="form-label required">Time</label>
          <input class="form-input" id="resTime" type="time" value="${reservation?.reservationTime || ''}" />
        </div>
        <div class="form-group mb-0">
          <label class="form-label required">Guests</label>
          <input class="form-input" id="resGuests" type="number" min="1" value="${reservation?.guestCount || 2}" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Notes (optional)</label>
        <textarea class="form-input" id="resNotes" rows="2" placeholder="e.g. Window seat, birthday cake at 7pm">${escapeAttr(reservation?.notes || '')}</textarea>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="saveReservationBtn"><i class="fa-solid fa-check mr-6"></i> ${isEdit ? 'Save Changes' : 'Book Reservation'}</button>
    `
  });

  // Guests is hard-capped to the TICKED tables' combined capacity (no cap
  // at all while none are ticked) — ticking more tables raises the ceiling
  // immediately, exactly the "pick a combined table to allow more guests"
  // flow asked for, without a separate merge step or a text-only suggestion.
  let guestsManuallyEdited = false;
  const guestsInput = document.getElementById('resGuests');
  const capText = document.getElementById('resCombinedCapacityText');
  const updateGuestsCap = () => {
    const checked = Array.from(document.querySelectorAll('.res-table-checkbox:checked'));
    if (checked.length === 0) {
      guestsInput.removeAttribute('max');
      if (capText) capText.textContent = '';
      return;
    }
    const cap = checked.reduce((s, el) => s + (parseInt(el.dataset.capacity, 10) || 0), 0);
    guestsInput.setAttribute('max', cap);
    const current = parseInt(guestsInput.value, 10) || 0;
    // Only auto-FILL to the new ceiling if the guest count is still
    // whatever it defaulted to (never touched) — once someone's actually
    // typed a number (a 2-top choosing to sit at a bigger table on
    // purpose, say), picking/unpicking tables only ever CAPS it, never
    // silently overwrites a deliberate choice.
    if (!guestsManuallyEdited || current > cap) {
      guestsInput.value = cap;
      if (guestsManuallyEdited) showToast(`Capped to ${cap} guests — the ticked table(s)' combined capacity. Tick another table to allow more.`, 'info');
    }
    const isToday = document.getElementById('resDate')?.value === todayStr;
    const mergeNote = checked.length > 1
      ? (isToday ? ' — tables will be merged on the floor plan automatically when booked.' : ' — this date isn\'t today, so tables won\'t auto-merge; merge them by hand on the day.')
      : '';
    if (capText) capText.textContent = `${checked.length > 1 ? 'Combined seats' : 'Seats'}: ${cap}${mergeNote}`;
  };
  document.getElementById('resDate')?.addEventListener('change', updateGuestsCap);
  guestsInput?.addEventListener('input', () => {
    guestsManuallyEdited = true;
    const max = parseInt(guestsInput.getAttribute('max'), 10);
    if (max && (parseInt(guestsInput.value, 10) || 0) > max) guestsInput.value = max;
  });
  document.querySelectorAll('.res-table-checkbox').forEach(cb => cb.addEventListener('change', updateGuestsCap));
  updateGuestsCap();

  document.getElementById('saveReservationBtn')?.addEventListener('click', async () => {
    const customerName = document.getElementById('resName').value.trim();
    const reservationDate = document.getElementById('resDate').value;
    const reservationTime = document.getElementById('resTime').value;
    const guestCount = parseInt(document.getElementById('resGuests').value, 10) || 1;
    if (!customerName || !reservationDate || !reservationTime) {
      showToast('Guest name, date, and time are required', 'error');
      return;
    }
    const pickedTables = Array.from(document.querySelectorAll('.res-table-checkbox:checked'))
      .map(el => allTables.find(t => t.id === el.value))
      .filter(Boolean);

    // Editing a reservation that previously auto-merged its own tables —
    // undo that merge FIRST, before evaluating a possibly-different new
    // selection, so changing which tables are picked can't leave the old
    // combo merged behind while also merging the new one.
    if (isEdit && reservation?.autoMerged) {
      await undoAutoMergeForReservation(reservation);
    }
    const didMerge = await autoMergeForReservation(pickedTables, reservationDate);

    // Snapshot ids/names/section/capacity at booking time — so the
    // reservation list can show them without a live table lookup, and it
    // stays meaningful even if a table's later renamed or deleted.
    await saveReservation({
      ...(reservation || {}),
      customerName,
      customerPhone: document.getElementById('resPhone').value.trim(),
      reservationDate,
      reservationTime,
      guestCount,
      notes: document.getElementById('resNotes').value.trim(),
      tableIds: pickedTables.map(t => t.id),
      tableNames: pickedTables.map(t => tableDisplayName(t, allTables)),
      tableSection: pickedTables[0] ? (pickedTables[0].section?.trim() || 'Main') : null,
      tableCapacity: pickedTables.reduce((s, t) => s + tableDisplayCapacity(t, allTables), 0) || null,
      autoMerged: didMerge,
    });
    closeModal();
    showToast(isEdit ? 'Reservation updated' : (didMerge ? 'Reservation booked — tables merged on the floor plan' : 'Reservation booked'), 'success');
    await renderReservationsContent();
  });
}

// Actually MERGES the reservation's picked tables (using the exact same
// mechanism the "Merge with…" button already uses — same mergedTableIds/
// status:'merged'/mergedInto fields — so a combined SAME-DAY booking shows
// on the grid exactly like a manual merge already does: one card, one
// "Seats N", not several separate cards each saying "Combined with:
// ...". Only for TODAY — merging tables for a booking that's days out
// would incorrectly take them out of circulation for tonight's business
// in the meantime; a future-dated multi-table reservation still gets the
// text-based "Combined with" fallback and needs merging by hand on the day.
// Skips (with a toast) if any picked table is already merge-involved or
// currently occupied, rather than fighting/overwriting that state.
async function autoMergeForReservation(pickedTables, reservationDate) {
  const todayStr = new Date().toISOString().slice(0, 10);
  if (reservationDate !== todayStr || pickedTables.length < 2) return false;
  const occupiedTableIds = new Set((await getCounterOrders()).filter(o => o.orderType === 'dine-in').map(o => o.tableId));
  const blocked = pickedTables.some(t => t.status === 'merged' || t.mergedTableIds?.length || occupiedTableIds.has(t.id));
  if (blocked) {
    showToast('Some selected tables are already merged or occupied elsewhere — booked without physically merging; merge them by hand once free.', 'info');
    return false;
  }
  const [primary, ...rest] = pickedTables;
  await saveTable({ ...primary, mergedTableIds: rest.map(t => t.id) });
  for (const t of rest) {
    await saveTable({ ...t, status: 'merged', mergedInto: primary.id });
  }
  return true;
}

// Reverses a merge THIS reservation created (reservation.autoMerged) — only
// if the primary table's own mergedTableIds still exactly match what was
// set up, so a staff member who's since changed the merge for their own
// reason (added a 3rd table, merged the primary into something else
// entirely) never gets silently undone by a reservation being cancelled.
async function undoAutoMergeForReservation(reservation) {
  if (!reservation?.autoMerged || !reservation.tableIds?.length) return;
  const allTables = await getTables();
  const primary = allTables.find(t => t.id === reservation.tableIds[0]);
  const expectedChildIds = reservation.tableIds.slice(1);
  const stillMatches = primary?.mergedTableIds?.length === expectedChildIds.length
    && expectedChildIds.every(id => primary.mergedTableIds.includes(id));
  if (!stillMatches) return;
  for (const id of expectedChildIds) {
    const t = allTables.find(x => x.id === id);
    if (t) await saveTable({ ...t, status: 'free', mergedInto: null });
  }
  await saveTable({ ...primary, mergedTableIds: [] });
}

function renderTableCard(t, allTables, allParties, allKots, todaysReservations) {
  const occ = tableOccupancy(t, allParties);
  const displayCap = tableDisplayCapacity(t, allTables);
  const status = STATUS_META[tableStatusKey(occ, displayCap)];
  const displayName = tableDisplayName(t, allTables);
  const elapsed = occ.oldestCreatedAt ? Date.now() - new Date(occ.oldestCreatedAt).getTime() : null;
  const hasMerge = t.mergedTableIds?.length > 0;
  // Every active box at this table fully served — same "Ready to Bill"
  // green treatment RestaurantPOS.js's own table grid and box picker
  // already give this exact state, now visible here too instead of only
  // after drilling into the ordering screen.
  const ready = occ.isOccupied && tableReadyToBill(occ, allKots);
  // A FREE table booked for later today gets its own distinct color — a
  // violet none of the other statuses use — so staff don't seat a walk-in
  // somewhere already promised to someone arriving in an hour. Only
  // overrides the plain "Free" look; an already-occupied/ready table's own
  // (more urgent) status still wins, the booking just shows as a small line
  // underneath either way.
  const nextReservation = todaysReservations?.[0];
  const isReservedAndFree = !occ.isOccupied && nextReservation;
  const cardBg = ready ? 'rgba(34,197,94,0.1)' : isReservedAndFree ? 'rgba(139,92,246,0.1)' : status.bg;
  const cardBorder = ready ? 'var(--success)' : isReservedAndFree ? '#8b5cf6' : 'var(--border)';
  const statusColor = ready ? 'var(--success)' : isReservedAndFree ? '#8b5cf6' : status.color;
  const statusLabel = ready ? 'Ready to Bill' : (occ.isOccupied ? `${occ.usedSeats}/${displayCap} seated${occ.partyCount > 1 ? ` · ${occ.partyCount} boxes` : ''}` : (isReservedAndFree ? 'Reserved' : status.label));
  // Name gets its own full-width row rather than sharing one with the
  // action buttons — FOUR 36px .btn-icon buttons (QR/edit/merge-or-unmerge/
  // delete, the app's fixed icon-button size everywhere else) eat well over
  // 140px on their own, and squeezing the name into whatever was left made
  // it wrap awkwardly ("TABLE-" / "1" on separate lines) on a normal-width
  // card instead of just truncating on a genuinely narrow one — a real
  // regression once the QR button (self-order menu) became a 4th icon here
  // and nobody re-checked whether the row still had room. FOUR 36px
  // .btn-icon buttons alone need ~156px (4×36 + 3×4px gaps) — on this
  // grid's 200px minimum card width there is NO room left over for "Seats
  // N" to share that same row without wrapping too, so it gets its own
  // full-width row as well: name / seats / actions, each on its own line,
  // nothing ever competing for width regardless of how many action icons
  // this card ends up with.
  return `
    <div class="table-card ${ready ? 'rpos-box-ready' : ''}" data-id="${t.id}" style="padding:16px 18px; border-radius:14px; border:1px solid ${cardBorder}; background:${cardBg}; cursor:pointer;">
      <div style="font-size:17px; font-weight:800; overflow-wrap:break-word;">${escapeAttr(displayName)}</div>
      <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">Seats ${displayCap}</div>
      <div class="table-card-actions" style="display:flex; gap:4px; justify-content:flex-end; margin-top:8px;" onclick="event.stopPropagation()">
        <button class="btn-icon qr-table-btn" data-id="${t.id}" title="Self-order QR menu for this table"><i class="fa-solid fa-qrcode" style="font-size:10px"></i></button>
        <button class="btn-icon edit-table-btn" data-id="${t.id}" title="Edit"><i class="fa-solid fa-pen" style="font-size:10px"></i></button>
        ${hasMerge
          ? `<button class="btn-icon unmerge-table-btn" data-id="${t.id}" title="Unmerge"><i class="fa-solid fa-object-ungroup" style="font-size:10px"></i></button>`
          : (!occ.isOccupied ? `<button class="btn-icon merge-table-btn" data-id="${t.id}" title="Merge with another table"><i class="fa-solid fa-object-group" style="font-size:10px"></i></button>` : '')}
        <button class="btn-icon del-table-btn" data-id="${t.id}" title="Delete"><i class="fa-solid fa-trash" style="font-size:10px; color:var(--danger)"></i></button>
      </div>
      <div style="margin-top:14px; display:flex; align-items:center; justify-content:space-between; gap:8px;">
        <div style="font-size:11px; font-weight:700; color:${statusColor};">
          <i class="fa-solid ${ready ? 'fa-circle-check' : 'fa-circle'}" style="font-size:${ready ? '11px' : '6px'}; margin-right:5px"></i>${statusLabel}
        </div>
        ${elapsed !== null ? `<div class="table-timer" data-occupied-at="${occ.oldestCreatedAt}" style="font-size:11px; font-weight:800; color:${timerTier(elapsed).color};">${formatElapsed(elapsed)}</div>` : ''}
      </div>
      ${occ.totalItems > 0 ? `<div style="font-size:10.5px; color:var(--text-muted); margin-top:6px;">${occ.totalItems} item(s)</div>` : ''}
      ${nextReservation ? `
        <div style="font-size:10.5px; color:#8b5cf6; font-weight:700; margin-top:6px;"><i class="fa-solid fa-calendar-check" style="margin-right:4px;"></i>${escapeAttr(nextReservation.customerName)} — ${formatReservationTime(nextReservation.reservationTime)} · ${nextReservation.guestCount} guest${nextReservation.guestCount === 1 ? '' : 's'}${todaysReservations.length > 1 ? ` (+${todaysReservations.length - 1} more today)` : ''}</div>
        ${nextReservation.tableNames?.length > 1 && !hasMerge ? `<div style="font-size:10px; color:#8b5cf6; opacity:.8; margin-top:2px;">Combined with: ${escapeAttr(nextReservation.tableNames.filter(n => n !== displayName).join(' + '))} (${nextReservation.tableCapacity} seats total — not just this table's own ${displayCap}${nextReservation.reservationDate === new Date().toISOString().slice(0, 10) ? ' — will merge on the floor plan once free' : ' — merge by hand on the day'})</div>` : ''}
      ` : ''}
      ${capacityBarHtml(occ.usedSeats, displayCap, statusColor)}
    </div>
  `;
}

function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}


// Only the timer badges re-render on this tick (not the whole grid) so an
// open modal / merge selection never gets clobbered by a background tick.
// Self-clears once #tablesContent leaves the DOM (page navigated away).
function startTimerLoop() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const area = document.getElementById('tablesContent');
    if (!area) { clearInterval(timerInterval); timerInterval = null; return; }
    area.querySelectorAll('.table-timer').forEach(el => {
      const occupiedAt = el.dataset.occupiedAt;
      if (!occupiedAt) return;
      const ms = Date.now() - new Date(occupiedAt).getTime();
      el.textContent = formatElapsed(ms);
      el.style.color = timerTier(ms).color;
    });
  }, 30000);
}

async function setupTablesListeners() {
  document.querySelectorAll('.table-card').forEach(el => {
    el.addEventListener('click', () => {
      // Hand off to RestaurantPOS.js's own table selection (it re-reads live
      // status itself rather than trusting this stale click) via a query hash.
      navigate(`restaurant-pos/${el.dataset.id}`);
    });
  });

  document.getElementById('addTableBtn')?.addEventListener('click', async () => {
    const existingSections = [...new Set((await getTables()).map(t => t.section?.trim()).filter(Boolean))];
    openModal({
      title: '<i class="fa-solid fa-chair mr-8"></i> New Table',
      body: `
        <div class="form-group">
          <label class="form-label required">Table Name / Number</label>
          <input class="form-input" id="newTableNameInput" placeholder="e.g. Table 1, T-05, Patio 2" autofocus />
        </div>
        <div class="form-group mt-8">
          <label class="form-label">Seating Capacity</label>
          <input class="form-input" id="newTableCapInput" type="number" min="1" value="4" />
        </div>
        <div class="form-group mt-8">
          <label class="form-label">Section / Area (optional)</label>
          <input class="form-input" id="newTableSectionInput" list="tableSectionList" placeholder="e.g. Ground Floor, Terrace, AC Hall" />
          <datalist id="tableSectionList">${existingSections.map(s => `<option value="${escapeAttr(s)}"></option>`).join('')}</datalist>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" id="confirmNewTable" style="min-width: 120px">
          <i class="fa-solid fa-plus mr-4"></i> Create Table
        </button>
      `
    });
    setTimeout(() => {
      const nameInput = document.getElementById('newTableNameInput');
      if (nameInput) nameInput.focus();
      const btn = document.getElementById('confirmNewTable');
      if (btn) btn.onclick = async () => {
        const name = nameInput?.value.trim();
        if (!name) return showToast('Please enter a table name', 'error');
        const section = document.getElementById('newTableSectionInput')?.value.trim() || '';
        const sectionKey = section || 'Main';
        const existing = await getTables();
        // Scoped to the section, not global — "Table 1" in Main and "Table 1"
        // in AC Hall are two different physical tables the section already
        // tells apart, same as a real restaurant would number them.
        if (existing.some(t => (t.section?.trim() || 'Main') === sectionKey && t.name.trim().toLowerCase() === name.toLowerCase())) {
          return showToast(`A table named "${name}" already exists in ${sectionKey}`, 'error');
        }
        const capacity = Math.max(1, parseInt(document.getElementById('newTableCapInput')?.value, 10) || 4);
        await saveTable({ name, capacity, section, status: 'free' });
        closeModal();
        showToast(`Table "${name}" created`, 'success');
        await renderTablesContent();
      };
    }, 50);
  });

  // Self-order QR menu — links straight to this table's customer menu over
  // LAN (server/index.js's static-file serving, same entry point kd/mo
  // already use). syncEngine.lanIp is only populated once the hub's own
  // register_success has echoed it back — window.location.hostname is a
  // solid fallback either way (this page IS running on the shop PC).
  document.querySelectorAll('.qr-table-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const table = (await getTables()).find(t => t.id === btn.dataset.id);
      if (!table) return;
      const host = syncEngine.lanIp || window.location.hostname || 'localhost';
      const url = `http://${host}:3030/#menu/${table.id}`;
      openModal({
        title: `<i class="fa-solid fa-qrcode mr-8"></i> QR Menu — ${escapeAttr(tableDisplayName(table))}`,
        body: `
          <div style="text-align:center;">
            <div id="tableQrLoading" style="padding:30px; color:var(--text-muted); font-size:12px;">Generating...</div>
            <img id="tableQrImg" style="display:none; width:220px; height:220px;" alt="Table QR" />
            <p style="font-size:11px; color:var(--text-muted); margin-top:12px; word-break:break-all;">${escapeAttr(url)}</p>
            <p style="font-size:12px; color:var(--text-muted); margin-top:10px;">Print this and place it on the table — customers scan it (same Wi-Fi) to browse the menu and send an order request, no app or login needed.</p>
          </div>
        `,
        footer: `<button class="btn btn-primary" onclick="closeModal()">Done</button>`
      });
      const dataUrl = await QRCode.toDataURL(url, { width: 220, margin: 1 }).catch(() => null);
      const img = document.getElementById('tableQrImg');
      const loading = document.getElementById('tableQrLoading');
      if (dataUrl && img) {
        img.src = dataUrl;
        img.style.display = 'inline-block';
        if (loading) loading.style.display = 'none';
      } else if (loading) {
        loading.textContent = 'Could not generate QR code.';
      }
    });
  });

  document.querySelectorAll('.edit-table-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const table = (await getTables()).find(t => t.id === btn.dataset.id);
      if (!table) return;
      const existingSections = [...new Set((await getTables()).map(t => t.section?.trim()).filter(Boolean))];
      openModal({
        title: '<i class="fa-solid fa-pen-to-square mr-8"></i> Edit Table',
        body: `
          <div class="form-group">
            <label class="form-label required">Table Name / Number</label>
            <input class="form-input" id="editTableNameInput" value="${escapeAttr(table.name)}" autofocus />
          </div>
          <div class="form-group mt-8">
            <label class="form-label">Seating Capacity</label>
            <input class="form-input" id="editTableCapInput" type="number" min="1" value="${table.capacity || 4}" />
          </div>
          <div class="form-group mt-8">
            <label class="form-label">Section / Area (optional)</label>
            <input class="form-input" id="editTableSectionInput" list="tableSectionListEdit" value="${escapeAttr(table.section || '')}" placeholder="e.g. Ground Floor, Terrace, AC Hall" />
            <datalist id="tableSectionListEdit">${existingSections.map(s => `<option value="${escapeAttr(s)}"></option>`).join('')}</datalist>
          </div>
        `,
        footer: `
          <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" id="confirmEditTable" style="min-width: 120px">
            <i class="fa-solid fa-save mr-4"></i> Save Changes
          </button>
        `
      });
      setTimeout(() => {
        const nameInput = document.getElementById('editTableNameInput');
        if (nameInput) nameInput.focus();
        const saveBtn = document.getElementById('confirmEditTable');
        if (saveBtn) saveBtn.onclick = async () => {
          const name = nameInput?.value.trim();
          if (!name) return;
          const section = document.getElementById('editTableSectionInput')?.value.trim() || '';
          const sectionKey = section || 'Main';
          const existing = await getTables();
          // Scoped to the section, not global — see the same check in the
          // "New Table" handler above for why.
          if (existing.some(t => t.id !== table.id && (t.section?.trim() || 'Main') === sectionKey && t.name.trim().toLowerCase() === name.toLowerCase())) {
            return showToast(`A table named "${name}" already exists in ${sectionKey}`, 'error');
          }
          const capacity = Math.max(1, parseInt(document.getElementById('editTableCapInput')?.value, 10) || 4);
          await saveTable({ ...table, name, capacity, section });
          closeModal();
          showToast('Table updated', 'success');
          await renderTablesContent();
        };
      }, 50);
    });
  });

  document.querySelectorAll('.del-table-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const table = (await getTables()).find(t => t.id === btn.dataset.id);
      const hasOpenParty = (await getCounterOrders()).some(o => o.orderType === 'dine-in' && o.tableId === table?.id);
      if (hasOpenParty) {
        return showToast('This table has an order in progress — bill or clear it first.', 'error');
      }
      if (table?.mergedTableIds?.length || table?.mergedInto) {
        return showToast('Unmerge this table first before deleting it.', 'error');
      }
      const confirmed = await showConfirm({
        title: 'Delete Table',
        message: `Remove "${table?.name}"? This can't be undone.`,
        okText: 'Delete', okClass: 'btn-danger'
      });
      if (confirmed) {
        await deleteTable(btn.dataset.id);
        showToast('Table deleted', 'info');
        await renderTablesContent();
      }
    });
  });

  document.querySelectorAll('.merge-table-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const allTables = await getTables();
      const primary = allTables.find(t => t.id === btn.dataset.id);
      if (!primary) return;
      const occupiedTableIds = new Set((await getCounterOrders()).filter(o => o.orderType === 'dine-in').map(o => o.tableId));
      const candidates = allTables.filter(t => t.id !== primary.id && t.status !== 'merged' && !occupiedTableIds.has(t.id) && !t.mergedTableIds?.length);
      if (candidates.length === 0) {
        return showToast('No other free tables available to merge with.', 'info');
      }
      openModal({
        title: `<i class="fa-solid fa-object-group mr-8"></i> Merge "${escapeAttr(primary.name)}" with…`,
        body: `
          <div style="font-size:12px; color:var(--text-muted); margin-bottom:10px;">Pick one or more tables to combine into a single order under "${escapeAttr(primary.name)}" — useful for a large party spanning multiple tables.</div>
          <div style="display:flex; flex-direction:column; gap:8px; max-height:260px; overflow-y:auto;">
            ${candidates.map(t => `
              <label style="display:flex; align-items:center; gap:10px; padding:8px 10px; border:1px solid var(--border); border-radius:8px; cursor:pointer;">
                <input type="checkbox" class="merge-candidate-cb" value="${t.id}" />
                <span style="font-weight:700; font-size:13px;">${escapeAttr(t.name)}</span>
                <span style="font-size:11px; color:var(--text-muted); margin-left:auto;">Seats ${t.capacity || 4}</span>
              </label>
            `).join('')}
          </div>
        `,
        footer: `
          <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" id="confirmMergeBtn"><i class="fa-solid fa-object-group mr-4"></i> Merge Selected</button>
        `
      });
      setTimeout(() => {
        document.getElementById('confirmMergeBtn')?.addEventListener('click', async () => {
          const selectedIds = Array.from(document.querySelectorAll('.merge-candidate-cb:checked')).map(cb => cb.value);
          if (selectedIds.length === 0) return showToast('Select at least one table', 'error');
          await saveTable({ ...primary, mergedTableIds: selectedIds });
          for (const id of selectedIds) {
            const t = allTables.find(x => x.id === id);
            if (t) await saveTable({ ...t, status: 'merged', mergedInto: primary.id });
          }
          closeModal();
          showToast(`Merged into "${primary.name}"`, 'success');
          await renderTablesContent();
        });
      }, 50);
    });
  });

  document.querySelectorAll('.unmerge-table-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const allTables = await getTables();
      const primary = allTables.find(t => t.id === btn.dataset.id);
      if (!primary?.mergedTableIds?.length) return;
      const confirmed = await showConfirm({
        title: 'Unmerge Tables',
        message: `Split "${tableDisplayName(primary, allTables)}" back into separate tables?`,
        okText: 'Unmerge'
      });
      if (!confirmed) return;
      for (const id of primary.mergedTableIds) {
        const t = allTables.find(x => x.id === id);
        if (t) await saveTable({ ...t, status: 'free', mergedInto: null });
      }
      await saveTable({ ...primary, mergedTableIds: [] });
      showToast('Tables unmerged', 'info');
      await renderTablesContent();
    });
  });
}
