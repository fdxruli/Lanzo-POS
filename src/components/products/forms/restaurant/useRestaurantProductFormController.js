import { useEffect, useMemo, useState } from 'react';
import { generateID, roundCurrency, showConfirmModal, showMessageModal } from '../../../../services/utils';
import Logger from '../../../../services/Logger';
import {
  buildRestaurantPayload,
  calculateRecipeCost,
  findInvalidModifierGroup,
  hasEmptyModifierOption
} from './restaurantFormUtils';
import { updateProduct } from '../../../../services/db/productUpdates';

export function useRestaurantProductFormController({
  productToEdit,
  activeRubroContext,
  common,
  onSave
}) {
  const [productType, setProductType] = useState(productToEdit?.productType || 'sellable');
  const [recipe, setRecipe] = useState(productToEdit?.recipe || []);
  const [printStation, setPrintStation] = useState(productToEdit?.printStation || 'kitchen');
  const [prepTime, setPrepTime] = useState(productToEdit?.prepTime || '');
  const [modifiers, setModifiers] = useState(productToEdit?.modifiers || []);
  const [isRecipeModalOpen, setIsRecipeModalOpen] = useState(false);
  const setDoesTrackStock = common.setDoesTrackStock;
  const currentCostValue = common.cost;
  const setCommonCost = common.setCost;

  // Insumos nuevos siempre rastrean stock.
  useEffect(() => {
    if (!productToEdit && productType === 'ingredient') {
      setDoesTrackStock(true);
    }
  }, [productToEdit, productType, setDoesTrackStock]);

  useEffect(() => {
    if (productType !== 'sellable' || recipe.length === 0) return;

    const totalRecipeCost = calculateRecipeCost(recipe);
    const currentCost = Number.parseFloat(currentCostValue) || 0;

    if (currentCost !== totalRecipeCost) {
      setCommonCost(roundCurrency(totalRecipeCost));
    }
  }, [currentCostValue, productType, recipe, setCommonCost]);

  const isCostReadOnly = useMemo(
    () => productType === 'sellable' && recipe.length > 0,
    [productType, recipe.length]
  );

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (common.isSaving) return;

    const currentPrice = Number.parseFloat(common.price) || 0;
    const currentCost = Number.parseFloat(common.cost) || 0;

    if (productType === 'sellable' && currentPrice < currentCost) {
      const confirmLoss = await showConfirmModal(
        `ALERTA DE PERDIDA!\n\nEl precio de venta ($${currentPrice}) es MENOR al costo de la receta ($${currentCost}).\n\nEstas seguro que deseas guardar con perdidas?`,
        {
          title: 'Precio menor al costo',
          confirmButtonText: 'Si, guardar',
          cancelButtonText: 'Revisar precio'
        }
      );
      if (!confirmLoss) return;
    }

    // Validacion de vida util (Modo Expiracion)
    if (common.expirationMode === 'SHELF_LIFE' && (!common.shelfLifeValue || common.shelfLifeValue <= 0)) {
      showMessageModal(
        'Datos Incompletos',
        'Debes especificar un valor válido para la Vida Útil.',
        { type: 'error' }
      );
      return;
    }

    const invalidModifier = findInvalidModifierGroup(modifiers);
    if (invalidModifier) {
      showMessageModal(
        'Configuracion Incompleta',
        `El grupo de modificadores "${invalidModifier.name}" no tiene opciones. Eliminalo o agrega opciones.`,
        { type: 'error' }
      );
      return;
    }

    if (hasEmptyModifierOption(modifiers)) {
      showMessageModal(
        'Opcion Vacia',
        'Una de las opciones de tus modificadores no tiene nombre. Por favor revisalo.',
        { type: 'error' }
      );
      return;
    }

    common.setIsSaving(true);
    try {
      const commonData = common.getCommonData();
      const productId = productToEdit?.id || generateID('prod');

      const payload = buildRestaurantPayload({
        productId,
        commonData,
        activeRubroContext,
        productType,
        recipe,
        printStation,
        prepTime,
        modifiers,
        productToEdit
      });

      // FASE 3: Transición atómica de modo de caducidad con _intent
      // Si hay purga pendiente, usar updateProduct atómico en lugar de purga diferida
      if (common.pendingBatchPurge && productId && productToEdit) {
        try {
          const purgePayload = {
            expirationMode: 'NONE',
            shelfLifeValue: null,
            shelfLifeUnit: null,
            _intent: 'PURGE_BATCHES'
          };
          
          // Actualización atómica: producto + lotes en una transacción
          const result = await updateProduct(productId, purgePayload);
          
          if (!result.success) {
            throw new Error('Falló la purga atómica de fechas de caducidad');
          }
          
          Logger.info('[Restaurante] Purga atómica completada:', result.batchOperation);
        } catch (purgeError) {
          Logger.error('Error durante la purga atómica de caducidades (Restaurante):', purgeError);
          showMessageModal(
            'Error al cambiar modo de caducidad',
            'No se pudieron purgar las fechas de los lotes. El producto no ha sido modificado.',
            { type: 'error' }
          );
          common.setIsSaving(false);
          return; // Abortar guardado completo
        }
      }

      await onSave(payload, productToEdit || { id: productId, isNew: true });
    } catch (error) {
      Logger.error(error);
      showMessageModal('Error al guardar', error.message, { type: 'error' });
    } finally {
      common.setIsSaving(false);
    }
  };

  return {
    productType,
    setProductType,
    recipe,
    setRecipe,
    printStation,
    setPrintStation,
    prepTime,
    setPrepTime,
    modifiers,
    setModifiers,
    isRecipeModalOpen,
    setIsRecipeModalOpen,
    isCostReadOnly,
    handleSubmit
  };
}
