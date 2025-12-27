// src/services/Logger.js

/**
 * Logger centralizado para controlar la salida en consola según el entorno.
 * En PRODUCCIÓN (import.meta.env.PROD), silencia logs de depuración pero mantiene errores críticos.
 */
const Logger = {
  // --- NIVELES DE LOG (Se ocultan en PROD) ---
  
  log: (...args) => {
    if (!import.meta.env.PROD) {
      console.log(...args);
    }
  },
  
  info: (...args) => {
    if (!import.meta.env.PROD) {
      console.info(...args);
    }
  },

  debug: (...args) => {
    if (!import.meta.env.PROD) {
      console.debug(...args);
    }
  },

  table: (...args) => {
    if (!import.meta.env.PROD) {
      console.table(...args);
    }
  },

  // --- AGRUPACIÓN Y TIEMPO (Se ocultan en PROD) ---

  group: (...args) => {
    if (!import.meta.env.PROD) {
      console.group(...args);
    }
  },

  groupCollapsed: (...args) => {
    if (!import.meta.env.PROD) {
      console.groupCollapsed(...args);
    }
  },

  groupEnd: () => {
    if (!import.meta.env.PROD) {
      console.groupEnd();
    }
  },

  time: (label) => {
    if (!import.meta.env.PROD) {
      console.time(label);
    }
  },

  timeEnd: (label) => {
    if (!import.meta.env.PROD) {
      console.timeEnd(label);
    }
  },

  trace: (...args) => {
    if (!import.meta.env.PROD) {
      console.trace(...args);
    }
  },

  // --- CRÍTICOS (Siempre visibles, incluso en PROD) ---
  // Estos son vitales para que el usuario pueda reportar errores o para herramientas de monitoreo.

  warn: (...args) => {
    console.warn(...args);
  },

  error: (...args) => {
    console.error(...args);
    // 💡 TIP PRO: Aquí es donde en el futuro podrías agregar:
    // Sentry.captureException(args); 
    // Para recibir los errores en tu email automáticamente.
  },
};

export default Logger;