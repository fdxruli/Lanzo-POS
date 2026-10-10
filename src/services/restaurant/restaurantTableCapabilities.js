import { actorRuntimeController } from '../auth/actorRuntimeController';
import { isRestaurantCloudTableShadow, isRestaurantCloudTableSettlementRequired } from './restaurantCloudTableGuards';

export const ADMIN_REMOTE_EDIT = 'BLOCKED_PENDING_INVENTORY_CONTRACT';
export const TABLE_CAPABILITIES = Object.freeze(['canViewTable', 'canEditTable', 'canSendToKitchen',
  'canCheckoutTable', 'canSplitTable', 'canCancelTable', 'canAdministerTable']);
export const deniedTableCapabilities = () => Object.fromEntries(TABLE_CAPABILITIES.map((key) => [key, false]));
const permission = (actor, name) => actor.permissions?.includes('*') || actor.permissions?.includes(name);

// Local projection only. Cloud grants are returned by an authenticated RPC and
// bound to this actor/session/tenant/version by the caller. SQL rechecks writes.
export const getRestaurantTableCapabilities = ({ order, actor = actorRuntimeController.getState(), verified = null, enforceStaffOwnership = true } = {}) => {
  const denied = deniedTableCapabilities();
  if (!order || actor?.status !== 'granted' || !actor.actorId || !actor.sessionId || !actor.tenant?.opaqueId) return denied;
  if ((order.tenantOpaqueId && order.tenantOpaqueId !== actor.tenant.opaqueId)
    || (order.restaurantCloudTenantId && order.restaurantCloudTenantId !== actor.tenant.opaqueId)) return denied;
  if (isRestaurantCloudTableSettlementRequired(order) || order.cloudOrder) {
    if (!verified || verified.actorKey !== actor.actorKey || verified.sessionId !== actor.sessionId
      || verified.generation !== actor.generation || verified.tenantId !== actor.tenant.opaqueId
      || verified.orderId !== order.id) return { ...denied, canViewTable: permission(actor, 'pos') };
    return Object.fromEntries(TABLE_CAPABILITIES.map((key) => [key, verified.capabilities?.[key] === true
      && (!['canEditTable', 'canSendToKitchen'].includes(key) || !isRestaurantCloudTableShadow(order))]));
  }
  const view = permission(actor, 'pos');
  const active = !order.restaurantCloudTerminalState && !order.isLockedForCheckout
    && !['paid', 'closed', 'cancelled'].includes(order.status);
  const owner = actor.actorType === 'staff' && order.createdByStaffUserId === actor.actorId;
  const admin = actor.actorType === 'admin';
  const allowed = active && (!enforceStaffOwnership || owner || admin);
  return { canViewTable: view, canEditTable: view && allowed, canSendToKitchen: view && allowed,
    canCheckoutTable: view && allowed, canSplitTable: view && allowed,
    canCancelTable: allowed && permission(actor, 'refunds'), canAdministerTable: false };
};

export const bindRestaurantTableCapabilities = (response, actor, orderId) => ({
  actorKey: actor.actorKey, sessionId: actor.sessionId, generation: actor.generation,
  tenantId: actor.tenant.opaqueId, orderId, capabilities: response.capabilities,
  parentVersion: response.parentVersion, cloudOrderId: response.cloudOrderId
});
