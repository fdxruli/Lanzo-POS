import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, PackageCheck, RefreshCw, ShoppingBag, Store, X } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import {
  canAccessEcommerceOrders,
  canPrepareEcommerceOrderInPos
} from '../services/ecommerce/ecommerceOrderCapabilities';
import { releaseEcommerceOrderPosDraft } from '../services/ecommerce/ecommerceOrderService';
import {
  getEcommercePosDraftId,
  prepareEcommerceOrderPosDraft
} from '../services/ecommerce/ecommercePosDraftService';
import { useActiveOrders } from '../hooks/pos/useActiveOrders';
import { showConfirmModal, showMessageModal } from '../services/utils';
import EcommerceFulfillmentPanel from '../components/ecommerce/orders/EcommerceFulfillmentPanel';
import EcommerceOrderStatusBadge from '../components/ecommerce/orders/EcommerceOrderStatusBadge';
import './EcommerceOrdersPage.css';

const FILTERS = Object.freeze([
  { key: 'all', label: 'Todos' },
  { key: 'pending', label: 'Pendientes' },
  { key: 'new', label: 'Nuevos' },
  { key: 'seen', label: 'Vistos' },
  { key: 'accepted', label: 'Aceptados' },
  { key: 'rejected', label: 'Rechazados' }
]);

const KNOWN_POS_DRAFT_STATES = new Set(['none', 'released', 'claimed', 'prepared']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const formatMoney = (value, currency = 'MXN') => {
  try {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: currency || 'MXN'
    }).format(Number(value || 0));
  } catch {
    return `$${Number(value || 0).toFixed(2)} ${currency || 'MXN'}`;
  }
};

const formatDate = (value) => {
  if (!value) return 'Sin fecha';
  try {
    return new Intl.DateTimeFormat('es-MX', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  } catch {
    return String(value);
  }
};

const fulfillmentLabel = (method) => (
  method === 'delivery' ? 'Entrega a domicilio' : 'Recoger en el negocio'
);

function SummaryCard({ label, value, tone = 'neutral' }) {
  return (
    <article className={`ecommerce-orders-summary__card ecommerce-orders-summary__card--${tone}`}>
      <span>{label}</span>
      <strong>{Number(value || 0)}</strong>
    </article>
  );
}

function OrderList({ orders, loading, error, onOpen }) {
  if (loading) {
    return <div className="ecommerce-orders-state" role="status">Cargando pedidos online…</div>;
  }
  if (error && orders.length === 0) {
    return <div className="ecommerce-orders-state ecommerce-orders-state--error">{error}</div>;
  }
  if (orders.length === 0) {
    return (
      <div className="ecommerce-orders-state">
        <ShoppingBag size={34} aria-hidden="true" />
        <strong>No hay pedidos en este filtro</strong>
        <span>Los pedidos nuevos aparecerán aquí.</span>
      </div>
    );
  }

  return (
    <div className="ecommerce-orders-list" role="list" aria-busy={loading}>
      {orders.map((order) => (
        <button
          key={order.id}
          type="button"
          className={`ecommerce-order-card ${order.status === 'new' ? 'is-new' : ''}`}
          onClick={() => onOpen(order.id)}
          role="listitem"
        >
          <div className="ecommerce-order-card__topline">
            <strong>{order.code || 'Pedido online'}</strong>
            <EcommerceOrderStatusBadge status={order.status} />
          </div>
          <div className="ecommerce-order-card__meta">
            <span>{formatDate(order.createdAt)}</span>
            <span>{fulfillmentLabel(order.fulfillmentMethod)}</span>
          </div>
          <div className="ecommerce-order-card__body">
            <span className="ecommerce-order-card__customer">{order.customerName || 'Cliente'}</span>
            <span>{Number(order.itemCount || 0)} {Number(order.itemCount || 0) === 1 ? 'artículo' : 'artículos'}</span>
            <strong>{formatMoney(order.total, order.currency)}</strong>
          </div>
          {order.status === 'new' && <span className="ecommerce-order-card__new-indicator">Nuevo</span>}
        </button>
      ))}
    </div>
  );
}

function DetailSection({ title, children }) {
  return (
    <section className="ecommerce-order-detail__section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function OrderDetail({
  order,
  loading,
  error,
  onClose,
  onAccept,
  onReject,
  onPrepare,
  onRelease,
  canPrepareInPos,
  isAdmin,
  actionLoading,
  posActionLoading
}) {
  if (!order && !loading && !error) return null;

  const posDraftStatus = order?.posDraft?.status || 'none';
  const hasOwnedClaim = Boolean(
    order?.posDraft?.isClaimedByCurrentActor === true
    && order?.posDraft?.claimToken
  );
  const isClaimedByCurrentActor = posDraftStatus === 'claimed' && hasOwnedClaim;
  const isClaimedByAnotherActor = posDraftStatus === 'claimed' && !hasOwnedClaim;
  const isPreparedByCurrentActor = Boolean(
    posDraftStatus === 'prepared'
    && hasOwnedClaim
    && order?.posDraft?.draftId
  );
  const isPreparedByAnotherActor = posDraftStatus === 'prepared' && !isPreparedByCurrentActor;
  const hasUnknownPosDraftState = Boolean(
    order?.status === 'accepted'
    && !KNOWN_POS_DRAFT_STATES.has(posDraftStatus)
  );

  return (
    <div
      className="ecommerce-order-detail-shell"
      role="dialog"
      aria-modal="true"
      aria-label="Detalle del pedido online"
      aria-busy={loading}
    >
      <button type="button" className="ecommerce-order-detail-backdrop" onClick={onClose} aria-label="Cerrar detalle" />
      <aside className="ecommerce-order-detail">
        <header className="ecommerce-order-detail__header">
          <div>
            <small>Pedido online</small>
            <h2>{order?.code || 'Cargando…'}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar detalle"><X size={20} /></button>
        </header>

        {loading && <div className="ecommerce-orders-state" role="status">Cargando detalle…</div>}
        {error && <div className="ecommerce-orders-state ecommerce-orders-state--error">{error}</div>}

        {order && !loading && (
          <>
            <div className="ecommerce-order-detail__status-row">
              <EcommerceOrderStatusBadge status={order.status} />
              <span>{formatDate(order.timestamps?.createdAt)}</span>
            </div>

            <DetailSection title="Modalidad">
              <p>{fulfillmentLabel(order.fulfillmentMethod)}</p>
            </DetailSection>

            <DetailSection title="Cliente">
              <dl className="ecommerce-order-detail__definition-list">
                <div><dt>Nombre</dt><dd>{order.customer?.name || 'Sin nombre'}</dd></div>
                <div><dt>Teléfono</dt><dd>{order.customer?.phone || 'Sin teléfono'}</dd></div>
                {order.customer?.address && <div><dt>Dirección</dt><dd>{order.customer.address}</dd></div>}
                {order.customer?.notes && <div><dt>Notas</dt><dd>{order.customer.notes}</dd></div>}
              </dl>
            </DetailSection>

            <DetailSection title="Artículos">
              <div className="ecommerce-order-detail__items">
                {order.items.map((item) => (
                  <article key={item.id || `${item.productName}-${item.quantity}`}>
                    <div>
                      <strong>{item.productName}</strong>
                      <span>{item.quantity} × {formatMoney(item.unitPrice, order.totals?.currency)}</span>
                    </div>
                    <strong>{formatMoney(item.lineTotal, order.totals?.currency)}</strong>
                  </article>
                ))}
              </div>
            </DetailSection>

            <DetailSection title="Totales">
              <dl className="ecommerce-order-detail__totals">
                <div><dt>Subtotal</dt><dd>{formatMoney(order.totals?.subtotal, order.totals?.currency)}</dd></div>
                {Number(order.totals?.deliveryFee || 0) !== 0 && <div><dt>Envío</dt><dd>{formatMoney(order.totals.deliveryFee, order.totals.currency)}</dd></div>}
                {Number(order.totals?.discountTotal || 0) !== 0 && <div><dt>Descuento</dt><dd>-{formatMoney(order.totals.discountTotal, order.totals.currency)}</dd></div>}
                {Number(order.totals?.taxTotal || 0) !== 0 && <div><dt>Impuestos</dt><dd>{formatMoney(order.totals.taxTotal, order.totals.currency)}</dd></div>}
                <div className="is-total"><dt>Total</dt><dd>{formatMoney(order.totals?.total, order.totals?.currency)}</dd></div>
                <div><dt>Pago</dt><dd>{order.payment?.status === 'paid' ? 'Pagado' : 'Pendiente al entregar'}</dd></div>
              </dl>
            </DetailSection>

            <EcommerceFulfillmentPanel />

            <DetailSection title="Historial">
              <ol className="ecommerce-order-detail__timeline">
                {order.events.map((event, index) => (
                  <li key={`${event.eventType}-${event.createdAt}-${index}`}>
                    <span>{formatDate(event.createdAt)}</span>
                    <strong>{event.message || event.eventType}</strong>
                    <small>{event.actorLabel}</small>
                    {event.eventType === 'order_rejected' && event.payload?.reason && <p>{event.payload.reason}</p>}
                  </li>
                ))}
              </ol>
            </DetailSection>

            <footer className="ecommerce-order-detail__actions">
              {order.contact?.whatsappUrl && (
                <a
                  href={order.contact.whatsappUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ui-button ui-button--secondary"
                >
                  Abrir WhatsApp <ExternalLink size={16} />
                </a>
              )}
              {['new', 'seen'].includes(order.status) && (
                <>
                  <button
                    type="button"
                    className="ui-button ui-button--primary"
                    onClick={onAccept}
                    disabled={Boolean(actionLoading) || loading}
                  >
                    <PackageCheck size={17} />
                    {actionLoading === 'accept' ? 'Aceptando…' : 'Aceptar pedido'}
                  </button>
                  <button
                    type="button"
                    className="ui-button ui-button--danger"
                    onClick={onReject}
                    disabled={Boolean(actionLoading) || loading}
                  >
                    Rechazar pedido
                  </button>
                </>
              )}

              {order.status === 'accepted' && canPrepareInPos && ['none', 'released'].includes(posDraftStatus) && (
                <button
                  type="button"
                  className="ui-button ui-button--primary"
                  onClick={onPrepare}
                  disabled={Boolean(actionLoading) || Boolean(posActionLoading) || loading}
                >
                  <Store size={17} />
                  {posActionLoading === 'prepare' ? 'Preparando…' : 'Preparar en Punto de Venta'}
                </button>
              )}

              {order.status === 'accepted' && canPrepareInPos && isClaimedByCurrentActor && (
                <button
                  type="button"
                  className="ui-button ui-button--primary"
                  onClick={onPrepare}
                  disabled={Boolean(posActionLoading) || loading}
                >
                  <Store size={17} />
                  {posActionLoading === 'prepare' ? 'Preparando…' : 'Continuar preparación'}
                </button>
              )}

              {order.status === 'accepted' && canPrepareInPos && isClaimedByAnotherActor && (
                <button type="button" className="ui-button ui-button--secondary" disabled>
                  En preparación en otro dispositivo
                </button>
              )}

              {order.status === 'accepted' && canPrepareInPos && isPreparedByCurrentActor && (
                <>
                  <button
                    type="button"
                    className="ui-button ui-button--primary"
                    onClick={onPrepare}
                    disabled={Boolean(posActionLoading) || loading}
                  >
                    <Store size={17} />
                    {posActionLoading === 'prepare' ? 'Abriendo…' : 'Abrir en Punto de Venta'}
                  </button>
                  <button
                    type="button"
                    className="ui-button ui-button--danger"
                    onClick={() => onRelease({ administrative: false })}
                    disabled={Boolean(posActionLoading) || loading}
                  >
                    {posActionLoading === 'release' ? 'Liberando…' : 'Liberar borrador'}
                  </button>
                </>
              )}

              {order.status === 'accepted' && canPrepareInPos && isPreparedByAnotherActor && (
                <>
                  <button type="button" className="ui-button ui-button--secondary" disabled>
                    Preparado en otro dispositivo
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      className="ui-button ui-button--danger"
                      onClick={() => onRelease({ administrative: true })}
                      disabled={Boolean(posActionLoading) || loading}
                    >
                      {posActionLoading === 'release' ? 'Liberando…' : 'Liberar administrativamente'}
                    </button>
                  )}
                </>
              )}

              {hasUnknownPosDraftState && (
                <button type="button" className="ui-button ui-button--secondary" disabled>
                  Estado en conflicto. Actualiza el pedido.
                </button>
              )}
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}

function ActionDialog({ mode, orderCode, busy, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');
  const isReject = mode === 'reject';
  const normalizedReason = reason.trim();
  const reasonInvalid = isReject && (normalizedReason.length < 3 || normalizedReason.length > 300);

  return (
    <div className="ecommerce-order-dialog-shell" role="dialog" aria-modal="true" aria-labelledby="ecommerce-order-dialog-title">
      <button type="button" className="ecommerce-order-detail-backdrop" onClick={onCancel} aria-label="Cancelar" />
      <section className="ecommerce-order-dialog">
        <h2 id="ecommerce-order-dialog-title">{isReject ? 'Rechazar pedido' : 'Aceptar pedido'}</h2>
        <p>
          {isReject
            ? `Indica por qué se rechazará ${orderCode}. El motivo quedará en el historial interno.`
            : `¿Confirmas que deseas aceptar ${orderCode}? Aún no se creará una venta ni se descontará inventario.`}
        </p>
        {isReject && (
          <label>
            Motivo
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={300}
              rows={4}
              autoFocus
            />
            <small>{normalizedReason.length}/300 · mínimo 3 caracteres</small>
          </label>
        )}
        <div className="ecommerce-order-dialog__actions">
          <button type="button" className="ui-button ui-button--secondary" onClick={onCancel} disabled={busy}>Cancelar</button>
          <button
            type="button"
            className={`ui-button ${isReject ? 'ui-button--danger' : 'ui-button--primary'}`}
            onClick={() => onConfirm(normalizedReason)}
            disabled={busy || reasonInvalid}
          >
            {busy ? 'Procesando…' : (isReject ? 'Confirmar rechazo' : 'Confirmar aceptación')}
          </button>
        </div>
      </section>
    </div>
  );
}

export default function EcommerceOrdersPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [dialogMode, setDialogMode] = useState(null);
  const [posAction, setPosAction] = useState(null);
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const currentStaffUser = useAppStore((state) => state.currentStaffUser);
  const orders = useAppStore((state) => state.ecommerceOrders);
  const counts = useAppStore((state) => state.ecommerceOrderCounts);
  const loading = useAppStore((state) => state.ecommerceOrdersLoading);
  const refreshing = useAppStore((state) => state.ecommerceOrdersRefreshing);
  const error = useAppStore((state) => state.ecommerceOrdersError);
  const filter = useAppStore((state) => state.ecommerceOrdersFilter);
  const selectedOrder = useAppStore((state) => state.selectedEcommerceOrder);
  const selectedLoading = useAppStore((state) => state.selectedEcommerceOrderLoading);
  const selectedError = useAppStore((state) => state.selectedEcommerceOrderError);
  const actionLoading = useAppStore((state) => state.ecommerceOrderActionLoading);
  const loadOrders = useAppStore((state) => state.loadEcommerceOrders);
  const openOrder = useAppStore((state) => state.openEcommerceOrder);
  const refreshOrders = useAppStore((state) => state.refreshEcommerceOrders);
  const setFilter = useAppStore((state) => state.setEcommerceOrdersFilter);
  const clearSelectedOrder = useAppStore((state) => state.clearSelectedEcommerceOrder);
  const acceptOrder = useAppStore((state) => state.acceptEcommerceOrder);
  const rejectOrder = useAppStore((state) => state.rejectEcommerceOrder);

  const staffSession = useMemo(() => ({ currentDeviceRole, currentStaffUser }), [currentDeviceRole, currentStaffUser]);
  const canAccess = canAccessEcommerceOrders(licenseDetails, staffSession);
  const canPrepareInPos = canPrepareEcommerceOrderInPos(licenseDetails, staffSession);
  const isAdmin = currentDeviceRole === 'admin';

  useEffect(() => {
    if (!canAccess) return;
    loadOrders?.({ filter, force: false });
  }, [canAccess, filter, loadOrders]);

  useEffect(() => {
    if (!canAccess) return;
    const orderId = searchParams.get('order');
    if (!orderId) return;

    const next = new URLSearchParams(searchParams);
    next.delete('order');
    setSearchParams(next, { replace: true });

    if (!UUID_PATTERN.test(orderId)) return;

    setDialogMode(null);
    openOrder?.(orderId, { force: true, markSeen: true });
  }, [canAccess, openOrder, searchParams, setSearchParams]);

  useEffect(() => {
    if (selectedLoading) setDialogMode(null);
  }, [selectedLoading]);

  const handleOpenOrder = (orderId) => {
    setDialogMode(null);
    openOrder?.(orderId, { markSeen: true });
  };

  const handleCloseDetail = () => {
    setDialogMode(null);
    clearSelectedOrder?.();
  };

  const handleFilter = async (nextFilter) => {
    if (nextFilter === filter) return;

    setDialogMode(null);
    clearSelectedOrder?.();

    if (searchParams.has('order')) {
      const next = new URLSearchParams(searchParams);
      next.delete('order');
      setSearchParams(next, { replace: true });
    }

    setFilter?.(nextFilter);
    await loadOrders?.({ filter: nextFilter, force: true });
  };

  const handleConfirmAction = async (reason) => {
    const visibleOrderId = selectedOrder?.id;
    if (!visibleOrderId || selectedLoading || actionLoading) return;

    const result = dialogMode === 'reject'
      ? await rejectOrder?.(visibleOrderId, reason)
      : await acceptOrder?.(visibleOrderId);
    if (result?.success !== false) setDialogMode(null);
  };

  const handlePrepareInPos = async () => {
    const visibleOrder = selectedOrder;
    if (!visibleOrder?.id || selectedLoading || actionLoading || posAction) return;
    const visibleOrderId = visibleOrder.id;
    setPosAction({ type: 'prepare', orderId: visibleOrderId });

    try {
      const result = await prepareEcommerceOrderPosDraft({ order: visibleOrder });
      if (useAppStore.getState().selectedEcommerceOrder?.id !== visibleOrderId) return;
      if (result?.success === false) {
        const missing = (result.missingProducts || []).map((item) => item.productName).join(', ');
        showMessageModal(
          missing ? `No se creó el borrador. Productos faltantes: ${missing}.` : (result.message || 'No se pudo preparar el pedido en Punto de Venta.'),
          null,
          { type: 'warning' }
        );
        await openOrder?.(visibleOrderId, { force: true, markSeen: false });
        return;
      }

      navigate('/');
      showMessageModal(`Pedido ${visibleOrder.code || 'online'} preparado en Punto de Venta.`, null, { type: 'success' });
    } finally {
      setPosAction((current) => current?.orderId === visibleOrderId ? null : current);
    }
  };

  const handleReleaseDraft = async ({ administrative = false } = {}) => {
    const visibleOrder = selectedOrder;
    if (!visibleOrder?.id || selectedLoading || actionLoading || posAction) return;

    const confirmationMessage = administrative
      ? 'Este borrador fue preparado en otro dispositivo. Al liberarlo, ese dispositivo perderá su reserva local y el pedido podrá prepararse nuevamente.'
      : 'El pedido seguirá aceptado en la bandeja y podrá prepararse nuevamente. No se registrará ninguna venta.';
    const confirmed = await showConfirmModal(
      confirmationMessage,
      {
        title: administrative ? 'Liberar borrador de otro dispositivo' : 'Liberar borrador',
        type: 'warning',
        confirmButtonText: administrative ? 'Liberar administrativamente' : 'Liberar borrador',
        cancelButtonText: 'Volver'
      }
    );
    if (!confirmed || useAppStore.getState().selectedEcommerceOrder?.id !== visibleOrder.id) return;

    const visibleOrderId = visibleOrder.id;
    setPosAction({ type: 'release', orderId: visibleOrderId });
    try {
      const localDraftId = getEcommercePosDraftId(visibleOrderId);
      const localDraft = useActiveOrders.getState().activeOrders.get(localDraftId);
      const remoteToken = visibleOrder.posDraft?.claimToken || null;
      const ownsRemoteClaim = visibleOrder.posDraft?.isClaimedByCurrentActor === true && Boolean(remoteToken);
      const localMatchesRemote = Boolean(
        !administrative
        && ownsRemoteClaim
        && localDraft?.origin === 'ecommerce'
        && localDraft.ecommerceOrderId === visibleOrderId
        && localDraft.ecommerceClaimToken === remoteToken
        && localDraft.ecommerceDraftStatus === 'prepared'
      );

      const result = localMatchesRemote
        ? await useActiveOrders.getState().releaseEcommerceDraft(localDraftId, 'released_from_inbox')
        : await releaseEcommerceOrderPosDraft({
          licenseDetails,
          orderId: visibleOrderId,
          claimToken: administrative ? null : remoteToken,
          reason: administrative ? 'administrative_release_other_device' : 'released_from_inbox'
        });

      if (useAppStore.getState().selectedEcommerceOrder?.id !== visibleOrderId) return;
      if (result?.success === false) {
        showMessageModal(result.message || 'No se pudo liberar el borrador. Intenta nuevamente.', null, { type: 'error' });
        return;
      }

      if (localDraft?.origin === 'ecommerce') {
        useActiveOrders.getState().removeEcommerceDraftLocal(localDraftId);
      }
      await openOrder?.(visibleOrderId, { force: true, markSeen: false });
      await refreshOrders?.({ background: true });
      showMessageModal('Borrador liberado. El pedido continúa aceptado.', null, { type: 'success' });
    } finally {
      setPosAction((current) => current?.orderId === visibleOrderId ? null : current);
    }
  };

  return (
    <main className="ecommerce-orders-page">
      <header className="ecommerce-orders-page__header">
        <div>
          <span className="ecommerce-orders-page__eyebrow">Tienda online</span>
          <h1>Pedidos online</h1>
          <p>Revisa, acepta o rechaza pedidos. Aceptar todavía no crea una venta ni afecta inventario o caja.</p>
        </div>
        <button
          type="button"
          className="ui-button ui-button--secondary"
          onClick={() => refreshOrders?.()}
          disabled={loading || refreshing}
        >
          <RefreshCw size={17} className={refreshing ? 'is-spinning' : ''} />
          {refreshing ? 'Actualizando…' : 'Actualizar'}
        </button>
      </header>

      <section className="ecommerce-orders-summary" aria-label="Resumen de pedidos">
        <SummaryCard label="Nuevos" value={counts.new} tone="new" />
        <SummaryCard label="Vistos" value={counts.seen} tone="seen" />
        <SummaryCard label="Aceptados" value={counts.accepted} tone="accepted" />
        <SummaryCard label="Rechazados" value={counts.rejected} tone="rejected" />
        <SummaryCard label="Pendientes" value={counts.pending} tone="pending" />
      </section>

      <nav className="ecommerce-orders-filters" aria-label="Filtrar pedidos">
        {FILTERS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={filter === item.key ? 'is-active' : ''}
            onClick={() => handleFilter(item.key)}
          >
            {item.label}
            {item.key !== 'all' && Number(counts[item.key] || 0) > 0 && <span>{counts[item.key]}</span>}
          </button>
        ))}
      </nav>

      {error && orders.length > 0 && <div className="ecommerce-orders-inline-error" role="alert">{error}</div>}
      <OrderList orders={orders} loading={loading} error={error} onOpen={handleOpenOrder} />

      <OrderDetail
        order={selectedOrder}
        loading={selectedLoading}
        error={selectedError}
        actionLoading={actionLoading}
        posActionLoading={posAction && posAction.orderId === selectedOrder?.id ? posAction.type : null}
        canPrepareInPos={canPrepareInPos}
        isAdmin={isAdmin}
        onClose={handleCloseDetail}
        onAccept={() => {
          if (!selectedLoading && !actionLoading) setDialogMode('accept');
        }}
        onReject={() => {
          if (!selectedLoading && !actionLoading) setDialogMode('reject');
        }}
        onPrepare={handlePrepareInPos}
        onRelease={handleReleaseDraft}
      />

      {dialogMode && selectedOrder && !selectedLoading && (
        <ActionDialog
          mode={dialogMode}
          orderCode={selectedOrder.code}
          busy={Boolean(actionLoading)}
          onCancel={() => setDialogMode(null)}
          onConfirm={handleConfirmAction}
        />
      )}
    </main>
  );
}
