import React, { useMemo, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useNavigate } from 'react-router-dom';
import Logger from '../../services/Logger';
import './RenewalModal.css';

const normalizePlanCode = (licenseDetails = {}) => (
  licenseDetails?.plan_code ||
  licenseDetails?.plan ||
  licenseDetails?.subscription_plan ||
  licenseDetails?.product_code ||
  ''
).toString().trim().toLowerCase();

const getLicenseContext = (licenseDetails = {}) => {
  const planCode = normalizePlanCode(licenseDetails);
  const licenseType = String(licenseDetails?.license_type || '').trim().toLowerCase();
  const isPaidPlan = planCode.includes('pro') || planCode.includes('basic');
  const isFreePlan = !isPaidPlan && (
    planCode === 'free_trial' ||
    planCode.includes('free') ||
    planCode.includes('trial') ||
    licenseType === 'free'
  );
  const isFreeLifetime = isFreePlan && (
    licenseDetails?.is_lifetime === true ||
    licenseDetails?.expires_at == null ||
    licenseType === 'free'
  );

  return {
    isPaidPlan,
    isFreePlan,
    isFreeLifetime,
    canRunFreeCompatFlow: isFreePlan && !isFreeLifetime
  };
};

export default function RenewalModal() {
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const companyProfile = useAppStore((state) => state.companyProfile);
  const renewLicense = useAppStore((state) => state.renewLicense);
  const logout = useAppStore((state) => state.logout);

  const navigate = useNavigate();

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const licenseContext = useMemo(() => getLicenseContext(licenseDetails), [licenseDetails]);

  if (licenseContext.isFreeLifetime) {
    return null;
  }

  const handleRenewal = async () => {
    if (!licenseContext.canRunFreeCompatFlow) {
      setErrorMessage('Esta licencia no usa actualización FREE. Cambia de licencia o contacta a soporte.');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');
    
    try {
      const result = await renewLicense();
      if (!result.success) {
        setErrorMessage(result.message || 'No se pudo revisar la licencia.');
      } else {
        Logger.log('Licencia FREE revisada:', result);
        navigate('/');
      }
    } catch (error) {
      Logger.error('Error revisando licencia FREE:', error);
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
          <h2>Licencia requiere revisión</h2>
          <p>
            {licenseContext.canRunFreeCompatFlow
              ? 'Detectamos una licencia FREE anterior con vencimiento técnico. Al continuar se actualizará a FREE permanente.'
              : 'Esta licencia tiene vencimiento técnico. Cambia de licencia o contacta a soporte para continuar.'}
          </p>
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
            <span className="detail-label">Vencimiento técnico</span>
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
            {licenseContext.canRunFreeCompatFlow
              ? 'Tu licencia FREE se actualizará a permanente.'
              : 'Este flujo no aplica a licencias PRO/BASIC.'}
          </p>

          {licenseContext.canRunFreeCompatFlow && (
            <button 
              className="btn-primary btn-full" 
              onClick={handleRenewal} 
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <span className="spinner"></span> 
                </>
              ) : 'Actualizar a FREE permanente'}
            </button>
          )}
          
          <button 
              className="btn-link-subtle" 
              onClick={logout}
              disabled={isLoading}
          >
            Cerrar sesión / Cambiar licencia
          </button>
        </div>
      </div>
    </div>
  );
}
