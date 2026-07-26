// ============================================================
// Orders.js — Order History
// ============================================================

import { getOrders, getReturns, updateData, getSettings, hasPermission, settleOrderPayment } from '../db.js';
import { store } from '../store.js';
import { showToast } from '../components/Toast.js';
import { openModal, closeModal } from '../components/Modal.js';
import { renderReceiptBody, renderOrderReturnsReceipt, printReceiptHtml, renderReceiptBarcodes } from '../services/CheckoutService.js';
import { initDateRangePicker, getDefaultRange } from '../utils/dateRangeHelper.js';
import { applySessionFilter } from '../utils/sessionFilter.js';

let searchQ = '';
const { start: defaultStart, end: defaultEnd } = getDefaultRange();
let filterStartDate = defaultStart;
let filterEndDate = defaultEnd;
let filterMinTotal = 0;
let filterMaxTotal = Infinity;
let currentPage = 1;
let itemsPerPage = 10;

export async function renderOrders(container) {
  const settings = await getSettings();
  const cur = settings.currency;

  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Order History</div>
        <div class="page-subtitle">All transactions</div>
      </div>
      <button class="btn btn-ghost hide-desktop" id="mobileFilterToggle" style="border:1px solid var(--border)">
        <i class="fa-solid fa-filter mr-8"></i> Filters
      </button>
    </div>
    
    <div class="mb-16" id="filterCard" style="transition: all 0.3s ease-in-out; overflow:hidden">
      <div class="data-mgmt-bar mobile-filter-stack p-16">
        <div class="search-input-wrap">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input class="form-input" id="orderSearch" placeholder="Search by Order ID or payment method..." />
        </div>
        
        <div class="filter-group">
          <label class="filter-label">Date Range</label>
          <div class="date-picker-group">
            <i class="fa-solid fa-calendar-day"></i>
            <input type="text" id="order-date-range" class="form-input-clean" style="width:100%" readonly />
          </div>
        </div>

        <div class="filter-group">
          <label class="filter-label">Min Total</label>
          <input class="form-input" id="minTotal" type="number" placeholder="0" />
        </div>
        
        <div class="filter-group">
          <label class="filter-label">Max Total</label>
          <input class="form-input" id="maxTotal" type="number" placeholder="Max" />
        </div>
      </div>
    </div>
    
    <div id="ordersArea">
        <div id="ordersContent"></div>
        <div id="orderPaginationArea"></div>
    </div>
  `;

  // Mobile Filter Toggle Logic
  const filterCard = document.getElementById('filterCard');
  const toggleBtn = document.getElementById('mobileFilterToggle');
  if (toggleBtn && filterCard) {
    let isExpanded = false;
    // Set initial state for mobile
    if (window.innerWidth <= 900) {
      filterCard.style.maxHeight = '0px';
      filterCard.style.padding = '0px';
      filterCard.style.margin = '0px';
      filterCard.style.opacity = '0';
    }

    toggleBtn.onclick = () => {
      isExpanded = !isExpanded;
      if (isExpanded) {
        filterCard.style.maxHeight = '500px';
        filterCard.style.padding = '16px';
        filterCard.style.margin = '0 0 16px 0';
        filterCard.style.opacity = '1';
        toggleBtn.classList.add('active');
        toggleBtn.innerHTML = '<i class="fa-solid fa-times mr-8"></i> Hide Filters';
      } else {
        filterCard.style.maxHeight = '0px';
        filterCard.style.padding = '0px';
        filterCard.style.margin = '0px';
        filterCard.style.opacity = '0';
        toggleBtn.classList.remove('active');
        toggleBtn.innerHTML = '<i class="fa-solid fa-filter mr-8"></i> Filters';
      }
    };
  }

  // Listeners
  document.getElementById('orderSearch').addEventListener('input', e => {
    searchQ = e.target.value.toLowerCase();
    currentPage = 1;
    renderOrderList(cur);
  });
  
  initDateRangePicker('order-date-range', filterStartDate, filterEndDate, (start, end) => {
    filterStartDate = start;
    filterEndDate = end;
    currentPage = 1;
    renderOrderList(cur);
  });

  document.getElementById('minTotal').addEventListener('input', e => {
    filterMinTotal = parseFloat(e.target.value) || 0;
    currentPage = 1;
    renderOrderList(cur);
  });
  document.getElementById('maxTotal').addEventListener('input', e => {
    filterMaxTotal = parseFloat(e.target.value) || Infinity;
    currentPage = 1;
    renderOrderList(cur);
  });

  renderOrderList(cur);

  // Auto-refresh on storage change
  const refreshHandler = (e) => {
    if (e.detail.store === 'orders') {
      renderOrderList(cur);
    }
  };
  window.addEventListener('storage-change', refreshHandler);

  // Cleanup listener on next render (if needed)
  container.addEventListener('remove', () => {
    window.removeEventListener('storage-change', refreshHandler);
  }, { once: true });
}

/**
 * order.status ('returned'/'partial-return') is written once, denormalized,
 * when a return is saved — it never gets revisited if the underlying return
 * record later disappears (deleted in-app, or edited directly in the database).
 * Recompute it here from the actual returns data on every load so the badge
 * can never drift from reality, and persist the correction.
 */
async function healReturnStatuses(orders) {
  const flagged = orders.filter(o => o.status === 'returned' || o.status === 'partial-return');
  if (flagged.length === 0) return;

  const allReturns = await getReturns();
  const returnedQtyByOrder = {};
  allReturns.forEach(r => {
    if (r.type !== 'sales' || !r.orderId) return;
    const qty = (r.items || []).reduce((s, i) => s + (i.qty || 0), 0);
    returnedQtyByOrder[r.orderId] = (returnedQtyByOrder[r.orderId] || 0) + qty;
  });

  for (const o of flagged) {
    const totalReturnedQty = returnedQtyByOrder[o.id] || 0;
    const originalQty = (o.items || []).reduce((s, i) => s + (i.qty || 0), 0);
    const correctStatus = totalReturnedQty <= 0 ? 'completed' : (totalReturnedQty >= originalQty ? 'returned' : 'partial-return');
    if (correctStatus !== o.status) {
      o.status = correctStatus;
      await updateData('orders', o, true);
    }
  }
}

async function renderOrderList(cur) {
  const wrap = document.getElementById('ordersContent');
  if (!wrap) return;
  let rawOrders = await getOrders(store.branch?.id);
  await healReturnStatuses(rawOrders);
  let orders = await applySessionFilter(rawOrders, 'date');

  // Advanced Filtering
  if (searchQ) orders = orders.filter(o =>
    o.id.toLowerCase().includes(searchQ) || o.paymentMethod.toLowerCase().includes(searchQ)
  );
  if (filterStartDate && filterEndDate) {
    orders = orders.filter(o => {
      const d = o.date.split('T')[0];
      return d >= filterStartDate && d <= filterEndDate;
    });
  }
  if (filterMinTotal > 0) orders = orders.filter(o => o.total >= filterMinTotal);
  if (filterMaxTotal !== Infinity) orders = orders.filter(o => o.total <= filterMaxTotal);

  // Sort by date DESC (Newest first)
  orders.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Pagination
  const totalItems = orders.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * itemsPerPage;
  const paginatedOrders = orders.slice(start, start + itemsPerPage);

  if (totalItems === 0) {
    wrap.innerHTML = `<div class="empty-state"><i class="fa-solid fa-receipt"></i><p>No orders found</p></div>`;
    const pagArea = document.getElementById('orderPaginationArea');
    if (pagArea) pagArea.innerHTML = '';
    return;
  }

  wrap.innerHTML = `
    <div class="table-wrap">
      <table class="responsive-table">
        <thead><tr>
          <th>Order ID</th><th>Date & Time</th><th>Customer</th><th>Items</th>
          <th>Subtotal</th><th>Tax</th><th>Total</th><th>Status</th><th>Payment</th><th>Action</th>
        </tr></thead>
        <tbody>
          ${paginatedOrders.map(o => `
            <tr>
              <td data-label="Order ID"><span class="badge badge-primary">${o.id}</span></td>
              <td data-label="Date & Time" class="text-muted">${new Date(o.date).toLocaleString('en-IN')}</td>
              <td data-label="Customer">
                <div class="font-semibold">${o.customer?.name || '<span class="text-muted">Walk-in</span>'}</div>
                <div class="text-muted" style="font-size:10px">${o.customer?.phone || ''}</div>
              </td>
              <td data-label="Items">${o.items.length} items</td>
              <td data-label="Subtotal">${cur}${o.subtotal.toFixed(2)}</td>
              <td data-label="Tax">${cur}${o.tax.toFixed(2)}</td>
              <td data-label="Total" class="font-bold text-accent">${cur}${o.total.toFixed(2)}</td>
              <td data-label="Status">${renderStatusBadge(o.status)}</td>
              <td data-label="Payment">
                <span class="badge badge-${payBadge(o.paymentMethod)}">${o.paymentMethod}</span>
                ${o.isCredit ? `<span class="badge badge-danger ml-4" style="font-size:9px">CREDIT</span>` : ''}
              </td>
              <td>
                <button class="btn btn-ghost btn-sm view-btn" data-id="${o.id}">
                  <i class="fa-solid fa-eye"></i> View
                </button>
                ${o.status === 'credit' ? `
                  <button class="btn btn-ghost btn-sm pay-btn ml-4 text-success" data-id="${o.id}">
                    <i class="fa-solid fa-money-bill-wave"></i> Pay
                  </button>
                ` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  renderOrderPagination(totalPages, cur);

  wrap.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const order = (await getOrders(store.branch?.id)).find(o => o.id === btn.dataset.id);
      if (order) await viewOrderDetail(order, cur);
    });
  });

  wrap.querySelectorAll('.pay-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const order = (await getOrders(store.branch?.id)).find(o => o.id === btn.dataset.id);
      if (order) await payOrder(order, cur);
    });
  });
}

function renderOrderPagination(totalPages, cur) {
  const pagArea = document.getElementById('orderPaginationArea');
  if (!pagArea) return;

  let html = `
    <div class="pagination-bar">
      <span>Showing page <b>${currentPage}</b> of <b>${totalPages}</b></span>
      <div class="pagination-controls">
        <button class="pagination-btn" id="prevOrderPage" ${currentPage === 1 ? 'disabled' : ''}>
          <i class="fa-solid fa-chevron-left"></i>
        </button>
  `;

  for (let i = 1; i <= totalPages; i++) {
    if (totalPages > 5 && Math.abs(i - currentPage) > 2 && i !== 1 && i !== totalPages) {
      if (i === 2 || i === totalPages - 1) html += `<span style="padding: 0 4px">...</span>`;
      continue;
    }
    html += `<button class="pagination-btn ${i === currentPage ? 'active' : ''} order-page-btn" data-page="${i}">${i}</button>`;
  }

  html += `
        <button class="pagination-btn" id="nextOrderPage" ${currentPage === totalPages ? 'disabled' : ''}>
          <i class="fa-solid fa-chevron-right"></i>
        </button>
      </div>
    </div>
  `;

  pagArea.innerHTML = html;

  document.getElementById('prevOrderPage').onclick = async () => {
    if (currentPage > 1) {
      currentPage--;
      await renderOrderList(cur);
    }
  };
  document.getElementById('nextOrderPage').onclick = async () => {
    if (currentPage < totalPages) {
      currentPage++;
      await renderOrderList(cur);
    }
  };
  pagArea.querySelectorAll('.order-page-btn').forEach(btn => {
    btn.onclick = async () => {
      currentPage = parseInt(btn.dataset.page);
      await renderOrderList(cur);
    };
  });
}

function payBadge(method) {
  const map = { Cash: 'success', Card: 'info', UPI: 'primary', Wallet: 'warning' };
  return map[method] || 'info';
}

function renderStatusBadge(status) {
  const s = status || 'completed';
  const map = {
    'completed': { label: 'Completed', class: 'success' },
    'credit': { label: 'Credit/Due', class: 'warning' },
    'cancelled': { label: 'Cancelled', class: 'danger' },
    'returned': { label: 'Full Returned', class: 'info' },
    'partial-return': { label: 'Partial Returned', class: 'warning' }
  };
  const config = map[s] || map.completed;
  return `<span class="badge badge-${config.class}">${config.label}</span>`;
}

async function viewOrderDetail(order, cur) {
  const settings = await getSettings();
  const allReturns = (await getReturns()).filter(r => r.orderId === order.id);
  const hasReturns = allReturns.length > 0;

  openModal({
    title: `Order ${order.id}`,
    body: await renderReceiptBody(order, settings, cur),
    footer: `
          <button class="btn btn-ghost" id="closeDetailBtn">Close</button>
          ${order.status === 'credit' ? `
            <button class="btn btn-success" id="payOrderBtn"><i class="fa-solid fa-money-bill-wave"></i> Settle Payment</button>
          ` : ''}
          ${await hasPermission('orders:refund') ? `
            <button class="btn btn-danger" id="returnOrderBtn"><i class="fa-solid fa-rotate-left"></i> Process Return</button>
          ` : ''}
          ${hasReturns ? `
            <button class="btn btn-primary" id="printSaleBtn"><i class="fa-solid fa-print"></i> Sale Print</button>
            <button class="btn btn-accent" id="printReturnBtn"><i class="fa-solid fa-print"></i> Return Print</button>
          ` : `
            <button class="btn btn-primary" id="printOrderBtn"><i class="fa-solid fa-print"></i> Print Receipt</button>
          `}
        `,
  });

  setTimeout(() => {
    renderReceiptBarcodes(document.querySelector('.modal-body'));

    const closeBtn = document.getElementById('closeDetailBtn');
    const printBtn = document.getElementById('printOrderBtn');
    const returnBtn = document.getElementById('returnOrderBtn');
    const printSaleBtn = document.getElementById('printSaleBtn');
    const printReturnBtn = document.getElementById('printReturnBtn');

    if (printSaleBtn) {
      printSaleBtn.onclick = async () => {
        const saleOnlyBody = await renderReceiptBody(order, settings, cur, false);
        // This string is never inserted into the visible modal, so the
        // barcode <svg> placeholder needs a real (if temporary, off-screen)
        // DOM attachment for JsBarcode to draw into before we serialize it.
        const tempDiv = document.createElement('div');
        tempDiv.style.cssText = 'position:absolute; left:-9999px; top:-9999px;';
        tempDiv.innerHTML = saleOnlyBody;
        document.body.appendChild(tempDiv);
        renderReceiptBarcodes(tempDiv);
        printReceiptHtml(tempDiv.innerHTML, `Sale Receipt - ${order.id}`);
        tempDiv.remove();
      };
    }
    if (printReturnBtn) {
      printReturnBtn.onclick = () => {
        const returnBody = renderOrderReturnsReceipt(order, allReturns, settings, cur);
        printReceiptHtml(returnBody, `Return Receipt - ${order.id}`);
      };
    }

    if (closeBtn) closeBtn.onclick = closeModal;
    if (printBtn) printBtn.onclick = () => printReceiptHtml(document.querySelector('.modal-body')?.innerHTML || '', `Receipt - ${order.id}`);
    if (returnBtn) returnBtn.onclick = () => openReturnModal(order, cur);
    const payBtn = document.getElementById('payOrderBtn');
    if (payBtn) {
      payBtn.onclick = () => {
        payOrder(order, cur);
      };
    }

  }, 0);
}

async function openReturnModal(order, cur) {
  const db = await import('../db.js');
  const products = await db.getProducts();
  const allReturns = (await db.getReturns()).filter(r => r.orderId === order.id);
    const returnedQtyMap = {};
    allReturns.forEach(r => {
      r.items.forEach(item => {
        returnedQtyMap[item.id] = (returnedQtyMap[item.id] || 0) + item.qty;
      });
    });

    let returnedItems = order.items.map(item => {
      const p = products.find(prod => prod.id === item.id);
      const isReturnable = p ? p.isReturnable !== false : true;
      const alreadyReturned = parseFloat((returnedQtyMap[item.id] || 0).toFixed(3));
      const availableQty = parseFloat((item.qty - alreadyReturned).toFixed(3));
      return { ...item, returnQty: 0, availableQty, alreadyReturned, isReturnable };
    });

    let refundMethod = 'Cash';

    function renderRows() {
      return returnedItems.map((item, idx) => `
        <div class="payment-row" style="margin-bottom:12px; display:flex; align-items:center; gap:12px; background:var(--bg-elevated); padding:12px; border-radius:8px ${(!item.isReturnable || item.availableQty <= 0) ? 'opacity:0.5' : ''}">
          <div style="flex:1">
            <div class="font-bold">
              ${item.emoji || '📦'} ${item.name}
              ${!item.isReturnable ? '<span class="badge badge-danger ml-8" style="font-size:9px">Non-Returnable</span>' : ''}
            </div>
            <div style="font-size:11px; opacity:0.6">
              Original: ${item.qty} | 
              <span class="text-danger">Returned: ${item.alreadyReturned}</span> | 
              <span class="text-success">Available: ${item.isReturnable ? item.availableQty : 0}</span>
            </div>
          </div>
          <div style="width:120px">
            <input type="number" class="form-input return-qty-input" data-idx="${idx}" 
              value="${item.returnQty}" min="0" max="${item.isReturnable ? item.availableQty : 0}" step="any"
              ${(!item.isReturnable || item.availableQty <= 0) ? 'disabled' : ''} />
          </div>
        </div>
      `).join('');
    }

    function updateModal() {
      // Item discount can be a flat per-unit ₹ amount or a % of the line — matches
      // store.js's getCartTotals() discountTotal formula.
      const itemDiscountTotal = (i) => {
        const lineTotal = (parseFloat(i.price) || 0) * (parseFloat(i.qty) || 0);
        return i.itemDiscountType === 'pct'
          ? (lineTotal * (parseFloat(i.itemDiscount) || 0) / 100)
          : ((parseFloat(i.itemDiscount) || 0) * (parseFloat(i.qty) || 0));
      };

      // Calculate refund including its share of the discount and exact tax
      const totalItemDiscounts = order.items.reduce((s, i) => s + itemDiscountTotal(i), 0);
      const globalOnlyDiscount = Math.max(0, (order.discount || 0) - totalItemDiscounts);
      const netOrderSubtotal = Math.max(1, (order.subtotal || 1) - totalItemDiscounts);

      const getRefundPerItem = (item) => {
        const baseQty = parseFloat(item.qty) || 1;
        const perUnitBasePrice = parseFloat(item.price) || 0;
        const perUnitItemDiscount = itemDiscountTotal(item) / baseQty;

        // Use net price after item discount as the basis for global discount allocation
        const itemNetBase = Math.max(0, perUnitBasePrice - perUnitItemDiscount);
        
        // Share of global discount (e.g. from Order-level % or Coupon)
        const globalDiscountShare = (itemNetBase / netOrderSubtotal) * globalOnlyDiscount;

        // Share of tax
        const exactTax = (parseFloat(item.finalTax) || 0) / baseQty;
        const taxShareAmount = item.taxType === 'inclusive' ? 0 : exactTax;

        const refundPerUnit = itemNetBase - globalDiscountShare + taxShareAmount;
        return parseFloat(refundPerUnit.toFixed(4)); 
      };

      const totalReturn = returnedItems.reduce((sum, item) => sum + (item.returnQty * getRefundPerItem(item)), 0);
      const body = `
        <div style="padding:10px">
          <div class="mb-16 text-muted" style="font-size:13px">Select quantities to return. You cannot return more than the available quantity.</div>
          <div id="returnItemsContainer">${renderRows()}</div>
          
          <div style="background:var(--bg-elevated); padding:12px; border-radius:8px; margin-top:16px; border:1px dashed var(--border)">
            <div style="font-size:11px; font-weight:bold; color:var(--text-muted); text-transform:uppercase; margin-bottom:8px">Original Payment Details</div>
            ${(order.payments || [{ method: order.paymentMethod || 'Cash', amount: order.total }]).map(p => `
              <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px">
                <span>${p.method}</span>
                <span class="font-bold">${cur}${p.amount.toFixed(2)}</span>
              </div>
            `).join('')}
          </div>

          <div class="grid-2 mt-16">
            <div class="form-group">
              <label class="form-label">Refund Method</label>
              <select class="form-select" id="refundMethodSelect">
                <option value="Cash" ${refundMethod === 'Cash' ? 'selected' : ''}>Cash</option>
                <option value="UPI" ${refundMethod === 'UPI' ? 'selected' : ''}>UPI</option>
                <option value="Card" ${refundMethod === 'Card' ? 'selected' : ''}>Card</option>
                <option value="Wallet" ${refundMethod === 'Wallet' ? 'selected' : ''}>Wallet</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Reason for Return</label>
              <input type="text" class="form-input" id="returnReason" placeholder="e.g. Damaged" />
            </div>
          </div>

          <div class="mt-20 p-16" style="background:rgba(239,68,68,0.05); border-radius:12px; border:1px solid rgba(239,68,68,0.1)">
            <div style="display:flex; justify-content:space-between; align-items:center">
              <span class="font-bold">Total Refund Amount</span>
              <span class="font-bold text-danger" style="font-size:20px">${cur}${totalReturn.toFixed(2)}</span>
            </div>
          </div>
        </div>
      `;

      openModal({
        title: `Return Items - ${order.id}`,
        body: body,
        footer: `
          <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
          <button class="btn btn-danger" id="confirmReturnBtn">Confirm Return & Refund</button>
        `
      });

      setTimeout(() => {
        document.querySelectorAll('.return-qty-input').forEach(input => {
          input.oninput = (e) => {
            const idx = e.target.dataset.idx;
            const val = parseFloat(e.target.value) || 0;
            const max = parseFloat(e.target.max);
            returnedItems[idx].returnQty = parseFloat(Math.min(val, max).toFixed(3));

            const totalReturn = returnedItems.reduce((sum, item) => sum + (item.returnQty * getRefundPerItem(item)), 0);
            const totalEl = document.querySelector('.text-danger[style*="font-size:20px"]');
            if (totalEl) totalEl.innerText = `${cur}${parseFloat(totalReturn.toFixed(2)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
          };
        });

        document.getElementById('refundMethodSelect').onchange = (e) => {
          refundMethod = e.target.value;
        };

        document.getElementById('confirmReturnBtn').onclick = async () => {
          const itemsToReturn = returnedItems.filter(i => i.returnQty > 0).map(i => ({
            ...i,
            qty: i.returnQty
          }));

          if (itemsToReturn.length === 0) {
            showToast('Please select at least one item to return.', 'warning');
            return;
          }

          // IMPORTANT: compute from the original returnedItems (qty intact), not
          // itemsToReturn (qty already overwritten to returnQty) — getRefundPerItem
          // divides the line's total tax by item.qty to get a per-unit tax share,
          // so passing the already-remapped qty double-counts tax on partial returns
          // (e.g. returning 1 of 2 units would refund the FULL line's tax, not half).
          const totalReturn = parseFloat(returnedItems.filter(i => i.returnQty > 0).reduce((sum, item) => sum + (item.returnQty * getRefundPerItem(item)), 0).toFixed(2));
          const reason = document.getElementById('returnReason').value || 'Not specified';

          const res = await db.saveReturn({
            orderId: order.id,
            type: 'sales',
            items: itemsToReturn,
            total: totalReturn,
            reason: reason,
            branchId: order.branchId,
            customer: order.customer,
            registerId: await db.getCurrentRegisterId(),
            refundMethod: refundMethod
          });
          closeModal();

          // Show a post-return confirmation with Print option
          openModal({
            title: 'Return Processed',
            body: `
              <div style="text-align:center; padding:20px">
                <i class="fa-solid fa-circle-check" style="font-size:48px; color:var(--success); margin-bottom:16px"></i>
                <h3>Return Successful</h3>
                <p>The return for <b>${order.id}</b> has been recorded.</p>
                <div style="background:var(--bg-elevated); padding:12px; border-radius:8px; margin-top:16px; font-weight:bold; color:var(--danger)">
                  Total Refund: ${cur}${totalReturn.toFixed(2)} (${refundMethod})
                </div>
              </div>
            `,
            footer: `
              <button class="btn btn-ghost" onclick="closeModal()">Close</button>
              <button class="btn btn-danger" id="printRefundNowBtn"><i class="fa-solid fa-print"></i> Print Refund Receipt</button>
            `
          });

          document.getElementById('printRefundNowBtn').onclick = async () => {
            const cs = await import('../services/CheckoutService.js');
            const sets = await db.getSettings();
            cs.showRefundReceipt(res, sets, cur);
          };

          await renderOrderList(cur);
        };
      }, 0);
    }

    updateModal();
}

async function payOrder(order, cur) {
  const settings = await getSettings();
  const balance = order.total - (order.redeemedPoints || 0) - (order.creditUsed || 0) - (order.payments || []).reduce((s, p) => s + p.amount, 0);
  
  let selectedMethod = 'Cash';

  function renderContent() {
    return `
      <div style="padding:16px">
        <div class="mb-16" style="background:var(--bg-elevated); padding:16px; border-radius:12px; border:1px solid var(--border)">
          <div style="font-size:11px; text-transform:uppercase; font-weight:800; color:var(--text-muted); margin-bottom:8px">Outstanding Balance</div>
          <div style="font-size:32px; font-weight:900; color:var(--danger)">${cur}${balance.toFixed(2)}</div>
        </div>

        <div class="form-group">
          <label class="form-label">Payment Method</label>
          <div style="display:flex; flex-wrap:wrap; gap:8px;">
            ${(settings.paymentMethods || ['Cash', 'Card', 'UPI']).map(m => `
              <button class="method-pill ${selectedMethod === m ? 'active' : ''}" data-method="${m}" 
                style="padding:10px 20px; border-radius:24px; font-weight:700; font-size:14px; border:2px solid ${selectedMethod === m ? 'var(--accent)' : 'var(--border)'}; background:${selectedMethod === m ? 'var(--accent)' : 'transparent'}; color:${selectedMethod === m ? '#fff' : 'var(--text-muted)'}; cursor:pointer; transition:0.2s">
                ${m}
              </button>
            `).join('')}
          </div>
        </div>

        <div class="mt-20" style="font-size:12px; color:var(--text-muted); background:rgba(0,0,0,0.05); padding:12px; border-radius:8px">
          <i class="fa-solid fa-circle-info mr-4"></i> This will settle the debt for order <b>${order.id}</b> and update <b>${order.customer?.name}</b>'s credit balance.
        </div>
      </div>
    `;
  }

  openModal({
    title: `Settle Payment - ${order.id}`,
    body: renderContent(),
    footer: `
      <button class="btn btn-ghost" id="cancelPayBtn">Cancel</button>
      <button class="btn btn-success" id="confirmSettleBtn">Confirm Payment</button>
    `
  });

  setTimeout(() => {
    const attach = () => {
        document.querySelectorAll('.method-pill').forEach(btn => {
            btn.onclick = () => {
                selectedMethod = btn.dataset.method;
                const modalBody = document.querySelector('.modal-body');
                if (modalBody) modalBody.innerHTML = renderContent();
                setTimeout(attach, 0);
            };
        });
        const cBtn = document.getElementById('confirmSettleBtn');
        if (cBtn) cBtn.onclick = process;
        const cancelBtn = document.getElementById('cancelPayBtn');
        if (cancelBtn) cancelBtn.onclick = closeModal;
    };

    const process = async () => {
      const btn = document.getElementById('confirmSettleBtn');
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';

      try {
        await settleOrderPayment(order.id, selectedMethod, balance);
        closeModal();
        showToast('Payment settled successfully!', 'success');
        await renderOrderList(cur);
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
        btn.disabled = false;
        btn.innerText = 'Confirm Payment';
      }
    };

    attach();
  }, 0);
}

