import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, STORES } from '../db/dexie';
import { closeTestTenantRuntime, openTestTenantRuntime } from '../../test/tenantRuntimeTestHarness';
import { cashLocalRepository } from './cashLocalRepository';

const stationId = 'local:device:station-s';

beforeEach(async () => {
  await openTestTenantRuntime();
  await db.table(STORES.CAJAS).clear();
  await db.table(STORES.MOVIMIENTOS_CAJA).clear();
  await db.table(STORES.SALES).clear();
});

afterEach(() => closeTestTenantRuntime());

describe('cashLocalRepository shared-terminal financial ownership', () => {
  it('keeps the previous owner, blocks takeover, and permits a new session only after explicit close', async () => {
    const first = await cashLocalRepository.openCashSession({
      actorKey: 'admin:a',
      cashStationId: stationId,
      deviceId: 'device-a',
      montoInicial: '100'
    });

    await expect(cashLocalRepository.getFinancialState({
      actorKey: 'staff:b',
      cashStationId: stationId,
      cloudEnabled: false
    })).resolves.toMatchObject({
      status: 'HANDOFF_REQUIRED',
      code: 'CASH_HANDOFF_REQUIRED',
      cashSession: null,
      stationOpenCashSession: { id: first.id, actorKey: 'admin:a' }
    });

    await expect(cashLocalRepository.openCashSession({
      actorKey: 'staff:b',
      cashStationId: stationId,
      deviceId: 'device-a',
      montoInicial: '50'
    })).rejects.toMatchObject({ code: 'CASH_HANDOFF_REQUIRED' });

    const closed = await cashLocalRepository.closeCashSession({
      cashSessionId: first.id,
      countedAmount: '100',
      nextShiftFund: '0',
      actorKey: 'admin:a',
      cashStationId: stationId
    });
    expect(closed.cashSession).toMatchObject({
      id: first.id,
      estado: 'cerrada',
      actorKey: 'admin:a',
      closedByActorKey: 'admin:a'
    });

    const second = await cashLocalRepository.openCashSession({
      actorKey: 'staff:b',
      cashStationId: stationId,
      deviceId: 'device-a',
      montoInicial: '50'
    });
    expect(second.id).not.toBe(first.id);
    expect(second).toMatchObject({ actorKey: 'staff:b', cashStationId: stationId });
    expect(await db.table(STORES.CAJAS).toArray()).toHaveLength(2);
  });

  it('does not create two local open sessions for the same station under concurrent opens', async () => {
    const results = await Promise.allSettled([
      cashLocalRepository.openCashSession({ actorKey: 'staff:x', cashStationId: stationId, montoInicial: '10' }),
      cashLocalRepository.openCashSession({ actorKey: 'staff:y', cashStationId: stationId, montoInicial: '20' })
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')[0].reason.code).toBe('CASH_HANDOFF_REQUIRED');
    expect(await db.table(STORES.CAJAS).where('cashStationId').equals(stationId).toArray()).toHaveLength(1);
  });

  it('does not auto-close on retry and returns the same closed result for the owner', async () => {
    const session = await cashLocalRepository.openCashSession({
      actorKey: 'admin:a',
      cashStationId: stationId,
      montoInicial: '100'
    });
    const firstClose = await cashLocalRepository.closeCashSession({
      cashSessionId: session.id,
      countedAmount: '100',
      nextShiftFund: '0',
      actorKey: 'admin:a',
      cashStationId: stationId
    });
    const retryClose = await cashLocalRepository.closeCashSession({
      cashSessionId: session.id,
      countedAmount: '100',
      nextShiftFund: '0',
      actorKey: 'admin:a',
      cashStationId: stationId
    });

    expect(firstClose.cashSession.closedByActorKey).toBe('admin:a');
    expect(retryClose).toMatchObject({ success: true, alreadyClosed: true, cashSession: { id: session.id, estado: 'cerrada' } });
  });
});
