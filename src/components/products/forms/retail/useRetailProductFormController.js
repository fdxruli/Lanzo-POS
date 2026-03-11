import { useCallback, useEffect, useMemo, useState } from 'react';
import { queryBatchesByProductIdAndActive, saveBatchAndSyncProductSafe } from '../../../../services/database';
import { generateID, showMessageModal } from '../../../../services/utils';
import Logger from '../../../../services/Logger';
import {
  buildBatchManagementConfig,
  buildVariantBatchPayload,
  getTotalVariantStock,
  hasActiveVariantRows,
  isApparelContext,
  mapBatchesToVariantRows,
  normalizeWholesaleTiers
} from './retailFormUtils';

export function useRetailProductFormController({
  productToEdit,
  activeRubroContext,
  features,
  common,
  onSave
}) {
  const [saleType, setSaleType] = useState(productToEdit?.saleType || 'unit');
  const [unit, setUnit] = useState(productToEdit?.unit || (saleType === 'unit' ? 'pza' : 'kg'));
  const [minStock, setMinStock] = useState(productToEdit?.minStock || '');
  const [maxStock, setMaxStock] = useState(productToEdit?.maxStock || '');
  const [supplier, setSupplier] = useState(productToEdit?.supplier || '');
  const [shelfLife, setShelfLife] = useState(productToEdit?.shelfLife || '');
  const [wholesaleTiers, setWholesaleTiers] = useState(productToEdit?.wholesaleTiers || []);
  const [isWholesaleModalOpen, setIsWholesaleModalOpen] = useState(false);
  const [conversionFactor, setConversionFactor] = useState(
    productToEdit?.conversionFactor || { enabled: false, purchaseUnit: '', factor: 1 }
  );
  const [existingVariants, setExistingVariants] = useState([]);
  const [quickVariants, setQuickVariants] = useState([]);

  const isApparel = useMemo(() => isApparelContext(activeRubroContext), [activeRubroContext]);
  const hasActiveVariants = useMemo(
    () => hasActiveVariantRows(quickVariants),
    [quickVariants]
  );

  useEffect(() => {
    const loadVariants = async () => {
      if (!productToEdit?.id || !isApparel) {
        setExistingVariants([]);
        return;
      }

      try {
        const batches = await queryBatchesByProductIdAndActive(productToEdit.id);
        if (!Array.isArray(batches) || batches.length === 0) {
          setExistingVariants([]);
          return;
        }

        const formattedRows = mapBatchesToVariantRows(
          batches,
          common.cost,
          common.price
        );

        setExistingVariants(formattedRows);
        setQuickVariants(formattedRows);
      } catch (error) {
        Logger.error('Error cargando variantes:', error);
        setExistingVariants([]);
      }
    };

    loadVariants();
  }, [common.cost, common.price, isApparel, productToEdit?.id]);

  const validateRetailRules = useCallback(() => {
    const price = Number.parseFloat(common.price) || 0;
    const cost = Number.parseFloat(common.cost) || 0;

    if (price <= 0) {
      showMessageModal('Error de Precio', 'El precio de venta debe ser mayor a 0.', { type: 'error' });
      return false;
    }

    if (cost > 0) {
      if (price < cost) {
        const confirmLoss = window.confirm(
          `ALERTA CRITICA DE PRECIO!\n\n`
          + `Estas configurando el Precio ($${price}) MENOR al Costo ($${cost}).\n\n`
          + `Esto generara PERDIDAS en cada venta.\n`
          + `Estas 100% seguro de continuar?`
        );
        if (!confirmLoss) return false;
      }

      const margin = ((price - cost) / cost) * 100;
      if (margin < 10 && price >= cost) {
        const confirmLowMargin = window.confirm(
          `Margen de Ganancia Bajo (${margin.toFixed(1)}%)\n\n`
          + `El estandar sugerido es al menos 15-20%.\n`
          + `Deseas guardar de todos modos?`
        );
        if (!confirmLowMargin) return false;
      }
    }

    if (features.hasWholesale && wholesaleTiers.length > 0 && cost > 0) {
      const badTier = wholesaleTiers.find((tier) => Number.parseFloat(tier.price) < cost);
      if (badTier) {
        const confirmWholesaleLoss = window.confirm(
          `Error en Mayoreo\n\n`
          + `El precio de mayoreo ($${badTier.price}) para ${badTier.min} pzas es MENOR al costo ($${cost}).\n`
          + `Realmente quieres perder dinero en ventas mayoristas?`
        );
        if (!confirmWholesaleLoss) return false;
      }
    }

    if (saleType === 'bulk' && price <= 0) {
      showMessageModal('Datos Incompletos', 'Los productos a granel deben tener un precio por Kilo/Litro valido.');
      return false;
    }

    if (conversionFactor.enabled && (!conversionFactor.purchaseUnit || conversionFactor.factor <= 1)) {
      showMessageModal('Conversion Invalida', 'Define la unidad de compra (ej: Caja) y un factor mayor a 1 (ej: 12 piezas).');
      return false;
    }

    if (isApparel && features.hasVariants) {
      if (hasActiveVariants) {
        const incompleteVariants = quickVariants.filter((variant) => (
          (variant.talla || variant.color) && (!variant.talla || !variant.color)
        ));

        if (incompleteVariants.length > 0) {
          showMessageModal(
            'Variantes Incompletas',
            'Tienes filas con datos a medias. Por favor define Talla y Color, o elimina la fila.'
          );
          return false;
        }

        const badVariant = quickVariants.find((variant) => (
          (variant.talla && variant.color)
          && ((Number.parseFloat(variant.price) || price) < (Number.parseFloat(variant.cost) || cost))
        ));

        if (badVariant) {
          const confirmed = window.confirm(
            `La variante (${badVariant.color} ${badVariant.talla}) tiene precio menor al costo. Continuar?`
          );
          if (!confirmed) return false;
        }
      } else {
        const hasGlobalStock = common.doesTrackStock
          ? Number.parseFloat(common.getCommonData().stock || 0) > 0
          : true;

        if (!hasGlobalStock && common.doesTrackStock) {
          showMessageModal(
            'Sin Inventario',
            'No has agregado existencias.\n\nComo no definiste Variantes (Talla/Color), debes ingresar el Stock en el campo general "Cantidad Inicial".'
          );
          return false;
        }
      }
    }

    return true;
  }, [
    common,
    conversionFactor,
    features.hasVariants,
    features.hasWholesale,
    hasActiveVariants,
    isApparel,
    quickVariants,
    saleType,
    wholesaleTiers
  ]);

  const saveApparelVariants = useCallback(async ({ productId, commonData }) => {
    const validVariants = quickVariants.filter((variant) => variant.talla && variant.color);
    const batchPromises = validVariants.map((variant) => (
      saveBatchAndSyncProductSafe(buildVariantBatchPayload({ variant, productId, commonData }))
    ));

    const results = await Promise.all(batchPromises);
    const failedResult = results.find((result) => !result?.success);

    if (failedResult) {
      throw failedResult.error || new Error(failedResult.message || 'Error guardando variantes.');
    }

    Logger.info(`Creadas ${batchPromises.length} variantes para producto ${productId}`);
  }, [quickVariants]);

  const handleSubmit = useCallback(async (event) => {
    event.preventDefault();
    if (!validateRetailRules()) return;
    if (common.isSaving) return;

    common.setIsSaving(true);

    try {
      const commonData = common.getCommonData();
      const productId = productToEdit?.id || generateID('prod');
      const totalVariantStock = isApparel ? getTotalVariantStock(quickVariants) : 0;

      if (totalVariantStock > 0) {
        commonData.trackStock = true;
      }

      const initialDbStock = (isApparel && hasActiveVariants)
        ? 0
        : (productToEdit ? (Number.parseFloat(productToEdit.stock) || 0) : 0);

      const payload = {
        ...(productToEdit || {}), // PRESERVA LA DATA ORIGINAL: Evita que Dexie borre campos del CSV no manejados en el form
        id: productId,
        ...commonData,
        stock: initialDbStock, // RESPETA EL STOCK PREVIO: Impide que se reinicie a 0/undefined
        rubroContext: activeRubroContext,
        saleType,
        unit,
        minStock: minStock !== '' ? Number.parseFloat(minStock) : null,
        maxStock: maxStock !== '' ? Number.parseFloat(maxStock) : null,
        supplier,
        wholesaleTiers: normalizeWholesaleTiers(wholesaleTiers),
        conversionFactor,
        shelfLife,
        batchManagement: buildBatchManagementConfig({
          isApparel,
          hasActiveVariants,
          trackStock: commonData.trackStock
        }),
        bulkData: { purchase: { unit } },
        productType: 'sellable',
        ...(productToEdit ? { updatedAt: new Date().toISOString() } : { createdAt: new Date().toISOString() })
      };

      const success = await onSave(payload, productToEdit || { id: productId, isNew: true });

      if (success && isApparel && hasActiveVariants) {
        try {
          await saveApparelVariants({ productId, commonData });
        } catch (variantError) {
          Logger.error('Error critico guardando variantes:', variantError);
          showMessageModal(
            'Atencion: Guardado Parcial',
            'El producto principal se creo correctamente, pero hubo un error generando algunas tallas o colores.\n\nPor favor ve a la pestaña "Inventario" de este producto para verificar que variantes faltan.',
            { type: 'warning' }
          );
        }
      }
    } catch (error) {
      Logger.error('Error saving product:', error);
      showMessageModal('Error Tecnico', error.message, { type: 'error' });
    } finally {
      common.setIsSaving(false);
    }
  }, [
    activeRubroContext,
    common,
    conversionFactor,
    hasActiveVariants,
    isApparel,
    maxStock,
    minStock,
    onSave,
    productToEdit,
    quickVariants,
    saleType,
    saveApparelVariants,
    shelfLife,
    supplier,
    unit,
    validateRetailRules,
    wholesaleTiers
  ]);

  return {
    saleType,
    setSaleType,
    unit,
    setUnit,
    minStock,
    setMinStock,
    maxStock,
    setMaxStock,
    supplier,
    setSupplier,
    shelfLife,
    setShelfLife,
    wholesaleTiers,
    setWholesaleTiers,
    isWholesaleModalOpen,
    setIsWholesaleModalOpen,
    conversionFactor,
    setConversionFactor,
    existingVariants,
    quickVariants,
    setQuickVariants,
    isApparel,
    hasActiveVariants,
    handleSubmit
  };
}

