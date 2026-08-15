import { getProducts, addProduct, updateProduct, deleteProduct, getSettings, saveSettings, getBranches, getCurrentUser, hasPermission, logInventoryChange, getInventoryLogs, getCategories, getSubCategories, getProductStockAcrossBranches, getLabelConfig, saveLabelConfig, getExpiringProducts, adjustProductStock, getStockStatus } from '../db.js';
import { store } from '../store.js';
import { openModal, closeModal } from '../components/Modal.js';
import { showToast } from '../components/Toast.js';
import { MediaService } from '../services/MediaService.js';
import { initDateRangePicker, getDefaultRange } from '../utils/dateRangeHelper.js';
import { applySessionFilter } from '../utils/sessionFilter.js';
import { escapeHtml } from '../utils/escapeHtml.js';

// Overall status for a product, honoring its own (or its variants') minStock
// rather than a flat threshold — worst-of-all-variants for variant products,
// so this stays consistent with the row badge and the Dashboard/POS alerts
// (all of which must agree on what counts as "low", see db.js's getStockStatus).
function getProductOverallStatus(p) {
  if (p.variants && p.variants.length > 0) {
    const statuses = p.variants.map(v => getStockStatus(v.stock, v.minStock));
    return statuses.every(s => s === 'out') ? 'out' : (statuses.some(s => s !== 'in') ? 'low' : 'in');
  }
  return getStockStatus(p.stock, p.minStock);
}

// Formats a Mfg/Exp label date as "16 MAR 2024" — only when the value is
// exactly the ISO yyyy-mm-dd shape the <input type="date"> field it
// defaults from produces. The label modal's date fields are still plain
// text (so a shop can type a shorthand like "10/24" instead), and loosely
// parsing THAT with `new Date()` would silently misread it as a full date
// in the current year (JS parses "10/24" as Oct 24 of this year) — so
// anything not in the strict ISO shape prints exactly as typed instead.
function formatLabelDate(val) {
  if (!val) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    const d = new Date(val + 'T00:00:00');
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, '0');
      const month = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
      return `${day} ${month} ${d.getFullYear()}`;
    }
  }
  return val;
}
const EMOJIS = [
  // No Image Fallback
  '🖼️', '📦',
  // Food
  '🍔', '🍕', '🍝', '🥪', '🌮', '🍜', '🥗', '🥘', '🍲', '🍳', '🥐', '🥨', '🥯', '🥞', '🧇', '🍗', '🍖', '🌭', '🍟', '🍣', '🍤', '🍱', '🍢', '🍙', '🍚', '🍛',
  // Desserts & Snacks
  '🍫', '🍪', '🍰', '🍦', '🍧', '🍨', '🍩', '🧁', '🥧', '🍭', '🍬', '🍮', '🍯', '🍿', '🥜', '🌰',
  // Fruits & Veggies
  '🍎', '🍏', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌽', '🥕', '🫑', '🥔', '🍠',
  // Beverages
  '☕', '🍵', '🧃', '💧', '🥤', '🍹', '🍸', '🍷', '🍺', '🍻', '🥃', '🥛', '🧉', '🍼',
  // Electronics
  '📱', '💻', '🖥️', '⌨️', '🖱️', '🔋', '🔌', '🎧', '🎙️', '📷', '📹', '🎮', '🕹️', '📺', '⌚', '💾',
  // Clothing
  '👕', '👚', '👗', '👖', '🧥', '🧤', '🧣', '👟', '👞', '👠', '👢', '🧢', '👒', '👜', '🎒', '🕶️', '💍',
  // Household & Tools
  '🏠', '🛋️', '🛏️', '🚿', '🛁', '🚽', '🪑', '🧹', '🧺', '🧻', '🧼', '🧯', '🛠️', '🔨', '🔧', '🪚', '🪜', '🪛', '🔩', '⚙️', '🖇️', '✂️', '📏', '📎',
  // Other
  '🛒', '💡', '🔑', '📚', '✏️', '🎨', '🎭', '🎫', '🏆', '⚽', '🏀', '🎸', '🎻', '🎁', '🎈', '🎍', '🧸'
];

// Local GST HSN code list for the Add/Edit Product form's autocomplete —
// 231KB, so it's dynamically imported on first use (code-split by Vite)
// rather than bundled into the main chunk that loads on every page.
let hsnCodesPromise = null;
function loadHsnCodes() {
  if (!hsnCodesPromise) {
    hsnCodesPromise = import('../data/hsnCodes.json').then(m => m.default || m);
  }
  return hsnCodesPromise;
}

let searchQ = '';
let filterCategory = 'All';
let filterStock = 'All';
const { start: defaultStart, end: defaultEnd } = getDefaultRange();
// Products are a catalog, not a transaction log — don't hide items just because
// they weren't created/updated this month. Only filter by date once the user
// explicitly picks a range via the date-picker widget below.
let filterStartDate = null;
let filterEndDate = null;
let itemsPerPage = 8;
let currentPage = 1;

// Bulk selection state (Persisted in localStorage)
let selectedIds = new Set(JSON.parse(localStorage.getItem('pos_selected_products') || '[]').map(String));

function saveSelection() {
  localStorage.setItem('pos_selected_products', JSON.stringify(Array.from(selectedIds)));
}

let isFormOpening = false;

export async function renderProducts(container) {
  if (window.posFilterStock) {
    filterStock = window.posFilterStock;
    window.posFilterStock = null;
  }
  const settings = await getSettings();
  const canManageProducts = await hasPermission('products:manage');
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Products</div>
        <div class="page-subtitle">Manage your product catalog</div>
      </div>
      <div class="flex gap-8">
        <button class="btn btn-ghost hide-desktop" id="mobileFilterToggle" style="border:1px solid var(--border); border-radius: 10px; height: 42px;">
          <i class="fa-solid fa-filter mr-8"></i> Filters
        </button>
        ${canManageProducts ? `
          <div class="import-export-btns" style="display: flex; gap: 8px;">
              <button class="btn btn-ghost" id="importBtn" title="Import Products" style="border-radius: 10px; height: 42px;">
                  <i class="fa-solid fa-file-import"></i> Import
              </button>
              <button class="btn btn-ghost" id="exportBtn" title="Export Products" style="border-radius: 10px; height: 42px;">
                  <i class="fa-solid fa-file-export"></i> Export
              </button>
          </div>
          <button class="btn btn-primary" id="addProductBtn" style="border-radius: 10px; height: 42px; font-weight: 600;">
            <i class="fa-solid fa-plus"></i> Add Product
          </button>
        ` : ''}
      </div>
    </div>

    <!-- Mobile-Specific Overrides (Products Only) -->
    <style>
      @media (max-width: 900px) {
        #filterCard {
          margin: 0 -16px 16px -16px !important;
          border-radius: 0 !important;
          border-left: none !important;
          border-right: none !important;
          box-shadow: none !important;
          background: var(--bg-surface) !important;
        }
        .products-filter-stack {
          display: flex !important;
          flex-direction: column !important;
          gap: 16px !important;
          padding: 16px !important;
          width: 100% !important;
        }
        .products-filter-stack .search-input-wrap,
        .products-filter-stack .filter-group {
          width: 100% !important;
          min-width: 0 !important;
          flex: none !important;
        }
        .products-filter-stack .form-input,
        .products-filter-stack .form-select,
        .products-filter-stack .date-picker-group {
          height: 48px !important;
          font-size: 14px !important;
          border-radius: 12px !important;
        }
        .products-filter-stack .filter-label {
          margin-bottom: 6px !important;
          display: block !important;
        }
      }
    </style>

    <!-- Bulk Actions Area -->
    <div id="bulkActionsArea"></div>
    
    <div class="mb-16" id="filterCard" style="transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1); overflow:visible">
      <div class="data-mgmt-bar products-filter-stack p-16">
        <div class="search-input-wrap">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input class="form-input" id="productSearch" placeholder="Search by name..." value="${searchQ}" />
        </div>
        
        <div class="filter-group">
          <label class="filter-label">Category</label>
          <select class="form-select" id="catFilter">
            <option value="All">All Categories</option>
            ${(await getCategories()).map(c => `<option value="${escapeHtml(c.name)}" ${filterCategory === c.name ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
          </select>
        </div>

        <div class="filter-group">
          <label class="filter-label">Stock Status</label>
          <select class="form-select" id="stockFilter">
            <option value="All" ${filterStock === 'All' ? 'selected' : ''}>All Status</option>
            <option value="In Stock" ${filterStock === 'In Stock' ? 'selected' : ''}>In Stock</option>
            <option value="Low Stock" ${filterStock === 'Low Stock' ? 'selected' : ''}>Low Stock</option>
            <option value="Out of Stock" ${filterStock === 'Out of Stock' ? 'selected' : ''}>Out of Stock</option>
            <option value="Expiring Soon" ${filterStock === 'Expiring Soon' ? 'selected' : ''}>Expiring Soon</option>
          </select>
        </div>

        <div class="filter-group">
          <label class="filter-label">Updated Range</label>
          <div class="date-picker-group">
            <i class="fa-solid fa-calendar-alt"></i>
            <input type="text" id="prod-date-range" class="form-input-clean" style="width:100%" readonly />
          </div>
        </div>
      </div>
    </div>
    
    <div id="productsTableArea">
        <div class="table-wrap" id="productsTable"></div>
        <div id="paginationArea"></div>
    </div>
  `;

  // Filter Toggle Logic (Mobile Only)
  const filterCard = document.getElementById('filterCard');
  const toggleBtn = document.getElementById('mobileFilterToggle');
  
  if (toggleBtn && filterCard) {
    const isMobile = window.innerWidth <= 900;
    if (isMobile) {
      filterCard.style.maxHeight = '0px';
      filterCard.style.opacity = '0';
      filterCard.style.marginBottom = '0';
      filterCard.style.border = 'none';
    }

    toggleBtn.addEventListener('click', () => {
      const isExpanded = filterCard.style.maxHeight !== '0px';
      if (isExpanded) {
        filterCard.style.maxHeight = '0px';
        filterCard.style.opacity = '0';
        filterCard.style.marginBottom = '0';
        toggleBtn.classList.remove('active');
        toggleBtn.style.background = 'transparent';
        toggleBtn.style.color = 'var(--text-primary)';
      } else {
        filterCard.style.maxHeight = '1500px';
        filterCard.style.opacity = '1';
        filterCard.style.marginBottom = '16px';
        toggleBtn.classList.add('active');
        toggleBtn.style.background = 'var(--primary-light)';
        toggleBtn.style.color = 'var(--primary)';
      }
    });
  }

  if (document.getElementById('addProductBtn')) {
    document.getElementById('addProductBtn').onclick = async () => {
      if (isFormOpening) return;
      isFormOpening = true;
      try {
        await openProductForm(null, container, settings.currency);
      } finally {
        isFormOpening = false;
      }
    };
  }

  document.getElementById('productSearch').addEventListener('input', async (e) => {
    searchQ = e.target.value.toLowerCase();
    currentPage = 1;
    await renderTable(container, settings.currency);
  });

  document.getElementById('catFilter').addEventListener('change', async (e) => {
    filterCategory = e.target.value;
    currentPage = 1;
    await renderTable(container, settings.currency);
  });

  document.getElementById('stockFilter').addEventListener('change', async (e) => {
    filterStock = e.target.value;
    currentPage = 1;
    await renderTable(container, settings.currency);
  });

  initDateRangePicker('prod-date-range', defaultStart, defaultEnd, async (start, end) => {
    filterStartDate = start;
    filterEndDate = end;
    currentPage = 1;
    await renderTable(container, settings.currency);
  });

  // Import
  if (document.getElementById('importBtn')) {
    document.getElementById('importBtn').onclick = async () => {
      const { openImportWizard } = await import('../components/ImportWizard.js');
      await openImportWizard(async () => await renderTable(container, settings.currency));
    };
  }

  // Export
  if (document.getElementById('exportBtn')) {
    document.getElementById('exportBtn').onclick = async () => {
      await exportProducts();
    };
  }

  await renderTable(container, settings.currency);
}

async function renderTable(container, cur) {
  const tableSettings = await getSettings();
  let productsRaw = await getProducts(store.branch?.id);
  
  let filteredProducts = productsRaw.sort((a,b) => {
    // Priority 1: updatedAt (if present)
    const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    
    if (timeB !== timeA) return timeB - timeA;
    
    // Priority 2: id (descending)
    return String(b.id).localeCompare(String(a.id));
  });

  // Filtering
  if (searchQ) {
    filteredProducts = filteredProducts.filter(p =>
      p.name.toLowerCase().includes(searchQ) ||
      (p.sku && p.sku.toLowerCase().includes(searchQ)) ||
      (p.barcode && p.barcode.toLowerCase().includes(searchQ))
    );
  }
  if (filterCategory !== 'All') {
    filteredProducts = filteredProducts.filter(p => p.category && p.category.trim().toLowerCase() === filterCategory.trim().toLowerCase());
  }
  if (filterStock === 'Expiring Soon') {
    const expiringIds = new Set((await getExpiringProducts(store.branch?.id)).map(p => String(p.id)));
    filteredProducts = filteredProducts.filter(p => expiringIds.has(String(p.id)));
  } else if (filterStock !== 'All') {
    filteredProducts = filteredProducts.filter(p => {
      const status = getProductOverallStatus(p);
      if (filterStock === 'In Stock') return status === 'in';
      if (filterStock === 'Low Stock') return status === 'low';
      if (filterStock === 'Out of Stock') return status === 'out';
      return true;
    });
  }
  if (filterStartDate && filterEndDate) {
    filteredProducts = filteredProducts.filter(p => {
      const d = (p.updatedAt || p.createdAt || new Date().toISOString()).split('T')[0];
      return d >= filterStartDate && d <= filterEndDate;
    });
  }

  // Pagination Calculation
  const totalItems = filteredProducts.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * itemsPerPage;
  const paginatedProducts = filteredProducts.slice(start, start + itemsPerPage);

  const wrap = document.getElementById('productsTable');
  if (!wrap) return;

  // Render Bulk Bar
  await renderBulkActionsBar(container, cur);

  if (totalItems === 0) {
    wrap.innerHTML = `<div class="empty-state"><i class="fa-solid fa-box-open"></i><p>No products found</p></div>`;
    document.getElementById('paginationArea').innerHTML = '';
    return;
  }

  // Check if paginated items are selected
  const paginatedIds = paginatedProducts.map(p => String(p.id));
  const someInPageSelected = paginatedIds.some(id => selectedIds.has(id));
  const allInPageSelected = paginatedIds.length > 0 && paginatedIds.every(id => selectedIds.has(id));

  // Build rows first for async stock lookups if needed, but since getProductStockAcrossBranches is likely async now too
  const canAdjustStock = await hasPermission('inventory:manage');
  const canEditProduct = await hasPermission('products:manage');
  const canDeleteProduct = await hasPermission('products:delete');
  const rows = [];
  for (const p of paginatedProducts) {
    const sid = String(p.id);
    const isSelected = selectedIds.has(sid);
    const hasVariants = p.variants && p.variants.length > 0;

    // Calculate stock/price display for variants
    let stockDisplay = parseFloat(Number(p.stock || 0).toFixed(3));
    let priceDisplay = `${cur}${p.price}`;

    if (hasVariants) {
      const totalStock = p.variants.reduce((s, v) => s + (Number(v.stock) || 0), 0);
      const minPrice = Math.min(...p.variants.map(v => Number(v.price) || 0));
      const maxPrice = Math.max(...p.variants.map(v => Number(v.price) || 0));
      stockDisplay = `${parseFloat(totalStock.toFixed(3))} (Total)`;
      priceDisplay = minPrice === maxPrice ? `${cur}${minPrice}` : `${cur}${minPrice} - ${maxPrice}`;
    }
    const stockStatus = getProductOverallStatus(p);

    let branchStockTips = '';
    if (p.sku) {
        const branchesStock = (await getProductStockAcrossBranches(p.sku) || []).filter(b => b.branchId !== (store.branch?.id || 'b1'));
        branchStockTips = `
            <div class="multi-branch-wrap" style="position:relative; display:inline-block; cursor:pointer;" onclick="this.querySelector('.branch-tooltip').style.display = this.querySelector('.branch-tooltip').style.display === 'block' ? 'none' : 'block'">
                <i class="fa-solid fa-code-branch text-primary" style="font-size:12px; opacity:0.8;"></i>
                <div class="branch-tooltip" style="display:none; position:absolute; bottom:100%; left:50%; transform:translateX(-50%); background:var(--bg-elevated); border:1px solid var(--border); padding:8px 12px; border-radius:6px; box-shadow:0 10px 15px -3px rgba(0,0,0,0.1); z-index:100; min-width:180px; white-space:nowrap; margin-bottom:8px;">
                    <div style="font-size:10px; font-weight:800; color:var(--text-muted); margin-bottom:4px; text-transform:uppercase;">Stock in other branches</div>
                    ${branchesStock.length ? branchesStock.map(x => `<div style="display:flex; justify-content:space-between; font-size:12px; border-bottom:1px solid var(--bg-main); padding:4px 0;"><span>${escapeHtml(x.branchName)}</span><span style="font-weight:700">${x.stock}</span></div>`).join('') : '<div style="font-size:11px; opacity:0.6;">No other branches</div>'}
                </div>
            </div>
        `;
    }

    rows.push(`
          <tr class="${isSelected ? 'selected' : ''}" data-id="${p.id}">
            <td class="th-checkbox" data-label="Select">
              <input type="checkbox" class="row-checkbox product-select" data-id="${sid}" ${isSelected ? 'checked' : ''} />
            </td>
            <td data-label="Product">
              <div class="flex items-center gap-12" style="justify-content: flex-start">
                <div style="width:32px;height:32px;border-radius:6px;background:var(--bg-elevated);display:flex;align-items:center;justify-content:center;overflow:hidden;font-size:18px">
                  ${p.image ? `<img src="${p.image}" style="width:100%;height:100%;object-fit:cover" />` : (p.emoji || '📦')}
                </div>
                <div style="text-align: left">
                  <div class="font-semibold">${escapeHtml(p.name)}</div>
                  ${hasVariants ? `<div style="font-size:11px;color:var(--text-secondary)">${p.variants.length} Variants</div>` : ''}
                  <div style="font-size:10px;opacity:0.6">${p.sku || 'No SKU'}</div>
                  ${(p.location?.floor || p.location?.row || p.location?.rack) ? `<div style="font-size:10px; color:var(--info); font-weight:600; margin-top:2px;"><i class="fa-solid fa-location-dot"></i> Loc: ${[p.location.floor ? `Fl: ${p.location.floor}` : '', p.location.row ? `Rw: ${p.location.row}` : '', p.location.rack ? `Rk: ${p.location.rack}` : ''].filter(Boolean).join(', ')}</div>` : ''}
                </div>
              </div>
            </td>
            <td data-label="Category"><span class="badge badge-primary">${escapeHtml(p.category)}</span></td>
            <td data-label="Price" class="font-bold text-accent">${priceDisplay}</td>
            <td data-label="Stock">
              <div style="display:flex; align-items:center; gap:6px;">
                ${stockDisplay}${!hasVariants && tableSettings.enableUnitOfMeasure !== false ? ` ${escapeHtml(p.unit || 'pcs')}` : ''}
                ${branchStockTips}
              </div>
            </td>
            <td data-label="Status">
              <span class="badge ${stockStatus === 'in' ? 'badge-success' : stockStatus === 'low' ? 'badge-warning' : 'badge-danger'}">
                ${stockStatus === 'in' ? 'In Stock' : stockStatus === 'low' ? 'Low Stock' : 'Out of Stock'}
              </span>
            </td>
            <td>
              <div class="flex gap-8">
                <button class="btn btn-ghost btn-sm history-btn" data-id="${p.id}" title="Stock History"><i class="fa-solid fa-clock-rotate-left"></i></button>
                ${canAdjustStock ? `<button class="btn btn-ghost btn-sm adjust-stock-btn" data-id="${p.id}" title="Adjust Stock"><i class="fa-solid fa-scale-balanced"></i></button>` : ''}
                <button class="btn btn-ghost btn-sm print-barcode-btn" data-id="${p.id}" title="Print Barcode" ${!p.barcode ? 'disabled style="opacity:0.4"' : ''}><i class="fa-solid fa-barcode"></i></button>
                ${canEditProduct ? `<button class="btn btn-ghost btn-sm edit-btn" data-id="${p.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>` : ''}
                ${canDeleteProduct ? `<button class="btn btn-sm delete-btn" style="background:rgba(239,68,68,0.1);color:var(--danger)" data-id="${p.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>` : ''}
              </div>
            </td>
          </tr>
    `);
  }

  wrap.innerHTML = `
    <table class="responsive-table">
      <thead><tr>
        <th class="th-checkbox"><input type="checkbox" class="row-checkbox" id="selectAll" ${allInPageSelected ? 'checked' : ''} /></th>
        <th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th>Actions</th>
      </tr></thead>
      <tbody>
        ${rows.join('')}
      </tbody>
    </table>
  `;

  await renderPagination(totalPages, container, cur);

  // Table Event Listeners
  const selectAllEl = document.getElementById('selectAll');
  if (selectAllEl) {
    selectAllEl.indeterminate = someInPageSelected && !allInPageSelected;
    selectAllEl.onclick = async (e) => {
      if (e.target.checked) {
        paginatedProducts.forEach(p => selectedIds.add(String(p.id)));
      } else {
        paginatedProducts.forEach(p => selectedIds.delete(String(p.id)));
      }
      saveSelection();
      await renderTable(container, cur);
    };
  }

  wrap.querySelectorAll('.product-select').forEach(cb => {
    cb.onclick = async (e) => {
      const id = String(cb.dataset.id);
      if (cb.checked) selectedIds.add(id);
      else selectedIds.delete(id);
      saveSelection();
      await renderTable(container, cur);
      e.stopPropagation(); // Prevent row click conflicts if any added later
    };
  });

  wrap.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const allP = await getProducts(store.branch?.id);
      const p = allP.find(item => item.id == btn.dataset.id);
      // Re-fetches fresh at click-time rather than trusting the already-rendered
      // row, so a product deleted elsewhere (another tab, multi-branch sync)
      // between render and click is caught here instead of silently opening
      // an empty "Add New Product" form (openProductForm treats a missing
      // product the same as "no product" = add mode).
      if (!p) {
        showToast('This product no longer exists — it may have been deleted elsewhere.', 'error');
        await renderTable(container, cur);
        return;
      }
      await openProductForm(p, container, cur);
    });
  });

  wrap.querySelectorAll('.history-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const allP = await getProducts(store.branch?.id);
      const p = allP.find(item => item.id == btn.dataset.id);
      await openStockHistoryModal(p);
    });
  });

  wrap.querySelectorAll('.adjust-stock-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const allP = await getProducts(store.branch?.id);
      const p = allP.find(item => item.id == btn.dataset.id);
      await openAdjustStockModal(p, container, cur);
    });
  });

  wrap.querySelectorAll('.print-barcode-btn').forEach(btn => {
    btn.onclick = async () => {
      const allP = await getProducts(store.branch?.id);
      const p = allP.find(item => item.id == btn.dataset.id);
      await openLabelModal(p, 'barcode');
    };
  });

  wrap.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => await confirmDelete(btn.dataset.id, container, cur));
  });
}

async function renderBulkActionsBar(container, cur) {
  const area = document.getElementById('bulkActionsArea');
  if (!area) return;

  if (selectedIds.size === 0) {
    area.innerHTML = '';
    return;
  }

  area.innerHTML = `
    <div class="bulk-actions-bar">
      <div class="bulk-actions-info">
        <i class="fa-solid fa-square-check"></i> ${selectedIds.size} products selected
      </div>
      <div class="flex gap-8">
        <button class="btn btn-sm btn-ghost" id="exportSelectedBtn" style="color:#fff; border-color:rgba(255,255,255,0.3)">
          <i class="fa-solid fa-file-csv"></i> Export CSV Selected
        </button>
        <button class="btn btn-sm btn-danger" id="bulkDeleteBtn">
          <i class="fa-solid fa-trash"></i> Delete Selected
        </button>
        <button class="btn btn-sm" id="clearSelectionBtn" style="background:rgba(255,255,255,0.2);color:#fff">
          Cancel
        </button>
      </div>
    </div>
  `;

  document.getElementById('exportSelectedBtn').onclick = async () => await exportProducts(Array.from(selectedIds));
  document.getElementById('bulkDeleteBtn').onclick = async () => await confirmBulkDelete(container, cur);
  document.getElementById('clearSelectionBtn').onclick = async () => {
    selectedIds.clear();
    saveSelection();
    await renderTable(container, cur);
  };
}

async function renderPagination(totalPages, container, cur) {
  const pagArea = document.getElementById('paginationArea');
  if (!pagArea) return;

  let html = `
    <div class="pagination-bar">
      <span>Showing page <b>${currentPage}</b> of <b>${totalPages}</b></span>
      <div class="pagination-controls">
        <button class="pagination-btn" id="prevPage" ${currentPage === 1 ? 'disabled' : ''}>
          <i class="fa-solid fa-chevron-left"></i>
        </button>
  `;

  for (let i = 1; i <= totalPages; i++) {
    if (totalPages > 5 && Math.abs(i - currentPage) > 2 && i !== 1 && i !== totalPages) {
      if (i === 2 || i === totalPages - 1) html += `<span style="padding: 0 4px">...</span>`;
      continue;
    }
    html += `<button class="pagination-btn ${i === currentPage ? 'active' : ''} page-num-btn" data-page="${i}">${i}</button>`;
  }

  html += `
        <button class="pagination-btn" id="nextPage" ${currentPage === totalPages ? 'disabled' : ''}>
          <i class="fa-solid fa-chevron-right"></i>
        </button>
      </div>
    </div>
  `;

  pagArea.innerHTML = html;

  document.getElementById('prevPage').onclick = async () => {
    if (currentPage > 1) {
      currentPage--;
      await renderTable(container, cur);
    }
  };
  document.getElementById('nextPage').onclick = async () => {
    if (currentPage < totalPages) {
      currentPage++;
      await renderTable(container, cur);
    }
  };
  pagArea.querySelectorAll('.page-num-btn').forEach(btn => {
    btn.onclick = async () => {
      currentPage = parseInt(btn.dataset.page);
      await renderTable(container, cur);
    };
  });
}

function convertToCSV(data) {
  if (data.length === 0) return "";
  
  // Columns matched to ImportWizard's expected fields for a seamless export -> re-import cycle
  const headers = ['Name', 'Variant Name', 'SKU', 'Barcode', 'Category', 'SubCategory', 'Price', 'Cost Price', 'MRP', 'Stock', 'Min Stock', 'Unit', 'HSN Code', 'Tax Rate (%)', 'Emoji', 'Expiry Date', 'Manufacturing Date'];

  const rows = [];
  data.forEach(p => {
    const name = `"${(p.name || '').replace(/"/g, '""')}"`;
    const sku = `"${(p.sku || '').replace(/"/g, '""')}"`;
    const barcode = `"${(p.barcode || '').replace(/"/g, '""')}"`;
    const category = `"${(p.category || '').replace(/"/g, '""')}"`;
    const subCat = `"${(p.subCategory || '').replace(/"/g, '""')}"`;
    const unit = `"${(p.unit || 'pcs').replace(/"/g, '""')}"`;
    const hsn = `"${(p.hsnCode || '').replace(/"/g, '""')}"`;
    const tax = p.taxRate !== undefined && p.taxRate !== null ? p.taxRate : '';
    const emoji = `"${(p.emoji || '📦').replace(/"/g, '""')}"`;
    const exp = `"${(p.expiryDate || '').replace(/"/g, '""')}"`;
    const mfg = `"${(p.manufacturingDate || '').replace(/"/g, '""')}"`;
    const mrp = p.mrp !== undefined && p.mrp !== null ? p.mrp : '';

    if (p.variants && p.variants.length > 0) {
      // Export each variant as its own row so ImportWizard can reconstruct the group
      p.variants.forEach(v => {
        const vName = `"${(v.name || '').replace(/"/g, '""')}"`;
        const vPrice = v.price || 0;
        const vCost = v.costPrice !== undefined && v.costPrice !== null ? v.costPrice : '';
        const vStock = v.stock || 0;
        const vMin = v.minStock !== undefined && v.minStock !== null ? v.minStock : '';

        rows.push([name, vName, sku, barcode, category, subCat, vPrice, vCost, mrp, vStock, vMin, unit, hsn, tax, emoji, exp, mfg].join(','));
      });
    } else {
      // Standalone product
      const vName = '""';
      const vPrice = p.price || 0;
      const vCost = p.costPrice !== undefined && p.costPrice !== null ? p.costPrice : '';
      const vStock = p.stock || 0;
      const vMin = p.minStock !== undefined && p.minStock !== null ? p.minStock : '';

      rows.push([name, vName, sku, barcode, category, subCat, vPrice, vCost, mrp, vStock, vMin, unit, hsn, tax, emoji, exp, mfg].join(','));
    }
  });

  return [headers.join(','), ...rows].join('\n');
}

async function exportProducts(ids = null) {
  let products = await getProducts(store.branch?.id);
  if (ids && ids.length > 0) {
    const stringIds = ids.map(String);
    products = products.filter(p => stringIds.includes(String(p.id)));
  }

  if (products.length === 0) {
    showToast("No products to export", "warning");
    return;
  }

  const csvContent = convertToCSV(products);
  const dataStr = "data:text/csv;charset=utf-8," + encodeURIComponent(csvContent);
  const downloadAnchorNode = document.createElement('a');
  downloadAnchorNode.setAttribute("href", dataStr);
  downloadAnchorNode.setAttribute("download", `products_${ids ? 'selected' : 'all'}_${new Date().getTime()}.csv`);
  document.body.appendChild(downloadAnchorNode);
  downloadAnchorNode.click();
  downloadAnchorNode.remove();
  showToast(`${products.length} Products exported to CSV`, 'success');
}

async function confirmBulkDelete(container, cur) {
  openModal({
    title: 'Bulk Delete',
    body: `<p style="color:var(--text-secondary)">Are you sure you want to delete <b>${selectedIds.size}</b> selected products? This action cannot be undone.</p>`,
    footer: `
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" id="confirmBulkDeleteBtn"><i class="fa-solid fa-trash"></i> Delete All Selected</button>
    `,
  });
  document.getElementById('confirmBulkDeleteBtn').addEventListener('click', async () => {
    for (const id of selectedIds) {
      await deleteProduct(id);
    }
    selectedIds.clear();
    saveSelection();
    closeModal();
    showToast('Selected products deleted', 'info');
    await renderTable(container, cur);
  });
  window.closeModal = closeModal;
}

async function openProductForm(product, container, cur) {
  const settings = await getSettings();
  const isEdit = !!product;
  let hasVariants = !!(product?.variants && product.variants.length > 0);
  let variants = product?.variants ? [...product.variants] : [];

  function renderVariantList() {
    const vList = document.getElementById('variantList');
    if (!vList) return;
    if (!hasVariants) {
      vList.innerHTML = '';
      return;
    }
    vList.innerHTML = `
      <div class="variant-list">
        <div class="variant-row">
          <span style="flex:2; font-size:11px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em">Variant Name</span>
          <span style="flex:1; font-size:11px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em">Cost</span>
          <span style="flex:1; font-size:11px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em">Price</span>
          <span style="flex:1; font-size:11px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em">Stock</span>
          <span style="flex:1; font-size:11px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em">Min</span>
          <span style="width:36px"></span>
        </div>
        ${variants.map((v, i) => `
          <div class="variant-row">
            <input class="form-input" style="flex:2" placeholder="Variant Name" value="${escapeHtml(v.name || '')}" data-idx="${i}" data-key="name" />
            <input class="form-input" style="flex:1" type="number" placeholder="Cost" value="${v.costPrice ?? ''}" data-idx="${i}" data-key="costPrice" title="Cost Price" />
            <input class="form-input" style="flex:1" type="number" placeholder="Price" value="${v.price ?? ''}" data-idx="${i}" data-key="price" title="Selling Price" />
            <input class="form-input" style="flex:1" type="number" placeholder="Stock" value="${v.stock ?? ''}" data-idx="${i}" data-key="stock" title="Stock" />
            <input class="form-input" style="flex:1" type="number" placeholder="Min" value="${v.minStock ?? ''}" data-idx="${i}" data-key="minStock" title="Min Stock Level" />
            <button class="btn btn-icon remove-variant-btn" data-idx="${i}" style="color:var(--danger)"><i class="fa-solid fa-minus"></i></button>
          </div>
        `).join('')}
        <button class="btn btn-ghost btn-sm w-full mt-8" id="addVariantBtn"><i class="fa-solid fa-plus"></i> Add Variant Option</button>
      </div>
    `;

    vList.querySelectorAll('input').forEach(input => {
      input.oninput = () => {
        const idx = input.dataset.idx;
        const key = input.dataset.key;
        variants[idx][key] = key === 'name' ? input.value : parseFloat(input.value);
      };
    });

    vList.querySelectorAll('.remove-variant-btn').forEach(btn => {
      btn.onclick = () => {
        variants.splice(btn.dataset.idx, 1);
        renderVariantList();
      };
    });

    document.getElementById('addVariantBtn').onclick = () => {
      variants.push({ name: '', price: 0, stock: 0, itemDiscount: 0 });
      renderVariantList();
    };
  }

  // Consistent "card" wrapper + section header for every group below — same
  // visual language, just applied uniformly instead of the previous mix of
  // <hr> dividers, one-off boxed sections, and plain ungrouped rows.
  const section = (icon, title, innerHtml, extraStyle = '') => `
    <div style="margin-bottom:16px; padding:18px 20px; background:var(--bg-elevated); border-radius:var(--radius); border:1px solid var(--border); ${extraStyle}">
      <div style="font-size:11px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.6px; margin-bottom:14px; display:flex; align-items:center; gap:8px">
        <i class="fa-solid ${icon}" style="color:var(--primary); font-size:12px"></i> ${title}
      </div>
      ${innerHtml}
    </div>
  `;

  openModal({
    title: isEdit ? `<i class="fa-solid fa-pen-to-square mr-8"></i> Edit Product` : `<i class="fa-solid fa-cart-plus mr-8"></i> Add New Product`,
    body: `
      <!-- Product Identity -->
      <div style="margin-bottom: 16px; padding: 20px; background: var(--bg-elevated); border-radius: var(--radius); border: 1px solid var(--border)">
         <div style="display:flex; gap:24px; align-items:flex-start">
            <div style="width:100px; display:flex; flex-direction:column; gap:12px">
              <div id="imagePreview" style="width:100px; height:100px; border-radius:12px; background:var(--bg-app); border:2px solid var(--border); display:flex; align-items:center; justify-content:center; overflow:hidden; box-shadow: var(--shadow-sm)">
                ${product?.image ? '<img src="' + product.image + '" style="width:100%;height:100%;object-fit:cover" />' : '<span style="font-size:40px">' + (product?.emoji || '📦') + '</span>'}
              </div>
              <input type="file" id="pImageFile" accept="image/*" style="display:none" />
              <button class="btn btn-ghost btn-sm w-full" onclick="document.getElementById('pImageFile').click()"><i class="fa-solid fa-camera mr-4"></i> Photo</button>
              <button class="btn btn-ghost btn-sm w-full" id="removeImgBtn" style="color:var(--danger); font-size:11px; ${product?.image ? '' : 'display:none'}"><i class="fa-solid fa-xmark mr-4"></i> Remove</button>
            </div>
            <div style="flex:1">
               <div class="form-group mb-16">
                  <label class="form-label required">Product Name</label>
                  <div class="search-input-wrap">
                    <i class="fa-solid fa-box"></i>
                    <input class="form-input" id="pName" placeholder="Enter product name" value="${product?.name || ''}" style="font-weight:700; font-size:16px" />
                  </div>
               </div>
               <div class="form-group mb-0">
                <label class="form-label">Emoji Shortcut</label>
                <div style="display:flex;flex-wrap:wrap;gap:6px;padding:8px;background:var(--bg-app);border-radius:10px;max-height:80px;overflow-y:auto; border:1px solid var(--border)" id="emojiPicker">
                  ${EMOJIS.map(e => '<span class="emoji-option" data-emoji="' + e + '" style="font-size:20px;cursor:pointer;padding:4px;border-radius:6px;transition:all 0.15s;' + (product?.emoji === e ? 'background:var(--primary); color:white' : '') + '"> ' + e + '</span>').join('')}
                </div>
                <input type="hidden" id="selectedEmoji" value="${product?.emoji || '📦'}" />
              </div>
            </div>
         </div>
         <input type="hidden" id="pImageBase64" value="${product?.image || ''}" />
      </div>

      ${section('fa-fingerprint', 'Identification', `
        <div class="form-grid">
          <div class="form-group mb-0">
            <label class="form-label">SKU / Item Code</label>
            <div class="search-input-wrap">
              <i class="fa-solid fa-barcode"></i>
              <input class="form-input" id="pSKU" placeholder="SKU-1001" value="${product?.sku || ''}" />
            </div>
          </div>
          <div class="form-group mb-0">
            <label class="form-label">Barcode Number</label>
            <div class="search-input-wrap">
              <i class="fa-solid fa-upc-scan"></i>
              <input class="form-input" id="pBarcode" placeholder="Scanning allowed" value="${product?.barcode || ''}" />
            </div>
          </div>
          <div class="form-group mb-0">
            <label class="form-label required">Category</label>
            <div class="search-input-wrap">
              <i class="fa-solid fa-layer-group"></i>
              <select class="form-select" id="pCategory" style="padding-left:36px">
                <option value="">Select Category</option>
                ${(await getCategories()).map(c => '<option value="' + escapeHtml(c.name) + '" data-id="' + c.id + '" ' + (product?.category === c.name ? 'selected' : '') + '>' + escapeHtml(c.name) + '</option>').join('')}
              </select>
            </div>
          </div>
          <div class="form-group mb-0">
            <label class="form-label">Sub-category</label>
            <div class="search-input-wrap">
              <i class="fa-solid fa-list-ul"></i>
              <select class="form-select" id="pSubCategory" style="padding-left:36px">
                <option value="">None</option>
              </select>
            </div>
          </div>
        </div>
      `)}

      <!-- Pricing & Stock -->
      <div id="singleProductPriceArea" style="${hasVariants ? 'display:none' : ''}">
        ${section('fa-coins', 'Pricing & Stock', `
          <div class="form-grid">
            <div class="form-group mb-0">
              <label class="form-label">Purchase / Cost Price</label>
              <div class="search-input-wrap">
                <i class="fa-solid fa-money-bill-transfer"></i>
                <input class="form-input" id="pCostPrice" type="number" placeholder="0.00" value="${product?.costPrice || ''}" min="0" style="padding-left:36px" />
              </div>
            </div>
            <div class="form-group mb-0">
              <label class="form-label required" style="color:var(--primary)">Selling Price</label>
              <div class="search-input-wrap">
                <i class="fa-solid fa-indian-rupee-sign" style="color:var(--primary)"></i>
                <input class="form-input" id="pPrice" type="number" placeholder="0.00" value="${product?.price || ''}" min="0" style="padding-left:36px; border-color:var(--primary); font-weight:700" />
              </div>
            </div>
            <div class="form-group mb-0">
              <label class="form-label required">Opening Stock</label>
              <div class="search-input-wrap">
                <i class="fa-solid fa-boxes-stacked"></i>
                <input class="form-input" id="pStock" type="number" placeholder="0" value="${product?.stock ?? ''}" min="0" style="padding-left:36px" />
              </div>
            </div>
            <div class="form-group mb-0">
              <label class="form-label">Low Stock Warning</label>
              <div class="search-input-wrap">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <input class="form-input" id="pMinStock" type="number" placeholder="5" value="${product?.minStock ?? 5}" min="0" style="padding-left:36px" />
              </div>
            </div>
            ${settings.enableUnitOfMeasure !== false ? `
            <div class="form-group mb-0">
              <label class="form-label">Unit</label>
              <select class="form-input" id="pUnit">
                ${(settings.unitsOfMeasure && settings.unitsOfMeasure.length ? settings.unitsOfMeasure : ['pcs', 'kg', 'g', 'ltr', 'dz', 'box']).map(u =>
                  `<option value="${escapeHtml(u)}" ${(product?.unit || 'pcs') === u ? 'selected' : ''}>${escapeHtml(u)}${u.toLowerCase() === 'kg' ? ' ⚖️' : ''}</option>`
                ).join('')}
              </select>
              <p class="form-help-text">"kg" pulls this product's quantity straight from a connected Weight Scale in POS (Settings &gt; Weight Scale). Manage the full list in Settings &gt; General.</p>
            </div>
            ` : ''}
          </div>
        `)}
      </div>

      ${section('fa-calendar-days', 'Tracking Info (optional)', `
        <div class="form-grid">
          <div class="form-group mb-0">
            <label class="form-label">MRP</label>
            <div class="search-input-wrap">
              <i class="fa-solid fa-tag"></i>
              <input class="form-input" id="pMRP" type="number" placeholder="0.00" value="${product?.mrp || ''}" min="0" style="padding-left:36px" />
            </div>
            <p class="form-help-text">Printed on the label alongside the selling price, if set.</p>
          </div>
          <div class="form-group mb-0">
            <label class="form-label">Manufacturing Date</label>
            <div class="search-input-wrap">
              <i class="fa-solid fa-calendar-check"></i>
              <input class="form-input" id="pManufacturingDate" type="date" value="${product?.manufacturingDate || ''}" style="padding-left:36px" />
            </div>
          </div>
          <div class="form-group mb-0">
            <label class="form-label">Expiry Date</label>
            <div class="search-input-wrap">
              <i class="fa-solid fa-calendar-xmark"></i>
              <input class="form-input" id="pExpiryDate" type="date" value="${product?.expiryDate || ''}" style="padding-left:36px" />
            </div>
          </div>
        </div>
      `)}

      ${section('fa-receipt', 'Tax & Compliance', `
        <div class="form-grid">
          <div class="form-group mb-0">
            <label class="form-label">Tax Configuration</label>
            <div id="pTaxRateRow" style="display:flex; gap:8px">
              <select class="form-select" id="pTaxType" style="flex:1">
                <option value="exclusive" ${(product?.taxType || 'inclusive') === 'exclusive' ? 'selected' : ''}>Exclusive (+)</option>
                <option value="inclusive" ${(product?.taxType || 'inclusive') === 'inclusive' ? 'selected' : ''}>Inclusive</option>
              </select>
              ${(() => {
                // A product's saved taxRate might not be one of the shop's
                // configured preset slabs (e.g. picked via HSN autocomplete
                // for a rate like 12%/0.25% that isn't in Settings > Tax
                // Rates) — applyHsnTaxRate() below already handles that by
                // inserting a matching <option> at save time, but reopening
                // the SAME product for edit used to rebuild this <select>
                // purely from settings.availableTaxes: none of the presets
                // matched the product's real rate, nothing got `selected`,
                // and the browser silently defaulted to whichever option
                // came first — re-saving then overwrote the correct rate
                // with that wrong default. Insert the product's own rate
                // here too if it's missing, mirroring applyHsnTaxRate's
                // insertion logic so initial render and HSN-driven changes
                // stay consistent.
                const presetRates = settings.availableTaxes || [];
                const productRate = product?.taxRate;
                const allRates = (productRate != null && !presetRates.some(t => t == productRate))
                  ? [...presetRates, productRate].sort((a, b) => a - b)
                  : presetRates;
                const options = allRates.length
                  ? allRates.map(t => '<option value="' + t + '" ' + ((product?.taxRate ?? 0) == t ? 'selected' : '') + '>' + t + '%</option>').join('')
                  : '<option value="0">No rates — add in Settings</option>';
                return `<select class="form-select" id="pTaxRate" style="width:100px" ${allRates.length ? '' : 'disabled'}>${options}</select>`;
              })()}
            </div>
            <label style="display:flex; align-items:center; gap:6px; margin-top:8px; cursor:pointer; font-size:12px; font-weight:600; color:var(--text-muted);">
              <input type="checkbox" id="pNoTaxToggle" ${(product && Number(product.taxRate) === 0) ? 'checked' : ''} style="width:14px; height:14px; cursor:pointer;" />
              No Tax / Exempt <span style="font-weight:400; opacity:0.8;">(e.g. fresh produce, GST-exempt items)</span>
            </label>
          </div>
          <div class="form-group mb-0">
              <label class="form-label">HSN / SAC Code</label>
              <div class="search-input-wrap">
                <i class="fa-solid fa-hashtag"></i>
                <input class="form-input" id="pHSN" placeholder="Type a code or product description to search" value="${product?.hsnCode || ''}" style="padding-left:36px" autocomplete="off" />
                <div id="hsnSuggestions" class="search-suggestions custom-scrollbar"></div>
              </div>
              <p class="form-help-text">Searches the local GST HSN code list — pick a match or type your own. Data: <a href="https://hsnlookup.in" target="_blank" rel="noopener">hsnlookup.in</a> (CC-BY-4.0).</p>
          </div>
        </div>
      `)}

      ${section('fa-percent', 'Item Discount (optional)', `
        <div class="form-group mb-0">
          <div class="discount-amount-group">
            <span class="discount-amount-prefix" id="pItemDiscountPrefix">${(product?.itemDiscountType || 'flat') === 'pct' ? '%' : cur}</span>
            <input class="form-input" id="pItemDiscount" type="number" placeholder="0" value="${product?.itemDiscount ?? 0}" min="0" />
            <select class="form-select" id="pItemDiscountType">
              <option value="flat" ${(product?.itemDiscountType || 'flat') === 'flat' ? 'selected' : ''}>Fixed Amount</option>
              <option value="pct" ${product?.itemDiscountType === 'pct' ? 'selected' : ''}>Percentage</option>
            </select>
          </div>
          <p class="form-help-text">Applied automatically whenever this product is added to the cart.</p>
        </div>
      `)}

      ${section('fa-sliders', 'Options', `
        <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:12px">
           <label style="display:flex; align-items:center; gap:8px; padding:10px; background:var(--bg-app); border-radius:8px; border:1px solid var(--border); cursor:pointer">
              <input type="checkbox" id="hasVariantsToggle" ${hasVariants ? 'checked' : ''} style="width:18px;height:18px" />
              <span style="font-size:12px; font-weight:600"><i class="fa-solid fa-tags mr-4"></i> Variants</span>
           </label>
           <label style="display:flex; align-items:center; gap:8px; padding:10px; background:var(--bg-app); border-radius:8px; border:1px solid var(--border); cursor:pointer">
              <input type="checkbox" id="isReturnableToggle" ${product?.isReturnable !== false ? 'checked' : ''} style="width:18px;height:18px" />
              <span style="font-size:12px; font-weight:600"><i class="fa-solid fa-rotate-left mr-4"></i> Returnable</span>
           </label>
           <label style="display:flex; align-items:center; gap:8px; padding:10px; background:var(--bg-app); border-radius:8px; border:1px solid var(--border); cursor:pointer">
              <input type="checkbox" id="allowNegativeStockToggle" ${product?.allowNegativeStock ? 'checked' : ''} style="width:18px;height:18px" />
              <span style="font-size:12px; font-weight:600"><i class="fa-solid fa-triangle-exclamation mr-4"></i> Sell When Out of Stock</span>
           </label>
        </div>
        <div id="variantList"></div>
      `)}

      ${section('fa-warehouse', 'Storage Location', `
        <div class="form-grid">
          <div class="form-group mb-0">
            <input type="text" class="form-input" id="pFloor" placeholder="Floor (e.g. Ground)" value="${product?.location?.floor || ''}" />
          </div>
          <div style="display:flex; gap:8px">
            <input type="text" class="form-input" id="pRow" placeholder="Row (e.g. A2)" value="${product?.location?.row || ''}" />
            <input type="text" class="form-input" id="pRack" placeholder="Rack (e.g. Shelf 4)" value="${product?.location?.rack || ''}" />
          </div>
        </div>
      `, 'margin-bottom:0')}
    `,
    footer: `
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="saveProductBtn" style="min-width: 150px">
        <i class="fa-solid fa-floppy-disk mr-8"></i> ${isEdit ? 'Update Product' : 'Create Product'}
      </button>
    `
  });

  // Dynamic Sub-category logic
  const catSelect = document.getElementById('pCategory');
  const subSelect = document.getElementById('pSubCategory');

  async function updateSubOptions(selectedCatName, selectedSubName) {
    const categories = await getCategories();
    const cat = categories.find(c => c.name === selectedCatName);
    if (!cat) {
      subSelect.innerHTML = '<option value="">None</option>';
      return;
    }
    const subs = await getSubCategories(cat.id);
    subSelect.innerHTML = '<option value="">None</option>' + 
      subs.map(s => `<option value="${escapeHtml(s.name)}" ${selectedSubName === s.name ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('');
  }

  catSelect.onchange = async () => await updateSubOptions(catSelect.value);
  
  // Initial sub-options
  await updateSubOptions(product?.category, product?.subCategory);

  renderVariantList();

  document.getElementById('hasVariantsToggle').onchange = (e) => {
    hasVariants = e.target.checked;
    document.getElementById('singleProductPriceArea').style.display = hasVariants ? 'none' : 'block';
    if (hasVariants && variants.length === 0) variants.push({ name: '', price: 0, stock: 0, itemDiscount: 0 });
    renderVariantList();
  };

  // Swap the discount input's prefix between currency symbol and % as the type changes
  document.getElementById('pItemDiscountType').onchange = (e) => {
    document.getElementById('pItemDiscountPrefix').textContent = e.target.value === 'pct' ? '%' : cur;
  };

  // HSN/SAC autocomplete — searches the local hsnCodes.json by code prefix or description substring
  {
    const hsnInput = document.getElementById('pHSN');
    const hsnBox = document.getElementById('hsnSuggestions');
    let hsnMatches = [];
    let hsnActiveIndex = -1;

    const closeHsnSuggestions = () => {
      hsnBox.classList.remove('open');
      hsnBox.innerHTML = '';
      hsnMatches = [];
      hsnActiveIndex = -1;
    };

    // Sets the Tax Rate dropdown to the HSN entry's GST rate, adding a matching <option> first
    // if the rate isn't one of the preset slabs (e.g. 0.25%/1.5% cess-heavy items) — dispatches
    // 'change' so premiumSelect.js's custom widget (which wraps every <select>) re-syncs its
    // visible label/checkmark instead of only updating the hidden native element.
    const applyHsnTaxRate = (rateStr) => {
      if (rateStr == null) return;
      const rateNum = parseFloat(String(rateStr).replace('%', ''));
      if (isNaN(rateNum)) return;

      const taxRateSelect = document.getElementById('pTaxRate');
      let option = [...taxRateSelect.options].find(o => parseFloat(o.value) === rateNum);
      if (!option) {
        option = document.createElement('option');
        option.value = String(rateNum);
        option.textContent = rateNum + '%';
        const insertBefore = [...taxRateSelect.options].find(o => parseFloat(o.value) > rateNum);
        taxRateSelect.insertBefore(option, insertBefore || null);
      }
      taxRateSelect.value = String(rateNum);
      taxRateSelect.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const selectHsnCode = (entry) => {
      hsnInput.value = entry.code;
      applyHsnTaxRate(entry.gstRate);
      closeHsnSuggestions();
    };

    const renderHsnList = () => {
      hsnBox.classList.add('open');
      hsnBox.innerHTML = hsnMatches.map((entry, idx) => `
        <div class="suggestion-item ${idx === hsnActiveIndex ? 'active' : ''}" data-index="${idx}">
          <div class="suggestion-content">
            <div class="suggestion-name">${entry.code} <span style="font-weight:400; color:var(--text-muted)">— ${entry.description}</span></div>
          </div>
          <div class="suggestion-price">${entry.gstRate != null ? String(entry.gstRate).replace('%', '') + '%' : ''}</div>
        </div>
      `).join('');

      hsnBox.querySelectorAll('.suggestion-item').forEach(item => {
        // preventDefault on mousedown stops the input from blurring at all when a suggestion is
        // clicked, so selection never races against the blur-close handler below.
        item.addEventListener('mousedown', (e) => e.preventDefault());
        item.addEventListener('click', () => selectHsnCode(hsnMatches[parseInt(item.dataset.index)]));
      });

      const activeEl = hsnBox.querySelector('.suggestion-item.active');
      if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
    };

    hsnInput.addEventListener('input', async () => {
      const query = hsnInput.value.trim().toLowerCase();
      if (!query) { closeHsnSuggestions(); return; }

      const hsnCodes = await loadHsnCodes();
      const wordBoundary = new RegExp('\\b' + query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const scored = [];
      for (const entry of hsnCodes) {
        const desc = entry.description.toLowerCase();
        let score;
        if (entry.code.startsWith(query)) score = 0;
        else if (wordBoundary.test(desc)) score = 1;
        else if (desc.includes(query)) score = 2;
        else continue;
        scored.push({ entry, score, matchIndex: desc.indexOf(query) });
      }
      // Rank exact/code matches first, then whole-word description matches, then loose substring
      // matches — otherwise "paper" surfaces bakery items mentioning "rice paper" ahead of actual
      // paper products, since the raw dataset has no relevance ranking of its own.
      scored.sort((a, b) => a.score - b.score || a.matchIndex - b.matchIndex);
      hsnMatches = scored.slice(0, 8).map(s => s.entry);
      hsnActiveIndex = -1;

      if (hsnMatches.length === 0) { closeHsnSuggestions(); return; }
      renderHsnList();
    });

    hsnInput.addEventListener('keydown', (e) => {
      if (!hsnBox.classList.contains('open') || hsnMatches.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        hsnActiveIndex = Math.min(hsnActiveIndex + 1, hsnMatches.length - 1);
        renderHsnList();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        hsnActiveIndex = Math.max(hsnActiveIndex - 1, -1);
        renderHsnList();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const pick = hsnActiveIndex >= 0 ? hsnMatches[hsnActiveIndex] : (hsnMatches.length === 1 ? hsnMatches[0] : null);
        if (pick) selectHsnCode(pick);
      } else if (e.key === 'Escape') {
        closeHsnSuggestions();
      }
    });

    hsnInput.addEventListener('blur', () => {
      setTimeout(closeHsnSuggestions, 150);
    });
  }

  // "No Tax / Exempt" — forces taxRate to 0 and hides the whole Tax
  // Type/Rate row rather than trying to visually "disable" the selects:
  // every <select class="form-select"> in this app gets hijacked into a
  // custom dropdown by premiumSelect.js (a separate .premium-select-wrapper
  // element inserted as a sibling, not the native <select> itself), which
  // doesn't consult the native `disabled` attribute at all — a disabled
  // native select would still show as a clickable, changeable custom
  // dropdown. Hiding the shared parent row sidesteps that entirely, and the
  // save handler below just reads pTaxRate's value as always, so it still
  // reads back exactly 0 without needing its own special case.
  {
    const noTaxToggle = document.getElementById('pNoTaxToggle');
    const taxRateRow = document.getElementById('pTaxRateRow');
    const taxRateSelect = document.getElementById('pTaxRate');

    const setZeroRate = () => {
      let option = [...taxRateSelect.options].find(o => parseFloat(o.value) === 0);
      if (!option) {
        option = document.createElement('option');
        option.value = '0';
        option.textContent = '0%';
        taxRateSelect.insertBefore(option, taxRateSelect.firstChild);
      }
      taxRateSelect.value = '0';
      taxRateSelect.dispatchEvent(new Event('change', { bubbles: true }));
    };

    if (noTaxToggle.checked) {
      setZeroRate();
      taxRateRow.style.display = 'none';
    }

    noTaxToggle.onchange = () => {
      if (noTaxToggle.checked) {
        // Remembered so switching it back off restores what was picked
        // before, instead of leaving the product stuck at 0%.
        taxRateRow.dataset.prevRate = taxRateSelect.value;
        setZeroRate();
        taxRateRow.style.display = 'none';
      } else {
        taxRateRow.style.display = 'flex';
        const prevRate = taxRateRow.dataset.prevRate;
        if (prevRate && prevRate !== '0') {
          const opt = [...taxRateSelect.options].find(o => o.value === prevRate);
          if (opt) {
            taxRateSelect.value = prevRate;
            taxRateSelect.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      }
    };
  }

  // Emoji picker
  document.querySelectorAll('.emoji-option').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.emoji-option').forEach(e => e.style.background = '');
      el.style.background = 'var(--primary)';
      document.getElementById('selectedEmoji').value = el.dataset.emoji;
    });
  });

  // Preview Image on selection
  document.getElementById('pImageFile').onchange = async (e) => {
    try {
      const base64 = await MediaService.handleImageUpload(e);
      if (base64) {
        document.getElementById('pImageBase64').value = base64;
        document.getElementById('imagePreview').innerHTML = `<img src="${base64}" style="width:100%;height:100%;object-fit:cover" />`;
        document.getElementById('removeImgBtn').style.display = 'inline-flex';
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  document.getElementById('removeImgBtn').onclick = () => {
    document.getElementById('pImageBase64').value = '';
    document.getElementById('imagePreview').innerHTML = `<i class="fa-solid fa-image" style="opacity:0.3"></i>`;
    document.getElementById('pImageFile').value = '';
    document.getElementById('removeImgBtn').style.display = 'none';
  };

  const saveBtn = document.getElementById('saveProductBtn');
  let isProcessing = false;

  saveBtn.onclick = async () => {
    if (isProcessing) return;
    
    // Validation first (Synchronous checks)
    const name_val = document.getElementById('pName').value.trim();
    if (!name_val) { showToast('Please enter product name', 'error'); return; }

    const priceVal = hasVariants ? '0' : document.getElementById('pPrice').value;
    const stockVal = hasVariants ? '0' : document.getElementById('pStock').value;
    if (!hasVariants && (priceVal === '' || stockVal === '')) {
      showToast('Please enter both selling price and opening stock', 'error');
      return;
    }

    // Immediate lock
    isProcessing = true;
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-8"></i> Saving...';

    try {
        const sku = document.getElementById('pSKU').value.trim();
        const barcode = document.getElementById('pBarcode').value.trim();
        const category = document.getElementById('pCategory').value;
        const subCategory = document.getElementById('pSubCategory').value;
        const emoji = document.getElementById('selectedEmoji').value;
        const image = document.getElementById('pImageBase64').value;
        const hsnCode = document.getElementById('pHSN').value.trim();
        const taxType = document.getElementById('pTaxType').value;
        const taxRate = parseFloat(document.getElementById('pTaxRate').value) || 0;
        // A rate picked via HSN autocomplete (or already saved on this
        // product) that isn't one of the shop's configured presets was only
        // ever patched into THIS product's own <select> — Settings > Tax
        // Configuration never actually gained it, so it never showed up
        // there as a usable preset for other products. Persist it into the
        // shop's real tax-rate list here, once, the first time it's used.
        // Re-fetches settings fresh right before writing (rather than reusing
        // the `settings` captured when this form first opened, which could
        // be stale by now) so this can't clobber an unrelated settings
        // change made elsewhere while the product form was open.
        if (taxRate > 0 && !(settings.availableTaxes || []).some(t => t == taxRate)) {
          const latestSettings = await getSettings();
          if (!(latestSettings.availableTaxes || []).some(t => t == taxRate)) {
            const updatedTaxes = [...(latestSettings.availableTaxes || []), taxRate].sort((a, b) => a - b);
            await saveSettings({ ...latestSettings, availableTaxes: updatedTaxes });
          }
          settings.availableTaxes = [...(settings.availableTaxes || []), taxRate];
        }
        const itemDiscount = parseFloat(document.getElementById('pItemDiscount').value) || 0;
        const itemDiscountType = document.getElementById('pItemDiscountType').value;
        const isReturnable = document.getElementById('isReturnableToggle').checked;
        const allowNegativeStock = document.getElementById('allowNegativeStockToggle').checked;

        let finalPrice = 0;
        let finalCost = 0;
        let finalStock = 0;
        let finalMinStock = 0;
        let finalVariants = [];

        if (hasVariants) {
          if (variants.length === 0) { showToast('Add at least one variant', 'error'); isProcessing = false; saveBtn.disabled = false; saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk mr-8"></i> ${isEdit ? 'Update Product' : 'Create Product'}`; return; }
          const invalidV = variants.find(v => !v.name || v.price === '' || v.stock === '' || isNaN(parseFloat(v.price)) || isNaN(parseFloat(v.stock)));
          if (invalidV) { showToast('Fill all variant fields correctly (Name, Price, Stock)', 'error'); isProcessing = false; saveBtn.disabled = false; saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk mr-8"></i> ${isEdit ? 'Update Product' : 'Create Product'}`; return; }
          finalVariants = variants.map(v => ({
            ...v,
            price: parseFloat(v.price) || 0,
            costPrice: parseFloat(v.costPrice) || 0,
            stock: parseFloat(v.stock) || 0,
            minStock: parseFloat(v.minStock) || 0
          }));
          finalPrice = finalVariants[0].price;
          finalCost = finalVariants[0].costPrice;
          finalStock = finalVariants.reduce((s, v) => s + v.stock, 0);
          finalMinStock = finalVariants.reduce((s, v) => s + v.minStock, 0);
        } else {
          const priceVal = document.getElementById('pPrice').value;
          const stockVal = document.getElementById('pStock').value;
          
          if (priceVal === '' || stockVal === '') {
            showToast('Please enter both selling price and opening stock', 'error');
            isProcessing = false;
            saveBtn.disabled = false;
            saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk mr-8"></i> ${isEdit ? 'Update Product' : 'Create Product'}`;
            return;
          }

          finalPrice = parseFloat(priceVal);
          finalStock = parseFloat(stockVal);
          finalCost = parseFloat(document.getElementById('pCostPrice').value) || 0;
          finalMinStock = parseFloat(document.getElementById('pMinStock').value) || 0;

          if (isNaN(finalPrice) || isNaN(finalStock)) {
            showToast('Invalid price or stock values', 'error');
            isProcessing = false;
            saveBtn.disabled = false;
            saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk mr-8"></i> ${isEdit ? 'Update Product' : 'Create Product'}`;
            return;
          }
        }

        const floor = document.getElementById('pFloor').value.trim();
        const row = document.getElementById('pRow').value.trim();
        const rack = document.getElementById('pRack').value.trim();
        const mrp = parseFloat(document.getElementById('pMRP')?.value) || 0;
        const expiryDate = document.getElementById('pExpiryDate')?.value || '';
        const manufacturingDate = document.getElementById('pManufacturingDate')?.value || '';
        const unit = document.getElementById('pUnit')?.value || 'pcs';

        // Manufacturing Date is optional even when Expiry Date is set (many products only ever
        // show an expiry date on the pack) — but if BOTH are given, expiry must be strictly
        // after manufacturing, or the dates are almost certainly a typo.
        if (expiryDate && manufacturingDate && expiryDate <= manufacturingDate) {
          showToast('Expiry Date must be after Manufacturing Date', 'error');
          isProcessing = false;
          saveBtn.disabled = false;
          saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk mr-8"></i> ${isEdit ? 'Update Product' : 'Create Product'}`;
          return;
        }

        const payload = {
          ...product, name: name_val, sku, barcode, price: finalPrice, costPrice: finalCost, stock: finalStock, minStock: finalMinStock, category, subCategory, emoji,
          image, variants: finalVariants, hsnCode, taxType, taxRate, itemDiscount, itemDiscountType, isReturnable, allowNegativeStock, mrp, expiryDate, manufacturingDate, unit,
          location: { floor, row, rack }
        };

        const currentUser = await getCurrentUser();

        if (isEdit) {
          const oldStock = product.stock || 0;
          const diff = finalStock - oldStock;
          await updateProduct(payload);
          if (diff !== 0 && !hasVariants) {
             await logInventoryChange(product.id, null, diff > 0 ? 'IN' : 'OUT', Math.abs(diff), 'Manual Edit (Products)', payload.branchId, null, oldStock, finalStock, currentUser?.name);
          }
          if (hasVariants) {
             for (const fv of finalVariants) {
                const ov = (product.variants || []).find(v => v.name === fv.name);
                const oldVStock = ov ? (ov.stock || 0) : 0;
                const vDiff = (Number(fv.stock) || 0) - oldVStock;
                if (vDiff !== 0) {
                  await logInventoryChange(product.id, fv.name, vDiff > 0 ? 'IN' : 'OUT', Math.abs(vDiff), 'Manual Edit (Products)', payload.branchId, null, oldVStock, Number(fv.stock), currentUser?.name);
                }
             }
          }
          showToast('Product updated!', 'success');
        } else {
          const addedProduct = await addProduct(payload);
          isProcessing = false; // Successfully added
          if (finalStock > 0 && !hasVariants) {
            await logInventoryChange(addedProduct.id, null, 'IN', finalStock, 'Initial Stock', addedProduct.branchId, null, 0, finalStock, currentUser?.name);
          }
          if (hasVariants) {
             for (const fv of finalVariants) {
                const vStock = Number(fv.stock) || 0;
                if (vStock > 0) {
                  await logInventoryChange(addedProduct.id, fv.name, 'IN', vStock, 'Initial Stock', addedProduct.branchId, null, 0, vStock, currentUser?.name);
                }
             }
          }
          showToast('Product added!', 'success');
        }
        closeModal();
        await renderTable(container, cur);
    } catch (err) {
        console.error('Save error:', err);
        showToast('Error saving product: ' + err.message, 'error');
        isProcessing = false;
        saveBtn.disabled = false;
        saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk mr-8"></i> ${isEdit ? 'Update Product' : 'Create Product'}`;
    }
  };
  window.closeModal = closeModal;
}

async function confirmDelete(id, container, cur) {
  openModal({
    title: 'Delete Product',
    body: `<p style="color:var(--text-secondary)">Are you sure you want to delete this product? This cannot be undone.</p>`,
    footer: `
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" id="confirmDeleteBtn"><i class="fa-solid fa-trash"></i> Delete</button>
    `,
  });
  document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
    await deleteProduct(id);
    closeModal();
    showToast('Product deleted', 'info');
    await renderTable(container, cur);
  });
  window.closeModal = closeModal;
}

async function openLabelModal(product, type) {
  const isBarcode = type === 'barcode';
  const labelValue = product.barcode || product.sku || product.name || 'N/A';
  
  const settings = await getSettings();
  const cur = settings.currency || '\u20B9';
  const taxRate = parseFloat(product.taxRate ?? (settings.taxRate || 0));
  // product.price already contains tax for an inclusive-tax item (the
  // default tax type for new products) — adding tax again here double-
  // counted it on the printed label's default price.
  const priceWithTax = (product.taxType === 'inclusive' ? product.price : product.price * (1 + taxRate/100)).toFixed(2);
  const defaultStoreName = settings.storeName || 'My Store';

  let savedConfig = await getLabelConfig() || {};

  let config = {
    presetSize: savedConfig.presetSize ?? '50,25',
    // Always stored/used in mm internally — every downstream print/preview
    // calculation (page @size, px-per-mm conversion) assumes mm. `unit` is
    // purely a display/input convenience for the Width/Height fields below;
    // switching it never touches width/height themselves, only how they're
    // shown and how a typed number gets interpreted before being saved.
    unit: savedConfig.unit ?? 'mm',
    width: savedConfig.width ?? 50,
    height: savedConfig.height ?? 25,
    copies: savedConfig.copies ?? 1,
    // Most label rolls/sheets aren't a single label wide — a common one is
    // exactly what showed up as a real bug report: a 2-across 50x25mm gang
    // sheet, printed with @page sized to ONE label's width, so the browser
    // had no idea a physical row held 2 labels and tiled/rotated content
    // unpredictably across the real label boundaries. Defaults to 1 (single
    // continuous roll, the only case this used to support) — no behavior
    // change for anyone who doesn't touch it.
    labelsAcross: savedConfig.labelsAcross ?? 1,
    showStoreName: savedConfig.showStoreName ?? false,
    storeName: savedConfig.storeName ?? defaultStoreName,
    storeNameSize: savedConfig.storeNameSize ?? 6, // pt, matches the old fixed 6pt/8px
    prodNamePos: savedConfig.prodNamePos ?? 'bottom',
    // Product name used to always be the product's own name with no way to
    // edit or resize it for the label specifically — now editable per-print,
    // still defaulting to the product's real name so nothing changes unless
    // this is actually touched.
    productNameVal: product.name,
    productNameSize: savedConfig.productNameSize ?? 7, // pt, matches the old fixed 7pt/9px
    showMrp: savedConfig.showMrp ?? true,
    strikeMrp: savedConfig.strikeMrp ?? false,
    // Prefer the product's own MRP field — falls back to the tax-inclusive
    // selling price only when no MRP was ever set on the product itself.
    mrpVal: product.mrp ? product.mrp.toFixed(2) : priceWithTax,
    showPrice: savedConfig.showPrice ?? true,
    priceVal: priceWithTax,
    // Same pattern as MRP/Exp — pull from the product's own manufacturing
    // date and default the toggle on when it's set, instead of reusing
    // savedConfig's single shared value across every product.
    showMfd: savedConfig.showMfd ?? !!product.manufacturingDate,
    mfdVal: product.manufacturingDate || '',
    // Default ON when this product actually has an expiry date set, so it
    // shows up on the label automatically instead of needing a manual
    // toggle every time — still overridable per-print via the checkbox.
    showExp: savedConfig.showExp ?? !!product.expiryDate,
    // Same as mrpVal — pull from the product's own expiry date instead of
    // reusing whatever was typed into the label config for a PREVIOUS
    // product (savedConfig is a single shared, global label style).
    expVal: product.expiryDate || '',
    // Mfg/Exp used to share one position (datePos). Split into independent
    // positions per user request — each falls back to whatever datePos was
    // previously saved (then 'left'), so an existing saved config keeps
    // looking the same until the user actually diverges them.
    mfdPos: savedConfig.mfdPos ?? savedConfig.datePos ?? 'left', // 'left' | 'right' | 'bottom'
    expPos: savedConfig.expPos ?? savedConfig.datePos ?? 'left', // 'left' | 'right' | 'bottom'
    barcodeTextSize: savedConfig.barcodeTextSize ?? 12,
    showBarcodeText: savedConfig.showBarcodeText ?? true,
    // Was 35 — modest enough that raising the CSS max-height cap on the
    // barcode's <svg> did nothing, since max-height only SHRINKS oversized
    // content, it can't grow undersized content past its own actual size.
    // 60 actually fills more of the space now freed up by the smaller
    // store/product-name/price fonts, instead of leaving a visible gap.
    barHeight: savedConfig.barHeight ?? 60,
    barWidth: savedConfig.barWidth ?? 1.6,
    qrSize: savedConfig.qrSize ?? 80,
    qrLevel: savedConfig.qrLevel ?? 'H',
    qrColor: savedConfig.qrColor ?? '#000000',
    qrBgColor: savedConfig.qrBgColor ?? '#ffffff'
  };

  const renderPreviewHTML = (inPrint = false) => {
    const mfdPos = config.mfdPos || 'left'; // 'left' | 'right' | 'bottom'
    const expPos = config.expPos || 'left'; // 'left' | 'right' | 'bottom'

    // Left/Right: a rotated vertical strip running the full height of the
    // label, read bottom-to-top (writing-mode + 180° flip — the usual
    // convention for text down the edge of a price tag). Mfg/Exp can now
    // each be positioned independently, so this only prints whichever of
    // the two (or both, or neither) is actually assigned to this side.
    const dateSidebarHtml = (side) => {
      const showMfdHere = config.showMfd && mfdPos === side;
      const showExpHere = config.showExp && expPos === side;
      if (!showMfdHere && !showExpHere) return '';
      return `
      <div class="label-date-sidebar" style="
        writing-mode: vertical-rl; transform: rotate(180deg);
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: ${inPrint ? '0.3mm' : '2px'};
        font-family: Arial, sans-serif; font-size: ${inPrint ? '6pt' : '8px'}; font-weight: 600; color: #444;
        border-${side === 'left' ? 'right' : 'left'}: 1px solid #ddd;
        padding-${side === 'left' ? 'right' : 'left'}: ${inPrint ? '1mm' : '4px'};
        margin-${side === 'left' ? 'right' : 'left'}: ${inPrint ? '1mm' : '6px'};
        white-space: nowrap; flex-shrink: 0;
      ">
        ${showMfdHere ? `<span>Mfg: ${escapeHtml(formatLabelDate(config.mfdVal))}</span>` : ''}
        ${showExpHere ? `<span>Exp: ${escapeHtml(formatLabelDate(config.expVal))}</span>` : ''}
      </div>
    `;
    };

    // Bottom: the original horizontal, non-rotated, centered date rows.
    // Same independent-position handling as the sidebar above.
    const dateBottomHtml = () => {
      const showMfdHere = config.showMfd && mfdPos === 'bottom';
      const showExpHere = config.showExp && expPos === 'bottom';
      if (!showMfdHere && !showExpHere) return '';
      return `
      <div class="label-date-row" style="margin-top: ${inPrint ? '0.5mm' : '2px'}; display: flex; flex-direction: column; gap: ${inPrint ? '0.3mm' : '2px'}; align-items: center; font-family: Arial, sans-serif; font-size: ${inPrint ? '7pt' : '10px'}; font-weight: 600; color: #444; line-height: 1.2; white-space: nowrap;">
        ${showMfdHere ? `<div style="display:flex; gap:4px"><span style="min-width:${inPrint ? '8mm' : '30px'}; text-align:left">Mfg</span><span>:</span><span>${escapeHtml(formatLabelDate(config.mfdVal))}</span></div>` : ''}
        ${showExpHere ? `<div style="display:flex; gap:4px"><span style="min-width:${inPrint ? '8mm' : '30px'}; text-align:left">Exp</span><span>:</span><span>${escapeHtml(formatLabelDate(config.expVal))}</span></div>` : ''}
      </div>
    `;
    };

    const mainContent = `
      <div style="flex:1; min-width:0; min-height:0; overflow:hidden; box-sizing:border-box; padding: ${inPrint ? '0.5mm' : '2px'} 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; text-align: center;">
        ${config.showStoreName && config.storeName ? `
          <div class="label-store" style="font-family: Arial, sans-serif; font-size: ${inPrint ? config.storeNameSize + 'pt' : Math.round(config.storeNameSize * 1.333) + 'px'}; font-weight: 800; color: #000; margin-bottom: ${inPrint ? '0.5mm' : '2px'}; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-shrink: 0;">
            ${escapeHtml(config.storeName)}
          </div>
        ` : ''}

        ${config.prodNamePos === 'top' ? `
          <div class="label-title" style="font-family: Arial, sans-serif; font-size: ${inPrint ? config.productNameSize + 'pt' : Math.round(config.productNameSize * 1.333) + 'px'}; font-weight: 900; color: #000; margin-bottom: ${inPrint ? '0.5mm' : '4px'}; line-height: 1.1; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-shrink: 0;">
            ${escapeHtml(config.productNameVal)}
          </div>
        ` : ''}

        <div style="flex:1; min-height:0; overflow:hidden; display:flex; align-items:center; justify-content:center; width:100%;">
          ${isBarcode ? `<svg class="barcodeCanvas" style="${inPrint ? 'max-height: 95%; width: auto !important;' : 'max-height: 100%; width: auto;'} max-width: 100%; display: block;"></svg>` : `<div class="qrcodeCanvas"></div>`}
        </div>

        ${config.prodNamePos === 'bottom' ? `
          <div class="label-title" style="font-family: Arial, sans-serif; font-size: ${inPrint ? config.productNameSize + 'pt' : Math.round(config.productNameSize * 1.333) + 'px'}; font-weight: 900; color: #000; margin-top: ${inPrint ? '0.5mm' : '4px'}; line-height: 1.1; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-shrink: 0;">
            ${escapeHtml(config.productNameVal)}
          </div>
        ` : ''}

        ${(config.showMrp || config.showPrice) ? `
          <div class="label-price-row" style="margin-top: ${inPrint ? '0.3mm' : '2px'}; display: flex; gap: ${inPrint ? '1.5mm' : '8px'}; align-items: center; justify-content: center; font-family: Arial, sans-serif; font-size: ${inPrint ? '6pt' : '9px'}; font-weight: 700; color: #222; line-height: 1.1; white-space: nowrap;">
            ${config.showMrp ? `
              <span style="${config.strikeMrp ? 'text-decoration: line-through; opacity: 0.7; font-weight: 600;' : ''}">
                MRP: ${cur}${escapeHtml(String(config.mrpVal))}
              </span>
            ` : ''}
            ${config.showPrice ? `
              <span>Price: ${cur}${escapeHtml(String(config.priceVal))}</span>
            ` : ''}
          </div>
        ` : ''}

        ${dateBottomHtml()}
      </div>
    `;

    return `
      <div class="label-content" style="
        display: flex; flex-direction: row; align-items: stretch; justify-content: center;
        width: 100%; height: 100%; flex: 1 1 auto; min-height: 0;
        box-sizing: border-box; overflow: hidden;
        ${inPrint ? 'padding: 1.5mm;' : 'padding: 8px;'}
      ">
        ${dateSidebarHtml('left')}
        ${mainContent}
        ${dateSidebarHtml('right')}
      </div>
    `;
  };

  openModal({
    title: `<i class="fa-solid fa-${isBarcode ? 'barcode' : 'qrcode'}"></i> Generate Label: ${escapeHtml(product.name)}`,
    body: `
      <div style="display:flex; flex-direction:column; gap:20px; padding:10px;">
        <!-- Preview Area -->
        <div style="textAlign:center; background:#f8fafc; padding:20px; border-radius:12px; border:1px dashed #cbd5e1; display:flex; justify-content:center;">
          <div id="labelPreviewArea" style="background:white; display:inline-block; border:1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); min-width:200px; min-height:100px;">
            <!-- Rendered via JS -->
          </div>
        </div>

        <!-- Settings Area -->
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
          <!-- Left Col -->
          <div style="display:flex; flex-direction:column; gap:12px;">
            <div style="font-size:12px; font-weight:800; color:var(--text-muted); text-transform:uppercase;">Size & Print</div>
            
            <div class="form-group" style="margin-bottom:-4px;">
              <label class="form-label" style="font-size:11px">Preset Sizes</label>
              <select class="form-select config-input" data-key="presetSize" style="font-size:12px; padding:6px;">
                <option value="25,15" ${config.presetSize === '25,15' ? 'selected' : ''}>25mm x 15mm (1" x 0.6", Mini/Jewelry)</option>
                <option value="38,25" ${config.presetSize === '38,25' ? 'selected' : ''}>38mm x 25mm (1.5" x 1", Small)</option>
                <option value="40,30" ${config.presetSize === '40,30' ? 'selected' : ''}>40mm x 30mm (1.6" x 1.2")</option>
                <option value="50,25" ${config.presetSize === '50,25' ? 'selected' : ''}>50mm x 25mm (2" x 1", Standard)</option>
                <option value="50,30" ${config.presetSize === '50,30' ? 'selected' : ''}>50mm x 30mm (2" x 1.2")</option>
                <option value="58,40" ${config.presetSize === '58,40' ? 'selected' : ''}>58mm x 40mm (2.3" x 1.6", Thermal)</option>
                <option value="76,51" ${config.presetSize === '76,51' ? 'selected' : ''}>76mm x 51mm (3" x 2")</option>
                <option value="80,50" ${config.presetSize === '80,50' ? 'selected' : ''}>80mm x 50mm (3.1" x 2", Wide Thermal)</option>
                <option value="100,50" ${config.presetSize === '100,50' ? 'selected' : ''}>100mm x 50mm (4" x 2", Shipping)</option>
                <option value="100,150" ${config.presetSize === '100,150' ? 'selected' : ''}>100mm x 150mm (4" x 6", Large Shipping)</option>
                <option value="custom" ${config.presetSize === 'custom' ? 'selected' : ''}>Custom Size</option>
              </select>
            </div>

            <div class="form-group" style="margin-bottom:-4px;">
              <label class="form-label" style="font-size:11px">Unit</label>
              <div style="display:flex; gap:16px; margin-top:2px;">
                <label style="font-size:12px; cursor:pointer; display:flex; align-items:center; gap:4px"><input type="radio" name="labelUnit" class="config-input config-check config-radio" data-key="unit" value="mm" ${config.unit !== 'inch' ? 'checked' : ''} /> Millimeters (mm)</label>
                <label style="font-size:12px; cursor:pointer; display:flex; align-items:center; gap:4px"><input type="radio" name="labelUnit" class="config-input config-check config-radio" data-key="unit" value="inch" ${config.unit === 'inch' ? 'checked' : ''} /> Inches (in)</label>
              </div>
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
              <div class="form-group"><label class="form-label" style="font-size:11px">Width (${config.unit === 'inch' ? 'in' : 'mm'})</label><input type="number" step="${config.unit === 'inch' ? '0.01' : '1'}" class="form-input config-input" data-key="width" id="valWidth" value="${config.unit === 'inch' ? (config.width / 25.4).toFixed(2) : config.width}" ${config.presetSize !== 'custom' ? 'disabled style="opacity:0.6"' : ''} /></div>
              <div class="form-group"><label class="form-label" style="font-size:11px">Height (${config.unit === 'inch' ? 'in' : 'mm'})</label><input type="number" step="${config.unit === 'inch' ? '0.01' : '1'}" class="form-input config-input" data-key="height" id="valHeight" value="${config.unit === 'inch' ? (config.height / 25.4).toFixed(2) : config.height}" ${config.presetSize !== 'custom' ? 'disabled style="opacity:0.6"' : ''} /></div>
            </div>
            
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
              <div class="form-group">
                <label class="form-label" style="font-size:11px">Number of Copies</label>
                <input type="number" class="form-input config-input" data-key="copies" value="${config.copies}" min="1" max="1000" />
              </div>
              <div class="form-group">
                <label class="form-label" style="font-size:11px">Labels Across (per row)</label>
                <input type="number" class="form-input config-input" data-key="labelsAcross" value="${config.labelsAcross}" min="1" max="10" title="How many labels sit side-by-side on one physical row of your roll/sheet — 1 for a single-label roll, 2+ for a gang/multi-up sheet" />
              </div>
            </div>

            <div class="form-group" style="padding-top:8px; border-top:1px solid var(--border);">
              <label style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:600; cursor:pointer; margin-bottom:6px;">
                <input type="checkbox" class="config-check" data-key="showStoreName" ${config.showStoreName ? 'checked' : ''} />
                Print Shop Name
              </label>
              <div style="display:flex; gap:8px;">
                <input type="text" class="form-input config-input" data-key="storeName" value="${config.storeName}" placeholder="Shop Name" ${config.showStoreName ? '' : 'disabled'} style="flex:1" />
                <input type="number" class="form-input config-input" data-key="storeNameSize" value="${config.storeNameSize}" min="4" max="20" title="Text Size (pt)" ${config.showStoreName ? '' : 'disabled'} style="width:60px" />
              </div>
            </div>

            <div class="form-group">
              <label class="form-label" style="font-size:11px">Product Name</label>
              <div style="display:flex; gap:8px;">
                <input type="text" class="form-input config-input" data-key="productNameVal" value="${escapeHtml(config.productNameVal)}" placeholder="Product Name" ${config.prodNamePos === 'hidden' ? 'disabled' : ''} style="flex:1" />
                <input type="number" class="form-input config-input" data-key="productNameSize" value="${config.productNameSize}" min="4" max="20" title="Text Size (pt)" ${config.prodNamePos === 'hidden' ? 'disabled' : ''} style="width:60px" />
              </div>
            </div>

            <div class="form-group">
              <label class="form-label" style="font-size:11px">Product Name Position</label>
              <div style="display:flex; gap:16px; margin-top:4px;">
                <label style="font-size:12px; cursor:pointer;"><input type="radio" name="nPos" class="config-input config-check config-radio" data-key="prodNamePos" value="top" ${config.prodNamePos === 'top' ? 'checked' : ''} /> Top</label>
                <label style="font-size:12px; cursor:pointer;"><input type="radio" name="nPos" class="config-input config-check config-radio" data-key="prodNamePos" value="bottom" ${config.prodNamePos === 'bottom' ? 'checked' : ''} /> Bottom</label>
                <label style="font-size:12px; cursor:pointer;"><input type="radio" name="nPos" class="config-input config-check config-radio" data-key="prodNamePos" value="hidden" ${config.prodNamePos === 'hidden' ? 'checked' : ''} /> Hide</label>
              </div>
            </div>
          </div>

          <!-- Right Col -->
          <div style="display:flex; flex-direction:column; gap:12px;">
            <div style="font-size:12px; font-weight:800; color:var(--text-muted); text-transform:uppercase;">Pricing Options</div>
            
            <!-- MRP Block -->
            <div style="background:var(--bg-main); padding:12px; border-radius:8px; border:1px solid var(--border);">
              <label style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:600; cursor:pointer; margin-bottom:8px;">
                <input type="checkbox" class="config-check" data-key="showMrp" ${config.showMrp ? 'checked' : ''} />
                Show MRP
              </label>
              <div style="display:flex; gap:8px; align-items:center;">
                <input type="text" class="form-input config-input" data-key="mrpVal" value="${config.mrpVal}" ${config.showMrp ? '' : 'disabled'} style="flex:1" />
                <label style="display:flex; align-items:center; gap:4px; font-size:11px; cursor:pointer;" title="Strikethrough MRP">
                  <input type="checkbox" class="config-check" data-key="strikeMrp" ${config.strikeMrp ? 'checked' : ''} ${config.showMrp ? '' : 'disabled'} />
                  <s>Strike</s>
                </label>
              </div>
            </div>

            <!-- Selling Price Block -->
            <div style="background:var(--bg-main); padding:12px; border-radius:8px; border:1px solid var(--border);">
              <label style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:600; cursor:pointer; margin-bottom:8px;">
                <input type="checkbox" class="config-check" data-key="showPrice" ${config.showPrice ? 'checked' : ''} />
                Show Selling Price
              </label>
              <input type="text" class="form-input config-input" data-key="priceVal" value="${config.priceVal}" ${config.showPrice ? '' : 'disabled'} />
            </div>

            <!-- Dates Block -->
            <div style="background:var(--bg-main); padding:12px; border-radius:8px; border:1px solid var(--border);">
              <div style="display:flex; flex-direction:column; gap:8px;">
                <div style="display:flex; align-items:center; gap:8px;">
                  <label style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:600; cursor:pointer; flex: 0 0 70px;">
                    <input type="checkbox" class="config-check" data-key="showMfd" ${config.showMfd ? 'checked' : ''} />
                    MFD
                  </label>
                  <input type="text" class="form-input config-input" data-key="mfdVal" value="${config.mfdVal}" placeholder="e.g. 10/24" ${config.showMfd ? '' : 'disabled'} />
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                  <label style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:600; cursor:pointer; flex: 0 0 70px;">
                    <input type="checkbox" class="config-check" data-key="showExp" ${config.showExp ? 'checked' : ''} />
                    EXP
                  </label>
                  <input type="text" class="form-input config-input" data-key="expVal" value="${config.expVal}" placeholder="e.g. 10/25" ${config.showExp ? '' : 'disabled'} />
                </div>
                <div style="display:flex; align-items:center; gap:8px; padding-top:6px; border-top:1px dashed var(--border);">
                  <label style="font-size:12px; font-weight:600; flex: 0 0 70px;">MFD Position</label>
                  <div style="display:flex; gap:12px;">
                    <label style="font-size:12px; cursor:pointer;"><input type="radio" name="mfdPos" class="config-input config-check config-radio" data-key="mfdPos" value="left" ${(config.mfdPos || 'left') === 'left' ? 'checked' : ''} /> Left</label>
                    <label style="font-size:12px; cursor:pointer;"><input type="radio" name="mfdPos" class="config-input config-check config-radio" data-key="mfdPos" value="right" ${config.mfdPos === 'right' ? 'checked' : ''} /> Right</label>
                    <label style="font-size:12px; cursor:pointer;"><input type="radio" name="mfdPos" class="config-input config-check config-radio" data-key="mfdPos" value="bottom" ${config.mfdPos === 'bottom' ? 'checked' : ''} /> Bottom</label>
                  </div>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                  <label style="font-size:12px; font-weight:600; flex: 0 0 70px;">EXP Position</label>
                  <div style="display:flex; gap:12px;">
                    <label style="font-size:12px; cursor:pointer;"><input type="radio" name="expPos" class="config-input config-check config-radio" data-key="expPos" value="left" ${(config.expPos || 'left') === 'left' ? 'checked' : ''} /> Left</label>
                    <label style="font-size:12px; cursor:pointer;"><input type="radio" name="expPos" class="config-input config-check config-radio" data-key="expPos" value="right" ${config.expPos === 'right' ? 'checked' : ''} /> Right</label>
                    <label style="font-size:12px; cursor:pointer;"><input type="radio" name="expPos" class="config-input config-check config-radio" data-key="expPos" value="bottom" ${config.expPos === 'bottom' ? 'checked' : ''} /> Bottom</label>
                  </div>
                </div>
              </div>
            </div>

            <!-- Stylings Block -->
            <div style="font-size:12px; font-weight:800; color:var(--text-muted); text-transform:uppercase; margin-top:8px;">Styling Options</div>
            <div style="background:var(--bg-main); padding:12px; border-radius:8px; border:1px solid var(--border);">
              ${isBarcode ? `
                <div class="form-group" style="margin-bottom:8px;">
                  <label style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:600; cursor:pointer;">
                    <input type="checkbox" class="config-check" data-key="showBarcodeText" ${config.showBarcodeText ? 'checked' : ''} />
                    Show Barcode Value Below
                  </label>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:8px;">
                  <div class="form-group" style="margin-bottom:0;">
                    <label class="form-label" style="font-size:11px">Text Size</label>
                    <input type="number" class="form-input config-input" data-key="barcodeTextSize" value="${config.barcodeTextSize}" min="8" max="24" ${config.showBarcodeText ? '' : 'disabled'} />
                  </div>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                  <div class="form-group" style="margin-bottom:0;">
                    <label class="form-label" style="font-size:11px">Bar Width (px)</label>
                    <input type="number" step="0.1" class="form-input config-input" data-key="barWidth" value="${config.barWidth}" min="1" max="4" />
                  </div>
                  <div class="form-group" style="margin-bottom:0;">
                    <label class="form-label" style="font-size:11px">Bar Height (px)</label>
                    <input type="number" class="form-input config-input" data-key="barHeight" value="${config.barHeight}" min="10" max="150" />
                  </div>
                </div>
              ` : `
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:8px;">
                  <div class="form-group" style="margin-bottom:0;">
                    <label class="form-label" style="font-size:11px">QR Size (px)</label>
                    <input type="number" class="form-input config-input" data-key="qrSize" value="${config.qrSize}" min="30" max="300" />
                  </div>
                  <div class="form-group" style="margin-bottom:0;">
                    <label class="form-label" style="font-size:11px">Format Level</label>
                    <select class="form-select config-input" data-key="qrLevel" style="font-size:12px; padding:6px;">
                      <option value="L" ${config.qrLevel === 'L' ? 'selected' : ''}>Low (Clean)</option>
                      <option value="M" ${config.qrLevel === 'M' ? 'selected' : ''}>Medium</option>
                      <option value="Q" ${config.qrLevel === 'Q' ? 'selected' : ''}>Quartile</option>
                      <option value="H" ${config.qrLevel === 'H' ? 'selected' : ''}>High (Complex)</option>
                    </select>
                  </div>
                </div>
                <div class="form-group" style="margin-bottom:0;">
                  <label class="form-label" style="font-size:11px">QR Code Colors</label>
                  <div style="display:flex; gap:8px;">
                    <div style="flex:1;"><label style="font-size:10px;color:var(--text-muted)">QR Color</label><input type="color" class="form-input config-input" data-key="qrColor" value="${config.qrColor}" style="padding:0; height:32px; width:100%" /></div>
                    <div style="flex:1;"><label style="font-size:10px;color:var(--text-muted)">Background</label><input type="color" class="form-input config-input" data-key="qrBgColor" value="${config.qrBgColor}" style="padding:0; height:32px; width:100%" title="Background Color" /></div>
                  </div>
                </div>
              `}
            </div>

          </div>
        </div>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" onclick="closeModal()">Close</button>
      <button class="btn btn-primary" id="printLabelBtn"><i class="fa-solid fa-print"></i> Print Label (<span id="btnLblCount">${config.copies}</span>)</button>
    `
  });

  const generateCanvas = (elements, inPrint = false) => {
    try {
      if (isBarcode) {
        if (typeof JsBarcode !== 'undefined') {
          elements.forEach(el => {
            JsBarcode(el, labelValue, {
              format: "CODE128",
              lineColor: "#000",
              width: Number(config.barWidth) || 1.6,
              height: Number(config.barHeight) || 35,
              displayValue: config.showBarcodeText,
              fontSize: Number(config.barcodeTextSize) || 12,
              margin: 0,
              fontOptions: "bold"
            });
            // JsBarcode's SVG renderer overwrites the whole style attribute
            // (it ends with setAttribute('style', 'transform: translate(0,0)')),
            // wiping out the max-height/max-width constraints set in
            // renderPreviewHTML. Re-apply them after render so the Bar
            // Width/Bar Height (px) settings actually get scaled to fit the
            // label instead of overflowing it uncapped.
            el.style.maxWidth = '100%';
            el.style.display = 'block';
            if (inPrint) {
              // Was hardcoded to '55%' here, silently overriding whatever
              // renderPreviewHTML's own template put on this same element —
              // generateCanvas() runs AFTER the template is inserted, so
              // this line always won regardless of what the template said.
              // Keep this in sync with the max-height set in the barcode
              // wrapper's <svg> below.
              el.style.maxHeight = '95%';
              el.style.width = 'auto';
            } else {
              el.style.maxHeight = '100%';
              el.style.width = 'auto';
            }
          });
        }
      } else {
        if (typeof QRCode !== 'undefined') {
          const qrSizes = Number(config.qrSize) || 80;
          elements.forEach(el => {
            el.innerHTML = '';
            new QRCode(el, {
              text: labelValue,
              width: qrSizes,
              height: qrSizes,
              colorDark: config.qrColor || "#000000",
              colorLight: config.qrBgColor || "#ffffff",
              correctLevel: QRCode.CorrectLevel[config.qrLevel || 'H']
            });
          });
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const updatePreview = async () => {
    try {
      await saveLabelConfig({
        ...config,
        mrpVal: undefined,
        priceVal: undefined,
        // Per-product like mrpVal/priceVal above — don't let one product's
        // edited name leak into the next product's label as a stale default.
        productNameVal: undefined
      });
    } catch(e) {}
    
    const previewArea = document.getElementById('labelPreviewArea');
    if (!previewArea) return;
    
    // Set aspect ratio box size roughly matching dimensions
    previewArea.style.width = `${config.width * 3.77}px`;  // approx px per mm
    previewArea.style.height = `${config.height * 3.77}px`;
    
    previewArea.innerHTML = renderPreviewHTML(false);
    generateCanvas(document.querySelectorAll('.barcodeCanvas, .qrcodeCanvas'), false);
    
    const countSpan = document.getElementById('btnLblCount');
    if(countSpan) countSpan.textContent = config.copies;
  };

  // Bind events
  setTimeout(async () => {
    await updatePreview();

    document.querySelectorAll('.config-input').forEach(input => {
      const handler = async (e) => {
        const key = e.target.dataset.key;

        // width/height inputs display in whichever unit is currently
        // selected (mm or inch), but config.width/config.height must always
        // stay in mm — every downstream calculation (page @size, px-per-mm
        // preview scaling) assumes mm. Convert on the way in here instead.
        if ((key === 'width' || key === 'height') && config.unit === 'inch') {
          config[key] = Number(e.target.value) * 25.4;
        } else {
          config[key] = e.target.value;
          if (['width', 'height', 'copies', 'labelsAcross', 'barcodeTextSize', 'barWidth', 'barHeight', 'qrSize', 'storeNameSize', 'productNameSize'].includes(key)) {
            config[key] = Number(e.target.value);
          }
        }

        if (key === 'unit') {
          // Only the DISPLAYED number changes here — re-render the same
          // underlying mm value (config.width/height, untouched) in the
          // newly selected unit.
          const valWidth = document.getElementById('valWidth');
          const valHeight = document.getElementById('valHeight');
          const widthLabel = valWidth?.closest('.form-group')?.querySelector('.form-label');
          const heightLabel = valHeight?.closest('.form-group')?.querySelector('.form-label');
          const unitLabel = config.unit === 'inch' ? 'in' : 'mm';
          if (valWidth) valWidth.value = config.unit === 'inch' ? (config.width / 25.4).toFixed(2) : config.width;
          if (valHeight) valHeight.value = config.unit === 'inch' ? (config.height / 25.4).toFixed(2) : config.height;
          if (widthLabel) widthLabel.textContent = `Width (${unitLabel})`;
          if (heightLabel) heightLabel.textContent = `Height (${unitLabel})`;
        }

        if (key === 'presetSize') {
          if (e.target.value !== 'custom') {
            const [w, h] = e.target.value.split(',').map(Number);
            config.width = w;
            config.height = h;
            const valWidth = document.getElementById('valWidth');
            const valHeight = document.getElementById('valHeight');
            if (valWidth) {
                valWidth.value = config.unit === 'inch' ? (w / 25.4).toFixed(2) : w;
                valWidth.disabled = true;
                valWidth.style.opacity = '0.6';
            }
            if (valHeight) {
                valHeight.value = config.unit === 'inch' ? (h / 25.4).toFixed(2) : h;
                valHeight.disabled = true;
                valHeight.style.opacity = '0.6';
            }
          } else {
            const valWidth = document.getElementById('valWidth');
            const valHeight = document.getElementById('valHeight');
            if (valWidth) {
                valWidth.disabled = false;
                valWidth.style.opacity = '1';
            }
            if (valHeight) {
                valHeight.disabled = false;
                valHeight.style.opacity = '1';
            }
          }
        }

        if (key === 'width' || key === 'height') {
          const sel = document.querySelector('select[data-key="presetSize"]');
          if (sel) sel.value = 'custom';
          config.presetSize = 'custom';
        }

        await updatePreview();
      };
      input.addEventListener('input', handler);
      input.addEventListener('change', handler);
    });

    document.querySelectorAll('.config-check').forEach(chk => {
      chk.addEventListener('change', async (e) => {
        config[e.target.dataset.key] = e.target.checked;
        
        // Handle dependencies
        if (e.target.dataset.key === 'showStoreName') {
          const input = document.querySelector('input[data-key="storeName"]');
          if (input) input.disabled = !e.target.checked;
        }
        if (e.target.dataset.key === 'showMrp') {
          const mrpInput = document.querySelector('input[data-key="mrpVal"]');
          const strikeInput = document.querySelector('input[data-key="strikeMrp"]');
          if (mrpInput) mrpInput.disabled = !e.target.checked;
          if (strikeInput) strikeInput.disabled = !e.target.checked;
        }
        if (e.target.dataset.key === 'showPrice') {
          const input = document.querySelector('input[data-key="priceVal"]');
          if (input) input.disabled = !e.target.checked;
        }
        if (e.target.dataset.key === 'showMfd') {
          const input = document.querySelector('input[data-key="mfdVal"]');
          if (input) input.disabled = !e.target.checked;
        }
        if (e.target.dataset.key === 'showExp') {
          const input = document.querySelector('input[data-key="expVal"]');
          if (input) input.disabled = !e.target.checked;
        }
        if (e.target.dataset.key === 'showBarcodeText') {
          const textInput = document.querySelector('input[data-key="barcodeTextSize"]');
          if (textInput) textInput.disabled = !e.target.checked;
        }
        // If radio button changed
        if (e.target.type === 'radio') {
          config[e.target.dataset.key] = e.target.value;
        }
        await updatePreview();
      });
    });
  }, 100);

  document.getElementById('printLabelBtn').onclick = () => {
    // We need to bake the current preview HTML into a print template
    // Since print layout might differ slightly due to inPrint flag, re-render it
    const printHtml = renderPreviewHTML(true);
    
    // We create a temporary hidden div to generate the barcode SVG since we need the actual generated SVG text
    const tempDiv = document.createElement('div');
    tempDiv.style.position = 'absolute';
    tempDiv.style.top = '-9999px';
    tempDiv.style.left = '-9999px';
    tempDiv.style.width = `${config.width * 5}px`; // ensure it has layout space
    tempDiv.style.height = `${config.height * 5}px`;
    tempDiv.innerHTML = printHtml;
    document.body.appendChild(tempDiv);
    
    generateCanvas(tempDiv.querySelectorAll('.barcodeCanvas, .qrcodeCanvas'), true);
    
    // Delay slightly to ensure renders (especially base64 canvas) complete
    setTimeout(() => {
      const finalPrintHtmlStr = tempDiv.innerHTML;
      document.body.removeChild(tempDiv);

      const printWin = window.open('', '_blank');

      const copies = Math.max(1, parseInt(config.copies) || 1);
      const labelsAcross = Math.max(1, parseInt(config.labelsAcross) || 1);

      let pageStyle, bodyHtml;
      if (labelsAcross <= 1) {
        // Unchanged from before — a single-label-wide roll, one physical
        // page (=one label) per copy.
        pageStyle = `
          @page { size: ${config.width}mm ${config.height}mm; margin: 0; }
          .print-page {
            width: ${config.width}mm;
            height: ${config.height}mm;
            page-break-after: always;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-end;
            overflow: hidden;
            box-sizing: border-box;
          }
          @media print {
            .print-page { page-break-after: always; }
            .print-page:last-child { page-break-after: auto; }
          }
        `;
        bodyHtml = Array.from({ length: copies }, () => `<div class="print-page">${finalPrintHtmlStr}</div>`).join('');
      } else {
        // Gang/multi-up roll (e.g. 2 labels side-by-side per row): the bug
        // this branch fixes. @page used to be set to ONE label's size no
        // matter how many labels actually sit across the physical roll,
        // so the browser had no idea the real page was wider — it tiled/
        // rotated content unpredictably across label boundaries it didn't
        // know existed.
        //
        // IMPORTANT — this is NOT "one giant page containing every row"
        // (that was tried first and doesn't match how a real label-printer
        // driver works): a dedicated label printer's "Stock"/media size in
        // its OWN driver dialog is the size of ONE ROW, and the driver
        // advances the roll by that same row height itself, row after
        // row, using the print job's page count — same continuous-feed
        // model the single-column branch above already used, just with
        // `labelsAcross` labels side-by-side per page instead of 1. @page
        // is one row wide/tall (labelsAcross x width, x height), repeated
        // page-break-after for every row `copies` needs.
        const rows = Math.ceil(copies / labelsAcross);
        pageStyle = `
          @page { size: ${config.width * labelsAcross}mm ${config.height}mm; margin: 0; }
          .print-row {
            width: ${config.width * labelsAcross}mm;
            height: ${config.height}mm;
            page-break-after: always;
            display: flex;
            flex-direction: row;
            box-sizing: border-box;
          }
          .print-cell {
            width: ${config.width}mm;
            height: ${config.height}mm;
            display: flex;
            flex-direction: column;
            align-items: center;
            /* flex-end, not center: .label-content already has flex:1 and
               should fill this cell completely on its own, but if it ever
               doesn't (rounding, a print-engine quirk that isn't
               reproducible outside a real printer), any leftover slack
               should collect at the TOP, not the bottom — matching what
               was actually reported as still wrong after the mainContent-
               level fix (bottom kept a gap center couldn't explain). */
            justify-content: flex-end;
            overflow: hidden;
            box-sizing: border-box;
          }
          @media print {
            .print-row { page-break-after: always; }
            .print-row:last-child { page-break-after: auto; }
          }
        `;
        let remaining = copies;
        const rowsHtml = [];
        for (let r = 0; r < rows; r++) {
          const cellsThisRow = Math.min(labelsAcross, remaining);
          remaining -= cellsThisRow;
          // Pad the last, possibly-partial row with blank cells so it's
          // still the full row width — keeps the roll's gap/cut position
          // consistent instead of a narrower final row confusing the feed.
          const cells = Array.from({ length: labelsAcross }, (_, i) =>
            i < cellsThisRow ? `<div class="print-cell">${finalPrintHtmlStr}</div>` : `<div class="print-cell"></div>`
          ).join('');
          rowsHtml.push(`<div class="print-row">${cells}</div>`);
        }
        bodyHtml = rowsHtml.join('');
      }

    printWin.document.write(`
      <html>
        <head>
          <title>Print Label</title>
          <style>
            ${pageStyle}
            body {
              margin: 0;
              padding: 0;
              background: white;
            }
          </style>
        </head>
        <body onload="setTimeout(() => { window.print(); window.close(); }, 500);">
          ${bodyHtml}
        </body>
      </html>
    `);
    printWin.document.close();
    }, 150);
  };
}

const STOCK_ADJUSTMENT_REASONS = ['Stock Count Correction', 'Damage / Wastage', 'Theft / Loss', 'Expired', 'Found Extra Stock', 'Other'];

async function openAdjustStockModal(product, container, cur) {
  if (!product) return;
  const hasVariants = product.variants && product.variants.length > 0;

  const rowsHtml = hasVariants
    ? product.variants.map((v, idx) => `
        <div class="form-group" style="display:flex; align-items:center; gap:12px; margin-bottom:12px;">
          <div style="flex:1">
            <div style="font-weight:600">${escapeHtml(v.name)}</div>
            <div style="font-size:12px; opacity:0.6">Current: ${v.stock ?? 0}</div>
          </div>
          <input type="number" step="any" class="form-input adjust-stock-input" data-variant="${escapeHtml(v.name)}" style="width:120px" value="${v.stock ?? 0}" />
        </div>
      `).join('')
    : `
        <div class="form-group" style="display:flex; align-items:center; gap:12px; margin-bottom:12px;">
          <div style="flex:1">
            <div style="font-weight:600">${escapeHtml(product.name)}</div>
            <div style="font-size:12px; opacity:0.6">Current: ${product.stock ?? 0}</div>
          </div>
          <input type="number" step="any" class="form-input adjust-stock-input" data-variant="" style="width:120px" value="${product.stock ?? 0}" />
        </div>
      `;

  const body = `
    <div style="padding:4px 0">
      <p style="font-size:13px; opacity:0.7; margin-bottom:16px">Enter the physically-counted quantity for each line — only lines whose value actually changes get logged.</p>
      ${rowsHtml}
      <div class="form-group" style="margin-top:16px">
        <label class="form-label">Reason</label>
        <select class="form-input" id="adjustReasonSelect">
          ${STOCK_ADJUSTMENT_REASONS.map(r => `<option value="${r}">${r}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Note (optional)</label>
        <textarea class="form-input" id="adjustNoteInput" rows="2" placeholder="e.g. counted during weekly stock-take"></textarea>
      </div>
    </div>
  `;

  openModal({
    title: `<i class="fa-solid fa-scale-balanced" style="color:var(--info)"></i> Adjust Stock`,
    body,
    footer: `
      <button class="btn btn-ghost" id="cancelAdjustBtn">Cancel</button>
      <button class="btn btn-primary" id="saveAdjustBtn"><i class="fa-solid fa-floppy-disk mr-8"></i> Save Adjustment</button>
    `
  });

  document.getElementById('cancelAdjustBtn').onclick = () => closeModal();

  document.getElementById('saveAdjustBtn').onclick = async () => {
    const saveBtn = document.getElementById('saveAdjustBtn');
    saveBtn.disabled = true;
    const reason = document.getElementById('adjustReasonSelect').value;
    const note = document.getElementById('adjustNoteInput').value.trim();

    try {
      const inputs = document.querySelectorAll('.adjust-stock-input');
      let changedCount = 0;
      for (const input of inputs) {
        const variantName = input.dataset.variant || null;
        const newStock = Number(input.value);
        const currentStock = Number(hasVariants
          ? (product.variants.find(v => v.name === variantName)?.stock ?? 0)
          : (product.stock ?? 0));
        if (newStock === currentStock) continue;
        await adjustProductStock(product.id, variantName, newStock, reason, note);
        changedCount++;
      }

      closeModal();
      if (changedCount === 0) {
        showToast('No changes to save', 'info');
      } else {
        showToast(`Stock adjusted for ${changedCount} item${changedCount > 1 ? 's' : ''}`, 'success');
      }
      await renderTable(container, cur);
    } catch (err) {
      console.error('Stock adjustment error:', err);
      showToast('Error adjusting stock: ' + err.message, 'error');
      saveBtn.disabled = false;
    }
  };
}

async function openStockHistoryModal(product) {
  if (!product) return;
  const branchId = product.branchId || store.branch?.id || 'b1';
  const allLogs = await getInventoryLogs(branchId);
  const prodLogs = allLogs.filter(l => String(l.productId) === String(product.id));

  // Sort newest first
  prodLogs.sort((a, b) => new Date(b.date) - new Date(a.date));

  let tableRows = prodLogs.map(log => {
    let typeClass = log.type === 'IN' ? 'text-success' : 'text-danger';
    let sign = log.type === 'IN' ? '+' : '-';
    let dateStr = log.date ? new Date(log.date).toLocaleString('en-IN', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'}) : 'N/A';
    
    return `
      <tr>
        <td data-label="Date" style="white-space:nowrap;font-size:11px;opacity:0.8">${dateStr}</td>
        <td data-label="Variant">${log.variantName ? `<span class="badge badge-primary" style="font-size:10px">${escapeHtml(log.variantName)}</span>` : '<span style="opacity:0.5;font-size:11px">Base</span>'}</td>
        <td data-label="Reason" style="font-size:12px">${escapeHtml(log.reason)}</td>
        <td data-label="Stock Shift" style="font-size:12px; white-space:nowrap">
           ${log.oldStock !== null ? `<span style="opacity:0.6">${log.oldStock}</span> <i class="fa-solid fa-arrow-right mx-4" style="font-size:9px;opacity:0.4"></i> <b class="${typeClass}">${log.newStock}</b>` : `<b class="${typeClass}">${sign}${log.qtyChange}</b>`}
        </td>
        <td data-label="User" style="font-size:11px;opacity:0.7">${log.user || 'System'}</td>
      </tr>
    `;
  }).join('');

  if (prodLogs.length === 0) {
    tableRows = `<tr><td colspan="4" style="text-align:center;padding:32px;opacity:0.5;font-size:14px">No stock history recorded for this product yet.</td></tr>`;
  }

  const isVariant = product.variants && product.variants.length > 0;
  const stockStr = isVariant
    ? `${product.variants.reduce((s, v) => s + (Number(v.stock) || 0), 0)} (Total across ${product.variants.length} variants)`
    : `${product.stock}`;
  const historyStatus = getProductOverallStatus(product);

  openModal({
    title: `<i class="fa-solid fa-clock-rotate-left" style="color:var(--info)"></i> Stock History`,
    body: `
      <div style="background:var(--bg-elevated);border-radius:var(--radius-sm);padding:16px;margin-bottom:16px;display:flex;align-items:center;gap:16px">
        <div style="width:48px;height:48px;background:var(--bg-app);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:24px">
          ${product.image ? `<img src="${product.image}" style="width:100%;height:100%;object-fit:cover;border-radius:8px" />` : (product.emoji || '📦')}
        </div>
        <div>
          <div class="font-bold" style="font-size:16px">${escapeHtml(product.name)}</div>
          <div style="font-size:12px;opacity:0.7">Current Stock: <b class="${historyStatus === 'in' ? 'text-success' : historyStatus === 'low' ? 'text-warning' : 'text-danger'}">${stockStr}</b></div>
        </div>
      </div>
      
      <div class="table-wrap" style="max-height: 400px; overflow-y: auto;">
        <table class="responsive-table">
          <thead>
            <tr>
              <th>Date & Time</th>
              <th>Variant</th>
              <th>Reason</th>
              <th>Stock Shift</th>
              <th>User</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </div>
    `,
    footer: `<button class="btn btn-primary" onclick="closeModal()">Close Window</button>`
  });
}
