import {
  getCurrentShift,
  getShifts,
  openRegister,
  closeRegister,
  getCurrentUser,
  getCurrentBranch,
  getOrders,
  getCurrentRegisterId,
  getBranchRegisters,
  addShiftTransaction,
  getSettings
} from '../db.js';
import { showToast } from '../components/Toast.js';
import { openModal, closeModal } from '../components/Modal.js';
import { escapeHtml } from '../utils/escapeHtml.js';

export async function renderRegister(container) {
  // Tear down the previous render's duration timer before this one starts —
  // the router replaces #page-container's innerHTML directly (no 'remove'
  // event fires on it), so a listener for that event never runs and the
  // setInterval below would otherwise leak forever across page revisits.
  if (window._registerCleanup) { window._registerCleanup(); window._registerCleanup = null; }

  // Show loading skeleton
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Register &amp; Shifts</h1>
        <p class="page-subtitle">Loading register data…</p>
      </div>
    </div>
    <div style="display:flex;justify-content:center;padding:60px">
      <div class="spinner"></div>
    </div>
  `;

  // ── Load all async data ──────────────────────────────────────────
  const [branch, user, registerId, settings] = await Promise.all([
    getCurrentBranch(),
    getCurrentUser(),
    getCurrentRegisterId(),
    getSettings()
  ]);

  if (!branch) {
    container.innerHTML = `<div class="empty-state"><p>No branch selected. Please log in again.</p></div>`;
    return;
  }

  const branchRegisters = await getBranchRegisters(branch.id);
  const registerName = branchRegisters.find(r => r.id === registerId)?.name || 'Global Terminal';

  const cur = (settings && settings.currency) ? settings.currency : '\u20B9';
  let shift = await getCurrentShift(branch.id, registerId);

  // Branch has no register configured at all \u2014 the same deliberate
  // "single-terminal, no formal register" setup isRegisterOpen() (db.js)
  // already lets POS/Quick POS sell through without any shift gate. This
  // page enforced its own separate "Closed" screen requiring a manual Open
  // click, which fought that: sales worked, but showed up nowhere here until
  // someone opened a shift by hand. Auto-open one silently so shift-based
  // tracking (sales/cash totals) just works, with the same zero-friction
  // POS already has.
  if (!shift && branchRegisters.length === 0) {
    shift = await openRegister(branch.id, user?.name || user?.username || 'Admin', 0, registerId);
  }
  const allShifts = await getShifts();
  const branchShifts = allShifts
    .filter(s => s.branchId === branch.id && (registerId ? s.registerId === registerId : true))
    .sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt));
  const latestShifts = branchShifts.slice(0, 10);

  // ── Compute live shift stats ─────────────────────────────────────
  let cashSales = 0, totalIn = 0, totalOut = 0, expectedCash = 0;
  if (shift) {
    // Case-insensitive sum of all 'cash' related collections
    cashSales = Object.entries(shift.collections || {}).reduce((sum, [m, a]) => {
      return m.toLowerCase() === 'cash' ? sum + a : sum;
    }, 0);
    
    totalIn  = (shift.transactions || []).filter(t => t.type === 'In').reduce((s, t) => s + t.amount, 0);
    totalOut = (shift.transactions || []).filter(t => t.type === 'Out').reduce((s, t) => s + t.amount, 0);
    expectedCash = (shift.openingBalance || 0) + cashSales + totalIn - totalOut;
  }

  // ── Render HTML ──────────────────────────────────────────────────
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Register &amp; Shifts</h1>
        <p class="page-subtitle">Managing <b>${registerName}</b> at ${branch.name}</p>
      </div>
      <div class="flex gap-12">
        <span class="badge ${shift ? 'badge-success' : 'badge-danger'}" style="padding: 8px 16px; font-size: 13px">
          <i class="fa-solid ${shift ? 'fa-door-open' : 'fa-door-closed'} mr-8"></i>
          ${shift ? 'Register Open' : 'Register Closed'}
        </span>
      </div>
    </div>

    ${shift ? `
      <!-- ── TOP: Metric Cards ────────────────────────── -->
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:20px; margin-bottom: 24px">
        <div class="card" style="padding:20px; display:flex; align-items:center; gap:16px; border-left: 4px solid var(--accent)">
          <div style="width:48px; height:48px; border-radius:12px; background:rgba(79,70,229,0.1); display:flex; align-items:center; justify-content:center">
             <i class="fa-solid fa-chart-line text-accent" style="font-size:20px"></i>
          </div>
          <div>
            <div style="font-size:11px; opacity:0.6; text-transform:uppercase; letter-spacing:0.5px">Total Sales</div>
            <div class="font-bold text-accent" style="font-size:20px">${cur}${(shift.sales || 0).toFixed(2)}</div>
          </div>
        </div>
        
        <div class="card" style="padding:20px; display:flex; align-items:center; gap:16px; border-left: 4px solid var(--success)">
          <div style="width:48px; height:48px; border-radius:12px; background:rgba(16,185,129,0.1); display:flex; align-items:center; justify-content:center">
             <i class="fa-solid fa-cart-shopping text-success" style="font-size:20px"></i>
          </div>
          <div>
            <div style="font-size:11px; opacity:0.6; text-transform:uppercase; letter-spacing:0.5px">Orders</div>
            <div class="font-bold text-success" style="font-size:20px">${shift.ordersCount || 0}</div>
          </div>
        </div>

        <div class="card" style="padding:20px; display:flex; align-items:center; gap:16px; border-left: 4px solid #f59e0b">
          <div style="width:48px; height:48px; border-radius:12px; background:rgba(245,158,11,0.1); display:flex; align-items:center; justify-content:center">
             <i class="fa-solid fa-hourglass-half" style="color:#f59e0b; font-size:20px"></i>
          </div>
          <div>
            <div style="font-size:11px; opacity:0.6; text-transform:uppercase; letter-spacing:0.5px">Shift Duration</div>
            <div class="font-bold" id="shiftDuration" style="font-size:20px; color:#f59e0b">0h 0m</div>
          </div>
        </div>

        <div class="card" style="padding:20px; display:flex; align-items:center; gap:16px; border-left: 4px solid var(--primary-light)">
          <div style="width:48px; height:48px; border-radius:12px; background:rgba(96,165,250,0.1); display:flex; align-items:center; justify-content:center">
             <i class="fa-solid fa-user-tie text-primary" style="font-size:20px"></i>
          </div>
          <div>
            <div style="font-size:11px; opacity:0.6; text-transform:uppercase; letter-spacing:0.5px">Cashier</div>
            <div class="font-bold text-primary" style="font-size:16px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:120px">${escapeHtml(shift.openedBy || 'Staff')}</div>
          </div>
        </div>
      </div>

      <div class="grid-2 gap-24">
        <!-- ── LEFT: Audit & Collections ──────────────────── -->
        <div style="display:flex; flex-direction:column; gap:24px">
          
          <!-- The Audit Zone -->
          <div class="card">
            <h2 class="font-bold mb-20" style="font-size:16px; display:flex; align-items:center; gap:8px">
              <i class="fa-solid fa-vault text-success"></i> Cash Audit Control
            </h2>
            
            <div style="display:flex; flex-direction:column; gap:8px; background:var(--bg-elevated); border-radius:12px; padding:16px; border:1px solid var(--border)">
              <div class="flex items-center justify-between py-4" style="opacity:0.8">
                <span>Opening Cash Balance</span>
                <span class="font-semibold">${cur}${(shift.openingBalance || 0).toFixed(2)}</span>
              </div>
              <div class="flex items-center justify-between py-4 text-success">
                <span>Total Cash Sales</span>
                <span class="font-bold">+${cur}${cashSales.toFixed(2)}</span>
              </div>
              <div class="flex items-center justify-between py-4 text-success">
                <span style="display:flex; align-items:center; gap:6px"><i class="fa-solid fa-arrow-turn-down" style="font-size:10px"></i> Cash In (Adjustments)</span>
                <span class="font-bold">+${cur}${totalIn.toFixed(2)}</span>
              </div>
              <div class="flex items-center justify-between py-4 text-danger">
                <span style="display:flex; align-items:center; gap:6px"><i class="fa-solid fa-arrow-turn-up" style="font-size:10px"></i> Cash Out (Adjustments)</span>
                <span class="font-bold">-${cur}${totalOut.toFixed(2)}</span>
              </div>
              
              <div style="margin-top:12px; padding-top:16px; border-top: 1px dashed var(--border)">
                <div class="flex items-center justify-between">
                  <div>
                    <div style="font-size:11px; text-transform:uppercase; letter-spacing:1px; opacity:0.6; margin-bottom:4px">Expected Drawer Cash</div>
                    <div class="font-bold text-success" style="font-size:32px">${cur}${expectedCash.toFixed(2)}</div>
                  </div>
                  <div style="text-align:right">
                    <i class="fa-solid fa-shield-check text-success" style="font-size:40px; opacity:0.2"></i>
                  </div>
                </div>
              </div>
            </div>

            <!-- Collection breakdown -->
            <div style="margin-top:24px">
              <h3 class="font-bold mb-12" style="font-size:14px">Collection Breakdown</h3>
              <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap:10px">
                ${Object.entries(shift.collections || {}).map(([method, amount]) => `
                  <div style="padding:12px; background:var(--bg-elevated); border-radius:10px; border:1px solid var(--border)">
                    <div style="font-size:10px; opacity:0.6; margin-bottom:4px; text-transform:capitalize">${method}</div>
                    <div class="font-bold">${cur}${(amount || 0).toFixed(2)}</div>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>

          <!-- Action Center -->
          <div class="card">
            <h2 class="font-bold mb-16" style="font-size:16px"><i class="fa-solid fa-wand-magic-sparkles mr-8 text-primary"></i> Action Center</h2>
             <div class="grid-2 gap-12">
                <button class="btn btn-ghost" id="cashInBtn" style="border:1px dashed var(--success); background:rgba(16,185,129,0.05); height:50px">
                  <i class="fa-solid fa-plus-circle text-success mr-8"></i> Add Cash In
                </button>
                <button class="btn btn-ghost" id="cashOutBtn" style="border:1px dashed var(--danger); background:rgba(239,68,68,0.05); height:50px">
                  <i class="fa-solid fa-minus-circle text-danger mr-8"></i> Add Cash Out
                </button>
             </div>
             <button class="btn btn-danger w-full mt-16" id="closeShiftBtn" style="height:56px; font-size:16px; font-weight:700; box-shadow: 0 4px 12px rgba(239,68,68,0.2)">
               <i class="fa-solid fa-lock-open-check mr-12"></i> Finalize &amp; Close Register
             </button>
          </div>
        </div>

        <!-- ── RIGHT: Activity Log ────────────────────────── -->
        <div class="card" style="display:flex; flex-direction:column">
           <div class="flex items-center justify-between mb-20">
             <h2 class="font-bold" style="font-size:16px"><i class="fa-solid fa-clipboard-list-check mr-8 text-primary"></i> Cash Adjustment Log</h2>
             <span class="badge badge-primary-light" style="font-size:10px">${(shift.transactions || []).length} Recorded</span>
           </div>

           ${(shift.transactions || []).length === 0 ? `
              <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; opacity:0.3; padding:60px 0">
                <i class="fa-solid fa-receipt" style="font-size:48px; margin-bottom:16px"></i>
                <p>No adjustments recorded for this shift.</p>
              </div>
           ` : `
              <div class="table-wrap">
                <table class="responsive-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Type</th>
                      <th>Reason</th>
                      <th style="text-align:right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${[...(shift.transactions || [])].reverse().map(t => `
                      <tr>
                        <td data-label="Time" style="font-size:11px; opacity:0.8">
                          ${new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td data-label="Type">
                          <span class="badge ${t.type === 'In' ? 'badge-success' : 'badge-danger'}" style="zoom:0.9">${t.type}</span>
                        </td>
                        <td data-label="Reason" class="font-medium" style="font-size:13px">${escapeHtml(t.reason)}</td>
                        <td data-label="Amount" style="text-align:right" class="font-bold ${t.type === 'In' ? 'text-success' : 'text-danger'}">
                          ${t.type === 'In' ? '+' : '-'}${cur}${(t.amount || 0).toFixed(2)}
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
           `}
        </div>
      </div>
    ` : `
      <!-- Closed State -->
      <div style="max-width:600px; margin: 40px auto">
        <div class="card" style="text-align:center; padding:60px 40px">
           <div style="width:100px; height:100px; border-radius:50%; background:rgba(239,68,68,0.1); display:flex; align-items:center; justify-content:center; margin:0 auto 24px">
             <i class="fa-solid fa-lock text-danger" style="font-size:40px"></i>
           </div>
           <h2 class="font-bold mb-12" style="font-size:24px">The Register is Closed</h2>
           <p style="opacity:0.6; margin-bottom:32px">Open the register to start recording sales and tracking cash flow for this branch.</p>
           <button class="btn btn-primary" id="openShiftBtn" style="height:56px; padding:0 40px; font-size:16px; font-weight:700">
             <i class="fa-solid fa-key mr-12"></i> Open Register Branch
           </button>
        </div>
      </div>
    `}
  `;

  // ── Duration Timer ───────────────────────────────────────────────
  if (shift) {
    const updateDur = () => {
      const diff = Date.now() - new Date(shift.openedAt).getTime();
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const el = document.getElementById('shiftDuration');
      if (el) el.innerText = `${h}h ${m}m`;
    };
    updateDur();
    const timer = setInterval(updateDur, 60000);
    window._registerCleanup = () => clearInterval(timer);
  }

  // ── Button Handlers ──────────────────────────────────────────────
  const openBtn = document.getElementById('openShiftBtn');
  if (openBtn) openBtn.onclick = () => openOpeningModal(branch.id, user?.name || user?.username || 'Admin', registerId);

  const closeBtn = document.getElementById('closeShiftBtn');
  if (closeBtn) closeBtn.onclick = () => openClosingModal(shift, cur, branch.id);

  const cashInBtn = document.getElementById('cashInBtn');
  if (cashInBtn) cashInBtn.onclick = () => openAdjustmentModal('In', shift, branch.id);

  const cashOutBtn = document.getElementById('cashOutBtn');
  if (cashOutBtn) cashOutBtn.onclick = () => openAdjustmentModal('Out', shift, branch.id);

  // View historical shift
  container.querySelectorAll('.view-shift-btn').forEach(btn => {
    btn.onclick = () => openShiftDetailsModal(btn.dataset.id, cur, allShifts);
  });
}

// ────────────────────────────────────────────────────────────────────
// Open Register Modal
// ────────────────────────────────────────────────────────────────────
function openOpeningModal(branchId, openedByName, registerId = null) {
  openModal({
    title: '<i class="fa-solid fa-key"></i> Open Register',
    body: `
      <div style="display:flex;flex-direction:column;gap:16px">
        <p style="font-size:13px;opacity:0.7;margin-bottom:4px">Enter the cash amount currently in the drawer to begin the shift.</p>
        <div class="form-group">
          <label class="form-label">Opening Cash Balance *</label>
          <div class="search-input-wrap">
            <i class="fa-solid fa-money-bill"></i>
            <input class="form-input" type="number" id="openingBal" placeholder="0.00" value="0" min="0" step="0.01" />
          </div>
          <p style="font-size:11px;opacity:0.6;margin-top:4px">The starting cash available in the cash drawer.</p>
        </div>
        <div class="form-group">
          <label class="form-label">Opening Notes (Optional)</label>
          <input class="form-input" type="text" id="openingNotes" placeholder="e.g. Start of day shift" />
        </div>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="confirmOpenBtn"><i class="fa-solid fa-key"></i> Open Shift</button>
    `
  });

  const confirmOpenBtn = document.getElementById('confirmOpenBtn');
  confirmOpenBtn.onclick = async () => {
    if (confirmOpenBtn.disabled) return;
    const bal = parseFloat(document.getElementById('openingBal').value) || 0;
    const notes = document.getElementById('openingNotes').value.trim();
    confirmOpenBtn.disabled = true;
    try {
      await openRegister(branchId, openedByName, bal, registerId, notes);
      showToast('Register opened successfully!', 'success');
      closeModal();
      window.navigate('register');
    } catch (err) {
      confirmOpenBtn.disabled = false;
      showToast('Failed to open register: ' + err.message, 'error');
    }
  };
}

// ────────────────────────────────────────────────────────────────────
// Cash In / Out Modal
// ────────────────────────────────────────────────────────────────────
function openAdjustmentModal(type, shift, branchId) {
  const isIn = type === 'In';
  openModal({
    title: isIn
      ? '<i class="fa-solid fa-arrow-down-long text-success"></i> Cash In'
      : '<i class="fa-solid fa-arrow-up-long text-danger"></i> Cash Out',
    body: `
      <div style="display:flex;flex-direction:column;gap:14px">
        <div class="form-group">
          <label class="form-label">Amount *</label>
          <input class="form-input" type="number" id="adjAmount" placeholder="0.00" min="0.01" step="0.01" />
        </div>
        <div class="form-group">
          <label class="form-label">Reason / Remark *</label>
          <input class="form-input" type="text" id="adjReason" placeholder="${isIn ? 'e.g. Added change from safe' : 'e.g. Petty cash for refreshments'}" />
        </div>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn ${isIn ? 'btn-success' : 'btn-danger'}" id="confirmAdjBtn">Record ${type}</button>
    `
  });

  const confirmAdjBtn = document.getElementById('confirmAdjBtn');
  confirmAdjBtn.onclick = async () => {
    if (confirmAdjBtn.disabled) return;
    const amt = parseFloat(document.getElementById('adjAmount').value);
    const rsn = document.getElementById('adjReason').value.trim();
    if (!amt || amt <= 0) return showToast('Please enter a valid amount', 'error');
    if (!rsn) return showToast('Please enter a reason', 'error');

    confirmAdjBtn.disabled = true;
    try {
      await addShiftTransaction(branchId, type, amt, rsn);
      showToast(`Cash ${type} of ${amt.toFixed(2)} recorded`, 'success');
      closeModal();
      window.navigate('register');
    } catch (err) {
      confirmAdjBtn.disabled = false;
      showToast('Failed to record transaction: ' + err.message, 'error');
    }
  };
}

// ────────────────────────────────────────────────────────────────────
// Close Register Modal
// ────────────────────────────────────────────────────────────────────
async function openClosingModal(shift, cur, branchId) {
  if (!shift) return;

  // Compute totals (Case-insensitive)
  const cashSales = Object.entries(shift.collections || {}).reduce((sum, [m, a]) => {
    return m.toLowerCase() === 'cash' ? sum + a : sum;
  }, 0);
  const totalIn   = (shift.transactions || []).filter(t => t.type === 'In').reduce((s, t) => s + t.amount, 0);
  const totalOut  = (shift.transactions || []).filter(t => t.type === 'Out').reduce((s, t) => s + t.amount, 0);

  const orders = (await getOrders(branchId)).filter(o =>
    new Date(o.date) >= new Date(shift.openedAt) && o.status !== 'cancelled'
  );
  const totalRoundOff = orders.reduce((s, o) => s + (o.roundOff || 0), 0);

  const expectedCash = (shift.openingBalance || 0) + cashSales + totalIn - totalOut;

  openModal({
    title: '<i class="fa-solid fa-lock text-danger"></i> Close Register',
    body: `
      <div style="display:flex;flex-direction:column;gap:14px">
        <!-- Summary -->
        <div style="background:var(--bg-elevated);border-radius:var(--radius-sm);padding:14px">
          <div class="flex items-center justify-between py-4">
            <span style="opacity:0.8">Opening Cash</span>
            <span class="font-bold">${cur}${(shift.openingBalance || 0).toFixed(2)}</span>
          </div>
          <div class="flex items-center justify-between py-4 text-success">
            <span style="opacity:0.8">Cash Sales</span>
            <span class="font-bold">+${cur}${cashSales.toFixed(2)}</span>
          </div>
          <div class="flex items-center justify-between py-4" style="font-size:11px;opacity:0.7">
            <span>  (incl. Round Off)</span>
            <span>${cur}${totalRoundOff.toFixed(2)}</span>
          </div>
          <div class="flex items-center justify-between py-4 text-success">
            <span style="opacity:0.8">Cash In (+)</span>
            <span class="font-bold">+${cur}${totalIn.toFixed(2)}</span>
          </div>
          <div class="flex items-center justify-between py-4 text-danger">
            <span style="opacity:0.8">Cash Out (-)</span>
            <span class="font-bold">-${cur}${totalOut.toFixed(2)}</span>
          </div>
          <div class="flex items-center justify-between py-8 font-bold text-accent" style="border-top:1px dashed var(--border);margin-top:6px">
            <span>Expected Cash</span>
            <span>${cur}${expectedCash.toFixed(2)}</span>
          </div>
        </div>

        <!-- All payment method totals -->
        <div>
          <h4 class="form-label mb-8">Collections Breakdown</h4>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
            ${Object.keys(shift.collections || {}).length === 0 ? `
              <div class="text-muted" style="font-size:12px;grid-column:span 3;text-align:center;padding:10px">No payments.</div>
            ` : Object.entries(shift.collections).map(([m, a]) => `
              <div style="text-align:center;padding:8px;background:var(--bg-elevated);border-radius:var(--radius-sm);font-size:12px">
                <div style="opacity:0.6;margin-bottom:2px">${m}</div>
                <div class="font-bold">${cur}${(a || 0).toFixed(2)}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Actual Cash -->
        <div class="form-group">
          <label class="form-label">Actual Cash in Drawer *</label>
          <input class="form-input" type="number" id="closingBal" value="${(expectedCash || 0).toFixed(2)}" step="0.01" />
          <div id="discrepancyNote" style="font-size:12px;margin-top:4px;text-align:right"></div>
        </div>

        <!-- Denomination Counter -->
        <div>
          <label class="form-label">Denomination Count (Optional)</label>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px">
            ${[2000, 500, 200, 100, 50, 20, 10, 5, 2, 1].map(d => `
              <div class="flex items-center gap-8" style="font-size:12px;padding:4px 8px;background:var(--bg-elevated);border-radius:var(--radius-sm)">
                <span style="width:44px;font-weight:600">${cur}${d} ×</span>
                <input type="number" class="form-input denomination-input" data-val="${d}" placeholder="0" style="padding:4px 8px;height:28px;font-size:12px" min="0" />
              </div>
            `).join('')}
          </div>
          <div style="font-size:11px;opacity:0.6;margin-top:4px;text-align:right">
            Denomination Total: <span id="denomTotal" class="font-bold">${cur}0.00</span>
          </div>
        </div>

        <!-- Notes -->
        <div class="form-group">
          <label class="form-label">Closing Notes</label>
          <textarea class="form-input" id="closingNotes" rows="2" placeholder="Any discrepancies or notes?"></textarea>
        </div>
      </div>
    `,
    footer: `
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" id="confirmCloseBtn"><i class="fa-solid fa-lock"></i> Finalize &amp; Close</button>
    `
  });

  // Denomination calculator
  const inputs = document.querySelectorAll('.denomination-input');
  const closingBalInput = document.getElementById('closingBal');
  const denomTotalEl = document.getElementById('denomTotal');
  const discrepancyEl = document.getElementById('discrepancyNote');

  const updateDiscrepancy = () => {
    const actual = parseFloat(closingBalInput.value) || 0;
    const diff = actual - expectedCash;
    if (Math.abs(diff) < 0.01) {
      discrepancyEl.innerHTML = `<span class="text-success"><i class="fa-solid fa-check"></i> Balanced</span>`;
    } else if (diff > 0) {
      discrepancyEl.innerHTML = `<span class="text-success">Surplus: +${cur}${diff.toFixed(2)}</span>`;
    } else {
      discrepancyEl.innerHTML = `<span class="text-danger">Shortage: ${cur}${diff.toFixed(2)}</span>`;
    }
  };

  inputs.forEach(input => {
    input.addEventListener('input', () => {
      let total = 0;
      inputs.forEach(i => {
        const qty = parseInt(i.value) || 0;
        total += qty * parseInt(i.dataset.val);
      });
      denomTotalEl.textContent = `${cur}${total.toFixed(2)}`;
      if (total > 0) {
        closingBalInput.value = total.toFixed(2);
        updateDiscrepancy();
      }
    });
  });

  closingBalInput.addEventListener('input', updateDiscrepancy);
  updateDiscrepancy();

  const confirmCloseBtn = document.getElementById('confirmCloseBtn');
  confirmCloseBtn.onclick = async () => {
    if (confirmCloseBtn.disabled) return;
    const bal = parseFloat(closingBalInput.value) || 0;
    const notes = document.getElementById('closingNotes').value.trim();
    confirmCloseBtn.disabled = true;
    try {
      await closeRegister(shift.id, bal, notes);
      showToast('Register closed. Shift summary saved.', 'info');
      closeModal();
      window.navigate('register');
    } catch (err) {
      confirmCloseBtn.disabled = false;
      showToast('Failed to close register: ' + err.message, 'error');
    }
  };
}

// ────────────────────────────────────────────────────────────────────
// View Historical Shift Details Modal
// ────────────────────────────────────────────────────────────────────
function openShiftDetailsModal(shiftId, cur, allShifts) {
  const shift = allShifts.find(s => s.id === shiftId);
  if (!shift) return;

  const cashSales = Object.entries(shift.collections || {}).reduce((sum, [m, a]) => {
    return m.toLowerCase() === 'cash' ? sum + a : sum;
  }, 0);
  const totalIn   = (shift.transactions || []).filter(t => t.type === 'In').reduce((s, t) => s + t.amount, 0);
  const totalOut  = (shift.transactions || []).filter(t => t.type === 'Out').reduce((s, t) => s + t.amount, 0);
  const expected  = (shift.openingBalance || 0) + cashSales + totalIn - totalOut;
  const diff      = shift.status === 'Closed' ? ((shift.closingBalance || 0) - expected) : null;

  openModal({
    title: `<i class="fa-solid fa-receipt"></i> Shift Summary — ${new Date(shift.openedAt).toLocaleDateString('en', { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' })}`,
    body: `
      <div style="display:flex;flex-direction:column;gap:18px">

        <!-- Status & Cashier -->
        <div class="grid-2">
          <div class="stat-info">
            <div style="font-size:11px;opacity:0.6">Cashier</div>
            <div class="font-bold">${escapeHtml(shift.openedBy || '—')}</div>
          </div>
          <div class="stat-info">
            <div style="font-size:11px;opacity:0.6">Status</div>
            <div class="badge ${shift.status === 'Open' ? 'badge-success' : 'badge-ghost'}">${shift.status}</div>
          </div>
          <div class="stat-info">
            <div style="font-size:11px;opacity:0.6">Opened At</div>
            <div class="font-semibold" style="font-size:13px">${new Date(shift.openedAt).toLocaleTimeString()}</div>
          </div>
          ${shift.closedAt ? `
            <div class="stat-info">
              <div style="font-size:11px;opacity:0.6">Closed At</div>
              <div class="font-semibold" style="font-size:13px">${new Date(shift.closedAt).toLocaleTimeString()}</div>
            </div>
          ` : ''}
        </div>

        <!-- Financial Summary -->
        <div style="background:var(--bg-elevated);border-radius:var(--radius-sm);padding:14px">
          <div class="flex items-center justify-between py-4">
            <span>Opening Balance</span>
            <span class="font-bold">${cur}${(shift.openingBalance || 0).toFixed(2)}</span>
          </div>
          <div class="flex items-center justify-between py-4 text-accent">
            <span>Total Sales</span>
            <span class="font-bold">${cur}${(shift.sales || 0).toFixed(2)}</span>
          </div>
          <div class="flex items-center justify-between py-4">
            <span>Orders Billed</span>
            <span class="font-bold">${shift.ordersCount || 0}</span>
          </div>
          <div class="flex items-center justify-between py-4 text-success">
            <span>Cash In</span>
            <span class="font-bold">+${cur}${totalIn.toFixed(2)}</span>
          </div>
          <div class="flex items-center justify-between py-4 text-danger">
            <span>Cash Out</span>
            <span class="font-bold">-${cur}${totalOut.toFixed(2)}</span>
          </div>
          <div class="flex items-center justify-between py-4 font-bold" style="border-top:1px dashed var(--border);margin-top:4px">
            <span>Expected Cash</span>
            <span class="text-accent">${cur}${expected.toFixed(2)}</span>
          </div>
          ${shift.status === 'Closed' ? `
            <div class="flex items-center justify-between py-4 font-bold text-success">
              <span>Actual Closing Cash</span>
              <span>${cur}${(shift.closingBalance || 0).toFixed(2)}</span>
            </div>
            <div class="flex items-center justify-between py-4" style="font-size:12px">
              <span>Discrepancy</span>
              <span class="${diff > 0 ? 'text-success' : diff < 0 ? 'text-danger' : 'text-muted'} font-bold">
                ${diff === null ? '—' : (diff >= 0 ? '+' : '') + cur + diff.toFixed(2)}
              </span>
            </div>
          ` : ''}
        </div>

        <!-- Payment Breakdown -->
        ${Object.keys(shift.collections || {}).length > 0 ? `
          <div>
            <h4 class="font-bold mb-8" style="font-size:13px">Payment Breakdown</h4>
            <div class="grid-2 gap-8">
              ${Object.entries(shift.collections || {}).map(([m, a]) => `
                <div style="padding:8px 12px;background:var(--bg-elevated);border-radius:var(--radius-sm);font-size:12px">
                  <span style="opacity:0.6">${m}:</span> <span class="font-bold">${cur}${(a || 0).toFixed(2)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Transactions -->
        ${(shift.transactions || []).length > 0 ? `
          <div>
            <h4 class="font-bold mb-8" style="font-size:13px">Cash Adjustments</h4>
            <div style="display:flex;flex-direction:column;gap:6px;max-height:180px;overflow-y:auto">
              ${shift.transactions.map(t => `
                <div class="flex items-center justify-between" style="padding:8px 10px;background:var(--bg-elevated);border-radius:var(--radius-sm);font-size:12px">
                  <div>
                    <span class="badge ${t.type === 'In' ? 'badge-success' : 'badge-danger'}" style="zoom:0.75;margin-right:6px">${t.type}</span>
                    <span>${escapeHtml(t.reason)}</span>
                    <div style="font-size:10px;opacity:0.5">${new Date(t.timestamp).toLocaleString()}</div>
                  </div>
                  <span class="font-bold ${t.type === 'In' ? 'text-success' : 'text-danger'}">${t.type === 'In' ? '+' : '-'}${cur}${(t.amount || 0).toFixed(2)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Closing Notes -->
        ${shift.notes ? `
          <div>
            <h4 class="font-bold mb-4" style="font-size:13px">Closing Notes</h4>
            <div style="font-size:12px;opacity:0.8;background:var(--bg-elevated);padding:10px;border-radius:var(--radius-sm)">${escapeHtml(shift.notes)}</div>
          </div>
        ` : ''}
      </div>
    `,
    footer: `<button class="btn btn-ghost" onclick="closeModal()">Close</button>`
  });
}
