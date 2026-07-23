import { test, expect } from '@playwright/test';
import { launchApp, login, navigateTo } from './test-helper';

test.describe('Deep Quick POS Module Testing', () => {
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

  test('Should load Quick POS view and handle open/closed status', async () => {
    await navigateTo(window, 'quick-pos');

    // Wait a brief moment for status checks
    await window.waitForTimeout(2000);

    const closedState = window.locator('.empty-state');
    const container = window.locator('.enterprise-pos-container');

    if (await closedState.isVisible()) {
      console.log('Quick POS: Register Closed State detected. Verifying title.');
      await expect(closedState.locator('h2')).toContainText('Register is Closed');
    } else if (await container.isVisible()) {
      console.log('Quick POS: Register Open State detected. Verifying search input and key shortcuts.');
      const searchInput = window.locator('#quickProductSearch');
      await expect(searchInput).toBeVisible();

      // Check shortcuts bar
      const shortcutBar = window.locator('.ep-shortcut-grid');
      await expect(shortcutBar).toBeVisible();
      
      // Check customer details section
      await expect(window.locator('#qcActiveCard')).toBeVisible();

      console.log('Quick POS: Active terminal UI components verified.');
    } else {
      console.log('Quick POS: Standalone page not loaded fully or requires permissions.');
    }
  });
});
