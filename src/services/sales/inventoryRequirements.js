import { normalizeStock } from '../db/utils';

const hasValue = (value) => value !== undefined && value !== null && value !== '';

const toFiniteNumber = (value, fallback = 0) => {
    if (!hasValue(value)) return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const toPositiveNumberOrNull = (value) => {
    const parsed = toFiniteNumber(value, NaN);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const getRealProductId = (item) => item?.parentId || item?.id;

export const hasProductRecipe = (product) => Array.isArray(product?.recipe) && product.recipe.length > 0;

export const getQuantityToDeduct = (orderItem, product) => {
    let quantityToDeduct = toFiniteNumber(orderItem?.quantity, 0);

    if (product?.conversionFactor?.enabled) {
        const factor = parseFloat(product.conversionFactor.factor);

        if (!Number.isNaN(factor) && factor > 1) {
            quantityToDeduct = quantityToDeduct / factor;
        }
    }

    return normalizeStock(quantityToDeduct);
};

const hasLegacyQuantity = (modifier = {}) => hasValue(modifier?.quantity);

export const getModifierIngredientId = (modifier = {}) => (
    String(modifier?.ingredientId ?? modifier?.ingredient_id ?? '').trim() || null
);

export const getModifierIngredientQuantity = (modifier = {}) => {
    const hasExplicitQuantity = hasValue(modifier?.ingredientQuantity)
        || hasValue(modifier?.ingredient_quantity);

    if (hasExplicitQuantity) {
        return toPositiveNumberOrNull(modifier?.ingredientQuantity ?? modifier?.ingredient_quantity);
    }

    if (hasLegacyQuantity(modifier)) {
        return toPositiveNumberOrNull(modifier.quantity);
    }

    return null;
};

export const shouldTrackModifierInventory = (modifier = {}) => {
    const ingredientId = getModifierIngredientId(modifier);
    const ingredientQuantity = getModifierIngredientQuantity(modifier);

    if (!ingredientId || !ingredientQuantity || ingredientQuantity <= 0) return false;

    if (modifier?.tracksInventory === true) return true;
    if (modifier?.tracksInventory === false) return false;

    // Compatibilidad con extras legacy previos a REST.INV.1: ingredientId + quantity.
    return hasLegacyQuantity(modifier);
};

export const shouldTrackDirectProductStock = (product = {}) => {
    if (!product || product.trackStock === false || hasProductRecipe(product)) return false;

    return Boolean(product.trackStock)
        || hasValue(product.stock)
        || hasValue(product.committedStock)
        || Boolean(product.batchManagement?.enabled);
};

const addRequirement = (requirements, productId, qty) => {
    if (!productId) return;
    const safeQty = normalizeStock(qty);
    if (safeQty <= 0) return;

    requirements.set(productId, normalizeStock((requirements.get(productId) || 0) + safeQty));
};

export const buildIngredientRequirementsForItem = (orderItem, product) => {
    const requirements = new Map();
    const quantityToDeduct = getQuantityToDeduct(orderItem, product);

    if (quantityToDeduct <= 0) {
        return { quantityToDeduct, requirements: [] };
    }

    if (hasProductRecipe(product)) {
        product.recipe.forEach((ingredient) => {
            addRequirement(
                requirements,
                ingredient?.ingredientId,
                normalizeStock((toFiniteNumber(ingredient?.quantity, 0)) * quantityToDeduct)
            );
        });
    } else if (shouldTrackDirectProductStock(product)) {
        addRequirement(requirements, getRealProductId(orderItem), quantityToDeduct);
    }

    if (Array.isArray(orderItem?.selectedModifiers)) {
        orderItem.selectedModifiers.forEach((modifier) => {
            if (!shouldTrackModifierInventory(modifier)) return;

            addRequirement(
                requirements,
                getModifierIngredientId(modifier),
                normalizeStock(getModifierIngredientQuantity(modifier) * quantityToDeduct)
            );
        });
    }

    return {
        quantityToDeduct,
        requirements: Array.from(requirements.entries()).map(([targetId, neededQty]) => ({
            targetId,
            neededQty
        }))
    };
};

export const shouldTrackInventoryForItem = (orderItem, product) => (
    buildIngredientRequirementsForItem(orderItem, product).requirements.length > 0
);

export default {
    getRealProductId,
    hasProductRecipe,
    getQuantityToDeduct,
    getModifierIngredientId,
    getModifierIngredientQuantity,
    shouldTrackModifierInventory,
    shouldTrackDirectProductStock,
    buildIngredientRequirementsForItem,
    shouldTrackInventoryForItem
};
