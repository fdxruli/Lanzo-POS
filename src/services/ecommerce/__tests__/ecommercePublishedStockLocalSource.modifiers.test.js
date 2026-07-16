import { describe, expect, it, vi } from 'vitest';
import { createEcommercePublishedStockLocalSource } from '../ecommercePublishedStockLocalSource';

const createDatabase = (productsById = {}) => ({
  isOpen: () => true,
  open: vi.fn(),
  table: vi.fn((store) => {
    if (store === 'menu') {
      return {
        bulkGet: vi.fn(async (ids) => ids.map((id) => productsById[id]))
      };
    }
    return {
      bulkGet: vi.fn(async (ids) => ids.map(() => undefined)),
      where: vi.fn(() => ({
        anyOf: vi.fn(() => ({ toArray: vi.fn(async () => []) }))
      }))
    };
  })
});

describe('ecommercePublishedStockLocalSource modifier normalization', () => {
  it('normaliza extras legacy opcionales antes de proyectarlos al catálogo público', async () => {
    const database = createDatabase({
      'product-1': {
        id: 'product-1',
        name: 'Hamburguesa',
        modifiers: [{
          id: 'extras',
          name: 'Extras',
          required: false,
          options: [
            { id: 'queso', name: 'Queso extra', price: 10 },
            { id: 'papas', name: 'Papas extra', price: 25 }
          ]
        }]
      }
    });
    const source = createEcommercePublishedStockLocalSource({
      database,
      stores: {
        MENU: 'menu',
        CATEGORIES: 'categories',
        PRODUCT_BATCHES: 'batches'
      }
    });

    const products = await source.getProductsByIds(['product-1']);
    const group = products.get('product-1').modifiers[0];

    expect(group).toMatchObject({
      id: 'extras',
      name: 'Extras',
      selectionType: 'multiple',
      multiple: true,
      required: false,
      minSelect: 0,
      maxSelect: 2
    });
  });

  it('conserva como selección única los grupos legacy obligatorios', async () => {
    const database = createDatabase({
      'product-1': {
        id: 'product-1',
        name: 'Hamburguesa',
        modifiers: [{
          id: 'preparacion',
          name: 'Preparación',
          required: true,
          options: [
            { id: 'normal', name: 'Normal', price: 0 },
            { id: 'sin-queso', name: 'Sin queso', price: 0 }
          ]
        }]
      }
    });
    const source = createEcommercePublishedStockLocalSource({
      database,
      stores: {
        MENU: 'menu',
        CATEGORIES: 'categories',
        PRODUCT_BATCHES: 'batches'
      }
    });

    const products = await source.getProductsByIds(['product-1']);
    expect(products.get('product-1').modifiers[0]).toMatchObject({
      selectionType: 'single',
      multiple: false,
      required: true,
      minSelect: 1,
      maxSelect: 1
    });
  });
});
