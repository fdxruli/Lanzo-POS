import { evaluateActorAccess } from './actorAccessPolicy';

export const SETTINGS_GRANULAR_PERMISSIONS = Object.freeze([
  'settings_data',
  'settings_controls',
  'settings_maintenance',
  'settings_backup'
]);

export const SETTINGS_LEGACY_PERMISSION_FALLBACKS = Object.freeze({
  settings_data: Object.freeze(['settings']),
  settings_controls: Object.freeze(['settings']),
  settings_maintenance: Object.freeze(['sync', 'inventory']),
  settings_backup: Object.freeze(['sync'])
});

export const SETTINGS_SHELL_PERMISSIONS = Object.freeze([
  'settings',
  ...SETTINGS_GRANULAR_PERMISSIONS,
  'license',
  'devices',
  'sync',
  'inventory'
]);

export const SETTINGS_SECTION_PERMISSIONS = Object.freeze({
  general: Object.freeze(['settings_data']),
  controls: Object.freeze(['settings_controls']),
  license: Object.freeze(['license']),
  devices: Object.freeze(['devices']),
  maintenance: Object.freeze(['settings_maintenance']),
  backup: Object.freeze(['settings_backup']),
  messages: Object.freeze(['settings'])
});

export const SETTINGS_TAB_DEFINITIONS = Object.freeze([
  Object.freeze({ key: 'general', section: 'general' }),
  Object.freeze({ key: 'controls', section: 'controls' }),
  Object.freeze({ key: 'license', section: 'license' }),
  Object.freeze({ key: 'devices', section: 'devices' }),
  Object.freeze({ key: 'maintenance', section: 'maintenance' }),
  Object.freeze({ key: 'backup', section: 'backup' }),
  Object.freeze({ key: 'debug', developmentOnly: true }),
  Object.freeze({ key: 'test-ventas', developmentOnly: true })
]);

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const SETTINGS_ACCESS_SECTIONS = Object.freeze([
  'general',
  'controls',
  'license',
  'devices',
  'maintenance',
  'backup'
]);

const deniedAccess = ({ runtimeSnapshot = null, isDev = false } = {}) => {
  const canAccessPermission = () => false;
  const canAccessSection = () => false;

  return Object.freeze({
    actorType: null,
    actorId: null,
    actorKey: null,
    generation: runtimeSnapshot?.generation ?? null,
    runtimeSnapshot: null,
    isAuthorizedActor: false,
    isAdmin: false,
    isStaff: false,
    isDev: Boolean(isDev),
    canEnterSettings: false,
    permissions: Object.freeze({}),
    visibleTabs: Object.freeze([]),
    canAccessPermission,
    canAccessSection
  });
};

/**
 * Resolve Settings authority only when ActorRuntime and the app-store identity
 * agree. The physical device role alone is never accepted as actor authority.
 */
export const evaluateSettingsAccess = ({
  runtimeSnapshot = null,
  currentDeviceRole = null,
  currentAdminUser = null,
  currentStaffUser = null,
  isDev = false,
  actorAccess: validatedAccess = null
} = {}) => {
  const actorAccess = validatedAccess || evaluateActorAccess({
    runtimeSnapshot, currentDeviceRole, currentAdminUser, currentStaffUser
  });
  if (!actorAccess.isAuthorizedActor) return deniedAccess({ runtimeSnapshot, isDev });

  const { actorType, actorId: runtimeActorId, isAdmin } = actorAccess;
  const permissionRecord = actorAccess.permissionSession?.currentStaffUser?.permissions || {};
  const hasGranularSettingsPermissions = SETTINGS_GRANULAR_PERMISSIONS.some((permission) => (
    hasOwn(permissionRecord, permission)
  ));
  const canAccessPermission = (permission) => {
    if (typeof permission !== 'string' || permission.trim().length === 0) return false;
    if (isAdmin || actorAccess.canAccessPermission(permission)) return true;

    const legacyFallbacks = SETTINGS_LEGACY_PERMISSION_FALLBACKS[permission];
    if (!Array.isArray(legacyFallbacks) || hasGranularSettingsPermissions) return false;
    return legacyFallbacks.some((legacyPermission) => (
      actorAccess.canAccessPermission(legacyPermission)
    ));
  };

  const hasSettingsSectionAccess = () => (
    isAdmin || SETTINGS_ACCESS_SECTIONS.some((section) => (
      SETTINGS_SECTION_PERMISSIONS[section].some(canAccessPermission)
    ))
  );
  const canAccessSection = (section) => {
    if (section === 'debug' || section === 'test-ventas') {
      return hasSettingsSectionAccess() && Boolean(isDev);
    }
    const requiredPermissions = SETTINGS_SECTION_PERMISSIONS[section];
    return Array.isArray(requiredPermissions)
      && requiredPermissions.some(canAccessPermission);
  };
  const canEnterSettings = hasSettingsSectionAccess();
  const permissions = Object.freeze(Object.fromEntries(
    SETTINGS_SHELL_PERMISSIONS.map((permission) => [
      permission,
      canAccessPermission(permission)
    ])
  ));
  const visibleTabs = Object.freeze(SETTINGS_TAB_DEFINITIONS
    .filter((tab) => (
      tab.developmentOnly
        ? canEnterSettings && Boolean(isDev)
        : canAccessSection(tab.section)
    ))
    .map((tab) => Object.freeze({ key: tab.key })));

  return Object.freeze({
    actorType,
    actorId: runtimeActorId,
    actorKey: runtimeSnapshot?.actorKey || actorAccess.runtimeSnapshot?.actorKey || null,
    generation: runtimeSnapshot?.generation ?? actorAccess.runtimeSnapshot?.generation ?? null,
    runtimeSnapshot: actorAccess.runtimeSnapshot,
    isAuthorizedActor: true,
    isAdmin,
    isStaff: actorType === 'staff',
    isDev: Boolean(isDev),
    canEnterSettings,
    permissions,
    visibleTabs,
    canAccessPermission,
    canAccessSection
  });
};

export const resolveAllowedSettingsTab = ({ requestedTab, visibleTabs } = {}) => {
  const allowedTabs = Array.isArray(visibleTabs) ? visibleTabs : [];
  if (allowedTabs.length === 0) return null;
  return allowedTabs.some((tab) => tab.key === requestedTab)
    ? requestedTab
    : allowedTabs[0].key;
};

export default Object.freeze({
  evaluateSettingsAccess,
  resolveAllowedSettingsTab
});
