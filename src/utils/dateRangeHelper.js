/**
 * Reusable Date Range Picker Utility using Litepicker
 */

export function initDateRangePicker(elementId, startDate, endDate, onSelected) {
  const el = document.getElementById(elementId);
  if (!el) return null;

  const startVal = startDate ? new Date(startDate) : new Date();
  startVal.setHours(0,0,0,0);
  const endVal = endDate ? new Date(endDate) : new Date();
  endVal.setHours(0,0,0,0);

  // Use the global Litepicker from index.html
  const picker = new Litepicker({
    element: el,
    singleMode: false,
    numberOfMonths: 2,
    numberOfColumns: 2,
    format: 'DD/MM/YYYY',
    startDate: startVal,
    endDate: endVal,
    plugins: ['ranges'],
    ranges: {
      custom: 'Custom Range',
      ranges: {
        'Today': [new Date(new Date().setHours(0,0,0,0)), new Date(new Date().setHours(0,0,0,0))],
        'Yesterday': [new Date(new Date(new Date().setDate(new Date().getDate()-1)).setHours(0,0,0,0)), new Date(new Date(new Date().setDate(new Date().getDate()-1)).setHours(0,0,0,0))],
        'Last 7 Days': [new Date(new Date(new Date().setDate(new Date().getDate()-6)).setHours(0,0,0,0)), new Date(new Date().setHours(0,0,0,0))],
        'Last 30 Days': [new Date(new Date(new Date().setDate(new Date().getDate()-29)).setHours(0,0,0,0)), new Date(new Date().setHours(0,0,0,0))],
        'This Month': [new Date(new Date(new Date().getFullYear(), new Date().getMonth(), 1).setHours(0,0,0,0)), new Date(new Date().setHours(0,0,0,0))],
        'Last Month': [new Date(new Date(new Date().getFullYear(), new Date().getMonth()-1, 1).setHours(0,0,0,0)), new Date(new Date(new Date().getFullYear(), new Date().getMonth(), 0).setHours(0,0,0,0))],
        ['This Year (' + new Date().getFullYear() + ')']: [new Date(new Date(new Date().getFullYear(), 0, 1).setHours(0,0,0,0)), new Date(new Date().setHours(0,0,0,0))],
        ['Last Year (' + (new Date().getFullYear() - 1) + ')']: [new Date(new Date(new Date().getFullYear() - 1, 0, 1).setHours(0,0,0,0)), new Date(new Date(new Date().getFullYear() - 1, 11, 31).setHours(23,59,59,999))],
        'Last 365 Days': [new Date(new Date(new Date().setDate(new Date().getDate()-364)).setHours(0,0,0,0)), new Date(new Date().setHours(0,0,0,0))],
      }
    },
    setup: (pickerInstance) => {
      const localDate = (d) => {
        const dt = new Date(d);
        dt.setHours(0,0,0,0);
        return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
      };

      const buildRanges = () => {
        const now = new Date();
        const t = localDate(now);
        const yest = localDate(new Date(Date.now() - 86400000));
        const l7 = localDate(new Date(Date.now() - 6 * 86400000));
        const l30 = localDate(new Date(Date.now() - 29 * 86400000));
        const fm = localDate(new Date(now.getFullYear(), now.getMonth(), 1));
        const flm = localDate(new Date(now.getFullYear(), now.getMonth()-1, 1));
        const llm = localDate(new Date(now.getFullYear(), now.getMonth(), 0));
        const fy = localDate(new Date(now.getFullYear(), 0, 1));
        return [
          { name: 'Today', start: t, end: t },
          { name: 'Yesterday', start: yest, end: yest },
          { name: 'Last 7 Days', start: l7, end: t },
          { name: 'Last 30 Days', start: l30, end: t },
          { name: 'This Month', start: fm, end: t },
          { name: 'Last Month', start: flm, end: llm },
          { name: 'This Year (' + now.getFullYear() + ')', start: fy, end: t },
          { name: 'Last Year (' + (now.getFullYear() - 1) + ')', start: localDate(new Date(now.getFullYear() - 1, 0, 1)), end: localDate(new Date(now.getFullYear() - 1, 11, 31)) },
          { name: 'Last 365 Days', start: localDate(new Date(Date.now() - 364 * 86400000)), end: t },
        ];
      };

      const updateActiveRangeUI = () => {
        const startDate = pickerInstance.getStartDate()?.format('YYYY-MM-DD');
        const endDate = pickerInstance.getEndDate()?.format('YYYY-MM-DD');
        const activeRange = buildRanges().find(r => r.start === startDate && r.end === endDate);
        pickerInstance.ui.querySelectorAll('.container__predefined-ranges button').forEach(btn => {
          btn.classList.remove('is-active-preset');
          if (activeRange && btn.innerText.trim() === activeRange.name) {
            btn.classList.add('is-active-preset');
          }
        });
      };

      pickerInstance.on('selected', (date1, date2) => {
        const start = date1.format('YYYY-MM-DD');
        const end = date2.format('YYYY-MM-DD');
        el.value = `${date1.format('DD/MM/YYYY')} - ${date2.format('DD/MM/YYYY')}`;
        if (onSelected) onSelected(start, end);
      });

      pickerInstance.on('show', () => {
        updateActiveRangeUI();
        if (window.innerWidth <= 768) {
          let backdrop = document.getElementById('litepickerMobileBackdrop');
          if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.id = 'litepickerMobileBackdrop';
            backdrop.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.5);backdrop-filter:blur(4px);z-index:99998;transition:opacity 0.2s ease;';
            document.body.appendChild(backdrop);
          }
          backdrop.style.display = 'block';
          // Ensure it's rendered before animating opacity if we wanted to
        }
      });
      
      pickerInstance.on('hide', () => {
        const backdrop = document.getElementById('litepickerMobileBackdrop');
        if (backdrop) backdrop.style.display = 'none';
      });

      // Set initial display value
      if (startDate && endDate) {
        const d1 = new Date(startDate);
        const d2 = new Date(endDate);
        el.value = `${d1.toLocaleDateString('en-GB')} - ${d2.toLocaleDateString('en-GB')}`;
      }
    }
  });

  return picker;
}

export function getDefaultRange() {
  const now = new Date();
  const format = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  return { 
    start: format(firstOfMonth), 
    end: format(now) 
  };
}
