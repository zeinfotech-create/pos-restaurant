import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderDatabaseConfig } from './DatabaseConfig';

describe('DatabaseConfig component', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    
    // Mock electronAPI
    window.electronAPI = {
      getDbConfig: vi.fn().mockResolvedValue({
        host: 'localhost',
        port: '5432',
        username: 'postgres',
        password: 'password',
        database: 'pos_db'
      }),
      testDbConnection: vi.fn().mockResolvedValue({ success: true }),
      saveDbConfig: vi.fn().mockResolvedValue({ success: true })
    };
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete window.electronAPI;
    vi.restoreAllMocks();
  });

  it('should render the form with saved config', async () => {
    const container = document.getElementById('app');
    await renderDatabaseConfig(container);
    
    expect(window.electronAPI.getDbConfig).toHaveBeenCalled();
    
    const hostInput = document.getElementById('db-host');
    expect(hostInput.value).toBe('localhost');
    
    const dbInput = document.getElementById('db-database');
    expect(dbInput.value).toBe('pos_db');
  });

  it('should test connection successfully', async () => {
    const container = document.getElementById('app');
    await renderDatabaseConfig(container);
    
    const testBtn = document.getElementById('btn-test-db');
    await testBtn.onclick();
    
    expect(window.electronAPI.testDbConnection).toHaveBeenCalled();
    const statusMsg = document.getElementById('db-status-msg');
    expect(statusMsg.classList.contains('success')).toBe(true);
    expect(statusMsg.textContent).toContain('Connection Successful');
  });

  it('should show error on connection failure', async () => {
    window.electronAPI.testDbConnection.mockResolvedValueOnce({ success: false, message: 'Auth failed' });
    
    const container = document.getElementById('app');
    await renderDatabaseConfig(container);
    
    const testBtn = document.getElementById('btn-test-db');
    await testBtn.onclick();
    
    const statusMsg = document.getElementById('db-status-msg');
    expect(statusMsg.classList.contains('error')).toBe(true);
    expect(statusMsg.textContent).toContain('Auth failed');
    
    const installSection = document.getElementById('pg-install-section');
    expect(installSection.classList.contains('hidden')).toBe(false);
  });
});
