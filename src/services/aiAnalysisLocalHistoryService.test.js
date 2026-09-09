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
  archiveLocalAIAnalysis,
  deleteLocalAIAnalysis,
  getLocalAIAnalysisHistory,
  getLocalAIAnalysisDetail,
  saveLocalAIAnalysis,
  closeLocalAIAnalysisHistoryDatabasesForTests
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
  closeLocalAIAnalysisHistoryDatabasesForTests();
  localStorage.clear();
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

  it('persists raw content, parsed result, coverage, usage and provider metadata', async () => {
    const tenantA = makeOpaqueId('c');
    setTenant(tenantA);
    const rawResultContent = JSON.stringify({ report: 'contenido completo original', evidence: Array.from({ length: 4 }, (_, index) => index) });

    const saved = await saveLocalAIAnalysis({
      agentType: 'financialAnalyst',
      agentName: 'Analista',
      dateRange: 'last7days',
      resultContent: rawResultContent,
      rawResultContent,
      parsedResult: { formatVersion: '1.1', executiveSummary: 'Resumen' },
      resultFormat: 'structured_json',
      coverage: { complete: false, factsTotal: 10, factsIncluded: 8, factsOmitted: 2, notes: ['limitado'] },
      usage: { prompt_tokens: 1200, completion_tokens: 900, total_tokens: 2100, prompt_cache_hit_tokens: 100, reasoning_tokens: 0 },
      providerMetadata: { provider: 'openai-compatible', model: 'synthetic-model', finish_reason: 'stop', authorization: 'must-not-persist' },
      status: 'incomplete',
      errorMetadata: { code: 'AI_TRUNCATED', status: 200 },
      factSnapshot: { completeLocalFacts: [1, 2, 3] }
    });

    const detail = await getLocalAIAnalysisDetail(saved.id);
    expect(detail.rawResultContent).toBe(rawResultContent);
    expect(detail.resultContent).toBe(rawResultContent);
    expect(detail.parsedResult).toEqual({ formatVersion: '1.1', executiveSummary: 'Resumen' });
    expect(detail.coverage).toMatchObject({ complete: false, factsTotal: 10, factsIncluded: 8, factsOmitted: 2 });
    expect(detail.usage).toMatchObject({ promptTokens: 1200, completionTokens: 900, totalTokens: 2100, promptCacheHitTokens: 100, reasoningTokens: 0 });
    expect(detail.providerMetadata).toMatchObject({ provider: 'openai-compatible', model: 'synthetic-model', finish_reason: 'stop' });
    expect(detail.providerMetadata).not.toHaveProperty('authorization');
    expect(detail.status).toBe('incomplete');
    expect(detail.factSnapshot).toEqual({ completeLocalFacts: [1, 2, 3] });
  });

  it('preserves completed separately from incomplete, invalid and failed statuses', async () => {
    const tenantA = makeOpaqueId('f');
    setTenant(tenantA);

    const saved = await saveLocalAIAnalysis({
      agentType: 'financialAnalyst',
      agentName: 'Analista',
      dateRange: 'last7days',
      rawResultContent: 'reporte completo',
      status: 'completed'
    });

    const detail = await getLocalAIAnalysisDetail(saved.id);
    expect(detail.status).toBe('completed');
  });

  it('persists the complete agentToolRun locally without trimming metrics, evidence or errors', async () => {
    const tenantA = makeOpaqueId('e');
    setTenant(tenantA);
    const agentToolRun = {
      executedAt: '2026-08-31T12:00:00.000Z',
      availableToolCount: 3,
      results: [
        {
          id: 'tool.synthetic',
          title: 'Herramienta sintética',
          severity: 'warning',
          summary: 'Resultado local completo.',
          metrics: { total: 37, nested: { amount: 123.45 } },
          actions: ['Revisar el detalle local.'],
          evidence: ['Evidencia 1', 'Evidencia 2'],
          confidence: 0.72,
          errorMetadata: { code: 'TOOL_WARNING', message: 'Advertencia conservada', status: 422 }
        }
      ]
    };

    const saved = await saveLocalAIAnalysis({
      agentType: 'inventoryAuditor',
      agentName: 'Auditor',
      dateRange: 'last7days',
      rawResultContent: 'reporte completo',
      agentToolRun
    });

    const detail = await getLocalAIAnalysisDetail(saved.id);
    expect(detail.agentToolRun).toEqual(agentToolRun);
  });

  it('uses local recovery storage when IndexedDB save fails', async () => {
    const tenantA = makeOpaqueId('d');
    setTenant(tenantA);
    const openSpy = vi.spyOn(Dexie.prototype, 'open').mockRejectedValueOnce(new Error('synthetic IndexedDB failure'));

    const saved = await saveLocalAIAnalysis({
      agentType: 'inventoryAuditor',
      agentName: 'Auditor',
      dateRange: 'last7days',
      rawResultContent: 'reporte que no debe perderse',
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      status: 'failed',
      errorMetadata: { code: 'AI_EMPTY_RESPONSE' }
    });
    openSpy.mockRestore();

    expect(saved.persistence).toBe('fallback');
    const history = await getLocalAIAnalysisHistory();
    const detail = await getLocalAIAnalysisDetail(saved.id);
    expect(history[0].rawResultContent).toBe('reporte que no debe perderse');
    expect(detail.usage).toMatchObject({ promptTokens: 10, completionTokens: 20, totalTokens: 30 });
    expect(detail.status).toBe('failed');

    const archived = await archiveLocalAIAnalysis(saved.id);
    expect(archived.persistence).toBe('fallback');
    expect((await getLocalAIAnalysisDetail(saved.id)).status).toBe('archived');

    const deleted = await deleteLocalAIAnalysis(saved.id);
    expect(deleted).toMatchObject({ success: true });
    expect(await getLocalAIAnalysisDetail(saved.id)).toBeNull();
  });
});
