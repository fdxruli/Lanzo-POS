import { useState } from 'react';
import {
  BarChart2,
  Bug,
  CheckCircle2,
  Clock,
  Cloud,
  Lightbulb,
  Mail,
  Map,
  Package,
  ShieldCheck,
  Sparkles,
  Store,
  TrendingUp,
} from 'lucide-react';
import { useProductStore } from '../store/useProductStore';
import ContactModal from '../components/common/ContactModal';
import Logo from '../components/common/Logo';
import { APP_BUILD_DATE_LABEL, APP_VERSION, APP_VERSION_LABEL } from '../config/appVersion';
import './AboutPage.css';

const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || '';

const EMPTY_CONTACT_MODAL = {
  show: false,
  type: '',
  title: '',
  fields: [],
  description: ''
};

const HERO_CAPABILITIES = [
  {
    label: 'Operación híbrida',
    value: 'Local + Cloud PRO',
    icon: Cloud
  },
  {
    label: 'Venta diaria',
    value: 'Caja, productos y turnos',
    icon: Store
  },
  {
    label: 'Lectura del negocio',
    value: 'Reportes y trazabilidad',
    icon: BarChart2
  }
];

const BENEFIT_PILLARS = [
  {
    number: '01',
    title: 'Local cuando importa, Cloud PRO cuando creces',
    description: 'Lanzo sigue vendiendo en el dispositivo y suma sincronización en la nube para operar con más control cuando el negocio lo pide.',
    tags: ['Modo local', 'Cloud PRO'],
    icon: Cloud,
    tone: 'brand'
  },
  {
    number: '02',
    title: 'Caja y ventas con trazabilidad',
    description: 'Cada turno, movimiento y venta queda más claro para saber quién operó, qué pasó y cómo cerró el día.',
    tags: ['Caja', 'Auditoría'],
    icon: ShieldCheck,
    tone: 'success'
  },
  {
    number: '03',
    title: 'Inventario que acompaña la operación',
    description: 'Productos, recetas, códigos de barras y existencias trabajan juntos para reducir errores en venta y reposición.',
    tags: ['Inventario', 'Recetas'],
    icon: Package,
    tone: 'warning'
  },
  {
    number: '04',
    title: 'Decisiones visibles, no escondidas',
    description: 'Reportes y actividad reciente convierten el movimiento diario en señales útiles para ajustar precios, compras y atención.',
    tags: ['Reportes', 'Lectura diaria'],
    icon: TrendingUp,
    tone: 'primary'
  }
];

const ROADMAP_STAGES = [
  { label: 'Base local', isComplete: true },
  { label: 'Caja y KDS', isComplete: true },
  { label: 'Cloud PRO', isActive: true },
  { label: 'Clientes 360', isComplete: false },
  { label: 'IA operativa', isComplete: false }
];

const ROADMAP_GROUPS = [
  {
    id: 'foundation',
    title: 'Base lista',
    summary: 'Operación diaria',
    icon: CheckCircle2,
    items: [
      'Punto de venta rápido con caja y cortes',
      'Productos, recetas, códigos de barras y KDS',
      'Modo claro/oscuro integrado al nuevo sistema visual'
    ]
  },
  {
    id: 'in-progress',
    title: 'En camino',
    summary: 'Cloud PRO',
    icon: Clock,
    items: [
      'Sincronización multi-dispositivo con Cloud PRO',
      'Empleados, turnos, permisos y auditoría más profunda',
      'Cotizaciones, resúmenes y reportes listos para compartir'
    ]
  },
  {
    id: 'next',
    title: 'Siguiente salto',
    summary: 'Nivel POS global',
    icon: Sparkles,
    items: [
      'Perfiles de cliente 360 con historial, preferencias y lealtad omnicanal',
      'Asistente inteligente para demanda, inventario, recompra y alertas antes de perder venta'
    ]
  }
];

const ROADMAP_COMPLETE_COUNT = ROADMAP_STAGES.filter(stage => stage.isComplete).length;
const ROADMAP_PROGRESS = `${(Math.max(0, ROADMAP_COMPLETE_COUNT - 1) / Math.max(1, ROADMAP_STAGES.length - 1)) * 100}%`;

const generateEmailLink = (type, formData) => {
  let subject = '';
  let body = '';

  if (type === 'bug') {
    subject = `Reporte de error [${APP_VERSION}]`;
    body = `Hola equipo de Lanzo,

He encontrado un problema que quiero reportar:

ACCIÓN QUE REALIZABA:
${formData.action || '[No especificado]'}

QUÉ PASÓ:
${formData.error || '[No especificado]'}

INFORMACIÓN DEL DISPOSITIVO:
${formData.device || navigator.userAgent}

Versión de la app: ${APP_VERSION_LABEL}
Build: ${APP_BUILD_DATE_LABEL}
Fecha: ${new Date().toLocaleString()}

Gracias por la atención.`;
  } else {
    subject = 'Sugerencia de función - Lanzo POS';
    body = `Hola equipo,

Tengo una idea para mejorar Lanzo:

MI IDEA:
${formData.idea || '[No especificado]'}

BENEFICIO:
${formData.benefit || '[No especificado]'}

INFORMACIÓN ADICIONAL:
Dispositivo: ${navigator.userAgent}
Versión: ${APP_VERSION_LABEL}
Build: ${APP_BUILD_DATE_LABEL}

Espero que sea útil.`;
  }

  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
};

export default function AboutPage() {
  const productCount = useProductStore(state => state.menu?.length || 0);
  const [contactModal, setContactModal] = useState(EMPTY_CONTACT_MODAL);

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
    window.location.href = generateEmailLink(contactModal.type, formData);
  };

  return (
    <main className="about-grid">
      <section className="about-hero" aria-labelledby="about-title">
        <div className="about-hero-logo">
          <Logo className="about-logo" showBusinessName={false} />
        </div>
        <p className="about-eyebrow">Versión {APP_VERSION}</p>
        <h1 id="about-title">El poder de un ERP, la sencillez de una app</h1>
        <p className="about-hero-copy">
          Lanzo combina punto de venta local, control de caja y Cloud PRO para que el negocio opere rápido hoy y pueda crecer con más dispositivos, datos y automatización mañana.
        </p>
        <div className="about-hero-metrics" aria-label="Resumen de la aplicación">
          <div className="about-metric">
            <span className="about-metric-value">{productCount.toLocaleString()}</span>
            <span className="about-metric-label">Productos gestionados</span>
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
          <section className="about-card" aria-labelledby="about-features-title">
            <header className="about-section-heading">
              <p className="about-eyebrow">Hecho para el trabajo diario</p>
              <h2 id="about-features-title" className="about-section-title">
                ¿Por qué elegir Lanzo?
              </h2>
            </header>

            <ol className="about-pillars">
              {BENEFIT_PILLARS.map(({ number, title, description, tags, icon: Icon, tone }) => (
                <li className={`about-pillar about-pillar--${tone}`} key={number}>
                  <div className="about-pillar-icon" aria-hidden="true">
                    <Icon size={25} strokeWidth={2.2} />
                  </div>
                  <div className="about-pillar-content">
                    <span className="about-pillar-number" aria-hidden="true">{number}</span>
                    <h3>{title}</h3>
                    <p>{description}</p>
                    <div className="about-pillar-tags" aria-label={`Ventajas de ${title}`}>
                      {tags.map(tag => <span key={tag}>{tag}</span>)}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
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
                <strong>Base operativa lista</strong>
                <span>Cloud PRO y funciones premium en camino</span>
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
