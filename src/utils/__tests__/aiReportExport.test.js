// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildAIReportViewModel,
  buildTechnicalAIReport,
  createAIReportFilename,
  downloadAIReport,
  EMPTY_COLLECTION_LABEL,
  serializeAIReportMarkdown,
  serializeTechnicalAIReport
} from '../aiReportExport';
import { classifyParsedAgentResponse, parseAgentResponse } from '../parseAgentResponse';

const coverage = {
  complete: false,
  factsTotal: 14,
  factsIncluded: 10,
  factsOmitted: 4,
  notes: ['Se excluyeron elementos de menor impacto.'],
  reason: 'provider_payload_limit',
  sort: 'impact_desc'
};

const rawCompleteReport = JSON.stringify({
  title: 'Auditoría semanal de inventario',
  formatVersion: '1.1',
  executiveSummary: 'Hay productos con riesgo de quiebre y capital detenido.',
  severity: 'warning',
  confidence: 0.82,
  coverage,
  metrics: { capitalDetenido: '$12,400', productosEnRiesgo: 3 },
  findings: [{
    id: 'stock-risk',
    title: 'Productos próximos a agotarse',
    severity: 'danger',
    metric: '3 productos',
    summary: 'Requieren revisión de reposición.',
    evidence: ['Producto A tiene 0 unidades.']
  }],
  actions: [{ id: 'review-stock', label: 'Revisar reposición', description: 'Revisa los productos marcados.', priority: 'high', type: 'review' }],
  opportunities: [{ id: 'op-1', title: 'Mejorar rotación', description: 'Revisar el surtido semanal.', impact: 'high', effort: 'medium' }],
  questionsToAskUser: ['¿Hay una compra pendiente?'],
  toolReferences: ['inventory.stockRisk']
});

const completeRecord = {
  id: 'analysis-1',
  agentType: 'inventoryAuditor',
  agentName: 'Auditor de Inventario',
  generatedAt: '2026-09-09T12:30:00.000Z',
  status: 'completed',
  rawResultContent: rawCompleteReport,
  coverage,
  usage: { prompt_tokens: 1200, completion_tokens: 800, total_tokens: 2000 },
  providerMetadata: { provider: 'edge', model: 'synthetic-model', finish_reason: 'stop', latency_ms: 430 },
  factSnapshot: {
    coverage,
    inventoryAlerts: {
      outOfStockProducts: { total: 3, included: 3, omitted: 0, sort: 'impact_desc', reason: 'provider_payload_limit', items: [] }
    }
  },
  agentToolRun: { availableToolCount: 2, results: [{ id: 'inventory.stockRisk', evidence: ['Producto A tiene 0 unidades.'] }] }
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AI report presentation and local export', () => {
  it('builds a complete human-readable view model without losing report sections', () => {
    const model = buildAIReportViewModel(completeRecord);

    expect(model.title).toBe('Auditoría semanal de inventario');
    expect(model.statusLabel).toBe('Completado con cobertura parcial');
    expect(model.severity).toBe('warning');
    expect(model.summary).toContain('capital detenido');
    expect(model.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Capital detenido', value: '$12,400' }),
      expect.objectContaining({ label: 'Productos en riesgo', value: '3' })
    ]));
    expect(model.findings.items).toHaveLength(1);
    expect(model.evidence.items).toContain('Productos próximos a agotarse: Producto A tiene 0 unidades.');
    expect(model.coverage.total.value).toBe(14);
    expect(model.coverage.omissionReason.value).toBe('Se envió una cantidad limitada de datos para mantener el análisis eficiente.');
    expect(model.coverage.order.value).toBe('Elementos de mayor impacto primero.');
    expect(model.coverageDetails.some(detail => detail.label === 'Productos agotados')).toBe(true);
    expect(model.toolReferences).toContain('Riesgo de inventario');
    expect(model.usage.entries).toEqual(expect.arrayContaining([
      { label: 'Entrada', value: '1200' },
      { label: 'Modelo utilizado', value: 'Synthetic model' }
    ]));
  });

  it('shows friendly empty-list states and does not use the parser synthetic finding', () => {
    const emptyRecord = {
      ...completeRecord,
      rawResultContent: JSON.stringify({
        formatVersion: '1.1',
        executiveSummary: 'No se detectaron eventos.',
        severity: 'success',
        confidence: 0.9,
        coverage: { complete: true, factsTotal: 0, factsIncluded: 0, factsOmitted: 0, notes: [] },
        findings: [],
        actions: [],
        opportunities: [],
        questionsToAskUser: [],
        toolReferences: []
      })
    };
    const model = buildAIReportViewModel(emptyRecord);

    expect(model.findings).toMatchObject({ present: true, items: [] });
    expect(model.actions).toMatchObject({ present: true, items: [] });
    expect(model.opportunities).toMatchObject({ present: true, items: [] });
    expect(model.questions).toMatchObject({ present: true, items: [] });
  });

  it.each([
    ['incomplete', 'Completado con cobertura parcial'],
    ['invalid', 'Completado con cobertura parcial'],
    ['failed', 'Fallido'],
    ['saved', 'Legacy / guardado']
  ])('keeps the %s report status visible', (status, label) => {
    const model = buildAIReportViewModel({ ...completeRecord, status });
    expect(model.statusLabel).toBe(label);
  });

  it('supports a legacy text record without requiring a new analysis', () => {
    const model = buildAIReportViewModel({
      agentType: 'financialAnalyst',
      agentName: 'Analista Financiero',
      status: 'saved',
      resultContent: '# Resumen\n\n- Ventas estables'
    });

    expect(model.statusLabel).toBe('Legacy / guardado');
    expect(model.parsed.isStructured).toBe(false);
    expect(model.summary).toContain('Ventas estables');
    expect(serializeAIReportMarkdown({ resultContent: '# Resumen\n\n- Ventas estables', status: 'saved', agentType: 'financialAnalyst' })).toContain('Ventas estables');
  });

  it('uses the agent type as a friendly title fallback', () => {
    const model = buildAIReportViewModel({
      agentType: 'financialAnalyst',
      rawResultContent: JSON.stringify({ executiveSummary: 'Ventas estables.' })
    });

    expect(model.title).toBe('Analista financiero');
  });

  it('classifies HTTP 200 structured responses by coverage, not by external invalid status', () => {
    const partialRaw = JSON.stringify({
      ...JSON.parse(rawCompleteReport),
      coverage: { ...coverage, complete: false, factsTotal: 69, factsIncluded: 24, factsOmitted: 45 }
    });
    const parsed = parseAgentResponse(partialRaw, { finishReason: 'stop' });
    const classification = classifyParsedAgentResponse({ parsedResult: parsed, providerStatus: 200 });
    const model = buildAIReportViewModel({ status: 'invalid', rawResultContent: partialRaw });

    expect(classification).toMatchObject({ providerStatus: 'success', parseStatus: 'structured', reportStatus: 'incomplete', coverageStatus: 'partial' });
    expect(model.status).toBe('incomplete');
    expect(model.statusLabel).toBe('Completado con cobertura parcial');
  });

  it('classifies HTTP 200 structured responses with complete coverage as completed', () => {
    const completeRaw = JSON.stringify({
      ...JSON.parse(rawCompleteReport),
      coverage: { complete: true, factsTotal: 3, factsIncluded: 3, factsOmitted: 0, notes: [] }
    });
    const parsed = parseAgentResponse(completeRaw, { finishReason: 'stop' });

    expect(classifyParsedAgentResponse({ parsedResult: parsed, providerStatus: 200 })).toMatchObject({
      providerStatus: 'success',
      parseStatus: 'structured',
      reportStatus: 'completed',
      coverageStatus: 'complete'
    });
  });

  it('classifies malformed, empty and HTTP error responses separately', () => {
    expect(buildAIReportViewModel({ rawResultContent: '{malformed' }).status).toBe('invalid');
    expect(buildAIReportViewModel({ rawResultContent: '' }).status).toBe('failed');
    expect(buildAIReportViewModel({ providerHttpStatus: 500, rawResultContent: rawCompleteReport }).status).toBe('failed');
  });

  it('reads a structured result nested in parsedResult.parsedResult', () => {
    const nestedParsed = parseAgentResponse(rawCompleteReport, { finishReason: 'stop' });
    const model = buildAIReportViewModel({
      status: 'invalid',
      rawResultContent: '',
      parsedResult: { status: 'invalid', parsedResult: nestedParsed }
    });

    expect(model.status).toBe('incomplete');
    expect(model.summary).toContain('capital detenido');
    expect(model.parsed.isStructured).toBe(true);
  });

  it('derives deterministic metrics from the local fact snapshot', () => {
    const model = buildAIReportViewModel({
      rawResultContent: rawCompleteReport,
      factSnapshot: {
        menuStats: { outOfStockCount: 9 },
        inventoryAlerts: {
          outOfStockProducts: { total: 9 },
          lowStockProducts: { total: 10 },
          potentialDeadStock: { total: 50 },
          deadStockTotalTiedCapital: 19045.9
        },
        wasteStats: { wasteTransactions: 0 }
      }
    });

    expect(model.localMetrics).toEqual(expect.arrayContaining([
      { label: 'Productos agotados', value: '9', origin: 'local' },
      { label: 'Productos con bajo stock', value: '10', origin: 'local' },
      { label: 'Candidatos a stock muerto', value: '50', origin: 'local' },
      { label: 'Capital inmovilizado', value: '$19,045.90', origin: 'local' },
      { label: 'Mermas registradas', value: '0', origin: 'local' }
    ]));
    expect(model.evidence.items).toEqual(expect.arrayContaining([
      'Se encontraron 9 productos agotados y 10 productos por debajo de su nivel mínimo.',
      'Se identificaron 50 posibles productos con stock muerto, con $19,045.90 de capital inmovilizado.',
      'No se registraron movimientos de merma en el período analizado.'
    ]));
  });

  it('marks zero-total collections as empty instead of blaming the payload limit', () => {
    const model = buildAIReportViewModel({
      rawResultContent: rawCompleteReport,
      factSnapshot: { inventoryAlerts: { outOfStockProducts: { total: 0, included: 0, omitted: 0, reason: 'provider_payload_limit' } } }
    });

    const emptyDetail = model.coverageDetails.find(detail => detail.label === 'Productos agotados');
    expect(emptyDetail).toMatchObject({ empty: true, reason: EMPTY_COLLECTION_LABEL });
  });

  it('serializes a useful Markdown report for a non-technical reader', () => {
    const markdown = serializeAIReportMarkdown(completeRecord);

    expect(markdown).toContain('# Auditoría semanal de inventario');
    expect(markdown).toContain('Estado: Completado con cobertura parcial');
    expect(markdown).toContain('## Resumen ejecutivo');
    expect(markdown).toContain('## Métricas');
    expect(markdown).toContain('## Hallazgos');
    expect(markdown).toContain('## Evidencias');
    expect(markdown).toContain('## Recomendaciones y acciones');
    expect(markdown).toContain('## Oportunidades');
    expect(markdown).toContain('## Cobertura de datos');
    expect(markdown).toContain('Confianza del modelo: 82%');
    expect(markdown).toContain('Cobertura de datos: 71%');
    expect(markdown).toContain('Priorización: Elementos de mayor impacto primero.');
    expect(markdown).toContain('Modelo utilizado: Synthetic model');
    expect(markdown).not.toContain('coverage_incomplete');
    expect(markdown).not.toContain('provider_payload_limit');
    expect(markdown).not.toContain('inventory.stockRisk');
  });

  it('serializes the local technical record, preserving raw content, facts and tools while removing secrets', () => {
    const record = {
      ...completeRecord,
      auth: { licenseKey: 'license-secret', deviceSecurityToken: 'device-secret' },
      headers: { Authorization: 'Bearer private-header' },
      metadata: { apiKey: 'api-secret', request_id: 'request-1' },
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
    };
    const json = serializeTechnicalAIReport(record);
    const parsed = JSON.parse(json);

    expect(parsed.rawResultContent).toBe(rawCompleteReport);
    expect(parsed.coverage.reason).toBe('provider_payload_limit');
    expect(parsed.parsedResult.raw.coverage.reason).toBe('provider_payload_limit');
    expect(parsed.providerMetadata.finish_reason).toBe('stop');
    expect(parsed.factSnapshot).toEqual(record.factSnapshot);
    expect(parsed.agentToolRun).toEqual(record.agentToolRun);
    expect(parsed.usage.prompt_tokens).toBe(10);
    expect(json).not.toContain('license-secret');
    expect(json).not.toContain('device-secret');
    expect(json).not.toContain('api-secret');
    expect(json).not.toContain('private-header');
    expect(json).not.toContain('headers');
  });

  it('shows a friendly model label and hides provider diagnostics from the human usage panel', () => {
    const model = buildAIReportViewModel({
      ...completeRecord,
      providerMetadata: {
        provider: 'openai-compatible',
        model: 'deepseek-chat',
        finish_reason: 'stop',
        provider_response_status: 200,
        protocol: 'openai-compatible',
        prompt_cache_hit_tokens: 10,
        prompt_cache_miss_tokens: 20,
        request_id: 'request-1',
        provider_request_id: 'provider-request-1'
      }
    });

    expect(model.usage.entries).toContainEqual({ label: 'Modelo utilizado', value: 'DeepSeek' });
    expect(model.usage.entries.map(entry => entry.label)).not.toEqual(expect.arrayContaining(['Proveedor', 'Finalización', 'Cache hit', 'Cache miss']));
    expect(model.usage.entries.map(entry => entry.value)).not.toContain('openai-compatible');
  });

  it('creates a safe deterministic filename from the agent and local date', () => {
    expect(createAIReportFilename(completeRecord, 'md')).toBe('lanzo-ai-report-inventoryauditor-2026-09-09.md');
    expect(createAIReportFilename({ agentType: 'Auditor / inventario', generatedAt: '2026-09-09T00:00:00.000Z' }, 'json')).toBe('lanzo-ai-report-auditor-inventario-2026-09-09.json');
  });

  it('downloads from a Blob and revokes its object URL without network calls', () => {
    const createObjectUrl = vi.fn(() => 'blob:ai-report');
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const download = downloadAIReport(completeRecord, 'json');

    expect(download.filename).toBe('lanzo-ai-report-inventoryauditor-2026-09-09.json');
    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:ai-report');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('technical report export aliases', () => {
  it('adds the raw and parsed fields for an old string-shaped record', () => {
    const technical = buildTechnicalAIReport('{"summary":"legacy"}');
    expect(technical.rawResultContent).toBe('{"summary":"legacy"}');
    expect(technical.resultContent).toBe('{"summary":"legacy"}');
    expect(technical.parsedResult).toBeDefined();
  });
});
