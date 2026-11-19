import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ShieldX } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useActorAccess } from '../../services/auth/useActorAccess';
import { getAccessDeniedDestination } from '../../services/auth/routePermissions';
import { canReadSalesReports } from '../../services/auth/salesPermissionPolicy';
import { useSettingsAccess } from '../../services/auth/useSettingsAccess';
import { canAccessEcommerceOrders } from '../../services/ecommerce/ecommerceOrderCapabilities';
import { evaluateEcommercePortalAccess } from '../../pages/settingsPageAccess';
import { getCommercialAIAgentAccessState } from '../../services/auth/aiAgentAuthorization';
import { ACTOR_RUNTIME_STATUS } from '../../services/auth/actorRuntimeController';
import { useActorRuntimeSnapshot } from '../../services/auth/useActorRuntimeSnapshot';
import './NoPermission.css';

let lastTenantReadinessRecoveryGeneration = null;
let tenantReadinessRecoveryPromise = null;

const wasTenantReadinessRecoveryAttempted = (generation) => (
  Number.isFinite(generation) && lastTenantReadinessRecoveryGeneration === generation
);

const retryTenantReadinessRecovery = (generation, initializeApp) => {
  if (!Number.isFinite(generation) || typeof initializeApp !== 'function') {
    return Promise.reject(new Error('AUTHORITY_RECOVERY_UNAVAILABLE'));
  }
  if (tenantReadinessRecoveryPromise) return tenantReadinessRecoveryPromise;
  if (wasTenantReadinessRecoveryAttempted(generation)) {
    return Promise.resolve({ status: 'already_attempted' });
  }
  lastTenantReadinessRecoveryGeneration = generation;
  tenantReadinessRecoveryPromise = Promise.resolve()
    .then(() => initializeApp({ force: true }))
    .finally(() => { tenantReadinessRecoveryPromise = null; });
  return tenantReadinessRecoveryPromise;
};

export default function NoPermission() {
  const [isRecovering, setIsRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  const access = useActorAccess();
  const runtimeSnapshot = useActorRuntimeSnapshot();
  const settingsAccess = useSettingsAccess();
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const initializeApp = useAppStore((state) => state.initializeApp);
  const isInitializing = useAppStore((state) => state._isInitializing === true);
  const { pathname } = useLocation();
  const alternatives = [
    [canReadSalesReports(access.runtimeSnapshot || {}), '/ventas', 'Ir a Ventas'],
    [canAccessEcommerceOrders(licenseDetails, access.ecommerceSession), '/pedidos-online', 'Ir a Pedidos Online'],
    [settingsAccess.canEnterSettings, '/configuracion', 'Ir a Configuración'],
    [evaluateEcommercePortalAccess({ canAccess: access.canAccessPermission, licenseDetails }), '/portal-online', 'Ir al Portal Online'],
    [getCommercialAIAgentAccessState({ licenseDetails, actorSnapshot: access.runtimeSnapshot }).canEnter, '/agentes-ia', 'Ir a Agentes IA']
  ];
  const alternative = alternatives.find(([allowed, to]) => allowed && to !== pathname);
  const destination = getAccessDeniedDestination(access, pathname)
    || (alternative && { to: alternative[1], label: alternative[2] })
    || { to: '/acerca-de', label: 'Ir a Acerca de' };
  const isRestoringSession = [
    ACTOR_RUNTIME_STATUS.AUTHENTICATING,
    ACTOR_RUNTIME_STATUS.HANDOFF_CHECK
  ].includes(runtimeSnapshot?.status);
  const isVerifyingAccess = isRestoringSession || access.isVerifyingAccess;
  const retryAttempted = access.isVerifyingAccess
    && wasTenantReadinessRecoveryAttempted(runtimeSnapshot?.generation);

  const retryVerification = async () => {
    if (!access.isVerifyingAccess || isInitializing || isRecovering || retryAttempted) return;
    setIsRecovering(true);
    setRecoveryError('');
    try {
      await retryTenantReadinessRecovery(runtimeSnapshot?.generation, initializeApp);
    } catch {
      setRecoveryError('No pudimos restablecer la verificación. Vuelve a intentarlo después o inicia sesión para continuar.');
    } finally {
      setIsRecovering(false);
    }
  };

  return (
    <section className="permission-blocker" role={isVerifyingAccess ? 'status' : 'alert'} aria-labelledby="permission-blocker-title">
      <div className="permission-blocker__card">
        <div className="permission-blocker__icon" aria-hidden="true">
          <ShieldX size={28} />
        </div>
        <h2 id="permission-blocker-title">
          {isVerifyingAccess ? 'Verificando acceso a tu sesión' : 'No tienes acceso a esta sección'}
        </h2>
        <p>{isVerifyingAccess
          ? 'Estamos confirmando tu sesión y sus permisos. Esta sección seguirá protegida hasta terminar la verificación.'
          : access.isAuthorizedActor
          ? 'Tu perfil no tiene permiso para utilizar este módulo. Si necesitas acceso, solicítalo al administrador del negocio.'
          : 'No pudimos confirmar el acceso de tu sesión. Vuelve a identificarte para utilizar los módulos del negocio.'}</p>
        {access.isVerifyingAccess && !isInitializing && !retryAttempted && (
          <button type="button" className="btn btn-primary permission-blocker__action"
            onClick={retryVerification} disabled={isRecovering}>
            {isRecovering ? 'Verificando…' : 'Reintentar verificación'}
          </button>
        )}
        {recoveryError && <p role="alert">{recoveryError}</p>}
        {access.isVerifyingAccess && retryAttempted && !isRecovering && (
          <p>La verificación ya se reintentó para esta sesión. Si continúa pendiente, vuelve a identificarte antes de seguir.</p>
        )}
        <Link to={destination.to} replace className="btn btn-primary permission-blocker__action">
          {destination.label}
        </Link>
      </div>
    </section>
  );
}
