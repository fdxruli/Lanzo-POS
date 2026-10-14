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
  Store,
  TrendingUp,
  Users,
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
import { createTelegramContact, TELEGRAM_CONTACT_INTENT } from '../services/support/telegramContact';
import {
  ABOUT_LICENSE_STATE,
  resolveAboutContactActions,
  resolveAboutLicenseState
} from './aboutTelegramActions';
import './AboutPage.css';

const FACEBOOK_URL = 'https://www.facebook.com/100087646261018';

const EMPTY_CONTACT_MODAL = {
  show: false,
  type: '',
  title: '',
  fields: [],
  description: ''
};

const WORKFLOWS = [
  {
    id: 'solo',
    title: 'Vendo desde un equipo',
    description: 'Uso Lanzo en una computadora o tablet, principalmente yo.',
    icon: Store
  },
  {
    id: 'team',
    title: 'Trabajo con un equipo',
    description: 'Varias personas venden y necesito ver todo sincronizado.',
    icon: Users
  }
];

const LOCAL_FEATURES = [
  'Punto de venta en un solo equipo',
  'Funciona incluso sin internet',
  'Tienda en línea básica hasta 10 productos'
];

const CLOUD_FEATURES = [
  'Hasta 5 dispositivos',
  'Todo sincronizado en la nube',
  'Roles para tu equipo',
  'Catálogo en línea sin límite de productos',
  'Agentes de IA con límite de uso'
];

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

  const recommendation = selectedWorkflow === 'team'
    ? {
        eyebrow: 'RECOMENDADO PARA TU EQUIPO',
        title: 'Lanzo Nube',
        description: 'Conecta hasta cinco dispositivos, sincroniza la operación y asigna accesos por rol.'
      }
    : selectedWorkflow === 'solo'
      ? {
          eyebrow: 'RECOMENDADO PARA TI',
          title: 'Lanzo Local',
          description: 'Si trabajas en un solo equipo, puedes vender y controlar tu inventario incluso sin internet.'
        }
      : {
          eyebrow: 'ELIGE A TU RITMO',
          title: 'Una opción para cada etapa',
          description: 'Cuéntanos cómo trabajas hoy y te mostraremos el plan que mejor acompaña tu operación.'
        };

  return (
    <main className="about-redesign" aria-labelledby="about-title">
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

      {aboutLicenseState === ABOUT_LICENSE_STATE.LOCAL_ACTIVE ? (
        <>
      <section className="about-redesign__chooser" aria-labelledby="about-workflow-title">
        <div className="about-redesign__section-heading">
          <div>
            <h2 id="about-workflow-title">¿Cómo trabajas hoy?</h2>
            <p>Esto nos ayuda a mostrarte la mejor opción para tu negocio.</p>
          </div>
        </div>

        <div className="about-redesign__workflow-list">
          {WORKFLOWS.map(({ id, title, description, icon: Icon }) => {
            const isSelected = selectedWorkflow === id;
            const isCurrent = (id === 'team' && isCloudPlan) || (id === 'solo' && !isCloudPlan);

            return (
              <button
                className={[
                  'about-redesign__workflow',
                  isSelected ? 'is-selected' : '',
                  isCurrent ? 'is-current' : ''
                ].filter(Boolean).join(' ')}
                type="button"
                key={id}
                aria-pressed={isSelected}
                onClick={() => setSelectedWorkflow(id)}
              >
                <span className="about-redesign__radio" aria-hidden="true">
                  {isSelected && <span />}
                </span>
                <span className="about-redesign__workflow-icon" aria-hidden="true">
                  <Icon size={23} />
                </span>
                <span className="about-redesign__workflow-copy">
                  <strong>{title}</strong>
                  <span>{description}</span>
                </span>
                {isCurrent && <span className="about-redesign__workflow-tag">Tu plan actual</span>}
              </button>
            );
          })}
        </div>

        <section className="about-redesign__recommendation" aria-live="polite" aria-label="Plan recomendado">
          <div className="about-redesign__recommendation-copy">
            <p className="about-redesign__recommendation-eyebrow">
              <Sparkles size={15} aria-hidden="true" />
              {recommendation.eyebrow}
            </p>
            <h3>{recommendation.title}</h3>
            <p>{recommendation.description}</p>
          </div>

          <div className="about-redesign__offer">
            <span className="about-redesign__offer-tag">OFERTA DE LANZAMIENTO</span>
            <strong>3 meses por $300</strong>
            <span className="about-redesign__offer-after">Después $129 MXN al mes.</span>
            <div className="about-redesign__offer-details">
              <span><MessageCircle size={15} aria-hidden="true" /> Por Telegram y transferencia</span>
              <span><CheckCircle2 size={15} aria-hidden="true" /> Activación asistida</span>
            </div>
          </div>

          <div className="about-redesign__recommendation-action">
            {renderContactAction(contactActions.primary, 'about-redesign__primary-button')}
            {contactActions.secondary && renderContactAction(
              contactActions.secondary,
              'about-redesign__secondary-button'
            )}
            <span>
              {selectedWorkflow === 'solo'
                ? 'Puedes continuar con Lanzo Local. Esta consulta no cambia tu plan.'
                : selectedWorkflow === 'team'
                  ? 'La solicitud es asistida; el botón no activa ni cobra el plan.'
                  : 'El equipo te orientará sobre planes y condiciones vigentes.'}
            </span>
          </div>
        </section>
      </section>

      <section className="about-redesign__comparison" aria-label="Comparación de planes">
        <article className="about-redesign__plan-summary" id="about-local-plan">
          <div className="about-redesign__plan-icon about-redesign__plan-icon--local" aria-hidden="true">
            <Store size={22} />
          </div>
          <div className="about-redesign__plan-content">
            <div className="about-redesign__plan-heading">
              <h2>Lo que tienes con Lanzo Local</h2>
              {!isCloudPlan && <span className="about-redesign__plan-current">Tu plan</span>}
            </div>
            <ul>
              {LOCAL_FEATURES.map(feature => (
                <li key={feature}><Check size={16} aria-hidden="true" /><span>{feature}</span></li>
              ))}
            </ul>
          </div>
        </article>

        <article className="about-redesign__plan-summary about-redesign__plan-summary--cloud">
          <div className="about-redesign__plan-icon about-redesign__plan-icon--cloud" aria-hidden="true">
            <Users size={22} />
          </div>
          <div className="about-redesign__plan-content">
            <div className="about-redesign__plan-heading">
              <h2>Lo que añade Lanzo Nube</h2>
              {isCloudPlan && <span className="about-redesign__plan-current">Tu plan</span>}
            </div>
            <ul>
              {CLOUD_FEATURES.map(feature => (
                <li key={feature}><Check size={16} aria-hidden="true" /><span>{feature}</span></li>
              ))}
            </ul>
          </div>
        </article>
      </section>

        </>
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
                  label: 'Contactar por Telegram'
                }, event.currentTarget)}
              >
                <MessageCircle size={16} aria-hidden="true" /> Contactar por Telegram
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
              Se abrirá el chat de @{telegramPreview.username} con el texto preparado, si Telegram admite esta función. Revísalo y envíalo desde Telegram; abrir el chat no confirma su recepción.
            </p>
            <label className="about-telegram-dialog__message-label" htmlFor="about-telegram-message">
              Mensaje para {telegramPreview.label.charAt(0).toLowerCase() + telegramPreview.label.slice(1)}
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
                aria-label="Abrir chat de Lanzo POS en Telegram en una nueva pestaña"
                onClick={() => setTelegramPreview(null)}
              >
                Abrir Telegram
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
