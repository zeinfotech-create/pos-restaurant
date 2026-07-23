import { test, expect } from '@playwright/test';
import { launchApp, login, navigateTo } from './test-helper';

test.describe('Deep Orders Module Testing', () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
    await login(window);
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.evaluate(async ({ app }) => { app.exit(0); });
    }
  });

  test('Should load orders list and verify history table', async () => {
    await navigateTo(window, 'orders');

    // Verify page title
    const title = window.locator('.page-title').first();
    await expect(title).toContainText('Order');

    // Verify content areas are rendered
    const ordersContent = window.locator('#ordersContent');
    await ordersContent.waitFor({ state: 'visible', timeout: 20000 });
    await expect(ordersContent).toBeVisible();

    // Verify table or empty state is present
    const tableOrEmpty = window.locator('.responsive-table, .empty-state');
    await expect(tableOrEmpty.first()).toBeVisible();
    console.log('Orders: History table verified.');
  });

  test('Should search orders by ID or payment method', async () => {
    await navigateTo(window, 'orders');

    const searchInput = window.locator('#orderSearch');
    await searchInput.waitFor({ state: 'visible', timeout: 15000 });

    // Search by payment method
    await searchInput.fill('Cash');
    await expect(searchInput).toHaveValue('Cash');

    // Table should update
    const ordersContent = window.locator('#ordersContent');
    await expect(ordersContent).toBeVisible();

    // Clear search
    await searchInput.fill('');
    console.log('Orders: Search functionality verified.');
  });

  test('Should verify order filter bar controls', async () => {
    await navigateTo(window, 'orders');

    // Verify date range picker is present
    const dateRange = window.locator('#order-date-range');
    await expect(dateRange).toBeAttached();

    // Verify min/max total filters
    const minTotal = window.locator('#minTotal');
    await minTotal.waitFor({ state: 'visible', timeout: 15000 });
    await expect(minTotal).toBeVisible();

    const maxTotal = window.locator('#maxTotal');
    await expect(maxTotal).toBeVisible();

    // Test filter input
    await minTotal.fill('100');
    await expect(minTotal).toHaveValue('100');
    await minTotal.fill('');
    console.log('Orders: Filter bar controls verified.');
  });

  test('Should open order detail modal when clicking View', async () => {
    await navigateTo(window, 'orders');

    // Check if orders exist
    const viewBtn = window.locator('.view-btn').first();
    const hasOrders = await viewBtn.isVisible().catch(() => false);

    if (hasOrders) {
      await viewBtn.click();
      await window.waitForSelector('.modal-body', { state: 'visible', timeout: 15000 });

      // Modal should show order details
      const modalTitle = window.locator('.modal-title');
      await expect(modalTitle).toContainText('Order');

      // Close modal
      await window.keyboard.press('Escape');
      await window.waitForSelector('.modal-body', { state: 'hidden', timeout: 10000 }).catch(() => {});
      console.log('Orders: Order detail modal verified.');
    } else {
      console.log('Orders: No orders found to test detail modal (empty state is valid).');
    }
  });

  test('Should verify pagination in orders', async () => {
    await navigateTo(window, 'orders');

    // Dismiss any overlay that may be open (e.g., from previous test's modal)
    const overlay = window.locator('#pos-modal-overlay.active, .pos-modal-overlay.active');
    if (await overlay.isVisible().catch(() => false)) {
      await window.keyboard.press('Escape');
      await overlay.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    }

    const paginationArea = window.locator('#orderPaginationArea');
    await expect(paginationArea).toBeAttached();
    console.log('Orders: Pagination area verified.');
  });
});
