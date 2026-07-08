import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, Loader2, Shield } from 'lucide-react';
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

export default function TermsAndConditionsModal({ isOpen, onClose, readOnly = false, isUpdateNotification = false }) {
  const [termsData, setTermsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;

    const loadTerms = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchLegalTerms('terms_of_use');
        if (data) {
          setTermsData(data);
        } else {
          setError('No se pudieron cargar los terminos. Verifica tu conexion.');
        }
      } catch (err) {
        Logger.error('Error fetching terms', err);
        setError('Error de conexion al obtener los terminos legales.');
      } finally {
        setLoading(false);
      }
    };

    loadTerms();
  }, [isOpen]);

  const handleAccept = async () => {
    const storedData = localStorage.getItem('lanzo_license');
    let licenseKey = null;

    if (storedData) {
      try {
        const parsed = JSON.parse(storedData);
        licenseKey = parsed?.data?.license_key;
      } catch (err) {
        Logger.warn('No se pudo leer la licencia almacenada para aceptar terminos.', err);
      }
    }

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
      showMessageModal('Hubo un error registrando tu aceptacion.', null, { type: 'error' });
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
      <div className="ui-modal__content ui-modal__content--md terms-modal-content">
        <div className="ui-modal__header terms-header">
          <div className="terms-title-group">
            <span className="terms-title-icon" aria-hidden="true">
              <Shield size={20} />
            </span>
            <div>
              <span className="terms-kicker">Legal</span>
              <h3 id="terms-modal-title">
                {isUpdateNotification ? 'Actualizacion de condiciones' : 'Terminos de uso'}
              </h3>
            </div>
          </div>

          {termsData && <span className="terms-version-badge">Version {termsData.version}</span>}
        </div>

        <div className="ui-modal__body terms-body">
          {isUpdateNotification && !loading && (
            <div className="ui-alert ui-alert--info terms-update-alert">
              Hemos actualizado las condiciones. Al continuar usando el sistema, aceptas la version vigente.
            </div>
          )}

          {loading ? (
            <div className="terms-loading-state">
              <Loader2 size={42} className="animate-spin text-primary" />
              <p>Cargando documento legal...</p>
            </div>
          ) : error ? (
            <div className="terms-error-state">
              <AlertCircle size={42} className="text-destructive" />
              <p>{error}</p>
            </div>
          ) : (
            <div className="terms-document-wrapper">
              <div className="terms-dynamic-content" dangerouslySetInnerHTML={{ __html: sanitizeHTML(termsData.content_html) }} />

              {!readOnly && (
                <p className="terms-legal-footer">
                  <CheckCircle size={14} className="terms-legal-footer__icon" />
                  Al aceptar, te vinculas legalmente a este acuerdo.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="ui-modal__actions terms-footer">
          {readOnly ? (
            <button type="button" className="ui-button ui-button--secondary ui-button--block btn btn-secondary" onClick={onClose}>
              Cerrar
            </button>
          ) : isUpdateNotification ? (
            <button
              type="button"
              className="ui-button ui-button--primary ui-button--block btn btn-primary"
              onClick={handleAccept}
              disabled={loading || Boolean(error) || accepting}
            >
              {accepting ? 'Guardando...' : 'Entendido, continuar'}
            </button>
          ) : (
            <>
              <button type="button" className="ui-button ui-button--ghost btn btn-secondary" onClick={onClose} disabled={accepting}>
                Cancelar
              </button>
              <button type="button" className="ui-button ui-button--primary btn btn-primary btn-accept-terms" onClick={handleAccept} disabled={loading || Boolean(error) || accepting}>
                {accepting ? 'Procesando...' : 'Aceptar condiciones'}
              </button>
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
