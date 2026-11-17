import { useCallback, useEffect, useRef, useState } from 'react';
import { useStatsStore } from '../../../../store/useStatsStore';
import { useCaja } from '../../../../hooks/useCaja';
import { generateID, showConfirmModal, showMessageModal } from '../../../../services/utils';
import { buildBatchPayload } from '../utils/buildBatchPayload';
import { validateBatchInput } from '../utils/validateBatchInput';
import { productsRepository } from '../../../../services/db/products';
import { isCommercialVariantProduct } from '../../../../services/products/commercialVariants';
import { productLocalRepository } from '../../../../services/products/productLocalRepository';
import { createApparelSkuCandidate } from '../../../../services/products/apparelSku';
import { CANONICAL_BUSINESS_TYPES, normalizeBusinessType } from '../../../../utils/businessType';

const DEFAULT_FORM_VALUES = {
  cost: '',
  price: '',
  stock: '',
  notes: '',
  expiryDate: '',
  sku: '',
  attribute1: '',
  attribute2: '',
  location: '',
  pagadoDeCaja: false,
  supplier: '',
  updateGlobalPrice: false,
  manufacturerBatchId: '',
  pao: ''
};

/**
 * @typedef {Object} BatchFormContext
 * @property {Object} product
 * @property {Object | null} batchToEdit
 * @property {boolean} isEditing
 * @property {Object} features
 * @property {'restaurant' | 'pharmacy' | 'fruteria' | 'retail'} rubroGroup
 * @property {Array<Object>} menu
 */

/**
 * @param {BatchFormContext & { onSave: (batchData: Object) => Promise<boolean>, onClose: () => void }} params
 */
export function useBatchFormController({
  product,
  batchToEdit,
  onClose,
  onSave,
  features,
  menu
}) {
  const [formValues, setFormValues] = useState(DEFAULT_FORM_VALUES);
  const [isProductPriceEditing, setIsProductPriceEditing] = useState(false);
  const firstInputRef = useRef(null);
  const tallaInputRef = useRef(null);
  const { cajaActual } = useCaja();
  const adjustInventoryValue = useStatsStore((state) => state.adjustInventoryValue);
  const isEditing = Boolean(batchToEdit);
  const isCommercialVariant = isCommercialVariantProduct(product);
  const productRubro = normalizeBusinessType(product?.rubroContext ?? product?.rubro_context, null);
  const hasApparelVariantAttributes = Boolean(
    String(batchToEdit?.attributes?.talla ?? '').trim()
    && String(batchToEdit?.attributes?.color ?? '').trim()
  );
  const isApparelVariant = productRubro === CANONICAL_BUSINESS_TYPES.APPAREL
    ? (isCommercialVariant || hasApparelVariantAttributes)
    : (!productRubro && (hasApparelVariantAttributes || (features?.hasVariants && isCommercialVariant)));

  const setFieldValue = useCallback((field, value) => {
    setFormValues((prev) => ({ ...prev, [field]: value }));
  }, []);

  const startProductPriceEditing = useCallback(() => {
    setFieldValue('price', product?.price ?? '');
    setIsProductPriceEditing(true);
  }, [product?.price, setFieldValue]);

  const cancelProductPriceEditing = useCallback(() => {
    setFieldValue('price', product?.price ?? '');
    setIsProductPriceEditing(false);
  }, [product?.price, setFieldValue]);

  const buildCreateDefaults = useCallback(() => {
    let initialCost = product?.cost || '';

    if (features?.hasRecipes && Array.isArray(product?.recipe) && product.recipe.length > 0) {
      const totalRecipeCost = product.recipe.reduce((sum, item) => {
        const ingredient = menu.find((p) => p.id === item.ingredientId);
        const unitCost = ingredient?.cost || 0;
        return sum + (item.quantity * unitCost);
      }, 0);

      if (totalRecipeCost > 0) {
        initialCost = totalRecipeCost.toFixed(2);
      }
    }

    const showExpiry = features?.hasExpiry || features?.hasLots;

    return {
      ...DEFAULT_FORM_VALUES,
      cost: initialCost,
      price: product?.price ?? '',
      expiryDate: showExpiry ? '' : ''
    };
  }, [features, menu, product]);

  useEffect(() => {
    if (!product) return;

    if (isEditing) {
      const attrs = batchToEdit?.attributes || {};
      setFormValues({
        ...DEFAULT_FORM_VALUES,
        cost: batchToEdit?.cost ?? '',
        price: isCommercialVariant ? (batchToEdit?.price ?? '') : (product?.price ?? ''),
        stock: batchToEdit?.stock ?? '',
        notes: batchToEdit?.notes || '',
        expiryDate: batchToEdit?.expiryDate 
          ? (product?.expirationMode === 'SHELF_LIFE' 
              ? batchToEdit.expiryDate.substring(0, 16) 
              : batchToEdit.expiryDate.split('T')[0]) 
          : '',
        sku: batchToEdit?.sku || '',
        attribute1: attrs.talla || attrs.modelo || '',
        attribute2: attrs.color || attrs.marca || '',
        location: batchToEdit?.location || '',
        pagadoDeCaja: false,
        supplier: batchToEdit?.supplier || '',
        manufacturerBatchId: batchToEdit?.manufacturerBatchId || '',
        pao: attrs.pao || ''
      });
      setIsProductPriceEditing(false);
      return;
    }

    setFormValues(buildCreateDefaults());
    setIsProductPriceEditing(false);
  }, [batchToEdit, buildCreateDefaults, isCommercialVariant, isEditing, product]);

  const generateAutoSku = useCallback((variantId, attempt = 0) => {
    const currentSku = String(formValues.sku || '').trim();
    if (currentSku) return currentSku;

    if (isApparelVariant) {
      return createApparelSkuCandidate({
        productName: product?.name,
        color: formValues.attribute2 || batchToEdit?.attributes?.color,
        size: formValues.attribute1 || batchToEdit?.attributes?.talla,
        variantId,
        attempt
      });
    }

    const cleanName = String(product?.name || '')
      .replace(/\s+/g, '')
      .toUpperCase()
      .substring(0, 4);
    const attr1Code = String(formValues.attribute1 || '').replace(/\s+/g, '').toUpperCase();
    const attr2Code = String(formValues.attribute2 || '')
      .replace(/\s+/g, '')
      .toUpperCase()
      .substring(0, 3);

    // Generamos un sufijo alfanumérico de 4 a 5 caracteres reales en lugar del timestamp
    const randomSuffix = Math.random().toString(36).substring(2, 7).toUpperCase();

    return `${cleanName}-${attr2Code}-${attr1Code}-${randomSuffix}`;
  }, [batchToEdit?.attributes?.color, batchToEdit?.attributes?.talla, formValues.attribute1, formValues.attribute2, formValues.sku, isApparelVariant, product?.name]);

  const handleProcessSave = useCallback(async (shouldClose) => {
    const validation = validateBatchInput(formValues, product);
    if (!validation.valid) {
      showMessageModal(validation.message);
      return false;
    }

    const { nStock, nCost } = validation.parsed;
    const batchId = isEditing ? batchToEdit.id : generateID('batch');
    const totalCosto = nCost * nStock;
    const currentProductPrice = Number(product?.price ?? 0);
    const requestedPrice = Number(formValues.price);
    const hasProductPriceChange = !isCommercialVariant
      && isProductPriceEditing
      && requestedPrice !== currentProductPrice;

    if (hasProductPriceChange && requestedPrice < nCost) {
      const confirmed = await showConfirmModal(
        `El nuevo precio de venta ($${requestedPrice.toFixed(2)}) es menor que el costo de este lote ($${nCost.toFixed(2)}).\n\nEsto podría generar una venta con pérdida.\n\n¿Deseas guardar este precio de todas formas?`,
        {
          title: 'Precio menor al costo',
          confirmButtonText: 'Guardar de todas formas',
          cancelButtonText: 'Revisar precio'
        }
      );
      if (!confirmed) return false;
    }

    let paymentInfo = null;

    // 1. PRE-FLIGHT CHECK: Validación básica de estado, NO de fondos
    if (formValues.pagadoDeCaja && !isEditing) {
      if (!cajaActual || cajaActual.estado !== 'abierta') {
        showMessageModal('Operación denegada: La caja está cerrada.');
        return false;
      }

      // ELIMINAR LA LLAMADA A calcularTotalTeorico() AQUÍ.
      // Delegamos la validación financiera estrictamente a la base de datos
      // para evitar condiciones de carrera.

      // Preparamos los datos financieros.
      paymentInfo = {
        cajaId: cajaActual.id,
        monto: totalCosto,
        concepto: `Compra Stock: ${product.name} (x${nStock})`
      };
    }

    // 2. VALIDAR SKU DUPLICADO
    const userSku = String(formValues.sku || '').trim();
    if (userSku) {
      let isDuplicate = false;
      if (isApparelVariant) {
        try {
          const conflicts = await productLocalRepository.findSkuConflicts(userSku, {
            excludeBatchIds: isEditing ? [batchId] : []
          });
          isDuplicate = conflicts.length > 0;
        } catch {
          showMessageModal('No se pudo comprobar si el SKU está en uso. Inténtalo de nuevo.');
          return false;
        }
      } else {
        const existingProduct = await productsRepository.searchProductBySKU(userSku);
        isDuplicate = Boolean(existingProduct && (!isEditing || existingProduct.batchId !== batchToEdit.id));
      }

      if (isDuplicate) {
        showMessageModal(`El SKU "${userSku}" ya está en uso.`);
        return false;
      }
    }

    // 3. PREPARAR EL PAYLOAD
    let finalSku = null;
    if (isApparelVariant && !userSku) {
      for (let attempt = 0; attempt < 16; attempt += 1) {
        const candidate = generateAutoSku(batchId, attempt);
        try {
          const conflicts = await productLocalRepository.findSkuConflicts(candidate, {
            excludeBatchIds: isEditing ? [batchId] : []
          });
          if (!conflicts.length) {
            finalSku = candidate;
            break;
          }
        } catch {
          showMessageModal('No se pudo comprobar si el SKU está en uso. Inténtalo de nuevo.');
          return false;
        }
      }
      if (!finalSku) {
        showMessageModal('No se pudo generar un SKU único para esta variante. Inténtalo de nuevo.');
        return false;
      }
    } else if (userSku) {
      finalSku = userSku;
    } else if (features?.hasVariants) {
      finalSku = generateAutoSku(batchId);
    }
    const batchData = buildBatchPayload({
      batchToEdit,
      batchId,
      product,
      values: formValues,
      parsed: validation.parsed,
      features,
      finalSku,
      isProductPriceEditing
    });

    // 4. EJECUCIÓN UNIFICADA (Pasando isEditing para distinguir edición vs producción nueva)
    const saveResult = await onSave(batchData, paymentInfo, isEditing);

    // Adaptamos para soportar el nuevo formato de respuesta del controller
    const isSuccess = typeof saveResult === 'object' ? saveResult.success : saveResult;
    if (!isSuccess) return false;

    const rawMaterialsCost = typeof saveResult === 'object' ? (saveResult.rawMaterialsCost || 0) : 0;

    // 5. ACTUALIZAR ESTADÍSTICAS FINANCIERAS
    // Fórmula de Contabilidad Real: Valor Agregado = (Valor Nuevo) - (Valor Viejo) - (Costo de Materia Prima Destruida)
    const oldTotalValue = isEditing ? (batchToEdit.cost * batchToEdit.stock) : 0;
    const newTotalValue = nCost * nStock;
    const valueDifference = (newTotalValue - oldTotalValue) - rawMaterialsCost;
    await adjustInventoryValue(valueDifference);

    // 6. CERRAR O LIMPIAR FORMULARIO
    if (shouldClose) {
      onClose();
      return true;
    }

    setFormValues((prev) => ({
      ...prev,
      stock: '',
      attribute1: '',
      sku: ''
    }));
    setIsProductPriceEditing(false);

    showMessageModal(
      features?.hasVariants
        ? 'Guardado. Agrega la siguiente variante.'
        : 'Guardado. Agrega el siguiente lote.',
      null,
      { type: 'success' }
    );

    setTimeout(() => {
      if (features?.hasVariants && tallaInputRef.current) {
        tallaInputRef.current.focus();
        return;
      }
      if (firstInputRef.current) {
        firstInputRef.current.focus();
      }
    }, 100);

    return true;
  }, [
    adjustInventoryValue,
    batchToEdit,
    cajaActual,
    features,
    formValues,
    generateAutoSku,
    isApparelVariant,
    isEditing,
    isCommercialVariant,
    isProductPriceEditing,
    onClose,
    onSave,
    product
  ]);

  return {
    formValues,
    isEditing,
    firstInputRef,
    tallaInputRef,
    setFieldValue,
    isProductPriceEditing,
    startProductPriceEditing,
    cancelProductPriceEditing,
    handleProcessSave
  };
}
