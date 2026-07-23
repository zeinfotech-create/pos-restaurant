const fs = require('fs');
const path = require('path');
const DBManager = require('./dbManager');

const BACKUP_DIR = path.join(__dirname, 'backups');

const BackupService = {
    modelMap: null,
    backupIntervals: {}, // { licenseKey: { interval: 'daily', retentionDays: 30, lastBackup: timestamp } }

    init(modelMap) {
        this.modelMap = modelMap;
        if (!fs.existsSync(BACKUP_DIR)) {
            fs.mkdirSync(BACKUP_DIR);
            console.log('📂 Created backups directory:', BACKUP_DIR);
        }

        // Run scheduler every minute
        setInterval(() => this.runScheduler(), 60000);
        
        // Initial cleanup
        this.runRetentionCleanup();
        // Run cleanup every 24 hours
        setInterval(() => this.runRetentionCleanup(), 24 * 60 * 60 * 1000);
        
        console.log('🛡️ BackupService initialized');
    },

    async runScheduler() {
        // In a real multi-tenant app, we'd fetch all licenses and their backup settings.
        // For now, we'll fetch all unique license keys from the settings table.
        try {
            const License = this.modelMap['licenses'];
            const allLicenses = await DBManager.find(License, 'licenses', {});
            
            for (const lic of allLicenses) {
                const licenseKey = lic.licenseKey;
                if (!licenseKey || licenseKey === 'GLOBAL') continue;

                // Get backup settings for this license (from their settings record)
                const Setting = this.modelMap['settings'];
                const settings = await DBManager.findOne(Setting, 'settings', { licenseKey });
                
                const backupSettings = settings?.backupSettings || {
                    interval: 'daily',
                    retentionDays: 30,
                    enabled: true
                };

                if (!backupSettings.enabled) continue;

                await this.checkAndTriggerBackup(licenseKey, backupSettings);
            }
        } catch (err) {
            console.error('[BackupService] Scheduler error:', err.message);
        }
    },

    async checkAndTriggerBackup(licenseKey, settings) {
        const now = Date.now();
        const intervalMs = this.getIntervalMs(settings.interval);
        
        if (intervalMs === 0) return; // Manual mode

        // Check last backup time for this license and interval
        const lastBackupFile = this.getLastBackupFile(licenseKey, settings.interval);
        let lastBackupTime = 0;
        
        if (lastBackupFile) {
            const stats = fs.statSync(path.join(BACKUP_DIR, lastBackupFile));
            lastBackupTime = stats.mtimeMs;
        }

        if (now - lastBackupTime >= intervalMs) {
            console.log(`[BackupService] Triggering automated ${settings.interval} backup for ${licenseKey}`);
            await this.performBackup(licenseKey, settings.interval);
        }
    },

    getIntervalMs(interval) {
        switch (interval) {
            case 'hourly': return 60 * 60 * 1000;
            case 'daily':  return 24 * 60 * 60 * 1000;
            case 'weekly': return 7 * 24 * 60 * 60 * 1000;
            default: return 0; // manual
        }
    },

    getLastBackupFile(licenseKey, type) {
        const files = fs.readdirSync(BACKUP_DIR);
        const pattern = `backup_${licenseKey}_${type}_`;
        const matches = files.filter(f => f.startsWith(pattern)).sort().reverse();
        return matches.length > 0 ? matches[0] : null;
    },

    async performBackup(licenseKey, type = 'manual') {
        try {
            // Fetch backup settings to check for customPath
            const Setting = this.modelMap['settings'];
            const settingsRecord = await DBManager.findOne(Setting, 'settings', { licenseKey });
            const backupSettings = settingsRecord?.backupSettings || {};
            
            const backupData = await DBManager.exportAll(this.modelMap, licenseKey);
            const backupString = JSON.stringify(backupData, null, 2);
            
            // --- SMART BACKUP: Check for changes ---
            const lastFile = this.getLastBackupFile(licenseKey, type) || this.getLastBackupFile(licenseKey, 'daily');
            if (lastFile) {
                try {
                    const lastFilePath = path.join(BACKUP_DIR, lastFile);
                    if (fs.existsSync(lastFilePath)) {
                        const lastContent = fs.readFileSync(lastFilePath, 'utf8');
                        if (lastContent === backupString) {
                            console.log(`[BackupService] Skipping backup for ${licenseKey}: Data is identical to ${lastFile}`);
                            return { success: true, filename: lastFile, skipped: true, message: 'No changes detected since last backup.' };
                        }
                    }
                } catch (e) {
                    console.error('[BackupService] Error comparing with last backup:', e.message);
                }
            }
            // ---------------------------------------

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `backup_${licenseKey}_${type}_${timestamp}.json`;
            
            let targetDir = BACKUP_DIR;
            if (backupSettings.customPath) {
                try {
                    if (!fs.existsSync(backupSettings.customPath)) {
                        fs.mkdirSync(backupSettings.customPath, { recursive: true });
                    }
                    targetDir = backupSettings.customPath;
                } catch (e) {
                    console.error(`[BackupService] Error with custom path:`, e.message);
                }
            }

            const filePath = path.join(targetDir, filename);
            fs.writeFileSync(filePath, backupString);
            console.log(`✅ Backup saved to: ${filePath}`);

            return { success: true, filename, path: filePath };
        } catch (err) {
            console.error(`❌ Backup failed for ${licenseKey}:`, err.message);
            return { success: false, error: err.message };
        }
    },

    async runRetentionCleanup() {
        console.log('[BackupService] Running retention cleanup...');
        try {
            const files = fs.readdirSync(BACKUP_DIR);
            const now = Date.now();

            // We need to group files by license to apply their specific retention settings
            // But for simplicity, we'll use a global default of 30 days unless we fetch settings for each.
            // Let's just do a per-file check.
            
            for (const file of files) {
                if (!file.endsWith('.json')) continue;
                
                const filePath = path.join(BACKUP_DIR, file);
                const stats = fs.statSync(filePath);
                
                // Extract licenseKey from filename: backup_{licenseKey}_{type}_{timestamp}.json
                const parts = file.split('_');
                if (parts.length < 3) continue;
                
                const licenseKey = parts[1];
                
                // Fetch retention days for this license
                const Setting = this.modelMap['settings'];
                const settings = await DBManager.findOne(Setting, 'settings', { licenseKey });
                const retentionDays = settings?.backupSettings?.retentionDays || 30;
                
                const retentionMs = retentionDays * 24 * 60 * 60 * 1000;

                if (now - stats.mtimeMs > retentionMs) {
                    fs.unlinkSync(filePath);
                    console.log(`[BackupService] Deleted old backup: ${file}`);
                }
            }
        } catch (err) {
            console.error('[BackupService] Cleanup error:', err.message);
        }
    },

    async getBackups(licenseKey) {
        const Setting = this.modelMap['settings'];
        const settingsRecord = await DBManager.findOne(Setting, 'settings', { licenseKey });
        const customPath = settingsRecord?.backupSettings?.customPath;

        const dirs = [BACKUP_DIR];
        if (customPath && fs.existsSync(customPath) && customPath !== BACKUP_DIR) {
            dirs.push(customPath);
        }

        const filesMap = new Map();

        for (const dir of dirs) {
            if (!fs.existsSync(dir)) continue;
            try {
                const files = fs.readdirSync(dir)
                    .filter(f => f.startsWith(`backup_${licenseKey}_`))
                    .map(f => {
                        const stats = fs.statSync(path.join(dir, f));
                        return {
                            filename: f,
                            size: stats.size,
                            createdAt: stats.mtime,
                            type: f.split('_')[2],
                            fullPath: path.join(dir, f)
                        };
                    });
                
                for (const fileObj of files) {
                    if (!filesMap.has(fileObj.filename)) {
                        filesMap.set(fileObj.filename, fileObj);
                    }
                }
            } catch (e) {
                console.error(`[BackupService] Error scanning directory ${dir}:`, e.message);
            }
        }

        return Array.from(filesMap.values()).sort((a, b) => b.createdAt - a.createdAt);
    },

    async restoreBackup(licenseKey, filename, wipe = false) {
        // Try default dir first, then custom path if we can find it
        let filePath = path.join(BACKUP_DIR, filename);
        
        if (!fs.existsSync(filePath)) {
            const Setting = this.modelMap['settings'];
            const settingsRecord = await DBManager.findOne(Setting, 'settings', { licenseKey });
            const customPath = settingsRecord?.backupSettings?.customPath;
            if (customPath) {
                filePath = path.join(customPath, filename);
            }
        }

        if (!fs.existsSync(filePath)) throw new Error('Backup file not found');

        const backupData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        
        if (backupData.licenseKey !== licenseKey) {
            throw new Error('License mismatch in backup file');
        }

        console.log(`[BackupService] Restoring backup ${filename} for ${licenseKey} (wipe=${wipe})`);
        return await DBManager.importAll(this.modelMap, backupData, wipe);
    }
};

module.exports = BackupService;
