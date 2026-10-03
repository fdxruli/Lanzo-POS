import { useEffect } from 'react';
import {
  ArrowRight,
  BarChart3,
  Boxes,
  Check,
  CircleCheck,
  Cloud,
  MonitorSmartphone,
  PackageCheck,
  Search,
  ShoppingBag,
  Smartphone,
  Store,
  Users,
} from 'lucide-react';
import LogoMark from '../components/common/LogoMark';
import {
  PUBLIC_STORE_ORIGIN,
  buildAdminWelcomeUrl,
} from '../config/publicOrigins';
import './PublicStoreHomePage.css';

const FREE_FEATURES = [
  'Tienda online incluida',
  'Hasta 10 productos publicados',
  'Catálogo para compartir con tus clientes',
  'Recepción de pedidos desde la tienda',
];

const PRO_FEATURES = [
  'Publicación de productos sin límite según el contrato vigente',
  'Lanzo Nube y operación conectada',
  'Múltiples dispositivos según tu licencia',
  'Capacidades avanzadas de ecommerce y operación',
];

const CUSTOMER_FEATURES = [
  ['Busca lo que necesita', 'Búsqueda y categorías ayudan a recorrer el catálogo.', Search],
  ['Arma su pedido', 'Productos, cantidades y carrito mantienen el pedido organizado.', ShoppingBag],
  ['Confirma desde la tienda', 'El checkout valida el pedido y las opciones disponibles del negocio.', CircleCheck],
];

const INTEGRATION_ITEMS = [
  ['Catálogo', 'Publica desde Lanzo los productos que quieres mostrar en tu tienda.', Boxes],
  ['Pedidos', 'Los pedidos creados en la tienda entran al flujo de ecommerce de Lanzo.', PackageCheck],
  ['Operación', 'Punto de venta, inventario, clientes y reportes viven dentro del mismo ecosistema.', BarChart3],
  ['Lanzo Nube', 'Las capacidades cloud, de equipo y sincronización dependen del plan y la configuración.', Cloud],
];

const useStoreHomeMetadata = () => {
  useEffect(() => {
    const previousTitle = document.title;
    const restore = [];

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

    const canonicalUrl = new URL('/', PUBLIC_STORE_ORIGIN).toString();
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

    document.title = 'Lanzo Tienda Online | Vende por internet con Lanzo';
    setMeta(
      'name',
      'description',
      'Crea tu tienda en línea con Lanzo, publica tus productos y recibe pedidos conectados con la operación de tu negocio.'
    );
    setMeta('property', 'og:type', 'website');
    setMeta('property', 'og:title', 'Lanzo Tienda Online | Vende por internet con Lanzo');
    setMeta(
      'property',
      'og:description',
      'Publica tus productos, comparte tu tienda y recibe pedidos desde el mismo ecosistema de Lanzo.'
    );
    setMeta('property', 'og:url', canonicalUrl);
    setMeta('name', 'twitter:card', 'summary');
    setMeta('name', 'twitter:title', 'Lanzo Tienda Online | Vende por internet con Lanzo');
    setMeta(
      'name',
      'twitter:description',
      'Una tienda en línea lista para compartir y conectada con la operación de tu negocio.'
    );

    return () => {
      document.title = previousTitle;
      restore.reverse().forEach((restoreMetadata) => restoreMetadata());
    };
  }, []);
};

function ProductPreviewCard({ name, price, badge }) {
  return (
    <article className="public-store-home-product">
      <div className="public-store-home-product__image" aria-hidden="true">
        <span>{badge}</span>
      </div>
      <div className="public-store-home-product__content">
        <p>{name}</p>
        <strong>{price}</strong>
        <span>Agregar</span>
      </div>
    </article>
  );
}

function PlanCard({ label, title, description, features, featured = false }) {
  return (
    <article className={`public-store-home-plan${featured ? ' public-store-home-plan--featured' : ''}`}>
      <div className="public-store-home-plan__top">
        <span>{label}</span>
        {featured ? <small>Para crecer</small> : null}
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      <ul>
        {features.map((feature) => (
          <li key={feature}>
            <Check aria-hidden="true" size={17} />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <a
        className={`ui-button ${featured ? 'ui-button--secondary' : 'ui-button--primary'}`}
        href={buildAdminWelcomeUrl()}
      >
        Crear mi tienda con Lanzo <ArrowRight aria-hidden="true" size={17} />
      </a>
    </article>
  );
}

function PublicStoreHomePage() {
  useStoreHomeMetadata();

  return (
    <main className="public-store-home">
      <header className="public-store-home-nav">
        <a className="public-store-home-brand" href="/" aria-label="Lanzo Tienda Online, inicio">
          <span className="public-store-home-brand__mark" aria-hidden="true"><LogoMark /></span>
          <span><strong>Lanzo</strong><small>Tienda Online</small></span>
        </a>

        <nav className="public-store-home-nav__links" aria-label="Navegación principal">
          <a href="#como-funciona">Cómo funciona</a>
          <a href="#ventajas">Ventajas</a>
          <a href="#planes">FREE y PRO</a>
        </nav>

        <a className="ui-button ui-button--primary public-store-home-nav__cta" href={buildAdminWelcomeUrl()}>
          Crear mi tienda
        </a>
      </header>

      <section className="public-store-home-hero" aria-labelledby="public-store-home-title">
        <div className="public-store-home-hero__content">
          <p className="public-store-home-eyebrow"><Store aria-hidden="true" size={16} /> Lanzo Tienda Online</p>
          <h1 id="public-store-home-title">Una tienda en línea lista para compartir, conectada a tu negocio.</h1>
          <p className="public-store-home-hero__lead">
            Publica tus productos, recibe pedidos por internet y adminístralos desde el mismo ecosistema de Lanzo,
            sin tener que construir una tienda desde cero.
          </p>
          <div className="public-store-home-hero__actions">
            <a className="ui-button ui-button--secondary" href={buildAdminWelcomeUrl()}>
              Crear mi tienda con Lanzo <ArrowRight aria-hidden="true" size={18} />
            </a>
            <a className="ui-button ui-button--neutral" href="#como-funciona">Ver cómo funciona</a>
          </div>
          <div className="public-store-home-hero__proof" aria-label="Ventajas principales">
            <span><Smartphone aria-hidden="true" size={17} />Lista para móvil</span>
            <span><ShoppingBag aria-hidden="true" size={17} />Carrito y pedidos</span>
            <span><Boxes aria-hidden="true" size={17} />Catálogo publicado desde Lanzo</span>
          </div>
        </div>

        <div className="public-store-home-demo" aria-label="Ejemplo visual de una tienda Lanzo">
          <div className="public-store-home-demo__desktop">
            <div className="public-store-home-demo__chrome" aria-hidden="true">
              <span /><span /><span />
              <small>lanzo-store.vercel.app/tienda/dulce-momento</small>
            </div>
            <div className="public-store-home-demo__store-head">
              <div>
                <span className="public-store-home-demo__logo">DM</span>
                <div><strong>Dulce Momento</strong><small>Repostería artesanal</small></div>
              </div>
              <span className="public-store-home-demo__cart"><ShoppingBag aria-hidden="true" size={16} /> 2</span>
            </div>
            <div className="public-store-home-demo__search"><Search aria-hidden="true" size={16} /> Buscar productos</div>
            <div className="public-store-home-demo__chips" aria-hidden="true">
              <span>Todos</span><span>Cupcakes</span><span>Pasteles</span><span>Galletas</span>
            </div>
            <div className="public-store-home-demo__products">
              <ProductPreviewCard name="Cupcake de chocolate" price="$38" badge="🍫" />
              <ProductPreviewCard name="Cupcake de vainilla" price="$36" badge="🧁" />
              <ProductPreviewCard name="Pastel de fresas" price="$320" badge="🍓" />
              <ProductPreviewCard name="Galletas" price="$55" badge="🍪" />
            </div>
          </div>

          <div className="public-store-home-demo__phone" aria-hidden="true">
            <div className="public-store-home-demo__phone-top" />
            <span className="public-store-home-demo__phone-brand">Dulce Momento</span>
            <div className="public-store-home-demo__phone-product">🍓</div>
            <strong>Pastel de fresas</strong>
            <small>$320</small>
            <span className="public-store-home-demo__phone-button">Agregar al carrito</span>
          </div>
        </div>
      </section>

      <section className="public-store-home-section" id="como-funciona" aria-labelledby="store-steps-title">
        <div className="public-store-home-section__heading">
          <p className="public-store-home-eyebrow">Empieza sin complicaciones</p>
          <h2 id="store-steps-title">Tu tienda en línea en 3 simples pasos</h2>
          <p>Configura lo esencial en Lanzo, decide qué publicar y comparte tu enlace con tus clientes.</p>
        </div>
        <div className="public-store-home-steps">
          <article><span>01</span><h3>Crea tu negocio</h3><p>Regístrate en Lanzo y configura la información básica de tu negocio.</p></article>
          <article><span>02</span><h3>Publica tus productos</h3><p>Elige los productos que quieres mostrar y prepara su información pública.</p></article>
          <article><span>03</span><h3>Comparte tu tienda</h3><p>Usa una dirección como <code>lanzo-store.vercel.app/tienda/tu-negocio</code> y compártela con tus clientes.</p></article>
        </div>
      </section>

      <section className="public-store-home-section" id="ventajas" aria-labelledby="customer-experience-title">
        <div className="public-store-home-split">
          <div className="public-store-home-section__heading">
            <p className="public-store-home-eyebrow">Experiencia del cliente</p>
            <h2 id="customer-experience-title">Una tienda pensada para tus clientes</h2>
            <p>
              El catálogo público actual permite buscar productos, navegar por categorías, agregar al carrito y
              continuar al checkout cuando el negocio está aceptando pedidos.
            </p>
          </div>
          <div className="public-store-home-feature-list">
            {CUSTOMER_FEATURES.map(([title, description, Icon]) => (
              <article key={title}>
                <span><Icon aria-hidden="true" size={20} /></span>
                <div><h3>{title}</h3><p>{description}</p></div>
              </article>
            ))}
          </div>
        </div>

        <div className="public-store-home-device-strip" aria-label="Diseño adaptable">
          <span><MonitorSmartphone aria-hidden="true" size={22} />Diseño adaptable</span>
          <span><Smartphone aria-hidden="true" size={22} />Móvil y escritorio</span>
          <span><ShoppingBag aria-hidden="true" size={22} />Carrito de compras</span>
          <span><PackageCheck aria-hidden="true" size={22} />Recepción de pedidos</span>
        </div>
      </section>

      <section className="public-store-home-section public-store-home-integration" aria-labelledby="integration-title">
        <div className="public-store-home-section__heading">
          <p className="public-store-home-eyebrow">El diferencial de Lanzo</p>
          <h2 id="integration-title">No es una tienda aislada. Es parte de Lanzo.</h2>
          <p>
            Tu presencia online vive dentro del mismo producto con el que administras la operación. Las capacidades
            exactas dependen del plan, del rubro y de la configuración activa de cada negocio.
          </p>
        </div>
        <div className="public-store-home-integration__grid">
          {INTEGRATION_ITEMS.map(([title, description, Icon]) => (
            <article key={title}>
              <span><Icon aria-hidden="true" size={21} /></span>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
        <div className="public-store-home-integration__note">
          <Users aria-hidden="true" size={19} />
          <p>
            Lanzo también incluye herramientas de clientes y reportes. No todas las funciones requieren ni ofrecen
            el mismo nivel de sincronización: PRO y Lanzo Nube habilitan las capacidades conectadas que correspondan.
          </p>
        </div>
      </section>

      <section className="public-store-home-section" id="planes" aria-labelledby="plans-title">
        <div className="public-store-home-section__heading">
          <p className="public-store-home-eyebrow">Empieza y crece a tu ritmo</p>
          <h2 id="plans-title">Tienda Online en FREE y más capacidad con PRO</h2>
          <p>Sin precios inventados: elige el plan por las capacidades que necesitas para operar.</p>
        </div>
        <div className="public-store-home-plans">
          <PlanCard
            label="FREE"
            title="Empieza con tu catálogo online"
            description="Una forma sencilla de publicar una selección de productos y recibir pedidos."
            features={FREE_FEATURES}
          />
          <PlanCard
            label="PRO"
            title="Conecta una operación que está creciendo"
            description="Más capacidad de publicación y herramientas cloud para trabajar en equipo."
            features={PRO_FEATURES}
            featured
          />
        </div>
      </section>

      <section className="public-store-home-looking" aria-labelledby="looking-store-title">
        <div>
          <p className="public-store-home-eyebrow">Acceso a tiendas</p>
          <h2 id="looking-store-title">¿Buscas la tienda de un negocio?</h2>
          <p>Las tiendas creadas con Lanzo utilizan una dirección como:</p>
          <code>lanzo-store.vercel.app/tienda/nombre-del-negocio</code>
          <p>Solicita al negocio su enlace completo para acceder a su tienda.</p>
        </div>
        <div className="public-store-home-looking__privacy">
          <Store aria-hidden="true" size={22} />
          <div><strong>Sin directorio público</strong><span>Lanzo no muestra ni enumera negocios desde esta página.</span></div>
        </div>
      </section>

      <section className="public-store-home-final" aria-labelledby="store-final-title">
        <div>
          <p className="public-store-home-eyebrow">Tu negocio también puede vender en línea</p>
          <h2 id="store-final-title">Convierte tu catálogo en un enlace listo para compartir.</h2>
          <p>Crea tu negocio en Lanzo y configura tu Tienda Online desde el mismo sistema.</p>
        </div>
        <div className="public-store-home-final__actions">
          <a className="ui-button ui-button--secondary" href={buildAdminWelcomeUrl()}>
            Crear mi tienda con Lanzo <ArrowRight aria-hidden="true" size={18} />
          </a>
          <a className="public-store-home-final__learn" href="/conoce-lanzo">Conocer todo Lanzo</a>
        </div>
      </section>
    </main>
  );
}

export default PublicStoreHomePage;
