// ============================================================
// Dashboard.js
// ============================================================

import { getTodaySales, getOrders, getReturns, getSettings, hasPermission, getProducts, updateProduct, logInventoryChange, getSession, getLowStockProducts, getReorderSuggestions, localDateOnly } from '../db.js';
import { store } from '../store.js';
import { applySessionFilter } from '../utils/sessionFilter.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { openModal, closeModal } from '../components/Modal.js';
import { paginate, renderPaginationBar } from '../utils/pagination.js';

let dateRangeType = 'today';
let customStartDate = '';
let customEndDate = '';
let dashClickDelegated = false;
// Reassigned on every renderDashboard() call and read by name (not closed
// over) from the delegated click handler below, which is attached only
// once (guarded by dashClickDelegated) — a plain const captured at first
// attachment would go stale on every subsequent render, same class of bug
// the dash-addstock-btn comment above already documents for this file.
let latestTopProductsMap = {};
let latestCur = '';

// Shared by the Top Products card (top 5) and the "View All Products" modal
// so the discount+tax-aware revenue formula only lives in one place.
function computeTopProductsMap(validOrders) {
  const prodMap = {};
  validOrders.forEach(o => {
    (o.items || []).forEach(item => {
      const name = item.name || 'Unknown';
      if (!prodMap[name]) prodMap[name] = { qty: 0, revenue: 0, emoji: item.emoji || '📦' };
      prodMap[name].qty += (item.qty || 1);
      const baseLineTotal = (item.price || 0) * (item.qty || 1);
      const discountTotal = item.itemDiscountType === 'pct'
        ? (baseLineTotal * (item.itemDiscount || 0) / 100)
        : ((item.itemDiscount || 0) * (item.qty || 1));
      const discountedTotal = Math.max(0, baseLineTotal - discountTotal);
      const lineRevenue = item.taxType === 'inclusive' ? discountedTotal : discountedTotal + (item.finalTax || 0);
      prodMap[name].revenue += lineRevenue;
    });
  });
  return prodMap;
}

export async function renderDashboard(container) {
  const settings = await getSettings();
  const cur = settings.currency;
  
  const rawOrders = await getOrders(store.branch?.id);
  const allRawOrders = await applySessionFilter(rawOrders, 'date');
  
  const now = new Date();

  // Matches by LOCAL calendar day (via localDateOnly, the same helper db.js
  // uses internally for its own date filtering) rather than a raw UTC ISO
  // string prefix — comparing a locally-shifted boundary string against the
  // order's raw UTC timestamp mismatched for any order placed in the early
  // hours local time (e.g. IST 00:00-05:30), which UTC still puts on the
  // previous day, misfiling it into "yesterday" instead of "today". Reused
  // for returns below so both are filtered by the exact same window.
  let matchesRange = () => true;
  if (dateRangeType === 'today') {
    const today = localDateOnly(now);
    matchesRange = (d) => localDateOnly(d) === today;
  } else if (dateRangeType === 'yesterday') {
    const yest = new Date(now);
    yest.setDate(yest.getDate() - 1);
    const yStr = localDateOnly(yest);
    matchesRange = (d) => localDateOnly(d) === yStr;
  } else if (dateRangeType === 'last7') {
    const sev = new Date(now);
    sev.setDate(sev.getDate() - 7);
    matchesRange = (d) => new Date(d) >= sev;
  } else if (dateRangeType === 'last30') {
    const thir = new Date(now);
    thir.setDate(thir.getDate() - 30);
    matchesRange = (d) => new Date(d) >= thir;
  } else if (dateRangeType === 'thisMonth') {
    const monthStr = localDateOnly(now).substring(0, 7);
    matchesRange = (d) => localDateOnly(d).startsWith(monthStr);
  } else if (dateRangeType === 'thisYear') {
    const yearStart = new Date(now.getFullYear(), 0, 1);
    matchesRange = (d) => new Date(d) >= yearStart;
  } else if (dateRangeType === 'lastYear') {
    const yearStart = new Date(now.getFullYear() - 1, 0, 1);
    const yearEnd = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59);
    matchesRange = (d) => {
      const dt = new Date(d);
      return dt >= yearStart && dt <= yearEnd;
    };
  } else if (dateRangeType === 'custom') {
    matchesRange = (d) => {
      const dOnly = localDateOnly(d);
      if (customStartDate && dOnly < customStartDate) return false;
      if (customEndDate && dOnly > customEndDate) return false;
      return true;
    };
  }

  const filteredOrders = allRawOrders.filter(o => matchesRange(o.date));
  const validOrders = filteredOrders.filter(o => o.status !== 'cancelled');

  // Net headline stats against sales returns in the same window — otherwise
  // a refunded sale keeps inflating Total Sales/Avg Order Value/the Payment
  // Breakdown donut indefinitely, same issue Reports.js's Sales Hub already
  // accounts for.
  const rawReturns = await getReturns(store.branch?.id);
  const salesReturns = rawReturns.filter(r => r.type === 'sales' && matchesRange(r.date));
  const returnsTotal = salesReturns.reduce((s, r) => s + (r.total || 0), 0);

  const grossTotal = validOrders.reduce((s, o) => s + (o.total || 0), 0);
  const total = grossTotal - returnsTotal;
  const count = filteredOrders.length;
  const avgOrder = count ? (total / count).toFixed(2) : 0;
  
  const lowStockItemsRaw = await getLowStockProducts(store.branch?.id);
  
  // Flatten variants for dashboard view so it counts properly
  const lowStockItems = [];
  lowStockItemsRaw.forEach(p => {
    if (p.variants && p.variants.length > 0) {
      const lowVariants = p.variants.filter(v => (v.stock || 0) <= (v.minStock || 10));
      lowVariants.forEach(v => {
        lowStockItems.push({
          ...p,
          isVariant: true,
          variantName: v.name,
          stock: v.stock || 0
        });
      });
    } else {
      lowStockItems.push({
        ...p,
        isVariant: false,
        stock: p.stock || 0
      });
    }
  });

  const getSubTitleMsg = () => {
     if (dateRangeType === 'today') return "Here's what's happening today";
     if (dateRangeType === 'yesterday') return "Here's what happened yesterday";
     if (dateRangeType === 'last7') return "Here's what happened in the last 7 days";
     if (dateRangeType === 'last30') return "Here's what happened in the last 30 days";
     if (dateRangeType === 'thisMonth') return "Here's what's happening this month";
     if (dateRangeType === 'thisYear') return "Here's what's happening this year";
     if (dateRangeType === 'lastYear') return "Here's what happened last year";
     if (dateRangeType === 'all') return "Here's your all-time performance";
     return "Here's your performance for the selected range";
  };

  container.innerHTML = `
    <div id="dashboard-page">
      <!-- Dashboard Mobile Styles -->
      <style>
        @media (max-width: 900px) {
          #dashboard-page .page-header > div:last-child {
            width: 100% !important;
            flex-direction: column !important;
            align-items: stretch !important;
          }
          #dashboard-page .calendar-select-wrap,
          #dashboard-page .calendar-select-wrap select {
            width: 100% !important;
            min-width: 0 !important;
          }
          #dashboard-page .calendar-select-wrap select {
            height: 46px !important;
            font-size: 14px !important;
            border-radius: 12px !important;
          }
          #dashboard-page .btn-primary {
            height: 46px !important;
            font-weight: 700 !important;
            border-radius: 12px !important;
          }
        }
      </style>

      <div class="page-header" style="flex-wrap: wrap; gap: 16px;">
        <div>
          <div class="page-title">Good ${getGreeting()}, ${escapeHtml(settings.storeName)} 👋</div>
          <div class="page-subtitle">${getSubTitleMsg()}</div>
        </div>
        <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
          <div class="calendar-select-wrap">
            <i class="fa-solid fa-calendar-check select-icon"></i>
            <select id="dashDateRange" class="form-select" style="min-width:160px;">
              <option value="today" ${dateRangeType === 'today' ? 'selected' : ''} data-icon="fa-solid fa-calendar-day">Today</option>
              <option value="yesterday" ${dateRangeType === 'yesterday' ? 'selected' : ''} data-icon="fa-solid fa-calendar-minus">Yesterday</option>
              <option value="last7" ${dateRangeType === 'last7' ? 'selected' : ''} data-icon="fa-solid fa-calendar-week">Last 7 Days</option>
              <option value="last30" ${dateRangeType === 'last30' ? 'selected' : ''} data-icon="fa-solid fa-calendar">Last 30 Days</option>
              <option value="thisMonth" ${dateRangeType === 'thisMonth' ? 'selected' : ''} data-icon="fa-solid fa-calendar-days">This Month</option>
              <option value="thisYear" ${dateRangeType === 'thisYear' ? 'selected' : ''} data-icon="fa-solid fa-calendar-check">This Year (${new Date().getFullYear()})</option>
              <option value="lastYear" ${dateRangeType === 'lastYear' ? 'selected' : ''} data-icon="fa-solid fa-calendar-xmark">Last Year (${new Date().getFullYear() - 1})</option>
              <option value="all" ${dateRangeType === 'all' ? 'selected' : ''} data-icon="fa-solid fa-infinity">All Time</option>
              <option value="custom" ${dateRangeType === 'custom' ? 'selected' : ''} data-icon="fa-solid fa-calendar-plus">Custom Range...</option>
            </select>
          </div>
          ${dateRangeType === 'custom' ? `
            <div style="display:flex; gap:8px; align-items:center; background:var(--bg-elevated); padding:4px 12px; border-radius:12px; border:1px solid var(--border);">
              <input type="date" id="dashStartDate" class="form-input form-input-sm" value="${customStartDate}" max="${new Date().toISOString().split('T')[0]}" style="border:none; background:transparent;" />
              <span class="text-muted">to</span>
              <input type="date" id="dashEndDate" class="form-input form-input-sm" value="${customEndDate}" max="${new Date().toISOString().split('T')[0]}" style="border:none; background:transparent;" />
            </div>
          ` : ''}
          ${await hasPermission('pos:access') ? `
            <button class="btn btn-primary" onclick="window.navigate('restaurant-pos')">
              <i class="fa-solid fa-utensils"></i> New Order
            </button>
          ` : ''}
        </div>
      </div>

      <div class="grid-4 mb-24">
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(79,70,229,0.15)">
          <i class="fa-solid fa-coins" style="color:#818cf8"></i>
        </div>
        <div class="stat-info">
          <div class="stat-value">${cur}${total.toFixed(2)}</div>
          <div class="stat-label">Total Sales</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(16,185,129,0.15)">
          <i class="fa-solid fa-cart-shopping" style="color:#10b981"></i>
        </div>
        <div class="stat-info">
          <div class="stat-value">${count}</div>
          <div class="stat-label">Total Orders</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(245,158,11,0.15)">
          <i class="fa-solid fa-chart-simple" style="color:#f59e0b"></i>
        </div>
        <div class="stat-info">
          <div class="stat-value">${cur}${Number(avgOrder).toFixed(2)}</div>
          <div class="stat-label">Avg. Order Value</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(59,130,246,0.15)">
          <i class="fa-solid fa-receipt" style="color:#3b82f6"></i>
        </div>
        <div class="stat-info">
          <div class="stat-value">${validOrders.length}</div>
          <div class="stat-label">Successful Orders</div>
        </div>
      </div>
    </div>

    <div class="grid-3 gap-24">
      <!-- Low Stock Alerts -->
      <div class="card" style="border-top: 3px solid var(--danger)">
        <div class="flex items-center justify-between mb-16">
          <div class="flex items-center gap-8">
            <i class="fa-solid fa-triangle-exclamation text-danger"></i>
            <div class="font-bold" style="font-size:16px">Low Stock Alerts</div>
          </div>
          <span class="badge badge-danger">${lowStockItems.length} Items</span>
        </div>
        
        <div>
          ${(() => {
            const lowStock = lowStockItems.sort((a,b) => a.stock - b.stock);
            if (lowStock.length === 0) {
              return `
                <div class="empty-state" style="padding: 20px 0;">
                  <i class="fa-solid fa-circle-check text-success" style="font-size: 24px;"></i>
                  <p style="font-size: 13px;">All items are well-stocked</p>
                </div>
              `;
            }
            return lowStock.slice(0, 3).map((p, idx) => `
              <div class="dash-low-stock-row" data-product-id="${p.id}" style="display:flex; align-items:center; gap:12px; padding:12px 0; border-bottom: 1px solid var(--border-subtle);">
                <div style="font-size:20px">${p.emoji || '📦'}</div>
                <div style="flex:1; min-width:0;">
                  <div style="font-size:14px; font-weight:600">${escapeHtml(p.name)} ${p.isVariant ? `<span style="font-size:11px;opacity:0.7">(${escapeHtml(p.variantName)})</span>` : ''}</div>
                  <div style="font-size:11px; opacity:0.6">${escapeHtml(p.category)}</div>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                  <span style="font-size:13px; font-weight:700;" class="${p.stock <= 0 ? 'text-danger' : 'text-warning'}">${parseFloat(Number(p.stock).toFixed(3))}</span>

                  <div class="dash-quick-stock" style="display:flex; align-items:center; gap:4px;">
                    <input type="number" min="1" value="10" class="form-input dash-addqty-input" data-product-id="${p.id}" data-variant-name="${p.isVariant ? escapeHtml(p.variantName) : ''}" style="width:60px; padding:4px 6px; font-size:12px; text-align:center; border-radius:8px;" />
                    <button class="btn btn-sm dash-addstock-btn" data-product-id="${p.id}" data-variant-name="${p.isVariant ? escapeHtml(p.variantName) : ''}" style="padding:4px 10px; font-size:11px; background:rgba(16,185,129,0.15); color:#10b981; border:1px solid rgba(16,185,129,0.3); border-radius:8px; font-weight:700; white-space:nowrap;" title="Add stock">
                      <i class="fa-solid fa-plus" style="font-size:10px"></i> Add
                    </button>
                  </div>
                  
                </div>
              </div>
            `).join('');
          })()}
        </div>
        ${lowStockItems.length > 0 && await hasPermission('inventory:manage') ? `
          <button class="btn btn-primary btn-sm dash-create-po-btn" style="width:100%; margin-top:12px; font-size:12px;">
            <i class="fa-solid fa-wand-magic-sparkles mr-4"></i> Create Purchase Order for ${lowStockItems.length} Item${lowStockItems.length === 1 ? '' : 's'}
          </button>
        ` : ''}
        ${lowStockItems.length > 3 ? `
          <button class="btn btn-ghost btn-sm" style="width:100%; margin-top:8px; font-size:12px;" onclick="window.posFilterStock = 'Low Stock'; window.navigate('products')">
            <i class="fa-solid fa-arrow-right mr-4"></i> View All ${lowStockItems.length} Low Stock Items
          </button>
        ` : ''}
      </div>

      <!-- Payment Donut Chart -->
      <div class="card" style="grid-column: span 2">
        <div class="flex items-center justify-between mb-16">
          <div class="font-bold" style="font-size:16px"><i class="fa-solid fa-chart-pie mr-8" style="color:var(--primary)"></i>Payment Breakdown</div>
          <button class="btn btn-ghost btn-sm" onclick="window.navigate('orders')">View Orders</button>
        </div>
        ${(() => {
          // A Split order/refund has its actual per-method amounts in
          // .payments — bucketing by .paymentMethod ('Split', a fixed
          // label, not a real method) with the FULL total dumped in one
          // slice hid what was actually collected by each method. Break
          // each row into its own method's bucket instead; only orders
          // with no structured payments at all (single-method sales, or
          // older records predating this) fall back to the old
          // paymentMethod+total shortcut.
          const payMap = {};
          validOrders.forEach(o => {
            if (o.payments && o.payments.length > 0) {
              o.payments.forEach(p => {
                const m = p.method || 'Cash';
                payMap[m] = (payMap[m] || 0) + (p.amount || 0);
              });
            } else {
              const m = o.paymentMethod || 'Cash';
              payMap[m] = (payMap[m] || 0) + (o.total || 0);
            }
          });
          salesReturns.forEach(r => {
            if (r.payments && r.payments.length > 0) {
              r.payments.forEach(p => {
                const m = p.method || 'Cash';
                payMap[m] = (payMap[m] || 0) - (p.amount || 0);
              });
            } else {
              const m = r.refundMethod || 'Cash';
              payMap[m] = (payMap[m] || 0) - (r.total || 0);
            }
          });
          const entries = Object.entries(payMap).filter(([, v]) => v > 0.005).sort((a,b) => b[1] - a[1]);
          const payTotal = entries.reduce((s, [,v]) => s + v, 0);
          if (entries.length === 0) {
            return `<div class="empty-state" style="padding:30px 0"><i class="fa-solid fa-chart-pie"></i><p>No payment data for this period</p></div>`;
          }
          const colors = ['#818cf8','#34d399','#fbbf24','#f87171','#60a5fa','#a78bfa'];
          let cumulativePct = 0;
          const gradientParts = entries.map(([method, val], i) => {
            const pct = (val / payTotal) * 100;
            const start = cumulativePct;
            cumulativePct += pct;
            return colors[i % colors.length] + ' ' + start + '% ' + cumulativePct + '%';
          });
          return `
            <div style="display:flex; align-items:center; gap:32px; flex-wrap:wrap;">
              <div style="position:relative; width:140px; height:140px; flex-shrink:0;">
                <div style="width:140px; height:140px; border-radius:50%; background: conic-gradient(${gradientParts.join(', ')}); position:relative;">
                  <div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:80px; height:80px; border-radius:50%; background:var(--bg-surface); display:flex; flex-direction:column; align-items:center; justify-content:center;">
                    <div style="font-size:10px; color:var(--text-muted); font-weight:600;">TOTAL</div>
                    <div style="font-size:14px; font-weight:800; color:var(--text-primary)">${cur}${payTotal.toFixed(2)}</div>
                  </div>
                </div>
              </div>
              <div style="flex:1; display:flex; flex-direction:column; gap:10px;">
                ${entries.map(([method, val], i) => `
                  <div style="display:flex; align-items:center; gap:10px;">
                    <div style="width:12px; height:12px; border-radius:3px; background:${colors[i % colors.length]}; flex-shrink:0;"></div>
                    <div style="flex:1; font-size:13px; font-weight:600;">${method}</div>
                    <div style="font-size:13px; font-weight:700; color:var(--text-primary);">${cur}${val.toFixed(2)}</div>
                    <div style="font-size:11px; color:var(--text-muted); width:40px; text-align:right;">${((val/payTotal)*100).toFixed(0)}%</div>
                  </div>
                `).join('')}
              </div>
            </div>
          `;
        })()}
      </div>
    </div>

    <!-- Charts Row -->
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:24px; margin-top:24px;">
      <!-- Sales Trend Bar Chart -->
      <div class="card">
        <div class="font-bold mb-16" style="font-size:16px"><i class="fa-solid fa-chart-column mr-8" style="color:#818cf8"></i>Sales Trend</div>
        ${(() => {
          const dateMap = {};
          validOrders.forEach(o => {
            const d = o.date.split('T')[0];
            dateMap[d] = (dateMap[d] || 0) + (o.total || 0);
          });
          const dateEntries = Object.entries(dateMap).sort((a,b) => a[0].localeCompare(b[0])).slice(-7);
          if (dateEntries.length === 0) {
            return `<div class="empty-state" style="padding:30px 0"><i class="fa-solid fa-chart-column"></i><p>No sales data</p></div>`;
          }
          const maxVal = Math.max(...dateEntries.map(([,v]) => v));
          return `
            <div style="display:flex; align-items:flex-end; gap:8px; height:180px; padding-top:10px;">
              ${dateEntries.map(([date, val]) => {
                const pct = maxVal > 0 ? (val / maxVal) * 100 : 0;
                const label = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { day:'numeric', month:'short' });
                return `
                  <div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:6px; height:100%;">
                    <div style="font-size:10px; font-weight:700; color:var(--text-primary)">${cur}${val >= 1000 ? (val/1000).toFixed(2) + 'k' : val.toFixed(2)}</div>
                    <div style="flex:1; width:100%; display:flex; align-items:flex-end;">
                      <div style="width:100%; height:${Math.max(pct, 4)}%; background:linear-gradient(180deg, #818cf8 0%, #6366f1 100%); border-radius:8px 8px 4px 4px; min-height:4px;"></div>
                    </div>
                    <div style="font-size:10px; color:var(--text-muted); font-weight:500; white-space:nowrap;">${label}</div>
                  </div>
                `;
              }).join('')}
            </div>
          `;
        })()}
      </div>

      <!-- Top Selling Products -->
      <div class="card">
        <div class="font-bold mb-16" style="font-size:16px"><i class="fa-solid fa-trophy mr-8" style="color:#fbbf24"></i>Top Products</div>
        ${(() => {
          const prodMap = computeTopProductsMap(validOrders);
          latestTopProductsMap = prodMap;
          latestCur = cur;
          const allEntries = Object.entries(prodMap).sort((a,b) => b[1].revenue - a[1].revenue);
          const topProds = allEntries.slice(0, 5);
          if (topProds.length === 0) {
            return `<div class="empty-state" style="padding:30px 0"><i class="fa-solid fa-trophy"></i><p>No product data</p></div>`;
          }
          const maxRev = topProds[0]?.[1].revenue || 1;
          const barColors = ['#818cf8','#34d399','#fbbf24','#f87171','#60a5fa'];
          const rows = topProds.map(([name, data], i) => {
            const pct = (data.revenue / maxRev) * 100;
            return `
              <div style="margin-bottom:14px;">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
                  <div style="display:flex; align-items:center; gap:8px;">
                    <span style="font-size:16px">${data.emoji}</span>
                    <span style="font-size:13px; font-weight:600; color:var(--text-primary)">${escapeHtml(name)}</span>
                  </div>
                  <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size:11px; color:var(--text-muted)">${data.qty} sold</span>
                    <span style="font-size:13px; font-weight:700; color:var(--text-primary)">${cur}${data.revenue.toFixed(2)}</span>
                  </div>
                </div>
                <div style="height:8px; background:var(--bg-app); border-radius:4px; overflow:hidden;">
                  <div style="height:100%; width:${pct}%; background:${barColors[i]}; border-radius:4px;"></div>
                </div>
              </div>
            `;
          }).join('');
          const viewAllBtn = allEntries.length > 5 ? `
            <button class="btn btn-ghost" id="viewAllProductsBtn" style="width:100%; margin-top:4px; font-size:12px; padding:8px;">
              View All ${allEntries.length} Products <i class="fa-solid fa-arrow-right ml-4"></i>
            </button>
          ` : '';
          return rows + viewAllBtn;
        })()}
      </div>
    </div>

    <!-- Hourly Sales + Quick Actions -->
    <div class="grid-3 gap-24" style="margin-top:24px;">
      <!-- Hourly Sales -->
      <div class="card" style="grid-column: span 2">
        <div class="font-bold mb-16" style="font-size:16px"><i class="fa-solid fa-clock mr-8" style="color:#34d399"></i>Sales by Hour</div>
        ${(() => {
          const hourMap = {};
          for (let h = 6; h <= 23; h++) hourMap[h] = 0;
          validOrders.forEach(o => {
            const h = new Date(o.date).getHours();
            hourMap[h] = (hourMap[h] || 0) + (o.total || 0);
          });
          const hours = Object.entries(hourMap).filter(([h]) => Number(h) >= 6 && Number(h) <= 23);
          const maxH = Math.max(...hours.map(([,v]) => v), 1);
          return `
            <div style="display:flex; align-items:flex-end; gap:4px; height:120px;">
              ${hours.map(([hour, val]) => {
                const pct = (val / maxH) * 100;
                const h = Number(hour);
                const label = h > 12 ? (h-12)+'p' : (h === 0 ? '12a' : h+'a');
                const isActive = val > 0;
                return `
                  <div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:3px; height:100%;" title="${cur}${val.toFixed(2)} at ${hour}:00">
                    <div style="flex:1; width:100%; display:flex; align-items:flex-end;">
                      <div style="width:100%; height:${Math.max(pct, 3)}%; background:${isActive ? 'linear-gradient(180deg, #34d399 0%, #10b981 100%)' : 'var(--bg-app)'}; border-radius:4px 4px 2px 2px; min-height:3px;"></div>
                    </div>
                    <div style="font-size:8px; color:var(--text-muted); font-weight:500;">${label}</div>
                  </div>
                `;
              }).join('')}
            </div>
          `;
        })()}
      </div>

      <!-- Quick Actions -->
      <div class="card">
        <div class="font-bold mb-16" style="font-size:16px">Quick Actions</div>
        <div style="display:flex;flex-direction:column;gap:12px">
          ${await hasPermission('pos:access') ? `
            <button class="dash-quick-action dash-qa-primary" onclick="window.navigate('restaurant-pos')">
              <div class="dash-qa-icon-wrap">
                <i class="fa-solid fa-utensils"></i>
                <div class="dash-qa-pulse"></div>
              </div>
              <div style="text-align:left;flex:1">
                <div style="font-size:15px;font-weight:700">New Order</div>
                <div style="font-size:12px;opacity:0.7;font-weight:400">Dine-in, takeaway or delivery</div>
              </div>
              <i class="fa-solid fa-arrow-right dash-qa-arrow"></i>
              <div class="dash-qa-shimmer"></div>
            </button>
          ` : ''}
          ${await hasPermission('products:view') ? `
            <button class="dash-quick-action" onclick="window.navigate('products')">
              <div class="dash-qa-icon-wrap" style="background:rgba(245,158,11,0.12);color:var(--accent)">
                <i class="fa-solid fa-box"></i>
              </div>
              <div style="text-align:left;flex:1">
                <div style="font-size:15px;font-weight:700">Manage Products</div>
                <div style="font-size:12px;color:var(--text-muted);font-weight:400">Add or edit products</div>
              </div>
              <i class="fa-solid fa-arrow-right dash-qa-arrow"></i>
            </button>
          ` : ''}
          ${await hasPermission('reports:view') ? `
            <button class="dash-quick-action" onclick="window.navigate('reports')">
              <div class="dash-qa-icon-wrap" style="background:rgba(16,185,129,0.12);color:#10b981">
                <i class="fa-solid fa-chart-line"></i>
              </div>
              <div style="text-align:left;flex:1">
                <div style="font-size:15px;font-weight:700">View Reports</div>
                <div style="font-size:12px;color:var(--text-muted);font-weight:400">Sales analytics</div>
              </div>
              <i class="fa-solid fa-arrow-right dash-qa-arrow"></i>
            </button>
          ` : ''}
        </div>
      </div>
    </div>
    </div>
  `;

  // Attach Listeners
  const rangeSelect = document.getElementById('dashDateRange');
  if (rangeSelect) {
    rangeSelect.onchange = async (e) => {
      dateRangeType = e.target.value;
      if (dateRangeType === 'custom') {
        customStartDate = customStartDate || new Date().toISOString().split('T')[0];
        customEndDate = customEndDate || new Date().toISOString().split('T')[0];
      }
      await renderDashboard(container);
    };
  }

  const startDateInput = document.getElementById('dashStartDate');
  const endDateInput = document.getElementById('dashEndDate');

  if (startDateInput) {
    startDateInput.onchange = async (e) => {
      customStartDate = e.target.value;
      await renderDashboard(container);
    };
  }

  if (endDateInput) {
    endDateInput.onchange = async (e) => {
      customEndDate = e.target.value;
      await renderDashboard(container);
    };
  }

  // Quick Add Stock — event delegation on the container survives DOM
  // mutations, but the button/input identity is read straight from the
  // clicked element's own data-attributes (data-product-id/data-variant-name)
  // rather than an `idx` into the `lowStockItems` array captured in this
  // closure — that array goes stale the moment the dashboard re-renders
  // after this listener was first wired (this guard only ever attaches it
  // once), which was silently mapping clicks to the WRONG product once any
  // refresh had happened (periodic refresh, cart update, data-synced, etc.)
  // and threw "Product not found for ID" instead of updating anything.
  if (!dashClickDelegated) {
    dashClickDelegated = true;
    container.addEventListener('click', (e) => {
      const viewAllBtn = e.target.closest('#viewAllProductsBtn');
      if (viewAllBtn) openAllProductsModal(latestTopProductsMap, latestCur);
    });
    container.addEventListener('click', async (e) => {
      const poBtn = e.target.closest('.dash-create-po-btn');
      if (!poBtn) return;
      poBtn.disabled = true;
      try {
        const suggestions = await getReorderSuggestions(store.branch?.id);
        if (suggestions.length === 0) {
          if (window.showToast) window.showToast('No low-stock items to reorder right now', 'info');
          return;
        }
        const { openPurchaseForm } = await import('./Purchases.js');
        await openPurchaseForm(container, suggestions.map(s => ({ id: s.id, name: s.name, variantName: s.variantName, qty: s.suggestedQty, cost: s.cost })));
      } finally {
        poBtn.disabled = false;
      }
    });
    container.addEventListener('click', async (e) => {
      const btn = e.target.closest('.dash-addstock-btn');
      if (!btn) return;

      const productId = btn.dataset.productId;
      const variantName = btn.dataset.variantName || null;
      // Match by comparing the decoded .dataset property in JS rather than
      // splicing variantName into a CSS attribute-selector string — a
      // variant name containing a literal `"` would otherwise build an
      // invalid selector and throw, silently breaking this button for that
      // one variant.
      const candidates = container.querySelectorAll(`.dash-addqty-input[data-product-id="${CSS.escape(productId)}"]`);
      const input = Array.from(candidates).find(el => (el.dataset.variantName || '') === (variantName || ''));
      const qty = parseInt(input?.value) || 0;
      if (qty <= 0) {
        if (window.showToast) window.showToast('Enter a valid quantity', 'error');
        return;
      }

      const allProducts = await getProducts();
      const product = allProducts.find(p => String(p.id) === String(productId));
      if (!product) {
        console.error('[Dashboard] Product not found for ID:', productId);
        return;
      }

      let oldStock = 0;
      let newStock = 0;

      if (variantName) {
        const v = product.variants?.find(vx => vx.name === variantName);
        if (v) {
          oldStock = v.stock || 0;
          v.stock = oldStock + qty;
          newStock = v.stock;
        }
      } else {
        oldStock = product.stock || 0;
        product.stock = oldStock + qty;
        newStock = product.stock;
      }

      await updateProduct(product);

      // Log the inventory change — also fixes a pre-existing param-order bug
      // here that always passed `variantName` as `null` and the real variant
      // name into the `refId` slot instead, corrupting variant restock history.
      const session = await getSession();
      await logInventoryChange(
        product.id, variantName, 'IN', qty,
        'Quick Dashboard Restock',
        product.branchId || store.branch?.id || 'b1',
        null, oldStock, newStock,
        session?.user?.name || 'Admin'
      );

      if (window.showToast) window.showToast(`+${qty} added to ${escapeHtml(product.name)} ${variantName ? `(${escapeHtml(variantName)})` : ''} (now ${newStock})`, 'success');
      await renderDashboard(container);
    });
  }
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Morning';
  if (h < 17) return 'Afternoon';
  return 'Evening';
}

function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

// "View All Products" — the Top Products card only ever shows the top 5;
// this opens the same ranked list in full, searchable and paginated, reusing
// prodMap already computed by computeTopProductsMap() (no extra DB reads) and
// the shared paginate()/renderPaginationBar() helper (utils/pagination.js) so
// this doesn't hand-roll a third copy of the pagination-bar markup/wiring.
const ALL_PRODUCTS_PAGE_SIZE = 10;
const ALL_PRODUCTS_BAR_COLORS = ['#818cf8','#34d399','#fbbf24','#f87171','#60a5fa','#a78bfa','#f472b6','#22d3ee','#facc15','#4ade80'];

// Sort options for the "View All Products" modal — value encodes both the
// field ('revenue'|'qty') and direction so a single <select> can drive it.
const ALL_PRODUCTS_SORTS = {
  'revenue-desc': { field: 'revenue', dir: -1, label: 'Price: High to Low' },
  'revenue-asc':  { field: 'revenue', dir: 1,  label: 'Price: Low to High' },
  'qty-desc':     { field: 'qty',     dir: -1, label: 'Sold: High to Low' },
  'qty-asc':      { field: 'qty',     dir: 1,  label: 'Sold: Low to High' },
};

function openAllProductsModal(prodMap, cur) {
  const baseEntries = Object.entries(prodMap);
  const maxRev = baseEntries.reduce((m, [, d]) => Math.max(m, d.revenue), 0) || 1;
  const maxQty = baseEntries.reduce((m, [, d]) => Math.max(m, d.qty), 0) || 1;
  let page = 1;
  let searchTerm = '';
  let sortKey = 'revenue-desc';

  function getFiltered() {
    const { field, dir } = ALL_PRODUCTS_SORTS[sortKey];
    const sorted = [...baseEntries].sort((a, b) => (a[1][field] - b[1][field]) * dir);
    if (!searchTerm) return sorted;
    const q = searchTerm.toLowerCase();
    return sorted.filter(([name]) => name.toLowerCase().includes(q));
  }

  function renderRows(pageItems, startRank) {
    if (pageItems.length === 0) {
      return `<div class="empty-state" style="padding:30px 0"><i class="fa-solid fa-magnifying-glass"></i><p>No products found</p></div>`;
    }
    const barField = ALL_PRODUCTS_SORTS[sortKey].field;
    const barMax = barField === 'qty' ? maxQty : maxRev;
    return pageItems.map(([name, data], i) => {
      const rank = startRank + i + 1;
      const pct = barMax > 0 ? (data[barField] / barMax) * 100 : 0;
      const color = ALL_PRODUCTS_BAR_COLORS[(rank - 1) % ALL_PRODUCTS_BAR_COLORS.length];
      return `
        <div style="display:flex; align-items:center; gap:12px; padding:10px 4px; border-bottom:1px solid var(--border-subtle);">
          <div style="width:22px; text-align:center; font-size:12px; font-weight:700; color:var(--text-muted)">${rank}</div>
          <div style="font-size:18px; flex-shrink:0;">${data.emoji}</div>
          <div style="flex:1; min-width:0;">
            <div style="font-size:13px; font-weight:600; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(name)}</div>
            <div style="height:6px; background:var(--bg-app); border-radius:3px; overflow:hidden; margin-top:5px;">
              <div style="height:100%; width:${pct}%; background:${color}; border-radius:3px;"></div>
            </div>
          </div>
          <div style="text-align:right; min-width:76px; flex-shrink:0;">
            <div style="font-size:11px; color:var(--text-muted)">${data.qty} sold</div>
            <div style="font-size:13px; font-weight:700; color:var(--text-primary)">${cur}${data.revenue.toFixed(2)}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderModalBody() {
    const { pageItems, page: clampedPage } = paginate(getFiltered(), page, ALL_PRODUCTS_PAGE_SIZE);
    page = clampedPage;
    return `
      <div style="padding:2px 2px 0;">
        <div class="all-prod-sort-row">
          <div style="position:relative; flex:1; min-width:0;">
            <i class="fa-solid fa-magnifying-glass" style="position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--text-muted); font-size:13px;"></i>
            <input type="text" id="allProdSearchInput" class="form-input" placeholder="Search products..." value="${escapeHtml(searchTerm)}" style="width:100%; padding-left:34px;">
          </div>
          <select id="allProdSortSelect" class="form-select">
            ${Object.entries(ALL_PRODUCTS_SORTS).map(([key, s]) => `<option value="${key}" ${key === sortKey ? 'selected' : ''}>${s.label}</option>`).join('')}
          </select>
        </div>
        <div id="allProdRowsArea">${renderRows(pageItems, (page - 1) * ALL_PRODUCTS_PAGE_SIZE)}</div>
        <div id="allProdPagArea" style="margin-top:12px;"></div>
      </div>
    `;
  }

  function refresh(preserveFocus) {
    const { pageItems, page: clampedPage, totalPages } = paginate(getFiltered(), page, ALL_PRODUCTS_PAGE_SIZE);
    page = clampedPage;
    const rowsArea = document.getElementById('allProdRowsArea');
    if (rowsArea) rowsArea.innerHTML = renderRows(pageItems, (page - 1) * ALL_PRODUCTS_PAGE_SIZE);

    renderPaginationBar(document.getElementById('allProdPagArea'), {
      page, totalPages,
      onChange: (newPage) => { page = newPage; refresh(true); }
    });

    const searchInput = document.getElementById('allProdSearchInput');
    if (searchInput) {
      searchInput.oninput = (e) => {
        searchTerm = e.target.value;
        page = 1;
        refresh(false);
      };
      if (!preserveFocus) {
        searchInput.focus();
        const v = searchInput.value;
        searchInput.setSelectionRange(v.length, v.length);
      }
    }

    const sortSelect = document.getElementById('allProdSortSelect');
    if (sortSelect) {
      sortSelect.onchange = (e) => {
        sortKey = e.target.value;
        page = 1;
        refresh(true);
      };
    }
  }

  openModal({
    title: `<i class="fa-solid fa-trophy mr-8" style="color:#fbbf24"></i>All Products (${baseEntries.length})`,
    body: renderModalBody(),
    footer: `<button class="btn btn-ghost" id="allProdCloseBtn" style="width:100%">Close</button>`,
    sidePanel: false
  });

  refresh(true);
  const closeBtn = document.getElementById('allProdCloseBtn');
  if (closeBtn) closeBtn.onclick = () => closeModal();
}
