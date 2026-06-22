import { describe, it, expect, vi } from 'vitest';
import { normalizeAndValidatePricing } from '../../sales/priceSecurity';

const makeBaseDeps = (product, pricing = { unitPrice: 10, exactTotal: 20 }) => ({
    loadData: vi.fn(async () => product),
    queryBatchesByProductIdAndActive: vi.fn(async () => []),
    calculatePricingDetails: vi.fn(() => pricing),
    Logger: { warn: vi.fn() }
});

describe('normalizeAndValidatePricing', () => {
    it('recalcula precio/costo sin error en caso valido', async () => {
        const itemsToProcess = [{ id: 'prod-1', name: 'Producto 1', quantity: 2, price: 10 }];
        const deps = makeBaseDeps({
            id: 'prod-1',
            price: 10,
            cost: 4,
            batchManagement: { enabled: false }
        });

        await normalizeAndValidatePricing({
            itemsToProcess,
            total: 20,
            loadData: deps.loadData,
            queryBatchesByProductIdAndActive: deps.queryBatchesByProductIdAndActive,
            STORES: { MENU: 'menu' },
            calculatePricingDetails: deps.calculatePricingDetails,
            Logger: deps.Logger
        });

        expect(itemsToProcess[0].price).toBe(10);
        expect(itemsToProcess[0].cost).toBe(4);
        expect(deps.Logger.warn).not.toHaveBeenCalled();
    });

    it('lanza error cuando detecta manipulacion de precios/total', async () => {
        const itemsToProcess = [{ id: 'prod-1', name: 'Producto 1', quantity: 2, price: 7 }];
        const deps = makeBaseDeps({
            id: 'prod-1',
            price: 10,
            cost: 4,
            batchManagement: { enabled: false }
        });

        await expect(normalizeAndValidatePricing({
            itemsToProcess,
            total: 14,
            loadData: deps.loadData,
            queryBatchesByProductIdAndActive: deps.queryBatchesByProductIdAndActive,
            STORES: { MENU: 'menu' },
            calculatePricingDetails: deps.calculatePricingDetails,
            Logger: deps.Logger
        })).rejects.toThrow('ALERTA DE SEGURIDAD CRITICA');

        expect(deps.Logger.warn).toHaveBeenCalledOnce();
    });

    it('permite precio base mas modificadores autoritativos del producto', async () => {
        const itemsToProcess = [{
            id: 'burger-1',
            name: 'Hamburguesa',
            quantity: 1,
            price: 90,
            selectedModifiers: [{ name: 'Extra queso', price: 10 }]
        }];
        const deps = makeBaseDeps(
            {
                id: 'burger-1',
                price: 80,
                cost: 35,
                batchManagement: { enabled: false },
                modifiers: [{
                    name: 'Extras',
                    required: false,
                    options: [{ name: 'Extra queso', price: 10 }]
                }]
            },
            { unitPrice: 80, exactTotal: 80 }
        );

        await normalizeAndValidatePricing({
            itemsToProcess,
            total: 90,
            loadData: deps.loadData,
            queryBatchesByProductIdAndActive: deps.queryBatchesByProductIdAndActive,
            STORES: { MENU: 'menu' },
            calculatePricingDetails: deps.calculatePricingDetails,
            Logger: deps.Logger
        });

        expect(itemsToProcess[0].price).toBe(90);
        expect(itemsToProcess[0].exactTotal).toBe(90);
        expect(itemsToProcess[0].selectedModifiers).toEqual([
            { name: 'Extra queso', price: 10, ingredientId: null, quantity: 1 }
        ]);
        expect(deps.Logger.warn).not.toHaveBeenCalled();
    });

    it('sanea el precio de modificadores usando el catalogo antes de guardar', async () => {
        const itemsToProcess = [{
            id: 'burger-1',
            name: 'Hamburguesa',
            quantity: 2,
            price: 90,
            selectedModifiers: [{ name: 'Extra queso', price: 999 }]
        }];
        const deps = makeBaseDeps(
            {
                id: 'burger-1',
                price: 80,
                cost: 35,
                batchManagement: { enabled: false },
                modifiers: [{
                    name: 'Extras',
                    required: false,
                    options: [{ name: 'Extra queso', price: 10 }]
                }]
            },
            { unitPrice: 80, exactTotal: 160 }
        );

        await normalizeAndValidatePricing({
            itemsToProcess,
            total: 180,
            loadData: deps.loadData,
            queryBatchesByProductIdAndActive: deps.queryBatchesByProductIdAndActive,
            STORES: { MENU: 'menu' },
            calculatePricingDetails: deps.calculatePricingDetails,
            Logger: deps.Logger
        });

        expect(itemsToProcess[0].price).toBe(90);
        expect(itemsToProcess[0].exactTotal).toBe(180);
        expect(itemsToProcess[0].selectedModifiers[0].price).toBe(10);
    });

    it('bloquea modificadores seleccionados que no existen en la configuracion del producto', async () => {
        const itemsToProcess = [{
            id: 'burger-1',
            name: 'Hamburguesa',
            quantity: 1,
            price: 90,
            selectedModifiers: [{ name: 'Extra queso', price: 10 }]
        }];
        const deps = makeBaseDeps(
            {
                id: 'burger-1',
                price: 80,
                cost: 35,
                batchManagement: { enabled: false },
                modifiers: [{
                    name: 'Extras',
                    required: false,
                    options: [{ name: 'Tocino', price: 15 }]
                }]
            },
            { unitPrice: 80, exactTotal: 80 }
        );

        await expect(normalizeAndValidatePricing({
            itemsToProcess,
            total: 90,
            loadData: deps.loadData,
            queryBatchesByProductIdAndActive: deps.queryBatchesByProductIdAndActive,
            STORES: { MENU: 'menu' },
            calculatePricingDetails: deps.calculatePricingDetails,
            Logger: deps.Logger
        })).rejects.toThrow('El modificador "Extra queso" no existe');
    });

    it('bloquea productos con grupos de modificadores obligatorios sin seleccion valida', async () => {
        const itemsToProcess = [{
            id: 'burger-1',
            name: 'Hamburguesa',
            quantity: 1,
            price: 80
        }];
        const deps = makeBaseDeps(
            {
                id: 'burger-1',
                price: 80,
                cost: 35,
                batchManagement: { enabled: false },
                modifiers: [{
                    name: 'Termino',
                    required: true,
                    options: [{ name: 'Bien cocida', price: 0 }]
                }]
            },
            { unitPrice: 80, exactTotal: 80 }
        );

        await expect(normalizeAndValidatePricing({
            itemsToProcess,
            total: 80,
            loadData: deps.loadData,
            queryBatchesByProductIdAndActive: deps.queryBatchesByProductIdAndActive,
            STORES: { MENU: 'menu' },
            calculatePricingDetails: deps.calculatePricingDetails,
            Logger: deps.Logger
        })).rejects.toThrow('Falta seleccionar un modificador obligatorio');
    });
});
