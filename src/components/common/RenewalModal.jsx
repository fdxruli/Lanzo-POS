import { useMemo, useState } from 'react';
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
    licenseDetails?.expires_at === null ||
    licenseDetails?.expires_at === undefined ||
    licenseType === 'free'
  );

  return {
    isPaidPlan,
    isFreePlan,
    isFreeLifetime,
    canRunFreeCompatFlow: isFreePlan && !isFreeLifetime
  };
};

const formatDate = (dateString) => {
  if (!dateString) return 'No disponible';
  const parsed = new Date(dateString);
  if (Number.isNaN(parsed.getTime())) return 'No disponible';
  return parsed.toLocaleString('es-MX', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

export default function RenewalModal() {
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const companyProfile = useAppStore((state) => state.companyProfile);
  const renewLicense = useAppStore((state) => state.renewLicense);
  const verifySessionIntegrity = useAppStore((state) => state.verifySessionIntegrity);
  const lastIntegrityFailure = useAppStore((state) => state.lastIntegrityFailure);
  const logout = useAppStore((state) => state.logout);

  const navigate = useNavigate();

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const licenseContext = useMemo(() => getLicenseContext(licenseDetails), [licenseDetails]);
  const transitionPending = Boolean(
    licenseContext.isPaidPlan &&
    String(licenseDetails?.status || '').toLowerCase() === 'expired'
  );

  if (licenseContext.isFreeLifetime) {
    return null;
  }

  const handleFreeCompatibility = async () => {
    if (!licenseContext.canRunFreeCompatFlow) {
      setErrorMessage('Esta licencia no usa la actualización Lanzo Local.');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    try {
      const result = await renewLicense();
      if (!result.success) {
        setErrorMessage(result.message || 'No se pudo revisar la licencia.');
      } else {
        Logger.log('Licencia Lanzo Local revisada:', result);
        navigate('/');
      }
    } catch (error) {
      Logger.error('Error revisando licencia Lanzo Local:', error);
      setErrorMessage('Ocurrió un error inesperado. Intenta de nuevo.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleTransitionRetry = async () => {
    setIsLoading(true);
    setErrorMessage('');

    try {
      const resolved = await verifySessionIntegrity({
        reason: 'license_expiry_transition_retry',
        forceRemote: true,
        refreshProfile: true,
        transactionMode: false,
        allowLocalOnly: false
      });

      if (!resolved) {
        const latestFailure = useAppStore.getState().lastIntegrityFailure;
        setErrorMessage(
          latestFailure?.source === 'network'
            ? 'No pudimos confirmar el cambio de plan. Revisa tu conexión e inténtalo nuevamente.'
            : latestFailure?.message || 'El cambio todavía no ha sido confirmado por el servidor. Puedes volver a intentarlo.'
        );
      }
    } catch (error) {
      Logger.warn('No se pudo confirmar la transición a Lanzo Local:', error);
      setErrorMessage('No pudimos confirmar el cambio de plan. Revisa tu conexión e inténtalo nuevamente.');
    } finally {
      setIsLoading(false);
    }
  };

  const transitionError = errorMessage || (
    transitionPending && lastIntegrityFailure?.source === 'network'
      ? 'No pudimos confirmar el cambio de plan. Revisa tu conexión e inténtalo nuevamente.'
      : ''
  );

  return (
    <div className="renewal-overlay" role="dialog" aria-modal="true" aria-labelledby="renewal-title">
      <div className="renewal-card" aria-busy={isLoading}>
        <div className="renewal-header">
          <div className="status-icon-container" aria-hidden="true">
            <span className="lock-icon">{transitionPending ? '↻' : '🔒'}</span>
          </div>
          <h2 id="renewal-title">
            {transitionPending ? 'Estamos actualizando tu licencia a Lanzo Local' : 'Licencia requiere revisión'}
          </h2>
          <p>
            {transitionPending
              ? 'Tu período de gracia terminó. Lanzo está confirmando el cambio al plan Local antes de continuar.'
              : licenseContext.canRunFreeCompatFlow
                ? 'Detectamos una licencia Lanzo Local anterior con vencimiento técnico. Al continuar se actualizará a Lanzo Local permanente.'
                : 'Esta licencia requiere una revisión de su estado antes de continuar.'}
          </p>
        </div>

        <div className="renewal-details">
          <div className="detail-row">
            <span className="detail-label">Negocio</span>
            <span className="detail-value">{companyProfile?.business_name || companyProfile?.name || 'No disponible'}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">{transitionPending ? 'Fin del período anterior' : 'Vencimiento técnico'}</span>
            <span className="detail-value">{formatDate(licenseDetails?.grace_period_ends || licenseDetails?.expires_at)}</span>
          </div>
          {transitionPending && (
            <div className="detail-row">
              <span className="detail-label">Siguiente paso</span>
              <span className="detail-value">Confirmar Lanzo Local con el servidor</span>
            </div>
          )}
        </div>

        {transitionError && (
          <div className="renewal-error" role="alert">
            ⚠️ {transitionError}
          </div>
        )}

        <div className="renewal-actions">
          <p className="promo-text">
            {transitionPending
              ? 'Tus datos locales no se borrarán. Si el cambio no puede confirmarse ahora, puedes volver a intentarlo.'
              : licenseContext.canRunFreeCompatFlow
                ? 'Tu licencia Lanzo Local se actualizará a permanente.'
                : 'Puedes cambiar de licencia si este acceso ya no corresponde al negocio.'}
          </p>

          {transitionPending && (
            <button
              type="button"
              className="btn-primary btn-full"
              onClick={handleTransitionRetry}
              disabled={isLoading}
              autoFocus
            >
              {isLoading ? <span className="spinner" aria-label="Confirmando cambio de plan" /> : 'Reintentar actualización'}
            </button>
          )}

          {!transitionPending && licenseContext.canRunFreeCompatFlow && (
            <button
              type="button"
              className="btn-primary btn-full"
              onClick={handleFreeCompatibility}
              disabled={isLoading}
            >
              {isLoading ? <span className="spinner" aria-label="Actualizando licencia" /> : 'Actualizar a Lanzo Local permanente'}
            </button>
          )}

          <button
            type="button"
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
