import { getNativeTenantReconnect } from '../../services/db/databaseRuntime';
import { useActorAccess } from '../../services/auth/useActorAccess';
import NoPermission from './NoPermission';

export default function PermissionRoute({ permission, children }) {
  const { canAccessPermission, isVerifyingAccess } = useActorAccess();

  const permissions = Array.isArray(permission) ? permission : [permission];

  if (permissions.some(canAccessPermission)) {
    return children;
  }

  if (isVerifyingAccess && getNativeTenantReconnect()?.status === 'reconnecting') {
    return <p role="status">Restableciendo la conexión con los datos locales…</p>;
  }

  return <NoPermission />;
}
