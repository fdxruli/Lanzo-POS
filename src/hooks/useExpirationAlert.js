import { useCallback, useEffect, useState, useMemo } from 'react';
import { getExpiringProductsReport } from '../services/inventoryAnalysis';
import { registerExpirationWaste, registerPartialExpirationWaste } from '../services/wasteService';
import {
  getCloudExpiringBatchesReport,
  registerCloudExpirationWaste
} from '../services/products/productExpirationWasteCloudRepository';
import { productLocalRepository } from '../services/products/productLocalRepository';
import { pullCatalogChanges } from '../services/products/productSyncHandler';
import { notifyProductsChanged } from '../services/products/productEvents';
import {
  getLicenseKeyFromDetails,
  isCloudProductsSyncEnabled
} from '../services/sync/syncConstants';
import { generateID } from '../services/utils';
import { useInventoryMovement } from '../hooks/useInventoryMovement';
import { useAppStore } from '../store/useAppStore';
import Logger from '../services/Logger';
import { normalizeBusinessType } from '../utils/businessType';

const STORAGE_KEY = 'ignored_expirations_ttl';
const IGNORE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 horas

const CLOUD_WASTE_MESSAGES = Object.freeze({
  BATCH_ID_REQUIRED: 'Selecciona un lote para registrar merma.',
  CLOUD_BATCH_NOT_AVAILABLE: 'Este lote ya no está disponible en la nube. Actualiza el catálogo.',
  PRODUCT_NOT_SYNCED_FOR_CLOUD_SALE: 'Este producto aún no está sincronizado en la nube.',
  NO_AVAILABLE_BATCH_STOCK: 'Este lote no tiene stock disponible para mandar a merma.',
  WASTE_QUANTITY_EXCEEDS_AVAILABLE: 'La cantidad supera el stock disponible del lote.',
  INVALID_WASTE_QUANTITY: 'Ingresa una cantidad válida para registrar merma.',
  IDEMPOTENCY_PROCESSING: 'La merma ya está en proceso. Espera unos segundos.',
  PERMISSION_DENIED: 'No tienes permiso para registrar merma. Pide acceso a productos/inventario.',
  NO_PERMISSION: 'No tienes permiso para registrar merma. Pide acceso a productos/inventario.',
  POS_PERMISSION_DENIED: 'No tienes permiso para registrar merma. Pide acceso a productos/inventario.',
  CLOUD_REQUEST_BACKOFF_ACTIVE: 'La nube está ocupada o recuperándose. Intenta de nuevo en unos segundos.',
  RATE_LIMITED: 'Hay demasiadas solicitudes en este momento. Intenta de nuevo en unos segundos.',
  POS_SYNC_AUTH_CONTEXT_INCOMPLETE: 'No se pudo validar este dispositivo. Vuelve a iniciar sesión o actualiza la licencia.',
  SUPABASE_NOT_CONFIGURED: 'La nube no está disponible en este momento.'
});

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

const toSafeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getCurrentStock = (item = {}) => toSafeNumber(
  item.currentStock ?? item.availableStock ?? item.stock,
  0
);

const getErrorCode = (errorOrResponse = {}) => (
  errorOrResponse?.code ||
  errorOrResponse?.error_code ||
  errorOrResponse?.errorCode ||
  errorOrResponse?.details?.code ||
  errorOrResponse?.response?.code ||
  errorOrResponse?.response?.error_code ||
  errorOrResponse?.response?.errorCode ||
  errorOrResponse?.payload?.code ||
  errorOrResponse?.payload?.error_code ||
  errorOrResponse?.payload?.errorCode ||
  errorOrResponse?.cause?.code ||
  errorOrResponse?.cause?.error_code ||
  errorOrResponse?.cause?.errorCode ||
  null
);

const sanitizeCloudWasteError = (errorOrResponse = {}) => {
  const code = getErrorCode(errorOrResponse);
  const normalizedCode = typeof code === 'string' ? code.trim().toUpperCase() : code;
  if (normalizedCode && CLOUD_WASTE_MESSAGES[normalizedCode]) return CLOUD_WASTE_MESSAGES[normalizedCode];

  const rawMessage = String(
    errorOrResponse?.message ||
    errorOrResponse?.error ||
    errorOrResponse?.response?.message ||
    errorOrResponse?.payload?.message ||
    errorOrResponse?.cause?.message ||
    ''
  );
  const normalized = rawMessage.toLowerCase();

  if (normalized.includes('permission') || normalized.includes('permiso') || normalized.includes('denied')) {
    return CLOUD_WASTE_MESSAGES.PERMISSION_DENIED;
  }

  if (
    normalized.includes('rate limit') ||
    normalized.includes('too many requests') ||
    normalized.includes('demasiadas solicitudes')
  ) {
    return CLOUD_WASTE_MESSAGES.RATE_LIMITED;
  }

  if (normalized.includes('backoff')) {
    return CLOUD_WASTE_MESSAGES.CLOUD_REQUEST_BACKOFF_ACTIVE;
  }

  if (
    normalized.includes('failed to fetch') ||
    normalized.includes('network') ||
    normalized.includes('timeout') ||
    normalized.includes('offline') ||
    normalized.includes('internet')
  ) {
    return 'No hay conexión estable para registrar la merma en la nube. Intenta de nuevo cuando tengas internet.';
  }

  if (normalized.includes('rpc') || normalized.includes('supabase') || normalized.includes('postgres')) {
    return 'No se pudo registrar la merma en la nube. Intenta de nuevo en unos segundos.';
  }

  return rawMessage || 'No se pudo registrar la merma en la nube. Intenta de nuevo.';
};

const getCloudReportRows = (response = {}) => {
  if (Array.isArray(response)) return response;
  return [
    response.batches,
    response.items,
    response.expiring_batches,
    response.expiringBatches,
    response.report,
    response.data
  ].find(Array.isArray) || [];
};

const getUrgencyLevel = (daysRemaining) => {
  if (daysRemaining <= 2) return 'critical';
  if (daysRemaining <= 5) return 'high';
  return 'medium';
};

const calculateDaysRemaining = (dateValue) => {
  const expiryMs = Date.parse(dateValue);
  if (!Number.isFinite(expiryMs)) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryMs);
  expiry.setHours(0, 0, 0, 0);
  return Math.ceil((expiry.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
};

const normalizeCloudExpiringReport = (response = {}) => getCloudReportRows(response)
  .map((row) => {
    const batch = row?.batch || row?.product_batch || row?.productBatch || row || {};
    const product = row?.product || {};
    const id = batch.id || row?.batch_id || row?.batchId;
    const productId = batch.product_id || batch.productId || row?.product_id || row?.productId || product.id;
    const expiryDate = batch.expiry_date || batch.expiryDate || row?.expiry_date || row?.expiryDate;
    const alertTargetDate = batch.alert_target_date || batch.alertTargetDate || row?.alert_target_date || row?.alertTargetDate || expiryDate;
    const stock = toSafeNumber(
      row?.available_quantity ??
      row?.availableQuantity ??
      row?.available_stock ??
      row?.availableStock ??
      batch.available_quantity ??
      batch.availableQuantity ??
      batch.stock ??
      row?.stock,
      0
    );
    const daysRemaining = toSafeNumber(
      row?.days_remaining ?? row?.daysRemaining ?? row?.days_left ?? row?.daysLeft,
      calculateDaysRemaining(alertTargetDate || expiryDate)
    );
    const productName = product.name || row?.product_name || row?.productName || row?.name || `Producto (${productId || 'sin ID'})`;

    if (!id || !productId || !alertTargetDate) return null;

    return {
      id,
      productId,
      productName,
      name: productName,
      stock,
      currentStock: stock,
      expiryDate,
      alertTargetDate,
      alertType: batch.alert_type || batch.alertType || row?.alert_type || row?.alertType || 'CADUCIDAD_LEGAL',
      daysRemaining,
      daysLeft: daysRemaining,
      batchSku: batch.sku || row?.batch_sku || row?.batchSku || 'Lote',
      location: batch.location || row?.location || product.location || '',
      type: 'Lote',
      urgencyLevel: row?.urgency_level || row?.urgencyLevel || getUrgencyLevel(daysRemaining)
    };
  })
  .filter(Boolean)
  .sort((a, b) => a.daysRemaining - b.daysRemaining);

/**
 * Hook personalizado para manejar la logica de alertas de caducidad
 * con persistencia en localStorage y registro de mermas.
 */
export const useExpirationAlert = () => {
  const { updateProductBatch } = useInventoryMovement();
  const companyProfile = useAppStore((state) => state.companyProfile);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const canAccess = useAppStore((state) => state.canAccess);
  const licenseKey = useMemo(() => getLicenseKeyFromDetails(licenseDetails), [licenseDetails]);
  const cloudProductsEnabled = useMemo(
    () => Boolean(licenseKey && isCloudProductsSyncEnabled(licenseDetails)),
    [licenseDetails, licenseKey]
  );

  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingItem, setEditingItem] = useState(null);
  const [newDate, setNewDate] = useState('');
  const [processingId, setProcessingId] = useState(null);

  // Leer ignored IDs desde localStorage
  const getIgnoredIds = useCallback(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return new Map();

      const parsed = JSON.parse(stored);
      const now = Date.now();
      const validMap = new Map();

      // Filtrar solo los que no han expirado (24h)
      for (const [id, timestamp] of Object.entries(parsed)) {
        if (now - timestamp < IGNORE_DURATION_MS) {
          validMap.set(id, timestamp);
        }
      }

      // Guardar solo los validos (limpieza automatica)
      const validObject = Object.fromEntries(validMap);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(validObject));

      return validMap;
    } catch (error) {
      Logger.error('Error leyendo ignored_expirations_ttl:', error);
      return new Map();
    }
  }, []);

  const loadExpirationAlerts = useCallback(async ({ forceCloud = false } = {}) => {
    if (cloudProductsEnabled && licenseKey && isOnline()) {
      try {
        const response = await getCloudExpiringBatchesReport({
          licenseKey,
          daysAhead: 45,
          includeInactive: false,
          force: forceCloud
        });

        if (response?.success !== false && response?.ok !== false) {
          return normalizeCloudExpiringReport(response);
        }

        Logger.warn('[ExpirationAlert] Reporte cloud de caducidad no disponible, usando cache local:', response);
      } catch (error) {
        Logger.warn('[ExpirationAlert] Error cargando reporte cloud de caducidad, usando cache local:', error);
      }
    }

    return getExpiringProductsReport({ daysThreshold: 45 });
  }, [cloudProductsEnabled, licenseKey]);

  // Refresh alerts (declarado antes que handleRestoreAll para evitar TDZ)
  const refreshAlerts = useCallback(async (options = {}) => {
    setLoading(true);
    try {
      const data = await loadExpirationAlerts(options);

      // Filtrar los ignorados temporalmente
      const ignoredIds = getIgnoredIds();
      const visibleData = data.filter((item) => !ignoredIds.has(item.id));

      setAlerts(visibleData);
    } catch (error) {
      Logger.error('Error cargando reporte de caducidad:', error);
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }, [getIgnoredIds, loadExpirationAlerts]);

  // Ignorar una alerta por 24 horas
  const handleIgnore = useCallback((id) => {
    try {
      const currentIgnored = getIgnoredIds();
      currentIgnored.set(id, Date.now());

      const ignoredObject = Object.fromEntries(currentIgnored);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ignoredObject));

      // Actualizar estado local para UI reactiva
      setAlerts((prev) => prev.filter((alert) => alert.id !== id));
    } catch (error) {
      Logger.error('Error ignorando alerta:', error);
    }
  }, [getIgnoredIds]);

  // Restaurar todas las alertas ignoradas
  const handleRestoreAll = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      // Recargar alertas
      refreshAlerts();
    } catch (error) {
      Logger.error('Error restaurando alertas:', error);
    }
  }, [refreshAlerts]);

  useEffect(() => {
    const timer = setTimeout(() => {
      refreshAlerts();
    }, 0);

    return () => clearTimeout(timer);
  }, [refreshAlerts]);

  const syncCatalogAfterCloudWaste = useCallback(async (response, batchId) => {
    try {
      await productLocalRepository.applyCloudCatalog(response || {});
    } catch (error) {
      Logger.warn('[ExpirationAlert] No se pudo aplicar respuesta cloud de merma localmente:', error);
    }

    try {
      await pullCatalogChanges(licenseKey);
    } catch (error) {
      Logger.warn('[ExpirationAlert] Pull incremental de catalogo tras merma cloud fallo:', error);
    }

    notifyProductsChanged({
      source: 'useExpirationAlert.cloudExpirationWaste',
      batchId
    });
  }, [licenseKey]);

  // Mover a merma (registro contable sin eliminar)
  const handleMoveToWaste = useCallback(async (item, isPartial = false, partialQuantity = null) => {
    if (item.type !== 'Lote') {
      return { success: false, error: 'Solo los lotes pueden moverse a merma desde este panel.' };
    }

    if (processingId === item.id) {
      return { success: false, error: 'La merma ya está en proceso. Espera unos segundos.' };
    }

    const currentStock = getCurrentStock(item);
    const quantity = isPartial ? Number(partialQuantity) : null;

    if (isPartial && (!Number.isFinite(quantity) || quantity <= 0)) {
      return { success: false, error: 'Ingresa una cantidad válida para registrar merma.' };
    }

    if (isPartial && quantity > currentStock) {
      return { success: false, error: 'La cantidad supera el stock disponible del lote.' };
    }

    if (cloudProductsEnabled) {
      if (!licenseKey) {
        return { success: false, error: 'No se pudo validar la licencia cloud para registrar merma.' };
      }

      if (!isOnline()) {
        return {
          success: false,
          error: 'No hay conexión para registrar la merma en la nube. No se guardó nada local para evitar inconsistencias.'
        };
      }

      if (typeof canAccess === 'function' && canAccess('products') !== true) {
        return { success: false, error: CLOUD_WASTE_MESSAGES.PERMISSION_DENIED };
      }
    }

    setProcessingId(item.id);
    try {
      const product = alerts.find((a) => a.productId === item.productId);
      let result;

      if (cloudProductsEnabled) {
        const idempotencyKey = `expiration_waste:${item.id}:${isPartial ? quantity : 'all'}:${generateID('idem')}`;
        result = await registerCloudExpirationWaste({
          licenseKey,
          batch: item,
          quantity: isPartial ? quantity : null,
          reason: isPartial ? 'caducidad_parcial' : 'caducidad',
          notes: isPartial
            ? 'Merma parcial desde alerta de caducidad'
            : 'Merma total desde alerta de caducidad',
          idempotencyKey
        });

        if (result?.success === false || result?.ok === false) {
          return { success: false, error: sanitizeCloudWasteError(result), response: result };
        }

        await syncCatalogAfterCloudWaste(result, item.id);
        await refreshAlerts({ forceCloud: true });

        return {
          ...result,
          success: true,
          message: 'Merma registrada correctamente en la nube.'
        };
      }

      if (isPartial && quantity) {
        result = await registerPartialExpirationWaste(
          { ...item, stock: currentStock },
          product,
          quantity,
          'Merma parcial desde alerta de caducidad'
        );
      } else {
        result = await registerExpirationWaste(item, product, 'Merma total desde alerta de caducidad');
      }

      if (result.success) {
        await refreshAlerts();
      }

      return result;
    } catch (error) {
      Logger.error('Error moviendo a merma:', error);
      return {
        success: false,
        error: cloudProductsEnabled ? sanitizeCloudWasteError(error) : (error.message || 'Error al mover a merma')
      };
    } finally {
      setProcessingId(null);
    }
  }, [
    alerts,
    canAccess,
    cloudProductsEnabled,
    licenseKey,
    processingId,
    refreshAlerts,
    syncCatalogAfterCloudWaste
  ]);

  // Correccion de fecha con fix de timezone
  const openEditModal = useCallback((item) => {
    if (item.type !== 'Lote') {
      return;
    }

    setEditingItem(item);
    
    // FIX: Construir YYYY-MM-DD usando metodos locales para evitar timezone shift
    const dateObj = new Date(item.expiryDate);
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    const formatted = `${year}-${month}-${day}`;
    
    setNewDate(formatted);
  }, []);

  const handleSaveDate = useCallback(async () => {
    if (!editingItem || !newDate) return;

    try {
      await updateProductBatch(editingItem.productId, editingItem.id, { expiryDate: newDate });
      setEditingItem(null);
      await refreshAlerts();
      return { success: true };
    } catch (error) {
      Logger.error('Error actualizando fecha:', error);
      return { success: false, error: error.message };
    }
  }, [editingItem, newDate, refreshAlerts, updateProductBatch]);

  const cancelEdit = useCallback(() => {
    setEditingItem(null);
    setNewDate('');
  }, []);

  // Informacion contextual por rubro
  const businessContext = useMemo(() => {
    const rawType = companyProfile?.business_type;
    const type = normalizeBusinessType(rawType);

    const isPharmacy = type === 'farmacia';
    const isFood = type === 'food_service' || type === 'verduleria/fruteria';
    const isGrocery = type === 'abarrotes';

    return {
      isPharmacy,
      isFood,
      isGrocery,
      type
    };
  }, [companyProfile]);

  // Strategy tip por rubro
  const strategyTip = useMemo(() => {
    const { isPharmacy, isFood, isGrocery } = businessContext;

    if (isPharmacy) {
      return {
        icon: 'pill',
        title: 'Protocolo Farmacéutico',
        text: 'Revisa políticas de devolución y separa antibióticos caducados (SINGREM).'
      };
    }
    if (isFood) {
      return {
        icon: 'chef-hat',
        title: 'Estrategia "Cero Desperdicio"',
        text: 'Prioriza estos ingredientes en "Especiales del Día" o procésalos hoy.'
      };
    }
    if (isGrocery) {
      return {
        icon: 'tag',
        title: 'Liquidación',
        text: 'Arma packs de ahorro o 2x1. Mejor recuperar algo hoy que perder todo mañana.'
      };
    }
    return {
      icon: 'lightbulb',
      title: 'Sugerencia',
      text: 'Etiqueta con "Últimas Piezas". Verifica cambios con proveedor.'
    };
  }, [businessContext]);

  const ignoredCount = useMemo(() => {
    return getIgnoredIds().size;
  }, [getIgnoredIds]);

  return {
    // Estado
    alerts,
    loading,
    editingItem,
    newDate,
    processingId,
    ignoredCount,
    
    // Contexto
    businessContext,
    strategyTip,
    cloudProductsEnabled,
    
    // Acciones
    refreshAlerts,
    handleIgnore,
    handleRestoreAll,
    handleMoveToWaste,
    openEditModal,
    handleSaveDate,
    cancelEdit,
    setNewDate
  };
};