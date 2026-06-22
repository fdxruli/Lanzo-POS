import {
    PRICE_DRIFT_TOLERANCE,
    TOTAL_DRIFT_TOLERANCE
} from './constants';
import { getCartLineId } from '../../utils/cartLineIdentity';

const toNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const getModifierIdentity = (modifier = {}) => (
    modifier.ingredientId || modifier.id || modifier.optionId || modifier.name || ''
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
        const identity = getModifierIdentity(option);
        if (!identity) return;
        if (!catalogByIdentity.has(identity)) catalogByIdentity.set(identity, option);
    });

    const selectedIdentities = new Set(selectedModifiers.map(getModifierIdentity).filter(Boolean));
    const missingRequiredGroup = (dbProduct.modifiers || []).find((group) => (
        group?.required &&
        Array.isArray(group.options) &&
        !group.options.some((option) => selectedIdentities.has(getModifierIdentity(option)))
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

        return {
            ...modifier,
            name: catalogOption.name || modifier.name,
            price: authoritativePrice,
            ingredientId: catalogOption.ingredientId || modifier.ingredientId || null,
            quantity: modifier.quantity || catalogOption.quantity || 1
        };
    });

    return { unitTotal, modifiers };
};

export const normalizeAndValidatePricing = async ({
    itemsToProcess,
    total,
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
    let calculatedRealTotal = 0;
    const authorizedValues = new Map();

    itemsToProcess.forEach((item, index) => {
        const lineId = getCartLineId(item, index);
        const realId = item.parentId || item.id;
        const dbProduct = productCache.get(realId);

        if (!dbProduct) {
            throw new Error(`SEGURIDAD: El producto "${item.name}" (ID: ${realId}) no existe en la BD.`);
        }

        const pricing = calculatePricingDetails(dbProduct, item.quantity);
        const authoritativeModifiers = resolveAuthoritativeModifiers(dbProduct, item);
        const authoritativePrice = pricing.unitPrice + authoritativeModifiers.unitTotal;
        const exactLineTotal = pricing.exactTotal + (authoritativeModifiers.unitTotal * toNumber(item.quantity));

        const priceDifference = Math.abs(authoritativePrice - toNumber(item.price));

        if (priceDifference > PRICE_DRIFT_TOLERANCE) {
            Logger?.warn(`ATAQUE DETECTADO: "${item.name}" venia con $${item.price}, real es $${authoritativePrice}.`);
            securityViolation = true;
        }

        const authoritativeCost = parseFloat(dbProduct.cost) || 0;

        calculatedRealTotal += exactLineTotal;

        authorizedValues.set(lineId, {
            price: authoritativePrice,
            cost: authoritativeCost,
            exactTotal: exactLineTotal,
            selectedModifiers: authoritativeModifiers.modifiers
        });
    });

    const totalDifference = Math.abs(calculatedRealTotal - toNumber(total));

    if (securityViolation || totalDifference > TOTAL_DRIFT_TOLERANCE) {
        throw new Error(`ALERTA DE SEGURIDAD CRITICA\n\nSe detecto una inconsistencia en los precios (Posible manipulacion).\n\nTotal Esperado: $${total}\nTotal Real Calculado: $${calculatedRealTotal.toFixed(2)}\n\nLa venta ha sido bloqueada por seguridad. Por favor recarga el carrito.`);
    }

    itemsToProcess.forEach((item, index) => {
        const safeData = authorizedValues.get(getCartLineId(item, index));
        if (safeData) {
            item.price = safeData.price;
            item.cost = safeData.cost;
            item.exactTotal = safeData.exactTotal;
            if (safeData.selectedModifiers.length > 0) {
                item.selectedModifiers = safeData.selectedModifiers;
            }
        }
    });
};
