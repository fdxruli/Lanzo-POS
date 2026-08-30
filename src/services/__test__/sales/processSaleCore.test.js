import { describe, it, expect, vi } from 'vitest';
import { processSaleCore } from '../../sales/processSaleCore';

const makeParams = (overrides = {}) => ({
    order: [{ id: 'prod-1', name: 'Producto 1', quantity: 1, price: 10 }],
    paymentData: {
        customerId: 'cust-1',
        paymentMethod: 'efectivo',
        amountPaid: 10,
        saldoPendiente: 0,
        sendReceipt: true
    },
    total: 10,
    allProducts: [{ id: 'prod-1', name: 'Producto 1', trackStock: true, stock: 100, cost: 4, price: 10 }],
    features: { hasRecipes: false, hasKDS: false, hasLabFields: false },
    companyName: 'Mi Negocio',
    tempPrescriptionData: null,
    ignoreStock: false,
    ...overrides
});

const makeDeps = (overrides = {}) => {
    const updateStatsForNewSale = vi.fn();
    const deps = {
        loadData: vi.fn(async (store, id) => {
            if (store === 'menu') {
                return {
                    id,
                    name: 'Producto 1',
                    price: 10,
                    cost: 4,
                    stock: 100,
                    trackStock: true,
                    batchManagement: { enabled: false }
                };
            }

            if (store === 'customers' && id === 'cust-1') {
                return { id: 'cust-1', debt: 20 };
            }

            return null;
        }),
        saveData: vi.fn(async () => true),
        STORES: {
            MENU: 'menu',
            PRODUCT_BATCHES: 'product_batches',
            CUSTOMERS: 'customers',
            SALES: 'sales'
        },
        queryBatchesByProductIdAndActive: vi.fn(async () => []),
        queryByIndex: vi.fn(async () => []),
        executeSaleTransactionSafe: vi.fn(async () => ({ success: true })),
        useStatsStore: { getState: () => ({ updateStatsForNewSale }) },
        roundCurrency: (value) => Math.round(value * 100) / 100,
        sendReceiptWhatsApp: vi.fn(async () => true),
        calculatePricingDetails: vi.fn((_product, quantity) => ({
            unitPrice: 10,
            exactTotal: 10 * quantity
        })),
        Logger: {
            time: vi.fn(),
            timeEnd: vi.fn(),
            warn: vi.fn(),
            error: vi.fn()
        },
        ...overrides
    };

    deps.__updateStatsForNewSale = updateStatsForNewSale;
    return deps;
};

describe('processSaleCore', () => {
    it('retorna éxito y ejecuta transacción + recibo', async () => {
        const deps = makeDeps();
        const result = await processSaleCore(makeParams(), deps);

        expect(result.success).toBe(true);
        expect(typeof result.saleId).toBe('string');
        expect(deps.executeSaleTransactionSafe).toHaveBeenCalledOnce();
        expect(deps.executeSaleTransactionSafe).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'closed' }),
            expect.any(Array)
        );
        expect(deps.__updateStatsForNewSale).toHaveBeenCalledOnce();
        expect(deps.sendReceiptWhatsApp).toHaveBeenCalledOnce();
    });

    it('mapea error de concurrencia a RACE_CONDITION', async () => {
        const deps = makeDeps({
            executeSaleTransactionSafe: vi.fn(async () => ({
                success: false,
                isConcurrencyError: true
            }))
        });

        const result = await processSaleCore(makeParams(), deps);

        expect(result).toEqual({
            success: false,
            errorType: 'RACE_CONDITION',
            message: 'El stock cambió mientras cobrabas. Intenta de nuevo.'
        });
        expect(deps.__updateStatsForNewSale).not.toHaveBeenCalled();
        expect(deps.sendReceiptWhatsApp).not.toHaveBeenCalled();
    });

    it('en fiado delega la deuda a la transaccion de venta', async () => {
        const deps = makeDeps();
        const result = await processSaleCore(makeParams({
            order: [{ id: 'prod-1', name: 'Producto 1', quantity: 6, price: 10 }],
            paymentData: {
                customerId: 'cust-1',
                paymentMethod: 'fiado',
                amountPaid: 10,
                saldoPendiente: 50,
                sendReceipt: false
            },
            total: 60
        }), deps);

        expect(result.success).toBe(true);
        expect(deps.executeSaleTransactionSafe).toHaveBeenCalledWith(
            expect.objectContaining({
                paymentMethod: 'fiado',
                saldoPendiente: '50',
                status: 'closed'
            }),
            expect.any(Array)
        );
        expect(deps.saveData).not.toHaveBeenCalled();
        expect(deps.__updateStatsForNewSale).toHaveBeenCalledOnce();
    });

    it('reuses the durable order timestamp when retrying the same active order', async () => {
        const deps = makeDeps({
            loadData: vi.fn(async (store, id) => {
                if (store === 'sales' && id === 'active-order-1') {
                    return { id, timestamp: '2026-08-29T12:34:56.000Z' };
                }
                if (store === 'menu') {
                    return {
                        id,
                        name: 'Producto 1',
                        price: 10,
                        cost: 4,
                        stock: 100,
                        trackStock: true,
                        batchManagement: { enabled: false }
                    };
                }
                return null;
            })
        });

        const result = await processSaleCore(makeParams({ activeOrderId: 'active-order-1' }), deps);

        expect(result.success).toBe(true);
        expect(deps.executeSaleTransactionSafe).toHaveBeenCalledWith(
            expect.objectContaining({ timestamp: '2026-08-29T12:34:56.000Z' }),
            expect.any(Array)
        );
    });

    it('does not let a newer checkout snapshot replace the durable order timestamp', async () => {
        const deps = makeDeps({
            loadData: vi.fn(async (store, id) => {
                if (store === 'sales' && id === 'active-order-1') {
                    return { id, timestamp: '2026-08-29T12:34:56.000Z' };
                }
                if (store === 'menu') {
                    return {
                        id,
                        name: 'Producto 1',
                        price: 10,
                        cost: 4,
                        stock: 100,
                        trackStock: true,
                        batchManagement: { enabled: false }
                    };
                }
                return null;
            })
        });

        const result = await processSaleCore(makeParams({
            activeOrderId: 'active-order-1',
            saleTimestamp: '2026-08-30T10:10:00.000Z',
            activeOrderCreatedAt: '2026-08-30T10:10:00.000Z'
        }), deps);

        expect(result.success).toBe(true);
        expect(deps.executeSaleTransactionSafe).toHaveBeenCalledWith(
            expect.objectContaining({ timestamp: '2026-08-29T12:34:56.000Z' }),
            expect.any(Array)
        );
    });

    it('fails closed when an active order has no stable timestamp', async () => {
        const deps = makeDeps();
        const result = await processSaleCore(makeParams({ activeOrderId: 'active-order-without-timestamp' }), deps);

        expect(result).toMatchObject({ success: false, code: 'SALE_TIMESTAMP_REQUIRED' });
        expect(deps.executeSaleTransactionSafe).not.toHaveBeenCalled();
    });

    it('carries one active-order creation timestamp when SALES has no row', async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-08-30T10:00:00.000Z'));
            const deps = makeDeps();
            const stableCreatedAt = '2026-08-29T12:34:56.000Z';
            const first = await processSaleCore(makeParams({
                activeOrderId: 'active-order-without-sales-row',
                activeOrderCreatedAt: stableCreatedAt
            }), deps);

            vi.setSystemTime(new Date('2026-08-30T10:10:00.000Z'));
            const second = await processSaleCore(makeParams({
                activeOrderId: 'active-order-without-sales-row',
                activeOrderCreatedAt: stableCreatedAt
            }), deps);

            expect(first.success).toBe(true);
            expect(second.success).toBe(true);
            expect(deps.loadData.mock.calls.filter(([store]) => store === 'sales')).toHaveLength(2);
            const [firstSale, secondSale] = deps.executeSaleTransactionSafe.mock.calls.map(([sale]) => sale);
            expect(secondSale.id).toBe(firstSale.id);
            expect(secondSale.timestamp).toBe(firstSale.timestamp);
            expect(firstSale.id).toBe('active-order-without-sales-row');
            expect(firstSale.timestamp).toBe(stableCreatedAt);
        } finally {
            vi.useRealTimers();
        }
    });
});
