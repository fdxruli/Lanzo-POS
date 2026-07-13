import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { CheckCircle2, CreditCard, LoaderCircle, RefreshCw, ReceiptText, ShieldAlert } from 'lucide-react';
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
import { useAppStore } from '../../store/useAppStore';

const BUSY_STATUSES = new Set([
  ECOMMERCE_CONVERSION_STATUS.PAYMENT_PENDING,
  ECOMMERCE_CONVERSION_STATUS.PROCESSING_SALE
]);

const CONFIRMATION_STATUSES = new Set([
  ECOMMERCE_CONVERSION_STATUS.SALE_CREATED,
  ECOMMERCE_CONVERSION_STATUS.CONFIRMATION_PENDING
]);

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

const getBlockedMessage = (order = {}, isCheckingRemote = false) => {
  if (isCheckingRemote) return 'Comprobando contrato remoto y propiedad del pedido…';
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

export default function EcommercePosConversionPanel({ order, onCheckout }) {
  const navigate = useNavigate();
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const [isCheckingRemote, setIsCheckingRemote] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
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

  if (!order || order.origin !== 'ecommerce') return null;

  return (
    <section className="ecommerce-conversion-panel" aria-label="Conversión del pedido online">
      <div className="ecommerce-conversion-panel__status-grid">
        <div>
          <span className="ecommerce-conversion-panel__label">Estado del pedido</span>
          <strong>Preparado</strong>
        </div>
        <div>
          <span className="ecommerce-conversion-panel__label">Estado del inventario</span>
          <strong>{getInventoryCopy(order)}</strong>
        </div>
        <div>
          <span className="ecommerce-conversion-panel__label">Estado de conversión</span>
          <strong>{isStarting ? 'Iniciando cobro…' : STATUS_COPY[conversionStatus] || 'Revisión necesaria'}</strong>
        </div>
        <div>
          <span className="ecommerce-conversion-panel__label">Estado operativo</span>
          <strong>{getOperationalStatusCopy(order)}</strong>
        </div>
      </div>

      {blockedMessage && !isConfirmationPending && (
        <p className="ecommerce-conversion-panel__message" role="status">
          <ShieldAlert size={17} aria-hidden="true" />
          <span>{blockedMessage}</span>
        </p>
      )}

      {isConfirmationPending ? (
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
        <p className="ecommerce-conversion-panel__success" role="status">
          <CheckCircle2 size={18} aria-hidden="true" />
          <span>Pedido convertido en venta correctamente.</span>
        </p>
      ) : (
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
      )}
    </section>
  );
}

EcommercePosConversionPanel.propTypes = {
  order: PropTypes.object,
  onCheckout: PropTypes.func.isRequired
};

export const ecommercePosConversionPanelInternals = Object.freeze({
  BUSY_STATUSES,
  CONFIRMATION_STATUSES,
  STATUS_COPY,
  getInventoryCopy,
  getBlockedMessage
});
