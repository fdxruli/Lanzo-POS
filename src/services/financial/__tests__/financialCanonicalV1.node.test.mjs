import assert from 'node:assert/strict';
import test from 'node:test';
import { hashCanonicalFinancialRequestV1 } from '../financialCanonicalV1.js';

const vectors = [
  ['A', 'sale.cancel', { sale_id: 'sale-1', reason: 'test' }, 'actor-a', null, null, 'b9a2aae4a9cbac969509bf776db9ac49d6169e4318151657d2d6842eb56d953b'],
  ['B', 'cash.movement', { cash_session_id: 'session-a', type: 'entrada', amount: '10', concept: 'float', source: null, reference_type: null, reference_id: null }, 'actor-a', 'session-a', 'station-a', '57142afa91156723a4695a48ecf277848c835da2d30c990f8625e0fc6b41b875'],
  ['C', 'sale.cashier', { cash_session_id: 'session-a', customer_id: null, items: [{ batch_allocations: [], product_id: 'product-a', quantity: '2', selected_modifiers: [] }], payments: [{ amount: '20', method: 'cash' }], sale: { id: 'sale-a', sold_at: '2026-01-02T03:04:05.000000Z', total: '20' } }, 'actor-a', 'session-a', 'station-a', '9aaf9ed23a8f01db515cee3e5469043af8240766d0c72d88663633812b8f5f88'],
  ['D', 'cash.open', { opening: { opening_amount: '100', opening_origin: 'manual' } }, 'actor-a', null, 'station-a', '1105cf39098eb4b6a855bb7bf29fe5269008cdfc2817b04a15aa7af2c01d1002'],
  ['E', 'cash.open', { opening: { opening_amount: '100', opening_origin: 'manual' } }, 'actor-b', null, 'station-b', 'f6b5a9675db1aba16d44140e9e345f4ac1e52e5f4197b16dc5ebe120660ba6a1']
];

for (const [name, operationType, canonicalRequest, actorKey, cashSessionId, cashStationId, expected] of vectors) {
  test(`financial V1 hash vector ${name}`, async () => {
    const actual = await hashCanonicalFinancialRequestV1({ operationType, canonicalRequest, actorKey, cashSessionId, cashStationId });
    assert.equal(actual, `sha256:${expected}`);
  });
}
