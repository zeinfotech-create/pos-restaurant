// ============================================================
// premiumSelect.js - Global Custom Dropdown Upgrader
// ============================================================

export function renderPremiumSelectOptions(select, optionsContainer, labelSpan, dropdown) {
  optionsContainer.innerHTML = '';
  
  Array.from(select.options).forEach(opt => {
    // Check if it belongs to an optgroup
    if(opt.parentNode.tagName === 'OPTGROUP' && !opt.previousElementSibling) {
       const groupLabel = document.createElement('div');
       groupLabel.className = 'premium-select-optgroup-label';
       groupLabel.textContent = opt.parentNode.label;
       optionsContainer.appendChild(groupLabel);
    }
    
    const optDiv = document.createElement('div');
    optDiv.className = `premium-select-option ${opt.selected ? 'selected' : ''}`;
    
    // If currency or specific icons are passed via data attributes, we could use them
    let iconHtml = '';
    if (opt.dataset.icon) {
       iconHtml = `<i class="${opt.dataset.icon} mr-8 text-muted"></i>`;
    }
    
    optDiv.innerHTML = `${iconHtml}<span>${opt.innerHTML}</span>${opt.selected ? '<i class="fa-solid fa-check ms-auto" style="color:var(--primary); margin-left:auto;"></i>' : ''}`;
    
    optDiv.addEventListener('click', (e) => {
      e.stopPropagation();
      select.value = opt.value;
      
      // Update the trigger label
      labelSpan.innerHTML = opt.innerHTML;
      
      // Fire the native change event so exactly existing logic triggers
      const event = new Event('change', { bubbles: true });
      select.dispatchEvent(event);
      
      dropdown.classList.remove('show');
      const parentCard = dropdown.closest('.card, #filterCard');
      if (parentCard && parentCard.dataset.originalOverflow !== undefined) {
          parentCard.style.overflow = parentCard.dataset.originalOverflow;
          parentCard.style.zIndex = parentCard.dataset.originalZIndex || '';
      }
      
      // Re-render to show checkmark on the new selection
      renderPremiumSelectOptions(select, optionsContainer, labelSpan, dropdown);
    });
    
    optDiv.dataset.search = opt.textContent.toLowerCase();
    optionsContainer.appendChild(optDiv);
  });
}

export function initPremiumSelects() {
  const nativeSelects = document.querySelectorAll('select.form-select:not(.premium-initialized)');
  
  nativeSelects.forEach(select => {
    // Skip multi-selects for now as they require a different UX
    if(select.hasAttribute('multiple')) return;
    
    // Mark as initialized
    select.classList.add('premium-initialized');
    select.style.display = 'none'; // Hide native select
    
    // Create wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'premium-select-wrapper';
    
    // Create trigger
    const trigger = document.createElement('div');
    trigger.className = 'premium-select-trigger';
    const labelSpan = document.createElement('span');
    
    const selectedOption = select.options[select.selectedIndex];
    labelSpan.innerHTML = selectedOption ? selectedOption.innerHTML : 'Select...';
    
    trigger.appendChild(labelSpan);
    trigger.insertAdjacentHTML('beforeend', '<i class="fa-solid fa-chevron-down"></i>');
    
    // Create dropdown container
    const dropdown = document.createElement('div');
    dropdown.className = 'premium-select-dropdown';
    
    // Create options container
    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'premium-select-options';
    
    // Build search input if more than 5 options
    let searchInput = null;
    if(select.options.length > 5) {
      const searchBox = document.createElement('div');
      searchBox.className = 'premium-select-search';
      searchBox.innerHTML = '<i class="fa-solid fa-search"></i>';
      
      searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.placeholder = 'Search...';
      searchBox.appendChild(searchInput);
      
      dropdown.appendChild(searchBox);
      
      // Implement search filtering
      searchInput.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase();
        Array.from(optionsContainer.querySelectorAll('.premium-select-option')).forEach(optDiv => {
          if(optDiv.dataset.search.includes(val)) {
            optDiv.style.display = 'flex';
          } else {
            optDiv.style.display = 'none';
          }
        });
      });
    }
    
    dropdown.appendChild(optionsContainer);
    wrapper.appendChild(trigger);
    wrapper.appendChild(dropdown);
    
    // Insert wrapper into the DOM
    select.parentNode.insertBefore(wrapper, select.nextSibling);
    
    // Render the options
    renderPremiumSelectOptions(select, optionsContainer, labelSpan, dropdown);
    
    // Trigger Events
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = dropdown.classList.contains('show');
      
      // Close all other dropdowns
      document.querySelectorAll('.premium-select-dropdown.show').forEach(d => {
        d.classList.remove('show');
        const parentCard = d.closest('.card, #filterCard');
        if (parentCard && parentCard.dataset.originalOverflow !== undefined) {
            parentCard.style.overflow = parentCard.dataset.originalOverflow;
            parentCard.style.zIndex = parentCard.dataset.originalZIndex || '';
        }
      });
      
      if(!isOpen) {
        dropdown.classList.add('show');
        const parentCard = dropdown.closest('.card, #filterCard');
        if (parentCard) {
            // Save original values if not already saved (to avoid overwriting with 'visible' when multiple dropdowns open)
            if (parentCard.dataset.originalOverflow === undefined) {
                parentCard.dataset.originalOverflow = parentCard.style.overflow || '';
            }
            if (parentCard.dataset.originalZIndex === undefined) {
                parentCard.dataset.originalZIndex = parentCard.style.zIndex || '';
            }
            
            parentCard.style.overflow = 'visible';
            parentCard.style.zIndex = '9999';
            if (window.getComputedStyle(parentCard).position === 'static') {
                parentCard.style.position = 'relative';
            }
        }
        
        if(searchInput) {
          searchInput.value = ''; // Reset search
          const event = new Event('input');
          searchInput.dispatchEvent(event);
          searchInput.focus();
        }
        
        // Scroll to selected option
        const selectedOptDiv = optionsContainer.querySelector('.premium-select-option.selected');
        if (selectedOptDiv) {
            selectedOptDiv.scrollIntoView({ block: 'nearest' });
        }
      }
    });
    
    // Keep them synced if the `<select>` value changes programmatically
    select.addEventListener('change', () => {
       const selectedOpt = select.options[select.selectedIndex];
       if(selectedOpt) labelSpan.innerHTML = selectedOpt.innerHTML;
       renderPremiumSelectOptions(select, optionsContainer, labelSpan, dropdown);
    });
    
    // Re-render when options are dynamically populated (like tax rates)
    const observer = new MutationObserver(() => {
        const currentSelected = select.options[select.selectedIndex];
        if(currentSelected) labelSpan.innerHTML = currentSelected.innerHTML;
        renderPremiumSelectOptions(select, optionsContainer, labelSpan, dropdown);
    });
    observer.observe(select, { childList: true });
  });
}

// Global click listener to close dropdowns when clicking outside
document.addEventListener('click', (e) => {
  if(!e.target.closest('.premium-select-wrapper')) {
    document.querySelectorAll('.premium-select-dropdown.show').forEach(d => {
      d.classList.remove('show');
      const parentCard = d.closest('.card, #filterCard');
      if (parentCard && parentCard.dataset.originalOverflow !== undefined) {
          parentCard.style.overflow = parentCard.dataset.originalOverflow;
          parentCard.style.zIndex = parentCard.dataset.originalZIndex || '';
      }
    });
  }
});

// Setting up the global DOM watcher to automatically enhance selects rendered dynamically by modals and pages
export function observeDomForSelects() {
    initPremiumSelects(); // Initial run
    
    const bodyObserver = new MutationObserver((mutations) => {
        let shouldInit = false;
        for (let mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                // Quick check if any added node contains a select
                for (let node of Array.from(mutation.addedNodes)) {
                     if (node.nodeType === 1 && (node.tagName === 'SELECT' || node.querySelector('select'))) {
                         shouldInit = true;
                         break;
                     }
                }
            }
            if (shouldInit) break;
        }
        
        if (shouldInit) {
            initPremiumSelects();
        }
    });

    bodyObserver.observe(document.body, { childList: true, subtree: true });
}
