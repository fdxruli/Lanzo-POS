import {
  Apple,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Boxes,
  Check,
  Cloud,
  Hammer,
  MonitorSmartphone,
  Pill,
  ReceiptText,
  ShieldCheck,
  Shirt,
  ShoppingBag,
  Sparkles,
  Store,
  Utensils,
  WifiOff,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import LogoMark from '../components/common/LogoMark';
import { buildAdminWelcomeUrl } from '../config/publicOrigins';
import './PublicLanzoLandingPage.css';

const CAPABILITIES = [
  {
    title: 'Punto de venta ágil',
    description: 'Registra ventas, administra pedidos y mantén tu operación diaria en movimiento.',
    Icon: ReceiptText,
  },
  {
    title: 'Productos e inventario',
    description: 'Organiza tu catálogo, existencias, precios y alertas desde un mismo sistema.',
    Icon: Boxes,
  },
  {
    title: 'Caja y control',
    description: 'Da seguimiento a aperturas, movimientos, cortes y resultados de cada jornada.',
    Icon: ShieldCheck,
  },
  {
    title: 'Clientes y reportes',
    description: 'Conoce qué vendes, cómo se mueve tu negocio y dónde están tus oportunidades.',
    Icon: BarChart3,
  },
  {
    title: 'Tienda en línea',
    description: 'Publica tus productos y recibe pedidos desde un catálogo disponible para tus clientes.',
    Icon: Store,
  },
  {
    title: 'Operación que crece contigo',
    description: 'Empieza en un dispositivo y activa nube, equipo e inteligencia cuando lo necesites.',
    Icon: Cloud,
  },
];

const BUSINESS_TYPES = [
  { title: 'Restaurante / Cocina', description: 'Pedidos, mesas, comandas y preparación conectadas con tu operación.', Icon: Utensils },
  { title: 'Abarrotes / Tienda', description: 'Venta rápida, inventario, precios y control diario de productos.', Icon: Store },
  { title: 'Farmacia', description: 'Lotes, caducidades, existencias y datos especializados para tus productos.', Icon: Pill },
  { title: 'Frutería / Verdulería', description: 'Productos por pieza o a granel con control claro de inventario.', Icon: Apple },
  { title: 'Ropa / Calzado', description: 'Variantes, tallas y existencias para organizar cada presentación.', Icon: Shirt },
  { title: 'Ferretería', description: 'Catálogo, venta por unidad o medida y seguimiento de existencias.', Icon: Hammer },
];

const FREE_FEATURES = [
  'Punto de venta, caja y cortes locales',
  'Productos e inventario en un dispositivo',
  'Clientes y reportes locales',
  'Tienda online con hasta 10 productos publicados',
  'Funcionamiento local incluso sin internet',
  'Respaldo manual de tu información',
];

const PRO_FEATURES = [
  'Sincronización con Lanzo Nube',
  'Hasta 5 dispositivos según tu licencia',
  'Staff, roles y permisos',
  'Ventas, caja, clientes y reportes cloud',
  'Tienda online con productos ilimitados y pedidos centralizados',
  'Operación de restaurante e IA según tu plan',
];

const STEPS = [
  ['01', 'Crea tu licencia FREE', 'Comienza con Lanzo Local y configura la información básica de tu negocio.'],
  ['02', 'Organiza tu operación', 'Carga tus productos y empieza a vender, controlar caja e inventario.'],
  ['03', 'Activa PRO al crecer', 'Suma nube, dispositivos, colaboradores y herramientas avanzadas cuando las necesites.'],
];

const getStoreReturnPath = (searchParams) => {
  const slug = searchParams.get('tienda') || '';
  return /^[^/?#]+$/.test(slug) ? `/tienda/${encodeURIComponent(slug)}` : '/tienda';
};

function PlanCard({ type, title, description, features, featured = false }) {
  return (
    <article className={`public-lanzo-plan${featured ? ' public-lanzo-plan--featured' : ''}`}>
      <div className="public-lanzo-plan__header">
        <span className="public-lanzo-plan__badge">{type}</span>
        {featured ? <span className="public-lanzo-plan__recommended">Para crecer</span> : null}
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      <ul>
        {features.map((feature) => (
          <li key={feature}><Check aria-hidden="true" size={17} /><span>{feature}</span></li>
        ))}
      </ul>
      <a
        className={`ui-button ${featured ? 'ui-button--secondary' : 'ui-button--primary'} public-lanzo-plan__cta`}
        href={buildAdminWelcomeUrl()}
      >
        {featured ? 'Comenzar y conocer PRO' : 'Crear mi licencia FREE'}
        <ArrowRight aria-hidden="true" size={17} />
      </a>
    </article>
  );
}

function PublicLanzoLandingPage() {
  const [searchParams] = useSearchParams();
  const returnPath = getStoreReturnPath(searchParams);

  return (
    <main className="public-lanzo-landing">
      <header className="public-lanzo-nav">
        <a className="public-lanzo-brand" href={returnPath} aria-label="Lanzo, volver a la tienda">
          <span className="public-lanzo-brand__mark" aria-hidden="true"><LogoMark /></span>
          <span><strong>Lanzo</strong><small>Controla hoy. Crece mañana.</small></span>
        </a>
        <a className="public-lanzo-nav__back" href={returnPath}>
          <ArrowLeft aria-hidden="true" size={17} /> Volver a la tienda
        </a>
      </header>

      <section className="public-lanzo-hero" aria-labelledby="public-lanzo-title">
        <div className="public-lanzo-hero__content">
          <p className="public-lanzo-eyebrow"><Sparkles aria-hidden="true" size={16} /> Hecho para negocios reales</p>
          <h1 id="public-lanzo-title">Todo lo que necesitas para vender, controlar y crecer.</h1>
          <p className="public-lanzo-hero__lead">
            Lanzo reúne punto de venta, caja, productos, inventario, clientes, reportes y tienda online
            en una experiencia sencilla. Empieza gratis en un dispositivo y conecta tu operación con
            Lanzo Nube cuando tu negocio pida más.
          </p>
          <div className="public-lanzo-hero__actions">
            <a className="ui-button ui-button--secondary public-lanzo-primary-cta" href={buildAdminWelcomeUrl()}>
              Crear mi licencia FREE <ArrowRight aria-hidden="true" size={18} />
            </a>
            <a className="ui-button ui-button--neutral" href="#planes">Comparar FREE y PRO</a>
          </div>
          <div className="public-lanzo-hero__proof" aria-label="Ventajas de Lanzo">
            <span><WifiOff aria-hidden="true" size={17} />Operación local</span>
            <span><MonitorSmartphone aria-hidden="true" size={17} />Crece a múltiples dispositivos</span>
            <span><ShoppingBag aria-hidden="true" size={17} />Tienda online integrada</span>
          </div>
        </div>
        <div className="public-lanzo-hero__visual" aria-hidden="true">
          <div className="public-lanzo-hero__visual-mark"><LogoMark /></div>
          <div className="public-lanzo-hero__visual-card public-lanzo-hero__visual-card--sales">
            <BarChart3 size={20} /><span><small>Ventas organizadas</small><strong>Decide con información</strong></span>
          </div>
          <div className="public-lanzo-hero__visual-card public-lanzo-hero__visual-card--cloud">
            <Cloud size={20} /><span><small>Lanzo Nube</small><strong>Tu equipo conectado</strong></span>
          </div>
        </div>
      </section>

      <section className="public-lanzo-section" aria-labelledby="capabilities-title">
        <div className="public-lanzo-section__heading">
          <p className="public-lanzo-eyebrow">Una sola plataforma</p>
          <h2 id="capabilities-title">Menos herramientas separadas. Más claridad para operar.</h2>
          <p>Lanzo conecta las áreas que mueven tu negocio para que tengas control sin complicar tu día.</p>
        </div>
        <div className="public-lanzo-capabilities">
          {CAPABILITIES.map(({ title, description, Icon }) => (
            <article key={title}>
              <span className="public-lanzo-capabilities__icon"><Icon aria-hidden="true" size={22} /></span>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="public-lanzo-section" aria-labelledby="business-types-title">
        <div className="public-lanzo-section__heading">
          <p className="public-lanzo-eyebrow">Se adapta a tu forma de vender</p>
          <h2 id="business-types-title">Un sistema preparado para distintos tipos de negocio.</h2>
          <p>Activa las herramientas que corresponden a tu rubro y trabaja con una experiencia más cercana a tu operación real.</p>
        </div>
        <div className="public-lanzo-business-types">
          {BUSINESS_TYPES.map(({ title, description, Icon }) => (
            <article key={title}>
              <span className="public-lanzo-business-types__icon"><Icon aria-hidden="true" size={21} /></span>
              <div><h3>{title}</h3><p>{description}</p></div>
            </article>
          ))}
        </div>
      </section>

      <section className="public-lanzo-section public-lanzo-plans-section" id="planes" aria-labelledby="plans-title">
        <div className="public-lanzo-section__heading">
          <p className="public-lanzo-eyebrow">Elige cómo comenzar</p>
          <h2 id="plans-title">FREE para empezar. PRO para conectar y escalar.</h2>
          <p>No tienes que implementar todo desde el primer día. Usa lo que tu negocio necesita ahora.</p>
        </div>
        <div className="public-lanzo-plans">
          <PlanCard
            type="FREE · Lanzo Local"
            title="Control esencial en un dispositivo"
            description="Ideal para comenzar a vender y organizar tu negocio con una operación local sencilla."
            features={FREE_FEATURES}
          />
          <PlanCard
            type="PRO · Lanzo Nube"
            title="Tu operación conectada"
            description="Para negocios que trabajan en equipo, necesitan más dispositivos y quieren crecer con la nube."
            features={PRO_FEATURES}
            featured
          />
        </div>
      </section>

      <section className="public-lanzo-section" aria-labelledby="steps-title">
        <div className="public-lanzo-section__heading">
          <p className="public-lanzo-eyebrow">Empieza a tu ritmo</p>
          <h2 id="steps-title">De tu primera venta a una operación conectada.</h2>
        </div>
        <div className="public-lanzo-steps">
          {STEPS.map(([number, title, description]) => (
            <article key={number}>
              <span>{number}</span><h3>{title}</h3><p>{description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="public-lanzo-final-cta" aria-labelledby="final-cta-title">
        <div>
          <p className="public-lanzo-eyebrow">Tu negocio puede empezar hoy</p>
          <h2 id="final-cta-title">Dale a tu operación el orden que necesita para crecer.</h2>
          <p>Crea tu licencia FREE, configura tu negocio y descubre Lanzo desde dentro.</p>
        </div>
        <a className="ui-button ui-button--secondary public-lanzo-primary-cta" href={buildAdminWelcomeUrl()}>
          Comenzar con Lanzo <ArrowRight aria-hidden="true" size={18} />
        </a>
      </section>
    </main>
  );
}

export default PublicLanzoLandingPage;
