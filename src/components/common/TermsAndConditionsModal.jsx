import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle, FileText, Loader2, Shield } from 'lucide-react';
import { acceptLegalTerms, fetchAcceptedLegalDocument, fetchLegalPolicyPreview, fetchLegalPolicyState, fetchLegalTerms, isLegalPolicyPreviewEnabled } from '../../services/supabase';
import Logger from '../../services/Logger';
import { showMessageModal } from '../../services/utils';
import './TermsAndConditionsModal.css';

const ALLOWED_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'ul', 'ol', 'li',
  'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins', 'mark', 'small', 'sub', 'sup',
  'a', 'span', 'div', 'section', 'article', 'header', 'footer', 'nav', 'main',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'blockquote', 'pre', 'code', 'abbr', 'address', 'cite', 'q', 'dfn', 'time',
  'details', 'summary', 'figure', 'figcaption', 'dl', 'dt', 'dd'
]);

const ALLOWED_ATTRS = new Set([
  'href', 'title', 'class', 'id', 'style', 'target', 'rel',
  'colspan', 'rowspan', 'scope', 'headers', 'align', 'valign',
  'datetime', 'cite', 'lang', 'dir', 'role', 'aria-label', 'aria-describedby'
]);

const DANGEROUS_URL_PATTERN = /^\s*(javascript|data|vbscript)\s*:/i;

function readStoredLicenseKey() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const stored = localStorage.getItem('lanzo_license');
    const parsed = stored ? JSON.parse(stored) : null;
    return parsed?.data?.license_key || parsed?.license_key || null;
  } catch {
    return null;
  }
}

function escapeHtmlText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatLegalDate(value) {
  if (!value) return 'Fecha no disponible';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha no disponible';
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function makeLegalFilePart(value) {
  return String(value || 'documento')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'documento';
}

function sanitizeHTML(dirtyHTML) {
  if (!dirtyHTML || typeof dirtyHTML !== 'string') return '';

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(dirtyHTML, 'text/html');

    const cleanNode = (node) => {
      const walker = doc.createTreeWalker(node, NodeFilter.SHOW_ELEMENT);
      const nodesToRemove = [];
      let current = walker.nextNode();

      while (current) {
        const tagName = current.tagName.toLowerCase();

        if (!ALLOWED_TAGS.has(tagName)) {
          nodesToRemove.push(current);
          current = walker.nextNode();
          continue;
        }

        const attrs = Array.from(current.attributes);
        for (const attr of attrs) {
          const attrName = attr.name.toLowerCase();

          if (attrName.startsWith('on') || !ALLOWED_ATTRS.has(attrName)) {
            current.removeAttribute(attr.name);
            continue;
          }

          if ((attrName === 'href' || attrName === 'src') && DANGEROUS_URL_PATTERN.test(attr.value)) {
            current.removeAttribute(attr.name);
          }
        }

        if (tagName === 'a') {
          current.setAttribute('target', '_blank');
          current.setAttribute('rel', 'noopener noreferrer');
        }

        current = walker.nextNode();
      }

      for (const nodeToRemove of nodesToRemove) {
        const textContent = doc.createTextNode(nodeToRemove.textContent || '');
        nodeToRemove.parentNode?.replaceChild(textContent, nodeToRemove);
      }
    };

    cleanNode(doc.body);
    return doc.body.innerHTML;
  } catch (error) {
    Logger.error('Error sanitizando HTML de terminos legales:', error);
    const div = document.createElement('div');
    div.textContent = dirtyHTML;
    return div.innerHTML;
  }
}


export const LEGAL_DOCUMENT_TYPES = Object.freeze([
  {
    type: 'terms_of_use',
    label: 'Términos de uso',
    description: 'Condiciones para usar Lanzo POS.',
    fetchType: 'terms_of_use',
    previewType: 'terms_of_use'
  },
  {
    type: 'privacy_policy',
    label: 'Aviso de privacidad',
    description: 'Datos tratados por Lanzo y finalidades.',
    fetchType: 'privacy_policy',
    previewType: 'privacy_policy'
  },
  {
    type: 'ai_policy',
    label: 'Lía e inteligencia artificial',
    description: 'Qué se comparte cuando solicitas un análisis.',
    fetchType: 'ai_policy',
    previewType: 'ai_policy'
  },
  {
    type: 'payment_policy',
    label: 'Pagos y suscripciones',
    description: 'Precio, periodos y forma de pago.',
    fetchType: 'payment_policy',
    previewType: 'payment_policy'
  },
  {
    type: 'refund_policy',
    label: 'Cancelaciones y reembolsos',
    description: 'Cómo pedir una revisión de pago.',
    fetchType: 'refund_policy',
    previewType: 'refund_policy'
  },
  {
    type: 'legal_notice',
    label: 'Aviso legal',
    description: 'Identidad del proveedor y alcance del servicio.',
    fetchType: 'legal_notice',
    previewType: 'legal_notice'
  }
]);

const TERMS_ONLY = Object.freeze([LEGAL_DOCUMENT_TYPES[0]]);

function getDocumentStatusLabel(document, status, legalPreviewMode) {
  const canLoad = legalPreviewMode ? Boolean(document?.previewType) : Boolean(document?.fetchType);
  if (!canLoad) return 'En preparación';
  if (status === 'loaded') return 'Disponible';
  if (status === 'missing') return 'Sin versión activa';
  if (status === 'error') return 'No disponible';
  return '';
}

export default function TermsAndConditionsModal({
  isOpen,
  onClose,
  readOnly = false,
  isUpdateNotification = false,
  showDocumentIndex = false,
  documentTypes = TERMS_ONLY,
  initialDocumentType = 'terms_of_use',
  updateDocuments = [],
  updateCheckStatus = 'idle',
  legalPolicyState = null
}) {
  const documentCatalog = useMemo(() => {
    const source = isUpdateNotification
      ? LEGAL_DOCUMENT_TYPES
      : (Array.isArray(documentTypes) ? documentTypes : TERMS_ONLY);
    return source
      .map((item) => (
        typeof item === 'string'
          ? LEGAL_DOCUMENT_TYPES.find((document) => document.type === item)
          : item
      ))
      .filter(Boolean);
  }, [documentTypes, isUpdateNotification]);

  const legalPreviewMode = isLegalPolicyPreviewEnabled();
  const [activeDocumentType, setActiveDocumentType] = useState(initialDocumentType);
  const [documentDataByType, setDocumentDataByType] = useState({});
  const [loadStateByType, setLoadStateByType] = useState({});
  const [accepting, setAccepting] = useState(false);
  const [downloadingTermId, setDownloadingTermId] = useState(null);
  const [internalLegalPolicyState, setInternalLegalPolicyState] = useState(null);
  const loadStateRef = useRef({});
  const inFlightRef = useRef(new Map());
  const requestGenerationRef = useRef(0);

  const updateLoadState = useCallback((type, status) => {
    loadStateRef.current = { ...loadStateRef.current, [type]: status };
    setLoadStateByType((current) => ({ ...current, [type]: status }));
  }, []);

  const loadDocument = useCallback(async (type, { force = false } = {}) => {
    const document = documentCatalog.find((item) => item.type === type);
    const fetchDocument = legalPreviewMode && document?.previewType
      ? () => fetchLegalPolicyPreview(document.previewType)
      : document?.fetchType
        ? () => fetchLegalTerms(document.fetchType)
        : null;
    if (!fetchDocument) return;

    const existingRequest = inFlightRef.current.get(type);
    if (existingRequest && !force) return existingRequest;

    const currentStatus = loadStateRef.current[type];
    if (!force && (currentStatus === 'loaded' || currentStatus === 'missing')) return;

    updateLoadState(type, 'loading');
    const generation = requestGenerationRef.current;
    const request = fetchDocument()
      .then((data) => {
        if (requestGenerationRef.current !== generation) return;
        setDocumentDataByType((current) => ({ ...current, [type]: data || null }));
        updateLoadState(type, data ? 'loaded' : 'missing');
      })
      .catch((err) => {
        if (requestGenerationRef.current !== generation) return;
        Logger.error('Error obteniendo documento legal:', err);
        setDocumentDataByType((current) => ({ ...current, [type]: null }));
        updateLoadState(type, 'error');
      })
      .finally(() => {
        if (inFlightRef.current.get(type) === request) inFlightRef.current.delete(type);
      });

    inFlightRef.current.set(type, request);
    return request;
  }, [documentCatalog, legalPreviewMode, updateLoadState]);

  useEffect(() => {
    requestGenerationRef.current += 1;
    if (!isOpen) return;

    const initialDocument = documentCatalog.find((item) => item.type === initialDocumentType)
      || documentCatalog[0];
    if (!initialDocument) return;

    setActiveDocumentType(initialDocument.type);
    setDocumentDataByType({});
    setLoadStateByType({});
    loadStateRef.current = {};
    inFlightRef.current = new Map();
    void loadDocument(initialDocument.type, { force: true });
  }, [isOpen, initialDocumentType, documentCatalog, loadDocument]);

  useEffect(() => {
    if (!isOpen || legalPreviewMode || legalPolicyState) return undefined;

    const licenseKey = readStoredLicenseKey();
    if (!licenseKey) {
      setInternalLegalPolicyState({ status: 'unavailable', accepted_documents: [] });
      return undefined;
    }

    let cancelled = false;
    setInternalLegalPolicyState({
      status: 'loading',
      licenseKey,
      accepted_documents: []
    });

    fetchLegalPolicyState(licenseKey)
      .then((result) => {
        if (cancelled) return;
        setInternalLegalPolicyState(result?.success
          ? { ...result, status: 'ready', licenseKey }
          : { status: 'error', licenseKey, accepted_documents: [] });
      })
      .catch((error) => {
        if (cancelled) return;
        Logger.error('Error cargando historial de documentos legales:', error);
        setInternalLegalPolicyState({ status: 'error', licenseKey, accepted_documents: [] });
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, legalPreviewMode, legalPolicyState]);

  const currentLegalPolicyState = legalPolicyState || internalLegalPolicyState;
  const acceptanceHistory = Array.isArray(currentLegalPolicyState?.accepted_documents)
    ? currentLegalPolicyState.accepted_documents
    : [];
  const acceptanceHistoryStatus = currentLegalPolicyState?.status
    || (currentLegalPolicyState?.success ? 'ready' : 'loading');
  const pendingUpdateDocuments = Array.isArray(updateDocuments) && updateDocuments.length > 0
    ? updateDocuments
    : (Array.isArray(currentLegalPolicyState?.pending_documents)
      ? currentLegalPolicyState.pending_documents
      : []);

  const activeDocument = documentCatalog.find((item) => item.type === activeDocumentType)
    || documentCatalog[0]
    || LEGAL_DOCUMENT_TYPES[0];
  const activeData = documentDataByType[activeDocument.type] || null;
  const activeDocumentCanLoad = legalPreviewMode
    ? Boolean(activeDocument.previewType)
    : Boolean(activeDocument.fetchType);
  const activeLoadState = activeDocumentCanLoad
    ? (loadStateByType[activeDocument.type] || 'idle')
    : 'pending';
  const hasDocumentIndex = showDocumentIndex && documentCatalog.length > 1;

  const handleSelectDocument = (type) => {
    setActiveDocumentType(type);
    void loadDocument(type);
  };

  const handleAccept = async () => {
    if (legalPreviewMode) return;

    const licenseKey = readStoredLicenseKey();
    const termsData = documentDataByType.terms_of_use;
    const documentsToAccept = isUpdateNotification
      ? (pendingUpdateDocuments.length > 0
        ? pendingUpdateDocuments
        : (termsData?.id ? [termsData] : []))
      : (termsData?.id ? [termsData] : []);

    if (!licenseKey || documentsToAccept.length === 0) {
      showMessageModal('No se pudieron verificar los documentos y la licencia para registrar la aceptación.', null, { type: 'error' });
      return;
    }

    setAccepting(true);
    try {
      for (const legalDocument of documentsToAccept) {
        if (!legalDocument?.id) continue;
        const result = await acceptLegalTerms(licenseKey, legalDocument.id);
        if (!result?.success && result?.message !== 'ALREADY_ACCEPTED') {
          showMessageModal('No se pudo registrar la aceptación de todos los documentos. Revisa tu conexión e inténtalo de nuevo.', null, { type: 'error' });
          return;
        }
      }
      onClose();
    } catch (error) {
      Logger.error('Error registrando aceptación de documentos legales:', error);
      showMessageModal('No se pudo registrar la aceptación de todos los documentos. Revisa tu conexión e inténtalo de nuevo.', null, { type: 'error' });
    } finally {
      setAccepting(false);
    }
  };

  const handleDownloadAcceptedDocument = async (acceptance) => {
    const licenseKey = readStoredLicenseKey();
    const termId = acceptance?.term_id || acceptance?.id;
    if (!licenseKey || !termId) {
      showMessageModal('No se pudo verificar el documento aceptado para descargarlo.', null, { type: 'error' });
      return;
    }

    setDownloadingTermId(termId);
    try {
      const response = await fetchAcceptedLegalDocument(licenseKey, termId);
      const acceptedDocument = response?.success ? response.document : null;
      if (!acceptedDocument?.content_html) {
        throw new Error(response?.code || 'LEGAL_DOCUMENT_NOT_AVAILABLE');
      }

      const type = acceptedDocument.type || acceptance.term_type || acceptance.type;
      const documentMeta = LEGAL_DOCUMENT_TYPES.find((item) => item.type === type);
      const label = documentMeta?.label || 'Documento legal de Lanzo POS';
      const version = acceptedDocument.version || acceptance.term_version || acceptance.version || 'sin-version';
      const publishedAt = acceptedDocument.published_at || acceptance.term_published_at || acceptance.published_at;
      const fileHtml = `<!doctype html>
<html lang="es-MX">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtmlText(label)} — Lanzo POS — ${escapeHtmlText(version)}</title>
</head>
<body>
<header>
<h1>${escapeHtmlText(label)}</h1>
<p>Lanzo POS · Versión ${escapeHtmlText(version)}</p>
<p>Publicada: ${escapeHtmlText(formatLegalDate(publishedAt))}</p>
</header>
<main>${sanitizeHTML(acceptedDocument.content_html)}</main>
</body>
</html>`;

      const file = new Blob([fileHtml], { type: 'text/html;charset=utf-8' });
      const downloadUrl = URL.createObjectURL(file);
      const anchor = window.document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = `lanzo-${makeLegalFilePart(label)}-v${makeLegalFilePart(version)}.html`;
      anchor.style.display = 'none';
      window.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
    } catch (error) {
      Logger.error('Error descargando documento legal aceptado:', error);
      showMessageModal('No se pudo descargar el documento. Inténtalo de nuevo.', null, { type: 'error' });
    } finally {
      setDownloadingTermId(null);
    }
  };

  const updateDocumentsToDisplay = pendingUpdateDocuments.length > 0
    ? pendingUpdateDocuments
    : (documentDataByType.terms_of_use?.id ? [documentDataByType.terms_of_use] : []);
  const effectiveUpdateCheckStatus = updateCheckStatus === 'idle'
    ? (currentLegalPolicyState?.status || 'idle')
    : updateCheckStatus;
  const canAcceptUpdate = effectiveUpdateCheckStatus !== 'loading'
    && activeLoadState === 'loaded'
    && (pendingUpdateDocuments.length > 0 || Boolean(documentDataByType.terms_of_use?.id));


  if (!isOpen) return null;

  return (
    <dialog
      open
      className="ui-modal ui-modal--critical terms-modal-overlay"
      aria-labelledby="terms-modal-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className={`ui-modal__content ui-modal__content--md terms-modal-content${hasDocumentIndex ? ' terms-modal-content--with-index' : ''}`}>
        <div className="ui-modal__header terms-header">
          <div className="terms-title-group">
            <span className="terms-title-icon" aria-hidden="true">
              <Shield size={20} />
            </span>
            <div>
              <span className="terms-kicker">Legal</span>
              <h3 id="terms-modal-title">
                {isUpdateNotification ? 'Actualización de documentos legales' : activeDocument.label}
              </h3>
            </div>
          </div>

          {activeData && <span className="terms-version-badge">Versión {activeData.version}</span>}
        </div>

        {hasDocumentIndex && (
          <nav className="terms-document-nav" aria-label="Políticas y avisos">
            {documentCatalog.map((document) => {
              const status = getDocumentStatusLabel(document, loadStateByType[document.type], legalPreviewMode);
              return (
                <button
                  key={document.type}
                  type="button"
                  className="terms-document-option"
                  aria-current={document.type === activeDocument.type ? 'page' : undefined}
                  aria-label={status ? document.label + ', ' + status : document.label}
                  onClick={() => handleSelectDocument(document.type)}
                >
                  <span className="terms-document-option__label">{document.label}</span>
                  {status && <span className="terms-document-option__status">{status}</span>}
                </button>
              );
            })}
          </nav>
        )}

        <div className="ui-modal__body terms-body" aria-live="polite">
          {legalPreviewMode && (
            <div className="terms-draft-preview-banner" role="note">
              <strong>Vista previa de borradores</strong>
              <span>Documentos en revisión; no están vigentes ni publicados en producción.</span>
            </div>
          )}

          {!legalPreviewMode && isUpdateNotification && (
            <div className="ui-alert ui-alert--info terms-update-alert" role="status">
              {effectiveUpdateCheckStatus === 'loading' ? (
                <span>Verificando qué documentos necesitan tu aceptación...</span>
              ) : (
                <>
                  <strong>Se actualizaron o publicaron estos documentos:</strong>
                  {updateDocumentsToDisplay.length > 0 ? (
                    <ul className="terms-update-document-list">
                      {updateDocumentsToDisplay.map((legalDocument) => {
                        const documentMeta = LEGAL_DOCUMENT_TYPES.find((item) => item.type === (legalDocument.type || legalDocument.term_type));
                        return (
                          <li key={legalDocument.id || legalDocument.type}>
                            {documentMeta?.label || 'Documento legal'}{legalDocument.version ? ` · versión ${legalDocument.version}` : ''}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <span>Revisa los documentos vigentes antes de continuar.</span>
                  )}
                </>
              )}
            </div>
          )}

          {activeLoadState === 'idle' || activeLoadState === 'loading' ? (
            <div className="terms-loading-state" role="status">
              <Loader2 size={42} className="animate-spin text-primary" />
              <p>Cargando {activeDocument.label.toLowerCase()}...</p>
            </div>
          ) : activeLoadState === 'pending' ? (
            <div className="terms-empty-state">
              <FileText size={36} aria-hidden="true" />
              <h4>{activeDocument.label}</h4>
              <p>Este documento está en preparación y todavía no se ha publicado en Lanzo POS.</p>
            </div>
          ) : activeData ? (
            <div className="terms-document-wrapper">
              <div className="terms-dynamic-content" dangerouslySetInnerHTML={{ __html: sanitizeHTML(activeData.content_html) }} />

              {!legalPreviewMode && !readOnly && activeDocument.type === 'terms_of_use' && (
                <p className="terms-legal-footer">
                  <CheckCircle size={14} className="terms-legal-footer__icon" />
                  Al aceptar, aceptas los Términos de uso de esta versión.
                </p>
              )}
            </div>
          ) : activeLoadState === 'missing' ? (
            <div className="terms-empty-state">
              <FileText size={36} aria-hidden="true" />
              <h4>{activeDocument.label}</h4>
              <p>Este documento todavía no tiene una versión activa publicada.</p>
            </div>
          ) : (
            <div className="terms-empty-state">
              <AlertCircle size={36} aria-hidden="true" />
              <h4>{activeDocument.label}</h4>
              <p>No se pudo cargar este documento. Revisa tu conexión e inténtalo de nuevo.</p>
              <button
                type="button"
                className="ui-button ui-button--secondary terms-retry-button"
                onClick={() => void loadDocument(activeDocument.type, { force: true })}
              >
                Reintentar
              </button>
            </div>
          )}

          {hasDocumentIndex && !legalPreviewMode && (
            <section className="terms-accepted-history" aria-labelledby="terms-accepted-history-title">
              <div className="terms-accepted-history__heading">
                <h4 id="terms-accepted-history-title">Historial de documentos aceptados</h4>
                <p>Conserva la versión y la fecha de cada aceptación registrada para esta licencia.</p>
              </div>

              {acceptanceHistoryStatus === 'loading' ? (
                <p className="terms-accepted-history__state" role="status">Cargando historial...</p>
              ) : acceptanceHistoryStatus === 'error' || acceptanceHistoryStatus === 'unavailable' ? (
                <p className="terms-accepted-history__state" role="alert">
                  No se pudo cargar el historial. Revisa tu conexión y vuelve a abrir esta sección.
                </p>
              ) : acceptanceHistory.length === 0 ? (
                <p className="terms-accepted-history__state">Aún no hay documentos aceptados registrados.</p>
              ) : (
                <ul className="terms-accepted-history__list">
                  {acceptanceHistory.map((acceptance) => {
                    const type = acceptance.term_type || acceptance.type;
                    const documentMeta = LEGAL_DOCUMENT_TYPES.find((item) => item.type === type);
                    const documentLabel = documentMeta?.label || 'Documento legal';
                    const termId = acceptance.term_id || acceptance.id;
                    const termVersion = acceptance.term_version || acceptance.version || 'Versión no disponible';
                    return (
                      <li className="terms-accepted-history__item" key={termId}>
                        <div className="terms-accepted-history__details">
                          <strong>{documentLabel}</strong>
                          <span>Versión {termVersion}</span>
                          <time dateTime={acceptance.accepted_at || ''}>
                            Aceptado: {formatLegalDate(acceptance.accepted_at)}
                          </time>
                        </div>
                        <button
                          type="button"
                          className="ui-button ui-button--secondary terms-history-download"
                          aria-label={`Descargar ${documentLabel} versión ${termVersion}`}
                          onClick={() => void handleDownloadAcceptedDocument(acceptance)}
                          disabled={!termId || downloadingTermId === termId}
                        >
                          {downloadingTermId === termId ? 'Preparando...' : 'Descargar'}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
        </div>

        <div className="ui-modal__actions terms-footer">
          {readOnly || legalPreviewMode ? (
            <button type="button" className="ui-button ui-button--secondary ui-button--block btn btn-secondary" onClick={onClose}>
              Cerrar
            </button>
          ) : isUpdateNotification ? (
            <button
              type="button"
              className="ui-button ui-button--primary ui-button--block btn btn-primary"
              onClick={handleAccept}
              disabled={!canAcceptUpdate || accepting}
            >
              {accepting ? 'Registrando aceptación...' : 'Aceptar documentos actualizados y continuar'}
            </button>
          ) : activeDocument.type !== 'terms_of_use' ? (
            <>
              <button type="button" className="ui-button ui-button--ghost btn btn-secondary" onClick={onClose} disabled={accepting}>
                Cancelar
              </button>
              <button
                type="button"
                className="ui-button ui-button--primary btn btn-primary"
                onClick={() => handleSelectDocument('terms_of_use')}
                disabled={accepting}
              >
                Volver a términos de uso
              </button>
            </>
          ) : (
            <>
              <button type="button" className="ui-button ui-button--ghost btn btn-secondary" onClick={onClose} disabled={accepting}>
                Cancelar
              </button>
              <button
                type="button"
                className="ui-button ui-button--primary btn btn-primary btn-accept-terms"
                onClick={handleAccept}
                disabled={activeLoadState !== 'loaded' || !activeData?.id || accepting}
              >
                {accepting ? 'Procesando...' : 'Aceptar términos de uso'}
              </button>
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
