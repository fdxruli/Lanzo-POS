import { useEffect, useMemo, useRef } from 'react';
import { AlertTriangle, Bell, PackageX, TriangleAlert, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useActorRuntimeSnapshot } from '../../services/auth/useActorRuntimeSnapshot';
import { canReadSalesReports } from '../../services/auth/salesPermissionPolicy';
import {
  INVENTORY_OPERATIONAL_TYPES
} from '../../services/inventoryOperationalAlerts';
import {
  markCurrentLocalInventoryOperationalAlertsSeen,
  refreshLocalInventoryOperationalAlertsSnapshot
} from '../../services/localInventoryOperationalAlerts';

const STOCK_TYPES = new Set([
  INVENTORY_OPERATIONAL_TYPES.OUT_OF_STOCK,
  INVENTORY_OPERATIONAL_TYPES.LOW_STOCK
]);

const RESTOCK_ROUTE = '/ventas?tab=restock';
const EXPIRATION_ROUTE = '/ventas?tab=expiration';

const getAlertRoute = (alert) => (
  STOCK_TYPES.has(alert?.type)
    ? RESTOCK_ROUTE
    : EXPIRATION_ROUTE
);

const getAlertLabel = (alert) => {
  switch (alert?.type) {
    case INVENTORY_OPERATIONAL_TYPES.OUT_OF_STOCK:
      return 'Agotado';
    case INVENTORY_OPERATIONAL_TYPES.LOW_STOCK:
      return 'Stock bajo';
    case INVENTORY_OPERATIONAL_TYPES.EXPIRED:
      return 'Vencido';
    case INVENTORY_OPERATIONAL_TYPES.EXPIRING:
      return alert?.expiresToday ? 'Vence hoy' : 'Próximo a caducar';
    default:
      return 'Inventario';
  }
};

const getAlertDetail = (alert) => {
  switch (alert?.type) {
    case INVENTORY_OPERATIONAL_TYPES.OUT_OF_STOCK:
      return `Disponible: ${alert.availableStock ?? '—'}`;
    case INVENTORY_OPERATIONAL_TYPES.LOW_STOCK:
      return `Disponible: ${alert.availableStock ?? '—'} · Mínimo: ${alert.minStock ?? '—'}`;
    case INVENTORY_OPERATIONAL_TYPES.EXPIRED:
      return alert.expiryDate ? `Caducó: ${alert.expiryDate}` : 'Lote vencido';
    case INVENTORY_OPERATIONAL_TYPES.EXPIRING:
      if (alert.expiresToday) return 'Requiere atención hoy';
      return Number.isFinite(alert.daysUntilExpiry)
        ? `Caduca en ${alert.daysUntilExpiry} día${alert.daysUntilExpiry === 1 ? '' : 's'}`
        : 'Próximo a caducar';
    default:
      return '';
  }
};

const getAlertIcon = (alert) => {
  if (alert?.type === INVENTORY_OPERATIONAL_TYPES.OUT_OF_STOCK) {
    return <PackageX size={18} aria-hidden="true" />;
  }
  if (alert?.severity === 'critical') {
    return <TriangleAlert size={18} aria-hidden="true" />;
  }
  return <AlertTriangle size={18} aria-hidden="true" />;
};

const getAlertCountLabel = (count) => `${count} ${count === 1 ? 'alerta' : 'alertas'}`;

export default function LocalInventoryOperationalAlertsDrawer({
  isOpen,
  onClose,
  snapshot
}) {
  const navigate = useNavigate();
  const actorRuntime = useActorRuntimeSnapshot();
  const canNavigateReports = canReadSalesReports(actorRuntime);
  const closeButtonRef = useRef(null);
  const previousFocusRef = useRef(null);

  const alerts = useMemo(
    () => Array.isArray(snapshot?.alerts) ? snapshot.alerts : [],
    [snapshot?.alerts]
  );
  const visibleAlerts = alerts.slice(0, 12);
  const restockCount = (snapshot?.outOfStockCount ?? 0) + (snapshot?.lowStockCount ?? 0);
  const expirationCount = (snapshot?.expiredCount ?? 0) + (snapshot?.expiringCount ?? 0);

  useEffect(() => {
    if (!isOpen) return undefined;

    previousFocusRef.current = document.activeElement;

    const drawer = document.getElementById('local-inventory-operational-alerts-drawer');
    const focusableSelector = [
      'button:not([disabled])',
      'a[href]',
      '[tabindex]:not([tabindex="-1"])'
    ].join(',');

    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab' || !drawer) return;
      const focusable = [...drawer.querySelectorAll(focusableSelector)];
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.body.classList.add('notification-center-open');
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.body.classList.remove('notification-center-open');
      document.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus?.();
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;

    if (snapshot?.status === 'idle') {
      void refreshLocalInventoryOperationalAlertsSnapshot();
      return;
    }

    if (snapshot?.status === 'ready') {
      markCurrentLocalInventoryOperationalAlertsSeen();
    }
  }, [isOpen, snapshot?.status, snapshot?.updatedAt]);

  if (!isOpen) return null;

  const status = snapshot?.status || 'idle';
  const loading = status === 'idle' || (status === 'loading' && !snapshot?.updatedAt);
  const error = status === 'error';

  const handleCategoryNavigate = (route) => {
    if (!canNavigateReports) return;
    onClose();
    navigate(route);
  };

  const handleNavigate = (alert) => {
    handleCategoryNavigate(getAlertRoute(alert));
  };

  return (
    <>
      <button
        type="button"
        className="notification-center-backdrop"
        onClick={onClose}
        aria-label="Cerrar alertas operativas de inventario"
      />

      <aside
        id="local-inventory-operational-alerts-drawer"
        className="notification-center-drawer local-inventory-alerts-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="local-inventory-alerts-title"
      >
        <header className="local-inventory-alerts-header">
          <span className="local-inventory-alerts-header__icon" aria-hidden="true">
            <Bell size={20} />
          </span>
          <div>
            <p className="local-inventory-alerts-eyebrow">Alertas locales</p>
            <h2 id="local-inventory-alerts-title">Inventario requiere atención</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="notification-center-close"
            onClick={onClose}
            aria-label="Cerrar alertas operativas de inventario"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        {loading && (
          <div className="notification-list-state" role="status">
            <p>Revisando inventario…</p>
          </div>
        )}

        {error && (
          <div className="notification-list-state notification-list-state--error" role="alert">
            <p>No pudimos revisar las alertas locales de inventario.</p>
            <button
              type="button"
              onClick={() => void refreshLocalInventoryOperationalAlertsSnapshot()}
            >
              Reintentar
            </button>
          </div>
        )}

        {!loading && !error && snapshot?.activeCount === 0 && (
          <div className="notification-list-state">
            <p>Tu inventario no tiene alertas operativas activas.</p>
          </div>
        )}

        {!loading && !error && snapshot?.activeCount > 0 && (
          <>
            <section className="local-inventory-alerts-summary" aria-label="Resumen de alertas activas">
              <strong>{snapshot.activeCount} alertas activas</strong>
              <div className="local-inventory-alerts-counts">
                <span><b>{snapshot.outOfStockCount}</b> Agotados</span>
                <span><b>{snapshot.lowStockCount}</b> Stock bajo</span>
                <span><b>{snapshot.expiredCount}</b> Vencidos</span>
                <span><b>{snapshot.expiringCount}</b> Próximos a caducar</span>
              </div>

              {(restockCount > 0 || expirationCount > 0) && (
                <div
                  className="notification-center-actions"
                  aria-label="Accesos por categoría de inventario"
                >
                  {restockCount > 0 && (
                    <button
                      type="button"
                      className="notification-center-action"
                      onClick={() => handleCategoryNavigate(RESTOCK_ROUTE)}
                      disabled={!canNavigateReports}
                      aria-label={`Revisar ${getAlertCountLabel(restockCount)} de reabastecimiento`}
                    >
                      Reabastecimiento · {getAlertCountLabel(restockCount)}
                    </button>
                  )}

                  {expirationCount > 0 && (
                    <button
                      type="button"
                      className="notification-center-action"
                      onClick={() => handleCategoryNavigate(EXPIRATION_ROUTE)}
                      disabled={!canNavigateReports}
                      aria-label={`Revisar ${getAlertCountLabel(expirationCount)} de caducidad`}
                    >
                      Caducidad · {getAlertCountLabel(expirationCount)}
                    </button>
                  )}
                </div>
              )}
            </section>

            {!canNavigateReports && (
              <p className="local-inventory-alerts-permission-note">
                Puedes consultar estas alertas, pero tu usuario no tiene acceso a Ventas y Reportes.
              </p>
            )}

            <div className="local-inventory-alerts-list" role="list">
              {visibleAlerts.map((alert) => (
                <article
                  key={alert.incidentId}
                  className={[
                    'local-inventory-alert',
                    `is-${alert.severity || 'warning'}`,
                    alert.isSeen ? 'is-seen' : 'is-new'
                  ].join(' ')}
                  role="listitem"
                >
                  <span className="local-inventory-alert__icon">
                    {getAlertIcon(alert)}
                  </span>
                  <div className="local-inventory-alert__content">
                    <div className="local-inventory-alert__heading">
                      <strong>{alert.productName}</strong>
                      {!alert.isSeen && <span className="local-inventory-alert__new">Nueva</span>}
                    </div>
                    <span className="local-inventory-alert__type">{getAlertLabel(alert)}</span>
                    <p>{getAlertDetail(alert)}</p>
                  </div>
                  <button
                    type="button"
                    className="local-inventory-alert__action"
                    onClick={() => handleNavigate(alert)}
                    disabled={!canNavigateReports}
                    aria-label={`Revisar ${getAlertLabel(alert)} de ${alert.productName}`}
                  >
                    Revisar
                  </button>
                </article>
              ))}
            </div>

            {snapshot.activeCount > visibleAlerts.length && (
              <p className="local-inventory-alerts-more">
                +{snapshot.activeCount - visibleAlerts.length} alertas activas adicionales.
              </p>
            )}
          </>
        )}
      </aside>
    </>
  );
}
