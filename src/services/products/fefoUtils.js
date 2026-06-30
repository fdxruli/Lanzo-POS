import { getAvailableStock, normalizeStock } from '../db/utils';
import {
  extractCalendarDate,
  getBatchExpiryStatus,
  isBatchExpiredForSale as isStrictBatchExpiredForSale,
  parseDateStrict
} from '../../utils/dateUtils';

const REMOVED_BATCH_STATUSES = new Set(['deleted', 'removed', 'archived']);

const toLocalCalendarDate = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const calendarDateToUtcMs = (calendarDate) => {
  if (!calendarDate || !/^\d{4}-\d{2}-\d{2}$/.test(calendarDate)) return null;
  const [year, month, day] = calendarDate.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
};

export const getBatchId = (batch) => batch?.id ?? batch?.batchId ?? batch?.batch_id ?? null;

export const getBatchDisplayCode = (batch) => (
  batch?.sku
  || batch?.batchSku
  || batch?.batch_sku
  || getBatchId(batch)
  || 'recomendado'
);

export const getBatchExpiryValue = (batch) => (
  batch?.expiryDate
  ?? batch?.expiry_date
  ?? batch?.alertTargetDate
  ?? batch?.alert_target_date
  ?? null
);

export const getBatchCreatedValue = (batch) => (
  batch?.createdAt
  ?? batch?.created_at
  ?? batch?.created
  ?? null
);

export const getAvailableBatchStock = (batch) => getAvailableStock({
  stock: batch?.stock ?? batch?.quantity ?? 0,
  committedStock: batch?.committedStock ?? batch?.committed_stock ?? 0
});

export const isBatchRemoved = (batch) => {
  const status = String(batch?.status || '').trim().toLowerCase();
  return Boolean(
    batch?.deletedAt
    || batch?.deleted_at
    || batch?.isDeleted
    || batch?.is_deleted
    || REMOVED_BATCH_STATUSES.has(status)
  );
};

export const isBatchActiveForFefo = (batch) => {
  const isActive = batch?.isActive ?? batch?.is_active;
  return isActive !== false && !isBatchRemoved(batch);
};

export const isBatchExpiredForSale = (batch, product, now = new Date()) => (
  isStrictBatchExpiredForSale(
    { ...batch, expiryDate: getBatchExpiryValue(batch) },
    product,
    now
  )
);

export const sortBatchesByFefo = (batches = []) => {
  if (!Array.isArray(batches)) return [];

  return batches
    .map((batch, index) => ({ batch: { ...batch }, index }))
    .sort((left, right) => {
      const leftExpiry = parseDateStrict(getBatchExpiryValue(left.batch))?.getTime() ?? Number.POSITIVE_INFINITY;
      const rightExpiry = parseDateStrict(getBatchExpiryValue(right.batch))?.getTime() ?? Number.POSITIVE_INFINITY;

      if (leftExpiry !== rightExpiry) return leftExpiry - rightExpiry;

      const leftCreated = parseDateStrict(getBatchCreatedValue(left.batch))?.getTime() ?? Number.POSITIVE_INFINITY;
      const rightCreated = parseDateStrict(getBatchCreatedValue(right.batch))?.getTime() ?? Number.POSITIVE_INFINITY;

      if (leftCreated !== rightCreated) return leftCreated - rightCreated;
      return left.index - right.index;
    })
    .map(({ batch }) => batch);
};

export const getRecommendedFefoBatch = (batches = [], product, { now = new Date() } = {}) => {
  const eligibleBatches = (Array.isArray(batches) ? batches : []).filter((batch) => (
    isBatchActiveForFefo(batch)
    && getAvailableBatchStock(batch) > 0
    && !isBatchExpiredForSale(batch, product, now)
  ));

  return sortBatchesByFefo(eligibleBatches)[0] || null;
};

export const getDaysUntilBatchExpiry = (batch, now = new Date()) => {
  const expiryCalendarDate = extractCalendarDate(getBatchExpiryValue(batch));
  const todayCalendarDate = toLocalCalendarDate(now);
  const expiryMs = calendarDateToUtcMs(expiryCalendarDate);
  const todayMs = calendarDateToUtcMs(todayCalendarDate);

  if (expiryMs === null || todayMs === null) return null;
  return Math.floor((expiryMs - todayMs) / (24 * 60 * 60 * 1000));
};

export const getFefoExpiryBadge = (batch, now = new Date()) => {
  const expiryValue = getBatchExpiryValue(batch);
  if (!expiryValue) return null;

  const status = getBatchExpiryStatus({ expiryDate: expiryValue }, now);
  const daysUntilExpiry = getDaysUntilBatchExpiry(batch, now);

  if (status === 'expired') {
    return { label: 'Vencido', tone: 'danger', status, daysUntilExpiry };
  }

  if (status === 'expires_today') {
    return { label: 'Vence hoy', tone: 'warning', status, daysUntilExpiry: 0 };
  }

  if (status === 'valid' && Number.isFinite(daysUntilExpiry)) {
    const label = daysUntilExpiry === 1 ? 'Vence en 1 día' : `Vence en ${daysUntilExpiry} días`;
    return {
      label,
      tone: daysUntilExpiry <= 7 ? 'warning' : 'neutral',
      status,
      daysUntilExpiry
    };
  }

  return null;
};

export const getFefoWarningForSelection = ({
  selectedBatch,
  recommendedBatch,
  product,
  now = new Date()
} = {}) => {
  if (!selectedBatch) return null;

  if (isBatchExpiredForSale(selectedBatch, product, now)) {
    return {
      type: 'danger',
      blocking: true,
      message: 'Este lote está vencido y no puede venderse.'
    };
  }

  const selectedBatchId = getBatchId(selectedBatch);
  const recommendedBatchId = getBatchId(recommendedBatch);

  if (recommendedBatchId && selectedBatchId && selectedBatchId !== recommendedBatchId) {
    return {
      type: 'warning',
      blocking: false,
      message: `Hay un lote más próximo a caducar disponible. Se recomienda vender primero el lote ${getBatchDisplayCode(recommendedBatch)}.`
    };
  }

  return null;
};

export const getFefoSelectionState = ({
  batch,
  product,
  recommendedBatch,
  now = new Date()
} = {}) => {
  const batchId = getBatchId(batch);
  const recommendedBatchId = getBatchId(recommendedBatch);
  const isRecommended = Boolean(batchId && recommendedBatchId && batchId === recommendedBatchId);
  const isBlocked = isBatchExpiredForSale(batch, product, now);
  const availableStock = normalizeStock(getAvailableBatchStock(batch));

  return {
    isRecommended,
    isBlocked,
    availableStock,
    expiryBadge: getFefoExpiryBadge(batch, now),
    warning: getFefoWarningForSelection({ selectedBatch: batch, recommendedBatch, product, now })
  };
};
