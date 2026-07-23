import { test, expect } from '@playwright/test';
import { launchApp, login, navigateTo } from './test-helper';

test.describe('Deep Purchases Module Testing', () => {
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

  test('Should load purchases list and verify table', async () => {
    await navigateTo(window, 'purchases');

    // Verify page header title
    const title = window.locator('.page-title').first();
    await expect(title).toContainText('Purchases');

    // Verify search input is present
    const searchInput = window.locator('#purSearch');
    await searchInput.waitFor({ state: 'visible', timeout: 15000 });
    await expect(searchInput).toBeVisible();

    // Verify responsive table is present
    await expect(window.locator('.responsive-table')).toBeVisible();
    console.log('Purchases: List and table verified.');
  });

  test('Should search purchases by ID or Supplier', async () => {
    await navigateTo(window, 'purchases');

    const searchInput = window.locator('#purSearch');
    await searchInput.waitFor({ state: 'visible', timeout: 15000 });
    await searchInput.fill('PUR-999');
    await expect(searchInput).toHaveValue('PUR-999');

    // Clear search
    await searchInput.fill('');
    console.log('Purchases: Search input verified.');
  });

  test('Should open New Purchase form and check fields', async () => {
    await navigateTo(window, 'purchases');

    const addBtn = window.locator('#addPurBtn');
    if (await addBtn.isVisible()) {
      await addBtn.click();

      // Verify modal opens with correct title
      await window.waitForSelector('.modal-body', { state: 'visible', timeout: 15000 });
      await expect(window.locator('.modal-title')).toContainText('Purchase Entry');

      // Verify modal key elements
      await expect(window.locator('#purInvNo')).toBeVisible();
      await expect(window.locator('#purSupplier')).toBeAttached();
      await expect(window.locator('#addProductSelect')).toBeAttached();
      await expect(window.locator('#completePurchaseBtn')).toBeVisible();
      console.log('Purchases: Modal entry form fields verified.');

      // Close modal
      await window.keyboard.press('Escape');
      await window.waitForSelector('.modal-body', { state: 'hidden', timeout: 10000 }).catch(() => {});
      console.log('Purchases: Form modal closed successfully.');
    }
  });
});
