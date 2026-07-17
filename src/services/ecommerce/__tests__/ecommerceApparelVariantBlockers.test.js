import { describe, expect, it, vi } from 'vitest';
import { normalizeEcommerceVariant } from '../../../utils/ecommerceProductConfiguration';
import { ecommerceAdminServiceInternals } from '../ecommerceAdminService';
import {
  ECOMMERCE_APPAREL_UNAVAILABLE_REASON,
  decorateProductWithEcommerceApparelProjection,
  projectProductBatchesToEcommerceVariants
} from '../ecommerceApparelVariants';
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

describe('apparel commercial identity blockers', () => {
  it('keeps sourceProductId null for sibling variants of the same parent', () => {
    const projection = projectProductBatchesToEcommerceVariants({
      product,
      batches: [
        batch({ id: 'black-m' }),
        batch({
          id: 'black-l',
          sku: 'POLO-NEG-L',
          attributes: { color: 'Negro', talla: 'L' }
        }),
        batch({
          id: 'blue-m',
          sku: 'POLO-AZU-M',
          attributes: { color: 'Azul', talla: 'M' }
        })
      ]
    });

    expect(projection.variants).toHaveLength(3);
    expect(projection.variants.every((variant) => variant.sourceProductId === null)).toBe(true);
    expect(projection.variants.every(
      (variant) => variant.localProductRef === product.id
    )).toBe(true);
    expect(new Set(projection.variants.map(
      (variant) => variant.sourceVariantRef
    )).size).toBe(3);
  });

  it('does not repopulate sourceProductId from localProductRef during normalization', () => {
    const projected = projectProductBatchesToEcommerceVariants({
      product,
      batches: [batch()]
    }).variants[0];

    expect(normalizeEcommerceVariant(projected, {
      productRef: product.id,
      variantIndex: 0
    })).toMatchObject({
      sourceProductId: null,
      localProductRef: product.id,
      sku: 'POLO-NEG-M',
      optionValues: { color: 'Negro', talla: 'M' }
    });
  });
});

describe('empty apparel state', () => {
  it('distinguishes a simple product from an apparel product with no publishable variants', () => {
    const simple = projectProductBatchesToEcommerceVariants({
      product,
      batches: [batch({ sku: null, attributes: {} })]
    });
    const emptyApparel = projectProductBatchesToEcommerceVariants({
      product,
      batches: [batch({ isActive: false })]
    });

    expect(simple).toMatchObject({
      recognizedAsApparel: false,
      variants: [],
      availabilityReasonCode: null
    });
    expect(emptyApparel).toMatchObject({
      recognizedAsApparel: true,
      variants: [],
      sourceAvailable: false,
      stockSnapshot: 0,
      availabilityReasonCode: ECOMMERCE_APPAREL_UNAVAILABLE_REASON
    });
  });

  it('keeps invalid apparel schema fail-closed instead of treating it as simple', () => {
    const projection = projectProductBatchesToEcommerceVariants({
      product,
      batches: [
        batch({
          sku: 'POLO-INCOMPLETE',
          attributes: { color: '', talla: '' }
        })
      ]
    });

    expect(projection).toMatchObject({
      recognizedAsApparel: true,
      variants: [],
      availabilityReasonCode: ECOMMERCE_APPAREL_UNAVAILABLE_REASON
    });
  });

  it('recovers variant_parent configuration when a valid variant reappears', async () => {
    const emptySource = {
      getBatchesByProductIds: vi.fn().mockResolvedValue(new Map([[
        product.id,
        [batch({ isActive: false })]
      ]]))
    };
    const activeSource = {
      getBatchesByProductIds: vi.fn().mockResolvedValue(new Map([[
        product.id,
        [batch({ isActive: true })]
      ]]))
    };

    const emptyPrepared = await ecommerceAdminServiceInternals
      .preparePublishedProductPayloadAsync({
        localProduct: product,
        publicName: product.name,
        price: product.price
      }, { localSource: emptySource });
    const activePrepared = await ecommerceAdminServiceInternals
      .preparePublishedProductPayloadAsync({
        localProduct: product,
        publicName: product.name,
        price: product.price
      }, { localSource: activeSource });

    expect(emptyPrepared.payload.configuration).toMatchObject({
      type: 'variant_parent',
      variants: [],
      availabilitySource: 'variant_aggregate',
      availabilityReasonCode: ECOMMERCE_APPAREL_UNAVAILABLE_REASON
    });
    expect(activePrepared.payload.configuration).toMatchObject({
      type: 'variant_parent',
      availabilitySource: 'variant_aggregate'
    });
    expect(activePrepared.payload.configuration.variants).toHaveLength(1);
  });

  it('patches PRO projections with the empty apparel configuration deterministically', () => {
    const projection = projectProductBatchesToEcommerceVariants({
      product,
      batches: [batch({ isActive: false })]
    });
    const configuredProduct = decorateProductWithEcommerceApparelProjection({
      product,
      projection
    });
    const configuration = ecommerceCatalogSyncDependencyInternals
      .buildProjectedProductConfiguration(configuredProduct);
    const revision = ecommerceCatalogSyncDependencyInternals
      .getPublicConfigurationRevision(configuredProduct);
    const patched = ecommerceCatalogSyncDependencyInternals
      .patchConfigurationProjections([
        {
          localProductRef: product.id,
          configuration: { type: 'simple' },
          sourceAvailable: true,
          sourceState: 'in_stock',
          stockSnapshot: 99
        }
      ], new Map([[
        product.id,
        {
          configuration,
          revision,
          apparelState: {
            recognizedAsApparel: true,
            sourceAvailable: false,
            stockSnapshot: 0,
            availabilityReasonCode: ECOMMERCE_APPAREL_UNAVAILABLE_REASON
          }
        }
      ]]))[0];

    expect(patched).toMatchObject({
      sourceAvailable: false,
      sourceState: 'out_of_stock',
      stockSnapshot: 0,
      configurationSourceRevision: revision,
      configuration: {
        type: 'variant_parent',
        variants: [],
        availabilitySource: 'variant_aggregate',
        availabilityReasonCode: ECOMMERCE_APPAREL_UNAVAILABLE_REASON
      }
    });
  });
});
