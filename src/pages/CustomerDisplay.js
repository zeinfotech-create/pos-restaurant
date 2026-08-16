import { getSettings } from '../db.js';
import { store } from '../store.js';
import { escapeHtml } from '../utils/escapeHtml.js';

let channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('pos_customer_display') : null;
let currentCart = { items: [], subtotal: 0, tax: 0, discount: 0, total: 0 };

export async function renderCustomerDisplay(container) {
  // Same window._cdCleanup pattern POS.js/QuickPOS.js use \u2014 without it, every
  // re-entry to this page (navigate away and back) left the PREVIOUS call's
  // clock interval running forever against a now-detached #cdSidebarTime node, and
  // silently reassigned (not cleaned up) channel.onmessage each time.
  if (window._cdCleanup) { window._cdCleanup(); window._cdCleanup = null; }

  const settings = await getSettings();
  const cur = settings.currency || '\u20B9';

  // Prefer the real logo uploaded in Settings > Store Profile; fall back to
  // a gradient badge with the store's initial letter only when none is set.
  const hasLogo = !!settings.storeLogo;
  const logoInner = hasLogo
    ? `<img src="${settings.storeLogo}" alt="${escapeHtml(settings.storeName || 'Logo')}" />`
    : escapeHtml(settings.storeName?.[0] || 'Z');
  const logoClass = hasLogo ? ' has-logo' : '';

  let clockInterval = null;
  function updateUI(data) {
    currentCart = data || currentCart;
    const { items, total, subtotal, customer, itemDiscount, itemTax, orderDiscount, orderTax } = currentCart;
    const totalItems = items ? items.length : 0;
    const totalQty = items ? items.reduce((s, i) => s + (parseFloat(i.qty) || 0), 0) : 0;
    // A customer doesn't care whether a discount/tax came from the item
    // itself or an order-level adjustment — that split is a cashier-side
    // detail. One combined "you're saving" figure and one combined tax
    // line is what's actually useful to read at a glance here.
    const totalDiscount = (itemDiscount || 0) + (orderDiscount || 0);
    const totalTax = (itemTax || 0) + (orderTax || 0);

    if (clockInterval) {
      clearInterval(clockInterval);
      clockInterval = null;
    }

    if (!items || items.length === 0) {
      container.innerHTML = `
        <div class="customer-display-welcome">
          <div class="welcome-content">
            <div class="store-logo-large${logoClass}">${logoInner}</div>
            <h1 class="store-name-display">${escapeHtml(settings.storeName) || 'Welcome'}</h1>
            <p class="welcome-message">${escapeHtml(settings.receiptFooter) || 'Thank you for shopping with us!'}</p>
            <div class="live-indicator"><span class="dot"></span> System Live</div>
          </div>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="customer-display-layout">
        <!-- Main Cart Area -->
        <div class="cd-main">
          <!-- Branch name/logo/time already live in the sidebar's brand
               footer below — repeating them up here was pure duplication,
               so this panel is just the cart grid now. -->
          <div class="cd-cart-grid custom-scrollbar">
            ${items.map(item => `
              <div class="cd-cart-item animate-slide-in">
                <div class="cd-item-emoji">${item.emoji || '📦'}</div>
                <div class="cd-item-details">
                  <div class="cd-item-name">${escapeHtml(item.name)} ${item.variantName ? `<span class="cd-variant">${escapeHtml(item.variantName)}</span>` : ''}</div>
                  <div class="cd-item-meta">${item.qty} x ${cur}${item.price.toFixed(2)}</div>
                </div>
                <div class="cd-item-total">${cur}${(item.qty * item.price).toFixed(2)}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Summary Sidebar -->
        <div class="cd-sidebar">
          <div class="cd-summary-card">
            <div class="cd-summary-head">
              <h2 class="cd-summary-title">Order Summary</h2>
              <span class="cd-summary-caption">${totalItems} item${totalItems === 1 ? '' : 's'} &middot; ${Number.isInteger(totalQty) ? totalQty : totalQty.toFixed(3)} qty</span>
            </div>
            <div class="cd-summary-rows">
              <div class="cd-row cd-row-subtotal"><span>Subtotal</span><span>${cur}${subtotal.toFixed(2)}</span></div>
              ${totalTax > 0 ? `<div class="cd-row"><span>Tax</span><span>${cur}${totalTax.toFixed(2)}</span></div>` : ''}
            </div>
            ${totalDiscount > 0 ? `
            <div class="cd-savings-strip">
              <i class="fa-solid fa-tags"></i>
              <span>You're saving <b>${cur}${totalDiscount.toFixed(2)}</b> on this order!</span>
            </div>
            ` : ''}
            <div class="cd-total-section">
              <div class="cd-total-label">Amount to Pay</div>
              <div class="cd-total-badge">
                <div class="cd-total-value">${cur}${total.toFixed(2)}</div>
              </div>
            </div>
            ${settings.enableLoyalty !== false && customer ? `
            <div class="cd-footer-promo">
              <i class="fa-solid fa-star text-warning"></i>
              Earn ${Math.floor(total / 10)} points on this order!
            </div>
            ` : ''}
          </div>

          <div class="cd-brand-footer">
            <div class="cd-brand-id">
              <span class="cd-brand-logo${logoClass}">${logoInner}</span>
              <div class="cd-brand-meta">
                <span class="cd-brand-name">${escapeHtml(settings.storeName) || 'My Store'}</span>
                <span class="cd-brand-tag"><span class="cd-live-dot"></span> Live &middot; Secure Checkout</span>
              </div>
            </div>
            <div class="cd-brand-time" id="cdSidebarTime"></div>
          </div>
        </div>
      </div>
    `;

    // Internal Clock — drives the sidebar brand-footer's time + date.
    const sidebarTimeEl = document.getElementById('cdSidebarTime');
    if (sidebarTimeEl) {
      const updateTime = () => {
        const now = new Date();
        const t = now.toLocaleTimeString();
        const d = now.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
        sidebarTimeEl.innerHTML = `<span class="cd-brand-time-value">${t}</span><span class="cd-brand-time-date">${d}</span>`;
      };
      updateTime();
      clockInterval = setInterval(updateTime, 1000);
    }

  }

  // Initial Render (Empty State)
  updateUI(null);

  // Listen for updates from POS
  if (channel) {
    channel.onmessage = (event) => {
      if (event.data.type === 'UPDATE_CART') {
        updateUI(event.data.payload);
      } else if (event.data.type === 'RESET') {
        updateUI(null);
      }
    };
  }

  window._cdCleanup = () => {
    if (clockInterval) clearInterval(clockInterval);
    if (channel) channel.onmessage = null;
  };

  // Add necessary styles dynamically
  if (!document.getElementById('customer-display-styles')) {
    const style = document.createElement('style');
    style.id = 'customer-display-styles';
    style.textContent = `
      .customer-display-welcome {
        height: 100vh; display: flex; align-items: center; justify-content: center;
        background: radial-gradient(circle at center, var(--bg-elevated) 0%, var(--bg-main) 100%);
        text-align: center;
      }
      .store-logo-large {
        width: 120px; height: 120px; background: var(--primary); color: white;
        border-radius: 30px; display: flex; align-items: center; justify-content: center;
        font-size: 60px; font-weight: 800; margin: 0 auto 24px;
        box-shadow: 0 20px 40px rgba(79, 70, 229, 0.3);
      }
      .store-logo-large.has-logo { background: #fff; padding: 14px; box-shadow: 0 20px 40px rgba(15,23,42,0.12), inset 0 0 0 1px var(--border); }
      .store-logo-large img { width: 100%; height: 100%; object-fit: contain; }
      .store-name-display { font-size: 48px; margin-bottom: 12px; color: var(--text-main); }
      .welcome-message { font-size: 20px; color: var(--text-secondary); opacity: 0.8; }
      
      .customer-display-layout {
        display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 400px);
        height: 100vh; width: 100vw; max-width: 100vw; overflow: hidden; background: var(--bg-main);
      }
      .cd-main { display: flex; flex-direction: column; padding: 40px; border-right: 1px solid var(--border); min-width: 0; }

      .cd-cart-grid {
        flex: 1; overflow-y: auto; overflow-x: hidden; padding-right: 20px; min-width: 0;
        display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
        gap: 16px; align-content: start;
      }
      .cd-cart-item {
        display: flex; flex-direction: column; align-items: center; text-align: center; padding: 16px;
        background: var(--bg-elevated); border-radius: 20px; 
        border: 1px solid var(--border); transition: all 0.2s;
        box-shadow: var(--shadow-sm);
        min-height: 180px;
        justify-content: center;
      }
      .cd-cart-item:hover { transform: translateY(-4px); box-shadow: 0 8px 16px rgba(0,0,0,0.2); }
      
      .cd-item-emoji { font-size: 36px; margin-bottom: 8px; }
      .cd-item-details { flex: 0; margin-bottom: 8px; width: 100%; }
      .cd-item-name { 
        font-size: 15px; font-weight: 700; color: var(--text-main); 
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; 
      }
      .cd-variant { font-size: 11px; background: var(--primary-light); color: var(--primary); padding: 1px 6px; border-radius: 4px; margin: 4px auto; width: fit-content; display: block; }
      .cd-item-meta { font-size: 13px; color: var(--text-secondary); opacity: 0.8; }
      .cd-item-total { font-size: 18px; font-weight: 800; color: var(--accent); }
      
      .cd-sidebar { padding: 40px; display: flex; flex-direction: column; gap: 24px; background: var(--bg-elevated); min-width: 0; overflow: hidden; }
      .cd-summary-card {
        padding: 32px; background: var(--bg-main); border-radius: 24px; border: 1px solid var(--border);
        box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        min-width: 0; overflow: hidden;
      }
      .cd-summary-head { margin-bottom: 20px; border-bottom: 1px solid var(--border); padding-bottom: 14px; }
      .cd-summary-title { font-size: 20px; font-weight: 700; }
      .cd-summary-caption { font-size: 13px; font-weight: 600; color: var(--text-secondary); opacity: 0.75; }

      .cd-summary-rows { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
      .cd-row {
        display: flex; justify-content: space-between; align-items: center; gap: 8px;
        font-size: 15px; color: var(--text-secondary); min-width: 0;
        padding: 8px 4px; border-radius: 8px;
      }
      .cd-row span:first-child { white-space: nowrap; }
      .cd-row span:last-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: right; font-variant-numeric: tabular-nums; }
      .cd-row-subtotal { font-weight: 700; color: var(--text-main); font-size: 16px; }

      .cd-savings-strip {
        display: flex; align-items: center; gap: 10px; margin: 16px 0;
        padding: 12px 14px; border-radius: 14px;
        background: linear-gradient(135deg, rgba(16,185,129,0.12) 0%, rgba(16,185,129,0.05) 100%);
        border: 1px solid rgba(16,185,129,0.25);
        color: var(--success); font-size: 14px; font-weight: 600;
      }
      .cd-savings-strip i { font-size: 16px; flex-shrink: 0; }
      .cd-savings-strip b { font-weight: 800; }

      .cd-total-section {
        padding-top: 20px; border-top: 2px dashed var(--border); text-align: center; min-width: 0;
      }
      .cd-total-label { font-size: 13px; font-weight: 700; color: var(--text-secondary); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 1.5px; }
      .cd-total-badge {
        padding: 20px 12px; border-radius: 18px; min-width: 0;
        background: linear-gradient(135deg, var(--primary) 0%, #7c3aed 100%);
        box-shadow: 0 14px 28px -10px rgba(79, 70, 229, 0.55);
      }
      .cd-total-value {
        font-size: clamp(26px, 4.2vw, 42px); font-weight: 800; color: #fff; line-height: 1;
        white-space: nowrap;
      }

      .cd-footer-promo { margin-top: 24px; text-align: center; font-size: 14px; padding: 12px; background: rgba(245,158,11,0.08); border-radius: 12px; color: var(--warning-dark); }

      /* Brand footer — fills the leftover space below the summary card,
         pinned to the bottom of the sidebar via margin-top:auto. */
      .cd-brand-footer {
        margin-top: auto;
        display: flex; align-items: center; justify-content: space-between; gap: 14px;
        padding: 18px 20px; border-radius: 20px;
        background: var(--bg-main); border: 1px solid var(--border);
        box-shadow: 0 8px 20px rgba(0,0,0,0.06);
        min-width: 0;
      }
      .cd-brand-id { display: flex; align-items: center; gap: 12px; min-width: 0; }
      .cd-brand-logo {
        width: 42px; height: 42px; flex-shrink: 0; border-radius: 12px;
        background: linear-gradient(135deg, var(--primary) 0%, #7c3aed 100%);
        color: #fff; display: flex; align-items: center; justify-content: center;
        font-weight: 800; font-size: 19px;
        box-shadow: 0 6px 14px -4px rgba(79, 70, 229, 0.5);
      }
      .cd-brand-logo.has-logo { background: #fff; padding: 5px; box-shadow: inset 0 0 0 1px var(--border); }
      .cd-brand-logo img { width: 100%; height: 100%; object-fit: contain; }
      .cd-brand-meta { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
      .cd-brand-name { font-size: 15px; font-weight: 700; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .cd-brand-tag { font-size: 11.5px; font-weight: 600; color: var(--text-secondary); opacity: 0.75; display: flex; align-items: center; gap: 6px; white-space: nowrap; }
      .cd-live-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--success); animation: pulse 2s infinite; flex-shrink: 0; }
      .cd-brand-time { text-align: right; flex-shrink: 0; }
      .cd-brand-time-value { display: block; font-size: 18px; font-weight: 800; color: var(--text-main); font-variant-numeric: tabular-nums; letter-spacing: 0.3px; white-space: nowrap; }
      .cd-brand-time-date { display: block; font-size: 11px; font-weight: 600; color: var(--text-secondary); opacity: 0.7; margin-top: 2px; white-space: nowrap; }

      .animate-slide-in { animation: slideIn 0.3s ease-out forwards; }
      @keyframes slideIn {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .live-indicator { margin-top: 40px; font-size: 14px; font-weight: 600; color: var(--success); display: flex; align-items: center; justify-content: center; gap: 8px; }
      .live-indicator .dot { width: 8px; height: 8px; background: var(--success); border-radius: 50%; animation: pulse 2s infinite; }
      @keyframes pulse { 0% { opacity: 0.4; } 50% { opacity: 1; } 100% { opacity: 0.4; } }
    `;
    document.head.appendChild(style);
  }
}
