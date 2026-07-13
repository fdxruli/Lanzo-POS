import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Circle, Clock3, PackageCheck, RefreshCw, Truck } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import {
  ECOMMERCE_TRACKING_POLL_MS,
  clearTrackingCache,
  getPublicOrderTracking,
  readTrackingCache,
  subscribeToPublicTrackingSignals,
  writeTrackingCache
} from '../services/ecommerce/ecommerceOrderTrackingService';
import './PublicOrderTrackingPage.css';

const STATUS_LABELS = Object.freeze({
  received: 'Pedido recibido',
  accepted: 'Pedido aceptado',
  preparing: 'En preparación',
  ready: 'Listo',
  out_for_delivery: 'En camino',
  completed: 'Completado',
  cancelled: 'Cancelado',
  attention: 'Requiere atención',
  rejected: 'Rechazado'
});

const formatCurrency = (value, currency = 'MXN') => new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
}).format(Number(value) || 0);

const formatDateTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No disponible';
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
};

const buildSteps = (fulfillmentMethod) => [
  { key: 'received', label: 'Pedido recibido', icon: Circle },
  { key: 'accepted', label: 'Pedido aceptado', icon: Check },
  { key: 'preparing', label: 'En preparación', icon: Clock3 },
  { key: 'ready', label: 'Listo', icon: PackageCheck },
  ...(fulfillmentMethod === 'delivery'
    ? [{ key: 'out_for_delivery', label: 'En camino', icon: Truck }]
    : []),
  { key: 'completed', label: 'Completado', icon: Check }
];

const getProgressIndex = (steps, status) => steps.findIndex((step) => step.key === status);

export default function PublicOrderTrackingPage() {
  const { slug = '', trackingToken = '' } = useParams();
  const requestEpochRef = useRef(0);
  const trackingRef = useRef(null);
  const [tracking, setTracking] = useState(null);
  const [networkState, setNetworkState] = useState('loading');
  const [message, setMessage] = useState('');

  const refresh = useCallback(async ({ background = false } = {}) => {
    const requestEpoch = ++requestEpochRef.current;
    if (!background) setNetworkState((current) => (trackingRef.current ? 'refreshing' : current));
    setMessage('');

    try {
      const next = await getPublicOrderTracking(slug, trackingToken);
      if (requestEpoch !== requestEpochRef.current) return;
      setTracking((current) => {
        const resolved = current?.status === 'completed' && next.status !== 'completed'
          ? current
          : Number(current?.version || 0) > Number(next.version || 0)
            ? current
            : next;
        trackingRef.current = resolved;
        return resolved;
      });
      setNetworkState('ready');
      void writeTrackingCache(slug, trackingToken, next);
    } catch (error) {
      if (requestEpoch !== requestEpochRef.current) return;
      if (error?.code === 'ECOMMERCE_TRACKING_NOT_FOUND') {
        trackingRef.current = null;
        setTracking(null);
        setNetworkState('not_found');
        setMessage(error.message);
        void clearTrackingCache(slug, trackingToken);
        return;
      }

      const cached = await readTrackingCache(slug, trackingToken);
      if (requestEpoch !== requestEpochRef.current) return;
      if (cached?.tracking) {
        trackingRef.current = cached.tracking;
        setTracking(cached.tracking);
        setNetworkState('offline');
        setMessage('Mostramos el último estado guardado. Puede estar desactualizado.');
      } else {
        setNetworkState(globalThis.navigator?.onLine === false ? 'offline' : 'error');
        setMessage(error?.message || 'No se pudo actualizar el seguimiento.');
      }
    }
  }, [slug, trackingToken]);

  useEffect(() => {
    let cancelled = false;
    requestEpochRef.current += 1;
    trackingRef.current = null;
    setTracking(null);
    setNetworkState('loading');
    setMessage('');

    (async () => {
      const cached = await readTrackingCache(slug, trackingToken);
      if (cancelled) return;
      if (cached?.tracking) {
        trackingRef.current = cached.tracking;
        setTracking(cached.tracking);
      }
      if (globalThis.navigator?.onLine === false && cached?.tracking) {
        setNetworkState('offline');
        setMessage('Mostramos el último estado guardado. Puede estar desactualizado.');
        return;
      }
      await refresh({ background: Boolean(cached?.tracking) });
    })();

    return () => {
      cancelled = true;
      requestEpochRef.current += 1;
    };
  }, [refresh, slug, trackingToken]);

  useEffect(() => {
    const handleOnline = () => refresh({ background: true });
    const handleOffline = () => {
      setNetworkState('offline');
      setMessage('Sin conexión. El estado visible no está confirmado en este momento.');
    };
    const handleFocus = () => {
      if (document.visibilityState !== 'hidden' && globalThis.navigator?.onLine !== false) {
        refresh({ background: true });
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') handleFocus();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && globalThis.navigator?.onLine !== false) {
        refresh({ background: true });
      }
    }, ECOMMERCE_TRACKING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!tracking?.realtime?.enabled || !tracking.realtime.topic) return undefined;
    return subscribeToPublicTrackingSignals({
      topic: tracking.realtime.topic,
      onSignal: () => refresh({ background: true })
    });
  }, [refresh, tracking?.realtime?.enabled, tracking?.realtime?.topic]);

  const steps = useMemo(
    () => buildSteps(tracking?.fulfillmentMethod),
    [tracking?.fulfillmentMethod]
  );
  const progressIndex = getProgressIndex(steps, tracking?.status);
  const terminalProblem = ['cancelled', 'attention', 'rejected'].includes(tracking?.status);

  if (networkState === 'loading' && !tracking) {
    return (
      <main className="public-tracking-shell public-tracking-shell--centered" aria-busy="true">
        <section className="public-tracking-card public-tracking-loading">
          <div className="public-tracking-skeleton public-tracking-skeleton--title" />
          <div className="public-tracking-skeleton" />
          <div className="public-tracking-skeleton" />
        </section>
      </main>
    );
  }

  if (networkState === 'not_found' || (!tracking && networkState === 'offline')) {
    return (
      <main className="public-tracking-shell public-tracking-shell--centered">
        <section className="public-tracking-card public-tracking-empty" role="alert">
          <h1>No se encontró el seguimiento</h1>
          <p>{message || 'No se pudo encontrar este seguimiento.'}</p>
          <Link className="ui-button ui-button--secondary" to={`/tienda/${slug}`}>Volver a la tienda</Link>
        </section>
      </main>
    );
  }

  if (!tracking) {
    return (
      <main className="public-tracking-shell public-tracking-shell--centered">
        <section className="public-tracking-card public-tracking-empty" role="alert">
          <h1>No se pudo cargar el seguimiento</h1>
          <p>{message}</p>
          <button type="button" className="ui-button ui-button--primary" onClick={() => refresh()}>
            <RefreshCw aria-hidden="true" size={18} /> Reintentar
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="public-tracking-shell">
      <section className="public-tracking-card" aria-labelledby="public-tracking-title">
        <header className="public-tracking-header">
          <div>
            <p className="public-tracking-kicker">Seguimiento del pedido</p>
            <h1 id="public-tracking-title">{tracking.orderCode}</h1>
          </div>
          <button
            type="button"
            className="ui-button ui-button--secondary public-tracking-refresh"
            onClick={() => refresh()}
            disabled={networkState === 'refreshing'}
          >
            <RefreshCw aria-hidden="true" size={18} />
            {networkState === 'refreshing' ? 'Actualizando…' : 'Actualizar'}
          </button>
        </header>

        <div className={`public-tracking-network public-tracking-network--${networkState}`} aria-live="polite">
          {networkState === 'offline'
            ? message || 'Sin conexión. El estado puede estar desactualizado.'
            : `Estado actual: ${STATUS_LABELS[tracking.status] || 'Pedido recibido'}`}
        </div>

        <section className={`public-tracking-status ${terminalProblem ? 'public-tracking-status--attention' : ''}`}>
          <p>Estado actual</p>
          <h2 aria-live="polite">{STATUS_LABELS[tracking.status] || 'Pedido recibido'}</h2>
          {tracking.publicMessage ? <p className="public-tracking-public-message">{tracking.publicMessage}</p> : null}
          {tracking.paymentRegistered ? <span className="public-tracking-payment">Pago registrado</span> : null}
        </section>

        {!terminalProblem ? (
          <ol className="public-tracking-timeline" aria-label="Progreso del pedido">
            {steps.map((step, index) => {
              const StepIcon = step.icon;
              const completed = progressIndex >= 0 && index <= progressIndex;
              const current = index === progressIndex;
              return (
                <li key={step.key} className={completed ? 'is-complete' : ''} aria-current={current ? 'step' : undefined}>
                  <span className="public-tracking-step-icon"><StepIcon aria-hidden="true" size={18} /></span>
                  <span>{step.label}</span>
                </li>
              );
            })}
          </ol>
        ) : null}

        <dl className="public-tracking-details">
          <div><dt>Modalidad</dt><dd>{tracking.fulfillmentMethod === 'delivery' ? 'Entrega a domicilio' : 'Recoger en el negocio'}</dd></div>
          <div><dt>Creado</dt><dd>{formatDateTime(tracking.createdAt)}</dd></div>
          <div><dt>Última actualización</dt><dd>{formatDateTime(tracking.updatedAt)}</dd></div>
          <div><dt>Total</dt><dd>{formatCurrency(tracking.total, tracking.currency)}</dd></div>
        </dl>

        <section className="public-tracking-items" aria-labelledby="public-tracking-items-title">
          <h2 id="public-tracking-items-title">Resumen de productos</h2>
          <ul>
            {tracking.items.map((item, index) => (
              <li key={`${item.name}-${index}`}><span>{item.name}</span><strong>× {item.quantity}</strong></li>
            ))}
          </ul>
        </section>

        <footer className="public-tracking-footer">
          {tracking.storefrontAvailable ? (
            <Link className="ui-button ui-button--secondary" to={`/tienda/${slug}`}>Volver a la tienda</Link>
          ) : (
            <span className="public-tracking-storefront-unavailable">La tienda no está recibiendo pedidos en este momento.</span>
          )}
          <small>Versión del estado: {tracking.version}</small>
        </footer>
      </section>
    </main>
  );
}

export const publicOrderTrackingInternals = Object.freeze({
  STATUS_LABELS,
  buildSteps,
  getProgressIndex
});
