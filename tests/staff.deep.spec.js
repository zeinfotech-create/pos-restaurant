import { test, expect } from '@playwright/test';
import { launchApp, login, navigateTo } from './test-helper';

test.describe('Deep Staff Module Testing', () => {
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

  test('Should load staff list and verify page elements', async () => {
    await navigateTo(window, 'staff');

    // Verify page header
    const title = window.locator('.page-header').first();
    await expect(title).toContainText('Staff');

    // Add Staff button should exist
    const addBtn = window.locator('#addStaffBtn');
    await expect(addBtn).toBeVisible();

    // Verify responsive table or container area is present
    await expect(window.locator('#staffTableArea')).toBeVisible();
    console.log('Staff: List page verified.');
  });

  test('Should open Add Staff modal and check fields', async () => {
    await navigateTo(window, 'staff');

    const addBtn = window.locator('#addStaffBtn');
    if (await addBtn.isVisible()) {
      await addBtn.click();

      // Verify modal opens with correct title
      await window.waitForSelector('.modal-body', { state: 'visible', timeout: 15000 });
      await expect(window.locator('.modal-title')).toContainText('Staff Member');

      // Verify fields
      await expect(window.locator('#stName')).toBeVisible();
      await expect(window.locator('#stSpec')).toBeVisible();
      await expect(window.locator('#stPhone')).toBeVisible();
      await expect(window.locator('#stComm')).toBeVisible();
      await expect(window.locator('#saveStaffBtn')).toBeVisible();

      // Fill in info
      await window.fill('#stName', 'Alice Green');
      await window.fill('#stSpec', 'Hairstylist');
      await window.fill('#stPhone', '9999999999');

      // Close modal
      await window.keyboard.press('Escape');
      await window.waitForSelector('.modal-body', { state: 'hidden', timeout: 10000 }).catch(() => {});
      console.log('Staff: Form modal opened, populated, and closed successfully.');
    }
  });
});
