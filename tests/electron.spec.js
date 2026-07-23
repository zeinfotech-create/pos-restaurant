import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';

test('Application should launch and display main content', async () => {
  // Launch Electron app
  const electronApp = await electron.launch({
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
      DISPLAY: process.env.DISPLAY || ':99',
    },
  });

  let window = await electronApp.firstWindow();
  
  // Safety check: if window is already closed, get the next available one
  try {
    console.log('Initial window detected:', await window.title(), '| URL:', window.url());
  } catch (e) {
    console.log('Initial window closed quickly, getting next available...');
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
    console.log('Splash screen detected, checking if main window is already open...');
    
    // Check all current windows
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
      console.log('Main window not found in current windows, waiting for new window event...');
      window = await electronApp.waitForEvent('window', {
        predicate: isMain,
        timeout: 60000
      });
    }
  }

  console.log('Final window selected:', await window.title(), '| URL:', window.url());

  // Verify window title
  expect(await window.title()).toMatch(/POS/);

  // Verify that the main app container exists
  await window.waitForSelector('#app', { state: 'attached', timeout: 30000 });
  
  // Detect app state
  const pageState = await Promise.race([
    window.waitForSelector('#sidebar', { state: 'visible', timeout: 15000 }).then(() => 'dashboard'),
    window.waitForSelector('.login-split-container', { state: 'visible', timeout: 15000 }).then(() => 'login'),
    window.waitForSelector('.onboarding-container', { state: 'visible', timeout: 15000 }).then(() => 'onboarding')
  ]).catch(() => 'unknown');

  console.log('App state detected:', pageState);

  if (pageState === 'dashboard') {
    await expect(window.locator('#sidebar')).toBeVisible();
  } else if (pageState === 'login') {
    await expect(window.locator('.login-card-premium')).toBeVisible();
  } else if (pageState === 'onboarding') {
    await expect(window.locator('.onboarding-container')).toBeVisible();
  }

  // Final screenshot
  await window.screenshot({ path: `tests/screenshots/app-launch-${pageState}.png` });

  // Force close the app immediately to avoid backup delays and timeouts
  await electronApp.evaluate(async ({ app }) => {
    app.exit(0);
  });
});
