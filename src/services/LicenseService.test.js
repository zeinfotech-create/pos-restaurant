import { describe, it, expect, beforeEach, vi } from 'vitest';
import { showSuspendedOverlay } from './LicenseService';

// Mock DB
vi.mock('../db.js', () => ({
  getSettings: vi.fn().mockResolvedValue({
    storeName: 'Test Store',
    receiptFooter: 'Bye!',
    installationDate: new Date('2026-05-10T10:00:00Z').toISOString()
  })
}));

describe('LicenseService', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('should show suspended overlay in the DOM', () => {
    showSuspendedOverlay('Reason: Abuse');

    const overlay = document.getElementById('account-suspended-overlay');
    expect(overlay).toBeTruthy();
    expect(overlay.innerHTML).toContain('Account Suspended');
    expect(overlay.innerHTML).toContain('Reason: Abuse');
  });
});
