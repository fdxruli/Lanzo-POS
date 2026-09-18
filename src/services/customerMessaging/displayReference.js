const DISPLAY_REFERENCE_FIELDS = Object.freeze([
  'reference',
  'folio',
  'receiptNumber',
  'receipt_number',
  'paymentNumber',
  'payment_number',
  'saleFolio',
  'sale_folio',
  'layawayReference',
  'layaway_reference'
]);

const TECHNICAL_REFERENCE_PATTERN = /^(?:ldg_|ledger_|sale_|payment_|customer_|note_|layaway_|uuid_)/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isDisplayReference = (value) => {
  if (value === null || value === undefined) return false;
  const normalized = String(value).trim();
  return Boolean(normalized)
    && !TECHNICAL_REFERENCE_PATTERN.test(normalized)
    && !UUID_PATTERN.test(normalized);
};

/**
 * Selects only a customer-facing reference. Callers may pass values or source
 * objects; identifiers are intentionally never considered as candidates.
 */
export const selectDisplayReference = (...sources) => {
  for (const source of sources) {
    if (source && typeof source === 'object') {
      for (const field of DISPLAY_REFERENCE_FIELDS) {
        if (isDisplayReference(source[field])) return String(source[field]).trim();
      }
    } else if (isDisplayReference(source)) {
      return String(source).trim();
    }
  }
  return null;
};
