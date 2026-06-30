import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadData, STORES } from '../services/database';
import { getCloudExpirationWasteHistory } from '../services/products/productExpirationWasteCloudRepository';
import {
  getLicenseKeyFromDetails,
  isCloudProductsSyncEnabled
} from '../services/sync/syncConstants';
import { useAppStore } from '../store/useAppStore';
import Logger from '../services/Logger';

const EMPTY_SUMMARY = Object.freeze({
  total_records: 0,
  total_quantity: 0,
  total_loss_amount: 0,
  total_batches: 0,
  total_products: 0,
  partial_count: 0,
  total_count: 0
});

const EXPIRATION_REASONS = new Set(['caducidad', 'caducidad_parcial']);

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

const toSafeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toSafeString = (value, fallback = '') => {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
};

const normalizeReason = (value) => toSafeString(value).toLowerCase();

const isExpirationWasteRecord = (record = {}) => {
  const reason = normalizeReason(record.reason);
  const notes = normalizeReason(record.notes);

  return (
    EXPIRATION_REASONS.has(reason) ||
    notes.includes('caducidad')
  );
};

const inferWasteType = (record = {}) => {
  const reason = normalizeReason(record.reason);
  const notes = normalizeReason(record.notes);
  const explicit = normalizeReason(record.wasteType || record.waste_type);

  if (explicit === 'total' || explicit === 'partial') return explicit;
  if (reason === 'caducidad_parcial' || notes.includes('parcial')) return 'partial';
  if (reason === 'caducidad') return 'total';
  return 'unknown';
};

const normalizeTimestamp = (value) => {
  const fallback = new Date(0).toISOString();
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
};

const normalizeHistoryItem = (record = {}, source = 'local') => {
  const quantity = toSafeNumber(record.quantity ?? record.quantityWrittenOff ?? record.quantity_written_off, 0);
  const costAtTime = toSafeNumber(record.costAtTime ?? record.cost_at_time ?? record.unit_cost, 0);
  const lossAmount = toSafeNumber(
    record.lossAmount ?? record.loss_amount ?? record.totalLoss ?? record.total_cost,
    quantity * costAtTime
  );

  return {
    id: toSafeString(record.id, `${source}-waste-${record.batchId || record.batch_id || Date.now()}`),
    productId: record.productId ?? record.product_id ?? null,
    productName: toSafeString(record.productName ?? record.product_name, 'Producto eliminado'),
    batchId: record.batchId ?? record.batch_id ?? null,
    batchSku: toSafeString(record.batchSku ?? record.batch_sku ?? record.sku, 'Lote'),
    quantity,
    unit: toSafeString(record.unit, 'u'),
    costAtTime,
    lossAmount,
    reason: toSafeString(record.reason, 'caducidad'),
    wasteType: inferWasteType(record),
    notes: toSafeString(record.notes, ''),
    expiryDate: record.expiryDate ?? record.expiry_date ?? null,
    timestamp: normalizeTimestamp(record.timestamp ?? record.created_at ?? record.createdAt),
    actorName: toSafeString(record.actorName ?? record.actor_name, ''),
    source
  };
};

const buildSummary = (items = []) => {
  const productIds = new Set();
  const batchIds = new Set();

  const totals = items.reduce((acc, item) => {
    acc.total_quantity += toSafeNumber(item.quantity, 0);
    acc.total_loss_amount += toSafeNumber(item.lossAmount, 0);
    if (item.productId) productIds.add(item.productId);
    if (item.batchId) batchIds.add(item.batchId);
    if (item.wasteType === 'partial') acc.partial_count += 1;
    if (item.wasteType === 'total') acc.total_count += 1;
    return acc;
  }, {
    total_records: items.length,
    total_quantity: 0,
    total_loss_amount: 0,
    total_batches: 0,
    total_products: 0,
    partial_count: 0,
    total_count: 0
  });

  totals.total_batches = batchIds.size;
  totals.total_products = productIds.size;
  return totals;
};

const normalizeSummary = (summary = {}, fallbackItems = []) => ({
  total_records: toSafeNumber(summary.total_records ?? summary.totalRecords, fallbackItems.length),
  total_quantity: toSafeNumber(summary.total_quantity ?? summary.totalQuantity, 0),
  total_loss_amount: toSafeNumber(summary.total_loss_amount ?? summary.totalLossAmount, 0),
  total_batches: toSafeNumber(summary.total_batches ?? summary.totalBatches, 0),
  total_products: toSafeNumber(summary.total_products ?? summary.totalProducts, 0),
  partial_count: toSafeNumber(summary.partial_count ?? summary.partialCount, 0),
  total_count: toSafeNumber(summary.total_count ?? summary.totalCount, 0)
});

const getCloudItems = (response = {}) => [
  response.items,
  response.rows,
  response.data,
  response.history,
  response.records
].find(Array.isArray) || [];

const loadLocalExpirationWasteHistory = async ({ limit = 100 } = {}) => {
  const rows = await loadData(STORES.WASTE);
  const items = (Array.isArray(rows) ? rows : [])
    .filter(isExpirationWasteRecord)
    .map((row) => normalizeHistoryItem(row, 'local'))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return {
    success: true,
    summary: buildSummary(items),
    items: items.slice(0, Math.max(1, Number(limit) || 100)),
    source: 'local'
  };
};

const sanitizeHistoryError = (errorOrResponse = {}) => {
  const code = String(
    errorOrResponse?.code ||
    errorOrResponse?.error_code ||
    errorOrResponse?.errorCode ||
    errorOrResponse?.response?.code ||
    errorOrResponse?.payload?.code ||
    ''
  ).toUpperCase();

  if (code.includes('PERMISSION') || code === 'NO_PERMISSION') {
    return 'No tienes permiso para consultar el historial de mermas por caducidad.';
  }

  if (code === 'POS_SYNC_AUTH_CONTEXT_INCOMPLETE' || code === 'DEVICE_TOKEN_REQUIRED') {
    return 'No se pudo validar este dispositivo. Vuelve a iniciar sesión o actualiza la licencia.';
  }

  const rawMessage = String(
    errorOrResponse?.message ||
    errorOrResponse?.error ||
    errorOrResponse?.response?.message ||
    errorOrResponse?.payload?.message ||
    ''
  ).toLowerCase();

  if (
    rawMessage.includes('permission') ||
    rawMessage.includes('denied') ||
    rawMessage.includes('permiso')
  ) {
    return 'No tienes permiso para consultar el historial de mermas por caducidad.';
  }

  if (
    rawMessage.includes('failed to fetch') ||
    rawMessage.includes('network') ||
    rawMessage.includes('timeout') ||
    rawMessage.includes('offline') ||
    rawMessage.includes('internet')
  ) {
    return 'No hay conexión estable para consultar el historial cloud. Intenta de nuevo cuando tengas internet.';
  }

  return 'No se pudo cargar el historial de mermas por caducidad. Intenta de nuevo en unos segundos.';
};

export const useExpirationWasteHistory = ({ limit = 100 } = {}) => {
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const canAccess = useAppStore((state) => state.canAccess);
  const licenseKey = useMemo(() => getLicenseKeyFromDetails(licenseDetails), [licenseDetails]);
  const cloudProductsEnabled = useMemo(
    () => Boolean(licenseKey && isCloudProductsSyncEnabled(licenseDetails)),
    [licenseDetails, licenseKey]
  );
  const hasReportsPermission = typeof canAccess !== 'function' || canAccess('reports') === true;

  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [source, setSource] = useState(cloudProductsEnabled ? 'cloud' : 'local');

  const loadHistory = useCallback(async ({ force = false } = {}) => {
    if (!hasReportsPermission) {
      setItems([]);
      setSummary(EMPTY_SUMMARY);
      setSource(cloudProductsEnabled ? 'cloud' : 'local');
      setError('No tienes permiso para consultar el historial de mermas por caducidad.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      let response;

      if (cloudProductsEnabled) {
        if (!licenseKey) {
          throw new Error('POS_SYNC_AUTH_CONTEXT_INCOMPLETE');
        }

        if (!isOnline()) {
          setItems([]);
          setSummary(EMPTY_SUMMARY);
          setSource('cloud');
          setError('No hay conexión para consultar el historial cloud. No se muestran datos locales como si fueran definitivos.');
          return;
        }

        response = await getCloudExpirationWasteHistory({
          licenseKey,
          limit,
          force
        });

        if (response?.success === false || response?.ok === false) {
          setItems([]);
          setSummary(EMPTY_SUMMARY);
          setSource('cloud');
          setError(sanitizeHistoryError(response));
          return;
        }

        const cloudItems = getCloudItems(response).map((row) => normalizeHistoryItem(row, 'cloud'));
        setItems(cloudItems);
        setSummary(normalizeSummary(response?.summary || buildSummary(cloudItems), cloudItems));
        setSource('cloud');
        return;
      }

      response = await loadLocalExpirationWasteHistory({ limit });
      setItems(response.items);
      setSummary(response.summary);
      setSource('local');
    } catch (loadError) {
      Logger.warn('[ExpirationWasteHistory] No se pudo cargar historial:', loadError);
      setItems([]);
      setSummary(EMPTY_SUMMARY);
      setSource(cloudProductsEnabled ? 'cloud' : 'local');
      setError(sanitizeHistoryError(loadError));
    } finally {
      setLoading(false);
    }
  }, [cloudProductsEnabled, hasReportsPermission, licenseKey, limit]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const refresh = useCallback(() => loadHistory({ force: true }), [loadHistory]);

  return {
    items,
    summary,
    loading,
    error,
    source,
    isCloud: cloudProductsEnabled,
    hasReportsPermission,
    refresh
  };
};

export default useExpirationWasteHistory;
