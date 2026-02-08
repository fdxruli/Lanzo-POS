/**
 * ------------------------------------------------------------------
 * DATABASE ADAPTER (BRIDGE)
 * ------------------------------------------------------------------
 * Este archivo actúa como un puente de compatibilidad.
 * Redirige todas las llamadas del sistema antiguo hacia la nueva
 * arquitectura modular basada en Dexie.js ubicada en './db'.
 * * NO AGREGAR LÓGICA AQUÍ. Agregarla en src/services/db/
 */

// Re-exportar todo desde el índice de la carpeta db
export * from './db'; 

