import { useCallback, useEffect, useState } from 'react';
import { Eye, History, RefreshCw, Send } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { getSiteBuilderState, listSiteVersions, publishSiteDraft, restoreSiteVersion } from '../../services/ecommerce/ecommerceSiteBuilderService';

export default function EcommerceSiteBuilderFoundation({ isPro }) {
  const [state, setState] = useState(null);
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!isPro) return;
    setLoading(true);
    const [builder, history] = await Promise.all([getSiteBuilderState(), listSiteVersions()]);
    setLoading(false);
    if (!builder.success) return toast.error(builder.message);
    setState(builder);
    if (history.success) setVersions(Array.isArray(history.versions) ? history.versions : []);
  }, [isPro]);
  useEffect(() => { void load(); }, [load]);
  if (!isPro) return null;
  const publish = async () => {
    setLoading(true);
    const result = await publishSiteDraft();
    setLoading(false);
    if (!result.success) return toast.error(result.message);
    toast.success(result.idempotent ? 'La versión publicada ya está vigente.' : 'Sitio publicado.');
    void load();
  };
  const restore = async (versionId) => {
    setLoading(true);
    const result = await restoreSiteVersion(versionId);
    setLoading(false);
    if (!result.success) return toast.error(result.message);
    toast.success('La versión se restauró como borrador. Publícala cuando estés listo.');
    void load();
  };
  return (
    <section className="ui-card ecom-admin-status-card" aria-labelledby="site-builder-foundation-title">
      <div className="ecom-admin-card-heading"><div><span className="ecom-admin-eyebrow">Constructor del sitio</span><h3 id="site-builder-foundation-title">Infraestructura preparada</h3><p>La edición visual llegará en una fase posterior. Ya puedes publicar, consultar y restaurar versiones del documento base.</p></div><Eye aria-hidden="true" size={22} /></div>
      <div className="ecom-admin-status-actions"><span>Revisión de borrador: <strong>{state?.draft?.revision ?? '—'}</strong>{state?.hasUnpublishedChanges ? ' · cambios sin publicar' : ''}</span><button type="button" className="btn btn-secondary" onClick={load} disabled={loading}><RefreshCw size={16} />Actualizar</button><button type="button" className="btn btn-primary" onClick={publish} disabled={loading || !state}><Send size={16} />Publicar base</button></div>
      {versions.length ? <div className="ecom-admin-help"><History size={15} /> Versiones: {versions.map((version) => <button key={version.id} type="button" className="btn btn-secondary" disabled={loading} onClick={() => restore(version.id)}>Restaurar v{version.versionNumber}</button>)}</div> : null}
    </section>
  );
}
