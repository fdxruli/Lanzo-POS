import { useAppStore } from '../../store/useAppStore';
import {
  getLicenseKeyFromDetails,
  isCloudCashSyncEnabled
} from '../sync/syncConstants';

export const CASH_CLOUD_OFFLINE_MESSAGE = 'Caja cloud requiere conexión para proteger el dinero y evitar descuadres. Revisa tu conexión e intenta de nuevo.';

export const isBrowserOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

export const getStaffDisplayName = (staffUser = null) => (
  staffUser?.display_name ||
  staffUser?.displayName ||
  staffUser?.name ||
  staffUser?.username ||
  staffUser?.email ||
  'Staff'
);

export const getCashActorFromState = (state = useAppStore.getState()) => {
  const deviceRole = state?.currentDeviceRole || 'admin';
  const staffUser = state?.currentStaffUser || null;
  const isStaff = deviceRole === 'staff';
  const name = isStaff ? getStaffDisplayName(staffUser) : 'Administrador';

  return {
    deviceRole,
    isStaff,
    staffUser,
    staffUserId: staffUser?.id || null,
    responsibleName: name,
    displayName: name,
    actorKey: isStaff && staffUser?.id ? `staff:${staffUser.id}` : null,
    label: isStaff ? 'Staff' : 'Admin'
  };
};

export const getCashMode = () => {
  const state = useAppStore.getState();
  const licenseDetails = state?.licenseDetails || null;
  const licenseKey = getLicenseKeyFromDetails(licenseDetails);
  const cloudEnabled = Boolean(licenseKey && isCloudCashSyncEnabled(licenseDetails));
  const online = isBrowserOnline();
  const actor = getCashActorFromState(state);

  return {
    appStatus: state?.appStatus,
    licenseDetails,
    licenseKey,
    cloudEnabled,
    online,
    readOnly: cloudEnabled && !online,
    actor
  };
};
