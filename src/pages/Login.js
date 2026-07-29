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
            <i class="fa-solid fa-antigravity"></i>
          </div>
          <h1 class="hero-title">
            The Future of <span>Modern POS</span>
          </h1>
          <p class="hero-desc">
            Experience the next generation of business management. A sleek, powerful, 
            and intuitive platform designed to scale with your enterprise.
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
              <span class="hero-stat-value">24/7</span>
              <span class="hero-stat-label">Reliability</span>
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
                    Verify Account & Continue <i class="fa-solid fa-arrow-right-long ml-8"></i>
                  </button>
                </form>
              ` : ''}

              ${currentStep === 'branch' ? `
                <div class="anim-slide-up">
                  <div style="display:flex; flex-direction:column; gap:12px">
                    ${(() => {
          try {
            const limits = window.syncEngine?.getLimits() || { maxBranches: 1 };
            const allowedB = Array.isArray(cloudBranches) ? cloudBranches : [];
            return allowedB.map((b, idx) => {
              const bId = b.id || b.branchId || b._id;
              const restricted = idx >= limits.maxBranches;
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
          const branchRegs = (cloudRegisters || []).filter(r => (r.branchId || r.id) === bId).slice(0, limits.maxRegistersPerBranch);
          
          return `
          <div class="anim-slide-up">
                    <div style="display:flex; flex-direction:column; gap:12px">
                      ${branchRegs.map((r, idx) => {
                const rId = r.id || r.registerId || r._id;
                const restricted = idx >= limits.maxRegistersPerBranch;
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
              const currentSettings = await getSettings();
              const userLicenseKey = res.licenseKey || res.user?.licenseKey;
              if (userLicenseKey && !currentSettings.licenseKey) {
                updateSettings({
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
    }

    if (currentStep === 'register') {
      container.querySelectorAll('.register-option-btn').forEach(btn => {
        btn.onclick = () => {
          selectedRegisterId = btn.dataset.id;
          finalizeLogin();
        };
      });
      document.getElementById('backToBranchBtn').onclick = () => {
        currentStep = 'branch';
        selectedBranch = null;
        updateUI();
      };
      const finishBtn = document.getElementById('finishLoginBtn');
      if (finishBtn) {
        finishBtn.onclick = () => finalizeLogin();
      }
    }
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
      console.log('[Login] Redirecting to Dashboard and reloading...');
      window.location.hash = 'dashboard';
      window.location.reload();
    }, 1500);
  }

  // Pre-fetch limits if available
  const limits = window.syncEngine?.getLimits() || { maxBranches: 1 };

  // On page load, just render the credentials form
  updateUI();


}
