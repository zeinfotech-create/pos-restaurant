// ============================================================
// Staff Attendance / Clock-in-Out
// ============================================================
// Deliberately separate from Register.js's shift open/close — a Register
// shift tracks the CASH DRAWER for a branch (one open shift per register at
// a time); this tracks INDIVIDUAL STAFF presence (any number of staff can be
// clocked in at once, independent of whether a register is even open).
//
// All the actual clock-in/out/summary logic lives in db.js — this file is UI only.

import { getStaff, getAttendance, clockInStaff, clockOutStaff, saveAttendance, deleteAttendance, getAttendanceSummary, getCurrentBranch, getCurrentUser, hasPermission } from '../db.js';
import { store } from '../store.js';
import { openModal, closeModal } from '../components/Modal.js';
import { showToast } from '../components/Toast.js';
import { initDateRangePicker, getDefaultRange } from '../utils/dateRangeHelper.js';
import { escapeHtml } from '../utils/escapeHtml.js';

let currentPage = 1;
const itemsPerPage = 10;
const { start: defaultStart, end: defaultEnd } = getDefaultRange();
let filterStartDate = defaultStart;
let filterEndDate = defaultEnd;
let staffFilterId = 'all';

function formatDuration(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${m}m`;
}

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// <input type="datetime-local"> needs local (not UTC) "YYYY-MM-DDTHH:mm" —
// toISOString() would silently shift the displayed time by the timezone offset.
function toLocalInputValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function renderAttendance(container) {
  // Tear down the previous render's elapsed-time ticker before this one
  // starts — the router replaces #page-container's innerHTML directly (no
  // 'remove' event fires on it), so a listener for that event never runs
  // and the setInterval below would otherwise leak forever across revisits.
  if (window._attendanceCleanup) { window._attendanceCleanup(); window._attendanceCleanup = null; }

  const branch = await getCurrentBranch();
  const branchId = branch?.id;
  const canManage = await hasPermission('staff:manage');
  const staffList = (await getStaff(branchId)).sort((a, b) => a.name.localeCompare(b.name));

  // All attendance for this branch (no date filter) so a still-open entry
  // from a previous day (someone forgot to clock out) still shows correctly
  // on the board instead of silently vanishing once "today" rolls over.
  const allBranchAttendance = await getAttendance(branchId);
  const openByStaff = new Map();
  allBranchAttendance.forEach(x => { if (x.status === 'open') openByStaff.set(String(x.staffId), x); });

  const todayStr = new Date().toISOString().split('T')[0];
  const todaysClosed = allBranchAttendance.filter(x => x.status === 'closed' && (x.clockIn || '').split('T')[0] === todayStr);
  const hoursLoggedToday = todaysClosed.reduce((s, x) => s + (x.durationMinutes || 0), 0);

  async function renderLog() {
    const rawAttendance = await getAttendance(branchId, filterStartDate, filterEndDate);
    let filtered = staffFilterId === 'all' ? rawAttendance : rawAttendance.filter(x => String(x.staffId) === String(staffFilterId));
    filtered.sort((a, b) => new Date(b.clockIn).getTime() - new Date(a.clockIn).getTime());

    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * itemsPerPage;
    const paginated = filtered.slice(start, start + itemsPerPage);

    const tbody = document.getElementById('attendanceLogBody');
    if (!tbody) return;

    tbody.innerHTML = paginated.length === 0 ? `<tr><td colspan="6" style="text-align:center;padding:40px;opacity:0.5">No attendance entries in this range</td></tr>` :
      paginated.map(x => `
        <tr data-id="${x.id}">
          <td data-label="Staff" class="font-bold">${escapeHtml(x.staffName || 'Unknown')}</td>
          <td data-label="Clock In">${fmtTime(x.clockIn)}</td>
          <td data-label="Clock Out">${x.status === 'open' ? '<span class="badge badge-success">Still In</span>' : fmtTime(x.clockOut)}</td>
          <td data-label="Duration">${x.status === 'open' ? '—' : formatDuration(x.durationMinutes)}</td>
          <td data-label="Status"><span class="badge ${x.status === 'open' ? 'badge-info' : 'badge-ghost'}">${x.status === 'open' ? 'Open' : 'Closed'}</span></td>
          <td>
            ${canManage ? `
              <div style="display:flex;gap:4px">
                <button class="btn btn-ghost btn-sm edit-att-btn" data-id="${x.id}"><i class="fa-solid fa-pen"></i></button>
                <button class="btn btn-ghost btn-sm delete-att-btn" data-id="${x.id}" style="color:var(--danger)"><i class="fa-solid fa-trash"></i></button>
              </div>
            ` : ''}
          </td>
        </tr>
      `).join('');

    const pagArea = document.getElementById('paginationAreaAttendance');
    if (pagArea) {
      let html = `<div class="pagination-bar"><span>Showing page <b>${currentPage}</b> of <b>${totalPages}</b></span><div class="pagination-controls">
        <button class="pagination-btn" id="prevPageAtt" ${currentPage === 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button>`;
      for (let i = 1; i <= totalPages; i++) {
        if (totalPages > 5 && Math.abs(i - currentPage) > 2 && i !== 1 && i !== totalPages) {
          if (i === 2 || i === totalPages - 1) html += `<span style="padding:0 4px">...</span>`;
          continue;
        }
        html += `<button class="pagination-btn ${i === currentPage ? 'active' : ''} att-page-btn" data-page="${i}">${i}</button>`;
      }
      html += `<button class="pagination-btn" id="nextPageAtt" ${currentPage === totalPages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button></div></div>`;
      pagArea.innerHTML = html;
      document.getElementById('prevPageAtt').onclick = async () => { if (currentPage > 1) { currentPage--; await renderLog(); } };
      document.getElementById('nextPageAtt').onclick = async () => { if (currentPage < totalPages) { currentPage++; await renderLog(); } };
      pagArea.querySelectorAll('.att-page-btn').forEach(btn => { btn.onclick = async () => { currentPage = parseInt(btn.dataset.page); await renderLog(); }; });
    }

    tbody.querySelectorAll('.edit-att-btn').forEach(btn => {
      btn.onclick = async () => {
        const rec = filtered.find(x => x.id === btn.dataset.id);
        await openAttendanceForm(rec);
      };
    });
    tbody.querySelectorAll('.delete-att-btn').forEach(btn => {
      btn.onclick = async () => {
        const rec = filtered.find(x => x.id === btn.dataset.id);
        await confirmDeleteAttendance(rec);
      };
    });
  }

  async function openAttendanceForm(existing = null) {
    const isEdit = !!existing;
    openModal({
      title: `<i class="fa-solid fa-user-clock mr-8"></i> ${isEdit ? 'Edit Attendance Entry' : 'Manual Attendance Entry'}`,
      body: `
        <div class="form-grid">
          <div class="form-group" style="grid-column: 1 / -1">
            <label class="form-label">Staff Member</label>
            <select class="form-select" id="attStaffSelect">
              ${staffList.map(s => `<option value="${s.id}" ${existing?.staffId === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Clock In</label>
            <input type="datetime-local" class="form-input" id="attClockIn" value="${toLocalInputValue(existing?.clockIn) || toLocalInputValue(new Date().toISOString())}" />
          </div>
          <div class="form-group">
            <label class="form-label">Clock Out (leave blank if still in)</label>
            <input type="datetime-local" class="form-input" id="attClockOut" value="${toLocalInputValue(existing?.clockOut)}" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Notes (optional)</label>
          <textarea class="form-input" id="attNotes" rows="2" placeholder="e.g. Forgot to clock in, added manually">${escapeHtml(existing?.notes || '')}</textarea>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" id="saveAttBtn" style="min-width:160px">
          <i class="fa-solid fa-floppy-disk mr-8"></i> ${isEdit ? 'Save Changes' : 'Save Entry'}
        </button>
      `
    });

    document.getElementById('saveAttBtn').onclick = async () => {
      const saveBtn = document.getElementById('saveAttBtn');
      const staffId = document.getElementById('attStaffSelect').value;
      const staffName = staffList.find(s => String(s.id) === String(staffId))?.name || 'Unknown';
      const clockInVal = document.getElementById('attClockIn').value;
      const clockOutVal = document.getElementById('attClockOut').value;
      const notes = document.getElementById('attNotes').value.trim();

      if (!staffId) { showToast('Select a staff member', 'warning'); return; }
      if (!clockInVal) { showToast('Clock In time is required', 'warning'); return; }
      const clockIn = new Date(clockInVal).toISOString();
      const clockOut = clockOutVal ? new Date(clockOutVal).toISOString() : null;
      if (clockOut && new Date(clockOut) <= new Date(clockIn)) { showToast('Clock Out must be after Clock In', 'warning'); return; }

      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
      try {
        await saveAttendance({ id: existing?.id, staffId, staffName, clockIn, clockOut, notes, branchId: existing?.branchId });
        showToast(isEdit ? 'Attendance entry updated' : 'Attendance entry saved', 'success');
        closeModal();
        await renderAttendance(container);
      } catch (err) {
        showToast(err.message || 'Failed to save entry', 'error');
        saveBtn.disabled = false;
        saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk mr-8"></i> ${isEdit ? 'Save Changes' : 'Save Entry'}`;
      }
    };
  }

  async function confirmDeleteAttendance(rec) {
    openModal({
      title: 'Delete Attendance Entry',
      body: `
        <div style="text-align:center; padding:20px 0;">
          <i class="fa-solid fa-trash" style="font-size:48px; margin-bottom:24px; color:var(--danger)"></i>
          <h3 style="margin-bottom:8px">Delete this entry?</h3>
          <p style="color:var(--text-muted); font-size:14px; margin-bottom:24px">
            <b>${escapeHtml(rec.staffName || 'Unknown')}</b> — ${fmtTime(rec.clockIn)}. This cannot be undone.
          </p>
          <div style="display:flex; gap:16px; justify-content:center;">
            <button class="btn btn-ghost" onclick="closeModal()" style="flex:1">Cancel</button>
            <button class="btn btn-danger" id="confirmDeleteAttBtn" style="flex:1"><i class="fa-solid fa-trash mr-4"></i> Yes, Delete</button>
          </div>
        </div>
      `,
      footer: ''
    });
    document.getElementById('confirmDeleteAttBtn').onclick = async () => {
      await deleteAttendance(rec.id);
      showToast('Attendance entry deleted', 'success');
      closeModal();
      await renderAttendance(container);
    };
  }

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Staff Attendance</h1>
        <p class="page-subtitle">Clock in/out and track staff presence — separate from Register shifts</p>
      </div>
      ${canManage ? `<button class="btn btn-ghost" id="manualAttBtn"><i class="fa-solid fa-pen-to-square mr-8"></i> Manual Entry</button>` : ''}
    </div>

    <div class="grid-3 gap-16 mb-24">
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(16,185,129,0.15)"><i class="fa-solid fa-user-check" style="color:#10b981"></i></div>
        <div class="stat-info">
          <div class="stat-value text-success">${openByStaff.size}</div>
          <div class="stat-label">Clocked In Now</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(99,102,241,0.15)"><i class="fa-solid fa-users" style="color:#6366f1"></i></div>
        <div class="stat-info">
          <div class="stat-value">${staffList.length}</div>
          <div class="stat-label">Total Staff</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:rgba(245,158,11,0.15)"><i class="fa-solid fa-clock" style="color:#f59e0b"></i></div>
        <div class="stat-info">
          <div class="stat-value">${formatDuration(hoursLoggedToday)}</div>
          <div class="stat-label">Hours Logged Today</div>
        </div>
      </div>
    </div>

    <div class="card mb-24">
      <div class="font-bold mb-16"><i class="fa-solid fa-id-badge mr-8"></i> Clock In / Clock Out</div>
      ${staffList.length === 0 ? `<div class="empty-state" style="padding:30px 0"><i class="fa-solid fa-user-slash"></i><p>No staff members added yet — add staff under Staff Management first.</p></div>` : `
        <div id="attendanceBoard" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:12px">
          ${staffList.map(s => {
            const open = openByStaff.get(String(s.id));
            return `
              <div class="card" data-staff-card="${s.id}" style="padding:14px; display:flex; flex-direction:column; gap:10px; ${open ? 'border-color:var(--success)' : ''}">
                <div style="display:flex; align-items:center; gap:10px">
                  <div style="width:36px;height:36px;border-radius:18px;background:var(--bg-elevated);display:flex;align-items:center;justify-content:center;overflow:hidden;border:1px solid var(--border);flex-shrink:0">
                    ${s.image ? `<img src="${s.image}" style="width:100%;height:100%;object-fit:cover" />` : `<i class="fa-solid fa-user-tie" style="opacity:0.3"></i>`}
                  </div>
                  <div style="min-width:0">
                    <div class="font-bold" style="font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(s.name)}</div>
                    <div style="font-size:11px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(s.specialization || 'Staff')}</div>
                  </div>
                </div>
                ${open ? `
                  <div style="font-size:11px; color:var(--success); font-weight:700">
                    <i class="fa-solid fa-circle" style="font-size:6px; margin-right:4px"></i> In since ${new Date(open.clockIn).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                    <span class="attendance-elapsed" data-clockin="${open.clockIn}" style="display:block; font-weight:800; font-size:13px; color:var(--text-main); margin-top:2px"></span>
                  </div>
                  <button class="btn btn-sm clock-out-btn" data-staff-id="${s.id}" data-att-id="${open.id}" style="background:var(--danger); border-color:var(--danger); color:#fff"><i class="fa-solid fa-right-from-bracket mr-4"></i> Clock Out</button>
                ` : `
                  <div style="font-size:11px; color:var(--text-muted)">Not clocked in</div>
                  <button class="btn btn-sm clock-in-btn" data-staff-id="${s.id}" data-staff-name="${escapeHtml(s.name)}" style="background:var(--success); border-color:var(--success); color:#fff"><i class="fa-solid fa-right-to-bracket mr-4"></i> Clock In</button>
                `}
              </div>
            `;
          }).join('')}
        </div>
      `}
    </div>

    <div class="card mb-24">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px; flex-wrap:wrap; gap:12px">
        <div class="font-bold">Attendance Log</div>
        <div style="display:flex; gap:12px; flex-wrap:wrap">
          <div class="date-picker-group">
            <i class="fa-solid fa-calendar-day"></i>
            <input type="text" id="att-date-range" class="form-input-clean" style="width:220px" readonly />
          </div>
          <select class="form-select form-select-sm" id="attStaffFilter" style="width:180px">
            <option value="all">All Staff</option>
            ${staffList.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="table-wrap">
        <table class="responsive-table">
          <thead>
            <tr><th>Staff</th><th>Clock In</th><th>Clock Out</th><th>Duration</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody id="attendanceLogBody"></tbody>
        </table>
      </div>
      <div id="paginationAreaAttendance"></div>
    </div>
  `;

  // ── Live elapsed-time ticker for open cards ──────────────────────────
  const updateElapsed = () => {
    document.querySelectorAll('.attendance-elapsed').forEach(el => {
      const clockIn = el.dataset.clockin;
      if (!clockIn) return;
      const diff = Date.now() - new Date(clockIn).getTime();
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      el.textContent = `${h}h ${m}m`;
    });
  };
  updateElapsed();
  const timer = setInterval(updateElapsed, 60000);
  window._attendanceCleanup = () => clearInterval(timer);

  // ── Clock In / Out handlers ───────────────────────────────────────────
  container.querySelectorAll('.clock-in-btn').forEach(btn => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const currentUser = await getCurrentUser();
        await clockInStaff(btn.dataset.staffId, btn.dataset.staffName, branchId);
        showToast(`${btn.dataset.staffName} clocked in`, 'success');
        await renderAttendance(container);
      } catch (err) {
        showToast(err.message || 'Failed to clock in', 'error');
        btn.disabled = false;
      }
    };
  });
  container.querySelectorAll('.clock-out-btn').forEach(btn => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await clockOutStaff(btn.dataset.attId);
        showToast('Clocked out', 'success');
        await renderAttendance(container);
      } catch (err) {
        showToast(err.message || 'Failed to clock out', 'error');
        btn.disabled = false;
      }
    };
  });

  const manualBtn = document.getElementById('manualAttBtn');
  if (manualBtn) manualBtn.onclick = () => openAttendanceForm(null);

  await renderLog();

  document.getElementById('attStaffFilter').onchange = async (e) => { staffFilterId = e.target.value; currentPage = 1; await renderLog(); };
  initDateRangePicker('att-date-range', filterStartDate, filterEndDate, async (start, end) => {
    filterStartDate = start;
    filterEndDate = end;
    currentPage = 1;
    await renderLog();
  });
}
