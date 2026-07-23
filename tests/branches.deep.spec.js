import { test, expect } from '@playwright/test';
import { launchApp, login, navigateTo } from './test-helper';

test.describe('Deep Branches Module Testing', () => {
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

  test('Should load branches list and verify table', async () => {
    await navigateTo(window, 'branches');

    // Verify page header title
    const title = window.locator('.page-title').first();
    await expect(title).toContainText('Branch Management');

    // Verify search input is present
    const searchInput = window.locator('#branchSearch');
    await searchInput.waitFor({ state: 'visible', timeout: 15000 });
    await expect(searchInput).toBeVisible();

    // Verify responsive table is present
    await expect(window.locator('.responsive-table')).toBeVisible();
    console.log('Branches: List and table verified.');
  });

  test('Should verify branch status filter', async () => {
    await navigateTo(window, 'branches');

    const statusFilter = window.locator('#branchStatusFilter');
    await expect(statusFilter).toBeAttached();
    console.log('Branches: Status filter verified.');
  });

  test('Should open Add Branch modal if clicking Add Branch', async () => {
    await navigateTo(window, 'branches');

    const addBtn = window.locator('#addBranchBtn');
    if (await addBtn.isVisible() && !(await addBtn.isDisabled())) {
      await addBtn.click();

      // Verify modal opens
      await window.waitForSelector('.modal-body', { state: 'visible', timeout: 15000 });
      await expect(window.locator('.modal-title')).toContainText('Branch');

      // Close modal
      await window.keyboard.press('Escape');
      await window.waitForSelector('.modal-body', { state: 'hidden', timeout: 10000 }).catch(() => {});
      console.log('Branches: Add Branch modal opened and closed.');
    }
  });
});
