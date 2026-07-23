import { describe, it, expect } from 'vitest';
import { BillRenderer } from './billRenderer.js';

describe('BillRenderer', () => {
  const dummyOrder = {
    id: 'ORD-001',
    date: '2024-05-10T12:00:00Z',
    subtotal: 100,
    discount: 10,
    tax: 5,
    roundOff: 0.5,
    total: 95.5,
    customer: { name: 'John Doe' },
    items: [
      { name: 'Coffee', qty: 2, price: 30 },
      { name: 'Sandwich', quantity: 1, price: 40, itemDiscount: 5 } // Testing 'quantity' fallback and itemDiscount
    ]
  };

  const dummyTemplate = {
    headerText: 'My Cafe',
    subHeaderText: 'Best coffee in town',
    footerText: 'Thank you!',
    showItems: true,
    showTax: true,
    showFooter: true
  };

  const dummySettings = {
    currency: '$',
    storeName: 'Settings Cafe',
    storeAddress: '123 Street'
  };

  describe('render()', () => {
    it('should generate an HTML string containing the order details', () => {
      const html = BillRenderer.render(dummyOrder, dummyTemplate, dummySettings);
      
      expect(html).toContain('My Cafe');
      expect(html).toContain('Best coffee in town');
      expect(html).toContain('123 Street');
      expect(html).toContain('ORD-001');
      expect(html).toContain('Coffee');
      expect(html).toContain('Sandwich');
      expect(html).toContain('$95.50'); // Total
      expect(html).toContain('$60.00'); // Coffee line total (2 * 30)
      expect(html).toContain('$35.00'); // Sandwich line total (1 * (40 - 5))
      expect(html).toContain('Thank you!');
    });

    it('should handle missing template and use settings storeName', () => {
      const html = BillRenderer.render(dummyOrder, {}, dummySettings);
      expect(html).toContain('Settings Cafe');
    });

    it('should hide sections if template dictates false', () => {
      const html = BillRenderer.render(dummyOrder, { showHeader: false, showFooter: false }, dummySettings);
      expect(html).not.toContain('Settings Cafe');
      expect(html).not.toContain('123 Street');
      // Footer text shouldn't show if showFooter is false, even if provided
      const html2 = BillRenderer.render(dummyOrder, { showFooter: false, footerText: 'Bye' }, dummySettings);
      expect(html2).not.toContain('Bye');
    });
  });

  describe('renderAsText()', () => {
    it('should generate a formatted text string for WhatsApp', () => {
      const text = BillRenderer.renderAsText(dummyOrder, dummyTemplate, dummySettings);
      
      expect(text).toContain('*My Cafe*');
      expect(text).toContain('_Best coffee in town_');
      expect(text).toContain('📍 123 Street');
      expect(text).toContain('*Order:* #ORD-001');
      expect(text).toContain('👤 *Customer:* John Doe');
      
      // Items
      expect(text).toContain('*Coffee*');
      expect(text).toContain('2 × $30.00 = *$60.00*');
      expect(text).toContain('*Sandwich*');
      expect(text).toContain('1 × $40.00 (-$5.00) = *$35.00*');
      
      // Totals
      expect(text).toContain('Subtotal: $100.00');
      expect(text).toContain('Discount: -$10.00');
      expect(text).toContain('Tax: $5.00');
      expect(text).toContain('Round Off: +$0.50');
      expect(text).toContain('*TOTAL: $95.50*');
      
      expect(text).toContain('Thank you!');
    });

    it('should show new debt if order is credit', () => {
      const creditOrder = { ...dummyOrder, isCredit: true, payments: [{ method: 'Cash', amount: 50 }] };
      const text = BillRenderer.renderAsText(creditOrder, dummyTemplate, dummySettings);
      
      expect(text).toContain('Cash: $50.00');
      expect(text).toContain('⚠️ *Balance Due (New Debt): $45.50*');
    });
  });
});
