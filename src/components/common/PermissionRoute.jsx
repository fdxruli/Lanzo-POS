import { useActorAccess } from '../../services/auth/useActorAccess';
import NoPermission from './NoPermission';

export default function PermissionRoute({ permission, children }) {
  const { canAccessPermission } = useActorAccess();

  const permissions = Array.isArray(permission) ? permission : [permission];

  if (permissions.some(canAccessPermission)) {
    return children;
  }

  return <NoPermission />;
}
