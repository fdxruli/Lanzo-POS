import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, LoaderCircle, X } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import {
  FULFILLMENT_LABELS,
  getEcommerceFulfillmentActions,
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
  const selectedOrder = useAppStore((state) => state.selectedEcommerceOrder);
  const selectedRequestId = useAppStore((state) => state.selectedEcommerceOrderRequestId);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const openOrder = useAppStore((state) => state.openEcommerceOrder);
  const refreshOrders = useAppStore((state) => state.refreshEcommerceOrders);
  const [publicMessage, setPublicMessage] = useState('');
  const [pendingTransition, setPendingTransition] = useState(null);
  const [feedback, setFeedback] = useState(null);

  const visibleOrder = selectedOrder?.id && selectedOrder.id === selectedRequestId
    ? selectedOrder
    : null;
  const fulfillment = visibleOrder?.fulfillment;
  const actions = useMemo(() => getEcommerceFulfillmentActions(visibleOrder || {}), [visibleOrder]);

  useEffect(() => {
    pendingRef.current = null;
    setPendingTransition(null);
    setFeedback(null);
    setPublicMessage(fulfillment?.publicMessage || '');
  }, [fulfillment?.publicMessage, visibleOrder?.id]);

  if (!visibleOrder || visibleOrder.status !== 'accepted' || !fulfillment) return null;

  const runTransition = async (action) => {
    if (pendingRef.current) return;
    if (action.destructive && !globalThis.confirm?.('¿Cancelar este pedido? Esta acción no se puede deshacer desde la bandeja.')) {
      return;
    }

    const orderId = visibleOrder.id;
    const expectedVersion = Number(fulfillment.version || 0);
    const operation = {
      orderId,
      transition: action.transition,
      expectedVersion,
      idempotencyKey: createIdempotencyKey()
    };
    pendingRef.current = operation;
    setPendingTransition(action.transition);
    setFeedback(null);

    const result = await updateEcommerceOrderFulfillment({
      licenseDetails,
      orderId,
      transition: action.transition,
      expectedVersion,
      idempotencyKey: operation.idempotencyKey,
      publicMessage
    });

    const currentSelection = useAppStore.getState().selectedEcommerceOrderRequestId;
    if (pendingRef.current !== operation) return;
    pendingRef.current = null;
    setPendingTransition(null);

    if (result.success !== true) {
      setFeedback({ type: 'error', text: result.message });
      if (result.code === 'ECOMMERCE_ORDER_STATUS_STALE' && currentSelection === orderId) {
        await openOrder?.(orderId, { force: true, markSeen: false });
      }
      return;
    }

    setFeedback({
      type: 'success',
      text: result.idempotent ? 'El estado ya estaba actualizado.' : 'Estado operativo actualizado.'
    });
    if (currentSelection === orderId) {
      await openOrder?.(orderId, { force: true, markSeen: false });
    }
    await refreshOrders?.({ background: true });
  };

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
              className={action.destructive ? 'ui-button ui-button--danger' : 'ui-button ui-button--primary'}
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
