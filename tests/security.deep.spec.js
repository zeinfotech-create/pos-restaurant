import { test, expect } from '@playwright/test';
import { launchApp, login } from './test-helper';

test.describe('Deep Security Overlay Testing', () => {
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

  test('Should be able to invoke app lock overlay', async () => {
    // We execute the lockApp function directly in the browser context to test the overlay
    await window.evaluate(async () => {
      const { lockApp } = await import('./src/pages/Security.js');
      await lockApp();
    });

    const lockOverlay = window.locator('#app-lock-overlay');
    await expect(lockOverlay).toBeVisible();

    // Verify lock elements
    await expect(window.locator('text=System Locked')).toBeVisible();
    await expect(window.locator('.pin-pad')).toBeVisible();
    
    // Click some pins
    await window.locator('.pin-pad button[data-value="1"]').click();
    await window.locator('.pin-pad button[data-value="2"]').click();

    // Check that dots are active
    const activeDots = await window.locator('.pin-dot.active').count();
    expect(activeDots).toBe(2);

    console.log('Security: App lock overlay verified.');
  });
});
