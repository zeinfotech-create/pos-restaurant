import { getProducts, getSettings, updateSettings, getCustomers, isRegisterOpen, getBusinessFeatures, getAppointments, getStaff, saveAppointment, deleteAppointment, updateAppointmentStatus, hasPermission, getCategories, getSubCategories, getLowStockProducts, getExpiringProducts, getCurrentRegisterId, getCurrentBranch, updateProduct, logInventoryChange, getCurrentUser } from '../db.js';
import { store, addToCart, onCartUpdate, getCartTotals, updateQty, removeFromCart, clearCart, setDiscount, setExtraTax, loadAppointmentIntoCart, updateCartItem } from '../store.js';
import { openModal, closeModal, showConfirm } from '../components/Modal.js';
import { openCustomerForm } from '../components/CustomerForm.js';
import { openCheckout } from '../services/CheckoutService.js';
import { showToast } from '../components/Toast.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { connectScale, isConnected as isScaleConnected, getLatestWeight } from '../services/WeightScaleService.js';
// ... rest of imports

let searchQuery = '';
let currentCategory = 'All';
let currentSubCategory = 'All';
let currentSort = 'most-sold';
let visibleCount = 20;
let isSummaryExpanded = false;
let isDiscountExpanded = false;
let isExtraTaxExpanded = false;
let activeSuggestionIndex = -1;
let currentSuggestions = [];
// Guards the Enter-key add-to-cart lookup below against a fast barcode
// scanner (or just two quick keystrokes) firing two 'Enter' keydown events
// before the first async getProducts() lookup resolves — without it, both
// resolve to the same product and addToCart() runs twice, silently
// doubling the scanned item's quantity.
let isProcessingEnterAdd = false;
// Drag-and-drop custom product order (only active while currentSort ===
// 'custom'). Tracks the id of the tile currently being dragged; module-level
// since only one drag can be in flight at a time for this page.
let dragSrcProductId = null;
export async function renderPOS(container) {
  if (window._posCleanup) { window._posCleanup(); window._posCleanup = null; }

  // store.registerId AND store.branch are only ever set once, in store.js's
  // initStore() at app startup, and never refreshed after — if the session's
  // registerId/branch changes later (opening/switching a register, branch
  // edits), these cached values go stale and POS keeps checking the WRONG
  // register/branch's shift status forever (this is exactly why the
  // Register page can correctly show "Closed" while POS still lets sales
  // through: Register.js re-fetches branch/register fresh on every render,
  // POS.js didn't). Refresh both fresh from the session every time this
  // page loads.
  store.registerId = await getCurrentRegisterId();
  store.branch = await getCurrentBranch();
  const registerId = store.registerId;
  const branchId = store.branch?.id;

  if (!(await isRegisterOpen(branchId, registerId))) {
    // Dynamicly load names for better feedback
    import('../db.js').then(async db => {
      const regs = await db.getBranchRegisters(branchId);
      const regName = regs.find(r => r.id === registerId)?.name || 'Global';
      const msgEl = document.getElementById('closedRegMsg');
      if (msgEl) msgEl.innerHTML = `Register <b>${escapeHtml(regName)}</b> is Closed at ${escapeHtml(store.branch?.name || '')}`;
    });

    container.innerHTML = `
      <div class="empty-state" style="height:70vh; flex-direction:column">
        <i class="fa-solid fa-lock" style="font-size:64px;margin-bottom:24px;opacity:0.2"></i>
        <h2 class="font-bold">Register is Closed</h2>
        <p class="mb-24 text-muted" id="closedRegMsg">You must open the shift before starting a sale.</p>
        <div class="flex gap-12">
          <button class="btn btn-primary" onclick="window.navigate('register')">
            <i class="fa-solid fa-key"></i> Open Register Shift
          </button>
          <button class="btn btn-ghost" id="changeRegisterBtn">
             <i class="fa-solid fa-right-from-bracket"></i> Change Register
          </button>
        </div>
      </div>
    `;

    document.getElementById('changeRegisterBtn').addEventListener('click', () => {
      import('../db.js').then(async db => {
        const branchId = store.branch?.id;
        const registers = await db.getBranchRegisters(branchId);

        import('../components/Modal.js').then(({ openModal, closeModal }) => {
          openModal({
            title: '<i class="fa-solid fa-cash-register"></i> Select Register',
            body: `
              <div style="display:flex;flex-direction:column;gap:10px;padding:4px">
                ${registers.length === 0
                ? '<p style="text-align:center;padding:24px;opacity:0.6">No registers found for this branch.</p>'
                : registers.map(r => {
                    const isCurrent = r.id === registerId;
                    return `
                    <button class="btn btn-ghost reg-pick-btn" data-id="${r.id}" style="justify-content:flex-start;height:54px;padding:0 20px;border:1px solid ${isCurrent ? 'var(--primary)' : 'var(--border)'}">
                      <i class="fa-solid fa-cash-register mr-12" style="color:var(--success)"></i>
                      <div class="font-bold">
                        ${escapeHtml(r.name)}
                        ${isCurrent ? '<span style="font-size:9px; background:var(--primary-light); color:var(--primary); padding:2px 6px; border-radius:4px; font-weight:700; margin-left:8px">CURRENT</span>' : ''}
                      </div>
                    </button>
                  `;
                  }).join('')}
              </div>
            `,
            footer: `<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>`
          });

          document.querySelectorAll('.reg-pick-btn').forEach(btn => {
            btn.onclick = async () => {
              const session = await db.getSession();
              await db.setSession(session.user, session.branch, btn.dataset.id);
              closeModal();
              window.location.reload();
            };
          });
        });
      });
    });

    return;

  }

  const settings = await getSettings();
  const features = await getBusinessFeatures();
  const cur = settings.currency;

  // Connect to the weight scale once per session (not on every re-render of
  // this page) if it's configured in Settings — fire-and-forget, a store
  // without a scale attached just never sets weightScaleEnabled and this
  // is a no-op.
  if (settings.weightScaleEnabled && settings.weightScalePort && !isScaleConnected()) {
    connectScale(settings.weightScalePort, settings.weightScaleBaudRate).catch(() => {});
  }

  if (!store.selectedCustomer) store.selectedCustomer = null;

  container.innerHTML = `
    <div class="pos-layout">
      <div class="pos-products">
        <div class="pos-products-header">
          <div class="flex gap-12 mb-16">
            <div class="search-input-wrap" style="flex:1">
              <i class="fa-solid fa-magnifying-glass"></i>
              <input class="form-input" id="productSearch" placeholder="Search by Name, SKU, or Barcode..." autocomplete="off" style="padding-right:70px" />
              <button id="customItemBtn" class="voice-search-btn" title="Add Custom Item" style="right:36px; color:var(--accent)">
                <i class="fa-solid fa-plus-circle"></i>
              </button>
              <button id="voiceSearchBtn" class="voice-search-btn" title="Voice Search">
                <i class="fa-solid fa-microphone"></i>
              </button>
              <div id="searchSuggestions" class="search-suggestions custom-scrollbar"></div>
            </div>
            <button class="btn btn-ghost" id="recentSalesBtn" title="Recent Sales" style="border:1px solid var(--border); color:var(--text-main); padding: 0 12px">
              <i class="fa-solid fa-clock-rotate-left text-primary"></i> <span class="hide-mobile ml-4">Recent Sales</span>
            </button>
            ${features.hasAppointments ? `
              <button class="btn btn-ghost" id="appointmentsBtn" style="border:1px solid var(--border); color:var(--text-main); padding: 0 12px">
                <i class="fa-solid fa-calendar-check text-accent"></i> <span class="hide-mobile ml-4">Appointments</span>
              </button>
            ` : ''}
          </div>
          <div class="category-chips-header" style="display:flex; justify-content:space-between; align-items:center; gap:12px">
            <div class="category-chips" id="categoryChips"></div>
            <div class="sort-control" style="background:var(--bg-elevated); border:2px solid ${currentSort === 'name-asc' ? 'var(--border)' : 'var(--primary)'}; border-radius:8px;  padding: 4px 10px; display:flex; align-items:center; gap:8px; flex-shrink:0; box-shadow: ${currentSort === 'name-asc' ? 'none' : '0 0 10px rgba(99, 102, 241, 0.3)'}; transition: all 0.2s">
              <i class="fa-solid ${currentSort === 'custom' ? 'fa-arrows-up-down-left-right' : 'fa-arrow-up-wide-short'}" style="font-size:12px; color:${currentSort === 'name-asc' ? 'var(--text-secondary)' : 'var(--primary)'}; opacity:0.8"></i>
              <select id="posSortSelect" style="border:none; background:transparent; font-size:12px; font-weight:700; outline:none; color:${currentSort === 'name-asc' ? 'var(--text-primary)' : 'var(--primary)'}; cursor:pointer; height:24px; padding-right:8px">
                <option value="name-asc" ${currentSort === 'name-asc' ? 'selected' : ''} style="background:var(--bg-elevated); color:var(--text-primary)">A to Z</option>
                <option value="name-desc" ${currentSort === 'name-desc' ? 'selected' : ''} style="background:var(--bg-elevated); color:var(--text-primary)">Z to A</option>
                <option value="price-asc" ${currentSort === 'price-asc' ? 'selected' : ''} style="background:var(--bg-elevated); color:var(--text-primary)">Price: Low to High</option>
                <option value="price-desc" ${currentSort === 'price-desc' ? 'selected' : ''} style="background:var(--bg-elevated); color:var(--text-primary)">Price: High to Low</option>
                <option value="most-sold" ${currentSort === 'most-sold' ? 'selected' : ''} style="background:var(--bg-elevated); color:var(--text-primary)">Most Sold First</option>
                <option value="custom" ${currentSort === 'custom' ? 'selected' : ''} style="background:var(--bg-elevated); color:var(--text-primary)">Custom Order</option>
              </select>
            </div>
          </div>
          <div id="posCustomOrderBanner"></div>
        </div>
        <div class="pos-products-grid-scroll">
          <div class="grid-auto" id="productGrid"></div>
        </div>
      </div>
      <div class="cart-panel" id="cartPanel"></div>
    </div>
  `;

  // Sort Listener
  const sortSelect = container.querySelector('#posSortSelect');
  if (sortSelect) {
    sortSelect.onchange = async () => {
      currentSort = sortSelect.value;
      visibleCount = 20; // reset pagination
      await renderProductGrid();
    };
  }

  // Infinite Scroll Listener
  const scrollWrapper = container.querySelector('.pos-products-grid-scroll');
  if (scrollWrapper) {
    scrollWrapper.onscroll = async () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollWrapper;
      if (scrollTop + clientHeight >= scrollHeight - 50) {
        // Near bottom
        const products = await getProducts(store.branch?.id);
        const totalProducts = products.length;
        if (visibleCount < totalProducts) {
          visibleCount += 20;
          await renderProductGrid(true); // true = append mode
        }
      }
    };
  }

  // Reactive listener for license changes
  const onLicenseUpdate = () => {
    console.log('[POS] License Status Updated');
  };
  window.addEventListener('license-status-changed', onLicenseUpdate);

  // The product catalog syncs down from the hub asynchronously — if this page
  // is opened right after login/register-open, renderProductGrid() above can
  // run before that sync lands in IndexedDB, showing "No products found"
  // even though the catalog is populated moments later (visible on Products
  // page by then, but POS never re-rendered to pick it up). Refresh the grid
  // whenever a sync finishes while this page is mounted.
  const onSyncApplied = () => { renderProductGrid(); };
  window.addEventListener('sync-full-state-applied', onSyncApplied);

  const cleanup = () => {
    window.removeEventListener('license-status-changed', onLicenseUpdate);
    window.removeEventListener('sync-full-state-applied', onSyncApplied);
    if (observer) observer.disconnect();
  };
  window._posCleanup = cleanup;

  // Cleanup listener when POS is destroyed/removed from DOM
  const observer = new MutationObserver(() => {
    if (!document.body.contains(container)) {
      cleanup();
      window._posCleanup = null;
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  const searchInput = document.getElementById('productSearch');
  searchInput.addEventListener('input', async (e) => {
    searchQuery = e.target.value.toLowerCase().trim();
    const normQuery = normalizeSearchQuery(searchQuery);

    // Auto-suggestion logic
    const allProducts = await getProducts(store.branch?.id);
    const matches = searchQuery ? allProducts.filter(p => {
      const pName = p.name.toLowerCase();
      const pSku = normalizeSearchQuery(p.sku || '');
      const pBarcode = normalizeSearchQuery(p.barcode || '');

      return pName.includes(searchQuery) ||
        (pSku && pSku.includes(normQuery)) ||
        (pBarcode && pBarcode.includes(normQuery));
    }).sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      const aStarts = aName.startsWith(searchQuery);
      const bStarts = bName.startsWith(searchQuery);
      
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      
      // If both start with it or both don't, sort by popular/sales count if available
      return aName.localeCompare(bName);
    }).slice(0, 8) : [];

    activeSuggestionIndex = -1;
    renderSearchSuggestions(matches);
    await renderProductGrid();
  });

  searchInput.addEventListener('keydown', async (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeSuggestionIndex = Math.min(activeSuggestionIndex + 1, currentSuggestions.length - 1);
      renderSearchSuggestions(currentSuggestions);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeSuggestionIndex = Math.max(activeSuggestionIndex - 1, -1);
      renderSearchSuggestions(currentSuggestions);
    } else if (e.key === 'Enter') {
      if (isProcessingEnterAdd) return;
      isProcessingEnterAdd = true;
      try {
        if (activeSuggestionIndex >= 0) {
          await selectProduct(currentSuggestions[activeSuggestionIndex]);
        } else if (currentSuggestions.length === 1) {
          // If only one match (e.g. barcode scan), select it automatically
          await selectProduct(currentSuggestions[0]);
        } else if (searchQuery) {
          // Check for exact barcode/sku match even if not selected in list
          const products = await getProducts(store.branch?.id);
          const exactMatch = products.find(p =>
            (p.barcode && p.barcode.toLowerCase() === searchQuery) ||
            (p.sku && p.sku.toLowerCase() === searchQuery)
          );
          if (exactMatch) await selectProduct(exactMatch);
        }
      } finally {
        isProcessingEnterAdd = false;
      }
    } else if (e.key === 'Escape') {
      renderSearchSuggestions([]);
    }
  });

  // Close suggestions on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-input-wrap')) {
      renderSearchSuggestions([]);
    }
  });

  document.getElementById('voiceSearchBtn')?.addEventListener('click', () => {
    startVoiceSearch();
  });
  document.getElementById('customItemBtn')?.addEventListener('click', () => {
    openCustomItemModal(cur);
  });
  document.getElementById('recentSalesBtn')?.addEventListener('click', async () => {
    const { openRecentSalesModal } = await import('../components/RecentSales.js');
    await openRecentSalesModal(cur);
  });

  await renderCategories();
  await renderProductGrid();
  renderCart(cur);

  /*
  document.getElementById('openCustomerDisplayBtn')?.addEventListener('click', () => {
    window.open(window.location.origin + '#customer-display', 'pos_customer_display', 'width=1000,height=800');
    import('../store.js').then(s => s.syncCart());
  });
  */

  import('../store.js').then(s => s.syncCart());

  onCartUpdate(async () => {
    if (document.getElementById('cartPanel')) renderCart(cur);
    await renderProductGrid();
  });

  document.getElementById('appointmentsBtn')?.addEventListener('click', async () => {
    await openAppointmentsModal(cur);
  });
}

function handleProductAddition(product, variant = null) {
  // Weight-sold items (unit: 'kg' — fruit, veg, bulk grains) use whatever
  // the connected scale last read instead of the usual qty-of-1 default.
  // Falls straight through to the normal behavior if there's no scale
  // configured, it's not connected yet, or nothing's on the scale pan —
  // getLatestWeight() is just null in every one of those cases.
  let qty = 1;
  if (!variant && product.unit === 'kg') {
    const weight = getLatestWeight();
    if (weight && weight > 0) {
      qty = weight;
      showToast(`Weight captured: ${weight.toFixed(3)} kg`, 'info');
    }
  }
  addToCart(product, variant, qty);
}

async function renderCategories() {
  const branchId = store.branch?.id;
  const allProducts = await getProducts(branchId);
  const categoriesList = await getCategories();
  
  // Only show categories that have at least one product
  const activeCategories = categoriesList.filter(c => 
    allProducts.some(p => p.category && p.category.trim().toLowerCase() === c.name.trim().toLowerCase())
  );
  
  const hasUncategorized = allProducts.some(p => !p.category || p.category.trim() === '' || p.category === 'Uncategorized');
  
  const categories = activeCategories.sort((a, b) => a.name.localeCompare(b.name));
  const allCats = [{ id: 'all', name: 'All' }, ...categories];
  
  if (hasUncategorized) {
    allCats.push({ id: 'uncategorized', name: 'Uncategorized' });
  }

  // If the current category is no longer in the list (e.g., all products moved), reset to 'All'
  if (!allCats.some(c => c.name === currentCategory)) {
    currentCategory = 'All';
    currentSubCategory = 'All';
  }

  const chips = document.getElementById('categoryChips');
  if (!chips) return;

  const selectedCatObj = allCats.find(c => c.name === currentCategory);
  let subCategories = (selectedCatObj && selectedCatObj.id !== 'all') 
    ? (await getSubCategories(selectedCatObj.id)).sort((a,b) => a.name.localeCompare(b.name)) 
    : [];
    
  if (subCategories.length > 0) {
    subCategories = subCategories.filter(s => 
      allProducts.some(p => 
        p.category && p.category.trim().toLowerCase() === currentCategory.trim().toLowerCase() &&
        p.subCategory && p.subCategory.trim().toLowerCase() === s.name.trim().toLowerCase()
      )
    );
    // Reset sub-category if it's no longer in the list
    if (currentSubCategory !== 'All' && !subCategories.some(s => s.name === currentSubCategory)) {
      currentSubCategory = 'All';
    }
  }

  chips.innerHTML = `
    <!-- Top Level Categories -->
    <div style="display:flex; gap:8px; overflow-x:auto; padding-bottom:8px; margin-bottom: 8px;" class="custom-scrollbar categories-row">
      ${allCats.map(c =>
        `<div class="chip ${c.name === currentCategory ? 'active' : ''}" data-cat="${escapeHtml(c.name)}">${escapeHtml(c.name)}</div>`
      ).join('')}
    </div>
    
    <!-- Sub-categories (Conditional) -->
    ${subCategories.length > 0 ? `
      <div style="display:flex; gap:8px; overflow-x:auto; padding-bottom:12px; animation: slideDown 0.3s ease" class="custom-scrollbar sub-categories-row">
        <div class="chip sub-chip ${currentSubCategory === 'All' ? 'active' : ''}" data-sub="All">All ${currentCategory}</div>
        ${subCategories.map(s =>
          `<div class="chip sub-chip ${s.name === currentSubCategory ? 'active' : ''}" data-sub="${escapeHtml(s.name)}">${escapeHtml(s.name)}</div>`
        ).join('')}
      </div>
    ` : ''}

    <style>
      .categories-row .chip { background: var(--bg-elevated); border: 1px solid var(--border); font-weight: 700; white-space: nowrap; }
      .categories-row .chip.active { background: var(--primary); color: #fff; border-color: var(--primary); }
      .sub-categories-row .chip { background: rgba(var(--primary-rgb), 0.05); border: 1px dashed var(--primary); color: var(--primary); font-size: 11px; padding: 4px 12px; font-weight: 800; }
      .sub-categories-row .chip.active { background: var(--primary); color: #fff; border-style: solid; }
      @keyframes slideDown { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
    </style>
  `;

  chips.querySelectorAll('.categories-row .chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      if (currentCategory === chip.dataset.cat) return;
      currentCategory = chip.dataset.cat;
      currentSubCategory = 'All'; // Reset sub-category on parent change
      await renderCategories();
      await renderProductGrid();
    });
  });

  chips.querySelectorAll('.sub-categories-row .chip').forEach(chip => {
    chip.addEventListener('click', async () => {
        currentSubCategory = chip.dataset.sub;
      await renderCategories();
      await renderProductGrid();
    });
  });
}

async function renderProductGrid(append = false) {
  const grid = document.getElementById('productGrid');
  if (!grid) return;

  const branchId = store.branch?.id;
  const allProducts = await getProducts(branchId);
  const settings = await getSettings(branchId);
  let products = [...allProducts];

  // 1. Filtering
  if (currentCategory !== 'All') {
    if (currentCategory === 'Uncategorized') {
      products = products.filter(p => !p.category || p.category.trim() === '' || p.category === 'Uncategorized');
    } else {
      products = products.filter(p => p.category && p.category.trim().toLowerCase() === currentCategory.trim().toLowerCase());
      if (currentSubCategory !== 'All') {
        products = products.filter(p => p.subCategory && p.subCategory.trim().toLowerCase() === currentSubCategory.trim().toLowerCase());
      }
    }
  }
  if (searchQuery) {
    const normQuery = normalizeSearchQuery(searchQuery);
    products = products.filter(p => {
      const pName = p.name.toLowerCase();
      const pSku = normalizeSearchQuery(p.sku || '');
      const pBarcode = normalizeSearchQuery(p.barcode || '');
      return pName.includes(searchQuery) || (pSku && pSku.includes(normQuery)) || (pBarcode && pBarcode.includes(normQuery));
    });
  }

  // 2. Sorting
  const orders = import.meta ? [] : (window.db?.getOrders ? window.db.getOrders(branchId) : []);
  // Fallback because getOrders is imported but let's be safe. Wait, I can call the imported getOrders.
  // Actually, I'll calculate popular items count if "most-sold" is selected.
  let popularMap = {};
  if (currentSort === 'most-sold') {
    const db = await import('../db.js');
    const orderHistory = await db.getOrders(branchId);
    orderHistory.forEach(o => {
      (o.items || []).forEach(item => {
        popularMap[item.id] = (popularMap[item.id] || 0) + item.qty;
      });
    });
  }

  // "Custom Order" — user-dragged arrangement, saved per-branch on
  // settings.posCustomProductOrder (array of product ids). Anything not yet
  // placed (new products) falls after the placed ones, alphabetically among
  // themselves so it's at least predictable until the user drags them too.
  let customOrderMap = {};
  if (currentSort === 'custom') {
    const savedOrder = Array.isArray(settings.posCustomProductOrder) ? settings.posCustomProductOrder : [];
    savedOrder.forEach((id, idx) => { customOrderMap[String(id)] = idx; });
  }

  products.sort((a, b) => {
    // RULE 1: Out of stock last — skipped in Custom Order mode so a manually
    // dragged arrangement stays exactly where the user put it, stock or not.
    if (currentSort !== 'custom') {
      const aStock = a.stock || 0;
      const bStock = b.stock || 0;
      if (aStock > 0 && bStock <= 0) return -1;
      if (aStock <= 0 && bStock > 0) return 1;
    }

    // RULE 2: Primary Sort
    switch (currentSort) {
      case 'name-asc': return a.name.localeCompare(b.name);
      case 'name-desc': return b.name.localeCompare(a.name);
      case 'price-asc': return (a.price || 0) - (b.price || 0);
      case 'price-desc': return (b.price || 0) - (a.price || 0);
      case 'most-sold': return (popularMap[b.id] || 0) - (popularMap[a.id] || 0);
      case 'custom': {
        const aIdx = customOrderMap[String(a.id)];
        const bIdx = customOrderMap[String(b.id)];
        const aPlaced = aIdx !== undefined, bPlaced = bIdx !== undefined;
        if (aPlaced && bPlaced) return aIdx - bIdx;
        if (aPlaced) return -1;
        if (bPlaced) return 1;
        return a.name.localeCompare(b.name);
      }
      default: return 0;
    }
  });

  // Custom Order banner — instructions + a way to undo, shown only in this mode.
  const banner = document.getElementById('posCustomOrderBanner');
  if (banner) {
    banner.innerHTML = currentSort === 'custom' ? `
      <div style="display:flex; align-items:center; gap:10px; background:rgba(99,102,241,0.08); border:1px dashed var(--primary); border-radius:8px; padding:8px 14px; margin:10px 0; font-size:12px; color:var(--text-primary);">
        <i class="fa-solid fa-hand-pointer" style="color:var(--primary)"></i>
        <span style="flex:1;"><b>Drag &amp; drop</b> any product tile to arrange your own order. Saved automatically.</span>
        <button id="posResetCustomOrderBtn" class="btn btn-ghost btn-sm" style="font-size:11px; padding:4px 10px;">
          <i class="fa-solid fa-rotate-left"></i> Reset
        </button>
      </div>
    ` : '';
    const resetBtn = document.getElementById('posResetCustomOrderBtn');
    if (resetBtn) {
      resetBtn.onclick = async () => {
        await updateSettings({ posCustomProductOrder: [] });
        if (window.showToast) window.showToast('Custom order reset', 'success');
        await renderProductGrid();
      };
    }
  }

  // 3. Pagination (Lazy Load)
  const slicedProducts = products.slice(0, visibleCount);

  if (slicedProducts.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><i class="fa-solid fa-box-open"></i><p>No products found</p></div>`;
    return;
  }

  const isCustomMode = currentSort === 'custom';

  const html = slicedProducts.map(p => {
    const hasVariants = p.variants && p.variants.length > 0;
    const cartQty = store.cart.filter(item => String(item.id) === String(p.id)).reduce((sum, item) => sum + item.qty, 0);
    
    let originalStock = p.stock || 0;
    if (hasVariants) {
      originalStock = p.variants.reduce((s, v) => s + (Number(v.stock) || 0), 0);
    }
    const available = Math.max(0, originalStock - cartQty);
    const isOutOfStock = available <= 0;
    
    // Check if popular (top 5 by sales count in popularMap)
    const isPopular = currentSort === 'most-sold' && popularMap[p.id] > 0 && 
                      Object.values(popularMap).sort((a,b) => b-a).slice(0, 5).includes(popularMap[p.id]);

    const taxRate = parseFloat(p.taxRate ?? (settings.taxRate || 0));
    const isPctDiscount = p.itemDiscountType === 'pct';
    const discountAmt = isPctDiscount ? (p.price * (Number(p.itemDiscount) || 0) / 100) : (Number(p.itemDiscount) || 0);
    const basePrice = p.price - discountAmt;
    // p.price already contains tax for an inclusive-tax item (the default
    // tax type for new products) — adding tax on top again double-counted
    // it here, showing a tile price up to (taxRate)% higher than what the
    // cart/receipt actually charges for that same product.
    const finalPrice = p.taxType === 'inclusive' ? basePrice : basePrice * (1 + taxRate/100);

    return `
      <div class="product-card ${isOutOfStock ? 'out-of-stock' : ''} ${isCustomMode ? 'custom-order-tile' : ''}" data-id="${p.id}" style="position:relative" ${isCustomMode ? 'draggable="true"' : ''}>
        ${isCustomMode ? `<div class="pos-drag-handle" title="Drag to reorder"><i class="fa-solid fa-grip-vertical"></i></div>` : ''}
        ${isPopular ? `<div style="position:absolute; top:6px; left:6px; width:24px; height:24px; background:linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%); color:#fff; display:flex; align-items:center; justify-content:center; border-radius:50%; z-index:2; box-shadow:0 4px 8px rgba(217,119,6,0.3); border:1.5px solid rgba(255,255,255,0.4); animation: pulse 2s infinite" title="Most Sold Item"><i class="fa-solid fa-crown" style="font-size:10px"></i></div>` : ''}
        <div class="product-emoji">
          ${p.image ? `<img src="${p.image}" draggable="false" style="width:100%;height:100%;object-fit:cover;border-radius:8px" />` : (p.emoji || '📦')}
        </div>
        <div class="product-name" style="${isOutOfStock ? 'opacity:0.6' : ''}">${escapeHtml(p.name)}</div>
        <div class="product-price">
          ${p.itemDiscount > 0 ? `<span style="text-decoration:line-through; font-size:0.85em; opacity:0.5; margin-right:4px;">\u20B9${p.price.toFixed(2)}</span>` : ''}
          \u20B9${finalPrice.toFixed(2)}${settings.enableUnitOfMeasure !== false && p.unit && p.unit !== 'pcs' ? `<span style="font-size:0.7em; opacity:0.6">/${p.unit}</span>` : ''}
          ${settings.enableUnitOfMeasure !== false && p.unit === 'kg' && isScaleConnected() ? `<span style="font-size:0.75em; margin-left:2px" title="Uses the connected Weight Scale">\u2696\uFE0F</span>` : ''}
        </div>
        ${p.itemDiscount > 0 ? `<div style="position:absolute; top:6px; right:6px; background:var(--danger); color:white; font-size:9px; padding:2px 5px; border-radius:4px; font-weight:900; z-index:10; box-shadow:0 2px 4px rgba(239,68,68,0.2); animation: pulse 2.5s infinite">${isPctDiscount ? p.itemDiscount + '%' : '\u20B9' + p.itemDiscount} OFF</div>` : ''}

        <div class="product-stock ${available <= 5 && !hasVariants ? 'text-danger' : ''}">
          ${hasVariants ?
            `<span style="color:var(--primary); font-weight:800; background:rgba(99,102,241,0.1); padding:2px 6px; border-radius:4px;"><i class="fa-solid fa-layer-group mr-4"></i> ${p.variants.length} Options</span>` :
            (available > 0 ? `${parseFloat(available.toFixed(3))} ${settings.enableUnitOfMeasure !== false ? (p.unit || 'pcs') : ''} in stock` : '<span style="color:var(--danger)">Out of stock</span>')
          }
        </div>
      </div>
    `}).join('');

  grid.innerHTML = html;

  grid.querySelectorAll('.product-card:not(.out-of-stock)').forEach(card => {
    card.addEventListener('click', async () => {
      // In Custom Order mode a click firing right after a drag (dragstart
      // already set this) shouldn't also add the item to cart.
      if (dragSrcProductId) return;
      const product = allProducts.find(p => p.id == card.dataset.id);
      if (product) {
        if (product.variants && product.variants.length > 0) {
          await openVariantSelectionModal(product);
        } else {
          await handleProductAddition(product);
        }
      }
    });
  });

  wireProductGridDrag(grid);
}

// Drag-and-drop reordering for Custom Order mode. Wired once per #productGrid
// element (guarded via a dataset flag) since renderProductGrid() only
// replaces the grid's innerHTML on sort/search/pagination changes — the grid
// element itself persists across those, so delegated listeners bound to it
// survive without needing to be re-attached every render.
function wireProductGridDrag(grid) {
  if (grid.dataset.dragWired) return;
  grid.dataset.dragWired = '1';

  grid.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.product-card[draggable="true"]');
    if (!card) return;
    dragSrcProductId = card.dataset.id;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    // Required by the HTML5 drag API for the drop to fire in some browsers,
    // even though the actual id is tracked via the closure var above.
    e.dataTransfer.setData('text/plain', card.dataset.id);
  });

  grid.addEventListener('dragover', (e) => {
    const card = e.target.closest('.product-card[draggable="true"]');
    if (!card || !dragSrcProductId || card.dataset.id === dragSrcProductId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    grid.querySelectorAll('.product-card.drag-over').forEach(el => el.classList.remove('drag-over'));
    card.classList.add('drag-over');
  });

  grid.addEventListener('dragleave', (e) => {
    const card = e.target.closest('.product-card[draggable="true"]');
    if (card && !card.contains(e.relatedTarget)) card.classList.remove('drag-over');
  });

  grid.addEventListener('drop', async (e) => {
    const card = e.target.closest('.product-card[draggable="true"]');
    e.preventDefault();
    if (!card || !dragSrcProductId) return;
    const targetId = card.dataset.id;
    card.classList.remove('drag-over');
    if (targetId === dragSrcProductId) return;
    await persistCustomOrder(dragSrcProductId, targetId);
    await renderProductGrid();
  });

  grid.addEventListener('dragend', () => {
    grid.querySelectorAll('.product-card.dragging, .product-card.drag-over').forEach(el => el.classList.remove('dragging', 'drag-over'));
    // Cleared on a short delay, not immediately — the 'click' listener above
    // needs to still see it on the click event that Chromium fires right
    // after a drag-and-drop sequence ends on the same element.
    setTimeout(() => { dragSrcProductId = null; }, 50);
  });
}

// Moves `draggedId` to just before `targetId` in the branch's saved custom
// order, persisting the FULL product id list (not just the currently
// filtered/visible tiles) so a drag performed while searching/filtering
// doesn't silently drop every other product out of the saved order.
async function persistCustomOrder(draggedId, targetId) {
  const branchId = store.branch?.id;
  const [allProductsFresh, settings] = await Promise.all([getProducts(branchId), getSettings(branchId)]);
  const savedOrder = Array.isArray(settings.posCustomProductOrder) ? settings.posCustomProductOrder : [];

  const idToProduct = new Map(allProductsFresh.map(p => [String(p.id), p]));
  const placed = savedOrder.map(String).filter(id => idToProduct.has(id));
  const placedSet = new Set(placed);
  const unplaced = allProductsFresh
    .filter(p => !placedSet.has(String(p.id)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(p => String(p.id));

  let fullOrder = [...placed, ...unplaced];
  const dId = String(draggedId), tId = String(targetId);
  fullOrder = fullOrder.filter(id => id !== dId);
  const targetIdx = fullOrder.indexOf(tId);
  fullOrder.splice(targetIdx === -1 ? fullOrder.length : targetIdx, 0, dId);

  await updateSettings({ posCustomProductOrder: fullOrder });
}




// ============================================================
// Desktop Cart Panel logic
// ============================================================
export async function renderCart(cur) {
  const panel = document.getElementById('cartPanel');
  if (!panel) return;

  try {
    const settings = store.settings || await getSettings();
    const { subtotal, discount, tax, taxRate, total, orderDiscount, itemDiscount, itemTax, grossTax, orderTax, roundOff } = getCartTotals();
    const cartLineCount = store.cart.length;
    const cartQtyCount = store.cart.reduce((s, i) => s + (parseFloat(i.qty) || 0), 0);
    const itemCount = store.cart.reduce((s, i) => s + i.qty, 0);
    const customers = await getCustomers(store.branch?.id);
    const features = await getBusinessFeatures();

    const canCustomPrice = await hasPermission('pos:custom_price');
    const canDiscount = await hasPermission('pos:discount');

  panel.innerHTML = `
    <div class="cart-header" style="padding:6px 16px">
      <div style="display:flex; align-items:center; gap:8px">
        <i class="fa-solid fa-cart-shopping text-primary" style="font-size:18px"></i>
        <span style="font-weight:800; font-size:16px">Cart</span>
        <span class="badge badge-primary" style="font-size:11px">${store.cart.length}</span>
      </div>
      <button class="btn btn-ghost btn-icon btn-sm" id="clearCartBtn" title="Clear Cart" style="color:var(--danger)">
        <i class="fa-solid fa-trash-can"></i>
      </button>
    </div>

    <!-- Reverted Order Context UI (Moved to Top) -->
    <div class="cart-order-meta" style="padding:4px 12px; gap:4px">
      ${!features.hasAppointments || !store.selectedAppointmentId ? `
        <div class="cart-meta-row no-hover" style="padding:4px 10px; position:relative">
          <span class="cart-meta-icon"><i class="fa-solid fa-user"></i></span>
          <div style="flex:1; position:relative; display:flex; align-items:center;">
             <input type="text" id="posCustSearch" placeholder="Search Customer..." 
               autocomplete="off"
               style="border:none; padding:4px 0; background:transparent; font-weight:700; width:100%; outline:none; font-size:13px; color:var(--text-main)"
               value="${escapeHtml(store.selectedCustomer ? store.selectedCustomer.name : 'Walk-in Customer')}" />
             <div id="posCustSuggestions" class="ep-suggestions hidden" style="position:absolute; top:36px; left:-34px; width:calc(100% + 56px); z-index:100; background:var(--bg-elevated); box-shadow:var(--shadow-lg); border-radius:12px; border:1px solid var(--border); overflow:hidden"></div>
          </div>
          ${store.selectedCustomer ? `
            <button id="posClearCustBtn" class="cart-meta-add" style="color:var(--danger); margin-right:4px" title="Reset to Walk-in"><i class="fa-solid fa-circle-xmark"></i></button>
          ` : ''}
          <button id="posAddCustomerBtn" class="cart-meta-add" title="Add New Customer"><i class="fa-solid fa-circle-plus"></i></button>
        </div>
        ${settings.enableLoyalty !== false && store.selectedCustomer ? `
          <div class="cart-loyalty-strip" style="padding:4px 10px; font-size:11px; margin-top:2px">
            <i class="fa-solid fa-star" style="color:var(--warning);font-size:10px"></i>
            <span>${store.selectedCustomer.loyaltyPoints || 0} pts</span>
            <span class="cart-loyalty-tier" style="color:${store.selectedCustomer.tier?.color || 'var(--primary)'}">${store.selectedCustomer.tier?.name || 'Silver'}</span>
          </div>
        ` : ''}
        ${store.selectedCustomer && (store.selectedCustomer.creditBalance || 0) < 0 ? `
          <div style="display:flex; align-items:center; gap:8px; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.3); border-radius:6px; padding:6px 10px; margin:4px 10px 0; font-size:11px; color:var(--danger); font-weight:600;">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <span>Already owes <b>${cur}${Math.abs(store.selectedCustomer.creditBalance).toFixed(2)}</b> from before.</span>
          </div>
        ` : ''}
        ${settings.enableStaffEarnings !== false ? `
        <div class="cart-meta-row no-hover" style="padding:4px 10px; position:relative">
          <span class="cart-meta-icon"><i class="fa-solid fa-user-tie"></i></span>
          <div style="flex:1; position:relative; display:flex; align-items:center;">
             <input type="text" id="posStaffSearch" placeholder="Assign Staff (optional)..."
               autocomplete="off"
               style="border:none; padding:4px 0; background:transparent; font-weight:700; width:100%; outline:none; font-size:13px; color:var(--text-main)"
               value="${escapeHtml(store.selectedStaff ? store.selectedStaff.name : '')}" />
             <div id="posStaffSuggestions" class="ep-suggestions hidden" style="position:absolute; top:36px; left:-34px; width:calc(100% + 56px); z-index:100; background:var(--bg-elevated); box-shadow:var(--shadow-lg); border-radius:12px; border:1px solid var(--border); overflow:hidden"></div>
          </div>
          ${store.selectedStaff ? `
            <button id="posClearStaffBtn" class="cart-meta-add" style="color:var(--danger)" title="Clear"><i class="fa-solid fa-circle-xmark"></i></button>
          ` : ''}
        </div>
        ` : ''}
      ` : `
        <div class="cart-meta-row">
          <span class="cart-meta-icon"><i class="fa-solid fa-calendar-check" style="color:var(--accent)"></i></span>
          <div style="flex:1;min-width:0">
            <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">Appointment</div>
            <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${store.selectedCustomer?.name || 'Walk-in'}</div>
          </div>
          <button class="cart-meta-add" id="posClearAppoCust" title="Clear"><i class="fa-solid fa-xmark"></i></button>
        </div>
      `}
    </div>

    <div class="cart-items" style="flex:1; overflow-y:auto; padding-bottom:8px; display:flex; flex-direction:column; justify-content:flex-start">
      ${store.cart.length === 0 ? `
        <div class="empty-state" style="padding:60px 20px">
          <i class="fa-solid fa-cart-arrow-down" style="font-size:40px; opacity:0.1; margin-bottom:16px"></i>
          <p style="color:var(--text-muted); font-weight:600">Your cart is empty</p>
          <p style="font-size:12px; color:var(--text-muted); opacity:0.7; margin-top:4px">Select items to start order</p>
        </div>
      ` : store.cart.map(item => `
        <div class="cart-item-wrapper" style="border-bottom:1px solid var(--border)">
          <div class="cart-item" data-cart-id="${item.cartId}" style="border:none; padding:6px 10px">
            <div style="width:24px;height:24px;border-radius:4px;background:var(--bg-elevated);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0">
              ${item.image ? `<img src="${item.image}" style="width:100%;height:100%;object-fit:cover" />` : (item.emoji || '📦')}
            </div>
            <div class="cart-item-info" style="min-width:0;flex:1">
              <div class="cart-item-name" style="font-size:14px" title="${escapeHtml(item.name)}${item.variantName ? ` (${escapeHtml(item.variantName)})` : ''}">${escapeHtml(item.name)}${item.variantName ? ` <span style="color:var(--accent); font-weight:800; font-size:12px">(${escapeHtml(item.variantName)})</span>` : ''}</div>
              <div class="cart-item-price" style="font-size:12px; opacity:0.8">
                ${cur}${item.price}
                ${item.unit ? `<span style="font-size:10px;opacity:0.55;margin-left:2px">/${item.unit}</span>` : ''}
                × ${item.qty}
                ${item.effectiveDiscount > 0 ? `<span style="font-size:10px;color:var(--success);margin-left:4px" title="Discount applied">- ${cur}${item.effectiveDiscount.toFixed(2)}</span>` : ''}
              </div>
              ${(() => {
                // Base (pre-tax equivalent) for inclusive-tax items — same
                // post-discount-derived value as Quick POS's cart table and
                // the receipts, informational only (Rate × Qty − Discount
                // is still what Amount is actually computed from).
                if (item.taxType !== 'inclusive' || !(parseFloat(item.taxRate) > 0)) return '';
                const perUnitDiscount = item.itemDiscountType === 'pct'
                  ? (item.price * (Number(item.itemDiscount) || 0) / 100)
                  : (Number(item.itemDiscount) || 0);
                const taxableUnit = Math.max(0, item.price - perUnitDiscount);
                const baseUnit = taxableUnit / (1 + parseFloat(item.taxRate) / 100);
                return `<div style="font-size:10px; opacity:0.55">${cur}${baseUnit.toFixed(2)} base</div>`;
              })()}
            </div>
            <div class="qty-controls">
              <button class="qty-btn qty-minus-btn cart-minus-btn" data-id="${item.cartId}" data-delta="-1" style="width:22px; height:22px; font-size:12px">−</button>
              <span class="qty-value" style="font-size:13px; min-width:20px">${item.qty}${settings.enableUnitOfMeasure !== false ? ` ${escapeHtml(item.unit || 'pcs')}` : ''}</span>
              <button class="qty-btn qty-plus-btn cart-plus-btn" data-id="${item.cartId}" data-delta="1" style="width:22px; height:22px; font-size:12px">+</button>
            </div>
            <div class="cart-item-total" style="font-weight:700; font-size:13px; color:var(--accent); min-width:60px; text-align:right">
              ${cur}${(
                (() => {
                  const perUnitDiscount = item.itemDiscountType === 'pct'
                    ? (item.price * (Number(item.itemDiscount) || 0) / 100)
                    : (Number(item.itemDiscount) || 0);
                  const base = Math.max(0, (item.price - perUnitDiscount) * item.qty);
                  return item.taxType === 'exclusive'
                    ? base * (1 + (parseFloat(item.taxRate) || 0) / 100)
                    : base;
                })()
              ).toFixed(2)}
            </div>
            <button class="remove-btn cart-remove-btn" data-remove="${item.cartId}" style="width:22px;height:22px;border-radius:4px;border:none;background:rgba(239,68,68,0.12);color:var(--danger);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;transition:background 0.15s">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <div class="cart-item-inline-edit" id="inline-edit-${item.cartId}" style="display:none;padding:12px;background:var(--bg-elevated);border-top:1px solid var(--border);animation:fadeIn 0.15s ease">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div>
                <label style="font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase;margin-bottom:4px;display:block">Quantity</label>
                <input class="form-input" id="ie-qty-${item.cartId}" type="number" min="0.001" step="0.001" value="${item.qty}" style="height:32px;font-size:13px" />
              </div>
              <div>
                <label style="font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase;margin-bottom:4px;display:block">Price (${cur})</label>
                <input class="form-input" id="ie-price-${item.cartId}" type="number" min="0" step="0.01" value="${item.price}"
                  ${!canCustomPrice ? 'disabled style="opacity:0.6; cursor:not-allowed"' : ''}
                  style="height:32px;font-size:13px" />
              </div>
              <div>
                <label style="font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase;margin-bottom:4px;display:block">Unit</label>
                <input class="form-input" id="ie-unit-${item.cartId}" type="text" list="ie-unit-list-${item.cartId}" value="${item.unit || 'pcs'}" style="height:32px;font-size:13px" />
                <datalist id="ie-unit-list-${item.cartId}">${(settings.unitsOfMeasure?.length ? settings.unitsOfMeasure : ['pcs','kg','g','ltr','dz','box']).map(u => `<option value="${escapeHtml(u)}">`).join('')}</datalist>
              </div>
              <div>
                <label style="font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase;margin-bottom:4px;display:block">Discount</label>
                <div style="display:flex;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;height:32px">
                  <input class="form-input" id="ie-discount-${item.cartId}" type="number" value="${item._discountRaw ?? item.itemDiscount ?? 0}" style="border:none;flex:1;min-width:0;font-size:13px" />
                  <button class="ie-disc-type-btn" data-id="${item.cartId}" data-type="flat" style="width:36px;border:none;border-left:1px solid var(--border);background:${(item._discountType || 'flat') === 'flat' ? 'var(--primary)' : 'transparent'};color:${(item._discountType || 'flat') === 'flat' ? '#fff' : 'var(--text-muted)'}">${cur}</button>
                  <button class="ie-disc-type-btn" data-id="${item.cartId}" data-type="pct" style="width:36px;border:none;border-left:1px solid var(--border);background:${(item._discountType || 'flat') === 'pct' ? 'var(--primary)' : 'transparent'};color:${(item._discountType || 'flat') === 'pct' ? '#fff' : 'var(--text-muted)'}">%</button>
                </div>
              </div>
              <div>
                <label style="font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase;margin-bottom:4px;display:block">Tax Rate</label>
                <div style="display:flex;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;height:32px">
                  <select id="ie-tax-${item.cartId}" style="border:none;flex:1;min-width:0;font-size:13px;padding:0 4px;background:transparent;color:var(--text-main);outline:none" ${!settings.availableTaxes?.length ? 'disabled' : ''}>
                    ${settings.availableTaxes?.length
                      ? settings.availableTaxes.map(t => `<option value="${t}" ${item.taxRate == t ? 'selected' : ''}>${t}%</option>`).join('')
                      : `<option value="0">No rates — add in Settings</option>`}
                  </select>
                  <button class="ie-tax-type-btn" data-id="${item.cartId}" data-type="exclusive" style="width:36px;border:none;border-left:1px solid var(--border);font-size:10px;font-weight:800;background:${(item.taxType||'exclusive')==='exclusive'?'var(--primary)':'transparent'};color:${(item.taxType||'exclusive')==='exclusive'?'#fff':'var(--text-muted)'}">EXC</button>
                  <button class="ie-tax-type-btn" data-id="${item.cartId}" data-type="inclusive" style="width:36px;border:none;border-left:1px solid var(--border);font-size:10px;font-weight:800;background:${(item.taxType||'exclusive')==='inclusive'?'var(--primary)':'transparent'};color:${(item.taxType||'exclusive')==='inclusive'?'#fff':'var(--text-muted)'}">INC</button>
                </div>
              </div>
            </div>
            <div style="display:flex;gap:8px;margin-top:12px">
              <button class="btn btn-ghost btn-sm ie-cancel-btn" data-id="${item.cartId}" style="flex:1">Cancel</button>
              <button class="btn btn-primary btn-sm ie-save-btn" data-id="${item.cartId}" style="flex:2"><i class="fa-solid fa-check mr-4"></i>Update</button>
            </div>
          </div>
        </div>
      `).join('')}
    </div>

    <div class="cart-summary" style="padding:${isSummaryExpanded ? '8px 16px' : '4px 16px'}">

      <div id="summaryDetails" style="display:${isSummaryExpanded ? 'flex' : 'none'}; flex-direction:column; gap:4px; margin-bottom:4px; border-bottom:1px dashed var(--border); padding-bottom:4px">
        <div class="summary-row">
          <span class="summary-label">Subtotal</span>
          <span class="summary-value">${cur}${subtotal.toFixed(2)}</span>
        </div>
        <!-- Same compact breakdown as Quick POS's totals box (Items/Itm
             Disc/Itm Tax/Extra Disc/Extra Tax), 2-per-row — Items also
             pairs with a Qty count Quick POS doesn't show, since a cart
             here can hold multiple units of the same line. -->
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:2px 10px">
          <div class="summary-row">
            <span class="summary-label">Items</span>
            <span class="summary-value">${cartLineCount}</span>
          </div>
          <div class="summary-row">
            <span class="summary-label">Qty</span>
            <span class="summary-value">${Number.isInteger(cartQtyCount) ? cartQtyCount : cartQtyCount.toFixed(3)}</span>
          </div>
          <div class="summary-row">
            <span class="summary-label${itemDiscount > 0 ? ' text-success' : ''}">Item Disc</span>
            <span class="summary-value${itemDiscount > 0 ? ' text-success' : ''}">${itemDiscount > 0 ? '−' : ''}${cur}${itemDiscount.toFixed(2)}</span>
          </div>
          <div class="summary-row">
            <span class="summary-label">Item Tax</span>
            <span class="summary-value">${cur}${(grossTax || itemTax).toFixed(2)}</span>
          </div>
          <div class="summary-row">
            <span class="summary-label${orderDiscount > 0 ? ' text-success' : ''}">Extra Disc</span>
            <span class="summary-value${orderDiscount > 0 ? ' text-success' : ''}">${orderDiscount > 0 ? '−' : ''}${cur}${orderDiscount.toFixed(2)}</span>
          </div>
          <div class="summary-row">
            <span class="summary-label">Extra Tax</span>
            <span class="summary-value">${orderTax > 0 ? '+' : ''}${cur}${orderTax.toFixed(2)}</span>
          </div>
        </div>
        ${Math.abs(roundOff) > 0.001 ? `
          <div class="summary-row" style="font-size:12px">
            <span class="summary-label">Round Off</span>
            <span class="summary-value">${roundOff > 0 ? '+' : ''}${cur}${roundOff.toFixed(2)}</span>
          </div>
        ` : ''}

        <div style="margin-top:2px; display:flex; gap:6px">
          ${isDiscountExpanded ? `
            <div class="discount-input-row" style="margin-bottom:4px;display:flex;gap:6px;flex:1">
              <div style="display:flex;flex:1;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
                <input class="form-input" id="discountInput" type="number" placeholder="Amt" value="${store.discountRaw || ''}" min="0" style="height:32px;font-size:12px;border:none;border-radius:0;flex:1;min-width:0" />
                <button id="global-disc-type-flat" style="height:32px;padding:0 10px;border:none;border-left:1px solid var(--border);font-size:12px;font-weight:700;cursor:pointer;transition:background 0.15s;
                  background:${store.discountType === 'flat' ? 'var(--primary)' : 'var(--bg-card)'};
                  color:${store.discountType === 'flat' ? '#fff' : 'var(--text-muted)'}">${cur}</button>
                <button id="global-disc-type-pct" style="height:32px;padding:0 10px;border:none;border-left:1px solid var(--border);font-size:12px;font-weight:700;cursor:pointer;transition:background 0.15s;
                  background:${store.discountType === 'pct' ? 'var(--primary)' : 'var(--bg-card)'};
                  color:${store.discountType === 'pct' ? '#fff' : 'var(--text-muted)'}">%</button>
              </div>
              <button class="btn btn-primary btn-sm" id="applyDiscountBtn" style="height:32px;padding:0 12px">Apply</button>
              <button class="btn btn-ghost btn-sm" id="toggleDiscountBtn" style="height:32px;width:32px;padding:0;flex-shrink:0"><i class="fa-solid fa-xmark"></i></button>
            </div>
          ` : !isExtraTaxExpanded ? `
            <button class="btn btn-ghost btn-sm" id="toggleDiscountBtn"
              ${!canDiscount ? 'disabled style="display:none"' : ''}
              style="border:1px dashed var(--primary); color:var(--primary); flex:1; justify-content:center; font-size:12px; padding:4px">
              <i class="fa-solid fa-tag"></i> Add Discount
            </button>
          ` : ''}
          ${isExtraTaxExpanded ? `
            <div class="extratax-input-row" style="margin-bottom:4px;display:flex;gap:6px;flex:1">
              <div style="display:flex;flex:1;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
                <input class="form-input" id="extraTaxInput" type="number" placeholder="Amt" value="${store.extraTaxRaw || ''}" min="0" style="height:32px;font-size:12px;border:none;border-radius:0;flex:1;min-width:0" />
                <button id="global-extratax-type-flat" style="height:32px;padding:0 10px;border:none;border-left:1px solid var(--border);font-size:12px;font-weight:700;cursor:pointer;transition:background 0.15s;
                  background:${store.extraTaxType === 'flat' ? 'var(--primary)' : 'var(--bg-card)'};
                  color:${store.extraTaxType === 'flat' ? '#fff' : 'var(--text-muted)'}">${cur}</button>
                <button id="global-extratax-type-pct" style="height:32px;padding:0 10px;border:none;border-left:1px solid var(--border);font-size:12px;font-weight:700;cursor:pointer;transition:background 0.15s;
                  background:${store.extraTaxType === 'pct' ? 'var(--primary)' : 'var(--bg-card)'};
                  color:${store.extraTaxType === 'pct' ? '#fff' : 'var(--text-muted)'}">%</button>
              </div>
              <button class="btn btn-primary btn-sm" id="applyExtraTaxBtn" style="height:32px;padding:0 12px">Apply</button>
              <button class="btn btn-ghost btn-sm" id="toggleExtraTaxBtn" style="height:32px;width:32px;padding:0;flex-shrink:0"><i class="fa-solid fa-xmark"></i></button>
            </div>
          ` : !isDiscountExpanded ? `
            <button class="btn btn-ghost btn-sm" id="toggleExtraTaxBtn"
              style="border:1px dashed var(--info); color:var(--info); flex:1; justify-content:center; font-size:12px; padding:4px">
              <i class="fa-solid fa-percent"></i> Add Tax
            </button>
          ` : ''}
        </div>
      </div>

      <div class="summary-row total" id="toggleSummaryBtn" style="cursor:pointer; user-select:none">
        <div style="display:flex; align-items:center; gap:8px">
          <span>Total</span>
          <i class="fa-solid fa-chevron-${isSummaryExpanded ? 'down' : 'up'}" style="font-size:12px; opacity:0.5"></i>
        </div>
        <span style="color:var(--accent)">${cur}${total.toFixed(2)}</span>
      </div>

      <div style="display:flex; gap:8px; margin-top:4px;">
        <button class="btn btn-success w-full btn-lg" id="checkoutBtn" style="height:42px" ${store.cart.length === 0 ? 'disabled' : ''}>
          <i class="fa-solid fa-credit-card"></i> Checkout ${cur}${total.toFixed(2)}
        </button>
      </div>
    </div>
  `;

  panel.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => updateQty(btn.dataset.id, Number(btn.dataset.delta)));
  });
  panel.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', () => removeFromCart(btn.dataset.remove));
  });

  // Double-click to open inline edit
  panel.querySelectorAll('.cart-item').forEach(row => {
    row.addEventListener('dblclick', (e) => {
      if (e.target.closest('.qty-btn, .remove-btn')) return;
      const cartId = row.dataset.cartId;
      const editPanel = document.getElementById(`inline-edit-${cartId}`);
      if (!editPanel) return;
      const isOpen = editPanel.style.display !== 'none';
      // Close all others first
      panel.querySelectorAll('.cart-item-inline-edit').forEach(p => { p.style.display = 'none'; });
      if (!isOpen) editPanel.style.display = 'block';
    });
  });

  // Live preview: update cart item total as user types in inline edit fields
  panel.querySelectorAll('.cart-item-inline-edit').forEach(editPanel => {
    const getCartId = () => editPanel.id.replace('inline-edit-', '');
    const liveUpdate = () => {
      const cartId = getCartId();
      const item = store.cart.find(i => i.cartId === cartId);
      if (!item) return;
      const price = parseFloat(document.getElementById(`ie-price-${cartId}`)?.value) || 0;
      const discRaw = parseFloat(document.getElementById(`ie-discount-${cartId}`)?.value) || 0;
      const taxRate = parseFloat(document.getElementById(`ie-tax-${cartId}`)?.value) || 0;
      const discType = item._discountType || 'flat';
      const taxType = item.taxType || 'exclusive';
      const discFlat = discType === 'pct'
        ? parseFloat(((price * discRaw) / 100).toFixed(4))
        : discRaw;
      const base = Math.max(0, (price - discFlat) * item.qty);
      const lineTotal = taxType === 'exclusive'
        ? base * (1 + taxRate / 100)
        : base;   // inclusive: tax already inside price
      const totalEl = document.getElementById(`ie-total-${cartId}`);
      if (totalEl) totalEl.textContent = `${cur}${lineTotal.toFixed(2)}`;
    };
    ['ie-price-', 'ie-discount-', 'ie-tax-'].forEach(prefix => {
      const cartId = getCartId();
      const el = document.getElementById(`${prefix}${cartId}`);
      if (el) {
        // use 'change' for select, 'input' for number fields
        el.addEventListener(prefix === 'ie-tax-' ? 'change' : 'input', liveUpdate);
      }
    });
    // Run once on open to sync immediately
    liveUpdate();
  });

  // Inline edit save
  panel.querySelectorAll('.ie-save-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cartId = btn.dataset.id;
      const item = store.cart.find(i => i.cartId === cartId);
      if (!item) return;
      const qty = parseFloat(document.getElementById(`ie-qty-${cartId}`)?.value);
      if (isNaN(qty) || qty <= 0) {
        showToast('Quantity must be greater than 0', 'error');
        return;
      }
      const price = parseFloat(document.getElementById(`ie-price-${cartId}`)?.value) || 0;
      const unit = document.getElementById(`ie-unit-${cartId}`)?.value.trim() || 'pcs';

      // Same stock-limit rule the +/- stepper (updateQty in store.js) already
      // enforces — typing a value straight into this field bypassed it
      // entirely (updateCartItem() just assigns whatever it's given), so a
      // shop could quietly sell more than what's actually on the shelf.
      const unitLower = unit.toLowerCase();
      const isWeighed = unitLower === 'kg' || unitLower === 'g' || unitLower === 'kilogram' || unitLower === 'gram';
      if (!isWeighed && qty > item.originalStock) {
        const liveProduct = (await getProducts()).find(p => String(p.id) === String(item.id));
        const allowNegative = liveProduct ? liveProduct.allowNegativeStock : item.allowNegativeStock;
        if (!allowNegative) {
          showToast(`Limit reached: ${item.originalStock} in stock`, 'warning');
          return;
        }
        showToast(`${item.name} is out of stock — selling anyway`, 'warning');
      }

      const discRaw = parseFloat(document.getElementById(`ie-discount-${cartId}`)?.value) || 0;
      const taxRate = parseFloat(document.getElementById(`ie-tax-${cartId}`)?.value) || 0;
      const discType = item._discountType || 'flat';
      const taxType = item.taxType || 'exclusive';
      // Convert % discount → flat \u20B9 for storage (itemDiscount is always \u20B9)
      const itemDiscount = discType === 'pct'
        ? parseFloat(((price * discRaw) / 100).toFixed(2))
        : discRaw;
      updateCartItem(cartId, {
        // itemDiscount is now always a flat \u20B9 amount (converted above), so itemDiscountType
        // must be reset to 'flat' here too \u2014 otherwise it stays stuck at whatever the product's
        // original default was (e.g. 'pct'), causing this already-converted number to be
        // mistakenly re-interpreted as a percentage everywhere else that reads itemDiscountType.
        qty, price, unit, itemDiscount, itemDiscountType: 'flat', taxRate, taxType,
        _discountRaw: discRaw, _discountType: discType
      });
      showToast('Item updated', 'success');
    });
  });

  // Discount type toggle (\u20B9 flat / %)
  panel.querySelectorAll('.ie-disc-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cartId = btn.dataset.id;
      const type = btn.dataset.type;
      const item = store.cart.find(i => i.cartId === cartId);
      if (item) item._discountType = type;
      const editPanel = document.getElementById(`inline-edit-${cartId}`);
      editPanel?.querySelectorAll('.ie-disc-type-btn').forEach(b => {
        const isMe = b.dataset.type === type;
        b.style.background = isMe ? 'var(--primary)' : 'var(--bg-card)';
        b.style.color = isMe ? '#fff' : 'var(--text-muted)';
      });
      // Retrigger live preview
      document.getElementById(`ie-price-${cartId}`)?.dispatchEvent(new Event('input'));
    });
  });

  // Tax type toggle (EXC / INC)
  panel.querySelectorAll('.ie-tax-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cartId = btn.dataset.id;
      const type = btn.dataset.type;
      const item = store.cart.find(i => i.cartId === cartId);
      if (item) item.taxType = type;
      const editPanel = document.getElementById(`inline-edit-${cartId}`);
      editPanel?.querySelectorAll('.ie-tax-type-btn').forEach(b => {
        const isMe = b.dataset.type === type;
        b.style.background = isMe ? 'var(--primary)' : 'var(--bg-card)';
        b.style.color = isMe ? '#fff' : 'var(--text-muted)';
      });
      // Retrigger live preview with new tax type
      document.getElementById(`ie-price-${cartId}`)?.dispatchEvent(new Event('input'));
    });
  });

  // Inline edit cancel
  panel.querySelectorAll('.ie-cancel-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const editPanel = document.getElementById(`inline-edit-${btn.dataset.id}`);
      if (editPanel) editPanel.style.display = 'none';
    });
  });
  panel.querySelector('#clearCartBtn')?.addEventListener('click', () => {
    clearCart();
    showToast('Cart cleared', 'info');
  });

  panel.querySelector('#toggleSummaryBtn')?.addEventListener('click', async () => {
    isSummaryExpanded = !isSummaryExpanded;
    await renderCart(cur);
  });

  panel.querySelector('#toggleDiscountBtn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    isDiscountExpanded = !isDiscountExpanded;
    if (isDiscountExpanded) isSummaryExpanded = true;
    await renderCart(cur);
  });

  panel.querySelector('#applyDiscountBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const val = panel.querySelector('#discountInput').value;
    // We already mutate store.discountType via the toggle buttons
    setDiscount(val, store.discountType);
    showToast(`Discount applied`, 'success');
  });

  // Global discount type toggles
  panel.querySelector('#global-disc-type-flat')?.addEventListener('click', (e) => {
    e.stopPropagation();
    store.discountType = 'flat';
    renderCart(cur); // Re-render to highlight active button and recalculate if val exists
  });
  panel.querySelector('#global-disc-type-pct')?.addEventListener('click', (e) => {
    e.stopPropagation();
    store.discountType = 'pct';
    renderCart(cur); // Re-render to highlight active button and recalculate if val exists
  });

  // Extra Tax (order-level manual tax/fee) — same Add/Apply/type-toggle
  // pattern as Add Discount just above, backed by store.js's setExtraTax()
  // (the same function QuickPOS's Alt+L shortcut already uses).
  panel.querySelector('#toggleExtraTaxBtn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    isExtraTaxExpanded = !isExtraTaxExpanded;
    if (isExtraTaxExpanded) isSummaryExpanded = true;
    await renderCart(cur);
  });

  panel.querySelector('#applyExtraTaxBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const val = panel.querySelector('#extraTaxInput').value;
    // We already mutate store.extraTaxType via the toggle buttons below
    setExtraTax(val, store.extraTaxType);
    showToast(`Extra tax applied`, 'success');
  });

  panel.querySelector('#global-extratax-type-flat')?.addEventListener('click', (e) => {
    e.stopPropagation();
    store.extraTaxType = 'flat';
    renderCart(cur);
  });
  panel.querySelector('#global-extratax-type-pct')?.addEventListener('click', (e) => {
    e.stopPropagation();
    store.extraTaxType = 'pct';
    renderCart(cur);
  });

  const custSearch = panel.querySelector('#posCustSearch');
  const custSugs = panel.querySelector('#posCustSuggestions');

  if (custSearch && custSugs) {
    const showSuggestions = async (query) => {
      const val = query.toLowerCase();
      const customers = await getCustomers(store.branch?.id);
      const matches = customers.filter(c => 
        c.name.toLowerCase().includes(val) || (c.phone && c.phone.includes(val))
      );
      
      if (matches.length === 0) {
        custSugs.classList.add('hidden');
        return;
      }

      custSugs.classList.remove('hidden');
      custSugs.innerHTML = matches.slice(0, 6).map(c => `
        <div class="cust-suggestion-item" data-id="${c.id}" style="padding:10px 12px; border-bottom:1px solid var(--border); cursor:pointer; display:flex; justify-content:space-between; align-items:center; transition:background 0.15s; background:var(--bg-elevated)" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='var(--bg-elevated)'">
          <div style="min-width:0; flex:1">
            <div style="font-weight:700; color:var(--text-main); font-size:13px; line-height:1.2">${escapeHtml(c.name)}</div>
            <div style="font-size:11px; color:#6366f1; font-weight:600">${escapeHtml(c.phone || 'No Phone')}</div>
          </div>
          <div style="font-size:10px; color:#94a3b8"><i class="fa-solid fa-chevron-right"></i></div>
        </div>
      `).join('');

      custSugs.querySelectorAll('.cust-suggestion-item').forEach(item => {
        item.onclick = (e) => {
          e.stopPropagation();
          const cust = matches.find(m => String(m.id) === String(item.dataset.id));
          if (cust) {
            import('../store.js').then(s => {
              s.setCustomer(cust);
              renderCart(cur);
            });
          }
        };
      });
    };

    custSearch.addEventListener('focus', () => {
      if (custSearch.value === 'Walk-in Customer') custSearch.value = '';
      showSuggestions(custSearch.value);
    });

    custSearch.addEventListener('input', (e) => {
      showSuggestions(e.target.value);
    });

    // Close suggestions on outside click
    const hideOnOutside = (e) => {
      if (!custSearch.contains(e.target) && !custSugs.contains(e.target)) {
         custSugs.classList.add('hidden');
         if (!store.selectedCustomer) custSearch.value = 'Walk-in Customer';
         document.removeEventListener('click', hideOnOutside);
      }
    };
    document.addEventListener('click', hideOnOutside);
  }

  panel.querySelector('#posClearCustBtn')?.addEventListener('click', () => {
    store.selectedCustomer = null;
    renderCart(cur);
  });

  panel.querySelector('#posAddCustomerBtn')?.addEventListener('click', () => {
    openCustomerForm(null, (newCust) => {
      import('../store.js').then(s => {
        s.setCustomer(newCust);
        renderCart(cur);
      });
    });
  });

  panel.querySelector('#posClearAppoCust')?.addEventListener('click', () => {
    store.selectedCustomer = null;
    store.selectedAppointmentId = null;
    renderCart(cur);
  });

  // Staff picker — same search/suggestions pattern as the customer picker
  // above. Optional (unlike customer, no "Walk-in" placeholder/fallback):
  // most sales legitimately have no specific staff attribution, so leaving
  // it blank is the normal case, not an error state.
  const staffSearch = panel.querySelector('#posStaffSearch');
  const staffSugs = panel.querySelector('#posStaffSuggestions');

  if (staffSearch && staffSugs) {
    const showStaffSuggestions = async (query) => {
      const val = query.toLowerCase();
      const staffList = await getStaff(store.branch?.id);
      const matches = staffList.filter(s =>
        s.name.toLowerCase().includes(val) || (s.specialization || '').toLowerCase().includes(val)
      );

      if (matches.length === 0) {
        staffSugs.classList.add('hidden');
        return;
      }

      staffSugs.classList.remove('hidden');
      staffSugs.innerHTML = matches.slice(0, 6).map(s => `
        <div class="staff-suggestion-item" data-id="${s.id}" style="padding:10px 12px; border-bottom:1px solid var(--border); cursor:pointer; display:flex; justify-content:space-between; align-items:center; transition:background 0.15s; background:var(--bg-elevated)" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='var(--bg-elevated)'">
          <div style="min-width:0; flex:1">
            <div style="font-weight:700; color:var(--text-main); font-size:13px; line-height:1.2">${escapeHtml(s.name)}</div>
            <div style="font-size:11px; color:#6366f1; font-weight:600">${escapeHtml(s.specialization || 'Generalist')}</div>
          </div>
          <div style="font-size:10px; color:#94a3b8"><i class="fa-solid fa-chevron-right"></i></div>
        </div>
      `).join('');

      staffSugs.querySelectorAll('.staff-suggestion-item').forEach(item => {
        item.onclick = (e) => {
          e.stopPropagation();
          const staffMember = matches.find(m => String(m.id) === String(item.dataset.id));
          if (staffMember) {
            import('../store.js').then(s => {
              s.setStaff(staffMember);
              renderCart(cur);
            });
          }
        };
      });
    };

    staffSearch.addEventListener('focus', () => showStaffSuggestions(staffSearch.value));
    staffSearch.addEventListener('input', (e) => showStaffSuggestions(e.target.value));

    const hideStaffOnOutside = (e) => {
      if (!staffSearch.contains(e.target) && !staffSugs.contains(e.target)) {
        staffSugs.classList.add('hidden');
        document.removeEventListener('click', hideStaffOnOutside);
      }
    };
    document.addEventListener('click', hideStaffOnOutside);
  }

  panel.querySelector('#posClearStaffBtn')?.addEventListener('click', () => {
    store.selectedStaff = null;
    renderCart(cur);
  });

  panel.querySelector('#checkoutBtn')?.addEventListener('click', () => {
    openCheckout();
  });

  } catch (err) {
    console.error("Error rendering cart:", err);
    panel.innerHTML = `<div class="error-state" style="padding:20px; color:var(--danger); text-align:center">
      <i class="fa-solid fa-triangle-exclamation" style="font-size:24px; margin-bottom:8px"></i>
      <p style="font-weight:600">Failed to render cart</p>
      <button class="btn btn-sm btn-ghost" onclick="location.reload()" style="margin-top:10px">Reload Page</button>
    </div>`;
  }
}

async function openAppointmentsModal(cur) {
  const branchId = store.branch?.id || 'b1';
  const appos = await getAppointments(branchId);
  const staff = await getStaff(branchId);
  const customers = await getCustomers(branchId);
  const products = await getProducts(branchId);

  openModal({
    title: '<i class="fa-solid fa-calendar-check text-accent"></i> Appointment Manager',
    body: `
      <div class="flex gap-12 mb-16">
        <button class="btn btn-primary btn-sm" id="newAppointmentBtn"><i class="fa-solid fa-plus"></i> Book New</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px;max-height:60vh;overflow-y:auto;overflow-x:hidden;padding:4px 2px" class="custom-scrollbar">
        ${appos.filter(a => a.status !== 'Completed').length === 0 ? `
          <div class="empty-state" style="padding:60px 20px;text-align:center;background:var(--bg-elevated);border-radius:var(--radius);border:2px dashed var(--border)">
            <i class="fa-solid fa-calendar-alt text-muted" style="font-size:54px;margin-bottom:20px;opacity:0.3"></i>
            <p style="font-weight:600;color:var(--text-secondary)">No pending appointments</p>
            <p style="font-size:12px;color:var(--text-muted);margin-top:4px">Your scheduled treatments will appear here.</p>
          </div>
        ` : appos.filter(a => a.status !== 'Completed').map(a => {
      const s = staff.find(x => x.id === a.staffId);
      const c = customers.find(x => x.id === a.customerId);
      const prod = products.find(p => String(p.id) === String(a.serviceId));

      return `
            <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius);padding:18px;display:flex;justify-content:space-between;align-items:center;gap:16px;transition:all 0.2s ease;box-shadow:var(--shadow-sm)" class="appo-card">
              <div style="display:flex;gap:14px;align-items:center;min-width:0;flex:1">
                <div style="width:46px;height:46px;background:linear-gradient(135deg, var(--primary), var(--primary-dark));border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;box-shadow:0 4px 10px rgba(79,70,229,0.25);flex-shrink:0">
                   <div style="font-size:10px;font-weight:800;text-transform:uppercase;opacity:0.8;line-height:1">${a.time.split(':')[0]}</div>
                   <div style="font-size:15px;font-weight:900;line-height:1">${a.time.split(':')[1]}</div>
                </div>
                <div style="min-width:0;flex:1">
                  <div class="font-bold" style="font-size:16px;margin-bottom:2px;display:flex;align-items:center;gap:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                    ${escapeHtml(c?.name || 'Walk-in Customer')}
                  </div>
                  <div style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                    <span><i class="fa-solid fa-user-tie" style="margin-right:4px;opacity:0.6"></i>${escapeHtml(s?.name || 'Any')}</span>
                    <span><i class="fa-solid fa-scissors" style="margin-right:4px;opacity:0.6"></i>${escapeHtml(prod?.name || 'Service')}</span>
                  </div>
                </div>
              </div>
              <div style="display:flex;gap:8px;flex-shrink:0">
                <button class="btn btn-ghost btn-sm edit-appo-btn" data-id="${a.id}" title="Edit" style="width:38px;height:38px;padding:0;border-radius:10px;border-color:var(--border)">
                  <i class="fa-solid fa-pen-to-square"></i>
                </button>
                <button class="btn btn-primary btn-sm process-appo-btn" data-id="${a.id}" style="height:38px;padding:0 12px;border-radius:10px;font-size:12px">
                  <i class="fa-solid fa-cash-register"></i>
                </button>
                <button class="btn btn-ghost btn-sm text-danger delete-appo-btn" data-id="${a.id}" title="Delete" style="width:38px;height:38px;padding:0;border-radius:10px;border-color:rgba(239,68,68,0.2)">
                  <i class="fa-solid fa-trash-can"></i>
                </button>
              </div>
            </div>
          `}).join('')}
      </div>
    `,
    footer: `<button class="btn btn-ghost" onclick="closeModal()">Close</button>`
  });

  document.getElementById('newAppointmentBtn').onclick = () => openNewAppointmentForm(cur);

  document.querySelectorAll('.process-appo-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const a = appos.find(x => x.id === btn.dataset.id);
      const c = customers.find(x => x.id === a.customerId);
      const s = staff.find(x => x.id === a.staffId);

      const service = a.serviceId ? products.find(p => String(p.id) === String(a.serviceId)) : null;

      // Use the consolidated store function
      loadAppointmentIntoCart({
        customer: c,
        staff: s,
        appointmentId: a.id,
        service: service
      });

      showToast('Appointment Loaded into POS', 'success');
      closeModal();
    };
  });

  document.querySelectorAll('.edit-appo-btn').forEach(btn => {
    btn.onclick = () => {
      const a = appos.find(x => x.id === btn.dataset.id);
      openNewAppointmentForm(cur, a);
    };
  });

  document.querySelectorAll('.delete-appo-btn').forEach(btn => {
    btn.onclick = async () => {
      const confirmed = await showConfirm({
        title: 'Delete Appointment',
        message: 'Are you sure you want to delete this appointment?',
        okText: 'Yes, Delete',
        type: 'warning'
      });
      if (confirmed) {
        deleteAppointment(btn.dataset.id);
        openAppointmentsModal(cur);
      }
    };
  });
}

async function openNewAppointmentForm(cur, appoToEdit = null) {
  const branchId = store.branch?.id || 'b1';
  const staff = await getStaff(branchId);
  const customers = await getCustomers(branchId);
  const products = await getProducts(branchId);

  openModal({
    title: appoToEdit ? 'Edit Appointment' : 'Book New Appointment',
    body: `
      <form id="appoForm" style="display:flex; flex-direction:column; gap:20px; padding:8px 0">
        <div class="form-group">
          <label class="form-label" style="display:flex;align-items:center;gap:8px"><i class="fa-solid fa-user text-primary"></i> Customer Information</label>
          <div style="display:flex;gap:10px">
            <div style="flex:1;position:relative">
              <select class="form-select" id="apCust" style="height:46px;padding-left:12px;border-radius:12px;border:1px solid var(--border);background:var(--bg-elevated)">
                <option value="">Walk-in / Search Customer...</option>
                ${customers.map(c => `<option value="${c.id}" ${appoToEdit?.customerId === c.id ? 'selected' : ''}>${escapeHtml(c.name)} (${escapeHtml(c.phone)})</option>`).join('')}
              </select>
            </div>
            <button type="button" class="btn btn-ghost" id="apAddCustBtn" style="width:46px;height:46px;padding:0;border-radius:12px;border:1px solid var(--border);background:var(--bg-elevated)">
              <i class="fa-solid fa-plus text-primary"></i>
            </button>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" style="display:flex;align-items:center;gap:8px"><i class="fa-solid fa-scissors text-accent"></i> Service / Treatment</label>
          <select class="form-select" id="apService" style="height:46px;border-radius:12px;border:1px solid var(--border);background:var(--bg-elevated)">
            <option value="">Select a Service...</option>
            ${products.map(p => `<option value="${p.id}" ${String(appoToEdit?.serviceId) === String(p.id) ? 'selected' : ''}>${p.emoji || '💇‍♂️'} ${escapeHtml(p.name)} - \u20B9${p.price}</option>`).join('')}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label" style="display:flex;align-items:center;gap:8px"><i class="fa-solid fa-user-tie text-info"></i> Assigned Staff (Stylist)</label>
          <select class="form-select" id="apStaff" style="height:46px;border-radius:12px;border:1px solid var(--border);background:var(--bg-elevated)">
            <option value="">Any Available Staff</option>
            ${staff.map(s => `<option value="${s.id}" ${appoToEdit?.staffId === s.id ? 'selected' : ''}>${escapeHtml(s.name)} (${escapeHtml(s.specialization || 'Artist')})</option>`).join('')}
          </select>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px">
          <div class="form-group">
            <label class="form-label" style="display:flex;align-items:center;gap:8px"><i class="fa-regular fa-calendar-days text-success"></i> Date</label>
            <input type="date" class="form-input" id="apDate" value="${appoToEdit?.date || new Date().toISOString().split('T')[0]}" style="height:46px;border-radius:12px;border:1px solid var(--border);background:var(--bg-elevated)" />
          </div>
          <div class="form-group">
            <label class="form-label" style="display:flex;align-items:center;gap:8px"><i class="fa-regular fa-clock text-warning"></i> Time</label>
            <input type="time" class="form-input" id="apTime" value="${appoToEdit?.time || '10:00'}" style="height:46px;border-radius:12px;border:1px solid var(--border);background:var(--bg-elevated)" />
          </div>
        </div>
      </form>
    `,
    footer: `
      <button class="btn btn-ghost" id="backToAppos">Back</button>
      <button class="btn btn-primary" id="saveAppoBtn">${appoToEdit ? 'Update Appointment' : 'Confirm Booking'}</button>
    `
  });

  document.getElementById('backToAppos').onclick = () => openAppointmentsModal(cur);

  document.getElementById('apAddCustBtn').onclick = () => {
    openCustomerForm(null, (newCust) => {
      // Re-open booking form with new customer selected
      openNewAppointmentForm(cur);
      // We need a small delay or a better way to ensure the new customer is selected in the DOM
      setTimeout(() => {
        const sel = document.getElementById('apCust');
        if (sel) sel.value = newCust.id;
      }, 50);
    });
  };

  const saveAppoBtn = document.getElementById('saveAppoBtn');
  saveAppoBtn.onclick = async () => {
    if (saveAppoBtn.disabled) return;
    const custId = document.getElementById('apCust').value;
    const staffId = document.getElementById('apStaff').value;
    const serviceId = document.getElementById('apService').value;
    const date = document.getElementById('apDate').value;
    const time = document.getElementById('apTime').value;

    // saveAppointment() mints a new 'APP-' + Date.now() id whenever no id is
    // passed (new booking) — without this guard, two fast clicks generate
    // two different ids and silently double-book the same slot.
    saveAppoBtn.disabled = true;
    try {
      await saveAppointment({
        id: appoToEdit?.id,
        customerId: custId,
        staffId: staffId,
        serviceId: serviceId,
        date,
        time,
        status: appoToEdit?.status || 'Scheduled',
        branchId: branchId
      });
    } catch (err) {
      saveAppoBtn.disabled = false;
      showToast(err.message || 'Failed to save appointment.', 'error');
      return;
    }

    showToast(appoToEdit ? 'Appointment Updated!' : 'Appointment Booked!', 'success');
    openAppointmentsModal(cur);
  };
}

function renderSearchSuggestions(matches) {
  const suggestionsEl = document.getElementById('searchSuggestions');
  if (!suggestionsEl) return;

  currentSuggestions = matches;

  if (matches.length === 0 || !searchQuery) {
    suggestionsEl.classList.remove('open');
    suggestionsEl.innerHTML = '';
    activeSuggestionIndex = -1;
    return;
  }

  suggestionsEl.classList.add('open');
  suggestionsEl.innerHTML = matches.map((p, idx) => `
    <div class="suggestion-item ${idx === activeSuggestionIndex ? 'active' : ''}" data-id="${p.id}" data-index="${idx}">
      <div class="suggestion-emoji">${p.emoji || '📦'}</div>
      <div class="suggestion-content">
        <div class="suggestion-name">${escapeHtml(p.name)}</div>
        <div class="suggestion-meta">
          ${p.sku ? `<span>SKU: ${escapeHtml(p.sku)}</span>` : ''}
          ${p.barcode ? `<span>Barcode: ${escapeHtml(p.barcode)}</span>` : ''}
        </div>
      </div>
      <div class="suggestion-price">\u20B9${(() => {
        // getSettings() is async \u2014 this render function isn't, and awaiting
        // it here would need every caller updated too, so reuse the already-
        // loaded store.settings (same pattern used elsewhere in this file)
        // rather than calling it unawaited, which silently evaluated
        // (Promise).taxRate as undefined and always fell back to a 0% rate.
        const taxRate = parseFloat(p.taxRate ?? (store.settings?.taxRate || 0));
        // p.price already contains tax for an inclusive-tax item (the
        // default tax type) — adding tax again double-counted it here.
        return (p.taxType === 'inclusive' ? p.price : p.price * (1 + taxRate/100)).toFixed(2);
      })()}</div>
    </div>
  `).join('');

  suggestionsEl.querySelectorAll('.suggestion-item').forEach(item => {
    item.addEventListener('click', () => {
      const product = matches[parseInt(item.dataset.index)];
      selectProduct(product);
    });
  });
}

function selectProduct(product) {
  if (!product) return;
  if (product.variants && product.variants.length > 0) {
    openVariantSelectionModal(product);
  } else {
    handleProductAddition(product);
  }

  // Clear search and close dropdown
  const searchInput = document.getElementById('productSearch');
  if (searchInput) searchInput.value = '';
  searchQuery = '';
  renderSearchSuggestions([]);
}

async function openVariantSelectionModal(p) {
  const settings = await getSettings();
  const cur = settings.currency;

  const body = `
    <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap:16px; padding:12px">
      ${p.variants.map(v => {
        const cartItem = store.cart.find(item => item.cartId === `${p.id}_${v.name}`);
        const cartQty = cartItem ? cartItem.qty : 0;
        const available = Math.max(0, v.stock - cartQty);
        const isOutOfStock = available <= 0;
        const discountedPrice = Number(v.price) - (Number(v.itemDiscount) || 0);

        return `
          <div class="variant-select-card ${isOutOfStock ? 'out-of-stock' : ''}"
               data-vname="${escapeHtml(v.name)}"
               style="background: var(--bg-card); border: 2px solid var(--border); border-radius: 16px; padding: 16px; cursor: ${isOutOfStock ? 'not-allowed' : 'pointer'}; 
                      text-align: center; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); position: relative; display: flex; flex-direction: column; align-items: center; gap: 8px;
                      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); ${isOutOfStock ? 'opacity: 0.5' : ''}"
               onmouseover="if(!${isOutOfStock}) { this.style.borderColor='var(--primary)'; this.style.transform='translateY(-2px)'; this.style.boxShadow='0 10px 15px -3px rgba(99, 102, 241, 0.2)'; }"
               onmouseout="this.style.borderColor='var(--border)'; this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 6px -1px rgba(0, 0, 0, 0.1)';"
          >
            <div style="width: 44px; height: 44px; background: rgba(99, 102, 241, 0.1); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px">
               ${p.image ? `<img src="${p.image}" style="width:100%; height:100%; object-fit:cover; border-radius:50%" />` : (p.emoji || '📦')}
            </div>
            <div>
              <div style="font-weight: 800; font-size: 14px; color: var(--text-main); line-height: 1.2">${escapeHtml(v.name)}</div>
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px">${v.sku || ''}</div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 2px; margin-top: auto">
              <div style="color: var(--primary); font-weight: 900; font-size: 16px">
                 ${cur}${discountedPrice.toFixed(2)}
              </div>
              ${v.itemDiscount > 0 ? `<div style="text-decoration: line-through; font-size: 11px; opacity: 0.5">${cur}${v.price.toFixed(2)}</div>` : ''}
            </div>
            <div style="font-size: 10px; padding: 4px 8px; border-radius: 6px; background: ${available <= 5 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)'}; 
                        color: ${available <= 5 ? 'var(--danger)' : 'var(--success)'}; font-weight: 800; border: 1px solid currentColor">
               ${available > 0 ? `${parseFloat(available.toFixed(3))} available` : 'OUT OF STOCK'}
            </div>
            ${v.itemDiscount > 0 ? `<div style="position: absolute; top: -8px; right: -8px; background: var(--danger); color: white; font-size: 10px; font-weight: 900; padding: 4px 8px; border-radius: 8px; box-shadow: 0 4px 10px rgba(239, 68, 68, 0.3); border: 2px solid var(--bg-card)">OFF ${cur}${v.itemDiscount}</div>` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;

  openModal({
    title: `<div style="display:flex; align-items:center; gap:12px">
              <div style="width:36px; height:36px; background:rgba(99,102,241,0.1); border-radius:10px; display:flex; align-items:center; justify-content:center">
                <i class="fa-solid fa-layer-group" style="color:var(--primary)"></i>
              </div>
              <div>
                <div style="font-size:16px; font-weight:900">${escapeHtml(p.name)}</div>
                <div style="font-size:11px; color:var(--text-muted); font-weight:700; text-transform:uppercase; letter-spacing:0.5px">Select Variant Option</div>
              </div>
            </div>`,
    body: body,
    sidePanel: false,
    onClose: () => {
      document.removeEventListener('keydown', variantKeyHandler);
    }
  });

  // Keyboard Navigation Logic
  let activeIndex = 0;
  const cards = document.querySelectorAll('.variant-select-card');
  const availableCards = Array.from(cards).filter(c => !c.classList.contains('out-of-stock'));

  function updateVisualFocus() {
    cards.forEach((c, idx) => {
      if (idx === activeIndex) {
        c.style.borderColor = 'var(--primary)';
        c.style.transform = 'translateY(-4px)';
        c.style.boxShadow = '0 10px 15px -3px rgba(99, 102, 241, 0.3)';
        c.style.background = 'rgba(99, 102, 241, 0.05)';
        c.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        c.style.borderColor = 'var(--border)';
        c.style.transform = 'translateY(0)';
        c.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1)';
        c.style.background = 'var(--bg-card)';
      }
    });
  }

  const variantKeyHandler = async (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % cards.length;
      updateVisualFocus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + cards.length) % cards.length;
      updateVisualFocus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selectedCard = cards[activeIndex];
      if (selectedCard && !selectedCard.classList.contains('out-of-stock')) {
        const vName = selectedCard.dataset.vname;
        const variant = p.variants.find(v => v.name === vName);
        if (variant) {
          await handleProductAddition(p, variant);
          document.removeEventListener('keydown', variantKeyHandler);
          closeModal();
        }
      }
    } else if (e.key === 'Escape') {
      document.removeEventListener('keydown', variantKeyHandler);
      closeModal();
    }
  };

  document.addEventListener('keydown', variantKeyHandler);
  updateVisualFocus();

  // Attach click event listeners
  cards.forEach(card => {
    card.addEventListener('click', async () => {
      if (card.classList.contains('out-of-stock')) return;
      const vName = card.dataset.vname;
      const variant = p.variants.find(v => v.name === vName);
      if (variant) {
        await handleProductAddition(p, variant);
        document.removeEventListener('keydown', variantKeyHandler);
        closeModal();
      }
    });
  });
}

function startVoiceSearch() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast('Voice search not supported in this browser', 'error');
    return;
  }

  const recognition = new SpeechRecognition();
  const micBtn = document.getElementById('voiceSearchBtn');
  const searchInput = document.getElementById('productSearch');

  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    micBtn.classList.add('active');
    showToast('Listening...', 'info');
  };

  recognition.onresult = async (event) => {
    const transcript = event.results[0][0].transcript;
    searchInput.value = transcript;
    searchQuery = transcript.toLowerCase().trim();
    const normQuery = normalizeSearchQuery(searchQuery);

    // Trigger search logic
    const allProducts = await getProducts(store.branch?.id);
    const matches = searchQuery ? allProducts.filter(p => {
      const pName = p.name.toLowerCase();
      const pSku = normalizeSearchQuery(p.sku || '');
      const pBarcode = normalizeSearchQuery(p.barcode || '');

      return pName.includes(searchQuery) ||
        (pSku && pSku.includes(normQuery)) ||
        (pBarcode && pBarcode.includes(normQuery));
    }).slice(0, 8) : [];

    activeSuggestionIndex = -1;
    renderSearchSuggestions(matches);
    renderProductGrid();

    showToast(`Searching for: ${transcript}`, 'success');
  };

  recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
    micBtn.classList.remove('active');
    if (event.error === 'not-allowed') {
      showToast('Microphone access denied', 'error');
    } else {
      showToast('Voice search failed', 'error');
    }
  };

  recognition.onend = () => {
    micBtn.classList.remove('active');
  };

  recognition.start();
}

let isCustomModalOpening = false;

async function openCustomItemModal(cur) {
  if (isCustomModalOpening) return;
  isCustomModalOpening = true;
  try {
    const settings = await getSettings();
  openModal({
    title: '<i class="fa-solid fa-tag"></i> Add Custom Item (Instant Sale)',
    body: `
      <div style="display:flex; flex-direction:column; gap:16px; padding:8px">
        <div class="form-group">
          <label class="form-label">Item Name</label>
          <input type="text" id="customItemName" class="form-input" placeholder="e.g. Service Charge, Custom Gift" autofocus />
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px">
          <div class="form-group">
            <label class="form-label">Price (${cur})</label>
            <input type="number" id="customItemPrice" class="form-input" placeholder="0.00" step="0.01" />
          </div>
          <div class="form-group">
            <label class="form-label">Tax Rate (%)</label>
            <select id="customItemTax" class="form-select" ${!settings.availableTaxes?.length ? 'disabled' : ''}>
              ${settings.availableTaxes?.length
                ? settings.availableTaxes.map(t => `<option value="${t}" ${t == settings.taxRate ? 'selected' : ''}>${t}%</option>`).join('')
                : `<option value="0">No rates — add in Settings</option>`}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Unit</label>
          <input type="text" id="iiUnit" class="form-input" placeholder="e.g. kg, g, pcs" value="pcs" />
        </div>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="saveCustomItemBtn">Add to Sale</button>
    `
  });
  } catch (err) {
    console.error('Modal open error:', err);
    isCustomModalOpening = false;
    return;
  }

  let isAdding = false;
  const saveBtn = document.getElementById('saveCustomItemBtn');
  if (saveBtn) {
    saveBtn.onclick = () => {
      if (isAdding) return;
      
      const name = document.getElementById('customItemName').value.trim();
      const price = parseFloat(document.getElementById('customItemPrice').value) || 0;
      const tax = parseFloat(document.getElementById('customItemTax').value) || 0;

      if (!name) return showToast('Please enter item name', 'warning');
      if (price <= 0) return showToast('Please enter a valid price', 'warning');

      isAdding = true;
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-8"></i> Adding...';

      const customProd = {
        id: 'custom-' + Date.now(),
        name: name,
        price: price,
        taxRate: tax,
        stock: 999999,
        emoji: '🏷️',
        category: 'Custom',
        isInstant: true,
        unit: document.getElementById('iiUnit')?.value || 'pcs'
      };

      closeModal();
      handleProductAddition(customProd);
      showToast('Custom item added to cart', 'success');
    };
  }
  isCustomModalOpening = false;
}

/**
 * Normalizes a string for robust SKU/Barcode searching.
 * 1. Converts common number words to digits (e.g. "one" to "1").
 * 2. Removes all whitespace.
 * 3. Converts to lowercase.
 */
function normalizeSearchQuery(q) {
  if (!q) return '';
  let str = String(q).toLowerCase();

  const numMap = {
    'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4',
    'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9'
  };

  // Replace words with digits
  Object.keys(numMap).forEach(word => {
    // \b ensures we only replace independent words, not sub-parts of words
    const reg = new RegExp(`\\b${word}\\b`, 'g');
    str = str.replace(reg, numMap[word]);
  });

  // Remove all spaces and special chars that voice recognition might add
  return str.replace(/[\s\-\.]/g, '');
}

// Small inline "quantity to add" control reused for both plain products and
// variant rows — matches Dashboard.js's existing "Low Stock Alerts" widget
// quick-restock pattern (qty input defaulting to 10 + green "+ Add" pill)
// exactly, so restocking looks/behaves the same wherever it's offered.
// `data-product-id`/`data-variant-name` are read back by the click handler
// wired right after openModal() below.
function lowStockUpdateControlHtml(productId, variantName) {
  const variantAttr = variantName ? ` data-variant-name="${escapeHtml(variantName)}"` : '';
  return `
    <input type="number" min="1" value="10" class="form-input lowstock-input" data-product-id="${productId}"${variantAttr} style="width:60px; padding:4px 6px; font-size:12px; text-align:center; border-radius:8px;" />
    <button class="btn btn-sm lowstock-update-btn" data-product-id="${productId}"${variantAttr} style="padding:4px 10px; font-size:11px; background:rgba(16,185,129,0.15); color:#10b981; border:1px solid rgba(16,185,129,0.3); border-radius:8px; font-weight:700; white-space:nowrap;" title="Add stock">
      <i class="fa-solid fa-plus" style="font-size:10px"></i> Add
    </button>
  `;
}

export async function openLowStockModal(cur) {
  const items = await getLowStockProducts(store.branch?.id);

  if (items.length === 0) {
    closeModal();
    showToast('All items restocked!', 'success');
    return;
  }

  openModal({
    title: '<i class="fa-solid fa-triangle-exclamation text-danger"></i> Low Stock Alert',
    body: `
      <div style="padding:10px 0">
        <p style="margin-bottom:20px; font-size:14px; opacity:0.8">The following items are below their minimum stock levels and need restocking. Add stock right here, or use Manage Inventory for more detail.</p>
        <div style="display:flex; flex-direction:column; gap:12px; max-height:400px; overflow-y:auto" class="custom-scrollbar">
          ${items.map(p => {
            const isVariant = p.variants && p.variants.length > 0;
            if (isVariant) {
              return p.variants.filter(v => (v.stock || 0) <= (v.minStock || 10)).map(v => `
                <div style="background:var(--bg-elevated); border:1px solid var(--border); border-left:4px solid var(--danger); padding:12px 16px; border-radius:12px; display:flex; align-items:center; justify-content:space-between; gap:10px">
                  <div style="display:flex; align-items:center; gap:12px; min-width:0">
                    <span style="font-size:24px; flex-shrink:0">${p.emoji || '📦'}</span>
                    <div style="min-width:0">
                      <div style="font-weight:700; font-size:14px">${escapeHtml(p.name)}</div>
                      <div style="font-size:11px; opacity:0.6; font-weight:600; text-transform:uppercase">${escapeHtml(v.name)}</div>
                      <div style="font-size:10px; opacity:0.5; font-weight:600">MIN: ${v.minStock || 0}</div>
                    </div>
                  </div>
                  <div style="display:flex; align-items:center; gap:8px; flex-shrink:0">
                    <span style="font-size:13px; font-weight:700;" class="${(v.stock || 0) <= 0 ? 'text-danger' : 'text-warning'}">${parseFloat(Number(v.stock || 0).toFixed(3))}</span>
                    ${lowStockUpdateControlHtml(p.id, v.name)}
                  </div>
                </div>
              `).join('');
            }
            return `
              <div style="background:var(--bg-elevated); border:1px solid var(--border); border-left:4px solid var(--danger); padding:12px 16px; border-radius:12px; display:flex; align-items:center; justify-content:space-between; gap:10px">
                <div style="display:flex; align-items:center; gap:12px; min-width:0">
                  <span style="font-size:24px; flex-shrink:0">${p.emoji || '📦'}</span>
                  <div style="min-width:0">
                    <div style="font-weight:700; font-size:14px">${escapeHtml(p.name)}</div>
                    <div style="font-size:11px; opacity:0.6">${escapeHtml(p.category || '')}</div>
                    <div style="font-size:10px; opacity:0.5; font-weight:600">MIN: ${p.minStock || 0}</div>
                  </div>
                </div>
                <div style="display:flex; align-items:center; gap:8px; flex-shrink:0">
                  <span style="font-size:13px; font-weight:700;" class="${(p.stock || 0) <= 0 ? 'text-danger' : 'text-warning'}">${parseFloat(Number(p.stock || 0).toFixed(3))}</span>
                  ${lowStockUpdateControlHtml(p.id, null)}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" onclick="closeModal()">Dismiss</button>
      <button class="btn btn-primary" onclick="closeModal(); window.posFilterStock = 'Low Stock'; window.navigate('products')">
        <i class="fa-solid fa-box-open mr-8"></i> Manage Inventory
      </button>
    `
  });

  document.querySelectorAll('.lowstock-update-btn').forEach(btn => {
    btn.onclick = async () => {
      const productId = btn.dataset.productId;
      const variantName = btn.dataset.variantName || null;
      // Matched via .dataset comparisons rather than an interpolated CSS
      // attribute selector — a variant name containing a `"` would otherwise
      // break the selector string (or, before escapeHtml was applied above,
      // break out of the data-variant-name HTML attribute entirely).
      const input = Array.from(document.querySelectorAll('.lowstock-input')).find(el =>
        el.dataset.productId === productId && (el.dataset.variantName || null) === variantName
      );
      const qty = parseInt(input?.value) || 0;
      if (qty <= 0) return showToast('Enter a valid quantity', 'error');

      // Compare as strings — data-attributes are always strings, but some
      // older product records store `.id` as a raw number (this app has a
      // documented history of number/string id mismatches, see db.js's
      // cleanupTypeMismatches()); a strict `===` here would silently never
      // match those and this handler would exit with zero visible effect.
      const product = items.find(p => String(p.id) === String(productId));
      if (!product) return showToast('Could not find that product — please refresh and try again', 'error');

      const currentUser = await getCurrentUser();
      let oldStock = 0;
      let newStock = 0;

      if (variantName) {
        const variant = (product.variants || []).find(v => v.name === variantName);
        oldStock = variant?.stock || 0;
        newStock = oldStock + qty;
        const updatedVariants = product.variants.map(v => v.name === variantName ? { ...v, stock: newStock } : v);
        await updateProduct({ ...product, variants: updatedVariants });
      } else {
        oldStock = product.stock || 0;
        newStock = oldStock + qty;
        await updateProduct({ ...product, stock: newStock });
      }

      await logInventoryChange(product.id, variantName, 'IN', qty, 'Quick Restock (Low Stock Alert)', product.branchId || store.branch?.id || 'b1', null, oldStock, newStock, currentUser?.name);

      showToast(`+${qty} added to ${escapeHtml(product.name)}${variantName ? ' (' + escapeHtml(variantName) + ')' : ''} (now ${newStock})`, 'success');
      await openLowStockModal(cur); // refresh — restocked items drop off the list automatically
    };
  });
}

export async function openExpiryModal(cur) {
  const items = await getExpiringProducts(store.branch?.id);

  openModal({
    title: '<i class="fa-solid fa-hourglass-end text-warning"></i> Expiry Alert',
    body: `
      <div style="padding:10px 0">
        <p style="margin-bottom:20px; font-size:14px; opacity:0.8">The following items have expired or are expiring soon.</p>
        <div style="display:flex; flex-direction:column; gap:12px; max-height:400px; overflow-y:auto" class="custom-scrollbar">
          ${items.map(p => {
            const isExpired = p.daysLeft < 0;
            const statusText = isExpired
              ? `Expired ${Math.abs(p.daysLeft)}d ago`
              : p.daysLeft === 0 ? 'Expires today' : `Expires in ${p.daysLeft}d`;
            const statusColor = isExpired ? 'var(--danger)' : 'var(--warning)';
            return `
              <div style="background:var(--bg-elevated); border:1px solid var(--border); border-left:4px solid ${statusColor}; padding:12px 16px; border-radius:12px; display:flex; align-items:center; justify-content:space-between">
                <div style="display:flex; align-items:center; gap:12px">
                  <span style="font-size:24px">${p.emoji || '📦'}</span>
                  <div>
                    <div style="font-weight:700; font-size:14px">${escapeHtml(p.name)}</div>
                    <div style="font-size:11px; opacity:0.6">${escapeHtml(p.category || '')} &middot; Exp: ${p.expiryDate}</div>
                  </div>
                </div>
                <div style="text-align:right">
                  <div style="font-size:13px; font-weight:900; color:${statusColor}">${statusText}</div>
                  <div style="font-size:10px; opacity:0.5; font-weight:600">STOCK: ${parseFloat(Number(p.stock || 0).toFixed(3))}</div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" onclick="closeModal()">Dismiss</button>
      <button class="btn btn-primary" onclick="closeModal(); window.posFilterStock = 'Expiring Soon'; window.navigate('products')">
        <i class="fa-solid fa-box-open mr-8"></i> Manage Inventory
      </button>
    `
  });
}
