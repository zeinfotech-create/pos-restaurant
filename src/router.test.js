import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { navigate, getCurrentPage } from './router';

// Mock DB
vi.mock('./db.js', () => ({
  hasPermission: vi.fn().mockResolvedValue(true),
  checkElectronInstallState: vi.fn().mockResolvedValue(true),
  getSettings: vi.fn().mockResolvedValue({ isInstalled: true, currency: 'INR' }),
  updateSettings: vi.fn()
}));

// Mock Security
vi.mock('./pages/Security.js', () => ({
  isAppLocked: vi.fn().mockResolvedValue(false),
  promptModuleLock: vi.fn()
}));

// Mock Services
vi.mock('./services/syncEngine.js', () => ({
  syncEngine: { licenseStatus: { isExpired: false } }
}));

// Mock Pages
vi.mock('./pages/Dashboard.js', () => ({ renderDashboard: vi.fn() }));
vi.mock('./pages/POS.js', () => ({ renderPOS: vi.fn() }));
vi.mock('./pages/Products.js', () => ({ renderProducts: vi.fn() }));
vi.mock('./pages/Orders.js', () => ({ renderOrders: vi.fn() }));
vi.mock('./pages/Reports.js', () => ({ renderReports: vi.fn() }));
vi.mock('./pages/Settings.js', () => ({ renderSettings: vi.fn() }));
vi.mock('./pages/Purchases.js', () => ({ renderPurchases: vi.fn() }));
vi.mock('./pages/Customers.js', () => ({ renderCustomers: vi.fn() }));
vi.mock('./pages/Suppliers.js', () => ({ renderSuppliers: vi.fn() }));
vi.mock('./pages/Users.js', () => ({ renderUsers: vi.fn() }));
vi.mock('./pages/Branches.js', () => ({ renderBranches: vi.fn() }));
vi.mock('./pages/Register.js', () => ({ renderRegister: vi.fn() }));
vi.mock('./pages/Login.js', () => ({ renderLogin: vi.fn() }));
vi.mock('./pages/Staff.js', () => ({ renderStaff: vi.fn() }));
vi.mock('./pages/Onboarding.js', () => ({ renderOnboarding: vi.fn() }));
vi.mock('./pages/InventoryLog.js', () => ({ renderInventoryLog: vi.fn() }));
vi.mock('./pages/Categories.js', () => ({ renderCategories: vi.fn() }));
vi.mock('./pages/CustomerDisplay.js', () => ({ renderCustomerDisplay: vi.fn() }));
vi.mock('./pages/QuickPOS.js', () => ({ renderQuickPOS: vi.fn() }));
vi.mock('./pages/Catalog.js', () => ({ renderCatalog: vi.fn() }));

describe('Router Client-Side Navigation Engine', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = `
      <div id="sidebar"></div>
      <div id="topbar"></div>
      <div id="topbar-current-page" class="topbar-title"></div>
      <div id="page-container"></div>
    `;
  });

  it('should navigate to dashboard and set correct elements', async () => {
    await navigate('dashboard');
    
    expect(getCurrentPage()).toBe('dashboard');
    
    const titleEl = document.getElementById('topbar-current-page');
    expect(titleEl.textContent).toBe('Dashboard');
  });

  it('should adjust layout for standalone views', async () => {
    // Customer Display is a standalone view (no sidebar/topbar)
    await navigate('customer-display');

    expect(getCurrentPage()).toBe('customer-display');
    expect(document.body.classList.contains('standalone-view')).toBe(true);

    const sidebar = document.getElementById('sidebar');
    expect(sidebar.style.display).toBe('none');
  });

  it('should redirect invalid routes to dashboard', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    
    await navigate('non-existent-route-999');
    
    // Wait for the asynchronous redirect to complete
    await new Promise(resolve => setTimeout(resolve, 0));
    
    expect(getCurrentPage()).toBe('dashboard');
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Route not found for non-existent-route-999')
    );
  });
});
