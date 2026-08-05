// ============================================================
// ImportWizard.js — Advanced Product Import (Upload → Map → Preview → Import)
// ============================================================
// Replaces the old "silent" import (exact-header CSV/JSON straight into the
// DB, no preview, no error report, add-only) with a 4-step wizard:
//   1. Upload      — drag & drop / browse, CSV or JSON, + sample template
//   2. Map Columns — detected file headers mapped to product fields, with
//                    fuzzy auto-detection so well-named files need no manual work
//   3. Preview      — every row validated and shown as New / Update / Error,
//                    with an Add-only vs Add+Update mode toggle
//   4. Result       — progress bar while committing, then a summary + a
//                    downloadable CSV of any failed rows
//
// Deliberately import-only (export already has its own simpler flow in
// Products.js) — kept as its own module so Products.js doesn't grow further.

import { getProducts, addProduct, updateProduct, logInventoryChange, getCurrentUser } from '../db.js';
import { store } from '../store.js';
import { openModal, closeModal } from '../components/Modal.js';
import { showToast } from '../components/Toast.js';
import { escapeHtml } from '../utils/escapeHtml.js';

// ---- Target product fields we know how to import ----------------------
// `variantName` is the odd one out: it isn't a product field by itself —
// its presence on a row is what groups that row into a multi-variant
// product (see buildPreview()'s grouping pass) instead of a standalone one.
const TARGET_FIELDS = [
  { key: 'name', label: 'Product Name', required: true },
  { key: 'variantName', label: 'Variant Name (optional)' },
  { key: 'sku', label: 'SKU' },
  { key: 'barcode', label: 'Barcode' },
  { key: 'category', label: 'Category' },
  { key: 'subCategory', label: 'Sub-Category' },
  { key: 'price', label: 'Selling Price', required: true, type: 'number' },
  { key: 'costPrice', label: 'Cost Price', type: 'number' },
  { key: 'mrp', label: 'MRP', type: 'number' },
  { key: 'stock', label: 'Opening Stock', required: true, type: 'number' },
  { key: 'minStock', label: 'Min Stock Alert', type: 'number' },
  { key: 'hsnCode', label: 'HSN Code' },
  { key: 'taxRate', label: 'Tax Rate (%)', type: 'number' },
  { key: 'emoji', label: 'Emoji / Icon' },
  { key: 'expiryDate', label: 'Expiry Date' },
  { key: 'manufacturingDate', label: 'Manufacturing Date' },
];

// Header text -> target field, for auto-mapping. Matched against a
// normalized header (lowercased, punctuation stripped).
const FIELD_SYNONYMS = {
  name: ['name', 'product name', 'product', 'item', 'item name', 'title'],
  variantName: ['variant', 'variant name', 'option', 'option name', 'variation'],
  sku: ['sku', 'item code', 'product code', 'code'],
  barcode: ['barcode', 'ean', 'upc', 'bar code'],
  category: ['category', 'cat'],
  subCategory: ['subcategory', 'sub category', 'subcat'],
  price: ['price', 'selling price', 'sale price', 'rate'],
  costPrice: ['cost price', 'cost', 'purchase price', 'buy price'],
  mrp: ['mrp', 'retail price', 'list price'],
  stock: ['stock', 'qty', 'quantity', 'opening stock', 'on hand stock'],
  minStock: ['min stock', 'minimum stock', 'reorder level', 'low stock alert'],
  hsnCode: ['hsn', 'hsn code'],
  taxRate: ['tax', 'tax rate', 'gst', 'gst percent'],
  emoji: ['emoji', 'icon'],
  expiryDate: ['expiry', 'expiry date', 'exp date'],
  manufacturingDate: ['mfg date', 'manufacturing date', 'mfd'],
};

function normalizeHeader(h) {
  return String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function autoMapField(header) {
  const norm = normalizeHeader(header);

  // Exact match first, across all fields.
  for (const field of TARGET_FIELDS) {
    const synonyms = FIELD_SYNONYMS[field.key] || [];
    if (synonyms.includes(norm)) return field.key;
  }

  // Loose fallback: header contains/is-contained-by a synonym. Score by the
  // LONGEST matching synonym across every field rather than "first field in
  // TARGET_FIELDS order wins" — otherwise a short, generic synonym earlier
  // in the list (category's "cat") wins over a longer, more specific one
  // later in the list (subCategory's "sub category"), e.g. a "Sub Cat"
  // column would wrongly auto-map to Category just because "cat" ⊂ "sub cat".
  let best = { key: '', len: 0 };
  for (const field of TARGET_FIELDS) {
    const synonyms = FIELD_SYNONYMS[field.key] || [];
    for (const s of synonyms) {
      if ((norm.includes(s) || s.includes(norm)) && s.length > best.len) {
        best = { key: field.key, len: s.length };
      }
    }
  }
  return best.key;
}

// ---- File parsing (CSV / JSON -> {headers, rows}) ----------------------
// rows: array of plain objects keyed by the ORIGINAL file header text.
function parseDelimited(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 1) return { headers: [], rows: [] };

  const splitLine = (line) => {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    values.push(current);
    return values.map(v => v.trim());
  };

  const headers = splitLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = splitLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => { row[h] = values[idx] !== undefined ? values[idx] : ''; });
    rows.push(row);
  }
  return { headers, rows };
}

function parseJson(text) {
  const data = JSON.parse(text);
  const arr = Array.isArray(data) ? data : (Array.isArray(data.products) ? data.products : []);
  if (arr.length === 0) return { headers: [], rows: [] };
  // Union of keys across the first 50 rows, in first-seen order — covers
  // files where not every row has every column.
  const headerSet = [];
  arr.slice(0, 50).forEach(obj => {
    Object.keys(obj || {}).forEach(k => { if (!headerSet.includes(k)) headerSet.push(k); });
  });
  const rows = arr.map(obj => {
    const row = {};
    headerSet.forEach(h => { row[h] = obj[h] !== undefined && obj[h] !== null ? String(obj[h]) : ''; });
    return row;
  });
  return { headers: headerSet, rows };
}

function downloadTextFile(content, filename, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvEscape(val) {
  return `"${String(val ?? '').replace(/"/g, '""')}"`;
}

// ---- Wizard state --------------------------------------------------------
let state = null;

function freshState() {
  return {
    step: 1,
    fileName: '',
    headers: [],
    rawRows: [],
    mapping: {},          // targetKey -> source header string
    importMode: 'add',    // 'add' | 'upsert'
    parsed: [],           // [{ rowIndex, data, matchId, status, errors:[] }]
    result: null,         // { added, updated, skipped, errors: [{row, reason}] }
    importing: false,
  };
}

export async function openImportWizard(onComplete) {
  state = freshState();
  render(onComplete);
}

function footerForStep() {
  if (!state) return '';
  switch (state.step) {
    case 1:
      return `<button class="btn btn-ghost" id="iwCancelBtn">Cancel</button>`;
    case 2:
      return `
        <button class="btn btn-ghost" id="iwBackBtn">Back</button>
        <button class="btn btn-primary" id="iwToPreviewBtn">Continue to Preview <i class="fa-solid fa-arrow-right ml-8"></i></button>
      `;
    case 3:
      return `
        <button class="btn btn-ghost" id="iwBackBtn">Back</button>
        <button class="btn btn-primary" id="iwConfirmBtn"><i class="fa-solid fa-file-import mr-8"></i> Import Now</button>
      `;
    case 4:
      return `<button class="btn btn-primary" id="iwDoneBtn" style="width:100%">Done</button>`;
    default:
      return '';
  }
}

function stepDots() {
  const labels = ['Upload', 'Map Columns', 'Preview', 'Result'];
  return `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:24px;flex-wrap:wrap">
      ${labels.map((l, i) => {
        const n = i + 1;
        const active = n === state.step;
        const done = n < state.step;
        return `
          <div style="display:flex;align-items:center;gap:8px">
            <div style="width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;
              background:${done ? 'var(--success)' : active ? 'var(--primary)' : 'var(--bg-elevated)'};
              color:${done || active ? '#fff' : 'var(--text-muted)'};
              border:1px solid ${done ? 'var(--success)' : active ? 'var(--primary)' : 'var(--border)'};">
              ${done ? '<i class="fa-solid fa-check"></i>' : n}
            </div>
            <span style="font-size:13px;font-weight:${active ? '700' : '500'};color:${active ? 'var(--text-main)' : 'var(--text-muted)'}">${l}</span>
          </div>
          ${i < labels.length - 1 ? `<div style="width:24px;height:2px;background:${done ? 'var(--success)' : 'var(--border)'}"></div>` : ''}
        `;
      }).join('')}
    </div>
  `;
}

// NOTE: fullScreen + a real header/footer doesn't work in this app's Modal —
// .modal.modal-full only fixes the MODAL's own height at 100vh, it doesn't
// make it a flex column, so modal-header + modal-body(height:100%) +
// modal-footer stack past 100vh and the footer (this wizard's Back/Continue/
// Import buttons) ends up scrolled off past the bottom of the screen. The
// only other fullScreen callers in this codebase (CheckoutService,
// QuickCheckoutService) sidestep this by passing hideHeader:true and
// footer:'' — same fix here: render our own title bar + button bar as
// direct children of modal-body itself, which Modal.js already makes a
// height:100% flex column for fullScreen modals, and let this middle
// section be the only one that scrolls.
function render(onComplete) {
  openModal({
    body: `
      <div style="flex-shrink:0;padding:20px 24px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
        <div class="modal-title"><i class="fa-solid fa-file-import mr-8" style="color:var(--primary)"></i> Import Products</div>
        <button class="modal-close" id="iwCloseBtn" aria-label="Close" ${state.importing ? 'disabled style="opacity:0.3"' : ''}><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div id="iwBody" style="flex:1;overflow-y:auto;padding:24px">${bodyForStep()}</div>
      <div id="iwFooter" style="flex-shrink:0;padding:16px 24px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:12px">${footerForStep()}</div>
    `,
    footer: '',
    hideHeader: true,
    hideClose: true,
    fullScreen: true,
    sidePanel: false,
    // Always on, not just state.importing — rerender() only patches
    // #iwBody/#iwFooter's innerHTML, it doesn't re-run openModal(), so
    // Modal.js's backdrop/Escape handlers are bound ONCE here with whatever
    // value this had at that moment and can never see a later state change.
    // Closing is handled explicitly instead, via iwCloseBtn/iwCancelBtn/
    // iwDoneBtn, which do check state.importing live.
    disableBackdropDismiss: true,
  });
  wireStep(onComplete);
}

function rerender(onComplete) {
  const bodyEl = document.getElementById('iwBody');
  if (bodyEl) bodyEl.innerHTML = bodyForStep();
  const footerEl = document.getElementById('iwFooter');
  if (footerEl) footerEl.innerHTML = footerForStep();
  const closeBtn = document.getElementById('iwCloseBtn');
  if (closeBtn) { closeBtn.disabled = state.importing; closeBtn.style.opacity = state.importing ? '0.3' : ''; }
  wireStep(onComplete);
}

function bodyForStep() {
  switch (state.step) {
    case 1: return stepUploadHtml();
    case 2: return stepMappingHtml();
    case 3: return stepPreviewHtml();
    case 4: return stepResultHtml();
    default: return '';
  }
}

// ---- Step 1: Upload -------------------------------------------------------
function stepUploadHtml() {
  return `
    ${stepDots()}
    <div id="iwDropZone" style="border:2px dashed var(--border);border-radius:16px;padding:48px 24px;text-align:center;cursor:pointer;transition:all .2s;background:var(--bg-elevated)">
      <i class="fa-solid fa-cloud-arrow-up" style="font-size:40px;color:var(--primary);opacity:0.7;margin-bottom:16px;display:block"></i>
      <div style="font-weight:700;font-size:16px;margin-bottom:6px">Drag & drop your file here</div>
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:16px">or click to browse — CSV or JSON</div>
      <button class="btn btn-primary" id="iwBrowseBtn" type="button"><i class="fa-solid fa-folder-open mr-8"></i> Browse File</button>
      <input type="file" id="iwFileInput" accept=".csv,.json" style="display:none" />
    </div>
    <div style="margin-top:20px;display:flex;align-items:center;justify-content:space-between;background:var(--bg-elevated);border:1px solid var(--border);border-radius:12px;padding:14px 18px">
      <div style="font-size:13px;color:var(--text-muted)">
        <i class="fa-solid fa-circle-info mr-8" style="color:var(--primary)"></i>
        Not sure of the format? Download a sample template to fill in.
      </div>
      <button class="btn btn-ghost btn-sm" id="iwTemplateBtn"><i class="fa-solid fa-download mr-8"></i> Sample Template</button>
    </div>
  `;
}

// Groups raw rows by Name+Category using the CURRENT mapping, for a live
// "here's what your variants will look like" preview on the mapping step —
// same grouping rule buildPreview() uses later, just without the DB lookups
// (matching/new-vs-update isn't decided yet at this step).
function computeVariantGroupsPreview() {
  const nameHeader = state.mapping.name;
  const catHeader = state.mapping.category;
  const variantHeader = state.mapping.variantName;
  if (!nameHeader || !variantHeader) return [];

  const groups = new Map(); // key -> { name, category, variants: [string] }
  state.rawRows.forEach(row => {
    const variantVal = (row[variantHeader] || '').trim();
    if (!variantVal) return;
    const name = (row[nameHeader] || '').trim();
    if (!name) return;
    const category = (catHeader ? row[catHeader] : '') || 'General';
    const key = `${name.toLowerCase()}|${category.toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, { name, category, variants: [] });
    groups.get(key).variants.push(variantVal);
  });
  return [...groups.values()];
}

// ---- Step 2: Column Mapping -----------------------------------------------
function stepMappingHtml() {
  // The first NON-EMPTY value for each column, not always row[0] — a column
  // like Variant Name is often blank on a file's first (non-variant) row,
  // and showing "empty" there made an already-working mapping look broken.
  const sampleFor = (h) => {
    for (const row of state.rawRows) {
      if (row[h] !== undefined && row[h] !== '') return row[h];
    }
    return '';
  };
  return `
    ${stepDots()}
    <div style="margin-bottom:16px;font-size:13px;color:var(--text-muted)">
      <i class="fa-solid fa-file-lines mr-8"></i><b>${escapeHtml(state.fileName)}</b> — ${state.rawRows.length} row(s) detected.
      Match each column from your file to a product field. Columns already look correctly matched where possible — double-check before continuing.
    </div>
    ${state.mapping.variantName ? `
      <div style="margin-bottom:16px;font-size:12px;color:var(--text-main);background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;padding:12px 16px">
        <i class="fa-solid fa-circle-info mr-8" style="color:var(--primary)"></i>
        Variant Name detected — rows sharing the same Product Name + Category become <b>one product with multiple variants</b>.
        Only <b>Price, Cost Price, Stock and Min Stock</b> may differ between those rows; SKU, Barcode, MRP, HSN and Tax Rate are
        product-level, so only the <b>first</b> variant row's values for those columns are kept — repeat the same value on every
        variant row to avoid surprises.
      </div>
      ${(() => {
        const groups = computeVariantGroupsPreview();
        if (groups.length === 0) {
          return `<div style="margin-bottom:16px;font-size:12px;color:var(--text-muted);font-style:italic">No variant rows detected yet — make sure Product Name is also mapped above.</div>`;
        }
        return `
          <div style="margin-bottom:16px">
            <div class="form-label" style="margin-bottom:8px">Detected Variant Groups (${groups.length})</div>
            <div style="display:flex;flex-direction:column;gap:8px">
              ${groups.map(g => `
                <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;padding:12px 16px">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                    <b>${escapeHtml(g.name)}</b>
                    <span class="badge badge-ghost" style="font-size:10px">${escapeHtml(g.category)}</span>
                    <span class="badge badge-primary-light" style="font-size:10px">${g.variants.length} variant${g.variants.length > 1 ? 's' : ''}</span>
                  </div>
                  <div style="display:flex;flex-wrap:wrap;gap:6px">
                    ${g.variants.map(v => `<span class="badge badge-ghost" style="font-size:11px;font-weight:500">${escapeHtml(v)}</span>`).join('')}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      })()}
    ` : ''}
    <div class="table-wrap" style="max-height:420px;overflow:auto">
      <table class="responsive-table">
        <thead>
          <tr>
            <th>Your Column</th>
            <th>Sample Value</th>
            <th>Maps To</th>
          </tr>
        </thead>
        <tbody>
          ${state.headers.map(h => `
            <tr>
              <td data-label="Your Column"><b>${escapeHtml(h)}</b></td>
              <td data-label="Sample Value"><span style="opacity:0.7;font-size:12px">${escapeHtml(String(sampleFor(h)).slice(0, 40)) || '<em>empty in every row</em>'}</span></td>
              <td data-label="Maps To">
                <select class="form-select iw-map-select" data-header="${escapeHtml(h)}" style="min-width:190px">
                  <option value="">— Ignore this column —</option>
                  ${TARGET_FIELDS.map(f => `<option value="${f.key}" ${state.mapping[f.key] === h ? 'selected' : ''}>${f.label}${f.required ? ' *' : ''}</option>`).join('')}
                </select>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div style="margin-top:12px;font-size:12px;color:var(--text-muted)">* Required fields — rows missing these will be flagged as errors in the preview.</div>
  `;
}

// ---- Step 3: Preview -------------------------------------------------------
function statusBadge(status) {
  if (status === 'new') return `<span class="badge badge-success" style="font-size:10px">NEW</span>`;
  if (status === 'update') return `<span class="badge badge-primary-light" style="font-size:10px">WILL UPDATE</span>`;
  if (status === 'skip') return `<span class="badge badge-ghost" style="font-size:10px">DUPLICATE (SKIPPED)</span>`;
  return `<span class="badge badge-danger" style="font-size:10px">ERROR</span>`;
}

function stepPreviewHtml() {
  const counts = state.parsed.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  const rows = state.parsed;
  return `
    ${stepDots()}
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">
      <div class="stat-card" style="flex:1;min-width:120px;padding:14px"><div class="stat-label" style="font-size:11px">New</div><div class="stat-value" style="font-size:20px;color:var(--success)">${counts.new || 0}</div></div>
      <div class="stat-card" style="flex:1;min-width:120px;padding:14px"><div class="stat-label" style="font-size:11px">Will Update</div><div class="stat-value" style="font-size:20px;color:var(--primary)">${counts.update || 0}</div></div>
      <div class="stat-card" style="flex:1;min-width:120px;padding:14px"><div class="stat-label" style="font-size:11px">Duplicates (Skipped)</div><div class="stat-value" style="font-size:20px;color:var(--text-muted)">${counts.skip || 0}</div></div>
      <div class="stat-card" style="flex:1;min-width:120px;padding:14px"><div class="stat-label" style="font-size:11px">Errors</div><div class="stat-value" style="font-size:20px;color:var(--danger)">${counts.error || 0}</div></div>
    </div>

    <div class="form-group" style="margin-bottom:16px">
      <label class="form-label">Import Mode</label>
      <select class="form-select" id="iwImportMode" style="max-width:340px">
        <option value="add" ${state.importMode === 'add' ? 'selected' : ''}>Add new only (skip existing matches)</option>
        <option value="upsert" ${state.importMode === 'upsert' ? 'selected' : ''}>Add new + Update existing matches</option>
      </select>
      <p style="font-size:11px;color:var(--text-muted);margin-top:6px">Matches are found by SKU, then Barcode, then Name+Category.</p>
    </div>

    <div class="table-wrap" style="max-height:380px;overflow:auto">
      <table class="responsive-table">
        <thead>
          <tr><th>#</th><th>Status</th><th>Name</th><th>SKU</th><th>Price</th><th>Stock</th><th>Category</th><th>Notes</th></tr>
        </thead>
        <tbody>
          ${rows.slice(0, 500).map((r, i) => {
            const isVariantGroup = r.data.variants && r.data.variants.length > 0;
            const hardErrors = r.errors.filter(e => !e.startsWith('(warning)'));
            const notes = r.errors.join(', ');
            return `
            <tr style="${r.status === 'error' ? 'background:rgba(239,68,68,0.06)' : ''}">
              <td data-label="#">${i + 1}</td>
              <td data-label="Status">${statusBadge(r.status)}</td>
              <td data-label="Name">
                ${escapeHtml(r.data.name || '')}
                ${isVariantGroup ? `<span class="badge badge-primary-light" style="font-size:9px;margin-left:6px">${r.data.variants.length} VARIANT${r.data.variants.length > 1 ? 'S' : ''}</span>` : ''}
              </td>
              <td data-label="SKU">${escapeHtml(r.data.sku || '')}</td>
              <td data-label="Price">${r.data.price ?? ''}${isVariantGroup ? ' <span style="opacity:0.6">(1st variant)</span>' : ''}</td>
              <td data-label="Stock">${r.data.stock ?? ''}${isVariantGroup ? ' <span style="opacity:0.6">(total)</span>' : ''}</td>
              <td data-label="Category">${escapeHtml(r.data.category || '')}</td>
              <td data-label="Notes" style="color:${hardErrors.length ? 'var(--danger)' : 'var(--warning)'};font-size:12px">${notes}</td>
            </tr>
          `;
          }).join('')}
        </tbody>
      </table>
      ${rows.length > 500 ? `<div style="text-align:center;padding:10px;font-size:12px;color:var(--text-muted)">+ ${rows.length - 500} more row(s) not shown in preview (they will still be imported)</div>` : ''}
    </div>
  `;
}

// ---- Step 4: Result ---------------------------------------------------
function stepResultHtml() {
  if (state.importing) {
    return `
      ${stepDots()}
      <div style="text-align:center;padding:60px 20px">
        <div class="spinner" style="margin:0 auto 20px"></div>
        <div style="font-weight:700;margin-bottom:8px">Importing products…</div>
        <div style="font-size:13px;color:var(--text-muted)" id="iwProgressText">Starting…</div>
        <div style="max-width:320px;margin:16px auto 0;height:8px;border-radius:4px;background:var(--bg-elevated);overflow:hidden">
          <div id="iwProgressBar" style="height:100%;width:0%;background:var(--primary);transition:width .15s"></div>
        </div>
      </div>
    `;
  }
  const r = state.result || { added: 0, updated: 0, skipped: 0, errors: [] };
  return `
    ${stepDots()}
    <div style="text-align:center;padding:24px 20px 12px">
      <i class="fa-solid fa-circle-check" style="font-size:48px;color:var(--success);margin-bottom:16px;display:block"></i>
      <div style="font-weight:700;font-size:18px;margin-bottom:20px">Import Complete</div>
    </div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;justify-content:center">
      <div class="stat-card" style="min-width:130px;padding:14px"><div class="stat-label" style="font-size:11px">Added</div><div class="stat-value" style="font-size:22px;color:var(--success)">${r.added}</div></div>
      <div class="stat-card" style="min-width:130px;padding:14px"><div class="stat-label" style="font-size:11px">Updated</div><div class="stat-value" style="font-size:22px;color:var(--primary)">${r.updated}</div></div>
      <div class="stat-card" style="min-width:130px;padding:14px"><div class="stat-label" style="font-size:11px">Skipped</div><div class="stat-value" style="font-size:22px;color:var(--text-muted)">${r.skipped}</div></div>
      <div class="stat-card" style="min-width:130px;padding:14px"><div class="stat-label" style="font-size:11px">Errors</div><div class="stat-value" style="font-size:22px;color:var(--danger)">${r.errors.length}</div></div>
    </div>
    ${r.errors.length > 0 ? `
      <div style="text-align:center">
        <button class="btn btn-ghost" id="iwDownloadErrorsBtn"><i class="fa-solid fa-download mr-8"></i> Download Error Report (${r.errors.length} row${r.errors.length > 1 ? 's' : ''})</button>
      </div>
    ` : ''}
  `;
}

// ---- Wiring per step -------------------------------------------------------
function wireStep(onComplete) {
  const closeBtn = document.getElementById('iwCloseBtn');
  if (closeBtn) closeBtn.onclick = () => { if (!state.importing) closeModal(); };
  const cancelBtn = document.getElementById('iwCancelBtn');
  if (cancelBtn) cancelBtn.onclick = () => closeModal();

  if (state.step === 1) {
    const dropZone = document.getElementById('iwDropZone');
    const fileInput = document.getElementById('iwFileInput');
    const browseBtn = document.getElementById('iwBrowseBtn');
    const templateBtn = document.getElementById('iwTemplateBtn');

    const handleFile = async (file) => {
      if (!file) return;
      try {
        const text = await file.text();
        let parsedResult;
        if (file.name.toLowerCase().endsWith('.json') || text.trim().startsWith('[') || text.trim().startsWith('{')) {
          parsedResult = parseJson(text);
        } else {
          parsedResult = parseDelimited(text);
        }
        if (parsedResult.headers.length === 0 || parsedResult.rows.length === 0) {
          showToast('No rows found in this file.', 'warning');
          return;
        }
        state.fileName = file.name;
        state.headers = parsedResult.headers;
        state.rawRows = parsedResult.rows;
        // Auto-map
        state.mapping = {};
        parsedResult.headers.forEach(h => {
          const key = autoMapField(h);
          if (key && !state.mapping[key]) state.mapping[key] = h;
        });
        state.step = 2;
        rerender(onComplete);
      } catch (err) {
        console.error('Import parse error:', err);
        showToast('Could not read this file. Make sure it is a valid CSV or JSON.', 'error');
      }
    };

    // browseBtn sits INSIDE dropZone, so a click on it also bubbles up to
    // dropZone's own click handler below — without stopping it there, a
    // single click on "Browse File" fired fileInput.click() twice, opening
    // the native file picker twice in a row.
    if (browseBtn) browseBtn.onclick = (e) => { e.stopPropagation(); fileInput.click(); };
    if (dropZone) dropZone.onclick = (e) => { if (e.target === dropZone || (dropZone.contains(e.target) && e.target !== browseBtn)) fileInput.click(); };
    if (fileInput) fileInput.onchange = (e) => handleFile(e.target.files[0]);

    if (dropZone) {
      ['dragover', 'dragenter'].forEach(evt => dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--primary)';
        dropZone.style.background = 'var(--primary-light)';
      }));
      ['dragleave', 'dragend'].forEach(evt => dropZone.addEventListener(evt, () => {
        dropZone.style.borderColor = 'var(--border)';
        dropZone.style.background = 'var(--bg-elevated)';
      }));
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--border)';
        dropZone.style.background = 'var(--bg-elevated)';
        const file = e.dataTransfer.files[0];
        handleFile(file);
      });
    }

    if (templateBtn) templateBtn.onclick = () => {
      const headers = TARGET_FIELDS.map(f => f.label);
      // Row 1 shows a plain (no-variant) product. Rows 2-3 show how variants
      // work: same Product Name + Category, one row per variant — these two
      // rows import as ONE product with 2 variants, not two products.
      // Only Variant Name/Price/Cost/Stock/Min Stock are allowed to differ
      // between a product's variant rows — SKU, Barcode, MRP, HSN, Tax etc.
      // are PRODUCT-level fields (the app's variant schema has no per-variant
      // SKU/barcode/MRP), so every variant row repeats the SAME values for
      // those columns; only the first row's copy of them is actually kept.
      const rows = [
        ['Sample Product', '', 'SKU-001', '8901234567890', 'Grocery', 'Snacks', '99.00', '70.00', '110.00', '25', '5', '21069099', '5', '📦', '', ''],
        ['Sample T-Shirt', 'Red - Medium', 'TSHIRT-001', '', 'Apparel', '', '299.00', '150.00', '399.00', '10', '2', '', '', '👕', '', ''],
        ['Sample T-Shirt', 'Blue - Large', 'TSHIRT-001', '', 'Apparel', '', '349.00', '160.00', '399.00', '8', '2', '', '', '👕', '', ''],
      ];
      const csv = [headers.map(csvEscape).join(','), ...rows.map(r => r.map(csvEscape).join(','))].join('\n');
      downloadTextFile(csv, 'product_import_template.csv');
    };
    return;
  }

  if (state.step === 2) {
    document.querySelectorAll('.iw-map-select').forEach(sel => {
      sel.addEventListener('change', () => {
        const header = sel.dataset.header;
        const newKey = sel.value;
        // Clear any other field currently mapped to this same target key
        // (a target field can only be mapped from one column at a time).
        if (newKey) {
          Object.keys(state.mapping).forEach(k => { if (k === newKey) delete state.mapping[k]; });
          state.mapping[newKey] = header;
        } else {
          Object.keys(state.mapping).forEach(k => { if (state.mapping[k] === header) delete state.mapping[k]; });
        }
        // Re-render so the Detected Variant Groups preview (and the info
        // banner) stay live as the user maps/un-maps columns, instead of
        // only reflecting whatever was auto-detected on file upload.
        rerender(onComplete);
      });
    });

    const backBtn = document.getElementById('iwBackBtn');
    if (backBtn) backBtn.onclick = () => { state.step = 1; rerender(onComplete); };

    const nextBtn = document.getElementById('iwToPreviewBtn');
    if (nextBtn) nextBtn.onclick = async () => {
      const missingRequired = TARGET_FIELDS.filter(f => f.required && !state.mapping[f.key]);
      if (missingRequired.length > 0) {
        showToast(`Please map: ${missingRequired.map(f => f.label).join(', ')}`, 'error');
        return;
      }
      await buildPreview();
      state.step = 3;
      rerender(onComplete);
    };
    return;
  }

  if (state.step === 3) {
    const backBtn = document.getElementById('iwBackBtn');
    if (backBtn) backBtn.onclick = () => { state.step = 2; rerender(onComplete); };

    const modeSelect = document.getElementById('iwImportMode');
    if (modeSelect) modeSelect.addEventListener('change', async () => {
      state.importMode = modeSelect.value;
      await buildPreview(); // re-evaluate duplicate rows as skip vs update
      rerender(onComplete);
    });

    const confirmBtn = document.getElementById('iwConfirmBtn');
    if (confirmBtn) confirmBtn.onclick = async () => {
      const importable = state.parsed.filter(r => r.status === 'new' || r.status === 'update');
      if (importable.length === 0) {
        showToast('Nothing to import — every row is a duplicate or has an error.', 'warning');
        return;
      }
      state.step = 4;
      state.importing = true;
      rerender(onComplete);
      await runImport(onComplete);
    };
    return;
  }

  if (state.step === 4) {
    const downloadBtn = document.getElementById('iwDownloadErrorsBtn');
    if (downloadBtn) downloadBtn.onclick = () => {
      const headers = ['Row', 'Reason', ...TARGET_FIELDS.map(f => f.label)];
      const lines = [headers.map(csvEscape).join(',')];
      state.result.errors.forEach(e => {
        lines.push([e.row, e.reason, ...TARGET_FIELDS.map(f => e.data?.[f.key] ?? '')].map(csvEscape).join(','));
      });
      downloadTextFile(lines.join('\n'), 'import_errors.csv');
    };
    const doneBtn = document.getElementById('iwDoneBtn');
    if (doneBtn) doneBtn.onclick = async () => {
      closeModal();
      if (onComplete) await onComplete();
    };
  }
}

// ---- Build preview: map raw rows -> product data, validate, find matches ---
function rowHasValidPriceStock(data) {
  const errs = [];
  if (data.price === undefined || Number.isNaN(data.price) || data.price < 0) errs.push('Missing/invalid price');
  if (data.stock === undefined || Number.isNaN(data.stock) || data.stock < 0) errs.push('Missing/invalid stock');
  return errs;
}

function matchExisting(data, bySku, byBarcode, byNameCat) {
  return (data.sku && bySku.get(data.sku.toLowerCase()))
    || (data.barcode && byBarcode.get(data.barcode.toLowerCase()))
    || byNameCat.get(`${data.name.toLowerCase()}|${data.category.toLowerCase()}`)
    || null;
}

async function buildPreview() {
  const existing = await getProducts();
  const bySku = new Map();
  const byBarcode = new Map();
  const byNameCat = new Map();
  existing.forEach(p => {
    if (p.sku) bySku.set(String(p.sku).toLowerCase(), p);
    if (p.barcode) byBarcode.set(String(p.barcode).toLowerCase(), p);
    byNameCat.set(`${(p.name || '').toLowerCase()}|${(p.category || '').toLowerCase()}`, p);
  });

  // Pass 1: map every raw row to its target fields, unvalidated.
  const mappedRows = state.rawRows.map((raw, idx) => {
    const data = {};
    TARGET_FIELDS.forEach(f => {
      const sourceHeader = state.mapping[f.key];
      let val = sourceHeader ? raw[sourceHeader] : '';
      if (f.type === 'number') {
        val = val === '' || val === undefined ? undefined : Number(val);
      } else {
        val = (val || '').toString().trim();
      }
      data[f.key] = val;
    });
    if (!data.category) data.category = 'General';
    return { rowIndex: idx, data };
  });

  // Pass 2: split into standalone rows vs. variant-group candidates (any row
  // with a Variant Name is grouped by Name+Category into ONE product with a
  // `variants` array — same product Name repeated across several rows is how
  // a spreadsheet naturally expresses "one product, several options").
  const standalone = [];
  const groups = new Map(); // key -> { rows: [{rowIndex,data}], firstData }
  mappedRows.forEach(({ rowIndex, data }) => {
    if (data.variantName) {
      const key = `${(data.name || '').toLowerCase()}|${(data.category || '').toLowerCase()}`;
      if (!groups.has(key)) groups.set(key, { rows: [], firstData: data });
      groups.get(key).rows.push({ rowIndex, data });
    } else {
      delete data.variantName; // grouping hint only — not a real product field
      standalone.push({ rowIndex, data });
    }
  });

  const finalize = (rowIndex, data, errors) => {
    let status = 'new';
    let matchId = null;
    if (errors.length === 0) {
      const match = matchExisting(data, bySku, byBarcode, byNameCat);
      if (match) {
        matchId = match.id;
        status = state.importMode === 'upsert' ? 'update' : 'skip';
      }
    } else {
      status = 'error';
    }
    return { rowIndex, data, matchId, status, errors };
  };

  const parsed = [];

  standalone.forEach(({ rowIndex, data }) => {
    const errors = [];
    if (!data.name) errors.push('Missing product name');
    errors.push(...rowHasValidPriceStock(data));
    parsed.push(finalize(rowIndex, data, errors));
  });

  groups.forEach((group) => {
    const firstRowIndex = group.rows[0].rowIndex;
    const groupErrors = [];
    if (!group.firstData.name) groupErrors.push('Missing product name');

    const validVariants = [];
    const badVariantRows = [];
    group.rows.forEach(({ rowIndex, data }) => {
      const vErrors = rowHasValidPriceStock(data);
      if (vErrors.length > 0) { badVariantRows.push(rowIndex + 1); return; }
      validVariants.push({
        name: data.variantName,
        price: data.price,
        costPrice: data.costPrice || 0,
        stock: data.stock,
        minStock: data.minStock || 0,
      });
    });

    if (groupErrors.length === 0 && validVariants.length === 0) {
      groupErrors.push(`All ${group.rows.length} variant row(s) for this product have missing/invalid price or stock`);
    }

    const combined = {
      ...group.firstData,
      variants: validVariants,
      price: validVariants[0]?.price ?? group.firstData.price,
      costPrice: validVariants[0]?.costPrice ?? group.firstData.costPrice,
      stock: validVariants.reduce((s, v) => s + (Number(v.stock) || 0), 0),
      minStock: validVariants.reduce((s, v) => s + (Number(v.minStock) || 0), 0),
    };
    delete combined.variantName; // was only a grouping hint, not a real product field

    if (badVariantRows.length > 0 && groupErrors.length === 0) {
      // Group still imports on its valid variants — this is a soft warning,
      // not a hard error, so it doesn't block the whole product.
      groupErrors.push(`(warning) row(s) ${badVariantRows.join(', ')} skipped — invalid price/stock`);
    }

    const entry = finalize(firstRowIndex, combined, groupErrors.filter(e => !e.startsWith('(warning)')));
    entry.errors = groupErrors; // keep the warning text visible in the preview/notes column
    entry.variantRowCount = group.rows.length;
    parsed.push(entry);
  });

  parsed.sort((a, b) => a.rowIndex - b.rowIndex);
  state.parsed = parsed;
}

// ---- Commit to DB with progress -------------------------------------------
async function runImport(onComplete) {
  const total = state.parsed.filter(r => r.status !== 'skip').length || 1;
  let done = 0;
  const result = { added: 0, updated: 0, skipped: 0, errors: [] };
  const user = await getCurrentUser();
  const branchId = store.branch?.id || 'b1';

  for (const row of state.parsed) {
    if (row.status === 'skip') { result.skipped++; continue; }
    if (row.status === 'error') { result.errors.push({ row: row.rowIndex + 1, reason: row.errors.join('; '), data: row.data }); continue; }

    try {
      if (row.status === 'new') {
        const added = await addProduct({ ...row.data });
        if (added.stock > 0) {
          await logInventoryChange(added.id, null, 'IN', added.stock, 'Bulk Import', added.branchId || branchId, null, 0, added.stock, user?.name);
        }
        result.added++;
      } else if (row.status === 'update') {
        const existing = (await getProducts()).find(p => String(p.id) === String(row.matchId));
        if (!existing) { result.errors.push({ row: row.rowIndex + 1, reason: 'Existing match not found (may have been deleted)', data: row.data }); continue; }
        const oldStock = Number(existing.stock) || 0;
        const merged = { ...existing, ...row.data, id: existing.id, branchId: existing.branchId };
        await updateProduct(merged);
        if (merged.stock !== oldStock) {
          const delta = merged.stock - oldStock;
          await logInventoryChange(existing.id, null, delta >= 0 ? 'IN' : 'OUT', Math.abs(delta), 'Bulk Import Update', existing.branchId || branchId, oldStock, delta, merged.stock, user?.name);
        }
        result.updated++;
      }
    } catch (err) {
      result.errors.push({ row: row.rowIndex + 1, reason: err.message || 'Unknown error', data: row.data });
    }

    done++;
    const pct = Math.round((done / total) * 100);
    const bar = document.getElementById('iwProgressBar');
    const txt = document.getElementById('iwProgressText');
    if (bar) bar.style.width = pct + '%';
    if (txt) txt.textContent = `${done} / ${total} processed…`;
    // Yield to the event loop periodically so the progress bar actually paints.
    if (done % 5 === 0) await new Promise(r => setTimeout(r, 0));
  }

  state.result = result;
  state.importing = false;
  rerender(onComplete);

  const summary = `${result.added} added, ${result.updated} updated${result.skipped ? `, ${result.skipped} skipped` : ''}${result.errors.length ? `, ${result.errors.length} error(s)` : ''}`;
  showToast(summary, result.errors.length > 0 ? 'warning' : 'success');
  if (onComplete) await onComplete();
}
