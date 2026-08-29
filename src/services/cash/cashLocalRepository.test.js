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
  it('allows the same Admin actor to open independent sessions on different stations', async () => {
    const stationA = await cashLocalRepository.openCashSession({
      actorKey: 'admin:shared',
      deviceRole: 'admin',
      cashStationId: 'local:device:station-a',
      deviceId: 'device-a',
      montoInicial: '100'
    });
    const stationB = await cashLocalRepository.openCashSession({
      actorKey: 'admin:shared',
      deviceRole: 'admin',
      cashStationId: 'local:device:station-b',
      deviceId: 'device-b',
      montoInicial: '200'
    });

    expect(stationA.id).not.toBe(stationB.id);
    expect(stationA).toMatchObject({ actorKey: 'admin:shared', cashStationId: 'local:device:station-a' });
    expect(stationB).toMatchObject({ actorKey: 'admin:shared', cashStationId: 'local:device:station-b' });
    await expect(cashLocalRepository.getCurrentCashSession({ actorKey: 'admin:shared', cashStationId: 'local:device:station-a' }))
      .resolves.toMatchObject({ id: stationA.id, cashStationId: stationA.cashStationId });
    await expect(cashLocalRepository.getCurrentCashSession({ actorKey: 'admin:shared', cashStationId: 'local:device:station-b' }))
      .resolves.toMatchObject({ id: stationB.id, cashStationId: stationB.cashStationId });
  });

  it('keeps one open session per station when two Admin actors race', async () => {
    const results = await Promise.allSettled([
      cashLocalRepository.openCashSession({ actorKey: 'admin:a', deviceRole: 'admin', cashStationId: stationId, montoInicial: '10' }),
      cashLocalRepository.openCashSession({ actorKey: 'admin:b', deviceRole: 'admin', cashStationId: stationId, montoInicial: '20' })
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')[0].reason.code).toBe('CASH_HANDOFF_REQUIRED');
    expect(await db.table(STORES.CAJAS).where('cashStationId').equals(stationId).toArray()).toHaveLength(1);
  });

  it('reads a canonical cloud projection through an existing legacy station alias', async () => {
    const projected = await cashLocalRepository.applyCloudCashSession({
      id: 'cash-canonical-a',
      status: 'open',
      actor_key: 'admin:shared',
      metadata: { cash_station_id: 'cash_station_device_station-a' }
    });

    expect(projected).toMatchObject({
      id: 'cash-canonical-a',
      cashStationId: 'cash_station_device_station-a',
      cashIdentityState: 'canonical'
    });
    await expect(cashLocalRepository.getCurrentCashSession({
      actorKey: 'admin:shared',
      cashStationId: 'local:device:station-a'
    })).resolves.toMatchObject({
      id: 'cash-canonical-a',
      cashStationId: 'cash_station_device_station-a'
    });

    const state = await cashLocalRepository.getFinancialState({
      actorKey: 'admin:shared',
      cashStationId: 'local:device:station-a',
      cloudEnabled: false
    });
    expect(state).toMatchObject({
      status: 'OWN_SESSION_OPEN',
      cashSession: { id: 'cash-canonical-a' }
    });
  });

  it('keeps Staff limited to one open session per actor across stations', async () => {
    await cashLocalRepository.openCashSession({
      actorKey: 'staff:shared',
      deviceRole: 'staff',
      cashStationId: 'local:device:station-a',
      montoInicial: '10'
    });

    await expect(cashLocalRepository.openCashSession({
      actorKey: 'staff:shared',
      deviceRole: 'staff',
      cashStationId: 'local:device:station-b',
      montoInicial: '20'
    })).rejects.toMatchObject({ code: 'CASH_SESSION_ALREADY_OPEN' });
  });

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
