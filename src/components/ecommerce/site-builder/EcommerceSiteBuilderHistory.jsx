import { History } from 'lucide-react';

const DATE_FORMATTER = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
const formatDate = (value) => value ? DATE_FORMATTER.format(new Date(value)) : null;

export default function EcommerceSiteBuilderHistory({ versions, publishedVersionId, hasMore, loadingMore, restoringVersionId, disabled, onRestore, onLoadMore }) {
  return (
    <section className="ecom-builder-history" aria-labelledby="ecom-builder-history-title">
      <div className="ecom-admin-card-heading"><div><span className="ecom-admin-eyebrow"><History size={15} /> Versiones</span><h3 id="ecom-builder-history-title">Historial de publicaciones</h3></div></div>
      {versions.length === 0 ? <p className="ecom-admin-help">Todavía no hay versiones publicadas.</p> : <div className="ecom-builder-version-list">{versions.map((version) => <article key={version.id}><div><strong>Versión {version.versionNumber}</strong>{version.id === publishedVersionId ? <span>Publicada actualmente</span> : null}{version.createdAt ? <small>{formatDate(version.createdAt)}</small> : null}{version.documentMode ? <small>Modo: {version.documentMode}</small> : null}</div><button type="button" className="btn btn-secondary" onClick={() => onRestore(version.id)} disabled={disabled || restoringVersionId === version.id}>{restoringVersionId === version.id ? 'Restaurando…' : `Restaurar v${version.versionNumber}`}</button></article>)}</div>}
      {hasMore ? <button type="button" className="btn btn-secondary" onClick={onLoadMore} disabled={disabled || loadingMore}>{loadingMore ? 'Cargando…' : 'Ver más'}</button> : null}
    </section>
  );
}
