// src/components/common/WelcomeModal.jsx
import React, { useState, useEffect } from 'react'; // Agregamos useEffect
import { useAppStore } from '../../store/useAppStore';
import ContactModal from './ContactModal';
import { sendWhatsAppMessage } from '../../services/utils';
import './WelcomeModal.css';

const supportFields = [
  { id: 'name', label: 'Tu Nombre', type: 'input' },
  { id: 'problem', label: 'Describe tu problema', type: 'textarea' }
];

const SUPPORT_PHONE_NUMBER = '521122334455'; 

export default function WelcomeModal() {
  const [licenseKey, setLicenseKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isContactOpen, setIsContactOpen] = useState(false);
  
  // --- NUEVO ESTADO: Detección de Internet ---
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);
  // -------------------------------------------

  const handleLogin = useAppStore((state) => state.handleLogin);
  const handleFreeTrial = useAppStore((state) => state.handleFreeTrial);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // --- VALIDACIÓN DE INTERNET ---
    if (!isOnline) {
      setErrorMessage('⚠️ Para introducir una licencia es necesario estar conectado a internet.');
      return;
    }
    // ------------------------------

    if (!licenseKey) {
      setErrorMessage('Por favor, ingresa una clave de licencia.');
      return;
    }
    setIsLoading(true);
    setErrorMessage('');
    const result = await handleLogin(licenseKey);
    setIsLoading(false);
    if (!result.success) {
      setErrorMessage(result.message);
    }
  };

  const handleTrialClick = async () => {
    // --- VALIDACIÓN DE INTERNET TAMBIÉN AQUÍ ---
    if (!isOnline) {
       setErrorMessage('⚠️ Para activar la prueba gratis es necesario estar conectado a internet.');
       return;
    }
    // -------------------------------------------

    setIsLoading(true);
    setErrorMessage('');
    const result = await handleFreeTrial();
    setIsLoading(false);
    if (!result.success) {
      setErrorMessage(result.message);
    }
  };

  const handleSubmitSupport = (formData) => {
    // ... (igual que antes)
    const message = `¡Hola! Necesito soporte...`;
    sendWhatsAppMessage(SUPPORT_PHONE_NUMBER, message);
    setIsContactOpen(false);
  };

  return (
    <>
      <div className="modal" style={{ display: 'flex' }}>
        <div className="welcome-modal-content">
          <h2>Bienvenido a Lanzo POS</h2>
          
          {/* ... (welcome-summary igual) ... */}
          <div className="welcome-summary">
             {/* ... contenido ... */}
             <p><strong>Lanzo</strong> es un sistema completo...</p>
             <ul>
               <li>Gestiona tu Punto de Venta</li>
               <li>Controla tu inventario</li>
               <li>Administra Clientes</li>
             </ul>
          </div>

          {/* MENSAJE DE ADVERTENCIA VISUAL SI NO HAY INTERNET */}
          {!isOnline && (
            <div style={{ 
              backgroundColor: '#fee2e2', 
              color: '#b91c1c', 
              padding: '10px', 
              borderRadius: '8px', 
              marginBottom: '15px',
              fontSize: '0.9rem',
              textAlign: 'center',
              border: '1px solid #fca5a5'
            }}>
              📡 <strong>Sin conexión:</strong> No podrás activar licencias hasta que te conectes.
            </div>
          )}

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
                placeholder="Ej: LANZO-XXXX-XXXX-XXXX"
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                disabled={isLoading || !isOnline} /* Deshabilitamos si no hay red */
              />
            </div>
            <button 
              type="submit" 
              className="btn btn-save" 
              disabled={isLoading || !isOnline} /* Deshabilitamos botón */
              style={!isOnline ? { opacity: 0.6, cursor: 'not-allowed' } : {}}
            >
              {isLoading ? 'Validando...' : 'Validar Licencia'}
            </button>
          </form>

          <div className="trial-divider">
            <span>O</span>
          </div>
          <button 
            type="button" 
            className="btn btn-secondary btn-trial"
            onClick={handleTrialClick}
            disabled={isLoading || !isOnline} /* Deshabilitamos botón */
            style={!isOnline ? { opacity: 0.6, cursor: 'not-allowed' } : {}}
          >
            {isLoading ? 'Generando...' : 'Probar Gratis por 3 Meses'}
          </button>
          
          <div className="welcome-footer">
            {errorMessage && (
              <p className="welcome-error-message">
                {errorMessage}
              </p>
            )}
            
            <button 
              type="button" 
              className="btn-support-link"
              onClick={() => setIsContactOpen(true)}
            >
              ¿Problemas? Contacta a Soporte
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