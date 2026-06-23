import { toIndexedPhoneKey } from '../db/customerPhoneUtils';
import { normalizeCustomerDebtCents } from '../db/customerDebtIndex';

export const CUSTOMER_SYNC_STATUS = Object.freeze({
  LOCAL: 'local',
  PENDING: 'pending',
  SYNCED: 'synced',
  CONFLICT: 'conflict',
  ERROR: 'error'
});

const nowIso = () => new Date().toISOString();

const pick = (source, snakeKey, camelKey, fallback = null) => {
  if (!source) return fallback;
  if (source[camelKey] !== undefined) return source[camelKey];
  if (source[snakeKey] !== undefined) return source[snakeKey];
  return fallback;
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const cleanText = (value) => {
  const text = String(value ?? '').trim();
  return text.length > 0 ? text : '';
};

export const normalizeCustomerForLocal = (customer = {}, existingCustomer = null, overrides = {}) => {
  const now = nowIso();
  const id = customer.id || existingCustomer?.id;
  const phone = cleanText(customer.phone ?? existingCustomer?.phone ?? '');
  const phoneKey = toIndexedPhoneKey(customer.phoneKey ?? customer.phone_key ?? phone);
  const debt = toNumber(customer.debt ?? existingCustomer?.debt, 0);
  const debtCents = toNumber(
    customer.debtCents ?? customer.debt_cents ?? existingCustomer?.debtCents,
    normalizeCustomerDebtCents(debt)
  );
  const deletedAt = pick(customer, 'deleted_at', 'deletedAt', existingCustomer?.deletedAt || existingCustomer?.deletedTimestamp || null);

  const local = {
    ...existingCustomer,
    ...customer,
    id,
    name: cleanText(customer.name ?? existingCustomer?.name ?? ''),
    phone,
    address: cleanText(customer.address ?? existingCustomer?.address ?? ''),
    debt,
    debtCents,
    creditLimit: toNumber(customer.creditLimit ?? customer.credit_limit ?? existingCustomer?.creditLimit, 0),
    createdAt: pick(customer, 'created_at', 'createdAt', existingCustomer?.createdAt || now),
    updatedAt: pick(customer, 'updated_at', 'updatedAt', now),
    deletedAt,
    deletedTimestamp: deletedAt || existingCustomer?.deletedTimestamp,
    serverVersion: toNumber(pick(customer, 'server_version', 'serverVersion', existingCustomer?.serverVersion), existingCustomer?.serverVersion || null),
    cloudUpdatedAt: pick(customer, 'updated_at', 'cloudUpdatedAt', existingCustomer?.cloudUpdatedAt || null),
    lastSyncedAt: overrides.lastSyncedAt ?? existingCustomer?.lastSyncedAt ?? null,
    syncStatus: overrides.syncStatus ?? existingCustomer?.syncStatus ?? CUSTOMER_SYNC_STATUS.SYNCED,
    pendingOperationId: overrides.pendingOperationId ?? existingCustomer?.pendingOperationId ?? null,
    conflictReason: overrides.conflictReason ?? existingCustomer?.conflictReason ?? null,
    isActive: deletedAt ? false : (customer.isActive ?? existingCustomer?.isActive ?? true)
  };

  if (phoneKey) {
    local.phoneKey = phoneKey;
  } else {
    delete local.phoneKey;
  }

  return local;
};

export const cloudCustomerToLocal = (cloudCustomer = {}, existingCustomer = null, overrides = {}) => {
  const mapped = {
    id: cloudCustomer.id,
    name: cloudCustomer.name,
    phone: cloudCustomer.phone || '',
    phoneKey: cloudCustomer.phone_key || cloudCustomer.phoneKey || null,
    address: cloudCustomer.address || '',
    debt: toNumber(cloudCustomer.debt, 0),
    debtCents: toNumber(cloudCustomer.debt_cents ?? cloudCustomer.debtCents, 0),
    creditLimit: toNumber(cloudCustomer.credit_limit ?? cloudCustomer.creditLimit, 0),
    createdAt: cloudCustomer.created_at || cloudCustomer.createdAt,
    updatedAt: cloudCustomer.updated_at || cloudCustomer.updatedAt,
    deletedAt: cloudCustomer.deleted_at || cloudCustomer.deletedAt || null,
    deletedTimestamp: cloudCustomer.deleted_at || cloudCustomer.deletedAt || null,
    serverVersion: toNumber(cloudCustomer.server_version ?? cloudCustomer.serverVersion, null),
    cloudUpdatedAt: cloudCustomer.updated_at || cloudCustomer.updatedAt || null,
    metadata: cloudCustomer.metadata || {}
  };

  return normalizeCustomerForLocal(mapped, existingCustomer, {
    syncStatus: CUSTOMER_SYNC_STATUS.SYNCED,
    lastSyncedAt: nowIso(),
    pendingOperationId: null,
    conflictReason: null,
    ...overrides
  });
};

export const localCustomerToCloudPayload = (customer = {}) => {
  const phone = cleanText(customer.phone);
  const phoneKey = toIndexedPhoneKey(customer.phoneKey ?? phone);
  const debt = toNumber(customer.debt, 0);

  return {
    id: customer.id,
    name: cleanText(customer.name),
    phone,
    phone_key: phoneKey,
    address: cleanText(customer.address),
    debt,
    debt_cents: normalizeCustomerDebtCents(customer.debtCents ?? debt),
    credit_limit: toNumber(customer.creditLimit, 0),
    created_at: customer.createdAt || nowIso(),
    updated_at: customer.updatedAt || nowIso(),
    metadata: {
      source: 'lanzo_pos_frontend',
      phase: 'fase1_customers_directory'
    }
  };
};

export const buildPendingCustomer = (customer = {}, existingCustomer = null, { operationId = null, operation = 'upsert' } = {}) => normalizeCustomerForLocal(
  {
    ...customer,
    updatedAt: nowIso(),
    deletedAt: operation === 'delete' ? nowIso() : customer.deletedAt
  },
  existingCustomer,
  {
    syncStatus: CUSTOMER_SYNC_STATUS.PENDING,
    pendingOperationId: operationId,
    conflictReason: null
  }
);

export const markCustomerConflict = (customer = {}, reason = 'VERSION_CONFLICT') => normalizeCustomerForLocal(customer, customer, {
  syncStatus: CUSTOMER_SYNC_STATUS.CONFLICT,
  conflictReason: reason,
  pendingOperationId: null
});

export const isCustomerVisible = (customer) => Boolean(
  customer
  && customer.isActive !== false
  && !customer.deletedAt
  && !customer.deletedTimestamp
);
