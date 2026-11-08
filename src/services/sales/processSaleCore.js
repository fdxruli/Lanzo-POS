import { restoreAbortedCheckoutCancellation, forgetPrepaymentCheckout } from '../auth/actorOperationalHandoff';
import { actorRuntimeController } from '../auth/actorRuntimeController';
import { validateStockBeforeSale } from './stockValidation';
import {
    captureDirectPartialAuthorization,
    getDirectPartialRecipeSnapshot,
    matchesDirectPartialAuthorization
} from './directPartialAuthorization';
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
import { buildSalePaymentSnapshot } from './saleRefunds';
import {
    isRestaurantCloudTableShadow,
    isRestaurantCloudTableTerminal,
    restaurantCloudTableTerminalBlockedResult
} from '../restaurant/restaurantCloudTableGuards';
import { normalizeStableSaleTimestamp } from './stableSaleTimestamp';
import {
  createFinancialNotificationResult,
  notificationNotRequested
} from '../customerMessaging/index.js';

const withFinancialFailure = (result = {}) => ({
    ...result,
    ...createFinancialNotificationResult({
        financialResult: {
            status: 'failed',
            code: result.code || result.errorType || 'SALE_FINANCIAL_FAILED',
            message: result.message || null
        }
    })
});

// A closed local row is the receipt. Reconciliation never executes effects.
const localCommitResult = (sale) => ({
    success: true, saleId: sale.id, timestamp: sale.timestamp, folio: sale.folio,
    ...createFinancialNotificationResult({ financialResult: {
        status: 'success', sourceMode: 'local_committed', saleId: sale.id, cloudCommitted: false
    } })
});
const uncertainLocalCommit = (saleId) => ({
    success: false, saleId, code: 'LOCAL_COMMIT_UNCERTAIN', retryable: false,
    financialResult: { status: 'unknown', sourceMode: 'local_uncertain', saleId }
});
const sameLocalCommit = (sale, binding, attemptId) => Boolean(
    binding && sale?.localCommitBinding && sale?.status === SALE_STATUS.CLOSED &&
    sale.localCheckoutAttemptId === attemptId &&
    JSON.stringify(sale.localCommitBinding) === JSON.stringify(binding)
);

const requiresPrescriptionControl = (product = {}) => (
    product?.requiresPrescription === true ||
    Boolean(product?.prescriptionType && product.prescriptionType !== 'otc')
);

const CLOUD_INVENTORY_AUTHORITATIVE_MODES = new Set([
    'cloud_cashier_inventory',
    'cloud_credit_inventory'
]);

const LOCAL_STATION_KEY_PREFIX = 'local:device:';
const CREDIT_SALES_PERMISSION_DENIED_CODE = 'POS_PERMISSION_DENIED:pos_credit_sales';
const CREDIT_SALES_PERMISSION_DENIED_MESSAGE = 'Tu usuario no tiene autorización para generar saldos pendientes mediante ventas.';

const assertSaleAuthority = (actorContext, createsNewDebt) => {
    if (!actorContext) return;
    actorContext.assertCurrent('pos');
    if (!createsNewDebt) return;

    try {
        actorContext.assertCurrent('pos_credit_sales');
    } catch (error) {
        if (error?.code === 'ACTOR_PERMISSION_DENIED') {
            throw Object.assign(new Error(CREDIT_SALES_PERMISSION_DENIED_MESSAGE), {
                code: CREDIT_SALES_PERMISSION_DENIED_CODE,
                cause: error
            });
        }
        throw error;
    }
};

const isLocalStationKey = (value) => (
    typeof value === 'string' && value.startsWith(LOCAL_STATION_KEY_PREFIX)
);

const toFiniteNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const toCents = (value) => Math.round((toFiniteNumber(value) + Number.EPSILON) * 100);

const getLineId = (item = {}, index = 0) => (
    item.lineId || item.uniqueLineId || item.ecommerceOrderItemId || `${item.parentId || item.id || 'item'}-${index}`
);

const stableSaleTimestampRequiredError = () => {
    const error = new Error('SALE_TIMESTAMP_REQUIRED');
    error.code = 'SALE_TIMESTAMP_REQUIRED';
    return error;
};

const resolveStableSaleTimestamp = async ({
    activeOrderId,
    saleTimestamp = null,
    activeOrderCreatedAt = null,
    createdAt = null,
    loadData,
    STORES,
    fallback,
    Logger,
    persistedSale = undefined
}) => {
    if (activeOrderId && STORES?.SALES && typeof loadData === 'function') {
        try {
            const durableSale = persistedSale === undefined
                ? await loadData(STORES.SALES, activeOrderId) : persistedSale;
            const stablePersistedTimestamp = normalizeStableSaleTimestamp(durableSale?.timestamp)
                || normalizeStableSaleTimestamp(durableSale?.createdAt);
            if (stablePersistedTimestamp) return stablePersistedTimestamp;
        } catch (error) {
            Logger?.warn('No se pudo leer la marca temporal durable de la orden.', error);
        }
    }

    const explicitTimestamp = [saleTimestamp, activeOrderCreatedAt, createdAt]
        .map(normalizeStableSaleTimestamp)
        .find(Boolean);
    if (explicitTimestamp) return explicitTimestamp;

    if (!activeOrderId) {
        const normalizedFallback = normalizeStableSaleTimestamp(fallback);
        if (normalizedFallback) return normalizedFallback;
    }

    throw stableSaleTimestampRequiredError();
};

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
    partialAuthorization = null,
    activeOrderId,
    saleTimestamp = null,
    activeOrderCreatedAt = null,
    createdAt = null,
    actorContext = null
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
    const localBinding = actorContext ? {
        actorKey: actorContext.actorKey, sessionId: actorContext.sessionId,
        deviceRef: actorContext.deviceRef, tenant: actorContext.tenant
    } : null;

    try {
        let persistedOrder;
        if (activeOrderId) {
            persistedOrder = await loadData(STORES.SALES, activeOrderId);
            if (isRestaurantCloudTableTerminal(persistedOrder)) {
                return withFinancialFailure(restaurantCloudTableTerminalBlockedResult(persistedOrder));
            }
        }
        const attemptId = persistedOrder?.checkoutAttemptId || persistedOrder?.localCheckoutAttemptId || null;
        if (sameLocalCommit(persistedOrder, localBinding, attemptId)) return localCommitResult(persistedOrder);
        if (persistedOrder?.localCommitBinding && persistedOrder.status === SALE_STATUS.CLOSED) {
            throw new Error('LOCAL_COMMIT_ORIGIN_MISMATCH');
        }
        actorContext?.assertCurrent?.('pos');
        const itemsToProcess = order.filter(item => item.quantity && item.quantity > 0);
        // Preserve the exact checkout lines before pricing/stock enrichment.
        const restaurantCheckoutOrder = persistedOrder ? {
            ...persistedOrder,
            items: structuredClone(itemsToProcess),
            total,
            ...(paymentData.saleDiscount ? { saleDiscount: structuredClone(paymentData.saleDiscount) } : {})
        } : null;
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

        const cloudRestaurantSettlementRequired = Boolean(
            isRestaurantCloudTableShadow(persistedOrder)
            || persistedOrder?.cloudRestaurantOrderUpdatedAt
            || persistedOrder?.restaurantCloudExpectedVersion
            || persistedOrder?.cloudRestaurantOrderServerVersion
            || persistedOrder?.restaurantOrderId
            || persistedOrder?.cloudRestaurantOrderId
        );
        if (cloudRestaurantSettlementRequired && !cloudCashierDecision?.useCloud) {
            return withFinancialFailure({
                success: false,
                errorType: 'CLOUD_CASHIER_FAILED',
                code: 'RESTAURANT_CLOUD_SETTLEMENT_REQUIRED',
                message: 'La comanda cloud requiere una caja conectada para validar y liquidar la mesa. No se cobró localmente.'
            });
        }

        const isCloudInventorySale = (
            cloudCashierDecision?.useCloud === true &&
            CLOUD_INVENTORY_AUTHORITATIVE_MODES.has(cloudCashierDecision?.mode)
        );

        const directPartialContext = {
            order: itemsToProcess,
            total,
            paymentData: safePaymentData,
            saleId: activeOrderId,
            attemptId,
            actorContext,
            recipeSnapshot: Object.fromEntries(
                Array.from(new Set(itemsToProcess.map((item) => item.parentId || item.id).filter(Boolean)))
                    .map((productId) => [productId, getDirectPartialRecipeSnapshot(productMap.get(productId))])
            )
        };
        const isDirectSale = Boolean(activeOrderId && attemptId && actorContext
            && !persistedOrder?.tableData && persistedOrder?.orderType !== 'table'
            && !persistedOrder?.isSaved && !cloudRestaurantSettlementRequired
            && !itemsToProcess.some((item) => item?.inventoryReservation?.source === 'table'));
        const directPartialApproved = ignoreStock === true
            && isDirectSale
            && matchesDirectPartialAuthorization(partialAuthorization, directPartialContext);
        if (ignoreStock && !directPartialApproved) {
            return withFinancialFailure({
                success: false, code: 'DIRECT_PARTIAL_APPROVAL_INVALID',
                message: 'La autorización de faltantes ya no corresponde a esta venta, sesión o carrito. Vuelve a revisar el inventario.'
            });
        }
        if (directPartialApproved && !cloudCashierDecision?.useCloud
            && await salesCloudCashierService.requiresCloudInventoryAuthority()) {
            return withFinancialFailure({
                success: false, code: 'DIRECT_PARTIAL_CLOUD_REQUIRED',
                message: 'Este negocio requiere inventario cloud para autorizar faltantes. Conecta la caja y vuelve a intentarlo; no se cobró localmente.'
            });
        }
        if (directPartialApproved && cloudCashierDecision?.useCloud && !isCloudInventorySale) {
            return withFinancialFailure({
                success: false, code: 'DIRECT_PARTIAL_CLOUD_INVENTORY_REQUIRED',
                message: 'Este cobro requiere inventario autoritativo cloud. No se cobró ni se descontó stock local.'
            });
        }

        // Cloud normal checkout remains authoritative on Supabase; the local
        // snapshot is advisory only for detecting a known recipe shortage.
        const needsLocalStockCheck = !isCloudInventorySale || (
            !ignoreStock && isDirectSale && itemsToProcess.some((item) =>
                Array.isArray(productMap.get(item.parentId || item.id)?.recipe)
                && productMap.get(item.parentId || item.id).recipe.length > 0
            )
        );
        if (needsLocalStockCheck) {
            const stockValidation = await validateStockBeforeSale({
                itemsToProcess, productMap, features, ignoreStock: false,
                loadData, loadMultipleData, queryBatchesByProductIdAndActive, STORES
            });
            if (!stockValidation.ok) {
                if (stockValidation.response.errorType === 'STOCK_WARNING'
                    && isDirectSale && stockValidation.response.eligibleForPartial
                    && !directPartialApproved) {
                    return withFinancialFailure({
                        ...stockValidation.response,
                        partialAuthorizationProposal: captureDirectPartialAuthorization(
                            directPartialContext, stockValidation.response.missingData
                        )
                    });
                }
                if (!directPartialApproved || stockValidation.response.errorType !== 'STOCK_WARNING') {
                    // If cloud has a healthy authoritative path but local
                    // reference data is unknown, do not mis-sell as partial.
                    if (isCloudInventorySale && !ignoreStock
                        && stockValidation.response.errorType === 'INVENTORY_UNKNOWN') {
                        Logger.warn('Cloud inventory local snapshot incomplete; server remains strict.');
                    } else {
                        return withFinancialFailure(stockValidation.response);
                    }
                }
            }
        }

        if (directPartialApproved && !isDirectSale) {
            throw new Error('DIRECT_PARTIAL_TABLE_FORBIDDEN');
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

        const createsNewDebt = saldoSeguro.gt(0);
        assertSaleAuthority(actorContext, createsNewDebt);

        if (createsNewDebt && actorContext?.actorType === 'staff' && cloudCashierDecision?.useCloud !== true) {
            return withFinancialFailure({
                success: false,
                code: 'CREDIT_SALE_CLOUD_REQUIRED',
                message: 'Las ventas que generan saldo pendiente para Staff requieren autorización cloud en línea. No se registró la venta.'
            });
        }

        const batchesMap = await loadRelevantBatches({
            itemsToProcess,
            allProducts,
            queryBatchesByProductIdAndActive,
            queryByIndex,
            STORES,
            enforceExpiryStrict: !isCloudInventorySale,
            allowDirectPartial: directPartialApproved
        });

        const { processedItems, batchesToDeduct } = buildProcessedItemsAndDeductions({
            itemsToProcess,
            allProducts,
            batchesMap,
            roundCurrency,
            enforceExpiryStrict: !isCloudInventorySale,
            allowDirectPartial: directPartialApproved
        });

        const stableSaleTimestamp = await resolveStableSaleTimestamp({
            activeOrderId,
            saleTimestamp,
            activeOrderCreatedAt,
            createdAt,
            loadData,
            STORES,
            fallback: new Date().toISOString(),
            Logger,
            persistedSale: persistedOrder
        });
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
        const suppliedCashStationId = safePaymentData.cashStationId
            || safePaymentData.cash_station_id
            || null;
        const suppliedLocalStationKey = safePaymentData.localStationKey
            || safePaymentData.local_station_key
            || null;
        const localStationKey = isLocalStationKey(suppliedLocalStationKey)
            ? suppliedLocalStationKey
            : (isLocalStationKey(suppliedCashStationId) ? suppliedCashStationId : null);
        const cashStationId = isLocalStationKey(suppliedCashStationId)
            ? null
            : suppliedCashStationId;
        const saleId = activeOrderId || generateID('sal');

        const sale = {
            id: saleId,
            timestamp: stableSaleTimestamp,
            salesChannel: isEcommerceSale ? 'ecommerce' : 'local',
            ecommerceOrderId: isEcommerceSale ? ecommerceCheckout.ecommerceOrderId : null,
            ecommerceOrderCode: isEcommerceSale ? ecommerceCheckout.ecommerceOrderCode || null : null,
            items: processedItems,
            subtotal,
            discount: discountTotal,
            discountTotal,
            discount_total: discountTotal,
            saleDiscount: saleDiscountAudit,
            total: Money.toExactString(totalNum),
            customerId: safePaymentData.customerId,
            paymentMethod: safePaymentData.paymentMethod,
            ...(cloudCashierDecision?.useCloud ? {} : {
                initialPaymentMethod: safePaymentData.initialPaymentMethod
                    || safePaymentData.abonoPaymentMethod
                    || safePaymentData.creditPaymentMethod
                    || safePaymentData.partialPaymentMethod
                    || null,
                payments: buildSalePaymentSnapshot({
                    paymentData: safePaymentData,
                    paymentMethod: safePaymentData.paymentMethod,
                    total: Money.toExactString(totalNum),
                    initialPaid: Money.toExactString(abonoSeguro),
                    saleId
                })
            }),
            cash_session_id: safePaymentData.cashSessionId || safePaymentData.cash_session_id || null,
            cashStationId,
            localStationKey,
            cashOriginActorKey: actorContext?.actorKey || safePaymentData.originActorKey || null,
            cashOriginActorGeneration: actorContext?.generation ?? safePaymentData.originActorGeneration ?? null,
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
                ...ecommerceMetadata,
                ...(directPartialApproved ? { directPartialInventoryAuthorization: {
                    version: 1,
                    saleId: activeOrderId,
                    attemptId,
                    actorKey: actorContext.actorKey,
                    tenant: actorContext.tenant?.opaqueId || null,
                    maxMissing: partialAuthorization.maxMissing,
                    recipeSnapshot: partialAuthorization.recipeSnapshot,
                    approvedItems: partialAuthorization.approvedItems,
                    mode: 'direct_recipe_v1'
                } } : {})
            },
            postEffectsCompleted: false,
            syncStatus: 'PENDING'
        };

        if (cloudCashierDecision?.useCloud) {
            let cloudResult;

            try {
                actorContext?.assertCurrent?.();
                cloudResult = await salesCloudCashierService.processCloudCashierSale({
                    sale,
                    processedItems,
                    paymentData: { ...safePaymentData, saleDiscount: saleDiscountAudit },
                    total: Money.toExactString(totalNum),
                    restaurantOrder: restaurantCheckoutOrder
                });
            } catch (cloudCashierError) {
                Logger.warn('Cloud cashier failed before local commit:', cloudCashierError);

                if (cloudCashierError.isFinancialOperationAmbiguous) return {
                    success: false, saleId: sale.id, code: 'CLOUD_COMMIT_UNCERTAIN', retryable: false,
                    financialIntentId: cloudCashierError.financialIntentId,
                    financialIdempotencyKey: cloudCashierError.financialIdempotencyKey,
                    financialResult: { status: 'unknown', sourceMode: 'cloud_uncertain', saleId: sale.id }
                };
                return withFinancialFailure({
                    success: false,
                    errorType: 'CLOUD_CASHIER_FAILED',
                    code: cloudCashierError.code || null,
                    cloudErrorCode: cloudCashierError.code || null,
                    message: cloudCashierError.message || 'No se pudo confirmar la venta cloud. No se cobró localmente para evitar duplicados.'
                });
            }

            const cloudSale = cloudResult.localSale || sale;
            let authorityCurrent = true;
            try { actorContext?.assertCurrent?.('pos'); } catch { authorityCurrent = false; }
            if (cloudResult.projectionDeferred || !authorityCurrent) return {
                success: true, saleId: sale.id, cloudCommitted: true,
                cloudSaleId: cloudResult.response?.sale?.id || null,
                financialIntentId: cloudResult.financialIntentId, projectionPending: Boolean(cloudResult.projectionDeferred),
                restaurantSettlement: cloudResult.restaurantSettlement || null,
                atomicRestaurantSettlement: cloudResult.atomicRestaurantSettlement === true,
                ...createFinancialNotificationResult({ financialResult: {
                    status: 'success', saleId: sale.id, sourceMode: 'cloud_committed', cloudCommitted: true
                } })
            };

            let postEffectsFailed = false;
            let postEffectsError = null;
            let notificationResult = notificationNotRequested();

            try {
                const postEffectsResult = await runPostSaleEffectsForCloudCommittedSale({
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
                notificationResult = postEffectsResult?.notificationResult || notificationResult;
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

            const financialResult = {
                status: 'success',
                saleId: cloudSale.id,
                cloudSaleId: cloudResult.response?.sale?.id || null,
                timestamp: cloudSale.timestamp,
                folio: cloudSale.folio,
                sourceMode: 'cloud_committed',
                cloudCommitted: true,
                restaurantSettlement: cloudResult.restaurantSettlement || cloudResult.response?.restaurant_settlement || null,
                atomicRestaurantSettlement: cloudResult.atomicRestaurantSettlement === true
            };

            return {
                success: true,
                saleId: cloudSale.id,
                cloudSaleId: cloudResult.response?.sale?.id || null,
                timestamp: cloudSale.timestamp,
                folio: cloudSale.folio,
                posFolio: cloudSale.posFolio || cloudSale.pos_folio || cloudResult.response?.sale?.pos_folio || cloudResult.response?.sale?.posFolio || null,
                sourceMode: 'cloud_committed',
                effectsStatus: cloudSale.effectsStatus || cloudResult.response?.sale?.effects_status || 'payment_recorded',
                inventoryEffectStatus: cloudSale.inventoryEffectStatus || cloudResult.response?.sale?.inventory_effect_status || 'not_applied',
                creditEffectStatus: cloudSale.creditEffectStatus || cloudResult.response?.sale?.credit_effect_status || 'not_applied',
                cloudCommitted: true,
                restaurantSettlement: cloudResult.restaurantSettlement || cloudResult.response?.restaurant_settlement || null,
                atomicRestaurantSettlement: cloudResult.atomicRestaurantSettlement === true,
                postEffectsFailed,
                postEffectsError: postEffectsFailed ? postEffectsError : null,
                pendingSyncRequired: false,
                inventoryChangesTracked: null,
                ...createFinancialNotificationResult({ financialResult, notificationResult })
            };
        }

        actorContext?.assertCurrent?.('pos');
        if (localBinding && !activeOrderId) throw new Error('LOCAL_CHECKOUT_ID_REQUIRED');
        if (localBinding) {
            sale.isLockedForCheckout = false;
            sale.localCommitBinding = localBinding;
            sale.localCheckoutAttemptId = attemptId;
        }
        const restoreCancellationIfAborted = persisted => {
            if (localBinding && persisted?.status === SALE_STATUS.OPEN && persisted.isLockedForCheckout === true &&
                persisted.checkoutAttemptId === attemptId && persisted.checkoutActorKey === localBinding.actorKey) {
                restoreAbortedCheckoutCancellation({ orderId: sale.id, checkoutAttemptId: attemptId, handle: actorContext });
            }
        };
        let transactionResult;
        forgetPrepaymentCheckout(sale.id, attemptId);
        try {
            transactionResult = actorContext
                ? await executeSaleTransactionSafe(sale, batchesToDeduct, {
                    assertAuthorized: () => assertSaleAuthority(actorContext, createsNewDebt),
                    subscribeAuthority: actorRuntimeController.subscribe
                })
                : await executeSaleTransactionSafe(sale, batchesToDeduct);
        } catch (error) {
            // Lost responses must be resolved by the existing sale ID, never
            // by issuing a second financial transaction.
            let persisted;
            try { persisted = await loadData(STORES.SALES, sale.id); }
            catch { return uncertainLocalCommit(sale.id); }
            if (sameLocalCommit(persisted, localBinding, attemptId)) return localCommitResult(persisted);
            restoreCancellationIfAborted(persisted);
            throw error;
        }
        if (!transactionResult.success && localBinding) {
            let persisted;
            try { persisted = await loadData(STORES.SALES, sale.id); }
            catch { return uncertainLocalCommit(sale.id); }
            if (sameLocalCommit(persisted, localBinding, attemptId)) return localCommitResult(persisted);
            restoreCancellationIfAborted(persisted);
        }
        if (transactionResult.success && actorContext) {
            try { actorContext.assertCurrent('pos'); }
            catch { return localCommitResult(sale); }
        }

        if (!transactionResult.success) {
            if (transactionResult.isConcurrencyError) {
                return withFinancialFailure({ success: false, errorType: 'RACE_CONDITION', message: 'El stock cambió mientras cobrabas. Intenta de nuevo.' });
            }

            const errorMessage = transactionResult.error?.message
                || transactionResult.message
                || 'Falló la transacción de venta sin un mensaje de error específico.';

            return withFinancialFailure({ success: false, message: errorMessage });
        }

        dispatchTickerInventoryAlert(transactionResult.criticalStockProductIds || []);

        let postEffectsFailed = false;
        let postEffectsError = null;
        let inventoryChanges = null;
        let notificationResult = notificationNotRequested();

        try {
            const postEffectsResult = await runPostSaleEffects({
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
            notificationResult = postEffectsResult?.notificationResult || notificationResult;
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

        const financialResult = {
            status: 'success',
            saleId: sale.id,
            timestamp: sale.timestamp,
            folio: sale.folio,
            sourceMode: 'local_committed',
            cloudCommitted: false
        };

        return {
            success: true,
            saleId: sale.id,
            timestamp: sale.timestamp,
            folio: sale.folio,
            postEffectsFailed,
            postEffectsError: postEffectsFailed ? postEffectsError : null,
            pendingSyncRequired: postEffectsFailed,
            inventoryChangesTracked: postEffectsFailed ? inventoryChanges : null,
            ...createFinancialNotificationResult({ financialResult, notificationResult })
        };
    } catch (error) {
        Logger.error('Service Error:', error);
        return withFinancialFailure({ success: false, code: error?.code || null, message: error.message });
    } finally {
        Logger.timeEnd('Service:ProcessSale');
    }
};

export const processSaleCoreInternals = Object.freeze({
    getEcommerceCheckout,
    sanitizePaymentData,
    applyAndValidateEcommerceSnapshot,
    getLineId,
    toCents,
    resolveStableSaleTimestamp,
    normalizeStableSaleTimestamp
});
