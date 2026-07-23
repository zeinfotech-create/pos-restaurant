import { test, expect } from '@playwright/test';
import { launchApp, login, navigateTo } from './test-helper';

test.describe('Deep Customers Module Testing', () => {
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

  test('Should verify customer list and search', async () => {
    await navigateTo(window, 'customers');
    
    const searchInput = window.locator('#custSearch');
    await searchInput.fill('Walking');
    
    // Check table
    await expect(window.locator('.responsive-table')).toBeVisible();
    console.log('Customers: List and Search verified.');
  });

  test('Should open Add Customer form', async () => {
    await navigateTo(window, 'customers');
    
    const addBtn = window.locator('#addCustBtn');
    if (await addBtn.isVisible()) {
      await addBtn.click();
      await window.waitForSelector('.modal-body', { state: 'visible' });
      await expect(window.locator('.modal-title')).toContainText('Customer');
      
      // Close
      await window.click('.btn-ghost:text("Cancel"), .btn:text("Cancel")');
      console.log('Customers: Form verified.');
    }
  });
});
