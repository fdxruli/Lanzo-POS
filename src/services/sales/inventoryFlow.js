import { getAvailableStock, getCommittedStock, normalizeStock } from '../db/utils';
import { withUnifiedTimestamp, parseDateStrict, isBatchExpiredForSale } from '../../utils/dateUtils';
import {
    buildIngredientRequirementsForItem,
    getRealProductId,
    hasProductRecipe as hasRecipe,
    shouldTrackInventoryForItem
} from './inventoryRequirements';

const TABLE_RESERVATION_SOURCE = 'table';
const EPSILON = 0.00001;

const isTableReservation = (item) => item?.inventoryReservation?.source === TABLE_RESERVATION_SOURCE;

const getProductMap = async ({ itemsToProcess, allProducts = [], db, STORES }) => {
    const productMap = new Map((allProducts || []).map((product) => [product.id, product]));

    const orderProductIds = new Set(itemsToProcess.map((item) => getRealProductId(item)).filter(Boolean));
    const missingOrderIds = Array.from(orderProductIds).filter((id) => !productMap.has(id));

    if (missingOrderIds.length > 0) {
        const loadedProducts = await db.table(STORES.MENU).bulkGet(missingOrderIds);
        loadedProducts.filter(Boolean).forEach((product) => productMap.set(product.id, product));
    }

    const ingredientIds = new Set();
    itemsToProcess.forEach((item) => {
        const product = productMap.get(getRealProductId(item));
        if (!product) return;

        const { requirements } = buildIngredientRequirementsForItem(item, product);
        requirements.forEach((requirement) => {
            if (requirement?.targetId) ingredientIds.add(requirement.targetId);
        });

        const committedComponents = Array.isArray(item?.inventoryReservation?.committedComponents)
            ? item.inventoryReservation.committedComponents
            : [];
        committedComponents.forEach((component) => {
            const targetId = component?.ingredientId || component?.productId;
            if (targetId) ingredientIds.add(targetId);
        });
    });

    const missingIngredientIds = Array.from(ingredientIds).filter((id) => !productMap.has(id));
    if (missingIngredientIds.length > 0) {
        const loadedIngredients = await db.table(STORES.MENU).bulkGet(missingIngredientIds);
        loadedIngredients.filter(Boolean).forEach((product) => productMap.set(product.id, product));
    }

    return productMap;
};

export const getSortedBatchesForProduct = (batches = [], product) => {
    const mode = product?.expirationMode || 'NONE';
    const isFEFO = mode === 'STRICT' || mode === 'SHELF_LIFE';

    const batchesCopy = batches.map(b => ({ ...b }));

    return batchesCopy.sort((left, right) => {
        if (isFEFO) {
            const leftExpMs = left._expMs || (left._expMs = parseDateStrict(left?.alertTargetDate || left?.expiryDate)?.getTime() || 0);
            const rightExpMs = right._expMs || (right._expMs = parseDateStrict(right?.alertTargetDate || right?.expiryDate)?.getTime() || 0);

            if (leftExpMs && rightExpMs && leftExpMs !== rightExpMs) {
                return leftExpMs - rightExpMs;
            }

            if (leftExpMs || rightExpMs) {
                return leftExpMs ? -1 : 1;
            }
        }

        const leftCrtMs = left._crtMs || (left._crtMs = parseDateStrict(left?.createdAt)?.getTime() || 0);
        const rightCrtMs = right._crtMs || (right._crtMs = parseDateStrict(right?.createdAt)?.getTime() || 0);
        return leftCrtMs - rightCrtMs;
    });
};

const assertProductExists = (product, orderItem) => {
    if (!product) {
        throw new Error(
            `INTEGRITY_CRITICAL: El producto "${orderItem?.name || 'Desconocido'}" ya no existe en el catálogo.`
        );
    }
};

const assertPositiveQuantity = (quantity, contextMessage) => {
    if (!Number.isFinite(quantity) || quantity < 0) {
        throw new Error(`INVENTORY_CRITICAL: Cantidad inválida detectada. ${contextMessage}`);
    }
};

const createExpiryBlockedError = ({
    product,
    requestedQuantity,
    availableQuantity = 0,
    expiredAvailableQuantity = 0,
    batchId = null,
    expiryDate = null
} = {}) => {
    const error = new Error('No hay stock vigente suficiente para completar la venta. Revisa los lotes vencidos en Caducidad/Merma.');
    error.code = 'EXPIRED_BATCH_BLOCKED';
    error.errorType = 'EXPIRED_BATCH_BLOCKED';
    error.metadata = {
        productId: product?.id,
        productName: product?.name,
        batchId,
        expiryDate,
        requestedQuantity,
        availableQuantity,
        expiredAvailableQuantity,
        source: 'inventoryFlow'
    };
    return error;
};

const isBatchActiveForSale = (batch) => batch?.isActive !== false && batch?.status !== 'inactive';

const getBatchAvailableForSale = (batch) => (
    isBatchActiveForSale(batch) ? getAvailableStock(batch) : 0
);

const filterBatchesEligibleForSale = (batches = [], product, { enforceExpiryStrict = true, now = new Date() } = {}) => {
    const activeWithStock = (batches || []).filter((batch) => getBatchAvailableForSale(batch) > 0);

    if (!enforceExpiryStrict) return activeWithStock;

    return activeWithStock.filter((batch) => !isBatchExpiredForSale(batch, product, now));
};

const sumAvailable = (batches = []) => normalizeStock(
    (batches || []).reduce((sum, batch) => sum + getBatchAvailableForSale(batch), 0)
);

const sumExpiredStrictAvailable = (batches = [], product, now) => normalizeStock(
    (batches || [])
        .filter((batch) => isBatchExpiredForSale(batch, product, now))
        .reduce((sum, batch) => sum + getBatchAvailableForSale(batch), 0)
);

const createInventoryReservation = (
    orderItem,
    quantityToDeduct,
    committedBatches,
    committedComponents,
    unifiedTimestamp
) => ({
    source: TABLE_RESERVATION_SOURCE,
    committedQuantity: normalizeStock(quantityToDeduct),
    committedBatches: committedBatches.map((batch) => ({
        batchId: batch.batchId,
        ingredientId: batch.ingredientId,
        quantity: normalizeStock(batch.quantity),
        cost: Number(batch.cost) || 0,
        expiryDate: batch.expiryDate || null,
        batchSku: batch.batchSku || null
    })),
    committedComponents: committedComponents.map((component) => ({
        ingredientId: component.ingredientId,
        quantity: normalizeStock(component.quantity),
        cost: Number(component.cost) || 0
    })),
    committedAt: unifiedTimestamp,
    ...(orderItem?.inventoryReservation?.reservationId
        ? { reservationId: orderItem.inventoryReservation.reservationId }
        : {})
});

const syncParentCommittedStockFromBatches = async ({
    productIds,
    db,
    STORES,
    productMap,
    batchesByProduct,
    unifiedTimestamp
}) => {
    for (const productId of productIds) {
        const product = productMap.get(productId) || await db.table(STORES.MENU).get(productId);
        if (!product) {
            throw new Error(`CRITICAL_PRODUCT_NOT_FOUND: No existe el producto padre ${productId}.`);
        }

        const batches = batchesByProduct.get(productId)
            || await db.table(STORES.PRODUCT_BATCHES).where('productId').equals(productId).toArray();

        const committedStock = normalizeStock(
            (batches || []).reduce((sum, batch) => sum + getCommittedStock(batch), 0)
        );

        const updatedProduct = {
            ...product,
            committedStock,
            updatedAt: unifiedTimestamp || new Date().toISOString()
        };

        productMap.set(productId, updatedProduct);
        await db.table(STORES.MENU).put(updatedProduct);
    }
};

const getOrLoadProductBatches = async ({ productId, db, STORES, batchesByProduct, productMap }) => {
    if (batchesByProduct.has(productId)) {
        return batchesByProduct.get(productId);
    }

    const product = productMap.get(productId);
    const batches = await db.table(STORES.PRODUCT_BATCHES).where('productId').equals(productId).toArray();
    const sortedBatches = getSortedBatchesForProduct(batches, product);
    batchesByProduct.set(productId, sortedBatches);
    return sortedBatches;
};

export const loadRelevantBatches = async ({
    itemsToProcess,
    allProducts,
    queryBatchesByProductIdAndActive,
    queryByIndex,
    STORES,
    enforceExpiryStrict = true,
    now = new Date()
}) => {
    const productMap = new Map((allProducts || []).map((product) => [product.id, product]));
    const uniqueProductIds = new Set();

    for (const orderItem of itemsToProcess) {
        if (isTableReservation(orderItem)) continue;

        const realProductId = getRealProductId(orderItem);
        const product = productMap.get(realProductId);

        assertProductExists(product, orderItem);

        const { requirements } = buildIngredientRequirementsForItem(orderItem, product);
        requirements.forEach((component) => {
            if (component?.targetId) uniqueProductIds.add(component.targetId);
        });
    }

    const batchesMap = new Map();
    if (uniqueProductIds.size === 0) {
        return batchesMap;
    }

    await Promise.all(
        Array.from(uniqueProductIds).map(async (productId) => {
            const product = productMap.get(productId);
            let batches = await queryBatchesByProductIdAndActive(productId, true);

            if (!batches || batches.length === 0) {
                const allBatches = await queryByIndex(STORES.PRODUCT_BATCHES, 'productId', productId);
                batches = (allBatches || []).filter((batch) => batch?.isActive);
            }

            const availableBatches = filterBatchesEligibleForSale(batches, product, { enforceExpiryStrict, now });
            if (availableBatches.length > 0) {
                batchesMap.set(productId, getSortedBatchesForProduct(availableBatches, product));
            } else if ((batches || []).length > 0) {
                batchesMap.set(productId, []);
            }
        })
    );

    return batchesMap;
};

export const buildProcessedItemsAndDeductions = ({
    itemsToProcess,
    allProducts,
    batchesMap,
    roundCurrency,
    enforceExpiryStrict = true,
    now = new Date()
}) => {
    const productMap = new Map((allProducts || []).map((product) => [product.id, product]));
    const batchesToDeduct = [];
    const processedItems = [];
    const virtualConsumptionTracker = new Map();

    for (const orderItem of itemsToProcess) {
        const realProductId = getRealProductId(orderItem);
        const product = productMap.get(realProductId);

        assertProductExists(product, orderItem);

        const { quantityToDeduct, requirements } = buildIngredientRequirementsForItem(orderItem, product);

        if (isTableReservation(orderItem)) {
            const committedReservation = orderItem.inventoryReservation;
            const committedBatches = Array.isArray(committedReservation?.committedBatches)
                ? committedReservation.committedBatches
                : [];
            const committedComponents = Array.isArray(committedReservation?.committedComponents)
                ? committedReservation.committedComponents
                : [];
            const itemBatchesUsed = [];
            const itemComponentsUsed = [];
            let itemTotalCost = 0;

            for (const batchUsage of committedBatches) {
                const targetProduct = productMap.get(batchUsage.ingredientId) || product;
                if (enforceExpiryStrict && batchUsage.expiryDate && isBatchExpiredForSale({ expiryDate: batchUsage.expiryDate }, targetProduct, now)) {
                    throw createExpiryBlockedError({
                        product: targetProduct,
                        requestedQuantity: batchUsage.quantity,
                        expiredAvailableQuantity: batchUsage.quantity,
                        batchId: batchUsage.batchId,
                        expiryDate: batchUsage.expiryDate
                    });
                }

                const normalizedQty = normalizeStock(batchUsage.quantity);
                batchesToDeduct.push({
                    batchId: batchUsage.batchId,
                    quantity: normalizedQty,
                    productId: batchUsage.ingredientId,
                    fromCommittedStock: true
                });

                itemBatchesUsed.push({
                    batchId: batchUsage.batchId,
                    ingredientId: batchUsage.ingredientId,
                    quantity: normalizedQty,
                    cost: batchUsage.cost,
                    expiryDate: batchUsage.expiryDate || null,
                    batchSku: batchUsage.batchSku || null
                });

                itemTotalCost += roundCurrency((Number(batchUsage.cost) || 0) * normalizedQty);
            }

            for (const componentUsage of committedComponents) {
                const targetId = componentUsage.ingredientId || componentUsage.productId;
                const normalizedQty = normalizeStock(componentUsage.quantity);
                if (!targetId || normalizedQty <= 0) continue;

                const componentCost = Number(componentUsage.cost) || 0;
                itemComponentsUsed.push({
                    ingredientId: targetId,
                    quantity: normalizedQty,
                    cost: componentCost,
                    fromCommittedStock: true
                });

                itemTotalCost += roundCurrency(componentCost * normalizedQty);
            }

            if (committedBatches.length === 0 && committedComponents.length === 0) {
                const authoritativeCost = parseFloat(product.cost) || 0;
                itemTotalCost = roundCurrency(authoritativeCost * quantityToDeduct);
            }

            const calculatedAvgCost = orderItem.quantity > 0
                ? roundCurrency(itemTotalCost / orderItem.quantity)
                : 0;

            processedItems.push({
                ...orderItem,
                image: null,
                base64: null,
                cost: calculatedAvgCost,
                batchesUsed: itemBatchesUsed,
                inventoryComponentsUsed: itemComponentsUsed,
                stockDeducted: normalizeStock(committedReservation?.committedQuantity ?? quantityToDeduct)
            });
            continue;
        }

        if (requirements.length === 0) {
            processedItems.push({
                ...orderItem,
                image: null,
                base64: null,
                cost: parseFloat(product.cost) || 0,
                batchesUsed: [],
                inventoryComponentsUsed: [],
                stockDeducted: 0
            });
            continue;
        }

        let itemTotalCost = 0;
        const itemBatchesUsed = [];
        const itemComponentsUsed = [];

        for (const component of requirements) {
            let requiredQty = normalizeStock(component.neededQty);
            const targetId = component.targetId;
            const targetProduct = productMap.get(targetId);
            const rawBatches = batchesMap.get(targetId) || [];
            const batches = filterBatchesEligibleForSale(rawBatches, targetProduct, { enforceExpiryStrict, now });
            const requiredStart = requiredQty;

            if (targetProduct?.batchManagement?.enabled) {
                for (const batch of batches) {
                    if (requiredQty <= 0) break;

                    const alreadyConsumed = virtualConsumptionTracker.get(batch.id) || 0;
                    const virtualAvailableStock = normalizeStock(getAvailableStock(batch) - alreadyConsumed);

                    if (virtualAvailableStock <= 0) continue;

                    const toDeduct = normalizeStock(Math.min(requiredQty, virtualAvailableStock));

                    batchesToDeduct.push({
                        batchId: batch.id,
                        quantity: toDeduct,
                        productId: targetId,
                        fromCommittedStock: false
                    });

                    virtualConsumptionTracker.set(batch.id, normalizeStock(alreadyConsumed + toDeduct));

                    itemBatchesUsed.push({
                        batchId: batch.id,
                        ingredientId: targetId,
                        quantity: toDeduct,
                        cost: batch.cost,
                        expiryDate: batch.expiryDate || null,
                        batchSku: batch.sku || null
                    });

                    itemTotalCost += roundCurrency((Number(batch.cost) || 0) * toDeduct);
                    requiredQty = normalizeStock(requiredQty - toDeduct);
                }

                if (requiredQty > EPSILON) {
                    const expiredAvailableQuantity = sumExpiredStrictAvailable(rawBatches, targetProduct, now);
                    if (enforceExpiryStrict && expiredAvailableQuantity > 0) {
                        throw createExpiryBlockedError({
                            product: targetProduct,
                            requestedQuantity: requiredStart,
                            availableQuantity: sumAvailable(batches),
                            expiredAvailableQuantity
                        });
                    }

                    throw new Error(
                        `CRITICAL_STOCK_COMMIT_FAILED: Stock disponible insuficiente para ${targetProduct?.name || targetId}. ` +
                        `Disponible ${sumAvailable(batches)}, requerido ${requiredStart}.`
                    );
                }

                continue;
            }

            if (targetProduct?.trackStock !== false) {
                const componentQty = normalizeStock(requiredQty);
                const componentCost = Number(targetProduct?.cost) || 0;

                itemComponentsUsed.push({
                    ingredientId: targetId,
                    quantity: componentQty,
                    cost: componentCost,
                    fromCommittedStock: false
                });

                itemTotalCost += roundCurrency(componentCost * componentQty);
                continue;
            }

            if (requiredQty > 0) {
                itemTotalCost += roundCurrency((parseFloat(targetProduct?.cost) || 0) * requiredQty);
            }
        }

        const calculatedAvgCost = orderItem.quantity > 0
            ? roundCurrency(itemTotalCost / orderItem.quantity)
            : 0;

        processedItems.push({
            ...orderItem,
            image: null,
            base64: null,
            cost: calculatedAvgCost,
            batchesUsed: itemBatchesUsed,
            inventoryComponentsUsed: itemComponentsUsed,
            stockDeducted: quantityToDeduct
        });
    }

    return { processedItems, batchesToDeduct };
};

export const commitStock = async (items, deps = {}) => {
    const itemsToProcess = Array.isArray(items) ? items : [];
    if (itemsToProcess.length === 0) return [];

    const {
        db,
        STORES,
        allProducts = [],
        enforceExpiryStrict = true,
        now = new Date()
    } = deps;

    if (!db || !STORES?.MENU || !STORES?.PRODUCT_BATCHES) {
        throw new Error('INVENTORY_CRITICAL: commitStock requiere db, STORES.MENU y STORES.PRODUCT_BATCHES.');
    }

    const productMap = await getProductMap({ itemsToProcess, allProducts, db, STORES });
    const batchesByProduct = new Map();
    const updatedProducts = new Map();
    const updatedBatches = new Map();
    const batchManagedProductIds = new Set();

    return await withUnifiedTimestamp(async (unifiedTimestamp) => {
        return await db.transaction('rw', [db.table(STORES.MENU), db.table(STORES.PRODUCT_BATCHES)], async () => {
            const reservedItems = [];

            for (const orderItem of itemsToProcess) {
                const product = productMap.get(getRealProductId(orderItem));
                assertProductExists(product, orderItem);

                if (!shouldTrackInventoryForItem(orderItem, product)) {
                    reservedItems.push(orderItem);
                    continue;
                }

                const { quantityToDeduct, requirements } = buildIngredientRequirementsForItem(orderItem, product);
                const committedBatches = [];
                const committedComponents = [];

                for (const component of requirements) {
                    const componentProduct = productMap.get(component.targetId)
                        || await db.table(STORES.MENU).get(component.targetId);

                    if (!componentProduct) {
                        throw new Error(`CRITICAL_PRODUCT_NOT_FOUND: No existe el producto ${component.targetId}.`);
                    }

                    if (componentProduct.batchManagement?.enabled) {
                        const productBatches = await getOrLoadProductBatches({
                            productId: component.targetId,
                            db,
                            STORES,
                            batchesByProduct,
                            productMap
                        });

                        let pendingQty = normalizeStock(component.neededQty);
                        const eligibleBatches = filterBatchesEligibleForSale(productBatches, componentProduct, { enforceExpiryStrict, now });

                        for (const batch of eligibleBatches) {
                            if (pendingQty <= 0) break;

                            const availableStock = getAvailableStock(batch);
                            if (availableStock <= 0 || batch?.isActive === false) continue;

                            const commitQty = normalizeStock(Math.min(pendingQty, availableStock));
                            assertPositiveQuantity(commitQty, `Reserva sobre lote ${batch.id}.`);

                            batch.committedStock = normalizeStock(getCommittedStock(batch) + commitQty);
                            batch.updatedAt = unifiedTimestamp;
                            updatedBatches.set(batch.id, batch);

                            committedBatches.push({
                                batchId: batch.id,
                                ingredientId: component.targetId,
                                quantity: commitQty,
                                cost: Number(batch.cost) || 0,
                                expiryDate: batch.expiryDate || null,
                                batchSku: batch.sku || null
                            });

                            batchManagedProductIds.add(component.targetId);
                            pendingQty = normalizeStock(pendingQty - commitQty);
                        }

                        if (pendingQty > EPSILON) {
                            const expiredAvailableQuantity = sumExpiredStrictAvailable(productBatches, componentProduct, now);
                            if (enforceExpiryStrict && expiredAvailableQuantity > 0) {
                                throw createExpiryBlockedError({
                                    product: componentProduct,
                                    requestedQuantity: component.neededQty,
                                    availableQuantity: sumAvailable(eligibleBatches),
                                    expiredAvailableQuantity
                                });
                            }

                            throw new Error(
                                `CRITICAL_STOCK_COMMIT_FAILED: Stock disponible insuficiente para ${componentProduct.name}. ` +
                                `Disponible ${sumAvailable(eligibleBatches)}, requerido ${component.neededQty}.`
                            );
                        }
                    } else if (componentProduct.trackStock !== false) {
                        const productState = updatedProducts.get(component.targetId)
                            || productMap.get(component.targetId)
                            || await db.table(STORES.MENU).get(component.targetId);

                        if (!productState) {
                            throw new Error(`CRITICAL_PRODUCT_NOT_FOUND: No existe el producto ${component.targetId}.`);
                        }

                        const neededQty = normalizeStock(component.neededQty);
                        const availableStock = getAvailableStock(productState);
                        if (availableStock < neededQty) {
                            throw new Error(
                                `CRITICAL_STOCK_COMMIT_FAILED: Stock disponible insuficiente para ${productState.name}. ` +
                                `Disponible ${availableStock}, requerido ${neededQty}.`
                            );
                        }

                        productState.committedStock = normalizeStock(getCommittedStock(productState) + neededQty);
                        productState.updatedAt = unifiedTimestamp;

                        committedComponents.push({
                            ingredientId: component.targetId,
                            quantity: neededQty,
                            cost: Number(productState.cost) || 0
                        });

                        updatedProducts.set(component.targetId, productState);
                        productMap.set(component.targetId, productState);
                    }
                }

                reservedItems.push({
                    ...orderItem,
                    inventoryReservation: createInventoryReservation(
                        orderItem,
                        quantityToDeduct,
                        committedBatches,
                        committedComponents,
                        unifiedTimestamp
                    )
                });
            }

            if (updatedProducts.size > 0) {
                await db.table(STORES.MENU).bulkPut(Array.from(updatedProducts.values()));
            }

            if (updatedBatches.size > 0) {
                await db.table(STORES.PRODUCT_BATCHES).bulkPut(Array.from(updatedBatches.values()));
            }

            if (batchManagedProductIds.size > 0) {
                await syncParentCommittedStockFromBatches({
                    productIds: batchManagedProductIds,
                    db,
                    STORES,
                    productMap,
                    batchesByProduct,
                    unifiedTimestamp
                });
            }

            return reservedItems;
        });
    });
};

export const releaseCommittedStock = async (items, deps = {}) => {
    const itemsToProcess = Array.isArray(items) ? items : [];
    if (itemsToProcess.length === 0) return { success: true };

    const { db, STORES, allProducts = [] } = deps;
    if (!db || !STORES?.MENU || !STORES?.PRODUCT_BATCHES) {
        throw new Error('INVENTORY_CRITICAL: releaseCommittedStock requiere db, STORES.MENU y STORES.PRODUCT_BATCHES.');
    }

    const productMap = await getProductMap({ itemsToProcess, allProducts, db, STORES });
    const batchesByProduct = new Map();
    const batchManagedProductIds = new Set();
    const updatedProducts = new Map();
    const updatedBatches = new Map();

    return await withUnifiedTimestamp(async (unifiedTimestamp) => {
        await db.transaction('rw', [db.table(STORES.MENU), db.table(STORES.PRODUCT_BATCHES)], async () => {
            const batchIdsToLoad = new Set();
            for (const orderItem of itemsToProcess) {
                if (!isTableReservation(orderItem)) continue;
                const committedReservation = orderItem.inventoryReservation;
                const committedBatches = Array.isArray(committedReservation?.committedBatches) ? committedReservation.committedBatches : [];
                committedBatches.forEach(b => batchIdsToLoad.add(b.batchId));
            }

            const loadedBatches = batchIdsToLoad.size > 0
                ? await db.table(STORES.PRODUCT_BATCHES).bulkGet(Array.from(batchIdsToLoad))
                : [];
            const batchMap = new Map(loadedBatches.filter(Boolean).map(b => [b.id, b]));

            for (const orderItem of itemsToProcess) {
                if (!isTableReservation(orderItem)) continue;

                const product = productMap.get(getRealProductId(orderItem));
                assertProductExists(product, orderItem);

                const committedReservation = orderItem.inventoryReservation;
                const committedBatches = Array.isArray(committedReservation?.committedBatches)
                    ? committedReservation.committedBatches
                    : [];
                const committedComponents = Array.isArray(committedReservation?.committedComponents)
                    ? committedReservation.committedComponents
                    : [];

                if (committedBatches.length > 0) {
                    for (const batchUsage of committedBatches) {
                        const batch = batchMap.get(batchUsage.batchId);
                        if (!batch) {
                            throw new Error(`CRITICAL_BATCH_NOT_FOUND: No existe el lote ${batchUsage.batchId}.`);
                        }

                        const committedStock = getCommittedStock(batch);
                        const quantityToRelease = normalizeStock(batchUsage.quantity);

                        if (committedStock < quantityToRelease) {
                            console.warn(`[INVENTORY_SYNC_FIX]: El lote ${batch.id} intentó liberar ${quantityToRelease} pero solo tenía ${committedStock}. Se ajustó a 0.`);
                        }
                        batch.committedStock = normalizeStock(Math.max(0, committedStock - quantityToRelease));
                        batch.updatedAt = unifiedTimestamp;
                        updatedBatches.set(batch.id, batch);

                        batchManagedProductIds.add(batch.productId);
                    }
                }

                if (committedComponents.length > 0) {
                    for (const componentUsage of committedComponents) {
                        const componentId = componentUsage.ingredientId || componentUsage.productId;
                        const quantityToRelease = normalizeStock(componentUsage.quantity);
                        if (!componentId || quantityToRelease <= 0) continue;

                        const currentProduct = updatedProducts.get(componentId)
                            || productMap.get(componentId)
                            || await db.table(STORES.MENU).get(componentId);

                        if (!currentProduct) {
                            throw new Error(`CRITICAL_PRODUCT_NOT_FOUND: No existe el producto ${componentId}.`);
                        }

                        const currentCommitted = getCommittedStock(currentProduct);
                        if (currentCommitted < quantityToRelease) {
                            throw new Error(
                                `CRITICAL_COMMITTED_UNDERFLOW: El producto ${currentProduct.name} intenta liberar ${quantityToRelease}, ` +
                                `pero solo tiene ${currentCommitted} comprometido.`
                            );
                        }

                        currentProduct.committedStock = normalizeStock(currentCommitted - quantityToRelease);
                        currentProduct.updatedAt = unifiedTimestamp;

                        updatedProducts.set(currentProduct.id, currentProduct);
                        productMap.set(currentProduct.id, currentProduct);
                    }

                    continue;
                }

                if (committedBatches.length > 0) {
                    continue;
                }

                const committedQuantity = normalizeStock(committedReservation?.committedQuantity || 0);
                if (committedQuantity <= 0 || product.trackStock === false) continue;

                const currentProduct = updatedProducts.get(product.id)
                    || productMap.get(product.id)
                    || await db.table(STORES.MENU).get(product.id);

                if (!currentProduct) {
                    throw new Error(`CRITICAL_PRODUCT_NOT_FOUND: No existe el producto ${product.id}.`);
                }

                const currentCommitted = getCommittedStock(currentProduct);
                if (currentCommitted < committedQuantity) {
                    throw new Error(
                        `CRITICAL_COMMITTED_UNDERFLOW: El producto ${currentProduct.name} intenta liberar ${committedQuantity}, ` +
                        `pero solo tiene ${currentCommitted} comprometido.`
                    );
                }

                currentProduct.committedStock = normalizeStock(currentCommitted - committedQuantity);
                currentProduct.updatedAt = unifiedTimestamp;

                updatedProducts.set(currentProduct.id, currentProduct);
                productMap.set(currentProduct.id, currentProduct);
            }

            if (updatedProducts.size > 0) {
                await db.table(STORES.MENU).bulkPut(Array.from(updatedProducts.values()));
            }

            if (updatedBatches.size > 0) {
                await db.table(STORES.PRODUCT_BATCHES).bulkPut(Array.from(updatedBatches.values()));
            }

            if (batchManagedProductIds.size > 0) {
                await syncParentCommittedStockFromBatches({
                    productIds: batchManagedProductIds,
                    db,
                    STORES,
                    productMap,
                    batchesByProduct,
                    unifiedTimestamp
                });
            }
        });

        return { success: true };
    });
};
