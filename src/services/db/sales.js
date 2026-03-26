import { db, STORES } from './dexie';
import {
    handleDexieError,
    DatabaseError,
    DB_ERROR_CODES,
    normalizeStock,
    getAvailableStock,
    getCommittedStock
} from './utils';
import { generateID } from '../utils';
import { Money } from '../../utils/moneyMath';
import { SALE_STATUS } from '../sales/financialStats';

const getRealProductId = (item) => item?.parentId || item?.id;
const isCommittedSaleItem = (item) => item?.inventoryReservation?.source === 'table';
const hasBatchDeductions = (item) => Array.isArray(item?.batchesUsed) && item.batchesUsed.length > 0;

const buildNonBatchSalesMap = (saleItems = []) => {
    const summary = new Map();

    (saleItems || []).forEach((item) => {
        if (hasBatchDeductions(item)) return;

        const productId = getRealProductId(item);
        if (!productId) return;

        const totalSold = normalizeStock(item?.stockDeducted ?? item?.quantity ?? 0);
        if (totalSold <= 0) return;

        const current = summary.get(productId) || { totalSold: 0, committedSold: 0 };
        current.totalSold = normalizeStock(current.totalSold + totalSold);

        if (isCommittedSaleItem(item)) {
            const committedQty = normalizeStock(item?.inventoryReservation?.committedQuantity ?? totalSold);
            current.committedSold = normalizeStock(current.committedSold + committedQty);
        }

        summary.set(productId, current);
    });

    return summary;
};

const buildInventoryError = (message) => {
    const error = new Error(message);
    error.isInventoryError = true;
    return error;
};

const buildConcurrencyError = (message) => {
    const error = new Error(message);
    error.isConcurrencyError = true;
    return error;
};

const collectAffectedProductIds = (sale, deductions = []) => {
    const affectedProductIds = new Set();

    (deductions || []).forEach(({ productId }) => {
        if (productId) affectedProductIds.add(productId);
    });

    if (Array.isArray(sale?.items)) {
        sale.items.forEach((item) => {
            const productId = getRealProductId(item);
            if (productId) affectedProductIds.add(productId);
        });
    }

    return affectedProductIds;
};

const loadBatchesCacheByProduct = async (affectedProductIds, tableBatches) => {
    const batchesCacheMap = new Map();

    await Promise.all(
        Array.from(affectedProductIds).map(async (productId) => {
            const productBatches = await tableBatches
                .where('productId')
                .equals(productId)
                .toArray();

            batchesCacheMap.set(productId, productBatches);
        })
    );

    return batchesCacheMap;
};

const applyBatchDeductions = async ({ deductions = [], batchesCacheMap, tableBatches }) => {
    for (const deduction of deductions || []) {
        const quantity = normalizeStock(deduction?.quantity);
        if (quantity <= 0) continue;

        const productBatches = batchesCacheMap.get(deduction.productId) || [];
        let batch = productBatches.find((candidate) => candidate.id === deduction.batchId);

        if (!batch) {
            batch = await tableBatches.get(deduction.batchId);
        }

        if (!batch) {
            throw buildInventoryError(
                `CRITICAL_BATCH_NOT_FOUND: El lote ${deduction.batchId} no existe.`
            );
        }

        if (normalizeStock(batch.stock) < quantity) {
            throw buildInventoryError(
                `STOCK_INSUFFICIENT: Lote ${batch.sku || deduction.batchId} tiene ${batch.stock}, se requiere ${quantity}.`
            );
        }

        if (deduction.fromCommittedStock) {
            const committedStock = getCommittedStock(batch);
            if (committedStock < quantity) {
                throw buildInventoryError(
                    `CRITICAL_COMMITTED_UNDERFLOW: Lote ${batch.sku || deduction.batchId} tiene ${committedStock} comprometido, ` +
                    `se intentan convertir ${quantity}.`
                );
            }
        } else if (getAvailableStock(batch) < quantity) {
            throw buildInventoryError(
                `STOCK_INSUFFICIENT: Lote ${batch.sku || deduction.batchId} solo tiene ${getAvailableStock(batch)} disponible, ` +
                `se requieren ${quantity}.`
            );
        }

        const updatedBatch = {
            ...batch,
            stock: normalizeStock(batch.stock - quantity),
            committedStock: deduction.fromCommittedStock
                ? normalizeStock(getCommittedStock(batch) - quantity)
                : getCommittedStock(batch),
            isActive: normalizeStock(batch.stock - quantity) > 0
        };

        const batchIndex = productBatches.findIndex((candidate) => candidate.id === deduction.batchId);
        if (batchIndex >= 0) {
            productBatches[batchIndex] = updatedBatch;
        }

        await tableBatches.put(updatedBatch);
    }
};

const syncParentProductsAfterSale = async ({
    affectedProductIds,
    batchesCacheMap,
    saleItems,
    tableMenu,
}) => {
    const nonBatchSalesMap = buildNonBatchSalesMap(saleItems);
    const productIdsArray = Array.from(affectedProductIds);

    // Lectura Masiva (Bulk Read)
    const products = await tableMenu.bulkGet(productIdsArray);

    const productsToUpdate = [];
    const timestamp = new Date().toISOString();

    // Procesamiento Síncrono en Memoria
    for (let i = 0; i < products.length; i++) {
        const product = products[i];

        if (!product || product.trackStock === false) continue;

        const productId = productIdsArray[i];

        if (product.batchManagement?.enabled) {
            const productBatches = batchesCacheMap.get(productId) || [];
            const totalStock = normalizeStock(
                productBatches
                    .filter((batch) => batch?.isActive && normalizeStock(batch.stock) > 0)
                    .reduce((sum, batch) => sum + normalizeStock(batch.stock), 0)
            );

            const totalCommittedStock = normalizeStock(
                productBatches.reduce((sum, batch) => sum + getCommittedStock(batch), 0)
            );

            productsToUpdate.push({
                ...product,
                stock: totalStock,
                committedStock: totalCommittedStock,
                updatedAt: timestamp
            });

            continue;
        }

        const nonBatchSale = nonBatchSalesMap.get(productId);
        if (!nonBatchSale || nonBatchSale.totalSold <= 0) continue;

        const retailSold = normalizeStock(nonBatchSale.totalSold - nonBatchSale.committedSold);
        if (retailSold > 0 && getAvailableStock(product) < retailSold) {
            throw buildInventoryError(
                `STOCK_INSUFFICIENT: Producto ${product.name} solo tiene ${getAvailableStock(product)} disponible, ` +
                `se requieren ${retailSold}.`
            );
        }

        if (nonBatchSale.committedSold > 0 && getCommittedStock(product) < nonBatchSale.committedSold) {
            throw buildInventoryError(
                `CRITICAL_COMMITTED_UNDERFLOW: Producto ${product.name} tiene ${getCommittedStock(product)} comprometido, ` +
                `se intentan convertir ${nonBatchSale.committedSold}.`
            );
        }

        const newStock = normalizeStock(Number(product.stock || 0) - nonBatchSale.totalSold);
        if (newStock < 0) {
            throw buildInventoryError(
                `STOCK_INSUFFICIENT: Producto ${product.name} tiene ${product.stock}, se requiere ${nonBatchSale.totalSold}.`
            );
        }

        productsToUpdate.push({
            ...product,
            stock: newStock,
            committedStock: nonBatchSale.committedSold > 0
                ? normalizeStock(getCommittedStock(product) - nonBatchSale.committedSold)
                : getCommittedStock(product),
            updatedAt: timestamp
        });
    }

    // Escritura Masiva (Bulk Write)
    if (productsToUpdate.length > 0) {
        await tableMenu.bulkPut(productsToUpdate);
    }
};

const applyCustomerCreditCharge = async ({ sale, tables }) => {
    const saldoSafe = Money.init(sale.saldoPendiente);

    if (sale.paymentMethod !== 'fiado' || !sale.customerId || saldoSafe.lte(0)) {
        return;
    }

    // Falla rápida: Si la orden exige fiado pero las dependencias no existen, la integridad de los datos está comprometida. No ignorar.
    if (!tables.customers || !tables.customerLedger) {
        throw new Error(`Integridad Crítica: Se solicitó fiado para el cliente ${sale.customerId}, pero las tablas no fueron provisionadas en el pre-flight.`);
    }

    const customer = await tables.customers.get(sale.customerId);
    if (!customer) {
        throw new Error(`Integridad Crítica: El cliente ${sale.customerId} no existe para el cargo a crédito.`);
    }

    const timestamp = new Date().toISOString();

    await tables.customerLedger.add({
        id: generateID('chg'),
        customerId: sale.customerId,
        type: 'CHARGE',
        amount: Money.toExactString(saldoSafe),
        reference: sale.id,
        timestamp
    });

    const currentDebt = Money.init(customer.debt || 0);
    const newDebt = Money.add(currentDebt, saldoSafe);

    await tables.customers.update(sale.customerId, {
        debt: Money.toExactString(newDebt),
        updatedAt: timestamp
    });
};

const persistSaleAndLog = async ({ sale, tables, logType = 'SALE', extraLogFields = {} }) => {
    const saleToSave = {
        ...sale,
        status: sale.status ?? SALE_STATUS.CLOSED,
        postEffectsCompleted: true
    };

    await tables.sales.put(saleToSave);

    const transactionId = generateID('txn');
    await tables.transactionLog.add({
        id: transactionId,
        type: logType,
        status: 'COMPLETED',
        timestamp: new Date().toISOString(),
        amount: sale.total,
        saleId: sale.id,
        ...extraLogFields
    });

    return transactionId;
};

const processSaleWithinTransaction = async ({ sale, deductions = [], tables, logType = 'SALE', extraLogFields = {} }) => {
    const existingSale = await tables.sales.get(sale.id);
    if (existingSale) {
        if (existingSale.status !== SALE_STATUS.OPEN) {
            throw new DatabaseError(
                DB_ERROR_CODES.CONSTRAINT_VIOLATION,
                'La venta ya fue procesada anteriormente.'
            );
        }
    }

    const affectedProductIds = collectAffectedProductIds(sale, deductions);
    const batchesCacheMap = await loadBatchesCacheByProduct(affectedProductIds, tables.batches);

    await applyBatchDeductions({
        deductions,
        batchesCacheMap,
        tableBatches: tables.batches
    });

    await syncParentProductsAfterSale({
        affectedProductIds,
        batchesCacheMap,
        saleItems: sale?.items || [],
        tableMenu: tables.menu
    });

    await applyCustomerCreditCharge({
        sale,
        tables
    });

    const transactionId = await persistSaleAndLog({
        sale,
        tables,
        logType,
        extraLogFields
    });

    return { success: true, transactionId };
};

// Pre-flight check dinámico. Evalúa el array de ventas y extrae las dependencias de tablas requeridas.
const resolveRequiredStoreNames = (salesPayloads = []) => {
    const stores = new Set([
        STORES.SALES,
        STORES.PRODUCT_BATCHES,
        STORES.MENU,
        STORES.TRANSACTION_LOG
    ]);

    const sales = Array.isArray(salesPayloads) ? salesPayloads : [salesPayloads];

    for (const sale of sales) {
        // Bloquear si hay customerId para soportar lealtad, historial, o créditos
        if (sale?.customerId) {
            stores.add(STORES.CUSTOMERS);
            stores.add(STORES.CUSTOMER_LEDGER);
        }
    }

    return Array.from(stores);
};

// Inyector condicional de dependencias
const buildTransactionTables = (lockedStores = []) => {
    const tables = {};
    if (lockedStores.includes(STORES.SALES)) tables.sales = db.table(STORES.SALES);
    if (lockedStores.includes(STORES.PRODUCT_BATCHES)) tables.batches = db.table(STORES.PRODUCT_BATCHES);
    if (lockedStores.includes(STORES.MENU)) tables.menu = db.table(STORES.MENU);
    if (lockedStores.includes(STORES.TRANSACTION_LOG)) tables.transactionLog = db.table(STORES.TRANSACTION_LOG);
    if (lockedStores.includes(STORES.CUSTOMERS)) tables.customers = db.table(STORES.CUSTOMERS);
    if (lockedStores.includes(STORES.CUSTOMER_LEDGER)) tables.customerLedger = db.table(STORES.CUSTOMER_LEDGER);
    return tables;
};

export const salesRepository = {

    async executeSaleTransaction(sale, deductions) {
        try {
            const lockedStoreNames = resolveRequiredStoreNames(sale);
            const dexieTablesToLock = lockedStoreNames.map(name => db.table(name));

            return await db.transaction('rw', dexieTablesToLock, async () => {
                const tables = buildTransactionTables(lockedStoreNames);
                return processSaleWithinTransaction({
                    sale,
                    deductions,
                    tables,
                    logType: 'SALE'
                });
            });

        } catch (error) {
            if (error?.isInventoryError || (error?.message && error.message.includes('STOCK_INSUFFICIENT'))) {
                return {
                    success: false,
                    isStockError: true,
                    message: error.message
                };
            }

            throw handleDexieError(error, 'Execute Sale Transaction');
        }
    },

    async executeSplitOpenTableOrderTransaction({
        parentOrderId,
        parentExpectedVersion = null,
        splitGroupId,
        childPayloads = []
    }) {
        try {
            if (!parentOrderId) {
                throw new Error('SPLIT_ORDER_INVALID: parentOrderId es obligatorio.');
            }

            if (!Array.isArray(childPayloads) || childPayloads.length !== 2) {
                throw new Error('SPLIT_ORDER_INVALID: Se requieren exactamente dos tickets hijos.');
            }

            const salesToEvaluate = childPayloads.map(p => p.sale);
            const lockedStoreNames = resolveRequiredStoreNames(salesToEvaluate);
            const dexieTablesToLock = lockedStoreNames.map(name => db.table(name));

            return await db.transaction('rw', dexieTablesToLock, async () => {
                const tables = buildTransactionTables(lockedStoreNames);
                const parentSale = await tables.sales.get(parentOrderId);

                if (!parentSale) {
                    throw buildConcurrencyError('La orden padre ya no existe.');
                }

                if (parentSale.status !== SALE_STATUS.OPEN) {
                    throw buildConcurrencyError('La orden padre ya no está abierta.');
                }

                if (parentSale.orderType !== 'table') {
                    throw new Error('SPLIT_ORDER_INVALID: Solo se pueden dividir órdenes de mesa.');
                }

                const currentVersion = parentSale.updatedAt || parentSale.timestamp || null;
                if (parentExpectedVersion && currentVersion !== parentExpectedVersion) {
                    throw buildConcurrencyError('La orden padre cambió antes de confirmar el split.');
                }

                const childSaleIds = [];

                for (const childPayload of childPayloads) {
                    const childSale = childPayload?.sale;
                    const childDeductions = childPayload?.deductions || [];

                    if (!childSale?.id) {
                        throw new Error('SPLIT_ORDER_INVALID: Ticket hijo sin id de venta.');
                    }

                    const result = await processSaleWithinTransaction({
                        sale: childSale,
                        deductions: childDeductions,
                        tables,
                        logType: 'SPLIT_CHILD',
                        extraLogFields: {
                            splitGroupId,
                            splitParentId: parentOrderId,
                            splitLabel: childSale.splitLabel || null
                        }
                    });

                    if (!result.success) {
                        throw new Error('SPLIT_ORDER_INVALID: No se pudo procesar ticket hijo.');
                    }

                    childSaleIds.push(childSale.id);
                }

                const nowIso = new Date().toISOString();
                const parentUpdated = {
                    ...parentSale,
                    status: SALE_STATUS.CANCELLED,
                    fulfillmentStatus: 'cancelled',
                    cancelReason: 'split_settled',
                    splitGroupId,
                    splitChildIds: childSaleIds,
                    splitSettledAt: nowIso,
                    updatedAt: nowIso
                };

                await tables.sales.put(parentUpdated);

                await tables.transactionLog.add({
                    id: generateID('txn'),
                    type: 'SPLIT_PARENT_CANCEL',
                    status: 'COMPLETED',
                    timestamp: nowIso,
                    amount: parentSale.total,
                    saleId: parentSale.id,
                    splitGroupId,
                    splitChildIds: childSaleIds
                });

                return {
                    success: true,
                    splitGroupId,
                    parentOrderId,
                    childSaleIds
                };
            });
        } catch (error) {
            if (error?.isInventoryError || (error?.message && error.message.includes('STOCK_INSUFFICIENT'))) {
                return {
                    success: false,
                    isStockError: true,
                    message: error.message
                };
            }

            if (error?.isConcurrencyError) {
                return {
                    success: false,
                    isConcurrencyError: true,
                    message: error.message
                };
            }

            throw handleDexieError(error, 'Execute Split Open Table Order Transaction');
        }
    },

    async getOrdersSince(isoDateString) {
        try {
            return await db.table(STORES.SALES)
                .where('timestamp').aboveOrEqual(isoDateString)
                .toArray();
        } catch (error) {
            throw handleDexieError(error, 'Get Orders Since');
        }
    },

    async getHistorySalesSince(isoDateString) {
        try {
            const allSales = await db.table(STORES.SALES)
                .where('timestamp').aboveOrEqual(isoDateString)
                .reverse()
                .toArray();

            return allSales.filter(sale =>
                !sale.splitParentId &&
                sale.status === SALE_STATUS.CLOSED
            );
        } catch (error) {
            throw handleDexieError(error, 'Get History Sales Since');
        }
    },

    async getSalesByIds(saleIds = []) {
        try {
            if (!saleIds.length) return [];
            return await db.table(STORES.SALES).where('id').anyOf(saleIds).toArray();
        } catch (error) {
            throw handleDexieError(error, 'Get Sales By Ids');
        }
    }
};