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
    tempPrescriptionData
}) => {
    console.time('Service:ProcessSale');

    try {
        const itemsToProcess = order.filter(item => item.quantity && item.quantity > 0);
        if (itemsToProcess.length === 0) throw new Error('El pedido está vacío.');

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

        // Identificar qué productos necesitan ser buscados en BD
        for (const orderItem of itemsToProcess) {
            const realProductId = orderItem.parentId || orderItem.id;
            const product = allProducts.find(p => p.id === realProductId);
            
            // --- CAMBIO CLAVE 1: Si no trackea stock, no buscamos sus lotes ---
            if (!product || product.trackStock === false) continue;

            const itemsToDeduct = (features.hasRecipes && product.recipe && product.recipe.length > 0)
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
            
            // --- CAMBIO CLAVE 2: VENTA LIBRE (Sin Lotes) ---
            if (!product || product.trackStock === false) {
                // Pasamos el ítem directo sin calcular deducciones ni costos complejos
                processedItems.push({
                    ...orderItem,
                    image: null,
                    base64: null,
                    cost: orderItem.cost || 0, // Usamos el costo simple registrado en el producto
                    batchesUsed: [], // Sin lotes
                    stockDeducted: 0 // No descontamos nada
                });
                continue; // Saltamos al siguiente ítem
            }

            // ... (Lógica de recetas existente, solo corre si trackStock es true) ...
            const itemsToDeduct = (features.hasRecipes && product.recipe && product.recipe.length > 0)
                ? product.recipe
                : [{ ingredientId: realProductId, quantity: 1 }];

            let itemTotalCost = 0;
            const itemBatchesUsed = [];

            for (const component of itemsToDeduct) {
                let requiredQty = component.quantity * orderItem.quantity;
                const targetId = component.ingredientId;
                const batches = batchesMap.get(targetId) || [];

                for (const batch of batches) {
                    if (requiredQty <= 0.0001) break;
                    if (batch.stock <= 0) continue;

                    const toDeduct = Math.min(requiredQty, batch.stock);
                    batchesToDeduct.push({ batchId: batch.id, quantity: toDeduct });
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
                stockDeducted: orderItem.quantity
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

        // Actualización de estadísticas y demás (sin cambios)
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
    const dateKey = new Date(sale.timestamp).toISOString().split('T')[0]; // "2023-10-27"

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