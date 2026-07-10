import { useState } from 'react';
import {
  BarChart2,
  Bug,
  CheckCircle2,
  Cloud,
  Lightbulb,
  Mail,
  Map,
  ShieldCheck,
  Sparkles,
  Store,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { useProductStore } from '../store/useProductStore';
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
import './AboutPagePlanModes.css';

const EMPTY_CONTACT_MODAL = {
  show: false,
  type: '',
  title: '',
  fields: [],
  description: ''
};

const HERO_CAPABILITIES = [
  {
    label: 'Un dispositivo',
    value: 'Lanzo Local',
    icon: Store
  },
  {
    label: 'Sincronización y equipo',
    value: 'Lanzo Nube',
    icon: Cloud
  },
  {
    label: 'Local o nube según plan',
    value: 'Reportes por plan',
    icon: BarChart2
  }
];

const LOCAL_PLAN_FEATURES = [
  'Punto de venta local',
  'Caja y cortes locales',
  'Productos e inventario local',
  'Reportes en el dispositivo',
  'Respaldo manual/local',
  '1 dispositivo'
];

const LOCAL_PLAN_LIMITS = [
  'Sin sincronización cloud',
  'Sin empleados/staff',
  'Sin multi-dispositivo',
  'Sin IA operativa'
];

const CLOUD_PLAN_FEATURES = [
  'Hasta 5 dispositivos',
  'Sincronización en la nube',
  'Staff, roles y permisos',
  'Productos, ventas, caja, clientes y reportes cloud',
  'Restaurante/preparación cloud',
  'IA operativa con límite de uso',
  'Auditoría y trazabilidad avanzada'
];

const CLOUD_PLAN_LIMITS = [
  'Disponible solo con Lanzo Nube activo',
  'Requiere conexión para sincronización cloud',
  'La IA opera con límite configurado por licencia'
];

const PLAN_MODES = [
  {
    id: 'free',
    title: 'Lanzo Local',
    subtitle: 'Para vender y controlar tu negocio desde un solo dispositivo.',
    badge: 'Incluido en Lanzo Local',
    icon: Store,
    features: LOCAL_PLAN_FEATURES,
    limits: LOCAL_PLAN_LIMITS
  },
  {
    id: 'pro',
    title: 'Lanzo Nube',
    subtitle: 'Para operar con equipo, nube y más control.',
    badge: 'Disponible en Lanzo Nube',
    icon: Cloud,
    features: CLOUD_PLAN_FEATURES,
    limits: CLOUD_PLAN_LIMITS
  }
];

const ROADMAP_STAGES = [
  { label: 'Lanzo Local incluido', isComplete: true },
  { label: 'Disponible según tu plan', isActive: true },
  { label: 'Lanzo Nube para crecer', isComplete: true },
  { label: 'Próximas mejoras', isComplete: false }
];

const ROADMAP_GROUPS = [
  {
    id: 'foundation',
    title: 'Lanzo Local incluido',
    summary: 'Lanzo Local',
    icon: CheckCircle2,
    items: [
      'Punto de venta, caja, productos e inventario locales en un dispositivo',
      'Reportes locales para revisar el movimiento desde el equipo donde vendes',
      'Respaldo manual/local sin prometer sincronización cloud'
    ]
  },
  {
    id: 'in-progress',
    title: 'Disponible según tu plan',
    summary: 'Lanzo Nube',
    icon: ShieldCheck,
    items: [
      'Multi-dispositivo, staff, roles y permisos pertenecen a Lanzo Nube',
      'Caja, productos, ventas, clientes y reportes cloud se activan con Lanzo Nube',
      'Restaurante/preparación cloud e IA operativa están disponibles según tu licencia'
    ]
  },
  {
    id: 'next',
    title: 'Próximas mejoras',
    summary: 'Evolución futura',
    icon: Sparkles,
    items: [
      'Perfiles de cliente 360 con historial, preferencias y lealtad omnicanal',
      'Más asistentes inteligentes para demanda, inventario, recompra y alertas preventivas'
    ]
  }
];

const ROADMAP_COMPLETE_COUNT = ROADMAP_STAGES.filter(stage => stage.isComplete).length;
const ROADMAP_PROGRESS = `${(Math.max(0, ROADMAP_COMPLETE_COUNT - 1) / Math.max(1, ROADMAP_STAGES.length - 1)) * 100}%`;

const getDeviceLimitFromLicense = (licenseDetails = {}, isCloudPlan = false) => {
  const features = getPlanFeaturesFromLicenseDetails(licenseDetails);
  const deviceLimit = Number(
    features?.max_devices ||
    licenseDetails?.max_devices ||
    licenseDetails?.details?.max_devices ||
    (isCloudPlan ? 5 : 1)
  );

  return Number.isFinite(deviceLimit) && deviceLimit > 0 ? deviceLimit : (isCloudPlan ? 5 : 1);
};

const buildContactDescription = (type, formData) => {
  if (type === 'bug') {
    return `ACCION QUE REALIZABA:
${formData.action || '[No especificado]'}

QUE PASO:
${formData.error || '[No especificado]'}

INFORMACION DEL DISPOSITIVO:
${formData.device || navigator.userAgent}

Build: ${APP_BUILD_DATE_LABEL}`;
  }

  return `MI IDEA:
${formData.idea || '[No especificado]'}

BENEFICIO:
${formData.benefit || '[No especificado]'}

INFORMACION ADICIONAL:
Dispositivo: ${navigator.userAgent}
Build: ${APP_BUILD_DATE_LABEL}`;
};

export default function AboutPage() {
  const productCount = useProductStore(state => state.menu?.length || 0);
  const licenseDetails = useAppStore(state => state.licenseDetails);
  const companyProfile = useAppStore(state => state.companyProfile);
  const [contactModal, setContactModal] = useState(EMPTY_CONTACT_MODAL);

  const isCloudPlan = isCloudPosSyncEnabled(licenseDetails);
  const currentPlanMode = isCloudPlan ? 'pro' : 'free';
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
      ? `Reporte de error [${APP_VERSION}]`
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

  return (
    <main className="about-grid">
      <section className="about-hero" aria-labelledby="about-title">
        <div className="about-hero-logo">
          <Logo className="about-logo" showBusinessName={false} />
        </div>
        <p className="about-eyebrow">Versión {APP_VERSION}</p>
        <h1 id="about-title">Lanzo POS: Lanzo Local para empezar, Lanzo Nube para crecer</h1>
        <p className="about-hero-copy">
          Lanzo puede operar en modo local con Lanzo Local o conectarse a Lanzo Nube cuando necesitas varios dispositivos, empleados, sincronización, reportes avanzados e IA. Así cada negocio sabe exactamente qué tiene incluido y qué puede activar al crecer.
        </p>
        <div className="about-hero-metrics" aria-label="Resumen de la aplicación">
          <div className="about-metric">
            <span className="about-metric-value">{productCount.toLocaleString()}</span>
            <span className="about-metric-label">Productos gestionados en este dispositivo</span>
          </div>
          {HERO_CAPABILITIES.map(({ label, value, icon: Icon }) => (
            <div className="about-hero-chip" key={label}>
              <Icon size={17} aria-hidden="true" />
              <span>
                <strong>{value}</strong>
                <small>{label}</small>
              </span>
            </div>
          ))}
        </div>
      </section>

      <div className="about-content">
        <div className="about-column">
          <section className="about-card" aria-labelledby="about-plan-modes-title">
            <header className="about-section-heading">
              <p className="about-eyebrow">Dos formas de usar Lanzo</p>
              <h2 id="about-plan-modes-title" className="about-section-title">
                Qué incluye Lanzo Local y qué pertenece a Lanzo Nube
              </h2>
            </header>

            <div className="about-plan-grid" aria-label="Comparación de modos Lanzo">
              {PLAN_MODES.map(({ id, title, subtitle, badge, icon: Icon, features, limits }) => {
                const isCurrent = currentPlanMode === id;
                const planClassName = [
                  'about-plan-card',
                  `about-plan-card--${id}`,
                  isCurrent ? 'about-plan-current' : ''
                ].filter(Boolean).join(' ');

                return (
                  <article className={planClassName} key={id}>
                    <header className="about-plan-card-header">
                      <div className="about-plan-icon" aria-hidden="true">
                        <Icon size={24} strokeWidth={2.2} />
                      </div>
                      <div>
                        <span className="about-plan-badge">
                          {isCurrent ? (
                            <>
                              <CheckCircle2 size={13} aria-hidden="true" />
                              Tu plan actual
                            </>
                          ) : badge}
                        </span>
                        <h3>{title}</h3>
                        <p>{subtitle}</p>
                      </div>
                    </header>

                    <div className="about-plan-section">
                      <h4>Incluye</h4>
                      <ul className="about-plan-feature-list">
                        {features.map(feature => (
                          <li key={feature}>
                            <CheckCircle2 size={15} aria-hidden="true" />
                            <span>{feature}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="about-plan-section">
                      <h4>{id === 'free' ? 'Límites / no incluido' : 'Condiciones'}</h4>
                      <ul className="about-plan-limit-list">
                        {limits.map(limit => (
                          <li key={limit}>
                            <span aria-hidden="true">—</span>
                            <span>{limit}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {isCurrent && (
                      <p className="about-plan-current-note">
                        <CheckCircle2 size={15} aria-hidden="true" />
                        Esta licencia opera en modo {title} con límite de {currentDeviceLimit} dispositivo{currentDeviceLimit === 1 ? '' : 's'}.
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          <section className="about-card" aria-labelledby="about-roadmap-title">
            <header className="about-section-header about-roadmap-header">
              <div className="about-section-icon" aria-hidden="true">
                <Map size={20} />
              </div>
              <div>
                <p className="about-eyebrow">Lanzo sigue creciendo</p>
                <h2 id="about-roadmap-title" className="about-section-title">Ruta de evolución</h2>
              </div>
            </header>

            <div className="about-roadmap-progress" aria-label="Evolución de Lanzo POS">
              <div className="about-roadmap-progress-copy">
                <strong>Lanzo Local incluido</strong>
                <span>Lanzo Nube disponible según tu plan</span>
              </div>
              <div
                className="about-progress-track"
                style={{
                  '--roadmap-stage-count': ROADMAP_STAGES.length,
                  '--roadmap-progress-fill': ROADMAP_PROGRESS
                }}
              >
                <span className="about-progress-fill" aria-hidden="true" />
                {ROADMAP_STAGES.map(stage => (
                  <span
                    className={`about-progress-dot ${stage.isComplete ? 'is-complete' : ''} ${stage.isActive ? 'is-active' : ''}`}
                    key={stage.label}
                    title={stage.label}
                  >
                    {stage.isComplete && <CheckCircle2 size={16} aria-hidden="true" />}
                    <span className="about-stage-label">{stage.label}</span>
                  </span>
                ))}
              </div>
            </div>

            <div className="about-roadmap-groups">
              {ROADMAP_GROUPS.map(({ id, title, summary, icon: Icon, items }) => (
                <section className={`about-roadmap-group about-roadmap-group--${id}`} key={id}>
                  <header className="about-roadmap-group-header">
                    <div className="about-roadmap-group-icon" aria-hidden="true">
                      <Icon size={20} />
                    </div>
                    <div>
                      <h3>{title}</h3>
                      <p>{summary}</p>
                    </div>
                  </header>
                  <ul className="about-roadmap-grid">
                    {items.map(item => (
                      <li key={item}>
                        <Icon size={16} aria-hidden="true" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </section>
        </div>

        <aside className="about-column" aria-label="Información y contacto">
          <section className="about-card about-sponsor" aria-labelledby="sponsor-title">
            <div className="about-sponsor-bg" aria-hidden="true" />
            <div className="about-sponsor-content">
              <p className="about-eyebrow">Desarrollado por</p>
              <h2 id="sponsor-title" className="about-sponsor-title">ENTRE ALAS</h2>
              <p className="about-sponsor-slogan">&quot;Espera lo mejor&quot;</p>
              
              <div className="about-sponsor-story">
                <p className="about-sponsor-lead">De Dark Kitchen a aliado tecnológico</p>
                <p className="about-sponsor-description">
                  Nacimos el 15 de octubre del 2022 como negocio de alimentos. Al entender los retos del día a día, creamos las herramientas que necesitábamos y ahora las compartimos contigo.
                </p>
              </div>

              <a
                href="https://www.facebook.com/100087646261018"
                target="_blank"
                rel="noopener noreferrer"
                className="about-sponsor-link"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
                Visítanos en Facebook
              </a>
            </div>
          </section>

          <section className="about-card" aria-labelledby="about-contact-title">
            <header className="about-section-header">
              <div className="about-section-icon" aria-hidden="true">
                <Mail size={20} />
              </div>
              <h2 id="about-contact-title" className="about-section-title">Ayúdanos a mejorar</h2>
            </header>
            <p className="about-contact-description">
              Tu opinión es valiosa. ¿Encontraste un error o tienes una idea? Queremos escucharte.
            </p>

            <div className="about-contact-actions">
              <button
                type="button"
                onClick={() => handleOpenContactModal('bug')}
                className="about-action about-action--bug"
              >
                <Bug size={18} aria-hidden="true" />
                Reportar error
              </button>
              <button
                type="button"
                onClick={() => handleOpenContactModal('feature')}
                className="about-action about-action--idea"
              >
                <Lightbulb size={18} aria-hidden="true" />
                Sugerir mejora
              </button>
            </div>

            <div className="about-contact-footer">
              <span className="about-badge about-badge--success">
                <CheckCircle2 size={13} aria-hidden="true" />
                Respuesta en menos de 24 h
              </span>
            </div>
          </section>
        </aside>
      </div>

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
