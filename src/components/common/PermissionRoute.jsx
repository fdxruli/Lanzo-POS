import { useAppStore } from '../../store/useAppStore';
import NoPermission from './NoPermission';

export default function PermissionRoute({ permission, children }) {
  const canAccess = useAppStore((state) => state.canAccess);
  useAppStore((state) => state.currentDeviceRole);
  useAppStore((state) => state.currentStaffUser);

  if (!permission || canAccess(permission)) {
    return children;
  }

  return <NoPermission />;
}
