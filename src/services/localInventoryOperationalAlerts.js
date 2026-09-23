import { db, STORES } from './db/dexie';
import {
  buildInventoryOperationalAlerts,
  EXPIRY_DAYS_THRESHOLD,
  INVENTORY_OPERATIONAL_SEVERITY,
  INVENTORY_OPERATIONAL_TYPES
} from './inventoryOperationalAlerts';
import {
  getTenantStorageItem,
  setTenantStorageItem
} from './tenant/tenantScopedStorage';

export const LOCAL_INVENTORY_OPERATIONAL_SEEN_KEY = 'inventory_operational_alerts_seen:v1';
export const LOCAL_INVENTORY_OPERATIONAL_SEEN_VERSION = 1;

const EMPTY_COUNTS = Object.freeze({
  activeCount: 0,
  criticalCount: 0,
  warningCount: 0,
  outOfStockCount: 0,
  lowStockCount: 0,
  expiredCount: 0,
  expiringCount: 0
});

export const EMPTY_LOCAL_INVENTORY_OPERATIONAL_SNAPSHOT = Object.freeze({
  catalogSize: 0,
  alerts: [],
  ...EMPTY_COUNTS,
  unseenCount: 0,
  status: 'idle',
  loading: false,
  error: null,
  updatedAt: null
});

const startOfLocalDay = (date) => (
  new Date(date.getFullYear(), date.getMonth(), date.getDate())
);

const toLocalDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const uniqueById = (items = []) => Array.from(
  new Map(
    items
      .filter((item) => item?.id !== null && item?.id !== undefined)
      .map((item) => [item.id, item])
  ).values()
);

export const getLocalInventoryOperationalIncidentId = (alert = {}) => {
  if (
    alert.type === INVENTORY_OPERATIONAL_TYPES.OUT_OF_STOCK
    || alert.type === INVENTORY_OPERATIONAL_TYPES.LOW_STOCK
  ) {
    return alert.productId === null || alert.productId === undefined
      ? null
      : `inventory-stock:${alert.productId}`;
  }

  if (
    alert.type === INVENTORY_OPERATIONAL_TYPES.EXPIRED
    || alert.type === INVENTORY_OPERATIONAL_TYPES.EXPIRING
  ) {
    return alert.batchId === null || alert.batchId === undefined
      ? null
      : `inventory-expiry:${alert.batchId}`;
  }

  return null;
};

export const getLocalInventoryOperationalMaterialFingerprint = (alert = {}) => {
  const incidentId = alert.incidentId || getLocalInventoryOperationalIncidentId(alert);
  if (!incidentId) return null;

  const expiryDate = (
    alert.type === INVENTORY_OPERATIONAL_TYPES.EXPIRED
    || alert.type === INVENTORY_OPERATIONAL_TYPES.EXPIRING
  )
    ? (alert.expiryDate || null)
    : null;

  return JSON.stringify([
    incidentId,
    alert.type || null,
    alert.severity || null,
    expiryDate
  ]);
};

const decorateOperationalAlert = (alert) => {
  const incidentId = getLocalInventoryOperationalIncidentId(alert);
  const materialFingerprint = getLocalInventoryOperationalMaterialFingerprint({
    ...alert,
    incidentId
  });

  return {
    ...alert,
    incidentId,
    materialFingerprint
  };
};

export const deriveLocalInventoryOperationalCounts = (alerts = []) => {
  const counts = { ...EMPTY_COUNTS };
  const list = Array.isArray(alerts) ? alerts : [];

  counts.activeCount = list.length;

  list.forEach((alert) => {
    if (alert?.severity === INVENTORY_OPERATIONAL_SEVERITY.CRITICAL) {
      counts.criticalCount += 1;
    } else if (alert?.severity === INVENTORY_OPERATIONAL_SEVERITY.WARNING) {
      counts.warningCount += 1;
    }

    switch (alert?.type) {
      case INVENTORY_OPERATIONAL_TYPES.OUT_OF_STOCK:
        counts.outOfStockCount += 1;
        break;
      case INVENTORY_OPERATIONAL_TYPES.LOW_STOCK:
        counts.lowStockCount += 1;
        break;
      case INVENTORY_OPERATIONAL_TYPES.EXPIRED:
        counts.expiredCount += 1;
        break;
      case INVENTORY_OPERATIONAL_TYPES.EXPIRING:
        counts.expiringCount += 1;
        break;
      default:
        break;
    }
  });

  return counts;
};

export async function queryLocalInventoryOperationalSnapshot({
  now = new Date(),
  database = db
} = {}) {
  if (!database.isOpen()) await database.open();

  const expiryLimit = new Date(now);
  expiryLimit.setDate(expiryLimit.getDate() + EXPIRY_DAYS_THRESHOLD);

  const lowerExpiryKey = toLocalDateKey(startOfLocalDay(now));
  const upperExpiryKey = `${toLocalDateKey(expiryLimit)}￿`;

  const [products, upcomingBatches, expiredBatches] = await Promise.all([
    database.table(STORES.MENU).toArray(),
    database.table(STORES.PRODUCT_BATCHES)
      .where('[activeStockStatus+alertTargetDate]')
      .between([1, lowerExpiryKey], [1, upperExpiryKey], true, true)
      .toArray(),
    database.table(STORES.PRODUCT_BATCHES)
      .where('[activeStockStatus+alertTargetDate]')
      .between([1, ''], [1, lowerExpiryKey], true, false)
      .reverse()
      .toArray()
  ]);

  const batches = uniqueById([...upcomingBatches, ...expiredBatches]);
  const alerts = buildInventoryOperationalAlerts({
    products,
    batches,
    now,
    expiryDaysThreshold: EXPIRY_DAYS_THRESHOLD
  }).map(decorateOperationalAlert);
  const counts = deriveLocalInventoryOperationalCounts(alerts);

  return {
    catalogSize: products.length,
    alerts,
    ...counts,
    unseenCount: alerts.length,
    status: 'ready',
    loading: false,
    error: null,
    updatedAt: now.toISOString()
  };
}

const emptySeenState = () => ({
  version: LOCAL_INVENTORY_OPERATIONAL_SEEN_VERSION,
  incidents: {}
});

const normalizeSeenState = (value) => {
  if (
    !value
    || value.version !== LOCAL_INVENTORY_OPERATIONAL_SEEN_VERSION
    || !value.incidents
    || typeof value.incidents !== 'object'
    || Array.isArray(value.incidents)
  ) {
    return emptySeenState();
  }

  const incidents = {};
  Object.entries(value.incidents).forEach(([incidentId, entry]) => {
    if (
      typeof incidentId !== 'string'
      || !entry
      || typeof entry !== 'object'
      || typeof entry.materialFingerprint !== 'string'
    ) {
      return;
    }

    incidents[incidentId] = {
      materialFingerprint: entry.materialFingerprint,
      seenAt: typeof entry.seenAt === 'string' ? entry.seenAt : null
    };
  });

  return {
    version: LOCAL_INVENTORY_OPERATIONAL_SEEN_VERSION,
    incidents
  };
};

const readStoredSeenState = () => {
  const raw = getTenantStorageItem(LOCAL_INVENTORY_OPERATIONAL_SEEN_KEY);
  if (!raw) return emptySeenState();

  try {
    return normalizeSeenState(JSON.parse(raw));
  } catch {
    return emptySeenState();
  }
};

const writeStoredSeenState = (seenState) => {
  const normalized = normalizeSeenState(seenState);
  setTenantStorageItem(
    LOCAL_INVENTORY_OPERATIONAL_SEEN_KEY,
    JSON.stringify(normalized)
  );
  return normalized;
};

export const reconcileLocalInventoryOperationalSeenState = (
  alerts = [],
  seenState = emptySeenState()
) => {
  const normalizedSeenState = normalizeSeenState(seenState);
  const activeIncidents = {};
  let unseenCount = 0;

  const reconciledAlerts = (Array.isArray(alerts) ? alerts : []).map((alert) => {
    const incidentId = alert?.incidentId || getLocalInventoryOperationalIncidentId(alert);
    const materialFingerprint = (
      alert?.materialFingerprint
      || getLocalInventoryOperationalMaterialFingerprint({ ...alert, incidentId })
    );
    const previous = incidentId
      ? normalizedSeenState.incidents[incidentId]
      : null;
    const isSeen = Boolean(
      previous
      && materialFingerprint
      && previous.materialFingerprint === materialFingerprint
    );

    if (incidentId && previous) {
      activeIncidents[incidentId] = previous;
    }
    if (!isSeen) unseenCount += 1;

    return {
      ...alert,
      incidentId,
      materialFingerprint,
      isSeen
    };
  });

  return {
    alerts: reconciledAlerts,
    unseenCount,
    seenState: {
      version: LOCAL_INVENTORY_OPERATIONAL_SEEN_VERSION,
      incidents: activeIncidents
    }
  };
};

export const markLocalInventoryOperationalAlertsSeenInState = (
  alerts = [],
  seenState = emptySeenState(),
  seenAt = new Date().toISOString()
) => {
  const normalizedSeenState = normalizeSeenState(seenState);
  const incidents = {};

  (Array.isArray(alerts) ? alerts : []).forEach((alert) => {
    const incidentId = alert?.incidentId || getLocalInventoryOperationalIncidentId(alert);
    const materialFingerprint = (
      alert?.materialFingerprint
      || getLocalInventoryOperationalMaterialFingerprint({ ...alert, incidentId })
    );
    if (!incidentId || !materialFingerprint) return;

    const previous = normalizedSeenState.incidents[incidentId];
    incidents[incidentId] = {
      materialFingerprint,
      seenAt: previous?.materialFingerprint === materialFingerprint && previous?.seenAt
        ? previous.seenAt
        : seenAt
    };
  });

  return {
    version: LOCAL_INVENTORY_OPERATIONAL_SEEN_VERSION,
    incidents
  };
};

let currentSnapshot = { ...EMPTY_LOCAL_INVENTORY_OPERATIONAL_SNAPSHOT };
let refreshRequest = null;
const snapshotListeners = new Set();

const publishSnapshot = (snapshot) => {
  currentSnapshot = snapshot;
  snapshotListeners.forEach((listener) => listener());
};

export const getLocalInventoryOperationalAlertsSnapshot = () => currentSnapshot;

export const subscribeLocalInventoryOperationalAlerts = (listener) => {
  snapshotListeners.add(listener);
  return () => snapshotListeners.delete(listener);
};

export const resetLocalInventoryOperationalAlertsRuntime = () => {
  refreshRequest = null;
  publishSnapshot({ ...EMPTY_LOCAL_INVENTORY_OPERATIONAL_SNAPSHOT });
};

const applyStoredSeenState = (snapshot) => {
  const storedSeenState = readStoredSeenState();
  const reconciled = reconcileLocalInventoryOperationalSeenState(
    snapshot.alerts,
    storedSeenState
  );

  if (JSON.stringify(reconciled.seenState) !== JSON.stringify(storedSeenState)) {
    writeStoredSeenState(reconciled.seenState);
  }

  return {
    ...snapshot,
    alerts: reconciled.alerts,
    unseenCount: reconciled.unseenCount
  };
};

export const refreshLocalInventoryOperationalAlertsSnapshot = ({
  querySnapshot = queryLocalInventoryOperationalSnapshot,
  queryOptions
} = {}) => {
  if (refreshRequest) return refreshRequest;

  publishSnapshot({
    ...currentSnapshot,
    status: 'loading',
    loading: true,
    error: null
  });

  const request = Promise.resolve()
    .then(() => querySnapshot(queryOptions))
    .then((snapshot) => {
      const nextSnapshot = applyStoredSeenState(snapshot);
      publishSnapshot(nextSnapshot);
      return nextSnapshot;
    })
    .catch((error) => {
      const nextSnapshot = {
        ...EMPTY_LOCAL_INVENTORY_OPERATIONAL_SNAPSHOT,
        status: 'error',
        loading: false,
        error: error?.message || 'LOCAL_INVENTORY_OPERATIONAL_ALERTS_FAILED',
        updatedAt: new Date().toISOString()
      };
      publishSnapshot(nextSnapshot);
      return nextSnapshot;
    })
    .finally(() => {
      if (refreshRequest === request) refreshRequest = null;
    });

  refreshRequest = request;
  return request;
};

export const markCurrentLocalInventoryOperationalAlertsSeen = (
  seenAt = new Date().toISOString()
) => {
  if (!currentSnapshot.alerts.length) return currentSnapshot;

  const storedSeenState = readStoredSeenState();
  const nextSeenState = markLocalInventoryOperationalAlertsSeenInState(
    currentSnapshot.alerts,
    storedSeenState,
    seenAt
  );
  writeStoredSeenState(nextSeenState);

  const reconciled = reconcileLocalInventoryOperationalSeenState(
    currentSnapshot.alerts,
    nextSeenState
  );
  const nextSnapshot = {
    ...currentSnapshot,
    alerts: reconciled.alerts,
    unseenCount: reconciled.unseenCount
  };
  publishSnapshot(nextSnapshot);
  return nextSnapshot;
};
