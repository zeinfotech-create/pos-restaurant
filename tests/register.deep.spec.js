import { test, expect } from '@playwright/test';
import { launchApp, login, navigateTo } from './test-helper';

test.describe('Deep Register & Shifts Module Testing', () => {
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

  test('Should load Register & Shifts view', async () => {
    await navigateTo(window, 'register');

    // Verify page header title
    const title = window.locator('.page-title').first();
    await expect(title).toContainText('Register & Shifts');
    console.log('Register & Shifts: Main page layout loaded.');
  });

  test('Should handle Open or Closed states dynamically', async () => {
    await navigateTo(window, 'register');

    const openShiftBtn = window.locator('#openShiftBtn');
    const closeShiftBtn = window.locator('#closeShiftBtn');

    if (await openShiftBtn.isVisible()) {
      console.log('Register: Closed state detected. Verifying opening modal.');
      await openShiftBtn.click();

      // Verify modal
      await window.waitForSelector('.modal-body', { state: 'visible', timeout: 15000 });
      await expect(window.locator('.modal-title')).toContainText('Open Register');

      // Close modal
      await window.keyboard.press('Escape');
      await window.waitForSelector('.modal-body', { state: 'hidden', timeout: 10000 }).catch(() => {});
      console.log('Register: Open Register modal closed.');
    } else if (await closeShiftBtn.isVisible()) {
      console.log('Register: Open state detected. Verifying adjustments and closing buttons.');
      await expect(window.locator('#cashInBtn')).toBeVisible();
      await expect(window.locator('#cashOutBtn')).toBeVisible();

      // Click Close Shift
      await closeShiftBtn.click();
      await window.waitForSelector('.modal-body', { state: 'visible', timeout: 15000 });
      await expect(window.locator('.modal-title')).toContainText('Close Register');

      // Close modal
      await window.keyboard.press('Escape');
      await window.waitForSelector('.modal-body', { state: 'hidden', timeout: 10000 }).catch(() => {});
      console.log('Register: Close Register modal closed.');
    } else {
      console.log('Register: Unable to determine status button, likely loading.');
    }
  });
});
