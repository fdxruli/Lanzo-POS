import { EXPIRY_DAYS_THRESHOLD } from '../db/utils';
import { getBatchExpiryStatus } from '../../utils/dateUtils';
import { getBatchExpiryValue, getDaysUntilBatchExpiry, isBatchActiveForFefo } from './fefoUtils';

const isUsableExpiry = (value, now) => ['expired', 'expires_today', 'valid'].includes(
  getBatchExpiryStatus({ expiryDate: value }, now)
);

export const getProductBatchSummary = (batches = [], now = new Date()) => {
  const activeBatches = (Array.isArray(batches) ? batches : []).filter(isBatchActiveForFefo);
  const nearestBatch = activeBatches
    .filter((batch) => isUsableExpiry(getBatchExpiryValue(batch), now))
    .sort((left, right) => String(getBatchExpiryValue(left)).localeCompare(String(getBatchExpiryValue(right))))[0] || null;
  const nearestExpiryDate = nearestBatch ? getBatchExpiryValue(nearestBatch) : null;

  return {
    activeBatchCount: activeBatches.length,
    nearestExpiryDate,
    nextExpiryDate: nearestExpiryDate,
    nearestAlertTargetDate: nearestBatch?.alertTargetDate ?? nearestBatch?.alert_target_date ?? null,
    manufacturerBatchId: nearestBatch?.manufacturerBatchId ?? nearestBatch?.manufacturer_batch_id ?? null,
    supplier: nearestBatch?.supplier ?? null,
    batchId: nearestBatch?.id ?? nearestBatch?.batchId ?? null,
    expiryStatus: nearestExpiryDate ? getBatchExpiryStatus({ expiryDate: nearestExpiryDate }, now) : 'missing',
    daysUntilExpiry: nearestBatch ? getDaysUntilBatchExpiry(nearestBatch, now) : null
  };
};

export const getProductBatchSummaryMap = (batches = [], now = new Date()) => {
  const grouped = new Map();
  (Array.isArray(batches) ? batches : []).forEach((batch) => {
    const productId = batch?.productId ?? batch?.product_id;
    if (!productId) return;
    const productBatches = grouped.get(productId) || [];
    productBatches.push(batch);
    grouped.set(productId, productBatches);
  });
  return new Map([...grouped].map(([productId, productBatches]) => [productId, getProductBatchSummary(productBatches, now)]));
};

export const getProductCardExpiryState = (product = {}, batchSummary = null, now = new Date()) => {
  const hasBatchAuthority = batchSummary?.activeBatchCount > 0;
  const expiryDate = hasBatchAuthority ? batchSummary.nearestExpiryDate : product.expiryDate;
  const status = expiryDate ? getBatchExpiryStatus({ expiryDate }, now) : 'missing';
  const daysUntilExpiry = expiryDate ? getDaysUntilBatchExpiry({ expiryDate }, now) : null;
  const isNearingExpiry = ['valid', 'expires_today'].includes(status)
    && Number.isFinite(daysUntilExpiry)
    && daysUntilExpiry <= EXPIRY_DAYS_THRESHOLD;

  return { expiryDate, status, daysUntilExpiry, isExpired: status === 'expired', isNearingExpiry };
};

export const formatShelfLife = (value, unit) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const labels = {
    days: amount === 1 ? 'día' : 'días',
    weeks: amount === 1 ? 'semana' : 'semanas',
    months: amount === 1 ? 'mes' : 'meses'
  };
  return `${amount} ${labels[unit] || labels.days}`;
};
