const { _electron: electron } = require('@playwright/test');

(async () => {
  try {
    console.log('Launching electron...');
    const app = await electron.launch({
      args: [
        '--disable-gpu',
        '--no-sandbox',
        '.'
      ],
      executablePath: 'node_modules/.bin/electron.cmd',
      env: { ...process.env, CI: 'true', ELECTRON_ENABLE_LOGGING: '1' },
      timeout: 30000
    });
    console.log('Launched! Waiting for window...');
    const win = await app.firstWindow();
    console.log('Window acquired:', await win.title());
    await app.close();
    console.log('Success');
  } catch (e) {
    console.error('Error:', e);
  }
})();
