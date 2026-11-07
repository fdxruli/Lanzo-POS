import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, HelpCircle, Mail, MessageCircle, X } from 'lucide-react';
import { buildSupportMailtoUrl, copyTextToClipboard, getSupportEmail } from '../../services/support/supportContact';
import { buildTelegramSupportTarget } from '../../services/support/telegramContact';
import './PreloginSupportAccess.css';

// Callers supply a fixed screen label only. No account, device or error context.
export default function PreloginSupportAccess({ screen, children, modal = false }) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const id = useId();
  const trigger = useRef(null);
  const dialogRef = useRef(null);
  const email = getSupportEmail();
  const telegram = buildTelegramSupportTarget();
  const body = `Hola equipo de LANZO,\n\nNecesito orientación con LANZO POS.\nPantalla: ${screen}.`;
  const emailUrl = buildSupportMailtoUrl({
    to: email,
    subject: `[Soporte LANZO POS] ${screen}`,
    body
  });

  useEffect(() => {
    if (!modal || !open || !dialogRef.current?.showModal) return;
    if (!dialogRef.current.open) dialogRef.current.showModal();
  }, [modal, open]);

  const close = () => {
    if (modal && dialogRef.current?.open) dialogRef.current.close();
    setOpen(false);
    trigger.current?.focus();
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

  const panel = (
    <section id={id} className="prelogin-support__panel" hidden={!modal && !open} aria-label="Soporte oficial de LANZO">
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
      {!modal && <button type="button" className="ui-button ui-button--ghost" onClick={close}>Cerrar soporte</button>}
    </section>
  );

  return (
    <div className="prelogin-support" onKeyDown={(event) => {
      if (!modal && open && event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    }}>
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
          Soporte
        </button>
      </div>
      {modal ? (
        open && createPortal(
          <dialog
            ref={dialogRef}
            className="prelogin-support__dialog"
            aria-labelledby={`${id}-dialog-title`}
            onCancel={(event) => {
              event.preventDefault();
              close();
            }}
            onClose={() => {
              setOpen(false);
              trigger.current?.focus();
            }}
          >
            <header className="prelogin-support__dialog-header">
              <h2 id={`${id}-dialog-title`}>Soporte LANZO</h2>
              <button type="button" aria-label="Cerrar soporte" onClick={close}>
                <X size={20} aria-hidden="true" />
              </button>
            </header>
            {panel}
          </dialog>,
          document.body
        )
      ) : panel}
    </div>
  );
}
