import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Ban, PackagePlus, Trash2, X } from 'lucide-react';
import { CANCELLATION_ACTIONS } from '../../services/sales/cancelSaleCore';
import { getRefundableAmountsByMethod, REFUNDABLE_PAYMENT_METHODS } from '../../services/sales/saleRefunds';
import { salesCloudCancellationService } from '../../services/salesCloud/salesCloudCancellationService';
import {
  getCloudSaleId,
  isCloudCommittedSale,
  normalizeCloudCancellationPreview
} from '../../services/salesCloud/salesCloudCancellationMapper';
import {
  getSaleCancellationReference,
  getSaleEcommerceOrderCode,
  isEcommerceSale
} from '../../services/sales/saleReference';
import './SaleCancellationModal.css';

const getLineId = (item, index) =>
  item?.lineId || item?.cartItemId || item?.orderItemId || `${item?.id || 'item'}:${index}`;

const formatCurrency = (value) => Number(value || 0).toLocaleString('es-MX', {
  style: 'currency',
  currency: 'MXN'
});

const getPreviewBlockMessage = (preview) => {
  const reasons = Array.isArray(preview?.blockReasons) ? preview.blockReasons : [];
  return reasons[0]?.message || reasons[0]?.code || preview?.message || 'La venta no puede cancelarse automaticamente.';
};

const hasCloudEffects = (response) => {
  const { cash, inventory, credit } = response?.preview || {};
  const hasAmount = (value) =>
    (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
    && Number.isFinite(Number(value));
  return [cash, inventory, credit].every((effect) => typeof effect?.required === 'boolean')
    && (!cash.required || hasAmount(cash.reversal_amount))
    && (!inventory.required || hasAmount(inventory.return_quantity))
    && (!credit.required || [credit.reversal_amount, credit.debt_before, credit.debt_after_preview].every(hasAmount));
};

const getCloudPreviewStatus = (response, sale) => {
  const responseSaleId = response?.sale?.id;
  if (responseSaleId && responseSaleId !== getCloudSaleId(sale)) return 'error';
  if (response?.can_cancel === false) return 'blocked';
  if (response?.success !== true || response.can_cancel !== true
    || !responseSaleId || !hasCloudEffects(response)) return 'error';
  return response.runtimeCancellationEnabled === false ? 'blocked' : 'ready';
};

const previewErrorMessage = 'No se pudo validar la cancelación Cloud.';

export default function SaleCancellationModal({
  show,
  sale,
  actorHandle,
  allowWaste,
  isSubmitting,
  onClose,
  onConfirm
}) {
  const [actions, setActions] = useState({});
  const [reason, setReason] = useState('');
  const [refundAmounts, setRefundAmounts] = useState({ cash: '0', card: '0', transfer: '0' });
  const [error, setError] = useState('');
  const [previewResult, setPreviewResult] = useState(null);
  const activeScope = useRef(null);
  const validatingScope = useRef(null);

  const items = useMemo(() => sale?.items || [], [sale]);
  const isCloudSale = isCloudCommittedSale(sale || {});
  const offlineCloud = isCloudSale
    && typeof navigator !== 'undefined'
    && navigator.onLine === false;
  const scope = useMemo(() => ({ show, sale, actorHandle, offlineCloud }), [show, sale, actorHandle, offlineCloud]);
  const currentResult = previewResult?.scope === scope ? previewResult : null;
  const previewStatus = currentResult?.status || 'loading';
  const serverPreview = currentResult?.response;
  const cloudPreview = serverPreview ? normalizeCloudCancellationPreview(serverPreview, sale) : null;
  const showCloudEffects = serverPreview?.sale?.id && hasCloudEffects(serverPreview)
    && (previewStatus === 'ready' || previewStatus === 'blocked');
  const cloudPreviewLoading = isCloudSale && !offlineCloud && Boolean(actorHandle) && previewStatus === 'loading';
  const cloudPreviewBlocked = previewStatus === 'blocked';
  const cloudRuntimeDisabled = serverPreview?.runtimeCancellationEnabled === false;
  const refundableAmounts = useMemo(() => getRefundableAmountsByMethod(sale || {}), [sale]);

  useEffect(() => {
    if (!show || !sale) return;

    const initialActions = {};
    (sale.items || []).forEach((item, index) => {
      initialActions[getLineId(item, index)] = CANCELLATION_ACTIONS.RESTOCK;
    });

    setActions(initialActions);
    setReason('');
    setRefundAmounts({ cash: '0', card: '0', transfer: '0' });
    setError('');
  }, [show, sale]);

  useLayoutEffect(() => {
    activeScope.current = scope;
    return () => {
      activeScope.current = null;
      validatingScope.current = null;
    };
  }, [scope]);

  useEffect(() => {
    if (!show || !sale || !actorHandle || !isCloudSale || offlineCloud) return;

    let cancelled = false;
    const loadPreview = async () => {
      try {
        actorHandle.assertCurrent('refunds');
        const response = await salesCloudCancellationService.previewCloudSaleCancellation({ sale, actorHandle });
        if (cancelled) return;
        const status = getCloudPreviewStatus(response, sale);
        setPreviewResult({ scope, status, response, error: status === 'error' ? previewErrorMessage : '' });
      } catch (previewError) {
        if (cancelled) return;
        setPreviewResult({ scope, status: 'error', error: previewError?.message || previewErrorMessage });
      }
    };

    loadPreview();
    return () => { cancelled = true; };
  }, [scope, show, sale, actorHandle, isCloudSale, offlineCloud]);

  if (!show || !sale) return null;

  const setItemAction = (lineId, action) => {
    setActions((current) => ({ ...current, [lineId]: action }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!actorHandle) {
      setError('No hay una sesión autorizada para cancelar esta venta.');
      return;
    }
    try {
      actorHandle.assertCurrent('refunds');
    } catch (actorError) {
      setError(actorError?.message || 'La sesión cambió. Vuelve a abrir la cancelación.');
      return;
    }

    if (isSubmitting || (isCloudSale && (previewStatus !== 'ready' || validatingScope.current === scope))) return;

    const trimmedReason = reason.trim();

    if (!isCloudSale) {
      const invalidRefund = REFUNDABLE_PAYMENT_METHODS.some((method) => {
        const requested = Number(refundAmounts[method] || 0);
        const available = Number(refundableAmounts[method] || 0);
        return !Number.isFinite(requested) || requested < 0 || requested > available + 0.000001;
      });
      if (invalidRefund) {
        setError('La devolución supera el importe cobrado y trazable en ese medio de pago.');
        return;
      }
    }

    if (isCloudSale && offlineCloud) {
      setError('Esta venta fue registrada en la nube. Para cancelarla se necesita conexión.');
      return;
    }

    if (isCloudSale && !trimmedReason) {
      setError('Indica el motivo de cancelación para dejar auditoría.');
      return;
    }

    if (isCloudSale) {
      validatingScope.current = scope;
      setPreviewResult({ scope, status: 'loading' });
      try {
        const response = await salesCloudCancellationService.previewCloudSaleCancellation({
          sale,
          reason: trimmedReason,
          actorHandle
        });
        if (activeScope.current !== scope) return;
        actorHandle.assertCurrent('refunds');
        const status = getCloudPreviewStatus(response, sale);
        setPreviewResult({ scope, status, response, error: status === 'error' ? previewErrorMessage : '' });
        if (status !== 'ready') return;
      } catch (previewError) {
        if (activeScope.current === scope) {
          setPreviewResult({ scope, status: 'error', error: previewError?.message || previewErrorMessage });
        }
        return;
      } finally {
        if (validatingScope.current === scope) validatingScope.current = null;
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

    await onConfirm({
      dispositionPlan,
      reason: trimmedReason,
      refunds: isCloudSale
        ? []
        : REFUNDABLE_PAYMENT_METHODS
          .map((method) => ({ method, amount: String(refundAmounts[method] || '0').trim() || '0' }))
          .filter((refund) => Number(refund.amount) > 0)
    });
  };

  const submitDisabled = isSubmitting
    || !actorHandle
    || (!isCloudSale && items.length === 0)
    || offlineCloud
    || (isCloudSale && previewStatus !== 'ready');

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
            <h2 id="sale-cancellation-title">
              Cancelar venta {getSaleCancellationReference(sale) || 'sin folio'}
            </h2>
            {isEcommerceSale(sale) && (
              <p>Pedido relacionado: {getSaleEcommerceOrderCode(sale) || 'sin código normalizado'}</p>
            )}
          </div>

          <button
            type="button"
            className="sale-cancellation-close"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Cerrar"
          >
            <X size={20} />
          </button>
        </header>

        {isCloudSale ? (
          <>
            <div className="sale-cancellation-notice cloud-notice">
              <strong>Cancelación Lanzo Nube.</strong>
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
              <div className="sale-cancellation-notice cloud-status-notice" role="status">
                Validando caja, inventario y crédito…
              </div>
            )}

            {cloudRuntimeDisabled && (
              <div className="sale-cancellation-notice danger-notice">
                Las cancelaciones cloud están apagadas temporalmente por configuración. Solo se permite ver el preview.
              </div>
            )}

            {showCloudEffects && <div className="sale-cancellation-cloud-summary">
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
                    ? `${cloudPreview.inventoryQuantity} unidad(es)`
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
            </div>}

            {cloudPreviewBlocked && serverPreview.can_cancel === false && cloudPreview.blockReasons.length === 0 && (
              <div className="sale-cancellation-notice danger-notice" role="alert">
                {getPreviewBlockMessage(cloudPreview)}
              </div>
            )}

            {cloudPreviewBlocked && cloudPreview.blockReasons.length > 0 && (
              <div className="sale-cancellation-blocked-list" role="alert">
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
              Cancelar una venta no devuelve dinero automáticamente. Indica solo lo que realmente entregas al cliente.
            </div>

            <section className="sale-cancellation-refunds" aria-labelledby="sale-refunds-title">
              <h3 id="sale-refunds-title">Dinero devuelto</h3>
              <p>La devolución se registra por separado de la cancelación. No captures pagos que no se devolvieron.</p>
              {REFUNDABLE_PAYMENT_METHODS.map((method) => {
                const available = Number(refundableAmounts[method] || 0);
                const label = method === 'cash' ? 'Efectivo' : method === 'card' ? 'Tarjeta' : 'Transferencia';
                return (
                  <label className="sale-cancellation-refund-row" key={method}>
                    <span>{label}<small>Disponible para devolver: {formatCurrency(available)}</small></span>
                    <input
                      type="number"
                      min="0"
                      max={Number.isFinite(available) ? available.toFixed(2) : '0'}
                      step="0.01"
                      inputMode="decimal"
                      value={refundAmounts[method]}
                      disabled={available <= 0 || isSubmitting}
                      onChange={(event) => {
                        setRefundAmounts((current) => ({ ...current, [method]: event.target.value }));
                        setError('');
                      }}
                      aria-label={`Importe devuelto en ${label.toLowerCase()}`}
                    />
                  </label>
                );
              })}
              {REFUNDABLE_PAYMENT_METHODS.every((method) => Number(refundableAmounts[method] || 0) <= 0) && (
                <small className="sale-cancellation-refund-empty">
                  No hay cobros con medio verificable disponibles para devolver. La venta puede cancelarse sin registrar reembolso.
                </small>
              )}
            </section>

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

        {(currentResult?.error || error || (isCloudSale && !actorHandle)) && (
          <div className="sale-cancellation-error" role="alert">
            {currentResult?.error || error || 'No hay una sesión autorizada para cancelar esta venta.'}
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
