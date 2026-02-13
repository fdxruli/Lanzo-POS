import { FLOAT_EPSILON } from './constants';

export const loadRelevantBatches = async ({
    itemsToProcess,
    allProducts,
    queryBatchesByProductIdAndActive,
    queryByIndex,
    STORES
}) => {
    const uniqueProductIds = new Set();

    for (const orderItem of itemsToProcess) {
        const realProductId = orderItem.parentId || orderItem.id;
        const product = allProducts.find(p => p.id === realProductId);

        // ✅ MEJORA: Validación de Integridad (Hard Stop)
        if (!product) {
            // Lanzamos error para que processSaleCore lo capture y detenga la venta
            throw new Error(`El producto "${orderItem.name || 'Desconocido'}" ya no existe en el catálogo. Por favor, elimínalo del carrito.`);
        }

        const hasRecipe = product.recipe && product.recipe.length > 0;
        const isTracked = product.trackStock;

        // Si existe pero no requiere inventario, lo saltamos (correcto)
        if (!isTracked && !hasRecipe) continue;

        if (hasRecipe) {
            product.recipe.forEach(component => {
                if (component.ingredientId) {
                    uniqueProductIds.add(component.ingredientId);
                }
            });

            if (orderItem.modifiers && Array.isArray(orderItem.modifiers)) {
                orderItem.modifiers.forEach(mod => {
                    if (mod.ingredientId) uniqueProductIds.add(mod.ingredientId);
                });
            }
        } else {
            uniqueProductIds.add(realProductId);
        }
    }

    // ... resto de la función igual ...
    const batchesMap = new Map();
    if (uniqueProductIds.size > 0) {
        await Promise.all(
            Array.from(uniqueProductIds).map(async (productId) => {
                let batches = await queryBatchesByProductIdAndActive(productId, true);
                if (!batches || batches.length === 0) {
                    const allBatches = await queryByIndex(STORES.PRODUCT_BATCHES, 'productId', productId);
                    batches = allBatches.filter(b => b.isActive && b.stock > 0);
                }
                if (batches && batches.length > 0) {
                    batches.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
                    batchesMap.set(productId, structuredClone(batches));
                }
            })
        );
    }

    return batchesMap;
};

export const buildProcessedItemsAndDeductions = ({
    itemsToProcess,
    allProducts,
    batchesMap,
    roundCurrency
}) => {
    const batchesToDeduct = [];
    const processedItems = [];

    for (const orderItem of itemsToProcess) {
        const realProductId = orderItem.parentId || orderItem.id;
        const product = allProducts.find(p => p.id === realProductId);

        // ✅ MEJORA: Segunda capa de seguridad
        if (!product) {
            throw new Error(`Error crítico: El producto "${orderItem.name}" no se encuentra en la base de datos.`);
        }

        const hasRecipe = product.recipe && product.recipe.length > 0;

        let quantityToDeduct = orderItem.quantity;
        // Como ya validamos que 'product' existe, podemos acceder a sus propiedades con seguridad
        if (product.conversionFactor?.enabled) {
            const factor = parseFloat(product.conversionFactor.factor);
            if (!isNaN(factor) && factor > 1) {
                quantityToDeduct = orderItem.quantity / factor;
            } else if (factor > 0 && factor <= 1) {
                quantityToDeduct = orderItem.quantity;
            }
        }

        // Modificamos la condición original eliminando el check de !product porque ya lanzamos error arriba
        if (product.trackStock === false && !hasRecipe) {
            const authoritativeCost = (parseFloat(product.cost) || 0);

            processedItems.push({
                ...orderItem,
                image: null,
                base64: null,
                cost: authoritativeCost,
                batchesUsed: [],
                stockDeducted: 0
            });
            continue;
        }

        // ... resto de la lógica de ingredientes y deducción sigue igual ...
        const ingredientsMap = new Map();

        const addIngredientDeduction = (id, qty) => {
            if (!id) return;
            const currentQty = ingredientsMap.get(id) || 0;
            ingredientsMap.set(id, currentQty + qty);
        };

        if (hasRecipe) {
            product.recipe.forEach(ing => {
                if (ing.ingredientId) {
                    addIngredientDeduction(ing.ingredientId, ing.quantity * quantityToDeduct);
                }
            });

            if (orderItem.selectedModifiers && Array.isArray(orderItem.selectedModifiers)) {
                orderItem.selectedModifiers.forEach(mod => {
                    if (mod.ingredientId) {
                        const modQty = (mod.quantity || 1) * quantityToDeduct;
                        addIngredientDeduction(mod.ingredientId, modQty);
                    }
                });
            }
        } else {
            addIngredientDeduction(realProductId, quantityToDeduct);
        }

        const itemsToDeductList = Array.from(ingredientsMap.entries()).map(([targetId, neededQty]) => ({
            targetId,
            neededQty
        }));

        let itemTotalCost = 0;
        const itemBatchesUsed = [];

        for (const component of itemsToDeductList) {
            let requiredQty = component.neededQty;
            const targetId = component.targetId;
            const batches = batchesMap.get(targetId) || [];

            for (const batch of batches) {
                if (requiredQty <= FLOAT_EPSILON) break;
                if (batch.stock <= 0) continue;

                const toDeduct = Math.min(requiredQty, batch.stock);

                batchesToDeduct.push({
                    batchId: batch.id,
                    quantity: toDeduct,
                    productId: targetId
                });

                batch.stock -= toDeduct;

                itemBatchesUsed.push({
                    batchId: batch.id,
                    ingredientId: targetId,
                    quantity: toDeduct,
                    cost: batch.cost
                });

                itemTotalCost += roundCurrency(batch.cost * toDeduct);
                requiredQty -= toDeduct;
            }

            if (requiredQty > FLOAT_EPSILON) {
                const originalProduct = allProducts.find(p => p.id === targetId);
                const fallbackCost = originalProduct?.cost || 0;
                itemTotalCost += (fallbackCost * requiredQty);
            }
        }

        const calculatedAvgCost = orderItem.quantity > 0 ? roundCurrency(itemTotalCost / orderItem.quantity) : 0;

        processedItems.push({
            ...orderItem,
            image: null,
            base64: null,
            cost: calculatedAvgCost,
            batchesUsed: itemBatchesUsed,
            stockDeducted: quantityToDeduct
        });
    }

    return { processedItems, batchesToDeduct };
};