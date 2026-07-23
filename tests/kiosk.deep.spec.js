import { test, expect } from '@playwright/test';
import { launchApp, login, navigateTo } from './test-helper';

test.describe('Deep Kiosk Module Testing', () => {
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

  test('Should load Kiosk view and verify welcome screen', async () => {
    await navigateTo(window, 'kiosk');

    // The kiosk might require activation or show welcome depending on DB state.
    // Let's check for either activation or welcome screen.
    const hasWelcome = await window.locator('.kw-title').count() > 0;
    const hasActivation = await window.locator('text=Link Kiosk').count() > 0;

    expect(hasWelcome || hasActivation).toBeTruthy();

    if (hasWelcome) {
      await expect(window.locator('.kw-tap-btn')).toBeVisible();
      console.log('Kiosk: Welcome screen verified.');
    } else {
      await expect(window.locator('#kLicenseKey')).toBeVisible();
      console.log('Kiosk: Activation screen verified.');
    }
  });
});
