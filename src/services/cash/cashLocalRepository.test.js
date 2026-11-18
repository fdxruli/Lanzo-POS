import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, STORES } from '../db/dexie';
import {
  executeSaleTransactionSafe,
  loadData,
  loadMultipleData,
  queryBatchesByProductIdAndActive,
  queryByIndex,
  saveData
} from '../database';
import { roundCurrency } from '../utils';
import { calculatePricingDetails } from '../pricingLogic';
import { processSaleCore } from '../sales/processSaleCore';
import { closeTestTenantRuntime, openTestTenantRuntime } from '../../test/tenantRuntimeTestHarness';
import { actorRuntimeController } from '../auth/actorRuntimeController';
import { getActiveTenantRuntime } from '../db/tenantRuntimeRouter';
import { localTenantAccessController } from '../tenant/localTenantPolicy';
import { cashLocalRepository, getCashLocalProjectionDiagnostics } from './cashLocalRepository';
import { loadCashSessionProjection, resolveCashSessionAmounts } from '../cajaProjection';
import { cancelSaleCore } from '../sales/cancelSaleCore';
import { summarizeLocalDashboardFinance } from '../sales/dashboardFinancialSummary';
import { getSaleInitialFinancialAmounts, getSalePaymentStatusLabel } from '../reports/salesHistoryExport';

const stationKey = 'local:device:fp-browser-s';
const stationKeyA = 'local:device:fp-browser-a';
const stationKeyB = 'local:device:fp-browser-b';
const stationA = 'cash_station_device_550e8400-e29b-41d4-a716-446655440000';
const testTenantIdentity = {
  aliases: ['license-key-sha256:test-tenant-runtime-a'],
  primary: 'license-key-sha256:test-tenant-runtime-a',
  authority: 'license_key_sha256'
};
const saleProduct = {
  id: 'product-cash-integration',
  name: 'Producto de prueba',
  price: '20',
  cost: '0',
  stock: 100,
  trackStock: false,
  batchManagement: { enabled: false }
};

const grantCashActor = () => {
  localTenantAccessController.enable('cash_test_actor_grant');
  localTenantAccessController.grant(testTenantIdentity, 'cash_test_actor_grant');
  const tenantRuntime = getActiveTenantRuntime();
  if (!tenantRuntime) throw new Error('TEST_TENANT_RUNTIME_REQUIRED');
  actorRuntimeController.lock('cash_test_actor_reset');
  actorRuntimeController.beginAuthentication({ actorType: 'admin', deviceRef: stationKey });
  return actorRuntimeController.grant({
    actorType: 'admin',
    actorId: 'a',
    sessionId: 'admin-a-cash-test-session',
    permissions: ['*'],
    tenantOpaqueId: tenantRuntime.opaqueId,
    deviceRef: stationKey,
    authorizationExpiresAt: new Date(Date.now() + 60_000).toISOString()
  });
};

const getCurrentCashActorContext = (cashSession) => {
  const actorContext = actorRuntimeController.capture('pos');
  if (actorContext.actorKey !== cashSession.actorKey) {
    throw new Error('TEST_CASH_ACTOR_SESSION_MISMATCH');
  }
  return actorContext;
};

const processCashSale = ({
  id,
  cashSession,
  paymentMethod = 'efectivo',
  createdAt,
  saleTimestamp = new Date().toISOString(),
  total = 20,
  amountPaid = paymentMethod === 'efectivo' ? total : 0,
  saldoPendiente = total - amountPaid,
  customerId = null
}) => processSaleCore({
  order: [{ id: saleProduct.id, name: saleProduct.name, price: 20, quantity: total / 20 }],
  paymentData: {
    paymentMethod,
    amountPaid: String(amountPaid),
    saldoPendiente: String(saldoPendiente),
    customerId,
    cashSessionId: cashSession.id,
    localStationKey: cashSession.localStationKey,
    sendReceipt: false
  },
  total,
  allProducts: [saleProduct],
  features: { hasRecipes: false, hasKDS: false, hasLabFields: false, hasTables: false },
  companyName: 'Negocio de prueba',
  tempPrescriptionData: null,
  ignoreStock: false,
  activeOrderId: id,
  saleTimestamp,
  createdAt,
  actorContext: getCurrentCashActorContext(cashSession)
}, {
  loadData,
  loadMultipleData,
  saveData,
  STORES,
  queryBatchesByProductIdAndActive,
  queryByIndex,
  executeSaleTransactionSafe,
  useStatsStore: { getState: () => ({ updateStatsForNewSale: vi.fn(async () => {}) }) },
  roundCurrency,
  sendReceiptWhatsApp: vi.fn(async () => ({ status: 'not_requested' })),
  calculatePricingDetails,
  Logger: { time: vi.fn(), timeEnd: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() }
});

beforeEach(async () => {
  localTenantAccessController.reset();
  await openTestTenantRuntime();
  await db.table(STORES.CAJAS).clear();
  await db.table(STORES.MOVIMIENTOS_CAJA).clear();
  await db.table(STORES.SALES).clear();
  await db.table(STORES.LAYAWAYS).clear();
  await db.table(STORES.CUSTOMERS).clear();
  await db.table(STORES.CUSTOMER_LEDGER).clear();
});

afterEach(() => {
  actorRuntimeController.lock('cash_test_actor_cleanup');
  localTenantAccessController.reset();
  vi.restoreAllMocks();
  closeTestTenantRuntime();
});

describe('cashLocalRepository shared-terminal financial ownership', () => {
  it('reconciles $50 cash and $120 credit through sales, local report, cash close and a reopened session', async () => {
    await db.table(STORES.MENU).put(saleProduct);
    const actor = grantCashActor();
    await db.table(STORES.CUSTOMERS).put({
      id: 'customer-finance-qa', name: 'Cliente de conciliación', debt: '0', debtCents: 0
    });
    const cashSession = await cashLocalRepository.openCashSession({
      actorKey: actor.actorKey,
      actorGeneration: actor.generation,
      localStationKey: stationKey,
      montoInicial: '1000'
    });
    const confirmedAt = new Date(Date.parse(cashSession.fecha_apertura) + 1000).toISOString();
    const cashResult = await processCashSale({
      id: 'finance-cash-sale-50', cashSession, total: 50, amountPaid: 50,
      saldoPendiente: 0, paymentMethod: 'efectivo', saleTimestamp: confirmedAt
    });
    const creditResult = await processCashSale({
      id: 'finance-credit-sale-120', cashSession, total: 120, amountPaid: 0,
      saldoPendiente: 120, paymentMethod: 'fiado', customerId: 'customer-finance-qa',
      saleTimestamp: new Date(Date.parse(confirmedAt) + 1000).toISOString()
    });

    expect(cashResult).toMatchObject({ success: true, saleId: 'finance-cash-sale-50' });
    expect(creditResult).toMatchObject({ success: true, saleId: 'finance-credit-sale-120' });
    const persistedSales = await db.table(STORES.SALES).bulkGet([cashResult.saleId, creditResult.saleId]);
    const [cashSale, creditSale] = persistedSales;
    expect(cashSale).toMatchObject({ paymentStatus: 'paid', paymentMethod: 'efectivo', total: '50' });
    expect(creditSale).toMatchObject({
      paymentStatus: 'credit_pending', paymentMethod: 'fiado', total: '120',
      saldoPendiente: '120', payments: []
    });
    expect(getSalePaymentStatusLabel(cashSale)).toBe('Pagada');
    expect(getSaleInitialFinancialAmounts(cashSale)).toEqual({ paidInitially: 50, initialCredit: null });
    expect(getSalePaymentStatusLabel(creditSale)).toBe('Fiada');
    expect(getSaleInitialFinancialAmounts(creditSale)).toEqual({ paidInitially: 0, initialCredit: 120 });

    const cashProjection = await loadCashSessionProjection(db, cashSession);
    expect(cashProjection.reconciliation).toMatchObject({ directCashSales: 50, theoreticalCash: 1050 });
    expect(resolveCashSessionAmounts(cashSession, cashProjection.totals).totalTeorico).toBe('1050');
    expect(cashProjection.movements.filter((movement) => movement.tipo === 'venta'))
      .toEqual([expect.objectContaining({ saleId: cashResult.saleId, monto: '50' })]);

    const dashboardProjection = summarizeLocalDashboardFinance({
      sales: persistedSales,
      customerLedger: await db.table(STORES.CUSTOMER_LEDGER).toArray(),
      cancelledSales: [],
      cashReversalMovements: [],
      range: null
    });
    expect(dashboardProjection.totalSales).toBe(170);
    expect(dashboardProjection.collected).toMatchObject({ value: 50, status: 'complete' });
    expect(dashboardProjection.creditGenerated).toMatchObject({ value: 120, status: 'complete' });

    const closed = await cashLocalRepository.closeCashSession({
      cashSessionId: cashSession.id,
      countedAmount: '1050',
      nextShiftFund: '0',
      actorKey: actor.actorKey,
      localStationKey: stationKey
    });
    expect(closed.cashSession.detalle_cierre).toMatchObject({ ventas_contado: '50', total_teorico: '1050' });
    expect(closed.diferencia).toBe('0');

    const reopened = await cashLocalRepository.openCashSession({
      actorKey: actor.actorKey,
      actorGeneration: actor.generation,
      localStationKey: stationKey,
      montoInicial: '1000'
    });
    const reopenedProjection = await loadCashSessionProjection(db, reopened);
    expect(reopenedProjection.sales).toHaveLength(0);
    expect(reopenedProjection.reconciliation.theoreticalCash).toBe(1000);
    expect(new Set(persistedSales.map((sale) => sale.id)).size).toBe(2);
  });

  it('reconciles an actual $20 cash sale and $20 refund to the original $100 fund exactly once', async () => {
    const cashSession = await cashLocalRepository.openCashSession({
      actorKey: 'admin:refund',
      deviceRole: 'admin',
      localStationKey: stationKey,
      deviceFingerprint: 'fp-browser-s',
      montoInicial: '100'
    });
    const sale = {
      id: 'sale-refund-20',
      timestamp: new Date().toISOString(),
      cash_session_id: cashSession.id,
      status: 'closed',
      paymentMethod: 'efectivo',
      total: '20',
      items: [],
      payments: [{ method: 'cash', amount: '20' }]
    };
    await db.table(STORES.SALES).put(sale);

    const cancelled = await cancelSaleCore({
      saleId: sale.id,
      refunds: [{ method: 'cash', amount: '20' }],
      cashSession
    }, {
      db,
      STORES,
      generateId: () => 'cancel-log-1',
      assertActorCurrent: vi.fn(),
      restoreStockFromCancellation: vi.fn(),
      Logger: { error: vi.fn() }
    });

    expect(cancelled.success).toBe(true);
    const storedSession = await db.table(STORES.CAJAS).get(cashSession.id);
    const projection = await loadCashSessionProjection(db, storedSession);
    const amounts = resolveCashSessionAmounts(storedSession, projection.totals);

    expect(storedSession.salidas_efectivo).toBe('20');
    expect(projection.reconciliation).toMatchObject({ directCashSales: 20, exits: 20, theoreticalCash: 100 });
    expect(amounts.totalTeorico).toBe('100');
    expect(await db.table(STORES.MOVIMIENTOS_CAJA).count()).toBe(1);
  });

  it('rolls back the sale, customer ledger and cash movement together when a cancellation write fails', async () => {
    const cashSession = await cashLocalRepository.openCashSession({
      actorKey: 'admin:refund',
      deviceRole: 'admin',
      localStationKey: stationKey,
      deviceFingerprint: 'fp-browser-s',
      montoInicial: '100'
    });
    const sale = {
      id: 'sale-credit-refund',
      timestamp: new Date().toISOString(),
      cash_session_id: cashSession.id,
      status: 'closed',
      paymentMethod: 'fiado',
      customerId: 'customer-refund',
      total: '20',
      abono: '10',
      saldoPendiente: '10',
      items: [],
      payments: [{ method: 'cash', amount: '10' }],
      paymentCollections: [{ id: 'ledger-payment:sale-credit-refund', paymentId: 'ledger-payment', method: 'cash', amount: '10' }]
    };
    await db.table(STORES.SALES).put(sale);
    await db.table(STORES.CUSTOMERS).put({ id: 'customer-refund', debt: '10', debtCents: 1000 });
    vi.spyOn(db.table(STORES.CUSTOMERS), 'put').mockRejectedValueOnce(new Error('forced customer write failure'));

    const result = await cancelSaleCore({
      saleId: sale.id,
      refunds: [{ method: 'cash', amount: '20' }],
      cashSession
    }, {
      db,
      STORES,
      generateId: () => 'cancel-log-2',
      assertActorCurrent: vi.fn(),
      restoreStockFromCancellation: vi.fn(),
      Logger: { error: vi.fn() }
    });

    expect(result.success).toBe(false);
    expect((await db.table(STORES.SALES).get(sale.id)).status).toBe('closed');
    expect((await db.table(STORES.CAJAS).get(cashSession.id)).salidas_efectivo).toBe('0');
    expect(await db.table(STORES.MOVIMIENTOS_CAJA).count()).toBe(0);
    expect(await db.table(STORES.CUSTOMER_LEDGER).count()).toBe(0);
  });

  it('ignores null rows while retaining an invalid-row diagnostic', async () => {
    const sessionTable = db.table(STORES.CAJAS);
    vi.spyOn(sessionTable, 'toArray').mockResolvedValue([
      null,
      { id: 'cash-safe', estado: 'abierta', actorKey: 'admin:a', localStationKey: stationKey }
    ]);
    const movementTable = db.table(STORES.MOVIMIENTOS_CAJA);
    vi.spyOn(movementTable, 'toArray').mockResolvedValue([null, {
      id: 'movement-safe', cash_session_id: 'cash-safe', fecha: '2026-09-06T10:00:00.000Z'
    }]);

    await expect(cashLocalRepository.getCurrentCashSession({ actorKey: 'admin:a' }))
      .resolves.toMatchObject({ id: 'cash-safe' });
    await expect(cashLocalRepository.getMovementsForSession('cash-safe'))
      .resolves.toMatchObject([{ id: 'movement-safe' }]);

    expect(getCashLocalProjectionDiagnostics()).toMatchObject({
      invalidCashSessionRecords: 1,
      invalidCashMovementRecords: 1
    });
  });

  it('allows the same Admin actor to open independent sessions on different stations', async () => {
    const stationA = await cashLocalRepository.openCashSession({
      actorKey: 'admin:shared',
      deviceRole: 'admin',
      localStationKey: stationKeyA,
      deviceFingerprint: 'fp-browser-a',
      deviceId: 'device-a',
      montoInicial: '100'
    });
    const stationB = await cashLocalRepository.openCashSession({
      actorKey: 'admin:shared',
      deviceRole: 'admin',
      localStationKey: stationKeyB,
      deviceFingerprint: 'fp-browser-b',
      deviceId: 'device-b',
      montoInicial: '200'
    });

    expect(stationA.id).not.toBe(stationB.id);
    expect(stationA).toMatchObject({ actorKey: 'admin:shared', cashStationId: null, localStationKey: stationKeyA });
    expect(stationB).toMatchObject({ actorKey: 'admin:shared', cashStationId: null, localStationKey: stationKeyB });
    await expect(cashLocalRepository.getCurrentCashSession({ actorKey: 'admin:shared', localStationKey: stationKeyA }))
      .resolves.toMatchObject({ id: stationA.id, localStationKey: stationKeyA });
    await expect(cashLocalRepository.getCurrentCashSession({ actorKey: 'admin:shared', localStationKey: stationKeyB }))
      .resolves.toMatchObject({ id: stationB.id, localStationKey: stationKeyB });

    await expect(cashLocalRepository.getHistory({
      actorKey: 'admin:shared',
      localStationKey: stationKeyA
    })).resolves.toMatchObject([{ id: stationA.id }]);
    await expect(cashLocalRepository.getHistory({
      actorKey: 'admin:shared',
      localStationKey: stationKeyB
    })).resolves.toMatchObject([{ id: stationB.id }]);
  });

  it('keeps one open session per station when two Admin actors race', async () => {
    const results = await Promise.allSettled([
      cashLocalRepository.openCashSession({ actorKey: 'admin:a', deviceRole: 'admin', localStationKey: stationKey, montoInicial: '10' }),
      cashLocalRepository.openCashSession({ actorKey: 'admin:b', deviceRole: 'admin', localStationKey: stationKey, montoInicial: '20' })
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')[0].reason.code).toBe('CASH_HANDOFF_REQUIRED');
    expect((await db.table(STORES.CAJAS).toArray()).filter((row) => row.localStationKey === stationKey)).toHaveLength(1);
  });

  it('does not alias a canonical cloud projection to a local storage key', async () => {
    const projected = await cashLocalRepository.applyCloudCashSession({
      id: 'cash-canonical-a',
      status: 'open',
      actor_key: 'admin:shared',
      metadata: { cash_station_id: stationA }
    });

    expect(projected).toMatchObject({
      id: 'cash-canonical-a',
      cashStationId: stationA,
      cashIdentityState: 'canonical'
    });
    await expect(cashLocalRepository.getCurrentCashSession({
      actorKey: 'admin:shared',
      cashStationId: stationA
    })).resolves.toMatchObject({
      id: 'cash-canonical-a',
      cashStationId: stationA
    });

    await expect(cashLocalRepository.getCurrentCashSession({
      actorKey: 'admin:shared',
      localStationKey: stationKeyA
    })).resolves.toBeNull();

    const state = await cashLocalRepository.getFinancialState({
      actorKey: 'admin:shared',
      localStationKey: stationKeyA,
      cloudEnabled: false
    });
    expect(state).toMatchObject({ status: 'NO_SESSION', cashSession: null });
  });

  it('does not persist incomplete cloud session or movement projections', async () => {
    await expect(cashLocalRepository.applyCloudCashSession({
      id: 'incomplete-session',
      status: 'open',
      actor_key: 'admin:shared'
    })).resolves.toBeNull();

    await expect(cashLocalRepository.applyCloudCashMovement({
      id: 'incomplete-movement',
      cash_session_id: 'incomplete-session',
      type: 'cash_in',
      amount: '10',
      actor_key: 'admin:shared'
    })).resolves.toBeNull();

    expect(await db.table(STORES.CAJAS).get('incomplete-session')).toBeUndefined();
    expect(await db.table(STORES.MOVIMIENTOS_CAJA).get('incomplete-movement')).toBeUndefined();
  });

  it('keeps Staff limited to one open session per actor across stations', async () => {
    await cashLocalRepository.openCashSession({
      actorKey: 'staff:shared',
      deviceRole: 'staff',
      localStationKey: stationKeyA,
      montoInicial: '10'
    });

    await expect(cashLocalRepository.openCashSession({
      actorKey: 'staff:shared',
      deviceRole: 'staff',
      localStationKey: stationKeyB,
      montoInicial: '20'
    })).rejects.toMatchObject({ code: 'CASH_SESSION_ALREADY_OPEN' });
  });

  it('keeps the previous owner, blocks takeover, and permits a new session only after explicit close', async () => {
    const first = await cashLocalRepository.openCashSession({
      actorKey: 'admin:a',
      localStationKey: stationKey,
      deviceId: 'device-a',
      montoInicial: '100'
    });

    await expect(cashLocalRepository.getFinancialState({
      actorKey: 'staff:b',
      localStationKey: stationKey,
      cloudEnabled: false
    })).resolves.toMatchObject({
      status: 'HANDOFF_REQUIRED',
      code: 'CASH_HANDOFF_REQUIRED',
      cashSession: null,
      stationOpenCashSession: { id: first.id, actorKey: 'admin:a' }
    });

    await expect(cashLocalRepository.openCashSession({
      actorKey: 'staff:b',
      localStationKey: stationKey,
      deviceId: 'device-a',
      montoInicial: '50'
    })).rejects.toMatchObject({ code: 'CASH_HANDOFF_REQUIRED' });

    const closed = await cashLocalRepository.closeCashSession({
      cashSessionId: first.id,
      countedAmount: '100',
      nextShiftFund: '0',
      actorKey: 'admin:a',
      localStationKey: stationKey
    });
    expect(closed.cashSession).toMatchObject({
      id: first.id,
      estado: 'cerrada',
      actorKey: 'admin:a',
      closedByActorKey: 'admin:a'
    });

    const second = await cashLocalRepository.openCashSession({
      actorKey: 'staff:b',
      localStationKey: stationKey,
      deviceId: 'device-a',
      montoInicial: '50'
    });
    expect(second.id).not.toBe(first.id);
    expect(second).toMatchObject({ actorKey: 'staff:b', cashStationId: null, localStationKey: stationKey });
    expect(await db.table(STORES.CAJAS).toArray()).toHaveLength(2);
  });

  it('does not create two local open sessions for the same station under concurrent opens', async () => {
    const results = await Promise.allSettled([
      cashLocalRepository.openCashSession({ actorKey: 'staff:x', localStationKey: stationKey, montoInicial: '10' }),
      cashLocalRepository.openCashSession({ actorKey: 'staff:y', localStationKey: stationKey, montoInicial: '20' })
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')[0].reason.code).toBe('CASH_HANDOFF_REQUIRED');
    expect((await db.table(STORES.CAJAS).toArray()).filter((row) => row.localStationKey === stationKey)).toHaveLength(1);
  });

  it('does not auto-close on retry and returns the same closed result for the owner', async () => {
    const session = await cashLocalRepository.openCashSession({
      actorKey: 'admin:a',
      localStationKey: stationKey,
      montoInicial: '100'
    });
    const firstClose = await cashLocalRepository.closeCashSession({
      cashSessionId: session.id,
      countedAmount: '100',
      nextShiftFund: '0',
      actorKey: 'admin:a',
      localStationKey: stationKey
    });
    const retryClose = await cashLocalRepository.closeCashSession({
      cashSessionId: session.id,
      countedAmount: '100',
      nextShiftFund: '0',
      actorKey: 'admin:a',
      localStationKey: stationKey
    });

    expect(firstClose.cashSession.closedByActorKey).toBe('admin:a');
    expect(retryClose).toMatchObject({ success: true, alreadyClosed: true, cashSession: { id: session.id, estado: 'cerrada' } });
  });

  it('closes Free cash with the same reconciliation as the live projection', async () => {
    const session = await cashLocalRepository.openCashSession({
      actorKey: 'admin:a',
      localStationKey: stationKey,
      montoInicial: '100'
    });
    const occurredAt = session.fecha_apertura;

    await db.table(STORES.SALES).bulkAdd([
      {
        id: 'cash-sale', cash_session_id: session.id, timestamp: occurredAt,
        status: 'closed', paymentMethod: 'cash', total: '20'
      },
      {
        id: 'credit-sale', cash_session_id: session.id, timestamp: occurredAt,
        status: 'closed', paymentMethod: 'fiado', total: '20', abono: '0'
      },
      {
        id: 'card-sale', cash_session_id: session.id, timestamp: occurredAt,
        status: 'closed', paymentMethod: 'card', total: '30'
      }
    ]);
    await db.table(STORES.MOVIMIENTOS_CAJA).bulkAdd([
      {
        id: 'cash-customer-payment', cash_session_id: session.id, tipo: 'abono_cliente',
        monto: '10', source: 'customer_payment', fecha: occurredAt
      },
      {
        id: 'cash-expense', cash_session_id: session.id, tipo: 'salida',
        monto: '15', source: 'manual', fecha: occurredAt
      },
      {
        id: 'cash-sale-refund', cash_session_id: session.id, tipo: 'salida',
        monto: '20', source: 'sale_cancellation', referenceType: 'sale',
        referenceId: 'cash-sale', fecha: occurredAt
      }
    ]);
    await db.table(STORES.CAJAS).update(session.id, {
      entradas_efectivo: '10',
      salidas_efectivo: '35'
    });

    const closed = await cashLocalRepository.closeCashSession({
      cashSessionId: session.id,
      countedAmount: '94.50',
      nextShiftFund: '0',
      actorKey: 'admin:a',
      localStationKey: stationKey
    });

    expect(closed.cashSession.detalle_cierre).toMatchObject({
      ventas_contado: '20',
      abonos_fiado: '0',
      total_teorico: '95'
    });
    expect(closed.diferencia).toBe('-0.5');
  });

  it('counts linked cash sales by their checkout instant while preserving older draft creation times', async () => {
    await db.table(STORES.MENU).put(saleProduct);
    const actor = grantCashActor();
    const orderCreatedBeforeOpen = new Date(Date.now() - 60_000).toISOString();
    await db.table(STORES.SALES).put({
      id: 'order-created-before-cash-open',
      timestamp: orderCreatedBeforeOpen,
      createdAt: orderCreatedBeforeOpen,
      status: 'open',
      paymentMethod: null,
      total: '20',
      items: [{ id: saleProduct.id, name: saleProduct.name, price: 20, quantity: 1 }]
    });
    const cashSession = await cashLocalRepository.openCashSession({
      actorKey: actor.actorKey,
      actorGeneration: actor.generation,
      localStationKey: stationKey,
      montoInicial: '100'
    });
    const firstCheckoutAt = new Date(Date.parse(cashSession.fecha_apertura) + 1000).toISOString();
    const orderCreatedAfterOpen = new Date().toISOString();
    await db.table(STORES.SALES).put({
      id: 'order-created-after-cash-open',
      timestamp: orderCreatedAfterOpen,
      createdAt: orderCreatedAfterOpen,
      status: 'open',
      paymentMethod: null,
      total: '20',
      items: [{ id: saleProduct.id, name: saleProduct.name, price: 20, quantity: 1 }]
    });

    const secondCheckoutAt = new Date(Date.parse(cashSession.fecha_apertura) + 2000).toISOString();
    const firstSale = await processCashSale({
      id: 'order-created-before-cash-open',
      cashSession,
      createdAt: orderCreatedBeforeOpen,
      saleTimestamp: firstCheckoutAt
    });
    const secondSale = await processCashSale({
      id: 'order-created-after-cash-open',
      cashSession,
      createdAt: orderCreatedAfterOpen,
      saleTimestamp: secondCheckoutAt
    });

    expect(firstSale.success).toBe(true);
    expect(secondSale.success).toBe(true);
    const storedSales = await db.table(STORES.SALES).bulkGet([firstSale.saleId, secondSale.saleId]);
    expect(storedSales).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: firstSale.saleId, cash_session_id: cashSession.id, timestamp: firstCheckoutAt }),
      expect.objectContaining({ id: secondSale.saleId, cash_session_id: cashSession.id, timestamp: secondCheckoutAt })
    ]));

    const projection = await loadCashSessionProjection(db, cashSession);
    const saleMovements = projection.movements.filter((movement) => movement.tipo === 'venta');
    expect(saleMovements.map((movement) => movement.saleId).sort()).toEqual([
      firstSale.saleId,
      secondSale.saleId
    ].sort());
    expect(projection.reconciliation).toMatchObject({
      directCashSales: 40,
      recognizedSales: 40,
      theoreticalCash: 140
    });
    expect(resolveCashSessionAmounts(cashSession, projection.totals).totalTeorico).toBe('140');

    const closed = await cashLocalRepository.closeCashSession({
      cashSessionId: cashSession.id,
      countedAmount: '140',
      nextShiftFund: '0',
      actorKey: 'admin:a',
      localStationKey: stationKey
    });
    expect(closed.cashSession.detalle_cierre).toMatchObject({
      ventas_contado: '40',
      total_teorico: '140'
    });
    expect(closed.diferencia).toBe('0');
  });

  it('does not carry a previous session sale into the next session or change its closed totals', async () => {
    await db.table(STORES.MENU).put(saleProduct);
    const actor = grantCashActor();
    const previousSession = await cashLocalRepository.openCashSession({
      actorKey: actor.actorKey,
      actorGeneration: actor.generation,
      localStationKey: stationKey,
      montoInicial: '100'
    });
    const orderCreatedAt = new Date().toISOString();
    await db.table(STORES.SALES).put({
      id: 'order-previous-session', timestamp: orderCreatedAt, createdAt: orderCreatedAt,
      status: 'open', paymentMethod: null, total: '20',
      items: [{ id: saleProduct.id, name: saleProduct.name, price: 20, quantity: 1 }]
    });
    const previousSale = await processCashSale({
      id: 'order-previous-session', cashSession: previousSession, createdAt: orderCreatedAt,
      saleTimestamp: new Date(Date.parse(previousSession.fecha_apertura) + 1000).toISOString()
    });
    expect(previousSale.success).toBe(true);

    const previousClose = await cashLocalRepository.closeCashSession({
      cashSessionId: previousSession.id,
      countedAmount: '120',
      nextShiftFund: '0',
      actorKey: actor.actorKey,
      localStationKey: stationKey
    });
    const nextSession = await cashLocalRepository.openCashSession({
      actorKey: actor.actorKey,
      actorGeneration: actor.generation,
      localStationKey: stationKey,
      montoInicial: '100'
    });
    const nextProjection = await loadCashSessionProjection(db, nextSession);

    expect(nextProjection.sales).toHaveLength(0);
    expect(nextProjection.reconciliation.theoreticalCash).toBe(100);
    expect(resolveCashSessionAmounts(nextSession, nextProjection.totals).totalTeorico).toBe('100');
    expect((await db.table(STORES.CAJAS).get(previousSession.id)).detalle_cierre).toEqual(previousClose.cashSession.detalle_cierre);
    expect((await db.table(STORES.CAJAS).get(previousSession.id)).detalle_cierre.total_teorico).toBe('120');
  });

  it('counts a mixed credit down payment and linked layaway cash once at close', async () => {
    const session = await cashLocalRepository.openCashSession({
      actorKey: 'admin:a',
      localStationKey: stationKey,
      montoInicial: '100'
    });
    const occurredAt = session.fecha_apertura;

    await db.table(STORES.SALES).add({
      id: 'mixed-credit-sale', cash_session_id: session.id, timestamp: occurredAt,
      status: 'closed', paymentMethod: 'mixed_credit', total: '200',
      payments: [
        { method: 'cash', amount: '40', cash_movement_id: 'initial-credit-cash' },
        { method: 'transfer', amount: '60' }
      ]
    });
    await db.table(STORES.LAYAWAYS).add({
      id: 'layaway-1', status: 'ready', totalAmount: '25',
      payments: [{
        id: 'layaway-payment-1', amount: '25', status: 'confirmed',
        cashMovementId: 'layaway-cash', cajaId: session.id, date: occurredAt
      }]
    });
    await db.table(STORES.MOVIMIENTOS_CAJA).bulkAdd([
      {
        id: 'initial-credit-cash', cash_session_id: session.id, tipo: 'abono_cliente',
        monto: '40', source: 'sale_credit_payment', fecha: occurredAt
      },
      {
        id: 'layaway-cash', cash_session_id: session.id, tipo: 'entrada', monto: '25',
        source: 'layaway_payment', referenceType: 'layaway', referenceId: 'layaway-1',
        layawayId: 'layaway-1', paymentId: 'layaway-payment-1', fecha: occurredAt
      }
    ]);
    await db.table(STORES.CAJAS).update(session.id, { entradas_efectivo: '65' });

    const closed = await cashLocalRepository.closeCashSession({
      cashSessionId: session.id,
      countedAmount: '165',
      nextShiftFund: '0',
      actorKey: 'admin:a',
      localStationKey: stationKey
    });

    expect(closed.cashSession.detalle_cierre).toMatchObject({
      abonos_fiado: '40',
      total_teorico: '165'
    });
    expect(closed.diferencia).toBe('0');
  });
});
