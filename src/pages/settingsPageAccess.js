export const evaluateEcommercePortalAccess = ({
  canAccess,
  currentDeviceRole
}) => {
  if (typeof canAccess !== 'function' || canAccess('settings') !== true) {
    return false;
  }

  if (currentDeviceRole === 'admin') {
    return true;
  }

  return currentDeviceRole === 'staff' && canAccess('ecommerce') === true;
};

export const canManageEcommercePortal = evaluateEcommercePortalAccess;

export { resolveAllowedSettingsTab } from '../services/auth/settingsAccessPolicy';
