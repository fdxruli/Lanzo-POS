// src/hooks/useFeatureConfig.js
import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';

/**
 * CONFIGURACIÓN CENTRAL DE REGLAS DE NEGOCIO
 */
const RUBRO_FEATURES = {
  // --- GRUPOS NUEVOS ---
  'food_service': ['recipes', 'modifiers', 'waste', 'kds'], // Restaurante: No usa 'bulk' de venta directa usualmente
  'apparel': ['variants', 'sku', 'suppliers', 'layaway'], // Ropa: JAMÁS es a granel
  'hardware': ['lots', 'sku', 'suppliers', 'minmax', 'wholesale', 'bulk'], // Ferretería: Clavos/Cables sí pueden ser granel

  // --- RUBROS ORIGINALES ---
  'abarrotes': ['bulk', 'wholesale', 'suppliers', 'minmax', 'expiry'], // Abarrotes: Sí usa granel (jamón, frijol)
  'farmacia': ['lots', 'expiry', 'lab_fields', 'suppliers'], // Farmacia: REMOVIDO 'bulk'. Medicamentos son unitarios.
  'verduleria/fruteria': ['bulk', 'expiry', 'waste', 'daily_pricing'], // Frutería: 100% Granel
  'otro': ['bulk', 'expiry', 'lots', 'suppliers']
};

const FEATURE_TIERS = {
  'recipes': 'pro',
  'modifiers': 'pro',
  'variants': 'pro',
  'wholesale': 'pro',
  'suppliers': 'pro',
  'lab_fields': 'pro',
  'daily_pricing': 'pro',
};

export function useFeatureConfig(specificRubro = null) {
  const businessTypes = useAppStore((state) => state.companyProfile?.business_type) || [];
  const licenseDetails = useAppStore((state) => state.licenseDetails);

  const config = useMemo(() => {
    let companyRubros = [];
    if (Array.isArray(businessTypes)) {
      companyRubros = businessTypes;
    } else if (typeof businessTypes === 'string') {
      companyRubros = businessTypes.split(',').map(s => s.trim()).filter(Boolean);
    }

    if (companyRubros.length === 0) companyRubros = ['otro'];

    let typesToEvaluate = specificRubro
      ? (companyRubros.includes(specificRubro) ? [specificRubro] : [])
      : companyRubros;

    const enabledFeatures = new Set();
    const lockedFeatures = new Set();
    const licenseTier = (licenseDetails && licenseDetails.valid) ? 'pro' : 'free';

    typesToEvaluate.forEach(rubro => {
      const featuresForRubro = RUBRO_FEATURES[rubro];
      if (featuresForRubro) {
        featuresForRubro.forEach(feature => {
          const requiredTier = FEATURE_TIERS[feature] || 'free';
          if (requiredTier === 'free' || (requiredTier === 'pro' && licenseTier === 'pro')) {
            enabledFeatures.add(feature);
          } else if (requiredTier === 'pro' && licenseTier === 'free') {
            lockedFeatures.add(feature);
          }
        });
      }
    });

    const hasBulk = enabledFeatures.has('bulk');

    return {
      activeRubros: typesToEvaluate,

      // --- Lógica de Negocio Crítica ---
      hasBulk,
      // Helper derivado: Si NO tiene bulk, forzamos modo unitario (Pieza)
      // Esto elimina la pregunta "¿Pieza o Granel?" en Farmacias/Boutiques
      forceUnitMode: !hasBulk,

      hasExpiry: enabledFeatures.has('expiry'),
      hasMinMax: enabledFeatures.has('minmax'),
      hasWaste: enabledFeatures.has('waste'),
      hasLots: enabledFeatures.has('lots'),
      hasSKU: enabledFeatures.has('sku'),
      hasSuppliers: enabledFeatures.has('suppliers'),
      hasLabFields: enabledFeatures.has('lab_fields'),
      hasVariants: enabledFeatures.has('variants'),
      hasRecipes: enabledFeatures.has('recipes'),
      hasModifiers: enabledFeatures.has('modifiers'),
      hasKDS: enabledFeatures.has('kds'),
      hasWholesale: enabledFeatures.has('wholesale'),
      hasDailyPricing: enabledFeatures.has('daily_pricing'),
      hasLayaway: enabledFeatures.has('layaway'),
      isRecipesLocked: lockedFeatures.has('recipes'),
      isModifiersLocked: lockedFeatures.has('modifiers'),
      isVariantsLocked: lockedFeatures.has('variants'),
      isWholesaleLocked: lockedFeatures.has('wholesale'),
      isSuppliersLocked: lockedFeatures.has('suppliers'),
      isLabFieldsLocked: lockedFeatures.has('lab_fields'),
      isDailyPricingLocked: lockedFeatures.has('daily_pricing'),
    };
  }, [businessTypes, licenseDetails, specificRubro]);

  return config;
}