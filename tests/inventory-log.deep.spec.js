import { test, expect } from '@playwright/test';
import { launchApp, login, navigateTo } from './test-helper';

test.describe('Deep Stock History Audit Module Testing', () => {
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

  test('Should load Stock History Audit view', async () => {
    await navigateTo(window, 'inventory-log');

    // Verify page header title
    const title = window.locator('.page-title').first();
    await expect(title).toContainText('Stock History Audit');

    // Verify search input is present
    const searchInput = window.locator('#logSearch');
    await searchInput.waitFor({ state: 'visible', timeout: 15000 });
    await expect(searchInput).toBeVisible();

    // Verify responsive table is present
    await expect(window.locator('.responsive-table')).toBeVisible();

    // Verify buttons
    await expect(window.locator('#exportLogsBtn')).toBeVisible();
    await expect(window.locator('#navToProductsBtn')).toBeVisible();

    console.log('Stock History Audit: Controls, table, and buttons verified.');
  });

  test('Should verify type tab filters', async () => {
    await navigateTo(window, 'inventory-log');

    const tabGroup = window.locator('.tab-group');
    await expect(tabGroup).toBeVisible();

    const allTab = window.locator('.tab-btn[data-type="All"]');
    const inTab = window.locator('.tab-btn[data-type="IN"]');
    const outTab = window.locator('.tab-btn[data-type="OUT"]');

    await expect(allTab).toBeVisible();
    await expect(inTab).toBeVisible();
    await expect(outTab).toBeVisible();

    console.log('Stock History Audit: Filter tabs verified.');
  });
});
