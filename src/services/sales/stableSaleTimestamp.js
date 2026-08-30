export const normalizeStableSaleTimestamp = (value) => {
    if (value instanceof Date) {
        return Number.isFinite(value.getTime()) ? value.toISOString() : null;
    }

    if (typeof value !== 'string' && typeof value !== 'number') return null;

    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
};

/**
 * Resolve immutable order creation evidence without allowing a mutable draft
 * or freshness winner to replace an already durable SALES timestamp.
 */
export const resolveImmutableOrderCreatedAt = ({
  durableOrder = null,
  activeOrder = null,
  persistedDraft = null,
  fallbackToNow = true
} = {}) => (
  normalizeStableSaleTimestamp(durableOrder?.timestamp)
  || normalizeStableSaleTimestamp(durableOrder?.createdAt)
  || normalizeStableSaleTimestamp(activeOrder?.createdAt)
  || normalizeStableSaleTimestamp(persistedDraft?.createdAt)
  || (fallbackToNow ? new Date().toISOString() : null)
);
