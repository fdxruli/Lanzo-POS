import { useEffect, useId, useRef, useState } from 'react';
import { Copy, HelpCircle, Mail, MessageCircle, X } from 'lucide-react';
import { buildSupportMailtoUrl, copyTextToClipboard, getSupportEmail } from '../../services/support/supportContact';
import { buildTelegramSupportTarget } from '../../services/support/telegramContact';
import './PreloginSupportAccess.css';

// Callers supply a fixed screen label only. No account, device or error context.
export default function PreloginSupportAccess({ screen, children, presentation = 'panel', triggerLabel = 'Soporte' }) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const id = useId();
  const trigger = useRef(null);
  const dialog = useRef(null);
  const dialogHeading = useRef(null);
  const closeButton = useRef(null);
  const email = getSupportEmail();
  const telegram = buildTelegramSupportTarget();
  const body = `Hola equipo de LANZO,\n\nNecesito orientación con LANZO POS.\nPantalla: ${screen}.`;
  const emailUrl = buildSupportMailtoUrl({
    to: email,
    subject: `[Soporte LANZO POS] ${screen}`,
    body
  });

  const close = () => {
    setOpen(false);
    setFeedback('');
    trigger.current?.focus();
  };

  useEffect(() => {
    if (!open || presentation !== 'dialog') return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame(() => dialogHeading.current?.focus())
      : null;
    if (frame === null) dialogHeading.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (frame !== null && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [open, presentation]);

  const handleDialogKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') return;

    const buttons = Array.from(dialog.current?.querySelectorAll('button:not(:disabled)') || []);
    if (!buttons.length) {
      event.preventDefault();
      dialogHeading.current?.focus();
      return;
    }

    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    const active = document.activeElement;
    const focusIsOutside = !dialog.current?.contains(active);
    if (event.shiftKey && (active === first || active === dialogHeading.current || focusIsOutside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || active === dialogHeading.current || focusIsOutside)) {
      event.preventDefault();
      first.focus();
    }
  };

  const copyEmail = async (event) => {
    const button = event.currentTarget;
    let copied = false;
    try {
      copied = await copyTextToClipboard(email);
    } catch {
      // The address remains selectable even when clipboard access is denied.
    }
    setFeedback(copied
      ? 'Correo copiado. Aún no se ha enviado ningún mensaje.'
      : 'No se pudo copiar. Selecciona y copia la dirección visible.');
    if (document.activeElement === document.body && button.isConnected) button.focus();
  };

  const supportContent = (
    <>
      <p>Puedes consultar soporte sin salir de este proceso. No incluyas contraseñas, licencias ni información sensible al escribir tu mensaje.</p>
      <div className="prelogin-support__channels">
        <div>
          <h2><Mail size={17} aria-hidden="true" /> Correo electrónico</h2>
          <p className="prelogin-support__email">{email}</p>
          <div className="prelogin-support__actions">
            <button type="button" className="ui-button ui-button--ghost" onClick={copyEmail}>
              <Copy size={16} aria-hidden="true" /> Copiar correo
            </button>
            <a className="ui-button ui-button--secondary" href={emailUrl}>Abrir borrador de correo</a>
          </div>
          <p>Abrir el borrador no envía el mensaje. Si no tienes una aplicación de correo configurada, copia la dirección y escribe desde tu correo habitual.</p>
          <details>
            <summary>Ver contenido del borrador</summary>
            <p className="prelogin-support__preview">{body}</p>
          </details>
        </div>
        <div>
          <h2><MessageCircle size={17} aria-hidden="true" /> Telegram</h2>
          <p>@{telegram.username} es el canal oficial de referencia pública. No se ha verificado que reciba mensajes privados. Abrirlo no envía una solicitud a soporte.</p>
          <a className="ui-button ui-button--secondary" href={telegram.url} target="_blank" rel="noopener noreferrer">Abrir canal oficial (nueva pestaña)</a>
        </div>
      </div>
      <p role="status" aria-live="polite">{feedback}</p>
    </>
  );

  return (
    <div
      className={`prelogin-support${presentation === 'dialog' ? ' prelogin-support--dialog' : ''}`}
      onKeyDown={(event) => {
        if (presentation === 'panel' && open && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <div className="prelogin-support__actions">
        {children}
        <button
          ref={trigger}
          type="button"
          className="ui-button ui-button--ghost"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => {
            setOpen(!open);
            setFeedback('');
          }}
        >
          <HelpCircle size={17} aria-hidden="true" />
          {triggerLabel}
        </button>
      </div>
      {presentation === 'dialog' ? (open && (
        <div className="prelogin-support__backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) close();
        }}>
          <section
            id={id}
            ref={dialog}
            className="prelogin-support__panel prelogin-support__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${id}-title`}
            onKeyDownCapture={handleDialogKeyDown}
          >
            <header className="prelogin-support__dialog-header">
              <h2 id={`${id}-title`} ref={dialogHeading} tabIndex={-1}>Soporte oficial de LANZO</h2>
              <button
                ref={closeButton}
                type="button"
                className="prelogin-support__close"
                onClick={close}
                aria-label="Cerrar cuadro de soporte"
              >
                <X size={19} aria-hidden="true" />
              </button>
            </header>
            {supportContent}
            <button type="button" className="ui-button ui-button--ghost" onClick={close}>Cerrar soporte</button>
          </section>
        </div>
      )) : (
        <section id={id} className="prelogin-support__panel" hidden={!open} aria-label="Soporte oficial de LANZO">
          {supportContent}
          <button type="button" className="ui-button ui-button--ghost" onClick={close}>Cerrar soporte</button>
        </section>
      )}
    </div>
  );
}
