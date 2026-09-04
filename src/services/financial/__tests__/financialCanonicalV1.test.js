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

  it('converges layaway create aliases, date-only deadlines, and ignores client station fields', () => {
    const first = canonicalFinancialRequestV1('layaway.create', {
      layawayData: {
        id: 'layaway-1',
        customerId: 'customer-1',
        customerName: 'Cliente',
        totalAmount: 175,
        currency: 'mxn',
        deadline: '2026-07-30',
        items: [{
          id: 'item-1',
          parentId: 'product-1',
          name: 'Camisa',
          sku: 'SKU-1',
          variantAttributes: { size: 'M', color: 'Azul' },
          quantity: 1,
          price: '175.00',
          cost: 80,
          total: 175
        }]
      },
      initialPayment: {
        paymentId: 'payment-1',
        total: '25.00',
        paymentMethod: 'efectivo',
        paymentType: 'initial_deposit',
        cashSessionId: 'cash-1'
      },
      cash_station_id: 'attacker-station'
    });
    const second = canonicalFinancialRequestV1('layaway.create', {
      layaway: {
        id: 'layaway-1',
        customer_id: 'customer-1',
        customer_name: 'Cliente',
        total_amount: '175.0',
        currency: 'MXN',
        deadline: '2026-07-30T00:00:00Z',
        items: [{
          id: 'item-1',
          product_id: 'product-1',
          product_name: 'Camisa',
          product_sku: 'SKU-1',
          variant_attributes: { size: 'M', color: 'Azul' },
          quantity: '1.0',
          unit_price: 175,
          unit_cost: '80.00',
          line_total: '175.00'
        }]
      },
      initial_payment: {
        id: 'payment-1',
        amount: 25,
        method: 'cash',
        payment_type: 'initial_deposit',
        cash_session_id: 'cash-1'
      },
      cashSessionId: 'cash-1',
      cash_station_id: 'different-attacker-station'
    });

    expect(first).toEqual(second);
    expect(first.cash_station_id).toBeUndefined();
    expect(first.layaway.deadline).toBe('2026-07-30T00:00:00.000000Z');
  });

  it.each([
    ['2026-2-4', 'FINANCIAL_TIMESTAMP_INVALID'],
    ['2026-02-30', 'FINANCIAL_TIMESTAMP_INVALID'],
    ['2026-13-01', 'FINANCIAL_TIMESTAMP_INVALID'],
    ['', 'LAYAWAY_DEADLINE_REQUIRED'],
    [null, 'LAYAWAY_DEADLINE_REQUIRED'],
    ['2026-07-30T10:20:30', 'FINANCIAL_TIMESTAMP_INVALID'],
    ['2026-07-30T25:20:30.000000Z', 'FINANCIAL_TIMESTAMP_INVALID']
  ])('rejects invalid layaway deadline %s before hashing it', (deadline, code) => {
    expect(() => canonicalFinancialRequestV1('layaway.create', {
      layaway: { id: 'layaway-invalid', total_amount: '10', deadline, items: [] },
      initial_payment: null
    })).toThrow(code);
  });

  it('validates timestamp calendar components instead of allowing Date.UTC overflow', () => {
    expect(canonicalFinancialRequestV1('layaway.create', {
      layaway: { id: 'layaway-valid', total_amount: '10', deadline: '2024-02-29', items: [] },
      initial_payment: null
    }).layaway.deadline).toBe('2024-02-29T00:00:00.000000Z');

    expect(() => canonicalFinancialRequestV1('layaway.create', {
      layaway: { id: 'layaway-invalid-leap', total_amount: '10', deadline: '2026-02-29', items: [] },
      initial_payment: null
    })).toThrow('FINANCIAL_TIMESTAMP_INVALID');
  });

  it('converges layaway payment and cancellation session aliases', () => {
    expect(canonicalFinancialRequestV1('layaway.payment', {
      layawayId: 'layaway-1',
      payment: { paymentId: 'payment-2', total: '50.00', paymentMethod: 'efectivo', paymentType: 'installment' },
      cajaId: 'cash-2',
      cash_station_id: 'attacker-station'
    })).toEqual(canonicalFinancialRequestV1('layaway.payment', {
      layaway_id: 'layaway-1',
      payment: { id: 'payment-2', amount: 50, method: 'cash', payment_type: 'installment', cash_session_id: 'cash-2' },
      cashSessionId: 'cash-2',
      cash_station_id: 'another-attacker-station'
    }));

    expect(canonicalFinancialRequestV1('layaway.cancel', {
      layawayId: 'layaway-1', reason: 'Cliente', retainMoney: false, refundId: 'refund-1', cajaId: 'cash-2'
    })).toEqual(canonicalFinancialRequestV1('layaway.cancel', {
      layaway_id: 'layaway-1', reason: 'Cliente', retain_money: false, refund_id: 'refund-1', cash_session_id: 'cash-2'
    }));
  });
});
