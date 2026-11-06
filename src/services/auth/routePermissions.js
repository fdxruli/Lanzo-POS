// Products intentionally allows either catalog management OR inventory access.
export const ROUTE_PERMISSIONS = Object.freeze({
  '/': 'pos',
  '/caja': 'cash_register',
  '/pedidos': 'orders',
  '/productos': Object.freeze(['products', 'inventory']),
  '/clientes': 'customers'
});
