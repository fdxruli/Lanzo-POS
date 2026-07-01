import { useEffect, useMemo, useState } from 'react';
import { generateID, roundCurrency, showConfirmModal, showMessageModal } from '../../../../services/utils';
import Logger from '../../../../services/Logger';
import { usePreparationStations } from '../../../../hooks/restaurant/usePreparationStations';
import {
  buildRestaurantPayload,
  calculateRecipeCost,
  findInvalidModifierGroup,
  hasEmptyModifierOption
} from './restaurantFormUtils';
import { updateProduct } from '../../../../services/db/productUpdates';

const getRestaurantMeta = (product) => product?.metadata?.restaurant || {};
const getStationCode = (product) => product?.printStation || getRestaurantMeta(product).printStation || 'kitchen';
const getStationName = (product) => product?.printStationName || getRestaurantMeta(product).printStationName || 'Cocina';
const toPrepTime = (value) => (value === null || value === undefined ? '' : value);

export function useRestaurantProductFormController({
  productToEdit,
  activeRubroContext,
  common,
  onSave
}) {
  const [productType, setProductType] = useState(productToEdit?.productType || 'sellable');
  const [recipe, setRecipe] = useState(productToEdit?.recipe || []);
  const [printStation, setPrintStationState] = useState(getStationCode(productToEdit));
  const [printStationName, setPrintStationName] = useState(getStationName(productToEdit));
  const [inactivePreparationStationNotice, setInactivePreparationStationNotice] = useState(false);
  const [prepTime, setPrepTime] = useState(toPrepTime(productToEdit?.prepTime ?? getRestaurantMeta(productToEdit).prepTime));
  const [modifiers, setModifiers] = useState(productToEdit?.modifiers || []);
  const [isRecipeModalOpen, setIsRecipeModalOpen] = useState(false);
  const stationState = usePreparationStations({ includeInactive: false });
  const setDoesTrackStock = common.setDoesTrackStock;
  const currentCostValue = common.cost;
  const setCommonCost = common.setCost;

  const activeStations = useMemo(() => {
    const stations = stationState.activeStations || [];
    return stations.length > 0 ? stations : [{ code: 'kitchen', name: 'Cocina', isDefault: true, isActive: true }];
  }, [stationState.activeStations]);

  const setPrintStation = (stationCode) => {
    const resolvedCode = stationCode || 'kitchen';
    const station = activeStations.find((item) => item.code === resolvedCode) || activeStations.find((item) => item.code === 'kitchen');
    setPrintStationState(station?.code || 'kitchen');
    setPrintStationName(station?.name || 'Cocina');
    setInactivePreparationStationNotice(false);
  };

  useEffect(() => {
    if (!productToEdit && productType === 'ingredient') {
      setDoesTrackStock(true);
    }
  }, [productToEdit, productType, setDoesTrackStock]);

  useEffect(() => {
    const station = activeStations.find((item) => item.code === printStation);
    if (station) {
      setPrintStationName(station.name || 'Cocina');
      return;
    }

    const originalCode = getStationCode(productToEdit);
    if (originalCode && originalCode !== 'kitchen') {
      setInactivePreparationStationNotice(true);
    }
    setPrintStationState('kitchen');
    setPrintStationName('Cocina');
  }, [activeStations, printStation, productToEdit]);

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

  const applyStationMetadata = (payload) => {
    const currentMeta = payload.metadata || productToEdit?.metadata || {};
    return {
      ...payload,
      printStation: printStation || 'kitchen',
      printStationName: printStationName || 'Cocina',
      metadata: {
        ...currentMeta,
        restaurant: {
          ...(currentMeta.restaurant || {}),
          printStation: printStation || 'kitchen',
          printStationName: printStationName || 'Cocina',
          prepTime: payload.prepTime ?? null
        }
      }
    };
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (common.isSaving) return;

    const currentPrice = Number.parseFloat(common.price) || 0;
    const currentCost = Number.parseFloat(common.cost) || 0;

    if (productType === 'sellable' && currentPrice < currentCost) {
      const confirmLoss = await showConfirmModal(
        `El precio de venta ($${currentPrice}) es menor al costo de la receta ($${currentCost}). ¿Deseas guardar de todos modos?`,
        {
          title: 'Precio menor al costo',
          confirmButtonText: 'Guardar de todos modos',
          cancelButtonText: 'Revisar precio'
        }
      );
      if (!confirmLoss) return;
    }

    if (common.expirationMode === 'SHELF_LIFE' && (!common.shelfLifeValue || common.shelfLifeValue <= 0)) {
      showMessageModal(
        'Datos incompletos',
        'Debes especificar un valor válido para la vida útil.',
        { type: 'error' }
      );
      return;
    }

    const invalidModifier = findInvalidModifierGroup(modifiers);
    if (invalidModifier) {
      showMessageModal(
        'Configuración incompleta',
        `El grupo de modificadores "${invalidModifier.name}" no tiene opciones. Elimínalo o agrega opciones.`,
        { type: 'error' }
      );
      return;
    }

    if (hasEmptyModifierOption(modifiers)) {
      showMessageModal(
        'Opción vacía',
        'Una de las opciones de tus modificadores no tiene nombre. Por favor revísalo.',
        { type: 'error' }
      );
      return;
    }

    common.setIsSaving(true);
    try {
      const commonData = common.getCommonData();
      const productId = productToEdit?.id || generateID('prod');

      const basePayload = buildRestaurantPayload({
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

      const payload = applyStationMetadata(basePayload);

      if (common.pendingBatchPurge && productId && productToEdit) {
        try {
          const purgePayload = {
            expirationMode: 'NONE',
            shelfLifeValue: null,
            shelfLifeUnit: null,
            _intent: 'PURGE_BATCHES'
          };

          const result = await updateProduct(productId, purgePayload);

          if (!result.success) {
            throw new Error('No se pudo purgar la caducidad de los lotes.');
          }

          Logger.info('[Restaurante] Purga atomica completada:', result.batchOperation);
        } catch (purgeError) {
          Logger.error('Error durante la purga atomica de caducidades:', purgeError);
          showMessageModal(
            'Error al cambiar modo de caducidad',
            'No se pudieron purgar las fechas de los lotes. El producto no ha sido modificado.',
            { type: 'error' }
          );
          common.setIsSaving(false);
          return;
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
    printStationName,
    setPrintStationName,
    prepTime,
    setPrepTime,
    modifiers,
    setModifiers,
    isRecipeModalOpen,
    setIsRecipeModalOpen,
    isCostReadOnly,
    preparationStations: activeStations,
    preparationStationsLoading: stationState.isLoading,
    preparationStationsError: stationState.error,
    inactivePreparationStationNotice,
    handleSubmit
  };
}
