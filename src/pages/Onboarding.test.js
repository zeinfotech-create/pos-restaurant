import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../components/Toast.js', () => ({ showToast: vi.fn() }));

const completeInstallation = vi.fn().mockResolvedValue({
  user: { id: 'u1' },
  register: { id: 'r1' },
});
const importIndustryProducts = vi.fn().mockResolvedValue();

vi.mock('../db.js', () => ({
  completeInstallation: (...args) => completeInstallation(...args),
  importIndustryProducts: (...args) => importIndustryProducts(...args),
}));

function fillStep1AndAdvance(container) {
  document.getElementById('oBusinessName').value = 'Test Store';
  container.querySelector('#nextStepBtn').click();
}

describe('Onboarding — Load Sample Data toggle', () => {
  let container;

  beforeEach(async () => {
    completeInstallation.mockClear();
    importIndustryProducts.mockClear();
    global.fetch = vi.fn().mockRejectedValue(new Error('no hub in test'));
    document.body.innerHTML = '<div id="container"></div>';
    container = document.getElementById('container');
    // formData/currentStep are module-level singletons in Onboarding.js — reset
    // the module between tests so one test's onboarding run can't leave
    // isInstalling=true (or a flipped toggle) polluting the next test.
    vi.resetModules();
  });

  it('does NOT import sample products when the toggle is unchecked before finishing', async () => {
    const { renderOnboarding } = await import('./Onboarding.js');
    renderOnboarding(container);
    fillStep1AndAdvance(container);

    const toggle = container.querySelector('#loadDataToggle');
    expect(toggle.classList.contains('active')).toBe(true); // defaults to checked

    toggle.click(); // uncheck it
    expect(toggle.classList.contains('active')).toBe(false);

    document.getElementById('oAdminPhone').value = '9876543210';
    document.getElementById('oAdminPassword').value = '1234';
    container.querySelector('#nextStepBtn').click();

    await new Promise(resolve => setTimeout(resolve, 1700));

    expect(completeInstallation).toHaveBeenCalledTimes(1);
    expect(importIndustryProducts).not.toHaveBeenCalled();
  });

  it('DOES import sample products when the toggle is left checked', async () => {
    const { renderOnboarding } = await import('./Onboarding.js');
    renderOnboarding(container);
    fillStep1AndAdvance(container);

    document.getElementById('oAdminPhone').value = '9876543211';
    document.getElementById('oAdminPassword').value = '1234';
    container.querySelector('#nextStepBtn').click();

    await new Promise(resolve => setTimeout(resolve, 1700));

    expect(completeInstallation).toHaveBeenCalledTimes(1);
    expect(importIndustryProducts).toHaveBeenCalledTimes(1);
  });
});
