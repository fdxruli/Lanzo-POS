import React, { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useNavigate } from 'react-router-dom';
import Logger from '../../services/Logger';
import './RenewalModal.css';

export default function RenewalModal() {
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const companyProfile = useAppStore((state) => state.companyProfile);
  const renewLicense = useAppStore((state) => state.renewLicense);
  const logout = useAppStore((state) => state.logout);

  const navigate = useNavigate();

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleRenewal = async () => {
    setIsLoading(true);
    setErrorMessage('');
    
    try {
      const result = await renewLicense();
      if (!result.success) {
        setErrorMessage(result.message || 'Error al renovar.');
      } else {
        Logger.log("Renovación exitosa:", result);
        navigate('/');
      }
    } catch (error) {
      Logger.error("Error en renovación:", error);
      setErrorMessage('Ocurrió un error inesperado. Intenta de nuevo.');
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '---';
    return new Date(dateString).toLocaleDateString('es-MX', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
  };

  return (
    <div className="renewal-overlay">
      <div className="renewal-card">
        
        {/* Header Visual */}
        <div className="renewal-header">
          <div className="status-icon-container">
            <span className="lock-icon">🔒</span>
          </div>
          <h2>Licencia Expirada</h2>
          <p>Tu periodo de servicio ha finalizado. Renueva para continuar operando sin interrupciones.</p>
        </div>

        {/* Info Box - Datos de la cuenta */}
        <div className="renewal-details">
          <div className="detail-row">
            <span className="detail-label">Negocio</span>
            <span className="detail-value">{companyProfile?.name || '----'}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Licencia</span>
            <span className="detail-value mono">{licenseDetails?.license_key || '----'}</span>
          </div>
          <div className="detail-row error">
            <span className="detail-label">Venció el</span>
            <span className="detail-value">{formatDate(licenseDetails?.expires_at)}</span>
          </div>
        </div>

        {/* Feedback de Error */}
        {errorMessage && (
          <div className="renewal-error">
            ⚠️ {errorMessage}
          </div>
        )}

        {/* Acciones */}
        <div className="renewal-actions">
          <p className="promo-text">
            Renueva ahora y obtén <strong>3 meses más gratis</strong>
          </p>

          <button 
            className="btn-primary btn-full" 
            onClick={handleRenewal} 
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <span className="spinner"></span> 
              </>
            ) : '🔄 Reactivar Servicio'}
          </button>
          
          <button 
              className="btn-link-subtle" 
              onClick={logout}
              disabled={isLoading}
          >
            Cerrar sesión / Cambiar cuenta
          </button>
        </div>
      </div>
    </div>
  );
}