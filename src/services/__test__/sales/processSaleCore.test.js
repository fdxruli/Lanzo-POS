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
    allProducts: [{ id: 'prod-1', name: 'Producto 1', trackStock: true, cost: 4, price: 10 }],
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
            CUSTOMERS: 'customers'
        },
        queryBatchesByProductIdAndActive: vi.fn(async () => []),
        queryByIndex: vi.fn(async () => []),
        executeSaleTransactionSafe: vi.fn(async () => ({ success: true })),
        useStatsStore: { getState: () => ({ updateStatsForNewSale }) },
        roundCurrency: (value) => Math.round(value * 100) / 100,
        sendReceiptWhatsApp: vi.fn(async () => true),
        calculateCompositePrice: vi.fn(() => 10),
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

    it('en fiado actualiza deuda del cliente', async () => {
        const deps = makeDeps();
        const result = await processSaleCore(makeParams({
            paymentData: {
                customerId: 'cust-1',
                paymentMethod: 'fiado',
                amountPaid: 10,
                saldoPendiente: 50,
                sendReceipt: false
            }
        }), deps);

        expect(result.success).toBe(true);
        expect(deps.saveData).toHaveBeenCalledOnce();
        expect(deps.saveData).toHaveBeenCalledWith('customers', expect.objectContaining({ debt: 70 }));
        expect(deps.__updateStatsForNewSale).toHaveBeenCalledOnce();
    });
});
