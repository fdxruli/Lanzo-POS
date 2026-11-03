import { toIndexedPhoneKey } from '../db/customerPhoneUtils';
import { normalizeCustomerDebtCents } from '../db/customerDebtIndex';
import { parseCustomerServerVersion } from '../db/customerServerVersion';
import { Money } from '../../utils/moneyMath';
import { validateCustomerCreditLimitMoney } from './customerCreditLimit';

export const CUSTOMER_SYNC_STATUS = Object.freeze({
  LOCAL: 'local',
  PENDING: 'pending',
  SYNCED: 'synced',
  CONFLICT: 'conflict',
  ERROR: 'error'
});

const nowIso = () => new Date().toISOString();
const LEGACY_CUSTOMER_DEBT_CENTS_MAX = 2147483647;

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

const getLocalServerVersion = (customer = {}, existingCustomer = null) => {
  const incoming = customer.serverVersion !== undefined
    ? customer.serverVersion
    : customer.server_version;
  const parsedIncoming = parseCustomerServerVersion(incoming);
  if (parsedIncoming.valid && parsedIncoming.version !== null) return parsedIncoming.version;

  const existing = existingCustomer?.serverVersion ?? existingCustomer?.server_version;
  const parsedExisting = parseCustomerServerVersion(existing);
  return parsedExisting.valid ? parsedExisting.version : null;
};

const getCloudServerVersion = (cloudCustomer = {}) => {
  const value = cloudCustomer.server_version ?? cloudCustomer.serverVersion;
  const parsed = parseCustomerServerVersion(value);

  if (!parsed.valid || parsed.version === null) {
    const error = new Error('INVALID_CUSTOMER_SERVER_VERSION');
    error.name = 'CustomerServerVersionError';
    error.code = 'INVALID_CUSTOMER_SERVER_VERSION';
    throw error;
  }

  return parsed.version;
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
    serverVersion: getLocalServerVersion(customer, existingCustomer),
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
    serverVersion: getCloudServerVersion(cloudCustomer),
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
  const hasCamelLimit = Object.prototype.hasOwnProperty.call(customer, 'creditLimit');
  const creditLimit = hasCamelLimit
    ? customer.creditLimit
    : (customer.credit_limit ?? 0);
  const validatedCreditLimit = validateCustomerCreditLimitMoney(creditLimit);
  if (!validatedCreditLimit.valid) {
    const error = new Error('INVALID_CUSTOMER_CREDIT_LIMIT');
    error.code = 'INVALID_CUSTOMER_CREDIT_LIMIT';
    throw error;
  }

  return {
    id: customer.id,
    name: cleanText(customer.name),
    phone,
    phone_key: phoneKey,
    address: cleanText(customer.address),
    credit_limit: validatedCreditLimit.value,
    created_at: customer.createdAt || nowIso(),
    updated_at: customer.updatedAt || nowIso(),
    metadata: {
      source: 'lanzo_pos_frontend',
      phase: 'fase1_customers_directory'
    }
  };
};

export const localCustomerToLegacyMigrationPayload = (customer = {}) => {
  const debtInput = customer.debt ?? customer.currentDebt ?? customer.current_debt;
  const rawCents = customer.debtCents ?? customer.debt_cents;
  let debtCents = null;

  if (rawCents !== undefined && rawCents !== null && rawCents !== '') {
    debtCents = typeof rawCents === 'string' && /^\d+$/.test(rawCents)
      ? Number(rawCents)
      : rawCents;
    if (!Number.isSafeInteger(debtCents) || debtCents < 0 || debtCents > LEGACY_CUSTOMER_DEBT_CENTS_MAX) {
      const error = new Error('INVALID_LEGACY_CUSTOMER_DEBT_CENTS');
      error.code = 'INVALID_LEGACY_CUSTOMER_DEBT_CENTS';
      throw error;
    }
  }

  const debtValue = debtInput === undefined
    ? (debtCents === null ? 0 : Money.fromCents(debtCents).toString())
    : debtInput;
  const debt = validateCustomerCreditLimitMoney(debtValue);

  if (!debt.valid) {
    const error = new Error('INVALID_LEGACY_CUSTOMER_DEBT');
    error.code = 'INVALID_LEGACY_CUSTOMER_DEBT';
    throw error;
  }

  if (debtCents === null) {
    debtCents = debt.cents;
  } else {
    if (debt.cents !== debtCents) {
      const error = new Error('INCONSISTENT_LEGACY_CUSTOMER_DEBT');
      error.code = 'INCONSISTENT_LEGACY_CUSTOMER_DEBT';
      throw error;
    }
  }

  if (!Number.isSafeInteger(debtCents) || debtCents < 0 || debtCents > LEGACY_CUSTOMER_DEBT_CENTS_MAX) {
    const error = new Error('INVALID_LEGACY_CUSTOMER_DEBT_CENTS');
    error.code = 'INVALID_LEGACY_CUSTOMER_DEBT_CENTS';
    throw error;
  }

  const payload = localCustomerToCloudPayload({
    ...customer,
    creditLimit: customer.creditLimit ?? 0
  });
  return { ...payload, debt: debt.value, debt_cents: debtCents };
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
