import { canReadSalesReports } from '../auth/salesPermissionPolicy';
import { canAccessEcommerceOrders } from '../ecommerce/ecommerceOrderCapabilities';
import { canStaffAccessSupportCenter, isSupportCenterEnabled } from './notificationCapabilities';
import { getNotificationCategory } from './notificationPreferencesService';
import { getCloudInventoryNotificationNavigationRoute } from './inventoryNotificationNavigation';

const ORDER_ROUTE = /^\/pedidos-online\?order=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export const isPendingSyncConflictNotification = (notification) => (
  notification?.type === 'sync' && notification?.metadata?.event === 'sync_errors_active'
);

/**
 * Only verified in-app destinations may be offered. Server action_route is
 * untrusted input, not an instruction to navigate or a permission grant.
 */
export function resolveNotificationAction(notification, {
  actorAccess,
  settingsAccess,
  licenseDetails
} = {}) {
  if (!actorAccess?.isAuthorizedActor) return null;

  const type = notification?.type;
  const event = notification?.metadata?.event;
  const category = getNotificationCategory(notification);
  const route = notification?.action_route || notification?.actionRoute || '';

  if (type === 'inventory') {
    const inventoryRoute = getCloudInventoryNotificationNavigationRoute(notification, {
      canReadReports: canReadSalesReports(actorAccess.runtimeSnapshot),
      canReadProducts: actorAccess.canAccessPermission('products')
        || actorAccess.canAccessPermission('inventory')
    });
    if (!inventoryRoute) return null;
    const label = inventoryRoute === '/ventas?tab=restock' ? 'Ver reabastecimiento'
      : inventoryRoute === '/ventas?tab=expiration' ? 'Ver caducidades' : 'Ver productos';
    return { kind: 'navigate', route: inventoryRoute, label };
  }

  // The current Settings page has no conflict diagnosis tab. Never fall back
  // to its general/license section, even for legacy notifications.
  if (type === 'sync') return null;

  // "Equipo" is an internal state in LicenseSettings, not a deep-link route.
  if (event === 'staff_disabled') return null;

  if (event === 'device_disabled' || event === 'device_limit_reached') {
    return settingsAccess?.canAccessSection('devices')
      ? { kind: 'navigate', route: '/configuracion?tab=devices', label: 'Ver dispositivos' }
      : null;
  }

  if (type === 'license' || category === 'license') {
    return settingsAccess?.canAccessSection('license')
      ? { kind: 'navigate', route: '/configuracion?tab=license', label: 'Ver licencia' }
      : null;
  }

  if (type === 'cash' || notification?.metadata?.category === 'cash') {
    return actorAccess.canAccessPermission('cash_register')
      ? { kind: 'navigate', route: '/caja', label: 'Ver caja' }
      : null;
  }

  if (type === 'ecommerce') {
    const match = typeof route === 'string' ? ORDER_ROUTE.exec(route) : null;
    if (!match || !canAccessEcommerceOrders(licenseDetails, actorAccess.ecommerceSession)) return null;
    return { kind: 'navigate', route: `/pedidos-online?order=${match[1]}`, label: 'Ver pedido' };
  }

  if (
    type === 'support'
    && (route === 'notifications:support' || notification?.metadata?.ticket_id)
    && isSupportCenterEnabled(licenseDetails)
    && canStaffAccessSupportCenter(licenseDetails, actorAccess.permissionSession)
  ) {
    return { kind: 'support', route: null, label: 'Ver soporte' };
  }

  return null;
}
