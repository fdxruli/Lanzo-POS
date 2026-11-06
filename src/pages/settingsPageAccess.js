import { isEcommercePortalEnabled } from '../services/ecommerce/ecommerceOrderCapabilities';

export const evaluateEcommercePortalAccess = ({
  canAccess,
  licenseDetails = {}
}) => (
  typeof canAccess === 'function'
  && canAccess('settings') === true
  && canAccess('ecommerce') === true
  && isEcommercePortalEnabled(licenseDetails)
);

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
