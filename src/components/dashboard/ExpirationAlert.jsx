import React from 'react';
import { useExpirationAlert } from '../../hooks/useExpirationAlert';
import { useAppStore } from '../../store/useAppStore';
import { useInventoryCatalogStore } from '../../store/useInventoryCatalogStore';
import {
  PackageMinus,
  PackagePlus,
  CalendarCheck,
  EyeOff,
  RotateCcw,
  Clock,
  Package,
  Barcode,
  ChevronDown,
  Search
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
import { getExpirationCategory, getExpirationStatus, getExpirationDateTitle, formatExpirationDate } from './expirationPresentation';
import './ExpirationRegularization.css';

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

export default function ExpirationAlert() {
  const {
    alerts,
    loading,
    editingItem,
    newDate,
    processingId,
    ignoredCount,
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
  const canManageInventory = typeof canAccess === 'function' && canAccess('inventory') === true;
  const refreshProducts = useInventoryCatalogStore((state) => state.loadInitialProducts);
  const licenseKey = React.useMemo(() => getLicenseKeyFromDetails(licenseDetails), [licenseDetails]);

  const [regularizationDraft, setRegularizationDraft] = React.useState(null);
  const [regularizationProcessingId, setRegularizationProcessingId] = React.useState(null);

  const [activeView, setActiveView] = React.useState('alerts');
  const [searchTerm, setSearchTerm] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [visibleCount, setVisibleCount] = React.useState(20);
  const [expandedId, setExpandedId] = React.useState(null);

  const counts = React.useMemo(() => alerts.reduce((result, item) => {
    const category = getExpirationCategory(item);
    result[category] += 1;
    return result;
  }, { expired: 0, upcoming: 0, unbatched: 0 }), [alerts]);

  const filteredAlerts = React.useMemo(() => {
    const term = searchTerm.trim().toLocaleLowerCase('es');
    return alerts.filter((item) => {
      if (statusFilter !== 'all' && getExpirationCategory(item) !== statusFilter) return false;
      if (!term) return true;
      return [item.productName, item.batchSku, item.message]
        .some((value) => String(value || '').toLocaleLowerCase('es').includes(term));
    }).sort((a, b) => {
      const priority = { expired: 0, unbatched: 1, upcoming: 2 };
      const delta = priority[getExpirationCategory(a)] - priority[getExpirationCategory(b)];
      return delta || Number(a.daysRemaining || 0) - Number(b.daysRemaining || 0);
    });
  }, [alerts, searchTerm, statusFilter]);

  React.useEffect(() => {
    setVisibleCount(20);
    setExpandedId(null);
  }, [searchTerm, statusFilter]);

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
      if (typeof canAccess === 'function' && canAccess('inventory') !== true) {
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

    if (typeof canAccess === 'function' && canAccess('inventory') !== true) {
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

  const handleConfirmedWaste = async (item) => {
    const confirmed = await showConfirmModal(
      '¿Registrar merma total de "' + item.productName + '"? Se retirarán ' +
      String(item.stock) + ' unidades del lote ' + (item.batchSku || item.id) +
      ' y quedará constancia de la pérdida. Esta acción no es solo ocultar una alerta.',
      {
        title: 'Confirmar merma de inventario',
        confirmButtonText: 'Registrar merma',
        cancelButtonText: 'Cancelar'
      }
    );
    if (!confirmed) return;
    const result = await handleMoveToWaste(item);
    if (!result?.success) {
      showMessageModal(result?.error || 'No se pudo registrar la merma.', null, { type: 'error' });
      return;
    }
    setExpandedId(null);
    showMessageModal(result.message || 'Merma registrada. Se actualizó el inventario.');
  };

  const renderAlertWidget = () => {
    if (loading) {
      return (
        <div className="expiry-state" role="status">
          <Clock size={20} className="expiry-spinner" />
          Cargando lotes pendientes de revisión...
        </div>
      );
    }

    return (
      <div className="expiry-pending" role="tabpanel" id="expiry-panel-alerts" aria-labelledby="expiry-tab-alerts">
        <div className="expiry-counts" aria-label="Resumen de alertas">
          <div className="expiry-count">
            <span>Vencidos</span>
            <strong className="expiry-count--danger">{counts.expired}</strong>
          </div>
          <div className="expiry-count">
            <span>Por vencer</span>
            <strong>{counts.upcoming}</strong>
          </div>
          <div className="expiry-count">
            <span>Sin lote</span>
            <strong>{counts.unbatched}</strong>
          </div>
        </div>

        <div className="expiry-tools">
          <label className="expiry-search">
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Buscar producto o lote"
              aria-label="Buscar producto o lote"
            />
          </label>
          <select
            aria-label="Filtrar caducidades"
            className="expiry-filter"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">Todos los pendientes</option>
            <option value="expired">Vencidos</option>
            <option value="upcoming">Por vencer</option>
            <option value="unbatched">Sin lote</option>
          </select>
        </div>

        <div className="expiry-list-meta">
          <span>{filteredAlerts.length} registros · próximos 45 días y vencidos</span>
          <button type="button" className="expiry-link" onClick={() => refreshAlerts({ forceCloud: true })}>
            <RotateCcw size={15} aria-hidden="true" /> Actualizar
          </button>
        </div>

        {filteredAlerts.length === 0 ? (
          <div className="expiry-state">
            <CalendarCheck size={30} aria-hidden="true" />
            <strong>{alerts.length === 0 ? 'No hay pendientes visibles' : 'No se encontraron coincidencias'}</strong>
            <p>{alerts.length === 0
              ? 'No se detectaron alertas en el inventario consultado. Revisa de nuevo si agregas lotes.'
              : 'Prueba otro nombre o cambia el filtro.'}</p>
            {ignoredCount > 0 && (
              <button type="button" className="expiry-link" onClick={handleRestoreAll}>
                <RotateCcw size={15} aria-hidden="true" /> Volver a mostrar alertas ocultas
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="expiry-list" aria-label="Productos por revisar">
              {filteredAlerts.slice(0, visibleCount).map((item) => {
                const category = getExpirationCategory(item);
                const isBatch = category !== 'unbatched';
                const isExpanded = expandedId === item.id;
                const actionProcessing = processingId === item.id || regularizationProcessingId === item.id;
                const itemDate = item.expiryDate || item.alertTargetDate;

                return (
                  <article className={'expiry-row expiry-row--' + category} key={item.id}>
                    <button
                      type="button"
                      className="expiry-row-toggle"
                      aria-expanded={isExpanded}
                      aria-controls={isExpanded ? 'expiry-details-' + item.id : undefined}
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                    >
                      <span className="expiry-row-content">
                        <strong className="expiry-product-name">{item.productName}</strong>
                        <span className="expiry-secondary">
                          {isBatch ? 'Lote ' + (item.batchSku || item.id) : 'Producto sin lote asignado'}
                          {' · '}
                          {String(item.stock ?? 0)} unidades
                        </span>
                        <span className="expiry-secondary">
                          {isBatch
                            ? getExpirationDateTitle(item) + ': ' + formatExpirationDate(itemDate)
                            : 'Requiere registrar o ajustar su inventario por lotes'}
                        </span>
                      </span>
                      <span className="expiry-row-end">
                        <span className={'expiry-status expiry-status--' + category}>
                          {getExpirationStatus(item)}
                        </span>
                        <ChevronDown className={'expiry-chevron' + (isExpanded ? ' expiry-chevron--open' : '')} size={19} aria-hidden="true" />
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="expiry-row-details" id={'expiry-details-' + item.id}>
                        <p className="expiry-row-hint">
                          {category === 'expired'
                            ? 'Este lote requiere revisión. No lo vendas si su fecha o vida útil ya venció.'
                            : category === 'unbatched'
                              ? (item.message || 'Hay existencias que no están asignadas a ningún lote.')
                              : item.alertType === 'REVISION_MERMA'
                                ? 'Revisa físicamente este lote y determina si corresponde registrar merma.'
                                : 'Comprueba el lote y prioriza su salida antes de la fecha indicada.'}
                        </p>
                        {item.location && <p className="expiry-row-extra">Ubicación: {item.location}</p>}
                        <div className="expiry-row-actions">
                          {isBatch ? (
                            <>
                              {canManageInventory && (
                                <button type="button" className="expiry-action" disabled={actionProcessing} onClick={() => openEditModal(item)}>
                                  <CalendarCheck size={16} aria-hidden="true" /> Corregir fecha
                                </button>
                              )}
                              {canManageInventory && item.canMoveToWaste !== false && (
                                <button type="button" className="expiry-action expiry-action--danger" disabled={actionProcessing} onClick={() => handleConfirmedWaste(item)}>
                                  <PackageMinus size={16} aria-hidden="true" /> Registrar merma
                                </button>
                              )}
                            </>
                          ) : (
                            <>
                              {canManageInventory && item.canCreateBatchFromStock === true && (
                                <button type="button" className="expiry-action" disabled={actionProcessing} onClick={() => handleOpenCreateBatch(item)}>
                                  <PackagePlus size={16} aria-hidden="true" /> Crear lote
                                </button>
                              )}
                              {canManageInventory && item.canAdjustStock === true && cloudProductsEnabled && (
                                <button type="button" className="expiry-action expiry-action--danger" disabled={actionProcessing} onClick={() => handleAdjustStockToZero(item)}>
                                  <PackageMinus size={16} aria-hidden="true" /> Ajustar stock a 0
                                </button>
                              )}
                            </>
                          )}
                          <button type="button" className="expiry-action expiry-action--quiet" disabled={actionProcessing} onClick={() => handleIgnore(item.id)}>
                            <EyeOff size={16} aria-hidden="true" /> Ocultar 24 horas
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
            {visibleCount < filteredAlerts.length && (
              <div className="expiry-more">
                <button type="button" className="expiry-action" onClick={() => setVisibleCount((value) => value + 20)}>
                  Mostrar más ({filteredAlerts.length - visibleCount} pendientes)
                </button>
              </div>
            )}
            {ignoredCount > 0 && (
              <div className="expiry-restore">
                <button type="button" className="expiry-link" onClick={handleRestoreAll}>
                  <RotateCcw size={15} aria-hidden="true" /> Restaurar alertas ocultas
                </button>
              </div>
            )}
          </>
        )}

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
        )}      </div>
    );
  };

  return (
    <section className="expiry-workspace" aria-label="Caducidad de productos">
      <header className="expiry-page-header">
        <div>
          <h2>Caducidad</h2>
          <p>Identifica productos por revisar, prioriza lotes y consulta las bajas registradas.</p>
        </div>
      </header>

      <div className="expiry-tabs" role="tablist" aria-label="Secciones de caducidad">
        <button type="button" role="tab" id="expiry-tab-alerts" aria-selected={activeView === 'alerts'} aria-controls="expiry-panel-alerts" className={activeView === 'alerts' ? 'is-active' : ''} onClick={() => setActiveView('alerts')}>
          Por atender
        </button>
        <button type="button" role="tab" id="expiry-tab-fefo" aria-selected={activeView === 'fefo'} aria-controls="expiry-panel-fefo" className={activeView === 'fefo' ? 'is-active' : ''} onClick={() => setActiveView('fefo')}>
          Qué vender primero
        </button>
        <button type="button" role="tab" id="expiry-tab-history" aria-selected={activeView === 'history'} aria-controls="expiry-panel-history" className={activeView === 'history' ? 'is-active' : ''} onClick={() => setActiveView('history')}>
          Historial
        </button>
      </div>

      {activeView === 'alerts' && renderAlertWidget()}
      {activeView === 'fefo' && <div role="tabpanel" id="expiry-panel-fefo" aria-labelledby="expiry-tab-fefo"><ExpirationFefoPanel /></div>}
      {activeView === 'history' && <div role="tabpanel" id="expiry-panel-history" aria-labelledby="expiry-tab-history"><ExpirationWasteHistoryPanel /></div>}
    </section>
  );
}
