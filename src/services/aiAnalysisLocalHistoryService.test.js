/* @vitest-environment jsdom */
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tenantState = vi.hoisted(() => ({
  ready: true,
  runtime: null,
  TenantRuntimeError: class MockTenantRuntimeError extends Error {
    constructor(code) {
      super(code);
      this.code = code;
    }
  }
}));

vi.mock('./db/tenantRuntimeRouter', () => ({
  getTenantRuntimeReadiness: () => ({
    ready: tenantState.ready,
    runtime: tenantState.ready ? tenantState.runtime : null
  }),
  getActiveTenantRuntime: () => (tenantState.ready ? tenantState.runtime : null),
  TenantRuntimeError: tenantState.TenantRuntimeError
}));

import {
  getLocalAIAnalysisHistory,
  getLocalAIAnalysisDetail,
  saveLocalAIAnalysis
} from './aiAnalysisLocalHistoryService';

const makeOpaqueId = (hex) => 't_' + hex.repeat(32).slice(0, 32);
const tenantDatabaseName = (opaqueId) => 'LanzoDB_t_' + opaqueId;
const historyDatabaseName = (opaqueId) => tenantDatabaseName(opaqueId) + '_ai_history';

const setTenant = (opaqueId, generation = 1) => {
  tenantState.ready = true;
  tenantState.runtime = {
    opaqueId,
    databaseName: tenantDatabaseName(opaqueId),
    generation
  };
};

const saveAnalysis = (label) => saveLocalAIAnalysis({
  agentType: 'sales',
  agentName: 'Tenant Agent',
  dateRange: '2026-08-25',
  dateRangeLabel: '25 ago 2026',
  resultContent: label,
  businessTypes: ['retail']
});

const deleteHistoryDatabases = async () => {
  for (const name of await Dexie.getDatabaseNames()) {
    if (name.endsWith('_ai_history')) await Dexie.delete(name);
  }
};

afterEach(async () => {
  tenantState.ready = false;
  tenantState.runtime = null;
  await deleteHistoryDatabases();
});

describe('AI analysis local history tenant isolation', () => {
  it('saves and reads history inside the active tenant companion database', async () => {
    const tenantA = makeOpaqueId('a');
    setTenant(tenantA);

    const saved = await saveAnalysis('tenant-a-analysis');
    const history = await getLocalAIAnalysisHistory();

    expect(saved.tenantOpaqueId).toBe(tenantA);
    expect(history).toHaveLength(1);
    expect(history[0].resultContent).toBe('tenant-a-analysis');
    expect(history[0].tenantOpaqueId).toBe(tenantA);
    expect(await Dexie.getDatabaseNames()).toContain(historyDatabaseName(tenantA));
    expect(await Dexie.getDatabaseNames()).not.toContain('LanzoDB1_ai_history');
  });

  it('keeps tenant A history absent from B and restores it on A re-entry', async () => {
    const tenantA = makeOpaqueId('a');
    const tenantB = makeOpaqueId('b');
    setTenant(tenantA, 1);
    const savedA = await saveAnalysis('only-a');

    setTenant(tenantB, 2);
    expect(await getLocalAIAnalysisHistory()).toEqual([]);
    expect(await getLocalAIAnalysisDetail(savedA.id)).toBeNull();

    await saveAnalysis('only-b');
    setTenant(tenantA, 3);
    const restoredA = await getLocalAIAnalysisHistory();

    expect(restoredA).toHaveLength(1);
    expect(restoredA[0].resultContent).toBe('only-a');
    expect(restoredA[0].tenantOpaqueId).toBe(tenantA);
  });

  it('keeps history shared for Admin and Staff sessions in one tenant', async () => {
    const tenantA = makeOpaqueId('a');
    setTenant(tenantA, 1);
    await saveAnalysis('shared-tenant-history');

    setTenant(tenantA, 2);
    expect((await getLocalAIAnalysisHistory())[0].resultContent).toBe('shared-tenant-history');
  });

  it('fails closed when tenant runtime is not ready', async () => {
    tenantState.ready = false;
    tenantState.runtime = null;

    await expect(getLocalAIAnalysisHistory()).rejects.toMatchObject({
      code: 'TENANT_RUNTIME_NOT_READY'
    });
  });

  it('does not surface, assign, or delete legacy global history', async () => {
    const legacy = new Dexie('LanzoDB1_ai_history');
    legacy.version(1).stores({ ai_analysis_history: 'id' });
    await legacy.open();
    await legacy.table('ai_analysis_history').put({
      id: 'legacy-row',
      resultContent: 'unresolved legacy row'
    });
    legacy.close();

    const tenantA = makeOpaqueId('a');
    setTenant(tenantA);
    expect(await getLocalAIAnalysisHistory()).toEqual([]);
    expect(await Dexie.getDatabaseNames()).toContain('LanzoDB1_ai_history');
  });

  it('rejects an A write that becomes stale while opening and never writes B', async () => {
    const tenantA = makeOpaqueId('a');
    const tenantB = makeOpaqueId('b');
    setTenant(tenantA, 1);

    let releaseOpen;
    const openBarrier = new Promise(resolve => { releaseOpen = resolve; });
    const openSpy = vi.spyOn(Dexie.prototype, 'open').mockImplementationOnce(async function () {
      await openBarrier;
      return this;
    });

    const pendingSave = saveAnalysis('stale-a-write');
    setTenant(tenantB, 2);
    releaseOpen();

    await expect(pendingSave).rejects.toMatchObject({
      code: 'TENANT_RUNTIME_STALE'
    });
    expect(await getLocalAIAnalysisHistory()).toEqual([]);
    openSpy.mockRestore();
  });
});
