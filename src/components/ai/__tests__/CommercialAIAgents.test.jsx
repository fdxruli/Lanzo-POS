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
    expect(screen.getByText('FEATURE_NOT_READY')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Pregunta libre' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analizar' })).toBeDisabled();
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
    expect(screen.getAllByText('Hechos determinísticos')).toHaveLength(2);
    expect(screen.getAllByText('Narrativa opcional de IA')).toHaveLength(2);
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
    expect(screen.getByText(/La narrativa opcional de IA no está disponible/)).toBeInTheDocument();
    expect(screen.getByText(/AI_NARRATIVE_INVALID_JSON/)).toBeInTheDocument();
    expect(await screen.findByText('IA no disponible')).toBeInTheDocument();
    expect(screen.getByText('IA no disponible').closest('article')).toHaveTextContent('Usó cuota: Sí');
    expect(runtime.runAgent).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Ver respuesta' }));
    expect(screen.getAllByText('AI_NARRATIVE_INVALID_JSON').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Utilidad').length).toBeGreaterThanOrEqual(2);
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
        aiNarrative: { executiveSummary: 'Narrativa válida' }
      },
      providerCalled: true,
      quotaOutcome: 'consumed',
      usageStatus: { used: 3, limit: 15, remaining: 12 }
    });

    expect(await screen.findByText('Narrativa válida')).toBeInTheDocument();
    let raw;
    await waitFor(() => {
      raw = runtime.historyStorage.get('commercial-ai-sales-profitability-history-v1');
      expect(raw).toBeTruthy();
    });
    expect(JSON.parse(raw).entries).toHaveLength(1);
    expect(runtime.runAgent).toHaveBeenCalledTimes(1);
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

    await waitFor(() => expect(runtime.loadProducts).toHaveBeenCalledTimes(1));
    const productSelect = screen.getByRole('combobox', { name: 'Producto' });
    expect(productSelect).toBeInTheDocument();
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

  it('sends an empty scenario for combos after a price simulation', async () => {
    renderCenter();
    fireEvent.click(screen.getByRole('button', { name: '¿Qué pasa si aumento el precio?' }));
    await waitFor(() => expect(runtime.loadProducts).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole('combobox', { name: 'Producto' }), { target: { value: 'Producto A' } });
    fireEvent.change(screen.getByLabelText('Nuevo precio'), { target: { value: '120' } });
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
    await productPicker('Producto A');
    fireEvent.change(screen.getByLabelText('Nuevo precio'), { target: { value: '120' } });
    await submit(1);

    fireEvent.click(screen.getByRole('button', { name: '¿Qué promoción puedo simular?' }));
    await productPicker('Producto B');
    fireEvent.change(screen.getByLabelText('Descuento porcentual'), { target: { value: '20' } });
    await submit(2);

    fireEvent.click(screen.getByRole('button', { name: '¿Por qué cambió mi margen?' }));
    expect(screen.getByRole('checkbox', { name: /comparar/i })).toBeChecked();
    await submit(3);

    fireEvent.click(screen.getByRole('button', { name: '¿Qué pasa si aumento el precio?' }));
    await productPicker('Producto A');
    fireEvent.change(screen.getByLabelText('Nuevo precio'), { target: { value: '95' } });
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
    await waitFor(() => expect(runtime.loadProducts).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole('combobox', { name: 'Producto' }), { target: { value: 'Producto A' } });
    fireEvent.change(screen.getByLabelText('Nuevo precio'), { target: { value: '120' } });
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

  it('does not load sales or invoke the agent for identity and out-of-scope questions', async () => {
    const networkRequest = vi.fn();
    vi.stubGlobal('fetch', networkRequest);
    renderCenter();
    expect(runtime.loadProducts).not.toHaveBeenCalled();
    const question = screen.getByRole('textbox', { name: 'Pregunta libre' });
    const outOfScopeCases = [
      ['¿Cómo te llamas?', 'Soy el asistente de Ventas y Rentabilidad de Lanzo POS. Puedo ayudarte con rentabilidad, márgenes, productos problemáticos, precios, promociones y combos.'],
      ['¿Qué hay en inventario?', 'Esta consulta corresponde al módulo de Diagnósticos Operativos. Desde aquí puedo ayudarte únicamente con ventas y rentabilidad.'],
      ['¿Qué clima hará mañana?', 'Puedo ayudarte a analizar ventas y rentabilidad de tu negocio. Prueba con una de las preguntas sugeridas.']
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
      fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));
      await waitFor(() => expect(runtime.runAgent).toHaveBeenCalledTimes(expected.indexOf(expected.find(([item]) => item === label)) + 1));
      expect(runtime.runAgent.mock.calls.at(-1)[0].intent).toBe(expectedIntent);
    }
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
