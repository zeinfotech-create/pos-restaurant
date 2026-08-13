import { getProducts, getSettings, getCustomers, saveCustomer, isRegisterOpen, hasPermission, getCurrentBranch, getCurrentRegisterId, getStaff } from '../db.js';
import { store, addToCart, onCartUpdate, getCartTotals, updateQty, removeFromCart, clearCart, setDiscount, setExtraTax, updateCartItem, setCustomer, setStaff } from '../store.js';
import { openModal, closeModal, showConfirm } from '../components/Modal.js';
import { openCustomerForm } from '../components/CustomerForm.js';
import { openQuickCheckout } from '../services/QuickCheckoutService.js';
import { MediaService } from '../services/MediaService.js';
import { showToast } from '../components/Toast.js';
import { escapeHtml } from '../utils/escapeHtml.js';

let quickSearchQuery = '';
let lastAddedCartId = null;
let selectedCartIndex = -1;
let selectedColIndex = -1; // 0=Qty, 1=UnitPrice, 2=Discount
let activeTab = 'search'; // 'search', 'launch', 'payment'
let isGlobalDiscEditing = false;
let isExtraTaxEditing = false;
// Inline "Payment Options" strip state (top of screen) — lets PAY complete
// the sale immediately for the common case (single payment method, full
// amount, no vehicle) without leaving this screen, while still reaching
// multi-payment split and delivery vehicle entry without the old separate
// full-screen Quick Checkout navigation. null = never customized this
// cart, so PAY uses a single default-method/full-amount payment.
let inlinePaymentPanelOpen = false;
let inlinePayments = null;
let inlineDeliveryVehicle = '';

export async function renderQuickPOS(container) {
  if (window._qpCleanup) { window._qpCleanup(); window._qpCleanup = null; }

  const settings = await getSettings();
  const cur = settings.currency;
  // store.branch/store.registerId are only ever set once, in store.js's
  // initStore() at app startup, and never refreshed after — same staleness
  // bug as POS.js (see the comment there). Refresh both fresh every render
  // so this doesn't keep checking a stale branch/register's shift status.
  store.branch = await getCurrentBranch();
  store.registerId = await getCurrentRegisterId();
  const branchId = store.branch?.id;
  const registerId = store.registerId;
  const staffList = settings.enableStaffEarnings !== false ? await getStaff(branchId) : [];
  // Drives the shortcut grid's column count below — 7 columns exactly fits
  // the 14 buttons when the 2 Staff ones are present, 6 exactly fits the
  // 12 without them, so the last row never ends with a dangling gap either way.
  const hasStaffShortcuts = settings.enableStaffEarnings !== false && staffList.length > 0;

  if (!(await isRegisterOpen(branchId, registerId))) {
    container.innerHTML = `
      <div class="enterprise-pos-container empty-state" style="height:70vh; flex-direction:column">
        <i class="fa-solid fa-lock" style="font-size:64px;margin-bottom:24px;opacity:0.2"></i>
        <h2 class="font-bold">Register is Closed</h2>
        <p class="mb-24 text-muted">You must open the shift before starting a sale.</p>
        <div class="flex gap-12">
          <button class="btn btn-primary" onclick="window.navigate('register')">
            <i class="fa-solid fa-key"></i> Open Register Shift
          </button>
          <button class="btn btn-ghost" id="qpChangeRegisterBtn">
            <i class="fa-solid fa-right-from-bracket"></i> Change Register
          </button>
          <button class="btn btn-ghost" id="qpBackBtn">
            <i class="fa-solid fa-arrow-left"></i> Back
          </button>
        </div>
      </div>
    `;

    document.getElementById('qpBackBtn').addEventListener('click', () => {
      window.navigate('dashboard');
    });

    document.getElementById('qpChangeRegisterBtn').addEventListener('click', () => {
      import('../db.js').then(async db => {
        const registers = await db.getBranchRegisters(branchId);

        import('../components/Modal.js').then(({ openModal, closeModal }) => {
          openModal({
            title: '<i class="fa-solid fa-cash-register"></i> Select Register',
            body: `
              <div style="display:flex;flex-direction:column;gap:10px;padding:4px">
                ${registers.length === 0
                ? '<p style="text-align:center;padding:24px;opacity:0.6">No registers found for this branch.</p>'
                : registers.map(r => {
                    const isCurrent = r.id === registerId;
                    return `
                    <button class="btn btn-ghost reg-pick-btn" data-id="${r.id}" style="justify-content:flex-start;height:54px;padding:0 20px;border:1px solid ${isCurrent ? 'var(--primary)' : 'var(--border)'}">
                      <i class="fa-solid fa-cash-register mr-12" style="color:var(--success)"></i>
                      <div class="font-bold">
                        ${escapeHtml(r.name)}
                        ${isCurrent ? '<span style="font-size:9px; background:var(--primary-light); color:var(--primary); padding:2px 6px; border-radius:4px; font-weight:700; margin-left:8px">CURRENT</span>' : ''}
                      </div>
                    </button>
                  `;
                  }).join('')}
              </div>
            `,
            footer: `<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>`
          });

          document.querySelectorAll('.reg-pick-btn').forEach(btn => {
            btn.onclick = async () => {
              const session = await db.getSession();
              await db.setSession(session.user, session.branch, btn.dataset.id);
              closeModal();
              window.location.reload();
            };
          });
        });
      });
    });

    return;
  }

  const { total: cartTotal } = getCartTotals();
  // Store Credit stays out of the inline strip's method list on the same
  // enableCredit gate CheckoutService's own payment pills use — the inline
  // strip doesn't have a customer-selection step of its own to guard it.
  const paymentMethodsList = (settings.paymentMethods || []).filter(m => settings.enableCredit !== false || m !== 'Store Credit');
  const defaultPaymentMethod = paymentMethodsList[0] || 'Cash';
  // null (never customized this cart) renders as a single default-method,
  // full-amount row without actually writing to inlinePayments yet — it
  // only gets materialized once the cashier opens the strip or edits
  // something, so PAY's "use the simple default" check stays accurate.
  const displayPayments = inlinePayments || [{ method: defaultPaymentMethod, amount: cartTotal }];
  const paymentsSum = displayPayments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  const isPaymentsBalanced = Math.abs(paymentsSum - cartTotal) < 0.01;

  container.innerHTML = `
    <div class="enterprise-pos-container">


      <!-- Search Box (SKU/CODE) -->
      <div class="ep-search-bar">
         <div class="ep-input-wrap">
            <label><span class="ep-key-red" style="margin-right:10px">Alt+O : HOME</span> ENTER SKU / CODE OR SCAN:</label>
            <input type="text" id="quickProductSearch" autocomplete="off" tabindex="1" />
         </div>
         <div class="ep-cashier-info">
            <label>Cashier:</label>
            <span class="ep-highlight-text">${store.user?.name || 'ADMIN'}</span>
         </div>
      </div>

      <!-- Inline Payment Options strip — PAY completes immediately using
           this (single default method/full amount, unless customized here)
           instead of navigating to a separate Quick Checkout screen. Split
           payment and delivery vehicle stay reachable without leaving this
           screen, just collapsed by default so they don't add a step to
           the common single-payment case. -->
      ${store.cart.length > 0 ? `
      <div class="ep-pay-strip">
         <div class="ep-pay-strip-summary" id="qpPayStripToggle">
            <div style="display:flex; align-items:center; gap:10px; font-size:12px; font-weight:700; color:var(--text-secondary); min-width:0">
               <i class="fa-solid fa-credit-card" style="color:var(--primary)"></i>
               <span style="white-space:nowrap">${displayPayments.length > 1 ? `Split — ${displayPayments.length} methods` : displayPayments[0].method}</span>
               ${!inlinePaymentPanelOpen && displayPayments.length > 1 ? `<span style="color:${isPaymentsBalanced ? 'var(--success)' : 'var(--danger)'}">${cur}${paymentsSum.toFixed(2)} / ${cur}${cartTotal.toFixed(2)}</span>` : ''}
               ${!inlinePaymentPanelOpen && inlineDeliveryVehicle ? `<span style="color:var(--text-muted); overflow:hidden; text-overflow:ellipsis"><i class="fa-solid fa-truck-fast"></i> ${escapeHtml(inlineDeliveryVehicle)}</span>` : ''}
            </div>
            <button type="button" id="qpPayStripToggleBtn" style="background:none; border:none; color:var(--primary); font-weight:700; font-size:11px; cursor:pointer; display:flex; align-items:center; gap:4px; flex-shrink:0; padding:2px 4px">
               ${inlinePaymentPanelOpen ? 'Hide' : 'Split / Add Vehicle'} <i class="fa-solid fa-chevron-${inlinePaymentPanelOpen ? 'up' : 'down'}" style="font-size:9px"></i>
            </button>
         </div>
         ${inlinePaymentPanelOpen ? `
         <div id="qpPayStripBody" style="display:flex; flex-direction:column; gap:8px; padding:10px 16px 12px; border-top:1px dashed var(--border)">
            <div id="qpPayRows" style="display:flex; flex-direction:column; gap:6px">
               ${displayPayments.map((p, idx) => `
                 <div class="qp-pay-row" style="display:flex; align-items:center; gap:8px">
                   <select class="qp-pay-method" data-idx="${idx}" style="flex:1; height:30px; border:1px solid var(--border); border-radius:4px; font-size:12px; background:var(--bg-card); color:var(--text-main)">
                     ${paymentMethodsList.map(m => `<option value="${escapeHtml(m)}" ${p.method === m ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
                   </select>
                   <input type="number" class="qp-pay-amount" data-idx="${idx}" value="${(parseFloat(p.amount) || 0).toFixed(2)}" style="width:100px; height:30px; text-align:right; border:1px solid var(--border); border-radius:4px; font-size:12px; padding:0 6px; background:var(--bg-card); color:var(--text-main)" />
                   ${displayPayments.length > 1 ? `<button type="button" class="qp-pay-remove" data-idx="${idx}" style="width:26px; height:26px; border:none; background:transparent; color:var(--danger); cursor:pointer; flex-shrink:0"><i class="fa-solid fa-xmark"></i></button>` : `<div style="width:26px; flex-shrink:0"></div>`}
                 </div>
               `).join('')}
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center">
               <button type="button" id="qpAddPayRow" style="background:none; border:1px dashed var(--border); border-radius:4px; padding:4px 10px; font-size:11px; font-weight:700; color:var(--primary); cursor:pointer">
                 <i class="fa-solid fa-plus"></i> Add Split
               </button>
               <span id="qpPayBalanceNote" style="font-size:11px; font-weight:700; color:${isPaymentsBalanced ? 'var(--success)' : 'var(--danger)'}">
                 ${cur}${paymentsSum.toFixed(2)} / ${cur}${cartTotal.toFixed(2)}
               </span>
            </div>
            <div>
               <label style="font-size:10px; font-weight:800; color:var(--text-muted); text-transform:uppercase; display:block; margin-bottom:4px">Delivery Vehicle (optional)</label>
               <div style="position:relative">
                 <i class="fa-solid fa-truck-fast" style="position:absolute; left:8px; top:50%; transform:translateY(-50%); color:var(--text-muted); font-size:11px"></i>
                 <input type="text" id="qpDeliveryVehicle" value="${escapeHtml(inlineDeliveryVehicle)}" placeholder="e.g. TN01AB1234" style="width:100%; height:30px; border:1px solid var(--border); border-radius:4px; font-size:12px; padding:0 8px 0 26px; background:var(--bg-card); color:var(--text-main)" />
               </div>
            </div>
            <button type="button" id="qpFullCheckoutLink" style="align-self:flex-start; background:none; border:none; color:var(--text-muted); font-size:11px; font-weight:600; text-decoration:underline; cursor:pointer; padding:0">
              Need Credit / Unpaid sale or Loyalty points redemption? Open full Checkout →
            </button>
         </div>
         ` : ''}
      </div>
      ` : ''}

      <!-- Main Content Grid -->
      <div class="ep-main-grid">
         <!-- Left Column: Customer Details -->
         <div class="ep-catalog-col" style="width:280px; background:var(--bg-card); border-right:1px solid var(--border); display:flex; flex-direction:column; padding:0; border-radius:4px 0 0 4px">

            <!-- Fixed Header & Search -->
            <div style="padding:12px; border-bottom:1px solid var(--border); background:var(--bg-elevated); border-radius:4px 0 0 0">
              <h2 style="font-size:15px; font-weight:800; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; color:var(--text-main)">
                Customer Profile
                ${store.selectedCustomer ? `<button id="qcClearBtn" class="btn btn-ghost btn-sm" style="color:var(--primary-light); font-size:11px; padding:0 4px; font-weight:700" title="Switch to Walk-in"><i class="fa-solid fa-redo"></i> Reset</button>` : ''}
              </h2>
              <div style="display:flex; gap:6px; margin-bottom:12px; position:relative;">
                <div style="position:relative; flex:1; display:flex;">
                  <input type="text" id="qcSearchPhone" placeholder="Name or Phone..." autocomplete="off" style="flex:1; border:2px solid var(--info); background:var(--bg-card); color:var(--text-main); padding:6px 10px; font-size:14px; border-radius:6px; outline:none;" />
                  <div id="qcSuggestions" class="ep-suggestions hidden" style="top:42px; left:0; width:100%; min-width:250px;"></div>
                </div>
                <button id="qcSearchBtn" class="btn btn-secondary btn-sm" style="padding:0 12px; border-radius:6px; background:var(--bg-elevated); border:1px solid var(--border)"><i class="fa-solid fa-search"></i></button>
                <button id="quickCustBtn" style="display:none"></button>
              </div>

              <!-- Default / Selected State Card -->
              <div id="qcActiveCard" style="display:flex; align-items:center; justify-content:space-between; background:var(--bg-elevated); border:1px solid var(--border); padding:10px; border-radius:12px;">
                 <div style="display:flex; align-items:center; gap:12px;">
                    <div style="width:36px; height:36px; border-radius:8px; background:var(--bg-hover); display:flex; align-items:center; justify-content:center; color:var(--primary-light);">
                       ${store.selectedCustomer?.image ? `<img src="${store.selectedCustomer.image}" style="width:100%; height:100%; border-radius:8px; object-fit:cover" />` : `<i class="fa-solid fa-user"></i>`}
                    </div>
                    <div>
                       <div style="font-size:14px; font-weight:700; color:var(--text-main);">${escapeHtml(store.selectedCustomer?.name || 'Walk-in Customer')}</div>
                       <div style="font-size:11px; color:var(--primary-light); font-weight:600;">${store.selectedCustomer ? escapeHtml(store.selectedCustomer.phone || 'No Phone') : 'General Guest'}</div>
                    </div>
                 </div>
                 ${!store.selectedCustomer ? `<button id="qcAddBtn" style="width:28px; height:28px; border-radius:6px; background:var(--bg-hover); color:var(--primary-light); border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:14px;"><i class="fa-solid fa-plus"></i></button>` : ''}
              </div>
            </div>

            <!-- Scrollable Form Area -->
            <div class="custom-scrollbar" style="flex:1; overflow-y:auto; padding:12px;">
               <div class="form-group" style="margin-bottom:8px">
                 <label class="form-label" style="font-size:11px; font-weight:700; margin-bottom:2px">Name *</label>
                 <input class="form-input" id="qcName" value="${escapeHtml(store.selectedCustomer?.name || '')}" placeholder="Enter name" tabindex="2" style="border-radius:4px; font-size:13px; height:28px" />
               </div>

               <div class="form-group" style="margin-bottom:12px">
                 <label class="form-label" style="font-size:11px; font-weight:700; margin-bottom:2px">Phone *</label>
                 <input class="form-input" id="qcPhone" value="${escapeHtml(store.selectedCustomer?.phone || '')}" placeholder="Enter phone" tabindex="2" style="border-radius:4px; font-size:13px; height:28px" />
               </div>

               <details style="margin-bottom:12px; border:1px solid var(--border); border-radius:4px; background:var(--bg-elevated); overflow:hidden">
                 <summary style="padding:6px 10px; font-size:11px; font-weight:700; cursor:pointer; color:var(--text-secondary); outline:none;">
                   More Options
                 </summary>
                 <div style="padding:10px; border-top:1px solid var(--border); background:var(--bg-card)">
                    <div class="form-group" style="margin-bottom:8px">
                      <div style="display:flex;gap:10px;align-items:center;">
                        <div id="qcImagePreview" style="width:40px;height:40px;border-radius:20px;background:var(--bg-elevated);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;overflow:hidden">
                          ${store.selectedCustomer?.image ? `<img src="${store.selectedCustomer.image}" style="width:100%;height:100%;object-fit:cover" />` : `<i class="fa-solid fa-user" style="opacity:0.3;font-size:16px"></i>`}
                        </div>
                        <div>
                          <input type="file" id="qcImageFile" accept="image/*" style="display:none" />
                          <button class="btn btn-ghost btn-xs" onclick="document.getElementById('qcImageFile').click()" style="padding:0 6px; font-size:11px; border:1px solid var(--border)"><i class="fa-solid fa-camera mr-4"></i> Photo</button>
                        </div>
                      </div>
                      <input type="hidden" id="qcImageBase64" value="${store.selectedCustomer?.image || ''}" />
                    </div>
                    
                    <div class="form-group" style="margin-bottom:2px">
                      <label class="form-label" style="font-size:11px; font-weight:700; margin-bottom:2px">Email</label>
                      <input class="form-input" id="qcEmail" value="${escapeHtml(store.selectedCustomer?.email || '')}" placeholder="Optional" tabindex="2" style="border-radius:4px; font-size:13px; height:28px" />
                    </div>
                 </div>
               </details>

               <button id="qcSaveBtn" tabindex="2" class="btn btn-primary btn-sm" style="width:100%; font-weight:bold; font-size:12px; border-radius:4px; height:32px">Save Profile</button>

               <!-- Assign Staff (optional — most sales have none, that's normal).
                    Same type-to-filter keyboard-driven autosuggest pattern as
                    the customer search box above (#qcSearchPhone/#qcSuggestions)
                    instead of a click-only dropdown — QuickPOS is a
                    keyboard-first screen, so typing + Arrow keys + Enter is
                    the expected way to pick staff here, matching every other
                    picker on this screen. -->
               ${settings.enableStaffEarnings !== false && staffList.length > 0 ? `
               <div class="form-group" style="margin-top:12px; padding-top:10px; border-top:1px dashed var(--border); position:relative">
                 <label class="form-label" style="font-size:11px; font-weight:700; margin-bottom:2px">Assign Staff</label>
                 <div style="position:relative;">
                   <input type="text" id="qpStaffSearch" placeholder="Type staff name..." autocomplete="off"
                     style="width:100%; border:1px solid var(--border); background:var(--bg-card); padding:6px 10px; font-size:13px; border-radius:4px; outline:none; color:var(--text-main)"
                     value="${escapeHtml(store.selectedStaff ? store.selectedStaff.name : '')}" />
                   <div id="qpStaffSuggestions" class="ep-suggestions hidden" style="top:36px; left:0; width:100%; max-height:160px; overflow-y:auto;"></div>
                 </div>
                 ${store.selectedStaff ? `<button type="button" id="qpClearStaffBtn" class="btn btn-ghost btn-xs" style="color:var(--danger); padding:3px 0 0; font-size:11px; font-weight:700"><i class="fa-solid fa-circle-xmark"></i> Clear</button>` : ''}
               </div>
               ` : ''}
            </div>

            <!-- Fixed Loyalty Area at Bottom (COMPACT) -->
            ${(settings.enableLoyalty !== false || settings.enableCredit !== false) ? `
            <div style="padding:10px; border-top:1px solid var(--border); background:var(--bg-card); ${!store.selectedCustomer ? 'opacity:0.3; pointer-events:none;' : ''} border-radius:0 0 0 4px">
                <div style="font-size:10px; font-weight:800; color:var(--text-secondary); margin-bottom:6px; letter-spacing:0.8px; text-transform:uppercase; display:flex; justify-content:space-between; align-items:center">
                   Loyalty Rewards
                   <button id="quickResetBtn" class="btn btn-ghost btn-xs" style="color:var(--danger); padding:0" title="Reset (Alt+R)">
                     <i class="fa-solid fa-rotate-right"></i>
                   </button>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-elevated); padding:8px 10px; border:1px solid var(--border); border-radius:4px;">
                  ${settings.enableLoyalty !== false ? `
                  <div>
                     <div style="font-size:10px; color:var(--text-secondary); font-weight:600">Points</div>
                     <div style="font-size:18px; font-weight:900; color:var(--info)" id="qcPointsDisplay">${store.selectedCustomer?.loyaltyPoints || 0}</div>
                  </div>
                  ` : ''}
                  ${settings.enableCredit !== false ? `
                  <div style="text-align:right">
                     <div style="font-size:10px; color:var(--text-secondary); font-weight:600">Credit</div>
                     <div style="font-size:16px; font-weight:900; color:${(store.selectedCustomer?.creditBalance || 0) < 0 ? 'var(--danger)' : 'var(--success)'}">${cur}${(store.selectedCustomer?.creditBalance || 0).toLocaleString()}</div>
                  </div>
                  ` : ''}
                </div>
            </div>
            ` : ''}
         </div>

         <!-- Center Column: Transaction Table -->
         <div class="ep-transaction-col">
            <div class="ep-table-title">Item Detail</div>
            <div class="ep-table-wrap custom-scrollbar">
               <table class="ep-table">
                  <thead>
                     <tr>
                        <th style="width:50px; text-align:center">S.No.</th>
                        <th>Item Name</th>
                        <th style="width:70px; text-align:center">Unit</th>
                        <th style="width:50px; text-align:center">Qty</th>
                        <th style="width:90px; text-align:right">Rate</th>
                        <th style="width:80px; text-align:right">Dis</th>
                        <th style="width:78px; text-align:center" title="Tax amount, rate %, and whether it's Included in the Rate shown (Incl) or added on top (Excl)">Tx</th>
                        <th style="width:100px; text-align:right">Amount</th>
                     </tr>
                  </thead>
                  <tbody id="quickCartBody">
                     <!-- Cart items here -->
                  </tbody>
               </table>
            </div>
         </div>
      </div>

      <!-- Bottom Section: Shortcuts & Totals -->
      <div class="ep-bottom-bar">
         <div class="ep-shortcut-grid" style="grid-template-columns: repeat(${hasStaffShortcuts ? 7 : 6}, 1fr)">
            <button class="ep-f-btn" id="btnReset" data-key="Alt+R"><span class="ep-key-red">Alt+R</span> Reset POS</button>
            <button class="ep-f-btn" id="btnDisc" data-key="Alt+D"><span class="ep-key-red">Alt+D</span> Extra Disc</button>
            <button class="ep-f-btn" id="btnExtraTax" data-key="Alt+L"><span class="ep-key-red">Alt+L</span> Extra Tax</button>
            <button class="ep-f-btn" id="btnToggleType" data-key="Alt+A"><span class="ep-key-red">Alt+A</span> Disc % / \u20B9</button>
            <button class="ep-f-btn" id="btnScanFocus" data-key="Alt+S"><span class="ep-key-red">Alt+S</span> Scan / Search</button>
            <button class="ep-f-btn" id="btnSearch" data-key="Alt+F"><span class="ep-key-red">Alt+F</span> Cust Search</button>
            <button class="ep-f-btn" id="btnAdd" data-key="Alt+C"><span class="ep-key-red">Alt+C</span> Save/Add Cust</button>
            <button class="ep-f-btn" id="btnResetCust" data-key="Alt+E"><span class="ep-key-red">Alt+E</span> Cust Reset</button>
            ${settings.enableStaffEarnings !== false && staffList.length > 0 ? `
            <button class="ep-f-btn" id="btnStaffFocus" data-key="Alt+T"><span class="ep-key-red">Alt+T</span> Staff Search</button>
            <button class="ep-f-btn" id="btnStaffClear" data-key="Alt+X"><span class="ep-key-red">Alt+X</span> Staff Clear</button>
            ` : ''}
            <button class="ep-f-btn" id="btnPayShortcut" data-key="Alt+Enter"><span class="ep-key-red">Alt+Enter</span> PAY</button>
            <button class="ep-f-btn" data-key="Del"><span class="ep-key-red">Del</span> Delete Item</button>
            <button class="ep-f-btn" data-key="+"><span class="ep-key-red">+</span> Qty Inc</button>
            <button class="ep-f-btn" data-key="-"><span class="ep-key-red">-</span> Qty Dec</button>
         </div>

         <div class="ep-summary-section">
            <div class="ep-totals-box ep-cart-summary">
                <div class="ep-total-row"><label>Items:</label> <span>0</span></div>
                <div class="ep-total-row" id="itemDiscountRow"><label>Itm Disc:</label> <span>${cur}0.00</span></div>
                <div class="ep-total-row"><label>Sub:</label> <span id="quickSubtotalDisplay">${cur}0.00</span></div>
                <div class="ep-total-row" id="itemTaxRow"><label>Itm Tax:</label> <span>${cur}0.00</span></div>
                <div class="ep-total-row" id="orderDiscountRow"><label>Extra Disc:</label> <span id="quickDiscountDisplay">${cur}0.00</span></div>
                <div class="ep-total-row" id="orderExtraTaxRow"><label>Ext Tax:</label> <span id="quickExtraTaxDisplay">${cur}0.00</span></div>
                <div class="ep-total-row" id="roundOffRow" style="display:none"><label>Round Off:</label> <span id="quickRoundOffDisplay">${cur}0.00</span></div>
            </div>
            <div class="ep-grand-total">
               <div id="quickBeforeDiscDisplay" style="font-size:11px; font-weight:700; text-decoration:line-through; opacity:0.6; display:none"></div>
               <div class="ep-total-amount" id="quickTotalDisplay">${cur}0.00</div>
            </div>
             <button class="ep-finish-btn" id="quickPayBtn">
                <div class="ep-finish-bot" style="font-size: 18px;">PAY</div>
             </button>
         </div>
      </div>

      <div id="quickSearchSuggestions" class="ep-suggestions hidden"></div>
    </div>

    <style>
      /* Themed with the app's CSS variables (defined per Appearance theme
         on <body> — see style.css/main.js applyTheme()) instead of fixed
         hex values, so this screen switches with the rest of the app
         instead of always rendering as a fixed light-mode surface. A
         handful of deliberately theme-independent spots (the LED-style
         grand-total readout, and white text sitting on solid accent-color
         buttons) are called out below and kept hardcoded on purpose. */
      .enterprise-pos-container {
        display: flex;
        flex-direction: column;
        height: 100vh;
        background: var(--bg-app);
        color: var(--text-main);
        font-family: 'Segoe UI', Tahoma, sans-serif;
        padding: 0;
        box-sizing: border-box;
        overflow: hidden;
      }

      .ep-status-panel { width: 250px; border-left: 1px solid var(--border); padding-left: 16px; }
      .ep-status-row { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px; }
      .ep-status-row label { color: var(--text-secondary); }
      .ep-status-row span { font-weight: 700; }

      /* Search Bar (PREMIUM COMPACT) */
      .ep-search-bar {
        background: var(--bg-card);
        border-bottom: 2px solid var(--info);
        padding: 4px 16px;
        display: flex;
        align-items: center;
        gap: 20px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.05);
      }
      .ep-f5-label { font-size: 20px; display: flex; align-items: center; gap: 8px; font-weight: 800; }
      .ep-key-red { color: var(--danger); font-weight: 900; }
      .ep-input-wrap { flex: 1; display: flex; align-items: center; gap: 12px; }
      .ep-input-wrap label { font-size: 15px; font-weight: 800; color: var(--text-main); text-transform: uppercase; letter-spacing: 0.5px; }
      .ep-input-wrap input {
        flex: 1;
        height: 32px;
        border: none;
        border-bottom: 2px solid var(--border);
        background: transparent;
        color: var(--text-main);
        font-size: 18px;
        font-weight: 700;
        padding: 0 4px;
        outline: none;
        transition: border-color 0.2s;
      }
      .ep-input-wrap input:focus { border-color: var(--info); }
      .ep-cashier-info { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; color: var(--text-secondary); }
      .ep-cashier-info span { color: var(--text-main); }

      /* Inline Payment Options strip */
      .ep-pay-strip { background: var(--bg-card); border-bottom: 1px solid var(--border); }
      .ep-pay-strip-summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 6px 16px;
        cursor: pointer;
      }

      /* Main Grid */
      .ep-main-grid { flex: 1; display: flex; gap: 8px; overflow: hidden; margin-bottom: 8px; }

      /* Left Column: Catalog */
      .ep-catalog-col { width: 400px; display: flex; flex-direction: column; background: var(--bg-card); border: 1px solid var(--border); }
      .ep-catalog-header { background: var(--bg-elevated); padding: 4px 8px; font-size: 12px; border-bottom: 1px solid var(--border); }
      .ep-product-grid { flex: 1; overflow-y: auto; display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; padding: 8px; }
      .ep-product-card {
        border: 1px solid var(--border);
        padding: 8px;
        text-align: center;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        flex-direction: column;
        align-items: center;
      }
      .ep-product-card:hover { border-color: var(--danger); box-shadow: 0 0 5px var(--danger-glow); }
      .ep-product-card img { width: 100px; height: 100px; object-fit: contain; margin-bottom: 8px; }
      .ep-product-card span { font-size: 12px; font-weight: 600; line-height: 1.2; height: 2.4em; overflow: hidden; }

      /* Center Column: Table */
      .ep-transaction-col { flex: 1; background: var(--bg-card); border: 1px solid var(--border); display: flex; flex-direction: column; }
      .ep-table-title { background: var(--bg-elevated); padding: 4px 10px; font-size: 13px; font-weight: 700; color: var(--text-secondary); border-bottom: 1px solid var(--border); }
      .ep-table-wrap { flex: 1; overflow-y: auto; }
      .ep-table { width: 100%; border-collapse: collapse; }
      .ep-table th {
        background: var(--bg-elevated);
        border-bottom: 1px solid var(--border);
        border-right: 1px solid var(--border);
        padding: 6px 10px;
        text-align: left;
        font-size: 13px;
        color: var(--text-secondary);
        position: sticky;
        top: 0;
        z-index: 10;
      }
      .ep-table th:last-child { border-right: none; }
      .ep-table td {
        border-bottom: 1px solid var(--border);
        border-right: 1px solid var(--border);
        padding: 6px 10px;
        font-size: 14px;
        font-weight: 600;
        color: var(--text-main);
      }
      .ep-table td:last-child { border-right: none; }
      .ep-table tr.selected-row { background: var(--primary) !important; }
      .ep-table tr.selected-row td { color: #ffffff !important; }

      /* Bottom Section */
      .ep-bottom-bar { display: flex; gap: 10px; align-items: stretch; padding: 4px 0; }
      .ep-shortcut-grid {
        flex: 1;
        display: grid;
        /* Column count is set inline per-render (6 or 7, based on whether
           the 2 Staff shortcut buttons are present) so the button count
           always divides evenly into exactly 2 rows — no dangling gap on
           one end, no overflow into an implicit, unevenly-sized 3rd row. */
        grid-template-rows: repeat(2, 1fr);
        gap: 4px;
      }
      .ep-f-btn {
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: 6px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 4px;
        cursor: pointer;
        font-weight: 700;
        font-size: 11px;
        transition: all 0.2s;
        color: var(--text-secondary);
      }
      .ep-f-btn span { color: var(--danger); font-size: 10px; margin-bottom: 2px; font-weight: 900; }
      .ep-f-btn:hover, .ep-f-btn.active { background: var(--danger-glow); border-color: var(--danger); color: var(--danger); }
      .ep-f-btn:active { transform: scale(0.95); }

      .ep-summary-section { width: 680px; display: flex; gap: 6px; align-items: stretch; background: var(--bg-card); padding: 4px; border-radius: 8px; border: 1px solid var(--border); }
      .ep-totals-box {
        flex: 1;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 2px 10px;
        padding: 4px 8px;
        align-content: center;
      }
      .ep-total-row {
        display: flex;
        justify-content: space-between;
        font-size: 12px;
        font-weight: 700;
        padding: 2px 0;
        border-bottom: 1px solid var(--border);
        align-items: center;
      }
      .ep-total-row:last-child, .ep-total-row:nth-last-child(2) { border-bottom: none; }
      .ep-total-row label { color: var(--text-secondary); font-size: 11px; text-transform: uppercase; }
      .ep-total-row span { color: var(--text-main); }

      .ep-total-row[id*="order"] {
        cursor: pointer;
        transition: background 0.2s;
        border-radius: 4px;
        padding: 2px 6px;
        margin: 0 -4px;
        background: var(--bg-elevated);
        border: 1px solid transparent;
      }
      .ep-total-row[id*="order"]:hover {
        background: var(--bg-hover);
        border-color: var(--border);
      }

      /* Uses --primary-dark (the theme's own dark brand shade) rather than
         --bg-app — --bg-app goes pale on light themes, which would wash out
         an "LED readout" look, but --primary-dark stays a deep, saturated
         shade in every theme (light or dark), so the readout both keeps its
         digital-display contrast AND actually changes with the theme. */
      .ep-grand-total {
        width: auto;
        min-width: 160px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        background: var(--primary-dark);
        color: white;
        border-radius: 6px;
        padding: 4px 12px;
        text-align: right;
      }
      .ep-grand-total label { font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase; margin-bottom: 0; }
      .ep-total-amount {
        color: white;
        font-family: 'Delius Unicase', monospace;
        font-size: 42px;
        font-weight: 900;
        line-height: 1;
      }

      /* Uses the theme's own brand color (--primary), same as .btn-primary
         elsewhere in the app, so PAY visibly matches whichever Appearance
         theme is active instead of always being a fixed green. White text
         on it stays fixed regardless of theme (same reasoning as the
         grand-total readout below) — every theme's --primary is dark/
         saturated enough for that, matching .btn-primary's own convention. */
      .ep-finish-btn {
        width: 100px;
        background: linear-gradient(135deg, var(--primary), var(--primary-dark));
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 900;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
        box-shadow: 0 4px 0 rgba(0,0,0,0.25);
      }
      .ep-finish-btn:hover { filter: brightness(1.08); transform: translateY(-1px); box-shadow: 0 5px 0 rgba(0,0,0,0.25); }
      .ep-finish-btn:active { filter: brightness(0.95); transform: translateY(2px); box-shadow: 0 2px 0 rgba(0,0,0,0.25); }
      .ep-finish-top { font-size: 16px; opacity: 0.9; }
      .ep-finish-bot { font-size: 13px; text-transform: uppercase; }

      .ep-suggestions {
        position: absolute;
        top: 48px;
        left: 300px;
        width: 600px;
        background: var(--bg-card);
        border: 2px solid var(--info);
        z-index: 1000;
        box-shadow: 0 10px 25px rgba(0,0,0,0.2);
        border-radius: 6px;
      }
      .ep-suggestion-item { padding: 12px; border-bottom: 1px solid var(--border); cursor: pointer; display: flex; justify-content: space-between; color: var(--text-main); }
      .ep-suggestion-item.active { background: var(--danger-glow); }

      .ep-btn-sm {
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
        height: 24px;
        font-weight: 800;
        color: var(--text-secondary);
      }
      .ep-btn-sm:hover { background: var(--bg-hover); color: var(--text-main); }
      .ep-btn-sm:active { transform: scale(0.95); }

      .hidden { display: none !important; }
    </style>
  `;

  const searchInput = container.querySelector('#quickProductSearch');
  const suggestionsEl = container.querySelector('#quickSearchSuggestions');
  const cartBody = container.querySelector('#quickCartBody');
  // const totalDisplay = container.querySelector('#quickTotalDisplay'); // Removed, now handled by new renderCart
  // const subtotalDisplay = container.querySelector('#quickSubtotalDisplay'); // Removed, now handled by new renderCart
  // const taxDisplay = container.querySelector('#quickTaxDisplay'); // Removed, now handled by new renderCart
  // const discountDisplay = container.querySelector('#quickDiscountDisplay'); // Removed, now handled by new renderCart
  // const itemCountDisplay = container.querySelector('#quickItemCount'); // Removed, now handled by new renderCart

  const resetQuickPOS = () => {
    store.cart = [];
    store.selectedCustomer = null;
    store.selectedStaff = null;
    selectedCartIndex = -1;
    selectedColIndex = -1;
    renderQuickPOS(container);
    showToast('POS Reset Success', 'success');
  };

  // Helper to keep focus
  const keepFocus = () => {
    const active = document.activeElement;
    const isModal = !!document.querySelector('.modal');
    if (!isModal && active?.tagName !== 'INPUT' && active?.tagName !== 'TEXTAREA') {
      searchInput.focus();
    }
  };
  const focusInterval = setInterval(keepFocus, 2000);
  const renderCart = async () => {
    const { subtotal, itemDiscount, itemTax, grossTax, orderDiscount, orderTax, total, roundOff } = getCartTotals();
    const s = await getSettings();
    const cur = s.currencySymbol || '\u20B9';

    const cartSummary = container.querySelector('.ep-cart-summary');
    if (cartSummary) {
      const itemsRow = cartSummary.querySelector('.ep-total-row:first-child span');
      if (itemsRow) itemsRow.textContent = store.cart.length;

      const subtotalDisplay = container.querySelector('#quickSubtotalDisplay');
      const totalDisplay = container.querySelector('#quickTotalDisplay');
      const beforeDiscDisplay = container.querySelector('#quickBeforeDiscDisplay');
      const itemDiscDisplay = container.querySelector('#itemDiscountRow span:last-child');
      const itemTaxDisplay = container.querySelector('#itemTaxRow span:last-child');

      // Updates the big total AND, when there's an active order-level Extra
      // Disc, the small struck-through "before discount" figure above it —
      // the same before/after treatment the item rows show for item-level
      // discounts. `t` is the (post-discount) grand total; `disc` is
      // getCartTotals()'s `orderDiscount` for that same total.
      const updateGrandTotal = (t, disc) => {
        if (totalDisplay) totalDisplay.textContent = `${cur}${t.toFixed(2)}`;
        if (beforeDiscDisplay) {
          if (disc > 0) {
            beforeDiscDisplay.textContent = `${cur}${(t + disc).toFixed(2)}`;
            beforeDiscDisplay.style.display = '';
          } else {
            beforeDiscDisplay.style.display = 'none';
          }
        }
      };

      if (subtotalDisplay) subtotalDisplay.textContent = `${cur}${subtotal.toFixed(2)}`;
      updateGrandTotal(total, orderDiscount);
      if (itemDiscDisplay) itemDiscDisplay.textContent = `${cur}${itemDiscount.toFixed(2)}`;
      if (itemTaxDisplay) itemTaxDisplay.textContent = `${cur}${(grossTax || itemTax).toFixed(2)}`;

      // Order Discount Row
      const discRow = container.querySelector('#orderDiscountRow');
      if (discRow) {
        // setDiscount() (called from this row's own oninput below) fires
        // renderCartEvent(), which re-invokes this whole renderCart() via
        // the onCartUpdate() listener at the bottom of this file — so every
        // keystroke was rebuilding discRow's innerHTML from scratch,
        // replacing the live <input> with a brand-new unfocused one and
        // kicking focus out mid-type. Skip the rebuild when the existing
        // input already has focus; its value/total are kept live by the
        // oninput handler itself, so there's nothing to rebuild for.
        const discInputHasFocus = isGlobalDiscEditing && document.activeElement?.id === 'globalDiscInput';
        if (isGlobalDiscEditing && discInputHasFocus) {
          // no-op — leave the focused input alone
        } else if (isGlobalDiscEditing) {
          discRow.innerHTML = `
            <label>Extra Disc (Alt+D):</label>
            <div style="display:flex; align-items:center; gap:4px;">
              <input id="globalDiscInput" type="number" step="0.01" value="${store.discountRaw || 0}" style="width:70px; height:24px; text-align:right; border:2px solid var(--info); background:var(--bg-card); color:var(--text-main); border-radius:4px; font-weight:700; outline:none; padding: 0 4px;" />
              <button id="globalDiscTypeBtn" class="ep-btn-sm" data-type="${store.discountType}" style="padding: 2px 6px;">${store.discountType === 'flat' ? cur : '%'}</button>
            </div>
          `;
          const inp = discRow.querySelector('#globalDiscInput');
          const btn = discRow.querySelector('#globalDiscTypeBtn');
          btn.onclick = async () => {
            const newType = btn.dataset.type === 'flat' ? 'pct' : 'flat';
            btn.dataset.type = newType;
            btn.textContent = newType === 'flat' ? cur : '%';
            await setDiscount(parseFloat(inp.value) || 0, newType);
            const { total: t, orderDiscount: d } = getCartTotals();
            updateGrandTotal(t, d);
          };

          inp.oninput = async () => {
            await setDiscount(parseFloat(inp.value) || 0, btn.dataset.type);
            const { total: t, orderDiscount: d } = getCartTotals();
            updateGrandTotal(t, d);
          };
          
          inp.onkeydown = async (e) => {
            if (e.key === 'Enter') { 
              e.preventDefault(); 
              isGlobalDiscEditing = false; 
              await renderCart(); 
              searchInput.focus(); 
            }
            if (e.key === 'Escape') { 
              isGlobalDiscEditing = false; 
              await renderCart(); 
              searchInput.focus(); 
            }
            if (e.altKey && e.key.toLowerCase() === 'a') {
              e.preventDefault();
              e.stopPropagation();
              btn.click();
            }
          };
        } else {
          discRow.innerHTML = `<label>Extra Disc:</label> <span id="quickDiscountDisplay">${cur}${orderDiscount.toFixed(2)}</span>`;
        }
      }

      // Order Extra Tax Row
      const extraTaxRow = container.querySelector('#orderExtraTaxRow');
      if (extraTaxRow) {
        // Same focus-stealing issue as discRow above (setExtraTax()'s
        // renderCartEvent() re-triggers this whole renderCart()) — skip
        // the rebuild while the input already has focus.
        const extraTaxInputHasFocus = isExtraTaxEditing && document.activeElement?.id === 'extraTaxInput';
        if (isExtraTaxEditing && extraTaxInputHasFocus) {
          // no-op — leave the focused input alone
        } else if (isExtraTaxEditing) {
          extraTaxRow.innerHTML = `
            <label>Extra Tax (Alt+L):</label>
            <div style="display:flex; align-items:center; gap:4px;">
              <input id="extraTaxInput" type="number" step="0.01" value="${store.extraTaxRaw || 0}" style="width:70px; height:24px; text-align:right; border:2px solid var(--danger); background:var(--bg-card); color:var(--text-main); border-radius:4px; font-weight:700; outline:none; padding: 0 4px;" />
              <button id="extraTaxTypeBtn" class="ep-btn-sm" data-type="${store.extraTaxType}" style="padding: 2px 6px;">${store.extraTaxType === 'flat' ? cur : '%'}</button>
            </div>
          `;
          const inp = extraTaxRow.querySelector('#extraTaxInput');
          const btn = extraTaxRow.querySelector('#extraTaxTypeBtn');
          
            btn.onclick = async () => {
              const newType = btn.dataset.type === 'flat' ? 'pct' : 'flat';
              btn.dataset.type = newType;
              btn.textContent = newType === 'flat' ? cur : '%';
              await setExtraTax(parseFloat(inp.value) || 0, newType);
              const { total: t, orderDiscount: d } = getCartTotals();
              updateGrandTotal(t, d);
            };

            inp.oninput = async () => {
              await setExtraTax(parseFloat(inp.value) || 0, btn.dataset.type);
              const { total: t, orderDiscount: d } = getCartTotals();
              updateGrandTotal(t, d);
            };
            
            inp.onkeydown = async (e) => {
              if (e.key === 'Enter') { 
                e.preventDefault(); 
                isExtraTaxEditing = false; 
                await renderCart(); 
                searchInput.focus(); 
              }
              if (e.key === 'Escape') { 
                isExtraTaxEditing = false; 
                await renderCart(); 
                searchInput.focus(); 
              }
              if (e.altKey && e.key.toLowerCase() === 'a') {
                e.preventDefault();
                e.stopPropagation();
                btn.click();
              }
            };
        } else {
          extraTaxRow.innerHTML = `<label>Extra Tax:</label> <span id="quickExtraTaxDisplay">${cur}${orderTax.toFixed(2)}</span>`;
        }
      }

      // Keep the Alt+D/Alt+L shortcut buttons visibly "pressed" (same red
      // highlight as :hover, via a persistent .active class) for as long as
      // their inline editor is open — not just while the mouse happens to
      // be sitting on top of the button.
      const btnDiscEl = container.querySelector('#btnDisc');
      if (btnDiscEl) btnDiscEl.classList.toggle('active', isGlobalDiscEditing);
      const btnExtraTaxEl = container.querySelector('#btnExtraTax');
      if (btnExtraTaxEl) btnExtraTaxEl.classList.toggle('active', isExtraTaxEditing);

      // Round Off Row
      const roundRow = container.querySelector('#roundOffRow');
      if (roundRow) {
        if (Math.abs(roundOff) > 0.001) {
          roundRow.style.display = '';
          const valEl = roundRow.querySelector('span');
          if (valEl) valEl.textContent = `${roundOff > 0 ? '+' : ''}${cur}${roundOff.toFixed(2)}`;
        } else {
          roundRow.style.display = 'none';
        }
      }
    }
    
    // Original rendering logic for the items table
    const items = store.cart;

    if (items.length > 0 && selectedCartIndex === -1) {
        selectedCartIndex = items.length - 1;
    }

    // Save scroll position BEFORE innerHTML resets it
    const tableWrap = container.querySelector('.ep-table-wrap');
    const savedScroll = tableWrap ? tableWrap.scrollTop : 0;
    
    cartBody.innerHTML = items.map((item, idx) => {
      const qty = parseFloat(parseFloat(item.qty).toFixed(3)) || 0;
      const extPrice   = item.price * qty;
      const itemDisc   = item.itemDiscount > 0
        ? (item.itemDiscountType === 'pct' ? extPrice * item.itemDiscount / 100 : item.itemDiscount * qty)
        : 0;
      const taxable    = extPrice - itemDisc;
      const taxRate    = item.taxRate || 0;
      const taxAmt     = item.taxType === 'inclusive'
        ? taxable - taxable / (1 + taxRate / 100)
        : taxable * taxRate / 100;
      const lineTotal  = item.taxType === 'inclusive' ? taxable : taxable + taxAmt;
      const isSelected = idx === selectedCartIndex;

      // "Before discount" line total = lineTotal + itemDisc, so struck
      // minus discount always reconstructs to the real total exactly (what
      // you see is "you saved ₹itemDisc", plain and simple).
      //
      // Deliberately NOT "re-tax the full undiscounted extPrice from
      // scratch" (extPrice + extPrice*rate/100) — for an exclusive-tax item
      // that recomputes tax on a *larger* base than lineTotal's own taxable
      // amount, so it's off from lineTotal+itemDisc by tax-on-the-discount-
      // portion (e.g. a ₹3 discount at 5% tax made that version land ₹0.15
      // too high — ₹189.00 instead of ₹188.85 for a ₹185.85 final total).
      // This version is exact for both inclusive and exclusive items, by
      // construction, since it's just derived from lineTotal itself.
      const beforeDiscTotal = itemDisc > 0 ? lineTotal + itemDisc : null;

      // Inline editable cell renderer
      const qtyCell = isSelected && selectedColIndex === 0
        ? `<td style="text-align:center"><input id="colInput" type="number" min="0.001" step="0.001" value="${Number.isInteger(item.qty) ? item.qty : item.qty.toFixed(3)}" style="width:68px;text-align:center;font-weight:900;border:2px solid var(--info);background:var(--bg-card);color:var(--text-main);border-radius:4px;padding:2px 4px;outline:none"></td>`
        : `<td style="text-align:center; font-weight:900">${Number.isInteger(item.qty) ? item.qty : item.qty.toFixed(3)}</td>`;

      // For an inclusive-tax Rate, break out exactly what's "inside" it —
      // the pre-tax base price — instead of leaving the customer to work
      // out ₹65.00's base themselves. Derived from `taxable` (the
      // POST-discount amount, same one Tx's ₹ figure and Amount both come
      // from) rather than the raw item.price — so Base and Tx share the
      // same basis and actually add back up to Amount (Base + Tax =
      // Amount, per unit). Deriving it from item.price directly instead
      // (the undiscounted rate) used to give a Base that couldn't be
      // combined with Tx/Disc/Amount by hand at all: e.g. ₹19.05 (base of
      // the full ₹20) + ₹0.90 (tax on the discounted ₹19) came out to
      // ₹19.95, not the actual ₹19.00 — two figures from two different
      // calculation stages that were never meant to be added together.
      const preTaxRate = (item.taxType === 'inclusive' && taxRate > 0)
        ? (taxable / (1 + taxRate / 100)) / qty
        : null;

      const priceCell = isSelected && selectedColIndex === 1
        ? `<td style="text-align:right"><input id="colInput" type="number" min="0" step="0.01" value="${item.price.toFixed(2)}" style="width:80px;text-align:right;border:2px solid var(--info);background:var(--bg-card);color:var(--text-main);border-radius:4px;padding:2px 4px;outline:none"></td>`
        : `<td style="text-align:right" title="${item.taxType === 'inclusive' ? `This Rate already includes ${taxRate}% tax. After any discount, Base (${cur}${preTaxRate !== null ? preTaxRate.toFixed(2) : '0.00'}) + Tax = Amount.` : 'This Rate is before tax — tax is added on top (see Tx column)'}">
             <div>${item.price.toFixed(2)}</div>
             ${taxRate > 0 ? `<div style="font-size:10px; font-weight:700; opacity:0.65; white-space:nowrap">${item.taxType === 'inclusive' ? 'Tax Incl' : 'Tax Excl'}</div>` : ''}
             ${preTaxRate !== null ? `<div style="font-size:9px; opacity:0.55; white-space:nowrap">${cur}${preTaxRate.toFixed(2)}</div>` : ''}
           </td>`;

      const discCell = isSelected && selectedColIndex === 2
        ? `<td style="text-align:right; position:relative;">
             <div style="display:flex; align-items:center; justify-content:flex-end; gap:2px;">
               <input id="colInput" type="number" min="0" step="0.01" value="${item.itemDiscount || 0}" style="width:62px;text-align:right;border:2px solid var(--info);background:var(--bg-card);color:var(--text-main);border-radius:4px;padding:2px 4px;outline:none">
               <button id="colDiscTypeBtn" class="ep-btn-sm" data-type="${item.itemDiscountType || 'flat'}" style="padding: 2px 4px; font-size:10px;">${(item.itemDiscountType || 'flat') === 'flat' ? cur : '%'}</button>
             </div>
           </td>`
        : `<td style="text-align:right">${itemDisc > 0 ? (item.itemDiscountType === 'pct' ? `${item.itemDiscount}% <span style="opacity:0.6; font-weight:400">(${cur}${itemDisc.toFixed(2)})</span>` : itemDisc.toFixed(2)) : ''}</td>`;

      const descHtml = item.variantName
        ? `${escapeHtml(item.name)} <span style="font-size:11px;opacity:0.6;font-weight:normal">(${escapeHtml(item.variantName)})</span>`
        : escapeHtml(item.name);

      return `
      <tr class="${isSelected ? 'selected-row' : ''}" data-index="${idx}" data-cart-id="${item.cartId}">
        <td style="text-align:center; font-family:monospace">${idx + 1}</td>
        <td>${descHtml}</td>
        <td style="text-align:center; opacity:0.8">${item.unit || '-'}</td>
        ${qtyCell}
        ${priceCell}
        ${discCell}
        <td style="text-align:center" title="${taxRate > 0 ? `${taxRate}% GST, ${item.taxType === 'inclusive' ? 'Inclusive — already included in the Rate shown' : 'Exclusive — added on top of the Rate shown'}` : 'No tax on this item'}">
          ${taxRate > 0 ? `
            <div style="font-weight:700">${cur}${taxAmt.toFixed(2)}</div>
            <div style="font-size:10px; font-weight:700; opacity:0.65; white-space:nowrap">${taxRate}% ${item.taxType === 'inclusive' ? 'Incl' : 'Excl'}</div>
          ` : '<span style="opacity:0.5">—</span>'}
        </td>
        <td style="text-align:right; font-weight:900" title="${item.taxType === 'inclusive'
            ? `Rate ${cur}${item.price.toFixed(2)} − Discount ${cur}${itemDisc.toFixed(2)} = ${cur}${lineTotal.toFixed(2)} (tax was already inside the Rate — nothing more to add)`
            : `Rate ${cur}${item.price.toFixed(2)} − Discount ${cur}${itemDisc.toFixed(2)} + Tax ${cur}${taxAmt.toFixed(2)} = ${cur}${lineTotal.toFixed(2)}`}">${beforeDiscTotal !== null ? `<span style="text-decoration:line-through; opacity:0.5; font-weight:400; font-size:11px; margin-right:4px">${cur}${beforeDiscTotal.toFixed(2)}</span>` : ''}${lineTotal.toFixed(2)}</td>
      </tr>`;
    }).join('');

    // Always restore scroll — NO scrollIntoView here (prevents qty-update jump)
    if (tableWrap) tableWrap.scrollTop = savedScroll;

    // Focus the inline input if a column is selected
    if (selectedColIndex >= 0) {
      const input = cartBody.querySelector('#colInput');
      if (input) { 
        input.focus(); 
        input.select(); 
        
        // Handle toggle button click for item discount
        const typeBtn = cartBody.querySelector('#colDiscTypeBtn');
        if (typeBtn) {
            typeBtn.onclick = async (e) => {
              e.stopPropagation();
              const newType = typeBtn.dataset.type === 'flat' ? 'pct' : 'flat';
              typeBtn.dataset.type = newType;
              typeBtn.textContent = newType === 'flat' ? cur : '%';
              await saveColInput();
              await renderCart();
            };
        }
      }
    }

    window.renderCart = renderCart;
  };

  // Called ONLY when Arrow keys change the selected row (intentional navigation)
  const scrollToSelected = () => {
    const tableWrap = container.querySelector('.ep-table-wrap');
    const selectedRow = cartBody.querySelector('.selected-row');
    if (!selectedRow || !tableWrap) return;

    const rowTop = selectedRow.offsetTop;
    const rowBottom = rowTop + selectedRow.offsetHeight;
    const containerTop = tableWrap.scrollTop;
    const containerBottom = containerTop + tableWrap.clientHeight;

    if (rowTop < containerTop) {
        tableWrap.scrollTop = rowTop;
    } else if (rowBottom > containerBottom) {
        tableWrap.scrollTop = rowBottom - tableWrap.clientHeight;
    }
  };

  const performQuickAdd = async (product, variant = null, qty = 1) => {
    const cartId = await addToCart(product, variant, qty);
    lastAddedCartId = cartId;
    selectedCartIndex = store.cart.findIndex(i => i.cartId === cartId);
    searchInput.value = '';
    suggestionsEl.classList.add('hidden');
    await renderCart();
    setTimeout(scrollToSelected, 20);
    const displayName = variant ? `${escapeHtml(product.name)} (${escapeHtml(variant.name)})` : escapeHtml(product.name);
    const msg = qty !== 1 ? `${qty}${product.unit || 'kg'} of ${displayName} added` : `${displayName} added`;
    showToast(msg, 'success');
  };

  const handleQuickAdd = async (product, variant = null) => {
    if (!product) return;
    
    // If it's a click from catalog grid and it has variants, we MUST show a modal
    if (!variant && product.variants && product.variants.length > 0) {
      openModal({
        title: `${escapeHtml(product.name)} - Select Variant`,
        body: `
        <div class="ep-variant-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
          ${product.variants.map(v => `
            <button class="btn btn-ghost w-full quick-variant-btn" data-vname="${escapeHtml(v.name)}" style="justify-content:space-between; padding:16px; border:1px solid var(--border);">
              <div style="font-weight:700">${escapeHtml(v.name)}</div>
              <div style="color:var(--success);font-weight:900">${cur}${v.price}</div>
            </button>
          `).join('')}
        </div>
      `});
      document.querySelectorAll('.quick-variant-btn').forEach(btn => {
        btn.onclick = async () => {
          const chosenVar = product.variants.find(v => v.name === btn.dataset.vname);
          closeModal();
          await handleQuickAdd(product, chosenVar); // Re-enter with variant
        };
      });
      return;
    }

    await performQuickAdd(product, variant);
  };

  const openDiscountModal = async () => {
    const { total } = getCartTotals();
    const currentVal = store.discountRaw || 0;
    const currentType = store.discountType || 'flat';

    openModal({
      title: 'Apply Order Discount',
      body: `
      <div style="padding:10px;">
        <div class="form-group" style="margin-bottom:15px">
          <label class="form-label" style="font-weight:700">Discount Value</label>
          <input type="number" id="discValue" class="form-input" value="${currentVal}" step="0.01" style="font-size:18px; height:40px; border:2px solid var(--info); border-radius:6px; outline:none" />
        </div>
        <div class="form-group" style="margin-bottom:20px">
          <label class="form-label" style="font-weight:700">Discount Type</label>
          <select id="discType" class="form-select" style="font-size:16px; height:40px; border-radius:6px; border:1px solid var(--border); width:100%">
            <option value="flat" ${currentType === 'flat' ? 'selected' : ''}>Amount (${cur})</option>
            <option value="pct" ${currentType === 'pct' ? 'selected' : ''}>Percentage (%)</option>
          </select>
        </div>
        <button id="applyDiscBtn" class="btn btn-primary w-full" style="height:45px; font-weight:800; font-size:15px">Apply Discount</button>
      </div>
    `});

    const valInput = document.getElementById('discValue');
    const typeSelect = document.getElementById('discType');
    const applyBtn = document.getElementById('applyDiscBtn');

    valInput.focus();
    valInput.select();

    applyBtn.onclick = async () => {
      const val = parseFloat(valInput.value) || 0;
      const type = typeSelect.value;
      await setDiscount(val, type);
      closeModal();
      await renderCart();
      showToast(`Discount Applied: ${val} ${type === 'pct' ? '%' : cur}`, 'success');
    };
  };

  const btnDisc = container.querySelector('#btnDisc');
  if (btnDisc) {
    btnDisc.onclick = async () => {
      isGlobalDiscEditing = !isGlobalDiscEditing;
      await renderCart();
      if (isGlobalDiscEditing) {
        const inp = container.querySelector('#globalDiscInput');
        if (inp) { inp.focus(); inp.select(); }
      }
    };
  }

  searchInput.addEventListener('input', async (e) => {
    const query = e.target.value.toLowerCase().trim();
    if (!query) {
      suggestionsEl.classList.add('hidden');
      // Clear the stale list too, not just hide it — leaving the old
      // (still-"active") suggestion items sitting in the DOM meant that
      // pressing Enter (or Alt+Enter) right after clearing the search box
      // would silently re-add whatever product had been on top of the
      // last search, since the keydown handler below looks up ".active"
      // by DOM presence, not by whether the box is visibly open.
      suggestionsEl.innerHTML = '';
      return;
    }

    let flattenedMatches = [];
    const products = await getProducts(branchId);
    const rawMatches = products.filter(p => {
        return p.name.toLowerCase().includes(query) || 
               (p.sku && p.sku.toLowerCase() === query) ||
               (p.barcode && p.barcode.toLowerCase() === query);
    });

    for (const p of rawMatches) {
        if (p.variants && p.variants.length > 0) {
            for (const v of p.variants) {
                flattenedMatches.push({ product: p, variant: v });
            }
        } else {
            flattenedMatches.push({ product: p, variant: null });
        }
        if (flattenedMatches.length >= 20) break; // Allow a bit more for variants
    }
    flattenedMatches = flattenedMatches.slice(0, 10);

    if (flattenedMatches.length > 0) {
      suggestionsEl.classList.remove('hidden');
      suggestionsEl.innerHTML = flattenedMatches.map((item, idx) => {
        const p = item.product;
        const v = item.variant;
        const displayName = v ? `${escapeHtml(p.name)} <span style="font-size:12px;opacity:0.6">(${escapeHtml(v.name)})</span>` : escapeHtml(p.name);
        const displayPrice = v ? v.price : p.price;
        const vNameAttr = v ? `data-vname="${escapeHtml(v.name)}"` : '';
        return `
        <div class="ep-suggestion-item ${idx === 0 ? 'active' : ''}" data-id="${p.id}" ${vNameAttr}>
          <div style="font-weight:700">${displayName}</div>
          <div style="font-weight:900; color:var(--danger)">${cur}${displayPrice}</div>
        </div>
        `;
      }).join('');
    } else {
      suggestionsEl.classList.add('hidden');
    }
  });

  searchInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { // Ignore Shift+Enter here to avoid double-triggering product add
      const active = !suggestionsEl.classList.contains('hidden') ? suggestionsEl.querySelector('.ep-suggestion-item.active') : null;
      if (active) {
        const id = active.dataset.id;
        const vname = active.dataset.vname;
        const products = await getProducts(branchId);
        const product = products.find(p => String(p.id) === String(id));
        if (product) {
          const variant = vname && product.variants ? product.variants.find(v => v.name === vname) : null;
          await handleQuickAdd(product, variant);
        }
      } else if (e.altKey && searchInput.value === '' && store.cart.length > 0) {
        // Plain Enter on an empty search box no longer pays on its own —
        // requires Alt+Enter (matches the global shortcut) so an accidental
        // stray Enter press mid-scan can't jump straight to checkout.
        e.preventDefault();
        await completeQuickSale();
      }
    }
    if (e.key === 'ArrowDown' && !suggestionsEl.classList.contains('hidden')) {
        e.preventDefault();
        const items = Array.from(suggestionsEl.querySelectorAll('.ep-suggestion-item'));
        const activeIdx = items.findIndex(i => i.classList.contains('active'));
        items.forEach(i => i.classList.remove('active'));
        items[(activeIdx + 1) % items.length].classList.add('active');
    }
    if (e.key === 'ArrowUp' && !suggestionsEl.classList.contains('hidden')) {
        e.preventDefault();
        const items = Array.from(suggestionsEl.querySelectorAll('.ep-suggestion-item'));
        const activeIdx = items.findIndex(i => i.classList.contains('active'));
        items.forEach(i => i.classList.remove('active'));
        items[(activeIdx - 1 + items.length) % items.length].classList.add('active');
    }
  });

  const EDITABLE_COLS = 3; // 0=Qty, 1=UnitPrice, 2=Discount

  // Save the currently active inline input value
  const saveColInput = async () => {
    const input = cartBody.querySelector('#colInput');
    if (!input) return;
    const item = store.cart[selectedCartIndex];
    if (!item) return;
    const val = parseFloat(input.value);
    if (isNaN(val) || val < 0) return;
    if (selectedColIndex === 0) {
      // Qty
      const diff = val - item.qty;
      if (diff !== 0) await updateQty(item.cartId, diff);
    } else if (selectedColIndex === 1) {
      // Unit Price
      updateCartItem(item.cartId, { price: val });
    } else if (selectedColIndex === 2) {
      // Discount
      const typeBtn = cartBody.querySelector('#colDiscTypeBtn');
      const type = typeBtn ? typeBtn.dataset.type : (item.itemDiscountType || 'flat');
      await updateCartItem(item.cartId, { itemDiscount: val, itemDiscountType: type });
    }
  };

  const handleGlobalKeys = async (e) => {
    // SECURITY GUARD: Only run if the Quick POS view is still the active content of the page
    if (!container.querySelector('.enterprise-pos-container')) return;

    const isAlt = e.altKey || (typeof e.key === 'string' && e.key.startsWith('Alt+'));
    const isShift = e.shiftKey || (typeof e.key === 'string' && e.key.startsWith('Shift+'));
    const charKey = (typeof e.key === 'string' && e.key.includes('+')) ? e.key.split('+')[1].toLowerCase() : (e.key ? e.key.toLowerCase() : '');
    const suggestionsOpen = !suggestionsEl.classList.contains('hidden');

    // Alt + F: Customer Search
    if (isAlt && charKey === 'f') {
      e.preventDefault();
      const phoneInput = container.querySelector('#qcSearchPhone');
      if (phoneInput) phoneInput.focus();
      return;
    }
    // Alt + E: Customer Reset (Switch to Walk-in)
    if (isAlt && charKey === 'e') {
      e.preventDefault();
      await syncCustomerDisplay(null);
      return;
    }
    // Alt + T: Focus Staff Search (only when Staff Earnings is enabled and
    // there's staff to assign — button/entry is hidden otherwise, so this
    // is a no-op guard for a stale shortcut on a screen without the field)
    if (isAlt && charKey === 't') {
      e.preventDefault();
      const staffInput = container.querySelector('#qpStaffSearch');
      if (staffInput) { staffInput.focus(); staffInput.select(); }
      return;
    }
    // Alt + X: Clear Assigned Staff
    if (isAlt && charKey === 'x') {
      e.preventDefault();
      if (store.selectedStaff) {
        setStaff(null);
        await renderQuickPOS(container);
      }
      return;
    }
    // Alt + D: Toggle Inline Discount
    if (isAlt && charKey === 'd') {
      e.preventDefault();
      e.stopPropagation();
      isGlobalDiscEditing = !isGlobalDiscEditing;
      isExtraTaxEditing = false;
      await renderCart();
      if (isGlobalDiscEditing) {
        const inp = container.querySelector('#globalDiscInput');
        if (inp) { inp.focus(); inp.select(); }
        showToast('Extra Discount Editor Active', 'info');
      } else {
        searchInput.focus();
      }
      return;
    }
    // Alt + L: Toggle Extra Tax
    if (isAlt && charKey === 'l') {
      e.preventDefault();
      e.stopPropagation();
      isExtraTaxEditing = !isExtraTaxEditing;
      isGlobalDiscEditing = false;
      await renderCart();
      if (isExtraTaxEditing) {
        const inp = container.querySelector('#extraTaxInput');
        if (inp) { inp.focus(); inp.select(); }
        showToast('Extra Tax Editor Active', 'info');
      } else {
        searchInput.focus();
      }
      return;
    }
    // Alt + A: Toggle Type (when editing)
    if (isAlt && charKey === 'a') {
      if (isGlobalDiscEditing || isExtraTaxEditing) {
        e.preventDefault();
        e.stopPropagation();
        const btn = container.querySelector(isGlobalDiscEditing ? '#globalDiscTypeBtn' : '#extraTaxTypeBtn');
        if (btn) btn.click();
        return;
      }
      if (selectedColIndex === 2) {
        e.preventDefault();
        e.stopPropagation();
        const btn = cartBody.querySelector('#colDiscTypeBtn');
        if (btn) btn.click();
        return;
      }
    }
    // Alt + C: Add / Save Customer Profile
    if (isAlt && charKey === 'c') {
      e.preventDefault();
      const nameInp = container.querySelector('#qcName');
      const saveBtn = container.querySelector('#qcSaveBtn');
      if (nameInp && nameInp.value.trim() && saveBtn) {
        saveBtn.click();
      } else {
        const addBtn = container.querySelector('#qcAddBtn');
        if (addBtn) addBtn.click();
        else if (nameInp) nameInp.focus();
      }
      return;
    }
    // Alt + S: Focus Scan/Search input
    if (isAlt && charKey === 's') {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
      return;
    }
    // Alt + Enter: Settle / Finish & Pay
    if (isAlt && charKey === 'enter') {
      e.preventDefault();
      await completeQuickSale();
      return;
    }
    // Alt + R: Reset POS (Clear Cart/Customer)
    if (isAlt && charKey === 'r') {
      e.preventDefault();
      await resetQuickPOS();
      return;
    }
    // Alt + O: Return to Home (Dashboard)
    if (isAlt && charKey === 'o') {
      e.preventDefault();
      window.navigate('dashboard');
      return;
    }
    // Item Qty Adjust (removed Shift+Enter checkout from here as requested)

    const selectedItem = store.cart[selectedCartIndex];
    const inInputCol = selectedColIndex >= 0;

    // If a column input is open, capture Enter/Escape/Arrow specially
    if (inInputCol) {
      if (e.key === 'Enter') {
        e.preventDefault();
        await saveColInput();
        selectedColIndex = -1;
        await renderCart();
        searchInput.focus();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        selectedColIndex = -1;
        await renderCart();
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        await saveColInput();
        selectedColIndex = (selectedColIndex + 1) % EDITABLE_COLS;
        await renderCart();
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        await saveColInput();
        selectedColIndex = selectedColIndex > 0 ? selectedColIndex - 1 : -1;
        await renderCart();
        if (selectedColIndex < 0) searchInput.focus();
        return;
      }
      // Let the input capture other keys naturally
      return;
    }

    // Qty Adjust
    if (e.key === '+' && selectedItem) { e.preventDefault(); await updateQty(selectedItem.cartId, 1); await renderCart(); }
    if (e.key === '-' && selectedItem) { e.preventDefault(); await updateQty(selectedItem.cartId, -1); await renderCart(); }
    if (e.key === 'Delete' && selectedItem) {
        e.preventDefault();
        const nextIdx = selectedCartIndex > 0 ? selectedCartIndex - 1 : 0;
        await removeFromCart(selectedItem.cartId); 
        selectedCartIndex = store.cart.length > 0 ? nextIdx : -1;
        selectedColIndex = -1;
        await renderCart();
    }

    // Right/Left Arrow — column selection (when row selected, no suggestion open)
    if (e.key === 'ArrowRight' && selectedItem && !suggestionsOpen && searchInput.value === '') {
      e.preventDefault();
      selectedColIndex = 0; // start at Qty
      await renderCart();
      return;
    }
    if (e.key === 'ArrowLeft' && selectedItem && !suggestionsOpen) {
      e.preventDefault();
      selectedColIndex = -1;
      await renderCart();
      searchInput.focus();
      return;
    }

    // Row Navigation (ArrowDown/Up) — only when no column selected
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && searchInput.value === '') {
        e.preventDefault();
        if (store.cart.length === 0) return;
        if (e.key === 'ArrowDown') selectedCartIndex = (selectedCartIndex + 1) % store.cart.length;
        else selectedCartIndex = (selectedCartIndex - 1 + store.cart.length) % store.cart.length;
        selectedColIndex = -1;
        await renderCart();
        scrollToSelected(); // Only scroll on intentional navigation
    }
  };
  window.addEventListener('keydown', handleGlobalKeys);

  // Assigned further down (Assign Staff dropdown) — declared here so
  // cleanup() below can close over the variable itself, not whatever value
  // it happened to hold when cleanup() was defined. Without this, every
  // re-render's outside-click listener stacked up on `document` forever
  // instead of the previous one being torn down first, the same class of
  // leak checkElectronInstallState()/setupStorageListener() elsewhere in
  // this app had already been bitten by.
  let staffDropdownOutsideClick = null;

  const cleanup = () => {
    clearInterval(focusInterval);
    window.removeEventListener('keydown', handleGlobalKeys);
    if (observer) observer.disconnect();
    if (staffDropdownOutsideClick) document.removeEventListener('click', staffDropdownOutsideClick);
  };
  window._qpCleanup = cleanup;

  const observer = new MutationObserver(() => {
    // If the Quick POS root element is gone from the DOM, cleanup
    if (!document.body.contains(container) || !container.querySelector('.enterprise-pos-container')) { 
      cleanup(); 
      observer.disconnect(); 
      window._qpCleanup = null; 
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Full-screen Quick Checkout — kept as a reachable fallback (a link
  // inside the inline strip below) for the cases the inline strip
  // deliberately doesn't try to cover: Credit/Unpaid sales and Loyalty
  // point redemption. Everyday paid sales — including split payment and
  // delivery vehicle — go through completeQuickSale() below instead,
  // without ever leaving this screen.
  const openPaymentModal = () => {
    if (store.cart.length === 0) { showToast('Cart is empty', 'warning'); return; }
    openQuickCheckout(() => {
        // Quiet reset (no redundant toast)
        store.cart = [];
        store.selectedCustomer = null;
        selectedCartIndex = -1;
        selectedColIndex = -1;
        inlinePayments = null;
        inlinePaymentPanelOpen = false;
        inlineDeliveryVehicle = '';
        renderQuickPOS(container);
    });
  };

  // One-click PAY, right here on the Quick POS screen — no navigation to a
  // separate checkout screen. Uses the inline strip's payments if the
  // cashier customized it (split methods / delivery vehicle), otherwise a
  // single default-method payment for the full total. Reuses the exact
  // same confirmOrder() CheckoutService.js/QuickCheckoutService.js already
  // use, so saving, stock deduction, staff incentive, loyalty points, and
  // auto-print all behave identically to the old modal-based flow.
  const completeQuickSale = async () => {
    if (store.cart.length === 0) { showToast('Cart is empty', 'warning'); return; }

    const liveSettings = await getSettings();
    const liveCur = liveSettings.currency;
    const { total: liveTotal } = getCartTotals();

    const payments = inlinePayments
      ? inlinePayments.filter(p => p.method).map(p => ({ method: p.method, amount: parseFloat(p.amount) || 0 }))
      : [{ method: ((liveSettings.paymentMethods || [])[0]) || 'Cash', amount: liveTotal }];

    const paidSum = parseFloat(payments.reduce((s, p) => s + p.amount, 0).toFixed(2));
    if (Math.abs(paidSum - liveTotal) > 0.01) {
      showToast(`Payment (${liveCur}${paidSum.toFixed(2)}) doesn't match order total (${liveCur}${liveTotal.toFixed(2)}) — adjust the split below.`, 'warning');
      inlinePaymentPanelOpen = true;
      await renderQuickPOS(container);
      return;
    }

    const { confirmOrder } = await import('../services/CheckoutService.js');
    const succeeded = await confirmOrder(payments, getCartTotals(), liveSettings, liveCur, {
      isCredit: false,
      creditInfo: '',
      redeemedPoints: 0,
      creditUsed: 0,
      deliveryVehicle: inlineDeliveryVehicle
    });
    if (!succeeded) return;

    // confirmOrder() already cleared store.cart/selectedCustomer and
    // showed the success toast/auto-print — just reset this screen's own
    // local strip state and re-render.
    inlinePayments = null;
    inlinePaymentPanelOpen = false;
    inlineDeliveryVehicle = '';
    selectedCartIndex = -1;
    selectedColIndex = -1;
    await renderQuickPOS(container);
  };

  // Helper to sync customer display. When synced, re-render the whole POS to show/hide sections cleanly.
  const syncCustomerDisplay = async (cust) => {
      await setCustomer(cust);
      await renderQuickPOS(container); // Re-render to update the sidebar HTML
      setTimeout(() => {
          const search = container.querySelector('#quickProductSearch');
          if (search) search.focus();
      }, 100);
  };

  container.querySelector('#quickCustBtn').onclick = () => {
      container.querySelector('#qcSearchPhone')?.focus();
  };

  const qcAddBtn = container.querySelector('#qcAddBtn');
  if (qcAddBtn) {
      qcAddBtn.onclick = () => {
          container.querySelector('#qcName').focus();
          showToast('Enter details to save new customer', 'info');
      };
  }

  const qcSearchBtn = container.querySelector('#qcSearchBtn');
  const qcSearchPhone = container.querySelector('#qcSearchPhone');
  const qcSuggestions = container.querySelector('#qcSuggestions');
  const quickResetBtn = container.querySelector('#quickResetBtn');
  if (quickResetBtn) quickResetBtn.onclick = resetQuickPOS;

  const qpStaffSearch = container.querySelector('#qpStaffSearch');
  const qpStaffSuggestions = container.querySelector('#qpStaffSuggestions');
  if (qpStaffSearch && qpStaffSuggestions) {
    // Re-render the whole panel on select (like syncCustomerDisplay below)
    // instead of just calling setStaff() — setStaff()'s renderCartEvent()
    // only refreshes the cart-total strip, not this sidebar, so the
    // input/label would otherwise stay stale after a pick.
    const syncStaffDisplay = async (staffMember) => {
      setStaff(staffMember || null);
      await renderQuickPOS(container);
      setTimeout(() => {
        const search = container.querySelector('#quickProductSearch');
        if (search) search.focus();
      }, 100);
    };

    const showStaffSuggestions = (query) => {
      const val = query.trim().toLowerCase();
      const matches = val
        ? staffList.filter(s => s.name.toLowerCase().includes(val) || (s.specialization || '').toLowerCase().includes(val))
        : staffList;

      if (matches.length === 0) {
        qpStaffSuggestions.classList.add('hidden');
        return;
      }

      qpStaffSuggestions.classList.remove('hidden');
      qpStaffSuggestions.innerHTML = `
        <div class="ep-suggestion-item" data-staff-id="" style="padding:8px 10px; border-bottom:1px solid var(--border); font-weight:700; color:var(--text-secondary)">
          <i class="fa-solid fa-user-slash mr-8"></i> — None —
        </div>
      ` + matches.slice(0, 6).map(s => `
        <div class="ep-suggestion-item" data-staff-id="${s.id}" style="padding:8px 10px; font-size:13px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-weight:700; color:var(--text-main)">${escapeHtml(s.name)}</div>
            ${s.specialization ? `<div style="font-size:11px; color:var(--primary-light); font-weight:600">${escapeHtml(s.specialization)}</div>` : ''}
          </div>
          <div style="font-size:10px; color:var(--text-secondary)"><i class="fa-solid fa-chevron-right"></i></div>
        </div>
      `).join('');

      qpStaffSuggestions.querySelectorAll('.ep-suggestion-item').forEach(item => {
        item.onclick = async () => {
          const staffId = item.dataset.staffId;
          const staffMember = staffId ? staffList.find(s => String(s.id) === staffId) : null;
          await syncStaffDisplay(staffMember);
        };
      });
    };

    qpStaffSearch.addEventListener('focus', () => showStaffSuggestions(qpStaffSearch.value));
    qpStaffSearch.addEventListener('input', (e) => showStaffSuggestions(e.target.value));

    qpStaffSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!qpStaffSuggestions.classList.contains('hidden')) {
          const active = qpStaffSuggestions.querySelector('.ep-suggestion-item.active');
          const target = active || qpStaffSuggestions.querySelector('.ep-suggestion-item');
          if (target) target.click();
        }
      }
      if (e.key === 'ArrowDown' && !qpStaffSuggestions.classList.contains('hidden')) {
        e.preventDefault();
        const items = Array.from(qpStaffSuggestions.querySelectorAll('.ep-suggestion-item'));
        const activeIdx = items.findIndex(i => i.classList.contains('active'));
        items.forEach(i => i.classList.remove('active'));
        items[(activeIdx + 1) % items.length].classList.add('active');
      }
      if (e.key === 'ArrowUp' && !qpStaffSuggestions.classList.contains('hidden')) {
        e.preventDefault();
        const items = Array.from(qpStaffSuggestions.querySelectorAll('.ep-suggestion-item'));
        const activeIdx = items.findIndex(i => i.classList.contains('active'));
        items.forEach(i => i.classList.remove('active'));
        items[(activeIdx - 1 + items.length) % items.length].classList.add('active');
      }
      if (e.key === 'Escape') {
        qpStaffSuggestions.classList.add('hidden');
      }
    });

    // Close on outside click — torn down by cleanup() above on the next
    // render (or when this page is navigated away from) so this never
    // stacks up duplicate listeners on `document`.
    staffDropdownOutsideClick = (e) => {
      if (!qpStaffSearch.contains(e.target) && !qpStaffSuggestions.contains(e.target)) {
        qpStaffSuggestions.classList.add('hidden');
      }
    };
    document.addEventListener('click', staffDropdownOutsideClick);
  }

  container.querySelector('#qpClearStaffBtn')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const qpStaffSearch2 = container.querySelector('#qpStaffSearch');
    if (qpStaffSearch2) qpStaffSearch2.value = '';
    setStaff(null);
    await renderQuickPOS(container);
  });

  const btnReset = container.querySelector('#btnReset');
  if (btnReset) btnReset.onclick = resetQuickPOS;

  if (qcSearchBtn && qcSearchPhone && qcSuggestions) {
      const doSearchCust = async () => {
          const val = qcSearchPhone.value.trim().toLowerCase();
          if (!val) {
              qcSearchPhone.focus();
              return;
          }
          // Search by partial Phone OR partial Name (Filtered by Branch)
          const customers = await getCustomers(branchId);
          const matches = customers.filter(c => 
              (c.phone && c.phone.includes(val)) || 
              (c.name && c.name.toLowerCase().includes(val))
          );
          
          if (matches.length === 1) {
              await syncCustomerDisplay(matches[0]);
              showToast('Customer Loaded', 'success');
              qcSearchPhone.value = '';
              qcSuggestions.classList.add('hidden');
          } else if (matches.length > 1) {
              await showCustSuggestions(matches);
          } else {
              // No match logic
              if (/^\d+$/.test(val)) {
                container.querySelector('#qcPhone').value = val;
                container.querySelector('#qcName').focus();
              } else {
                container.querySelector('#qcName').value = val.charAt(0).toUpperCase() + val.slice(1);
                container.querySelector('#qcPhone').focus();
              }
              showToast('Not found. Add as new?', 'info');
              qcSuggestions.classList.add('hidden');
          }
      };

      const showCustSuggestions = async (matches) => {
          qcSuggestions.classList.remove('hidden');
          
          let listHtml = `
            <div class="ep-suggestion-item" data-cust-id="walkin" style="padding:10px; border-bottom:1px solid var(--border); font-weight:700; color:var(--info); background:var(--bg-elevated)">
                <i class="fa-solid fa-user-group mr-8"></i> Walk-in Customer
            </div>
          `;

          listHtml += matches.slice(0, 5).map((c, idx) => {
            const currentVal = qcSearchPhone.value.trim();
            return `
            <div class="ep-suggestion-item ${idx === 0 && !currentVal ? 'active' : ''}" data-cust-id="${c.id}" style="padding:10px; font-size:13px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
                <div>
                   <div style="font-weight:700; color:var(--text-main)">${escapeHtml(c.name)}</div>
                   <div style="font-size:11px; color:var(--primary-light); font-weight:600">${escapeHtml(c.phone || 'No Phone')}</div>
                </div>
                <div style="font-size:10px; color:var(--text-secondary)"><i class="fa-solid fa-chevron-right"></i></div>
            </div>
          `;}).join('');
          
          qcSuggestions.innerHTML = listHtml;
          
          qcSuggestions.querySelectorAll('.ep-suggestion-item').forEach(item => {
              item.onclick = async () => {
                  const custId = item.dataset.custId;
                  if (custId === 'walkin') {
                      await syncCustomerDisplay(null);
                  } else {
                      const cust = matches.find(m => String(m.id) === String(custId));
                      if (cust) await syncCustomerDisplay(cust);
                  }
                  qcSearchPhone.value = '';
                  qcSuggestions.classList.add('hidden');
              };
          });
      };

      qcSearchPhone.oninput = async () => {
          const val = qcSearchPhone.value.trim().toLowerCase();
          if (val.length < 2) {
              qcSuggestions.classList.add('hidden');
              return;
          }
          const customers = await getCustomers(branchId);
          const matches = customers.filter(c => 
              (c.phone && c.phone.includes(val)) || 
              (c.name && c.name.toLowerCase().includes(val))
          );
          if (matches.length > 0) await showCustSuggestions(matches);
          else qcSuggestions.classList.add('hidden');
      };

      qcSearchBtn.onclick = doSearchCust;
      qcSearchPhone.onkeydown = (e) => {
          if (e.key === 'Enter') {
              e.preventDefault();
              const active = qcSuggestions.querySelector('.ep-suggestion-item.active');
              if (active && !qcSuggestions.classList.contains('hidden')) {
                  active.click();
              } else {
                  doSearchCust();
              }
          }
          if (e.key === 'ArrowDown' && !qcSuggestions.classList.contains('hidden')) {
              e.preventDefault();
              const items = Array.from(qcSuggestions.querySelectorAll('.ep-suggestion-item'));
              const activeIdx = items.findIndex(i => i.classList.contains('active'));
              items.forEach(i => i.classList.remove('active'));
              items[(activeIdx + 1) % items.length].classList.add('active');
          }
          if (e.key === 'ArrowUp' && !qcSuggestions.classList.contains('hidden')) {
              e.preventDefault();
              const items = Array.from(qcSuggestions.querySelectorAll('.ep-suggestion-item'));
              const activeIdx = items.findIndex(i => i.classList.contains('active'));
              items.forEach(i => i.classList.remove('active'));
              items[(activeIdx - 1 + items.length) % items.length].classList.add('active');
          }
          if (e.key === 'Escape') {
              qcSuggestions.classList.add('hidden');
          }
      };
  }

  const qcClearBtn = container.querySelector('#qcClearBtn');
  if (qcClearBtn) {
      qcClearBtn.onclick = async () => await syncCustomerDisplay(null);
  }

  const qcImageFile = container.querySelector('#qcImageFile');
  if (qcImageFile) {
      qcImageFile.onchange = async (e) => {
        try {
          const base64 = await MediaService.handleImageUpload(e);
          if (base64) {
            container.querySelector('#qcImageBase64').value = base64;
            container.querySelector('#qcImagePreview').innerHTML = `<img src="${base64}" style="width:100%;height:100%;object-fit:cover" />`;
          }
        } catch (err) {
          showToast(err.message, 'error');
        }
      };
  }

  container.querySelector('#qcSaveBtn').onclick = async () => {
      const nameInp = container.querySelector('#qcName');
      const phoneInp = container.querySelector('#qcPhone');
      const emailInp = container.querySelector('#qcEmail');
      const imageInp = container.querySelector('#qcImageBase64');
      
      const name = nameInp.value.trim();
      const phone = phoneInp.value.trim();
      const email = emailInp.value.trim();
      const image = imageInp.value;
      
      if (!name || !phone) {
          showToast('Name and Phone are required', 'warning');
          return;
      }
      
      const newCust = await saveCustomer({
          id: store.selectedCustomer?.id || Date.now().toString(),
          name,
          phone,
          email,
          image,
          loyaltyPoints: store.selectedCustomer?.loyaltyPoints || 0,
          creditBalance: store.selectedCustomer?.creditBalance || 0,
          tier: store.selectedCustomer?.tier || (await getSettings()).loyalty?.tiers?.[0] || {name: 'Basic', color: '#6b7280', icon: 'fa-star'}
      });
      await syncCustomerDisplay(newCust);
      showToast('Profile Saved Successfully', 'success');
      qcSearchPhone.value = '';
  };

  container.querySelector('#quickPayBtn').onclick = async () => await completeQuickSale();

  // Inline Payment Options strip — collapse/expand, split-row editing,
  // delivery vehicle, and the fallback link to the full Quick Checkout
  // screen (Credit/Unpaid + Loyalty redemption, which this strip
  // intentionally doesn't try to reproduce inline).
  const qpPayStripToggle = container.querySelector('#qpPayStripToggle');
  const qpPayStripToggleBtn = container.querySelector('#qpPayStripToggleBtn');
  if (qpPayStripToggle && qpPayStripToggleBtn) {
    const toggleStrip = () => {
      inlinePaymentPanelOpen = !inlinePaymentPanelOpen;
      // Materialize the default single-payment row into real state the
      // first time the strip is opened, so subsequent edits (method/
      // amount changes) have something to mutate — completeQuickSale()
      // still treats a never-touched cart (inlinePayments === null) as
      // "use the plain default", this only changes once the cashier
      // actually looks at/opens the strip.
      if (inlinePaymentPanelOpen && inlinePayments === null) {
        inlinePayments = [{ method: defaultPaymentMethod, amount: cartTotal }];
      }
      renderQuickPOS(container);
    };
    qpPayStripToggle.onclick = toggleStrip;
  }

  container.querySelectorAll('.qp-pay-method').forEach(sel => {
    sel.onchange = (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      if (inlinePayments && inlinePayments[idx]) inlinePayments[idx].method = e.target.value;
    };
  });

  const updateQpBalanceNote = () => {
    const note = container.querySelector('#qpPayBalanceNote');
    if (!note || !inlinePayments) return;
    const sum = inlinePayments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
    const { total: liveTotal } = getCartTotals();
    const balanced = Math.abs(sum - liveTotal) < 0.01;
    note.textContent = `${cur}${sum.toFixed(2)} / ${cur}${liveTotal.toFixed(2)}`;
    note.style.color = balanced ? 'var(--success)' : 'var(--danger)';
  };
  container.querySelectorAll('.qp-pay-amount').forEach(inp => {
    // Live balance feedback without a full re-render on every keystroke —
    // re-rendering here would reset focus/cursor position mid-type, the
    // same class of bug already fixed for the Extra Disc/Extra Tax editors
    // above.
    inp.oninput = (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      if (inlinePayments && inlinePayments[idx]) inlinePayments[idx].amount = parseFloat(e.target.value) || 0;
      updateQpBalanceNote();
    };
  });

  container.querySelectorAll('.qp-pay-remove').forEach(btn => {
    btn.onclick = () => {
      const idx = parseInt(btn.dataset.idx, 10);
      if (inlinePayments && inlinePayments.length > 1) {
        inlinePayments.splice(idx, 1);
        renderQuickPOS(container);
      }
    };
  });

  const qpAddPayRow = container.querySelector('#qpAddPayRow');
  if (qpAddPayRow) {
    qpAddPayRow.onclick = () => {
      if (!inlinePayments) inlinePayments = [{ method: defaultPaymentMethod, amount: cartTotal }];
      const usedMethods = inlinePayments.map(p => p.method);
      const nextMethod = paymentMethodsList.find(m => !usedMethods.includes(m)) || paymentMethodsList[0] || 'Cash';
      inlinePayments.push({ method: nextMethod, amount: 0 });
      renderQuickPOS(container);
    };
  }

  const qpDeliveryVehicle = container.querySelector('#qpDeliveryVehicle');
  if (qpDeliveryVehicle) {
    // Plain state capture, no re-render per keystroke (same reasoning as
    // the amount inputs above) — the value is only actually read at PAY time.
    qpDeliveryVehicle.oninput = (e) => { inlineDeliveryVehicle = e.target.value; };
  }

  const qpFullCheckoutLink = container.querySelector('#qpFullCheckoutLink');
  if (qpFullCheckoutLink) {
    qpFullCheckoutLink.onclick = () => openPaymentModal();
  }

  // Tab switching (Visual only for now)
  container.querySelectorAll('.ep-tab').forEach(tab => {
     tab.onclick = () => {
        container.querySelectorAll('.ep-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        activeTab = tab.dataset.tab;
     };
  });

  // Shortcut grid keys
  container.querySelectorAll('.ep-f-btn').forEach(btn => {
     btn.onclick = () => {
        const key = btn.dataset.key;
        const fakeEvent = { key, altKey: key.startsWith('Alt+'), shiftKey: key.startsWith('Shift+'), preventDefault: () => {}, stopPropagation: () => {} };
        handleGlobalKeys(fakeEvent);
     };
  });
  onCartUpdate(async () => await renderCart());
  await renderCart();
  setTimeout(() => searchInput.focus(), 100);
}
