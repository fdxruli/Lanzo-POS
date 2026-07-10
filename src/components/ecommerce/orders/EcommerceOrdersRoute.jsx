import { useAppStore } from '../../../store/useAppStore';
import { canAccessEcommerceOrders } from '../../../services/ecommerce/ecommerceOrderCapabilities';
import NoPermission from '../../common/NoPermission';

export default function EcommerceOrdersRoute({ children }) {
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const currentDeviceRole = useAppStore((state) => state.currentDeviceRole);
  const currentStaffUser = useAppStore((state) => state.currentStaffUser);

  const allowed = canAccessEcommerceOrders(licenseDetails, {
    currentDeviceRole,
    currentStaffUser
  });

  return allowed ? children : <NoPermission />;
}
