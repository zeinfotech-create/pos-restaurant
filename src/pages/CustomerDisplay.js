import { getSettings } from '../db.js';
import { store } from '../store.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import QRCode from 'qrcode';

function buildBillText(settings, cur, cart) {
  const { items, subtotal, discount, tax, total } = cart;
  const lines = [];
  lines.push(settings.storeName || 'Store');
  lines.push(new Date().toLocaleString());
  lines.push('-'.repeat(28));
  items.forEach(item => {
    const lineTotal = (item.qty * item.price).toFixed(2);
    lines.push(`${item.name}${item.variantName ? ` (${item.variantName})` : ''}`);
    lines.push(`  ${item.qty} x ${cur}${item.price.toFixed(2)} = ${cur}${lineTotal}`);
  });
  lines.push('-'.repeat(28));
  lines.push(`Subtotal: ${cur}${subtotal.toFixed(2)}`);
  if (discount > 0) lines.push(`Discount: -${cur}${discount.toFixed(2)}`);
  lines.push(`Tax: ${cur}${tax.toFixed(2)}`);
  lines.push(`TOTAL: ${cur}${total.toFixed(2)}`);
  lines.push('-'.repeat(28));
  lines.push(settings.receiptFooter || 'Thank you for your visit!');
  return lines.join('\n');
}

// Direct merchant UPI collection — no gateway, no fees, no verification.
// The cashier confirms payment was received the same way they would for
// any other UPI QR sticker at a shop counter.
function buildUpiLink(settings, total) {
  const params = new URLSearchParams({
    pa: settings.upiId,
    pn: settings.storeName || 'Store',
    am: total.toFixed(2),
    cu: 'INR',
    tn: `Payment to ${settings.storeName || 'Store'}`
  });
  return `upi://pay?${params.toString()}`;
}

let channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('pos_customer_display') : null;
let currentCart = { items: [], subtotal: 0, tax: 0, discount: 0, total: 0 };

export async function renderCustomerDisplay(container) {
  const settings = await getSettings();
  const cur = settings.currency || '\u20B9';

  function updateUI(data) {
    currentCart = data || currentCart;
    const { items, total, subtotal, discount, tax } = currentCart;

    if (!items || items.length === 0) {
      container.innerHTML = `
        <div class="customer-display-welcome">
          <div class="welcome-content">
            <div class="store-logo-large">${settings.storeName?.[0] || 'Z'}</div>
            <h1 class="store-name-display">${settings.storeName || 'Welcome'}</h1>
            <p class="welcome-message">${settings.receiptFooter || 'Thank you for shopping with us!'}</p>
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
          <div class="cd-header">
            <div class="cd-store-info">
              <span class="cd-logo-small">${settings.storeName?.[0] || 'Z'}</span>
              <span class="cd-store-name">${settings.storeName}</span>
            </div>
            <div class="cd-time" id="cdTime"></div>
          </div>
          
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
            <h2 class="cd-summary-title">Order Summary</h2>
            <div class="cd-summary-rows">
              <div class="cd-row"><span>Subtotal</span><span>${cur}${subtotal.toFixed(2)}</span></div>
              ${discount > 0 ? `<div class="cd-row text-accent"><span>Discount</span><span>-${cur}${discount.toFixed(2)}</span></div>` : ''}
              <div class="cd-row"><span>Tax</span><span>${cur}${tax.toFixed(2)}</span></div>
            </div>
            <div class="cd-total-section">
              <div class="cd-total-label">Amount to Pay</div>
              <div class="cd-total-value">${cur}${total.toFixed(2)}</div>
            </div>
            <div class="cd-footer-promo">
              <i class="fa-solid fa-star text-warning"></i> 
              Earn ${Math.floor(total / 10)} points on this order!
            </div>
          </div>
          
          <!-- Branding Area -->
          <div class="cd-branding">
            <div class="cd-qr-placeholder">
              <canvas id="cdQrCanvas"></canvas>
              <span>${settings.upiId ? 'Scan to Pay via UPI' : 'Scan for Digital Bill'}</span>
            </div>
          </div>
        </div>
      </div>
    `;

    // Internal Clock
    const timeEl = document.getElementById('cdTime');
    if (timeEl) {
      const updateTime = () => {
        timeEl.innerText = new Date().toLocaleTimeString();
      };
      updateTime();
      setInterval(updateTime, 1000);
    }

    // Render the QR — a direct merchant UPI payment link when a UPI ID is
    // configured, otherwise falls back to a plain-text bill summary. Both
    // work fully offline; UPI needs no gateway, no fees, no verification.
    const qrCanvas = document.getElementById('cdQrCanvas');
    if (qrCanvas) {
      const qrContent = (settings.upiId && total > 0)
        ? buildUpiLink(settings, total)
        : buildBillText(settings, cur, currentCart);
      QRCode.toCanvas(qrCanvas, qrContent, { width: 120, margin: 1 }, (err) => {
        if (err) console.error('[CustomerDisplay] QR generation failed:', err);
      });
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
      .store-name-display { font-size: 48px; margin-bottom: 12px; color: var(--text-main); }
      .welcome-message { font-size: 20px; color: var(--text-secondary); opacity: 0.8; }
      
      .customer-display-layout {
        display: grid; grid-template-columns: 1fr 400px; height: 100vh; background: var(--bg-main);
      }
      .cd-main { display: flex; flex-direction: column; padding: 40px; border-right: 1px solid var(--border); }
      .cd-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 40px; }
      .cd-store-info { display: flex; align-items: center; gap: 16px; }
      .cd-logo-small { 
        width: 40px; height: 40px; background: var(--primary); color: white;
        border-radius: 10px; display: flex; align-items: center; justify-content: center;
        font-weight: bold; font-size: 20px;
      }
      .cd-store-name { font-size: 24px; font-weight: 700; color: var(--text-main); }
      .cd-time { font-size: 20px; font-weight: 500; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
      
      .cd-cart-grid { 
        flex: 1; overflow-y: auto; padding-right: 20px;
        display: grid; grid-template-columns: repeat(6, 1fr);
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
      
      .cd-sidebar { padding: 40px; display: flex; flex-direction: column; gap: 24px; background: var(--bg-elevated); }
      .cd-summary-card {
        padding: 32px; background: var(--bg-main); border-radius: 24px; border: 1px solid var(--border);
        box-shadow: 0 10px 30px rgba(0,0,0,0.1);
      }
      .cd-summary-title { font-size: 20px; font-weight: 700; margin-bottom: 24px; border-bottom: 1px solid var(--border); padding-bottom: 16px; }
      .cd-summary-rows { display: flex; flex-direction: column; gap: 12px; margin-bottom: 32px; }
      .cd-row { display: flex; justify-content: space-between; font-size: 18px; color: var(--text-secondary); }
      
      .cd-total-section {
        padding-top: 24px; border-top: 2px dashed var(--border); text-align: center;
      }
      .cd-total-label { font-size: 16px; font-weight: 600; color: var(--text-secondary); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1px; }
      .cd-total-value { font-size: 60px; font-weight: 800; color: var(--primary); line-height: 1; }
      
      .cd-footer-promo { margin-top: 24px; text-align: center; font-size: 14px; padding: 12px; background: rgba(245,158,11,0.08); border-radius: 12px; color: var(--warning-dark); }
      
      .cd-branding { flex: 1; display: flex; align-items: flex-end; justify-content: center; }
      .cd-qr-placeholder {
        text-align: center; padding: 16px; background: white; border-radius: 16px; border: 1px solid #ddd;
        display: flex; flex-direction: column; align-items: center; gap: 8px; color: #333;
      }
      .cd-qr-placeholder span { font-size: 12px; font-weight: 600; }
      
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
