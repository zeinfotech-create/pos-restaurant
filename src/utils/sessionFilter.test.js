import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isSessionFiltered, getSessionStart, applySessionFilter } from './sessionFilter.js';

// Mock dependencies
vi.mock('../store.js', () => ({
  store: {
    user: null
  }
}));

vi.mock('../db.js', () => ({
  getSession: vi.fn()
}));

import { store } from '../store.js';
import { getSession } from '../db.js';

describe('sessionFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.user = null;
  });

  describe('isSessionFiltered', () => {
    it('should return false if there is no user', () => {
      expect(isSessionFiltered()).toBe(false);
    });

    it('should return false for Admin role', () => {
      store.user = { role: 'Admin' };
      expect(isSessionFiltered()).toBe(false);
    });

    it('should return false for Owner role', () => {
      store.user = { role: 'Owner' };
      expect(isSessionFiltered()).toBe(false);
    });

    it('should return false for staff if sessionFilterEnabled is false', () => {
      store.user = { role: 'Staff', sessionFilterEnabled: false };
      expect(isSessionFiltered()).toBe(false);
    });

    it('should return true for staff if sessionFilterEnabled is true', () => {
      store.user = { role: 'Staff', sessionFilterEnabled: true };
      expect(isSessionFiltered()).toBe(true);
    });
  });

  describe('getSessionStart', () => {
    it('should return null if user is not session filtered', async () => {
      store.user = { role: 'Admin' };
      const start = await getSessionStart();
      expect(start).toBeNull();
    });

    it('should return loginAt string if user is filtered', async () => {
      store.user = { role: 'Staff', sessionFilterEnabled: true };
      const loginTime = '2024-01-01T12:00:00.000Z';
      getSession.mockResolvedValue({ loginAt: loginTime });
      
      const start = await getSessionStart();
      expect(start).toBe(loginTime);
    });

    it('should return null if getSession returns null', async () => {
      store.user = { role: 'Staff', sessionFilterEnabled: true };
      getSession.mockResolvedValue(null);
      
      const start = await getSessionStart();
      expect(start).toBeNull();
    });
  });

  describe('applySessionFilter', () => {
    const records = [
      { id: 1, date: '2024-01-01T10:00:00.000Z' },
      { id: 2, date: '2024-01-01T13:00:00.000Z' },
      { id: 3, date: '2024-01-01T15:00:00.000Z' }
    ];

    it('should return all records if no filter is applied (admin)', async () => {
      store.user = { role: 'Admin' };
      
      const result = await applySessionFilter(records);
      expect(result).toHaveLength(3);
    });

    it('should filter records strictly created at or after login time', async () => {
      store.user = { role: 'Staff', sessionFilterEnabled: true };
      getSession.mockResolvedValue({ loginAt: '2024-01-01T12:00:00.000Z' });
      
      const result = await applySessionFilter(records);
      expect(result).toHaveLength(2); // IDs 2 and 3
      expect(result.map(r => r.id)).toEqual([2, 3]);
    });

    it('should filter records missing the target date field', async () => {
      store.user = { role: 'Staff', sessionFilterEnabled: true };
      getSession.mockResolvedValue({ loginAt: '2024-01-01T12:00:00.000Z' });
      
      const mixedRecords = [
        { id: 1 }, // Missing 'date' field entirely
        { id: 2, date: '2024-01-01T13:00:00.000Z' }
      ];
      
      const result = await applySessionFilter(mixedRecords);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(2);
    });
  });
});
