import { getProducts, getCategories, getSettings, getProductStockAcrossBranches, getStockStatus, updateProduct, hasPermission } from '../db.js';
import { store } from '../store.js';
import { openModal, closeModal } from '../components/Modal.js';
import { escapeHtml } from '../utils/escapeHtml.js';

let catalogSearch = '';
let catalogCategory = 'All';
let catalogFloor = 'All';
let catalogRow = 'All';
let catalogRack = 'All';
let catalogStockFilter = 'All'; // 'All' or 'InStock'

// Worst-of-all-variants status, same rule Products.js's/Reports.js's own
// overall-status checks use — the aggregate p.stock/p.minStock (a derived
// sum across variants, see db.js) can hide a single critically-low variant
// behind a total that still looks fine.
function getProductOverallStockStatus(p) {
  if (p.variants && p.variants.length > 0) {
    const statuses = p.variants.map(v => getStockStatus(v.stock, v.minStock));
    return statuses.every(s => s === 'out') ? 'out' : (statuses.some(s => s !== 'in') ? 'low' : 'in');
  }
  return getStockStatus(p.stock, p.minStock);
}
let catalogOfferFilter = 'All'; // 'All' or 'OffersOnly'
let catalogSort = 'Recent'; // 'Recent', 'LowToHigh', 'HighToLow', 'AtoZ', 'ZtoA'

export async function renderCatalog(container) {
  const settings = await getSettings();
  const cur = settings.currency;

  const allProductsInitial = await getProducts(store.branch?.id) || [];
  const cats = await getCategories();
  const floors = [...new Set(allProductsInitial.map(p => p.location?.floor).filter(Boolean))].sort();
  const rows = [...new Set(allProductsInitial.map(p => p.location?.row).filter(Boolean))].sort();
  const racks = [...new Set(allProductsInitial.map(p => p.location?.rack).filter(Boolean))].sort();

  container.innerHTML = `
    <div class="page-header sticky-header" style="margin:-24px -24px 0 -24px; padding:24px 24px 16px 24px; border-bottom:1px solid var(--border); background:var(--bg-app); z-index:10; position:sticky; top:-24px; display:flex; flex-direction:column; gap:16px; align-items:stretch;">
      
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
        <div style="display:flex; align-items:center; gap:16px;">
          <div style="width:48px; height:48px; background:linear-gradient(135deg, var(--primary), var(--accent)); color:#fff; display:flex; align-items:center; justify-content:center; border-radius:12px; font-size:20px; box-shadow:0 8px 16px -4px rgba(59,130,246,0.5);">
            <i class="fa-solid fa-store"></i>
          </div>
          <div>
            <div class="page-title" style="font-size:24px; font-weight:900; line-height:1.2; letter-spacing:-0.5px;">Product Catalog</div>
            <div class="page-subtitle" style="font-size:13px; color:var(--text-muted);">Manage and browse your stock across all floors and categories</div>
          </div>
        </div>
        
        <div class="catalog-header-main" style="display:flex; align-items:center; gap:8px; flex:1; min-width:300px; max-width:400px;">
          <div class="search-input-wrap" style="flex:1; display:flex; align-items:center; background:var(--bg-elevated); border:2px solid transparent; border-radius:12px; padding:6px 16px; height:48px; box-shadow:0 4px 6px -1px rgba(0,0,0,0.05); transition:all 0.2s;" onfocusin="this.style.borderColor='var(--primary)'" onfocusout="this.style.borderColor='transparent'">
            <i class="fa-solid fa-magnifying-glass" style="color:var(--text-muted); font-size:16px; margin-right:12px;"></i>
            <input id="catalogSearchInput" placeholder="Search by Name, SKU or Barcode..." value="${escapeHtml(catalogSearch)}" style="border:none; outline:none; background:transparent; color:var(--text-main); font-size:15px; width:100%; font-weight:600;" autocomplete="off" />
          </div>
          <button class="btn btn-ghost hide-desktop" id="mobileFilterToggle" style="border:1px solid var(--border); border-radius: 12px; height: 48px; font-weight:800; gap:8px; display:none;">
            <i class="fa-solid fa-filter"></i> Filters
          </button>
        </div>
      </div>

      <style>
        @media (max-width: 900px) {
          .catalog-header-main {
            flex-direction: column !important;
            max-width: none !important;
            width: 100% !important;
          }
          .search-input-wrap {
            width: 100% !important;
          }
          #mobileFilterToggle {
            display: flex !important;
            width: 100% !important;
            justify-content: center !important;
          }
          #catalogFiltersContainer {
            transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            overflow: hidden;
          }
          .catalog-filters-stack {
            display: flex !important;
            flex-direction: column !important;
            gap: 16px !important;
            padding: 8px 0 !important;
          }
          .catalog-filters-stack > div {
            width: 100% !important;
            flex-direction: column !important;
            align-items: stretch !important;
          }
          .catalog-filters-stack select {
            width: 100% !important;
            height: 46px !important;
          }
          .catalog-filters-stack .quick-toggles {
            flex-wrap: wrap;
          }
          .catalog-filters-stack .quick-toggles label {
            flex: 1;
            justify-content: center;
            height: 40px;
          }
        }
      </style>

      <div class="catalog-filters" id="catalogFiltersContainer">
        <div class="catalog-filters-stack">
          <!-- Top Filter Row: Dropdowns & Sorting -->
          <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px;">
            
            <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:center; flex:1;">
              <!-- Category Filter -->
              <div style="position:relative; display:flex; align-items:center; background:var(--bg-elevated); border:1px solid var(--border); border-radius:10px; padding:4px 6px; box-shadow:0 2px 4px rgba(0,0,0,0.03); flex:1; min-width:140px;">
                <div style="padding:0 10px; color:var(--text-muted); font-size:14px;"><i class="fa-solid fa-layer-group"></i></div>
                <select id="catalogCategorySelect" style="appearance:none; -webkit-appearance:none; background:transparent; color:var(--text-main); border:none; outline:none; font-size:13px; font-weight:700; padding:8px 32px 8px 0; cursor:pointer; width:100%;">
                  <option value="All">All Categories</option>
                  ${cats.map(c => `<option value="${escapeHtml(c.name)}" ${catalogCategory === c.name ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
                </select>
                <i class="fa-solid fa-chevron-down" style="position:absolute; right:14px; top:50%; transform:translateY(-50%); font-size:10px; color:var(--text-muted); pointer-events:none;"></i>
              </div>
              
              <!-- Location Filters Combined -->
              <div style="display:flex; align-items:center; background:var(--bg-elevated); border:1px solid var(--border); border-radius:10px; padding:4px 6px; box-shadow:0 2px 4px rgba(0,0,0,0.03); overflow-x:auto; flex:2; min-width:280px;" class="custom-scrollbar">
                <div style="padding:0 12px; color:var(--primary); font-size:14px;"><i class="fa-solid fa-location-dot"></i></div>
                
                <div style="position:relative; flex:1;">
                  <select id="catalogFloorSelect" style="appearance:none; -webkit-appearance:none; background:var(--bg-surface); color:var(--text-main); border:1px solid var(--border); outline:none; font-size:13px; font-weight:700; padding:6px 28px 6px 10px; border-radius:6px; cursor:pointer; width:100%; text-transform:capitalize;">
                    <option value="All">All Floors</option>
                    ${floors.map(f => `<option value="${escapeHtml(f)}" ${catalogFloor === f ? 'selected' : ''}>Floor ${escapeHtml(f)}</option>`).join('')}
                  </select>
                  <i class="fa-solid fa-chevron-down" style="position:absolute; right:12px; top:50%; transform:translateY(-50%); font-size:10px; color:var(--text-muted); pointer-events:none;"></i>
                </div>
                
                <div style="width:1px; height:20px; background:var(--border); margin:0 8px;"></div>
                
                <div style="position:relative; flex:1;">
                  <select id="catalogRowSelect" style="appearance:none; -webkit-appearance:none; background:var(--bg-surface); color:var(--text-main); border:1px solid var(--border); outline:none; font-size:13px; font-weight:700; padding:6px 28px 6px 10px; border-radius:6px; cursor:pointer; width:100%; text-transform:capitalize;">
                    <option value="All">All Rows</option>
                    ${rows.map(r => `<option value="${escapeHtml(r)}" ${catalogRow === r ? 'selected' : ''}>Row ${escapeHtml(r)}</option>`).join('')}
                  </select>
                  <i class="fa-solid fa-chevron-down" style="position:absolute; right:12px; top:50%; transform:translateY(-50%); font-size:10px; color:var(--text-muted); pointer-events:none;"></i>
                </div>
                
                <div style="width:1px; height:20px; background:var(--border); margin:0 8px;"></div>
                
                <div style="position:relative; flex:1;">
                  <select id="catalogRackSelect" style="appearance:none; -webkit-appearance:none; background:var(--bg-surface); color:var(--text-main); border:1px solid var(--border); outline:none; font-size:13px; font-weight:700; padding:6px 28px 6px 10px; border-radius:6px; cursor:pointer; width:100%; text-transform:capitalize;">
                    <option value="All">All Racks</option>
                    ${racks.map(r => `<option value="${escapeHtml(r)}" ${catalogRack === r ? 'selected' : ''}>Rack ${escapeHtml(r)}</option>`).join('')}
                  </select>
                  <i class="fa-solid fa-chevron-down" style="position:absolute; right:12px; top:50%; transform:translateY(-50%); font-size:10px; color:var(--text-muted); pointer-events:none;"></i>
                </div>
              </div>
            </div>

            <!-- Sort Dropdown -->
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:11px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px;"><i class="fa-solid fa-arrow-down-wide-short"></i> Sort:</span>
              <div style="position:relative; background:var(--bg-elevated); border:1px solid var(--border); border-radius:10px; padding:4px; box-shadow:0 2px 4px rgba(0,0,0,0.03);">
                <select id="catalogSortSelect" style="appearance:none; -webkit-appearance:none; background:var(--bg-surface); color:var(--text-main); border:1px solid var(--border); outline:none; font-size:13px; font-weight:700; padding:6px 32px 6px 12px; border-radius:6px; cursor:pointer; min-width:160px;">
                  <option value="Recent" ${catalogSort === 'Recent' ? 'selected' : ''}>Recently Added</option>
                  <option value="LowToHigh" ${catalogSort === 'LowToHigh' ? 'selected' : ''}>Price: Low to High</option>
                  <option value="HighToLow" ${catalogSort === 'HighToLow' ? 'selected' : ''}>Price: High to Low</option>
                  <option value="AtoZ" ${catalogSort === 'AtoZ' ? 'selected' : ''}>Name: A to Z</option>
                  <option value="ZtoA" ${catalogSort === 'ZtoA' ? 'selected' : ''}>Name: Z to A</option>
                </select>
                <i class="fa-solid fa-chevron-down" style="position:absolute; right:12px; top:50%; transform:translateY(-50%); font-size:10px; color:var(--text-muted); pointer-events:none;"></i>
              </div>
            </div>

          </div>

          <!-- Base Row: Quick Toggles -->
          <div class="quick-toggles" style="display:flex; gap:12px; align-items:center; padding-top:4px;">
             <label style="cursor:pointer; display:flex; align-items:center; gap:6px; background:${catalogStockFilter === 'InStock' ? 'var(--primary)' : 'var(--bg-elevated)'}; color:${catalogStockFilter === 'InStock' ? '#fff' : 'var(--text-muted)'}; padding:8px 16px; border-radius:20px; font-size:12px; font-weight:${catalogStockFilter === 'InStock' ? '800' : '700'}; border:1px solid ${catalogStockFilter === 'InStock' ? 'var(--primary)' : 'var(--border)'}; transition:all 0.2s; box-shadow:${catalogStockFilter === 'InStock' ? '0 4px 6px rgba(59,130,246,0.3)' : 'none'};">
               <input type="checkbox" id="catalogInStockToggle" style="display:none;" ${catalogStockFilter === 'InStock' ? 'checked' : ''}>
               <i class="fa-solid ${catalogStockFilter === 'InStock' ? 'fa-check' : 'fa-box-open'}"></i> In Stock Only
             </label>
             
             <label style="cursor:pointer; display:flex; align-items:center; gap:6px; background:${catalogOfferFilter === 'OffersOnly' ? 'var(--accent)' : 'var(--bg-elevated)'}; color:${catalogOfferFilter === 'OffersOnly' ? '#fff' : 'var(--text-muted)'}; padding:8px 16px; border-radius:20px; font-size:12px; font-weight:${catalogOfferFilter === 'OffersOnly' ? '800' : '700'}; border:1px solid ${catalogOfferFilter === 'OffersOnly' ? 'var(--accent)' : 'var(--border)'}; transition:all 0.2s; box-shadow:${catalogOfferFilter === 'OffersOnly' ? '0 4px 6px rgba(245,158,11,0.3)' : 'none'};">
               <input type="checkbox" id="catalogOfferToggle" style="display:none;" ${catalogOfferFilter === 'OffersOnly' ? 'checked' : ''}>
               <i class="fa-solid ${catalogOfferFilter === 'OffersOnly' ? 'fa-tag' : 'fa-percent'}"></i> Special Offers
             </label>
          </div>
        </div>

      </div>
    </div>
    
    <div id="catalogGridArea" style="padding-top: 24px; padding-bottom: 40px; min-height: 50vh;"></div>
  `;

  // Bind Listeners
  const filterToggle = document.getElementById('mobileFilterToggle');
  const filtersContainer = document.getElementById('catalogFiltersContainer');
  
  if (filterToggle && filtersContainer) {
    const isMobile = window.innerWidth <= 900;
    if (isMobile) {
      filtersContainer.style.maxHeight = '0px';
      filtersContainer.style.opacity = '0';
    }

    filterToggle.addEventListener('click', () => {
      const isExpanded = filtersContainer.style.maxHeight !== '0px';
      if (isExpanded) {
        filtersContainer.style.maxHeight = '0px';
        filtersContainer.style.opacity = '0';
        filterToggle.style.background = 'transparent';
        filterToggle.style.color = 'var(--text-primary)';
      } else {
        filtersContainer.style.maxHeight = '1000px';
        filtersContainer.style.opacity = '1';
        filterToggle.style.background = 'var(--primary-light)';
        filterToggle.style.color = 'var(--primary)';
      }
    });
  }

  document.getElementById('catalogSearchInput').addEventListener('input', (e) => {
    catalogSearch = e.target.value.toLowerCase();
    renderGrid(cur);
  });

  document.getElementById('catalogCategorySelect').addEventListener('change', (e) => {
    catalogCategory = e.target.value;
    renderGrid(cur);
  });

  document.getElementById('catalogFloorSelect').addEventListener('change', (e) => {
    catalogFloor = e.target.value;
    renderGrid(cur);
  });

  document.getElementById('catalogRowSelect').addEventListener('change', (e) => {
    catalogRow = e.target.value;
    renderGrid(cur);
  });

  document.getElementById('catalogRackSelect').addEventListener('change', (e) => {
    catalogRack = e.target.value;
    renderGrid(cur);
  });

  document.getElementById('catalogSortSelect').addEventListener('change', (e) => {
    catalogSort = e.target.value;
    renderGrid(cur);
  });

  document.getElementById('catalogInStockToggle').addEventListener('change', (e) => {
    catalogStockFilter = e.target.checked ? 'InStock' : 'All';
    renderCatalog(container); // Re-render to update toggle styles
  });

  document.getElementById('catalogOfferToggle').addEventListener('change', (e) => {
    catalogOfferFilter = e.target.checked ? 'OffersOnly' : 'All';
    renderCatalog(container); // Re-render to update toggle styles
  });

  renderGrid(cur);
}

// The Floor/Row/Rack filter dropdowns' <option> lists are only ever built
// once, inside renderCatalog()'s initial container.innerHTML — renderGrid()
// (called after editing a product's Storage Location) only redraws the
// product cards, so a brand-new floor/row/rack value saved there wouldn't
// show up in these dropdowns until a full page reload re-ran renderCatalog.
// This patches just the <option> lists in place instead — the <select>
// elements themselves (and their already-bound 'change' listeners) are left
// untouched, only their children are replaced.
async function refreshLocationFilters() {
  const allProducts = await getProducts(store.branch?.id) || [];
  const floors = [...new Set(allProducts.map(p => p.location?.floor).filter(Boolean))].sort();
  const rows = [...new Set(allProducts.map(p => p.location?.row).filter(Boolean))].sort();
  const racks = [...new Set(allProducts.map(p => p.location?.rack).filter(Boolean))].sort();

  const floorSelect = document.getElementById('catalogFloorSelect');
  if (floorSelect) {
    if (catalogFloor !== 'All' && !floors.includes(catalogFloor)) catalogFloor = 'All';
    floorSelect.innerHTML = `<option value="All">All Floors</option>${floors.map(f => `<option value="${escapeHtml(f)}" ${catalogFloor === f ? 'selected' : ''}>Floor ${escapeHtml(f)}</option>`).join('')}`;
  }

  const rowSelect = document.getElementById('catalogRowSelect');
  if (rowSelect) {
    if (catalogRow !== 'All' && !rows.includes(catalogRow)) catalogRow = 'All';
    rowSelect.innerHTML = `<option value="All">All Rows</option>${rows.map(r => `<option value="${escapeHtml(r)}" ${catalogRow === r ? 'selected' : ''}>Row ${escapeHtml(r)}</option>`).join('')}`;
  }

  const rackSelect = document.getElementById('catalogRackSelect');
  if (rackSelect) {
    if (catalogRack !== 'All' && !racks.includes(catalogRack)) catalogRack = 'All';
    rackSelect.innerHTML = `<option value="All">All Racks</option>${racks.map(r => `<option value="${escapeHtml(r)}" ${catalogRack === r ? 'selected' : ''}>Rack ${escapeHtml(r)}</option>`).join('')}`;
  }
}

async function renderGrid(cur) {
  const gridArea = document.getElementById('catalogGridArea');
  if (!gridArea) return;

  let allProducts = await getProducts(store.branch?.id);

  // Apply Quick Toggles
  if (catalogStockFilter === 'InStock') {
    allProducts = allProducts.filter(p => {
      const totalStock = p.variants && p.variants.length > 0
        ? p.variants.reduce((s, v) => s + (Number(v.stock) || 0), 0)
        : Number(p.stock) || 0;
      return totalStock > 0;
    });
  }
  if (catalogOfferFilter === 'OffersOnly') {
    allProducts = allProducts.filter(p => {
      if (Number(p.itemDiscount) > 0) return true;
      if (p.variants && p.variants.some(v => Number(v.itemDiscount) > 0)) return true;
      return false;
    });
  }

  // Apply Standard Filters
  if (catalogSearch) {
    allProducts = allProducts.filter(p => 
      p.name.toLowerCase().includes(catalogSearch) || 
      (p.sku && p.sku.toLowerCase().includes(catalogSearch)) ||
      (p.barcode && p.barcode.toLowerCase().includes(catalogSearch))
    );
  }
  if (catalogCategory !== 'All') {
    allProducts = allProducts.filter(p => p.category && p.category.trim().toLowerCase() === catalogCategory.trim().toLowerCase());
  }
  if (catalogFloor !== 'All') {
    allProducts = allProducts.filter(p => p.location?.floor === catalogFloor);
  }
  if (catalogRow !== 'All') {
    allProducts = allProducts.filter(p => p.location?.row === catalogRow);
  }
  if (catalogRack !== 'All') {
    allProducts = allProducts.filter(p => p.location?.rack === catalogRack);
  }

  // Apply Sorting Logic
  allProducts.sort((a, b) => {
    if (catalogSort === 'Recent') {
      // Assuming higher ID means newer, or fallback to sequential order backing
      return String(b.id || '').localeCompare(String(a.id || ''));
    } 
    else if (catalogSort === 'LowToHigh') {
      const aPrice = Number(a.price) || 0;
      const bPrice = Number(b.price) || 0;
      return aPrice - bPrice;
    } 
    else if (catalogSort === 'HighToLow') {
      const aPrice = Number(a.price) || 0;
      const bPrice = Number(b.price) || 0;
      return bPrice - aPrice;
    } 
    else if (catalogSort === 'AtoZ') {
      return a.name.localeCompare(b.name);
    } 
    else if (catalogSort === 'ZtoA') {
      return b.name.localeCompare(a.name);
    }
    return 0;
  });

  if (allProducts.length === 0) {
    gridArea.innerHTML = `
      <div class="empty-state" style="padding: 100px 20px; text-align: center; background:var(--bg-main); border-radius:16px; border:2px dashed var(--border);">
        <div style="width:80px; height:80px; background:var(--bg-elevated); border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 20px; box-shadow:0 10px 15px -3px rgba(0,0,0,0.1);">
          <i class="fa-solid fa-box-open" style="font-size: 32px; color: var(--text-muted);"></i>
        </div>
        <h3 style="color: var(--text-main); font-size:20px; font-weight:800; margin-bottom: 8px;">No Products Found</h3>
        <p style="color: var(--text-muted); font-size: 14px; max-width:300px; margin:0 auto;">We couldn't find anything matching your filters. Try adjusting the search or location.</p>
      </div>
    `;
    return;
  }

  gridArea.innerHTML = `
    <div class="catalog-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 20px;">
      ${allProducts.map(p => {
        const status = getProductOverallStockStatus(p);
        let stockColor = status === 'in' ? 'var(--success)' : (status === 'low' ? 'var(--warning)' : 'var(--danger)');
        let stockText = status === 'in' ? 'In Stock' : (status === 'low' ? `Low Stock (${parseFloat(Number(p.stock).toFixed(3))})` : 'Out of Stock');
        
        let origPriceDisplay = '';
        let finalPriceDisplay = '';

        if (p.variants && p.variants.length > 0) {
          const minPrice = Math.min(...p.variants.map(v => Number(v.price) || 0));
          const maxPrice = Math.max(...p.variants.map(v => Number(v.price) || 0));
          
          let minFinal = Infinity, maxFinal = -Infinity;
          p.variants.forEach(v => {
            const vPrice = Number(v.price) || 0;
            const vDisc = (v.itemDiscount !== undefined && v.itemDiscount !== '') ? Number(v.itemDiscount) : (Number(p.itemDiscount) || 0);
            const vFinal = Math.max(0, vPrice - vDisc);
            if (vFinal < minFinal) minFinal = vFinal;
            if (vFinal > maxFinal) maxFinal = vFinal;
          });
          
          origPriceDisplay = minPrice === maxPrice ? `${cur}${minPrice}` : `${cur}${minPrice} - ${maxPrice}`;
          finalPriceDisplay = minFinal === maxFinal ? `${cur}${minFinal}` : `${cur}${minFinal} - ${maxFinal}`;
          // stockColor/stockText already computed above via
          // getProductOverallStockStatus(p) — a per-variant worst-status
          // check, not just this product's aggregate p.stock vs a flat 10.
        } else {
          const pPrice = Number(p.price) || 0;
          const pDiscRaw = Number(p.itemDiscount) || 0;
          const pDiscAmt = p.itemDiscountType === 'pct' ? (pPrice * pDiscRaw / 100) : pDiscRaw;
          origPriceDisplay = `${cur}${pPrice}`;
          finalPriceDisplay = pDiscAmt > 0 ? `${cur}${Math.max(0, pPrice - pDiscAmt).toFixed(2)}` : origPriceDisplay;
        }

        let offerHtml = '';
        let maxPct = 0;
        let hasAnyDiscount = false;
        let maxFlatDisc = 0;

        if (p.variants && p.variants.length > 0) {
          p.variants.forEach(v => {
            const vDisc = (v.itemDiscount !== undefined && v.itemDiscount !== '') ? Number(v.itemDiscount) : (Number(p.itemDiscount) || 0);
            if (vDisc > 0) hasAnyDiscount = true;
            if (vDisc > maxFlatDisc) maxFlatDisc = vDisc;
            if (vDisc > 0 && Number(v.price) > 0) {
              const pct = Math.round((vDisc / Number(v.price)) * 100);
              if (pct > maxPct) maxPct = pct;
            }
          });
        } else {
          const pDiscRaw = Number(p.itemDiscount) || 0;
          if (pDiscRaw > 0) {
            hasAnyDiscount = true;
            if (p.itemDiscountType === 'pct') {
              maxPct = pDiscRaw;
              maxFlatDisc = (Number(p.price) || 0) * pDiscRaw / 100;
            } else {
              maxFlatDisc = pDiscRaw;
              if (Number(p.price) > 0) {
                maxPct = Math.round((pDiscRaw / Number(p.price)) * 100);
              }
            }
          }
        }

        if (hasAnyDiscount) {
          const prefix = (p.variants && p.variants.length > 0) ? 'UP TO ' : '';
          if (maxPct > 0) {
            offerHtml = `<div style="font-size:10px; color:var(--success); font-weight:800; margin-top:6px; display:inline-flex; align-items:center; gap:4px; background:rgba(16, 185, 129, 0.1); padding:3px 8px; border-radius:4px;"><i class="fa-solid fa-tag"></i> ${prefix}${maxPct}% OFF</div>`;
          } else if (maxFlatDisc > 0) {
            offerHtml = `<div style="font-size:10px; color:var(--success); font-weight:800; margin-top:6px; display:inline-flex; align-items:center; gap:4px; background:rgba(16, 185, 129, 0.1); padding:3px 8px; border-radius:4px;"><i class="fa-solid fa-tag"></i> ${prefix}${cur}${maxFlatDisc} OFF</div>`;
          }
        }

        return `
          <div class="catalog-card" data-id="${p.id}" style="
            background: var(--bg-card); 
            border: 1px solid var(--border); 
            border-radius: 16px; 
            cursor: pointer; 
            transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            display: flex;
            flex-direction: column;
            position: relative;
            overflow: hidden;
            box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03);
          ">
            <div class="catalog-img-wrapper" style="
              height: 160px; 
              background: var(--bg-surface); 
              display: flex; 
              align-items: center; 
              justify-content: center; 
              font-size: 64px;
              position: relative;
              border-bottom: 1px solid var(--border);
            ">
              ${p.image ? `<img src="${p.image}" style="width:100%; height:100%; object-fit:cover; transition:transform 0.4s ease;" />` : `<span style="transition:transform 0.4s; display:inline-block;">${p.emoji || '📦'}</span>`}
              
              <div style="position: absolute; top: 12px; right: 12px; background: ${stockColor}; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.2); font-size: 10px; font-weight: 800; padding: 4px 10px; border-radius: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); backdrop-filter: blur(4px);">
                ${stockText}
              </div>
            </div>
            
            <div style="padding: 16px; flex: 1; display:flex; flex-direction:column; background: var(--bg-elevated);">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 8px;">
                <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; color: var(--primary); font-weight: 800; background: var(--bg-surface); border:1px solid var(--border); padding: 4px 8px; border-radius: 6px; display:inline-block;">
                  ${escapeHtml(p.category)}
                </div>
                ${p.location && (p.location.floor || p.location.row || p.location.rack) ? `
                  <div style="font-size:10px; color:var(--text-muted); font-weight:700; display:flex; align-items:center; gap:4px; max-width:50%; justify-content:flex-end;" title="Location">
                    <i class="fa-solid fa-location-dot"></i> <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${escapeHtml(p.location.rack || p.location.row || p.location.floor)}</span>
                  </div>
                ` : ''}
              </div>
              
              <div style="font-weight: 800; font-size: 16px; color: var(--text-main); margin-bottom: 4px; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; padding-right:8px;">${escapeHtml(p.name)}</div>
              ${p.sku ? `<div style="font-size:11px; color:var(--text-muted); font-family:monospace; font-weight:600; margin-bottom:12px;">SKU: ${escapeHtml(p.sku)}</div>` : ''}
              
              <div style="margin-top: auto; display: flex; align-items: flex-end; justify-content: space-between; padding-top:12px;">
                <div>
                  <div style="font-weight: 900; font-size: 20px; color: var(--text-main); line-height: 1; display:flex; align-items:baseline; gap:6px; flex-wrap:wrap;">
                    ${origPriceDisplay !== finalPriceDisplay ? `<span style="text-decoration:line-through; font-size:13px; color:var(--text-muted); font-weight:700; opacity:0.8;">${origPriceDisplay}</span>` : ''}
                    <span>${finalPriceDisplay.replace(cur, `<span style="font-size:14px; opacity:0.8; font-weight:700;">${cur}</span>`)}</span>
                  </div>
                  ${offerHtml}
                </div>
                <div class="hover-btn-reveal" style="height:36px; width:36px; border-radius:50%; background:var(--primary); color:#fff; display:flex; align-items:center; justify-content:center; box-shadow:0 4px 10px rgba(59,130,246,0.3); transition:all 0.2s;">
                  <i class="fa-solid fa-arrow-right"></i>
                </div>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  // Bind clicks and sophisticated hover effects
  document.querySelectorAll('.catalog-card').forEach(card => {
    const imgOrSpan = card.querySelector('.catalog-img-wrapper img, .catalog-img-wrapper span');
    const hoverBtn = card.querySelector('.hover-btn-reveal');
    
    card.addEventListener('mouseenter', () => {
      card.style.transform = 'translateY(-4px)';
      card.style.boxShadow = '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)';
      card.style.borderColor = 'var(--primary)';
      if (imgOrSpan) imgOrSpan.style.transform = 'scale(1.1)';
      if (hoverBtn) {
        hoverBtn.style.transform = 'scale(1.1)';
        hoverBtn.style.background = 'var(--accent)';
      }
    });
    
    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
      card.style.boxShadow = '0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)';
      card.style.borderColor = 'var(--border)';
      if (imgOrSpan) imgOrSpan.style.transform = '';
      if (hoverBtn) {
        hoverBtn.style.transform = '';
        hoverBtn.style.background = 'var(--primary)';
      }
    });
    
    card.addEventListener('click', async () => {
      const pid = card.dataset.id;
      const product = allProducts.find(p => String(p.id) === pid);
      if (product) await openProductDetailsModal(product, cur);
    });
  });
}

async function openProductDetailsModal(p, cur) {
  let branchStockHtml = '';
  if (p.sku) {
    const branchesStock = (await getProductStockAcrossBranches(p.sku) || []).filter(b => b.branchId !== (store.branch?.id || 'b1'));
    if (branchesStock.length > 0) {
      branchStockHtml = `
        <div style="margin-top:20px; border-top:1px solid var(--border); padding-top:16px;">
          <h4 style="font-size:13px; color:var(--text-main); margin-bottom:12px; display:flex; align-items:center; gap:6px; font-weight:800;">
            <i class="fa-solid fa-code-branch text-primary"></i> Stock in Other Branches
          </h4>
          <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap:8px;">
            ${branchesStock.map(bs => `
              <div style="background:var(--bg-main); padding:10px 14px; border-radius:8px; border:1px solid var(--border);">
                <div style="font-size:11px; color:var(--text-muted); font-weight:700; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px;">${escapeHtml(bs.branchName)}</div>
                <div style="font-size:16px; font-weight:900; color:${bs.stock > 0 ? 'var(--success)' : 'var(--danger)'}">${bs.stock} <span style="font-size:11px; font-weight:600;">${bs.stock > 0 ? 'Units' : 'Out'}</span></div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }
  }

  const loc = p.location || {};
  // Staff without products:manage still get the read-only badge (same as
  // before) — only someone who could already edit this in Products.js gets
  // the inline editor here, so this doesn't open a new, less-guarded path
  // to changing product data.
  const canEditLocation = await hasPermission('products:manage');
  const locHtml = canEditLocation ? `
    <div style="margin-top:16px; border:1px solid var(--border); padding:12px 14px; border-radius:10px; background:var(--bg-main);">
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
        <div style="width:28px; height:28px; border-radius:7px; background:rgba(59, 130, 246, 0.1); color:var(--primary); display:flex; align-items:center; justify-content:center; font-size:12px; flex-shrink:0;">
          <i class="fa-solid fa-location-dot"></i>
        </div>
        <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; font-weight:800; letter-spacing:0.5px;">Storage Location</div>
      </div>
      <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:8px;">
        <input type="text" class="form-input" id="pdLocFloor" placeholder="Floor" value="${escapeHtml(loc.floor || '')}" style="font-size:12px; padding:8px 10px;" />
        <input type="text" class="form-input" id="pdLocRow" placeholder="Row" value="${escapeHtml(loc.row || '')}" style="font-size:12px; padding:8px 10px;" />
        <input type="text" class="form-input" id="pdLocRack" placeholder="Rack" value="${escapeHtml(loc.rack || '')}" style="font-size:12px; padding:8px 10px;" />
      </div>
      <button class="btn btn-primary btn-sm" id="pdSaveLocationBtn" style="margin-top:10px; width:100%; font-size:12px;">
        <i class="fa-solid fa-floppy-disk"></i> Update Location
      </button>
    </div>
  ` : ((loc.floor || loc.row || loc.rack) ? `
    <div style="display:flex; align-items:center; gap:12px; margin-top:16px; background:transparent; border:1px solid var(--primary); padding:10px 14px; border-radius:10px;">
      <div style="width:32px; height:32px; border-radius:8px; background:rgba(59, 130, 246, 0.1); color:var(--primary); display:flex; align-items:center; justify-content:center; font-size:14px;">
        <i class="fa-solid fa-location-dot"></i>
      </div>
      <div style="font-size:12px;">
        <div style="color:var(--text-muted); font-size:10px; text-transform:uppercase; font-weight:800; letter-spacing:0.5px;">Storage Location</div>
        <div style="color:var(--text-main); font-weight:800; font-size:13px; margin-top:2px;">
          ${[loc.floor ? `Floor ${escapeHtml(loc.floor)}` : '', loc.row ? `Row ${escapeHtml(loc.row)}` : '', loc.rack ? `Rack ${escapeHtml(loc.rack)}` : ''].filter(Boolean).join(' • ')}
        </div>
      </div>
    </div>
  ` : '');

  let variantsHtml = '';
  if (p.variants && p.variants.length > 0) {
    variantsHtml = `
      <div style="margin-top:20px; border-top:1px solid var(--border); padding-top:16px;">
        <h4 style="font-size:13px; color:var(--text-main); margin-bottom:12px; font-weight:800;"><i class="fa-solid fa-tags text-primary mx-4"></i> Available Variants</h4>
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${p.variants.map(v => `
            <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-main); padding:12px 16px; border-radius:12px; border:1px solid var(--border);">
              <div style="font-size:14px; font-weight:700; color:var(--text-main);">${escapeHtml(v.name)}</div>
              <div style="display:flex; align-items:center; gap:16px;">
                <div style="font-size:12px; color:${v.stock > 0 ? 'var(--text-muted)' : 'var(--danger)'}; font-weight:700;">
                  ${v.stock > 0 ? `${parseFloat(Number(v.stock).toFixed(3))} in stock` : 'Out of stock'}
                </div>
                <div style="font-size:16px; font-weight:900; color:var(--text-main);">${cur}${v.price}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  const fmtStock = (s) => parseFloat(Number(s).toFixed(3));
  const pStatus = getStockStatus(p.stock, p.minStock);
  const stockBadge = pStatus === 'in' ?
    `<span style="background:rgba(16, 185, 129, 0.1); color:var(--success); border:1px solid var(--success); padding:4px 10px; border-radius:20px; font-size:11px; font-weight:800;">In Stock (${fmtStock(p.stock)})</span>` :
    (pStatus === 'low' ? `<span style="background:rgba(245, 158, 11, 0.1); color:var(--warning); border:1px solid var(--warning); padding:4px 10px; border-radius:20px; font-size:11px; font-weight:800;">Low Stock (${fmtStock(p.stock)})</span>` :
    `<span style="background:rgba(239, 68, 68, 0.1); color:var(--danger); border:1px solid var(--danger); padding:4px 10px; border-radius:20px; font-size:11px; font-weight:800;">Out of Stock</span>`);

  openModal({
    title: `<i class="fa-solid fa-box-open text-primary mr-8" style="font-size:16px;"></i> Product Details`,
    body: `
      <div style="display:flex; gap:24px; padding:10px 0;">
        <div style="flex:0 0 160px;">
          <div style="width:160px; height:160px; background:var(--bg-surface); border-radius:16px; display:flex; align-items:center; justify-content:center; font-size:80px; overflow:hidden; border:1px solid var(--border); box-shadow:0 10px 15px -3px rgba(0,0,0,0.05);">
            ${p.image ? `<img src="${p.image}" style="width:100%; height:100%; object-fit:cover;" />` : (p.emoji || '📦')}
          </div>
        </div>
        
        <div style="flex:1; min-width:0; display:flex; flex-direction:column;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
            <div>
              <div style="display:flex; gap:8px; margin-bottom:8px;">
                <span class="badge" style="background:var(--primary); color:#fff; font-weight:800; font-size:10px; padding:4px 8px;">${escapeHtml(p.category)}</span>
                ${p.subCategory ? `<span class="badge" style="background:var(--bg-main); color:var(--text-muted); font-weight:700; font-size:10px; padding:4px 8px; border:1px solid var(--border);">${escapeHtml(p.subCategory)}</span>` : ''}
              </div>
              <h2 style="font-size:26px; font-weight:900; color:var(--text-main); margin:0; line-height:1.2; letter-spacing:-0.5px;">${escapeHtml(p.name)}</h2>
            </div>
            ${(!p.variants || p.variants.length === 0) ? stockBadge : ''}
          </div>
          
          <div style="display:flex; gap:16px; margin-top:12px; font-size:13px; color:var(--text-muted);">
            ${p.sku ? `<div><b style="color:var(--text-main); font-weight:800;">SKU:</b> ${escapeHtml(p.sku)}</div>` : ''}
            ${p.barcode ? `<div><b style="color:var(--text-main); font-weight:800;">Barcode:</b> ${escapeHtml(p.barcode)}</div>` : ''}
          </div>
          
          ${locHtml}

          <div style="margin-top:auto;">
            ${(!p.variants || p.variants.length === 0) ? `
              <div style="font-size:32px; font-weight:900; color:var(--text-main); display:flex; align-items:baseline; gap:4px; padding-top:16px;">
                <span style="font-size:20px; font-weight:800; color:var(--text-muted);">${cur}</span>${p.price}
                ${p.unit ? `<span style="font-size:14px; font-weight:700; color:var(--text-muted); margin-left:4px;">/${p.unit}</span>` : ''}
              </div>
            ` : ''}
          </div>
        </div>
      </div>
      
      ${variantsHtml}
      ${branchStockHtml}
    `,
    footer: `<button class="btn btn-ghost" onclick="closeModal()">Close</button>`
  });

  const saveLocBtn = document.getElementById('pdSaveLocationBtn');
  if (saveLocBtn) {
    saveLocBtn.onclick = async () => {
      const floor = document.getElementById('pdLocFloor').value.trim();
      const row = document.getElementById('pdLocRow').value.trim();
      const rack = document.getElementById('pdLocRack').value.trim();
      const original = saveLocBtn.innerHTML;
      saveLocBtn.disabled = true;
      saveLocBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
      try {
        await updateProduct({ ...p, location: { floor, row, rack } });
        // Keep the in-memory object the rest of this modal instance is
        // closed over in sync too, not just the DB — so if the user reopens
        // this same product without a full grid refresh, it still reflects
        // what was just saved.
        p.location = { floor, row, rack };
        if (window.showToast) window.showToast('Storage location updated', 'success');
        // Both the grid (each card's location badge) and the Floor/Row/Rack
        // filter dropdowns' <option> lists need refreshing — a brand-new
        // value typed here previously only showed up after a full page
        // reload (see refreshLocationFilters()'s own comment). Filters
        // first — it can reset a stale catalogFloor/Row/Rack selection back
        // to 'All' if this edit just renamed the value it pointed at, and
        // the grid render right after should reflect that immediately.
        await refreshLocationFilters();
        await renderGrid(cur);
      } catch (err) {
        console.error('[Catalog] Failed to update storage location:', err);
        if (window.showToast) window.showToast('Failed to update location', 'error');
      } finally {
        saveLocBtn.disabled = false;
        saveLocBtn.innerHTML = original;
      }
    };
  }
}
