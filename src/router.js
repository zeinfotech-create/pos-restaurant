import { renderDashboard } from './pages/Dashboard.js';
import { renderPOS } from './pages/POS.js';
import { renderProducts } from './pages/Products.js';
import { renderOrders } from './pages/Orders.js';
import { renderReports } from './pages/Reports.js';
import { renderSettings } from './pages/Settings.js';
import { renderPurchases } from './pages/Purchases.js';
import { renderCustomers } from './pages/Customers.js';
import { renderSuppliers } from './pages/Suppliers.js';
import { renderUsers } from './pages/Users.js';
import { renderBranches } from './pages/Branches.js';
import { renderRegister } from './pages/Register.js';
import { renderLogin } from './pages/Login.js';
import { renderStaff } from './pages/Staff.js';
import { renderOnboarding } from './pages/Onboarding.js';
import { renderInventoryLog } from './pages/InventoryLog.js';
import { hasPermission, checkElectronInstallState, getSettings, getCurrentUser } from './db.js';
import { renderCategories } from './pages/Categories.js';
import { isAppLocked, promptModuleLock } from './pages/Security.js';
import { showToast } from './components/Toast.js';

import { renderCustomerDisplay } from './pages/CustomerDisplay.js';
import { renderQuickPOS } from './pages/QuickPOS.js';
import { renderCatalog } from './pages/Catalog.js';
import { renderActivation } from './pages/Activation.js';

const routes = {
    dashboard: renderDashboard,
    pos: renderPOS,
    'quick-pos': renderQuickPOS,
    products: renderProducts,
    orders: renderOrders,
    reports: renderReports,
    settings: renderSettings,
    purchases: renderPurchases,
    customers: renderCustomers,
    suppliers: renderSuppliers,
    users: renderUsers,
    branches: renderBranches,
    register: renderRegister,
    login: renderLogin,
    staff: renderStaff,
    onboarding: renderOnboarding,
    'customer-display': renderCustomerDisplay,
    'inventory-log': renderInventoryLog,
    categories: renderCategories,
    catalog: renderCatalog,
    activation: renderActivation,
};

let currentPage = 'dashboard';


export async function navigate(page) {
    console.log(`[Router] Navigating to: ${page}`);
    
    const [mainPage, subPage] = page.split('/');
    const publicPages = ['customer-display', 'login', 'onboarding', 'activation'];

    // 0. Global Installation Check
    const { getSettings, updateSettings } = await import('./db.js');
    const settings = await getSettings();
    const isElectron = /Electron/i.test(navigator.userAgent);

    if (isElectron) {
        const isAlreadySetUp = await checkElectronInstallState();
        if (isAlreadySetUp && mainPage === 'onboarding') {
            console.log('[Router] Electron: Already set up. Blocking onboarding access.');
            navigate('login');
            return;
        }
        if (!isAlreadySetUp && mainPage !== 'onboarding') {
            console.log('[Router] Electron: No users found in PG. Forcing onboarding.');
            await updateSettings({ isInstalled: false });
            navigate('onboarding');
            return;
        }

        // Mandatory Lifetime Activation Gate: once locally installed AND logged in,
        // NOTHING works until a real activation key is verified — no trial grace
        // period for the desktop build. Gated on being logged in so Logout can
        // always reach Login instead of bouncing straight back here.
        if (isAlreadySetUp) {
            const { syncEngine } = await import('./services/syncEngine.js');
            const activationExemptPages = ['login', 'onboarding', 'activation'];
            const loggedInUser = await getCurrentUser();
            if (loggedInUser && !syncEngine.isLifetimeActivated && !activationExemptPages.includes(mainPage)) {
                console.log('[Router] Electron: Not activated yet. Forcing Activation gate.');
                navigate('activation');
                return;
            }
            if (syncEngine.isLifetimeActivated && mainPage === 'activation') {
                navigate('dashboard');
                return;
            }
        }
    }

    if (isElectron && !settings.isInstalled && mainPage !== 'onboarding') {
        // For Cloud/Non-Electron, this fallback still works if checkElectronInstallState wasn't decisive
        console.log('[Router] System not installed. Redirecting to onboarding.');
        navigate('onboarding');
        return;
    }

    // Allow public display pages to bypass the App Lock
    if ((await isAppLocked()) && !publicPages.includes(mainPage)) return;

    // If user is already logged in and tries to access login page, redirect to dashboard
    if (page === 'login') {
        if (await getCurrentUser()) {
            console.log('[Router] User already logged in, redirecting to dashboard');
            navigate('dashboard');
            return;
        }
    }

    // Intercept Settings navigation if PIN lock is enabled
    if (mainPage === 'settings') {
        const settings = await getSettings('global_settings');
        console.log('[Router] settings config:', { enabled: settings.settingsLockEnabled, pin: settings.masterPin, unlocked: window._settingsUnlocked });
        if (settings.settingsLockEnabled && settings.masterPin) {
            if (!window._settingsUnlocked) {
                console.log('[Router] Prompting for module lock and returning.');
                promptModuleLock(settings.masterPin, () => {
                   window._settingsUnlocked = true;
                   navigate('settings');
                }, 'Settings Locked', 'Enter Master PIN to manage settings');
                return;
            }
        }
    } else {
        // Reset unlock state when navigating away from settings? 
        // User said "go to settings section... make changes", 
        // so maybe it's better to reset so they have to PIN again next time they come back.
        window._settingsUnlocked = false;
    }

    if (!routes[mainPage]) {
        console.warn(`[Router] Route not found for ${mainPage}. Redirecting to dashboard.`);
        navigate('dashboard');
        return;
    }

    // Handle Standalone Pages (No sidebar/topbar)
    const standalonePages = ['customer-display', 'login', 'onboarding', 'activation', 'quick-pos'];
    const isStandalone = standalonePages.includes(mainPage);

    document.body.classList.toggle('standalone-view', isStandalone);
    const sidebar = document.getElementById('sidebar');
    const topbar = document.getElementById('topbar');
    if (sidebar) sidebar.style.display = isStandalone ? 'none' : '';
    if (topbar) topbar.style.display = isStandalone ? 'none' : '';
    const pageContainer = document.getElementById('page-container');
    if (pageContainer) {
        pageContainer.style.marginLeft = isStandalone ? '0' : '';
        pageContainer.style.marginTop = isStandalone ? '0' : '';
        pageContainer.style.height = isStandalone ? '100vh' : '';
        pageContainer.style.width = isStandalone ? '100%' : '';
    }

    // RBAC Check
    console.log(`[Router] Checking RBAC for ${page}`);
    if (!(await hasPermission(page))) {
        console.warn(`[Router] Permission denied for ${page}. Redirecting if applicable.`);
        const user = await getCurrentUser();
        if (user) {
            console.log(`[Router] User ${user.name} not allowed for ${page}`);
            showToast('Access Denied: Admin role required', 'error');
        } else {
            console.warn(`[Router] No user found. Redirecting to login.`);
            // Not logged in, redirect to login
            navigate('login');
        }
        return;
    }

    currentPage = page;

    // Update nav highlighting
    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.toggle('active', el.dataset.page === mainPage);
    });
    document.querySelectorAll('.submenu-item').forEach(el => {
        el.classList.toggle('active', el.dataset.page === page);
    });
    document.querySelectorAll('.bottom-nav-item').forEach(el => {
        el.classList.toggle('active', el.dataset.page === mainPage);
    });

    // Auto-open submenu if navigating to a sub-report
    if (subPage) {
        const submenu = document.getElementById(`${mainPage}-submenu`);
        if (submenu) submenu.classList.add('open');
        const toggleIcon = document.querySelector(`#${mainPage}-toggle .toggle-icon`);
        if (toggleIcon) toggleIcon.style.transform = 'rotate(180deg)';
    }

    // Update topbar title
    const titles = {
        dashboard: 'Dashboard',
        pos: 'Point of Sale',
        products: 'Products',
        orders: 'Order History',
        reports: 'Reports & Analytics',
        'reports/sales': 'Sales Report',
        'reports/category-sales': 'Category Sales Metrics',
        'reports/sales-analysis': 'Business Analysis',
        'reports/purchases': 'Purchase Report',
        'reports/gst': 'GST Summary Report',
        'reports/customers': 'Customer Report',
        'reports/suppliers': 'Supplier Report',
        'reports/registers': 'Register Report',
        'reports/login-activity': 'Login Audit',
        settings: 'Settings',
        purchases: 'Purchases',
        customers: 'Customers',
        suppliers: 'Suppliers',
        users: 'User Roles',
        branches: 'Branches',
        login: 'Login',
        staff: 'Staff Management',
        'inventory-log': 'Stock History Audit',
        categories: 'Categories',
        'quick-pos': 'Quick POS (Supermarket Mode)',
        catalog: 'Product Catalog'
    };
    const titleEl = document.getElementById('topbar-current-page') || document.querySelector('.topbar-title');
    if (titleEl) titleEl.textContent = titles[page] || titles[mainPage] || mainPage;

    // Render page
    const container = document.getElementById('page-container');
    if (!container) return;

    container.innerHTML = '';

    // Hide mobile cart FAB when not on POS page
    const fab = document.getElementById('mobileCheckoutFab');
    if (fab) fab.classList.toggle('hidden', mainPage !== 'pos');

    // Close cart drawer when navigating away from POS
    if (window.closeCartDrawer && mainPage !== 'pos') window.closeCartDrawer();

    // Pass subPage to the renderer if needed
    await routes[mainPage](container, subPage);

    // On mobile: trigger FAB state refresh when navigating to POS
    if (mainPage === 'pos' && window.updateMobileFAB) {
      const { getSettings } = await import('./db.js');
      const cur = (await getSettings()).currency;
      window.updateMobileFAB(cur);
    }

    // Update URL hash
    if (location.hash !== `#${page}`) {
        location.hash = page;
    }
}

export function getCurrentPage() { return currentPage; }

export function initRouter() {
    window.addEventListener('hashchange', () => {
        const hash = location.hash.replace('#', '') || 'dashboard';
        if (hash !== currentPage) navigate(hash);
    });

    const hash = location.hash.replace('#', '') || 'dashboard';
    navigate(hash);
}
