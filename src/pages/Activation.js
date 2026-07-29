import { showToast } from '../components/Toast.js';
import { syncEngine } from '../services/syncEngine.js';

export function renderActivation(container) {
  container.innerHTML = `
    <div class="login-split-container">
      <div class="login-hero-section">
        <div class="hero-branding anim-slide-up">
          <div class="hero-logo-box">
            <i class="fa-solid fa-house-laptop"></i>
          </div>
          <h1 class="hero-title">
            Local Installation <span>Activation</span>
          </h1>
          <p class="hero-desc">
            Your local database is set up. Enter your one-time Lifetime Activation
            Key to unlock this installation. Verification happens once, online — after
            that, this device works fully offline, forever.
          </p>
        </div>
      </div>

      <div class="login-form-section">
        <div class="login-form-wrapper">
          <div class="login-card-premium">
            <div class="login-form-header">
              <h2 class="login-form-title">Activate Your License</h2>
              <p class="login-form-subtitle">Enter the activation key you received to continue.</p>
            </div>

            <form id="activationForm">
              <div class="premium-input-group">
                <label class="premium-label">Activation Key</label>
                <div class="premium-input-wrap">
                  <i class="fa-solid fa-key"></i>
                  <input type="text" class="premium-input" id="activationKeyInput" placeholder="ZEI-XXXX-XXXX-XXXX" required autocomplete="off" style="text-transform:uppercase" />
                </div>
              </div>
              <div class="premium-input-group">
                <label class="premium-label">Phone Number or Email</label>
                <div class="premium-input-wrap">
                  <i class="fa-solid fa-id-card"></i>
                  <input type="text" class="premium-input" id="activationContactInput" placeholder="The phone or email this key was issued to" autocomplete="off" />
                </div>
              </div>
              <button type="submit" class="btn btn-primary w-full btn-lg mt-8" id="activateSubmitBtn" style="height: 56px; border-radius: 16px;">
                Verify &amp; Activate <i class="fa-solid fa-unlock ml-8"></i>
              </button>
            </form>

            <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border); text-align:center">
              <a href="#" id="activationLogoutBtn" style="color:#64748b; font-size:12px; font-weight:500">
                <i class="fa-solid fa-right-from-bracket mr-6"></i> Logout
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  container.querySelector('#activationForm').onsubmit = async (e) => {
    e.preventDefault();
    const key = container.querySelector('#activationKeyInput').value.trim().toUpperCase();
    const contact = container.querySelector('#activationContactInput').value.trim();
    if (!key) return showToast('Enter your activation key', 'error');

    const btn = container.querySelector('#activateSubmitBtn');
    btn.disabled = true;
    btn.innerHTML = 'Verifying... <i class="fa-solid fa-spinner fa-spin ml-8"></i>';

    try {
      const res = await syncEngine.activateLifetimeKey(key, contact);
      if (res.success) {
        showToast('Activated! Loading your POS...', 'success');
        setTimeout(() => window.location.reload(), 1200);
      } else {
        showToast(res.message || 'Activation failed. Check your key.', 'error');
        btn.disabled = false;
        btn.innerHTML = 'Verify &amp; Activate <i class="fa-solid fa-unlock ml-8"></i>';
      }
    } catch (err) {
      showToast('Could not verify key: ' + err.message, 'error');
      btn.disabled = false;
      btn.innerHTML = 'Verify &amp; Activate <i class="fa-solid fa-unlock ml-8"></i>';
    }
  };

  container.querySelector('#activationLogoutBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (window.logout) window.logout();
  });
}
