const MXN_FORMATTER = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const parseNumericValue = value => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const text = value.trim();
  if (!text) return null;

  const cleaned = text
    .replace(/[\s$MXN]/gi, '')
    .replace(/[^\d,.-]/g, '');
  if (!cleaned) return null;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized = cleaned;

  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastComma > lastDot
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const decimalDigits = cleaned.length - lastComma - 1;
    normalized = decimalDigits > 0 && decimalDigits <= 2
      ? cleaned.replace(',', '.')
      : cleaned.replace(/,/g, '');
  }

  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
};

export const formatCurrencyMXN = (value, fallback = '') => {
  const numeric = parseNumericValue(value);
  return numeric === null ? fallback : MXN_FORMATTER.format(numeric);
};

export default formatCurrencyMXN;
