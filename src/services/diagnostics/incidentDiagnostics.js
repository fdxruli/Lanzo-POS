const SEVERITIES = Object.freeze({
  RECOVERABLE: 'recoverable',
  SECTION_FAILURE: 'section_failure',
  CRITICAL_BLOCKER: 'critical_blocker'
});

const CATEGORIES = Object.freeze({
  REACT_RENDER: 'react_render',
  NAVIGATION_RESOURCE: 'navigation_resource',
  INDEXEDDB: 'indexeddb',
  PWA: 'pwa',
  AUTHORIZATION_SESSION: 'authorization_session',
  SUPABASE_RPC: 'supabase_rpc',
  SYNCHRONIZATION: 'synchronization',
  FINANCIAL_OPERATION: 'financial_operation',
  CONNECTIVITY: 'connectivity',
  UNKNOWN: 'unknown'
});

export const INCIDENT_SEVERITY = SEVERITIES;
export const INCIDENT_CATEGORY = CATEGORIES;

const VALID_SEVERITIES = new Set(Object.values(SEVERITIES));
const VALID_CATEGORIES = new Set(Object.values(CATEGORIES));
const SAFE_ERROR_NAMES = new Set([
  'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError',
  'URIError', 'EvalError', 'AggregateError', 'QuotaExceededError',
  'InvalidStateError', 'AbortError', 'NetworkError', 'NotAllowedError',
  'SecurityError', 'DataError', 'ConstraintError', 'ActorRuntimeError',
  'TenantRuntimeError', 'ChunkLoadError'
]);

const SAFE_CODE_PREFIXES = Object.freeze([
  'ADMIN_RUNTIME_', 'ACTOR_', 'CHUNK_', 'DB_', 'FINANCIAL_', 'IDB_', 'NETWORK_',
  'PAYMENT_', 'SALE_',
  'PGRST', 'SUPABASE_', 'SYNC_', 'TENANT_DIRECTORY_', 'TENANT_RUNTIME_'
]);

const CATEGORY_COPY = Object.freeze({
  [CATEGORIES.REACT_RENDER]: 'Render de interfaz',
  [CATEGORIES.NAVIGATION_RESOURCE]: 'Navegación o carga de recursos',
  [CATEGORIES.INDEXEDDB]: 'Almacenamiento local',
  [CATEGORIES.PWA]: 'Aplicación instalada',
  [CATEGORIES.AUTHORIZATION_SESSION]: 'Autorización o sesión',
  [CATEGORIES.SUPABASE_RPC]: 'Servicio remoto',
  [CATEGORIES.SYNCHRONIZATION]: 'Sincronización',
  [CATEGORIES.FINANCIAL_OPERATION]: 'Operación financiera',
  [CATEGORIES.CONNECTIVITY]: 'Conectividad',
  [CATEGORIES.UNKNOWN]: 'Error inesperado'
});

const DEFAULT_SEVERITY = Object.freeze({
  [CATEGORIES.REACT_RENDER]: SEVERITIES.SECTION_FAILURE,
  [CATEGORIES.NAVIGATION_RESOURCE]: SEVERITIES.RECOVERABLE,
  [CATEGORIES.INDEXEDDB]: SEVERITIES.SECTION_FAILURE,
  [CATEGORIES.PWA]: SEVERITIES.RECOVERABLE,
  [CATEGORIES.AUTHORIZATION_SESSION]: SEVERITIES.SECTION_FAILURE,
  [CATEGORIES.SUPABASE_RPC]: SEVERITIES.SECTION_FAILURE,
  [CATEGORIES.SYNCHRONIZATION]: SEVERITIES.RECOVERABLE,
  [CATEGORIES.FINANCIAL_OPERATION]: SEVERITIES.SECTION_FAILURE,
  [CATEGORIES.CONNECTIVITY]: SEVERITIES.RECOVERABLE,
  [CATEGORIES.UNKNOWN]: SEVERITIES.SECTION_FAILURE
});

const SAFE_ROUTE_SEGMENTS = new Set([
  'acerca-de', 'agentes-ia', 'caja', 'clientes', 'configuracion', 'dashboard',
  'inicio', 'licencia', 'login', 'mesas', 'pedidos', 'pedidos-online', 'pos',
  'productos', 'renovacion-urgente', 'ventas'
]);

const SAFE_NAVIGATION_ROUTES = new Set([
  '/', '/acerca-de', '/agentes-ia', '/caja', '/clientes', '/configuracion',
  '/pedidos', '/pedidos-online', '/productos', '/portal-online',
  '/renovacion-urgente', '/ventas'
]);

const SAFE_ROUTE_SURFACES = Object.freeze({
  '/acerca-de': 'about',
  '/agentes-ia': 'ai_agents',
  '/caja': 'cash',
  '/clientes': 'customers',
  '/configuracion': 'settings',
  '/pedidos': 'orders',
  '/pedidos-online': 'online_orders',
  '/productos': 'products',
  '/portal-online': 'online_portal',
  '/renovacion-urgente': 'renewal',
  '/ventas': 'sales'
});

const INCIDENT_LOCATION_CATALOG = Object.freeze({
  welcome: Object.freeze({
    area: 'Acceso a Lanzo POS',
    screen: 'Bienvenida y activación de licencia',
    component: 'WelcomeModal',
    file: 'src/components/common/WelcomeModal.jsx'
  }),
  pos: Object.freeze({
    area: 'Punto de Venta',
    screen: 'Operación del POS',
    component: 'No determinado',
    file: 'No determinado'
  }),
  sales: Object.freeze({
    area: 'Ventas',
    screen: 'Panel de Ventas',
    component: 'No determinado',
    file: 'No determinado'
  }),
  cash: Object.freeze({
    area: 'Caja',
    screen: 'Operación de caja',
    component: 'No determinado',
    file: 'No determinado'
  }),
  settings: Object.freeze({
    area: 'Configuración',
    screen: 'Configuración general',
    component: 'No determinado',
    file: 'No determinado'
  }),
  customers: Object.freeze({
    area: 'Clientes',
    screen: 'Gestión de clientes',
    component: 'No determinado',
    file: 'No determinado'
  }),
  orders: Object.freeze({
    area: 'Ventas',
    screen: 'Pedidos',
    component: 'No determinado',
    file: 'No determinado'
  }),
  online_orders: Object.freeze({
    area: 'Comercio en línea',
    screen: 'Pedidos en línea',
    component: 'No determinado',
    file: 'No determinado'
  }),
  products: Object.freeze({
    area: 'Inventario',
    screen: 'Productos',
    component: 'No determinado',
    file: 'No determinado'
  }),
  ai_agents: Object.freeze({
    area: 'Agentes de IA',
    screen: 'Agentes de IA',
    component: 'No determinado',
    file: 'No determinado'
  }),
  online_portal: Object.freeze({
    area: 'Comercio en línea',
    screen: 'Portal en línea',
    component: 'No determinado',
    file: 'No determinado'
  }),
  about: Object.freeze({
    area: 'Aplicación general',
    screen: 'Acerca de Lanzo',
    component: 'No determinado',
    file: 'No determinado'
  }),
  renewal: Object.freeze({
    area: 'Acceso a Lanzo POS',
    screen: 'Renovación de licencia',
    component: 'No determinado',
    file: 'No determinado'
  }),
  application: Object.freeze({
    area: 'Aplicación general',
    screen: 'No determinada',
    component: 'No determinado',
    file: 'No determinado'
  })
});

const SAFE_RECOVERY_SURFACES = new Set([
  ...Object.keys(INCIDENT_LOCATION_CATALOG),
  'section'
]);

const normalizeSafeNavigationRoute = (pathname) => {
  const rawPath = typeof pathname === 'string' ? pathname : '/';
  const pathOnly = rawPath.trim().slice(0, 300).split(/[?#]/, 1)[0] || '/';
  const normalized = pathOnly.replace(/\\+/g, '/').replace(/\/+$/, '').toLowerCase() || '/';
  return SAFE_NAVIGATION_ROUTES.has(normalized) ? normalized : 'No determinada';
};

const normalizeRecoverySurface = (surface) => (
  typeof surface === 'string' && SAFE_RECOVERY_SURFACES.has(surface) ? surface : ''
);

const safeRead = (object, key) => {
  try {
    return object?.[key];
  } catch {
    return undefined;
  }
};

const boundedText = (value, maxLength = 160) => {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
};

const normalizeCategory = (value) => (
  typeof value === 'string' && VALID_CATEGORIES.has(value) ? value : null
);

const normalizeSeverity = (value) => (
  typeof value === 'string' && VALID_SEVERITIES.has(value) ? value : null
);

const errorTextForClassification = (error) => {
  const parts = [];
  for (const field of ['name', 'code', 'message']) {
    const value = safeRead(error, field);
    if (typeof value === 'string') parts.push(value.slice(0, 500));
  }
  return parts.join(' ');
};

const inferCategory = (error, context = {}) => {
  const explicitCategory = normalizeCategory(context.category);
  if (explicitCategory) return explicitCategory;

  const code = boundedText(safeRead(error, 'code'), 120).toUpperCase();
  const text = errorTextForClassification(error);

  if (/^(?:DB_|IDB_|DEXIE_)/.test(code) || /indexeddb|dexie|database is blocked|quotaexceeded/i.test(text)) {
    return CATEGORIES.INDEXEDDB;
  }
  if (/^(?:TENANT_DIRECTORY_)/.test(code)) return CATEGORIES.INDEXEDDB;
  if (/^(?:ACTOR_|TENANT_RUNTIME_|AUTH_|SESSION_)/.test(code) || /session (?:expired|invalid|stale)|authorization|permission denied/i.test(text)) {
    return CATEGORIES.AUTHORIZATION_SESSION;
  }
  if (/^(?:PGRST\d+|SUPABASE_)/.test(code)) return CATEGORIES.SUPABASE_RPC;
  if (/^(?:SYNC_)/.test(code) || /outbox|synchroni[sz](?:ation|ing)|sync queue/i.test(text)) {
    return CATEGORIES.SYNCHRONIZATION;
  }
  if (/^(?:FINANCIAL_|PAYMENT_|SALE_)/.test(code) || /financial operation|payment result|checkout result|cash movement/i.test(text)) {
    return CATEGORIES.FINANCIAL_OPERATION;
  }
  if (/^(?:CHUNK_|ASSET_)/.test(code) || /chunkloaderror|loading chunk|dynamically imported module|preload css|module script/i.test(text)) {
    return CATEGORIES.NAVIGATION_RESOURCE;
  }
  if (/service worker|serviceworker|workbox|cache storage|pwa update/i.test(text)) {
    return CATEGORIES.PWA;
  }
  if (/network|offline|failed to fetch|fetch failed|connection|timeout/i.test(text)) {
    return CATEGORIES.CONNECTIVITY;
  }
  if (context.source === 'react' || context.source === 'react_render') return CATEGORIES.REACT_RENDER;
  return CATEGORIES.UNKNOWN;
};

export const getSafeIncidentCode = (error, category = CATEGORIES.UNKNOWN) => {
  const candidate = boundedText(safeRead(error, 'code'), 80);
  const isAllowedPrefix = SAFE_CODE_PREFIXES.some((prefix) => candidate.startsWith(prefix));
  if (
    isAllowedPrefix
    && /^[A-Z][A-Z0-9_.-]{1,79}$/.test(candidate)
    && !/(?:TOKEN|JWT|LICENSE|PASSWORD|SECRET|FINGERPRINT|DEVICE|CUSTOMER|PHONE|EMAIL)/i.test(candidate)
  ) return candidate;
  return `INCIDENT_${category.toUpperCase()}`;
};

export const getSafeErrorType = (error) => {
  const name = safeRead(error, 'name');
  return typeof name === 'string' && SAFE_ERROR_NAMES.has(name) ? name : 'Error';
};

/**
 * Severity and technical category are intentionally independent. Unknown
 * errors default to a section failure; only an explicitly ambiguous financial
 * result is a critical blocker. Callers must keep the actual payment operation
 * blocked until their canonical idempotency/receipt check resolves it.
 */
export const classifyIncident = (error, context = {}) => {
  const category = inferCategory(error, context);
  const code = boundedText(safeRead(error, 'code'), 80).toUpperCase();
  const financialResultUnknown = category === CATEGORIES.FINANCIAL_OPERATION
    && (
      context.financialOutcome === 'unknown'
      || context.outcomeUnknown === true
      || /^(?:FINANCIAL|PAYMENT|SALE)_(?:OUTCOME|RESULT)_(?:UNKNOWN|PENDING)$/.test(code)
    );
  const severity = financialResultUnknown
    ? SEVERITIES.CRITICAL_BLOCKER
    : normalizeSeverity(context.severity) || DEFAULT_SEVERITY[category];

  return Object.freeze({
    code: getSafeIncidentCode(error, category),
    category,
    categoryLabel: CATEGORY_COPY[category],
    severity,
    errorType: getSafeErrorType(error)
  });
};

const safeRouteLabel = (pathname) => {
  const path = boundedText(pathname, 300).split(/[?#]/, 1)[0];
  const segment = path.split('/').filter(Boolean)[0]?.toLowerCase();
  if (!segment) return 'inicio';
  if (SAFE_ROUTE_SEGMENTS.has(segment)) return `/${segment}`;
  if (segment === 'portal-online') return '/portal-online';
  return 'otra sección';
};

// Export the same route allowlist used by the existing support diagnostic so
// structured reports cannot invent a second, less restrictive route filter.
export const getSafeIncidentRoute = safeRouteLabel;

export const getSafeIncidentNavigationPath = normalizeSafeNavigationRoute;

/**
 * Derive diagnostic labels only from known recovery boundaries and exact
 * registered routes. A root path by itself remains ambiguous.
 */
export const getSafeIncidentLocation = (recoverySurface, pathname) => {
  const navigationPath = normalizeSafeNavigationRoute(pathname);
  const surface = normalizeRecoverySurface(recoverySurface);
  const routeSurface = navigationPath === '/' || navigationPath === 'No determinada'
    ? ''
    : SAFE_ROUTE_SURFACES[navigationPath] || '';

  let resolvedSurface = '';
  if (surface === 'welcome' && navigationPath === '/') resolvedSurface = 'welcome';
  else if (surface === 'pos' && navigationPath === '/') resolvedSurface = 'pos';
  else if (surface === 'application') resolvedSurface = 'application';
  else if (surface && surface !== 'section') {
    const expectedRoute = surface === 'pos' || surface === 'welcome' ? '/' : Object.keys(SAFE_ROUTE_SURFACES)
      .find((route) => SAFE_ROUTE_SURFACES[route] === surface);
    if (expectedRoute === navigationPath) resolvedSurface = surface;
  } else if (routeSurface) {
    resolvedSurface = routeSurface;
  }

  const location = INCIDENT_LOCATION_CATALOG[resolvedSurface] || INCIDENT_LOCATION_CATALOG.application;
  const knownBoundary = surface && (
    surface === 'application'
    || surface === 'section'
    || surface === resolvedSurface
  ) ? surface : '';

  return Object.freeze({
    functionalArea: location.area,
    affectedScreen: location.screen,
    navigationPath,
    supervisedComponent: location.component,
    recoveryBoundary: knownBoundary || 'No determinado',
    associatedFile: location.file,
    exceptionOrigin: 'No determinado'
  });
};

export const getIncidentRecoverySurfaceForPath = (pathname) => {
  const safePath = normalizeSafeNavigationRoute(pathname);
  if (safePath === '/') return 'pos';
  return SAFE_ROUTE_SURFACES[safePath] || 'section';
};

export const buildSafeIncidentAdvancedDetails = (recoverySurface, pathname) => {
  const location = getSafeIncidentLocation(recoverySurface, pathname);
  return [
    'INFORMACIÓN TÉCNICA ADICIONAL',
    'Límite de recuperación: ' + location.recoveryBoundary,
    'Componente supervisado: ' + location.supervisedComponent,
    'Archivo asociado conocido: ' + location.associatedFile,
    'Origen exacto de la excepción: ' + location.exceptionOrigin
  ].join('\n');
};

export const getSafeBrowserLabel = (userAgent) => {
  const ua = boundedText(userAgent, 400);
  const known = [
    ['Edge', /Edg\/(\d+)/],
    ['Opera', /OPR\/(\d+)/],
    ['Firefox', /Firefox\/(\d+)/],
    ['Chrome', /Chrome\/(\d+)/],
    ['Safari', /Version\/(\d+).*Safari/]
  ];
  for (const [label, pattern] of known) {
    const match = ua.match(pattern);
    if (match) return `${label} ${match[1]}`;
  }
  return 'Navegador no identificado';
};

const safeBuildVersion = (value) => {
  const version = boundedText(value, 40);
  return /^\d{1,3}(?:\.\d{1,3}){0,3}(?:[-+][A-Za-z0-9.-]{1,20})?$/.test(version)
    ? version
    : 'No disponible';
};

export const getSafeIncidentAppVersion = safeBuildVersion;

const safeBuildCommit = (value) => {
  const commit = boundedText(value, 40);
  return /^[a-f0-9]{7,40}$/i.test(commit) ? commit : 'No disponible';
};

export const getSafeIncidentBuildCommit = safeBuildCommit;

const toIsoTimestamp = (value) => {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
};

/**
 * Builds a support report from allowlisted fields only. It deliberately never
 * serializes messages, stacks, causes, URLs, application stores, tenant data,
 * device identifiers, IndexedDB content, or financial payloads.
 */
export const buildSafeIncidentReport = (error, context = {}, environment = {}) => {
  const incident = classifyIncident(error, context);
  const browser = environment.userAgent ?? safeRead(globalThis.navigator, 'userAgent');
  const location = environment.pathname ?? safeRead(globalThis.location, 'pathname');
  const safeLocation = getSafeIncidentLocation(context.recoverySurface, location);
  const online = typeof environment.online === 'boolean'
    ? environment.online
    : safeRead(globalThis.navigator, 'onLine') !== false;
  const timestamp = toIsoTimestamp(environment.now);
  const version = safeBuildVersion(environment.appVersion ?? import.meta.env?.VITE_APP_VERSION);
  const buildCommit = safeBuildCommit(environment.buildCommit ?? import.meta.env?.VITE_BUILD_COMMIT);

  return [
    'REPORTE TÉCNICO DE INCIDENCIA - LANZO POS',
    '',
    `Código de incidencia: ${incident.code}`,
    `Clasificación: ${incident.categoryLabel}`,
    `Gravedad: ${incident.severity}`,
    `Tipo técnico: ${incident.errorType}`,
    'Área funcional: ' + safeLocation.functionalArea,
    'Pantalla afectada: ' + safeLocation.affectedScreen,
    'Ruta de navegación: ' + safeLocation.navigationPath,
    'Componente supervisado: ' + safeLocation.supervisedComponent,
    `Versión de Lanzo: ${version}`,
    `Commit: ${buildCommit}`,
    `Navegador: ${getSafeBrowserLabel(browser)}`,
    `Conectividad: ${online ? 'Online' : 'Offline'}`,
    `Fecha y hora: ${timestamp}`,
    '',
    'No incluye mensajes internos, URLs completas, credenciales, identificadores, datos personales, registros locales ni importes.',
    'Si un cobro quedó pendiente, verifica su resultado antes de volver a intentarlo.'
  ].join('\n');
};

/** Conservative summary for the in-app development console. */
export const summarizeDiagnosticEvent = (level, args = [], source = 'console') => {
  const error = args.find((value) => value instanceof Error) || null;
  const incident = classifyIncident(error, { source: source === 'window.error' ? 'react' : undefined });
  const sourceLabel = source === 'console' ? '' : ` ${source}`;
  return `Detalle omitido por privacidad · ${incident.category} · ${incident.code}${sourceLabel}`
    .slice(0, 240);
};

const SAFE_RECOVERY_STATUSES = new Set([
  'detected',
  'preserved',
  'action_required',
  'recovering',
  'verified',
  'failed',
  'blocked'
]);

/**
 * Builds display metadata from the same allowlist used by support reports.
 * The caller may provide a recovery status, but arbitrary strings and raw
 * location/error values are never copied through.
 */
export const getSafeIncidentMetadata = (incident = {}, environment = {}) => {
  const category = normalizeCategory(incident.category) || CATEGORIES.UNKNOWN;
  const online = typeof environment.online === 'boolean'
    ? environment.online
    : safeRead(globalThis.navigator, 'onLine') !== false;
  const recoveryStatus = SAFE_RECOVERY_STATUSES.has(incident.recoveryStatus)
    ? incident.recoveryStatus
    : 'action_required';
  const safeLocation = getSafeIncidentLocation(
    incident.recoverySurface ?? environment.recoverySurface,
    incident.navigationPath ?? environment.pathname ?? safeRead(globalThis.location, 'pathname')
  );

  return Object.freeze({
    code: getSafeIncidentCode({ code: incident.code }, category),
    category,
    categoryLabel: CATEGORY_COPY[category],
    severity: normalizeSeverity(incident.severity) || SEVERITIES.SECTION_FAILURE,
    errorType: SAFE_ERROR_NAMES.has(incident.errorType) ? incident.errorType : 'Error',
    section: environment.section === 'unknown'
      ? 'No determinada'
      : safeRouteLabel(environment.pathname ?? safeRead(globalThis.location, 'pathname')),
    functionalArea: safeLocation.functionalArea,
    affectedScreen: safeLocation.affectedScreen,
    navigationPath: safeLocation.navigationPath,
    supervisedComponent: safeLocation.supervisedComponent,
    recoveryBoundary: safeLocation.recoveryBoundary,
    associatedFile: safeLocation.associatedFile,
    exceptionOrigin: safeLocation.exceptionOrigin,
    timestamp: toIsoTimestamp(environment.now),
    appVersion: safeBuildVersion(environment.appVersion ?? import.meta.env?.VITE_APP_VERSION),
    online,
    recoveryStatus
  });
};
