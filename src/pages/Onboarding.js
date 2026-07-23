import { completeInstallation, BUSINESS_FEATURES } from '../db.js';
import { showToast } from '../components/Toast.js';

let currentStep = 1;

const totalSteps = 3;

const formData = {
  businessName: 'My Local POS',
  businessAddress: '',
  businessType: 'Restaurant',
  adminName: 'Admin',
  adminPhone: '',
  adminPassword: '',
  adminPin: '',
  loadSampleData: true,
  branchId: 'b1',
  adminId: 'u1',
  isInstalling: false
};

const standaloneSteps = {
  1: { title: 'Local POS Setup', desc: 'Enter your business details to get started.', img: '/onboarding/branch.png', icon: 'fa-store' },
  2: { title: 'Industry Selection', desc: 'Choose your business type for optimized settings.', img: '/onboarding/industry.png', icon: 'fa-briefcase' },
  3: { title: 'Admin Security', desc: 'Set a password to secure your local database.', img: '/onboarding/admin.png', icon: 'fa-shield-halved' }
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
          ${Object.keys(stepInfo).map(step => `
            <div class="onboarding-hero-asset ${Number(step) === currentStep ? 'active' : ''}">
               <img src="${stepInfo[step].img}"
                 class="onboarding-hero-image"
                 onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'"
               />
               <div class="onboarding-hero-placeholder" style="display:none">
                  <i class="fa-solid ${stepInfo[step].icon}"></i>
               </div>
            </div>
          `).join('')}
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
      <div class="loader-vibrant"></div>
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
        <h1 class="step-title">Select Industry</h1>
        <p class="step-desc">Customize your POS for your business type.</p>
      </div>
      <div class="industry-grid">
        ${Object.keys(BUSINESS_FEATURES).map(type => `
          <div class="industry-item ${formData.businessType === type ? 'active' : ''}" data-type="${type}">
            <div class="industry-icon"><i class="fa-solid ${getIndustryIcon(type)}"></i></div>
            <div class="industry-name">${type}</div>
          </div>
        `).join('')}
      </div>
    `;
  }
  if (currentStep === 3) {
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

  container.querySelectorAll('.industry-item').forEach(item => {
    item.onclick = () => {
      formData.businessType = item.dataset.type;
      container.querySelectorAll('.industry-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
    };
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
      // 1. Complete local IndexedDB installation — the phone number IS the
      //    login username (no separate "Admin" identity to remember).
      const { user, register } = await completeInstallation({
        businessName: formData.businessName,
        businessAddress: formData.businessAddress,
        businessType: formData.businessType,
        adminName: phone,
        adminPassword: formData.adminPassword,
        email: 'admin@local.com',
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
        const hubRes = await fetch('http://localhost:3030/api/standalone-register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: 'u1',
            username: phone,
            password: formData.adminPassword,
            role: 'Admin',
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
function getIndustryIcon(type) {
  const icons = { 'Restaurant': 'fa-utensils', 'General': 'fa-shopping-cart', 'Bakery': 'fa-bread-slice', 'Saloon': 'fa-scissors', 'Others': 'fa-store' };
  return icons[type] || 'fa-store';
}
