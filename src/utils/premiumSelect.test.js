import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initPremiumSelects, renderPremiumSelectOptions, observeDomForSelects } from './premiumSelect';

describe('premiumSelect utility', () => {
  beforeEach(() => {
    // Setup a basic DOM structure with a native select
    document.body.innerHTML = `
      <div id="filterCard" class="card">
        <select class="form-select" id="testSelect">
          <option value="1">Option 1</option>
          <option value="2" selected>Option 2</option>
          <option value="3" data-icon="fa-solid fa-star">Option 3</option>
          <optgroup label="Group 1">
            <option value="4">Option 4</option>
          </optgroup>
        </select>
      </div>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('should initialize premium select and hide native select', () => {
    initPremiumSelects();
    
    const nativeSelect = document.getElementById('testSelect');
    expect(nativeSelect.style.display).toBe('none');
    expect(nativeSelect.classList.contains('premium-initialized')).toBe(true);

    const wrapper = document.querySelector('.premium-select-wrapper');
    expect(wrapper).toBeTruthy();
    
    const trigger = wrapper.querySelector('.premium-select-trigger span');
    expect(trigger.innerHTML).toContain('Option 2'); // Should pick selected option
  });

  it('should render options correctly including optgroups', () => {
    initPremiumSelects();
    
    const options = document.querySelectorAll('.premium-select-option');
    expect(options.length).toBe(4);
    
    const optgroup = document.querySelector('.premium-select-optgroup-label');
    expect(optgroup).toBeTruthy();
    expect(optgroup.textContent).toBe('Group 1');
  });

  it('should toggle dropdown on trigger click', () => {
    initPremiumSelects();
    
    const trigger = document.querySelector('.premium-select-trigger');
    const dropdown = document.querySelector('.premium-select-dropdown');
    
    expect(dropdown.classList.contains('show')).toBe(false);
    
    trigger.click();
    expect(dropdown.classList.contains('show')).toBe(true);
    
    // Clicking outside should close it
    document.body.click();
    expect(dropdown.classList.contains('show')).toBe(false);
  });

  it('should select an option when clicked', () => {
    initPremiumSelects();
    
    const nativeSelect = document.getElementById('testSelect');
    const trigger = document.querySelector('.premium-select-trigger');
    trigger.click(); // Open dropdown
    
    const option1 = Array.from(document.querySelectorAll('.premium-select-option')).find(o => o.textContent.includes('Option 1'));
    
    // Mock the change event listener
    const changeMock = vi.fn();
    nativeSelect.addEventListener('change', changeMock);
    
    option1.click();
    
    expect(nativeSelect.value).toBe('1');
    expect(changeMock).toHaveBeenCalled();
    
    const triggerSpan = document.querySelector('.premium-select-trigger span');
    expect(triggerSpan.innerHTML).toContain('Option 1');
    
    const dropdown = document.querySelector('.premium-select-dropdown');
    expect(dropdown.classList.contains('show')).toBe(false);
  });
});
