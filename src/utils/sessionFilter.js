/**
 * sessionFilter.js
 * Utility to apply user-session-scoped data filtering.
 *
 * Non-admin users should only see records created DURING their active login session.
 * Admin / Owner roles bypass filtering and see all records.
 */

import { getSession } from '../db.js';
import { store } from '../store.js';

// Roles that bypass session filtering (see all data)
const ADMIN_ROLES = ['Admin', 'Owner', 'admin', 'owner'];

/**
 * Returns true if the current user is subject to session-based filtering.
 */
export function isSessionFiltered() {
  const user = store.user;
  if (!user) return false;
  if (ADMIN_ROLES.includes(user.role)) return false;
  return !!user.sessionFilterEnabled;
}

/**
 * Returns the session start ISO string for the current login session.
 * Returns null if admin or no session.
 */
export async function getSessionStart() {
  if (!isSessionFiltered()) return null;
  const session = await getSession();
  return session?.loginAt || null;
}

/**
 * Filter an array of records by the current user's session start time.
 * @param {Array} records - Array of records to filter
 * @param {string} dateField - The field name to use for date comparison (e.g. 'date', 'createdAt', 'updatedAt')
 * @returns {Array} - Filtered records (or all records if admin/no filter)
 */
export async function applySessionFilter(records, dateField = 'date') {
  const start = await getSessionStart();
  if (!start) return records; // Admin or no loginAt — return all
  return records.filter(r => {
    const val = r[dateField];
    if (!val) return false;
    return val >= start;
  });
}
