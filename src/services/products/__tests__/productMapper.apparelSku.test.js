import { describe, expect, it } from 'vitest';
import {
  batchToCloudPayload,
  cloudBatchToLocal,
  cloudProductToLocal,
  productToCloudPayload
} from '../productMapper';

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
  });
});
