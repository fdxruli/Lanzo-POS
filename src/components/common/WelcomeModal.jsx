import { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import {
  Mail,
  Wifi,
  WifiOff,
  Package,
  ChevronRight,
  CheckCircle2,
  Zap,
  Rocket
} from 'lucide-react';
import './WelcomeModal.css';
import Logger from '../../services/Logger';
import { getStableDeviceId } from '../../services/supabase';
import { showMessageModal } from '../../services/utils';

export default function WelcomeModal() {
  const [licenseKey, setLicenseKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const handleLogin = useAppStore((state) => state.handleLogin);
  const handleFreeTrial = useAppStore((state) => state.handleFreeTrial);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setErrorMessage('');
      Logger.info('Conexión restaurada');
    };

    const handleOffline = () => {
      setIsOnline(false);
      Logger.warn('Conexión perdida');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const prewarmIdentity = async () => {
      if (!navigator.onLine) return;
      try {
        await getStableDeviceId();
        Logger.info("Identificador de dispositivo pre-cargado");
      } catch (error) {
        Logger.error("Error al pre-cargar identificador:", error);
      }
    };

    prewarmIdentity();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!isOnline) {
      setErrorMessage('Sin conexión a internet. Conéctate para continuar.');
      return;
    }

    if (!licenseKey.trim()) {
      setErrorMessage('Por favor, ingresa una clave de licencia válida.');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    try {
      const result = await handleLogin(licenseKey.trim());

      if (!result.success) {
        setErrorMessage(result.message || 'Licencia inválida o expirada');
      }
    } catch (error) {
      Logger.error("Error crítico al validar licencia:", error);

      if (error.message?.includes('fetch') || error.message?.includes('Network')) {
        setErrorMessage('Error de conexión. Verifica tu internet e intenta nuevamente.');
      } else {
        setErrorMessage('Error inesperado. Por favor, contacta a soporte.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleTrialClick = async () => {
    if (!isOnline) {
      setErrorMessage('Se requiere conexión a internet para crear tu licencia gratuita.');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    try {
      const result = await handleFreeTrial();

      if (!result.success) {
        setErrorMessage(result.message || 'No se pudo crear la licencia FREE.');
      }
    } catch (error) {
      Logger.error("Error al crear licencia FREE:", error);

      if (error.message?.includes('fetch') || error.message?.includes('Network')) {
        setErrorMessage('Error de red. Verifica tu conexión.');
      } else {
        setErrorMessage(`Error: ${error.message || 'Intenta nuevamente'}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSupportClick = () => {
    const envEmail = import.meta.env.VITE_SUPPORT_EMAIL;
    const supportEmail = (envEmail && envEmail !== 'undefined') ? envEmail : 'contacto.entrealas@gmail.com';

    const deviceInfo = `
Dispositivo: ${navigator.userAgent}
Sistema: ${navigator.platform}
Idioma: ${navigator.language}
Fecha: ${new Date().toLocaleString()}
    `.trim();

    const subject = encodeURIComponent("Ayuda - No puedo acceder a Lanzo POS");
    const body = encodeURIComponent(`Hola equipo de Lanzo,

Necesito ayuda para acceder a la aplicación.

INFORMACIÓN DE MI DISPOSITIVO:
${deviceInfo}

DESCRIBE TU PROBLEMA:
[Escribe aquí qué está pasando]

¡Gracias por su ayuda!`);

    navigator.clipboard.writeText(supportEmail).then(() => {
      showMessageModal(`📧 Correo de soporte copiado: ${supportEmail}\n\nSi no se abre tu aplicación de correo, puedes escribirnos manualmente.`);
    }).catch(err => console.error("No se pudo copiar", err));

    setTimeout(() => {
      window.location.href = `mailto:${supportEmail}?subject=${subject}&body=${body}`;
    }, 500);
  };

  return (
    <div
      className="modal welcome-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      aria-describedby="welcome-description"
    >
      <div className="welcome-modal-content">

        {/* SECCIÓN HERO */}
        <div className="welcome-hero-section">
          <div className="hero-brand">
            <span className="brand-icon-shell">
              <img src="/logIcon.svg" alt="" className="brand-icon" />
            </span>
            <div className="brand-copy">
              <span className="brand-name">Lanzo POS</span>
              <span className="brand-tagline">Tu negocio, bajo control</span>
            </div>
          </div>

          <div className="hero-text-content">
            <h1 id="welcome-title">Impulsa tu negocio hoy</h1>
            <p className="hero-subtitle" id="welcome-description">
              Gestiona ventas, inventario y clientes desde un solo lugar.
            </p>
          </div>

          {/* Carrusel de características en móvil, Grid en Desktop */}
          <div className="hero-features-grid">
            <div className="feature-card">
              <div className="feature-icon-wrapper">
                <Zap size={20} aria-hidden="true" />
              </div>
              <div className="feature-card-text">
                <h3>Punto de Venta Ágil</h3>
                <p>Registra ventas en segundos con una interfaz intuitiva y muy fácil de usar.</p>
              </div>
            </div>

            <div className="feature-card">
              <div className="feature-icon-wrapper">
                <Rocket size={20} aria-hidden="true" />
              </div>
              <div className="feature-card-text">
                <h3>Ideal para Emprender</h3>
                <p>Potencia tu negocio sin pagar las altas suscripciones de otras aplicaciones.</p>
              </div>
            </div>

            <div className="feature-card">
              <div className="feature-icon-wrapper">
                <WifiOff size={20} aria-hidden="true" />
              </div>
              <div className="feature-card-text">
                <h3>Siempre Disponible</h3>
                <p>Tus datos son tuyos y se guardan en tu equipo. Sigue operando aunque no tengas internet.</p>
              </div>
            </div>

            <div className="feature-card">
              <div className="feature-icon-wrapper">
                <Package size={20} aria-hidden="true" />
              </div>
              <div className="feature-card-text">
                <h3>Control Total</h3>
                <p>Administra tu inventario, cuentas de clientes y reportes desde un solo lugar.</p>
              </div>
            </div>
          </div>
        </div>

        {/* SECCIÓN FORMULARIO (Bottom Sheet en Móviles) */}
        <div className="welcome-form-section">

          <div className="form-header">
            <h2>Comienza ahora</h2>
            <p>Ingresa tu licencia o crea una gratis</p>
          </div>

          {!isOnline && (
            <div className="connection-alert offline" role="status">
              <WifiOff size={18} aria-hidden="true" />
              <div className="alert-text">
                <strong>Sin conexión a internet</strong>
                <span>Requerida para iniciar sesión o crear licencia gratuita</span>
              </div>
            </div>
          )}

          {isOnline && isLoading && (
            <div className="connection-alert loading" role="status">
              <Wifi size={18} className="pulse-anim" aria-hidden="true" />
              <span>Conectando de forma segura...</span>
            </div>
          )}

          <form id="welcome-form" onSubmit={handleSubmit} aria-busy={isLoading}>
            <div className="input-group">
              <label htmlFor="license-key">Clave de Licencia</label>
              <div className="input-wrapper">
                <input
                  id="license-key"
                  type="text"
                  required
                  placeholder="LANZO-XXXX-XXXX-XXXX"
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value.toUpperCase())}
                  disabled={isLoading || !isOnline}
                  maxLength={64}
                  className={licenseKey ? 'has-value' : ''}
                />
              </div>
            </div>

            <button
              type="submit"
              className="btn-submit-license"
              disabled={isLoading || !isOnline || !licenseKey.trim()}
            >
              <span>{isLoading ? 'Verificando...' : 'Acceder con Licencia'}</span>
              {!isLoading && <ChevronRight size={18} aria-hidden="true" />}
            </button>

            <div className="divider">
              <span>¿No tienes licencia?</span>
            </div>

            <div className="trial-zone">
              <ul className="trial-benefits">
                <li><CheckCircle2 size={16} aria-hidden="true" /> Sin tarjeta de crédito</li>
                <li><CheckCircle2 size={16} aria-hidden="true" /> 1 dispositivo local</li>
                <li><CheckCircle2 size={16} aria-hidden="true" /> Uso local gratuito</li>
              </ul>

              <button
                type="button"
                className="btn-start-trial"
                onClick={handleTrialClick}
                disabled={isLoading || !isOnline}
              >
                Crear licencia FREE
              </button>
            </div>
          </form>

          {errorMessage && (
            <div className="error-toast" role="alert">
              <span className="error-icon" aria-hidden="true">!</span>
              <p>{errorMessage}</p>
            </div>
          )}

          <div className="support-footer">
            <button
              type="button"
              className="btn-support"
              onClick={handleSupportClick}
            >
              <Mail size={16} aria-hidden="true" />
              ¿Necesitas ayuda? Contáctanos
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
