import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BackupService } from './BackupService';

const writtenStores = {};

// Mock DB
vi.mock('../db.js', () => ({
  read: vi.fn((key) => Promise.resolve(writtenStores[key] || [])),
  write: vi.fn((key, val) => { writtenStores[key] = val; }),
  updateData: vi.fn(),
  getDataById: vi.fn().mockResolvedValue(null),
  getSettings: vi.fn().mockResolvedValue({
    licenseKey: 'TEST-LICENSE',
    branchId: 'b1',
    backupSettings: { enabled: true, customPath: 'C:/backups' }
  }),
  saveSettings: vi.fn(),
  KEYS: {
    BACKUP_HISTORY: 'backup_history',
    IMPORT_HISTORY: 'import_history',
    PRODUCTS: 'pos_products',
    ORDERS: 'pos_orders',
    CUSTOMERS: 'pos_customers'
  }
}));

function makeFile(content) {
  return new File([content], 'backup.json', { type: 'application/json' });
}

describe('BackupService.importBackup', () => {
  beforeEach(() => {
    Object.keys(writtenStores).forEach(k => delete writtenStores[k]);
    vi.clearAllMocks();
  });

  it('imports a valid backup and reports per-store stats', async () => {
    const payload = { products: [{ id: 'p1', name: 'Item 1' }, { id: 'p2', name: 'Item 2' }] };
    const backup = { version: '3.0', payload };

    const result = await BackupService.importBackup(makeFile(JSON.stringify(backup)));

    expect(result.success).toBe(true);
    expect(result.count).toBe(2);
    expect(result.stats).toEqual({ products: 2 });
  });

  it('rejects a backup whose checksum does not match its payload', async () => {
    const payload = { products: [{ id: 'p1', name: 'Item 1' }] };
    const backup = { version: '3.0', payload, checksum: 'not-the-real-hash' };

    await expect(BackupService.importBackup(makeFile(JSON.stringify(backup))))
      .rejects.toThrow(/integrity check failed/i);
  });

  it('rejects a file with no recognizable POS data', async () => {
    const backup = { someRandomKey: 'nothing useful here' };

    await expect(BackupService.importBackup(makeFile(JSON.stringify(backup))))
      .rejects.toThrow(/no recognizable/i);
  });

  it('skips records without an id instead of throwing', async () => {
    const payload = { customers: [{ id: 'c1', name: 'Valid' }, { name: 'Missing id' }] };
    const backup = { version: '3.0', payload };

    const result = await BackupService.importBackup(makeFile(JSON.stringify(backup)));

    expect(result.count).toBe(1);
  });
});
