import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openModal, closeModal, showConfirm, showAlert } from './Modal';

describe('Modal component', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="pos-modal-overlay" class="hidden"></div>
      <div id="bottom-nav"></div>
      <div id="mobileCheckoutFab"></div>
    `;
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('should open a basic modal', () => {
    openModal({ title: 'Test Modal', body: '<p>Content</p>' });
    
    const overlay = document.getElementById('pos-modal-overlay');
    expect(overlay.classList.contains('hidden')).toBe(false);
    expect(overlay.innerHTML).toContain('Test Modal');
    expect(overlay.innerHTML).toContain('Content');
    
    // Simulate animation frame
    vi.advanceTimersByTime(20);
    expect(overlay.classList.contains('active')).toBe(true);
    
    // Check chrome hiding
    expect(document.getElementById('bottom-nav').classList.contains('modal-open-hide')).toBe(true);
  });

  it('should close a modal', () => {
    openModal({ title: 'Test Modal', body: '<p>Content</p>' });
    
    closeModal();
    
    const overlay = document.getElementById('pos-modal-overlay');
    expect(overlay.classList.contains('closing')).toBe(true);
    expect(overlay.classList.contains('active')).toBe(false);
    
    // Fast forward animation
    vi.advanceTimersByTime(350);
    
    expect(overlay.classList.contains('hidden')).toBe(true);
    expect(overlay.innerHTML).toBe('');
  });

  it('should resolve confirm modal with true on ok', async () => {
    const confirmPromise = showConfirm({ message: 'Are you sure?' });
    
    // Advance timers so modal renders
    vi.advanceTimersByTime(20);
    
    const okBtn = document.getElementById('confirmOkBtn');
    expect(okBtn).toBeTruthy();
    okBtn.click();
    
    const result = await confirmPromise;
    expect(result).toBe(true);
  });

  it('should resolve alert modal', async () => {
    const alertPromise = showAlert({ message: 'Warning!' });
    
    vi.advanceTimersByTime(20);
    
    const okBtn = document.getElementById('alertOkBtn');
    expect(okBtn).toBeTruthy();
    okBtn.click();
    
    await alertPromise; // Should resolve
  });
});
