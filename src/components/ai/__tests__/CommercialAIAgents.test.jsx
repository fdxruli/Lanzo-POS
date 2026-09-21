// @vitest-environment jsdom

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CommercialAIAgentsPage from '../CommercialAIAgentsPage';
import CommercialAIAgentsRoute from '../CommercialAIAgentsRoute';

const runtime = vi.hoisted(() => ({
  licenseDetails: null,
  actorSnapshot: null
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
  });

  afterEach(() => cleanup());

  it('shows both prepared commercial agents without executable actions', () => {
    renderCenter();

    expect(screen.getByRole('heading', { name: 'Agentes IA comerciales' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ventas y rentabilidad' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ecommerce' })).toBeInTheDocument();
    expect(screen.getAllByText('Fundación preparada')).toHaveLength(2);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
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
