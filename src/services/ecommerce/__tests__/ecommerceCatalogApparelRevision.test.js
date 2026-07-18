import { describe, expect, it } from 'vitest';
import { ecommerceCatalogSyncDependencyInternals } from '../ecommerceCatalogSyncService';

const product = {
  id: 'product-polo',
  name: 'Camisa polo',
  price: 299,
  trackStock: true,
  batchManagement: { enabled: true }
};

const batch = (overrides = {}) => ({
  id: overrides.id || 'batch-default',
  productId: product.id,
  isActive: true,
  stock: 2,
  committedStock: 0,
  price: 299,
  sku: 'POLO-NEG-M',
  attributes: { color: 'Negro', talla: 'M' },
  ...overrides
});

const revisionFor = (batches) => {
  const configured = ecommerceCatalogSyncDependencyInternals.decorateProductWithApparelVariants({
    product,
    batches
  });
  return ecommerceCatalogSyncDependencyInternals.getPublicConfigurationRevision(configured);
};

describe('PRO apparel configuration revision', () => {
  it('changes when public stock for the commercial variant changes', () => {
    expect(revisionFor([batch({ stock: 2 })]))
      .not.toBe(revisionFor([batch({ stock: 3 })]));
  });

  it('does not change when physical batch order changes', () => {
    const first = batch({ id: 'entry-1', stock: 2 });
    const second = batch({ id: 'entry-2', stock: 3 });
    expect(revisionFor([first, second])).toBe(revisionFor([second, first]));
  });

  it('does not change for private batch metadata', () => {
    expect(revisionFor([batch({ cost: 100, supplier: 'A' })]))
      .toBe(revisionFor([batch({ cost: 250, supplier: 'B' })]));
  });
});
