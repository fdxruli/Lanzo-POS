import { validateStockBeforeSale } from './stockValidation';
import { normalizeAndValidatePricing } from './priceSecurity';
import {
    loadRelevantBatches,
    buildProcessedItemsAndDeductions
} from './inventoryFlow';
import { runPostSaleEffects } from './postSaleEffects';

export const processSaleCore = async ({
    order,
    paymentData,
    total,
    allProducts,
    features,
    companyName,
    tempPrescriptionData,
    ignoreStock = false
}, {
    loadData,
    saveData,
    STORES,
    queryBatchesByProductIdAndActive,
    queryByIndex,
    executeSaleTransactionSafe,
    useStatsStore,
    roundCurrency,
    sendReceiptWhatsApp,
    calculateCompositePrice,
    Logger
}) => {
    Logger.time('Service:ProcessSale');

    try {
        const itemsToProcess = order.filter(item => item.quantity && item.quantity > 0);
        if (itemsToProcess.length === 0) throw new Error('El pedido está vacío.');

        // ✅ 2. AQUI VA LA MEJORA (Validación Temprana de Total)
        // Movemos esto hacia arriba. Antes estaba después del stockValidation.
        const totalNum = parseFloat(total);
        if (isNaN(totalNum) || totalNum < 0) {
            // Usamos throw para mantener consistencia con tu bloque catch
            throw new Error('El total de la venta no es válido.');
        }

        const productMap = new Map(allProducts.map(p => [p.id, p]));

        if (features.hasLabFields) {
            const restrictedItem = itemsToProcess.find(item => {
                const realProduct = productMap.get(item.parentId || item.id);
                return realProduct && realProduct.requiresPrescription === true;
            });

            if (restrictedItem) {
                const hasValidPrescription = tempPrescriptionData &&
                    tempPrescriptionData.doctorName &&
                    tempPrescriptionData.licenseNumber;
                if (!hasValidPrescription) {
                    throw new Error(`BLOQUEO DE SEGURIDAD: El producto "${restrictedItem.name}" es controlado y requiere dats de receta medica (Doctor y Cedula).`)
                }
            }
        }

        const stockValidation = await validateStockBeforeSale({
            itemsToProcess,
            productMap,
            features,
            ignoreStock,
            loadData,
            STORES
        });

        if (!stockValidation.ok) {
            return stockValidation.response;
        }

        if (isNaN(parseFloat(total)) || parseFloat(total) < 0) {
            throw new Error('El total de la venta no es válido.');
        }

        await normalizeAndValidatePricing({
            itemsToProcess,
            total,
            loadData,
            queryBatchesByProductIdAndActive,
            STORES,
            calculateCompositePrice,
            Logger
        });

        const batchesMap = await loadRelevantBatches({
            itemsToProcess,
            allProducts,
            queryBatchesByProductIdAndActive,
            queryByIndex,
            STORES
        });

        const { processedItems, batchesToDeduct } = buildProcessedItemsAndDeductions({
            itemsToProcess,
            allProducts,
            batchesMap,
            roundCurrency
        });

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
            prescriptionDetails: tempPrescriptionData || null,
            postEffectsCompleted: false
        };

        const transactionResult = await executeSaleTransactionSafe(sale, batchesToDeduct);

        if (!transactionResult.success) {
            if (transactionResult.isConcurrencyError) {
                return { success: false, errorType: 'RACE_CONDITION', message: 'El stock cambió mientras cobrabas. Intenta de nuevo.' };
            }
            return { success: false, message: transactionResult.error.message };
        }

        await runPostSaleEffects({
            sale,
            processedItems,
            paymentData,
            total,
            companyName,
            features,
            loadData,
            saveData,
            STORES,
            useStatsStore,
            roundCurrency,
            sendReceiptWhatsApp
        });

        Logger.timeEnd('Service:ProcessSale');
        return { success: true, saleId: sale.timestamp };
    } catch (error) {
        Logger.error('Service Error:', error);
        return { success: false, message: error.message };
    }
};
