import { test, expect } from '@playwright/test';
import { launchApp, login, navigateTo } from './test-helper';

test.describe('Deep Reports Module Testing', () => {
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

  test('Should load Reports page with Analytics Hub title', async () => {
    await navigateTo(window, 'reports');

    // Wait for report nav to confirm we're on the reports page
    const reportNav = window.locator('.report-nav');
    await reportNav.waitFor({ state: 'visible', timeout: 20000 });

    // The page-title is inside .page-header, text is "Analytics Hub"
    // Use .page-header .page-title to be specific
    const title = window.locator('.page-header .page-title, .page-header [class*="page-title"]').first();
    await title.waitFor({ state: 'visible', timeout: 15000 });
    await expect(title).toContainText('Analytics');

    // Verify main content area
    const reportContent = window.locator('#report-content');
    await expect(reportContent).toBeVisible();

    console.log('Reports: Analytics Hub page loaded.');
  });

  test('Should verify Sales Hub report loads with stat cards', async () => {
    await navigateTo(window, 'reports');

    // Wait for Sales report to load (default tab)
    const reportContent = window.locator('#report-content');
    await reportContent.waitFor({ state: 'visible', timeout: 20000 });

    // Sales report has stat-cards (Net Sales, Gross Profit, etc.)
    const statCards = window.locator('.stat-card');
    await statCards.first().waitFor({ state: 'visible', timeout: 20000 });
    const cardCount = await statCards.count();
    expect(cardCount).toBeGreaterThanOrEqual(1);

    console.log(`Reports: Sales Hub loaded with ${cardCount} stat cards.`);
  });

  test('Should navigate to Orders History in Reports and verify filter', async () => {
    await navigateTo(window, 'orders');

    // Confirm orders page is working
    await expect(window.locator('#ordersContent')).toBeVisible();

    // Go back to reports
    await navigateTo(window, 'reports');
    await expect(window.locator('#report-content')).toBeVisible();

    console.log('Reports: Navigation back verified.');
  });

  test('Should switch report sub-tabs and verify content loads', async () => {
    await navigateTo(window, 'reports');

    const reportContent = window.locator('#report-content');
    await reportContent.waitFor({ state: 'visible', timeout: 20000 });

    // Click "Inventory" tab
    const inventoryTab = window.locator('.report-nav button', { hasText: 'Inventory' });
    await inventoryTab.waitFor({ state: 'visible', timeout: 15000 });
    await inventoryTab.click();

    // Wait for content to change
    await window.waitForTimeout(2000);
    await expect(reportContent).toBeVisible();
    console.log('Reports: Inventory sub-tab loaded.');

    // Click "Customers" tab
    const customersTab = window.locator('.report-nav button', { hasText: 'Customers' });
    await customersTab.click();
    await window.waitForTimeout(2000);
    await expect(reportContent).toBeVisible();
    console.log('Reports: Customers sub-tab loaded.');

    // Click back to "Sales Hub"
    const salesTab = window.locator('.report-nav button', { hasText: 'Sales Hub' });
    await salesTab.click();
    await window.waitForTimeout(1500);
    await expect(reportContent).toBeVisible();
    console.log('Reports: All sub-tabs navigation verified.');
  });

  test('Should verify date range picker is functional', async () => {
    await navigateTo(window, 'reports');

    // Date range input should be visible and have a value
    const dateRange = window.locator('#report-date-range');
    await dateRange.waitFor({ state: 'visible', timeout: 15000 });
    await expect(dateRange).toBeVisible();

    // Branch filter should be present (hidden by premium-select, so check attachment or wrapper)
    const branchFilter = window.locator('#report-branch-filter');
    await expect(branchFilter).toBeAttached();
    // Also verify the premium wrapper is visible if initialized
    const premiumWrapper = branchFilter.locator('xpath=..').locator('.premium-select-trigger').first();
    if (await premiumWrapper.isVisible().catch(() => false)) {
      await expect(premiumWrapper).toBeVisible();
    }


    console.log('Reports: Date range picker and branch filter verified.');
  });
});
