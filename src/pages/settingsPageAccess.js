import { isEcommercePortalEnabled } from '../services/ecommerce/ecommerceOrderCapabilities';

export const evaluateEcommercePortalAccess = ({
  canAccess,
  currentDeviceRole,
  licenseDetails = {}
}) => {
  if (typeof canAccess !== 'function' || canAccess('settings') !== true) {
    return false;
  }

  if (!isEcommercePortalEnabled(licenseDetails)) return false;

  if (currentDeviceRole === 'admin') {
    return true;
  }

  return currentDeviceRole === 'staff' && canAccess('ecommerce') === true;
};

export const canManageEcommercePortal = evaluateEcommercePortalAccess;

export { resolveAllowedSettingsTab } from '../services/auth/settingsAccessPolicy';
