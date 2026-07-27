import { getSettings, getTodaySales, getSalesLast7Days, getOrders, getTopProducts, getDailySalesBreakdown, getVehicleDeliveryReport, getSupplierOutstandingReport, getBranches, getCategorySales, getMonthlySales, getPaymentBreakdown, getSuppliers, getPurchases, getPurchasesMonthly, getReturns, getCustomers, getShifts, getRegisters, getStaff, getStaffIncentives, getProducts, getInstantSalesData, updateProduct, read, KEYS, hasPermission } from '../db.js';
import { showToast } from '../components/Toast.js';
import { openModal, closeModal } from '../components/Modal.js';
import { store } from '../store.js';
import { navigate } from '../router.js';
import { Chart, registerables } from 'chart.js';
import { paginate, renderPaginationBar } from '../utils/pagination.js';
Chart.register(...registerables);

let currentBranchFilter = store.branch?.id || '';

// Initialize default date range: Today
const now = new Date();
const format = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
let currentStartDate = format(new Date(now.getFullYear(), now.getMonth(), 1));
let currentEndDate = format(now);

const REPORT_PAGE_SIZE = 10;
// Per-table pagination state, reset to 1 each time its tab is (re)opened.
let dailySalesPage = 1;
let instantSalesPage = 1;
let purchaseRecentPage = 1;
let vehicleReportPage = 1;
let outstandingSalesPage = 1;
let outstandingPurchasePage = 1;
let customerReportPage = 1;
let supplierReportPage = 1;
let gstOutputPage = 1;
let gstInputPage = 1;
let staffIncentiveLogPage = 1;
let registerReportPage = 1;
let returnsReportPage = 1;
let loginActivityPage = 1;

export async function renderReports(container, subPage = 'sales') {
  if (!(await hasPermission('reports:view'))) {
    container.innerHTML = `
      <div class="empty-state" style="height:70vh; flex-direction:column">
        <i class="fa-solid fa-lock" style="font-size:64px;margin-bottom:24px;opacity:0.2"></i>
        <h2 class="font-bold">Access Denied</h2>
        <p class="mb-24 text-muted">You do not have permission to view reports.</p>
        <button class="btn btn-primary" onclick="window.navigate('dashboard')">Back to Dashboard</button>
      </div>
    `;
    return;
  }
  const settings = await getSettings();
  const cur = settings.currency;

  container.innerHTML = `
    <div class="page-header" style="margin-bottom:20px">
      <div class="page-title">Analytics Hub</div>
      <div class="header-actions" style="display:flex; gap:12px; align-items:center;">
        <!-- Global Date Range Filter -->
        <div class="date-picker-group">
          <i class="fa-solid fa-calendar-day text-muted" style="font-size:14px"></i>
          <input type="text" id="report-date-range" class="form-input-clean" style="width:220px" readonly>
        </div>

        <select class="form-select form-select-sm" id="report-branch-filter" style="width:180px">
          <option value="">All Branches</option>
          ${(await getBranches()).map(b => `<option value="${b.id}" ${currentBranchFilter === b.id ? 'selected' : ''}>${b.name}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="report-nav custom-scrollbar" style="display:flex;gap:12px;margin-bottom:24px;border-bottom:1px solid var(--border);padding-bottom:12px;overflow-x:auto">
      <button class="btn btn-ghost btn-sm ${subPage === 'sales' ? 'active-tab' : ''}" onclick="navigate('reports/sales')">Sales Hub</button>
      <button class="btn btn-ghost btn-sm ${subPage === 'instant-sales' ? 'active-tab' : ''}" onclick="navigate('reports/instant-sales')">Instant Sales</button>
      <button class="btn btn-ghost btn-sm ${subPage === 'category-sales' ? 'active-tab' : ''}" onclick="navigate('reports/category-sales')">Categories</button>
      <button class="btn btn-ghost btn-sm ${subPage === 'sales-analysis' ? 'active-tab' : ''}" onclick="navigate('reports/sales-analysis')">Analysis</button>
      <button class="btn btn-ghost btn-sm ${subPage === 'inventory' ? 'active-tab' : ''}" onclick="navigate('reports/inventory')">Inventory</button>
      <button class="btn btn-ghost btn-sm ${subPage === 'purchases' ? 'active-tab' : ''}" onclick="navigate('reports/purchases')">Procurement</button>
      <button class="btn btn-ghost btn-sm ${subPage === 'vehicles' ? 'active-tab' : ''}" onclick="navigate('reports/vehicles')">Vehicles</button>
      <button class="btn btn-ghost btn-sm ${subPage === 'outstanding' ? 'active-tab' : ''}" onclick="navigate('reports/outstanding')">Outstanding</button>
      <button class="btn btn-ghost btn-sm ${subPage === 'gst' ? 'active-tab' : ''}" onclick="navigate('reports/gst')">GST Center</button>
      <button class="btn btn-ghost btn-sm ${subPage === 'customers' ? 'active-tab' : ''}" onclick="navigate('reports/customers')">Customers</button>
      <button class="btn btn-ghost btn-sm ${subPage === 'staff' ? 'active-tab' : ''}" onclick="navigate('reports/staff')">Staff</button>
      <button class="btn btn-ghost btn-sm ${subPage === 'registers' ? 'active-tab' : ''}" onclick="navigate('reports/registers')">Registers</button>
      <button class="btn btn-ghost btn-sm ${subPage === 'login-activity' ? 'active-tab' : ''}" onclick="navigate('reports/login-activity')">Login Audit</button>
      <button class="btn btn-ghost btn-sm ${subPage === 'returns' ? 'active-tab' : ''}" onclick="navigate('reports/returns')">Returns History</button>
    </div>
    <div id="report-content"></div>
  `;

  const contentEl = document.getElementById('report-content');

  switch (subPage) {
    case 'staff':
      await renderStaffIncentiveReport(contentEl, cur);
      break;
    case 'category-sales':
      await renderCategorySalesReport(contentEl, cur);
      break;
    case 'instant-sales':
      await renderInstantSalesReport(contentEl, cur);
      break;
    case 'sales-analysis':
      await renderSalesAnalysis(contentEl, cur);
      break;
    case 'purchases':
      await renderPurchaseReport(contentEl, cur);
      break;
    case 'vehicles':
      await renderVehicleDeliveryReport(contentEl, cur);
      break;
    case 'outstanding':
      await renderOutstandingReport(contentEl, cur);
      break;
    case 'gst':
      await renderGSTReport(contentEl, cur);
      break;
    case 'customers':
      await renderCustomerReport(contentEl, cur);
      break;
    case 'suppliers':
      await renderSupplierReport(contentEl, cur);
      break;
    case 'registers':
      await renderRegisterReport(contentEl, cur);
      break;
    case 'inventory':
      await renderLowStockReport(contentEl, cur);
      break;
    case 'returns':
      await renderReturnsReport(contentEl, cur);
      break;
    case 'login-activity':
      await renderLoginActivityReport(contentEl, cur);
      break;
    case 'sales':
    default:
      await renderSalesReport(contentEl, cur);
      break;
  }

  const branchFilterEl = document.getElementById('report-branch-filter');
  if (branchFilterEl) {
    branchFilterEl.onchange = async (e) => {
      currentBranchFilter = e.target.value;
      await renderReports(container, subPage);
    };
  }

  const rangeEl = document.getElementById('report-date-range');
  if (rangeEl) {
    const today = new Date(); today.setHours(0,0,0,0);
    const yesterday = new Date(); yesterday.setDate(today.getDate() - 1); yesterday.setHours(0,0,0,0);
    const last7 = new Date(); last7.setDate(today.getDate() - 6); last7.setHours(0,0,0,0);
    const last30 = new Date(); last30.setDate(today.getDate() - 29); last30.setHours(0,0,0,0);
    const firstDayThisMonth = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0, 0);
    const lastDayLastMonth = new Date(today.getFullYear(), today.getMonth(), 0, 0, 0, 0, 0);
    const firstDayLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1, 0, 0, 0, 0);
    const firstDayYear = new Date(today.getFullYear(), 0, 1, 0, 0, 0, 0);

    const picker = new Litepicker({
      element: rangeEl,
      singleMode: false,
      numberOfMonths: 2,
      numberOfColumns: 2,
      format: 'DD/MM/YYYY',
      startDate: currentStartDate,
      endDate: currentEndDate,
      plugins: ['ranges'],
      ranges: {
        custom: 'Custom Range',
        ranges: {
          'Today': [new Date().setHours(0,0,0,0), new Date().setHours(0,0,0,0)],
          'Yesterday': [new Date(new Date().setDate(new Date().getDate()-1)).setHours(0,0,0,0), new Date(new Date().setDate(new Date().getDate()-1)).setHours(0,0,0,0)],
          'Last 7 Days': [new Date(new Date().setDate(new Date().getDate()-6)).setHours(0,0,0,0), new Date().setHours(0,0,0,0)],
          'Last 30 Days': [new Date(new Date().setDate(new Date().getDate()-29)).setHours(0,0,0,0), new Date().setHours(0,0,0,0)],
          'This Month': [new Date(new Date().getFullYear(), new Date().getMonth(), 1).setHours(0,0,0,0), new Date().setHours(0,0,0,0)],
          'Last Month': [new Date(new Date().getFullYear(), new Date().getMonth()-1, 1).setHours(0,0,0,0), new Date(new Date().getFullYear(), new Date().getMonth(), 0).setHours(0,0,0,0)],
          ['This Year (' + new Date().getFullYear() + ')']: [new Date(new Date().getFullYear(), 0, 1).setHours(0,0,0,0), new Date().setHours(0,0,0,0)],
          ['Last Year (' + (new Date().getFullYear() - 1) + ')']: [new Date(new Date().getFullYear() - 1, 0, 1).setHours(0,0,0,0), new Date(new Date().getFullYear() - 1, 11, 31).setHours(23,59,59,999)],
          'Last 365 Days': [new Date(new Date(new Date().setDate(new Date().getDate()-364)).setHours(0,0,0,0)), new Date().setHours(0,0,0,0)],
        }
      },
      setup: (picker) => {
        const updateActiveRangeUI = () => {
          const startDate = picker.getStartDate()?.format('YYYY-MM-DD');
          const endDate = picker.getEndDate()?.format('YYYY-MM-DD');
          
          const localDate = (d) => {
            const dt = new Date(d);
            dt.setHours(0,0,0,0);
            return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
          };

          const todayLocal = localDate(new Date());
          const yesterdayLocal = localDate(new Date(Date.now() - 86400000));
          const last7Local = localDate(new Date(Date.now() - 6 * 86400000));
          const last30Local = localDate(new Date(Date.now() - 29 * 86400000));
          const now = new Date();
          const firstThisMonth = localDate(new Date(now.getFullYear(), now.getMonth(), 1));
          const firstLastMonth = localDate(new Date(now.getFullYear(), now.getMonth()-1, 1));
          const lastLastMonth = localDate(new Date(now.getFullYear(), now.getMonth(), 0));
          const firstYear = localDate(new Date(now.getFullYear(), 0, 1));

          const ranges = [
            { name: 'Today', start: todayLocal, end: todayLocal },
            { name: 'Yesterday', start: yesterdayLocal, end: yesterdayLocal },
            { name: 'Last 7 Days', start: last7Local, end: todayLocal },
            { name: 'Last 30 Days', start: last30Local, end: todayLocal },
            { name: 'This Month', start: firstThisMonth, end: todayLocal },
            { name: 'Last Month', start: firstLastMonth, end: lastLastMonth },
            { name: 'This Year (' + now.getFullYear() + ')', start: firstYear, end: todayLocal },
            { name: 'Last Year (' + (now.getFullYear() - 1) + ')', start: localDate(new Date(now.getFullYear() - 1, 0, 1)), end: localDate(new Date(now.getFullYear() - 1, 11, 31)) },
            { name: 'Last 365 Days', start: localDate(new Date(Date.now() - 364 * 86400000)), end: todayLocal },
          ];

          const activeRange = ranges.find(r => r.start === startDate && r.end === endDate);
          
          picker.ui.querySelectorAll('.container__predefined-ranges button').forEach(btn => {
            btn.classList.remove('is-active-preset');
            if (activeRange && btn.innerText.trim() === activeRange.name) {
              btn.classList.add('is-active-preset');
            }
          });
        };

        picker.on('selected', async (date1, date2) => {
          const newStart = date1.format('YYYY-MM-DD');
          const newEnd = date2.format('YYYY-MM-DD');
          
          if (newStart !== currentStartDate || newEnd !== currentEndDate) {
            currentStartDate = newStart;
            currentEndDate = newEnd;
            await renderReports(container, subPage);
          }
        });

        picker.on('show', () => {
          updateActiveRangeUI();
        });

        // Ensure active state is triggered on initial load
        setTimeout(() => {
          if (currentStartDate && currentEndDate) {
            picker.setDateRange(currentStartDate, currentEndDate);
            updateActiveRangeUI();
          }
        }, 50);
      }
    });

    // Set initial display value
    rangeEl.value = `${new Date(currentStartDate).toLocaleDateString('en-GB')} - ${new Date(currentEndDate).toLocaleDateString('en-GB')}`;
  }
}

// Generic export — works for whichever report tab is currently rendered into #report-content,
// so every report gets Excel/PDF export for free instead of hand-building it per tab.
function csvEscape(val) {
  const s = String(val ?? '').replace(/\s+/g, ' ').trim();
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// ============================================================
// Per-table Excel/PDF export — each table gets its own small export buttons
// in its own card header instead of one shared "export the whole tab" button,
// so exporting one table never drags in unrelated data from other tables
// sharing the same tab (e.g. Outstanding's separate Sales/Purchase tables).
// ============================================================

// Small icon-button pair, dropped into a table's card header. `exportId` just
// needs to be unique within the current tab — used to find these buttons again
// in wireTableExport() without needing per-table global ids.
function tableExportButtonsHtml(exportId) {
  return `<div style="display:flex;gap:4px;flex-shrink:0">
    <button class="btn btn-ghost btn-xs table-export-csv-btn" data-export-id="${exportId}" title="Export this table as CSV (opens in Excel)"><i class="fa-solid fa-file-csv"></i></button>
    <button class="btn btn-ghost btn-xs table-export-pdf-btn" data-export-id="${exportId}" title="Export this table as PDF"><i class="fa-solid fa-file-pdf"></i></button>
  </div>`;
}

function extractTableToCsvLines(table, titleText) {
  const lines = [];
  if (titleText) lines.push(csvEscape(titleText));

  const allHeaderCells = [...table.querySelectorAll('thead th')].map(th => th.innerText);
  // "Actions"/"Select" columns are button controls or checkboxes, not reportable data —
  // drop them from the export rather than leaking button labels like "View Orders" as text.
  const skipIdx = new Set(allHeaderCells.map((h, i) => (!h.trim() || /^(actions?|select)$/i.test(h.trim())) ? i : -1).filter(i => i >= 0));
  const headerCells = allHeaderCells.filter((_, i) => !skipIdx.has(i)).map(csvEscape);
  if (headerCells.length) lines.push(headerCells.join(','));

  table.querySelectorAll('tbody tr').forEach(tr => {
    const cells = [...tr.querySelectorAll('td')].filter((_, i) => !skipIdx.has(i)).map(td => csvEscape(td.innerText));
    if (cells.length) lines.push(cells.join(','));
  });
  return lines;
}

function downloadCsvLines(lines, filename) {
  if (lines.length === 0) {
    showToast('Nothing to export in this table yet', 'warning');
    return;
  }
  // Leading BOM so Excel renders the ₹ symbol and other non-ASCII text correctly
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename.replace(/\s+/g, '_')}_${format(new Date())}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exported — opens directly in Excel', 'success');
}

// Exports `tableEl`'s FULL dataset, not just whatever page pagination currently
// has rendered — `getFullBodyHtml()` (when given) rebuilds every row via the
// same row-template each table already uses for display, so there's no
// duplicated column-mapping code. The tbody swap is synchronous and restored
// immediately after reading, so there's no visible flicker.
function exportSingleTableCSV(tableEl, titleText, getFullBodyHtml) {
  const tbody = tableEl.querySelector('tbody');
  const original = tbody.innerHTML;
  if (getFullBodyHtml) tbody.innerHTML = getFullBodyHtml();
  const lines = extractTableToCsvLines(tableEl, titleText);
  if (getFullBodyHtml) tbody.innerHTML = original;
  downloadCsvLines(lines, titleText);
}

// On Electron, render just this one table off-screen and save it straight to
// the Downloads folder as a PDF — no OS print dialog (electron/main.cjs:
// export-pdf-silent), same silent approach used for receipt printing. In a
// plain browser (dev testing without Electron), fall back to the native print
// dialog via window.print(), which already has its own "Save as PDF" option.
async function exportSingleTablePDF(tableEl, titleText, getFullBodyHtml) {
  const clone = tableEl.cloneNode(true);
  if (getFullBodyHtml) clone.querySelector('tbody').innerHTML = getFullBodyHtml();
  const bodyHtml = `<div style="padding:8px"><h3 style="margin-bottom:12px">${titleText}</h3><div class="table-wrap">${clone.outerHTML}</div></div>`;

  const isElectron = /Electron/i.test(navigator.userAgent);
  if (isElectron && window.electronAPI?.exportReportPdfSilent) {
    const styleNodes = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'));
    const styleParts = await Promise.all(styleNodes.map(async (node) => {
      if (node.tagName === 'STYLE') return node.outerHTML;
      // The app's own stylesheet is a relative <link> (./assets/...), which has
      // no base to resolve against inside the hidden window's data:text/html
      // document — inline the actual CSS text instead (node.href is already an
      // absolute file:// URL here in the main window's own context).
      try {
        const cssText = await (await fetch(node.href)).text();
        return `<style>${cssText}</style>`;
      } catch (e) {
        return node.outerHTML;
      }
    }));
    // The hidden print window lays out narrower than 768px, which would
    // otherwise trigger .responsive-table's mobile "stacked card" view
    // (style.css's @media max-width:768px block) — force the real table
    // layout back on for the PDF regardless of that breakpoint. Also strip
    // the app's dark-theme card styling (CSS-var backgrounds, shadows,
    // heavy rounding) down to a plain light/print-friendly table, regardless
    // of which theme is active on screen — dark backgrounds waste ink and
    // look wrong on paper.
    const tableOverrideCss = `<style>
      .table-wrap { background: #ffffff !important; border: 1px solid #e2e2e2 !important; box-shadow: none !important; border-radius: 6px !important; }
      .responsive-table thead { display: table-header-group !important; }
      .responsive-table tbody { display: table-row-group !important; }
      .responsive-table tr { display: table-row !important; margin-bottom: 0 !important; border: none !important; border-radius: 0 !important; box-shadow: none !important; }
      .responsive-table th { background: #f5f5f5 !important; color: #333333 !important; border-bottom: 1px solid #d9d9d9 !important; }
      .responsive-table td { display: table-cell !important; width: auto !important; text-align: left !important; padding: 8px 12px !important; position: static !important; min-height: 0 !important; background: #ffffff !important; color: #1a1a1a !important; border-bottom: 1px solid #e8e8e8 !important; font-size: 12px !important; }
      .responsive-table td::before { content: none !important; display: none !important; }
      .responsive-table td:last-child { background: #ffffff !important; padding-left: 12px !important; }
      .responsive-table tr:nth-child(even) td { background: #fafafa !important; }
    </style>`;
    const fullHtml = `<html><head><title>${titleText}</title>${styleParts.join('')}${tableOverrideCss}</head><body style="background:white; color:black; padding:16px">${bodyHtml}</body></html>`;
    const res = await window.electronAPI.exportReportPdfSilent({ html: fullHtml, filename: titleText });
    if (res?.success) {
      showToast(`Saved to Downloads: ${res.path.split(/[\\/]/).pop()}`, 'success');
    } else {
      showToast('PDF export failed: ' + (res?.error || 'unknown error'), 'error');
    }
    return;
  }

  openModal({ title: titleText, body: bodyHtml, footer: '', hideClose: true });
  window.addEventListener('afterprint', () => closeModal(), { once: true });
  setTimeout(() => window.print(), 200);
}

// Wires one table's export buttons — ids only need to be unique within the
// current tab, so this is safe to call once per table right after its buttons
// and table exist in the DOM (pagination page-changes don't need to re-wire).
function wireTableExport(exportId, tableEl, titleText, getFullBodyHtml) {
  const csvBtn = document.querySelector(`.table-export-csv-btn[data-export-id="${exportId}"]`);
  if (csvBtn) csvBtn.onclick = () => exportSingleTableCSV(tableEl, titleText, getFullBodyHtml);
  const pdfBtn = document.querySelector(`.table-export-pdf-btn[data-export-id="${exportId}"]`);
  if (pdfBtn) pdfBtn.onclick = () => exportSingleTablePDF(tableEl, titleText, getFullBodyHtml);
}

async function renderSalesReport(container, cur) {
  const { applySessionFilter } = await import('../utils/sessionFilter.js');
  
  const rawTodaySales = await getTodaySales(currentBranchFilter, currentStartDate, currentEndDate);
  // getTodaySales internally fetches orders, but it aggregates them. To be totally accurate we must recalculate, 
  // but to be safe we will apply it to the main orders list:
  
  const rawAllOrders = await getOrders(currentBranchFilter, currentStartDate, currentEndDate);
  const allOrders = await applySessionFilter(rawAllOrders, 'date');

  // Recalculate todaySales from filtered orders to ensure strict compliance
  const validOrders = allOrders.filter(o => o.status !== 'cancelled');
  const returns = await getReturns(currentBranchFilter, currentStartDate, currentEndDate);
  const salesReturns = returns.filter(r => r.type === 'sales');
  const returnsTotal = salesReturns.reduce((s, r) => s + (r.total || 0), 0);
  const grossTotal = validOrders.reduce((s,o) => s + (o.total || 0), 0);

  // Daily breakdown is the single source of truth for profit — the top-level "Gross Profit"
  // stat card is just its sum, so the card and the day-by-day table below can never disagree
  // the way the old order.total-minus-subtotal proxy (which ignored cost price entirely) did.
  const dailyBreakdown = await getDailySalesBreakdown(currentBranchFilter, currentStartDate, currentEndDate);
  const profitTotal = dailyBreakdown.reduce((s, d) => s + d.profit, 0);

  const todaySales = {
    grossTotal,
    returnsTotal,
    total: grossTotal - returnsTotal,
    count: validOrders.length,
    profitTotal,
  };

  const last7 = await getSalesLast7Days(currentBranchFilter);
  const topProducts = await getTopProducts(currentBranchFilter, currentStartDate, currentEndDate);

  const isToday = currentStartDate === format(new Date()) && currentEndDate === currentStartDate;
  const rangeLabel = isToday ? 'Today' : 'Range';
  const canExportSales = await hasPermission('reports:export');

  container.innerHTML = `
    <div class="grid-4 mb-24">
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(16,185,129,0.15)"><i class="fa-solid fa-coins" style="color:#10b981"></i></div>
        <div class="stat-info">
          <div class="stat-value">${cur}${(todaySales?.total || 0).toFixed(2)}</div>
          <div class="stat-label">Net Sales (${rangeLabel})</div>
        </div>
      </div>
      <div class="stat-card" style="border:1px solid var(--accent); background:rgba(99,102,241,0.05)">
        <div class="stat-icon" style="background:rgba(99,102,241,0.15)"><i class="fa-solid fa-sack-dollar" style="color:#6366f1"></i></div>
        <div class="stat-info">
          <div class="stat-value" style="color:var(--accent)">${cur}${(todaySales?.profitTotal || 0).toFixed(2)}</div>
          <div class="stat-label">Gross Profit (${rangeLabel})</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(239,68,68,0.15)"><i class="fa-solid fa-rotate-left" style="color:#ef4444"></i></div>
        <div class="stat-info">
          <div class="stat-value">${cur}${(todaySales?.returnsTotal || 0).toFixed(2)}</div>
          <div class="stat-label">Returns (${rangeLabel})</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(59,130,246,0.15)"><i class="fa-solid fa-chart-line" style="color:#3b82f6"></i></div>
        <div class="stat-info">
          <div class="stat-value">${cur}${(todaySales?.grossTotal || 0).toFixed(2)}</div>
          <div class="stat-label">Gross Revenue (${rangeLabel})</div>
        </div>
      </div>
    </div>

    <div class="grid-2 gap-16">
      <div class="card">
        <div class="font-bold mb-16"><i class="fa-solid fa-chart-column mr-8"></i> Weekly Trend</div>
        <div style="height:250px"><canvas id="salesChart"></canvas></div>
      </div>
      <div class="card">
        <div class="font-bold mb-16"><i class="fa-solid fa-pie-chart mr-8"></i> Payment Methods</div>
        <div style="height:250px"><canvas id="paymentChart"></canvas></div>
      </div>
    </div>

    <div class="card mt-16">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div class="font-bold"><i class="fa-solid fa-fire mr-8"></i> Top Performing Products</div>
        ${canExportSales ? tableExportButtonsHtml('top-products') : ''}
      </div>
      <div class="table-wrap">
        <table class="responsive-table">
          <thead><tr><th>Rank</th><th>Product</th><th>Qty Sold</th><th>Revenue</th><th>Profit</th></tr></thead>
          <tbody id="topProductsBody">
            ${topProducts.map(topProductRowHtml).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card mt-16">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div class="font-bold"><i class="fa-solid fa-calendar-days mr-8"></i> Daily Sales &amp; Profit</div>
        ${canExportSales ? tableExportButtonsHtml('daily-sales') : ''}
      </div>
      <div class="table-wrap">
        <table class="responsive-table">
          <thead><tr><th>Date</th><th>Orders</th><th>Sales</th><th>Profit</th><th>Margin</th></tr></thead>
          <tbody id="dailySalesBody"></tbody>
        </table>
      </div>
      <div id="dailySalesPagination"></div>
    </div>
  `;

  const topProductsTableEl = document.getElementById('topProductsBody').closest('table');
  const dailySalesTableEl = document.getElementById('dailySalesBody').closest('table');

  function topProductRowHtml(p, i) {
    const rank = (typeof i === 'number' ? i : topProducts.indexOf(p)) + 1;
    return `
              <tr>
                <td data-label="Rank">#${rank}</td>
                <td data-label="Product">
                  <div style="display:flex;align-items:center;gap:10px;justify-content:flex-start">
                    <span style="font-size:20px">${p.emoji || '📦'}</span>
                    <span>${p.name}</span>
                  </div>
                </td>
                <td data-label="Qty Sold">${p.qty}</td>
                <td data-label="Revenue" class="font-bold text-success">${cur}${p.revenue.toFixed(2)}</td>
                <td data-label="Profit" class="font-bold text-accent">${cur}${(p.profit || 0).toFixed(2)}</td>
              </tr>
            `;
  }

  function dailySalesRowHtml(d) {
    return `
              <tr>
                <td data-label="Date">${new Date(d.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                <td data-label="Orders">${d.orders}</td>
                <td data-label="Sales" class="font-bold text-success">${cur}${d.sales.toFixed(2)}</td>
                <td data-label="Profit" class="font-bold text-accent">${cur}${d.profit.toFixed(2)}</td>
                <td data-label="Margin">${d.sales > 0 ? ((d.profit / d.sales) * 100).toFixed(1) : '0.0'}%</td>
              </tr>
            `;
  }

  dailySalesPage = 1;
  (function renderDailySalesRows() {
    const { pageItems, page, totalPages } = paginate(dailyBreakdown, dailySalesPage, REPORT_PAGE_SIZE);
    dailySalesPage = page;
    document.getElementById('dailySalesBody').innerHTML = pageItems.length === 0 ? `<tr><td colspan="5" style="text-align:center;padding:40px;opacity:0.5">No sales in this range</td></tr>` :
      pageItems.map(dailySalesRowHtml).join('');

    renderPaginationBar(document.getElementById('dailySalesPagination'), {
      page, totalPages, onChange: (p) => { dailySalesPage = p; renderDailySalesRows(); }
    });
  })();

  renderSalesChart(last7);
  renderPaymentChart(allOrders, cur);

  wireTableExport('top-products', topProductsTableEl, 'Top Performing Products', () => topProducts.map((p, i) => topProductRowHtml(p, i)).join(''));
  wireTableExport('daily-sales', dailySalesTableEl, 'Daily Sales & Profit', () => dailyBreakdown.map(dailySalesRowHtml).join(''));
}

async function renderInstantSalesReport(container, cur) {
  const { totalRevenue, totalOrdersCount, items } = await getInstantSalesData(currentBranchFilter, currentStartDate, currentEndDate);
  const canExportInst = await hasPermission('reports:export');

  container.innerHTML = `
    <div class="grid-2 mb-24">
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(139,92,246,0.15)"><i class="fa-solid fa-bolt" style="color:#8b5cf6"></i></div>
        <div class="stat-info">
          <div class="stat-value">${cur}${totalRevenue.toFixed(2)}</div>
          <div class="stat-label">Total Instant Revenue</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(139,92,246,0.15)"><i class="fa-solid fa-receipt" style="color:#8b5cf6"></i></div>
        <div class="stat-info">
          <div class="stat-value">${totalOrdersCount}</div>
          <div class="stat-label">Orders with Instant Items</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div class="font-bold"><i class="fa-solid fa-list mr-8"></i> Instant Sales Transactions</div>
        ${canExportInst ? tableExportButtonsHtml('instant-sales') : ''}
      </div>
      <div class="table-wrap">
        <table class="responsive-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Customer</th>
              <th>Item Name</th>
              <th>Qty</th>
              <th>Price</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody id="instantSalesBody"></tbody>
        </table>
      </div>
      <div id="instantSalesPagination"></div>
    </div>
  `;

  const instantSalesTableEl = document.getElementById('instantSalesBody').closest('table');

  function instantSaleRowHtml(item) {
    return `
              <tr>
                <td data-label="Date">${new Date(item.date).toLocaleString()}</td>
                <td data-label="Customer">${item.customer}</td>
                <td data-label="Item Name" class="font-bold">${item.name}</td>
                <td data-label="Qty">${item.qty}</td>
                <td data-label="Price">${cur}${item.price.toFixed(2)}</td>
                <td data-label="Total" class="text-success font-bold">${cur}${item.revenue.toFixed(2)}</td>
              </tr>
            `;
  }

  instantSalesPage = 1;
  (function renderInstantSalesRows() {
    const { pageItems, page, totalPages } = paginate(items, instantSalesPage, REPORT_PAGE_SIZE);
    instantSalesPage = page;
    document.getElementById('instantSalesBody').innerHTML = pageItems.length === 0 ? '<tr><td colspan="6" style="text-align:center;padding:32px;opacity:0.5">No instant sales found</td></tr>' :
      pageItems.map(instantSaleRowHtml).join('');

    renderPaginationBar(document.getElementById('instantSalesPagination'), {
      page, totalPages, onChange: (p) => { instantSalesPage = p; renderInstantSalesRows(); }
    });
  })();

  wireTableExport('instant-sales', instantSalesTableEl, 'Instant Sales Transactions', () => items.map(instantSaleRowHtml).join(''));
}

async function renderCategorySalesReport(container, cur) {
  const categorySales = await getCategorySales(currentBranchFilter, currentStartDate, currentEndDate);
  const totalRevenue = categorySales.reduce((s, c) => s + c.revenue, 0);
  const canExportCat = await hasPermission('reports:export');

  function categoryRowHtml(c) {
    return `
              <tr>
                <td data-label="Category"><span class="badge badge-ghost">${c.category}</span></td>
                <td data-label="Qty Sold">${c.qty}</td>
                <td data-label="Revenue" class="font-bold">${cur}${c.revenue.toFixed(2)}</td>
                <td data-label="Market Share">
                  <div style="display:flex;align-items:center;gap:10px;justify-content:flex-start">
                    <div style="flex:1;background:var(--bg-main);height:6px;border-radius:3px;overflow:hidden;max-width:80px">
                      <div style="width:${(c.revenue / totalRevenue * 100).toFixed(1)}%;background:var(--primary);height:100%"></div>
                    </div>
                    <span style="font-size:11px;font-weight:600">${(c.revenue / totalRevenue * 100).toFixed(1)}%</span>
                  </div>
                </td>
              </tr>
            `;
  }

  container.innerHTML = `
    <div class="card mb-24">
      <div class="font-bold mb-16"><i class="fa-solid fa-tags mr-8"></i> Category-wise Performance</div>
      <div style="height:300px"><canvas id="categoryChart"></canvas></div>
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div class="font-bold">Revenue Breakdown by Category</div>
        ${canExportCat ? tableExportButtonsHtml('category-sales') : ''}
      </div>
      <div class="table-wrap">
        <table class="responsive-table">
          <thead><tr><th>Category</th><th>Qty Sold</th><th>Revenue</th><th>Market Share</th></tr></thead>
          <tbody id="categorySalesBody">
            ${categorySales.map(categoryRowHtml).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  wireTableExport('category-sales', document.getElementById('categorySalesBody').closest('table'), 'Revenue Breakdown by Category', () => categorySales.map(categoryRowHtml).join(''));

  const ctx = document.getElementById('categoryChart');
  if (ctx) {
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: categorySales.map(c => c.category),
        datasets: [{
          label: 'Revenue',
          data: categorySales.map(c => c.revenue),
          backgroundColor: '#4f46e5',
          borderRadius: 8
        }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
  }
}

async function renderSalesAnalysis(container, cur) {
  const salesTrend = await getMonthlySales(currentBranchFilter);
  const purchaseTrend = await getPurchasesMonthly(currentBranchFilter);

  container.innerHTML = `
    <div class="card mb-24">
      <div class="font-bold mb-16"><i class="fa-solid fa-chart-area mr-8"></i> Profitability Analysis (Sales vs Purchases)</div>
      <div style="height:350px"><canvas id="analysisChart"></canvas></div>
    </div>

    <div class="grid-2 gap-16">
      <div class="stat-card">
        <div class="stat-info">
          <div class="stat-label">Total Lifetime Revenue</div>
          <div class="stat-value text-success">${cur}${salesTrend.reduce((s, m) => s + m.total, 0).toLocaleString()}</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-info">
          <div class="stat-label">Total Procurement Cost</div>
          <div class="stat-value text-danger">${cur}${purchaseTrend.reduce((s, m) => s + m.total, 0).toLocaleString()}</div>
        </div>
      </div>
    </div>
  `;

  const ctx = document.getElementById('analysisChart');
  if (ctx) {
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: salesTrend.map(s => s.label),
        datasets: [
          {
            label: 'Sales Revenue',
            data: salesTrend.map(s => s.total),
            borderColor: '#10b981',
            tension: 0.3,
            fill: false
          },
          {
            label: 'Purchase Cost',
            data: purchaseTrend.map(p => p.total),
            borderColor: '#ef4444',
            tension: 0.3,
            fill: false
          }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
  }
}

async function renderPurchaseReport(container, cur) {
  const purchases = await getPurchases(currentBranchFilter, currentStartDate, currentEndDate);
  const purchasesSorted = purchases.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  const monthly = await getPurchasesMonthly(currentBranchFilter);
  const totalSpend = purchases.reduce((s, p) => s + p.total, 0);
  const canExportPurch = await hasPermission('reports:export');

  container.innerHTML = `
    <div class="grid-2 mb-24">
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(239,68,68,0.15)"><i class="fa-solid fa-truck-fast" style="color:#ef4444"></i></div>
        <div class="stat-info">
          <div class="stat-value">${cur}${totalSpend.toLocaleString()}</div>
          <div class="stat-label">Total Purchase Spending</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(245,158,11,0.15)"><i class="fa-solid fa-boxes-stacked" style="color:#f59e0b"></i></div>
        <div class="stat-info">
          <div class="stat-value">${purchases.length}</div>
          <div class="stat-label">Total Orders Placed</div>
        </div>
      </div>
    </div>

    <div class="card mb-16">
      <div class="font-bold mb-16">Monthly Procurement Trend</div>
      <div style="height:300px"><canvas id="procurementChart"></canvas></div>
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div class="font-bold">Purchases</div>
        ${canExportPurch ? tableExportButtonsHtml('purchases') : ''}
      </div>
      <div class="table-wrap">
        <table class="responsive-table">
          <thead><tr><th>Date</th><th>ID</th><th>Supplier</th><th>Total</th><th>Action</th></tr></thead>
          <tbody id="purchaseRecentBody"></tbody>
        </table>
      </div>
      <div id="purchaseRecentPagination"></div>
    </div>
  `;

  renderProcurementChart(monthly);

  const purchaseTableEl = document.getElementById('purchaseRecentBody').closest('table');

  function purchaseRecentRowHtml(p) {
    return `
              <tr>
                <td data-label="Date">${new Date(p.date).toLocaleDateString()}</td>
                <td data-label="ID">${p.id}</td>
                <td data-label="Supplier">${p.supplierName}</td>
                <td data-label="Total" class="font-bold text-danger">${cur}${p.total.toFixed(2)}</td>
                <td>
                  <button class="btn btn-ghost btn-sm purchase-return-btn" data-id="${p.id}">
                    <i class="fa-solid fa-rotate-left"></i> Return
                  </button>
                </td>
              </tr>
            `;
  }

  purchaseRecentPage = 1;
  (function renderPurchaseRecentRows() {
    const { pageItems, page, totalPages } = paginate(purchasesSorted, purchaseRecentPage, REPORT_PAGE_SIZE);
    purchaseRecentPage = page;
    const tbody = document.getElementById('purchaseRecentBody');
    tbody.innerHTML = pageItems.map(purchaseRecentRowHtml).join('');

    tbody.querySelectorAll('.purchase-return-btn').forEach(btn => {
      btn.onclick = async () => {
        const pur = purchases.find(p => p.id === btn.dataset.id);
        if (pur) await openPurchaseReturnModal(pur, cur);
      };
    });

    renderPaginationBar(document.getElementById('purchaseRecentPagination'), {
      page, totalPages, onChange: (p) => { purchaseRecentPage = p; renderPurchaseRecentRows(); }
    });
  })();

  wireTableExport('purchases', purchaseTableEl, 'Purchases', () => purchasesSorted.map(purchaseRecentRowHtml).join(''));
}

async function renderVehicleDeliveryReport(container, cur) {
  const vehicles = await getVehicleDeliveryReport(currentBranchFilter, currentStartDate, currentEndDate);
  const totalDeliveries = vehicles.reduce((s, v) => s + v.deliveries, 0);
  const totalValue = vehicles.reduce((s, v) => s + v.totalValue, 0);

  vehicleReportPage = 1;
  const canExportVeh = await hasPermission('reports:export');

  container.innerHTML = `
    <div class="grid-2 mb-24">
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(59,130,246,0.15)"><i class="fa-solid fa-truck-fast" style="color:#3b82f6"></i></div>
        <div class="stat-info">
          <div class="stat-value">${totalDeliveries}</div>
          <div class="stat-label">Total Deliveries (Range)</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(16,185,129,0.15)"><i class="fa-solid fa-coins" style="color:#10b981"></i></div>
        <div class="stat-info">
          <div class="stat-value">${cur}${totalValue.toFixed(2)}</div>
          <div class="stat-label">Total Delivery Value (Range)</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div class="font-bold"><i class="fa-solid fa-truck-fast mr-8"></i> Vehicle-wise Delivery Report</div>
        ${canExportVeh ? tableExportButtonsHtml('vehicles') : ''}
      </div>
      <div class="table-wrap">
        <table class="responsive-table">
          <thead><tr><th>Vehicle</th><th>Deliveries</th><th>Total Value</th><th>Avg / Delivery</th><th>Actions</th></tr></thead>
          <tbody id="vehicleReportBody"></tbody>
        </table>
      </div>
      <div id="vehicleReportPagination"></div>
    </div>
  `;

  const vehicleTableEl = document.getElementById('vehicleReportBody').closest('table');

  function vehicleRowHtml(v) {
    return `
              <tr>
                <td data-label="Vehicle" class="font-bold">${v.vehicle}</td>
                <td data-label="Deliveries">${v.deliveries}</td>
                <td data-label="Total Value" class="font-bold text-success">${cur}${v.totalValue.toFixed(2)}</td>
                <td data-label="Avg / Delivery">${cur}${(v.totalValue / v.deliveries).toFixed(2)}</td>
                <td><button class="btn btn-ghost btn-sm vehicle-view-btn" data-vehicle="${v.vehicle}"><i class="fa-solid fa-eye"></i> View Orders</button></td>
              </tr>
            `;
  }

  function renderVehicleRows() {
    const { pageItems, page, totalPages } = paginate(vehicles, vehicleReportPage, REPORT_PAGE_SIZE);
    vehicleReportPage = page;
    const tbody = document.getElementById('vehicleReportBody');
    tbody.innerHTML = pageItems.length === 0 ? `<tr><td colspan="5" style="text-align:center;padding:40px;opacity:0.5">No deliveries with a vehicle recorded in this range. Vehicle number is entered as an optional field at checkout.</td></tr>` :
      pageItems.map(vehicleRowHtml).join('');

    tbody.querySelectorAll('.vehicle-view-btn').forEach(btn => {
      btn.onclick = () => {
        const v = vehicles.find(x => x.vehicle === btn.dataset.vehicle);
        if (!v) return;
        const sortedOrders = v.orders.sort((a, b) => new Date(b.date) - new Date(a.date));
        let modalPage = 1;
        function renderVehicleModal() {
          const res = paginate(sortedOrders, modalPage, REPORT_PAGE_SIZE);
          modalPage = res.page;
          openModal({
            title: `Deliveries by ${v.vehicle}`,
            body: `
              <div class="table-wrap">
                <table class="responsive-table">
                  <thead><tr><th>Order #</th><th>Date</th><th>Total</th></tr></thead>
                  <tbody>
                    ${res.pageItems.map(o => `
                      <tr>
                        <td data-label="Order #">${o.dailyNumber ? '#' + o.dailyNumber : o.id}</td>
                        <td data-label="Date">${o.date ? new Date(o.date).toLocaleString() : 'N/A'}</td>
                        <td data-label="Total" class="font-bold text-success">${cur}${o.total.toFixed(2)}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
              <div id="vehicleModalPagination"></div>
            `,
            footer: `<button class="btn btn-primary" onclick="closeModal()">Close</button>`
          });
          renderPaginationBar(document.getElementById('vehicleModalPagination'), {
            page: res.page, totalPages: res.totalPages, onChange: (p) => { modalPage = p; renderVehicleModal(); }
          });
        }
        renderVehicleModal();
      };
    });

    renderPaginationBar(document.getElementById('vehicleReportPagination'), {
      page, totalPages, onChange: (p) => { vehicleReportPage = p; renderVehicleRows(); }
    });
  }

  renderVehicleRows();
  wireTableExport('vehicles', vehicleTableEl, 'Vehicle-wise Delivery Report', () => vehicles.map(vehicleRowHtml).join(''));
}

async function renderOutstandingReport(container, cur) {
  // Purchase side: money the shop owes suppliers
  const suppliers = await getSupplierOutstandingReport(currentBranchFilter, currentStartDate, currentEndDate);
  const totalPurchaseOutstanding = suppliers.reduce((s, x) => s + x.outstanding, 0);

  // Sales side: money owed TO the shop from customer credit sales (formerly the separate
  // "Credit Hub" tab — merged here so both directions of "outstanding" live in one place)
  const ordersRaw = await getOrders(currentBranchFilter, currentStartDate, currentEndDate);
  const creditOrders = ordersRaw.filter(o => o.isCredit);
  const creditMap = {};
  creditOrders.forEach(o => {
    const cid = o.customer?.id || 'unknown';
    if (!creditMap[cid]) {
      creditMap[cid] = { name: o.customer?.name || 'Unknown Customer', phone: o.customer?.phone || 'N/A', totalOutstanding: 0, orderCount: 0, lastOrderDate: o.date, orders: [] };
    }
    const paid = (o.payments || []).reduce((s, p) => s + p.amount, 0);
    const balance = o.total - paid;
    creditMap[cid].totalOutstanding += balance;
    creditMap[cid].orderCount++;
    creditMap[cid].orders.push({ id: o.id, dailyNumber: o.dailyNumber, date: o.date, total: o.total, balance });
    if (new Date(o.date) > new Date(creditMap[cid].lastOrderDate)) creditMap[cid].lastOrderDate = o.date;
  });
  const customers = Object.values(creditMap).sort((a, b) => b.totalOutstanding - a.totalOutstanding);
  const totalSalesOutstanding = customers.reduce((s, c) => s + c.totalOutstanding, 0);

  outstandingSalesPage = 1;
  outstandingPurchasePage = 1;
  const canExportOut = await hasPermission('reports:export');

  container.innerHTML = `
    <div class="grid-2 mb-24">
      <div class="stat-card" style="border-left:4px solid var(--warning)">
        <div class="stat-info">
          <div class="stat-label">Sales Outstanding (owed TO you by customers)</div>
          <div class="stat-value" style="font-size:32px; color:var(--warning)">${cur}${totalSalesOutstanding.toFixed(2)}</div>
        </div>
      </div>
      <div class="stat-card" style="border-left:4px solid var(--danger)">
        <div class="stat-info">
          <div class="stat-label">Purchase Outstanding (owed BY you to suppliers)</div>
          <div class="stat-value text-danger" style="font-size:32px">${cur}${totalPurchaseOutstanding.toFixed(2)}</div>
        </div>
      </div>
    </div>

    <div class="card mb-16">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div class="font-bold"><i class="fa-solid fa-hand-holding-hand mr-8" style="color:var(--warning)"></i> Sales Outstanding — by Customer</div>
        ${canExportOut ? tableExportButtonsHtml('outstanding-sales') : ''}
      </div>
      <div class="table-wrap">
        <table class="responsive-table">
          <thead><tr><th>Customer</th><th>Pending Orders</th><th>Last Activity</th><th>Outstanding Balance</th><th>Actions</th></tr></thead>
          <tbody id="outstandingSalesBody"></tbody>
        </table>
      </div>
      <div id="outstandingSalesPagination"></div>
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div class="font-bold"><i class="fa-solid fa-truck-ramp-box mr-8 text-danger"></i> Purchase Outstanding — by Supplier</div>
        ${canExportOut ? tableExportButtonsHtml('outstanding-purchase') : ''}
      </div>
      <div class="table-wrap">
        <table class="responsive-table">
          <thead><tr><th>Supplier</th><th>Purchases</th><th>Total Purchased</th><th>Paid</th><th>Outstanding</th><th>Actions</th></tr></thead>
          <tbody id="outstandingPurchaseBody"></tbody>
        </table>
      </div>
      <div id="outstandingPurchasePagination"></div>
    </div>
  `;

  const outstandingSalesTableEl = document.getElementById('outstandingSalesBody').closest('table');
  const outstandingPurchaseTableEl = document.getElementById('outstandingPurchaseBody').closest('table');

  function salesOutstandingRowHtml(c) {
    return `
                <tr>
                  <td data-label="Customer">
                    <div style="text-align:left">
                      <div class="font-bold">${c.name}</div>
                      <div style="font-size:11px;opacity:0.6">${c.phone}</div>
                    </div>
                  </td>
                  <td data-label="Orders"><span class="badge badge-info">${c.orderCount} Orders</span></td>
                  <td data-label="Last Activity" style="font-size:12px">${new Date(c.lastOrderDate).toLocaleDateString()}</td>
                  <td data-label="Balance" class="font-bold" style="font-size:16px; color:var(--warning)">${cur}${c.totalOutstanding.toFixed(2)}</td>
                  <td><button class="btn btn-ghost btn-sm sales-outstanding-view-btn" data-customer="${c.name}"><i class="fa-solid fa-eye"></i> View Orders</button></td>
                </tr>
              `;
  }

  function renderSalesOutstandingRows() {
    const { pageItems, page, totalPages } = paginate(customers, outstandingSalesPage, REPORT_PAGE_SIZE);
    outstandingSalesPage = page;
    const tbody = document.getElementById('outstandingSalesBody');
    tbody.innerHTML = pageItems.length === 0 ? '<tr><td colspan="5" style="text-align:center;padding:40px;opacity:0.5">No outstanding customer credit found. Great! 💎</td></tr>' :
      pageItems.map(salesOutstandingRowHtml).join('');

    tbody.querySelectorAll('.sales-outstanding-view-btn').forEach(btn => {
      btn.onclick = () => {
        const c = customers.find(x => x.name === btn.dataset.customer);
        if (!c) return;
        const sortedOrders = c.orders.sort((a, b) => new Date(b.date) - new Date(a.date));
        let modalPage = 1;
        function renderOrdersModal() {
          const res = paginate(sortedOrders, modalPage, REPORT_PAGE_SIZE);
          modalPage = res.page;
          openModal({
            title: `Outstanding Orders — ${c.name}`,
            body: `
              <div class="table-wrap">
                <table class="responsive-table">
                  <thead><tr><th>Order #</th><th>Date</th><th>Total</th><th>Balance</th></tr></thead>
                  <tbody>
                    ${res.pageItems.map(o => `
                      <tr>
                        <td data-label="Order #">${o.dailyNumber ? '#' + o.dailyNumber : o.id}</td>
                        <td data-label="Date">${o.date ? new Date(o.date).toLocaleDateString() : 'N/A'}</td>
                        <td data-label="Total">${cur}${o.total.toFixed(2)}</td>
                        <td data-label="Balance" class="font-bold" style="color:var(--warning)">${cur}${o.balance.toFixed(2)}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
              <div id="outstandingOrdersModalPagination"></div>
            `,
            footer: `<button class="btn btn-primary" onclick="closeModal()">Close</button>`
          });
          renderPaginationBar(document.getElementById('outstandingOrdersModalPagination'), {
            page: res.page, totalPages: res.totalPages, onChange: (p) => { modalPage = p; renderOrdersModal(); }
          });
        }
        renderOrdersModal();
      };
    });

    renderPaginationBar(document.getElementById('outstandingSalesPagination'), {
      page, totalPages, onChange: (p) => { outstandingSalesPage = p; renderSalesOutstandingRows(); }
    });
  }

  function purchaseOutstandingRowHtml(s) {
    return `
              <tr>
                <td data-label="Supplier" class="font-bold">${s.supplierName}</td>
                <td data-label="Purchases"><span class="badge badge-info">${s.purchaseCount} Purchases</span></td>
                <td data-label="Total Purchased">${cur}${s.totalPurchased.toFixed(2)}</td>
                <td data-label="Paid" class="text-success">${cur}${s.totalPaid.toFixed(2)}</td>
                <td data-label="Outstanding" class="font-bold text-danger" style="font-size:16px">${cur}${s.outstanding.toFixed(2)}</td>
                <td><button class="btn btn-ghost btn-sm outstanding-view-btn" data-supplier="${s.supplierName}"><i class="fa-solid fa-eye"></i> View Purchases</button></td>
              </tr>
            `;
  }

  function renderPurchaseOutstandingRows() {
    const { pageItems, page, totalPages } = paginate(suppliers, outstandingPurchasePage, REPORT_PAGE_SIZE);
    outstandingPurchasePage = page;
    const tbody = document.getElementById('outstandingPurchaseBody');
    tbody.innerHTML = pageItems.length === 0 ? `<tr><td colspan="6" style="text-align:center;padding:40px;opacity:0.5">No outstanding supplier balances in this range. Nice! \u{1F4B0}</td></tr>` :
      pageItems.map(purchaseOutstandingRowHtml).join('');

    tbody.querySelectorAll('.outstanding-view-btn').forEach(btn => {
      btn.onclick = () => {
        const s = suppliers.find(x => x.supplierName === btn.dataset.supplier);
        if (!s) return;
        const sortedPurchases = s.purchases.sort((a, b) => new Date(b.date) - new Date(a.date));
        let modalPage = 1;
        function renderPurchasesModal() {
          const res = paginate(sortedPurchases, modalPage, REPORT_PAGE_SIZE);
          modalPage = res.page;
          openModal({
            title: `Outstanding Purchases — ${s.supplierName}`,
            body: `
              <div class="table-wrap">
                <table class="responsive-table">
                  <thead><tr><th>Invoice #</th><th>Date</th><th>Total</th><th>Paid</th><th>Outstanding</th></tr></thead>
                  <tbody>
                    ${res.pageItems.map(p => `
                      <tr>
                        <td data-label="Invoice #" class="font-mono">${p.supplierInvoiceNo || p.id}</td>
                        <td data-label="Date">${p.date ? new Date(p.date).toLocaleDateString() : 'N/A'}</td>
                        <td data-label="Total">${cur}${p.total.toFixed(2)}</td>
                        <td data-label="Paid" class="text-success">${cur}${p.amountPaid.toFixed(2)}</td>
                        <td data-label="Outstanding" class="font-bold text-danger">${cur}${p.outstanding.toFixed(2)}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
              <div id="outstandingPurchasesModalPagination"></div>
            `,
            footer: `<button class="btn btn-primary" onclick="closeModal()">Close</button>`
          });
          renderPaginationBar(document.getElementById('outstandingPurchasesModalPagination'), {
            page: res.page, totalPages: res.totalPages, onChange: (p) => { modalPage = p; renderPurchasesModal(); }
          });
        }
        renderPurchasesModal();
      };
    });

    renderPaginationBar(document.getElementById('outstandingPurchasePagination'), {
      page, totalPages, onChange: (p) => { outstandingPurchasePage = p; renderPurchaseOutstandingRows(); }
    });
  }

  renderSalesOutstandingRows();
  renderPurchaseOutstandingRows();
  wireTableExport('outstanding-sales', outstandingSalesTableEl, 'Sales Outstanding by Customer', () => customers.map(salesOutstandingRowHtml).join(''));
  wireTableExport('outstanding-purchase', outstandingPurchaseTableEl, 'Purchase Outstanding by Supplier', () => suppliers.map(purchaseOutstandingRowHtml).join(''));
}

async function openPurchaseReturnModal(purchase, cur) {
  const returns = await getReturns();
  const allReturns = returns.filter(r => r.purchaseId === purchase.id);
  const returnedQtyMap = {};
  allReturns.forEach(r => {
    r.items.forEach(item => {
      returnedQtyMap[item.id] = (returnedQtyMap[item.id] || 0) + item.qty;
    });
  });

  let returnedItems = (purchase.items || []).map(item => {
    const alreadyReturned = returnedQtyMap[item.id] || 0;
    return { ...item, returnQty: 0, availableQty: item.qty - alreadyReturned, alreadyReturned };
  });

  if (returnedItems.length === 0) {
    const alreadyReturned = returnedQtyMap[purchase.id] || 0;
    returnedItems = [{ name: 'Adjustment/Full Return', id: purchase.id, price: purchase.total, qty: 1, returnQty: 0, availableQty: 1 - alreadyReturned, alreadyReturned }];
  }

  let refundMethod = 'Cash';

  function renderRows() {
    return returnedItems.map((item, idx) => `
      <div class="payment-row" style="margin-bottom:12px; display:flex; align-items:center; gap:12px; background:var(--bg-elevated); padding:12px; border-radius:8px ${item.availableQty <= 0 ? 'opacity:0.5' : ''}">
        <div style="flex:1">
          <div class="font-bold">${item.emoji || '📦'} ${item.name}</div>
          <div style="font-size:11px; opacity:0.6">
            Original: ${item.qty} | 
            <span class="text-danger">Returned: ${item.alreadyReturned}</span> | 
            <span class="text-success">Available: ${item.availableQty}</span>
          </div>
        </div>
        <div style="width:120px">
          <input type="number" class="form-input return-qty-input" data-idx="${idx}" 
            value="${item.returnQty}" min="0" max="${item.availableQty}" 
            ${item.availableQty <= 0 ? 'disabled' : ''} />
        </div>
      </div>
    `).join('');
  }

  function updateModal() {
    const totalReturn = returnedItems.reduce((sum, item) => sum + (item.returnQty * (item.price || item.cost || 0)), 0);
    const body = `
      <div style="padding:10px">
        <div class="mb-16 text-muted" style="font-size:13px">Select quantities to return to supplier. Stock will be automatically deducted.</div>
        <div id="returnItemsContainer">${renderRows()}</div>

        <div style="background:var(--bg-elevated); padding:12px; border-radius:8px; margin-top:16px; border:1px dashed var(--border)">
          <div style="font-size:11px; font-weight:bold; color:var(--text-muted); text-transform:uppercase; margin-bottom:8px">Original Purchase Payment</div>
          <div style="display:flex; justify-content:space-between; font-size:13px">
            <span>Method</span>
            <span class="font-bold">${cur}${purchase.total.toFixed(2)}</span>
          </div>
        </div>

        <div class="grid-2 mt-16">
          <div class="form-group">
            <label class="form-label">Return Method (Adjustment)</label>
            <select class="form-select" id="purchaseRefundMethodSelect">
              <option value="Cash" ${refundMethod === 'Cash' ? 'selected' : ''}>Cash</option>
              <option value="Card" ${refundMethod === 'Card' ? 'selected' : ''}>Card</option>
              <option value="UPI" ${refundMethod === 'UPI' ? 'selected' : ''}>UPI</option>
              <option value="Credit" ${refundMethod === 'Credit' ? 'selected' : ''}>Supplier Credit</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Return Reason / Note</label>
            <input type="text" class="form-input" id="returnReason" placeholder="e.g. Expired, Wrong item" />
          </div>
        </div>

        <div class="mt-20 p-16" style="background:rgba(239,68,68,0.05); border-radius:12px; border:1px solid rgba(239,68,68,0.1)">
          <div style="display:flex; justify-content:space-between; align-items:center">
            <span class="font-bold">Total Return Value</span>
            <span class="font-bold text-danger" style="font-size:20px">${cur}${totalReturn.toFixed(2)}</span>
          </div>
        </div>
      </div>
    `;

    import('../components/Modal.js').then(Modal => {
      Modal.openModal({
        title: `Purchase Return - ${purchase.id}`,
        body: body,
        footer: `
          <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
          <button class="btn btn-danger" id="confirmPurchaseReturnBtn">Confirm Return to Supplier</button>
        `
      });

      setTimeout(() => {
        document.querySelectorAll('.return-qty-input').forEach(input => {
          input.oninput = (e) => {
            const idx = e.target.dataset.idx;
            const val = parseInt(e.target.value) || 0;
            const max = parseInt(e.target.max);
            returnedItems[idx].returnQty = Math.min(val, max);
            const totalReturn = returnedItems.reduce((sum, item) => sum + (item.returnQty * (item.price || item.cost || 0)), 0);
            const totalEl = document.querySelector('.text-danger[style*="font-size:20px"]');
            if (totalEl) totalEl.innerText = `${cur}${totalReturn.toFixed(2)}`;
          };
        });

        document.getElementById('purchaseRefundMethodSelect').onchange = (e) => {
          refundMethod = e.target.value;
        };

        document.getElementById('confirmPurchaseReturnBtn').onclick = async () => {
          const itemsToReturn = returnedItems.filter(i => i.returnQty > 0).map(i => ({
            ...i,
            qty: i.returnQty
          }));

          if (itemsToReturn.length === 0) {
            showToast('Please select at least one item to return.', 'warning');
            return;
          }

          const totalReturn = itemsToReturn.reduce((sum, item) => sum + (item.qty * (item.price || item.cost || 0)), 0);
          const reason = document.getElementById('returnReason').value || 'Not specified';

          const db = await import('../db.js');
          await db.saveReturn({
            purchaseId: purchase.id,
            type: 'purchase',
            items: itemsToReturn,
            total: totalReturn,
            reason: reason,
            branchId: purchase.branchId,
            supplierName: purchase.supplierName,
            supplierId: purchase.supplierId,
            refundMethod: refundMethod
          });
          Modal.closeModal();
          showToast('Purchase return processed successfully!', 'success');
          await renderPurchaseReport(container, cur);
        };
      }, 0);
    });
  }
}

async function renderCustomerReport(container, cur) {
  const customers = await getCustomers(currentBranchFilter);
  const orders = await getOrders(currentBranchFilter, currentStartDate, currentEndDate);

  // Calculate analytics
  const processed = customers.map(c => {
    const custOrders = orders.filter(o => o.customer?.id === c.id && o.status !== 'cancelled');
    
    // Simple Tiering Logic
    let tier = { name: 'Bronze', color: '#cd7f32', icon: 'fa-award' };
    const spent = custOrders.reduce((s, o) => s + (o.total || 0), 0);
    if (spent > 50000) tier = { name: 'Platinum', color: '#e5e4e2', icon: 'fa-crown' };
    else if (spent > 10000) tier = { name: 'Gold', color: '#ffd700', icon: 'fa-medal' };
    else if (spent > 2000) tier = { name: 'Silver', color: '#c0c0c0', icon: 'fa-certificate' };

    return {
      ...c,
      tier,
      orderCount: custOrders.length,
      totalSpent: spent
    };
  }).sort((a, b) => b.totalSpent - a.totalSpent);

  customerReportPage = 1;
  const canExportCust = await hasPermission('reports:export');

  container.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div class="font-bold">Customer Activity & Loyalty Report</div>
        ${canExportCust ? tableExportButtonsHtml('customers') : ''}
      </div>
      <div class="table-wrap">
        <table class="responsive-table">
          <thead><tr><th>Customer</th><th>Phone</th><th>Orders</th><th>Total Spent</th><th>Loyalty Points</th></tr></thead>
          <tbody id="customerReportBody"></tbody>
        </table>
      </div>
      <div id="customerReportPagination"></div>
    </div>
  `;

  function customerRowHtml(c) {
    return `
              <tr>
                <td data-label="Customer">
                  <div style="text-align:left">
                    <div class="font-bold">${c.name}</div>
                    <div style="font-size:10px;margin-top:2px">
                      <span style="background:${c.tier.color}20;color:${c.tier.color};padding:1px 6px;border-radius:10px;border:1px solid ${c.tier.color}40;text-transform:uppercase;font-weight:700;font-size:9px">
                        <i class="fa-solid ${c.tier.icon}"></i> ${c.tier.name}
                      </span>
                    </div>
                    <div style="font-size:11px;color:var(--text-muted);margin-top:2px">ID: ${c.id}</div>
                  </div>
                </td>
                <td data-label="Phone">${c.phone}</td>
                <td data-label="Orders">${c.orderCount}</td>
                <td data-label="Total Spent" class="font-bold text-accent">${cur}${c.totalSpent.toFixed(2)}</td>
                <td data-label="Loyalty Points" class="font-bold text-success">${c.loyaltyPoints || 0} Pts</td>
              </tr>
            `;
  }

  const customerTableEl = container.querySelector('table.responsive-table');

  function renderCustomerRows() {
    const { pageItems, page, totalPages } = paginate(processed, customerReportPage, REPORT_PAGE_SIZE);
    customerReportPage = page;
    document.getElementById('customerReportBody').innerHTML = pageItems.map(customerRowHtml).join('');

    renderPaginationBar(document.getElementById('customerReportPagination'), {
      page, totalPages, onChange: (p) => { customerReportPage = p; renderCustomerRows(); }
    });
  }

  renderCustomerRows();
  wireTableExport('customers', customerTableEl, 'Customer Activity & Loyalty Report', () => processed.map(customerRowHtml).join(''));
}

async function renderSupplierReport(container, cur) {
  const suppliers = await getSuppliers(currentBranchFilter);
  const purchases = await getPurchases(currentBranchFilter, currentStartDate, currentEndDate);

  const processed = suppliers.map(s => {
    const supPurchases = purchases.filter(p => p.supplierId === s.id);
    return {
      ...s,
      orderCount: supPurchases.length,
      totalSpend: supPurchases.reduce((sum, p) => sum + p.total, 0)
    };
  }).sort((a, b) => b.totalSpend - a.totalSpend);

  supplierReportPage = 1;
  const canExportSup = await hasPermission('reports:export');

  container.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div class="font-bold">Supplier Procurement Analysis</div>
        ${canExportSup ? tableExportButtonsHtml('suppliers') : ''}
      </div>
      <div class="table-wrap">
        <table class="responsive-table">
          <thead><tr><th>Supplier</th><th>Contact</th><th>Orders</th><th>Total Spending</th></tr></thead>
          <tbody id="supplierReportBody"></tbody>
        </table>
      </div>
      <div id="supplierReportPagination"></div>
    </div>
  `;

  function supplierRowHtml(s) {
    return `
              <tr>
                <td data-label="Supplier">
                  <div style="text-align:left">
                    <div class="font-bold">${s.name}</div>
                    <div style="font-size:11px;color:var(--text-muted)">ID: ${s.id}</div>
                  </div>
                </td>
                <td data-label="Contact">${s.contact}</td>
                <td data-label="Orders">${s.orderCount}</td>
                <td data-label="Total Spending" class="text-danger font-bold">${cur}${s.totalSpend.toFixed(2)}</td>
              </tr>
            `;
  }

  const supplierTableEl = container.querySelector('table.responsive-table');

  function renderSupplierRows() {
    const { pageItems, page, totalPages } = paginate(processed, supplierReportPage, REPORT_PAGE_SIZE);
    supplierReportPage = page;
    document.getElementById('supplierReportBody').innerHTML = pageItems.map(supplierRowHtml).join('');

    renderPaginationBar(document.getElementById('supplierReportPagination'), {
      page, totalPages, onChange: (p) => { supplierReportPage = p; renderSupplierRows(); }
    });
  }

  renderSupplierRows();
  wireTableExport('suppliers', supplierTableEl, 'Supplier Procurement Analysis', () => processed.map(supplierRowHtml).join(''));
}

// Per-item net taxable value + tax, honoring item-level discount and
// inclusive/exclusive tax type — same math already used by exportGSTR1Json's
// HSN aggregation below, extracted so the on-screen HSN/rate-wise summaries
// use the exact same numbers as the JSON export, not a second guess at it.
function computeSalesItemTax(item) {
  const itemTax = item.finalTax || 0;
  const lineTotal = item.price * item.qty;
  const discountTotal = item.itemDiscountType === 'pct'
    ? (lineTotal * (item.itemDiscount || 0) / 100)
    : ((item.itemDiscount || 0) * item.qty);
  const discountedTotal = Math.max(0, lineTotal - discountTotal);
  let taxValueNet = discountedTotal;
  if (item.taxType === 'inclusive') {
    taxValueNet = discountedTotal - itemTax;
  }
  return { taxValueNet, itemTax };
}

// GSTR-1's "HSN-wise summary" (Table 12) — every sold line item bucketed by
// its own HSN code, since a single order can mix multiple HSN codes/rates.
function computeHsnWiseSummary(orders) {
  const map = {};
  orders.forEach(o => {
    (o.items || []).forEach(item => {
      const code = item.hsnCode || 'N/A';
      const rate = item.taxRate || 0;
      const key = `${code}__${rate}`;
      if (!map[key]) map[key] = { hsnCode: code, desc: item.name, rate, qty: 0, taxable: 0, tax: 0 };
      const { taxValueNet, itemTax } = computeSalesItemTax(item);
      map[key].qty += item.qty;
      map[key].taxable += taxValueNet;
      map[key].tax += itemTax;
    });
  });
  return Object.values(map).sort((a, b) => a.hsnCode.localeCompare(b.hsnCode));
}

// GSTR-3B's "rate-wise summary" (Table 3.1) — consolidated by tax slab
// (5%/12%/18%/28%) regardless of HSN, which is what's actually filed there.
function computeRateWiseSummary(orders) {
  const map = {};
  orders.forEach(o => {
    (o.items || []).forEach(item => {
      const rate = item.taxRate || 0;
      if (!map[rate]) map[rate] = { rate, taxable: 0, tax: 0 };
      const { taxValueNet, itemTax } = computeSalesItemTax(item);
      map[rate].taxable += taxValueNet;
      map[rate].tax += itemTax;
    });
  });
  return Object.values(map).sort((a, b) => a.rate - b.rate);
}

// Purchases aren't itemized with per-line HSN/rate in this app (one taxRate
// per purchase order), so input-side detail can only go down to rate-wise,
// not HSN-wise — still exactly what's needed for ITC reconciliation by slab.
function computePurchaseRateWiseSummary(purchases) {
  const map = {};
  purchases.forEach(p => {
    const rate = p.taxRate || 0;
    if (!map[rate]) map[rate] = { rate, taxable: 0, tax: 0, count: 0 };
    map[rate].taxable += (p.subtotal || p.total || 0);
    map[rate].tax += (p.taxAmount || 0);
    map[rate].count += 1;
  });
  return Object.values(map).sort((a, b) => a.rate - b.rate);
}

async function renderGSTReport(container, cur) {
  const orders = (await getOrders(currentBranchFilter, currentStartDate, currentEndDate)).filter(o => o.status !== 'cancelled');
  const purchases = await getPurchases(currentBranchFilter, currentStartDate, currentEndDate);

  const outputGST = orders.reduce((sum, o) => sum + (o.tax || 0), 0);
  const inputGST = purchases.reduce((sum, p) => sum + (p.taxAmount || 0), 0);
  const outputTaxable = orders.reduce((sum, o) => sum + (o.subtotal || 0), 0);
  const inputTaxable = purchases.reduce((sum, p) => sum + (p.subtotal || p.total || 0), 0);
  const netPayable = outputGST - inputGST;
  const canExportGst = await hasPermission('reports:export');
  const settings = await getSettings();
  const periodLabel = `${new Date(currentStartDate).toLocaleDateString('en-GB')} to ${new Date(currentEndDate).toLocaleDateString('en-GB')}`;

  const hsnSummary = computeHsnWiseSummary(orders);
  const rateSummarySales = computeRateWiseSummary(orders);
  const rateSummaryPurchases = computePurchaseRateWiseSummary(purchases);

  container.innerHTML = `
    <!-- Net Summary Card -->
    <div class="stat-card mb-24" style="border-left:4px solid ${netPayable >= 0 ? 'var(--success)' : 'var(--danger)'}; padding:16px 24px">
      <div style="display:flex;justify-content:space-between;align-items:center;width:100%">
        <div>
          <div class="stat-label" style="font-size:11px;margin:0">${netPayable >= 0 ? 'Net GST Payable to Govt' : 'Excess Input Tax Credit'}</div>
          <div class="stat-value" style="font-size:32px;color:${netPayable >= 0 ? 'var(--success)' : 'var(--danger)'}">
            ${cur}${Math.abs(netPayable).toLocaleString()}
          </div>
        </div>
        <div style="text-align:right">
          <div style="font-size:12px;opacity:0.6">Output: ${cur}${outputGST.toLocaleString()}</div>
          <div style="font-size:12px;opacity:0.6">Input: ${cur}${inputGST.toLocaleString()}</div>
        </div>
      </div>
    </div>

    <!-- GST Summary (auditor hand-off sheet) -->
    <div class="card mb-24">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div>
          <div class="font-bold" style="font-size:16px"><i class="fa-solid fa-file-invoice mr-8 text-accent"></i> GST Summary</div>
          <p style="font-size:11px;color:var(--text-muted);margin-top:4px">One-page summary for your auditor — period: ${periodLabel}.</p>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          ${canExportGst ? tableExportButtonsHtml('gst-summary') : ''}
        </div>
      </div>
      <div class="table-wrap">
        <table class="responsive-table" id="gstSummaryTable">
          <thead><tr><th>Particulars</th><th>Amount</th></tr></thead>
          <tbody>
            <tr><td data-label="Particulars">Period</td><td data-label="Amount">${periodLabel}</td></tr>
            <tr><td data-label="Particulars">GSTIN</td><td data-label="Amount">${settings.gstNumber || 'Not Provided'}</td></tr>
            <tr><td data-label="Particulars">Total Taxable Value — Outward Supplies (Sales)</td><td data-label="Amount">${cur}${outputTaxable.toFixed(2)}</td></tr>
            <tr><td data-label="Particulars">Total Output GST (Tax Collected on Sales)</td><td data-label="Amount" class="font-bold text-accent">${cur}${outputGST.toFixed(2)}</td></tr>
            <tr><td data-label="Particulars">Total Taxable Value — Inward Supplies (Purchases)</td><td data-label="Amount">${cur}${inputTaxable.toFixed(2)}</td></tr>
            <tr><td data-label="Particulars">Total Input GST (Input Tax Credit)</td><td data-label="Amount" class="font-bold text-info">${cur}${inputGST.toFixed(2)}</td></tr>
            <tr><td data-label="Particulars" class="font-bold">${netPayable >= 0 ? 'Net GST Payable to Govt' : 'Excess Input Tax Credit (c/f)'}</td><td data-label="Amount" class="font-bold" style="color:${netPayable >= 0 ? 'var(--success)' : 'var(--danger)'}">${cur}${Math.abs(netPayable).toFixed(2)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- HSN-wise Summary (Sales) — GSTR-1 Table 12 style -->
    <div class="card mb-24">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div>
          <div class="font-bold" style="font-size:16px"><i class="fa-solid fa-barcode mr-8 text-accent"></i> HSN-wise Summary (Sales)</div>
          <p style="font-size:11px;color:var(--text-muted);margin-top:4px">Every sold item bucketed by HSN code — matches GSTR-1's HSN summary table.</p>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          ${canExportGst ? tableExportButtonsHtml('gst-hsn-summary') : ''}
        </div>
      </div>
      <div class="table-wrap">
        <table class="responsive-table" id="gstHsnSummaryTable">
          <thead><tr><th>HSN Code</th><th>Description</th><th>Qty</th><th>Taxable Value</th><th>Rate</th><th>CGST</th><th>SGST</th><th>Total Tax</th></tr></thead>
          <tbody>
            ${hsnSummary.length === 0 ? '<tr><td colspan="8" style="text-align:center;padding:20px;opacity:0.5">No sales recorded</td></tr>' : hsnSummary.map(h => `
              <tr>
                <td data-label="HSN Code" class="font-mono">${h.hsnCode}</td>
                <td data-label="Description">${h.desc || ''}</td>
                <td data-label="Qty">${h.qty}</td>
                <td data-label="Taxable Value">${cur}${h.taxable.toFixed(2)}</td>
                <td data-label="Rate">${h.rate}%</td>
                <td data-label="CGST">${cur}${(h.tax / 2).toFixed(2)}</td>
                <td data-label="SGST">${cur}${(h.tax / 2).toFixed(2)}</td>
                <td data-label="Total Tax" class="font-bold text-accent">${cur}${h.tax.toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Rate-wise Tax Summary (Sales) — GSTR-3B Table 3.1 style -->
    <div class="card mb-24">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div>
          <div class="font-bold" style="font-size:16px"><i class="fa-solid fa-percent mr-8 text-accent"></i> Rate-wise Tax Summary (Sales)</div>
          <p style="font-size:11px;color:var(--text-muted);margin-top:4px">Consolidated by tax slab — matches GSTR-3B's outward tax liability table.</p>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          ${canExportGst ? tableExportButtonsHtml('gst-rate-summary-sales') : ''}
        </div>
      </div>
      <div class="table-wrap">
        <table class="responsive-table" id="gstRateSummarySalesTable">
          <thead><tr><th>Tax Rate</th><th>Taxable Value</th><th>CGST</th><th>SGST</th><th>Total Tax</th></tr></thead>
          <tbody>
            ${rateSummarySales.length === 0 ? '<tr><td colspan="5" style="text-align:center;padding:20px;opacity:0.5">No sales recorded</td></tr>' : rateSummarySales.map(r => `
              <tr>
                <td data-label="Tax Rate">${r.rate}%</td>
                <td data-label="Taxable Value">${cur}${r.taxable.toFixed(2)}</td>
                <td data-label="CGST">${cur}${(r.tax / 2).toFixed(2)}</td>
                <td data-label="SGST">${cur}${(r.tax / 2).toFixed(2)}</td>
                <td data-label="Total Tax" class="font-bold text-accent">${cur}${r.tax.toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Rate-wise Tax Summary (Purchases) — for ITC reconciliation by slab -->
    <div class="card mb-24">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div>
          <div class="font-bold" style="font-size:16px"><i class="fa-solid fa-percent mr-8 text-info"></i> Rate-wise Tax Summary (Purchases)</div>
          <p style="font-size:11px;color:var(--text-muted);margin-top:4px">Consolidated by tax slab for Input Tax Credit reconciliation.</p>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          ${canExportGst ? tableExportButtonsHtml('gst-rate-summary-purchases') : ''}
        </div>
      </div>
      <div class="table-wrap">
        <table class="responsive-table" id="gstRateSummaryPurchasesTable">
          <thead><tr><th>Tax Rate</th><th>Taxable Value</th><th>CGST</th><th>SGST</th><th>Total Tax</th><th>No. of Purchases</th></tr></thead>
          <tbody>
            ${rateSummaryPurchases.length === 0 ? '<tr><td colspan="6" style="text-align:center;padding:20px;opacity:0.5">No purchases recorded</td></tr>' : rateSummaryPurchases.map(r => `
              <tr>
                <td data-label="Tax Rate">${r.rate}%</td>
                <td data-label="Taxable Value">${cur}${r.taxable.toFixed(2)}</td>
                <td data-label="CGST">${cur}${(r.tax / 2).toFixed(2)}</td>
                <td data-label="SGST">${cur}${(r.tax / 2).toFixed(2)}</td>
                <td data-label="Total Tax" class="font-bold text-info">${cur}${r.tax.toFixed(2)}</td>
                <td data-label="No. of Purchases">${r.count}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Sales GST Section (Output) -->
    <div class="card mb-24">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div class="font-bold" style="font-size:16px"><i class="fa-solid fa-arrow-up-right-from-square mr-8 text-accent"></i> Output GST (Sales) — Invoice-wise Detail</div>
        <div style="display:flex;align-items:center;gap:8px">
          ${canExportGst ? tableExportButtonsHtml('gst-output') : ''}
          ${canExportGst ? `
            <button class="btn btn-primary btn-sm" id="exportTaxInvoicesBtn" title="One formatted tax invoice per sale, for handing to your auditor">
              <i class="fa-solid fa-file-invoice-dollar"></i> Export Tax Invoices (PDF)
            </button>
          ` : ''}
          <!-- GSTR-1 JSON button hidden for now, per user request 2026-07-27 -->
          ${false && canExportGst ? `
            <button class="btn btn-primary btn-sm" id="exportSalesGstBtn">
              <i class="fa-solid fa-download"></i> GSTR-1 JSON (Sales)
            </button>
          ` : ''}
        </div>
      </div>

      <div class="table-wrap">
        <table class="responsive-table">
          <thead><tr><th>Date</th><th>Customer</th><th>Invoice ID</th><th>Taxable Amt</th><th>CGST</th><th>SGST</th><th>Total GST</th></tr></thead>
          <tbody id="gstOutputBody"></tbody>
        </table>
      </div>
      <div id="gstOutputPagination"></div>
    </div>

    <!-- Purchase GST Section (Input) -->
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div>
          <div class="font-bold" style="font-size:16px"><i class="fa-solid fa-arrow-down-left-and-arrow-up-right-to-center mr-8 text-info"></i> Input GST (Purchases) — Invoice-wise Detail</div>
          <p style="font-size:11px;color:var(--text-muted);margin-top:4px">For GSTR-2B reconciliation and Input Tax Credit audit.</p>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          ${canExportGst ? tableExportButtonsHtml('gst-input') : ''}
          <!-- GSTR-2B Register JSON button hidden for now, per user request 2026-07-27 -->
          ${false && canExportGst ? `
            <button class="btn btn-ghost btn-sm" id="exportPurchaseGstBtn" style="border:1px solid var(--border)">
              <i class="fa-solid fa-download"></i> GSTR-2B Register JSON
            </button>
          ` : ''}
        </div>
      </div>

      <div class="table-wrap">
        <table class="responsive-table">
          <thead><tr><th>Date</th><th>Supplier</th><th>Purchase ID</th><th>Taxable Amt</th><th>CGST</th><th>SGST</th><th>Total GST</th></tr></thead>
          <tbody id="gstInputBody"></tbody>
        </table>
      </div>
      <div id="gstInputPagination"></div>
    </div>
  `;

  const salesExportBtn = document.getElementById('exportSalesGstBtn');
  if (salesExportBtn) salesExportBtn.onclick = async () => await exportGSTR1Json(orders);

  const taxInvoicesBtn = document.getElementById('exportTaxInvoicesBtn');
  if (taxInvoicesBtn) taxInvoicesBtn.onclick = async () => await exportTaxInvoicesPDF(orders, settings, periodLabel, cur);

  const purchaseExportBtn = document.getElementById('exportPurchaseGstBtn');
  if (purchaseExportBtn) purchaseExportBtn.onclick = async () => await exportPurchaseRegisterJson(purchases);

  const gstSummaryTableEl = document.getElementById('gstSummaryTable');
  wireTableExport('gst-summary', gstSummaryTableEl, 'GST Summary', null);

  const gstHsnSummaryTableEl = document.getElementById('gstHsnSummaryTable');
  wireTableExport('gst-hsn-summary', gstHsnSummaryTableEl, 'HSN-wise Summary (Sales)', null);

  const gstRateSummarySalesTableEl = document.getElementById('gstRateSummarySalesTable');
  wireTableExport('gst-rate-summary-sales', gstRateSummarySalesTableEl, 'Rate-wise Tax Summary (Sales)', null);

  const gstRateSummaryPurchasesTableEl = document.getElementById('gstRateSummaryPurchasesTable');
  wireTableExport('gst-rate-summary-purchases', gstRateSummaryPurchasesTableEl, 'Rate-wise Tax Summary (Purchases)', null);

  const gstOutputTableEl = document.getElementById('gstOutputBody').closest('table');
  const gstInputTableEl = document.getElementById('gstInputBody').closest('table');

  function gstOutputRowHtml(o) {
    const gstAmt = o.tax || 0;
    return `
                <tr>
                  <td data-label="Date">${new Date(o.date).toLocaleDateString()}</td>
                  <td data-label="Customer">${o.customer?.name || 'Walk-in'}</td>
                  <td data-label="Invoice ID" class="font-mono" style="font-size:11px">${o.id}</td>
                  <td data-label="Taxable Amt">${cur}${(o.subtotal || 0).toFixed(2)}</td>
                  <td data-label="CGST">${cur}${(gstAmt / 2).toFixed(2)}</td>
                  <td data-label="SGST">${cur}${(gstAmt / 2).toFixed(2)}</td>
                  <td data-label="Total GST" class="font-bold text-accent">${cur}${gstAmt.toFixed(2)}</td>
                </tr>
              `;
  }

  function gstInputRowHtml(p) {
    const gstAmt = p.taxAmount || 0;
    return `
                <tr>
                  <td data-label="Date">${new Date(p.date).toLocaleDateString()}</td>
                  <td data-label="Supplier">${p.supplierName}</td>
                  <td data-label="Purchase ID" class="font-mono" style="font-size:11px">${p.id}</td>
                  <td data-label="Taxable Amt">${cur}${(p.subtotal || p.total).toFixed(2)}</td>
                  <td data-label="CGST">${cur}${(gstAmt / 2).toFixed(2)}</td>
                  <td data-label="SGST">${cur}${(gstAmt / 2).toFixed(2)}</td>
                  <td data-label="Total GST" class="font-bold text-info">${cur}${gstAmt.toFixed(2)}</td>
                </tr>
              `;
  }

  gstOutputPage = 1;
  (function renderGstOutputRows() {
    const { pageItems, page, totalPages } = paginate(orders, gstOutputPage, REPORT_PAGE_SIZE);
    gstOutputPage = page;
    document.getElementById('gstOutputBody').innerHTML = pageItems.length === 0 ? '<tr><td colspan="7" style="text-align:center;padding:20px;opacity:0.5">No sales recorded</td></tr>' :
      pageItems.map(gstOutputRowHtml).join('');

    renderPaginationBar(document.getElementById('gstOutputPagination'), {
      page, totalPages, onChange: (p) => { gstOutputPage = p; renderGstOutputRows(); }
    });
  })();

  gstInputPage = 1;
  (function renderGstInputRows() {
    const { pageItems, page, totalPages } = paginate(purchases, gstInputPage, REPORT_PAGE_SIZE);
    gstInputPage = page;
    document.getElementById('gstInputBody').innerHTML = pageItems.length === 0 ? '<tr><td colspan="7" style="text-align:center;padding:20px;opacity:0.5">No purchases recorded</td></tr>' :
      pageItems.map(gstInputRowHtml).join('');

    renderPaginationBar(document.getElementById('gstInputPagination'), {
      page, totalPages, onChange: (p) => { gstInputPage = p; renderGstInputRows(); }
    });
  })();

  wireTableExport('gst-output', gstOutputTableEl, 'Output GST (Sales)', () => orders.map(gstOutputRowHtml).join(''));
  wireTableExport('gst-input', gstInputTableEl, 'Input GST (Purchases)', () => purchases.map(gstInputRowHtml).join(''));
}

async function renderStaffIncentiveReport(container, cur) {
  const staff = await getStaff(currentBranchFilter);
  const incentives = await getStaffIncentives(currentBranchFilter, currentStartDate, currentEndDate);

  const processed = staff.map(s => {
    const sIncs = incentives.filter(i => i.staffId === s.id);
    return {
      ...s,
      totalEarned: sIncs.reduce((sum, i) => sum + i.amount, 0),
      orderCount: sIncs.length
    };
  }).sort((a, b) => b.totalEarned - a.totalEarned);
  const canExportStaff = await hasPermission('reports:export');

  container.innerHTML = `
    <div class="grid-2 mb-24">
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(79,70,229,0.15)"><i class="fa-solid fa-users-gear" style="color:var(--accent)"></i></div>
        <div class="stat-info">
          <div class="stat-value">${processed.length}</div>
          <div class="stat-label">Active Staff Members</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(16,185,129,0.15)"><i class="fa-solid fa-hand-holding-dollar" style="color:var(--success)"></i></div>
        <div class="stat-info">
          <div class="stat-value">${cur}${processed.reduce((s, st) => s + st.totalEarned, 0).toLocaleString()}</div>
          <div class="stat-label">Total Staff Payouts Due</div>
        </div>
      </div>
    </div>

    <div class="card mb-24">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div class="font-bold">Staff Earnings Summary</div>
        ${canExportStaff ? tableExportButtonsHtml('staff-summary') : ''}
      </div>
      <div class="table-wrap">
        <table class="responsive-table">
          <thead><tr><th>Staff Member</th><th>Role</th><th>Orders</th><th>Comm %</th><th>Total Earnings</th></tr></thead>
          <tbody id="staffSummaryBody">
            ${processed.map(staffSummaryRowHtml).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div class="font-bold">Detailed Incentive Logs</div>
        ${canExportStaff ? tableExportButtonsHtml('staff-incentive-log') : ''}
      </div>
      <div class="table-wrap">
        <table class="responsive-table table-sm">
          <thead><tr><th>Date</th><th>Staff</th><th>Order ID</th><th>Total</th><th>Incentive</th></tr></thead>
          <tbody id="staffIncentiveLogBody"></tbody>
        </table>
      </div>
      <div id="staffIncentiveLogPagination"></div>
    </div>
  `;

  const staffSummaryTableEl = document.getElementById('staffSummaryBody').closest('table');
  const staffLogTableEl = document.getElementById('staffIncentiveLogBody').closest('table');

  function staffSummaryRowHtml(s) {
    return `
              <tr>
                <td data-label="Staff Member">
                  <div style="text-align:left">
                    <div class="font-bold">${s.name}</div>
                    <div style="font-size:11px;opacity:0.6">${s.phone || ''}</div>
                  </div>
                </td>
                <td data-label="Role"><span class="badge badge-primary">${s.specialization || 'Artist'}</span></td>
                <td data-label="Orders">${s.orderCount}</td>
                <td data-label="Comm %" class="text-accent font-bold">${s.commissionRate || 0}%</td>
                <td data-label="Total Earnings" class="text-success font-bold" style="font-size:16px">${cur}${s.totalEarned.toFixed(2)}</td>
              </tr>
            `;
  }

  function incentiveLogRowHtml(i) {
    return `
              <tr>
                <td data-label="Date" style="font-size:11px">${new Date(i.date).toLocaleDateString()}</td>
                <td data-label="Staff">${i.staffName}</td>
                <td data-label="Order ID" style="font-size:11px;opacity:0.7">${i.orderId}</td>
                <td data-label="Total">${cur}${i.orderTotal.toFixed(2)}</td>
                <td data-label="Incentive" class="font-bold text-success">+${cur}${i.amount.toFixed(2)}</td>
              </tr>
            `;
  }

  const incentivesSorted = incentives.slice().reverse();
  staffIncentiveLogPage = 1;
  (function renderIncentiveLogRows() {
    const { pageItems, page, totalPages } = paginate(incentivesSorted, staffIncentiveLogPage, REPORT_PAGE_SIZE);
    staffIncentiveLogPage = page;
    document.getElementById('staffIncentiveLogBody').innerHTML = pageItems.map(incentiveLogRowHtml).join('');

    renderPaginationBar(document.getElementById('staffIncentiveLogPagination'), {
      page, totalPages, onChange: (p) => { staffIncentiveLogPage = p; renderIncentiveLogRows(); }
    });
  })();

  wireTableExport('staff-summary', staffSummaryTableEl, 'Staff Earnings Summary', () => processed.map(staffSummaryRowHtml).join(''));
  wireTableExport('staff-incentive-log', staffLogTableEl, 'Detailed Incentive Logs', () => incentivesSorted.map(incentiveLogRowHtml).join(''));
}

async function renderRegisterReport(container, cur) {
  const shiftsRaw = await getShifts();
  const branches = await getBranches();
  const registers = await getRegisters();

  // Filter shifts by date range
  const shifts = (shiftsRaw || []).filter(s => {
    const isBranchMatch = !currentBranchFilter || s.branchId === currentBranchFilter;
    const isDateMatch = (!currentStartDate || s.openedAt >= currentStartDate) && (!currentEndDate || s.openedAt <= currentEndDate + 'T23:59:59');
    return isBranchMatch && isDateMatch;
  });

  // Sort by date descending
  shifts.sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt));

  registerReportPage = 1;
  const canExportReg = await hasPermission('reports:export');

  container.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div class="font-bold" style="font-size:18px"><i class="fa-solid fa-cash-register mr-8 text-success"></i> Register & Shift History</div>
        <div style="display:flex;align-items:center;gap:12px">
          <div class="text-muted" style="font-size:12px">${shifts.length} Shifts Recorded</div>
          ${canExportReg ? tableExportButtonsHtml('register') : ''}
        </div>
      </div>

      <div class="table-wrap">
        <table class="responsive-table">
          <thead>
            <tr>
              <th style="min-width:180px">Shift Timeline</th>
              <th>Register / Branch</th>
              <th>Cashier</th>
              <th>Sales</th>
              <th>Balance Audit</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody id="registerReportBody"></tbody>
        </table>
      </div>
      <div id="registerReportPagination"></div>
    </div>
  `;

  function shiftRowHtml(s) {
                const branchName = branches.find(b => b.id === s.branchId)?.name || 'Branch';
                const regName = registers.find(r => r.id === s.registerId)?.name || s.registerId || 'Main Terminal';
                const openDate = new Date(s.openedAt);
                const closeDate = s.closedAt ? new Date(s.closedAt) : null;
                
                // Calculate discrepancy
                const cashSales = Object.entries(s.collections || {}).reduce((sum, [m, a]) => {
                  return m.toLowerCase() === 'cash' ? sum + a : sum;
                }, 0);
                const totalIn = (s.transactions || []).filter(t => t.type === 'In').reduce((sum, t) => sum + t.amount, 0);
                const totalOut = (s.transactions || []).filter(t => t.type === 'Out').reduce((sum, t) => sum + t.amount, 0);
                const expected = (s.openingBalance || 0) + cashSales + totalIn - totalOut;
                const diff = s.status === 'Closed' ? ((s.closingBalance || 0) - expected) : null;

                return `
                  <tr>
                    <td data-label="Timeline">
                      <div style="display:flex; flex-direction:column; gap:4px">
                        <div class="flex items-center gap-8">
                          <span style="font-size:10px; padding:2px 4px; background:var(--bg-elevated); border-radius:4px; font-weight:700; color:var(--success)">OPEN</span>
                          <span class="font-semibold" style="font-size:12px">${openDate.toLocaleDateString()} ${openDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        ${s.closedAt ? `
                          <div class="flex items-center gap-8">
                            <span style="font-size:10px; padding:2px 4px; background:var(--bg-elevated); border-radius:4px; font-weight:700; color:var(--text-muted)">CLOSE</span>
                            <span style="font-size:12px; opacity:0.8">${closeDate.toLocaleDateString()} ${closeDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        ` : `
                          <div class="flex items-center gap-8">
                            <span style="font-size:10px; padding:2px 4px; background:var(--bg-elevated); border-radius:4px; font-weight:700; color:var(--accent)">ACTIVE</span>
                            <span style="font-size:11px; opacity:0.5; font-style:italic">Ongoing shift...</span>
                          </div>
                        `}
                      </div>
                    </td>
                    <td data-label="Register">
                      <div class="font-semibold">${regName}</div>
                      <div style="font-size:10px;opacity:0.5">${branchName}</div>
                    </td>
                    <td data-label="Cashier">
                      <div class="badge badge-ghost" style="font-size:11px">${s.openedBy || 'Staff'}</div>
                    </td>
                    <td data-label="Sales">
                      <div class="text-success font-bold">${cur}${(s.sales || 0).toFixed(2)}</div>
                      <div style="font-size:10px;opacity:0.6">${s.ordersCount || 0} Orders</div>
                    </td>
                    <td data-label="Balance Audit">
                      ${s.status === 'Closed' ? `
                        <div class="font-bold" style="font-size:13px">${cur}${s.closingBalance.toFixed(2)}</div>
                        <div style="font-size:10px" class="${diff > 0 ? 'text-success' : diff < 0 ? 'text-danger' : 'text-muted'}">
                          ${diff === 0 ? 'Balanced' : (diff > 0 ? 'Surplus +' : 'Shortage ') + cur + Math.abs(diff).toFixed(2)}
                        </div>
                      ` : '<span style="opacity:0.3">—</span>'}
                    </td>
                    <td data-label="Status">
                      <span class="badge ${s.status === 'Open' ? 'badge-success' : 'badge-ghost'}">${s.status}</span>
                    </td>
                    <td data-label="Action">
                       <button class="btn btn-ghost btn-sm view-shift-report-btn" data-id="${s.id}" title="View Breakdown">
                         <i class="fa-solid fa-eye"></i>
                       </button>
                    </td>
                  </tr>
                `;
  }

  const registerTableEl = container.querySelector('table.responsive-table');

  function renderShiftRows() {
    const { pageItems, page, totalPages } = paginate(shifts, registerReportPage, REPORT_PAGE_SIZE);
    registerReportPage = page;
    const tbody = document.getElementById('registerReportBody');
    if (!tbody) return;
    tbody.innerHTML = pageItems.length === 0 ? '<tr><td colspan="7" style="text-align:center;padding:40px;opacity:0.5">No shift history found for this branch.</td></tr>' :
      pageItems.map(shiftRowHtml).join('');

    tbody.querySelectorAll('.view-shift-report-btn').forEach(btn => {
      btn.onclick = () => openShiftSummaryModal(btn.dataset.id, cur, shifts, registers);
    });

    renderPaginationBar(document.getElementById('registerReportPagination'), {
      page, totalPages, onChange: (p) => { registerReportPage = p; renderShiftRows(); }
    });
  }

  renderShiftRows();
  wireTableExport('register', registerTableEl, 'Register & Shift History', () => shifts.map(shiftRowHtml).join(''));
}

function openShiftSummaryModal(shiftId, cur, allShifts, registers = []) {
  const shift = allShifts.find(s => s.id === shiftId);
  if (!shift) return;

  const regName = registers.find(r => r.id === shift.registerId)?.name || 'Main Terminal';

  const cashSales = Object.entries(shift.collections || {}).reduce((sum, [m, a]) => {
    return m.toLowerCase() === 'cash' ? sum + a : sum;
  }, 0);
  const totalIn = (shift.transactions || []).filter(t => t.type === 'In').reduce((s, t) => s + t.amount, 0);
  const totalOut = (shift.transactions || []).filter(t => t.type === 'Out').reduce((s, t) => s + t.amount, 0);
  const expected = (shift.openingBalance || 0) + cashSales + totalIn - totalOut;
  const diff = shift.status === 'Closed' ? ((shift.closingBalance || 0) - expected) : null;

  import('../components/Modal.js').then(Modal => {
    Modal.openModal({
      title: `<i class="fa-solid fa-receipt"></i> Shift Audit Summary — ${new Date(shift.openedAt).toLocaleDateString()}`,
      body: `
        <div style="display:flex;flex-direction:column;gap:18px">
          <div class="grid-2">
            <div class="stat-info">
              <div style="font-size:11px;opacity:0.6">Cashier / Register</div>
              <div class="font-bold">${shift.openedBy || '—'} / ${regName}</div>
            </div>
            <div class="stat-info">
              <div style="font-size:11px;opacity:0.6">Total Sales</div>
              <div class="font-bold text-accent">${cur}${(shift.sales || 0).toFixed(2)}</div>
            </div>
          </div>

          <div style="background:var(--bg-elevated);border-radius:var(--radius-sm);padding:14px">
            <div class="flex items-center justify-between py-4">
              <span>Opening Balance</span>
              <span class="font-bold">${cur}${(shift.openingBalance || 0).toFixed(2)}</span>
            </div>
            <div class="flex items-center justify-between py-4 text-success">
              <span>Cash Sales</span>
              <span class="font-bold">+${cur}${cashSales.toFixed(2)}</span>
            </div>
            <div class="flex items-center justify-between py-4 text-success">
              <span>Cash In</span>
              <span class="font-bold">+${cur}${totalIn.toFixed(2)}</span>
            </div>
            <div class="flex items-center justify-between py-4 text-danger">
              <span>Cash Out</span>
              <span class="font-bold">-${cur}${totalOut.toFixed(2)}</span>
            </div>
            <div class="flex items-center justify-between py-8 font-bold text-accent" style="border-top:1px dashed var(--border);margin-top:6px">
              <span>Expected Cash</span>
              <span>${cur}${expected.toFixed(2)}</span>
            </div>
            ${shift.status === 'Closed' ? `
              <div class="flex items-center justify-between py-4 font-bold text-success" style="border-top:1px solid var(--border)">
                <span>Actual Closing Cash</span>
                <span>${cur}${shift.closingBalance.toFixed(2)}</span>
              </div>
              <div class="flex items-center justify-between py-4 ${diff < 0 ? 'text-danger' : 'text-success'}" style="font-size:14px; font-weight:800">
                <span>Discrepancy</span>
                <span>${diff === 0 ? 'Balanced' : (diff > 0 ? '+' : '') + cur + diff.toFixed(2)}</span>
              </div>
            ` : ''}
          </div>

          <div>
            <h4 class="form-label mb-8">Payment Breakdown</h4>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
              ${Object.entries(shift.collections || {}).map(([m, a]) => `
                <div style="text-align:center;padding:8px;background:var(--bg-elevated);border-radius:var(--radius-sm);font-size:12px">
                  <div style="opacity:0.6;margin-bottom:2px">${m}</div>
                  <div class="font-bold">${cur}${(a || 0).toFixed(2)}</div>
                </div>
              `).join('')}
            </div>
          </div>
          
          ${shift.notes ? `
            <div class="card" style="background:rgba(255,255,255,0.02)">
              <div style="font-size:11px;opacity:0.5;margin-bottom:4px">Closing Notes</div>
              <div style="font-size:13px;font-style:italic">${shift.notes}</div>
            </div>
          ` : ''}
        </div>
      `,
      footer: `<button class="btn btn-primary" onclick="closeModal()">Close Audit View</button>`
    });
  });
}

async function renderLowStockReport(container, cur) {
  const products = await getProducts(currentBranchFilter);
  const lowStockThreshold = 10;
  const lowStockItems = products.filter(p => (p.stock || 0) <= lowStockThreshold);
  const canExportLow = await hasPermission('reports:export');

  function lowStockRowHtml(p) {
    return `
                <tr>
                  <td data-label="Product">
                    <div style="display:flex;align-items:center;gap:12px;justify-content:flex-start">
                      <span style="font-size:24px">${p.emoji || '📦'}</span>
                      <div style="text-align:left">
                        <div class="font-bold">${p.name}</div>
                        <div style="font-size:11px;opacity:0.6">ID: ${p.id}</div>
                      </div>
                    </div>
                  </td>
                  <td data-label="Category"><span class="badge badge-ghost">${p.category || 'General'}</span></td>
                  <td data-label="Stock" class="font-bold cursor-help" title="Threshold: 10">
                    <span class="${p.stock <= 0 ? 'text-danger' : 'text-warning'}">${parseFloat(Number(p.stock || 0).toFixed(3))}</span>
                  </td>
                  <td data-label="Status">
                    <div style="display:flex;align-items:center;gap:8px;justify-content:flex-start">
                      <div style="flex:1;background:var(--bg-main);height:6px;border-radius:3px;overflow:hidden;width:80px">
                        <div style="width:${Math.min(100, ((p.stock || 0) / 10 * 100))}%;background:${(p.stock || 0) <= 2 ? 'var(--danger)' : 'var(--warning)'};height:100%"></div>
                      </div>
                      <span style="font-size:10px;font-weight:700;color:${(p.stock || 0) <= 2 ? 'var(--danger)' : 'var(--warning)'}">
                        ${(p.stock || 0) <= 0 ? 'OUT' : 'LOW'}
                      </span>
                    </div>
                  </td>
                </tr>
              `;
  }

  container.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div class="font-bold" style="font-size:16px">
          <i class="fa-solid fa-triangle-exclamation mr-8 text-danger"></i> Low Stock Alert
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <span class="badge badge-danger">${lowStockItems.length} Items Needing Restock</span>
          ${canExportLow ? tableExportButtonsHtml('low-stock') : ''}
        </div>
      </div>

      <div class="table-wrap">
        <table class="responsive-table">
          <thead><tr><th>Product</th><th>Category</th><th>Current Stock</th><th>Status</th></tr></thead>
          <tbody id="lowStockBody">
            ${lowStockItems.length === 0 ? '<tr><td colspan="4" style="text-align:center;padding:40px;opacity:0.5">All items are sufficiently stocked! ✅</td></tr>' :
      lowStockItems.map(lowStockRowHtml).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  wireTableExport('low-stock', document.getElementById('lowStockBody').closest('table'), 'Low Stock Alert', () => lowStockItems.map(lowStockRowHtml).join(''));
}

async function renderReturnsReport(container, cur) {
  const returnsSorted = (await getReturns(currentBranchFilter, currentStartDate, currentEndDate)).slice().reverse();
  const canExport = await hasPermission('reports:export');
  const settings = await getSettings();

  returnsReportPage = 1;

  container.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div class="font-bold"><i class="fa-solid fa-rotate-left mr-8 text-danger"></i> Returns History (Sales & Procurement)</div>
        ${canExport ? tableExportButtonsHtml('returns') : ''}
      </div>
      <div class="table-wrap">
        <table class="responsive-table">
          <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Return Items</th><th>Total Value</th><th>Method</th><th>Reason</th><th>Actions</th></tr></thead>
          <tbody id="returnsReportBody"></tbody>
        </table>
      </div>
      <div id="returnsReportPagination"></div>
    </div>
  `;

  function returnRowHtml(r) {
    return `
                <tr>
                  <td data-label="Date" style="font-size:11px">${new Date(r.date).toLocaleString()}</td>
                  <td data-label="Type"><span class="badge badge-${r.type === 'sales' ? 'accent' : 'primary'}">${r.type.toUpperCase()}</span></td>
                  <td data-label="Reference">${r.orderId || r.purchaseId || 'N/A'}</td>
                  <td data-label="Return Items" style="font-size:11px">
                    ${r.items.map(i => `${i.qty} x ${i.name}`).join('<br>')}
                  </td>
                  <td data-label="Total Value" class="font-bold text-danger">${cur}${r.total.toFixed(2)}</td>
                  <td data-label="Method"><span class="badge badge-warning">${r.refundMethod || 'Cash'}</span></td>
                  <td data-label="Reason" style="font-size:11px;opacity:0.8">${r.reason}</td>
                  <td data-label="Actions">
                    ${canExport ? `
                      <button class="btn btn-ghost btn-sm print-return-btn" data-id="${r.id}"><i class="fa-solid fa-print"></i></button>
                    ` : '<span class="text-muted" style="font-size:10px">Locked</span>'}
                  </td>
                </tr>
              `;
  }

  const returnsTableEl = container.querySelector('table.responsive-table');

  function renderReturnRows() {
    const { pageItems, page, totalPages } = paginate(returnsSorted, returnsReportPage, REPORT_PAGE_SIZE);
    returnsReportPage = page;
    const tbody = document.getElementById('returnsReportBody');
    if (!tbody) return;
    tbody.innerHTML = pageItems.length === 0 ? '<tr><td colspan="8" style="text-align:center;padding:40px;opacity:0.5">No returns logged yet</td></tr>' :
      pageItems.map(returnRowHtml).join('');

    tbody.querySelectorAll('.print-return-btn').forEach(btn => {
      btn.onclick = async () => {
        const ret = returnsSorted.find(r => r.id === btn.dataset.id);
        if (ret) {
          const cs = await import('../services/CheckoutService.js');
          cs.showRefundReceipt(ret, settings, cur);
        }
      };
    });

    renderPaginationBar(document.getElementById('returnsReportPagination'), {
      page, totalPages, onChange: (p) => { returnsReportPage = p; renderReturnRows(); }
    });
  }

  renderReturnRows();
  wireTableExport('returns', returnsTableEl, 'Returns History', () => returnsSorted.map(returnRowHtml).join(''));
}

// Keep existing chart functions but update variable management
function renderSalesChart(data) {
  const ctx = document.getElementById('salesChart');
  if (!ctx) return;
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
  chartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => d.label),
      datasets: [{
        label: 'Revenue',
        data: data.map(d => d.total),
        backgroundColor: 'rgba(79,70,229,0.5)',
        borderColor: '#818cf8',
        borderWidth: 2,
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
      },
    },
  });
}

function renderPaymentChart(orders, cur) {
  const ctx = document.getElementById('paymentChart');
  if (!ctx) return;
  const methods = {};
  orders.forEach(o => {
    if (o.payments) {
      o.payments.forEach(p => {
        methods[p.method] = (methods[p.method] || 0) + p.amount;
      });
    } else {
      methods[o.paymentMethod] = (methods[o.paymentMethod] || 0) + o.total;
    }
  });
  const colors = ['#4f46e5', '#10b981', '#f59e0b', '#3b82f6', '#ef4444'];
  new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: Object.keys(methods),
      datasets: [{
        data: Object.values(methods),
        backgroundColor: colors,
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#94a3b8', padding: 16, font: { size: 13 } } },
      },
      cutout: '65%',
    },
  });
}

function renderProcurementChart(data) {
  const ctx = document.getElementById('procurementChart');
  if (!ctx || !data) return;
  if (procurementChart) { procurementChart.destroy(); procurementChart = null; }
  procurementChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.map(d => d.label),
      datasets: [{
        label: 'Procurement Cost',
        data: data.map(d => d.total),
        backgroundColor: 'rgba(245, 158, 11, 0.1)',
        borderColor: '#f59e0b',
        borderWidth: 3,
        tension: 0.4,
        fill: true,
        pointBackgroundColor: '#f59e0b',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' }, beginAtZero: true },
      },
    }
  });
}


let chartInstance = null;
let procurementChart = null;

async function renderLoginActivityReport(container, cur) {
  const canExportLogin = await hasPermission('reports:export');
  container.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div class="font-bold" style="font-size:18px"><i class="fa-solid fa-shield-halved mr-8 text-primary"></i> Login Activity & System Audit</div>
        <div style="display:flex;align-items:center;gap:8px">
          ${canExportLogin ? tableExportButtonsHtml('login-activity') : ''}
          <button class="btn btn-ghost btn-sm" id="refresh-login-logs">
            <i class="fa-solid fa-sync-alt mr-4"></i> Refresh Logs
          </button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="responsive-table">
          <thead>
            <tr>
              <th>User / Role</th>
              <th>Login Time</th>
              <th>IP Address</th>
              <th>Device / OS</th>
              <th>Browser</th>
              <th>Register</th>
            </tr>
          </thead>
          <tbody id="login-logs-body">
            <tr><td colspan="6" style="text-align:center;padding:40px;opacity:0.5"><i class="fa-solid fa-spinner fa-spin mr-8"></i> Loading logs from Hub...</td></tr>
          </tbody>
        </table>
      </div>
      <div id="loginLogsPagination"></div>
    </div>
  `;

  const loginLogsTableEl = document.getElementById('login-logs-body').closest('table');
  let allLogs = [];

  function loginLogRowHtml(log) {
      const date = new Date(log.timestamp);
      const isMobile = log.deviceType === 'Mobile/Tablet';
      return `
        <tr>
          <td data-label="User / Role">
            <div style="text-align:left">
              <div class="font-bold">${log.userName || 'Unknown'}</div>
              <div class="badge badge-ghost" style="font-size:10px">${log.role || 'Staff'}</div>
            </div>
          </td>
          <td data-label="Login Time">
            <div style="text-align:left">
              <div>${date.toLocaleDateString()}</div>
              <div style="font-size:11px;opacity:0.6">${date.toLocaleTimeString()}</div>
            </div>
          </td>
          <td data-label="IP Address">
            <code style="font-size:11px;color:var(--primary)">${log.ip || 'Local'}</code>
          </td>
          <td data-label="Device / OS">
            <div style="display:flex;align-items:center;gap:8px;justify-content:flex-start">
              <i class="fa-solid ${isMobile ? 'fa-mobile-screen' : 'fa-desktop'}" style="opacity:0.6"></i>
              <div style="text-align:left">
                <div style="font-size:13px">${log.os || 'Unknown OS'}</div>
                <div style="font-size:10px;opacity:0.5">${log.deviceType || 'Desktop'}</div>
              </div>
            </div>
          </td>
          <td data-label="Browser">
            <span class="badge badge-primary-light" style="font-size:11px">${log.browser || 'Browser'}</span>
          </td>
          <td data-label="Register">
             <div style="font-size:13px">${log.registerName || 'N/A'}</div>
             <div style="font-size:10px;opacity:0.5">${log.branchName || ''}</div>
          </td>
        </tr>
      `;
  }

  function renderLogsPage() {
    const tableBody = document.getElementById('login-logs-body');
    const { pageItems, page, totalPages } = paginate(allLogs, loginActivityPage, REPORT_PAGE_SIZE);
    loginActivityPage = page;

    tableBody.innerHTML = pageItems.map(loginLogRowHtml).join('');

    renderPaginationBar(document.getElementById('loginLogsPagination'), {
      page, totalPages, onChange: (p) => { loginActivityPage = p; renderLogsPage(); }
    });
  }

  async function loadLogs() {
    const tableBody = document.getElementById('login-logs-body');
    if (!window.syncEngine || !window.syncEngine.isConnected) {
      tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--danger)">Offline - Hub connection required</td></tr>';
      return;
    }

    const res = await window.syncEngine.getLoginActivities(100);
    if (!res.success) {
      tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--danger)">${res.message}</td></tr>`;
      return;
    }

    if (res.logs.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;opacity:0.5">No login activity recorded yet.</td></tr>';
      return;
    }

    allLogs = res.logs;
    loginActivityPage = 1;
    renderLogsPage();
  }

  loadLogs();
  document.getElementById('refresh-login-logs').onclick = loadLogs;
  wireTableExport('login-activity', loginLogsTableEl, 'Login Activity & System Audit', () => allLogs.map(loginLogRowHtml).join(''));
}

// Renders one order as a classic Indian retail tax-invoice block (seller
// header with GSTIN/phone, INVOICE title, Sl.No/Particulars/HSN/Qty/Rate/
// Amount item table, CGST+SGST+Grand Total, signature line) — matches the
// physical printed-bill format the user wants to hand their auditor, with an
// HSN column added per-line. Deliberately self-contained inline styles (no
// dependency on the app's theme stylesheet) since this needs to look the
// same regardless of on-screen theme, same reasoning as the PDF table
// print-friendly override above.
function buildTaxInvoiceHtml(order, settings, cur) {
  // Prefer the CURRENT settings over the order's own storeName snapshot —
  // unlike a checkout receipt (which intentionally freezes the store name as
  // it was at sale time), this document is generated NOW for the auditor, so
  // it should reflect the business's present name/logo, not whatever a much
  // older order happened to capture (e.g. a placeholder name from before the
  // store was properly set up in Settings).
  const storeName = settings.storeName || order.storeName || 'Store';
  // Settings-driven subtitle (e.g. "Group") rendered on its own smaller line
  // below the main store name — a dedicated Settings field (General tab,
  // Settings.js) rather than parsed out of storeName, so this same
  // subtitle is available consistently everywhere the store name is shown
  // (this invoice, receipts, etc.), not re-derived ad hoc per place.
  const storeNameSub = (settings.storeNameSubtitle || '').trim() || null;
  const dateStr = new Date(order.date).toLocaleDateString('en-GB');
  const customerName = order.customer?.name || 'Walk-in Customer';
  const rate = order.taxRate || 0;
  const halfRate = (rate / 2).toFixed(1);
  const gstAmt = order.tax || 0;
  const halfGst = (gstAmt / 2).toFixed(2);

  const itemRows = (order.items && order.items.length) ? order.items.map((item, idx) => `
    <tr>
      <td style="padding:6px 8px; border-right:1px solid #ccc;">${idx + 1}</td>
      <td style="padding:6px 8px; border-right:1px solid #ccc;">${item.name}${item.variantName ? ` (${item.variantName})` : ''}</td>
      <td style="padding:6px 8px; border-right:1px solid #ccc;">${item.hsnCode || '-'}</td>
      <td style="padding:6px 8px; text-align:right; border-right:1px solid #ccc;">${item.qty}</td>
      <td style="padding:6px 8px; text-align:right; border-right:1px solid #ccc;">${(item.price || 0).toFixed(2)}</td>
      <td style="padding:6px 8px; text-align:right;">${((item.price || 0) * item.qty).toFixed(2)}</td>
    </tr>
  `).join('') : `<tr><td colspan="6" style="padding:10px; text-align:center; color:#999">No items recorded</td></tr>`;

  return `
    <div class="tax-invoice-block" style="border:2px solid #333; border-radius:6px; padding:16px; margin:0 auto 24px; page-break-after:always; font-family:Arial,Helvetica,sans-serif; color:#111; background:#fff; max-width:720px;">
      <div style="text-align:center; border:1px solid #999; border-radius:24px; padding:10px 14px 8px; margin-bottom:10px; position:relative;">
        <div style="position:absolute; left:14px; top:10px; font-size:10px; font-weight:bold;">GSTIN : ${settings.gstNumber || 'Not Provided'}</div>
        <div style="position:absolute; right:14px; top:10px; font-size:10px; font-weight:bold;">Cell : ${settings.storePhone || ''}</div>
        <div style="display:flex; align-items:center; justify-content:center; gap:10px; margin-top:16px;">
          ${settings.storeLogo ? `<img src="${settings.storeLogo}" style="width:42px; height:42px; object-fit:contain; border-radius:50%; flex-shrink:0;" />` : ''}
          <div>
            <div style="font-size:22px; font-weight:800; letter-spacing:0.5px; line-height:1.15;">${storeName}</div>
            ${storeNameSub ? `<div style="font-size:13px; font-weight:600; letter-spacing:0.5px; color:#444; line-height:1.1;">(${storeNameSub})</div>` : ''}
          </div>
        </div>
        <div style="font-size:11px; margin-top:3px; color:#333;">${settings.storeAddress || ''}</div>
      </div>
      <div style="text-align:center; font-weight:bold; font-size:14px; letter-spacing:2px; border-bottom:2px solid #333; padding-bottom:6px; margin-bottom:10px;">INVOICE</div>
      <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:6px;">
        <span>No. ${order.id}</span>
        <span>Date: ${dateStr}</span>
      </div>
      <div style="font-size:12px; margin-bottom:10px;">To. ${customerName}</div>
      <table style="width:100%; border-collapse:collapse; font-size:12px;">
        <thead>
          <tr style="border-top:1px solid #333; border-bottom:1px solid #333; background:#f5f5f5;">
            <th style="padding:6px 8px; text-align:left; border-right:1px solid #333; width:7%;">Sl.No</th>
            <th style="padding:6px 8px; text-align:left; border-right:1px solid #333;">Particulars</th>
            <th style="padding:6px 8px; text-align:left; border-right:1px solid #333; width:12%;">HSN</th>
            <th style="padding:6px 8px; text-align:right; border-right:1px solid #333; width:8%;">Qty</th>
            <th style="padding:6px 8px; text-align:right; border-right:1px solid #333; width:13%;">Rate</th>
            <th style="padding:6px 8px; text-align:right; width:14%;">Amount</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
      <table style="width:100%; border-collapse:collapse; font-size:12px; border-top:1px solid #333;">
        <tr>
          <td style="padding:6px 8px; text-align:right; border-right:1px solid #333;" colspan="5">CGST ${halfRate}%</td>
          <td style="padding:6px 8px; text-align:right;">${cur}${halfGst}</td>
        </tr>
        <tr>
          <td style="padding:6px 8px; text-align:right; border-right:1px solid #333; border-top:1px solid #ddd;" colspan="5">SGST ${halfRate}%</td>
          <td style="padding:6px 8px; text-align:right; border-top:1px solid #ddd;">${cur}${halfGst}</td>
        </tr>
        <tr style="font-weight:bold; border-top:2px solid #333;">
          <td style="padding:8px; text-align:right; border-right:1px solid #333;" colspan="5">GRAND TOTAL</td>
          <td style="padding:8px; text-align:right;">${cur}${(order.total || 0).toFixed(2)}</td>
        </tr>
      </table>
      <div style="font-size:10px; margin-top:8px; color:#666;">E.&amp;O.E.</div>
      <div style="display:flex; justify-content:flex-end; margin-top:36px; font-size:12px;">
        <div style="text-align:center;">
          <div style="font-weight:bold;">For: ${storeName}</div>
          <div style="margin-top:34px; border-top:1px solid #333; padding-top:2px; min-width:120px;">Signature</div>
        </div>
      </div>
    </div>
  `;
}

// Assembles one formatted Tax Invoice per order (buildTaxInvoiceHtml above)
// into a single multi-page PDF — an "auditor packet" of individual bills for
// the period, as opposed to the aggregate HSN/rate-wise summary reports.
// Reuses the same silent-save-to-Downloads path as exportSingleTablePDF, but
// the invoice HTML is fully self-contained (inline styles only), so unlike
// that function it doesn't need the app's theme stylesheet inlined at all.
async function exportTaxInvoicesPDF(orders, settings, periodLabel, cur) {
  if (orders.length === 0) {
    showToast('No invoices to export for this period', 'warning');
    return;
  }
  const invoiceBlocks = orders.map(o => buildTaxInvoiceHtml(o, settings, cur)).join('');
  const fullHtml = `<html><head><title>Tax Invoices - ${periodLabel}</title></head><body style="background:#fff; margin:0; padding:16px;">${invoiceBlocks}</body></html>`;

  const isElectron = /Electron/i.test(navigator.userAgent);
  if (isElectron && window.electronAPI?.exportReportPdfSilent) {
    const res = await window.electronAPI.exportReportPdfSilent({ html: fullHtml, filename: `Tax_Invoices_${periodLabel.replace(/\s+/g, '_')}` });
    if (res?.success) {
      showToast(`Saved ${orders.length} invoice(s) to Downloads: ${res.path.split(/[\\/]/).pop()}`, 'success');
    } else {
      showToast('PDF export failed: ' + (res?.error || 'unknown error'), 'error');
    }
    return;
  }

  openModal({ title: `Tax Invoices — ${periodLabel}`, body: fullHtml, footer: '', hideClose: true });
  window.addEventListener('afterprint', () => closeModal(), { once: true });
  setTimeout(() => window.print(), 200);
}

async function exportPurchaseRegisterJson(purchases) {
  const register = {
    reportType: "GSTR_PURCHASE_REGISTER",
    generatedAt: new Date().toISOString(),
    branch: store.branch?.name || "All Branches",
    summary: {
      totalTaxableValue: purchases.reduce((s, p) => s + (p.subtotal || p.total), 0),
      totalTaxAmount: purchases.reduce((s, p) => s + (p.taxAmount || 0), 0),
      totalValue: purchases.reduce((s, p) => s + p.total, 0),
      count: purchases.length
    },
    purchases: purchases.map(p => ({
      ctin: p.supplierGstin || "UNREGISTERED",
      inum: p.supplierInvoiceNo || p.id,
      idt: new Date(p.date).toLocaleDateString('en-GB'),
      val: p.total,
      pos: p.placeOfSupply || "33",
      rchrg: "N",
      inv_typ: "R",
      txval: p.subtotal || p.total,
      rt: p.taxRate || 0,
      iamt: 0,
      camt: (p.taxAmount || 0) / 2,
      samt: (p.taxAmount || 0) / 2,
      supplierName: p.supplierName
    }))
  };

  const blob = new Blob([JSON.stringify(register, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `PurchaseRegister_${format(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportGSTR1Json(orders) {
  const settings = await getSettings();
  const gstr1 = {
    gstin: settings.gstNumber || "NOT_PROVIDED", 
    fp: new Date().toLocaleString('en-IN', { month: '2-digit', year: 'numeric' }).replace('/', ''),
    gt: orders.filter(o => o.status !== 'cancelled').reduce((s, o) => s + (o.total || 0), 0),
    cur_gt: orders.filter(o => o.status !== 'cancelled').reduce((s, o) => s + (o.total || 0), 0),
    b2b: [],
    b2cs: [],
    hsn: { data: [] }
  };

  const hsnMap = {};

  orders.filter(o => o.status !== 'cancelled').forEach(o => {
    if (o.customer?.gstin) {
      let b2bEntry = gstr1.b2b.find(ctin => ctin.ctin === o.customer.gstin);
      if (!b2bEntry) {
        b2bEntry = { ctin: o.customer.gstin, inv: [] };
        gstr1.b2b.push(b2bEntry);
      }
      b2bEntry.inv.push({
        inum: o.id,
        idt: new Date(o.date).toLocaleDateString('en-GB'),
        val: o.total,
        pos: settings.stateCode || "33",
        rchrg: "N",
        inv_typ: "R",
        itms: [{
          num: 1,
          itm_det: {
            rt: o.taxRate || 0,
            txval: o.subtotal,
            iamt: 0,
            camt: (o.tax || 0) / 2,
            samt: (o.tax || 0) / 2,
            csamt: 0
          }
        }]
      });
    } else {
      gstr1.b2cs.push({
        sply_ty: "INTER",
        pos: settings.stateCode || "33",
        typ: "OE",
        rt: o.taxRate || 0,
        txval: (o.subtotal || 0),
        iamt: 0,
        camt: (o.tax || 0) / 2,
        samt: (o.tax || 0) / 2,
        csamt: 0
      });
    }

    (o.items || []).forEach(item => {
      const code = item.hsnCode || "9999";
      if (!hsnMap[code]) {
        hsnMap[code] = { hsn_sc: code, desc: item.name, uqc: "NOS", qty: 0, val: 0, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
      }

      const itemTax = item.finalTax || 0;
      const lineTotal = item.price * item.qty;
      const discountTotal = item.itemDiscountType === 'pct'
        ? (lineTotal * (item.itemDiscount || 0) / 100)
        : ((item.itemDiscount || 0) * item.qty);
      const discountedTotal = Math.max(0, lineTotal - discountTotal);
      let taxValueNet = discountedTotal;
      if (item.taxType === 'inclusive') {
        taxValueNet = discountedTotal - itemTax;
      }

      hsnMap[code].qty += item.qty;
      hsnMap[code].val += taxValueNet + itemTax;
      hsnMap[code].txval += taxValueNet;
      hsnMap[code].camt += itemTax / 2;
      hsnMap[code].samt += itemTax / 2;
    });
  });

  gstr1.hsn.data = Object.values(hsnMap);

  const blob = new Blob([JSON.stringify(gstr1, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `GSTR1_${format(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
