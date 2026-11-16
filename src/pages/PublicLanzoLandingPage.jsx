import { useEffect } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Boxes,
  Check,
  Cloud,
  DatabaseBackup,
  ReceiptText,
  Store,
  WifiOff,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import LogoMark from '../components/common/LogoMark';
import {
  PUBLIC_STORE_ORIGIN,
  buildAdminWelcomeUrl,
  buildPublicStorePath,
} from '../config/publicOrigins';
import { isValidStoreSlug } from '../../store/api/_storeSlug';
import './PublicLanzoLandingPage.css';

const RESERVED_PUBLIC_STORE_SLUGS = new Set([
  'api',
  'assets',
  'conoce-lanzo',
  'src',
  'tienda',
]);

const COMMITMENTS = [
  {
    title: 'Gratuito de verdad',
    description: 'LANZO Free es gratis para siempre. Las herramientas esenciales no son una prueba temporal de PRO.',
    Icon: Check,
  },
  {
    title: 'Comprender tu negocio',
    description: 'Consulta ventas, inventario, caja e historial para tener más claridad sobre tu operación.',
    Icon: BarChart3,
  },
  {
    title: 'Tus datos importan',
    description: 'La operación Free se guarda en el dispositivo. Haz respaldos manuales y conserva una copia fuera del equipo.',
    Icon: DatabaseBackup,
  },
  {
    title: 'Crecer a tu ritmo',
    description: 'Puedes continuar con Free o sumar LANZO PRO / Nube cuando necesites servicios conectados.',
    Icon: Cloud,
  },
];

const BUSINESS_AREAS = [
  {
    title: 'Vender',
    description: 'Registra las operaciones del día y organiza los cobros de tu negocio.',
    features: ['Punto de venta', 'Movimientos de caja', 'Historial de ventas'],
    Icon: ReceiptText,
  },
  {
    title: 'Organizar',
    description: 'Mantén a la mano la información que acompaña tu operación.',
    features: ['Productos e inventario', 'Clientes', 'Herramientas según tu rubro'],
    Icon: Boxes,
  },
  {
    title: 'Comprender',
    description: 'Revisa cómo se mueve el negocio con la información de tu operación.',
    features: ['Reportes locales', 'Cierres y cortes', 'Indicadores disponibles'],
    Icon: BarChart3,
  },
];

const BUSINESS_TYPES = [
  'Restaurantes y cocinas',
  'Abarrotes y tiendas',
  'Farmacias',
  'Fruterías y verdulerías',
  'Ropa y calzado',
  'Ferreterías',
];

const FREE_FEATURES = [
  'Punto de venta y herramientas esenciales de operación',
  'Productos, inventario, clientes, caja e historial local',
  'Uso en un dispositivo y módulos locales compatibles sin internet',
  'Respaldos manuales para conservar una copia de tus datos',
  'Tienda en línea con hasta 10 productos publicados',
  'El límite online no limita los productos de tu catálogo interno',
];

const PRO_FEATURES = [
  'Sincronización con LANZO Nube, según tu licencia',
  'Hasta 5 dispositivos, de acuerdo con el plan contratado',
  'Colaboración con personal, roles y permisos',
  'Publicación online sin límite, según tu licencia',
  'Herramientas conectadas y capacidades avanzadas según el plan',
];

const STEPS = [
  ['01', 'Comienza gratis', 'Crea tu licencia Free y configura los datos básicos de tu negocio.'],
  ['02', 'Organiza tu operación', 'Carga tu catálogo y empieza a registrar ventas, caja e inventario.'],
  ['03', 'Crece a tu ritmo', 'Sigue con Free o conoce Nube cuando necesites más dispositivos o colaboración.'],
];

const FAQS = [
  {
    question: '¿LANZO Free es realmente gratuito?',
    answer: 'Sí. LANZO Free es gratis para siempre y no es una prueba temporal de PRO. Puedes seguir usando sus herramientas esenciales sin contratar una suscripción.',
  },
  {
    question: '¿Necesito internet para vender?',
    answer: 'Los módulos locales compatibles pueden seguir operando sin conexión. La tienda en línea, la sincronización y otras funciones conectadas sí requieren internet.',
  },
  {
    question: '¿Qué pasa si pierdo mi dispositivo?',
    answer: 'Los datos de Free se guardan localmente. Realiza respaldos manuales con frecuencia y guarda una copia fuera del equipo; sin un respaldo disponible, la información local podría no recuperarse.',
  },
  {
    question: '¿Puedo utilizar LANZO sin contratar PRO?',
    answer: 'Sí. Puedes utilizar LANZO Free sin contratar PRO. Nube es una opción para cuando necesites sincronización, dispositivos adicionales u otras capacidades conectadas.',
  },
  {
    question: '¿Qué límite tiene la tienda en línea gratuita?',
    answer: 'LANZO Free permite publicar hasta 10 productos en la tienda en línea. Ese límite se refiere a los productos publicados online, no al catálogo interno de tu negocio.',
  },
];

const getValidStoreSlug = (searchParams) => {
  const values = searchParams.getAll('tienda');
  if (values.length !== 1) return null;

  const [slug] = values;
  if (!isValidStoreSlug(slug) || RESERVED_PUBLIC_STORE_SLUGS.has(slug)) return null;
  return slug;
};

function useLandingMetadata() {
  useEffect(() => {
    const previousTitle = document.title;
    const restore = [];
    const canonicalUrl = new URL('/conoce-lanzo', PUBLIC_STORE_ORIGIN).toString();

    const setMeta = (attribute, name, content) => {
      const selector = `meta[${attribute}="${name}"]`;
      const existing = document.head.querySelector(selector);
      const element = existing || document.createElement('meta');
      const previousContent = existing?.getAttribute('content') ?? null;

      if (!existing) {
        element.setAttribute(attribute, name);
        document.head.appendChild(element);
      }
      element.setAttribute('content', content);

      restore.push(() => {
        if (!existing) {
          element.remove();
          return;
        }
        if (previousContent === null) existing.removeAttribute('content');
        else existing.setAttribute('content', previousContent);
      });
    };

    const existingCanonical = document.head.querySelector('link[rel="canonical"]');
    const canonical = existingCanonical || document.createElement('link');
    const previousCanonicalHref = existingCanonical?.getAttribute('href') ?? null;
    if (!existingCanonical) {
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', canonicalUrl);
    restore.push(() => {
      if (!existingCanonical) {
        canonical.remove();
        return;
      }
      if (previousCanonicalHref === null) existingCanonical.removeAttribute('href');
      else existingCanonical.setAttribute('href', previousCanonicalHref);
    });

    document.title = 'Conoce LANZO | Herramientas para pequeños negocios';
    setMeta(
      'name',
      'description',
      'Conoce por qué nació LANZO y cómo ayuda a los pequeños negocios a organizar su operación con herramientas esenciales gratuitas.'
    );
    setMeta('property', 'og:type', 'website');
    setMeta('property', 'og:title', 'Conoce LANZO | Herramientas para pequeños negocios');
    setMeta(
      'property',
      'og:description',
      'LANZO nació para ayudar a quienes emprenden a organizar sus negocios, sin que una mensualidad sea otra barrera para comenzar.'
    );
    setMeta('property', 'og:url', canonicalUrl);
    setMeta('name', 'twitter:card', 'summary');
    setMeta('name', 'twitter:title', 'Conoce LANZO | Herramientas para pequeños negocios');
    setMeta(
      'name',
      'twitter:description',
      'Conoce la historia y el compromiso de LANZO con quienes emprenden.'
    );

    return () => {
      document.title = previousTitle;
      restore.reverse().forEach((restoreMetadata) => restoreMetadata());
    };
  }, []);
}

function PlanCard({ type, title, description, features, ctaLabel, featured = false }) {
  return (
    <article className={`public-lanzo-plan${featured ? ' public-lanzo-plan--featured' : ''}`}>
      <p className="public-lanzo-plan__type">{type}</p>
      <h3>{title}</h3>
      <p className="public-lanzo-plan__description">{description}</p>
      <ul>
        {features.map((feature) => (
          <li key={feature}><Check aria-hidden="true" size={18} /><span>{feature}</span></li>
        ))}
      </ul>
      <a className={`ui-button ${featured ? 'ui-button--neutral' : 'ui-button--primary'} public-lanzo-plan__cta`} href={buildAdminWelcomeUrl()}>
        {ctaLabel}<ArrowRight aria-hidden="true" size={17} />
      </a>
    </article>
  );
}

function PublicLanzoLandingPage() {
  const [searchParams] = useSearchParams();
  const storeSlug = getValidStoreSlug(searchParams);
  useLandingMetadata();

  return (
    <div className="public-lanzo-landing">
      <header className="public-lanzo-header">
        <nav className="public-lanzo-nav" aria-label="Navegación principal">
          <div className="public-lanzo-brand">
            <span className="public-lanzo-brand__mark" aria-hidden="true"><LogoMark /></span>
            <span className="public-lanzo-brand__copy"><strong>LANZO</strong><small>Controla hoy. Crece mañana.</small></span>
          </div>
          <a
            className="public-lanzo-nav__back"
            href={storeSlug ? buildPublicStorePath(storeSlug) : buildAdminWelcomeUrl()}
            aria-label={storeSlug ? 'Volver a la tienda' : 'Ir a LANZO'}
          >
            {storeSlug ? <ArrowLeft aria-hidden="true" size={18} /> : null}
            <span>{storeSlug ? 'Volver a la tienda' : 'Ir a LANZO'}</span>
            {!storeSlug ? <ArrowRight aria-hidden="true" size={17} /> : null}
          </a>
        </nav>
      </header>

      <main>
        <section className="public-lanzo-hero" aria-labelledby="public-lanzo-title">
          <div className="public-lanzo-hero__content">
            <p className="public-lanzo-eyebrow"><Store aria-hidden="true" size={16} /> Para quienes emprenden</p>
            <h1 id="public-lanzo-title">Emprender ya es difícil. Llevar tu negocio no debería serlo.</h1>
            <p className="public-lanzo-hero__lead">
              LANZO nació para ayudar a los pequeños negocios a vender, organizarse y comprender sus resultados,
              sin tener que pagar una mensualidad por las herramientas esenciales.
            </p>
            <div className="public-lanzo-hero__actions">
              <a className="ui-button ui-button--primary public-lanzo-primary-cta" href={buildAdminWelcomeUrl()}>
                Comenzar gratis <ArrowRight aria-hidden="true" size={18} />
              </a>
              <a className="public-lanzo-story-link" href="#historia">
                Conoce nuestra historia <ArrowDown aria-hidden="true" size={17} />
              </a>
            </div>
            <ul className="public-lanzo-hero__proof" aria-label="Características de LANZO Free">
              <li><Check aria-hidden="true" size={16} /> Free permanente</li>
              <li><WifiOff aria-hidden="true" size={16} /> Operación local*</li>
              <li><Store aria-hidden="true" size={16} /> Tienda en línea incluida*</li>
            </ul>
            <p className="public-lanzo-hero__note">
              * La tienda necesita internet y permite publicar hasta 10 productos en Free. Este límite no aplica al catálogo interno.
            </p>
          </div>
          <div className="public-lanzo-hero__visual" aria-hidden="true">
            <span className="public-lanzo-hero__visual-orbit public-lanzo-hero__visual-orbit--one" />
            <span className="public-lanzo-hero__visual-orbit public-lanzo-hero__visual-orbit--two" />
            <div className="public-lanzo-hero__visual-mark"><LogoMark /></div>
            <div className="public-lanzo-hero__visual-note public-lanzo-hero__visual-note--local">
              <WifiOff size={18} /><span><small>Empieza aquí</small><strong>Tu negocio, en tu equipo</strong></span>
            </div>
            <div className="public-lanzo-hero__visual-note public-lanzo-hero__visual-note--cloud">
              <Cloud size={18} /><span><small>Cuando lo necesites</small><strong>Conecta con Nube</strong></span>
            </div>
          </div>
        </section>

        <section className="public-lanzo-section public-lanzo-story" id="historia" aria-labelledby="story-title">
          <div className="public-lanzo-story__intro">
            <p className="public-lanzo-eyebrow">Nuestra historia</p>
            <h2 id="story-title">Nacimos de una experiencia real emprendiendo.</h2>
          </div>
          <div className="public-lanzo-story__copy">
            <p>Antes de LANZO hubo un pequeño negocio de alitas, muchas jornadas de trabajo y una pregunta que cualquier emprendedor conoce: ¿realmente está dejando ganancia?</p>
            <p>Entre ventas, productos, costos y cuentas, administrar el negocio también significaba buscar herramientas que ayudaran a ver qué estaba pasando. Algunos sistemas ponían límites a tareas esenciales.</p>
            <p>De esa experiencia nació una idea sencilla: crear herramientas accesibles para que los pequeños comerciantes puedan organizarse y comprender mejor su operación, sin que una mensualidad sea un obstáculo para comenzar.</p>
          </div>
        </section>

        <section className="public-lanzo-section" aria-labelledby="commitments-title">
          <div className="public-lanzo-section__heading">
            <p className="public-lanzo-eyebrow">Nuestro compromiso</p>
            <h2 id="commitments-title">Herramientas útiles, con límites claros.</h2>
          </div>
          <div className="public-lanzo-commitments">
            {COMMITMENTS.map(({ title, description, Icon }, index) => (
              <article key={title}>
                <span className="public-lanzo-commitments__number">0{index + 1}</span>
                <span className="public-lanzo-commitments__icon"><Icon aria-hidden="true" size={20} /></span>
                <div><h3>{title}</h3><p>{description}</p></div>
              </article>
            ))}
          </div>
        </section>

        <section className="public-lanzo-section" aria-labelledby="capabilities-title">
          <div className="public-lanzo-section__heading">
            <p className="public-lanzo-eyebrow">Lo esencial para operar</p>
            <h2 id="capabilities-title">Tres formas de acompañar tu negocio.</h2>
            <p>LANZO reúne herramientas para el día a día y para entender mejor la información de tu operación.</p>
          </div>
          <div className="public-lanzo-areas">
            {BUSINESS_AREAS.map(({ title, description, features, Icon }) => (
              <article key={title}>
                <span className="public-lanzo-areas__icon"><Icon aria-hidden="true" size={22} /></span>
                <h3>{title}</h3>
                <p>{description}</p>
                <ul>{features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
              </article>
            ))}
          </div>
          <div className="public-lanzo-business-types">
            <h3>Para distintos giros</h3>
            <ul>{BUSINESS_TYPES.map((type) => <li key={type}>{type}</li>)}</ul>
            <p>Las herramientas disponibles dependen del plan, los permisos y la configuración de cada negocio.</p>
          </div>
        </section>

        <section className="public-lanzo-section public-lanzo-plans-section" id="planes" aria-labelledby="plans-title">
          <div className="public-lanzo-section__heading">
            <p className="public-lanzo-eyebrow">Tú eliges cómo empezar</p>
            <h2 id="plans-title">LANZO Free es suficiente para comenzar. PRO es opcional.</h2>
            <p>Elige lo que te sirve hoy. No necesitas contratar Nube para seguir usando las herramientas esenciales.</p>
          </div>
          <div className="public-lanzo-plans">
            <PlanCard
              type="LANZO FREE · LOCAL"
              title="Gratis para siempre"
              description="Un punto de partida para vender y organizar tu negocio desde un dispositivo. No es una prueba temporal de PRO."
              features={FREE_FEATURES}
              ctaLabel="Comenzar gratis"
            />
            <PlanCard
              type="LANZO PRO · NUBE"
              title="Más herramientas si las necesitas"
              description="Un servicio de pago opcional para negocios que necesitan conectar dispositivos y trabajar en equipo."
              features={PRO_FEATURES}
              ctaLabel="Explorar opciones en LANZO"
              featured
            />
          </div>
          <p className="public-lanzo-plans__note">Las capacidades y los límites de los servicios conectados dependen de la licencia y configuración vigentes.</p>
        </section>

        <section className="public-lanzo-section" aria-labelledby="steps-title">
          <div className="public-lanzo-section__heading">
            <p className="public-lanzo-eyebrow">Empieza a tu ritmo</p>
            <h2 id="steps-title">Un comienzo sencillo, paso a paso.</h2>
          </div>
          <ol className="public-lanzo-steps">
            {STEPS.map(([number, title, description]) => (
              <li key={number}>
                <span>{number}</span><h3>{title}</h3><p>{description}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="public-lanzo-section public-lanzo-faq" aria-labelledby="faq-title">
          <div className="public-lanzo-section__heading">
            <p className="public-lanzo-eyebrow">Preguntas frecuentes</p>
            <h2 id="faq-title">Respuestas claras para empezar con confianza.</h2>
          </div>
          <div className="public-lanzo-faq__list">
            {FAQS.map(({ question, answer }) => (
              <details key={question}>
                <summary>{question}<span aria-hidden="true" /></summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="public-lanzo-final-cta" aria-labelledby="final-cta-title">
          <div>
            <p className="public-lanzo-eyebrow">Acompañamos tu camino</p>
            <h2 id="final-cta-title">Tu negocio merece herramientas que lo acompañen desde el primer día.</h2>
            <p>Empieza con LANZO Free, organiza tu operación y crece a tu propio ritmo. No tienes que contratar PRO para seguir usando las herramientas esenciales.</p>
          </div>
          <a className="ui-button ui-button--primary public-lanzo-primary-cta" href={buildAdminWelcomeUrl()}>
            Comenzar gratis <ArrowRight aria-hidden="true" size={18} />
          </a>
        </section>
      </main>
    </div>
  );
}

export default PublicLanzoLandingPage;
