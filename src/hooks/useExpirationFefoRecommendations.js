import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadData, STORES } from '../services/database';
import { getCloudExpirationFefoRecommendations } from '../services/products/productExpirationWasteCloudRepository';
import {
  getLicenseKeyFromDetails,
  isCloudProductsSyncEnabled
} from '../services/sync/syncConstants';
import { useAppStore } from '../store/useAppStore';
import Logger from '../services/Logger';

const EMPTY_SUMMARY = Object.freeze({
  products_with_risk: 0,
  batches_at_risk: 0,
  expired_batches: 0,
  critical_batches: 0,
  warning_batches: 0,
  stock_at_risk: 0,
  value_at_risk: 0
});

const RISK_PRIORITY = Object.freeze({
  expired: 0,
  critical: 1,
  warning: 2,
  watch: 3,
  ok: 4
});

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

const toSafeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toSafeLimit = (value = 100) => Math.min(
  Math.max(Number(value) || 100, 1),
  500
);

const toSafeDaysAhead = (value = 30) => Math.min(
  Math.max(Number(value) || 30, 1),
  365
);

const toSafeString = (value, fallback = '') => {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
};

const normalizeDateOnly = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const startOfLocalDay = (value = new Date()) => {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const calculateDaysRemaining = (dateValue, now = new Date()) => {
  const dateOnly = normalizeDateOnly(dateValue);
  if (!dateOnly) return null;

  const expiry = startOfLocalDay(`${dateOnly}T00:00:00`);
  const today = startOfLocalDay(now);
  return Math.ceil((expiry.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
};

const getRiskLevel = (daysRemaining, daysAhead) => {
  if (daysRemaining === null || daysRemaining === undefined) return 'ok';
  if (daysRemaining < 0) return 'expired';
  if (daysRemaining <= 3) return 'critical';
  if (daysRemaining <= 7) return 'warning';
  if (daysRemaining <= daysAhead) return 'watch';
  return 'ok';
};

const isRisk = (riskLevel) => riskLevel && riskLevel !== 'ok';

const getRecommendation = ({ riskLevel, newerBatchesCount }) => {
  if (riskLevel === 'expired') {
    return 'Revisa este lote hoy; ya está vencido o requiere merma.';
  }

  if (newerBatchesCount > 0) {
    return 'Vende primero este lote antes de usar lotes nuevos.';
  }

  if (riskLevel === 'critical') {
    return 'Prioriza este lote hoy; está a punto de vencer.';
  }

  if (riskLevel === 'warning') {
    return 'Considera promoción o rotación interna para evitar pérdida.';
  }

  if (riskLevel === 'watch') {
    return 'Este producto tiene lote próximo a vencer; priorízalo en exhibición.';
  }

  return 'Sin acción preventiva inmediata.';
};

const isDeletedRecord = (record = {}) => Boolean(
  record.deletedAt ||
  record.deleted_at ||
  String(record.status || '').toLowerCase() === 'archived'
);

const isActiveRecord = (record = {}) => (
  record.isActive !== false &&
  record.is_active !== false &&
  String(record.status || 'active').toLowerCase() !== 'inactive'
);

const getAvailableStock = (record = {}) => Math.max(
  toSafeNumber(record.stock, 0) -
  toSafeNumber(record.committedStock ?? record.committed_stock, 0),
  0
);

const getProductUnit = (product = {}) => {
  const bulkData = product.bulkData || product.bulk_data || {};
  return toSafeString(
    bulkData?.purchase?.unit ||
    bulkData?.sale?.unit ||
    bulkData?.stock?.unit ||
    bulkData?.unit ||
    product.purchaseUnit ||
    product.unit,
    'u'
  );
};

const compareCandidates = (a, b) => {
  const aExpiry = normalizeDateOnly(a.recommendedExpiryDate || a.expiryDate);
  const bExpiry = normalizeDateOnly(b.recommendedExpiryDate || b.expiryDate);

  if (aExpiry && bExpiry && aExpiry !== bExpiry) return aExpiry.localeCompare(bExpiry);
  if (aExpiry && !bExpiry) return -1;
  if (!aExpiry && bExpiry) return 1;

  const aCreated = Date.parse(a.createdAt || a.created_at || 0) || 0;
  const bCreated = Date.parse(b.createdAt || b.created_at || 0) || 0;
  if (aCreated !== bCreated) return aCreated - bCreated;

  return String(a.recommendedBatchId || a.batchId || a.id || '')
    .localeCompare(String(b.recommendedBatchId || b.batchId || b.id || ''));
};

const normalizeSummary = (summary = {}, fallbackItems = []) => ({
  products_with_risk: toSafeNumber(summary.products_with_risk ?? summary.productsWithRisk, fallbackItems.length),
  batches_at_risk: toSafeNumber(summary.batches_at_risk ?? summary.batchesAtRisk, 0),
  expired_batches: toSafeNumber(summary.expired_batches ?? summary.expiredBatches, 0),
  critical_batches: toSafeNumber(summary.critical_batches ?? summary.criticalBatches, 0),
  warning_batches: toSafeNumber(summary.warning_batches ?? summary.warningBatches, 0),
  stock_at_risk: toSafeNumber(summary.stock_at_risk ?? summary.stockAtRisk, 0),
  value_at_risk: toSafeNumber(summary.value_at_risk ?? summary.valueAtRisk, 0)
});

const getCloudItems = (response = {}) => [
  response.items,
  response.rows,
  response.data,
  response.recommendations
].find(Array.isArray) || [];

const normalizeFefoItem = (record = {}, source = 'local') => ({
  productId: record.productId ?? record.product_id ?? null,
  productName: toSafeString(record.productName ?? record.product_name, 'Producto'),
  expirationMode: toSafeString(record.expirationMode ?? record.expiration_mode, 'NONE'),
  recommendedBatchId: record.recommendedBatchId ?? record.recommended_batch_id ?? record.batchId ?? record.batch_id ?? null,
  recommendedBatchSku: toSafeString(
    record.recommendedBatchSku ?? record.recommended_batch_sku ?? record.batchSku ?? record.batch_sku,
    'Lote'
  ),
  recommendedExpiryDate: normalizeDateOnly(
    record.recommendedExpiryDate ?? record.recommended_expiry_date ?? record.expiryDate ?? record.expiry_date
  ),
  daysRemaining: record.daysRemaining ?? record.days_remaining ?? null,
  riskLevel: toSafeString(record.riskLevel ?? record.risk_level, 'ok'),
  availableStock: toSafeNumber(record.availableStock ?? record.available_stock, 0),
  unitCost: toSafeNumber(record.unitCost ?? record.unit_cost, 0),
  valueAtRisk: toSafeNumber(record.valueAtRisk ?? record.value_at_risk, 0),
  unit: toSafeString(record.unit, 'u'),
  olderBatchesCount: toSafeNumber(record.olderBatchesCount ?? record.older_batches_count, 0),
  newerBatchesCount: toSafeNumber(record.newerBatchesCount ?? record.newer_batches_count, 0),
  recommendation: toSafeString(record.recommendation, 'Sin acción preventiva inmediata.'),
  source
});

export const buildLocalExpirationFefoRecommendations = ({
  products = [],
  batches = [],
  daysAhead = 30,
  limit = 100,
  now = new Date()
} = {}) => {
  const safeDaysAhead = toSafeDaysAhead(daysAhead);
  const safeLimit = toSafeLimit(limit);
  const productsById = new Map((Array.isArray(products) ? products : [])
    .filter((product) => product?.id && !isDeletedRecord(product) && isActiveRecord(product))
    .map((product) => [product.id, product]));

  const candidates = (Array.isArray(batches) ? batches : [])
    .map((batch) => {
      const productId = batch.productId ?? batch.product_id;
      const product = productsById.get(productId);
      if (!product || isDeletedRecord(batch) || !isActiveRecord(batch) || batch.trackStock === false || batch.track_stock === false) {
        return null;
      }

      const availableStock = getAvailableStock(batch);
      if (availableStock <= 0) return null;

      const expiryDate = normalizeDateOnly(batch.expiryDate ?? batch.expiry_date ?? batch.alertTargetDate ?? batch.alert_target_date);
      const daysRemaining = calculateDaysRemaining(expiryDate, now);
      const riskLevel = getRiskLevel(daysRemaining, safeDaysAhead);
      const unitCost = toSafeNumber(batch.cost, toSafeNumber(product.cost, 0));

      return {
        productId,
        productName: toSafeString(product.name, 'Producto'),
        expirationMode: toSafeString(product.expirationMode ?? product.expiration_mode, 'NONE'),
        recommendedBatchId: batch.id,
        recommendedBatchSku: toSafeString(batch.sku || batch.manufacturerBatchId || batch.manufacturer_batch_id, 'Lote'),
        recommendedExpiryDate: expiryDate,
        daysRemaining,
        riskLevel,
        availableStock,
        unitCost,
        valueAtRisk: availableStock * unitCost,
        unit: getProductUnit(product),
        createdAt: batch.createdAt ?? batch.created_at,
        source: 'local'
      };
    })
    .filter(Boolean);

  const byProduct = new Map();
  candidates
    .sort(compareCandidates)
    .forEach((candidate) => {
      const group = byProduct.get(candidate.productId) || [];
      group.push(candidate);
      byProduct.set(candidate.productId, group);
    });

  const riskCandidates = candidates.filter((candidate) => isRisk(candidate.riskLevel));
  const riskProductIds = new Set(riskCandidates.map((candidate) => candidate.productId));

  const items = Array.from(byProduct.values())
    .map((group) => {
      const recommended = group[0];
      if (!recommended || !isRisk(recommended.riskLevel)) return null;

      const olderBatchesCount = group.filter((batch) => {
        if (!recommended.recommendedExpiryDate || !batch.recommendedExpiryDate) return false;
        return batch.recommendedExpiryDate < recommended.recommendedExpiryDate;
      }).length;

      const newerBatchesCount = group.filter((batch) => {
        if (batch.recommendedBatchId === recommended.recommendedBatchId || !recommended.recommendedExpiryDate) return false;
        return !batch.recommendedExpiryDate || batch.recommendedExpiryDate > recommended.recommendedExpiryDate;
      }).length;

      return normalizeFefoItem({
        ...recommended,
        olderBatchesCount,
        newerBatchesCount,
        recommendation: getRecommendation({
          riskLevel: recommended.riskLevel,
          newerBatchesCount
        })
      }, 'local');
    })
    .filter(Boolean)
    .sort((a, b) => {
      const priority = (RISK_PRIORITY[a.riskLevel] ?? RISK_PRIORITY.ok) - (RISK_PRIORITY[b.riskLevel] ?? RISK_PRIORITY.ok);
      if (priority !== 0) return priority;
      return toSafeNumber(a.daysRemaining, 9999) - toSafeNumber(b.daysRemaining, 9999);
    })
    .slice(0, safeLimit);

  const summary = {
    products_with_risk: riskProductIds.size,
    batches_at_risk: riskCandidates.length,
    expired_batches: riskCandidates.filter((candidate) => candidate.riskLevel === 'expired').length,
    critical_batches: riskCandidates.filter((candidate) => candidate.riskLevel === 'critical').length,
    warning_batches: riskCandidates.filter((candidate) => candidate.riskLevel === 'warning').length,
    stock_at_risk: riskCandidates.reduce((sum, candidate) => sum + toSafeNumber(candidate.availableStock, 0), 0),
    value_at_risk: riskCandidates.reduce((sum, candidate) => sum + toSafeNumber(candidate.valueAtRisk, 0), 0)
  };

  return {
    success: true,
    summary,
    items,
    daysAhead: safeDaysAhead,
    source: 'local'
  };
};

const loadLocalExpirationFefoRecommendations = async ({ daysAhead = 30, limit = 100 } = {}) => {
  const [products, batches] = await Promise.all([
    loadData(STORES.MENU),
    loadData(STORES.PRODUCT_BATCHES)
  ]);

  return buildLocalExpirationFefoRecommendations({
    products: products || [],
    batches: batches || [],
    daysAhead,
    limit
  });
};

const sanitizeFefoError = (errorOrResponse = {}) => {
  const code = String(
    errorOrResponse?.code ||
    errorOrResponse?.error_code ||
    errorOrResponse?.errorCode ||
    errorOrResponse?.response?.code ||
    errorOrResponse?.payload?.code ||
    ''
  ).toUpperCase();

  if (code.includes('PERMISSION') || code === 'NO_PERMISSION') {
    return 'Necesitas acceso a reportes para consultar la prevención FEFO.';
  }

  if (code === 'POS_SYNC_AUTH_CONTEXT_INCOMPLETE' || code === 'DEVICE_TOKEN_REQUIRED') {
    return 'No se pudo validar este dispositivo. Vuelve a iniciar sesión o actualiza la licencia.';
  }

  if (code === 'RATE_LIMITED') {
    return 'Hay demasiadas solicitudes de reportes en este momento. Intenta de nuevo en unos segundos.';
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
    return 'Necesitas acceso a reportes para consultar la prevención FEFO.';
  }

  if (
    rawMessage.includes('failed to fetch') ||
    rawMessage.includes('network') ||
    rawMessage.includes('timeout') ||
    rawMessage.includes('offline') ||
    rawMessage.includes('internet')
  ) {
    return 'No hay conexión para calcular recomendaciones FEFO cloud. No se muestran datos locales como definitivos.';
  }

  return 'No se pudieron cargar las recomendaciones FEFO. Intenta de nuevo en unos segundos.';
};

export const useExpirationFefoRecommendations = ({ daysAhead = 30, limit = 100 } = {}) => {
  const safeDaysAhead = useMemo(() => toSafeDaysAhead(daysAhead), [daysAhead]);
  const safeLimit = useMemo(() => toSafeLimit(limit), [limit]);
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

  const loadRecommendations = useCallback(async ({ force = false } = {}) => {
    if (!hasReportsPermission) {
      setItems([]);
      setSummary(EMPTY_SUMMARY);
      setSource(cloudProductsEnabled ? 'cloud' : 'local');
      setError('Necesitas acceso a reportes para consultar la prevención FEFO.');
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
          setError('No hay conexión para calcular recomendaciones FEFO cloud. No se muestran datos locales como definitivos.');
          return;
        }

        response = await getCloudExpirationFefoRecommendations({
          licenseKey,
          daysAhead: safeDaysAhead,
          limit: safeLimit,
          force
        });

        if (response?.success === false || response?.ok === false) {
          setItems([]);
          setSummary(EMPTY_SUMMARY);
          setSource('cloud');
          setError(sanitizeFefoError(response));
          return;
        }

        const cloudItems = getCloudItems(response).map((row) => normalizeFefoItem(row, 'cloud'));
        setItems(cloudItems);
        setSummary(normalizeSummary(response?.summary, cloudItems));
        setSource('cloud');
        return;
      }

      response = await loadLocalExpirationFefoRecommendations({
        daysAhead: safeDaysAhead,
        limit: safeLimit
      });
      setItems(response.items);
      setSummary(normalizeSummary(response.summary, response.items));
      setSource('local');
    } catch (loadError) {
      Logger.warn('[ExpirationFefoRecommendations] No se pudieron cargar recomendaciones FEFO:', loadError);
      setItems([]);
      setSummary(EMPTY_SUMMARY);
      setSource(cloudProductsEnabled ? 'cloud' : 'local');
      setError(sanitizeFefoError(loadError));
    } finally {
      setLoading(false);
    }
  }, [cloudProductsEnabled, hasReportsPermission, licenseKey, safeDaysAhead, safeLimit]);

  useEffect(() => {
    loadRecommendations();
  }, [loadRecommendations]);

  const refresh = useCallback(() => loadRecommendations({ force: true }), [loadRecommendations]);

  return {
    items,
    summary,
    loading,
    error,
    source,
    isCloud: cloudProductsEnabled,
    hasReportsPermission,
    daysAhead: safeDaysAhead,
    limit: safeLimit,
    refresh
  };
};

export default useExpirationFefoRecommendations;
