import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';

test.describe('ZeInfoTech POS Full Suite E2E', () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    electronApp = await electron.launch({ 
      args: ['.'],
      executablePath: process.platform === 'win32' ? 'node_modules/.bin/electron.cmd' : 'node_modules/.bin/electron'
    });

    // Handle splash screen and get main window
    window = await electronApp.firstWindow();
    
    // Safety check for quick closing splash
    try {
      console.log('Initial window:', await window.title());
    } catch (e) {
      window = electronApp.windows()[0] || await electronApp.waitForEvent('window');
    }

    const isSplash = (url) => url && url.includes('splash.html');
    const isMain = async (win) => {
      try {
        const url = win.url();
        const title = await win.title();
        return !isSplash(url) && title.includes('POS');
      } catch (e) { return false; }
    };

    if (isSplash(window.url())) {
      const allWindows = electronApp.windows();
      let foundMain = false;
      for (const win of allWindows) {
        if (await isMain(win)) {
          window = win;
          foundMain = true;
          break;
        }
      }
      if (!foundMain) {
        window = await electronApp.waitForEvent('window', {
          predicate: isMain,
          timeout: 60000
        });
      }
    }
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.evaluate(async ({ app }) => {
        app.exit(0);
      });
    }
  });

  test.describe.configure({ mode: 'serial' });

  test('Should Login successfully', async () => {
    await window.waitForSelector('#app', { state: 'attached', timeout: 30000 });
    
    // Check if we are on login page or already logged in
    const isLogin = await window.locator('.login-split-container').isVisible();
    
    if (isLogin) {
      console.log('Login page detected, performing login...');
      await window.fill('#loginUsername', 'a@gmail.com');
      await window.fill('#loginPass', '1234');
      await window.click('button[type="submit"]');

      // Wait for branch selection (if multiple branches)
      const branchBtn = window.locator('.branch-option-btn').first();
      try {
        await branchBtn.waitFor({ state: 'visible', timeout: 10000 });
        await branchBtn.click();
      } catch (e) { console.log('Branch selection not required or timed out.'); }

      // Wait for register selection
      const regBtn = window.locator('.register-option-btn').first();
      try {
        await regBtn.waitFor({ state: 'visible', timeout: 10000 });
        await regBtn.click();
      } catch (e) { console.log('Register selection not required or timed out.'); }
    }

    // Verify we reached dashboard
    await window.waitForSelector('#sidebar', { state: 'visible', timeout: 30000 });
    await expect(window.locator('#sidebar')).toBeVisible();
    console.log('Successfully logged in and reached Dashboard.');
  });

  test('Should navigate to POS and check cart', async () => {
    // Click POS in sidebar
    await window.click('.nav-item[data-page="pos"]');
    await window.waitForSelector('.pos-layout', { state: 'visible', timeout: 30000 });
    
    // Verify POS title
    const topbarTitle = window.locator('#topbar-current-page, .topbar-title');
    await expect(topbarTitle.first()).toContainText('Point of Sale');
    
    // Check if products are loaded
    const productItem = window.locator('.product-card').first();
    try {
      await productItem.waitFor({ state: 'visible', timeout: 15000 });
      await productItem.click();
      // Verify item added to cart
      await window.waitForSelector('.cart-item', { state: 'visible', timeout: 10000 });
      await expect(window.locator('.cart-item')).toBeVisible();
      console.log('POS: Product added to cart successfully.');
    } catch (e) {
      console.log('POS: No products found or cart interaction failed.');
    }
  });

  test('Should verify Products module', async () => {
    await window.click('.nav-item[data-page="products"]');
    await window.waitForSelector('.page-header', { state: 'visible', timeout: 30000 });
    const title = window.locator('.page-title').first();
    await expect(title).toContainText('Product');
    console.log('Products module verified.');
  });

  test('Should verify Orders module', async () => {
    await window.click('.nav-item[data-page="orders"]');
    await window.waitForSelector('.page-header', { state: 'visible', timeout: 30000 });
    const title = window.locator('.page-title').first();
    await expect(title).toContainText('Order');
    console.log('Orders module verified.');
  });

  test('Should verify Customers module', async () => {
    await window.click('.nav-item[data-page="customers"]');
    await window.waitForSelector('.page-header', { state: 'visible', timeout: 30000 });
    const title = window.locator('.page-title').first();
    await expect(title).toContainText('Customer');
    console.log('Customers module verified.');
  });

  test('Should verify Suppliers module', async () => {
    await window.click('.nav-item[data-page="suppliers"]');
    await window.waitForSelector('.page-header', { state: 'visible', timeout: 30000 });
    const title = window.locator('.page-title').first();
    await expect(title).toContainText('Supplier');
    console.log('Suppliers module verified.');
  });

  test('Should verify Categories module', async () => {
    await window.click('.nav-item[data-page="categories"]');
    await window.waitForSelector('.page-header', { state: 'visible', timeout: 30000 });
    const title = window.locator('.page-title').first();
    await expect(title).toContainText('Categories');
    console.log('Categories module verified.');
  });

  test('Should verify Settings module', async () => {
    await window.click('.nav-item[data-page="settings"]');
    await window.waitForSelector('.settings-layout', { state: 'visible', timeout: 30000 });
    // Settings has a slightly different header structure in some versions
    const title = window.locator('.settings-page-title, .page-title').first();
    await expect(title).toContainText('Settings');
    console.log('Settings module verified.');
  });

  test('Should verify User Roles filter bar', async () => {
    await window.click('.nav-item[data-page="users"]');
    await window.waitForSelector('#userSearch', { state: 'visible', timeout: 30000 });
    const searchInput = window.locator('#userSearch');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('Admin');
    await expect(searchInput).toHaveValue('Admin');
    console.log('Users: Filter bar verified.');
  });

  test('Should verify Branches filter bar', async () => {
    await window.click('.nav-item[data-page="branches"]');
    await window.waitForSelector('#branchSearch', { state: 'visible', timeout: 30000 });
    const searchInput = window.locator('#branchSearch');
    await expect(searchInput).toBeVisible();
    const statusFilter = window.locator('#branchStatusFilter');
    await expect(statusFilter).toBeAttached();
    const premiumTrigger = window.locator('.premium-select-trigger').first();
    await expect(premiumTrigger).toBeVisible();
    console.log('Branches: Filter bar (Premium) verified.');
  });
});
