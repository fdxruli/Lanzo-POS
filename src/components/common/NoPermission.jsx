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
import './NoPermission.css';

export default function NoPermission() {
  const access = useActorAccess();
  const settingsAccess = useSettingsAccess();
  const licenseDetails = useAppStore((state) => state.licenseDetails);
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

  return (
    <section className="permission-blocker" role="alert" aria-labelledby="permission-blocker-title">
      <div className="permission-blocker__card">
        <div className="permission-blocker__icon" aria-hidden="true">
          <ShieldX size={28} />
        </div>
        <h2 id="permission-blocker-title">No tienes acceso a esta sección</h2>
        <p>{access.isAuthorizedActor
          ? 'Tu perfil no tiene permiso para utilizar este módulo. Si necesitas acceso, solicítalo al administrador del negocio.'
          : 'No pudimos confirmar el acceso de tu sesión. Vuelve a identificarte para utilizar los módulos del negocio.'}</p>
        <Link to={destination.to} replace className="btn btn-primary permission-blocker__action">
          {destination.label}
        </Link>
      </div>
    </section>
  );
}
