// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  EcommerceCheckoutIdempotencyError,
  clearCheckoutAttempt,
  getCheckoutAttemptStorageKey,
  getOrCreateCheckoutAttempt,
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

  it('creates a new key when the cart changes', async () => {
    const first = await getOrCreateCheckoutAttempt('mi-negocio', payload());
    const second = await getOrCreateCheckoutAttempt('mi-negocio', payload({
      items: [{ productId: 'a-product', quantity: 3 }],
    }));
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it('creates a new key when the customer changes', async () => {
    const first = await getOrCreateCheckoutAttempt('mi-negocio', payload());
    const second = await getOrCreateCheckoutAttempt('mi-negocio', payload({
      customer: { phone: '9619999999' },
    }));
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it('creates a new key when the stored attempt is older than 24 hours', async () => {
    const first = await getOrCreateCheckoutAttempt('mi-negocio', payload(), {
      now: new Date('2026-07-08T10:00:00.000Z'),
    });
    const second = await getOrCreateCheckoutAttempt('mi-negocio', payload(), {
      now: new Date('2026-07-10T10:00:01.000Z'),
    });
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it('keeps the attempt available after an ambiguous error until success clears it', async () => {
    const attempt = await getOrCreateCheckoutAttempt('mi-negocio', payload());
    const retry = await getOrCreateCheckoutAttempt('mi-negocio', payload());
    expect(retry.idempotencyKey).toBe(attempt.idempotencyKey);

    expect(clearCheckoutAttempt('mi-negocio', attempt.idempotencyKey)).toBe(true);
    expect(window.sessionStorage.getItem(getCheckoutAttemptStorageKey('mi-negocio'))).toBeNull();
  });

  it('stores only the key, hash, version and timestamp', async () => {
    await getOrCreateCheckoutAttempt('mi-negocio', payload({
      customer: { name: 'Nombre privado', phone: '9611234567', address: 'Dirección privada' },
    }));
    const stored = window.sessionStorage.getItem(getCheckoutAttemptStorageKey('mi-negocio'));
    expect(stored).not.toContain('Nombre privado');
    expect(stored).not.toContain('9611234567');
    expect(Object.keys(JSON.parse(stored)).sort()).toEqual([
      'createdAt',
      'idempotencyKey',
      'payloadHash',
      'version',
    ]);
  });

  it('blocks checkout when secure crypto is unavailable', async () => {
    await expect(getOrCreateCheckoutAttempt('mi-negocio', payload(), {
      cryptoImpl: {},
    })).rejects.toBeInstanceOf(EcommerceCheckoutIdempotencyError);
  });
});
