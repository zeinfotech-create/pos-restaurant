// A different, correctly-worded overlay for the device-limit case — reuses
// the same .lock-overlay/.lock-card visual language as showSuspendedOverlay
// (below) for consistency, but with its own copy: this isn't a billing/
// suspension problem, it's a capacity one (this shop already has its max
// allowed devices connected), so it gets its own amber/warning color
// rather than red, and no "contact support to reactivate" framing that
// would misleadingly imply something is wrong with the account itself.
export function showDeviceLimitOverlay(reason) {
    if (document.getElementById('device-limit-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'device-limit-overlay';
    overlay.className = 'lock-overlay anim-fade-in';
    overlay.style.zIndex = '10000';

    overlay.innerHTML = `
        <div class="lock-card anim-slide-up" style="max-width: 450px; text-align: center; border-top: 4px solid #f59e0b;">
            <div class="lock-header">
                <div class="lock-icon" style="background: rgba(245, 158, 11, 0.1); color: #f59e0b;">
                    <i class="fa-solid fa-display"></i>
                </div>
                <h2 style="color: #f59e0b; margin-bottom: 12px;">Device Limit Reached</h2>
                <p style="font-size: 14px; line-height: 1.6; color: var(--text-muted);">
                    ${reason || 'This shop already has the maximum number of devices connected.'}
                </p>
            </div>

            <div style="margin: 24px 0; padding: 16px; background: rgba(245, 158, 11, 0.05); border-radius: 12px; border: 1px dashed rgba(245, 158, 11, 0.2);">
                <p style="font-size: 13px; color: var(--text-main);">
                    Close the app on one of the other connected devices, then retry — or contact Zeinfotech Support to raise this shop's device limit.
                </p>
            </div>

            <div style="display: flex; flex-direction: column; gap: 12px;">
                <button class="btn btn-primary w-full" onclick="window.location.reload()">
                    <i class="fa-solid fa-rotate-right mr-8"></i> Retry Connection
                </button>
            </div>
        </div>
    `;

    if (!document.getElementById('lock-overlay-css')) {
        const style = document.createElement('style');
        style.id = 'lock-overlay-css';
        style.innerHTML = `
            .lock-overlay { position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(15,23,42,0.9); display:flex; align-items:center; justify-content:center; backdrop-filter:blur(8px); }
            .lock-card { background:var(--bg-card); padding:40px; border-radius:24px; box-shadow:0 25px 50px -12px rgba(0,0,0,0.5); width:90%; position:relative; }
            .lock-icon { width:64px; height:64px; border-radius:16px; display:flex; align-items:center; justify-content:center; font-size:24px; margin:0 auto 20px; }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(overlay);
}

// A third sibling to showSuspendedOverlay/showDeviceLimitOverlay below —
// same visual language, this time for a device someone deliberately
// disconnected from Settings' device-management panel on ANOTHER device.
// Neutral blue, not red/amber: nothing is wrong with this device or the
// account, it was just intentionally freed up.
export function showManualDisconnectOverlay(reason) {
    if (document.getElementById('manual-disconnect-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'manual-disconnect-overlay';
    overlay.className = 'lock-overlay anim-fade-in';
    overlay.style.zIndex = '10000';

    overlay.innerHTML = `
        <div class="lock-card anim-slide-up" style="max-width: 450px; text-align: center; border-top: 4px solid #3b82f6;">
            <div class="lock-header">
                <div class="lock-icon" style="background: rgba(59, 130, 246, 0.1); color: #3b82f6;">
                    <i class="fa-solid fa-plug-circle-xmark"></i>
                </div>
                <h2 style="color: #3b82f6; margin-bottom: 12px;">Disconnected</h2>
                <p style="font-size: 14px; line-height: 1.6; color: var(--text-muted);">
                    ${reason || 'This device was disconnected from Settings on another device.'}
                </p>
            </div>

            <div style="display: flex; flex-direction: column; gap: 12px;">
                <button class="btn btn-primary w-full" onclick="window.location.reload()">
                    <i class="fa-solid fa-rotate-right mr-8"></i> Reconnect
                </button>
            </div>
        </div>
    `;

    if (!document.getElementById('lock-overlay-css')) {
        const style = document.createElement('style');
        style.id = 'lock-overlay-css';
        style.innerHTML = `
            .lock-overlay { position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(15,23,42,0.9); display:flex; align-items:center; justify-content:center; backdrop-filter:blur(8px); }
            .lock-card { background:var(--bg-card); padding:40px; border-radius:24px; box-shadow:0 25px 50px -12px rgba(0,0,0,0.5); width:90%; position:relative; }
            .lock-icon { width:64px; height:64px; border-radius:16px; display:flex; align-items:center; justify-content:center; font-size:24px; margin:0 auto 20px; }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(overlay);
}

export function showSuspendedOverlay(reason) {
    if (document.getElementById('account-suspended-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'account-suspended-overlay';
    overlay.className = 'lock-overlay anim-fade-in';
    overlay.style.zIndex = '10000';

    overlay.innerHTML = `
        <div class="lock-card anim-slide-up" style="max-width: 450px; text-align: center; border-top: 4px solid #ef4444;">
            <div class="lock-header">
                <div class="lock-icon" style="background: rgba(239, 68, 68, 0.1); color: #ef4444;">
                    <i class="fa-solid fa-lock-keyhole"></i>
                </div>
                <h2 style="color: #ef4444; margin-bottom: 12px;">Account Suspended</h2>
                <p style="font-size: 14px; line-height: 1.6; color: var(--text-muted);">
                    ${reason || 'Your account has been suspended by the administrator. All POS operations have been disabled.'}
                </p>
            </div>

            <div style="margin: 24px 0; padding: 16px; background: rgba(239, 68, 68, 0.05); border-radius: 12px; border: 1px dashed rgba(239, 68, 68, 0.2);">
                <p style="font-size: 13px; color: var(--text-main);">
                    Please contact Zeinfotech Support to reactivate your account.
                </p>
            </div>

            <div style="display: flex; flex-direction: column; gap: 12px;">
                <button class="btn btn-primary w-full" onclick="window.location.reload()">
                    <i class="fa-solid fa-rotate-right mr-8"></i> Retry Connection
                </button>
                <button class="btn btn-ghost w-full" onclick="window.logout()">
                    <i class="fa-solid fa-right-from-bracket mr-8"></i> Logout Session
                </button>
            </div>
        </div>
    `;

    // Ensure we have CSS for lock-overlay if not already there
    if (!document.getElementById('lock-overlay-css')) {
        const style = document.createElement('style');
        style.id = 'lock-overlay-css';
        style.innerHTML = `
            .lock-overlay { position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(15,23,42,0.9); display:flex; align-items:center; justify-content:center; backdrop-filter:blur(8px); }
            .lock-card { background:var(--bg-card); padding:40px; border-radius:24px; box-shadow:0 25px 50px -12px rgba(0,0,0,0.5); width:90%; position:relative; }
            .lock-icon { width:64px; height:64px; border-radius:16px; display:flex; align-items:center; justify-content:center; font-size:24px; margin:0 auto 20px; }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(overlay);
}
