// services/db/layaways.js - VERSIÓN CORREGIDA
import { db, STORES } from './dexie';
import { handleDexieError, DatabaseError } from './utils';
import { productsRepository } from './products';
import { useStatsStore } from '../../store/useStatsStore'; // ✅ AGREGADO
import Logger from '../Logger';

export const layawayRepository = {

    /**
     * Crear un nuevo apartado y RESERVAR STOCK
     * @param {object} layawayData - Datos del apartado
     * @param {number} initialPayment - Monto del primer abono
     * @param {string} cajaId - ID de la caja abierta (opcional) ✅ NUEVO
     */
    async create(layawayData, initialPayment = 0, cajaId = null) {
        try {
            return await db.transaction('rw', [
                db.table(STORES.LAYAWAYS),
                db.table(STORES.PRODUCT_BATCHES),
                db.table(STORES.MENU),
                db.table(STORES.MOVIMIENTOS_CAJA) // ✅ AGREGADO
            ], async () => {

                // 1. PREPARAR DEDUCCIONES DE STOCK
                const batchDeductions = [];
                const genericItems = [];

                layawayData.items.forEach(item => {
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

                // 2. EJECUTAR DESCUENTO DE LOTES
                if (batchDeductions.length > 0) {
                    await productsRepository.processBatchDeductions(batchDeductions, {
                        validateStock: true,
                        allowPartial: false,
                        logDetails: true
                    });
                }

                // 3. EJECUTAR DESCUENTO DE GENÉRICOS
                for (const item of genericItems) {
                    const productId = item.parentId || item.id;
                    const product = await db.table(STORES.MENU).get(productId);

                    if (product && product.trackStock) {
                        if (product.stock < item.quantity) {
                            throw new Error(`Stock insuficiente para: ${product.name}`);
                        }

                        await db.table(STORES.MENU).update(productId, {
                            stock: product.stock - item.quantity,
                            updatedAt: new Date().toISOString()
                        });
                    }
                }

                // 4. GUARDAR EL APARTADO
                const now = new Date().toISOString();
                const newLayaway = {
                    ...layawayData,
                    status: 'active',
                    paidAmount: initialPayment,
                    createdAt: now,
                    updatedAt: now,
                    payments: []
                };

                if (initialPayment > 0) {
                    newLayaway.payments.push({
                        id: crypto.randomUUID(),
                        amount: initialPayment,
                        date: now,
                        type: 'initial_deposit',
                        cajaId: cajaId // ✅ REFERENCIA A LA CAJA
                    });

                    // ✅ NUEVO: REGISTRAR EN MOVIMIENTOS DE CAJA (SI SE PROPORCIONÓ)
                    if (cajaId) {
                        await db.table(STORES.MOVIMIENTOS_CAJA).add({
                            id: `mov-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
                            caja_id: cajaId,
                            tipo: 'entrada',
                            monto: initialPayment,
                            concepto: `Abono inicial Apartado - ${layawayData.customerName}`,
                            fecha: now
                        });
                    }
                }

                await db.table(STORES.LAYAWAYS).add(newLayaway);

                return { success: true, layaway: newLayaway };
            });

        } catch (error) {
            throw handleDexieError(error, 'Create Layaway');
        }
    },

    /**
     * Cancelar un apartado y DEVOLVER STOCK
     */
    async cancel(layawayId, reason = 'Cancelación por cliente') {
        try {
            return await db.transaction('rw', [
                db.table(STORES.LAYAWAYS),
                db.table(STORES.PRODUCT_BATCHES),
                db.table(STORES.MENU)
            ], async () => {

                const layaway = await db.table(STORES.LAYAWAYS).get(layawayId);
                if (!layaway) throw new Error("Apartado no encontrado");
                if (layaway.status !== 'active') throw new Error("Solo se pueden cancelar apartados activos");

                const productsToSync = new Set();

                // RESTAURAR STOCK
                for (const item of layaway.items) {

                    // CASO A: Variantes (Lotes)
                    if (item.batchId) {
                        const batch = await db.table(STORES.PRODUCT_BATCHES).get(item.batchId);
                        if (batch) {
                            const newStock = batch.stock + item.quantity;
                            await db.table(STORES.PRODUCT_BATCHES).update(item.batchId, {
                                stock: newStock,
                                isActive: true,
                                updatedAt: new Date().toISOString()
                            });
                            productsToSync.add(batch.productId);
                        }
                    }
                    // CASO B: Genéricos
                    else {
                        const productId = item.parentId || item.id;
                        const product = await db.table(STORES.MENU).get(productId);
                        if (product && product.trackStock) {
                            await db.table(STORES.MENU).update(productId, {
                                stock: product.stock + item.quantity
                            });
                        }
                    }
                }

                // SINCRONIZAR PADRES
                for (const productId of productsToSync) {
                    const allBatches = await db.table(STORES.PRODUCT_BATCHES)
                        .where('productId').equals(productId).toArray();

                    const totalStock = allBatches.reduce((sum, b) =>
                        (b.isActive && b.stock > 0) ? sum + b.stock : sum, 0);

                    await db.table(STORES.MENU).update(productId, {
                        stock: totalStock,
                        updatedAt: new Date().toISOString()
                    });
                }

                // ACTUALIZAR ESTADO
                await db.table(STORES.LAYAWAYS).update(layawayId, {
                    status: 'cancelled',
                    updatedAt: new Date().toISOString(),
                    notes: reason
                });

                return { success: true };
            });
        } catch (error) {
            throw handleDexieError(error, 'Cancel Layaway');
        }
    },

    /**
     * ✅ CORREGIDO: Convierte el apartado en venta histórica Y ACTUALIZA ESTADÍSTICAS
     */
    async convertToSale(layawayId, cashierId = 'system') {
        return await db.transaction('rw', [
            db.table(STORES.LAYAWAYS), 
            db.table(STORES.SALES),
            db.table(STORES.DAILY_STATS) // ✅ AGREGADO
        ], async () => {
            const layaway = await db.table(STORES.LAYAWAYS).get(layawayId);
            if (!layaway) throw new Error("Apartado no encontrado");

            // Validaciones de negocio
            const pending = layaway.totalAmount - (layaway.paidAmount || 0);
            if (pending > 0.05) throw new Error("El apartado debe estar liquidado para entregar.");

            // 1. Marcar como completado
            await db.table(STORES.LAYAWAYS).update(layawayId, {
                status: 'completed',
                updatedAt: new Date().toISOString(),
                notes: 'Entregado y convertido a venta'
            });

            // 2. Crear venta histórica
            const now = new Date().toISOString();
            const saleRecord = {
                id: `sale-layaway-${layaway.id}`,
                timestamp: now,
                customerId: layaway.customerId,
                customerName: layaway.customerName,
                items: layaway.items.map(item => ({
                    ...item,
                    stockManaged: true // Evita doble descuento
                })),
                total: layaway.totalAmount,
                subtotal: layaway.totalAmount,
                discount: 0,
                paymentMethod: 'layaway_completed',
                status: 'completed',
                fulfillmentStatus: 'fulfilled',
                cashierId: cashierId,
                isLayawayConversion: true,
                originalLayawayId: layaway.id
            };

            await db.table(STORES.SALES).add(saleRecord);

            // ✅ 3. ACTUALIZAR ESTADÍSTICAS (CRÍTICO)
            try {
                const costOfGoodsSold = layaway.items.reduce((sum, item) => {
                    const cost = item.cost || 0;
                    return sum + (cost * item.quantity);
                }, 0);

                // Actualizar estadísticas globales
                await useStatsStore.getState().updateStatsForNewSale(saleRecord, costOfGoodsSold);

                Logger.log(`✅ Apartado #${layaway.id.slice(-6)} convertido a venta. Stats actualizadas.`);
            } catch (statsError) {
                Logger.warn("⚠️ Advertencia: La venta se registró pero falló la actualización de estadísticas:", statsError);
                // NO lanzamos error porque la venta YA se guardó exitosamente
            }

            return { success: true, saleId: saleRecord.id };
        });
    },

    async getByCustomer(customerId, onlyActive = true) {
        if (onlyActive) {
            return await db.table(STORES.LAYAWAYS)
                .where('[customerId+status]')
                .equals([customerId, 'active'])
                .toArray();
        }
        return await db.table(STORES.LAYAWAYS).where('customerId').equals(customerId).toArray();
    },

    async getById(id) {
        return await db.table(STORES.LAYAWAYS).get(id);
    },

    /**
     * ✅ MEJORADO: Registra pago y vincula con caja
     */
    async addPayment(layawayId, amount, cajaId = null) {
        return await db.transaction('rw', [
            db.table(STORES.LAYAWAYS),
            db.table(STORES.MOVIMIENTOS_CAJA) // ✅ AGREGADO
        ], async () => {
            const layaway = await db.table(STORES.LAYAWAYS).get(layawayId);
            if (!layaway) throw new Error("Apartado no encontrado");

            const newPaidAmount = (layaway.paidAmount || 0) + amount;
            const isFullyPaid = newPaidAmount >= (layaway.totalAmount - 0.01);

            const updates = {
                paidAmount: newPaidAmount,
                updatedAt: new Date().toISOString(),
                status: layaway.status
            };

            const newPayments = [...(layaway.payments || []), {
                id: crypto.randomUUID(),
                amount: amount,
                date: new Date().toISOString(),
                type: 'regular_payment',
                cajaId: cajaId // ✅ REFERENCIA A LA CAJA
            }];
            updates.payments = newPayments;

            await db.table(STORES.LAYAWAYS).update(layawayId, updates);

            // ✅ REGISTRAR EN CAJA (SI SE PROPORCIONÓ)
            if (cajaId) {
                await db.table(STORES.MOVIMIENTOS_CAJA).add({
                    id: `mov-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
                    caja_id: cajaId,
                    tipo: 'entrada',
                    monto: amount,
                    concepto: `Abono Apartado #${layawayId.slice(-4)} - ${layaway.customerName}`,
                    fecha: new Date().toISOString()
                });
            }

            return { success: true, isFullyPaid, newPaidAmount };
        });
    }
};