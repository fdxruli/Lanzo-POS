import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Monitor, Smartphone, X } from 'lucide-react';
import EcommerceSiteBuilderPreview from './EcommerceSiteBuilderPreview';
import './EcommerceSiteBuilderPreviewModal.css';

const isMobileViewport = () => (
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(max-width: 640px)').matches
);

const canCloseFromBackdrop = () => (
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(min-width: 641px)').matches
);

export default function EcommerceSiteBuilderPreviewModal({ document: siteDocument, portal, onClose }) {
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const previousFocusRef = useRef(null);
  const [viewport, setViewport] = useState(() => (isMobileViewport() ? 'mobile' : 'desktop'));

  useEffect(() => {
    previousFocusRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus?.();
    };
  }, [onClose]);

  const closeFromBackdrop = (event) => {
    if (event.target === event.currentTarget && canCloseFromBackdrop()) onClose();
  };

  const modal = (
    <div className="ecom-builder-preview-modal-backdrop" onMouseDown={closeFromBackdrop}>
      <section
        className="ecom-builder-preview-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ecom-builder-preview-modal-title"
      >
        <header className="ecom-builder-preview-modal__toolbar">
          <div className="ecom-builder-preview-modal__title"><h2 id="ecom-builder-preview-modal-title">Vista previa del portal</h2></div>
          <div className="ecom-builder-preview-modal__actions">
            <div className="ecom-builder-preview-modal__viewport-controls" aria-label="Tamaño de vista previa">
              <button type="button" className="btn btn-secondary" aria-pressed={viewport === 'mobile'} onClick={() => setViewport('mobile')}><Smartphone size={16} />Móvil</button>
              <button type="button" className="btn btn-secondary" aria-pressed={viewport === 'desktop'} onClick={() => setViewport('desktop')}><Monitor size={16} />Escritorio</button>
            </div>
            <button type="button" className="ecom-admin-icon-button" ref={closeButtonRef} onClick={onClose} aria-label="Cerrar vista previa"><X size={20} /></button>
          </div>
        </header>
        <div className="ecom-builder-preview-modal__content">
          <EcommerceSiteBuilderPreview document={siteDocument} portal={portal} viewport={viewport} />
        </div>
      </section>
    </div>
  );

  return createPortal(modal, document.body);
}
