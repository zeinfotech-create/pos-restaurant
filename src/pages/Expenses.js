// ============================================================
// Expenses — operating costs (Rent, Salary, Electricity, etc) that never
// touch stock, unlike Purchases. A single-step record: an expense is fully
// "done" the moment it's saved — no order->received workflow.
//
// All the actual CRUD/branch/date logic lives in db.js — this file is UI only.
// ============================================================

import { getExpenses, saveExpense, deleteExpense, getCurrentBranch, getCurrentUser, hasPermission, getSettings } from '../db.js';
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

export async function renderExpenses(container, subPage) {
  const branch = await getCurrentBranch();
  const branchId = branch?.id;
  const canManage = await hasPermission('inventory:manage');
  const cur = store.settings?.currency || '₹';

  if (subPage === 'add' && canManage) {
    await openExpenseForm(container);
  }

  let searchQ = '';
  let categoryFilt = 'all';

  async function renderRows() {
    const rawExpenses = await getExpenses(branchId);
    let filtered = await applySessionFilter(rawExpenses, 'date');

    if (searchQ) {
      const q = searchQ.toLowerCase();
      filtered = filtered.filter(x =>
        (x.id || '').toLowerCase().includes(q) ||
        (x.category || '').toLowerCase().includes(q) ||
        (x.description || '').toLowerCase().includes(q) ||
        (x.paidTo || '').toLowerCase().includes(q)
      );
    }
    if (categoryFilt !== 'all') filtered = filtered.filter(x => x.category === categoryFilt);

    if (filterStartDate && filterEndDate) {
      filtered = filtered.filter(x => {
        const d = (x.date || '').split('T')[0];
        return d >= filterStartDate && d <= filterEndDate;
      });
    }

    filtered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const totalAmount = filtered.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const summaryEl = document.getElementById('expTotalSummary');
    if (summaryEl) summaryEl.textContent = `${cur}${totalAmount.toFixed(2)}`;
    const countEl = document.getElementById('expCountSummary');
    if (countEl) countEl.textContent = filtered.length;

    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * itemsPerPage;
    const paginated = filtered.slice(start, start + itemsPerPage);

    const tbody = container.querySelector('tbody');
    if (!tbody) return;

    tbody.innerHTML = paginated.length === 0 ? `<tr><td colspan="7" style="text-align:center;padding:40px;opacity:0.5">No matching expenses found</td></tr>` :
      paginated.map(x => `
        <tr data-id="${x.id}">
          <td data-label="Date">${x.date ? new Date(x.date).toLocaleDateString() : 'N/A'}</td>
          <td data-label="Category"><span class="badge badge-info">${escapeHtml(x.category || 'Uncategorized')}</span></td>
          <td data-label="Description">${escapeHtml(x.description || '—')}</td>
          <td data-label="Paid To">${escapeHtml(x.paidTo || '—')}</td>
          <td data-label="Payment Method">${escapeHtml(x.paymentMethod || '—')}</td>
          <td data-label="Amount" style="text-align:right; font-weight:800">${cur}${(Number(x.amount) || 0).toFixed(2)}</td>
          <td>
            <div style="display:flex;gap:4px">
              ${canManage ? `<button class="btn btn-ghost btn-sm edit-btn" data-id="${x.id}"><i class="fa-solid fa-pen"></i></button>` : ''}
              ${canManage ? `<button class="btn btn-ghost btn-sm delete-btn" data-id="${x.id}" style="color:var(--danger)"><i class="fa-solid fa-trash"></i></button>` : ''}
              ${!canManage ? `<button class="btn btn-ghost btn-sm view-btn" data-id="${x.id}"><i class="fa-solid fa-eye"></i></button>` : ''}
            </div>
          </td>
        </tr>
      `).join('');

    const pagArea = document.getElementById('paginationAreaExpenses');
    if (pagArea) {
      let html = `<div class="pagination-bar"><span>Showing page <b>${currentPage}</b> of <b>${totalPages}</b></span><div class="pagination-controls">
        <button class="pagination-btn" id="prevPageExp" ${currentPage === 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button>`;
      for (let i = 1; i <= totalPages; i++) {
        if (totalPages > 5 && Math.abs(i - currentPage) > 2 && i !== 1 && i !== totalPages) {
          if (i === 2 || i === totalPages - 1) html += `<span style="padding:0 4px">...</span>`;
          continue;
        }
        html += `<button class="pagination-btn ${i === currentPage ? 'active' : ''} exp-page-btn" data-page="${i}">${i}</button>`;
      }
      html += `<button class="pagination-btn" id="nextPageExp" ${currentPage === totalPages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button></div></div>`;
      pagArea.innerHTML = html;
      document.getElementById('prevPageExp').onclick = async () => { if (currentPage > 1) { currentPage--; await renderRows(); } };
      document.getElementById('nextPageExp').onclick = async () => { if (currentPage < totalPages) { currentPage++; await renderRows(); } };
      pagArea.querySelectorAll('.exp-page-btn').forEach(btn => { btn.onclick = async () => { currentPage = parseInt(btn.dataset.page); await renderRows(); }; });
    }

    tbody.querySelectorAll('.edit-btn').forEach(btn => {
      btn.onclick = async () => {
        const x = filtered.find(e => e.id === btn.dataset.id);
        await openExpenseForm(container, x, renderRows);
      };
    });
    tbody.querySelectorAll('.view-btn').forEach(btn => {
      btn.onclick = async () => {
        const x = filtered.find(e => e.id === btn.dataset.id);
        await openExpenseForm(container, x, renderRows, true);
      };
    });
    tbody.querySelectorAll('.delete-btn').forEach(btn => {
      btn.onclick = async () => {
        const x = filtered.find(e => e.id === btn.dataset.id);
        await confirmDeleteExpense(x, renderRows);
      };
    });
  }

  const settings = await getSettings();
  const categories = settings.expenseCategories?.length ? settings.expenseCategories : ['Rent', 'Salary', 'Electricity', 'Miscellaneous'];

  container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Expenses</h1>
          <p class="page-subtitle">Track Rent, Salary, Electricity and other operating costs — separate from stock Purchases</p>
        </div>
        <div class="flex gap-8">
          <button class="btn btn-ghost hide-desktop" id="mobileFilterToggleExp" style="border:1px solid var(--border)">
            <i class="fa-solid fa-filter mr-8"></i> Filters
          </button>
          ${canManage ? `
            <button class="btn btn-primary" id="addExpBtn"><i class="fa-solid fa-circle-plus"></i> Add Expense</button>
          ` : ''}
        </div>
      </div>

      <div class="stat-cards-grid mb-16" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:16px">
        <div class="card" style="padding:16px">
          <div style="font-size:11px; text-transform:uppercase; font-weight:700; color:var(--text-muted)">Total Expenses (filtered)</div>
          <div id="expTotalSummary" style="font-size:24px; font-weight:800; color:var(--danger); margin-top:4px">${cur}0.00</div>
        </div>
        <div class="card" style="padding:16px">
          <div style="font-size:11px; text-transform:uppercase; font-weight:700; color:var(--text-muted)">Entries</div>
          <div id="expCountSummary" style="font-size:24px; font-weight:800; margin-top:4px">0</div>
        </div>
      </div>

    <div class="mb-16" id="filterCardExp" style="transition: all 0.3s ease-in-out; overflow:hidden">
      <div class="data-mgmt-bar mobile-filter-stack p-16">
        <div class="search-input-wrap">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input class="form-input" id="expSearch" placeholder="Search by category, description, paid to..." />
        </div>

        <div class="filter-group">
          <label class="filter-label">Date Range</label>
          <div class="date-picker-group">
            <i class="fa-solid fa-calendar-day"></i>
            <input type="text" id="exp-date-range" class="form-input-clean" style="width:100%" readonly />
          </div>
        </div>

        <div class="filter-group">
          <label class="filter-label">Category</label>
          <select class="form-select" id="expCategoryFilter">
            <option value="all">All Categories</option>
            ${categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
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
              <th>Category</th>
              <th>Description</th>
              <th>Paid To</th>
              <th>Payment Method</th>
              <th style="text-align:right">Amount</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
    <div id="paginationAreaExpenses"></div>
  `;

  await renderRows();

  document.getElementById('expSearch').oninput = async (e) => { searchQ = e.target.value; currentPage = 1; await renderRows(); };
  document.getElementById('expCategoryFilter').onchange = async (e) => { categoryFilt = e.target.value; currentPage = 1; await renderRows(); };

  initDateRangePicker('exp-date-range', filterStartDate, filterEndDate, async (start, end) => {
    filterStartDate = start;
    filterEndDate = end;
    currentPage = 1;
    await renderRows();
  });

  const filterCard = document.getElementById('filterCardExp');
  const toggleBtn = document.getElementById('mobileFilterToggleExp');
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

  if (document.getElementById('addExpBtn')) {
    document.getElementById('addExpBtn').onclick = async () => await openExpenseForm(container, null, renderRows);
  }
}

// ─── Add/Edit form ───────────────────────────────────────────────────────
async function openExpenseForm(container, existing = null, onSuccess = null, readOnly = false) {
  const cur = store.settings?.currency || '₹';
  const settings = await getSettings();
  let categories = settings.expenseCategories?.length ? [...settings.expenseCategories] : ['Rent', 'Salary', 'Electricity', 'Miscellaneous'];
  const payMethods = settings.paymentMethods?.length ? settings.paymentMethods : ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Cheque'];

  let attachment = existing?.receiptAttachment || '';
  const isEdit = !!existing;
  const todayLocal = new Date().toISOString().split('T')[0];

  function renderCategoryOptions() {
    const sel = document.getElementById('expCategory');
    if (!sel) return;
    const currentVal = existing?.category || categories[0] || '';
    sel.innerHTML = categories.map(c => `<option value="${escapeHtml(c)}" ${c === currentVal ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
  }

  openModal({
    title: `<i class="fa-solid fa-receipt mr-8"></i> ${readOnly ? 'Expense Details' : (isEdit ? 'Edit Expense' : 'Add Expense')}`,
    body: `
      <div class="form-grid">
        <div class="form-group">
          <label class="form-label">Category</label>
          <div style="display:flex; gap:8px">
            <select class="form-select" id="expCategory" ${readOnly ? 'disabled' : ''} style="flex:1"></select>
            ${!readOnly ? `<button type="button" class="btn btn-secondary btn-sm" id="expNewCategoryBtn" title="Add a new category"><i class="fa-solid fa-plus"></i></button>` : ''}
          </div>
          ${!readOnly ? `
          <div id="expNewCategoryRow" style="display:none; gap:8px; margin-top:8px">
            <input class="form-input" id="expNewCategoryInput" placeholder="New category name" style="flex:1" />
            <button type="button" class="btn btn-primary btn-sm" id="expNewCategoryConfirmBtn"><i class="fa-solid fa-check"></i></button>
            <button type="button" class="btn btn-ghost btn-sm" id="expNewCategoryCancelBtn"><i class="fa-solid fa-xmark"></i></button>
          </div>
          ` : ''}
        </div>
        <div class="form-group">
          <label class="form-label">Date</label>
          <input type="date" class="form-input" id="expDate" value="${existing?.date ? existing.date.split('T')[0] : todayLocal}" ${readOnly ? 'disabled' : ''} />
        </div>
        <div class="form-group">
          <label class="form-label">Amount (${cur})</label>
          <input type="number" class="form-input" id="expAmount" min="0" step="0.01" placeholder="0.00" value="${existing?.amount ?? ''}" ${readOnly ? 'disabled' : ''} />
        </div>
        <div class="form-group">
          <label class="form-label">Payment Method</label>
          <select class="form-select" id="expPaymentMethod" ${readOnly ? 'disabled' : ''}>
            ${payMethods.map(m => `<option value="${escapeHtml(m)}" ${m === existing?.paymentMethod ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="grid-column: 1 / -1">
          <label class="form-label">Description</label>
          <input class="form-input" id="expDescription" placeholder="e.g. August shop rent" value="${escapeHtml(existing?.description || '')}" ${readOnly ? 'disabled' : ''} />
        </div>
        <div class="form-group">
          <label class="form-label">Paid To (optional)</label>
          <input class="form-input" id="expPaidTo" placeholder="e.g. Landlord, DTH Electricity Board" value="${escapeHtml(existing?.paidTo || '')}" ${readOnly ? 'disabled' : ''} />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Notes (optional)</label>
        <textarea class="form-input" id="expNotes" rows="2" ${readOnly ? 'disabled' : ''}>${escapeHtml(existing?.notes || '')}</textarea>
      </div>
      ${!readOnly ? `
      <div class="form-group">
        <label class="form-label">Receipt / Bill (optional)</label>
        <input type="file" class="form-input" id="expReceiptFile" accept="image/*,application/pdf" />
        <div id="expReceiptPreview" style="margin-top:8px; font-size:12px; color:var(--text-muted)">${attachment ? '<i class="fa-solid fa-paperclip mr-4"></i> Receipt attached' : ''}</div>
      </div>
      ` : (attachment ? `
      <div class="form-group">
        <button type="button" class="btn btn-ghost btn-sm" id="expViewReceiptBtn"><i class="fa-solid fa-paperclip mr-4"></i> View Attached Receipt</button>
      </div>
      ` : '')}
    `,
    footer: readOnly ? `
      <button class="btn btn-ghost" onclick="closeModal()">Close</button>
    ` : `
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="saveExpBtn" style="min-width:160px">
        <i class="fa-solid fa-floppy-disk mr-8"></i> ${isEdit ? 'Save Changes' : 'Save Expense'}
      </button>
    `
  });

  renderCategoryOptions();

  const viewReceiptBtn = document.getElementById('expViewReceiptBtn');
  if (viewReceiptBtn) viewReceiptBtn.onclick = () => window.open(attachment, '_blank');

  // Inline "new category" reveal instead of a native prompt() — Electron's
  // renderer doesn't support window.prompt(), and a nested openModal() would
  // wipe out this modal's in-progress fields (the overlay is a singleton).
  const newCatBtn = document.getElementById('expNewCategoryBtn');
  const newCatRow = document.getElementById('expNewCategoryRow');
  const newCatInput = document.getElementById('expNewCategoryInput');
  if (newCatBtn && newCatRow) {
    newCatBtn.onclick = () => {
      newCatRow.style.display = 'flex';
      newCatInput.value = '';
      newCatInput.focus();
    };
  }
  const newCatCancelBtn = document.getElementById('expNewCategoryCancelBtn');
  if (newCatCancelBtn) {
    newCatCancelBtn.onclick = () => { newCatRow.style.display = 'none'; };
  }
  const confirmNewCategory = async () => {
    const val = newCatInput.value.trim();
    if (!val) return;
    if (categories.some(c => c.toLowerCase() === val.toLowerCase())) {
      showToast('Category already exists', 'info');
      return;
    }
    categories.push(val);
    renderCategoryOptions();
    document.getElementById('expCategory').value = val;
    newCatRow.style.display = 'none';
    // Persist the new category to Settings too, so it's there next time
    // without needing a trip through Settings > General.
    try {
      const { saveSettings } = await import('../db.js');
      await saveSettings({ ...settings, expenseCategories: categories });
    } catch (e) { /* non-fatal — the category still works for this save */ }
  };
  const newCatConfirmBtn = document.getElementById('expNewCategoryConfirmBtn');
  if (newCatConfirmBtn) newCatConfirmBtn.onclick = confirmNewCategory;
  if (newCatInput) newCatInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmNewCategory(); } };

  const receiptFile = document.getElementById('expReceiptFile');
  if (receiptFile) {
    receiptFile.onchange = async (e) => {
      try {
        const { MediaService } = await import('../services/MediaService.js');
        attachment = await MediaService.handleBillUpload(e);
        document.getElementById('expReceiptPreview').innerHTML = '<i class="fa-solid fa-paperclip mr-4"></i> Receipt attached';
      } catch (err) {
        showToast(err.message, 'error');
      }
    };
  }

  const saveBtn = document.getElementById('saveExpBtn');
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const category = document.getElementById('expCategory').value;
      const dateVal = document.getElementById('expDate').value;
      const amount = parseFloat(document.getElementById('expAmount').value);
      const paymentMethod = document.getElementById('expPaymentMethod').value;
      const description = document.getElementById('expDescription').value.trim();
      const paidTo = document.getElementById('expPaidTo').value.trim();
      const notes = document.getElementById('expNotes').value.trim();

      if (!category) { showToast('Select a category', 'warning'); return; }
      if (!dateVal) { showToast('Select a date', 'warning'); return; }
      if (isNaN(amount) || amount <= 0) { showToast('Enter a valid amount greater than 0', 'warning'); return; }

      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
      try {
        const currentUser = await getCurrentUser();
        await saveExpense({
          id: existing?.id,
          category,
          date: new Date(dateVal + 'T12:00:00').toISOString(),
          amount,
          paymentMethod,
          description,
          paidTo,
          notes,
          receiptAttachment: attachment,
          branchId: existing?.branchId,
          recordedBy: existing?.recordedBy || currentUser?.name || currentUser?.username || 'Admin',
        });
        showToast(isEdit ? 'Expense updated' : 'Expense saved', 'success');
        closeModal();
        if (onSuccess) await onSuccess();
      } catch (err) {
        showToast(err.message || 'Failed to save expense', 'error');
        saveBtn.disabled = false;
        saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk mr-8"></i> ${isEdit ? 'Save Changes' : 'Save Expense'}`;
      }
    };
  }
}

// ─── Delete confirmation ───────────────────────────────────────────────────
async function confirmDeleteExpense(x, onSuccess) {
  const cur = store.settings?.currency || '₹';
  openModal({
    title: 'Delete Expense',
    body: `
      <div style="text-align:center; padding:20px 0;">
        <i class="fa-solid fa-trash" style="font-size:48px; margin-bottom:24px; color:var(--danger)"></i>
        <h3 style="margin-bottom:8px">Delete this expense?</h3>
        <p style="color:var(--text-muted); font-size:14px; margin-bottom:24px">
          <b>${escapeHtml(x.category || 'Expense')}</b> — ${cur}${(Number(x.amount) || 0).toFixed(2)} on ${x.date ? new Date(x.date).toLocaleDateString() : 'N/A'}. This cannot be undone.
        </p>
        <div style="display:flex; gap:16px; justify-content:center;">
          <button class="btn btn-ghost" onclick="closeModal()" style="flex:1">Cancel</button>
          <button class="btn btn-danger" id="confirmDeleteExpBtn" style="flex:1">
            <i class="fa-solid fa-trash mr-4"></i> Yes, Delete
          </button>
        </div>
      </div>
    `,
    footer: ''
  });

  const confirmBtn = document.getElementById('confirmDeleteExpBtn');
  confirmBtn.onclick = async () => {
    if (confirmBtn.disabled) return;
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deleting...';
    try {
      await deleteExpense(x.id);
      showToast('Expense deleted', 'success');
      closeModal();
      if (onSuccess) await onSuccess();
    } catch (err) {
      showToast(err.message || 'Failed to delete expense', 'error');
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = '<i class="fa-solid fa-trash mr-4"></i> Yes, Delete';
    }
  };
}
