// NUEVO ARCHIVO: src/hooks/useFeatureConfig.js

import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';

/**
 * Define qué características (features) activa cada rubro.
 * Esta es tu configuración central.
 */
const RUBRO_FEATURES = {
  // --- GRUPOS NUEVOS ---
  // Servicio de Comida (Restaurante, Dark Kitchen, Antojitos/Postres)
  'food_service': ['recipes', 'modifiers', 'waste', 'kds'],

  // Ropa y Calzado
  'apparel': ['variants', 'sku', 'suppliers'],

  // Ferretería y Similares
  'hardware': ['variants', 'sku', 'suppliers', 'minmax', 'wholesale', 'bulk'],

  // --- RUBROS ORIGINALES ---
  // Abarrotes
  'abarrotes': ['bulk', 'wholesale', 'suppliers', 'minmax', 'expiry'],

  // Farmacia
  'farmacia': ['lots', 'expiry', 'lab_fields'],

  // Verdulería
  'verduleria/fruteria': ['bulk', 'expiry', 'waste', 'daily_pricing'],

  // Otro (un comodín con las funciones más comunes)
  'otro': ['bulk', 'expiry', 'lots', 'suppliers']
};

/**
 * Define el nivel de licencia ("tier") necesario para cada característica.
 * Las características no listadas aquí se asumen como 'free' (gratuitas).
 */
const FEATURE_TIERS = {
  'recipes': 'pro',         // Recetas
  'modifiers': 'pro',       // Modificadores
  'variants': 'pro',        // Variantes (Talla, Color, etc.)
  'wholesale': 'pro',       // Precios de Mayoreo
  'suppliers': 'pro',       // Gestión de Proveedores
  'lab_fields': 'pro',      // Campos de Farmacia
  'daily_pricing': 'pro',   // Precios variables por día
  // ... 'bulk', 'expiry', 'lots', 'minmax', 'sku', 'waste' se quedan como 'free'
};


/**
 * Hook que lee los rubros seleccionados por el usuario y su licencia,
 * y devuelve un objeto booleano con TODAS las características combinadas
 * y permitidas que necesita.
 */
export function useFeatureConfig() {
  // 1. Obtiene los rubros seleccionados por el usuario
  const businessTypes = useAppStore((state) => state.companyProfile?.business_type) || [];

  // 2. Obtiene los detalles de la licencia del usuario
  const licenseDetails = useAppStore((state) => state.licenseDetails);

  const features = useMemo(() => {

    let types = businessTypes;

    if (!Array.isArray(types)) {
      if (typeof types === 'string') {
        types = types.split(',').map(s => s.trim()).filter(Boolean)
      } else {
        types = [];
      }
    }

    if (types.length === 0) {
      console.warn('No hay rubros configurados, usando configuración básica');
      types = ['otro'];
    }

    // Usamos un Set para que las 'features' no se repitan
    const enabledFeatures = new Set();

    // Un Set para rastrear las features bloqueadas por licencia
    const lockedFeatures = new Set();

    // Asumimos 'free' si no hay licencia, o 'pro' si la licencia es válida
    // (A futuro, tu `licenseDetails` podría traer un campo `tier: 'pro'`)
    const licenseTier = (licenseDetails && licenseDetails.valid) ? 'pro' : 'free';

    // 3. Itera sobre cada rubro que el usuario seleccionó
    businessTypes.forEach(rubro => {
      const featuresForRubro = RUBRO_FEATURES[rubro];

      if (featuresForRubro) {
        // 4. Itera sobre las características de ESE rubro
        featuresForRubro.forEach(feature => {

          // 5. DOBLE VALIDACIÓN: ¿Qué tier se necesita?
          const requiredTier = FEATURE_TIERS[feature] || 'free';

          // 6. ¿El usuario CUMPLE con el tier?
          if (requiredTier === 'free' || (requiredTier === 'pro' && licenseTier === 'pro')) {
            // Sí, añadir la característica
            enabledFeatures.add(feature);
          } else if (requiredTier === 'pro' && licenseTier === 'free') {
            // No, el usuario es 'free' pero necesita 'pro'.
            // Añadir a la lista de bloqueadas.
            lockedFeatures.add(feature);
          }
        });
      }
    });

    // 7. Convierte los Sets en un objeto booleano fácil de usar
    return {
      // --- Inventario General ---
      hasBulk: enabledFeatures.has('bulk'),           // Venta a granel
      hasExpiry: enabledFeatures.has('expiry'),       // Caducidad
      hasMinMax: enabledFeatures.has('minmax'),     // Stock Mín/Máx
      hasWaste: enabledFeatures.has('waste'),         // Merma

      // --- Rubros Específicos (Gratuitos) ---
      hasLots: enabledFeatures.has('lots'),           // Lotes (costo/precio múltiple)
      hasSKU: enabledFeatures.has('sku'),             // SKU (como campo gratuito)

      // --- Rubros Específicos (Potencialmente de Pago) ---
      hasSuppliers: enabledFeatures.has('suppliers'),   // Proveedores
      hasLabFields: enabledFeatures.has('lab_fields'),// Campos de Farmacia
      hasVariants: enabledFeatures.has('variants'),   // Variantes (Talla, Color, Modelo)
      hasRecipes: enabledFeatures.has('recipes'),     // Recetas
      hasModifiers: enabledFeatures.has('modifiers'), // Modificadores (extra queso)
      hasKDS: enabledFeatures.has('kds'),
      hasWholesale: enabledFeatures.has('wholesale'), // Mayoreo
      hasDailyPricing: enabledFeatures.has('daily_pricing'), // Precios diarios

      // --- Información de Licencia (para la UI) ---
      // Devuelve true si la feature está bloqueada
      isRecipesLocked: lockedFeatures.has('recipes'),
      isModifiersLocked: lockedFeatures.has('modifiers'),
      isVariantsLocked: lockedFeatures.has('variants'),
      isWholesaleLocked: lockedFeatures.has('wholesale'),
      isSuppliersLocked: lockedFeatures.has('suppliers'),
      isLabFieldsLocked: lockedFeatures.has('lab_fields'),
      isDailyPricingLocked: lockedFeatures.has('daily_pricing'),
    };
  }, [businessTypes, licenseDetails]); // Se recalcula si cambian los rubros o la licencia

  return features;
}