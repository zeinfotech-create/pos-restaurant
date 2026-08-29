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

import { getKots, updateKotStatus, setKotItemStatus, saveKot, getSettings } from '../db.js';
import { showToast } from '../components/Toast.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { formatElapsed, kitchenFacingOrderLabel } from '../utils/tableDisplay.js';
import { syncEngine } from '../services/syncEngine.js';
import { navigate } from '../router.js';

let kitchenTimerInterval = null;
let liveListenerRegistered = false;
let syncStatusListenerRegistered = false;
// null = "haven't rendered yet" — the very first render shouldn't flash/
// chime for tickets that were already sitting there before this screen was
// even opened, only for ones that arrive WHILE it's open.
let knownTicketIds = null;

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
  // Swiggy/Zomato — the restaurant's own job ends at packing it; the
  // platform's own delivery rider (not this app) handles pickup/dispatch
  // from there, so this mirrors takeaway's wording, not delivery's.
  swiggy: { verb: 'Mark Packed', doneLabel: 'Packed', icon: 'fa-bag-shopping' },
  zomato: { verb: 'Mark Packed', doneLabel: 'Packed', icon: 'fa-bag-shopping' },
};
function serveActionMeta(orderType) {
  return SERVE_ACTION_META[orderType] || SERVE_ACTION_META['dine-in'];
}

export async function renderKitchen(container) {
  // Whichever route rendered this ('kitchen', the normal in-app tab, or
  // 'kitchen-display', its own popped-out window — see router.js) share
  // this exact same component; the only difference is this flag, which
  // decides whether "Open in New Window" makes sense to offer (no point
  // offering it from inside the window it would open).
  const isPopout = location.hash.startsWith('#kitchen-display') || location.hash.startsWith('#kd');
  // #page-container's own padding (24px, normally) is forced to 0 for every
  // STANDALONE page — and 'kitchen-display' only just became one (see
  // router.js) — so the popped-out window's content sat flush against the
  // window edge with no padding anywhere. The normal in-app 'kitchen' tab
  // is NOT standalone, so #page-container already gives it that same
  // 24px on its own — adding it again here too would double it up, so
  // this wrapper (and its padding) only applies to the popout.
  const headerHtml = `
    <div class="page-header">
      <div>
        <div class="page-title">Kitchen</div>
        <div class="page-subtitle">Live prep board — start a ticket, then serve each dish the moment it's ready</div>
      </div>
      <div style="display:flex; align-items:center; gap:14px;">
        <div id="kitchenSyncStatus" style="font-size:11px; font-weight:800; display:flex; align-items:center; gap:6px; white-space:nowrap;"></div>
        ${!isPopout ? `<button class="btn btn-ghost btn-sm" id="kitchenPopoutBtn"><i class="fa-solid fa-up-right-from-square"></i> Open in New Window</button>` : ''}
      </div>
    </div>
    <div id="kitchenContent" ${isPopout ? 'style="padding-bottom:76px;"' : ''}></div>
    ${isPopout ? `
      <div class="kd-mobile-navbar">
        <button class="kd-mobile-nav-btn" id="kitchenOrdersBtn"><i class="fa-solid fa-utensils"></i><span>Orders</span></button>
        <button class="kd-mobile-nav-btn active" id="kitchenSelfTab"><i class="fa-solid fa-kitchen-set"></i><span>Kitchen</span><span id="kitchenTabBadge"></span></button>
        <button class="kd-mobile-nav-btn" id="kitchenRefreshBtn"><i class="fa-solid fa-rotate-right"></i><span>Refresh</span></button>
        <button class="kd-mobile-nav-btn" id="kitchenLogoutBtn" style="color:var(--danger);"><i class="fa-solid fa-right-from-bracket"></i><span>Logout</span></button>
      </div>
      <style>
        /* Same visual language as RestaurantPOS.js's #mo bottom tab bar
           (.rpos-mobile-navbar) — a separate copy here rather than a
           shared import since each file already injects its own scoped
           <style>, but kept pixel-identical on purpose so switching
           between #mo and #kd via these bars feels like one consistent
           app, not two different screens bolted together. */
        .kd-mobile-navbar { position:fixed; left:0; right:0; bottom:0; display:flex; height:64px; background:var(--bg-elevated); border-top:1px solid var(--border); box-shadow:0 -2px 10px rgba(0,0,0,.08); z-index:500; }
        .kd-mobile-nav-btn { flex:1; border:none; background:none; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; font-size:10.5px; font-weight:700; color:var(--text-muted); cursor:pointer; position:relative; transition:color .15s; }
        .kd-mobile-nav-btn i { font-size:18px; transition:transform .15s; }
        .kd-mobile-nav-btn.active { color:var(--primary); }
        .kd-mobile-nav-btn.active i { transform:scale(1.1); }
        /* Same shape as RestaurantPOS.js's #mo navbar badge (.rpos-kot-badge)
           — inline-block, not absolutely positioned, so inside this
           flex-column button it naturally lands as its own small line under
           the "Kitchen" label, exactly like the #mo screen's own Kitchen tab. */
        #kitchenTabBadge:not(:empty) { display:inline-block; min-width:16px; padding:1px 5px; border-radius:999px; background:var(--danger); color:white; font-size:10px; font-weight:800; }
      </style>
    ` : ''}
  `;
  // The popout route is a STANDALONE page (router.js), and style.css locks
  // every standalone page's #page-container to `height:100vh; overflow:
  // hidden` — correct for pages like RestaurantPOS.js that build their own
  // fixed app-shell with internal scroll regions, but Kitchen.js has never
  // had one: it just flows the board as plain HTML. With no scroll
  // container of its own, a board with more tickets than fit one screen
  // had nowhere for the overflow to go — mouse wheel/touch scroll did
  // nothing. This wrapper gives the popout its OWN `height:100vh; overflow
  // -y:auto` region nested inside the hidden-overflow parent, so it scrolls
  // independently exactly like every other standalone page already does.
  container.innerHTML = isPopout ? `<div style="padding:24px; height:100vh; height:100dvh; overflow-y:auto; box-sizing:border-box;">${headerHtml}</div>` : headerHtml;

  // The popout route (kd/kitchen-display) has no sidebar/topbar at all —
  // this bottom bar is the ONLY way to navigate anywhere from it. Orders
  // hands off to the mobile order-taking screen (RestaurantPOS.js's own
  // #mo/#mobile-order route — same LAN lockdown whitelist as this one, see
  // router.js), so a waiter's phone can flip between taking orders and
  // checking the kitchen board without ever leaving the LAN entry point;
  // Refresh/Logout recover from a stuck sync state or sign out entirely.
  // Deliberately just these three — matches the explicit ask for a minimal
  // bar rather than the full app's #bottom-nav (index.html), which showed
  // live links to every other page and was hidden for every standalone
  // view in style.css for exactly this reason.
  document.getElementById('kitchenOrdersBtn')?.addEventListener('click', () => navigate('mo'));
  document.getElementById('kitchenRefreshBtn')?.addEventListener('click', () => window.location.reload());
  document.getElementById('kitchenLogoutBtn')?.addEventListener('click', () => window.logout?.());

  // Opens the SAME board in its own dedicated BrowserWindow (main.cjs's
  // window-open handler gives it a real frame + maximizes it, and its own
  // taskbar title — "Kitchen Display") — meant to be left running on a
  // second monitor, or on an entirely separate PC in the kitchen itself
  // (Settings > Advanced Connection Settings > Hub IP connects it to the
  // same shop's data over LAN). Reuses the same window name every click so
  // clicking again just refocuses the existing one instead of piling up
  // duplicates.
  document.getElementById('kitchenPopoutBtn')?.addEventListener('click', () => {
    window.open(window.location.origin + '#kitchen-display', 'pos_kitchen_display', 'width=1280,height=820');
  });

  renderSyncStatus();
  if (!syncStatusListenerRegistered) {
    // Most useful exactly where this matters most — a Kitchen Display
    // running on a separate PC over LAN sync — so staff can tell "not
    // updating because nothing's happening" from "not updating because
    // this screen lost its connection" at a glance, without needing to dig
    // into Settings to check.
    window.addEventListener('sync-status-changed', renderSyncStatus);
    syncStatusListenerRegistered = true;
  }

  // A KOT sent from RestaurantPOS.js shows up here immediately rather than
  // only on the next manual visit to this page — real KDS boards are
  // expected to update live. Two DIFFERENT events matter here, not one:
  // 'storage-change' fires for a write made on THIS device; a KOT arriving
  // via LAN sync from a separate Kitchen-display machine (see syncEngine.js
  // handleIncomingUpdate) is written silently and fires 'data-synced'
  // instead, specifically so a local edit mid-flight can't be confused with
  // one that just arrived from another device — both are listened for here
  // so a genuinely separate Kitchen PC stays live too, not just this one.
  // Registered once globally (guarded, like the cart listener in
  // RestaurantPOS.js) and self-checks the container is still on screen
  // before acting, since there's no page-unmount hook in this router to
  // unregister it on navigating away.
  if (!liveListenerRegistered) {
    const onKotChange = (e) => {
      if (e.detail?.store !== 'kots') return;
      if (!document.getElementById('kitchenContent')) return;
      renderKitchenContent();
    };
    window.addEventListener('storage-change', onKotChange);
    window.addEventListener('data-synced', onKotChange);
    liveListenerRegistered = true;
  }

  await renderKitchenContent();
}

function renderSyncStatus() {
  const el = document.getElementById('kitchenSyncStatus');
  if (!el) return;
  const online = syncEngine.isConnected;
  el.style.color = online ? 'var(--success)' : 'var(--danger)';
  // Showing the connected tenant key (truncated) only on the popped-out/
  // mobile route is a debug aid, not a UX feature — it's what actually
  // makes a "Live but shows nothing" report diagnosable from a screenshot
  // alone: 'LOCAL_EXE' here means this device registered as an unclaimed
  // placeholder, not this shop's real tenant, and would never see the
  // main POS's data no matter how "Live" it looks.
  const isPopout = location.hash.startsWith('#kitchen-display') || location.hash.startsWith('#kd');
  const keyBadge = isPopout && syncEngine.licenseKey ? ` <span style="opacity:.5; font-weight:600;">(${syncEngine.licenseKey})</span>` : '';
  el.innerHTML = `<i class="fa-solid fa-circle" style="font-size:7px;"></i> ${online ? 'Live' : 'Reconnecting…'}${keyBadge}`;
}

async function renderKitchenContent() {
  const area = document.getElementById('kitchenContent');
  if (!area) return;
  const kots = (await getKots()).filter(k => k.status !== 'served');
  const pending = kots.filter(k => (k.status || 'pending') === 'pending').sort(byAge);
  const active = kots.filter(k => (k.status || 'pending') !== 'pending').sort(byAge);
  // Settings > KOT > "Show add-on waves as separate tickets" — off by
  // default (grouped, the original v9g behavior). On, every wave stands
  // on its own card instead of nesting under one order.
  const settings = await getSettings();
  const splitTickets = settings.kotSplitTickets === true;
  // Grouped WITHIN each column only — a wave already started (in Kitchen)
  // while a later wave for the same order hasn't been touched yet (New
  // Tickets) genuinely are two separate physical tickets at two different
  // stages, so they correctly stay apart across columns; only tickets that
  // are actually at the same stage get visually combined under one order.
  const pendingGroups = groupByOrder(pending, splitTickets);
  const activeGroups = groupByOrder(active, splitTickets);
  // A screen meant to be glanced at (or not looked at all, on a second
  // monitor/PC) needs more than a silently-updated list — flag whether a
  // ticket genuinely wasn't here last render, so a fresh order gets an
  // actual flash + chime, not just a number quietly changing.
  const hasNewTicket = detectNewTickets(pending);

  area.innerHTML = `
    ${kots.length === 0 ? `
      <div class="card" style="padding:48px; text-align:center; color:var(--text-muted);">
        <i class="fa-solid fa-kitchen-set" style="font-size:36px; opacity:0.2; margin-bottom:12px; display:block"></i>
        Nothing pending — all caught up 🎉
      </div>
    ` : `
      <div class="rpos-kitchen-board">
        <div class="rpos-kitchen-col">
          <div class="rpos-kitchen-col-header ${hasNewTicket ? 'rpos-flash-new' : ''}" style="color:var(--text-muted);"><i class="fa-solid fa-hourglass-start"></i> New Tickets <span class="rpos-kitchen-col-count">${pending.length}</span></div>
          <div class="rpos-kitchen-col-body">
            ${pendingGroups.length === 0 ? emptyCol() : pendingGroups.map(renderNewTicketGroup).join('')}
          </div>
        </div>
        <div class="rpos-kitchen-col rpos-kitchen-col-divided">
          <div class="rpos-kitchen-col-header" style="color:var(--warning);"><i class="fa-solid fa-fire"></i> In Kitchen <span class="rpos-kitchen-col-count">${active.length}</span></div>
          <div class="rpos-kitchen-active-grid">
            ${activeGroups.length === 0 ? emptyCol() : activeGroups.map(renderActiveTicketGroup).join('')}
          </div>
        </div>
      </div>
    `}
    <style>
      /* Both columns wrap tickets into a responsive grid now (not just "In
         Kitchen") — on a wide/maximized Kitchen Display window a single
         stacked list left most of the screen empty even with several
         tickets on the board; a 50/50 split (not the old 1fr/2fr) means
         neither column looks lopsided when the other is quiet. */
      .rpos-kitchen-board { display:grid; grid-template-columns:1fr 1fr; gap:20px; align-items:start; }
      @media (max-width:900px) { .rpos-kitchen-board { grid-template-columns:1fr; } .rpos-kitchen-col-divided { padding-left:0; border-left:none; } }
      /* A visible seam between the two halves, not just whitespace — on a
         wide Kitchen Display screen "New Tickets" and "In Kitchen" read as
         two distinct working areas rather than one board that happens to
         wrap oddly in the middle. */
      .rpos-kitchen-col-divided { padding-left:20px; border-left:1px solid var(--border); }
      .rpos-kitchen-col-header { display:flex; align-items:center; gap:8px; font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:.4px; margin-bottom:10px; border-radius:8px; padding:4px 6px; margin-left:-6px; }
      .rpos-kitchen-col-count { margin-left:auto; background:var(--bg-elevated); border:1px solid var(--border); border-radius:999px; padding:1px 8px; font-size:11px; }
      .rpos-kitchen-col-body, .rpos-kitchen-active-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(260px,1fr)); gap:12px; align-items:start; }
      .rpos-kot-item-row { display:flex; align-items:center; gap:8px; padding:5px 0; border-bottom:1px dashed var(--border); }
      .rpos-kot-item-row:last-child { border-bottom:none; }
      .rpos-kot-item-row.resolved { opacity:.55; }
      .rpos-kot-wave-divider { margin-top:12px; padding-top:12px; border-top:1px dashed var(--border); }
      @keyframes rposNewTicketFlash {
        0%, 100% { background:transparent; }
        50% { background:rgba(245,158,11,0.35); }
      }
      .rpos-flash-new { animation:rposNewTicketFlash 0.7s ease-in-out 3; }
    </style>
  `;
  wireKitchenListeners();
  startKitchenTimerLoop();
  if (hasNewTicket) playNewTicketChime();
  // Popout bottom bar's own Kitchen tab badge — same count as this board's
  // own tickets (kots, already computed above), kept live the same way the
  // board itself already is: this whole function re-runs on every
  // storage-change/data-synced event (see renderKitchen()'s listener), so
  // there's no separate refresh path needed here.
  const tabBadge = document.getElementById('kitchenTabBadge');
  if (tabBadge) tabBadge.textContent = kots.length > 0 ? String(kots.length) : '';
}

// Compares this render's pending-ticket ids against the last render's —
// null on the very first call (nothing to compare against yet, and a
// screen that was just opened shouldn't flash/chime for tickets that were
// already sitting there before it existed). Module-scoped rather than
// reset per-mount deliberately: navigating away from Kitchen and back
// still correctly alerts for whatever arrived while it wasn't the active
// page, instead of forgetting and staying silent.
function detectNewTickets(pending) {
  const currentIds = new Set(pending.map(k => k.id));
  if (knownTicketIds === null) {
    knownTicketIds = currentIds;
    return false;
  }
  let hasNew = false;
  currentIds.forEach(id => { if (!knownTicketIds.has(id)) hasNew = true; });
  knownTicketIds = currentIds;
  return hasNew;
}

// A short two-tone chime via the Web Audio API — no asset file needed, and
// it degrades silently (try/catch) if the browser/Electron blocks audio
// before any user gesture has unlocked it, since this is a nice-to-have
// alert, not something that should ever break the board if it fails.
function playNewTicketChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [880, 1175].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.type = 'sine';
      o.frequency.value = freq;
      const start = ctx.currentTime + i * 0.14;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.25);
      o.start(start);
      o.stop(start + 0.28);
    });
  } catch (e) {
    // Audio unavailable/blocked — the visual flash still carries the alert.
  }
}

function byAge(a, b) { return new Date(a.createdAt) - new Date(b.createdAt); }
// grid-column:1/-1 spans the WHOLE row of the wrapping grid it sits in —
// without it, this would just be one narrow ~260px cell floating at the
// left edge of an otherwise-empty column, instead of a proper centered
// placeholder.
function emptyCol() {
  return `<div style="grid-column:1/-1; text-align:center; padding:28px; color:var(--text-muted); border:1.5px dashed var(--border); border-radius:14px; font-size:12px;"><i class="fa-solid fa-mug-hot" style="font-size:20px; opacity:.3; display:block; margin-bottom:8px;"></i>Nothing here right now</div>`;
}

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
function groupByOrder(kots, splitTickets = false) {
  // Settings > KOT > "Show add-on waves as separate tickets" — every
  // ticket is its own standalone singleton group, exactly the pre-v9g
  // behavior, when the shop would rather see (and print) each wave
  // independently instead of nested under one order card.
  if (splitTickets) return kots.map(k => [k]);
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
        ${k.tableName ? escapeHtml(kitchenFacingOrderLabel(k.tableName)) : (k.orderType || '').toUpperCase()}${k.course ? ` · ${escapeHtml(k.course)}` : ''}
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
      <div class="card rpos-kot-card" style="padding:14px;">
        ${ticketHeader(k)}
        <div style="margin-top:10px; display:flex; flex-direction:column; gap:2px;">
          ${(k.items || []).map(newTicketItemLine).join('')}
        </div>
        <button class="btn btn-primary btn-sm rpos-kot-start" data-id="${k.id}" style="margin-top:12px; width:100%;"><i class="fa-solid fa-fire"></i> Start Preparing</button>
      </div>
    `;
  }
  const orderLabel = group[0].tableName ? escapeHtml(kitchenFacingOrderLabel(group[0].tableName)) : (group[0].orderType || '').toUpperCase();
  return `
    <div class="card rpos-kot-card" style="padding:14px;">
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
      <div class="card rpos-kot-card" style="padding:14px;">
        ${ticketHeader(k)}
        <div style="margin-top:10px; display:flex; flex-direction:column;">
          ${items.map((i, idx) => activeItemRow(k, i, idx, meta)).join('')}
        </div>
        ${activeTicketFooter(k, items, meta)}
      </div>
    `;
  }
  const orderLabel = group[0].tableName ? escapeHtml(kitchenFacingOrderLabel(group[0].tableName)) : (group[0].orderType || '').toUpperCase();
  return `
    <div class="card rpos-kot-card" style="padding:14px;">
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
