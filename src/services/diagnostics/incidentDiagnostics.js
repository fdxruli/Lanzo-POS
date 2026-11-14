import { CONSOLE_OPERATION_CATALOG, CONSOLE_STATE_LABELS, getConsoleOperation, readConsoleField } from './consoleOperations';

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
  'TenantRuntimeError', 'ChunkLoadError', 'DatabaseError', 'DatabaseClosedError',
  'DatabaseOpenTimeoutError', 'OpenFailedError', 'VersionError',
  'TransactionInactiveError', 'ReadOnlyError', 'TimeoutError'
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

// Console output has a closed code vocabulary: a prefix alone is not enough
// to make an arbitrary suffix (possibly a credential or identifier) safe.
const CONSOLE_CODE_GROUPS = {
  [CATEGORIES.INDEXEDDB]: [
    'DB_OPEN_TIMEOUT', 'DB_BLOCKED', 'DB_PRIMARY_KEY_MISMATCH',
    'DB_CLOSED_AFTER_STRUCTURAL_ERROR', 'DB_UNSUPPORTED_NATIVE_VERSION',
    'DB_NOT_INSPECTABLE', 'DB_MIGRATION_ID_COLLISION', 'DB_MIGRATION_FAILED',
    'DB_BROWSER_STORAGE_UNAVAILABLE', 'DB_UNAVAILABLE', 'FREE_LICENSE_LOCAL_SAVE_FAILED',
    'DB_QUOTA_EXCEEDED', 'DB_VERSION_ERROR', 'DB_CONSTRAINT_VIOLATION',
    'DB_TRANSACTION_INACTIVE', 'DB_TIMEOUT', 'DB_OPERATION_FAILED'
  ],
  [CATEGORIES.CONNECTIVITY]: [
    'NETWORK_REQUEST_FAILED', 'NETWORK_TIMEOUT', 'NETWORK_ERROR', 'ERR_NETWORK',
    'FETCH_ERROR', 'FAILED_TO_FETCH', 'OFFLINE', 'OFFLINE_PRECHECK',
    'FREE_LICENSE_TRANSPORT_ERROR'
  ],
  [CATEGORIES.AUTHORIZATION_SESSION]: [
    'ACTOR_CONTEXT_STALE', 'ACTOR_SESSION_REQUIRED', 'AUTH_DENIED',
    'SESSION_EXPIRED', 'LICENSE_NOT_FOUND', 'LICENSE_NOT_ACTIVE',
    'FREE_LICENSE_DEVICE_REGISTERED', 'session_not_found', 'session_expired', 'refresh_token_not_found'
  ],
  [CATEGORIES.SUPABASE_RPC]: [
    '23505', '23503', '22P02', '57014', 'SUPABASE_TEMPORARY', 'SUPABASE_SERVER',
    'FREE_LICENSE_CONFIGURATION_ERROR', 'FREE_LICENSE_HTTP_ERROR',
    'FREE_LICENSE_INVALID_RESPONSE', 'LICENSE_ACTIVATION_RATE_LIMITED'
  ],
  [CATEGORIES.SYNCHRONIZATION]: [
    'SYNC_REQUEST_FAILED', 'LOCAL_TENANT_SYNC_BLOCKED', 'CLOUD_CLIENT_UPDATE_REQUIRED'
  ],
  [CATEGORIES.FINANCIAL_OPERATION]: [
    'FINANCIAL_RESULT_UNKNOWN', 'FINANCIAL_RESULT_PENDING',
    'PAYMENT_OUTCOME_UNKNOWN', 'SALE_OUTCOME_UNKNOWN'
  ],
  [CATEGORIES.NAVIGATION_RESOURCE]: ['CHUNK_LOAD_FAILED'],
  [CATEGORIES.UNKNOWN]: ['FREE_LICENSE_UNCONFIRMED']
};
const CONSOLE_CODE_CATEGORIES = new Map(Object.entries(CONSOLE_CODE_GROUPS)
  .flatMap(([category, codes]) => codes.map((code) => [code, category])));
// Meanings of exact technical codes, not guesses about the root cause.
// PostgREST meanings: Supabase Data API error-code reference.
const CONSOLE_CODE_EXPLANATIONS = new Map([
  ['PGRST003', 'Se agotó la espera por una conexión del pool de PostgREST.'],
  ['PGRST202', 'La función o su firma no está disponible en la caché del servicio.'],
  ['PGRST301', 'El servicio rechazó la credencial de autorización.'],
  ['PGRST303', 'El servicio no pudo validar la autorización recibida.'],
  ['57014', 'La consulta fue cancelada. El código no confirma por sí solo un timeout.'],
  ['23505', 'La escritura incumple una restricción de unicidad.'],
  ['23503', 'La escritura incumple una restricción de referencia.'],
  ['42501', 'El servicio rechazó la operación por permisos insuficientes.'],
  ['DB_OPEN_TIMEOUT', 'La apertura de la base local excedió el tiempo permitido.'],
  ['DB_BLOCKED', 'La apertura o actualización de la base local está bloqueada.'],
  ['DB_QUOTA_EXCEEDED', 'El navegador rechazó la escritura por cuota de almacenamiento.'],
  ['DB_VERSION_ERROR', 'La versión de la base local no es compatible con la apertura solicitada.'],
  ['DB_CONSTRAINT_VIOLATION', 'El almacenamiento local rechazó una restricción de datos.'],
  ['DB_TRANSACTION_INACTIVE', 'La transacción local ya no estaba activa.'],
  ['DB_TIMEOUT', 'La operación local excedió el tiempo permitido.'],
  ['DB_OPERATION_FAILED', 'Falló una operación local; no hay evidencia suficiente para identificar la causa.']
]);
const CONSOLE_FALLBACK_CODES = new Set(Object.values(CATEGORIES).map((category) => `INCIDENT_${category.toUpperCase()}`));
const consoleCodeCategory = (code) => (
  ['PGRST301', 'PGRST302', 'PGRST303'].includes(code) ? CATEGORIES.AUTHORIZATION_SESSION
    : typeof code === 'string' && /^PGRST\d{3}$/.test(code)
    ? CATEGORIES.SUPABASE_RPC
    : code === '42501' ? CATEGORIES.AUTHORIZATION_SESSION : CONSOLE_CODE_CATEGORIES.get(code)
);

// Exact existing Logger labels, never substring matching or arbitrary context.
const CONSOLE_OPERATIONS = new Map([
  ['Error al crear licencia Lanzo Local:', 'Módulo: Licencias · Operación: Crear licencia FREE'],
  ['Error crítico al validar licencia:', 'Módulo: Licencias · Operación: Validar licencia'],
  ['Error revisando licencia:', 'Módulo: Licencias · Operación: Revisar licencia'],
  ['Error leyendo licencia local:', 'Módulo: Licencias · Operación: Leer licencia local'],
  ['[PosSync] Pull incremental fallo:', 'Módulo: Sincronización · Operación: Pull incremental'],
  ['[PosSync] Outbox al reconectar fallo:', 'Módulo: Sincronización · Operación: Enviar pendientes al reconectar'],
  ['[PosSync] Pull por realtime fallo:', 'Módulo: Sincronización · Operación: Pull por Realtime'],
  ['[PosSync] Pull al reconectar fallo:', 'Módulo: Sincronización · Operación: Pull al reconectar'],
  ['[PosSync] Pull incremental programado fallo:', 'Módulo: Sincronización · Operación: Pull programado'],
  ['[PosSync] Pull tras recuperar realtime fallo:', 'Módulo: Sincronización · Operación: Pull tras recuperar Realtime'],
  ['[PosRealtime] Error de canal POS:', 'Módulo: Realtime · Operación: Suscripción POS'],
  ['[updateProductSafe] Error:', 'Módulo: Inventario · Operación: Actualizar producto'],
  ['Error crítico en UI:', 'Módulo: Ventas · Operación: Actualizar UI tras cobro'],
  ['Error buscando en POS:', 'Módulo: Ventas · Operación: Buscar productos']
]);
const CONSOLE_MODULES = new Map([
  ['licencia', 'Licencias'], ['configuracion', 'Configuración'], ['productos', 'Inventario'],
  ['ventas', 'Ventas'], ['caja', 'Caja'], ['clientes', 'Clientes'], ['pedidos', 'Pedidos']
]);
const CONSOLE_OUTCOMES = new Map([
  ['unknown', 'No confirmado'], ['created', 'Creación confirmada; guardado local fallido']
]);

// Do not invoke getters, coerce objects, traverse payloads, causes or stacks.
const consoleField = readConsoleField;
const consoleMessageCode = (message) => {
  if (typeof message !== 'string') return undefined;
  if (/^(?:TypeError: )?(?:Failed to fetch|fetch failed|NetworkError when attempting to fetch resource\.|Load failed)$/.test(message)) {
    return 'NETWORK_REQUEST_FAILED';
  }
  if (message === 'The operation timed out.' || message === 'connection timeout') return 'NETWORK_TIMEOUT';
  return undefined;
};


const ORIGINAL_LIMIT = Object.freeze({
  name: 120, code: 120, message: 2400, stack: 12000,
  details: 2400, hint: 1600, filename: 600
});
const originalText = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';

// Read own data or built-in native accessors only; never a supplied getter,
// toJSON, toString, cause, arbitrary application payload or store.
const nativeErrorField = (value, key, native, domException) => {
  const direct = consoleField(value, key);
  if (direct !== undefined) return direct;
  if (domException) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(DOMException.prototype, key);
      if (descriptor?.get) return descriptor.get.call(value);
    } catch { return undefined; }
  }
  if (!native) return undefined;
  try {
    let prototype = Object.getPrototypeOf(value);
    for (let depth = 0; prototype && prototype !== Object.prototype && depth < 8; depth++) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
      if (descriptor) return Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
      prototype = Object.getPrototypeOf(prototype);
    }
  } catch { /* Restricted native host prototypes. */ }
  return undefined;
};

const originalTechnicalError = (value, native, domException, postgrest, name, message) => {
  if (!native && !postgrest) return null;
  const read = key => nativeErrorField(value, key, native, domException);
  const code = read('code');
  const status = postgrest ? consoleField(value, 'status') : undefined;
  return Object.freeze({
    name: originalText(name, ORIGINAL_LIMIT.name) || (postgrest ? 'PostgREST' : 'Error'),
    code: originalText(code, ORIGINAL_LIMIT.code)
      || (typeof code === 'number' && Number.isFinite(code) ? String(code) : ''),
    message: originalText(message, ORIGINAL_LIMIT.message),
    stack: native ? originalText(read('stack'), ORIGINAL_LIMIT.stack) : '',
    details: postgrest ? originalText(consoleField(value, 'details'), ORIGINAL_LIMIT.details) : '',
    hint: postgrest ? originalText(consoleField(value, 'hint'), ORIGINAL_LIMIT.hint) : '',
    status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null
  });
};

const safeGlobalLocation = (location = {}) => ({
  // Browser URLs may carry access tokens in search/fragment strings.
  filename: typeof location.filename === 'string'
    ? originalText(location.filename.split(/[?#]/, 1)[0], ORIGINAL_LIMIT.filename) : '',
  line: Number.isSafeInteger(location.line) && location.line > 0 ? location.line : null,
  column: Number.isSafeInteger(location.column) && location.column > 0 ? location.column : null
});

const normalizeConsoleError = (value) => {
  if (typeof value === 'string') {
    const code = consoleCodeCategory(value) ? value : consoleMessageCode(value);
    return code ? normalizeConsoleError({ code }) : null;
  }
  if (!value || typeof value !== 'object') return null;
  const category = normalizeCategory(consoleField(value, 'category'));
  const severity = normalizeSeverity(consoleField(value, 'severity'));
  const code = consoleField(value, 'code') ?? consoleField(value, 'safeCode') ?? consoleField(value, 'safe_code');
  const normalized = category && severity && (consoleCodeCategory(code) || CONSOLE_FALLBACK_CODES.has(code));
  const ownMessage = consoleField(value, 'message');
  const ownCode = consoleField(value, 'code');
  // Only recognized PostgREST response shapes expose these fields.
  const postgrest = typeof ownMessage === 'string' && typeof ownCode === 'string'
    && (/^(?:[A-Z0-9]{5}|PGRST\d{3})$/i.test(ownCode)
      || (ownCode === '' && Boolean(consoleMessageCode(ownMessage))))
    && ['details', 'hint'].every((key) => {
      const field = consoleField(value, key);
      return field === null || typeof field === 'string';
    });
  let native = false;
  let domException = false;
  try {
    native = value instanceof Error;
    domException = typeof DOMException !== 'undefined' && value instanceof DOMException;
    native = native || domException;
  } catch { /* A hostile proxy cannot interrupt the console. */ }
  const name = native
    ? nativeErrorField(value, 'name', native, domException)
    : consoleField(value, 'name') ?? (normalized ? consoleField(value, 'errorType') : undefined);
  const message = native ? nativeErrorField(value, 'message', native, domException) : ownMessage;
  const knownCode = consoleCodeCategory(code);
  if (!native && !postgrest && !normalized && !knownCode) return null;
  const safeCode = knownCode || normalized ? code : consoleMessageCode(message);
  const storage = ['QuotaExceededError', 'DatabaseClosedError', 'DatabaseOpenTimeoutError',
    'OpenFailedError', 'VersionError', 'TransactionInactiveError', 'ReadOnlyError',
    'ConstraintError', 'DataError'].includes(name);
  const status = consoleField(value, 'status');
  const nativeCategory = native ? classifyIncident({ name, message }).category : CATEGORIES.UNKNOWN;
  return {
    code: safeCode,
    name: SAFE_ERROR_NAMES.has(name) ? name : 'Error',
    technical: originalTechnicalError(value, native, domException, postgrest, name, message),
    category: consoleCodeCategory(safeCode) || (normalized ? category : undefined)
      || (storage ? CATEGORIES.INDEXEDDB : undefined)
      || (name === 'NetworkError' || name === 'TimeoutError' ? CATEGORIES.CONNECTIVITY : undefined)
      || (nativeCategory !== CATEGORIES.UNKNOWN ? nativeCategory : undefined)
      || (postgrest ? ([401, 403].includes(status) ? CATEGORIES.AUTHORIZATION_SESSION : CATEGORIES.SUPABASE_RPC) : undefined),
    severity: normalized ? severity : undefined,
    module: normalized && consoleField(value, 'schema_version') === 1
      ? CONSOLE_MODULES.get(consoleField(value, 'module')) : undefined,
    outcome: ['FREE_LICENSE_UNCONFIRMED', 'FREE_LICENSE_TRANSPORT_ERROR', 'FREE_LICENSE_INVALID_RESPONSE'].includes(safeCode)
      ? CONSOLE_OUTCOMES.get('unknown')
      : safeCode === 'FREE_LICENSE_LOCAL_SAVE_FAILED' ? CONSOLE_OUTCOMES.get('created') : undefined
  };
};

/** Restricted summaries and locally inspectable technical fields remain separate. */
export const projectDiagnosticEvent = (level, args = [], source = 'console', globalLocation = null) => {
  const values = args.slice(0, 30);
  const candidates = values.map(normalizeConsoleError).filter(Boolean);
  const error = candidates.find((candidate) => candidate.code || candidate.category) || candidates[0];
  const incident = classifyIncident(error, { category: error?.category, severity: error?.severity });
  const operationKey = values.map(getConsoleOperation).find(Boolean);
  const operation = operationKey ? CONSOLE_OPERATION_CATALOG[operationKey] : null;
  const legacyContext = values.filter(value => typeof value === 'string')
    .map(value => CONSOLE_OPERATIONS.get(value)).find(Boolean);
  const context = operation ? `Módulo: ${operation.module} · Operación: ${operation.operation}`
    : legacyContext || (error?.module ? `Módulo: ${error.module}` : '');
  const stateValue = operationKey ? values.find(value => getConsoleOperation(value) === operationKey) : null;
  const stateKey = consoleField(stateValue, 'diagnosticState');
  const state = typeof stateKey === 'string' && Object.hasOwn(CONSOLE_STATE_LABELS, stateKey)
    ? CONSOLE_STATE_LABELS[stateKey] : '';
  const isIncident = Boolean(error) || level === 'error' || source !== 'console';
  const code = isIncident ? error?.code || incident.code
    : level === 'warn' ? 'CONSOLE_WARNING_UNCLASSIFIED'
      : operation ? 'CONSOLE_OPERATION_EVENT' : 'CONSOLE_EVENT_UNCLASSIFIED';
  const detail = code === 'NETWORK_REQUEST_FAILED' ? 'Solicitud al servicio no confirmada'
    : code === 'NETWORK_TIMEOUT' ? 'Tiempo de espera agotado'
      : incident.category === CATEGORIES.UNKNOWN ? (isIncident ? 'Causa no identificada' : operation ? 'Evento operativo' : 'Evento sin diagnóstico técnico')
        : 'Diagnóstico técnico';
  const categoryLabel = isIncident ? incident.categoryLabel
    : level === 'warn' ? 'Advertencia sin clasificar' : 'Evento del sistema';
  // Unknown and category-only events must NEVER be merged on a fallback code.
  // A known code plus a known operation identifies equivalent technical events,
  // not proof that separate business incidents have the same underlying cause.
  const original = error?.technical || null;
  const sourceMessage = (source === 'window.error' || source === 'unhandledrejection')
    && typeof values[0] === 'string' ? originalText(values[0], ORIGINAL_LIMIT.message) : '';
  const location = source === 'window.error' && globalLocation
    ? safeGlobalLocation(globalLocation) : null;
  const technical = original || sourceMessage || location?.filename || location?.line
    || location?.column || globalLocation?.resourceError ? Object.freeze({
      name: original?.name || (globalLocation?.resourceError ? 'ResourceError' : 'Error'),
      code: original?.code || '',
      message: original?.message || sourceMessage,
      stack: original?.stack || '',
      details: original?.details || '',
      hint: original?.hint || '',
      status: original?.status ?? null,
      filename: location?.filename || '',
      line: location?.line ?? null,
      column: location?.column ?? null,
      resourceError: globalLocation?.resourceError === true
    }) : null;
  const groupable = Boolean(error?.code && error.code !== 'DB_OPERATION_FAILED' && incident.category !== CATEGORIES.UNKNOWN
    && incident.category !== CATEGORIES.FINANCIAL_OPERATION
    && consoleCodeCategory(error.code) && context);
  return Object.freeze({
    category: isIncident ? incident.category : 'unclassified',
    code,
    severity: isIncident ? incident.severity : 'unspecified',
    errorType: isIncident ? incident.errorType : null,
    operation: operationKey || '',
    state,
    evidence: CONSOLE_CODE_EXPLANATIONS.get(code) || '',
    technical,
    groupable,
    text: [
      isIncident ? `${categoryLabel} · ${detail} · ${code} · ${incident.errorType}`
        : `${categoryLabel} · ${detail} · ${code}`,
      context,
      state ? `Estado: ${state}` : '',
      error?.outcome ? `Resultado: ${error.outcome}` : ''
    ].filter(Boolean).join('\n')
  });
};

export const summarizeDiagnosticEvent = (level, args = [], source = 'console') => (
  projectDiagnosticEvent(level, args, source).text
);

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
