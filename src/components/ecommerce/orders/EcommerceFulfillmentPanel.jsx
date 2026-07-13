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

const TERMINAL_STATES = new Set(['completed', 'cancelled']);
const PANEL_ORDER_STATUSES = new Set([
  'accepted',
  'converted_to_sale',
  'completed',
  'cancelled'
]);
const REFRESH_ON_CONFLICT_CODES = new Set([
  'ECOMMERCE_ORDER_STATUS_STALE',
  'ECOMMERCE_ORDER_FULFILLMENT_TERMINAL',
  'ECOMMERCE_ORDER_POS_DRAFT_PREPARED',
  'ECOMMERCE_ORDER_POS_CONVERSION_IN_PROGRESS',
  'ECOMMERCE_POS_DRAFT_IN_PROGRESS'
]);

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

const getLicenseIdentity = (licenseDetails = {}) => (
  licenseDetails?.license_key
  || licenseDetails?.licenseKey
  || licenseDetails?.details?.license_key
  || licenseDetails?.details?.licenseKey
  || 'none'
);

const getPanelContextIdentity = (state = {}) => {
  const staffUser = state.currentStaffUser || {};
  const staffIdentity = (
    staffUser.id
    || staffUser.staff_user_id
    || staffUser.user_id
    || staffUser.username
    || 'none'
  );
  const ecommercePermission = staffUser.permissions?.ecommerce === true ? 'allow' : 'deny';
  return [
    getLicenseIdentity(state.licenseDetails),
    state.currentDeviceRole || 'unresolved',
    staffIdentity,
    ecommercePermission
  ].join(':');
};

export default function EcommerceFulfillmentPanel() {
  const pendingRef = useRef(null);
  const loadEpochRef = useRef(0);
  const mountedRef = useRef(true);
  const fulfillmentRequestRef = useRef(null);
  const fulfillmentDirtyRef = useRef(false);
  const publicMessageDirtyRef = useRef(false);
  const selectedOrder = useAppStore((state) => state.selectedEcommerceOrder);
  const selectedRequestId = useAppStore((state) => state.selectedEcommerceOrderRequestId);
  const selectedRefreshRevision = useAppStore(
    (state) => state.ecommerceSelectedOrderRefreshRevision
  );
  const selectedRefreshOrderId = useAppStore(
    (state) => state.ecommerceSelectedOrderRefreshOrderId
  );
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const currentStaffUser = useAppStore((state) => state.currentStaffUser);
  const refreshOrders = useAppStore((state) => state.refreshEcommerceOrders);
  const clearSelectedOrder = useAppStore((state) => state.clearSelectedEcommerceOrder);
  const [operationalOrder, setOperationalOrder] = useState(null);
  const [publicMessage, setPublicMessage] = useState('');
  const [pendingTransition, setPendingTransition] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [loading, setLoading] = useState(false);

  const visibleOrderId = selectedOrder?.id && selectedOrder.id === selectedRequestId
    ? selectedOrder.id
    : null;
  const panelContextIdentity = getPanelContextIdentity({
    licenseDetails,
    currentDeviceRole,
    currentStaffUser
  });
  const actions = useMemo(
    () => getEcommerceFulfillmentActions(operationalOrder || {}),
    [operationalOrder]
  );

  const loadFulfillment = useCallback(function requestFulfillment(orderId, {
    quiet = false,
    preservePublicMessage = true,
    markDirtyIfBusy = true
  } = {}) {
    if (!orderId) return Promise.resolve(null);
    const activeRequest = fulfillmentRequestRef.current;
    if (
      activeRequest?.orderId === orderId
      && activeRequest.contextIdentity === panelContextIdentity
    ) {
      if (markDirtyIfBusy) fulfillmentDirtyRef.current = true;
      return activeRequest.promise;
    }

    const epoch = ++loadEpochRef.current;
    const contextIdentity = panelContextIdentity;
    if (!quiet && mountedRef.current) setLoading(true);

    const request = {
      orderId,
      contextIdentity,
      epoch,
      promise: null
    };
    const promise = (async () => {
      const result = await getEcommerceOrderFulfillment({ licenseDetails, orderId });
      const current = useAppStore.getState();
      const requestIsCurrent = (
        mountedRef.current
        && fulfillmentRequestRef.current === request
        && epoch === loadEpochRef.current
        && current.selectedEcommerceOrderRequestId === orderId
        && current.selectedEcommerceOrder?.id === orderId
        && getPanelContextIdentity(current) === contextIdentity
      );
      if (!requestIsCurrent) return null;

      setLoading(false);
      if (result.success !== true) {
        setFeedback({ type: 'error', text: result.message });
        return null;
      }

      setOperationalOrder(result.order);
      if (!preservePublicMessage || !publicMessageDirtyRef.current) {
        publicMessageDirtyRef.current = false;
        setPublicMessage(result.order.fulfillment?.publicMessage || '');
      }
      return result.order;
    })();
    request.promise = promise;
    fulfillmentRequestRef.current = request;

    void promise.finally(() => {
      if (fulfillmentRequestRef.current !== request) return;
      fulfillmentRequestRef.current = null;
      const shouldReplay = fulfillmentDirtyRef.current;
      fulfillmentDirtyRef.current = false;
      if (!shouldReplay || !mountedRef.current) return;

      const current = useAppStore.getState();
      if (
        current.selectedEcommerceOrderRequestId !== orderId
        || current.selectedEcommerceOrder?.id !== orderId
        || getPanelContextIdentity(current) !== contextIdentity
      ) {
        return;
      }
      void requestFulfillment(orderId, {
        quiet: true,
        preservePublicMessage: true,
        markDirtyIfBusy: false
      });
    });

    return promise;
  }, [licenseDetails, panelContextIdentity]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadEpochRef.current += 1;
      fulfillmentRequestRef.current = null;
      fulfillmentDirtyRef.current = false;
    };
  }, []);

  useEffect(() => {
    pendingRef.current = null;
    loadEpochRef.current += 1;
    fulfillmentRequestRef.current = null;
    fulfillmentDirtyRef.current = false;
    publicMessageDirtyRef.current = false;
    setOperationalOrder(null);
    setPendingTransition(null);
    setFeedback(null);
    setPublicMessage('');
    if (visibleOrderId) void loadFulfillment(visibleOrderId);
    return () => {
      pendingRef.current = null;
      loadEpochRef.current += 1;
      fulfillmentRequestRef.current = null;
      fulfillmentDirtyRef.current = false;
    };
  }, [loadFulfillment, visibleOrderId]);

  useEffect(() => {
    if (
      !visibleOrderId
      || selectedRefreshOrderId !== visibleOrderId
      || Number(selectedRefreshRevision || 0) <= 0
    ) {
      return;
    }
    void loadFulfillment(visibleOrderId, {
      quiet: true,
      preservePublicMessage: true
    });
  }, [
    loadFulfillment,
    selectedRefreshOrderId,
    selectedRefreshRevision,
    visibleOrderId
  ]);

  if (!visibleOrderId || !PANEL_ORDER_STATUSES.has(selectedOrder?.status)) {
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
      if (REFRESH_ON_CONFLICT_CODES.has(result.code)) {
        await loadFulfillment(operation.orderId, { quiet: true });
      }
      return;
    }

    loadEpochRef.current += 1;
    fulfillmentRequestRef.current = null;
    fulfillmentDirtyRef.current = false;

    const confirmedOrder = {
      ...operationalOrder,
      ...result.order,
      fulfillmentMethod: operationalOrder.fulfillmentMethod
    };
    setOperationalOrder(confirmedOrder);
    publicMessageDirtyRef.current = false;
    setPublicMessage(confirmedOrder.fulfillment?.publicMessage || '');

    const nextState = result.order?.fulfillment?.internalStatus
      || result.order?.fulfillment?.status
      || operation.transition;

    await refreshOrders?.({ background: true });

    if (TERMINAL_STATES.has(nextState)) {
      const latestSelection = useAppStore.getState().selectedEcommerceOrderRequestId;
      if (latestSelection === operation.orderId) clearSelectedOrder?.();
      return;
    }

    setFeedback({
      type: 'success',
      text: result.idempotent ? 'El estado ya estaba actualizado.' : 'Estado operativo actualizado.'
    });
    await loadFulfillment(operation.orderId, {
      quiet: true,
      preservePublicMessage: false,
      markDirtyIfBusy: false
    });
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
          onChange={(event) => {
            publicMessageDirtyRef.current = true;
            setPublicMessage(event.target.value.slice(0, 280));
          }}
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
