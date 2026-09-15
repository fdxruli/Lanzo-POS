import { isProLicense } from '../store/slices/license/licenseGuards';

export const DATA_SAFETY_ACKNOWLEDGED_KEY = 'lanzo_data_safety_ack';

export const hasAcknowledgedDataSafety = (
  storage = typeof globalThis !== 'undefined' ? globalThis.localStorage : null
) => {
  try {
    return storage?.getItem?.(DATA_SAFETY_ACKNOWLEDGED_KEY) === 'true';
  } catch {
    return false;
  }
};

export const acknowledgeDataSafety = (
  storage = typeof globalThis !== 'undefined' ? globalThis.localStorage : null
) => {
  try {
    storage?.setItem?.(DATA_SAFETY_ACKNOWLEDGED_KEY, 'true');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('lanzo-data-safety-acknowledged'));
    }
    return true;
  } catch {
    return false;
  }
};

export const isDataSafetyModalEligible = ({
  licenseDetails,
  currentDeviceRole,
  currentStaffUser,
  acknowledged = false,
}) => (
  !acknowledged
  && !isProLicense(licenseDetails)
  && currentDeviceRole !== 'staff'
  && licenseDetails?.device_role !== 'staff'
  && !currentStaffUser
  && !licenseDetails?.staff_user
);
