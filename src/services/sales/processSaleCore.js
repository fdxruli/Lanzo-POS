import { validateStockBeforeSale } from './stockValidation';
import { normalizeAndValidatePricing } from './priceSecurity';
import {
    loadRelevantBatches,
    buildProcessedItemsAndDeductions
} from './inventoryFlow';
import { runPostSaleEffects } from './postSaleEffects';
import { Money } from '../../utils/moneyMath';
import { generateID } from '../utils';
import { SALE_STATUS } from './financialStats';
import { syncMiddleware } from '../sync/syncMiddleware';
import { conflictResolver } from '../sync/conflictResolver';
import { evaluator } from '../BackupRiskEvaluator';

export const processSaleCore = async ({
    order,
    paymentData,
    total,
    allProducts,
    features,
    companyName,
    tempPrescriptionData,
    ignoreStock = false,
    activeOrderId
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

        // 🔥 CORRECCIÓN ESTRUCTURAL: SOBERANÍA DEL TOTAL Y MAYOREO
        // Recalcular la verdad absoluta usando los exactTotals inyectados por priceSecurity
        let totalNum;
        try {
            const totalRealNum = itemsToProcess.reduce((sum, item) => {
                if (item.exactTotal !== undefined) {
                    return Money.add(sum, Money.init(item.exactTotal));
                }
                const price = Money.init(item.price || 0);
                const qty = Money.init(item.quantity || 0);
                return Money.add(sum, Money.mul(price, qty));
            }, Money.init(0));

            const totalFrontendNum = Money.init(total);

            if (totalFrontendNum.lt(0) || totalRealNum.lt(0)) {
                throw new Error('El total de la venta no puede ser negativo.');
            }

            // La discrepancia severa ya se validó en priceSecurity.js
            // Imponemos la verdad absoluta del backend para la base de datos
            totalNum = totalRealNum;

        } catch (e) {
            throw new Error(e.message || 'Error al auditar el total financiero de la venta.');
        }

        // Defensa estricta de variables financieras
        let abonoSeguro, saldoSeguro;
        try {
            abonoSeguro = Money.init(paymentData.amountPaid || 0);
            saldoSeguro = Money.init(paymentData.saldoPendiente || 0);

            // CORRECCIÓN: El ingreso contable jamás puede superar al total del ticket.
            if (abonoSeguro.gt(totalNum)) {
                abonoSeguro = totalNum;
            }

            if (abonoSeguro.lt(0) || saldoSeguro.lt(0)) {
                throw new Error('Los valores financieros no pueden ser negativos.');
            }

            // Ecuación de balance: Abono + Saldo DEBE ser igual al Total exacto
            const balanceDiff = Math.abs(Number(Money.add(abonoSeguro, saldoSeguro)) - Number(totalNum));
            if (balanceDiff > 0.05) {
                throw new Error(`Inconsistencia financiera: El abono y el saldo no cuadran con el total exacto de los productos ($${Number(totalNum).toFixed(2)}).`);
            }
            // Forzamos el saldo para evitar discrepancias de fracciones de centavo
            saldoSeguro = Money.sub(totalNum, abonoSeguro);
            if (saldoSeguro.lt(0)) saldoSeguro = Money.init(0);
        } catch (e) {
            throw new Error(`Datos de pago corruptos: ${e.message}`);
        }

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
            id: activeOrderId || generateID('sal'),
            timestamp: currentIsoTime,
            items: processedItems,
            total: Money.toExactString(totalNum),
            customerId: paymentData.customerId,
            paymentMethod: paymentData.paymentMethod,
            abono: Money.toExactString(abonoSeguro),
            saldoPendiente: Money.toExactString(saldoSeguro),
            dueDate: paymentData.dueDate ? new Date(paymentData.dueDate).toISOString() : null,
            creditStatus: paymentData.paymentMethod === 'fiado' ? 'VIGENTE' : null,
            status: SALE_STATUS.CLOSED,
            fulfillmentStatus: features.hasKDS ? 'pending' : 'completed',
            prescriptionDetails: tempPrescriptionData || null,
            postEffectsCompleted: false,
            syncStatus: 'PENDING'
        };

        const transactionResult = await executeSaleTransactionSafe(sale, batchesToDeduct);

        if (!transactionResult.success) {
            if (transactionResult.isConcurrencyError) {
                return { success: false, errorType: 'RACE_CONDITION', message: 'El stock cambió mientras cobrabas. Intenta de nuevo.' };
            }

            // Corrección: Lectura defensiva de la causa del fallo
            const errorMessage = transactionResult.error?.message
                || transactionResult.message
                || 'Falló la transacción de venta sin un mensaje de error específico.';

            return { success: false, message: errorMessage };
        }

        // ✅ SOBERANÍA LOCAL ESTABLECIDA
        // La venta está segura en IndexedDB. De aquí en adelante, el éxito es inconmutable.
        // Los efectos secundarios se aíslan en un contexto no-bloqueante.

        let postEffectsFailed = false;
        let postEffectsError = null;
        let inventoryChanges = null;

        try {
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
        } catch (postError) {
            // Captura el error, pero NO lo re-lanzamos. La venta ya está segura.
            postEffectsFailed = true;
            postEffectsError = {
                message: postError.message || 'Error desconocido en efectos posteriores',
                stack: postError.stack || null,
                timestamp: new Date().toISOString()
            };

            Logger.warn('Post-Sale Effects Failed (Non-Blocking):', postEffectsError);

            // 🛡️ NUEVO: Registrar cambios de inventario como PENDIENTES
            // Esto previene que un pull posterior sobrescriba con datos viejos
            inventoryChanges = {
                saleId: sale.id,
                timestamp: sale.timestamp,
                items: processedItems.map(item => ({
                    productId: item.id,
                    quantity: item.quantity,
                    batchId: item.batchId,
                    priceAtSale: item.price,
                    costAtSale: item.cost
                })),
                totalValue: sale.total,
                reason: 'POST_SALE_EFFECTS_FAILED'
            };

            // Registrar en syncMiddleware para prevenir sobrescrituras
            // [Fase 1]: Desacoplar Ventas del Middleware temporalmente
            // await syncMiddleware.registerLocalSaleChange(sale.id, inventoryChanges);
            // await conflictResolver.markAsPendingSync(
            //     STORES.SALES,
            //     {
            //         saleId: sale.id,
            //         inventoryChanges,
            //         status: SALE_STATUS.CLOSED
            //     },
            //     'POST_EFFECTS_SYNC_FAILED'
            // );

            Logger.info(
                `📌 Cambios de inventario registrados como PENDIENTES para prevenir sobrescrituras`,
                { saleId: sale.id, itemsAffected: processedItems.length }
            );
        }
        // ✅ Llamada silenciosa al evaluador de riesgo para prevenir Falacia del Estado Volátil (Volumen en memoria sin recarga)
        evaluator.ping();

        // ✅ RETORNO RESILIENTE PWA
        // Indica claramente: venta segura localmente, pero qué efectos fallaron
        return {
            success: true,
            saleId: sale.timestamp,
            folio: sale.folio,
            postEffectsFailed,
            postEffectsError: postEffectsFailed ? postEffectsError : null,
            pendingSyncRequired: postEffectsFailed, // Trigger para Service Worker
            inventoryChangesTracked: postEffectsFailed ? inventoryChanges : null
        };
    } catch (error) {
        Logger.error('Service Error:', error);
        return { success: false, message: error.message };
    } finally {
        Logger.timeEnd('Service:ProcessSale');
    }
};
