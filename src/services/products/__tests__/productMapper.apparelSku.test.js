import { describe, expect, it } from 'vitest';
import {
  batchToCloudPayload,
  cloudBatchToLocal,
  cloudProductToLocal,
  productToCloudPayload
} from '../productMapper';
import { resolveProductRubroContext } from '../apparelSku';

describe('Apparel variant SKU cloud mapping', () => {
  it('sends and restores the persisted variant SKU and its normalized uniqueness key', () => {
    const payload = batchToCloudPayload({
      id: 'apparel-batch-l-blue',
      productId: 'apparel-product',
      sku: 'PLAYERA-L-AZUL-QA',
      attributes: { talla: 'L', color: 'Azul' }
    });

    expect(payload).toMatchObject({
      id: 'apparel-batch-l-blue',
      product_id: 'apparel-product',
      sku: 'PLAYERA-L-AZUL-QA',
      sku_key: 'playera-l-azul-qa',
      attributes: { talla: 'L', color: 'Azul' }
    });
    expect(cloudBatchToLocal({ ...payload, server_version: 3 })).toMatchObject({
      id: 'apparel-batch-l-blue',
      productId: 'apparel-product',
      sku: 'PLAYERA-L-AZUL-QA',
      skuKey: 'playera-l-azul-qa',
      attributes: { talla: 'L', color: 'Azul' },
      serverVersion: 3
    });
  });

  it('preserves a pharmacy calendar expiry through Cloud serialization and reload', () => {
    const payload = batchToCloudPayload({
      id: 'vi-lot', productId: 'medicine-vi', expiryDate: '2026-11-18T00:00:00.000Z'
    });
    expect(payload.expiry_date).toBe('2026-11-18T00:00:00.000Z');
    expect(cloudBatchToLocal(payload).expiryDate).toBe('2026-11-18T00:00:00.000Z');
  });

  it('carries the Apparel discriminator through Cloud metadata without adding it to other rubros', () => {
    const apparelPayload = productToCloudPayload({
      id: 'apparel-product',
      name: 'Playera QA SKU',
      rubroContext: 'apparel'
    });
    expect(apparelPayload.metadata.rubro_context).toBe('apparel');
    expect(cloudProductToLocal(apparelPayload).rubroContext).toBe('apparel');

    const hardwarePayload = productToCloudPayload({
      id: 'hardware-product',
      name: 'Tornillo',
      rubroContext: 'hardware'
    });
    expect(hardwarePayload.metadata).not.toHaveProperty('rubro_context');
    expect(cloudProductToLocal(hardwarePayload).rubroContext).toBeUndefined();

    expect(cloudProductToLocal({
      id: 'historic-apparel-product',
      metadata: { rubroContext: 'Ropa' }
    }).rubroContext).toBe('apparel');
  });

  it('resolves historical context from persisted metadata or a single-rubro business profile only', () => {
    expect(resolveProductRubroContext({ metadata: { rubroContext: 'ropa' } }, ['food_service']))
      .toBe('apparel');
    expect(resolveProductRubroContext({}, ['apparel'])).toBe('apparel');
    expect(resolveProductRubroContext({ attributes: { talla: 'M', color: 'Negro' } }, ['food_service']))
      .toBe('food_service');
    expect(resolveProductRubroContext({}, ['apparel', 'food_service'])).toBeNull();
  });
});
