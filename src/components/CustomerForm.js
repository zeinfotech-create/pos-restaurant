import { saveCustomer, getCustomers } from '../db.js';
import { openModal, closeModal } from './Modal.js';
import { showToast } from './Toast.js';
import { MediaService } from '../services/MediaService.js';
import { escapeHtml } from '../utils/escapeHtml.js';

export function openCustomerForm(cust = null, callback = null) {
  const isEdit = !!cust;
  openModal({
    title: isEdit ? `<i class="fa-solid fa-user-pen mr-8"></i> Edit Customer` : `<i class="fa-solid fa-user-plus mr-8"></i> Add New Customer`,
    body: `
       <!-- Photo Section -->
       <div style="margin-bottom: 24px; padding: 16px; background: var(--bg-elevated); border-radius: var(--radius); border: 1px solid var(--border)">
        <div style="display:flex; gap:20px; align-items:center">
          <div id="cImagePreview" style="width:80px; height:80px; border-radius:50%; background: var(--bg-app); border:2px solid var(--primary); display:flex; align-items:center; justify-content:center; overflow:hidden; box-shadow: var(--shadow-sm)">
            ${cust?.image ? `<img src="${cust.image}" style="width:100%; height:100%; object-fit:cover" />` : `<i class="fa-solid fa-user" style="font-size:32px; opacity:0.2"></i>`}
          </div>
          <div style="flex:1">
            <h4 class="font-bold mb-4" style="font-size:14px">Customer Profile Photo</h4>
            <p class="form-help-text mb-12">Recommended size: 200x200px. Max 2MB.</p>
            <input type="file" id="cImageFile" accept="image/*" style="display:none" />
            <div style="display:flex; gap:8px">
              <button class="btn btn-ghost btn-sm" onclick="document.getElementById('cImageFile').click()"><i class="fa-solid fa-camera mr-4"></i> Upload Photo</button>
              <button class="btn btn-ghost btn-sm" id="removeCustImgBtn" style="color:var(--danger); ${cust?.image ? '' : 'display:none'}"><i class="fa-solid fa-xmark mr-4"></i> Remove</button>
            </div>
          </div>
        </div>
        <input type="hidden" id="cImageBase64" value="${cust?.image || ''}" />
      </div>

      <!-- Form Grid -->
      <div class="form-grid">
        <div class="form-group">
          <label class="form-label required">Customer Name</label>
          <div class="search-input-wrap">
            <i class="fa-solid fa-id-card"></i>
            <input class="form-input" id="cName" value="${escapeHtml(cust?.name || '')}" placeholder="John Doe">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label required">Mobile Number</label>
          <div class="search-input-wrap">
            <i class="fa-solid fa-phone"></i>
            <input class="form-input" id="cPhone" value="${escapeHtml(cust?.phone || '')}" placeholder="10-digit mobile number">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Email Address</label>
          <div class="search-input-wrap">
            <i class="fa-solid fa-envelope"></i>
            <input class="form-input" id="cEmail" value="${escapeHtml(cust?.email || '')}" placeholder="email@example.com">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Date of Birth</label>
          <div class="search-input-wrap">
            <i class="fa-solid fa-cake-candles"></i>
            <input type="date" class="form-input" id="cBirthday" value="${cust?.birthday || ''}">
          </div>
          <p class="form-help-text">Used for personalized offers & wishes.</p>
        </div>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="saveCustBtn" style="min-width: 120px">
        <i class="fa-solid fa-floppy-disk mr-8"></i> ${isEdit ? 'Update Details' : 'Create Customer'}
      </button>
    `
  });

  // Preview Image
  document.getElementById('cImageFile').onchange = async (e) => {
    try {
      const base64 = await MediaService.handleImageUpload(e);
      if (base64) {
        document.getElementById('cImageBase64').value = base64;
        document.getElementById('cImagePreview').innerHTML = `<img src="${base64}" style="width:100%;height:100%;object-fit:cover" />`;
        document.getElementById('removeCustImgBtn').style.display = 'inline-flex';
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  document.getElementById('removeCustImgBtn').onclick = () => {
    document.getElementById('cImageBase64').value = '';
    document.getElementById('cImagePreview').innerHTML = `<i class="fa-solid fa-user" style="opacity:0.3"></i>`;
    document.getElementById('cImageFile').value = '';
    document.getElementById('removeCustImgBtn').style.display = 'none';
  };

  const saveCustBtn = document.getElementById('saveCustBtn');
  saveCustBtn.onclick = async () => {
    if (saveCustBtn.disabled) return;
    const name = document.getElementById('cName').value.trim();
    const phone = document.getElementById('cPhone').value.trim();

    if (!name) { showToast('Customer Name is required', 'error'); return; }
    if (!phone) { showToast('Phone Number is required', 'error'); return; }

    // Phone validation (10 digits)
    if (!/^\d{10}$/.test(phone)) {
      showToast('Invalid Phone: 10 digits required', 'error');
      return;
    }

    // Same duplicate-guard class already applied to Categories.js/Suppliers.js
    // — without it, two customer records sharing a phone number fragment
    // that person's loyalty/credit history across both.
    const existingCustomers = await getCustomers();
    if (existingCustomers.some(c => c.id !== cust?.id && c.phone === phone)) {
      showToast(`A customer with phone "${phone}" already exists`, 'error');
      return;
    }

    saveCustBtn.disabled = true;
    let saved;
    try {
      saved = await saveCustomer({
        ...cust,
        name,
        phone,
        image: document.getElementById('cImageBase64').value,
        email: document.getElementById('cEmail').value.trim(),
        birthday: document.getElementById('cBirthday').value
      });
    } catch (err) {
      saveCustBtn.disabled = false;
      showToast(err.message || 'Failed to save customer.', 'error');
      return;
    }

    showToast('Customer saved!', 'success');
    closeModal();
    if (callback) callback(saved);
  };
}
