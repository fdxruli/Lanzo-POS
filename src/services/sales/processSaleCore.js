import { validateStockBeforeSale } from './stockValidation';
import { normalizeAndValidatePricing } from './priceSecurity';
import {
    loadRelevantBatches,
    buildProcessedItemsAndDeductions
} from './inventoryFlow';
import { runPostSaleEffects, runPostSaleEffectsForCloudCommittedSale } from './postSaleEffects';
import { Money } from '../../utils/moneyMath';
import { generateID } from '../utils';
import { SALE_STATUS } from './financialStats';
import { evaluator } from '../BackupRiskEvaluator';
import { dispatchTickerInventoryAlert } from '../tickerAlertEvents';
import { salesCloudShadowService } from '../salesCloud/salesCloudShadowService';
import { salesCloudCashierService } from '../salesCloud/salesCloudCashierService';
import { calculateDiscountedTotals } from './discounts';

const requiresPrescriptionControl = (product = {}) => (
    product?.requiresPrescription === true ||
    Boolean(product?.prescriptionType && product.prescriptionType !== 'otc')
);

const CLOUD_INVENTORY_AUTHORITATIVE_MODES = new Set([
    'cloud_cashier_inventory',
    'cloud_credit_inventory'
]);

const toFiniteNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const toCents = (value) => Math.round((toFiniteNumber(value) + Number.EPSILON) * 100);

const getLineId = (item = {}, index = 0) => (
    item.lineId || item.uniqueLineId || item.ecommerceOrderItemId || `${item.parentId || item.id || 'item'}-${index}`
);

const getEcommerceCheckout = (paymentData = {}) => {
    const checkout = paymentData?.__ecommerceCheckout;
    return checkout?.origin === 'ecommerce' && checkout?.snapshot ? checkout : null;
};

const sanitizePaymentData = (paymentData = {}) => {
    const sanitized = { ...paymentData };
    delete sanitized.__ecommerceCheckout;
    return sanitized;
};

const applyAndValidateEcommerceSnapshot = ({ itemsToProcess, checkout, total }) => {
    const snapshot = checkout?.snapshot;
    const snapshotLines = Array.isArray(snapshot?.lines) ? snapshot.lines : [];
    if (!snapshot || snapshotLines.length !== itemsToProcess.length) {
        const error = new Error('El snapshot ecommerce no coincide con las líneas de la venta.');
        error.code = 'ECOMMERCE_CHECKOUT_SNAPSHOT_MISMATCH';
        throw error;
    }

    const snapshotByLine = new Map(snapshotLines.map((line) => [String(line.lineId), line]));
    const seen = new Set();

    itemsToProcess.forEach((item, index) => {
        const lineId = String(getLineId(item, index));
        const line = snapshotByLine.get(lineId);
        if (!line || seen.has(lineId)) {
            const error = new Error('Una línea ecommerce cambió antes de registrar la venta.');
            error.code = 'ECOMMERCE_CHECKOUT_SNAPSHOT_MISMATCH';
            throw error;
        }
        seen.add(lineId);

        const productId = String(item.parentId || item.id || '');
        const expectedProductId = String(line.productId || '');
        const quantity = toFiniteNumber(item.quantity, Number.NaN);
        const expectedQuantity = toFiniteNumber(line.quantity, Number.NaN);
        const acceptedPrice = toFiniteNumber(line.unitPriceSnapshot, Number.NaN);
        const itemBatchId = item.batchId || item.inventoryResolution?.batchId || null;
        const expectedBatchId = line.batchId || null;

        if (
            !productId
            || productId !== expectedProductId
            || !Number.isFinite(quantity)
            || !Number.isFinite(expectedQuantity)
            || quantity !== expectedQuantity
            || !Number.isFinite(acceptedPrice)
            || acceptedPrice < 0
            || String(itemBatchId || '') !== String(expectedBatchId || '')
        ) {
            const error = new Error('El pedido ecommerce cambió mientras se elegía el pago.');
            error.code = 'ECOMMERCE_CHECKOUT_SNAPSHOT_MISMATCH';
            throw error;
        }

        const lineTotal = Number((acceptedPrice * expectedQuantity).toFixed(2));
        if (toCents(lineTotal) !== toCents(line.lineTotalSnapshot)) {
            const error = new Error('El total de una línea ecommerce no coincide con el snapshot aceptado.');
            error.code = 'ECOMMERCE_TOTAL_MISMATCH';
            throw error;
        }

        item.price = acceptedPrice;
        item.exactTotal = lineTotal;
        item.lineSubtotal = lineTotal;
        item.lineTotal = lineTotal;
        item.discount = null;
        item.discountAmount = 0;
        item.discount_amount = 0;
        if (expectedBatchId) item.batchId = expectedBatchId;
    });

    const expectedSubtotal = toFiniteNumber(snapshot.expectedSubtotal, Number.NaN);
    const deliveryFee = toFiniteNumber(snapshot.expectedDeliveryFee, Number.NaN);
    const discountTotal = toFiniteNumber(snapshot.expectedDiscountTotal, Number.NaN);
    const taxTotal = toFiniteNumber(snapshot.expectedTaxTotal, Number.NaN);
    const expectedTotal = toFiniteNumber(snapshot.expectedTotal, Number.NaN);
    const lineSubtotal = itemsToProcess.reduce(
        (sum, item) => sum + toFiniteNumber(item.lineSubtotal),
        0
    );
    const composedTotal = expectedSubtotal - discountTotal + deliveryFee + taxTotal;

    if (
        ![expectedSubtotal, deliveryFee, discountTotal, taxTotal, expectedTotal].every(Number.isFinite)
        || [expectedSubtotal, deliveryFee, discountTotal, taxTotal, expectedTotal].some((value) => value < 0)
        || toCents(lineSubtotal) !== toCents(expectedSubtotal)
        || toCents(composedTotal) !== toCents(expectedTotal)
        || toCents(total) !== toCents(expectedTotal)
    ) {
        const error = new Error('El total del pedido cambió y debe revisarse antes de cobrar.');
        error.code = 'ECOMMERCE_TOTAL_MISMATCH';
        throw error;
    }

    return {
        items: itemsToProcess,
        subtotal: expectedSubtotal,
        grossSubtotal: expectedSubtotal,
        lineDiscountTotal: 0,
        subtotalAfterLineDiscounts: expectedSubtotal,
        saleDiscount: null,
        saleDiscountAmount: discountTotal,
        discountTotal,
        deliveryFee,
        taxTotal,
        total: expectedTotal,
        currency: String(snapshot.currency || 'MXN').toUpperCase()
    };
};

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

        const ecommerceCheckout = getEcommerceCheckout(paymentData);
        const isEcommerceSale = Boolean(ecommerceCheckout);
        const safePaymentData = sanitizePaymentData(paymentData);
        const productMap = new Map(allProducts.map(p => [p.id, p]));
        const saleDiscount = isEcommerceSale
            ? null
            : (paymentData.saleDiscount || paymentData.discount || null);

        if (features.hasLabFields) {
            const restrictedItem = itemsToProcess.find(item => {
                const realProduct = productMap.get(item.parentId || item.id);
                return requiresPrescriptionControl(realProduct);
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

        const cloudCashierDecision = await salesCloudCashierService.shouldUseCloudCashierSale({
            paymentData: safePaymentData,
            cart: itemsToProcess
        }).catch((decisionError) => {
            Logger.warn('Cloud cashier decision failed; usando flujo local + shadow:', decisionError);
            return { useCloud: false, reason: 'decision_error' };
        });

        const isCloudInventorySale = (
            cloudCashierDecision?.useCloud === true &&
            CLOUD_INVENTORY_AUTHORITATIVE_MODES.has(cloudCashierDecision?.mode)
        );

        if (!isCloudInventorySale) {
            const stockValidation = await validateStockBeforeSale({
                itemsToProcess,
                productMap,
                features,
                ignoreStock,
                loadData,
                loadMultipleData,
                queryBatchesByProductIdAndActive,
                STORES
            });

            if (!stockValidation.ok) {
                return stockValidation.response;
            }
        } else {
            Logger.info(
                'Cloud inventory sale detected: skipping blocking local stock validation; Supabase will validate stock transactionally.',
                { mode: cloudCashierDecision?.mode }
            );
        }

        if (!isEcommerceSale) {
            await normalizeAndValidatePricing({
                itemsToProcess,
                total,
                saleDiscount,
                loadData,
                queryBatchesByProductIdAndActive,
                STORES,
                calculatePricingDetails,
                Logger
            });
        }

        let totalNum;
        let financialTotals;
        try {
            financialTotals = isEcommerceSale
                ? applyAndValidateEcommerceSnapshot({ itemsToProcess, checkout: ecommerceCheckout, total })
                : calculateDiscountedTotals(itemsToProcess, saleDiscount);
            totalNum = Money.init(financialTotals.total);
            const totalFrontendNum = Money.init(total);

            if (totalFrontendNum.lt(0) || totalNum.lt(0)) {
                throw new Error('El total de la venta no puede ser negativo.');
            }

            const totalDiff = Math.abs(Number(Money.subtract(totalFrontendNum, totalNum)));
            if (totalDiff > 0.05) {
                throw new Error(`El total final no cuadra con los descuentos aplicados. Total esperado: $${Money.toNumber(totalNum).toFixed(2)}.`);
            }
        } catch (e) {
            if (e?.code) throw e;
            throw new Error(e.message || 'Error al auditar el total financiero de la venta.');
        }

        let abonoSeguro, saldoSeguro;
        try {
            abonoSeguro = Money.init(safePaymentData.amountPaid || 0);
            saldoSeguro = Money.init(safePaymentData.saldoPendiente || 0);

            if (abonoSeguro.gt(totalNum)) {
                abonoSeguro = totalNum;
            }

            if (abonoSeguro.lt(0) || saldoSeguro.lt(0)) {
                throw new Error('Los valores financieros no pueden ser negativos.');
            }

            const balanceDiff = Math.abs(Number(Money.add(abonoSeguro, saldoSeguro)) - Number(totalNum));
            if (balanceDiff > 0.05) {
                throw new Error(`Inconsistencia financiera: El abono y el saldo no cuadran con el total exacto de la venta ($${Number(totalNum).toFixed(2)}).`);
            }
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
            STORES,
            enforceExpiryStrict: !isCloudInventorySale
        });

        const { processedItems, batchesToDeduct } = buildProcessedItemsAndDeductions({
            itemsToProcess,
            allProducts,
            batchesMap,
            roundCurrency,
            enforceExpiryStrict: !isCloudInventorySale
        });

        const currentIsoTime = new Date().toISOString();
        const discountTotal = Money.toExactString(financialTotals.discountTotal);
        const subtotal = Money.toExactString(financialTotals.subtotal);
        const saleDiscountAudit = financialTotals.saleDiscount || null;
        const ecommerceMetadata = isEcommerceSale ? {
            origin: 'ecommerce',
            ecommerceOrderId: ecommerceCheckout.ecommerceOrderId,
            ecommerceOrderCode: ecommerceCheckout.ecommerceOrderCode || null,
            ecommerceConversionKey: ecommerceCheckout.idempotencyKey,
            idempotencyKey: ecommerceCheckout.idempotencyKey,
            ecommerceAcceptedSubtotal: Money.toExactString(financialTotals.subtotal),
            ecommerceAcceptedDeliveryFee: Money.toExactString(financialTotals.deliveryFee || 0),
            ecommerceAcceptedDiscountTotal: Money.toExactString(financialTotals.discountTotal || 0),
            ecommerceAcceptedTaxTotal: Money.toExactString(financialTotals.taxTotal || 0),
            ecommerceCurrency: financialTotals.currency || 'MXN'
        } : {};

        const sale = {
            id: activeOrderId || generateID('sal'),
            timestamp: currentIsoTime,
            items: processedItems,
            subtotal,
            discount: discountTotal,
            discountTotal,
            discount_total: discountTotal,
            saleDiscount: saleDiscountAudit,
            total: Money.toExactString(totalNum),
            customerId: safePaymentData.customerId,
            paymentMethod: safePaymentData.paymentMethod,
            abono: Money.toExactString(abonoSeguro),
            saldoPendiente: Money.toExactString(saldoSeguro),
            dueDate: safePaymentData.dueDate ? new Date(safePaymentData.dueDate).toISOString() : null,
            creditStatus: safePaymentData.paymentMethod === 'fiado' ? 'VIGENTE' : null,
            status: SALE_STATUS.CLOSED,
            fulfillmentStatus: features.hasKDS && !isEcommerceSale ? 'pending' : 'completed',
            prescriptionDetails: tempPrescriptionData || null,
            metadata: {
                discount: saleDiscountAudit,
                discountTotal,
                lineDiscountTotal: Money.toExactString(financialTotals.lineDiscountTotal),
                subtotalAfterLineDiscounts: Money.toExactString(financialTotals.subtotalAfterLineDiscounts),
                discountScope: saleDiscountAudit ? 'sale' : null,
                ...ecommerceMetadata
            },
            postEffectsCompleted: false,
            syncStatus: 'PENDING'
        };

        if (cloudCashierDecision?.useCloud) {
            let cloudResult;

            try {
                cloudResult = await salesCloudCashierService.processCloudCashierSale({
                    sale,
                    processedItems,
                    paymentData: { ...safePaymentData, saleDiscount: saleDiscountAudit },
                    total: Money.toExactString(totalNum)
                });
            } catch (cloudCashierError) {
                Logger.warn('Cloud cashier failed before local commit:', cloudCashierError);

                return {
                    success: false,
                    errorType: 'CLOUD_CASHIER_FAILED',
                    message: cloudCashierError.message || 'No se pudo confirmar la venta cloud. No se cobró localmente para evitar duplicados.'
                };
            }

            const cloudSale = cloudResult.localSale || sale;

            let postEffectsFailed = false;
            let postEffectsError = null;

            try {
                await runPostSaleEffectsForCloudCommittedSale({
                    sale: cloudSale,
                    processedItems,
                    paymentData: safePaymentData,
                    total: Money.toExactString(totalNum),
                    companyName,
                    features,
                    loadData,
                    saveData,
                    STORES,
                    useStatsStore,
                    roundCurrency,
                    sendReceiptWhatsApp,
                    Logger
                });
            } catch (postError) {
                postEffectsFailed = true;
                postEffectsError = {
                    message: postError.message || 'Error desconocido en efectos posteriores',
                    stack: postError.stack || null,
                    timestamp: new Date().toISOString()
                };

                Logger.warn('Post-Sale Effects Failed after cloud cashier commit:', postEffectsError);
            }

            evaluator.ping();

            return {
                success: true,
                saleId: cloudSale.id,
                cloudSaleId: cloudResult.response?.sale?.id || null,
                timestamp: cloudSale.timestamp,
                folio: cloudSale.folio,
                sourceMode: 'cloud_committed',
                effectsStatus: cloudSale.effectsStatus || cloudResult.response?.sale?.effects_status || 'payment_recorded',
                inventoryEffectStatus: cloudSale.inventoryEffectStatus || cloudResult.response?.sale?.inventory_effect_status || 'not_applied',
                creditEffectStatus: cloudSale.creditEffectStatus || cloudResult.response?.sale?.credit_effect_status || 'not_applied',
                cloudCommitted: true,
                postEffectsFailed,
                postEffectsError: postEffectsFailed ? postEffectsError : null,
                pendingSyncRequired: false,
                inventoryChangesTracked: null
            };
        }

        const transactionResult = await executeSaleTransactionSafe(sale, batchesToDeduct);

        if (!transactionResult.success) {
            if (transactionResult.isConcurrencyError) {
                return { success: false, errorType: 'RACE_CONDITION', message: 'El stock cambió mientras cobrabas. Intenta de nuevo.' };
            }

            const errorMessage = transactionResult.error?.message
                || transactionResult.message
                || 'Falló la transacción de venta sin un mensaje de error específico.';

            return { success: false, message: errorMessage };
        }

        dispatchTickerInventoryAlert(transactionResult.criticalStockProductIds || []);

        let postEffectsFailed = false;
        let postEffectsError = null;
        let inventoryChanges = null;

        try {
            await runPostSaleEffects({
                sale,
                processedItems,
                paymentData: safePaymentData,
                total: Money.toExactString(totalNum),
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
            postEffectsFailed = true;
            postEffectsError = {
                message: postError.message || 'Error desconocido en efectos posteriores',
                stack: postError.stack || null,
                timestamp: new Date().toISOString()
            };

            Logger.warn('Post-Sale Effects Failed (Non-Blocking):', postEffectsError);

            inventoryChanges = {
                saleId: sale.id,
                timestamp: sale.timestamp,
                items: processedItems.map(item => ({
                    productId: item.parentId || item.id,
                    lineId: item.lineId || null,
                    quantity: item.quantity,
                    batchId: item.batchId,
                    priceAtSale: item.price,
                    costAtSale: item.cost
                })),
                totalValue: sale.total,
                reason: 'POST_SALE_EFFECTS_FAILED'
            };

            Logger.info(
                'Cambios de inventario registrados como PENDIENTES para prevenir sobrescrituras',
                { saleId: sale.id, itemsAffected: processedItems.length }
            );
        }

        salesCloudShadowService.syncSaleShadowAfterLocalCommit(sale, {
            processedItems,
            paymentData: safePaymentData,
            postEffectsFailed,
            postEffectsError
        }).catch((cloudSyncError) => {
            Logger.warn('Sales Cloud Shadow Sync Failed (Non-Blocking):', cloudSyncError);
        });

        evaluator.ping();

        return {
            success: true,
            saleId: sale.id,
            timestamp: sale.timestamp,
            folio: sale.folio,
            postEffectsFailed,
            postEffectsError: postEffectsFailed ? postEffectsError : null,
            pendingSyncRequired: postEffectsFailed,
            inventoryChangesTracked: postEffectsFailed ? inventoryChanges : null
        };
    } catch (error) {
        Logger.error('Service Error:', error);
        return { success: false, code: error?.code || null, message: error.message };
    } finally {
        Logger.timeEnd('Service:ProcessSale');
    }
};

export const processSaleCoreInternals = Object.freeze({
    getEcommerceCheckout,
    sanitizePaymentData,
    applyAndValidateEcommerceSnapshot,
    getLineId,
    toCents
});
