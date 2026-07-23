import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getTopbarTrialBanner, showSuspendedOverlay } from './LicenseService';

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

  it('should generate topbar lifetime banner only once activated for standalone deployment', () => {
    const settings = { deploymentMode: 'standalone' };

    window.syncEngine = { isLifetimeActivated: false };
    expect(getTopbarTrialBanner({ type: 'trial' }, settings)).not.toContain('Lifetime Offline Edition');

    window.syncEngine = { isLifetimeActivated: true };
    expect(getTopbarTrialBanner({ type: 'trial' }, settings)).toContain('Lifetime Offline Edition');

    delete window.syncEngine;
  });

  it('should return no banner when not lifetime activated', () => {
    window.syncEngine = { isLifetimeActivated: false };
    const html = getTopbarTrialBanner({ type: 'premium' }, { deploymentMode: 'standalone' });

    expect(html).toBe('');

    delete window.syncEngine;
  });
});
