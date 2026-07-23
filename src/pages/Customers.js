import { getCustomers, saveCustomer, getLoyaltyHistory, getCurrentBranch, getCurrentUser, deleteCustomer, hasPermission, getCreditHistory, adjustCustomerCredit } from '../db.js';
import { openModal, closeModal } from '../components/Modal.js';
import { showToast } from '../components/Toast.js';
import { openCustomerForm } from '../components/CustomerForm.js';
import { initDateRangePicker, getDefaultRange } from '../utils/dateRangeHelper.js';
import { applySessionFilter } from '../utils/sessionFilter.js';
export { openCustomerForm } from '../components/CustomerForm.js';

let searchQ = '';
const { start: defaultStart, end: defaultEnd } = getDefaultRange();
// Customers are master data, not a transaction log — don't hide ones added
// before this month. Only filter by date once the user picks a range.
let filterStartDate = null;
let filterEndDate = null;
let currentPage = 1;
const itemsPerPage = 10;
let selectedIds = new Set();

export async function renderCustomers(container, subPage) {
  const branch = await getCurrentBranch();
  const branchId = branch?.id;
  
  async function fetchAndFilter() {
    let list = await getCustomers(branchId);
    
    if (searchQ) {
      list = list.filter(c => 
        c.name.toLowerCase().includes(searchQ.toLowerCase()) || 
        c.phone.toLowerCase().includes(searchQ.toLowerCase()) ||
        (c.email || '').toLowerCase().includes(searchQ.toLowerCase())
      );
    }
    
    if (filterStartDate && filterEndDate) {
      list = list.filter(c => {
        const d = (c.updatedAt || c.createdAt || new Date().toISOString()).split('T')[0];
        return d >= filterStartDate && d <= filterEndDate;
      });
    }

    list.sort((a,b) => {
      const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      if (timeB !== timeA) return timeB - timeA;
      return String(b.id).localeCompare(String(a.id));
    });
    return list;
  }

  const customers = await fetchAndFilter();
  
  const totalItems = customers.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * itemsPerPage;
  const paginatedCustomers = customers.slice(start, start + itemsPerPage);

  const paginatedIds = paginatedCustomers.map(c => String(c.id));
  const someInPageSelected = paginatedIds.some(id => selectedIds.has(id));
  const allInPageSelected = paginatedIds.length > 0 && paginatedIds.every(id => selectedIds.has(id));

  const canAdd = await hasPermission('pos:access');

  container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Customers</h1>
          <p class="page-subtitle">Manage your customer database and loyalty</p>
        </div>
        <div class="flex gap-8">
          <button class="btn btn-ghost hide-desktop" id="mobileFilterToggle" style="border:1px solid var(--border)">
            <i class="fa-solid fa-filter mr-8"></i> Filters
          </button>
          ${canAdd ? `
            <button class="btn btn-primary" id="addCustBtn"><i class="fa-solid fa-plus"></i> Add Customer</button>
          ` : ''}
        </div>
      </div>
      
      <div id="bulkActionsArea"></div>

      <div class="mb-16" id="filterCard" style="transition: all 0.3s ease-in-out; overflow:hidden">
        <div class="data-mgmt-bar mobile-filter-stack p-16">
          <div class="search-input-wrap">
            <i class="fa-solid fa-magnifying-glass"></i>
            <input class="form-input" id="custSearch" placeholder="Search by name, phone or email..." value="${searchQ}" />
          </div>
          <div class="filter-group">
            <label class="filter-label">Registered Range</label>
            <div class="date-picker-group">
              <i class="fa-solid fa-calendar-day"></i>
              <input type="text" id="cust-date-range" class="form-input-clean" style="width:100%" readonly />
            </div>
          </div>
        </div>
      </div>

      <div id="customersTableArea"></div>
      <div id="paginationArea"></div>
  `;
  
  const renderTable = async () => {
    // Re-check selections and render the table + bulk actions
    await renderBulkActionsBar(container);
    
    const wrap = document.getElementById('customersTableArea');
    if (!wrap) return;

    const canManage = await hasPermission('customers:manage');
    const canDelete = await hasPermission('customers:delete');

    wrap.innerHTML = `
      <div class="card">
        <div class="table-wrap">
          <table class="responsive-table">
            <thead>
              <tr>
                <th class="th-checkbox"><input type="checkbox" class="row-checkbox" id="selectAllCustomers" ${allInPageSelected ? 'checked' : ''} /></th>
                <th>Customer Name</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Points</th>
                <th>Credit</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${paginatedCustomers.length === 0 ? `<tr><td colspan="7" style="text-align:center;padding:40px;opacity:0.5">No customers found</td></tr>` :
        paginatedCustomers.map(c => `
                <tr class="${selectedIds.has(String(c.id)) ? 'selected' : ''}" data-id="${c.id}">
                  <td class="th-checkbox" data-label="Select">
                    <input type="checkbox" class="row-checkbox customer-select" data-id="${c.id}" ${selectedIds.has(String(c.id)) ? 'checked' : ''} />
                  </td>
                  <td data-label="Customer Name" class="font-semibold">
                  <div style="display:flex;align-items:center;gap:12px;justify-content:flex-start">
                    <div style="width:32px;height:32px;border-radius:16px;background:var(--bg-elevated);display:flex;align-items:center;justify-content:center;overflow:hidden;border:1px solid var(--border)">
                      ${c.image ? `<img src="${c.image}" style="width:100%;height:100%;object-fit:cover" />` : `<i class="fa-solid fa-user" style="opacity:0.3"></i>`}
                    </div>
                    <div>
                      <div style="display:flex;align-items:center;gap:8px">
                        ${c.name}
                        <span style="background:${c.tier.color}15;color:${c.tier.color};font-size:9px;padding:1px 6px;border-radius:10px;border:1px solid ${c.tier.color}30;text-transform:uppercase;font-weight:700">
                          <i class="fa-solid ${c.tier.icon}" style="font-size:8px;margin-right:2px"></i> ${c.tier.name}
                        </span>
                      </div>
                    </div>
                  </div>
                </td>
                <td data-label="Phone">${c.phone}</td>
                <td data-label="Email">${c.email || '-'}</td>
                <td data-label="Points" class="font-bold text-accent">${c.loyaltyPoints || 0}</td>
                <td data-label="Credit" class="font-bold ${c.creditBalance < 0 ? 'text-danger' : 'text-success'}">\u20B9${(c.creditBalance || 0).toLocaleString()}</td>
                <td>
                  <div style="display:flex;gap:4px">
                    <button class="btn btn-ghost btn-sm view-details-btn" data-id="${c.id}" title="View Profile"><i class="fa-solid fa-user-tag"></i></button>
                    ${canManage ? `
                      <button class="btn btn-ghost btn-sm edit-btn" data-id="${c.id}"><i class="fa-solid fa-pen"></i></button>
                    ` : ''}
                    ${canDelete ? `
                      <button class="btn btn-ghost btn-sm delete-btn" data-id="${c.id}" style="color:var(--danger)"><i class="fa-solid fa-trash-can"></i></button>
                    ` : ''}
                  </div>
                </td>
              </tr>
            `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    renderPagination(totalPages, container);

    const selectAllEl = document.getElementById('selectAllCustomers');
    if (selectAllEl) {
      selectAllEl.indeterminate = someInPageSelected && !allInPageSelected;
      selectAllEl.onclick = (e) => {
        if (e.target.checked) {
          paginatedCustomers.forEach(p => selectedIds.add(String(p.id)));
        } else {
          paginatedCustomers.forEach(p => selectedIds.delete(String(p.id)));
        }
        renderCustomers(container);
      };
    }

    wrap.querySelectorAll('.customer-select').forEach(cb => {
      cb.onclick = async (e) => {
        const id = String(cb.dataset.id);
        if (cb.checked) selectedIds.add(id);
        else selectedIds.delete(id);
        await renderCustomers(container);
        e.stopPropagation();
      };
    });

    wrap.querySelectorAll('.edit-btn').forEach(btn => {
      btn.onclick = () => {
        const c = customers.find(x => x.id === btn.dataset.id);
        openCustomerForm(c, () => renderCustomers(container));
      };
    });
    wrap.querySelectorAll('.view-details-btn').forEach(btn => {
      btn.onclick = () => {
        const c = customers.find(x => x.id === btn.dataset.id);
        openCustomerDetails(c);
      };
    });

    wrap.querySelectorAll('.delete-btn').forEach(btn => {
      btn.onclick = () => {
        const c = customers.find(x => x.id === btn.dataset.id);

        openModal({
          title: 'Delete Customer',
          body: `
            <div style="text-align:center; padding: 20px 0;">
              <i class="fa-solid fa-trash-can text-danger" style="font-size: 48px; margin-bottom: 24px;"></i>
              <h3 style="margin-bottom:8px">Confirm Delete</h3>
              <p style="color:var(--text-muted); font-size:14px; margin-bottom:32px">Are you sure you want to delete customer <b>${c.name}</b>? This will also remove their loyalty history.</p>
              
              <div style="display:flex; gap:16px; justify-content:center;">
                <button class="btn btn-ghost" onclick="closeModal()" style="flex:1">Cancel</button>
                <button class="btn btn-primary" id="confirmDeleteCustomerBtn" style="flex:1; background:var(--danger); border-color:var(--danger)">Delete</button>
              </div>
            </div>
          `,
          footer: ''
        });

        document.getElementById('confirmDeleteCustomerBtn').onclick = async () => {
          await deleteCustomer(c.id);
          showToast('Customer deleted successfully', 'success');
          closeModal();
          await renderCustomers(container);
        };
      };
    });
  };

  await renderTable();

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
        filterCard.style.maxHeight = '500px';
        filterCard.style.padding = '0px'; // Padding is inside data-mgmt-bar
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

  if (document.getElementById('addCustBtn')) {
    document.getElementById('addCustBtn').onclick = () => openCustomerForm(null, () => renderCustomers(container));
  }

  document.getElementById('custSearch').oninput = async (e) => {
    searchQ = e.target.value;
    currentPage = 1;
    await renderCustomers(container);
  };

  initDateRangePicker('cust-date-range', defaultStart, defaultEnd, async (start, end) => {
    filterStartDate = start;
    filterEndDate = end;
    currentPage = 1;
    await renderCustomers(container);
  });
}

async function renderBulkActionsBar(container) {
  const area = document.getElementById('bulkActionsArea');
  if (!area) return;

  if (selectedIds.size === 0) {
    area.innerHTML = '';
    return;
  }

  const canDelete = await hasPermission('customers:delete');
  area.innerHTML = `
    <div class="bulk-actions-bar">
      <div class="bulk-actions-info">
        <i class="fa-solid fa-square-check"></i> ${selectedIds.size} customers selected
      </div>
      <div class="flex gap-8">
        <button class="btn btn-sm btn-ghost" id="exportSelectedBtn" style="color:#fff; border-color:rgba(255,255,255,0.3)">
          <i class="fa-solid fa-file-csv"></i> Export CSV
        </button>
        ${canDelete ? `
          <button class="btn btn-sm btn-danger" id="bulkDeleteBtn">
            <i class="fa-solid fa-trash"></i> Delete Selected
          </button>
        ` : ''}
        <button class="btn btn-sm" id="clearSelectionBtn" style="background:rgba(255,255,255,0.2);color:#fff">
          Cancel
        </button>
      </div>
    </div>
  `;

  document.getElementById('exportSelectedBtn').onclick = () => {
    // Export selected to csv logic
    showToast('Export feature coming soon for customers', 'info');
  };
  
  const bulkDel = document.getElementById('bulkDeleteBtn');
  if(bulkDel) {
    bulkDel.onclick = () => {
      openModal({
        title: 'Bulk Delete',
        body: `<p>Are you sure you want to delete ${selectedIds.size} customers?</p>`,
        footer: `
          <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
          <button class="btn btn-danger" id="confirmBulkDeleteBtn">Delete All</button>
        `
      });
      document.getElementById('confirmBulkDeleteBtn').onclick = async () => {
        for (const id of selectedIds) {
          await deleteCustomer(id);
        }
        selectedIds.clear();
        closeModal();
        showToast('Customers deleted', 'success');
        await renderCustomers(container);
      };
    };
  }
  
  document.getElementById('clearSelectionBtn').onclick = () => {
    selectedIds.clear();
    renderCustomers(container);
  };
}

function renderPagination(totalPages, container) {
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
      await renderCustomers(container);
    }
  };
  document.getElementById('nextPage').onclick = async () => {
    if (currentPage < totalPages) {
      currentPage++;
      await renderCustomers(container);
    }
  };
  pagArea.querySelectorAll('.page-num-btn').forEach(btn => {
    btn.onclick = async () => {
      currentPage = parseInt(btn.dataset.page);
      await renderCustomers(container);
    };
  });
}

async function openCustomerDetails(cust) {
  const loyaltyHistory = await getLoyaltyHistory(cust.id);
  const creditHistory = await getCreditHistory(cust.id);
  const cur = '\u20B9';

  openModal({
    title: '💎 Customer Profile',
    body: `
      <div style="background:var(--bg-elevated);border-radius:var(--radius-md);padding:20px;margin-bottom:24px;border:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div style="display:flex;align-items:center;gap:16px">
            <div style="width:64px;height:64px;border-radius:32px;background:var(--bg-main);border:2px solid var(--primary);display:flex;align-items:center;justify-content:center;overflow:hidden">
              ${cust.image ? `<img src="${cust.image}" style="width:100%;height:100%;object-fit:cover" />` : `<i class="fa-solid fa-user" style="font-size:24px;opacity:0.3"></i>`}
            </div>
            <div>
              <h2 style="margin:0;font-size:20px">${cust.name}</h2>
              <p style="margin:4px 0 0 0;font-size:12px;color:var(--text-muted)">${cust.phone} • ${cust.email || 'No email'}</p>
            </div>
          </div>
          <div style="text-align:right">
            <span style="background:${cust.tier.color};color:#fff;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700">
              <i class="fa-solid ${cust.tier.icon} mr-4"></i> ${cust.tier.name.toUpperCase()} TIER
            </span>
          </div>
        </div>
        
        <div class="grid-3 gap-16" style="margin-top:20px">
          <div style="text-align:center;padding:12px;background:var(--bg-main);border-radius:12px">
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px">Points Balance</div>
            <div style="font-size:24px;font-weight:800;color:var(--accent)">${cust.loyaltyPoints || 0}</div>
          </div>
          <div style="text-align:center;padding:12px;background:var(--bg-main);border-radius:12px; border: 2px solid ${cust.creditBalance < 0 ? 'var(--danger)' : 'var(--success)'}20">
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px">Store Credit</div>
            <div style="font-size:24px;font-weight:800;color:${cust.creditBalance < 0 ? 'var(--danger)' : 'var(--success)'}">${cur}${(cust.creditBalance || 0).toLocaleString()}</div>
          </div>
          <div style="text-align:center;padding:12px;background:var(--bg-main);border-radius:12px">
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px">Total Spent</div>
            <div style="font-size:24px;font-weight:800;color:var(--text-main)">${cur}${(cust.totalSpent || 0).toLocaleString()}</div>
          </div>
        </div>
      </div>

      <!-- Management Tabs -->
      <div style="display:flex;gap:12px;margin-bottom:16px;border-bottom:1px solid var(--border);padding-bottom:12px">
        <button class="btn btn-ghost btn-sm active-tab" id="tabLoyalty">Loyalty Points</button>
        <button class="btn btn-ghost btn-sm" id="tabCredit">Store Credit</button>
      </div>

      <div id="customerDetailsContent">
          <!-- Default: Loyalty History -->
      </div>
    `,
    footer: `
      <div style="display:flex; gap:12px; width:100%">
        <button class="btn btn-secondary" id="manageCreditBtn" style="flex:1"><i class="fa-solid fa-wallet mr-4"></i> Manage Credit</button>
        <button class="btn btn-primary" onclick="closeModal()" style="flex:1">Done</button>
      </div>
    `
  });

  const renderLoyalty = () => {
    const el = document.getElementById('customerDetailsContent');
    const tableHtml = loyaltyHistory.length === 0 ? '<tr><td colspan="4" style="text-align:center;padding:20px;opacity:0.5">No loyalty transactions yet</td></tr>' :
      loyaltyHistory.map(h => `
        <tr>
          <td style="font-size:11px">${new Date(h.date).toLocaleDateString()}</td>
          <td><span class="badge ${h.type === 'Earn' ? 'badge-success' : 'badge-accent'}">${h.type}</span></td>
          <td class="font-bold ${h.type === 'Earn' ? 'text-success' : 'text-accent'}">${h.type === 'Earn' ? '+' : '-'}${h.points}</td>
          <td style="font-size:11px;color:var(--text-muted)">${h.orderId || '-'}</td>
        </tr>
      `).join('');

    el.innerHTML = `
      <div class="table-wrap" style="max-height:300px;overflow-y:auto">
        <table class="table table-sm">
          <thead>
            <tr><th>Date</th><th>Type</th><th>Points</th><th>Order Ref</th></tr>
          </thead>
          <tbody>${tableHtml}</tbody>
        </table>
      </div>
    `;
  };

  const renderCredit = () => {
    const el = document.getElementById('customerDetailsContent');
    const tableHtml = creditHistory.length === 0 ? '<tr><td colspan="4" style="text-align:center;padding:20px;opacity:0.5">No credit transactions yet</td></tr>' :
      creditHistory.map(h => `
        <tr>
          <td style="font-size:11px">${new Date(h.date).toLocaleDateString()}</td>
          <td><span class="badge ${h.type === 'Credit' ? 'badge-success' : 'badge-danger'}">${h.type}</span></td>
          <td class="font-bold ${h.type === 'Credit' ? 'text-success' : 'text-danger'}">${h.type === 'Credit' ? '+' : '-'}${cur}${h.amount.toLocaleString()}</td>
          <td style="font-size:11px;color:var(--text-muted)" title="${h.reason}">${h.reason?.substring(0, 15)}...</td>
        </tr>
      `).join('');

    el.innerHTML = `
      <div class="table-wrap" style="max-height:300px;overflow-y:auto">
        <table class="table table-sm">
          <thead>
            <tr><th>Date</th><th>Type</th><th>Amount</th><th>Reason</th></tr>
          </thead>
          <tbody>${tableHtml}</tbody>
        </table>
      </div>
    `;
  };

  renderLoyalty();

  // Tab Switchers
  const tabL = document.getElementById('tabLoyalty');
  const tabC = document.getElementById('tabCredit');
  
  tabL.onclick = () => {
      tabL.classList.add('active-tab');
      tabC.classList.remove('active-tab');
      renderLoyalty();
  };
  tabC.onclick = () => {
      tabC.classList.add('active-tab');
      tabL.classList.remove('active-tab');
      renderCredit();
  };

  document.getElementById('manageCreditBtn').onclick = () => {
      closeModal();
      openCreditManagement(cust);
  };
}

function openCreditManagement(cust) {
    const cur = '\u20B9';
    openModal({
        title: `Manage Credit: ${cust.name}`,
        body: `
          <div style="text-align:center; padding-bottom:24px">
            <div style="font-size:12px; color:var(--text-muted); text-transform:uppercase; margin-bottom:4px">Current Balance</div>
            <div style="font-size:32px; font-weight:800; color:${cust.creditBalance < 0 ? 'var(--danger)' : 'var(--success)'}">${cur}${(cust.creditBalance || 0).toLocaleString()}</div>
          </div>

          <div class="form-group">
            <label class="form-label">Action Type</label>
            <div style="display:flex; gap:12px">
                <button class="btn btn-secondary w-full active-tab" id="btnTypeCredit" style="background:var(--success)10; border-color:var(--success)30; color:var(--success)">
                    <i class="fa-solid fa-arrow-down mr-4"></i> Add Balance (Credit)
                </button>
                <button class="btn btn-secondary w-full" id="btnTypeDebit" style="background:var(--danger)10; border-color:var(--danger)30; color:var(--danger)">
                    <i class="fa-solid fa-arrow-up mr-4"></i> Deduct / Debt (Debit)
                </button>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Amount (${cur})</label>
            <input type="number" id="manageCreditAmt" class="form-input" placeholder="0.00" style="font-size:18px; font-weight:700">
          </div>

          <div class="form-group">
            <label class="form-label">Reason / Reference</label>
            <input type="text" id="manageCreditReason" class="form-input" placeholder="e.g. Deposit for future orders, settling debt">
          </div>
        `,
        footer: `
          <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" id="saveCreditAdjBtn">Save Transaction</button>
        `
    });

    let selectedType = 'Credit';
    const btnC = document.getElementById('btnTypeCredit');
    const btnD = document.getElementById('btnTypeDebit');
    
    const updateStyles = () => {
        if (selectedType === 'Credit') {
            // Credit Selected
            btnC.style.background = 'var(--primary)';
            btnC.style.color = '#fff';
            btnC.style.borderColor = 'var(--primary)';
            btnC.classList.add('active-tab');

            btnD.style.background = 'transparent';
            btnD.style.color = 'var(--text-muted)';
            btnD.style.borderColor = 'var(--border)';
            btnD.classList.remove('active-tab');
        } else {
            // Debit Selected
            btnD.style.background = 'var(--danger)';
            btnD.style.color = '#fff';
            btnD.style.borderColor = 'var(--danger)';
            btnD.classList.add('active-tab');

            btnC.style.background = 'transparent';
            btnC.style.color = 'var(--text-muted)';
            btnC.style.borderColor = 'var(--border)';
            btnC.classList.remove('active-tab');
        }
    };

    btnC.onclick = () => {
        selectedType = 'Credit';
        updateStyles();
    };
    btnD.onclick = () => {
        selectedType = 'Debit';
        updateStyles();
    };

    // Initial style
    updateStyles();

    document.getElementById('saveCreditAdjBtn').onclick = async () => {
        const amt = parseFloat(document.getElementById('manageCreditAmt').value);
        const reason = document.getElementById('manageCreditReason').value.trim() || `${selectedType} adjustment`;
        
        if (!amt || amt <= 0) return showToast('Enter a valid amount', 'error');

        await adjustCustomerCredit(cust.id, amt, selectedType, reason);
        showToast('Credit updated!', 'success');
        closeModal();
        
        // Return to details to see the update
        const allCats = await getCustomers();
        const updated = allCats.find(c => c.id === cust.id);
        await openCustomerDetails(updated);
        
        // Re-render table in background
        const container = document.getElementById('page-container');
        if (container) {
            // Check current page
            import('./Customers.js').then(m => m.renderCustomers(container));
        }
    };
}
