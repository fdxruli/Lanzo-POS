export const ADMIN_ROUTE_PATHS = Object.freeze({
  urgentRenewal: '/renovacion-urgente',
  cashRegister: 'caja',
  orders: 'pedidos',
  onlineOrders: 'pedidos-online',
  products: 'productos',
  customers: 'clientes',
  sales: 'ventas',
  aiAgents: 'agentes-ia',
  onlinePortal: 'portal-online',
  settings: 'configuracion',
  about: 'acerca-de',
});

const absoluteRoutePaths = Object.values(ADMIN_ROUTE_PATHS).map((path) => (
  path.startsWith('/') ? path : `/${path}`
));

export const ADMIN_VALID_ROUTE_PATHS = Object.freeze([
  '/',
  ...absoluteRoutePaths,
]);

const normalizePathname = (pathname) => {
  const rawPath = typeof pathname === 'string' ? pathname : '/';
  let decodedPath = rawPath.split(/[?#]/, 1)[0] || '/';

  try {
    decodedPath = decodeURIComponent(decodedPath);
  } catch {
    // An invalid percent escape cannot match any registered static route.
  }

  return decodedPath.replace(/\/+$/, '').toLowerCase() || '/';
};

const normalizedValidPaths = new Set(ADMIN_VALID_ROUTE_PATHS.map(normalizePathname));

export const isAdminNotFoundPath = (pathname) => (
  !normalizedValidPaths.has(normalizePathname(pathname))
);
