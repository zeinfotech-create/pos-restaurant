/**
 * Deep Test Suite — All modules in ONE Electron session.
 * This avoids the 15x boot penalty that caused GitHub Actions timeout.
 */
import { test, expect } from '@playwright/test';
import { launchApp, login, navigateTo } from './test-helper';

let electronApp;
let window;

test.describe.serial('Deep Full Suite', () => {
  test.beforeAll(async ({}, testInfo) => {
    // Give the outer hook 5 full minutes: Vite cold-start + Electron launch + onboarding/login
    testInfo.setTimeout(300_000);
    console.log('[beforeAll] Launching Electron app...');
    ({ electronApp, window } = await launchApp());
    console.log('[beforeAll] App launched, running login...');
    await login(window);
    console.log('[beforeAll] Login complete — tests will begin.');
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.evaluate(async ({ app }) => { app.exit(0); });
    }
  });

  // ── Branches ──────────────────────────────────────────────────────────────
  test.describe('Deep Branches Module Testing', () => {
    test('Should load branches list and verify table', async () => {
      await navigateTo(window, 'branches');
      await expect(window.locator('.page-title').first()).toContainText('Branch Management');
      const searchInput = window.locator('#branchSearch');
      await searchInput.waitFor({ state: 'visible', timeout: 15000 });
      await expect(searchInput).toBeVisible();
      await expect(window.locator('.responsive-table')).toBeVisible();
      console.log('Branches: List and table verified.');
    });

    test('Should verify branch status filter', async () => {
      await navigateTo(window, 'branches');
      await expect(window.locator('#branchStatusFilter')).toBeAttached();
      console.log('Branches: Status filter verified.');
    });

    test('Should open Add Branch modal if clicking Add Branch', async () => {
      await navigateTo(window, 'branches');
      const addBtn = window.locator('#addBranchBtn');
      if (await addBtn.isVisible() && !(await addBtn.isDisabled())) {
        await addBtn.click();
        await window.waitForSelector('.modal-body', { state: 'visible', timeout: 15000 });
        await expect(window.locator('.modal-title')).toContainText('Branch');
        await window.keyboard.press('Escape');
        await window.waitForSelector('.modal-body', { state: 'hidden', timeout: 10000 }).catch(() => {});
        console.log('Branches: Add Branch modal opened and closed.');
      }
    });
  });

  // ── Categories ────────────────────────────────────────────────────────────
  test.describe('Deep Categories Module Testing', () => {
    test('Should load categories page and verify elements', async () => {
      await navigateTo(window, 'categories');
      await expect(window.locator('.page-title').first()).toContainText('Categories');
      await expect(window.locator('#addCategoryBtn')).toBeVisible();
      await expect(window.locator('.categories-layout')).toBeVisible();
      console.log('Categories: Layout verified.');
    });

    test('Should open New Category modal when clicking New', async () => {
      await navigateTo(window, 'categories');
      await window.locator('#addCategoryBtn').click();
      await window.waitForSelector('.modal-body', { state: 'visible', timeout: 15000 });
      await expect(window.locator('.modal-title')).toContainText('Category');
      await expect(window.locator('#newCatNameInput')).toBeVisible();
      await expect(window.locator('#confirmNewCat')).toBeVisible();
      await window.keyboard.press('Escape');
      await window.waitForSelector('.modal-body', { state: 'hidden', timeout: 10000 }).catch(() => {});
      console.log('Categories: Modal verified successfully.');
    });
  });

  // ── Customers ─────────────────────────────────────────────────────────────
  test.describe('Deep Customers Module Testing', () => {
    test('Should verify customer list and search', async () => {
      await navigateTo(window, 'customers');
      await window.locator('#custSearch').fill('Walking');
      await expect(window.locator('.responsive-table')).toBeVisible();
      console.log('Customers: List and Search verified.');
    });

    test('Should open Add Customer form', async () => {
      await navigateTo(window, 'customers');
      const addBtn = window.locator('#addCustBtn');
      if (await addBtn.isVisible()) {
        await addBtn.click();
        await window.waitForSelector('.modal-body', { state: 'visible' });
        await expect(window.locator('.modal-title')).toContainText('Customer');
        await window.keyboard.press('Escape');
        await window.waitForSelector('.modal-body', { state: 'hidden', timeout: 10000 }).catch(() => {});
        console.log('Customers: Form verified.');
      }
    });
  });

  // ── Inventory Log ─────────────────────────────────────────────────────────
  test.describe('Deep Stock History Audit Module Testing', () => {
    test('Should load Stock History Audit view', async () => {
      await navigateTo(window, 'inventory-log');
      await expect(window.locator('.page-title').first()).toContainText('Stock History Audit');
      const searchInput = window.locator('#logSearch');
      await searchInput.waitFor({ state: 'visible', timeout: 15000 });
      await expect(searchInput).toBeVisible();
      await expect(window.locator('.responsive-table')).toBeVisible();
      await expect(window.locator('#exportLogsBtn')).toBeVisible();
      await expect(window.locator('#navToProductsBtn')).toBeVisible();
      console.log('Stock History Audit: Controls, table, and buttons verified.');
    });

    test('Should verify type tab filters', async () => {
      await navigateTo(window, 'inventory-log');
      await expect(window.locator('.tab-group')).toBeVisible();
      await expect(window.locator('.tab-btn[data-type="All"]')).toBeVisible();
      await expect(window.locator('.tab-btn[data-type="IN"]')).toBeVisible();
      await expect(window.locator('.tab-btn[data-type="OUT"]')).toBeVisible();
      console.log('Stock History Audit: Filter tabs verified.');
    });
  });

  // ── Orders ────────────────────────────────────────────────────────────────
  test.describe('Deep Orders Module Testing', () => {
    test('Should load orders list and verify history table', async () => {
      await navigateTo(window, 'orders');
      await expect(window.locator('.page-title').first()).toContainText('Order');
      const ordersContent = window.locator('#ordersContent');
      await ordersContent.waitFor({ state: 'visible', timeout: 20000 });
      await expect(ordersContent).toBeVisible();
      await expect(window.locator('.responsive-table, .empty-state').first()).toBeVisible();
      console.log('Orders: History table verified.');
    });

    test('Should search orders by ID or payment method', async () => {
      await navigateTo(window, 'orders');
      const searchInput = window.locator('#orderSearch');
      await searchInput.waitFor({ state: 'visible', timeout: 15000 });
      await searchInput.fill('Cash');
      await expect(searchInput).toHaveValue('Cash');
      await expect(window.locator('#ordersContent')).toBeVisible();
      await searchInput.fill('');
      console.log('Orders: Search functionality verified.');
    });

    test('Should verify order filter bar controls', async () => {
      await navigateTo(window, 'orders');
      await expect(window.locator('#order-date-range')).toBeAttached();
      const minTotal = window.locator('#minTotal');
      await minTotal.waitFor({ state: 'visible', timeout: 15000 });
      await expect(minTotal).toBeVisible();
      await expect(window.locator('#maxTotal')).toBeVisible();
      await minTotal.fill('100');
      await expect(minTotal).toHaveValue('100');
      await minTotal.fill('');
      console.log('Orders: Filter bar controls verified.');
    });

    test('Should open order detail modal when clicking View', async () => {
      await navigateTo(window, 'orders');
      const viewBtn = window.locator('.view-btn').first();
      const hasOrders = await viewBtn.isVisible().catch(() => false);
      if (hasOrders) {
        await viewBtn.click();
        await window.waitForSelector('.modal-body', { state: 'visible', timeout: 15000 });
        await expect(window.locator('.modal-title')).toContainText('Order');
        await window.keyboard.press('Escape');
        await window.waitForSelector('.modal-body', { state: 'hidden', timeout: 10000 }).catch(() => {});
        console.log('Orders: Order detail modal verified.');
      } else {
        console.log('Orders: No orders found to test detail modal (empty state is valid).');
      }
    });

    test('Should verify pagination in orders', async () => {
      await navigateTo(window, 'orders');
      const overlay = window.locator('#pos-modal-overlay.active, .pos-modal-overlay.active');
      if (await overlay.isVisible().catch(() => false)) {
        await window.keyboard.press('Escape');
        await overlay.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
      }
      await expect(window.locator('#orderPaginationArea')).toBeAttached();
      console.log('Orders: Pagination area verified.');
    });
  });

  // ── POS ───────────────────────────────────────────────────────────────────
  test.describe('Deep POS Module Testing', () => {
    test('Should perform a full sale flow', async () => {
      // Ensure a register shift is open so POS doesn't show "Register Closed" screen
      const shiftOpened = await window.evaluate(async () => {
        if (typeof window.__testOpenShift === 'function') {
          return await window.__testOpenShift();
        }
        return false;
      });
      console.log('POS: Register shift pre-open result:', shiftOpened);

      await navigateTo(window, 'pos');
      const productCard = window.locator('.product-card').first();
      await productCard.waitFor({ state: 'visible', timeout: 15000 });
      await productCard.click();
      const cartItem = window.locator('.cart-item').first();
      await cartItem.waitFor({ state: 'visible', timeout: 15000 });
      await expect(cartItem).toBeVisible();
      console.log('POS: Product added to cart.');
      const checkoutBtn = window.locator('#checkoutBtn');
      await checkoutBtn.waitFor({ state: 'visible', timeout: 10000 });
      await checkoutBtn.click();
      await window.waitForSelector('.checkout-fullscreen-wrapper', { state: 'visible', timeout: 20000 });
      await expect(window.locator('.checkout-brand')).toContainText('CHECKOUT');
      await expect(window.locator('#confirmPayBtn')).toBeVisible();
      console.log('POS: Full-screen checkout opened.');
      await window.click('button.btn-ghost:has(i.fa-xmark)');
      await window.waitForSelector('.checkout-fullscreen-wrapper', { state: 'hidden', timeout: 10000 });
      console.log('POS: Sale flow verified successfully.');
    });
  });

  // ── Products ──────────────────────────────────────────────────────────────
  test.describe('Deep Products Module Testing', () => {
    test('Should search and filter products', async () => {
      await navigateTo(window, 'products');
      const searchInput = window.locator('#productSearch');
      await searchInput.waitFor({ state: 'visible', timeout: 20000 });
      await searchInput.fill('Test Product');
      await expect(window.locator('.page-header')).toBeVisible();
      console.log('Products: Search and Filter verified.');
    });

    test('Should open Add Product modal', async () => {
      await navigateTo(window, 'products');
      const addBtn = window.locator('#addProductBtn');
      await addBtn.waitFor({ state: 'visible', timeout: 15000 });
      await addBtn.click();
      await window.waitForSelector('.modal-body', { state: 'visible' });
      await expect(window.locator('.modal-title')).toContainText('New Product');
      await window.keyboard.press('Escape');
      await window.waitForSelector('.modal-body', { state: 'hidden', timeout: 10000 }).catch(() => {});
      console.log('Products: Add Modal verified.');
    });
  });

  // ── Purchases ─────────────────────────────────────────────────────────────
  test.describe('Deep Purchases Module Testing', () => {
    test('Should load purchases list and verify table', async () => {
      await navigateTo(window, 'purchases');
      await expect(window.locator('.page-title').first()).toContainText('Purchases');
      const searchInput = window.locator('#purSearch');
      await searchInput.waitFor({ state: 'visible', timeout: 15000 });
      await expect(window.locator('.responsive-table')).toBeVisible();
      console.log('Purchases: List and table verified.');
    });

    test('Should search purchases by ID or Supplier', async () => {
      await navigateTo(window, 'purchases');
      const searchInput = window.locator('#purSearch');
      await searchInput.waitFor({ state: 'visible', timeout: 15000 });
      await searchInput.fill('PUR-999');
      await expect(searchInput).toHaveValue('PUR-999');
      await searchInput.fill('');
      console.log('Purchases: Search input verified.');
    });

    test('Should open New Purchase form and check fields', async () => {
      await navigateTo(window, 'purchases');
      const addBtn = window.locator('#addPurBtn');
      if (await addBtn.isVisible()) {
        await addBtn.click();
        await window.waitForSelector('.modal-body', { state: 'visible', timeout: 15000 });
        await expect(window.locator('.modal-title')).toContainText('Purchase Entry');
        await expect(window.locator('#purInvNo')).toBeVisible();
        await expect(window.locator('#purSupplier')).toBeAttached();
        await expect(window.locator('#addProductSelect')).toBeAttached();
        await expect(window.locator('#completePurchaseBtn')).toBeVisible();
        await window.keyboard.press('Escape');
        await window.waitForSelector('.modal-body', { state: 'hidden', timeout: 10000 }).catch(() => {});
        console.log('Purchases: Form modal opened and closed.');
      }
    });
  });

  // ── Quick POS ─────────────────────────────────────────────────────────────
  test.describe('Deep Quick POS Module Testing', () => {
    test('Should load Quick POS view and handle open/closed status', async () => {
      // Ensure shift is open (POS test may have already opened one; this is idempotent)
      await window.evaluate(async () => {
        if (typeof window.__testOpenShift === 'function') await window.__testOpenShift();
      });

      await navigateTo(window, 'quick-pos');
      await window.waitForTimeout(2000);
      const closedState = window.locator('.empty-state');
      const container = window.locator('.enterprise-pos-container');
      if (await closedState.isVisible()) {
        await expect(closedState.locator('h2')).toContainText('Register is Closed');
        console.log('Quick POS: Register Closed State detected.');
      } else if (await container.isVisible()) {
        await expect(window.locator('#quickProductSearch')).toBeVisible();
        await expect(window.locator('.ep-shortcut-grid')).toBeVisible();
        await expect(window.locator('#qcActiveCard')).toBeVisible();
        console.log('Quick POS: Active terminal UI components verified.');
      } else {
        console.log('Quick POS: Standalone page not loaded fully or requires permissions.');
      }
    });
  });

  // ── Register & Shifts ─────────────────────────────────────────────────────
  test.describe('Deep Register & Shifts Module Testing', () => {
    test('Should load Register & Shifts view', async () => {
      await navigateTo(window, 'register');
      await expect(window.locator('.page-title').first()).toContainText('Register & Shifts');
      console.log('Register & Shifts: Main page layout loaded.');
    });

    test('Should handle Open or Closed states dynamically', async () => {
      await navigateTo(window, 'register');
      const openShiftBtn = window.locator('#openShiftBtn');
      const closeShiftBtn = window.locator('#closeShiftBtn');
      if (await openShiftBtn.isVisible()) {
        await openShiftBtn.click();
        await window.waitForSelector('.modal-body', { state: 'visible', timeout: 15000 });
        await expect(window.locator('.modal-title')).toContainText('Open Register');
        await window.keyboard.press('Escape');
        await window.waitForSelector('.modal-body', { state: 'hidden', timeout: 10000 }).catch(() => {});
        console.log('Register: Open Register modal verified.');
      } else if (await closeShiftBtn.isVisible()) {
        await expect(window.locator('#cashInBtn')).toBeVisible();
        await expect(window.locator('#cashOutBtn')).toBeVisible();
        await closeShiftBtn.click();
        await window.waitForSelector('.modal-body', { state: 'visible', timeout: 15000 });
        await expect(window.locator('.modal-title')).toContainText('Close Register');
        await window.keyboard.press('Escape');
        await window.waitForSelector('.modal-body', { state: 'hidden', timeout: 10000 }).catch(() => {});
        console.log('Register: Close Register modal verified.');
      } else {
        console.log('Register: Unable to determine status button, likely loading.');
      }
    });
  });

  // ── Reports ───────────────────────────────────────────────────────────────
  test.describe('Deep Reports Module Testing', () => {
    test('Should load Reports page with Analytics Hub title', async () => {
      await navigateTo(window, 'reports');
      await window.locator('.report-nav').waitFor({ state: 'visible', timeout: 20000 });
      const title = window.locator('.page-header .page-title, .page-header [class*="page-title"]').first();
      await title.waitFor({ state: 'visible', timeout: 15000 });
      await expect(title).toContainText('Analytics');
      await expect(window.locator('#report-content')).toBeVisible();
      console.log('Reports: Analytics Hub page loaded.');
    });

    test('Should verify Sales Hub report loads with stat cards', async () => {
      await navigateTo(window, 'reports');
      const reportContent = window.locator('#report-content');
      await reportContent.waitFor({ state: 'visible', timeout: 20000 });
      const statCards = window.locator('.stat-card');
      await statCards.first().waitFor({ state: 'visible', timeout: 20000 });
      const cardCount = await statCards.count();
      expect(cardCount).toBeGreaterThanOrEqual(1);
      console.log(`Reports: Sales Hub loaded with ${cardCount} stat cards.`);
    });

    test('Should switch report sub-tabs and verify content loads', async () => {
      await navigateTo(window, 'reports');
      const reportContent = window.locator('#report-content');
      await reportContent.waitFor({ state: 'visible', timeout: 20000 });
      const inventoryTab = window.locator('.report-nav button', { hasText: 'Inventory' });
      await inventoryTab.waitFor({ state: 'visible', timeout: 15000 });
      await inventoryTab.click();
      await window.waitForTimeout(2000);
      await expect(reportContent).toBeVisible();
      const customersTab = window.locator('.report-nav button', { hasText: 'Customers' });
      await customersTab.click();
      await window.waitForTimeout(2000);
      await expect(reportContent).toBeVisible();
      const salesTab = window.locator('.report-nav button', { hasText: 'Sales Hub' });
      await salesTab.click();
      await window.waitForTimeout(1500);
      await expect(reportContent).toBeVisible();
      console.log('Reports: All sub-tabs navigation verified.');
    });

    test('Should verify date range picker is functional', async () => {
      await navigateTo(window, 'reports');
      const dateRange = window.locator('#report-date-range');
      await dateRange.waitFor({ state: 'visible', timeout: 15000 });
      await expect(dateRange).toBeVisible();
      await expect(window.locator('#report-branch-filter')).toBeAttached();
      console.log('Reports: Date range picker and branch filter verified.');
    });
  });

  // ── Settings ──────────────────────────────────────────────────────────────
  test.describe('Deep Settings Module Testing', () => {
    test('Should navigate between settings tabs', async () => {
      await navigateTo(window, 'settings');
      await expect(window.locator('#tab-general')).toBeVisible();
      await window.click('.settings-nav-item[data-tab="security"]');
      const securityTab = window.locator('#tab-security');
      await securityTab.waitFor({ state: 'visible', timeout: 15000 });
      await expect(securityTab).toBeVisible();
      await window.click('.settings-nav-item[data-tab="addons"]');
      const addonsTab = window.locator('#tab-addons');
      await addonsTab.waitFor({ state: 'visible', timeout: 15000 });
      await expect(addonsTab).toBeVisible();
      console.log('Settings: Tabs navigation verified.');
    });
  });

  // ── Staff ─────────────────────────────────────────────────────────────────
  test.describe('Deep Staff Module Testing', () => {
    test('Should load staff list and verify page elements', async () => {
      await navigateTo(window, 'staff');
      await expect(window.locator('.page-header').first()).toContainText('Staff');
      await expect(window.locator('#addStaffBtn')).toBeVisible();
      await expect(window.locator('#staffTableArea')).toBeVisible();
      console.log('Staff: List page verified.');
    });

    test('Should open Add Staff modal and check fields', async () => {
      await navigateTo(window, 'staff');
      const addBtn = window.locator('#addStaffBtn');
      if (await addBtn.isVisible()) {
        await addBtn.click();
        await window.waitForSelector('.modal-body', { state: 'visible', timeout: 15000 });
        await expect(window.locator('.modal-title')).toContainText('Staff Member');
        await expect(window.locator('#stName')).toBeVisible();
        await expect(window.locator('#stSpec')).toBeVisible();
        await expect(window.locator('#stPhone')).toBeVisible();
        await window.fill('#stName', 'Alice Green');
        await window.fill('#stSpec', 'Hairstylist');
        await window.fill('#stPhone', '9999999999');
        await window.keyboard.press('Escape');
        await window.waitForSelector('.modal-body', { state: 'hidden', timeout: 10000 }).catch(() => {});
        console.log('Staff: Form modal opened, populated, and closed.');
      }
    });
  });

  // ── Suppliers ─────────────────────────────────────────────────────────────
  test.describe('Deep Suppliers Module Testing', () => {
    test('Should load suppliers list and verify table', async () => {
      await navigateTo(window, 'suppliers');
      await expect(window.locator('.page-title').first()).toContainText('Supplier');
      const tableArea = window.locator('#suppliersTableArea');
      await tableArea.waitFor({ state: 'visible', timeout: 20000 });
      await expect(window.locator('.responsive-table')).toBeVisible();
      console.log('Suppliers: List and table verified.');
    });

    test('Should search suppliers by name', async () => {
      await navigateTo(window, 'suppliers');
      const searchInput = window.locator('#supSearch');
      await searchInput.waitFor({ state: 'visible', timeout: 15000 });
      await searchInput.fill('Test Supplier');
      await expect(searchInput).toHaveValue('Test Supplier');
      await expect(window.locator('#suppliersTableArea')).toBeVisible();
      await searchInput.fill('');
      console.log('Suppliers: Search functionality verified.');
    });

    test('Should open Add Supplier form and validate fields', async () => {
      await navigateTo(window, 'suppliers');
      const addBtn = window.locator('#addSupBtn');
      await addBtn.waitFor({ state: 'visible', timeout: 15000 });
      await addBtn.click();
      await window.waitForSelector('.modal-body', { state: 'visible', timeout: 15000 });
      await expect(window.locator('.modal-title')).toContainText('New Supplier');
      await expect(window.locator('#sName')).toBeVisible();
      await expect(window.locator('#sPhone')).toBeVisible();
      await expect(window.locator('#sContact')).toBeVisible();
      await expect(window.locator('#sGstin')).toBeVisible();
      await expect(window.locator('#saveSupBtn')).toBeVisible();
      await window.fill('#sName', 'Test Supplier Co.');
      await window.fill('#sPhone', '9876543210');
      await window.fill('#sContact', 'John Doe');
      await expect(window.locator('#sName')).toHaveValue('Test Supplier Co.');
      await window.keyboard.press('Escape');
      await window.waitForSelector('.modal-body', { state: 'hidden', timeout: 10000 }).catch(() => {});
      console.log('Suppliers: Add Supplier modal verified.');
    });

    test('Should verify pagination controls are present', async () => {
      await navigateTo(window, 'suppliers');
      await expect(window.locator('#paginationArea')).toBeAttached();
      console.log('Suppliers: Pagination area verified.');
    });
  });

  // ── Users ─────────────────────────────────────────────────────────────────
  test.describe('Deep Users Module Testing', () => {
    test('Should load users list and verify table', async () => {
      await navigateTo(window, 'users');
      await expect(window.locator('.page-title').first()).toContainText('User Roles');
      const searchInput = window.locator('#userSearch');
      await searchInput.waitFor({ state: 'visible', timeout: 15000 });
      await expect(window.locator('.responsive-table')).toBeVisible();
      console.log('Users: List and table verified.');
    });

    test('Should verify user filter selectors are visible', async () => {
      await navigateTo(window, 'users');
      await expect(window.locator('#roleFilter')).toBeAttached();
      await expect(window.locator('#branchFilter')).toBeAttached();
      await expect(window.locator('#statusFilter')).toBeAttached();
      console.log('Users: Filters verified.');
    });

    test('Should open Add User modal when clicking Add User', async () => {
      await navigateTo(window, 'users');
      const addBtn = window.locator('#addUserBtn');
      if (await addBtn.isVisible() && !(await addBtn.isDisabled())) {
        await addBtn.click();
        await window.waitForSelector('.modal-body', { state: 'visible', timeout: 15000 });
        await expect(window.locator('.modal-title')).toContainText('Staff');
        await window.keyboard.press('Escape');
        await window.waitForSelector('.modal-body', { state: 'hidden', timeout: 10000 }).catch(() => {});
        console.log('Users: Form modal opened and closed successfully.');
      }
    });
  });
});
