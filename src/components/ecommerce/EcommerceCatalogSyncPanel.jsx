import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, LoaderCircle, RefreshCw } from 'lucide-react';
import {
  ECOMMERCE_CATALOG_SYNC_REQUEST_EVENT,
  ECOMMERCE_CATALOG_SYNC_STATUS_EVENT,
  ecommerceCatalogSyncService
} from '../../services/ecommerce/ecommerceCatalogSyncService';
import './EcommerceCatalogSync.css';

const STATUS_COPY = Object.freeze({
  synced: { label: 'Sincronizado con el producto local', tone: 'success' },
  pending: { label: 'Cambios pendientes de sincronizar', tone: 'warning' },
  review: { label: 'Requiere revisión', tone: 'warning' },
  error: { label: 'No se pudo sincronizar', tone: 'danger' },
  manual: { label: 'Campos administrados manualmente', tone: 'neutral' }
});

const asDate = (value) => {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
};

export const getEcommerceCatalogSyncStatusCopy = (status) => (
  STATUS_COPY[status] || STATUS_COPY.manual
);

export function EcommerceCatalogSyncBadge({ status = 'manual' }) {
  const copy = getEcommerceCatalogSyncStatusCopy(status);
  return (
    <span className={`ecom-admin-sync-badge is-${copy.tone}`}>
      {status === 'synced' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
      {copy.label}
    </span>
  );
}

export default function EcommerceCatalogSyncPanel({
  isPro,
  products = [],
  catalogRevision = null,
  onRefresh
}) {
  const [runtimeStatus, setRuntimeStatus] = useState(() => ecommerceCatalogSyncService.getStatus());

  useEffect(() => {
    if (!isPro) return undefined;
    const handleStatus = (event) => {
      setRuntimeStatus(event?.detail || ecommerceCatalogSyncService.getStatus());
      if (event?.detail?.state === 'synced' || event?.detail?.state === 'review') {
        onRefresh?.();
      }
    };
    window.addEventListener(ECOMMERCE_CATALOG_SYNC_STATUS_EVENT, handleStatus);
    return () => window.removeEventListener(ECOMMERCE_CATALOG_SYNC_STATUS_EVENT, handleStatus);
  }, [isPro, onRefresh]);

  const summary = useMemo(() => {
    const counts = products.reduce((result, product) => {
      const status = product.syncStatus || 'manual';
      if (status === 'pending') result.pending += 1;
      if (status === 'error') result.errors += 1;
      if (status === 'review') result.review += 1;
      return result;
    }, { pending: 0, errors: 0, review: 0 });
    const lastSyncedAt = products.reduce((latest, product) => (
      asDate(product.lastSyncedAt) > asDate(latest) ? product.lastSyncedAt : latest
    ), null);
    return { ...counts, lastSyncedAt };
  }, [products]);

  if (!isPro) return null;

  const syncing = runtimeStatus.state === 'syncing';
  const requestSync = () => {
    window.dispatchEvent(new CustomEvent(ECOMMERCE_CATALOG_SYNC_REQUEST_EVENT, {
      detail: { fullReconcile: true, reason: 'portal-settings-manual' }
    }));
  };

  return (
    <div className="ecom-admin-sync-panel" aria-live="polite">
      <div className="ecom-admin-sync-panel__heading">
        <div>
          <span className="ecom-admin-eyebrow">Sincronización automática</span>
          <strong>{syncing ? 'Sincronizando catálogo…' : 'Catálogo vinculado con Lanzo Nube'}</strong>
          <small>
            Revisión {runtimeStatus.catalogRevision || catalogRevision || 1}
            {' · '}
            {summary.lastSyncedAt
              ? `Última sincronización ${new Date(summary.lastSyncedAt).toLocaleString('es-MX')}`
              : 'Aún no hay una sincronización confirmada'}
          </small>
        </div>
        <button type="button" className="btn btn-secondary" onClick={requestSync} disabled={syncing}>
          {syncing ? <LoaderCircle className="ecom-admin-spin" size={16} /> : <RefreshCw size={16} />}
          Sincronizar ahora
        </button>
      </div>
      <div className="ecom-admin-sync-summary">
        <span><Clock3 size={15} /> {summary.pending} pendientes</span>
        <span><AlertTriangle size={15} /> {summary.review} en revisión</span>
        <span><AlertTriangle size={15} /> {summary.errors} con error</span>
      </div>
    </div>
  );
}
