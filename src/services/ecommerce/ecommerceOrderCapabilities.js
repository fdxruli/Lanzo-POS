const isPlainObject = (value) => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const isTrue = (value) => value === true || value === 'true';

export const getEcommerceOrderFeatures = (licenseDetails = {}) => {
  if (isPlainObject(licenseDetails?.features)) return licenseDetails.features;
  if (isPlainObject(licenseDetails?.details?.features)) return licenseDetails.details.features;
  return {};
};

const getStaffPermissions = (staffSession = {}) => (
  staffSession?.permissions ||
  staffSession?.currentStaffUser?.permissions ||
  staffSession?.staffUser?.permissions ||
  {}
);

export const getEcommerceOrderDeviceRole = (staffSession = {}) => {
  const explicitRole = (
    staffSession?.currentDeviceRole ||
    staffSession?.deviceRole ||
    null
  );

  if (explicitRole) return explicitRole;
  if (staffSession?.isStaff === true) return 'staff';
  return null;
};

export const isEcommerceOrderRoleResolving = (staffSession = {}) => (
  getEcommerceOrderDeviceRole(staffSession) === null &&
  staffSession?._isInitializing === true
);

export function isEcommerceOrderInboxEnabled(licenseDetails = {}) {
  return isTrue(getEcommerceOrderFeatures(licenseDetails).ecommerce_order_inbox);
}

export function canAccessEcommerceOrders(licenseDetails = {}, staffSession = {}) {
  if (!isEcommerceOrderInboxEnabled(licenseDetails)) return false;

  const deviceRole = getEcommerceOrderDeviceRole(staffSession);
  if (!deviceRole) return false;
  if (deviceRole === 'admin') return true;
  if (deviceRole !== 'staff') return false;

  return getStaffPermissions(staffSession).ecommerce === true;
}

export function canUseEcommerceOrderRealtime(licenseDetails = {}, staffSession = {}) {
  const features = getEcommerceOrderFeatures(licenseDetails);
  return (
    canAccessEcommerceOrders(licenseDetails, staffSession) &&
    isTrue(features.ecommerce_realtime_orders) &&
    Boolean(
      licenseDetails?.realtime_topic ||
      licenseDetails?.realtimeTopic ||
      licenseDetails?.details?.realtime_topic
    )
  );
}

export function getEcommerceOrderCapabilityReason(licenseDetails = {}, staffSession = {}) {
  if (!isEcommerceOrderInboxEnabled(licenseDetails)) return 'ECOMMERCE_ORDER_INBOX_DISABLED';

  const deviceRole = getEcommerceOrderDeviceRole(staffSession);
  if (!deviceRole) return 'ECOMMERCE_ORDERS_ACCESS_DENIED';
  if (deviceRole === 'admin') return null;
  if (deviceRole !== 'staff') return 'ECOMMERCE_ORDERS_ACCESS_DENIED';
  if (getStaffPermissions(staffSession).ecommerce !== true) {
    return 'ECOMMERCE_STAFF_PERMISSION_DENIED';
  }

  return null;
}
