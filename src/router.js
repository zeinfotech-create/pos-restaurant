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
import { renderStockTransfer } from './pages/StockTransfer.js';
import { renderExpenses } from './pages/Expenses.js';
import { renderAttendance } from './pages/Attendance.js';
import { renderTables } from './pages/Tables.js';
import { renderRestaurantPOS } from './pages/RestaurantPOS.js';
import { renderKitchen } from './pages/Kitchen.js';

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
    'stock-transfer': renderStockTransfer,
    expenses: renderExpenses,
    attendance: renderAttendance,
    tables: renderTables,
    'restaurant-pos': renderRestaurantPOS,
    kitchen: renderKitchen,
    // Same page/component as 'kitchen' — a separate route name purely so it
    // can be marked standalone (no sidebar/topbar) below without changing
    // how the NORMAL in-app Kitchen tab behaves. Kitchen.js opens this one
    // in its own popped-out BrowserWindow (see its "Open in New Window"
    // button) for a dedicated kitchen-display screen — full-bleed, and safe
    // to leave running unattended since it never needs the main app's
    // sidebar to get back anywhere.
    'kitchen-display': renderKitchen,
    // Short alias for the SAME route, specifically for typing on a phone —
    // http://<lan-ip>:3030/#kd. Treated identically to 'kitchen-display'
    // everywhere below (standalone, activation-exempt, permission mapping).
    kd: renderKitchen,
};

let currentPage = 'dashboard';

// A plain, full-viewport black screen — deliberately not an error message
// or a "you're not allowed here" notice, since even that would confirm
// something else exists to ask for. Wipes document.body entirely rather
// than targeting #page-container, since a fresh browser load may not have
// built the normal app shell at all yet.
function lockOutNonKitchenAccess() {
    document.body.innerHTML = '<div style="position:fixed; inset:0; background:#000; z-index:2147483647;"></div>';
}

export async function navigate(page) {
    console.log(`[Router] Navigating to: ${page}`);
    
    const [mainPage, subPage] = page.split('/');
    const publicPages = ['customer-display', 'login', 'onboarding', 'activation'];

    // 0. Global Installation Check
    const { getSettings, updateSettings } = await import('./db.js');
    const settings = await getSettings();
    const isElectron = /Electron/i.test(navigator.userAgent);

    // A device reaching this app via the LAN web endpoint (server/index.js's
    // static-file serving — see Kitchen.js's mobile/"Open in New Window"
    // access) is NEVER Electron, and is meant for exactly one thing: Kitchen
    // Display. Every other route it could ask for — Settings, Reports,
    // Products, literally anything else the full app can do — must be
    // completely unreachable from this entry point, not just hidden behind
    // a login: a black screen, no redirect, no hint of what else exists
    // here. 'login' stays reachable since it's the one step before 'kd'/
    // 'kitchen-display' actually works.
    if (!isElectron && !['login', 'kitchen-display', 'kd'].includes(mainPage)) {
        console.warn(`[Router] Non-Electron client requested "${mainPage}" — locking to black screen (LAN access is Kitchen Display only).`);
        lockOutNonKitchenAccess();
        return;
    }

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
        //
        // 'customer-display' and 'kitchen-display' are exempt too — both open
        // in their own window() with a completely fresh JS context, so
        // syncEngine.isLifetimeActivated starts false there regardless of the
        // main window's real activation status until its own async
        // re-verification finishes. For customer-display this window also
        // has no business enforcing activation at all (a real customer
        // standing at the counter should never see a license screen); for
        // kitchen-display the shop's already-activated main window is what
        // actually gates use of the app — a popped-out Kitchen Display
        // screen bouncing to the Activation gate on this same race would be
        // a startup glitch, not a genuine enforcement point.
        if (isAlreadySetUp) {
            const { syncEngine } = await import('./services/syncEngine.js');
            const activationExemptPages = ['login', 'onboarding', 'activation', 'customer-display', 'kitchen-display', 'kd'];
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

    // Branch has no register configured — the "Register" concept doesn't
    // apply here (see main.js's matching sidebar-hide and db.js's
    // isRegisterOpen() bypass, both keyed off the same "zero registers"
    // check). The nav item is hidden for this branch, so the only way to
    // land here is a stale link/back-button — redirect away instead of
    // rendering a page with nothing real to manage.
    if (mainPage === 'register' || page === 'reports/registers') {
        const { getBranchRegisters, getCurrentBranch } = await import('./db.js');
        const currentBranch = await getCurrentBranch();
        if (currentBranch?.id && (await getBranchRegisters(currentBranch.id)).length === 0) {
            console.log(`[Router] Branch has no registers — redirecting away from ${page}.`);
            navigate('dashboard');
            return;
        }
    }

    // Staff Earnings/Commission disabled in Settings — the nav item is
    // hidden (see main.js), so the only way to land here is a stale
    // link/back-button. Redirect away instead of rendering a commission
    // page for a feature the store has turned off.
    if (mainPage === 'staff' && settings.enableStaffEarnings === false) {
        console.log('[Router] Staff Earnings disabled — redirecting away from staff page.');
        navigate('dashboard');
        return;
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
    const standalonePages = ['customer-display', 'login', 'onboarding', 'activation', 'quick-pos', 'restaurant-pos', 'kitchen-display', 'kd'];
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
            // Preserve the original destination for Kitchen Display's
            // mobile/LAN entry point specifically — Login.js's normal flow
            // always lands on 'dashboard' after signing in, but a
            // non-Electron client locked to kd/kitchen-display (see
            // lockOutNonKitchenAccess() above) must land back on Kitchen
            // Display, not a dashboard it isn't even allowed to reach
            // (which would just re-trigger the black-screen lockout).
            if (mainPage === 'kd' || mainPage === 'kitchen-display') {
                sessionStorage.setItem('rpos_post_login_redirect', mainPage);
            }
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
        'reports/expenses': 'Expense Report',
        'reports/gst': 'GST Summary Report',
        'reports/payments': 'Payment Report',
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
        catalog: 'Product Catalog',
        'stock-transfer': 'Stock Transfer',
        expenses: 'Expenses',
        attendance: 'Staff Attendance',
        tables: 'Tables',
        'restaurant-pos': 'Restaurant POS',
        kitchen: 'Kitchen'
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
