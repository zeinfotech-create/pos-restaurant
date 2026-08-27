import { setSession, clearStore, updateData, updateSettings, getSettings, getLoginActivity, getCurrentShift } from '../db.js';
import { showToast } from '../components/Toast.js';
import { escapeHtml } from '../utils/escapeHtml.js';

export function renderLogin(container) {
  let currentStep = 'credentials'; // 'credentials', 'branch', 'register'
  let authenticatedUser = null;
  let selectedBranch = null;
  let selectedRegisterId = null;

  // Cloud-fetched data — ONLY populated from verified user's license
  let cloudBranches = [];
  let cloudRegisters = [];
  let lastUsedBranchId = null; // This user's most recent branch, from login history
  let registerShiftStatus = {}; // { [registerId]: boolean } — open/closed, for the branch step

  // Wipe stale session data — but NOT in standalone/Electron mode (local stores are the source of truth)
  const isElectron = /Electron/i.test(navigator.userAgent);
  if (!isElectron) {
    clearStore('users');
    clearStore('branches');
    clearStore('registers');
  }

  // REMOVED: Aggressive window listeners that cause full-page re-renders and wipe inputs.
  function updateUI() {
    const limits = window.syncEngine?.getLimits() || { maxBranches: 1 };
    let allowedBranches = cloudBranches.slice(0, limits.maxBranches);

    container.innerHTML = `
    <div class="login-split-container">
      <!-- Hero Section (Left) -->
      <div class="login-hero-section">
        <div class="hero-branding anim-slide-up">
          <div class="hero-logo-box">
            <svg viewBox="18 8 208 220" width="60%" height="60%" xmlns="http://www.w3.org/2000/svg">
              <defs><linearGradient id="loginHeroLogoG" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FDFEFF"/><stop offset="0.6" stop-color="#F1F4FE"/><stop offset="1" stop-color="#D9E1F9"/></linearGradient></defs>
              <path d="M32 46 C 32 32, 42 22, 56 22 L 188 22 C 202 22, 212 32, 212 46 L 212 214 L 201 201 L 190 214 L 179 201 L 168 214 L 157 201 L 146 214 L 135 201 L 124 214 L 113 201 L 102 214 L 91 201 L 80 214 L 69 201 L 58 214 L 47 201 L 32 214 Z" fill="url(#loginHeroLogoG)"/>
              <g transform="translate(92.8,88) scale(0.6) translate(-182,-164)"><path d="M136 108 C 130 108, 126 112, 126 118 C 126 124, 130 128, 136 128 L 202 128 C 190 140, 168 158, 148 176 C 132 190, 124 198, 124 210 C 124 216, 128 220, 134 220 L 226 220 C 232 220, 236 216, 236 210 C 236 204, 232 200, 226 200 L 160 200 C 172 188, 194 170, 214 152 C 230 138, 238 130, 238 118 C 238 112, 234 108, 228 108 Z" fill="#26339E" stroke="#26339E" stroke-width="4" stroke-linejoin="round"/></g>
              <rect x="58" y="146" width="128" height="10" rx="5" fill="#9AA3EF"/><rect x="58" y="162" width="98" height="10" rx="5" fill="#C4CAF6"/><rect x="58" y="178" width="112" height="10" rx="5" fill="#9AA3EF"/>
            </svg>
          </div>
          <h1 class="hero-title">
            Your internet goes down.<span>Your sales don't.</span>
          </h1>
          <p class="hero-desc">
            ZeInfoTech POS keeps billing, inventory, and GST compliance running — online or off.
            Built for multi-branch retail that can't afford downtime.
          </p>

          <div class="hero-stats">
            <div class="hero-stat-item">
              <span class="hero-stat-value">100%</span>
              <span class="hero-stat-label">Offline Ready</span>
            </div>
            <div class="hero-stat-item">
              <span class="hero-stat-value">256-bit</span>
              <span class="hero-stat-label">Secure</span>
            </div>
            <div class="hero-stat-item">
              <span class="hero-stat-value">22</span>
              <span class="hero-stat-label">Modules</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Form Section (Right) -->
      <div class="login-form-section">
        <div class="login-form-wrapper">
          <div class="login-card-premium">
            <div class="login-form-header">
              <h2 class="login-form-title">
                ${currentStep === 'credentials' ? 'Sign In' : ''}
                ${currentStep === 'branch' ? 'Select Branch' : ''}
                ${currentStep === 'register' ? 'Select Register' : ''}
              </h2>
              <p class="login-form-subtitle">
                ${currentStep === 'credentials' ? 'Welcome back! Please enter your details.' : ''}
                ${currentStep === 'branch' ? `Select branch for <b>${escapeHtml(authenticatedUser.name)}</b>` : ''}
                ${currentStep === 'register' ? `Select register for <b>${escapeHtml(selectedBranch.name)}</b>` : ''}
              </p>
            </div>

            <div id="loginStepContent">
              ${currentStep === 'credentials' ? `
                <form id="credentialForm">
                  <div class="premium-input-group">
                    <label class="premium-label">Phone Number</label>
                    <div class="premium-input-wrap">
                      <i class="fa-solid fa-phone"></i>
                      <input type="tel" class="premium-input" id="loginUsername" placeholder="Enter your phone number" required />
                    </div>
                  </div>
                  <div class="premium-input-group">
                    <label class="premium-label">Password</label>
                    <div class="premium-input-wrap">
                      <i class="fa-solid fa-shield-halved"></i>
                      <input type="password" class="premium-input" id="loginPass" placeholder="••••••••" required />
                    </div>
                  </div>
                  <button type="submit" class="btn btn-primary w-full btn-lg mt-8" style="height: 56px; border-radius: 16px;">
                    Login <i class="fa-solid fa-arrow-right-long ml-8"></i>
                  </button>
                </form>
              ` : ''}

              ${currentStep === 'branch' ? `
                <div class="anim-slide-up">
                  <div style="display:flex; flex-direction:column; gap:12px">
                    ${(() => {
          try {
            const limits = window.syncEngine?.getLimits() || { maxBranches: 1 };
            // Master/Super Admin is the system owner account — the same
            // exemption already applied to the staff-seat quota (Users.js)
            // and the "must pick at least one branch" requirement — must
            // never be capped by the plan's branch quota either. Without
            // this, the owner's own account could get locked out of
            // branches they created themselves the moment the branch count
            // passed whatever the current plan allows.
            const isFullAccessUser = authenticatedUser?.role === 'Master' || authenticatedUser?.role === 'Super Admin' || authenticatedUser?.role === 'Admin';
            // Staff/Manager/Custom only ever see the branches explicitly
            // assigned to them in Users.js's "Authorized Branches" picker —
            // this used to show every branch on the license (with unassigned
            // ones just visually greyed out as "PREMIUM ONLY", a plan-tier
            // label that had nothing to do with why they were actually
            // blocked here: assignment, not plan capacity). An empty/missing
            // branchIds means "All" everywhere else in the app (Users.js's
            // own branchString fallback), so mirror that here too.
            const myBranchIds = authenticatedUser?.branchIds || [];
            const allowedB = (Array.isArray(cloudBranches) ? cloudBranches : []).filter(b => {
              if (isFullAccessUser || myBranchIds.length === 0) return true;
              const bId = b.id || b.branchId || b._id;
              return myBranchIds.includes(bId);
            });
            return allowedB.map((b, idx) => {
              const bId = b.id || b.branchId || b._id;
              const restricted = !isFullAccessUser && idx >= limits.maxBranches;
              const isLastUsed = lastUsedBranchId && bId === lastUsedBranchId;
              return `
                        <button class="btn btn-ghost branch-option-btn" data-id="${bId}" ${restricted ? 'data-restricted="true" disabled' : ''}
                          style="justify-content:flex-start; height:64px; padding:0 24px; border-radius: 16px; background: #f8f9fa; border: 1px solid ${isLastUsed ? '#1a73e8' : '#dadce0'}; ${restricted ? 'opacity:0.5; cursor:not-allowed' : ''}">
                          <div style="width:36px; height:36px; border-radius:10px; font-size:16px; margin:0 16px 0 0; background:${restricted ? '#dadce0' : 'linear-gradient(135deg, #1a73e8, #174ea6)'}; color:#fff; display:flex; align-items:center; justify-content:center;">
                            <i class="fa-solid fa-store"></i>
                          </div>
                          <div style="flex:1; text-align:left">
                            <div class="font-bold" style="color:#202124">
                              ${escapeHtml(b.name || 'Unnamed Branch')}
                              ${isLastUsed ? '<span style="font-size:9px; background:rgba(26,115,232,0.12); color:#1a73e8; padding:2px 6px; border-radius:4px; font-weight:700; margin-left:8px">LAST USED</span>' : ''}
                              ${restricted ? '<span style="font-size:9px; background:var(--warning); color:black; padding:2px 6px; border-radius:4px; font-weight:700; margin-left:8px">PREMIUM ONLY</span>' : ''}
                            </div>
                            <div style="font-size:11px; color:#5f6368">${escapeHtml(b.address || '')}</div>
                          </div>
                        </button>
                      `;
            }).join('');
          } catch(e) { console.error('Branch Render Error:', e); return '<p>Error loading branches</p>'; }
        })()}
                  </div>
                  <button type="button" class="btn btn-ghost w-full mt-24" id="backToCredBtn">
                    <i class="fa-solid fa-arrow-left-long mr-8"></i> Back to Login
                  </button>
                </div>
              ` : ''}

              ${currentStep === 'register' ? (() => {
        try {
          const limits = window.syncEngine?.getLimits() || { maxRegistersPerBranch: 1 };
          const bId = selectedBranch?.id || selectedBranch?.branchId || selectedBranch?._id;
          // Same Master/Super Admin exemption as the branch step above — the
          // owner's own account must see every register they created, not
          // just however many the current plan's per-branch quota allows.
          const isFullAccessUser = authenticatedUser?.role === 'Master' || authenticatedUser?.role === 'Super Admin';
          const allBranchRegs = (cloudRegisters || []).filter(r => (r.branchId || r.id) === bId);
          const branchRegs = isFullAccessUser ? allBranchRegs : allBranchRegs.slice(0, limits.maxRegistersPerBranch);

          return `
          <div class="anim-slide-up">
                    <div style="display:flex; flex-direction:column; gap:12px">
                      ${branchRegs.map((r, idx) => {
                const rId = r.id || r.registerId || r._id;
                const restricted = !isFullAccessUser && idx >= limits.maxRegistersPerBranch;
                const isOpen = !!registerShiftStatus[rId];
                return `
                        <button class="btn btn-ghost register-option-btn" data-id="${rId}" ${restricted ? 'data-restricted="true" disabled' : ''}
                          style="justify-content:flex-start; height:60px; padding:0 24px; border-radius: 16px; background: #f8f9fa; border: 1px solid #dadce0; ${restricted ? 'opacity:0.5; cursor:not-allowed' : ''}">
                          <div style="width:32px; height:32px; border-radius:10px; font-size:14px; margin:0 16px 0 0; background:${restricted ? '#dadce0' : 'linear-gradient(135deg, #34a853, #1e8e3e)'}; color:#fff; display:flex; align-items:center; justify-content:center;">
                            <i class="fa-solid fa-cash-register"></i>
                          </div>
                          <div style="flex:1; text-align:left">
                            <div class="font-bold" style="color:#202124">
                              ${escapeHtml(r.name || 'Unnamed Register')}
                            </div>
                            <div style="font-size:11px; color:${isOpen ? '#1e8e3e' : '#9aa0a6'}; font-weight:600">
                              ${isOpen ? '● Shift Open' : 'Shift Closed'}
                            </div>
                          </div>
                        </button>
                      `;
              }).join('')}
                      ${branchRegs.length === 0 ? '<p style="text-align:center; padding:32px; color:#5f6368; font-style:italic">No active registers found.</p>' : ''}
                    </div>
                    <button type="button" class="btn btn-ghost w-full mt-24" id="backToBranchBtn">
                      <i class="fa-solid fa-arrow-left-long mr-8"></i> Back to Branches
                    </button>
                  </div>
          `;
        } catch(e) { console.error('Register Render Error:', e); return '<p>Error loading registers</p>'; }
      })() : ''}
            </div>

            <div class="login-action-area">
              <p style="color: #9aa0a6; font-size: 11px; margin-top: 24px;">© 2026 pos-lite</p>
            </div>
          </div>
        </div>
      </div>
    </div>
    `;

    // Event Listeners
    if (currentStep === 'credentials') {
      document.getElementById('credentialForm').onsubmit = (e) => {
        e.preventDefault();
        const username = document.getElementById('loginUsername').value.trim();
        const pass = document.getElementById('loginPass').value;

        if (!username || !pass) { showToast('Please enter email and password', 'error'); return; }

        // Show loading overlay while verifying
        showLoginLoading();

        const doLogin = async () => {
          try {
            // If not connected, force a quick connect attempt
            if (window.syncEngine && !window.syncEngine.isConnected) {
              window.syncEngine.connect();
              await new Promise(r => setTimeout(r, 1500));
            }

            const res = await window.syncEngine.verifyCredentials(username, pass);

            if (res.success && res.user) {
              authenticatedUser = res.user;
              cloudBranches = res.branches || [];
              cloudRegisters = res.registers || [];
              for (const b of cloudBranches) updateData('branches', b, true);
              for (const r of cloudRegisters) updateData('registers', r, true);
              // This device's licenseKey is fixed once at install time
              // (completeInstallation) so every store partitions under one
              // key for the life of this install — only adopt a login
              // response's key when this device genuinely has none yet.
              // Unconditionally trusting it here previously let a stale/
              // mismatched value on the login response silently fragment
              // this same install's data across multiple MongoDB "tenants".
              // 'LOCAL_EXE' is additionally excluded even when this device
              // has no key yet — it's the hub's own internal tenant tag for
              // not-yet-onboarded standalone installs (server/index.js's
              // /api/standalone-register hardcodes it), never a real
              // per-device identity. Adopting it here permanently stuck this
              // device's settings.licenseKey on the placeholder, which then
              // made every later lifetime-activation attempt look like it
              // was coming from a device that had never finished onboarding.
              const currentSettings = await getSettings();
              const userLicenseKey = res.licenseKey || res.user?.licenseKey;
              if (userLicenseKey && userLicenseKey !== 'LOCAL_EXE' && !currentSettings.licenseKey) {
                // MUST be awaited — a device with only one branch auto-skips
                // the branch-picker step (see below) straight to
                // finalizeLogin(), which can reach the 1.5s reload timer
                // almost immediately. This write firing-and-forgetting
                // raced that reload on a fresh device (a phone hitting
                // kd/kitchen-display with no prior local settings at all):
                // the reload's init() read whatever was in IndexedDB
                // BEFORE this write actually landed, still saw no
                // licenseKey, and registered its WebSocket connection under
                // the 'LOCAL_EXE' placeholder tenant forever — a real
                // shop's data, sent from a device that HAS the correct key
                // (the main POS), never reaching a Kitchen Display stuck
                // registered under the wrong tenant.
                await updateSettings({
                  licenseKey: userLicenseKey,
                  networkId: res.networkId || userLicenseKey
                });
              }

              // Find this user's most recent branch from login history, to
              // badge it as "Last Used" on the branch-picker step.
              try {
                const activity = await getLoginActivity();
                const lastEntry = activity.find(a => a.userId === authenticatedUser.id && a.branchId);
                lastUsedBranchId = lastEntry?.branchId || null;
              } catch (e) {
                console.warn('[Login] Could not load last-used branch:', e);
              }

              currentStep = 'branch';
              hideLoginLoading();
              updateUI();
            } else {
              hideLoginLoading();
              showToast(res.message || 'Verification Failed. Check your connection.', 'error');
            }
          } catch (err) {
            console.error('[Login] verifyCredentials error:', err);
            hideLoginLoading();
          }
        };

        doLogin();
      };
    }

    if (currentStep === 'branch') {
      container.querySelectorAll('.branch-option-btn').forEach(btn => {
        btn.onclick = async () => {
          const bId = btn.dataset.id;
          console.log('[Login] Selecting Branch:', bId);
          selectedBranch = cloudBranches.find(b => (b.id || b.branchId || b._id?.toString()) === bId);
          console.log('[Login] Selected Branch Data:', selectedBranch);
          if (!selectedBranch) {
            showToast('Branch data missing. Try logging in again.', 'error');
            return;
          }

          // Auto-skip register screen if no registers are configured for this branch
          const limits = window.syncEngine?.getLimits() || { maxRegistersPerBranch: 1 };
          const bIdStr = selectedBranch.id || selectedBranch.branchId || selectedBranch._id;
          const branchRegs = (cloudRegisters || []).filter(r => (r.branchId || r.id) === bIdStr).slice(0, limits.maxRegistersPerBranch);

          if (branchRegs.length === 0) {
            console.log('[Login] No registers found for this branch. Auto-skipping to dashboard.');
            selectedRegisterId = null;
            finalizeLogin();
            return;
          }

          // Look up each register's current shift status so the picker can
          // show "Shift Open"/"Shift Closed" instead of just a bare name.
          registerShiftStatus = {};
          try {
            await Promise.all(branchRegs.map(async (r) => {
              const rId = r.id || r.registerId || r._id;
              const shift = await getCurrentShift(bIdStr, rId);
              registerShiftStatus[rId] = !!shift;
            }));
          } catch (e) {
            console.warn('[Login] Could not load register shift status:', e);
          }

          currentStep = 'register';
          updateUI();
        };
      });
      document.getElementById('backToCredBtn').onclick = () => {
        currentStep = 'credentials';
        authenticatedUser = null;
        updateUI();
      };
      setupOptionKeyNav('.branch-option-btn');
    }

    if (currentStep === 'register') {
      container.querySelectorAll('.register-option-btn').forEach(btn => {
        btn.onclick = async () => {
          const rId = btn.dataset.id;
          const reg = cloudRegisters.find(r => (r.id || r.registerId || r._id) === rId);
          selectedRegisterId = rId;
          await attemptFinalize(rId, reg?.name);
        };
      });
      document.getElementById('backToBranchBtn').onclick = () => {
        currentStep = 'branch';
        selectedBranch = null;
        updateUI();
      };
      const finishBtn = document.getElementById('finishLoginBtn');
      if (finishBtn) {
        finishBtn.onclick = () => attemptFinalize(selectedRegisterId);
      }
      setupOptionKeyNav('.register-option-btn');
    }
  }

  // Arrow Up/Down moves focus between the (non-disabled) branch/register
  // buttons for this step; Enter then fires the focused button's own click
  // handler via the browser's native "Enter activates the focused button"
  // behavior — no separate Enter handling needed.
  let optionKeyNavHandler = null;
  function setupOptionKeyNav(selector) {
    // container is reused across every updateUI() re-render in this login
    // session — without removing the previous step's listener first, going
    // back and forth between steps would stack up duplicate handlers and
    // move focus multiple slots per arrow press.
    if (optionKeyNavHandler) container.removeEventListener('keydown', optionKeyNavHandler);

    const btns = Array.from(container.querySelectorAll(selector)).filter(b => !b.disabled);
    if (btns.length === 0) return;

    const startBtn = btns.find(b => b.textContent.includes('LAST USED') || b.textContent.includes('CURRENT')) || btns[0];
    let idx = btns.indexOf(startBtn);
    startBtn.focus();

    optionKeyNavHandler = (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      idx = e.key === 'ArrowDown' ? (idx + 1) % btns.length : (idx - 1 + btns.length) % btns.length;
      btns[idx].focus();
    };
    container.addEventListener('keydown', optionKeyNavHandler);
  }

  // Guards finalizeLogin() with a one-register-at-a-time check for this user
  // (see syncEngine.checkActiveSession) so a rejected login never touches the
  // register that's already active elsewhere.
  async function attemptFinalize(registerId, registerName) {
    if (registerId) {
      showLoginLoading();
      const bIdStr = selectedBranch?.id || selectedBranch?.branchId || selectedBranch?._id;
      const check = await window.syncEngine?.checkActiveSession(
        authenticatedUser.id, registerId, registerName, bIdStr, selectedBranch?.name
      ) || { allowed: true };
      if (!check.allowed) {
        hideLoginLoading();
        showToast(check.message || 'This user is already logged in on another register.', 'error');
        return;
      }
    }
    finalizeLogin();
  }

  function showLoginLoading() {
    let overlay = document.getElementById('login-loading-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'login-loading-overlay';
      overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;display:flex;justify-content:center;align-items:center;background:rgba(0,0,0,0.65);z-index:10000;';
      overlay.innerHTML = `<div style="text-align:center;color:#fff;">
        <i class="fa-solid fa-spinner fa-spin" style="font-size:52px;margin-bottom:16px;display:block;"></i>
        <div style="font-size:18px;font-weight:600;letter-spacing:0.5px;">Logging in…</div>
      </div>`;
      document.body.appendChild(overlay);
    }
  }

  function hideLoginLoading() {
    const overlay = document.getElementById('login-loading-overlay');
    if (overlay) overlay.remove();
  }

  function finalizeLogin() {
    console.log('[Login] Finalizing login process...');
    console.log('[Login] User:', authenticatedUser);
    console.log('[Login] Branch:', selectedBranch);
    const loginAt = new Date().toISOString();
    // Save session with login timestamp for session-based filtering
    import('../db.js').then(async ({ saveSession, saveLoginActivity }) => {
      await saveSession({
        user: authenticatedUser,
        branch: selectedBranch,
        registerId: selectedRegisterId,
        loginAt,
        sessionId: 'LA-' + Date.now()
      });
      // Notify the hub for the server-side Login Activity & System Audit report —
      // fired here (not at verifyCredentials() time) so registerId is already known
      // and getSystemDetails() can resolve the real register/counter name.
      if (window.syncEngine?.notifyLoginActivity) {
        window.syncEngine.notifyLoginActivity(authenticatedUser);
      }
      // Record login activity entry
      await saveLoginActivity({
        id: 'LA-' + Date.now(),
        userId: authenticatedUser.id,
        userName: authenticatedUser.name,
        userRole: authenticatedUser.role,
        branchId: selectedBranch?.id || null,
        branchName: selectedBranch?.name || null,
        loginAt,
        logoutAt: null,
        status: 'active'
      });
    });
    showLoginLoading();
    setTimeout(() => {
      // A non-Electron client that got bounced here from the locked-down
      // kd/kitchen-display entry point (see router.js's
      // lockOutNonKitchenAccess()) needs to land back there, not on a
      // dashboard it isn't allowed to reach — see the matching
      // sessionStorage write in router.js's RBAC redirect-to-login path.
      const postLoginRedirect = sessionStorage.getItem('rpos_post_login_redirect');
      if (postLoginRedirect) sessionStorage.removeItem('rpos_post_login_redirect');
      const destination = postLoginRedirect || 'dashboard';
      console.log(`[Login] Redirecting to ${destination} and reloading...`);
      window.location.hash = destination;
      window.location.reload();
    }, 1500);
  }

  // Pre-fetch limits if available
  const limits = window.syncEngine?.getLimits() || { maxBranches: 1 };

  // On page load, just render the credentials form
  updateUI();


}
