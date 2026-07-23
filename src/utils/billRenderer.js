/**
 * Bill Renderer Utility
 * Renders order data as a formatted WhatsApp text message or HTML preview.
 * Supports both `qty` and `quantity` field names for compatibility.
 */

export const BillRenderer = {

  /**
   * Renders a rich HTML preview (used in the Template tab live preview)
   */
  render(order, template, settings = {}) {
    const items = order.items || [];
    const total = order.total || 0;
    const currency = settings.currency || '\u20B9';
    const dateStr = order.date
      ? new Date(order.date).toLocaleString('en-IN')
      : new Date().toLocaleString('en-IN');

    return `
      <div style="background:#fff;color:#1a1a1a;padding:20px;font-family:monospace;font-size:13px;line-height:1.6;max-width:360px;">
        ${template.showHeader !== false ? `
          <div style="text-align:center;margin-bottom:10px">
            <div style="font-size:15px;font-weight:bold">${template.headerText || settings.storeName || 'STORE'}</div>
            ${template.subHeaderText ? `<div style="font-size:12px;opacity:0.7">${template.subHeaderText}</div>` : ''}
            ${settings.storeAddress ? `<div style="font-size:11px;opacity:0.6">${settings.storeAddress}</div>` : ''}
          </div>
        ` : ''}
        <div style="border-top:1px dashed #ccc;border-bottom:1px dashed #ccc;padding:5px 0;margin-bottom:10px;display:flex;justify-content:space-between;font-size:11px">
          <span>#${order.id || 'TEST-001'}</span><span>${dateStr}</span>
        </div>
        ${template.showItems !== false ? `
          <div style="margin-bottom:10px">
            ${items.map(i => {
      const rawQty = i.qty ?? i.quantity ?? 1;
      const qty = parseFloat(parseFloat(rawQty).toFixed(3));
      const price = i.price ?? 0;
      const discount = i.itemDiscount ?? 0;
      const lineTotal = (price - discount) * qty;
      return `
                <div style="display:flex;justify-content:space-between;padding:2px 0">
                  <span>${i.emoji || ''} ${i.name}${i.variantName ? ` (${i.variantName})` : ''} x${Number.isInteger(qty) ? qty : qty.toFixed(3)}</span>
                  <span>${currency}${lineTotal.toFixed(2)}</span>
                </div>
              `;
    }).join('')}
          </div>
          <div style="border-top:1px dashed #ccc;padding-top:6px">
            <div style="display:flex;justify-content:space-between">
              <span>Subtotal</span><span>${currency}${(order.subtotal || 0).toFixed(2)}</span>
            </div>
            ${(order.discount || 0) > 0 ? `<div style="display:flex;justify-content:space-between;color:green"><span>Discount</span><span>-${currency}${order.discount.toFixed(2)}</span></div>` : ''}
            ${template.showTax !== false ? `<div style="display:flex;justify-content:space-between"><span>Tax</span><span>${currency}${(order.tax || 0).toFixed(2)}</span></div>` : ''}
            ${order.roundOff && Math.abs(order.roundOff) > 0.01 ? `<div style="display:flex;justify-content:space-between"><span>Round Off</span><span>${order.roundOff > 0 ? '+' : ''}${currency}${order.roundOff.toFixed(2)}</span></div>` : ''}
          </div>
        ` : ''}
        <div style="border-top:2px solid #000;margin-top:6px;padding-top:6px;display:flex;justify-content:space-between;font-weight:bold;font-size:14px">
          <span>TOTAL</span><span>${currency}${total.toFixed(2)}</span>
        </div>
        ${template.showFooter !== false && template.footerText ? `
          <div style="text-align:center;margin-top:12px;font-size:11px;border-top:1px dashed #ccc;padding-top:8px;white-space:pre-line">${template.footerText}</div>
        ` : ''}
      </div>
    `;
  },

  /**
   * Renders a plain-text WhatsApp message (used for sending)
   */
  renderAsText(order, template = {}, settings = {}) {
    const currency = settings.currency || '\u20B9';
    const storeName = template.headerText || settings.storeName || 'Store';
    const subheader = template.subHeaderText || '';
    const items = order.items || [];
    const total = order.total || 0;
    const dateStr = order.date
      ? new Date(order.date).toLocaleString('en-IN')
      : new Date().toLocaleString('en-IN');

    let text = '';

    if (template.showHeader !== false) {
      text += `*${storeName}*\n`;
      if (subheader) text += `_${subheader}_\n`;
      if (settings.storeAddress) text += `📍 ${settings.storeAddress}\n`;
      text += `--------------------------------\n`;
    }

    text += `🧾 *Order:* #${order.id || 'N/A'}\n`;
    text += `📅 *Date:* ${dateStr}\n`;
    if (order.orderType) text += `🍽️ *Type:* ${order.orderType}${order.tableName ? ` (${order.tableName})` : ''}\n`;
    if (order.customer?.name) text += `👤 *Customer:* ${order.customer.name}\n`;
    text += `--------------------------------\n`;

    if (template.showItems !== false) {
      items.forEach(item => {
        const rawQty = item.qty ?? item.quantity ?? 1;
        const qty = parseFloat(parseFloat(rawQty).toFixed(3));
        const price = item.price ?? 0;
        const discount = item.itemDiscount ?? 0;
        const lineTotal = (price - discount) * qty;
        text += `${item.emoji || '▪️'} *${item.name}*${item.variantName ? ` (${item.variantName})` : ''}\n`;
        text += `   ${Number.isInteger(qty) ? qty : qty.toFixed(3)} × ${currency}${price.toFixed(2)}${discount > 0 ? ` (-${currency}${discount.toFixed(2)})` : ''} = *${currency}${lineTotal.toFixed(2)}*\n`;
      });
      text += `--------------------------------\n`;

      if ((order.subtotal || 0) !== total) {
        text += `Subtotal: ${currency}${(order.subtotal || total).toFixed(2)}\n`;
        if ((order.discount || 0) > 0) text += `Discount: -${currency}${order.discount.toFixed(2)}\n`;
        if (template.showTax !== false && (order.tax || 0) > 0) text += `Tax: ${currency}${order.tax.toFixed(2)}\n`;
        if (order.roundOff && Math.abs(order.roundOff) > 0.01) text += `Round Off: ${order.roundOff > 0 ? '+' : ''}${currency}${order.roundOff.toFixed(2)}\n`;
      }
    }

    text += `*TOTAL: ${currency}${total.toFixed(2)}*\n`;

    if (template.showPayments !== false && order.payments?.length) {
      text += `--------------------------------\n`;
      text += `💳 *Payment Status:*\n`;
      order.payments.forEach(p => {
        text += `   ${p.method}: ${currency}${p.amount.toFixed(2)}\n`;
      });
      if (order.creditUsed) {
        text += `   💳 *Credit Bal Used: -${currency}${order.creditUsed.toFixed(2)}*\n`;
      }
      if (order.isCredit) {
        const collected = (order.payments || []).reduce((s, p) => s + p.amount, 0);
        const balanceDue = total - collected - (order.creditUsed || 0) - (order.redeemedPoints || 0);
        if (balanceDue > 0.01) {
          text += `   ⚠️ *Balance Due (New Debt): ${currency}${balanceDue.toFixed(2)}*\n`;
          if (order.creditInfo) text += `   📝 Note: ${order.creditInfo}\n`;
        }
      }
    }

    if (order.awardedPoints) {
      text += `🎁 *Points Earned: +${order.awardedPoints}*\n`;
    }
    if (order.redeemedPoints) {
      text += `✨ Points Redeemed: ${order.redeemedPoints}\n`;
    }

    if (template.showFooter !== false && template.footerText) {
      text += `--------------------------------\n`;
      text += `\n${template.footerText}\n`;
    }

    return text.trim();
  }
};
