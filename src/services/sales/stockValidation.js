import { getAvailableStock } from '../db/utils';
import { getRecipeIngredientId, getIngredientDefaultUnit } from '../../utils/ingredientConfiguration';
import { getOperationalStockSnapshot } from '../inventoryStock';
import { isBatchExpiredForSale } from '../../utils/dateUtils';

const hasRecipe = (product) => Array.isArray(product?.recipe) && product.recipe.length > 0;
const shouldTrackDirectStock = (product) => Boolean(product?.trackStock);
const getRealProductId = (item) => item?.parentId || item?.id;

const normalizeQuantity = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export const getInventoryQuantityForSale = (orderItem, product) => {
    let quantityToDeduct = normalizeQuantity(orderItem?.quantity);

    if (product?.conversionFactor?.enabled) {
        const factor = parseFloat(product.conversionFactor.factor);

        if (!Number.isNaN(factor) && factor > 1) {
            quantityToDeduct = quantityToDeduct / factor;
        }
    }

    return quantityToDeduct;
};

const addRequirement = (requirements, id, qty) => {
    if (!id) return;
    const safeQty = normalizeQuantity(qty);
    if (safeQty <= 0) return;
    requirements.set(id, (requirements.get(id) || 0) + safeQty);
};

const buildRequirementsForItem = (item, productDef) => {
    const itemRequirements = new Map();
    const quantityToDeduct = getInventoryQuantityForSale(item, productDef);

    if (hasRecipe(productDef)) {
        productDef.recipe.forEach((ing) => {
            addRequirement(itemRequirements, getRecipeIngredientId(ing), (ing.quantity || 0) * quantityToDeduct);
        });
    } else if (shouldTrackDirectStock(productDef)) {
        addRequirement(itemRequirements, getRealProductId(item), quantityToDeduct);
    }

    if (Array.isArray(item.selectedModifiers)) {
        item.selectedModifiers.forEach((mod) => {
            addRequirement(itemRequirements, mod.ingredientId, (mod.quantity || 1) * quantityToDeduct);
        });
    }

    return itemRequirements;
};

const loadFreshProducts = async ({ idsArray, loadData, loadMultipleData, STORES }) => {
    if (idsArray.length === 0) return [];

    if (typeof loadMultipleData === 'function') {
        const fetchPromise = loadMultipleData(STORES.MENU, idsArray);
        fetchPromise.catch(() => { });

        return await Promise.race([
            fetchPromise,
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('DB_TIMEOUT: La lectura masiva excedio el tiempo limite')), 5000)
            )
        ]);
    }

    if (typeof loadData !== 'function') {
        return [];
    }

    return await Promise.all(idsArray.map((id) => loadData(STORES.MENU, id)));
};

const loadFreshBatchesByProduct = async ({ productIds, queryBatchesByProductIdAndActive }) => {
    const batchesByProduct = new Map();

    if (productIds.length === 0 || typeof queryBatchesByProductIdAndActive !== 'function') {
        return batchesByProduct;
    }

    await Promise.all(productIds.map(async (productId) => {
        const batches = await queryBatchesByProductIdAndActive(productId, true);
        batchesByProduct.set(productId, Array.isArray(batches) ? batches : []);
    }));

    return batchesByProduct;
};

export const validateStockBeforeSale = async ({
    itemsToProcess,
    productMap,
    loadData,
    loadMultipleData,
    queryBatchesByProductIdAndActive,
    STORES
}) => {
    const requirementsByItem = new Map();
    const uniqueStockIds = new Set();

    itemsToProcess.forEach((item, index) => {
        const productDef = productMap.get(getRealProductId(item));
        const itemRequirements = buildRequirementsForItem(item, productDef);

        requirementsByItem.set(index, itemRequirements);
        itemRequirements.forEach((_qty, targetId) => uniqueStockIds.add(targetId));
    });

    const freshStockMap = new Map();
    const idsArray = Array.from(uniqueStockIds);

    if (idsArray.length > 0) {
        try {
            const results = await loadFreshProducts({ idsArray, loadData, loadMultipleData, STORES });

            (results || []).forEach((freshProd, index) => {
                if (freshProd) {
                    freshStockMap.set(idsArray[index], freshProd);
                }
            });
        } catch (error) {
            if (error.message.includes('DB_TIMEOUT')) {
                return {
                    ok: false,
                    response: {
                        success: false,
                        errorType: 'DB_TIMEOUT',
                        message: 'El sistema esta tardando en verificar el inventario. El motor de base de datos esta ocupado.'
                    }
                };
            }
            throw error;
        }
    }

    const batchManagedIds = idsArray.filter((id) => freshStockMap.get(id)?.batchManagement?.enabled);
    const batchesByProduct = await loadFreshBatchesByProduct({
        productIds: batchManagedIds,
        queryBatchesByProductIdAndActive
    });

    const totals = new Map();
    for (const [index, requirements] of requirementsByItem) {
        const item = itemsToProcess[index];
        const source = productMap.get(getRealProductId(item));
        const recipeIds = new Set((source?.recipe || []).map(getRecipeIngredientId));
        for (const [id, qty] of requirements) {
            const current = totals.get(id) || { needed: 0, recipeOnly: true };
            current.needed += qty;
            current.recipeOnly = current.recipeOnly
                && recipeIds.has(id)
                && !(item.selectedModifiers || []).some((modifier) => modifier.ingredientId === id);
            totals.set(id, current);
        }
    }

    const missingIngredients = [];
    const unknownIngredients = [];
    let eligibleForPartial = true;
    for (const [id, requirement] of totals) {
        const product = freshStockMap.get(id);
        const snapshot = product && getOperationalStockSnapshot(product);
        if (!product || product.isActive === false || product.deletedAt || product.trackStock === false
            || (product.productType && requirement.recipeOnly && product.productType !== 'ingredient')
            || (!product.batchManagement?.enabled && !snapshot?.valid)) {
            unknownIngredients.push(id);
            continue;
        }
        let available = getAvailableStock(product);
        if (product.batchManagement?.enabled) {
            const batches = batchesByProduct.get(id) || [];
            if (batches.some((batch) => !getOperationalStockSnapshot(batch).valid)) {
                unknownIngredients.push(id);
                continue;
            }
            if (product.expirationMode === 'STRICT' && batches.some((batch) =>
                batch.isActive !== false && getAvailableStock(batch) > 0
                && (!batch.expiryDate || isBatchExpiredForSale(batch, product, new Date()))
            )) {
                return { ok: false, response: {
                    success: false, errorType: 'EXPIRY_BLOCKED',
                    message: 'Hay lotes caducados o sin fecha obligatoria. Revisa Caducidad/Merma antes de vender.'
                } };
            }
            available = batches.filter((batch) => batch.isActive !== false && batch.status !== 'inactive'
                && !isBatchExpiredForSale(batch, product, new Date()))
                .reduce((sum, batch) => sum + getAvailableStock(batch), 0);
        }
        if (available + 0.00001 < requirement.needed) {
            eligibleForPartial = eligibleForPartial && requirement.recipeOnly;
            missingIngredients.push({
                ingredientId: id,
                productName: 'Pedido (Acumulado)',
                ingredientName: product.name,
                needed: requirement.needed,
                available,
                missing: Math.max(0, requirement.needed - available),
                unit: getIngredientDefaultUnit(product)
            });
        }
    }

    if (unknownIngredients.length) {
        return { ok: false, response: {
            success: false, errorType: 'INVENTORY_UNKNOWN',
            message: 'No se puede vender con faltantes: hay ingredientes inexistentes, inactivos o con stock desconocido. Actualiza el catálogo.',
            unknownIngredients
        } };
    }

    if (missingIngredients.length) {
        const details = missingIngredients.map((m) =>
            '- ' + m.ingredientName + ': requeridos ' + m.needed.toFixed(2) + ' ' + m.unit
            + ', disponibles ' + m.available.toFixed(2) + ', faltan ' + m.missing.toFixed(2)
        ).join('\n');
        return {
            ok: false,
            response: {
                success: false,
                errorType: 'STOCK_WARNING',
                message: 'Faltantes acumulados del pedido:\n\n' + details + '\n\nSe descontará únicamente el stock libre al confirmar.',
                missingData: missingIngredients,
                eligibleForPartial: Boolean(eligibleForPartial)
            }
        };
    }

    return { ok: true };
};
