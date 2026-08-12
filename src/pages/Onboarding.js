import { completeInstallation, hashPassword } from '../db.js';
import { showToast } from '../components/Toast.js';

let currentStep = 1;

const totalSteps = 2;

const formData = {
  businessName: 'My Local POS',
  businessAddress: '',
  businessType: 'General', // Only business type this build offers — no industry-selection step.
  adminName: 'Admin',
  adminPhone: '',
  adminEmail: '',
  adminPassword: '',
  adminPin: '',
  loadSampleData: true,
  branchId: 'b1',
  adminId: 'u1',
  isInstalling: false
};

const standaloneSteps = {
  1: { title: 'Local POS Setup', desc: 'Enter your business details to get started.', icon: 'fa-store' },
  2: { title: 'Admin Security', desc: 'Set a password to secure your local database.', icon: 'fa-shield-halved' }
};

const stepInfo = standaloneSteps;

export function renderOnboarding(container) {
  currentStep = 1;
  renderStep(container);
}

function renderStep(container) {
  const info = stepInfo[currentStep] || {};

  container.innerHTML = `
    <div class="onboarding-overlay">
      <div id="fullPageLoader"></div>
      <div class="onboarding-wrapper">
        <div class="onboarding-hero-side">
          <div class="hero-illustration">
            <div class="hero-glow"></div>
            <div class="hero-float-icon hero-float-1"><i class="fa-solid fa-credit-card"></i></div>
            <div class="hero-float-icon hero-float-2"><i class="fa-solid fa-receipt"></i></div>
            <div class="hero-float-icon hero-float-3"><i class="fa-solid fa-indian-rupee-sign"></i></div>
            <div class="hero-terminal">
              <div class="hero-terminal-notch"></div>
              <div class="hero-terminal-screen">
                <i class="fa-solid ${info.icon}"></i>
              </div>
              <div class="hero-terminal-keys">
                <span></span><span></span><span></span>
                <span></span><span></span><span></span>
              </div>
            </div>
            <div class="hero-terminal-base"></div>
          </div>
          <div class="onboarding-hero-content">
             <h2>${info.title}</h2>
             <p>${info.desc}</p>
          </div>
        </div>

        <div class="onboarding-form-side">
          <div class="onboarding-card">
            <div class="onboarding-progress">
              ${Array.from({ length: totalSteps }).map((_, i) => `
                <div class="progress-dot ${i + 1 <= currentStep ? 'active' : ''} ${i + 1 < currentStep ? 'completed' : ''}">
                  ${i + 1 < currentStep ? '<i class="fa-solid fa-check"></i>' : i + 1}
                </div>
              `).join('<div class="progress-line"></div>')}
            </div>

            <div class="onboarding-content">
              ${getStepHTML()}
            </div>

            <div class="onboarding-footer">
              ${shouldShowBack() ? `<button class="btn btn-ghost" id="prevStepBtn">Back</button>` : '<div></div>'}
              <div style="display:flex; gap:12px">
                <button class="btn btn-primary btn-lg" id="nextStepBtn">
                  ${getNextBtnLabel()}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  attachStepEvents(container);
}

function showFullLoader(text, isFinal = false) {
  const loader = document.getElementById('fullPageLoader');
  if (!loader) return;
  loader.innerHTML = `
    <div class="onboarding-loader-overlay">
      <div class="loader-scanner">
        <div class="loader-barcode">
          <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
        </div>
        <div class="loader-scan-line"></div>
      </div>
      <div class="loader-text">${text}</div>
    </div>
  `;
}

function hideFullLoader() {
  const loader = document.getElementById('fullPageLoader');
  if (loader) loader.innerHTML = '';
}

function getStepHTML() {
  if (currentStep === 1) {
    return `
      <div class="step-header">
        <h1 class="step-title">Business Info</h1>
        <p class="step-desc">Enter your shop details for the local setup.</p>
      </div>
      <div class="form-group">
        <label class="form-label">Shop Name</label>
        <div class="search-input-wrap">
          <i class="fa-solid fa-store"></i>
          <input class="form-input" id="oBusinessName" placeholder="Zen Store" value="${formData.businessName}" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Shop Address</label>
        <div class="search-input-wrap">
          <i class="fa-solid fa-location-dot"></i>
          <input class="form-input" id="oBusinessAddress" placeholder="123 Street, City" value="${formData.businessAddress}" />
        </div>
      </div>
    `;
  }
  if (currentStep === 2) {
    return `
      <div class="step-header">
        <h1 class="step-title">Admin Security</h1>
        <p class="step-desc">Create a local administrator password.</p>
      </div>
      <div class="form-group">
        <label class="form-label">Phone Number (used to log in)</label>
        <input class="form-input" type="tel" id="oAdminPhone" inputmode="numeric" pattern="[0-9]*" maxlength="10" placeholder="e.g. 9876543210" value="${formData.adminPhone}" oninput="this.value = this.value.replace(/\D/g, '').slice(0, 10)" />
        <p style="font-size:11px; color:var(--text-muted); margin-top:6px;">Enter a valid 10-digit phone number.</p>
      </div>
      <div class="form-group">
        <label class="form-label">Email Address (optional)</label>
        <input class="form-input" type="email" id="oAdminEmail" placeholder="e.g. admin@yourshop.com" value="${formData.adminEmail}" />
      </div>
      <div class="form-group">
        <label class="form-label">Admin Password</label>
        <input class="form-input" type="password" id="oAdminPassword" placeholder="••••••••" value="${formData.adminPassword}" />
      </div>
      <div class="load-data-box ${formData.loadSampleData ? 'active' : ''}" id="loadDataToggle" style="margin-top:20px">
        <div class="checkbox-ui"><i class="fa-solid fa-check"></i></div>
        <div style="flex:1">
          <div style="font-weight:700">Load Sample Data</div>
          <div style="font-size:12px;opacity:0.6">Start with demo products for ${formData.businessType}.</div>
        </div>
      </div>
    `;
  }
  return '';
}

function attachStepEvents(container) {
  const sync = () => {
    if (document.getElementById('oBusinessName')) formData.businessName = document.getElementById('oBusinessName').value;
    if (document.getElementById('oBusinessAddress')) formData.businessAddress = document.getElementById('oBusinessAddress').value;
    if (document.getElementById('oAdminPhone')) formData.adminPhone = document.getElementById('oAdminPhone').value.trim();
    if (document.getElementById('oAdminEmail')) formData.adminEmail = document.getElementById('oAdminEmail').value.trim();
    if (document.getElementById('oAdminPassword')) formData.adminPassword = document.getElementById('oAdminPassword').value;
  };

  container.querySelector('#nextStepBtn').onclick = async () => {
    sync();

    if (currentStep < totalSteps) {
      currentStep++;
      renderStep(container);
    } else {
      finishStandaloneSetup();
    }
  };

  container.querySelector('#prevStepBtn')?.addEventListener('click', () => {
    sync();
    currentStep--;
    renderStep(container);
  });

  container.querySelector('#loadDataToggle')?.addEventListener('click', () => {
    formData.loadSampleData = !formData.loadSampleData;
    container.querySelector('#loadDataToggle').classList.toggle('active', formData.loadSampleData);
  });
}

async function finishStandaloneSetup() {
  if (formData.isInstalling) return;

  const phone = (formData.adminPhone || '').replace(/\D/g, '');
  if (!phone) return showToast('Please enter your phone number', 'error');
  if (phone.length !== 10) return showToast('Enter a valid 10-digit phone number', 'error');
  if (!formData.adminPassword) return showToast('Please set a password', 'error');

  formData.isInstalling = true;

  showFullLoader('Initializing Local Database...', true);

  setTimeout(async () => {
    try {
      // 0. Wipe this install's prior data on the local Mongo hub FIRST.
      //    Standalone/Electron always registers under the same fixed
      //    licenseKey ('LOCAL_EXE') + branchId ('b1') — completeInstallation()'s
      //    resetDatabase() below only clears this terminal's IndexedDB, so
      //    without this, the very first post-install sync would pull the
      //    OLD hub data (old products, old branch name) straight back into
      //    the freshly-emptied IndexedDB, regardless of what's chosen below.
      //    Non-fatal: if the hub isn't reachable yet, local install still proceeds.
      try {
        const hubToken = window.electronAPI?.getHubToken ? await window.electronAPI.getHubToken() : null;
        const resetRes = await fetch('http://localhost:3030/api/standalone-reset', {
          method: 'POST',
          headers: hubToken ? { 'X-Hub-Token': hubToken } : {}
        });
        if (!resetRes.ok) throw new Error(`HTTP ${resetRes.status}`);
        console.log('[Onboarding] Local hub tenant data reset before fresh install.');
      } catch (resetErr) {
        console.warn('[Onboarding] Could not reset local hub before install (non-fatal):', resetErr.message);
      }

      // 1. Complete local IndexedDB installation — the phone number IS the
      //    login username (no separate "Admin" identity to remember).
      const { user, register } = await completeInstallation({
        businessName: formData.businessName,
        businessAddress: formData.businessAddress,
        businessType: formData.businessType,
        adminName: phone,
        adminPassword: formData.adminPassword,
        email: formData.adminEmail || 'admin@local.com',
        loadSampleData: false,
        branchId: 'b1',
        adminId: 'u1'
      });

      // 2. Load samples locally if requested
      if (formData.loadSampleData) {
        const { importIndustryProducts } = await import('../db.js');
        await importIndustryProducts(formData.businessType, 'b1');
      }

      // 3. Register admin user on this shop's local Mongo hub so LAN devices
      //    that link to this hub can see the admin. Non-fatal —
      //    IndexedDB remains the source of truth for this terminal's own login.
      try {
        const hubToken = window.electronAPI?.getHubToken ? await window.electronAPI.getHubToken() : null;
        const hubRes = await fetch('http://localhost:3030/api/standalone-register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(hubToken ? { 'X-Hub-Token': hubToken } : {}) },
          body: JSON.stringify({
            userId: 'u1',
            username: phone,
            // Hashed here (not raw) — the hub stores whatever arrives in this
            // field directly as passwordHash with no hashing of its own (see
            // server/index.js's /api/standalone-register), so sending plaintext
            // meant every standalone install's admin password sat in Mongo in
            // the clear, unlike every other password in this app (Users.js's
            // saveUser(), completeInstallation()'s own IndexedDB write) which
            // already hash before it ever leaves this device.
            password: await hashPassword(formData.adminPassword),
            role: 'Super Admin',
            branchId: 'b1',
            registerId: register.id,
            businessName: formData.businessName || 'My Store',
            businessAddress: formData.businessAddress || '',
            businessType: formData.businessType || 'Others',
            createdAt: new Date().toISOString()
          })
        });
        if (!hubRes.ok) throw new Error(`HTTP ${hubRes.status}`);
        console.log('[Onboarding] Admin registered on local hub.');
      } catch (hubErr) {
        console.warn('[Onboarding] Could not register on local hub (non-fatal):', hubErr.message);
        // Not fatal — IndexedDB is the source of truth for Standalone
      }

      showToast('Offline POS Ready!', 'success');
      setTimeout(() => window.location.reload(), 2000);
    } catch (err) {
      formData.isInstalling = false;
      hideFullLoader();
      showToast('Setup failed: ' + err.message, 'error');
    }
  }, 1500);
}

function getNextBtnLabel() {
  if (currentStep === totalSteps) return 'Finish & Launch';
  return 'Continue';
}
function shouldShowBack() { return currentStep > 1; }
