import { validateStockBeforeSale } from './stockValidation';
import { normalizeAndValidatePricing } from './priceSecurity';
import {
    loadRelevantBatches,
    buildProcessedItemsAndDeductions
} from './inventoryFlow';
import { runPostSaleEffects } from './postSaleEffects';
import { Money } from '../../utils/moneyMath';
import { generateID } from '../utils';

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
    loadMultipleData,
    saveData,
    STORES,
    queryBatchesByProductIdAndActive,
    queryByIndex,
    executeSaleTransactionSafe,
    useStatsStore,
    roundCurrency,
    sendReceiptWhatsApp,
    calculatePricingDetails,
    Logger
}) => {
    Logger.time('Service:ProcessSale');

    try {
        const itemsToProcess = order.filter(item => item.quantity && item.quantity > 0);
        if (itemsToProcess.length === 0) throw new Error('El pedido está vacío.');

        // ✅ 2. AQUI VA LA MEJORA (Validación Temprana de Total)
        // Movemos esto hacia arriba. Antes estaba después del stockValidation.
        let totalNum;
        try {
            totalNum = Money.init(total);
            if (totalNum.lt(0)) throw new Error();
        } catch (e) {
            throw new Error('El total de la venta no es numéricamente válido.');
        }

        // NUEVO: Defensa estricta de variables financieras
        let abonoSeguro, saldoSeguro;
        try {
            abonoSeguro = Money.init(paymentData.amountPaid || 0);
            saldoSeguro = Money.init(paymentData.saldoPendiente || 0);

            if (abonoSeguro.lt(0) || saldoSeguro.lt(0)) {
                throw new Error('Los valores financieros no pueden ser negativos.');
            }

            // Ecuación de balance: Abono + Saldo DEBE ser igual al Total
            if (!Money.add(abonoSeguro, saldoSeguro).eq(totalNum)) {
                throw new Error('Inconsistencia financiera: El abono y el saldo no cuadran con el total.');
            }
        } catch (e) {
            throw new Error(`Datos de pago corruptos: ${e.message}`);
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
                    throw new Error(`BLOQUEO DE SEGURIDAD: El producto "${restrictedItem.name}" es controlado y requiere datos de receta médica (Doctor y Cédula).`);
                }
            }
        }

        const stockValidation = await validateStockBeforeSale({
            itemsToProcess,
            productMap,
            features,
            ignoreStock,
            loadData,
            loadMultipleData,
            STORES
        });

        if (!stockValidation.ok) {
            return stockValidation.response;
        }

        await normalizeAndValidatePricing({
            itemsToProcess,
            total,
            loadData,
            queryBatchesByProductIdAndActive,
            STORES,
            calculatePricingDetails,
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

        const currentIsoTime = new Date().toISOString();

        const sale = {
            id: generateID('sal'),
            timestamp: currentIsoTime,
            items: processedItems,
            total: Money.toExactString(totalNum),
            customerId: paymentData.customerId,
            paymentMethod: paymentData.paymentMethod,
            abono: Money.toExactString(abonoSeguro),
            saldoPendiente: Money.toExactString(saldoSeguro),
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
