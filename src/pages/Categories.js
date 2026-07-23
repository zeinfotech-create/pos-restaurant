// ============================================================
// Categories.js — Standalone Category & Sub-Category Management
// ============================================================

import { getCategories, saveCategory, deleteCategory, getSubCategories, saveSubCategory, deleteSubCategory } from '../db.js';
import { openModal, closeModal, showConfirm } from '../components/Modal.js';
import { showToast } from '../components/Toast.js';

let selectedCategoryId = null;

export async function renderCategories(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Categories</div>
        <div class="page-subtitle">Manage your product categories and sub-categories</div>
      </div>
    </div>
    <div id="categoriesContent"></div>
  `;
  await renderCategoriesContent();
}

async function renderCategoriesContent() {
  const area = document.getElementById('categoriesContent');
  if (!area) return;

  const categories = (await getCategories()).sort((a,b) => {
    const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    if (timeB !== timeA) return timeB - timeA;
    return String(b.id).localeCompare(String(a.id));
  });
  const subCategories = selectedCategoryId ? await getSubCategories(selectedCategoryId) : [];
  const selectedCat = categories.find(c => c.id === selectedCategoryId);

  area.innerHTML = `
    <div class="categories-layout">

      <!-- Left: Category List -->
      <div class="card" style="padding:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px">
          <div style="font-size:15px; font-weight:800; color:var(--text-main)">
            <i class="fa-solid fa-layer-group" style="color:var(--primary); margin-right:8px"></i>Categories
          </div>
          <button class="btn btn-primary btn-sm" id="addCategoryBtn">
            <i class="fa-solid fa-plus"></i> New
          </button>
        </div>

        <div style="display:flex; flex-direction:column; gap:8px;">
          ${categories.length === 0 ? `
            <div style="text-align:center; padding:32px; color:var(--text-muted);">
              <i class="fa-solid fa-layer-group" style="font-size:32px; opacity:0.2; margin-bottom:12px; display:block"></i>
              <div style="font-size:13px; font-weight:600">No categories yet</div>
              <div style="font-size:12px; margin-top:4px">Click "New" to create one</div>
            </div>
          ` : categories.map(cat => `
            <div class="cat-row ${selectedCategoryId === cat.id ? 'cat-row-active' : ''}"
                 data-id="${cat.id}"
                 style="padding:12px 16px; border-radius:10px; border:1px solid ${selectedCategoryId === cat.id ? 'var(--primary)' : 'var(--border)'}; background:${selectedCategoryId === cat.id ? 'rgba(99,102,241,0.08)' : 'var(--bg-elevated)'}; cursor:pointer; display:flex; justify-content:space-between; align-items:center; transition:all 0.2s;">
              <div style="display:flex; align-items:center; gap:10px;">
                <div style="width:8px; height:8px; border-radius:50%; background:${selectedCategoryId === cat.id ? 'var(--primary)' : 'var(--border)'}"></div>
                <span style="font-weight:700; font-size:13px">${cat.name}</span>
              </div>
              <div style="display:flex; gap:6px;" onclick="event.stopPropagation()">
                <button class="btn-icon edit-cat-btn" data-id="${cat.id}" title="Edit">
                  <i class="fa-solid fa-pen" style="font-size:11px"></i>
                </button>
                <button class="btn-icon del-cat-btn" data-id="${cat.id}" title="Delete">
                  <i class="fa-solid fa-trash" style="font-size:11px; color:var(--danger)"></i>
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Right: Sub-category Panel -->
      <div class="card" style="padding:20px; min-height:420px;">
        ${!selectedCategoryId ? `
          <div style="height:360px; display:flex; flex-direction:column; align-items:center; justify-content:center; color:var(--text-muted); text-align:center; gap:12px;">
            <i class="fa-solid fa-arrow-left" style="font-size:36px; opacity:0.15"></i>
            <div style="font-size:14px; font-weight:700">Select a Category</div>
            <div style="font-size:12px; opacity:0.6">Click a category on the left to manage its sub-categories</div>
          </div>
        ` : `
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px">
            <div>
              <div style="font-size:15px; font-weight:800; color:var(--text-main)">
                <i class="fa-solid fa-layer-group" style="color:var(--primary); opacity:0.5; margin-right:6px; font-size:12px"></i>
                ${selectedCat?.name}
                <i class="fa-solid fa-chevron-right" style="font-size:10px; opacity:0.3; margin:0 6px"></i>
                Sub-categories
              </div>
              <div style="font-size:11px; color:var(--text-muted); margin-top:2px">${subCategories.length} sub-categories</div>
            </div>
            <button class="btn btn-primary btn-sm" id="addSubCatBtn">
              <i class="fa-solid fa-plus"></i> Add Sub-category
            </button>
          </div>

          <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap:12px;">
            ${subCategories.length === 0 ? `
              <div style="grid-column:1/-1; text-align:center; padding:48px; color:var(--text-muted); border:1px dashed var(--border); border-radius:12px;">
                <i class="fa-solid fa-tags" style="font-size:28px; opacity:0.2; margin-bottom:10px; display:block"></i>
                <div style="font-size:13px; font-weight:600">No sub-categories yet</div>
              </div>
            ` : subCategories.map(sub => `
              <div style="padding:14px 16px; background:var(--bg-elevated); border:1px solid var(--border); border-radius:12px; display:flex; justify-content:space-between; align-items:center; transition:box-shadow 0.2s;">
                <span style="font-size:13px; font-weight:600"><i class="fa-solid fa-tag" style="font-size:10px; opacity:0.4; margin-right:6px"></i>${sub.name}</span>
                <div style="display:flex; gap:6px;">
                  <button class="btn-icon edit-sub-btn" data-id="${sub.id}" title="Edit"><i class="fa-solid fa-pen" style="font-size:10px"></i></button>
                  <button class="btn-icon del-sub-btn" data-id="${sub.id}" title="Delete"><i class="fa-solid fa-trash" style="font-size:10px; color:var(--danger)"></i></button>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    </div>

    <style>
      .categories-layout { display: grid; grid-template-columns: 340px 1fr; gap: 20px; align-items: start; }
      @media (max-width: 900px) {
        .categories-layout { grid-template-columns: 1fr; }
      }
      .cat-row:hover { border-color: var(--primary) !important; transform: translateX(3px); }
      .btn-icon { background:none; border:none; padding:5px; cursor:pointer; opacity:0.55; transition:opacity 0.15s; color:inherit; border-radius:6px; }
      .btn-icon:hover { opacity:1; background:var(--bg-main); }
    </style>
  `;

  // --- Listeners ---
  await setupCategoryListeners();
}

async function setupCategoryListeners() {
  // Select category
  document.querySelectorAll('.cat-row').forEach(el => {
    el.addEventListener('click', async () => {
      selectedCategoryId = el.dataset.id;
      await renderCategoriesContent();
    });
  });

  // Add category
  document.getElementById('addCategoryBtn')?.addEventListener('click', () => {
    openModal({
      title: '<i class="fa-solid fa-layer-group mr-8"></i> New Category',
      body: `
        <div class="form-group">
          <label class="form-label required">Category Name</label>
          <div class="search-input-wrap">
            <i class="fa-solid fa-folder-tree"></i>
            <input class="form-input" id="newCatNameInput" placeholder="e.g. Food, Beverages, Services" autofocus style="padding-left:36px" />
          </div>
          <p class="form-help-text mt-8">Categories help you organize products in the POS screen.</p>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" id="confirmNewCat" style="min-width: 120px">
          <i class="fa-solid fa-plus mr-4"></i> Create Category
        </button>
      `
    });
    setTimeout(() => {
      const input = document.getElementById('newCatNameInput');
      if (input) input.focus();
      const btn = document.getElementById('confirmNewCat');
      if (btn) btn.onclick = async () => {
        const name = input?.value.trim();
        if (!name) return showToast('Please enter a name', 'error');
        await saveCategory({ name });
        closeModal();
        showToast(`Category "${name}" created`, 'success');
        await renderCategoriesContent();
      };
    }, 50);
  });

  // Edit category
  document.querySelectorAll('.edit-cat-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const allCats = await getCategories();
      const cat = allCats.find(c => c.id === btn.dataset.id);
      if (!cat) return;
      openModal({
        title: '<i class="fa-solid fa-pen-to-square mr-8"></i> Edit Category',
        body: `
          <div class="form-group">
            <label class="form-label required">Category Name</label>
            <div class="search-input-wrap">
              <i class="fa-solid fa-folder-open"></i>
              <input class="form-input" id="editCatNameInput" value="${cat.name}" style="padding-left:36px" />
            </div>
          </div>
        `,
        footer: `
          <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" id="confirmEditCat" style="min-width: 120px">
            <i class="fa-solid fa-save mr-4"></i> Save Changes
          </button>
        `
      });
      setTimeout(() => {
        const input = document.getElementById('editCatNameInput');
        if (input) input.focus();
        const saveBtn = document.getElementById('confirmEditCat');
        if (saveBtn) saveBtn.onclick = async () => {
          const name = input?.value.trim();
          if (!name) return;
          await saveCategory({ ...cat, name });
          closeModal();
          showToast('Category updated', 'success');
          await renderCategoriesContent();
        };
      }, 50);
    });
  });

  // Delete category
  document.querySelectorAll('.del-cat-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const confirmed = await showConfirm({
        title: 'Delete Category',
        message: 'This will also delete all sub-categories within this group. Continue?',
        okText: 'Delete', okClass: 'btn-danger'
      });
      if (confirmed) {
        await deleteCategory(btn.dataset.id);
        if (selectedCategoryId === btn.dataset.id) selectedCategoryId = null;
        showToast('Category deleted', 'info');
        await renderCategoriesContent();
      }
    });
  });

  // Add sub-category
  document.getElementById('addSubCatBtn')?.addEventListener('click', () => {
    openModal({
      title: '<i class="fa-solid fa-tag mr-8"></i> New Sub-category',
      body: `
        <div class="form-group">
          <label class="form-label required">Sub-category Name</label>
          <div class="search-input-wrap">
            <i class="fa-solid fa-tags"></i>
            <input class="form-input" id="newSubNameInput" placeholder="e.g. Pizza, Haircut, Cakes" autofocus style="padding-left:36px" />
          </div>
          <p class="form-help-text mt-8">Stored within <b>${selectedCat?.name || 'this category'}</b>.</p>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" id="confirmNewSub" style="min-width: 120px">
          <i class="fa-solid fa-plus mr-4"></i> Create Sub-category
        </button>
      `
    });
    setTimeout(() => {
      const input = document.getElementById('newSubNameInput');
      if (input) input.focus();
      const btn = document.getElementById('confirmNewSub');
      if (btn) btn.onclick = async () => {
        const name = input?.value.trim();
        if (!name) return showToast('Please enter a name', 'error');
        await saveSubCategory({ name, categoryId: selectedCategoryId });
        closeModal();
        showToast(`Sub-category "${name}" created`, 'success');
        await renderCategoriesContent();
      };
    }, 50);
  });

  // Edit sub-category
  document.querySelectorAll('.edit-sub-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const allSubs = await getSubCategories();
      const sub = allSubs.find(s => s.id === btn.dataset.id);
      if (!sub) return;
      openModal({
        title: '<i class="fa-solid fa-pen-to-square mr-8"></i> Edit Sub-category',
        body: `
          <div class="form-group">
            <label class="form-label required">Sub-category Name</label>
            <div class="search-input-wrap">
              <i class="fa-solid fa-tag"></i>
              <input class="form-input" id="editSubNameInput" value="${sub.name}" style="padding-left:36px" />
            </div>
          </div>
        `,
        footer: `
          <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" id="confirmEditSub" style="min-width: 120px">
            <i class="fa-solid fa-save mr-4"></i> Save Changes
          </button>
        `
      });
      setTimeout(() => {
        const input = document.getElementById('editSubNameInput');
        if (input) input.focus();
        const saveBtn = document.getElementById('confirmEditSub');
        if (saveBtn) saveBtn.onclick = async () => {
          const name = input?.value.trim();
          if (!name) return;
          await saveSubCategory({ ...sub, name });
          closeModal();
          showToast('Sub-category updated', 'success');
          await renderCategoriesContent();
        };
      }, 50);
    });
  });

  // Delete sub-category
  document.querySelectorAll('.del-sub-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const confirmed = await showConfirm({
        title: 'Delete Sub-category',
        message: 'Remove this sub-category?',
        okText: 'Delete', okClass: 'btn-danger'
      });
      if (confirmed) {
        await deleteSubCategory(btn.dataset.id);
        showToast('Sub-category deleted', 'info');
        await renderCategoriesContent();
      }
    });
  });
}
