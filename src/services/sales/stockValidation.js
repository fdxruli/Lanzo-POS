// services/sales/stockValidation.js
// ✅ Incluye Timeout de Seguridad (DB Protection)
// ✅ Mantiene detección de ingredientes eliminados

// Helper interno para manejar el Timeout sin romper la inyección de dependencias
const loadWithTimeout = (loadFn, store, id, timeoutMs = 5000) => {
    return Promise.race([
        loadFn(store, id),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`DB_TIMEOUT: La lectura del ID ${id} excedió los ${timeoutMs}ms`)), timeoutMs)
        )
    ]);
};

export const validateStockBeforeSale = async ({
    itemsToProcess,
    productMap,
    features,
    ignoreStock,
    loadData, // <--- Usaremos esta instancia inyectada
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

    // 🔥 CARGA DE STOCK FRESCO (CON TIMEOUT Y PARALELISMO)
    // Protege contra congelamientos si la BD tarda en responder
    const freshStockMap = new Map();

    if (uniqueIngredientIds.size > 0) {
        try {
            await Promise.all(Array.from(uniqueIngredientIds).map(async (id) => {
                // 👇 AQUI APLICAMOS EL TIMEOUT USANDO LA FUNCIÓN INYECTADA
                const freshProd = await loadWithTimeout(loadData, STORES.MENU, id);

                if (freshProd) {
                    freshStockMap.set(id, freshProd);
                }
            }));
        } catch (error) {
            // Si hay timeout, devolvemos error controlado para no colgar el POS
            if (error.message.includes('DB_TIMEOUT')) {
                return {
                    ok: false,
                    response: {
                        success: false,
                        errorType: 'DB_TIMEOUT',
                        message: '⚠️ El sistema está tardando en verificar el inventario. Inténtalo de nuevo.'
                    }
                };
            }
            throw error; // Otros errores siguen su curso normal
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