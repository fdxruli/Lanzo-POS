export const LOCAL_TENANT_BINDING_STORE = 'local_tenant_binding';
export const LOCAL_TENANT_BINDING_KEY = 'primary';

// Physical runtime names are allocated by tenantRuntimeRouter.  Keep the
// validator dependency-free so workers can reject legacy names without
// importing the runtime authority they are not allowed to resolve themselves.
export const isTenantWorkerDatabaseName = (databaseName) => (
  typeof databaseName === 'string'
  && /^LanzoDB_t_t_[a-f0-9]{32}$/i.test(databaseName)
);

export const LOCAL_STORE_SCOPE = Object.freeze({
  TENANT_OWNED: 'tenant_owned',
  DEVICE_OWNED: 'device_owned',
  GLOBAL_RECOVERY: 'global_recovery'
});

/**
 * The classification is intentionally conservative. A store that is not
 * listed here is treated as tenant-owned until it is explicitly audited.
 */
export const LOCAL_STORE_CLASSIFICATION = Object.freeze({
  menu: LOCAL_STORE_SCOPE.TENANT_OWNED,
  product_batches: LOCAL_STORE_SCOPE.TENANT_OWNED,
  categories: LOCAL_STORE_SCOPE.TENANT_OWNED,
  ingredients: LOCAL_STORE_SCOPE.TENANT_OWNED,
  sales: LOCAL_STORE_SCOPE.TENANT_OWNED,
  customers: LOCAL_STORE_SCOPE.TENANT_OWNED,
  company: LOCAL_STORE_SCOPE.TENANT_OWNED,
  theme: LOCAL_STORE_SCOPE.TENANT_OWNED,
  cajas: LOCAL_STORE_SCOPE.TENANT_OWNED,
  movimientos_caja: LOCAL_STORE_SCOPE.TENANT_OWNED,
  global_stats: LOCAL_STORE_SCOPE.TENANT_OWNED,
  daily_stats: LOCAL_STORE_SCOPE.TENANT_OWNED,
  deleted_menu: LOCAL_STORE_SCOPE.TENANT_OWNED,
  deleted_customers: LOCAL_STORE_SCOPE.TENANT_OWNED,
  deleted_sales: LOCAL_STORE_SCOPE.TENANT_OWNED,
  deleted_categories: LOCAL_STORE_SCOPE.TENANT_OWNED,
  waste_logs: LOCAL_STORE_SCOPE.TENANT_OWNED,
  processed_sales_log: LOCAL_STORE_SCOPE.TENANT_OWNED,
  transaction_log: LOCAL_STORE_SCOPE.TENANT_OWNED,
  sync_cache: LOCAL_STORE_SCOPE.TENANT_OWNED,
  images: LOCAL_STORE_SCOPE.TENANT_OWNED,
  layaways: LOCAL_STORE_SCOPE.TENANT_OWNED,
  customer_ledger: LOCAL_STORE_SCOPE.TENANT_OWNED,
  inventory_events: LOCAL_STORE_SCOPE.TENANT_OWNED,
  sequences: LOCAL_STORE_SCOPE.TENANT_OWNED,
  corrupted_states: LOCAL_STORE_SCOPE.TENANT_OWNED,
  sync_outbox: LOCAL_STORE_SCOPE.TENANT_OWNED,
  sync_meta: LOCAL_STORE_SCOPE.TENANT_OWNED,
  sync_conflicts: LOCAL_STORE_SCOPE.TENANT_OWNED,
  __lanzo_sales_backup_v30: LOCAL_STORE_SCOPE.TENANT_OWNED,
  __lanzo_deleted_sales_backup_v30: LOCAL_STORE_SCOPE.TENANT_OWNED,
  __lanzo_db_recovery: LOCAL_STORE_SCOPE.GLOBAL_RECOVERY,
  [LOCAL_TENANT_BINDING_STORE]: LOCAL_STORE_SCOPE.GLOBAL_RECOVERY
});

// These are the only records in the mixed legacy sync_cache store that have
// been proven to identify the physical browser rather than a license.
export const DEVICE_SCOPED_SYNC_CACHE_KEYS = Object.freeze(new Set([
  'lanzo_device_id',
  'lanzo_license_attempts'
]));

// These browser-storage entries can contain business data even when every
// IndexedDB table is empty. They therefore participate in the "really empty"
// decision used by a safe tenant rebind. Preferences and physical-device
// identifiers are deliberately excluded.
export const TENANT_OWNED_LOCAL_STORAGE_KEYS = Object.freeze(new Set([
  'lanzo-active-orders-storage',
  'lanzo-cart-storage',
  'lanzo-inventory-storage',
  'lanzo:restaurant-order-close-pending:v1',
  'ignored_expirations_ttl',
  'lanzo_cash_opening_policy'
]));

export const TENANT_OWNED_LOCAL_STORAGE_PREFIXES = Object.freeze([
  'lanzo-cart-storage-corrupted-'
]);

export const TENANT_OWNED_SESSION_STORAGE_KEYS = Object.freeze(new Set([
  'lanzo_drive_session:v1'
]));

export const LOCAL_TENANT_STATUS = Object.freeze({
  DISABLED: 'disabled',
  LOCKED: 'locked',
  GRANTED: 'granted',
  MISMATCH: 'mismatch',
  LEGACY_UNRESOLVED: 'legacy_unresolved'
});

export const LOCAL_TENANT_ERROR_CODES = Object.freeze({
  ACCESS_REQUIRED: 'LOCAL_TENANT_ACCESS_REQUIRED',
  IDENTITY_MISSING: 'LOCAL_TENANT_IDENTITY_MISSING',
  IDENTITY_UNAVAILABLE: 'LOCAL_TENANT_IDENTITY_UNAVAILABLE',
  MISMATCH: 'LOCAL_TENANT_MISMATCH',
  LEGACY_UNRESOLVED: 'LOCAL_TENANT_LEGACY_UNRESOLVED',
  STORAGE_INSPECTION_FAILED: 'LOCAL_TENANT_STORAGE_INSPECTION_FAILED',
  SNAPSHOT_CHANGED: 'LOCAL_TENANT_SNAPSHOT_CHANGED',
  SYNC_BLOCKED: 'LOCAL_TENANT_SYNC_BLOCKED'
});

const PUBLIC_MESSAGES = Object.freeze({
  [LOCAL_TENANT_ERROR_CODES.ACCESS_REQUIRED]:
    'La base local está bloqueada hasta validar una licencia compatible.',
  [LOCAL_TENANT_ERROR_CODES.IDENTITY_MISSING]:
    'No se pudo determinar la identidad estable de la licencia.',
  [LOCAL_TENANT_ERROR_CODES.IDENTITY_UNAVAILABLE]:
    'Este navegador no puede generar la identidad segura de la licencia.',
  [LOCAL_TENANT_ERROR_CODES.MISMATCH]:
    'Este navegador contiene datos locales asociados a otra licencia.',
  [LOCAL_TENANT_ERROR_CODES.LEGACY_UNRESOLVED]:
    'Esta base local contiene datos anteriores cuyo propietario no puede determinarse de forma segura.',
  [LOCAL_TENANT_ERROR_CODES.STORAGE_INSPECTION_FAILED]:
    'No se pudo comprobar de forma segura todo el almacenamiento local de este navegador.',
  [LOCAL_TENANT_ERROR_CODES.SNAPSHOT_CHANGED]:
    'Los datos locales cambiaron mientras se comprobaba su propietario. Vuelve a intentarlo.',
  [LOCAL_TENANT_ERROR_CODES.SYNC_BLOCKED]:
    'La sincronización se bloqueó porque la licencia activa no coincide con la base local.'
});

export class LocalTenantAccessError extends Error {
  constructor(code, details = {}) {
    super(PUBLIC_MESSAGES[code] || PUBLIC_MESSAGES[LOCAL_TENANT_ERROR_CODES.ACCESS_REQUIRED]);
    this.name = 'LocalTenantAccessError';
    this.code = code;
    this.details = {
      reason: details.reason || null,
      hasTenantOwnedData: details.hasTenantOwnedData === true,
      occupiedStores: Array.isArray(details.occupiedStores) ? [...details.occupiedStores] : [],
      unscopedLegacyStores: Array.isArray(details.unscopedLegacyStores)
        ? [...details.unscopedLegacyStores]
        : [],
      evidenceSources: Array.isArray(details.evidenceSources) ? [...details.evidenceSources] : [],
      evidenceCount: Number(details.evidenceCount) || 0
    };
  }
}

export const isLocalTenantAccessError = (error) => (
  error instanceof LocalTenantAccessError ||
  String(error?.code || '').startsWith('LOCAL_TENANT_')
);

export const getLocalStoreScope = (storeName) => (
  LOCAL_STORE_CLASSIFICATION[storeName] || LOCAL_STORE_SCOPE.TENANT_OWNED
);

const cloneState = (state) => ({
  enabled: state.enabled,
  status: state.status,
  identities: [...state.identities],
  authority: state.authority,
  reason: state.reason,
  errorCode: state.errorCode
});

const TENANT_ALIAS_PREFIXES = ['license-id:', 'license-key-sha256:'];

export const areLocalTenantAliasesCompatible = (leftAliases = [], rightAliases = []) => {
  const left = [...new Set(leftAliases.filter(Boolean))];
  const right = [...new Set(rightAliases.filter(Boolean))];
  const rightSet = new Set(right);

  if (!left.some((alias) => rightSet.has(alias))) return false;

  return TENANT_ALIAS_PREFIXES.every((prefix) => {
    const leftOfType = left.filter((alias) => alias.startsWith(prefix));
    const rightOfType = right.filter((alias) => alias.startsWith(prefix));
    if (leftOfType.length === 0 || rightOfType.length === 0) return true;
    const rightOfTypeSet = new Set(rightOfType);
    return leftOfType.some((alias) => rightOfTypeSet.has(alias));
  });
};

export const createLocalTenantAccessController = () => {
  const listeners = new Set();
  let state = {
    enabled: false,
    status: LOCAL_TENANT_STATUS.DISABLED,
    identities: [],
    authority: null,
    reason: null,
    errorCode: null
  };

  const replaceState = (nextState) => {
    state = nextState;
    const snapshot = cloneState(state);
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch {
        // A view-cache listener must never weaken the database boundary.
      }
    }
  };

  const controller = {
    enable(reason = 'bootstrap') {
      replaceState({
        enabled: true,
        status: LOCAL_TENANT_STATUS.LOCKED,
        identities: [],
        authority: null,
        reason,
        errorCode: LOCAL_TENANT_ERROR_CODES.ACCESS_REQUIRED
      });
      return controller.getState();
    },

    grant(identity, reason = 'validated') {
      replaceState({
        enabled: true,
        status: LOCAL_TENANT_STATUS.GRANTED,
        identities: [...new Set(identity?.aliases || [identity?.primary].filter(Boolean))],
        authority: identity?.authority || null,
        reason,
        errorCode: null
      });
      return controller.getState();
    },

    block(error, status = LOCAL_TENANT_STATUS.MISMATCH) {
      replaceState({
        enabled: true,
        status,
        identities: [],
        authority: null,
        reason: error?.details?.reason || 'blocked',
        errorCode: error?.code || LOCAL_TENANT_ERROR_CODES.ACCESS_REQUIRED
      });
      return controller.getState();
    },

    lock(reason = 'no_active_license') {
      if (!state.enabled) return controller.getState();
      replaceState({
        enabled: true,
        status: LOCAL_TENANT_STATUS.LOCKED,
        identities: [],
        authority: null,
        reason,
        errorCode: LOCAL_TENANT_ERROR_CODES.ACCESS_REQUIRED
      });
      return controller.getState();
    },

    reset() {
      replaceState({
        enabled: false,
        status: LOCAL_TENANT_STATUS.DISABLED,
        identities: [],
        authority: null,
        reason: null,
        errorCode: null
      });
      return controller.getState();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getState() {
      return cloneState(state);
    },

    isGrantedFor(identity) {
      if (!state.enabled) return false;
      if (state.status !== LOCAL_TENANT_STATUS.GRANTED) return false;
      return areLocalTenantAliasesCompatible(state.identities, identity?.aliases || []);
    },

    assertDatabaseAccess(storeName, operation, request = {}) {
      // IndexedDB exposes Dexie's historical upgrade callbacks through the
      // same DBCore stack. Only the native versionchange transaction may pass
      // while locked; ordinary readonly/readwrite application work remains
      // blocked even if an upgrade is awaiting completion.
      if (request?.trans?.mode === 'versionchange') return true;
      if (!state.enabled) return true;
      if (getLocalStoreScope(storeName) !== LOCAL_STORE_SCOPE.TENANT_OWNED) return true;
      if (storeName === 'sync_cache' && isDeviceScopedSyncCacheRequest(operation, request)) return true;
      if (state.status === LOCAL_TENANT_STATUS.GRANTED) return true;

      throw new LocalTenantAccessError(
        state.errorCode || LOCAL_TENANT_ERROR_CODES.ACCESS_REQUIRED,
        { reason: state.reason }
      );
    }
  };

  return controller;
};

const isDeviceScopedSyncCacheRequest = (operation, request = {}) => {
  if (operation === 'get') {
    return DEVICE_SCOPED_SYNC_CACHE_KEYS.has(request.key);
  }

  if (operation === 'getMany') {
    return Array.isArray(request.keys) &&
      request.keys.every((key) => DEVICE_SCOPED_SYNC_CACHE_KEYS.has(key));
  }

  if (operation !== 'mutate') return false;

  if (request.type === 'add' || request.type === 'put') {
    return Array.isArray(request.values) && request.values.length > 0 &&
      request.values.every((record) => DEVICE_SCOPED_SYNC_CACHE_KEYS.has(record?.key));
  }

  if (request.type === 'delete') {
    return Array.isArray(request.keys) &&
      request.keys.every((key) => DEVICE_SCOPED_SYNC_CACHE_KEYS.has(key));
  }

  return false;
};

export const localTenantAccessController = createLocalTenantAccessController();

export const canAccessTenantOwnedRuntimeCache = (
  controller = localTenantAccessController
) => {
  const state = controller.getState();
  // Unit-level consumers that do not bootstrap the production guard retain
  // their existing behavior. The real app enables the guard before loading
  // tenant-owned runtime modules.
  return !state.enabled || state.status === LOCAL_TENANT_STATUS.GRANTED;
};

export const installLocalTenantDbMiddleware = (
  database,
  controller = localTenantAccessController
) => {
  database.use({
    stack: 'dbcore',
    name: 'lanzo-local-tenant-isolation',
    create: (downlevelDatabase) => ({
      ...downlevelDatabase,
      table: (tableName) => {
        const downlevelTable = downlevelDatabase.table(tableName);
        const guarded = (operation) => (request) => {
          controller.assertDatabaseAccess(tableName, operation, request);
          return downlevelTable[operation](request);
        };

        return {
          ...downlevelTable,
          mutate: guarded('mutate'),
          get: guarded('get'),
          getMany: guarded('getMany'),
          query: guarded('query'),
          openCursor: guarded('openCursor'),
          count: guarded('count')
        };
      }
    })
  });

  return database;
};
