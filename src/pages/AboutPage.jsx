import { useState } from 'react';
import {
  ArrowRight,
  Bug,
  Check,
  CheckCircle2,
  Cloud,
  Coffee,
  Lightbulb,
  Mail,
  MessageCircle,
  Sparkles,
  Store,
  Users,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
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
import './AboutPage.css';

const TELEGRAM_MESSAGE = 'Hola, quiero conocer Lanzo Nube. Me interesa la promoción de 3 meses por $300 MXN.';
const TELEGRAM_URL = 'https://t.me/LanzoPOS_Oficial?text=' + encodeURIComponent(TELEGRAM_MESSAGE);
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
  const companyProfile = useAppStore(state => state.companyProfile);
  const [selectedWorkflow, setSelectedWorkflow] = useState('');
  const [contactModal, setContactModal] = useState(EMPTY_CONTACT_MODAL);

  const isCloudPlan = isCloudPosSyncEnabled(licenseDetails);
  const currentPlanName = isCloudPlan ? 'Lanzo Nube' : 'Lanzo Local';
  const currentDeviceLimit = getDeviceLimitFromLicense(licenseDetails, isCloudPlan);

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
          <p className="about-redesign__eyebrow">LANZO POS</p>
          <h1 id="about-title">Acerca de</h1>
          <p className="about-redesign__intro">
            Conoce tu plan actual y descubre todo lo que puedes hacer con Lanzo.
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
          <span>
            {isCloudPlan
              ? 'Tu licencia incluye sincronización y hasta ' + currentDeviceLimit + ' dispositivos.'
              : 'Tu punto de venta funciona en este equipo y puedes seguir vendiendo, incluso sin internet.'}
          </span>
        </div>
        <span className="about-redesign__current-badge">
          <Check size={14} aria-hidden="true" />
          Activo
        </span>
      </section>

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
            <a className="about-redesign__primary-button" href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
              {selectedWorkflow === 'team' ? 'Solicitar Lanzo Nube' : 'Consultar por Telegram'}
              <ArrowRight size={18} aria-hidden="true" />
            </a>
            <span>
              {selectedWorkflow === 'solo'
                ? 'Puedes activar Nube cuando tu operación lo necesite.'
                : 'Te ayudamos a activar tu plan.'}
            </span>
          </div>
        </section>
      </section>

      <section className="about-redesign__comparison" aria-label="Comparación de planes">
        <article className="about-redesign__plan-summary">
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
              <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
                <MessageCircle size={16} aria-hidden="true" /> Contactar por Telegram
              </a>
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
