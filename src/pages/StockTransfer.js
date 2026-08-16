// ============================================================
// Stock Transfer — Multi-Branch inventory movement
// ============================================================
// Two-step workflow (same shape as Purchases' Order->Received flow):
//   1. Create a transfer from the CURRENT branch to another branch — goods
//      leave the source branch's stock immediately (saveStockTransfer()),
//      status starts 'Pending'.
//   2. The destination branch "Receives" it once the goods physically
//      arrive (completeStockTransfer()) — only then does the destination's
//      stock get credited. Status becomes 'Completed'.
// A transfer still 'Pending' can be "Cancelled" from the source branch,
// which restores its stock (cancelStockTransfer()).
//
// All the actual stock/audit-log logic lives in db.js — this file is UI only.

import { getBranches, getCurrentBranch, getCurrentUser, getProducts, hasPermission, getStockTransfers, saveStockTransfer, completeStockTransfer, cancelStockTransfer } from '../db.js';
import { store } from '../store.js';
import { openModal, closeModal } from '../components/Modal.js';
import { showToast } from '../components/Toast.js';
import { initDateRangePicker, getDefaultRange } from '../utils/dateRangeHelper.js';
import { applySessionFilter } from '../utils/sessionFilter.js';
import { escapeHtml } from '../utils/escapeHtml.js';

let currentPage = 1;
const itemsPerPage = 10;
const { start: defaultStart, end: defaultEnd } = getDefaultRange();
let filterStartDate = defaultStart;
let filterEndDate = defaultEnd;

export async function renderStockTransfer(container, subPage) {
  const branch = await getCurrentBranch();
  const branchId = branch?.id;
  const canManage = await hasPermission('inventory:manage');

  if (subPage === 'add' && canManage) {
    await openTransferForm(container);
  }

  const allBranches = await getBranches();
  let searchQ = '';
  let statusFilt = 'all';
  // 'all' | 'out' (dispatched FROM this branch) | 'in' (incoming TO this branch)
  let directionFilt = 'all';

  function branchName(id) {
    if (id === branchId) return branch?.name || 'This Branch';
    const b = allBranches.find(x => String(x.id) === String(id));
    return b ? b.name : (id === 'b1' ? 'Main Branch' : `Branch ${id}`);
  }

  async function renderRows() {
    const rawTransfers = await getStockTransfers(branchId);
    let filtered = await applySessionFilter(rawTransfers, 'date');

    if (searchQ) {
      const q = searchQ.toLowerCase();
      filtered = filtered.filter(t =>
        (t.id || '').toLowerCase().includes(q) ||
        branchName(t.fromBranchId).toLowerCase().includes(q) ||
        branchName(t.toBranchId).toLowerCase().includes(q) ||
        (t.items || []).some(i => (i.name || '').toLowerCase().includes(q))
      );
    }
    if (statusFilt !== 'all') filtered = filtered.filter(t => t.status === statusFilt);
    if (directionFilt === 'out') filtered = filtered.filter(t => t.fromBranchId === branchId);
    if (directionFilt === 'in') filtered = filtered.filter(t => t.toBranchId === branchId);

    if (filterStartDate && filterEndDate) {
      filtered = filtered.filter(t => {
        const d = (t.date || '').split('T')[0];
        return d >= filterStartDate && d <= filterEndDate;
      });
    }

    filtered.sort((a, b) => {
      const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : new Date(a.date).getTime();
      const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : new Date(b.date).getTime();
      return timeB - timeA;
    });

    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * itemsPerPage;
    const paginated = filtered.slice(start, start + itemsPerPage);

    const tbody = container.querySelector('tbody');
    if (!tbody) return;

    tbody.innerHTML = paginated.length === 0 ? `<tr><td colspan="7" style="text-align:center;padding:40px;opacity:0.5">No matching stock transfers found</td></tr>` :
      paginated.map(t => {
        const itemCount = (t.items || []).length;
        const totalQty = (t.items || []).reduce((s, i) => s + (parseFloat(i.qty) || 0), 0);
        const isIncoming = t.toBranchId === branchId;
        const isOutgoing = t.fromBranchId === branchId;
        const statusBadge = t.status === 'Pending' ? 'badge-info' : (t.status === 'Completed' ? 'badge-success' : 'badge-danger');
        return `
        <tr data-id="${t.id}">
          <td data-label="Date">${t.date ? new Date(t.date).toLocaleDateString() : 'N/A'}</td>
          <td data-label="Transfer ID" class="font-mono text-sm">${escapeHtml(t.id || 'N/A')}</td>
          <td data-label="Route">
            <div style="display:flex; align-items:center; gap:6px; font-weight:600">
              <span style="${isOutgoing ? 'color:var(--text-main)' : 'color:var(--text-muted)'}">${escapeHtml(branchName(t.fromBranchId))}</span>
              <i class="fa-solid fa-arrow-right" style="font-size:11px; opacity:0.5"></i>
              <span style="${isIncoming ? 'color:var(--text-main)' : 'color:var(--text-muted)'}">${escapeHtml(branchName(t.toBranchId))}</span>
            </div>
          </td>
          <td data-label="Items">${itemCount} product${itemCount === 1 ? '' : 's'} &middot; ${totalQty} qty</td>
          <td data-label="Created By">${escapeHtml(t.createdBy || 'Unknown')}</td>
          <td data-label="Status"><span class="badge ${statusBadge}">${escapeHtml(t.status)}</span></td>
          <td>
            <div style="display:flex;gap:4px">
              ${t.status === 'Pending' && isIncoming && canManage ? `
                <button class="btn btn-sm receive-btn" data-id="${t.id}" style="background:var(--success);border-color:var(--success);color:#fff"><i class="fa-solid fa-box-open"></i> Receive</button>
              ` : ''}
              <button class="btn btn-ghost btn-sm view-btn" data-id="${t.id}"><i class="fa-solid fa-eye"></i> View</button>
            </div>
          </td>
        </tr>
      `;
      }).join('');

    const pagArea = document.getElementById('paginationAreaStockTransfer');
    if (pagArea) {
      let html = `<div class="pagination-bar"><span>Showing page <b>${currentPage}</b> of <b>${totalPages}</b></span><div class="pagination-controls">
        <button class="pagination-btn" id="prevPageTrf" ${currentPage === 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button>`;
      for (let i = 1; i <= totalPages; i++) {
        if (totalPages > 5 && Math.abs(i - currentPage) > 2 && i !== 1 && i !== totalPages) {
          if (i === 2 || i === totalPages - 1) html += `<span style="padding:0 4px">...</span>`;
          continue;
        }
        html += `<button class="pagination-btn ${i === currentPage ? 'active' : ''} trf-page-btn" data-page="${i}">${i}</button>`;
      }
      html += `<button class="pagination-btn" id="nextPageTrf" ${currentPage === totalPages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button></div></div>`;
      pagArea.innerHTML = html;
      document.getElementById('prevPageTrf').onclick = async () => { if (currentPage > 1) { currentPage--; await renderRows(); } };
      document.getElementById('nextPageTrf').onclick = async () => { if (currentPage < totalPages) { currentPage++; await renderRows(); } };
      pagArea.querySelectorAll('.trf-page-btn').forEach(btn => { btn.onclick = async () => { currentPage = parseInt(btn.dataset.page); await renderRows(); }; });
    }

    tbody.querySelectorAll('.view-btn').forEach(btn => {
      btn.onclick = async () => {
        const t = filtered.find(x => x.id === btn.dataset.id);
        await viewTransferDetails(t, branchId, branchName, canManage, renderRows);
      };
    });

    tbody.querySelectorAll('.receive-btn').forEach(btn => {
      btn.onclick = async () => {
        const t = filtered.find(x => x.id === btn.dataset.id);
        await confirmReceiveTransfer(t, branchName, renderRows);
      };
    });
  }

  container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Stock Transfer</h1>
          <p class="page-subtitle">Move stock between branches — dispatch, then receive, with a full audit trail</p>
        </div>
        <div class="flex gap-8">
          <button class="btn btn-ghost hide-desktop" id="mobileFilterToggleTrf" style="border:1px solid var(--border)">
            <i class="fa-solid fa-filter mr-8"></i> Filters
          </button>
          ${canManage ? `
            <button class="btn btn-primary" id="addTrfBtn"><i class="fa-solid fa-truck-fast"></i> New Transfer</button>
          ` : ''}
        </div>
      </div>

    <div class="mb-16" id="filterCardTrf" style="transition: all 0.3s ease-in-out; overflow:hidden">
      <div class="data-mgmt-bar mobile-filter-stack p-16">
        <div class="search-input-wrap">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input class="form-input" id="trfSearch" placeholder="Search by ID, branch, or product..." />
        </div>

        <div class="filter-group">
          <label class="filter-label">Transfer Range</label>
          <div class="date-picker-group">
            <i class="fa-solid fa-calendar-day"></i>
            <input type="text" id="trf-date-range" class="form-input-clean" style="width:100%" readonly />
          </div>
        </div>

        <div class="filter-group">
          <label class="filter-label">Direction</label>
          <select class="form-select" id="trfDirectionFilter">
            <option value="all">All</option>
            <option value="out">Outgoing (from this branch)</option>
            <option value="in">Incoming (to this branch)</option>
          </select>
        </div>

        <div class="filter-group">
          <label class="filter-label">Status</label>
          <select class="form-select" id="trfStatusFilter">
            <option value="all">All Statuses</option>
            <option value="Pending">Pending</option>
            <option value="Completed">Completed</option>
            <option value="Cancelled">Cancelled</option>
          </select>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="table-wrap">
        <table class="responsive-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Transfer ID</th>
              <th>Route</th>
              <th>Items</th>
              <th>Created By</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
    <div id="paginationAreaStockTransfer"></div>
  `;

  await renderRows();

  document.getElementById('trfSearch').oninput = async (e) => { searchQ = e.target.value; currentPage = 1; await renderRows(); };
  document.getElementById('trfDirectionFilter').onchange = async (e) => { directionFilt = e.target.value; currentPage = 1; await renderRows(); };
  document.getElementById('trfStatusFilter').onchange = async (e) => { statusFilt = e.target.value; currentPage = 1; await renderRows(); };

  initDateRangePicker('trf-date-range', filterStartDate, filterEndDate, async (start, end) => {
    filterStartDate = start;
    filterEndDate = end;
    currentPage = 1;
    await renderRows();
  });

  const filterCard = document.getElementById('filterCardTrf');
  const toggleBtn = document.getElementById('mobileFilterToggleTrf');
  if (toggleBtn && filterCard) {
    let isExpanded = false;
    if (window.innerWidth <= 900) {
      filterCard.style.maxHeight = '0px';
      filterCard.style.padding = '0px';
      filterCard.style.margin = '0px';
      filterCard.style.opacity = '0';
    }
    toggleBtn.onclick = () => {
      isExpanded = !isExpanded;
      if (isExpanded) {
        filterCard.style.maxHeight = '600px';
        filterCard.style.padding = '0px';
        filterCard.style.margin = '0 0 16px 0';
        filterCard.style.opacity = '1';
        toggleBtn.innerHTML = '<i class="fa-solid fa-times mr-8"></i> Hide Filters';
      } else {
        filterCard.style.maxHeight = '0px';
        filterCard.style.padding = '0px';
        filterCard.style.margin = '0px';
        filterCard.style.opacity = '0';
        toggleBtn.innerHTML = '<i class="fa-solid fa-filter mr-8"></i> Filters';
      }
    };
  }

  if (document.getElementById('addTrfBtn')) {
    document.getElementById('addTrfBtn').onclick = async () => await openTransferForm(container);
  }
}

// ─── Create Transfer ─────────────────────────────────────────────────────
async function openTransferForm(container) {
  const branch = await getCurrentBranch();
  if (!branch) { showToast('No active branch — cannot create a transfer', 'error'); return; }

  const allBranches = (await getBranches()).filter(b => String(b.id) !== String(branch.id));
  if (allBranches.length === 0) { showToast('Add another branch first — there is nowhere to transfer stock to', 'warning'); return; }

  const sourceProducts = (await getProducts(branch.id)).filter(p => (p.stock || 0) > 0 || (p.variants || []).some(v => (v.stock || 0) > 0));
  if (sourceProducts.length === 0) { showToast('No in-stock products at this branch to transfer', 'warning'); return; }

  const cur = store.settings?.currency || '₹';
  let selectedItems = []; // { id, sku, name, variantName, qty, unit, price, maxQty }

  // Live "X will remain at this branch" readout under each row, driven
  // straight off the current qty — updated in-place (not via a full
  // renderItems() re-render, which would blow away the input's cursor
  // position/focus on every keystroke).
  function updateRemaining(idx) {
    const el = document.getElementById(`trf-remain-${idx}`);
    if (!el) return;
    const item = selectedItems[idx];
    const remaining = Math.max(0, parseFloat((item.maxQty - (item.qty || 0)).toFixed(3)));
    el.textContent = `→ ${remaining} ${item.unit || ''} will remain here`;
    el.style.color = remaining <= 0 ? 'var(--danger)' : 'var(--warning)';
  }

  function renderItems() {
    const list = document.getElementById('trfItemsList');
    if (!list) return;
    list.innerHTML = selectedItems.map((item, i) => `
      <div class="variant-row" style="margin-bottom:8px">
        <span style="flex:2">${escapeHtml(item.name)}<div style="font-size:11px; color:var(--text-muted); font-weight:400">Available: ${item.maxQty} ${item.unit || ''} <span id="trf-remain-${i}" style="font-weight:600; margin-left:4px"></span></div></span>
        <input class="form-input" style="flex:1" type="number" min="1" max="${item.maxQty}" placeholder="Qty" data-idx="${i}" value="${item.qty}">
        <button class="btn btn-icon remove-item" data-idx="${i}" style="color:var(--danger)"><i class="fa-solid fa-trash"></i></button>
      </div>
    `).join('') || '<p style="text-align:center;padding:10px;opacity:0.5">No products added</p>';

    const countEl = document.getElementById('trfItemCount');
    if (countEl) countEl.innerText = `${selectedItems.length} products`;

    selectedItems.forEach((_, i) => updateRemaining(i));

    list.querySelectorAll('input').forEach(input => {
      input.oninput = () => {
        const idx = parseInt(input.dataset.idx, 10);
        let qty = parseFloat(input.value) || 0;
        const max = selectedItems[idx].maxQty;
        if (qty > max) {
          qty = max;
          input.value = max;
          showToast(`Only ${max} available — capped`, 'warning');
        }
        selectedItems[idx].qty = qty;
        updateRemaining(idx);
      };
    });

    list.querySelectorAll('.remove-item').forEach(btn => {
      btn.onclick = () => {
        selectedItems.splice(parseInt(btn.dataset.idx, 10), 1);
        renderItems();
      };
    });
  }

  openModal({
    title: `<i class="fa-solid fa-truck-fast mr-8"></i> New Stock Transfer`,
    body: `
      <div style="margin-bottom:20px; padding:16px; background:var(--bg-elevated); border-radius:var(--radius); border:1px solid var(--border); display:flex; align-items:center; gap:16px;">
        <div style="flex:1">
          <label class="filter-label">From (this branch)</label>
          <div style="font-weight:800; font-size:15px; margin-top:4px"><i class="fa-solid fa-warehouse mr-4" style="color:var(--text-muted)"></i> ${escapeHtml(branch.name)}</div>
        </div>
        <i class="fa-solid fa-arrow-right-long" style="font-size:20px; color:var(--primary); opacity:0.6"></i>
        <div style="flex:1">
          <label class="filter-label" for="trfToBranch">To Branch</label>
          <select class="form-select" id="trfToBranch" style="margin-top:4px">
            ${allBranches.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('')}
          </select>
        </div>
      </div>

      <div style="border:1px solid var(--border); padding:16px; border-radius:12px; background:var(--bg-app); margin-bottom:16px">
        <label class="form-label" style="font-weight:800; font-size:11px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em"><i class="fa-solid fa-boxes-stacked mr-4"></i> Add Products to Transfer</label>
        <div style="display:flex; gap:12px; margin-top:8px">
          <div class="search-input-wrap" style="flex:1">
            <i class="fa-solid fa-barcode"></i>
            <select class="form-select" id="trfAddProductSelect" style="padding-left:36px; height:42px">
              ${sourceProducts.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (SKU: ${escapeHtml(p.sku || 'N/A')}) — ${p.stock} ${p.unit || ''} in stock</option>`).join('')}
            </select>
          </div>
          <button class="btn btn-primary" id="trfAddItemBtn" style="height:42px; padding:0 20px"><i class="fa-solid fa-plus mr-4"></i> Add</button>
        </div>

        <div class="variant-row" style="margin-top:12px; margin-bottom:4px; padding:0 4px">
          <span style="flex:2; font-size:11px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em">Product</span>
          <span style="flex:1; font-size:11px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em">Qty to Send</span>
          <span style="width:36px"></span>
        </div>
        <div id="trfItemsList" style="max-height:280px; overflow-y:auto; padding:4px"></div>

        <div class="mt-16" style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-elevated); border-radius:12px; border:1px solid var(--border); padding:14px 18px;">
          <div>
            <div style="font-size:10px; text-transform:uppercase; font-weight:700; color:var(--text-muted)">Products</div>
            <div id="trfItemCount" style="font-size:16px; font-weight:800; color:var(--text-main)">0 products</div>
          </div>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Note (optional)</label>
        <textarea class="form-input" id="trfNote" rows="2" placeholder="e.g. Restocking low inventory at the new branch"></textarea>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="saveTrfBtn" style="min-width:220px">
        <i class="fa-solid fa-paper-plane mr-8"></i> Dispatch Transfer
      </button>
    `
  });

  renderItems();

  document.getElementById('trfAddItemBtn').onclick = () => {
    const pid = document.getElementById('trfAddProductSelect').value;
    const p = sourceProducts.find(x => String(x.id) === String(pid));
    if (!p) { showToast('Product not found', 'error'); return; }

    // Catalog snapshot carried on every item — tax/discount/category/HSN/MRP
    // (plus, for a variant, its own costPrice) travel WITH the transfer
    // record itself rather than being re-read from the live product later.
    // This is what actually makes them "transfer correctly": if the
    // destination branch has never stocked this SKU before, the auto-created
    // product there is built from THIS snapshot — same tax rate, same
    // discount, same category — not left blank, and not silently wrong if
    // the source product gets edited/deleted between dispatch and receive.
    const catalogSnapshot = {
      category: p.category || '', subCategory: p.subCategory || '',
      taxType: p.taxType || 'exclusive', taxRate: p.taxRate ?? 0,
      itemDiscount: p.itemDiscount ?? 0, itemDiscountType: p.itemDiscountType || 'flat',
      hsnCode: p.hsnCode || '', mrp: p.mrp ?? 0, emoji: p.emoji || '', image: p.image || '',
      isReturnable: p.isReturnable !== false, allowNegativeStock: !!p.allowNegativeStock,
    };

    if (p.variants && p.variants.length > 0) {
      const inStockVariants = p.variants.filter(v => (v.stock || 0) > 0);
      const missing = inStockVariants.filter(v => !selectedItems.find(x => String(x.id) === String(pid) && x.variantName === v.name));
      if (missing.length === 0) { showToast('All in-stock variants of this product already added', 'warning'); return; }
      missing.forEach(v => {
        selectedItems.push({ id: p.id, sku: p.sku || '', name: `${p.name} (${v.name})`, productName: p.name, variantName: v.name, qty: Math.min(1, v.stock), unit: p.unit, price: v.price ?? p.price, costPrice: v.costPrice ?? p.costPrice ?? 0, maxQty: v.stock, ...catalogSnapshot });
      });
    } else {
      if (selectedItems.find(x => String(x.id) === String(pid))) { showToast('Product already added', 'warning'); return; }
      selectedItems.push({ id: p.id, sku: p.sku || '', name: p.name, productName: p.name, variantName: null, qty: Math.min(1, p.stock), unit: p.unit, price: p.price, costPrice: p.costPrice ?? 0, maxQty: p.stock, ...catalogSnapshot });
    }
    renderItems();
  };

  document.getElementById('saveTrfBtn').onclick = async () => {
    const toBranchId = document.getElementById('trfToBranch').value;
    const note = document.getElementById('trfNote').value.trim();
    const itemsToSend = selectedItems.filter(i => i.qty > 0);

    if (itemsToSend.length === 0) { showToast('Add at least one product with a quantity greater than 0', 'warning'); return; }
    if (!toBranchId) { showToast('Select a destination branch', 'warning'); return; }

    const saveBtn = document.getElementById('saveTrfBtn');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Dispatching...';
    try {
      const currentUser = await getCurrentUser();
      await saveStockTransfer({
        fromBranchId: branch.id,
        toBranchId,
        items: itemsToSend.map(i => ({
          id: i.id, sku: i.sku, name: i.name, productName: i.productName, variantName: i.variantName, qty: i.qty, unit: i.unit, price: i.price, costPrice: i.costPrice,
          category: i.category, subCategory: i.subCategory, taxType: i.taxType, taxRate: i.taxRate,
          itemDiscount: i.itemDiscount, itemDiscountType: i.itemDiscountType, hsnCode: i.hsnCode, mrp: i.mrp,
          emoji: i.emoji, image: i.image, isReturnable: i.isReturnable, allowNegativeStock: i.allowNegativeStock
        })),
        note,
        createdBy: currentUser?.name || ''
      });
      showToast('Stock transfer dispatched — stock deducted at this branch', 'success');
      closeModal();
      await renderStockTransfer(container);
    } catch (err) {
      showToast(err.message || 'Failed to create transfer', 'error');
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fa-solid fa-paper-plane mr-8"></i> Dispatch Transfer';
    }
  };
}

// ─── Detail modal ─────────────────────────────────────────────────────────
async function viewTransferDetails(t, branchId, branchName, canManage, onSuccess) {
  const cur = store.settings?.currency || '₹';
  const isIncoming = t.toBranchId === branchId;
  const isOutgoing = t.fromBranchId === branchId;
  const statusBadge = t.status === 'Pending' ? 'badge-info' : (t.status === 'Completed' ? 'badge-success' : 'badge-danger');
  const totalValue = (t.items || []).reduce((s, i) => s + ((parseFloat(i.qty) || 0) * (parseFloat(i.price) || 0)), 0);

  openModal({
    title: `<i class="fa-solid fa-truck-fast mr-8"></i> Transfer ${escapeHtml(t.id)}`,
    body: `
      <div style="display:flex; align-items:center; gap:16px; margin-bottom:20px; padding:16px; background:var(--bg-elevated); border-radius:var(--radius); border:1px solid var(--border);">
        <div style="flex:1">
          <div class="filter-label">From</div>
          <div style="font-weight:800; font-size:15px; margin-top:2px">${escapeHtml(branchName(t.fromBranchId))}</div>
        </div>
        <i class="fa-solid fa-arrow-right-long" style="font-size:20px; color:var(--primary); opacity:0.6"></i>
        <div style="flex:1">
          <div class="filter-label">To</div>
          <div style="font-weight:800; font-size:15px; margin-top:2px">${escapeHtml(branchName(t.toBranchId))}</div>
        </div>
        <div>
          <span class="badge ${statusBadge}" style="font-size:12px">${escapeHtml(t.status)}</span>
        </div>
      </div>

      <div class="form-grid" style="margin-bottom:16px">
        <div><div class="filter-label">Created By</div><div style="font-weight:700">${escapeHtml(t.createdBy || 'Unknown')}</div></div>
        <div><div class="filter-label">Dispatched On</div><div style="font-weight:700">${t.date ? new Date(t.date).toLocaleString() : 'N/A'}</div></div>
        ${t.status === 'Completed' ? `<div><div class="filter-label">Received By</div><div style="font-weight:700">${escapeHtml(t.receivedBy || 'Unknown')}</div></div>
        <div><div class="filter-label">Received On</div><div style="font-weight:700">${t.receivedAt ? new Date(t.receivedAt).toLocaleString() : 'N/A'}</div></div>` : ''}
        ${t.status === 'Cancelled' ? `<div><div class="filter-label">Cancelled By</div><div style="font-weight:700">${escapeHtml(t.cancelledBy || 'Unknown')}</div></div>
        <div><div class="filter-label">Cancelled On</div><div style="font-weight:700">${t.cancelledAt ? new Date(t.cancelledAt).toLocaleString() : 'N/A'}</div></div>` : ''}
      </div>

      ${t.note ? `<div style="margin-bottom:16px; padding:10px 14px; background:var(--bg-elevated); border-radius:8px; font-size:13px; color:var(--text-muted)"><i class="fa-solid fa-note-sticky mr-4"></i> ${escapeHtml(t.note)}</div>` : ''}

      <div class="table-wrap">
        <table class="responsive-table">
          <thead><tr><th>Product</th><th style="text-align:right">Qty</th><th style="text-align:right">Value</th></tr></thead>
          <tbody>
            ${(t.items || []).map(i => `
              <tr>
                <td data-label="Product">${escapeHtml(i.name)}</td>
                <td data-label="Qty" style="text-align:right">${i.qty} ${escapeHtml(i.unit || '')}</td>
                <td data-label="Value" style="text-align:right">${cur}${((parseFloat(i.qty) || 0) * (parseFloat(i.price) || 0)).toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div style="text-align:right; margin-top:8px; font-weight:800; font-size:15px">Total Value: ${cur}${totalValue.toFixed(2)}</div>

      ${t.status === 'Pending' && isIncoming ? `
        <div style="margin-top:16px; padding:14px; background:rgba(59,130,246,0.08); border:1px solid rgba(59,130,246,0.25); border-radius:10px; color:var(--info); font-size:13px;">
          <i class="fa-solid fa-truck mr-4"></i> Awaiting receipt — mark it received once these items physically arrive here.
        </div>
      ` : ''}
      ${t.status === 'Pending' && isOutgoing && !isIncoming ? `
        <div style="margin-top:16px; padding:14px; background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.25); border-radius:10px; color:var(--warning); font-size:13px;">
          <i class="fa-solid fa-clock mr-4"></i> Dispatched — waiting for ${escapeHtml(branchName(t.toBranchId))} to confirm receipt.
        </div>
      ` : ''}
      ${t.status === 'Cancelled' && t.cancelReason ? `
        <div style="margin-top:16px; padding:14px; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.25); border-radius:10px; color:var(--danger); font-size:13px;">
          <i class="fa-solid fa-circle-info mr-4"></i> ${escapeHtml(t.cancelReason)}
        </div>
      ` : ''}
    `,
    footer: `
      <button class="btn btn-ghost" onclick="closeModal()">Close</button>
      ${t.status === 'Pending' && isOutgoing && canManage ? `<button class="btn btn-danger" id="cancelTrfBtn"><i class="fa-solid fa-ban mr-4"></i> Cancel Transfer</button>` : ''}
      ${t.status === 'Pending' && isIncoming && canManage ? `<button class="btn btn-primary" id="receiveTrfBtn" style="background:var(--success); border-color:var(--success)"><i class="fa-solid fa-box-open mr-4"></i> Mark as Received</button>` : ''}
    `
  });

  const cancelBtn = document.getElementById('cancelTrfBtn');
  if (cancelBtn) {
    cancelBtn.onclick = async () => {
      closeModal();
      await confirmCancelTransfer(t, branchName, onSuccess);
    };
  }

  const receiveBtn = document.getElementById('receiveTrfBtn');
  if (receiveBtn) {
    receiveBtn.onclick = async () => {
      closeModal();
      await confirmReceiveTransfer(t, branchName, onSuccess);
    };
  }
}

// ─── Receive confirmation ─────────────────────────────────────────────────
async function confirmReceiveTransfer(t, branchName, onSuccess) {
  openModal({
    title: 'Confirm Stock Received',
    body: `
      <div style="text-align:center; padding:20px 0;">
        <i class="fa-solid fa-box-open" style="font-size:48px; margin-bottom:24px; color:var(--success)"></i>
        <h3 style="margin-bottom:8px">Confirm Goods Received</h3>
        <p style="color:var(--text-muted); font-size:14px; margin-bottom:8px">
          Confirm that transfer <b>${escapeHtml(t.id)}</b> from <b>${escapeHtml(branchName(t.fromBranchId))}</b> has physically arrived at <b>${escapeHtml(branchName(t.toBranchId))}</b>.
        </p>
        <p style="color:var(--text-muted); font-size:12px; margin-bottom:32px">
          Stock will be added here immediately — only confirm once the goods are actually in hand.
        </p>
        <div style="display:flex; gap:16px; justify-content:center;">
          <button class="btn btn-ghost" onclick="closeModal()" style="flex:1">Not Yet</button>
          <button class="btn btn-primary" id="confirmReceiveTrfBtn" style="flex:1; background:var(--success); border-color:var(--success)">
            <i class="fa-solid fa-check-double mr-4"></i> Yes, Goods Received
          </button>
        </div>
      </div>
    `,
    footer: ''
  });

  const confirmBtn = document.getElementById('confirmReceiveTrfBtn');
  confirmBtn.onclick = async () => {
    if (confirmBtn.disabled) return;
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Receiving...';
    try {
      const currentUser = await getCurrentUser();
      await completeStockTransfer(t.id, currentUser?.name || '');
      showToast('Transfer received — stock updated!', 'success');
      closeModal();
      if (onSuccess) await onSuccess();
    } catch (err) {
      showToast(err.message || 'Failed to mark as received', 'error');
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = '<i class="fa-solid fa-check-double mr-4"></i> Yes, Goods Received';
    }
  };
}

// ─── Cancel confirmation ───────────────────────────────────────────────────
async function confirmCancelTransfer(t, branchName, onSuccess) {
  openModal({
    title: 'Cancel Stock Transfer',
    body: `
      <div style="text-align:center; padding:20px 0;">
        <i class="fa-solid fa-ban" style="font-size:48px; margin-bottom:24px; color:var(--danger)"></i>
        <h3 style="margin-bottom:8px">Cancel Transfer ${escapeHtml(t.id)}?</h3>
        <p style="color:var(--text-muted); font-size:14px; margin-bottom:24px">
          This restores the dispatched stock back to <b>${escapeHtml(branchName(t.fromBranchId))}</b> immediately. Only do this if the goods never actually left, or the transfer needs to be redirected.
        </p>
        <div class="form-group" style="text-align:left">
          <label class="form-label">Reason (optional)</label>
          <input class="form-input" id="trfCancelReason" placeholder="e.g. Wrong branch selected" />
        </div>
        <div style="display:flex; gap:16px; justify-content:center; margin-top:16px">
          <button class="btn btn-ghost" onclick="closeModal()" style="flex:1">Keep Transfer</button>
          <button class="btn btn-danger" id="confirmCancelTrfBtn" style="flex:1">
            <i class="fa-solid fa-ban mr-4"></i> Yes, Cancel It
          </button>
        </div>
      </div>
    `,
    footer: ''
  });

  const confirmBtn = document.getElementById('confirmCancelTrfBtn');
  confirmBtn.onclick = async () => {
    if (confirmBtn.disabled) return;
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Cancelling...';
    try {
      const currentUser = await getCurrentUser();
      const reason = document.getElementById('trfCancelReason')?.value.trim() || '';
      await cancelStockTransfer(t.id, currentUser?.name || '', reason);
      showToast('Transfer cancelled — stock restored', 'success');
      closeModal();
      if (onSuccess) await onSuccess();
    } catch (err) {
      showToast(err.message || 'Failed to cancel transfer', 'error');
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = '<i class="fa-solid fa-ban mr-4"></i> Yes, Cancel It';
    }
  };
}
