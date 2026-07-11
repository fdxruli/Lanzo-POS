import PropTypes from 'prop-types';
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  LoaderCircle,
  PackageSearch,
  RefreshCw,
  ShoppingBag,
  X
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useActiveOrders } from '../../hooks/pos/useActiveOrders';
import { useAppStore } from '../../store/useAppStore';
import { useProductStore } from '../../store/useProductStore';
import { db, STORES } from '../../services/db/dexie';
import {
  ECOMMERCE_INVENTORY_READ_FAILED,
  ECOMMERCE_INVENTORY_STALE_RESPONSE,
  getEcommerceDraftBatchOptions,
  getEcommerceInventoryLineMessage,
  revalidateEcommerceDraftInventory,
  selectEcommerceDraftBatch
} from '../../services/ecommerce/ecommercePosInventoryResolution';
import { canPrepareEcommercePosDraft } from '../../services/ecommerce/ecommercePosDraftService';
import './EcommercePosDraftGuards.css';

const INVENTORY_STATUS_META = {
  ready: { label: 'Listo', tone: 'ready', Icon: CheckCircle2 },
  conflict: { label: 'Requiere atención', tone: 'conflict', Icon: AlertTriangle },
  pending: { label: 'Pendiente de resolver', tone: 'pending', Icon: PackageSearch }
};

const getDraftStatusLabel = (status) => {
  if (status === 'error_releasing') return 'Liberación pendiente';
  if (status === 'claimed') return 'Preparación en curso';
  return 'Preparado para revisión';
};

const getLineId = (item = {}, index = 0) => (
  item.lineId || item.uniqueLineId || item.ecommerceOrderItemId || `${item.id || 'item'}-${index}`
);

const isBatchLine = (item = {}) => Boolean(
  item.inventoryResolution?.mode === 'batch'
  || item.batchManagement?.enabled
  || item.batch_management?.enabled
  || String(item.expirationMode || item.expiration_mode || '').toLowerCase() === 'batch'
);

const legacyInventoryWarning = /lote pendiente.*siguiente fase/i;
const isStaleResponse = (result) => Boolean(
  result?.stale || result?.code === ECOMMERCE_INVENTORY_STALE_RESPONSE
);

export default function EcommercePosDraftBanner({ order, warnings = [], onOpenDetail }) {
  const storedOrder = useActiveOrders((state) => (
    order?.id ? state.activeOrders.get(order.id) || null : null
  ));
  const products = useProductStore((state) => state.menu);
  const canResolveInventory = useAppStore((state) => canPrepareEcommercePosDraft(state));
  const effectiveOrder = storedOrder || order;
  const [isResolving, setIsResolving] = useState(false);
  const [resolutionError, setResolutionError] = useState('');
  const [hasLocalReadFailure, setHasLocalReadFailure] = useState(false);
  const [batchDialog, setBatchDialog] = useState(null);
  const [isLoadingBatches, setIsLoadingBatches] = useState(false);
  const [isSelectingBatch, setIsSelectingBatch] = useState(false);

  const productIds = useMemo(() => Array.from(new Set(
    (effectiveOrder?.items || [])
      .filter(isBatchLine)
      .map((item) => item.parentId || item.id)
      .filter(Boolean)
  )), [effectiveOrder?.items]);
  const productIdsKey = productIds.map(String).sort().join('|');

  const batchRevision = useLiveQuery(async () => {
    if (!productIds.length) return 'no-batches';
    const batches = await db.table(STORES.PRODUCT_BATCHES)
      .where('productId')
      .anyOf(productIds)
      .toArray();
    return (batches || [])
      .map((batch) => [
        batch.id,
        batch.productId,
        batch.stock,
        batch.committedStock ?? batch.committed_stock,
        batch.isActive ?? batch.is_active,
        batch.status,
        batch.expiryDate ?? batch.expiry_date,
        batch.updatedAt ?? batch.updated_at
      ].join(':'))
      .sort()
      .join('|');
  }, [productIdsKey], 'loading-batches');

  const inputSignature = useMemo(() => (effectiveOrder?.items || []).map((item, index) => [
    getLineId(item, index),
    item.parentId || item.id,
    item.quantity,
    item.batchId || null
  ].join(':')).join('|'), [effectiveOrder?.items]);

  const runResolution = useCallback(async ({ announceFailure = false } = {}) => {
    if (
      !storedOrder?.id
      || storedOrder.origin !== 'ecommerce'
      || storedOrder.ecommerceDraftStatus !== 'prepared'
      || !canResolveInventory
    ) return null;

    setIsResolving(true);
    setResolutionError('');
    const result = await revalidateEcommerceDraftInventory({
      orderId: storedOrder.id,
      deps: { products }
    });
    setIsResolving(false);

    if (isStaleResponse(result)) return result;

    if (result?.success === true) {
      setHasLocalReadFailure(false);
      setResolutionError('');
      return result;
    }

    if (result?.code === ECOMMERCE_INVENTORY_READ_FAILED) {
      setHasLocalReadFailure(true);
      setResolutionError(result.message || 'No se pudo comprobar el inventario local. Intenta resolverlo nuevamente.');
      return result;
    }

    if (announceFailure) {
      setResolutionError(result?.message || 'No se pudo comprobar el inventario local.');
    }
    return result;
  }, [canResolveInventory, products, storedOrder]);

  useEffect(() => {
    if (batchRevision === 'loading-batches') return;
    void runResolution();
  }, [batchRevision, inputSignature, runResolution]);

  useEffect(() => {
    const handleReturnToDraft = () => void runResolution();
    window.addEventListener('focus', handleReturnToDraft);
    window.addEventListener('online', handleReturnToDraft);
    return () => {
      window.removeEventListener('focus', handleReturnToDraft);
      window.removeEventListener('online', handleReturnToDraft);
    };
  }, [runResolution]);

  if (effectiveOrder?.origin !== 'ecommerce') return null;

  const hasStoredReadFailure = effectiveOrder.ecommerceInventoryError?.code === 'INVENTORY_READ_FAILED';
  const inventoryStatus = hasLocalReadFailure || hasStoredReadFailure
    ? 'conflict'
    : (effectiveOrder.ecommerceInventoryStatus || 'pending');
  const inventoryMeta = INVENTORY_STATUS_META[inventoryStatus] || INVENTORY_STATUS_META.pending;
  const InventoryIcon = inventoryMeta.Icon;
  const safeWarnings = warnings.filter((warning) => !legacyInventoryWarning.test(String(warning || '')));
  const displayedResolutionError = resolutionError || effectiveOrder.ecommerceInventoryError?.message || '';
  const canRunResolution = Boolean(
    storedOrder?.id
    && storedOrder.ecommerceDraftStatus === 'prepared'
    && canResolveInventory
  );

  const openBatchDialog = async (item, index) => {
    if (!canRunResolution) return;
    const lineId = getLineId(item, index);
    setIsLoadingBatches(true);
    setResolutionError('');
    const result = await getEcommerceDraftBatchOptions({
      orderId: storedOrder.id,
      lineId,
      deps: { products }
    });
    setIsLoadingBatches(false);

    if (result?.success === false) {
      setResolutionError('No se pudieron cargar los lotes vigentes de este producto.');
      return;
    }
    setBatchDialog({ lineId, item, options: result.options || [] });
  };

  const chooseBatch = async (batchId) => {
    if (!batchDialog || !canRunResolution) return;
    setIsSelectingBatch(true);
    setResolutionError('');
    const result = await selectEcommerceDraftBatch({
      orderId: storedOrder.id,
      lineId: batchDialog.lineId,
      batchId,
      deps: { products }
    });
    setIsSelectingBatch(false);

    if (isStaleResponse(result)) {
      setBatchDialog(null);
      return;
    }

    if (result?.code === ECOMMERCE_INVENTORY_READ_FAILED) {
      setHasLocalReadFailure(true);
      setResolutionError(result.message || 'No se pudo comprobar el inventario local. Intenta resolverlo nuevamente.');
      setBatchDialog(null);
      return;
    }

    if (result?.success === false) {
      setResolutionError('El lote cambió o ya no tiene existencia suficiente. Actualiza la resolución.');
      setBatchDialog(null);
      await runResolution();
      return;
    }

    setHasLocalReadFailure(false);
    setBatchDialog(null);
  };

  return (
    <section className="ecommerce-pos-draft-banner" aria-label="Pedido online preparado">
      <div className="ecommerce-pos-draft-banner__title">
        <ShoppingBag size={20} aria-hidden="true" />
        <strong>Pedido online {effectiveOrder.ecommerceOrderCode || ''}</strong>
      </div>
      <dl>
        <div><dt>Modalidad</dt><dd>{effectiveOrder.fulfillmentMethod === 'delivery' ? 'Entrega' : 'Recolección'}</dd></div>
        <div><dt>Total esperado</dt><dd>${Number(effectiveOrder.expectedTotal || 0).toFixed(2)} {effectiveOrder.currency || 'MXN'}</dd></div>
        <div><dt>Estado del pedido</dt><dd>{getDraftStatusLabel(effectiveOrder.ecommerceDraftStatus)}</dd></div>
        <div className={`ecommerce-inventory-summary ecommerce-inventory-summary--${inventoryMeta.tone}`}>
          <dt>Inventario</dt>
          <dd><InventoryIcon size={15} aria-hidden="true" />{inventoryMeta.label}</dd>
        </div>
      </dl>

      <div className="ecommerce-inventory-lines" aria-label="Resolución de inventario por producto">
        {(effectiveOrder.items || []).map((item, index) => {
          const lineId = getLineId(item, index);
          const lineStatus = item.inventoryResolution?.status || 'pending';
          return (
            <article key={lineId} className={`ecommerce-inventory-line ecommerce-inventory-line--${lineStatus}`}>
              <div className="ecommerce-inventory-line__copy">
                <strong>{item.ecommerceSnapshotName || item.name || 'Producto'}</strong>
                <span>{getEcommerceInventoryLineMessage(item)}</span>
              </div>
              {isBatchLine(item) && canRunResolution && (
                <button
                  type="button"
                  className="ecommerce-inventory-line__action"
                  onClick={() => openBatchDialog(item, index)}
                  disabled={isLoadingBatches || isSelectingBatch}
                >
                  <Boxes size={15} aria-hidden="true" />
                  {item.inventoryResolution?.status === 'resolved' ? 'Cambiar lote' : 'Seleccionar lote'}
                </button>
              )}
            </article>
          );
        })}
      </div>

      {safeWarnings.length > 0 && (
        <ul className="ecommerce-pos-draft-banner__warnings">
          {safeWarnings.map((warning, index) => (
            <li key={`${warning}-${index}`}><AlertTriangle size={15} aria-hidden="true" />{warning}</li>
          ))}
        </ul>
      )}

      {displayedResolutionError && (
        <p className="ecommerce-inventory-error" role="alert">
          <AlertTriangle size={15} aria-hidden="true" />{displayedResolutionError}
        </p>
      )}

      <div className="ecommerce-pos-draft-banner__actions">
        {canRunResolution && (
          <button
            type="button"
            className="ecommerce-inventory-resolve-button"
            onClick={() => runResolution({ announceFailure: true })}
            disabled={isResolving}
          >
            {isResolving
              ? <LoaderCircle className="ecommerce-inventory-spinner" size={17} aria-hidden="true" />
              : <RefreshCw size={17} aria-hidden="true" />}
            {isResolving ? 'Comprobando inventario…' : 'Resolver inventario'}
          </button>
        )}
        <button type="button" className="ecommerce-pos-draft-banner__link" onClick={onOpenDetail}>
          Volver al detalle del pedido
        </button>
      </div>

      {batchDialog && (
        <div className="ecommerce-batch-dialog-backdrop" role="presentation" onClick={() => setBatchDialog(null)}>
          <div
            className="ecommerce-batch-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ecommerce-batch-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>Resolución manual</span>
                <h3 id="ecommerce-batch-dialog-title">{batchDialog.item.name}</h3>
              </div>
              <button type="button" onClick={() => setBatchDialog(null)} aria-label="Cerrar selección de lote">
                <X size={20} aria-hidden="true" />
              </button>
            </header>
            <p>Solo se muestran lotes activos, vigentes y con existencia.</p>
            <div className="ecommerce-batch-options">
              {batchDialog.options.length === 0 ? (
                <div className="ecommerce-batch-options__empty">No hay un lote vigente disponible.</div>
              ) : batchDialog.options.map((option) => (
                <button
                  type="button"
                  key={option.batchId}
                  className={option.isRecommended ? 'ecommerce-batch-option ecommerce-batch-option--recommended' : 'ecommerce-batch-option'}
                  onClick={() => chooseBatch(option.batchId)}
                  disabled={!option.canCoverRequested || isSelectingBatch}
                >
                  <span className="ecommerce-batch-option__title">
                    <strong>{option.batchNumber || option.batchId}</strong>
                    {option.isRecommended && <em>FEFO recomendado</em>}
                  </span>
                  <span>Caducidad: {option.expirationDate || 'Sin fecha'}</span>
                  <span>Existencia: {option.availableQuantity}</span>
                  {!option.canCoverRequested && <small>No cubre la cantidad requerida</small>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

EcommercePosDraftBanner.propTypes = {
  order: PropTypes.shape({
    id: PropTypes.string,
    origin: PropTypes.string,
    ecommerceOrderCode: PropTypes.string,
    ecommerceDraftStatus: PropTypes.string,
    ecommerceInventoryStatus: PropTypes.string,
    ecommerceInventoryError: PropTypes.shape({
      code: PropTypes.string,
      message: PropTypes.string
    }),
    fulfillmentMethod: PropTypes.string,
    expectedTotal: PropTypes.number,
    currency: PropTypes.string,
    items: PropTypes.arrayOf(PropTypes.object)
  }),
  warnings: PropTypes.arrayOf(PropTypes.string),
  onOpenDetail: PropTypes.func
};
