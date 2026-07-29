import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { store, initStore, addToCart, removeFromCart, updateCartItem, updateQty, clearCart, getCartTotals, setDiscount } from './store';

// Mock DB
vi.mock('./db.js', () => ({
  db: {
    init: vi.fn(),
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn()
  },
  KEYS: { SESSION: 'session' },
  getSettings: vi.fn().mockResolvedValue({
    taxRate: 18,
    roundOffEnabled: true
  }),
  saveSettings: vi.fn(),
  getCurrentBranch: vi.fn().mockResolvedValue({ id: 'b1' }),
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'u1' }),
  getCurrentRegisterId: vi.fn().mockResolvedValue('r1')
}));

// Mock Toast
vi.mock('./components/Toast.js', () => ({
  showToast: vi.fn()
}));

describe('Store State and Cart Engine', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    store.cart = [];
    store.discount = 0;
    store.discountRaw = 0;
    store.discountType = 'flat';
    store.isInitialized = false;
    
    await initStore();
  });

  it('should initialize store with correct configurations', () => {
    expect(store.isInitialized).toBe(true);
    expect(store.branch.id).toBe('b1');
    expect(store.user.id).toBe('u1');
    expect(store.registerId).toBe('r1');
  });

  it('should add items to the cart', () => {
    const product = { id: 'p1', name: 'Coffee', price: 100, stock: 10, unit: 'pcs' };
    addToCart(product, null, 2);
    
    expect(store.cart.length).toBe(1);
    expect(store.cart[0].qty).toBe(2);
    expect(store.cart[0].price).toBe(100);
  });

  it('should remove items from the cart', () => {
    const product = { id: 'p1', name: 'Coffee', price: 100, stock: 10, unit: 'pcs' };
    const cartId = addToCart(product, null, 2);
    
    removeFromCart(cartId);
    expect(store.cart.length).toBe(0);
  });

  it('should update quantities in the cart', () => {
    const product = { id: 'p1', name: 'Coffee', price: 100, stock: 10, unit: 'pcs' };
    const cartId = addToCart(product, null, 2);
    
    updateQty(cartId, 3);
    expect(store.cart[0].qty).toBe(5);
  });

  it('should prevent adding past stock limit', async () => {
    const { showToast } = await import('./components/Toast.js');
    const product = { id: 'p1', name: 'Coffee', price: 100, stock: 2, unit: 'pcs' };
    
    addToCart(product, null, 3);
    expect(showToast).toHaveBeenCalledWith('Only 2 items in stock', 'warning');
  });

  it('should calculate cart totals correctly with tax', () => {
    const product = { id: 'p1', name: 'Premium Coffee', price: 100, stock: 10, unit: 'pcs', taxRate: 10, taxType: 'exclusive' };
    addToCart(product, null, 1); // Total inclusive base = 100 base + 10 tax = 110 gross

    const totals = getCartTotals();

    expect(totals.grossTotal).toBe(110);
    expect(totals.total).toBe(110);
  });

  it('should support manual discounts', () => {
    const product = { id: 'p1', name: 'Coffee', price: 100, stock: 10, unit: 'pcs', taxRate: 0 };
    addToCart(product, null, 1);

    setDiscount(10, 'flat');
    const totals = getCartTotals();

    expect(totals.orderDiscount).toBe(10);
    expect(totals.total).toBe(90); // 100 subtotal - 10 flat discount
  });

  // Receipts/cart summary print Subtotal, Discount and Tax as separate lines
  // that must add up to Total (Subtotal − Discount + Tax = Total). For an
  // inclusive-tax item, item.price already contains the tax, so a raw
  // discount taken off that tax-inclusive price is itself partly "tax" —
  // displaying it unadjusted alongside a tax-EXCLUSIVE Subtotal broke that
  // arithmetic identity by exactly the discount's own tax content. These
  // cases pin the fix: itemDiscount must be scaled down by 1/(1+rate/100)
  // for inclusive items so the three printed lines always reconcile,
  // regardless of whether the discount was configured as a % or a flat ₹.
  it('reconciles Subtotal - Discount + Tax = Total for an inclusive-tax item with a % item discount', () => {
    store.settings.roundOffEnabled = false; // isolate the discount/tax basis fix from unrelated rupee rounding
    const product = { id: 'p1', name: 'Widget', price: 118, stock: 10, unit: 'pcs', taxRate: 18, taxType: 'inclusive', itemDiscountType: 'pct', itemDiscount: 10 };
    addToCart(product, null, 1);

    const totals = getCartTotals();

    expect(totals.subtotal).toBeCloseTo(100, 2);
    expect(totals.itemDiscount).toBeCloseTo(10, 2); // 10% of the 100 tax-exclusive base
    expect(totals.tax).toBeCloseTo(16.2, 2);
    expect(totals.total).toBeCloseTo(106.2, 2);
    expect(totals.subtotal - totals.itemDiscount - totals.orderDiscount + totals.tax).toBeCloseTo(totals.total, 2);
  });

  it('reconciles Subtotal - Discount + Tax = Total for an inclusive-tax item with a flat ₹ item discount', () => {
    store.settings.roundOffEnabled = false;
    const product = { id: 'p1', name: 'Widget', price: 118, stock: 10, unit: 'pcs', taxRate: 18, taxType: 'inclusive', itemDiscountType: 'flat', itemDiscount: 10 };
    addToCart(product, null, 1);

    const totals = getCartTotals();

    expect(totals.subtotal).toBeCloseTo(100, 2);
    expect(totals.itemDiscount).toBeCloseTo(8.47, 2); // tax-exclusive equivalent of the raw ₹10, i.e. 10/1.18 — rounded to 2dp same as the code's own .toFixed(2)
    expect(totals.tax).toBeCloseTo(16.47, 2);
    expect(totals.total).toBeCloseTo(108, 2);
    expect(totals.subtotal - totals.itemDiscount - totals.orderDiscount + totals.tax).toBeCloseTo(totals.total, 2);
  });

  it('still reconciles for an exclusive-tax item with a % item discount (regression check)', () => {
    store.settings.roundOffEnabled = false;
    const product = { id: 'p1', name: 'Widget', price: 100, stock: 10, unit: 'pcs', taxRate: 18, taxType: 'exclusive', itemDiscountType: 'pct', itemDiscount: 10 };
    addToCart(product, null, 1);

    const totals = getCartTotals();

    expect(totals.subtotal).toBeCloseTo(100, 2);
    expect(totals.itemDiscount).toBeCloseTo(10, 2); // exclusive items are unaffected by the fix — already on the right basis
    expect(totals.tax).toBeCloseTo(16.2, 2);
    expect(totals.total).toBeCloseTo(106.2, 2);
    expect(totals.subtotal - totals.itemDiscount - totals.orderDiscount + totals.tax).toBeCloseTo(totals.total, 2);
  });
});
