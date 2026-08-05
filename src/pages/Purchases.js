import { getPurchases, getSuppliers, getProducts, savePurchase, updateProduct, getCurrentBranch, getCurrentUser, deletePurchase, hasPermission, logInventoryChange, getPurchaseReturnedTotals, getSettings } from '../db.js';
import { store } from '../store.js';
import { openModal, closeModal } from '../components/Modal.js';
import { showToast } from '../components/Toast.js';
import { initDateRangePicker, getDefaultRange } from '../utils/dateRangeHelper.js';
import { applySessionFilter } from '../utils/sessionFilter.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { printReceiptHtml } from '../services/CheckoutService.js';

let currentPage = 1;
const itemsPerPage = 10;
let selectedIds = new Set();
const { start: defaultStart, end: defaultEnd } = getDefaultRange();
let filterStartDate = defaultStart;
let filterEndDate = defaultEnd;

export async function renderPurchases(container, subPage) {
  const branch = await getCurrentBranch();
  const branchId = branch?.id;

  if (subPage === 'add' && await hasPermission('inventory:manage')) {
    await openPurchaseForm(container);
  }
  const suppliers = await getSuppliers(branchId);
  let searchQ = '';
  let supplierFilt = 'all';

  async function renderRows() {
    const canManageInventory = await hasPermission('inventory:manage');
    let rawPurchases = await getPurchases(branchId);
    let filtered = await applySessionFilter(rawPurchases, 'date');
    if (searchQ) {
      filtered = filtered.filter(p =>
        (p.id || '').toLowerCase().includes(searchQ.toLowerCase()) ||
        (p.supplierName || '').toLowerCase().includes(searchQ.toLowerCase()) ||
        (p.supplierInvoiceNo || '').toLowerCase().includes(searchQ.toLowerCase())
      );
    }
    if (supplierFilt !== 'all') {
      filtered = filtered.filter(p => p.supplierId === supplierFilt);
    }
    
    if (filterStartDate && filterEndDate) {
      filtered = filtered.filter(p => {
        const d = p.date.split('T')[0];
        return d >= filterStartDate && d <= filterEndDate;
      });
    }

    // Sort by updatedAt DESC then date DESC (Newest/Recently edited first)
    filtered.sort((a, b) => {
      const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : new Date(a.date).getTime();
      const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : new Date(b.date).getTime();
      return timeB - timeA;
    });

    // Pagination
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * itemsPerPage;
    const paginatedPurchases = filtered.slice(start, start + itemsPerPage);

    const paginatedIds = paginatedPurchases.map(p => String(p.id));
    const someSelected = paginatedIds.some(id => selectedIds.has(id));
    const allSelected = paginatedIds.length > 0 && paginatedIds.every(id => selectedIds.has(id));

    // Bulk actions bar
    const bulkArea = document.getElementById('bulkActionsPurchases');
    if (bulkArea) {
      if (selectedIds.size === 0) {
        bulkArea.innerHTML = '';
      } else {
        bulkArea.innerHTML = `
          <div class="bulk-actions-bar">
            <div class="bulk-actions-info"><i class="fa-solid fa-square-check"></i> ${selectedIds.size} purchases selected</div>
            <div class="flex gap-8">
              ${canManageInventory ? `<button class="btn btn-sm btn-danger" id="bulkDeletePurchBtn"><i class="fa-solid fa-trash"></i> Delete Selected</button>` : ''}
              <button class="btn btn-sm" id="clearPurchSelBtn" style="background:rgba(255,255,255,0.2);color:#fff">Cancel</button>
            </div>
          </div>
        `;
        const bulkDel = document.getElementById('bulkDeletePurchBtn');
        if (bulkDel) {
          bulkDel.onclick = async () => {
            openModal({
              title: 'Bulk Delete',
              body: `<p>Delete ${selectedIds.size} purchase records? This will NOT revert stock changes.</p>`,
              footer: `<button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-danger" id="confirmBulkPurchBtn">Delete All</button>`
            });
            document.getElementById('confirmBulkPurchBtn').onclick = async () => {
              for (const id of selectedIds) {
                await deletePurchase(id);
              }
              selectedIds.clear();
              closeModal();
              showToast('Purchases deleted', 'success');
              await renderRows();
            };
          };
        }
        document.getElementById('clearPurchSelBtn').onclick = async () => { selectedIds.clear(); await renderRows(); };
      }
    }

    const tbody = container.querySelector('tbody');
    if (!tbody) return;

    // Update selectAll checkbox
    const selAllEl = document.getElementById('selectAllPurchases');
    if (selAllEl) {
      selAllEl.checked = allSelected;
      selAllEl.indeterminate = someSelected && !allSelected;
      selAllEl.onclick = async (e) => {
        if (e.target.checked) paginatedPurchases.forEach(p => selectedIds.add(String(p.id)));
        else paginatedPurchases.forEach(p => selectedIds.delete(String(p.id)));
        await renderRows();
      };
    }

    tbody.innerHTML = paginatedPurchases.length === 0 ? `<tr><td colspan="8" style="text-align:center;padding:40px;opacity:0.5">No matching purchases found</td></tr>` :
      paginatedPurchases.map(p => `
        <tr class="${selectedIds.has(String(p.id)) ? 'selected' : ''}" data-id="${p.id}">
          <td class="th-checkbox" data-label="Select">
            <input type="checkbox" class="row-checkbox purchase-select" data-id="${p.id}" ${selectedIds.has(String(p.id)) ? 'checked' : ''} />
          </td>
          <td data-label="Date">${p.date ? new Date(p.date).toLocaleDateString() : 'N/A'}</td>
          <td data-label="Purchase ID" class="font-mono text-sm">${p.id || 'N/A'}</td>
          <td data-label="Invoice #" class="font-mono text-sm">${escapeHtml(p.supplierInvoiceNo || 'N/A')}</td>
          <td data-label="Supplier">${escapeHtml(p.supplierName) || 'Unknown Supplier'}</td>
          <td data-label="Total Amount" class="font-bold">\u20B9${p.total.toFixed(2)}</td>
          <td data-label="Status"><span class="badge ${p.status === 'Completed' ? 'badge-success' : 'badge-warning'}">${p.status}</span></td>
          <td>
            <div style="display:flex;gap:4px">
              <button class="btn btn-ghost btn-sm view-btn" data-id="${p.id}"><i class="fa-solid fa-eye"></i> View</button>
              ${canManageInventory ? `
                <button class="btn btn-ghost btn-sm delete-btn" data-id="${p.id}" style="color:var(--danger)"><i class="fa-solid fa-trash-can"></i></button>
              ` : ''}
            </div>
          </td>
        </tr>
      `).join('');

    // Pagination controls
    const pagArea = document.getElementById('paginationAreaPurchases');
    if (pagArea) {
      let html = `<div class="pagination-bar"><span>Showing page <b>${currentPage}</b> of <b>${totalPages}</b></span><div class="pagination-controls">
        <button class="pagination-btn" id="prevPagePurch" ${currentPage === 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button>`;
      for (let i = 1; i <= totalPages; i++) {
        if (totalPages > 5 && Math.abs(i - currentPage) > 2 && i !== 1 && i !== totalPages) {
          if (i === 2 || i === totalPages - 1) html += `<span style="padding:0 4px">...</span>`;
          continue;
        }
        html += `<button class="pagination-btn ${i === currentPage ? 'active' : ''} purch-page-btn" data-page="${i}">${i}</button>`;
      }
      html += `<button class="pagination-btn" id="nextPagePurch" ${currentPage === totalPages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button></div></div>`;
      pagArea.innerHTML = html;
      document.getElementById('prevPagePurch').onclick = async () => { if (currentPage > 1) { currentPage--; await renderRows(); } };
      document.getElementById('nextPagePurch').onclick = async () => { if (currentPage < totalPages) { currentPage++; await renderRows(); } };
      pagArea.querySelectorAll('.purch-page-btn').forEach(btn => { btn.onclick = async () => { currentPage = parseInt(btn.dataset.page); await renderRows(); }; });
    }

    tbody.querySelectorAll('.purchase-select').forEach(cb => {
      cb.onclick = async (e) => {
        const id = String(cb.dataset.id);
        if (cb.checked) selectedIds.add(id); else selectedIds.delete(id);
        await renderRows();
        e.stopPropagation();
      };
    });

    tbody.querySelectorAll('.view-btn').forEach(btn => {
      btn.onclick = async () => {
        const p = filtered.find(x => x.id === btn.dataset.id);
        await viewPurchaseDetails(p);
      };
    });

    tbody.querySelectorAll('.delete-btn').forEach(btn => {
      btn.onclick = async () => {
        const p = filtered.find(x => x.id === btn.dataset.id);

        openModal({
          title: 'Delete Purchase',
          body: `
            <div style="text-align:center; padding: 20px 0;">
              <i class="fa-solid fa-trash-can text-danger" style="font-size: 48px; margin-bottom: 24px;"></i>
              <h3 style="margin-bottom:8px">Confirm Delete</h3>
              <p style="color:var(--text-muted); font-size:14px; margin-bottom:32px">Are you sure you want to delete purchase <b>${p.id}</b>? This will NOT revert stock changes. Use with caution.</p>
              
              <div style="display:flex; gap:16px; justify-content:center;">
                <button class="btn btn-ghost" onclick="closeModal()" style="flex:1">Cancel</button>
                <button class="btn btn-primary" id="confirmDeletePurchaseBtn" style="flex:1; background:var(--danger); border-color:var(--danger)">Delete</button>
              </div>
            </div>
          `,
          footer: ''
        });

        document.getElementById('confirmDeletePurchaseBtn').onclick = async () => {
          await deletePurchase(p.id);
          showToast('Purchase record deleted', 'success');
          closeModal();
          await renderRows();
        };
      };
    });
  }

  container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Purchases</h1>
          <p class="page-subtitle">Record and track inventory purchase</p>
        </div>
        <div class="flex gap-8">
          <button class="btn btn-ghost hide-desktop" id="mobileFilterToggle" style="border:1px solid var(--border)">
            <i class="fa-solid fa-filter mr-8"></i> Filters
          </button>
          ${await hasPermission('inventory:manage') ? `
            <button class="btn btn-primary" id="addPurBtn"><i class="fa-solid fa-cart-flatbed"></i> New Purchase</button>
          ` : ''}
        </div>
      </div>

    <div id="bulkActionsPurchases"></div>

    <div class="mb-16" id="filterCard" style="transition: all 0.3s ease-in-out; overflow:hidden">
      <div class="data-mgmt-bar mobile-filter-stack p-16">
        <div class="search-input-wrap">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input class="form-input" id="purSearch" placeholder="Search by ID, Invoice #, or Supplier..." />
        </div>
        
        <div class="filter-group">
          <label class="filter-label">Purchase Range</label>
          <div class="date-picker-group">
            <i class="fa-solid fa-calendar-day"></i>
            <input type="text" id="purch-date-range" class="form-input-clean" style="width:100%" readonly />
          </div>
        </div>

        <div class="filter-group">
          <label class="filter-label">Supplier</label>
          <select class="form-select" id="purSupFilter">
            <option value="all">All Suppliers</option>
            ${suppliers.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="table-wrap">
        <table class="responsive-table">
          <thead>
            <tr>
              <th class="th-checkbox"><input type="checkbox" class="row-checkbox" id="selectAllPurchases" /></th>
              <th>Date</th>
              <th>Purchase ID</th>
              <th>Invoice #</th>
              <th>Supplier</th>
              <th>Total Amount</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
    <div id="paginationAreaPurchases"></div>
  `;

  await renderRows();

  document.getElementById('purSearch').oninput = async (e) => { searchQ = e.target.value; await renderRows(); };
  document.getElementById('purSupFilter').onchange = async (e) => { supplierFilt = e.target.value; await renderRows(); };
  
  initDateRangePicker('purch-date-range', filterStartDate, filterEndDate, async (start, end) => {
    filterStartDate = start;
    filterEndDate = end;
    currentPage = 1;
    await renderRows();
  });

  // Mobile Filter Toggle Logic
  const filterCard = document.getElementById('filterCard');
  const toggleBtn = document.getElementById('mobileFilterToggle');
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

  if (document.getElementById('addPurBtn')) {
    document.getElementById('addPurBtn').onclick = async () => await openPurchaseForm(container);
  }
}

export async function openPurchaseForm(container) {
  const suppliers = await getSuppliers();
  const products = await getProducts();

  if (suppliers.length === 0) { showToast('Please add a supplier first', 'warning'); return; }
  if (products.length === 0) { showToast('Please add products first', 'warning'); return; }

  // Suggest the next sequential invoice number as a pre-filled default (still editable —
  // the user should overwrite it with the supplier's actual invoice number whenever they
  // have one on hand). Based on the highest previously auto-generated number, not a plain
  // count, so deleting an old purchase can't cause the next suggestion to collide with one
  // that's still in use.
  const branch = await getCurrentBranch();
  const existingPurchases = await getPurchases(branch?.id);
  const usedAutoNumbers = existingPurchases
    .map(p => (p.supplierInvoiceNo || '').match(/^INV-(\d+)$/))
    .filter(Boolean)
    .map(m => parseInt(m[1], 10));
  const nextInvoiceNo = `INV-${String((usedAutoNumbers.length ? Math.max(...usedAutoNumbers) : 0) + 1).padStart(4, '0')}`;

  let selectedItems = [];
  let billAttachment = '';

  function renderItems() {
    const list = document.getElementById('purchaseItemsList');
    if (!list) return;
    list.innerHTML = selectedItems.map((item, i) => `
      <div class="variant-row" style="margin-bottom:8px">
        <span style="flex:2">${escapeHtml(item.name)}</span>
        <input class="form-input" style="flex:1" type="number" min="0" placeholder="Qty" data-idx="${i}" data-key="qty" value="${item.qty}">
        <input class="form-input" style="flex:1" type="number" placeholder="Cost" data-idx="${i}" data-key="cost" value="${item.cost}">
        <button class="btn btn-icon remove-item" data-idx="${i}" style="color:var(--danger)"><i class="fa-solid fa-trash"></i></button>
      </div>
    `).join('') || '<p style="text-align:center;padding:10px;opacity:0.5">No products added</p>';

    const countEl = document.getElementById('purItemCount');
    if (countEl) countEl.innerText = `${selectedItems.length} items`;

    list.querySelectorAll('input').forEach(input => {
      input.oninput = () => {
        const idx = input.dataset.idx;
        const key = input.dataset.key;
        selectedItems[idx][key] = parseFloat(input.value) || 0;
      };
    });

    list.querySelectorAll('.remove-item').forEach(btn => {
      btn.onclick = () => {
        selectedItems.splice(btn.dataset.idx, 1);
        renderItems();
      };
    });
  }

  openModal({
    title: `<i class="fa-solid fa-cart-flatbed mr-8"></i> New Purchase Entry`,
    body: `
      <!-- Purchase Context -->
      <div style="margin-bottom: 24px; padding: 20px; background: var(--bg-elevated); border-radius: var(--radius); border: 1px solid var(--border)">
         <div class="form-grid">
            <div class="form-group">
              <label class="form-label required">Supplier Invoice #</label>
              <div class="search-input-wrap">
                <i class="fa-solid fa-file-invoice"></i>
                <input class="form-input" id="purInvNo" placeholder="Bill Number" value="${nextInvoiceNo}" style="padding-left:36px; font-weight:700" />
              </div>
              <p class="form-help-text">Auto-suggested — replace with the supplier's actual bill number if you have it.</p>
            </div>
            <div class="form-group">
              <label class="form-label">Place of Supply</label>
              <div class="search-input-wrap">
                <i class="fa-solid fa-location-arrow"></i>
                <input class="form-input" id="purPos" value="${store.settings.stateCode || '33'}" placeholder="State Code" style="padding-left:36px" />
              </div>
            </div>
         </div>

         <div class="form-group mt-16 mb-0">
            <label class="form-label required">Target Supplier</label>
            <div class="search-input-wrap">
              <i class="fa-solid fa-truck-field"></i>
              <select class="form-select" id="purSupplier" style="padding-left:36px; font-weight:600">
              ${suppliers.map(s => '<option value="' + s.id + '">' + escapeHtml(s.name) + '</option>').join('')}
            </select>
          </div>
       </div>

       <div class="form-group mt-16 mb-0">
          <label class="form-label">Attach Bill / Invoice (optional)</label>
          <div style="display:flex; align-items:center; gap:12px">
            <button type="button" class="btn btn-ghost btn-sm" id="purBillUploadBtn"><i class="fa-solid fa-paperclip mr-4"></i> Choose File</button>
            <input type="file" id="purBillFile" accept="image/*,application/pdf" style="display:none" />
            <span id="purBillFileName" style="font-size:12px; opacity:0.7"></span>
            <button type="button" class="btn btn-ghost btn-xs" id="purBillRemoveBtn" style="color:var(--danger); display:none"><i class="fa-solid fa-trash mr-4"></i> Remove</button>
          </div>
          <p class="form-help-text">Photo or PDF of the supplier's bill, kept with this purchase record.</p>
       </div>
    </div>

    <!-- Product Selection Area -->
    <div style="border:1px solid var(--border); padding:16px; border-radius:12px; background:var(--bg-app); margin-bottom:16px">
      <label class="form-label" style="font-weight:800; font-size:11px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em"><i class="fa-solid fa-cart-plus mr-4"></i> Add Products to Purchase</label>
      <div style="display:flex; gap:12px; margin-top:8px">
        <div class="search-input-wrap" style="flex:1">
          <i class="fa-solid fa-barcode"></i>
          <select class="form-select" id="addProductSelect" style="padding-left:36px; height:42px">
            ${products.map(p => '<option value="' + p.id + '">' + escapeHtml(p.name) + ' (SKU: ' + escapeHtml(p.sku || 'N/A') + ')</option>').join('')}
          </select>
          </div>
          <button class="btn btn-primary" id="addItemBtn" style="height:42px; padding: 0 20px">
            <i class="fa-solid fa-plus mr-4"></i> Add
          </button>
        </div>
      </div>

      <div class="variant-row" style="margin-top:12px; margin-bottom:4px; padding:0 4px">
        <span style="flex:2; font-size:11px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em">Product</span>
        <span style="flex:1; font-size:11px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em">Qty</span>
        <span style="flex:1; font-size:11px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em">Cost</span>
        <span style="width:36px"></span>
      </div>
      <div id="purchaseItemsList" style="max-height:280px; overflow-y:auto; padding:4px"></div>

      <div class="form-grid mt-24 pt-20" style="border-top:1px solid var(--border)">
        <div class="form-group">
          <label class="form-label">Purchase Tax Rate (%)</label>
          <select class="form-select" id="purTaxRate" ${!store.settings.availableTaxes?.length ? 'disabled' : ''}>
            ${store.settings.availableTaxes?.length
              ? store.settings.availableTaxes.map(t => `<option value="${t}" ${t == 0 ? 'selected' : ''}>${t}%</option>`).join('')
              : `<option value="0">No tax rates configured — add one in Settings</option>`}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Amount Paid to Supplier Now</label>
          <div class="search-input-wrap">
            <i class="fa-solid fa-money-bill-wave"></i>
            <input class="form-input" type="number" id="purAmountPaid" value="0" placeholder="0.00" min="0" style="padding-left:36px" />
          </div>
          <p class="form-help-text">Leave as 0 if this is fully on credit — the unpaid balance shows up in the Outstanding report.</p>
        </div>
        <div class="form-group">
          <label class="form-label">Paid Via</label>
          <select class="form-select" id="purPaymentMethod">
            ${(store.settings.paymentMethods?.length ? store.settings.paymentMethods : ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Cheque']).map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="display:flex; align-items:center; justify-content:flex-end">
           <div style="text-align:right">
              <div style="font-size:11px; color:var(--text-muted)">Current Items</div>
              <div id="purItemCount" style="font-size:18px; font-weight:800; color:var(--primary)">0 items</div>
           </div>
        </div>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" onclick="closeModal()">Abandon Entry</button>
      <button class="btn btn-primary" id="completePurchaseBtn" style="min-width: 220px; background:var(--success); border-color:var(--success)">
        <i class="fa-solid fa-check-double mr-8"></i> Complete Purchase
      </button>
    `
  });

  renderItems();

  const billUploadBtn = document.getElementById('purBillUploadBtn');
  const billFileInput = document.getElementById('purBillFile');
  const billFileName = document.getElementById('purBillFileName');
  const billRemoveBtn = document.getElementById('purBillRemoveBtn');

  billUploadBtn.onclick = () => billFileInput.click();
  billFileInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const { MediaService } = await import('../services/MediaService.js');
      billAttachment = await MediaService.handleBillUpload(e);
      billFileName.textContent = file.name;
      billRemoveBtn.style.display = 'inline-flex';
    } catch (err) {
      showToast(err.message, 'error');
      billFileInput.value = '';
    }
  };
  billRemoveBtn.onclick = () => {
    billAttachment = '';
    billFileName.textContent = '';
    billFileInput.value = '';
    billRemoveBtn.style.display = 'none';
  };

  document.getElementById('addItemBtn').onclick = () => {
    const pid = document.getElementById('addProductSelect').value;
    const p = products.find(x => String(x.id) === String(pid));

    if (!p) { showToast('Product not found', 'error'); return; }

    // Prefer the product's own recorded Cost Price — only fall back to a rough 80%-of-selling-price
    // guess for products that have never had a cost price set at all.
    const defaultCost = p.costPrice > 0 ? p.costPrice : (p.price || 0) * 0.8;

    // Variant products don't have their own top-level stock — only receiving
    // against a specific variant (and updating THAT variant's stock, see
    // completePurchaseBtn below) keeps this consistent with how sales and the
    // product-edit form both track stock (per-variant, with product.stock
    // kept only as a derived sum). Add one pending row per variant instead of
    // a single ambiguous "add N units to this product" row.
    if (p.variants && p.variants.length > 0) {
      const missingVariants = p.variants.filter(v => !selectedItems.find(x => String(x.id) === String(pid) && x.variantName === v.name));
      if (missingVariants.length === 0) { showToast('All variants of this product already added', 'warning'); return; }
      missingVariants.forEach(v => {
        selectedItems.push({ id: p.id, name: `${p.name} (${v.name})`, variantName: v.name, qty: 0, cost: defaultCost });
      });
    } else {
      if (selectedItems.find(x => String(x.id) === String(pid))) { showToast('Product already added', 'warning'); return; }
      selectedItems.push({ id: p.id, name: p.name, qty: 1, cost: defaultCost });
    }
    renderItems();
  };

  const completePurchaseBtn = document.getElementById('completePurchaseBtn');
  completePurchaseBtn.onclick = async () => {
    // Guards against a fast double-click saving the same purchase (and
    // double-crediting its stock) twice — the rest of this handler awaits
    // several DB calls before closeModal() ever runs.
    if (completePurchaseBtn.disabled) return;
    if (selectedItems.length === 0) { showToast('Add items to purchase', 'error'); return; }

    // A typo'd negative qty (the number input only soft-hints min="0" — it
    // doesn't stop a typed "-3") should never be silently dropped the same
    // way an untouched variant row (qty 0) is — that's a mistake to fix, not
    // "this variant wasn't restocked this time".
    const negativeItem = selectedItems.find(i => i.qty < 0);
    if (negativeItem) { showToast(`"${escapeHtml(negativeItem.name)}": quantity can't be negative`, 'error'); return; }

    // Variant rows start at qty 0 (a product can have several variants added
    // at once but this purchase may only cover some of them) — drop the ones
    // left untouched instead of rejecting the whole purchase for them.
    const itemsToProcess = selectedItems.filter(i => i.qty > 0);
    if (itemsToProcess.length === 0) { showToast('Enter a quantity greater than 0 for at least one item', 'error'); return; }

    // Qty must be positive — a zero/negative quantity here would still log an inventory
    // change tagged "Purchase Received IN" while actually leaving stock unchanged or
    // reducing it, which is the opposite of what a purchase record should ever do.
    const invalidItem = itemsToProcess.find(i => i.cost < 0);
    if (invalidItem) {
      showToast(`"${escapeHtml(invalidItem.name)}": cost can't be negative`, 'error');
      return;
    }

    const invNo = document.getElementById('purInvNo').value.trim();
    if (!invNo) { showToast('Supplier Invoice # is required', 'error'); return; }

    const supplierId = document.getElementById('purSupplier').value;
    const sup = suppliers.find(s => String(s.id) === String(supplierId));

    if (!sup) { showToast('Supplier not found', 'error'); return; }

    const taxRate = parseFloat(document.getElementById('purTaxRate').value) || 0;

    const subtotal = itemsToProcess.reduce((s, i) => s + (i.qty * i.cost), 0);
    const taxAmount = subtotal * (taxRate / 100);
    const total = subtotal + taxAmount;

    let amountPaid = parseFloat(document.getElementById('purAmountPaid').value) || 0;
    if (amountPaid < 0) { showToast('Amount Paid cannot be negative', 'error'); return; }
    if (amountPaid > total) { showToast(`Amount Paid can't exceed the purchase total (${store.settings.currency || '₹'}${total.toFixed(2)})`, 'error'); return; }

    // Same duplicate-guard class already applied to Categories.js/Suppliers.js/
    // Staff.js/CustomerForm.js — without it, re-recording the same supplier
    // invoice (e.g. a fast double-click, or re-entering after a UI glitch)
    // silently double-counts stock received and the supplier's outstanding balance.
    const existingPurchases = await getPurchases();
    if (existingPurchases.some(p => String(p.supplierId) === String(supplierId) && (p.supplierInvoiceNo || '').toLowerCase() === invNo.toLowerCase())) {
      showToast(`Invoice "${invNo}" is already recorded for this supplier`, 'error');
      return;
    }

    completePurchaseBtn.disabled = true;
    try {
      const currentUser = await getCurrentUser();
      const newPur = await savePurchase({
        date: new Date().toISOString(),
        supplierId,
        supplierName: sup.name || 'Unknown Supplier',
        supplierGstin: sup.gstin || '',
        supplierInvoiceNo: invNo,
        placeOfSupply: document.getElementById('purPos').value.trim(),
        items: itemsToProcess,
        subtotal,
        taxRate,
        taxAmount,
        total,
        amountPaid,
        paymentMethod: document.getElementById('purPaymentMethod').value,
        recordedBy: currentUser?.name || '',
        billAttachment,
        status: 'Completed'
      });

      // Update Stock Logic — mirrors saveOrder()'s deduction in db.js: a
      // variant's own stock is the source of truth, with product.stock kept
      // only as a derived sum, so receiving stock against a variant here stays
      // consistent with what sales and the product-edit form both read.
      const allProducts = await getProducts();
      for (const item of itemsToProcess) {
        const p = allProducts.find(x => String(x.id) === String(item.id));
        if (p) {
          let oldStock = 0;
          if (item.variantName && p.variants) {
            const v = p.variants.find(v => v.name === item.variantName);
            if (v) {
              oldStock = v.stock || 0;
              v.stock = (v.stock || 0) + item.qty;
              p.stock = p.variants.reduce((s, vr) => s + (vr.stock || 0), 0);
            }
          } else {
            oldStock = p.stock || 0;
            p.stock = oldStock + item.qty;
          }
          await updateProduct(p);
          await logInventoryChange(p.id, item.variantName || null, 'IN', item.qty, 'Purchase Received', newPur.branchId, newPur.id, oldStock, oldStock + item.qty, currentUser?.name);
        }
      }

      showToast('Purchase completed and stock updated!', 'success');
      closeModal();
      const { navigate } = await import('../router.js');
      await navigate('purchases');
    } finally {
      completePurchaseBtn.disabled = false;
    }
  };
}

async function viewPurchaseDetails(purchase) {
  const amountPaid = purchase.amountPaid || 0;
  // A purchase return reduces what's actually owed to the supplier, but
  // (matching the same convention sales returns use against order.total)
  // purchase.total itself is never mutated — net returned value out of it
  // here, the same way getSupplierOutstandingReport()/getPurchasesMonthly()
  // in db.js now do, or "Outstanding" would keep counting a fully-returned
  // purchase as still owed in full forever.
  const returnedTotals = await getPurchaseReturnedTotals();
  const returnedTotal = returnedTotals[purchase.id] || 0;
  const netTotal = Math.max(0, purchase.total - returnedTotal);
  const outstanding = Math.max(0, netTotal - amountPaid);

  openModal({
    title: `Purchase Details: ${purchase.id || 'N/A'}`,
    body: `
      <div style="margin-bottom:16px; display:flex; justify-content:space-between; align-items:flex-start">
        <div>
          <div style="font-size:14px;color:var(--text-secondary)">Supplier</div>
          <div class="font-bold">${escapeHtml(purchase.supplierName) || 'Unknown Supplier'}</div>
          <div style="font-size:12px;opacity:0.6">${purchase.date ? new Date(purchase.date).toLocaleString() : 'N/A'}</div>
          <div style="font-size:12px;margin-top:4px">Invoice #: <span class="font-mono font-bold">${escapeHtml(purchase.supplierInvoiceNo || 'N/A')}</span></div>
          ${purchase.recordedBy ? `<div style="font-size:11px;opacity:0.6;margin-top:2px">Recorded by: ${escapeHtml(purchase.recordedBy)}</div>` : ''}
        </div>
        ${purchase.billAttachment ? `
          <button class="btn btn-ghost btn-sm" id="viewBillAttachmentBtn">
            <i class="fa-solid ${purchase.billAttachment.startsWith('data:application/pdf') ? 'fa-file-pdf' : 'fa-image'} mr-4"></i> View Attached Bill
          </button>
        ` : ''}
      </div>
      <div class="table-wrap">
        <table class="responsive-table">
          <thead>
            <tr><th>Product</th><th>Qty</th><th>Cost</th><th>Subtotal</th></tr>
          </thead>
          <tbody>
            ${purchase.items.map(i => `
              <tr>
                <td data-label="Product">${escapeHtml(i.name)}</td>
                <td data-label="Qty">${i.qty}</td>
                <td data-label="Cost">\u20B9${i.cost.toFixed(2)}</td>
                <td data-label="Subtotal" class="font-bold">\u20B9${(i.qty * i.cost).toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3" style="text-align:right">Subtotal:</td>
              <td class="font-bold">\u20B9${(purchase.subtotal || purchase.total).toFixed(2)}</td>
            </tr>
            ${purchase.taxAmount > 0 ? `
              <tr>
                <td colspan="3" style="text-align:right">Tax (${purchase.taxRate}%):</td>
                <td class="font-bold">\u20B9${purchase.taxAmount.toFixed(2)}</td>
              </tr>
            ` : ''}
            <tr>
              <td colspan="3" style="text-align:right"><strong>Total Amount:</strong></td>
              <td class="font-bold text-accent" style="font-size:16px">\u20B9${purchase.total.toFixed(2)}</td>
            </tr>
            ${returnedTotal > 0 ? `
              <tr>
                <td colspan="3" style="text-align:right">Returned to Supplier:</td>
                <td class="font-bold text-danger">-\u20B9${returnedTotal.toFixed(2)}</td>
              </tr>
            ` : ''}
            <tr>
              <td colspan="3" style="text-align:right">Paid to Supplier:</td>
              <td class="font-bold text-success">\u20B9${amountPaid.toFixed(2)}</td>
            </tr>
            <tr>
              <td colspan="3" style="text-align:right"><strong>Outstanding:</strong></td>
              <td class="font-bold ${outstanding > 0 ? 'text-danger' : 'text-success'}" style="font-size:16px">\u20B9${outstanding.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      ${outstanding > 0 ? `
        <div style="margin-top:16px; padding:16px; background:var(--bg-elevated); border-radius:12px; border:1px solid var(--border)">
          <label class="form-label">Record a Payment to Supplier</label>
          <div style="display:flex; gap:8px">
            <input class="form-input" type="number" id="recordPaymentAmount" placeholder="0.00" min="0" max="${outstanding}" style="flex:1" />
            <button class="btn btn-primary" id="recordPaymentBtn">Add Payment</button>
          </div>
        </div>
      ` : ''}
    `,
    footer: `
      <button class="btn btn-ghost" id="printVoucherBtn"><i class="fa-solid fa-print mr-4"></i> Print Voucher</button>
      <button class="btn btn-primary" onclick="closeModal()">Close Details</button>
    `
  });

  // Wired here (not inlined into the button's HTML) since the attachment is a base64 data
  // URI and can be several MB — far too large to embed as an onclick attribute value.
  document.getElementById('viewBillAttachmentBtn')?.addEventListener('click', () => {
    window.open(purchase.billAttachment, '_blank');
  });

  document.getElementById('printVoucherBtn')?.addEventListener('click', async (e) => {
    // printReceiptHtml() does real async work (settings, CSS/IPC round-trip,
    // spinning up a hidden Electron window) before anything is visible —
    // give instant feedback on click instead of the button doing nothing
    // for that whole stretch, which otherwise reads as "trigger late".
    const btn = e.currentTarget;
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Printing...';
    try {
      const settings = await getSettings(purchase.branchId);
      const cur = settings.currency || '₹';
      const html = renderPurchaseVoucherHtml(purchase, settings, cur, returnedTotal, amountPaid, outstanding);
      await printReceiptHtml(html, `Purchase Voucher - ${purchase.id}`);
    } finally {
      if (document.body.contains(btn)) { btn.disabled = false; btn.innerHTML = original; }
    }
  });

  const recordPaymentBtn = document.getElementById('recordPaymentBtn');
  recordPaymentBtn?.addEventListener('click', async () => {
    if (recordPaymentBtn.disabled) return;
    const input = document.getElementById('recordPaymentAmount');
    const amount = parseFloat(input.value) || 0;
    if (amount <= 0) { showToast('Enter a valid payment amount', 'error'); return; }

    recordPaymentBtn.disabled = true;
    try {
      // Re-read the purchase fresh instead of using the stale `purchase`/
      // `amountPaid` captured at modal-open time — without this, a fast
      // double-click (or a second payment recorded from another window)
      // would compute its new total off the same stale amountPaid and
      // silently discard whichever payment applied second.
      const freshPurchases = await getPurchases();
      const freshPurchase = freshPurchases.find(p => p.id === purchase.id);
      if (!freshPurchase) throw new Error('Purchase record not found.');
      // The outstanding-balance CAP must also be checked against this same
      // fresh read, not the `outstanding` closure captured at modal-open
      // time — otherwise two windows open on the same purchase can each
      // pass their own stale ceiling check and together overpay past the
      // purchase total (the write above already uses fresh data so it
      // doesn't silently discard either payment, but without this the
      // second payment would still be wrongly *accepted* when it shouldn't be).
      const freshReturnedTotals = await getPurchaseReturnedTotals();
      const freshNetTotal = Math.max(0, freshPurchase.total - (freshReturnedTotals[freshPurchase.id] || 0));
      const freshOutstanding = Math.max(0, freshNetTotal - (freshPurchase.amountPaid || 0));
      if (amount > freshOutstanding + 0.01) {
        throw new Error(`Payment can't exceed the outstanding balance (₹${freshOutstanding.toFixed(2)})`);
      }
      await savePurchase({ ...freshPurchase, amountPaid: (freshPurchase.amountPaid || 0) + amount });
    } catch (err) {
      recordPaymentBtn.disabled = false;
      showToast(err.message || 'Failed to record payment.', 'error');
      return;
    }
    showToast('Payment recorded', 'success');
    closeModal();
    const { navigate } = await import('../router.js');
    await navigate('purchases');
  });
}

// Internal record for the shop's own files — NOT a document for the supplier
// (their own invoice is the real proof of sale). Reuses the same .receipt
// classes as the sales receipt so it prints consistently on the same
// thermal/A4 printer setup without needing its own stylesheet.
function renderPurchaseVoucherHtml(purchase, settings, cur, returnedTotal, amountPaid, outstanding) {
  const itemRows = purchase.items.map(i => `
    <div class="receipt-row">
      <span>${escapeHtml(i.name)} x${i.qty}</span>
      <span>${cur}${(i.qty * i.cost).toFixed(2)}</span>
    </div>
  `).join('');

  return `
    <div class="receipt">
      <div class="receipt-header">
        <div class="receipt-store-name">${escapeHtml(settings.storeName || 'Store')}</div>
        <div style="font-size:10.5px;opacity:0.8;margin-top:4px">${escapeHtml(settings.storeAddress || '')}</div>
        <div style="font-size:13px;font-weight:800;margin-top:8px;letter-spacing:0.5px">PURCHASE VOUCHER</div>
        <div style="font-size:10px;opacity:0.6">(Internal record — not a supplier invoice)</div>
      </div>
      <div class="receipt-divider"></div>
      <div class="receipt-row"><span>Supplier</span><span class="font-bold">${escapeHtml(purchase.supplierName || 'Unknown')}</span></div>
      <div class="receipt-row"><span>Invoice #</span><span>${escapeHtml(purchase.supplierInvoiceNo || 'N/A')}</span></div>
      <div class="receipt-row"><span>Date</span><span>${purchase.date ? new Date(purchase.date).toLocaleString() : 'N/A'}</span></div>
      <div class="receipt-divider"></div>
      ${itemRows}
      <div class="receipt-divider"></div>
      <div class="receipt-row"><span>Subtotal</span><span>${cur}${(purchase.subtotal || purchase.total).toFixed(2)}</span></div>
      ${purchase.taxAmount > 0 ? `<div class="receipt-row"><span>Tax (${purchase.taxRate}%)</span><span>${cur}${purchase.taxAmount.toFixed(2)}</span></div>` : ''}
      <div class="receipt-row" style="font-weight:800"><span>Total</span><span>${cur}${purchase.total.toFixed(2)}</span></div>
      ${returnedTotal > 0 ? `<div class="receipt-row"><span>Returned</span><span>-${cur}${returnedTotal.toFixed(2)}</span></div>` : ''}
      <div class="receipt-divider"></div>
      <div class="receipt-row"><span>Paid Via</span><span>${escapeHtml(purchase.paymentMethod || 'N/A')}</span></div>
      <div class="receipt-row" style="font-weight:800"><span>Amount Paid</span><span>${cur}${amountPaid.toFixed(2)}</span></div>
      <div class="receipt-row" style="font-weight:800"><span>Outstanding</span><span>${cur}${outstanding.toFixed(2)}</span></div>
      <div class="receipt-divider"></div>
      <div class="receipt-footer">Recorded by: ${escapeHtml(purchase.recordedBy || '-')}</div>
    </div>
  `;
}
