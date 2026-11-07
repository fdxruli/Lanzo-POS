import { AppWindow, RefreshCw, ShieldCheck } from 'lucide-react';
import './SingleInstanceBlockedScreen.css';

export default function SingleInstanceBlockedScreen({
  onRetry = () => window.location.reload(),
}) {
  return (
    <main
      className="single-instance-screen"
      role="alert"
      aria-labelledby="single-instance-title"
      aria-describedby="single-instance-description"
    >
      <div className="single-instance-screen__layout">
        <header className="single-instance-screen__brand">
          <div className="single-instance-screen__brand-lockup">
            <span className="single-instance-screen__logo" aria-hidden="true">
              <img src="/logIcon.svg" alt="" />
            </span>
            <div className="single-instance-screen__brand-copy">
              <strong>Lanzo POS</strong>
              <span>Tu negocio, bajo control</span>
            </div>
          </div>
          <div className="single-instance-screen__brand-message">
            <span className="single-instance-screen__brand-line" aria-hidden="true" />
            <p>Un espacio seguro para tus operaciones.</p>
          </div>
        </header>

        <section className="single-instance-screen__content">
          <span className="single-instance-screen__icon" aria-hidden="true">
            <AppWindow size={27} strokeWidth={1.8} />
          </span>
          <p className="single-instance-screen__eyebrow">Acceso protegido</p>
          <h1 id="single-instance-title">Aplicación ya abierta</h1>
          <p className="single-instance-screen__description" id="single-instance-description">
            Lanzo POS ya está abierto en otra pestaña o ventana de este navegador.
            Para evitar operaciones simultáneas, utiliza una sola a la vez.
          </p>

          <div className="single-instance-screen__guidance">
            <ShieldCheck size={21} aria-hidden="true" />
            <div>
              <h2>¿Quieres continuar aquí?</h2>
              <p>
                Cierra la otra pestaña o ventana de Lanzo POS. Si utilizas la aplicación
                instalada, ciérrala también. Después vuelve a intentarlo.
              </p>
            </div>
          </div>

          <button
            type="button"
            className="ui-button ui-button--primary single-instance-screen__action"
            onClick={onRetry}
          >
            <RefreshCw size={18} aria-hidden="true" />
            Reintentar acceso
          </button>
          <p className="single-instance-screen__note">
            Esta pantalla no cierra otras ventanas ni borra datos del dispositivo.
          </p>
        </section>
      </div>
    </main>
  );
}
