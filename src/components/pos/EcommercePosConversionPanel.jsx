import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import {
  CheckCircle2,
  CreditCard,
  LoaderCircle,
  RefreshCw,
  ReceiptText,
  ShieldAlert,
  XCircle
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getEcommerceCheckoutInitiation } from '../../hooks/pos/ecommerceCheckoutInitiationSingleFlight';
import { useActiveOrders } from '../../hooks/pos/useActiveOrders';
import {
  ECOMMERCE_CONVERSION_STATUS,
  ECOMMERCE_POS_CONVERSION_CONTRACT_VERSION
} from '../../services/ecommerce/ecommercePosCheckoutConversion';
import {
  ECOMMERCE_REMOTE_CONTRACT_PENDING,
  getEcommercePosConversionRemoteState,
  recoverEcommercePosConversion,
  retryEcommerceConversionConfirmation
} from '../../services/ecommerce/ecommercePosConversionService';
import { showConfirmModal, showMessageModal } from '../../services/utils';
import { useAppStore } from '../../store/useAppStore';

const BUSY_STATUSES = new Set([
  ECOMMERCE_CONVERSION_STATUS.PAYMENT_PENDING,
  ECOMMERCE_CONVERSION_STATUS.PROCESSING_SALE
]);

const CONFIRMATION_STATUSES = new Set([
  ECOMMERCE_CONVERSION_STATUS.SALE_CREATED,
  ECOMMERCE_CONVERSION_STATUS.CONFIRMATION_PENDING
]);

const hasLiveCheckoutOwnership = (order = {}, orderId = null) => Boolean(
  getEcommerceCheckoutInitiation(orderId)
  || (
    order.isLockedForCheckout === true
    && Boolean(order.ecommerceCanonicalCheckoutAttemptId)
  )
);

const STATUS_COPY = Object.freeze({
  [ECOMMERCE_CONVERSION_STATUS.IDLE]: 'Sin iniciar',
  [ECOMMERCE_CONVERSION_STATUS.VALIDATING]: 'Comprobando inventario y pedido…',
  [ECOMMERCE_CONVERSION_STATUS.PAYMENT_PENDING]: 'Pago pendiente',
  [ECOMMERCE_CONVERSION_STATUS.PROCESSING_SALE]: 'Registrando venta…',
  [ECOMMERCE_CONVERSION_STATUS.SALE_CREATED]: 'Venta registrada',
  [ECOMMERCE_CONVERSION_STATUS.CONFIRMATION_PENDING]: 'Confirmación online pendiente',
  [ECOMMERCE_CONVERSION_STATUS.COMPLETED]: 'Pedido convertido correctamente',
  [ECOMMERCE_CONVERSION_STATUS.ERROR]: 'Revisión necesaria'
});

const getInventoryCopy = (order = {}) => {
  if (order.ecommerceInventoryStatus === 'ready') return 'Inventario: Listo';
  if (order.ecommerceInventoryStatus === 'conflict') return 'Inventario: Requiere atención';
  return 'Inventario: Pendiente';
};

const OPERATIONAL_STATUS_COPY = Object.freeze({
  accepted: 'Pedido aceptado',
  preparing: 'En preparación',
  ready: 'Listo',
  out_for_delivery: 'En camino',
  completed: 'Completado',
  cancelled: 'Cancelado',
  attention: 'Requiere atención'
});

const getOperationalStatusCopy = (order = {}) => (
  OPERATIONAL_STATUS_COPY[order.ecommerceOperationalStatus] || 'Pedido aceptado'
);

const hasVerifiedRemoteState = (order = {}) => Boolean(order.ecommerceRemoteStateVerifiedAt);

const hasLostRemoteClaim = (order = {}) => {
  if (!hasVerifiedRemoteState(order)) return false;
  if (['none', 'released'].includes(order.ecommerceRemoteDraftStatus)) return true;
  return order.ecommerceRemoteClaimOwned === false || order.ecommerceRemoteClaimValid === false;
};

const getDraftExitState = ({
  order = {},
  isBusy = false,
  isCheckingRemote = false,
  isConfirmationPending = false
} = {}) => {
  const claimLost = hasLostRemoteClaim(order);
  const hasCreatedSale = Boolean(
    order.ecommerceRemoteConvertedSaleId
    || order.ecommerceConvertedSaleId
    || order.ecommerceConversionStatus === ECOMMERCE_CONVERSION_STATUS.COMPLETED
  );
  const checkoutOwned = hasLiveCheckoutOwnership(order, order.id);
  const actionBlocked = Boolean(
    isBusy
    || isCheckingRemote
    || isConfirmationPending
    || hasCreatedSale
    || checkoutOwned
  );

  return {
    claimLost,
    canRemoveLocal: claimLost && !actionBlocked,
    canRelease: Boolean(
      !claimLost
      && !actionBlocked
      && order.ecommerceDraftStatus === 'prepared'
      && order.ecommerceRemoteClaimOwned === true
      && order.ecommerceRemoteClaimValid === true
      && order.ecommerceRemoteConversionStatus === 'idle'
    )
  };
};

const getBlockedMessage = (order = {}, isCheckingRemote = false) => {
  if (isCheckingRemote) return 'Comprobando contrato remoto y propiedad del pedido…';
  if (hasLostRemoteClaim(order)) {
    return 'Este pedido fue liberado desde otro dispositivo. Retira la copia local para continuar usando el Punto de Venta.';
  }
  if (order.ecommerceInventoryStatus !== 'ready') {
    return order.ecommerceInventoryError?.message || 'Resuelve el inventario antes de cobrar.';
  }
  if (order.ecommerceCheckoutGateCode === ECOMMERCE_REMOTE_CONTRACT_PENDING) {
    return 'El cobro seguirá bloqueado hasta aplicar y validar el contrato remoto de conversión.';
  }
  if (order.ecommerceRemoteConversionStatus === 'reserved') {
    if (order.ecommerceRemoteConversionOwned === true) {
      return order.ecommerceConversionError?.message
        || 'Este pedido conserva una reserva de conversión pendiente de recuperación.';
    }
    return 'Este pedido ya está siendo procesado por otro dispositivo o intento.';
  }
  if (order.ecommerceRemoteConversionStatus === 'unknown') {
    return 'No se pudo confirmar si la reserva remota fue liberada. El cobro permanece bloqueado.';
  }
  if (order.ecommerceRemoteClaimOwned === false || order.ecommerceRemoteClaimValid === false) {
    return 'La reserva del pedido ya no pertenece a este dispositivo o venció.';
  }
  return order.ecommerceCheckoutGateMessage || order.ecommerceConversionError?.message || null;
};

export default function EcommercePosConversionPanel({ order, onCheckout, onDraftRemoved }) {
  const navigate = useNavigate();
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const [isCheckingRemote, setIsCheckingRemote] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [draftAction, setDraftAction] = useState(null);
  const checkSequenceRef = useRef(0);
  const orderId = order?.id || null;

  const conversionStatus = order?.ecommerceConversionStatus || ECOMMERCE_CONVERSION_STATUS.IDLE;
  const isConfirmationPending = CONFIRMATION_STATUSES.has(conversionStatus)
    || Boolean(order?.ecommerceConvertedSaleId);
  const hasLiveInitiation = Boolean(getEcommerceCheckoutInitiation(orderId));
  const isStarting = hasLiveInitiation && (
    order?.ecommerceCheckoutInitiationStatus === 'starting'
    || conversionStatus === ECOMMERCE_CONVERSION_STATUS.VALIDATING
  );
  const isBusy = isStarting || BUSY_STATUSES.has(conversionStatus);

  const verifyRemoteState = useCallback(async () => {
    if (!orderId) return null;
    const liveOrder = useActiveOrders.getState().activeOrders.get(orderId);
    if (!liveOrder || liveOrder.origin !== 'ecommerce') return null;

    const checkSequence = checkSequenceRef.current + 1;
    checkSequenceRef.current = checkSequence;
    setIsCheckingRemote(true);

    const result = await getEcommercePosConversionRemoteState({
      order: liveOrder,
      licenseDetails
    });
    if (checkSequenceRef.current !== checkSequence) return result;

    const latestOrder = useActiveOrders.getState().activeOrders.get(orderId);
    if (!latestOrder || latestOrder.origin !== 'ecommerce') {
      setIsCheckingRemote(false);
      return result;
    }

    if (result.success === false) {
      useActiveOrders.getState().updateOrder(orderId, {
        ecommerceRemoteContractVersion: result.remoteContractVersion || 0,
        ecommerceRemoteDraftStatus: null,
        ecommerceRemoteStateVerifiedAt: null,
        ecommerceRemoteClaimOwned: false,
        ecommerceRemoteClaimValid: false,
        ecommerceRemoteConversionStatus: 'unknown',
        ecommerceRemoteConversionOwned: false,
        ecommerceCheckoutGateStatus: 'blocked',
        ecommerceCheckoutGateCode: result.code || ECOMMERCE_REMOTE_CONTRACT_PENDING,
        ecommerceCheckoutGateMessage: result.message || 'No se pudo comprobar el contrato remoto.'
      });
      setIsCheckingRemote(false);
      return result;
    }

    useActiveOrders.getState().updateOrder(orderId, {
      ecommerceRemoteContractVersion: result.remoteContractVersion || 0,
      ecommerceRemoteOrderStatus: result.orderStatus || null,
      ecommerceRemoteDraftStatus: result.draftStatus || null,
      ecommerceRemoteStateVerifiedAt: new Date().toISOString(),
      ecommerceRemoteClaimOwned: result.claimOwned === true,
      ecommerceRemoteClaimValid: result.claimValid === true,
      ecommerceRemoteConversionStatus: result.conversionStatus || 'idle',
      ecommerceRemoteConversionOwned: result.conversionOwned === true,
      ecommerceRemoteConversionAttemptId: result.conversionAttemptId || null,
      ecommerceRemoteReservedSaleId: result.reservedSaleId || null,
      ecommerceRemoteConversionStartedAt: result.conversionStartedAt || null,
      ecommerceRemoteConvertedSaleId: result.convertedSaleId || null,
      ecommerceCheckoutGateStatus: 'blocked',
      ecommerceCheckoutGateCode: result.convertedSaleId
        ? 'ECOMMERCE_ALREADY_CONVERTED'
        : (result.conversionStatus === 'reserved'
          ? 'ECOMMERCE_POS_CONVERSION_IN_PROGRESS'
          : null),
      ecommerceCheckoutGateMessage: result.convertedSaleId
        ? 'La venta ya existe; solo falta confirmar el pedido online.'
        : (result.conversionStatus === 'reserved'
          ? 'Este pedido conserva una reserva remota de conversión.'
          : null)
    });
    setIsCheckingRemote(false);
    return result;
  }, [licenseDetails, orderId]);

  useEffect(() => {
    if (!orderId || order?.origin !== 'ecommerce') return undefined;
    let active = true;

    const recoverAndVerify = async () => {
      const liveOrder = useActiveOrders.getState().activeOrders.get(orderId);
      if (!liveOrder || liveOrder.origin !== 'ecommerce') return;

      // Recovery is for interrupted attempts. Running it while the payment modal
      // still owns the checkout can cancel the reservation that checkout needs.
      if (hasLiveCheckoutOwnership(liveOrder, orderId)) return;

      await recoverEcommercePosConversion({ orderId });
      if (!active) return;

      const latestOrder = useActiveOrders.getState().activeOrders.get(orderId);
      const latestStatus = latestOrder?.ecommerceConversionStatus || ECOMMERCE_CONVERSION_STATUS.IDLE;
      if (
        latestOrder
        && latestOrder.ecommerceInventoryStatus === 'ready'
        && !CONFIRMATION_STATUSES.has(latestStatus)
        && latestStatus !== ECOMMERCE_CONVERSION_STATUS.COMPLETED
      ) {
        await verifyRemoteState();
      }
    };

    recoverAndVerify();
    return () => {
      active = false;
      checkSequenceRef.current += 1;
    };
  }, [orderId, order?.origin, order?.ecommerceInventoryResolvedAt, order?.ecommerceInventoryStatus, verifyRemoteState]);

  useEffect(() => {
    if (!orderId || order?.origin !== 'ecommerce') return undefined;

    const revalidateOnResume = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const liveOrder = useActiveOrders.getState().activeOrders.get(orderId);
      if (!liveOrder || liveOrder.origin !== 'ecommerce') return;
      if (hasLiveCheckoutOwnership(liveOrder, orderId)) return;
      void verifyRemoteState();
    };

    window.addEventListener('focus', revalidateOnResume);
    document.addEventListener('visibilitychange', revalidateOnResume);
    return () => {
      window.removeEventListener('focus', revalidateOnResume);
      document.removeEventListener('visibilitychange', revalidateOnResume);
    };
  }, [orderId, order?.origin, verifyRemoteState]);

  const checkoutEnabled = useMemo(() => (
    order?.ecommerceDraftStatus === 'prepared'
    && order?.ecommerceInventoryStatus === 'ready'
    && order?.ecommerceRemoteContractVersion >= ECOMMERCE_POS_CONVERSION_CONTRACT_VERSION
    && order?.ecommerceRemoteClaimOwned === true
    && order?.ecommerceRemoteClaimValid === true
    && order?.ecommerceRemoteConversionStatus === 'idle'
    && !order?.ecommerceRemoteConvertedSaleId
    && !order?.ecommerceConvertedSaleId
    && !isConfirmationPending
    && !isBusy
    && !isCheckingRemote
  ), [isBusy, isCheckingRemote, isConfirmationPending, order]);

  const draftExitState = useMemo(() => getDraftExitState({
    order,
    isBusy,
    isCheckingRemote,
    isConfirmationPending
  }), [isBusy, isCheckingRemote, isConfirmationPending, order]);
  const blockedMessage = getBlockedMessage(order, isCheckingRemote);

  const handleRetryConfirmation = async () => {
    if (isRetrying || !orderId) return;
    setIsRetrying(true);
    try {
      await retryEcommerceConversionConfirmation({ orderId });
    } finally {
      setIsRetrying(false);
    }
  };

  const handleReleaseDraft = async () => {
    if (!draftExitState.canRelease || draftAction || !orderId) return;
    const confirmed = await showConfirmModal(
      'El pedido seguirá aceptado en la bandeja y podrá prepararse nuevamente. No se registrará ninguna venta.',
      {
        title: 'Liberar pedido del Punto de Venta',
        type: 'warning',
        confirmButtonText: 'Liberar del POS',
        cancelButtonText: 'Volver'
      }
    );
    if (!confirmed) return;

    const liveOrder = useActiveOrders.getState().activeOrders.get(orderId);
    if (!liveOrder || liveOrder.origin !== 'ecommerce') return;
    if (hasLiveCheckoutOwnership(liveOrder, orderId)) {
      showMessageModal('Cierra el cobro activo antes de liberar este pedido.', null, { type: 'warning' });
      return;
    }

    setDraftAction('release');
    try {
      const result = await useActiveOrders.getState().releaseEcommerceDraft(orderId, 'released_from_pos_panel');
      if (result?.success === false) {
        const refreshed = await verifyRemoteState();
        if (
          refreshed?.success === true
          && (
            ['none', 'released'].includes(refreshed.draftStatus)
            || refreshed.claimOwned === false
            || refreshed.claimValid === false
          )
        ) {
          showMessageModal(
            'El pedido ya fue liberado desde otro dispositivo. Retira la copia local para continuar.',
            null,
            { type: 'warning' }
          );
          return;
        }
        showMessageModal(result.message || 'No se pudo liberar el pedido. Intenta nuevamente.', null, { type: 'error' });
        return;
      }

      onDraftRemoved?.();
      showMessageModal('Pedido liberado del Punto de Venta. Continúa aceptado en la bandeja.', null, { type: 'success' });
    } finally {
      setDraftAction(null);
    }
  };

  const handleRemoveLocalDraft = async () => {
    if (!draftExitState.canRemoveLocal || draftAction || !orderId) return;
    const confirmed = await showConfirmModal(
      'La reserva ya fue liberada en otro dispositivo. Esta acción solo retirará la copia local y no cambiará el pedido online.',
      {
        title: 'Retirar copia local',
        type: 'warning',
        confirmButtonText: 'Retirar de este dispositivo',
        cancelButtonText: 'Volver'
      }
    );
    if (!confirmed) return;

    setDraftAction('remove');
    try {
      const result = useActiveOrders.getState().removeEcommerceDraftLocal(orderId);
      if (result?.success === false) {
        showMessageModal('No se pudo retirar la copia local del pedido.', null, { type: 'error' });
        return;
      }

      onDraftRemoved?.();
      showMessageModal(
        'Copia local retirada. El pedido sigue disponible en la bandeja para prepararlo nuevamente.',
        null,
        { type: 'success' }
      );
    } finally {
      setDraftAction(null);
    }
  };

  if (!order || order.origin !== 'ecommerce') return null;

  return (
    <section className="ecommerce-conversion-panel" aria-label="Conversión del pedido online">
      <details className="ecommerce-conversion-panel__details">
        <summary>
          <span>Estado del cobro</span>
          <strong>
            {draftExitState.claimLost
              ? 'Liberado en otro dispositivo'
              : (checkoutEnabled ? 'Listo para cobrar' : 'Revisión necesaria')}
          </strong>
        </summary>
        <div className="ecommerce-conversion-panel__status-grid">
          <div>
            <span className="ecommerce-conversion-panel__label">Pedido</span>
            <strong>{draftExitState.claimLost ? 'Copia local' : 'Preparado'}</strong>
          </div>
          <div>
            <span className="ecommerce-conversion-panel__label">Inventario</span>
            <strong>{getInventoryCopy(order)}</strong>
          </div>
          <div>
            <span className="ecommerce-conversion-panel__label">Conversión</span>
            <strong>{isStarting ? 'Iniciando cobro…' : STATUS_COPY[conversionStatus] || 'Revisión necesaria'}</strong>
          </div>
          <div>
            <span className="ecommerce-conversion-panel__label">Operación</span>
            <strong>{getOperationalStatusCopy(order)}</strong>
          </div>
        </div>
      </details>

      {blockedMessage && !isConfirmationPending && !draftExitState.claimLost && (
        <p className="ecommerce-conversion-panel__message" role="status">
          <ShieldAlert size={17} aria-hidden="true" />
          <span>{blockedMessage}</span>
        </p>
      )}

      {draftExitState.claimLost ? (
        <div className="ecommerce-conversion-panel__stale" role="alert">
          <p>
            <ShieldAlert size={18} aria-hidden="true" />
            <span>
              Este pedido fue liberado desde otro dispositivo. La copia que ves ya no puede cobrarse ni liberar la reserva remota.
            </span>
          </p>
          <div className="ecommerce-conversion-panel__actions">
            <button
              type="button"
              className="ecommerce-conversion-panel__button ecommerce-conversion-panel__button--danger"
              onClick={handleRemoveLocalDraft}
              disabled={!draftExitState.canRemoveLocal || Boolean(draftAction)}
            >
              {draftAction === 'remove'
                ? <LoaderCircle className="ecommerce-conversion-panel__spinner" size={18} aria-hidden="true" />
                : <XCircle size={18} aria-hidden="true" />}
              <span>{draftAction === 'remove' ? 'Retirando…' : 'Retirar de este dispositivo'}</span>
            </button>
            <button
              type="button"
              className="ecommerce-conversion-panel__button"
              onClick={() => navigate(`/pedidos-online?order=${order.ecommerceOrderId}`)}
              disabled={Boolean(draftAction)}
            >
              <RefreshCw size={18} aria-hidden="true" />
              <span>Ver pedido en bandeja</span>
            </button>
          </div>
        </div>
      ) : isConfirmationPending ? (
        <div className="ecommerce-conversion-panel__pending" role="status">
          <p>
            <ReceiptText size={18} aria-hidden="true" />
            <span>La venta fue registrada, pero falta confirmar el pedido online.</span>
          </p>
          <div className="ecommerce-conversion-panel__actions">
            <button
              type="button"
              className="ecommerce-conversion-panel__button ecommerce-conversion-panel__button--primary"
              onClick={handleRetryConfirmation}
              disabled={isRetrying}
            >
              {isRetrying
                ? <LoaderCircle className="ecommerce-conversion-panel__spinner" size={18} aria-hidden="true" />
                : <RefreshCw size={18} aria-hidden="true" />}
              <span>{isRetrying ? 'Confirmando…' : 'Reintentar confirmación'}</span>
            </button>
            <button
              type="button"
              className="ecommerce-conversion-panel__button"
              onClick={() => navigate('/ventas', { state: { saleId: order.ecommerceConvertedSaleId } })}
            >
              <ReceiptText size={18} aria-hidden="true" />
              <span>Ver venta</span>
            </button>
          </div>
        </div>
      ) : conversionStatus === ECOMMERCE_CONVERSION_STATUS.COMPLETED ? (
        <div className="ecommerce-conversion-panel__success" role="status">
          <CheckCircle2 size={18} aria-hidden="true" />
          <span>
            Pedido convertido en venta correctamente.
            {order.ecommerceConvertedSaleFolio && (
              <> Venta vinculada: {order.ecommerceConvertedSaleFolio}.</>
            )}
          </span>
          {order.ecommerceConvertedSaleId && (
            <button
              type="button"
              className="ecommerce-conversion-panel__button"
              onClick={() => navigate('/ventas', { state: { saleId: order.ecommerceConvertedSaleId } })}
            >
              <ReceiptText size={18} aria-hidden="true" />
              <span>Ver venta</span>
            </button>
          )}
        </div>
      ) : (
        <div className="ecommerce-conversion-panel__actions ecommerce-conversion-panel__actions--checkout">
          <button
            type="button"
            className="ecommerce-conversion-panel__checkout"
            onClick={onCheckout}
            disabled={!checkoutEnabled}
          >
            {isBusy || isCheckingRemote
              ? <LoaderCircle className="ecommerce-conversion-panel__spinner" size={20} aria-hidden="true" />
              : <CreditCard size={20} aria-hidden="true" />}
            <span>
              {isStarting
                ? 'Iniciando cobro…'
                : (isBusy || isCheckingRemote ? STATUS_COPY[conversionStatus] || 'Comprobando…' : 'Cobrar pedido')}
            </span>
          </button>
          {draftExitState.canRelease && (
            <button
              type="button"
              className="ecommerce-conversion-panel__button ecommerce-conversion-panel__button--danger"
              onClick={handleReleaseDraft}
              disabled={Boolean(draftAction)}
            >
              {draftAction === 'release'
                ? <LoaderCircle className="ecommerce-conversion-panel__spinner" size={18} aria-hidden="true" />
                : <XCircle size={18} aria-hidden="true" />}
              <span>{draftAction === 'release' ? 'Liberando…' : 'Liberar del Punto de Venta'}</span>
            </button>
          )}
        </div>
      )}
    </section>
  );
}

EcommercePosConversionPanel.propTypes = {
  order: PropTypes.object,
  onCheckout: PropTypes.func.isRequired,
  onDraftRemoved: PropTypes.func
};

export const ecommercePosConversionPanelInternals = Object.freeze({
  BUSY_STATUSES,
  CONFIRMATION_STATUSES,
  STATUS_COPY,
  getInventoryCopy,
  getBlockedMessage,
  getDraftExitState,
  hasLostRemoteClaim
});
