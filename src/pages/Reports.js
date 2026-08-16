import { getSettings, getTodaySales, getSalesLast7Days, getOrders, getTopProducts, getDailySalesBreakdown, getVehicleDeliveryReport, getSupplierOutstandingReport, getBranches, getCategorySales, getSuppliers, getPurchases, getPurchasesTrend, getSalesVsPurchasesTrend, getPaymentMethodReport, getPurchaseReturnedTotals, getReturns, getCustomers, getShifts, getRegisters, getStaff, getStaffIncentives, getProducts, getInstantSalesData, updateProduct, read, KEYS, hasPermission, getStockStatus, localDateOnly, DEFAULT_LOW_STOCK_THRESHOLD, getTotalExpenses, getExpenseCategoryTotals, getExpenses, getReorderSuggestions } from '../db.js';
import { showToast } from '../components/Toast.js';
import { openModal, closeModal } from '../components/Modal.js';
import { store } from '../store.js';
import { navigate } from '../router.js';
import { Chart, registerables } from 'chart.js';
import { paginate, renderPaginationBar } from '../utils/pagination.js';
import { escapeHtml } from '../utils/escapeHtml.js';
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
          ${(await getBranches()).map(b => `<option value="${b.id}" ${currentBranchFilter === b.id ? 'selected' : ''}>${escapeHtml(b.name)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="report-nav custom-scrollbar" style="display:flex;gap:12px;margin-bottom:24px;border-bottom:1px solid var(--border);padding-bottom:12px;overflow-x:auto">
      <button class="btn btn-ghost btn-sm ${subPage === 'sales' ? 'active-tab' : ''}" onclick="navigate('reports/sales')">Sales Hub</button>
      <button class="btn btn-ghost btn-sm ${subPage === 'instant-sales' ? 'active-tab' : ''}" onclick="navigate('reports/instant-sales')">Instant Sales</button>
      <button class="btn btn-ghost btn-sm ${subPage === 'category-sales' ? 'active-tab' : ''}" onclick="navigate('reports/category-sales')">Categories</button>
      <button class="btn btn-ghost btn-sm ${subPage === 'sales-analysis' ? 'active-tab' : ''}" onclick="navigate('reports/sales-analysis')">Analysis</button>
      <button class="btn btn-ghost btn-sm ${subPage === 'inventory' ? 'active-tab' : ''}" onclick="navigate('reports/inventory')">Inventory</button>
      <button class="btn btn-ghost btn-sm ${subPage === 'purchases' ? 'active-tab' : ''}" onclick="navigate('reports/purchases')">Purchase</button>
      <button class="btn btn-ghost btn-sm ${subPage === 'expenses' ? 'active-tab' : ''}" onclick="navigate('reports/expenses')">Expenses</button>
      <button class="btn btn-ghost btn-sm ${subPage === 'vehicles' ? 'active-tab' : ''}" onclick="navigate('reports/vehicles')">Vehicles</button>
      <button class="btn btn-ghost btn-sm ${subPage === 'outstanding' ? 'active-tab' : ''}" onclick="navigate('reports/outstanding')">Outstanding</button>
      <button class="btn btn-ghost btn-sm ${subPage === 'payments' ? 'active-tab' : ''}" onclick="navigate('reports/payments')">Payments</button>
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
    case 'expenses':
      await renderExpenseReport(contentEl, cur);
      break;
    case 'vehicles':
      await renderVehicleDeliveryReport(contentEl, cur);
      break;
    case 'outstanding':
      await renderOutstandingReport(contentEl, cur);
      break;
    case 'payments':
      await renderPaymentMethodReport(contentEl, cur);
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
                    <span>${escapeHtml(p.name)}</span>
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
  renderPaymentChart(validOrders, salesReturns, cur);

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
                <td data-label="Customer">${escapeHtml(item.customer)}</td>
                <td data-label="Item Name" class="font-bold">${escapeHtml(item.name)}</td>
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
                <td data-label="Category"><span class="badge badge-ghost">${escapeHtml(c.category)}</span></td>
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
  // getSalesVsPurchasesTrend() builds Sales AND Purchases into the SAME
  // bucket objects (keyed identically) — the old version pulled them from
  // two independent trend lists and matched them up by raw array position,
  // which silently misaligned whenever the two had a different set of
  // months present. It's also date-range/branch aware now (adapts to
  // daily buckets for a narrow selection, monthly for a wide one — same
  // logic as Purchases.js's own trend chart), where this used to always
  // show an all-time view regardless of the picker at the top of the page.
  const trend = await getSalesVsPurchasesTrend(currentBranchFilter, currentStartDate, currentEndDate);
  const merged = trend.data;

  const totalRevenue = merged.reduce((s, m) => s + m.sales, 0);
  const totalCost = merged.reduce((s, m) => s + m.purchases, 0);
  // This is Gross Profit (Revenue - COGS only) — Rent/Salary/Electricity and
  // other operating costs never show up in "purchases" (that's stock buying
  // cost only), so it's kept separate from Net Profit below, which pulls
  // those in via getTotalExpenses().
  const totalProfit = totalRevenue - totalCost;
  const marginPct = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

  const totalExpenses = await getTotalExpenses(currentBranchFilter, currentStartDate, currentEndDate);
  const netProfit = totalProfit - totalExpenses;
  const netMarginPct = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

  container.innerHTML = `
    <div class="card mb-24">
      <div class="mb-16">
        <div class="font-bold"><i class="fa-solid fa-chart-area mr-8"></i> Profitability Analysis (Sales vs Purchases)</div>
        <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">
          ${trend.granularity === 'daily'
            ? 'Bucketed by day — the selected range is narrow enough that a month-by-month view would collapse to a single bar.'
            : 'Bucketed by month — matches the date range and branch selected above.'}
        </div>
      </div>
      <div style="height:350px"><canvas id="analysisChart"></canvas></div>
    </div>

    <div class="grid-4 gap-16">
      <div class="stat-card">
        <div class="stat-info">
          <div class="stat-label">Total Revenue</div>
          <div class="stat-value text-success">${cur}${totalRevenue.toLocaleString()}</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-info">
          <div class="stat-label">Total Purchase Cost</div>
          <div class="stat-value text-danger">${cur}${totalCost.toLocaleString()}</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-info">
          <div class="stat-label">Gross Profit</div>
          <div class="stat-value" style="color:${totalProfit >= 0 ? 'var(--success)' : 'var(--danger)'}">${cur}${totalProfit.toLocaleString()}</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-info">
          <div class="stat-label">Overall Margin</div>
          <div class="stat-value" style="color:${marginPct >= 0 ? 'var(--success)' : 'var(--danger)'}">${marginPct.toFixed(1)}%</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-info">
          <div class="stat-label">Total Expenses <span title="Rent, Salary, Electricity, etc — from the Expenses page"><i class="fa-solid fa-circle-info" style="font-size:10px;opacity:0.5"></i></span></div>
          <div class="stat-value text-danger">${cur}${totalExpenses.toLocaleString()}</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-info">
          <div class="stat-label">Net Profit <span title="Gross Profit minus Total Expenses"><i class="fa-solid fa-circle-info" style="font-size:10px;opacity:0.5"></i></span></div>
          <div class="stat-value" style="color:${netProfit >= 0 ? 'var(--success)' : 'var(--danger)'}">${cur}${netProfit.toLocaleString()}</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-info">
          <div class="stat-label">Net Margin</div>
          <div class="stat-value" style="color:${netMarginPct >= 0 ? 'var(--success)' : 'var(--danger)'}">${netMarginPct.toFixed(1)}%</div>
        </div>
      </div>
    </div>
  `;

  const ctx = document.getElementById('analysisChart');
  if (ctx) {
    // Grouping this as N separate bar datasets (whether on a category axis
    // or, the last attempt, a linear one with hand-placed x per point) always
    // ran into the same wall: Chart.js computes ONE bar width for the whole
    // chart from the smallest gap it finds anywhere, so a tightly-packed
    // 3-bar day and a spread-out 2-bar day can never both look gap-free at
    // once — whichever cluster isn't the tightest ends up with daylight
    // between its bars.
    //
    // Flattened to a SINGLE bar dataset instead — one flat sequence of bars
    // (colored per metric), one bar per (day, metric-that-actually-has-a-
    // value) pair, nothing else. On a single dataset there's no cross-
    // dataset alignment to fight: Chart.js just spaces equal-width bars
    // evenly along one category axis, so adjacent bars always sit the same
    // distance apart — including two real bars on a day missing its third
    // metric, which now sit right next to each other because there's
    // nothing else in that day's group to begin with.
    const barDefsAll = [
      { key: 'sales', label: 'Sales Revenue', color: 'rgba(16, 185, 129, 0.8)', hover: 'rgba(16, 185, 129, 0.95)' },
      { key: 'purchases', label: 'Purchase Cost', color: 'rgba(239, 68, 68, 0.8)', hover: 'rgba(239, 68, 68, 0.95)' },
      { key: 'profit', label: 'Profit', color: 'rgba(99, 102, 241, 0.8)', hover: 'rgba(99, 102, 241, 0.95)' },
    ];

    const bars = []; // { y, color, hover, metricLabel, dayLabel, margin }
    const tickLabels = [];
    merged.forEach(m => {
      const active = barDefsAll.filter(d => Math.abs(m[d.key]) > 0.001);
      const midPos = Math.floor((active.length - 1) / 2); // day label centered under the middle bar of its own group
      const marginPct = m.sales > 0 ? ((m.profit / m.sales) * 100).toFixed(1) : '0.0';
      active.forEach((d, i) => {
        bars.push({ y: m[d.key], color: d.color, hover: d.hover, metricLabel: d.label, dayLabel: m.label, margin: marginPct });
        tickLabels.push(i === midPos ? m.label : '');
      });
    });

    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: tickLabels,
        datasets: [{
          data: bars.map(b => b.y),
          backgroundColor: bars.map(b => b.color),
          hoverBackgroundColor: bars.map(b => b.hover),
          borderRadius: 4,
          borderSkipped: false,
          categoryPercentage: 0.88,
          barPercentage: 0.9,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        // Only one dataset now, so Chart.js's default legend (one entry
        // per dataset) has nothing useful to show on its own — built by
        // hand instead, one static swatch per metric colour. Click
        // toggling doesn't map to anything meaningful on a single flat
        // bar list, so it's disabled rather than doing nothing silently.
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'end',
            onClick: () => {},
            labels: {
              color: '#94a3b8', boxWidth: 12, boxHeight: 12, usePointStyle: true, pointStyle: 'circle',
              generateLabels: () => barDefsAll.map(d => ({ text: d.label, fillStyle: d.color, strokeStyle: d.color, pointStyle: 'circle' }))
            }
          },
          tooltip: {
            backgroundColor: 'rgba(17, 24, 39, 0.92)',
            padding: 12,
            cornerRadius: 8,
            titleFont: { weight: '700' },
            callbacks: {
              title: (items) => bars[items[0].dataIndex]?.dayLabel || '',
              label: (item) => {
                const b = bars[item.dataIndex];
                return `${b.metricLabel}: ${cur}${b.y.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
              },
              afterLabel: (item) => `Margin: ${bars[item.dataIndex]?.margin}%`
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#94a3b8', autoSkip: false, maxRotation: 0 } },
          y: {
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#94a3b8', callback: (v) => `${cur}${v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v}` }
          },
        },
      }
    });
  }
}

async function renderExpenseReport(container, cur) {
  // getExpenseCategoryTotals() (db.js) does the grouping — same per-category
  // {category, total, count} shape as getCategorySales(), just sourced from
  // the Expenses store instead of Orders.
  const categoryTotals = await getExpenseCategoryTotals(currentBranchFilter, currentStartDate, currentEndDate);
  const allExpenses = await getExpenses(currentBranchFilter, currentStartDate, currentEndDate);
  const canExportExp = await hasPermission('reports:export');

  const totalExpenses = categoryTotals.reduce((s, c) => s + c.total, 0);
  const totalCount = allExpenses.length;
  const topCategory = categoryTotals[0];

  const categoryRow = (c) => {
    const pct = totalExpenses > 0 ? (c.total / totalExpenses) * 100 : 0;
    return `
      <tr>
        <td data-label="Category"><span class="badge badge-info">${escapeHtml(c.category)}</span></td>
        <td data-label="Entries">${c.count}</td>
        <td data-label="Total" class="font-bold">${cur}${c.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td data-label="Share">
          <div style="display:flex; align-items:center; gap:8px;">
            <div style="flex:1; height:6px; background:var(--bg-app); border-radius:3px; overflow:hidden; min-width:40px;">
              <div style="height:100%; width:${pct}%; background:var(--danger); border-radius:3px;"></div>
            </div>
            <span style="font-size:11px; color:var(--text-muted); flex-shrink:0;">${pct.toFixed(0)}%</span>
          </div>
        </td>
      </tr>
    `;
  };
  const categoryRows = categoryTotals.map(categoryRow).join('')
    || `<tr><td colspan="4" style="text-align:center;padding:40px;opacity:0.5">No expenses recorded in this range</td></tr>`;

  const entryRow = (x) => `
    <tr>
      <td data-label="Date">${x.date ? new Date(x.date).toLocaleDateString() : 'N/A'}</td>
      <td data-label="Category"><span class="badge badge-ghost">${escapeHtml(x.category || 'Uncategorized')}</span></td>
      <td data-label="Description">${escapeHtml(x.description || '—')}</td>
      <td data-label="Paid To">${escapeHtml(x.paidTo || '—')}</td>
      <td data-label="Method">${escapeHtml(x.paymentMethod || '—')}</td>
      <td data-label="Amount" style="text-align:right" class="font-bold">${cur}${(Number(x.amount) || 0).toFixed(2)}</td>
    </tr>
  `;
  const sortedEntries = [...allExpenses].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const entryRows = sortedEntries.map(entryRow).join('')
    || `<tr><td colspan="6" style="text-align:center;padding:40px;opacity:0.5">No expenses recorded in this range</td></tr>`;

  container.innerHTML = `
    <div class="grid-3 gap-16 mb-24">
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(239,68,68,0.15)"><i class="fa-solid fa-receipt" style="color:#ef4444"></i></div>
        <div class="stat-info">
          <div class="stat-value text-danger">${cur}${totalExpenses.toLocaleString()}</div>
          <div class="stat-label">Total Expenses</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(99,102,241,0.15)"><i class="fa-solid fa-list-ol" style="color:#6366f1"></i></div>
        <div class="stat-info">
          <div class="stat-value">${totalCount}</div>
          <div class="stat-label">Entries</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(245,158,11,0.15)"><i class="fa-solid fa-crown" style="color:#f59e0b"></i></div>
        <div class="stat-info">
          <div class="stat-value" style="font-size:18px">${topCategory ? escapeHtml(topCategory.category) : '—'}</div>
          <div class="stat-label">Top Category${topCategory ? ` (${cur}${topCategory.total.toLocaleString()})` : ''}</div>
        </div>
      </div>
    </div>

    <div class="card mb-24">
      <div class="font-bold mb-16"><i class="fa-solid fa-chart-pie mr-8" style="color:var(--danger)"></i> Expenses by Category</div>
      ${categoryTotals.length === 0 ? `<div class="empty-state" style="padding:30px 0"><i class="fa-solid fa-chart-pie"></i><p>No expenses recorded in this range</p></div>` : `<div style="height:300px"><canvas id="expenseCategoryChart"></canvas></div>`}
    </div>

    <div class="card mb-24">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div class="font-bold">Category Breakdown</div>
        ${canExportExp ? tableExportButtonsHtml('expense-categories') : ''}
      </div>
      <div class="table-wrap">
        <table class="responsive-table">
          <thead><tr><th>Category</th><th>Entries</th><th>Total</th><th>Share</th></tr></thead>
          <tbody id="expenseCategoryBody">${categoryRows}</tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div class="font-bold">All Expense Entries</div>
        ${canExportExp ? tableExportButtonsHtml('expense-entries') : ''}
      </div>
      <div class="table-wrap">
        <table class="responsive-table">
          <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Paid To</th><th>Method</th><th style="text-align:right">Amount</th></tr></thead>
          <tbody id="expenseEntriesBody">${entryRows}</tbody>
        </table>
      </div>
    </div>
  `;

  wireTableExport('expense-categories', document.getElementById('expenseCategoryBody').closest('table'), 'Expenses by Category', () => categoryRows);
  wireTableExport('expense-entries', document.getElementById('expenseEntriesBody').closest('table'), 'All Expense Entries', () => entryRows);

  const donutColors = ['#f87171', '#fbbf24', '#818cf8', '#34d399', '#60a5fa', '#a78bfa', '#f472b6', '#22d3ee', '#fb923c', '#a3e635'];
  const chartCtx = document.getElementById('expenseCategoryChart');
  if (chartCtx && categoryTotals.length > 0) {
    new Chart(chartCtx, {
      type: 'doughnut',
      data: {
        labels: categoryTotals.map(c => c.category),
        datasets: [{
          data: categoryTotals.map(c => c.total),
          backgroundColor: categoryTotals.map((_, i) => donutColors[i % donutColors.length]),
          borderColor: 'transparent',
          hoverOffset: 8,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: {
            position: 'right',
            labels: { color: '#94a3b8', boxWidth: 12, boxHeight: 12, usePointStyle: true, pointStyle: 'circle' }
          },
          tooltip: {
            backgroundColor: 'rgba(17, 24, 39, 0.92)',
            padding: 12,
            cornerRadius: 8,
            callbacks: {
              label: (item) => `${item.label}: ${cur}${item.parsed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            }
          }
        }
      }
    });
  }
}

async function renderPaymentMethodReport(container, cur) {
  // getPaymentMethodReport() (db.js) is the single source of truth for
  // this — same ".payments array, fallback to single method, exclude
  // cancelled/Unpaid" logic Dashboard's own Payment Breakdown donut and
  // this file's Sales chart already use for collections, extended to also
  // cover money paid OUT to suppliers (purchases), so this one screen
  // shows both directions instead of just the sales side.
  const report = await getPaymentMethodReport(currentBranchFilter, currentStartDate, currentEndDate);
  const canExportPay = await hasPermission('reports:export');

  const shareRow = (row, total, cur) => {
    const pct = total > 0 ? (row.total / total) * 100 : 0;
    return `
      <tr>
        <td data-label="Method" class="font-bold">${escapeHtml(row.method)}</td>
        <td data-label="Transactions">${row.count}</td>
        <td data-label="Total" class="font-bold">${cur}${row.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td data-label="Share">
          <div style="display:flex; align-items:center; gap:8px;">
            <div style="flex:1; height:6px; background:var(--bg-app); border-radius:3px; overflow:hidden; min-width:40px;">
              <div style="height:100%; width:${pct}%; background:var(--primary); border-radius:3px;"></div>
            </div>
            <span style="font-size:11px; color:var(--text-muted); flex-shrink:0;">${pct.toFixed(0)}%</span>
          </div>
        </td>
      </tr>
    `;
  };

  const collectionsRows = report.collections.map(r => shareRow(r, report.totalCollected, cur)).join('')
    || `<tr><td colspan="4" style="text-align:center;padding:40px;opacity:0.5">No collections in this range</td></tr>`;
  const paymentsOutRows = report.paymentsOut.map(r => shareRow(r, report.totalPaidOut, cur)).join('')
    || `<tr><td colspan="4" style="text-align:center;padding:40px;opacity:0.5">No supplier payments in this range</td></tr>`;

  container.innerHTML = `
    <div class="grid-3 gap-16 mb-24">
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(16,185,129,0.15)"><i class="fa-solid fa-money-bill-trend-up" style="color:#10b981"></i></div>
        <div class="stat-info">
          <div class="stat-value text-success">${cur}${report.totalCollected.toLocaleString()}</div>
          <div class="stat-label">Total Collected (Sales)</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(239,68,68,0.15)"><i class="fa-solid fa-money-bill-transfer" style="color:#ef4444"></i></div>
        <div class="stat-info">
          <div class="stat-value text-danger">${cur}${report.totalPaidOut.toLocaleString()}</div>
          <div class="stat-label">Total Paid Out (Purchases)</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(99,102,241,0.15)"><i class="fa-solid fa-scale-balanced" style="color:#6366f1"></i></div>
        <div class="stat-info">
          <div class="stat-value" style="color:${report.netCashFlow >= 0 ? 'var(--success)' : 'var(--danger)'}">${cur}${report.netCashFlow.toLocaleString()}</div>
          <div class="stat-label">Net Cash Flow</div>
        </div>
      </div>
    </div>

    <div class="grid-2 gap-16 mb-24">
      <div class="card">
        <div class="font-bold mb-16"><i class="fa-solid fa-chart-pie mr-8" style="color:var(--primary)"></i>Collections Mix (Sales)</div>
        ${report.collections.length === 0 ? `<div class="empty-state" style="padding:30px 0"><i class="fa-solid fa-chart-pie"></i><p>No collections in this range</p></div>` : `<div style="height:260px"><canvas id="collectionsPieChart"></canvas></div>`}
      </div>
      <div class="card">
        <div class="font-bold mb-16"><i class="fa-solid fa-chart-pie mr-8" style="color:var(--danger)"></i>Payments Mix (Purchases)</div>
        ${report.paymentsOut.length === 0 ? `<div class="empty-state" style="padding:30px 0"><i class="fa-solid fa-chart-pie"></i><p>No supplier payments in this range</p></div>` : `<div style="height:260px"><canvas id="paymentsOutPieChart"></canvas></div>`}
      </div>
    </div>

    <div class="grid-2 gap-16">
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div class="font-bold">Collections by Method (Sales)</div>
          ${canExportPay ? tableExportButtonsHtml('payment-collections') : ''}
        </div>
        <div class="table-wrap">
          <table class="responsive-table">
            <thead><tr><th>Method</th><th>Transactions</th><th>Total Collected</th><th>Share</th></tr></thead>
            <tbody id="collectionsBody">${collectionsRows}</tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div class="font-bold">Payments by Method (Purchases)</div>
          ${canExportPay ? tableExportButtonsHtml('payment-out') : ''}
        </div>
        <div class="table-wrap">
          <table class="responsive-table">
            <thead><tr><th>Method</th><th>Payments</th><th>Total Paid</th><th>Share</th></tr></thead>
            <tbody id="paymentsOutBody">${paymentsOutRows}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  wireTableExport('payment-collections', document.getElementById('collectionsBody').closest('table'), 'Collections by Method', () => collectionsRows);
  wireTableExport('payment-out', document.getElementById('paymentsOutBody').closest('table'), 'Payments by Method', () => paymentsOutRows);

  const donutColors = ['#818cf8', '#34d399', '#fbbf24', '#f87171', '#60a5fa', '#a78bfa', '#f472b6', '#22d3ee'];
  const buildDonut = (canvasId, rows, cur) => {
    const canvasEl = document.getElementById(canvasId);
    if (!canvasEl || rows.length === 0) return;
    new Chart(canvasEl, {
      type: 'doughnut',
      data: {
        labels: rows.map(r => r.method),
        datasets: [{
          data: rows.map(r => r.total),
          backgroundColor: rows.map((_, i) => donutColors[i % donutColors.length]),
          borderColor: 'transparent',
          hoverOffset: 8,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: {
            position: 'right',
            labels: { color: '#94a3b8', boxWidth: 12, boxHeight: 12, usePointStyle: true, pointStyle: 'circle' }
          },
          tooltip: {
            backgroundColor: 'rgba(17, 24, 39, 0.92)',
            padding: 12,
            cornerRadius: 8,
            callbacks: {
              label: (item) => `${item.label}: ${cur}${item.parsed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            }
          }
        }
      }
    });
  };
  buildDonut('collectionsPieChart', report.collections, cur);
  buildDonut('paymentsOutPieChart', report.paymentsOut, cur);
}

async function renderPurchaseReport(container, cur) {
  const purchases = await getPurchases(currentBranchFilter, currentStartDate, currentEndDate);
  const purchasesSorted = purchases.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  // Bucket size adapts to the selected range — see getPurchasesTrend()'s own
  // comment — so this now actually reflects the same date range/branch the
  // stat cards above it do, instead of always being an all-time monthly view.
  const trend = await getPurchasesTrend(currentBranchFilter, currentStartDate, currentEndDate);
  // Net out returned value (purchase.total is never mutated by a return —
  // see getPurchaseReturnedTotals()'s comment in db.js) so a fully-returned
  // purchase doesn't keep inflating this range's total procurement spend.
  // 'Ordered' (not-yet-received) purchases are excluded too — same reasoning
  // as getSupplierOutstandingReport()/getPurchasesTrend() in db.js, they
  // aren't a real cost until the goods actually arrive.
  const returnedTotals = await getPurchaseReturnedTotals();
  const totalSpend = purchases.filter(p => p.status !== 'Ordered').reduce((s, p) => s + Math.max(0, (p.total || 0) - (returnedTotals[p.id] || 0)), 0);
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
      <div class="mb-16">
        <div class="font-bold">${trend.granularity === 'daily' ? 'Daily' : 'Monthly'} Purchase Trend</div>
        <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">
          ${trend.granularity === 'daily'
            ? 'Bucketed by day — the selected range is narrow enough that a month-by-month view would collapse to a single bar.'
            : 'Bucketed by month — matches the date range and branch selected above.'}
        </div>
      </div>
      <div style="height:300px"><canvas id="procurementChart"></canvas></div>
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div class="font-bold">Purchases</div>
        ${canExportPurch ? tableExportButtonsHtml('purchases') : ''}
      </div>
      <div class="table-wrap">
        <table class="responsive-table">
          <thead><tr><th>Date</th><th>ID</th><th>Supplier</th><th>Total</th><th>Status</th><th>Action</th></tr></thead>
          <tbody id="purchaseRecentBody"></tbody>
        </table>
      </div>
      <div id="purchaseRecentPagination"></div>
    </div>
  `;

  renderProcurementChart(trend.data, cur);

  const purchaseTableEl = document.getElementById('purchaseRecentBody').closest('table');

  function purchaseRecentRowHtml(p) {
    return `
              <tr>
                <td data-label="Date">${new Date(p.date).toLocaleDateString()}</td>
                <td data-label="ID">${p.id}</td>
                <td data-label="Supplier">${escapeHtml(p.supplierName)}</td>
                <td data-label="Total" class="font-bold text-danger">${cur}${p.total.toFixed(2)}</td>
                <td data-label="Status"><span class="badge ${p.status === 'Ordered' ? 'badge-info' : 'badge-success'}">${p.status === 'Ordered' ? 'Ordered' : p.status}</span></td>
                <td>
                  ${p.status === 'Ordered' ? `
                    <button class="btn btn-ghost btn-sm purchase-receive-btn" data-id="${p.id}" style="color:var(--success)">
                      <i class="fa-solid fa-truck-ramp-box"></i> Mark Received
                    </button>
                  ` : `
                    <button class="btn btn-ghost btn-sm purchase-return-btn" data-id="${p.id}">
                      <i class="fa-solid fa-rotate-left"></i> Return
                    </button>
                  `}
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
        if (pur) await openPurchaseReturnModal(pur, cur, () => renderPurchaseReport(container, cur));
      };
    });

    // Reuses Purchases.js's own confirm-then-receive flow instead of a
    // second copy of it here — same modal the Purchases list row opens.
    tbody.querySelectorAll('.purchase-receive-btn').forEach(btn => {
      btn.onclick = async () => {
        const pur = purchases.find(p => p.id === btn.dataset.id);
        if (pur) {
          const { markPurchaseReceived } = await import('./Purchases.js');
          await markPurchaseReceived(pur, () => renderPurchaseReport(container, cur));
        }
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
                <td data-label="Vehicle" class="font-bold">${escapeHtml(v.vehicle)}</td>
                <td data-label="Deliveries">${v.deliveries}</td>
                <td data-label="Total Value" class="font-bold text-success">${cur}${v.totalValue.toFixed(2)}</td>
                <td data-label="Avg / Delivery">${cur}${(v.totalValue / v.deliveries).toFixed(2)}</td>
                <td><button class="btn btn-ghost btn-sm vehicle-view-btn" data-vehicle="${escapeHtml(v.vehicle)}"><i class="fa-solid fa-eye"></i> View Orders</button></td>
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
                  <thead><tr><th>Order ID</th><th>Date</th><th>Total</th><th>Actions</th></tr></thead>
                  <tbody>
                    ${res.pageItems.map(o => `
                      <tr>
                        <td data-label="Order ID"><span class="badge badge-primary">${escapeHtml(o.id)}</span></td>
                        <td data-label="Date">${o.date ? new Date(o.date).toLocaleString() : 'N/A'}</td>
                        <td data-label="Total" class="font-bold text-success">${cur}${o.total.toFixed(2)}</td>
                        <td><button class="btn btn-ghost btn-sm vehicle-order-view-btn" data-id="${o.id}"><i class="fa-solid fa-receipt"></i> View Receipt</button></td>
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

          // Reuses Orders.js's own order-detail/receipt view (same Print/
          // Process Return/Settle Payment actions as the full Order History
          // page) instead of building a second, stripped-down preview here
          // — v.orders only carries a summary {id, dailyNumber, date, total}
          // for this list, so the full order record is fetched fresh by id
          // right when a row's button is actually clicked.
          document.querySelectorAll('.vehicle-order-view-btn').forEach(vbtn => {
            vbtn.onclick = async () => {
              const allOrders = await getOrders(currentBranchFilter);
              const fullOrder = allOrders.find(x => x.id === vbtn.dataset.id);
              if (!fullOrder) { showToast('Order not found', 'error'); return; }
              const { viewOrderDetail } = await import('./Orders.js');
              await viewOrderDetail(fullOrder, cur);
            };
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
  // cancelOrder() (Orders.js) reverses a credit order's debt in full but
  // deliberately leaves `isCredit` untouched for audit history — without
  // this guard, a cancelled order still showed up here as real outstanding
  // debt even though it was already voided and cleared.
  const creditOrders = ordersRaw.filter(o => o.isCredit && o.status !== 'cancelled');
  const creditMap = {};
  creditOrders.forEach(o => {
    const cid = o.customer?.id || 'unknown';
    if (!creditMap[cid]) {
      creditMap[cid] = { name: o.customer?.name || 'Unknown Customer', phone: o.customer?.phone || 'N/A', totalOutstanding: 0, orderCount: 0, lastOrderDate: o.date, orders: [] };
    }
    // Same formula Orders.js's payOrder() balance-due check uses — a credit
    // order can also carry redeemed loyalty points and/or store credit
    // applied at checkout, both of which already reduced what the customer
    // still owes; counting only `payments` overstated every such customer's
    // outstanding balance by exactly the redeemed/credit amount.
    const paid = (o.payments || []).reduce((s, p) => s + p.amount, 0);
    const balance = o.total - (o.redeemedPoints || 0) - (o.creditUsed || 0) - paid;
    creditMap[cid].totalOutstanding += balance;
    creditMap[cid].orderCount++;
    creditMap[cid].orders.push({ id: o.id, dailyNumber: o.dailyNumber, date: o.date, total: o.total, balance });
    if (new Date(o.date) > new Date(creditMap[cid].lastOrderDate)) creditMap[cid].lastOrderDate = o.date;
  });
  const customers = Object.values(creditMap).sort((a, b) => b.totalOutstanding - a.totalOutstanding);
  const totalSalesOutstanding = customers.reduce((s, c) => s + c.totalOutstanding, 0);

  // Calendar-month grouping — reuses the per-order/per-purchase balances already
  // computed above rather than re-deriving them, so this can never drift out of
  // sync with the by-customer/by-supplier totals above it.
  const monthlyMap = {};
  function ensureMonth(d) {
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (!monthlyMap[key]) {
      monthlyMap[key] = {
        label: d.toLocaleString('en', { month: 'long', year: 'numeric' }),
        sortKey: d.getFullYear() * 12 + d.getMonth(),
        salesOutstanding: 0,
        purchaseOutstanding: 0
      };
    }
    return monthlyMap[key];
  }
  customers.forEach(c => {
    c.orders.forEach(o => {
      if (o.balance <= 0.01) return;
      ensureMonth(new Date(o.date)).salesOutstanding += o.balance;
    });
  });
  suppliers.forEach(s => {
    s.purchases.forEach(p => {
      if (p.outstanding <= 0.01) return;
      ensureMonth(new Date(p.date)).purchaseOutstanding += p.outstanding;
    });
  });
  const monthlyRows = Object.values(monthlyMap).sort((a, b) => b.sortKey - a.sortKey);

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
        <div class="font-bold"><i class="fa-solid fa-calendar-days mr-8"></i> Monthly Outstanding Summary</div>
        ${canExportOut ? tableExportButtonsHtml('outstanding-monthly') : ''}
      </div>
      <div class="table-wrap">
        <table class="responsive-table">
          <thead><tr><th>Month</th><th>Sales Outstanding</th><th>Purchase Outstanding</th><th>Net Outstanding</th></tr></thead>
          <tbody id="outstandingMonthlyBody">
            ${monthlyRows.length === 0 ? '<tr><td colspan="4" style="text-align:center;padding:40px;opacity:0.5">No outstanding balances in any month. Great! 💎</td></tr>' :
              monthlyRows.map(m => {
                const net = m.salesOutstanding - m.purchaseOutstanding;
                return `
                <tr>
                  <td data-label="Month" class="font-bold">${m.label}</td>
                  <td data-label="Sales Outstanding" style="color:var(--warning)">${cur}${m.salesOutstanding.toFixed(2)}</td>
                  <td data-label="Purchase Outstanding" class="text-danger">${cur}${m.purchaseOutstanding.toFixed(2)}</td>
                  <td data-label="Net Outstanding" class="font-bold" style="color:${net >= 0 ? 'var(--success)' : 'var(--danger)'}">${net >= 0 ? '+' : '-'}${cur}${Math.abs(net).toFixed(2)}</td>
                </tr>
              `;
              }).join('')}
          </tbody>
        </table>
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
                      <div class="font-bold">${escapeHtml(c.name)}</div>
                      <div style="font-size:11px;opacity:0.6">${escapeHtml(c.phone)}</div>
                    </div>
                  </td>
                  <td data-label="Orders"><span class="badge badge-info">${c.orderCount} Orders</span></td>
                  <td data-label="Last Activity" style="font-size:12px">${new Date(c.lastOrderDate).toLocaleDateString()}</td>
                  <td data-label="Balance" class="font-bold" style="font-size:16px; color:var(--warning)">${cur}${c.totalOutstanding.toFixed(2)}</td>
                  <td><button class="btn btn-ghost btn-sm sales-outstanding-view-btn" data-customer="${escapeHtml(c.name)}"><i class="fa-solid fa-eye"></i> View Orders</button></td>
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
            title: `Outstanding Orders — ${escapeHtml(c.name)}`,
            body: `
              <div class="table-wrap">
                <table class="responsive-table">
                  <thead><tr><th>Order ID</th><th>Date</th><th>Total</th><th>Balance</th><th>Actions</th></tr></thead>
                  <tbody>
                    ${res.pageItems.map(o => `
                      <tr>
                        <td data-label="Order ID"><span class="badge badge-primary">${escapeHtml(o.id)}</span></td>
                        <td data-label="Date">${o.date ? new Date(o.date).toLocaleDateString() : 'N/A'}</td>
                        <td data-label="Total">${cur}${o.total.toFixed(2)}</td>
                        <td data-label="Balance" class="font-bold" style="color:var(--warning)">${cur}${o.balance.toFixed(2)}</td>
                        <td><button class="btn btn-success btn-sm outstanding-settle-btn" data-id="${o.id}"><i class="fa-solid fa-money-bill-wave"></i> Settle</button></td>
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

          // Reuses Orders.js's own split-settle UI (payOrder) directly from
          // here — clears the balance without leaving the Outstanding
          // report. On success, re-renders this whole report section so
          // the now-cleared (or partially reduced) balance reflects
          // immediately instead of showing a stale figure until the user
          // navigates away and back.
          document.querySelectorAll('.outstanding-settle-btn').forEach(sbtn => {
            sbtn.onclick = async () => {
              const allOrders = await getOrders(currentBranchFilter);
              const fullOrder = allOrders.find(x => x.id === sbtn.dataset.id);
              if (!fullOrder) { showToast('Order not found', 'error'); return; }
              const { payOrder } = await import('./Orders.js');
              await payOrder(fullOrder, cur, () => renderOutstandingReport(container, cur));
            };
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
                <td data-label="Supplier" class="font-bold">${escapeHtml(s.supplierName)}</td>
                <td data-label="Purchases"><span class="badge badge-info">${s.purchaseCount} Purchases</span></td>
                <td data-label="Total Purchased">${cur}${s.totalPurchased.toFixed(2)}</td>
                <td data-label="Paid" class="text-success">${cur}${s.totalPaid.toFixed(2)}</td>
                <td data-label="Outstanding" class="font-bold text-danger" style="font-size:16px">${cur}${s.outstanding.toFixed(2)}</td>
                <td><button class="btn btn-ghost btn-sm outstanding-view-btn" data-supplier="${escapeHtml(s.supplierName)}"><i class="fa-solid fa-eye"></i> View Purchases</button></td>
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
            title: `Outstanding Purchases — ${escapeHtml(s.supplierName)}`,
            body: `
              <div class="table-wrap">
                <table class="responsive-table">
                  <thead><tr><th>Invoice #</th><th>Date</th><th>Total</th><th>Paid</th><th>Outstanding</th><th>Actions</th></tr></thead>
                  <tbody>
                    ${res.pageItems.map(p => `
                      <tr>
                        <td data-label="Invoice #" class="font-mono">${p.supplierInvoiceNo || p.id}</td>
                        <td data-label="Date">${p.date ? new Date(p.date).toLocaleDateString() : 'N/A'}</td>
                        <td data-label="Total">${cur}${p.total.toFixed(2)}</td>
                        <td data-label="Paid" class="text-success">${cur}${p.amountPaid.toFixed(2)}</td>
                        <td data-label="Outstanding" class="font-bold text-danger">${cur}${p.outstanding.toFixed(2)}</td>
                        <td>
                          ${p.outstanding > 0.01 ? `
                            <button class="btn btn-success btn-sm outstanding-pay-btn" data-id="${p.id}"><i class="fa-solid fa-money-bill-wave"></i> Pay</button>
                          ` : '<span class="text-muted" style="font-size:11px;">Settled</span>'}
                        </td>
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

          // openSupplierPaymentModal() (Purchases.js) is the same split-pay
          // UI viewPurchaseDetails()'s own "Record Payment" button opens —
          // reused here so a supplier balance can be cleared (in full or
          // split across methods) right from the Outstanding report.
          document.querySelectorAll('.outstanding-pay-btn').forEach(pbtn => {
            pbtn.onclick = async () => {
              const { openSupplierPaymentModal } = await import('./Purchases.js');
              await openSupplierPaymentModal(pbtn.dataset.id, cur, () => renderOutstandingReport(container, cur));
            };
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
  const outstandingMonthlyTableEl = document.getElementById('outstandingMonthlyBody').closest('table');
  wireTableExport('outstanding-monthly', outstandingMonthlyTableEl, 'Monthly Outstanding Summary', () => monthlyRows.map(m => {
    const net = m.salesOutstanding - m.purchaseOutstanding;
    return `
      <tr>
        <td data-label="Month" class="font-bold">${m.label}</td>
        <td data-label="Sales Outstanding" style="color:var(--warning)">${cur}${m.salesOutstanding.toFixed(2)}</td>
        <td data-label="Purchase Outstanding" class="text-danger">${cur}${m.purchaseOutstanding.toFixed(2)}</td>
        <td data-label="Net Outstanding" class="font-bold" style="color:${net >= 0 ? 'var(--success)' : 'var(--danger)'}">${net >= 0 ? '+' : '-'}${cur}${Math.abs(net).toFixed(2)}</td>
      </tr>
    `;
  }).join(''));
  wireTableExport('outstanding-sales', outstandingSalesTableEl, 'Sales Outstanding by Customer', () => customers.map(salesOutstandingRowHtml).join(''));
  wireTableExport('outstanding-purchase', outstandingPurchaseTableEl, 'Purchase Outstanding by Supplier', () => suppliers.map(purchaseOutstandingRowHtml).join(''));
}

// Exported so Purchases.js's own Purchase Details view can open this same
// return flow directly too, instead of only being reachable from Reports >
// Purchases' list row. Every caller must supply its own onSuccess refresh —
// this function has no `container` of its own to fall back to (a previous
// default here referenced one that was never actually in scope, which
// would have thrown as soon as a return was ever confirmed).
export async function openPurchaseReturnModal(purchase, cur, onSuccess) {
  // Defense in depth — both call sites (Purchases.js's viewPurchaseDetails,
  // this file's own Purchase Report row) already hide the Return button for
  // an 'Ordered' purchase, but guard here too: there's no physical stock on
  // the shelf yet to return against.
  if (purchase.status === 'Ordered') {
    showToast("This purchase hasn't been received yet — nothing to return.", 'warning');
    return;
  }
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

  // Same payment-methods source Purchases.js's own purchase form and
  // supplier-payment settle modal use, so the refund options offered here
  // match everywhere else a supplier payment gets recorded.
  const settings = await getSettings();
  const refundMethods = settings.paymentMethods?.length ? settings.paymentMethods : ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Cheque'];

  // Purchase.total is tax-inclusive (subtotal + subtotal*taxRate/100, a
  // single order-level rate — see Purchases.js's completePurchaseBtn), so a
  // returned quantity's value must apply that same rate to stay directly
  // comparable/subtractable from purchase.total elsewhere (Purchases.js's
  // outstanding calc, getSupplierOutstandingReport/getPurchasesMonthly in
  // db.js) — without it, the return silently understated the value being
  // credited back by the tax portion.
  const taxRate = parseFloat(purchase.taxRate) || 0;
  const withTax = (base) => base * (1 + taxRate / 100);
  const getTotalReturn = () => parseFloat(returnedItems.reduce((sum, item) => sum + withTax(item.returnQty * (item.price || item.cost || 0)), 0).toFixed(2));

  // Split refund rows — same pattern (row 0 auto-tracking the live Total
  // Return Value, "Add Split" picking up the true remainder) Orders.js's
  // sales-return refund and Purchases.js's supplier-payment settle modal
  // already use, so this behaves identically to both instead of being its
  // own one-method-only flow.
  let refundRows = [{ method: refundMethods[0] || 'Cash', amount: 0 }];

  function renderRows() {
    return returnedItems.map((item, idx) => `
      <div class="payment-row" style="margin-bottom:12px; display:flex; align-items:center; gap:12px; background:var(--bg-elevated); padding:12px; border-radius:8px ${item.availableQty <= 0 ? 'opacity:0.5' : ''}">
        <div style="flex:1">
          <div class="font-bold">${item.emoji || '📦'} ${escapeHtml(item.name)}</div>
          <div style="font-size:11px; opacity:0.6">
            Original: ${item.qty}${settings.enableUnitOfMeasure !== false ? ` ${escapeHtml(item.unit || 'pcs')}` : ''} |
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

  function renderRefundRows() {
    return refundRows.map((r, idx) => `
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
        <select class="refund-row-method" data-idx="${idx}" style="flex:1; padding:8px 10px; border:1px solid var(--border); border-radius:8px; background:var(--bg-elevated); color:var(--text-main);">
          ${refundMethods.map(m => `<option value="${escapeHtml(m)}" ${r.method === m ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}
        </select>
        <input type="number" class="form-input refund-row-amount" data-idx="${idx}" value="${(parseFloat(r.amount) || 0).toFixed(2)}" style="width:110px; text-align:right" />
        ${refundRows.length > 1 ? `<button type="button" class="refund-row-remove btn btn-ghost" data-idx="${idx}" style="color:var(--danger); padding:6px 10px"><i class="fa-solid fa-xmark"></i></button>` : `<div style="width:38px"></div>`}
      </div>
    `).join('');
  }

  // The LAST row is the one that auto-balances (not row 0) — edit an
  // earlier row (e.g. type ₹19.18 into Cash out of a ₹29.18 total) and the
  // last row (UPI) picks up the true remainder live, matching how splitting
  // a bill normally works. Only updates that one input's value directly
  // (never a full modal rebuild) so this can run on every keystroke
  // elsewhere without stealing focus from whatever field is being typed
  // into, or making the whole modal flicker/feel like it reopened.
  function getAutoRowIndex() { return refundRows.length - 1; }

  function recalcAutoRow() {
    const totalReturn = getTotalReturn();
    const autoIdx = getAutoRowIndex();
    const othersSum = refundRows.reduce((s, r, i) => i === autoIdx ? s : s + (parseFloat(r.amount) || 0), 0);
    refundRows[autoIdx].amount = Math.max(0, parseFloat((totalReturn - othersSum).toFixed(2)));

    const autoInput = document.querySelector(`.refund-row-amount[data-idx="${autoIdx}"]`);
    if (autoInput && document.activeElement !== autoInput) autoInput.value = refundRows[autoIdx].amount.toFixed(2);

    const refundSum = refundRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
    const balanced = Math.abs(refundSum - totalReturn) < 0.01;
    const note = document.getElementById('refundBalanceNote');
    if (note) {
      note.textContent = `${cur}${refundSum.toFixed(2)} / ${cur}${totalReturn.toFixed(2)}`;
      note.style.color = balanced ? 'var(--success)' : 'var(--danger)';
    }
    const totalEl = document.getElementById('totalReturnAmountVal');
    if (totalEl) totalEl.textContent = `${cur}${totalReturn.toFixed(2)}`;
  }

  // Wires the method/amount/remove controls for whatever rows are CURRENTLY
  // in the DOM — called once after the initial render, and again after any
  // change that rebuilds #refundRowsArea's own innerHTML (add/remove a row).
  function wireRefundRowControls() {
    document.querySelectorAll('.refund-row-method').forEach(sel => {
      sel.onchange = (e) => { refundRows[parseInt(e.target.dataset.idx, 10)].method = e.target.value; };
    });
    document.querySelectorAll('.refund-row-amount').forEach(inp => {
      inp.oninput = (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        refundRows[idx].amount = parseFloat(e.target.value) || 0;
        // Editing the auto row itself shouldn't recompute itself out from
        // under the user's own typing — just refresh the totals/note.
        if (idx === getAutoRowIndex()) {
          const totalReturn = getTotalReturn();
          const refundSum = refundRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
          const balanced = Math.abs(refundSum - totalReturn) < 0.01;
          const note = document.getElementById('refundBalanceNote');
          if (note) {
            note.textContent = `${cur}${refundSum.toFixed(2)} / ${cur}${totalReturn.toFixed(2)}`;
            note.style.color = balanced ? 'var(--success)' : 'var(--danger)';
          }
        } else {
          recalcAutoRow();
        }
      };
    });
    document.querySelectorAll('.refund-row-remove').forEach(btn => {
      btn.onclick = () => {
        if (refundRows.length > 1) {
          refundRows.splice(parseInt(btn.dataset.idx, 10), 1);
          rerenderRefundRowsArea();
        }
      };
    });
  }

  function rerenderRefundRowsArea() {
    const area = document.getElementById('refundRowsArea');
    if (area) area.innerHTML = renderRefundRows();
    wireRefundRowControls();
    recalcAutoRow();
  }

  function updateModal() {
    // Safe to call before the modal DOM exists — recalcAutoRow()'s own
    // element lookups are all null-guarded, so this just settles
    // refundRows' state (the sole starting row defaults to the full total)
    // for the very first render below.
    recalcAutoRow();
    const totalReturn = getTotalReturn();
    const refundSum = refundRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
    const refundBalanced = Math.abs(refundSum - totalReturn) < 0.01;

    const body = `
      <div style="padding:10px">
        <div class="mb-16 text-muted" style="font-size:13px">Select quantities to return to supplier. Stock will be automatically deducted.</div>
        <div id="returnItemsContainer">${renderRows()}</div>

        <div style="background:var(--bg-elevated); padding:12px; border-radius:8px; margin-top:16px; border:1px dashed var(--border)">
          <div style="font-size:11px; font-weight:bold; color:var(--text-muted); text-transform:uppercase; margin-bottom:8px">Original Purchase Payment</div>
          ${(purchase.paymentHistory && purchase.paymentHistory.length > 0) ? purchase.paymentHistory.map(h => `
            <div style="display:flex; justify-content:space-between; font-size:13px; padding:2px 0;">
              <span>${escapeHtml(h.method || 'Cash')}</span>
              <span class="font-bold">${cur}${(h.amount || 0).toFixed(2)}</span>
            </div>
          `).join('') : `
            <div style="display:flex; justify-content:space-between; font-size:13px;">
              <span>${escapeHtml(purchase.paymentMethod || 'N/A')}</span>
              <span class="font-bold">${cur}${(purchase.amountPaid ?? purchase.total).toFixed(2)}</span>
            </div>
          `}
          ${(purchase.amountPaid || 0) < (purchase.total || 0) - 0.01 ? `
            <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--text-muted); margin-top:6px; padding-top:6px; border-top:1px dashed var(--border);">
              <span>Still Outstanding (Credit)</span>
              <span>${cur}${(purchase.total - (purchase.amountPaid || 0)).toFixed(2)}</span>
            </div>
          ` : ''}
        </div>

        <div class="form-group mt-16">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <label class="form-label" style="margin:0;">Refund Method${refundRows.length > 1 ? 's' : ''} (Adjustment)</label>
            <span id="refundBalanceNote" style="font-size:12px; font-weight:700; color:${refundBalanced ? 'var(--success)' : 'var(--danger)'}">${cur}${refundSum.toFixed(2)} / ${cur}${totalReturn.toFixed(2)}</span>
          </div>
          <div id="refundRowsArea">${renderRefundRows()}</div>
          <button type="button" class="btn btn-ghost btn-sm" id="refundAddSplitBtn" style="border:1px dashed var(--border);"><i class="fa-solid fa-plus mr-4"></i> Add Split</button>
        </div>

        <div class="form-group mt-16">
          <label class="form-label">Return Reason / Note</label>
          <input type="text" class="form-input" id="returnReason" placeholder="e.g. Expired, Wrong item" />
        </div>

        <div class="mt-20 p-16" style="background:rgba(239,68,68,0.05); border-radius:12px; border:1px solid rgba(239,68,68,0.1)">
          <div style="display:flex; justify-content:space-between; align-items:center">
            <span class="font-bold">Total Return Value</span>
            <span class="font-bold text-danger" id="totalReturnAmountVal" style="font-size:20px">${cur}${totalReturn.toFixed(2)}</span>
          </div>
        </div>
      </div>
    `;

    openModal({
      title: `Purchase Return - ${purchase.id}`,
      body: body,
      footer: `
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-danger" id="confirmPurchaseReturnBtn">Confirm Return to Supplier</button>
      `
    });

    setTimeout(() => {
      // Item quantity edits only ever need the auto-balancing refund row
      // and the two total displays refreshed — never the whole modal
      // (which used to call updateModal() → openModal() again on every
      // keystroke, tearing down and rebuilding the entire modal each time).
      document.querySelectorAll('.return-qty-input').forEach(input => {
        input.oninput = (e) => {
          const idx = e.target.dataset.idx;
          const val = parseInt(e.target.value) || 0;
          const max = parseInt(e.target.max);
          returnedItems[idx].returnQty = Math.min(val, max);
          recalcAutoRow();
        };
      });

      wireRefundRowControls();

      const addSplitBtn = document.getElementById('refundAddSplitBtn');
      if (addSplitBtn) {
        addSplitBtn.onclick = () => {
          const used = refundRows.map(r => r.method);
          const nextMethod = refundMethods.find(m => !used.includes(m)) || refundMethods[0] || 'Cash';
          // The new row becomes the last (auto) row — rerenderRefundRowsArea()'s
          // own recalcAutoRow() call fills in its real amount right after,
          // so it doesn't need computing here.
          refundRows.push({ method: nextMethod, amount: 0 });
          rerenderRefundRowsArea();
        };
      }

      document.getElementById('confirmPurchaseReturnBtn').onclick = async () => {
        const confirmBtn = document.getElementById('confirmPurchaseReturnBtn');
        if (confirmBtn.disabled) return;

        const itemsToReturn = returnedItems.filter(i => i.returnQty > 0).map(i => ({ ...i, qty: i.returnQty }));
        if (itemsToReturn.length === 0) {
          showToast('Please select at least one item to return.', 'warning');
          return;
        }

        const totalReturn = getTotalReturn();
        const validRefundRows = refundRows
          .filter(r => r.method && parseFloat(r.amount) > 0.001)
          .map(r => ({ method: r.method, amount: parseFloat((parseFloat(r.amount) || 0).toFixed(2)) }));
        const refundSum = parseFloat(validRefundRows.reduce((s, r) => s + r.amount, 0).toFixed(2));
        if (Math.abs(refundSum - totalReturn) > 0.01) {
          showToast(`Refund split (${cur}${refundSum.toFixed(2)}) doesn't match the Total Return Value (${cur}${totalReturn.toFixed(2)}) — adjust the amounts.`, 'warning');
          return;
        }

        const reason = document.getElementById('returnReason').value || 'Not specified';
        // refundMethod stays a single string for older report/receipt code
        // that only ever expected one — 'Split' whenever there's more than
        // one row, same convention order.paymentMethod already uses.
        // payments (the new structured array) is the real per-method record.
        const refundMethod = validRefundRows.length === 1 ? validRefundRows[0].method : (validRefundRows.length > 1 ? 'Split' : (refundMethods[0] || 'Cash'));

        confirmBtn.disabled = true;
        try {
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
            refundMethod: refundMethod,
            payments: validRefundRows
          });
          closeModal();
          showToast('Purchase return processed successfully!', 'success');
          if (onSuccess) await onSuccess();
        } catch (err) {
          confirmBtn.disabled = false;
          showToast(err.message || 'Failed to process return.', 'error');
        }
      };
    }, 0);
  }

  updateModal();
}

async function renderCustomerReport(container, cur) {
  const customers = await getCustomers(currentBranchFilter);
  const orders = await getOrders(currentBranchFilter, currentStartDate, currentEndDate);

  // Calculate analytics — tier comes from c.tier (already computed by
  // getCustomers() off the customer's real lifetime totalSpent, using the
  // same Settings > General thresholds/rates every other tier badge in the
  // app reads). This used to recompute its own separate Bronze/Silver/
  // Gold/Platinum tier from only THIS report's date-range-filtered orders,
  // with different hardcoded thresholds and a "Bronze" tier that exists
  // nowhere else — the same customer could show two different tiers
  // depending which screen you looked at. "Total Spent" here intentionally
  // stays scoped to the report's date range (that's this report's whole
  // point), it just no longer doubles as the tier calculation too.
  const processed = customers.map(c => {
    const custOrders = orders.filter(o => o.customer?.id === c.id && o.status !== 'cancelled');
    const spentInRange = custOrders.reduce((s, o) => s + (o.total || 0), 0);

    return {
      ...c,
      orderCount: custOrders.length,
      totalSpent: spentInRange
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
                    <div class="font-bold">${escapeHtml(c.name)}</div>
                    <div style="font-size:10px;margin-top:2px">
                      <span style="background:${c.tier.color}20;color:${c.tier.color};padding:1px 6px;border-radius:10px;border:1px solid ${c.tier.color}40;text-transform:uppercase;font-weight:700;font-size:9px">
                        <i class="fa-solid ${c.tier.icon}"></i> ${c.tier.name}
                      </span>
                    </div>
                    <div style="font-size:11px;color:var(--text-muted);margin-top:2px">ID: ${c.id}</div>
                  </div>
                </td>
                <td data-label="Phone">${escapeHtml(c.phone)}</td>
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
  // Net out returned value so a fully-returned purchase doesn't keep
  // inflating a supplier's lifetime spend total (see getPurchaseReturnedTotals()
  // in db.js — purchase.total is never mutated by a return).
  const returnedTotals = await getPurchaseReturnedTotals();

  const processed = suppliers.map(s => {
    const supPurchases = purchases.filter(p => p.supplierId === s.id);
    // 'Ordered' (not-yet-received) purchases still count toward orderCount
    // (an order WAS placed with this supplier) but not toward totalSpend —
    // same reasoning as renderPurchaseReport()'s totalSpend above.
    const receivedSupPurchases = supPurchases.filter(p => p.status !== 'Ordered');
    return {
      ...s,
      orderCount: supPurchases.length,
      totalSpend: receivedSupPurchases.reduce((sum, p) => sum + Math.max(0, (p.total || 0) - (returnedTotals[p.id] || 0)), 0)
    };
  }).sort((a, b) => b.totalSpend - a.totalSpend);

  supplierReportPage = 1;
  const canExportSup = await hasPermission('reports:export');

  container.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div class="font-bold">Supplier Purchase Analysis</div>
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
                    <div class="font-bold">${escapeHtml(s.name)}</div>
                    <div style="font-size:11px;color:var(--text-muted)">ID: ${s.id}</div>
                  </div>
                </td>
                <td data-label="Contact">${escapeHtml(s.contact)}</td>
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
  wireTableExport('suppliers', supplierTableEl, 'Supplier Purchase Analysis', () => processed.map(supplierRowHtml).join(''));
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
      if (!map[rate]) map[rate] = { rate, taxable: 0, tax: 0, igstTax: 0 };
      const { taxValueNet, itemTax } = computeSalesItemTax(item);
      map[rate].taxable += taxValueNet;
      map[rate].tax += itemTax;
      // Tracked separately (not mixed into CGST+SGST) — an inter-state sale
      // at this rate is legally IGST, never split in half.
      if (o.isInterState) map[rate].igstTax += itemTax;
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
    if (!map[rate]) map[rate] = { rate, taxable: 0, tax: 0, igstTax: 0, count: 0 };
    map[rate].taxable += (p.subtotal || p.total || 0);
    map[rate].tax += (p.taxAmount || 0);
    // Tracked separately (not mixed into CGST+SGST) — an inter-state
    // purchase at this rate is legally IGST, never split in half.
    if (p.isInterState) map[rate].igstTax += (p.taxAmount || 0);
    map[rate].count += 1;
  });
  return Object.values(map).sort((a, b) => a.rate - b.rate);
}

async function renderGSTReport(container, cur) {
  const orders = (await getOrders(currentBranchFilter, currentStartDate, currentEndDate)).filter(o => o.status !== 'cancelled');
  // ITC can only be claimed once goods are actually received (CGST Act,
  // Sec 16(2)(b)) — a purchase still at 'Ordered' hasn't met that yet, so it's
  // excluded from input tax credit the same way it's excluded from cost/
  // outstanding aggregates elsewhere.
  const purchases = (await getPurchases(currentBranchFilter, currentStartDate, currentEndDate)).filter(p => p.status !== 'Ordered');
  const salesReturns = (await getReturns(currentBranchFilter, currentStartDate, currentEndDate)).filter(r => r.type === 'sales');

  // Net sales returns into the same item-level computation as orders, instead
  // of ignoring them — otherwise this report keeps showing tax as owed on
  // sales that were subsequently refunded, overstating what's actually
  // payable. finalTax is already scaled to the returned quantity (see
  // Orders.js's saveReturn call), so negating qty + finalTax here nets each
  // return straight into whichever HSN/rate bucket its original sale fell in.
  const returnOrders = salesReturns.map(ret => ({
    items: (ret.items || []).map(i => ({ ...i, qty: -(parseFloat(i.qty) || 0), finalTax: -(parseFloat(i.finalTax) || 0) }))
  }));
  const ordersNetOfReturns = [...orders, ...returnOrders];

  const inputGST = purchases.reduce((sum, p) => sum + (p.taxAmount || 0), 0);
  const inputTaxable = purchases.reduce((sum, p) => sum + (p.subtotal || p.total || 0), 0);
  const canExportGst = await hasPermission('reports:export');
  const settings = await getSettings();
  const periodLabel = `${new Date(currentStartDate).toLocaleDateString('en-GB')} to ${new Date(currentEndDate).toLocaleDateString('en-GB')}`;

  const hsnSummary = computeHsnWiseSummary(ordersNetOfReturns);
  const rateSummarySales = computeRateWiseSummary(ordersNetOfReturns);
  const rateSummaryPurchases = computePurchaseRateWiseSummary(purchases);

  // Derived from the same rate-wise summary the table below renders, so the
  // top summary card can never disagree with it (both already net of returns).
  const outputGST = rateSummarySales.reduce((sum, r) => sum + r.tax, 0);
  const outputTaxable = rateSummarySales.reduce((sum, r) => sum + r.taxable, 0);
  const netPayable = outputGST - inputGST;

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
          <thead><tr><th>Tax Rate</th><th>Taxable Value</th><th>CGST</th><th>SGST</th><th>IGST</th><th>Total Tax</th></tr></thead>
          <tbody>
            ${rateSummarySales.length === 0 ? '<tr><td colspan="6" style="text-align:center;padding:20px;opacity:0.5">No sales recorded</td></tr>' : rateSummarySales.map(r => {
              const cgstSgstTax = r.tax - r.igstTax;
              return `
              <tr>
                <td data-label="Tax Rate">${r.rate}%</td>
                <td data-label="Taxable Value">${cur}${r.taxable.toFixed(2)}</td>
                <td data-label="CGST">${cur}${(cgstSgstTax / 2).toFixed(2)}</td>
                <td data-label="SGST">${cur}${(cgstSgstTax / 2).toFixed(2)}</td>
                <td data-label="IGST">${cur}${r.igstTax.toFixed(2)}</td>
                <td data-label="Total Tax" class="font-bold text-accent">${cur}${r.tax.toFixed(2)}</td>
              </tr>
            `;
            }).join('')}
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
          <thead><tr><th>Tax Rate</th><th>Taxable Value</th><th>CGST</th><th>SGST</th><th>IGST</th><th>Total Tax</th><th>No. of Purchases</th></tr></thead>
          <tbody>
            ${rateSummaryPurchases.length === 0 ? '<tr><td colspan="7" style="text-align:center;padding:20px;opacity:0.5">No purchases recorded</td></tr>' : rateSummaryPurchases.map(r => {
              const cgstSgstTax = r.tax - r.igstTax;
              return `
              <tr>
                <td data-label="Tax Rate">${r.rate}%</td>
                <td data-label="Taxable Value">${cur}${r.taxable.toFixed(2)}</td>
                <td data-label="CGST">${cur}${(cgstSgstTax / 2).toFixed(2)}</td>
                <td data-label="SGST">${cur}${(cgstSgstTax / 2).toFixed(2)}</td>
                <td data-label="IGST">${cur}${r.igstTax.toFixed(2)}</td>
                <td data-label="Total Tax" class="font-bold text-info">${cur}${r.tax.toFixed(2)}</td>
                <td data-label="No. of Purchases">${r.count}</td>
              </tr>
            `;
            }).join('')}
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
    // Inter-state sale — GST law requires IGST (not CGST+SGST) here. Reusing
    // the existing two columns rather than restructuring the table: the
    // SGST column doubles as the IGST amount, clearly labelled, so this
    // still reads correctly without a header/colspan change.
    const isInter = !!o.isInterState;
    return `
                <tr>
                  <td data-label="Date">${new Date(o.date).toLocaleDateString()}</td>
                  <td data-label="Customer">${escapeHtml(o.customer?.name || 'Walk-in')}</td>
                  <td data-label="Invoice ID" class="font-mono" style="font-size:11px">${o.id}</td>
                  <td data-label="Taxable Amt">${cur}${(o.subtotal || 0).toFixed(2)}</td>
                  <td data-label="CGST">${isInter ? '—' : `${cur}${(gstAmt / 2).toFixed(2)}`}</td>
                  <td data-label="SGST">${isInter ? `${cur}${gstAmt.toFixed(2)} (IGST)` : `${cur}${(gstAmt / 2).toFixed(2)}`}</td>
                  <td data-label="Total GST" class="font-bold text-accent">${cur}${gstAmt.toFixed(2)}</td>
                </tr>
              `;
  }

  function gstInputRowHtml(p) {
    const gstAmt = p.taxAmount || 0;
    const isInter = !!p.isInterState;
    return `
                <tr>
                  <td data-label="Date">${new Date(p.date).toLocaleDateString()}</td>
                  <td data-label="Supplier">${escapeHtml(p.supplierName)}</td>
                  <td data-label="Purchase ID" class="font-mono" style="font-size:11px">${p.id}</td>
                  <td data-label="Taxable Amt">${cur}${(p.subtotal || p.total).toFixed(2)}</td>
                  <td data-label="CGST">${isInter ? '—' : `${cur}${(gstAmt / 2).toFixed(2)}`}</td>
                  <td data-label="SGST">${isInter ? `${cur}${gstAmt.toFixed(2)} (IGST)` : `${cur}${(gstAmt / 2).toFixed(2)}`}</td>
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
                    <div class="font-bold">${escapeHtml(s.name)}</div>
                    <div style="font-size:11px;opacity:0.6">${escapeHtml(s.phone || '')}</div>
                  </div>
                </td>
                <td data-label="Role"><span class="badge badge-primary">${escapeHtml(s.specialization || 'Artist')}</span></td>
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
                <td data-label="Staff">${escapeHtml(i.staffName)}</td>
                <td data-label="Order ID" style="font-size:11px;opacity:0.7">${i.orderId}</td>
                <td data-label="Total">${cur}${i.orderTotal.toFixed(2)}</td>
                <td data-label="Incentive" class="font-bold ${i.amount < 0 ? 'text-danger' : 'text-success'}">${i.amount < 0 ? '-' : '+'}${cur}${Math.abs(i.amount).toFixed(2)}</td>
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

  // Filter shifts by date range — compare local calendar day (localDateOnly),
  // not the raw UTC openedAt timestamp against a plain YYYY-MM-DD boundary:
  // for IST, a shift opened between local midnight and 5:30am is still
  // UTC-dated the previous day, so it was silently excluded from a report
  // filtered for the day it actually opened on.
  const shifts = (shiftsRaw || []).filter(s => {
    const isBranchMatch = !currentBranchFilter || s.branchId === currentBranchFilter;
    const openedDay = localDateOnly(s.openedAt);
    const isDateMatch = (!currentStartDate || openedDay >= currentStartDate) && (!currentEndDate || openedDay <= currentEndDate);
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
                const branchName = escapeHtml(branches.find(b => b.id === s.branchId)?.name || 'Branch');
                const regName = escapeHtml(registers.find(r => r.id === s.registerId)?.name || s.registerId || 'Main Terminal');
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
                      <div class="badge badge-ghost" style="font-size:11px">${escapeHtml(s.openedBy || 'Staff')}</div>
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
              <div class="font-bold">${escapeHtml(shift.openedBy || '—')} / ${escapeHtml(regName)}</div>
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
              <div style="font-size:13px;font-style:italic">${escapeHtml(shift.notes)}</div>
            </div>
          ` : ''}
        </div>
      `,
      footer: `<button class="btn btn-primary" onclick="closeModal()">Close Audit View</button>`
    });
  });
}

// Worst-of-all-variants status, same rule Products.js's own overall-status
// badge uses — checking only the aggregate p.stock/p.minStock (a derived sum
// across variants, see db.js) against one threshold missed a product where a
// single variant was critically low while others kept the total looking fine.
function getProductOverallStockStatus(p) {
  if (p.variants && p.variants.length > 0) {
    const statuses = p.variants.map(v => getStockStatus(v.stock, v.minStock));
    return statuses.every(s => s === 'out') ? 'out' : (statuses.some(s => s !== 'in') ? 'low' : 'in');
  }
  return getStockStatus(p.stock, p.minStock);
}

async function renderLowStockReport(container, cur) {
  const products = await getProducts(currentBranchFilter);
  const lowStockItems = products.filter(p => getProductOverallStockStatus(p) !== 'in');
  const canExportLow = await hasPermission('reports:export');
  const canManageInventory = await hasPermission('inventory:manage');

  function lowStockRowHtml(p) {
    const isVariant = p.variants && p.variants.length > 0;
    const status = getProductOverallStockStatus(p);
    const isOut = status === 'out';
    // A single threshold/progress-bar only means something for a product
    // that has one stock number — a variant product's variants can each have
    // their own minStock, so there's no one "threshold" to show a bar against.
    const threshold = (p.minStock != null && p.minStock > 0) ? p.minStock : DEFAULT_LOW_STOCK_THRESHOLD;
    const barPct = isVariant ? 100 : Math.min(100, ((p.stock || 0) / threshold) * 100);
    return `
                <tr>
                  <td data-label="Product">
                    <div style="display:flex;align-items:center;gap:12px;justify-content:flex-start">
                      <span style="font-size:24px">${p.emoji || '📦'}</span>
                      <div style="text-align:left">
                        <div class="font-bold">${escapeHtml(p.name)}</div>
                        <div style="font-size:11px;opacity:0.6">ID: ${p.id}</div>
                      </div>
                    </div>
                  </td>
                  <td data-label="Category"><span class="badge badge-ghost">${escapeHtml(p.category || 'General')}</span></td>
                  <td data-label="Stock" class="font-bold cursor-help" title="${isVariant ? 'Threshold varies by variant' : `Threshold: ${threshold}`}">
                    <span class="${isOut ? 'text-danger' : 'text-warning'}">${parseFloat(Number(p.stock || 0).toFixed(3))}${isVariant ? ' (Total)' : ''}</span>
                  </td>
                  <td data-label="Status">
                    <div style="display:flex;align-items:center;gap:8px;justify-content:flex-start">
                      <div style="flex:1;background:var(--bg-main);height:6px;border-radius:3px;overflow:hidden;width:80px">
                        <div style="width:${barPct}%;background:${isOut ? 'var(--danger)' : 'var(--warning)'};height:100%"></div>
                      </div>
                      <span style="font-size:10px;font-weight:700;color:${isOut ? 'var(--danger)' : 'var(--warning)'}">
                        ${isOut ? 'OUT' : 'LOW'}
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
          ${lowStockItems.length > 0 && canManageInventory ? `<button class="btn btn-primary btn-sm" id="createPoFromLowStockBtn"><i class="fa-solid fa-wand-magic-sparkles mr-4"></i> Create Purchase Order</button>` : ''}
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

  const createPoBtn = document.getElementById('createPoFromLowStockBtn');
  if (createPoBtn) {
    createPoBtn.onclick = async () => {
      createPoBtn.disabled = true;
      try {
        // Independent of this table's own (one-row-per-product) view —
        // getReorderSuggestions() breaks a variant product out per-variant,
        // which is what a real Purchase Order line item needs.
        const suggestions = await getReorderSuggestions(currentBranchFilter);
        if (suggestions.length === 0) {
          showToast('No low-stock items to reorder right now', 'info');
          return;
        }
        const { openPurchaseForm } = await import('./Purchases.js');
        await openPurchaseForm(container, suggestions.map(s => ({ id: s.id, name: s.name, variantName: s.variantName, qty: s.suggestedQty, cost: s.cost })));
      } finally {
        createPoBtn.disabled = false;
      }
    };
  }
}

async function renderReturnsReport(container, cur) {
  const returnsSorted = (await getReturns(currentBranchFilter, currentStartDate, currentEndDate)).slice().reverse();
  const canExport = await hasPermission('reports:export');
  const settings = await getSettings();

  returnsReportPage = 1;

  container.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div class="font-bold"><i class="fa-solid fa-rotate-left mr-8 text-danger"></i> Returns History (Sales & Purchase)</div>
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
                    ${r.items.map(i => `${i.qty} x ${escapeHtml(i.name)}`).join('<br>')}
                  </td>
                  <td data-label="Total Value" class="font-bold text-danger">${cur}${r.total.toFixed(2)}</td>
                  <td data-label="Method"><span class="badge badge-warning">${r.refundMethod || 'Cash'}</span></td>
                  <td data-label="Reason" style="font-size:11px;opacity:0.8">${escapeHtml(r.reason)}</td>
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

function renderPaymentChart(orders, returns, cur) {
  const ctx = document.getElementById('paymentChart');
  if (!ctx) return;
  const methods = {};
  orders.forEach(o => {
    if (o.payments) {
      o.payments.forEach(p => {
        methods[p.method] = (methods[p.method] || 0) + p.amount;
      });
      // Redeemed loyalty points reduce the amount actually collected via a
      // payment method (CheckoutService.js always computes payments as
      // `total - redeemedPoints`), so without its own bucket here the
      // redeemed value silently vanished from the chart instead of
      // appearing anywhere, even though the "Net Sales" card counts it
      // as part of the order's full total.
      if (o.redeemedPoints) {
        methods['Loyalty Points'] = (methods['Loyalty Points'] || 0) + o.redeemedPoints;
      }
    } else {
      methods[o.paymentMethod] = (methods[o.paymentMethod] || 0) + o.total;
    }
  });
  // Net sales returns out of whichever method they were refunded against —
  // matches the "Net Sales" stat card just above this chart (grossTotal -
  // returnsTotal); without this, the chart's slices summed to the
  // pre-return gross total while the card next to it showed the post-return
  // net, visibly disagreeing on the same screen.
  (returns || []).forEach(r => {
    // Same fix as the orders loop above — a split refund's actual
    // per-method amounts live in r.payments now; only fall back to the
    // single refundMethod+total when there's no structured breakdown
    // (single-method refunds, or older records predating it).
    if (r.payments && r.payments.length > 0) {
      r.payments.forEach(p => {
        const method = p.method || 'Cash';
        methods[method] = (methods[method] || 0) - (p.amount || 0);
      });
    } else {
      const method = r.refundMethod || 'Cash';
      methods[method] = (methods[method] || 0) - (r.total || 0);
    }
  });
  // Drop any bucket that nets to ~0 or negative (e.g. a refund larger than
  // that method's own bucket after a payment-method rename) rather than
  // rendering a confusing negative pie slice.
  Object.keys(methods).forEach(k => { if (methods[k] <= 0.005) delete methods[k]; });
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

function renderProcurementChart(data, cur = '₹') {
  const ctx = document.getElementById('procurementChart');
  if (!ctx || !data) return;
  if (procurementChart) { procurementChart.destroy(); procurementChart = null; }

  procurementChart = new Chart(ctx, {
    // Both bars now (was bar + line) — grouped side by side per bucket, on
    // two axes since ₹ and count are on completely different scales. Safe
    // as a plain grouped bar here (unlike the Sales-vs-Purchases chart,
    // which needed a hand-packed single-dataset layout to avoid gaps) —
    // getPurchasesTrend() only ever creates a bucket where a purchase
    // actually happened, so count and cost are always both present
    // together; there's no sparse/missing-value case to leave a gap here.
    data: {
      labels: data.map(d => d.label),
      datasets: [
        {
          type: 'bar',
          label: 'Purchases Made',
          data: data.map(d => d.count),
          backgroundColor: 'rgba(99, 102, 241, 0.65)',
          hoverBackgroundColor: 'rgba(99, 102, 241, 0.85)',
          borderRadius: 6,
          borderSkipped: false,
          yAxisID: 'yCount',
        },
        {
          type: 'bar',
          label: 'Purchase Cost',
          data: data.map(d => d.total),
          backgroundColor: 'rgba(245, 158, 11, 0.65)',
          hoverBackgroundColor: 'rgba(245, 158, 11, 0.85)',
          borderRadius: 6,
          borderSkipped: false,
          yAxisID: 'yCost',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: { color: '#94a3b8', boxWidth: 12, boxHeight: 12, usePointStyle: true, pointStyle: 'circle' }
        },
        tooltip: {
          backgroundColor: 'rgba(17, 24, 39, 0.92)',
          padding: 12,
          cornerRadius: 8,
          titleFont: { weight: '700' },
          callbacks: {
            label: (item) => item.dataset.yAxisID === 'yCost'
              ? `Purchase Cost: ${cur}${item.parsed.y.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : `Purchases Made: ${item.parsed.y}`
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#94a3b8' } },
        yCost: {
          position: 'left',
          beginAtZero: true,
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#f59e0b', callback: (v) => `${cur}${v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v}` },
          title: { display: true, text: 'Purchase Cost', color: '#f59e0b', font: { size: 11, weight: '600' } }
        },
        yCount: {
          position: 'right',
          beginAtZero: true,
          grid: { drawOnChartArea: false },
          ticks: { color: '#818cf8', precision: 0 },
          title: { display: true, text: 'Purchases Made', color: '#818cf8', font: { size: 11, weight: '600' } }
        },
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
             <div style="font-size:13px">${escapeHtml(log.registerName || 'N/A')}</div>
             <div style="font-size:10px;opacity:0.5">${escapeHtml(log.branchName || '')}</div>
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
  const customerName = escapeHtml(order.customer?.name || 'Walk-in Customer');
  const rate = order.taxRate || 0;
  const halfRate = (rate / 2).toFixed(1);
  const gstAmt = order.tax || 0;
  const halfGst = (gstAmt / 2).toFixed(2);

  const itemRows = (order.items && order.items.length) ? order.items.map((item, idx) => `
    <tr>
      <td style="padding:6px 8px; border-right:1px solid #ccc;">${idx + 1}</td>
      <td style="padding:6px 8px; border-right:1px solid #ccc;">${escapeHtml(item.name)}${item.variantName ? ` (${escapeHtml(item.variantName)})` : ''}</td>
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
        <div style="position:absolute; right:14px; top:10px; font-size:10px; font-weight:bold; text-align:right;">
          Cell : ${[settings.storePhone, settings.storeAltPhone].filter(Boolean).join(', ')}
          ${settings.storeFax ? `<br/>Fax : ${settings.storeFax}` : ''}
          ${settings.email ? `<br/>Email : ${settings.email}` : ''}
        </div>
        ${settings.receiptHeader ? `<div style="font-size:11px; font-weight:600; opacity:0.85; margin-top:16px;">${settings.receiptHeader}</div>` : ''}
        <div style="display:flex; align-items:center; justify-content:center; gap:10px; margin-top:${settings.receiptHeader ? '4px' : '16px'};">
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
        ${order.isInterState ? `
        <tr>
          <td style="padding:6px 8px; text-align:right; border-right:1px solid #333;" colspan="5">IGST ${rate.toFixed(1)}%</td>
          <td style="padding:6px 8px; text-align:right;">${cur}${gstAmt.toFixed(2)}</td>
        </tr>
        ` : `
        <tr>
          <td style="padding:6px 8px; text-align:right; border-right:1px solid #333;" colspan="5">CGST ${halfRate}%</td>
          <td style="padding:6px 8px; text-align:right;">${cur}${halfGst}</td>
        </tr>
        <tr>
          <td style="padding:6px 8px; text-align:right; border-right:1px solid #333; border-top:1px solid #ddd;" colspan="5">SGST ${halfRate}%</td>
          <td style="padding:6px 8px; text-align:right; border-top:1px solid #ddd;">${cur}${halfGst}</td>
        </tr>
        `}
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
    purchases: purchases.map(p => {
      const isInter = !!p.isInterState;
      const taxAmt = p.taxAmount || 0;
      return {
        ctin: p.supplierGstin || "UNREGISTERED",
        inum: p.supplierInvoiceNo || p.id,
        idt: new Date(p.date).toLocaleDateString('en-GB'),
        val: p.total,
        pos: p.placeOfSupply || "33",
        rchrg: "N",
        inv_typ: "R",
        txval: p.subtotal || p.total,
        rt: p.taxRate || 0,
        iamt: isInter ? taxAmt : 0,
        camt: isInter ? 0 : taxAmt / 2,
        samt: isInter ? 0 : taxAmt / 2,
        supplierName: p.supplierName
      };
    })
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
  const validOrders = orders.filter(o => o.status !== 'cancelled');
  const gstr1 = {
    gstin: settings.gstNumber || "NOT_PROVIDED",
    fp: new Date().toLocaleString('en-IN', { month: '2-digit', year: 'numeric' }).replace('/', ''),
    gt: validOrders.reduce((s, o) => s + (o.total || 0), 0),
    cur_gt: validOrders.reduce((s, o) => s + (o.total || 0), 0),
    b2b: [],
    b2cs: [],
    hsn: { data: [] }
  };

  const hsnMap = {};
  // b2cs entries are bucketed by tax rate across the whole filing period
  // (not per-invoice, unlike b2b) — same aggregation shape as hsnMap below,
  // keyed by rate instead of HSN code.
  const b2csMap = {};

  // Same taxable-value/tax split computeSalesItemTax() above already uses
  // (kept inline here since this function works off raw order objects).
  const itemTaxSplit = (item) => {
    const itemTax = item.finalTax || 0;
    const lineTotal = item.price * item.qty;
    const discountTotal = item.itemDiscountType === 'pct'
      ? (lineTotal * (item.itemDiscount || 0) / 100)
      : ((item.itemDiscount || 0) * item.qty);
    const discountedTotal = Math.max(0, lineTotal - discountTotal);
    const taxValueNet = item.taxType === 'inclusive' ? discountedTotal - itemTax : discountedTotal;
    return { taxValueNet, itemTax };
  };

  validOrders.forEach(o => {
    // Bucket THIS invoice's own items by their actual tax rate — a single
    // order can legitimately mix rates (e.g. a 5%-rated and an 18%-rated
    // product in the same cart), and each rate needs its own itm_det/b2cs
    // entry built from its own real taxable value and tax. The previous
    // version used `o.taxRate` for the whole order, which is just the
    // shop's global default Settings tax rate (Settings > Tax Rate) —
    // completely unrelated to what any specific order's items were
    // actually charged, and wrong whenever an order's rate differs from
    // that default (the common case for a multi-rate catalog).
    const rateGroups = {};
    (o.items || []).forEach(item => {
      const rate = parseFloat(item.taxRate) || 0;
      const { taxValueNet, itemTax } = itemTaxSplit(item);
      if (!rateGroups[rate]) rateGroups[rate] = { txval: 0, tax: 0 };
      rateGroups[rate].txval += taxValueNet;
      rateGroups[rate].tax += itemTax;
    });

    // Place of Supply: the customer's own billing state for an inter-state
    // sale (that's the actual point of the "place of supply" field — where
    // the sale is legally deemed to happen), this branch's own state
    // otherwise. Falls back to this branch's state if a genuinely
    // inter-state order somehow has no customer state on file (shouldn't
    // happen — isInterState is only ever set when one is — but a GSTR-1 row
    // should never end up with a blank pos).
    const isInter = !!o.isInterState;
    const posCode = isInter ? (o.customer?.stateCode || settings.stateCode || "33") : (settings.stateCode || "33");

    if (o.customer?.gstin) {
      let b2bEntry = gstr1.b2b.find(ctin => ctin.ctin === o.customer.gstin);
      if (!b2bEntry) {
        b2bEntry = { ctin: o.customer.gstin, inv: [] };
        gstr1.b2b.push(b2bEntry);
      }
      const itms = Object.entries(rateGroups).map(([rate, g], idx) => ({
        num: idx + 1,
        itm_det: {
          rt: parseFloat(rate),
          txval: parseFloat(g.txval.toFixed(2)),
          iamt: isInter ? parseFloat(g.tax.toFixed(2)) : 0,
          camt: isInter ? 0 : parseFloat((g.tax / 2).toFixed(2)),
          samt: isInter ? 0 : parseFloat((g.tax / 2).toFixed(2)),
          csamt: 0
        }
      }));
      b2bEntry.inv.push({
        inum: o.id,
        idt: new Date(o.date).toLocaleDateString('en-GB'),
        val: o.total,
        pos: posCode,
        rchrg: "N",
        inv_typ: "R",
        itms
      });
    } else {
      Object.entries(rateGroups).forEach(([rate, g]) => {
        // Keyed on rate+pos+supply-type, not rate alone — an inter-state
        // sale to one destination state must never be merged into the same
        // bucket as an intra-state sale at the same rate (or, now that
        // multiple destination states are possible, another inter-state
        // sale to a DIFFERENT one).
        const mapKey = `${rate}_${posCode}_${isInter ? 'INTER' : 'INTRA'}`;
        if (!b2csMap[mapKey]) {
          b2csMap[mapKey] = { sply_ty: isInter ? "INTER" : "INTRA", pos: posCode, typ: "OE", rt: parseFloat(rate), txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
        }
        b2csMap[mapKey].txval += g.txval;
        if (isInter) {
          b2csMap[mapKey].iamt += g.tax;
        } else {
          b2csMap[mapKey].camt += g.tax / 2;
          b2csMap[mapKey].samt += g.tax / 2;
        }
      });
    }

    (o.items || []).forEach(item => {
      const code = item.hsnCode || "9999";
      if (!hsnMap[code]) {
        hsnMap[code] = { hsn_sc: code, desc: item.name, uqc: "NOS", qty: 0, val: 0, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
      }

      const { taxValueNet, itemTax } = itemTaxSplit(item);

      hsnMap[code].qty += item.qty;
      hsnMap[code].val += taxValueNet + itemTax;
      hsnMap[code].txval += taxValueNet;
      if (isInter) {
        hsnMap[code].iamt += itemTax;
      } else {
        hsnMap[code].camt += itemTax / 2;
        hsnMap[code].samt += itemTax / 2;
      }
    });
  });

  gstr1.b2cs = Object.values(b2csMap).map(b => ({
    ...b,
    txval: parseFloat(b.txval.toFixed(2)),
    iamt: parseFloat(b.iamt.toFixed(2)),
    camt: parseFloat(b.camt.toFixed(2)),
    samt: parseFloat(b.samt.toFixed(2))
  }));
  gstr1.hsn.data = Object.values(hsnMap);

  const blob = new Blob([JSON.stringify(gstr1, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `GSTR1_${format(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
