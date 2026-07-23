// ============================================================
// CheckoutService.js — Global checkout and receipt logic
// ============================================================

import { getProducts, saveOrder, getSettings, saveSettings, updateProduct, updateShiftSales, saveStaffIncentive, updateAppointmentStatus, getReturns, getCustomers, addWhatsAppLog, saveScheduledReminder } from '../db.js';
import { store, getCartTotals, clearCart } from '../store.js';
import { openModal, closeModal } from '../components/Modal.js';
import { showToast } from '../components/Toast.js';
import { syncEngine } from './syncEngine.js';
import { resolveMethodConfig } from './QuickCheckoutService.js';

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
  const ALL_METHODS = [...(settings.paymentMethods || [])];

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
    const { subtotal, grossTax, orderDiscount, itemDiscount, roundOff, total } = getCartTotals();
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
                    data-idx="${idx}" data-method="${m}" ${isDisabled ? 'disabled' : ''}
                    title="${isStoreCredit && noCustomer ? 'Select a customer to use store credit' : ''}"
                    style="padding:6px 12px; border-radius:20px; font-size:12px; font-weight:600; border:1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}; 
                    background:${isSelected ? 'var(--accent)' : 'transparent'}; color:${isSelected ? '#fff' : 'var(--text-muted)'}; 
                    cursor:${isDisabled ? 'not-allowed' : 'pointer'}; opacity:${isDisabled ? 0.3 : 1}; transition:all 0.2s ease;">
                    ${m}
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
        .checkout-brand { font-size: 24px; font-weight: 900; letter-spacing: -0.5px; display: flex; align-items: center; gap: 12px; }
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
            <div class="checkout-brand"><i class="fa-solid fa-gem" style="color:var(--accent)"></i> PREMIUM CHECKOUT</div>
            <div style="display:flex; align-items:center; gap:20px;">
                <div style="text-align:right">
                    <div style="font-weight:800; font-size:16px;">${store.selectedCustomer?.name || 'Walk-in Customer'}</div>
                    <div style="font-size:12px; color:var(--text-muted); font-weight:600">${store.selectedCustomer?.phone || 'Guest'}</div>
                </div>
                <button class="btn btn-ghost" onclick="closeModal()" style="font-size:24px"><i class="fa-solid fa-xmark"></i></button>
            </div>
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
                        <div style="font-size:12px;color:var(--text-muted);font-weight:700">Balanced: ${Math.abs(due) < 0.01 ? '✅' : '⏳'}</div>
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
                           <div class="qc-section-title">Transaction Mode</div>
                           <div style="display:flex; background:var(--bg-elevated); border:1px solid var(--border); border-radius:16px; padding:4px; margin-bottom:16px; gap:4px;">
                               <button class="mode-btn ${checkoutMode === 'paid' ? 'active' : ''}" data-mode="paid" style="flex:1; padding:10px; border-radius:12px; border:none; font-weight:800; font-size:12px; cursor:pointer; background:${checkoutMode === 'paid' ? 'var(--success)' : 'transparent'}; color:${checkoutMode === 'paid' ? '#fff' : 'var(--text-muted)'}; transition:all 0.2s">
                                   <i class="fa-solid fa-money-bill-check mr-4"></i> PAID
                               </button>
                               <button class="mode-btn ${checkoutMode === 'unpaid' ? 'active' : ''}" data-mode="unpaid" style="flex:1; padding:10px; border-radius:12px; border:none; font-weight:800; font-size:12px; cursor:pointer; background:${checkoutMode === 'unpaid' ? 'var(--danger)' : 'transparent'}; color:${checkoutMode === 'unpaid' ? '#fff' : 'var(--text-muted)'}; transition:all 0.2s">
                                   <i class="fa-solid fa-hand-holding-dollar mr-4"></i> UNPAID
                               </button>
                           </div>

                           <div class="qc-section-title">Order Grand Total</div>
                           <div style="font-size: 56px; font-weight: 900; line-height: 1; letter-spacing: -2px; margin: 8px 0; color: var(--text-primary);">${cur}${total.toFixed(2)}</div>
                           
                           <div style="display:flex; flex-direction:column; gap:8px; margin-top:20px; font-size:14px;">
                               <div style="display:flex; justify-content:space-between; color:var(--text-secondary)">
                                   <span>Subtotal</span>
                                   <span style="font-weight:600">${cur}${subtotal.toFixed(2)}</span>
                               </div>
                               ${(orderDiscount + itemDiscount) > 0 ? `
                               <div style="display:flex; justify-content:space-between; color:var(--text-secondary)">
                                   <span>Manual Discount</span>
                                   <span style="font-weight:600; color:#10b981">−${cur}${(orderDiscount + itemDiscount).toFixed(2)}</span>
                               </div>
                               ` : ''}
                               ${grossTax > 0 ? `
                               <div style="display:flex; justify-content:space-between; color:var(--text-secondary)">
                                   <span>Taxes & Fees</span>
                                   <span style="font-weight:600">${cur}${grossTax.toFixed(2)}</span>
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
                               <span style="font-weight:800;font-size:18px;color:var(--success)">${cur}${paid.toFixed(2)}</span>
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
                       ${store.selectedCustomer && checkoutMode === 'paid' ? `
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
                               <div style="font-size:12px;color:var(--text-muted);line-height:1.4">Customer has <b>${store.selectedCustomer.loyaltyPoints || 0}</b> points. (1 Pt = ${cur}1) ${store.selectedCustomer.tier ? `• Earning ${store.selectedCustomer.tier.earnRate * 100}%` : ''}</div>
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
                                 <div style="font-weight:800; font-size:14px; color:var(--text-main)">${store.selectedCustomer.name}</div>
                                 <div style="font-size:12px; color:var(--text-muted); font-weight:600">${store.selectedCustomer.phone || 'No Phone'}</div>
                               </div>
                               <button type="button" class="btn btn-ghost" id="checkoutChangeCustBtn" style="color:var(--danger); font-size:12px; padding:6px 12px; background:rgba(255, 71, 87, 0.1); border-radius:8px">
                                 <i class="fa-solid fa-rotate" style="margin-right:6px"></i> Change
                               </button>
                             </div>
                           `}

                           <label class="form-label" style="font-size:10px; font-weight:800; color:var(--danger); text-transform:uppercase">Credit Note (Required)</label>
                           <input type="text" class="form-input" id="creditInfo" placeholder="e.g. Sales Credit / Order #New" value=""
                             style="background:var(--bg-main); border-color:rgba(255, 71, 87, 0.2); padding:14px; font-size:14px; margin-bottom:16px" />
                           
                           <label style="display:flex; align-items:center; gap:10px; margin-bottom:16px; cursor:pointer">
                               <input type="checkbox" id="sendWaReminderCheck" checked style="width:18px; height:18px; accent-color:var(--success)" />
                               <span style="font-size:13px; font-weight:700; color:var(--success)">
                                   <i class="fa-brands fa-whatsapp" style="margin-right:4px"></i> Send WhatsApp Reminder
                               </span>
                           </label>

                           <div id="waScheduleContainer" style="border-top:1px dashed rgba(255, 71, 87, 0.2); padding-top:16px">
                               <label class="form-label" style="font-size:10px; font-weight:800; color:var(--text-muted); text-transform:uppercase">Schedule Follow-up</label>
                               <select id="waReminderSchedule" class="form-input" style="background:var(--bg-main); border-color:var(--border); font-size:13px; font-weight:600; padding:10px; width:100%">
                                   <option value="none">No Follow-up</option>
                                   <option value="tomorrow">Tomorrow</option>
                                   <option value="3days">After 3 Days</option>
                                   <option value="7days">After 1 Week</option>
                                   <option value="custom">Pick Specific Date & Time</option>
                               </select>
                               <input type="datetime-local" id="waReminderCustomDate" class="form-input" style="display:none; margin-top:8px; background:var(--bg-main); border-color:var(--border); font-size:13px; font-weight:600; padding:10px; width:100%" />
                           </div>
                         </div>
                       ` : ''}

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
      const { total: newTotal } = getCartTotals();
      if (payments.length === 1) {
          payments[0].amount = newTotal;
      } else {
          // If multiple, adjust the balance on the last row if possible, 
          // or just ensure UI renders the new due balance correctly.
          const currentPaid = payments.reduce((s, p) => s + p.amount, 0);
          if (Math.abs(currentPaid - newTotal) > 0.01) {
              // Optionally redistribute here, but for now we just let the UI show the 'Due' amount
          }
      }
      
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
              <div style="font-weight:700; font-size:13px">${c.name}</div>
              <div style="font-size:11px; color:var(--text-muted)">${c.phone || 'No phone'}</div>
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
        const paid = payments.reduce((s, p) => s + p.amount, 0);
        const outstanding = Math.max(0, total - redeemedPoints - paid);
        const creditNote = document.getElementById('creditInfo')?.value;
        const sendWa = document.getElementById('sendWaReminderCheck')?.checked;
        
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

        const validPayments = isUnpaid ? [] : payments.filter(p => p.amount > 0.01);

        const confirmData = () => ({
            isCredit: isUnpaid,
            creditInfo: creditNote || (isUnpaid ? 'Unpaid Transaction' : ''),
            redeemedPoints,
            creditUsed: creditApplied,
            sendWhatsApp: sendWa
        });

        await confirmOrder(validPayments, getCartTotals(), settings, cur, confirmData());
      };
    }
    document.querySelectorAll('.method-pill').forEach(el => {
      el.onclick = (e) => {
        if (el.disabled) return;
        payments[el.dataset.idx].method = el.dataset.method;
        updateUI();
      };
    });

    document.querySelectorAll('.payment-amount-input').forEach(el => {
      el.onchange = (e) => {
        const idx = parseInt(e.target.dataset.idx);
        const newVal = parseFloat(e.target.value) || 0;

        // Dynamic Smart Balancing
        if (payments.length > 1) {
          const diff = newVal - payments[idx].amount;
          payments[idx].amount = newVal;

          let remainingDiff = diff;
          // Strategy: Adjust the OTHER rows starting from the last one
          for (let i = payments.length - 1; i >= 0; i--) {
            if (i !== idx && remainingDiff !== 0) {
              const prevAmt = payments[i].amount;
              const adjustment = Math.max(-prevAmt, -remainingDiff); // Don't go below 0
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
        const paidSoFar = payments.reduce((s, p) => s + p.amount, 0);
        const nextMethod = ALL_METHODS.find(m => !payments.map(px => px.method).includes(m));
        if (nextMethod) {
          payments.push({ method: nextMethod, amount: Math.max(0, total - paidSoFar) });
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
          // Reset to default paid state
          payments = [{ method: ALL_METHODS[0], amount: total }];
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
        payments = [{ method: 'Cash', amount: Math.max(0, total - redeemedPoints) }];
        updateUI();
      };
    }

    const pointsInput = document.getElementById('redeemPointsInput');
    if (pointsInput) {
      pointsInput.onchange = (e) => {
        const val = parseFloat(e.target.value) || 0;
        const maxPoints = store.selectedCustomer.loyaltyPoints || 0;
        redeemedPoints = Math.min(val, maxPoints, total);
        payments = [{ method: 'Cash', amount: Math.max(0, total - redeemedPoints) }];
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
  const orderItems = store.cart.map(i => {
    // Calculate precise finalTax for this line item based on its type
    const baseLineTotal = i.price * i.qty;
    const discountTotal = (i.itemDiscount || 0) * i.qty;
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

  try {
    const order = await saveOrder({
      items: orderItems,
      payments,
      paymentMethod: payments.length === 1 ? payments[0].method : 'Split',
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
        phone: store.selectedCustomer.phone
      } : null,
      status: creditData.isCredit ? 'credit' : 'completed'
    });

    // Handle Scheduled Reminder if any
    if (creditData.scheduledReminder && order.customer && order.customer.phone) {
        const sched = creditData.scheduledReminder;
        const freshCustomers = await getCustomers();
        const customer = freshCustomers.find(c => c.id === order.customer.id);
        const debt = (customer?.creditBalance || 0).toFixed(2);
        const settings = await getSettings();
        
        await saveScheduledReminder({
            id: 'rem-' + Date.now(),
            licenseKey: settings.licenseKey || 'GLOBAL',
            branchId: store.branch?.id || 'b1',
            customerId: customer.id,
            phone: customer.phone,
            name: customer.name,
            message: `⏰ *Scheduled Reminder*\n\nDear *${customer.name}*, just a friendly follow-up regarding your outstanding balance of *${settings.currency}${debt}*.\n\nThank you!`,
            scheduledFor: sched.date,
            status: 'pending',
            createdAt: new Date().toISOString()
        });
        showToast('Follow-up reminder scheduled! 📅', 'success');
    }

    if (store.selectedAppointmentId) {
      await updateAppointmentStatus(store.selectedAppointmentId, 'Completed');
    }

    store.selectedCustomer = null;
    store.selectedStaff = null;
    store.selectedAppointmentId = null;
    await updateShiftSales(store.branch?.id || 'b1', totals.total, payments, store.registerId);

    // Save Staff Incentive if applicable
    if (order.staff) {
      const commissionRate = parseFloat(order.staff.commissionRate) || 0;
      if (commissionRate > 0) {
        const amount = (order.total * commissionRate) / 100;
        await saveStaffIncentive({
          staffId: order.staff.id,
          staffName: order.staff.name,
          orderId: order.id,
          orderTotal: order.total,
          commissionRate: commissionRate,
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

    // --- Automatic WhatsApp Receipt Sending ---
    const waStatus = window.syncEngine?.whatsappStatus;
    const waReady = waStatus === 'connected' || waStatus === 'ready' || waStatus === 'authenticated';

    if (order.customer && order.customer.phone && window.syncEngine?.isConnected && waReady) {
      setTimeout(async () => {
        const { BillRenderer } = await import('../utils/billRenderer.js');
        const s = await getSettings();
        
        // 1. Send Order Receipt
        const waTemplate = s.whatsappTemplates?.order || {
          headerText: 'Thank you for your order!',
          subHeaderText: 'Here is your bill summary:',
          footerText: 'Visit us again!',
          showHeader: true,
          showFooter: true,
          showItems: true,
          showTax: true,
          showPayments: true
        };
        const messageBody = BillRenderer.renderAsText(order, waTemplate, s);

        let phone = order.customer.phone.replace(/\D/g, '');
        if (phone.length === 10) phone = '91' + phone;

        window.syncEngine.sendWhatsApp(phone, messageBody, 'receipt');

        // 2. Send Debt Reminder if requested
        if (creditData.sendWhatsApp && creditData.isCredit) {
            // Fetch fresh customer to get accurate total debt balance
            const customers = await getCustomers();
            const fresh = customers.find(c => c.id === order.customer.id);
            if (fresh) {
                const totalDebt = (fresh.creditBalance || 0).toFixed(2);
                const reminderMsg = `⏰ *Payment Reminder*\n\nDear *${fresh.name}*, you have an outstanding balance of *${cur}${totalDebt}*.\n\nPlease contact *${s.storeName || 'us'}* to settle your dues.\n\nThank you!`;
                
                await window.syncEngine.sendWhatsApp(phone, reminderMsg, 'reminder');
                
                // Log it
                await addWhatsAppLog({
                    customerId: fresh.id,
                    phone: phone,
                    name: fresh.name,
                    message: reminderMsg,
                    type: 'Checkout Reminder',
                    status: 'sent'
                });
            }
        }

        showToast('WhatsApp updates sent! ✅', 'success');
      }, 500); 
    }
    // ------------------------------------------

    setTimeout(async () => await showReceipt(order, settings, cur), 150);
  } catch (err) {
    console.error('Error saving order:', err);
    showToast('Error processing payment.', 'error');
  }
}

/**
 * Print receipt-style HTML. On Electron, send it straight to the system's
 * default printer, silently — no PDF, no preview window, no OS print dialog
 * (electron/main.cjs: print-receipt-silent). In a plain browser, fall back to
 * window.print(), which already shows its own native preview.
 */
export async function printReceiptHtml(contentHtml, title = 'Receipt') {
  const isElectron = /Electron/i.test(navigator.userAgent);
  if (isElectron && window.electronAPI?.printReceiptSilent) {
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
    const styles = styleParts.join('');
    // No body padding here — the page is sized to the exact thermal-roll
    // width (electron/main.cjs), and .receipt's own print CSS already reserves
    // the right margins for it. Extra padding here would just eat into it.
    const fullHtml = `<html><head><title>${title}</title>${styles}</head><body style="background:white; color:black; font-family:sans-serif">${contentHtml}</body></html>`;
    const res = await window.electronAPI.printReceiptSilent(fullHtml);
    if (!res?.success) showToast('Print failed: ' + (res?.error || 'unknown error'), 'error');
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
 * intra-state invoice convention: half the rate and half the amount each).
 */
function renderGstSplit(rate, amount, cur) {
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
 * Helper to render standardized receipt body
 */
export async function renderReceiptBody(order, settings, cur, includeReturns = true) {
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
        
        const iDiscount = (i.itemDiscount || 0) * iQty;
        const iSub = (iPrice * iQty) - iDiscount;
        return sum + (iSub * iTaxRate / 100);
     }, 0);
  }

  const total = order.total || (subtotal + tax - (order.discount || 0));
  const netTotal = total - totalReturned;

  const dateStr = order.date || order.createdAt || new Date().toISOString();
  const storeName = order.storeName || settings.storeName || 'Store';

  return `
    <div class="receipt">
      <div class="receipt-header">
        ${settings.showLogoOnReceipt && settings.storeLogo ? `<img src="${settings.storeLogo}" style="max-width:80px; max-height:80px; object-fit:contain; margin-bottom:6px" />` : ''}
        <div class="receipt-store-name">${storeName}</div>
        <div style="font-size:10.5px;opacity:0.8;margin-top:4px;white-space:normal;word-wrap:break-word">${settings.storeAddress || ''}</div>
        ${(settings.storePhone || settings.gstNumber) ? `
        <div class="receipt-row" style="font-size:9.5px; opacity:0.7; text-align:left; flex-wrap:wrap">
          <span>${settings.storePhone ? `Tel: ${settings.storePhone}` : ''}</span>
          <span style="${settings.storePhone && settings.gstNumber ? 'border-left:1px dashed #000; padding-left:8px;' : ''}">${settings.gstNumber ? `GST: ${settings.gstNumber}` : ''}</span>
        </div>` : ''}
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
        ${order.customer ? `
          <div style="margin-top:4px;padding-top:4px;border-top:1px dashed var(--border);font-size:12px">
            <div>Customer: <strong>${order.customer.name}</strong></div>
            <div>Phone: ${order.customer.phone}</div>
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
    const itemDiscountAmt = (i.itemDiscount || 0) * itemQty;

    const exclusiveSubtotal = (itemPrice * itemQty) - itemDiscountAmt;
    const taxAmount = isInclusive ? 0 : (exclusiveSubtotal * itemTaxRate / 100);
    const itemLineTotal = exclusiveSubtotal + taxAmount;

    const subLines = [
      i.variantName ? `(${i.variantName})` : '',
      i.hsnCode ? `HSN: ${i.hsnCode}` : '',
      itemDiscountAmt > 0 ? `Disc: -${cur}${itemDiscountAmt.toFixed(2)}${i.discountType === 'pct' ? ` (${i.discountRaw}%)` : ''}` : '',
      itemTaxRate > 0 ? `Tax ${itemTaxRate}%${isInclusive ? ' Incl.' : ''}` : ''
    ].filter(Boolean).join(' | ');

    return `
        <tr>
          <td style="padding:4px 0; vertical-align:top">
            <div style="font-weight:600">${i.name}</div>
            ${subLines ? `<div style="font-size:9px; opacity:0.65">${subLines}</div>` : ''}
          </td>
          <td style="text-align:center; vertical-align:top; padding:4px 0">${Number.isInteger(itemQty) ? itemQty : itemQty.toFixed(3)}</td>
          <td style="text-align:right; vertical-align:top; padding:4px 0">${cur}${itemPrice.toFixed(2)}</td>
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
      const lineTotal = (i.price * rQty) - ((i.itemDiscount || 0) * rQty);
      return `
          <div class="receipt-row" style="align-items:flex-start; color:var(--danger); margin-bottom:6px">
            <div style="flex:1">
              <span style="font-weight:600">${i.name}</span>
              <div style="font-size:11px; opacity:0.75; margin-top:2px">${Number.isInteger(rQty) ? rQty : rQty.toFixed(3)} x ${cur}${i.price.toFixed(2)} | Refund: ${r.refundMethod || 'Cash'}</div>
            </div>
            <span style="align-self:flex-end; font-weight:bold">-${cur}${lineTotal.toFixed(2)}</span>
          </div>
        `}).join('')).join('')}
      ` : ''}

      <div class="receipt-divider"></div>
      <div class="receipt-row"><span>Total Items: ${order.items.length}</span><span>${order.items.reduce((s, i) => s + (parseFloat(i.qty) || 0), 0)}</span></div>
      <div class="receipt-row" style="font-weight:800; font-size:14px"><span>Total:</span><span>${cur}${subtotal.toFixed(2)}</span></div>
      ${order.discount > 0 ? `<div class="receipt-row"><span>Discount ${order.globalDiscountType === 'pct' ? `(${order.globalDiscountRaw}%)` : ''}</span><span>-${cur}${order.discount.toFixed(2)}</span></div>` : ''}

      <div class="receipt-divider"></div>
      ${(order.groupedTaxes || order.grossGroupedTaxes) && (order.groupedTaxes?.length > 0 || order.grossGroupedTaxes?.length > 0) ?
      (order.grossGroupedTaxes || order.groupedTaxes).map(t => renderGstSplit(t.rate, t.amount, cur)).join('')
      : order.tax > 0 ? renderGstSplit(taxRate, order.tax, cur) : ''
    }

      ${order.roundOff && Math.abs(order.roundOff) > 0.001 ? `
        <div class="receipt-row">
          <span>Round Off</span>
          <span>${order.roundOff > 0 ? '+' : ''}${cur}${order.roundOff.toFixed(2)}</span>
        </div>
      ` : ''}

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
            <span>${p.method}</span>
            <span class="font-semibold">${cur}${p.amount.toFixed(2)}</span>
          </div>
          ${txnText}
          `;
        }).join('')}
        ${(!order.payments || order.payments.length === 0) ? `<div class="flex items-center justify-between"><span>${order.paymentMethod || 'Unpaid'}</span><span class="font-semibold">${cur}${total.toFixed(2)}</span></div>` : ''}
        
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
          <div style="font-size:10px;opacity:0.6;margin-top:2px">Note: ${order.creditInfo}</div>
        ` : ''}
      </div>
      <div class="receipt-divider"></div>
      <div class="receipt-footer">${settings.receiptFooter || 'Thank you for your business!'}</div>
    </div>
  `;
}

/**
 * Displays the final receipt modal
 */
export async function showReceipt(order, settings, cur) {
  const waStatus = window.syncEngine?.whatsappStatus;
  const isWaReady = waStatus === 'ready' || waStatus === 'authenticated' || waStatus === 'connected';
  const hasCustomerPhone = order.customer && order.customer.phone;

  openModal({
    title: '🧾 Receipt',
    body: await renderReceiptBody(order, settings, cur),
    footer: `
      <button class="btn btn-ghost" id="closeReceiptBtn">Close</button>
      ${isWaReady && hasCustomerPhone ? `
        <button class="btn btn-whatsapp btn-whatsapp-icon" id="whatsappReceiptManualBtn" title="WhatsApp Receipt"><i class="fa-brands fa-whatsapp"></i></button>
      ` : ''}
      <button class="btn btn-primary" id="printReceiptBtn"><i class="fa-solid fa-print"></i> Print Receipt</button>
    `
  });

  setTimeout(() => {
    const closeBtn = document.getElementById('closeReceiptBtn');
    const printBtn = document.getElementById('printReceiptBtn');
    const waBtn = document.getElementById('whatsappReceiptManualBtn');

    if (closeBtn) closeBtn.onclick = closeModal;
    if (printBtn) {
      const doPrint = () => printReceiptHtml(document.querySelector('.modal-body')?.innerHTML || '', `Receipt - ${order.id}`);
      printBtn.onclick = doPrint;

      // Auto-print if enabled in settings
      if (settings?.autoPrintReceipt) {
        setTimeout(doPrint, 500);
      }
    }

    if (waBtn) {
      waBtn.onclick = async () => {
        const originalContent = '<i class="fa-brands fa-whatsapp"></i>';
        waBtn.disabled = true;
        waBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
        waBtn.style.opacity = '0.8';

        try {
          const { BillRenderer } = await import('../utils/billRenderer.js');
          const waTemplate = settings.whatsappTemplates?.order || {
            headerText: 'Thank you for your order!',
            subHeaderText: 'Here is your bill summary:',
            footerText: 'Visit us again!',
            showHeader: true,
            showFooter: true,
            showItems: true,
            showTax: true,
            showPayments: true
          };
          const messageBody = BillRenderer.renderAsText(order, waTemplate, settings);

          let phone = order.customer.phone.replace(/\D/g, '');
          if (phone.length === 10) phone = '91' + phone;

          const result = await window.syncEngine.sendWhatsApp(phone, messageBody, 'receipt');
          
          if (result && result.success) {
            showToast('✅ WhatsApp Receipt Sent Successfully!', 'success');
            // Flash success state on button
            waBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
            waBtn.style.background = 'var(--success)';
            setTimeout(() => {
              waBtn.innerHTML = originalContent;
              waBtn.style.background = '';
              waBtn.disabled = false;
              waBtn.style.opacity = '1';
            }, 3000);
          } else {
            showToast(result?.message || 'Failed to send WhatsApp receipt.', 'error');
            waBtn.innerHTML = originalContent;
            waBtn.disabled = false;
            waBtn.style.opacity = '1';
          }
        } catch (err) {
          console.error('[WhatsApp Manual Receipt Error Checkout]', err);
          showToast('An error occurred while sending.', 'error');
          waBtn.innerHTML = originalContent;
          waBtn.disabled = false;
          waBtn.style.opacity = '1';
        }
      };
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
    `
  });

  setTimeout(() => {
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
        <div class="receipt-store-name">${settings.storeName || 'Store'}</div>
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
                <div style="font-weight:600">${i.name}</div>
                <div style="font-size:9px; opacity:0.7">Refund: ${i.refundMethod || 'Cash'}</div>
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
        <div class="receipt-store-name">${settings.storeName || 'Store'}</div>
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
              <td style="padding:4px 0; vertical-align:top; font-weight:600">${i.name}</td>
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
          <span class="font-bold">${ret.refundMethod || 'Cash'}</span>
        </div>
        <div style="font-size:10px; opacity:0.8">Reason: ${ret.reason || 'Not specified'}</div>
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
              showToast(`"${name}" already exists!`, 'warning');
              saveBtn.disabled = false;
              saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk mr-4"></i> Save Method';
              return;
          }
          
          currentMethods.push(name);
          await saveSettings({ ...settings, paymentMethods: currentMethods });
          
          showToast(`"${name}" payment method added successfully!`, 'success');
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
