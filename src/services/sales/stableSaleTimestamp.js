export const normalizeStableSaleTimestamp = (value) => {
    if (value instanceof Date) {
        return Number.isFinite(value.getTime()) ? value.toISOString() : null;
    }

    if (typeof value !== 'string' && typeof value !== 'number') return null;

    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
};
