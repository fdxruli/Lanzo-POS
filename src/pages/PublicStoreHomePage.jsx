import { useEffect } from 'react';
import {
  ArrowRight,
  Boxes,
  Check,
  Cloud,
  ExternalLink,
  MessageCircle,
  MonitorSmartphone,
  PackageCheck,
  Search,
  ShoppingBag,
  Store,
  Wifi,
} from 'lucide-react';
import LogoMark from '../components/common/LogoMark';
import {
  PUBLIC_STORE_ORIGIN,
  buildAdminWelcomeUrl,
} from '../config/publicOrigins';
import './PublicStoreHomePage.css';

const STORE_HOME_TITLE = 'Tienda Online LANZO | Publica tus productos gratis';
const STORE_HOME_DESCRIPTION = 'Crea gratis tu tienda online con LANZO Free. Publica hasta 10 productos en internet, comparte tu catálogo y recibe pedidos. Tu catálogo interno del POS no cambia.';

const MERCHANT_BENEFITS = [
  ['Elige qué mostrar', 'Publica una selección de productos con sus precios e información disponible.', Boxes],
  ['Comparte tu enlace', 'Cada negocio tiene su propia dirección para compartir con sus clientes.', ExternalLink],
  ['Revisa los pedidos', 'Gestiona los pedidos enviados desde la tienda en la bandeja disponible en tu licencia.', PackageCheck],
  ['Crece a tu ritmo', 'Free conserva las herramientas esenciales. Nube suma capacidades conectadas cuando las necesitas.', Cloud],
];

const CUSTOMER_BENEFITS = [
  ['Busca y explora', 'Encuentra productos y navega por las categorías disponibles.', Search],
  ['Consulta detalles', 'Revisa precios e información que el negocio haya publicado.', Store],
  ['Arma su pedido', 'Agrega artículos al carrito y completa la información solicitada.', ShoppingBag],
  ['Envía una solicitud', 'Cuando la tienda acepta pedidos, el cliente puede enviarlo al negocio.', MessageCircle],
];

const STEPS = [
  ['Comienza con LANZO', 'Crea tu licencia gratuita y configura la información básica de tu negocio.'],
  ['Prepara tu tienda', 'Elige los productos que quieres publicar, añade su información y configura las opciones disponibles.'],
  ['Comparte tu enlace', 'Publica la tienda cuando esté lista y comparte su enlace con tus clientes.'],
];

const FREE_FEATURES = [
  'Tienda online incluida en LANZO Free',
  'Hasta 10 productos publicados en internet',
  'Catálogo público para compartir',
  'Bandeja para revisar los pedidos recibidos',
];

const PRO_FEATURES = [
  'Publicación sin límite numérico definido por la licencia',
  'Catálogo conectado y opciones de existencias según licencia',
  'Actualizaciones en tiempo real de pedidos cuando estén habilitadas',
  'Colaboración y operación en dispositivos según el plan',
];

const FAQS = [
  {
    question: '¿Puedo crear una tienda online sin pagar?',
    answer: 'Sí. LANZO Free incluye una tienda online y es gratuito para siempre; no es una prueba temporal de PRO. Puedes publicar hasta 10 productos en internet.',
  },
  {
    question: '¿Qué significa el límite de diez productos?',
    answer: 'Limita los productos publicados en tu tienda online con Free. No limita la cantidad de productos que puedes guardar en el catálogo interno de tu punto de venta.',
  },
  {
    question: '¿Necesito internet para utilizar la tienda?',
    answer: 'Sí. Publicar la tienda, consultar el catálogo público y enviar pedidos requiere internet y que la tienda esté configurada. Los módulos locales compatibles del punto de venta pueden seguir operando en el dispositivo sin conexión.',
  },
  {
    question: '¿Cómo recibo los pedidos de mis clientes?',
    answer: 'En Free, la tienda registra el pedido y puedes revisarlo en la bandeja incluida. Si WhatsApp está configurado, el cliente también puede abrirlo para enviar el resumen. PRO/Nube puede actualizar la bandeja en tiempo real cuando esa función está habilitada. El negocio confirma el pedido; enviarlo no significa que esté pagado.',
  },
  {
    question: '¿Mis clientes pueden pagar directamente en la página?',
    answer: 'No. El checkout registra una solicitud de pedido, pero no procesa un cobro en línea. El negocio confirma los detalles y acuerda el pago con el cliente.',
  },
  {
    question: '¿Necesito contratar PRO?',
    answer: 'No. Puedes seguir utilizando LANZO Free sin contratar PRO. Nube es un servicio opcional para quienes necesitan más capacidad y herramientas conectadas.',
  },
];

function useStoreHomeMetadata() {
  useEffect(() => {
    const previousTitle = document.title;
    const restore = [];

    const setMeta = (attribute, name, content) => {
      const selector = 'meta[' + attribute + '="' + name + '"]';
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

    document.title = STORE_HOME_TITLE;
    setMeta('name', 'description', STORE_HOME_DESCRIPTION);
    setMeta('property', 'og:type', 'website');
    setMeta('property', 'og:title', STORE_HOME_TITLE);
    setMeta('property', 'og:description', STORE_HOME_DESCRIPTION);
    setMeta('property', 'og:url', canonicalUrl);
    setMeta('name', 'twitter:card', 'summary');
    setMeta('name', 'twitter:title', STORE_HOME_TITLE);
    setMeta('name', 'twitter:description', STORE_HOME_DESCRIPTION);

    return () => {
      document.title = previousTitle;
      restore.reverse().forEach((restoreMetadata) => restoreMetadata());
    };
  }, []);
}

function ProductPreviewCard({ name, price, badge }) {
  return (
    <article className="public-store-home-product">
      <div className="public-store-home-product__image">
        <span>{badge}</span>
      </div>
      <div className="public-store-home-product__content">
        <p>{name}</p>
        <strong>{price}</strong>
      </div>
    </article>
  );
}

function PlanCard({ label, title, subtitle, description, features }) {
  return (
    <article className="public-store-home-plan">
      <div className="public-store-home-plan__top">
        <span>{label}</span>
        <small>{subtitle}</small>
      </div>
      <h3>{title}</h3>
      <p className="public-store-home-plan__description">{description}</p>
      <ul>
        {features.map((feature) => (
          <li key={feature}>
            <Check aria-hidden="true" size={17} />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function PublicStoreHomePage() {
  useStoreHomeMetadata();

  return (
    <div className="public-store-home">
      <header className="public-store-home-nav">
        <div className="public-store-home-nav__inner">
          <a className="public-store-home-brand" href="/" aria-label="LANZO Tienda Online, inicio">
            <span className="public-store-home-brand__mark" aria-hidden="true"><LogoMark /></span>
            <span className="public-store-home-brand__copy"><strong>LANZO</strong><small>Controla hoy. Crece mañana.</small></span>
          </a>

          <nav className="public-store-home-nav__links" aria-label="Navegación principal">
            <a href="#como-funciona">Cómo funciona</a>
            <a href="#beneficios">Beneficios</a>
            <a href="#planes">Free y PRO</a>
            <a href="/conoce-lanzo">Conoce LANZO</a>
          </nav>

        </div>
      </header>

      <main className="public-store-home__main">
        <section className="public-store-home-hero" aria-labelledby="public-store-home-title">
          <div className="public-store-home-hero__content">
            <p className="public-store-home-eyebrow"><Store aria-hidden="true" size={16} /> LANZO Tienda Online</p>
            <h1 id="public-store-home-title">Tu negocio también merece un lugar en internet.</h1>
            <p className="public-store-home-hero__lead">
              Comparte tus productos, recibe pedidos y facilita que tus clientes conozcan tu negocio.
              Con LANZO puedes comenzar con una tienda en línea gratuita y ampliar sus capacidades cuando lo necesites.
            </p>
            <div className="public-store-home-hero__actions">
              <a className="ui-button ui-button--primary" href={buildAdminWelcomeUrl()}>
                Crear mi tienda gratis <ArrowRight aria-hidden="true" size={18} />
              </a>
              <a className="public-store-home-hero__secondary" href="#como-funciona">Ver cómo funciona</a>
            </div>
            <ul className="public-store-home-hero__proof" aria-label="Características de LANZO Tienda Online">
              <li><Check aria-hidden="true" size={16} /> Gratis para siempre</li>
              <li><Boxes aria-hidden="true" size={17} /> Catálogo para compartir</li>
              <li><MonitorSmartphone aria-hidden="true" size={17} /> Móvil y escritorio</li>
            </ul>
            <aside className="public-store-home-limit" aria-label="Límite de publicación de LANZO Free">
              <span><Store aria-hidden="true" size={19} /></span>
              <p><strong>En LANZO Free puedes publicar hasta 10 productos en tu tienda online.</strong> Este límite no afecta el catálogo interno de tu punto de venta.</p>
            </aside>
          </div>

          <figure className="public-store-home-demo" aria-labelledby="store-demo-caption">
            <div className="public-store-home-demo__composition" aria-hidden="true">
              <div className="public-store-home-demo__desktop">
                <div className="public-store-home-demo__chrome">
                  <span /><span /><span />
                  <small>Tu tienda online</small>
                </div>
                <div className="public-store-home-demo__store-head">
                  <div>
                    <span className="public-store-home-demo__logo">DM</span>
                    <span className="public-store-home-demo__store-copy"><strong>Dulce Momento</strong><small>Repostería artesanal</small></span>
                  </div>
                  <span className="public-store-home-demo__cart"><ShoppingBag size={16} /> 2</span>
                </div>
                <div className="public-store-home-demo__search"><Search size={15} /> Buscar productos</div>
                <div className="public-store-home-demo__chips">
                  <span>Todos</span><span>Cupcakes</span><span>Pasteles</span><span>Galletas</span>
                </div>
                <div className="public-store-home-demo__products">
                  <ProductPreviewCard name="Cupcake de chocolate" price="$38" badge="🍫" />
                  <ProductPreviewCard name="Cupcake de vainilla" price="$36" badge="🧁" />
                  <ProductPreviewCard name="Pastel de fresas" price="$320" badge="🍓" />
                  <ProductPreviewCard name="Galletas" price="$55" badge="🍪" />
                </div>
              </div>

              <div className="public-store-home-demo__phone">
                <span className="public-store-home-demo__phone-camera" />
                <span className="public-store-home-demo__phone-brand">Dulce Momento</span>
                <span className="public-store-home-demo__phone-product">🍓</span>
                <strong>Pastel de fresas</strong>
                <small>$320</small>
                <span className="public-store-home-demo__phone-note">Disponible en la tienda</span>
              </div>
            </div>
            <figcaption id="store-demo-caption">
              <strong>Demostración visual.</strong> Dulce Momento y sus productos son ejemplos; los controles de la ilustración no son interactivos.
            </figcaption>
          </figure>
        </section>

        <section className="public-store-home-section" id="beneficios" aria-labelledby="store-benefits-title">
          <div className="public-store-home-section__heading">
            <p className="public-store-home-eyebrow">Una herramienta para compartir</p>
            <h2 id="store-benefits-title">Una tienda útil para quien vende y para quien compra.</h2>
            <p>LANZO reúne una vitrina sencilla para tus clientes y herramientas para que organices los pedidos de tu negocio.</p>
          </div>
          <div className="public-store-home-benefits">
            <article className="public-store-home-benefit">
              <p className="public-store-home-benefit__label">Para el comerciante</p>
              <h3>Tu catálogo, listo para mostrar.</h3>
              <ul>
                {MERCHANT_BENEFITS.map(([title, description, Icon]) => (
                  <li key={title}>
                    <span><Icon aria-hidden="true" size={19} /></span>
                    <div><strong>{title}</strong><p>{description}</p></div>
                  </li>
                ))}
              </ul>
            </article>
            <article className="public-store-home-benefit">
              <p className="public-store-home-benefit__label">Para sus clientes</p>
              <h3>Una forma clara de conocer tu oferta.</h3>
              <ul>
                {CUSTOMER_BENEFITS.map(([title, description, Icon]) => (
                  <li key={title}>
                    <span><Icon aria-hidden="true" size={19} /></span>
                    <div><strong>{title}</strong><p>{description}</p></div>
                  </li>
                ))}
              </ul>
            </article>
          </div>
          <p className="public-store-home-note">
            <Wifi aria-hidden="true" size={18} />
            Publicar la tienda y recibir pedidos requiere internet y completar la configuración correspondiente.
            LANZO Free incluye una bandeja de pedidos; las actualizaciones en tiempo real dependen del plan y la configuración.
          </p>
        </section>

        <section className="public-store-home-section" id="como-funciona" aria-labelledby="store-steps-title">
          <div className="public-store-home-section__heading">
            <p className="public-store-home-eyebrow">Empieza a tu ritmo</p>
            <h2 id="store-steps-title">Cómo funciona</h2>
            <p>Prepara lo esencial, elige qué compartir y publica la tienda cuando esté lista.</p>
          </div>
          <ol className="public-store-home-steps">
            {STEPS.map(([title, description], index) => (
              <li key={title}>
                <span className="public-store-home-steps__number">0{index + 1}</span>
                <div><h3>{title}</h3><p>{description}</p></div>
              </li>
            ))}
          </ol>
          <p className="public-store-home-steps__note">
            <Wifi aria-hidden="true" size={17} />
            La publicación y recepción de pedidos necesitan internet y la configuración correspondiente en tu tienda.
          </p>
        </section>

        <section className="public-store-home-section public-store-home-plans-section" id="planes" aria-labelledby="plans-title">
          <div className="public-store-home-section__heading">
            <p className="public-store-home-eyebrow">Tú decides cuándo crecer</p>
            <h2 id="plans-title">Empieza con Free. PRO es opcional.</h2>
            <p>Ambos planes forman parte de LANZO. Elige la capacidad que necesita tu negocio hoy.</p>
          </div>
          <div className="public-store-home-plans">
            <PlanCard
              label="LANZO FREE"
              title="Tu primera vitrina online"
              subtitle="Gratis para siempre · sin mensualidad"
              description="Publica una selección de productos y recibe pedidos sin contratar PRO."
              features={FREE_FEATURES}
            />
            <PlanCard
              label="LANZO PRO / NUBE"
              title="Más capacidad para crecer"
              subtitle="Servicio opcional"
              description="Suma herramientas conectadas cuando tu forma de trabajar lo requiera."
              features={PRO_FEATURES}
            />
          </div>
          <div className="public-store-home-plans__note">
            <p>Puedes seguir usando LANZO Free sin contratar PRO. El límite de diez productos se aplica a la publicación online, no al catálogo interno del punto de venta.</p>
            <a className="ui-button ui-button--primary" href={buildAdminWelcomeUrl()}>
              Crear mi tienda gratis <ArrowRight aria-hidden="true" size={17} />
            </a>
          </div>
        </section>

        <section className="public-store-home-section public-store-home-faq" id="preguntas-frecuentes" aria-labelledby="faq-title">
          <div className="public-store-home-section__heading">
            <p className="public-store-home-eyebrow">Respuestas claras</p>
            <h2 id="faq-title">Preguntas frecuentes</h2>
          </div>
          <div className="public-store-home-faq__list">
            {FAQS.map(({ question, answer }) => (
              <details key={question}>
                <summary>{question}</summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="public-store-home-looking" aria-labelledby="looking-store-title">
          <div>
            <p className="public-store-home-eyebrow">Acceso a tiendas</p>
            <h2 id="looking-store-title">¿Buscas la tienda de un negocio?</h2>
            <p>Cada negocio comparte su propio enlace. Pídeselo directamente para encontrar su tienda.</p>
          </div>
          <div className="public-store-home-looking__example">
            <code>lanzo-store.vercel.app/tu-negocio</code>
            <span>Esta página no es un directorio público de comercios.</span>
          </div>
        </section>

        <section className="public-store-home-final" aria-labelledby="store-final-title">
          <div>
            <p className="public-store-home-eyebrow">Desde el primer producto</p>
            <h2 id="store-final-title">Empieza a mostrar lo que haces.</h2>
            <p>No necesitas comenzar con una tienda enorme. Publica tus primeros productos, comparte tu enlace y permite que tus clientes conozcan tu negocio. LANZO puede acompañarte desde el principio.</p>
          </div>
          <div className="public-store-home-final__actions">
            <a className="ui-button ui-button--primary" href={buildAdminWelcomeUrl()}>
              Crear mi tienda gratis <ArrowRight aria-hidden="true" size={18} />
            </a>
            <a className="public-store-home-final__learn" href="/conoce-lanzo">Conoce por qué nació LANZO</a>
          </div>
        </section>
      </main>
    </div>
  );
}

export default PublicStoreHomePage;
