// Synthetic license and actor, no keys, sessions, DB, network or real business data.
const state = {
  licenseDetails: {
    plan_code: 'free_trial', valid: true, status: 'active', max_devices: 1,
    features: {
      cloud_pos_sync: false, staff_roles: false, ai_agents: false,
      local_inventory_alerts: true, ecommerce_portal_enabled: true,
      ecommerce_max_published_products: 10, ecommerce_business_hours: true,
      ecommerce_whatsapp_checkout: true, ecommerce_order_inbox: true
    }
  },
  licenseStatus: 'active', companyProfile: { name: 'Negocio de prueba', business_type: ['abarrotes'] },
  canAccess: () => true, currentDeviceRole: 'admin', currentStaffUser: null,
  currentAdminUser: { id: 'qa-admin' }, ecommerceOrderCounts: {},
  isVolatileDismissed: true, dismissedBackupNotice: true,
  setVolatileDismissed: () => {}, setDismissedBackupNotice: () => {},
  dismissBackupNotice: () => {}, showBackupNotice: false
};
export const useAppStore = (selector) => selector(state);
useAppStore.getState = () => state;
export const useActorRuntimeSnapshot = () => ({ status: 'granted', actorType: 'admin', actorId: 'qa-admin', sessionId: 'qa-session', permissions: ['*'] });
export const useSettingsAccess = () => ({ isAuthorizedActor: true, isAdmin: true, actorType: 'admin', canEnterSettings: true, canAccessSection: () => true, canAccessPermission: () => true });
export const useBackupManager = () => ({ status: { initialized: false } });
export const getCommercialAIAgentAccessState = () => ({ canEnter: false });
export const useConfirmDiscard = ({ onClose }) => onClose;
export const useBackupRiskStore = (selector) => selector({ riskLevel: 'low' });
// Default replaces both the persistent-storage hook and the absent Free bell.
export default function NoRemoteRuntime() { return null; }
