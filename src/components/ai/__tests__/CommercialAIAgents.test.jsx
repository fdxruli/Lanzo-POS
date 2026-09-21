// @vitest-environment jsdom

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CommercialAIAgentsPage from '../CommercialAIAgentsPage';
import CommercialAIAgentsRoute from '../CommercialAIAgentsRoute';

const runtime = vi.hoisted(() => ({
  licenseDetails: null,
  actorSnapshot: null,
  runAgent: vi.fn()
}));

vi.mock('../../../services/ai/salesProfitabilityAgentService', () => ({
  runSalesProfitabilityAgent: runtime.runAgent
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector({ licenseDetails: runtime.licenseDetails })
}));

vi.mock('../../../services/auth/useActorRuntimeSnapshot', () => ({
  useActorRuntimeSnapshot: () => runtime.actorSnapshot
}));

const entitledLicense = { valid: true, plan_code: 'nube', features: { ai_agents: true } };
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
    runtime.actorSnapshot = boundAdmin;
    runtime.runAgent.mockReset();
    runtime.runAgent.mockResolvedValue({
      response: {
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
      usageStatus: { used: 1, limit: 15 }
    });
  });

  afterEach(() => cleanup());

  it('shows the functional sales agent and keeps ecommerce blocked', () => {
    renderCenter();

    expect(screen.getByRole('heading', { name: 'Agentes IA comerciales' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ventas y rentabilidad' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ecommerce' })).toBeInTheDocument();
    expect(screen.getByText('Disponible')).toBeInTheDocument();
    expect(screen.getByText('FEATURE_NOT_READY')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Pregunta libre' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analizar' })).toBeDisabled();
    expect(runtime.runAgent).not.toHaveBeenCalled();
  });

  it('consumes the analysis path only after the user submits a question', async () => {
    renderCenter();
    fireEvent.change(screen.getByRole('textbox', { name: 'Pregunta libre' }), { target: { value: '¿Por qué bajó mi margen?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }));

    await waitFor(() => expect(runtime.runAgent).toHaveBeenCalledTimes(1));
    expect(runtime.runAgent.mock.calls[0][0]).toMatchObject({ intent: 'explain_change', compare: true });
    expect(screen.getByText('Resumen de prueba')).toBeInTheDocument();
    expect(screen.getByText('Uso: 1 / 15')).toBeInTheDocument();
  });

  it('shows availability for Free/Local without rendering the center or invoking analysis', () => {
    runtime.licenseDetails = { valid: true, plan_code: 'free', features: { ai_agents: false } };
    renderCenter();

    expect(screen.getByText('Los agentes IA comerciales requieren un plan compatible.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ventas y rentabilidad' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('blocks direct access when actor, tenant or device context is not authorized', () => {
    runtime.actorSnapshot = { ...boundAdmin, actorKey: '', tenant: null, deviceRef: null };
    renderCenter();

    expect(screen.getByRole('heading', { name: 'No tienes permiso para acceder a esta sección' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Agentes IA comerciales' })).not.toBeInTheDocument();
  });
});
