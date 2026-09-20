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

import { resolveAllowedSettingsTab as resolvePolicySettingsTab } from '../services/auth/settingsAccessPolicy';

const REMOVED_SETTINGS_TABS = new Set(['messages']);

export const getVisibleSettingsTabs = (visibleTabs = []) => (
  (Array.isArray(visibleTabs) ? visibleTabs : [])
    .filter((tab) => !REMOVED_SETTINGS_TABS.has(tab?.key))
);

export const resolveAllowedSettingsTab = ({ requestedTab, visibleTabs } = {}) => (
  resolvePolicySettingsTab({
    requestedTab,
    visibleTabs: getVisibleSettingsTabs(visibleTabs)
  })
);
