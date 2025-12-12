import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import ContactModal from './ContactModal';
import { sendWhatsAppMessage } from '../../services/utils';
import './WelcomeModal.css';

const supportFields = [
  { id: 'name', label: 'Tu Nombre', type: 'input' },
  { id: 'problem', label: 'Describe tu problema', type: 'textarea' }
];

const SUPPORT_PHONE_NUMBER = import.meta.env.VITE_SUPPORT_PHONE;

export default function WelcomeModal() {
  const [licenseKey, setLicenseKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isContactOpen, setIsContactOpen] = useState(false);

  // --- ESTADO: Detección de Internet ---
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => {
        setIsOnline(true);
        setErrorMessage(''); // Limpiar error si vuelve la red
    };
    const handleOffline = () => {
        setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleLogin = useAppStore((state) => state.handleLogin);
  const handleFreeTrial = useAppStore((state) => state.handleFreeTrial);

  // --- MANEJO DE VALIDACIÓN DE LICENCIA ---
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!isOnline) {
      setErrorMessage('⚠️ No tienes conexión a internet. Conéctate para continuar.');
      return;
    }

    if (!licenseKey) {
      setErrorMessage('Por favor, ingresa una clave de licencia.');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    try {
        const result = await handleLogin(licenseKey);
        
        if (!result.success) {
            setErrorMessage(result.message);
        }
        // Si es success, el store probablemente redirige o cierra el modal
    } catch (error) {
        console.error("Error al validar licencia:", error);
        setErrorMessage('❌ Error de conexión: No se pudo verificar la licencia. Intenta de nuevo.');
    } finally {
        setIsLoading(false);
    }
  };

  // --- MANEJO DE PRUEBA GRATIS (Aquí estaba tu error anterior) ---
  const handleTrialClick = async () => {
    if (!isOnline) {
      setErrorMessage('⚠️ Para activar la prueba gratis es necesario estar conectado a internet.');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    try {
        // Ejecutamos la acción del store
        const result = await handleFreeTrial();
        
        // Manejamos errores lógicos (ej: dispositivo ya registrado)
        if (!result.success) {
            setErrorMessage(result.message || 'No se pudo activar la prueba.');
        }
    } catch (error) {
        // Manejamos errores CRÍTICOS (ej: Failed to fetch / Timeouts)
        console.error("Error crítico en Trial:", error);
        
        if (error.message && (error.message.includes('fetch') || error.message.includes('Network'))) {
            setErrorMessage('❌ Error de Red: No pudimos conectar con el servidor. Verifica tu conexión.');
        } else {
            setErrorMessage(`❌ Ocurrió un error inesperado: ${error.message}`);
        }
    } finally {
        setIsLoading(false);
    }
  };

  const handleSubmitSupport = (formData) => {
    const message = `¡Hola! Necesito soporte. Nombre: ${formData.name}. Problema: ${formData.problem}`;
    sendWhatsAppMessage(SUPPORT_PHONE_NUMBER, message);
    setIsContactOpen(false);
  };

  return (
    <>
      <div className="modal" style={{ display: 'flex' }}>
        <div className="welcome-modal-content">
          <h2>Bienvenido a Lanzo</h2>
          <div className="welcome-summary">
            <p><strong>Lanzo</strong> es un sistema completo diseñado para agilizar tu negocio:</p>
            <ul>
              <li>Gestiona tu Punto de Venta</li>
              <li>Controla tu inventario en tiempo real</li>
              <li>Administra Clientes y reportes</li>
            </ul>
          </div>

          {/* BANNER DE SIN CONEXIÓN */}
          {!isOnline && (
            <div style={{
              backgroundColor: '#fee2e2',
              color: '#991b1b',
              padding: '12px',
              borderRadius: '8px',
              marginBottom: '15px',
              fontSize: '0.9rem',
              textAlign: 'center',
              border: '1px solid #f87171',
              fontWeight: 'bold'
            }}>
              📡 Sin conexión a internet. <br/>
              <span style={{fontWeight: 'normal', fontSize: '0.8rem'}}>No podrás activar licencias hasta que te conectes.</span>
            </div>
          )}

          {/* FORMULARIO DE LICENCIA */}
          <form id="license-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label" htmlFor="license-key">
                Ingresa tu clave de licencia para activar:
              </label>
              <input
                className="form-input"
                id="license-key"
                type="text"
                required
                placeholder="LANZO-A1B2-C3D4-E5F6"
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                disabled={isLoading || !isOnline}
                style={!isOnline ? { backgroundColor: '#f3f4f6' } : {}}
              />
            </div>

            <button
              type="submit"
              className="btn btn-save"
              disabled={isLoading || !isOnline}
              style={(!isOnline || isLoading) ? { opacity: 0.6, cursor: 'not-allowed' } : {}}
            >
              {isLoading ? '⏳ Verificando...' : 'Validar Licencia'}
            </button>

            <div className="trial-divider">
              <span>¿Eres nuevo?</span>
            </div>

            <button
              type="button"
              className="btn btn-secondary btn-trial"
              onClick={handleTrialClick}
              disabled={isLoading || !isOnline}
              style={(!isOnline || isLoading) ? { opacity: 0.6, cursor: 'not-allowed' } : {}}
            >
              {isLoading ? '⏳ Creando cuenta...' : 'Probar Gratis por 3 Meses'}
            </button>
          </form>

          <div className="welcome-footer">
            {/* ZONA DE MENSAJES DE ERROR */}
            {errorMessage && (
              <div className="welcome-error-message" style={{ 
                  color: '#dc2626', 
                  backgroundColor: '#fef2f2', 
                  padding: '10px', 
                  borderRadius: '6px',
                  marginTop: '10px',
                  fontSize: '0.9rem',
                  border: '1px solid #fecaca'
              }}>
                {errorMessage}
              </div>
            )}

            <button
              type="button"
              className="btn-support-link"
              onClick={() => setIsContactOpen(true)}
              style={{ marginTop: '15px' }}
            >
              ¿Tienes problemas? Contactar a Soporte
            </button>
          </div>

        </div>
      </div>

      <ContactModal
        show={isContactOpen}
        onClose={() => setIsContactOpen(false)}
        onSubmit={handleSubmitSupport}
        title="Contactar a Soporte"
        fields={supportFields}
      />
    </>
  );
}