import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showToast } from './Toast';

describe('Toast component', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="toast-container"></div>
    `;
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('should display a toast message', () => {
    showToast('Hello World', 'success');
    
    const container = document.getElementById('toast-container');
    const toast = container.querySelector('.toast');
    
    expect(toast).toBeTruthy();
    expect(toast.classList.contains('success')).toBe(true);
    expect(toast.innerHTML).toContain('Hello World');
  });

  it('should auto close the toast after duration', () => {
    showToast('Auto close', 'info', 1000);
    
    const container = document.getElementById('toast-container');
    expect(container.querySelectorAll('.toast').length).toBe(1);
    
    // Fast forward past duration
    vi.advanceTimersByTime(1100);
    
    // Fast forward past animation
    vi.advanceTimersByTime(500);
    
    expect(container.querySelectorAll('.toast').length).toBe(0);
  });

  it('should close manually when close button is clicked', () => {
    showToast('Manual close', 'error');
    
    const container = document.getElementById('toast-container');
    const closeBtn = container.querySelector('.toast-close-btn');
    
    closeBtn.click();
    
    // Fast forward past animation
    vi.advanceTimersByTime(500);
    
    expect(container.querySelectorAll('.toast').length).toBe(0);
  });
});
