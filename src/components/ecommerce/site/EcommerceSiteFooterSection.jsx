import { ArrowUpRight } from 'lucide-react';
import LogoMark from '../../common/LogoMark';

export default function EcommerceSiteFooterSection({ slug, section }) {
  return (
    <footer className="public-store-footer" data-site-section="footer" data-site-layout={section.layout}>
      <div className="public-store-footer__inner">
        <div className="public-store-footer__mark" aria-hidden="true"><LogoMark /></div>
        <div className="public-store-footer__copy">
          <p className="public-store-section-kicker">Haz crecer tu negocio</p>
          <h2>¿Quieres tu propia tienda en línea?</h2>
          <p>Con Lanzo publica tu catálogo, recibe pedidos y organiza tus ventas desde un solo lugar.</p>
        </div>
        <a className="ui-button ui-button--secondary public-store-footer__cta" href={`/conoce-lanzo?tienda=${encodeURIComponent(slug)}`}>
          Conoce Lanzo <ArrowUpRight aria-hidden="true" size={18} />
        </a>
      </div>
    </footer>
  );
}
