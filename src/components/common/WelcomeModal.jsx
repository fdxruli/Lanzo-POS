import { useState, useEffect, useRef } from 'react';
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  KeyRound,
  Package,
  ShoppingCart,
  Wifi,
  WifiOff
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { PUBLIC_STORE_ORIGIN, buildPublicLandingUrl } from '../../config/publicOrigins';
import './WelcomeModal.css';
import Logger from '../../services/Logger';
import PreloginSupportAccess from './PreloginSupportAccess';
import { mapLicenseActivationResult, mapFreeLicenseCreationResult } from './licenseActivationErrorMapper';

// Show the license form when the viewport is wide or tall enough; compact screens use the accordion.
const SPACIOUS_LAYOUT_QUERY = '(min-width: 960px) and (min-height: 640px), (min-width: 360px) and (min-height: 780px)';
const PUBLIC_LANDING_URL = buildPublicLandingUrl();
const PUBLIC_STORE_URL = new URL('/', PUBLIC_STORE_ORIGIN).toString();

const getIsSpaciousLayout = () => (
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia(SPACIOUS_LAYOUT_QUERY).matches
);

export default function WelcomeModal() {
  const [licenseKey, setLicenseKey] = useState('');
  const [loadingAction, setLoadingAction] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorTitle, setErrorTitle] = useState('');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSpaciousLayout, setIsSpaciousLayout] = useState(getIsSpaciousLayout);
  const [isLicenseExpanded, setIsLicenseExpanded] = useState(false);
  const actionInFlight = useRef(false);
  const isLoading = loadingAction !== null;
  const isLicenseFormVisible = isSpaciousLayout || isLicenseExpanded;

  const handleLogin = useAppStore((state) => state.handleLogin);
  const handleFreeTrial = useAppStore((state) => state.handleFreeTrial);

  const clearError = () => {
    setErrorTitle('');
    setErrorMessage('');
  };

  const showError = (message, title = '') => {
    setErrorTitle(title);
    setErrorMessage(message);
  };

  useEffect(() => {
    const mediaQuery = window.matchMedia?.(SPACIOUS_LAYOUT_QUERY);
    if (!mediaQuery) return undefined;

    const updateLayout = (event) => setIsSpaciousLayout(event.matches);
    setIsSpaciousLayout(mediaQuery.matches);
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', updateLayout);
    } else {
      mediaQuery.addListener?.(updateLayout);
    }

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', updateLayout);
      } else {
        mediaQuery.removeListener?.(updateLayout);
      }
    };
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      clearError();
      Logger.info('Conexión restaurada');
    };

    const handleOffline = () => {
      setIsOnline(false);
      Logger.warn('Conexión perdida');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const input = document.getElementById('license-key');
    const overlay = document.querySelector('.welcome-modal-overlay');
    if (!input || !overlay) return undefined;

    const scrollFocusedInputIntoView = () => {
      if (document.activeElement !== input) return;

      const viewport = window.visualViewport;
      const visibleTop = viewport?.offsetTop ?? 0;
      const visibleBottom = visibleTop + (viewport?.height ?? window.innerHeight);
      const inputBounds = input.getBoundingClientRect();

      if (inputBounds.bottom > visibleBottom) {
        overlay.scrollTop += inputBounds.bottom - visibleBottom + 16;
      } else if (inputBounds.top < visibleTop + 12) {
        overlay.scrollTop -= visibleTop + 12 - inputBounds.top;
      }
    };

    let focusTimeout;
    const handleFocus = () => {
      window.requestAnimationFrame(scrollFocusedInputIntoView);
      focusTimeout = window.setTimeout(scrollFocusedInputIntoView, 250);
    };
    const viewport = window.visualViewport;

    input.addEventListener('focus', handleFocus);
    window.addEventListener('resize', scrollFocusedInputIntoView);
    viewport?.addEventListener('resize', scrollFocusedInputIntoView);

    return () => {
      input.removeEventListener('focus', handleFocus);
      window.removeEventListener('resize', scrollFocusedInputIntoView);
      viewport?.removeEventListener('resize', scrollFocusedInputIntoView);
      window.clearTimeout(focusTimeout);
    };
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!isOnline) {
      const feedback = mapLicenseActivationResult({ code: 'OFFLINE_PRECHECK' }, { isOnline: false });
      showError(feedback.message, feedback.title);
      return;
    }

    if (!licenseKey.trim()) {
      showError('Por favor, ingresa una clave de licencia válida.');
      return;
    }

    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setLoadingAction('license');
    clearError();

    try {
      const result = await handleLogin(licenseKey.trim());

      if (!result?.success) {
        const feedback = mapLicenseActivationResult(result, { isOnline });

        if (feedback.kind === 'error') {
          showError(feedback.message, feedback.title);
        } else {
          clearError();
        }
      }
    } catch (error) {
      Logger.error('Error crítico al validar licencia:', error);
      const feedback = mapLicenseActivationResult(error, { isOnline });
      showError(feedback.message, feedback.title);
    } finally {
      actionInFlight.current = false;
      setLoadingAction(null);
    }
  };

  const handleTrialClick = async () => {
    if (actionInFlight.current) return;
    if (!isOnline) {
      showError('Se requiere conexión a internet para crear tu licencia gratuita.');
      return;
    }

    actionInFlight.current = true;
    setLoadingAction('free');
    clearError();

    try {
      const result = await handleFreeTrial();

      if (!result?.success) {
        const feedback = mapFreeLicenseCreationResult(result, { isOnline });
        showError(feedback.message, feedback.title);
      }
    } catch (error) {
      Logger.error('Error al crear licencia LANZO Local:', error);

      const feedback = mapFreeLicenseCreationResult(error, { isOnline });
      showError(feedback.message, feedback.title);
    } finally {
      actionInFlight.current = false;
      setLoadingAction(null);
    }
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
        <section className="welcome-hero-section" aria-label="Presentación de LANZO POS">
          <div className="hero-brand">
            <span className="brand-icon-shell">
              <img src="/logIcon.svg" alt="" className="brand-icon" />
            </span>
            <div className="brand-copy">
              <span className="brand-name">LANZO POS</span>
              <span className="brand-tagline">Tu negocio, bajo control</span>
            </div>
          </div>

          <div className="hero-text-content">
            <h1 id="welcome-title">Vende, organiza y controla tu negocio.</h1>
            <p className="hero-subtitle" id="welcome-description">
              Gestiona ventas, caja, inventario, clientes y reportes desde un solo lugar.
            </p>
          </div>

          <ul className="hero-capabilities" aria-label="Capacidades principales">
            <li className="capability-item">
              <span className="capability-icon"><ShoppingCart size={18} aria-hidden="true" /></span>
              <span className="capability-copy">
                <strong>Ventas</strong>
                <small>Registra y administra</small>
              </span>
            </li>
            <li className="capability-item">
              <span className="capability-icon"><Package size={18} aria-hidden="true" /></span>
              <span className="capability-copy">
                <strong>Inventario</strong>
                <small>Productos y existencias</small>
              </span>
            </li>
            <li className="capability-item">
              <span className="capability-icon"><BarChart3 size={18} aria-hidden="true" /></span>
              <span className="capability-copy">
                <strong>Reportes</strong>
                <small>Información del negocio</small>
              </span>
            </li>
          </ul>
        </section>

        <section className="welcome-form-section" aria-labelledby="welcome-actions-title">
          <header className="form-header">
            <h2 id="welcome-actions-title">Comienza ahora</h2>
            <p>Elige cómo quieres continuar.</p>
          </header>

          {!isOnline && (
            <div className="connection-alert offline" role="status">
              <WifiOff size={18} aria-hidden="true" />
              <div className="alert-text">
                <strong>Sin conexión a internet</strong>
                <span>Necesitas conexión para activar o crear una licencia.</span>
              </div>
            </div>
          )}

          {isOnline && isLoading && (
            <div className="connection-alert loading" role="status">
              <Wifi size={18} aria-hidden="true" />
              <span>{loadingAction === 'free' ? 'Creando licencia LANZO Local...' : 'Verificando licencia...'}</span>
            </div>
          )}

          <div className="welcome-actions">
            <div className="free-license-action">
              <button
                type="button"
                className="btn-start-trial"
                onClick={handleTrialClick}
                disabled={isLoading || !isOnline}
              >
                <span>{loadingAction === 'free' ? 'Creando licencia...' : 'Crear mi licencia gratuita'}</span>
                {loadingAction !== 'free' && <ChevronRight size={19} aria-hidden="true" />}
              </button>
              <p className="free-license-note">LANZO Local es gratis para usar en un dispositivo.</p>
            </div>

            <div className="license-entry">
              <button
                type="button"
                className="license-entry-toggle"
                aria-expanded={isLicenseFormVisible}
                aria-controls="welcome-license-panel"
                onClick={() => setIsLicenseExpanded((expanded) => !expanded)}
              >
                <KeyRound size={18} aria-hidden="true" />
                <span>Ya tengo una licencia</span>
                <ChevronDown className="license-entry-chevron" size={18} aria-hidden="true" />
              </button>

              <div
                id="welcome-license-panel"
                className="license-entry-panel"
                hidden={!isLicenseFormVisible}
              >
                <h3 className="license-entry-heading">Ya tengo una licencia</h3>
                <form id="welcome-form" onSubmit={handleSubmit} aria-busy={isLoading}>
                  <div className="input-group">
                    <label htmlFor="license-key">Clave de licencia</label>
                    <input
                      id="license-key"
                      type="text"
                      required
                      placeholder="LANZO-XXXX-XXXX-XXXX-XXXX"
                      value={licenseKey}
                      onChange={(event) => setLicenseKey(event.target.value.toUpperCase())}
                      onFocus={() => setIsLicenseExpanded(true)}
                      disabled={isLoading || !isOnline}
                      maxLength={64}
                      autoCapitalize="characters"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck="false"
                      enterKeyHint="go"
                    />
                  </div>

                  <button
                    type="submit"
                    className="btn-submit-license"
                    disabled={isLoading || !isOnline || !licenseKey.trim()}
                  >
                    <span>{loadingAction === 'license' ? 'Verificando...' : 'Acceder con licencia'}</span>
                    {loadingAction !== 'license' && <ChevronRight size={18} aria-hidden="true" />}
                  </button>
                </form>
              </div>
            </div>
          </div>

          {errorMessage && (
            <div className="error-toast" role="alert" aria-atomic="true">
              <span className="error-icon" aria-hidden="true">!</span>
              <div className="error-toast-content">
                {errorTitle && <strong>{errorTitle}</strong>}
                <p>{errorMessage}</p>
              </div>
            </div>
          )}

          <footer className="welcome-secondary">
            <PreloginSupportAccess screen="Bienvenida">
              <nav className="welcome-public-links" aria-label="Información pública de LANZO">
                <a href={PUBLIC_LANDING_URL} target="_blank" rel="noopener noreferrer">Conoce LANZO</a>
                <a href={PUBLIC_STORE_URL} target="_blank" rel="noopener noreferrer">Tienda en línea</a>
              </nav>
            </PreloginSupportAccess>
          </footer>
        </section>
      </div>
    </div>
  );
}
