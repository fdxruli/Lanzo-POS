import { describe, expect, it, vi } from 'vitest';
import {
  buildSalesProfitabilityDownloadFilename,
  buildSalesProfitabilityDownloadReport,
  downloadSalesProfitabilityReport
} from '../salesProfitabilityDownloadReport';

const internalUuid = '123e4567-e89b-12d3-a456-426614174000';

const requestContext = {
  question: '¿Qué pasó con Producto A?',
  resolvedIntent: 'price_simulation',
  compare: true,
  period: {
    from: '2026-09-01',
    to: '2026-09-07',
    previousFrom: '2026-08-25',
    previousTo: '2026-08-31',
    timezone: 'America/Mexico_City'
  },
  scenario: {
    productName: 'Producto A',
    newPrice: '120',
    promotionalPrice: '110',
    discountPercent: '8.5',
    historicalVolume: '20',
    expectedVolume: '24',
    requestKey: 'must-not-export'
  },
  licenseKey: 'LANZO-SECRET'
};

const completedResult = {
  providerCalled: true,
  usageStatus: { used: 3, limit: 15, remaining: 12, usage_id: internalUuid },
  requestKey: 'secret-request-key',
  response: {
    status: 'completed',
    executiveSummary: 'La IA recomienda revisar Producto A.',
    answer: 'La IA recomienda revisar Producto A.',
    explanation: 'Explicación narrativa sin mezclar los cálculos locales.',
    confidence: 'high',
    source: 'cloud',
    coverage: {
      validSales: 2,
      rawSales: 3,
      excludedSales: 1,
      ecommerceDuplicatesExcluded: 0,
      productsIncluded: 1,
      productsMissingCost: 0,
      costCoverage: 1,
      comparisonAvailable: true,
      complete: true,
      internalId: internalUuid
    },
    context: {
      summary: {
        netSales: 200,
        units: 4,
        salesCount: 2,
        averageTicket: 100,
        discounts: 0,
        unitCosts: 80,
        profit: 120,
        margin: 0.6,
        costCoverage: 1,
        missingCostProducts: 0,
        excludedSales: 1,
        ecommerceDuplicates: 0
      }
    },
    current: {
      period: { from: '2026-09-01', to: '2026-09-07', days: 7 },
      salesCount: 2,
      units: 4,
      netSales: 200,
      discounts: 0,
      discountsKnown: true,
      costOfSale: 80,
      costComplete: true,
      knownSales: 200,
      missingCostLines: 0,
      missingCostProducts: [],
      products: [{
        name: 'Producto A',
        quantity: 4,
        netSales: 200,
        unitCost: 20,
        profit: 120,
        margin: 0.6,
        averagePrice: 50,
        costKnown: true,
        id: internalUuid,
        customerEmail: 'cliente@example.com'
      }],
      channels: [{ channel: 'Físico', netSales: 200, orders: 2, units: 4, averageTicket: 100, share: 1 }],
      tickets: [100, 100],
      rawSales: [{ id: internalUuid }],
      customer: { phone: '+52 961 123 4567' },
      averageTicket: 100,
      profit: 120,
      margin: 0.6,
      costCoverage: 1
    },
    previous: {
      salesCount: 1,
      units: 2,
      netSales: 80,
      products: [{ name: 'Producto A', quantity: 2, netSales: 80, unitCost: 20, profit: 40, margin: 0.5, averagePrice: 40, costKnown: true }],
      channels: [{ channel: 'Físico', netSales: 80, orders: 1, units: 2, averageTicket: 80, share: 1 }],
      averageTicket: 80,
      profit: 40,
      margin: 0.5,
      costCoverage: 1
    },
    comparison: {
      previousNetSales: 80,
      previousUnits: 2,
      previousTicket: 80,
      previousCost: 40,
      previousProfit: 40,
      previousMargin: 0.5,
      previousDiscounts: 0,
      deltaNetSales: 120,
      deltaUnits: 2,
      deltaTicket: 20,
      deltaCost: 40,
      deltaProfit: 80,
      deltaMargin: 0.1,
      deltaDiscounts: 0,
      productMixChanges: [{ name: 'Producto A', currentShare: 1, previousShare: 1, deltaShare: 0 }],
      channelMixChanges: [{ channel: 'Físico', currentShare: 1, previousShare: 1, deltaShare: 0 }]
    },
    contributors: [{ label: 'costo de venta', contribution: -0.1, direction: 'positive', explanation: 'La tasa de costo mejoró.' }],
    calculations: [{
      label: 'Utilidad bruta',
      value: 120,
      formattedValue: '$120.00',
      formula: 'ventas netas - costo de venta',
      source: 'sales_history',
      period: { from: '2026-09-01', to: '2026-09-07', days: 7 },
      saleId: internalUuid
    }],
    scenarios: [{
      label: 'Volumen sin cambio',
      products: ['Producto A'],
      volume: 20,
      utility: 2000,
      margin: 0.4,
      newPrice: 120,
      note: 'Escenario ilustrativo; no es predicción.',
      internalId: internalUuid
    }],
    assumptions: ['La simulación usa volumen histórico.'],
    limitations: ['No es una predicción de demanda.'],
    recommendations: [{
      title: 'Probar el precio',
      explanation: 'Haz una prueba controlada.',
      expectedImpact: 'Medir utilidad.',
      effort: 'medium',
      evidence: ['utilidad calculada'],
      requiresConfirmation: true,
      internalId: internalUuid
    }],
    licenseKey: 'LANZO-SECRET',
    deviceFingerprint: 'device-secret',
    rawSalesRows: [{ id: internalUuid }],
    customerEmail: 'cliente@example.com',
    privateProviderUrl: 'https://private.provider.example/v1'
  }
};

describe('sales profitability download report', () => {
  it('builds the v1 complete report with request, period, intent and scenario', () => {
    const report = buildSalesProfitabilityDownloadReport(completedResult, requestContext, {
      generatedAt: new Date('2026-09-21T15:39:00.000Z')
    });

    expect(report.schemaVersion).toBe('sales-profitability-report-v1');
    expect(report.generatedAt).toBe('2026-09-21T15:39:00.000Z');
    expect(report.agent).toEqual({ key: 'salesProfitability', title: 'Ventas y rentabilidad' });
    expect(report.request).toMatchObject({
      question: '¿Qué pasó con Producto A?',
      resolvedIntent: 'price_simulation',
      compare: true,
      period: {
        from: '2026-09-01',
        to: '2026-09-07',
        previousFrom: '2026-08-25',
        previousTo: '2026-08-31',
        timezone: 'America/Mexico_City'
      },
      scenario: {
        productName: 'Producto A',
        newPrice: 120,
        promotionalPrice: 110,
        discountPercent: 8.5,
        historicalVolume: 20,
        expectedVolume: 24
      }
    });
    expect(report.result.status).toBe('completed');
    expect(report.result.providerCalled).toBe(true);
    expect(report.usage).toEqual({ used: 3, limit: 15, remaining: 12 });
  });

  it('keeps deterministic evidence separate from normalized AI narrative', () => {
    const report = buildSalesProfitabilityDownloadReport(completedResult, requestContext);

    expect(report.deterministic.summary.profit).toBe(120);
    expect(report.deterministic.current.products[0].name).toBe('Producto A');
    expect(report.deterministic.calculations[0].formula).toBe('ventas netas - costo de venta');
    expect(report.deterministic.scenarios[0].utility).toBe(2000);
    expect(report.ai.executiveSummary).toBe('La IA recomienda revisar Producto A.');
    expect(report.ai.recommendations[0].title).toBe('Probar el precio');
    expect(report.deterministic).not.toHaveProperty('recommendations');
  });

  it('excludes credentials, raw rows, internal ids, UUIDs and personal data', () => {
    const report = buildSalesProfitabilityDownloadReport(completedResult, requestContext);
    const serialized = JSON.stringify(report);

    expect(serialized).not.toContain('LANZO-SECRET');
    expect(serialized).not.toContain('device-secret');
    expect(serialized).not.toContain('secret-request-key');
    expect(serialized).not.toContain('must-not-export');
    expect(serialized).not.toContain(internalUuid);
    expect(serialized).not.toContain('cliente@example.com');
    expect(serialized).not.toContain('+52 961 123 4567');
    expect(serialized).not.toContain('private.provider.example');
    expect(serialized).not.toContain('rawSalesRows');
    expect(serialized).not.toContain('tickets');
    expect(report.redactions).toEqual([
      'raw sales rows omitted',
      'customer personal data omitted',
      'internal identifiers omitted',
      'authentication context omitted'
    ]);
  });

  it('builds and downloads an incomplete result without requiring AI output', () => {
    const incomplete = {
      providerCalled: false,
      usageStatus: null,
      response: {
        ...completedResult.response,
        status: 'incomplete',
        executiveSummary: 'No hay ventas válidas suficientes.',
        answer: 'No hay ventas válidas suficientes.',
        explanation: 'No se llamó al proveedor.',
        confidence: 'low',
        coverage: { validSales: 0, costCoverage: 0, complete: false },
        current: { products: [], channels: [] },
        previous: null,
        comparison: null,
        contributors: [],
        calculations: [],
        scenarios: [],
        recommendations: []
      }
    };
    const click = vi.fn();
    const remove = vi.fn();
    const appendChild = vi.fn();
    const createObjectURL = vi.fn(() => 'blob:incomplete');
    const revokeObjectURL = vi.fn();
    const link = { click, remove, style: {}, href: '', download: '' };
    const result = downloadSalesProfitabilityReport(incomplete, requestContext, {
      now: new Date(2026, 8, 21, 9, 39),
      documentRef: { createElement: vi.fn(() => link), body: { appendChild } },
      urlApi: { createObjectURL, revokeObjectURL },
      BlobCtor: class FakeBlob { constructor(parts, options) { this.parts = parts; this.options = options; } }
    });

    expect(result.report.result.status).toBe('incomplete');
    expect(result.report.result.providerCalled).toBe(false);
    expect(result.report.ai).toEqual({ executiveSummary: null, explanation: null, recommendations: [], confidence: null });
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:incomplete');
  });

  it('does nothing and does not allocate a URL when there is no result', () => {
    const createObjectURL = vi.fn();
    const revokeObjectURL = vi.fn();
    const result = downloadSalesProfitabilityReport(null, requestContext, {
      documentRef: { createElement: vi.fn(), body: { appendChild: vi.fn() } },
      urlApi: { createObjectURL, revokeObjectURL },
      BlobCtor: class FakeBlob {}
    });

    expect(result).toBeNull();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('releases the temporary URL and creates a safe readable filename for completed results', () => {
    const click = vi.fn();
    const remove = vi.fn();
    const appendChild = vi.fn();
    const createObjectURL = vi.fn(() => 'blob:completed');
    const revokeObjectURL = vi.fn();
    const link = { click, remove, style: {}, href: '', download: '' };
    const now = new Date(2026, 8, 21, 9, 39);

    const downloaded = downloadSalesProfitabilityReport(completedResult, requestContext, {
      now,
      documentRef: { createElement: vi.fn(() => link), body: { appendChild } },
      urlApi: { createObjectURL, revokeObjectURL },
      BlobCtor: class FakeBlob { constructor(parts, options) { this.parts = parts; this.options = options; } }
    });

    expect(downloaded.filename).toBe('lanzo-ventas-rentabilidad-2026-09-21-0939.json');
    expect(buildSalesProfitabilityDownloadFilename(now)).toBe(downloaded.filename);
    expect(link.download).toBe(downloaded.filename);
    expect(link.href).toBe('blob:completed');
    expect(appendChild).toHaveBeenCalledWith(link);
    expect(click).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:completed');
  });
});
