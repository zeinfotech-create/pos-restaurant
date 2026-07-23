import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 300 * 1000,
  expect: {
    timeout: 20000
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    trace: 'on-first-retry',
  },
  // Only start Vite dev server when running locally.
  // In CI, Electron loads dist/index.html directly (npm run build runs first).
  ...(process.env.CI ? {} : {
    webServer: {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 180 * 1000,
    },
  }),
});
