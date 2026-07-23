import { read, write, updateData, deleteData, KEYS, getSettings, saveSettings } from '../db.js';
import { syncEngine } from './syncEngine.js';

// Helper for data integrity
async function generateChecksum(data) {
    const msgUint8 = new TextEncoder().encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export const BackupService = {
    /**
     * Gets the Hub API URL based on syncEngine's current connection.
     */
    getHubApiUrl() {
        if (!syncEngine.hubUrl) return null;
        // hubUrl is ws://ip:3030?...
        const url = new URL(syncEngine.hubUrl.replace('ws://', 'http://').replace('wss://', 'https://'));
        return `${url.protocol}//${url.host}/api/backups`;
    },

    /**
     * Fetches the list of automated backups from the Hub.
     */
    async getHubBackups() {
        const settings = await getSettings();
        const licenseKey = settings.licenseKey;
        if (!licenseKey) return [];

        const baseUrl = this.getHubApiUrl();
        if (!baseUrl) return [];

        try {
            const res = await fetch(`${baseUrl}?licenseKey=${licenseKey}`);
            if (!res.ok) throw new Error('Failed to fetch backups from hub');
            return await res.json();
        } catch (err) {
            console.error('[BackupService] getHubBackups failed:', err);
            return [];
        }
    },

    /**
     * Triggers a manual backup on the Hub.
     */
    async triggerHubBackup() {
        const settings = await getSettings();
        const licenseKey = settings.licenseKey;
        const baseUrl = this.getHubApiUrl();
        if (!baseUrl) throw new Error('Sync Hub is offline');

        const res = await fetch(`${baseUrl}/trigger`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ licenseKey })
        });

        if (!res.ok) throw new Error('Hub backup failed');
        return await res.json();
    },

    /**
     * Downloads a backup file from the Hub.
     */
    async downloadHubBackup(filename) {
        const baseUrl = this.getHubApiUrl();
        if (!baseUrl) throw new Error('Sync Hub is offline');

        const settings = await getSettings();
        const licenseKey = settings.licenseKey;
        const res = await fetch(`${baseUrl}/download/${filename}?licenseKey=${licenseKey}`);
        if (!res.ok) throw new Error('Download failed');

        const blob = await res.blob();

        // ─── Electron Mode (Choose Location) ──────────────────
        if (window.electronAPI?.showSaveDialog) {
            const { canceled, filePath } = await window.electronAPI.showSaveDialog({
                defaultPath: filename,
                filters: [{ name: 'JSON Backup', extensions: ['json'] }]
            });

            if (canceled || !filePath) return;

            const buffer = await blob.arrayBuffer();
            const result = await window.electronAPI.saveFileFromBuffer({ filePath, buffer });
            
            if (result.success) {
                if (window.showToast) window.showToast('Backup saved successfully! 📂', 'success');
            } else {
                throw new Error(result.error || 'Failed to save file');
            }
            return;
        }

        // ─── Web Mode (Default Download) ──────────────────────
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        if (window.showToast) window.showToast('Backup downloaded to default folder 📂', 'success');
    },

    /**
     * Restores data from a Hub backup.
     */
    async restoreHubBackup(filename, wipe = false) {
        const settings = await getSettings();
        const licenseKey = settings.licenseKey;
        const baseUrl = this.getHubApiUrl();
        if (!baseUrl) throw new Error('Sync Hub is offline');

        const res = await fetch(`${baseUrl}/restore`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ licenseKey, filename, wipe })
        });

        if (!res.ok) throw new Error('Restore failed');
        return await res.json();
    },

    /**
     * Updates automated backup settings on the Hub.
     */
    async updateHubSettings(backupSettings) {
        // Always save locally — this is the source of truth in standalone/Electron
        // mode, and the background server shares the same DB, so no separate
        // Hub API call is needed.
        const freshSettings = await getSettings();
        freshSettings.backupSettings = { ...freshSettings.backupSettings, ...backupSettings };
        await saveSettings(freshSettings);

        return { success: true };
    },

    /**
     * Imports data from a JSON backup file with integrity checks and stats.
     */
    async importBackup(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    
                    // 1. Checksum Verification (for new format)
                    if (data.checksum) {
                        const payloadStr = JSON.stringify(data.payload || data.stores);
                        const currentHash = await generateChecksum(payloadStr);
                        if (currentHash !== data.checksum) {
                            throw new Error('Backup integrity check failed! The file may be corrupted.');
                        }
                    }

                    // Support both new (wrapped in payload/stores) and legacy (root is payload) structures
                    const payload = data.payload || data.stores || data;

                    // All possible store names we might want to import
                    const storeMap = {};
                    Object.keys(KEYS).forEach(k => {
                        const base = k.toLowerCase();
                        storeMap[base] = KEYS[k]; // e.g. 'products' -> 'pos_products'
                    });

                    // Aggressive matching: Check every key in the payload
                    const availableKeys = Object.keys(payload);
                    let foundStores = [];
                    
                    // Case 1: Payload is an array (likely a direct export of a single store like products)
                    if (Array.isArray(payload)) {
                        const first = payload[0];
                        if (first && typeof first === 'object') {
                            // Heuristic: determine which store this might be
                            let targetStore = 'products';
                            if (first.total && first.items) targetStore = 'orders';
                            else if (first.phone && first.name) targetStore = 'customers';
                            
                            foundStores.push({ store: targetStore, data: payload });
                        }
                    } else {
                        // Case 2: Payload is an object (standard backup)
                        availableKeys.forEach(pKey => {
                            const normalizedPKey = pKey.toLowerCase().replace(/^pos_/, '');
                            const systemStore = Object.keys(storeMap).find(sKey => sKey === normalizedPKey);
                            
                            if (systemStore) {
                                const itemData = payload[pKey];
                                if (itemData) {
                                    const records = Array.isArray(itemData) ? itemData : [itemData];
                                    if (records.length > 0) {
                                        foundStores.push({ store: systemStore, data: records });
                                    }
                                }
                            }
                        });
                    }

                    if (foundStores.length === 0) {
                        const sampleKeys = availableKeys.slice(0, 5).join(', ');
                        console.error('[BackupService] No recognizable data found. Keys:', availableKeys);
                        throw new Error(`Invalid backup file: No recognizable POS data found. (Keys found: ${sampleKeys || 'None'})`);
                    }

                    // Prepare Stats for UI
                    const stats = foundStores.reduce((acc, entry) => {
                        acc[entry.store] = entry.data.length;
                        return acc;
                    }, {});

                    let count = 0;
                    for (const entry of foundStores) {
                        for (const record of entry.data) {
                            // Ensure the record has an ID to prevent database errors
                            if (record && (record.id || record.id === 0)) {
                                await updateData(entry.store, record, true); // Silent update for speed
                                count++;
                            }
                        }
                    }

                    // Save to import history
                    const history = await read(KEYS.IMPORT_HISTORY) || [];
                    history.push({
                        id: Date.now(),
                        date: new Date().toISOString(),
                        filename: file.name,
                        count: count,
                        stats: stats
                    });
                    if (history.length > 20) history.shift();
                    await write(KEYS.IMPORT_HISTORY, history);

                    resolve({ success: true, count, stats });
                } catch (err) {
                    console.error('[BackupService] Import failed:', err);
                    reject(err);
                }
            };
            reader.onerror = () => reject(new Error('Failed to read file.'));
            reader.readAsText(file);
        });
    },

    /**
     * Placeholder for cloud download (if metadata exists in history).
     */
    async downloadBackup(id) {
        const history = await read(KEYS.BACKUP_HISTORY) || [];
        const entry = history.find(h => h.id === id);
        if (!entry) throw new Error('Backup record not found.');
        
        // If data was stored locally (rare), trigger download
        if (entry.data) {
            const blob = new Blob([entry.data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = entry.filename || 'backup.json';
            a.click();
            URL.revokeObjectURL(url);
            return;
        }
        
        throw new Error('Backup data not available for local download. Please use Hub backups.');
    },

    /**
     * Enhanced Local Export for Electron
     */
    async exportBackup(dateLimit = null, autoSavePath = null) {
        const isElectron = /Electron/i.test(navigator.userAgent);
        const settings = await getSettings();
        const licenseKey = settings.licenseKey;
        const branchId = settings.branchId || 'b1';

        if (!licenseKey) throw new Error('No license key found.');

        const backupDate = new Date();
        const baseDate = dateLimit ? new Date(dateLimit) : backupDate;
        const expiryDate = new Date(baseDate);
        expiryDate.setDate(baseDate.getDate() + 7);

        const payload = {};
        const criticalStores = Object.keys(KEYS).map(k => k.toLowerCase());

        for (const store of criticalStores) {
            const key = KEYS[store.toUpperCase()];
            if (!key) continue;
            const items = await read(key);
            if (!items) continue;
            
            const records = Array.isArray(items) ? items : [items];
            const filtered = records.filter(item => {
                if (!item) return false;
                // Basic branch filter if applicable
                if (item.branchId && item.branchId !== branchId) return false;
                if (dateLimit) {
                    const limit = new Date(dateLimit);
                    limit.setHours(23, 59, 59, 999);
                    const itemDateStr = item.date || item.createdAt || item.updatedAt;
                    if (itemDateStr && new Date(itemDateStr) > limit) return false;
                }
                return true;
            });
            
            if (filtered.length > 0) {
                payload[store] = Array.isArray(items) ? filtered : filtered[0];
            }
        }

        const checksum = await generateChecksum(JSON.stringify(payload));

        const backupData = {
            version: '3.0',
            appVersion: '2.5.0',
            licenseKey,
            branchId,
            backupDate: backupDate.toISOString(),
            dateLimit: dateLimit ? new Date(dateLimit).toISOString() : null,
            expiryDate: expiryDate.toISOString(),
            checksum,
            payload
        };

        const jsonString = JSON.stringify(backupData, null, 2);
        const timestamp = backupDate.toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `POS_Backup_${branchId}_${timestamp}.json`;

        // ─── Electron Mode (Native Save) ──────────────────────
        if (isElectron && window.electronAPI) {
            let finalPath = autoSavePath;
            
            if (!finalPath) {
                const result = await window.electronAPI.showSaveDialog({
                    title: 'Save Premium Backup',
                    defaultPath: filename,
                    filters: [{ name: 'JSON Backup', extensions: ['json'] }]
                });
                if (result.canceled || !result.filePath) return { canceled: true };
                finalPath = result.filePath;
            }

            const saveRes = await window.electronAPI.saveFileFromBuffer({ filePath: finalPath, buffer: jsonString });
            if (!saveRes.success) throw new Error(saveRes.error || 'Failed to write file to disk.');

            // Add to history
            await this.recordHistory(backupDate, expiryDate, jsonString.length, finalPath, filename);
            return { success: true, path: finalPath };
        }

        // ─── Web Fallback ────────────────────────────────────
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);

        await this.recordHistory(backupDate, expiryDate, jsonString.length, 'Default Downloads', filename);
        return { success: true };
    },

    async recordHistory(date, expiry, size, path, filename) {
        const history = await read(KEYS.BACKUP_HISTORY) || [];
        history.push({
            id: Date.now(),
            date: date.toISOString(),
            expiry: expiry.toISOString(),
            size: size,
            path: path,
            filename: filename,
            type: 'local'
        });
        if (history.length > 30) history.shift();
        await write(KEYS.BACKUP_HISTORY, history);
    },

    /**
     * Automated Backup Trigger for Electron (Scheduling + Retention)
     */
    async runAutoBackup(isExiting = false) {
        const settings = await getSettings();
        const config = settings.backupSettings || {};
        
        if (!config.enabled) return;
        if (!config.customPath) return;

        const now = Date.now();
        const lastAuto = config.lastAutoBackup || 0;
        const interval = config.interval || 'onExit'; // hourly, daily, onExit
        const retentionDays = config.retentionDays || 7;

        let shouldRun = isExiting; // Always run on exit if enabled

        if (!shouldRun && interval === 'hourly') {
            if (now - lastAuto > 60 * 60 * 1000) shouldRun = true;
        } else if (!shouldRun && interval === 'daily') {
            if (now - lastAuto > 24 * 60 * 60 * 1000) shouldRun = true;
        }

        if (!shouldRun) return;

        console.log(`[BackupService] Triggering auto-backup (${interval})...`);
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const filename = `Auto_Backup_${timestamp}.json`;
            const filePath = `${config.customPath}/${filename}`;
            
            const result = await this.exportBackup(null, filePath);
            
            if (result && result.success) {
                // Update last backup time
                settings.backupSettings.lastAutoBackup = now;
                await saveSettings(settings);
                console.log('[BackupService] Auto-backup successful.');

                // Perform Retention Cleanup
                await this.performRetention(config.customPath, retentionDays);
            }
        } catch (err) {
            console.error('[BackupService] Auto-backup failed:', err);
        }
    },

    /**
     * Cleans up old backup files based on retention settings.
     */
    async performRetention(dirPath, days) {
        if (!window.electronAPI?.listBackups) return;
        
        console.log(`[BackupService] Cleaning up backups older than ${days} days...`);
        try {
            const backups = await window.electronAPI.listBackups(dirPath);
            const now = Date.now();
            const maxAge = days * 24 * 60 * 60 * 1000;

            for (const file of backups) {
                if (now - file.mtime > maxAge) {
                    console.log(`[BackupService] Deleting old backup: ${file.name}`);
                    await window.electronAPI.deleteFile(file.path);
                }
            }
        } catch (err) {
            console.warn('[BackupService] Retention cleanup failed:', err);
        }
    },

    cleanupHistory() {
        // No-op for now as we moved to server-side logic
    }
};
