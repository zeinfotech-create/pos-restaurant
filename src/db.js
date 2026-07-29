// db.js — Modern persistence layer (IndexedDB)
// ============================================================

const DB_NAME = 'zepos_db';
// Must always be higher than any version this database has ever been opened
// at on a real device (IndexedDB versions only ever go up, never down —
// opening with a lower version than what's already on disk throws immediately
// and the whole app fails to initialize, before onboarding can even render).
const DB_VERSION = 5;

class DbService {
  constructor() {
    this.db = null;
  }

  async init() {
    if (this.db && !this._closed) return;
    // Multiple callers (initStore(), various ensureOpen() calls, etc.) can
    // all hit init() around app startup before any of them has set this.db
    // yet — without caching the in-flight promise, each one would open its
    // OWN separate indexedDB connection. The orphaned extra connection(s)
    // still get an onversionchange handler closing over `this`, so when
    // something later changes the DB version (e.g. resetDatabase()), that
    // stale handler fires and calls this.db.close() against whatever this.db
    // has since been reassigned to (or null) — crashing with "Cannot read
    // properties of null (reading 'close')". Caching the promise ensures
    // only one real connection is ever opened per DbService instance.
    if (this._initPromise) return this._initPromise;

    this._closed = false;
    this._initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        console.log(`[IndexedDB] Upgrading to version ${DB_VERSION}...`);
        // Create stores for all keys
        Object.values(KEYS).forEach(k => {
          if (!db.objectStoreNames.contains(k)) {
            db.createObjectStore(k, { keyPath: 'id', autoIncrement: true });
          }
        });
        // Special internal stores if needed
        if (!db.objectStoreNames.contains('internal_migration')) {
          db.createObjectStore('internal_migration', { keyPath: 'id' });
        }
      };

      request.onblocked = () => {
        alert('Database upgrade blocked! Please close all other tabs of this app and reload.');
        location.reload();
      };

      request.onsuccess = async (e) => {
        const conn = e.target.result;
        this.db = conn;

        // Handle concurrent version changes (e.g. from other tabs, or our
        // own resetDatabase() deleting this exact database). Captures `conn`
        // directly instead of reading this.db, so it always closes the
        // connection it actually belongs to, even if this.db has since been
        // reassigned or cleared by something else.
        conn.onversionchange = () => {
          if (this.db === conn) this._closed = true;
          conn.close();
          alert('Database updated in another tab. Please reload.');
          location.reload();
        };
        conn.onclose = () => { if (this.db === conn) this._closed = true; };

        await this.performMigration();
        await this.cleanupTypeMismatches();
        resolve();
      };

      request.onerror = (e) => {
        console.error('IndexedDB error:', e.target.error);
        reject(e.target.error);
      };
    }).finally(() => { this._initPromise = null; });

    return this._initPromise;
  }

  async performMigration() {
    const isMigrated = await this.get('internal_migration', 'done');
    if (isMigrated) return;

    console.log('[IndexedDB] Starting migration from localStorage...');
    for (const key of Object.values(KEYS)) {
      const raw = localStorage.getItem(key);
      if (raw) {
        try {
          const data = JSON.parse(raw);
          if (Array.isArray(data)) {
            for (const item of data) {
              await this.put(key, item);
            }
          } else if (data && typeof data === 'object') {
            // If it's a single object (like settings), ensure it has an 'id'
            data.id = data.id || 'current'; 
            await this.put(key, data);
          } else if (data !== null) {
              // Primitive values (like session)
              await this.put(key, { id: 'value', val: data });
          }
          console.log(`[IndexedDB] Migrated ${key}`);
        } catch (e) {
          console.warn(`[IndexedDB] Failed to migrate ${key}:`, e);
        }
      }
    }

    // Also migrate cart from store.js
    const cart = localStorage.getItem('pos_cart');
    if (cart) {
      try {
        await this.put(KEYS.SESSION, { id: 'pos_cart', data: JSON.parse(cart) });
      } catch (e) {
        // Unlike every other key above, this one wasn't guarded — a single
        // corrupted/truncated localStorage value (e.g. an interrupted write)
        // threw here uncaught inside the DB-open request's onsuccess handler,
        // so the surrounding init() Promise never resolved OR rejected and
        // the whole app hung on first launch after upgrading from a
        // pre-IndexedDB build. This only ever runs once (migration is gated
        // by the 'done' flag above), so losing an unrecoverable cart on a
        // corrupted value is an acceptable trade for not bricking the app.
        console.warn('[IndexedDB] Failed to migrate pos_cart:', e);
      }
    }

    await this.put('internal_migration', { id: 'done', timestamp: new Date().toISOString() });
    console.log('[IndexedDB] Migration complete!');
  }

  async get(store, id) {
    await this.ensureOpen();
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(store, 'readonly');
        const request = tx.objectStore(store).get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      } catch (e) {
        if (e.name === 'InvalidStateError') {
          this.db = null;
          return this.get(store, id);
        }
        reject(e);
      }
    });
  }

  async delete(store, id) {
    await this.ensureOpen();
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(store, 'readwrite');
        const request = tx.objectStore(store).delete(id);
        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e.target.error);
      } catch (e) {
        if (e.name === 'InvalidStateError') {
          this.db = null;
          return this.delete(store, id);
        }
        reject(e);
      }
    });
  }

  async cleanupTypeMismatches() {
    console.log('[IndexedDB] Running ID type-mismatch cleanup...');
    const stores = ['products', 'customers', 'suppliers', 'inventory_logs', 'orders', 'returns', 'staff', 'categories', 'sub_categories'];
    
    for (const storeName of stores) {
      const key = KEYS[storeName.toUpperCase()];
      if (!key || !this.db.objectStoreNames.contains(key)) continue;

      const all = await this.getAll(key);
      const stringIds = new Set(all.filter(x => typeof x.id === 'string').map(x => x.id));

      for (const item of all) {
        // If we find a Number ID and we already have a String version, delete the Number one
        if (typeof item.id === 'number' && stringIds.has(String(item.id))) {
          console.log(`[IndexedDB] Cleanup: Removing duplicate Number ID ${item.id} from ${storeName}`);
          await this.delete(key, item.id);
        }
      }
    }
  }

  async ensureOpen() {
    if (!this.db || this._closed) await this.init();
  }

  /**
   * Wipes this device's local IndexedDB entirely and reopens a fresh,
   * empty database. Used by completeInstallation() so every onboarding
   * run starts from a clean slate instead of writing new admin/branch/
   * settings data on top of whatever was left over from a previous
   * install (e.g. a prior onboarding attempt, or leftover data from
   * before an uninstall/reinstall on the same machine/profile).
   */
  async resetDatabase() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this._closed = false;

    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      let blockedTimeout = null;
      request.onsuccess = () => { if (blockedTimeout) clearTimeout(blockedTimeout); resolve(); };
      request.onerror = () => { if (blockedTimeout) clearTimeout(blockedTimeout); reject(request.error); };
      // Deliberately NOT resolving here: onblocked means some other still-open
      // connection is delaying the actual delete, not that it failed. Resolving
      // early would let init() below race ahead and reopen the OLD database
      // before it's really gone — onsuccess still fires once it unblocks.
      // But if it never unblocks (a genuinely stuck/leaked connection), this
      // used to wait forever with no way to retry short of restarting the
      // whole app — give it a reasonable window, then fail with an
      // actionable message instead of hanging onboarding indefinitely.
      request.onblocked = () => {
        console.warn('[IndexedDB] resetDatabase blocked by another open connection, waiting...');
        if (!blockedTimeout) {
          blockedTimeout = setTimeout(() => {
            reject(new Error('Could not reset the local database — another window of this app may still be open. Please close any other windows and try again.'));
          }, 8000);
        }
      };
    });

    await this.init();
  }

  async getAll(store) {
    await this.ensureOpen();
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(store, 'readonly');
        const request = tx.objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      } catch (e) {
        if (e.name === 'InvalidStateError') {
          this.db = null;
          return this.getAll(store);
        }
        reject(e);
      }
    });
  }

  async put(store, data) {
    await this.ensureOpen();

    // Defensive check for Promises
    if (data instanceof Promise) {
      console.warn(`[DbService.put] Data is a Promise! Awaiting it...`);
      data = await data;
    }

    if (data && typeof data === 'object') {
      for (const [k, v] of Object.entries(data)) {
        if (v instanceof Promise) {
          console.warn(`[DbService.put] Key "${k}" is a Promise! Awaiting it...`);
          data[k] = await v;
        }
      }
    }

    return new Promise((resolve, reject) => {
      try {
        if (!this.db.objectStoreNames.contains(store)) {
          console.error(`[DbService.put] Store "${store}" NOT FOUND in database! Mapped key must be passed. Stores:`, [...this.db.objectStoreNames]);
          return reject(new Error(`Object store "${store}" unknown`));
        }
        const tx = this.db.transaction(store, 'readwrite');
        const request = tx.objectStore(store).put(data);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      } catch (err) {
        if (err.name === 'InvalidStateError') {
          this.db = null;
          return this.put(store, data);
        }
        reject(err);
      }
    });
  }

  async delete(store, id) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      try {
        if (!this.db.objectStoreNames.contains(store)) {
          console.error(`[DbService.delete] Store "${store}" NOT FOUND!`);
          return reject(new Error(`Object store "${store}" unknown`));
        }
        const tx = this.db.transaction(store, 'readwrite');
        const request = tx.objectStore(store).delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  async clear(store) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readwrite');
      const request = tx.objectStore(store).clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Performs an atomic get-modify-put operation within a single transaction.
   * Prevents race conditions where concurrent updates overwrite each other.
   */
  async update(store, id, updateFn) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      
      const getReq = os.get(id);
      getReq.onsuccess = async () => {
        const item = getReq.result;
        if (!item) return resolve(null);
        
        try {
          const updated = await updateFn(item);
          const putReq = os.put(updated);
          putReq.onsuccess = () => resolve(updated);
          putReq.onerror = () => reject(putReq.error);
        } catch (err) {
          reject(err);
        }
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }
}

export const db = new DbService();

export const KEYS = {
  PRODUCTS: 'pos_products',
  ORDERS: 'pos_orders',
  SETTINGS: 'pos_settings',
  BRANCHES: 'pos_branches',
  USERS: 'pos_users',
  CUSTOMERS: 'pos_customers',
  SUPPLIERS: 'pos_suppliers',
  PURCHASES: 'pos_purchases',
  SESSION: 'pos_session',
  REGISTERS: 'pos_registers',
  SHIFTS: 'pos_shifts',
  BRANCH_REGISTERS: 'pos_branch_registers',
  LOYALTY_HISTORY: 'pos_loyalty_history',
  STAFF: 'pos_staff',
  APPOINTMENTS: 'pos_appointments',
  STAFF_INCENTIVES: 'pos_staff_incentives',
  DAILY_STATS: 'pos_daily_stats',
  IMPORT_TRACKER: 'pos_import_tracker',
  IS_LOCKED: 'pos_is_locked',
  RETURNS: 'pos_returns',
  LICENSE_STATUS: 'pos_license_status',
  BACKUP_HISTORY: 'pos_backup_history',
  IMPORT_HISTORY: 'pos_import_history',
  INVENTORY_LOGS: 'pos_inventory_logs',
  CATEGORIES: 'pos_categories',
  SUB_CATEGORIES: 'pos_sub_categories',
  CREDIT_HISTORY: 'pos_credit_history',
  LOGIN_ACTIVITY: 'pos_login_activity',
  // Tombstones: track deleted record IDs so pos_full_state won't resurrect them
  DELETED_TOMBSTONES: 'pos_deleted_tombstones'
};

const DEFAULT_SETTINGS = {
  storeName: 'My Store',
  storeNameSubtitle: '',
  storeAddress: '123 Main Street, City',
  currency: '\u20B9',
  availableTaxes: [],
  taxRate: 5,
  receiptFooter: 'Thank you for shopping with us!',
  theme: 'theme-light-zoom', // "Sapphire" — default for fresh installs
  enableRegisterRoutine: true,
  paymentMethods: [],
  businessType: 'Restaurant', // options: 'Restaurant', 'General', 'Bakery', 'Saloon'
  masterPin: '0000',
  settingsLockEnabled: false,
  autoLockMinutes: 0, // 0 means disabled
  isInstalled: false,
  installationDate: '', // NEW: Track when the system was first set up
  networkId: 'GLOBAL',
  email: '',
  roundOffEnabled: false,
  deploymentMode: 'standalone'
};

export const BUSINESS_FEATURES = {
  'Restaurant': {},
  'General': {},
  'Bakery': {},
  'Saloon': { hasAppointments: true },
  'Others': {}
};

/**
 * Generate a 24-character hex string (MongoDB-compatible ObjectID)
 */
export function generateObjectId() {
  const timestamp = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0');
  const machineId = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
  const processId = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  const counter = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
  return timestamp + machineId + processId + counter;
}

export async function getBusinessFeatures() {
  const s = await getSettings();
  return BUSINESS_FEATURES[s.businessType] || BUSINESS_FEATURES['General'];
}

export async function hasPermission(action) {
  const [module, detail] = action.includes(':') ? action.split(':') : [action, null];

  // Public pages accessible without login
  if (['login', 'onboarding', 'customer-display'].includes(module)) return true;

  const user = await getCurrentUser();
  if (!user) return false;

  // Master role always has full access
  if (user.role === 'Master') return true;
  
  // Admins have full access by default unless we want to restrict them too (usually not)
  if (user.role === 'Admin' || user.role === 'Super Admin') return true;

  // Granular ACL checks
  if (user.permissions && Array.isArray(user.permissions)) {
    // 1. Exact permission string match (e.g., 'pos:discount', 'products:delete')
    if (user.permissions.includes(action)) return true;

    // 2. Map URL/Navigation module names to permission keys
    const modulePermissionMap = {
      'reports': 'reports:view',
      'users': 'staff:manage',
      'staff': 'staff:view', // Allow viewing list if they have view permission
      'settings': 'settings:manage',
      'branches': 'settings:branches',
      'products': 'products:view',
      'categories': 'products:view',
      'inventory': 'inventory:view',
      'purchases': 'inventory:view',
      'orders': 'orders:view',
      'customers': 'customers:view',
      'suppliers': 'products:view',
      'register': 'pos:access', // Register & Shifts — anyone who can use POS can access register
      'quick-pos': 'pos:access', // Same access as the regular POS screen, just a different layout
      'catalog': 'products:view', // Read-only product browsing view
    };

    const requiredPerm = modulePermissionMap[module];
    if (requiredPerm && user.permissions.includes(requiredPerm)) {
       return true;
    }

    // 3. Special case for POS and Dashboard
    if (module === 'pos' && user.permissions.includes('pos:access')) return true;
    if (module === 'dashboard') return true; // Everyone can see dashboard stats for now

    // 4. If it's a specific granular action (e.g. 'products:delete') and didn't match above, deny.
    if (detail) return false;

    // Otherwise, if it's just a top-level module access check and not in the map, allow if logged in?
    // Better to be strict: if not in map and not dashboard, deny.
    return false;
  }

  // Legacy fallback for users created before ACL feature (No permissions array)
  console.warn(`[RBAC] Legacy user fallback for: ${user.name}`);
  const restrictedModules = ['reports', 'users', 'staff', 'settings', 'branches', 'purchases'];
  if (restrictedModules.includes(module)) return false;
  
  // Allow basic navigation for legacy
  return true;
}

const DEFAULT_PRODUCTS = [
  { id: 101, name: 'Coffee', emoji: '☕', price: 80, category: 'Beverages', stock: 100 },
  { id: 102, name: 'Tea', emoji: '🍵', price: 40, category: 'Beverages', stock: 100 },
  { id: 103, name: 'Burger', emoji: '🍔', price: 150, category: 'Food', stock: 50 },
  { id: 104, name: 'Pizza', emoji: '🍕', price: 250, category: 'Food', stock: 30 },
  { id: 105, name: 'Water', emoji: '💧', price: 20, category: 'Beverages', stock: 500 },
];

const SALOON_PRODUCTS = [
  { id: 201, name: 'Men\'s Haircut', emoji: '💇‍♂️', price: 350, category: 'Hair', stock: 999 },
  { id: 202, name: 'Women\'s Styling', emoji: '💇‍♀️', price: 850, category: 'Hair', stock: 999 },
  { id: 203, name: 'Beard Trim', emoji: '🧔', price: 150, category: 'Grooming', stock: 999 },
  { id: 204, name: 'Facial Ritual', emoji: '🧖', price: 1200, category: 'Spa', stock: 999 },
  { id: 205, name: 'Hair Color', emoji: '🎨', price: 1500, category: 'Hair', stock: 999 },
];

const BAKERY_PRODUCTS = [
  { id: 301, name: 'Fresh Bread', emoji: '🍞', price: 45, category: 'Bread', stock: 50 },
  { id: 302, name: 'Chocolate Croissant', emoji: '🥐', price: 120, category: 'Pastry', stock: 30 },
  { id: 303, name: 'Strawberry Cake', emoji: '🍰', price: 850, category: 'Cakes', stock: 10 },
  { id: 304, name: 'Cookie Box', emoji: '🍪', price: 250, category: 'Cookies', stock: 40 },
  { id: 305, name: 'Bagel', emoji: '🥯', price: 55, category: 'Bread', stock: 25 },
];

const GENERAL_PRODUCTS = [
  { id: 401, name: 'Toothpaste', emoji: '🪥', price: 95, category: 'Personal Care', stock: 100 },
  { id: 402, name: 'Shampoo', emoji: '🧴', price: 180, category: 'Personal Care', stock: 50 },
  { id: 403, name: 'Milk 1L', emoji: '🥛', price: 65, category: 'Grocery', stock: 200 },
  { id: 404, name: 'Egg Box (6)', emoji: '🥚', price: 48, category: 'Grocery', stock: 150 },
  { id: 405, name: 'Detergent', emoji: '🧼', price: 210, category: 'Household', stock: 80 },
];

export const SUPERMARKET_PRODUCTS = [
  { name: 'Red Apple (kg)', emoji: '🍎', price: 180, category: 'Fruits & Veg', stock: 50, unit: 'kg' },
  { name: 'Banana (Doz)', emoji: '🍌', price: 60, category: 'Fruits & Veg', stock: 100, unit: 'pcs' },
  { name: 'Orange (kg)', emoji: '🍊', price: 120, category: 'Fruits & Veg', stock: 40, unit: 'kg' },
  { name: 'Potato (kg)', emoji: '🥔', price: 40, category: 'Fruits & Veg', stock: 200, unit: 'kg' },
  { name: 'Onion (kg)', emoji: '🧅', price: 35, category: 'Fruits & Veg', stock: 150, unit: 'kg' },
  { name: 'Tomato (kg)', emoji: '🍅', price: 50, category: 'Fruits & Veg', stock: 80, unit: 'kg' },
  { name: 'Carrot (kg)', emoji: '🥕', price: 70, category: 'Fruits & Veg', stock: 60, unit: 'kg' },
  { name: 'Spinach (Bundle)', emoji: '🥬', price: 25, category: 'Fruits & Veg', stock: 30, unit: 'pcs' },
  { name: 'Full Cream Milk 500ml', emoji: '🥛', price: 33, category: 'Dairy & Eggs', stock: 100, unit: 'pcs' },
  { name: 'Standard Milk 1L', emoji: '🥛', price: 65, category: 'Dairy & Eggs', stock: 80, unit: 'pcs' },
  { name: 'Plain Yogurt 200g', emoji: '🍦', price: 25, category: 'Dairy & Eggs', stock: 50, unit: 'pcs' },
  { name: 'Butter 100g', emoji: '🧈', price: 58, category: 'Dairy & Eggs', stock: 40, unit: 'pcs' },
  { name: 'Cheese Slices (10p)', emoji: '🧀', price: 145, category: 'Dairy & Eggs', stock: 30, unit: 'pcs' },
  { name: 'Egg Box (12)', emoji: '🥚', price: 90, category: 'Dairy & Eggs', stock: 60, unit: 'pcs' },
  { name: 'Paneer 200g', emoji: '🍢', price: 110, category: 'Dairy & Eggs', stock: 25, unit: 'pcs' },
  { name: 'White Bread', emoji: '🍞', price: 40, category: 'Bakery', stock: 50, unit: 'pcs' },
  { name: 'Brown Bread', emoji: '🍞', price: 55, category: 'Bakery', stock: 30, unit: 'pcs' },
  { name: 'Pav (6pcs)', emoji: '🥖', price: 30, category: 'Bakery', stock: 40, unit: 'pcs' },
  { name: 'Fruit Bun', emoji: '🥯', price: 20, category: 'Bakery', stock: 25, unit: 'pcs' },
  { name: 'Rusk 200g', emoji: '🍪', price: 45, category: 'Bakery', stock: 50, unit: 'pcs' },
  { name: 'Basmati Rice 1kg', emoji: '🍚', price: 140, category: 'Staples', stock: 100, unit: 'kg' },
  { name: 'Wheat Flour 5kg', emoji: '🌾', price: 220, category: 'Staples', stock: 50, unit: 'pcs' },
  { name: 'Sunflower Oil 1L', emoji: '🌻', price: 165, category: 'Staples', stock: 80, unit: 'pcs' },
  { name: 'Toor Dal 1kg', emoji: '🫘', price: 150, category: 'Staples', stock: 60, unit: 'kg' },
  { name: 'Sugar 1kg', emoji: '🍬', price: 48, category: 'Staples', stock: 200, unit: 'kg' },
  { name: 'Salt 1kg', emoji: '🧂', price: 25, category: 'Staples', stock: 150, unit: 'kg' },
  { name: 'Urad Dal 1kg', emoji: '🫘', price: 140, category: 'Staples', stock: 40, unit: 'kg' },
  { name: 'Poha 500g', emoji: '🌾', price: 55, category: 'Staples', stock: 45, unit: 'pcs' },
  { name: 'Potato Chips', emoji: '🍟', price: 20, category: 'Snacks', stock: 200, unit: 'pcs' },
  { name: 'Chocolate Bar', emoji: '🍫', price: 40, category: 'Snacks', stock: 150, unit: 'pcs' },
  { name: 'Biscuits (Tea)', emoji: '🍪', price: 30, category: 'Snacks', stock: 100, unit: 'pcs' },
  { name: 'Cola 500ml', emoji: '🥤', price: 40, category: 'Beverages', stock: 120, unit: 'pcs' },
  { name: 'Fruit Juice 1L', emoji: '🧃', price: 110, category: 'Beverages', stock: 60, unit: 'pcs' },
  { name: 'Instant Coffee 50g', emoji: '☕', price: 145, category: 'Beverages', stock: 40, unit: 'pcs' },
  { name: 'Tea Dust 250g', emoji: '🍵', price: 125, category: 'Beverages', stock: 50, unit: 'pcs' },
  { name: 'Soap Bar (100g)', emoji: '🧼', price: 35, category: 'Personal Care', stock: 150, unit: 'pcs' },
  { name: 'Shampoo 200ml', emoji: '🧴', price: 190, category: 'Personal Care', stock: 80, unit: 'pcs' },
  { name: 'Toothpaste 100g', emoji: '🪥', price: 95, category: 'Personal Care', stock: 100, unit: 'pcs' },
  { name: 'Face Wash 100ml', emoji: '🚿', price: 160, category: 'Personal Care', stock: 50, unit: 'pcs' },
  { name: 'Body Lotion 200ml', emoji: '🧴', price: 250, category: 'Personal Care', stock: 40, unit: 'pcs' },
  { name: 'Hand Wash Refill', emoji: '🧼', price: 110, category: 'Personal Care', stock: 60, unit: 'pcs' },
  { name: 'Deodorant Spray', emoji: '💨', price: 220, category: 'Personal Care', stock: 45, unit: 'pcs' },
  { name: 'Hair Oil 100ml', emoji: '🪔', price: 85, category: 'Personal Care', stock: 70, unit: 'pcs' },
  { name: 'Detergent Powder 1kg', emoji: '🧼', price: 145, category: 'Household', stock: 90, unit: 'pcs' },
  { name: 'Dishwash Gel 500ml', emoji: '🧴', price: 105, category: 'Household', stock: 70, unit: 'pcs' },
  { name: 'Floor Cleaner 1L', emoji: '🧹', price: 180, category: 'Household', stock: 50, unit: 'pcs' },
  { name: 'Toilet Cleaner 500ml', emoji: '🚽', price: 95, category: 'Household', stock: 60, unit: 'pcs' },
  { name: 'Kitchen Towel (2p)', emoji: '🧻', price: 120, category: 'Household', stock: 40, unit: 'pcs' },
  { name: 'Garbage Bags (30p)', emoji: '🗑️', price: 150, category: 'Household', stock: 100, unit: 'pcs' },
  { name: 'Glass Cleaner Spray', emoji: '🪟', price: 85, category: 'Household', stock: 35, unit: 'pcs' },
];


export async function read(key) {
  try {
    const res = await db.getAll(key);
    
    // If it's a store that normally only has one 'active' record
    const singleObj = res.find(i => i.id === 'current');
    if (singleObj) return singleObj;
    
    // For scalar values
    const scalarVal = res.find(i => i.id === 'value');
    if (scalarVal) return scalarVal.val;

    // Return the whole list. Contextual find() calls (like in getSettings) 
    // will handle finding specific IDs (like 'global_settings').
    return res.length > 0 ? res : null;
  } catch { return null; }
}

export async function getCachedLicenseStatus() {
  return await db.get(KEYS.LICENSE_STATUS, 'current');
}

export async function saveCachedLicenseStatus(status) {
  status.id = 'current';
  await db.put(KEYS.LICENSE_STATUS, status);
}

export async function write(key, data) {
  try {
    if (Array.isArray(data)) {
        await db.clear(key);
        for (const item of data) {
            await db.put(key, item);
        }
    } else {
        data.id = data.id || 'current';
        await db.put(key, data);
    }
  } catch (e) { console.error('Storage error:', e); }
}

// Products
export async function getProducts(branchId = null) {
  let p = await db.getAll(KEYS.PRODUCTS);
  if (!p) p = [];

  if (branchId) {
    return p.filter(x => (x.branchId || 'b1') === branchId);
  }
  return p;
}

export async function importIndustryProducts(type, branchId = 'b1') {
  let productsToImport = [];
  switch (type) {
    case 'Saloon': productsToImport = SALOON_PRODUCTS; break;
    case 'Bakery': productsToImport = BAKERY_PRODUCTS; break;
    case 'General': productsToImport = GENERAL_PRODUCTS; break;
    case 'Restaurant': productsToImport = DEFAULT_PRODUCTS; break;
    case 'Supermarket': productsToImport = SUPERMARKET_PRODUCTS; break;
    case 'Others': productsToImport = GENERAL_PRODUCTS; break;
  }

  if (productsToImport.length === 0) return;

  const current = await getProducts();

  // Skip items that already exist for this branch (by name) — prevents duplicate
  // catalog entries when the same industry/type is imported more than once.
  const existingNamesForBranch = new Set(
    current.filter(p => (p.branchId || 'b1') === branchId).map(p => (p.name || '').trim().toLowerCase())
  );
  const uniqueToImport = productsToImport.filter(p => !existingNamesForBranch.has((p.name || '').trim().toLowerCase()));

  if (uniqueToImport.length === 0) {
    await setIndustryImported(type, true);
    return [];
  }

  const nextId = current.length > 0 ? Math.max(...current.map(p => p.id)) + 1 : 101;

  const newItems = uniqueToImport.map((p, idx) => ({
    ...p,
    id: nextId + idx,
    branchId: branchId
  }));

  await write(KEYS.PRODUCTS, [...current, ...newItems]);

  // Log initial stock for imported products
  for (const p of newItems) {
    if (p.stock > 0) {
      await logInventoryChange(p.id, null, 'IN', p.stock, 'Initial Industry Stock Import', branchId, null, 0, p.stock, 'System');
    }
  }

  // Sample products carry a bare `category` string, but POS's category
  // filter chips only show categories that exist as real records in the
  // categories store (Settings > Categories) — without this, an imported
  // product can display "Personal Care" on the Products page while that
  // chip never appears on the POS screen at all, since nothing ever created
  // a matching Category record for it.
  const existingCategoryNames = new Set((await getCategories()).map(c => c.name.trim().toLowerCase()));
  const newCategoryNames = [...new Set(newItems.map(p => (p.category || '').trim()).filter(Boolean))]
    .filter(name => !existingCategoryNames.has(name.toLowerCase()));
  for (let i = 0; i < newCategoryNames.length; i++) {
    await saveCategory({ id: `cat-${Date.now()}-${i}`, name: newCategoryNames[i] });
  }

  await setIndustryImported(type, true);
  return newItems;
}

/**
 * Merges duplicate products (same name, same branch) created by repeated
 * industry-catalog imports: keeps the oldest record, sums stock from all
 * duplicates onto it, remaps any order/return references pointing at
 * the removed IDs, then deletes the duplicates.
 */
export async function mergeDuplicateProducts(branchId = 'b1') {
  const allProducts = await getProducts();
  const branchProducts = allProducts.filter(p => (p.branchId || 'b1') === branchId);

  const groups = {};
  for (const p of branchProducts) {
    const key = (p.name || '').trim().toLowerCase();
    if (!key) continue;
    (groups[key] = groups[key] || []).push(p);
  }

  const idRemap = {}; // removedId -> keeperId
  const summary = [];

  for (const group of Object.values(groups)) {
    if (group.length < 2) continue;

    const sorted = [...group].sort((a, b) => Number(a.id) - Number(b.id));
    const [keeper, ...duplicates] = sorted;
    const mergedStock = group.reduce((sum, p) => sum + (Number(p.stock) || 0), 0);
    const oldKeeperStock = Number(keeper.stock) || 0;

    for (const dup of duplicates) idRemap[String(dup.id)] = String(keeper.id);

    await updateProduct({ ...keeper, stock: mergedStock });
    if (mergedStock !== oldKeeperStock) {
      await logInventoryChange(keeper.id, null, 'IN', mergedStock - oldKeeperStock, 'Duplicate Product Merge', branchId, null, oldKeeperStock, mergedStock, 'System');
    }
    for (const dup of duplicates) {
      await deleteProduct(dup.id);
    }

    summary.push({ name: keeper.name, keptId: keeper.id, removedIds: duplicates.map(d => d.id), mergedStock });
  }

  if (Object.keys(idRemap).length === 0) return summary;

  // Remap item references so past orders/returns still point at a live product.
  const remapItems = (items) => (items || []).map(it => {
    const newId = idRemap[String(it.id)];
    return newId ? { ...it, id: newId } : it;
  });

  const orders = await getOrders(branchId);
  for (const o of orders) {
    if (o.items?.some(it => idRemap[String(it.id)])) {
      await updateData('orders', { ...o, items: remapItems(o.items) });
    }
  }

  const returns = await getReturns(branchId);
  for (const r of returns) {
    if (r.items?.some(it => idRemap[String(it.id)])) {
      await updateData('returns', { ...r, items: remapItems(r.items) });
    }
  }

  return summary;
}

export async function isIndustryImported(type) {
  const status = await db.get(KEYS.IMPORT_TRACKER, 'status') || {};
  return !!status[type];
}

export async function setIndustryImported(type, value) {
  const status = (await db.get(KEYS.IMPORT_TRACKER, 'status')) || { id: 'status' };
  status[type] = value;
  await db.put(KEYS.IMPORT_TRACKER, status);
}


export async function saveProducts(products) {
  await write(KEYS.PRODUCTS, products);
}

export async function addProduct(product) {
  // Enforce License Limits
  const sync = window.syncEngine;
  if (sync && !product.id) { // Only for new ones
    const limits = sync.getLimits();
    const existingProducts = await getProducts();
    const existingCount = existingProducts.length;
    if (existingCount >= limits.maxProducts) {
      const msg = `Product limit reached (${limits.maxProducts}). Please upgrade to Premium to add more items.`;
      if (window.showToast) window.showToast(msg, 'error');
      throw new Error(msg);
    }
  }

  if (product.id) product.id = String(product.id);
  else product.id = String(Date.now());

  if (!product.branchId) {
    const cb = await getCurrentBranch();
    product.branchId = cb?.id || 'b1';
  }
  await updateData('products', product);
  return product;
}

export async function updateProduct(updated) {
  await updateData('products', updated);
}

export async function deleteProduct(id) {
  await deleteData('products', id);
}

/**
 * Stock Adjustment / Stock-Take: sets a product's (or one of its variants')
 * stock to a physically-counted quantity and logs the delta with a specific
 * adjustment reason (damage, theft, expiry, found-extra, count correction),
 * distinct from the generic "Manual Edit" reason logged by the product edit
 * form. Re-fetches the product fresh rather than trusting a caller-held
 * reference, so a stock-take session started a while ago still adjusts
 * against the product's current stock, not whatever it was when the
 * session's product list was first loaded.
 */
export async function adjustProductStock(productId, variantName, newStock, reason, note) {
  const products = await getProducts();
  const product = products.find(p => String(p.id) === String(productId));
  if (!product) throw new Error('Product not found');

  const branchId = product.branchId || 'b1';
  const countedStock = Number(newStock);
  let oldStock;

  if (variantName) {
    const variant = (product.variants || []).find(v => v.name === variantName);
    if (!variant) throw new Error('Variant not found');
    oldStock = Number(variant.stock) || 0;
    variant.stock = countedStock;
    // product.stock is only ever a derived sum of its variants (see
    // saveOrder()'s deduction above) — every other consumer (CSV export,
    // getProductStockAcrossBranches, low-stock reports) reads it directly,
    // so leaving it stale here would silently desync them from this adjustment.
    product.stock = product.variants.reduce((s, v) => s + (Number(v.stock) || 0), 0);
  } else {
    oldStock = Number(product.stock) || 0;
    product.stock = countedStock;
  }

  const delta = countedStock - oldStock;
  if (delta === 0) return;

  await updateProduct(product);

  const fullReason = note ? `Stock Adjustment: ${reason} (${note})` : `Stock Adjustment: ${reason}`;
  await logInventoryChange(
    productId, variantName || null, delta > 0 ? 'IN' : 'OUT', Math.abs(delta),
    fullReason, branchId, null, oldStock, countedStock
  );
}

export async function getProductStockAcrossBranches(sku) {
  if (!sku) return [];
  const allProducts = await read(KEYS.PRODUCTS) || [];
  const allBranches = await read(KEYS.BRANCHES) || [{id: 'b1', name: 'Main Branch'}];
  
  const matches = allProducts.filter(p => p.sku === sku);
  
  // Aggregate stock across all occurrences of this SKU in the same branch just in case
  const branchMap = {};
  matches.forEach(p => {
    const bId = p.branchId || 'b1';
    branchMap[bId] = (branchMap[bId] || 0) + (p.stock || 0);
  });
  
  return Object.keys(branchMap).map(bId => {
    const branch = allBranches.find(b => String(b.id) === String(bId));
    return {
      branchId: bId,
      branchName: branch ? branch.name : (bId === 'b1' ? 'Main Branch' : 'Branch ' + bId),
      stock: branchMap[bId]
    };
  });
}

// ============================================================
// Inventory Audit Logs
// ============================================================
// A stored timestamp is a full ISO string (e.g. "2026-07-22T09:52:10.000Z") — always UTC.
// startDate/endDate range-picker values are plain local "YYYY-MM-DD". Naively slicing the
// first 10 characters off the ISO string gives the UTC calendar date, which silently drifts
// a whole day off the shop's actual local day in any timezone ahead of UTC (e.g. IST,
// UTC+5:30) for anything that happened between local midnight and the UTC offset catching
// up — a sale rung up at 2am IST would get filed under *yesterday* in every date-range
// report. Always derive the date-only string from local calendar fields instead.
export function localDateOnly(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function getInventoryLogs(branchId = null, startDate = null, endDate = null) {
  const logs = await db.getAll(KEYS.INVENTORY_LOGS) || [];
  return logs.filter(l => {
    const isBranchMatch = !branchId || (l.branchId || 'b1') === branchId;
    // l.date is a full ISO timestamp (e.g. "2026-07-22T09:52:10Z"); startDate/endDate
    // are plain "YYYY-MM-DD". Comparing the raw strings makes today's records fail
    // the endDate check (the timestamp is lexicographically "greater" than the bare
    // date it falls on), silently excluding same-day records — compare date-only.
    const dateOnly = localDateOnly(l.date);
    const isDateMatch = (!startDate || dateOnly >= startDate) && (!endDate || dateOnly <= endDate);
    return isBranchMatch && isDateMatch;
  });
}

export async function logInventoryChange(productId, variantName, type, qtyChange, reason, branchId = null, refId = null, oldStock = null, newStock = null, userName = null) {
  const currentBranch = await getCurrentBranch();
  const session = await getSession();
  const log = {
    id: String('INV-' + Date.now() + '-' + Math.floor(Math.random() * 1000)),
    date: new Date().toISOString(),
    productId,
    variantName: variantName || null,
    type, // 'IN' or 'OUT'
    qtyChange, // Always a positive number (absolute value)
    reason, // 'Sale', 'Return', 'Purchase', 'Manual Edit', 'Transfer'
    branchId: branchId || currentBranch?.id || 'b1',
    refId: refId || null,
    oldStock: oldStock !== null ? Number(oldStock) : null,
    newStock: newStock !== null ? Number(newStock) : null,
    user: userName || session?.user?.name || 'System',
    updatedAt: new Date().toISOString(),
    isSynced: false
  };
  
  await db.put(KEYS.INVENTORY_LOGS, log);

  // Dispatch event for syncEngine to broadcast this log to other devices
  window.dispatchEvent(new CustomEvent('storage-change', {
    detail: { type: 'update', store: 'inventory_logs', data: log }
  }));
}

// Daily Sequence Numbering
export async function getNextDailyNumber() {
  let stats = await db.get(KEYS.DAILY_STATS, 'counter');

  if (!stats) {
    stats = { date: '', counter: 0, id: 'counter' };
  }

  const today = new Date().toDateString();

  if (stats.date !== today) {
    stats.date = today;
    stats.counter = 1;
  } else {
    stats.counter++;
  }

  await updateData('daily_stats', stats);
  return stats.counter;
}

export async function getOrders(branchId = null, startDate = null, endDate = null) {
  const orders = await db.getAll(KEYS.ORDERS) || [];
  return orders.filter(o => {
    const isBranchMatch = !branchId || (o.branchId || 'b1') === branchId;
    // See getInventoryLogs() above — compare date-only so today's timestamped
    // orders aren't wrongly excluded when endDate is today.
    const dateOnly = localDateOnly(o.date);
    const isDateMatch = (!startDate || dateOnly >= startDate) && (!endDate || dateOnly <= endDate);
    return isBranchMatch && isDateMatch;
  });
}

export async function saveOrder(order) {
  if (!order.dailyNumber) {
    order.dailyNumber = await getNextDailyNumber();
  }
  order.id = order.id || `ORD-${Date.now()}`;
  order.date = order.date || new Date().toISOString();
  order.status = order.status || 'completed';

  if (!order.branchId) {
    const cb = await getCurrentBranch();
    order.branchId = cb?.id || 'b1';
  }
  
  // Auto-deduct stock and log it if this is a newly finalized order
  const existingOrder = await getDataById('orders', order.id);
  const isNew = !existingOrder;

  // Save the order record FIRST — by the time this function runs, payment has
  // already been collected in the real world, so this row IS the sale's
  // receipt/audit trail. Losing it because a later loyalty/stock write fails
  // partway through would be worse than a stock-count drift, which a
  // stock-take can still correct after the fact.
  await updateData('orders', order);

  if (isNew && order.status !== 'cancelled') {
    // Loyalty and Credit processing for new orders only — isolated in its own
    // try/catch so a failure here (e.g. one adjustCustomerCredit write) can't
    // also abort the stock-deduction loop below, or make confirmOrder's
    // caller show a "payment failed" toast for an order that's actually
    // already saved (see the updateData('orders', order) call above).
    try {
    if (order.customer && order.customer.id) {
        const customers = await getCustomers();
        const customer = customers.find(c => c.id === order.customer.id);
        const tier = getLoyaltyTier(customer?.totalSpent || 0);
        const earnRate = tier.earnRate;
        const pointsEarned = Math.floor(order.total * earnRate);

        order.awardedPoints = pointsEarned;
        await awardLoyaltyPoints(order.customer.id, pointsEarned, order.total, order.id);

        if (order.redeemedPoints) {
            await redeemLoyaltyPoints(order.customer.id, order.redeemedPoints, order.id);
        }
        
        // Handle Store Credit Balance usage
        if (order.creditUsed && order.creditUsed > 0) {
            await adjustCustomerCredit(order.customer.id, order.creditUsed, 'Debit', `Credit used for purchase (Order ${order.id})`, order.id);
        }

        // Handle Remaining Debt (Unpaid balance after cash/upi/card/loyalty/credit)
        if (order.isCredit) {
            const paidAmount = (order.payments || []).reduce((sum, p) => sum + p.amount, 0);
            const totalDebt = Math.max(0, order.total - (order.redeemedPoints || 0) - paidAmount - (order.creditUsed || 0)); 
            
            if (totalDebt > 0.01) {
                // Add the unpaid remainder as new debt (negative creditBalance)
                await adjustCustomerCredit(order.customer.id, totalDebt, 'Debit', `Purchase on credit (Order ${order.id})`, order.id);
            }
        }
        
        // If "Store Credit" was used as a payment method
        if (order.payments) {
            const storeCreditPayment = order.payments.find(p => p.method === 'Store Credit');
            if (storeCreditPayment && storeCreditPayment.amount > 0) {
                await adjustCustomerCredit(order.customer.id, storeCreditPayment.amount, 'Debit', `Paid with store credit (Order ${order.id})`, order.id);
            }
        }
    }
    } catch (err) {
      console.error(`[saveOrder] Loyalty/credit processing failed for order ${order.id}:`, err);
    }

    const products = await getProducts();
    for (const item of order.items) {
      // Each item's stock write is independent — a transient failure on one
      // line must not abort the rest of the loop, and the order itself is
      // already saved above, so there's nothing left to "undo" here; log
      // loudly instead so a partial failure is traceable rather than silent.
      try {
        const p = products.find(x => x.id === item.id);
        if (p) {
          let oldStock = 0;
          if (item.variantName && p.variants) {
            const v = p.variants.find(v => v.name === item.variantName);
            if (v) {
              oldStock = v.stock || 0;
              v.stock = (v.stock || 0) - item.qty;
              p.stock = p.variants.reduce((s, vr) => s + (vr.stock || 0), 0);
            }
          } else {
            oldStock = p.stock || 0;
            p.stock = (p.stock || 0) - item.qty;
          }
          await updateProduct(p);
          await logInventoryChange(p.id, item.variantName || null, 'OUT', item.qty, 'Sale (POS)', order.branchId, order.id, oldStock, oldStock - item.qty);
        }
      } catch (err) {
        console.error(`[saveOrder] Stock deduction failed for order ${order.id}, product ${item.id}:`, err);
      }
    }
  }

  return order;
}

export async function settleOrderPayment(orderId, paymentMethod, amountPaid) {
  const orders = await getOrders();
  const order = orders.find(o => o.id === orderId);
  if (!order) throw new Error('Order not found');

  // 1. Update Order
  if (!order.payments) order.payments = [];
  order.payments.push({ 
    method: paymentMethod, 
    amount: amountPaid, 
    date: new Date().toISOString() 
  });
  
  // Calculate remaining balance
  const paidAlready = order.payments.reduce((s, p) => s + p.amount, 0);
  const totalDue = order.total - (order.redeemedPoints || 0) - (order.creditUsed || 0);
  
  if (paidAlready >= totalDue - 0.01) {
    order.status = 'completed';
    order.isCredit = false; // It's now fully paid
    
    // Update the main paymentMethod text for the list view
    if (order.payments.length === 1) {
      order.paymentMethod = order.payments[0].method;
    } else {
      order.paymentMethod = 'Split';
    }
  }

  
  await updateData('orders', order);

  // 2. Adjust Customer Credit (if applicable)
  if (order.customer && order.customer.id) {
    await adjustCustomerCredit(order.customer.id, amountPaid, 'Credit', `Payment for Order ${orderId}`, orderId);
  }

  // 3. Update Shift Sales (record the collection)
  const cb = await getCurrentBranch();
  const rid = await getCurrentRegisterId();
  await updateShiftSales(order.branchId || cb?.id || 'b1', amountPaid, paymentMethod, rid, false, true);

  return order;
}


export async function deleteOrder(id) {
  const orders = await getOrders();
  const o = orders.find(x => x.id === id);
  if (o && o.status !== 'cancelled') {
    const products = await getProducts();
    for (const item of o.items) {
      const p = products.find(x => x.id === item.id);
      if (p) {
        let oldStock = 0;
        if (item.variantName && p.variants) {
          const v = p.variants.find(v => v.name === item.variantName);
          if (v) {
            oldStock = v.stock || 0;
            v.stock = (v.stock || 0) + item.qty;
            p.stock = p.variants.reduce((s, vr) => s + (vr.stock || 0), 0);
          }
        } else {
          oldStock = p.stock || 0;
          p.stock = (p.stock || 0) + item.qty;
        }
        await updateProduct(p);
        await logInventoryChange(p.id, item.variantName || null, 'IN', item.qty, 'Order Deleted', o.branchId, o.id, oldStock, oldStock + item.qty);
      }
    }
  }
  await deleteData('orders', id);
}

// Returns
export async function getReturns(branchId = null, startDate = null, endDate = null) {
  const returns = await db.getAll(KEYS.RETURNS) || [];
  return returns.filter(r => {
    const isBranchMatch = !branchId || (r.branchId || 'b1') === branchId;
    // See getInventoryLogs() above — compare date-only so today's timestamped
    // returns aren't wrongly excluded when endDate is today.
    const dateOnly = localDateOnly(r.date);
    const isDateMatch = (!startDate || dateOnly >= startDate) && (!endDate || dateOnly <= endDate);
    return isBranchMatch && isDateMatch;
  });
}

export async function saveReturn(ret) {
  ret.id = ret.id || `RET-${Date.now()}`;
  ret.date = ret.date || new Date().toISOString();

  // Re-validate against a FRESH read of existing returns at save-time,
  // not whatever the UI computed when the return modal was first opened —
  // a double-click on "Confirm Return" (or two terminals returning the
  // same order concurrently) could otherwise both submit against the same
  // stale "available to return" figures, refunding/restocking more than
  // was actually sold.
  if (ret.type === 'sales' && ret.orderId) {
    const orders = await getOrders();
    const parentOrder = orders.find(o => o.id === ret.orderId);
    if (parentOrder) {
      // Keyed by id+variantName, not just id — an order can have multiple
      // lines sharing the same product id but different variants (e.g. a
      // shirt in "Red" qty 5 and "Blue" qty 3, both id 101), and matching
      // by id alone conflated them: fully returning one variant made the
      // OTHER, untouched variant on the same order look fully returned
      // too, hard-rejecting a completely valid return.
      const lineKey = (id, variantName) => `${id}::${variantName || ''}`;
      const existingReturns = (await getReturns()).filter(r => r.orderId === ret.orderId && r.id !== ret.id);
      const alreadyReturnedByItem = {};
      existingReturns.forEach(r => {
        r.items.forEach(item => {
          const key = lineKey(item.id, item.variantName);
          alreadyReturnedByItem[key] = (alreadyReturnedByItem[key] || 0) + item.qty;
        });
      });
      for (const item of ret.items) {
        const key = lineKey(item.id, item.variantName);
        const originalItem = parentOrder.items.find(oi => lineKey(oi.id, oi.variantName) === key);
        const originalQty = originalItem ? originalItem.qty : 0;
        const alreadyReturned = alreadyReturnedByItem[key] || 0;
        const available = originalQty - alreadyReturned;
        if (item.qty > available + 0.001) { // small epsilon for float rounding
          throw new Error(`Cannot return ${item.qty} of "${item.name}" — only ${Math.max(0, available).toFixed(3)} available to return.`);
        }
      }
    }
  }

  await updateData('returns', ret);

  // If it's a sales return, adjust shift sales
  if (ret.type === 'sales') {
    // Need to handle shift update as async if needed
    // updateShiftSales is likely in db.js too, let's keep it sync for now or refactor
    const currentBranch = await getCurrentBranch();
    await updateShiftSales(ret.branchId || currentBranch?.id || 'b1', -ret.total, ret.refundMethod || 'Cash', ret.registerId, true);
  }

  // Adjust product stock
  const products = await getProducts();
  for (const item of ret.items) {
    const p = products.find(p => p.id === item.id);
    if (p) {
      let oldStock = 0;
      if (item.variantName && p.variants) {
        const v = p.variants.find(v => v.name === item.variantName);
        if (v) {
          oldStock = v.stock || 0;
          v.stock = (v.stock || 0) + (ret.type === 'sales' ? item.qty : -item.qty);
          p.stock = p.variants.reduce((s, vr) => s + (vr.stock || 0), 0);
        }
      } else {
        oldStock = p.stock || 0;
        p.stock = (p.stock || 0) + (ret.type === 'sales' ? item.qty : -item.qty);
      }
      await updateProduct(p);
      
      const type = ret.type === 'sales' ? 'IN' : 'OUT';
      const reason = ret.type === 'sales' ? 'Order Return/Refund' : 'Return to Supplier';
      const newStock = oldStock + (ret.type === 'sales' ? item.qty : -item.qty);
      await logInventoryChange(p.id, item.variantName || null, type, item.qty, reason, ret.branchId, ret.id, oldStock, newStock);
    }
  }

  // Adjust items and status of parent record
  if (ret.type === 'sales' && ret.orderId) {
    const orders = await getOrders();
    const orderIdx = orders.findIndex(o => o.id === ret.orderId);
    if (orderIdx !== -1) {
      const parent = orders[orderIdx];
      const allReturns = (await getReturns()).filter(r => r.orderId === ret.orderId);

      // Calculate total returned qty per item
      const returnedQtyMap = {};
      allReturns.forEach(r => {
        r.items.forEach(item => {
          returnedQtyMap[item.id] = (returnedQtyMap[item.id] || 0) + item.qty;
        });
      });

      const originalTotalQty = parseFloat(parent.items.reduce((s, i) => s + i.qty, 0).toFixed(3));
      const totalReturnedQty = parseFloat(Object.values(returnedQtyMap).reduce((s, q) => s + q, 0).toFixed(3));

      parent.status = totalReturnedQty >= originalTotalQty ? 'returned' : 'partial-return';
      await updateData('orders', parent);
    }
  } else if (ret.type === 'purchase' && ret.purchaseId) {
    const purchases = await getPurchases();
    const purIdx = purchases.findIndex(p => p.id === ret.purchaseId);
    if (purIdx !== -1) {
      const parent = purchases[purIdx];
      const allReturns = (await getReturns()).filter(r => r.purchaseId === ret.purchaseId);

      const returnedQtyMap = {};
      allReturns.forEach(r => {
        r.items.forEach(item => {
          returnedQtyMap[item.id] = (returnedQtyMap[item.id] || 0) + item.qty;
        });
      });

      const originalTotalQty = parseFloat(((parent.items || []).reduce((s, i) => s + i.qty, 0) || 1).toFixed(3));
      const totalReturnedQty = parseFloat(Object.values(returnedQtyMap).reduce((s, q) => s + q, 0).toFixed(3));

      parent.status = totalReturnedQty >= originalTotalQty ? 'returned' : 'partial-return';
      await updateData('purchases', parent);
    }
  }

  return ret;
}

export async function getSettings(branchId = null) {
  let data = await db.getAll(KEYS.SETTINGS) || [];
  if (!Array.isArray(data)) data = [data];

  // 1. Identify Global Settings
  const globalS = data.find(x => x && x.id === 'global_settings') || {};

  // 2. Identify Target Branch Settings
  const currentBranch = await getCurrentBranch();
  const bid = branchId || currentBranch?.id;
  const targetId = bid ? `settings_${bid}` : 'global_settings';
  
  let branchS = null;
  if (bid && targetId !== 'global_settings') {
    branchS = data.find(x => x && x.id === targetId);
  }

  // 3. Merge: DEFAULT <- GLOBAL <- BRANCH
  const merged = { 
    ...DEFAULT_SETTINGS, 
    ...globalS, 
    ...(branchS || {}) 
  };

  const finalSettings = {
    ...merged,
    // Trust the IndexedDB merged values (populated from server) directly.
    paymentMethods: merged.paymentMethods || [],
    availableTaxes: merged.availableTaxes || [],
    // storeName/theme/masterPin/settingsLockEnabled are intentionally NOT
    // forced back to globalS here — they must stay branch-specific per
    // branch, same as tax/appearance/security in general: `merged` already
    // resolved each correctly via DEFAULT <- GLOBAL <- BRANCH, so a branch's
    // own settings_<id> record wins whenever it has its own value saved.
    // Only Backup-related fields stay global-only (see saveSettings()) since
    // a backup captures this WHOLE device's data, not a single branch's.
    id: (branchS ? branchS.id : globalS.id) || 'global_settings',
    branchId: (branchS ? branchS.branchId : globalS.branchId) || null
  };

  // Recover licenseKey from session if missing or still using the GLOBAL placeholder
  if (!finalSettings.licenseKey || finalSettings.licenseKey === 'GLOBAL') {
    const session = await getSession();
    if (session?.user?.licenseKey) {
        finalSettings.licenseKey = session.user.licenseKey;
    }
  }

  // This build only supports the local/Electron install — always standalone.
  finalSettings.deploymentMode = 'standalone';

  return finalSettings;
}

// A backup captures this WHOLE device's IndexedDB, not one branch's slice of
// it — so its config (folder path, auto-backup toggle, interval, retention)
// must stay a single global value, unaffected by which branch happens to be
// active. getSettings() always resolves against the current branch, so
// backup UI/save code must go through this instead.
export async function getGlobalSettings() {
  let data = await db.getAll(KEYS.SETTINGS) || [];
  if (!Array.isArray(data)) data = [data];
  return data.find(x => x && x.id === 'global_settings') || { ...DEFAULT_SETTINGS, id: 'global_settings' };
}

export async function saveSettings(settings) {
  const allSettings = await db.getAll(KEYS.SETTINGS) || [];
  const currentBranch = await getCurrentBranch();
  const branchId = settings.branchId || currentBranch?.id;
  const isGlobal = !branchId || settings.id === 'global_settings';
  
  const id = isGlobal ? 'global_settings' : `settings_${branchId}`;
  const finalBranchId = isGlobal ? null : branchId;

  const globalRecord = allSettings.find(x => x && x.id === 'global_settings') || { id: 'global_settings' };
  const licenseKey = settings.licenseKey || globalRecord.licenseKey || 'GLOBAL';

  // SUBSCRIPTION STATE MANAGEMENT
  // Always keep subscriptionRequest in Global Settings to avoid branch-specific staleness
  if (settings.subscriptionRequest) {
    const globalS = { ...globalRecord };
    globalS.subscriptionRequest = settings.subscriptionRequest;
    await db.put(KEYS.SETTINGS, globalS);
    
    // Remove it from the branch-specific settings if it was there
    if (!isGlobal) {
      delete settings.subscriptionRequest;
    }
  }

  // CAPTURE SECURITY FIELDS FIRST
  const securityToSync = {
    masterPin: settings.masterPin,
    settingsLockEnabled: settings.settingsLockEnabled
  };

  const dataToSave = { 
    ...settings, 
    id, 
    branchId: finalBranchId,
    licenseKey,
    updatedAt: new Date().toISOString() 
  };

  // FORCED PERSISTENCE FIX: Never allow security PINs in branch records to prevent reverts
  if (!isGlobal) {
    delete dataToSave.masterPin;
    delete dataToSave.settingsLockEnabled;
  }

  // Record keeping
  console.log('[DB] Saving Settings Store:', { id, branchId: finalBranchId, theme: dataToSave.theme });
  
  // (localStorage backup removed — was causing stale data to override fresh server syncs)

  console.log(`[DB] Saving settings to ${id} (License: ${licenseKey})`, {
    theme: dataToSave.theme,
    taxes: dataToSave.availableTaxes?.length,
    payments: dataToSave.paymentMethods?.length
  });
  await updateData('settings', dataToSave);

  // If we just saved branch settings, also sync core branding/theme + hardware to global_settings
  if (!isGlobal) {
    const updatedGlobal = {
      ...globalRecord,
      id: 'global_settings',
      branchId: null,
      // Branding
      storeName: dataToSave.storeName || globalRecord.storeName,
      storeAddress: dataToSave.storeAddress || globalRecord.storeAddress,
      receiptFooter: dataToSave.receiptFooter || globalRecord.receiptFooter,
      theme: dataToSave.theme || globalRecord.theme,
      // Financial Master Data - MUST PROPOAGATE TO GLOBAL
      availableTaxes: dataToSave.availableTaxes || globalRecord.availableTaxes,
      taxRate: dataToSave.taxRate ?? globalRecord.taxRate,
      paymentMethods: dataToSave.paymentMethods || globalRecord.paymentMethods,
      roundOffEnabled: dataToSave.roundOffEnabled ?? globalRecord.roundOffEnabled,
      // Security - USE CAPTURED VALUES
      settingsLockEnabled: securityToSync.settingsLockEnabled ?? globalRecord.settingsLockEnabled,
      masterPin: securityToSync.masterPin ?? globalRecord.masterPin,
      updatedAt: new Date().toISOString()
    };
    await updateData('settings', updatedGlobal);
  }
}

export async function clearAllSubscriptionRequests() {
  const all = await db.getAll(KEYS.SETTINGS) || [];
  for (const s of all) {
    if (s.subscriptionRequest) {
      delete s.subscriptionRequest;
      await db.put(KEYS.SETTINGS, s);
    }
  }
}

export async function updateSettings(newSettings) {
  const currentBranch = await getCurrentBranch();
  const branchId = currentBranch?.id;
  const current = await getSettings(branchId);
  await saveSettings({ ...current, ...newSettings, branchId });
}

const DEFAULT_BRANCHES = [];
const DEFAULT_USERS = [];

// Session Management
export async function getSession() {
  const sess = await db.get(KEYS.SESSION, 'current');
  return sess ? sess.data : null;
}

export async function setSession(user, branch, registerId = null) {
  console.log('[DB] Setting session:', { user, branch, registerId });
  const existing = await getSession();
  const merged = { 
    user, 
    branch, 
    registerId,
    loginAt: existing?.loginAt,
    sessionId: existing?.sessionId 
  };
  await db.put(KEYS.SESSION, { id: 'current', data: merged });
}

export async function saveSession(sess) {
  await db.put(KEYS.SESSION, { id: 'current', data: sess });
}

// Theme is stored inside the session so each login/user keeps their theme choice.
export async function getSessionTheme() {
  const sess = await getSession();
  return sess ? sess.theme || null : null;
}

export async function setSessionTheme(theme) {
  const session = await getSession();
  const data = session ? { ...session, theme } : { theme };
  await db.put(KEYS.SESSION, { id: 'current', data });
}

export async function getSidebarCollapsed() {
  const res = await db.get(KEYS.SESSION, 'ui_sidebar_collapsed');
  return res ? res.data : false;
}

export async function setSidebarCollapsed(collapsed) {
  await db.put(KEYS.SESSION, { id: 'ui_sidebar_collapsed', data: collapsed });
}


export async function getLabelConfig() {
  const res = await db.get(KEYS.SESSION, 'pos_label_config_v4');
  return res ? res.data : null;
}

export async function saveLabelConfig(config) {
  await db.put(KEYS.SESSION, { id: 'pos_label_config_v4', data: config });
}

export async function clearSession() {
  await db.delete(KEYS.SESSION, 'current');

  // The in-progress cart belongs to the logged-out user's session — if left
  // behind, the next person to log in on this device inherits their cart (Item: cart leaking across logins).
  await db.delete(KEYS.SESSION, 'pos_cart');

  // Bulk-selection checkboxes on the Products page — same leak class, but riskier:
  // the next user could unknowingly bulk-delete/bulk-edit products they never selected.
  try { localStorage.removeItem('pos_selected_products'); } catch (e) {}

  // Also clear license info from settings so the next login starts fresh
  const settings = await getSettings();
  if (settings) {
    let hasUsers = false;
    try {
      const users = await db.getAll(KEYS.USERS) || [];
      hasUsers = users.length > 0;
    } catch (e) {
      console.warn('[clearSession] Failed to read users for safety check:', e);
    }
    // Preserve licenseKey — clearing it corrupts subsequent syncs
    await saveSettings({
      ...settings,
      networkId: 'GLOBAL',
      isInstalled: hasUsers ? !!settings.isInstalled : false
    });
  }
}

// ============================================================
// Login Activity — Track user session history
// ============================================================

export async function getLoginActivity() {
  const records = await db.getAll(KEYS.LOGIN_ACTIVITY) || [];
  return records.sort((a, b) => new Date(b.loginAt) - new Date(a.loginAt));
}

export async function saveLoginActivity(entry) {
  if (!entry.id) entry.id = 'LA-' + Date.now();
  await db.put(KEYS.LOGIN_ACTIVITY, entry);
  return entry;
}

export async function getCurrentUser() {
  const sess = await getSession();
  return sess ? sess.user : null;
}

export async function getCurrentBranch() {
  const sess = await getSession();
  return sess ? sess.branch : null;
}

export async function getCurrentRegisterId() {
  const sess = await getSession();
  return sess ? sess.registerId : null;
}

// Branches
export async function getBranches() {
  return await db.getAll(KEYS.BRANCHES);
}

export async function saveBranch(branch) {
  // Enforce License Limits
  const sync = window.syncEngine;
  const isNew = !branch.id;
  if (sync && isNew) { // Only for new ones
    const limits = sync.getLimits();
    const existingCount = (await getBranches()).length;
    if (existingCount >= limits.maxBranches) {
      const msg = `Branch limit reached (${limits.maxBranches}). Please upgrade to Premium to add more locations.`;
      if (window.showToast) window.showToast(msg, 'error');
      throw new Error(msg);
    }
  }

  branch.id = branch.id || 'B-' + Date.now();
  await updateData('branches', branch);

  // Every branch needs its OWN settings_<branchId> record from day one —
  // without one, getSettings() has nothing branch-specific to merge in, and
  // saveSettings() (which trusts the 'id' it's handed back) silently keeps
  // writing to global_settings forever, even while "switched to" this branch.
  // That made Settings page edits invisibly apply to every branch at once
  // and gave the impression that switching branches did nothing.
  // Fields on the branch record that have a same-meaning counterpart in
  // Settings > General — keep them in sync both ways: editing a branch here
  // is how users expect its Store Name/Address/Phone/Logo to update too, not
  // just the entry in the branches list.
  const branchToSettings = {
    storeName: branch.name,
    storeAddress: branch.address || '',
    storePhone: branch.phone || '',
    ...(branch.image ? { storeLogo: branch.image } : {})
  };

  if (isNew) {
    const globalSettings = await getSettings();
    await saveSettings({ ...globalSettings, ...branchToSettings, id: `settings_${branch.id}`, branchId: branch.id });
  } else {
    const branchSettings = await getSettings(branch.id);
    await saveSettings({ ...branchSettings, ...branchToSettings, id: `settings_${branch.id}`, branchId: branch.id });
  }

  return branch;
}

export async function deleteBranch(id) {
  await deleteData('branches', id);
}

// Users
export async function getUsers() {
  return await db.getAll(KEYS.USERS);
}

export async function saveUser(user) {
  // Enforce License Limits
  const sync = window.syncEngine;
  if (sync && !user.id) { // Only for new ones
    const limits = sync.getLimits();
    const existingCount = (await getUsers()).length;
    if (existingCount >= limits.maxUsers) {
      const msg = `User limit reached (${limits.maxUsers}). Please upgrade to Premium to add more staff members.`;
      if (window.showToast) window.showToast(msg, 'error');
      throw new Error(msg);
    }
  }

  user.id = user.id || 'U-' + Date.now();
  // Only hash when a fresh plaintext value came in — the edit form leaves
  // this field blank (and callers omit it) to mean "keep the current
  // password", and re-hashing an already-hashed value would corrupt it.
  if (user.password && !String(user.password).startsWith('sha256:')) {
    user.password = await hashPassword(user.password);
  }
  await updateData('users', user);
  return user;
}

export async function deleteUser(id) {
  await deleteData('users', id);
}

// Customers
export async function getCustomers(branchId = null) {
  let data = await db.getAll(KEYS.CUSTOMERS) || [];
  if (branchId) data = data.filter(c => (c.branchId || 'b1') === branchId);
  
  const history = await db.getAll(KEYS.LOYALTY_HISTORY) || [];

  return data.map(c => {
    // Audit & Auto-Sync: Points balance should always match history sum
    // This fixes issues where previous bugs might have corrupted the balance field.
    const myHistory = history.filter(h => h.customerId === c.id);
    const calculatedPoints = myHistory.reduce((sum, tx) => {
        return sum + (tx.type === 'Redeem' ? -tx.points : tx.points);
    }, 0);

    // If out of sync, update the source data (silent)
    if (c.loyaltyPoints !== calculatedPoints) {
        c.loyaltyPoints = calculatedPoints;
        // We don't call updateData here to avoid infinite loops, 
        // but the map ensures the UI receives the correct value.
        // The next manual save will persist it.
    }

    return {
        ...c,
        tier: getLoyaltyTier(c.totalSpent || 0)
    };
  });
}

export async function saveCustomer(cust) {
  if (cust.id) {
    // Atomic Update - Merge form changes but preserve critical financial fields
    delete cust.tier; // Tier is calculated dynamically
    return await db.update(KEYS.CUSTOMERS, cust.id, async (existing) => {
      return {
        ...existing,
        ...cust,
        // Crucial: Only update these if they are actually DIFFERENT from existing
        // This handles cases where a form might have stale data
        creditBalance: cust.creditBalance !== undefined ? cust.creditBalance : (existing.creditBalance || 0),
        loyaltyPoints: cust.loyaltyPoints !== undefined ? cust.loyaltyPoints : (existing.loyaltyPoints || 0),
        totalSpent: cust.totalSpent !== undefined ? cust.totalSpent : (existing.totalSpent || 0),
        totalOrders: cust.totalOrders !== undefined ? cust.totalOrders : (existing.totalOrders || 0)
      };
    });
  }

  // New Customer
  cust.id = 'C-' + Date.now();
  if (!cust.createdAt) cust.createdAt = new Date().toISOString();
  cust.loyaltyPoints = cust.loyaltyPoints || 0;
  cust.creditBalance = cust.creditBalance || 0;
  cust.totalSpent = cust.totalSpent || 0;
  cust.totalOrders = cust.totalOrders || 0;
  
  if (!cust.branchId) {
    const cb = await getCurrentBranch();
    cust.branchId = cb?.id || 'b1';
  }
  await db.put(KEYS.CUSTOMERS, cust);
  return cust;
}

export async function deleteCustomer(id) {
  await deleteData('customers', id);
}

export async function awardLoyaltyPoints(customerId, points, orderTotal = 0, orderId = null) {
  const updatedCust = await db.update(KEYS.CUSTOMERS, customerId, async (cust) => {
    cust.loyaltyPoints = (cust.loyaltyPoints || 0) + points;
    cust.totalSpent = (cust.totalSpent || 0) + orderTotal;
    cust.totalOrders = (cust.totalOrders || 0) + 1;
    return cust;
  });

  if (updatedCust) {
    await addLoyaltyTransaction(customerId, 'Earn', points, orderId, `Earned from order ${orderId}`);
  }
  return updatedCust;
}

export async function redeemLoyaltyPoints(customerId, points, orderId = null) {
  let success = false;
  const updatedCust = await db.update(KEYS.CUSTOMERS, customerId, async (cust) => {
    const currentPoints = cust.loyaltyPoints || 0;
    if (currentPoints >= points) {
      cust.loyaltyPoints = currentPoints - points;
      success = true;
    }
    return cust;
  });

  if (success && updatedCust) {
    await addLoyaltyTransaction(customerId, 'Redeem', points, orderId, `Redeemed on order ${orderId}`);
  }
  return success ? updatedCust : null;
}

export function getLoyaltyTier(totalSpent) {
  if (totalSpent >= 15000) return { name: 'Platinum', color: '#10b981', earnRate: 0.02, icon: 'fa-crown' };
  if (totalSpent >= 5000) return { name: 'Gold', color: '#f59e0b', earnRate: 0.015, icon: 'fa-star' };
  return { name: 'Silver', color: '#94a3b8', earnRate: 0.01, icon: 'fa-medal' };
}

async function addLoyaltyTransaction(customerId, type, points, orderId, note) {
  const history = await db.getAll(KEYS.LOYALTY_HISTORY) || [];
  const entry = {
    id: 'LTX-' + Date.now(),
    customerId,
    type, // 'Earn', 'Redeem', 'Adjust'
    points,
    orderId,
    note,
    date: new Date().toISOString()
  };
  await db.put(KEYS.LOYALTY_HISTORY, entry);
}

export async function getLoyaltyHistory(customerId) {
  const history = await db.getAll(KEYS.LOYALTY_HISTORY) || [];
  return history.filter(h => h.customerId === customerId);
}

// Store Credit Management
export async function adjustCustomerCredit(customerId, amount, type, reason, orderId = null) {
  const updatedCust = await db.update(KEYS.CUSTOMERS, customerId, async (cust) => {
    const currentBalance = cust.creditBalance || 0;
    // type: 'Credit' (Add money/deposit), 'Debit' (Spend/Debt)
    if (type === 'Credit') {
        cust.creditBalance = currentBalance + amount;
    } else {
        cust.creditBalance = currentBalance - amount;
    }
    return cust;
  });

  if (updatedCust) {
    const entry = {
      id: 'CRX-' + Date.now(),
      customerId,
      type, // 'Credit', 'Debit'
      amount,
      reason,
      orderId,
      date: new Date().toISOString()
    };
    await db.put(KEYS.CREDIT_HISTORY, entry);
  }
  
  return updatedCust;
}

export async function getCreditHistory(customerId) {
  const history = await db.getAll(KEYS.CREDIT_HISTORY) || [];
  return history.filter(h => h.customerId === customerId);
}

/**
 * Self-healing utility: Restores a customer's creditBalance by summing their history.
 * Used to recover data lost due to race conditions or stale form overwrites.
 */
export async function recalculateCustomerBalance(customerId) {
  const history = await getCreditHistory(customerId);
  const correctBalance = history.reduce((acc, h) => {
    return h.type === 'Credit' ? acc + h.amount : acc - h.amount;
  }, 0);
  
  await db.update(KEYS.CUSTOMERS, customerId, (cust) => {
    cust.creditBalance = correctBalance;
    return cust;
  });
  return correctBalance;
}

// Suppliers
export async function getSuppliers(branchId = null) {
  let data = await db.getAll(KEYS.SUPPLIERS);
  if (branchId) data = data.filter(s => (s.branchId || 'b1') === branchId);
  return data;
}

export async function saveSupplier(sup) {
  sup.id = sup.id || 'S-' + Date.now();
  if (!sup.branchId) {
    const cb = await getCurrentBranch();
    sup.branchId = cb?.id || 'b1';
  }
  await updateData('suppliers', sup);
  return sup;
}

export async function deleteSupplier(id) {
  await deleteData('suppliers', id);
}

// Purchases
export async function getPurchases(branchId = null, startDate = null, endDate = null) {
  const p = await db.getAll(KEYS.PURCHASES) || [];
  return p.filter(x => {
    const isBranchMatch = !branchId || (x.branchId || 'b1') === branchId;
    // See getInventoryLogs() above — compare date-only so today's timestamped
    // purchases aren't wrongly excluded when endDate is today.
    const dateOnly = localDateOnly(x.date);
    const isDateMatch = (!startDate || dateOnly >= startDate) && (!endDate || dateOnly <= endDate);
    return isBranchMatch && isDateMatch;
  });
}

export async function savePurchase(pur) {
  if (!pur.id) pur.id = 'PUR-' + Date.now();
  if (!pur.date) pur.date = new Date().toISOString();
  if (!pur.branchId) {
    const cb = await getCurrentBranch();
    pur.branchId = cb?.id || 'b1';
  }
  await updateData('purchases', pur);
  return pur;
}

export async function deletePurchase(id) {
  await deleteData('purchases', id);
}

// Analytics helpers (Modified for branch filtering if needed)
export async function getTodaySales(branchId = null, startDate = null, endDate = null) {
  const today = new Date().toDateString();
  const currentBranch = await getCurrentBranch();
  const targetBranchId = branchId || currentBranch?.id;
  
  // If NO dates are provided, we default to "Today" logic
  const isDefaultToday = !startDate && !endDate;

  const allOrders = await getOrders();
  const filteredOrders = allOrders.filter(o => {
    const isBranchMatch = (!o.branchId || (targetBranchId && o.branchId === targetBranchId));
    if (!isBranchMatch) return false;
    
    if (isDefaultToday) {
      return new Date(o.date).toDateString() === today;
    } else {
      // See getInventoryLogs() above — compare date-only so today's timestamped
      // orders aren't wrongly excluded when endDate is today.
      const dateOnly = localDateOnly(o.date);
      return (!startDate || dateOnly >= startDate) && (!endDate || dateOnly <= endDate);
    }
  });

  const completedOrders = filteredOrders.filter(o => o.status !== 'cancelled');
  const cancelledOrders = filteredOrders.filter(o => o.status === 'cancelled');

  const returns = await getReturns(targetBranchId);
  const filteredReturns = returns.filter(r => {
      if (r.type !== 'sales') return false;
      if (isDefaultToday) {
          return new Date(r.date).toDateString() === today;
      } else {
          // See getInventoryLogs() above — compare date-only so today's timestamped
          // returns aren't wrongly excluded when endDate is today.
          const dateOnly = localDateOnly(r.date);
          return (!startDate || dateOnly >= startDate) && (!endDate || dateOnly <= endDate);
      }
  });

  const totalReturns = filteredReturns.reduce((sum, r) => sum + (r.total || 0), 0);

  const total = completedOrders.reduce((sum, o) => sum + (o.total || 0), 0) - totalReturns;
  const roundOffTotal = completedOrders.reduce((sum, o) => sum + (o.roundOff || 0), 0);
  
  // Calculate Profit
  let profit = 0;
  completedOrders.forEach(o => {
    (o.items || []).forEach(i => {
      const discountedItemPrice = i.price - (i.itemDiscount || 0);
      const itemProfit = (discountedItemPrice - (i.costPrice || 0)) * i.qty;
      profit += itemProfit;
    });
  });
  
  filteredReturns.forEach(r => {
    (r.items || []).forEach(i => {
      const discountedItemPrice = i.price - (i.itemDiscount || 0);
      const itemProfit = (discountedItemPrice - (i.costPrice || 0)) * i.qty;
      profit -= itemProfit;
    });
  });

  return {
    orders: completedOrders,
    total,
    grossTotal: completedOrders.reduce((sum, o) => sum + (o.total || 0), 0),
    profitTotal: profit,
    returnsTotal: totalReturns,
    roundOffTotal,
    count: completedOrders.length,
    cancelledCount: cancelledOrders.length
  };
}

export async function getSalesLast7Days(branchId = null) {
  const days = [];
  const returns = await getReturns(branchId);
  const allReturns = returns.filter(r => r.type === 'sales');
  const allOrders = await getOrders(branchId);
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const label = d.toLocaleDateString('en', { weekday: 'short' });
    const dateStr = d.toDateString();
    const orders = allOrders.filter(o =>
      new Date(o.date).toDateString() === dateStr && o.status !== 'cancelled'
    );
    const dayReturnsTotal = allReturns.filter(r => new Date(r.date).toDateString() === dateStr).reduce((sum, r) => sum + (r.total || 0), 0);
    const total = orders.reduce((sum, o) => sum + (o.total || 0), 0) - dayReturnsTotal;
    days.push({ label, total, count: orders.length });
  }
  return days;
}

// Shared by getTopProducts()/getDailySalesBreakdown() — an item's discount can be a flat ₹
// amount or a % of the line, matching store.js's getCartTotals() discountTotal formula.
function computeItemRevenueAndProfit(item) {
  const baseLineTotal = (item.price || 0) * (item.qty || 0);
  const discountAmt = item.itemDiscountType === 'pct'
    ? (baseLineTotal * (item.itemDiscount || 0) / 100)
    : ((item.itemDiscount || 0) * (item.qty || 0));
  const revenue = baseLineTotal - discountAmt;
  const cost = (item.costPrice || 0) * (item.qty || 0);
  return { revenue, profit: revenue - cost };
}

export async function getTopProducts(branchId = null, startDate = null, endDate = null) {
  const allOrders = await getOrders(branchId, startDate, endDate);
  const orders = allOrders.filter(o => o.status !== 'cancelled');
  const allRet = await getReturns(branchId, startDate, endDate);
  const returns = allRet.filter(r => r.type === 'sales');
  const productMap = {};
  orders.forEach(order => {
    order.items.forEach(item => {
      if (!productMap[item.name]) productMap[item.name] = { name: item.name, qty: 0, revenue: 0, emoji: item.emoji, profit: 0 };
      const { revenue, profit } = computeItemRevenueAndProfit(item);
      productMap[item.name].qty += item.qty;
      productMap[item.name].revenue += revenue;
      productMap[item.name].profit += profit;
    });
  });
  // Subtract returns — always ensure the product's entry exists first (like
  // getDailySalesBreakdown's ensureDay pattern below), not gated on it
  // already existing from an order in THIS same window. A product sold last
  // month and returned this month has its return correctly date-filtered
  // into `returns`, but was previously silently dropped here because
  // there was no matching order in range to net it against — overstating
  // this window's qty/revenue/profit for that product.
  returns.forEach(ret => {
    ret.items.forEach(item => {
      if (!productMap[item.name]) productMap[item.name] = { name: item.name, qty: 0, revenue: 0, emoji: item.emoji, profit: 0 };
      const { revenue, profit } = computeItemRevenueAndProfit(item);
      productMap[item.name].qty -= item.qty;
      productMap[item.name].revenue -= revenue;
      productMap[item.name].profit -= profit;
    });
  });
  return Object.values(productMap).sort((a, b) => b.qty - a.qty).slice(0, 5);
}

// Day-by-day Sales (gross receipts, tax-inclusive — what actually came in) and Profit
// (revenue excl. tax minus cost of goods, via computeItemRevenueAndProfit) for a date range.
export async function getDailySalesBreakdown(branchId = null, startDate = null, endDate = null) {
  const allOrders = await getOrders(branchId, startDate, endDate);
  const orders = allOrders.filter(o => o.status !== 'cancelled');
  const allReturns = await getReturns(branchId, startDate, endDate);
  const salesReturns = allReturns.filter(r => r.type === 'sales');

  const dayMap = {};
  const ensureDay = (dateStr) => (dayMap[dateStr] ||= { date: dateStr, sales: 0, profit: 0, orders: 0 });

  orders.forEach(order => {
    const day = ensureDay(localDateOnly(order.date));
    day.sales += order.total || 0;
    day.orders += 1;
    (order.items || []).forEach(item => {
      day.profit += computeItemRevenueAndProfit(item).profit;
    });
  });

  salesReturns.forEach(ret => {
    const day = ensureDay(localDateOnly(ret.date));
    day.sales -= ret.total || 0;
    (ret.items || []).forEach(item => {
      day.profit -= computeItemRevenueAndProfit(item).profit;
    });
  });

  return Object.values(dayMap).sort((a, b) => b.date.localeCompare(a.date));
}

// Groups orders that had a delivery vehicle recorded at checkout (CheckoutService.js's
// "Delivery Vehicle (optional)" field) by vehicle number, for a date range.
export async function getVehicleDeliveryReport(branchId = null, startDate = null, endDate = null) {
  const allOrders = await getOrders(branchId, startDate, endDate);
  const orders = allOrders.filter(o => o.status !== 'cancelled' && (o.deliveryVehicle || '').trim());

  const vehicleMap = {};
  orders.forEach(order => {
    const vehicle = order.deliveryVehicle.trim();
    if (!vehicleMap[vehicle]) vehicleMap[vehicle] = { vehicle, deliveries: 0, totalValue: 0, orders: [] };
    vehicleMap[vehicle].deliveries += 1;
    vehicleMap[vehicle].totalValue += order.total || 0;
    vehicleMap[vehicle].orders.push({ id: order.id, dailyNumber: order.dailyNumber, date: order.date, total: order.total || 0 });
  });

  return Object.values(vehicleMap).sort((a, b) => b.deliveries - a.deliveries);
}

// Groups purchases with an unpaid balance (total - amountPaid > 0) by supplier — money the
// shop still owes, not to be confused with the customer-side "Credit Hub" (money owed TO
// the shop from credit sales).
export async function getSupplierOutstandingReport(branchId = null, startDate = null, endDate = null) {
  const allPurchases = await getPurchases(branchId, startDate, endDate);

  const supplierMap = {};
  allPurchases.forEach(p => {
    const outstanding = Math.max(0, (p.total || 0) - (p.amountPaid || 0));
    if (outstanding <= 0.01) return;
    const key = p.supplierId || p.supplierName || 'unknown';
    if (!supplierMap[key]) supplierMap[key] = { supplierName: p.supplierName || 'Unknown Supplier', purchaseCount: 0, totalPurchased: 0, totalPaid: 0, outstanding: 0, purchases: [] };
    supplierMap[key].purchaseCount += 1;
    supplierMap[key].totalPurchased += p.total || 0;
    supplierMap[key].totalPaid += p.amountPaid || 0;
    supplierMap[key].outstanding += outstanding;
    supplierMap[key].purchases.push({ id: p.id, date: p.date, supplierInvoiceNo: p.supplierInvoiceNo, total: p.total || 0, amountPaid: p.amountPaid || 0, outstanding });
  });

  return Object.values(supplierMap).sort((a, b) => b.outstanding - a.outstanding);
}

export async function getPurchasesMonthly() {
  const purchases = await getPurchases();
  const months = {};
  purchases.forEach(p => {
    const d = new Date(p.date);
    const m = d.toLocaleString('en', { month: 'short', year: 'numeric' });
    months[m] = (months[m] || 0) + (p.total || 0);
  });
  return Object.entries(months).map(([label, total]) => ({ label, total }));
}

export const DEFAULT_LOW_STOCK_THRESHOLD = 10;

/**
 * Single source of truth for "is this stock level low" — every low-stock
 * badge/filter/report in the app must call this instead of hardcoding a
 * plain `stock > 10` check, otherwise a product with its own `minStock` set
 * shows a different status on different screens (Dashboard/POS said "low",
 * Products/Catalog/Reports said "in stock", because they ignored minStock).
 */
export function getStockStatus(stock, minStock) {
  const s = Number(stock) || 0;
  const threshold = (minStock != null && minStock > 0) ? minStock : DEFAULT_LOW_STOCK_THRESHOLD;
  if (s <= 0) return 'out';
  if (s <= threshold) return 'low';
  return 'in';
}

export async function getLowStockProducts(branchId = null) {
  const products = await getProducts(branchId);
  return products.filter(p => {
    if (p.variants && p.variants.length > 0) {
      return p.variants.some(v => getStockStatus(v.stock, v.minStock) !== 'in');
    }
    return getStockStatus(p.stock, p.minStock) !== 'in';
  });
}

// Parses a "YYYY-MM-DD" date-only string as LOCAL midnight — the native Date
// constructor treats bare date strings as UTC midnight, which silently shifts
// the result by a whole day in any timezone ahead of UTC (e.g. IST) when
// compared against a locally-computed "today".
function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Flags products already past their expiryDate, or expiring within `warningDays` —
// mirrors getLowStockProducts()'s "at or below threshold" warning-zone shape.
export async function getExpiringProducts(branchId = null, warningDays = 7) {
  const products = await getProducts(branchId);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const warningCutoff = new Date(todayStart);
  warningCutoff.setDate(warningCutoff.getDate() + warningDays);

  return products
    .filter(p => p.expiryDate)
    .map(p => {
      const expiry = parseLocalDate(p.expiryDate);
      const daysLeft = Math.round((expiry - todayStart) / (1000 * 60 * 60 * 24));
      return { ...p, daysLeft };
    })
    .filter(p => parseLocalDate(p.expiryDate) <= warningCutoff)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

export async function getCategorySales(branchId = null, startDate = null, endDate = null) {
  const allOrders = await getOrders(branchId, startDate, endDate);
  const orders = allOrders.filter(o => o.status !== 'cancelled');
  const allRet = await getReturns(branchId, startDate, endDate);
  const returns = allRet.filter(r => r.type === 'sales');
  const catMap = {};
  orders.forEach(order => {
    order.items.forEach(item => {
      const cat = item.category || 'Uncategorized';
      if (!catMap[cat]) catMap[cat] = { category: cat, qty: 0, revenue: 0 };
      catMap[cat].qty += item.qty;
      catMap[cat].revenue += (item.price * item.qty);
    });
  });
  // Subtract returns — same fix as getTopProducts above: ensure the
  // category's entry exists before subtracting instead of gating on it
  // already existing from an order in this same window, so a return whose
  // original sale falls outside this date range still nets correctly
  // instead of being silently dropped.
  returns.forEach(ret => {
    ret.items.forEach(item => {
      const cat = item.category || 'Uncategorized';
      if (!catMap[cat]) catMap[cat] = { category: cat, qty: 0, revenue: 0 };
      catMap[cat].qty -= item.qty;
      catMap[cat].revenue -= (item.price * item.qty);
    });
  });
  return Object.values(catMap).sort((a, b) => b.revenue - a.revenue);
}

export async function getMonthlySales(branchId = null, startDate = null, endDate = null) {
  const allOrders = await getOrders(branchId, startDate, endDate);
  const orders = allOrders.filter(o => o.status !== 'cancelled');
  const allRet = await getReturns(branchId, startDate, endDate);
  const returns = allRet.filter(r => r.type === 'sales');
  const months = {};
  orders.forEach(o => {
    const d = new Date(o.date);
    const m = d.toLocaleString('en', { month: 'short', year: 'numeric' });
    months[m] = (months[m] || 0) + (o.total || 0);
  });
  // Subtract returns
  returns.forEach(r => {
    const d = new Date(r.date);
    const m = d.toLocaleString('en', { month: 'short', year: 'numeric' });
    months[m] = (months[m] || 0) - (r.total || 0);
  });
  return Object.entries(months).map(([label, total]) => ({ label, total }));
}

export async function getInstantSalesData(branchId = null, startDate = null, endDate = null) {
  const allOrders = await getOrders(branchId, startDate, endDate);
  const orders = allOrders.filter(o => o.status !== 'cancelled');
  const allRet = await getReturns(branchId, startDate, endDate);
  const returns = allRet.filter(r => r.type === 'sales');
  
  let totalRevenue = 0;
  let totalOrdersCount = 0;
  const instantItemsSold = [];

  orders.forEach(order => {
    let hasInstant = false;
    order.items.forEach(item => {
      const isCustom = item.isInstant === true || 
                       item.category === 'Custom' || 
                       (item.id && typeof item.id === 'string' && item.id.startsWith('custom-'));
      
      if (isCustom) {
        const itemRevenue = item.price * item.qty;
        totalRevenue += itemRevenue;
        instantItemsSold.push({
          date: order.date,
          orderId: order.id,
          name: item.name,
          price: item.price,
          qty: item.qty,
          revenue: itemRevenue,
          customer: order.customer?.name || 'Walk-in'
        });
        hasInstant = true;
      }
    });
    if (hasInstant) totalOrdersCount++;
  });

  // Handle returns for Custom category
  returns.forEach(ret => {
    ret.items.forEach(item => {
      const isCustom = item.isInstant === true || 
                       item.category === 'Custom' || 
                       (item.id && typeof item.id === 'string' && item.id.startsWith('custom-'));
      if (isCustom) {
        totalRevenue -= (item.price * item.qty);
      }
    });
  });

  return {
    totalRevenue,
    totalOrdersCount,
    items: instantItemsSold.sort((a, b) => new Date(b.date) - new Date(a.date))
  };
}

// ============================================================
// Register / Shift Management
// ============================================================
export async function getRegisters() {
  return await db.getAll(KEYS.REGISTERS) || [];
}

export async function getShifts() {
  return await db.getAll(KEYS.SHIFTS) || [];
}

export async function getCurrentShift(branchId, registerId = null) {
  const shifts = await getShifts();
  const rid = registerId || await getCurrentRegisterId();
  const shift = shifts.find(s => s.branchId === branchId && (rid ? s.registerId === rid : true) && s.status === 'Open') || null;
  return shift;
}

export async function isRegisterOpen(branchId, registerId = null) {
  const settings = await getSettings();
  if (!settings.enableRegisterRoutine) return true;

  const branchRegs = await getBranchRegisters(branchId);
  if (branchRegs.length === 0) return true;

  // Use the specific ID if provided, otherwise grab from session
  const rid = registerId || await getCurrentRegisterId();
  const shift = await getCurrentShift(branchId, rid);

  return !!shift;
}

export async function openRegister(branchId, userId, openingBalance, registerId = null, openingNotes = '') {
  const rid = registerId || await getCurrentRegisterId();
  const newShift = {
    id: 'SHIFT-' + Date.now(),
    branchId,
    registerId: rid,
    openedBy: userId,
    openedAt: new Date().toISOString(),
    openingBalance: Number(openingBalance),
    openingNotes: openingNotes || '',
    cashSales: 0,
    cardSales: 0,
    upiSales: 0,
    walletSales: 0,
    creditSales: 0,
    returns: 0,
    expenses: 0,
    withdrawals: 0,
    status: 'Open',
    updatedAt: new Date().toISOString()
  };
  await updateData('shifts', newShift);
  return newShift;
}

export async function closeRegister(shiftId, closingBalance, notes) {
  const shifts = await getShifts();
  const shift = shifts.find(s => s.id === shiftId);
  if (!shift) return null;

  shift.status = 'Closed';
  shift.closedAt = new Date().toISOString();
  shift.closingBalance = Number(closingBalance);
  shift.notes = notes;

  // Calculate actual totals from orders during shift
  const orders = (await getOrders(shift.branchId)).filter(o =>
    new Date(o.date) >= new Date(shift.openedAt) &&
    new Date(o.date) <= new Date(shift.closedAt)
  );

  shift.sales = orders.reduce((sum, o) => sum + (o.total || 0), 0);

  // Calculate cash sales and other collections
  shift.cashSales = orders.reduce((sum, o) => {
    if (o.payments) {
      return sum + o.payments.filter(p => p.method?.toLowerCase() === 'cash').reduce((s, p) => s + p.amount, 0);
    }
    return sum + (o.paymentMethod?.toLowerCase() === 'cash' ? o.total : 0);
  }, 0);

  // Recalculate all collections dynamically
  const collections = {};
  orders.forEach(o => {
    if (o.payments && o.payments.length > 0) {
      o.payments.forEach(p => {
        const method = p.method || 'Cash';
        collections[method] = (collections[method] || 0) + p.amount;
      });
      const totalPaid = o.payments.reduce((s, p) => s + p.amount, 0);
      const remaining = (o.total || 0) - totalPaid;
      if (remaining > 0.01) {
        collections['Credit'] = (collections['Credit'] || 0) + remaining;
      }
    } else {
      const m = o.paymentMethod || 'Cash';
      collections[m] = (collections[m] || 0) + (o.total || 0);
    }
  });
  shift.collections = collections;
  shift.ordersCount = orders.length;

  shift.updatedAt = new Date().toISOString();
  await updateData('shifts', shift);
  return shift;
}

export async function updateShiftSales(branchId, amount, paymentData, registerId = null, isReturn = false, isDebtSettlement = false) {
  const rid = registerId || await getCurrentRegisterId();
  const shift = await getCurrentShift(branchId, rid);
  if (!shift) return;

  if (!isDebtSettlement) {
    shift.sales = (shift.sales || 0) + amount;
    if (!isReturn) shift.ordersCount = (shift.ordersCount || 0) + 1;
  }

  if (!shift.collections) shift.collections = {};

  // Handle payments array or single paymentMethod string
  const paymentEntries = Array.isArray(paymentData) ? paymentData : [{ method: paymentData || 'Cash', amount }];

  paymentEntries.forEach(p => {
    const method = p.method || 'Cash';
    const pAmt = p.amount;
    
    // Dynamically update collection for this method
    shift.collections[method] = (shift.collections[method] || 0) + pAmt;

    if (method.toLowerCase() === 'cash') {
      shift.cashSales = (shift.cashSales || 0) + pAmt;
    }
  });

  shift.updatedAt = new Date().toISOString();
  await updateData('shifts', shift);
}

export async function addShiftTransaction(branchId, type, amount, reason, registerId = null) {
  const rid = registerId || await getCurrentRegisterId();
  const shift = await getCurrentShift(branchId, rid);
  if (!shift) return;

  if (!shift.transactions) shift.transactions = [];

  shift.transactions.push({
    id: 'TXN-' + Date.now(),
    type, // 'In' or 'Out'
    amount: Number(amount),
    reason,
    timestamp: new Date().toISOString()
  });

  shift.updatedAt = new Date().toISOString();
  await updateData('shifts', shift);
}

// Branch Registers (Static defaults removed)

export async function getBranchRegisters(branchId = null) {
  let data = await db.getAll(KEYS.REGISTERS) || [];
  // Same (branchId || 'b1') fallback getProducts/getCustomers/getSuppliers/
  // getOrders/getStaffIncentives already use — without it, a legacy/imported
  // register record missing its own branchId would silently vanish from
  // this view (while still showing up wherever that fallback is applied).
  if (branchId) return data.filter(r => (r.branchId || 'b1') === branchId);
  return data;
}

export async function saveBranchRegister(reg) {
  // Enforce License Limits
  const sync = window.syncEngine;
  if (sync && !reg.id) { // Only for new ones
    const limits = sync.getLimits();
    const existing = await getBranchRegisters(reg.branchId);
    if (existing.length >= limits.maxRegistersPerBranch) {
      const msg = `Register limit reached (${limits.maxRegistersPerBranch}). Please upgrade to Premium to add more.`;
      if (window.showToast) window.showToast(msg, 'error');
      throw new Error(msg);
    }
  }

  if (!reg.id) {
    reg.id = 'reg-' + Date.now();
    reg.createdAt = new Date().toISOString();
  }
  await updateData('registers', reg);
  return reg;
}

export async function deleteBranchRegister(id) {
  await deleteData('registers', id);
}

// ============================================================
// Staff (Saloon specific)
// ============================================================

export async function getStaff(branchId = null) {
  const staff = await db.getAll(KEYS.STAFF) || [];
  if (branchId) return staff.filter(s => (s.branchId || 'b1') === branchId);
  return staff;
}

export async function saveStaff(staff) {
  staff.id = staff.id || 'ST-' + Date.now();
  await updateData('staff', staff);
  return staff;
}

export async function deleteStaff(id) {
  await deleteData('staff', id);
}

// Staff Incentives
export async function getStaffIncentives(branchId = null, startDate = null, endDate = null) {
  const incs = await db.getAll(KEYS.STAFF_INCENTIVES) || [];
  return incs.filter(i => {
    const isBranchMatch = !branchId || (i.branchId || 'b1') === branchId;
    // See getInventoryLogs() above — compare date-only so today's timestamped
    // incentive records aren't wrongly excluded when endDate is today.
    const dateOnly = localDateOnly(i.date);
    const isDateMatch = (!startDate || dateOnly >= startDate) && (!endDate || dateOnly <= endDate);
    return isBranchMatch && isDateMatch;
  });
}

export async function saveStaffIncentive(inc) {
  inc.id = inc.id || 'INC-' + Date.now();
  inc.date = inc.date || new Date().toISOString();
  await updateData('staff_incentives', inc);
  return inc;
}

// ============================================================
// Appointments (Saloon specific)
// ============================================================

export async function getAppointments(branchId = null) {
  const appos = await db.getAll(KEYS.APPOINTMENTS) || [];
  if (branchId) return appos.filter(a => a.branchId === branchId);
  return appos;
}

export async function saveAppointment(appo) {
  if (!appo.id) {
    appo.id = 'APP-' + Date.now();
    appo.createdAt = new Date().toISOString();
  }
  await updateData('appointments', appo);
  return appo;
}

export async function updateAppointmentStatus(id, status) {
  const all = await getAppointments();
  const appo = all.find(a => a.id === id);
  if (appo) {
    appo.status = status;
    await updateData('appointments', appo);
  }
}

export async function deleteAppointment(id) {
  await deleteData('appointments', id);
}

export async function completeInstallation({ businessName, businessAddress, businessType, adminName, adminPassword, adminPin, email, loadSampleData, branchId: providedBranchId, adminId: providedAdminId }) {
  // Every onboarding run starts from a clean local database — otherwise the
  // fresh admin/branch/settings written below would land on top of whatever
  // IndexedDB still had from a previous install on this machine/profile.
  await db.resetDatabase();

  const settings = await getSettings();
  settings.storeName = businessName || 'My Store';
  settings.storeAddress = businessAddress || 'Main Branch';
  settings.businessType = businessType || 'Others';
  settings.email = email || '';
  settings.isInstalled = true;
  settings.installationDate = settings.installationDate || new Date().toISOString();

  // Fix this device's local-hub identity ONCE, right here, so every store
  // (branches/users/registers/etc.) partitions under exactly one key for the
  // lifetime of this install. Historically this drifted — login responses,
  // the hub's WS echo, and a couple of self-heal paths could each assign a
  // DIFFERENT licenseKey after install, silently fragmenting this same
  // device's data into multiple "tenants" in MongoDB (same branch showing up
  // twice under two keys). Generating and locking it in at install time,
  // before anything else can race to assign one, removes that entire bug class.
  settings.licenseKey = settings.licenseKey || await getDeviceId();
  settings.networkId = settings.licenseKey;

  // 1. Create Default Branch
  const branchId = providedBranchId || 'b1';
  settings.branchId = branchId; // Persist branchId for sync engine

  // Save Global Settings
  await saveSettings({ ...settings, id: 'global_settings', branchId: null });

  // Also initialize Branch-Specific Settings
  await saveSettings({ ...settings, id: `settings_${branchId}`, branchId });

  const newBranch = {
    id: branchId,
    name: (businessName || 'My Store') + ' (Main)',
    address: businessAddress || 'Main Branch',
    isMainBranch: true, // The install-time branch — protected from edit/delete in Branches.js
    createdAt: new Date().toISOString()
  };
  await updateData('branches', newBranch);

  // 2. Create Default Register (24-char ObjectID) — but only if this branch
  // doesn't already have one. completeInstallation() can legitimately run
  // more than once for the same branchId (e.g. checkElectronInstallState()
  // briefly reporting "not installed" after a Mongo hiccup and the onboarding
  // flow being re-completed) — without this guard, each re-run created a
  // brand-new "Main Counter" register with a fresh ObjectId while the old
  // one was never removed, silently accumulating duplicate registers that
  // then ate into the branch's actual register-limit quota.
  const existingRegisters = await getBranchRegisters(branchId);
  const registerId = existingRegisters.length > 0 ? existingRegisters[0].id : generateObjectId();
  const newRegister = {
    id: registerId,
    name: 'Main Counter',
    branchId: branchId,
    createdAt: new Date().toISOString()
  };
  await updateData('registers', newRegister);

  // 3. Create Admin User
  const defaultAdminId = settings.licenseKey ? `admin-${settings.licenseKey}` : generateObjectId();
  const adminId = providedAdminId || defaultAdminId;
  const adminUser = {
    id: adminId,
    name: adminName || 'Administrator',
    username: adminName || 'admin', // Use provided adminName
    email: email || '',
    password: await hashPassword(adminPassword || '123'),
    pin: adminPin || '1234',
    role: 'Super Admin',
    branchId: branchId, // Linked to the branch ObjectID
    maxDevices: 5, // Default device limit
    createdAt: new Date().toISOString()
  };
  await updateData('users', adminUser);

  // 4. Create Default Walkin Customer & Anonymous Supplier
  const walkinCustomer = {
    id: 'walkin',
    name: 'Walkin-Customer',
    phone: '',
    email: '',
    address: '',
    loyaltyPoints: 0,
    totalSpent: 0,
    totalOrders: 0,
    branchId: branchId, // Though typically global, we link it for consistency
    createdAt: new Date().toISOString()
  };
  await updateData('customers', walkinCustomer);

  const anonymousSupplier = {
    id: 'anon-sup',
    name: 'Anonymous Supplier',
    phone: '',
    email: '',
    address: '',
    branchId: branchId,
    createdAt: new Date().toISOString()
  };
  await updateData('suppliers', anonymousSupplier);

  // 5. Save initial session
  await setSession(adminUser, newBranch, registerId);

  // 6. Load Sample Data properly if requested
  if (loadSampleData) {
    await importIndustryProducts(businessType || 'Others', branchId);
  }

  return { user: adminUser, branch: newBranch, register: newRegister };
}

/**
 * Electron-specific: is this device already installed?
 *
 * The local Mongo hub (always local for Electron — see electron/main.cjs) is
 * the durable, authoritative record — checked live on every call, never from
 * a cached flag, so that if the local users collection is emptied (data
 * reset, DB dropped, reinstall) the app reliably falls back to the Install
 * screen even if IndexedDB still remembers a previous "installed" state.
 * Only when the hub can't be reached at all (still starting up) do we fall
 * back to trusting the local IndexedDB record.
 */
export async function checkElectronInstallState() {
  const isElectron = /Electron/i.test(navigator.userAgent);
  if (!isElectron) return false;

  try {
    const response = await fetch('http://127.0.0.1:3030/api/install-check', {
      signal: AbortSignal.timeout(4000)
    });
    if (response.ok) {
      const data = await response.json();
      if (data.dbConnected !== false) {
        if (data.hasUsers) {
          console.log('[InstallCheck] Local Mongo hub has an admin user. Marking installed.');
          await updateSettings({ isInstalled: true });
          return true;
        }
        // Hub reachable and confirmed empty — genuinely fresh/reset install.
        // Clear any stale cached flag so other code reading settings directly
        // (e.g. router.js) also sees the correct state.
        await updateSettings({ isInstalled: false });
        return false;
      }
    }
  } catch (e) {
    console.warn('[InstallCheck] Local hub not reachable yet, falling back to local record:', e.message);
  }

  // Hub unreachable/still starting — fall back to the local IndexedDB record
  // so a slow-starting hub doesn't force onboarding on an already-set-up device.
  try {
    const users = await db.getAll(KEYS.USERS) || [];
    if (users.length > 0) {
      console.log('[InstallCheck] Hub unreachable, but local user record found. Restoring isInstalled state.');
      await updateSettings({ isInstalled: true });
      return true;
    }
  } catch (e) {
    console.warn('[InstallCheck] Failed to check for existing local users:', e);
  }

  return false; // No local record — fresh/reset install, onboarding required.
}

// Passwords are stored as `sha256:<salt>:<hash>` (Web Crypto — the only
// crypto API available in a renderer/browser context, no Node 'crypto' here).
// verifyPassword still accepts a bare plaintext `stored` value so accounts
// created before this existed keep working; a successful match against one
// of those migrates it to a hash on the spot (see verifyLocalUser below).
export async function hashPassword(plain) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(saltBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(saltHex + plain));
  const hashHex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `sha256:${saltHex}:${hashHex}`;
}

export async function verifyPassword(plain, stored) {
  if (!stored || plain == null) return false;
  if (typeof stored !== 'string' || !stored.startsWith('sha256:')) {
    return stored === plain; // legacy plaintext record
  }
  const [, saltHex, hashHex] = stored.split(':');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(saltHex + plain));
  const computedHex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  return computedHex === hashHex;
}

/**
 * Local credential verification for Standalone mode
 */
export async function verifyLocalUser(username, password) {
  const users = await db.getAll(KEYS.USERS) || [];
  const staff = await db.getAll(KEYS.STAFF) || [];
  const all = [...users, ...staff];

  const candidates = all.filter(u => u.email === username || u.username === username);
  for (const user of candidates) {
    if (await verifyPassword(password, user.password)) {
      // Migrate a legacy plaintext record to a hash now that it's proven correct.
      if (typeof user.password === 'string' && !user.password.startsWith('sha256:')) {
        user.password = await hashPassword(password);
        await updateData(users.includes(user) ? 'users' : 'staff', user);
      }
      const branches = await getBranches();
      const registers = await db.getAll(KEYS.REGISTERS) || [];
      return { success: true, user, branches, registers };
    }
  }
  return { success: false, message: 'Invalid local credentials' };
}

// ============================================================
// Sync / Identity Helpers
// ============================================================

export async function getDeviceId() {
  const existing = await db.get(KEYS.SESSION, 'pos_identity_id');
  if (existing) return existing.val;

  const id = 'POS-' + Math.random().toString(36).substring(2, 9).toUpperCase();
  await db.put(KEYS.SESSION, { id: 'pos_identity_id', val: id });
  return id;
}

export async function getDataById(store, id) {
  const key = KEYS[store.toUpperCase()];
  if (!key) {
    console.warn(`getDataById: Store '${store}' not found in KEYS.`);
    return null;
  }
  // Try exact match first
  let res = await db.get(key, id);
  if (res) return res;

  // Try String conversion
  res = await db.get(key, String(id));
  if (res) return res;

  // Try Number conversion if possible
  const numId = Number(id);
  if (!isNaN(numId)) {
    res = await db.get(key, numId);
    if (res) return res;
  }

  return null;
}

export async function updateData(store, data, isSilent = false) {
  const key = KEYS[store.toUpperCase()];
  if (!key) return;

  // ─── ID NORMALIZATION ───
  // PostgreSQL uses TEXT for record_id, and IndexedDB treats 123 !== "123".
  // We force all IDs to strings to prevent duplication during sync round-trips.
  // If the record's CURRENT stored key is still a raw number (legacy
  // autoIncrement-assigned ids from before this normalization existed),
  // coercing `.id` to a string here makes `db.put()` INSERT a brand-new
  // string-keyed record rather than update the existing number-keyed one —
  // IndexedDB treats them as different keys — silently orphaning the
  // original with stale data forever. Delete the old numeric-keyed record
  // once the normalized write lands, so the update actually takes effect.
  let legacyNumericId = null;
  if (data && data.id != null && typeof data.id !== 'string') {
    legacyNumericId = data.id;
    data.id = String(data.id);
  }

  // Update timestamp for sorting (edited items move to top)
  if (!isSilent) {
    const sortableStores = ['products', 'customers', 'suppliers', 'staff', 'users', 'categories', 'sub_categories', 'branches', 'purchases', 'orders', 'returns', 'settings'];
    if (sortableStores.includes(store.toLowerCase())) {
        data.updatedAt = new Date().toISOString();
        // Also mark for sync if applicable
        const syncStores = ['orders', 'returns', 'settings', 'backup_history', 'import_history', 'inventory_logs'];
        if (syncStores.includes(store.toLowerCase())) {
          data.isSynced = false;
        } else {
          data.isSynced = true;
        }
    }
  }

  // Defensive check for Promises in data object
  if (data instanceof Promise) {
    console.warn(`[updateData] Data itself is a Promise for store "${store}"! Awaiting...`);
    data = await data;
  }

  if (data && typeof data === 'object') {
    for (const [k, v] of Object.entries(data)) {
      if (v instanceof Promise) {
        console.warn(`[updateData] Key "${k}" in store "${store}" is a Promise! Awaiting...`);
        data[k] = await v;
      }
    }
  }

  try {
    await db.put(key, data); // Fix: MUST use 'key' (physical store), NOT 'store' (logical name)
  } catch (err) {
    if (err.name === 'DataCloneError') {
      console.error('[updateData] DataCloneError! Object contains non-serializable data:', data);
    }
    throw err;
  }

  // Remove the orphaned original numeric-keyed record now that the
  // normalized string-keyed version has landed (see ID NORMALIZATION above).
  if (legacyNumericId !== null) {
    await db.delete(key, legacyNumericId).catch(() => {});
  }

  if (!isSilent) {
    window.dispatchEvent(new CustomEvent('storage-change', {
      detail: { type: 'update', store, data }
    }));
  }
}

export async function deleteData(store, id, isSilent = false) {
  const key = KEYS[store.toUpperCase()];
  if (!key) return;

  // ── TOMBSTONE: Record the deletion so pos_full_state won't resurrect this record ──
  // The tombstone key is store:id. It expires after 24 hours.
  try {
    const tombstoneKey = `${store}:${id}`;
    await db.put(KEYS.DELETED_TOMBSTONES, {
      id: tombstoneKey,
      store,
      recordId: String(id),
      deletedAt: new Date().toISOString()
    });
  } catch (e) {
    // Non-fatal: tombstone failure must not block the actual delete
    console.warn('[DB] Tombstone write failed:', e);
  }

  // IndexedDB is strictly typed. An ID of `103` (number) cannot be deleted with `"103"` (string).
  // We explicitly try to delete both representations to ensure it is actually removed locally.
  await db.delete(key, id);
  await db.delete(key, String(id));
  const numId = Number(id);
  if (!isNaN(numId)) {
    await db.delete(key, numId);
  }

  if (!isSilent) {
    window.dispatchEvent(new CustomEvent('storage-change', {
      detail: { type: 'delete', store, data: { id } }
    }));
  }
}

/**
 * Returns a Set of tombstone keys in the format "store:id"
 * for all records deleted within the last 24 hours.
 */
export async function getDeletedTombstones() {
  const tombstones = await db.getAll(KEYS.DELETED_TOMBSTONES) || [];
  const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours
  const result = new Set();
  for (const t of tombstones) {
    if (new Date(t.deletedAt).getTime() > cutoff) {
      result.add(t.id); // Format: "store:id"
    }
  }
  return result;
}

/**
 * Removes expired tombstones (older than 24 hours).
 * Called automatically when pos_full_state is applied.
 */
export async function clearExpiredTombstones() {
  const tombstones = await db.getAll(KEYS.DELETED_TOMBSTONES) || [];
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const t of tombstones) {
    if (new Date(t.deletedAt).getTime() <= cutoff) {
      await db.delete(KEYS.DELETED_TOMBSTONES, t.id);
    }
  }
}

/**
 * Clear all records in a store (used to replace with fresh cloud data)
 */
export async function clearStore(store, isSilent = true) {
  const key = KEYS[store.toUpperCase()];
  if (!key) return;

  await db.clear(key);
  if (!isSilent) {
    window.dispatchEvent(new CustomEvent('storage-change', {
      detail: { type: 'clear', store }
    }));
  }
}

// Initialization logic moved to DbService.performMigration or handled on app start

// Hierarchical Category Management
export async function getCategories() {
  return await db.getAll(KEYS.CATEGORIES) || [];
}

export async function saveCategory(cat) {
  if (!cat.id) cat.id = 'cat-' + Date.now();
  await updateData('categories', cat);
  return cat;
}

export async function deleteCategory(id) {
  await deleteData('categories', id);
  // Also delete linked subcategories
  const subs = (await getSubCategories()).filter(s => s.categoryId === id);
  for (const s of subs) {
    await deleteSubCategory(s.id);
  }
}

export async function getSubCategories(categoryId = null) {
  const subs = await db.getAll(KEYS.SUB_CATEGORIES) || [];
  if (categoryId) return subs.filter(s => s.categoryId === categoryId);
  return subs;
}

export async function saveSubCategory(sub) {
  if (!sub.id) sub.id = 'subcat-' + Date.now();
  await updateData('sub_categories', sub);
  return sub;
}

export async function deleteSubCategory(id) {
  await deleteData('sub_categories', id);
}

export async function migrateCategories() {
  const existing = await getCategories();
  if (existing.length > 0) return;

  const products = await getProducts();
  const uniqueCats = [...new Set(products.map(p => p.category).filter(Boolean))];
  
  if (uniqueCats.length === 0) {
    // If no existing categories, add some defaults based on industry
    const settings = await getSettings();
    const industry = settings.businessType || 'General';
    let defaults = ['Uncategorized'];
    if (industry === 'Restaurant') defaults = ['Beverages', 'Food', 'Desserts'];
    else if (industry === 'Saloon') defaults = ['Hair', 'Spa', 'Grooming'];
    else if (industry === 'Bakery') defaults = ['Bread', 'Pastry', 'Cakes'];
    
    for (const name of defaults) {
      await saveCategory({ name });
    }
    return;
  }

  for (const name of uniqueCats) {
    await saveCategory({ name });
  }
  console.log(`[Migration] Migrated ${uniqueCats.length} categories.`);
}

// Run migration on load
migrateCategories();



// --- Orders
export function updateOrder(order) {
  return saveOrder(order);
}
