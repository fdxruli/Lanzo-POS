import { useEffect } from 'react';
import { ShieldCheck } from 'lucide-react';
import PreloginSupportAccess from './PreloginSupportAccess';
import './AuthPageLayout.css';

function AuthBrand({ compact = false }) {
  return (
    <div className={`auth-page__brand${compact ? ' auth-page__brand--compact' : ''}`}>
      <span className="auth-page__brand-mark" aria-hidden="true">
        <img src="/logIcon.svg" alt="" />
      </span>
      <span className="auth-page__brand-copy">
        <strong>LANZO POS</strong>
        <span>Sistema de punto de venta</span>
      </span>
    </div>
  );
}

export function AuthPageFooter({ screen, children, className = '' }) {
  const links = (
    <div className={`auth-page__footer-links ${className}`.trim()}>
      {children}
    </div>
  );

  return (
    <footer className="auth-page__footer">
      <nav aria-label="Navegación de acceso">
        {screen
          ? <PreloginSupportAccess screen={screen} modal>{links}</PreloginSupportAccess>
          : links}
      </nav>
      <span className="auth-page__footer-security">
        <ShieldCheck size={15} aria-hidden="true" />
        Acceso protegido
      </span>
    </footer>
  );
}

export default function AuthPageLayout({ children, footer, contentClassName = '' }) {
  useEffect(() => {
    const root = document.getElementById('root');
    document.documentElement.classList.add('auth-page-document');
    document.body.classList.add('auth-page-document');
    root?.classList.add('auth-page-document');

    return () => {
      document.documentElement.classList.remove('auth-page-document');
      document.body.classList.remove('auth-page-document');
      root?.classList.remove('auth-page-document');
    };
  }, []);

  return (
    <div className="auth-page">
      <aside className="auth-page__identity" aria-label="LANZO POS">
        <AuthBrand />
        <div className="auth-page__identity-copy">
          <span className="auth-page__identity-kicker">Tu negocio en un solo lugar</span>
          <p>Ingresa de forma segura al espacio de trabajo de tu negocio.</p>
          <span className="auth-page__identity-status">
            <ShieldCheck size={16} aria-hidden="true" />
            Acceso protegido
          </span>
        </div>
        <span className="auth-page__identity-caption">LANZO POS · Administración y operación</span>
      </aside>

      <main className="auth-page__main">
        <header className="auth-page__mobile-brand">
          <AuthBrand compact />
        </header>
        <div className={`auth-page__content ${contentClassName}`.trim()}>
          {children}
        </div>
        {footer}
      </main>
    </div>
  );
}
