import { useEffect, useMemo, useState } from 'react';
import { Ban, PackagePlus, Trash2, X } from 'lucide-react';
import { CANCELLATION_ACTIONS } from '../../services/sales/cancelSaleCore';
import { salesCloudCancellationService } from '../../services/salesCloud/salesCloudCancellationService';
import {
  buildCancellationPreview,
  isCloudCommittedSale,
  normalizeCloudCancellationPreview
} from '../../services/salesCloud/salesCloudCancellationMapper';
import './SaleCancellationModal.css';

const getLineId = (item, index) =>
  item?.lineId || item?.cartItemId || item?.orderItemId || `${item?.id || 'item'}:${index}`;

const formatCurrency = (value) => Number(value || 0).toLocaleString('es-MX', {
  style: 'currency',
  currency: 'MXN'
});

const getPreviewBlockMessage = (preview) => {
  const reasons = Array.isArray(preview?.blockReasons) ? preview.blockReasons : [];
  return reasons[0]?.message || preview?.message || 'La venta no puede cancelarse automaticamente.';
};

export default function SaleCancellationModal({
  show,
  sale,
  allowWaste,
  isSubmitting,
  onClose,
  onConfirm
}) {
  const [actions, setActions] = useState({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [serverPreview, setServerPreview] = useState(null);
  const [previewStatus, setPreviewStatus] = useState('idle');

  const items = useMemo(() => sale?.items || [], [sale]);
  const isCloudSale = useMemo(() => isCloudCommittedSale(sale || {}), [sale]);
  const localCloudPreview = useMemo(() => buildCancellationPreview(sale || {}), [sale]);
  const cloudPreview = useMemo(() => (
    serverPreview
      ? normalizeCloudCancellationPreview(serverPreview, sale || {})
      : localCloudPreview
  ), [serverPreview, sale, localCloudPreview]);

  const offlineCloud = isCloudSale
    && typeof navigator !== 'undefined'
    && navigator.onLine === false;

  const cloudPreviewLoading = isCloudSale && previewStatus === 'loading';
  const cloudPreviewFailed = isCloudSale && previewStatus === 'error';
  const cloudPreviewBlocked = isCloudSale && serverPreview && serverPreview.can_cancel === false;
  const cloudRuntimeDisabled = isCloudSale && serverPreview?.runtimeCancellationEnabled === false;

  useEffect(() => {
    if (!show || !sale) return;

    const initialActions = {};
    (sale.items || []).forEach((item, index) => {
      initialActions[getLineId(item, index)] = CANCELLATION_ACTIONS.RESTOCK;
    });

    setActions(initialActions);
    setReason('');
    setError('');
    setServerPreview(null);
    setPreviewStatus('idle');
  }, [show, sale]);

  useEffect(() => {
    if (!show || !sale || !isCloudSale || offlineCloud) return undefined;

    let cancelled = false;

    const loadPreview = async () => {
      setPreviewStatus('loading');
      try {
        const preview = await salesCloudCancellationService.previewCloudSaleCancellation({ sale });
        if (cancelled) return;
        setServerPreview(preview);
        setPreviewStatus(preview?.can_cancel === false ? 'blocked' : 'ready');
      } catch (previewError) {
        if (cancelled) return;
        setPreviewStatus('error');
        setError(previewError?.message || 'No se pudo validar la cancelacion cloud. No se modificara nada.');
      }
    };

    loadPreview();

    return () => {
      cancelled = true;
    };
  }, [show, sale, isCloudSale, offlineCloud]);

  if (!show || !sale) return null;

  const setItemAction = (lineId, action) => {
    setActions((current) => ({ ...current, [lineId]: action }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const trimmedReason = reason.trim();

    if (isCloudSale && offlineCloud) {
      setError('Esta venta fue registrada en la nube. Para cancelarla se necesita conexión.');
      return;
    }

    if (isCloudSale && !trimmedReason) {
      setError('Indica el motivo de cancelación para dejar auditoría.');
      return;
    }

    if (isCloudSale) {
      setPreviewStatus('loading');
      try {
        const preview = await salesCloudCancellationService.previewCloudSaleCancellation({
          sale,
          reason: trimmedReason
        });
        const normalizedPreview = normalizeCloudCancellationPreview(preview, sale || {});
        setServerPreview(preview);

        if (preview?.runtimeCancellationEnabled === false) {
          setPreviewStatus('blocked');
          setError('Las cancelaciones cloud estan apagadas temporalmente. Puedes revisar el preview, pero no se aplicara la cancelacion.');
          return;
        }

        if (preview?.success === false || preview?.can_cancel === false) {
          setPreviewStatus('blocked');
          setError(getPreviewBlockMessage(normalizedPreview));
          return;
        }

        setPreviewStatus('ready');
      } catch (previewError) {
        setPreviewStatus('error');
        setError(previewError?.message || 'No se pudo validar la cancelacion cloud. No se modifico nada.');
        return;
      }
    }

    const dispositionPlan = isCloudSale
      ? []
      : items.map((item, index) => {
        const lineId = getLineId(item, index);
        return {
          lineId,
          action: actions[lineId] || CANCELLATION_ACTIONS.RESTOCK,
          reason: actions[lineId] === CANCELLATION_ACTIONS.WASTE
            ? 'venta_cancelada'
            : trimmedReason,
          notes: trimmedReason
        };
      });

    onConfirm({
      dispositionPlan,
      reason: trimmedReason
    });
  };

  const submitDisabled = isSubmitting
    || (!isCloudSale && items.length === 0)
    || offlineCloud
    || cloudPreviewLoading
    || cloudPreviewFailed
    || cloudPreviewBlocked
    || cloudRuntimeDisabled;

  return (
    <div className="sale-cancellation-overlay" role="presentation">
      <form
        className="sale-cancellation-modal"
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sale-cancellation-title"
      >
        <header className="sale-cancellation-header">
          <div>
            <h2 id="sale-cancellation-title">Cancelar venta</h2>
            <p>Folio {sale.folio || sale.cloudFolio || sale.id || 'sin folio'}</p>
          </div>

          <button
            type="button"
            className="sale-cancellation-close"
            onClick={onClose}
            disabled={isSubmitting}
          >
            <X size={20} />
          </button>
        </header>

        {isCloudSale ? (
          <>
            <div className="sale-cancellation-notice cloud-notice">
              <strong>Cancelación cloud PRO.</strong>
              <p>
                Esta venta fue registrada en la nube. Antes de aplicar cambios se ejecuta un
                preview seguro que valida caja, inventario/lotes y deuda. No se borrará el historial original.
              </p>
            </div>

            {offlineCloud && (
              <div className="sale-cancellation-notice danger-notice">
                Esta venta fue registrada en la nube. Para cancelarla se necesita conexión.
              </div>
            )}

            {cloudPreviewLoading && (
              <div className="sale-cancellation-notice cloud-status-notice">
                Validando la cancelación en la nube antes de modificar datos...
              </div>
            )}

            {cloudRuntimeDisabled && (
              <div className="sale-cancellation-notice danger-notice">
                Las cancelaciones cloud están apagadas temporalmente por configuración. Solo se permite ver el preview.
              </div>
            )}

            <div className="sale-cancellation-cloud-summary">
              <section>
                <span>Total de la venta</span>
                <strong>{formatCurrency(cloudPreview.total)}</strong>
              </section>

              <section>
                <span>Caja</span>
                <strong>
                  {cloudPreview.cashReversalRequired
                    ? `${formatCurrency(cloudPreview.cashAmount)} a revertir`
                    : 'No requerida'}
                </strong>
                {cloudPreview.cashMovementCount > 0 && <small>{cloudPreview.cashMovementCount} movimiento(s)</small>}
              </section>

              <section>
                <span>Inventario</span>
                <strong>
                  {cloudPreview.inventoryReversalRequired
                    ? `${cloudPreview.inventoryQuantity || 0} unidad(es)`
                    : 'No requerido'}
                </strong>
                {cloudPreview.inventoryMovementCount > 0 && <small>{cloudPreview.inventoryMovementCount} salida(s)</small>}
              </section>

              <section>
                <span>Crédito</span>
                <strong>
                  {cloudPreview.creditReversalRequired
                    ? `${formatCurrency(cloudPreview.creditReversalAmount)} a revertir`
                    : 'No requerido'}
                </strong>
                {cloudPreview.creditReversalRequired && (
                  <small>
                    Deuda: {formatCurrency(cloudPreview.debtBefore)} → {formatCurrency(cloudPreview.debtAfterPreview)}
                  </small>
                )}
              </section>

              {cloudPreview.customerName && (
                <section>
                  <span>Cliente</span>
                  <strong>{cloudPreview.customerName}</strong>
                </section>
              )}
            </div>

            {Array.isArray(cloudPreview.blockReasons) && cloudPreview.blockReasons.length > 0 && (
              <div className="sale-cancellation-blocked-list">
                <strong>No se puede cancelar automáticamente:</strong>
                <ul>
                  {cloudPreview.blockReasons.map((blockReason, index) => (
                    <li key={`${blockReason.code || 'block'}:${index}`}>
                      {blockReason.message || blockReason.code || 'Bloqueo de seguridad'}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="sale-cancellation-notice">
              Selecciona el destino de cada producto. La venta quedará en el historial como cancelada.
            </div>

            <div className="sale-cancellation-items">
              {items.map((item, index) => {
                const lineId = getLineId(item, index);
                const selected = actions[lineId];
                const usesBatches = Array.isArray(item.batchesUsed) && item.batchesUsed.length > 0;

                return (
                  <section className="sale-cancellation-item" key={lineId}>
                    <div className="sale-cancellation-item-title">
                      <strong>{item.quantity || 0} x {item.name || 'Producto'}</strong>
                      <span>{usesBatches ? 'Inventario por lote' : 'Inventario directo'}</span>
                    </div>

                    <div className="sale-cancellation-options">
                      <button
                        type="button"
                        className={selected === CANCELLATION_ACTIONS.RESTOCK ? 'selected restock' : ''}
                        onClick={() => setItemAction(lineId, CANCELLATION_ACTIONS.RESTOCK)}
                      >
                        <PackagePlus size={19} />
                        <span>
                          <strong>{usesBatches ? 'Regresar al lote' : 'Regresar a inventario'}</strong>
                          <small>El producto vuelve a estar disponible.</small>
                        </span>
                      </button>

                      <button
                        type="button"
                        className={selected === CANCELLATION_ACTIONS.NO_RETURN ? 'selected no-return' : ''}
                        onClick={() => setItemAction(lineId, CANCELLATION_ACTIONS.NO_RETURN)}
                      >
                        <Ban size={19} />
                        <span>
                          <strong>No regresar</strong>
                          <small>Conserva la salida original de inventario.</small>
                        </span>
                      </button>

                      {allowWaste && (
                        <button
                          type="button"
                          className={selected === CANCELLATION_ACTIONS.WASTE ? 'selected waste' : ''}
                          onClick={() => setItemAction(lineId, CANCELLATION_ACTIONS.WASTE)}
                        >
                          <Trash2 size={19} />
                          <span>
                            <strong>Registrar como merma</strong>
                            <small>Reclasifica la salida sin descontar otra vez.</small>
                          </span>
                        </button>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        )}

        <label className="sale-cancellation-reason">
          Motivo de cancelación{isCloudSale ? ' *' : ''}
          <textarea
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setError('');
            }}
            placeholder="Ej. cobro duplicado, error de captura o rechazo del cliente"
            maxLength={300}
            required={isCloudSale}
          />
        </label>

        {error && (
          <div className="sale-cancellation-error">
            {error}
          </div>
        )}

        <footer className="sale-cancellation-actions">
          <button
            type="button"
            className="btn btn-cancel"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Volver
          </button>

          <button
            type="submit"
            className="btn btn-confirm"
            disabled={submitDisabled}
          >
            {isSubmitting || cloudPreviewLoading
              ? 'Validando...'
              : isCloudSale
                ? 'Confirmar cancelación cloud'
                : 'Confirmar cancelación'}
          </button>
        </footer>
      </form>
    </div>
  );
}
