import { test, expect } from '@playwright/test';
import { launchApp, login, navigateTo } from './test-helper';

test.describe('Deep Catalog Module Testing', () => {
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

  test('Should load Catalog view and verify grid and filters', async () => {
    await navigateTo(window, 'catalog');

    // Verify page title
    const title = window.locator('.page-title');
    await expect(title).toHaveText(/Product Catalog/i);

    // Verify search input
    const searchInput = window.locator('#catalogSearchInput');
    await searchInput.waitFor({ state: 'visible', timeout: 5000 });
    await expect(searchInput).toBeVisible();

    // Verify filter dropdowns exist
    await expect(window.locator('#catalogCategorySelect')).toBeVisible();
    await expect(window.locator('#catalogFloorSelect')).toBeVisible();
    await expect(window.locator('#catalogSortSelect')).toBeVisible();

    // Verify Quick Toggles
    await expect(window.locator('text=In Stock Only')).toBeVisible();
    await expect(window.locator('text=Special Offers')).toBeVisible();

    // Verify Catalog Grid area
    const gridArea = window.locator('#catalogGridArea');
    await expect(gridArea).toBeVisible();

    console.log('Catalog: Layout, filters, and grid area verified.');
  });
});
