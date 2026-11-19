/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ state: null }));
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: Object.assign((selector) => selector(mocks.state), { getState: () => mocks.state })
}));

import '../../../services/auth/__tests__/actorAccessTestHarness';
import { actorRuntimeController } from '../../../services/auth/actorRuntimeController';
import { localTenantAccessController } from '../../../services/tenant/localTenantPolicy';
import { tenantState, grantTestActor } from '../../../services/auth/__tests__/actorAccessTestHarness';
import PermissionRoute from '../PermissionRoute';

const TENANT = {
  opaqueId: 'tenant-a', databaseName: 'LanzoDB_t_tenant-a', generation: 1
};

const ProtectedRoutes = () => (
  <MemoryRouter initialEntries={['/caja']}>
    <nav>
      <Link to="/caja">Caja</Link>
      <Link to="/productos">Productos</Link>
      <Link to="/ventas">Ventas</Link>
    </nav>
    <Routes>
      <Route path="/caja" element={<PermissionRoute permission="cash_register"><h1>Caja protegida</h1></PermissionRoute>} />
      <Route path="/productos" element={<PermissionRoute permission="products"><h1>Productos protegidos</h1></PermissionRoute>} />
      <Route path="/ventas" element={<PermissionRoute permission="sales"><h1>Ventas protegidas</h1></PermissionRoute>} />
    </Routes>
  </MemoryRouter>
);

beforeEach(() => {
  tenantState.current = { ...TENANT };
  localTenantAccessController.enable('test_readiness');
  mocks.state = {
    currentDeviceRole: 'admin', currentAdminUser: { id: 'owner-a' }, currentStaffUser: null,
    licenseDetails: { license_key: 'QA-TENANT-A' }, _isInitializing: false,
    initializeApp: vi.fn()
  };
  grantTestActor({ actorType: 'admin', actorId: 'owner-a' });
});

afterEach(() => {
  cleanup();
  actorRuntimeController.lock('test_cleanup');
  localTenantAccessController.reset();
  tenantState.current = { ...TENANT };
});

describe('PermissionRoute with tenant readiness changes', () => {
  it('keeps sections closed during readiness gaps, restores the same grant without reload, and permits repeated navigation', () => {
    render(<ProtectedRoutes />);
    expect(screen.getByRole('heading', { name: 'Caja protegida' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Productos' }));
    expect(screen.getByRole('heading', { name: 'Productos protegidos' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Ventas' }));
    expect(screen.getByRole('heading', { name: 'Ventas protegidas' })).toBeInTheDocument();

    act(() => {
      tenantState.current = null;
      localTenantAccessController.lock('tenant_readiness_gap');
    });
    expect(screen.getByRole('status')).toHaveTextContent(/Verificando acceso a tu sesión/);
    expect(screen.queryByRole('heading', { name: /protegidos/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/No pudimos confirmar el acceso/i)).not.toBeInTheDocument();

    act(() => {
      tenantState.current = { ...TENANT };
      localTenantAccessController.grant({ primary: 'QA-TENANT-A', aliases: ['QA-TENANT-A'] });
    });
    expect(screen.getByRole('heading', { name: 'Ventas protegidas' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Caja' }));
    expect(screen.getByRole('heading', { name: 'Caja protegida' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Productos' }));
    expect(screen.getByRole('heading', { name: 'Productos protegidos' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Ventas' }));
    expect(screen.getByRole('heading', { name: 'Ventas protegidas' })).toBeInTheDocument();
  });
});
