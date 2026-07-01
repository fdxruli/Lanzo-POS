import { useAppStore } from '../../store/useAppStore';
import NoPermission from './NoPermission';

export default function PermissionRoute({ permission, children }) {
  const canAccess = useAppStore((state) => state.canAccess);
  useAppStore((state) => state.currentDeviceRole);
  useAppStore((state) => state.currentStaffUser);

  const permissions = Array.isArray(permission) ? permission : [permission];

  if (!permission || permissions.some((item) => canAccess(item))) {
    return children;
  }

  return <NoPermission />;
}
