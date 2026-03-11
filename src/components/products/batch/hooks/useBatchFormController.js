import { useCallback, useEffect, useRef, useState } from 'react';
import { useStatsStore } from '../../../../store/useStatsStore';
import { useCaja } from '../../../../hooks/useCaja';
import { queryByIndex, STORES } from '../../../../services/database';
import { showMessageModal } from '../../../../services/utils';
import { buildBatchPayload } from '../utils/buildBatchPayload';
import { validateBatchInput } from '../utils/validateBatchInput';

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
  updateGlobalPrice: false
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
  rubroGroup,
  menu
}) {
  const [formValues, setFormValues] = useState(DEFAULT_FORM_VALUES);
  const firstInputRef = useRef(null);
  const tallaInputRef = useRef(null);
  const { cajaActual, calcularTotalTeorico } = useCaja();
  const adjustInventoryValue = useStatsStore((state) => state.adjustInventoryValue);
  const isEditing = Boolean(batchToEdit);

  const setFieldValue = useCallback((field, value) => {
    setFormValues((prev) => ({ ...prev, [field]: value }));
  }, []);

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

    const showExpiry = rubroGroup === 'pharmacy' || rubroGroup === 'fruteria' || features?.hasLots;

    return {
      ...DEFAULT_FORM_VALUES,
      cost: initialCost,
      price: product?.price || '',
      expiryDate: showExpiry ? '' : ''
    };
  }, [features, menu, product, rubroGroup]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!product) return;

    if (isEditing) {
      const attrs = batchToEdit?.attributes || {};
      setFormValues({
        ...DEFAULT_FORM_VALUES,
        cost: batchToEdit?.cost ?? '',
        price: batchToEdit?.price ?? '',
        stock: batchToEdit?.stock ?? '',
        notes: batchToEdit?.notes || '',
        expiryDate: batchToEdit?.expiryDate ? batchToEdit.expiryDate.split('T')[0] : '',
        sku: batchToEdit?.sku || '',
        attribute1: attrs.talla || attrs.modelo || '',
        attribute2: attrs.color || attrs.marca || '',
        location: batchToEdit?.location || '',
        pagadoDeCaja: false,
        supplier: batchToEdit?.supplier || ''
      });
      return;
    }

    setFormValues(buildCreateDefaults());
  }, [batchToEdit, buildCreateDefaults, isEditing, product]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const generateAutoSku = useCallback(() => {
    const currentSku = String(formValues.sku || '').trim();
    if (currentSku) return currentSku;

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
  }, [formValues.attribute1, formValues.attribute2, formValues.sku, product?.name]);

  const handleProcessSave = useCallback(async (shouldClose) => {
    const validation = validateBatchInput(formValues);
    if (!validation.valid) {
      showMessageModal(validation.message);
      return false;
    }

    const { nStock, nCost } = validation.parsed;
    const totalCosto = nCost * nStock;

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
      const existingBatches = await queryByIndex(STORES.PRODUCT_BATCHES, 'sku', userSku);
      const isDuplicate = existingBatches.some((batch) => (
        isEditing ? batch.id !== batchToEdit.id : true
      ));

      if (isDuplicate) {
        showMessageModal(`El SKU "${userSku}" ya está en uso.`);
        return false;
      }
    }

    // 3. PREPARAR EL PAYLOAD
    const finalSku = features?.hasVariants ? generateAutoSku() : null;
    const batchData = buildBatchPayload({
      batchToEdit,
      product,
      values: formValues,
      parsed: validation.parsed,
      features,
      finalSku
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
    isEditing,
    onClose,
    onSave,
    product,
    calcularTotalTeorico
  ]);

  return {
    formValues,
    isEditing,
    firstInputRef,
    tallaInputRef,
    setFieldValue,
    handleProcessSave
  };
}
