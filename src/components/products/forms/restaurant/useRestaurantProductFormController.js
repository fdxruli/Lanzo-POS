import { useEffect, useMemo, useState } from 'react';
import { generateID, roundCurrency, showMessageModal } from '../../../../services/utils';
import Logger from '../../../../services/Logger';
import {
  buildRestaurantPayload,
  calculateRecipeCost,
  findInvalidModifierGroup,
  hasEmptyModifierOption
} from './restaurantFormUtils';

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
      const confirmLoss = window.confirm(
        `ALERTA DE PERDIDA!\n\nEl precio de venta ($${currentPrice}) es MENOR al costo de la receta ($${currentCost}).\n\nEstas seguro que deseas guardar con perdidas?`
      );
      if (!confirmLoss) return;
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
