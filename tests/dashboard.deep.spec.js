import { test, expect } from '@playwright/test';
import { launchApp, login, navigateTo } from './test-helper';

test.describe('Deep Dashboard Module Testing', () => {
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

  test('Should load Dashboard view and verify essential elements', async () => {
    await navigateTo(window, 'dashboard');

    // Verify page header
    const title = window.locator('.page-title');
    await expect(title).toBeVisible();

    // Verify date range selector
    const dateRange = window.locator('#dashDateRange');
    await dateRange.waitFor({ state: 'visible', timeout: 5000 });
    await expect(dateRange).toBeVisible();

    // Verify stat cards (Sales, Orders, Avg Order, Successful)
    const statCards = window.locator('.stat-card');
    await expect(statCards).toHaveCount(4);

    // Verify Low Stock Alerts section
    await expect(window.locator('text=Low Stock Alerts')).toBeVisible();

    // Verify Payment Breakdown chart section
    await expect(window.locator('text=Payment Breakdown')).toBeVisible();

    // Verify Sales Trend chart section
    await expect(window.locator('text=Sales Trend')).toBeVisible();

    // Verify Top Products section
    await expect(window.locator('text=Top Products')).toBeVisible();

    // Verify Quick Actions
    await expect(window.locator('text=Quick Actions')).toBeVisible();

    console.log('Dashboard: Stat cards, charts, and quick actions verified.');
  });
});
