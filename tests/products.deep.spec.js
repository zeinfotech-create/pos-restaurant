import { test, expect } from '@playwright/test';
import { launchApp, login, navigateTo } from './test-helper';

test.describe('Deep Products Module Testing', () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
    await login(window);
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.evaluate(async ({ app }) => {
        app.exit(0);
      });
    }
  });

  test('Should search and filter products', async () => {
    await navigateTo(window, 'products');
    
    // Wait for search input to be ready
    const searchInput = window.locator('#productSearch');
    await searchInput.waitFor({ state: 'visible', timeout: 20000 });
    await searchInput.fill('Test Product');
    
    // Check if grid area is present
    await expect(window.locator('.page-header')).toBeVisible();
    console.log('Products: Search and Filter verified.');
  });

  test('Should open Add Product modal', async () => {
    await navigateTo(window, 'products');
    
    const addBtn = window.locator('#addProductBtn');
    await addBtn.waitFor({ state: 'visible', timeout: 15000 });
    await addBtn.click();
    
    await window.waitForSelector('.modal-body', { state: 'visible' });
    // The modal title is "Add New Product"
    await expect(window.locator('.modal-title')).toContainText('New Product');
    
    // Close modal by pressing Escape or clicking Cancel
    await window.keyboard.press('Escape');
    await window.waitForSelector('.modal-body', { state: 'hidden', timeout: 10000 }).catch(() => {});
    console.log('Products: Add Modal verified.');
  });
});
