import { toIndexedPhoneKey } from '../db/customerPhoneUtils';
import { validateCustomerCreditLimitMoney } from './customerCreditLimit';

const DIRECTORY_FIELDS = Object.freeze([
  Object.freeze({ key: 'name', label: 'nombre' }),
  Object.freeze({ key: 'phone', label: 'teléfono' }),
  Object.freeze({ key: 'address', label: 'dirección' }),
  Object.freeze({ key: 'creditLimit', label: 'límite de crédito' })
]);

const readField = (customer = {}, field) => {
  if (field === 'creditLimit') return customer.creditLimit ?? customer.credit_limit ?? 0;
  if (field === 'phone') return customer.phone ?? '';
  return customer[field] ?? '';
};

const normalizeText = (value) => String(value ?? '').trim();

const normalizeForComparison = (field, value) => {
  if (field === 'phone') return toIndexedPhoneKey(value) || normalizeText(value);
  if (field === 'creditLimit') {
    const validation = validateCustomerCreditLimitMoney(value);
    return validation.valid ? validation.cents : `invalid:${String(value)}`;
  }
  return normalizeText(value);
};

const sameFieldValue = (field, left, right) => (
  normalizeForComparison(field, left) === normalizeForComparison(field, right)
);

const asDirectoryCustomer = (base = {}, value = {}) => ({
  ...base,
  ...value,
  id: value.id ?? base.id,
  name: readField(value, 'name') || readField(base, 'name'),
  phone: value.phone !== undefined ? value.phone : readField(base, 'phone'),
  address: value.address !== undefined ? value.address : readField(base, 'address'),
  creditLimit: value.creditLimit !== undefined || value.credit_limit !== undefined
    ? readField(value, 'creditLimit')
    : readField(base, 'creditLimit')
});

const conflictFor = (field, baseline, local, cloud, reason = 'overlapping_change') => ({
  field,
  label: DIRECTORY_FIELDS.find((item) => item.key === field)?.label || field,
  baseValue: readField(baseline, field),
  currentValue: readField(cloud, field),
  proposedValue: readField(local, field),
  reason
});

export const getCustomerDirectoryChangedFields = (baseline = {}, candidate = {}) => {
  const base = asDirectoryCustomer({}, baseline);
  const local = asDirectoryCustomer(base, candidate);
  return DIRECTORY_FIELDS
    .filter(({ key }) => !sameFieldValue(key, readField(base, key), readField(local, key)))
    .map(({ key }) => key);
};

/**
 * Three-way merge for the ordinary customer directory fields only.
 * The cloud projection supplies all non-directory fields (including debt);
 * local data can only contribute name, phone, address, and creditLimit.
 */
export const reconcileCustomerDirectoryEdit = ({ baseline, local, cloud } = {}) => {
  if (!baseline?.id || baseline.id !== local?.id || baseline.id !== cloud?.id) {
    return { ok: false, code: 'CUSTOMER_RECONCILIATION_ID_MISMATCH', conflicts: [] };
  }

  const base = asDirectoryCustomer({}, baseline);
  const proposed = asDirectoryCustomer(base, local);
  const current = asDirectoryCustomer({}, cloud);
  const merged = { ...current };
  const conflicts = [];

  for (const { key } of DIRECTORY_FIELDS) {
    const baseValue = readField(base, key);
    const localValue = readField(proposed, key);
    const cloudValue = readField(current, key);
    const localChanged = !sameFieldValue(key, baseValue, localValue);
    const cloudChanged = !sameFieldValue(key, baseValue, cloudValue);

    if (!localChanged) {
      merged[key] = cloudValue;
      continue;
    }

    if (!cloudChanged) {
      merged[key] = localValue;
      continue;
    }

    // A concurrent credit-limit edit always needs a person to review it,
    // including equal values, so a future FIN-01 confirmation cannot be bypassed.
    if (key === 'creditLimit' || !sameFieldValue(key, localValue, cloudValue)) {
      conflicts.push(conflictFor(key, base, proposed, current));
      continue;
    }

    merged[key] = cloudValue;
  }

  return {
    ok: conflicts.length === 0,
    code: conflicts.length ? 'CUSTOMER_FIELDS_CONFLICT' : null,
    customer: merged,
    conflicts,
    changedFields: getCustomerDirectoryChangedFields(base, proposed),
    baseline: base,
    cloud: current
  };
};

export const buildCustomerRetryLimitConflicts = ({ baseline, local, cloud } = {}) => {
  const base = asDirectoryCustomer({}, baseline);
  const proposed = asDirectoryCustomer(base, local);
  const current = asDirectoryCustomer({}, cloud);
  const changedFields = getCustomerDirectoryChangedFields(base, proposed);

  return changedFields.map((field) => conflictFor(
    field,
    base,
    proposed,
    current,
    'retry_limit_reached'
  ));
};

export const CUSTOMER_DIRECTORY_FIELDS = DIRECTORY_FIELDS;
