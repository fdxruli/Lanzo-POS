import {
    loadData,
    saveData,
    STORES,
    queryBatchesByProductIdAndActive,
    queryByIndex,
    executeSaleTransactionSafe
} from './database';
import { useStatsStore } from '../store/useStatsStore';
import { roundCurrency, sendWhatsAppMessage } from './utils';

const validateRecipeStock = (orderItems, allProducts) => {
    const missingIngredients = [];

    for (const item of orderItems) {
        // Obtenemos el producto padre (por si es una variante)
        const realId = item.parentId || item.id;
        const product = allProducts.find(p => p.id === realId);

        // --- CORRECCIÓN AQUÍ ---
        // Eliminamos 'product.trackStock' de la condición.
        // Ahora validamos siempre que exista una receta, sin importar si el platillo lleva stock o no.
        if (product && product.recipe && product.recipe.length > 0) {

            // Recorremos la receta del producto
            for (const ing of product.recipe) {
                const ingredientProd = allProducts.find(p => p.id === ing.ingredientId);

                // Si el insumo no existe (fue borrado), lo saltamos
                if (!ingredientProd) continue;

                // Cantidad total necesaria: (Cant. en receta) * (Cant. vendida)
                const totalNeeded = ing.quantity * item.quantity;

                // Verificamos si el stock del ingrediente es suficiente
                // NOTA: Aquí sí validamos el stock del INGREDIENTE
                if (ingredientProd.stock < totalNeeded) {
                    missingIngredients.push({
                        productName: product.name,
                        ingredientName: ingredientProd.name,
                        needed: totalNeeded,
                        available: ingredientProd.stock,
                        unit: ingredientProd.bulkData?.purchase?.unit || 'u'
                    });
                }
            }
        }
    }

    return missingIngredients;
};

/**
 * Procesa una venta completa: Inventario, Guardado, Estadísticas y Notificaciones.
 * @param {Object} params - Parámetros de la venta
 * @returns {Promise<Object>} Resultado de la operación
 */
export const processSale = async ({
    order,
    paymentData,
    total,
    allProducts,
    features,
    companyName,
    tempPrescriptionData,
    ignoreStock = false
}) => {
    console.time('Service:ProcessSale');

    try {
        const itemsToProcess = order.filter(item => item.quantity && item.quantity > 0);
        if (itemsToProcess.length === 0) throw new Error('El pedido está vacío.');

        // --- VALIDACIÓN PREVIA (RECETAS) ---
        if (features.hasRecipes && !ignoreStock) {

            // 1. Identificar qué productos e insumos necesitamos revisar
            const uniqueIngredientIds = new Set();

            itemsToProcess.forEach(item => {
                const realId = item.parentId || item.id;
                const productDef = allProducts.find(p => p.id === realId);

                if (productDef && productDef.recipe && productDef.recipe.length > 0) {
                    productDef.recipe.forEach(ing => uniqueIngredientIds.add(ing.ingredientId));
                } else if (productDef && productDef.trackStock) {
                    uniqueIngredientIds.add(realId);
                }
            });

            // 2. Cargar el STOCK FRESCO desde la Base de Datos
            const freshStockMap = new Map();
            if (uniqueIngredientIds.size > 0) {
                await Promise.all(Array.from(uniqueIngredientIds).map(async (id) => {
                    const freshProd = await loadData(STORES.MENU, id);
                    if (freshProd) {
                        freshStockMap.set(id, freshProd);
                    }
                }));
            }

            // 3. Validar usando un ACUMULADOR (Simulación de consumo)
            const missingIngredients = [];

            // Creamos un mapa temporal para ir "gastando" el stock mentalmente
            const simulatedStock = new Map();

            // Inicializamos el simulador con el stock real que acabamos de traer de la BD
            freshStockMap.forEach((product, id) => {
                simulatedStock.set(id, product.stock);
            });

            for (const item of itemsToProcess) {
                const realId = item.parentId || item.id;
                const productDef = allProducts.find(p => p.id === realId);

                // A) Si es producto con receta
                if (productDef && productDef.recipe && productDef.recipe.length > 0) {
                    for (const ing of productDef.recipe) {
                        // Si el ingrediente no existe en BD, lo saltamos (o podrías marcar error)
                        if (!simulatedStock.has(ing.ingredientId)) continue;

                        const currentAvailable = simulatedStock.get(ing.ingredientId);
                        const totalNeededForThisItem = ing.quantity * item.quantity;

                        if (currentAvailable < totalNeededForThisItem) {
                            // Falló la validación. Agregamos a la lista de faltantes.
                            const realIngData = freshStockMap.get(ing.ingredientId);

                            // Evitamos duplicar el mensaje del mismo ingrediente
                            const alreadyListed = missingIngredients.some(m => m.ingredientName === realIngData.name);

                            if (!alreadyListed) {
                                missingIngredients.push({
                                    productName: "Pedido (Acumulado)",
                                    ingredientName: realIngData.name,
                                    needed: totalNeededForThisItem,
                                    available: realIngData.stock, // Mostramos el stock real original
                                    unit: realIngData.bulkData?.purchase?.unit || 'u'
                                });
                            }
                        } else {
                            // ÉXITO: Restamos del stock simulado para que el siguiente producto vea menos
                            simulatedStock.set(ing.ingredientId, currentAvailable - totalNeededForThisItem);
                        }
                    }
                }
                // B) Si no es receta pero controla stock directo (ej. Refresco)
                else if (productDef && productDef.trackStock) {
                    if (simulatedStock.has(realId)) {
                        const currentAvailable = simulatedStock.get(realId);
                        const needed = item.quantity;

                        if (currentAvailable < needed) {
                            const alreadyListed = missingIngredients.some(m => m.ingredientName === productDef.name);

                            if (!alreadyListed) {
                                missingIngredients.push({
                                    productName: productDef.name,
                                    ingredientName: productDef.name,
                                    needed: needed,
                                    available: freshStockMap.get(realId).stock,
                                    unit: 'u'
                                });
                            }
                        } else {
                            simulatedStock.set(realId, currentAvailable - needed);
                        }
                    }
                }
            }

            // 4. Si hay faltantes, detenemos el proceso y retornamos error
            if (missingIngredients.length > 0) {
                const details = missingIngredients.map(m =>
                    `• ${m.ingredientName}: Tienes ${m.available.toFixed(2)} ${m.unit} (Insuficiente para cubrir todo el pedido)`
                ).join('\n');

                return {
                    success: false,
                    errorType: 'STOCK_WARNING',
                    message: `⚠️ STOCK INSUFICIENTE REAL:\n\n${details}\n\nEl total de ingredientes requeridos para todo el pedido supera lo que tienes en cocina.`,
                    missingData: missingIngredients
                };
            }
        }

        // --- NORMALIZACIÓN DE PRECIOS ---
        itemsToProcess.forEach((item) => {
            const safePrice = parseFloat(item.price);
            const safeCost = parseFloat(item.cost);

            if (isNaN(safePrice) || !isFinite(safePrice) || safePrice < 0) {
                throw new Error(`Error en producto "${item.name}": El precio no es un número válido.`);
            }

            if (isNaN(safeCost) || !isFinite(safeCost)) {
                item.cost = 0;
            } else {
                item.cost = safeCost;
            }
            item.price = safePrice;
        });

        if (isNaN(parseFloat(total)) || parseFloat(total) < 0) {
            throw new Error("El total de la venta no es válido.");
        }

        const uniqueProductIds = new Set();

        // ============================================================
        // 1. IDENTIFICACIÓN (Qué lotes cargar)
        // ============================================================
        for (const orderItem of itemsToProcess) {
            const realProductId = orderItem.parentId || orderItem.id;
            const product = allProducts.find(p => p.id === realProductId);

            // Detectar si tiene receta
            const hasRecipe = features.hasRecipes && product?.recipe && product.recipe.length > 0;

            // Si no trackea stock Y NO tiene receta, saltamos.
            if (!product || (product.trackStock === false && !hasRecipe)) continue;

            const itemsToDeduct = hasRecipe
                ? product.recipe
                : [{ ingredientId: realProductId, quantity: 1 }];

            itemsToDeduct.forEach(component => uniqueProductIds.add(component.ingredientId));
        }

        // Cargar lotes de la BD (solo para los que trackean stock)
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
                        batchesMap.set(productId, batches);
                    }
                })
            );
        }

        // ============================================================
        // 2. CÁLCULO DE DEDUCCIONES (Lógica FIFO vs Venta Libre)
        // ============================================================
        const batchesToDeduct = [];
        const processedItems = [];

        for (const orderItem of itemsToProcess) {
            const realProductId = orderItem.parentId || orderItem.id;
            const product = allProducts.find(p => p.id === realProductId);

            // 🟢 CORRECCIÓN: Definir hasRecipe AQUÍ TAMBIÉN para usarlo en la condición
            const hasRecipe = features.hasRecipes && product?.recipe && product.recipe.length > 0;

            // Definir 'quantityToDeduct'
            let quantityToDeduct = orderItem.quantity; // Valor por defecto

            if (product && product.conversionFactor?.enabled) {
                const factor = parseFloat(product.conversionFactor.factor);
                if (!isNaN(factor) && factor > 0) {
                    quantityToDeduct = orderItem.quantity / factor;
                }
            }

            // CAMBIO CLAVE: Si no trackea stock Y NO tiene receta, procesamos como venta libre simple
            if (!product || (product.trackStock === false && !hasRecipe)) {
                processedItems.push({
                    ...orderItem,
                    image: null,
                    base64: null,
                    cost: orderItem.cost || 0, // Usamos el costo simple registrado
                    batchesUsed: [], // Sin lotes
                    stockDeducted: 0 // No descontamos nada
                });
                continue; // Saltamos al siguiente ítem
            }

            // Definir qué descontar: ¿La receta o el producto mismo?
            const itemsToDeduct = hasRecipe
                ? product.recipe
                : [{ ingredientId: realProductId, quantity: 1 }];

            let itemTotalCost = 0;
            const itemBatchesUsed = [];

            for (const component of itemsToDeduct) {
                let requiredQty = component.quantity * quantityToDeduct;
                const targetId = component.ingredientId;
                const batches = batchesMap.get(targetId) || [];

                for (const batch of batches) {
                    if (requiredQty <= 0.0001) break;
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
                // Costo fallback si faltó stock
                if (requiredQty > 0.0001) {
                    const originalProduct = allProducts.find(p => p.id === targetId);
                    const fallbackCost = originalProduct?.cost || 0;
                    itemTotalCost += (fallbackCost * requiredQty);
                }
            }

            const calculatedAvgCost = orderItem.quantity > 0 ? roundCurrency(itemTotalCost / orderItem.quantity) : 0;
            const finalSafeCost = (isNaN(calculatedAvgCost) || calculatedAvgCost === null) ? 0 : parseFloat(calculatedAvgCost);

            processedItems.push({
                ...orderItem,
                image: null,
                base64: null,
                cost: finalSafeCost,
                batchesUsed: itemBatchesUsed,
                stockDeducted: quantityToDeduct
            });
        }

        // ============================================================
        // 3. TRANSACCIÓN
        // ============================================================
        const sale = {
            id: new Date().toISOString(),
            timestamp: new Date().toISOString(),
            items: processedItems,
            total: total,
            customerId: paymentData.customerId,
            paymentMethod: paymentData.paymentMethod,
            abono: paymentData.amountPaid,
            saldoPendiente: paymentData.saldoPendiente,
            fulfillmentStatus: features.hasKDS ? 'pending' : 'completed',
            prescriptionDetails: tempPrescriptionData || null
        };

        const transactionResult = await executeSaleTransactionSafe(sale, batchesToDeduct);

        if (!transactionResult.success) {
            if (transactionResult.isConcurrencyError) {
                return { success: false, errorType: 'RACE_CONDITION', message: "El stock cambió mientras cobrabas. Intenta de nuevo." };
            }
            return { success: false, message: transactionResult.error.message };
        }

        // Actualización de estadísticas
        const costOfGoodsSold = processedItems.reduce((acc, item) => roundCurrency(acc + roundCurrency(item.cost * item.quantity)), 0);
        await useStatsStore.getState().updateStatsForNewSale(sale, costOfGoodsSold);

        if (sale.paymentMethod === 'fiado' && sale.customerId && sale.saldoPendiente > 0) {
            const customer = await loadData(STORES.CUSTOMERS, sale.customerId);
            if (customer) {
                customer.debt = (customer.debt || 0) + sale.saldoPendiente;
                await saveData(STORES.CUSTOMERS, customer);
            }
        }

        if (paymentData.sendReceipt && paymentData.customerId) {
            await sendReceiptWhatsApp(sale, processedItems, paymentData, total, companyName, features);
        }

        console.timeEnd('Service:ProcessSale');
        return { success: true, saleId: sale.timestamp };

    } catch (error) {
        console.error('Service Error:', error);
        return { success: false, message: error.message };
    }
};

// Función auxiliar interna para WhatsApp (privada del módulo)
async function sendReceiptWhatsApp(sale, items, paymentData, total, companyName, features) {
    try {
        const customer = await loadData(STORES.CUSTOMERS, paymentData.customerId);
        if (customer && customer.phone) {
            let receiptText = `*--- TICKET DE VENTA ---*\n`;
            receiptText += `*Negocio:* ${companyName}\n`;
            receiptText += `*Fecha:* ${new Date().toLocaleString()}\n\n`;

            if (sale.prescriptionDetails) {
                receiptText += `*--- DATOS DE DISPENSACIÓN ---*\n`;
                receiptText += `Dr(a): ${sale.prescriptionDetails.doctorName}\n`;
                receiptText += `Cédula: ${sale.prescriptionDetails.licenseNumber}\n`;
                if (sale.prescriptionDetails.notes) receiptText += `Notas: ${sale.prescriptionDetails.notes}\n`;
                receiptText += `\n`;
            }

            receiptText += `*Productos:*\n`;
            items.forEach(item => {
                receiptText += `• ${item.name} (x${item.quantity}) - $${(item.price * item.quantity).toFixed(2)}\n`;
                if (features.hasLabFields && item.requiresPrescription) {
                    receiptText += `  _(Antibiótico/Controlado)_\n`;
                }
            });

            receiptText += `\n*TOTAL: $${total.toFixed(2)}*\n`;

            if (paymentData.paymentMethod === 'efectivo') {
                const cambio = parseFloat(paymentData.amountPaid) - total;
                receiptText += `Cambio: $${cambio.toFixed(2)}\n`;
            } else if (paymentData.paymentMethod === 'fiado') {
                receiptText += `Abono: $${parseFloat(paymentData.amountPaid).toFixed(2)}\n`;
                receiptText += `Saldo Pendiente: $${parseFloat(paymentData.saldoPendiente).toFixed(2)}\n`;
            }

            receiptText += `\n¡Gracias por su preferencia!`;
            sendWhatsAppMessage(customer.phone, receiptText);
        }
    } catch (error) {
        console.error("Error enviando ticket:", error);
    }
}

export const updateDailyStats = async (sale) => {
    const dateKey = new Date(sale.timestamp).toISOString().split('T')[0];

    // 1. Obtener registro del día (o crear nuevo)
    let dailyStat = await loadData(STORES.DAILY_STATS, dateKey);

    if (!dailyStat) {
        dailyStat = {
            id: dateKey,
            date: dateKey,
            revenue: 0,
            profit: 0,
            orders: 0,
            itemsSold: 0
        };
    }

    // 2. Calcular utilidad de esta venta específica
    let saleProfit = 0;
    sale.items.forEach(item => {
        const cost = item.cost || 0;
        const profitUnitario = roundCurrency(item.price - cost);
        saleProfit += roundCurrency(profitUnitario * item.quantity);
    });

    // 3. Actualizar acumuladores (Incremental)
    dailyStat.revenue += sale.total;
    dailyStat.profit += saleProfit;
    dailyStat.orders += 1;
    dailyStat.itemsSold += sale.items.reduce((acc, i) => acc + i.quantity, 0);

    // 4. Guardar
    await saveData(STORES.DAILY_STATS, dailyStat);
};

export const getFastDashboardStats = async () => {
    // Carga solo los resúmenes diarios, mucho más rápido que cargar todas las ventas
    const allDays = await loadData(STORES.DAILY_STATS);

    return allDays.reduce((acc, day) => ({
        totalRevenue: acc.totalRevenue + day.revenue,
        totalNetProfit: acc.totalNetProfit + day.profit,
        totalOrders: acc.totalOrders + day.orders,
        totalItemsSold: acc.totalItemsSold + day.itemsSold
    }), { totalRevenue: 0, totalNetProfit: 0, totalOrders: 0, totalItemsSold: 0 });
};