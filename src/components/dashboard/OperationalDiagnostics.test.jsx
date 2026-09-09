// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ mountCount: 0 }));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: selector => selector({
    companyProfile: { business_type: 'abarrotes' },
    licenseDetails: { valid: true, plan_code: 'pro' }
  })
}));
vi.mock('../../services/auth/useActorRuntimeSnapshot', () => ({
  useActorRuntimeSnapshot: () => ({ status: 'granted', actorType: 'admin', permissions: [] })
}));
vi.mock('../../services/auth/aiAgentAuthorization', () => ({ canCurrentActorUseAIAgents: () => true }));
vi.mock('../../hooks/diagnostics/useRetailDiagnostics', () => ({
  useRetailDiagnostics: () => ({ isLoading: false, error: null, alerts: [], summary: null, rawData: null })
}));
vi.mock('../../hooks/diagnostics/useRestaurantDiagnostics', () => ({ useRestaurantDiagnostics: () => ({ isLoading: false, error: null, alerts: [], summary: null, rawData: null }) }));
vi.mock('../../hooks/diagnostics/usePharmacyDiagnostics', () => ({ usePharmacyDiagnostics: () => ({ isLoading: false, error: null, alerts: [], summary: null, rawData: null }) }));
vi.mock('./AIAgentDashboard', () => ({
  default: function MockAIAgentDashboard() {
    const [mountId] = useState(() => {
      mocks.mountCount += 1;
      return mocks.mountCount;
    });
    return <div data-testid="ai-dashboard" data-mount-id={mountId}>Reporte conservado</div>;
  }
}));

import OperationalDiagnostics from './OperationalDiagnostics';

describe('OperationalDiagnostics AI mode continuity', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    mocks.mountCount = 0;
  });

  afterEach(() => cleanup());

  it('keeps the AI dashboard mounted while switching modes', async () => {
    render(<OperationalDiagnostics menu={[]} sales={[]} customers={[]} wasteLogs={[]} />);

    screen.getByRole('button', { name: 'Activar agente IA' }).click();
    const dashboard = await screen.findByTestId('ai-dashboard');
    expect(dashboard).toBeVisible();
    const mountId = dashboard.getAttribute('data-mount-id');

    screen.getByRole('button', { name: 'Ver diagnostico operativo' }).click();
    await waitFor(() => expect(screen.getByTestId('ai-dashboard').closest('[hidden]')).not.toBeNull());

    screen.getByRole('button', { name: 'Activar agente IA' }).click();
    await waitFor(() => expect(screen.getByTestId('ai-dashboard')).toBeVisible());
    expect(screen.getByTestId('ai-dashboard')).toHaveAttribute('data-mount-id', mountId);
    expect(mocks.mountCount).toBe(1);
  });
});
