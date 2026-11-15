// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  EcommerceCheckoutIdempotencyError,
  clearCheckoutAttempt,
  getCheckoutAttemptStorageKey,
  getStoredCheckoutAttempt,
  getOrCreateCheckoutAttempt,
  isAmbiguousCheckoutError,
  markCheckoutAttemptAmbiguous,
  normalizeCheckoutPayload,
} from '../ecommerceCheckoutIdempotency';

const payload = (overrides = {}) => ({
  customer: {
    name: 'Cliente',
    phone: '9610000000',
    address: '',
    notes: '',
    fulfillmentMethod: 'pickup',
    ...overrides.customer,
  },
  items: overrides.items || [
    { productId: 'b-product', quantity: 1 },
    { productId: 'a-product', quantity: 2 },
  ],
});

describe('ecommerceCheckoutIdempotency', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('reuses the same key for the same normalized payload', async () => {
    const first = await getOrCreateCheckoutAttempt('mi-negocio', payload());
    const second = await getOrCreateCheckoutAttempt('mi-negocio', payload({
      items: [
        { productId: 'a-product', quantity: 2 },
        { productId: 'b-product', quantity: 1 },
      ],
    }));

    expect(first.idempotencyKey).toMatch(/^web-/);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second.reused).toBe(true);
  });

  it('blocks a changed cart until the prior result is resolved', async () => {
    const first = await getOrCreateCheckoutAttempt('mi-negocio', payload());
    await expect(getOrCreateCheckoutAttempt('mi-negocio', payload({
      items: [{ productId: 'a-product', quantity: 3 }],
    }))).rejects.toMatchObject({ code: 'ECOMMERCE_CHECKOUT_RESULT_UNCERTAIN' });
    expect(getStoredCheckoutAttempt('mi-negocio')).toMatchObject({
      idempotencyKey: first.idempotencyKey,
      status: 'pending'
    });
  });

  it('creates a new key after the prior attempt has a definitive failure', async () => {
    const first = await getOrCreateCheckoutAttempt('mi-negocio', payload());
    clearCheckoutAttempt('mi-negocio', first.idempotencyKey);
    const second = await getOrCreateCheckoutAttempt('mi-negocio', payload({
      items: [{ productId: 'a-product', quantity: 3 }],
    }));
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it('includes structured delivery fields in the hash and ignores them for pickup', async () => {
    const delivery = {
      name: 'Cliente',
      phone: '9610000000',
      address: 'legacy value',
      fulfillmentMethod: 'delivery',
      deliveryAddress: {
        street: 'Calle Central',
        exteriorNumber: '24',
        interiorNumber: '',
        neighborhood: 'Centro',
        municipality: 'Tuxtla',
        state: 'Chiapas',
        postalCode: '29000',
        reference: 'Frente al parque'
      }
    };

    expect(normalizeCheckoutPayload({ slug: 'mi-negocio', customer: delivery, items: [] })).toMatchObject({
      customer: {
        address: 'Calle Central #24, Centro, Tuxtla, Chiapas, CP 29000',
        deliveryAddress: delivery.deliveryAddress
      }
    });
    expect(normalizeCheckoutPayload({
      slug: 'mi-negocio',
      customer: { ...delivery, fulfillmentMethod: 'pickup' },
      items: []
    }).customer).not.toHaveProperty('deliveryAddress');

    const first = await getOrCreateCheckoutAttempt('mi-negocio', payload({ customer: delivery }));
    clearCheckoutAttempt('mi-negocio', first.idempotencyKey);
    const second = await getOrCreateCheckoutAttempt('mi-negocio', payload({
      customer: {
        ...delivery,
        deliveryAddress: { ...delivery.deliveryAddress, municipality: 'San Cristóbal' }
      }
    }));
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it('reuses the same unresolved key after 24 hours', async () => {
    const first = await getOrCreateCheckoutAttempt('mi-negocio', payload(), {
      now: new Date('2026-07-08T10:00:00.000Z'),
    });
    const second = await getOrCreateCheckoutAttempt('mi-negocio', payload(), {
      now: new Date('2026-07-10T10:00:01.000Z'),
    });
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });

  it('keeps the attempt available after an ambiguous error until success clears it', async () => {
    const attempt = await getOrCreateCheckoutAttempt('mi-negocio', payload());
    const retry = await getOrCreateCheckoutAttempt('mi-negocio', payload());
    expect(retry.idempotencyKey).toBe(attempt.idempotencyKey);

    expect(clearCheckoutAttempt('mi-negocio', attempt.idempotencyKey)).toBe(true);
    expect(window.sessionStorage.getItem(getCheckoutAttemptStorageKey('mi-negocio'))).toBeNull();
  });

  it('keeps an existing key when the server says its order must be checked', () => {
    expect(isAmbiguousCheckoutError({ code: 'ECOMMERCE_IDEMPOTENCY_CONFLICT' })).toBe(true);
    expect(isAmbiguousCheckoutError({ code: 'ORDER_ALREADY_PROCESSING' })).toBe(true);
  });

  it('stores accepted line economics without storing customer details', async () => {
    await getOrCreateCheckoutAttempt('mi-negocio', payload({
      customer: { name: 'Nombre privado', phone: '9611234567', address: 'Dirección privada' },
      items: [{
        productId: 'product-1',
        quantity: 1,
        acceptedPricing: {
          pricingMode: 'standard',
          baseUnitPrice: '100.00',
          appliedUnitPrice: '100.00',
          variantAdjustment: '0.00',
          optionsAdjustment: '0.00',
          lineTotal: '100.00'
        }
      }]
    }));
    const stored = window.sessionStorage.getItem(getCheckoutAttemptStorageKey('mi-negocio'));
    expect(stored).not.toContain('Nombre privado');
    expect(stored).not.toContain('9611234567');
    expect(Object.keys(JSON.parse(stored)).sort()).toEqual([
      'acceptedItems',
      'createdAt',
      'idempotencyKey',
      'payloadHash',
      'status',
      'version',
    ]);
    expect(JSON.parse(stored).acceptedItems[0].acceptedPricing.lineTotal).toBe('100.00');
  });

  it('includes accepted price in the attempt hash and blocks silent acceptance changes', async () => {
    const item = (lineTotal) => [{
      productId: 'product-1',
      quantity: 1,
      acceptedPricing: {
        pricingMode: 'standard',
        baseUnitPrice: '100.00',
        appliedUnitPrice: lineTotal,
        variantAdjustment: '0.00',
        optionsAdjustment: '0.00',
        lineTotal
      }
    }];
    const first = await getOrCreateCheckoutAttempt('mi-negocio', payload({ items: item('100.00') }));
    await expect(getOrCreateCheckoutAttempt('mi-negocio', payload({ items: item('120.00') })))
      .rejects.toMatchObject({ code: 'ECOMMERCE_CHECKOUT_RESULT_UNCERTAIN' });
    markCheckoutAttemptAmbiguous('mi-negocio', first.idempotencyKey);
    expect(getStoredCheckoutAttempt('mi-negocio')).toMatchObject({ status: 'ambiguous' });
  });

  it('blocks checkout when secure crypto is unavailable', async () => {
    await expect(getOrCreateCheckoutAttempt('mi-negocio', payload(), {
      cryptoImpl: {},
    })).rejects.toBeInstanceOf(EcommerceCheckoutIdempotencyError);
  });
});
