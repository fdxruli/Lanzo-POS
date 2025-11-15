// src/components/common/WelcomeModal.jsx
import React, { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import ContactModal from './ContactModal'; // <-- 1. Importa el ContactModal
import { sendWhatsAppMessage } from '../../services/utils'; // <-- 2. Importa el sender
import './WelcomeModal.css';

// 3. Define los campos para el modal de soporte
const supportFields = [
  { id: 'name', label: 'Tu Nombre', type: 'input' },
  { id: 'problem', label: 'Describe tu problema (Ej: "Mi dispositivo ya está registrado")', type: 'textarea' }
];

// 4. (Opcional pero recomendado) Pon tu número de soporte aquí
const SUPPORT_PHONE_NUMBER = '521122334455'; // <--- ¡CAMBIA ESTE NÚMERO!

export default function WelcomeModal() {
  const [licenseKey, setLicenseKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // 5. Añade estado para el modal de contacto
  const [isContactOpen, setIsContactOpen] = useState(false);

  const handleLogin = useAppStore((state) => state.handleLogin);
  const handleFreeTrial = useAppStore((state) => state.handleFreeTrial);

  const handleSubmit = async (e) => {
    // ... (esta función no cambia)
    e.preventDefault();
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
    // ... (esta función no cambia)
    setIsLoading(true);
    setErrorMessage('');
    const result = await handleFreeTrial();
    setIsLoading(false);
    if (!result.success) {
      setErrorMessage(result.message);
    }
  };

  // 6. Añade el handler para el envío del formulario de contacto
  const handleSubmitSupport = (formData) => {
    const message = `¡Hola! Necesito soporte para Lanzo POS.\n\n*Nombre:* ${formData.name}\n*Problema:* ${formData.problem}`;
    
    // Usamos la utilidad que ya existe
    sendWhatsAppMessage(SUPPORT_PHONE_NUMBER, message);
    setIsContactOpen(false); // Cierra el modal de contacto
  };


  return (
    <> {/* 7. Envuelve todo en un Fragment (<>) */}
      <div className="modal" style={{ display: 'flex' }}>
        <div className="welcome-modal-content">
          <h2>Bienvenido a Lanzo POS</h2>
          <div className="welcome-summary">
            {/* ... (contenido del summary sin cambios) ... */}
            <p><strong>Lanzo</strong> es un sistema completo de punto de venta y gestión para pequeños negocios.</p>
            <ul>
              <li>Gestiona tu Punto de Venta</li>
              <li>Controla tu inventario y productos</li>
              <li>Administra tus Clientes y Ventas</li>
            </ul>
          </div>

          <form id="license-form" onSubmit={handleSubmit}>
            {/* ... (formulario de licencia sin cambios) ... */}
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
                disabled={isLoading}
              />
            </div>
            <button type="submit" className="btn btn-save" disabled={isLoading}>
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
            disabled={isLoading}
          >
            {isLoading ? 'Generando...' : 'Probar Gratis por 3 Meses'}
          </button>
          

          {/* 8. Mueve el mensaje de error Y añade el botón de soporte */}
          <div className="welcome-footer">
            {errorMessage && (
              <p className="welcome-error-message">
                {errorMessage}
              </p>
            )}
            
            {/* ¡EL NUEVO BOTÓN! */}
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

      {/* 9. Renderiza el ContactModal (estará oculto por defecto) */}
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