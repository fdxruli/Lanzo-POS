import { evaluateActorAccess } from './actorAccessPolicy';

export const SETTINGS_SHELL_PERMISSIONS = Object.freeze([
  'settings',
  'license',
  'devices',
  'sync',
  'inventory'
]);

export const SETTINGS_SECTION_PERMISSIONS = Object.freeze({
  general: Object.freeze(['settings']),
  controls: Object.freeze(['settings']),
  license: Object.freeze(['license']),
  devices: Object.freeze(['devices']),
  maintenance: Object.freeze(['sync', 'inventory']),
  backup: Object.freeze(['sync']),
  messages: Object.freeze(['settings'])
});

export const SETTINGS_TAB_DEFINITIONS = Object.freeze([
  Object.freeze({ key: 'general', section: 'general' }),
  Object.freeze({ key: 'controls', section: 'controls' }),
  Object.freeze({ key: 'license', section: 'license' }),
  Object.freeze({ key: 'devices', section: 'devices' }),
  Object.freeze({ key: 'maintenance', section: 'maintenance' }),
  Object.freeze({ key: 'backup', section: 'backup' }),
  Object.freeze({ key: 'messages', section: 'messages' }),
  Object.freeze({ key: 'debug', developmentOnly: true }),
  Object.freeze({ key: 'test-ventas', developmentOnly: true })
]);

const deniedAccess = ({ runtimeSnapshot = null, isDev = false } = {}) => {
  const canAccessPermission = () => false;
  const canAccessSection = () => false;

  return Object.freeze({
    actorType: null,
    actorId: null,
    actorKey: null,
    generation: runtimeSnapshot?.generation ?? null,
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
  const { actorType, actorId: runtimeActorId, isAdmin, canAccessPermission } = actorAccess;
  const canEnterSettings = isAdmin
    || SETTINGS_SHELL_PERMISSIONS.some(canAccessPermission);
  const canAccessSection = (section) => {
    if (!canEnterSettings) return false;
    if (section === 'debug' || section === 'test-ventas') return Boolean(isDev);
    const requiredPermissions = SETTINGS_SECTION_PERMISSIONS[section];
    return Array.isArray(requiredPermissions)
      && requiredPermissions.some(canAccessPermission);
  };
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
    actorKey: runtimeSnapshot.actorKey,
    generation: runtimeSnapshot.generation,
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
