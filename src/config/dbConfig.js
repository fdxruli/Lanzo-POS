// Configuración centralizada de la base de datos.
//
// HISTORIA PUBLICADA:
// - 110 fue una versión NATIVA de IndexedDB usada por el motor legacy.
// - Dexie multiplica su versión declarada por 10 al abrir IndexedDB.
//   Por ejemplo, Dexie v24 se observa como IndexedDB nativeVersion=240.
//
// No usar LEGACY_DB_VERSION para abrir workers ni para registrar upgrades nuevos.
export const DB_NAME = 'LanzoDB1';
export const LEGACY_DB_VERSION = 110;

// Alias conservado únicamente para imports históricos. No representa la versión
// Dexie actual ni debe pasarse a indexedDB.open().
export const DB_VERSION = LEGACY_DB_VERSION;
