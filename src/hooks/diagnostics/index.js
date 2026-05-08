/**
 * Diagnostic Hooks Index
 * 
 * Punto de entrada único para los hooks de diagnóstico operativo.
 * Cada hook está especializado por rubro de negocio y calcula alertas
 * basadas estrictamente en datos reales de Dexie (ventas, inventario, mermas).
 * 
 * @module diagnostics
 */

export { useRestaurantDiagnostics, default as useRestaurantDiagnosticsDefault } from './useRestaurantDiagnostics';
export { usePharmacyDiagnostics, default as usePharmacyDiagnosticsDefault } from './usePharmacyDiagnostics';
export { useRetailDiagnostics, default as useRetailDiagnosticsDefault } from './useRetailDiagnostics';

// Re-exportar como objeto agrupado para acceso dinámico
import useRestaurantDiagnostics from './useRestaurantDiagnostics';
import usePharmacyDiagnostics from './usePharmacyDiagnostics';
import useRetailDiagnostics from './useRetailDiagnostics';

export const DIAGNOSTIC_HOOKS = {
  restaurant: useRestaurantDiagnostics,
  pharmacy: usePharmacyDiagnostics,
  retail: useRetailDiagnostics
};

export default DIAGNOSTIC_HOOKS;
