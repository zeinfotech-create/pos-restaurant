import { getStaff, saveStaff, deleteStaff, getStaffIncentives, getCurrentUser, hasPermission } from '../db.js';
import { openModal, closeModal } from '../components/Modal.js';
import { showToast } from '../components/Toast.js';
import { store } from '../store.js';
import { escapeHtml } from '../utils/escapeHtml.js';

let currentPage = 1;
const itemsPerPage = 10;
let selectedIds = new Set();

export async function renderStaff(container) {
  const branchId = store.branch?.id || 'b1';
  const staff = (await getStaff(branchId)).sort((a,b) => {
    const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    if (timeB !== timeA) return timeB - timeA;
    return String(b.id).localeCompare(String(a.id));
  });

  const totalItems = staff.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * itemsPerPage;
  const paginatedStaff = staff.slice(start, start + itemsPerPage);

  const paginatedIds = paginatedStaff.map(s => String(s.id));
  const someInPageSelected = paginatedIds.some(id => selectedIds.has(id));
  const allInPageSelected = paginatedIds.length > 0 && paginatedIds.every(id => selectedIds.has(id));

  container.innerHTML = `
    <div class="page-header">
      <div class="page-title">Staff Management</div>
      ${(await hasPermission('staff:manage')) ? `
        <button class="btn btn-primary" id="addStaffBtn">
          <i class="fa-solid fa-plus"></i> Add Staff Member
        </button>
      ` : ''}
    </div>

    <div id="bulkActionsArea"></div>
    <div id="staffTableArea"></div>
    <div id="paginationArea"></div>
  `;

  // Render the table area
  const renderTable = async () => {
    await renderBulkActionsBar(container);
    const wrap = document.getElementById('staffTableArea');
    if (!wrap) return;

    const canManage = await hasPermission('staff:manage');
    const canDelete = await hasPermission('staff:delete');
    const incentivesData = await getStaffIncentives(branchId);

    wrap.innerHTML = `
      <div class="card p-0">
        <div class="table-wrap">
          <table class="responsive-table">
            <thead>
              <tr>
                <th class="th-checkbox"><input type="checkbox" class="row-checkbox" id="selectAllStaff" ${allInPageSelected ? 'checked' : ''} /></th>
                <th>Name</th>
                <th>Specialization</th>
                <th>Commission (%)</th>
                <th>Earnings (Mtd)</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="staffTableBody">
              ${paginatedStaff.length === 0 ? '<tr><td colspan="6" style="text-align:center;padding:40px;opacity:0.5">No staff members added yet</td></tr>' :
        paginatedStaff.map(s => {
          const incentives = incentivesData.filter(i => i.staffId === s.id);
          const mtdEarnings = incentives.reduce((sum, i) => sum + i.amount, 0);
          return `
            <tr class="${selectedIds.has(String(s.id)) ? 'selected' : ''}" data-id="${s.id}">
              <td class="th-checkbox" data-label="Select">
                <input type="checkbox" class="row-checkbox staff-select" data-id="${s.id}" ${selectedIds.has(String(s.id)) ? 'checked' : ''} />
              </td>
              <td data-label="Name" class="font-bold">
                <div style="display:flex;align-items:center;gap:12px;justify-content:flex-start">
                  <div style="width:32px;height:32px;border-radius:16px;background:var(--bg-elevated);display:flex;align-items:center;justify-content:center;overflow:hidden;border:1px solid var(--border)">
                    ${s.image ? `<img src="${s.image}" style="width:100%;height:100%;object-fit:cover" />` : `<i class="fa-solid fa-user-tie" style="opacity:0.3"></i>`}
                  </div>
                  ${escapeHtml(s.name)}
                </div>
              </td>
              <td data-label="Specialization"><span class="badge badge-primary">${escapeHtml(s.specialization || 'Generalist')}</span></td>
              <td data-label="Commission (%)" class="text-accent font-bold">${s.commissionRate || 0}%</td>
              <td data-label="Earnings" class="text-success font-bold">\u20B9${mtdEarnings.toLocaleString()}</td>
              <td>
                <div class="flex gap-4">
                  ${canManage ? `
                    <button class="btn btn-ghost btn-sm edit-staff-btn" data-id="${s.id}"><i class="fa-solid fa-pen"></i></button>
                  ` : ''}
                  ${canDelete ? `
                    <button class="btn btn-ghost btn-sm text-danger delete-staff-btn" data-id="${s.id}"><i class="fa-solid fa-trash"></i></button>
                  ` : ''}
                </div>
              </td>
            </tr>
          `;
        }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    renderPagination(totalPages, container);

    const selectAllEl = document.getElementById('selectAllStaff');
    if (selectAllEl) {
      selectAllEl.indeterminate = someInPageSelected && !allInPageSelected;
      selectAllEl.onclick = async (e) => {
        if (e.target.checked) paginatedStaff.forEach(p => selectedIds.add(String(p.id)));
        else paginatedStaff.forEach(p => selectedIds.delete(String(p.id)));
        await renderStaff(container);
      };
    }

    wrap.querySelectorAll('.staff-select').forEach(cb => {
      cb.onclick = async (e) => {
        const id = String(cb.dataset.id);
        if (cb.checked) selectedIds.add(id); else selectedIds.delete(id);
        await renderStaff(container);
        e.stopPropagation();
      };
    });

    wrap.querySelectorAll('.edit-staff-btn').forEach(btn => {
      btn.onclick = async () => {
        const s = staff.find(x => x.id === btn.dataset.id);
        await openStaffForm(s, container);
      };
    });

    wrap.querySelectorAll('.delete-staff-btn').forEach(btn => {
      btn.onclick = () => {
        const s = staff.find(x => x.id === btn.dataset.id);
        openModal({
          title: 'Delete Staff Member',
          body: `
            <div style="text-align:center; padding: 20px 0;">
              <i class="fa-solid fa-trash-can text-danger" style="font-size: 48px; margin-bottom: 24px;"></i>
              <h3 style="margin-bottom:8px">Confirm Delete</h3>
              <p style="color:var(--text-muted); font-size:14px; margin-bottom:32px">Are you sure you want to delete staff member <b>${escapeHtml(s.name)}</b>?</p>
              <div style="display:flex; gap:16px; justify-content:center;">
                <button class="btn btn-ghost" onclick="closeModal()" style="flex:1">Cancel</button>
                <button class="btn btn-primary" id="confirmDeleteStaffBtn" style="flex:1; background:var(--danger); border-color:var(--danger)">Delete</button>
              </div>
            </div>
          `,
          footer: ''
        });
        document.getElementById('confirmDeleteStaffBtn').onclick = async () => {
          await deleteStaff(s.id);
          showToast('Staff member removed', 'success');
          closeModal();
          await renderStaff(container);
        };
      };
    });
  };

  await renderTable();

  if (document.getElementById('addStaffBtn')) {
    document.getElementById('addStaffBtn').onclick = () => openStaffForm(null, container);
  }
}

async function renderBulkActionsBar(container) {
  const area = document.getElementById('bulkActionsArea');
  if (!area) return;
  if (selectedIds.size === 0) { area.innerHTML = ''; return; }

  area.innerHTML = `
    <div class="bulk-actions-bar">
      <div class="bulk-actions-info">
        <i class="fa-solid fa-square-check"></i> ${selectedIds.size} staff selected
      </div>
      <div class="flex gap-8">
        ${await hasPermission('staff:delete') ? `
          <button class="btn btn-sm btn-danger" id="bulkDeleteBtn">
            <i class="fa-solid fa-trash"></i> Delete Selected
          </button>
        ` : ''}
        <button class="btn btn-sm" id="clearSelectionBtn" style="background:rgba(255,255,255,0.2);color:#fff">Cancel</button>
      </div>
    </div>
  `;

  const bulkDel = document.getElementById('bulkDeleteBtn');
  if (bulkDel) {
    const branchId = store.branch?.id || 'b1';
    bulkDel.onclick = () => {
      openModal({
        title: 'Bulk Delete',
        body: `<p>Are you sure you want to delete ${selectedIds.size} staff members?</p>`,
        footer: `
          <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
          <button class="btn btn-danger" id="confirmBulkDeleteBtn">Delete All</button>
        `
      });
      document.getElementById('confirmBulkDeleteBtn').onclick = async () => {
        for (const id of selectedIds) {
          await deleteStaff(id);
        }
        selectedIds.clear();
        closeModal();
        showToast('Staff members deleted', 'success');
        await renderStaff(container);
      };
    };
  }
  document.getElementById('clearSelectionBtn').onclick = async () => { selectedIds.clear(); await renderStaff(container); };
}

function renderPagination(totalPages, container) {
  const pagArea = document.getElementById('paginationArea');
  if (!pagArea) return;

  let html = `<div class="pagination-bar"><span>Showing page <b>${currentPage}</b> of <b>${totalPages}</b></span><div class="pagination-controls">
    <button class="pagination-btn" id="prevPage" ${currentPage === 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button>`;

  for (let i = 1; i <= totalPages; i++) {
    if (totalPages > 5 && Math.abs(i - currentPage) > 2 && i !== 1 && i !== totalPages) {
      if (i === 2 || i === totalPages - 1) html += `<span style="padding: 0 4px">...</span>`;
      continue;
    }
    html += `<button class="pagination-btn ${i === currentPage ? 'active' : ''} page-num-btn" data-page="${i}">${i}</button>`;
  }

  html += `<button class="pagination-btn" id="nextPage" ${currentPage === totalPages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button></div></div>`;
  pagArea.innerHTML = html;

  document.getElementById('prevPage').onclick = async () => { if (currentPage > 1) { currentPage--; await renderStaff(container); } };
  document.getElementById('nextPage').onclick = async () => { if (currentPage < totalPages) { currentPage++; await renderStaff(container); } };
  pagArea.querySelectorAll('.page-num-btn').forEach(btn => {
    btn.onclick = async () => { currentPage = parseInt(btn.dataset.page); await renderStaff(container); };
  });
}

async function openStaffForm(staff = null, container = null) {
  const isEdit = !!staff;
  openModal({
    title: isEdit ? `<i class="fa-solid fa-user-pen mr-8"></i> Edit Staff Member` : `<i class="fa-solid fa-user-plus mr-8"></i> Add New Staff Member`,
    body: `
      <form id="staffForm" style="display:flex; flex-direction:column; gap:20px">
        <!-- Photo Section -->
        <div style="padding: 16px; background: var(--bg-elevated); border-radius: var(--radius); border: 1px solid var(--border)">
          <div style="display:flex; gap:20px; align-items:center">
            <div id="stImagePreview" style="width:80px; height:80px; border-radius:50%; background: var(--bg-app); border:2px solid var(--primary); display:flex; align-items:center; justify-content:center; overflow:hidden; box-shadow: var(--shadow-sm)">
              ${staff?.image ? `<img src="${staff.image}" style="width:100%; height:100%; object-fit:cover" />` : `<i class="fa-solid fa-user-tie" style="font-size:32px; opacity:0.2"></i>`}
            </div>
            <div style="flex:1">
              <h4 class="font-bold mb-4" style="font-size:14px">Profile Photo</h4>
              <p class="form-help-text mb-12">Recommended size: 200x200px. Max 2MB.</p>
              <input type="file" id="stImageFile" accept="image/*" style="display:none" />
              <div style="display:flex; gap:8px">
                <button class="btn btn-ghost btn-sm" type="button" onclick="document.getElementById('stImageFile').click()"><i class="fa-solid fa-camera mr-4"></i> Upload Photo</button>
                <button class="btn btn-ghost btn-sm" type="button" id="removeStaffImgBtn" style="color:var(--danger); ${staff?.image ? '' : 'display:none'}"><i class="fa-solid fa-xmark mr-4"></i> Remove</button>
              </div>
            </div>
          </div>
          <input type="hidden" id="stImageBase64" value="${staff?.image || ''}" />
        </div>

        <!-- Form Grid -->
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label required">Full Name</label>
            <div class="search-input-wrap">
              <i class="fa-solid fa-user"></i>
              <input class="form-input" id="stName" value="${staff?.name || ''}" required placeholder="e.g. John Doe" />
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Specialization</label>
            <div class="search-input-wrap">
              <i class="fa-solid fa-scissors"></i>
              <input class="form-input" id="stSpec" value="${staff?.specialization || ''}" placeholder="e.g. Hair Stylist, Massage" />
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Phone Number</label>
            <div class="search-input-wrap">
              <i class="fa-solid fa-phone"></i>
              <input class="form-input" id="stPhone" value="${staff?.phone || ''}" placeholder="e.g. 9876543210" />
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Commission Rate (%)</label>
            <div class="search-input-wrap">
              <i class="fa-solid fa-percent"></i>
              <input type="number" class="form-input" id="stComm" value="${staff?.commissionRate || 0}" placeholder="e.g. 10" min="0" max="100" />
            </div>
            <p class="form-help-text">Percentage staff earns on each assigned sale.</p>
          </div>
        </div>
      </form>
    `,
    footer: `
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="saveStaffBtn" style="min-width: 120px">
        <i class="fa-solid fa-floppy-disk mr-8"></i> Save Changes
      </button>
    `
  });

  // Image Logic
  const imgInput = document.getElementById('stImageFile');
  const preview = document.getElementById('stImagePreview');
  const base64Input = document.getElementById('stImageBase64');
  const removeBtn = document.getElementById('removeStaffImgBtn');

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
    preview.innerHTML = `<i class="fa-solid fa-user-tie" style="opacity:0.3"></i>`;
    imgInput.value = '';
    removeBtn.style.display = 'none';
  };

  document.getElementById('saveStaffBtn').onclick = async () => {
    const name = document.getElementById('stName').value.trim();
    if (!name) return showToast('Name is required', 'error');

    await saveStaff({
      ...staff,
      name,
      image: base64Input.value,
      specialization: document.getElementById('stSpec').value.trim(),
      phone: document.getElementById('stPhone').value.trim(),
      commissionRate: parseFloat(document.getElementById('stComm').value) || 0,
      branchId: store.branch?.id || 'b1'
    });

    closeModal();
    showToast('Staff details saved', 'success');
    if (container) await renderStaff(container);
  };
}
