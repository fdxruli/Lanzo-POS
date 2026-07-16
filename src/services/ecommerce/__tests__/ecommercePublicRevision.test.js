// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  buildEcommerceConfiguredCartLine,
  buildEcommerceConfiguredLineKey,
  buildMinimalConfiguredOrderItem,
  normalizePublicProductConfiguration
} from '../../../utils/ecommerceConfiguredProduct';
import {
  createEcommercePublicService,
  ecommercePublicServiceInternals
} from '../ecommercePublicService';
import {
  getOrCreateCheckoutAttempt,
  normalizeCheckoutPayload
} from '../ecommerceCheckoutIdempotency';

const REVISION_A = 'a'.repeat(64);
const REVISION_B = 'b'.repeat(64);

const rawDetail = (revision = REVISION_A) => ({
  success: true,
  catalogRevision: 7,
  product: {
    id: 'product-1',
    name: 'Playera',
    currency: 'MXN',
    configurationType: 'configurable',
    configurationVersion: 1,
    configurationRevision: revision,
    requiresConfiguration: true,
    hasVariants: true,
    hasOptionGroups: true,
    basePrice: 100,
    isAvailable: true
  },
  variants: [{
    id: 'variant-1',
    publicName: 'Rojo / M',
    optionValues: { color: 'Rojo', talla: 'M' },
    priceMode: 'delta',
    priceValue: 10,
    isAvailable: true,
    stock: { mode: 'hidden', status: 'available', quantity: null }
  }],
  groups: [{
    id: 'group-1',
    publicName: 'Extras',
    selectionType: 'multiple',
    required: true,
    minSelect: 1,
    maxSelect: 2,
    options: [{
      id: 'option-1',
      publicName: 'Queso extra',
      priceDelta: 5,
      isAvailable: true
    }]
  }]
});

const configuredLine = (revision = REVISION_A) => buildEcommerceConfiguredCartLine(
  normalizePublicProductConfiguration(rawDetail(revision)),
  {
    variantId: 'variant-1',
    selections: [{ groupId: 'group-1', optionIds: ['option-1'] }],
    quantity: 2,
    maxItemQuantity: 10
  }
);

describe('configurationRevision public contract', () => {
  it('normalizes and preserves schema version and content revision', () => {
    const detail = normalizePublicProductConfiguration(rawDetail());
    expect(detail.product.configurationVersion).toBe(1);
    expect(detail.product.configurationRevision).toBe(REVISION_A);

    const line = configuredLine();
    expect(line).toMatchObject({
      success: true,
      configurationVersion: 1,
      configurationRevision: REVISION_A
    });
    expect(line.configurationSnapshot).toMatchObject({
      configurationVersion: 1,
      configurationRevision: REVISION_A
    });
  });

  it('keeps line identity independent from the content revision', () => {
    const lineA = configuredLine(REVISION_A);
    const lineB = configuredLine(REVISION_B);
    expect(lineA.lineKey).toBe(lineB.lineKey);
    expect(lineA.configurationRevision).not.toBe(lineB.configurationRevision);
    expect(lineA.lineKey).toBe(buildEcommerceConfiguredLineKey({
      productId: 'product-1',
      variantId: 'variant-1',
      selections: [{ groupId: 'group-1', optionIds: ['option-1'] }]
    }));
  });

  it('builds a minimal configured payload with revision and no client authority fields', () => {
    const line = configuredLine();
    const item = buildMinimalConfiguredOrderItem({
      product: { id: line.lineKey, configurationLine: line },
      quantity: line.quantity,
      price: 999,
      total: 1998,
      display: { private: true }
    });

    expect(item).toEqual({
      productId: 'product-1',
      quantity: 2,
      variantId: 'variant-1',
      selections: [{ groupId: 'group-1', optionIds: ['option-1'] }],
      configurationVersion: 1,
      configurationRevision: REVISION_A
    });
    expect(JSON.stringify(item)).not.toMatch(/price|unitPrice|total|snapshot|display/i);
  });

  it('keeps simple products legacy-compatible without a revision', () => {
    expect(buildMinimalConfiguredOrderItem({
      product: { id: 'simple-1' },
      quantity: 3
    })).toEqual({ productId: 'simple-1', quantity: 3 });
  });

  it('normalizes service payload without removing the revision', () => {
    const line = configuredLine();
    const [item] = ecommercePublicServiceInternals.normalizeOrderItems([{
      product: { id: line.lineKey, configurationLine: line },
      quantity: 2,
      price: 999
    }]);
    expect(item.configurationRevision).toBe(REVISION_A);
    expect(item.configurationVersion).toBe(1);
    expect(item).not.toHaveProperty('price');
  });

  it('sends the revision through the public order RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        success: true,
        order: {
          id: 'order-1', code: 'PED-1', status: 'new', total: 230,
          currency: 'MXN', fulfillmentMethod: 'pickup', createdAt: '2026-07-16T00:00:00Z'
        },
        whatsapp: {}
      },
      error: null
    });
    const line = configuredLine();
    const service = createEcommercePublicService({ rpc }, {
      cache: null,
      configurationCache: null
    });

    await service.createPublicOrder('mi-tienda', {
      customer: { name: 'Cliente', phone: '9610000000', fulfillmentMethod: 'pickup' },
      items: [{ product: { id: line.lineKey, configurationLine: line }, quantity: 2 }],
      idempotencyKey: 'web-test'
    });

    expect(rpc).toHaveBeenCalledWith('ecommerce_create_order', expect.objectContaining({
      p_items: [expect.objectContaining({
        productId: 'product-1',
        configurationRevision: REVISION_A
      })]
    }));
  });

  it('changes the attempt signature when the revision changes and reuses it otherwise', async () => {
    const storage = new Map();
    const storageApi = {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key)
    };
    let sequence = 0;
    const cryptoImpl = {
      randomUUID: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
      getRandomValues: (array) => array,
      subtle: globalThis.crypto.subtle
    };
    const base = {
      customer: { name: 'Cliente', phone: '9610000000', fulfillmentMethod: 'pickup' },
      items: [{
        productId: 'product-1', quantity: 1, variantId: 'variant-1',
        selections: [{ groupId: 'group-1', optionIds: ['option-1'] }],
        configurationVersion: 1,
        configurationRevision: REVISION_A
      }]
    };

    const first = await getOrCreateCheckoutAttempt('mi-tienda', base, { storage: storageApi, cryptoImpl });
    const replay = await getOrCreateCheckoutAttempt('mi-tienda', base, { storage: storageApi, cryptoImpl });
    const refreshed = await getOrCreateCheckoutAttempt('mi-tienda', {
      ...base,
      items: [{ ...base.items[0], configurationRevision: REVISION_B }]
    }, { storage: storageApi, cryptoImpl });

    expect(replay.idempotencyKey).toBe(first.idempotencyKey);
    expect(replay.reused).toBe(true);
    expect(refreshed.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(refreshed.reused).toBe(false);
    expect(normalizeCheckoutPayload({ slug: 'mi-tienda', ...base }).items[0])
      .toHaveProperty('configurationRevision', REVISION_A);
  });
});
