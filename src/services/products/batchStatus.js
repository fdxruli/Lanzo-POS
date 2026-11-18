const ARCHIVED_STATUSES = new Set(['archived', 'deleted', 'removed', 'expired']);

export const isBatchArchived = (batch = {}) => {
  batch = batch || {};
  const status = String(batch.status || '').trim().toLowerCase();
  const hasArchiveMarker = Boolean(
    batch.isArchived === true
    || batch.deletedAt
    || batch.deleted_at
    || batch.archivedAt
    || batch.archived_at
    || batch.isDeleted === true
    || batch.is_deleted === true
    || ARCHIVED_STATUSES.has(status)
  );

  if (hasArchiveMarker) return true;

  // An exhausted or identity-only lot can be inactive without being archived.
  // Fail closed when an inactive record has contradictory or unknown stock.
  const hasStock = batch.stock !== null && batch.stock !== undefined && batch.stock !== '';
  const stock = hasStock ? Number(batch.stock) : Number.NaN;
  const inactive = batch.isActive === false || status === 'inactive';
  return inactive && (!Number.isFinite(stock) || stock !== 0);
};
