import { ADMIN_VALID_ROUTE_PATHS } from '../router/adminRoutePaths';
import { canAccessEcommerceOrders } from '../services/ecommerce/ecommerceOrderCapabilities';
import { getCommercialAIAgentAccessState } from '../services/auth/aiAgentAuthorization';
import { SETTINGS_SECTION_PERMISSIONS } from '../services/auth/settingsAccessPolicy';

const routePermissions = {
  '/': ['pos'], '/productos': ['products', 'inventory'], '/clientes': ['customers'],
  '/caja': ['cash_register'], '/pedidos': ['orders'], '/ventas': ['reports'],
  '/portal-online': ['settings'], '/pedidos-online': ['ecommerce'], '/agentes-ia': ['ai_agents']
};
export const canOpenBotAction = (path, canAccess, context = null) => {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return false;
  const [pathname, search = ''] = path.split('?');
  if (!ADMIN_VALID_ROUTE_PATHS.includes(pathname)) return false;
  if (pathname === '/acerca-de') return true;
  if (typeof canAccess !== 'function') return false;
  const tab = new URLSearchParams(search).get('tab');
  if (context && pathname === '/pedidos-online') return canAccessEcommerceOrders(context.licenseDetails, {
    currentDeviceRole: context.actorSnapshot?.actorType,
    permissions: Object.fromEntries((context.actorSnapshot?.permissions || []).map(permission => [permission, true]))
  });
  if (context && pathname === '/agentes-ia') return getCommercialAIAgentAccessState(context).canSeeEntry;
  if (pathname === '/configuracion') {
    if (typeof context?.settingsAccess?.canAccessSection === 'function') {
      return context.settingsAccess.canAccessSection(tab || 'general');
    }
    return (SETTINGS_SECTION_PERMISSIONS[tab || 'general'] || []).some(canAccess);
  }
  if (pathname === '/productos') {
    if (['add', 'categories', 'ingredients', 'restaurant'].includes(tab)) return canAccess('products');
    if (['batches', 'variants'].includes(tab)) return canAccess('inventory');
  }
  return (routePermissions[pathname] || []).some(canAccess);
};
