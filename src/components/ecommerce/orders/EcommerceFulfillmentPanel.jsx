import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, LoaderCircle, X } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import {
  FULFILLMENT_LABELS,
  getEcommerceFulfillmentActions,
  getEcommerceOrderFulfillment,
  updateEcommerceOrderFulfillment
} from '../../../services/ecommerce/ecommerceOrderFulfillmentService';
import './EcommerceFulfillmentPanel.css';

const formatDateTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No disponible';
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
};

const createIdempotencyKey = () => (
  globalThis.crypto?.randomUUID?.()
  || `fulfillment-${Date.now()}-${Math.random().toString(36).slice(2)}`
);

export default function EcommerceFulfillmentPanel() {
  const pendingRef = useRef(null);
  const loadEpochRef = useRef(0);
  const selectedOrder = useAppStore((state) => state.selectedEcommerceOrder);
  const selectedRequestId = useAppStore((state) => state.selectedEcommerceOrderRequestId);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const refreshOrders = useAppStore((state) => state.refreshEcommerceOrders);
  const [operationalOrder, setOperationalOrder] = useState(null);
  const [publicMessage, setPublicMessage] = useState('');
  const [pendingTransition, setPendingTransition] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [loading, setLoading] = useState(false);

  const visibleOrderId = selectedOrder?.id && selectedOrder.id === selectedRequestId
    ? selectedOrder.id
    : null;
  const actions = useMemo(
    () => getEcommerceFulfillmentActions(operationalOrder || {}),
    [operationalOrder]
  );

  const loadFulfillment = useCallback(async (orderId, { quiet = false } = {}) => {
    if (!orderId) return null;
    const epoch = ++loadEpochRef.current;
    if (!quiet) setLoading(true);
    const result = await getEcommerceOrderFulfillment({ licenseDetails, orderId });
    const currentSelection = useAppStore.getState().selectedEcommerceOrderRequestId;
    if (epoch !== loadEpochRef.current || currentSelection !== orderId) return null;
    setLoading(false);
    if (result.success !== true) {
      setFeedback({ type: 'error', text: result.message });
      return null;
    }
    setOperationalOrder(result.order);
    setPublicMessage(result.order.fulfillment?.publicMessage || '');
    return result.order;
  }, [licenseDetails]);

  useEffect(() => {
    pendingRef.current = null;
    loadEpochRef.current += 1;
    setOperationalOrder(null);
    setPendingTransition(null);
    setFeedback(null);
    setPublicMessage('');
    if (visibleOrderId) void loadFulfillment(visibleOrderId);
    return () => {
      pendingRef.current = null;
      loadEpochRef.current += 1;
    };
  }, [loadFulfillment, visibleOrderId]);

  if (!visibleOrderId || !['accepted', 'converted_to_sale'].includes(selectedOrder?.status)) {
    return null;
  }

  const fulfillment = operationalOrder?.fulfillment;
  const runTransition = async (action) => {
    if (pendingRef.current || !operationalOrder || !fulfillment) return;
    if (action.destructive && !globalThis.confirm?.('¿Cancelar este pedido? Esta acción no se puede deshacer desde la bandeja.')) {
      return;
    }

    const operation = {
      orderId: operationalOrder.id,
      transition: action.transition,
      expectedVersion: Number(fulfillment.version || 0),
      idempotencyKey: createIdempotencyKey()
    };
    pendingRef.current = operation;
    setPendingTransition(action.transition);
    setFeedback(null);

    const result = await updateEcommerceOrderFulfillment({
      licenseDetails,
      orderId: operation.orderId,
      transition: operation.transition,
      expectedVersion: operation.expectedVersion,
      idempotencyKey: operation.idempotencyKey,
      publicMessage
    });

    const currentSelection = useAppStore.getState().selectedEcommerceOrderRequestId;
    if (pendingRef.current !== operation) return;
    pendingRef.current = null;
    setPendingTransition(null);

    if (currentSelection !== operation.orderId) return;
    if (result.success !== true) {
      setFeedback({ type: 'error', text: result.message });
      if (result.code === 'ECOMMERCE_ORDER_STATUS_STALE') {
        await loadFulfillment(operation.orderId, { quiet: true });
      }
      return;
    }

    setFeedback({
      type: 'success',
      text: result.idempotent ? 'El estado ya estaba actualizado.' : 'Estado operativo actualizado.'
    });
    await loadFulfillment(operation.orderId, { quiet: true });
    await refreshOrders?.({ background: true });
  };

  if (loading || !operationalOrder || !fulfillment) {
    return (
      <aside className="ecommerce-fulfillment-panel" aria-live="polite" aria-busy="true">
        <div className="ecommerce-fulfillment-loading">
          <LoaderCircle className="ecommerce-fulfillment-spinner" aria-hidden="true" size={20} />
          Cargando estado operativo…
        </div>
      </aside>
    );
  }

  const state = fulfillment.internalStatus || fulfillment.status || 'accepted';

  return (
    <aside className="ecommerce-fulfillment-panel" aria-labelledby="ecommerce-fulfillment-title">
      <header>
        <div>
          <p>Operación del pedido</p>
          <h2 id="ecommerce-fulfillment-title">{FULFILLMENT_LABELS[state] || state}</h2>
        </div>
        {state === 'completed' ? <CheckCircle2 aria-hidden="true" size={24} /> : null}
      </header>

      <dl>
        <div><dt>Última actualización</dt><dd>{formatDateTime(fulfillment.updatedAt)}</dd></div>
        <div><dt>Versión</dt><dd>{fulfillment.version}</dd></div>
        <div><dt>Pago</dt><dd>{fulfillment.paymentRegistered ? 'Registrado' : 'Sin confirmar'}</dd></div>
      </dl>

      <label>
        <span>Mensaje público</span>
        <textarea
          value={publicMessage}
          onChange={(event) => setPublicMessage(event.target.value.slice(0, 280))}
          maxLength={280}
          rows={3}
          disabled={Boolean(pendingTransition) || actions.length === 0}
          placeholder="Ejemplo: Tu pedido estará listo en aproximadamente 15 minutos."
        />
        <small>{publicMessage.length}/280</small>
      </label>

      {feedback ? (
        <div className={`ecommerce-fulfillment-feedback is-${feedback.type}`} aria-live="polite">
          {feedback.type === 'error'
            ? <AlertTriangle aria-hidden="true" size={18} />
            : <CheckCircle2 aria-hidden="true" size={18} />}
          <span>{feedback.text}</span>
        </div>
      ) : null}

      {actions.length > 0 ? (
        <div className="ecommerce-fulfillment-actions">
          {actions.map((action) => (
            <button
              key={action.transition}
              type="button"
              className={action.destructive
                ? 'ui-button ui-button--secondary ecommerce-fulfillment-action--destructive'
                : 'ui-button ui-button--primary'}
              disabled={Boolean(pendingTransition)}
              onClick={() => runTransition(action)}
            >
              {pendingTransition === action.transition
                ? <LoaderCircle className="ecommerce-fulfillment-spinner" aria-hidden="true" size={18} />
                : action.destructive
                  ? <X aria-hidden="true" size={18} />
                  : null}
              {pendingTransition === action.transition ? 'Actualizando…' : action.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="ecommerce-fulfillment-terminal">Este estado no tiene acciones operativas disponibles.</p>
      )}
    </aside>
  );
}
