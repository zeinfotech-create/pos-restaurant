import { getSuppliers, saveSupplier, getCurrentBranch, getCurrentUser, deleteSupplier, hasPermission } from '../db.js';
import { openModal, closeModal } from '../components/Modal.js';
import { showToast } from '../components/Toast.js';
import { initDateRangePicker, getDefaultRange } from '../utils/dateRangeHelper.js';
import { applySessionFilter } from '../utils/sessionFilter.js';

let searchQ = '';
const { start: defaultStart, end: defaultEnd } = getDefaultRange();
// Suppliers are master data, not a transaction log — don't hide ones added
// before this month. Only filter by date once the user picks a range.
let filterStartDate = null;
let filterEndDate = null;
let currentPage = 1;
const itemsPerPage = 10;
let selectedIds = new Set();

export async function renderSuppliers(container, subPage) {
  const branch = await getCurrentBranch();
  const branchId = branch?.id;
  
  async function fetchAndFilter() {
    let list = await getSuppliers(branchId);
    
    if (searchQ) {
      list = list.filter(s =>
        (s.name || '').toLowerCase().includes(searchQ.toLowerCase()) ||
        (s.contact || '').toLowerCase().includes(searchQ.toLowerCase()) ||
        (s.phone || '').toLowerCase().includes(searchQ.toLowerCase())
      );
    }
    
    if (filterStartDate && filterEndDate) {
      list = list.filter(s => {
        const d = (s.updatedAt || s.createdAt || new Date().toISOString()).split('T')[0];
        return d >= filterStartDate && d <= filterEndDate;
      });
    }

    list.sort((a,b) => {
      const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      if (timeB !== timeA) return timeB - timeA;
      return String(b.id).localeCompare(String(a.id));
    });
    return list;
  }

  const suppliers = await fetchAndFilter();

  const totalItems = suppliers.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * itemsPerPage;
  const paginatedSuppliers = suppliers.slice(start, start + itemsPerPage);

  const paginatedIds = paginatedSuppliers.map(s => String(s.id));
  const someInPageSelected = paginatedIds.some(id => selectedIds.has(id));
  const allInPageSelected = paginatedIds.length > 0 && paginatedIds.every(id => selectedIds.has(id));

  if (subPage === 'add' && await hasPermission('products:manage')) {
    await openSupplierForm(null, container);
  }

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Suppliers</h1>
        <p class="page-subtitle">Manage your inventory vendors</p>
      </div>
      <div class="flex gap-8">
        <button class="btn btn-ghost hide-desktop" id="mobileFilterToggle" style="border:1px solid var(--border)">
          <i class="fa-solid fa-filter mr-8"></i> Filters
        </button>
        ${await hasPermission('products:manage') ? `
          <button class="btn btn-primary" id="addSupBtn"><i class="fa-solid fa-plus"></i> Add Supplier</button>
        ` : ''}
      </div>
    </div>
    
    <div id="bulkActionsArea"></div>
    
    <div class="mb-16" id="filterCard" style="transition: all 0.3s ease-in-out; overflow:hidden">
      <div class="data-mgmt-bar p-16">
        <div class="search-input-wrap">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input class="form-input" id="supSearch" placeholder="Search by name, contact or phone..." value="${searchQ}" />
        </div>
        <div class="filter-group">
          <label class="filter-label">Onboarded Range</label>
          <div class="date-picker-group">
            <i class="fa-solid fa-calendar-alt"></i>
            <input type="text" id="sup-date-range" class="form-input-clean" style="width:100%" readonly />
          </div>
        </div>
      </div>
    </div>

      <div id="suppliersTableArea"></div>
    <div id="paginationArea"></div>
  `;

  const renderTable = async () => {
    // Re-check selections and render the table + bulk actions
    await renderBulkActionsBar(container);

    const wrap = document.getElementById('suppliersTableArea');
    if (!wrap) return;

    const canManage = await hasPermission('products:manage');

    wrap.innerHTML = `
      <div class="card">
        <div class="table-wrap">
          <table class="responsive-table">
            <thead>
              <tr>
                <th class="th-checkbox"><input type="checkbox" class="row-checkbox" id="selectAllSuppliers" ${allInPageSelected ? 'checked' : ''} /></th>
                <th>Supplier</th>
                <th>Contact Person</th>
                <th>Phone</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${paginatedSuppliers.length === 0 ? `<tr><td colspan="5" style="text-align:center;padding:40px;opacity:0.5">No suppliers found</td></tr>` :
        paginatedSuppliers.map(s => `
                <tr class="${selectedIds.has(String(s.id)) ? 'selected' : ''}" data-id="${s.id}">
                  <td class="th-checkbox" data-label="Select">
                    <input type="checkbox" class="row-checkbox supplier-select" data-id="${s.id}" ${selectedIds.has(String(s.id)) ? 'checked' : ''} />
                  </td>
                  <td data-label="Supplier" class="font-semibold">
                  <div style="display:flex;align-items:center;gap:12px;justify-content:flex-start">
                    <div style="width:32px;height:32px;border-radius:16px;background:var(--bg-elevated);display:flex;align-items:center;justify-content:center;overflow:hidden;border:1px solid var(--border)">
                      ${s.image ? `<img src="${s.image}" style="width:100%;height:100%;object-fit:cover" />` : `<i class="fa-solid fa-truck-loading" style="opacity:0.3"></i>`}
                    </div>
                    ${s.name}
                  </div>
                </td>
                <td data-label="Contact Person">${s.contact || '-'}</td>
                <td data-label="Phone">${s.phone || '-'}</td>
                <td>
                  <div style="display:flex;gap:4px">
                    ${canManage ? `
                      <button class="btn btn-ghost btn-sm edit-btn" data-id="${s.id}"><i class="fa-solid fa-pen"></i></button>
                      <button class="btn btn-ghost btn-sm delete-btn" data-id="${s.id}" style="color:var(--danger)"><i class="fa-solid fa-trash-can"></i></button>
                    ` : `
                      <span class="text-muted" style="font-size:11px">No Action</span>
                    `}
                  </div>
                </td>
              </tr>
            `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    renderPagination(totalPages, container);

    const selectAllEl = document.getElementById('selectAllSuppliers');
    if (selectAllEl) {
      selectAllEl.indeterminate = someInPageSelected && !allInPageSelected;
      selectAllEl.onclick = async (e) => {
        if (e.target.checked) {
          paginatedSuppliers.forEach(p => selectedIds.add(String(p.id)));
        } else {
          paginatedSuppliers.forEach(p => selectedIds.delete(String(p.id)));
        }
        await renderSuppliers(container);
      };
    }

    wrap.querySelectorAll('.supplier-select').forEach(cb => {
      cb.onclick = async (e) => {
        const id = String(cb.dataset.id);
        if (cb.checked) selectedIds.add(id);
        else selectedIds.delete(id);
        await renderSuppliers(container);
        e.stopPropagation();
      };
    });

    wrap.querySelectorAll('.edit-btn').forEach(btn => {
      btn.onclick = async () => {
        const s = suppliers.find(x => x.id === btn.dataset.id);
        await openSupplierForm(s, container);
      };
    });
    wrap.querySelectorAll('.delete-btn').forEach(btn => {
      btn.onclick = () => {
        const s = suppliers.find(x => x.id === btn.dataset.id);
        openModal({
          title: 'Delete Supplier',
          body: `<p>Are you sure you want to delete supplier <b>${s.name}</b>?</p>`,
          footer: `
            <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
            <button class="btn btn-danger" id="confirmDeleteSupplierBtn">Delete</button>
          `
        });
        document.getElementById('confirmDeleteSupplierBtn').onclick = async () => {
          await deleteSupplier(s.id);
          showToast('Supplier deleted', 'success');
          closeModal();
          await renderSuppliers(container);
        };
      };
    });
  };

  await renderTable();
  
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
        filterCard.style.maxHeight = '500px';
        filterCard.style.padding = '16px';
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

  if (document.getElementById('addSupBtn')) {
    document.getElementById('addSupBtn').onclick = () => openSupplierForm(null, container);
  }

  document.getElementById('supSearch').oninput = async (e) => {
    searchQ = e.target.value;
    currentPage = 1;
    await renderSuppliers(container);
  };

  initDateRangePicker('sup-date-range', defaultStart, defaultEnd, async (start, end) => {
    filterStartDate = start;
    filterEndDate = end;
    currentPage = 1;
    await renderSuppliers(container);
  });
}

async function renderBulkActionsBar(container) {
  const area = document.getElementById('bulkActionsArea');
  if (!area) return;

  if (selectedIds.size === 0) {
    area.innerHTML = '';
    return;
  }

  const canManage = await hasPermission('products:manage');
  area.innerHTML = `
    <div class="bulk-actions-bar">
      <div class="bulk-actions-info">
        <i class="fa-solid fa-square-check"></i> ${selectedIds.size} suppliers selected
      </div>
      <div class="flex gap-8">
        <button class="btn btn-sm btn-ghost" id="exportSelectedBtn" style="color:#fff; border-color:rgba(255,255,255,0.3)">
          <i class="fa-solid fa-file-csv"></i> Export CSV
        </button>
        ${canManage ? `
          <button class="btn btn-sm btn-danger" id="bulkDeleteBtn">
            <i class="fa-solid fa-trash"></i> Delete Selected
          </button>
        ` : ''}
        <button class="btn btn-sm" id="clearSelectionBtn" style="background:rgba(255,255,255,0.2);color:#fff">
          Cancel
        </button>
      </div>
    </div>
  `;

  document.getElementById('exportSelectedBtn').onclick = () => {
    showToast('Export feature coming soon for suppliers', 'info');
  };
  
  const bulkDel = document.getElementById('bulkDeleteBtn');
  if(bulkDel) {
    bulkDel.onclick = () => {
      openModal({
        title: 'Bulk Delete',
        body: `<p>Are you sure you want to delete ${selectedIds.size} suppliers?</p>`,
        footer: `
          <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
          <button class="btn btn-danger" id="confirmBulkDeleteBtn">Delete All</button>
        `
      });
      document.getElementById('confirmBulkDeleteBtn').onclick = async () => {
        for (const id of selectedIds) {
          await deleteSupplier(id);
        }
        selectedIds.clear();
        closeModal();
        showToast('Suppliers deleted', 'success');
        await renderSuppliers(container);
      };
    };
  }
  
  document.getElementById('clearSelectionBtn').onclick = async () => {
    selectedIds.clear();
    await renderSuppliers(container);
  };
}

function renderPagination(totalPages, container) {
  const pagArea = document.getElementById('paginationArea');
  if (!pagArea) return;

  let html = `
    <div class="pagination-bar">
      <span>Showing page <b>${currentPage}</b> of <b>${totalPages}</b></span>
      <div class="pagination-controls">
        <button class="pagination-btn" id="prevPage" ${currentPage === 1 ? 'disabled' : ''}>
          <i class="fa-solid fa-chevron-left"></i>
        </button>
  `;

  for (let i = 1; i <= totalPages; i++) {
    if (totalPages > 5 && Math.abs(i - currentPage) > 2 && i !== 1 && i !== totalPages) {
      if (i === 2 || i === totalPages - 1) html += `<span style="padding: 0 4px">...</span>`;
      continue;
    }
    html += `<button class="pagination-btn ${i === currentPage ? 'active' : ''} page-num-btn" data-page="${i}">${i}</button>`;
  }

  html += `
        <button class="pagination-btn" id="nextPage" ${currentPage === totalPages ? 'disabled' : ''}>
          <i class="fa-solid fa-chevron-right"></i>
        </button>
      </div>
    </div>
  `;

  pagArea.innerHTML = html;

  document.getElementById('prevPage').onclick = async () => {
    if (currentPage > 1) {
      currentPage--;
      await renderSuppliers(container);
    }
  };
  document.getElementById('nextPage').onclick = async () => {
    if (currentPage < totalPages) {
      currentPage++;
      await renderSuppliers(container);
    }
  };
  pagArea.querySelectorAll('.page-num-btn').forEach(btn => {
    btn.onclick = async () => {
      currentPage = parseInt(btn.dataset.page);
      await renderSuppliers(container);
    };
  });
}

export async function openSupplierForm(sup = null, container = null) {
  const isEdit = !!sup;
  openModal({
    title: isEdit ? `<i class="fa-solid fa-pen-to-square mr-8"></i> Edit Supplier` : `<i class="fa-solid fa-truck-fast mr-8"></i> Add New Supplier`,
    body: `
      <!-- Supplier Profile Header -->
      <div style="margin-bottom: 24px; padding: 20px; background: var(--bg-elevated); border-radius: var(--radius); border: 1px solid var(--border)">
         <div style="display:flex; gap:24px; align-items:center">
            <div style="position:relative">
              <div id="sImagePreview" style="width:80px; height:80px; border-radius:12px; background:var(--bg-app); border:2px solid var(--border); display:flex; align-items:center; justify-content:center; overflow:hidden; box-shadow: var(--shadow-sm)">
                ${sup?.image ? '<img src="' + sup.image + '" style="width:100%;height:100%;object-fit:cover" />' : '<i class="fa-solid fa-truck-field" style="font-size:32px; opacity:0.2"></i>'}
              </div>
              <button class="btn btn-icon btn-sm" onclick="document.getElementById('sImageFile').click()" style="position:absolute; bottom:-8px; right:-8px; background:var(--primary); color:white; border-radius:50%; width:28px; height:28px; border: 2px solid var(--bg-modal)">
                <i class="fa-solid fa-camera fa-xs"></i>
              </button>
              <input type="file" id="sImageFile" accept="image/*" style="display:none" />
            </div>
            <div style="flex:1">
               <div class="form-group mb-0">
                  <label class="form-label required">Supplier Company Name</label>
                  <div class="search-input-wrap">
                    <i class="fa-solid fa-building"></i>
                    <input class="form-input" id="sName" placeholder="Enter company name" value="${sup?.name || ''}" style="font-weight:700; font-size:16px" />
                  </div>
               </div>
               <button class="btn btn-ghost btn-xs mt-8" id="removeSupImgBtn" style="color:var(--danger); ${sup?.image ? '' : 'display:none'}"><i class="fa-solid fa-trash mr-4"></i> Remove Logo</button>
            </div>
         </div>
         <input type="hidden" id="sImageBase64" value="${sup?.image || ''}" />
      </div>

      <div class="form-grid">
        <div class="form-group">
          <label class="form-label">Contact Person</label>
          <div class="search-input-wrap">
            <i class="fa-solid fa-user-tie"></i>
            <input class="form-input" id="sContact" placeholder="e.g. John Doe" value="${sup?.contact || ''}" style="padding-left:36px" />
          </div>
        </div>

        <div class="form-group">
          <label class="form-label required">Phone Number</label>
          <div class="search-input-wrap">
            <i class="fa-solid fa-phone"></i>
            <input class="form-input" id="sPhone" placeholder="10-digit mobile" value="${sup?.phone || ''}" style="padding-left:36px" />
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">GSTIN Number</label>
          <div class="search-input-wrap">
            <i class="fa-solid fa-id-card"></i>
            <input class="form-input" id="sGstin" placeholder="15-digit GSTIN" value="${sup?.gstin || ''}" style="padding-left:36px; text-transform:uppercase" />
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Classification</label>
          <div class="search-input-wrap">
            <i class="fa-solid fa-tags"></i>
            <select class="form-select" id="sType" style="padding-left:36px">
              <option value="Regular" ${sup?.type === 'Regular' ? 'selected' : ''}>Regular Taxpayer</option>
              <option value="Composition" ${sup?.type === 'Composition' ? 'selected' : ''}>Composition Dealer</option>
              <option value="Unregistered" ${sup?.type === 'Unregistered' ? 'selected' : ''}>Unregistered Dealer</option>
            </select>
          </div>
        </div>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="saveSupBtn" style="min-width: 150px">
        <i class="fa-solid fa-floppy-disk mr-8"></i> ${isEdit ? 'Update Supplier' : 'Save Supplier'}
      </button>
    `
  });

  // Image Logic
  const imgInput = document.getElementById('sImageFile');
  const preview = document.getElementById('sImagePreview');
  const base64Input = document.getElementById('sImageBase64');
  const removeBtn = document.getElementById('removeSupImgBtn');

  imgInput.onchange = async (e) => {
    try {
      const { MediaService } = await import('../services/MediaService.js');
      const base64 = await MediaService.handleImageUpload(e);
      if (base64) {
        base64Input.value = base64;
        preview.innerHTML = `<img src="${base64}" style="width:100%;height:100%;object-fit:cover" />`;
        removeBtn.style.display = 'inline-flex';
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  removeBtn.onclick = () => {
    base64Input.value = '';
    preview.innerHTML = `<i class="fa-solid fa-truck-loading" style="opacity:0.3"></i>`;
    imgInput.value = '';
    removeBtn.style.display = 'none';
  };

  document.getElementById('saveSupBtn').onclick = async () => {
    const name = document.getElementById('sName').value.trim();
    const phone = document.getElementById('sPhone').value.trim();
    const gstin = document.getElementById('sGstin').value.trim();

    if (!name) { showToast('Supplier Name is required', 'error'); return; }
    if (!phone) { showToast('Phone Number is required', 'error'); return; }

    // Phone validation (10 digits)
    if (!/^\d{10}$/.test(phone)) {
      showToast('Invalid Phone: 10 digits required', 'error');
      return;
    }

    // GSTIN validation (optional, but 15 chars if provided)
    if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin.toUpperCase())) {
      showToast('Invalid GSTIN Format (e.g. 33AAAAA0000A1Z5)', 'error');
      return;
    }

    await saveSupplier({
      ...sup,
      name,
      phone,
      image: base64Input.value,
      gstin: gstin.toUpperCase(),
      type: document.getElementById('sType').value,
      contact: document.getElementById('sContact').value.trim()
    });

    showToast('Supplier saved!', 'success');
    closeModal();
    if (container) await renderSuppliers(container);
  };
}
