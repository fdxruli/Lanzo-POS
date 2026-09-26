import { describe, expect, it, vi } from 'vitest';
import {
  buildSalesProfitabilityHistoryDownloadPayload,
  buildSalesProfitabilityHistoryEntry,
  buildSalesProfitabilityHistoryScopeKey,
  classifySalesProfitabilityExecution,
  clearSalesProfitabilityHistory,
  deleteSalesProfitabilityHistoryEntry,
  downloadSalesProfitabilityHistoryEntry,
  loadSalesProfitabilityHistory,
  saveSalesProfitabilityHistoryEntry,
  SALES_PROFITABILITY_HISTORY_MAX_ENTRIES,
  SALES_PROFITABILITY_HISTORY_RETENTION_MS,
  SALES_PROFITABILITY_HISTORY_STORAGE_KEY
} from '../salesProfitabilityHistory';

const queriedAt = '2026-09-25T16:20:00.000Z';

const requestContext = {
  question: '¿Qué pasa si aumento el precio?',
  resolvedIntent: 'price_simulation',
  compare: false,
  period: {
    from: '2026-09-01',
    to: '2026-09-30',
    previousFrom: null,
    previousTo: null,
    timezone: 'America/Mexico_City'
  },
  scenario: {
    productName: 'Producto A',
    newPrice: 120,
    promotionalPrice: null,
    discountPercent: null,
    historicalVolume: 20,
    expectedVolume: null
  }
};

const response = {
  status: 'completed',
  executiveSummary: 'El producto conserva utilidad en el escenario.',
  answer: 'El producto conserva utilidad en el escenario.',
  explanation: 'La utilidad se calcula con los datos del periodo consultado.',
  confidence: 'medium',
  source: 'cloud',
  intent: 'price_simulation',
  coverage: { validSales: 3, costCoverage: 1, itemsComplete: true },
  profitability: { status: 'profitable', netSales: 300, profit: 120, margin: 0.4 },
  current: { products: [{ name: 'Producto A', netSales: 300, cost: 180, costKnown: true }] },
  priceSimulation: { product: 'Producto A', currentPrice: 100, newPrice: 120, simulatedProfit: 120 },
  calculations: [{ label: 'Utilidad', value: 120, formula: 'ventas netas - costo de venta' }],
  scenarios: [],
  recommendations: [{ title: 'Revisar precio', explanation: 'Valida el cambio.', expectedImpact: 'Mayor utilidad', priority: 'medium' }],
  assumptions: [],
  limitations: [],
  aiNarrative: {
    executiveSummary: 'La IA recomienda revisar el escenario.',
    explanation: 'La narrativa se conserva aparte de los cálculos.',
    recommendations: [{ title: 'Prueba controlada', explanation: 'Valida la reacción.', expectedImpact: 'Medir ventas', priority: 'medium' }]
  }
};

const result = (overrides = {}) => ({
  response,
  providerCalled: true,
  quotaOutcome: 'consumed',
  usageStatus: { used: 4, limit: 15, remaining: 11 },
  ...overrides
});

const buildEntry = (overrides = {}, time = queriedAt) => buildSalesProfitabilityHistoryEntry({
  result: result(overrides),
  requestContext,
  queriedAt: time
});

const memoryStorage = ({ initial = null, failWrites = false } = {}) => {
  let raw = initial;
  return {
    isReady: () => true,
    getItem: vi.fn(() => raw),
    setItem: vi.fn((_key, value) => {
      if (failWrites) throw new Error('quota exceeded');
      raw = value;
    }),
    removeItem: vi.fn(() => { raw = null; }),
    readRaw: () => raw
  };
};

describe('sales profitability local history', () => {
  it('stores a deterministic result as automatic and says no usage only with explicit no-charge evidence', () => {
    const entry = buildEntry({
      response: { ...response, aiNarrative: null },
      providerCalled: false,
      quotaOutcome: 'not_consumed',
      usageStatus: null
    });

    expect(entry.execution.mode).toBe('automatic');
    expect(entry.quota).toEqual({ status: 'no', reason: 'no_provider_path' });
    expect(entry.report.usage).toEqual({ available: false });
    expect(entry.report.deterministic.profitability.profit).toBe(120);
    expect(entry.report.ai.status).toBe('not_generated');
  });

  it('preserves the submitted question text in the local snapshot', () => {
    const question = '  ¿Qué pasa si aumento el precio?  ';
    const entry = buildSalesProfitabilityHistoryEntry({
      result: result(),
      requestContext: { ...requestContext, question },
      queriedAt
    });
    expect(entry.report.request.question).toBe(question);
  });

  it('labels Caché only with an explicit cache-hit signal', () => {
    const fastAutomaticResult = {
      response: { ...response, aiNarrative: null },
      providerCalled: false,
      quotaOutcome: 'not_consumed',
      elapsedMs: 2
    };
    expect(classifySalesProfitabilityExecution(fastAutomaticResult)).toMatchObject({
      mode: 'automatic',
      usageStatus: 'no'
    });

    expect(classifySalesProfitabilityExecution({
      ...fastAutomaticResult,
      cacheHit: true
    })).toEqual({ mode: 'cache', usageStatus: 'no', usageReason: 'explicit_cache_hit' });

    const cached = buildEntry({
      providerCalled: false,
      quotaOutcome: 'not_consumed',
      usageStatus: null,
      cacheHit: true
    });
    expect(cached.execution.mode).toBe('cache');
    expect(cached.report.ai.executiveSummary).toBe(response.aiNarrative.executiveSummary);
  });

  it('records a successful provider-backed response once and says usage only with the explicit completion outcome', () => {
    const entry = buildEntry();
    expect(entry.execution.mode).toBe('ai');
    expect(entry.quota).toEqual({ status: 'yes', reason: 'edge_generation_completed' });
    expect(entry.report.usage).toMatchObject({ available: true, used: 4, limit: 15, remaining: 11 });

    const unknown = buildEntry({ quotaOutcome: 'not_confirmed' });
    expect(unknown.quota.status).toBe('unknown');

    const failedNarrative = buildEntry({
      response: {
        ...response,
        aiNarrative: {
          status: 'unavailable',
          diagnosticCode: 'AI_NARRATIVE_INVALID_JSON',
          explanation: 'La narrativa opcional de IA no está disponible.'
        }
      },
      quotaOutcome: 'not_confirmed',
      usageStatus: null
    });
    expect(failedNarrative.execution.mode).toBe('ai_unavailable');
    expect(failedNarrative.quota.status).toBe('unknown');
    expect(failedNarrative.report.ai.status).toBe('unavailable');

    const consumedUnavailableNarrative = buildEntry({
      response: {
        ...response,
        aiNarrative: {
          status: 'unavailable',
          diagnosticCode: 'AI_NARRATIVE_INVALID_JSON',
          executiveSummary: null,
          explanation: null,
          recommendations: []
        }
      },
      quotaOutcome: 'consumed'
    });
    expect(consumedUnavailableNarrative.execution.mode).toBe('ai_unavailable');
    expect(consumedUnavailableNarrative.quota.status).toBe('yes');
    expect(consumedUnavailableNarrative.report.ai.status).toBe('unavailable');
    expect(consumedUnavailableNarrative.report.ai.diagnosticCode).toBe('AI_NARRATIVE_INVALID_JSON');
  });

  it('keeps 15 intentional repetitions as 15 entries when each has a confirmed new generation', () => {
    const storage = memoryStorage();
    const entries = [];
    for (let index = 0; index < 15; index += 1) {
      const timestamp = new Date(Date.parse(queriedAt) + index * 1000).toISOString();
      const entry = buildEntry({}, timestamp);
      const saved = saveSalesProfitabilityHistoryEntry({ scopeKey: 'scope-a', entry, storage });
      entries.push(...(index === 14 ? saved.entries : []));
    }

    expect(entries).toHaveLength(15);
    expect(entries.every((entry) => entry.report.request.question === requestContext.question)).toBe(true);
    expect(entries.every((entry) => entry.quota.status === 'yes')).toBe(true);
  });

  it('keeps separate entries for repeated prompts while honoring explicit fake cache hits without an actual cache', () => {
    const storage = memoryStorage();
    let entries = [];
    for (let index = 0; index < 15; index += 1) {
      const isCacheHit = index > 0;
      const timestamp = new Date(Date.parse(queriedAt) + index * 1000).toISOString();
      const entry = buildEntry(isCacheHit
        ? {
          response: { ...response, aiNarrative: null },
          providerCalled: false,
          quotaOutcome: 'not_consumed',
          usageStatus: null,
          cacheHit: true
        }
        : {}, timestamp);
      const saved = saveSalesProfitabilityHistoryEntry({ scopeKey: 'scope-a', entry, storage });
      entries = saved.entries;
    }

    expect(entries).toHaveLength(15);
    expect(entries.filter((entry) => entry.execution.mode === 'cache')).toHaveLength(14);
    expect(entries.filter((entry) => entry.quota.status === 'yes')).toHaveLength(1);
    expect(entries.filter((entry) => entry.quota.status === 'no')).toHaveLength(14);
  });

  it('does not infer a per-query charge from a quota total when the outcome is unconfirmed', () => {
    const entry = buildEntry({
      quotaOutcome: 'not_confirmed',
      usageStatus: { used: 14, limit: 15, remaining: 1 }
    });
    expect(entry.quota.status).toBe('unknown');
  });

  it('rejects invalid and failed responses instead of adding successful history entries', () => {
    expect(buildEntry({ response: { ...response, status: 'invalid' } })).toBeNull();
    expect(buildEntry({ response: null })).toBeNull();
  });

  it('separates stored history by the current tenant, actor, session, and license scope', () => {
    const storage = memoryStorage();
    const first = buildEntry();
    saveSalesProfitabilityHistoryEntry({ scopeKey: 'tenant-a-session-a-license-a', entry: first, storage });

    const otherContext = loadSalesProfitabilityHistory({
      scopeKey: 'tenant-b-session-b-license-b',
      storage
    });
    expect(otherContext.entries).toEqual([]);
    expect(storage.readRaw()).toBeNull();

    const fresh = buildEntry({}, new Date(Date.parse(queriedAt) + 10_000).toISOString());
    saveSalesProfitabilityHistoryEntry({ scopeKey: 'tenant-b-session-b-license-b', entry: fresh, storage });
    expect(loadSalesProfitabilityHistory({ scopeKey: 'tenant-a-session-a-license-a', storage }).entries).toEqual([]);
  });

  it('requires a complete private context before producing a persistent scope key', async () => {
    await expect(buildSalesProfitabilityHistoryScopeKey({
      tenantOpaqueId: 'tenant', actorKey: 'admin:a', sessionId: 'session'
    })).resolves.toBeNull();
  });

  it('creates a different opaque storage scope when tenant, actor, session, or license changes', async () => {
    const context = {
      tenantOpaqueId: 'tenant-a',
      actorKey: 'admin:admin-a',
      sessionId: 'session-a',
      licenseKey: 'license-a'
    };
    const base = await buildSalesProfitabilityHistoryScopeKey(context);
    expect(base).toMatch(/^[a-f0-9]{64}$/);
    await expect(buildSalesProfitabilityHistoryScopeKey({ ...context, tenantOpaqueId: 'tenant-b' })).resolves.not.toBe(base);
    await expect(buildSalesProfitabilityHistoryScopeKey({ ...context, actorKey: 'staff:staff-a' })).resolves.not.toBe(base);
    await expect(buildSalesProfitabilityHistoryScopeKey({ ...context, sessionId: 'session-b' })).resolves.not.toBe(base);
    await expect(buildSalesProfitabilityHistoryScopeKey({ ...context, licenseKey: 'license-b' })).resolves.not.toBe(base);
  });

  it('expires records older than 90 days and limits history to the latest 50 entries', () => {
    const storage = memoryStorage();
    const now = Date.parse(queriedAt);
    const stale = buildEntry({}, new Date(now - SALES_PROFITABILITY_HISTORY_RETENTION_MS - 1000).toISOString());
    const recentEntries = Array.from({ length: SALES_PROFITABILITY_HISTORY_MAX_ENTRIES + 5 }, (_, index) => (
      buildEntry({}, new Date(now - index * 1000).toISOString())
    ));
    storage.setItem(SALES_PROFITABILITY_HISTORY_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      scopeKey: 'scope-a',
      entries: [stale, ...recentEntries]
    }));

    const loaded = loadSalesProfitabilityHistory({ scopeKey: 'scope-a', now, storage });
    expect(loaded.entries).toHaveLength(SALES_PROFITABILITY_HISTORY_MAX_ENTRIES);
    expect(loaded.entries.every((entry) => now - Date.parse(entry.queriedAt) <= SALES_PROFITABILITY_HISTORY_RETENTION_MS)).toBe(true);
  });

  it('recovers from invalid JSON and reports local storage write failures without throwing', () => {
    const corrupt = memoryStorage({ initial: '{not-json' });
    expect(loadSalesProfitabilityHistory({ scopeKey: 'scope-a', storage: corrupt })).toMatchObject({
      entries: [],
      issue: 'history_recovered'
    });
    expect(corrupt.readRaw()).toBeNull();

    const full = memoryStorage({ failWrites: true });
    const saved = saveSalesProfitabilityHistoryEntry({ scopeKey: 'scope-a', entry: buildEntry(), storage: full });
    expect(saved.saved).toBe(false);
    expect(saved.issue).toBe('storage_unavailable');
  });

  it('omits secrets and internal fields from storage and downloaded history', () => {
    const secret = 'secret-license-token';
    const privateUuid = '123e4567-e89b-12d3-a456-426614174000';
    const unsafe = buildSalesProfitabilityHistoryEntry({
      result: {
        ...result(),
        requestKey: 'private-request-key',
        providerMetadata: { secret },
        response: {
          ...response,
          internalUuid: privateUuid,
          customerEmail: 'person@example.test'
        }
      },
      requestContext: { ...requestContext, licenseKey: secret, requestKey: 'private-request-key' },
      queriedAt
    });
    const payload = buildSalesProfitabilityHistoryDownloadPayload(unsafe);
    const serialized = JSON.stringify({ entry: unsafe, payload });

    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(privateUuid);
    expect(serialized).not.toContain('person@example.test');
    expect(serialized).not.toContain('private-request-key');
    expect(unsafe.report).not.toHaveProperty('providerMetadata');
    expect(payload).not.toHaveProperty('scopeKey');
    expect(payload).not.toHaveProperty('id');
  });

  it('opens, deletes, clears, and downloads a stored snapshot without any query or quota service dependency', () => {
    const storage = memoryStorage();
    const entry = buildEntry();
    saveSalesProfitabilityHistoryEntry({ scopeKey: 'scope-a', entry, storage });
    const click = vi.fn();
    const remove = vi.fn();
    const createObjectURL = vi.fn(() => 'blob:stored-report');
    const revokeObjectURL = vi.fn();
    const downloaded = downloadSalesProfitabilityHistoryEntry(entry, {
      now: new Date('2026-09-25T17:00:00.000Z'),
      documentRef: {
        createElement: () => ({ click, remove, style: {}, href: '', download: '' }),
        body: { appendChild: vi.fn() }
      },
      urlApi: { createObjectURL, revokeObjectURL },
      BlobCtor: class FakeBlob { constructor(parts) { this.parts = parts; } }
    });
    expect(downloaded.payload.report.result.executiveSummary).toBe(response.executiveSummary);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:stored-report');

    const deleted = deleteSalesProfitabilityHistoryEntry({ scopeKey: 'scope-a', id: entry.id, storage });
    expect(deleted.entries).toEqual([]);
    const cleared = clearSalesProfitabilityHistory({ storage });
    expect(cleared.saved).toBe(true);
    expect(loadSalesProfitabilityHistory({ scopeKey: 'scope-a', storage }).entries).toEqual([]);
  });
});
