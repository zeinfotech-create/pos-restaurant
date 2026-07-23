import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDefaultRange } from './dateRangeHelper.js';

describe('dateRangeHelper', () => {
  beforeEach(() => {
    // Mock system time to a fixed date to ensure reliable tests
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2023, 10, 15)); // Nov 15, 2023
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getDefaultRange', () => {
    it('should return a range from the first of the month to the current date', () => {
      const range = getDefaultRange();
      
      expect(range).toEqual({
        start: '2023-11-01',
        end: '2023-11-15'
      });
    });
    
    it('should format single-digit months and days with leading zeros', () => {
      vi.setSystemTime(new Date(2024, 2, 5)); // March 5, 2024
      const range = getDefaultRange();
      
      expect(range).toEqual({
        start: '2024-03-01',
        end: '2024-03-05'
      });
    });
  });
});
