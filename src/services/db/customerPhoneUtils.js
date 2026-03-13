export const normalizePhoneKey = (phone) => {
  const raw = String(phone ?? '');
  return raw.replace(/\D/g, '');
};

export const toIndexedPhoneKey = (phone) => {
  const normalized = normalizePhoneKey(phone);
  return normalized.length > 0 ? normalized : null;
};

export const buildPhoneBuckets = (customers = []) => {
  const buckets = new Map();

  customers.forEach((customer) => {
    const phoneKey = toIndexedPhoneKey(customer?.phone);
    if (!phoneKey) return;

    if (!buckets.has(phoneKey)) {
      buckets.set(phoneKey, []);
    }

    buckets.get(phoneKey).push(customer);
  });

  return buckets;
};

export const getPhoneConflictGroups = (customers = []) => {
  const buckets = buildPhoneBuckets(customers);

  return Array.from(buckets.entries())
    .filter(([, records]) => records.length > 1)
    .map(([phoneKey, records]) => ({ phoneKey, records }));
};

export const summarizePhoneConflictGroups = (groups = [], max = 3) => {
  if (!Array.isArray(groups) || groups.length === 0) return '';

  return groups
    .slice(0, max)
    .map(({ phoneKey, records }) => `${phoneKey} (${records.length})`)
    .join(', ');
};
