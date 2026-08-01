// ============================================================
// Settings.js
// ============================================================

import { getSettings, getGlobalSettings, saveSettings, isIndustryImported, importIndustryProducts, mergeDuplicateProducts, getSessionTheme, updateSettings, getOrders, updateOrder, getCurrentUser, getCurrentBranch, saveBranch, getBusinessFeatures, hasPermission, verifyLocalUser, read, KEYS, getCategories, saveCategory, deleteCategory, getSubCategories, saveSubCategory, deleteSubCategory, hashPassword } from '../db.js';
import { showToast } from '../components/Toast.js';
import { reloadSettings, store } from '../store.js';
import { openModal, closeModal, showConfirm, showAlert } from '../components/Modal.js';
import { syncEngine } from '../services/syncEngine.js';
import { BackupService } from '../services/BackupService.js';
import { MediaService } from '../services/MediaService.js';
import { escapeHtml } from '../utils/escapeHtml.js';

let activeSettingsTab = 'general';
let advancedConnectionExpanded = false;
let exportHistoryPage = 1;
let importHistoryPage = 1;
const BACKUP_HISTORY_PAGE_SIZE = 5;

window.SettingsPage = {
  render: () => {
    const container = document.getElementById('page-container');
    if (container) {
       import('./Settings.js').then(m => m.renderSettings(container));
    }
  }
};



const CURRENCIES = [
  { symbol: '\u20B9', label: 'Indian Rupee (\u20B9)' },
  { symbol: '$', label: 'US Dollar ($)' },
  { symbol: '€', label: 'Euro (€)' },
  { symbol: '£', label: 'British Pound (£)' },
  { symbol: '¥', label: 'Japanese Yen (¥)' },
  { symbol: 'A$', label: 'Australian Dollar (A$)' },
  { symbol: 'C$', label: 'Canadian Dollar (C$)' },
  { symbol: 'CHF', label: 'Swiss Franc (CHF)' },
  { symbol: 'CN¥', label: 'Chinese Yuan (CN¥)' },
  { symbol: 'SEK', label: 'Swedish Krona (SEK)' },
  { symbol: 'NZ$', label: 'New Zealand Dollar (NZ$)' },
  { symbol: 'MX$', label: 'Mexican Peso (MX$)' },
  { symbol: 'S$', label: 'Singapore Dollar (S$)' },
  { symbol: 'HK$', label: 'Hong Kong Dollar (HK$)' },
  { symbol: 'NOK', label: 'Norwegian Krone (NOK)' },
  { symbol: '₩', label: 'South Korean Won (₩)' },
  { symbol: '₺', label: 'Turkish Lira (₺)' },
  { symbol: '₽', label: 'Russian Ruble (₽)' },
  { symbol: 'R$', label: 'Brazilian Real (R$)' },
  { symbol: 'R', label: 'South African Rand (R)' },
  { symbol: '₱', label: 'Philippine Peso (₱)' },
  { symbol: 'Kč', label: 'Czech Koruna (Kč)' },
  { symbol: 'Rp', label: 'Indonesian Rupiah (Rp)' },
  { symbol: 'RM', label: 'Malaysian Ringgit (RM)' },
  { symbol: 'HUF', label: 'Hungarian Forint (HUF)' },
  { symbol: 'د.إ', label: 'UAE Dirham (د.إ)' },
  { symbol: '₪', label: 'Israeli New Shekel (₪)' },
  { symbol: '฿', label: 'Thai Baht (฿)' },
  { symbol: '₫', label: 'Vietnamese Dong (₫)' },
  { symbol: 'E£', label: 'Egyptian Pound (E£)' },
  { symbol: '₦', label: 'Nigerian Naira (₦)' },
  { symbol: 'Ksh', label: 'Kenyan Shilling (Ksh)' },
  { symbol: 'GH₵', label: 'Ghanaian Cedi (GH₵)' },
  { symbol: '৳', label: 'Bangladeshi Taka (৳)' },
  { symbol: 'Rs', label: 'Pakistani Rupee (Rs)' },
  { symbol: 'LKR', label: 'Sri Lankan Rupee (LKR)' },
  { symbol: 'NPR', label: 'Nepalese Rupee (NPR)' },
  { symbol: 'د.ك', label: 'Kuwaiti Dinar (د.ك)' },
  { symbol: 'ر.س', label: 'Saudi Riyal (ر.س)' },
  { symbol: 'ر.ق', label: 'Qatari Rial (ر.ق)' },
  { symbol: 'ر.ع.', label: 'Omani Rial (ر.ع.)' },
  { symbol: 'د.ب', label: 'Bahraini Dinar (د.ب)' },
  { symbol: 'MAD', label: 'Moroccan Dirham (MAD)' },
  { symbol: 'د.ج', label: 'Algerian Dinar (د.ج)' },
  { symbol: 'د.ت', label: 'Tunisian Dinar (د.ت)' },
  { symbol: 'د.ل', label: 'Libyan Dinar (د.ل)' },
  { symbol: 'AFN', label: 'Afghan Afghani (AFN)' },
  { symbol: 'ALL', label: 'Albanian Lek (ALL)' },
  { symbol: 'AMD', label: 'Armenian Dram (AMD)' },
  { symbol: 'ARS', label: 'Argentine Peso (ARS)' },
  { symbol: 'AWG', label: 'Aruban Florin (AWG)' },
  { symbol: 'AZN', label: 'Azerbaijani Manat (AZN)' },
  { symbol: 'BAM', label: 'Bosnia-Herzegovina Mark (BAM)' },
  { symbol: 'BBD', label: 'Barbadian Dollar (BBD)' },
  { symbol: 'BDT', label: 'Bangladeshi Taka (BDT)' },
  { symbol: 'BGN', label: 'Bulgarian Lev (BGN)' },
  { symbol: 'BHD', label: 'Bahraini Dinar (BHD)' },
  { symbol: 'BMD', label: 'Bermudian Dollar (BMD)' },
  { symbol: 'BND', label: 'Brunei Dollar (BND)' },
  { symbol: 'BOB', label: 'Bolivian Boliviano (BOB)' },
  { symbol: 'BSD', label: 'Bahamian Dollar (BSD)' },
  { symbol: 'BTN', label: 'Bhutanese Ngultrum (BTN)' },
  { symbol: 'BWP', label: 'Botswana Pula (BWP)' },
  { symbol: 'BYN', label: 'Belarusian Ruble (BYN)' },
  { symbol: 'BZD', label: 'Belize Dollar (BZD)' },
  { symbol: 'CDF', label: 'Congolese Franc (CDF)' },
  { symbol: 'CLP', label: 'Chilean Peso (CLP)' },
  { symbol: 'COP', label: 'Colombian Peso (COP)' },
  { symbol: 'CRC', label: 'Costa Rican Colón (CRC)' },
  { symbol: 'CUP', label: 'Cuban Peso (CUP)' },
  { symbol: 'CVE', label: 'Cape Verdean Escudo (CVE)' },
  { symbol: 'DJF', label: 'Djiboutian Franc (DJF)' },
  { symbol: 'DKK', label: 'Danish Krone (DKK)' },
  { symbol: 'DOP', label: 'Dominican Peso (DOP)' },
  { symbol: 'DZD', label: 'Algerian Dinar (DZD)' },
  { symbol: 'ETB', label: 'Ethiopian Birr (ETB)' },
  { symbol: 'FJD', label: 'Fijian Dollar (FJD)' },
  { symbol: 'GEL', label: 'Georgian Lari (GEL)' },
  { symbol: 'GMD', label: 'Gambian Dalasi (GMD)' },
  { symbol: 'GTQ', label: 'Guatemalan Quetzal (GTQ)' },
  { symbol: 'GYD', label: 'Guyanaese Dollar (GYD)' },
  { symbol: 'HNL', label: 'Honduran Lempira (HNL)' },
  { symbol: 'HTG', label: 'Haitian Gourde (HTG)' },
  { symbol: 'IQD', label: 'Iraqi Dinar (IQD)' },
  { symbol: 'IRR', label: 'Iranian Rial (IRR)' },
  { symbol: 'ISK', label: 'Icelandic Króna (ISK)' },
  { symbol: 'JMD', label: 'Jamaican Dollar (JMD)' },
  { symbol: 'JOD', label: 'Jordanian Dinar (JOD)' },
  { symbol: 'KGS', label: 'Kyrgystani Som (KGS)' },
  { symbol: 'KHR', label: 'Cambodian Riel (KHR)' },
  { symbol: 'KMF', label: 'Comorian Franc (KMF)' },
  { symbol: 'KWD', label: 'Kuwaiti Dinar (KWD)' },
  { symbol: 'KYD', label: 'Cayman Islands Dollar (KYD)' },
  { symbol: 'KZT', label: 'Kazakhstani Tenge (KZT)' },
  { symbol: 'LAK', label: 'Laotian Kip (LAK)' },
  { symbol: 'LBP', label: 'Lebanese Pound (LBP)' },
  { symbol: 'LRD', label: 'Liberian Dollar (LRD)' },
  { symbol: 'LSL', label: 'Lesotho Loti (LSL)' },
  { symbol: 'LYD', label: 'Libyan Dinar (LYD)' },
  { symbol: 'MDL', label: 'Moldovan Leu (MDL)' },
  { symbol: 'MGA', label: 'Malagasy Ariary (MGA)' },
  { symbol: 'MKD', label: 'Macedonian Denar (MKD)' },
  { symbol: 'MMK', label: 'Myanmar Kyat (MMK)' },
  { symbol: 'MNT', label: 'Mongolian Tugrik (MNT)' },
  { symbol: 'MOP', label: 'Macanese Pataca (MOP)' },
  { symbol: 'MRU', label: 'Mauritanian Ouguiya (MRU)' },
  { symbol: 'MUR', label: 'Mauritian Rupee (MUR)' },
  { symbol: 'MVR', label: 'Maldivian Rufiyaa (MVR)' },
  { symbol: 'MWK', label: 'Malawian Kwacha (MWK)' },
  { symbol: 'MZN', label: 'Mozambican Metical (MZN)' },
  { symbol: 'NAD', label: 'Namibian Dollar (NAD)' },
  { symbol: 'NIO', label: 'Nicaraguan Córdoba (NIO)' },
  { symbol: 'OMR', label: 'Omani Rial (OMR)' },
  { symbol: 'PAB', label: 'Panamanian Balboa (PAB)' },
  { symbol: 'PEN', label: 'Peruvian Sol (PEN)' },
  { symbol: 'PGK', label: 'Papua New Guinean Kina (PGK)' },
  { symbol: 'PKR', label: 'Pakistani Rupee (PKR)' },
  { symbol: 'PYG', label: 'Paraguayan Guarani (PYG)' },
  { symbol: 'QAR', label: 'Qatari Rial (QAR)' },
  { symbol: 'RON', label: 'Romanian Leu (RON)' },
  { symbol: 'RSD', label: 'Serbian Dinar (RSD)' },
  { symbol: 'RWF', label: 'Rwandan Franc (RWF)' },
  { symbol: 'SAR', label: 'Saudi Riyal (SAR)' },
  { symbol: 'SCR', label: 'Seychellois Rupee (SCR)' },
  { symbol: 'SDG', label: 'Sudanese Pound (SDG)' },
  { symbol: 'SLL', label: 'Sierra Leonean Leone (SLL)' },
  { symbol: 'SOS', label: 'Somali Shilling (SOS)' },
  { symbol: 'SRD', label: 'Surinamese Dollar (SRD)' },
  { symbol: 'SYP', label: 'Syrian Pound (SYP)' },
  { symbol: 'SZL', label: 'Swazi Lilangeni (SZL)' },
  { symbol: 'TJS', label: 'Tajikistani Somoni (TJS)' },
  { symbol: 'TMT', label: 'Turkmenistani Manat (TMT)' },
  { symbol: 'TND', label: 'Tunisian Dinar (TND)' },
  { symbol: 'TTD', label: 'Trinidad & Tobago Dollar (TTD)' },
  { symbol: 'TWD', label: 'New Taiwan Dollar (NT$)' },
  { symbol: 'TZS', label: 'Tanzanian Shilling (TZS)' },
  { symbol: 'UAH', label: 'Ukrainian Hryvnia (UAH)' },
  { symbol: 'UGX', label: 'Ugandan Shilling (UGX)' },
  { symbol: 'UYU', label: 'Uruguayan Peso (UYU)' },
  { symbol: 'UZS', label: 'Uzbekistani Som (UZS)' },
  { symbol: 'VEF', label: 'Venezuelan Bolívar (VEF)' },
  { symbol: 'VND', label: 'Vietnamese Dong (VND)' },
  { symbol: 'YER', label: 'Yemeni Rial (YER)' },
  { symbol: 'ZMW', label: 'Zambian Kwacha (ZMW)' },
  { symbol: 'ZWL', label: 'Zimbabwean Dollar (ZWL)' }
];

export async function renderSettings(container) {
  const branchId = store.branch?.id;
  const s = await getSettings(branchId);

  if (!(await hasPermission('settings:manage'))) {
    container.innerHTML = `
        <p class="mb-24 text-muted">You do not have permission to manage settings.</p>
        <button class="btn btn-primary" onclick="window.navigate('dashboard')">Back to Dashboard</button>
      </div>
    `;
    return;
  }
  if (window.selectedSettingsTab) {
    activeSettingsTab = window.selectedSettingsTab;
    window.selectedSettingsTab = null;
  }
  const features = await getBusinessFeatures();
  const activeTheme = (await getSessionTheme()) || s.theme;

  // Track the choice in memory during this session to avoid DOM reading issues
  if (!window.selectedThemeChoice) {
    window.selectedThemeChoice = activeTheme;
  }

  const renderTabSaveContainer = (id, label) => `
    <div style="margin-top:28px; padding-top:20px; border-top:1px solid var(--border); display:flex; justify-content:flex-end">
      <button class="btn btn-primary" id="${id}" style="padding: 10px 24px; border-radius: 10px; font-weight: 700; box-shadow: 0 4px 12px var(--primary-light); border:none; background:var(--primary)">
        <i class="fa-solid fa-save" style="margin-right:8px"></i> ${label}
      </button>
    </div>
  `;
  container.innerHTML = `
    <div class="settings-page-header" style="display: flex; justify-content: space-between; align-items: center;">
      <div class="settings-page-title">
        <div class="settings-page-icon"><i class="fa-solid fa-gear"></i></div>
        <div>
          <div style="font-size:20px;font-weight:800;color:var(--text-primary)">Settings</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px">Manage your store configuration</div>
        </div>
      </div>
    </div>

    <div class="settings-layout">
      <!-- Vertical Sidebar Nav -->
      <aside class="settings-sidebar">
        <div class="settings-nav-section-label">General</div>
        <button class="settings-nav-item ${activeSettingsTab === 'general' ? 'active' : ''}" data-tab="general">
          <span class="settings-nav-icon" style="background:rgba(99,102,241,0.12);color:#6366f1"><i class="fa-solid fa-gear"></i></span>
          <span>General</span>
        </button>
        <!--
        <button class="settings-nav-item ${activeSettingsTab === 'industry' ? 'active' : ''}" data-tab="industry">
          <span class="settings-nav-icon" style="background:rgba(16,185,129,0.12);color:#10b981"><i class="fa-solid fa-screwdriver-wrench"></i></span>
          <span>Industry</span>
        </button>
        -->
        <button class="settings-nav-item ${activeSettingsTab === 'security' ? 'active' : ''}" data-tab="security">
          <span class="settings-nav-icon" style="background:rgba(239,68,68,0.12);color:#ef4444"><i class="fa-solid fa-shield-halved"></i></span>
          <span>Security</span>
        </button>
        <div class="settings-nav-section-label" style="margin-top:16px">Integrations</div>
        <button class="settings-nav-item ${activeSettingsTab === 'addons' ? 'active' : ''}" data-tab="addons">
          <span class="settings-nav-icon" style="background:rgba(99,102,241,0.12);color:#6366f1">
            <i class="fa-solid fa-puzzle-piece"></i>
            ${!syncEngine.checkCapability('pro_addons') ? '<i class="fa-solid fa-lock" style="position:absolute; bottom:-2px; right:-2px; font-size:9px; color:var(--text-muted)"></i>' : ''}
          </span>
          <span>Operations</span>
        </button>
        <button class="settings-nav-item ${activeSettingsTab === 'backup' ? 'active' : ''}" data-tab="backup">
          <span class="settings-nav-icon" style="background:rgba(245,158,11,0.12);color:#f59e0b">
            <i class="fa-solid fa-file-export"></i>
            ${!syncEngine.checkCapability('data_backup') ? '<i class="fa-solid fa-lock" style="position:absolute; bottom:-2px; right:-2px; font-size:9px; color:var(--text-muted)"></i>' : ''}
          </span>
          <span>Backup</span>
        </button>

        ${['Master', 'Super Admin'].includes((await getCurrentUser())?.role) ? `
          <div class="settings-nav-section-label" style="margin-top:16px">Advanced</div>
          <button class="settings-nav-item ${activeSettingsTab === 'danger' ? 'active' : ''}" data-tab="danger">
            <span class="settings-nav-icon" style="background:rgba(239,68,68,0.12);color:#ef4444"><i class="fa-solid fa-triangle-exclamation"></i></span>
            <span>Danger Zone</span>
          </button>
        ` : ''}

      </aside>

      <!-- Content Panel -->
      <div class="settings-content-panel">
        <!-- General Tab Content -->
        <div class="settings-tab-content ${activeSettingsTab === 'general' ? 'active' : ''}" id="tab-general">
          <div class="card">
            <div class="font-bold mb-16" style="font-size:16px"><i class="fa-solid fa-store" style="color:var(--primary-light)"></i> Store Information</div>
            <div style="display:flex;flex-direction:column;gap:14px">
              <div class="form-group">
                <label class="form-label">Store Name</label>
                <input class="form-input" id="sStoreName" value="${escapeHtml(s.storeName)}" placeholder="My Store" />
              </div>
              <div class="form-group">
                <label class="form-label">Store Name Subtitle (optional)</label>
                <input class="form-input" id="sStoreNameSubtitle" value="${escapeHtml(s.storeNameSubtitle)}" placeholder="e.g. Group" />
                <p style="font-size:11px; color:var(--text-muted); margin-top:4px">Shown on its own smaller line under the store name — on receipts, tax invoices, and anywhere else the store name is printed.</p>
              </div>
              <div class="form-group">
                <label class="form-label">Store Address</label>
                <input class="form-input" id="sStoreAddress" value="${escapeHtml(s.storeAddress)}" placeholder="123 Main Street, City" />
              </div>
              <div class="form-group">
                <label class="form-label">Store Phone</label>
                <input class="form-input" id="sStorePhone" value="${escapeHtml(s.storePhone)}" placeholder="e.g. 0413-2225777" />
              </div>
              <div class="form-group">
                <label class="form-label">GSTIN (optional)</label>
                <input class="form-input" id="sGstNumber" value="${s.gstNumber || ''}" placeholder="e.g. 34AADCV2185M1Z0" />
              </div>
              <div class="form-group">
                <label class="form-label">UPI ID (optional)</label>
                <input class="form-input" id="sUpiId" value="${s.upiId || ''}" placeholder="e.g. yourshop@okhdfcbank" />
                <p style="font-size:11px; color:var(--text-muted); margin-top:4px">Shown as a "Pay via UPI" QR on the Customer Display so customers can pay you directly — no gateway or fees.</p>
              </div>
              <div class="form-group">
                <label class="form-label">Store Logo</label>
                <div style="display:flex; align-items:center; gap:12px">
                  <div id="logoPreview" style="width:56px; height:56px; border-radius:8px; border:1px dashed var(--border); display:flex; align-items:center; justify-content:center; overflow:hidden; background:var(--bg-elevated); flex-shrink:0">
                    ${s.storeLogo ? `<img src="${s.storeLogo}" style="width:100%; height:100%; object-fit:contain" />` : `<i class="fa-solid fa-image" style="opacity:0.3"></i>`}
                  </div>
                  <input type="hidden" id="sStoreLogoBase64" value="${s.storeLogo || ''}" />
                  <label class="btn btn-ghost" style="cursor:pointer; font-size:12px">
                    <i class="fa-solid fa-upload mr-6"></i> Upload
                    <input type="file" id="sStoreLogoFile" accept="image/*" style="display:none" />
                  </label>
                  ${s.storeLogo ? `<button type="button" class="btn btn-ghost" id="removeLogoBtn" style="font-size:12px; color:var(--danger)">Remove</button>` : ''}
                </div>
                <div class="form-group" style="display:flex; align-items:center; gap:8px; margin-top:10px">
                  <input type="checkbox" id="sShowLogoOnReceipt" ${s.showLogoOnReceipt ? 'checked' : ''} />
                  <label class="form-label" style="margin:0" for="sShowLogoOnReceipt">Print logo on receipt</label>
                </div>
                <div class="form-group" style="display:flex; align-items:center; gap:8px; margin-top:10px">
                  <input type="checkbox" id="sPrintBarcodeOnReceipt" ${s.printBarcodeOnReceipt ? 'checked' : ''} />
                  <label class="form-label" style="margin:0" for="sPrintBarcodeOnReceipt">Print order ID barcode on receipt</label>
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">Receipt Footer</label>
                <input class="form-input" id="sReceiptFooter" value="${s.receiptFooter || ''}" placeholder="Thank you for shopping!" />
              </div>
            </div>
          </div>


          <div class="card">
            <div class="font-bold mb-16" style="font-size:16px"><i class="fa-solid fa-palette" style="color:var(--secondary)"></i> Appearance</div>
            <div class="theme-section-title">Dark Themes</div>
            <div class="theme-grid">
              ${[
        { id: 'theme-dark-midnight', label: 'Midnight', color: '#6366f1', icon: '🌙' },
        { id: 'theme-dark-obsidian', label: 'Obsidian', color: '#f8fafc', icon: '🌑' },
        { id: 'theme-dark-ocean', label: 'Ocean', color: '#06b6d4', icon: '🌊' },
        { id: 'theme-dark-indigo', label: 'Deep Indigo', color: '#6366f1', icon: '🌌' },
        { id: 'theme-dark-twilight', label: 'Twilight', color: '#8b5cf6', icon: '🌆' }
      ].map(t => `
                <div class="theme-swatch ${activeTheme === t.id ? 'active' : ''}" data-theme="${t.id}" title="${t.label} Theme">
                  <div class="swatch-color" style="background:${t.color}">${t.icon}</div>
                  <div class="swatch-label">${t.label}</div>
                </div>
              `).join('')}
            </div>
            <div class="theme-section-title">Light Themes</div>
            <div class="theme-grid">
              ${[
        { id: 'theme-light-classic', label: 'Classic', color: '#4f46e5', icon: '☀️' },
        { id: 'theme-light-mint', label: 'Mint Breeze', color: '#0d9488', icon: '🍃' },
        { id: 'theme-light-slate', label: 'Slate Blue', color: '#334155', icon: '🏙️' },
        { id: 'theme-light-royal', label: 'Royal', color: '#7c3aed', icon: '👑' },
        { id: 'theme-light-rose', label: 'Rose', color: '#e11d48', icon: '🌸' },
        { id: 'theme-light-google', label: 'Azure', color: '#1a73e8', icon: '🔍' },
        { id: 'theme-light-zoom', label: 'Sapphire', color: '#2d8cff', icon: '📹' },
        { id: 'theme-light-amazon', label: 'Sunset', color: '#ff9900', icon: '📦' },
        { id: 'theme-light-flipkart', label: 'Cobalt', color: '#2874f0', icon: '🛒' }
      ].map(t => `
                <div class="theme-swatch ${activeTheme === t.id ? 'active' : ''}" data-theme="${t.id}" title="${t.label} Theme">
                  <div class="swatch-color" style="background:${t.color}">${t.icon}</div>
                  <div class="swatch-label">${t.label}</div>
                </div>
              `).join('')}
            </div>
            <input type="hidden" id="sThemeValue" value="${activeTheme}" />
          </div>

          <div class="card">
            <div class="font-bold mb-16" style="font-size:16px"><i class="fa-solid fa-money-bill" style="color:var(--accent)"></i> Financial Settings</div>
            <div style="display:flex;flex-direction:column;gap:14px">
              <div class="form-group">
                <label class="form-label">Currency</label>
                <select class="form-select" id="sCurrency">
                  ${CURRENCIES.map(c => `
                    <option value="${c.symbol}" data-icon="fa-solid fa-money-bill-wave" ${s.currency === c.symbol ? 'selected' : ''}>
                      ${c.label}
                    </option>
                  `).join('')}
                </select>
              </div>
              <div class="form-group" style="margin-bottom: 24px;">
                <label class="form-label" style="display:flex; justify-content:space-between; align-items:flex-end;">
                  <span>Available Tax Rates (%)</span>
                </label>
                <div id="taxRatesContainer" style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px">
                  <!-- rendered dynamically -->
                </div>
                <div style="display:flex; gap:8px">
                  <input class="form-input" id="newTaxRateInput" type="number" step="0.1" min="0" placeholder="e.g. 18" style="width:120px" />
                  <button type="button" class="btn btn-secondary btn-sm" id="addTaxRateBtn"><i class="fa-solid fa-plus mr-4"></i> Add Rate</button>
                </div>
                <input type="hidden" id="sAvailableTaxes" value='${JSON.stringify(s.availableTaxes || [])}' />
              </div>
              <div class="form-group">
                <label class="form-label">Default Tax Rate (%)</label>
                <select class="form-select" id="sTaxRate">
                  <!-- rendered dynamically -->
                </select>
              </div>

              <!-- Integration of Payment Methods into General -->
              <div class="form-group" style="margin-top: 16px; padding-top: 16px; border-top: 1px dashed var(--border)">
                <label class="form-label">Configured Payment Methods</label>
                <div id="paymentMethodsContainer" style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px">
                  <!-- rendered dynamically -->
                </div>
                <div style="display:flex; gap:8px">
                  <input class="form-input" id="newPaymentMethodInput" type="text" placeholder="e.g. Swiggy" style="width:160px" />
                  <button type="button" class="btn btn-secondary btn-sm" id="addPaymentMethodBtn"><i class="fa-solid fa-plus mr-4"></i> Add Method</button>
                </div>
                <!-- Default payload if undefined -->
                <input type="hidden" id="sPaymentMethods" value='${JSON.stringify(s.paymentMethods || [])}' />
              </div>
              <div class="form-group" style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--border)">
                <label class="flex items-center gap-12 cursor-pointer">
                  <input type="checkbox" id="sRoundOffEnabled" ${s.roundOffEnabled ? 'checked' : ''} style="width:20px;height:20px" />
                  <div>
                    <div class="font-bold">Enable Auto Round-Off</div>
                    <p style="font-size:12px;opacity:0.6">Automatically round the grand total to the nearest whole number.</p>
                  </div>
                </label>
              </div>
            </div>
          </div>
          <div class="card mt-16">
              <div class="font-bold mb-16" style="font-size:16px"><i class="fa-solid fa-print" style="color:var(--primary)"></i> Printing Preferences</div>
              <div class="form-group" style="display:flex; flex-direction:row; align-items:center; gap:12px">
                  <input type="checkbox" id="sAutoPrintReceipt" ${s.autoPrintReceipt ? 'checked' : ''} />
                  <div>
                      <div class="font-bold">Auto Print Receipt</div>
                      <p style="font-size:11px; opacity:0.6">Automatically open print dialog after checkout is completed.</p>
                  </div>
              </div>
          </div>

          ${renderTabSaveContainer('saveGeneralBtn', 'General')}
        </div>

        <!-- Industry Tab Content
        <div class="settings-tab-content ${activeSettingsTab === 'industry' ? 'active' : ''}" id="tab-industry">
          <div class="card" style="opacity: ${syncEngine.checkCapability('industry_setup') ? '1' : '0.5'}; pointer-events: ${syncEngine.checkCapability('industry_setup') ? 'auto' : 'none'}; position: relative;">
            ${!syncEngine.checkCapability('industry_setup') ? '<div style="position:absolute; top:12px; right:12px; font-size:10px; background:var(--bg-elevated); border:1px solid var(--border); padding:2px 8px; border-radius:10px; color:var(--text-muted); font-weight:700;"><i class="fa-solid fa-lock mr-4"></i> PRO ONLY</div>' : ''}
            <div class="font-bold mb-16" style="font-size:16px"><i class="fa-solid fa-screwdriver-wrench" style="color:#10b981"></i> Build & Industry</div>
            <div class="form-group">
              <label class="form-label">Business Industry</label>
              <select class="form-select" id="sBusinessType" style="border-color:var(--primary); font-weight:600" ${!syncEngine.checkCapability('industry_setup') ? 'disabled' : ''}>
                <optgroup label="Select your business type">
                  <option value="Restaurant" ${s.businessType === 'Restaurant' ? 'selected' : ''}>🍴 Restaurant / Cafe</option>
                  <option value="General" ${s.businessType === 'General' ? 'selected' : ''}>🛒 General Retail</option>
                  <option value="Bakery" ${s.businessType === 'Bakery' ? 'selected' : ''}>🥐 Bakery</option>
                  <option value="Saloon" ${s.businessType === 'Saloon' ? 'selected' : ''}>💇 Saloon / Spa</option>
                  <option value="Supermarket" ${s.businessType === 'Supermarket' ? 'selected' : ''}>🛒 Supermarket</option>
                </optgroup>
              </select>
            </div>
            <div style="margin-top:12px; display:flex; gap:10px; align-items:center;">
               <button class="btn btn-secondary btn-sm" id="importSupermarketBtn" style="border-radius:8px">
                  <i class="fa-solid fa-file-import mr-8"></i> Import Supermarket Data (50 Items)
               </button>
               ${isIndustryImported('Supermarket') ? '<span style="font-size:10px; color:var(--success); font-weight:700"><i class="fa-solid fa-check"></i> Imported</span>' : ''}
            </div>
          </div>
          ${renderTabSaveContainer('saveIndustryBtn', 'Industry')}
        </div>
        -->

        <!-- Security Tab Content -->
        <div class="settings-tab-content ${activeSettingsTab === 'security' ? 'active' : ''}" id="tab-security">
          <div class="card">
            <div class="font-bold mb-16" style="font-size:16px"><i class="fa-solid fa-shield-halved" style="color:var(--primary)"></i> System Access</div>
            <div class="form-group mt-16">
              <label class="form-label">Auto-Lock System (Minutes)</label>
              <select class="form-select" id="sAutoLock">
                <option value="0" ${s.autoLockMinutes === 0 ? 'selected' : ''}>Never Lock</option>
                <option value="1" ${s.autoLockMinutes === 1 ? 'selected' : ''}>1 Minute</option>
                <option value="5" ${s.autoLockMinutes === 5 ? 'selected' : ''}>5 Minutes</option>
                <option value="15" ${s.autoLockMinutes === 15 ? 'selected' : ''}>15 Minutes</option>
              </select>
            </div>
            
            <div style="margin-top: 24px; padding-top: 20px; border-top: 1px dashed var(--border)">
              <div class="form-group">
                <label class="flex items-center gap-12 cursor-pointer">
                  <input type="checkbox" id="sSettingsLockEnabled" ${s.settingsLockEnabled ? 'checked' : ''} style="width:20px;height:20px" />
                  <div>
                    <div class="font-bold">Enable Settings module PIN lock</div>
                    <p style="font-size:12px;opacity:0.6">Require a Master PIN to access the Settings page.</p>
                  </div>
                </label>
              </div>
              
              <div id="masterPinContainer" style="display: ${s.settingsLockEnabled ? 'block' : 'none'}; margin-top: 16px;">
                <label class="form-label">Master Security PIN (4-6 digits)</label>
                <div style="position:relative">
                  <input type="password" class="form-input" id="sMasterPin" value=""
                    placeholder="${s.masterPin ? 'Leave blank to keep current PIN' : 'Enter 4-6 digit PIN'}" maxlength="6" inputmode="numeric"
                    oninput="this.value=this.value.replace(/[^0-9]/g,'')"
                    style="letter-spacing:4px; font-weight:800" />
                  <button type="button" class="btn-icon" style="position:absolute; right:10px; top:50%; transform:translateY(-50%)"
                    onclick="const input = document.getElementById('sMasterPin'); input.type = input.type === 'password' ? 'text' : 'password'; this.querySelector('i').className = input.type === 'password' ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';">
                    <i class="fa-solid fa-eye"></i>
                  </button>
                </div>
                <p style="font-size:11px; color:var(--text-muted); margin-top:6px">This PIN will be required to unlock this Settings module.
                  ${s.masterPin ? `<span style="color:var(--success); font-weight:700">(A PIN is currently set)</span>` : ''}
                </p>
              </div>
            </div>
          </div>
          ${renderTabSaveContainer('saveSecurityBtn', 'Security')}
        </div>
   
        <!-- Backup Tab Content -->
        <div class="settings-tab-content ${activeSettingsTab === 'backup' ? 'active' : ''}" id="tab-backup"></div>

        <!-- Operations Tab Content -->
        <div class="settings-tab-content ${activeSettingsTab === 'addons' ? 'active' : ''}" id="tab-addons">
          <div class="card" style="padding:0; overflow:hidden;">
            <button type="button" id="toggleAdvancedConnectionBtn" style="width:100%; display:flex; align-items:center; justify-content:space-between; gap:8px; padding:14px 16px; background:none; border:none; cursor:pointer; font-weight:700; font-size:13px; color:var(--text-main);">
              <span><i class="fa-solid fa-plug" style="color:var(--text-muted); margin-right:8px"></i> Advanced Connection Settings</span>
              <i class="fa-solid ${advancedConnectionExpanded ? 'fa-chevron-up' : 'fa-chevron-down'}" style="color:var(--text-muted); font-size:11px"></i>
            </button>
            ${advancedConnectionExpanded ? `
            <div style="border-radius:12px; margin:0 16px 16px;
              background:${syncEngine.isConnected ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)'};
              border:1px solid ${syncEngine.isConnected ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'};">
              <div style="display:flex; align-items:center; gap:12px; padding:12px 16px;">
                <div style="width:10px;height:10px;border-radius:50%;flex-shrink:0;background:${syncEngine.isConnected ? 'var(--success)' : 'var(--danger)'};box-shadow:0 0 6px ${syncEngine.isConnected ? 'var(--success)' : 'var(--danger)'}"></div>
                <div style="flex:1">
                  <div style="font-weight:700;font-size:13px;color:var(--text-main)">Sync Hub — ${syncEngine.isConnected ? '🟢 Online' : '🔴 Offline'}</div>
                  <div style="font-size:11px;color:var(--text-muted)">${syncEngine.isConnected ? `Connected to ws://${s.syncHubIp || window.location.hostname}:3030` : 'Not connected — set Hub IP below and click Reconnect'}</div>
                </div>
              </div>
              <div style="padding:0 16px 14px; display:flex; gap:8px;">
                <input class="form-input" id="gHubIpInput" value="${s.syncHubIp || window.location.hostname || '192.168.1.9'}" placeholder="Hub IP e.g. 192.168.1.9" style="flex:1; margin:0; font-size:13px;" />
                <button class="btn btn-ghost" id="gReconnectHubBtn" style="flex-shrink:0; border:1px solid var(--border); border-radius:10px; font-weight:700; white-space:nowrap;">
                  🔄 Reconnect Hub
                </button>
              </div>
            </div>
            ` : ''}
          </div>

          <div style="opacity: ${syncEngine.checkCapability('pro_addons') ? '1' : '0.5'}; pointer-events: ${syncEngine.checkCapability('pro_addons') ? 'auto' : 'none'}; position: relative;">
            ${!syncEngine.checkCapability('pro_addons') ? '<div style="position:absolute; top:12px; right:12px; font-size:10px; background:var(--bg-elevated); border:1px solid var(--border); padding:2px 8px; border-radius:10px; color:var(--text-muted); font-weight:700;"><i class="fa-solid fa-lock mr-4"></i> PRO ONLY</div>' : ''}

            <div class="card" style="opacity: ${syncEngine.checkCapability('register_shift') ? '1' : '0.5'}; pointer-events: ${syncEngine.checkCapability('register_shift') ? 'auto' : 'none'}; position: relative;">
              ${!syncEngine.checkCapability('register_shift') ? '<div style="position:absolute; top:12px; right:12px; font-size:10px; background:var(--bg-elevated); border:1px solid var(--border); padding:2px 8px; border-radius:10px; color:var(--text-muted); font-weight:700;"><i class="fa-solid fa-lock mr-4"></i> PRO ONLY</div>' : ''}
              <div class="font-bold mb-16" style="font-size:16px"><i class="fa-solid fa-toggle-on" style="color:var(--primary)"></i> Operations Features</div>
              <div class="form-group">
                <label class="flex items-center gap-12 cursor-pointer">
                  <input type="checkbox" id="sEnableRegister" ${s.enableRegisterRoutine !== false ? 'checked' : ''} style="width:20px;height:20px" ${!syncEngine.checkCapability('register_shift') ? 'disabled' : ''} />
                  <div>
                    <div class="font-bold">Enable Register Shift Management</div>
                    <p style="font-size:12px;opacity:0.6">Force users to open register before starting POS.</p>
                  </div>
                </label>
              </div>
            </div>
          </div>
          ${renderTabSaveContainer('saveAddonsBtn', 'Operations')}
        </div>

        <!-- License Tab Content -->
        <div class="settings-tab-content ${activeSettingsTab === 'license' ? 'active' : ''}" id="tab-license">
          ${await renderLicenseTab()}
        </div>

        <!-- Danger Zone Tab Content - Master/Super Admin Only -->
        ${['Master', 'Super Admin'].includes((await getCurrentUser())?.role) ? `
        <div class="settings-tab-content ${activeSettingsTab === 'danger' ? 'active' : ''}" id="tab-danger">
          <div class="card" style="border:2px solid rgba(245,158,11,0.25); background:rgba(245,158,11,0.05)">
            <div class="font-bold mb-16" style="font-size:16px; display:flex; align-items:center; gap:8px; color:#f59e0b">
              <i class="fa-solid fa-broom"></i> Data Maintenance
            </div>
            <p style="font-size:13px; color:var(--text-muted); margin-bottom:16px">Merges products with the same name in your current branch into a single record (stock summed together) and removes the extras. Use this if a catalog import ran more than once.</p>
            <button class="btn btn-secondary btn-sm" id="mergeDuplicateProductsBtn" style="border-radius:8px">
              <i class="fa-solid fa-code-merge mr-8"></i> Merge Duplicate Products
            </button>
          </div>

          <div class="card mt-16" style="border:2px solid rgba(239,68,68,0.2); background:rgba(239,68,68,0.05)">
            <div class="font-bold mb-16 text-danger" style="font-size:16px; display:flex; align-items:center; gap:8px">
              <i class="fa-solid fa-triangle-exclamation"></i> Danger Zone
            </div>
            <p style="font-size:13px; color:var(--text-muted); margin-bottom:16px">This action will permanently delete all local data, including users, branches, orders, and products. This cannot be undone.</p>
            <button class="btn" id="accountDeletionBtn" style="background:var(--danger); color:#fff; border:none; padding:12px 20px; font-weight:700; border-radius:10px; cursor:pointer">
              <i class="fa-solid fa-trash-can"></i> Delete All Data & Reset System
            </button>
          </div>
        </div>
        ` : ''}
      </div>
    </div>
  `;

  // Tab switching
  const tabs = container.querySelectorAll('.settings-nav-item');

  // Tax Rates UI Management
  async function renderTaxRates() {
    const tContainer = document.getElementById('taxRatesContainer');
    const select = document.getElementById('sTaxRate');
    if (!tContainer || !select) return;

    let taxes = [];
    try {
      taxes = JSON.parse(document.getElementById('sAvailableTaxes').value || '[]');
    } catch (e) {
      taxes = [];
    }

    tContainer.innerHTML = taxes.map(t => `
      <div style="background:var(--bg-elevated); border:1px solid var(--border); padding:4px 10px; border-radius:30px; display:flex; align-items:center; gap:6px; font-size:12px; font-weight:600">
        ${t}%
        <button type="button" class="remove-tax-btn" data-rate="${t}" style="background:none; border:none; color:var(--danger); cursor:pointer; padding:2px"><i class="fa-solid fa-circle-xmark"></i></button>
      </div>
    `).join('');

    const currentDefault = select.value || s.taxRate;
    select.innerHTML = taxes.map(t => `<option value="${t}" ${currentDefault == t ? 'selected' : ''}>${t}%</option>`).join('');

    tContainer.querySelectorAll('.remove-tax-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const rate = parseFloat(e.currentTarget.dataset.rate);
        taxes = taxes.filter(t => t !== rate);
        document.getElementById('sAvailableTaxes').value = JSON.stringify(taxes);
        await renderTaxRates();
      });
    });
  }

  document.getElementById('addTaxRateBtn')?.addEventListener('click', async () => {
    const input = document.getElementById('newTaxRateInput');
    const val = parseFloat(input.value);
    if (isNaN(val) || val < 0) return showToast('Enter a valid tax rate', 'warning');

    let taxes = [];
    try { taxes = JSON.parse(document.getElementById('sAvailableTaxes').value); } catch (e) { }

    if (!taxes.includes(val)) {
      taxes.push(val);
      taxes.sort((a, b) => a - b);
      document.getElementById('sAvailableTaxes').value = JSON.stringify(taxes);
      input.value = '';
      await renderTaxRates();
      showToast('Tax rate added', 'success');
    } else {
      showToast('Tax rate already exists', 'info');
    }
  });

  // Initial render
  await renderTaxRates();

  // Payment Methods UI Management (Now in General Tab)
  async function renderPaymentMethods() {
    const pContainer = document.getElementById('paymentMethodsContainer');
    if (!pContainer) return;

    let methods = [];
    try {
      methods = JSON.parse(document.getElementById('sPaymentMethods').value || '[]');
    } catch (e) {
      methods = [];
    }

    pContainer.innerHTML = methods.map(m => `
      <div style="background:var(--bg-elevated); border:1px solid var(--border); padding:6px 12px; border-radius:8px; display:flex; align-items:center; gap:8px; font-size:13px; font-weight:600">
        ${escapeHtml(m)}
        <button type="button" class="remove-payment-btn" data-method="${escapeHtml(m)}" style="background:none; border:none; color:var(--danger); cursor:pointer; padding:2px"><i class="fa-solid fa-circle-xmark"></i></button>
      </div>
    `).join('');

    pContainer.querySelectorAll('.remove-payment-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const method = e.currentTarget.dataset.method;
        methods = methods.filter(m => m !== method);
        document.getElementById('sPaymentMethods').value = JSON.stringify(methods);
        await renderPaymentMethods();
      });
    });
  }

  document.getElementById('addPaymentMethodBtn')?.addEventListener('click', async () => {
    const input = document.getElementById('newPaymentMethodInput');
    const val = input.value.trim();
    if (!val) return showToast('Enter a valid method name', 'warning');
    
    let methods = [];
    try { methods = JSON.parse(document.getElementById('sPaymentMethods').value); } catch(e) {}
    
    // Case insensitive exists check
    if (!methods.some(m => m.toLowerCase() === val.toLowerCase())) {
      methods.push(val);
      document.getElementById('sPaymentMethods').value = JSON.stringify(methods);
      input.value = '';
      await renderPaymentMethods();
    } else {
      showToast('Payment method already exists', 'info');
    }
  });

  await renderPaymentMethods();
  const contents = container.querySelectorAll('.settings-tab-content');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.getAttribute('data-tab');
      activeSettingsTab = target;
      const targetPanel = container.querySelector(`#tab-${target}`);
      if(targetPanel) targetPanel.classList.add('active');
    });
  });

  // Theme swatches
  container.querySelectorAll('.theme-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      container.querySelectorAll('.theme-swatch').forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
      const theme = swatch.dataset.theme;
      console.log('[Settings] Theme Swatch Clicked:', theme);
      window.selectedThemeChoice = theme;
      
      const themeVal = container.querySelector('#sThemeValue');
      if (themeVal) themeVal.value = theme;
      
      window.applyTheme(theme, false);
    });
  });

  // Helper for per-tab saving
  const handleSave = async (tabName, data) => {
    console.log(`[Settings] Attempting to save ${tabName} data:`, data);
    const s = await getSettings();
    const finalSettings = { ...s, ...data, updatedAt: new Date().toISOString() };
    console.log(`[Settings] Final merged settings object:`, finalSettings);
    await saveSettings(finalSettings);
    if (typeof reloadSettings === 'function') await reloadSettings();
    showToast(`${tabName} settings saved successfully!`, 'success');
  };


  // Store Logo upload/remove
  container.querySelector('#sStoreLogoFile')?.addEventListener('change', async (e) => {
    try {
      const base64 = await MediaService.handleImageUpload(e);
      if (base64) {
        container.querySelector('#sStoreLogoBase64').value = base64;
        container.querySelector('#logoPreview').innerHTML = `<img src="${base64}" style="width:100%; height:100%; object-fit:contain" />`;
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
  container.querySelector('#removeLogoBtn')?.addEventListener('click', () => {
    container.querySelector('#sStoreLogoBase64').value = '';
    container.querySelector('#logoPreview').innerHTML = `<i class="fa-solid fa-image" style="opacity:0.3"></i>`;
    container.querySelector('#sStoreLogoFile').value = '';
  });

  container.querySelector('#toggleAdvancedConnectionBtn')?.addEventListener('click', async () => {
    advancedConnectionExpanded = !advancedConnectionExpanded;
    await renderSettings(document.getElementById('page-container'));
  });

  // Reconnect Hub button — save IP and re-init WebSocket
  container.querySelector('#gReconnectHubBtn')?.addEventListener('click', async () => {
    const hubIp = container.querySelector('#gHubIpInput')?.value.trim();
    if (!hubIp) return showToast('Enter a Hub IP address', 'error');
    const cur = await getSettings();
    cur.syncHubIp = hubIp;
    await saveSettings(cur);
    showToast('Reconnecting to hub...', 'info');
    const licKey = syncEngine.licenseKey || 'GLOBAL';
    syncEngine.hubUrl = `ws://${hubIp}:3030?licenseKey=${licKey}`;
    syncEngine.retryCount = 0;
    if (syncEngine.ws) { try { syncEngine.ws.close(); } catch (e) { } }
    setTimeout(() => {
      syncEngine.connect();
      setTimeout(async () => await renderSettings(document.getElementById('page-container')), 2000);
    }, 300);
  });

  // 1. General Settings
  container.querySelector('#saveGeneralBtn')?.addEventListener('click', async () => {
    const storeName = container.querySelector('#sStoreName')?.value.trim();
    if (!storeName) return showToast('Store name is required', 'error');
    const storeAddress = container.querySelector('#sStoreAddress').value.trim();
    const storePhone = container.querySelector('#sStorePhone').value.trim();
    const storeLogo = container.querySelector('#sStoreLogoBase64')?.value || '';

    await handleSave('General', {
      storeName,
      storeNameSubtitle: container.querySelector('#sStoreNameSubtitle')?.value.trim() || '',
      storeAddress,
      storePhone,
      gstNumber: container.querySelector('#sGstNumber').value.trim(),
      upiId: container.querySelector('#sUpiId').value.trim(),
      storeLogo,
      showLogoOnReceipt: container.querySelector('#sShowLogoOnReceipt')?.checked || false,
      printBarcodeOnReceipt: container.querySelector('#sPrintBarcodeOnReceipt')?.checked || false,
      receiptFooter: container.querySelector('#sReceiptFooter').value.trim(),
      currency: container.querySelector('#sCurrency').value,
      availableTaxes: JSON.parse(container.querySelector('#sAvailableTaxes').value || '[]'),
      taxRate: parseFloat(container.querySelector('#sTaxRate').value) || 0,
      paymentMethods: JSON.parse(container.querySelector('#sPaymentMethods')?.value || '[]'),
      theme: container.querySelector('#sThemeValue')?.value || s.theme,
      enableRegisterRoutine: container.querySelector('#sEnableRegister')?.checked !== false,
      roundOffEnabled: container.querySelector('#sRoundOffEnabled')?.checked || false,
      autoPrintReceipt: document.getElementById('sAutoPrintReceipt')?.checked || false
    });

    // Keep the current branch's own record in sync with what was just saved
    // here — Branches.js already syncs branch -> Settings when a branch is
    // edited there, but that's one-way; without this, the sidebar/topbar
    // (which read store.branch.name, not settings.storeName) look "stuck" on
    // whatever name onboarding first set, no matter what gets typed here.
    const currentBranch = await getCurrentBranch();
    if (currentBranch) {
      await saveBranch({
        ...currentBranch,
        name: storeName,
        address: storeAddress,
        phone: storePhone,
        ...(storeLogo ? { image: storeLogo } : {})
      });
      store.branch = { ...store.branch, name: storeName, address: storeAddress, phone: storePhone };
      if (typeof window.renderSidebar === 'function') await window.renderSidebar();
      if (typeof window.renderTopbar === 'function') await window.renderTopbar();
    }
  });

  // 2. Industry Settings
  document.getElementById('saveIndustryBtn')?.addEventListener('click', async () => {
    await handleSave('Industry', {
      businessType: document.getElementById('sBusinessType').value,
      enableRegisterRoutine: document.getElementById('sEnableRegister').checked
    });
  });

  document.getElementById('importSupermarketBtn')?.addEventListener('click', async () => {
    const confirmed = await showConfirm({
      title: 'Import Supermarket Data?',
      message: 'This will add 50 supermarket products (Fruits, Dairy, Staples, etc.) to your current inventory. Continue?',
      okText: 'Import Now',
      okClass: 'btn-primary'
    });
    
    if (confirmed) {
      try {
        const currentBranch = await getCurrentBranch();
        const branchId = currentBranch?.id || 'b1';
        const added = await importIndustryProducts('Supermarket', branchId);
        if (added && added.length > 0) {
          showToast(`${added.length} Supermarket item(s) added successfully!`, 'success');
        } else {
          showToast('These products already exist in your inventory — nothing new to add.', 'info');
        }
        await renderSettings(container); // Re-render to show "Imported" badge
      } catch (err) {
        showToast('Import failed: ' + err.message, 'error');
      }
    }
  });

  // 3. Security Settings
  document.getElementById('saveSecurityBtn')?.addEventListener('click', async () => {
    const lockEnabled = document.getElementById('sSettingsLockEnabled')?.checked || false;
    // Blank means "keep the current PIN" (the field is never pre-filled with
    // it anymore — see the render above) — only validate/replace it when the
    // user actually typed a new one.
    const pin = document.getElementById('sMasterPin')?.value?.trim() || '';

    if (lockEnabled && !pin && !s.masterPin) {
      return showToast('Master PIN must be 4 to 6 digits!', 'error');
    }
    if (pin && (pin.length < 4 || pin.length > 6)) {
      return showToast('Master PIN must be 4 to 6 digits!', 'error');
    }

    await handleSave('Security', {
      autoLockMinutes: parseInt(document.getElementById('sAutoLock').value) || 0,
      settingsLockEnabled: lockEnabled,
      ...(pin ? { masterPin: await hashPassword(pin) } : {})
    });
  });

  // Toggle PIN field visibility
  document.getElementById('sSettingsLockEnabled')?.addEventListener('change', (e) => {
    const container = document.getElementById('masterPinContainer');
    if (container) container.style.display = e.target.checked ? 'block' : 'none';
  });

  // 4. Operations Settings
  document.getElementById('saveAddonsBtn')?.addEventListener('click', async () => {
    await handleSave('Operations', {
      autoPrintReceipt: document.getElementById('sAutoPrintReceipt')?.checked || false,
      enableRegisterRoutine: document.getElementById('sEnableRegister')?.checked !== false
    });
  });
  setupSyncStatusListeners();
  setupLicenseListeners(container);
  await setupBackupTab(container);
  setupCategoriesListeners(container);
  setupDangerZone(container);
  setupDataMaintenance(container);
}

function setupDataMaintenance(container) {
  document.getElementById('mergeDuplicateProductsBtn')?.addEventListener('click', async () => {
    const confirmed = await showConfirm({
      title: 'Merge Duplicate Products?',
      message: 'This combines products with the same name in your current branch into one record (stock summed together) and removes the extras. Past orders keep referencing a valid product. Continue?',
      okText: 'Merge Now',
      okClass: 'btn-primary'
    });
    if (!confirmed) return;

    try {
      const currentBranch = await getCurrentBranch();
      const branchId = currentBranch?.id || 'b1';
      const result = await mergeDuplicateProducts(branchId);
      if (result.length === 0) {
        showToast('No duplicate products found — nothing to merge.', 'info');
      } else {
        const names = result.map(r => escapeHtml(r.name)).join(', ');
        showToast(`Merged ${result.length} duplicate group(s): ${names}`, 'success');
      }
    } catch (err) {
      showToast('Merge failed: ' + err.message, 'error');
    }
  });
}

function setupDangerZone(container) {
  const btn = document.getElementById('accountDeletionBtn');
  if (!btn) return;

  btn.onclick = () => {
    // Stage 1
    openModal({
      title: 'Permanent Reset',
      body: `
        <div style="text-align:center; padding: 20px 0;">
          <i class="fa-solid fa-triangle-exclamation text-danger" style="font-size: 64px; margin-bottom: 24px;"></i>
          <h2 style="margin-bottom:12px; color:var(--danger)">Warning!</h2>
          <p style="font-size:15px; line-height:1.6; color:var(--text-muted); margin-bottom:32px">
            You are about to initiate a <b>Full System Reset</b>.<br>
            All records, settings, and users will be <b>permanently erased</b>.
          </p>
          
          <div style="display:flex; gap:16px; justify-content:center;">
            <button class="btn btn-ghost" onclick="closeModal()" style="flex:1">Cancel</button>
            <button class="btn btn-primary" id="confirmResetStep1" style="flex:1; background:var(--danger); border-color:var(--danger)">Proceed Anyway</button>
          </div>
        </div>
      `,
      footer: ''
    });

    document.getElementById('confirmResetStep1').onclick = () => {
      // Stage 2
      openModal({
        title: 'Confirm System Wipe',
        body: `
          <div style="text-align:center; padding: 20px 0;">
            <p style="font-size:14px; margin-bottom:24px">To confirm deletion, please type the word <b>RESET</b> in the box below:</p>
            <input type="text" id="resetWordInput" class="form-input" placeholder="Type RESET" style="text-align:center; font-size:18px; font-weight:800; letter-spacing:4px">
            
            <div style="display:flex; gap:16px; justify-content:center; margin-top:32px">
              <button class="btn btn-ghost" onclick="closeModal()" style="flex:1">Go Back</button>
              <button class="btn btn-primary" id="confirmResetStep2" disabled style="flex:1; background:var(--danger); border-color:var(--danger); opacity:0.5">Wipe Everything</button>
            </div>
          </div>
        `,
        footer: ''
      });

      const input = document.getElementById('resetWordInput');
      const confirmBtn = document.getElementById('confirmResetStep2');

      input.oninput = () => {
        const isMatch = input.value.trim().toUpperCase() === 'RESET';
        confirmBtn.disabled = !isMatch;
        confirmBtn.style.opacity = isMatch ? '1' : '0.5';
      };

      confirmBtn.onclick = async () => {
        showToast('Resetting system...', 'info');

        closeModal();
        const overlay = document.createElement('div');
        overlay.id = 'system-reset-loading-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;display:flex;justify-content:center;align-items:center;background:rgba(0,0,0,0.75);z-index:10000;';
        overlay.innerHTML = `<div style="text-align:center;color:#fff;">
          <i class="fa-solid fa-spinner fa-spin" style="font-size:52px;margin-bottom:16px;display:block;"></i>
          <div style="font-size:18px;font-weight:600;letter-spacing:0.5px;">Wiping data…</div>
        </div>`;
        document.body.appendChild(overlay);

        try {
          // Wipe business/transactional data only — deliberately NOT KEYS.SETTINGS
          // (holds licenseKey/networkId/isInstalled: clearing it made router.js's
          // `!settings.isInstalled` check force Onboarding instead of Login after
          // every reset, and silently dropped the shop's activated license) and
          // NOT KEYS.USERS/BRANCHES/REGISTERS (needed for the login screen's
          // credential + branch/register selection to actually succeed right
          // after a reset, instead of landing on a working login with nothing
          // to log into).
          //
          // KEYS.FLOORS/KEYS.TABLES/KEYS.ACTIVE_ORDERS used to be cleared here
          // too, but none of those three names exist on the KEYS object (dead
          // leftover from a removed table-management concept) — db.clear(undefined)
          // threw, which silently aborted every clear() after it AND the
          // redirect-to-login below, since none of this was wrapped in a
          // try/catch. That's the actual reason a reset never reached the
          // login screen.
          await db.clear(KEYS.PRODUCTS);
          await db.clear(KEYS.ORDERS);
          await db.clear(KEYS.CUSTOMERS);
          await db.clear(KEYS.SUPPLIERS);
          await db.clear(KEYS.PURCHASES);
          await db.clear(KEYS.SESSION);
          await db.clear(KEYS.SHIFTS);
          await db.clear(KEYS.LOYALTY_HISTORY);
          await db.clear(KEYS.STAFF);
          await db.clear(KEYS.STAFF_INCENTIVES);
          await db.clear(KEYS.RETURNS);
          await db.clear(KEYS.CATEGORIES);
          await db.clear(KEYS.INVENTORY_LOGS);
        } catch (err) {
          console.error('[Danger Zone] Reset encountered an error (continuing to redirect anyway):', err);
        }

        // The loading overlay stays on screen (covering the reload) until the
        // new page has fully replaced this one — no separate fade-out needed.
        setTimeout(() => {
          // Session is cleared but isInstalled/license/users/branches survive,
          // so the router lands on Login rather than Onboarding.
          window.location.href = '/';
        }, 1000);
      };
    };
  };
}

function timeAgo(date) {
  if (!date) return null;
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return 'just now';
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return date.toLocaleDateString();
}

async function setupBackupTab(container) {
  const isElectron = /Electron/i.test(navigator.userAgent);
  const backupTabElement = container.querySelector('#tab-backup');
  if (!backupTabElement) return;

  const canBackup = syncEngine.checkCapability('data_backup');
  if (!canBackup) {
    backupTabElement.innerHTML = `
      <div style="height:360px; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:40px; background:var(--bg-elevated); border:1px solid var(--border); border-radius:14px; gap:16px;">
        <div style="width:72px; height:72px; border-radius:50%; background:rgba(var(--primary-rgb), 0.1); display:flex; align-items:center; justify-content:center;">
          <i class="fa-solid fa-shield-halved" style="font-size:32px; color:var(--primary);"></i>
        </div>
        <div>
          <h2 style="margin-bottom:8px;">Backup & Restore</h2>
          <p style="color:var(--text-muted); max-width:320px; font-size:14px;">Automated snapshots, restore, and retention policies are premium features.</p>
        </div>
        <button class="btn btn-primary" onclick="window.selectedSettingsTab='license'; renderSettings(document.getElementById('page-container'))" style="border-radius:10px; padding:12px 24px; font-weight:700;">
          🚀 Upgrade to Pro Now
        </button>
      </div>
    `;
    return;
  }

  const settings = await getGlobalSettings();
  const b = settings.backupSettings || {};

  // Suggest an already-installed cloud-sync folder (OneDrive/Dropbox/Google
  // Drive) instead of making the user browse for one manually — only worth
  // checking if no folder has been chosen yet.
  const detectedCloudFolders = (!b.customPath && window.electronAPI?.detectCloudFolders)
    ? await window.electronAPI.detectCloudFolders().catch(() => [])
    : [];

  // --- PREMIUM STANDALONE / ELECTRON DASHBOARD ---
  const history = await read(KEYS.BACKUP_HISTORY) || [];
  const imports = await read(KEYS.IMPORT_HISTORY) || [];
  const lastBackup = history.length > 0 ? new Date(history[history.length - 1].date) : null;
  const isHealthy = lastBackup && (new Date() - lastBackup < 24 * 60 * 60 * 1000);

  backupTabElement.innerHTML = `
    <div class="backup-dashboard">
      <!-- Health Card -->
      <div class="backup-card">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:20px">
          <div>
            <div style="font-size:12px; color:var(--text-muted); text-transform:uppercase; font-weight:800; letter-spacing:1px">System Health</div>
            <div style="font-size:24px; font-weight:800; margin-top:4px">Data Security</div>
          </div>
          <div class="status-pulse" style="background: ${isHealthy ? 'var(--success)' : 'var(--warning)'}"></div>
        </div>
        <p style="font-size:13px; color:var(--text-muted); line-height:1.6">
          ${lastBackup
            ? `Last snapshot taken <b>${timeAgo(lastBackup)}</b>. ${isHealthy ? 'Your data is secure.' : 'We recommend taking a fresh snapshot.'}`
            : 'No snapshots yet. Create your first backup to keep your data safe.'}
        </p>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:20px">
          <div class="stat-box">
             <span class="value">${history.length}</span>
             <span class="label">Local Exports</span>
          </div>
          <div class="stat-box">
             <span class="value">${imports.length}</span>
             <span class="label">Restorations</span>
          </div>
        </div>
      </div>

      <!-- Action Card -->
      <div class="backup-card">
        <div style="font-size:12px; color:var(--text-muted); text-transform:uppercase; font-weight:800; letter-spacing:1px; margin-bottom:12px">Manual Control</div>
        <div style="display:flex; flex-direction:column; gap:12px">
          <button id="pBackupNowBtn" class="btn btn-primary" style="padding:14px; border-radius:12px; display:flex; align-items:center; justify-content:center; gap:10px; font-weight:700">
            <i class="fa-solid fa-shield-halved"></i> Create Secure Snapshot
          </button>
          <button id="pImportBtn" class="btn" style="padding:14px; border-radius:12px; background:var(--bg-elevated); border:1px solid var(--border); display:flex; align-items:center; justify-content:center; gap:10px; font-weight:700; color:var(--text-main)">
            <i class="fa-solid fa-file-import"></i> Restore from File
          </button>
          <input type="file" id="pBackupFileInput" accept=".json" style="display:none">
        </div>
      </div>

      <!-- Automation Card -->
      <div class="backup-card">
        <div style="font-size:12px; color:var(--text-muted); text-transform:uppercase; font-weight:800; letter-spacing:1px; margin-bottom:12px">Automation ${!isElectron ? '<span style="font-weight:600; text-transform:none; letter-spacing:0; opacity:0.7">(Desktop app only)</span>' : ''}</div>
        <div style="display:flex; flex-direction:column; gap:16px; ${!isElectron ? 'opacity:0.5; pointer-events:none;' : ''}">
           <div style="display:flex; justify-content:space-between; align-items:center">
              <div>
                 <div style="font-weight:700; font-size:14px">Auto-Backup</div>
                 <div style="font-size:11px; color:var(--text-muted)">Save to disk automatically</div>
              </div>
              <label class="switch">
                 <input type="checkbox" id="pAutoBackupToggle" ${b.enabled ? 'checked' : ''}>
                 <span class="slider round"></span>
              </label>
           </div>
           <div style="background:var(--bg-elevated); padding:12px; border-radius:10px; border:1px solid var(--border)">
              <div style="font-size:11px; color:var(--text-muted); margin-bottom:8px">Target Directory</div>
              <div style="display:flex; gap:8px">
                 <input type="text" id="pBackupPath" readonly value="${b.customPath || 'Not selected'}" style="flex:1; background:transparent; border:none; color:${b.customPath ? 'var(--text-main)' : 'var(--danger)'}; font-size:12px">
                 <button type="button" id="pBrowseBtn" style="background:var(--primary); border:none; padding:4px 10px; border-radius:6px; color:white; cursor:pointer"><i class="fa-solid fa-folder-open"></i></button>
              </div>
              ${!b.customPath ? `<div style="font-size:11px; color:var(--danger); margin-top:8px"><i class="fa-solid fa-triangle-exclamation mr-4"></i>Select a folder to enable auto-backup.</div>` : ''}
              ${detectedCloudFolders.length > 0 ? `
                <div style="margin-top:12px; padding:12px; background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.25); border-radius:10px;">
                  <div style="font-size:12px; font-weight:700; color:var(--success); margin-bottom:8px"><i class="fa-solid fa-cloud mr-6"></i>${detectedCloudFolders.map(c => c.provider).join(' / ')} detected on this PC</div>
                  <div style="display:flex; flex-direction:column; gap:6px">
                    ${detectedCloudFolders.map(c => `
                      <button type="button" class="btn btn-ghost btn-sm use-cloud-folder-btn" data-path="${c.path.replace(/"/g, '&quot;')}" data-provider="${c.provider}" style="justify-content:flex-start; border:1px solid var(--border); border-radius:8px; font-size:12px; font-weight:600; padding:8px 10px;">
                        <i class="fa-solid fa-check mr-6" style="color:var(--success)"></i> Use ${c.provider}
                      </button>
                    `).join('')}
                  </div>
                </div>
              ` : `
              <div style="font-size:11px; color:var(--text-muted); margin-top:8px; line-height:1.5">
                <i class="fa-solid fa-lightbulb mr-4" style="color:var(--warning)"></i>
                Tip: point this to a <b>OneDrive / Google Drive / Dropbox</b> folder so backups are also protected if this PC has a problem — those apps upload every new file automatically in the background.
              </div>
              `}
           </div>

           <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px">
              <div>
                 <div style="font-size:11px; color:var(--text-muted); margin-bottom:4px">Interval</div>
                 <select id="pBackupInterval" class="form-input" style="height:36px; padding:0 8px; font-size:12px; border-radius:8px">
                    <option value="onExit" ${b.interval === 'onExit' ? 'selected' : ''}>On App Close</option>
                    <option value="hourly" ${b.interval === 'hourly' ? 'selected' : ''}>Hourly</option>
                    <option value="daily" ${b.interval === 'daily' ? 'selected' : ''}>Daily</option>
                 </select>
              </div>
              <div>
                 <div style="font-size:11px; color:var(--text-muted); margin-bottom:4px">Retention (Days)</div>
                 <input type="number" id="pBackupRetention" class="form-input" value="${b.retentionDays || 7}" min="1" max="90" style="height:36px; padding:0 8px; font-size:12px; border-radius:8px">
              </div>
           </div>
        </div>
      </div>
    </div>

    <!-- History Tabs -->
    <div class="card" style="border-radius:20px; overflow:hidden">
       <div style="display:flex; gap:20px; padding:16px 24px; background:var(--bg-elevated); border-bottom:1px solid var(--border)">
          <div class="backup-tab-btn active" data-tab="exports" style="font-weight:700; font-size:13px; cursor:pointer; opacity:1; border-bottom:2px solid var(--primary); padding-bottom:8px">Recent Snapshots</div>
          <div class="backup-tab-btn" data-tab="imports" style="font-weight:700; font-size:13px; cursor:pointer; opacity:0.5; padding-bottom:8px">Import History</div>
       </div>
       <div id="pHistoryContent" style="padding:20px">
          ${await renderStandaloneExportHistory()}
       </div>
    </div>
  `;

  // --- LISTENERS ---

  // 1. Create Snapshot
  const backupNowBtn = backupTabElement.querySelector('#pBackupNowBtn');
  backupNowBtn.onclick = async () => {
    backupNowBtn.disabled = true;
    backupNowBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Securing Data...';
    try {
      const res = await BackupService.exportBackup();
      if (res && res.success) {
        showToast(res.skipped ? 'Already up to date — no changes since last backup.' : 'Snapshot created successfully! 🛡️', res.skipped ? 'info' : 'success');
        if (!res.skipped) exportHistoryPage = 1;
        await setupBackupTab(container); // Re-render
      }
    } catch (err) {
      showToast('Export failed: ' + err.message, 'error');
    } finally {
      backupNowBtn.disabled = false;
      backupNowBtn.innerHTML = '<i class="fa-solid fa-shield-halved"></i> Create Secure Snapshot';
    }
  };

  // 2. Import Logic
  const importBtn = backupTabElement.querySelector('#pImportBtn');
  const fileInput = backupTabElement.querySelector('#pBackupFileInput');
  importBtn.onclick = () => fileInput.click();
  fileInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const confirmed = await showConfirm({
      title: 'Initialize Restoration?',
      message: 'Each record in the file replaces any existing record with the same ID (records only in the file are added; nothing already here is removed). Records that are newer here than in the file are left untouched. We recommend creating a snapshot before proceeding. Continue?',
      okText: 'Start Restoration'
    });
    if (!confirmed) { fileInput.value = ''; return; }

    try {
      importBtn.disabled = true;
      importBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';
      const result = await BackupService.importBackup(file);
      if (result.success) {
        const extra = [];
        if (result.skippedStale) extra.push(`${result.skippedStale} skipped (newer data already here)`);
        if (result.failed) extra.push(`${result.failed} failed`);
        showToast(`Restored ${result.count} records!${extra.length ? ' (' + extra.join(', ') + ')' : ''} ✅`, 'success');
        setTimeout(() => location.reload(), 1500);
      }
    } catch (err) {
      showToast('Restoration failed: ' + err.message, 'error');
    } finally {
      importBtn.disabled = false;
      importBtn.innerHTML = '<i class="fa-solid fa-file-import"></i> Restore from File';
      fileInput.value = '';
    }
  };

  // 3. Automation Listeners
  const browseBtn = backupTabElement.querySelector('#pBrowseBtn');
  browseBtn.onclick = async () => {
    if (!window.electronAPI?.selectDirectory) {
      showToast('Folder selection is only available in the desktop app.', 'error');
      return;
    }
    browseBtn.disabled = true;
    try {
      const res = await window.electronAPI.selectDirectory();
      if (res.canceled || !res.filePaths?.length) return;

      const path = res.filePaths[0];
      const fresh = await getGlobalSettings();
      fresh.backupSettings = { ...fresh.backupSettings, customPath: path, enabled: true };
      await saveSettings({ ...fresh, id: 'global_settings', branchId: null });
      showToast('Backup directory updated! 📂', 'success');
      await setupBackupTab(container);
    } catch (err) {
      console.error('[Settings] selectDirectory failed:', err);
      showToast('Could not open folder picker: ' + err.message, 'error');
    } finally {
      browseBtn.disabled = false;
    }
  };

  backupTabElement.querySelectorAll('.use-cloud-folder-btn').forEach(btn => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const basePath = btn.dataset.path;
        const provider = btn.dataset.provider;
        const targetPath = `${basePath}\\POS-Backups`;
        const fresh = await getGlobalSettings();
        fresh.backupSettings = { ...fresh.backupSettings, customPath: targetPath, enabled: true };
        await saveSettings({ ...fresh, id: 'global_settings', branchId: null });
        showToast(`Backups will now sync via ${provider}! ☁️`, 'success');
        await setupBackupTab(container);
      } catch (err) {
        console.error('[Settings] use-cloud-folder failed:', err);
        showToast('Could not set that folder: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    };
  });

  backupTabElement.querySelector('#pAutoBackupToggle').onchange = async (e) => {
    const fresh = await getGlobalSettings();
    if (e.target.checked && !fresh.backupSettings?.customPath) {
      e.target.checked = false;
      showToast('Select a backup folder first.', 'error');
      return;
    }
    fresh.backupSettings = { ...fresh.backupSettings, enabled: e.target.checked };
    await saveSettings({ ...fresh, id: 'global_settings', branchId: null });
    showToast(e.target.checked ? 'Auto-backup enabled! 🛡️' : 'Auto-backup disabled.', 'info');
  };

  backupTabElement.querySelector('#pBackupInterval').onchange = async (e) => {
    const fresh = await getGlobalSettings();
    fresh.backupSettings = { ...fresh.backupSettings, interval: e.target.value };
    await saveSettings({ ...fresh, id: 'global_settings', branchId: null });
    showToast(`Interval set to: ${e.target.value}`, 'info');
  };

  backupTabElement.querySelector('#pBackupRetention').onchange = async (e) => {
    const fresh = await getGlobalSettings();
    fresh.backupSettings = { ...fresh.backupSettings, retentionDays: parseInt(e.target.value) || 7 };
    await saveSettings({ ...fresh, id: 'global_settings', branchId: null });
    showToast(`Retention set to: ${e.target.value} days`, 'info');
  };

  // 4. Tab Switching inside History
  const attachHistoryPagerListeners = (contentEl, isExports) => {
    contentEl.querySelectorAll('.history-page-btn').forEach(pageBtn => {
      pageBtn.onclick = async () => {
        if (isExports) {
          exportHistoryPage += pageBtn.dataset.dir === 'next' ? 1 : -1;
          contentEl.innerHTML = await renderStandaloneExportHistory();
        } else {
          importHistoryPage += pageBtn.dataset.dir === 'next' ? 1 : -1;
          contentEl.innerHTML = await renderStandaloneImportHistory();
        }
        attachHistoryPagerListeners(contentEl, isExports);
      };
    });
  };
  attachHistoryPagerListeners(backupTabElement.querySelector('#pHistoryContent'), true);

  backupTabElement.querySelectorAll('.backup-tab-btn').forEach(btn => {
    btn.onclick = async () => {
      backupTabElement.querySelectorAll('.backup-tab-btn').forEach(b => {
        b.classList.remove('active');
        b.style.opacity = '0.5';
        b.style.borderBottom = 'none';
      });
      btn.classList.add('active');
      btn.style.opacity = '1';
      btn.style.borderBottom = '2px solid var(--primary)';

      const content = backupTabElement.querySelector('#pHistoryContent');
      const isExports = btn.dataset.tab === 'exports';
      if (isExports) {
        content.innerHTML = await renderStandaloneExportHistory();
      } else {
        content.innerHTML = await renderStandaloneImportHistory();
      }
      attachHistoryPagerListeners(content, isExports);
    };
  });
}

function renderHistoryPager(currentPage, totalPages, pagerId) {
  if (totalPages <= 1) return '';
  return `
    <div id="${pagerId}" style="display:flex; align-items:center; justify-content:center; gap:12px; margin-top:16px;">
      <button type="button" class="btn btn-ghost btn-sm history-page-btn" data-dir="prev" ${currentPage <= 1 ? 'disabled' : ''} style="padding:6px 12px; border:1px solid var(--border); border-radius:8px;">
        <i class="fa-solid fa-chevron-left"></i>
      </button>
      <span style="font-size:12px; color:var(--text-muted); font-weight:600">Page ${currentPage} of ${totalPages}</span>
      <button type="button" class="btn btn-ghost btn-sm history-page-btn" data-dir="next" ${currentPage >= totalPages ? 'disabled' : ''} style="padding:6px 12px; border:1px solid var(--border); border-radius:8px;">
        <i class="fa-solid fa-chevron-right"></i>
      </button>
    </div>
  `;
}

async function renderStandaloneExportHistory() {
  const history = (await read(KEYS.BACKUP_HISTORY) || []).slice().reverse();
  if (history.length === 0) return `<div class="text-muted" style="text-align:center; padding:20px">No local exports found.</div>`;

  const totalPages = Math.max(1, Math.ceil(history.length / BACKUP_HISTORY_PAGE_SIZE));
  exportHistoryPage = Math.min(Math.max(1, exportHistoryPage), totalPages);
  const start = (exportHistoryPage - 1) * BACKUP_HISTORY_PAGE_SIZE;
  const pageItems = history.slice(start, start + BACKUP_HISTORY_PAGE_SIZE);

  const rows = pageItems.map(h => {
    const date = new Date(h.date).toLocaleString();
    const size = (h.size / 1024).toFixed(2) + ' KB';
    return `
      <div class="history-item">
         <div>
            <div style="font-weight:800; font-size:14px">${escapeHtml(h.filename)}</div>
            <div style="font-size:11px; color:var(--text-muted)">Created: ${date} • Size: ${size}</div>
         </div>
         <div style="display:flex; gap:8px">
            <button class="btn btn-sm" onclick="showToast('To restore, please use the Restore from File button and select this file.', 'info')" style="padding:6px 12px; font-size:11px; background:rgba(var(--primary-rgb), 0.1); color:var(--primary); border:1px solid rgba(var(--primary-rgb), 0.2)">
               <i class="fa-solid fa-eye"></i> Details
            </button>
         </div>
      </div>
    `;
  }).join('');

  return rows + renderHistoryPager(exportHistoryPage, totalPages, 'exportHistoryPager');
}

async function renderStandaloneImportHistory() {
  const history = (await read(KEYS.IMPORT_HISTORY) || []).slice().reverse();
  if (history.length === 0) return `<div class="text-muted" style="text-align:center; padding:20px">No restoration history found.</div>`;

  const totalPages = Math.max(1, Math.ceil(history.length / BACKUP_HISTORY_PAGE_SIZE));
  importHistoryPage = Math.min(Math.max(1, importHistoryPage), totalPages);
  const start = (importHistoryPage - 1) * BACKUP_HISTORY_PAGE_SIZE;
  const pageItems = history.slice(start, start + BACKUP_HISTORY_PAGE_SIZE);

  const rows = pageItems.map(h => {
    const date = new Date(h.date).toLocaleString();
    return `
      <div class="history-item">
         <div>
            <div style="font-weight:800; font-size:14px">Restored ${h.count} Records</div>
            <div style="font-size:11px; color:var(--text-muted)">Date: ${date} • Source: ${escapeHtml(h.filename)}</div>
         </div>
         <div class="badge badge-success" style="font-size:10px">SUCCESS</div>
      </div>
    `;
  }).join('');

  return rows + renderHistoryPager(importHistoryPage, totalPages, 'importHistoryPager');
}

async function showSyncDetails(store, label) {
  const items = await read(KEYS[store.toUpperCase()]) || [];
  const pending = items.filter(x => x && x.isSynced === false);

  const listHtml = pending.map(item => {
    const time = item.updatedAt ? new Date(item.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Unknown';
    return `
      <div style="padding:10px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center">
        <div>
          <div style="font-size:13px; font-weight:700">${escapeHtml(item.name) || escapeHtml(item.id) || 'Unnamed Record'}</div>
          <div style="font-size:11px; color:var(--text-muted)">Modified: ${time} • ID: ${item.id}</div>
        </div>
        <div style="font-size:10px; color:var(--warning); font-weight:700; text-transform:uppercase">Local Only</div>
      </div>
    `;
  }).join('') || '<div style="padding:20px; text-align:center; color:var(--text-muted)">No pending records found.</div>';

  openModal({
    title: `Pending Sync: ${label}`,
    body: `
      <div style="max-height:400px; overflow-y:auto">
        <p style="font-size:12px; color:var(--text-muted); margin-bottom:12px">The following ${pending.length} records have not reached the cloud yet.</p>
        ${listHtml}
      </div>
    `,
    footer: '<button class="btn btn-primary w-full" onclick="closeModal()">Close</button>'
  });
}

// ─────────────────────────────────────────────────────────────
async function renderLicenseTab() {
  const settings = await getSettings();
  const isStandalone = settings?.deploymentMode === 'standalone';

  if (isStandalone) {
    // Force Lifetime Premium View for Electron
    const statusBanner = `
        <div style="padding:22px; background: linear-gradient(135deg, rgba(99,102,241,0.1), rgba(79,70,229,0.1)); border-radius:16px; border:1px solid rgba(99,102,241,0.3); margin-bottom:24px; text-align:center; position:relative; overflow:hidden;">
          <div style="position:absolute; top:-20px; right:-20px; font-size:100px; opacity:0.05; transform:rotate(15deg);">💎</div>
          <div style="font-size:36px; margin-bottom:12px;">🏆</div>
          <div style="font-size:20px; font-weight:900; color:var(--primary); margin-bottom:6px; letter-spacing:-0.5px;">Lifetime Offline Edition</div>
          <div style="font-size:13px; color:var(--text-muted); line-height:1.5; max-width:400px; margin:0 auto 16px;">Verified Professional Desktop Identity. All features unlocked for unlimited local usage.</div>
          
          <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
             <div style="padding:6px 14px; background:rgba(16,185,129,0.1); border-radius:30px; font-size:12px; font-weight:700; color:var(--success); border:1px solid rgba(16,185,129,0.3)">Permanent Access</div>
             <div style="padding:6px 14px; background:rgba(99,102,241,0.1); border-radius:30px; font-size:12px; font-weight:700; color:var(--primary); border:1px solid rgba(99,102,241,0.3)">Standalone POS</div>
          </div>
        </div>
    `;

    const moduleList = `
      <div style="margin-top:20px; display:grid; grid-template-columns:1fr 1fr; gap:10px;">
         ${['Inventory', 'Reports', 'Employees', 'Suppliers', 'Offers', 'Cloud Sync'].map(name => `
           <div style="padding:10px 14px; border-radius:12px; background:var(--bg-elevated); border:1px solid rgba(16,185,129,0.2); display:flex; align-items:center; gap:10px;">
              <div style="width:8px; height:8px; border-radius:50%; background:var(--success); box-shadow:0 0 6px var(--success)"></div>
              <div style="font-size:12px; font-weight:600; text-transform:capitalize; color:var(--text-main)">${name}</div>
              <span style="font-size:9px; background:var(--primary); color:white; padding:1px 5px; border-radius:4px; font-weight:800;">FULL</span>
           </div>
         `).join('')}
      </div>
    `;

    return `
      <div class="card" style="padding:24px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
          <div style="font-size:16px; font-weight:800; color:var(--text-main); display:flex; align-items:center; gap:10px;">
            <i class="fa-solid fa-shield-halved" style="color:var(--primary);"></i> Standalone License
          </div>
          <div style="font-size:11px; padding:4px 10px; background:var(--primary-light); border-radius:20px; color:var(--primary); font-weight:800;">OFFLINE AUTHORITATIVE</div>
        </div>
        
        ${statusBanner}

        <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:12px; margin-bottom:24px;">
           <div style="padding:16px; background:var(--bg-elevated); border-radius:16px; border:1px solid var(--border); text-align:center;">
             <div style="font-size:10px; font-weight:800; color:var(--text-muted); text-transform:uppercase; margin-bottom:6px;">Branches</div>
             <div style="font-size:24px; font-weight:900; color:var(--primary);">Unlimited</div>
           </div>
           <div style="padding:16px; background:var(--bg-elevated); border-radius:16px; border:1px solid var(--border); text-align:center;">
             <div style="font-size:10px; font-weight:800; color:var(--text-muted); text-transform:uppercase; margin-bottom:6px;">Users</div>
             <div style="font-size:24px; font-weight:900; color:var(--primary);">Unlimited</div>
           </div>
           <div style="padding:16px; background:var(--bg-elevated); border-radius:16px; border:1px solid var(--border); text-align:center;">
             <div style="font-size:10px; font-weight:800; color:var(--text-muted); text-transform:uppercase; margin-bottom:6px;">Registers</div>
             <div style="font-size:24px; font-weight:900; color:var(--primary);">Unlimited</div>
           </div>
         </div>

         <div style="margin-bottom:32px;">
           <div style="font-size:12px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; margin-bottom:12px;">Unlocked Capabilities</div>
           <p style="font-size:12px; color:var(--text-muted); margin-bottom:16px;">This installation is configured for lifetime standalone usage with all modules activated.</p>
           ${moduleList}
         </div>
      </div>
    `;
  }
}

function setupLicenseListeners(container) {
  // --- Fix Connection Helper ---
  const fixBtn = container.querySelector('#fixConnectionBtn');
  if (fixBtn) {
    fixBtn.onclick = () => {
      window.selectedSettingsTab = 'addons';
      advancedConnectionExpanded = true;
      renderSettings(container.closest('.page-card') || document.getElementById('page-container'));
      window.showToast('Check Hub IP and click Reconnect Hub', 'info');
    };
  }

  const localHubBtn = container.querySelector('#forceLocalHubBtn');
  if (localHubBtn) {
    localHubBtn.onclick = async () => {
      localHubBtn.disabled = true;
      localHubBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-6"></i> Connecting...';
      
      await window.syncEngine.useLocalHub();
      
      setTimeout(() => {
        renderSettings(container.closest('.page-card') || document.getElementById('page-container'));
        if (window.syncEngine.isConnected) {
          window.showToast('Connected to Local Hub! 🚀', 'success');
        } else {
          window.showToast('Local Hub still offline. Check your terminal.', 'error');
        }
      }, 2000);
    };
  }

  // Note: License status changes are handled by the global sync-message listener
}

// --- CATEGORIES TAB ---
let selectedCategoryId = null;

async function renderCategoriesTab() {
  const categories = await getCategories();
  const subCategories = selectedCategoryId ? await getSubCategories(selectedCategoryId) : [];
  const selectedCat = categories.find(c => c.id === selectedCategoryId);

  return `
    <div style="display:grid; grid-template-columns: 350px 1fr; gap:20px; align-items: start;">
      <!-- Categories List -->
      <div class="card" style="padding:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px">
          <div style="font-size:15px; font-weight:800; color:var(--text-main)">Categories</div>
          <button class="btn btn-primary btn-sm" id="addCategoryBtn">
            <i class="fa-solid fa-plus"></i> New
          </button>
        </div>
        
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${categories.length === 0 ? `
            <div style="text-align:center; padding:20px; color:var(--text-muted); font-size:12px">No categories found.</div>
          ` : categories.map(cat => `
            <div class="category-item ${selectedCategoryId === cat.id ? 'active' : ''}" 
                 data-id="${cat.id}" 
                 style="padding:12px; border-radius:10px; border:1px solid ${selectedCategoryId === cat.id ? 'var(--primary)' : 'var(--border)'}; background:${selectedCategoryId === cat.id ? 'var(--primary-light-rgba)' : 'var(--bg-elevated)'}; cursor:pointer; display:flex; justify-content:space-between; align-items:center; transition:all 0.2s">
              <span style="font-weight:700; font-size:13px">${escapeHtml(cat.name)}</span>
              <div style="display:flex; gap:8px">
                <button class="btn-icon edit-category-btn" data-id="${cat.id}" title="Edit"><i class="fa-solid fa-pen-to-square"></i></button>
                <button class="btn-icon delete-category-btn" data-id="${cat.id}" title="Delete"><i class="fa-solid fa-trash text-danger"></i></button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Sub-categories List -->
      <div class="card" style="padding:20px; min-height: 400px;">
        ${!selectedCategoryId ? `
          <div style="height:350px; display:flex; flex-direction:column; align-items:center; justify-content:center; color:var(--text-muted); text-align:center">
            <i class="fa-solid fa-arrow-left" style="font-size:32px; margin-bottom:12px; opacity:0.3"></i>
            <div style="font-size:14px; font-weight:700">Select a Category</div>
            <p style="font-size:12px">Select a category from the left to manage its sub-categories.</p>
          </div>
        ` : `
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px">
            <div>
              <div style="font-size:15px; font-weight:800; color:var(--text-main)">${escapeHtml(selectedCat?.name)} <i class="fa-solid fa-chevron-right" style="font-size:10px; margin:0 4px; opacity:0.5"></i> Sub-categories</div>
              <div style="font-size:11px; color:var(--text-muted)">Manage items within this group</div>
            </div>
            <button class="btn btn-primary btn-sm" id="addSubCategoryBtn">
              <i class="fa-solid fa-plus"></i> New Sub-category
            </button>
          </div>

          <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:12px;">
            ${subCategories.length === 0 ? `
              <div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--text-muted); border:1px dashed var(--border); border-radius:12px;">
                 <div style="font-size:13px; font-weight:600">No sub-categories yet</div>
                 <button class="btn btn-ghost btn-sm mt-8" onclick="document.getElementById('addSubCategoryBtn').click()">Click here to add one</button>
              </div>
            ` : subCategories.map(sub => `
              <div style="padding:14px; background:var(--bg-elevated); border:1px solid var(--border); border-radius:12px; display:flex; justify-content:space-between; align-items:center">
                <span style="font-size:13px; font-weight:600">${escapeHtml(sub.name)}</span>
                <div style="display:flex; gap:6px">
                   <button class="btn-icon edit-subcategory-btn" data-id="${sub.id}" title="Edit"><i class="fa-solid fa-pen" style="font-size:11px"></i></button>
                   <button class="btn-icon delete-subcategory-btn" data-id="${sub.id}" title="Delete"><i class="fa-solid fa-trash text-danger" style="font-size:11px"></i></button>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    </div>
    
    <style>
      .category-item:hover { border-color: var(--primary) !important; transform: translateX(4px); }
      .category-item.active { box-shadow: 0 4px 12px rgba(99,102,241,0.1); }
      .btn-icon { background:none; border:none; padding:4px; cursor:pointer; opacity:0.6; transition:opacity 0.2s; color:inherit; }
      .btn-icon:hover { opacity:1; }
    </style>
  `;
}

function setupCategoriesListeners(container) {
  // Select Category
  container.querySelectorAll('.category-item').forEach(el => {
    el.addEventListener('click', async (e) => {
      if (e.target.closest('.btn-icon')) return;
      selectedCategoryId = el.dataset.id;
      await renderSettings(container.closest('.page-card') || document.getElementById('page-container'));
    });
  });

  // Add Category
  const addBtn = container.querySelector('#addCategoryBtn');
  if (addBtn) {
    addBtn.onclick = () => {
      openModal({
        title: 'New Category',
        body: `
          <div class="form-group">
            <label class="form-label">Category Name</label>
            <input class="form-input" id="newCatName" placeholder="e.g. Food, Drinks, Services" autofocus />
          </div>
        `,
        footer: `
          <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" id="confirmAddCat">Create Category</button>
        `
      });
      document.getElementById('confirmAddCat').onclick = async () => {
        const name = document.getElementById('newCatName').value.trim();
        if (!name) return showToast('Please enter a name', 'error');
        await saveCategory({ name });
        closeModal();
        await renderSettings(container.closest('.page-card') || document.getElementById('page-container'));
      };
    };
  }

  // Edit Category
  container.querySelectorAll('.edit-category-btn').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      const categories = await getCategories();
      const cat = categories.find(c => c.id === id);
      if (!cat) return;

      openModal({
        title: 'Edit Category',
        body: `
          <div class="form-group">
            <label class="form-label">Category Name</label>
            <input class="form-input" id="editCatName" value="${escapeHtml(cat.name)}" />
          </div>
        `,
        footer: `
          <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" id="confirmEditCat">Save Changes</button>
        `
      });
      document.getElementById('confirmEditCat').onclick = async () => {
        const name = document.getElementById('editCatName').value.trim();
        if (!name) return;
        await saveCategory({ ...cat, name });
        closeModal();
        await renderSettings(container.closest('.page-card') || document.getElementById('page-container'));
      };
    };
  });

  // Delete Category
  container.querySelectorAll('.delete-category-btn').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      const confirmed = await showConfirm({
        title: 'Delete Category',
        message: 'Are you sure? This will also delete all sub-categories within this group.',
        okText: 'Delete'
      });
      if (confirmed) {
        await deleteCategory(id);
        if (selectedCategoryId === id) selectedCategoryId = null;
        await renderSettings(container.closest('.page-card') || document.getElementById('page-container'));
      }
    };
  });

  // Add Sub-category
  const addSubBtn = container.querySelector('#addSubCategoryBtn');
  if (addSubBtn) {
    addSubBtn.onclick = () => {
      openModal({
        title: 'New Sub-category',
        body: `
          <div class="form-group">
            <label class="form-label">Sub-category Name</label>
            <input class="form-input" id="newSubName" placeholder="e.g. Pizza, Burgers, Haircut" autofocus />
          </div>
        `,
        footer: `
          <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" id="confirmAddSub">Create Sub-category</button>
        `
      });
      document.getElementById('confirmAddSub').onclick = async () => {
        const name = document.getElementById('newSubName').value.trim();
        if (!name) return;
        await saveSubCategory({ name, categoryId: selectedCategoryId });
        closeModal();
        await renderSettings(container.closest('.page-card') || document.getElementById('page-container'));
      };
    };
  }

  // Edit Sub-category
  container.querySelectorAll('.edit-subcategory-btn').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      const subCategories = await getSubCategories();
      const sub = subCategories.find(s => s.id === id);
      if (!sub) return;

      openModal({
        title: 'Edit Sub-category',
        body: `
          <div class="form-group">
            <label class="form-label">Sub-category Name</label>
            <input class="form-input" id="editSubName" value="${escapeHtml(sub.name)}" />
          </div>
        `,
        footer: `
          <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" id="confirmEditSub">Save Changes</button>
        `
      });
      document.getElementById('confirmEditSub').onclick = async () => {
        const name = document.getElementById('editSubName').value.trim();
        if (!name) return;
        await saveSubCategory({ ...sub, name });
        closeModal();
        await renderSettings(container.closest('.page-card') || document.getElementById('page-container'));
      };
    };
  });

  // Delete Sub-category
  container.querySelectorAll('.delete-subcategory-btn').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      const confirmed = await showConfirm({
        title: 'Delete Sub-category',
        message: 'Remove this sub-category?',
        okText: 'Delete'
      });
      if (confirmed) {
        await deleteSubCategory(id);
        await renderSettings(container.closest('.page-card') || document.getElementById('page-container'));
      }
    };
  });
}

function setupSyncStatusListeners() {
  // Global listener for license upgrade status changes (UI update only)
  if (!window._subStatusRegistered) {
    window.addEventListener('sync-message', async (e) => {
      const type = e.detail.type;

      if (type === 'upgrade_license_result') {
        console.log(`Settings: Received ${type}, re-rendering License tab...`);

        // Trigger a re-render if the user is looking at the license tab
        // We add a slight delay to ensure SyncEngine has updated the local indexedDB
        setTimeout(() => {
          if (document.querySelector('.settings-nav-item[data-tab="license"].active')) {
            renderSettings(document.getElementById('page-container'));
          }
        }, 800);

        if (e.detail.success) {
          window.showToast('Premium account activated! 🏆', 'success');
        }
      }
    });
    window._subStatusRegistered = true;
  }
}



// Global exposure for simple onclicks
window.renderSettings = renderSettings;
