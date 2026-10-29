import { useEffect, useId, useRef, useState } from 'react';
import { CheckCheck, Copy, Mail, MessageCircle } from 'lucide-react';
import {
  buildIncidentSupportMessage,
  getSafeIncidentSupportDetails,
  MAX_INCIDENT_SUPPORT_DESCRIPTION_CODEPOINTS
} from '../../services/diagnostics/incidentCommunication';
import {
  buildSupportMailtoUrl,
  copyTextToClipboard,
  getSupportEmail
} from '../../services/support/supportContact';
import { buildTelegramSupportTarget, TELEGRAM_USERNAME } from '../../services/support/telegramContact';
import './IncidentReportForm.css';

const getOnlineState = () => {
  try {
    return globalThis.navigator?.onLine !== false;
  } catch {
    return true;
  }
};

const isContextCurrent = (guard) => {
  try {
    return typeof guard === 'function' && guard() === true;
  } catch {
    return false;
  }
};

const limitDescription = (value) => (
  Array.from(String(value || '')).slice(0, MAX_INCIDENT_SUPPORT_DESCRIPTION_CODEPOINTS).join('')
);

export default function IncidentSupportContactForm({
  incident,
  isContextCurrent: isContextCurrentProp = null,
  services = null,
  headingId
}) {
  const id = useId().replace(/:/g, '');
  const generatedHeadingId = `incident-support-contact-heading-${id}`;
  const descriptionId = `incident-support-description-${id}`;
  const privacyId = `incident-support-privacy-${id}`;
  const previewId = `incident-support-preview-${id}`;
  const previewHelpId = `incident-support-preview-help-${id}`;
  const channelGroupName = `incident-support-channel-${id}`;
  const headingRef = useRef(null);
  const regionRef = useRef(null);
  const messageFieldRef = useRef(null);
  const openingContextGuard = useRef(isContextCurrentProp);
  const currentIncidentId = incident?.incident_id || '';
  const [description, setDescription] = useState('');
  const [includeDescription, setIncludeDescription] = useState(false);
  const [channel, setChannel] = useState('telegram');
  const [preparedMessage, setPreparedMessage] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [contextReady, setContextReady] = useState(typeof isContextCurrentProp === 'function');
  const onlineState = services?.getOnlineState || getOnlineState;
  const [online, setOnline] = useState(() => onlineState() !== false);
  const copyText = services?.copyText || copyTextToClipboard;
  const supportEmail = services?.supportEmail || getSupportEmail();
  const telegramTarget = buildTelegramSupportTarget();
  const safeDetails = getSafeIncidentSupportDetails(incident);

  useEffect(() => {
    let active = true;
    if (typeof isContextCurrentProp === 'function') {
      openingContextGuard.current = isContextCurrentProp;
      setContextReady(true);
      return () => { active = false; };
    }

    setContextReady(false);
    import('../../services/diagnostics/recoveryContext')
      .then(({ createRecoveryContextGuard }) => {
        if (!active) return;
        openingContextGuard.current = createRecoveryContextGuard();
        setContextReady(true);
      })
      .catch(() => {
        if (!active) return;
        openingContextGuard.current = () => false;
        setContextReady(true);
      });

    return () => { active = false; };
  }, [currentIncidentId, isContextCurrentProp]);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    globalThis.addEventListener?.('online', handleOnline);
    globalThis.addEventListener?.('offline', handleOffline);
    return () => {
      globalThis.removeEventListener?.('online', handleOnline);
      globalThis.removeEventListener?.('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    setDescription('');
    setIncludeDescription(false);
    setChannel('telegram');
    setPreparedMessage(null);
    setFeedback('');
  }, [currentIncidentId]);

  useEffect(() => {
    const heading = headingRef.current;
    if (!heading) return;
    const focusTimer = globalThis.setTimeout(() => {
      heading.focus({ preventScroll: true });
      const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      regionRef.current?.scrollIntoView?.({
        block: 'start',
        behavior: reducedMotion ? 'auto' : 'smooth'
      });
    }, 0);
    return () => globalThis.clearTimeout(focusTimer);
  }, []);

  const currentGuard = typeof isContextCurrentProp === 'function'
    ? isContextCurrentProp
    : openingContextGuard.current;
  const contextIsCurrent = contextReady && isContextCurrent(currentGuard);
  const preparedIsCurrent = Boolean(
    preparedMessage
    && preparedMessage.incidentId === currentIncidentId
    && isContextCurrent(preparedMessage.guard)
    && contextIsCurrent
  );
  const currentPreparedMessage = preparedIsCurrent ? preparedMessage : null;
  const telegramUrl = currentPreparedMessage
    ? telegramTarget.url
    : '';
  const emailUrl = currentPreparedMessage
    ? buildSupportMailtoUrl({
      to: supportEmail,
      subject: 'Ayuda con un problema en Lanzo POS',
      body: currentPreparedMessage.message
    })
    : '';
  const descriptionLength = Array.from(description).length;

  useEffect(() => {
    if (!preparedMessage || preparedIsCurrent) return;
    setPreparedMessage(null);
    setFeedback('El negocio o la sesión cambió. Prepara un mensaje nuevo desde el contexto actual.');
  }, [preparedIsCurrent, preparedMessage]);

  const rejectStaleContext = () => {
    setPreparedMessage(null);
    setFeedback('El negocio o la sesión cambió. Prepara un mensaje nuevo desde el contexto actual.');
  };

  const handlePrepareMessage = () => {
    const guard = currentGuard;
    if (!contextReady || !isContextCurrent(guard)) {
      rejectStaleContext();
      return;
    }

    const options = { incident, description, includeDescription };
    const message = typeof services?.buildSupportMessage === 'function'
      ? services.buildSupportMessage(options)
      : buildIncidentSupportMessage(options);
    if (typeof message !== 'string' || !message.trim()) {
      setPreparedMessage(null);
      setFeedback('No se pudo preparar el mensaje. Puedes volver a intentarlo.');
      return;
    }

    setPreparedMessage({ incidentId: currentIncidentId, message, guard });
    setFeedback('Revisa el mensaje completo antes de copiarlo o abrir una aplicación.');
  };

  const handleCopyMessage = async () => {
    if (!currentPreparedMessage || !isContextCurrent(currentPreparedMessage.guard)) {
      rejectStaleContext();
      return;
    }

    let copied = false;
    try {
      copied = await copyText(currentPreparedMessage.message) === true;
    } catch {
      copied = false;
    }

    if (!isContextCurrent(currentPreparedMessage.guard) || !isContextCurrent(currentGuard)) {
      rejectStaleContext();
      return;
    }

    if (copied) {
      setFeedback('Mensaje copiado. Todavía no se ha enviado; revísalo y compártelo manualmente.');
      return;
    }

    setFeedback('No se pudo copiar automáticamente. Selecciona el texto de la vista previa y cópialo manualmente.');
    messageFieldRef.current?.focus();
    messageFieldRef.current?.select();
  };

  const handleExternalAction = (event) => {
    if (!currentPreparedMessage || !isContextCurrent(currentPreparedMessage.guard) || !isContextCurrent(currentGuard)) {
      event.preventDefault();
      rejectStaleContext();
      return;
    }

    if (channel === 'email' && typeof services?.inspectEmail === 'function') {
      event.preventDefault();
      services.inspectEmail(emailUrl);
      setFeedback('Borrador inspeccionado localmente. No se abrió ni envió correo.');
      return;
    }

    setFeedback(channel === 'telegram'
      ? 'Se abrirá el canal público de Lanzo como referencia. Copiar el mensaje o abrir el canal no lo entrega; usa correo electrónico para contactar a soporte.'
      : 'Se abrirá un borrador de correo. Revísalo y envíalo desde tu aplicación; abrirlo no confirma el envío.');
  };

  if (!incident) return null;

  return (
    <section
      ref={regionRef}
      className="incident-support-contact"
      role="region"
      aria-labelledby={headingId || generatedHeadingId}
    >
      <header className="incident-support-contact__heading">
        <div>
          <h2 id={headingId || generatedHeadingId} ref={headingRef} tabIndex={-1}>
            Reportar un problema
          </h2>
          <p>Puedes preparar un resumen para revisar, copiarlo o abrir el canal público de Lanzo como referencia. El correo electrónico sigue disponible para contactar a soporte.</p>
        </div>
      </header>

      <p className="incident-support-contact__code">
        <span>Código del problema</span>
        <code>{safeDetails.code}</code>
      </p>

      <div className="incident-support-contact__fields">
        <div className="incident-support-contact__description">
          <label htmlFor={descriptionId}>Describe qué ocurrió</label>
          <p id={privacyId} className="incident-support-contact__privacy">
            Es texto libre y no se limpia automáticamente. No incluyas contraseñas, información de clientes ni datos financieros. Se queda en esta pantalla hasta que decidas incluirlo y compartirlo.
          </p>
          <textarea
            id={descriptionId}
            value={description}
            onChange={(event) => {
              setDescription(limitDescription(event.target.value));
              setPreparedMessage(null);
              setFeedback('');
            }}
            maxLength={MAX_INCIDENT_SUPPORT_DESCRIPTION_CODEPOINTS * 2}
            rows={4}
            aria-describedby={`${privacyId} incident-support-count-${id}`}
            placeholder="Cuéntanos qué estabas haciendo cuando apareció el problema."
          />
          <div className="incident-support-contact__description-meta">
            <label className="incident-support-contact__include">
              <input
                type="checkbox"
                checked={includeDescription}
                onChange={(event) => {
                  setIncludeDescription(event.target.checked);
                  setPreparedMessage(null);
                  setFeedback('');
                }}
              />
              <span>Incluir esta descripción en el borrador</span>
            </label>
            <span id={`incident-support-count-${id}`} aria-live="off">
              {descriptionLength}/{MAX_INCIDENT_SUPPORT_DESCRIPTION_CODEPOINTS}
            </span>
          </div>
        </div>

        <div className="incident-support-contact__channels">
          <fieldset>
            <legend>Elige cómo preparar el mensaje</legend>
            <label className="incident-support-contact__channel">
              <input
                type="radio"
                name={channelGroupName}
                value="telegram"
                checked={channel === 'telegram'}
                onChange={() => setChannel('telegram')}
              />
              <span>
                <strong>Telegram</strong>
                <span>Copia el mensaje; el canal público es una referencia, no un chat de soporte verificado.</span>
              </span>
            </label>
            <label className="incident-support-contact__channel">
              <input
                type="radio"
                name={channelGroupName}
                value="email"
                checked={channel === 'email'}
                onChange={() => setChannel('email')}
              />
              <span>
                <strong>Correo electrónico</strong>
                <span>Prepara un borrador y envíalo desde tu aplicación de correo.</span>
              </span>
            </label>
          </fieldset>

          {channel === 'telegram' && (
            <p className="incident-support-contact__channel-note">
              @{TELEGRAM_USERNAME} es un canal público de referencia. No se ha verificado un chat privado de soporte ni que este canal reciba mensajes directos. Copiar o abrir el canal no entrega el diagnóstico; para enviarlo a soporte, elige correo electrónico.
            </p>
          )}

          {!online && (
            <p className="incident-support-contact__offline" role="note">
              Sin conexión: puedes preparar y copiar el mensaje. Abrir una aplicación externa puede requerir internet.
            </p>
          )}

          <button
            type="button"
            className="ui-button ui-button--primary"
            onClick={handlePrepareMessage}
            disabled={!contextReady}
          >
            {channel === 'telegram' ? <MessageCircle size={17} aria-hidden="true" /> : <Mail size={17} aria-hidden="true" />}
            Preparar mensaje
          </button>
        </div>
      </div>

      {currentPreparedMessage && (
        <section className="incident-support-contact__preview" aria-labelledby={`${previewId}-heading`}>
          <div>
            <h3 id={`${previewId}-heading`}>Vista previa del mensaje</h3>
          <p id={previewHelpId}>Revisa todo el contenido antes de copiarlo. Copiar o abrir una aplicación no confirma que el mensaje se haya recibido.</p>
          </div>
          <label className="incident-support-contact__preview-label" htmlFor={previewId}>
            Mensaje preparado para revisar
          </label>
          <textarea
            ref={messageFieldRef}
            id={previewId}
            className="incident-support-contact__preview-field"
            value={currentPreparedMessage.message}
            readOnly
            rows={10}
            aria-describedby={previewHelpId}
          />
          <div className="incident-support-contact__actions">
            <button type="button" className="ui-button ui-button--ghost" onClick={handleCopyMessage}>
              {feedback.startsWith('Mensaje copiado')
                ? <CheckCheck size={17} aria-hidden="true" />
                : <Copy size={17} aria-hidden="true" />}
              Copiar mensaje
            </button>
            {channel === 'telegram' ? (
              <a
                className="ui-button ui-button--secondary incident-support-contact__external-link"
                href={telegramUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleExternalAction}
              >
                <MessageCircle size={17} aria-hidden="true" />
                Abrir canal oficial
              </a>
            ) : (
              <a
                className="ui-button ui-button--secondary incident-support-contact__external-link"
                href={emailUrl}
                onClick={handleExternalAction}
              >
                <Mail size={17} aria-hidden="true" />
                {typeof services?.inspectEmail === 'function' ? 'Inspeccionar borrador local' : 'Abrir correo'}
              </a>
            )}
          </div>
          {channel === 'telegram' && (
            <p className="incident-support-contact__channel-note">
              Si Telegram no se abre, copia el mensaje o cambia a correo electrónico. El canal se abrirá como referencia pública, no como confirmación de contacto.
            </p>
          )}
        </section>
      )}

      <p className="incident-support-contact__feedback" role="status" aria-live="polite">
        {feedback}
      </p>
    </section>
  );
}
