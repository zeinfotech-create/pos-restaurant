// ============================================================
// Kitchen.js — a dedicated Kitchen Display page, separate from the ordering
// flow (RestaurantPOS.js) so kitchen staff have their own menu/screen. Shows
// every active ticket (KOT) with per-item ready/serve controls — a dish can
// be served the moment it's ready, independent of the rest of its ticket or
// order; RestaurantPOS.js's Bill Now reads this same per-item status to stay
// disabled until every dish in the order has actually been served. A ticket
// clears itself off this board once all of its items are served (or voided —
// cancelled/modified from the ordering side).
// ============================================================

import { getKots, updateKotStatus, setKotItemStatus, saveKot } from '../db.js';
import { showToast } from '../components/Toast.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { formatElapsed } from '../utils/tableDisplay.js';

let kitchenTimerInterval = null;
let liveListenerRegistered = false;

// Kitchen tickets move much faster than a table's whole occupied session, so
// these thresholds are deliberately tighter than tableDisplay.js's (10/20min
// here vs 30/60min there) — a ticket sitting 20+ minutes is a real problem.
function kotTimerTier(ms) {
  const mins = ms / 60000;
  if (mins < 10) return { color: 'var(--success)', overdue: false };
  if (mins < 20) return { color: 'var(--warning)', overdue: false };
  return { color: 'var(--danger)', overdue: true };
}

// "Serve" only makes sense for dine-in (a waiter carrying food to a seated
// table) — a takeaway/delivery order doesn't get "served", it gets packed
// into a bag or handed off to a rider, so the action + completed-state
// wording (and icon) tracks the order type instead of always saying Serve.
const SERVE_ACTION_META = {
  'dine-in': { verb: 'Serve', doneLabel: 'Served', icon: 'fa-bell' },
  takeaway: { verb: 'Mark Packed', doneLabel: 'Packed', icon: 'fa-bag-shopping' },
  delivery: { verb: 'Mark Dispatched', doneLabel: 'Dispatched', icon: 'fa-motorcycle' },
};
function serveActionMeta(orderType) {
  return SERVE_ACTION_META[orderType] || SERVE_ACTION_META['dine-in'];
}

export async function renderKitchen(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Kitchen</div>
        <div class="page-subtitle">Live prep board — start a ticket, then serve each dish the moment it's ready</div>
      </div>
    </div>
    <div id="kitchenContent"></div>
  `;

  // A KOT sent from RestaurantPOS.js (on this device or, via sync, another
  // one) shows up here immediately rather than only on the next manual visit
  // to this page — real KDS boards are expected to update live. Registered
  // once globally (guarded, like the cart listener in RestaurantPOS.js) and
  // self-checks the container is still on screen before acting, since there's
  // no page-unmount hook in this router to unregister it on navigating away.
  if (!liveListenerRegistered) {
    window.addEventListener('storage-change', (e) => {
      if (e.detail?.store !== 'kots') return;
      if (!document.getElementById('kitchenContent')) return;
      renderKitchenContent();
    });
    liveListenerRegistered = true;
  }

  await renderKitchenContent();
}

async function renderKitchenContent() {
  const area = document.getElementById('kitchenContent');
  if (!area) return;
  const kots = (await getKots()).filter(k => k.status !== 'served');
  const pending = kots.filter(k => (k.status || 'pending') === 'pending').sort(byAge);
  const active = kots.filter(k => (k.status || 'pending') !== 'pending').sort(byAge);
  // Grouped WITHIN each column only — a wave already started (in Kitchen)
  // while a later wave for the same order hasn't been touched yet (New
  // Tickets) genuinely are two separate physical tickets at two different
  // stages, so they correctly stay apart across columns; only tickets that
  // are actually at the same stage get visually combined under one order.
  const pendingGroups = groupByOrder(pending);
  const activeGroups = groupByOrder(active);

  area.innerHTML = `
    ${kots.length === 0 ? `
      <div class="card" style="padding:48px; text-align:center; color:var(--text-muted);">
        <i class="fa-solid fa-kitchen-set" style="font-size:36px; opacity:0.2; margin-bottom:12px; display:block"></i>
        Nothing pending — all caught up 🎉
      </div>
    ` : `
      <div class="rpos-kitchen-board">
        <div class="rpos-kitchen-col">
          <div class="rpos-kitchen-col-header" style="color:var(--text-muted);"><i class="fa-solid fa-hourglass-start"></i> New Tickets <span class="rpos-kitchen-col-count">${pending.length}</span></div>
          <div class="rpos-kitchen-col-body">
            ${pendingGroups.length === 0 ? emptyCol() : pendingGroups.map(renderNewTicketGroup).join('')}
          </div>
        </div>
        <div class="rpos-kitchen-col">
          <div class="rpos-kitchen-col-header" style="color:var(--warning);"><i class="fa-solid fa-fire"></i> In Kitchen <span class="rpos-kitchen-col-count">${active.length}</span></div>
          <div class="rpos-kitchen-active-grid">
            ${activeGroups.length === 0 ? emptyCol() : activeGroups.map(renderActiveTicketGroup).join('')}
          </div>
        </div>
      </div>
    `}
    <style>
      .rpos-kitchen-board { display:grid; grid-template-columns:1fr 2fr; gap:16px; align-items:start; }
      @media (max-width:900px) { .rpos-kitchen-board { grid-template-columns:1fr; } }
      .rpos-kitchen-col-header { display:flex; align-items:center; gap:8px; font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:.4px; margin-bottom:10px; }
      .rpos-kitchen-col-count { margin-left:auto; background:var(--bg-elevated); border:1px solid var(--border); border-radius:999px; padding:1px 8px; font-size:11px; }
      .rpos-kitchen-col-body { display:flex; flex-direction:column; gap:12px; }
      .rpos-kitchen-active-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(240px,1fr)); gap:12px; align-items:start; }
      .rpos-kot-item-row { display:flex; align-items:center; gap:8px; padding:5px 0; border-bottom:1px dashed var(--border); }
      .rpos-kot-item-row:last-child { border-bottom:none; }
      .rpos-kot-item-row.resolved { opacity:.55; }
      .rpos-kot-wave-divider { margin-top:12px; padding-top:12px; border-top:1px dashed var(--border); }
    </style>
  `;
  wireKitchenListeners();
  startKitchenTimerLoop();
}

function byAge(a, b) { return new Date(a.createdAt) - new Date(b.createdAt); }
function emptyCol() { return `<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:11px;">—</div>`; }

// Multiple sends for the SAME order (see waveNumber, RestaurantPOS.js) used
// to show up here as fully separate, unrelated-looking cards even though
// they're the same physical order — "combined agunapula oru UI/UX venum...
// antha rendumey box box ah varum" (when they belong together, they should
// group like RestaurantPOS.js's table picker groups a table's boxes,
// instead of scattering as disconnected cards). Groups every ticket that
// shares an orderSessionId; a ticket with none (or the only one for its
// order) is its own singleton group — the common case, rendered exactly as
// before. Input is expected already age-sorted; groups come back sorted by
// their own oldest member.
function groupByOrder(kots) {
  const groups = new Map();
  const firstSeen = [];
  kots.forEach(k => {
    const key = k.orderSessionId || `solo:${k.id}`;
    if (!groups.has(key)) { groups.set(key, []); firstSeen.push(key); }
    groups.get(key).push(k);
  });
  return firstSeen
    .map(key => groups.get(key).sort(byAge))
    .sort((a, b) => byAge(a[0], b[0]));
}

// A ticket with waveNumber > 1 is more items sent for an order that
// already has an earlier ticket in progress (or already served) — without
// flagging it, it looks on this board exactly like a brand-new order that
// happens to share the same table/order label, and kitchen staff can't
// tell "extra for the order I already started" from "a fresh one".
function ticketHeader(k) {
  const elapsed = Date.now() - new Date(k.createdAt).getTime();
  const tier = kotTimerTier(elapsed);
  const isAddOn = (k.waveNumber || 1) > 1;
  return `
    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
      <div style="font-weight:800; font-size:13px; display:flex; align-items:center; gap:6px;">
        ${k.tableName ? escapeHtml(k.tableName) : (k.orderType || '').toUpperCase()}${k.course ? ` · ${escapeHtml(k.course)}` : ''}
        ${isAddOn ? `<span style="font-size:9.5px; font-weight:800; color:var(--warning); white-space:nowrap;"><i class="fa-solid fa-circle-plus" style="margin-right:3px;"></i>ADD-ON #${k.waveNumber}</span>` : ''}
      </div>
      <div class="rpos-kot-timer" data-created-at="${k.createdAt}" style="font-size:11px; font-weight:800; color:${tier.color}; white-space:nowrap;">${formatElapsed(elapsed)}${tier.overdue ? ' ⚠' : ''}</div>
    </div>
    ${k.waiterName ? `<div style="font-size:10.5px; color:var(--text-muted); margin-top:2px;"><i class="fa-solid fa-user" style="margin-right:4px; opacity:.5;"></i>${escapeHtml(k.waiterName)}</div>` : ''}
    ${isAddOn ? `<div style="font-size:10.5px; color:var(--warning); margin-top:2px; font-weight:700;"><i class="fa-solid fa-triangle-exclamation" style="margin-right:4px;"></i>More for an order already in progress — not a new one</div>` : ''}
  `;
}

function newTicketItemLine(i) {
  return `
    <div style="display:flex; align-items:center; gap:8px; ${i.itemStatus === 'voided' ? 'opacity:.55;' : ''}">
      <div style="flex:1; font-size:12px; ${i.itemStatus === 'voided' ? 'text-decoration:line-through;' : ''}"><b>${i.qty}x</b> ${escapeHtml(i.name)}${(i.modifiers?.length || i.notes) ? `<div style="font-size:10.5px; color:var(--text-muted); padding-left:14px;">${[...(i.modifiers || []), i.notes].filter(Boolean).map(escapeHtml).join(', ')}</div>` : ''}</div>
      ${i.itemStatus === 'voided' ? `<span style="font-size:10px; font-weight:700; color:var(--danger); white-space:nowrap;"><i class="fa-solid fa-ban"></i> Cancelled</span>` : ''}
    </div>
  `;
}

// A small label for a wave WITHIN a combined group — "Original ticket" for
// the first, "Add-on #N" for every one after (reusing whatever waveNumber
// sendToKitchen() stamped it with; falls back to its position in the group
// for older tickets saved before that field existed).
function waveLabel(k, i) {
  if (i === 0) return `<span style="font-size:10.5px; font-weight:800; color:var(--text-muted);">Original ticket</span>`;
  return `<span style="font-size:10.5px; font-weight:800; color:var(--warning);"><i class="fa-solid fa-circle-plus" style="margin-right:3px;"></i>Add-on #${k.waveNumber || i + 1}</span>`;
}

function waveTimer(k) {
  const elapsed = Date.now() - new Date(k.createdAt).getTime();
  const tier = kotTimerTier(elapsed);
  return `<span class="rpos-kot-timer" data-created-at="${k.createdAt}" style="font-size:11px; font-weight:800; color:${tier.color}; white-space:nowrap;">${formatElapsed(elapsed)}${tier.overdue ? ' ⚠' : ''}</span>`;
}

// Single ticket → the plain original card (unchanged from before grouping
// existed). Multiple tickets for the same order → one combined card, order
// name shown once up top with a ticket-count chip, each wave still its own
// mini-section below with its own timer/items/actions since it's still a
// physically separate ticket that can be started independently.
function renderNewTicketGroup(group) {
  if (group.length === 1) {
    const k = group[0];
    return `
      <div class="card rpos-kot-card" style="padding:14px; border-left:4px solid var(--text-muted);">
        ${ticketHeader(k)}
        <div style="margin-top:10px; display:flex; flex-direction:column; gap:2px;">
          ${(k.items || []).map(newTicketItemLine).join('')}
        </div>
        <button class="btn btn-primary btn-sm rpos-kot-start" data-id="${k.id}" style="margin-top:12px; width:100%;"><i class="fa-solid fa-fire"></i> Start Preparing</button>
      </div>
    `;
  }
  const orderLabel = group[0].tableName ? escapeHtml(group[0].tableName) : (group[0].orderType || '').toUpperCase();
  return `
    <div class="card rpos-kot-card" style="padding:14px; border-left:4px solid var(--text-muted);">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
        <div style="font-weight:800; font-size:13px;">${orderLabel}</div>
        <span class="rpos-kitchen-col-count">${group.length} tickets</span>
      </div>
      ${group.map((k, i) => `
        <div class="${i > 0 ? 'rpos-kot-wave-divider' : ''}" style="${i === 0 ? 'margin-top:8px;' : ''}">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">${waveLabel(k, i)}${waveTimer(k)}</div>
          <div style="margin-top:6px; display:flex; flex-direction:column; gap:2px;">
            ${(k.items || []).map(newTicketItemLine).join('')}
          </div>
          <button class="btn btn-primary btn-sm rpos-kot-start" data-id="${k.id}" style="margin-top:10px; width:100%;"><i class="fa-solid fa-fire"></i> Start Preparing</button>
        </div>
      `).join('')}
    </div>
  `;
}

function activeItemRow(k, i, idx, meta) {
  return `
    <div class="rpos-kot-item-row ${i.itemStatus === 'served' || i.itemStatus === 'voided' ? 'resolved' : ''}">
      <div style="flex:1;">
        <div style="font-size:12px; ${i.itemStatus === 'served' || i.itemStatus === 'voided' ? 'text-decoration:line-through;' : ''}"><b>${i.qty}x</b> ${escapeHtml(i.name)}</div>
        ${(i.modifiers?.length || i.notes) ? `<div style="font-size:10.5px; color:var(--text-muted);">${[...(i.modifiers || []), i.notes].filter(Boolean).map(escapeHtml).join(', ')}</div>` : ''}
      </div>
      ${i.itemStatus === 'voided' ? `<span style="font-size:10px; font-weight:700; color:var(--danger); white-space:nowrap;"><i class="fa-solid fa-ban"></i> Cancelled</span>` : ''}
      ${i.itemStatus === 'served' ? `<span style="font-size:10px; font-weight:700; color:var(--primary); white-space:nowrap;"><i class="fa-solid fa-check-double"></i> ${meta.doneLabel}</span>` : ''}
      ${(!i.itemStatus || i.itemStatus === 'pending') ? `<button class="btn btn-ghost btn-sm rpos-item-ready" data-kot-id="${k.id}" data-idx="${idx}" style="font-size:11px; white-space:nowrap;">Ready</button>` : ''}
      ${i.itemStatus === 'ready' ? `<button class="btn btn-primary btn-sm rpos-item-serve" data-kot-id="${k.id}" data-idx="${idx}" style="font-size:11px; white-space:nowrap;"><i class="fa-solid ${meta.icon}"></i> ${meta.verb}</button>` : ''}
    </div>
  `;
}

function activeTicketFooter(k, items, meta) {
  const resolvableCount = items.filter(i => i.itemStatus !== 'voided').length;
  const servedCount = items.filter(i => i.itemStatus === 'served').length;
  const anyReady = items.some(i => i.itemStatus === 'ready');
  // "Ready" one dish at a time was the only option — a ticket with several
  // still-cooking items needed a separate click per item. Mark All Ready
  // is the bulk version of that same per-item Ready button, so it applies
  // to every order type equally (cooking-done is the same milestone
  // whether the dish then gets served, packed, or dispatched). The later
  // hand-off stage (Serve All Ready) stays dine-in-only, unchanged from
  // before — a deliberate earlier call, not something this touches.
  const anyPending = items.some(i => !i.itemStatus || i.itemStatus === 'pending');
  return `
    <div style="margin-top:10px; display:flex; flex-direction:column; gap:6px;">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
        <div style="font-size:10.5px; color:var(--text-muted);">${servedCount}/${resolvableCount} ${meta.doneLabel.toLowerCase()}</div>
        ${anyReady && k.orderType === 'dine-in' ? `<button class="btn btn-ghost btn-sm rpos-serve-all-ready" data-id="${k.id}" style="font-size:11px;">Serve All Ready</button>` : ''}
      </div>
      ${anyPending ? `<button class="btn btn-secondary btn-sm rpos-mark-all-ready" data-id="${k.id}" style="width:100%; font-size:11px;"><i class="fa-solid fa-bell"></i> Mark All Ready</button>` : ''}
    </div>
  `;
}

function renderActiveTicketGroup(group) {
  if (group.length === 1) {
    const k = group[0];
    const items = k.items || [];
    const meta = serveActionMeta(k.orderType);
    return `
      <div class="card rpos-kot-card" style="padding:14px; border-left:4px solid var(--warning);">
        ${ticketHeader(k)}
        <div style="margin-top:10px; display:flex; flex-direction:column;">
          ${items.map((i, idx) => activeItemRow(k, i, idx, meta)).join('')}
        </div>
        ${activeTicketFooter(k, items, meta)}
      </div>
    `;
  }
  const orderLabel = group[0].tableName ? escapeHtml(group[0].tableName) : (group[0].orderType || '').toUpperCase();
  return `
    <div class="card rpos-kot-card" style="padding:14px; border-left:4px solid var(--warning);">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
        <div style="font-weight:800; font-size:13px;">${orderLabel}</div>
        <span class="rpos-kitchen-col-count">${group.length} tickets</span>
      </div>
      ${group.map((k, i) => {
        const items = k.items || [];
        const meta = serveActionMeta(k.orderType);
        return `
          <div class="${i > 0 ? 'rpos-kot-wave-divider' : ''}" style="${i === 0 ? 'margin-top:8px;' : ''}">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">${waveLabel(k, i)}${waveTimer(k)}</div>
            <div style="margin-top:6px; display:flex; flex-direction:column;">
              ${items.map((i2, idx) => activeItemRow(k, i2, idx, meta)).join('')}
            </div>
            ${activeTicketFooter(k, items, meta)}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function wireKitchenListeners() {
  document.querySelectorAll('.rpos-kot-start').forEach(el => el.addEventListener('click', async () => {
    await updateKotStatus(el.dataset.id, 'preparing');
    await renderKitchenContent();
  }));
  document.querySelectorAll('.rpos-item-ready').forEach(el => el.addEventListener('click', async () => {
    await setKotItemStatus(el.dataset.kotId, parseInt(el.dataset.idx, 10), 'ready');
    await renderKitchenContent();
  }));
  document.querySelectorAll('.rpos-item-serve').forEach(el => el.addEventListener('click', async () => {
    await serveItem(el.dataset.kotId, parseInt(el.dataset.idx, 10));
  }));
  document.querySelectorAll('.rpos-mark-all-ready').forEach(el => el.addEventListener('click', async () => {
    const kots = await getKots();
    const kot = kots.find(k => k.id === el.dataset.id);
    if (!kot) return;
    (kot.items || []).forEach(i => { if (!i.itemStatus || i.itemStatus === 'pending') i.itemStatus = 'ready'; });
    await saveKot(kot);
    showToast('All items marked ready 🔔', 'success');
    await renderKitchenContent();
  }));
  document.querySelectorAll('.rpos-serve-all-ready').forEach(el => el.addEventListener('click', async () => {
    const kots = await getKots();
    const kot = kots.find(k => k.id === el.dataset.id);
    if (!kot) return;
    (kot.items || []).forEach(i => { if (i.itemStatus === 'ready') i.itemStatus = 'served'; });
    await finalizeKotIfComplete(kot);
    showToast('Served 🎉', 'success');
    await renderKitchenContent();
  }));
}

async function serveItem(kotId, idx) {
  const kots = await getKots();
  const kot = kots.find(k => k.id === kotId);
  if (!kot || !kot.items?.[idx]) return;
  kot.items[idx].itemStatus = 'served';
  await finalizeKotIfComplete(kot);
  showToast(`${kot.items[idx].name} ${serveActionMeta(kot.orderType).doneLabel.toLowerCase()} 🎉`, 'success');
  await renderKitchenContent();
}

// A ticket has nothing left for the kitchen to do once every one of its
// items is either served or voided (cancelled/modified away) — at that
// point it drops off this board entirely, same filter as "New Tickets".
async function finalizeKotIfComplete(kot) {
  const allResolved = (kot.items || []).every(i => i.itemStatus === 'served' || i.itemStatus === 'voided');
  if (allResolved) kot.status = 'served';
  await saveKot(kot);
}

function startKitchenTimerLoop() {
  if (kitchenTimerInterval) clearInterval(kitchenTimerInterval);
  kitchenTimerInterval = setInterval(() => {
    const area = document.getElementById('kitchenContent');
    if (!area) { clearInterval(kitchenTimerInterval); kitchenTimerInterval = null; return; }
    const timers = area.querySelectorAll('.rpos-kot-timer');
    if (timers.length === 0) { clearInterval(kitchenTimerInterval); kitchenTimerInterval = null; return; }
    timers.forEach(el => {
      const createdAt = el.dataset.createdAt;
      if (!createdAt) return;
      const ms = Date.now() - new Date(createdAt).getTime();
      const tier = kotTimerTier(ms);
      el.textContent = `${formatElapsed(ms)}${tier.overdue ? ' ⚠' : ''}`;
      el.style.color = tier.color;
    });
  }, 15000);
}
