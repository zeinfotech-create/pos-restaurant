import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { syncEngine } from './syncEngine';

// Mock DB
vi.mock('../db.js', () => ({
  db: {
    init: vi.fn(),
    get: vi.fn(),
    put: vi.fn()
  },
  KEYS: { SESSION: 'session' },
  getSettings: vi.fn().mockResolvedValue({
    syncHubIp: '127.0.0.1',
    licenseKey: 'TEST-KEY',
    isInstalled: true,
    installationDate: new Date('2026-05-10T10:00:00Z').toISOString()
  }),
  getCachedLicenseStatus: vi.fn().mockResolvedValue({
    type: 'trial',
    isExpired: false,
    daysLeft: 5,
    branchLimit: 2,
    productLimit: 50,
    modules: { cloud_sync: true }
  }),
  saveCachedLicenseStatus: vi.fn(),
  updateSettings: vi.fn(),
  saveSettings: vi.fn(),
  getBranches: vi.fn().mockResolvedValue([]),
  getDeletedTombstones: vi.fn().mockResolvedValue(new Set()),
  clearExpiredTombstones: vi.fn().mockResolvedValue(true),
  verifyLocalUser: vi.fn()
}));

// Mock License Service
vi.mock('./LicenseService.js', () => ({
  showSuspendedOverlay: vi.fn()
}));

describe('SyncEngine Service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should initialize with cached license settings', async () => {
    // Wait for the constructor's microtasks
    await new Promise(resolve => setTimeout(resolve, 10));
    
    const limits = syncEngine.getLimits();
    expect(limits.maxBranches).toBe(2);
    expect(limits.maxProducts).toBe(50);
  });

  it('should accurately verify capabilities based on license features', async () => {
    // cloud_sync module is enabled in trial cache mock
    expect(syncEngine.checkCapability('cloud_sync')).toBe(true);
  });

  it('unlocks everything in standalone mode once a Lifetime key is activated', () => {
    const originalMode = syncEngine.deploymentMode;
    const originalStatus = syncEngine.licenseStatus;
    const originalActivated = syncEngine.isLifetimeActivated;
    syncEngine.deploymentMode = 'standalone';
    syncEngine.isLifetimeActivated = true;

    // Once activated, standalone unlocks everything regardless of
    // licenseStatus.modules (the activated licenseStatus itself sets these
    // to full/true anyway, but checkCapability's standalone+activated branch
    // short-circuits before even looking at modules).
    syncEngine.licenseStatus = { type: 'unactivated', modules: { cloud_sync: false } };
    expect(syncEngine.checkCapability('cloud_sync')).toBe(true);

    syncEngine.deploymentMode = originalMode;
    syncEngine.licenseStatus = originalStatus;
    syncEngine.isLifetimeActivated = originalActivated;
  });

  it('locks capabilities in standalone mode until a Lifetime key is activated', () => {
    const originalMode = syncEngine.deploymentMode;
    const originalStatus = syncEngine.licenseStatus;
    const originalActivated = syncEngine.isLifetimeActivated;
    syncEngine.deploymentMode = 'standalone';
    syncEngine.isLifetimeActivated = false;

    // Un-activated: falls through to the normal licenseStatus.modules check
    // instead of the standalone short-circuit, so a locked status correctly
    // stays locked (this is the whole point of the activation gate).
    syncEngine.licenseStatus = { type: 'unactivated', modules: { cloud_sync: false } };
    expect(syncEngine.checkCapability('cloud_sync')).toBe(false);

    syncEngine.deploymentMode = originalMode;
    syncEngine.licenseStatus = originalStatus;
    syncEngine.isLifetimeActivated = originalActivated;
  });
});
