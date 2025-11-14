// src/components/common/WelcomeModal.jsx
import React, { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import './WelcomeModal.css';

export default function WelcomeModal() {
  const [licenseKey, setLicenseKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // 1. Obtenemos la acción de login de nuestro store
  const handleLogin = useAppStore((state) => state.handleLogin);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!licenseKey) {
      setErrorMessage('Por favor, ingresa una clave de licencia.');
      return;
    }
    
    setIsLoading(true);
    setErrorMessage('');

    // 2. Llamamos a la acción del store
    const result = await handleLogin(licenseKey);

    setIsLoading(false);
    if (!result.success) {
      // 3. Mostramos el error si la licencia es inválida
      setErrorMessage(result.message);
    }
    // Si es exitoso (result.success), el store cambiará
    // automáticamente el 'appStatus' y este modal desaparecerá.
  };

  // 4. HTML de 'welcome-modal' traducido a JSX
  return (
    <div className="modal" style={{ display: 'flex' }}>
      <div className="welcome-modal-content">
        <h2>Bienvenido a Lanzo POS</h2>
        <div className="welcome-summary">
          <p><strong>Lanzo</strong> es un sistema completo de punto de venta y gestión para pequeños negocios.</p>
          <ul>
            <li>Gestiona tu Punto de Venta</li>
            <li>Controla tu inventario y productos</li>
            <li>Administra tus Clientes y Ventas</li>
          </ul>
        </div>
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
              disabled={isLoading}
            />
          </div>
          <button type="submit" className="btn btn-save" disabled={isLoading}>
            {isLoading ? 'Validando...' : 'Validar Licencia'}
          </button>
        </form>
        {errorMessage && (
          <p style={{ marginTop: '15px', color: 'var(--error-color)' }}>
            {errorMessage}
          </p>
        )}
      </div>
    </div>
  );
}