import React from 'react';
import { useExpirationAlert } from '../../hooks/useExpirationAlert';
import { useAppStore } from '../../store/useAppStore';
import { useProductStore } from '../../store/useProductStore';
import {
  AlertTriangle,
  PackageMinus,
  PackagePlus,
  CalendarCheck,
  EyeOff,
  RotateCcw,
  Pill,
  ChefHat,
  Tag,
  Lightbulb,
  Clock,
  Package,
  Barcode,
  AlertCircle
} from 'lucide-react';
import ExpirationFefoPanel from './ExpirationFefoPanel';
import ExpirationWasteHistoryPanel from './ExpirationWasteHistoryPanel';
import {
  createCloudBatchFromParentStock,
  adjustCloudStockWithoutBatchToZero
} from '../../services/products/productExpirationWasteCloudRepository';
import { productLocalRepository } from '../../services/products/productLocalRepository';
import { pullCatalogChanges } from '../../services/products/productSyncHandler';
import { notifyProductsChanged } from '../../services/products/productEvents';
import { getLicenseKeyFromDetails } from '../../services/sync/syncConstants';
import { loadData, saveBatchAndSyncProductSafe, STORES } from '../../services/database';
import { generateID, showConfirmModal, showMessageModal } from '../../services/utils';
import Logger from '../../services/Logger';
import './ExpirationAlert.css';
import './ExpirationRegularization.css';

const ICONS = {
  pill: Pill,
  'chef-hat': ChefHat,
  tag: Tag,
  lightbulb: Lightbulb
};

const REGULARIZATION_MESSAGES = Object.freeze({
  PRODUCT_ID_REQUIRED: 'Selecciona un producto para regularizar.',
  PRODUCT_NOT_FOUND: 'El producto ya no existe o fue eliminado. Actualiza el catálogo.',
  PRODUCT_DOES_NOT_REQUIRE_BATCH: 'Este producto no requiere lote para regularizar.',
  REGULARIZATION_EXPIRY_REQUIRED: 'Captura una fecha de caducidad o vida útil estimada para crear el lote.',
  INVALID_REGULARIZATION_QUANTITY: 'La cantidad a regularizar no es válida.',
  NO_PARENT_STOCK_TO_ADJUST: 'El producto ya no tiene stock sin lote por ajustar.',
  PERMISSION_DENIED: 'No tienes permiso para regularizar inventario. Pide acceso a productos/inventario.',
  NO_PERMISSION: 'No tienes permiso para regularizar inventario. Pide acceso a productos/inventario.',
  POS_PERMISSION_DENIED: 'No tienes permiso para regularizar inventario. Pide acceso a productos/inventario.',
  POS_SYNC_AUTH_CONTEXT_INCOMPLETE: 'No se pudo validar este dispositivo. Vuelve a iniciar sesión o actualiza la licencia.',
  SUPABASE_NOT_CONFIGURED: 'La nube no está disponible en este momento.',
  RATE_LIMITED: 'Hay demasiadas solicitudes en este momento. Intenta de nuevo en unos segundos.',
  CLOUD_REQUEST_BACKOFF_ACTIVE: 'La nube está ocupada o recuperándose. Intenta de nuevo en unos segundos.'
});

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

const toSafeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getAvailableProductStock = (item = {}) => toSafeNumber(
  item.parentAvailableStock ?? item.availableStock ?? item.currentStock ?? item.stock,
  0
);

const isProductRecord = (item = {}) => item.recordType === 'product' || item.type === 'Producto';

const isShelfLifeExpiredRecord = (item = {}) => (
  item.operationalCategory === 'vida_util_vencida' || item.alertType === 'VIDA_UTIL_VENCIDA'
);

const isRegularizationRecord = (item = {}) => (
  isProductRecord(item) && (
    item.operationalCategory === 'requiere_regularizacion' ||
    item.canCreateBatchFromStock === true ||
    item.canAdjustStock === true
  )
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

const sanitizeRegularizationError = (errorOrResponse = {}) => {
  const code = getErrorCode(errorOrResponse);
  const normalizedCode = typeof code === 'string' ? code.trim().toUpperCase() : code;
  if (normalizedCode && REGULARIZATION_MESSAGES[normalizedCode]) return REGULARIZATION_MESSAGES[normalizedCode];

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
    return REGULARIZATION_MESSAGES.PERMISSION_DENIED;
  }

  if (
    normalized.includes('rate limit') ||
    normalized.includes('too many requests') ||
    normalized.includes('demasiadas solicitudes')
  ) {
    return REGULARIZATION_MESSAGES.RATE_LIMITED;
  }

  if (normalized.includes('backoff')) return REGULARIZATION_MESSAGES.CLOUD_REQUEST_BACKOFF_ACTIVE;

  if (
    normalized.includes('failed to fetch') ||
    normalized.includes('network') ||
    normalized.includes('timeout') ||
    normalized.includes('offline') ||
    normalized.includes('internet')
  ) {
    return 'No hay conexión estable para regularizar inventario en la nube. Intenta de nuevo cuando tengas internet.';
  }

  if (normalized.includes('rpc') || normalized.includes('supabase') || normalized.includes('postgres')) {
    return 'No se pudo regularizar el inventario en la nube. Intenta de nuevo en unos segundos.';
  }

  return rawMessage || 'No se pudo regularizar el inventario. Intenta de nuevo.';
};

const toDateInputValue = (value = null) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getStatusText = (item = {}) => {
  if (item.statusLabel) return item.statusLabel;
  if (isShelfLifeExpiredRecord(item)) return 'Vida útil vencida';
  if (isRegularizationRecord(item)) return 'Requiere regularización';
  if (item.daysRemaining < 0) return 'Vencido';
  return item.alertType === 'REVISION_MERMA' ? 'Revisión' : 'Caduca en';
};

export default function ExpirationAlert() {
  const {
    alerts,
    loading,
    editingItem,
    newDate,
    processingId,
    ignoredCount,
    businessContext,
    strategyTip,
    cloudProductsEnabled,
    refreshAlerts,
    handleIgnore,
    handleRestoreAll,
    handleMoveToWaste,
    openEditModal,
    handleSaveDate,
    cancelEdit,
    setNewDate
  } = useExpirationAlert();

  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const canAccess = useAppStore((state) => state.canAccess);
  const refreshProducts = useProductStore((state) => state.loadInitialProducts);
  const licenseKey = React.useMemo(() => getLicenseKeyFromDetails(licenseDetails), [licenseDetails]);

  const [regularizationDraft, setRegularizationDraft] = React.useState(null);
  const [regularizationProcessingId, setRegularizationProcessingId] = React.useState(null);

  const expiredCount = alerts.filter((item) => item.daysRemaining < 0 || isShelfLifeExpiredRecord(item)).length;
  const productRegularizationCount = alerts.filter(isProductRecord).length;
  const expiringCount = alerts.length - expiredCount;
  const StrategyIcon = ICONS[strategyTip?.icon] || Lightbulb;

  const syncAfterCloudRegularization = React.useCallback(async (response, source) => {
    try {
      await productLocalRepository.applyCloudCatalog(response || {});
    } catch (error) {
      Logger.warn('[ExpirationAlert] No se pudo aplicar respuesta cloud de regularización localmente:', error);
    }

    try {
      await pullCatalogChanges(licenseKey);
    } catch (error) {
      Logger.warn('[ExpirationAlert] Pull incremental de catálogo tras regularización cloud falló:', error);
    }

    notifyProductsChanged({ source });
    await refreshProducts?.();
    await refreshAlerts({ forceCloud: true });
  }, [licenseKey, refreshAlerts, refreshProducts]);

  const createLocalBatchFromStock = React.useCallback(async ({ item, expiryDate, quantity }) => {
    const product = await loadData(STORES.MENU, item.productId);
    if (!product) {
      return { success: false, error: 'El producto no existe en el catálogo local. Actualiza productos e intenta de nuevo.' };
    }

    if (product?.batchManagement?.enabled !== true) {
      return { success: false, error: 'Este producto no tiene administración de lotes activa en modo local.' };
    }

    const now = new Date().toISOString();
    const batchId = generateID('batch');
    const batch = {
      id: batchId,
      productId: item.productId,
      sku: `REG-${Date.now()}`,
      stock: quantity,
      committedStock: 0,
      cost: Number(product.cost) || 0,
      price: Number(product.price) || 0,
      trackStock: true,
      isActive: true,
      status: 'active',
      expiryDate,
      alertTargetDate: expiryDate,
      alertType: product.expirationMode === 'SHELF_LIFE' ? 'VIDA_UTIL_ESTIMADA' : 'CADUCIDAD_LEGAL',
      manufacturerBatchId: `REG-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`,
      location: product.location || '',
      notes: 'Regularización de inventario sin lote',
      metadata: {
        phase: 'fase_cad_6_1',
        source: 'expiration_alert_regularization',
        regularization: true
      },
      createdAt: now,
      updatedAt: now
    };

    const result = await saveBatchAndSyncProductSafe(batch);
    if (!result?.success) {
      return {
        success: false,
        error: result?.message || result?.error?.message || 'No se pudo crear el lote local de regularización.'
      };
    }

    await refreshProducts?.();
    notifyProductsChanged({
      source: 'ExpirationAlert.localCreateBatchFromStock',
      productId: item.productId,
      batchId
    });
    await refreshAlerts();

    return { success: true, message: 'Lote creado correctamente desde el stock actual.' };
  }, [refreshAlerts, refreshProducts]);

  const handleOpenCreateBatch = React.useCallback((item) => {
    const stock = getAvailableProductStock(item);
    setRegularizationDraft({
      item,
      expiryDate: toDateInputValue(item.expiryDate || item.alertTargetDate),
      quantity: stock > 0 ? String(stock) : ''
    });
  }, []);

  const handleCloseCreateBatch = React.useCallback(() => {
    setRegularizationDraft(null);
  }, []);

  const handleSubmitCreateBatch = React.useCallback(async () => {
    const item = regularizationDraft?.item;
    if (!item) return;

    const quantity = Number(regularizationDraft.quantity);
    const available = getAvailableProductStock(item);
    if (!regularizationDraft.expiryDate) {
      showMessageModal(REGULARIZATION_MESSAGES.REGULARIZATION_EXPIRY_REQUIRED, null, { type: 'warning' });
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > available) {
      showMessageModal('La cantidad debe ser mayor a 0 y no puede superar el stock sin lote disponible.', null, { type: 'warning' });
      return;
    }

    if (regularizationProcessingId === item.id) return;

    if (cloudProductsEnabled) {
      if (!licenseKey) {
        showMessageModal('No se pudo validar la licencia cloud para regularizar inventario.', null, { type: 'error' });
        return;
      }
      if (!isOnline()) {
        showMessageModal('No hay conexión para regularizar inventario en la nube. No se guardó nada local para evitar inconsistencias.', null, { type: 'warning' });
        return;
      }
      if (typeof canAccess === 'function' && canAccess('products') !== true) {
        showMessageModal(REGULARIZATION_MESSAGES.PERMISSION_DENIED, null, { type: 'error' });
        return;
      }
    }

    setRegularizationProcessingId(item.id);
    try {
      let result;
      if (cloudProductsEnabled) {
        result = await createCloudBatchFromParentStock({
          licenseKey,
          productId: item.productId,
          expiryDate: regularizationDraft.expiryDate,
          quantity,
          notes: 'Regularización desde sección Caducidad',
          idempotencyKey: `cad6.create_batch:${item.productId}:${generateID('idem')}`
        });

        if (result?.success === false || result?.ok === false) {
          showMessageModal(sanitizeRegularizationError(result), null, { type: 'error' });
          return;
        }

        await syncAfterCloudRegularization(result, 'ExpirationAlert.cloudCreateBatchFromStock');
        showMessageModal('Lote creado correctamente desde el stock actual.');
      } else {
        result = await createLocalBatchFromStock({
          item,
          expiryDate: regularizationDraft.expiryDate,
          quantity
        });

        if (!result?.success) {
          showMessageModal(result?.error || 'No se pudo crear el lote local.', null, { type: 'error' });
          return;
        }

        showMessageModal(result.message || 'Lote creado correctamente desde el stock actual.');
      }

      setRegularizationDraft(null);
    } catch (error) {
      Logger.error('[ExpirationAlert] Error creando lote desde stock padre:', error);
      showMessageModal(
        cloudProductsEnabled ? sanitizeRegularizationError(error) : (error?.message || 'No se pudo crear el lote local.'),
        null,
        { type: 'error' }
      );
    } finally {
      setRegularizationProcessingId(null);
    }
  }, [
    canAccess,
    cloudProductsEnabled,
    createLocalBatchFromStock,
    licenseKey,
    regularizationDraft,
    regularizationProcessingId,
    syncAfterCloudRegularization
  ]);

  const handleAdjustStockToZero = React.useCallback(async (item) => {
    if (!isProductRecord(item)) return;

    if (!cloudProductsEnabled) {
      showMessageModal(
        'En modo local no hay un flujo seguro de auditoría para ajustar este stock desde Caducidad. Crea un lote local o ajusta el producto desde su ficha técnica.',
        null,
        { type: 'warning' }
      );
      return;
    }

    if (!licenseKey) {
      showMessageModal('No se pudo validar la licencia cloud para regularizar inventario.', null, { type: 'error' });
      return;
    }

    if (!isOnline()) {
      showMessageModal('No hay conexión para ajustar stock en la nube. No se guardó nada local para evitar inconsistencias.', null, { type: 'warning' });
      return;
    }

    if (typeof canAccess === 'function' && canAccess('products') !== true) {
      showMessageModal(REGULARIZATION_MESSAGES.PERMISSION_DENIED, null, { type: 'error' });
      return;
    }

    const confirmed = await showConfirmModal(
      `¿Ajustar a 0 el stock sin lote de "${item.productName}"? Esta acción no toca caja ni ventas; solo regulariza inventario no trazable.`,
      {
        title: 'Ajustar stock sin lote',
        confirmButtonText: 'Sí, ajustar a 0',
        cancelButtonText: 'Cancelar'
      }
    );
    if (!confirmed) return;

    setRegularizationProcessingId(item.id);
    try {
      const result = await adjustCloudStockWithoutBatchToZero({
        licenseKey,
        productId: item.productId,
        reason: 'regularizacion_stock_sin_lote',
        notes: 'Ajuste a 0 desde sección Caducidad',
        idempotencyKey: `cad6.adjust_zero:${item.productId}:${generateID('idem')}`
      });

      if (result?.success === false || result?.ok === false) {
        showMessageModal(sanitizeRegularizationError(result), null, { type: 'error' });
        return;
      }

      await syncAfterCloudRegularization(result, 'ExpirationAlert.cloudAdjustStockWithoutBatchZero');
      showMessageModal('Stock sin lote ajustado a 0 correctamente.');
    } catch (error) {
      Logger.error('[ExpirationAlert] Error ajustando stock sin lote a cero:', error);
      showMessageModal(sanitizeRegularizationError(error), null, { type: 'error' });
    } finally {
      setRegularizationProcessingId(null);
    }
  }, [canAccess, cloudProductsEnabled, licenseKey, syncAfterCloudRegularization]);

  const renderAlertWidget = () => {
    if (loading) {
      return (
        <div className="expiration-loading">
          <Clock className="loading-spinner" size={24} />
          <span>Buscando lotes y productos con caducidad operativa...</span>
        </div>
      );
    }

    if (alerts.length === 0) {
      return (
        <div className="expiration-widget expiration-empty">
          <div className="empty-icon">
            <CalendarCheck size={48} strokeWidth={1.5} />
          </div>
          <div className="empty-content">
            <h3>Todo el inventario está fresco</h3>
            <p>No hay lotes vencidos, próximos a caducar ni productos sin lote visibles.</p>
            {ignoredCount > 0 && (
              <button className="btn-restore" onClick={handleRestoreAll}>
                <RotateCcw size={14} />
                Restaurar {ignoredCount} ignoradas
              </button>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="expiration-widget">
        {/* Header */}
        <div className={`widget-header ${expiredCount > 0 ? 'header-critical' : 'header-warning'}`}>
          <div className="header-content">
            <span className="header-icon">
              {expiredCount > 0 ? (
                <AlertTriangle size={24} />
              ) : (
                <AlertCircle size={24} />
              )}
            </span>
            <div className="header-text">
              <h3>Control de Caducidad</h3>
              <p>
                {expiredCount > 0
                  ? `Atención: ${expiredCount} vencidos y ${productRegularizationCount} productos por regularizar.`
                  : `Tienes ${expiringCount} registros por revisar y ${productRegularizationCount} productos operativos.`}
              </p>
            </div>
          </div>
        </div>

        {/* Body - Cards Grid */}
        <div className="widget-body">
          <div className="expiration-cards-grid">
            {alerts.slice(0, 10).map((item) => {
              const productRecord = isProductRecord(item);
              const isExpired = item.daysRemaining < 0;
              const isLegal = item.alertType === 'CADUCIDAD_LEGAL';
              const isMerma = item.alertType === 'REVISION_MERMA';
              const isBatch = item.type === 'Lote' || item.recordType === 'batch';
              const shelfLifeExpired = isShelfLifeExpiredRecord(item);
              const regularizationRequired = isRegularizationRecord(item);
              const actionProcessing = processingId === item.id || regularizationProcessingId === item.id;
              const statusText = getStatusText(item);

              let cardClass = 'card-normal';
              if (isLegal || isExpired || shelfLifeExpired) cardClass = 'card-expired';
              else if (isMerma || regularizationRequired || item.daysRemaining <= 7) cardClass = 'card-urgent';

              return (
                <div
                  key={item.id}
                  className={`expiration-card ${cardClass}`}
                >
                  {/* Card Header */}
                  <div className="card-header">
                    <div className="card-product-info">
                      <Package className="card-icon" size={20} />
                      <div>
                        <h4 className="card-product-name">{item.productName}</h4>
                        {isBatch && (
                          <div className="card-batch-sku">
                            <Barcode size={12} />
                            <span>{item.batchSku}</span>
                          </div>
                        )}
                        {productRecord && (
                          <div className="card-batch-sku regularization-chip">
                            <PackagePlus size={12} />
                            <span>Producto sin lote</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className={`card-status ${isLegal || isExpired || shelfLifeExpired ? 'status-danger' : (isMerma || regularizationRequired ? 'status-warning' : 'status-info')}`}>
                      {isExpired || shelfLifeExpired ? (
                        <>
                          <AlertTriangle size={14} />
                          <span>{statusText}</span>
                        </>
                      ) : (
                        <>
                          {(isLegal || regularizationRequired) && <AlertTriangle size={14} />}
                          <span>{productRecord ? statusText : `${isLegal ? 'Caduca en: ' : (isMerma ? 'Revisión: ' : '')}${item.daysRemaining} días`}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Card Body */}
                  <div className="card-body">
                    <div className="card-row">
                      <span className="card-label">Stock:</span>
                      <span className="card-value">{item.stock} {item.type === 'Lote' ? 'unidades' : ''}</span>
                    </div>

                    <div className="card-row">
                      <span className="card-label">{productRecord ? 'Fecha objetivo:' : 'Caducidad:'}</span>
                      <span className="card-value">{new Date(item.expiryDate).toLocaleDateString()}</span>
                    </div>

                    {productRecord && (
                      <>
                        <div className="card-row regularization-warning">
                          <span className="card-label">Situación:</span>
                          <span className="card-value">{item.message || statusText || 'Stock sin lote registrado'}</span>
                        </div>
                        <div className="card-row regularization-warning">
                          <span className="card-label">Acción:</span>
                          <span className="card-value">Regularizar antes de vender</span>
                        </div>
                      </>
                    )}

                    {businessContext.isPharmacy && isBatch && (
                      <div className="card-row pharmacy-info">
                        <Pill size={14} />
                        <span className="card-label">Requiere:</span>
                        <span className="card-value">
                          {item.prescriptionType === 'antibiotic' ? 'Antibiótico' :
                           item.prescriptionType === 'controlled' ? 'Receta Especial' :
                           item.prescriptionType === 'prescription' ? 'Receta' : 'Venta Libre'}
                        </span>
                      </div>
                    )}

                    {businessContext.isFood && isBatch && (
                      <div className="card-row food-info">
                        <Clock size={14} />
                        <span className="card-label">Ubicación:</span>
                        <span className="card-value">{item.location || 'No especificada'}</span>
                      </div>
                    )}
                  </div>

                  {/* Card Actions */}
                  <div className="card-actions">
                    {isBatch ? (
                      <>
                        <button
                          className="btn-action btn-edit"
                          onClick={() => openEditModal(item)}
                          disabled={actionProcessing}
                          title="Corregir Fecha"
                        >
                          <CalendarCheck size={18} />
                          <span className="btn-label">Editar</span>
                        </button>
                        {item.canMoveToWaste !== false && (
                          <button
                            className="btn-action btn-waste"
                            onClick={() => handleMoveToWaste(item)}
                            disabled={actionProcessing}
                            title="Mover a Merma"
                          >
                            <PackageMinus size={18} />
                            <span className="btn-label">Merma</span>
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        {item.canCreateBatchFromStock === true && (
                          <button
                            className="btn-action btn-create-batch"
                            onClick={() => handleOpenCreateBatch(item)}
                            disabled={actionProcessing}
                            title="Crear lote desde stock actual"
                          >
                            <PackagePlus size={18} />
                            <span className="btn-label">Crear lote</span>
                          </button>
                        )}
                        {item.canAdjustStock === true && (
                          <button
                            className="btn-action btn-adjust-stock"
                            onClick={() => handleAdjustStockToZero(item)}
                            disabled={actionProcessing}
                            title="Ajustar stock sin lote a 0"
                          >
                            <PackageMinus size={18} />
                            <span className="btn-label">Ajustar a 0</span>
                          </button>
                        )}
                        {item.canCreateBatchFromStock !== true && item.canAdjustStock !== true && (
                          <div className="card-info-text">
                            Producto general - actualiza en ficha técnica
                          </div>
                        )}
                      </>
                    )}
                    <button
                      className="btn-action btn-ignore"
                      onClick={() => handleIgnore(item.id)}
                      disabled={actionProcessing}
                      title="Ignorar por 24h"
                    >
                      <EyeOff size={18} />
                      <span className="btn-label">Ignorar</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {alerts.length > 10 && (
            <div className="view-more">
              <small>
                ... y {alerts.length - 10} más.
              </small>
            </div>
          )}

          {/* Strategy Box */}
          {strategyTip && (
            <div className="strategy-box">
              <div className="strategy-icon">
                <StrategyIcon size={24} />
              </div>
              <div className="strategy-content">
                <strong>{strategyTip.title}</strong>
                <p>{strategyTip.text}</p>
              </div>
            </div>
          )}
        </div>

        {/* Create Batch Modal */}
        {regularizationDraft && (
          <div className="mini-modal-overlay">
            <div className="mini-modal mini-modal-regularization">
              <div className="modal-header">
                <PackagePlus size={24} className="modal-icon" />
                <h4>Crear lote desde stock actual</h4>
              </div>

              <div className="modal-body">
                <div className="modal-product-info">
                  <p className="modal-product-name">{regularizationDraft.item.productName}</p>
                  <p className="modal-batch-sku">
                    <Package size={12} />
                    Stock sin lote: <b>{getAvailableProductStock(regularizationDraft.item)}</b>
                  </p>
                </div>

                <div className="date-input-group">
                  <label htmlFor="regularization-expiry-date">
                    Fecha de caducidad o vida útil estimada:
                  </label>
                  <input
                    id="regularization-expiry-date"
                    type="date"
                    value={regularizationDraft.expiryDate}
                    onChange={(e) => setRegularizationDraft((prev) => ({ ...prev, expiryDate: e.target.value }))}
                    autoFocus
                  />
                </div>

                <div className="date-input-group quantity-input-group">
                  <label htmlFor="regularization-quantity">
                    Cantidad a regularizar:
                  </label>
                  <input
                    id="regularization-quantity"
                    type="number"
                    min="0.0001"
                    step="0.01"
                    value={regularizationDraft.quantity}
                    onChange={(e) => setRegularizationDraft((prev) => ({ ...prev, quantity: e.target.value }))}
                  />
                  <small>No puede superar el stock sin lote disponible.</small>
                </div>
              </div>

              <div className="modal-actions">
                <button
                  className="btn-secondary"
                  onClick={handleSubmitCreateBatch}
                  disabled={regularizationProcessingId === regularizationDraft.item.id}
                >
                  Crear lote
                </button>
                <button className="btn-cancel" onClick={handleCloseCreateBatch}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit Modal */}
        {editingItem && (
          <div className="mini-modal-overlay">
            <div className="mini-modal">
              <div className="modal-header">
                <CalendarCheck size={24} className="modal-icon" />
                <h4>Corregir Fecha de Vencimiento</h4>
              </div>

              <div className="modal-body">
                <div className="modal-product-info">
                  <p className="modal-product-name">{editingItem.productName}</p>
                  {editingItem.batchSku && (
                    <p className="modal-batch-sku">
                      <Barcode size={12} />
                      Lote: <b>{editingItem.batchSku}</b>
                    </p>
                  )}
                </div>

                <div className="date-input-group">
                  <label htmlFor="expiry-date-input">
                    Nueva Fecha de Vencimiento:
                  </label>
                  <input
                    id="expiry-date-input"
                    type="date"
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    autoFocus
                  />
                </div>
              </div>

              <div className="modal-actions">
                <button className="btn-secondary" onClick={handleSaveDate}>
                  Guardar
                </button>
                <button className="btn-cancel" onClick={cancelEdit}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {renderAlertWidget()}
      <ExpirationFefoPanel />
      <ExpirationWasteHistoryPanel />
    </>
  );
}
