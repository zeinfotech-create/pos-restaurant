import { test, expect } from '@playwright/test';
import { launchApp, login, navigateTo } from './test-helper';

test.describe('Deep Settings Module Testing', () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
    await login(window);
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.evaluate(async ({ app }) => {
        app.exit(0);
      });
    }
  });

  test('Should navigate between settings tabs', async () => {
    await navigateTo(window, 'settings');
    
    // Verify General tab is active by default
    const generalTab = window.locator('#tab-general');
    await expect(generalTab).toBeVisible();

    // Click Security tab and verify its content loads
    await window.click('.settings-nav-item[data-tab="security"]');
    const securityTab = window.locator('#tab-security');
    await securityTab.waitFor({ state: 'visible', timeout: 15000 });
    await expect(securityTab).toBeVisible();
    console.log('Settings: Security tab verified.');
    
    // Click Add-ons tab and verify its content loads
    await window.click('.settings-nav-item[data-tab="addons"]');
    const addonsTab = window.locator('#tab-addons');
    await addonsTab.waitFor({ state: 'visible', timeout: 15000 });
    await expect(addonsTab).toBeVisible();
    console.log('Settings: Add-ons tab verified.');

    console.log('Settings: Tabs navigation verified.');
  });
});
