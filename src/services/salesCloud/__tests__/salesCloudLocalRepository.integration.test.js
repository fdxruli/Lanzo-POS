import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ database: null }));
vi.mock('../../db/dexie', () => ({
  STORES: {
    SALES: 'sales', MENU: 'menu', PRODUCT_BATCHES: 'product_batches',
    TRANSACTION_LOG: 'transaction_log', SYNC_CACHE: 'sync_cache',
    MOVIMIENTOS_CAJA: 'movimientos_caja', DELETED_SALES: 'deleted_sales',
    WASTE: 'waste_logs', LAYAWAYS: 'layaways'
  },
  db: {
    table: (name) => runtime.database.table(name),
    transaction: (...args) => runtime.database.transaction(...args),
    isOpen: () => runtime.database.isOpen(),
    open: () => runtime.database.open()
  }
}));
vi.mock('../../supabase', () => ({ getStableDeviceId: vi.fn() }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => ({}) } }));
vi.mock('../../products/productSyncHandler', () => ({ pullCatalogChanges: vi.fn() }));
vi.mock('../salesCloudRepository', () => ({ salesCloudRepository: {} }));
vi.mock('../../auth/actorRuntimeController', () => ({ actorRuntimeController: {} }));
vi.mock('../../cash/cashRepository', () => ({ cashRepository: {} }));
vi.mock('../../db/layaways', () => ({ layawayRepository: {} }));

import { STORES } from '../../db/dexie';
import { applySplitSalesFinancialResponseProjection } from '../salesCloudCashierService';
import { salesCloudLocalRepository } from '../salesCloudLocalRepository';
import { loadCashSessionProjection } from '../../cajaProjection';
import { getExplicitSalePaymentRows } from '../../sales/paymentMethodContract';
import { Money } from '../../../utils/moneyMath';
import { reconcileActiveTableReservations } from '../../sales/tableReservationReconciliation';

const cashSession = {
  id: 'session-3b', monto_inicial: '50',
  fecha_apertura: '2026-10-02T10:00:00.000Z',
  fecha_cierre: '2026-10-02T18:00:00.000Z'
};
const sumAmounts = (rows) => Money.toExactString(rows.reduce(
  (sum, row) => Money.add(sum, row.amount ?? row.monto), Money.init(0)
));
const makeFixture = ({ total = '100', payments, method = 'mixed', balance = '0', splitIntent = 'equal_payment' }) => {
  const cloudSale = {
    id: 'cloud-sale-qa10', local_sale_id: 'local-sale-3b', total,
    payment_method: method, amount_paid: Money.toExactString(Money.subtract(total, balance)),
    balance_due: balance, status: 'closed', source_mode: 'cloud_committed',
    sold_at: '2026-10-02T12:00:00.000Z', folio: 'FG-01-NEW-QA',
    cash_session_id: cashSession.id, customer_id: balance === '0' ? null : 'customer-3b',
    credit_effect_status: balance === '0' ? 'not_applied' : 'applied',
    credit_ledger_charge_id: balance === '0' ? null : 'charge-3b',
    credit_ledger_payment_id: balance === '0' ? null : 'payment-3b'
  };
  const rows = payments.map((payment, index) => ({
    id: `payment-${index}`, sale_id: cloudSale.id, ...payment
  }));
  const items = [{ id: 'pizza', name: 'Pizza QA', quantity: 1, price: total }];
  return {
    requestPayload: {
      parent_order_id: 'parent-3b', split_group_id: 'group-3b', split_intent: splitIntent,
      children: [{ sale: { id: cloudSale.local_sale_id }, local_items: items }]
    },
    responsePayload: { success: true, children: [{ sale: cloudSale, items: [], payments: rows }] }
  };
};
const qa10Payments = [
  { method: 'cash', amount: '33.34', received_amount: '33.34', change_amount: '0' },
  { method: 'card', amount: '33.33' },
  { method: 'transfer', amount: '33.33' }
];

beforeEach(async () => {
  runtime.database = new Dexie(`sales-cloud-3b-${crypto.randomUUID()}`);
  runtime.database.version(1).stores({
    sales: 'id, status, timestamp, cash_session_id', menu: 'id', product_batches: 'id, productId',
    transaction_log: 'id', sync_cache: 'key', movimientos_caja: 'id, cash_session_id',
    deleted_sales: 'id, deletedAt', waste_logs: 'id, timestamp', layaways: 'id', customer_ledger: 'id'
  });
  await runtime.database.open();
  await runtime.database.table(STORES.SALES).put({ id: 'parent-3b', status: 'open', items: [] });
});
afterEach(async () => {
  await runtime.database.delete();
  runtime.database = null;
});

describe('Cloud split payments persisted through Dexie into Caja', () => {
  it('ignores foreign reservation snapshots during hold repair and successful split cleanup', async () => {
    const inventory = { id: 'pizza', stock: 12, committedStock: 2, trackStock: true };
    const item = { id: 'pizza', quantity: 9, inventoryReservation: { source: 'table', committedQuantity: 9, committedBatches: [{ batchId: 'foreign-batch', quantity: 9 }] } };
    await runtime.database.table(STORES.MENU).put(inventory);
    await runtime.database.table(STORES.SALES).put({ id: 'parent-3b', status: 'open', items: [item], restaurantCloudHydrated: true, reservationAuthority: 'cloud' });
    await runtime.database.transaction('rw', [runtime.database.table(STORES.SALES), runtime.database.table(STORES.MENU), runtime.database.table(STORES.PRODUCT_BATCHES)], () => reconcileActiveTableReservations({ db: runtime.database, STORES }));
    expect(await runtime.database.table(STORES.MENU).get('pizza')).toEqual(inventory);
    await salesCloudLocalRepository.markLocalSplitParentSettled({ parentOrderId: 'parent-3b', splitGroupId: 'remote-split' });
    await salesCloudLocalRepository.markLocalSplitParentSettled({ parentOrderId: 'parent-3b', splitGroupId: 'remote-split' });
    expect(await runtime.database.table(STORES.MENU).get('pizza')).toEqual(inventory);
    expect(await runtime.database.table(STORES.SALES).get('parent-3b')).toMatchObject({ status: 'cancelled', splitReservationReconcileStatus: 'not_owned', restaurantCloudHydrated: true });
  });

  it('QA-10 persists three payments and reconstructs only 33.34 cash plus 66.66 noncash after reload', async () => {
    await applySplitSalesFinancialResponseProjection(makeFixture({ payments: qa10Payments }));
    const sale = await runtime.database.table(STORES.SALES).get('local-sale-3b');
    // Assert the final consumer first: before the fix this is a fictitious $100 noncash row.
    runtime.database.close();
    await runtime.database.open();
    const projection = await loadCashSessionProjection(runtime.database, cashSession);
    expect(projection.movements.map(({ tipo, monto }) => ({ tipo, monto }))).toEqual([
      { tipo: 'venta', monto: '33.34' }, { tipo: 'venta_tarjeta', monto: '66.66' }
    ]);
    expect(sale.payments).toHaveLength(3);
    expect(sumAmounts(sale.payments)).toBe('100');
    expect(projection.sales.filter((row) => row.status === 'closed')).toHaveLength(1);
    expect(projection.reconciliation.directCashSales).toBe(33.34);
    expect(projection.reconciliation.theoreticalCash).toBe(83.34);
    expect(projection.movements[1].secondaryReference).toContain('Tarjeta $33.33 · Transferencia $33.33');
    const cached = await runtime.database.table(STORES.SYNC_CACHE).get('cloud_sale:cloud-sale-qa10');
    expect(cached.value.payments).toEqual(sale.payments);
    await runtime.database.table(STORES.MOVIMIENTOS_CAJA).put({
      id: 'official-qa10', sale_id: 'cloud-sale-qa10', tipo: 'venta_efectivo', monto: '33.34',
      cash_session_id: cashSession.id, fecha: '2026-10-02T12:00:00.000Z'
    });
    const withOfficial = await loadCashSessionProjection(runtime.database, cashSession);
    expect(withOfficial.movements.map(({ id, monto }) => ({ id, monto }))).toEqual([
      { id: 'official-qa10', monto: '33.34' }, { id: 'local-sale-3b:noncash', monto: '66.66' }
    ]);
    expect(sumAmounts(withOfficial.movements)).toBe('100');
    expect(withOfficial.reconciliation.theoreticalCash).toBe(83.34);
  });

  it.each([
    ['QA-11', '450', '150', '150', '150', 'equal_payment'],
    ['QA-12', '1000', '300', '350', '350', 'custom_payment'],
    ['QA-13', '300', '150', '150', '0', 'equal_payment']
  ])('%s keeps one commercial sale and the real applied amounts', async (_qa, total, cash, card, transfer, splitIntent) => {
    await applySplitSalesFinancialResponseProjection(makeFixture({ total, splitIntent, payments: [
      { method: 'cash', amount: cash }, { method: 'card', amount: card }, { method: 'transfer', amount: transfer }
    ] }));
    const projection = await loadCashSessionProjection(runtime.database, cashSession);
    const sale = projection.sales.find((row) => row.status === 'closed');
    expect(sale.items).toHaveLength(1);
    expect(sale.items[0].quantity).toBe(1);
    expect(sale.payments).toHaveLength(3);
    expect(sumAmounts(sale.payments)).toBe(total);
    expect(projection.movements.map((row) => row.monto)).toEqual([cash, Money.toExactString(Money.add(card, transfer))]);
    expect(projection.reconciliation.directCashSales).toBe(Number(cash));
    expect(projection.reconciliation.recognizedSales).toBe(Number(total));
    expect(projection.sales.filter((row) => row.status === 'closed')).toHaveLength(1);
  });

  it.each([
    ['QA-15', [{ method: 'card', amount: '150' }, { method: 'transfer', amount: '100' }, { method: 'credit', amount: '150' }], '0', '250'],
    ['QA-18', [{ method: 'card', amount: '150' }, { method: 'cash', amount: '100', received_amount: '120', change_amount: '20' }], '100', '150']
  ])('%s preserves paid components, debt, received cash and change without changing ledger', async (_qa, payments, cash, noncash) => {
    const ledger = [{ id: 'charge-3b', type: 'CHARGE', amount: '400' }, { id: 'payment-3b', type: 'PAYMENT', amount: '250' }];
    await runtime.database.table('customer_ledger').bulkPut(ledger);
    await applySplitSalesFinancialResponseProjection(makeFixture({ total: '400', method: 'mixed_credit', balance: '150', payments }));
    const sale = await runtime.database.table(STORES.SALES).get('local-sale-3b');
    expect(sale).toMatchObject({ total: '400', abono: '250', saldoPendiente: '150',
      creditLedgerChargeId: 'charge-3b', creditLedgerPaymentId: 'payment-3b' });
    const projection = await loadCashSessionProjection(runtime.database, cashSession);
    expect(projection.totals).toEqual({ ventasContado: '0', abonosFiado: cash });
    expect(projection.reconciliation.theoreticalCash).toBe(Money.toNumber(Money.add('50', cash)));
    expect(sumAmounts(projection.movements.filter((row) => row.tipo === 'venta_tarjeta'))).toBe(noncash);
    expect(Money.toExactString(Money.add(sumAmounts(projection.movements), sale.saldoPendiente))).toBe('400');
    const cashRow = sale.payments.find((row) => row.method === 'cash');
    if (cashRow) expect(cashRow).toMatchObject({ amount: '100', received_amount: '120', change_amount: '20' });
    expect(await runtime.database.table('customer_ledger').toArray()).toEqual(ledger);
  });

  it.each([
    [{ method: 'cash', amount: 0 }], [{ method: 'unknown', amount: 100 }],
    [{ method: 'cash', amount: -10 }], [{ method: 'cash', amount: 'invalid' }], [null]
  ])('retains an authoritative invalid/zero source through persistence: %o', async (payment) => {
    await applySplitSalesFinancialResponseProjection(makeFixture({ method: 'cash', payments: [payment] }));
    const sale = await runtime.database.table(STORES.SALES).get('local-sale-3b');
    expect(sale.payments).toHaveLength(1);
    expect(getExplicitSalePaymentRows(sale)).toEqual([]);
    const projection = await loadCashSessionProjection(runtime.database, cashSession);
    expect(projection.movements).toEqual([]);
    expect(projection.totals).toEqual({ ventasContado: '0', abonosFiado: '0' });
    expect(projection.reconciliation.theoreticalCash).toBe(50);
  });

  it.each(['cash', 'card', 'transfer', 'fiado'])('preserves legacy %s sales with no non-empty explicit source', async (method) => {
    const fixture = makeFixture({ method, payments: [], balance: method === 'fiado' ? '75' : '0' });
    await applySplitSalesFinancialResponseProjection(fixture);
    const projection = await loadCashSessionProjection(runtime.database, cashSession);
    expect(projection.movements).toHaveLength(1);
    expect(projection.movements[0]).toMatchObject({
      tipo: method === 'cash' ? 'venta' : method === 'fiado' ? 'abono' : 'venta_tarjeta',
      monto: method === 'fiado' ? '25' : '100'
    });
  });

  it('BY_ITEMS associates top-level payments only with their matching child sale', async () => {
    const fixture = makeFixture({ payments: qa10Payments, splitIntent: 'by_items' });
    const children = [
      ['A', '100', 'cash'], ['B', '300', 'card'], ['C', '150', 'transfer']
    ];
    fixture.requestPayload.children = children.map(([label]) => ({ label, sale: { id: `local-${label}` } }));
    fixture.responsePayload.children = children.map(([label, total, method]) => ({
      sale: { ...fixture.responsePayload.children[0].sale, id: `cloud-${label}`, local_sale_id: `local-${label}`, total, payment_method: method }
    }));
    fixture.responsePayload.payments = children.map(([label, amount, method]) => ({ sale_id: `cloud-${label}`, amount, method }));
    await applySplitSalesFinancialResponseProjection(fixture);
    for (const [label, amount, method] of children) {
      const sale = await runtime.database.table(STORES.SALES).get(`local-${label}`);
      expect(sale.payments).toEqual([{ sale_id: `cloud-${label}`, amount, method }]);
      const cache = await runtime.database.table(STORES.SYNC_CACHE).get(`cloud_sale:cloud-${label}`);
      expect(cache.value.payments).toEqual(sale.payments);
    }
    const projection = await loadCashSessionProjection(runtime.database, cashSession);
    expect(projection.movements.map((row) => row.monto)).toEqual(['100', '300', '150']);
    expect(projection.reconciliation.directCashSales).toBe(100);
  });

  it('scopes untagged child rows and rejects rows belonging to a different child', async () => {
    const fixture = makeFixture({ payments: qa10Payments });
    fixture.responsePayload.children[0].payments = [
      { method: 'cash', amount: '100' }, { sale_id: 'another-sale', method: 'card', amount: '900' }
    ];
    await applySplitSalesFinancialResponseProjection(fixture);
    const sale = await runtime.database.table(STORES.SALES).get('local-sale-3b');
    expect(sale.payments).toEqual([{ method: 'cash', amount: '100', sale_id: 'cloud-sale-qa10' }]);
    const cache = await runtime.database.table(STORES.SYNC_CACHE).get('cloud_sale:cloud-sale-qa10');
    expect(cache.value.payments).toEqual(sale.payments);
  });

  it('deduplicates official cash without hiding an equal noncash amount on the same sale', async () => {
    await applySplitSalesFinancialResponseProjection(makeFixture({ total: '300', payments: [
      { method: 'cash', amount: '150' }, { method: 'transfer', amount: '150' }
    ] }));
    await runtime.database.table(STORES.MOVIMIENTOS_CAJA).put({
      id: 'official-cash', sale_id: 'cloud-sale-qa10', tipo: 'venta_efectivo', monto: '150',
      cash_session_id: cashSession.id, fecha: '2026-10-02T12:00:00.000Z'
    });
    const projection = await loadCashSessionProjection(runtime.database, cashSession);
    expect(projection.movements).toHaveLength(2);
    expect(projection.movements[0].id).toBe('official-cash');
    expect(projection.movements[1]).toMatchObject({ tipo: 'venta_tarjeta', monto: '150' });
    expect(new Set(projection.movements.map((row) => row.id)).size).toBe(2);
    expect(projection.reconciliation.theoreticalCash).toBe(200);
  });

  it('QA-18 deduplicates the official initial Fiado cash movement by payment link and counts cash once', async () => {
    await applySplitSalesFinancialResponseProjection(makeFixture({ total: '400', method: 'mixed_credit', balance: '150', payments: [
      { method: 'card', amount: '150' },
      { method: 'cash', amount: '100', received_amount: '120', change_amount: '20', cash_movement_id: 'official-initial' }
    ] }));
    await runtime.database.table(STORES.MOVIMIENTOS_CAJA).put({
      id: 'official-initial', tipo: 'abono_cliente', origen: 'sale_credit_payment', monto: '100',
      reference_type: 'customer_ledger', reference_id: 'payment-3b',
      cash_session_id: cashSession.id, fecha: '2026-10-02T12:00:00.000Z'
    });
    const projection = await loadCashSessionProjection(runtime.database, cashSession);
    expect(projection.movements).toHaveLength(2);
    expect(projection.movements.map((row) => row.monto)).toEqual(['100', '150']);
    expect(projection.movements[0].id).toBe('official-initial');
    expect(projection.reconciliation.theoreticalCash).toBe(150);
  });

  it('reapplying the same response leaves one sale, one log and the same payments and movements', async () => {
    const fixture = makeFixture({ payments: qa10Payments });
    await applySplitSalesFinancialResponseProjection(fixture);
    const first = await loadCashSessionProjection(runtime.database, cashSession);
    await applySplitSalesFinancialResponseProjection(structuredClone(fixture));
    const second = await loadCashSessionProjection(runtime.database, cashSession);
    expect(second.movements.map(({ id, tipo, monto }) => ({ id, tipo, monto }))).toEqual(
      first.movements.map(({ id, tipo, monto }) => ({ id, tipo, monto }))
    );
    expect(second.sales.find((sale) => sale.status === 'closed').payments).toEqual(
      first.sales.find((sale) => sale.status === 'closed').payments
    );
    expect(second.reconciliation.theoreticalCash).toBe(83.34);
    expect(await runtime.database.table(STORES.TRANSACTION_LOG).count()).toBe(1);
    expect(await runtime.database.table(STORES.SALES).count()).toBe(2); // settled noncommercial parent + one sale
  });

  it('normal Cloud pull repairs an existing snapshot and keeps incomplete later payloads from erasing payments', async () => {
    const fixture = makeFixture({ payments: qa10Payments });
    const { sale, payments } = fixture.responsePayload.children[0];
    await runtime.database.table(STORES.SALES).put({ id: sale.local_sale_id, sourceMode: 'cloud_committed',
      status: 'closed', total: '100', paymentMethod: 'mixed', timestamp: sale.sold_at, items: [{ id: 'pizza' }] });
    const payload = { sales: [sale], items: [], payments };
    expect(await salesCloudLocalRepository.applyCloudSalesPayload(payload)).toEqual({ cached: 1, patchedLocal: 1 });
    const repaired = await runtime.database.table(STORES.SALES).get(sale.local_sale_id);
    expect(repaired.payments).toHaveLength(3);
    expect(repaired.items).toEqual([{ id: 'pizza' }]);
    await salesCloudLocalRepository.applyCloudSalesPayload({ sales: [sale] });
    expect((await runtime.database.table(STORES.SYNC_CACHE).get(`cloud_sale:${sale.id}`)).value.payments).toEqual(repaired.payments);
    await salesCloudLocalRepository.saveCloudCommittedSaleSnapshot({ localSale: { id: sale.local_sale_id }, response: { sale } });
    expect((await runtime.database.table(STORES.SALES).get(sale.local_sale_id)).payments).toEqual(repaired.payments);
    const projection = await loadCashSessionProjection(runtime.database, cashSession);
    expect(projection.movements.map((row) => row.monto)).toEqual(['33.34', '66.66']);
  });

  it('normalizes aliases, preserves safe financial links and discards card secrets and arbitrary metadata', async () => {
    const fixture = makeFixture({ method: 'cash', payments: [{
      payment_method: 'efectivo', total: '100.00', receivedAmount: '150.00', changeAmount: '50.00',
      reference: 'bank-ref', cashMovementId: 'movement-safe', customerLedgerId: 'ledger-safe',
      card_number: 'sensitive-fixture', cvv: 'sensitive-fixture',
      metadata: { splitPayerId: 'payer-safe', source: 'cloud', card_number: 'sensitive-fixture', nested: { secret: true } }
    }] });
    await applySplitSalesFinancialResponseProjection(fixture);
    const sale = await runtime.database.table(STORES.SALES).get('local-sale-3b');
    expect(sale.payments[0]).toEqual({ id: 'payment-0', sale_id: 'cloud-sale-qa10',
      method: 'cash', amount: '100', received_amount: '150', change_amount: '50', reference: 'bank-ref',
      cash_movement_id: 'movement-safe', customer_ledger_id: 'ledger-safe', metadata: { splitPayerId: 'payer-safe', source: 'cloud' } });
    const cache = await runtime.database.table(STORES.SYNC_CACHE).get('cloud_sale:cloud-sale-qa10');
    expect(cache.value.payments).toEqual(sale.payments);
  });

  it.each(['paymentMethod', 'payment_method'])('normalizes the %s alias in a single-sale snapshot and cache', async (methodKey) => {
    const fixture = makeFixture({ method: 'cash', payments: [{ [methodKey]: 'efectivo', total: '100', receivedAmount: '150', changeAmount: '50' }] });
    const { sale, payments } = fixture.responsePayload.children[0];
    const response = { sale, payments: payments.map(({ sale_id: _saleId, ...payment }) => payment) };
    await salesCloudLocalRepository.saveCloudCommittedSaleSnapshot({ localSale: { id: sale.local_sale_id }, response });
    await salesCloudLocalRepository.applyCloudSalesPayload(response);
    const stored = await runtime.database.table(STORES.SALES).get(sale.local_sale_id);
    const cached = await runtime.database.table(STORES.SYNC_CACHE).get(`cloud_sale:${sale.id}`);
    expect(stored.payments).toEqual(cached.value.payments);
    expect(stored.payments[0]).toMatchObject({ method: 'cash', amount: '100', received_amount: '150', change_amount: '50', sale_id: sale.id });
  });
});
