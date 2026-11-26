/**
 * agentActionRouter
 *
 * Ejecuta acciones guiadas del agente dentro del POS de forma segura.
 * No borra, no edita y no guarda datos. Solo valida, prepara guía y navega
 * a rutas permitidas usando react-router.
 */

export const AGENT_ACTION_TYPES = {
  NAVIGATE: 'navigate',
  REVIEW: 'review',
  DRAFT: 'draft',
  CHECKLIST: 'checklist',
  MANUAL: 'manual'
};

const SAFE_ROUTES = {
  '/': {
    label: 'Punto de venta',
    permission: 'pos',
    aliases: ['pos', 'venta', 'vender', 'cobrar']
  },
  '/caja': {
    label: 'Caja',
    permission: 'cash_register',
    aliases: ['caja', 'corte', 'apertura', 'cierre']
  },
  '/pedidos': {
    label: 'Pedidos',
    permission: 'orders',
    aliases: ['pedido', 'pedidos', 'ordenes', 'órdenes']
  },
  '/productos': {
    label: 'Productos',
    permission: ['products', 'inventory'],
    aliases: ['producto', 'productos', 'inventario', 'stock', 'catalogo', 'catálogo']
  },
  '/productos?tab=list': {
    label: 'Lista de productos',
    permission: ['products', 'inventory'],
    aliases: ['lista de productos', 'bajo margen', 'agotado', 'agotados', 'stock bajo', 'precio', 'costo']
  },
  '/productos?tab=add': {
    label: 'Agregar producto',
    permission: 'products',
    aliases: ['agregar producto', 'crear producto', 'nuevo producto']
  },
  '/productos?tab=ingredients': {
    label: 'Ingredientes',
    permission: 'products',
    aliases: ['ingrediente', 'ingredientes', 'insumo', 'insumos', 'receta']
  },
  '/productos?tab=batches': {
    label: 'Lotes',
    permission: 'inventory',
    aliases: ['lote', 'lotes', 'caducidad producto', 'fifo']
  },
  '/productos?tab=categories': {
    label: 'Categorías',
    permission: 'products',
    aliases: ['categoria', 'categoría', 'categorias', 'categorías']
  },
  '/clientes?tab=list': {
    label: 'Lista de clientes',
    permission: 'customers',
    aliases: ['cliente', 'clientes', 'deudor', 'deudores', 'credito', 'crédito', 'cobranza', 'fidelizacion', 'fidelización']
  },
  '/clientes?tab=add': {
    label: 'Agregar cliente',
    permission: 'customers',
    aliases: ['agregar cliente', 'registrar cliente', 'nuevo cliente']
  },
  '/ventas': {
    label: 'Reportes',
    permission: 'reports',
    aliases: ['reporte', 'reportes', 'ventas', 'estadisticas', 'estadísticas']
  },
  '/ventas?tab=restock': {
    label: 'Reabastecimiento',
    permission: 'reports',
    aliases: ['reabastecimiento', 'reponer', 'reposicion', 'reposición', 'stock minimo', 'stock mínimo']
  },
  '/ventas?tab=waste': {
    label: 'Mermas',
    permission: 'reports',
    aliases: ['merma', 'mermas', 'desperdicio', 'perdida', 'pérdida']
  },
  '/ventas?tab=history': {
    label: 'Historial y papelera',
    permission: 'reports',
    aliases: ['historial', 'papelera', 'ventas canceladas', 'canceladas']
  },
  '/ventas?tab=expiration': {
    label: 'Caducidad',
    permission: 'reports',
    aliases: ['caducidad', 'caducidades', 'vencimiento', 'vencimientos']
  },
  '/ventas?tab=tips': {
    label: 'Consejos Lan',
    permission: 'reports',
    aliases: ['consejo', 'consejos', 'tips', 'recomendaciones']
  },
  '/configuracion': {
    label: 'Configuración',
    permission: 'settings',
    aliases: ['configuracion', 'configuración', 'ajustes', 'licencia', 'dispositivos', 'staff', 'permisos']
  }
};

const normalizeText = (value = '') => String(value)
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim();

const stripOrigin = (route = '') => {
  const value = String(route || '').trim();
  if (!value) return '';

  try {
    if (value.startsWith('http://') || value.startsWith('https://')) {
      const url = new URL(value);
      return `${url.pathname}${url.search}`;
    }
  } catch {
    return '';
  }

  return value.startsWith('/') ? value : `/${value}`;
};

const removeHash = (route = '') => route.split('#')[0];

export const getAllowedAgentRoutes = () => Object.entries(SAFE_ROUTES).map(([route, config]) => ({
  route,
  label: config.label,
  permission: config.permission
}));

const normalizeRoute = (route = '') => {
  const cleanRoute = removeHash(stripOrigin(route));
  if (!cleanRoute) return '';

  if (SAFE_ROUTES[cleanRoute]) return cleanRoute;

  const [pathname, rawSearch = ''] = cleanRoute.split('?');
  if (SAFE_ROUTES[pathname] && !rawSearch) return pathname;

  const params = new URLSearchParams(rawSearch);
  const tab = params.get('tab');
  const candidate = tab ? `${pathname}?tab=${tab}` : pathname;

  if (SAFE_ROUTES[candidate]) return candidate;
  if (SAFE_ROUTES[pathname]) return pathname;

  return '';
};

const inferRouteFromAction = (action = {}) => {
  const joined = normalizeText([
    action.label,
    action.description,
    action.reason,
    action.expectedImpact,
    action.route
  ].filter(Boolean).join(' '));

  const ranked = Object.entries(SAFE_ROUTES)
    .map(([route, config]) => {
      const score = config.aliases.reduce((total, alias) => (
        joined.includes(normalizeText(alias)) ? total + 1 : total
      ), 0);
      return { route, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.route.length - a.route.length);

  return ranked[0]?.route || '';
};

const buildChecklistSteps = (action = {}, routeConfig = null) => {
  const type = action.type || AGENT_ACTION_TYPES.MANUAL;
  const steps = [];

  if (routeConfig) {
    steps.push(`Abrir el módulo: ${routeConfig.label}.`);
  }

  if (action.reason) {
    steps.push(`Revisar la razón: ${action.reason}`);
  }

  if (action.description) {
    steps.push(action.description);
  }

  if (action.expectedImpact) {
    steps.push(`Validar impacto esperado: ${action.expectedImpact}`);
  }

  if (type === AGENT_ACTION_TYPES.DRAFT) {
    steps.push('Usar el texto sugerido como borrador, revisarlo y ajustarlo antes de enviarlo al cliente.');
  }

  if (type === AGENT_ACTION_TYPES.CHECKLIST) {
    steps.push('Marcar mentalmente cada paso antes de cerrar la recomendación como atendida.');
  }

  if (steps.length === 0) {
    steps.push('Revisar la recomendación del agente y ejecutarla manualmente si tiene sentido para la operación.');
  }

  return steps.slice(0, 6);
};

export const resolveAgentAction = (action = {}) => {
  const actionType = Object.values(AGENT_ACTION_TYPES).includes(action.type)
    ? action.type
    : AGENT_ACTION_TYPES.MANUAL;

  const explicitRoute = normalizeRoute(action.route);
  const inferredRoute = explicitRoute || inferRouteFromAction(action);
  const routeConfig = inferredRoute ? SAFE_ROUTES[inferredRoute] : null;
  const canNavigate = Boolean(routeConfig) && [AGENT_ACTION_TYPES.NAVIGATE, AGENT_ACTION_TYPES.REVIEW].includes(actionType);

  const requiresConfirmation = Boolean(action.confirmationRequired)
    || canNavigate
    || action.priority === 'high'
    || action.severity === 'danger';

  return {
    id: action.id || `guided-action-${Date.now()}`,
    label: action.label || 'Acción guiada',
    description: action.description || '',
    type: actionType,
    priority: action.priority || 'medium',
    reason: action.reason || '',
    expectedImpact: action.expectedImpact || '',
    confirmationRequired: requiresConfirmation,
    route: inferredRoute,
    routeLabel: routeConfig?.label || '',
    permission: routeConfig?.permission || '',
    canNavigate,
    isRouteAllowed: Boolean(routeConfig) || !action.route,
    status: routeConfig || !action.route ? 'ready' : 'blocked_route',
    steps: buildChecklistSteps(action, routeConfig),
    originalAction: action
  };
};

const RECORD_REVIEW_ROUTES = Object.freeze({
  product: '/productos?tab=list',
  batches: '/productos?tab=batches'
});

const hasControlCharacter = (value) => {
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
};

const isSafeRecordId = (value) => (
  (typeof value === 'string' || typeof value === 'number')
  && String(value).trim().length > 0
  && String(value).trim().length <= 180
  && !hasControlCharacter(value)
);

/**
 * Resolve record reviews only through LANZO-owned routes. The record id is
 * carried in router state (never interpolated into a path or accepted from an
 * AI-provided route).
 */
export const resolveAgentRecordReviewAction = ({ kind = 'product', recordId } = {}) => {
  const route = RECORD_REVIEW_ROUTES[kind];
  const referenceValid = isSafeRecordId(recordId);
  if (!route || !referenceValid) {
    return {
      id: `record-review-${kind}`,
      label: kind === 'batches' ? 'Consultar lotes' : 'Revisar producto',
      type: AGENT_ACTION_TYPES.REVIEW,
      route: '',
      routeLabel: '',
      permission: '',
      canNavigate: false,
      isRouteAllowed: false,
      confirmationRequired: false,
      status: 'blocked_reference',
      recordReference: null,
      steps: []
    };
  }

  const resolved = resolveAgentAction({
    type: AGENT_ACTION_TYPES.REVIEW,
    label: kind === 'batches' ? 'Consultar lotes' : 'Revisar producto',
    route
  });
  return {
    ...resolved,
    confirmationRequired: false,
    recordReference: { kind, id: String(recordId).trim() }
  };
};

export const executeAgentAction = (resolvedAction, navigate, navigationOptions) => {
  if (!resolvedAction) {
    return { success: false, message: 'Acción no disponible.' };
  }

  if (resolvedAction.status === 'blocked_route') {
    return {
      success: false,
      message: 'La ruta sugerida no está permitida para acciones guiadas.'
    };
  }

  if (resolvedAction.status === 'blocked_reference') {
    return {
      success: false,
      message: 'El registro relacionado no tiene una referencia válida.'
    };
  }

  if (resolvedAction.canNavigate && resolvedAction.route) {
    navigate(resolvedAction.route, navigationOptions);
    return {
      success: true,
      message: `Navegando a ${resolvedAction.routeLabel || resolvedAction.route}.`
    };
  }

  return {
    success: true,
    message: 'Acción marcada como guía manual. No requiere navegación.'
  };
};

export default {
  AGENT_ACTION_TYPES,
  getAllowedAgentRoutes,
  resolveAgentAction,
  resolveAgentRecordReviewAction,
  executeAgentAction
};
