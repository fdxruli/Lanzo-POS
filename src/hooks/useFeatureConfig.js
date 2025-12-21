// src/hooks/useFeatureConfig.js
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
 * Hook que lee los rubros seleccionados y devuelve las características activas.
 * * @param {string|null} specificRubro - (Opcional) Si se define, calcula features SOLO para este rubro.
 * Si se omite, combina las features de TODOS los rubros activos.
 */
export function useFeatureConfig(specificRubro = null) {
  // 1. Obtiene los rubros seleccionados por la empresa
  const businessTypes = useAppStore((state) => state.companyProfile?.business_type) || [];
  
  // 2. Obtiene los detalles de la licencia del usuario
  const licenseDetails = useAppStore((state) => state.licenseDetails);

  const config = useMemo(() => {
    // A. Normalizar rubros de la empresa a un array
    let companyRubros = [];
    if (Array.isArray(businessTypes)) {
      companyRubros = businessTypes;
    } else if (typeof businessTypes === 'string') {
      companyRubros = businessTypes.split(',').map(s => s.trim()).filter(Boolean);
    }
    
    // Si no hay nada configurado, fallback a 'otro'
    if (companyRubros.length === 0) {
      companyRubros = ['otro'];
    }

    // B. Determinar qué rubros vamos a evaluar en esta llamada
    let typesToEvaluate = [];

    if (specificRubro) {
      // Si el componente pide un contexto específico (ej. "estoy en modo Restaurante")
      // verificamos que la empresa realmente tenga ese rubro activado por seguridad.
      const hasAccess = companyRubros.includes(specificRubro);
      typesToEvaluate = hasAccess ? [specificRubro] : [];
    } else {
      // Si no se especifica (ej. menú principal), usamos TODOS los rubros (Unión de características)
      typesToEvaluate = companyRubros;
    }

    // Usamos Sets para evitar duplicados
    const enabledFeatures = new Set();
    const lockedFeatures = new Set();

    // Asumimos 'free' si no hay licencia, o 'pro' si la licencia es válida
    const licenseTier = (licenseDetails && licenseDetails.valid) ? 'pro' : 'free';

    // 3. Itera sobre los rubros a evaluar
    typesToEvaluate.forEach(rubro => {
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
            // Añadir a la lista de bloqueadas para mostrarlas con candado si es necesario.
            lockedFeatures.add(feature);
          }
        });
      }
    });

    // 7. Retorna el objeto de configuración
    return {
      // --- Metadatos de Contexto ---
      // Útil para saber si debemos mostrar el selector de rubros en la UI
      hasMultipleRubros: companyRubros.length > 1,
      activeRubros: typesToEvaluate,

      // --- Inventario General ---
      hasBulk: enabledFeatures.has('bulk'),           // Venta a granel / Peso
      hasExpiry: enabledFeatures.has('expiry'),       // Caducidad
      hasMinMax: enabledFeatures.has('minmax'),       // Stock Mín/Máx
      hasWaste: enabledFeatures.has('waste'),         // Merma

      // --- Rubros Específicos (Gratuitos) ---
      hasLots: enabledFeatures.has('lots'),           // Lotes (costo/precio múltiple)
      hasSKU: enabledFeatures.has('sku'),             // SKU adicional

      // --- Rubros Específicos (Potencialmente de Pago) ---
      hasSuppliers: enabledFeatures.has('suppliers'),   // Proveedores
      hasLabFields: enabledFeatures.has('lab_fields'),  // Campos de Farmacia
      hasVariants: enabledFeatures.has('variants'),     // Variantes (Talla, Color, Modelo)
      hasRecipes: enabledFeatures.has('recipes'),       // Recetas / Ingredientes
      hasModifiers: enabledFeatures.has('modifiers'),   // Modificadores (extra queso)
      hasKDS: enabledFeatures.has('kds'),               // Pantalla de Cocina
      hasWholesale: enabledFeatures.has('wholesale'),   // Mayoreo
      hasDailyPricing: enabledFeatures.has('daily_pricing'), // Precios diarios (Frutería)

      // --- Información de Bloqueo (para mostrar candados en la UI) ---
      isRecipesLocked: lockedFeatures.has('recipes'),
      isModifiersLocked: lockedFeatures.has('modifiers'),
      isVariantsLocked: lockedFeatures.has('variants'),
      isWholesaleLocked: lockedFeatures.has('wholesale'),
      isSuppliersLocked: lockedFeatures.has('suppliers'),
      isLabFieldsLocked: lockedFeatures.has('lab_fields'),
      isDailyPricingLocked: lockedFeatures.has('daily_pricing'),
    };
  }, [businessTypes, licenseDetails, specificRubro]); // Se recalcula si cambia algo relevante

  return config;
}