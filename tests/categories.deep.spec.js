import { test, expect } from '@playwright/test';
import { launchApp, login, navigateTo } from './test-helper';

test.describe('Deep Categories Module Testing', () => {
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

  test('Should load categories page and verify elements', async () => {
    await navigateTo(window, 'categories');

    // Verify page header
    const title = window.locator('.page-title').first();
    await expect(title).toContainText('Categories');

    // Add category button should exist
    const addBtn = window.locator('#addCategoryBtn');
    await expect(addBtn).toBeVisible();

    // Categories list card should be rendered
    const layout = window.locator('.categories-layout');
    await expect(layout).toBeVisible();
    console.log('Categories: Layout verified.');
  });

  test('Should open New Category modal when clicking New', async () => {
    await navigateTo(window, 'categories');

    const addBtn = window.locator('#addCategoryBtn');
    await addBtn.click();

    // Verify modal opens with correct title
    await window.waitForSelector('.modal-body', { state: 'visible', timeout: 15000 });
    await expect(window.locator('.modal-title')).toContainText('Category');

    // Verify input fields are present
    await expect(window.locator('#newCatNameInput')).toBeVisible();
    await expect(window.locator('#confirmNewCat')).toBeVisible();

    // Close modal
    await window.keyboard.press('Escape');
    await window.waitForSelector('.modal-body', { state: 'hidden', timeout: 10000 }).catch(() => {});
    console.log('Categories: Modal verified successfully.');
  });
});
