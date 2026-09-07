import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, STORES } from '../db/dexie';
import { closeTestTenantRuntime, openTestTenantRuntime } from '../../test/tenantRuntimeTestHarness';
import { cashLocalRepository, getCashLocalProjectionDiagnostics } from './cashLocalRepository';

const stationKey = 'local:device:fp-browser-s';
const stationKeyA = 'local:device:fp-browser-a';
const stationKeyB = 'local:device:fp-browser-b';
const stationA = 'cash_station_device_550e8400-e29b-41d4-a716-446655440000';

beforeEach(async () => {
  await openTestTenantRuntime();
  await db.table(STORES.CAJAS).clear();
  await db.table(STORES.MOVIMIENTOS_CAJA).clear();
  await db.table(STORES.SALES).clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  closeTestTenantRuntime();
});

describe('cashLocalRepository shared-terminal financial ownership', () => {
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
});
