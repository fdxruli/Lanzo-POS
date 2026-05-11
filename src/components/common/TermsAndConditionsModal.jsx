import React, { useState, useEffect, useMemo } from 'react';
import { X, Shield, CheckCircle, Loader2, AlertCircle } from 'lucide-react'; 
import { fetchLegalTerms, acceptLegalTerms } from '../../services/supabase'; 
import Logger from '../../services/Logger';
import './TermsAndConditionsModal.css';

// 🔒 SEGURIDAD: Sanitizador de HTML para prevenir XSS.
// Usa una whitelist estricta de tags y atributos permitidos.
// Para máxima protección, instalar DOMPurify: npm install dompurify
// y reemplazar esta función por: import DOMPurify from 'dompurify'; → DOMPurify.sanitize(html)
const ALLOWED_TAGS = new Set([
  'h1','h2','h3','h4','h5','h6','p','br','hr','ul','ol','li',
  'strong','em','b','i','u','s','del','ins','mark','small','sub','sup',
  'a','span','div','section','article','header','footer','nav','main',
  'table','thead','tbody','tfoot','tr','th','td','caption','colgroup','col',
  'blockquote','pre','code','abbr','address','cite','q','dfn','time',
  'details','summary','figure','figcaption','dl','dt','dd'
]);

const ALLOWED_ATTRS = new Set([
  'href','title','class','id','style','target','rel',
  'colspan','rowspan','scope','headers','align','valign',
  'datetime','cite','lang','dir','role','aria-label','aria-describedby'
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

      // Fase 1: Recolectar nodos peligrosos
      let current = walker.nextNode();
      while (current) {
        const tagName = current.tagName.toLowerCase();

        if (!ALLOWED_TAGS.has(tagName)) {
          nodesToRemove.push(current);
          current = walker.nextNode();
          continue;
        }

        // Limpiar atributos peligrosos
        const attrs = Array.from(current.attributes);
        for (const attr of attrs) {
          const attrName = attr.name.toLowerCase();

          // Eliminar event handlers (onclick, onerror, onload, etc.)
          if (attrName.startsWith('on')) {
            current.removeAttribute(attr.name);
            continue;
          }

          // Eliminar atributos no permitidos
          if (!ALLOWED_ATTRS.has(attrName)) {
            current.removeAttribute(attr.name);
            continue;
          }

          // Sanitizar URLs en href y src
          if ((attrName === 'href' || attrName === 'src') && DANGEROUS_URL_PATTERN.test(attr.value)) {
            current.removeAttribute(attr.name);
          }
        }

        // Forzar target=_blank y rel=noopener en links
        if (tagName === 'a') {
          current.setAttribute('target', '_blank');
          current.setAttribute('rel', 'noopener noreferrer');
        }

        current = walker.nextNode();
      }

      // Fase 2: Remover nodos peligrosos (reemplazar con su texto plano)
      for (const node of nodesToRemove) {
        const textContent = doc.createTextNode(node.textContent || '');
        node.parentNode?.replaceChild(textContent, node);
      }
    };

    cleanNode(doc.body);
    return doc.body.innerHTML;
  } catch (error) {
    Logger.error('Error sanitizando HTML de términos legales:', error);
    // Fallback seguro: devolver solo texto plano
    const div = document.createElement('div');
    div.textContent = dirtyHTML;
    return div.innerHTML;
  }
}

// Agregamos el prop 'readOnly' por defecto en false, pero lo usaremos en true casi siempre
export default function TermsAndConditionsModal({ isOpen, onClose, readOnly = false, isUpdateNotification = false }) {
  const [termsData, setTermsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen) {
      loadTerms();
    }
  }, [isOpen]);

  const loadTerms = async () => {
    setLoading(true);
    setError(null);
    try {
        const data = await fetchLegalTerms('terms_of_use');
        if (data) {
            setTermsData(data);
        } else {
            setError("No se pudieron cargar los términos. Verifique su conexión.");
        }
    } catch (err) {
        Logger.error("Error fetching terms", err);
        setError("Error de conexión al obtener los términos legales.");
    } finally {
        setLoading(false);
    }
  };

  const handleAccept = async () => {
    const storedData = localStorage.getItem('lanzo_license');
    let licenseKey = null;
    if (storedData) {
      try {
        const parsed = JSON.parse(storedData);
        licenseKey = parsed?.data?.license_key;
      } catch (e) {}
    }
    if (!licenseKey || !termsData?.id) { onClose(); return; }

    setAccepting(true);
    const result = await acceptLegalTerms(licenseKey, termsData.id);
    setAccepting(false);

    if (result.success || result.message === 'ALREADY_ACCEPTED') {
      onClose();
    } else {
      alert("Hubo un error registrando tu aceptación.");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="terms-modal-overlay" role="dialog" aria-modal="true">
      <div className="terms-modal-content">
        
        {/* Header */}
        <div className="terms-header">
          <div className="terms-title-group">
            <Shield size={20} className="text-primary" /> 
            <div>
                <h3>{isUpdateNotification ? "Actualización de Condiciones" : "Términos de Uso"}</h3>
                {termsData && <span className="terms-version-badge">NUEVA VERSIÓN {termsData.version}</span>}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="terms-body">
            {isUpdateNotification && !loading && (
                <div style={{
                    background: '#e0f2fe', 
                    color: '#0369a1', 
                    padding: '10px', 
                    borderRadius: '6px',
                    marginBottom: '10px',
                    fontSize: '0.9rem'
                }}>
                    Hemos actualizado nuestros términos. Al continuar utilizando el sistema, aceptas las nuevas condiciones.
                </div>
            )}
            {loading ? (
                <div className="terms-loading-state">
                    <Loader2 size={48} className="animate-spin text-primary" />
                    <p>Obteniendo documento legal...</p>
                </div>
            ) : error ? (
                <div className="terms-error-state">
                    <AlertCircle size={48} className="text-destructive" />
                    <p>{error}</p>
                </div>
            ) : (
                <div className="terms-document-wrapper">
                    <div className="terms-dynamic-content" dangerouslySetInnerHTML={{ __html: sanitizeHTML(termsData.content_html) }} />
                    
                    {/* Solo mostramos el texto legal del footer si NO es solo lectura */}
                    {!readOnly && (
                        <p className="terms-legal-footer">
                            <CheckCircle size={14} style={{display:'inline', marginRight: 5}} />
                            Al aceptar, te vinculas legalmente a este acuerdo.
                        </p>
                    )}
                </div>
            )}
        </div>

        {/* Footer condicional */}
        <div className="terms-footer">
          {readOnly ? (
             <button className="btn btn-secondary" onClick={onClose} style={{width: '100%'}}>Cerrar</button>
          ) : (
             <>
                {/* En modo actualización, solo mostramos UN botón principal */}
                {isUpdateNotification ? (
                    <button 
                        className="btn btn-primary" 
                        onClick={handleAccept} 
                        disabled={loading || !!error || accepting}
                        style={{width: '100%'}}
                    >
                        {accepting ? "Guardando..." : "Entendido, continuar"}
                    </button>
                ) : (
                    /* Modo Clásico (Checkbox / Aceptar explícito) */
                    <>
                        <button className="btn btn-secondary" onClick={onClose} disabled={accepting}>Cancelar</button>
                        <button className="btn btn-primary btn-accept-terms" onClick={handleAccept} disabled={loading || !!error || accepting}>
                            {accepting ? "Procesando..." : "Aceptar Condiciones"}
                        </button>
                    </>
                )}
             </>
          )}
        </div>
      </div>
    </div>
  );
}