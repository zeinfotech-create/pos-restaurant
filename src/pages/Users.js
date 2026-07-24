import { getUsers, getBranches, saveUser, deleteUser, getCurrentUser, hasPermission } from '../db.js';
import { openModal, closeModal } from '../components/Modal.js';
import { showToast } from '../components/Toast.js';
import { MediaService } from '../services/MediaService.js';

export async function renderUsers(container) {
  const users = (await getUsers()).sort((a,b) => {
    const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    if (timeB !== timeA) return timeB - timeA;
    return String(b.id).localeCompare(String(a.id));
  });
  const branches = await getBranches();
  const user = await getCurrentUser();

  // Filter state
  let searchQ = '';
  let roleFilter = 'All';
  let branchFilter = 'All';
  let statusFilter = 'All';
  let startDate = null;
  let endDate = null;

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">User Roles</h1>
        <p class="page-subtitle">Manage staff access and permissions</p>
      </div>
      ${await (async () => {
      const limits = window.syncEngine?.getLimits() || { maxUsers: 1 };
      const canAdd = users.length < limits.maxUsers;
      if (await hasPermission('staff:manage')) {
        return `<button class="btn btn-primary" id="addUserBtn" ${!canAdd ? 'disabled style="opacity:0.5; cursor:not-allowed"' : ''}>
                <i class="fa-solid fa-user-plus"></i> Add User
              </button>`;
      }
      return '';
    })()}
    </div>

    <div class="mb-16" id="filterCard" style="transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1); overflow:visible">
      <div class="data-mgmt-bar products-filter-stack p-16">
        <div class="search-input-wrap">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input class="form-input" id="userSearch" placeholder="Search by name or email..." value="${searchQ || ''}" />
        </div>
        
        <div class="filter-group">
          <label class="filter-label">Role</label>
          <select class="form-select" id="roleFilter">
            <option value="All">All Roles</option>
            <option value="Master">Master</option>
            <option value="Admin">Admin</option>
            <option value="Manager">Manager</option>
            <option value="Staff">Staff</option>
            <option value="Custom">Custom</option>
          </select>
        </div>

        <div class="filter-group">
          <label class="filter-label">Branch</label>
          <select class="form-select" id="branchFilter">
            <option value="All">All Branches</option>
            ${branches.map(b => `<option value="${b.id}">${b.name}</option>`).join('')}
          </select>
        </div>

        <div class="filter-group">
          <label class="filter-label">Status</label>
          <select class="form-select" id="statusFilter">
            <option value="All">All Status</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
        </div>

        <div class="filter-group" style="flex: 1.5">
          <label class="filter-label">Created Range</label>
          <div class="date-picker-group">
            <i class="fa-solid fa-calendar-alt"></i>
            <input type="text" id="user-date-range" class="form-input-clean" style="width:100%" readonly />
          </div>
        </div>

      </div>
    </div>

    <div class="card">
      <div class="table-wrap">
        <table class="responsive-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>PIN</th>
              <th>Role</th>
              <th>Branch</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="userTableBody">
            ${await renderUserRows(users)}
          </tbody>
        </table>
      </div>
    </div>
  `;


  async function renderUserRows(items) {
    const limits = window.syncEngine?.getLimits() || { maxUsers: 1 };
    const canManageStaff = await hasPermission('staff:manage');
    
    const rows = [];
    for (const u of items) {
      const uIdx = users.indexOf(u);
      const restricted = u.role !== 'Master' && uIdx >= limits.maxUsers;
      const branchString = (u.branchIds && u.branchIds.length > 0)
        ? u.branchIds.map(bid => branches.find(b => b.id === bid)?.name || 'Unknown').join(', ')
        : 'All';
      
      rows.push(`
               <tr style="${restricted ? 'opacity:0.6' : ''}">
                <td data-label="Name" class="font-semibold">
                  <div style="display:flex;align-items:center;gap:12px;justify-content:flex-start">
                    <div style="width:32px;height:32px;border-radius:16px;background:var(--bg-elevated);display:flex;align-items:center;justify-content:center;overflow:hidden;border:1px solid var(--border)">
                      ${u.image ? `<img src="${u.image}" style="width:100%;height:100%;object-fit:cover" />` : `<i class="fa-solid fa-user-circle" style="opacity:0.3"></i>`}
                    </div>
                    ${u.name}
                    ${restricted ? '<span style="font-size:9px; background:var(--warning); color:black; padding:2px 6px; border-radius:4px; font-weight:700; margin-left:8px">LOCKED</span>' : ''}
                  </div>
                </td>
                <td data-label="Email">${u.email || u.username || '—'}</td>
                <td data-label="PIN" class="font-mono">${u.pin || '----'}</td>
                <td data-label="Role"><span class="badge ${u.role === 'Admin' ? 'badge-primary' : 'badge-ghost'}">${u.role}</span></td>
                <td data-label="Branch">${branchString}</td>
                <td data-label="Status">
                  ${(u.role !== 'Master' && u.role !== 'Admin') ? `
                    <div class="toggle-switch">
                      <input type="checkbox" id="toggle-${u.id}" class="status-toggle" data-id="${u.id}" ${u.isActive !== false ? 'checked' : ''} ${restricted ? 'disabled' : ''}>
                      <label for="toggle-${u.id}" class="toggle-slider"></label>
                      <span style="font-size:11px; margin-left:8px; color:${u.isActive !== false ? 'var(--success)' : 'var(--danger)'}">${u.isActive !== false ? 'Active' : 'Inactive'}</span>
                    </div>
                  ` : `
                    <span class="badge badge-success">Always Active</span>
                  `}
                </td>
                <td>
                  ${canManageStaff && u.role !== 'Master' ? `
                    <div style="display:flex;gap:4px">
                      <button class="btn btn-ghost btn-xs edit-btn" data-id="${u.id}" ${restricted ? 'disabled style="opacity:0.5; cursor:not-allowed"' : ''}><i class="fa-solid fa-pen"></i></button>
                      <button class="btn btn-ghost btn-xs delete-btn" data-id="${u.id}" ${restricted ? 'disabled style="opacity:0.5; cursor:not-allowed"' : ''} style="color:var(--danger)"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                  ` : `
                    <span class="text-muted" style="font-size:11px">No Action</span>
                  `}
                </td>
              </tr>
      `);
    }
    return rows.length ? rows.join('') : '<tr><td colspan="7" style="text-align:center; padding:32px; opacity:0.5">No users found matching your filters.</td></tr>';
  }

  function attachEvents() {
    container.querySelectorAll('.edit-btn').forEach(btn => {
      btn.onclick = async () => {
        const u = users.find(x => String(x.id) === String(btn.dataset.id));
        await openUserForm(u);
      };
    });

    container.querySelectorAll('.delete-btn').forEach(btn => {
      btn.onclick = () => {
        const u = users.find(x => String(x.id) === String(btn.dataset.id));
        confirmDelete(u);
      };
    });

    const addBtn = document.getElementById('addUserBtn');
    if (addBtn) {
      addBtn.onclick = async () => {
        await openUserForm();
      };
    }

    container.querySelectorAll('.status-toggle').forEach(toggle => {
      toggle.onchange = async (e) => {
        const u = users.find(x => String(x.id) === String(toggle.dataset.id));
        const currentUser = await getCurrentUser();
        
        if (u) {
          if (u.id === currentUser.id) {
            showToast('You cannot deactivate your own account!', 'error');
            await renderUsers(container);
            return;
          }
          
          const newState = e.target.checked;
          await saveUser({ ...u, isActive: newState });
          showToast(`User ${u.name} is now ${newState ? 'Active' : 'Inactive'}`, 'success');
          await renderUsers(container);
        }
      };
    });
  }

  const applyFilters = async () => {
    const filtered = users.filter(u => {
      const matchSearch = !searchQ || u.name.toLowerCase().includes(searchQ) || (u.username || u.email || '').toLowerCase().includes(searchQ);
      const matchRole = roleFilter === 'All' || u.role === roleFilter;
      const matchBranch = branchFilter === 'All' || (u.branchIds || []).includes(branchFilter);
      const matchStatus = statusFilter === 'All' || (statusFilter === 'Active' && u.isActive !== false) || (statusFilter === 'Inactive' && u.isActive === false);
      
      const matchDate = (!startDate || !endDate) || (() => {
        const d = (u.createdAt || new Date().toISOString()).split('T')[0];
        return d >= startDate && d <= endDate;
      })();

      return matchSearch && matchRole && matchBranch && matchStatus && matchDate;
    });

    const tableBody = document.getElementById('userTableBody');
    if (tableBody) tableBody.innerHTML = await renderUserRows(filtered);
    attachEvents();
  };

  document.getElementById('userSearch').oninput = (e) => {
    searchQ = e.target.value.toLowerCase().trim();
    applyFilters();
  };

  document.getElementById('roleFilter').onchange = (e) => {
    roleFilter = e.target.value;
    applyFilters();
  };

  document.getElementById('branchFilter').onchange = (e) => {
    branchFilter = e.target.value;
    applyFilters();
  };

  document.getElementById('statusFilter').onchange = (e) => {
    statusFilter = e.target.value;
    applyFilters();
  };

  const { initDateRangePicker } = await import('../utils/dateRangeHelper.js');
  initDateRangePicker('user-date-range', null, null, (start, end) => {
    startDate = start;
    endDate = end;
    applyFilters();
  });

  function confirmDelete(u) {
    if (u.id === user.id) {
      showToast('You cannot delete your own account!', 'error');
      return;
    }
    if (u.role === 'Master') {
      showToast('Super Admin records cannot be deleted!', 'error');
      return;
    }

    openModal({
      title: 'Delete User',
      body: `
        <div style="text-align:center; padding: 20px 0;">
          <i class="fa-solid fa-trash-can text-danger" style="font-size: 48px; margin-bottom: 24px;"></i>
          <h3 style="margin-bottom:8px">Confirm Delete</h3>
          <p style="color:var(--text-muted); font-size:14px; margin-bottom:32px">Are you sure you want to delete user <b>${u.name}</b>? This action cannot be undone.</p>
          
          <div style="display:flex; gap:16px; justify-content:center;">
            <button class="btn btn-ghost" onclick="closeModal()" style="flex:1">Cancel</button>
            <button class="btn btn-primary" id="confirmDeleteUserBtn" style="flex:1; background:var(--danger); border-color:var(--danger)">Delete</button>
          </div>
        </div>
      `,
      footer: ''
    });

    document.getElementById('confirmDeleteUserBtn').onclick = async () => {
      await deleteUser(u.id);
      showToast('User deleted successfully', 'success');
      closeModal();
      await renderUsers(container);
    };
  }

  attachEvents();

}

async function openUserForm(user = null) {
  const branches = await getBranches();
  const isEdit = !!user;

  openModal({
    title: isEdit ? `<i class="fa-solid fa-user-pen mr-8"></i> Edit Staff Access` : `<i class="fa-solid fa-user-plus mr-8"></i> Add New Staff`,
    body: `
      <!-- Staff Profile Header -->
      <div style="margin-bottom: 24px; padding: 20px; background: var(--bg-elevated); border-radius: var(--radius); border: 1px solid var(--border)">
         <div style="display:flex; gap:24px; align-items:center">
            <div style="position:relative">
              <div id="uImagePreview" style="width:90px; height:90px; border-radius:50%; background:var(--bg-app); border:3px solid var(--border); display:flex; align-items:center; justify-content:center; overflow:hidden; box-shadow: var(--shadow-sm)">
                ${user?.image ? '<img src="' + user.image + '" style="width:100%;height:100%;object-fit:cover" />' : '<i class="fa-solid fa-user-tie" style="font-size:40px; opacity:0.2"></i>'}
              </div>
              <button class="btn btn-icon btn-sm" onclick="document.getElementById('uImageFile').click()" style="position:absolute; bottom:0; right:0; background:var(--primary); color:white; border-radius:50%; width:32px; height:32px">
                <i class="fa-solid fa-camera"></i>
              </button>
              <input type="file" id="uImageFile" accept="image/*" style="display:none" />
            </div>
            <div style="flex:1">
               <div class="form-group mb-12">
                  <label class="form-label required">Full Name</label>
                  <div class="search-input-wrap">
                    <i class="fa-solid fa-signature"></i>
                    <input class="form-input" id="uName" placeholder="Staff Full Name" value="${user?.name || ''}" style="font-weight:700; font-size:16px" />
                  </div>
               </div>
               <button class="btn btn-ghost btn-xs" id="removeUserImgBtn" style="color:var(--danger); ${user?.image ? '' : 'display:none'}"><i class="fa-solid fa-trash mr-4"></i> Remove Photo</button>
            </div>
         </div>
         <input type="hidden" id="uImageBase64" value="${user?.image || ''}" />
      </div>

      <div class="form-grid">
        <div class="form-group">
          <label class="form-label required">Email / Username</label>
          <div class="search-input-wrap">
            <i class="fa-solid fa-envelope"></i>
            <input class="form-input" type="email" id="uUsername" value="${user?.username || user?.email || ''}" placeholder="staff@business.com" style="padding-left:36px" />
          </div>
        </div>

        <div class="form-group">
          <label class="form-label required">Access Password</label>
          <div class="search-input-wrap">
            <i class="fa-solid fa-key"></i>
            <input class="form-input" type="password" id="uPass" placeholder="••••••••" value="${user?.password || ''}" style="padding-left:36px" />
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Quick Login PIN</label>
          <div class="search-input-wrap">
            <i class="fa-solid fa-lock"></i>
            <input class="form-input" id="uPin" maxlength="4" placeholder="4 digits" value="${user?.pin || ''}" style="padding-left:36px; font-variant-numeric: tabular-nums" />
          </div>
          <p class="form-help-text">For fast terminal switching</p>
        </div>

        <div class="form-group">
          <label class="form-label">Contact Email (optional)</label>
          <div class="search-input-wrap">
            <i class="fa-solid fa-at"></i>
            <input class="form-input" type="email" id="uContactEmail" placeholder="e.g. name@example.com" value="${user?.email || ''}" style="padding-left:36px" />
          </div>
          <p class="form-help-text">For reference only — does not change how this user logs in.</p>
        </div>

        <div class="form-group">
          <label class="form-label">Security Role</label>
          <div class="search-input-wrap">
            <i class="fa-solid fa-shield-halved"></i>
            <select class="form-select" id="uRole" ${user?.role === 'Master' ? 'disabled' : ''} style="padding-left:36px">
              ${user?.role === 'Master' ? `<option value="Master" selected>Master (System Owner)</option>` : ''}
              <option value="Staff" ${user?.role === 'Staff' ? 'selected' : ''}>Staff (Standard)</option>
              <option value="Manager" ${user?.role === 'Manager' ? 'selected' : ''}>Manager (Intermediate)</option>
              <option value="Admin" ${user?.role === 'Admin' ? 'selected' : ''}>Administrator (Full Access)</option>
              <option value="Custom" ${user?.role === 'Custom' ? 'selected' : ''}>Custom Permissions</option>
            </select>
          </div>
        </div>
      </div>

      <div class="form-group mt-16" id="uIsActiveGroup" style="${(user?.role === 'Master' || user?.role === 'Admin') ? 'display:none' : ''}">
        <div style="display:flex; align-items:center; gap:12px; background:var(--bg-app); padding:12px; border-radius:12px; border:1px solid var(--border)">
          <div class="toggle-switch">
             <input type="checkbox" id="uIsActive" ${user?.isActive !== false ? 'checked' : ''}>
             <label for="uIsActive" class="toggle-slider"></label>
          </div>
          <label for="uIsActive" style="font-weight:700; cursor:pointer; font-size:14px">Account Active</label>
          <span style="font-size:11px; color:var(--text-muted); margin-left:auto">Disable to block user access instantly.</span>
        </div>
      </div>

      <div class="form-group mt-16" id="sessionFilterGroup" style="${(user?.role === 'Master' || user?.role === 'Admin') ? 'display:none' : ''}">
        <div style="display:flex; align-items:center; gap:12px; background:var(--bg-app); padding:12px; border-radius:12px; border:1px solid var(--border)">
          <div class="toggle-switch">
             <input type="checkbox" id="uSessionFilterEnabled" ${user?.sessionFilterEnabled ? 'checked' : ''}>
             <label for="uSessionFilterEnabled" class="toggle-slider"></label>
          </div>
          <label for="uSessionFilterEnabled" style="font-weight:700; cursor:pointer; font-size:14px">Session Data Filter</label>
          <span style="font-size:11px; color:var(--text-muted); margin-left:auto">Restrict visible data to their active login session only.</span>
        </div>
      </div>

      <!-- Access Control -->
      <div id="permissionsGroup" class="mt-24" ${user?.role === 'Master' ? 'style="display:none"' : ''}>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px">
          <label class="form-label" style="margin:0; font-weight:800; color:var(--primary)"><i class="fa-solid fa-lock-open mr-4"></i> PERMISSIONS</label>
          <div style="display:flex; gap:16px; font-size:11px;">
            <a href="javascript:void(0)" id="selectAllPerms" class="text-accent" style="text-decoration:none; font-weight:700">SELECT ALL</a>
            <a href="javascript:void(0)" id="uncheckAllPerms" class="text-muted" style="text-decoration:none; font-weight:700">CLEAR ALL</a>
          </div>
        </div>
        <div style="background:var(--bg-elevated); padding: 16px; border-radius: 12px; border: 1px solid var(--border); display:grid; grid-template-columns: repeat(2, 1fr); gap: 10px 20px;">
          ${[
            { id: 'pos:access', label: 'Access POS', cat: 'POS' },
            { id: 'pos:discount', label: 'Apply Discounts', cat: 'POS' },
            { id: 'pos:custom_price', label: 'Override Prices', cat: 'POS' },
            { id: 'orders:view', label: 'View Orders', cat: 'Orders' },
            { id: 'orders:refund', label: 'Process Refunds', cat: 'Orders' },
            { id: 'orders:cancel', label: 'Cancel Orders', cat: 'Orders' },
            { id: 'orders:delete', label: 'DELETE Orders', cat: 'Orders' },
            { id: 'products:view', label: 'View Products', cat: 'Products' },
            { id: 'products:manage', label: 'Manage Products', cat: 'Products' },
            { id: 'products:delete', label: 'DELETE Products', cat: 'Products' },
            { id: 'inventory:view', label: 'View Inventory', cat: 'Inventory' },
            { id: 'inventory:manage', label: 'Manage Stock', cat: 'Inventory' },
            { id: 'customers:view', label: 'View Customers', cat: 'Customers' },
            { id: 'customers:manage', label: 'Manage Customers', cat: 'Customers' },
            { id: 'customers:delete', label: 'DELETE Customers', cat: 'Customers' },
            { id: 'staff:view', label: 'View Staff', cat: 'Staff' },
            { id: 'staff:manage', label: 'Manage Staff', cat: 'Staff' },
            { id: 'staff:delete', label: 'DELETE Staff', cat: 'Staff' },
            { id: 'reports:view', label: 'View Reports', cat: 'Reports' },
            { id: 'reports:export', label: 'Export Reports', cat: 'Reports' },
            { id: 'settings:manage', label: 'Manage Settings', cat: 'Settings' },
            { id: 'settings:branches', label: 'Manage Branches', cat: 'Settings' }
          ].map(p => {
             let isChecked = false;
             if (user && Array.isArray(user.permissions)) {
               isChecked = user.permissions.includes(p.id);
             } else {
               const r = user?.role || 'Staff';
               if (r === 'Admin') isChecked = true;
               else if (r === 'Manager') isChecked = ['pos:access','pos:discount','pos:custom_price','orders:view','orders:refund','orders:cancel','products:view','products:manage','inventory:view','inventory:manage','customers:view','customers:manage','staff:view','reports:view'].includes(p.id);
               else if (r === 'Staff') isChecked = ['pos:access','orders:view','products:view','inventory:view','customers:view'].includes(p.id);
             }
             return '<div style="display:flex; align-items:center; gap:10px; padding:4px 0">' +
                '<input type="checkbox" class="perm-cb" id="perm-' + p.id + '" value="' + p.id + '" ' + (isChecked ? 'checked' : '') + ' style="width:18px; height:18px; cursor:pointer" />' +
                '<label for="perm-' + p.id + '" style="font-size:13px; cursor:pointer; font-weight:500">' + p.label + '</label>' +
              '</div>';
          }).join('')}
        </div>
      </div>

      <div class="form-group mt-20">
        <label class="form-label" style="font-weight:800; color:var(--text-muted)"><i class="fa-solid fa-code-branch mr-4"></i> AUTHORIZED BRANCHES</label>
        <div style="background:var(--bg-app); padding: 16px; border-radius: 12px; border: 1px solid var(--border); max-height: 180px; overflow-y: auto" id="branchSelector">
          <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:12px">
            ${branches.map(b => '<div style="display:flex; align-items:center; gap:10px; padding:6px; background:var(--bg-elevated); border-radius:8px; border:1px solid var(--border)">' +
                '<input type="checkbox" class="branch-cb" id="cb-' + b.id + '" value="' + b.id + '" ' + ((user?.branchIds || []).includes(b.id) ? 'checked' : '') + ' style="width:18px; height:18px; cursor:pointer" />' +
                '<label for="cb-' + b.id + '" style="font-size:13px; cursor:pointer; font-weight:600">' + b.name + '</label>' +
              '</div>').join('')}
          </div>
        </div>
        <p class="form-help-text mt-8">Staff can only switch between assigned branches.</p>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" onclick="closeModal()">Close</button>
      <button class="btn btn-primary" id="saveUserBtn" style="min-width: 150px">
        <i class="fa-solid fa-user-check mr-8"></i> ${isEdit ? 'Update Access' : 'Create Account'}
      </button>
    `
  });

  // Auto-check logic when Role changes
  const roleSelect = document.getElementById('uRole');
  if (roleSelect) {
    roleSelect.onchange = (e) => {
      const role = e.target.value;
      const isMasterAdmin = role === 'Master' || role === 'Admin';
      
      const activeGroup = document.getElementById('uIsActiveGroup');
      if (activeGroup) activeGroup.style.display = isMasterAdmin ? 'none' : 'block';
      
      const sessionGroup = document.getElementById('sessionFilterGroup');
      if (sessionGroup) sessionGroup.style.display = isMasterAdmin ? 'none' : 'block';

      if (role === 'Custom') return; // Don't reset if picking Custom manually

      const cbs = document.querySelectorAll('.perm-cb');
      document.getElementById('permissionsGroup').style.display = role === 'Master' ? 'none' : 'block';
      
      const adminPerms = [
        'pos:access','pos:discount','pos:custom_price',
        'orders:view','orders:refund','orders:cancel','orders:delete',
        'products:view','products:manage','products:delete',
        'inventory:view','inventory:manage',
        'customers:view','customers:manage','customers:delete',
        'staff:view','staff:manage','staff:delete',
        'reports:view','reports:export',
        'settings:manage','settings:branches'
      ];
      const managerPerms = [
        'pos:access','pos:discount',
        'orders:view','orders:refund','orders:cancel',
        'products:view','products:manage',
        'inventory:view','inventory:manage',
        'customers:view','customers:manage',
        'staff:view','reports:view'
      ];
      const staffPerms = ['pos:access','orders:view','products:view','inventory:view','customers:view'];
      
      let toCheck = [];
      if (role === 'Admin') toCheck = adminPerms;
      else if (role === 'Manager') toCheck = managerPerms;
      else if (role === 'Staff') toCheck = staffPerms;

      cbs.forEach(cb => {
        cb.checked = toCheck.includes(cb.value);
      });
    };
  }

  // Auto-switch to Custom if any permission is manually toggled
  document.querySelectorAll('.perm-cb').forEach(cb => {
    cb.onchange = () => {
      const currentRole = roleSelect.value;
      if (currentRole !== 'Master' && currentRole !== 'Custom') {
        roleSelect.value = 'Custom';
      }
    };
  });

  // Select All / Uncheck All Logic
  const selectAllBtn = document.getElementById('selectAllPerms');
  const uncheckAllBtn = document.getElementById('uncheckAllPerms');
  
  if (selectAllBtn) {
    selectAllBtn.onclick = () => {
      document.querySelectorAll('.perm-cb').forEach(cb => cb.checked = true);
      if (roleSelect.value !== 'Master') roleSelect.value = 'Custom';
    };
  }
  if (uncheckAllBtn) {
    uncheckAllBtn.onclick = () => {
      document.querySelectorAll('.perm-cb').forEach(cb => cb.checked = false);
      if (roleSelect.value !== 'Master') roleSelect.value = 'Custom';
    };
  }

  // Preview Image
  document.getElementById('uImageFile').onchange = async (e) => {
    try {
      const base64 = await MediaService.handleImageUpload(e);
      if (base64) {
        document.getElementById('uImageBase64').value = base64;
        document.getElementById('uImagePreview').innerHTML = `<img src="${base64}" style="width:100%;height:100%;object-fit:cover" />`;
        document.getElementById('removeUserImgBtn').style.display = 'inline-flex';
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  document.getElementById('removeUserImgBtn').onclick = () => {
    document.getElementById('uImageBase64').value = '';
    document.getElementById('uImagePreview').innerHTML = `<i class="fa-solid fa-user-circle" style="opacity:0.3"></i>`;
    document.getElementById('uImageFile').value = '';
    document.getElementById('removeUserImgBtn').style.display = 'none';
  };

  document.getElementById('saveUserBtn').onclick = async () => {
    const name = document.getElementById('uName').value.trim();
    const username = document.getElementById('uUsername').value.trim().toLowerCase();
    const password = document.getElementById('uPass').value.trim();

    // Get selected branchIds and custom permissions
    const selectedBranches = Array.from(document.querySelectorAll('.branch-cb:checked')).map(cb => cb.value);
    const selectedPerms = Array.from(document.querySelectorAll('.perm-cb:checked')).map(cb => cb.value);

    if (!name || !username || !password) { 
      const missing = [];
      if (!name) missing.push('Full Name');
      if (!username) missing.push('Email/Phone');
      if (!password) missing.push('Password');
      showToast(`Missing required fields: ${missing.join(', ')}`, 'error'); 
      return; 
    }
    // This field doubles as a phone-based login (matches onboarding's admin,
    // which logs in with a 10-digit phone number, not an email) or a real
    // email for staff added here — accept either shape.
    const looksLikePhone = /^\d{10,}$/.test(username.replace(/\D/g, ''));
    if (!username.includes('@') && !looksLikePhone) { showToast('Please enter a valid email or 10-digit phone number', 'error'); return; }

    if (user?.role !== 'Master' && selectedPerms.length === 0) {
      showToast('User must have at least one permission', 'warning');
      return;
    }

    // Uniqueness check for new users or if email changed
    if (!isEdit || username !== user.username) {
      if (window.syncEngine && window.syncEngine.isConnected) {
        showToast('Checking email availability...', 'info');
        try {
          // Check both username and email fields in DB via Hub
          const res = await window.syncEngine.checkAvailability(username, username);
          if (!res.usernameAvailable || !res.emailAvailable) {
            showToast('This email is already registered', 'error');
            return;
          }
        } catch (err) {
          console.error('Availability check failed:', err);
          showToast('Could not verify email uniqueness. Try again.', 'error');
          return;
        }
      }
    }

    await saveUser({
      ...user,
      name,
      username,
      email: document.getElementById('uContactEmail').value.trim(),
      password,
      image: document.getElementById('uImageBase64').value,
      pin: document.getElementById('uPin').value.trim(),
      role: user?.role === 'Master' ? 'Master' : document.getElementById('uRole').value,
      isActive: (user?.role === 'Master' || user?.role === 'Admin' || document.getElementById('uRole').value === 'Admin') ? true : document.getElementById('uIsActive').checked,
      sessionFilterEnabled: (user?.role === 'Master' || user?.role === 'Admin' || document.getElementById('uRole').value === 'Admin') ? false : (document.getElementById('uSessionFilterEnabled')?.checked || false),
      permissions: selectedPerms,
      branchIds: selectedBranches,
      branchId: selectedBranches[0] || 'default' // Backward compatibility
    });

    showToast('User saved!', 'success');
    closeModal();
    window.navigate('users');
  };
}
