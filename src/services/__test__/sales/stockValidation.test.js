import { describe, it, expect, vi } from 'vitest';
import { validateStockBeforeSale } from '../../sales/stockValidation';

describe('validateStockBeforeSale', () => {
    it('retorna STOCK_WARNING cuando falta stock de ingredientes', async () => {
        const itemsToProcess = [
            { id: 'dish-1', quantity: 2, selectedModifiers: [{ ingredientId: 'ing-2', quantity: 1 }] }
        ];
        const productMap = new Map([
            ['dish-1', { id: 'dish-1', recipe: [{ ingredientId: 'ing-1', quantity: 2 }] }]
        ]);

        const loadMultipleData = vi.fn(async () => ([
            { id: 'ing-1', name: 'Tomate', stock: 3, committedStock: 0, bulkData: { purchase: { unit: 'kg' } } },
            { id: 'ing-2', name: 'Queso', stock: 10, committedStock: 0, bulkData: { purchase: { unit: 'kg' } } }
        ]));

        const result = await validateStockBeforeSale({
            itemsToProcess,
            productMap,
            features: { hasRecipes: true },
            ignoreStock: false,
            loadData: vi.fn(),
            loadMultipleData,
            STORES: { MENU: 'menu' }
        });

        expect(result.ok).toBe(false);
        expect(result.response.success).toBe(false);
        expect(result.response.errorType).toBe('STOCK_WARNING');
        expect(result.response.message).toContain('STOCK INSUFICIENTE');
        expect(result.response.missingData).toHaveLength(1);
        expect(result.response.missingData[0].ingredientName).toBe('Tomate');
    });

    it('retorna ok cuando ignoreStock=true', async () => {
        const loadData = vi.fn();

        const result = await validateStockBeforeSale({
            itemsToProcess: [{ id: 'dish-1', quantity: 1 }],
            productMap: new Map(),
            features: { hasRecipes: true },
            ignoreStock: true,
            loadData,
            STORES: { MENU: 'menu' }
        });

        expect(result).toEqual({ ok: true });
        expect(loadData).not.toHaveBeenCalled();
    });

    it('usa stock disponible restando committedStock', async () => {
        const loadMultipleData = vi.fn(async () => ([
            { id: 'prod-1', name: 'Cerveza', stock: 10, committedStock: 8 }
        ]));

        const result = await validateStockBeforeSale({
            itemsToProcess: [{ id: 'prod-1', quantity: 3 }],
            productMap: new Map([
                ['prod-1', { id: 'prod-1', name: 'Cerveza', trackStock: true }]
            ]),
            features: { hasRecipes: true },
            ignoreStock: false,
            loadData: vi.fn(),
            loadMultipleData,
            STORES: { MENU: 'menu' }
        });

        expect(result.ok).toBe(false);
        expect(result.response.errorType).toBe('STOCK_WARNING');
        expect(result.response.missingData[0]).toMatchObject({
            ingredientName: 'Cerveza',
            available: 2,
            needed: 3
        });
    });
});
