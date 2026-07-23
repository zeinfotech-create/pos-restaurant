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

  it('should only unlock capabilities in standalone mode once Lifetime-activated', () => {
    const originalMode = syncEngine.deploymentMode;
    const originalActivated = syncEngine.isLifetimeActivated;
    const originalStatus = syncEngine.licenseStatus;
    syncEngine.deploymentMode = 'standalone';

    // Not yet activated — no trial grace period on the desktop build, nothing unlocks
    syncEngine.isLifetimeActivated = false;
    syncEngine.licenseStatus = { type: 'unactivated', modules: { cloud_sync: false } };
    expect(syncEngine.checkCapability('cloud_sync')).toBe(false);

    // Activated — everything unlocks regardless of licenseStatus modules
    syncEngine.isLifetimeActivated = true;
    expect(syncEngine.checkCapability('cloud_sync')).toBe(true);

    syncEngine.deploymentMode = originalMode;
    syncEngine.isLifetimeActivated = originalActivated;
    syncEngine.licenseStatus = originalStatus;
  });
});
