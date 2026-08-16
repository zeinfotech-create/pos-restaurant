import { getInventoryLogs, getProducts, getSettings } from '../db.js';
import { store } from '../store.js';
import { initDateRangePicker, getDefaultRange } from '../utils/dateRangeHelper.js';
import { applySessionFilter } from '../utils/sessionFilter.js';
import { escapeHtml } from '../utils/escapeHtml.js';

const { start: defaultStart, end: defaultEnd } = getDefaultRange();
let filterStartDate = defaultStart;
let filterEndDate = defaultEnd;
let logTypeFilter = 'All';
let logReasonFilter = 'All';
let logSearchQuery = '';
let logCurrentPage = 1;
const LOG_ITEMS_PER_PAGE = 8;

// Groups every free-text `reason` string ever written by logInventoryChange()
// callers into a small, stable set of categories for filtering/reporting —
// new callers just need their reason text to start with the right prefix
// (e.g. 'Stock Adjustment: ...') to be picked up here automatically.
function categorizeReason(reason) {
  const r = (reason || '').toLowerCase();
  if (r.startsWith('stock adjustment')) return 'Adjustment';
  if (r.includes('stock transfer')) return 'Transfer';
  if (r.includes('purchase')) return 'Purchase';
  if (r.includes('return')) return 'Return';
  if (r === 'sale' || r.startsWith('sale')) return 'Sale';
  return 'Other';
}

// Adjustment reasons that represent an actual loss of stock (as opposed to
// "Found Extra Stock" or "Stock Count Correction", which can go either way) —
// used for the Shrinkage stat so a shop owner can see damage/theft/expiry
// loss at a glance without having to read every row.
const SHRINKAGE_REASON_PREFIXES = ['Stock Adjustment: Damage', 'Stock Adjustment: Theft', 'Stock Adjustment: Expired'];

function getReasonBadgeStyle(category, reason) {
  // Damage/Theft/Expired are the sub-cases that actually matter to a shop
  // owner (real loss) — call those out in red even though they all share
  // the parent 'Adjustment' category, rather than lumping them in with the
  // neutral corrections (Found Extra Stock / Stock Count Correction).
  if (category === 'Adjustment' && SHRINKAGE_REASON_PREFIXES.some(prefix => (reason || '').startsWith(prefix))) {
    return { bg: 'rgba(239,68,68,0.12)', color: 'var(--danger)' };
  }
  switch (category) {
    case 'Adjustment': return { bg: 'rgba(245,158,11,0.12)', color: 'var(--accent)' };
    case 'Purchase': return { bg: 'rgba(16,185,129,0.12)', color: '#10b981' };
    case 'Return': return { bg: 'rgba(59,130,246,0.12)', color: 'var(--info)' };
    case 'Sale': return { bg: 'rgba(79,70,229,0.12)', color: 'var(--primary)' };
    case 'Transfer': return { bg: 'rgba(20,184,166,0.12)', color: '#14b8a6' };
    default: return null;
  }
}

function renderReasonCell(reason) {
  if (!reason) return '<span class="text-muted">No reason</span>';
  const category = categorizeReason(reason);
  const style = getReasonBadgeStyle(category, reason);
  if (!style) return escapeHtml(reason);
  return `<span class="badge" style="background:${style.bg}; color:${style.color}; font-size:10px; font-weight:700; white-space:nowrap">${category}</span> <span style="opacity:0.75">${escapeHtml(reason)}</span>`;
}

export async function renderInventoryLog(container) {
  const settings = await getSettings();
  const cur = settings.currency;
  const branchId = store.branch?.id || 'b1';
  
  // Fetch logs and products
  let rawLogs = await getInventoryLogs(branchId);
  let allLogs = await applySessionFilter(rawLogs, 'date');
  const products = await getProducts(branchId);
  
  // Sort newest first
  allLogs.sort((a, b) => new Date(b.date) - new Date(a.date));

  // 1. Apply Date Filtering
  let filteredByDate = allLogs;
  if (filterStartDate && filterEndDate) {
    filteredByDate = allLogs.filter(l => {
      const d = l.date.split('T')[0];
      return d >= filterStartDate && d <= filterEndDate;
    });
  }

  // 2. Calculate Stats from date-filtered logs (before search/type filter)
  const stats = {
    total: filteredByDate.length,
    stockIn: filteredByDate.filter(l => l.type === 'IN').reduce((sum, l) => sum + (l.qtyChange || 0), 0),
    stockOut: filteredByDate.filter(l => l.type === 'OUT').reduce((sum, l) => sum + (l.qtyChange || 0), 0),
    pendingSync: filteredByDate.filter(l => !l.isSynced).length,
    shrinkage: filteredByDate
      .filter(l => l.type === 'OUT' && SHRINKAGE_REASON_PREFIXES.some(prefix => (l.reason || '').startsWith(prefix)))
      .reduce((sum, l) => sum + (l.qtyChange || 0), 0)
  };

  // 3. Final Filter (Type + Reason Category, independent of search) — kept
  // separate from the search term so the live search handler below has a
  // stable base to re-filter from. If search were baked into this list,
  // switching the Log Type/Reason tab while a search term is active would
  // bake that term into the closure the search handler reads from, and no
  // amount of editing (even clearing) the search box afterward could bring
  // back records excluded by that stale term.
  const baseForSearch = filteredByDate.filter(l => {
    const matchesType = logTypeFilter === 'All' || l.type === logTypeFilter;
    const matchesReasonCategory = logReasonFilter === 'All' || categorizeReason(l.reason) === logReasonFilter;
    return matchesType && matchesReasonCategory;
  });

  const matchesSearchTerm = (l, q) => {
    const p = products.find(prod => String(prod.id) === String(l.productId));
    const pName = p ? p.name.toLowerCase() : 'unknown';
    const reason = (l.reason || '').toLowerCase();
    const logUser = (l.user || 'System').toLowerCase();
    return pName.includes(q) || reason.includes(q) || logUser.includes(q);
  };

  const finalLogs = baseForSearch.filter(l => matchesSearchTerm(l, logSearchQuery.toLowerCase()));

  // Pagination (on the fully-filtered set)
  const totalLogPages = Math.ceil(finalLogs.length / LOG_ITEMS_PER_PAGE) || 1;
  if (logCurrentPage > totalLogPages) logCurrentPage = totalLogPages;
  const logPageStart = (logCurrentPage - 1) * LOG_ITEMS_PER_PAGE;
  const paginatedLogs = finalLogs.slice(logPageStart, logPageStart + LOG_ITEMS_PER_PAGE);

  container.innerHTML = `
    <div id="inventory-log-page">
      <div class="page-header" style="flex-wrap: wrap; gap: 16px;">
        <div>
          <div class="page-title">Stock History Audit</div>
          <div class="page-subtitle">Track every inventory movement with precision</div>
        </div>
        <div class="flex gap-8">
          <button class="btn btn-ghost hide-desktop" id="mobileFilterToggle" style="border:1px solid var(--border)">
            <i class="fa-solid fa-filter mr-8"></i> Filters
          </button>
          <button class="btn btn-primary" id="exportLogsBtn"><i class="fa-solid fa-file-export mr-4"></i> Export</button>
        </div>
      </div>


      <div class="grid-5 mb-24">
        <div class="stat-card">
          <div class="stat-icon" style="background:rgba(79,70,229,0.12); color:var(--primary)">
            <i class="fa-solid fa-clock-rotate-left"></i>
          </div>
          <div class="stat-info">
            <div class="stat-value">${stats.total}</div>
            <div class="stat-label">Total Movements</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:rgba(16,185,129,0.12); color:#10b981">
            <i class="fa-solid fa-arrow-trend-up"></i>
          </div>
          <div class="stat-info">
            <div class="stat-value text-success">+${stats.stockIn}</div>
            <div class="stat-label">Stock Inward</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:rgba(239,68,68,0.12); color:var(--danger)">
            <i class="fa-solid fa-arrow-trend-down"></i>
          </div>
          <div class="stat-info">
            <div class="stat-value text-danger">-${stats.stockOut}</div>
            <div class="stat-label">Stock Outward</div>
          </div>
        </div>
        <div class="stat-card" title="Damage + Theft/Loss + Expired adjustments in this period">
          <div class="stat-icon" style="background:rgba(239,68,68,0.12); color:var(--danger)">
            <i class="fa-solid fa-triangle-exclamation"></i>
          </div>
          <div class="stat-info">
            <div class="stat-value ${stats.shrinkage > 0 ? 'text-danger' : ''}">${stats.shrinkage}</div>
            <div class="stat-label">Shrinkage (Loss)</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:rgba(245,158,11,0.12); color:var(--accent)">
            <i class="fa-solid fa-cloud-arrow-up"></i>
          </div>
          <div class="stat-info">
            <div class="stat-value ${stats.pendingSync > 0 ? 'text-warning' : 'text-success'}">${stats.pendingSync}</div>
            <div class="stat-label">Sync Pending</div>
          </div>
        </div>
      </div>

      <div class="mb-16" id="filterCard" style="transition: all 0.3s ease-in-out; overflow:hidden">
        <div class="data-mgmt-bar mobile-filter-stack p-16">
          <div class="search-input-wrap">
            <i class="fa-solid fa-magnifying-glass"></i>
            <input type="text" class="form-input" id="logSearch" value="${logSearchQuery}" placeholder="Search product, reason or user..." />
          </div>
          
          <div class="filter-group">
            <label class="filter-label">Movement Range</label>
            <div class="date-picker-group">
              <i class="fa-solid fa-calendar-day"></i>
              <input type="text" id="log-date-range" class="form-input-clean" style="width:100%" readonly />
            </div>
          </div>

          <div class="filter-group">
            <label class="filter-label">Log Type</label>
            <div class="tab-group" style="height:48px; border-radius:14px; padding:4px; display:flex; align-items:center; background:var(--bg-elevated); border:1px solid var(--border); width:100%">
              <button class="tab-btn ${logTypeFilter === 'All' ? 'active' : ''}" data-type="All" style="font-size:12px; height:100%; flex:1; border-radius:10px">All</button>
              <button class="tab-btn ${logTypeFilter === 'IN' ? 'active' : ''}" data-type="IN" style="font-size:12px; height:100%; flex:1; border-radius:10px">IN</button>
              <button class="tab-btn ${logTypeFilter === 'OUT' ? 'active' : ''}" data-type="OUT" style="font-size:12px; height:100%; flex:1; border-radius:10px">OUT</button>
            </div>
          </div>

          <div class="filter-group">
            <label class="filter-label">Reason</label>
            <select class="form-input" id="logReasonSelect" style="height:48px">
              ${['All', 'Sale', 'Purchase', 'Transfer', 'Return', 'Adjustment', 'Other'].map(r => `<option value="${r}" ${logReasonFilter === r ? 'selected' : ''}>${r === 'All' ? 'All Reasons' : r}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="flex items-center justify-between mb-16">
          <div class="text-sm font-semibold opacity-50">Log Records</div>
          <button class="btn btn-ghost btn-sm" id="navToProductsBtn"><i class="fa-solid fa-box mr-4"></i> Manage Items</button>
        </div>

        <div class="table-wrap">
          <table class="responsive-table">
            <thead>
              <tr>
                <th style="width:160px">Date & Time</th>
                <th>Product Details</th>
                <th>Type</th>
                <th>Movement</th>
                <th>Reason</th>
                <th>Performed By</th>
                <th style="width:80px; text-align:center">Cloud</th>
              </tr>
            </thead>
            <tbody id="inventoryLogTableBody">
              ${renderLogRows(paginatedLogs, products)}
            </tbody>
          </table>
        </div>
        <div id="logPaginationArea"></div>
      </div>
    </div>
  `;

  renderLogPagination(totalLogPages, finalLogs, products);

  // Mobile Filter Toggle Logic
  const filterCard = document.getElementById('filterCard');
  const toggleBtn = document.getElementById('mobileFilterToggle');
  if (toggleBtn && filterCard) {
    let isExpanded = false;
    if (window.innerWidth <= 900) {
      filterCard.style.maxHeight = '0px';
      filterCard.style.padding = '0px';
      filterCard.style.margin = '0px';
      filterCard.style.opacity = '0';
    }
    toggleBtn.onclick = () => {
      isExpanded = !isExpanded;
      if (isExpanded) {
        filterCard.style.maxHeight = '600px';
        filterCard.style.padding = '0px';
        filterCard.style.margin = '0 0 16px 0';
        filterCard.style.opacity = '1';
        toggleBtn.innerHTML = '<i class="fa-solid fa-times mr-8"></i> Hide Filters';
      } else {
        filterCard.style.maxHeight = '0px';
        filterCard.style.padding = '0px';
        filterCard.style.margin = '0px';
        filterCard.style.opacity = '0';
        toggleBtn.innerHTML = '<i class="fa-solid fa-filter mr-8"></i> Filters';
      }
    };
  }

  // Attach Event Listeners
  const searchInput = document.getElementById('logSearch');
  const exportBtn = document.getElementById('exportLogsBtn');
  const productsBtn = document.getElementById('navToProductsBtn');

  // Tracks whatever's actually on screen right now, so Export always matches
  // the visible table even after a live search edit (which doesn't trigger
  // a full re-render and therefore never updates the outer `finalLogs`).
  let currentFilteredLogs = finalLogs;

  searchInput?.addEventListener('input', (e) => {
    logSearchQuery = e.target.value;
    // We update just the table for search to feel snappy
    const q = logSearchQuery.toLowerCase();
    // Re-filter from baseForSearch (type/reason/date only), NOT finalLogs —
    // finalLogs already has the search term baked in from the last full
    // render, so filtering from it can't recover records excluded by a
    // now-stale term (see comment above baseForSearch's definition).
    const filtered = baseForSearch.filter(l => matchesSearchTerm(l, q));
    currentFilteredLogs = filtered;
    logCurrentPage = 1;
    const totalPages = Math.ceil(filtered.length / LOG_ITEMS_PER_PAGE) || 1;
    const pageStart = (logCurrentPage - 1) * LOG_ITEMS_PER_PAGE;
    const tbody = document.getElementById('inventoryLogTableBody');
    if (tbody) tbody.innerHTML = renderLogRows(filtered.slice(pageStart, pageStart + LOG_ITEMS_PER_PAGE), products);
    renderLogPagination(totalPages, filtered, products);
  });

  initDateRangePicker('log-date-range', filterStartDate, filterEndDate, async (start, end) => {
    filterStartDate = start;
    filterEndDate = end;
    logCurrentPage = 1;
    await renderInventoryLog(container);
  });

  // Tab listeners (Type filter)
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        logTypeFilter = btn.dataset.type;
        logCurrentPage = 1;
        await renderInventoryLog(container);
    });
  });

  document.getElementById('logReasonSelect')?.addEventListener('change', async (e) => {
    logReasonFilter = e.target.value;
    logCurrentPage = 1;
    await renderInventoryLog(container);
  });

  productsBtn?.addEventListener('click', () => window.navigate('products'));
  exportBtn?.addEventListener('click', () => exportLogsToCSV(currentFilteredLogs, products));
}

// Global listener moved outside to prevent duplicates on each render
window.addEventListener('data-synced', async (e) => {
  if (e.detail.store === 'inventory_logs' && window.currentPage === 'inventory-log') {
    const container = document.getElementById('page-container');
    if (container) await renderInventoryLog(container);
  }
});

function renderLogPagination(totalPages, filteredLogs, products) {
  const pagArea = document.getElementById('logPaginationArea');
  if (!pagArea) return;

  let html = `
    <div class="pagination-bar">
      <span>Showing page <b>${logCurrentPage}</b> of <b>${totalPages}</b></span>
      <div class="pagination-controls">
        <button class="pagination-btn" id="prevLogPage" ${logCurrentPage === 1 ? 'disabled' : ''}>
          <i class="fa-solid fa-chevron-left"></i>
        </button>
  `;

  for (let i = 1; i <= totalPages; i++) {
    if (totalPages > 5 && Math.abs(i - logCurrentPage) > 2 && i !== 1 && i !== totalPages) {
      if (i === 2 || i === totalPages - 1) html += `<span style="padding: 0 4px">...</span>`;
      continue;
    }
    html += `<button class="pagination-btn ${i === logCurrentPage ? 'active' : ''} log-page-btn" data-page="${i}">${i}</button>`;
  }

  html += `
        <button class="pagination-btn" id="nextLogPage" ${logCurrentPage === totalPages ? 'disabled' : ''}>
          <i class="fa-solid fa-chevron-right"></i>
        </button>
      </div>
    </div>
  `;

  pagArea.innerHTML = html;

  const goToPage = (page) => {
    logCurrentPage = page;
    const start = (logCurrentPage - 1) * LOG_ITEMS_PER_PAGE;
    const tbody = document.getElementById('inventoryLogTableBody');
    if (tbody) tbody.innerHTML = renderLogRows(filteredLogs.slice(start, start + LOG_ITEMS_PER_PAGE), products);
    renderLogPagination(totalPages, filteredLogs, products);
  };

  document.getElementById('prevLogPage').onclick = () => {
    if (logCurrentPage > 1) goToPage(logCurrentPage - 1);
  };
  document.getElementById('nextLogPage').onclick = () => {
    if (logCurrentPage < totalPages) goToPage(logCurrentPage + 1);
  };
  pagArea.querySelectorAll('.log-page-btn').forEach(btn => {
    btn.onclick = () => goToPage(parseInt(btn.dataset.page));
  });
}

function renderLogRows(logs, products) {
  if (logs.length === 0) {
    return `<tr><td colspan="7" style="text-align:center;padding:60px 0;opacity:0.5">
      <i class="fa-solid fa-folder-open mb-12" style="font-size:32px"></i><br/>
      No movements found for the selected filters.
    </td></tr>`;
  }
  
  let lastDate = null;
  
  return logs.map(l => {
    const p = products.find(prod => String(prod.id) === String(l.productId));
    const pName = p ? p.name : 'Unknown Product';
    const typeClass = l.type === 'IN' ? 'text-success' : 'text-danger';
    const sign = l.type === 'IN' ? '+' : '-';
    
    const d = new Date(l.date);
    const dateStr = d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric'});
    const timeStr = d.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit'});
    
    // Add date separator if date changes
    let separator = '';
    if (dateStr !== lastDate) {
        separator = `
          <tr class="table-separator">
            <td colspan="7" style="background:var(--bg-subtle); font-weight:700; font-size:11px; color:var(--text-muted); padding:8px 16px; text-transform:uppercase; letter-spacing:0.5px">
              <i class="fa-solid fa-calendar-day mr-8"></i> ${dateStr}
            </td>
          </tr>
        `;
        lastDate = dateStr;
    }

    return separator + `
      <tr>
        <td data-label="Time" class="text-muted" style="font-size:11px; font-weight:600">${timeStr}</td>
        <td data-label="Product">
           <div class="flex items-center gap-12">
             <div style="background:var(--bg-elevated); width:32px; height:32px; display:flex; align-items:center; justify-content:center; border-radius:8px; font-size:18px">${p?.emoji || '📦'}</div>
             <div>
               <div class="font-bold" style="font-size:13px">${escapeHtml(pName)}</div>
               ${l.variantName ? `<div class="text-muted" style="font-size:10px">${escapeHtml(l.variantName)}</div>` : ''}
             </div>
           </div>
        </td>
        <td data-label="Type"><span class="badge ${l.type === 'IN' ? 'badge-success' : 'badge-danger'}" style="font-size:10px; font-weight:700; width:60px; text-align:center">${l.type}</span></td>
        <td data-label="Movement" style="font-size:13px; font-weight:600">
           ${l.oldStock !== null ? `
             <div><span style="opacity:0.6">${l.oldStock}</span> <i class="fa-solid fa-arrow-right mx-8" style="font-size:10px;opacity:0.3"></i> <b class="${typeClass}">${l.newStock}</b></div>
             <div class="${typeClass}" style="font-size:11px; font-weight:700; opacity:0.85; margin-top:2px">${sign}${l.qtyChange} ${escapeHtml(p?.unit || 'pcs')}</div>
           ` : `<b class="${typeClass}">${sign}${l.qtyChange}</b> <span class="text-muted" style="font-size:11px; font-weight:500">${escapeHtml(p?.unit || 'pcs')}</span>`}
        </td>
        <td data-label="Reason" style="font-size:12px; max-width:200px">${renderReasonCell(l.reason)}</td>
        <td data-label="Performed By">
           <div style="display:flex; align-items:center; gap:6px; font-size:12px; font-weight:500">
             <i class="fa-solid fa-circle-user opacity-30"></i>
             ${l.user || 'System'}
           </div>
           <div style="font-size:10px; opacity:0.4; margin-top:2px">${l.refId || '-'}</div>
        </td>
        <td style="text-align:center">
          ${l.isSynced ? 
            `<i class="fa-solid fa-cloud-check text-success" title="Synced to Cloud" style="font-size:14px"></i>` : 
            `<i class="fa-solid fa-cloud-arrow-up text-warning" title="Pending Sync" style="font-size:14px; opacity:0.6"></i>`}
        </td>
      </tr>
    `;
  }).join('');
}

function exportLogsToCSV(logs, products) {
  if (logs.length === 0) {
    if (window.showToast) window.showToast('No logs to export', 'warning');
    return;
  }

  const headers = ['Date', 'Time', 'Product', 'Variant', 'Type', 'Category', 'Qty Change', 'Old Stock', 'New Stock', 'Reason', 'User', 'Reference'];
  const rows = logs.map(l => {
    const p = products.find(prod => String(prod.id) === String(l.productId));
    const pName = p ? p.name : 'Unknown Product';
    const date = l.date ? new Date(l.date) : new Date();
    return [
      date.toLocaleDateString(),
      date.toLocaleTimeString(),
      `"${pName.replace(/"/g, '""')}"`,
      `"${(l.variantName || '-').replace(/"/g, '""')}"`,
      l.type,
      categorizeReason(l.reason),
      l.qtyChange,
      l.oldStock !== null ? l.oldStock : '-',
      l.newStock !== null ? l.newStock : '-',
      `"${(l.reason || '').replace(/"/g, '""')}"`,
      `"${(l.user || 'System').replace(/"/g, '""')}"`,
      `"${(l.refId || '-').replace(/"/g, '""')}"`
    ].join(',');
  });

  const csvContent = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", `inventory_audit_${new Date().getTime()}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
