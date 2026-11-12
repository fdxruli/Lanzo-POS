import { db, STORES } from './dexie';
import { handleDexieError, getCommittedStock, normalizeStock } from './utils';
import { getOperationalStockSnapshot } from '../inventoryStock';
import { getInventoryQuantityForSale } from '../sales/stockValidation';
import { isBatchExpiredForSale } from '../../utils/dateUtils';
import { generateID } from '../utils';
import { SALE_STATUS, buildDailyStatsFromSales } from '../sales/financialStats';
import { getFinancialQuality } from '../sales/financialPolicy';
import { Money } from '../../utils/moneyMath';
import { registrarMovimientoCajaEnTransaccion } from '../cajaService';
import { auditLayawayFinancialLinks } from '../layawayFinancialProjection';
import { isCanonicalCashStation, isLocalStationKey } from '../cash/cashStation';
import {
    ACTOR_RUNTIME_ERROR_CODES,
    ActorRuntimeError
} from '../auth/actorRuntimeController';

const nowIso = () => new Date().toISOString();

const requireRefundActorAssertion = (assertActorCurrent, operation) => {
    if (typeof assertActorCurrent !== 'function') {
        throw new ActorRuntimeError(ACTOR_RUNTIME_ERROR_CODES.SESSION_REQUIRED, { operation });
    }
    return assertActorCurrent;
};

const buildPaymentRecord = (payment, fallbackAmount, fallbackType = 'installment') => ({
    id: payment?.id || generateID('pay'),
    amount: fallbackAmount,
    date: payment?.date || nowIso(),
    type: payment?.type || fallbackType,
    paymentType: payment?.paymentType || payment?.type || fallbackType,
    status: payment?.status || 'pending',
    ...payment
});

const buildCashPaymentLink = (cashSessionId, evidence = {}) => {
    const suppliedStationId = evidence.cashStationId
        || evidence.cash_station_id
        || evidence.metadata?.cashStationId
        || evidence.metadata?.cash_station_id
        || null;
    const cashStationId = isCanonicalCashStation(suppliedStationId) ? suppliedStationId : null;
    const localStationKey = evidence.localStationKey
        || evidence.local_station_key
        || evidence.metadata?.localStationKey
        || evidence.metadata?.local_station_key
        || (isLocalStationKey(suppliedStationId) ? suppliedStationId : null);
    const actorKey = evidence.actorKey
        || evidence.actor_key
        || evidence.metadata?.actorKey
        || evidence.metadata?.actor_key
        || null;
    const originActorGeneration = evidence.originActorGeneration
        ?? evidence.metadata?.originActorGeneration
        ?? evidence.metadata?.origin_actor_generation
        ?? null;

    return {
        cashSessionId,
        // Retained for historical report/reconciliation compatibility.
        cajaId: cashSessionId,
        cash_session_id: cashSessionId,
        ...(cashStationId ? { cashStationId } : {}),
        ...(localStationKey ? { localStationKey } : {}),
        ...(actorKey ? { actorKey } : {}),
        ...(originActorGeneration !== null ? { originActorGeneration } : {})
    };
};

const transactionTables = ({ cash = false, stock = false } = {}) => [
    db.table(STORES.LAYAWAYS),
    ...(stock ? [db.table(STORES.PRODUCT_BATCHES), db.table(STORES.MENU)] : []),
    ...(cash ? [db.table(STORES.CAJAS), db.table(STORES.MOVIMIENTOS_CAJA)] : [])
];


const inventoryError = (code, message) => {
    const error = new Error(`${code}: ${message}`);
    error.code = code;
    return error;
};

const accountingMode = (layaway) => {
    if (layaway?.sourceMode === 'cloud_committed' || layaway?.cloudLayaway === true) {
        throw inventoryError('LAYAWAY_CLOUD_PROJECTION', 'El apartado Cloud solo puede modificarse en el servidor.');
    }
    if (layaway?.inventoryAccountingMode === 'reserved_v1'
        && (layaway?.sourceMode == null || layaway.sourceMode === 'local')) return 'reserved_v1';
    if (layaway?.inventoryAccountingMode == null
        && layaway?.reservedInventory == null
        && (layaway?.sourceMode == null || layaway.sourceMode === 'local')) return 'legacy';
    throw inventoryError('LAYAWAY_ORIGIN_AMBIGUOUS', 'No se puede determinar el origen contable de este apartado.');
};

const assertStockSnapshot = (record, name) => {
    const snapshot = getOperationalStockSnapshot(record);
    if (!snapshot.valid || snapshot.physicalStock < 0 || snapshot.committedStock > snapshot.physicalStock + 0.00001) {
        throw inventoryError('LAYAWAY_STOCK_UNKNOWN', `El inventario de ${name} es inconsistente.`);
    }
    return snapshot;
};

const getItemProductId = (item) => {
    if (item.productId && item.parentId && item.productId !== item.parentId) {
        throw inventoryError('LAYAWAY_PRODUCT_MISMATCH', 'La variante no corresponde a su producto.');
    }
    return item.productId || item.parentId || item.id;
};

const getItemQuantity = (item, product) => {
    const requested = Number(item?.quantity);
    if (!Number.isFinite(requested) || requested <= 0) {
        throw inventoryError('LAYAWAY_QUANTITY_INVALID', 'La cantidad del apartado debe ser positiva.');
    }
    const quantity = normalizeStock(getInventoryQuantityForSale(item, product));
    if (!Number.isFinite(quantity) || quantity <= 0) {
        throw inventoryError('LAYAWAY_QUANTITY_INVALID', 'La cantidad de inventario no es válida.');
    }
    return quantity;
};

const getProduct = async (productId, { allowInactive = false } = {}) => {
    const product = productId && await db.table(STORES.MENU).get(productId);
    if (!product || (!allowInactive && (product.deletedAt || product.isActive === false))) {
        throw inventoryError('LAYAWAY_PRODUCT_NOT_FOUND', `Producto inexistente o inactivo: ${productId || 'sin ID'}.`);
    }
    if (product.trackStock !== true && product.trackStock !== false) {
        throw inventoryError('LAYAWAY_TRACKING_UNKNOWN', 'El producto no tiene una configuración de inventario verificable.');
    }
    return product;
};

const syncBatchParent = async (productId, { physical = false } = {}) => {
    const batches = await db.table(STORES.PRODUCT_BATCHES).where('productId').equals(productId).toArray();
    const parent = await db.table(STORES.MENU).get(productId);
    if (!parent) throw inventoryError('LAYAWAY_PRODUCT_NOT_FOUND', 'El producto padre ya no existe.');
    const updates = {
        committedStock: normalizeStock(batches.reduce((total, batch) => total + getCommittedStock(batch), 0)),
        updatedAt: nowIso()
    };
    if (physical) {
        updates.stock = normalizeStock(batches.reduce((total, batch) =>
            total + (batch.isActive !== false && batch.stock > 0 ? normalizeStock(batch.stock) : 0), 0));
    }
    await db.table(STORES.MENU).update(productId, updates);
};

const reserveCommittedStock = async (layawayData) => {
    if (!layawayData?.customerId || !Array.isArray(layawayData.items) || layawayData.items.length === 0) {
        throw inventoryError('LAYAWAY_ITEMS_INVALID', 'El apartado requiere cliente y productos.');
    }
    const reservations = [];
    const untrackedLineIndexes = [];
    const batchParents = new Set();

    for (const [lineIndex, item] of layawayData.items.entries()) {
        const productId = getItemProductId(item);
        const product = await getProduct(productId);
        const quantity = getItemQuantity(item, product);
        if (item.isVariant && !item.batchId) {
            throw inventoryError('LAYAWAY_BATCH_REQUIRED', 'La variante debe identificar su lote.');
        }
        if (item.batchId && !product.batchManagement?.enabled) {
            throw inventoryError('LAYAWAY_BATCH_MISMATCH', 'El lote no pertenece a un producto por lotes.');
        }
        if (product.trackStock === false) {
            if (item.batchId) {
                const batch = await db.table(STORES.PRODUCT_BATCHES).get(item.batchId);
                if (!batch || batch.productId !== productId) {
                    throw inventoryError('LAYAWAY_BATCH_MISMATCH', 'El lote no pertenece al producto.');
                }
            }
            untrackedLineIndexes.push(lineIndex);
            continue;
        }

        if (!product.batchManagement?.enabled) {
            const stock = assertStockSnapshot(product, product.name);
            if (stock.availableStock + 0.00001 < quantity) {
                throw inventoryError('LAYAWAY_STOCK_INSUFFICIENT', `Solo hay ${stock.availableStock} libres de ${product.name}.`);
            }
            await db.table(STORES.MENU).update(productId, {
                committedStock: normalizeStock(getCommittedStock(product) + quantity),
                updatedAt: nowIso()
            });
            reservations.push({ lineIndex, productId, quantity });
            continue;
        }

        const allBatches = item.batchId
            ? [await db.table(STORES.PRODUCT_BATCHES).get(item.batchId)]
            : await db.table(STORES.PRODUCT_BATCHES).where('productId').equals(productId).toArray();
        if (item.batchId && (!allBatches[0] || allBatches[0].productId !== productId)) {
            throw inventoryError('LAYAWAY_BATCH_MISMATCH', 'El lote no existe o no pertenece al producto.');
        }
        const eligible = allBatches.filter((batch) => batch && batch.productId === productId
            && batch.isActive !== false && batch.status !== 'inactive'
            && (product.expirationMode !== 'STRICT' || Boolean(batch.expiryDate))
            && !isBatchExpiredForSale(batch, product));
        eligible.sort((left, right) => String(left.expiryDate || '9999').localeCompare(String(right.expiryDate || '9999'))
            || String(left.createdAt || '').localeCompare(String(right.createdAt || ''))
            || String(left.id).localeCompare(String(right.id)));
        let pending = quantity;
        for (const batch of eligible) {
            const stock = assertStockSnapshot(batch, batch.sku || batch.id);
            const allocation = normalizeStock(Math.min(pending, stock.availableStock));
            if (allocation <= 0) continue;
            await db.table(STORES.PRODUCT_BATCHES).update(batch.id, {
                committedStock: normalizeStock(getCommittedStock(batch) + allocation),
                updatedAt: nowIso()
            });
            reservations.push({ lineIndex, productId, batchId: batch.id, quantity: allocation });
            batchParents.add(productId);
            pending = normalizeStock(pending - allocation);
            if (pending <= 0) break;
        }
        if (pending > 0.00001) {
            throw inventoryError('LAYAWAY_STOCK_INSUFFICIENT', `No hay suficientes unidades libres de ${product.name} en sus lotes.`);
        }
    }
    for (const productId of batchParents) await syncBatchParent(productId);
    return { reservations, untrackedLineIndexes };
};

const applyReservedStock = async (layaway, { deliver = false } = {}) => {
    if (!Array.isArray(layaway.reservedInventory) || !Array.isArray(layaway.items)
        || !Array.isArray(layaway.untrackedInventoryLines)) {
        throw inventoryError('LAYAWAY_RESERVATION_MISSING', 'La reserva no tiene asignación verificable.');
    }
    const untracked = new Set(layaway.untrackedInventoryLines);
    if (untracked.size !== layaway.untrackedInventoryLines.length
        || [...untracked].some((index) => !Number.isInteger(index) || index < 0 || index >= layaway.items.length)) {
        throw inventoryError('LAYAWAY_RESERVATION_INVALID', 'La reserva contiene líneas no válidas.');
    }
    const expected = new Map();
    for (const [index, item] of layaway.items.entries()) {
        const productId = getItemProductId(item);
        const product = await getProduct(productId, { allowInactive: true });
        if (!untracked.has(index)) expected.set(index, getItemQuantity(item, product));
    }
    const received = new Map();
    for (const entry of layaway.reservedInventory) {
        const qty = Number(entry?.quantity);
        if (!Number.isInteger(entry?.lineIndex) || !expected.has(entry.lineIndex)
            || !entry.productId || !Number.isFinite(qty) || qty <= 0
            || normalizeStock(qty) !== qty
            || getItemProductId(layaway.items[entry.lineIndex]) !== entry.productId) {
            throw inventoryError('LAYAWAY_RESERVATION_INVALID', 'La reserva persistida no coincide con los productos.');
        }
        received.set(entry.lineIndex, normalizeStock((received.get(entry.lineIndex) || 0) + qty));
    }
    for (const [index, qty] of expected) {
        if (Math.abs(qty - (received.get(index) || 0)) > 0.00001) {
            throw inventoryError('LAYAWAY_RESERVATION_INVALID', 'La reserva no cubre las unidades del apartado.');
        }
    }

    const batchParents = new Set();
    const physicalDeductions = new Map();
    for (const entry of layaway.reservedInventory) {
        const table = db.table(entry.batchId ? STORES.PRODUCT_BATCHES : STORES.MENU);
        const record = await table.get(entry.batchId || entry.productId);
        if (!record || (entry.batchId && record.productId !== entry.productId)) {
            throw inventoryError('LAYAWAY_RESERVATION_MISSING', 'El producto o lote reservado ya no existe.');
        }
        const qty = entry.quantity;
        const currentCommitted = getCommittedStock(record);
        if (currentCommitted + 0.00001 < qty) {
            throw inventoryError('LAYAWAY_COMMITTED_UNDERFLOW', 'No existe suficiente inventario comprometido para este apartado.');
        }
        const physical = assertStockSnapshot(record, entry.batchId || entry.productId).physicalStock;
        if (deliver && physical + 0.00001 < qty) {
            throw inventoryError('LAYAWAY_PHYSICAL_UNDERFLOW', 'El inventario físico no alcanza para entregar.');
        }
        await table.update(entry.batchId || entry.productId, {
            committedStock: normalizeStock(currentCommitted - qty),
            ...(deliver ? { stock: normalizeStock(physical - qty) } : {}),
            ...(deliver && entry.batchId && physical - qty <= 0 ? { isActive: false } : {}),
            updatedAt: nowIso()
        });
        if (entry.batchId) batchParents.add(entry.productId);
        if (deliver) {
            physicalDeductions.set(entry.productId, normalizeStock((physicalDeductions.get(entry.productId) || 0) + qty));
        }
    }
    for (const productId of batchParents) await syncBatchParent(productId, { physical: deliver });
    return physicalDeductions;
};

const restoreStock = async (layaway) => {
    const productsToSync = new Set();

    for (const item of layaway.items || []) {
        if (item.batchId) {
            const batch = await db.table(STORES.PRODUCT_BATCHES).get(item.batchId);
            if (!batch) continue;
            await db.table(STORES.PRODUCT_BATCHES).update(item.batchId, {
                stock: batch.stock + item.quantity,
                isActive: true,
                updatedAt: nowIso()
            });
            productsToSync.add(batch.productId);
        } else {
            const productId = item.parentId || item.id;
            const product = await db.table(STORES.MENU).get(productId);
            if (product?.trackStock) {
                await db.table(STORES.MENU).update(productId, { stock: product.stock + item.quantity });
            }
        }
    }

    for (const productId of productsToSync) {
        const allBatches = await db.table(STORES.PRODUCT_BATCHES)
            .where('productId').equals(productId).toArray();
        const totalStock = allBatches.reduce(
            (sum, batch) => (batch.isActive && batch.stock > 0 ? sum + batch.stock : sum),
            0
        );
        await db.table(STORES.MENU).update(productId, { stock: totalStock, updatedAt: nowIso() });
    }
};

export const layawayRepository = {
    async create(layawayData, initialPayment = 0, cashSessionId = null, options = {}) {
        try {
            if (layawayData?.sourceMode === 'cloud_committed' || layawayData?.cloudLayaway === true) {
                throw inventoryError('LAYAWAY_CLOUD_PROJECTION', 'No se pueden crear reservas Local desde una proyección Cloud.');
            }
            const cashMovement = options.cashMovement || null;
            if (initialPayment > 0 && !cashMovement) {
                throw new Error('El anticipo debe registrarse mediante la ruta canonica de Caja.');
            }

            return await db.transaction('rw', transactionTables({ cash: Boolean(cashMovement), stock: true }), async (tx) => {
                const { reservations: reservedInventory, untrackedLineIndexes: untrackedInventoryLines } = await reserveCommittedStock(layawayData);

                const now = nowIso();
                const newLayaway = {
                    ...layawayData,
                    sourceMode: 'local',
                    inventoryAccountingMode: 'reserved_v1',
                    reservedInventory,
                    untrackedInventoryLines,
                    status: 'active',
                    paidAmount: initialPayment,
                    createdAt: layawayData.createdAt || now,
                    updatedAt: now,
                    payments: options.pendingPayment
                        ? [buildPaymentRecord(options.pendingPayment, options.pendingPayment.amount, options.pendingPayment.type || 'initial_deposit')]
                        : []
                };

                if (initialPayment > 0) {
                    const payment = buildPaymentRecord(options.payment, initialPayment, 'initial_deposit');
                    const movementResult = await registrarMovimientoCajaEnTransaccion(
                        tx,
                        cashSessionId,
                        'entrada',
                        initialPayment,
                        `Anticipo Apartado #${layawayData.id.slice(-4)} - ${layawayData.customerName}`,
                        cashMovement
                    );
                    newLayaway.payments.push({
                        ...payment,
                        amount: initialPayment,
                        status: 'confirmed',
                        cashMovementId: movementResult.movimiento.id,
                        ...buildCashPaymentLink(cashSessionId, cashMovement)
                    });
                }

                await tx.table(STORES.LAYAWAYS).add(newLayaway);
                return { success: true, layaway: newLayaway };
            });
        } catch (error) {
            if (String(error?.code || '').startsWith('LAYAWAY_')) throw error;
            throw handleDexieError(error, 'Create Layaway');
        }
    },

    async addPayment(layawayId, paymentOrAmount, cashSessionId = null) {
        const payment = typeof paymentOrAmount === 'object'
            ? buildPaymentRecord(paymentOrAmount, paymentOrAmount.amount)
            : buildPaymentRecord({ amount: paymentOrAmount, cashSessionId }, paymentOrAmount);

        try {
            return await db.transaction('rw', db.table(STORES.LAYAWAYS), async () => {
                const layaway = await db.table(STORES.LAYAWAYS).get(layawayId);
                if (!layaway) throw new Error('Apartado no encontrado');

                const existing = (layaway.payments || []).find((item) => item.id === payment.id);
                if (existing) return { success: true, duplicate: true, payment: existing, newPaidAmount: layaway.paidAmount || 0 };

                const isConfirmed = payment.status === 'confirmed';
                const newPaidAmount = (layaway.paidAmount || 0) + (isConfirmed ? Number(payment.amount) : 0);
                if (isConfirmed && newPaidAmount > Number(layaway.totalAmount) + 0.01) {
                    throw new Error('El monto excede la deuda pendiente.');
                }

                const updates = {
                    paidAmount: newPaidAmount,
                    updatedAt: nowIso(),
                    status: isConfirmed && newPaidAmount >= Number(layaway.totalAmount) - 0.01 ? 'ready' : layaway.status,
                    payments: [...(layaway.payments || []), payment]
                };
                await db.table(STORES.LAYAWAYS).update(layawayId, updates);
                return { success: true, payment, newPaidAmount, isFullyPaid: updates.status === 'ready' };
            });
        } catch (error) {
            throw handleDexieError(error, 'Add Layaway Payment');
        }
    },

    async addPaymentWithCash(layawayId, paymentData, cashSessionId, cashMovement) {
        return db.transaction('rw', transactionTables({ cash: true }), async (tx) => {
            const layaway = await tx.table(STORES.LAYAWAYS).get(layawayId);
            if (!layaway) throw new Error('Apartado no encontrado');
            const existing = (layaway.payments || []).find((payment) => payment.id === paymentData.id);
            if (existing?.status === 'confirmed') return { success: true, duplicate: true, payment: existing, newPaidAmount: layaway.paidAmount || 0 };

            const payment = buildPaymentRecord({ ...paymentData, status: 'confirmed' }, paymentData.amount);
            const newPaidAmount = Number(layaway.paidAmount || 0) + Number(payment.amount);
            if (newPaidAmount > Number(layaway.totalAmount) + 0.01) throw new Error('El monto excede la deuda pendiente.');

            const movementResult = await registrarMovimientoCajaEnTransaccion(
                tx,
                cashSessionId,
                'entrada',
                payment.amount,
                `Abono Apartado #${layawayId.slice(-4)} - ${layaway.customerName}`,
                cashMovement
            );
            const cashPaymentLink = buildCashPaymentLink(cashSessionId, cashMovement);
            const payments = existing
                ? (layaway.payments || []).map((item) => item.id === payment.id
                    ? { ...payment, cashMovementId: movementResult.movimiento.id, ...cashPaymentLink }
                    : item)
                : [...(layaway.payments || []), { ...payment, cashMovementId: movementResult.movimiento.id, ...cashPaymentLink }];
            const updated = {
                paidAmount: newPaidAmount,
                payments,
                updatedAt: nowIso(),
                status: newPaidAmount >= Number(layaway.totalAmount) - 0.01 ? 'ready' : layaway.status
            };
            await tx.table(STORES.LAYAWAYS).update(layawayId, updated);
            return { success: true, payment: payments.find((item) => item.id === payment.id), newPaidAmount, isFullyPaid: updated.status === 'ready' };
        });
    },

    async confirmPayment(layawayId, paymentId, cashMovementId, cashSessionId = null) {
        return db.transaction('rw', db.table(STORES.LAYAWAYS), async () => {
            const layaway = await db.table(STORES.LAYAWAYS).get(layawayId);
            if (!layaway) throw new Error('Apartado no encontrado');
            const current = (layaway.payments || []).find((payment) => payment.id === paymentId);
            if (!current) throw new Error('Pago de apartado pendiente no encontrado');
            if (current.status === 'confirmed') return { success: true, duplicate: true, payment: current, layaway };

            const amount = Number(current.amount);
            const paidAmount = Number(layaway.paidAmount || 0) + amount;
            const cashPaymentLink = buildCashPaymentLink(cashSessionId, current);
            const payments = (layaway.payments || []).map((payment) => payment.id === paymentId
                ? { ...payment, status: 'confirmed', cashMovementId, ...cashPaymentLink }
                : payment);
            const updated = {
                paidAmount,
                payments,
                updatedAt: nowIso(),
                status: paidAmount >= Number(layaway.totalAmount) - 0.01 ? 'ready' : layaway.status
            };
            await db.table(STORES.LAYAWAYS).update(layawayId, updated);
            return { success: true, payment: payments.find((payment) => payment.id === paymentId), layaway: { ...layaway, ...updated } };
        });
    },

    async beginRefund(layawayId, refund, { assertActorCurrent } = {}) {
        const assertCurrent = requireRefundActorAssertion(assertActorCurrent, 'layaway.beginRefund');
        return db.transaction('rw', db.table(STORES.LAYAWAYS), async () => {
            assertCurrent();
            const layaway = await db.table(STORES.LAYAWAYS).get(layawayId);
            assertCurrent();
            if (!layaway) throw new Error('Apartado no encontrado');
            if (layaway.status === 'cancelled') return { success: true, duplicate: true, layaway };
            if (layaway.pendingRefund) return { success: true, pending: layaway.pendingRefund, layaway };
            const pendingRefund = {
                ...refund,
                amount: Number(layaway.paidAmount || 0),
                status: 'pending',
                createdAt: refund.createdAt || nowIso()
            };
            await db.table(STORES.LAYAWAYS).update(layawayId, { pendingRefund, updatedAt: nowIso() });
            assertCurrent();
            return { success: true, pending: pendingRefund, layaway: { ...layaway, pendingRefund } };
        });
    },

    async completeRefund(layawayId, reason, cashMovementId, { assertActorCurrent } = {}) {
        const assertCurrent = requireRefundActorAssertion(assertActorCurrent, 'layaway.completeRefund');
        return db.transaction('rw', transactionTables({ stock: true }), async (tx) => {
            assertCurrent();
            const layaway = await tx.table(STORES.LAYAWAYS).get(layawayId);
            assertCurrent();
            if (!layaway) throw new Error('Apartado no encontrado');
            if (layaway.status === 'cancelled') return { success: true, duplicate: true, cashMovementId: layaway.refundCashMovementId };
            if (!['active', 'ready'].includes(layaway.status)) {
                throw inventoryError('LAYAWAY_STATE_INVALID', 'Solo se pueden cancelar apartados activos o listos.');
            }
            if (accountingMode(layaway) === 'reserved_v1') {
                await applyReservedStock(layaway);
            } else {
                await restoreStock(layaway);
            }
            await tx.table(STORES.LAYAWAYS).update(layawayId, {
                status: 'cancelled',
                updatedAt: nowIso(),
                notes: `${reason} - Fondos reembolsados`,
                pendingRefund: { ...(layaway.pendingRefund || {}), status: 'confirmed', cashMovementId },
                refundCashMovementId: cashMovementId
            });
            assertCurrent();
            return { success: true, cashMovementId };
        });
    },

    async cancel(layawayId, reason = 'Cancelacion por cliente', retainMoney = false, cashSessionId = null, options = {}) {
        const assertActorCurrent = requireRefundActorAssertion(
            options.assertActorCurrent,
            'layaway.cancel'
        );
        try {
            const cashMovement = options.cashMovement || null;
            assertActorCurrent();
            if (Number((await db.table(STORES.LAYAWAYS).get(layawayId))?.paidAmount || 0) > 0 && !retainMoney && !cashMovement) {
                throw new Error('El reembolso debe registrarse mediante la ruta canonica de Caja.');
            }
            assertActorCurrent();

            return await db.transaction('rw', transactionTables({ cash: Boolean(cashMovement), stock: true }), async (tx) => {
                assertActorCurrent();
                const layaway = await tx.table(STORES.LAYAWAYS).get(layawayId);
                if (!layaway) throw new Error('Apartado no encontrado');
                if (!['active', 'ready'].includes(layaway.status)) {
                    throw new Error('Solo se pueden cancelar apartados activos o listos para entrega');
                }

                if (accountingMode(layaway) === 'reserved_v1') {
                await applyReservedStock(layaway);
            } else {
                await restoreStock(layaway);
            }
                let cashMovementId = null;
                if (layaway.paidAmount > 0 && !retainMoney) {
                    const result = await registrarMovimientoCajaEnTransaccion(
                        tx,
                        cashSessionId,
                        'salida',
                        layaway.paidAmount,
                        `Reembolso cancelacion de Apartado #${layawayId.slice(-4)}`,
                        cashMovement
                    );
                    cashMovementId = result.movimiento.id;
                }

                await tx.table(STORES.LAYAWAYS).update(layawayId, {
                    status: 'cancelled',
                    updatedAt: nowIso(),
                    notes: `${reason} - ${retainMoney ? 'Fondos retenidos por penalizacion' : 'Fondos reembolsados'}`,
                    retainedMoney: Boolean(retainMoney),
                    retainedPenaltyAmount: retainMoney ? Number(layaway.paidAmount || 0) : 0,
                    ...(cashMovementId ? { refundCashMovementId: cashMovementId } : {})
                });
                assertActorCurrent();
                return { success: true, cashMovementId };
            });
        } catch (error) {
            throw handleDexieError(error, 'Cancel Layaway');
        }
    },

    async convertToSale(layawayId, cashierId = 'system') {
        return db.transaction('rw', [db.table(STORES.LAYAWAYS), db.table(STORES.SALES), db.table(STORES.DAILY_STATS),
            db.table(STORES.MENU), db.table(STORES.PRODUCT_BATCHES), db.table(STORES.INVENTORY_EVENTS)], async () => {
            const layaway = await db.table(STORES.LAYAWAYS).get(layawayId);
            if (!layaway) throw new Error('Apartado no encontrado');
            const mode = accountingMode(layaway);
            const existingSale = await db.table(STORES.SALES)
                .toCollection()
                .filter((sale) => sale.isLayawayConversion === true && sale.originalLayawayId === layawayId)
                .first();
            if (existingSale) {
                if (mode === 'reserved_v1' && layaway.status !== 'completed') {
                    throw inventoryError('LAYAWAY_RECONCILIATION_REQUIRED', 'La venta existe, pero la reserva no consta como entregada.');
                }
                if (layaway.status !== 'completed') {
                    await db.table(STORES.LAYAWAYS).update(layawayId, {
                        status: 'completed',
                        updatedAt: nowIso(),
                        deliveredAt: layaway.deliveredAt || existingSale.timestamp,
                        conversionSaleId: existingSale.id,
                        notes: 'Entregado y convertido a venta'
                    });
                }
                return { success: true, duplicate: true, saleId: existingSale.id };
            }
            if (!['active', 'ready'].includes(layaway.status)) throw new Error('Solo se puede entregar un apartado activo o listo.');
            if (Number(layaway.totalAmount) - Number(layaway.paidAmount || 0) > 0.05) throw new Error('El apartado debe estar liquidado para entregar.');

            const deliveredAt = nowIso();
            const physicalBefore = new Map();
            if (mode === 'reserved_v1') {
                for (const { productId } of layaway.reservedInventory || []) {
                    if (!physicalBefore.has(productId)) {
                        physicalBefore.set(productId, (await db.table(STORES.MENU).get(productId))?.stock);
                    }
                }
            }
            const deducted = mode === 'reserved_v1' ? await applyReservedStock(layaway, { deliver: true }) : new Map();
            const saleRecord = {
                id: generateID('sal'), timestamp: deliveredAt, customerId: layaway.customerId, customerName: layaway.customerName,
                items: layaway.items.map((item) => ({ ...item, stockManaged: true })), total: layaway.totalAmount,
                subtotal: layaway.totalAmount, discount: 0, paymentMethod: 'layaway_completed', status: SALE_STATUS.CLOSED,
                fulfillmentStatus: 'fulfilled', cashierId, isLayawayConversion: true, originalLayawayId: layaway.id
            };
            await db.table(STORES.SALES).add(saleRecord);
            for (const [productId, quantity] of deducted) {
                const product = await db.table(STORES.MENU).get(productId);
                await db.table(STORES.INVENTORY_EVENTS).add({
                    id: generateID('evt'), type: 'INVENTORY_DEDUCTION', productId,
                    delta: -quantity, saleId: saleRecord.id,
                    previousStock: physicalBefore.get(productId), newStock: product?.stock,
                    timestamp: deliveredAt, batchManagementEnabled: Boolean(product?.batchManagement?.enabled)
                });
            }
            const [saleDayStat] = buildDailyStatsFromSales([saleRecord]);
            if (saleDayStat) {
                const existingDay = await db.table(STORES.DAILY_STATS).get(saleDayStat.id);
                const mergedDay = existingDay ? {
                    ...existingDay,
                    ...saleDayStat,
                    revenue: Money.toNumber(Money.add(existingDay.revenue || 0, saleDayStat.revenue || 0)),
                    validRevenue: Money.toNumber(Money.add(existingDay.validRevenue || 0, saleDayStat.validRevenue || 0)),
                    unconfirmedRevenue: Money.toNumber(Money.add(existingDay.unconfirmedRevenue || 0, saleDayStat.unconfirmedRevenue || 0)),
                    unreliableProfitDueToMissingCosts: Money.toNumber(Money.add(existingDay.unreliableProfitDueToMissingCosts || 0, saleDayStat.unreliableProfitDueToMissingCosts || 0)),
                    profit: Money.toNumber(Money.add(existingDay.profit || 0, saleDayStat.profit || 0)),
                    orders: Number(existingDay.orders || 0) + Number(saleDayStat.orders || 0),
                    itemsSold: Money.toNumber(Money.add(existingDay.itemsSold || 0, saleDayStat.itemsSold || 0)),
                    hasMissingCosts: Boolean(existingDay.hasMissingCosts || saleDayStat.hasMissingCosts)
                } : saleDayStat;
                Object.assign(mergedDay, getFinancialQuality(mergedDay.validRevenue || 0, mergedDay.unconfirmedRevenue || 0));
                await db.table(STORES.DAILY_STATS).put(mergedDay);
            }
            await db.table(STORES.LAYAWAYS).update(layawayId, {
                status: 'completed', updatedAt: deliveredAt, deliveredAt,
                conversionSaleId: saleRecord.id, notes: 'Entregado y convertido a venta'
            });
            return { success: true, saleId: saleRecord.id, duplicate: false };
        });
    },

    // Cloud layaways are already committed by the server. This projection
    // stores the server snapshot for UI/recovery only; it never reserves,
    // releases, consumes stock, or creates a local cash movement.
    async upsertCloudSnapshot(response = {}) {
        const cloudLayaway = response?.layaway || response;
        const id = cloudLayaway?.id || cloudLayaway?.layaway_id || null;
        if (!id) throw new Error('CLOUD_LAYAWAY_SNAPSHOT_INVALID');

        const table = db.table(STORES.LAYAWAYS);
        const existing = await table.get(id);
        const numberOr = (value, fallback = 0) => {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : fallback;
        };
        const localItems = Array.isArray(cloudLayaway.items)
            ? cloudLayaway.items.map((item) => ({
                ...item,
                id: item.id || null,
                productId: item.product_id || item.productId || item.parentId || null,
                productName: item.product_name || item.productName || item.name || null,
                productSku: item.product_sku || item.productSku || item.sku || null,
                quantity: numberOr(item.quantity ?? item.qty, 0),
                price: numberOr(item.unit_price ?? item.unitPrice ?? item.price, 0),
                cost: item.unit_cost ?? item.unitCost ?? item.cost ?? null,
                lineTotal: numberOr(item.line_total ?? item.lineTotal ?? item.total, 0),
                batchId: item.batch_id || item.batchId || null
            }))
            : (existing?.items || []);
        const cloudPayments = Array.isArray(response?.payments)
            ? response.payments
            : (Array.isArray(cloudLayaway.payments) ? cloudLayaway.payments : null);
        const payments = cloudPayments
            ? cloudPayments.map((payment) => ({
                ...payment,
                id: payment.id,
                amount: numberOr(payment.amount, 0),
                date: payment.created_at || payment.createdAt || payment.date || nowIso(),
                type: payment.payment_type || payment.paymentType || payment.metadata?.payment_type || 'installment',
                paymentType: payment.payment_type || payment.paymentType || payment.metadata?.payment_type || 'installment',
                status: payment.status || 'confirmed',
                paymentMethod: payment.payment_method || payment.paymentMethod || 'cash',
                cashMovementId: payment.cash_movement_id || payment.cashMovementId || null,
                cashSessionId: payment.cash_session_id || payment.cashSessionId || payment.cajaId || null,
                cash_session_id: payment.cash_session_id || payment.cashSessionId || payment.cajaId || null,
                cajaId: payment.cash_session_id || payment.cashSessionId || payment.cajaId || null,
                cashStationId: payment.cash_station_id || payment.cashStationId || null,
                actorKey: payment.actor_key || payment.actorKey || null
            }))
            : (existing?.payments || []);
        const updatedAt = cloudLayaway.updated_at || cloudLayaway.updatedAt || nowIso();
        const createdAt = cloudLayaway.created_at || cloudLayaway.createdAt || existing?.createdAt || updatedAt;
        const projected = {
            ...existing,
            id,
            customerId: cloudLayaway.customer_id ?? cloudLayaway.customerId ?? existing?.customerId ?? null,
            customerName: cloudLayaway.customer_name ?? cloudLayaway.customerName ?? existing?.customerName ?? null,
            customerPhone: cloudLayaway.customer_phone ?? cloudLayaway.customerPhone ?? existing?.customerPhone ?? null,
            totalAmount: numberOr(cloudLayaway.total_amount ?? cloudLayaway.totalAmount, existing?.totalAmount || 0),
            paidAmount: numberOr(cloudLayaway.paid_amount ?? cloudLayaway.paidAmount, existing?.paidAmount || 0),
            balanceDue: numberOr(cloudLayaway.balance_due ?? cloudLayaway.balanceDue, 0),
            currency: cloudLayaway.currency || existing?.currency || 'MXN',
            deadline: cloudLayaway.deadline || cloudLayaway.due_date || existing?.deadline || null,
            status: cloudLayaway.status || existing?.status || 'active',
            items: localItems,
            payments,
            sourceMode: 'cloud_committed',
            cloudLayaway: true,
            cloudServerVersion: cloudLayaway.server_version ?? cloudLayaway.serverVersion ?? null,
            cloudLastIdempotencyKey: cloudLayaway.last_idempotency_key || cloudLayaway.lastIdempotencyKey || null,
            cloudInventoryReservations: Array.isArray(response?.inventory_reservations)
                ? response.inventory_reservations
                : (existing?.cloudInventoryReservations || []),
            cloudCashMovements: Array.isArray(response?.cash_movements)
                ? response.cash_movements
                : (existing?.cloudCashMovements || []),
            cloudInventoryMovements: Array.isArray(response?.inventory_movements)
                ? response.inventory_movements
                : (existing?.cloudInventoryMovements || []),
            conversionSaleId: cloudLayaway.conversion_sale_id || cloudLayaway.conversionSaleId || existing?.conversionSaleId || null,
            refundId: cloudLayaway.refund_id || cloudLayaway.refundId || existing?.refundId || null,
            refundCashMovementId: cloudLayaway.refund_cash_movement_id || cloudLayaway.refundCashMovementId || existing?.refundCashMovementId || null,
            retainedMoney: Boolean(cloudLayaway.retained_money ?? cloudLayaway.retainedMoney ?? existing?.retainedMoney ?? false),
            retainedPenaltyAmount: numberOr(cloudLayaway.retained_amount ?? cloudLayaway.retainedPenaltyAmount, existing?.retainedPenaltyAmount || 0),
            createdAt,
            updatedAt,
            deliveredAt: cloudLayaway.completed_at || cloudLayaway.completedAt || existing?.deliveredAt || null
        };

        await table.put(projected);
        return projected;
    },

    async getByCustomer(customerId, onlyActive = true) {
        if (onlyActive) return db.table(STORES.LAYAWAYS).where('customerId').equals(customerId)
            .filter((layaway) => ['active', 'ready'].includes(layaway.status)).toArray();
        return db.table(STORES.LAYAWAYS).where('customerId').equals(customerId).toArray();
    },

    async getById(id) {
        return db.table(STORES.LAYAWAYS).get(id);
    },

    async getLegacyPaymentsForReconciliation() {
        const layaways = await db.table(STORES.LAYAWAYS).toArray();
        return layaways.flatMap((layaway) => (layaway.payments || [])
            .filter((payment) => payment.status !== 'pending' && payment.status !== 'failed' && !payment.cashMovementId)
            .map((payment) => ({
                layawayId: layaway.id,
                paymentId: payment.id || null,
                amount: payment.amount,
                date: payment.date || payment.createdAt || layaway.createdAt || null,
                paymentType: payment.paymentType || payment.type || null,
                // The report keeps its historical field name, but reads the
                // canonical session link first for new payments.
                cajaId: payment.cashSessionId || payment.cash_session_id || payment.cajaId || null,
                customerId: layaway.customerId || null,
                status: 'needs_reconciliation'
            })));
    },

    // Auditoria de solo lectura para datos historicos. No crea ventas ni movimientos.
    async auditFinancialLinks() {
        const [layaways, sales, cashMovements] = await Promise.all([
            db.table(STORES.LAYAWAYS).toArray(),
            db.table(STORES.SALES).toArray(),
            db.table(STORES.MOVIMIENTOS_CAJA).toArray()
        ]);
        return auditLayawayFinancialLinks({ layaways, sales, cashMovements });
    }
};
