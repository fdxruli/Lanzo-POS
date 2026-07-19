import { describe, expect, it } from 'vitest';
import { cloudProductToLocal, normalizeProductComplexFields } from '../../products/productMapper';

describe('cloudProductToLocal modifiers', () => {
  it('limpia modificadores locales cuando cloud manda modifiers null', () => {
    const result = cloudProductToLocal(
      { id: 'prod_1', name: 'Hamburguesa', modifiers: null },
      { id: 'prod_1', name: 'Hamburguesa', modifiers: [{ name: 'Extras', options: [{ name: 'Queso extra', price: 10 }] }] }
    );

    expect(result.modifiers).toEqual([]);
  });

  it('conserva y normaliza fallback local cuando cloud omite modifiers', () => {
    const result = cloudProductToLocal(
      { id: 'prod_1', name: 'Hamburguesa' },
      { id: 'prod_1', name: 'Hamburguesa', modifiers: [{ name: 'Extras', options: [{ name: 'Queso extra', price: 10 }] }] }
    );

    expect(result.modifiers).toHaveLength(1);
    expect(result.modifiers[0].options[0]).toMatchObject({
      name: 'Queso extra',
      price: 10,
      tracksInventory: false
    });
  });

  it('normaliza modificadores nuevos enviados por cloud', () => {
    const result = cloudProductToLocal({
      id: 'prod_1',
      name: 'Hamburguesa',
      modifiers: [
        {
          name: 'Extras',
          options: [
            {
              name: 'Tocino extra',
              price: 15,
              ingredientId: 'ing_tocino',
              ingredientQuantity: 25,
              ingredientUnit: 'g'
            }
          ]
        }
      ]
    });

    expect(result.modifiers[0].options[0]).toMatchObject({
      name: 'Tocino extra',
      price: 15,
      ingredientId: 'ing_tocino',
      ingredientQuantity: 25,
      ingredientUnit: 'g',
      tracksInventory: true
    });
  });

  it('normaliza NULL cloud a la representacion canónica local sin perder datos de sync', () => {
    const result = cloudProductToLocal({
      id: 'prod_1',
      name: 'Producto Pro',
      bulk_data: null,
      conversion_factor: null,
      batch_management: null,
      recipe: null,
      modifiers: null,
      wholesale_tiers: null
    }, {
      id: 'prod_1',
      name: 'Producto Pro',
      stock: 12,
      price: 55,
      cost: 31,
      serverVersion: 9,
      syncStatus: 'PENDING',
      pendingOperationId: 'op_1',
      lastSyncedAt: '2026-07-18T00:00:00.000Z',
      metadata: { source: 'legacy' },
      pharmacyConfiguration: { dosage: '10mg' }
    });

    expect(result).toMatchObject({
      bulkData: undefined,
      conversionFactor: undefined,
      batchManagement: undefined,
      recipe: [],
      modifiers: [],
      wholesaleTiers: [],
      serverVersion: 9,
      syncStatus: 'synced',
      pendingOperationId: null,
      metadata: { source: 'legacy' },
      pharmacyConfiguration: { dosage: '10mg' }
    });
  });

  it('conserva configuracion compleja existente si una respuesta parcial omite los campos', () => {
    const existing = {
      id: 'prod_1', name: 'Producto Pro',
      bulkData: { purchase: { unit: 'kg' } },
      conversionFactor: { enabled: true, factor: 1000, purchaseUnit: 'kg' },
      batchManagement: { enabled: false },
      recipe: [{ ingredientId: 'i_1' }],
      modifiers: [{ name: 'Extras', options: [{ name: 'Queso', price: 5 }] }],
      wholesaleTiers: [{ minQty: 10, price: 9 }]
    };

    const result = cloudProductToLocal({ id: 'prod_1', name: 'Producto Pro actualizado' }, existing);

    expect(result.bulkData).toEqual(existing.bulkData);
    expect(result.conversionFactor).toEqual(existing.conversionFactor);
    expect(result.batchManagement).toEqual(existing.batchManagement);
    expect(result.recipe).toEqual(existing.recipe);
    expect(result.modifiers).toHaveLength(1);
    expect(result.wholesaleTiers).toEqual(existing.wholesaleTiers);
  });

  it('conserva valores complejos validos y normaliza productos legacy sin mutarlos', () => {
    const legacy = {
      id: 'prod_legacy',
      bulkData: null,
      conversionFactor: null,
      batchManagement: null,
      recipe: null,
      modifiers: null,
      wholesaleTiers: null,
      metadata: { sync: 'keep' },
      apparel: { sizes: ['M'] }
    };

    const result = normalizeProductComplexFields(legacy);

    expect(result).toMatchObject({ recipe: [], modifiers: [], wholesaleTiers: [], metadata: { sync: 'keep' }, apparel: { sizes: ['M'] } });
    expect(result.bulkData).toBeUndefined();
    expect(result.conversionFactor).toBeUndefined();
    expect(result.batchManagement).toBeUndefined();
    expect(legacy.bulkData).toBeNull();
  });
});
