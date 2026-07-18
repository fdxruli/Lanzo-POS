import { db, STORES } from './dexie';
import { handleDexieError } from './utils';
import { generateID } from '../utils';
import { productsRepository } from './products';
import { useStatsStore } from '../../store/useStatsStore';
import Logger from '../Logger';
import { SALE_STATUS } from '../sales/financialStats';
import { registrarMovimientoCajaEnTransaccion } from '../cajaService';

const nowIso = () => new Date().toISOString();

const buildPaymentRecord = (payment, fallbackAmount, fallbackType = 'installment') => ({
    id: payment?.id || generateID('pay'),
    amount: fallbackAmount,
    date: payment?.date || nowIso(),
    type: payment?.type || fallbackType,
    paymentType: payment?.paymentType || payment?.type || fallbackType,
    status: payment?.status || 'pending',
    ...payment
});

const transactionTables = ({ cash = false, stock = false } = {}) => [
    db.table(STORES.LAYAWAYS),
    ...(stock ? [db.table(STORES.PRODUCT_BATCHES), db.table(STORES.MENU)] : []),
    ...(cash ? [db.table(STORES.CAJAS), db.table(STORES.MOVIMIENTOS_CAJA)] : [])
];

const reserveStock = async (layawayData) => {
    const batchDeductions = [];
    const genericItems = [];

    (layawayData.items || []).forEach((item) => {
        if (item.batchId) {
            batchDeductions.push({
                batchId: item.batchId,
                quantity: item.quantity,
                reason: `Apartado para ${layawayData.customerName}`
            });
        } else {
            genericItems.push(item);
        }
    });

    if (batchDeductions.length > 0) {
        await productsRepository.processBatchDeductions(batchDeductions, {
            validateStock: true,
            allowPartial: false,
            logDetails: true
        });
    }

    for (const item of genericItems) {
        const productId = item.parentId || item.id;
        const product = await db.table(STORES.MENU).get(productId);
        if (!product || !product.trackStock) continue;
        if (product.stock < item.quantity) throw new Error(`Stock insuficiente para: ${product.name}`);
        await db.table(STORES.MENU).update(productId, {
            stock: product.stock - item.quantity,
            updatedAt: nowIso()
        });
    }
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
    async create(layawayData, initialPayment = 0, cajaId = null, options = {}) {
        try {
            const cashMovement = options.cashMovement || null;
            if (initialPayment > 0 && !cashMovement) {
                throw new Error('El anticipo debe registrarse mediante la ruta canonica de Caja.');
            }

            return await db.transaction('rw', transactionTables({ cash: Boolean(cashMovement), stock: true }), async (tx) => {
                await reserveStock(layawayData);

                const now = nowIso();
                const newLayaway = {
                    ...layawayData,
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
                        cajaId,
                        'entrada',
                        initialPayment,
                        `Abono inicial Apartado - ${layawayData.customerName}`,
                        cashMovement
                    );
                    newLayaway.payments.push({
                        ...payment,
                        amount: initialPayment,
                        status: 'confirmed',
                        cashMovementId: movementResult.movimiento.id,
                        cajaId,
                        cash_session_id: cajaId
                    });
                }

                await tx.table(STORES.LAYAWAYS).add(newLayaway);
                return { success: true, layaway: newLayaway };
            });
        } catch (error) {
            throw handleDexieError(error, 'Create Layaway');
        }
    },

    async addPayment(layawayId, paymentOrAmount, cajaId = null) {
        const payment = typeof paymentOrAmount === 'object'
            ? buildPaymentRecord(paymentOrAmount, paymentOrAmount.amount)
            : buildPaymentRecord({ amount: paymentOrAmount, cajaId }, paymentOrAmount);

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
            const payments = existing
                ? (layaway.payments || []).map((item) => item.id === payment.id ? { ...payment, cashMovementId: movementResult.movimiento.id, cajaId: cashSessionId, cash_session_id: cashSessionId } : item)
                : [...(layaway.payments || []), { ...payment, cashMovementId: movementResult.movimiento.id, cajaId: cashSessionId, cash_session_id: cashSessionId }];
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
            const payments = (layaway.payments || []).map((payment) => payment.id === paymentId
                ? { ...payment, status: 'confirmed', cashMovementId, cajaId: cashSessionId, cash_session_id: cashSessionId }
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

    async beginRefund(layawayId, refund) {
        return db.transaction('rw', db.table(STORES.LAYAWAYS), async () => {
            const layaway = await db.table(STORES.LAYAWAYS).get(layawayId);
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
            return { success: true, pending: pendingRefund, layaway: { ...layaway, pendingRefund } };
        });
    },

    async completeRefund(layawayId, reason, cashMovementId) {
        return db.transaction('rw', transactionTables({ stock: true }), async (tx) => {
            const layaway = await tx.table(STORES.LAYAWAYS).get(layawayId);
            if (!layaway) throw new Error('Apartado no encontrado');
            if (layaway.status === 'cancelled') return { success: true, duplicate: true, cashMovementId: layaway.refundCashMovementId };
            await restoreStock(layaway);
            await tx.table(STORES.LAYAWAYS).update(layawayId, {
                status: 'cancelled',
                updatedAt: nowIso(),
                notes: `${reason} - Fondos reembolsados`,
                pendingRefund: { ...(layaway.pendingRefund || {}), status: 'confirmed', cashMovementId },
                refundCashMovementId: cashMovementId
            });
            return { success: true, cashMovementId };
        });
    },

    async cancel(layawayId, reason = 'Cancelacion por cliente', retainMoney = false, cajaId = null, options = {}) {
        try {
            const cashMovement = options.cashMovement || null;
            if (Number((await db.table(STORES.LAYAWAYS).get(layawayId))?.paidAmount || 0) > 0 && !retainMoney && !cashMovement) {
                throw new Error('El reembolso debe registrarse mediante la ruta canonica de Caja.');
            }

            return await db.transaction('rw', transactionTables({ cash: Boolean(cashMovement), stock: true }), async (tx) => {
                const layaway = await tx.table(STORES.LAYAWAYS).get(layawayId);
                if (!layaway) throw new Error('Apartado no encontrado');
                if (!['active', 'ready'].includes(layaway.status)) {
                    throw new Error('Solo se pueden cancelar apartados activos o listos para entrega');
                }

                await restoreStock(layaway);
                let cashMovementId = null;
                if (layaway.paidAmount > 0 && !retainMoney) {
                    const result = await registrarMovimientoCajaEnTransaccion(
                        tx,
                        cajaId,
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
                    ...(cashMovementId ? { refundCashMovementId: cashMovementId } : {})
                });
                return { success: true, cashMovementId };
            });
        } catch (error) {
            throw handleDexieError(error, 'Cancel Layaway');
        }
    },

    async convertToSale(layawayId, cashierId = 'system') {
        return db.transaction('rw', [db.table(STORES.LAYAWAYS), db.table(STORES.SALES), db.table(STORES.DAILY_STATS)], async () => {
            const layaway = await db.table(STORES.LAYAWAYS).get(layawayId);
            if (!layaway) throw new Error('Apartado no encontrado');
            if (!['active', 'ready'].includes(layaway.status)) throw new Error('Solo se puede entregar un apartado activo o listo.');
            if (Number(layaway.totalAmount) - Number(layaway.paidAmount || 0) > 0.05) throw new Error('El apartado debe estar liquidado para entregar.');

            await db.table(STORES.LAYAWAYS).update(layawayId, { status: 'completed', updatedAt: nowIso(), notes: 'Entregado y convertido a venta' });
            const saleRecord = {
                id: generateID('sal'), timestamp: nowIso(), customerId: layaway.customerId, customerName: layaway.customerName,
                items: layaway.items.map((item) => ({ ...item, stockManaged: true })), total: layaway.totalAmount,
                subtotal: layaway.totalAmount, discount: 0, paymentMethod: 'layaway_completed', status: SALE_STATUS.CLOSED,
                fulfillmentStatus: 'fulfilled', cashierId, isLayawayConversion: true, originalLayawayId: layaway.id
            };
            await db.table(STORES.SALES).add(saleRecord);
            try {
                const costOfGoodsSold = layaway.items.reduce((sum, item) => sum + ((item.cost || 0) * item.quantity), 0);
                await useStatsStore.getState().updateStatsForNewSale(saleRecord, costOfGoodsSold);
            } catch (statsError) {
                Logger.warn('La venta del apartado se registro pero fallo la actualizacion de estadisticas:', statsError);
            }
            return { success: true, saleId: saleRecord.id };
        });
    },

    async getByCustomer(customerId, onlyActive = true) {
        if (onlyActive) return db.table(STORES.LAYAWAYS).where('[customerId+status]').equals([customerId, 'active']).toArray();
        return db.table(STORES.LAYAWAYS).where('customerId').equals(customerId).toArray();
    },

    async getById(id) {
        return db.table(STORES.LAYAWAYS).get(id);
    },

    async getLegacyPaymentsForReconciliation() {
        const layaways = await db.table(STORES.LAYAWAYS).toArray();
        return layaways.flatMap((layaway) => (layaway.payments || [])
            .filter((payment) => payment.status !== 'pending' && !payment.cashMovementId)
            .map((payment) => ({
                layawayId: layaway.id,
                paymentId: payment.id || null,
                amount: payment.amount,
                date: payment.date || payment.createdAt || layaway.createdAt || null,
                paymentType: payment.paymentType || payment.type || null,
                cajaId: payment.cajaId || payment.cash_session_id || null,
                customerId: layaway.customerId || null,
                status: 'needs_reconciliation'
            })));
    }
};
