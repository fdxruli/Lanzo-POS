export const validateStockBeforeSale = async ({
    itemsToProcess,
    productMap,
    features,
    ignoreStock,
    loadData,
    loadMultipleData,
    STORES
}) => {
    if (!features.hasRecipes || ignoreStock) {
        return { ok: true };
    }

    const uniqueIngredientIds = new Set();

    itemsToProcess.forEach(item => {
        const realId = item.parentId || item.id;
        const productDef = productMap.get(realId);

        if (productDef?.recipe?.length > 0) {
            productDef.recipe.forEach(ing => {
                if (ing.ingredientId) uniqueIngredientIds.add(ing.ingredientId);
            });
        } else if (productDef?.trackStock) {
            uniqueIngredientIds.add(realId);
        }

        if (Array.isArray(item.selectedModifiers)) {
            item.selectedModifiers.forEach(mod => {
                if (mod.ingredientId) uniqueIngredientIds.add(mod.ingredientId);
            });
        }
    });

    // 🔥 CARGA DE STOCK FRESCO (OPTIMIZADO CON BULK GET Y TIMEOUT ÚNICO)
    const freshStockMap = new Map();
    const idsArray = Array.from(uniqueIngredientIds);

    if (idsArray.length > 0) {
        try {
            // Se asume que ahora inyectas `loadMultipleData` en los parámetros
            const fetchPromise = loadMultipleData(STORES.MENU, idsArray);
            
            // Un solo timeout para toda la operación de lectura masiva
            const results = await Promise.race([
                fetchPromise,
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('DB_TIMEOUT: La lectura masiva excedió el tiempo límite')), 5000)
                )
            ]);

            // Si llegamos aquí, se completó a tiempo.
            // Si la promesa original (fetchPromise) falla después del timeout, 
            // IndexedDB simplemente desechará la transacción de solo lectura, 
            // pero AÚN DEBES añadirle un catch vacío para evitar el unhandled rejection.
            fetchPromise.catch(() => {}); 

            results.forEach((freshProd, index) => {
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
                        message: '⚠️ El sistema está tardando en verificar el inventario. El motor de base de datos está ocupado.'
                    }
                };
            }
            throw error; 
        }
    }

    const missingIngredients = [];
    const simulatedStock = new Map();

    freshStockMap.forEach((product, id) => {
        simulatedStock.set(id, product.stock);
    });

    for (const item of itemsToProcess) {
        const realId = item.parentId || item.id;
        const productDef = productMap.get(realId);

        const itemRequirements = new Map();
        const addRequirement = (id, qty) => {
            if (!id) return;
            itemRequirements.set(id, (itemRequirements.get(id) || 0) + qty);
        };

        // A) Receta Base
        if (productDef?.recipe?.length > 0) {
            productDef.recipe.forEach(ing => {
                addRequirement(ing.ingredientId, ing.quantity * item.quantity);
            });
        }

        // B) Modificadores
        if (Array.isArray(item.selectedModifiers)) {
            item.selectedModifiers.forEach(mod => {
                if (mod.ingredientId) {
                    const modQty = (mod.quantity || 1) * item.quantity;
                    addRequirement(mod.ingredientId, modQty);
                }
            });
        }

        // C) Producto Directo
        if (productDef?.trackStock && (!productDef.recipe || productDef.recipe.length === 0)) {
            addRequirement(realId, item.quantity);
        }

        // --- 🔴 FASE DE VERIFICACIÓN ---
        for (const [reqId, reqQty] of itemRequirements.entries()) {
            const realIngData = freshStockMap.get(reqId);

            if (!realIngData) {
                missingIngredients.push({
                    productName: productDef?.name || 'Producto Desconocido',
                    ingredientName: `⚠️ ERROR CRÍTICO: Ingrediente ID ${reqId} eliminado`,
                    needed: reqQty,
                    available: 0,
                    unit: '❌'
                });
                continue;
            }

            if (!simulatedStock.has(reqId)) continue;

            const currentAvailable = simulatedStock.get(reqId);

            if (currentAvailable < reqQty) {
                const alreadyListed = missingIngredients.some(m => m.ingredientName === realIngData.name);

                if (!alreadyListed) {
                    missingIngredients.push({
                        productName: 'Pedido (Acumulado)',
                        ingredientName: realIngData.name,
                        needed: reqQty,
                        available: realIngData.stock,
                        unit: realIngData.bulkData?.purchase?.unit || 'u'
                    });
                }
            } else {
                simulatedStock.set(reqId, currentAvailable - reqQty);
            }
        }
    }

    if (missingIngredients.length > 0) {
        const details = missingIngredients.map(m =>
            `• ${m.ingredientName}: Tienes ${m.available.toFixed(2)} ${m.unit} (Necesitas ${m.needed.toFixed(2)})`
        ).join('\n');

        return {
            ok: false,
            response: {
                success: false,
                errorType: 'STOCK_WARNING',
                message: `⚠️ STOCK INSUFICIENTE:\n\n${details}\n\nLos ingredientes superan lo disponible.`,
                missingData: missingIngredients
            }
        };
    }

    return { ok: true };
};