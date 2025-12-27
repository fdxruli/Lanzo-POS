// src/services/logger.js

/**
 * Logger centralizado para controlar la salida en consola según el entorno.
 * En PRODUCCIÓN (import.meta.env.PROD), silencia los logs de depuración.
 */
const Logger = {
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

  // Warn y Error siempre se muestran, son críticos para telemetría o depuración en vivo
  warn: (...args) => {
    console.warn(...args);
  },

  error: (...args) => {
    console.error(...args);
  },

  /**
   * Muestra una tabla solo en desarrollo
   */
  table: (...args) => {
    if (!import.meta.env.PROD) {
      console.table(...args);
    }
  }
};

export default Logger;