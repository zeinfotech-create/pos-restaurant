import { getSettings, getCurrentUser, getUsers, KEYS, read, write, verifyPassword } from '../db.js';
import { showToast } from '../components/Toast.js';

let isLocked = false;
let unlockCallback = null;

// Brute-force throttle for PIN entry screens — neither the staff-PIN
// unlock, its phone-recovery fallback, nor promptModuleLock() had ANY
// limit on repeated guesses (plain === comparisons, unlimited attempts).
// Not persisted across a restart — quitting/relaunching Electron is
// already real friction on a physical till — but stops a same-session
// rapid-guess attempt against a 4-6 digit PIN.
const pinAttemptState = new Map(); // key -> { fails, lockedUntil }
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCKOUT_MS = 30000;

function checkPinRateLimit(key) {
    const state = pinAttemptState.get(key);
    if (state?.lockedUntil && Date.now() < state.lockedUntil) {
        return { locked: true, remainingSec: Math.ceil((state.lockedUntil - Date.now()) / 1000) };
    }
    return { locked: false };
}

function recordPinFailure(key) {
    const state = pinAttemptState.get(key) || { fails: 0, lockedUntil: 0 };
    state.fails += 1;
    if (state.fails >= PIN_MAX_ATTEMPTS) {
        state.lockedUntil = Date.now() + PIN_LOCKOUT_MS;
        state.fails = 0;
    }
    pinAttemptState.set(key, state);
}

function clearPinAttempts(key) {
    pinAttemptState.delete(key);
}

export async function lockApp(callback = null) {
    if (isLocked) return;
    isLocked = true;
    write(KEYS.IS_LOCKED, true);
    unlockCallback = callback;

    const settings = await getSettings('global_settings');

    const lockOverlay = document.createElement('div');
    lockOverlay.id = 'app-lock-overlay';
    lockOverlay.className = 'lock-overlay anim-fade-in';

    lockOverlay.innerHTML = `
    <div class="lock-card anim-slide-up">
      <div class="lock-header" id="lockHeader">
        <div class="lock-icon"><i class="fa-solid fa-lock"></i></div>
        <h2 id="lockTitle">System Locked</h2>
        <p id="lockSubtitle">Enter PIN to continue</p>
      </div>

      <div class="pin-display">
        <div class="pin-dot" id="dot-0"></div>
        <div class="pin-dot" id="dot-1"></div>
        <div class="pin-dot" id="dot-2"></div>
        <div class="pin-dot" id="dot-3"></div>
        <div class="pin-dot" id="dot-4" style="display:none"></div>
        <div class="pin-dot" id="dot-5" style="display:none"></div>
        <div class="pin-dot" id="dot-6" style="display:none"></div>
        <div class="pin-dot" id="dot-7" style="display:none"></div>
        <div class="pin-dot" id="dot-8" style="display:none"></div>
        <div class="pin-dot" id="dot-9" style="display:none"></div>
      </div>

      <div class="pin-pad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => `
          <button class="pin-btn" data-value="${num}">${num}</button>
        `).join('')}
        <button class="pin-btn text-danger" id="pinClear">C</button>
        <button class="pin-btn" data-value="0">0</button>
        <button class="pin-btn text-primary" id="pinBack"><i class="fa-solid fa-arrow-left"></i></button>
      </div>

      <div class="lock-footer">
        <button class="btn btn-ghost btn-sm" id="forgotPinBtn">
          <i class="fa-solid fa-phone mr-8"></i> Forgot PIN? Use Phone Number
        </button>
        <button class="btn btn-ghost btn-sm" id="lockLogoutBtn">
          <i class="fa-solid fa-right-from-bracket mr-8"></i> Logout Session
        </button>
      </div>
    </div>
  `;

    document.body.appendChild(lockOverlay);

    let currentPin = '';
    // 'pin' = normal staff PIN unlock; 'recovery' = forgot-PIN fallback that
    // unlocks with the account's registered phone number (used as username
    // for standalone/Electron logins) instead — a low-friction escape hatch
    // since there's otherwise no way back in if the PIN is forgotten besides
    // logging out entirely.
    let mode = 'pin';
    const maxDigitsFor = () => mode === 'recovery' ? 10 : 6;

    const updateDots = () => {
        const neededDots = Math.max(4, currentPin.length);
        const display = lockOverlay.querySelector('.pin-display');
        if (display) display.style.gap = neededDots > 6 ? '8px' : '16px';
        for (let i = 0; i < 10; i++) {
            const dot = document.getElementById(`dot-${i}`);
            if (dot) {
                dot.style.display = i < neededDots ? 'block' : 'none';
                dot.classList.toggle('active', i < currentPin.length);
            }
        }
    };

    updateDots();

    const checkPin = async () => {
        const rateLimitKey = mode === 'recovery' ? 'app-lock-recovery' : 'app-lock-pin';
        const rateLimit = checkPinRateLimit(rateLimitKey);
        if (rateLimit.locked) {
            currentPin = '';
            updateDots();
            window.showToast(`Too many attempts. Try again in ${rateLimit.remainingSec}s.`, 'error');
            return;
        }

        const sessionUser = await getCurrentUser();
        const allUsers = await getUsers();
        const freshUser = allUsers.find(u => u.id === sessionUser?.id);

        if (mode === 'recovery') {
            const normalize = (v) => (v || '').replace(/\D/g, '');
            const isPhoneValid = freshUser && normalize(currentPin) === normalize(freshUser.username || freshUser.name);
            if (isPhoneValid) {
                clearPinAttempts(rateLimitKey);
                unlockApp();
                return;
            }
            if (currentPin.length >= 10) {
                recordPinFailure(rateLimitKey);
                currentPin = '';
                updateDots();
                const card = lockOverlay.querySelector('.lock-card');
                card.classList.add('shake');
                setTimeout(() => card.classList.remove('shake'), 500);
                window.showToast('Phone number did not match', 'error');
            }
            return;
        }

        // ONLY Staff PIN works for System Lock now
        const isStaffValid = freshUser && currentPin === freshUser.pin;

        if (isStaffValid) {
            clearPinAttempts(rateLimitKey);
            unlockApp();
        } else {
            // Check against current user's PIN length or default to 4
            const maxExpected = freshUser?.pin?.length || 4;
            if (currentPin.length >= maxExpected) {
                recordPinFailure(rateLimitKey);
                currentPin = '';
                updateDots();
                const card = lockOverlay.querySelector('.lock-card');
                card.classList.add('shake');
                setTimeout(() => card.classList.remove('shake'), 500);
                window.showToast('Incorrect PIN', 'error');
            }
        }
    };

    lockOverlay.querySelectorAll('.pin-btn[data-value]').forEach(btn => {
        btn.onclick = () => {
            if (currentPin.length < maxDigitsFor()) {
                currentPin += btn.dataset.value;
                updateDots();

                const minDigits = mode === 'recovery' ? 10 : 4;
                if (currentPin.length >= minDigits) {
                    // Slight delay for UX so dot turns active before overlay disappears/shacks
                    setTimeout(checkPin, 100);
                }
            }
        };
    });

    document.getElementById('pinClear').onclick = () => {
        currentPin = '';
        updateDots();
    };

    document.getElementById('pinBack').onclick = () => {
        currentPin = currentPin.slice(0, -1);
        updateDots();
    };

    document.getElementById('forgotPinBtn').onclick = () => {
        mode = mode === 'recovery' ? 'pin' : 'recovery';
        currentPin = '';
        updateDots();
        const forgotBtn = document.getElementById('forgotPinBtn');
        if (mode === 'recovery') {
            document.getElementById('lockTitle').textContent = 'Verify Phone Number';
            document.getElementById('lockSubtitle').textContent = 'Enter your registered phone number to unlock';
            forgotBtn.innerHTML = '<i class="fa-solid fa-arrow-left mr-8"></i> Back to PIN';
        } else {
            document.getElementById('lockTitle').textContent = 'System Locked';
            document.getElementById('lockSubtitle').textContent = 'Enter PIN to continue';
            forgotBtn.innerHTML = '<i class="fa-solid fa-phone mr-8"></i> Forgot PIN? Use Phone Number';
        }
    };

    document.getElementById('lockLogoutBtn').onclick = () => {
        if (window.logout) window.logout();
    };
}

export function unlockApp() {
    const overlay = document.getElementById('app-lock-overlay');
    if (overlay) {
        overlay.classList.add('fade-out');
        setTimeout(() => {
            overlay.remove();
            isLocked = false;
            write(KEYS.IS_LOCKED, false);
            if (unlockCallback) unlockCallback();
            window.showToast('System Unlocked', 'success');
        }, 300);
    }
}

export function getLockState() {
    return read(KEYS.IS_LOCKED);
}

export async function isAppLocked() {
    if (isLocked) return true;
    // isLocked always starts false on module (re)load — without this,
    // a lock set right before Electron closes/crashes/is killed was
    // silently forgotten on the next launch (the session is still logged
    // in, separately), letting the app open straight to the dashboard with
    // no PIN prompt at all. Fall back to the persisted flag lockApp()/
    // unlockApp() already write, which getLockState() reads but was never
    // actually called from anywhere.
    const persisted = await getLockState();
    if (persisted) isLocked = true;
    return !!persisted;
}

export function promptModuleLock(correctPin, onVerified, title = 'Security Lock', subtitle = 'Enter PIN to access this module') {
    const lockOverlay = document.createElement('div');
    lockOverlay.id = 'module-lock-overlay';
    lockOverlay.className = 'lock-overlay anim-fade-in';
    lockOverlay.style.zIndex = '9999';

    lockOverlay.innerHTML = `
    <div class="lock-card anim-slide-up">
      <div class="lock-header">
        <div class="lock-icon" style="background:rgba(99,102,241,0.1); color:var(--primary)"><i class="fa-solid fa-shield-halved"></i></div>
        <h2>${title}</h2>
        <p>${subtitle}</p>
      </div>
      
      <div class="pin-display">
        <div class="pin-dot" id="mod-dot-0"></div>
        <div class="pin-dot" id="mod-dot-1"></div>
        <div class="pin-dot" id="mod-dot-2"></div>
        <div class="pin-dot" id="mod-dot-3"></div>
        <div class="pin-dot" id="mod-dot-4"></div>
        <div class="pin-dot" id="mod-dot-5"></div>
      </div>
      
      <div class="pin-pad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => `
          <button class="pin-btn" data-value="${num}">${num}</button>
        `).join('')}
        <button class="pin-btn text-danger" id="modPinClear">C</button>
        <button class="pin-btn" data-value="0">0</button>
        <button class="pin-btn text-primary" id="modPinBack"><i class="fa-solid fa-arrow-left"></i></button>
      </div>
      
      <div class="lock-footer" style="padding-top:10px">
        <button class="btn btn-ghost btn-sm" id="modPinCancel">
          <i class="fa-solid fa-xmark mr-8"></i> Cancel
        </button>
      </div>
    </div>
  `;

    document.body.appendChild(lockOverlay);

    let currentPin = '';
    const maxLen = Math.max(4, correctPin.length);

    const updateDots = () => {
        for (let i = 0; i < 6; i++) {
            const dot = document.getElementById(`mod-dot-${i}`);
            if (dot) {
                dot.style.display = i < maxLen ? 'block' : 'none';
                dot.classList.toggle('active', i < currentPin.length);
            }
        }
    };

    updateDots();

    const checkPin = async () => {
        const rateLimit = checkPinRateLimit('module-lock');
        if (rateLimit.locked) {
            currentPin = '';
            updateDots();
            window.showToast(`Too many attempts. Try again in ${rateLimit.remainingSec}s.`, 'error');
            return;
        }

        // verifyPassword() handles both a hashed correctPin (the normal case
        // now that Settings.js hashes the master PIN before saving) and a
        // legacy plaintext one transparently, same as user password login.
        if (await verifyPassword(currentPin, correctPin)) {
            clearPinAttempts('module-lock');
            lockOverlay.classList.add('fade-out');
            setTimeout(() => {
                lockOverlay.remove();
                if (onVerified) onVerified();
            }, 300);
        } else {
            recordPinFailure('module-lock');
            currentPin = '';
            updateDots();
            const card = lockOverlay.querySelector('.lock-card');
            card.classList.add('shake');
            setTimeout(() => card.classList.remove('shake'), 500);
            window.showToast('Incorrect PIN', 'error');
        }
    };

    lockOverlay.querySelectorAll('.pin-btn[data-value]').forEach(btn => {
        btn.onclick = () => {
            if (currentPin.length < maxLen) {
                currentPin += btn.dataset.value;
                updateDots();
                if (currentPin.length === maxLen) {
                    setTimeout(checkPin, 100);
                }
            }
        };
    });

    document.getElementById('modPinClear').onclick = () => {
        currentPin = '';
        updateDots();
    };

    document.getElementById('modPinBack').onclick = () => {
        currentPin = currentPin.slice(0, -1);
        updateDots();
    };

    document.getElementById('modPinCancel').onclick = () => {
        lockOverlay.remove();
    };
}
