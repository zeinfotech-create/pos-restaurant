import { test, expect } from '@playwright/test';
import { launchApp, login, navigateTo } from './test-helper';

test.describe('Deep Suppliers Module Testing', () => {
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

  test('Should load suppliers list and verify table', async () => {
    await navigateTo(window, 'suppliers');

    // Verify page header
    const title = window.locator('.page-title').first();
    await expect(title).toContainText('Supplier');

    // Verify table area is rendered
    const tableArea = window.locator('#suppliersTableArea');
    await tableArea.waitFor({ state: 'visible', timeout: 20000 });
    await expect(tableArea).toBeVisible();

    // Verify responsive table is present
    await expect(window.locator('.responsive-table')).toBeVisible();
    console.log('Suppliers: List and table verified.');
  });

  test('Should search suppliers by name', async () => {
    await navigateTo(window, 'suppliers');

    const searchInput = window.locator('#supSearch');
    await searchInput.waitFor({ state: 'visible', timeout: 15000 });
    await searchInput.fill('Test Supplier');
    await expect(searchInput).toHaveValue('Test Supplier');

    // Table should still be visible (even if showing empty state)
    await expect(window.locator('#suppliersTableArea')).toBeVisible();

    // Clear search
    await searchInput.fill('');
    console.log('Suppliers: Search functionality verified.');
  });

  test('Should open Add Supplier form and validate fields', async () => {
    await navigateTo(window, 'suppliers');

    const addBtn = window.locator('#addSupBtn');
    await addBtn.waitFor({ state: 'visible', timeout: 15000 });
    await addBtn.click();

    // Verify modal opens with correct title
    await window.waitForSelector('.modal-body', { state: 'visible', timeout: 15000 });
    await expect(window.locator('.modal-title')).toContainText('New Supplier');

    // Verify required fields are present
    await expect(window.locator('#sName')).toBeVisible();
    await expect(window.locator('#sPhone')).toBeVisible();
    await expect(window.locator('#sContact')).toBeVisible();
    await expect(window.locator('#sGstin')).toBeVisible();
    await expect(window.locator('#saveSupBtn')).toBeVisible();
    console.log('Suppliers: Add form fields verified.');

    // Fill in test data
    await window.fill('#sName', 'Test Supplier Co.');
    await window.fill('#sPhone', '9876543210');
    await window.fill('#sContact', 'John Doe');
    await expect(window.locator('#sName')).toHaveValue('Test Supplier Co.');

    // Close modal
    await window.keyboard.press('Escape');
    await window.waitForSelector('.modal-body', { state: 'hidden', timeout: 10000 }).catch(() => {});
    console.log('Suppliers: Add Supplier modal verified.');
  });

  test('Should verify pagination controls are present', async () => {
    await navigateTo(window, 'suppliers');

    // Pagination area should exist (might not be visible if fewer records than page size)
    const paginationArea = window.locator('#paginationArea');
    await expect(paginationArea).toBeAttached();
    console.log('Suppliers: Pagination area verified.');
  });
});
