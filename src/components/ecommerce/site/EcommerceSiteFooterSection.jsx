import { ArrowUpRight } from 'lucide-react';
import LogoMark from '../../common/LogoMark';

export default function EcommerceSiteFooterSection({ slug, section }) {
  return (
    <footer className="public-store-footer" data-site-section="footer" data-site-layout={section.layout}>
      <div className="public-store-footer__inner">
        <div className="public-store-footer__mark" aria-hidden="true"><LogoMark /></div>
        <div className="public-store-footer__copy">
          <p className="public-store-footer__brand">Tienda creada con Lanzo</p>
        </div>
        <a className="public-store-footer__cta" href={`/conoce-lanzo?tienda=${encodeURIComponent(slug)}`}>
          Conoce Lanzo <ArrowUpRight aria-hidden="true" size={15} />
        </a>
      </div>
    </footer>
  );
}
