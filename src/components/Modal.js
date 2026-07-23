// ============================================================
// Modal.js — Reusable modal helper
// ============================================================

let currentEscapeHandler = null;

function hideBodyChrome() {
  // Hide FAB and bottom nav when modal opens on mobile
  document.getElementById('mobileCheckoutFab')?.classList.add('hidden');
  document.getElementById('bottom-nav')?.classList.add('modal-open-hide');
}

function showBodyChrome() {
  // Restore bottom nav
  document.getElementById('bottom-nav')?.classList.remove('modal-open-hide');

  // Dispatch a custom event so main.js can re-evaluate FAB visibility
  window.dispatchEvent(new CustomEvent('modalClosed'));
}

export function openModal({ title, body, footer, onClose, hideClose = false, disableBackdropDismiss = false, fullScreen = false, hideHeader = false, sidePanel = true }) {
  console.log('Modal.js: openModal called', title);
  const overlay = document.getElementById('pos-modal-overlay');
  if (!overlay) {
    console.error('Modal.js: pos-modal-overlay element not found in DOM!');
    return;
  }

  // Set side panel or full screen classes
  overlay.className = 'pos-modal-overlay';
  if (sidePanel) overlay.classList.add('side-panel');
  if (fullScreen) overlay.classList.add('full-screen'); // for future or existing use

  // Set content first
  overlay.innerHTML = `
    <div class="modal ${fullScreen ? 'modal-full' : ''}">
      ${hideHeader ? '' : `
      <div class="modal-header">
        <div class="modal-title">${title || ''}</div>
        ${hideClose ? '' : `<button class="modal-close" id="modalClose" aria-label="Close modal"><i class="fa-solid fa-xmark"></i></button>`}
      </div>
      `}
      <div class="modal-body" style="${fullScreen ? 'padding: 0; overflow: hidden; height: 100%; display: flex; flex-direction: column;' : ''}">${body}</div>
      <div class="modal-footer" id="modalFooter">${footer || ''}</div>
    </div>
  `;

  // Show overlay (remove hidden)
  overlay.classList.remove('hidden');
  
  // Force reflow and add active class to trigger smooth opening animation
  void overlay.offsetWidth; 
  setTimeout(() => overlay.classList.add('active'), 10);

  // Setup basic close mechanics
  if (!hideClose) {
    const closeBtn = document.getElementById('modalClose');
    if (closeBtn) closeBtn.onclick = () => {
      if (onClose) onClose();
      closeModal();
    };
  }

  overlay.onclick = (e) => {
    if (!disableBackdropDismiss && e.target === overlay) {
      if (onClose) onClose();
      closeModal();
    }
  };

  // Bind Escape key dismiss listener
  if (currentEscapeHandler) {
    document.removeEventListener('keydown', currentEscapeHandler);
  }
  currentEscapeHandler = (e) => {
    if (e.key === 'Escape' && !disableBackdropDismiss) {
      if (onClose) onClose();
      closeModal();
    }
  };
  document.addEventListener('keydown', currentEscapeHandler);

  hideBodyChrome();
}

export function closeModal() {
  console.log('Modal.js: closeModal called');
  const overlay = document.getElementById('pos-modal-overlay');
  
  // Remove Escape key dismiss listener
  if (currentEscapeHandler) {
    document.removeEventListener('keydown', currentEscapeHandler);
    currentEscapeHandler = null;
  }

  if (overlay) {
    // Remove active class to start closing animation
    overlay.classList.remove('active');
    overlay.classList.add('closing');

    // Wait for the animation to finish (matching the 0.3s transition in CSS)
    setTimeout(() => {
      overlay.classList.add('hidden');
      overlay.classList.remove('closing');
      overlay.innerHTML = '';
      showBodyChrome();
    }, 300);
  }
}

/**
 * Promisified confirmation modal
 */
export function showConfirm({ title = 'Confirm Action', message = 'Are you sure?', okText = 'OK', cancelText = 'Cancel' }) {
  return new Promise((resolve) => {
    openModal({
      title: `<i class="fa-solid fa-circle-question mr-8" style="color:var(--primary)"></i> ${title}`,
      body: `<div style="padding: 8px 0; font-size: 15px; color: var(--text-main); line-height: 1.5;">${message}</div>`,
      footer: `
                <button class="btn btn-ghost" id="confirmCancelBtn">${cancelText}</button>
                <button class="btn btn-primary" id="confirmOkBtn" style="min-width: 80px">${okText}</button>
            `,
      disableBackdropDismiss: true,
      hideClose: true,
      sidePanel: false
    });

    const okBtn = document.getElementById('confirmOkBtn');
    const cancelBtn = document.getElementById('confirmCancelBtn');

    if (okBtn) okBtn.onclick = () => {
      closeModal();
      resolve(true);
    };
    if (cancelBtn) cancelBtn.onclick = () => {
      closeModal();
      resolve(false);
    };
  });
}

/**
 * Promisified alert modal
 */
export function showAlert({ title = 'Notice', message = '', btnText = 'OK', type = 'info' }) {
  const icon = type === 'error' ? 'fa-circle-xmark' : (type === 'warning' ? 'fa-triangle-exclamation' : 'fa-circle-info');
  const color = type === 'error' ? 'var(--danger)' : (type === 'warning' ? 'var(--warning)' : 'var(--primary)');

  return new Promise((resolve) => {
    openModal({
      title: `<i class="fa-solid ${icon} mr-8" style="color:${color}"></i> ${title}`,
      body: `<div style="padding: 8px 0; font-size: 15px; color: var(--text-main); line-height: 1.5;">${message}</div>`,
      footer: `<button class="btn btn-primary" id="alertOkBtn" style="width:100%">${btnText}</button>`,
      disableBackdropDismiss: false,
      onClose: () => resolve(),
      sidePanel: false
    });

    const okBtn = document.getElementById('alertOkBtn');
    if (okBtn) okBtn.onclick = () => {
      closeModal();
      resolve();
    };
  });
}
