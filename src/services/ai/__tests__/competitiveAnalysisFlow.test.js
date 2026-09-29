import { describe, expect, it, vi } from 'vitest';
import { createSalesProfitabilityAgentRunner } from '../salesProfitabilityAgentService';
import {
  buildSalesProfitabilityDownloadReport
} from '../salesProfitabilityDownloadReport';
import {
  buildSalesProfitabilityHistoryEntry,
  buildSalesProfitabilityHistoryDownloadPayload,
  loadSalesProfitabilityHistory,
  saveSalesProfitabilityHistoryEntry
} from '../salesProfitabilityHistory';

const observedAt = new Date().toISOString().slice(0, 10);
const query = '¿Mis precios son competitivos?';
const urlEvidence = {
  capturedAt: new Date().toISOString(),
  competitors: [{
    name: 'Mercado Uno',
    description: '',
    location: 'Centro',
    observedAt,
    source: { type: 'public_url', label: 'Catálogo público', url: 'https://example.com/catalogo#producto', text: '' },
    observations: [{
      type: 'product', name: 'Café Sierra', description: '', category: 'Café', price: 39, currency: 'MXN',
      unit: '500 ml', priceType: 'regular', promotion: '', taxStatus: 'included',
      shippingStatus: 'not_applicable', note: 'Etiqueta observada', comparableConfirmed: true
    }]
  }]
};

const catalog = {
  source: 'local_tenant_catalog', complete: true, productsTruncated: false, categoriesTruncated: false,
  categories: [{ id: 'cat-1', name: 'Café' }],
  products: [{ id: 'private-product-id', name: 'Café Sierra', categoryId: 'cat-1', price: 35, unit: '500 ml', isActive: true }]
};

const actor = { tenant: { opaqueId: 'tenant-a', databaseName: 'tenant-db-a', generation: 4 } };

const memoryStorage = () => {
  const values = new Map();
  return {
    isReady: () => true,
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
};

const requestContext = {
  question: query,
  resolvedIntent: 'competitive_analysis',
  resolution: { kind: 'supported', topic: 'competition', confidence: 'high', missingContext: [] },
  compare: false,
  period: {},
  scenario: {}
};

describe('competitive analysis service flow', () => {
  it('does not access the tenant catalog or provider when evidence is missing', async () => {
    const catalogLoader = vi.fn();
    const analyze = vi.fn();
    const assertActor = vi.fn(() => actor);
    const runner = createSalesProfitabilityAgentRunner({ catalogLoader, analyze, assertActor });

    const result = await runner({ question: 'Ayúdame a analizar mi competencia' });

    expect(result.intentResolution).toMatchObject({ kind: 'needs_context', topic: 'competition', requiresProvider: false });
    expect(result.response.status).toBe('not_ready');
    expect(result.providerCalled).toBe(false);
    expect(result.quotaOutcome).toBe('not_consumed');
    expect(catalogLoader).not.toHaveBeenCalled();
    expect(analyze).not.toHaveBeenCalled();
    expect(assertActor).not.toHaveBeenCalled();
  });

  it('reads one current-tenant catalog snapshot and completes the comparison locally without sending source text or URLs to a provider', async () => {
    const catalogLoader = vi.fn(async () => catalog);
    const analyze = vi.fn();
    const runner = createSalesProfitabilityAgentRunner({ catalogLoader, analyze, assertActor: () => actor });

    const result = await runner({ question: query, competitiveEvidence: urlEvidence });

    expect(catalogLoader).toHaveBeenCalledTimes(1);
    expect(catalogLoader).toHaveBeenCalledWith(expect.objectContaining({ actor, assertActor: expect.any(Function) }));
    expect(result.response.competitiveAnalysis.priceComparisons[0]).toMatchObject({
      comparisonStatus: 'comparable_with_conditions', ownPrice: 35, externalPrice: 39, difference: 4
    });
    expect(result.response.competitiveAnalysis.competitors[0].source).toMatchObject({
      evidenceType: 'user_provided', verified: false, url: 'https://example.com/catalogo'
    });
    expect(result).toMatchObject({ providerCalled: false, quotaOutcome: 'not_consumed', reportSource: 'mixed' });
    expect(analyze).not.toHaveBeenCalled();
    expect(JSON.stringify(analyze.mock.calls)).not.toContain('example.com');
  });

  it('stores a sanitized evidence snapshot in tenant history and preserves only a safe public URL reference in downloads', async () => {
    const runner = createSalesProfitabilityAgentRunner({
      catalogLoader: async () => catalog,
      analyze: vi.fn(),
      assertActor: () => actor
    });
    const result = await runner({ question: query, competitiveEvidence: urlEvidence });
    const report = buildSalesProfitabilityDownloadReport(result, requestContext, {
      generatedAt: new Date()
    });
    expect(report.agent.title).toBe('Análisis de competencia');
    expect(report.deterministic.competitiveAnalysis.competitors[0].source).toMatchObject({
      url: 'https://example.com/catalogo', verified: false
    });
    expect(JSON.stringify(report)).not.toContain('private-product-id');
    expect(report.result).toMatchObject({ providerCalled: false, quotaOutcome: 'not_consumed' });
    expect(report.ai.status).toBe('not_generated');

    const storage = memoryStorage();
    const entry = buildSalesProfitabilityHistoryEntry({
      result,
      requestContext,
      queriedAt: new Date()
    });
    expect(entry.execution.mode).toBe('deterministic');
    saveSalesProfitabilityHistoryEntry({ scopeKey: 'tenant-a-actor-a', entry, storage });
    const loaded = loadSalesProfitabilityHistory({ scopeKey: 'tenant-a-actor-a', storage });
    expect(loaded.entries).toHaveLength(1);
    expect(loaded.entries[0].report.deterministic.competitiveAnalysis.competitors[0].source).toMatchObject({
      url: 'https://example.com/catalogo', verified: false
    });
    const downloaded = buildSalesProfitabilityHistoryDownloadPayload(loaded.entries[0]);
    expect(downloaded.report.deterministic.competitiveAnalysis.priceComparisons[0]).toMatchObject({
      comparisonStatus: 'comparable_with_conditions', difference: 4, differencePercent: 11.43
    });
    expect(downloaded.report.result).toMatchObject({ providerCalled: false, quotaOutcome: 'not_consumed' });
  });
});
