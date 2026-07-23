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
});
