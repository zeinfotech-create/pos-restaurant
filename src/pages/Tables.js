// ============================================================
// Tables.js — Restaurant table management (add/edit/delete/merge tables,
// see live status + occupied timers, grouped by section). The actual
// order-taking happens in RestaurantPOS.js — this page only manages the
// table *definitions* and lets staff glance at who's occupied/free, same
// separation as Categories.js manages category definitions while POS.js
// does the actual selling.
// ============================================================

import { getTables, saveTable, deleteTable, getCounterOrders } from '../db.js';
import { openModal, closeModal, showConfirm } from '../components/Modal.js';
import { showToast } from '../components/Toast.js';
import { navigate } from '../router.js';
import { STATUS_META, visibleTables, tableDisplayName, tableDisplayCapacity, groupBySection, tableOccupancy, formatElapsed, timerTier } from '../utils/tableDisplay.js';

let timerInterval = null;

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

  const allTables = await getTables();
  const tables = visibleTables(allTables).sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true }));
  const grouped = groupBySection(tables);
  // Occupancy is derived live from open dine-in CounterOrders (table
  // SHARING means a table can have several independent parties/"boxes" at
  // once) — never trusted off the table doc itself, see tableOccupancy().
  const allParties = (await getCounterOrders()).filter(o => o.orderType === 'dine-in');

  area.innerHTML = `
    ${tables.length === 0 ? `
      <div class="card" style="padding:48px; text-align:center; color:var(--text-muted);">
        <i class="fa-solid fa-chair" style="font-size:36px; opacity:0.2; margin-bottom:12px; display:block"></i>
        <div style="font-size:14px; font-weight:700">No tables yet</div>
        <div style="font-size:12px; margin-top:4px">Click "New Table" to add your first one</div>
      </div>
    ` : grouped.map(({ section, tables: sectionTables }) => `
      <div style="margin-bottom:22px;">
        ${grouped.length > 1 ? `<div style="font-size:12px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:.5px; margin-bottom:10px;"><i class="fa-solid fa-layer-group" style="margin-right:6px; opacity:.5;"></i>${escapeAttr(section)}</div>` : ''}
        <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap:14px;">
          ${sectionTables.map(t => renderTableCard(t, allTables, allParties)).join('')}
        </div>
      </div>
    `).join('')}
    <style>
      .table-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-md, 0 4px 12px rgba(0,0,0,0.08)); }
    </style>
  `;

  await setupTablesListeners();
  startTimerLoop();
}

function renderTableCard(t, allTables, allParties) {
  const occ = tableOccupancy(t, allParties);
  const status = occ.isOccupied ? STATUS_META.occupied : STATUS_META.free;
  const displayName = tableDisplayName(t, allTables);
  const displayCap = tableDisplayCapacity(t, allTables);
  const elapsed = occ.oldestCreatedAt ? Date.now() - new Date(occ.oldestCreatedAt).getTime() : null;
  const hasMerge = t.mergedTableIds?.length > 0;
  return `
    <div class="table-card" data-id="${t.id}" style="padding:18px; border-radius:14px; border:1px solid var(--border); background:${status.bg}; cursor:pointer; transition:all 0.15s;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div>
          <div style="font-size:16px; font-weight:800;"><i class="fa-solid fa-chair" style="opacity:0.4; margin-right:6px; font-size:13px"></i>${escapeAttr(displayName)}</div>
          <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">Seats ${displayCap}</div>
        </div>
        <div style="display:flex; gap:4px;" onclick="event.stopPropagation()">
          <button class="btn-icon edit-table-btn" data-id="${t.id}" title="Edit"><i class="fa-solid fa-pen" style="font-size:10px"></i></button>
          ${hasMerge
            ? `<button class="btn-icon unmerge-table-btn" data-id="${t.id}" title="Unmerge"><i class="fa-solid fa-object-ungroup" style="font-size:10px"></i></button>`
            : (!occ.isOccupied ? `<button class="btn-icon merge-table-btn" data-id="${t.id}" title="Merge with another table"><i class="fa-solid fa-object-group" style="font-size:10px"></i></button>` : '')}
          <button class="btn-icon del-table-btn" data-id="${t.id}" title="Delete"><i class="fa-solid fa-trash" style="font-size:10px; color:var(--danger)"></i></button>
        </div>
      </div>
      <div style="margin-top:14px; display:flex; align-items:center; justify-content:space-between;">
        <div style="font-size:11px; font-weight:700; color:${status.color};">
          <i class="fa-solid fa-circle" style="font-size:6px; margin-right:5px"></i>${occ.isOccupied ? `${occ.usedSeats}/${displayCap} seated${occ.partyCount > 1 ? ` · ${occ.partyCount} boxes` : ''}` : status.label}
          ${occ.totalItems > 0 ? ` · ${occ.totalItems} item(s)` : ''}
        </div>
        ${elapsed !== null ? `<div class="table-timer" data-occupied-at="${occ.oldestCreatedAt}" style="font-size:11px; font-weight:800; color:${timerTier(elapsed).color};">${formatElapsed(elapsed)}</div>` : ''}
      </div>
    </div>
  `;
}

function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Only the timer badges re-render on this tick (not the whole grid) so an
// open modal / merge selection never gets clobbered by a background tick.
// Self-clears once #tablesContent leaves the DOM (page navigated away).
function startTimerLoop() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const area = document.getElementById('tablesContent');
    if (!area) { clearInterval(timerInterval); timerInterval = null; return; }
    area.querySelectorAll('.table-timer').forEach(el => {
      const occupiedAt = el.dataset.occupiedAt;
      if (!occupiedAt) return;
      const ms = Date.now() - new Date(occupiedAt).getTime();
      el.textContent = formatElapsed(ms);
      el.style.color = timerTier(ms).color;
    });
  }, 30000);
}

async function setupTablesListeners() {
  document.querySelectorAll('.table-card').forEach(el => {
    el.addEventListener('click', () => {
      // Hand off to RestaurantPOS.js's own table selection (it re-reads live
      // status itself rather than trusting this stale click) via a query hash.
      navigate(`restaurant-pos/${el.dataset.id}`);
    });
  });

  document.getElementById('addTableBtn')?.addEventListener('click', async () => {
    const existingSections = [...new Set((await getTables()).map(t => t.section?.trim()).filter(Boolean))];
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
        <div class="form-group mt-8">
          <label class="form-label">Section / Area (optional)</label>
          <input class="form-input" id="newTableSectionInput" list="tableSectionList" placeholder="e.g. Ground Floor, Terrace, AC Hall" />
          <datalist id="tableSectionList">${existingSections.map(s => `<option value="${escapeAttr(s)}"></option>`).join('')}</datalist>
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
        const section = document.getElementById('newTableSectionInput')?.value.trim() || '';
        const sectionKey = section || 'Main';
        const existing = await getTables();
        // Scoped to the section, not global — "Table 1" in Main and "Table 1"
        // in AC Hall are two different physical tables the section already
        // tells apart, same as a real restaurant would number them.
        if (existing.some(t => (t.section?.trim() || 'Main') === sectionKey && t.name.trim().toLowerCase() === name.toLowerCase())) {
          return showToast(`A table named "${name}" already exists in ${sectionKey}`, 'error');
        }
        const capacity = Math.max(1, parseInt(document.getElementById('newTableCapInput')?.value, 10) || 4);
        await saveTable({ name, capacity, section, status: 'free' });
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
      const existingSections = [...new Set((await getTables()).map(t => t.section?.trim()).filter(Boolean))];
      openModal({
        title: '<i class="fa-solid fa-pen-to-square mr-8"></i> Edit Table',
        body: `
          <div class="form-group">
            <label class="form-label required">Table Name / Number</label>
            <input class="form-input" id="editTableNameInput" value="${escapeAttr(table.name)}" autofocus />
          </div>
          <div class="form-group mt-8">
            <label class="form-label">Seating Capacity</label>
            <input class="form-input" id="editTableCapInput" type="number" min="1" value="${table.capacity || 4}" />
          </div>
          <div class="form-group mt-8">
            <label class="form-label">Section / Area (optional)</label>
            <input class="form-input" id="editTableSectionInput" list="tableSectionListEdit" value="${escapeAttr(table.section || '')}" placeholder="e.g. Ground Floor, Terrace, AC Hall" />
            <datalist id="tableSectionListEdit">${existingSections.map(s => `<option value="${escapeAttr(s)}"></option>`).join('')}</datalist>
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
          const section = document.getElementById('editTableSectionInput')?.value.trim() || '';
          const sectionKey = section || 'Main';
          const existing = await getTables();
          // Scoped to the section, not global — see the same check in the
          // "New Table" handler above for why.
          if (existing.some(t => t.id !== table.id && (t.section?.trim() || 'Main') === sectionKey && t.name.trim().toLowerCase() === name.toLowerCase())) {
            return showToast(`A table named "${name}" already exists in ${sectionKey}`, 'error');
          }
          const capacity = Math.max(1, parseInt(document.getElementById('editTableCapInput')?.value, 10) || 4);
          await saveTable({ ...table, name, capacity, section });
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
      const hasOpenParty = (await getCounterOrders()).some(o => o.orderType === 'dine-in' && o.tableId === table?.id);
      if (hasOpenParty) {
        return showToast('This table has an order in progress — bill or clear it first.', 'error');
      }
      if (table?.mergedTableIds?.length || table?.mergedInto) {
        return showToast('Unmerge this table first before deleting it.', 'error');
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

  document.querySelectorAll('.merge-table-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const allTables = await getTables();
      const primary = allTables.find(t => t.id === btn.dataset.id);
      if (!primary) return;
      const occupiedTableIds = new Set((await getCounterOrders()).filter(o => o.orderType === 'dine-in').map(o => o.tableId));
      const candidates = allTables.filter(t => t.id !== primary.id && t.status !== 'merged' && !occupiedTableIds.has(t.id) && !t.mergedTableIds?.length);
      if (candidates.length === 0) {
        return showToast('No other free tables available to merge with.', 'info');
      }
      openModal({
        title: `<i class="fa-solid fa-object-group mr-8"></i> Merge "${escapeAttr(primary.name)}" with…`,
        body: `
          <div style="font-size:12px; color:var(--text-muted); margin-bottom:10px;">Pick one or more tables to combine into a single order under "${escapeAttr(primary.name)}" — useful for a large party spanning multiple tables.</div>
          <div style="display:flex; flex-direction:column; gap:8px; max-height:260px; overflow-y:auto;">
            ${candidates.map(t => `
              <label style="display:flex; align-items:center; gap:10px; padding:8px 10px; border:1px solid var(--border); border-radius:8px; cursor:pointer;">
                <input type="checkbox" class="merge-candidate-cb" value="${t.id}" />
                <span style="font-weight:700; font-size:13px;">${escapeAttr(t.name)}</span>
                <span style="font-size:11px; color:var(--text-muted); margin-left:auto;">Seats ${t.capacity || 4}</span>
              </label>
            `).join('')}
          </div>
        `,
        footer: `
          <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" id="confirmMergeBtn"><i class="fa-solid fa-object-group mr-4"></i> Merge Selected</button>
        `
      });
      setTimeout(() => {
        document.getElementById('confirmMergeBtn')?.addEventListener('click', async () => {
          const selectedIds = Array.from(document.querySelectorAll('.merge-candidate-cb:checked')).map(cb => cb.value);
          if (selectedIds.length === 0) return showToast('Select at least one table', 'error');
          await saveTable({ ...primary, mergedTableIds: selectedIds });
          for (const id of selectedIds) {
            const t = allTables.find(x => x.id === id);
            if (t) await saveTable({ ...t, status: 'merged', mergedInto: primary.id });
          }
          closeModal();
          showToast(`Merged into "${primary.name}"`, 'success');
          await renderTablesContent();
        });
      }, 50);
    });
  });

  document.querySelectorAll('.unmerge-table-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const allTables = await getTables();
      const primary = allTables.find(t => t.id === btn.dataset.id);
      if (!primary?.mergedTableIds?.length) return;
      const confirmed = await showConfirm({
        title: 'Unmerge Tables',
        message: `Split "${tableDisplayName(primary, allTables)}" back into separate tables?`,
        okText: 'Unmerge'
      });
      if (!confirmed) return;
      for (const id of primary.mergedTableIds) {
        const t = allTables.find(x => x.id === id);
        if (t) await saveTable({ ...t, status: 'free', mergedInto: null });
      }
      await saveTable({ ...primary, mergedTableIds: [] });
      showToast('Tables unmerged', 'info');
      await renderTablesContent();
    });
  });
}
