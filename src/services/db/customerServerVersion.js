export const parseCustomerServerVersion = (value) => {
  if (value === null || value === undefined) {
    return { valid: true, version: value ?? null };
  }

  let candidate = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return { valid: false, version: null };
    candidate = Number(trimmed);
  }

  if (typeof candidate !== 'number' || !Number.isSafeInteger(candidate) || candidate <= 0) {
    return { valid: false, version: null };
  }

  return { valid: true, version: candidate };
};

export const normalizeCustomerServerVersion = (value) => {
  const parsed = parseCustomerServerVersion(value);
  return parsed.valid ? parsed.version : null;
};
