import { getSettings, saveOrder, updateProduct, updateShiftSales, saveStaffIncentive, updateAppointmentStatus, getCustomers } from '../db.js';
import { store, getCartTotals, clearCart } from '../store.js';
import { openModal, closeModal } from '../components/Modal.js';
import { showToast } from '../components/Toast.js';
import { confirmOrder, showQuickAddMethodPopup } from './CheckoutService.js';
import { escapeHtml } from '../utils/escapeHtml.js';

let qcHandler = null;

const baseMethodConfigs = {
    // --- Standard Methods ---
    'cash':         { id: 'c', icon: 'fa-money-bill-1',       color: '#10b981' },
    'card':         { id: 'a', icon: 'fa-credit-card',         color: '#3b82f6' },
    'upi':          { id: 'u', icon: 'fa-mobile-screen-button', color: '#6366f1' },
    'wallet':       { id: 'w', icon: 'fa-wallet',              color: '#f59e0b' },
    'store credit': { id: 's', icon: 'fa-vault',              color: '#6366f1' },
    // --- Popular UPI Apps ---
    'phonepe':      { id: 'p', icon: 'fa-mobile-screen',       color: '#5f259f' },
    'phone pe':     { id: 'p', icon: 'fa-mobile-screen',       color: '#5f259f' },
    'gpay':         { id: 'g', icon: 'fa-mobile-screen-button', color: '#4285f4' },
    'google pay':   { id: 'g', icon: 'fa-mobile-screen-button', color: '#4285f4' },
    'paytm':        { id: 't', icon: 'fa-mobile-screen-button', color: '#00baf2' },
    'amazon pay':   { id: 'm', icon: 'fa-basket-shopping',     color: '#ff9900' },
    'cred':         { id: 'd', icon: 'fa-star',                color: '#1a1a2e' },
    // --- Banking Methods ---
    'net banking':  { id: 'n', icon: 'fa-building-columns',    color: '#0ea5e9' },
    'bank transfer':{ id: 'b', icon: 'fa-building-columns',    color: '#0ea5e9' },
    'neft':         { id: 'f', icon: 'fa-building-columns',    color: '#0ea5e9' },
    'rtgs':         { id: 'i', icon: 'fa-building-columns',    color: '#0ea5e9' },
    'cheque':       { id: 'q', icon: 'fa-file-invoice',        color: '#64748b' },
    'check':        { id: 'q', icon: 'fa-file-invoice',        color: '#64748b' },
    // --- Card Types ---
    'debit card':   { id: 'd', icon: 'fa-credit-card',         color: '#3b82f6' },
    'credit card':  { id: 'e', icon: 'fa-credit-card',         color: '#ef4444' },
};

// Smart icon/color guesser for completely custom payment types
export function resolveMethodConfig(methodName) {
    if (!methodName) return { icon: 'fa-receipt', color: '#64748b' };
    const lower = methodName.toLowerCase().trim();
    // Keyword mapping for smart fallback
    const keywords = [
        { words: ['phone', 'mobile', 'upi', 'pay'], icon: 'fa-mobile-screen-button', color: '#6366f1' },
        { words: ['card', 'visa', 'master', 'amex', 'rupay'], icon: 'fa-credit-card', color: '#3b82f6' },
        { words: ['bank', 'neft', 'rtgs', 'imps', 'net'], icon: 'fa-building-columns', color: '#0ea5e9' },
        { words: ['cash', 'money'], icon: 'fa-money-bill-1', color: '#10b981' },
        { words: ['wallet', 'payzapp', 'freecharge'], icon: 'fa-wallet', color: '#f59e0b' },
        { words: ['cheque', 'check'], icon: 'fa-file-invoice', color: '#64748b' },
        { words: ['crypto', 'bitcoin'], icon: 'fa-coins', color: '#f7931a' },
    ];
    for (const { words, icon, color } of keywords) {
        if (words.some(w => lower.includes(w))) return { icon, color };
    }
    return { icon: 'fa-receipt', color: '#64748b' };
}

export async function openQuickCheckout(onSuccess = null) {
    const settings = await getSettings();
    const cur = settings.currency;
    const { total, subtotal, grossTax, orderDiscount, itemDiscount, orderTax, roundOff } = getCartTotals();
    const customer = store.selectedCustomer;

    if (store.cart.length === 0) {
        showToast('Cart is empty', 'warning');
        return;
    }

    // Same enableCredit gate as CheckoutService.openCheckout() — "Store
    // Credit" can still be sitting in the shop's configured payment methods
    // list even after the feature's turned off in Settings > General.
    const configuredMethods = (settings.paymentMethods || []).filter(m => settings.enableCredit !== false || m.toLowerCase() !== 'store credit');

    // Case-insensitive lookup of base configs
    const configLookupByLower = Object.fromEntries(
        Object.entries(baseMethodConfigs).map(([k, v]) => [k.toLowerCase(), v])
    );

    const usedKeys = new Set(['l', 'k', 'e']); // Reserve: l=Loyalty, k=Credit, e=Escape
    const ALL_METHODS = configuredMethods.map(m => {
        const config = configLookupByLower[m.toLowerCase()];
        if (config) {
            usedKeys.add(config.id);
            return { name: m, ...config };
        }
        // Auto-assign shortcut key from method name chars
        let key = '';
        for (const char of m.toLowerCase().replace(/\s/g, '')) {
            if (!usedKeys.has(char)) { key = char; usedKeys.add(char); break; }
        }
        const resolvedFallback = resolveMethodConfig(m);
        return { id: key, name: m, icon: resolvedFallback.icon, color: resolvedFallback.color };
    });


    // --- State ---
    const defaultMethod = ALL_METHODS.length > 0 ? ALL_METHODS[0].name : '';
    let payments = [{ method: defaultMethod, amount: total }];
    let redeemedPoints = 0;
    let activeIndex = 0;
    let usePoints = false;
    let checkoutMode = 'paid'; // 'paid' or 'unpaid'
    // Guards handleConfirm() against re-entrancy — it's reachable from three
    // triggers (Enter key, a method-card click, and the confirm button), any
    // of which firing twice in quick succession would run confirmOrder()
    // concurrently and save/deduct-stock for the same sale twice.
    let isConfirming = false;

    function renderQuickCheckout() {
        const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
        const netPayable = Math.max(0, total - redeemedPoints);
        const changeDue = Math.max(0, totalPaid - netPayable);
        const outstanding = Math.max(0, netPayable - totalPaid);

        return `
        <style>
            .qc-full-wrapper { height: 100%; width: 100%; background: var(--bg-app); display: flex; flex-direction: column; }
            .qc-container { padding: 40px; max-width: 1000px; margin: 0 auto; width: 100%; display: flex; flex-direction: column; gap: 32px; color: var(--text-primary); flex: 1; overflow-y: auto; }
            
            .qc-top-strip { display: flex; justify-content: space-between; align-items: center; padding: 20px 40px; border-bottom: 1px solid var(--border); }
            .qc-brand { font-size: 24px; font-weight: 900; letter-spacing: -0.5px; display: flex; align-items: center; gap: 12px; }
            
            .qc-main-layout { display: grid; grid-template-columns: 1fr 380px; gap: 40px; }
            
            .qc-section-title { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; color: var(--text-muted); margin-bottom: 16px; }
            
            /* Left Side: Methods & Split */
            .qc-methods-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 16px; }
            .qc-method-card {
                background: var(--bg-elevated); border: 2px solid var(--border); border-radius: 16px; padding: 24px;
                display: flex; flex-direction: column; align-items: center; gap: 12px; cursor: pointer;
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); position: relative; text-align: center;
            }
            .qc-method-card.selected { border-color: var(--method-color); background: var(--method-bg); transform: translateY(-3px); box-shadow: 0 12px 24px -8px var(--method-shadow); }
            .qc-method-card .method-icon { font-size: 32px; color: var(--text-muted); }
            .qc-method-card.selected .method-icon { color: var(--method-color); }
            .qc-method-card .method-name { font-weight: 800; font-size: 16px; }
            .qc-method-card .method-key {
                position: absolute; top: 12px; right: 12px; font-size: 11px; font-weight: 900;
                background: rgba(0,0,0,0.2); padding: 2px 8px; border-radius: 6px;
            }
            .qc-method-card.disabled { opacity: 0.3; cursor: not-allowed; filter: grayscale(1); }

            .qc-split-list { margin-top: 32px; display: flex; flex-direction: column; gap: 12px; }
            .qc-split-item {
                background: var(--bg-elevated); padding: 20px; border-radius: 16px; display: flex; justify-content: space-between; align-items: center;
                border: 2px solid transparent; transition: all 0.2s;
            }
            .qc-split-item.active { border-color: var(--primary); background: var(--bg-surface); }
            .qc-split-name { display: flex; align-items: center; gap: 12px; font-weight: 700; font-size: 16px; }
            .qc-split-amount-wrap { display: flex; align-items: center; gap: 12px; }
            .qc-split-input { 
                background: transparent; border: none; color: var(--text-primary); font-size: 24px; font-weight: 900; text-align: right; width: 140px; outline: none;
                font-family: monospace;
            }
            
            /* Right Side: Summary */
            .qc-summary-card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 24px; padding: 32px; display: flex; flex-direction: column; gap: 24px; box-shadow: var(--shadow); }
            .qc-huge-total { font-size: 56px; font-weight: 900; line-height: 1; letter-spacing: -2px; margin: 8px 0; color: var(--text-primary); }
            
            .qc-stat-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px dashed var(--border); }
            .qc-stat-label { font-weight: 600; color: var(--text-secondary); }
            .qc-stat-value { font-weight: 800; font-size: 18px; }

            .qc-loyalty-widget {
                background: linear-gradient(145deg, var(--bg-elevated), var(--bg-surface));
                border-radius: 16px; padding: 20px; border: 1px solid var(--border); transition: all 0.3s;
            }
            .qc-loyalty-widget.active { border-color: var(--primary); box-shadow: 0 0 20px rgba(99, 102, 241, 0.2); }
            
            .qc-btn-confirm {
                width: 100%; background: var(--success); color: #fff; border: none; border-radius: 12px;
                padding: 16px; font-size: 16px; font-weight: 900; cursor: pointer;
                transition: all 0.2s; display: flex; justify-content: center; align-items: center; gap: 12px;
                box-shadow: 0 10px 30px -10px rgba(16, 185, 129, 0.5);
            }
            .qc-btn-confirm:hover { transform: translateY(-2px); filter: brightness(1.1); }
            
            .qc-kbd { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 6px; padding: 2px 8px; font-size: 12px; font-weight: 800; color: var(--primary-light); }
        </style>
        
        <div class="qc-full-wrapper">
            <div class="qc-top-strip">
                <div class="qc-brand"><i class="fa-solid fa-bolt" style="color:var(--accent)"></i> QUICK CHECKOUT</div>
                <div style="display:flex; align-items:center; gap:20px;">
                    <div style="text-align:right">
                        <div style="font-weight:800; font-size:16px;">${customer?.name ? escapeHtml(customer.name) : 'Walk-in Customer'}</div>
                        <div style="font-size:12px; color:var(--text-muted); font-weight:600">${customer?.phone ? escapeHtml(customer.phone) : 'Guest'}</div>
                    </div>
                    <button class="btn btn-ghost" onclick="closeModal()" style="font-size:24px"><i class="fa-solid fa-xmark"></i></button>
                </div>
            </div>

            <div class="qc-container">
                ${customer && (customer.creditBalance || 0) < 0 ? `
                  <div style="display:flex; align-items:center; gap:10px; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.3); border-radius:10px; padding:10px 14px; font-size:13px; color:var(--danger); font-weight:600;">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    <span><b>${escapeHtml(customer.name)}</b> already owes <b>${cur}${Math.abs(customer.creditBalance).toFixed(2)}</b> from previous purchases.</span>
                  </div>
                ` : ''}
                <div class="qc-main-layout">
                    <!-- Left: Payments -->
                    <div>
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px">
                            <div class="qc-section-title" style="margin:0">Select Payment Methods</div>
                            <button class="btn btn-ghost btn-sm" id="qcHeaderAddMethodBtn" type="button" style="padding:4px 8px; font-size:11px; border-radius:6px; border-color:var(--border)">
                                <i class="fa-solid fa-plus mr-4" style="color:var(--primary)"></i> Add Method
                            </button>
                        </div>
                        
                        ${ALL_METHODS.length === 0 ? `
                            <div style="text-align:center; padding:48px 32px; border:2px dashed var(--border); border-radius:var(--radius-lg); margin-bottom:24px; background:var(--bg-elevated)">
                                <i class="fa-solid fa-credit-card" style="font-size:48px; color:var(--text-muted); opacity:0.3; margin-bottom:16px; display:block"></i>
                                <h4 style="font-size:16px; font-weight:800; margin-bottom:8px; color:var(--text-main)">No Payment Methods Configured</h4>
                                <p style="font-size:12px; color:var(--text-muted); margin-bottom:20px; line-height:1.5">Configure payment methods in settings or click below to add one instantly.</p>
                                <button class="btn btn-primary" id="qcQuickAddMethodBtn" type="button">
                                    <i class="fa-solid fa-plus-circle mr-8"></i> Add Payment Method
                                </button>
                            </div>
                        ` : `
                            <div class="qc-methods-grid">
                                ${ALL_METHODS.map(m => {
                                    const isAdded = payments.some(p => p.method === m.name);
                                    const shadow = m.color.replace('#', '') + '33';
                                    return `
                                    <div class="qc-method-card ${isAdded ? 'selected' : ''}" 
                                         style="--method-color:${m.color}; --method-bg:${m.color}15; --method-shadow:#${shadow}"
                                         data-method="${m.name}">
                                        <div class="method-key">${m.id.toUpperCase()}</div>
                                        <i class="fa-solid ${m.icon} method-icon"></i>
                                        <div class="method-name">${m.name}</div>
                                    </div>
                                    `;
                                }).join('')}
                            </div>
                        `}

                        <div id="qc-payment-split-section" style="${checkoutMode === 'unpaid' ? 'opacity:0.2; pointer-events:none; filter:grayscale(1);' : ''}">
                            <div class="qc-section-title" style="margin-top:40px">Payment Split</div>
                            <div class="qc-split-list">
                                ${payments.map((p, idx) => `
                                    <div class="qc-split-item ${idx === activeIndex ? 'active' : ''}" data-idx="${idx}">
                                        <div class="qc-split-name">
                                            <i class="fa-solid ${ALL_METHODS.find(m => m.name === p.method)?.icon || 'fa-receipt'}" style="color:var(--primary)"></i>
                                            ${p.method}
                                        </div>
                                        <div class="qc-split-amount-wrap">
                                            <span style="font-size:20px; font-weight:800; color:var(--text-muted)">${cur}</span>
                                            <input type="number" class="qc-split-input" value="${p.amount.toFixed(2)}" step="0.01" data-idx="${idx}" />
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>

                        ${checkoutMode === 'unpaid' ? `
                        <div style="margin-top:40px; text-align:center; padding:40px; border:2px dashed var(--border); border-radius:24px; background:rgba(255,255,255,0.02)">
                            <i class="fa-solid fa-hand-holding-dollar" style="font-size:48px; color:var(--text-muted); opacity:0.5; margin-bottom:16px"></i>
                            <div style="font-size:18px; font-weight:800; color:var(--text-main)">Sale marked as Unpaid</div>
                            <div style="font-size:13px; color:var(--text-muted); margin-top:8px">Total balance will be recorded as customer debt.</div>
                        </div>
                        ` : ''}
                    </div>

                    <!-- Right: Summary -->
                    <div>
                        <div class="qc-summary-card">
                            <div>
                                ${settings.enableCredit !== false ? `
                                <div class="qc-section-title">Transaction Mode</div>
                                <div style="display:flex; background:var(--bg-elevated); border:1px solid var(--border); border-radius:16px; padding:4px; margin-bottom:16px; gap:4px;">
                                    <button class="qc-mode-btn ${checkoutMode === 'paid' ? 'active' : ''}" data-mode="paid" style="flex:1; padding:10px; border-radius:12px; border:none; font-weight:800; font-size:12px; cursor:pointer; background:${checkoutMode === 'paid' ? 'var(--success)' : 'transparent'}; color:${checkoutMode === 'paid' ? '#fff' : 'var(--text-muted)'}; transition:all 0.2s">
                                        <i class="fa-solid fa-money-bill-check mr-4"></i> PAID
                                    </button>
                                    <button class="qc-mode-btn ${checkoutMode === 'unpaid' ? 'active' : ''}" data-mode="unpaid" style="flex:1; padding:10px; border-radius:12px; border:none; font-weight:800; font-size:12px; cursor:pointer; background:${checkoutMode === 'unpaid' ? 'var(--danger)' : 'transparent'}; color:${checkoutMode === 'unpaid' ? '#fff' : 'var(--text-muted)'}; transition:all 0.2s">
                                        <i class="fa-solid fa-hand-holding-dollar mr-4"></i> UNPAID
                                    </button>
                                </div>
                                ` : ''}

                                <div class="qc-section-title">Net Payable</div>
                                <div class="qc-huge-total" id="net-payable-val">${cur}${(total - redeemedPoints).toFixed(2)}</div>
                            </div>

                            <!-- Order Breakdown -->
                            <div style="display:flex; flex-direction:column; gap:6px; padding: 14px 0; border-bottom: 1px dashed var(--border); font-size:13px;">
                                <div style="display:flex; justify-content:space-between; color:var(--text-secondary)">
                                    <span>Subtotal</span>
                                    <span style="font-weight:600">${cur}${subtotal.toFixed(2)}</span>
                                </div>
                                ${itemDiscount > 0 ? `
                                <div style="display:flex; justify-content:space-between;">
                                    <span style="color:#10b981">Item Discount</span>
                                    <span style="font-weight:600; color:#10b981">−${cur}${itemDiscount.toFixed(2)}</span>
                                </div>
                                ` : ''}
                                ${grossTax > 0 ? `
                                <div style="display:flex; justify-content:space-between; color:var(--text-secondary)">
                                    <span>Item Tax</span>
                                    <span style="font-weight:600">${cur}${grossTax.toFixed(2)}</span>
                                </div>
                                ` : ''}
                                ${orderDiscount > 0 ? `
                                <div style="display:flex; justify-content:space-between;">
                                    <span style="color:#10b981">Extra Discount</span>
                                    <span style="font-weight:600; color:#10b981">−${cur}${orderDiscount.toFixed(2)}</span>
                                </div>
                                ` : ''}
                                ${orderTax > 0 ? `
                                <div style="display:flex; justify-content:space-between; color:var(--text-secondary)">
                                    <span>Extra Tax</span>
                                    <span style="font-weight:600">+${cur}${orderTax.toFixed(2)}</span>
                                </div>
                                ` : ''}
                                ${Math.abs(roundOff) > 0.001 ? `
                                <div style="display:flex; justify-content:space-between; color:var(--text-secondary)">
                                    <span>Round Off</span>
                                    <span style="font-weight:600">${roundOff > 0 ? '+' : ''}${cur}${roundOff.toFixed(2)}</span>
                                </div>
                                ` : ''}
                            </div>
                            ${settings.enableLoyalty !== false && customer ? `
                            <div class="qc-loyalty-widget ${usePoints ? 'active' : ''}" id="qc-loyalty-widget" style="${checkoutMode === 'unpaid' ? 'display:none' : ''}">
                                <div style="display:flex; justify-content:space-between; align-items:center;">
                                    <div style="flex:1">
                                        <div style="font-weight:800; display:flex; align-items:center; gap:8px">
                                            <i class="fa-solid fa-star" style="color:var(--accent)"></i> Loyalty points
                                        </div>
                                        <div style="font-size:12px; color:var(--text-muted); margin-top:4px">
                                            Avail: <b>${customer.loyaltyPoints || 0}</b> (${cur}${customer.loyaltyPoints || 0})
                                        </div>
                                        ${usePoints ? `
                                        <div style="margin-top:12px">
                                            <label style="font-size:10px; font-weight:700; color:var(--accent); text-transform:uppercase">Points to Use:</label>
                                            <input type="number" id="redeem-points-input" class="qc-split-input" value="${redeemedPoints}" max="${customer.loyaltyPoints}" style="width:100%; height:32px; font-size:14px; margin-top:4px" />
                                        </div>
                                        ` : ''}
                                    </div>
                                    <div style="text-align:right">
                                        <div style="font-size:24px; font-weight:900; color:${usePoints ? 'var(--primary-light)' : 'var(--text-muted)'}" id="redeemed-val">
                                            -${cur}${redeemedPoints.toFixed(2)}
                                        </div>
                                        <div style="font-size:10px; font-weight:800; color:var(--text-muted)">PRESS [L]</div>
                                    </div>
                                </div>
                            </div>
                            
                            <div id="qc-credit-info-box" style="margin-top:16px; padding:20px; background:rgba(255, 71, 87, 0.03); border:2px solid rgba(255, 71, 87, 0.3); border-radius:16px; ${checkoutMode === 'paid' ? 'display:none' : ''}">
                                <label style="font-size:10px; font-weight:800; color:var(--danger); text-transform:uppercase; display:block; margin-bottom:8px">Credit Note (Required)</label>
                                <input type="text" id="qc-credit-note" class="qc-split-input" placeholder="e.g. Order #New" style="width:100%; height:40px; font-size:14px; text-align:left; border-bottom:1px solid var(--border)" />
                            </div>
                            ` : ''}

                            <div style="margin-top:16px">
                                <label style="font-size:10px; font-weight:800; color:var(--text-muted); text-transform:uppercase; display:block; margin-bottom:8px">Delivery Vehicle (optional)</label>
                                <div style="position:relative">
                                    <i class="fa-solid fa-truck-fast" style="position:absolute; left:14px; top:50%; transform:translateY(-50%); color:var(--text-muted); font-size:13px"></i>
                                    <input type="text" id="qc-delivery-vehicle" class="qc-split-input" placeholder="e.g. TN01AB1234" style="width:100%; height:40px; font-size:14px; text-align:left; border-bottom:1px solid var(--border); padding-left:32px" />
                                </div>
                            </div>

                            <div style="margin-top: 12px">
                                <div class="qc-stat-row">
                                    <span class="qc-stat-label">Collected</span>
                                    <span class="qc-stat-value" style="color:var(--success)" id="collected-val">${cur}${totalPaid.toFixed(2)}</span>
                                </div>
                                <div class="qc-stat-row" id="credit-used-row" style="display:none">
                                    <span class="qc-stat-label">Credit Used</span>
                                    <span class="qc-stat-value" style="color:#6366f1" id="used-credit-val">- ${cur}0.00</span>
                                </div>
                                <div class="qc-stat-row">
                                    <span class="qc-stat-label" id="outstanding-label">Outstanding</span>
                                    <span class="qc-stat-value" id="outstanding-val" style="color:${outstanding > 0.05 ? 'var(--danger)' : 'var(--text-muted)'}">${cur}${outstanding.toFixed(2)}</span>
                                </div>
                                <div class="qc-stat-row" style="border:none">
                                    <span class="qc-stat-label">Change Due</span>
                                    <span class="qc-stat-value" style="color:var(--accent)" id="changedue-val">${cur}${changeDue.toFixed(2)}</span>
                                </div>
                            </div>

                            <button class="qc-btn-confirm" id="quickConfirmBtn">
                                <i class="fa-solid fa-check-double"></i>
                                COMPLETE SALE
                            </button>
                            
                            <div style="text-align:center; font-size:12px; color:var(--text-muted); font-weight:600">
                                <kbd class="qc-kbd">C</kbd> Cash • <kbd class="qc-kbd">U</kbd> UPI • <kbd class="qc-kbd">A</kbd> Card • <kbd class="qc-kbd">L</kbd> Loyalty • <kbd class="qc-kbd">K</kbd> Credit
                            </div>
                            <div style="text-align:center; font-size:12px; color:var(--text-muted); font-weight:600; margin-top:8px">
                                <kbd class="qc-kbd">ESC</kbd> or <kbd class="qc-kbd">ALT+E</kbd> to Cancel
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        `;
    }

    function refresh(focusInput = true) {
        const body = document.querySelector('.modal-body');
        if (body) {
            body.innerHTML = renderQuickCheckout();
            setupInteractions(focusInput);
        }
    }

    function setupInteractions(focusInput) {
        if (qcHandler) window.removeEventListener('keydown', qcHandler);

        qcHandler = async (e) => {
            const key = e.key.toLowerCase();
            const isAlt = e.altKey;
            const isInput = e.target.tagName === 'INPUT';

            // 1. Close logic (Always work)
            if (key === 'escape' || (isAlt && key === 'e')) {
                e.preventDefault();
                closeModal();
                return;
            }

            // --- Navigation inside inputs ---
            if (isInput && (key === 'arrowup' || key === 'arrowdown')) {
                const inputs = document.querySelectorAll('.qc-split-input');
                const myIdx = Array.from(inputs).indexOf(e.target);
                if (myIdx !== -1) {
                    e.preventDefault();
                    const nextIdx = key === 'arrowdown' ? (myIdx + 1) % inputs.length : (myIdx - 1 + inputs.length) % inputs.length;
                    inputs[nextIdx].focus();
                    inputs[nextIdx].select();
                    return;
                }
            }

            // 2. Functional Shortcuts (C, U, A, W, S, L, K) - These should work even in inputs
            const isMethodKey = ALL_METHODS.find(m => m.id === key);
            const isOtherKey = ['l', 'k'].includes(key);

            if (isMethodKey || isOtherKey) {
                e.preventDefault(); // Stop the letter from typing in the input
                
                if (isMethodKey) {
                    const methodDef = isMethodKey;
                    const existingIdx = payments.findIndex(p => p.method === methodDef.name);
                    if (existingIdx !== -1) {
                        if (payments.length > 1) {
                            const removed = payments.splice(existingIdx, 1)[0];
                            payments[0].amount += removed.amount;
                        }
                    } else {
                        const netPayable = Math.max(0, total - redeemedPoints);
                        const balance = Math.max(0, netPayable - payments.reduce((s, p) => s + p.amount, 0));
                        payments.push({ method: methodDef.name, amount: balance });
                        activeIndex = payments.length - 1;
                    }
                    refresh();
                } else if (key === 'l' && customer) {
                    usePoints = !usePoints;
                    const maxPoints = Math.min(customer.loyaltyPoints || 0, total);
                    redeemedPoints = usePoints ? maxPoints : 0;
                    if (payments.length > 0) {
                        const remaining = Math.max(0, total - redeemedPoints);
                        payments[0].amount = remaining;
                    }
                    refresh(false); // don't focus standard input
                    setTimeout(() => {
                        const inp = document.getElementById('redeem-points-input');
                        if (inp) { inp.focus(); inp.select(); }
                    }, 50);
                } else if (key === 'k') {
                    if (!customer) {
                        showToast('Select a customer for Unpaid Sales', 'warning');
                        return;
                    }
                    checkoutMode = checkoutMode === 'paid' ? 'unpaid' : 'paid';
                    if (checkoutMode === 'unpaid') {
                        payments = [];
                        redeemedPoints = 0;
                        usePoints = false;
                    } else {
                        payments = [{ method: ALL_METHODS[0].name, amount: total }];
                    }
                    refresh();
                }
                return;
            }

            // 3. Input specific handling (for numbers/backspace etc)
            if (isInput) {
                if (key === 'enter') {
                    e.preventDefault();
                    await handleConfirm();
                }
                return; 
            }

            if (key === 'arrowdown') {
                e.preventDefault();
                activeIndex = (activeIndex + 1) % payments.length;
                refresh();
            }
            if (key === 'arrowup') {
                e.preventDefault();
                activeIndex = (activeIndex - 1 + payments.length) % payments.length;
                refresh();
            }

            if (key === 'enter') {
                e.preventDefault();
                await handleConfirm();
            }
        };

        window.addEventListener('keydown', qcHandler);

        document.querySelectorAll('.qc-method-card').forEach(card => {
            card.onclick = async () => {
                const method = card.dataset.method;
                const credit = card.dataset.credit;
                if (method) {
                   const mDef = ALL_METHODS.find(m => m.name === method);
                   await qcHandler({ key: mDef.id, preventDefault: () => {}, target: { tagName: 'DIV' } });
                } else if (credit) {
                   await qcHandler({ key: 'k', preventDefault: () => {}, target: { tagName: 'DIV' } });
                }
            };
        });

        document.querySelectorAll('.qc-split-input').forEach(input => {
            const idx = parseInt(input.dataset.idx);
            if (!isNaN(idx)) {
                input.onfocus = () => activeIndex = idx;
                input.oninput = (e) => {
                    const netPayable = Math.max(0, total - redeemedPoints);
                    let val = parseFloat(e.target.value) || 0;
                    
                    // Cap to Net Payable
                    if (val > netPayable) {
                        val = netPayable;
                        e.target.value = val.toFixed(2);
                    }

                    // Store Credit Capping: Don't allow using more than available
                    if (payments[idx].method === 'Store Credit' && customer) {
                        const avail = Math.max(0, customer.creditBalance || 0);
                        if (val > avail) {
                            val = avail;
                            e.target.value = val.toFixed(2);
                        }
                    }

                    payments[idx].amount = val;

                    // AUTO-BALANCE: If there are multiple payments, adjust the LAST one to cover the rest
                    if (payments.length > 1 && idx < payments.length - 1) {
                        const othersSum = payments.reduce((sum, p, i) => i !== payments.length - 1 ? sum + p.amount : sum, 0);
                        payments[payments.length - 1].amount = Math.max(0, netPayable - othersSum);
                    }
                    
                    updateSummaryOnly();
                };
            }
        });

        const pointsInp = document.getElementById('redeem-points-input');
        if (pointsInp) {
            pointsInp.oninput = (e) => {
                const val = parseFloat(e.target.value) || 0;
                const maxPoints = Math.min(customer.loyaltyPoints || 0, total);
                redeemedPoints = Math.min(val, maxPoints);
                if (payments.length > 0) {
                    payments[0].amount = Math.max(0, total - redeemedPoints);
                }
                updateSummaryOnly();
            };
        }

        if (focusInput) {
            const activeInp = document.querySelectorAll('.qc-split-input')[activeIndex];
            if (activeInp) { activeInp.focus(); activeInp.select(); }
        }

        const handleQuickAdd = () => {
            showQuickAddMethodPopup((newName) => {
                const resolved = resolveMethodConfig(newName);
                const firstChar = newName[0].toLowerCase();
                let shortcutKey = '';
                if (!usedKeys.has(firstChar)) {
                    shortcutKey = firstChar;
                    usedKeys.add(firstChar);
                } else {
                    for (const char of newName.toLowerCase().replace(/\s/g, '')) {
                        if (!usedKeys.has(char)) { shortcutKey = char; usedKeys.add(char); break; }
                    }
                }
                if (!shortcutKey) shortcutKey = 'x'; // safe fallback
                
                ALL_METHODS.push({ id: shortcutKey, name: newName, icon: resolved.icon, color: resolved.color });
                if (payments.length === 0 || !payments[0].method) {
                    payments = [{ method: newName, amount: total }];
                }
                refresh();
            }, '.qc-full-wrapper');
        };

        const qcQuickAddBtn = document.getElementById('qcQuickAddMethodBtn');
        if (qcQuickAddBtn) qcQuickAddBtn.onclick = handleQuickAdd;

        const qcHeaderAddBtn = document.getElementById('qcHeaderAddMethodBtn');
        if (qcHeaderAddBtn) qcHeaderAddBtn.onclick = handleQuickAdd;

        const confirmBtn = document.getElementById('quickConfirmBtn');
        if (confirmBtn) confirmBtn.onclick = async () => await handleConfirm();

        // Mode Toggles
        document.querySelectorAll('.qc-mode-btn').forEach(el => {
            el.onclick = () => {
                checkoutMode = el.dataset.mode;
                if (checkoutMode === 'unpaid') {
                    payments = [];
                    redeemedPoints = 0;
                    usePoints = false;
                } else {
                    payments = [{ method: ALL_METHODS[0].name, amount: total }];
                }
                refresh();
            };
        });

        // Always update summary after render so smart credit values are correct
        updateSummaryOnly();
    }

    function updateSummaryOnly() {
        const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
        const creditApplied = payments.filter(p => p.method === 'Store Credit').reduce((s, p) => s + p.amount, 0);
        const netPayable = Math.max(0, total - redeemedPoints);
        const changeDue = Math.max(0, totalPaid - netPayable);
        const outstanding = Math.max(0, netPayable - totalPaid);
        
        const collectedEl = document.getElementById('collected-val');
        const outstandingEl = document.getElementById('outstanding-val');
        const outstandingLabelEl = document.getElementById('outstanding-label');
        const changeDueEl = document.getElementById('changedue-val');
        const netPayableEl = document.getElementById('net-payable-val');
        const redeemedEl = document.getElementById('redeemed-val');
        const usedCreditEl = document.getElementById('used-credit-val');
        const creditUsedRowEl = document.getElementById('credit-used-row');
        const creditUsedDisplayEl = document.getElementById('credit-used-display');

        // --- Smart Mode Summary ---
        const displayOutstanding = outstanding;
        const hasDebt = checkoutMode === 'unpaid' || outstanding > 0.05;

        if (collectedEl) collectedEl.innerText = `${cur}${totalPaid.toFixed(2)}`;
        if (creditUsedRowEl) creditUsedRowEl.style.display = creditApplied > 0.01 ? '' : 'none';
        if (usedCreditEl) usedCreditEl.innerText = `- ${cur}${creditApplied.toFixed(2)}`;
        if (creditUsedDisplayEl) creditUsedDisplayEl.innerText = `-${cur}${creditApplied.toFixed(2)}`;
        if (outstandingEl) {
            outstandingEl.innerText = `${cur}${displayOutstanding.toFixed(2)}`;
            outstandingEl.style.color = hasDebt ? 'var(--danger)' : 'var(--text-muted)';
        }
        if (outstandingLabelEl) outstandingLabelEl.innerText = hasDebt ? 'Remaining Debt' : 'Outstanding';
        if (changeDueEl) changeDueEl.innerText = `${cur}${changeDue.toFixed(2)}`;
        if (netPayableEl) netPayableEl.innerText = `${cur}${netPayable.toFixed(2)}`;
        if (redeemedEl) redeemedEl.innerText = `-${cur}${redeemedPoints.toFixed(2)}`;

        // Sync payment input values (critical for loyalty point changes)
        const inputs = document.querySelectorAll('.qc-split-input');
        payments.forEach((p, i) => {
            const inp = Array.from(inputs).find(el => parseInt(el.dataset.idx) === i);
            if (inp && document.activeElement !== inp) {
                inp.value = p.amount.toFixed(2);
            }
        });
    }

    async function handleConfirm() {
        if (isConfirming) return;

        const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
        const netPayable = Math.max(0, total - redeemedPoints);
        const outstanding = Math.max(0, netPayable - totalPaid);

        const isUnpaid = checkoutMode === 'unpaid';
        const creditNote = document.getElementById('qc-credit-note')?.value;
        const deliveryVehicle = document.getElementById('qc-delivery-vehicle')?.value.trim() || '';

        // Mode logic
        if (isUnpaid) {
            if (!customer) {
                showToast('Customer selection is mandatory for Unpaid sales!', 'warning');
                return;
            }
            if (!creditNote) {
                showToast('Credit Note is required for Unpaid transactions!', 'warning');
                return;
            }
        } else if (outstanding > 0.01) {
            showToast('Amount incomplete. Add more payment or switch to UNPAID mode.', 'warning');
            return;
        }

        // --- Mandatory Payment Type Validation ---
        const invalidRow = payments.find(p => p.amount > 0.01 && !p.method);
        if (invalidRow && !isUnpaid) {
            showToast('Please select a Payment Type for all payment rows.', 'warning');
            return;
        }

        let validPayments = isUnpaid ? [] : payments.filter(p => p.amount > 0.01).map(p => ({ ...p }));

        // A cashier may type a tendered amount larger than what's owed to
        // see "Change Due" — intentional. But the SAVED payment must only
        // reflect what was actually retained, or shift.collections/
        // cashSales get inflated by the change amount (see CheckoutService.js's
        // identical fix for the full explanation) — clamp the excess back
        // out of the recorded payments before they're saved.
        if (!isUnpaid) {
          let excess = validPayments.reduce((s, p) => s + p.amount, 0) - netPayable;
          if (excess > 0.001) {
            for (let i = validPayments.length - 1; i >= 0 && excess > 0.001; i--) {
              const reduceBy = Math.min(validPayments[i].amount, excess);
              validPayments[i].amount = parseFloat((validPayments[i].amount - reduceBy).toFixed(2));
              excess -= reduceBy;
            }
            validPayments = validPayments.filter(p => p.amount > 0.01);
          }
        }

        const confirmData = () => ({
            isCredit: isUnpaid,
            creditInfo: creditNote || (isUnpaid ? 'Unpaid Sale' : ''),
            redeemedPoints,
            creditUsed: 0,
            deliveryVehicle
        });

        isConfirming = true;
        let succeeded = false;
        try {
            succeeded = await confirmOrder(validPayments, getCartTotals(), settings, cur, confirmData());
        } finally {
            isConfirming = false;
        }
        // confirmOrder() already showed an error toast on failure (register
        // closed, save error, etc.) — closing the modal and firing onSuccess
        // anyway would tell the cashier the sale went through when it didn't.
        if (!succeeded) return;
        if (qcHandler) window.removeEventListener('keydown', qcHandler);
        closeModal();
        if (onSuccess) onSuccess();
    }

    const observer = new MutationObserver(() => {
        if (!document.querySelector('.modal')) {
            if (qcHandler) window.removeEventListener('keydown', qcHandler);
            observer.disconnect();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    openModal({
        title: 'Quick Checkout',
        body: renderQuickCheckout(),
        footer: '',
        hideHeader: true,
        hideClose: true,
        fullScreen: true
    });

    setTimeout(() => setupInteractions(true), 0);
}
