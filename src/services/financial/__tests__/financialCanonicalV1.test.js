import { describe, expect, it } from 'vitest';
import {
  canonicalFinancialRequestV1,
  financialRequestHashV1,
  hashCanonicalFinancialRequestV1
} from '../financialCanonicalV1';

const vectors = [
  ['A', 'sale.cancel', { sale_id: 'sale-1', reason: 'test' }, 'actor-a', null, null, 'b9a2aae4a9cbac969509bf776db9ac49d6169e4318151657d2d6842eb56d953b'],
  ['B', 'cash.movement', { cash_session_id: 'session-a', type: 'entrada', amount: '10', concept: 'float', source: null, reference_type: null, reference_id: null }, 'actor-a', 'session-a', 'station-a', '57142afa91156723a4695a48ecf277848c835da2d30c990f8625e0fc6b41b875'],
  ['C', 'sale.cashier', { cash_session_id: 'session-a', customer_id: null, items: [{ batch_allocations: [], product_id: 'product-a', quantity: '2', selected_modifiers: [] }], payments: [{ amount: '20', method: 'cash' }], sale: { id: 'sale-a', sold_at: '2026-01-02T03:04:05.000000Z', total: '20' } }, 'actor-a', 'session-a', 'station-a', '9aaf9ed23a8f01db515cee3e5469043af8240766d0c72d88663633812b8f5f88'],
  ['D', 'cash.open', { opening: { opening_amount: '100', opening_origin: 'manual' } }, 'actor-a', null, 'station-a', '1105cf39098eb4b6a855bb7bf29fe5269008cdfc2817b04a15aa7af2c01d1002'],
  ['E', 'cash.open', { opening: { opening_amount: '100', opening_origin: 'manual' } }, 'actor-b', null, 'station-b', 'f6b5a9675db1aba16d44140e9e345f4ac1e52e5f4197b16dc5ebe120660ba6a1']
];

describe('financial V1 canonical request and hash compatibility', () => {
  it.each(vectors)('recomputes frozen R6 vector %s in browser production code', async (_name, operationType, canonicalRequest, actorKey, cashSessionId, cashStationId, expected) => {
    await expect(hashCanonicalFinancialRequestV1({ operationType, canonicalRequest, actorKey, cashSessionId, cashStationId }))
      .resolves.toBe(`sha256:${expected}`);
  });

  it('normalizes numeric and sale aliases without changing their semantic hash', async () => {
    const first = await financialRequestHashV1({
      operationType: 'sale.cashier',
      actorKey: 'admin:a', cashSessionId: 'session-a', cashStationId: 'station-a',
      request: { sale: { id: 'sale-a', total: 10, sold_at: '2026-01-02T03:04:05Z' }, items: [{ productId: 'product-a', qty: '2.0', selectedModifiers: [], batchesUsed: [] }], payments: [{ paymentMethod: 'efectivo', amount: '10.00' }], cash_session_id: 'session-a', customer_id: null }
    });
    const second = await financialRequestHashV1({
      operationType: 'sale.cashier',
      actorKey: 'admin:a', cashSessionId: 'session-a', cashStationId: 'station-a',
      request: { sale: { cloudSaleId: 'sale-a', total: '10.0', soldAt: '2026-01-01T22:04:05-05:00' }, items: [{ parentId: 'product-a', quantity: '2', selected_modifiers: [], batches_used: [] }], payments: [{ method: 'cash', amount: 10 }], cash_session_id: 'session-a', customer_id: null }
    });
    expect(first.canonicalRequest).toEqual(second.canonicalRequest);
    expect(first.requestHash).toBe(second.requestHash);
  });

  it('keeps list order and binds the verified actor and cash station into H', async () => {
    const common = { operationType: 'cash.open', request: { opening_amount: '100', opening_origin: 'manual' }, cashStationId: 'station-a' };
    const actorA = await financialRequestHashV1({ ...common, actorKey: 'admin:a' });
    const actorB = await financialRequestHashV1({ ...common, actorKey: 'admin:b' });
    const stationB = await financialRequestHashV1({ ...common, actorKey: 'admin:a', cashStationId: 'station-b' });
    expect(actorA.requestHash).not.toBe(actorB.requestHash);
    expect(actorA.requestHash).not.toBe(stationB.requestHash);
  });

  it('uses the server null and blank fallback semantics and rejects invalid timestamps', () => {
    expect(canonicalFinancialRequestV1('cash.open', { opening_amount: '', montoInicial: '22', opening_origin: '  ', origen: 'manual' }))
      .toMatchObject({ opening: { opening_amount: '22', opening_origin: 'manual' } });
    expect(() => canonicalFinancialRequestV1('sale.cashier', {
      sale: { id: 'sale', sold_at: '2026-01-02 03:04:05' }, items: [], payments: []
    })).toThrow('FINANCIAL_TIMESTAMP_INVALID');
  });

  it('does not fall through a present null allocation/modifier container to metadata aliases', () => {
    const canonical = canonicalFinancialRequestV1('sale.cashier', {
      sale: { id: 'sale-a' },
      items: [{ product_id: 'product-a', quantity: '1', batches_used: null, selected_modifiers: null, metadata: {
        batches_used: [{ batch_id: 'metadata-batch', quantity: '1' }],
        selected_modifiers: [{ ingredient_id: 'metadata-ingredient', quantity: '1' }]
      } }],
      payments: []
    });
    expect(canonical.items[0]).toMatchObject({ batch_allocations: [], selected_modifiers: [] });
  });

  it('keeps the PR257 old-null and current-omitted empty batch requests equivalent', async () => {
    const shared = {
      sale: { id: 'sale-batch-retry', total: '10', sold_at: '2026-08-30T00:00:00.000Z' },
      items: [{ product_id: 'product-a', quantity: '1', unit_price: '10' }],
      payments: [{ method: 'cash', amount: '10' }],
      cash_session_id: 'session-a',
      customer_id: null
    };
    const oldRequest = {
      ...shared,
      items: [{ ...shared.items[0], metadata: { batchesUsed: null } }]
    };
    const currentRequest = structuredClone(shared);

    const old = await financialRequestHashV1({
      operationType: 'sale.cashier_inventory',
      request: oldRequest,
      actorKey: 'admin:a',
      cashSessionId: 'session-a',
      cashStationId: 'station-a'
    });
    const current = await financialRequestHashV1({
      operationType: 'sale.cashier_inventory',
      request: currentRequest,
      actorKey: 'admin:a',
      cashSessionId: 'session-a',
      cashStationId: 'station-a'
    });

    expect(old.canonicalRequest).toEqual(current.canonicalRequest);
    expect(old.requestHash).toBe(current.requestHash);
  });
});
