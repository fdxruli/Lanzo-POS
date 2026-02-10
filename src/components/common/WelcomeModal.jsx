import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { Mail, HelpCircle, Wifi, WifiOff } from 'lucide-react';
import './WelcomeModal.css';
import Logger from '../../services/Logger';
import { getStableDeviceId } from '../../services/supabase';

// Agrega tu correo real como string por si falla la variable de entorno
const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL;

export default function WelcomeModal() {
  const [licenseKey, setLicenseKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const handleLogin = useAppStore((state) => state.handleLogin);
  const handleFreeTrial = useAppStore((state) => state.handleFreeTrial);

  // === MANEJO DE CONEXIÓN ===
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

    // Pre-cargar identificador de dispositivo
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

  // === VALIDACIÓN DE LICENCIA ===
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

  // === PRUEBA GRATIS ===
  const handleTrialClick = async () => {
    if (!isOnline) {
      setErrorMessage('Se requiere conexión a internet para activar la prueba gratuita.');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    try {
      const result = await handleFreeTrial();

      if (!result.success) {
        setErrorMessage(result.message || 'No se pudo activar la prueba.');
      }
    } catch (error) {
      Logger.error("Error en activación de prueba:", error);

      if (error.message?.includes('fetch') || error.message?.includes('Network')) {
        setErrorMessage('Error de red. Verifica tu conexión.');
      } else {
        setErrorMessage(`Error: ${error.message || 'Intenta nuevamente'}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // === CONTACTO CON SOPORTE ===
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

    // 1. Copiar al portapapeles y avisar al usuario
    navigator.clipboard.writeText(supportEmail).then(() => {
      // Opcional: Si tienes un sistema de "Toasts" o notificaciones, úsalo aquí.
      // Si no, un alert simple es efectivo para este caso de soporte crítico.
      alert(`📧 Correo de soporte copiado: ${supportEmail}\n\nSi no se abre tu aplicación de correo, puedes escribirnos manualmente.`);
    }).catch(err => console.error("No se pudo copiar", err));

    // 2. Intentar abrir la app de correo (sin abrir pestañas nuevas)
    // El timeout da un respiro para que el alert o el copiado no interfieran
    setTimeout(() => {
      window.location.href = `mailto:${supportEmail}?subject=${subject}&body=${body}`;
    }, 500);
  };

  return (
    <div className="modal welcome-modal-overlay" style={{ display: 'flex' }}>
      <div className="welcome-modal-content">

        {/* TÍTULO */}
        <h2>Bienvenido a Lanzo POS</h2>

        {/* RESUMEN DE CARACTERÍSTICAS */}
        <div className="welcome-summary">
          <p style={{ marginBottom: '15px', fontWeight: 600, color: 'var(--text-dark)' }}>
            Sistema completo para impulsar tu negocio:
          </p>
          <ul>
            <li>Punto de Venta profesional</li>
            <li>Control de inventario en tiempo real</li>
            <li>Gestión de clientes y reportes</li>
            <li>Tus datos seguros y privados</li>
          </ul>
        </div>

        {/* BANNER DE ESTADO DE CONEXIÓN */}
        {!isOnline && (
          <div className="connection-banner offline">
            <WifiOff size={18} />
            <div>
              <strong>Sin conexión a internet</strong>
              <p>Conéctate para activar tu licencia o iniciar prueba</p>
            </div>
          </div>
        )}

        {isOnline && isLoading && (
          <div className="connection-banner online">
            <Wifi size={18} />
            <span>Verificando con el servidor...</span>
          </div>
        )}

        {/* FORMULARIO DE LICENCIA */}
        <form id="license-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="license-key">
              ¿Tienes una licencia?
            </label>
            <input
              className="form-input"
              id="license-key"
              type="text"
              required
              placeholder="LANZO-XXXX-XXXX-XXXX"
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value.toUpperCase())}
              disabled={isLoading || !isOnline}
              maxLength={23}
              style={!isOnline ? { backgroundColor: '#f3f4f6', cursor: 'not-allowed' } : {}}
            />

          </div>

          <button
            type="submit"
            className="btn btn-primary btn-save"
            disabled={isLoading || !isOnline || !licenseKey.trim()}
            style={
              (!isOnline || isLoading || !licenseKey.trim())
                ? { opacity: 0.6, cursor: 'not-allowed' }
                : {}
            }
          >
            {isLoading ? 'Verificando...' : 'Validar Licencia'}
          </button>

          {/* DIVISOR */}
          <div className="trial-divider">
            <span>¿Primera vez?</span>
          </div>

          {/* BOTÓN DE PRUEBA GRATIS */}
          <button
            type="button"
            className="btn btn-secondary btn-trial"
            onClick={handleTrialClick}
            disabled={isLoading || !isOnline}
            style={
              (!isOnline || isLoading)
                ? { opacity: 0.6, cursor: 'not-allowed' }
                : {}
            }
          >
            {isLoading ? 'Activando...' : 'Probar Gratis 3 Meses'}
          </button>

          {/* MENSAJE DE TRANQUILIDAD */}
          <div className="trial-info-box">
            <p>
              <strong>Sin compromisos:</strong> Al finalizar la prueba, podrás renovar tu licencia
              <strong> totalmente gratis</strong> y seguir usando Lanzo.
            </p>
          </div>
        </form>

        {/* ZONA DE ERRORES */}
        {errorMessage && (
          <div className="welcome-error-message">
            {errorMessage}
          </div>
        )}

        {/* PIE DE PÁGINA CON SOPORTE */}
        <div className="welcome-footer">
          <button
            type="button"
            className="btn-support-link"
            onClick={handleSupportClick}
          >
            <Mail size={16} />
            <span>¿Necesitas ayuda? Contacta a Soporte</span>
          </button>
        </div>
      </div>
    </div>
  );
}