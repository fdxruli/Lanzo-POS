import { History, Trash2 } from 'lucide-react';

const DATE_FORMATTER = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
const formatDate = (value) => value ? DATE_FORMATTER.format(new Date(value)) : null;

export default function EcommerceSiteBuilderHistory({ versions, publishedVersionId, hasMore, loadingMore, restoringVersionId, deletingVersionId, disabled, onRestore, onDelete, onLoadMore }) {
  return (
    <section className="ecom-builder-history" aria-label="Historial de versiones">
      <details className="ecom-builder-fold">
        <summary><span><strong><History size={16} aria-hidden="true" /> Historial de versiones</strong><small>{versions.length} versiones cargadas · Restaurar no publica automáticamente</small></span></summary>
        <div className="ecom-builder-fold__content">
          <p className="ecom-admin-help">Guardar modifica el borrador; publicar crea una versión en el historial.</p>
          {versions.length === 0 ? <p className="ecom-admin-help">Todavía no hay versiones publicadas.</p> : <div className="ecom-builder-version-list">{versions.map((version) => <article key={version.id}><div><strong>Versión {version.versionNumber}</strong>{version.id === publishedVersionId ? <span>Publicada actualmente</span> : null}{version.createdAt ? <small>{formatDate(version.createdAt)}</small> : null}{version.documentMode ? <small>Modo: {version.documentMode}</small> : null}</div><div className="ecom-builder-version-actions"><button type="button" className="btn btn-secondary" onClick={() => onRestore(version.id)} disabled={disabled || deletingVersionId === version.id || restoringVersionId === version.id}>{restoringVersionId === version.id ? 'Restaurando…' : 'Restaurar v' + version.versionNumber}</button>{version.id !== publishedVersionId ? <button type="button" className="btn btn-secondary" onClick={() => onDelete(version)} disabled={disabled || deletingVersionId === version.id || restoringVersionId === version.id}>{deletingVersionId === version.id ? 'Eliminando…' : <><Trash2 size={15} />Eliminar</>}</button> : null}</div></article>)}</div>}
          {hasMore && <button type="button" className="btn btn-secondary" onClick={onLoadMore} disabled={disabled || loadingMore}>{loadingMore ? 'Cargando…' : 'Ver más'}</button>}
        </div>
      </details>
    </section>
  );
}
