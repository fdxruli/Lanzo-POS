import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle, FileText, Loader2, Shield } from 'lucide-react';
import { acceptLegalTerms, fetchLegalTerms } from '../../services/supabase';
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
    fetchType: 'terms_of_use'
  },
  {
    type: 'privacy_policy',
    label: 'Aviso de privacidad',
    description: 'Datos tratados por Lanzo y finalidades.',
    fetchType: 'privacy_policy'
  },
  {
    type: 'ai_policy',
    label: 'Lía e inteligencia artificial',
    description: 'Qué se comparte cuando solicitas un análisis.',
    fetchType: null
  },
  {
    type: 'payment_policy',
    label: 'Pagos y suscripciones',
    description: 'Precio, periodos y forma de pago.',
    fetchType: null
  },
  {
    type: 'refund_policy',
    label: 'Cancelaciones y reembolsos',
    description: 'Cómo pedir una revisión de pago.',
    fetchType: null
  },
  {
    type: 'legal_notice',
    label: 'Aviso legal',
    description: 'Identidad del proveedor y alcance del servicio.',
    fetchType: null
  }
]);

const TERMS_ONLY = Object.freeze([LEGAL_DOCUMENT_TYPES[0]]);

function getDocumentStatusLabel(document, status) {
  if (!document?.fetchType) return 'En preparación';
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
  initialDocumentType = 'terms_of_use'
}) {
  const documentCatalog = useMemo(() => {
    const source = Array.isArray(documentTypes) ? documentTypes : TERMS_ONLY;
    return source
      .map((item) => (
        typeof item === 'string'
          ? LEGAL_DOCUMENT_TYPES.find((document) => document.type === item)
          : item
      ))
      .filter(Boolean);
  }, [documentTypes]);

  const [activeDocumentType, setActiveDocumentType] = useState(initialDocumentType);
  const [documentDataByType, setDocumentDataByType] = useState({});
  const [loadStateByType, setLoadStateByType] = useState({});
  const [accepting, setAccepting] = useState(false);
  const loadStateRef = useRef({});
  const inFlightRef = useRef(new Map());
  const requestGenerationRef = useRef(0);

  const updateLoadState = useCallback((type, status) => {
    loadStateRef.current = { ...loadStateRef.current, [type]: status };
    setLoadStateByType((current) => ({ ...current, [type]: status }));
  }, []);

  const loadDocument = useCallback(async (type, { force = false } = {}) => {
    const document = documentCatalog.find((item) => item.type === type);
    if (!document?.fetchType) return;

    const existingRequest = inFlightRef.current.get(type);
    if (existingRequest && !force) return existingRequest;

    const currentStatus = loadStateRef.current[type];
    if (!force && (currentStatus === 'loaded' || currentStatus === 'missing')) return;

    updateLoadState(type, 'loading');
    const generation = requestGenerationRef.current;
    const request = fetchLegalTerms(document.fetchType)
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
  }, [documentCatalog, updateLoadState]);

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

  const activeDocument = documentCatalog.find((item) => item.type === activeDocumentType)
    || documentCatalog[0]
    || LEGAL_DOCUMENT_TYPES[0];
  const activeData = documentDataByType[activeDocument.type] || null;
  const activeLoadState = activeDocument.fetchType
    ? (loadStateByType[activeDocument.type] || 'idle')
    : 'pending';
  const hasDocumentIndex = showDocumentIndex && documentCatalog.length > 1;

  const handleSelectDocument = (type) => {
    setActiveDocumentType(type);
    void loadDocument(type);
  };

  const handleAccept = async () => {
    if (activeDocument.type !== 'terms_of_use') return;

    const storedData = localStorage.getItem('lanzo_license');
    let licenseKey = null;

    if (storedData) {
      try {
        const parsed = JSON.parse(storedData);
        licenseKey = parsed?.data?.license_key;
      } catch (err) {
        Logger.warn('No se pudo leer la licencia almacenada para aceptar términos.', err);
      }
    }

    const termsData = documentDataByType.terms_of_use;
    if (!licenseKey || !termsData?.id) {
      onClose();
      return;
    }

    setAccepting(true);
    const result = await acceptLegalTerms(licenseKey, termsData.id);
    setAccepting(false);

    if (result.success || result.message === 'ALREADY_ACCEPTED') {
      onClose();
    } else {
      showMessageModal('Hubo un error registrando tu aceptación.', null, { type: 'error' });
    }
  };

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
                {isUpdateNotification ? 'Actualización de condiciones' : activeDocument.label}
              </h3>
            </div>
          </div>

          {activeData && <span className="terms-version-badge">Versión {activeData.version}</span>}
        </div>

        {hasDocumentIndex && (
          <nav className="terms-document-nav" aria-label="Políticas y avisos">
            {documentCatalog.map((document) => {
              const status = getDocumentStatusLabel(document, loadStateByType[document.type]);
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
          {isUpdateNotification && activeDocument.type === 'terms_of_use' && !['idle', 'loading'].includes(activeLoadState) && (
            <div className="ui-alert ui-alert--info terms-update-alert">
              Hemos actualizado las condiciones. Al continuar usando el sistema, aceptas la versión vigente.
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

              {!readOnly && activeDocument.type === 'terms_of_use' && (
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
        </div>

        <div className="ui-modal__actions terms-footer">
          {readOnly ? (
            <button type="button" className="ui-button ui-button--secondary ui-button--block btn btn-secondary" onClick={onClose}>
              Cerrar
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
          ) : isUpdateNotification ? (
            <button
              type="button"
              className="ui-button ui-button--primary ui-button--block btn btn-primary"
              onClick={handleAccept}
              disabled={activeLoadState !== 'loaded' || !activeData?.id || accepting}
            >
              {accepting ? 'Guardando...' : 'Entendido, continuar'}
            </button>
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
