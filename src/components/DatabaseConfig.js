// DatabaseConfig.js — Vanilla JS component for DB Setup
// ============================================================

export async function renderDatabaseConfig(container) {
    let savedConfig = null;
    if (window.electronAPI) {
        savedConfig = await window.electronAPI.getDbConfig();
    }

    const config = {
        host: savedConfig?.host || 'localhost',
        port: savedConfig?.port || '5432',
        username: savedConfig?.username || 'postgres',
        password: savedConfig?.password || '',
        database: savedConfig?.database || 'postgres'
    };

    container.innerHTML = `
        <div class="db-config-overlay">
            <div class="db-config-card">
                <div class="db-config-header">
                    <i class="fa-solid fa-database db-logo-icon"></i>
                    <h2>Database Setup</h2>
                    <p>Configure your local PostgreSQL connection to continue.</p>
                </div>

                <div class="db-config-body">
                    <div class="input-group">
                        <label>Host</label>
                        <input type="text" id="db-host" value="${config.host}" placeholder="localhost" />
                    </div>
                    <div class="input-row">
                        <div class="input-group">
                            <label>Port</label>
                            <input type="text" id="db-port" value="${config.port}" placeholder="5432" />
                        </div>
                        <div class="input-group">
                            <label>Database</label>
                            <input type="text" id="db-database" value="${config.database}" placeholder="postgres" />
                        </div>
                    </div>
                    <div class="input-group">
                        <label>Username</label>
                        <input type="text" id="db-username" value="${config.username}" placeholder="postgres" />
                    </div>
                    <div class="input-group">
                        <label>Password</label>
                        <input type="password" id="db-password" value="${config.password}" placeholder="••••••••" />
                    </div>

                <div id="db-status-msg" class="status-msg hidden"></div>

                <div class="db-install-section hidden" id="pg-install-section">
                    <p>PostgreSQL not found? We can help you install it.</p>
                    <button id="btn-install-pg" class="btn-install">
                        <i class="fa-solid fa-download"></i> Download & Install PostgreSQL 16
                    </button>
                </div>

                <div class="db-config-actions">
                        <button id="btn-test-db" class="btn-test">Test Connection</button>
                        <button id="btn-save-db" class="btn-save">Save & Start Hub</button>
                    </div>
                </div>

                <div class="db-config-footer">
                    <p>New installation? <a href="https://www.postgresql.org/download/" target="_blank">Install PostgreSQL</a></p>
                </div>
            </div>
        </div>
    `;

    // Inject CSS if not already present (skip under vitest/happy-dom tests to prevent network warnings)
    if (typeof process === 'undefined' || process.env.NODE_ENV !== 'test') {
        if (!document.getElementById('db-config-styles')) {
            const link = document.createElement('link');
            link.id = 'db-config-styles';
            link.rel = 'stylesheet';
            link.href = './src/components/DatabaseConfig.css';
            document.head.appendChild(link);
        }
    }

    const setStatus = (msg, type) => {
        const el = document.getElementById('db-status-msg');
        el.textContent = msg;
        el.className = `status-msg ${type}`;
        el.classList.remove('hidden');
    };

    const getFormConfig = () => ({
        host: document.getElementById('db-host').value,
        port: document.getElementById('db-port').value,
        database: document.getElementById('db-database').value,
        username: document.getElementById('db-username').value,
        password: document.getElementById('db-password').value
    });

    document.getElementById('btn-test-db').onclick = async () => {
        if (!window.electronAPI) return;
        const c = getFormConfig();
        const url = `postgres://${c.username}:${c.password}@${c.host}:${c.port}/${c.database}`;
        
        document.getElementById('btn-test-db').disabled = true;
        document.getElementById('btn-test-db').textContent = 'Testing...';
        
        const result = await window.electronAPI.testDbConnection(url);
        
        document.getElementById('btn-test-db').disabled = false;
        document.getElementById('btn-test-db').textContent = 'Test Connection';

        if (result.success) {
            setStatus('Connection Successful!', 'success');
            document.getElementById('pg-install-section').classList.add('hidden');
        } else {
            setStatus(result.message, 'error');
            document.getElementById('pg-install-section').classList.remove('hidden');
        }
    };

    document.getElementById('btn-install-pg').onclick = async () => {
        if (!window.electronAPI) return;
        
        const btn = document.getElementById('btn-install-pg');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Initializing Installer...';
        
        setStatus('Starting PostgreSQL installer. Please follow the instructions in the installer window.', 'info');
        
        const result = await window.electronAPI.installPostgres();
        
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-download"></i> Download & Install PostgreSQL 16';
        
        if (result.success) {
            setStatus('Installer started successfully.', 'success');
        } else {
            setStatus('Failed to start installer: ' + result.message, 'error');
        }
    };

    document.getElementById('btn-save-db').onclick = async () => {
        if (!window.electronAPI) return;
        const c = getFormConfig();
        const url = `postgres://${c.username}:${c.password}@${c.host}:${c.port}/${c.database}`;
        
        await window.electronAPI.saveDbConfig({ ...c, url });
        
        // Redirect to dashboard or wait for server
        window.location.hash = 'dashboard';
        window.location.reload();
    };
}
