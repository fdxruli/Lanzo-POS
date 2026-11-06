import { useAppStore } from '../../store/useAppStore';
import { useActorAccess } from '../../services/auth/useActorAccess';
import { evaluateEcommercePortalAccess } from '../../pages/settingsPageAccess';
import NoPermission from './NoPermission';

export default function EcommercePortalRoute({ children }) {
  const actorAccess = useActorAccess();
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  return evaluateEcommercePortalAccess({ canAccess: actorAccess.canAccessPermission, licenseDetails })
    ? children : <NoPermission />;
}
