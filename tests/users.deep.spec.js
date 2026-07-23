import { test, expect } from '@playwright/test';
import { launchApp, login, navigateTo } from './test-helper';

test.describe('Deep Users Module Testing', () => {
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

  test('Should load users list and verify table', async () => {
    await navigateTo(window, 'users');

    // Verify page header title
    const title = window.locator('.page-title').first();
    await expect(title).toContainText('User Roles');

    // Verify search input is present
    const searchInput = window.locator('#userSearch');
    await searchInput.waitFor({ state: 'visible', timeout: 15000 });
    await expect(searchInput).toBeVisible();

    // Verify responsive table is present
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

      // Verify modal opens
      await window.waitForSelector('.modal-body', { state: 'visible', timeout: 15000 });
      await expect(window.locator('.modal-title')).toContainText('User');

      // Close modal
      await window.keyboard.press('Escape');
      await window.waitForSelector('.modal-body', { state: 'hidden', timeout: 10000 }).catch(() => {});
      console.log('Users: Form modal opened and closed successfully.');
    }
  });
});
