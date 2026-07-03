import {
    PRICE_DRIFT_TOLERANCE,
    TOTAL_DRIFT_TOLERANCE
} from './constants';
import { getCartLineId } from '../../utils/cartLineIdentity';
import { calculateDiscountedTotals } from './discounts';

const toNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const toPositiveNumberOrNull = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const uniqueTruthy = (values = []) => Array.from(new Set(values.filter(Boolean)));

const getModifierIdentityCandidates = (modifier = {}) => {
    const stableIdentities = uniqueTruthy([
        modifier.id,
        modifier.optionId,
        modifier.option_id,
        modifier.name
    ]);

    if (stableIdentities.length > 0) return stableIdentities;

    return uniqueTruthy([
        modifier.ingredientId,
        modifier.ingredient_id
    ]);
};

const getModifierIdentity = (modifier = {}) => (
    getModifierIdentityCandidates(modifier)[0] || ''
);

const flattenProductModifierOptions = (product = {}) => {
    if (!Array.isArray(product.modifiers)) return [];

    return product.modifiers.flatMap((group) => (
        Array.isArray(group?.options)
            ? group.options.map((option) => ({
                ...option,
                groupName: group.name
            }))
            : []
    ));
};

const resolveAuthoritativeModifiers = (dbProduct, item) => {
    const selectedModifiers = Array.isArray(item?.selectedModifiers)
        ? item.selectedModifiers
        : [];

    const catalogOptions = flattenProductModifierOptions(dbProduct);
    const catalogByIdentity = new Map();

    catalogOptions.forEach((option) => {
        getModifierIdentityCandidates(option).forEach((identity) => {
            if (!catalogByIdentity.has(identity)) catalogByIdentity.set(identity, option);
        });
    });

    const selectedIdentities = new Set(selectedModifiers.flatMap(getModifierIdentityCandidates));
    const missingRequiredGroup = (dbProduct.modifiers || []).find((group) => (
        group?.required &&
        Array.isArray(group.options) &&
        !group.options.some((option) => getModifierIdentityCandidates(option).some((identity) => selectedIdentities.has(identity)))
    ));

    if (missingRequiredGroup) {
        throw new Error(`SEGURIDAD: Falta seleccionar un modificador obligatorio de "${missingRequiredGroup.name}" para el producto "${item.name}".`);
    }

    if (selectedModifiers.length === 0) {
        return { unitTotal: 0, modifiers: [] };
    }

    let unitTotal = 0;
    const modifiers = selectedModifiers.map((modifier) => {
        const identity = getModifierIdentity(modifier);
        const catalogOption = catalogByIdentity.get(identity);

        if (!catalogOption) {
            throw new Error(`SEGURIDAD: El modificador "${modifier?.name || identity || 'desconocido'}" no existe en la configuracion del producto "${item.name}".`);
        }

        const authoritativePrice = toNumber(catalogOption.price);
        unitTotal += authoritativePrice;

        const ingredientId = catalogOption.ingredientId || catalogOption.ingredient_id || null;
        const ingredientQuantity = toPositiveNumberOrNull(
            catalogOption.ingredientQuantity
            ?? catalogOption.ingredient_quantity
            ?? catalogOption.quantity
            ?? modifier.ingredientQuantity
            ?? modifier.ingredient_quantity
            ?? modifier.quantity
        );
        const ingredientUnit = catalogOption.ingredientUnit
            ?? catalogOption.ingredient_unit
            ?? catalogOption.unit
            ?? modifier.ingredientUnit
            ?? modifier.ingredient_unit
            ?? modifier.unit
            ?? null;
        const tracksInventory = Boolean(ingredientId && ingredientQuantity > 0);

        return {
            ...modifier,
            id: catalogOption.id || modifier.id,
            optionId: catalogOption.optionId || catalogOption.option_id || modifier.optionId || modifier.option_id,
            name: catalogOption.name || modifier.name,
            price: authoritativePrice,
            ingredientId: tracksInventory ? ingredientId : null,
            ingredientQuantity: tracksInventory ? ingredientQuantity : null,
            ingredientUnit: tracksInventory ? ingredientUnit : null,
            tracksInventory,
            ...(tracksInventory ? { quantity: ingredientQuantity } : {})
        };
    });

    return { unitTotal, modifiers };
};

const resolveAuthoritativePricing = (dbProduct, item, calculatePricingDetails) => {
    if (!item?.batchId) {
        return {
            ...calculatePricingDetails(dbProduct, item.quantity),
            cost: toNumber(dbProduct.cost)
        };
    }

    const selectedBatch = (dbProduct.activeBatches || []).find((batch) => batch.id === item.batchId);
    if (!selectedBatch) {
        throw new Error(`SEGURIDAD: El lote/variante "${item.batchId}" del producto "${item.name}" no existe o no esta activo.`);
    }

    const batchBackedProduct = {
        ...dbProduct,
        price: toNumber(selectedBatch.price),
        originalPrice: toNumber(selectedBatch.price),
        cost: toNumber(selectedBatch.cost),
        isVariant: true,
        batchId: selectedBatch.id,
        activeBatches: [selectedBatch]
    };

    return {
        ...calculatePricingDetails(batchBackedProduct, item.quantity),
        cost: toNumber(selectedBatch.cost)
    };
};

export const normalizeAndValidatePricing = async ({
    itemsToProcess,
    total,
    saleDiscount = null,
    loadData,
    queryBatchesByProductIdAndActive,
    STORES,
    calculatePricingDetails,
    Logger
}) => {
    const productCache = new Map();

    const ensureProductInCache = async (id) => {
        if (productCache.has(id)) return;

        const realProduct = await loadData(STORES.MENU, id);
        if (realProduct) {
            if (realProduct.batchManagement?.enabled) {
                const activeBatches = await queryBatchesByProductIdAndActive(id, true);
                realProduct.activeBatches = activeBatches || [];
            }
            productCache.set(id, realProduct);
        }
    };

    const uniqueIds = [...new Set(itemsToProcess.map(i => i.parentId || i.id))];
    await Promise.all(uniqueIds.map(id => ensureProductInCache(id)));

    let securityViolation = false;
    let calculatedGrossTotal = 0;
    const authorizedValues = new Map();
    const authoritativeItems = [];

    itemsToProcess.forEach((item, index) => {
        const lineId = getCartLineId(item, index);
        const realId = item.parentId || item.id;
        const dbProduct = productCache.get(realId);

        if (!dbProduct) {
            throw new Error(`SEGURIDAD: El producto "${item.name}" (ID: ${realId}) no existe en la BD.`);
        }

        const pricing = resolveAuthoritativePricing(dbProduct, item, calculatePricingDetails);
        const authoritativeModifiers = resolveAuthoritativeModifiers(dbProduct, item);
        const authoritativePrice = pricing.unitPrice + authoritativeModifiers.unitTotal;
        const exactLineTotal = pricing.exactTotal + (authoritativeModifiers.unitTotal * toNumber(item.quantity));

        const priceDifference = Math.abs(authoritativePrice - toNumber(item.price));
        if (priceDifference > PRICE_DRIFT_TOLERANCE) {
            Logger?.warn(`ATAQUE DETECTADO: "${item.name}" venia con $${item.price}, real es $${authoritativePrice}.`);
            securityViolation = true;
        }

        const authoritativeCost = pricing.cost;
        calculatedGrossTotal += exactLineTotal;

        const authoritativeItem = {
            ...item,
            price: authoritativePrice,
            cost: authoritativeCost,
            exactTotal: exactLineTotal,
            selectedModifiers: authoritativeModifiers.modifiers
        };

        authoritativeItems.push(authoritativeItem);
        authorizedValues.set(lineId, {
            price: authoritativePrice,
            cost: authoritativeCost,
            exactTotal: exactLineTotal,
            selectedModifiers: authoritativeModifiers.modifiers
        });
    });

    const discountedTotals = calculateDiscountedTotals(authoritativeItems, saleDiscount);
    const expectedFinancialTotal = discountedTotals.total;
    const totalDifference = Math.abs(expectedFinancialTotal - toNumber(total));

    if (securityViolation || totalDifference > TOTAL_DRIFT_TOLERANCE) {
        throw new Error(`ALERTA DE SEGURIDAD CRITICA\n\nSe detecto una inconsistencia en los precios o descuentos.\n\nSubtotal Real: $${calculatedGrossTotal.toFixed(2)}\nTotal Esperado: $${expectedFinancialTotal.toFixed(2)}\nTotal Recibido: $${toNumber(total).toFixed(2)}\n\nLa venta ha sido bloqueada por seguridad. Por favor recarga el carrito.`);
    }

    itemsToProcess.forEach((item, index) => {
        const safeData = authorizedValues.get(getCartLineId(item, index));
        const discountedItem = discountedTotals.items[index];
        if (safeData) {
            item.price = safeData.price;
            item.cost = safeData.cost;
            item.exactTotal = safeData.exactTotal;
            item.discount = discountedItem?.discount || null;
            item.discountAmount = discountedItem?.discountAmount || 0;
            item.discount_amount = discountedItem?.discountAmount || 0;
            item.lineSubtotal = discountedItem?.lineSubtotal ?? safeData.exactTotal;
            item.lineTotal = discountedItem?.lineTotal ?? safeData.exactTotal;
            if (safeData.selectedModifiers.length > 0) {
                item.selectedModifiers = safeData.selectedModifiers;
            }
        }
    });
};
