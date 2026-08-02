import { db, STORES } from '../db/dexie';
import { getAvailableStock, getCommittedStock } from '../db/utils';

export const BATCH_MANAGER_PAGE_SIZE = 50;

const ARCHIVED_STATUSES = new Set(['archived', 'deleted', 'removed', 'inactive']);
const ACTIVE_STATUSES = new Set(['active', 'enabled']);
const VALID_FILTERS = new Set(['all', 'active', 'archived']);

const toFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toStableTimestamp = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

const extractTimestampFromId = (id) => {
  const match = String(id || '').match(/(?:^|[_-])(\d{13})(?:$|[_-])/);
  if (!match) return null;
  const timestamp = Number(match[1]);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
};

export const getBatchSortValue = (batch) => (
  toStableTimestamp(batch?.createdAt)
  ?? toStableTimestamp(batch?.updatedAt)
  ?? extractTimestampFromId(batch?.id)
  ?? 0
);

export const getBatchManagerStatus = (batch) => {
  const status = String(batch?.status || '').trim().toLowerCase();
  const hasArchiveMarker = Boolean(batch?.deletedAt || batch?.deleted_at);

  if (
    batch?.isArchived === true
    || batch?.isActive === false
    || hasArchiveMarker
    || ARCHIVED_STATUSES.has(status)
  ) {
    return 'archived';
  }

  if (batch?.isActive === true || ACTIVE_STATUSES.has(status)) return 'active';

  // Los registros legacy ambiguos quedan en historial para no volverlos vendibles.
  return 'archived';
};

export const compareBatchManagerOrder = (left, right) => {
  const byDate = getBatchSortValue(right) - getBatchSortValue(left);
  if (byDate !== 0) return byDate;
  const leftId = String(left?.id || '');
  const rightId = String(right?.id || '');
  if (leftId === rightId) return 0;
  return rightId > leftId ? 1 : -1;
};

const normalizePageSize = (pageSize) => {
  const parsed = Number(pageSize);
  if (!Number.isInteger(parsed) || parsed <= 0) return BATCH_MANAGER_PAGE_SIZE;
  return Math.min(parsed, 200);
};

const normalizeCursor = (cursor) => {
  if (!cursor) return null;
  const sortValue = Number(cursor.sortValue);
  const id = String(cursor.id || '');
  if (!Number.isFinite(sortValue) || !id) {
    throw new TypeError('El cursor de lotes no es válido.');
  }
  return { sortValue, id };
};

const isAfterCursor = (batch, cursor) => {
  if (!cursor) return true;
  const sortValue = getBatchSortValue(batch);
  if (sortValue !== cursor.sortValue) return sortValue < cursor.sortValue;
  return String(batch?.id || '') < cursor.id;
};

const createEmptySummary = () => ({
  totalRecords: 0,
  activeRecords: 0,
  archivedRecords: 0,
  totalPhysicalStock: 0,
  totalAvailableStock: 0,
  totalCommittedStock: 0,
  inventoryValue: 0
});

const addToSummary = (summary, batch, logicalStatus) => {
  summary.totalRecords += 1;
  if (logicalStatus === 'active') {
    const stock = toFiniteNumber(batch?.stock);
    summary.activeRecords += 1;
    summary.totalPhysicalStock += stock;
    summary.totalAvailableStock += toFiniteNumber(getAvailableStock(batch));
    summary.totalCommittedStock += toFiniteNumber(getCommittedStock(batch));
    // Preserva la semántica previa: costo por stock físico de lotes activos.
    summary.inventoryValue += toFiniteNumber(batch?.cost) * stock;
  } else {
    summary.archivedRecords += 1;
  }
};

const insertBounded = (items, batch, maximumSize) => {
  items.push(batch);
  items.sort(compareBatchManagerOrder);
  if (items.length > maximumSize) items.pop();
};

const scanBatchManager = async ({
  productId,
  status = 'all',
  cursor = null,
  pageSize = BATCH_MANAGER_PAGE_SIZE,
  includeSummary = false
}) => {
  if (!productId) throw new TypeError('queryBatchManagerPage: productId es requerido.');
  if (!VALID_FILTERS.has(status)) throw new TypeError(`Estado de lotes no soportado: ${status}`);

  const requestedLimit = normalizePageSize(pageSize);
  const normalizedCursor = normalizeCursor(cursor);
  const candidates = [];
  const summary = includeSummary ? createEmptySummary() : null;

  await db.table(STORES.PRODUCT_BATCHES)
    .where('productId')
    .equals(productId)
    .each((batch) => {
      const logicalStatus = getBatchManagerStatus(batch);
      if (summary) addToSummary(summary, batch, logicalStatus);
      if (status !== 'all' && logicalStatus !== status) return;
      if (!isAfterCursor(batch, normalizedCursor)) return;
      insertBounded(candidates, batch, requestedLimit + 1);
    });

  const hasMore = candidates.length > requestedLimit;
  const items = hasMore ? candidates.slice(0, requestedLimit) : candidates;
  const lastItem = items.at(-1);

  return {
    page: {
      items,
      nextCursor: hasMore && lastItem
        ? { sortValue: getBatchSortValue(lastItem), id: String(lastItem.id) }
        : null,
      hasMore,
      requestedLimit
    },
    summary
  };
};

export const queryBatchManagerPage = async (options) => {
  const { page } = await scanBatchManager(options);
  return page;
};

export const queryBatchManagerSummary = async (productId) => {
  const { summary } = await scanBatchManager({
    productId,
    pageSize: 1,
    includeSummary: true
  });
  return summary;
};

export const queryBatchManagerSnapshot = async (options) => {
  const { page, summary } = await scanBatchManager({
    ...options,
    cursor: null,
    includeSummary: true
  });
  return { ...page, summary };
};
