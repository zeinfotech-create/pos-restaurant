// ============================================================
// Toast.js — Notification toasts
// ============================================================

export function showToast(message, type = 'info', duration = 7000) {

    const icons = { success: 'fa-check-circle', error: 'fa-circle-xmark', info: 'fa-circle-info', warning: 'fa-triangle-exclamation' };
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    toast.innerHTML = `
        <i class="fa-solid ${icons[type] || icons.info}"></i>
        <span class="toast-message">${message}</span>
        <button class="toast-close-btn" aria-label="Close notification">
            <i class="fa-solid fa-xmark"></i>
        </button>
    `;

    container.appendChild(toast);

    let isRemoving = false;
    let timer;
    let remaining = duration;
    let startTime;

    const removeToast = () => {
        if (isRemoving) return;
        isRemoving = true;

        toast.style.animation = 'toastOut 0.3s ease forwards';

        const onEnd = () => {
            toast.removeEventListener('animationend', onEnd);
            toast.remove();
        };
        toast.addEventListener('animationend', onEnd);
        setTimeout(() => { if (toast.parentElement) toast.remove(); }, 400);
    };

    const startTimer = () => {
        startTime = Date.now();
        timer = setTimeout(removeToast, remaining);
    };

    const pauseTimer = () => {
        clearTimeout(timer);
        remaining -= Date.now() - startTime;
    };

    // Auto close logic
    startTimer();

    // Pause on hover
    toast.addEventListener('mouseenter', pauseTimer);
    toast.addEventListener('mouseleave', () => {
        if (remaining > 0) startTimer();
    });

    // Manual close
    const closeBtn = toast.querySelector('.toast-close-btn');
    if (closeBtn) {
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            clearTimeout(timer);
            removeToast();
        };
    }
}
