import { describe, it, expect, vi } from 'vitest';
import { normalizeAndValidatePricing } from '../../sales/priceSecurity';

describe('normalizeAndValidatePricing', () => {
    it('recalcula precio/costo sin error en caso válido', async () => {
        const itemsToProcess = [{ id: 'prod-1', name: 'Producto 1', quantity: 2, price: 10 }];

        const loadData = vi.fn(async () => ({
            id: 'prod-1',
            price: 10,
            cost: 4,
            batchManagement: { enabled: false }
        }));

        const queryBatchesByProductIdAndActive = vi.fn(async () => []);
        const calculateCompositePrice = vi.fn(() => 10);
        const Logger = { warn: vi.fn() };

        await normalizeAndValidatePricing({
            itemsToProcess,
            total: 20,
            loadData,
            queryBatchesByProductIdAndActive,
            STORES: { MENU: 'menu' },
            calculateCompositePrice,
            Logger
        });

        expect(itemsToProcess[0].price).toBe(10);
        expect(itemsToProcess[0].cost).toBe(4);
        expect(Logger.warn).not.toHaveBeenCalled();
    });

    it('lanza error cuando detecta manipulación de precios/total', async () => {
        const itemsToProcess = [{ id: 'prod-1', name: 'Producto 1', quantity: 2, price: 7 }];

        const loadData = vi.fn(async () => ({
            id: 'prod-1',
            price: 10,
            cost: 4,
            batchManagement: { enabled: false }
        }));

        const queryBatchesByProductIdAndActive = vi.fn(async () => []);
        const calculateCompositePrice = vi.fn(() => 10);
        const Logger = { warn: vi.fn() };

        await expect(normalizeAndValidatePricing({
            itemsToProcess,
            total: 14,
            loadData,
            queryBatchesByProductIdAndActive,
            STORES: { MENU: 'menu' },
            calculateCompositePrice,
            Logger
        })).rejects.toThrow('ALERTA DE SEGURIDAD CRÍTICA');

        expect(Logger.warn).toHaveBeenCalledOnce();
    });
});
