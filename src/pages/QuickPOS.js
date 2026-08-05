import { getProducts, getSettings, getCustomers, saveCustomer, isRegisterOpen, hasPermission, getCurrentBranch, getCurrentRegisterId } from '../db.js';
import { store, addToCart, onCartUpdate, getCartTotals, updateQty, removeFromCart, clearCart, setDiscount, setExtraTax, updateCartItem, setCustomer } from '../store.js';
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

      <!-- Main Content Grid -->
      <div class="ep-main-grid">
         <!-- Left Column: Customer Details -->
         <div class="ep-catalog-col" style="width:280px; background:#fff; border-right:1px solid #9ca3af; display:flex; flex-direction:column; padding:0; border-radius:4px 0 0 4px">
            
            <!-- Fixed Header & Search -->
            <div style="padding:12px; border-bottom:1px solid #e5e7eb; background:#f8fafc; border-radius:4px 0 0 0">
              <h2 style="font-size:15px; font-weight:800; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; color:#1e293b">
                Customer Profile
                ${store.selectedCustomer ? `<button id="qcClearBtn" class="btn btn-ghost btn-sm" style="color:#6366f1; font-size:11px; padding:0 4px; font-weight:700" title="Switch to Walk-in"><i class="fa-solid fa-redo"></i> Reset</button>` : ''}
              </h2>
              <div style="display:flex; gap:6px; margin-bottom:12px; position:relative;">
                <div style="position:relative; flex:1; display:flex;">
                  <input type="text" id="qcSearchPhone" placeholder="Name or Phone..." autocomplete="off" style="flex:1; border:2px solid #3b82f6; padding:6px 10px; font-size:14px; border-radius:6px; outline:none;" />
                  <div id="qcSuggestions" class="ep-suggestions hidden" style="top:42px; left:0; width:100%; min-width:250px;"></div>
                </div>
                <button id="qcSearchBtn" class="btn btn-secondary btn-sm" style="padding:0 12px; border-radius:6px; background:#f1f5f9; border:1px solid #d1d5db"><i class="fa-solid fa-search"></i></button>
                <button id="quickCustBtn" style="display:none"></button>
              </div>

              <!-- Default / Selected State Card -->
              <div id="qcActiveCard" style="display:flex; align-items:center; justify-content:space-between; background:#f8faff; border:1px solid #e0e7ff; padding:10px; border-radius:12px;">
                 <div style="display:flex; align-items:center; gap:12px;">
                    <div style="width:36px; height:36px; border-radius:8px; background:#e0e7ff; display:flex; align-items:center; justify-content:center; color:#6366f1;">
                       ${store.selectedCustomer?.image ? `<img src="${store.selectedCustomer.image}" style="width:100%; height:100%; border-radius:8px; object-fit:cover" />` : `<i class="fa-solid fa-user"></i>`}
                    </div>
                    <div>
                       <div style="font-size:14px; font-weight:700; color:#1e1b4b;">${escapeHtml(store.selectedCustomer?.name || 'Walk-in Customer')}</div>
                       <div style="font-size:11px; color:#6366f1; font-weight:600;">${store.selectedCustomer ? escapeHtml(store.selectedCustomer.phone || 'No Phone') : 'General Guest'}</div>
                    </div>
                 </div>
                 ${!store.selectedCustomer ? `<button id="qcAddBtn" style="width:28px; height:28px; border-radius:6px; background:#e0e7ff; color:#6366f1; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:14px;"><i class="fa-solid fa-plus"></i></button>` : ''}
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

               <details style="margin-bottom:12px; border:1px solid #e5e7eb; border-radius:4px; background:#f9fafb; overflow:hidden">
                 <summary style="padding:6px 10px; font-size:11px; font-weight:700; cursor:pointer; color:#64748b; outline:none;">
                   More Options
                 </summary>
                 <div style="padding:10px; border-top:1px solid #e5e7eb; background:#fff">
                    <div class="form-group" style="margin-bottom:8px">
                      <div style="display:flex;gap:10px;align-items:center;">
                        <div id="qcImagePreview" style="width:40px;height:40px;border-radius:20px;background:#f3f4f6;border:1px solid #d1d5db;display:flex;align-items:center;justify-content:center;overflow:hidden">
                          ${store.selectedCustomer?.image ? `<img src="${store.selectedCustomer.image}" style="width:100%;height:100%;object-fit:cover" />` : `<i class="fa-solid fa-user" style="opacity:0.3;font-size:16px"></i>`}
                        </div>
                        <div>
                          <input type="file" id="qcImageFile" accept="image/*" style="display:none" />
                          <button class="btn btn-ghost btn-xs" onclick="document.getElementById('qcImageFile').click()" style="padding:0 6px; font-size:11px; border:1px solid #d1d5db"><i class="fa-solid fa-camera mr-4"></i> Photo</button>
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
            </div>

            <!-- Fixed Loyalty Area at Bottom (COMPACT) -->
            <div style="padding:10px; border-top:1px solid #e5e7eb; background:#fff; ${!store.selectedCustomer ? 'opacity:0.3; pointer-events:none;' : ''} border-radius:0 0 0 4px">
                <div style="font-size:10px; font-weight:800; color:#64748b; margin-bottom:6px; letter-spacing:0.8px; text-transform:uppercase; display:flex; justify-content:space-between; align-items:center">
                   Loyalty Rewards
                   <button id="quickResetBtn" class="btn btn-ghost btn-xs" style="color:#ef4444; padding:0" title="Reset (Alt+R)">
                     <i class="fa-solid fa-rotate-right"></i>
                   </button>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; background:#f8fafc; padding:8px 10px; border:1px solid #e5e7eb; border-radius:4px;">
                  <div>
                     <div style="font-size:10px; color:#94a3b8; font-weight:600">Points</div>
                     <div style="font-size:18px; font-weight:900; color:#3b82f6" id="qcPointsDisplay">${store.selectedCustomer?.loyaltyPoints || 0}</div>
                  </div>
                  <div style="text-align:right">
                     <div style="font-size:10px; color:#94a3b8; font-weight:600">Credit</div>
                     <div style="font-size:16px; font-weight:900; color:${(store.selectedCustomer?.creditBalance || 0) < 0 ? '#ef4444' : '#10b981'}">${cur}${(store.selectedCustomer?.creditBalance || 0).toLocaleString()}</div>
                  </div>
                </div>
            </div>
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
                        <th style="width:60px; text-align:center">Tx</th>
                        <th style="width:80px; text-align:right">Dis</th>
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
         <div class="ep-shortcut-grid">
            <button class="ep-f-btn" id="btnReset" data-key="Alt+R"><span class="ep-key-red">Alt+R</span> Reset POS</button>
            <button class="ep-f-btn" id="btnDisc" data-key="Alt+D"><span class="ep-key-red">Alt+D</span> Discount</button>
            <button class="ep-f-btn" id="btnExtraTax" data-key="Alt+L"><span class="ep-key-red">Alt+L</span> Extra Tax</button>
            <button class="ep-f-btn" id="btnToggleType" data-key="Alt+A"><span class="ep-key-red">Alt+A</span> Disc % / \u20B9</button>
            <button class="ep-f-btn" id="btnScanFocus" data-key="Alt+S"><span class="ep-key-red">Alt+S</span> Scan / Search</button>
            <button class="ep-f-btn" id="btnSearch" data-key="Alt+F"><span class="ep-key-red">Alt+F</span> Cust Search</button>
            <button class="ep-f-btn" id="btnAdd" data-key="Alt+C"><span class="ep-key-red">Alt+C</span> Save/Add Cust</button>
            <button class="ep-f-btn" id="btnResetCust" data-key="Alt+E"><span class="ep-key-red">Alt+E</span> Cust Reset</button>
            <button class="ep-f-btn" id="btnPayShortcut" data-key="Shift+S"><span class="ep-key-red">Shift+S</span> PAY</button>
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
                <div class="ep-total-row" id="orderDiscountRow"><label>Ord Disc:</label> <span id="quickDiscountDisplay">${cur}0.00</span></div>
                <div class="ep-total-row" id="orderExtraTaxRow"><label>Ext Tax:</label> <span id="quickExtraTaxDisplay">${cur}0.00</span></div>
                <div class="ep-total-row" id="roundOffRow" style="display:none"><label>Round Off:</label> <span id="quickRoundOffDisplay">${cur}0.00</span></div>
            </div>
            <div class="ep-grand-total">
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
      .enterprise-pos-container {
        display: flex;
        flex-direction: column;
        height: 100vh;
        background: #e5e7eb;
        color: #1f2937;
        font-family: 'Segoe UI', Tahoma, sans-serif;
        padding: 0;
        box-sizing: border-box;
        overflow: hidden;
      }

      .ep-status-panel { width: 250px; border-left: 1px solid #d1d5db; padding-left: 16px; }
      .ep-status-row { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px; }
      .ep-status-row label { color: #4b5563; }
      .ep-status-row span { font-weight: 700; }

      /* Search Bar (PREMIUM COMPACT) */
      .ep-search-bar {
        background: #fff;
        border-bottom: 2px solid #3b82f6;
        padding: 4px 16px;
        display: flex;
        align-items: center;
        gap: 20px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.05);
      }
      .ep-f5-label { font-size: 20px; display: flex; align-items: center; gap: 8px; font-weight: 800; }
      .ep-key-red { color: #ef4444; font-weight: 900; }
      .ep-input-wrap { flex: 1; display: flex; align-items: center; gap: 12px; }
      .ep-input-wrap label { font-size: 15px; font-weight: 800; color: #1e293b; text-transform: uppercase; letter-spacing: 0.5px; }
      .ep-input-wrap input {
        flex: 1;
        height: 32px;
        border: none;
        border-bottom: 2px solid #e2e8f0;
        font-size: 18px;
        font-weight: 700;
        padding: 0 4px;
        outline: none;
        transition: border-color 0.2s;
      }
      .ep-input-wrap input:focus { border-color: #3b82f6; }
      .ep-cashier-info { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; color: #64748b; }
      .ep-cashier-info span { color: #1e293b; }

      /* Main Grid */
      .ep-main-grid { flex: 1; display: flex; gap: 8px; overflow: hidden; margin-bottom: 8px; }
      
      /* Left Column: Catalog */
      .ep-catalog-col { width: 400px; display: flex; flex-direction: column; background: #fff; border: 1px solid #9ca3af; }
      .ep-catalog-header { background: #f3f4f6; padding: 4px 8px; font-size: 12px; border-bottom: 1px solid #9ca3af; }
      .ep-product-grid { flex: 1; overflow-y: auto; display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; padding: 8px; }
      .ep-product-card {
        border: 1px solid #e5e7eb;
        padding: 8px;
        text-align: center;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        flex-direction: column;
        align-items: center;
      }
      .ep-product-card:hover { border-color: #dc2626; box-shadow: 0 0 5px rgba(220, 38, 38, 0.2); }
      .ep-product-card img { width: 100px; height: 100px; object-fit: contain; margin-bottom: 8px; }
      .ep-product-card span { font-size: 12px; font-weight: 600; line-height: 1.2; height: 2.4em; overflow: hidden; }

      /* Center Column: Table */
      .ep-transaction-col { flex: 1; background: #fff; border: 1px solid #9ca3af; display: flex; flex-direction: column; }
      .ep-table-title { background: #e2e8f0; padding: 4px 10px; font-size: 13px; font-weight: 700; color: #475569; border-bottom: 1px solid #9ca3af; }
      .ep-table-wrap { flex: 1; overflow-y: auto; }
      .ep-table { width: 100%; border-collapse: collapse; }
      .ep-table th {
        background: #f1f5f9;
        border-bottom: 1px solid #9ca3af;
        border-right: 1px solid #cbd5e1;
        padding: 6px 10px;
        text-align: left;
        font-size: 13px;
        color: #334155;
        position: sticky;
        top: 0;
        z-index: 10;
      }
      .ep-table th:last-child { border-right: none; }
      .ep-table td { 
        border-bottom: 1px solid #e2e8f0; 
        border-right: 1px solid #f1f5f9;
        padding: 6px 10px; 
        font-size: 14px; 
        font-weight: 600; 
        color: #1e293b;
      }
      .ep-table td:last-child { border-right: none; }
      .ep-table tr.selected-row { background: #3b82f6 !important; }
      .ep-table tr.selected-row td { color: #ffffff !important; }

      /* Bottom Section */
      .ep-bottom-bar { display: flex; gap: 10px; align-items: stretch; padding: 4px 0; }
      .ep-shortcut-grid {
        flex: 1;
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        grid-template-rows: repeat(2, 1fr);
        gap: 4px;
      }
      .ep-f-btn {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
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
        color: #475569;
      }
      .ep-f-btn span { color: #ef4444; font-size: 10px; margin-bottom: 2px; font-weight: 900; }
      .ep-f-btn:hover { background: #fee2e2; border-color: #ef4444; color: #b91c1c; }
      .ep-f-btn:active { transform: scale(0.95); }
      
      .ep-summary-section { width: 680px; display: flex; gap: 6px; align-items: stretch; background: #fff; padding: 4px; border-radius: 8px; border: 1px solid #cbd5e1; }
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
        border-bottom: 1px solid #f1f5f9;
        align-items: center;
      }
      .ep-total-row:last-child, .ep-total-row:nth-last-child(2) { border-bottom: none; }
      .ep-total-row label { color: #64748b; font-size: 11px; text-transform: uppercase; }
      .ep-total-row span { color: #1e293b; }
      
      .ep-total-row[id*="order"] {
        cursor: pointer;
        transition: background 0.2s;
        border-radius: 4px;
        padding: 2px 6px;
        margin: 0 -4px;
        background: #f8fafc;
        border: 1px solid transparent;
      }
      .ep-total-row[id*="order"]:hover {
        background: #f1f5f9;
        border-color: #e2e8f0;
      }
      
      .ep-grand-total {
        width: auto;
        min-width: 160px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        background: #0f172a;
        color: white;
        border-radius: 6px;
        padding: 4px 12px;
        text-align: right;
      }
      .ep-grand-total label { font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase; margin-bottom: 0; }
      .ep-total-amount {
        color: #4ade80;
        font-family: 'Delius Unicase', monospace;
        font-size: 42px;
        font-weight: 900;
        line-height: 1;
      }

      .ep-finish-btn {
        width: 100px;
        background: #22c55e;
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
        box-shadow: 0 4px 0 #15803d;
      }
      .ep-finish-btn:hover { background: #16a34a; transform: translateY(-1px); box-shadow: 0 5px 0 #15803d; }
      .ep-finish-btn:active { transform: translateY(2px); box-shadow: 0 2px 0 #15803d; }
      .ep-finish-top { font-size: 16px; opacity: 0.9; }
      .ep-finish-bot { font-size: 13px; text-transform: uppercase; }

      .ep-suggestions {
        position: absolute;
        top: 48px;
        left: 300px;
        width: 600px;
        background: white;
        border: 2px solid #3b82f6;
        z-index: 1000;
        box-shadow: 0 10px 25px rgba(0,0,0,0.2);
        border-radius: 6px;
      }
      .ep-suggestion-item { padding: 12px; border-bottom: 1px solid #e5e7eb; cursor: pointer; display: flex; justify-content: space-between; }
      .ep-suggestion-item.active { background: #fee2e2; }

      .ep-btn-sm {
        background: #f1f5f9;
        border: 1px solid #cbd5e1;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
        height: 24px;
        font-weight: 800;
        color: #475569;
      }
      .ep-btn-sm:hover { background: #e2e8f0; color: #1e293b; }
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
      const itemDiscDisplay = container.querySelector('#itemDiscountRow span:last-child');
      const itemTaxDisplay = container.querySelector('#itemTaxRow span:last-child');

      if (subtotalDisplay) subtotalDisplay.textContent = `${cur}${subtotal.toFixed(2)}`;
      if (totalDisplay) totalDisplay.textContent = `${cur}${total.toFixed(2)}`;
      if (itemDiscDisplay) itemDiscDisplay.textContent = `${cur}${itemDiscount.toFixed(2)}`;
      if (itemTaxDisplay) itemTaxDisplay.textContent = `${cur}${(grossTax || itemTax).toFixed(2)}`;
      
      // Order Discount Row
      const discRow = container.querySelector('#orderDiscountRow');
      if (discRow) {
        if (isGlobalDiscEditing) {
          discRow.innerHTML = `
            <label>Order Disc (Alt+D):</label>
            <div style="display:flex; align-items:center; gap:4px;">
              <input id="globalDiscInput" type="number" step="0.01" value="${store.discountRaw || 0}" style="width:70px; height:24px; text-align:right; border:2px solid #3b82f6; border-radius:4px; font-weight:700; outline:none; padding: 0 4px;" />
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
            const { total: t } = getCartTotals();
            if (totalDisplay) totalDisplay.textContent = `${cur}${t.toFixed(2)}`;
          };
          
          inp.oninput = async () => {
            await setDiscount(parseFloat(inp.value) || 0, btn.dataset.type);
            const { total: t } = getCartTotals();
            if (totalDisplay) totalDisplay.textContent = `${cur}${t.toFixed(2)}`;
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
          discRow.innerHTML = `<label>Order Disc:</label> <span id="quickDiscountDisplay">${cur}${orderDiscount.toFixed(2)}</span>`;
        }
      }

      // Order Extra Tax Row
      const extraTaxRow = container.querySelector('#orderExtraTaxRow');
      if (extraTaxRow) {
        if (isExtraTaxEditing) {
          extraTaxRow.innerHTML = `
            <label>Extra Tax (Alt+L):</label>
            <div style="display:flex; align-items:center; gap:4px;">
              <input id="extraTaxInput" type="number" step="0.01" value="${store.extraTaxRaw || 0}" style="width:70px; height:24px; text-align:right; border:2px solid #ef4444; border-radius:4px; font-weight:700; outline:none; padding: 0 4px;" />
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
              const { total: t } = getCartTotals();
              if (totalDisplay) totalDisplay.textContent = `${cur}${t.toFixed(2)}`;
            };
            
            inp.oninput = async () => {
              await setExtraTax(parseFloat(inp.value) || 0, btn.dataset.type);
              const { total: t } = getCartTotals();
              if (totalDisplay) totalDisplay.textContent = `${cur}${t.toFixed(2)}`;
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

      // Inline editable cell renderer
      const qtyCell = isSelected && selectedColIndex === 0
        ? `<td style="text-align:center"><input id="colInput" type="number" min="0.001" step="0.001" value="${Number.isInteger(item.qty) ? item.qty : item.qty.toFixed(3)}" style="width:68px;text-align:center;font-weight:900;border:2px solid #3b82f6;border-radius:4px;padding:2px 4px;outline:none"></td>`
        : `<td style="text-align:center; font-weight:900">${Number.isInteger(item.qty) ? item.qty : item.qty.toFixed(3)}</td>`;

      const priceCell = isSelected && selectedColIndex === 1
        ? `<td style="text-align:right"><input id="colInput" type="number" min="0" step="0.01" value="${item.price.toFixed(2)}" style="width:80px;text-align:right;border:2px solid #3b82f6;border-radius:4px;padding:2px 4px;outline:none"></td>`
        : `<td style="text-align:right">${item.price.toFixed(2)}</td>`;

      const discCell = isSelected && selectedColIndex === 2
        ? `<td style="text-align:right; position:relative;">
             <div style="display:flex; align-items:center; justify-content:flex-end; gap:2px;">
               <input id="colInput" type="number" min="0" step="0.01" value="${item.itemDiscount || 0}" style="width:62px;text-align:right;border:2px solid #3b82f6;border-radius:4px;padding:2px 4px;outline:none">
               <button id="colDiscTypeBtn" class="ep-btn-sm" data-type="${item.itemDiscountType || 'flat'}" style="padding: 2px 4px; font-size:10px;">${(item.itemDiscountType || 'flat') === 'flat' ? cur : '%'}</button>
             </div>
           </td>`
        : `<td style="text-align:right">${itemDisc > 0 ? (item.itemDiscountType === 'pct' ? item.itemDiscount + '%' : itemDisc.toFixed(2)) : ''}</td>`;

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
        <td style="text-align:center; opacity:0.8">${taxAmt > 0 ? taxAmt.toFixed(2) : ''}</td>
        ${discCell}
        <td style="text-align:right; font-weight:900">${lineTotal.toFixed(2)}</td>
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
            <button class="btn btn-ghost w-full quick-variant-btn" data-vname="${escapeHtml(v.name)}" style="justify-content:space-between; padding:16px; border:1px solid #d1d5db;">
              <div style="font-weight:700">${escapeHtml(v.name)}</div>
              <div style="color:#059669;font-weight:900">${cur}${v.price}</div>
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
          <input type="number" id="discValue" class="form-input" value="${currentVal}" step="0.01" style="font-size:18px; height:40px; border:2px solid #3b82f6; border-radius:6px; outline:none" />
        </div>
        <div class="form-group" style="margin-bottom:20px">
          <label class="form-label" style="font-weight:700">Discount Type</label>
          <select id="discType" class="form-select" style="font-size:16px; height:40px; border-radius:6px; border:1px solid #d1d5db; width:100%">
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
          <div style="font-weight:900; color:#dc2626">${cur}${displayPrice}</div>
        </div>
        `;
      }).join('');
    } else {
      suggestionsEl.classList.add('hidden');
    }
  });

  searchInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { // Ignore Shift+Enter here to avoid double-triggering product add
      const active = suggestionsEl.querySelector('.ep-suggestion-item.active');
      if (active) {
        const id = active.dataset.id;
        const vname = active.dataset.vname;
        const products = await getProducts(branchId);
        const product = products.find(p => String(p.id) === String(id));
        if (product) {
          const variant = vname && product.variants ? product.variants.find(v => v.name === vname) : null;
          await handleQuickAdd(product, variant);
        }
      } else if (searchInput.value === '' && store.cart.length > 0) {
        await openPaymentModal();
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
        showToast('Order Discount Editor Active', 'info');
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
    // Shift + S: Settle / Finish & Pay
    if (isShift && charKey === 's') {
      e.preventDefault();
      await openPaymentModal();
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

  const cleanup = () => {
    clearInterval(focusInterval);
    window.removeEventListener('keydown', handleGlobalKeys);
    if (observer) observer.disconnect();
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

  const openPaymentModal = () => {
    if (store.cart.length === 0) { showToast('Cart is empty', 'warning'); return; }
    openQuickCheckout(() => {
        // Quiet reset (no redundant toast)
        store.cart = [];
        store.selectedCustomer = null;
        selectedCartIndex = -1;
        selectedColIndex = -1;
        renderQuickPOS(container);
    });
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
            <div class="ep-suggestion-item" data-cust-id="walkin" style="padding:10px; border-bottom:1px solid #f1f5f9; font-weight:700; color:#3b82f6; background:#f0f7ff">
                <i class="fa-solid fa-user-group mr-8"></i> Walk-in Customer
            </div>
          `;

          listHtml += matches.slice(0, 5).map((c, idx) => {
            const currentVal = qcSearchPhone.value.trim();
            return `
            <div class="ep-suggestion-item ${idx === 0 && !currentVal ? 'active' : ''}" data-cust-id="${c.id}" style="padding:10px; font-size:13px; border-bottom:1px solid #f1f5f9; display:flex; justify-content:space-between; align-items:center;">
                <div>
                   <div style="font-weight:700; color:#1e293b">${escapeHtml(c.name)}</div>
                   <div style="font-size:11px; color:#6366f1; font-weight:600">${escapeHtml(c.phone || 'No Phone')}</div>
                </div>
                <div style="font-size:10px; color:#94a3b8"><i class="fa-solid fa-chevron-right"></i></div>
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

  container.querySelector('#quickPayBtn').onclick = async () => await openPaymentModal();

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
