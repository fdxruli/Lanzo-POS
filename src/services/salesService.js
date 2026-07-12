import {
    db,
    loadData,
    saveData,
    STORES,
    queryBatchesByProductIdAndActive,
    queryByIndex,
    executeSaleTransactionSafe,
    executeSplitOpenTableOrderTransactionSafe,
    loadMultipleData,
    productsRepository
} from './database';
import { useStatsStore } from '../store/useStatsStore';
import { generateID, roundCurrency, sendWhatsAppMessage } from './utils';
import { calculatePricingDetails } from './pricingLogic';
import Logger from './Logger';
import { processSaleCore } from './sales/processSaleCore';
import { splitOpenTableOrderCore } from './sales/splitOrderService';
import { sendReceiptWhatsApp as sendReceiptWhatsAppBase } from './sales/receiptWhatsApp';
import { cancelSaleCore } from './sales/cancelSaleCore';
import { restoreDeletedSaleCore } from './sales/restoreDeletedSaleCore';
import { salesCloudCancellationService } from './salesCloud/salesCloudCancellationService';
import { isCloudCommittedSale } from './salesCloud/salesCloudCancellationMapper';

export { updateDailyStats, getFastDashboardStats } from './sales/statsService';

const ECOMMERCE_SALE_READ_FAILED = 'ECOMMERCE_SALE_READ_FAILED';
const ecommerceSalePromises = new Map();

const sendReceiptWhatsApp = (params) => sendReceiptWhatsAppBase({
    ...params,
    loadData,
    STORES,
    sendWhatsAppMessage,
    Logger
});

const _processSaleInternal = async (params) => {
    return processSaleCore(params, {
        loadData,
        saveData,
        STORES,
        queryBatchesByProductIdAndActive,
        queryByIndex,
        executeSaleTransactionSafe,
        loadMultipleData,
        useStatsStore,
        roundCurrency,
        sendReceiptWhatsApp,
        calculatePricingDetails,
        Logger
    });
};

const _splitOpenTableOrderInternal = async (params) => {
    return splitOpenTableOrderCore(params, {
        loadData,
        loadMultipleData,
        STORES,
        executeSplitOpenTableOrderTransactionSafe,
        useStatsStore,
        roundCurrency,
        sendReceiptWhatsApp,
        Logger
    });
};

const getEcommerceCheckoutContext = (params = {}) => {
    const checkout = params?.paymentData?.__ecommerceCheckout;
    return checkout?.origin === 'ecommerce' && checkout?.idempotencyKey
        ? checkout
        : null;
};

const isClosedSale = (sale = {}) => String(sale.status || '').toLowerCase() === 'closed';

const getSaleIdempotencyKey = (sale = {}) => (
    sale?.metadata?.idempotencyKey
    || sale?.metadata?.ecommerceConversionKey
    || sale?.idempotencyKey
    || null
);

const isMatchingEcommerceSale = (sale, checkout) => (
    Boolean(sale)
    && isClosedSale(sale)
    && Boolean(checkout?.idempotencyKey)
    && getSaleIdempotencyKey(sale) === checkout.idempotencyKey
);

const saleReadFailedResult = (error = null) => ({
    success: false,
    errorType: ECOMMERCE_SALE_READ_FAILED,
    code: ECOMMERCE_SALE_READ_FAILED,
    message: 'No se pudo comprobar si este pedido ya fue cobrado.',
    retryable: true,
    preserveEcommerceReservation: true,
    ...(error ? { cause: error } : {})
});

const readExistingEcommerceSale = async (params = {}) => {
    const checkout = getEcommerceCheckoutContext(params);
    if (!checkout) return { success: true, sale: null };

    try {
        if (params.activeOrderId) {
            const deterministicSale = await db.table(STORES.SALES).get(params.activeOrderId);
            if (isMatchingEcommerceSale(deterministicSale, checkout)) {
                return { success: true, sale: deterministicSale };
            }
        }

        const sale = await db.table(STORES.SALES)
            .filter((candidate) => isMatchingEcommerceSale(candidate, checkout))
            .first();
        return { success: true, sale: sale || null };
    } catch (error) {
        Logger.error('No se pudo consultar la idempotencia ecommerce antes de vender:', error);
        return {
            success: false,
            code: ECOMMERCE_SALE_READ_FAILED,
            message: 'No se pudo comprobar si este pedido ya fue cobrado.',
            error
        };
    }
};

const idempotentSaleResult = (sale) => ({
    success: true,
    saleId: sale.id,
    cloudSaleId: sale.cloudSaleId || sale.cloud_sale_id || null,
    timestamp: sale.timestamp,
    folio: sale.folio,
    idempotentReplay: true,
    postEffectsFailed: false,
    pendingSyncRequired: false
});

const normalizeEcommerceStockFailure = (result, checkout) => {
    if (!checkout || result?.success === true) return result;
    if (!['STOCK_WARNING', 'RACE_CONDITION'].includes(result?.errorType)) return result;

    return {
        success: false,
        errorType: 'ECOMMERCE_INVENTORY_CHANGED',
        code: 'ECOMMERCE_INVENTORY_CHANGED',
        message: 'El inventario cambió. Resuélvelo nuevamente.',
        originalErrorType: result.errorType
    };
};

const runProcessSaleWithRetry = async (params, maxRetries = 3) => {
    const ecommerceCheckout = getEcommerceCheckoutContext(params);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        if (ecommerceCheckout) {
            const initialRead = await readExistingEcommerceSale(params);
            if (initialRead.success === false) return saleReadFailedResult(initialRead.error);
            if (initialRead.sale) return idempotentSaleResult(initialRead.sale);
        }

        const rawResult = await _processSaleInternal(params);

        if (ecommerceCheckout && rawResult?.success !== true) {
            const verificationRead = await readExistingEcommerceSale(params);
            if (verificationRead.success === false) {
                return saleReadFailedResult(verificationRead.error);
            }
            if (verificationRead.sale) {
                return idempotentSaleResult(verificationRead.sale);
            }
        }

        const result = normalizeEcommerceStockFailure(rawResult, ecommerceCheckout);

        if (result.success) return result;

        if (ecommerceCheckout && result.errorType === 'ECOMMERCE_INVENTORY_CHANGED') {
            return result;
        }

        if (result.errorType === 'RACE_CONDITION' && attempt < maxRetries) {
            const delay = 100 * attempt;
            Logger.warn(`[Retry ${attempt}/${maxRetries}] Race condition detectada en inventario. Reintentando en ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
        }

        return result;
    }

    Logger.error('Fallo en venta tras multiples intentos de concurrencia.');
    return {
        success: false,
        errorType: 'MAX_RETRIES',
        message: 'El sistema esta muy ocupado. Por favor intenta cobrar de nuevo.'
    };
};

export const processSale = async (params, maxRetries = 3) => {
    Logger.info('Iniciando proceso de venta (Safe Mode)...');
    const ecommerceCheckout = getEcommerceCheckoutContext(params);
    if (!ecommerceCheckout) return runProcessSaleWithRetry(params, maxRetries);

    const key = ecommerceCheckout.idempotencyKey;
    if (ecommerceSalePromises.has(key)) return ecommerceSalePromises.get(key);

    const promise = runProcessSaleWithRetry(params, maxRetries);
    ecommerceSalePromises.set(key, promise);
    return promise.finally(() => {
        if (ecommerceSalePromises.get(key) === promise) ecommerceSalePromises.delete(key);
    });
};

export const splitOpenTableOrder = async (params, maxRetries = 3) => {
    Logger.info('Iniciando split bill de mesa (Safe Mode)...');

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const result = await _splitOpenTableOrderInternal(params);

        if (result.success) {
            return result;
        }

        if (result.errorType === 'RACE_CONDITION' && attempt < maxRetries) {
            const delay = 100 * attempt;
            Logger.warn(`[Retry ${attempt}/${maxRetries}] Race condition detectada en split bill. Reintentando en ${delay}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
        }

        return result;
    }

    Logger.error('Fallo en split bill tras multiples intentos de concurrencia.');
    return {
        success: false,
        errorType: 'MAX_RETRIES',
        message: 'El sistema esta muy ocupado. Por favor intenta dividir/cobrar de nuevo.'
    };
};

const findSaleForCancellation = async ({ saleId, timestamp, currentSales = [] }) => {
    const fromMemory = currentSales.find((sale) => (
        (saleId && (sale.id === saleId || sale.cloudSaleId === saleId || sale.cloud_sale_id === saleId)) ||
        (timestamp && sale.timestamp === timestamp)
    ));

    if (fromMemory) return fromMemory;
    if (!saleId) return null;

    try {
        return await db.table(STORES.SALES).get(saleId);
    } catch (error) {
        Logger.warn('No se pudo leer la venta local para decidir flujo de cancelacion:', error);
        return null;
    }
};

export const cancelSale = async ({
    saleId = null,
    timestamp,
    restoreStock = false,
    currentSales = [],
    dispositionPlan = null,
    reason = '',
    cancelledBy = 'local-user',
    allowWaste = false
}) => {
    const saleForCancellation = await findSaleForCancellation({ saleId, timestamp, currentSales });

    if (saleForCancellation && isCloudCommittedSale(saleForCancellation)) {
        try {
            const result = await salesCloudCancellationService.cancelCloudSale({
                sale: saleForCancellation,
                saleId: saleForCancellation.cloudSaleId || saleForCancellation.cloud_sale_id || saleForCancellation.id,
                reason
            });

            if (result.success) {
                try {
                    await useStatsStore.getState().rebuildFinancialStats();
                } catch (error) {
                    Logger.warn('La venta cloud se cancelo, pero no se pudieron reconstruir las metricas locales.', error);
                }
            }

            return result;
        } catch (error) {
            return {
                success: false,
                code: error?.code || 'CLOUD_CANCEL_FAILED',
                message: error?.message || 'No se pudo cancelar la venta cloud. No se aplico ningun cambio para evitar descuadres.',
                restoreStock: false,
                warnings: []
            };
        }
    }

    const result = await cancelSaleCore(
        {
            saleId,
            saleTimestamp: timestamp,
            restoreStock,
            currentSales,
            dispositionPlan,
            reason,
            cancelledBy,
            allowWaste
        },
        {
            STORES,
            db,
            Logger,
            generateId: generateID,
            restoreStockFromCancellation: (items) =>
                productsRepository.restoreStockFromCancellation(items)
        }
    );

    if (result.success) {
        try {
            if (result.restoreStock && result.restoredInventoryValue > 0) {
                await useStatsStore.getState().adjustInventoryValue(result.restoredInventoryValue);
            }
            await useStatsStore.getState().rebuildFinancialStats();
        } catch (error) {
            Logger.warn('La venta se cancelo, pero no se pudieron reconstruir las metricas financieras.', error);
        }
    }

    return result;
};

export const restoreDeletedSale = async (saleId) => {
    const result = await restoreDeletedSaleCore(
        { saleId },
        {
            db,
            STORES,
            Logger,
            generateId: generateID,
            reapplyStockFromCancellation: (items) =>
                productsRepository.reapplyStockFromCancellation(items)
        }
    );

    if (result.success) {
        try {
            await useStatsStore.getState().rebuildFinancialStats();
        } catch (error) {
            Logger.warn('La venta se restauro, pero no se pudieron reconstruir las metricas.', error);
        }
    }

    return result;
};

export const moveCancelledSaleToTrash = async (saleId) => {
    try {
        await db.transaction(
            'rw',
            [STORES.SALES, STORES.DELETED_SALES],
            async () => {
                const sale = await db.table(STORES.SALES).get(saleId);
                if (!sale) {
                    const error = new Error('La venta ya no existe en el historial.');
                    error.code = 'SALE_NOT_FOUND';
                    throw error;
                }

                await db.table(STORES.DELETED_SALES).put({
                    ...sale,
                    deletedAt: new Date().toISOString(),
                    originalId: sale.id
                });
                await db.table(STORES.SALES).delete(sale.id);
            }
        );

        return { success: true };
    } catch (error) {
        Logger.error('No se pudo mover la venta cancelada a la papelera:', error);
        return {
            success: false,
            code: error?.code || 'SALE_TRASH_FAILED',
            message: error?.message || 'No se pudo mover la venta a la papelera.'
        };
    }
};

export const salesServiceInternals = Object.freeze({
    ECOMMERCE_SALE_READ_FAILED,
    getEcommerceCheckoutContext,
    getSaleIdempotencyKey,
    isMatchingEcommerceSale,
    saleReadFailedResult,
    readExistingEcommerceSale,
    idempotentSaleResult,
    normalizeEcommerceStockFailure,
    runProcessSaleWithRetry,
    ecommerceSalePromises,
    clearEcommerceSalePromisesForTests: () => ecommerceSalePromises.clear()
});
