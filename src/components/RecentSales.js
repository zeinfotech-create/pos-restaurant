// ============================================================
// RecentSales.js — "Recent Sales" quick-view (last 10), shared by POS.js
// and QuickPOS.js so both cashier screens get the same list + detail/print/
// return/settle actions without duplicating the modal-building logic twice.
// Row click reuses Orders.js's own viewOrderDetail() — same receipt view,
// same Print/Process Return/Settle Payment buttons a cashier gets from the
// full Order History page, not a stripped-down read-only preview.
// ============================================================

import { getOrders } from '../db.js';
import { store } from '../store.js';
import { openModal, closeModal } from './Modal.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { viewOrderDetail } from '../pages/Orders.js';

const RECENT_SALES_LIMIT = 10;

export async function openRecentSalesModal(cur) {
  const branchId = store.branch?.id;
  const orders = await getOrders(branchId);
  const recent = [...orders]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, RECENT_SALES_LIMIT);

  const body = recent.length === 0
    ? `<div class="empty-state" style="padding:40px 0"><i class="fa-solid fa-receipt"></i><p>No sales yet</p></div>`
    : `<div style="display:flex; flex-direction:column; gap:8px;">${recent.map(o => renderRow(o, cur)).join('')}</div>`;

  openModal({
    title: `<i class="fa-solid fa-clock-rotate-left mr-8" style="color:var(--primary)"></i>Recent Sales`,
    body,
    footer: `<button class="btn btn-ghost" id="recentSalesCloseBtn" style="width:100%">Close</button>`,
    sidePanel: false
  });

  const closeBtn = document.getElementById('recentSalesCloseBtn');
  if (closeBtn) closeBtn.onclick = () => closeModal();

  document.querySelectorAll('.recent-sale-row').forEach(row => {
    row.onclick = async () => {
      const order = recent.find(o => o.id === row.dataset.id);
      if (order) {
        closeModal();
        // viewOrderDetail() opens its own modal — give the close animation
        // above a beat to clear the overlay generation first (see Modal.js's
        // modalGeneration guard), same pattern CheckoutService's
        // close-then-reopen-for-receipt flow already relies on.
        setTimeout(() => viewOrderDetail(order, cur), 320);
      }
    };
  });
}

function renderRow(o, cur) {
  const isCancelled = o.status === 'cancelled';
  const isUnpaid = o.status === 'credit' || o.paymentMethod === 'Unpaid';
  const isReturned = o.status === 'returned' || o.status === 'partial-return';
  // Fixed rgb triplets (not var(--danger) etc.) so the badge background tint
  // below can use a literal rgba() alpha — CSS custom properties can't be
  // fed into rgba()'s component slots directly.
  const statusRgb = isCancelled ? '239,68,68' : (isUnpaid ? '245,158,11' : (isReturned ? '148,163,184' : '16,185,129'));
  const statusColor = `rgb(${statusRgb})`;
  const statusLabel = isCancelled ? 'Cancelled' : (isUnpaid ? 'Unpaid' : (o.status === 'partial-return' ? 'Partial Return' : (o.status === 'returned' ? 'Returned' : 'Paid')));
  const itemCount = (o.items || []).reduce((s, it) => s + (it.qty || 1), 0);
  const time = new Date(o.date).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const payLabel = isUnpaid ? 'Unpaid' : (o.payments && o.payments.length > 1 ? `Split (${o.payments.length})` : (o.paymentMethod || 'Cash'));

  return `
    <div class="recent-sale-row" data-id="${o.id}" style="display:flex; align-items:center; gap:12px; padding:10px 12px; border:1px solid var(--border-subtle); border-radius:10px; cursor:pointer;">
      <div style="width:36px; height:36px; border-radius:50%; background:rgba(79,70,229,0.1); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
        <i class="fa-solid fa-receipt" style="color:var(--primary); font-size:14px;"></i>
      </div>
      <div style="flex:1; min-width:0;">
        <div style="font-size:13px; font-weight:700; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${o.customer?.name ? escapeHtml(o.customer.name) : 'Walk-in Customer'}</div>
        <div style="font-size:11px; color:var(--text-muted);">${escapeHtml(o.id)} &middot; ${itemCount} item${itemCount !== 1 ? 's' : ''} &middot; ${escapeHtml(payLabel)}</div>
      </div>
      <div style="text-align:right; flex-shrink:0;">
        <div style="font-size:13px; font-weight:800; color:var(--text-primary);">${cur}${(o.total || 0).toFixed(2)}</div>
        <div style="font-size:10px; color:var(--text-muted); white-space:nowrap;">${time}</div>
      </div>
      <span style="font-size:9px; font-weight:800; color:${statusColor}; background:rgba(${statusRgb},0.15); padding:2px 8px; border-radius:6px; text-transform:uppercase; flex-shrink:0;">${statusLabel}</span>
    </div>
  `;
}
