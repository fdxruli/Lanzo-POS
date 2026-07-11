import { ArrowLeft, CheckCircle2, ShoppingBag, Store } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { LogoMark } from '../components/common/Logo';
import './PublicStorePage.css';

const BENEFITS = [
  'Publica un catálogo claro para que tus clientes compren desde cualquier lugar.',
  'Recibe pedidos y mantén tus ventas organizadas en un solo sistema.',
  'Gestiona productos, inventario y tu operación con herramientas pensadas para negocios reales.',
];

const getStoreReturnPath = (searchParams) => {
  const slug = searchParams.get('tienda') || '';
  return /^[^/?#]+$/.test(slug) ? `/tienda/${encodeURIComponent(slug)}` : '/tienda';
};

function PublicLanzoLandingPage() {
  const [searchParams] = useSearchParams();
  const returnPath = getStoreReturnPath(searchParams);

  return (
    <main className="public-store-shell public-lanzo-landing">
      <div className="public-lanzo-landing__inner">
        <a className="public-lanzo-landing__brand" href={returnPath} aria-label="Volver a la tienda">
          <span className="public-lanzo-landing__mark" aria-hidden="true"><LogoMark /></span>
          <span>Lanzo</span>
        </a>

        <section className="public-lanzo-landing__hero" aria-labelledby="public-lanzo-title">
          <p className="public-store-section-kicker">Herramientas para negocios que quieren crecer</p>
          <h1 id="public-lanzo-title">Vende mejor, sin complicarte.</h1>
          <p className="public-lanzo-landing__lead">
            Lanzo te ayuda a convertir tu negocio en una operación más ordenada: muestra tus productos,
            recibe pedidos y toma mejores decisiones todos los días.
          </p>

          <div className="public-lanzo-landing__benefits" aria-label="Beneficios de Lanzo">
            {BENEFITS.map((benefit) => (
              <div key={benefit}>
                <CheckCircle2 aria-hidden="true" size={20} />
                <span>{benefit}</span>
              </div>
            ))}
          </div>

          <div className="public-lanzo-landing__highlights" aria-label="Qué puedes hacer con Lanzo">
            <span><Store aria-hidden="true" size={18} />Tu catálogo, siempre disponible</span>
            <span><ShoppingBag aria-hidden="true" size={18} />Pedidos listos para atender</span>
          </div>

          <a className="ui-button ui-button--secondary public-lanzo-landing__back" href={returnPath}>
            <ArrowLeft aria-hidden="true" size={18} />
            Volver a la tienda
          </a>
        </section>
      </div>
    </main>
  );
}

export default PublicLanzoLandingPage;
