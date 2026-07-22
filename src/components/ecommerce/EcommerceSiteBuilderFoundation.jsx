import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Save, Send } from 'lucide-react';
import { toast } from 'react-hot-toast';
import {
  getSiteBuilderState,
  listSiteVersions,
  publishSiteDraft,
  restoreSiteVersion,
  saveSiteDraft
} from '../../services/ecommerce/ecommerceSiteBuilderService';
import {
  buildEcommerceSiteDocumentChecksum,
  migrateEcommerceSiteDocument,
  validateEcommerceSiteDocument
} from '../../utils/ecommerceSiteDocument';
import {
  moveSection,
  resetDocumentToPreset,
  setCatalogVisibility,
  setGlobalDensity,
  setSectionLayout
} from '../../utils/ecommerceSiteBuilderDocument';
import EcommerceSiteBuilderControls from './site-builder/EcommerceSiteBuilderControls';
import EcommerceSiteBuilderHistory from './site-builder/EcommerceSiteBuilderHistory';
import EcommerceSiteBuilderPreview from './site-builder/EcommerceSiteBuilderPreview';
import EcommerceSiteBuilderStatus from './site-builder/EcommerceSiteBuilderStatus';

const PAGE_SIZE = 20;
const clone = (value) => JSON.parse(JSON.stringify(value));

export default function EcommerceSiteBuilderFoundation({ isPro, portal }) {
  const [remoteState, setRemoteState] = useState(null);
  const [savedDocument, setSavedDocument] = useState(null);
  const [workingDocument, setWorkingDocument] = useState(null);
  const [versions, setVersions] = useState([]);
  const [hasMoreVersions, setHasMoreVersions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [restoringVersionId, setRestoringVersionId] = useState(null);
  const [previewViewport, setPreviewViewport] = useState('desktop');
  const [conflict, setConflict] = useState(false);
  const operationRef = useRef(null);

  const hasLocalChanges = useMemo(() => (
    Boolean(workingDocument && savedDocument)
    && buildEcommerceSiteDocumentChecksum(workingDocument) !== buildEcommerceSiteDocumentChecksum(savedDocument)
  ), [savedDocument, workingDocument]);
  const documentValidation = useMemo(() => (
    workingDocument ? validateEcommerceSiteDocument(workingDocument) : { valid: false }
  ), [workingDocument]);
  const busy = loading || saving || publishing || Boolean(restoringVersionId);

  const applyRemoteState = useCallback((result) => {
    const document = migrateEcommerceSiteDocument(result?.draft?.document, { templateCode: portal?.templateCode });
    const canonical = clone(document);
    setRemoteState(result);
    setSavedDocument(canonical);
    setWorkingDocument(clone(canonical));
    setConflict(false);
  }, [portal?.templateCode]);

  const loadFirstPage = useCallback(async () => {
    const history = await listSiteVersions({ limit: PAGE_SIZE, offset: 0 });
    if (!history.success) {
      toast.error(history.message);
      return;
    }
    setVersions(Array.isArray(history.versions) ? history.versions : []);
    setHasMoreVersions(history.hasMore === true);
  }, []);

  const load = useCallback(async () => {
    if (!isPro || operationRef.current) return;
    operationRef.current = 'load';
    setLoading(true);
    const [builder, history] = await Promise.all([
      getSiteBuilderState(),
      listSiteVersions({ limit: PAGE_SIZE, offset: 0 })
    ]);
    operationRef.current = null;
    setLoading(false);
    if (!builder.success) {
      toast.error(builder.message);
      return;
    }
    applyRemoteState(builder);
    if (history.success) {
      setVersions(Array.isArray(history.versions) ? history.versions : []);
      setHasMoreVersions(history.hasMore === true);
    } else {
      toast.error(history.message);
    }
  }, [applyRemoteState, isPro]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!hasLocalChanges) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasLocalChanges]);

  if (!isPro) return null;
  if (loading && !workingDocument) return <section className="ui-card ecom-builder-shell" aria-live="polite">Cargando constructor…</section>;
  if (!workingDocument) return <section className="ui-card ecom-builder-shell"><p>No se pudo cargar el borrador.</p><button type="button" className="btn btn-secondary" onClick={load}><RefreshCw size={16} />Reintentar</button></section>;

  const save = async () => {
    if (operationRef.current || !hasLocalChanges || !documentValidation.valid) return;
    operationRef.current = 'save';
    setSaving(true);
    const document = clone(documentValidation.document);
    const result = await saveSiteDraft({ expectedRevision: remoteState.draft.revision, document });
    if (!result.success) {
      operationRef.current = null;
      setSaving(false);
      if (result.code === 'ECOMMERCE_SITE_DRAFT_CONFLICT') setConflict(true);
      toast.error(result.message);
      return;
    }
    const confirmed = migrateEcommerceSiteDocument(result.draft?.document || document, { templateCode: portal?.templateCode });
    setSavedDocument(clone(confirmed));
    setWorkingDocument(clone(confirmed));
    setRemoteState((current) => ({ ...current, draft: { ...current.draft, ...result.draft }, hasUnpublishedChanges: true }));
    setConflict(false);
    const refreshed = await getSiteBuilderState();
    if (refreshed.success && Number(refreshed.draft?.revision) >= Number(result.draft?.revision)) applyRemoteState(refreshed);
    operationRef.current = null;
    setSaving(false);
    toast.success('Borrador guardado.');
  };

  const publish = async () => {
    if (hasLocalChanges) {
      toast.error('Guarda el borrador antes de publicarlo.');
      return;
    }
    if (operationRef.current) return;
    operationRef.current = 'publish';
    setPublishing(true);
    const result = await publishSiteDraft();
    operationRef.current = null;
    setPublishing(false);
    if (!result.success) {
      toast.error(result.message);
      return;
    }
    toast.success(result.idempotent ? 'La versión publicada ya está vigente.' : 'Sitio publicado.');
    const builder = await getSiteBuilderState();
    if (builder.success) applyRemoteState(builder);
    await loadFirstPage();
  };

  const restore = async (versionId) => {
    if (operationRef.current) return;
    if (hasLocalChanges && !window.confirm('Tus cambios locales serán reemplazados. ¿Deseas restaurar esta versión?')) return;
    operationRef.current = `restore:${versionId}`;
    setRestoringVersionId(versionId);
    const result = await restoreSiteVersion(versionId);
    operationRef.current = null;
    setRestoringVersionId(null);
    if (!result.success) {
      toast.error(result.message);
      return;
    }
    const builder = await getSiteBuilderState();
    if (builder.success) applyRemoteState(builder);
    toast.success('La versión se restauró como borrador. Revísala y publícala cuando esté lista.');
  };

  const loadMoreVersions = async () => {
    if (operationRef.current) return;
    operationRef.current = 'history';
    setLoadingMore(true);
    const result = await listSiteVersions({ limit: PAGE_SIZE, offset: versions.length });
    operationRef.current = null;
    setLoadingMore(false);
    if (!result.success) {
      toast.error(result.message);
      return;
    }
    setVersions((current) => [...current, ...(Array.isArray(result.versions) ? result.versions : [])]);
    setHasMoreVersions(result.hasMore === true);
  };

  const reloadRemote = () => {
    if (hasLocalChanges && !window.confirm('Se descartarán tus cambios locales. ¿Deseas recargar el borrador remoto?')) return;
    setConflict(false);
    void load();
  };
  const reset = () => {
    if (hasLocalChanges && !window.confirm('Se reemplazarán tus cambios locales por el diseño base. ¿Deseas continuar?')) return;
    setWorkingDocument(resetDocumentToPreset(workingDocument, portal?.templateCode));
  };

  return (
    <section className="ui-card ecom-builder-shell" aria-labelledby="site-builder-title">
      <div className="ecom-admin-card-heading"><div><span className="ecom-admin-eyebrow">Constructor del sitio</span><h2 id="site-builder-title">Editor visual del borrador</h2></div><button type="button" className="btn btn-secondary" onClick={reloadRemote} disabled={busy}><RefreshCw size={16} />Actualizar</button></div>
      <EcommerceSiteBuilderStatus hasLocalChanges={hasLocalChanges} hasUnpublishedChanges={remoteState?.hasUnpublishedChanges === true} conflict={conflict} />
      {conflict ? <div className="ecom-builder-conflict"><button type="button" className="btn btn-secondary" onClick={reloadRemote}>Recargar borrador remoto</button><button type="button" className="btn btn-secondary" onClick={() => setConflict(false)}>Conservar mis cambios</button></div> : null}
      <div className="ecom-builder-main"><EcommerceSiteBuilderControls document={workingDocument} disabled={busy} onDensity={(value) => setWorkingDocument((current) => setGlobalDensity(current, value))} onLayout={(type, value) => setWorkingDocument((current) => setSectionLayout(current, type, value))} onCatalogVisibility={(property, value) => setWorkingDocument((current) => setCatalogVisibility(current, property, value))} onMove={(id, direction) => setWorkingDocument((current) => moveSection(current, id, direction))} onReset={reset} /><EcommerceSiteBuilderPreview document={workingDocument} viewport={previewViewport} onViewport={setPreviewViewport} portal={portal} /></div>
      <div className="ecom-builder-actions"><span>Revisión del borrador: <strong>{remoteState?.draft?.revision ?? '—'}</strong></span><button type="button" className="btn btn-secondary" onClick={save} disabled={!hasLocalChanges || !documentValidation.valid || busy}><Save size={16} />{saving ? 'Guardando…' : 'Guardar borrador'}</button><button type="button" className="btn btn-primary" onClick={publish} disabled={!remoteState || busy}><Send size={16} />{publishing ? 'Publicando…' : 'Publicar'}</button></div>
      <EcommerceSiteBuilderHistory versions={versions} publishedVersionId={remoteState?.published?.versionId} hasMore={hasMoreVersions} loadingMore={loadingMore} restoringVersionId={restoringVersionId} disabled={saving || publishing} onRestore={restore} onLoadMore={loadMoreVersions} />
    </section>
  );
}
