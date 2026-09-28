// @vitest-environment jsdom

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CommercialAIAgentsPage from '../CommercialAIAgentsPage';
import CommercialAIAgentsRoute from '../CommercialAIAgentsRoute';

const runtime = vi.hoisted(() => ({
  licenseDetails: null,
  companyProfile: null,
  actorSnapshot: null,
  historyStorage: new Map(),
  runAgent: vi.fn(),
  loadProducts: vi.fn(),
  getUsage: vi.fn(),
  createObjectURL: vi.fn(),
  revokeObjectURL: vi.fn()
}));

vi.mock('../../../services/ai/salesProfitabilityAgentService', () => ({
  runSalesProfitabilityAgent: runtime.runAgent,
  loadSalesProfitabilityProducts: runtime.loadProducts,
  resolveBusinessTimezone: (companyProfile = {}) => (
    companyProfile?.timezone
    || companyProfile?.time_zone
    || 'America/Mexico_City'
  )
}));

vi.mock('../../../services/aiService', () => ({
  getAIAgentUsageStatus: runtime.getUsage
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector({
    licenseDetails: runtime.licenseDetails,
    companyProfile: runtime.companyProfile
  })
}));

vi.mock('../../../services/auth/useActorRuntimeSnapshot', () => ({
  useActorRuntimeSnapshot: () => runtime.actorSnapshot
}));

vi.mock('../../../services/tenant/tenantScopedStorage', () => ({
  getTenantStorageState: () => ({ ready: true, writesSuspended: false }),
  getTenantStorageItem: (key) => runtime.historyStorage.get(key) ?? null,
  setTenantStorageItem: (key, value) => runtime.historyStorage.set(key, value),
  removeTenantStorageItem: (key) => runtime.historyStorage.delete(key)
}));

const entitledLicense = { valid: true, plan_code: 'nube', license_key: 'license-a', features: { ai_agents: true } };
const boundAdmin = {
  status: 'granted',
  actorType: 'admin',
  actorId: 'admin-a',
  actorKey: 'admin:admin-a',
  sessionId: 'session-a',
  deviceRef: 'device-a',
  permissions: ['*'],
  tenant: { opaqueId: 'tenant-a', databaseName: 'LanzoDB_t_tenant-a', generation: 1 }
};

const renderCenter = () => render(
  <MemoryRouter initialEntries={['/agentes-ia']}>
    <CommercialAIAgentsRoute>
      <CommercialAIAgentsPage />
    </CommercialAIAgentsRoute>
  </MemoryRouter>
);

describe('commercial AI center', () => {
  beforeEach(() => {
    runtime.licenseDetails = entitledLicense;
    runtime.companyProfile = { timezone: 'America/New_York' };
    runtime.actorSnapshot = boundAdmin;
    runtime.historyStorage.clear();
    runtime.runAgent.mockReset();
    runtime.loadProducts.mockReset();
    runtime.getUsage.mockReset();
    runtime.getUsage.mockResolvedValue({
      used: 2,
      limit: 15,
      remaining: 13,
      isUnlimited: false,
      isLimitConfigured: true,
      isLimitReached: false,
      period_end: '2026-10-01T00:00:00Z'
    });
    runtime.loadProducts.mockResolvedValue({
      source: 'cloud_final',
      products: [
        { name: 'Producto A', units: 2, netSales: 100, averagePrice: 50, unitCost: 20, costKnown: true },
        { name: 'Producto B', units: 1, netSales: 60, averagePrice: 60, unitCost: 25, costKnown: true }
      ]
    });
    runtime.createObjectURL.mockReset();
    runtime.revokeObjectURL.mockReset();
    runtime.createObjectURL.mockReturnValue('blob:lanzo-sales-profitability-report');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: runtime.createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: runtime.revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    runtime.runAgent.mockResolvedValue({
      response: {
        status: 'completed',
        executiveSummary: 'Resumen de prueba',
        explanation: 'Explicación de prueba',
        confidence: 'medium',
        source: 'cloud',
        coverage: { validSales: 1, costCoverage: 1 },
        facts: [],
        calculations: [],
        assumptions: [],
        limitations: [],
        recommendations: [],
        scenarios: []
      },
      usageStatus: { used: 1, limit: 15, remaining: 14 },
      providerCalled: true,
      quotaOutcome: 'consumed'
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows the functional sales agent and keeps ecommerce blocked', () => {
    renderCenter();

    expect(screen.getByRole('heading', { name: 'Agentes IA comerciales' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ventas y rentabilidad' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ecommerce' })).toBeInTheDocument();
    expect(screen.getByText('Disponible')).toBeInTheDocument();
    expect(screen.getByText('Próximamente')).toBeInTheDocument();
    expect(screen.getByText('Este agente aún no está disponible.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pregúntale a Lía sobre tu negocio' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Pregunta libre' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analizar' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Descargar reporte completo' })).toBeDisabled();
    expect(runtime.runAgent).not.toHaveBeenCalled();
  });

  it('renders the usage loading state safely while the initial lookup is pending', () => {
    runtime.getUsage.mockImplementation(() => new Promise(() => {}));

    renderCenter();

    expect(screen.getByText('Consultando uso de IA…')).toBeInTheDocument();
    expect(runtime.getUsage).toHaveBeenCalledTimes(1);
    expect(runtime.runAgent).not.toHaveBeenCalled();
  });

  it('loads and shows IA usage on the main screen without opening technical details', async () => {
    renderCenter();

    expect(await screen.findByText('Usados: 2 · Límite: 15 · Disponibles: 13')).toBeInTheDocument();
    expect(screen.getByText(/Periodo actual hasta/i)).toBeInTheDocument();
    expect(runtime.getUsage).toHaveBeenCalledTimes(1);
    expect(runtime.runAgent).not.toHaveBeenCalled();
  });

  it('keeps usage query failures visible and retries explicitly', async () => {
    runtime.getUsage
      .mockRejectedValueOnce(new Error('usage unavailable'))
      .mockResolvedValueOnce({
        used: 3,
        limit: 15,
        remaining: 12,
        isUnlimited: false,
        isLimitConfigured: true,
        isLimitReached: false
      });

    renderCenter();
    expect(await screen.findByText('No se pudo consultar el uso de IA. Puedes reintentar.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('Usados: 3 · Límite: 15 · Disponibles: 12')).toBeInTheDocument();
    expect(runtime.getUsage).toHaveBeenCalledTimes(2);
  });

  it('refreshes the main usage indicator after an IA response', async () => {
    runtime.getUsage
      .mockResolvedValueOnce({
        used: 2,
        limit: 15,
        remaining: 13,
        isUnlimited: false,
        isLimitConfigured: true,
        isLimitReached: false
      })
      .mockResolvedValueOnce({
        used: 3,
        limit: 15,
        remaining: 12,
        isUnlimited: false,
        isLimitConfigured: true,
        isLimitReached: false
      });
    runtime.runAgent.mockResolvedValueOnce({
      response: {
        status: 'completed',
        executiveSummary: 'Resumen de prueba',
        explanation: 'Explicación de prueba',
        confidence: 'medium',
        source: 'cloud',
        coverage: { validSales: 1, costCoverage: 1 },
        facts: [],
        calculations: [],
        assumptions: [],
        limitations: [],
        recommendations: [],
        scenarios: []
      },
      usageStatus: { used: 3, limit: 15, remaining: 12 },
      providerCalled: true
    });

    renderCenter();
    await screen.findByText('Usados: 2 · Límite: 15 · Disponibles: 13');
    fireEvent.click(screen.getByRole('button', { name: '¿Mi negocio es rentable?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));

    await waitFor(() => expect(runtime.getUsage).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Usados: 3 · Límite: 15 · Disponibles: 12')).toBeInTheDocument();
  });

  it('keeps the last known usage visible after an analysis 400 and a failed refresh', async () => {
    runtime.getUsage
      .mockResolvedValueOnce({
        used: 2,
        limit: 15,
        remaining: 13,
        isUnlimited: false,
        isLimitConfigured: true,
        isLimitReached: false
      })
      .mockRejectedValueOnce(new Error('usage refresh failed'));
    runtime.runAgent.mockRejectedValueOnce(Object.assign(new Error('contract details'), {
      code: 'INVALID_REQUEST',
      statusCode: 400
    }));

    renderCenter();
    await screen.findByText('Usados: 2 · Límite: 15 · Disponibles: 13');
    fireEvent.click(screen.getByRole('button', { name: '¿Qué combos puedo formar?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));

    await waitFor(() => expect(screen.getByText('No pudimos procesar esta consulta. Revisa las opciones seleccionadas e inténtalo nuevamente.')).toBeInTheDocument());
    expect(screen.getByText('Usados: 2 · Límite: 15 · Disponibles: 13')).toBeInTheDocument();
    expect(await screen.findByText('No se pudo consultar el uso de IA. El último dato disponible se conserva.')).toBeInTheDocument();
  });

  it('consumes the analysis path only after the user submits a question and propagates the company timezone', async () => {
    renderCenter();
    fireEvent.change(screen.getByRole('textbox', { name: 'Pregunta libre' }), { target: { value: '¿Por qué bajó mi margen?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));

    await waitFor(() => expect(runtime.runAgent).toHaveBeenCalledTimes(1));
    expect(runtime.runAgent.mock.calls[0][0]).toMatchObject({
      intent: 'explain_change',
      compare: true,
      period: { timezone: 'America/New_York' }
    });
    expect(runtime.loadProducts).not.toHaveBeenCalled();
    expect(screen.getByText('Resumen de prueba')).toBeInTheDocument();
    expect(screen.getByText('Uso IA: 1 / 15')).toBeInTheDocument();
    await waitFor(() => {
      const raw = runtime.historyStorage.get('commercial-ai-sales-profitability-history-v1');
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw).entries).toHaveLength(1);
    });
  });

  it('adds a deterministic completed analysis to local history with confirmed zero use', async () => {
    runtime.runAgent.mockResolvedValueOnce({
      response: {
        status: 'completed',
        executiveSummary: 'Resumen determinístico guardado',
        explanation: 'El resumen usa hechos determinísticos.',
        confidence: 'medium',
        source: 'cloud',
        intent: 'profitability_summary',
        coverage: { validSales: 4, costCoverage: 1 },
        calculations: [{ label: 'Ventas', value: 300, formula: 'suma' }],
        assumptions: [],
        limitations: [],
        recommendations: [],
        scenarios: [],
        aiNarrative: null
      },
      usageStatus: null,
      providerCalled: false,
      quotaOutcome: 'not_consumed'
    });

    renderCenter();
    const question = '¿Mi negocio es rentable?';
    fireEvent.change(screen.getByRole('textbox', { name: 'Pregunta libre' }), { target: { value: question } });
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));

    expect(await screen.findByRole('heading', { name: question })).toBeInTheDocument();
    expect(screen.getByText('Análisis automático')).toBeInTheDocument();
    expect(screen.getByText('No', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Snapshot del contador: no disponible')).toBeInTheDocument();
    expect(screen.getByText('Historial de consultas')).toBeInTheDocument();
    expect(runtime.getUsage).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Ver respuesta' }));
    expect(screen.getAllByText('Resumen determinístico guardado')).toHaveLength(2);
    expect(screen.getAllByText('Datos que respaldan esta respuesta')).toHaveLength(2);
    expect(screen.queryByText('Narrativa opcional de IA')).not.toBeInTheDocument();
  });

  it('labels a response as Caché only when a cache-hit flag is explicit', async () => {
    runtime.runAgent.mockResolvedValueOnce({
      response: {
        status: 'completed',
        executiveSummary: 'Respuesta reutilizada',
        explanation: 'Datos guardados del análisis previo.',
        confidence: 'medium',
        source: 'cloud',
        coverage: { validSales: 1, costCoverage: 1 },
        calculations: [],
        assumptions: [],
        limitations: [],
        recommendations: [],
        scenarios: [],
        aiNarrative: null
      },
      providerCalled: false,
      quotaOutcome: 'not_consumed',
      cacheHit: true,
      usageStatus: null
    });

    renderCenter();
    fireEvent.change(screen.getByRole('textbox', { name: 'Pregunta libre' }), { target: { value: '¿Mi negocio es rentable?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));

    expect(await screen.findByText('Caché')).toBeInTheDocument();
    expect(screen.getByText('No', { exact: true })).toBeInTheDocument();
    expect(runtime.getUsage).toHaveBeenCalledTimes(1);
  });

  it('shows and saves a called but unusable AI narrative without replacing deterministic results', async () => {
    runtime.runAgent.mockResolvedValueOnce({
      response: {
        status: 'completed',
        executiveSummary: 'Ventas netas de $300 con utilidad determinística de $120.',
        explanation: 'Este resumen proviene de los cálculos de Lanzo-POS.',
        confidence: 'medium',
        source: 'cloud',
        coverage: { validSales: 3, costCoverage: 1 },
        calculations: [{ label: 'Utilidad', value: 120, formula: 'ventas netas - costo de venta' }],
        assumptions: [],
        limitations: [],
        recommendations: [],
        scenarios: [],
        aiNarrative: {
          status: 'unavailable',
          diagnosticCode: 'AI_NARRATIVE_INVALID_JSON',
          executiveSummary: null,
          explanation: null,
          recommendations: []
        }
      },
      providerCalled: true,
      quotaOutcome: 'consumed',
      usageStatus: { used: 3, limit: 15, remaining: 12 }
    });

    renderCenter();
    fireEvent.change(screen.getByRole('textbox', { name: 'Pregunta libre' }), { target: { value: '¿Mi negocio es rentable?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));

    expect(await screen.findByRole('heading', { name: 'Ventas netas de $300 con utilidad determinística de $120.' })).toBeInTheDocument();
    expect(screen.getByText('Este resumen proviene de los cálculos de Lanzo-POS.')).toBeInTheDocument();
    expect(screen.getByText(/La respuesta de Lía no está disponible/)).toBeInTheDocument();
    expect(screen.getByText(/El proveedor devolvió un formato narrativo no válido/)).toBeInTheDocument();
    expect(screen.getByText(/El uso de IA quedó registrado/)).toBeInTheDocument();
    expect(await screen.findByText('IA no disponible')).toBeInTheDocument();
    expect(screen.getByText('IA no disponible').closest('article')).toHaveTextContent('Usó cuota: Sí');
    expect(runtime.runAgent).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Ver respuesta' }));
    expect(screen.getAllByText(/formato narrativo no válido/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Utilidad').length).toBeGreaterThanOrEqual(2);
  });

  it('shows the Lanzo-calculated fallback and confirmed no-use notice after a pre-provider rejection', async () => {
    runtime.runAgent.mockResolvedValueOnce({
      response: {
        status: 'completed',
        executiveSummary: 'Las ventas netas fueron $300.',
        explanation: 'Cálculo a partir del historial del periodo.',
        confidence: 'medium',
        source: 'cloud',
        coverage: { validSales: 3 },
        calculations: [],
        assumptions: [],
        limitations: [],
        recommendations: [],
        scenarios: [],
        aiNarrative: {
          status: 'unavailable',
          diagnosticCode: 'AI_REQUEST_REJECTED',
          executiveSummary: null,
          explanation: null,
          recommendations: []
        }
      },
      providerCalled: false,
      quotaOutcome: 'not_consumed',
      usageStatus: null
    });

    renderCenter();
    fireEvent.change(screen.getByRole('textbox', { name: 'Pregunta libre' }), { target: { value: '¿Cómo puedo aumentar mis ventas?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));

    expect(await screen.findByRole('heading', { name: 'Las ventas netas fueron $300.' })).toBeInTheDocument();
    const notice = screen.getByText(/Este intento no consumió un uso de IA/).closest('[role="status"]');
    expect(notice).toHaveTextContent('Análisis calculado por Lanzo.');
    expect(notice).toHaveTextContent('Este intento no consumió un uso de IA.');
    expect(screen.getByText(/solicitud fue rechazada antes de generar una explicación/)).toBeInTheDocument();
    expect(screen.queryByText('Narrativa generada por IA.')).not.toBeInTheDocument();
    expect(screen.getAllByText('Análisis calculado por Lanzo').length).toBeGreaterThan(0);
    expect(screen.queryByText(/AI_REQUEST_REJECTED/)).not.toBeInTheDocument();
  });

  it('explains that a truncated provider response was attempted but did not consume quota', async () => {
    runtime.runAgent.mockResolvedValueOnce({
      response: {
        status: 'completed',
        executiveSummary: 'Las ventas netas fueron $300.',
        explanation: 'Cálculo a partir del historial del periodo.',
        confidence: 'medium',
        source: 'cloud',
        coverage: { validSales: 3 },
        calculations: [],
        assumptions: [],
        limitations: [],
        recommendations: [],
        scenarios: [],
        aiNarrative: {
          status: 'unavailable',
          diagnosticCode: 'AI_NARRATIVE_TRUNCATED',
          executiveSummary: null,
          explanation: null,
          recommendations: []
        }
      },
      providerCalled: true,
      quotaOutcome: 'not_consumed',
      usageStatus: { used: 6, limit: 15, remaining: 9 }
    });

    renderCenter();
    fireEvent.change(screen.getByRole('textbox', { name: 'Pregunta libre' }), { target: { value: '¿Cómo puedo aumentar mis ventas?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));

    expect(await screen.findByRole('heading', { name: 'Las ventas netas fueron $300.' })).toBeInTheDocument();
    const notice = screen.getByText(/El proveedor respondió, pero no entregó una narrativa válida/).closest('[role="status"]');
    expect(notice).toHaveTextContent('Este intento no consumió un uso de IA.');
    expect(screen.getByText(/alcanzó el límite de salida antes de completarse/i)).toBeInTheDocument();
    expect(screen.queryByText('Narrativa generada por IA.')).not.toBeInTheDocument();
  });

  it('does not claim that quota was not consumed when Edge usage is unknown', async () => {
    runtime.runAgent.mockResolvedValueOnce({
      response: {
        status: 'completed',
        executiveSummary: 'Las ventas netas fueron $300.',
        explanation: 'Cálculo a partir del historial del periodo.',
        confidence: 'medium',
        source: 'cloud',
        coverage: { validSales: 3 },
        calculations: [],
        assumptions: [],
        limitations: [],
        recommendations: [],
        scenarios: [],
        aiNarrative: { status: 'unavailable' }
      },
      providerCalled: null,
      quotaOutcome: 'not_confirmed',
      usageStatus: null
    });

    renderCenter();
    fireEvent.change(screen.getByRole('textbox', { name: 'Pregunta libre' }), { target: { value: '¿Cómo puedo aumentar mis ventas?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));

    expect(await screen.findByRole('heading', { name: 'Las ventas netas fueron $300.' })).toBeInTheDocument();
    const notice = screen.getByText(/Estamos verificando el estado del uso de IA/).closest('[role="status"]');
    expect(notice).toBeInTheDocument();
    expect(screen.queryByText(/no consumió un uso de IA/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Narrativa generada por IA.')).not.toBeInTheDocument();
  });

  it('blocks same-turn duplicate submits so one UI action creates one analysis and one history entry', async () => {
    let resolveRun;
    runtime.runAgent.mockImplementationOnce(() => new Promise((resolve) => { resolveRun = resolve; }));
    renderCenter();
    fireEvent.change(screen.getByRole('textbox', { name: 'Pregunta libre' }), { target: { value: '¿Mi negocio es rentable?' } });
    const form = screen.getByRole('button', { name: 'Analizar' }).closest('form');
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => expect(runtime.runAgent).toHaveBeenCalledTimes(1));
    resolveRun({
      response: {
        status: 'completed',
        executiveSummary: 'Una respuesta guardada',
        explanation: 'Hechos fijos.',
        confidence: 'medium',
        source: 'cloud',
        coverage: { validSales: 1 },
        calculations: [],
        assumptions: [],
        limitations: [],
        recommendations: [],
        scenarios: [],
        aiNarrative: { status: 'available', executiveSummary: 'Narrativa válida' }
      },
      providerCalled: true,
      quotaOutcome: 'consumed',
      usageStatus: { used: 3, limit: 15, remaining: 12 }
    });

    expect(await screen.findByText('Narrativa válida')).toBeInTheDocument();
    expect(screen.getByText('Respuesta de Lía')).toBeInTheDocument();
    let raw;
    await waitFor(() => {
      raw = runtime.historyStorage.get('commercial-ai-sales-profitability-history-v1');
      expect(raw).toBeTruthy();
    });
    expect(JSON.parse(raw).entries).toHaveLength(1);
    expect(runtime.runAgent).toHaveBeenCalledTimes(1);
  });

  it('shows Phase 2 AI recommendations as why, action, measurement and confidence', async () => {
    runtime.runAgent.mockResolvedValueOnce({
      response: {
        status: 'completed',
        intent: 'sales_growth',
        executiveSummary: 'Hay una prueba concreta para Producto A.',
        explanation: 'Los hechos calculados se muestran aparte.',
        confidence: 'medium',
        source: 'cloud',
        coverage: { validSales: 1 },
        calculations: [],
        assumptions: [],
        limitations: [],
        recommendations: [],
        scenarios: [],
        opportunityCandidates: [{
          key: 'product:Producto A',
          type: 'product',
          focus: { type: 'product', key: 'Producto A' },
          recommendationType: 'growth_experiment',
          evidenceKeys: ['product:Producto A']
        }],
        minimumUsefulRecommendations: 1,
        aiNarrative: {
          status: 'available',
          directAnswer: 'Prueba una ubicación más visible para Producto A y mide sus unidades durante una semana.',
          executiveSummary: 'Hay una prueba concreta para Producto A.',
          explanation: 'La señal de Producto A justifica una prueba acotada.',
          confidence: 'high',
          recommendations: [{
            title: 'Probar mayor visibilidad para Producto A',
            focus: { type: 'product', key: 'Producto A' },
            recommendationType: 'growth_experiment',
            explanation: 'Producto A tiene una señal de ventas actual relevante.',
            action: 'Probar una ubicación más visible durante una semana.',
            measurement: 'Comparar unidades diarias con la semana previa.',
            expectedImpact: 'Permitirá evaluar si la exposición coincide con más unidades.',
            priority: 'high',
            evidenceKeys: ['product:Producto A'],
            requiresConfirmation: true
          }]
        }
      },
      providerCalled: true,
      quotaOutcome: 'consumed',
      usageStatus: { used: 3, limit: 15, remaining: 12 }
    });
    renderCenter();
    fireEvent.change(screen.getByRole('textbox', { name: 'Pregunta libre' }), {
      target: { value: '¿Cómo puedo aumentar mis ventas?' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));

    expect(await screen.findByText('Oportunidades priorizadas por Lía')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Prueba una ubicación más visible para Producto A y mide sus unidades durante una semana.' })).toBeInTheDocument();
    expect(screen.getByText('Por qué:')).toBeInTheDocument();
    expect(screen.getByText('Qué probar:')).toBeInTheDocument();
    expect(screen.getByText('Qué medir:')).toBeInTheDocument();
    expect(screen.getByText(/Confianza de esta interpretación: Alta/)).toBeInTheDocument();
    expect(screen.getByText(/Requiere confirmación manual/)).toBeInTheDocument();
    expect(screen.queryByText('product:Producto A')).not.toBeInTheDocument();
  });

  it('does not put errors or invalid response shapes in history', async () => {
    runtime.runAgent.mockResolvedValueOnce({
      response: { status: 'invalid', executiveSummary: 'No mostrar como exitoso' },
      providerCalled: true,
      quotaOutcome: 'consumed'
    });
    renderCenter();
    fireEvent.change(screen.getByRole('textbox', { name: 'Pregunta libre' }), { target: { value: '¿Mi negocio es rentable?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));

    expect(await screen.findByText('No pudimos procesar esta consulta. Revisa las opciones seleccionadas e inténtalo nuevamente.')).toBeInTheDocument();
    expect(screen.queryByText('No mostrar como exitoso')).not.toBeInTheDocument();
    expect(screen.getByText('Todavía no hay consultas completadas en este contexto.')).toBeInTheDocument();
  });

  it('opens, downloads, deletes, and clears snapshots without rerunning analysis or refreshing quota', async () => {
    renderCenter();
    fireEvent.change(screen.getByRole('textbox', { name: 'Pregunta libre' }), { target: { value: '¿Por qué cambió mi margen?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: '¿Por qué cambió mi margen?' })).toBeInTheDocument());
    fireEvent.change(screen.getByRole('textbox', { name: 'Pregunta libre' }), { target: { value: '¿Mi negocio es rentable?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Ver respuesta' })).toHaveLength(2));
    await waitFor(() => expect(runtime.getUsage).toHaveBeenCalledTimes(3));

    const runnerCalls = runtime.runAgent.mock.calls.length;
    const usageCalls = runtime.getUsage.mock.calls.length;
    fireEvent.click(screen.getAllByRole('button', { name: 'Ver respuesta' })[0]);
    const historyDownload = screen.getAllByRole('button', { name: 'Descargar reporte completo' }).at(-1);
    fireEvent.click(historyDownload);
    await waitFor(() => expect(runtime.createObjectURL).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getAllByRole('button', { name: 'Eliminar consulta del historial' })[0]);
    expect(screen.getAllByRole('button', { name: 'Ver respuesta' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar historial' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sí, limpiar historial' }));

    expect(screen.getByText('Todavía no hay consultas completadas en este contexto.')).toBeInTheDocument();
    expect(runtime.runAgent).toHaveBeenCalledTimes(runnerCalls);
    expect(runtime.getUsage).toHaveBeenCalledTimes(usageCalls);
  });

  it('hides the previous history when the actor session and tenant context change', async () => {
    const view = renderCenter();
    fireEvent.change(screen.getByRole('textbox', { name: 'Pregunta libre' }), { target: { value: '¿Mi negocio es rentable?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));
    expect(await screen.findByRole('heading', { name: '¿Mi negocio es rentable?' })).toBeInTheDocument();

    runtime.actorSnapshot = {
      ...boundAdmin,
      actorKey: 'admin:admin-b',
      actorId: 'admin-b',
      sessionId: 'session-b',
      tenant: { opaqueId: 'tenant-b', databaseName: 'LanzoDB_t_tenant-b', generation: 2 }
    };
    view.rerender(
      <MemoryRouter initialEntries={['/agentes-ia']}>
        <CommercialAIAgentsRoute><CommercialAIAgentsPage /></CommercialAIAgentsRoute>
      </MemoryRouter>
    );

    expect(await screen.findByText('Todavía no hay consultas completadas en este contexto.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '¿Mi negocio es rentable?' })).not.toBeInTheDocument();
  });

  it('offers only the documented selectable periods 7/30/90/365 days', () => {
    renderCenter();
    const periodSelect = screen.getByRole('combobox', { name: /periodo/i });
    expect(screen.getByRole('option', { name: 'Últimos 7 días' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Últimos 30 días' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Últimos 90 días' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Últimos 12 meses' })).toBeInTheDocument();
    expect(Array.from(periodSelect.options).map((option) => option.value)).toEqual(['7', '30', '90', '365']);
    expect(screen.queryByRole('option', { name: /60/ })).not.toBeInTheDocument();
  });


  it('downloads the completed in-memory result without invoking the agent or quota path again', async () => {
    renderCenter();
    fireEvent.change(screen.getByRole('textbox', { name: 'Pregunta libre' }), { target: { value: '¿Por qué bajó mi margen?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));

    await waitFor(() => expect(runtime.runAgent).toHaveBeenCalledTimes(1));
    const downloadButton = screen.getByRole('button', { name: 'Descargar reporte completo' });
    expect(downloadButton).toBeEnabled();

    fireEvent.click(downloadButton);

    await waitFor(() => expect(runtime.createObjectURL).toHaveBeenCalledTimes(1));
    expect(runtime.revokeObjectURL).toHaveBeenCalledWith('blob:lanzo-sales-profitability-report');
    expect(runtime.runAgent).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Resumen de prueba')).toBeInTheDocument();
  });

  it('downloads an incomplete result without starting a new analysis', async () => {
    runtime.runAgent.mockResolvedValueOnce({
      response: {
        status: 'incomplete',
        executiveSummary: 'No hay ventas suficientes.',
        answer: 'No hay ventas suficientes.',
        explanation: 'No existe evidencia suficiente para completar el análisis.',
        confidence: 'low',
        source: 'cloud',
        coverage: { validSales: 0, costCoverage: 0, complete: false },
        facts: [],
        calculations: [],
        assumptions: ['Periodo válido.'],
        limitations: ['No hay ventas válidas.'],
        recommendations: [],
        scenarios: [],
        current: { products: [], channels: [] },
        previous: null,
        comparison: null,
        contributors: [],
        context: { summary: { salesCount: 0, netSales: 0 } }
      },
      usageStatus: null,
      providerCalled: false
    });

    renderCenter();
    fireEvent.change(screen.getByRole('textbox', { name: 'Pregunta libre' }), { target: { value: '¿Cómo estuvieron mis ventas?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));
    await waitFor(() => expect(screen.getByText('No hay ventas suficientes.')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Descargar reporte completo' }));

    await waitFor(() => expect(runtime.createObjectURL).toHaveBeenCalledTimes(1));
    expect(runtime.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(runtime.runAgent).toHaveBeenCalledTimes(1);
  });

  it('shows availability for Free/Local without rendering the center or invoking analysis', () => {
    runtime.licenseDetails = { valid: true, plan_code: 'free', features: { ai_agents: false } };
    renderCenter();

    expect(screen.getByText('Los agentes IA comerciales requieren un plan compatible.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ventas y rentabilidad' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(runtime.getUsage).not.toHaveBeenCalled();
  });

  it('blocks direct access when actor, tenant or device context is not authorized', () => {
    runtime.actorSnapshot = { ...boundAdmin, actorKey: '', tenant: null, deviceRef: null };
    renderCenter();

    expect(screen.getByRole('heading', { name: 'No tienes permiso para acceder a esta sección' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Agentes IA comerciales' })).not.toBeInTheDocument();
  });
  it('reinfers a free question after a previous scenario suggestion', async () => {
    renderCenter();
    fireEvent.click(screen.getByRole('button', { name: '¿Qué promoción puedo simular?' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Pregunta libre' }), { target: { value: '¿Mi negocio es rentable?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));

    await waitFor(() => expect(runtime.runAgent).toHaveBeenCalledTimes(1));
    expect(runtime.runAgent.mock.calls[0][0]).toMatchObject({ intent: 'profitability_summary' });
  });

  it('prefills and lets the user correct a revenue goal before displaying the deterministic result', async () => {
    runtime.runAgent.mockResolvedValueOnce({
      response: {
        status: 'completed', intent: 'goal_simulation', executiveSummary: 'La meta de ventas está a $24,000.',
        explanation: 'Con el ticket promedio actual, el resultado es matemático y no una predicción.',
        confidence: 'high', source: 'cloud', coverage: { validSales: 76, complete: true },
        goalSimulation: {
          type: 'revenue', targetValue: 100000, ready: true, state: 'remaining', gap: 24000,
          gapPercent: 24, excess: 0, progress: 0.76, revenueGap: 24000,
          currentSales: 76000, currentTickets: 76, currentAverageTicket: 1000,
          requiredAdditionalTicketsAtCurrentTicket: 24, requiredAverageTicketAtCurrentTicketCount: 1315.79,
          assumptions: [], limitations: []
        },
        calculations: [], assumptions: [], limitations: [], recommendations: [], scenarios: []
      },
      providerCalled: false, quotaOutcome: 'not_consumed', usageStatus: null
    });

    renderCenter();
    fireEvent.change(screen.getByRole('textbox', { name: 'Pregunta libre' }), {
      target: { value: '¿Cuánto necesito vender para facturar $100,000?' }
    });
    expect(screen.getByRole('combobox', { name: 'Tipo de meta' })).toHaveValue('revenue');
    expect(screen.getByLabelText('Valor objetivo')).toHaveValue(100000);
    expect(screen.getByText(/Las metas describen una brecha matemática/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Valor objetivo'), { target: { value: '120000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));

    await waitFor(() => expect(runtime.runAgent).toHaveBeenCalledTimes(1));
    expect(runtime.runAgent.mock.calls[0][0]).toMatchObject({
      intent: 'goal_simulation', scenario: { goalType: 'revenue', targetValue: 120000 }
    });
    expect(await screen.findByRole('heading', { name: '¿Cuánto necesito vender para facturar $100,000?' })).toBeInTheDocument();
    expect(screen.getByText('Tickets adicionales')).toBeInTheDocument();
    expect(screen.getByText('Ticket requerido')).toBeInTheDocument();
    expect(runtime.getUsage).toHaveBeenCalledTimes(1);
  });

  it('offers explicit what-if percentage presets without guessing a default or consuming quota', () => {
    renderCenter();
    const question = screen.getByRole('textbox', { name: 'Pregunta libre' });
    fireEvent.change(question, { target: { value: '¿Qué pasa si vendo más?' } });
    const presets = screen.getByRole('combobox', { name: 'Cambios rápidos' });
    const custom = screen.getByLabelText('Cambio porcentual');

    expect(presets).toHaveValue('');
    expect(custom).toHaveValue(null);
    expect(screen.getByText(/si escribes un porcentaje en la pregunta/i)).toBeInTheDocument();
    expect(screen.getByText(/es un escenario hipotético/i)).toBeInTheDocument();

    fireEvent.change(presets, { target: { value: '100' } });
    expect(custom).toHaveValue(100);
    expect(presets).toHaveValue('100');

    fireEvent.change(custom, { target: { value: '37' } });
    expect(custom).toHaveValue(37);
    expect(presets).toHaveValue('');

    fireEvent.change(presets, { target: { value: '-50' } });
    expect(custom).toHaveValue(-50);
    expect(runtime.runAgent).not.toHaveBeenCalled();
  });

  it('keeps an incomplete product what-if local, then loads historical products and submits only after correction', async () => {
    runtime.runAgent.mockResolvedValueOnce({
      response: {
        status: 'completed', intent: 'what_if_analysis',
        executiveSummary: 'Producto A: de $100 a $120 (+20%).',
        explanation: 'Se conserva el precio promedio histórico; la simulación no predice demanda.',
        confidence: 'medium', source: 'cloud', coverage: { validSales: 1, complete: false },
        whatIfSimulation: {
          changeType: 'product', changePercent: 20, ready: true, productName: 'Producto A',
          historicalUnits: 2, simulatedUnits: 2.4, averagePrice: 50,
          historicalSales: 100, simulatedSales: 120, currentCost: null, simulatedCost: null,
          currentProfit: null, simulatedProfit: null, profitDelta: null,
          currentMargin: null, simulatedMargin: null, assumptions: [],
          limitations: ['El costo del producto es desconocido; utilidad y margen permanecen no disponibles.']
        },
        calculations: [], assumptions: [], limitations: [], recommendations: [], scenarios: []
      },
      providerCalled: false, quotaOutcome: 'not_consumed', usageStatus: null
    });
    renderCenter();
    fireEvent.change(screen.getByRole('textbox', { name: 'Pregunta libre' }), {
      target: { value: '¿Qué pasa si vendo más de este producto?' }
    });
    const submit = screen.getByRole('button', { name: 'Analizar' });
    fireEvent.click(submit);
    expect(screen.getByRole('heading', { name: 'Hay 2 datos que debes revisar' })).toBeInTheDocument();
    expect(screen.getAllByText(/Introduce el porcentaje de cambio\./).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Selecciona el producto que deseas simular\./).length).toBeGreaterThan(0);
    expect(runtime.runAgent).not.toHaveBeenCalled();
    expect(runtime.loadProducts).not.toHaveBeenCalled();
    expect(runtime.getUsage).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText(/Cambio porcentual/), { target: { value: '20' } });
    await waitFor(() => expect(runtime.loadProducts).toHaveBeenCalledTimes(1));
    expect(runtime.loadProducts.mock.calls[0][0]).toMatchObject({ includeUnknownCosts: true });
    const productPicker = await screen.findByRole('combobox', { name: 'Producto con ventas históricas' });
    await waitFor(() => expect(productPicker).toBeEnabled());
    fireEvent.change(productPicker, { target: { value: 'Producto A' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => expect(runtime.runAgent).toHaveBeenCalledTimes(1));
    expect(runtime.runAgent.mock.calls[0][0]).toMatchObject({
      intent: 'what_if_analysis', scenario: { changeType: 'product', changePercent: 20, productName: 'Producto A' }
    });
    expect(await screen.findAllByRole('heading', { name: '¿Qué pasa si vendo más de este producto?' })).toHaveLength(1);
    expect(screen.getByText('Costo actual')).toBeInTheDocument();
    expect(screen.getByText('Costo simulado')).toBeInTheDocument();
    expect(screen.getByText(/Si el costo es desconocido, la utilidad y el margen permanecen no disponibles/i)).toBeInTheDocument();
    expect(screen.getAllByText('No disponible').length).toBeGreaterThan(0);
  }, 30000);


  it('removes the redundant intent filter and prepares several products before the first analysis', async () => {
    runtime.loadProducts.mockResolvedValueOnce({
      source: 'cloud_final',
      products: [
        { name: 'Producto A', units: 2, netSales: 100, averagePrice: 50, unitCost: 20, costKnown: true },
        { name: 'Producto B', units: 1, netSales: 60, averagePrice: 60, unitCost: 25, costKnown: true }
      ],
      excludedProducts: [
        { name: 'Sin costo', reason: 'sin costo unitario completo para simular utilidad y margen' },
        { name: 'Sin ventas', reason: 'sin ventas válidas o precio histórico suficiente' },
        { name: 'Otro sin costo', reason: 'sin costo unitario completo para simular utilidad y margen' }
      ]
    });
    renderCenter();

    expect(screen.queryByLabelText('Intención')).not.toBeInTheDocument();
    expect(runtime.runAgent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '¿Qué pasa si aumento el precio?' }));
    expect(runtime.loadProducts).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Nuevo precio'), { target: { value: '80' } });
    await waitFor(() => expect(runtime.loadProducts).toHaveBeenCalledTimes(1));
    const productSelect = screen.getByRole('combobox', { name: 'Producto' });
    expect(productSelect).toBeInTheDocument();
    await waitFor(() => expect(productSelect).toBeEnabled());
    expect(screen.getByRole('option', { name: 'Producto A' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Producto B' })).toBeInTheDocument();
    expect(screen.getByText(/2 producto\(s\) elegible\(s\).*sin usar IA ni cuota/i)).toBeInTheDocument();
    expect(screen.getByText('Se excluyeron 2 producto(s): sin costo unitario completo para simular utilidad y margen.')).toBeInTheDocument();
    expect(screen.getByText('Se excluyeron 1 producto(s): sin ventas válidas o precio histórico suficiente.')).toBeInTheDocument();
    expect(runtime.runAgent).not.toHaveBeenCalled();
  });

  it('reloads the complete product selector when the selected period changes', async () => {
    runtime.loadProducts.mockImplementation(async ({ period }) => ({
      source: 'cloud_final',
      products: period.days === 7
        ? [{ name: 'Producto 7 días', units: 1, netSales: 25, averagePrice: 25, unitCost: 10, costKnown: true }]
        : [{ name: 'Producto 30 días', units: 2, netSales: 80, averagePrice: 40, unitCost: 15, costKnown: true }]
    }));

    renderCenter();
    fireEvent.click(screen.getByRole('button', { name: '¿Qué pasa si aumento el precio?' }));
    fireEvent.change(screen.getByLabelText('Nuevo precio'), { target: { value: '80' } });
    await waitFor(() => expect(runtime.loadProducts).toHaveBeenCalledTimes(1));
    expect(runtime.loadProducts.mock.calls[0][0].period).toMatchObject({ days: 30, timezone: 'America/New_York' });

    fireEvent.change(screen.getByRole('combobox', { name: /periodo/i }), { target: { value: '7' } });
    await waitFor(() => expect(runtime.loadProducts).toHaveBeenCalledTimes(2));
    expect(runtime.loadProducts.mock.calls[1][0].period).toMatchObject({ days: 7, timezone: 'America/New_York' });

    const productSelect = screen.getByRole('combobox', { name: 'Producto' });
    expect(productSelect).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Producto 7 días' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Producto 30 días' })).not.toBeInTheDocument();
  });

  it('routes the profitability suggestion to its own internal intent', async () => {
    renderCenter();
    fireEvent.click(screen.getByRole('button', { name: '¿Mi negocio es rentable?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));

    await waitFor(() => expect(runtime.runAgent).toHaveBeenCalledTimes(1));
    expect(runtime.runAgent.mock.calls[0][0]).toMatchObject({ intent: 'profitability_summary' });
  });

  it('routes the assortment suggestion, renders grounded catalogue evidence, and reopens it from history', async () => {
    runtime.runAgent.mockResolvedValueOnce({
      response: {
        status: 'completed',
        executiveSummary: 'El catálogo tiene una concentración visible en Bebidas.',
        answer: 'El catálogo tiene una concentración visible en Bebidas.',
        explanation: 'Los cálculos usan catálogo y ventas internas.',
        confidence: 'medium',
        source: 'mixed',
        intent: 'assortment_analysis',
        coverage: { validSales: 1, costCoverage: null },
        assortment: {
          catalog: { complete: true, productsRead: 2, categoriesRead: 1 },
          health: {
            activeCatalogProducts: 2, inactiveCatalogProducts: 0, soldProducts: 1, unsoldProducts: 1,
            activeCategories: 1, soldCategories: 1, currentSalesCoverageComplete: true,
            previousComparisonAvailable: true,
            concentration: { topProductShare: 0.7, top3ProductShare: 1, topCategoryShare: 1, categoryRevenueCoverage: 1 }
          },
          categoryPerformance: [{ name: 'Bebidas', active: true, netSales: 100, salesShare: 1, activeProducts: 2, soldProducts: 1, unsoldProducts: 1, signals: ['category_growing'] }],
          categoryOpportunities: [],
          dormantProducts: [{ candidateRef: null, name: 'Producto sin movimiento', category: 'Bebidas', activity: 'never_sold_in_window', currentSales: 0, previousSales: 0, availability: 'availability_unknown' }],
          reactivationCandidates: [], opportunityCandidates: [], evidenceKeys: [], minimumUsefulRecommendations: 0,
          currentPeriod: { netSales: 100, units: 2, complete: true }, previousPeriod: { netSales: 80, units: 1, complete: true },
          comparisonAvailable: true, narrativeEligible: false, limitations: []
        },
        calculations: [], assumptions: [], limitations: [], recommendations: [], scenarios: [], aiNarrative: null
      },
      usageStatus: null,
      providerCalled: false,
      quotaOutcome: 'not_consumed'
    });

    renderCenter();
    fireEvent.click(screen.getByRole('button', { name: '¿Dónde tengo oportunidades en mi surtido?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));

    expect(await screen.findByRole('heading', { name: 'El catálogo tiene una concentración visible en Bebidas.' })).toBeInTheDocument();
    expect(runtime.runAgent.mock.calls[0][0]).toMatchObject({ intent: 'assortment_analysis', compare: true });
    expect(screen.getAllByText('Bebidas')).toHaveLength(2);
    expect(screen.getByText('Producto sin movimiento')).toBeInTheDocument();
    expect(screen.getByText('No confirmada')).toBeInTheDocument();
    expect(screen.getByText('Ventas concentradas en el producto principal')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ver respuesta' }));
    expect(screen.getAllByText('Producto sin movimiento')).toHaveLength(2);
  }, 30000);

  it('sends an empty scenario for combos after a price simulation', async () => {
    renderCenter();
    fireEvent.click(screen.getByRole('button', { name: '¿Qué pasa si aumento el precio?' }));
    fireEvent.change(screen.getByLabelText('Nuevo precio'), { target: { value: '120' } });
    await waitFor(() => expect(runtime.loadProducts).toHaveBeenCalledTimes(1));
    const productPicker = screen.getByRole('combobox', { name: 'Producto' });
    await waitFor(() => expect(productPicker).toBeEnabled());
    fireEvent.change(productPicker, { target: { value: 'Producto A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));
    await waitFor(() => expect(runtime.runAgent).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: '¿Qué combos puedo formar?' }));
    await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Producto' })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));
    await waitFor(() => expect(runtime.runAgent).toHaveBeenCalledTimes(2));

    expect(runtime.runAgent.mock.calls[1][0]).toMatchObject({
      intent: 'combo_opportunity',
      compare: false,
      scenario: {}
    });
  });

  it('sends an empty scenario for combos after a promotion simulation', async () => {
    renderCenter();
    fireEvent.click(screen.getByRole('button', { name: '¿Qué promoción puedo simular?' }));
    await waitFor(() => expect(runtime.loadProducts).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole('combobox', { name: 'Producto' }), { target: { value: 'Producto B' } });
    fireEvent.change(screen.getByLabelText('Descuento porcentual'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));
    await waitFor(() => expect(runtime.runAgent).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: '¿Qué combos puedo formar?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));
    await waitFor(() => expect(runtime.runAgent).toHaveBeenCalledTimes(2));
    expect(runtime.runAgent.mock.calls[1][0].scenario).toEqual({});
  });

  it('keeps combo requests empty after switching repeatedly between simulation intents', async () => {
    renderCenter();
    const productPicker = async (name) => {
      const picker = await screen.findByRole('combobox', { name: 'Producto' });
      await waitFor(() => expect(picker).toBeEnabled());
      fireEvent.change(picker, { target: { value: name } });
    };
    const submit = async (count) => {
      fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));
      await waitFor(() => expect(runtime.runAgent).toHaveBeenCalledTimes(count));
    };

    fireEvent.click(screen.getByRole('button', { name: '¿Qué pasa si aumento el precio?' }));
    fireEvent.change(screen.getByLabelText('Nuevo precio'), { target: { value: '120' } });
    await productPicker('Producto A');
    await submit(1);

    fireEvent.click(screen.getByRole('button', { name: '¿Qué promoción puedo simular?' }));
    await productPicker('Producto B');
    fireEvent.change(screen.getByLabelText('Descuento porcentual'), { target: { value: '20' } });
    await submit(2);

    fireEvent.click(screen.getByRole('button', { name: '¿Por qué cambió mi margen?' }));
    expect(screen.getByRole('checkbox', { name: /comparar/i })).toBeChecked();
    await submit(3);

    fireEvent.click(screen.getByRole('button', { name: '¿Qué pasa si aumento el precio?' }));
    fireEvent.change(screen.getByLabelText('Nuevo precio'), { target: { value: '95' } });
    await productPicker('Producto A');
    await submit(4);

    fireEvent.click(screen.getByRole('button', { name: '¿Qué combos puedo formar?' }));
    expect(screen.queryByRole('combobox', { name: 'Producto' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /comparar/i })).not.toBeInTheDocument();
    await submit(5);
    expect(runtime.runAgent.mock.calls[4][0]).toMatchObject({
      intent: 'combo_opportunity',
      compare: false,
      scenario: {}
    });
  });

  it('converts numeric scenario inputs and removes irrelevant fields before submitting', async () => {
    renderCenter();
    fireEvent.click(screen.getByRole('button', { name: '¿Qué pasa si aumento el precio?' }));
    fireEvent.change(screen.getByLabelText('Nuevo precio'), { target: { value: '120' } });
    await waitFor(() => expect(runtime.loadProducts).toHaveBeenCalledTimes(1));
    const product = screen.getByRole('combobox', { name: 'Producto' });
    await waitFor(() => expect(product).toBeEnabled());
    fireEvent.change(product, { target: { value: 'Producto A' } });
    fireEvent.change(screen.getByLabelText('Volumen esperado (opcional)'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));
    await waitFor(() => expect(runtime.runAgent).toHaveBeenCalledTimes(1));
    expect(runtime.runAgent.mock.calls[0][0].scenario).toEqual({
      productName: 'Producto A',
      newPrice: 120,
      historicalVolume: 0
    });

    fireEvent.click(screen.getByRole('button', { name: '¿Qué combos puedo formar?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));
    await waitFor(() => expect(runtime.runAgent).toHaveBeenCalledTimes(2));
    expect(runtime.runAgent.mock.calls[1][0].scenario).toEqual({});
  });

  it('clears scenario fields when the question changes even if the intent stays the same', async () => {
    renderCenter();
    fireEvent.click(screen.getByRole('button', { name: '¿Qué pasa si aumento el precio?' }));
    fireEvent.change(screen.getByLabelText('Nuevo precio'), { target: { value: '120' } });
    await waitFor(() => expect(runtime.loadProducts).toHaveBeenCalledTimes(1));
    const product = screen.getByRole('combobox', { name: 'Producto' });
    await waitFor(() => expect(product).toBeEnabled());
    fireEvent.change(product, { target: { value: 'Producto A' } });
    fireEvent.change(screen.getByLabelText('Nuevo precio'), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText('Volumen esperado (opcional)'), { target: { value: '4' } });
    expect(product.value).toBe('Producto A');
    expect(screen.getByLabelText('Nuevo precio').value).toBe('120');
    expect(screen.getByLabelText('Volumen esperado (opcional)').value).toBe('4');

    fireEvent.change(screen.getByRole('textbox', { name: 'Pregunta libre' }), {
      target: { value: '¿Cómo afectaría cambiar el precio?' }
    });
    expect(screen.getByRole('combobox', { name: 'Producto' }).value).toBe('');
    expect(screen.getByLabelText('Nuevo precio').value).toBe('');
    expect(screen.getByLabelText('Volumen esperado (opcional)').value).toBe('');
  });

  it('shows only contextual filters and defaults comparison to explain_change', async () => {
    renderCenter();
    fireEvent.click(screen.getByRole('button', { name: '¿Qué combos puedo formar?' }));
    expect(screen.queryByRole('combobox', { name: 'Producto' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /comparar/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '¿Por qué cambió mi margen?' }));
    const comparison = screen.getByRole('checkbox', { name: /comparar/i });
    expect(comparison).toBeChecked();
    fireEvent.click(comparison);
    fireEvent.click(screen.getByRole('button', { name: '¿Qué combos puedo formar?' }));
    expect(screen.queryByRole('checkbox', { name: /comparar/i })).not.toBeInTheDocument();
  });

  it('shows the deterministic combo report alongside optional AI narrative', async () => {
    runtime.runAgent.mockResolvedValueOnce({
      response: {
        status: 'completed',
        intent: 'combo_opportunity',
        executiveSummary: 'Producto A y Producto B aparecen juntos en 4 tickets.',
        explanation: 'El dato determinístico usa 10 tickets válidos.',
        confidence: 'medium',
        source: 'cloud',
        coverage: { validSales: 10, productsIncluded: 2, costCoverage: 1, itemsComplete: true, paginationComplete: true, sourceComplete: true },
        facts: [],
        calculations: [{ label: 'Tickets compartidos', value: 4, formula: 'Conteo determinístico', formattedValue: '4' }],
        assumptions: [],
        limitations: ['La oportunidad describe correlación histórica y no garantiza demanda futura.'],
        recommendations: [],
        scenarios: [],
        comboOpportunities: [{
          products: ['Producto A', 'Producto B'],
          tickets: 4,
          ticketPercentage: 0.4,
          averageJointSale: 150,
          profit: 60,
          margin: 0.4,
          costStatus: 'complete',
          costCoverage: 1,
          confidence: 'medium',
          opportunity: 'Aparecen juntos en ventas válidas.'
        }],
        aiNarrative: { status: 'available', executiveSummary: 'La IA describe cuatro tickets.' }
      },
      usageStatus: null,
      providerCalled: false
    });
    renderCenter();
    fireEvent.click(screen.getByRole('button', { name: '¿Qué combos puedo formar?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));

    await waitFor(() => expect(screen.getByRole('row', { name: /Producto A \+ Producto B/ })).toBeInTheDocument());
    const comboRow = screen.getByRole('row', { name: /Producto A \+ Producto B/ });
    expect(comboRow).toHaveTextContent('4');
    expect(comboRow).toHaveTextContent(/40%/);
    expect(comboRow).toHaveTextContent(/150/);
    expect(comboRow).toHaveTextContent(/60/);
    expect(comboRow).toHaveTextContent(/Completa · 100%/);
    expect(screen.getByText('El dato determinístico usa 10 tickets válidos.')).toBeInTheDocument();
    expect(screen.getByText('Limitación: la oportunidad muestra correlación histórica de tickets; no garantiza demanda futura.')).toBeInTheDocument();
    expect(screen.getByText('La IA describe cuatro tickets.')).toBeInTheDocument();
  });

  it('puts Lía’s direct answer and grounded actions before the deterministic evidence', async () => {
    runtime.runAgent.mockResolvedValueOnce({
      response: {
        status: 'completed',
        intent: 'sales_growth',
        executiveSummary: 'El periodo registró ventas por $300.',
        explanation: 'El producto aparece con ventas en el periodo comparable y hay espacio para probar una mejor exposición.',
        confidence: 'medium',
        source: 'cloud',
        coverage: { validSales: 3, costCoverage: 1 },
        facts: [],
        calculations: [{ label: 'Ventas del periodo', value: 300, formula: 'suma de ventas válidas' }],
        assumptions: [],
        limitations: [],
        recommendations: [],
        scenarios: [],
        opportunityCandidates: [{
          key: 'product:Producto A',
          type: 'product',
          focus: { type: 'product', key: 'Producto A' },
          recommendationType: 'growth_experiment',
          evidenceKeys: ['product:Producto A']
        }],
        minimumUsefulRecommendations: 1,
        aiNarrative: {
          status: 'available',
          directAnswer: 'Prueba dar mayor visibilidad a Producto A y mide si aumentan sus unidades vendidas.',
          explanation: 'Producto A cuenta con una señal observada que permite hacer una prueba pequeña.',
          confidence: 'medium',
          recommendations: [{
            title: 'Probar más visibilidad para Producto A',
            focus: { type: 'product', key: 'Producto A' },
            recommendationType: 'growth_experiment',
            explanation: 'Producto A registró ventas en el periodo y puede evaluarse con una prueba controlada.',
            action: 'Destaca Producto A en una ubicación visible durante una semana.',
            measurement: 'Compara las unidades de Producto A con la semana comparable.',
            expectedImpact: 'Permitirá observar si la exposición coincide con más unidades.',
            priority: 'high',
            evidenceKeys: ['product:Producto A'],
            requiresConfirmation: true
          }]
        }
      },
      providerCalled: true,
      quotaOutcome: 'consumed',
      usageStatus: { used: 3, limit: 15, remaining: 12 }
    });

    renderCenter();
    fireEvent.change(screen.getByRole('textbox', { name: 'Pregunta libre' }), { target: { value: '¿Cómo puedo aumentar mis ventas?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));

    const answer = await screen.findByRole('heading', {
      name: 'Prueba dar mayor visibilidad a Producto A y mide si aumentan sus unidades vendidas.'
    });
    const action = screen.getByText('Destaca Producto A en una ubicación visible durante una semana.');
    const measurement = screen.getByText('Compara las unidades de Producto A con la semana comparable.');
    const evidence = screen.getByRole('heading', { name: 'Datos que respaldan esta respuesta' });
    const appearsBefore = (earlier, later) => Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);

    expect(screen.getByText('Respuesta de Lía')).toBeInTheDocument();
    expect(appearsBefore(answer, action)).toBe(true);
    expect(appearsBefore(action, measurement)).toBe(true);
    expect(appearsBefore(measurement, evidence)).toBe(true);
    expect(screen.getByText(/Análisis calculado por Lanzo:/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cálculos' })).toBeInTheDocument();
  });

  it('does not load sales or invoke the agent for identity and out-of-scope questions', async () => {
    const networkRequest = vi.fn();
    vi.stubGlobal('fetch', networkRequest);
    renderCenter();
    expect(runtime.loadProducts).not.toHaveBeenCalled();
    const question = screen.getByRole('textbox', { name: 'Pregunta libre' });
    const outOfScopeCases = [
      ['¿Cómo te llamas?', 'Soy Lía, la asistente de análisis comercial de Lanzo.'],
      ['¿Qué hay en inventario?', 'Soy Lía, la asistente de análisis comercial de Lanzo. Esa consulta corresponde a otro módulo de Lanzo. En este espacio puedo ayudarte con ventas y rentabilidad.'],
      ['¿Qué clima hará mañana?', 'Soy Lía, la asistente de análisis comercial de Lanzo. Esa pregunta queda fuera de mi función, pero puedo ayudarte a entender ventas, rentabilidad y escenarios comerciales de tu negocio.']
    ];
    for (const [prompt, answer] of outOfScopeCases) {
      fireEvent.change(question, { target: { value: prompt } });
      fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));
      await waitFor(() => expect(screen.getByRole('heading', { name: answer })).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: 'Descargar reporte completo' })).not.toBeInTheDocument();
      expect(screen.queryByText('Nivel de confianza')).not.toBeInTheDocument();
      expect(screen.queryByText('Ventas válidas')).not.toBeInTheDocument();
    }
    expect(runtime.loadProducts).not.toHaveBeenCalled();
    expect(runtime.runAgent).not.toHaveBeenCalled();
    expect(networkRequest).not.toHaveBeenCalled();
    expect(screen.queryByText(/Actualiza el Preview/i)).not.toBeInTheDocument();
  });

  it('shows the competitive evidence form and keeps a missing-evidence query local', async () => {
    renderCenter();
    const question = screen.getByRole('textbox', { name: 'Pregunta libre' });
    fireEvent.change(question, { target: { value: 'Ayúdame a analizar mi competencia.' } });
    expect(screen.getByRole('heading', { name: 'Agrega evidencia para comparar' })).toBeInTheDocument();
    expect(screen.getByText(/Una URL sirve como referencia, pero Lanzo no consulta automáticamente su contenido/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Añade al menos un competidor para comparar/);
    expect(runtime.loadProducts).not.toHaveBeenCalled();
    expect(runtime.runAgent).not.toHaveBeenCalled();
  });

  it('explains a missing free question only after submit and keeps quota and history untouched', () => {
    renderCenter();
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));

    const question = screen.getByRole('textbox', { name: 'Pregunta libre' });
    expect(screen.getAllByText(/Escribe una pregunta antes de iniciar el análisis\./).length).toBeGreaterThan(0);
    expect(question).toHaveAttribute('aria-invalid', 'true');
    expect(question.getAttribute('aria-describedby')).toContain('lia-question-required');
    expect(document.activeElement).toBe(question);
    expect(runtime.runAgent).not.toHaveBeenCalled();
    expect(runtime.getUsage).toHaveBeenCalledTimes(1);
    expect(runtime.historyStorage.size).toBe(0);
  });

  it('submits a reviewed competitive evidence snapshot to the local analysis route', async () => {
    renderCenter();
    fireEvent.change(screen.getByRole('textbox', { name: 'Pregunta libre' }), {
      target: { value: '¿Mis precios son competitivos?' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Añadir competidor' }));
    fireEvent.change(screen.getByLabelText('Nombre comercial'), { target: { value: 'Mercado Uno' } });
    fireEvent.change(screen.getByLabelText('Fecha observada'), { target: { value: new Date().toISOString().slice(0, 10) } });
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Café Sierra' } });
    fireEvent.change(screen.getByLabelText('Precio (opcional)'), { target: { value: '39' } });
    fireEvent.change(screen.getByLabelText('Moneda'), { target: { value: 'MXN' } });
    fireEvent.change(screen.getByLabelText('Unidad o presentación'), { target: { value: '500 ml' } });
    fireEvent.change(screen.getByLabelText('Condición de precio'), { target: { value: 'regular' } });
    fireEvent.change(screen.getByLabelText('Impuestos'), { target: { value: 'included' } });
    fireEvent.change(screen.getByLabelText('Envío'), { target: { value: 'not_applicable' } });
    fireEvent.click(screen.getByLabelText(/Confirmo que el nombre corresponde al mismo producto/));
    expect(screen.getByText(/Revisar 1 observación/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));
    await waitFor(() => expect(runtime.runAgent).toHaveBeenCalledTimes(1));
    expect(runtime.runAgent.mock.calls[0][0]).toMatchObject({
      intent: 'competitive_analysis',
      competitiveEvidence: {
        competitors: [{
          name: 'Mercado Uno',
          observations: [{ name: 'Café Sierra', price: '39', comparableConfirmed: true }]
        }]
      }
    });
    expect(runtime.loadProducts).not.toHaveBeenCalled();
  });

  it('summarizes competitive field errors, focuses their controls, and updates the QA count as fields are fixed', async () => {
    renderCenter();
    fireEvent.change(screen.getByRole('textbox', { name: 'Pregunta libre' }), {
      target: { value: '¿Mis precios son competitivos?' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Añadir competidor' }));
    fireEvent.change(screen.getByLabelText('Nombre comercial'), { target: { value: 'Mercado Uno' } });
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Café Sierra' } });
    fireEvent.change(screen.getByLabelText('Precio (opcional)'), { target: { value: '39' } });
    fireEvent.click(screen.getByRole('button', { name: 'Añadir observación' }));
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));

    expect(screen.getByRole('heading', { name: 'Hay 3 datos que debes revisar' })).toBeInTheDocument();
    expect(screen.getAllByText(/Selecciona la fecha en que observaste esta información\./).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Indica la moneda del precio, por ejemplo MXN\./).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Escribe el nombre del producto o servicio\./).length).toBeGreaterThan(0);
    expect(screen.queryByText(/competitors\.0\./)).not.toBeInTheDocument();
    const date = screen.getByLabelText(/Fecha observada/);
    expect(date).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById(date.getAttribute('aria-describedby'))).toHaveTextContent('Selecciona la fecha');
    expect(document.activeElement).toBe(date);
    expect(runtime.runAgent).not.toHaveBeenCalled();
    expect(runtime.loadProducts).not.toHaveBeenCalled();
    expect(runtime.getUsage).toHaveBeenCalledTimes(1);
    expect(runtime.historyStorage.size).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: /Observación 1 → Moneda/ }));
    const currency = document.activeElement;
    expect(currency).toHaveAttribute('id', expect.stringContaining('-currency'));
    expect(document.activeElement).toBe(currency);
    fireEvent.change(date, { target: { value: new Date().toISOString().slice(0, 10) } });
    expect(screen.getByRole('heading', { name: 'Hay 2 datos que debes revisar' })).toBeInTheDocument();
    expect(date).not.toHaveAttribute('aria-invalid');

    fireEvent.change(currency, { target: { value: 'MXN' } });
    expect(screen.getByRole('heading', { name: 'Hay 1 dato que debes revisar' })).toBeInTheDocument();
    const missingObservationName = document.querySelector('[aria-invalid="true"][id$="-name"]');
    expect(missingObservationName).toBeInTheDocument();
    fireEvent.change(missingObservationName, { target: { value: 'Pan de caja' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));
    await waitFor(() => expect(runtime.runAgent).toHaveBeenCalledTimes(1));
    expect(runtime.runAgent.mock.calls[0][0]).toMatchObject({ intent: 'competitive_analysis' });
  }, 30000);

  it('maps all six suggested questions to supported intents', async () => {
    renderCenter();
    const expected = [
      ['¿Mi negocio es rentable?', 'profitability_summary'],
      ['¿Por qué cambió mi margen?', 'explain_change'],
      ['¿Qué productos están afectando mi rentabilidad?', 'product_risk'],
      ['¿Qué pasa si aumento el precio?', 'price_simulation'],
      ['¿Qué combos puedo formar?', 'combo_opportunity'],
      ['¿Qué promoción puedo simular?', 'promotion_opportunity']
    ];
    for (const [label, expectedIntent] of expected) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      if (expectedIntent === 'price_simulation') {
        fireEvent.change(screen.getByLabelText('Nuevo precio'), { target: { value: '80' } });
        await waitFor(() => expect(screen.getByRole('option', { name: 'Producto A' })).toBeInTheDocument());
        fireEvent.change(screen.getByLabelText('Producto'), { target: { value: 'Producto A' } });
      }
      if (expectedIntent === 'promotion_opportunity') {
        await waitFor(() => expect(screen.getByRole('option', { name: 'Producto A' })).toBeInTheDocument());
        fireEvent.change(screen.getByLabelText('Producto'), { target: { value: 'Producto A' } });
      }
      fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));
      await waitFor(() => expect(runtime.runAgent).toHaveBeenCalledTimes(expected.indexOf(expected.find(([item]) => item === label)) + 1));
      expect(runtime.runAgent.mock.calls.at(-1)[0].intent).toBe(expectedIntent);
    }
  });

  it('keeps an incomplete price scenario local until the required product and price are supplied', async () => {
    renderCenter();
    fireEvent.click(screen.getByRole('button', { name: '¿Qué pasa si aumento el precio?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));

    expect(screen.getByRole('heading', { name: 'Hay 2 datos que debes revisar' })).toBeInTheDocument();
    expect(screen.getAllByText(/Introduce el nuevo precio\./).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Selecciona el producto que deseas simular\./).length).toBeGreaterThan(0);
    expect(runtime.runAgent).not.toHaveBeenCalled();
    expect(runtime.loadProducts).not.toHaveBeenCalled();
    expect(runtime.getUsage).toHaveBeenCalledTimes(1);
    expect(runtime.historyStorage.size).toBe(0);
    expect(screen.getByRole('button', { name: 'Descargar reporte completo' })).toBeDisabled();
    expect(screen.queryByText('Narrativa opcional de IA')).not.toBeInTheDocument();
  });

  it('distinguishes a loading product list from an empty period and does not call the provider', async () => {
    let resolveProducts;
    runtime.loadProducts.mockImplementationOnce(() => new Promise((resolve) => { resolveProducts = resolve; }));
    renderCenter();
    fireEvent.click(screen.getByRole('button', { name: '¿Qué pasa si aumento el precio?' }));
    fireEvent.change(screen.getByLabelText('Nuevo precio'), { target: { value: '80' } });

    await waitFor(() => expect(runtime.loadProducts).toHaveBeenCalledTimes(1));
    const picker = screen.getByRole('combobox', { name: 'Producto' });
    expect(picker).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Cargando productos…' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));
    expect(screen.getAllByText(/productos se están cargando/i).length).toBeGreaterThan(0);
    expect(screen.queryByText('Selecciona el producto que deseas simular.')).not.toBeInTheDocument();
    expect(runtime.runAgent).not.toHaveBeenCalled();
    expect(runtime.getUsage).toHaveBeenCalledTimes(1);

    resolveProducts({ products: [] });
    expect(await screen.findByRole('option', { name: 'No hay productos disponibles en este periodo' })).toBeInTheDocument();
    expect(screen.getAllByText('No hay productos disponibles en este periodo.').length).toBeGreaterThan(0);
    expect(runtime.runAgent).not.toHaveBeenCalled();
  });

  it('shows a product list load failure separately and retries the catalogue request', async () => {
    runtime.loadProducts
      .mockRejectedValueOnce(new Error('catalog failed'))
      .mockResolvedValueOnce({ products: [{ name: 'Producto A', units: 1, netSales: 20, averagePrice: 20 }] });
    renderCenter();
    fireEvent.click(screen.getByRole('button', { name: '¿Qué pasa si aumento el precio?' }));
    fireEvent.change(screen.getByLabelText('Nuevo precio'), { target: { value: '80' } });

    expect(await screen.findByText('No se pudieron preparar los productos de este periodo.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(runtime.loadProducts).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('option', { name: 'Producto A' })).toBeInTheDocument();
    expect(screen.queryByText('No se pudieron preparar los productos de este periodo.')).not.toBeInTheDocument();
  });

  it('marks a selected product unavailable after its period catalog changes', async () => {
    runtime.loadProducts.mockImplementation(async ({ period }) => ({
      products: period.days === 7
        ? [{ name: 'Producto B', units: 1, netSales: 20, averagePrice: 20 }]
        : [{ name: 'Producto A', units: 1, netSales: 30, averagePrice: 30 }]
    }));
    renderCenter();
    fireEvent.click(screen.getByRole('button', { name: '¿Qué pasa si aumento el precio?' }));
    fireEvent.change(screen.getByLabelText('Nuevo precio'), { target: { value: '80' } });
    await waitFor(() => expect(runtime.loadProducts).toHaveBeenCalledTimes(1));
    const picker = screen.getByRole('combobox', { name: 'Producto' });
    await waitFor(() => expect(picker).toBeEnabled());
    fireEvent.change(picker, { target: { value: 'Producto A' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Periodo' }), { target: { value: '7' } });
    await waitFor(() => expect(runtime.loadProducts).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('option', { name: 'Producto A · no disponible en este periodo' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));
    expect(screen.getAllByText('Este producto no está disponible en el periodo. Selecciona otro producto.').length).toBeGreaterThan(0);
    expect(runtime.runAgent).not.toHaveBeenCalled();
    expect(runtime.getUsage).toHaveBeenCalledTimes(1);
    expect(runtime.historyStorage.size).toBe(0);
  });

  it('shows goal field errors together, keeps the correction local, then analyzes after correction', async () => {
    renderCenter();
    fireEvent.change(screen.getByRole('textbox', { name: 'Pregunta libre' }), {
      target: { value: 'Quiero llegar a una meta' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));

    expect(screen.getByRole('heading', { name: 'Hay 2 datos que debes revisar' })).toBeInTheDocument();
    expect(screen.getAllByText(/Selecciona qué meta quieres alcanzar\./).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Introduce un valor objetivo mayor que cero\./).length).toBeGreaterThan(0);
    expect(runtime.runAgent).not.toHaveBeenCalled();
    expect(runtime.loadProducts).not.toHaveBeenCalled();
    expect(runtime.getUsage).toHaveBeenCalledTimes(1);
    expect(runtime.historyStorage.size).toBe(0);

    fireEvent.change(screen.getByRole('combobox', { name: /Tipo de meta/ }), { target: { value: 'gross_margin' } });
    fireEvent.change(screen.getByLabelText(/Margen objetivo/), { target: { value: '100' } });
    expect(screen.getAllByText('El margen objetivo debe ser inferior al 100%.').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText(/Margen objetivo/), { target: { value: '35' } });
    expect(screen.queryByRole('heading', { name: /datos que debes revisar/ })).not.toBeInTheDocument();
    const analyzeButton = screen.getByRole('button', { name: 'Analizar' });
    expect(analyzeButton).toBeEnabled();
    expect(document.getElementById('sales-agent-goal-target').checkValidity()).toBe(true);
    fireEvent.click(analyzeButton);

    await waitFor(() => expect(runtime.runAgent).toHaveBeenCalledTimes(1));
    expect(runtime.runAgent.mock.calls[0][0]).toMatchObject({
      intent: 'goal_simulation', scenario: { goalType: 'gross_margin', targetValue: 35 }
    });
  });

  it('uses the safe UI error and keeps technical details out of the visible message', async () => {
    runtime.runAgent.mockRejectedValueOnce(Object.assign(new Error('contract details'), {
      code: 'INVALID_REQUEST',
      statusCode: 400,
      originalError: { requestId: 'request-1', cause: 'stale scenario' }
    }));
    renderCenter();
    fireEvent.click(screen.getByRole('button', { name: '¿Mi negocio es rentable?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));
    await waitFor(() => expect(screen.getByText('No pudimos procesar esta consulta. Revisa las opciones seleccionadas e inténtalo nuevamente.')).toBeInTheDocument());
    expect(screen.queryByText(/Actualiza el Preview|request-1|stale scenario/i)).not.toBeInTheDocument();
  });

});
