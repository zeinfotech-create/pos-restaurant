// ============================================================
// CheckoutService.js — Global checkout and receipt logic
// ============================================================

import { getProducts, saveOrder, getSettings, saveSettings, updateProduct, updateShiftSales, saveStaffIncentive, updateAppointmentStatus, getReturns, getCustomers, isRegisterOpen } from '../db.js';
import { store, getCartTotals, clearCart } from '../store.js';
import { openModal, closeModal } from '../components/Modal.js';
import { showToast } from '../components/Toast.js';
import { syncEngine } from './syncEngine.js';
import { resolveMethodConfig } from './QuickCheckoutService.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import JsBarcode from 'jsbarcode';

/**
 * Renders JsBarcode into every `.receipt-barcode` placeholder SVG inside a
 * container. Must be called AFTER the receipt HTML has been inserted into
 * the real DOM (not on a detached string) — JsBarcode draws real <rect>
 * elements into the SVG, which is what makes the barcode survive being
 * serialized back to an HTML string for printing (a <canvas> would not:
 * canvas pixels aren't part of .innerHTML, so a barcode drawn on canvas
 * would print as a blank box).
 */
export function renderReceiptBarcodes(container) {
  if (!container) return;
  container.querySelectorAll('svg.receipt-barcode').forEach(svg => {
    const value = svg.dataset.barcodeValue;
    if (!value) return;
    try {
      JsBarcode(svg, String(value), {
        format: 'CODE128',
        width: 1.5,
        height: 40,
        margin: 0,
        // Encodes order.id (the real, permanent, unique record id) rather
        // than order.dailyNumber, which resets every day and would make the
        // same code ambiguous across different days. The receipt's "BILL NO"
        // line still shows dailyNumber for human reading — displayValue is
        // off here so the full order.id string isn't printed a second time
        // right under the barcode, which would look like a mismatch next to
        // "BILL NO".
        displayValue: false
      });
    } catch (err) {
      console.error('[Barcode] Failed to render:', err.message);
    }
  });
}

/**
 * Opens the main checkout payment selection modal
 */
export async function openCheckout() {
  const settings = await getSettings();
  const cur = settings.currency;

  if (store.cart.length === 0) {
    showToast('Cart is empty!', 'error');
    return;
  }

  const { total } = getCartTotals();
  // "Store Credit" stays in Settings > Payment Methods for shops that use it,
  // so turning the feature off in Settings > General (enableCredit) must
  // also hide it here even though it's still sitting in that list — a
  // dedicated toggle should not require also remembering to edit payment
  // methods.
  const ALL_METHODS = (settings.paymentMethods || []).filter(m => settings.enableCredit !== false || m !== 'Store Credit');

  // Initial state: Use the first available method from the database
  const defaultMethod = ALL_METHODS.length > 0 ? ALL_METHODS[0] : '';
  let payments = [{ method: defaultMethod, amount: total }];
  let checkoutMode = 'paid'; // 'paid' or 'unpaid'
  let redeemedPoints = 0;
  let usePoints = false;

  // Always refresh customer from DB so creditBalance/loyaltyPoints are current
  if (store.selectedCustomer?.id) {
    const customers = await getCustomers();
    const freshCustomer = customers.find(c => c.id === store.selectedCustomer.id);
    if (freshCustomer) store.selectedCustomer = freshCustomer;
  }

  function renderCheckoutUI() {
    const { subtotal, grossTax, orderDiscount, itemDiscount, orderTax, roundOff, total } = getCartTotals();
    const paid = payments.reduce((s, p) => s + p.amount, 0);
    const due = total - paid - (redeemedPoints || 0);
    const selectedMethods = payments.map(p => p.method);

    // Left Column logic (Payments)
    const rowsHtml = payments.map((p, idx) => {
      const config = resolveMethodConfig(p.method);
      return `
        <div class="payment-row" style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-md);padding:16px;margin-bottom:16px;display:flex;align-items:center;gap:16px;box-shadow:0 2px 4px rgba(0,0,0,0.05);transition:all 0.2s ease">
          <div style="width:40px;height:40px;border-radius:10px;background:var(--bg-main);display:flex;align-items:center;justify-content:center;color:${config.color || 'var(--accent)'}">
            <i class="fa-solid ${config.icon || 'fa-receipt'}" style="font-size:18px"></i>
          </div>

          <div style="flex:1">
            <label style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);display:block;margin-bottom:8px">Method</label>
            <div style="display:flex; flex-wrap:wrap; gap:8px;">
              ${ALL_METHODS.map(m => {
                const isSelected = p.method === m;
                const isUsedElsewhere = selectedMethods.includes(m) && m !== p.method;
                const isStoreCredit = m === 'Store Credit';
                const noCustomer = !store.selectedCustomer;
                const isDisabled = isUsedElsewhere || (isStoreCredit && noCustomer);
                return `
                  <button type="button" class="method-pill ${isSelected ? 'active' : ''}"
                    data-idx="${idx}" data-method="${escapeHtml(m)}" ${isDisabled ? 'disabled' : ''}
                    title="${isStoreCredit && noCustomer ? 'Select a customer to use store credit' : ''}"
                    style="padding:6px 12px; border-radius:20px; font-size:12px; font-weight:600; border:1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'};
                    background:${isSelected ? 'var(--accent)' : 'transparent'}; color:${isSelected ? '#fff' : 'var(--text-muted)'};
                    cursor:${isDisabled ? 'not-allowed' : 'pointer'}; opacity:${isDisabled ? 0.3 : 1}; transition:all 0.2s ease;">
                    ${escapeHtml(m)}
                  </button>
                `;
              }).join('')}
            </div>
            ${p.method === 'Store Credit' && store.selectedCustomer ? `
              <div style="margin-top:8px; font-size:11px; color:${store.selectedCustomer.creditBalance < p.amount ? 'var(--danger)' : 'var(--success)'}; font-weight:600">
                <i class="fa-solid fa-circle-info mr-4"></i> Available: ${cur}${store.selectedCustomer.creditBalance.toLocaleString()}
              </div>
            ` : ''}
          </div>
          <div style="flex:1;text-align:right">
            <label style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);display:block;margin-bottom:4px">Amount (${cur})</label>
            <input type="number" class="form-input payment-amount-input" data-idx="${idx}" value="${p.amount.toFixed(2)}" 
              style="text-align:right;border:none;padding:0;background:transparent;font-weight:700;font-size:18px;color:var(--text-main);width:100%" />
          </div>
          ${payments.length > 1 ? `
            <button class="btn btn-ghost remove-payment-btn" data-idx="${idx}" style="color:var(--danger);padding:8px;border-radius:8px">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          ` : '<div style="width:40px"></div>'}
        </div>
      `;
    }).join('');

    return `
      <style>
        .checkout-fullscreen-wrapper { height: 100vh; background: var(--bg-app); display: flex; flex-direction: column; width: 100vw; }
        .checkout-fullscreen-container { padding: 40px; max-width: 1200px; margin: 0 auto; width: 100%; display: flex; flex-direction: column; gap: 32px; color: var(--text-primary); flex: 1; overflow-y: auto; padding-bottom: 80px;}
        .checkout-top-strip { display: flex; justify-content: space-between; align-items: center; padding: 20px 40px; border-bottom: 1px solid var(--border); background: var(--bg-app); position: sticky; top: 0; z-index: 100;}
        .checkout-main-grid { display: grid; grid-template-columns: 1.2fr 480px; gap: 40px; align-items: start; }
        .qc-section-title { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; color: var(--text-muted); margin-bottom: 16px; }
        @media (max-width: 1000px) {
            .checkout-main-grid { grid-template-columns: 1fr; }
            .checkout-top-strip { padding: 16px; }
            .checkout-fullscreen-container { padding: 16px; }
        }
      </style>

      <div class="checkout-fullscreen-wrapper">
        <div class="checkout-top-strip">
            <div>
                <div style="font-weight:800; font-size:16px;">${escapeHtml(store.selectedCustomer?.name || 'Walk-in Customer')}</div>
                <div style="font-size:12px; color:var(--text-muted); font-weight:600">${escapeHtml(store.selectedCustomer?.phone || 'Guest')}</div>
            </div>
            <button class="btn btn-ghost" onclick="closeModal()" style="font-size:24px"><i class="fa-solid fa-xmark"></i></button>
        </div>

        <div class="checkout-fullscreen-container">
            <div class="checkout-main-grid">
                <!-- Left Column -->
                <div>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
                        <div style="display:flex;align-items:center;gap:12px">
                            <div class="qc-section-title" style="margin:0">Payment Split</div>
                            <button class="btn btn-ghost btn-sm" id="headerAddMethodBtn" type="button" style="padding:4px 8px;font-size:11px;border-radius:6px;border-color:var(--border)">
                                <i class="fa-solid fa-plus mr-4" style="color:var(--primary)"></i> Add Method
                            </button>
                        </div>
                        <div style="font-size:12px;color:var(--text-muted);font-weight:700" id="balanced-indicator">Balanced: ${Math.abs(due) < 0.01 ? '✅' : '⏳'}</div>
                    </div>
                    
                    <div id="paymentRowsContainer" style="${checkoutMode === 'unpaid' ? 'opacity:0.3; pointer-events:none; filter:grayscale(1);' : ''}">
                        ${ALL_METHODS.length === 0 ? `
                            <div style="text-align:center; padding:48px 32px; border:2px dashed var(--border); border-radius:var(--radius-lg); margin-bottom:24px; background:var(--bg-elevated)">
                                <i class="fa-solid fa-credit-card" style="font-size:48px; color:var(--text-muted); opacity:0.3; margin-bottom:16px; display:block"></i>
                                <h4 style="font-size:16px; font-weight:800; margin-bottom:8px; color:var(--text-main)">No Payment Methods Configured</h4>
                                <p style="font-size:12px; color:var(--text-muted); margin-bottom:20px; line-height:1.5">Configure payment methods in settings or click below to add one instantly.</p>
                                <button class="btn btn-primary" id="quickAddMethodBtn" type="button">
                                    <i class="fa-solid fa-plus-circle mr-8"></i> Add Payment Method
                                </button>
                            </div>
                        ` : (checkoutMode === 'unpaid' ? `
                            <div style="text-align:center; padding:40px; border:2px dashed var(--border); border-radius:var(--radius-lg); margin-bottom:20px">
                                <i class="fa-solid fa-hand-holding-dollar" style="font-size:32px; color:var(--text-muted); margin-bottom:12px"></i>
                                <div style="font-weight:700; color:var(--text-muted)">Unpaid Transaction Mode</div>
                                <div style="font-size:12px; color:var(--text-muted); opacity:0.7">Total balance will be added to Customer Credit</div>
                            </div>
                        ` : rowsHtml)}
                    </div>
                    
                    ${checkoutMode === 'paid' && ALL_METHODS.length > 0 && payments.length < ALL_METHODS.length ? `
                      <button class="btn" id="addPaymentBtn" style="border:2px dashed var(--border); background:var(--bg-elevated); padding:16px; border-radius:var(--radius-md); margin-top:8px; margin-bottom:24px; color:var(--text-main); font-weight:700; width:100%; transition:all 0.2s;">
                        <i class="fa-solid fa-plus-circle" style="margin-right:8px; color:var(--primary)"></i> Add Another Payment Method
                      </button>
                    ` : '<div style="margin-bottom:24px"></div>'}
                </div>

                <!-- Right Column: Summary & Toggles -->
                <div>
                   <div style="background:var(--bg-surface); border:1px solid var(--border); border-radius:24px; padding:32px; display:flex; flex-direction:column; gap:24px; box-shadow:var(--shadow); position:sticky; top:20px;">
                       
                       <div style="border-bottom: 2px solid var(--border); padding-bottom: 16px;">
                           ${settings.enableCredit !== false ? `
                           <div class="qc-section-title">Transaction Mode</div>
                           <div style="display:flex; background:var(--bg-elevated); border:1px solid var(--border); border-radius:16px; padding:4px; margin-bottom:16px; gap:4px;">
                               <button class="mode-btn ${checkoutMode === 'paid' ? 'active' : ''}" data-mode="paid" style="flex:1; padding:10px; border-radius:12px; border:none; font-weight:800; font-size:12px; cursor:pointer; background:${checkoutMode === 'paid' ? 'var(--success)' : 'transparent'}; color:${checkoutMode === 'paid' ? '#fff' : 'var(--text-muted)'}; transition:all 0.2s">
                                   <i class="fa-solid fa-money-bill-check mr-4"></i> PAID
                               </button>
                               <button class="mode-btn ${checkoutMode === 'unpaid' ? 'active' : ''}" data-mode="unpaid" style="flex:1; padding:10px; border-radius:12px; border:none; font-weight:800; font-size:12px; cursor:pointer; background:${checkoutMode === 'unpaid' ? 'var(--danger)' : 'transparent'}; color:${checkoutMode === 'unpaid' ? '#fff' : 'var(--text-muted)'}; transition:all 0.2s">
                                   <i class="fa-solid fa-hand-holding-dollar mr-4"></i> UNPAID
                               </button>
                           </div>
                           ` : ''}

                           <div class="qc-section-title">Order Grand Total</div>
                           <div style="font-size: 56px; font-weight: 900; line-height: 1; letter-spacing: -2px; margin: 8px 0; color: var(--text-primary);">${cur}${total.toFixed(2)}</div>
                           
                           <div style="display:flex; flex-direction:column; gap:8px; margin-top:20px; font-size:14px;">
                               <div style="display:flex; justify-content:space-between; color:var(--text-secondary)">
                                   <span>Subtotal</span>
                                   <span style="font-weight:600">${cur}${subtotal.toFixed(2)}</span>
                               </div>
                               ${itemDiscount > 0 ? `
                               <div style="display:flex; justify-content:space-between; color:var(--text-secondary)">
                                   <span>Item Discount</span>
                                   <span style="font-weight:600; color:var(--success)">−${cur}${itemDiscount.toFixed(2)}</span>
                               </div>
                               ` : ''}
                               ${grossTax > 0 ? `
                               <div style="display:flex; justify-content:space-between; color:var(--text-secondary)">
                                   <span>Item Tax</span>
                                   <span style="font-weight:600">${cur}${grossTax.toFixed(2)}</span>
                               </div>
                               ` : ''}
                               ${orderDiscount > 0 ? `
                               <div style="display:flex; justify-content:space-between; color:var(--text-secondary)">
                                   <span>Extra Discount</span>
                                   <span style="font-weight:600; color:var(--success)">−${cur}${orderDiscount.toFixed(2)}</span>
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
                       </div>

                       <div>
                           <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px dashed var(--border)">
                               <span style="font-weight:600;color:var(--text-secondary)">Total Collected</span>
                               <span style="font-weight:800;font-size:18px;color:var(--success)" id="total-collected-val">${cur}${paid.toFixed(2)}</span>
                           </div>
                           ${usePoints ? `
                            <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px dashed var(--border)">
                               <span style="font-weight:600;color:var(--accent)">Points Redeemed</span>
                               <span style="font-weight:800;font-size:18px;color:var(--accent)">−${cur}${redeemedPoints.toFixed(2)}</span>
                            </div>
                           ` : ''}
                           <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:none">
                               <span style="font-weight:600;color:${due > 0.05 ? 'var(--danger)' : 'var(--accent)'}" id="due-label">
                                 ${due > 0.05 ? 'Outstanding Balance' : 'Change Due'}
                               </span>
                               <span style="font-weight:900;font-size:22px;color:${due > 0.05 ? 'var(--danger)' : 'var(--accent)'}" id="due-val">${cur}${Math.abs(due).toFixed(2)}</span>
                           </div>
                       </div>

                       <!-- Loyalty Toggle -->
                       ${settings.enableLoyalty !== false && store.selectedCustomer && checkoutMode === 'paid' ? `
                         <div style="padding:20px;background:rgba(79, 70, 229, 0.03);border:2px solid ${usePoints ? 'var(--accent)' : 'var(--border)'};border-radius:var(--radius-md);transition:all 0.3s ease">
                           <label style="display:flex;align-items:flex-start;gap:16px;cursor:pointer">
                             <div style="margin-top:2px">
                               <input type="checkbox" id="usePointsCheck" ${usePoints ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent);cursor:pointer" />
                             </div>
                             <div style="flex:1">
                               <div style="font-weight:700;font-size:15px;color:var(--text-main);margin-bottom:4px;display:flex;align-items:center;gap:8px">
                                 Redeem Loyalty Points
                                 ${store.selectedCustomer.tier ? `
                                   <span style="background:${store.selectedCustomer.tier.color}15;color:${store.selectedCustomer.tier.color};font-size:10px;padding:2px 8px;border-radius:10px;border:1px solid ${store.selectedCustomer.tier.color}40">
                                     <i class="fa-solid ${store.selectedCustomer.tier.icon} mr-4"></i> ${store.selectedCustomer.tier.name}
                                   </span>
                                 ` : ''}
                               </div>
                               <div style="font-size:12px;color:var(--text-muted);line-height:1.4">Customer has <b>${store.selectedCustomer.loyaltyPoints || 0}</b> points. (1 Pt = ${cur}1) ${store.selectedCustomer.tier ? `• Earning ${({ Silver: settings.loyaltySilverPoints ?? 1, Gold: settings.loyaltyGoldPoints ?? 1.5, Platinum: settings.loyaltyPlatinumPoints ?? 2 })[store.selectedCustomer.tier.name]} pt per ${cur}${settings.loyaltyAmountPerPoint || 500}` : ''}</div>
                             </div>
                           </label>
                           ${usePoints ? `
                           <div style="margin-top:20px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.05)">
                             <label class="form-label" style="font-size:11px;font-weight:700;color:var(--accent)">POINTS TO REDEEM</label>
                             <input type="number" class="form-input" id="redeemPointsInput" value="${redeemedPoints}" max="${store.selectedCustomer.loyaltyPoints || 0}"
                               style="background:var(--bg-main);border-color:var(--border);padding:14px;font-size:14px" />
                           </div>
                           ` : ''}
                         </div>
                       ` : ''}

                       <!-- Unpaid Mode Details -->
                       ${checkoutMode === 'unpaid' ? `
                         <div style="padding:24px; background:rgba(255, 71, 87, 0.04); border:2px solid rgba(255, 71, 87, 0.3); border-radius:20px; animation: slideDown 0.3s ease;">
                           <div class="qc-section-title" style="color:var(--danger); margin-bottom:12px">Recording as Debt</div>
                           
                           ${!store.selectedCustomer ? `
                             <label class="form-label" style="font-size:10px; font-weight:800; color:var(--danger); text-transform:uppercase">Assign Customer <span style="color:var(--danger)">*</span></label>
                             <div style="position:relative; margin-bottom:16px">
                               <input type="text" id="checkoutCustSearch" class="form-input" placeholder="Search by name or phone..." style="background:var(--bg-main); border-color:var(--border); padding:14px; font-size:14px; width:100%" autocomplete="off" />
                               <div id="checkoutCustSuggestions" style="position:absolute; top:calc(100% + 4px); left:0; right:0; background:var(--bg-elevated); border:1px solid var(--border); border-radius:var(--radius-md); max-height:200px; overflow-y:auto; z-index:100; display:none; box-shadow:var(--shadow)"></div>
                             </div>
                           ` : `
                             <label class="form-label" style="font-size:10px; font-weight:800; color:var(--danger); text-transform:uppercase">Assigned Customer</label>
                             <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-main); padding:12px 16px; border-radius:12px; border:1px solid var(--border); margin-bottom:16px">
                               <div>
                                 <div style="font-weight:800; font-size:14px; color:var(--text-main)">${escapeHtml(store.selectedCustomer.name)}</div>
                                 <div style="font-size:12px; color:var(--text-muted); font-weight:600">${escapeHtml(store.selectedCustomer.phone || 'No Phone')}</div>
                               </div>
                               <button type="button" class="btn btn-ghost" id="checkoutChangeCustBtn" style="color:var(--danger); font-size:12px; padding:6px 12px; background:rgba(255, 71, 87, 0.1); border-radius:8px">
                                 <i class="fa-solid fa-rotate" style="margin-right:6px"></i> Change
                               </button>
                             </div>
                           `}

                           <label class="form-label" style="font-size:10px; font-weight:800; color:var(--danger); text-transform:uppercase">Credit Note (Required)</label>
                           <input type="text" class="form-input" id="creditInfo" placeholder="e.g. Sales Credit / Order #New" value=""
                             style="background:var(--bg-main); border-color:rgba(255, 71, 87, 0.2); padding:14px; font-size:14px; margin-bottom:16px" />
                         </div>
                       ` : ''}

                       <!-- Delivery Vehicle (optional) -->
                       <div>
                         <label class="form-label" style="font-size:10px; font-weight:800; color:var(--text-muted); text-transform:uppercase">Delivery Vehicle (optional)</label>
                         <div style="position:relative">
                           <i class="fa-solid fa-truck-fast" style="position:absolute; left:14px; top:50%; transform:translateY(-50%); color:var(--text-muted); font-size:13px"></i>
                           <input type="text" class="form-input" id="deliveryVehicleInput" placeholder="e.g. TN01AB1234" value=""
                             style="padding-left:36px" />
                         </div>
                       </div>

                        <!-- Actions -->
                        <div style="display:flex; flex-direction:column; gap:12px; margin-top:12px">
                            <button class="btn" id="confirmPayBtn" style="background:var(--success); color:#fff; border:none; padding:18px; border-radius:16px; font-weight:900; font-size:16px; box-shadow:0 8px 24px rgba(16, 185, 129, 0.3); transition:all 0.2s; width:100%">
                              <i class="fa-solid fa-check-double" style="margin-right:10px"></i> COMPLETE SALE
                            </button>
                        </div>
                   </div>
                </div>
            </div>
        </div>
      </div>
    `;
  }

  function updateUI() {
    const modalBody = document.querySelector('.modal-body');
    if (modalBody) {
      // Every caller of updateUI() already sets `payments` itself before
      // calling this (applyPaymentAmountChange for a manual amount edit,
      // an explicit `payments = [...]` reassignment for method/mode/points
      // changes) — this used to also force payments[0].amount back to the
      // cart total whenever there was exactly one payment row, which
      // silently discarded whatever the user had just typed and confirmed
      // (cash tendered, a partial amount before switching to unpaid, etc.)
      // the moment they blurred the field.
      modalBody.innerHTML = renderCheckoutUI();
      attachListeners();
    }
  }
  function attachListeners() {
    // --- Inline Customer Search (Unpaid Mode) ---
    const custSearch = document.getElementById('checkoutCustSearch');
    const custSugs = document.getElementById('checkoutCustSuggestions');
    if (custSearch && custSugs) {
      custSearch.addEventListener('input', async (e) => {
        const query = e.target.value.toLowerCase().trim();
        custSugs.style.display = query.length < 1 ? 'none' : 'block';
        if (query.length < 1) return;
        const allCustomers = await getCustomers();
        const matches = allCustomers.filter(c =>
          c.name.toLowerCase().includes(query) || (c.phone && c.phone.includes(query))
        ).slice(0, 6);
        if (matches.length === 0) {
          custSugs.innerHTML = `<div style="padding:12px 16px; color:var(--text-muted); font-size:13px">No customers found</div>`;
          return;
        }
        custSugs.innerHTML = matches.map(c => `
          <div class="checkout-cust-item" data-id="${c.id}" style="padding:10px 14px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); transition:background 0.15s"
            onmouseover="this.style.background='var(--bg-main)'" onmouseout="this.style.background='transparent'">
            <div>
              <div style="font-weight:700; font-size:13px">${escapeHtml(c.name)}</div>
              <div style="font-size:11px; color:var(--text-muted)">${escapeHtml(c.phone || 'No phone')}</div>
            </div>
            <div style="font-size:11px; color:var(--danger); font-weight:600">Owes: ${cur}${(c.creditBalance || 0).toFixed(2)}</div>
          </div>
        `).join('');
        custSugs.querySelectorAll('.checkout-cust-item').forEach(item => {
          item.onclick = () => {
            const selected = matches.find(c => String(c.id) === String(item.dataset.id));
            if (selected) {
              store.selectedCustomer = selected;
              updateUI(); // Re-render modal to show customer & enable button
            }
          };
        });
      });
      custSearch.addEventListener('focus', () => {
        if (custSearch.value) custSearch.dispatchEvent(new Event('input'));
      });
    }

    // Change customer button in unpaid mode
    const changeCustBtn = document.getElementById('checkoutChangeCustBtn');
    if (changeCustBtn) {
      changeCustBtn.onclick = () => {
        store.selectedCustomer = null;
        updateUI();
      };
    }

    const confirmBtn = document.getElementById('confirmPayBtn');
    if (confirmBtn) {
      confirmBtn.onclick = async () => {
        // Guards against a fast double-click/double-tap firing confirmOrder()
        // twice concurrently — each run saves its own order and deducts stock
        // independently, so without this a single sale could be recorded (and
        // stock decremented) twice.
        if (confirmBtn.disabled) return;

        const paid = payments.reduce((s, p) => s + p.amount, 0);
        const outstanding = Math.max(0, total - redeemedPoints - paid);
        const creditNote = document.getElementById('creditInfo')?.value;
        const deliveryVehicle = document.getElementById('deliveryVehicleInput')?.value.trim() || '';

        // Mode logic
        const isUnpaid = checkoutMode === 'unpaid';
        const creditApplied = 0; // Simplified for this view

        if (isUnpaid) {
          if (!store.selectedCustomer) {
            return showToast('Registered Customer is mandatory for Unpaid/Credit sales.', 'error');
          }
          if (!creditNote) {
            return showToast('Please enter a Credit Note for the unpaid balance.', 'error');
          }
        } else if (outstanding > 0.01) {
          return showToast('Balance must be zero in Paid Mode. Add payments or switch to Unpaid.', 'error');
        }

        // Validate methods
        if (!isUnpaid) {
            const invalidRow = payments.find(p => p.amount > 0.01 && !p.method);
            if (invalidRow) return showToast('Please select a Payment Type for all payment rows.', 'error');
        }

        let validPayments = isUnpaid ? [] : payments.filter(p => p.amount > 0.01).map(p => ({ ...p }));

        // The cashier may type a tendered amount larger than what's owed
        // (e.g. a ₹500 note against a ₹380 bill) specifically to see
        // "Change Due" — intentional UX. But the SAVED payment record must
        // only reflect the ₹380 actually retained, not the full ₹500
        // handed over, or shift.collections/cashSales get inflated by the
        // change amount (a cashier who counts the drawer correctly then
        // shows a phantom "shortage" at close-out), and if the over-typed
        // row happens to be Store Credit, the customer's real balance gets
        // permanently over-debited by the excess.
        if (!isUnpaid) {
          const owed = Math.max(0, total - redeemedPoints);
          let excess = validPayments.reduce((s, p) => s + p.amount, 0) - owed;
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
            creditInfo: creditNote || (isUnpaid ? 'Unpaid Transaction' : ''),
            redeemedPoints,
            creditUsed: creditApplied,
            deliveryVehicle
        });

        confirmBtn.disabled = true;
        try {
          await confirmOrder(validPayments, getCartTotals(), settings, cur, confirmData());
        } finally {
          confirmBtn.disabled = false;
        }
      };
    }
    document.querySelectorAll('.method-pill').forEach(el => {
      el.onclick = (e) => {
        if (el.disabled) return;
        payments[el.dataset.idx].method = el.dataset.method;
        updateUI();
      };
    });

    const applyPaymentAmountChange = (idx, newVal) => {
      // Dynamic Smart Balancing
      if (payments.length > 1) {
        const diff = newVal - payments[idx].amount;
        payments[idx].amount = newVal;

        let remainingDiff = diff;
        // Strategy: Adjust the OTHER rows starting from the last one
        for (let i = payments.length - 1; i >= 0; i--) {
          if (i !== idx && remainingDiff !== 0) {
            const prevAmt = payments[i].amount;
            payments[i].amount = prevAmt - remainingDiff;
            if (payments[i].amount < 0) {
              remainingDiff = -payments[i].amount;
              payments[i].amount = 0;
            } else {
              remainingDiff = 0;
            }
          }
        }
      } else {
        payments[idx].amount = newVal;
      }
    };

    // Patches just the numbers that need to move after an amount edit,
    // instead of updateUI()'s full modalBody.innerHTML replace — a full
    // re-render tears down and rebuilds every input, which steals focus and
    // resets the cursor after every single keystroke (so typing a second
    // digit lands nowhere, or the field appears to just not accept input).
    // Only the OTHER rows' values + the summary numbers need to move live;
    // the field the user is actively typing into is left alone until blur.
    const livePatchPaymentUI = (skipIdx) => {
      const { total: liveTotal } = getCartTotals();
      document.querySelectorAll('.payment-amount-input').forEach(input => {
        const i = parseInt(input.dataset.idx);
        if (i !== skipIdx) input.value = payments[i].amount.toFixed(2);
      });
      const paidNow = payments.reduce((s, p) => s + p.amount, 0);
      const dueNow = liveTotal - redeemedPoints - paidNow;
      const totalCollectedEl = document.getElementById('total-collected-val');
      if (totalCollectedEl) totalCollectedEl.textContent = `${cur}${paidNow.toFixed(2)}`;
      const dueLabelEl = document.getElementById('due-label');
      const dueValEl = document.getElementById('due-val');
      const dueColor = dueNow > 0.05 ? 'var(--danger)' : 'var(--accent)';
      if (dueLabelEl) {
        dueLabelEl.textContent = dueNow > 0.05 ? 'Outstanding Balance' : 'Change Due';
        dueLabelEl.style.color = dueColor;
      }
      if (dueValEl) {
        dueValEl.textContent = `${cur}${Math.abs(dueNow).toFixed(2)}`;
        dueValEl.style.color = dueColor;
      }
      const balancedEl = document.getElementById('balanced-indicator');
      if (balancedEl) balancedEl.textContent = `Balanced: ${Math.abs(dueNow) < 0.01 ? '✅' : '⏳'}`;
    };

    document.querySelectorAll('.payment-amount-input').forEach(el => {
      el.oninput = (e) => {
        const idx = parseInt(e.target.dataset.idx);
        const newVal = parseFloat(e.target.value) || 0;
        applyPaymentAmountChange(idx, newVal);
        livePatchPaymentUI(idx);
      };

      el.onchange = (e) => {
        const idx = parseInt(e.target.dataset.idx);
        const newVal = parseFloat(e.target.value) || 0;
        applyPaymentAmountChange(idx, newVal);
        updateUI();
      };

      // Select all on focus for fast replacement
      el.onfocus = () => el.select();
    });

    document.querySelectorAll('.remove-payment-btn').forEach(el => {
      el.onclick = () => {
        const removedAmt = payments[el.dataset.idx].amount;
        payments.splice(el.dataset.idx, 1);
        // Redistribute the balance back to the remainingRows
        if (payments.length > 0) payments[0].amount += removedAmt;
        updateUI();
      };
    });

    const handleQuickAdd = () => {
      showQuickAddMethodPopup((newName) => {
        if (!ALL_METHODS.includes(newName)) {
          ALL_METHODS.push(newName);
        }
        if (payments.length === 0 || !payments[0].method) {
          payments = [{ method: newName, amount: total }];
        }
        updateUI();
      }, '.checkout-fullscreen-wrapper');
    };

    const quickAddBtn = document.getElementById('quickAddMethodBtn');
    if (quickAddBtn) quickAddBtn.onclick = handleQuickAdd;

    const headerAddBtn = document.getElementById('headerAddMethodBtn');
    if (headerAddBtn) headerAddBtn.onclick = handleQuickAdd;

    const addBtn = document.getElementById('addPaymentBtn');
    if (addBtn) {
      addBtn.onclick = () => {
        const nextMethod = ALL_METHODS.find(m => !payments.map(px => px.method).includes(m));
        if (nextMethod) {
          // Split the amount already covered across the existing row(s) AND
          // the new one, instead of leaving the new row at ₹0 (which is what
          // "total - paidSoFar" always evaluates to once the order is already
          // fully covered — the normal case, since a single row starts out
          // pre-filled with the full total). A visible even split is what
          // "split across payment methods" actually means; the user can then
          // fine-tune either amount, and editing one row already rebalances
          // the others (see .payment-amount-input's onchange below).
          const paidSoFar = payments.reduce((s, p) => s + p.amount, 0);
          const targetAmount = Math.max(paidSoFar, total);
          const rowCount = payments.length + 1;
          const evenShare = parseFloat((targetAmount / rowCount).toFixed(2));
          payments.forEach(p => { p.amount = evenShare; });
          const remainder = parseFloat((targetAmount - evenShare * payments.length).toFixed(2));
          payments.push({ method: nextMethod, amount: remainder });
          updateUI();
        }
      };
    }

    document.querySelectorAll('.mode-btn').forEach(el => {
      el.onclick = () => {
        checkoutMode = el.dataset.mode;
        if (checkoutMode === 'unpaid') {
          payments = []; // Clear payments
          redeemedPoints = 0;
          usePoints = false;
        } else {
          // Reset to default paid state — ALL_METHODS[0] is undefined when no
          // payment methods are configured in Settings; fall back to '' like
          // the initial payments state above does, so resolveMethodConfig()
          // never receives undefined.
          payments = [{ method: ALL_METHODS[0] || '', amount: total }];
        }
        updateUI();
      };
    });

    const pointsCheck = document.getElementById('usePointsCheck');
    if (pointsCheck) {
      pointsCheck.onchange = (e) => {
        usePoints = e.target.checked;
        if (usePoints) {
          const maxPoints = store.selectedCustomer.loyaltyPoints || 0;
          const currentTotal = total;
          redeemedPoints = Math.min(maxPoints, currentTotal);
        } else {
          redeemedPoints = 0;
        }
        // Balance payments when points change
        // Uses the store's own default payment method, not a hardcoded
        // 'Cash' — a store configured with only UPI/Card (no Cash option
        // in Settings) would otherwise end up with a payment row whose
        // method matches no configured method-pill.
        payments = [{ method: defaultMethod, amount: Math.max(0, total - redeemedPoints) }];
        updateUI();
      };
    }

    const pointsInput = document.getElementById('redeemPointsInput');
    if (pointsInput) {
      pointsInput.onchange = (e) => {
        const val = parseFloat(e.target.value) || 0;
        const maxPoints = store.selectedCustomer.loyaltyPoints || 0;
        redeemedPoints = Math.min(val, maxPoints, total);
        payments = [{ method: defaultMethod, amount: Math.max(0, total - redeemedPoints) }];
        updateUI();
      };
    }

    const scheduleSelect = document.getElementById('waReminderSchedule');
    if (scheduleSelect) {
        scheduleSelect.onchange = (e) => {
            const customDate = document.getElementById('waReminderCustomDate');
            if (customDate) customDate.style.display = e.target.value === 'custom' ? 'block' : 'none';
        }
    }

    const sendCheck = document.getElementById('sendWaReminderCheck');
    if (sendCheck) {
        sendCheck.onchange = (e) => {
            const container = document.getElementById('waScheduleContainer');
            const sched = document.getElementById('waReminderSchedule');
            const custom = document.getElementById('waReminderCustomDate');
            if (!e.target.checked) {
                if (container) container.style.opacity = '0.4';
                if (sched) {
                    sched.disabled = true;
                    sched.value = 'none';
                }
                if (custom) custom.style.display = 'none';
            } else {
                if (container) container.style.opacity = '1';
                if (sched) sched.disabled = false;
            }
        };
    }

  }

  openModal({
    title: 'Premium Checkout',
    body: renderCheckoutUI(),
    footer: '',
    fullScreen: true,
    hideHeader: true,
    hideClose: true
  });

  setTimeout(attachListeners, 0);
}

export async function confirmOrder(payments, totals, settings, cur, creditData = { isCredit: false, creditInfo: '' }) {
  // The page-mount check (POS.js/QuickPOS.js) only runs once when the POS
  // screen first loads — a shift closed from another terminal (or this same
  // one, another tab) while this cart was already open would otherwise still
  // let the sale complete and write shift/stock data against a closed shift.
  const branchId = store.branch?.id || 'b1';
  if (!(await isRegisterOpen(branchId, store.registerId))) {
    showToast('Register is closed. Please open the register before completing a sale.', 'error');
    return false;
  }

  const orderItems = store.cart.map(i => {
    // Calculate precise finalTax for this line item based on its type — mirrors store.js's
    // getCartTotals() discountTotal formula so saved orders match what was actually charged.
    const baseLineTotal = i.price * i.qty;
    const discountTotal = i.itemDiscountType === 'pct'
      ? (baseLineTotal * (i.itemDiscount || 0) / 100)
      : ((i.itemDiscount || 0) * i.qty);
    const discountedTotal = Math.max(0, baseLineTotal - discountTotal);
    const rate = parseFloat(i.taxRate) || 0;
    const finalTax = i.taxType === 'inclusive'
      ? discountedTotal * (rate / (100 + rate))
      : discountedTotal * (rate / 100);

    return {
      id: i.id,
      name: i.name,
      variantName: i.variantName || null,
      hsnCode: i.hsnCode || '',
      emoji: i.emoji,
      price: i.price,
      qty: i.qty,
      itemDiscount: i.itemDiscount || 0,
      itemDiscountType: i.itemDiscountType || 'flat', // the product's own default \u20B9/% discount type
      discountType: i._discountType, // from inline edit \u20B9/%
      discountRaw: i._discountRaw,
      costPrice: i.costPrice || 0,
      taxRate: i.taxRate,
      taxType: i.taxType,
      category: i.category || 'Uncategorized',
      isInstant: i.isInstant || false,
      preparedQty: i.preparedQty || 0,
      finalTax: parseFloat(finalTax.toFixed(2))
    };
  });

  // Inter-state GST: only ever true for a real, selected customer whose own
  // billing state is both set AND different from this branch's registered
  // state (Settings > General). A walk-in/anonymous sale, or a customer
  // with no state on file, has nothing to compare against — stays
  // intra-state (CGST+SGST), same as this app's behavior always was.
  const custStateCode = store.selectedCustomer?.stateCode || '';
  const isInterState = !!(custStateCode && settings.stateCode && custStateCode !== settings.stateCode);

  try {
    const order = await saveOrder({
      items: orderItems,
      payments,
      // An Unpaid/Credit sale (isCredit true, no payment rows at all) was
      // falling into the `=== 1 ? ... : 'Split'` else-branch and getting
      // stamped 'Split' — wrong on its own, and the exact thing that
      // showed up on the printed receipt as "Payment Status: Split"
      // instead of clearly saying Unpaid.
      paymentMethod: creditData.isCredit ? 'Unpaid' : (payments.length === 1 ? payments[0].method : 'Split'),
      subtotal: totals.subtotal,
      discount: totals.discount,
      tax: totals.grossTax || totals.tax,
      roundOff: totals.roundOff || 0,
      groupedTaxes: totals.grossGroupedTaxes || totals.groupedTaxes || [],
      taxRate: totals.taxRate,
      globalDiscountType: store.discountType,
      globalDiscountRaw: store.discountRaw,
      total: totals.total,
      redeemedPoints: creditData.redeemedPoints || 0,
      deliveryVehicle: creditData.deliveryVehicle || '',
      storeName: settings.storeName,
      branchId: store.branch?.id || 'b1',
      staff: store.selectedStaff || null,
      appointmentId: store.selectedAppointmentId || null,
      isCredit: creditData.isCredit,
      creditUsed: creditData.creditUsed || 0,
      creditInfo: creditData.creditInfo,
      customer: store.selectedCustomer ? {
        id: store.selectedCustomer.id,
        name: store.selectedCustomer.name,
        phone: store.selectedCustomer.phone,
        gstin: store.selectedCustomer.gstin || '',
        stateCode: custStateCode
      } : null,
      isInterState,
      status: creditData.isCredit ? 'credit' : 'completed'
    });

    if (store.selectedAppointmentId) {
      await updateAppointmentStatus(store.selectedAppointmentId, 'Completed');
    }

    store.selectedCustomer = null;
    store.selectedStaff = null;
    store.selectedAppointmentId = null;
    await updateShiftSales(store.branch?.id || 'b1', totals.total, payments, store.registerId);

    // Save Staff Incentive if applicable
    if (settings.enableStaffEarnings !== false && order.staff) {
      // The staff member's own rate (Staff Management) wins if set; the
      // Settings > General default only ever applies to staff who were
      // never given one of their own (used to be a silent 0% — no commission
      // at all — for any staff member the owner hadn't gotten around to
      // configuring individually).
      const commissionRate = parseFloat(order.staff.commissionRate) || parseFloat(settings.staffDefaultCommission) || 0;
      if (commissionRate > 0) {
        // Profit (default, and the only option exposed in Settings right
        // now) = sale amount minus each item's own cost price, so
        // commission never rewards a big-ticket sale that was actually sold
        // at a thin or negative margin (e.g. a heavily discounted clearance
        // item) the same as a full-margin one. Revenue mode still exists in
        // code — just not selectable from Settings currently — for a
        // possible future toggle; anyone with 'revenue' already saved from
        // before keeps that behavior until they save Settings again.
        let commissionBase = order.total;
        if (settings.staffCommissionBasis !== 'revenue') {
          const totalCost = (order.items || []).reduce((s, i) => s + ((i.costPrice || 0) * (i.qty || 0)), 0);
          commissionBase = Math.max(0, order.total - totalCost);
        }
        const amount = (commissionBase * commissionRate) / 100;
        await saveStaffIncentive({
          staffId: order.staff.id,
          staffName: order.staff.name,
          orderId: order.id,
          orderTotal: order.total,
          commissionRate: commissionRate,
          commissionBasis: settings.staffCommissionBasis || 'profit',
          amount: parseFloat(amount.toFixed(2)),
          branchId: order.branchId
        });
      }
    }

    // No need to manually deduct stock here. 
    // saveOrder() inside confirmOrder() already handles inventory deduction and logging.

    clearCart();
    closeModal();
    showToast('Payment successful! 🎉', 'success');

    // No receipt modal popup after checkout — if auto-print is enabled,
    // render the receipt into a detached (off-screen, never shown) container
    // and print straight from that, same as Orders.js's "Sale Print" path.
    // Otherwise nothing happens here; the order can still be reprinted later
    // from Orders.
    if (settings?.autoPrintReceipt) {
      setTimeout(async () => {
        const receiptBody = await renderReceiptBody(order, settings, cur);
        const tempDiv = document.createElement('div');
        tempDiv.style.cssText = 'position:absolute; left:-9999px; top:-9999px;';
        tempDiv.innerHTML = receiptBody;
        document.body.appendChild(tempDiv);
        renderReceiptBarcodes(tempDiv);
        await printReceiptHtml(tempDiv.innerHTML, `Receipt - ${order.id}`);
        tempDiv.remove();
      }, 150);
    }
    return true;
  } catch (err) {
    console.error('Error saving order:', err);
    showToast('Error processing payment.', 'error');
    return false;
  }
}

// The app's own <style>/<link> stylesheets never change while it's running,
// but buildStandaloneReceiptHtml() used to re-fetch every <link>'s CSS text
// from disk on EVERY single print — real, avoidable latency stacked onto
// each click of "Print Receipt" (on top of the hidden-window creation +
// load + print dispatch that already has to happen every time). Fetch it
// once per session and reuse.
let cachedStandaloneStyles = null;

async function buildStandaloneReceiptHtml(contentHtml, title) {
  if (cachedStandaloneStyles !== null) {
    return `<html><head><title>${title}</title>${cachedStandaloneStyles}</head><body style="background:white; color:black; font-family:sans-serif">${contentHtml}</body></html>`;
  }
  const styleNodes = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'));
  const styleParts = await Promise.all(styleNodes.map(async (node) => {
    if (node.tagName === 'STYLE') return node.outerHTML;
    // <link> tags: the app's own stylesheet is referenced via a relative
    // path (./assets/...), which resolves fine in the main window but has
    // no base to resolve against inside the data:text/html document the
    // hidden print window loads — so the whole stylesheet silently failed
    // to load and NONE of the .receipt/@media print rules ever reached the
    // printed page. Inline the actual CSS text instead of copying the
    // <link> reference. node.href (DOM property, not the raw attribute)
    // is already resolved to an absolute file:// URL here in the main
    // window's own context, so this fetch is same-origin and safe.
    try {
      const cssText = await (await fetch(node.href)).text();
      return `<style>${cssText}</style>`;
    } catch (e) {
      // Remote CDN stylesheets (Font Awesome, etc.) — absolute https://
      // URLs resolve fine regardless of the print window's origin, so a
      // plain <link> is fine; this only triggers if that fetch fails.
      return node.outerHTML;
    }
  }));
  cachedStandaloneStyles = styleParts.join('');
  // No body padding here — the page is sized to the exact paper width
  // (electron/main.cjs), and .receipt's own print CSS already reserves the
  // right margins for it. Extra padding here would just eat into it.
  return `<html><head><title>${title}</title>${cachedStandaloneStyles}</head><body style="background:white; color:black; font-family:sans-serif">${contentHtml}</body></html>`;
}

/**
 * Print receipt-style HTML. On Electron, send it straight to the system's
 * default printer, silently — no OS print dialog — unless Settings > Print >
 * "Show print preview" is on (default), in which case an in-app preview modal
 * is shown first so paper size/copies can still be a single click without
 * ever surfacing the OS dialog. In a plain browser, fall back to
 * window.print(), which already shows its own native preview.
 */
export async function printReceiptHtml(contentHtml, title = 'Receipt') {
  const isElectron = /Electron/i.test(navigator.userAgent);
  if (isElectron && window.electronAPI?.printReceiptSilent) {
    const settings = await getSettings();
    const paperSize = settings.paperSize || 'thermal-80';
    const defaultCopies = settings.printCopies || 1;

    const doSilentPrint = async (copies) => {
      const fullHtml = await buildStandaloneReceiptHtml(contentHtml, title);
      let res;
      if (settings.printConnectionType === 'network') {
        if (!settings.printerIp) {
          showToast('No printer IP address configured — set one in Settings > Printing.', 'error');
          return;
        }
        res = await window.electronAPI.printReceiptNetwork(fullHtml, { ip: settings.printerIp, port: settings.printerPort || 9100, paperSize, copies });
      } else {
        res = await window.electronAPI.printReceiptSilent(fullHtml, { paperSize, copies, printerName: settings.printerName || '' });
      }
      if (!res?.success) showToast('Print failed: ' + (res?.error || 'unknown error'), 'error');
    };

    if (settings.showPrintPreview === false) {
      await doSilentPrint(defaultCopies);
      return;
    }

    openModal({
      title: `Print Preview — ${title}`,
      body: `
        <div style="display:flex; flex-direction:column; gap:12px">
          <div style="border:1px solid var(--border); border-radius:8px; padding:12px; max-height:60vh; overflow:auto; background:white; color:black">
            ${contentHtml}
          </div>
          <div class="form-group" style="display:flex; align-items:center; gap:8px; margin:0">
            <label class="form-label" style="margin:0">Copies</label>
            <input type="number" id="printPreviewCopies" class="form-input" style="width:80px" min="1" max="5" value="${defaultCopies}" />
          </div>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="printPreviewCancelBtn">Cancel</button>
        <button class="btn btn-primary" id="printPreviewPrintBtn"><i class="fa-solid fa-print mr-6"></i> Print</button>
      `
    });
    document.getElementById('printPreviewCancelBtn')?.addEventListener('click', () => closeModal());
    document.getElementById('printPreviewPrintBtn')?.addEventListener('click', async () => {
      const copies = Math.min(5, Math.max(1, parseInt(document.getElementById('printPreviewCopies')?.value, 10) || 1));
      closeModal();
      await doSilentPrint(copies);
    });
    return;
  }

  const modalBody = document.querySelector('.modal-body');
  if (!modalBody) { window.print(); return; }
  const original = modalBody.innerHTML;
  modalBody.innerHTML = contentHtml;
  const restore = () => { modalBody.innerHTML = original; };
  window.addEventListener('afterprint', restore, { once: true });
  window.print();
}

/**
 * Split a single GST rate/amount into CGST + SGST rows (standard Indian
 * intra-state invoice convention: half the rate and half the amount each) —
 * or, when isInterState is true (the order's customer's billing state
 * differs from this branch's own — see CheckoutService.confirmOrder()), a
 * single IGST row at the full rate/amount instead, per GST law.
 */
function renderGstSplit(rate, amount, cur, isInterState = false) {
  if (isInterState) {
    return `
      <div class="receipt-row" style="padding-left:35%; font-size:12.5px">
        <span>IGST :${(+rate).toFixed(2)}%</span><span>${cur}${amount.toFixed(2)}</span>
      </div>
    `;
  }
  const halfRate = (rate / 2).toFixed(2);
  const halfAmount = amount / 2;
  return `
    <div class="receipt-row" style="padding-left:35%; font-size:12.5px">
      <span>CGST :${halfRate}%</span><span>${cur}${halfAmount.toFixed(2)}</span>
    </div>
    <div class="receipt-row" style="padding-left:35%; font-size:12.5px">
      <span>SGST :${halfRate}%</span><span>${cur}${halfAmount.toFixed(2)}</span>
    </div>
  `;
}

/**
 * Groups an order's items by tax rate and sums each group's tax amount —
 * the one thing both receipt layouts need for a proper CGST/SGST-per-rate
 * breakdown instead of a single lump tax figure. Used as the final fallback
 * when an order has neither order.groupedTaxes/grossGroupedTaxes (set by
 * checkout for a real processed order) nor a plain order.tax > 0 — which is
 * exactly the case for the Settings > Printing live preview's sample order
 * (it only sets item-level taxRate, nothing at the order level).
 */
/**
 * Returns:
 *  - breakdown: per-rate tax amounts for DISPLAY (the CGST/SGST rows) —
 *    includes BOTH tax added on top of the price (exclusive) and tax already
 *    embedded in the price (inclusive), since a real tax invoice always
 *    itemizes the full GST on the bill no matter how the price was quoted.
 *  - exclusiveTotal: the sum of ONLY the exclusive (added-on-top) portion.
 *    This is the one that's safe to ADD to a subtotal for a Total/Net Amt
 *    figure — inclusive tax is already baked into the item's own price (and
 *    therefore already inside the subtotal), so adding it again would
 *    double-count it. Callers computing their own total must use this, not
 *    the sum of `breakdown`.
 */
function computeTaxByRate(order) {
  const taxByRate = {};
  let exclusiveTotal = 0;
  (order.items || []).forEach(i => {
    const iPrice = i.price || 0, iQty = i.qty || 0, iTaxRate = i.taxRate || 0;
    if (iTaxRate <= 0) return;
    const iDiscount = i.itemDiscountType === 'pct' ? (iPrice * iQty * (i.itemDiscount || 0) / 100) : ((i.itemDiscount || 0) * iQty);
    const lineAfterDiscount = (iPrice * iQty) - iDiscount;
    const isInclusive = i.taxType === 'inclusive';
    const taxAmt = isInclusive
      ? lineAfterDiscount * iTaxRate / (100 + iTaxRate) // tax embedded in the price
      : lineAfterDiscount * iTaxRate / 100;              // tax added on top
    taxByRate[iTaxRate] = (taxByRate[iTaxRate] || 0) + taxAmt;
    if (!isInclusive) exclusiveTotal += taxAmt;
  });
  const breakdown = Object.entries(taxByRate).map(([rate, amount]) => ({ rate: parseFloat(rate), amount }));
  return { breakdown, exclusiveTotal };
}

/**
 * Converts a rupee amount to words (Indian numbering — Lakh/Crore), for the
 * "Invoice Amount in Words" line on the A4/A5 invoice layout.
 */
function numberToWordsINR(num) {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const twoDigits = (n) => n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
  const threeDigits = (n) => n < 100 ? twoDigits(n) : ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + twoDigits(n % 100) : '');
  const convert = (n) => {
    if (n === 0) return 'Zero';
    let result = '';
    const crore = Math.floor(n / 10000000); n %= 10000000;
    const lakh = Math.floor(n / 100000); n %= 100000;
    const thousand = Math.floor(n / 1000); n %= 1000;
    if (crore) result += threeDigits(crore) + ' Crore ';
    if (lakh) result += threeDigits(lakh) + ' Lakh ';
    if (thousand) result += threeDigits(thousand) + ' Thousand ';
    if (n) result += threeDigits(n);
    return result.trim();
  };

  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);
  let words = convert(rupees) + ' Rupees';
  if (paise > 0) words += ' and ' + convert(paise) + ' Paise';
  return words + ' Only';
}

/**
 * A4/A5 tax-invoice-style layout — visually distinct from the thermal-roll
 * receipt below (proper item table with HSN/GST columns, Bill To block,
 * amount-in-words), used only when settings.paperSize is 'a4' or 'a5' (see
 * the branch at the top of renderReceiptBody()). "Shipping To" and a
 * separate due-date field are deliberately not included — pos-lite doesn't
 * store a billing/shipping address split or a due-date concept for retail
 * sales, unlike the invoicing software this layout is modeled after.
 */
async function renderInvoiceBody(order, settings, cur, includeReturns = true) {
  const allReturns = includeReturns ? (await getReturns()).filter(r => r.orderId === order.id) : [];
  const totalReturned = allReturns.reduce((s, r) => s + (r.total || 0), 0);

  const subtotal = order.subtotal || order.items.reduce((s, i) => s + (i.price * i.qty), 0);
  // Grouped by rate (matching each item row's own tax calc, incl. the
  // inclusive-tax case those rows already account for) so the Sub Total
  // box below can show a proper CGST/SGST-per-rate GST breakdown instead
  // of a single lump "Tax" figure.
  const { breakdown: taxBreakdown, exclusiveTotal: taxExclusiveTotal } = computeTaxByRate(order);
  let tax = order.tax || 0;
  if (!order.tax || order.tax === 0) {
    // Only the exclusive (added-on-top) portion goes into the Total/Net Amt
    // math — inclusive tax is already inside `subtotal` via the item's own
    // price, so summing the full display breakdown here would double-count it.
    tax = taxExclusiveTotal;
  }
  // For DISPLAY only (the item table's own GST-total footer cell) — the sum
  // of every item's shown GST, inclusive or not, so it actually matches
  // adding up the per-item GST column above it.
  const taxDisplayTotal = taxBreakdown.reduce((s, t) => s + t.amount, 0);
  const total = order.total || (subtotal + tax - (order.discount || 0));
  const netTotal = total - totalReturned;
  const dateStr = order.date || order.createdAt || new Date().toISOString();
  const storeName = order.storeName || settings.storeName || 'Store';
  const hasHsn = order.items.some(i => i.hsnCode);
  // Theme 2 swaps the accent color for a monochrome/formal look and adds a
  // bordered box + zebra-striped rows (see .invoice-a4-theme2 in style.css)
  // — same idea as the thermal layout's Theme 2, just adapted to a full
  // invoice instead of a receipt column.
  const isTheme2 = settings.receiptTheme === 'theme2';
  const accentColor = isTheme2 ? '#000' : 'var(--primary)';

  return `
    <div class="invoice-a4 ${isTheme2 ? 'invoice-a4-theme2' : ''}">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid ${accentColor}; padding-bottom:12px; margin-bottom:16px">
        <div>
          ${settings.receiptHeader ? `<div style="font-size:12px;font-weight:600;opacity:0.8">${escapeHtml(settings.receiptHeader)}</div>` : ''}
          ${settings.showStoreName !== false ? `<div style="font-size:22px;font-weight:800">${escapeHtml(storeName)}</div>` : ''}
          <div style="font-size:12px;opacity:0.75;margin-top:4px">${escapeHtml(settings.storeAddress || '')}</div>
          <div style="font-size:12px;opacity:0.75">
            ${[settings.storePhone, settings.storeAltPhone].filter(Boolean).map(p => `Ph. no.: ${escapeHtml(p)}`).join(', ')}
          </div>
          ${settings.email ? `<div style="font-size:12px;opacity:0.75">Email: ${escapeHtml(settings.email)}</div>` : ''}
          ${settings.gstNumber ? `<div style="font-size:12px;opacity:0.75">GSTIN: ${escapeHtml(settings.gstNumber)}</div>` : ''}
        </div>
        ${settings.showLogoOnReceipt && settings.storeLogo ? `<img src="${settings.storeLogo}" style="max-width:90px; max-height:90px; object-fit:contain" />` : ''}
      </div>

      ${settings.showReceiptTitle !== false ? `
        <div style="text-align:center; font-size:20px; font-weight:800; color:${accentColor}; ${isTheme2 ? 'letter-spacing:2px; border:2px solid #000; padding:6px; border-radius:4px;' : ''} margin-bottom:16px">${escapeHtml(settings.receiptTitle || 'TAX INVOICE')}</div>
      ` : ''}

      <div style="display:flex; justify-content:space-between; gap:16px; margin-bottom:16px; font-size:13px">
        <div>
          <div style="font-weight:700; margin-bottom:4px">Bill To:</div>
          ${settings.showCustomerOnReceipt !== false ? `
            <div style="font-weight:700">${order.customer ? escapeHtml(order.customer.name) : 'Walk-in Customer'}</div>
            ${order.customer?.phone ? `<div>Contact No.: ${escapeHtml(order.customer.phone)}</div>` : ''}
          ` : ''}
          ${settings.showDeliveryOnReceipt !== false && order.deliveryVehicle ? `<div>Delivery Vehicle: <strong>${escapeHtml(order.deliveryVehicle)}</strong></div>` : ''}
        </div>
        <div style="text-align:right">
          <div>Invoice No.: <strong>${escapeHtml(String(order.dailyNumber || order.id))}</strong></div>
          <div>Date: ${new Date(dateStr).toLocaleDateString('en-IN')}</div>
          <div>Time: ${new Date(dateStr).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
      </div>

      <table style="width:100%; border-collapse:collapse; font-size:12.5px; margin-bottom:16px">
        <thead>
          <tr style="background:${accentColor}; color:white">
            <th style="text-align:left; padding:6px">#</th>
            <th style="text-align:left; padding:6px">Item name</th>
            ${hasHsn ? '<th style="text-align:left; padding:6px">HSN/SAC</th>' : ''}
            <th style="text-align:center; padding:6px">Qty</th>
            <th style="text-align:right; padding:6px">Price/unit</th>
            <th style="text-align:right; padding:6px">Discount</th>
            <th style="text-align:right; padding:6px">GST</th>
            <th style="text-align:right; padding:6px">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${order.items.map((i, idx) => {
            const itemQty = parseFloat(parseFloat(i.qty || 0).toFixed(3));
            const itemPrice = i.price || 0;
            const itemTaxRate = i.taxRate || 0;
            const baseLineTotal = itemPrice * itemQty;
            const itemDiscountAmt = i.itemDiscountType === 'pct' ? (baseLineTotal * (i.itemDiscount || 0) / 100) : ((i.itemDiscount || 0) * itemQty);
            const exclusiveSubtotal = baseLineTotal - itemDiscountAmt;
            const isItemInclusive = i.taxType === 'inclusive';
            // GST column always shows the real tax amount (embedded in the
            // price for inclusive items, added on top for exclusive ones) —
            // showing ₹0.00 next to an 18% rate just because the tax happens
            // to already be inside the price was misleading. itemLineTotal's
            // own math is untouched: inclusive tax must NOT be added a
            // second time on top, it's already inside exclusiveSubtotal.
            const displayTaxAmount = isItemInclusive
              ? (exclusiveSubtotal * itemTaxRate / (100 + itemTaxRate))
              : (exclusiveSubtotal * itemTaxRate / 100);
            const taxAmount = isItemInclusive ? 0 : displayTaxAmount;
            const itemLineTotal = exclusiveSubtotal + taxAmount;
            // Price/unit shows the real, full selling price as the primary
            // figure — that's what Disc/Amount are both computed against,
            // so Price − Discount = Amount stays a simple, always-correct
            // check. Base (the pre-tax equivalent, informational only) is
            // shown as a smaller line underneath for inclusive items, not
            // swapped in as the primary figure. Derived from the POST-
            // discount taxable amount (same as the on-screen Quick POS
            // cart table's Base), not the raw undiscounted Price/unit, so
            // the same item shows the same Base figure everywhere in the
            // app instead of two different numbers depending on screen.
            const unitBaseRate = isItemInclusive && itemTaxRate > 0 ? (exclusiveSubtotal / (1 + itemTaxRate / 100)) / itemQty : null;
            return `
              <tr style="border-bottom:1px solid #ddd">
                <td style="padding:6px">${idx + 1}</td>
                <td style="padding:6px; font-weight:600">${escapeHtml(i.name)}</td>
                ${hasHsn ? `<td style="padding:6px">${escapeHtml(i.hsnCode || '')}</td>` : ''}
                <td style="text-align:center; padding:6px">${Number.isInteger(itemQty) ? itemQty : itemQty.toFixed(3)}</td>
                <td style="text-align:right; padding:6px">
                  <div>${cur}${itemPrice.toFixed(2)}</div>
                  ${unitBaseRate !== null ? `<div style="font-size:9px; opacity:0.6; font-weight:400">${cur}${unitBaseRate.toFixed(2)}</div>` : ''}
                </td>
                <td style="text-align:right; padding:6px">${settings.showDiscountOnReceipt !== false ? `${cur}${itemDiscountAmt.toFixed(2)}${itemDiscountAmt > 0 && i.itemDiscountType === 'pct' ? ` (${i.itemDiscount}%)` : ''}` : '—'}</td>
                <td style="text-align:right; padding:6px">
                  ${settings.showTaxOnReceipt !== false ? `
                    ${cur}${displayTaxAmount.toFixed(2)}${itemTaxRate > 0 ? ` (${itemTaxRate}%)` : ''}
                    ${itemTaxRate > 0 ? `<div style="font-size:9px; opacity:0.6; font-weight:400">${isItemInclusive ? 'Incl.' : 'Excl.'}</div>` : ''}
                  ` : '—'}
                </td>
                <td style="text-align:right; padding:6px; font-weight:600">${cur}${itemLineTotal.toFixed(2)}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
        <tfoot>
          <tr style="font-weight:700; border-top:2px solid #000">
            <td style="padding:6px; white-space:nowrap" colspan="${hasHsn ? 3 : 2}">Items: ${order.items.length}</td>
            <td style="text-align:center; padding:6px; white-space:nowrap">${(() => {
              const totalQty = order.items.reduce((s, i) => s + (parseFloat(i.qty) || 0), 0);
              return 'Qty: ' + (Number.isInteger(totalQty) ? totalQty : totalQty.toFixed(3));
            })()}</td>
            <td></td>
            <td></td>
            <td style="text-align:right; padding:6px">${settings.showTaxOnReceipt !== false ? `${cur}${taxDisplayTotal.toFixed(2)}` : '—'}</td>
            <td style="text-align:right; padding:6px">${cur}${total.toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>

      <div style="display:flex; justify-content:space-between; gap:24px; font-size:13px; margin-bottom:16px">
        <div style="flex:1">
          <div style="font-weight:700">Invoice Amount in Words</div>
          <div style="margin-top:4px">${numberToWordsINR(netTotal)}</div>
        </div>
        <div style="flex:0 0 220px">
          <div style="display:flex; justify-content:space-between"><span>Sub Total</span><span>${cur}${subtotal.toFixed(2)}</span></div>
          ${settings.showDiscountOnReceipt !== false && order.discount > 0 ? `<div style="display:flex; justify-content:space-between"><span>Discount</span><span>-${cur}${order.discount.toFixed(2)}</span></div>` : ''}
          ${settings.showTaxOnReceipt !== false ? (taxBreakdown.length > 0 ? taxBreakdown.map(t => order.isInterState ? `
            <div style="display:flex; justify-content:space-between; font-size:12px"><span>IGST @${(+t.rate).toFixed(2)}%</span><span>${cur}${t.amount.toFixed(2)}</span></div>
          ` : `
            <div style="display:flex; justify-content:space-between; font-size:12px"><span>CGST @${(t.rate / 2).toFixed(2)}%</span><span>${cur}${(t.amount / 2).toFixed(2)}</span></div>
            <div style="display:flex; justify-content:space-between; font-size:12px"><span>SGST @${(t.rate / 2).toFixed(2)}%</span><span>${cur}${(t.amount / 2).toFixed(2)}</span></div>
          `).join('') : (tax > 0 ? `<div style="display:flex; justify-content:space-between"><span>Tax</span><span>${cur}${tax.toFixed(2)}</span></div>` : '')) : ''}
          ${totalReturned > 0 ? `<div style="display:flex; justify-content:space-between; color:var(--danger)"><span>Returned</span><span>-${cur}${totalReturned.toFixed(2)}</span></div>` : ''}
          <div style="display:flex; justify-content:space-between; font-weight:800; font-size:15px; margin-top:4px; padding-top:4px; ${isTheme2 ? 'border:1px solid #000; border-radius:4px; padding:6px 8px;' : 'border-top:1px solid #000;'}"><span>Total</span><span>${cur}${netTotal.toFixed(2)}</span></div>
        </div>
      </div>

      <div style="font-size:12px; margin-bottom:16px">
        <div style="font-weight:700; margin-bottom:4px">Payment Status</div>
        ${(order.payments || []).map(p => `<div style="display:flex; justify-content:space-between"><span>${escapeHtml(p.method)}</span><span>${cur}${p.amount.toFixed(2)}</span></div>`).join('')}
        ${(!order.payments || order.payments.length === 0) ? `<div style="display:flex; justify-content:space-between"><span>${escapeHtml(order.paymentMethod || 'Unpaid')}</span><span>${cur}${total.toFixed(2)}</span></div>` : ''}
      </div>

      ${settings.showTermsOnReceipt && settings.receiptTerms ? `
        <div style="text-align:left">
          <div style="font-size:10px; font-weight:700; letter-spacing:0.5px; opacity:0.6; margin-bottom:4px">TERMS &amp; CONDITIONS</div>
          <div style="font-size:11px; opacity:0.7">${escapeHtml(settings.receiptTerms)}</div>
        </div>
      ` : ''}
      ${settings.showSignatureLine ? `
        <div style="margin-top:24px; text-align:right; font-size:12px">
          ${settings.signatureImage ? `<img src="${settings.signatureImage}" style="max-width:220px; max-height:50px; object-fit:contain; margin-left:auto; display:block" />` : ''}
          <div style="border-top:1px solid #000; width:220px; margin-left:auto; padding-top:4px">Authorized Signatory</div>
        </div>
      ` : ''}
      <!-- Barcode + footer message always print last, right next to each other -->
      ${settings.printBarcodeOnReceipt ? `
        <div style="text-align:center; margin:14px 0 0">
          <svg class="receipt-barcode" data-barcode-value="${order.id}"></svg>
        </div>
      ` : ''}
      ${settings.receiptFooter ? `<div style="text-align:center; font-size:12px; opacity:0.75; margin-top:14px; padding-top:12px">${escapeHtml(settings.receiptFooter)}</div>` : ''}
    </div>
  `;
}

/**
 * Helper to render standardized receipt body
 */
export async function renderReceiptBody(order, settings, cur, includeReturns = true) {
  if (settings.paperSize === 'a4' || settings.paperSize === 'a5') {
    return renderInvoiceBody(order, settings, cur, includeReturns);
  }
  const allReturns = includeReturns ? (await getReturns()).filter(r => r.orderId === order.id) : [];
  const totalReturned = allReturns.reduce((s, r) => s + (r.total || 0), 0);
  
  // Recalculate totals if missing or zero (common for active orders)
  const subtotal = order.subtotal || order.items.reduce((s, i) => s + (i.price * i.qty), 0);
  
  let tax = order.tax || 0;
  let taxRate = order.taxRate || settings.taxRate || 0;
  
  if (!order.tax || order.tax === 0) {
     // Sum up item-level taxes accurately
     tax = order.items.reduce((sum, i) => {
        const iPrice = i.price || 0;
        const iQty = i.qty || 0;
        const iTaxRate = i.taxRate || 0;
        if (iTaxRate <= 0) return sum;
        
        const iDiscount = i.itemDiscountType === 'pct'
          ? (iPrice * iQty * (i.itemDiscount || 0) / 100)
          : ((i.itemDiscount || 0) * iQty);
        const iSub = (iPrice * iQty) - iDiscount;
        return sum + (iSub * iTaxRate / 100);
     }, 0);
  }

  const total = order.total || (subtotal + tax - (order.discount || 0));
  const netTotal = total - totalReturned;

  const dateStr = order.date || order.createdAt || new Date().toISOString();
  const storeName = order.storeName || settings.storeName || 'Store';
  // Theme 2 is a visually distinct layout (centered contact block, solid
  // dividers, boxed total — see .receipt-theme2 in style.css) built entirely
  // through a CSS class on the wrapper below, not by branching this template's
  // markup — every other computation/field above stays identical between
  // themes, so there's only one source of truth for the receipt's actual data.
  const isTheme2 = settings.receiptTheme === 'theme2';

  return `
    <div class="receipt ${isTheme2 ? 'receipt-theme2' : ''}">
      <div class="receipt-header">
        ${settings.receiptHeader ? `<div style="font-size:11px;font-weight:600;opacity:0.85;margin-bottom:4px">${escapeHtml(settings.receiptHeader)}</div>` : ''}
        ${settings.showLogoOnReceipt && settings.storeLogo ? `<img src="${settings.storeLogo}" style="max-width:80px; max-height:80px; object-fit:contain; margin-bottom:6px" />` : ''}
        ${settings.showStoreName !== false ? `<div class="receipt-store-name">${storeName}</div>` : ''}
        ${settings.showStoreName !== false && settings.storeNameSubtitle ? `<div style="font-size:11px;font-weight:600;opacity:0.85;margin-top:1px">(${escapeHtml(settings.storeNameSubtitle)})</div>` : ''}
        <div style="font-size:10.5px;opacity:0.8;margin-top:4px;white-space:normal;word-wrap:break-word">${settings.storeAddress || ''}</div>
        ${(() => {
          // .receipt-row is a `justify-content:space-between` flex row — fine
          // for exactly 2 items (its usual use), but spreads 3-4 unevenly
          // across a wrapped line. Contact details are a plain block instead,
          // one line per group, joined with a plain text separator (a CSS
          // border here rendered as odd stray marks at this font size
          // instead of a visible line). Centered to match the store address
          // line right above it (which inherits .receipt-header's own
          // center alignment) — this used to be left-aligned only for
          // Theme 1, which put a centered address directly above a
          // left-aligned contact block and looked visibly misaligned.
          const phoneNumbers = [settings.storePhone, settings.storeAltPhone].filter(Boolean).join(', ');
          const line1 = phoneNumbers ? `Tel: ${phoneNumbers}` : '';
          const line2 = [
            settings.storeFax ? `Fax: ${settings.storeFax}` : '',
            settings.email ? `Email: ${settings.email}` : '',
            settings.gstNumber ? `GST: ${settings.gstNumber}` : ''
          ].filter(Boolean).join('  |  ');
          if (!line1 && !line2) return '';
          return `
        <div style="font-size:9.5px; opacity:0.7; text-align:center">
          ${line1 ? `<div>${line1}</div>` : ''}
          ${line2 ? `<div>${line2}</div>` : ''}
        </div>`;
        })()}
        ${settings.showReceiptTitle !== false ? `<div style="font-weight:800; font-size:13px; letter-spacing:1px; margin:6px 0">${escapeHtml(settings.receiptTitle || 'TAX INVOICE')}</div>` : ''}
        <div class="receipt-row" style="font-size:11px; opacity:0.7; text-align:left;">
          <span>BILL NO: ${order.dailyNumber || order.id}</span>
          <span>${new Date(dateStr).toLocaleString('en-IN')}</span>
        </div>
        ${(() => {
          const isDineIn = ['Dine-in', 'Dine In', 'Eat In'].includes(order.orderType);
          const tableName = order.tableName || order.table?.name;
          return (isDineIn && tableName) ? `<div style="font-size:11px;font-weight:bold">${order.orderType} &middot; Table: ${tableName}</div>` : '';
        })()}
        ${order.orderSource && order.orderSource !== 'In-Store' ? `<div style="font-size:11px;font-weight:bold;color:var(--primary)">Source: ${order.orderSource}</div>` : ''}
        ${settings.showCustomerOnReceipt !== false && order.customer ? `
          <div style="margin-top:4px;padding-top:4px;border-top:1px dashed var(--border);font-size:12px">
            <div>Customer: <strong>${escapeHtml(order.customer.name)}</strong></div>
            <div>Phone: ${escapeHtml(order.customer.phone)}</div>
          </div>
        ` : ''}
        ${settings.showDeliveryOnReceipt !== false && order.deliveryVehicle ? `
          <div style="margin-top:4px;padding-top:4px;border-top:1px dashed var(--border);font-size:12px">
            <div>Delivery Vehicle: <strong>${escapeHtml(order.deliveryVehicle)}</strong></div>
          </div>
        ` : ''}
      </div>

      <div class="receipt-divider"></div>
      <table style="width:100%; border-collapse:collapse; font-size:11px;">
        <thead>
          <tr style="border-bottom:1px solid #000">
            <th style="text-align:left; padding-bottom:4px; width:46%; white-space:nowrap">ITEM</th>
            <th style="text-align:center; padding-bottom:4px; width:12%; white-space:nowrap">QTY</th>
            <th style="text-align:right; padding-bottom:4px; width:20%; white-space:nowrap">RATE</th>
            <th style="text-align:right; padding-bottom:4px; width:22%; white-space:nowrap">AMOUNT</th>
          </tr>
        </thead>
        <tbody>
      ${order.items.map(i => {
    const isInclusive = i.taxType === 'inclusive';

    // Ensure qty is rounded to 3 decimal places for calculation and display
    const itemQty = parseFloat(parseFloat(i.qty || 0).toFixed(3));
    const itemPrice = i.price || 0;
    const itemTaxRate = i.taxRate || 0;
    const baseLineTotal = itemPrice * itemQty;
    // Item discount can be a flat per-unit ₹ amount or a % of the line — matches how
    // store.js's getCartTotals() computes discountTotal for the same cart item.
    const itemDiscountAmt = i.itemDiscountType === 'pct'
      ? (baseLineTotal * (i.itemDiscount || 0) / 100)
      : ((i.itemDiscount || 0) * itemQty);

    const exclusiveSubtotal = baseLineTotal - itemDiscountAmt;
    // Inclusive tax was previously left at 0 here since nothing displayed
    // it — now that the receipt shows the actual ₹ tax amount (not just
    // the rate %) per line, extract what's really embedded in the
    // (already-discounted) line total, same formula QuickPOS's on-screen
    // cart table uses: taxable − taxable/(1+rate/100).
    const taxAmount = isInclusive
      ? exclusiveSubtotal - exclusiveSubtotal / (1 + itemTaxRate / 100)
      : (exclusiveSubtotal * itemTaxRate / 100);
    const itemLineTotal = isInclusive ? exclusiveSubtotal : exclusiveSubtotal + taxAmount;

    // RATE shows the actual selling price (itemPrice) as the primary
    // figure — Disc/Amount are both computed against it, so Rate − Disc =
    // Amount stays a simple, always-correct check. Base (pre-tax
    // equivalent, informational only) shows as a smaller line underneath
    // for inclusive items, same POST-discount-derived value as the A4/A5
    // invoice and the on-screen Quick POS cart table, so it's consistent
    // everywhere rather than swapped in as the primary Rate figure.
    const unitBaseRate = isInclusive && itemTaxRate > 0 ? (exclusiveSubtotal / (1 + itemTaxRate / 100)) / itemQty : null;

    const subLines = [
      i.variantName ? `(${i.variantName})` : '',
      i.hsnCode ? `HSN: ${i.hsnCode}` : '',
      settings.showDiscountOnReceipt !== false && itemDiscountAmt > 0 ? `Disc: -${cur}${itemDiscountAmt.toFixed(2)}${i.itemDiscountType === 'pct' ? ` (${i.itemDiscount}%)` : ''}` : '',
      settings.showTaxOnReceipt !== false && itemTaxRate > 0 ? `Tax ${itemTaxRate}%${isInclusive ? ' Incl.' : ''} (${cur}${taxAmount.toFixed(2)})` : ''
    ].filter(Boolean).join(' | ');

    return `
        <tr>
          <td style="padding:4px 0; vertical-align:top">
            <div style="font-weight:600">${escapeHtml(i.name)}</div>
            ${subLines ? `<div style="font-size:9px; opacity:0.65">${subLines}</div>` : ''}
          </td>
          <td style="text-align:center; vertical-align:top; padding:4px 0">${Number.isInteger(itemQty) ? itemQty : itemQty.toFixed(3)}</td>
          <td style="text-align:right; vertical-align:top; padding:4px 0">
            <div>${cur}${itemPrice.toFixed(2)}</div>
            ${unitBaseRate !== null ? `<div style="font-size:9px; opacity:0.6; font-weight:400">${cur}${unitBaseRate.toFixed(2)}</div>` : ''}
          </td>
          <td style="text-align:right; vertical-align:top; padding:4px 0; font-weight:bold">${cur}${itemLineTotal.toFixed(2)}</td>
        </tr>
      `}).join('')}
        </tbody>
      </table>
      
      ${allReturns.length > 0 ? `
        <div class="receipt-divider"></div>
        <div style="font-size:11px; font-weight:bold; text-align:center; color:var(--danger); opacity:0.8; margin-bottom:8px">RETURNED ITEMS</div>
        ${allReturns.map(r => r.items.map(i => {
      const rQty = parseFloat(parseFloat(i.qty).toFixed(3));
      const rDiscount = i.itemDiscountType === 'pct'
        ? (i.price * rQty * (i.itemDiscount || 0) / 100)
        : ((i.itemDiscount || 0) * rQty);
      const lineTotal = (i.price * rQty) - rDiscount;
      return `
          <div class="receipt-row" style="align-items:flex-start; color:var(--danger); margin-bottom:6px">
            <div style="flex:1">
              <span style="font-weight:600">${escapeHtml(i.name)}</span>
              <div style="font-size:11px; opacity:0.75; margin-top:2px">${Number.isInteger(rQty) ? rQty : rQty.toFixed(3)} x ${cur}${i.price.toFixed(2)} | Refund: ${escapeHtml(r.refundMethod || 'Cash')}</div>
            </div>
            <span style="align-self:flex-end; font-weight:bold">-${cur}${lineTotal.toFixed(2)}</span>
          </div>
        `}).join('')).join('')}
      ` : ''}

      <div class="receipt-divider"></div>
      <div class="receipt-row"><span>Total Items: ${order.items.length}</span><span>Total Qty: ${(() => {
        const totalQty = order.items.reduce((s, i) => s + (parseFloat(i.qty) || 0), 0);
        return Number.isInteger(totalQty) ? totalQty : totalQty.toFixed(3);
      })()}</span></div>
      <div class="receipt-row" style="font-weight:800; font-size:14px"><span>Total:</span><span>${cur}${subtotal.toFixed(2)}</span></div>
      ${settings.showDiscountOnReceipt !== false && order.discount > 0 ? `<div class="receipt-row"><span>Discount ${order.globalDiscountType === 'pct' ? `(${order.globalDiscountRaw}%)` : ''}</span><span>-${cur}${order.discount.toFixed(2)}</span></div>` : ''}

      ${(() => {
        const hasGroupedTax = (order.groupedTaxes?.length > 0 || order.grossGroupedTaxes?.length > 0);
        // order.tax being set doesn't mean it's broken down by rate — this
        // used to fall back to a single overall taxRate for the CGST/SGST
        // split, which is wrong whenever items span more than one rate (and
        // showed nothing at all for orders/preview data with per-item rates
        // but no order.tax field set, like the Settings > Printing live
        // preview's sample order). Compute the per-rate breakdown from the
        // items themselves as the last resort instead.
        const { breakdown: itemTaxBreakdown } = computeTaxByRate(order);
        const taxHtml = settings.showTaxOnReceipt === false ? '' : (hasGroupedTax
          ? (order.grossGroupedTaxes || order.groupedTaxes).map(t => renderGstSplit(t.rate, t.amount, cur, order.isInterState)).join('')
          : (itemTaxBreakdown.length > 0
              ? itemTaxBreakdown.map(t => renderGstSplit(t.rate, t.amount, cur, order.isInterState)).join('')
              : (order.tax > 0 ? renderGstSplit(taxRate, order.tax, cur, order.isInterState) : '')));
        const roundOffHtml = (order.roundOff && Math.abs(order.roundOff) > 0.001) ? `
          <div class="receipt-row">
            <span>Round Off</span>
            <span>${order.roundOff > 0 ? '+' : ''}${cur}${order.roundOff.toFixed(2)}</span>
          </div>
        ` : '';
        // Skip this divider entirely when there's no tax/round-off content —
        // otherwise it sits directly above the Net Amt divider below with
        // nothing between them, printing as one doubled-up dashed line.
        if (!taxHtml && !roundOffHtml) return '';
        return `<div class="receipt-divider"></div>${taxHtml}${roundOffHtml}`;
      })()}

      <div class="receipt-divider"></div>
      <div class="receipt-total-row"><span>Net Amt ${cur}:</span><span>${total.toFixed(2)}</span></div>

      ${totalReturned > 0 ? `
        <div class="receipt-row" style="color:var(--danger); font-weight:bold"><span>TOTAL REFUNDED</span><span>-${cur}${totalReturned.toFixed(2)}</span></div>
        <div class="receipt-divider"></div>
        <div class="receipt-total-row" style="background:rgba(16,185,129,0.05); border:1px solid rgba(16,185,129,0.2); padding:10px; border-radius:4px">
          <span>NET PAYABLE</span><span>${cur}${netTotal.toFixed(2)}</span>
        </div>
      ` : ''}

      ${order.awardedPoints ? `<div class="receipt-row" style="color:var(--success);font-size:11px"><span>Points Earned</span><span>+${order.awardedPoints}</span></div>` : ''}
      ${order.redeemedPoints ? `<div class="receipt-row" style="color:var(--accent);font-size:11px"><span>Points Redeemed</span><span>-${order.redeemedPoints}</span></div>` : ''}
      
      <div class="receipt-divider"></div>
      <div style="font-size:11px;padding:0 4px">
        <div class="font-bold mb-4" style="font-size:12px">Payment Status</div>
        ${(order.payments || []).map(p => {
          let txnText = '';
          if (p.transactionId) {
            txnText = `<div class="no-print" style="font-size:9px; color:var(--text-muted); opacity:0.8; margin-top:-2px; margin-bottom:4px; margin-left:2px; font-family:monospace;">TXN: ${p.transactionId} ${p.terminalMethod ? `[${p.terminalMethod}]` : ''}</div>`;
          }
          return `
          <div class="flex items-center justify-between" style="padding:2px 0">
            <span>${escapeHtml(p.method)}</span>
            <span class="font-semibold">${cur}${p.amount.toFixed(2)}</span>
          </div>
          ${txnText}
          `;
        }).join('')}
        ${(!order.payments || order.payments.length === 0) ? `<div class="flex items-center justify-between"><span>${escapeHtml(order.paymentMethod || 'Unpaid')}</span><span class="font-semibold">${cur}${total.toFixed(2)}</span></div>` : ''}
        
        ${order.creditUsed ? `
          <div class="flex items-center justify-between mt-2" style="color:#6366f1">
            <span>Credit Balance Used</span>
            <span class="font-bold">-${cur}${order.creditUsed.toFixed(2)}</span>
          </div>
        ` : ''}
        ${order.isCredit ? `
          <div class="flex items-center justify-between border-t border-dashed mt-4 pt-4" style="color:var(--danger)">
            <span>Balance Due (New Debt)</span>
            <span class="font-bold">${cur}${(order.total - (order.redeemedPoints || 0) - (order.creditUsed || 0) - (order.payments || []).reduce((s, p) => s + p.amount, 0)).toFixed(2)}</span>
          </div>
          <div style="font-size:10px;opacity:0.6;margin-top:2px">Note: ${escapeHtml(order.creditInfo)}</div>
        ` : ''}
      </div>
      <div class="receipt-divider"></div>
      ${settings.showTermsOnReceipt && settings.receiptTerms ? `
        <div style="text-align:left">
          <div style="font-size:9px; font-weight:700; letter-spacing:0.5px; opacity:0.6; margin-bottom:3px">TERMS &amp; CONDITIONS</div>
          <div class="receipt-terms" style="font-size:10px; opacity:0.75">${escapeHtml(settings.receiptTerms)}</div>
        </div>
      ` : ''}
      ${settings.showSignatureLine ? `
        <div class="receipt-signature" style="margin-top:20px; text-align:right; font-size:11px">
          ${settings.signatureImage ? `<img src="${settings.signatureImage}" style="max-width:60%; max-height:40px; object-fit:contain; margin-left:auto; display:block" />` : ''}
          <div style="border-top:1px solid currentColor; width:60%; margin-left:auto; padding-top:4px">Authorized Signatory</div>
        </div>
      ` : ''}
      <!-- Barcode + footer message always print last, right next to each other -->
      ${settings.printBarcodeOnReceipt ? `
        <div class="receipt-barcode-wrap" style="text-align:center; margin:12px 0 0">
          <svg class="receipt-barcode" data-barcode-value="${order.id}"></svg>
        </div>
      ` : ''}
      ${settings.receiptFooter ? `<div class="receipt-footer" style="margin-top:12px; padding-top:8px">${escapeHtml(settings.receiptFooter)}</div>` : ''}
    </div>
  `;
}

/**
 * Displays the final receipt modal
 */
export async function showReceipt(order, settings, cur) {
  openModal({
    title: '🧾 Receipt',
    body: await renderReceiptBody(order, settings, cur),
    footer: `
      <button class="btn btn-ghost" id="closeReceiptBtn">Close</button>
      <button class="btn btn-primary" id="printReceiptBtn"><i class="fa-solid fa-print"></i> Print Receipt</button>
    `,
    sidePanel: false
  });

  setTimeout(() => {
    renderReceiptBarcodes(document.querySelector('.modal-body'));

    const closeBtn = document.getElementById('closeReceiptBtn');
    const printBtn = document.getElementById('printReceiptBtn');

    if (closeBtn) closeBtn.onclick = closeModal;
    if (printBtn) {
      // printReceiptHtml() does real async work before anything visible
      // happens (settings read, CSS/IPC round-trip, a hidden Electron
      // window has to spin up and load before it can even dispatch to the
      // printer) — with no feedback at all on click, that gap reads as the
      // button not having registered the click ("trigger late"). Give
      // immediate feedback the instant it's clicked instead of only after
      // the print (or preview modal) actually appears.
      const doPrint = async () => {
        const original = printBtn.innerHTML;
        printBtn.disabled = true;
        printBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Printing...';
        try {
          await printReceiptHtml(document.querySelector('.modal-body')?.innerHTML || '', `Receipt - ${order.id}`);
        } finally {
          // Button may already be gone if the preview modal closed this one.
          if (document.body.contains(printBtn)) {
            printBtn.disabled = false;
            printBtn.innerHTML = original;
          }
        }
      };
      printBtn.onclick = doPrint;

      // Auto-print if enabled in settings
      if (settings?.autoPrintReceipt) {
        setTimeout(doPrint, 500);
      }
    }

    // Keyboard Shortcuts (Enter = Print, Esc = Close)
    const handleKeys = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        window.print();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeModal();
      }
    };
    window.addEventListener('keydown', handleKeys);

    // Cleanup listener when modal is closed
    const observer = new MutationObserver(() => {
      if (!document.querySelector('.modal')) {
        window.removeEventListener('keydown', handleKeys);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }, 0);
}

/**
 * Displays a non-settled bill preview for the customer (Proforma)
 */
export async function showBillPreview(order, settings, cur) {
  openModal({
    title: `<i class="fa-solid fa-receipt"></i> Customer Bill (Proforma)`,
    body: `
      <div style="background:var(--bg-main); padding:16px; border-radius:12px; border:1px solid var(--border); margin-bottom:16px; text-align:center; font-weight:700; color:var(--primary); letter-spacing:1px">
        PROFORMA BILL / CHECK
      </div>
      ${await renderReceiptBody(order, settings, cur)}
    `,
    footer: `
      <button class="btn btn-ghost" id="closeBillBtn">Close</button>
      <button class="btn btn-primary" id="printBillBtn"><i class="fa-solid fa-print"></i> Print Bill</button>
    `,
    sidePanel: false
  });

  setTimeout(() => {
    renderReceiptBarcodes(document.querySelector('.modal-body'));

    const closeBtn = document.getElementById('closeBillBtn');
    const printBtn = document.getElementById('printBillBtn');
    if (closeBtn) closeBtn.onclick = closeModal;
    if (printBtn) {
      printBtn.onclick = () => window.print();
    }

    // Keyboard Shortcuts (Enter = Print, Esc = Close)
    const handleKeys = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        window.print();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeModal();
      }
    };
    window.addEventListener('keydown', handleKeys);
    const observer = new MutationObserver(() => {
      if (!document.querySelector('.modal')) {
        window.removeEventListener('keydown', handleKeys);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }, 0);
}
/**
 * Render a single combined refund receipt covering EVERY return recorded
 * against one order (an order can be partially returned more than once) —
 * used by the "Return Print" button on the Order Detail view.
 */
export function renderOrderReturnsReceipt(order, allReturns, settings, cur) {
  const allItems = allReturns.flatMap(r => (r.items || []).map(i => ({ ...i, refundMethod: r.refundMethod })));
  // Sum from the stored, already-correctly-prorated per-return totals — never
  // recompute price*qty here (that would drop each item's proportional tax
  // share and silently under-refund, the exact bug fixed earlier in Orders.js).
  const grandTotal = allReturns.reduce((s, r) => s + (r.total || 0), 0);
  return `
    <div class="receipt refund-receipt" style="border: 2px solid var(--danger); padding: 5px; border-radius: 8px">
      <div class="receipt-header">
        ${settings.showLogoOnReceipt && settings.storeLogo ? `<img src="${settings.storeLogo}" style="max-width:70px; max-height:70px; object-fit:contain; margin-bottom:6px" />` : ''}
        <div style="background:var(--danger); color:white; padding:4px; font-weight:bold; margin-bottom:6px; border-radius:4px">REFUND VOUCHER</div>
        ${settings.showStoreName !== false ? `<div class="receipt-store-name">${escapeHtml(settings.storeName || 'Store')}</div>` : ''}
        ${settings.showStoreName !== false && settings.storeNameSubtitle ? `<div style="font-size:11px;font-weight:600;opacity:0.85;margin-top:1px">(${escapeHtml(settings.storeNameSubtitle)})</div>` : ''}
        <div style="font-size:12px;opacity:0.8">${settings.storeAddress || ''}</div>
        ${settings.gstNumber ? `<div style="font-size:11px;opacity:0.7">GST NO : ${settings.gstNumber}</div>` : ''}
        <div class="receipt-row" style="font-size:11px; opacity:0.7; text-align:left;">
          <span>Order Ref: ${order.id}</span>
          <span>${new Date().toLocaleString('en-IN')}</span>
        </div>
      </div>

      <div class="receipt-divider"></div>
      <table style="width:100%; border-collapse:collapse; font-size:11px;">
        <thead>
          <tr style="border-bottom:1px solid #000">
            <th style="text-align:left; padding-bottom:4px; width:46%; white-space:nowrap">ITEM</th>
            <th style="text-align:center; padding-bottom:4px; width:12%; white-space:nowrap">QTY</th>
            <th style="text-align:right; padding-bottom:4px; width:20%; white-space:nowrap">RATE</th>
            <th style="text-align:right; padding-bottom:4px; width:22%; white-space:nowrap">AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          ${allItems.map(i => `
            <tr style="color:var(--danger)">
              <td style="padding:4px 0; vertical-align:top">
                <div style="font-weight:600">${escapeHtml(i.name)}</div>
                <div style="font-size:9px; opacity:0.7">Refund: ${escapeHtml(i.refundMethod || 'Cash')}</div>
              </td>
              <td style="text-align:center; vertical-align:top; padding:4px 0">${i.qty}</td>
              <td style="text-align:right; vertical-align:top; padding:4px 0">${cur}${i.price.toFixed(2)}</td>
              <td style="text-align:right; vertical-align:top; padding:4px 0; font-weight:bold">-${cur}${(i.price * i.qty).toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="receipt-divider"></div>
      <div class="receipt-total-row" style="color:var(--danger)">
        <span>TOTAL REFUND</span>
        <span>${cur}${grandTotal.toFixed(2)}</span>
      </div>

      <div class="receipt-divider"></div>
      <div style="text-align:center; font-size:10px; opacity:0.6">
        Customer Signature: ___________________
      </div>
      <div style="text-align:center; font-size:10px; opacity:0.4; margin-top:8px">
        This is a refund confirmation.
      </div>
    </div>
  `;
}

/**
 * Render a separate receipt for a specific refund/return transaction
 */
export function renderRefundReceipt(ret, settings, cur) {
  return `
    <div class="receipt refund-receipt" style="border: 2px solid var(--danger); padding: 5px; border-radius: 8px">
      <div class="receipt-header">
        ${settings.showLogoOnReceipt && settings.storeLogo ? `<img src="${settings.storeLogo}" style="max-width:70px; max-height:70px; object-fit:contain; margin-bottom:6px" />` : ''}
        <div style="background:var(--danger); color:white; padding:4px; font-weight:bold; margin-bottom:6px; border-radius:4px">REFUND VOUCHER</div>
        ${settings.showStoreName !== false ? `<div class="receipt-store-name">${escapeHtml(settings.storeName || 'Store')}</div>` : ''}
        ${settings.showStoreName !== false && settings.storeNameSubtitle ? `<div style="font-size:11px;font-weight:600;opacity:0.85;margin-top:1px">(${escapeHtml(settings.storeNameSubtitle)})</div>` : ''}
        <div style="font-size:12px;opacity:0.8">${settings.storeAddress || ''}</div>
        ${settings.gstNumber ? `<div style="font-size:11px;opacity:0.7">GST NO : ${settings.gstNumber}</div>` : ''}
        <div class="receipt-row" style="font-size:11px; opacity:0.7; text-align:left;">
          <span>Order Ref: ${ret.orderId || 'N/A'}</span>
          <span>${new Date(ret.date).toLocaleString('en-IN')}</span>
        </div>
        <div style="font-size:11px;opacity:0.6">Return ID: ${ret.id}</div>
      </div>

      <div class="receipt-divider"></div>
      <table style="width:100%; border-collapse:collapse; font-size:11px;">
        <thead>
          <tr style="border-bottom:1px solid #000">
            <th style="text-align:left; padding-bottom:4px; width:46%; white-space:nowrap">ITEM</th>
            <th style="text-align:center; padding-bottom:4px; width:12%; white-space:nowrap">QTY</th>
            <th style="text-align:right; padding-bottom:4px; width:20%; white-space:nowrap">RATE</th>
            <th style="text-align:right; padding-bottom:4px; width:22%; white-space:nowrap">AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          ${ret.items.map(i => `
            <tr style="color:var(--danger)">
              <td style="padding:4px 0; vertical-align:top; font-weight:600">${escapeHtml(i.name)}</td>
              <td style="text-align:center; vertical-align:top; padding:4px 0">${i.qty}</td>
              <td style="text-align:right; vertical-align:top; padding:4px 0">${cur}${i.price.toFixed(2)}</td>
              <td style="text-align:right; vertical-align:top; padding:4px 0; font-weight:bold">-${cur}${(i.price * i.qty).toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="receipt-divider"></div>
      <div class="receipt-total-row" style="color:var(--danger)">
        <span>TOTAL REFUND</span>
        <span>${cur}${ret.total.toFixed(2)}</span>
      </div>

      <div style="margin-top:8px; font-size:11px; padding:8px; background:rgba(239,68,68,0.05); border-radius:4px">
        <div style="display:flex; justify-content:space-between; margin-bottom:4px">
          <span>Refund Method:</span>
          <span class="font-bold">${escapeHtml(ret.refundMethod || 'Cash')}</span>
        </div>
        <div style="font-size:10px; opacity:0.8">Reason: ${escapeHtml(ret.reason || 'Not specified')}</div>
      </div>

      <div class="receipt-divider"></div>
      <div style="text-align:center; font-size:10px; opacity:0.6">
        Customer Signature: ___________________
      </div>
      <div style="text-align:center; font-size:10px; opacity:0.4; margin-top:8px">
        This is a refund confirmation.
      </div>
    </div>
  `;
}

/**
 * Show a separate refund receipt modal
 */
export function showRefundReceipt(ret, settings, cur) {
  import('../components/Modal.js').then(Modal => {
    Modal.openModal({
      title: '🔴 Refund Receipt',
      body: renderRefundReceipt(ret, settings, cur),
      footer: `
        <button class="btn btn-ghost" id="closeRefundBtn">Close</button>
        <button class="btn btn-danger" id="printRefundBtn"><i class="fa-solid fa-print"></i> Print Refund Receipt</button>
      `
    });

    setTimeout(() => {
      document.getElementById('closeRefundBtn').onclick = () => Modal.closeModal();
      document.getElementById('printRefundBtn').onclick = () => {
        printReceiptHtml(renderRefundReceipt(ret, settings, cur), 'Refund Receipt');
      };

      // Keyboard Shortcuts (Enter = Print, Esc = Close)
      const handleKeys = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          document.getElementById('printRefundBtn')?.click();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          Modal.closeModal();
        }
      };
      window.addEventListener('keydown', handleKeys);
      const observer = new MutationObserver(() => {
        if (!document.querySelector('.modal')) {
          window.removeEventListener('keydown', handleKeys);
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }, 0);
  });
}

export function showQuickAddMethodPopup(onSuccess, parentSelector = '.checkout-fullscreen-wrapper') {
  const parent = document.querySelector(parentSelector) || document.body;
  
  const popupOverlay = document.createElement('div');
  popupOverlay.id = 'quick-add-method-popup-overlay';
  popupOverlay.style = `
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.65);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 20000;
      opacity: 0;
      transition: opacity 0.2s ease;
  `;
  
  popupOverlay.innerHTML = `
      <div style="
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: 20px;
          width: 90%;
          max-width: 440px;
          padding: 28px;
          box-shadow: var(--shadow-lg);
          transform: scale(0.9);
          transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
      ">
          <h3 style="font-size: 18px; font-weight: 800; margin-bottom: 20px; display:flex; align-items:center; gap:8px">
              <i class="fa-solid fa-plus-circle" style="color:var(--primary)"></i> Quick Add Payment Method
          </h3>
          
          <div class="form-group" style="margin-bottom: 24px">
              <label class="form-label required">Method Name</label>
              <div class="search-input-wrap">
                  <i class="fa-solid fa-credit-card"></i>
                  <input class="form-input" id="quickNewMethodName" placeholder="e.g. UPI, GPay, Card, Cash" required autocomplete="off" />
              </div>
              <p class="form-help-text">Add a new payment type instantly to checkout.</p>
          </div>
          
          <div style="display: flex; gap: 12px; justify-content: flex-end;">
              <button class="btn btn-ghost" id="quickCancelMethodBtn" type="button">Cancel</button>
              <button class="btn btn-primary" id="quickSaveMethodBtn" type="button" style="min-width: 120px">
                  <i class="fa-solid fa-floppy-disk mr-4"></i> Save Method
              </button>
          </div>
      </div>
  `;
  
  parent.appendChild(popupOverlay);
  
  // Animate in
  void popupOverlay.offsetWidth;
  popupOverlay.style.opacity = '1';
  popupOverlay.querySelector('div').style.transform = 'scale(1)';
  
  const input = popupOverlay.querySelector('#quickNewMethodName');
  input.focus();
  
  const close = () => {
      popupOverlay.style.opacity = '0';
      popupOverlay.querySelector('div').style.transform = 'scale(0.9)';
      setTimeout(() => popupOverlay.remove(), 200);
  };
  
  popupOverlay.querySelector('#quickCancelMethodBtn').onclick = close;
  
  const saveBtn = popupOverlay.querySelector('#quickSaveMethodBtn');
  const doSave = async () => {
      const name = input.value.trim();
      if (!name) {
          showToast('Method name is required!', 'error');
          return;
      }
      
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-4"></i> Saving...';
      
      try {
          const { getSettings, saveSettings } = await import('../db.js');
          const settings = await getSettings();
          const currentMethods = [...(settings.paymentMethods || [])];
          
          // Avoid duplicates case-insensitively
          const exists = currentMethods.some(m => m.toLowerCase() === name.toLowerCase());
          if (exists) {
              showToast(`"${escapeHtml(name)}" already exists!`, 'warning');
              saveBtn.disabled = false;
              saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk mr-4"></i> Save Method';
              return;
          }
          
          currentMethods.push(name);
          await saveSettings({ ...settings, paymentMethods: currentMethods });
          
          showToast(`"${escapeHtml(name)}" payment method added successfully!`, 'success');
          close();
          onSuccess(name);
      } catch (err) {
          showToast('Failed to save method: ' + err.message, 'error');
          saveBtn.disabled = false;
          saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk mr-4"></i> Save Method';
      }
  };
  
  saveBtn.onclick = doSave;
  
  input.onkeydown = (e) => {
      if (e.key === 'Enter') {
          e.preventDefault();
          doSave();
      } else if (e.key === 'Escape') {
          e.preventDefault();
          close();
      }
  };
}
