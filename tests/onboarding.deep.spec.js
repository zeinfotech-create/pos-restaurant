import { test, expect } from '@playwright/test';
import { launchApp, navigateTo, login } from './test-helper';

test.describe('Deep Onboarding Module Testing', () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    ({ electronApp, window } = await launchApp());
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.evaluate(async ({ app }) => { app.exit(0); });
    }
  });

  test('Should load Onboarding view and verify steps', async () => {
    await navigateTo(window, 'onboarding');

    // Wait for the step container to be visible
    const heroTitle = window.locator('.onboarding-hero-content h2');
    await expect(heroTitle).toBeVisible();
    
    // The first step should show business info or welcome
    // Standalone first step: Local POS Setup / Business Info
    // We check for the next button which is universal
    const nextBtn = window.locator('#nextStepBtn');
    await expect(nextBtn).toBeVisible();

    // Verify progress dots exist
    const dots = await window.locator('.progress-dot').count();
    expect(dots).toBeGreaterThan(0);

    // Verify first step input
    if (await window.locator('text=Business Info').count() > 0) {
       await expect(window.locator('#oBusinessName')).toBeVisible();
       await nextBtn.click();
       // Should advance to Industry step
       await expect(window.locator('text=Select Industry')).toBeVisible();
    }
  });
});
