import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { ECOMMERCE_PUBLISHED_STOCK_ALERT_ROUTE } from '../../services/ecommerce/ecommercePublishedStockAlertConstants';

export default function EcommercePublishedStockOperationalAlert({
  isOpen,
  snapshot,
  onNavigate
}) {
  const [target, setTarget] = useState(null);
  const count = Number(snapshot?.outOfStockCount || 0);
  const active = (
    isOpen
    && snapshot?.success === true
    && snapshot?.portalStatus === 'published'
    && count > 0
  );

  useEffect(() => {
    if (!active || typeof document === 'undefined') {
      setTarget(null);
      return undefined;
    }

    let cancelled = false;
    let timerId = null;
    const schedule = typeof window.requestAnimationFrame === 'function'
      ? (callback) => ({ type: 'frame', id: window.requestAnimationFrame(callback) })
      : (callback) => ({ type: 'timer', id: window.setTimeout(callback, 0) });

    const resolveTarget = () => {
      if (cancelled) return;
      const nextTarget = document.querySelector(
        '#notification-center-drawer .notification-center-body'
      );
      if (nextTarget) {
        setTarget(nextTarget);
        return;
      }
      timerId = schedule(resolveTarget);
    };

    resolveTarget();
    return () => {
      cancelled = true;
      if (timerId?.type === 'frame') window.cancelAnimationFrame(timerId.id);
      if (timerId?.type === 'timer') window.clearTimeout(timerId.id);
    };
  }, [active]);

  if (!active || !target) return null;

  const body = count === 1
    ? 'Tienes 1 producto publicado que no tiene inventario disponible.'
    : `Tienes ${count} productos publicados que no tienen inventario disponible.`;

  return createPortal(
    <section
      className="notification-local-operational-alert"
      role="alert"
      aria-label="Productos publicados sin stock"
      data-local-operational="ecommerce-published-out-of-stock"
    >
      <span className="notification-local-operational-alert__icon">
        <AlertTriangle size={20} aria-hidden="true" />
      </span>
      <div className="notification-local-operational-alert__copy">
        <strong>Productos publicados sin stock</strong>
        <p>{body}</p>
        <button
          type="button"
          onClick={() => onNavigate?.(ECOMMERCE_PUBLISHED_STOCK_ALERT_ROUTE)}
        >
          Revisar productos
          <ArrowRight size={15} aria-hidden="true" />
        </button>
      </div>
    </section>,
    target
  );
}
