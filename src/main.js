// ============================================================
// main.js — App entry point (Desktop + Mobile)
// ============================================================

import './style.css';
import './dashboard-animations.css';
import './settings-redesign.css';
import { navigate, initRouter, getCurrentPage } from './router.js';
import { getSettings, getBranchRegisters, getSession, getSessionTheme, setSessionTheme, getSidebarCollapsed, setSidebarCollapsed, getBranches, getCurrentShift, closeRegister, openRegister, getCustomers, getBusinessFeatures, deleteData, updateData, saveSession, getDataById, getUsers, hasPermission, getLowStockProducts, getExpiringProducts, getCurrentBranch, getCurrentUser, getCurrentRegisterId, hashPassword, verifyPassword } from './db.js';
import { showToast } from './components/Toast.js';
import { store, initStore, onCartUpdate, getCartTotals, updateQty, clearCart, setDiscount, removeFromCart, updateCartItem } from './store.js';
import { openModal, closeModal, showConfirm, showAlert } from './components/Modal.js';
import { openCheckout } from './services/CheckoutService.js';
import { openCustomerForm } from './components/CustomerForm.js';
import { lockApp, isAppLocked, getLockState } from './pages/Security.js';
import { syncEngine } from './services/syncEngine.js';
import { observeDomForSelects } from './utils/premiumSelect.js';
import { BackupService } from './services/BackupService.js';
import { escapeHtml } from './utils/escapeHtml.js';

// Initialize Global Premium Selects hook
observeDomForSelects();

// ============================================================
// Sidebar
// ============================================================
let isSidebarCollapsed = false;

async function toggleSidebarCollapse() {
  isSidebarCollapsed = !isSidebarCollapsed;
  await setSidebarCollapsed(isSidebarCollapsed);
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.toggle('collapsed', isSidebarCollapsed);

  // Close submenus if collapsing
  if (isSidebarCollapsed) {
    sidebar.querySelectorAll('.nav-submenu.open').forEach(sm => sm.classList.remove('open'));
    sidebar.querySelectorAll('.toggle-icon').forEach(icon => icon.style.transform = 'rotate(0deg)');
  }

  // Update toggle button
  const toggleBtn = document.getElementById('toggleCollapseBtn');
  if (toggleBtn) {
    toggleBtn.title = isSidebarCollapsed ? 'Expand' : 'Collapse';
    const icon = toggleBtn.querySelector('i');
    if (icon) icon.className = isSidebarCollapsed ? 'fa-solid fa-chevron-right' : 'fa-solid fa-chevron-left';
  }
}

async function renderSidebar() {
  const settings = store.settings || await getSettings();
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

    // Pre-calculate permissions (hasPermission is async, so direct calls in template literals are always truthy)
    const perms = {
      pos: await hasPermission('pos:access'),
      products: await hasPermission('products:view'),
      inventory: await hasPermission('inventory:view'),
      inventoryManage: await hasPermission('inventory:manage'),
      staff: await hasPermission('staff:manage'),
      orders: await hasPermission('orders:view'),
      reports: await hasPermission('reports:view'),
      settings: await hasPermission('settings:manage'),
      register: await hasPermission('register')
    };

    // Get live register status for sidebar indicator
    let registerIsOpen = false;
    if (perms.register && store.branch?.id) {
      try {
        const { getCurrentShift: _getShift } = await import('./db.js');
        const activeShift = await _getShift(store.branch.id, store.registerId || null);
        registerIsOpen = !!activeShift;
      } catch(_) {}
    }

    sidebar.innerHTML = `
    <div class="sidebar-header" style="position:relative; display:flex; align-items:center; justify-content:space-between; padding-bottom:16px">
      <div class="sidebar-logo" style="font-weight:800; font-size:18px; color:var(--primary-light); padding-left:8px; display:flex; align-items:center;">
        <i class="fa-solid fa-rocket mr-8"></i>
        <span style="letter-spacing:-0.5px">${escapeHtml(store.branch?.name || settings.storeName) || 'POS'}</span>
      </div>
      <button id="toggleCollapseBtn" title="${isSidebarCollapsed ? 'Expand' : 'Collapse'}" 
        style="width:28px; height:28px; border-radius:8px; background:var(--bg-elevated); border:1px solid var(--border); color:var(--text-muted); cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all var(--transition)">
        <i class="fa-solid fa-chevron-${isSidebarCollapsed ? 'right' : 'left'}"></i>
      </button>
    </div>

    <nav class="sidebar-nav">
      <span class="nav-section-label"><span>Main</span></span>
      <button class="nav-item ${getCurrentPage().startsWith('dashboard') ? 'active' : ''}" data-page="dashboard"><i class="fa-solid fa-gauge-high"></i> <span>Dashboard</span></button>
      ${perms.pos ? `<button class="nav-item ${getCurrentPage().startsWith('pos') ? 'active' : ''}" data-page="pos"><i class="fa-solid fa-cash-register"></i> <span>POS</span></button>` : ''}
      ${perms.pos ? `<button class="nav-item ${getCurrentPage().startsWith('quick-pos') ? 'active' : ''}" data-page="quick-pos"><i class="fa-solid fa-bolt"></i> <span>Quick POS</span></button>` : ''}
      
      <span class="nav-section-label"><span>Inventory & CRM</span></span>
      ${perms.products ? `<button class="nav-item ${getCurrentPage().startsWith('catalog') ? 'active' : ''}" data-page="catalog"><i class="fa-solid fa-store"></i> <span>Catalog</span></button>` : ''}
      ${perms.products ? `<button class="nav-item ${getCurrentPage().startsWith('products') ? 'active' : ''}" data-page="products"><i class="fa-solid fa-box"></i> <span>Products</span></button>` : ''}
      ${perms.products ? `<button class="nav-item ${getCurrentPage().startsWith('categories') ? 'active' : ''}" data-page="categories"><i class="fa-solid fa-layer-group"></i> <span>Categories</span></button>` : ''}
      ${perms.inventory ? `<button class="nav-item ${getCurrentPage().startsWith('inventory-log') ? 'active' : ''}" data-page="inventory-log"><i class="fa-solid fa-clock-rotate-left"></i> <span>Stock History</span></button>` : ''}
      ${perms.inventoryManage ? `
        <button class="nav-item ${getCurrentPage().startsWith('purchases') ? 'active' : ''}" data-page="purchases"><i class="fa-solid fa-truck-ramp-box"></i> <span>Purchases</span></button>
      ` : ''}
      <button class="nav-item ${getCurrentPage().startsWith('customers') ? 'active' : ''}" data-page="customers"><i class="fa-solid fa-users"></i> <span>Customers</span></button>
      <button class="nav-item ${getCurrentPage().startsWith('suppliers') ? 'active' : ''}" data-page="suppliers"><i class="fa-solid fa-handshake"></i> <span>Suppliers</span></button>
      ${settings.features?.hasAppointments && perms.staff ? `<button class="nav-item ${getCurrentPage().startsWith('staff') ? 'active' : ''}" data-page="staff"><i class="fa-solid fa-user-tie"></i> <span>Staff Management</span></button>` : ''}

      <span class="nav-section-label"><span>Management</span></span>
      ${perms.orders ? `<button class="nav-item ${getCurrentPage().startsWith('orders') ? 'active' : ''}" data-page="orders"><i class="fa-solid fa-receipt"></i> <span>Orders</span></button>` : ''}
      ${perms.register ? `
        <button class="nav-item ${getCurrentPage().startsWith('register') ? 'active' : ''}" data-page="register" style="position:relative">
          <i class="fa-solid fa-cash-register"></i>
          <span>Register</span>
          <span title="${registerIsOpen ? 'Shift Open' : 'Shift Closed'}" style="margin-left:auto;width:8px;height:8px;border-radius:50%;background:${registerIsOpen ? '#10b981' : '#ef4444'};flex-shrink:0;box-shadow:0 0 0 2px ${registerIsOpen ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.2)'}"></span>
        </button>
      ` : ''}
      
      ${perms.reports ? `
      <div class="nav-group">
        <button class="nav-item ${getCurrentPage().startsWith('reports') ? 'active' : ''}" data-page="reports" id="reports-toggle">
          <i class="fa-solid fa-chart-line"></i> <span>Reports</span>
          <i class="fa-solid fa-chevron-down toggle-icon"></i>
        </button>
        <div class="nav-submenu ${getCurrentPage().startsWith('reports') ? 'open' : ''}" id="reports-submenu">
          <button class="submenu-item ${getCurrentPage() === 'reports/sales' ? 'active' : ''}" data-page="reports/sales"><i class="fa-solid fa-coins"></i> <span>Sales Report</span></button>
          <button class="submenu-item ${getCurrentPage() === 'reports/instant-sales' ? 'active' : ''}" data-page="reports/instant-sales"><i class="fa-solid fa-bolt"></i> <span>Instant Sales</span></button>
          <button class="submenu-item ${getCurrentPage() === 'reports/category-sales' ? 'active' : ''}" data-page="reports/category-sales"><i class="fa-solid fa-tags"></i> <span>Category Sales</span></button>
          <button class="submenu-item ${getCurrentPage() === 'reports/sales-analysis' ? 'active' : ''}" data-page="reports/sales-analysis"><i class="fa-solid fa-chart-area"></i> <span>Business Analysis</span></button>
          <button class="submenu-item ${getCurrentPage() === 'reports/inventory' ? 'active' : ''}" data-page="reports/inventory"><i class="fa-solid fa-cubes"></i> <span>Inventory Report</span></button>
          <button class="submenu-item ${getCurrentPage() === 'reports/purchases' ? 'active' : ''}" data-page="reports/purchases"><i class="fa-solid fa-truck-ramp-box"></i> <span>Purchase Report</span></button>
          <button class="submenu-item ${getCurrentPage() === 'reports/vehicles' ? 'active' : ''}" data-page="reports/vehicles"><i class="fa-solid fa-truck-fast"></i> <span>Vehicle Report</span></button>
          <button class="submenu-item ${getCurrentPage() === 'reports/outstanding' ? 'active' : ''}" data-page="reports/outstanding"><i class="fa-solid fa-scale-unbalanced"></i> <span>Outstanding Report</span></button>
          <button class="submenu-item ${getCurrentPage() === 'reports/gst' ? 'active' : ''}" data-page="reports/gst"><i class="fa-solid fa-file-invoice-dollar"></i> <span>GST Summary</span></button>
          <button class="submenu-item ${getCurrentPage() === 'reports/customers' ? 'active' : ''}" data-page="reports/customers"><i class="fa-solid fa-users"></i> <span>Customer Based</span></button>
          <button class="submenu-item ${getCurrentPage() === 'reports/staff' ? 'active' : ''}" data-page="reports/staff"><i class="fa-solid fa-hand-holding-dollar"></i> <span>Staff Earnings</span></button>
          <button class="submenu-item ${getCurrentPage() === 'reports/registers' ? 'active' : ''}" data-page="reports/registers"><i class="fa-solid fa-cash-register"></i> <span>Register Based</span></button>
          <button class="submenu-item ${getCurrentPage() === 'reports/login-activity' ? 'active' : ''}" data-page="reports/login-activity"><i class="fa-solid fa-shield-halved"></i> <span>Login Audit</span></button>
          <button class="submenu-item ${getCurrentPage() === 'reports/returns' ? 'active' : ''}" data-page="reports/returns"><i class="fa-solid fa-rotate-left"></i> <span>Returns History</span></button>
        </div>
      </div>
      ` : ''}
      
      <span class="nav-section-label"><span>Administration</span></span>
      ${perms.staff ? `<button class="nav-item ${getCurrentPage().startsWith('users') ? 'active' : ''}" data-page="users"><i class="fa-solid fa-user-gear"></i> <span>User Roles</span></button>` : ''}
      ${perms.settings ? `
        <button class="nav-item ${getCurrentPage().startsWith('branches') ? 'active' : ''}" data-page="branches"><i class="fa-solid fa-store"></i> <span>Branches</span></button>
        <button class="nav-item ${getCurrentPage().startsWith('settings') ? 'active' : ''}" data-page="settings">
          <i class="fa-solid fa-gear"></i> <span>Settings</span>
        </button>
      ` : ''}
      
    <div class="sidebar-footer" style="padding: 12px 16px; border-top: 1px solid var(--border); display:flex; flex-direction:column; gap:8px">
      <div style="display:flex; flex-direction:column; gap:4px">
        <div style="font-size:11px; color:var(--text-muted); display:flex; align-items:center; gap:6px">
          <i class="fa-regular fa-calendar"></i> ${dateStr}
        </div>
        <div style="display:flex; align-items:center; gap:6px; font-size:11px; color:var(--text-muted)">
          <i class="fa-solid fa-circle" style="color:#10b981; font-size:6px"></i> System Live
        </div>
      </div>
    </div>
  `;
  sidebar.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.id === 'reports-toggle') {
        const submenu = document.getElementById('reports-submenu');
        const icon = btn.querySelector('.toggle-icon');

        // If collapsed, expand sidebar first
        if (isSidebarCollapsed) {
          toggleSidebarCollapse();
          // After expanding, wait a bit for animation before opening submenu
          setTimeout(() => {
            if (submenu) {
              const isOpen = submenu.classList.toggle('open');
              if (icon) icon.style.transform = isOpen ? 'rotate(180deg)' : 'rotate(0deg)';
            }
          }, 100);
          return;
        }

        if (submenu) {
          const isOpen = submenu.classList.toggle('open');
          if (icon) icon.style.transform = isOpen ? 'rotate(180deg)' : 'rotate(0deg)';
        }
        return;
      }
      appNavigate(btn.dataset.page);
      if (isMobile()) closeSidebar();
    });
  });

  sidebar.querySelectorAll('.submenu-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      appNavigate(btn.dataset.page);
      if (isMobile()) closeSidebar();
    });
  });

  // Toggle Collapse
  sidebar.querySelector('#toggleCollapseBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSidebarCollapse();
  });

  // User Profile
  sidebar.querySelector('#userProfileBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openUserProfileModal();
  });

  // Branch switcher (Admin only)
  sidebar.querySelector('#switchBranchBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openBranchSwitcher();
  });
}

async function openUserProfileModal() {
  const currentRegister = store.registerId ? (await getBranchRegisters(store.branch?.id)).find(r => r.id === store.registerId)?.name || 'Unknown' : 'No Register';
  const settings = await getSettings('global_settings');
  const lockEnabled = !!settings.autoLockMinutes && settings.autoLockMinutes > 0;
  const canSwitchBranch = (store.user?.role === 'Admin' || store.user?.role === 'Super Admin' || store.user?.role === 'Master') && (await getBranches()).length > 1;
  openModal({
    title: '<i class="fa-solid fa-user-circle"></i> User Profile',
    body: `
      <div style="text-align:center; padding:16px 0">
        <div class="profile-avatar" style="width:64px; height:64px; font-size:28px; margin:0 auto 16px">${/^[a-zA-Z]/.test(store.user?.name || '') ? store.user.name.charAt(0).toUpperCase() : '<i class="fa-solid fa-user"></i>'}</div>
        <div style="font-size:18px; font-weight:700; color:var(--text-primary)">${escapeHtml(store.user?.name) || 'User'}</div>
        <div style="font-size:13px; color:var(--text-muted); margin-bottom:20px">
          ${escapeHtml(store.branch?.name) || 'Branch'} · ${escapeHtml(currentRegister)}
        </div>

        <div style="display:flex; flex-direction:column; gap:10px">
          ${canSwitchBranch ? `
          <button class="btn btn-ghost w-full" id="mSwitchBranchBtn" style="justify-content:flex-start; padding:12px 16px">
            <i class="fa-solid fa-right-left mr-12 text-primary"></i> Switch Branch
          </button>` : ''}
          ${lockEnabled ? `
          <button class="btn btn-ghost w-full" id="mLockBtn" style="justify-content:flex-start; padding:12px 16px">
            <i class="fa-solid fa-lock mr-12 text-primary"></i> Lock Screen
          </button>` : ''}
          <button class="btn btn-ghost w-full" id="mPasswordBtn" style="justify-content:flex-start; padding:12px 16px">
            <i class="fa-solid fa-key mr-12 text-primary"></i> Change Password
          </button>
          <button class="btn btn-ghost w-full text-danger" id="mLogoutBtn" style="justify-content:flex-start; padding:12px 16px">
            <i class="fa-solid fa-right-from-bracket mr-12"></i> Logout
          </button>
        </div>
      </div>
    `,
    footer: `<button class="btn btn-ghost" onclick="closeModal()">Close</button>`
  });

  document.getElementById('mSwitchBranchBtn')?.addEventListener('click', () => {
    openBranchSwitcher();
  });
  document.getElementById('mLockBtn')?.addEventListener('click', () => {
    closeModal();
    lockApp();
  });
  document.getElementById('mPasswordBtn')?.addEventListener('click', () => {
    openChangePasswordModal();
  });
  document.getElementById('mLogoutBtn')?.addEventListener('click', () => {
    closeModal();
    window.logout();
  });
}

function openChangePasswordModal() {
  openModal({
    title: '<i class="fa-solid fa-key"></i> Change Password',
    body: `
      <div style="padding:8px 0 4px">
        <div style="width:56px; height:56px; border-radius:16px; background:rgba(var(--primary-rgb),0.1); display:flex; align-items:center; justify-content:center; margin:0 auto 20px">
          <i class="fa-solid fa-shield-halved" style="font-size:24px; color:var(--primary)"></i>
        </div>

        <div class="form-group mb-16">
          <label class="form-label">Current Password</label>
          <div class="pw-input-wrap">
            <i class="fa-solid fa-lock"></i>
            <input type="password" id="currentPassInput" class="form-input" placeholder="Enter current password" />
            <button type="button" class="pw-toggle-visibility" data-target="currentPassInput" tabindex="-1"><i class="fa-solid fa-eye"></i></button>
          </div>
        </div>
        <div class="form-group mb-16">
          <label class="form-label">New Password</label>
          <div class="pw-input-wrap">
            <i class="fa-solid fa-key"></i>
            <input type="password" id="newPassInput" class="form-input" placeholder="Enter new password" />
            <button type="button" class="pw-toggle-visibility" data-target="newPassInput" tabindex="-1"><i class="fa-solid fa-eye"></i></button>
          </div>
          <p style="font-size:11px; color:var(--text-muted); margin-top:6px; padding-left:2px">Minimum 3 characters.</p>
        </div>
        <div class="form-group mb-20">
          <label class="form-label">Confirm New Password</label>
          <div class="pw-input-wrap">
            <i class="fa-solid fa-check-double"></i>
            <input type="password" id="confirmPassInput" class="form-input" placeholder="Repeat new password" />
            <button type="button" class="pw-toggle-visibility" data-target="confirmPassInput" tabindex="-1"><i class="fa-solid fa-eye"></i></button>
          </div>
        </div>
        <button class="btn btn-primary w-full" id="updatePassBtn" style="height:46px; border-radius:12px; font-weight:700">
          <i class="fa-solid fa-rotate-right mr-8"></i> Update Password
        </button>
      </div>
    `,
    footer: `<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>`
  });

  document.querySelectorAll('.pw-toggle-visibility').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      const icon = btn.querySelector('i');
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      icon.className = showing ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
    });
  });

  document.getElementById('updatePassBtn')?.addEventListener('click', async () => {
    const current = document.getElementById('currentPassInput').value;
    const next = document.getElementById('newPassInput').value;
    const confirm = document.getElementById('confirmPassInput').value;

    if (!current || !next || !confirm) {
      showToast('All fields are required', 'warning');
      return;
    }

    // store.user can come from a login path that returns a trimmed-down user
    // object with no password field (e.g. the HTTP hub-login fallback strips
    // it before sending it back over the wire) — always re-fetch the actual
    // local record so the check (and the update below) use real, complete data.
    // Match by id first, but different login paths hand back different id
    // shapes (local record id vs. the hub's Mongo _id vs. userId) that don't
    // necessarily match the local IndexedDB record — username/email/name are
    // stable across every path (verifyLocalUser matches on them too), so fall
    // back to those before giving up and using the possibly-incomplete session object.
    const allLocalUsers = await getUsers();
    const freshUser = (await getDataById('users', store.user.id))
      || allLocalUsers.find(u => u.username && u.username === store.user.username)
      || allLocalUsers.find(u => u.email && u.email === store.user.email)
      || allLocalUsers.find(u => u.name && u.name === store.user.name)
      || store.user;

    // Some users log in with the 4-digit Quick Login PIN instead of a
    // password (see Users.js's separate `pin` field) — the server's own
    // login check already accepts pin/password/passwordHash interchangeably,
    // so this verification must too, or a PIN-only login can never change
    // its own credential here.
    const matchedViaPin = !!freshUser.pin && current === freshUser.pin;
    const matchedViaPassword = (await verifyPassword(current, freshUser.password)) || (await verifyPassword(current, freshUser.passwordHash));

    if (!matchedViaPin && !matchedViaPassword) {
      showToast('Current password is incorrect', 'error');
      return;
    }

    if (next !== confirm) {
      showToast('New passwords do not match', 'warning');
      return;
    }

    if (next.length < 3) {
      showToast('Password is too short', 'warning');
      return;
    }

    try {
      const btn = document.getElementById('updatePassBtn');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Updating...';
      }

      // Update User Record — based on the fresh full record, not store.user,
      // so a trimmed-down session object can't clobber other fields on save.
      // Replace whichever credential the user actually proved they know.
      const updatedUser = { ...freshUser, updatedAt: new Date().toISOString() };
      if (matchedViaPin) {
        updatedUser.pin = next;
      } else {
        updatedUser.password = await hashPassword(next);
        delete updatedUser.passwordHash; // superseded by the freshly-hashed password field above
      }
      await updateData('users', updatedUser);

      // Update Store & Session
      store.user = updatedUser;
      const currentSession = await getSession();
      if (currentSession) {
        await saveSession({ ...currentSession, user: updatedUser });
      }

      showToast('Password updated successfully! 🔒', 'success');

      // For security, force a fresh login with the new password instead of
      // silently continuing the old session — show a short countdown rather
      // than an abrupt logout so the user understands what's happening.
      const modalBody = document.querySelector('.modal-body');
      const modalFooter = document.getElementById('modalFooter');
      if (modalBody) {
        modalBody.innerHTML = `
          <div style="text-align:center; padding:24px 0">
            <div style="width:64px; height:64px; border-radius:50%; background:rgba(16,185,129,0.1); display:flex; align-items:center; justify-content:center; margin:0 auto 16px">
              <i class="fa-solid fa-circle-check" style="font-size:32px; color:var(--success)"></i>
            </div>
            <div style="font-size:18px; font-weight:700; margin-bottom:8px">Password Updated!</div>
            <p style="font-size:13px; color:var(--text-muted); line-height:1.6">For security, you'll be logged out to sign in again with your new password.</p>
            <div style="font-size:14px; font-weight:600; color:var(--primary); margin-top:16px">Redirecting in <span id="pwRedirectCountdown">5</span>s...</div>
          </div>
        `;
      }
      if (modalFooter) {
        modalFooter.innerHTML = `<button class="btn btn-primary w-full" id="pwLogoutNowBtn">Logout Now</button>`;
      }

      let secondsLeft = 5;
      const countdownEl = document.getElementById('pwRedirectCountdown');
      const countdownTimer = setInterval(() => {
        secondsLeft--;
        if (countdownEl) countdownEl.textContent = secondsLeft;
        if (secondsLeft <= 0) {
          clearInterval(countdownTimer);
          window.logout();
        }
      }, 1000);

      document.getElementById('pwLogoutNowBtn')?.addEventListener('click', () => {
        clearInterval(countdownTimer);
        window.logout();
      });
    } catch (err) {
      console.error(err);
      showToast('Failed to update password', 'error');
      const btn = document.getElementById('updatePassBtn');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Update Password';
      }
    }
  });
}


// ============================================================
// Topbar
// ============================================================
function getPageTitle(page) {
  const titles = {
    dashboard: 'Dashboard', pos: 'Point of Sale', products: 'Products',
    orders: 'Orders', reports: 'Reports', settings: 'Settings',
    purchases: 'Purchases', customers: 'Customers', suppliers: 'Suppliers',
    users: 'User Roles', branches: 'Branches', staff: 'Staff',
    register: 'Register',
  };
  const mainPage = (page || 'dashboard').split('/')[0];
  return titles[mainPage] || mainPage;
}

async function renderTopbar() {
  const topbar = document.getElementById('topbar');
  if (!topbar) return;
  const settings = store.settings || await getSettings();
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  // Prevent full DOM wipe on periodic refresh to fix blinking issue
  if (topbar.getAttribute('data-has-rendered') === 'true') {
    // 1. Update page title
    const titleSpan = document.getElementById('topbar-current-page');
    if (titleSpan) titleSpan.textContent = getPageTitle(getCurrentPage());
    
    // 2. Update low stock / expiry badges
    updateGlobalLowStockBadge();
    updateGlobalExpiryBadge();
    return;
  }

  topbar.setAttribute('data-has-rendered', 'true');
  topbar.innerHTML = `
    <button id="hamburger-btn" title="Menu"><i class="fa-solid fa-bars"></i></button>

    <!-- Quick Add Dropdown (Replaces Dashboard Title) -->
    <div class="topbar-quick-add-wrapper">
      <div class="quick-add-dropdown" id="quickAddDropdown">
        <div class="quick-add-trigger">
          <i class="fa-solid fa-circle-plus"></i>
        <span id="topbar-current-page">${getPageTitle(getCurrentPage())}</span>
          <i class="fa-solid fa-chevron-down ml-8" style="font-size:10px; opacity:0.5"></i>
        </div>
        <div class="quick-add-menu hidden" id="quickAddMenu">
          <div class="quick-add-header">Quick Actions</div>
          <div class="quick-add-item" onclick="window.navigate('pos')">
            <i class="fa-solid fa-cash-register"></i>
            <span>New Sale (POS)</span>
          </div>
          <div class="quick-add-item" onclick="window.navigate('customers/add')">
            <i class="fa-solid fa-user-plus"></i>
            <span>Add Customer</span>
          </div>
          <div class="quick-add-item" onclick="window.navigate('suppliers/add')">
            <i class="fa-solid fa-truck-field"></i>
            <span>Add Supplier</span>
          </div>
          <div class="quick-add-item" onclick="window.navigate('purchases/add')">
            <i class="fa-solid fa-cart-flatbed"></i>
            <span>New Purchase</span>
          </div>
        </div>
      </div>
    </div>

    <div style="flex:1"></div>
    
    <div id="globalLowStockContainer" style="position:relative; margin-right:8px;"></div>
    <div id="globalExpiryContainer" style="position:relative; margin-right:8px;"></div>
    
    <!-- Shortcuts Menu -->
    <div class="topbar-notif-wrapper" style="position:relative;">
      <button class="btn btn-ghost btn-sm" id="shortcutsMenuBtn" title="Quick Shortcuts">
        <i class="fa-solid fa-grip"></i>
      </button>
      <div id="shortcutsDropdown" class="shortcut-dropdown hidden">
        <div class="shortcut-header">
          <i class="fa-solid fa-rocket"></i>
          <span>Quick Launcher</span>
        </div>
        <div class="shortcut-grid">
          <div class="shortcut-item" onclick="window.navigate('quick-pos')">
            <i class="fa-solid fa-bolt"></i>
            <span class="shortcut-label">Quick POS</span>
          </div>
          <div class="shortcut-item" id="shortcut-customer-screen">
            <i class="fa-solid fa-display"></i>
            <span class="shortcut-label">Cust Screen</span>
          </div>
          <div class="shortcut-item" id="shortcut-reports">
            <i class="fa-solid fa-chart-line"></i>
            <span class="shortcut-label">Reports</span>
          </div>
        </div>
      </div>
    </div>

    <!-- User Profile Avatar -->
    <div class="topbar-avatar" id="userProfileBtn" title="User Profile" style="margin-left:8px">
      ${/^[a-zA-Z]/.test(store.user?.name || '') ? store.user.name.charAt(0).toUpperCase() : '<i class="fa-solid fa-user"></i>'}
    </div>
  `;

  document.getElementById('hamburger-btn')?.addEventListener('click', toggleSidebar);
  document.getElementById('userProfileBtn')?.addEventListener('click', () => openUserProfileModal());


  document.getElementById('shortcutsMenuBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const dropdown = document.getElementById('shortcutsDropdown');
    dropdown?.classList.toggle('hidden');
    if (!dropdown?.classList.contains('hidden')) {
      renderShortcutsState();
    }
  });

  // Close dropdown on outside click
  window.addEventListener('click', (event) => {
    const dropdown = document.getElementById('shortcutsDropdown');

    if (dropdown && !dropdown.contains(event.target) && !event.target.closest('#shortcutsMenuBtn')) {
      dropdown.classList.add('hidden');
    }
    const qaMenu = document.getElementById('quickAddMenu');
    if (qaMenu && !qaMenu.contains(event.target) && !event.target.closest('#quickAddDropdown')) {
      qaMenu.classList.add('hidden');
    }
  });

  document.getElementById('quickAddDropdown')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('quickAddMenu')?.classList.toggle('hidden');
  });

  updateGlobalLowStockBadge();
  updateGlobalExpiryBadge();
}

async function updateGlobalLowStockBadge() {
  const container = document.getElementById('globalLowStockContainer');
  if (!container) return;

  const lowStock = await getLowStockProducts(store.branch?.id);

  const totalLowStockCount = lowStock.reduce((total, p) => {
    if (p.variants && p.variants.length > 0) {
      const lowVariants = p.variants.filter(v => (v.stock || 0) <= (v.minStock || 10));
      return total + lowVariants.length;
    }
    return total + 1;
  }, 0);

  if (totalLowStockCount === 0) {
    container.innerHTML = '';
    return;
  }

  // If button already exists, just update the count — avoids DOM flash/blink
  const existingBtn = document.getElementById('globalLowStockBtn');
  if (existingBtn) {
    const badge = existingBtn.querySelector('.notif-badge');
    if (badge) badge.textContent = totalLowStockCount;
    return;
  }

  container.innerHTML = `
    <button class="btn btn-ghost btn-sm" id="globalLowStockBtn" style="border:1px solid var(--danger); color:var(--danger); position:relative; background:rgba(239,68,68,0.05)">
      <i class="fa-solid fa-bell"></i>
      <span class="notif-badge" style="position:absolute; top:-6px; right:-6px; font-size:10px; border-radius:10px; padding:2px 6px; background:var(--danger); color:#fff; border:1px solid var(--bg-surface)">${totalLowStockCount}</span>
    </button>
  `;

  document.getElementById('globalLowStockBtn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const pos = await import('./pages/POS.js');
    const settings = store.settings || await getSettings();
    pos.openLowStockModal(settings.currency);
  });
}

async function updateGlobalExpiryBadge() {
  const container = document.getElementById('globalExpiryContainer');
  if (!container) return;

  const expiring = await getExpiringProducts(store.branch?.id);

  if (expiring.length === 0) {
    container.innerHTML = '';
    return;
  }

  // If button already exists, just update the count — avoids DOM flash/blink
  const existingBtn = document.getElementById('globalExpiryBtn');
  if (existingBtn) {
    const badge = existingBtn.querySelector('.notif-badge');
    if (badge) badge.textContent = expiring.length;
    return;
  }

  container.innerHTML = `
    <button class="btn btn-ghost btn-sm" id="globalExpiryBtn" style="border:1px solid var(--warning); color:var(--warning); position:relative; background:rgba(245,158,11,0.05)">
      <i class="fa-solid fa-hourglass-end"></i>
      <span class="notif-badge" style="position:absolute; top:-6px; right:-6px; font-size:10px; border-radius:10px; padding:2px 6px; background:var(--warning); color:#fff; border:1px solid var(--bg-surface)">${expiring.length}</span>
    </button>
  `;

  document.getElementById('globalExpiryBtn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const pos = await import('./pages/POS.js');
    const settings = store.settings || await getSettings();
    pos.openExpiryModal(settings.currency);
  });
}

// Low Stock / Expiry Event Listeners
window.addEventListener('storage-change', (e) => {
  if (e?.detail?.store === 'products') {
    updateGlobalLowStockBadge();
    updateGlobalExpiryBadge();
  }
});
window.addEventListener('data-synced', updateGlobalLowStockBadge);
window.addEventListener('data-synced', updateGlobalExpiryBadge);
window.addEventListener('license-status-changed', () => { 
  renderTopbar(); 
  renderSidebar(); 
  // Re-trigger navigation to apply/remove blur restrictions instantly
  const cur = getCurrentPage().split('/')[0];
  const standalonePages = ['login', 'onboarding', 'customer-display', 'quick-pos'];
  if (!standalonePages.includes(cur)) {
    navigate(getCurrentPage());
  }
});
onCartUpdate(updateGlobalLowStockBadge);

async function renderShortcutsState() {
  const isPremium = window.syncEngine?.licenseStatus?.type === 'premium';
  const settings = store.settings || await getSettings();

  const shortcuts = [
    { id: 'shortcut-customer-screen', action: () => window.open(window.location.href.split('#')[0] + '#customer-display', '_blank'), premium: false, label: 'Cust Screen' },
    { id: 'shortcut-reports', action: () => window.navigate('reports'), premium: false, label: 'Reports' }
  ];

  shortcuts.forEach(s => {
    const el = document.getElementById(s.id);
    if (!el) return;

    const locked = s.premium && !isPremium;
    let configDisabled = false;
    let configMsg = '';

    if (locked || configDisabled) {
      el.classList.add('disabled');
      el.title = locked ? 'Premium Feature' : configMsg;
      
      // Remove any existing lock/gear icon first
      el.querySelector('.shortcut-lock')?.remove();
      
      const lock = document.createElement('div');
      lock.className = 'shortcut-lock';
      lock.innerHTML = locked ? '<i class="fa-solid fa-lock"></i>' : '<i class="fa-solid fa-gears"></i>';
      el.appendChild(lock);

      el.onclick = (e) => {
        e.stopPropagation();
        if (locked) {
          showToast('This is a Premium feature. Please upgrade to access.', 'warning');
        } else {
          showToast(configMsg, 'warning');
        }
      };
    } else {
      el.classList.remove('disabled');
      el.title = s.label;
      const existingLock = el.querySelector('.shortcut-lock');
      if (existingLock) existingLock.remove();
      el.onclick = (e) => {
        e.stopPropagation();
        document.getElementById('shortcutsDropdown').classList.add('hidden');
        s.action();
      };
    }
  });
}

// ============================================================
// Sidebar overlay helpers
// ============================================================
const isMobile = () => window.innerWidth <= 768;

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (sidebar?.classList.contains('open')) {
    closeSidebar();
  } else {
    openSidebar();
  }
}
function openSidebar() {
  document.getElementById('sidebar')?.classList.add('open');
  document.getElementById('sidebar-overlay')?.classList.add('show');
}
function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.remove('show');
}
document.getElementById('sidebar-overlay')?.addEventListener('click', closeSidebar);

// ============================================================
// Bottom nav
// ============================================================
function initBottomNav() {
  document.querySelectorAll('.bottom-nav-item').forEach(btn => {
    btn.addEventListener('click', () => appNavigate(btn.dataset.page));
  });
}
function updateBottomNav(page) {
  document.querySelectorAll('.bottom-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });
}

// ============================================================
// Navigate wrapper (syncs sidebar + bottom nav)
// ============================================================
function appNavigate(page) {
  const p = import('./router.js').then(m => m.navigate(page));
  if (cartDrawerOpen) closeCartDrawer();
  return p;
}

// ============================================================
// Mobile Cart Drawer
// ============================================================
let cartDrawerOpen = false;

function initCartDrawer() {
  document.getElementById('cartDrawerHandle')?.addEventListener('click', toggleCartDrawer);
  document.getElementById('cart-drawer-backdrop')?.addEventListener('click', closeCartDrawer);

  // Keep mobile FAB in sync with cart changes
  onCartUpdate(async () => {
    const s = store.settings || await getSettings();
    updateMobileFAB(s.currency);
    // If drawer is open, refresh it too
    if (cartDrawerOpen) await renderMobileCart();
  });
}
function toggleCartDrawer() {
  cartDrawerOpen ? closeCartDrawer() : openCartDrawer();
}
function openCartDrawer() {
  cartDrawerOpen = true;
  document.getElementById('cart-drawer')?.classList.add('open');
  document.getElementById('cart-drawer-backdrop')?.classList.add('show');
  renderMobileCart();
}
function closeCartDrawer() {
  cartDrawerOpen = false;
  document.getElementById('cart-drawer')?.classList.remove('open');
  document.getElementById('cart-drawer-backdrop')?.classList.remove('show');
}

async function renderMobileCart() {
  const inner = document.getElementById('cart-drawer-inner');
  if (!inner) return;
  const settings = store.settings || await getSettings();
  const cur = settings.currency;
  const { subtotal, discount, tax, taxRate, total, groupedTaxes, grossGroupedTaxes } = getCartTotals();
  const totalItems = store.cart.reduce((s, i) => s + i.qty, 0);
  const features = await getBusinessFeatures();
  const customers = await getCustomers(store.branch?.id);
  const canCustomPrice = await hasPermission('pos:custom_price');
  const canDiscount = await hasPermission('pos:discount');

  inner.innerHTML = `
    <div class="cart-header">
      <div class="cart-title"><i class="fa-solid fa-cart-shopping"></i> My Cart</div>
      <div class="flex items-center gap-8">
        <div class="cart-count-badge">${Number.isInteger(totalItems) ? totalItems : totalItems.toFixed(3)}</div>
        ${store.cart.length ? `<button class="btn btn-ghost btn-sm" id="mClearCart"><i class="fa-solid fa-trash"></i></button>` : ''}
      </div>
    </div>

    <!-- ORDER TYPE PILLS -->
    <div class="cart-order-meta">
      ${!features.hasAppointments || !store.selectedAppointmentId ? `
        <div class="cart-meta-row no-hover" style="position:relative">
          <span class="cart-meta-icon"><i class="fa-solid fa-user"></i></span>
          <div style="flex:1; position:relative; display:flex; align-items:center;">
             <input type="text" id="mCustSearch" placeholder="Search Customer..." 
               autocomplete="off"
               style="border:none; padding:4px 0; background:transparent; font-weight:700; width:100%; outline:none; font-size:13px; color:var(--text-main)"
               value="${escapeHtml(store.selectedCustomer ? store.selectedCustomer.name : 'Walk-in Customer')}" />
             <div id="mCustSuggestions" class="ep-suggestions hidden" style="position:absolute; top:36px; left:-34px; width:calc(100% + 56px); z-index:100; background:#fff; box-shadow:0 10px 25px rgba(0,0,0,0.1); border-radius:8px; border:1px solid var(--border); overflow:hidden"></div>
          </div>
          ${store.selectedCustomer ? `
            <button id="mClearCustBtn" class="cart-meta-add" style="color:var(--danger); margin-right:4px" title="Reset to Walk-in"><i class="fa-solid fa-circle-xmark"></i></button>
          ` : ''}
          <button id="mAddCustBtn" class="cart-meta-add" title="Add Customer"><i class="fa-solid fa-plus"></i></button>
        </div>
        ${store.selectedCustomer ? `
          <div class="cart-loyalty-strip">
            <i class="fa-solid fa-star" style="color:var(--warning);font-size:10px"></i>
            <span>${store.selectedCustomer.loyaltyPoints || 0} pts</span>
            <span class="cart-loyalty-tier" style="color:${store.selectedCustomer.tier?.color || 'var(--primary)'}">${store.selectedCustomer.tier?.name || 'Silver'}</span>
          </div>
        ` : ''}
      ` : `
        <div class="cart-meta-row">
          <span class="cart-meta-icon"><i class="fa-solid fa-calendar-check" style="color:var(--accent)"></i></span>
          <div style="flex:1;min-width:0">
            <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">Appointment</div>
            <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(store.selectedCustomer?.name) || 'Walk-in'}</div>
          </div>
          <button class="cart-meta-add" id="mClearAppoCust" title="Clear"><i class="fa-solid fa-xmark"></i></button>
        </div>
      `}
    </div>

    <div class="cart-items">
      ${store.cart.length === 0 ? `
        <div class="cart-empty">
          <i class="fa-solid fa-cart-shopping"></i>
          <p>Cart is empty</p>
          <p style="font-size:12px">Click a product to add</p>
        </div>
      ` : store.cart.map(item => `
        <div class="cart-item" data-cart-id="${item.cartId}">
          <div style="width:24px;height:24px;border-radius:4px;background:var(--bg-elevated);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0">
            ${item.image ? `<img src="${item.image}" style="width:100%;height:100%;object-fit:cover" />` : (item.emoji || '📦')}
          </div>
          <div class="cart-item-info" style="min-width:0;flex:1">
            <div class="cart-item-name" title="Double-click to edit">${escapeHtml(item.name)}${item.variantName ? ` <span style="font-size:10px;opacity:0.6">(${escapeHtml(item.variantName)})</span>` : ''}</div>
            <div class="cart-item-price">
              ${cur}${item.price}
              ${item.unit ? `<span style="font-size:10px;opacity:0.55;margin-left:2px">/${item.unit}</span>` : ''}
              × ${Number.isInteger(item.qty) ? item.qty : item.qty.toFixed(3)}
              ${item.itemDiscount > 0 ? `<span style="font-size:10px;color:var(--danger);margin-left:4px" title="Discount applied">- ${cur}${(item.itemDiscountType === 'pct' ? (item.price * item.qty * item.itemDiscount / 100) : (item.itemDiscount * item.qty)).toFixed(2)} ${item.itemDiscountType === 'pct' ? `[${item.itemDiscount}%]` : ''}</span>` : ''}
              ${item.taxRate > 0 ? `<span style="font-size:10px;color:var(--info);margin-left:4px" title="Tax applied">(${item.taxType === 'inclusive' ? 'Inc.' : 'Exc.'} ${item.taxRate}%)</span>` : '<span style="font-size:10px;color:var(--text-muted);margin-left:4px">(No Tax)</span>'}
            </div>
          </div>
          <div class="qty-controls">
            <button class="qty-btn m-qty-btn" data-id="${item.cartId}" data-delta="-1">−</button>
            <span class="qty-value">${Number.isInteger(item.qty) ? item.qty : item.qty.toFixed(3)}</span>
            <button class="qty-btn m-qty-btn" data-id="${item.cartId}" data-delta="1">+</button>
          </div>
          <div class="cart-item-total" id="m-ie-total-${item.cartId}" style="font-weight:700">${cur}${(
          (() => {
            const qty = parseFloat(parseFloat(item.qty).toFixed(3)) || 0;
            const discAmt = item.itemDiscountType === 'pct'
              ? (item.price * qty * (item.itemDiscount || 0) / 100)
              : ((item.itemDiscount || 0) * qty);
            const base = Math.max(0, (item.price * qty) - discAmt);
            return item.taxType === 'exclusive'
              ? base * (1 + (parseFloat(item.taxRate) || 0) / 100)
              : base;
          })()
        ).toFixed(2)}</div>
          <button class="remove-btn m-remove-btn" data-id="${item.cartId}" style="width:20px;height:20px;border-radius:4px;border:none;background:rgba(239,68,68,0.12);color:var(--danger);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;transition:background 0.15s">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div class="cart-item-inline-edit" id="m-inline-edit-${item.cartId}" style="display:none;padding:12px;background:var(--bg-elevated);border-bottom:1px solid var(--border);animation:fadeIn 0.15s ease">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div>
              <label style="font-size:10px;color:var(--text-muted);font-weight:600;text-transform:uppercase">Price (${cur})</label>
              <input class="form-input" id="m-ie-price-${item.cartId}" type="number" min="0" step="0.01" value="${item.price}"
                ${!canCustomPrice ? 'disabled style="opacity:0.6"' : ''}
                style="height:38px;font-size:14px" />
            </div>
            <div>
              <label style="font-size:10px;color:var(--text-muted);font-weight:600;text-transform:uppercase">Unit</label>
              <input class="form-input" id="m-ie-unit-${item.cartId}" type="text" value="${item.unit || 'pcs'}" style="height:38px;font-size:14px" />
            </div>
            <div>
              <label style="font-size:10px;color:var(--text-muted);font-weight:600;text-transform:uppercase">Discount</label>
              <div style="display:flex;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden; ${!canDiscount ? 'opacity:0.6; pointer-events:none' : ''}">
                <input class="form-input" id="m-ie-discount-${item.cartId}" type="number" min="0" step="0.01"
                  value="${item._discountRaw ?? item.itemDiscount ?? 0}"
                  style="height:38px;font-size:14px;border:none;flex:1;min-width:0" />
                <button class="m-ie-disc-type-btn" data-id="${item.cartId}" data-type="flat"
                  style="width:40px;height:38px;border:none;border-left:1px solid var(--border);background:${(item._discountType || 'flat') === 'flat' ? 'var(--primary)' : 'var(--bg-card)'};
                  color:${(item._discountType || 'flat') === 'flat' ? '#fff' : 'var(--text-muted)'}">${cur}</button>
                <button class="m-ie-disc-type-btn" data-id="${item.cartId}" data-type="pct"
                  style="width:40px;height:38px;border:none;border-left:1px solid var(--border);background:${(item._discountType || 'flat') === 'pct' ? 'var(--primary)' : 'var(--bg-card)'};
                  color:${(item._discountType || 'flat') === 'pct' ? '#fff' : 'var(--text-muted)'}">%</button>
              </div>
            </div>
            <div>
              <label style="font-size:10px;color:var(--text-muted);font-weight:600;text-transform:uppercase">Tax Rate</label>
              <div style="display:flex;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
                <select class="form-input" id="m-ie-tax-${item.cartId}" style="height:38px;font-size:14px;border:none;flex:1;min-width:0">
                  ${(settings.availableTaxes || [0, 5, 12, 18, 28]).map(t => `<option value="${t}" ${item.taxRate == t ? 'selected' : ''}>${t}%</option>`).join('')}
                </select>
                <button class="m-ie-tax-type-btn" data-id="${item.cartId}" data-type="exclusive"
                  style="padding:0 8px;height:38px;border:none;border-left:1px solid var(--border);font-size:10px;font-weight:700;
                  background:${(item.taxType || 'exclusive') === 'exclusive' ? 'var(--primary)' : 'var(--bg-card)'};
                  color:${(item.taxType || 'exclusive') === 'exclusive' ? '#fff' : 'var(--text-muted)'}">EXC</button>
                <button class="m-ie-tax-type-btn" data-id="${item.cartId}" data-type="inclusive"
                  style="padding:0 8px;height:38px;border:none;border-left:1px solid var(--border);font-size:10px;font-weight:700;
                  background:${(item.taxType || 'exclusive') === 'inclusive' ? 'var(--primary)' : 'var(--bg-card)'};
                  color:${(item.taxType || 'exclusive') === 'inclusive' ? '#fff' : 'var(--text-muted)'}">INC</button>
              </div>
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-top:12px">
            <button class="btn btn-ghost m-ie-cancel-btn" data-id="${item.cartId}" style="flex:1;height:40px">Cancel</button>
            <button class="btn btn-primary m-ie-save-btn" data-id="${item.cartId}" style="flex:1;height:40px">Update</button>
          </div>
        </div>
      `).join('')}
    </div>

    <div style="padding:14px 16px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:8px; background:var(--bg-surface)">
      
      <div id="mCartSummaryDetails" style="display:${window.isMobileSummaryExpanded ? 'flex' : 'none'}; flex-direction:column; gap:4px;">
        <div class="summary-row">
          <span class="summary-label">Subtotal</span>
          <span class="summary-value">${cur}${subtotal.toFixed(2)}</span>
        </div>
        ${discount > 0 ? `
          <div class="summary-row">
            <span class="summary-label text-success">Discount</span>
            <span class="summary-value text-success">−${cur}${discount.toFixed(2)}</span>
          </div>
        ` : ''}
        ${(grossGroupedTaxes || groupedTaxes) && (grossGroupedTaxes || groupedTaxes).length > 0 ?
          (grossGroupedTaxes || groupedTaxes).map(t => `
            <div class="summary-row">
              <span class="summary-label">Tax (${t.rate}%)</span>
              <span class="summary-value">${cur}${t.amount.toFixed(2)}</span>
            </div>
          `).join('')
        : `
          <div class="summary-row">
            <span class="summary-label">Tax (0%)</span>
            <span class="summary-value">${cur}0.00</span>
          </div>
        `}
        
        <div style="margin-top:4px">
          ${window.isMobileDiscountExpanded ? `
            <div class="discount-input-row" style="margin-bottom:4px;display:flex;gap:6px">
              <div style="display:flex;flex:1;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
                <input class="form-input" id="mDiscountInput" type="number" placeholder="Amt" value="${store.discountRaw || ''}" min="0" style="height:32px;font-size:12px;border:none;border-radius:0;flex:1;min-width:0" />
                <button id="mGlobal-disc-type-flat" style="height:32px;padding:0 10px;border:none;border-left:1px solid var(--border);font-size:12px;font-weight:700;cursor:pointer;transition:background 0.15s;
                  background:${store.discountType === 'flat' ? 'var(--primary)' : 'var(--bg-card)'};
                  color:${store.discountType === 'flat' ? '#fff' : 'var(--text-muted)'}">${cur}</button>
                <button id="mGlobal-disc-type-pct" style="height:32px;padding:0 10px;border:none;border-left:1px solid var(--border);font-size:12px;font-weight:700;cursor:pointer;transition:background 0.15s;
                  background:${store.discountType === 'pct' ? 'var(--primary)' : 'var(--bg-card)'};
                  color:${store.discountType === 'pct' ? '#fff' : 'var(--text-muted)'}">%</button>
              </div>
              <button class="btn btn-primary btn-sm" id="mApplyDiscountBtn" style="height:32px;padding:0 12px">Apply</button>
              <button class="btn btn-ghost btn-sm" id="mToggleDiscountBtn" style="height:32px;width:32px;padding:0;flex-shrink:0"><i class="fa-solid fa-xmark"></i></button>
            </div>
          ` : `
            <button class="btn btn-ghost btn-sm" id="mToggleDiscountBtn"
              ${!canDiscount ? 'disabled style="display:none"' : ''}
              style="border:1px dashed var(--primary); color:var(--primary); width:100%; justify-content:center; font-size:12px; padding:4px">
              <i class="fa-solid fa-tag"></i> Add Discount
            </button>
          `}
        </div>
      </div>

      <div class="summary-row total" id="mSummaryToggleBtn" style="cursor:pointer; user-select:none; font-size:16px; margin-top:4px">
        <div style="display:flex; align-items:center; gap:8px">
          <span>Total</span>
          <i class="fa-solid fa-chevron-${window.isMobileSummaryExpanded ? 'down' : 'up'}" style="font-size:12px; opacity:0.5"></i>
        </div>
        <span style="color:var(--accent)">${cur}${total.toFixed(2)}</span>
      </div>
      
      <div style="display:flex; gap:8px; margin-top:12px;">
        <button class="btn btn-success w-full btn-lg" id="mCheckoutBtn" style="height:46px" ${store.cart.length === 0 ? 'disabled' : ''}>
          <i class="fa-solid fa-credit-card"></i> Pay ${cur}${total.toFixed(2)}
        </button>
      </div>
    </div>
  `;

  // Event Listeners
  inner.querySelectorAll('.m-qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      updateQty(btn.dataset.id, Number(btn.dataset.delta));
      renderMobileCart();
    });
  });

  inner.querySelectorAll('.m-remove-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromCart(btn.dataset.id);
      renderMobileCart();
    });
  });

  // Toggle inline edit on mobile (Single click on item info or name)
  inner.querySelectorAll('.cart-item').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.m-qty-btn, .m-remove-btn')) return;
      const cartId = row.dataset.cartId;
      const editPanel = inner.querySelector(`#m-inline-edit-${cartId}`);
      if (!editPanel) return;
      const isOpen = editPanel.style.display !== 'none';
      // Close all others
      inner.querySelectorAll('.cart-item-inline-edit').forEach(p => p.style.display = 'none');
      if (!isOpen) editPanel.style.display = 'block';
    });
  });

  // Inline edit Disc Type toggle
  inner.querySelectorAll('.m-ie-disc-type-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const cartId = btn.dataset.id;
      const type = btn.dataset.type;
      const item = store.cart.find(i => i.cartId === cartId);
      if (item) item._discountType = type;
      renderMobileCart(); // Simply re-render to update UI
    });
  });

  // Inline edit Tax Type toggle
  inner.querySelectorAll('.m-ie-tax-type-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const cartId = btn.dataset.id;
      const type = btn.dataset.type;
      const item = store.cart.find(i => i.cartId === cartId);
      if (item) item.taxType = type;
      renderMobileCart();
    });
  });

  // Inline edit Save
  inner.querySelectorAll('.m-ie-save-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const cartId = btn.dataset.id;
      const item = store.cart.find(i => i.cartId === cartId);
      if (!item) return;

      const price = parseFloat(inner.querySelector(`#m-ie-price-${cartId}`)?.value) || 0;
      const unit = inner.querySelector(`#m-ie-unit-${cartId}`)?.value.trim() || 'pcs';
      const discRaw = parseFloat(inner.querySelector(`#m-ie-discount-${cartId}`)?.value) || 0;
      const taxRate = parseFloat(inner.querySelector(`#m-ie-tax-${cartId}`)?.value) || 0;
      const discType = item._discountType || 'flat';
      const taxType = item.taxType || 'exclusive';

      const itemDiscount = discType === 'pct' ? parseFloat(((price * discRaw) / 100).toFixed(2)) : discRaw;

      updateCartItem(cartId, {
        // itemDiscount is now always a flat ₹ amount (converted above) — itemDiscountType must
        // be reset to 'flat' too, or it stays stuck at the product's original default (e.g.
        // 'pct'), making this already-converted number get re-interpreted as a percentage
        // wherever itemDiscountType is read (getCartTotals, receipts, refunds, reports).
        price, unit, itemDiscount, itemDiscountType: 'flat', taxRate, taxType,
        _discountRaw: discRaw, _discountType: discType
      });
      showToast('Item updated', 'success');
      renderMobileCart();
    });
  });

  // Inline edit Cancel
  inner.querySelectorAll('.m-ie-cancel-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const cartId = btn.dataset.id;
      const editPanel = inner.querySelector(`#m-inline-edit-${cartId}`);
      if (editPanel) editPanel.style.display = 'none';
    });
  });

  const custSearch = inner.querySelector('#mCustSearch');
  const custSugs = inner.querySelector('#mCustSuggestions');

  if (custSearch && custSugs) {
    const showSuggestions = async (query) => {
      const val = query.toLowerCase();
      const allCustomers = await getCustomers(store.branch?.id);
      const matches = allCustomers.filter(c => 
        c.name.toLowerCase().includes(val) || (c.phone && c.phone.includes(val))
      );
      
      if (matches.length === 0) {
        custSugs.classList.add('hidden');
        return;
      }

      custSugs.classList.remove('hidden');
      custSugs.innerHTML = matches.slice(0, 6).map(c => `
        <div class="cust-suggestion-item" data-id="${c.id}" style="padding:12px; border-bottom:1px solid #f1f5f9; cursor:pointer; display:flex; justify-content:space-between; align-items:center; background:#fff">
          <div style="min-width:0; flex:1">
            <div style="font-weight:700; color:var(--text-main); font-size:14px; line-height:1.2">${escapeHtml(c.name)}</div>
            <div style="font-size:11px; color:#6366f1; font-weight:600">${escapeHtml(c.phone || 'No Phone')}</div>
          </div>
          <div style="font-size:10px; color:#94a3b8"><i class="fa-solid fa-chevron-right"></i></div>
        </div>
      `).join('');

      custSugs.querySelectorAll('.cust-suggestion-item').forEach(item => {
        item.onclick = async (e) => {
          e.stopPropagation();
          const cust = matches.find(m => String(m.id) === String(item.dataset.id));
          if (cust) {
            store.selectedCustomer = cust;
            await renderMobileCart();
          }
        };
      });
    };

    custSearch.addEventListener('focus', () => {
      if (custSearch.value === 'Walk-in Customer') custSearch.value = '';
      showSuggestions(custSearch.value);
    });

    custSearch.addEventListener('input', (e) => {
      showSuggestions(e.target.value);
    });

    const hideOnOutside = (e) => {
      if (!custSearch.contains(e.target) && !custSugs.contains(e.target)) {
         custSugs.classList.add('hidden');
         if (!store.selectedCustomer) custSearch.value = 'Walk-in Customer';
         document.removeEventListener('click', hideOnOutside);
      }
    };
    document.addEventListener('click', hideOnOutside);
  }

  inner.querySelector('#mClearCustBtn')?.addEventListener('click', () => {
    store.selectedCustomer = null;
    renderMobileCart();
  });

  inner.querySelector('#mAddCustBtn')?.addEventListener('click', () => {
    openCustomerForm(null, (newCust) => {
      store.selectedCustomer = newCust;
      renderMobileCart();
    });
  });

  inner.querySelector('#mClearAppoCust')?.addEventListener('click', () => {
    store.selectedCustomer = null;
    store.selectedAppointmentId = null;
    renderMobileCart();
  });

  inner.querySelector('#mSummaryToggleBtn')?.addEventListener('click', () => {
    window.isMobileSummaryExpanded = !window.isMobileSummaryExpanded;
    renderMobileCart();
  });

  inner.querySelector('#mToggleDiscountBtn')?.addEventListener('click', () => {
    window.isMobileDiscountExpanded = !window.isMobileDiscountExpanded;
    renderMobileCart();
  });

  inner.querySelector('#mGlobal-disc-type-flat')?.addEventListener('click', () => {
    store.discountType = 'flat';
    renderMobileCart();
  });

  inner.querySelector('#mGlobal-disc-type-pct')?.addEventListener('click', () => {
    store.discountType = 'pct';
    renderMobileCart();
  });

  inner.querySelector('#mApplyDiscountBtn')?.addEventListener('click', () => {
    const el = inner.querySelector('#mDiscountInput');
    if(el) {
      setDiscount(el.value, store.discountType);
      renderMobileCart();
    }
  });

  inner.querySelector('#mClearCart')?.addEventListener('click', () => {
    clearCart();
    closeCartDrawer();
    showToast('Cart cleared', 'info');
  });

  inner.querySelector('#mCheckoutBtn')?.addEventListener('click', () => {
    closeCartDrawer();
    openCheckout();
  });

}

// Mobile floating action button
function updateMobileFAB(cur) {
  const fab = document.getElementById('mobileCheckoutFab');
  if (!fab) return;

  const modalOpen = !document.getElementById('pos-modal-overlay')?.classList.contains('hidden');
  if (store.cart.length === 0 || modalOpen || cartDrawerOpen) {
    fab.classList.add('hidden');
    return;
  }

  fab.classList.remove('hidden');
  const itemCount = store.cart.reduce((s, i) => s + i.qty, 0);
  const { total } = getCartTotals();
  const countText = Number.isInteger(itemCount) ? itemCount : itemCount.toFixed(2);
  fab.innerHTML = `
    <button class="btn btn-success" id="fabCartBtn">
      <i class="fa-solid fa-cart-shopping"></i>
      ${countText} ${itemCount === 1 ? 'item' : 'items'} · ${cur}${total.toFixed(2)} — View Cart
    </button>
  `;
  fab.querySelector('#fabCartBtn')?.addEventListener('click', openCartDrawer);
}

// ============================================================
// Theme Management
// ============================================================
function applyTheme(themeName, saveToDb = true) {
  const themeClasses = [
    'theme-dark-midnight', 'theme-dark-obsidian', 'theme-dark-ocean', 'theme-dark-indigo', 'theme-dark-twilight',
    'theme-light-classic', 'theme-light-mint', 'theme-light-slate', 'theme-light-royal', 'theme-light-rose',
    'theme-light-google', 'theme-light-zoom', 'theme-light-amazon', 'theme-light-flipkart',
    'light-theme'
  ];
  document.body.classList.remove(...themeClasses);

  if (themeName === 'light') themeName = 'theme-light-classic';
  if (themeName === 'dark') themeName = 'theme-dark-midnight';

  if (themeName) {
    document.body.classList.add(themeName);
    if (themeName.startsWith('theme-light-')) {
      document.body.classList.add('light-theme');
    }
    setSessionTheme(themeName);
    
    if (saveToDb) {
      import('./db.js').then(db => {
        db.updateSettings({ theme: themeName });
      });
    }
  }
}

// ============================================================
// Branch Switcher
// ============================================================
async function openBranchSwitcher() {
  const branches = await getBranches();
  const currentBranchId = store.branch?.id;
  const currentRegisterId = store.registerId;
  const currentShift = currentBranchId ? await getCurrentShift(currentBranchId, currentRegisterId) : null;

  if (currentShift) {
    openModal({
      title: '<i class="fa-solid fa-triangle-exclamation" style="color:var(--warning)"></i> Register is Open',
      body: `
        <div style="text-align:center;padding:12px 0">
          <i class="fa-solid fa-cash-register" style="font-size:48px;color:var(--warning);margin-bottom:16px"></i>
          <p style="font-size:14px;margin-bottom:8px">Your current register (<b>${escapeHtml(store.branch?.name)}</b>) has an active shift.</p>
          <p style="font-size:13px;color:var(--text-muted)">We recommend closing your current shift before switching branches.</p>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="switchWithoutClosingBtn">Switch Anyway</button>
        <button class="btn btn-primary" id="closeAndSwitchBtn">Close & Switch</button>
      `
    });

    document.getElementById('closeAndSwitchBtn').onclick = async () => {
      const cashSales = currentShift.collections?.Cash || 0;
      const totalIn = (currentShift.transactions || []).filter(t => t.type === 'In').reduce((s, t) => s + t.amount, 0);
      const totalOut = (currentShift.transactions || []).filter(t => t.type === 'Out').reduce((s, t) => s + t.amount, 0);
      const expectedCash = (currentShift.openingBalance || 0) + cashSales + totalIn - totalOut;
      await closeRegister(currentShift.id, expectedCash, 'Auto-closed on branch switch');
      showToast('Register closed', 'info');
      await showBranchList(branches, currentBranchId);
    };

    document.getElementById('switchWithoutClosingBtn').onclick = async () => {
      await showBranchList(branches, currentBranchId);
    };
  } else {
    await showBranchList(branches, currentBranchId);
  }
}

async function showBranchList(branches, currentBranchId) {
  openModal({
    title: '<i class="fa-solid fa-store"></i> Switch Branch',
    body: `
      <div style="display:flex;flex-direction:column;gap:10px;padding:4px">
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Current: <b>${escapeHtml(store.branch?.name) || 'None'}</b></p>
        ${branches.map(b => `
          <button class="btn btn-ghost branch-switch-btn" data-id="${b.id}"
            style="justify-content:flex-start;height:54px;padding:0 20px;border:1px solid ${b.id === currentBranchId ? 'var(--primary)' : 'var(--border)'};${b.id === currentBranchId ? 'background:rgba(99,102,241,0.08)' : ''}">
            <i class="fa-solid fa-store mr-12" style="color:${b.id === currentBranchId ? 'var(--primary)' : 'var(--text-muted)'}"></i>
            <div style="text-align:left">
              <div class="font-bold">${escapeHtml(b.name)}${b.id === currentBranchId ? ' <span style="font-size:10px;color:var(--primary);font-weight:600;margin-left:4px">● Active</span>' : ''}</div>
              ${b.address ? `<div style="font-size:11px;opacity:0.6">${escapeHtml(b.address)}</div>` : ''}
            </div>
          </button>
        `).join('')}
      </div>
    `,
    footer: `<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>`
  });

  document.querySelectorAll('.branch-switch-btn').forEach(btn => {
    btn.onclick = async () => {
      const selectedBranch = branches.find(b => b.id === btn.dataset.id);
      if (selectedBranch) await openRegisterPickerForBranch(selectedBranch, branches);
    };
  });
}

async function openRegisterPickerForBranch(branch, branches) {
  const registers = await getBranchRegisters(branch.id);
  const sess = await getSession();

  const renderedRegisters = await Promise.all(registers.map(async (r, idx) => {
    const limits = window.syncEngine?.getLimits() || { maxRegistersPerBranch: 1 };
    const hasOpenShift = !!(await getCurrentShift(branch.id, r.id));
    const restricted = idx >= limits.maxRegistersPerBranch;
    return `
        <button class="btn btn-ghost reg-switch-btn" data-id="${r.id}" ${restricted ? 'disabled' : ''}
          style="justify-content:flex-start;height:60px;padding:0 20px;border:1px solid var(--border); ${restricted ? 'opacity:0.6; cursor:not-allowed' : ''}">
          <i class="fa-solid fa-cash-register mr-12" style="color:${hasOpenShift ? 'var(--success)' : 'var(--text-muted)'}"></i>
          <div style="text-align:left;flex:1">
            <div class="font-bold">
              ${escapeHtml(r.name)}
              ${restricted ? '<span style="font-size:9px; background:var(--warning); color:black; padding:2px 6px; border-radius:4px; font-weight:700; margin-left:8px">PREMIUM ONLY</span>' : ''}
            </div>
            <div style="font-size:11px;opacity:0.6">
              ${restricted ? '<span style="color:var(--danger)">Upgrade required to use this register</span>' : (hasOpenShift ? '<span class="text-success">Shift is ACTIVE</span>' : 'Shift is CLOSED')}
            </div>
          </div>
          <i class="fa-solid fa-chevron-right opacity-30"></i>
        </button>
      `;
  }));

  openModal({
    title: `<i class="fa-solid fa-cash-register"></i> Select Register — ${escapeHtml(branch.name)}`,
    body: `
      <div style="display:flex;flex-direction:column;gap:10px;padding:4px">
        ${registers.length === 0
        ? `<div style="text-align:center;padding:32px;opacity:0.5">
               <i class="fa-solid fa-cash-register" style="font-size:32px;margin-bottom:12px;display:block"></i>
               <p>No registers found for this branch.</p>
             </div>
             <button class="btn btn-primary reg-switch-btn" data-id="" style="margin-top:8px">
               <i class="fa-solid fa-check"></i> Continue without register
             </button>`
        : renderedRegisters.join('')}
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" id="backToBranchListBtn"><i class="fa-solid fa-arrow-left mr-6"></i> Back</button>
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    `
  });

  document.getElementById('backToBranchListBtn')?.addEventListener('click', async () => {
    await showBranchList(branches || await getBranches(), store.branch?.id);
  });

  document.querySelectorAll('.reg-switch-btn').forEach(btn => {
    btn.onclick = async () => {
      const registerId = btn.dataset.id || null;
      const hasOpenShift = registerId ? !!(await getCurrentShift(branch.id, registerId)) : false;

      const db = await import('./db.js');
      const sess = await getSession();
      sess.branch = branch;
      sess.registerId = registerId;
      await db.saveSession(sess);
      closeModal();

      if (!hasOpenShift && registerId) {
        showToast(`Switched to ${escapeHtml(branch.name)}`, 'info');
        setTimeout(() => {
          openModal({
            title: '<i class="fa-solid fa-key"></i> Open Register Shift',
            body: `
              <div style="text-align:center;margin-bottom:16px">
                <p style="font-size:13px;color:var(--text-muted)">The register at <b>${escapeHtml(branch.name)}</b> is currently closed. Enter opening cash to start your shift.</p>
              </div>
              <div class="form-group">
                <label class="form-label">Opening Cash Balance</label>
                <div class="search-input-wrap">
                  <i class="fa-solid fa-money-bill"></i>
                  <input class="form-input" type="number" id="switchOpenBal" placeholder="0.00" value="0" />
                </div>
              </div>
            `,
            footer: `
              <button class="btn btn-ghost" id="skipOpenRegBtn">Skip — Just Switch</button>
              <button class="btn btn-primary" id="confirmSwitchOpenBtn"><i class="fa-solid fa-key"></i> Open Register</button>
            `
          });

          const confirmSwitchOpenBtn = document.getElementById('confirmSwitchOpenBtn');
          confirmSwitchOpenBtn.onclick = async () => {
            if (confirmSwitchOpenBtn.disabled) return;
            confirmSwitchOpenBtn.disabled = true;
            const bal = document.getElementById('switchOpenBal').value;
            try {
              await db.openRegister(branch.id, sess.user.name || sess.user.username || 'Admin', bal, registerId);
            } catch (err) {
              confirmSwitchOpenBtn.disabled = false;
              showToast('Failed to open register: ' + err.message, 'error');
              return;
            }
            closeModal();
            showToast(`Switched to ${escapeHtml(branch.name)} · Register opened!`, 'success');
            setTimeout(() => window.location.reload(), 400);
          };

          document.getElementById('skipOpenRegBtn').onclick = () => {
            closeModal();
            showToast(`Switched to ${escapeHtml(branch.name)}`, 'success');
            setTimeout(() => window.location.reload(), 400);
          };
        }, 150);
      } else {
        showToast(`Switched to ${escapeHtml(branch.name)}${hasOpenShift ? ' · Shift resuming' : ''}`, 'success');
        setTimeout(() => window.location.reload(), 400);
      }
    };
  });
}

async function initInactivityTracker() {
  const settings = store.settings || await getSettings();
  if (!settings.autoLockMinutes || settings.autoLockMinutes <= 0) return;

  let timeout;
  const resetTimer = async () => {
    clearTimeout(timeout);
    if (await isAppLocked()) return;
    timeout = setTimeout(() => {
      lockApp();
    }, settings.autoLockMinutes * 60 * 1000);
  };

  ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'].forEach(name => {
    document.addEventListener(name, resetTimer, true);
  });
  resetTimer();
}

// ============================================================
// Global Error & Limit Handlers
// ============================================================
window.addEventListener('sync-limit-reached', (e) => {
  const { store, message } = e.detail;
  openModal({
    title: '<i class="fa-solid fa-crown" style="color:var(--warning)"></i> Upgrade Required',
    body: `
      <div style="text-align:center; padding: 16px 0;">
        <i class="fa-solid fa-lock" style="font-size: 48px; color: var(--warning); margin-bottom: 16px;"></i>
        <h3 style="margin-bottom: 8px; font-weight: 600;">Record Limit Reached</h3>
        <p style="color: var(--text-muted); font-size: 14px; line-height: 1.5; margin-bottom: 24px;">
          ${message.message || `You have reached the limit for ${store}. Upgrade for more capacity.`}
        </p>
      </div>
    `,
    footer: `<button class="btn btn-primary" onclick="closeModal()">Close</button>`
  });
});

// Sync Settings Listener (Apply theme in real-time)
window.addEventListener('sync-settings-updated', (e) => {
  const data = e.detail;
  if (data && data.theme) {
    console.log('Main: Sync settings update received. Applying theme:', data.theme);
    window.applyTheme(data.theme, false); // false = don't save back to DB
  }
});

async function initApp() {
  console.log('[App] Starting initialization...');
  
  // 1. Initialize DB and Store (Core requirement for IndexedDB)
  await initStore();

  // Restore a lock that was still active when the app last closed
  // uncleanly (crash, Task Manager kill, anything skipping a normal
  // unlock) — isAppLocked()'s in-memory flag always starts false on a
  // fresh load, so without this the app would otherwise silently open
  // straight to the dashboard with no PIN prompt at all.
  if (await getLockState()) {
    lockApp();
  }

  const session = await getSession();
  console.log('[App] Session:', session ? `User ${session.user?.name || 'Unknown'} logged in` : 'No session found');

  const settings = store.settings || {};
  console.log('[App] Settings:', { storeName: settings.storeName, isInstalled: settings.isInstalled });

  const theme = await getSessionTheme() || settings.theme || 'theme-light-zoom';
  applyTheme(theme, false);

  // Initialize UI components (Async where needed)
  isSidebarCollapsed = await getSidebarCollapsed();
  const sidebar = document.getElementById('sidebar');
  if (sidebar && isSidebarCollapsed) {
    sidebar.classList.add('collapsed');
  }

  await renderSidebar();
  await renderTopbar();
  initBottomNav();
  initCartDrawer();
  initInactivityTracker();

  // Pulse refresh for topbar
  setInterval(() => renderTopbar(), 10000);

  // Initialize Core Services
  try {
    await syncEngine.init();
  } catch (err) {
    console.error('App init failed:', err);
  } finally {
    initRouter();
  }

  // Trial Expiry Check removed as per request (disturbing overlay)
  // The renewal notice is now handled by the top-bar banner instead.

  // Re-render sidebar when license changes
  window.addEventListener('license-status-changed', () => {
    renderSidebar();
  });
}

initApp();

// Global Sync Listeners for Theme Persistence
window.addEventListener('sync-full-state-applied', async () => {
  const settings = await getSettings();
  if (settings.theme) {
    console.log('App: Sync finished. Re-applying cloud theme:', settings.theme);
    window.applyTheme(settings.theme, false);
  }
});

window.addEventListener('sync-settings-updated', async (e) => {
  const settings = await getSettings();
  if (settings && settings.theme) {
    console.log(`[Main] Sync Update: Re-applying merged theme [${settings.theme}] (Triggered by: ${e.detail?.id || 'unknown'})`);
    window.applyTheme(settings.theme, false);
  }
});

window.logout = () => {
  import('./db.js').then(async db => {
    // Record logout time in login activity before clearing session
    try {
      const session = await db.getSession();
      if (session?.loginAt) {
        const allActivity = await db.getLoginActivity();
        const activeEntry = allActivity.find(a => a.loginAt === session.loginAt && a.status === 'active');
        if (activeEntry) {
          await db.saveLoginActivity({
            ...activeEntry,
            logoutAt: new Date().toISOString(),
            status: 'completed'
          });
        }
      }
    } catch (e) {
      console.warn('[Logout] Failed to record activity:', e);
    }
    await db.clearSession();
    await db.updateData('internal', { id: 'app_lock', val: false });
    window.location.reload();
  });
};

// Expose globals
window.showToast = showToast;
window.navigate = appNavigate;
window.renderSidebar = renderSidebar;
window.renderTopbar = renderTopbar;
window.closeModal = closeModal;
window.openCartDrawer = openCartDrawer;
window.closeCartDrawer = closeCartDrawer;
window.updateMobileFAB = updateMobileFAB;
window.openCheckout = openCheckout;
window.isMobile = isMobile;
window.applyTheme = applyTheme;
window.lockApp = lockApp;

// ── TEST-ONLY HELPER ────────────────────────────────────────────────────────
// Exposed for Playwright E2E only. Opens a register shift so the POS page
// does not show the "Register is Closed" state during automated tests.
window.__testOpenShift = async () => {
  try {
    // Use top-level imports (already in scope from main.js module) — no dynamic import needed
    const branch = await getCurrentBranch();
    const user   = await getCurrentUser();
    const regId  = await getCurrentRegisterId();
    const branchId = branch?.id;
    const userId   = user?.id;
    if (!branchId || !userId) {
      console.warn('[TestHelper] __testOpenShift: session not ready (branch:', branchId, ', user:', userId, ')');
      return false;
    }
    await openRegister(branchId, userId, 0, regId);
    console.log('[TestHelper] __testOpenShift: shift opened ✓ branch=', branchId, 'reg=', regId);
    return true;
  } catch (e) {
    console.error('[TestHelper] __testOpenShift failed:', e.message);
    return false;
  }
};

// Global Shortcuts
window.addEventListener('keydown', (e) => {
  if (e.altKey && e.key.toLowerCase() === 'q') {
    e.preventDefault();
    import('./router.js').then(m => m.navigate('quick-pos'));
  }
});

// ============================================================
// Electron Native Integration
// ============================================================
if (window.electronAPI) {
  // Handle Graceful Shutdown
  window.electronAPI.onAppClosing(async () => {
    console.log('[Electron] App closing signal received. Checking for auto-backup...');
    try {
      // Trigger auto-backup in the background
      await BackupService.runAutoBackup(true);
      console.log('[Electron] Auto-backup routine completed.');
    } catch (err) {
      console.error('[Electron] Auto-backup failed during shutdown:', err);
    } finally {
      // Notify main process that we are ready to quit
      window.electronAPI.notifyReadyToQuit();
    }
  });
}

// Periodically check for scheduled auto-backups (every 15 mins)
if (window.electronAPI) {
  setInterval(() => {
    BackupService.runAutoBackup(false);
  }, 15 * 60 * 1000);
}
