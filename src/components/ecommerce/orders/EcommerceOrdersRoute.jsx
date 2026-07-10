import { useAppStore } from '../../../store/useAppStore';
import {
  canAccessEcommerceOrders,
  isEcommerceOrderRoleResolving
} from '../../../services/ecommerce/ecommerceOrderCapabilities';
import NoPermission from '../../common/NoPermission';

export default function EcommerceOrdersRoute({ children }) {
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const currentStaffUser = useAppStore((state) => state.currentStaffUser);
  const isInitializing = useAppStore((state) => state._isInitializing);

  const staffSession = {
    currentDeviceRole,
    currentStaffUser,
    _isInitializing: isInitializing
  };

  if (isEcommerceOrderRoleResolving(staffSession)) {
    return <div role="status" aria-live="polite">Cargando permisos…</div>;
  }

  const allowed = canAccessEcommerceOrders(licenseDetails, staffSession);
  return allowed ? children : <NoPermission />;
}
