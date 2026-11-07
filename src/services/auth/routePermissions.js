// Products intentionally allows either catalog management OR inventory access.
export const ROUTE_PERMISSIONS = Object.freeze({
  '/': 'pos',
  '/caja': 'cash_register',
  '/pedidos': 'orders',
  '/productos': Object.freeze(['products', 'inventory']),
  '/clientes': 'customers'
});

// Use the same contracts as the route guards. Never return the blocked URL.
export const getAccessDeniedDestination = (access, pathname = '') => {
  const labels = {
    '/': 'Ir al punto de venta',
    '/productos': 'Ir a Productos',
    '/caja': 'Ir a Caja',
    '/clientes': 'Ir a Clientes',
    '/pedidos': 'Ir a Pedidos'
  };
  for (const to of ['/', '/productos', '/caja', '/clientes', '/pedidos']) {
    const required = ROUTE_PERMISSIONS[to];
    if (to !== pathname && [required].flat().some(access.canAccessPermission)) {
      return { to, label: labels[to] };
    }
  }
  return null;
};
