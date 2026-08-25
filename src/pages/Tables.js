// ============================================================
// Tables.js — Restaurant table management (add/edit/delete tables,
// see live status). The actual order-taking happens in RestaurantPOS.js —
// this page only manages the table *definitions* and lets staff glance at
// who's occupied/free, same separation as Categories.js manages category
// definitions while POS.js does the actual selling.
// ============================================================

import { getTables, saveTable, deleteTable } from '../db.js';
import { openModal, closeModal, showConfirm } from '../components/Modal.js';
import { showToast } from '../components/Toast.js';
import { navigate } from '../router.js';

const STATUS_META = {
  free: { label: 'Free', color: 'var(--success)', bg: 'rgba(34,197,94,0.08)' },
  occupied: { label: 'Occupied', color: 'var(--warning)', bg: 'rgba(245,158,11,0.08)' },
  billed: { label: 'Billed', color: 'var(--danger)', bg: 'rgba(239,68,68,0.08)' },
};

export async function renderTables(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Tables</div>
        <div class="page-subtitle">Manage your dining tables — click a free table to start taking an order</div>
      </div>
      <button class="btn btn-primary" id="addTableBtn">
        <i class="fa-solid fa-plus"></i> New Table
      </button>
    </div>
    <div id="tablesContent"></div>
  `;
  await renderTablesContent();
}

async function renderTablesContent() {
  const area = document.getElementById('tablesContent');
  if (!area) return;

  const tables = (await getTables()).sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true }));

  area.innerHTML = `
    ${tables.length === 0 ? `
      <div class="card" style="padding:48px; text-align:center; color:var(--text-muted);">
        <i class="fa-solid fa-chair" style="font-size:36px; opacity:0.2; margin-bottom:12px; display:block"></i>
        <div style="font-size:14px; font-weight:700">No tables yet</div>
        <div style="font-size:12px; margin-top:4px">Click "New Table" to add your first one</div>
      </div>
    ` : `
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap:14px;">
        ${tables.map(t => {
          const status = STATUS_META[t.status] || STATUS_META.free;
          return `
            <div class="table-card" data-id="${t.id}" style="padding:18px; border-radius:14px; border:1px solid var(--border); background:${status.bg}; cursor:pointer; transition:all 0.15s;">
              <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                <div>
                  <div style="font-size:16px; font-weight:800;"><i class="fa-solid fa-chair" style="opacity:0.4; margin-right:6px; font-size:13px"></i>${t.name}</div>
                  <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">Seats ${t.capacity || 4}</div>
                </div>
                <div style="display:flex; gap:4px;" onclick="event.stopPropagation()">
                  <button class="btn-icon edit-table-btn" data-id="${t.id}" title="Edit"><i class="fa-solid fa-pen" style="font-size:10px"></i></button>
                  <button class="btn-icon del-table-btn" data-id="${t.id}" title="Delete"><i class="fa-solid fa-trash" style="font-size:10px; color:var(--danger)"></i></button>
                </div>
              </div>
              <div style="margin-top:14px; font-size:11px; font-weight:700; color:${status.color};">
                <i class="fa-solid fa-circle" style="font-size:6px; margin-right:5px"></i>${status.label}
                ${t.status === 'occupied' && t.currentOrder?.items?.length ? ` · ${t.currentOrder.items.length} item(s)` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `}
    <style>
      .table-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-md, 0 4px 12px rgba(0,0,0,0.08)); }
    </style>
  `;

  await setupTablesListeners();
}

async function setupTablesListeners() {
  document.querySelectorAll('.table-card').forEach(el => {
    el.addEventListener('click', () => {
      // Hand off to RestaurantPOS.js's own table selection (it re-reads live
      // status itself rather than trusting this stale click) via a query hash.
      navigate(`restaurant-pos/${el.dataset.id}`);
    });
  });

  document.getElementById('addTableBtn')?.addEventListener('click', () => {
    openModal({
      title: '<i class="fa-solid fa-chair mr-8"></i> New Table',
      body: `
        <div class="form-group">
          <label class="form-label required">Table Name / Number</label>
          <input class="form-input" id="newTableNameInput" placeholder="e.g. Table 1, T-05, Patio 2" autofocus />
        </div>
        <div class="form-group mt-8">
          <label class="form-label">Seating Capacity</label>
          <input class="form-input" id="newTableCapInput" type="number" min="1" value="4" />
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" id="confirmNewTable" style="min-width: 120px">
          <i class="fa-solid fa-plus mr-4"></i> Create Table
        </button>
      `
    });
    setTimeout(() => {
      const nameInput = document.getElementById('newTableNameInput');
      if (nameInput) nameInput.focus();
      const btn = document.getElementById('confirmNewTable');
      if (btn) btn.onclick = async () => {
        const name = nameInput?.value.trim();
        if (!name) return showToast('Please enter a table name', 'error');
        const existing = await getTables();
        if (existing.some(t => t.name.trim().toLowerCase() === name.toLowerCase())) {
          return showToast(`A table named "${name}" already exists`, 'error');
        }
        const capacity = Math.max(1, parseInt(document.getElementById('newTableCapInput')?.value, 10) || 4);
        await saveTable({ name, capacity, status: 'free' });
        closeModal();
        showToast(`Table "${name}" created`, 'success');
        await renderTablesContent();
      };
    }, 50);
  });

  document.querySelectorAll('.edit-table-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const table = (await getTables()).find(t => t.id === btn.dataset.id);
      if (!table) return;
      openModal({
        title: '<i class="fa-solid fa-pen-to-square mr-8"></i> Edit Table',
        body: `
          <div class="form-group">
            <label class="form-label required">Table Name / Number</label>
            <input class="form-input" id="editTableNameInput" value="${table.name}" autofocus />
          </div>
          <div class="form-group mt-8">
            <label class="form-label">Seating Capacity</label>
            <input class="form-input" id="editTableCapInput" type="number" min="1" value="${table.capacity || 4}" />
          </div>
        `,
        footer: `
          <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" id="confirmEditTable" style="min-width: 120px">
            <i class="fa-solid fa-save mr-4"></i> Save Changes
          </button>
        `
      });
      setTimeout(() => {
        const nameInput = document.getElementById('editTableNameInput');
        if (nameInput) nameInput.focus();
        const saveBtn = document.getElementById('confirmEditTable');
        if (saveBtn) saveBtn.onclick = async () => {
          const name = nameInput?.value.trim();
          if (!name) return;
          const existing = await getTables();
          if (existing.some(t => t.id !== table.id && t.name.trim().toLowerCase() === name.toLowerCase())) {
            return showToast(`A table named "${name}" already exists`, 'error');
          }
          const capacity = Math.max(1, parseInt(document.getElementById('editTableCapInput')?.value, 10) || 4);
          await saveTable({ ...table, name, capacity });
          closeModal();
          showToast('Table updated', 'success');
          await renderTablesContent();
        };
      }, 50);
    });
  });

  document.querySelectorAll('.del-table-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const table = (await getTables()).find(t => t.id === btn.dataset.id);
      if (table?.status === 'occupied') {
        return showToast('This table has an order in progress — bill or clear it first.', 'error');
      }
      const confirmed = await showConfirm({
        title: 'Delete Table',
        message: `Remove "${table?.name}"? This can't be undone.`,
        okText: 'Delete', okClass: 'btn-danger'
      });
      if (confirmed) {
        await deleteTable(btn.dataset.id);
        showToast('Table deleted', 'info');
        await renderTablesContent();
      }
    });
  });
}
