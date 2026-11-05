// Closed vocabulary shared by emitters and the visual projection. Never add
// identifiers, free text, RPC arguments, or application records here.
export const CONSOLE_OPERATION_CATALOG = Object.freeze({
  'db.operation': { module: 'Almacenamiento', operation: 'Operación local' },
  'db.open': { module: 'Almacenamiento', operation: 'Abrir base local' },
  'inventory.update': { module: 'Inventario', operation: 'Actualizar producto' },
  'sync.pull': { module: 'Sincronización', operation: 'Pull incremental' },
  'sync.outbox': { module: 'Sincronización', operation: 'Enviar pendientes' },
  'sync.realtime': { module: 'Realtime', operation: 'Suscripción POS' },
  'sync.status': { module: 'Sincronización', operation: 'Estado del servicio' },
  'pos.checkout': { module: 'Ventas', operation: 'Actualizar UI tras cobro' },
  'pos.search': { module: 'Ventas', operation: 'Buscar productos' },
  'cash.resolve': { module: 'Caja', operation: 'Resolver caja' },
  'auth.validate': { module: 'Sesión', operation: 'Validar autorización' }
});

export const CONSOLE_STATE_LABELS = Object.freeze({
  online: 'Conectado', offline: 'Sin conexión', degraded: 'Degradado',
  disabled: 'Deshabilitado', connecting: 'Conectando',
  SUBSCRIBED: 'Suscrito', CHANNEL_ERROR: 'Fallo del canal',
  TIMED_OUT: 'Espera del canal agotada', CLOSED: 'Canal cerrado'
});

// Does not read getters or walk prototypes of application payloads.
export const readConsoleField = (value, key) => {
  try { return Object.getOwnPropertyDescriptor(value, key)?.value; } catch { return undefined; }
};

export const getConsoleOperation = value => {
  const key = readConsoleField(value, 'diagnosticOperation');
  return typeof key === 'string' && Object.hasOwn(CONSOLE_OPERATION_CATALOG, key) ? key : null;
};
