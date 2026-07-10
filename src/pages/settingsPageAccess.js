export const canManageEcommercePortal = ({
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

export const resolveAllowedSettingsTab = ({
  requestedTab,
  visibleTabs
}) => {
  const allowedTabs = Array.isArray(visibleTabs) ? visibleTabs : [];
  const fallbackTab = allowedTabs[0]?.key || 'general';

  return allowedTabs.some((tab) => tab.key === requestedTab)
    ? requestedTab
    : fallbackTab;
};
