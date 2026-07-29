import { db, KEYS, getSettings, getCurrentBranch, getCurrentUser, getCurrentRegisterId } from './db.js';
import { showToast } from './components/Toast.js';

export const store = {
    cart: [],
    discount: 0,
    discountRaw: 0,
    discountType: 'flat',
    extraTaxRaw: 0,
    extraTaxType: 'flat',
    page: 'dashboard',
    settings: null, // Loaded in initStore
    branch: null,
    user: null,
    registerId: null,
    selectedStaff: null,
    selectedCustomer: null,
    selectedAppointmentId: null,
    isInitialized: false
};

/**
 * Initialize store from IndexedDB
 */
export async function initStore() {
    if (store.isInitialized) return;

    // Wait for DB to be ready/migrated
    await db.init();

    // Load core state
    store.settings = await getSettings();
    store.branch = await getCurrentBranch();
    store.user = await getCurrentUser();
    store.registerId = await getCurrentRegisterId();

    // Load persisted session data
    const savedCart = await db.get(KEYS.SESSION, 'pos_cart');
    if (savedCart) store.cart = savedCart.data || [];

    store.isInitialized = true;
    renderCartEvent();
}

// listen for background changes (e.g. from sync engine or other tabs)
window.addEventListener('storage-change', async (e) => {
    const { store: storeName, type, data } = e.detail;
    if (storeName === 'settings') {
        store.settings = await getSettings();
        renderCartEvent();
    }
});

// Logic moved to initStore

// Handled in initStore

let listeners = [];

// Cart operations
export function addToCart(product, variant = null, qty = 1) {
    const cartId = variant ? `${product.id}_${variant.name}` : String(product.id);
    const existing = store.cart.find(i => i.cartId === cartId);

    // Validation: Stock check
    const availableStock = variant ? variant.stock : product.stock;
    const currentQty = existing ? existing.qty : 0;
    const unit = (product.unit || '').toLowerCase();
    const isWeighed = unit === 'kg' || unit === 'g' || unit === 'kilogram' || unit === 'gram';

    // If it's a weighed item and internal call (qty=1), we might want to still check.
    // But usually for weight, we pass the exact weight.
    if (!isWeighed && currentQty + qty > availableStock) {
        showToast(`Only ${availableStock} items in stock`, 'warning');
        return;
    }

    const roundedQty = parseFloat(parseFloat(qty).toFixed(3));

    if (existing) {
        existing.qty = parseFloat((existing.qty + roundedQty).toFixed(3));
        if (existing.qty <= 0) { removeFromCart(cartId); return cartId; }
        // Move to bottom (user preference: last added/updated should be at bottom)
        store.cart = [...store.cart.filter(i => i.cartId !== cartId), existing];
    } else {
        // Mirrors updateQty()'s floor — a brand-new line must never be pushed
        // with a zero/negative qty (e.g. a stray 0 from a weight-scale read).
        if (roundedQty <= 0) return cartId;
        store.cart.push({
            ...product,
            cartId,
            variantName: variant ? variant.name : null,
            hsnCode: product.hsnCode || '',
            taxRate: product.taxRate ?? store.settings.taxRate, // Fallback
            taxType: product.taxType || 'exclusive',
            itemDiscount: (variant && typeof variant.itemDiscount !== 'undefined') ? Number(variant.itemDiscount) : (Number(product.itemDiscount) || 0),
            // Variants don't carry their own discount type yet — only the
            // product-level default does, so a variant's discount is always
            // read as flat ₹ unless the product itself (no variant) has one.
            itemDiscountType: (!variant && product.itemDiscountType === 'pct') ? 'pct' : 'flat',
            price: variant ? variant.price : product.price,
            qty: roundedQty,
            unit: product.unit || 'pcs',
            preparedQty: 0,
            originalStock: availableStock
        });
    }
    renderCartEvent();
    return cartId;
}

export function removeFromCart(cartId) {
    store.cart = store.cart.filter(i => i.cartId !== cartId);
    renderCartEvent();
}

export function updateCartItem(cartId, fields) {
    const item = store.cart.find(i => i.cartId === cartId);
    if (!item) return;
    
    if (fields.qty !== undefined) {
        fields.qty = parseFloat(parseFloat(fields.qty).toFixed(3));
    }
    
    Object.assign(item, fields);
    renderCartEvent();
}

export function updateQty(cartId, delta) {
    const item = store.cart.find(i => i.cartId === cartId);
    if (!item) return;

    // Weighed items bypass the stock cap in addToCart too (see comment there) —
    // without the same bypass here, an item added over its originalStock
    // snapshot (allowed, since weighed stock isn't tracked precisely) could
    // never be incremented again from the +/- stepper, even by a gram.
    const unit = (item.unit || '').toLowerCase();
    const isWeighed = unit === 'kg' || unit === 'g' || unit === 'kilogram' || unit === 'gram';
    if (!isWeighed && delta > 0 && item.qty + delta > item.originalStock) {
        showToast(`Limit reached: ${item.originalStock} in stock`, 'warning');
        return;
    }

    item.qty = parseFloat((item.qty + delta).toFixed(3));
    if (item.qty <= 0) removeFromCart(cartId);
    else {
        renderCartEvent();
    }
}

export async function clearCart() {
    store.cart = [];
    store.discount = 0;
    store.discountRaw = 0;
    store.discountType = 'flat';
    store.extraTaxRaw = 0;
    store.extraTaxType = 'flat';
    store.selectedStaff = null;
    store.selectedAppointmentId = null;
    renderCartEvent();
}

export function setDiscount(amount, type = 'flat') {
    store.discountRaw = Math.max(0, Number(amount) || 0);
    store.discountType = type;
    renderCartEvent();
}

export function setExtraTax(amount, type = 'flat') {
    store.extraTaxRaw = Math.max(0, Number(amount) || 0);
    store.extraTaxType = type;
    renderCartEvent();
}

export function getCartTotals() {
    const settings = store.settings || {};
    let grossTotal = 0; // Sum of (Discounted Base + Tax)
    let totalOriginalPrice = 0; // Sum of (Pre-discount, Pre-tax base)
    let reconciledTax = 0;
    let totalItemDiscounts = 0;
    let rawTaxes = {};

    store.cart.forEach(item => {
        const rate = parseFloat(item.taxRate) || 0;
        const itemQty = parseFloat(parseFloat(item.qty).toFixed(3)) || 0;
        const itemPrice = parseFloat(item.price) || 0;

        let preTaxBase = itemPrice;
        if (item.taxType === 'inclusive') {
            preTaxBase = itemPrice / (1 + (rate / 100));
        }

        totalOriginalPrice += preTaxBase * itemQty;

        const baseLineTotal = itemPrice * itemQty;
        const discountTotal = item.itemDiscountType === 'pct' 
            ? (baseLineTotal * (item.itemDiscount || 0) / 100) 
            : ((item.itemDiscount || 0) * itemQty);
        totalItemDiscounts += discountTotal;

        const discountedTotal = Math.max(0, baseLineTotal - discountTotal);
        let itemTax = 0;

        if (item.taxType === 'inclusive') {
            grossTotal += discountedTotal;
            itemTax = discountedTotal * (rate / (100 + rate));
        } else {
            itemTax = discountedTotal * (rate / 100);
            grossTotal += discountedTotal + itemTax;
        }

        reconciledTax += itemTax;
        if (rate > 0) {
            rawTaxes[rate] = (rawTaxes[rate] || 0) + itemTax;
        }
    });

    // Calculate global discount (manual)
    let orderDiscount = 0;
    if (store.discountType === 'pct') {
        orderDiscount = parseFloat((grossTotal * (store.discountRaw / 100)).toFixed(2));
    } else {
        orderDiscount = store.discountRaw;
    }

    store.discount = orderDiscount;

    // Calculate extra tax (order level)
    let orderTax = 0;
    if (store.extraTaxType === 'pct') {
        orderTax = parseFloat((grossTotal * (store.extraTaxRaw / 100)).toFixed(2));
    } else {
        orderTax = store.extraTaxRaw;
    }

    let finalAmount = Math.max(0, grossTotal - store.discount + orderTax);
    let roundOff = 0;
    if (settings.roundOffEnabled) {
        const rounded = Math.round(finalAmount);
        roundOff = rounded - finalAmount;
        finalAmount = rounded;
    }
    
    // Proportional tax reconciliation after total discount
    const totalDiscount = store.discount;
    const taxScale = grossTotal > 0 ? (grossTotal - totalDiscount) / grossTotal : 1;
    const reconciledItemTax = reconciledTax * taxScale;

    // Scale grouped taxes (post-discount, for compat)
    const groupedTaxes = [];
    // Unscaled grouped taxes (pre-discount, for display that adds up)
    const grossGroupedTaxes = [];
    Object.keys(rawTaxes).forEach(r => {
        const scaledTax = rawTaxes[r] * taxScale;
        if (scaledTax > 0.005) { 
            groupedTaxes.push({
                rate: parseFloat(r),
                amount: parseFloat(scaledTax.toFixed(2))
            });
        }
        if (rawTaxes[r] > 0.005) {
            grossGroupedTaxes.push({
                rate: parseFloat(r),
                amount: parseFloat(rawTaxes[r].toFixed(2))
            });
        }
    });
    groupedTaxes.sort((a, b) => a.rate - b.rate);
    grossGroupedTaxes.sort((a, b) => a.rate - b.rate);

    const itemCount = store.cart.reduce((sum, item) => sum + item.qty, 0);

    return {
        subtotal: parseFloat(totalOriginalPrice.toFixed(2)),
        itemCount: `<span class="cart-count">${Number.isInteger(itemCount) ? itemCount : itemCount.toFixed(3)}</span>`,
        itemDiscount: parseFloat(totalItemDiscounts.toFixed(2)),
        itemTax: parseFloat(reconciledItemTax.toFixed(2)),
        orderDiscount: parseFloat(orderDiscount.toFixed(2)),
        orderTax: parseFloat(orderTax.toFixed(2)),
        discount: store.discount + totalItemDiscounts, // total overall discount
        tax: parseFloat(reconciledItemTax.toFixed(2)), // scaled post-discount tax (compat)
        grossTax: parseFloat(reconciledTax.toFixed(2)), // PRE-discount full tax (for display breakdown)
        grossTotal: parseFloat(grossTotal.toFixed(2)),  // pre-discount total incl tax
        groupedTaxes,          // scaled (post-discount)
        grossGroupedTaxes,     // unscaled (pre-discount, for display)
        taxRate: settings.taxRate,
        roundOff: parseFloat(roundOff.toFixed(2)),
        total: parseFloat(finalAmount.toFixed(2))
    };
}

export function setCustomer(customer) {
    store.selectedCustomer = customer;
    renderCartEvent();
}

const displayChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('pos_customer_display') : null;

// Force a broadcast of the current state
export function syncCart() {
    renderCartEvent();
}

// Simple event bus for cart updates
export function onCartUpdate(fn) {
    // Prevent duplicate listeners (esp. from re-renders)
    if (listeners.includes(fn)) return;
    listeners.push(fn);
}
function renderCartEvent() {
    // Save cart to IndexedDB
    if (db) {
        db.put(KEYS.SESSION, { id: 'pos_cart', data: store.cart });
    }

    // Broadcast to Customer Display
    if (displayChannel) {
        displayChannel.postMessage({
            type: 'UPDATE_CART',
            payload: {
                ...getCartTotals(),
                items: store.cart
            }
        });
    }

    listeners.forEach(fn => fn());
}

// Reload settings
export async function reloadSettings() {
    store.settings = await getSettings();
}

/**
 * Saloon specific: Load appointment into cart
 */
export function loadAppointmentIntoCart(data) {
    const { customer, staff, appointmentId, service } = data;

    // Clear everything first
    store.cart = [];
    store.discountRaw = 0;
    store.discountType = 'flat';
    store.discount = 0;
    store.extraTaxRaw = 0;
    store.extraTaxType = 'flat';

    // Set metadata
    store.selectedCustomer = customer || null;
    store.selectedStaff = staff || null;
    store.selectedAppointmentId = appointmentId || null;

    // Add service if provided
    if (service) {
        store.cart.push({
            ...service,
            cartId: String(service.id),
            variantName: null,
            hsnCode: service.hsnCode || '',
            taxRate: service.taxRate ?? store.settings.taxRate,
            taxType: service.taxType || 'exclusive',
            itemDiscount: service.itemDiscount || 0,
            price: service.price,
            qty: 1,
            originalStock: service.stock
        });
    }

    renderCartEvent();
}

