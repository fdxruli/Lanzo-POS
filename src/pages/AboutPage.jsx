import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Bug,
  Check,
  CheckCircle2,
  Coffee,
  Globe2,
  Lightbulb,
  Mail,
  MessageCircle,
  Settings,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { useActorRuntimeSnapshot } from '../services/auth/useActorRuntimeSnapshot';
import { useSettingsAccess } from '../services/auth/useSettingsAccess';
import { canReadSalesReports } from '../services/auth/salesPermissionPolicy';
import { getCommercialAIAgentAccessState } from '../services/auth/aiAgentAuthorization';
import { evaluateEcommercePortalAccess } from './settingsPageAccess';
import ContactModal from '../components/common/ContactModal';
import Logo from '../components/common/Logo';
import { APP_BUILD_DATE_LABEL, APP_VERSION, APP_VERSION_LABEL } from '../config/appVersion';
import {
  getPlanFeaturesFromLicenseDetails,
  isCloudPosSyncEnabled,
} from '../services/sync/syncConstants';
import {
  buildSupportEmailPayload,
  buildSupportMailtoUrl
} from '../services/support/supportContact';
import {
  createTelegramContact,
  TELEGRAM_CONTACT_BASE_URL,
  TELEGRAM_CONTACT_INTENT
} from '../services/support/telegramContact';
import {
  ABOUT_LICENSE_STATE,
  resolveAboutContactActions,
  resolveAboutLicenseState
} from './aboutTelegramActions';
import AboutLocalExperience from './AboutLocalExperience';
import './AboutPage.css';
import './AboutLocalExperience.css';

const FACEBOOK_URL = 'https://www.facebook.com/100087646261018';

const EMPTY_CONTACT_MODAL = {
  show: false,
  type: '',
  title: '',
  fields: [],
  description: ''
};

const getDeviceLimitFromLicense = (licenseDetails = {}, isCloudPlan = false) => {
  const features = getPlanFeaturesFromLicenseDetails(licenseDetails);
  const deviceLimit = Number(
    features?.max_devices ||
    licenseDetails?.max_devices ||
    licenseDetails?.details?.max_devices ||
    (isCloudPlan ? 5 : 1)
  );

  return Number.isFinite(deviceLimit) && deviceLimit > 0
    ? deviceLimit
    : (isCloudPlan ? 5 : 1);
};

const buildContactDescription = (type, formData) => {
  const device = formData.device || navigator.userAgent;

  if (type === 'bug') {
    return [
      'ACCION QUE REALIZABA:',
      formData.action || '[No especificado]',
      '',
      'QUE PASO:',
      formData.error || '[No especificado]',
      '',
      'INFORMACION DEL DISPOSITIVO:',
      device,
      '',
      'Build: ' + APP_BUILD_DATE_LABEL
    ].join('\n');
  }

  return [
    'MI IDEA:',
    formData.idea || '[No especificado]',
    '',
    'BENEFICIO:',
    formData.benefit || '[No especificado]',
    '',
    'INFORMACION ADICIONAL:',
    'Dispositivo: ' + navigator.userAgent,
    'Build: ' + APP_BUILD_DATE_LABEL
  ].join('\n');
};

export default function AboutPage() {
  const licenseDetails = useAppStore(state => state.licenseDetails);
  const licenseStatus = useAppStore(state => state.licenseStatus);
  const companyProfile = useAppStore(state => state.companyProfile);
  const canAccess = useAppStore(state => state.canAccess);
  const currentDeviceRole = useAppStore(state => state.currentDeviceRole);
  const actorRuntime = useActorRuntimeSnapshot();
  const settingsAccess = useSettingsAccess();
  const canReadReports = canReadSalesReports(actorRuntime);
  const commercialAIAgentAccess = getCommercialAIAgentAccessState({
    licenseDetails,
    actorSnapshot: actorRuntime
  });
  const canManageEcommercePortal = evaluateEcommercePortalAccess({
    canAccess,
    currentDeviceRole,
    licenseDetails
  });
  const [selectedWorkflow, setSelectedWorkflow] = useState('');
  const [contactModal, setContactModal] = useState(EMPTY_CONTACT_MODAL);
  const [telegramPreview, setTelegramPreview] = useState(null);
  const telegramDialogRef = useRef(null);
  const telegramCloseButtonRef = useRef(null);
  const telegramTriggerRef = useRef(null);

  const isCloudPlan = isCloudPosSyncEnabled(licenseDetails);
  const aboutLicenseState = resolveAboutLicenseState({
    licenseDetails,
    licenseStatus,
    isCloudPlan
  });
  const currentPlanName = aboutLicenseState === ABOUT_LICENSE_STATE.UNKNOWN
    ? 'Por confirmar'
    : isCloudPlan ? 'Lanzo Nube' : 'Lanzo Local';
  const isAuthorizedCommercialAdmin = (
    settingsAccess.isAuthorizedActor === true
    && settingsAccess.isAdmin === true
    && settingsAccess.actorType === 'admin'
    && actorRuntime.status === 'granted'
    && actorRuntime.actorType === 'admin'
  );
  const contactActions = resolveAboutContactActions({
    licenseState: aboutLicenseState,
    selectedWorkflow,
    isAuthorizedCommercialAdmin
  });
  const canShowCloudTools = [
    ABOUT_LICENSE_STATE.CLOUD_ACTIVE,
    ABOUT_LICENSE_STATE.CLOUD_GRACE
  ].includes(aboutLicenseState);
  const currentDeviceLimit = getDeviceLimitFromLicense(licenseDetails, isCloudPlan);
  const proTools = [
    {
      id: 'ai',
      to: '/agentes-ia',
      title: 'Agentes IA',
      description: 'Ventas, rentabilidad y estrategia comercial.',
      icon: Sparkles,
      available: commercialAIAgentAccess.canEnter
    },
    {
      id: 'reports',
      to: '/ventas',
      title: 'Reportes',
      description: 'Consulta resultados y comportamiento de ventas.',
      icon: TrendingUp,
      available: canReadReports
    },
    {
      id: 'online-store',
      to: '/portal-online',
      title: 'Portal online',
      description: 'Configura tu tienda, catálogo y horarios.',
      icon: Globe2,
      available: canManageEcommercePortal
    },
    {
      id: 'settings',
      to: '/configuracion',
      title: 'Configuración',
      description: 'Gestiona preferencias y datos del negocio.',
      icon: Settings,
      available: settingsAccess.canEnterSettings
    }
  ].filter(tool => tool.available);

  const licensePresentation = {
    [ABOUT_LICENSE_STATE.LOCAL_ACTIVE]: {
      eyebrow: 'LANZO POS',
      summary: 'Tu punto de venta funciona en este equipo y puedes seguir vendiendo, incluso sin internet.',
      statusLabel: 'Activo'
    },
    [ABOUT_LICENSE_STATE.CLOUD_ACTIVE]: {
      eyebrow: 'LANZO NUBE ACTIVO',
      summary: `Tu licencia incluye sincronización y hasta ${currentDeviceLimit} dispositivos.`,
      statusLabel: 'Activo'
    },
    [ABOUT_LICENSE_STATE.CLOUD_GRACE]: {
      eyebrow: 'ESTADO DE LANZO NUBE',
      summary: 'Tu plan está en periodo de gracia. Puedes consultar la continuidad del servicio.',
      statusLabel: 'Periodo de gracia'
    },
    [ABOUT_LICENSE_STATE.CLOUD_EXPIRED]: {
      eyebrow: 'ESTADO DE LANZO NUBE',
      summary: 'La licencia aparece vencida. El administrador puede consultar si existe una opción de reactivación.',
      statusLabel: 'Vencido'
    },
    [ABOUT_LICENSE_STATE.UNKNOWN]: {
      eyebrow: 'ESTADO DEL PLAN',
      summary: 'No podemos confirmar el estado de tu plan con la información disponible. Contacta a soporte para revisarlo.',
      statusLabel: 'Por confirmar'
    }
  }[aboutLicenseState];

  useEffect(() => {
    if (!telegramPreview) return undefined;

    const dialog = telegramDialogRef.current;
    const previousFocus = document.activeElement;
    telegramCloseButtonRef.current?.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setTelegramPreview(null);
        return;
      }

      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll(
        'button:not([disabled]), a[href], textarea:not([disabled])'
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

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const trigger = telegramTriggerRef.current;
      const focusTarget = trigger?.isConnected ? trigger : previousFocus;
      telegramTriggerRef.current = null;
      if (focusTarget && typeof focusTarget.focus === 'function' && focusTarget.isConnected) {
        focusTarget.focus();
      }
    };
  }, [telegramPreview]);

  const closeContactModal = () => setContactModal(EMPTY_CONTACT_MODAL);

  const handleOpenContactModal = (type) => {
    if (type === 'bug') {
      setContactModal({
        show: true,
        type: 'bug',
        title: 'Reportar un problema',
        description: 'Cuéntanos qué salió mal para poder solucionarlo rápidamente.',
        fields: [
          {
            id: 'action',
            label: '¿Qué estabas haciendo?',
            type: 'textarea',
            placeholder: 'Ej: Estaba creando un nuevo producto...',
            rows: 3
          },
          {
            id: 'error',
            label: '¿Qué error ocurrió?',
            type: 'textarea',
            placeholder: 'Ej: La app se cerró de repente o apareció un mensaje de error...',
            rows: 3
          },
          {
            id: 'device',
            label: 'Tu dispositivo',
            type: 'input',
            placeholder: 'Ej: iPhone 13, Android Samsung o Windows PC',
            hint: 'Esto nos ayuda a reproducir el problema.'
          }
        ]
      });
      return;
    }

    setContactModal({
      show: true,
      type: 'feature',
      title: 'Sugerir una función',
      description: 'Tus ideas nos ayudan a hacer Lanzo mejor cada día.',
      fields: [
        {
          id: 'idea',
          label: '¿Cuál es tu idea?',
          type: 'textarea',
          placeholder: 'Ej: Me gustaría poder exportar reportes en PDF...',
          rows: 4
        },
        {
          id: 'benefit',
          label: '¿Cómo te ayudaría esto?',
          type: 'textarea',
          placeholder: 'Ej: Podría enviar reportes a mis clientes más fácilmente...',
          rows: 3,
          hint: 'Ayúdanos a entender el valor de tu sugerencia.'
        }
      ]
    });
  };

  const handleSubmitContact = (formData) => {
    const issueType = contactModal.type === 'bug'
      ? 'Reporte de error [' + APP_VERSION + ']'
      : 'Sugerencia de funcion';
    const payload = buildSupportEmailPayload({
      licenseDetails,
      companyProfile,
      appVersion: APP_VERSION_LABEL,
      issueType,
      description: buildContactDescription(contactModal.type, formData)
    });

    window.location.href = buildSupportMailtoUrl(payload);
  };

  const handleOpenTelegramPreview = (action, triggerElement) => {
    if (action?.kind !== 'telegram') return;

    telegramTriggerRef.current = triggerElement || document.activeElement;

    const contact = createTelegramContact(action.intent, {
      isAuthorizedCommercialAdmin,
      licenseState: aboutLicenseState,
      planName: currentPlanName,
      workMode: selectedWorkflow,
      businessName: companyProfile?.name
        || companyProfile?.business_name
        || companyProfile?.commercial_name
    });

    setTelegramPreview({ ...contact, label: action.label });
  };

  const renderContactAction = (action, className) => {
    if (!action) return null;

    if (action.kind === 'anchor') {
      return (
        <a className={className} href={action.href} key={action.label}>
          {action.label}
          <ArrowRight size={17} aria-hidden="true" />
        </a>
      );
    }

    return (
      <button
        className={className}
        type="button"
        key={action.label}
        onClick={(event) => handleOpenTelegramPreview(action, event.currentTarget)}
      >
        {action.label}
        <ArrowRight size={17} aria-hidden="true" />
      </button>
    );
  };

  return (
    <main className={`about-redesign${aboutLicenseState === ABOUT_LICENSE_STATE.LOCAL_ACTIVE ? ' about-redesign--local' : ''}`} aria-labelledby="about-title">
      <header className="about-redesign__header">
        <div>
          <p className="about-redesign__eyebrow">{licensePresentation.eyebrow}</p>
          <h1 id="about-title">Acerca de</h1>
          <p className="about-redesign__intro">
            {aboutLicenseState === ABOUT_LICENSE_STATE.CLOUD_ACTIVE
              ? 'Accede a las herramientas disponibles para tu negocio.'
              : aboutLicenseState === ABOUT_LICENSE_STATE.LOCAL_ACTIVE
                ? 'Conoce tu plan actual y descubre todo lo que puedes hacer con Lanzo.'
                : licensePresentation.summary}
          </p>
        </div>
        <div className="about-redesign__brand">
          <Logo className="about-redesign__logo" showBusinessName={false} />
          <span>Versión {APP_VERSION}</span>
        </div>
      </header>

      {aboutLicenseState !== ABOUT_LICENSE_STATE.LOCAL_ACTIVE && (
      <section className="about-redesign__current" aria-label="Tu plan actual">
        <div className="about-redesign__current-icon" aria-hidden="true">
          <CheckCircle2 size={21} />
        </div>
        <div className="about-redesign__current-copy">
          <p>Tu plan actual · <strong>{currentPlanName}</strong></p>
          <span>{licensePresentation.summary}</span>
        </div>
        <span className={`about-redesign__current-badge about-redesign__current-badge--${aboutLicenseState}`}>
          {[
            ABOUT_LICENSE_STATE.LOCAL_ACTIVE,
            ABOUT_LICENSE_STATE.CLOUD_ACTIVE
          ].includes(aboutLicenseState) && <Check size={14} aria-hidden="true" />}
          {licensePresentation.statusLabel}
        </span>
      </section>

      )}

      {aboutLicenseState === ABOUT_LICENSE_STATE.LOCAL_ACTIVE ? (
        <AboutLocalExperience
          licenseDetails={licenseDetails}
          businessTypes={companyProfile?.business_type}
          selectedWorkflow={selectedWorkflow}
          onSelectWorkflow={setSelectedWorkflow}
          contactActions={contactActions}
          renderContactAction={renderContactAction}
          canReadReports={canReadReports}
        />
      ) : isCloudPlan ? (
        <>
          {canShowCloudTools && (
            <section className="about-redesign__pro-tools" aria-labelledby="about-pro-tools-title">
              <header className="about-redesign__pro-heading">
                <div>
                  <p className="about-redesign__eyebrow">TU PLAN EN ACCIÓN</p>
                  <h2 id="about-pro-tools-title">Atajos de Lanzo Nube</h2>
                  <p>Abre las herramientas disponibles para tu rol sin volver a comparar planes.</p>
                </div>
                <span className="about-redesign__pro-badge">
                  {aboutLicenseState === ABOUT_LICENSE_STATE.CLOUD_ACTIVE
                    ? <><CheckCircle2 size={15} aria-hidden="true" /> Nube activa</>
                    : 'Periodo de gracia'}
                </span>
              </header>

              {proTools.length > 0 ? (
                <nav className="about-redesign__pro-grid" aria-label="Herramientas de Lanzo Nube">
                  {proTools.map(({ id, to, title, description, icon: Icon }) => (
                    <Link className="about-redesign__pro-link" to={to} key={id}>
                      <span className="about-redesign__pro-icon" aria-hidden="true">
                        <Icon size={21} />
                      </span>
                      <span className="about-redesign__pro-copy">
                        <strong>{title}</strong>
                        <span>{description}</span>
                      </span>
                      <ArrowRight size={17} aria-hidden="true" />
                    </Link>
                  ))}
                </nav>
              ) : (
                <p className="about-redesign__pro-empty">
                  Los accesos dependen de los permisos de tu usuario. Si esperabas ver una herramienta, pide al administrador del negocio que revise tus permisos.
                </p>
              )}
            </section>
          )}

          <section className="about-redesign__contact-actions" aria-label="Contacto según el estado del plan">
            <div>
              <p className="about-redesign__eyebrow">CONTACTO Y AYUDA</p>
              <h2>{aboutLicenseState === ABOUT_LICENSE_STATE.CLOUD_ACTIVE
                ? '¿Necesitas ayuda con Lanzo Nube?'
                : aboutLicenseState === ABOUT_LICENSE_STATE.CLOUD_GRACE
                  ? '¿Quieres confirmar la continuidad de tu plan?'
                  : aboutLicenseState === ABOUT_LICENSE_STATE.CLOUD_EXPIRED
                    ? 'Consulta las opciones para tu servicio'
                    : 'Revisemos el estado de tu plan'}</h2>
              <p>
                {isAuthorizedCommercialAdmin
                  ? 'El contacto es asistido. Revisa el borrador y confirma en Telegram si deseas continuar.'
                  : 'Puedes contactar al equipo de soporte. Las opciones comerciales están disponibles para el administrador autorizado.'}
              </p>
            </div>
            <div className="about-redesign__contact-action-buttons">
              {renderContactAction(contactActions.primary, 'about-redesign__primary-button')}
              {contactActions.secondary && renderContactAction(
                contactActions.secondary,
                'about-redesign__secondary-button'
              )}
            </div>
          </section>
        </>
      ) : (
        <section className="about-redesign__status-help" aria-labelledby="about-status-help-title">
          <div>
            <p className="about-redesign__eyebrow">AYUDA CON TU PLAN</p>
            <h2 id="about-status-help-title">Confirma el estado de tu servicio</h2>
            <p>{licensePresentation.summary}</p>
          </div>
          {renderContactAction(contactActions.primary, 'about-redesign__primary-button')}
        </section>
      )}

      <section className="about-redesign__lower" aria-label="Historia y ayuda">
        <article className="about-redesign__story">
          <div className="about-redesign__lower-icon" aria-hidden="true"><Coffee size={20} /></div>
          <div>
            <p className="about-redesign__lower-eyebrow">UNA HISTORIA DE ENTRE ALAS</p>
            <h2>Herramientas creadas desde la operación real.</h2>
            <p>
              Entre Alas nació como un negocio de alimentos. Al vivir los retos del día a día, creamos herramientas para resolverlos y hoy las compartimos con otros negocios.
            </p>
            <a href={FACEBOOK_URL} target="_blank" rel="noopener noreferrer">
              Conoce Entre Alas <ArrowRight size={16} aria-hidden="true" />
            </a>
          </div>
        </article>

        <article className="about-redesign__help">
          <div className="about-redesign__lower-icon about-redesign__lower-icon--help" aria-hidden="true">
            <Mail size={20} />
          </div>
          <div>
            <p className="about-redesign__lower-eyebrow">ESTAMOS PARA AYUDAR</p>
            <h2>¿Encontraste un problema o tienes una idea?</h2>
            <p>Escríbenos o cuéntanos desde aquí. Tu experiencia ayuda a mejorar Lanzo.</p>
            <div className="about-redesign__help-actions">
              <button
                type="button"
                onClick={(event) => handleOpenTelegramPreview({
                  kind: 'telegram',
                  intent: TELEGRAM_CONTACT_INTENT.GENERAL_SUPPORT,
                  label: 'Preparar mensaje para Telegram'
                }, event.currentTarget)}
              >
                <MessageCircle size={16} aria-hidden="true" /> Preparar mensaje para Telegram
              </button>
              <button type="button" onClick={() => handleOpenContactModal('bug')}>
                <Bug size={16} aria-hidden="true" /> Reportar problema
              </button>
              <button type="button" onClick={() => handleOpenContactModal('feature')}>
                <Lightbulb size={16} aria-hidden="true" /> Sugerir mejora
              </button>
            </div>
          </div>
        </article>
      </section>

      <footer className="about-redesign__footer">
        <span>Lanzo POS · {APP_VERSION_LABEL}</span>
        <span>Build {APP_BUILD_DATE_LABEL}</span>
      </footer>

      {telegramPreview && (
        <div className="about-telegram-dialog-backdrop">
          <section
            className="about-telegram-dialog"
            ref={telegramDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-telegram-dialog-title"
            aria-describedby="about-telegram-dialog-description"
            tabIndex={-1}
          >
            <button
              className="about-telegram-dialog__close"
              type="button"
              ref={telegramCloseButtonRef}
              onClick={() => setTelegramPreview(null)}
              aria-label="Cerrar vista previa"
            >
              ×
            </button>
            <p className="about-redesign__eyebrow">VISTA PREVIA DE TELEGRAM</p>
            <h2 id="about-telegram-dialog-title">Revisa el mensaje antes de continuar</h2>
            <p id="about-telegram-dialog-description">
              Se abrirán las opciones oficiales para compartir el texto. Telegram te pedirá elegir un destinatario y podrás revisar o editar el mensaje antes de enviarlo. Abrir Telegram no confirma su recepción.
            </p>
            <p>
              @{telegramPreview.username} es el canal público de Lanzo. No pudimos verificar que tenga mensajes directos habilitados, así que este enlace no se presenta como un chat de soporte.
              {' '}<a href={TELEGRAM_CONTACT_BASE_URL} target="_blank" rel="noopener noreferrer">Abrir canal oficial como referencia</a>.
            </p>
            <label className="about-telegram-dialog__message-label" htmlFor="about-telegram-message">
              Mensaje para revisar antes de compartir
            </label>
            <textarea
              id="about-telegram-message"
              className="about-telegram-dialog__message"
              value={telegramPreview.message}
              readOnly
              rows={8}
              spellCheck="false"
            />
            <div className="about-telegram-dialog__actions">
              <button
                className="about-redesign__secondary-button"
                type="button"
                onClick={() => setTelegramPreview(null)}
              >
                Volver
              </button>
              <a
                className="about-redesign__primary-button"
                href={telegramPreview.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Abrir opciones para compartir el mensaje en Telegram en una nueva pestaña"
                onClick={() => setTelegramPreview(null)}
              >
                Abrir opciones de Telegram
                <ArrowRight size={17} aria-hidden="true" />
              </a>
            </div>
          </section>
        </div>
      )}

      {contactModal.show && (
        <ContactModal
          key={contactModal.type}
          show={contactModal.show}
          onClose={closeContactModal}
          onSubmit={handleSubmitContact}
          title={contactModal.title}
          description={contactModal.description}
          fields={contactModal.fields}
          submitLabel="Generar correo"
        />
      )}
    </main>
  );
}
