import { _electron as electron } from '@playwright/test';

export async function launchApp() {
  const isCI = !!process.env.CI;

  const electronApp = await electron.launch({
    // GPU flags must come BEFORE the app path ('.')
    args: [
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-gpu-compositing',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '.',
    ],
    executablePath: process.platform === 'win32'
      ? 'node_modules/.bin/electron.cmd'
      : 'node_modules/.bin/electron',
    env: {
      ...process.env,
      CI: 'true',
      // Ensure xvfb display is used on Linux CI
      DISPLAY: process.env.DISPLAY || ':99',
    },
  });

  let window = await electronApp.firstWindow();
  
  // Robust window detection
  try {
    await window.title();
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

  // Forward console logs and page errors to terminal for debugging
  window.on('console', msg => {
    console.log(`[Browser Console] [${msg.type()}] ${msg.text()}`);
  });
  window.on('pageerror', err => {
    console.error(`[Browser PageError] ${err.stack || err.message}`);
  });

  return { electronApp, window };
}

export async function login(window) {
  // Wait for the app router to settle on one of the three possible initial screens
  console.log('Waiting for router to settle...');
  try {
    await window.waitForSelector('.onboarding-wrapper, .login-split-container, .sidebar-nav', { state: 'visible', timeout: 5000 });
  } catch (err) {
    const bodyHtml = await window.locator('body').innerHTML().catch(() => '');
    console.log('Body DOM Content at timeout:', bodyHtml);
    await window.waitForSelector('.onboarding-wrapper, .login-split-container, .sidebar-nav', { state: 'visible', timeout: 25000 });
  }

  const isOnboarding = await window.locator('.onboarding-wrapper').isVisible().catch(() => false);
  const initialState = isOnboarding ? 'onboarding' : 'other';
  console.log(`Router settled on: ${initialState}`);

  // 1. Handle Potential Onboarding (Fresh Install in CI)
  if (initialState === 'onboarding') {
    console.log('Detected Onboarding flow. Automating setup...');
    
    // Step 1: Business Info
    await window.fill('#oBusinessName', 'CI Test Store');
    await window.click('#nextStepBtn');
    
    // Step 2: Industry
    await window.waitForSelector('.industry-item[data-type="General"]', { state: 'visible', timeout: 10000 });
    await window.click('.industry-item[data-type="General"]');
    await window.click('#nextStepBtn');
    
    // Step 3: Admin Security
    await window.waitForSelector('#oAdminPassword', { state: 'visible', timeout: 10000 });
    await window.fill('#oAdminPassword', '1234');
    
    // Ensure "Load Sample Data" is checked (has .active class)
    const loadToggle = window.locator('#loadDataToggle');
    if (!(await loadToggle.evaluate(node => node.classList.contains('active')))) {
      await loadToggle.click();
    }
    
    await window.click('#nextStepBtn');
    
    console.log('Setup finished, waiting for app reload and next screen to appear...');
    await window.waitForSelector('.login-split-container, .sidebar-nav', { state: 'visible', timeout: 35000 }).catch(() => {});
    const isLoginScreen = await window.locator('.login-split-container').isVisible().catch(() => false);
    console.log('Post-onboarding screen detected:', isLoginScreen ? 'login' : 'dashboard');
  }

  // 2. Handle Login (Force logout first if a non-admin session is active)
  const sessionData = await window.evaluate(() => {
    return new Promise((resolve) => {
      const req = indexedDB.open('zepos_db', 3);
      req.onsuccess = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('pos_session')) {
          resolve(null);
          return;
        }
        const tx = db.transaction('pos_session', 'readonly');
        const getReq = tx.objectStore('pos_session').get('current');
        getReq.onsuccess = () => resolve(getReq.result || null);
        getReq.onerror = () => resolve(null);
      };
      req.onerror = () => resolve(null);
    });
  }).catch(() => null);

  const sessionExists = !!sessionData;
  const loggedInUser = sessionData?.data?.user?.name || '';
  console.log(`Session active: ${sessionExists}, Current logged-in user: "${loggedInUser}"`);
  if (sessionExists && loggedInUser !== 'Admin') {
    console.log(`Active session is not Admin (User: '${loggedInUser}'), forcing logout...`);
    await window.evaluate(() => {
      window.location.hash = '';
      window.__old_page = true;
    });
    await window.click('#userProfileBtn');
    await window.waitForSelector('#mLogoutBtn', { state: 'visible', timeout: 5000 });
    
    console.log('Clicking logout button and waiting for page reload to settle...');
    await window.click('#mLogoutBtn');
    await window.waitForFunction(() => !window.__old_page, { timeout: 15000 }).catch(() => {});
    await window.waitForLoadState('domcontentloaded').catch(() => {});
    return login(window);
  }

  await window.waitForSelector('.login-split-container, .sidebar-nav', { state: 'visible', timeout: 5000 }).catch(() => {});
  const isLoginVisible = await window.locator('.login-split-container').isVisible().catch(() => false);

  if (isLoginVisible) {
    // Standardize on 'Admin' with '1234' password as created by onboarding.
    // This guarantees full administrative permissions across all test suites.
    const loginUsername = 'Admin';
    
    await window.fill('#loginUsername', loginUsername);
    await window.fill('#loginPass', '1234');
    await window.click('button[type="submit"]');

    // Wait and check if login failed (e.g. if the DB is in some other state)
    const errToast = await window.locator('.toast.error').isVisible().catch(() => false);
    if (errToast) {
       console.log('Login failed with Admin, trying default a@gmail.com as fallback...');
       await window.fill('#loginUsername', 'a@gmail.com');
       await window.click('button[type="submit"]');
    }

    const branchBtn = window.locator('.branch-option-btn').first();
    try {
      await branchBtn.waitFor({ state: 'visible', timeout: 10000 });
      await branchBtn.click();
    } catch (e) {}

    const regBtn = window.locator('.register-option-btn').first();
    try {
      await regBtn.waitFor({ state: 'visible', timeout: 10000 });
      await regBtn.click();
    } catch (e) {}
  }

  await window.waitForSelector('.sidebar-nav', { state: 'visible', timeout: 30000 });
  // Let initial DB migrations, sync engine initialization, and UI rendering settle
  await window.waitForTimeout(2500);

  // Disable register routine programmatically so register shift is bypassed in automated testing
  await window.evaluate(async () => {
    console.log('[Test Helper] Starting IndexedDB settings override...');
    try {
      await new Promise((resolve, reject) => {
        const req = indexedDB.open('zepos_db', 3);
        req.onsuccess = (event) => {
          console.log('[Test Helper] Raw IndexedDB opened successfully.');
          const db = event.target.result;
          const transaction = db.transaction(['pos_settings'], 'readwrite');
          const store = transaction.objectStore('pos_settings');
          const getReq = store.get('global_settings');
          getReq.onsuccess = () => {
            console.log('[Test Helper] Retreived global settings:', getReq.result);
            const data = getReq.result || { id: 'global_settings' };
            data.enableRegisterRoutine = false;
            data.settingsLockEnabled = false;
            const putReq = store.put(data);
            putReq.onsuccess = () => {
              console.log('[Test Helper] Bypassed global register routine via raw IndexedDB successfully!');
              resolve();
            };
            putReq.onerror = (err) => {
              console.error('[Test Helper] putReq failed:', err);
              reject(new Error('Failed to put settings'));
            };
          };
          getReq.onerror = (err) => {
            console.error('[Test Helper] getReq failed:', err);
            reject(new Error('Failed to get settings'));
          };
        };
        req.onerror = (err) => {
          console.error('[Test Helper] open failed:', err);
          reject(new Error('Failed to open IndexedDB'));
        };
      });
    } catch (e) {
      console.error('[Test Helper] Failed to bypass global register routine via raw IndexedDB:', e);
    }
  });
}

export async function navigateTo(window, page) {
  const targetPath = page === 'reports' ? 'reports/sales' : page;
  
  const currentPath = await window.evaluate(() => {
    return window.location.hash.replace('#', '') || 'dashboard';
  });
  
  if (currentPath === targetPath) {
    console.log(`[NavigateTo] Already on page: ${targetPath}, skipping re-navigation.`);
  } else {
    // Navigate programmatically to completely bypass sidebar animations and click timing issues
    await window.evaluate(async path => {
      if (typeof window.navigate === 'function') {
        await window.navigate(path);
      } else {
        window.location.hash = path;
      }
    }, targetPath);
  }
  
  // Map page to a unique selector that only exists on that target page
  let uniqueSelector = '';
  if (page === 'pos') {
    uniqueSelector = '.pos-layout';
  } else if (page === 'settings') {
    uniqueSelector = '.settings-layout';
  } else if (page === 'reports') {
    uniqueSelector = '#report-content';
  } else if (page === 'branches') {
    uniqueSelector = '#addBranchBtn, #branchTableBody';
  } else if (page === 'customers') {
    uniqueSelector = '#custSearch';
  } else if (page === 'suppliers') {
    uniqueSelector = '#supSearch';
  } else if (page === 'users') {
    uniqueSelector = '#addUserBtn, #userSearch';
  } else if (page === 'staff') {
    uniqueSelector = '#addStaffBtn';
  } else if (page === 'register') {
    uniqueSelector = '#openShiftBtn, #closeShiftBtn, #cashInBtn';
  } else if (page === 'orders') {
    uniqueSelector = '#orderSearch, #ordersTableBody';
  } else if (page === 'quick-pos') {
    uniqueSelector = '.enterprise-pos-container, #quickProductSearch';
  } else if (page === 'catalog') {
    uniqueSelector = '#catalogGridArea, #catalogSearchInput';
  } else if (page === 'categories') {
    uniqueSelector = '.categories-layout, #addCategoryBtn';
  } else if (page === 'inventory-log') {
    uniqueSelector = '#inventory-log-page, #inventoryLogTableBody';
  } else {
    uniqueSelector = '.page-header';
  }
  
  await window.waitForSelector(uniqueSelector, { state: 'visible', timeout: 30000 });
}
