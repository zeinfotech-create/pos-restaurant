// Shared client-side pagination helper — extracted so new tables don't have to
// hand-roll the currentPage/itemsPerPage/pagination-bar pattern that used to be
// copy-pasted per page (Purchases.js, Suppliers.js, Products.js, etc.).

export function paginate(items, page, pageSize) {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const start = (clampedPage - 1) * pageSize;
  return {
    pageItems: items.slice(start, start + pageSize),
    page: clampedPage,
    totalPages,
    totalItems
  };
}

// Renders a `.pagination-bar` into `container` and wires up prev/next/page-number
// clicks to `onChange(newPage)`. Safe to call with totalPages <= 1 (renders nothing).
export function renderPaginationBar(container, { page, totalPages, onChange }) {
  if (!container) return;
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }
  let html = `<div class="pagination-bar"><span>Showing page <b>${page}</b> of <b>${totalPages}</b></span><div class="pagination-controls">
    <button class="pagination-btn pg-prev" ${page === 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button>`;
  for (let i = 1; i <= totalPages; i++) {
    if (totalPages > 5 && Math.abs(i - page) > 2 && i !== 1 && i !== totalPages) {
      if (i === 2 || i === totalPages - 1) html += `<span style="padding:0 4px">...</span>`;
      continue;
    }
    html += `<button class="pagination-btn ${i === page ? 'active' : ''} pg-page" data-page="${i}">${i}</button>`;
  }
  html += `<button class="pagination-btn pg-next" ${page === totalPages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button></div></div>`;
  container.innerHTML = html;

  const prevBtn = container.querySelector('.pg-prev');
  const nextBtn = container.querySelector('.pg-next');
  if (prevBtn) prevBtn.onclick = () => { if (page > 1) onChange(page - 1); };
  if (nextBtn) nextBtn.onclick = () => { if (page < totalPages) onChange(page + 1); };
  container.querySelectorAll('.pg-page').forEach(btn => {
    btn.onclick = () => onChange(parseInt(btn.dataset.page));
  });
}
