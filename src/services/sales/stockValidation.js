import { getAvailableStock } from '../db/utils';
import {
    buildIngredientRequirementsForItem,
    getRealProductId
} from './inventoryRequirements';

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

const getBatchManagedAvailable = (productId, batchesByProduct, simulatedBatchStock) => {
    const batches = batchesByProduct.get(productId) || [];
    return batches.reduce((sum, batch) => sum + (simulatedBatchStock.get(batch.id) || 0), 0);
};

const consumeBatchManagedStock = (productId, qty, batchesByProduct, simulatedBatchStock) => {
    const batches = batchesByProduct.get(productId) || [];
    let pendingQty = qty;

    for (const batch of batches) {
        if (pendingQty <= 0) break;

        const batchAvailable = simulatedBatchStock.get(batch.id) || 0;
        if (batchAvailable <= 0) continue;

        const consumed = Math.min(pendingQty, batchAvailable);
        simulatedBatchStock.set(batch.id, batchAvailable - consumed);
        pendingQty -= consumed;
    }

    return getBatchManagedAvailable(productId, batchesByProduct, simulatedBatchStock);
};

export const validateStockBeforeSale = async ({
    itemsToProcess,
    productMap,
    ignoreStock,
    loadData,
    loadMultipleData,
    queryBatchesByProductIdAndActive,
    STORES
}) => {
    if (ignoreStock) {
        return { ok: true };
    }

    const requirementsByItem = new Map();
    const uniqueStockIds = new Set();

    itemsToProcess.forEach((item, index) => {
        const productDef = productMap.get(getRealProductId(item));
        const { requirements } = buildIngredientRequirementsForItem(item, productDef);
        const itemRequirements = new Map(
            requirements.map(({ targetId, neededQty }) => [targetId, neededQty])
        );

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

    const missingIngredients = [];
    const simulatedStock = new Map();
    const simulatedBatchStock = new Map();

    freshStockMap.forEach((product, id) => {
        if (product?.batchManagement?.enabled) {
            const batches = batchesByProduct.get(id) || [];
            batches.forEach((batch) => {
                simulatedBatchStock.set(batch.id, getAvailableStock(batch));
            });
            simulatedStock.set(id, getBatchManagedAvailable(id, batchesByProduct, simulatedBatchStock));
        } else {
            simulatedStock.set(id, getAvailableStock(product));
        }
    });

    for (const [index, item] of itemsToProcess.entries()) {
        const productDef = productMap.get(getRealProductId(item));
        const itemRequirements = requirementsByItem.get(index) || new Map();

        for (const [reqId, reqQty] of itemRequirements.entries()) {
            const realStockData = freshStockMap.get(reqId);

            if (!realStockData) {
                missingIngredients.push({
                    productName: productDef?.name || 'Producto Desconocido',
                    ingredientName: `ERROR CRITICO: Producto/ingrediente ID ${reqId} eliminado`,
                    needed: reqQty,
                    available: 0,
                    unit: ''
                });
                continue;
            }

            if (!simulatedStock.has(reqId)) continue;

            const currentAvailable = realStockData.batchManagement?.enabled
                ? getBatchManagedAvailable(reqId, batchesByProduct, simulatedBatchStock)
                : simulatedStock.get(reqId);

            if (currentAvailable < reqQty) {
                const alreadyListed = missingIngredients.some((m) => m.ingredientName === realStockData.name);

                if (!alreadyListed) {
                    missingIngredients.push({
                        productName: 'Pedido (Acumulado)',
                        ingredientName: realStockData.name,
                        needed: reqQty,
                        available: currentAvailable,
                        unit: realStockData.bulkData?.purchase?.unit || 'u'
                    });
                }
            } else if (realStockData.batchManagement?.enabled) {
                const remainingStock = consumeBatchManagedStock(
                    reqId,
                    reqQty,
                    batchesByProduct,
                    simulatedBatchStock
                );
                simulatedStock.set(reqId, remainingStock);
            } else {
                simulatedStock.set(reqId, currentAvailable - reqQty);
            }
        }
    }

    if (missingIngredients.length > 0) {
        const details = missingIngredients.map((m) =>
            `- ${m.ingredientName}: Tienes ${m.available.toFixed(2)} ${m.unit} (Necesitas ${m.needed.toFixed(2)})`
        ).join('\n');

        return {
            ok: false,
            response: {
                success: false,
                errorType: 'STOCK_WARNING',
                message: `STOCK INSUFICIENTE:\n\n${details}\n\nEl pedido supera lo disponible.`,
                missingData: missingIngredients
            }
        };
    }

    return { ok: true };
};
