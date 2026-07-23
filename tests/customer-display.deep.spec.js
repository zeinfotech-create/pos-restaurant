import { test, expect } from '@playwright/test';
import { launchApp, navigateTo, login } from './test-helper';

test.describe('Deep Customer Display Module Testing', () => {
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

  test('Should load Customer Display empty state', async () => {
    await navigateTo(window, 'customer-display');

    // In an empty state, it should show the welcome screen
    const welcome = window.locator('.customer-display-welcome');
    await expect(welcome).toBeVisible();
    
    // Verify system live indicator
    await expect(window.locator('.live-indicator')).toBeVisible();
    await expect(window.locator('text=System Live')).toBeVisible();
  });
});
