/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  getPage: vi.fn(), initializeApp: vi.fn(),
  state: { licenseDetails: { license_key: 'QA-TENANT-A' }, _isInitializing: false }
}));
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: Object.assign((selector) => selector({
    ...mocks.state, initializeApp: mocks.initializeApp
  }), { getState: () => ({ ...mocks.state, initializeApp: mocks.initializeApp }) })
}));
vi.mock('../../../services/reports/pharmacySanitaryRegister', () => ({
  SANITARY_PAGE_SIZE: 50,
  SANITARY_EXPORT_LIMIT: 2000,
  SANITARY_MOVEMENT_TYPES: ['receipt', 'sale'],
  LEGACY_SANITARY_MOVEMENT_TYPES: ['receipt'],
  buildSanitaryCsv: vi.fn(() => ''),
  collectSanitaryExport: vi.fn(async () => []),
  getSanitaryRegisterPage: mocks.getPage,
  sanitaryIncidences: vi.fn(() => []),
  sanitaryMissingUnitLabel: vi.fn(() => 'unidad no registrada'),
  sanitaryUnitSourceLabel: vi.fn(() => 'Registro de operación')
}));

import '../../../services/auth/__tests__/actorAccessTestHarness';
import { actorRuntimeController } from '../../../services/auth/actorRuntimeController';
import { grantTestActor, tenantState } from '../../../services/auth/__tests__/actorAccessTestHarness';
import { localTenantAccessController } from '../../../services/tenant/localTenantPolicy';
import PharmacySanitaryRegister from '../PharmacySanitaryRegister';

const TENANT = { opaqueId: 'tenant-a', databaseName: 'LanzoDB_t_tenant-a', generation: 1 };
const ROW = {
  id: 'receipt-1', movementType: 'receipt', occurredAt: '2026-11-19T10:00:00.000Z',
  productName: 'Amoxicilina QA', quantity: 1, unit: 'caja', traceStatus: 'complete',
  operationId: 'receipt-1', batchId: 'batch-1', expiryDate: '2027-01-01',
  nameSource: 'sale_snapshot', provenance: 'inventory_entry_event', syncStatus: 'synced'
};
const PAGE = { success: true, rows: [ROW], hasMore: false, nextCursor: null, supportedMovementTypes: ['receipt'] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPage.mockReset();
  mocks.initializeApp.mockReset();
  mocks.initializeApp.mockResolvedValue({ status: 'ready' });
  mocks.state.licenseDetails = { license_key: 'QA-TENANT-A' };
  mocks.state._isInitializing = false;
  tenantState.current = { ...TENANT };
  localTenantAccessController.enable('test_readiness');
  grantTestActor({ actorType: 'admin', actorId: 'owner-a' });
});

afterEach(() => {
  cleanup();
  actorRuntimeController.lock('test_cleanup');
  localTenantAccessController.reset();
  tenantState.current = { ...TENANT };
});

describe('PharmacySanitaryRegister tenant readiness recovery', () => {
  it('retries one read after the same actor, session, and tenant are ready again', async () => {
    tenantState.current = null;
    localTenantAccessController.lock('tenant_readiness_gap');
    mocks.getPage
      .mockRejectedValueOnce(Object.assign(new Error('ACTOR_TENANT_NOT_READY'), { code: 'ACTOR_TENANT_NOT_READY' }))
      .mockResolvedValueOnce(PAGE);

    render(<PharmacySanitaryRegister
      licenseKey="QA-TENANT-A" cloud actorIdentity="admin:owner-a:owner-a-session" timezone="UTC"
    />);

    await waitFor(() => expect(mocks.getPage).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('status')).toHaveTextContent(/verificando de nuevo la sesión y el dispositivo/i);
    expect(screen.queryByText('Amoxicilina QA')).not.toBeInTheDocument();

    act(() => {
      tenantState.current = { ...TENANT };
      localTenantAccessController.grant({ primary: 'QA-TENANT-A', aliases: ['QA-TENANT-A'] });
    });

    expect(await screen.findByText('Amoxicilina QA')).toBeInTheDocument();
    expect(mocks.getPage).toHaveBeenCalledTimes(2);

    act(() => {
      localTenantAccessController.grant({ primary: 'QA-TENANT-A', aliases: ['QA-TENANT-A'] });
    });
    expect(mocks.getPage).toHaveBeenCalledTimes(2);
  });

  it('does not retry the query and clears pending status after the tenant changes', async () => {
    tenantState.current = null;
    localTenantAccessController.lock('tenant_readiness_gap');
    mocks.getPage.mockRejectedValueOnce(
      Object.assign(new Error('ACTOR_TENANT_NOT_READY'), { code: 'ACTOR_TENANT_NOT_READY' })
    );

    render(<PharmacySanitaryRegister
      licenseKey="QA-TENANT-A" cloud actorIdentity="admin:owner-a:owner-a-session" timezone="UTC"
    />);
    await waitFor(() => expect(mocks.getPage).toHaveBeenCalledTimes(1));

    act(() => {
      tenantState.current = { opaqueId: 'tenant-b', databaseName: 'LanzoDB_t_tenant-b', generation: 2 };
      localTenantAccessController.grant({ primary: 'QA-TENANT-B', aliases: ['QA-TENANT-B'] });
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/la sesión o el negocio cambió/i);
    expect(mocks.getPage).toHaveBeenCalledTimes(1);
  });

  it('does not retry after the active license changes', async () => {
    tenantState.current = null;
    localTenantAccessController.lock('tenant_readiness_gap');
    mocks.getPage.mockRejectedValueOnce(
      Object.assign(new Error('ACTOR_TENANT_NOT_READY'), { code: 'ACTOR_TENANT_NOT_READY' })
    );
    render(<PharmacySanitaryRegister
      licenseKey="QA-TENANT-A" cloud actorIdentity="admin:owner-a:owner-a-session" timezone="UTC"
    />);
    await waitFor(() => expect(mocks.getPage).toHaveBeenCalledTimes(1));

    act(() => {
      mocks.state.licenseDetails = { license_key: 'QA-TENANT-B' };
      tenantState.current = { ...TENANT };
      localTenantAccessController.grant({ primary: 'QA-TENANT-A', aliases: ['QA-TENANT-A'] });
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/licencia activa cambió/i);
    expect(mocks.getPage).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /reintentar verificación/i })).not.toBeInTheDocument();
    expect(mocks.initializeApp).not.toHaveBeenCalled();
  });

  it('revalidates the same actor and session once after the same tenant reopens with a new generation', async () => {
    tenantState.current = null;
    localTenantAccessController.lock('tenant_readiness_gap');
    mocks.getPage
      .mockRejectedValueOnce(Object.assign(new Error('ACTOR_TENANT_NOT_READY'), { code: 'ACTOR_TENANT_NOT_READY' }))
      .mockResolvedValueOnce(PAGE);

    render(<PharmacySanitaryRegister
      licenseKey="QA-TENANT-A" cloud actorIdentity="admin:owner-a:owner-a-session" timezone="UTC"
    />);
    await waitFor(() => expect(mocks.getPage).toHaveBeenCalledTimes(1));

    act(() => {
      tenantState.current = { ...TENANT, generation: 2 };
      localTenantAccessController.grant({ primary: 'QA-TENANT-A', aliases: ['QA-TENANT-A'] });
    });

    expect(screen.getByRole('status')).toHaveTextContent(/verificando de nuevo la sesión/i);
    expect(screen.getByRole('button', { name: /reintentar verificación/i })).toBeInTheDocument();
    mocks.initializeApp.mockImplementation(async () => {
      grantTestActor({ actorType: 'admin', actorId: 'owner-a', sessionId: 'owner-a-session' });
      return { status: 'ready' };
    });

    fireEvent.click(screen.getByRole('button', { name: /reintentar verificación/i }));
    expect(await screen.findByText('Amoxicilina QA')).toBeInTheDocument();
    expect(mocks.initializeApp).toHaveBeenCalledTimes(1);
    expect(mocks.initializeApp).toHaveBeenCalledWith({ force: true });
    expect(mocks.getPage).toHaveBeenCalledTimes(2);
  });

  it('does not treat a missing device token as a tenant-readiness recovery', async () => {
    mocks.getPage.mockRejectedValueOnce(new Error('No se pudo validar el dispositivo.'));
    render(<PharmacySanitaryRegister
      licenseKey="QA-TENANT-A" cloud actorIdentity="admin:owner-a:owner-a-session" timezone="UTC"
    />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo validar el dispositivo/i);
    expect(mocks.getPage).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /reintentar verificación/i })).not.toBeInTheDocument();
    expect(mocks.initializeApp).not.toHaveBeenCalled();
  });

  it('discards an in-flight read response when the active tenant changes', async () => {
    let resolvePage;
    mocks.getPage.mockReturnValueOnce(new Promise((resolve) => { resolvePage = resolve; }));
    render(<PharmacySanitaryRegister
      licenseKey="QA-TENANT-A" cloud actorIdentity="admin:owner-a:owner-a-session" timezone="UTC"
    />);
    await waitFor(() => expect(mocks.getPage).toHaveBeenCalledTimes(1));

    act(() => {
      tenantState.current = { opaqueId: 'tenant-b', databaseName: 'LanzoDB_t_tenant-b', generation: 2 };
      grantTestActor({ actorType: 'admin', actorId: 'owner-a', sessionId: 'owner-a-session' });
      localTenantAccessController.grant({ primary: 'QA-TENANT-B', aliases: ['QA-TENANT-B'] });
    });
    await act(async () => { resolvePage(PAGE); });

    expect(screen.queryByText('Amoxicilina QA')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/cambió durante la consulta/i);
  });
});
