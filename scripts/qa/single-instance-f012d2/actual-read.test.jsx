// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { db, STORES } from '../../../src/services/db/dexie';
import { openTestTenantRuntime, closeTestTenantRuntime } from '../../../src/test/tenantRuntimeTestHarness';
import * as supabase from '../../../src/services/supabase';
vi.mock('../../../src/store/useAppStore', () => {
  const state = { appStatus: 'ready', currentAdminUser: { id: 'synthetic' }, currentDeviceRole: 'admin', licenseDetails: null };
  const store = selector => selector(state); store.getState = () => state; return { useAppStore: store };
});
import { cashRepository } from '../../../src/services/cash/cashRepository';
import { useCaja } from '../../../src/hooks/useCaja';
import { applySaleCancellationFinancialProjection } from '../../../src/services/financial/financialCancellationProjection';
import { publishCancellationCashUpdate } from '../../../src/services/financial/cancellationCashRefreshRoute';
import { createSyncExecutionScope } from '../../../src/services/sync/syncExecutionScope';
let scopes = [];
afterEach(async () => { cleanup(); for (const s of scopes) { s.quiesce(); await s.settleObserved(); } scopes = []; vi.restoreAllMocks(); await closeTestTenantRuntime(); });

it('actual Local cash repository/projection/Dexie: next initial load reads the cancellation whose refresh was discarded', async () => {
  await openTestTenantRuntime();
  vi.spyOn(supabase, 'getStableDeviceId').mockResolvedValue('synthetic-device');
  const opened = new Date(Date.now() - 60000).toISOString();
  await db.table(STORES.CAJAS).put({ id: 'synthetic-cash', estado: 'abierta', actorKey: 'admin:synthetic',
    localStationKey: 'local:device:synthetic-device', fecha_apertura: opened, monto_inicial: '100' });
  await db.table(STORES.SALES).put({ id: 'synthetic-sale', status: 'closed', cash_session_id: 'synthetic-cash',
    timestamp: new Date().toISOString(), paymentMethod: 'efectivo', total: 10, items: [] });
  const read = vi.spyOn(cashRepository, 'getCurrentCashSession');
  const scheduled = [], a = createSyncExecutionScope({ timerApi: { setTimeout: fn => { scheduled.push(fn); return scheduled.length; }, clearTimeout() {} } });
  scopes.push(a);
  const hook = renderHook(({ executionScope }) => useCaja({ executionScope }), { initialProps: { executionScope: a } });
  await waitFor(() => expect(Number(hook.result.current.totalesTurno.ventasContado)).toBe(10));
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => {
    await a.run('real-projection', () => applySaleCancellationFinancialProjection({
      responsePayload: { sale: { id: 'synthetic-sale', status: 'cancelled' } }, actorHandle: { assertCurrent() {} }, executionScope: a
    }));
  });
  expect(scheduled).toHaveLength(1); a.quiesce(); await a.drain();
  await act(async () => { scheduled[0](); }); expect(read).toHaveBeenCalledTimes(1);
  const nextScheduled = [];
  const b = createSyncExecutionScope({ timerApi: { setTimeout: fn => { nextScheduled.push(fn); return nextScheduled.length; }, clearTimeout() {} } });
  scopes.push(b); hook.rerender({ executionScope: b });
  await waitFor(() => expect(Number(hook.result.current.totalesTurno.ventasContado)).toBe(0));
  expect(hook.result.current.cajaActual.id).toBe('synthetic-cash'); expect(read).toHaveBeenCalledTimes(2);
  act(() => publishCancellationCashUpdate(a));
  expect(nextScheduled).toHaveLength(0);
  expect(read).toHaveBeenCalledTimes(2);
  expect(await db.table(STORES.TRANSACTION_LOG).count()).toBe(1);
});
