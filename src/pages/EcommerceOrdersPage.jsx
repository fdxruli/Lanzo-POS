import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  BellRing,
  CheckCircle2,
  ChevronDown,
  CircleUserRound,
  Clock3,
  ExternalLink,
  History,
  Package,
  PackageCheck,
  RefreshCw,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Store,
  X
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import {
  canAccessEcommerceOrders,
  canPrepareEcommerceOrderInPos
} from '../services/ecommerce/ecommerceOrderCapabilities';
import { releaseEcommerceOrderPosDraft } from '../services/ecommerce/ecommerceOrderService';
import { isEcommerceFulfillmentPaymentRequired } from '../services/ecommerce/ecommerceOrderFulfillmentService';
import {
  getEcommercePosDraftId,
  prepareEcommerceOrderPosDraft
} from '../services/ecommerce/ecommercePosDraftService';
import { useActiveOrders } from '../hooks/pos/useActiveOrders';
import { showConfirmModal, showMessageModal } from '../services/utils';
import EcommerceFulfillmentPanel from '../components/ecommerce/orders/EcommerceFulfillmentPanel';
import EcommerceOrderStatusBadge from '../components/ecommerce/orders/EcommerceOrderStatusBadge';
import { formatEcommerceDeliveryAddress } from '../utils/ecommerceDeliveryAddress';
import './EcommerceOrdersPage.css';

const FILTERS = Object.freeze([
  { key: 'all', label: 'Todos' },
  { key: 'pending', label: 'Pendientes' },
  { key: 'new', label: 'Nuevos' },
  { key: 'seen', label: 'Vistos' },
  { key: 'accepted', label: 'Aceptados' },
  { key: 'rejected', label: 'Rechazados' },
  { key: 'closed', label: 'Cerrados' }
]);

const ORDER_GROUPS = Object.freeze([
  {
    key: 'attention',
    title: 'Requieren atención',
    description: 'Nuevos por revisar',
    emptyTitle: 'Todo al día',
    emptyDescription: 'No tienes pedidos nuevos por revisar.',
    icon: BellRing,
    statuses: new Set(['new'])
  },
  {
    key: 'process',
    title: 'En proceso',
    description: 'Vistos y aceptados',
    emptyTitle: 'Sin pedidos en proceso',
    emptyDescription: 'Los pedidos vistos o aceptados aparecerán aquí.',
    icon: Clock3,
    statuses: new Set(['seen', 'accepted', 'preparing', 'ready', 'converted_to_sale'])
  },
  {
    key: 'closed',
    title: 'Cerrados',
    description: 'Rechazados y finalizados',
    emptyTitle: 'Sin pedidos cerrados',
    emptyDescription: 'Los pedidos resueltos aparecerán aquí.',
    icon: Archive,
    statuses: new Set(['rejected', 'cancelled', 'completed'])
  }
]);

const KNOWN_POS_DRAFT_STATES = new Set(['none', 'released', 'claimed', 'prepared']);
const MOBILE_ORDER_BATCH_SIZE = 6;
const DEFAULT_ORDER_PAGE_SIZE = 50;
const MAX_ORDER_PAGE_SIZE = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('es-MX', {
  dateStyle: 'medium',
  timeStyle: 'short'
});

const normalizeOrderPagination = (pagination = {}) => {
  const rawLimit = Number(pagination.limit);
  const rawOffset = Number(pagination.offset);
  return {
    limit: Math.min(
      Math.max(Number.isFinite(rawLimit) ? rawLimit : DEFAULT_ORDER_PAGE_SIZE, 1),
      MAX_ORDER_PAGE_SIZE
    ),
    offset: Math.max(Number.isFinite(rawOffset) ? rawOffset : 0, 0),
    hasMore: Boolean(pagination.hasMore)
  };
};

const formatMoney = (value, currency = 'MXN') => {
  try {
    return Number(value || 0).toLocaleString('es-MX', {
      style: 'currency',
      currency: currency || 'MXN'
    });
  } catch {
    return `$${Number(value || 0).toFixed(2)} ${currency || 'MXN'}`;
  }
};

const formatDate = (value) => {
  if (!value) return 'Sin fecha';
  try {
    return DATE_TIME_FORMATTER.format(new Date(value));
  } catch {
    return String(value);
  }
};

const fulfillmentLabel = (method) => (
  method === 'delivery' ? 'Entrega a domicilio' : 'Recoger en el negocio'
);

const getFulfillmentStatus = (order = {}) => (
  order.fulfillmentStatus || order.fulfillment?.internalStatus || order.fulfillment?.status || ''
);

const isClosedOrder = (order = {}) => (
  order.status === 'rejected'
  || ['completed', 'cancelled'].includes(getFulfillmentStatus(order))
  || ['completed', 'cancelled'].includes(order.status)
);

const getOrderGroup = (order = {}) => {
  if (isClosedOrder(order)) return ORDER_GROUPS[2];
  return ORDER_GROUPS.find((group) => group.statuses.has(order.status)) || ORDER_GROUPS[1];
};

const getNextMobileGroup = (orders, currentGroup, { preferFirstMatch = false } = {}) => {
  if (orders.length === 0) return currentGroup;

  const groupsWithOrders = new Set(orders.map((order) => getOrderGroup(order).key));
  if (preferFirstMatch) return getOrderGroup(orders[0]).key;
  if (groupsWithOrders.has(currentGroup)) return currentGroup;

  return ORDER_GROUPS.find((group) => groupsWithOrders.has(group.key))?.key || currentGroup;
};

function useMediaQuery(query) {
  const getMatches = () => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(query).matches
  );
  const [matches, setMatches] = useState(getMatches);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;

    const mediaQuery = window.matchMedia(query);
    const updateMatches = () => setMatches(mediaQuery.matches);
    updateMatches();
    mediaQuery.addEventListener?.('change', updateMatches);
    return () => mediaQuery.removeEventListener?.('change', updateMatches);
  }, [query]);

  return matches;
}

function OrderCard({ order, onOpen }) {
  const itemCount = Number(order.itemCount || 0);

  return (
    <li className="ecommerce-order-card-shell">
      <button
        type="button"
        className="ecommerce-order-card"
        onClick={() => onOpen(order.id)}
        aria-label={`Abrir ${order.code || 'pedido en línea'} de ${order.customerName || 'Cliente'}`}
      >
        <span className="ecommerce-order-card__topline">
          <strong>{order.code || 'Pedido en línea'}</strong>
          <EcommerceOrderStatusBadge status={order.status} />
        </span>
        <span className="ecommerce-order-card__date">{formatDate(order.createdAt)}</span>
        <span className="ecommerce-order-card__customer">{order.customerName || 'Cliente'}</span>
        <span className="ecommerce-order-card__meta">
          <span><Store size={15} aria-hidden="true" />{fulfillmentLabel(order.fulfillmentMethod)}</span>
          <span><Package size={15} aria-hidden="true" />{itemCount} {itemCount === 1 ? 'artículo' : 'artículos'}</span>
        </span>
        <strong className="ecommerce-order-card__total">{formatMoney(order.total, order.currency)}</strong>
      </button>
    </li>
  );
}

function OrderGroup({ group, orders, onOpen, mobileActive, mobileExpanded, onToggleMobileExpanded }) {
  const Icon = group.icon;
  const headingId = `ecommerce-orders-group-${group.key}`;
  const remainingOrders = Math.max(orders.length - MOBILE_ORDER_BATCH_SIZE, 0);

  return (
    <section
      id={`ecommerce-orders-panel-${group.key}`}
      className={[
        'ecommerce-orders-group',
        `ecommerce-orders-group--${group.key}`,
        mobileActive ? 'is-mobile-active' : '',
        mobileExpanded ? 'is-mobile-expanded' : ''
      ].filter(Boolean).join(' ')}
      aria-labelledby={headingId}
    >
      <header className="ecommerce-orders-group__header">
        <span className="ecommerce-orders-group__icon" aria-hidden="true"><Icon size={20} /></span>
        <span>
          <span className="ecommerce-orders-group__title-row">
            <h2 id={headingId}>{group.title}</h2>
            <span className="ecommerce-orders-group__count">{orders.length}</span>
          </span>
          <small>{group.description}</small>
        </span>
      </header>

      {orders.length > 0 ? (
        <>
          <ul className="ecommerce-orders-group__list">
            {orders.map((order) => (
              <OrderCard key={order.id} order={order} onOpen={onOpen} />
            ))}
          </ul>
          {remainingOrders > 0 && (
            <button
              type="button"
              className="ecommerce-orders-group__more ui-button ui-button--secondary"
              onClick={() => onToggleMobileExpanded(group.key)}
              aria-expanded={mobileExpanded}
              aria-controls={`ecommerce-orders-panel-${group.key}`}
            >
              {mobileExpanded
                ? 'Mostrar menos'
                : `Mostrar ${Math.min(MOBILE_ORDER_BATCH_SIZE, remainingOrders)} más · ${remainingOrders} restantes`}
            </button>
          )}
        </>
      ) : (
        <div className="ecommerce-orders-group__empty">
          <CheckCircle2 size={28} aria-hidden="true" />
          <strong>{group.emptyTitle}</strong>
          <span>{group.emptyDescription}</span>
        </div>
      )}
    </section>
  );
}

function OrderBoard({
  orders,
  loading,
  error,
  onOpen,
  mobileGroup,
  expandedMobileGroups,
  onToggleMobileExpanded
}) {
  if (loading) {
    return <div className="ecommerce-orders-state" role="status">Cargando pedidos en línea…</div>;
  }
  if (error && orders.length === 0) {
    return <div className="ecommerce-orders-state ecommerce-orders-state--error">{error}</div>;
  }
  if (orders.length === 0) {
    return (
      <div className="ecommerce-orders-state">
        <CheckCircle2 size={34} aria-hidden="true" />
        <strong>No hay pedidos en este filtro</strong>
        <span>Los pedidos nuevos aparecerán aquí.</span>
      </div>
    );
  }

  const groupedOrders = ORDER_GROUPS.map((group) => ({
    ...group,
    orders: orders.filter((order) => getOrderGroup(order).key === group.key)
  }));

  return (
    <div className="ecommerce-orders-board" aria-busy={loading}>
      {groupedOrders.map((group) => (
        <OrderGroup
          key={group.key}
          group={group}
          orders={group.orders}
          onOpen={onOpen}
          mobileActive={mobileGroup === group.key}
          mobileExpanded={expandedMobileGroups.has(group.key)}
          onToggleMobileExpanded={onToggleMobileExpanded}
        />
      ))}
    </div>
  );
}

function OrdersControls({
  searchQuery,
  onSearchChange,
  filter,
  onFilter,
  loading,
  counts,
  totalCount,
  mobileGroups,
  mobileGroup,
  onMobileGroup
}) {
  return (
    <div className="ecommerce-orders-mobile-controls">
      <section className="ecommerce-orders-toolbar" aria-label="Buscar y filtrar pedidos">
        <label className="ecommerce-orders-search">
          <Search size={19} aria-hidden="true" />
          <span className="ecommerce-orders-sr-only">Buscar pedidos</span>
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Buscar pedido o cliente"
          />
        </label>

        <label className="ecommerce-orders-filter">
          <SlidersHorizontal size={18} aria-hidden="true" />
          <span className="ecommerce-orders-filter__label">Estado</span>
          <select
            value={filter}
            onChange={(event) => onFilter(event.target.value)}
            disabled={loading}
          >
            {FILTERS.map((item) => {
              const count = item.key === 'all' ? totalCount : Number(counts[item.key] || 0);
              return (
                <option key={item.key} value={item.key}>
                  {item.label}{count > 0 ? ` (${count})` : ''}
                </option>
              );
            })}
          </select>
        </label>
      </section>

      <small className="ecommerce-orders-search-scope">
        La búsqueda aplica a la página actual.
      </small>

      <nav className="ecommerce-orders-mobile-nav" aria-label="Grupos de pedidos">
        <div role="tablist" aria-label="Cambiar grupo de pedidos">
          {mobileGroups.map((group) => {
            const label = group.key === 'attention' ? 'Atención' : group.title;
            return (
              <button
                key={group.key}
                type="button"
                role="tab"
                aria-selected={mobileGroup === group.key}
                aria-controls={`ecommerce-orders-panel-${group.key}`}
                aria-label={`${label}, ${group.count} ${group.count === 1 ? 'pedido' : 'pedidos'}`}
                className={mobileGroup === group.key ? 'is-active' : ''}
                onClick={() => onMobileGroup(group.key)}
              >
                <span>{label}</span>
                <strong>{group.count}</strong>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

function OrdersPagination({ pagination, loading, refreshing, onPageChange }) {
  const { limit, offset, hasMore } = normalizeOrderPagination(pagination);
  const pageNumber = Math.floor(offset / limit) + 1;
  const busy = Boolean(loading || refreshing);

  return (
    <nav className="ecommerce-orders-pagination" aria-label="Paginación de pedidos">
      <button
        type="button"
        className="ui-button ui-button--secondary"
        onClick={() => onPageChange?.('previous')}
        disabled={busy || offset === 0}
      >
        Anterior
      </button>
      <span className="ecommerce-orders-pagination__page" aria-current="page">
        Página {pageNumber}
      </span>
      <button
        type="button"
        className="ui-button ui-button--secondary"
        onClick={() => onPageChange?.('next')}
        disabled={busy || !hasMore}
      >
        Siguiente
      </button>
    </nav>
  );
}

function OrdersInbox({
  loading,
  refreshing,
  error,
  orders,
  visibleOrders,
  refreshOrders,
  searchQuery,
  setSearchQuery,
  filter,
  handleFilter,
  counts,
  totalCount,
  mobileGroups,
  mobileGroup,
  handleMobileGroup,
  expandedMobileGroups,
  handleToggleMobileExpanded,
  handleOpenOrder,
  pagination,
  handlePageChange
}) {
  return (
    <>
      <header className="ecommerce-orders-page__header">
        <div>
          <h1>Pedidos en línea</h1>
          <p>Revisa y gestiona cada pedido según su estado para mantener tu operación al día.</p>
        </div>
        <button
          type="button"
          className="ui-button ui-button--ghost"
          onClick={() => refreshOrders?.()}
          disabled={loading || refreshing}
        >
          <RefreshCw size={17} className={refreshing ? 'is-spinning' : ''} />
          <span>{refreshing ? 'Actualizando…' : 'Actualizar'}</span>
        </button>
      </header>

      <OrdersControls
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        filter={filter}
        onFilter={handleFilter}
        loading={loading}
        counts={counts}
        totalCount={totalCount}
        mobileGroups={mobileGroups}
        mobileGroup={mobileGroup}
        onMobileGroup={handleMobileGroup}
      />

      <OrdersPagination
        pagination={pagination}
        loading={loading}
        refreshing={refreshing}
        onPageChange={handlePageChange}
      />

      {error && orders.length > 0 && <div className="ecommerce-orders-inline-error" role="alert">{error}</div>}
      {searchQuery.trim() && !loading && orders.length > 0 && visibleOrders.length === 0 ? (
        <div className="ecommerce-orders-state">
          <Search size={32} aria-hidden="true" />
          <strong>No encontramos pedidos</strong>
          <span>Prueba con otro número de pedido o nombre de cliente.</span>
        </div>
      ) : (
        <OrderBoard
          orders={visibleOrders}
          loading={loading}
          error={error}
          onOpen={handleOpenOrder}
          mobileGroup={mobileGroup}
          expandedMobileGroups={expandedMobileGroups}
          onToggleMobileExpanded={handleToggleMobileExpanded}
        />
      )}
    </>
  );
}

function DetailSection({ title, summary, variant = 'default', icon: Icon, children }) {
  const [open, setOpen] = useState(false);
  const usesWideLayout = useMediaQuery('(min-width: 960px)');
  const triggerContent = (
    <>
      {Icon && <Icon size={18} aria-hidden="true" />}
      <span>
        <strong>{title}</strong>
        {summary && <small>{summary}</small>}
      </span>
      <ChevronDown className="ecommerce-order-detail__section-chevron" size={18} aria-hidden="true" />
    </>
  );

  return (
    <section className={`ecommerce-order-detail__section ecommerce-order-detail__section--${variant} ${open ? 'is-open' : ''}`}>
      {usesWideLayout ? (
        <div className="ecommerce-order-detail__section-trigger">
          {triggerContent}
        </div>
      ) : (
        <button
          type="button"
          className="ecommerce-order-detail__section-trigger"
          aria-label={summary ? `${title}: ${summary}` : title}
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          {triggerContent}
        </button>
      )}
      <div className="ecommerce-order-detail__section-content">{children}</div>
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
  posActionLoading,
  onFulfillmentTerminalSuccess
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
  const deliveryAddress = order?.customer?.deliveryAddress;
  const customerAddress = order?.customer?.address
    || (deliveryAddress ? formatEcommerceDeliveryAddress(deliveryAddress) : '');
  const deliveryLocation = deliveryAddress
    ? [
      deliveryAddress.municipality,
      deliveryAddress.state,
      deliveryAddress.postalCode ? `CP ${deliveryAddress.postalCode}` : ''
    ].filter(Boolean).join(' · ')
    : '';
  const isPaymentRequired = isEcommerceFulfillmentPaymentRequired(order);
  const paymentLabel = order?.payment?.status === 'paid'
    ? 'Pagado'
    : order?.fulfillment?.paymentRegistered
      ? 'Registrado en Punto de Venta'
      : 'Pendiente al entregar';
  const posConversion = order?.posConversion;

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
            <small>Pedido en línea</small>
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

            <DetailSection
              title="Modalidad"
              summary={fulfillmentLabel(order.fulfillmentMethod)}
              variant="fulfillment"
              icon={Store}
            >
              <p>{fulfillmentLabel(order.fulfillmentMethod)}</p>
            </DetailSection>

            <DetailSection
              title="Cliente"
              summary={order.customer?.name || 'Sin nombre'}
              variant="customer"
              icon={CircleUserRound}
            >
              <dl className="ecommerce-order-detail__definition-list">
                <div><dt>Nombre</dt><dd>{order.customer?.name || 'Sin nombre'}</dd></div>
                <div><dt>Teléfono</dt><dd>{order.customer?.phone || 'Sin teléfono'}</dd></div>
                {customerAddress && <div><dt>Dirección</dt><dd>{customerAddress}</dd></div>}
                {deliveryLocation && <div><dt>Municipio / estado / CP</dt><dd>{deliveryLocation}</dd></div>}
                {deliveryAddress?.reference && <div><dt>Referencia para llegar</dt><dd>{deliveryAddress.reference}</dd></div>}
                {order.customer?.notes && <div><dt>Notas</dt><dd>{order.customer.notes}</dd></div>}
              </dl>
            </DetailSection>

            <DetailSection
              title="Artículos y total"
              summary={`${order.items.length} ${order.items.length === 1 ? 'artículo' : 'artículos'} · ${formatMoney(order.totals?.total, order.totals?.currency)}`}
              variant="items"
              icon={ShoppingBag}
            >
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

            <DetailSection title="Totales" variant="totals">
              <dl className="ecommerce-order-detail__totals">
                <div><dt>Subtotal</dt><dd>{formatMoney(order.totals?.subtotal, order.totals?.currency)}</dd></div>
                {Number(order.totals?.deliveryFee || 0) !== 0 && <div><dt>Envío</dt><dd>{formatMoney(order.totals.deliveryFee, order.totals.currency)}</dd></div>}
                {Number(order.totals?.discountTotal || 0) !== 0 && <div><dt>Descuento</dt><dd>-{formatMoney(order.totals.discountTotal, order.totals.currency)}</dd></div>}
                {Number(order.totals?.taxTotal || 0) !== 0 && <div><dt>Impuestos</dt><dd>{formatMoney(order.totals.taxTotal, order.totals.currency)}</dd></div>}
                <div className="is-total"><dt>Total</dt><dd>{formatMoney(order.totals?.total, order.totals?.currency)}</dd></div>
                <div><dt>Pago</dt><dd>{paymentLabel}</dd></div>
                {posConversion && (
                  <div>
                    <dt>Conversión POS</dt>
                    <dd>
                      {posConversion.status === 'completed'
                        ? `Registrada${posConversion.convertedSaleId ? ` · ${posConversion.convertedSaleId}` : ''}`
                        : posConversion.status === 'reserved' ? 'En revisión' : 'Sin conversión'}
                    </dd>
                  </div>
                )}
              </dl>
            </DetailSection>

            <EcommerceFulfillmentPanel onTerminalSuccess={onFulfillmentTerminalSuccess} />

            <DetailSection
              title="Historial"
              summary={order.events.at(-1)?.message || 'Sin movimientos registrados'}
              variant="history"
              icon={History}
            >
              <ol className="ecommerce-order-detail__timeline">
                {order.events.map((event) => (
                  <li key={event.id || `${event.eventType}-${event.createdAt}-${event.actorLabel || ''}-${event.message || ''}`}>
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
                  {posActionLoading === 'prepare'
                    ? 'Preparando…'
                    : isPaymentRequired ? 'Cobrar en Punto de Venta' : 'Preparar en Punto de Venta'}
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
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileGroup, setMobileGroup] = useState('attention');
  const [expandedMobileGroups, setExpandedMobileGroups] = useState(() => new Set());
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const currentStaffUser = useAppStore((state) => state.currentStaffUser);
  const orders = useAppStore((state) => state.ecommerceOrders);
  const counts = useAppStore((state) => state.ecommerceOrderCounts);
  const loading = useAppStore((state) => state.ecommerceOrdersLoading);
  const refreshing = useAppStore((state) => state.ecommerceOrdersRefreshing);
  const error = useAppStore((state) => state.ecommerceOrdersError);
  const filter = useAppStore((state) => state.ecommerceOrdersFilter);
  const pagination = useAppStore((state) => state.ecommerceOrdersPagination);
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
  const visibleOrders = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase('es-MX');
    if (!query) return orders;

    return orders.filter((order) => (
      String(order.code || '').toLocaleLowerCase('es-MX').includes(query)
      || String(order.customerName || '').toLocaleLowerCase('es-MX').includes(query)
    ));
  }, [orders, searchQuery]);
  const totalCount = Number(
    counts.total
    ?? (
      Number(counts.new || 0)
      + Number(counts.seen || 0)
      + Number(counts.accepted || 0)
      + Number(counts.rejected || 0)
    )
  );
  const mobileGroups = useMemo(() => ORDER_GROUPS.map((group) => ({
    ...group,
    count: visibleOrders.filter((order) => getOrderGroup(order).key === group.key).length
  })), [visibleOrders]);

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

  useEffect(() => {
    const preferFirstMatch = Boolean(searchQuery.trim());
    setMobileGroup((currentGroup) => getNextMobileGroup(visibleOrders, currentGroup, { preferFirstMatch }));
  }, [searchQuery, visibleOrders]);

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

    const { limit } = normalizeOrderPagination(pagination);

    setDialogMode(null);
    clearSelectedOrder?.();

    if (searchParams.has('order')) {
      const next = new URLSearchParams(searchParams);
      next.delete('order');
      setSearchParams(next, { replace: true });
    }

    setFilter?.(nextFilter);
    await loadOrders?.({ filter: nextFilter, limit, offset: 0, force: true });
  };

  const handlePageChange = async (direction) => {
    const { limit, offset, hasMore } = normalizeOrderPagination(pagination);
    if (loading || refreshing) return;
    if (direction === 'next' && !hasMore) return;
    if (direction === 'previous' && offset === 0) return;

    const nextOffset = direction === 'next'
      ? offset + limit
      : Math.max(offset - limit, 0);
    await loadOrders?.({
      filter,
      limit,
      offset: nextOffset,
      force: true
    });
  };

  const handleMobileGroup = (groupKey) => {
    setMobileGroup(groupKey);
    setExpandedMobileGroups((current) => {
      const next = new Set(current);
      next.delete(groupKey);
      return next;
    });
  };

  const handleToggleMobileExpanded = (groupKey) => {
    setExpandedMobileGroups((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
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

  const handleFulfillmentTerminalSuccess = (nextState) => {
    showMessageModal(
      nextState === 'completed' ? 'Pedido completado' : 'Pedido cancelado',
      null,
      { type: 'success' }
    );
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
      <OrdersInbox
        loading={loading}
        refreshing={refreshing}
        error={error}
        orders={orders}
        visibleOrders={visibleOrders}
        refreshOrders={refreshOrders}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        filter={filter}
        handleFilter={handleFilter}
        counts={counts}
        totalCount={totalCount}
        mobileGroups={mobileGroups}
        mobileGroup={mobileGroup}
        handleMobileGroup={handleMobileGroup}
        expandedMobileGroups={expandedMobileGroups}
        handleToggleMobileExpanded={handleToggleMobileExpanded}
        handleOpenOrder={handleOpenOrder}
        pagination={pagination}
        handlePageChange={handlePageChange}
      />

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
        onFulfillmentTerminalSuccess={handleFulfillmentTerminalSuccess}
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
