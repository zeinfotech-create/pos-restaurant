import { getPurchases, getSuppliers, getProducts, savePurchase, updateProduct, getCurrentBranch, getCurrentUser, deletePurchase, hasPermission, logInventoryChange } from '../db.js';
import { store } from '../store.js';
import { openModal, closeModal } from '../components/Modal.js';
import { showToast } from '../components/Toast.js';
import { initDateRangePicker, getDefaultRange } from '../utils/dateRangeHelper.js';
import { applySessionFilter } from '../utils/sessionFilter.js';

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
    let rawPurchases = await getPurchases(branchId);
    let filtered = await applySessionFilter(rawPurchases, 'date');
    if (searchQ) {
      filtered = filtered.filter(p =>
        (p.id || '').toLowerCase().includes(searchQ.toLowerCase()) ||
        (p.supplierName || '').toLowerCase().includes(searchQ.toLowerCase())
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
              ${await hasPermission('inventory:manage') ? `<button class="btn btn-sm btn-danger" id="bulkDeletePurchBtn"><i class="fa-solid fa-trash"></i> Delete Selected</button>` : ''}
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

    tbody.innerHTML = paginatedPurchases.length === 0 ? `<tr><td colspan="7" style="text-align:center;padding:40px;opacity:0.5">No matching purchases found</td></tr>` :
      paginatedPurchases.map(p => `
        <tr class="${selectedIds.has(String(p.id)) ? 'selected' : ''}" data-id="${p.id}">
          <td class="th-checkbox" data-label="Select">
            <input type="checkbox" class="row-checkbox purchase-select" data-id="${p.id}" ${selectedIds.has(String(p.id)) ? 'checked' : ''} />
          </td>
          <td data-label="Date">${p.date ? new Date(p.date).toLocaleDateString() : 'N/A'}</td>
          <td data-label="Purchase ID" class="font-mono text-sm">${p.id || 'N/A'}</td>
          <td data-label="Supplier">${p.supplierName || 'Unknown Supplier'}</td>
          <td data-label="Total Amount" class="font-bold">\u20B9${p.total.toFixed(2)}</td>
          <td data-label="Status"><span class="badge ${p.status === 'Completed' ? 'badge-success' : 'badge-warning'}">${p.status}</span></td>
          <td>
            <div style="display:flex;gap:4px">
              <button class="btn btn-ghost btn-sm view-btn" data-id="${p.id}"><i class="fa-solid fa-eye"></i> View</button>
              ${hasPermission('inventory:manage') ? `
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
      btn.onclick = () => {
        const p = filtered.find(x => x.id === btn.dataset.id);
        viewPurchaseDetails(p);
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
          <p class="page-subtitle">Record and track inventory procurement</p>
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
          <input class="form-input" id="purSearch" placeholder="Search by ID or Supplier..." />
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
            ${suppliers.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
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

  let selectedItems = [];

  function renderItems() {
    const list = document.getElementById('purchaseItemsList');
    if (!list) return;
    list.innerHTML = selectedItems.map((item, i) => `
      <div class="variant-row" style="margin-bottom:8px">
        <span style="flex:2">${item.name}</span>
        <input class="form-input" style="flex:1" type="number" placeholder="Qty" data-idx="${i}" data-key="qty" value="${item.qty}">
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
                <input class="form-input" id="purInvNo" placeholder="Bill Number" style="padding-left:36px; font-weight:700" />
              </div>
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
              ${suppliers.map(s => '<option value="' + s.id + '">' + s.name + '</option>').join('')}
            </select>
          </div>
       </div>
    </div>
    
    <!-- Product Selection Area -->
    <div style="border:1px solid var(--border); padding:16px; border-radius:12px; background:var(--bg-app); margin-bottom:16px">
      <label class="form-label" style="font-weight:800; font-size:11px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em"><i class="fa-solid fa-cart-plus mr-4"></i> Add Products to Purchase</label>
      <div style="display:flex; gap:12px; margin-top:8px">
        <div class="search-input-wrap" style="flex:1">
          <i class="fa-solid fa-barcode"></i>
          <select class="form-select" id="addProductSelect" style="padding-left:36px; height:42px">
            ${products.map(p => '<option value="' + p.id + '">' + p.name + ' (SKU: ' + (p.sku || 'N/A') + ')</option>').join('')}
          </select>
          </div>
          <button class="btn btn-primary" id="addItemBtn" style="height:42px; padding: 0 20px">
            <i class="fa-solid fa-plus mr-4"></i> Add
          </button>
        </div>
      </div>

      <div id="purchaseItemsList" style="max-height:280px; overflow-y:auto; padding:4px"></div>

      <div class="form-grid mt-24 pt-20" style="border-top:1px solid var(--border)">
        <div class="form-group">
          <label class="form-label">Purchase Tax Rate (%)</label>
          <div class="search-input-wrap">
            <i class="fa-solid fa-percent"></i>
            <input class="form-input" type="number" id="purTaxRate" value="0" placeholder="e.g. 18" style="padding-left:36px" />
          </div>
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

  document.getElementById('addItemBtn').onclick = () => {
    const pid = document.getElementById('addProductSelect').value;
    const p = products.find(x => String(x.id) === String(pid));

    if (!p) { showToast('Product not found', 'error'); return; }
    if (selectedItems.find(x => String(x.id) === String(pid))) { showToast('Product already added', 'warning'); return; }

    // Prefer the product's own recorded Cost Price — only fall back to a rough 80%-of-selling-price
    // guess for products that have never had a cost price set at all.
    const defaultCost = p.costPrice > 0 ? p.costPrice : (p.price || 0) * 0.8;
    selectedItems.push({ id: p.id, name: p.name, qty: 1, cost: defaultCost });
    renderItems();
  };

  document.getElementById('completePurchaseBtn').onclick = async () => {
    if (selectedItems.length === 0) { showToast('Add items to purchase', 'error'); return; }

    // Qty must be positive — a zero/negative quantity here would still log an inventory
    // change tagged "Purchase Received IN" while actually leaving stock unchanged or
    // reducing it, which is the opposite of what a purchase record should ever do.
    const invalidItem = selectedItems.find(i => !(i.qty > 0) || i.cost < 0);
    if (invalidItem) {
      showToast(`"${invalidItem.name}": quantity must be greater than 0 and cost can't be negative`, 'error');
      return;
    }

    const invNo = document.getElementById('purInvNo').value.trim();
    if (!invNo) { showToast('Supplier Invoice # is required', 'error'); return; }

    const supplierId = document.getElementById('purSupplier').value;
    const sup = suppliers.find(s => String(s.id) === String(supplierId));

    if (!sup) { showToast('Supplier not found', 'error'); return; }

    const taxRate = parseFloat(document.getElementById('purTaxRate').value) || 0;

    const subtotal = selectedItems.reduce((s, i) => s + (i.qty * i.cost), 0);
    const taxAmount = subtotal * (taxRate / 100);
    const total = subtotal + taxAmount;

    const newPur = await savePurchase({
      date: new Date().toISOString(),
      supplierId,
      supplierName: sup.name || 'Unknown Supplier',
      supplierGstin: sup.gstin || '',
      supplierInvoiceNo: invNo,
      placeOfSupply: document.getElementById('purPos').value.trim(),
      items: selectedItems,
      subtotal,
      taxRate,
      taxAmount,
      total,
      status: 'Completed'
    });

    // Update Stock Logic
    const allProducts = await getProducts();
    const currentUser = await getCurrentUser();
    for (const item of selectedItems) {
      const p = allProducts.find(x => String(x.id) === String(item.id));
      if (p) {
        const oldStock = p.stock || 0;
        p.stock = oldStock + item.qty;
        await updateProduct(p);
        await logInventoryChange(p.id, null, 'IN', item.qty, 'Purchase Received', newPur.branchId, newPur.id, oldStock, oldStock + item.qty, currentUser?.name);
      }
    }

    showToast('Purchase completed and stock updated!', 'success');
    closeModal();
    const { navigate } = await import('../router.js');
    await navigate('purchases');
  };
}

function viewPurchaseDetails(purchase) {
  openModal({
    title: `Purchase Details: ${purchase.id || 'N/A'}`,
    body: `
      <div style="margin-bottom:16px">
        <div style="font-size:14px;color:var(--text-secondary)">Supplier</div>
        <div class="font-bold">${purchase.supplierName || 'Unknown Supplier'}</div>
        <div style="font-size:12px;opacity:0.6">${purchase.date ? new Date(purchase.date).toLocaleString() : 'N/A'}</div>
      </div>
      <div class="table-wrap">
        <table class="responsive-table">
          <thead>
            <tr><th>Product</th><th>Qty</th><th>Cost</th><th>Subtotal</th></tr>
          </thead>
          <tbody>
            ${purchase.items.map(i => `
              <tr>
                <td data-label="Product">${i.name}</td>
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
          </tfoot>
        </table>
      </div>
    `,
    footer: `<button class="btn btn-primary" onclick="closeModal()">Close Details</button>`
  });
}
