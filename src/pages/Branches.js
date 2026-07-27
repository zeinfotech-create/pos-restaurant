import { getBranches, saveBranch, getBranchRegisters, saveBranchRegister, deleteBranchRegister, write, KEYS, read, getCurrentUser, getCurrentBranch, deleteBranch, hasPermission, getSession, saveSession } from '../db.js';
import { openModal, closeModal } from '../components/Modal.js';
import { showToast } from '../components/Toast.js';
import { initDateRangePicker } from '../utils/dateRangeHelper.js';
import { store } from '../store.js';
import { paginate, renderPaginationBar } from '../utils/pagination.js';

const BRANCHES_PAGE_SIZE = 10;

export async function renderBranches(container) {
  const branches = (await getBranches()).sort((a,b) => {
    const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    if (timeB !== timeA) return timeB - timeA;
    return String(b.id).localeCompare(String(a.id));
  });

  const canManageSettings = await hasPermission('settings:manage');
  const limits = window.syncEngine?.getLimits() || { maxBranches: 1 };
  const canAdd = branches.length < limits.maxBranches;

  // Filter state
  let searchQ = '';
  let statusFilter = 'All';
  let startDate = null;
  let endDate = null;
  let branchPage = 1;
  const restrictedIds = new Set(branches.slice(limits.maxBranches).map(b => b.id));

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Branch Management</h1>
        <p class="page-subtitle">Add and manage your store locations</p>
      </div>
      ${canManageSettings ? `
        <button class="btn btn-primary" id="addBranchBtn" ${!canAdd ? 'disabled style="opacity:0.5; cursor:not-allowed"' : ''}>
          <i class="fa-solid fa-plus"></i> Add Branch
        </button>
      ` : ''}
    </div>

    <div class="mb-16" id="filterCard" style="transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1); overflow:visible">
      <div class="data-mgmt-bar products-filter-stack p-16">
        <div class="search-input-wrap">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input class="form-input" id="branchSearch" placeholder="Search by name, address, or phone..." value="${searchQ || ''}" />
        </div>
        
        <div class="filter-group">
          <label class="filter-label">Status</label>
          <select class="form-select" id="branchStatusFilter">
            <option value="All">All Status</option>
            <option value="Active">Active</option>
            <option value="Locked">Locked</option>
          </select>
        </div>

        <div class="filter-group" style="flex: 1.5">
          <label class="filter-label">Created Range</label>
          <div class="date-picker-group">
            <i class="fa-solid fa-calendar-alt"></i>
            <input type="text" id="branch-date-range" class="form-input-clean" style="width:100%" readonly />
          </div>
        </div>

      </div>
    </div>

    <div class="card">
      <div class="table-wrap">
        <table class="responsive-table">
          <thead>
            <tr>
              <th>Branch</th>
              <th>Address</th>
              <th>Phone</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="branchTableBody"></tbody>
        </table>
      </div>
      <div id="branchPagination"></div>
    </div>
  `;


  async function renderBranchRows(items) {
    const canEditBranch = await hasPermission('settings:branches');
    const canManageRegs = await hasPermission('settings:registers');
    const canDeleteBranch = await hasPermission('settings:manage');

    const rows = [];
    for (let i = 0; i < items.length; i++) {
      const b = items[i];
      const restricted = restrictedIds.has(b.id);
      const branchRegs = (await getBranchRegisters(b.id)).length;
      
      rows.push(`
        <tr style="${restricted ? 'opacity:0.6' : ''}">
          <td data-label="Branch" class="font-semibold">
            <div style="display:flex;align-items:center;gap:12px;justify-content:flex-start">
              <div style="width:32px;height:32px;border-radius:8px;background:var(--bg-elevated);display:flex;align-items:center;justify-content:center;overflow:hidden;border:1px solid var(--border)">
                ${b.image ? `<img src="${b.image}" style="width:100%;height:100%;object-fit:cover" />` : `<i class="fa-solid fa-store" style="opacity:0.3"></i>`}
              </div>
              <div>
                ${b.name}
                ${restricted ? '<span style="font-size:9px; background:var(--warning); color:black; padding:2px 6px; border-radius:4px; font-weight:700; margin-left:8px">LOCKED</span>' : ''}
                ${b.isMainBranch ? '<span style="font-size:9px; background:var(--primary-light); color:var(--primary); padding:2px 6px; border-radius:4px; font-weight:700; margin-left:8px">MAIN</span>' : ''}
              </div>
            </div>
          </td>
          <td data-label="Address">${b.address || ''}</td>
          <td data-label="Phone">${b.phone || ''}</td>
          <td>
            <div class="flex gap-4">
              ${canEditBranch && !b.isMainBranch ? `
                <button class="btn btn-ghost btn-sm edit-btn" data-id="${b.id}" ${restricted ? 'disabled style="opacity:0.5; cursor:not-allowed"' : ''} title="Edit Branch"><i class="fa-solid fa-pen"></i></button>
              ` : ''}
              ${canManageRegs ? `
                <button class="btn btn-ghost btn-sm regs-btn" data-id="${b.id}" ${restricted ? 'disabled style="opacity:0.5; cursor:not-allowed"' : ''} title="Manage Registers">
                  <i class="fa-solid fa-cash-register"></i> Registers
                  ${branchRegs > 0 ? `<span style="background:var(--primary); color:white; padding:1px 6px; border-radius:10px; font-size:10px; font-weight:700; margin-left:6px">${branchRegs}</span>` : ''}
                </button>
              ` : ''}
              ${canDeleteBranch && !b.isMainBranch ? `
                <button class="btn btn-ghost btn-sm delete-btn" data-id="${b.id}" ${restricted ? 'disabled style="opacity:0.5; cursor:not-allowed"' : ''} style="color:var(--danger)" title="Delete Branch"><i class="fa-solid fa-trash-can"></i></button>
              ` : ''}
              ${!(canEditBranch && !b.isMainBranch) && !canManageRegs && !(canDeleteBranch && !b.isMainBranch) ? `
                <span class="text-muted" style="font-size:11px">No Action</span>
              ` : ''}
            </div>
          </td>
        </tr>
      `);
    }
    return rows.length ? rows.join('') : '<tr><td colspan="4" style="text-align:center; padding:32px; opacity:0.5">No branches found matching your filters.</td></tr>';
  }

  function attachEvents() {
    container.querySelectorAll('.edit-btn').forEach(btn => {
      btn.onclick = async () => {
        const b = branches.find(x => String(x.id) === String(btn.dataset.id));
        await openBranchForm(b);
      };
    });

    container.querySelectorAll('.regs-btn').forEach(btn => {
      btn.onclick = async () => {
        const b = branches.find(x => String(x.id) === String(btn.dataset.id));
        await openRegisterList(b);
      };
    });

    container.querySelectorAll('.delete-btn').forEach(btn => {
      btn.onclick = () => {
        const b = branches.find(x => String(x.id) === String(btn.dataset.id));
        confirmDelete(b);
      };
    });

    const addBtn = container.querySelector('#addBranchBtn');
    if (addBtn) {
      console.log('[Branches] Binding click event to #addBranchBtn');
      addBtn.onclick = () => {
        console.log('[Branches] #addBranchBtn clicked!');
        openBranchForm();
      };
    } else {
      console.log('[Branches] #addBranchBtn NOT found in container!');
    }
  }

  const applyFilters = async () => {
    const filtered = branches.filter((b) => {
      const matchSearch = !searchQ || b.name.toLowerCase().includes(searchQ) || (b.address && b.address.toLowerCase().includes(searchQ)) || (b.phone && b.phone.toLowerCase().includes(searchQ));

      const restricted = restrictedIds.has(b.id);
      const matchStatus = statusFilter === 'All' || (statusFilter === 'Active' && !restricted) || (statusFilter === 'Locked' && restricted);

      const matchDate = (!startDate || !endDate) || (() => {
        const d = (b.createdAt || new Date().toISOString()).split('T')[0];
        return d >= startDate && d <= endDate;
      })();

      return matchSearch && matchStatus && matchDate;
    });

    const { pageItems, page, totalPages } = paginate(filtered, branchPage, BRANCHES_PAGE_SIZE);
    branchPage = page;

    const tableBody = document.getElementById('branchTableBody');
    if (tableBody) tableBody.innerHTML = await renderBranchRows(pageItems);
    attachEvents();

    renderPaginationBar(document.getElementById('branchPagination'), {
      page, totalPages, onChange: (p) => { branchPage = p; applyFilters(); }
    });
  };

  document.getElementById('branchSearch').oninput = (e) => {
    searchQ = e.target.value.toLowerCase().trim();
    branchPage = 1;
    applyFilters();
  };

  document.getElementById('branchStatusFilter').onchange = (e) => {
    statusFilter = e.target.value;
    branchPage = 1;
    applyFilters();
  };

  // Call attachEvents synchronously so that buttons (like Add Branch) have their event listeners bound immediately before any async yielding
  attachEvents();
  applyFilters();

  initDateRangePicker('branch-date-range', null, null, (start, end) => {
    startDate = start;
    endDate = end;
    branchPage = 1;
    applyFilters();
  });

  function confirmDelete(b) {
    if (b.isMainBranch) {
      showToast('The main branch created at install cannot be deleted!', 'error');
      return;
    }

    openModal({
      title: 'Delete Branch',
      body: `
        <div style="text-align:center; padding: 20px 0;">
          <i class="fa-solid fa-building-circle-exclamation text-danger" style="font-size: 48px; margin-bottom: 24px;"></i>
          <h3 style="margin-bottom:8px">Confirm Delete</h3>
          <p style="color:var(--text-muted); font-size:14px; margin-bottom:32px">Are you sure you want to delete branch <b>${b.name}</b>? All associated data might be lost. This action cannot be undone.</p>
          
          <div style="display:flex; gap:16px; justify-content:center;">
            <button class="btn btn-ghost" onclick="closeModal()" style="flex:1">Cancel</button>
            <button class="btn btn-primary" id="confirmDeleteBranchBtn" style="flex:1; background:var(--danger); border-color:var(--danger)">Delete</button>
          </div>
        </div>
      `,
      footer: ''
    });

    document.getElementById('confirmDeleteBranchBtn').onclick = async () => {
      const allBranches = await getBranches();
      const currentBranch = await getCurrentBranch();

      if (allBranches.length <= 1) {
        showToast('Cannot delete the last remaining branch. The system must have at least one branch.', 'error');
        closeModal();
        return;
      }

      if (b.id === currentBranch?.id) {
        showToast('Cannot delete the currently active branch. Please switch to another branch first.', 'error');
        closeModal();
        return;
      }

      await deleteBranch(b.id);
      showToast('Branch deleted successfully', 'success');
      closeModal();
      await renderBranches(container);
    };
  }

  attachEvents();

}

async function openBranchForm(branch = null) {
  if (branch?.isMainBranch) {
    showToast('The main branch created at install cannot be edited!', 'error');
    return;
  }
  const isEdit = !!branch;
  openModal({
    title: isEdit ? `<i class="fa-solid fa-pen-to-square mr-8"></i> Edit Branch` : `<i class="fa-solid fa-building-circle-plus mr-8"></i> Add New Branch`,
    body: `
      <!-- Branch Profile Header -->
      <div style="margin-bottom: 24px; padding: 20px; background: var(--bg-elevated); border-radius: var(--radius); border: 1px solid var(--border)">
         <div style="display:flex; gap:24px; align-items:center">
            <div style="position:relative">
              <div id="bImagePreview" style="width:80px; height:80px; border-radius:12px; background:var(--bg-app); border:2px solid var(--border); display:flex; align-items:center; justify-content:center; overflow:hidden; box-shadow: var(--shadow-sm)">
                ${branch?.image ? '<img src="' + branch.image + '" style="width:100%;height:100%;object-fit:cover" />' : '<i class="fa-solid fa-store" style="font-size:32px; opacity:0.2"></i>'}
              </div>
              <button class="btn btn-icon btn-sm" onclick="document.getElementById('bImageFile').click()" style="position:absolute; bottom:-8px; right:-8px; background:var(--primary); color:white; border-radius:50%; width:28px; height:28px; border: 2px solid var(--bg-modal)">
                <i class="fa-solid fa-camera fa-xs"></i>
              </button>
              <input type="file" id="bImageFile" accept="image/*" style="display:none" />
            </div>
            <div style="flex:1">
               <div class="form-group mb-0">
                  <label class="form-label required">Branch Name</label>
                  <div class="search-input-wrap">
                    <i class="fa-solid fa-shop"></i>
                    <input class="form-input" id="bName" placeholder="e.g. Mumbai Station" value="${branch?.name || ''}" style="font-weight:700; font-size:16px" />
                  </div>
               </div>
               <button class="btn btn-ghost btn-xs mt-8" id="removeBranchImgBtn" style="color:var(--danger); ${branch?.image ? '' : 'display:none'}"><i class="fa-solid fa-trash mr-4"></i> Remove Logo</button>
            </div>
         </div>
         <input type="hidden" id="bImageBase64" value="${branch?.image || ''}" />
      </div>

      <div class="form-grid">
        <div class="form-group" style="grid-column: span 2">
          <label class="form-label">Physical Address</label>
          <div class="search-input-wrap">
            <i class="fa-solid fa-location-dot"></i>
            <input class="form-input" id="bAddress" placeholder="Full store address" value="${branch?.address || ''}" style="padding-left:36px" />
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Contact Number</label>
          <div class="search-input-wrap">
            <i class="fa-solid fa-phone"></i>
            <input class="form-input" id="bPhone" placeholder="Branch phone line" value="${branch?.phone || ''}" style="padding-left:36px" />
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Branch Status</label>
          <div style="background:var(--bg-app); padding:8px 12px; border-radius:10px; border:1px solid var(--border); display:flex; align-items:center; gap:8px">
            <i class="fa-solid fa-circle-check text-success"></i>
            <span style="font-size:13px; font-weight:600">Always Active</span>
          </div>
        </div>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" onclick="closeModal()">Close</button>
      <button class="btn btn-primary" id="saveBranchBtn" style="min-width: 150px">
        <i class="fa-solid fa-floppy-disk mr-8"></i> ${isEdit ? 'Update Branch' : 'Create Branch'}
      </button>
    `
  });

  // Image Logic
  const imgInput = document.getElementById('bImageFile');
  const preview = document.getElementById('bImagePreview');
  const base64Input = document.getElementById('bImageBase64');
  const removeBtn = document.getElementById('removeBranchImgBtn');

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
    preview.innerHTML = `<i class="fa-solid fa-store" style="opacity:0.3"></i>`;
    imgInput.value = '';
    removeBtn.style.display = 'none';
  };

  document.getElementById('saveBranchBtn').onclick = async () => {
    const name = document.getElementById('bName').value.trim();
    if (!name) { showToast('Name is required', 'error'); return; }

    const savedBranch = await saveBranch({
      ...branch,
      name,
      image: base64Input.value,
      address: document.getElementById('bAddress').value,
      phone: document.getElementById('bPhone').value
    });

    // getCurrentBranch()/store.branch both ultimately come from a COPY of
    // the branch embedded in the session record at login time (see
    // setSession() in db.js) — editing the `branches` store alone never
    // touches that embedded copy, so the sidebar (and anywhere else reading
    // store.branch) would keep showing the pre-edit name forever, even after
    // a reload, unless the session's own copy is refreshed too.
    if (store.branch?.id === savedBranch.id) {
      const sess = await getSession();
      if (sess) {
        sess.branch = savedBranch;
        await saveSession(sess);
      }
      store.branch = savedBranch;
      // renderSidebar() only runs once at boot (or on a license-status
      // change) — it does NOT re-run on ordinary navigation, so without this
      // the sidebar's branch name would stay stale even after store.branch
      // is updated, until the next full app reload.
      window.renderSidebar?.();
    }

    showToast('Branch saved!', 'success');
    closeModal();
    window.navigate('branches');
  };
}

async function openRegisterList(branch) {
  const regs = await getBranchRegisters(branch.id);
  const limits = window.syncEngine?.getLimits() || { maxRegistersPerBranch: 1 };
  const isOverLimit = regs.length >= limits.maxRegistersPerBranch;

  openModal({
    title: `Registers: ${branch.name}`,
    body: `
      <div style="margin-bottom:16px; display:flex; justify-content:space-between; align-items:center">
        <h3 style="font-size:14px; opacity:0.7">Defined Registers</h3>
        <button class="btn btn-primary btn-sm" id="addNewRegBtn" ${isOverLimit ? 'disabled title="Register limit reached"' : ''}>
          <i class="fa-solid fa-plus"></i> Add New Register
        </button>
      </div>

      ${isOverLimit ? `
        <div style="background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.2); padding:10px; border-radius:8px; margin-bottom:16px; font-size:12px; color:#ef4444; display:flex; align-items:center; gap:10px;">
          <i class="fa-solid fa-circle-exclamation"></i>
          <div><b>Limit Reached:</b> Your current plan allows <b>${limits.maxRegistersPerBranch}</b> register per branch. Upgrade to Premium for more.</div>
        </div>
      ` : ''}

      <div class="table-wrap">
        <table class="responsive-table">
          <thead>
            <tr>
              <th>Register Name</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${regs.length === 0 ? `<tr><td colspan="3" style="text-align:center;padding:20px;opacity:0.5">No registers defined for this branch.</td></tr>` :
        regs.map((r, idx) => {
          const restricted = idx >= limits.maxRegistersPerBranch;
          return `
                <tr style="${restricted ? 'opacity:0.5; background:rgba(0,0,0,0.05)' : ''}">
                  <td data-label="Register Name">
                    <div style="display:flex; align-items:center; gap:8px">
                      ${r.name}
                      ${restricted ? '<span style="font-size:9px; background:var(--warning); color:black; padding:2px 6px; border-radius:4px; font-weight:700">LOCKED</span>' : ''}
                    </div>
                  </td>
                  <td data-label="Status">
                     ${restricted ? '<span style="color:var(--danger); font-size:11px">Upgrade to Use</span>' : '<span style="color:var(--success); font-size:11px">Available</span>'}
                  </td>
                  <td>
                    <button class="btn btn-ghost btn-sm del-reg-btn" data-id="${r.id}"><i class="fa-solid fa-trash text-danger"></i></button>
                  </td>
                </tr>
              `;
        }).join('')}
          </tbody>
        </table>
      </div>
    `,
    footer: `<button class="btn btn-ghost" onclick="closeModal()">Close</button>`
  });

  document.getElementById('addNewRegBtn').onclick = async () => {
    await openAddRegisterModal(branch);
  };

  document.querySelectorAll('.del-reg-btn').forEach(btn => {
    btn.onclick = () => {
      const r = regs.find(x => x.id === btn.dataset.id);

      openModal({
        title: 'Delete Register',
        body: `
          <div style="text-align:center; padding: 20px 0;">
            <i class="fa-solid fa-trash-can text-danger" style="font-size: 48px; margin-bottom: 24px;"></i>
            <h3 style="margin-bottom:8px">Confirm Delete</h3>
            <p style="color:var(--text-muted); font-size:14px; margin-bottom:32px">Are you sure you want to delete register <b>${r.name}</b>?</p>
            
            <div style="display:flex; gap:16px; justify-content:center;">
              <button class="btn btn-ghost" onclick="closeModal()" style="flex:1">Cancel</button>
              <button class="btn btn-primary" id="confirmDeleteRegBtn" style="flex:1; background:var(--danger); border-color:var(--danger)">Delete</button>
            </div>
          </div>
        `,
        footer: ''
      });

      document.getElementById('confirmDeleteRegBtn').onclick = async () => {
        await deleteBranchRegister(r.id);
        showToast('Register deleted', 'success');
        closeModal();
        await openRegisterList(branch); // Refresh
      };
    };
  });
}

async function openAddRegisterModal(branch) {
  const currentRegs = await getBranchRegisters(branch.id);
  const allRegs = await getBranchRegisters();

  // Find names used in other branches but not in this one
  const currentNames = new Set(currentRegs.map(r => r.name.toLowerCase()));
  const suggestedNames = [...new Set(allRegs
    .filter(r => r.branchId !== branch.id)
    .map(r => r.name)
  )].filter(name => !currentNames.has(name.toLowerCase()));

  openModal({
    title: `Add Register: ${branch.name}`,
    body: `
      <div class="form-group">
        <label class="form-label">Register Name *</label>
        <input class="form-input" id="newRegName" placeholder="e.g. Counter 1">
      </div>
      
      ${suggestedNames.length > 0 ? `
        <div style="margin-top:16px">
          <label class="form-label" style="font-size:12px; opacity:0.7">Suggestions from other branches:</label>
          <div class="flex flex-wrap gap-2" style="margin-top:8px">
            ${suggestedNames.map(name => `
              <button class="btn btn-ghost btn-sm suggestion-tag" data-name="${name}" 
                style="background:rgba(99,102,241,0.1); border:1px solid rgba(99,102,241,0.2); padding:4px 10px; font-size:12px; border-radius:100px">
                ${name}
              </button>
            `).join('')}
          </div>
        </div>
      ` : ''}
    `,
    footer: `
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="confirmAddRegBtn">Add Register</button>
    `
  });

  const nameInput = document.getElementById('newRegName');

  document.querySelectorAll('.suggestion-tag').forEach(btn => {
    btn.onclick = () => {
      nameInput.value = btn.dataset.name;
      nameInput.focus();
    };
  });

  document.getElementById('confirmAddRegBtn').onclick = async () => {
    const name = nameInput.value.trim();
    if (!name) { showToast('Name is required', 'error'); return; }

    await saveBranchRegister({ branchId: branch.id, name });
    showToast('Register added!', 'success');
    closeModal();
    await openRegisterList(branch); // Refresh parent list
  };
}
