import { describe, it, expect, vi } from 'vitest';
import { normalizeAndValidatePricing } from '../../sales/priceSecurity';

const depsFor = (product, pricing = { unitPrice: 80, exactTotal: 80 }) => ({
    loadData: vi.fn(async () => product),
    queryBatchesByProductIdAndActive: vi.fn(async () => []),
    calculatePricingDetails: vi.fn(() => pricing),
    Logger: { warn: vi.fn() }
});

const run = (itemsToProcess, total, deps) => normalizeAndValidatePricing({
    itemsToProcess,
    total,
    loadData: deps.loadData,
    queryBatchesByProductIdAndActive: deps.queryBatchesByProductIdAndActive,
    STORES: { MENU: 'menu' },
    calculatePricingDetails: deps.calculatePricingDetails,
    Logger: deps.Logger
});

const burger = (options) => ({
    id: 'burger-1',
    price: 80,
    cost: 35,
    batchManagement: { enabled: false },
    modifiers: [{ name: 'Extras', required: false, options }]
});

describe('normalizeAndValidatePricing', () => {
    it('recalcula precio/costo sin error en caso valido', async () => {
        const items = [{ id: 'prod-1', name: 'Producto 1', quantity: 2, price: 10 }];
        const deps = depsFor({ id: 'prod-1', price: 10, cost: 4, batchManagement: { enabled: false } }, { unitPrice: 10, exactTotal: 20 });

        await run(items, 20, deps);

        expect(items[0].price).toBe(10);
        expect(items[0].cost).toBe(4);
    });

    it('detecta diferencia de precio', async () => {
        const items = [{ id: 'prod-1', name: 'Producto 1', quantity: 2, price: 7 }];
        const deps = depsFor({ id: 'prod-1', price: 10, cost: 4, batchManagement: { enabled: false } }, { unitPrice: 10, exactTotal: 20 });

        await expect(run(items, 14, deps)).rejects.toThrow();
        expect(deps.Logger.warn).toHaveBeenCalledOnce();
    });

    it('usa precio de catalogo para el modificador seleccionado', async () => {
        const items = [{ id: 'burger-1', name: 'Hamburguesa', quantity: 2, price: 90, selectedModifiers: [{ name: 'Extra queso', price: 999 }] }];
        const deps = depsFor(burger([{ name: 'Extra queso', price: 10 }]), { unitPrice: 80, exactTotal: 160 });

        await run(items, 180, deps);

        expect(items[0].price).toBe(90);
        expect(items[0].exactTotal).toBe(180);
        expect(items[0].selectedModifiers[0]).toMatchObject({
            name: 'Extra queso',
            price: 10,
            ingredientId: null,
            ingredientQuantity: null,
            ingredientUnit: null,
            tracksInventory: false
        });
        expect(items[0].selectedModifiers[0]).not.toHaveProperty('quantity');
    });

    it('rechaza modificador inexistente', async () => {
        const items = [{ id: 'burger-1', name: 'Hamburguesa', quantity: 1, price: 90, selectedModifiers: [{ name: 'Extra queso', price: 10 }] }];
        const deps = depsFor(burger([{ name: 'Tocino', price: 15 }]));

        await expect(run(items, 90, deps)).rejects.toThrow();
    });

    it('rechaza grupo requerido sin seleccion', async () => {
        const items = [{ id: 'burger-1', name: 'Hamburguesa', quantity: 1, price: 80 }];
        const deps = depsFor({
            ...burger([{ name: 'Bien cocida', price: 0 }]),
            modifiers: [{ name: 'Termino', required: true, options: [{ name: 'Bien cocida', price: 0 }] }]
        });

        await expect(run(items, 80, deps)).rejects.toThrow();
    });

    it('distingue extras con mismo ingrediente pero distinto id', async () => {
        const items = [{ id: 'burger-1', name: 'Hamburguesa', quantity: 1, price: 98, selectedModifiers: [{ id: 'opt_doble_queso', name: 'Doble queso' }] }];
        const deps = depsFor(burger([
            { id: 'opt_queso_extra', name: 'Queso extra', price: 10, ingredientId: 'ing_queso', ingredientQuantity: 30, ingredientUnit: 'g' },
            { id: 'opt_doble_queso', name: 'Doble queso', price: 18, ingredientId: 'ing_queso', ingredientQuantity: 60, ingredientUnit: 'g' }
        ]));

        await run(items, 98, deps);

        expect(items[0].selectedModifiers[0]).toMatchObject({
            id: 'opt_doble_queso',
            name: 'Doble queso',
            price: 18,
            ingredientId: 'ing_queso',
            ingredientQuantity: 60,
            ingredientUnit: 'g',
            tracksInventory: true,
            quantity: 60
        });
    });

    it('no inventa cantidad para modificador sin inventario', async () => {
        const items = [{ id: 'burger-1', name: 'Hamburguesa', quantity: 1, price: 80, selectedModifiers: [{ id: 'opt_sin_cebolla', name: 'Sin cebolla' }] }];
        const deps = depsFor(burger([{ id: 'opt_sin_cebolla', name: 'Sin cebolla', price: 0 }]));

        await run(items, 80, deps);

        expect(items[0].selectedModifiers[0]).toMatchObject({
            id: 'opt_sin_cebolla',
            name: 'Sin cebolla',
            price: 0,
            ingredientId: null,
            ingredientQuantity: null,
            ingredientUnit: null,
            tracksInventory: false
        });
        expect(items[0].selectedModifiers[0]).not.toHaveProperty('quantity');
    });

    it('acepta quantity legacy cuando hay ingrediente', async () => {
        const items = [{ id: 'burger-1', name: 'Hamburguesa', quantity: 1, price: 95, selectedModifiers: [{ id: 'opt_tocino', name: 'Tocino extra' }] }];
        const deps = depsFor(burger([{ id: 'opt_tocino', name: 'Tocino extra', price: 15, ingredientId: 'ing_tocino', quantity: 25, unit: 'g' }]));

        await run(items, 95, deps);

        expect(items[0].selectedModifiers[0]).toMatchObject({
            id: 'opt_tocino',
            name: 'Tocino extra',
            price: 15,
            ingredientId: 'ing_tocino',
            ingredientQuantity: 25,
            ingredientUnit: 'g',
            tracksInventory: true,
            quantity: 25
        });
    });
});
