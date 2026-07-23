import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BackupService } from './BackupService';

// Mock DB
vi.mock('../db.js', () => ({
  read: vi.fn().mockResolvedValue([]),
  write: vi.fn(),
  updateData: vi.fn(),
  deleteData: vi.fn(),
  getSettings: vi.fn().mockResolvedValue({
    licenseKey: 'TEST-LICENSE',
    deploymentMode: 'standalone',
    backupSettings: { enabled: true, customPath: 'C:/backups' }
  }),
  saveSettings: vi.fn(),
  KEYS: {
    BACKUP_HISTORY: 'backup_history',
    SETTINGS: 'settings',
    IMPORT_HISTORY: 'import_history'
  }
}));

// Mock SyncEngine
vi.mock('./syncEngine.js', () => ({
  syncEngine: {
    hubUrl: 'ws://127.0.0.1:3030?licenseKey=TEST-LICENSE'
  }
}));

describe('BackupService Controller', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should format Hub API URL correctly from WebSockets URL', () => {
    const apiUrl = BackupService.getHubApiUrl();
    expect(apiUrl).toBe('http://127.0.0.1:3030/api/backups');
  });

  it('should fetch hub backups successfully', async () => {
    const globalFetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ name: 'backup1.json' }])
    });

    const backups = await BackupService.getHubBackups();
    
    expect(globalFetchSpy).toHaveBeenCalledWith('http://127.0.0.1:3030/api/backups?licenseKey=TEST-LICENSE');
    expect(backups.length).toBe(1);
    expect(backups[0].name).toBe('backup1.json');
  });

  it('should update local backup settings and succeed on standalone mode without calling fetch', async () => {
    const globalFetchSpy = vi.spyOn(global, 'fetch');
    const { saveSettings } = await import('../db.js');

    const result = await BackupService.updateHubSettings({ enabled: false });
    
    expect(saveSettings).toHaveBeenCalled();
    expect(globalFetchSpy).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
});
