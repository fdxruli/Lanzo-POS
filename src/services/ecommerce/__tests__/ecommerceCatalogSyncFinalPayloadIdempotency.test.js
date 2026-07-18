// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  ecommerceCatalogSyncDependencyInternals
} from '../ecommerceCatalogSyncService';
import {
  ecommerceCatalogSyncServiceInternals
} from '../ecommerceCatalogSyncServiceBase';

const clone = (value) => JSON.parse(JSON.stringify(value));

const baseProjection = ({
  localProductRef,
  publishedProductId,
  configuration
}) => ({
  publishedProductId,
  localProductRef,
  sourceRevision: 'version:12',
  sourceState: 'in_stock',
  sourceAvailable: true,
  stockSnapshot: 8,
  fields: {
    name: 'Producto',
    description: null,
    category: 'General',
    price: 100,
    image: null
  },
  configuration,
  configurationSourceRevision: 'version:12'
});

const restaurantConfiguration = () => ({
  type: 'configurable',
  version: 1,
  hasRecipe: true,
  variants: [],
  optionGroups: [{
    sourceGroupRef: 'extras',
    publicName: 'Extras',
    selectionType: 'single',
    required: false,
    minSelect: 0,
    maxSelect: 1,
    displayOrder: 0,
    options: [{
      sourceOptionRef: 'queso',
      publicName: 'Queso extra',
      priceDelta: 12,
      sourceIngredientId: 'ingredient-cheese',
      ingredientQuantity: 0.05,
      ingredientUnit: 'kg',
      tracksInventory: true,
      manualAvailable: true,
      sourceAvailable: true,
      displayOrder: 0,
      metadata: {}
    }],
    metadata: {}
  }],
  availabilitySource: 'recipe',
  availabilityReasonCode: 'SOURCE_STOCK_AVAILABLE',
  limitingSource: { productId: null, name: null }
});

const apparelConfiguration = () => ({
  type: 'variant_parent',
  version: 1,
  hasRecipe: false,
  variants: [{
    sourceVariantRef: 'sku-shirt-blue-m',
    sourceProductId: 'shirt-parent',
    localProductRef: 'shirt-parent',
    sku: 'SHIRT-BLUE-M',
    publicName: 'Azul / M',
    optionValues: { color: 'Azul', size: 'M' },
    priceMode: 'base',
    priceValue: 0,
    imageUrl: null,
    imageRef: null,
    trackStock: true,
    stockMode: 'exact',
    stockSnapshot: 3,
    sourceAvailable: true,
    manualAvailable: true,
    displayOrder: 0,
    sourceRevision: 'version:12',
    metadata: {}
  }],
  optionGroups: [],
  availabilitySource: 'variant_aggregate',
  availabilityReasonCode: 'CONFIGURATION_REQUIRED',
  limitingSource: { productId: null, name: null }
});

const buildRequest = async (projection, portalId = 'portal-1') => ({
  projections: [projection],
  idempotencyKey: await ecommerceCatalogSyncServiceInternals.buildBatchIdempotencyKey({
    portalId,
    projections: [projection]
  }),
  expectedCatalogRevision: 60
});

describe('catalog sync final payload idempotency', () => {
  it('re-signs restaurant modifier projections after the final multiselect payload is applied', async () => {
    const originalConfiguration = restaurantConfiguration();
    const originalProjection = baseProjection({
      localProductRef: 'restaurant-product',
      publishedProductId: 'published-restaurant',
      configuration: originalConfiguration
    });
    const request = await buildRequest(originalProjection);

    const finalConfiguration = clone(originalConfiguration);
    finalConfiguration.optionGroups[0].selectionType = 'multiple';
    finalConfiguration.optionGroups[0].maxSelect = 3;
    finalConfiguration.optionGroups[0].options.push({
      ...clone(finalConfiguration.optionGroups[0].options[0]),
      sourceOptionRef: 'tocino',
      publicName: 'Tocino',
      priceDelta: 15,
      sourceIngredientId: 'ingredient-bacon'
    });

    const prepared = await ecommerceCatalogSyncDependencyInternals.prepareSyncBatchRequest(
      request,
      new Map([[
        'restaurant-product',
        {
          configuration: finalConfiguration,
          revision: 'configuration:restaurant-multiselect',
          apparelState: null
        }
      ]])
    );

    expect(prepared.projections[0].configuration.optionGroups[0]).toMatchObject({
      selectionType: 'multiple',
      maxSelect: 3
    });
    expect(prepared.idempotencyKey).not.toBe(request.idempotencyKey);
    expect(prepared.idempotencyKey).toBe(
      await ecommerceCatalogSyncServiceInternals.buildBatchIdempotencyKey({
        portalId: 'portal-1',
        projections: prepared.projections
      })
    );
  });

  it('re-signs apparel projections after variants and aggregate stock replace the base payload', async () => {
    const originalProjection = baseProjection({
      localProductRef: 'apparel-product',
      publishedProductId: 'published-apparel',
      configuration: {
        ...apparelConfiguration(),
        variants: [],
        availabilitySource: 'direct',
        availabilityReasonCode: 'SOURCE_STOCK_AVAILABLE'
      }
    });
    const request = await buildRequest(originalProjection);

    const prepared = await ecommerceCatalogSyncDependencyInternals.prepareSyncBatchRequest(
      request,
      new Map([[
        'apparel-product',
        {
          configuration: apparelConfiguration(),
          revision: 'configuration:apparel-variants',
          apparelState: {
            sourceAvailable: true,
            stockSnapshot: 3
          }
        }
      ]])
    );

    expect(prepared.projections[0]).toMatchObject({
      sourceAvailable: true,
      sourceState: 'in_stock',
      stockSnapshot: 3,
      configurationSourceRevision: 'configuration:apparel-variants',
      configuration: {
        type: 'variant_parent',
        availabilitySource: 'variant_aggregate'
      }
    });
    expect(prepared.projections[0].configuration.variants).toHaveLength(1);
    expect(prepared.idempotencyKey).not.toBe(request.idempotencyKey);
    expect(prepared.idempotencyKey).toBe(
      await ecommerceCatalogSyncServiceInternals.buildBatchIdempotencyKey({
        portalId: 'portal-1',
        projections: prepared.projections
      })
    );
  });

  it('keeps the same key for identical final payloads across retries', async () => {
    const projection = baseProjection({
      localProductRef: 'apparel-product',
      publishedProductId: 'published-apparel',
      configuration: apparelConfiguration()
    });
    const request = await buildRequest(projection);
    const configurations = new Map([[
      'apparel-product',
      {
        configuration: apparelConfiguration(),
        revision: 'configuration:stable',
        apparelState: {
          sourceAvailable: true,
          stockSnapshot: 3
        }
      }
    ]]);

    const first = await ecommerceCatalogSyncDependencyInternals.prepareSyncBatchRequest(
      request,
      configurations
    );
    const second = await ecommerceCatalogSyncDependencyInternals.prepareSyncBatchRequest(
      { ...request, projections: clone(request.projections) },
      configurations
    );

    expect(second.projections).toEqual(first.projections);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });

  it('does not rewrite non-catalog keys used by isolated callers', async () => {
    const projection = baseProjection({
      localProductRef: 'restaurant-product',
      publishedProductId: 'published-restaurant',
      configuration: restaurantConfiguration()
    });
    const prepared = await ecommerceCatalogSyncDependencyInternals.prepareSyncBatchRequest({
      projections: [projection],
      idempotencyKey: 'manual-test-key',
      expectedCatalogRevision: 60
    });

    expect(prepared.idempotencyKey).toBe('manual-test-key');
    expect(prepared.projections).toEqual([projection]);
  });
});
