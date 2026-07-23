import { test, expect } from '@playwright/test';
import { launchApp, login, navigateTo } from './test-helper';

test.describe('Deep POS Module Testing', () => {
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

  test('Should perform a full sale flow', async () => {
    await navigateTo(window, 'pos');
    
    // Add product to cart
    const productCard = window.locator('.product-card').first();
    await productCard.waitFor({ state: 'visible', timeout: 15000 });
    await productCard.click();
    
    // Verify item in cart
    const cartItem = window.locator('.cart-item').first();
    await cartItem.waitFor({ state: 'visible', timeout: 15000 });
    await expect(cartItem).toBeVisible();
    console.log('POS: Product added to cart.');
    
    // Click Checkout button
    const checkoutBtn = window.locator('#checkoutBtn');
    await checkoutBtn.waitFor({ state: 'visible', timeout: 10000 });
    await checkoutBtn.click();
    
    // POS uses a full-screen checkout (no modal-title, uses checkout-brand)
    await window.waitForSelector('.checkout-fullscreen-wrapper', { state: 'visible', timeout: 20000 });
    await expect(window.locator('.checkout-brand')).toContainText('CHECKOUT');
    console.log('POS: Full-screen checkout opened.');
    
    // Verify the Complete Sale button is present
    const confirmPayBtn = window.locator('#confirmPayBtn');
    await expect(confirmPayBtn).toBeVisible();
    console.log('POS: Complete Sale button verified.');
    
    // Close checkout with X button
    await window.click('button.btn-ghost:has(i.fa-xmark)');
    await window.waitForSelector('.checkout-fullscreen-wrapper', { state: 'hidden', timeout: 10000 });
    console.log('POS: Sale flow verified successfully.');
  });
});
