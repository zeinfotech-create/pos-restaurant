export function getTopbarTrialBanner(status, settings) {
    // Only claim "Lifetime Offline Edition" once a real activation key has been
    // verified (window.syncEngine.isLifetimeActivated) — the router already blocks
    // all other pages until then, but this label must never lie if reached some
    // other way (e.g. cached banner render before a redirect completes).
    if (settings?.deploymentMode === 'standalone' && window.syncEngine?.isLifetimeActivated) {
        return `
          <div class="topbar-trial-banner" style="background: rgba(99, 102, 241, 0.05); border-color: rgba(99, 102, 241, 0.2);">
            <i class="fa-solid fa-house-laptop" style="color: var(--primary);"></i>
            <div class="banner-content" style="color: var(--primary);">
                <strong>ZeInfoTech POS:</strong> Lifetime Offline Edition
            </div>
          </div>
        `;
    }
    return '';
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
