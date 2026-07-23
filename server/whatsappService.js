const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');

class WhatsAppService {
    constructor() {
        this.client = null;
        this.status = 'disconnected';
        this.qr = '';
        this.sessionId = '';
        this.onStatusUpdateCallback = null;
    }

    async init(sessionId, onStatusUpdate) {
        // If already connected with same ID, just update callback and notify
        if (this.client && this.sessionId === sessionId && (this.status === 'ready' || this.status === 'authenticated')) {
            console.log(`[WhatsApp] Re-using active session: ${sessionId}`);
            this.onStatusUpdateCallback = onStatusUpdate;
            onStatusUpdate({ status: this.status, qr: this.qr, sessionId: this.sessionId });
            return;
        }

        if (this.client) {
            console.log(`[WhatsApp] Cleanup existing client for session: ${this.sessionId}`);
            try { 
                await this.client.destroy(); 
            } catch (e) {
                console.warn('[WhatsApp] Destroy failed (safe to ignore):', e.message);
            }
            this.client = null;
        }

        this.sessionId = sessionId;
        this.onStatusUpdateCallback = onStatusUpdate;
        this.status = 'initializing';
        onStatusUpdate({ status: this.status });

        console.log(`[WhatsApp] Initializing new client with sessionId: ${sessionId}`);

        this.client = new Client({
            authStrategy: new LocalAuth({ clientId: sessionId }),
            puppeteer: {
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
                headless: true
            }
        });

        this.client.on('qr', async (qr) => {
            console.log(`[WhatsApp] QR Received for ${this.sessionId}`);
            this.status = 'qr';
            this.qr = await qrcode.toDataURL(qr);
            onStatusUpdate({ status: this.status, qr: this.qr });
        });

        this.client.on('ready', () => {
            console.log(`[WhatsApp] Client is ready for ${this.sessionId}`);
            this.status = 'ready';
            this.qr = '';
            onStatusUpdate({ status: this.status });
        });

        this.client.on('authenticated', () => {
            console.log(`[WhatsApp] Authenticated for ${this.sessionId}`);
            this.status = 'authenticated';
            onStatusUpdate({ status: this.status });
        });

        this.client.on('auth_failure', (msg) => {
            console.error(`[WhatsApp] Auth failure for ${this.sessionId}:`, msg);
            this.status = 'disconnected';
            onStatusUpdate({ status: this.status, message: msg });
        });

        this.client.on('disconnected', (reason) => {
            console.log(`[WhatsApp] Client was logged out for ${this.sessionId}:`, reason);
            this.status = 'disconnected';
            this.qr = '';
            onStatusUpdate({ status: this.status, reason });
        });

        try {
            await this.client.initialize();
        } catch (err) {
            console.error(`[WhatsApp] Initialization error for ${this.sessionId}:`, err);
            this.status = 'disconnected';
            onStatusUpdate({ status: this.status, error: err.message });
        }
    }

    async sendMessage(to, text) {
        if (!this.client || (this.status !== 'ready' && this.status !== 'authenticated')) {
            console.warn(`[WhatsApp] Cannot send message: Client status is ${this.status}`);
            return false;
        }
        try {
            // Sanitization: Ensure phone starts with country code and has no special chars
            let cleanPhone = to.replace(/\D/g, '');
            if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;
            
            const chatId = cleanPhone.includes('@c.us') ? cleanPhone : `${cleanPhone}@c.us`;
            
            console.log(`[WhatsApp] Attempting send to: ${chatId}`);
            await this.client.sendMessage(chatId, text);
            console.log(`[WhatsApp] Message successfully sent to ${cleanPhone}`);
            return true;
        } catch (err) {
            console.error(`[WhatsApp] Send error to ${to}:`, err.message);
            
            // Critical Session Errors: Frame detached, Page closed, Socket closed, etc.
            // These indicate the Puppeteer browser instance is dead or unstable.
            const isSessionError = 
                err.message.includes('detached Frame') || 
                err.message.includes('Page closed') || 
                err.message.includes('Execution context was destroyed') ||
                err.message.includes('Protocol error');

            if (isSessionError) {
                console.error(`[WhatsApp] 🛑 CRITICAL SESSION ERROR detected: ${err.message}. Marking as disconnected.`);
                this.status = 'disconnected';
                if (this.onStatusUpdateCallback) {
                    this.onStatusUpdateCallback({ 
                        status: 'disconnected', 
                        message: 'Session became unstable and was disconnected. Please re-sync.' 
                    });
                }
                // Attempt cleanup
                try { this.client.destroy(); } catch (e) {}
                this.client = null;
            }

            return false;
        }
    }

    async logout() {
        if (this.client) {
            console.log(`[WhatsApp] Force logout/shutdown for session: ${this.sessionId}`);
            try {
                if (this.status === 'ready' || this.status === 'authenticated') {
                    await this.client.logout();
                }
                await this.client.destroy();
                this.client = null;
                this.status = 'disconnected';
                this.qr = '';
            } catch (e) {
                console.error(`[WhatsApp] Logout error:`, e.message);
            }
        }
    }

    getStatus() {
        return { status: this.status, qr: this.qr, sessionId: this.sessionId };
    }
}

module.exports = new WhatsAppService();
