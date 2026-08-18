export const DEVICE_MODES = Object.freeze({
  SHARED: 'shared',
  ADMIN_ONLY: 'admin_only',
  STAFF_ONLY: 'staff_only'
});

export const DEVICE_MODE_OPTIONS = Object.freeze([
  { value: DEVICE_MODES.ADMIN_ONLY, label: 'Solo Admin' },
  { value: DEVICE_MODES.STAFF_ONLY, label: 'Solo Staff' },
  { value: DEVICE_MODES.SHARED, label: 'Compartido' }
]);

const VALID_MODES = new Set(Object.values(DEVICE_MODES));

export const resolveDeviceMode = (device = {}) => {
  const explicitMode = String(device?.device_mode || '').trim();
  if (VALID_MODES.has(explicitMode)) return explicitMode;

  const legacyRole = String(
    device?.legacy_device_role || device?.device_role || ''
  ).trim();

  if (legacyRole === 'admin') return DEVICE_MODES.ADMIN_ONLY;
  if (legacyRole === 'staff') return DEVICE_MODES.STAFF_ONLY;
  return null;
};

export const deviceModeAllowsActor = (deviceOrMode, actorType) => {
  const mode = typeof deviceOrMode === 'string'
    ? deviceOrMode
    : resolveDeviceMode(deviceOrMode);

  if (actorType === 'admin') {
    return mode === DEVICE_MODES.ADMIN_ONLY || mode === DEVICE_MODES.SHARED;
  }

  if (actorType === 'staff') {
    return mode === DEVICE_MODES.STAFF_ONLY || mode === DEVICE_MODES.SHARED;
  }

  return false;
};

export const getDeviceModeLabel = (deviceOrMode) => {
  const mode = typeof deviceOrMode === 'string'
    ? deviceOrMode
    : resolveDeviceMode(deviceOrMode);

  return DEVICE_MODE_OPTIONS.find((option) => option.value === mode)?.label || 'Sin definir';
};
