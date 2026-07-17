import { describe, expect, it } from 'vitest';
import {
  getEcommerceVariantSelection,
  projectProductBatchesToEcommerceVariants,
  resolveEcommerceVariantBatchCandidates
} from '../ecommerceApparelVariants';

const product = {
  id: 'product-polo',
  name: 'Camisa polo',
  price: 299,
  expirationMode: 'NONE',
  batchManagement: { enabled: true },
  imageUrl: 'https://example.com/polo.jpg'
};

const batch = (overrides = {}) => ({
  id: overrides.id || `batch-${Math.random()}`,
  productId: product.id,
  isActive: true,
  stock: 1,
  committedStock: 0,
  sku: 'POLO-NEG-M',
  price: 299,
  attributes: { color: 'Negro', talla: 'M' },
  ...overrides
});

const project = (batches, sourceProduct = product) => (
  projectProductBatchesToEcommerceVariants({
    product: sourceProduct,
    batches,
    now: new Date('2026-07-17T12:00:00Z')
  }).variants
);

describe('apparel ecommerce variant projection', () => {
  it('creates one commercial variant from one batch', () => {
    const variants = project([batch({ id: 'black-m' })]);
    expect(variants).toHaveLength(1);
    expect(variants[0]).toMatchObject({
      sourceVariantRef: 'sku:POLO-NEG-M',
      sku: 'POLO-NEG-M',
      optionValues: { color: 'Negro', talla: 'M' },
      stockSnapshot: 1,
      sourceAvailable: true
    });
  });

  it('creates different variants for real color combinations', () => {
    const variants = project([
      batch({ id: 'black', sku: 'POLO-NEG-M' }),
      batch({ id: 'blue', sku: 'POLO-AZU-M', attributes: { color: 'Azul', talla: 'M' } })
    ]);
    expect(variants.map((variant) => variant.sku)).toEqual(['POLO-AZU-M', 'POLO-NEG-M']);
  });

  it('aggregates two physical batches with the same SKU', () => {
    const variants = project([
      batch({ id: 'entry-1', stock: 3, committedStock: 1 }),
      batch({ id: 'entry-2', stock: 4, committedStock: 1 })
    ]);
    expect(variants).toHaveLength(1);
    expect(variants[0].stockSnapshot).toBe(5);
  });

  it('aggregates equal attributes when SKU is absent', () => {
    const variants = project([
      batch({ id: 'no-sku-1', sku: '', stock: 2 }),
      batch({ id: 'no-sku-2', sku: null, stock: 3 })
    ]);
    expect(variants).toHaveLength(1);
    expect(variants[0].sourceVariantRef).toMatch(/^attributes:product-polo:/);
    expect(variants[0].stockSnapshot).toBe(5);
  });

  it('blocks incompatible attributes sharing one SKU', () => {
    expect(() => project([
      batch({ id: 'black', attributes: { color: 'Negro', talla: 'M' } }),
      batch({ id: 'blue', attributes: { color: 'Azul', talla: 'M' } })
    ])).toThrow('ECOMMERCE_APPAREL_VARIANT_ATTRIBUTE_CONFLICT');
  });

  it('subtracts committed stock and excludes inactive, deleted and expired batches', () => {
    const variants = project([
      batch({ id: 'available', stock: 6, committedStock: 2 }),
      batch({ id: 'inactive', stock: 20, isActive: false }),
      batch({ id: 'deleted', stock: 20, deletedAt: '2026-07-01T00:00:00Z' }),
      batch({
        id: 'expired',
        stock: 20,
        expirationDate: '2026-07-01',
        sku: 'POLO-EXP-M',
        attributes: { color: 'Rojo', talla: 'M' }
      })
    ], { ...product, expirationMode: 'BATCH' });
    expect(variants).toHaveLength(1);
    expect(variants[0].stockSnapshot).toBe(4);
  });

  it('keeps an out-of-stock variant disabled instead of inventing availability', () => {
    const variants = project([batch({ id: 'empty', stock: 2, committedStock: 2 })]);
    expect(variants[0]).toMatchObject({
      stockSnapshot: 0,
      sourceAvailable: false,
      isAvailable: false
    });
  });

  it('uses deterministic absolute prices per commercial variant', () => {
    const variants = project([
      batch({ id: 'black', price: 299 }),
      batch({
        id: 'blue',
        sku: 'POLO-AZU-M',
        price: 329,
        attributes: { color: 'Azul', talla: 'M' }
      })
    ]);
    expect(variants.find((variant) => variant.sku === 'POLO-NEG-M')).toMatchObject({
      priceMode: 'base',
      priceValue: 0
    });
    expect(variants.find((variant) => variant.sku === 'POLO-AZU-M')).toMatchObject({
      priceMode: 'absolute',
      priceValue: 329
    });
  });

  it('blocks incompatible prices inside the same commercial variant', () => {
    expect(() => project([
      batch({ id: 'price-1', price: 299 }),
      batch({ id: 'price-2', price: 319 })
    ])).toThrow('ECOMMERCE_APPAREL_VARIANT_PRICE_CONFLICT');
  });

  it('does not expose physical batch IDs, cost or private metadata', () => {
    const variants = project([batch({
      id: 'secret-batch',
      cost: 120,
      supplier: 'Private Supplier',
      location: 'Private shelf'
    })]);
    const serialized = JSON.stringify(variants[0]);
    expect(serialized).not.toContain('secret-batch');
    expect(serialized).not.toContain('Private Supplier');
    expect(serialized).not.toContain('Private shelf');
    expect(serialized).not.toContain('"cost"');
  });

  it('keeps sourceVariantRef stable when batch order changes', () => {
    const first = batch({ id: 'entry-a', stock: 2 });
    const second = batch({ id: 'entry-b', stock: 3 });
    expect(project([first, second])[0].sourceVariantRef)
      .toBe(project([second, first])[0].sourceVariantRef);
  });
});

describe('apparel POS batch matching', () => {
  const item = {
    id: product.id,
    quantity: 1,
    ecommerceOptions: {
      variant: {
        sourceVariantRef: 'sku:POLO-NEG-M',
        sku: 'POLO-NEG-M',
        optionValues: { color: 'Negro', talla: 'M' }
      }
    }
  };

  it('reads the authoritative commercial identity from the order snapshot', () => {
    expect(getEcommerceVariantSelection(item)).toMatchObject({
      selected: true,
      sku: 'POLO-NEG-M',
      optionValues: { color: 'Negro', talla: 'M' }
    });
  });

  it('matches only the exact SKU and never a sibling color or size', () => {
    const result = resolveEcommerceVariantBatchCandidates({
      item,
      product,
      batches: [
        batch({ id: 'wanted' }),
        batch({ id: 'blue', sku: 'POLO-AZU-M', attributes: { color: 'Azul', talla: 'M' } }),
        batch({ id: 'small', sku: 'POLO-NEG-S', attributes: { color: 'Negro', talla: 'S' } })
      ]
    });
    expect(result.code).toBeNull();
    expect(result.candidates.map((candidate) => candidate.id)).toEqual(['wanted']);
  });

  it('falls back to the exact attribute set only when the snapshot has no SKU', () => {
    const result = resolveEcommerceVariantBatchCandidates({
      item: {
        ...item,
        ecommerceOptions: {
          variant: { optionValues: { color: 'Negro', talla: 'M' } }
        }
      },
      product,
      batches: [
        batch({ id: 'wanted', sku: '' }),
        batch({ id: 'wrong-size', sku: '', attributes: { color: 'Negro', talla: 'S' } })
      ]
    });
    expect(result.candidates.map((candidate) => candidate.id)).toEqual(['wanted']);
  });

  it('returns a safe conflict when the selected SKU no longer exists', () => {
    const result = resolveEcommerceVariantBatchCandidates({
      item,
      product,
      batches: [batch({ id: 'blue', sku: 'POLO-AZU-M', attributes: { color: 'Azul', talla: 'M' } })]
    });
    expect(result.code).toBe('ECOMMERCE_VARIANT_LOCAL_MAPPING_MISSING');
    expect(result.candidates).toEqual([]);
  });
});
