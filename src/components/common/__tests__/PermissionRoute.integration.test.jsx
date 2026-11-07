// @vitest-environment jsdom
import { grantTestActor, tenantState } from '../../../services/auth/__tests__/actorAccessTestHarness';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const app = vi.hoisted(() => ({ state: null }));
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector(app.state)
}));

import PermissionRoute from '../PermissionRoute';
import SettingsRoute from '../SettingsRoute';
import EcommercePortalRoute from '../EcommercePortalRoute';
import SalesReportsRoute from '../SalesReportsRoute';
import CommercialAIAgentsRoute from '../../ai/CommercialAIAgentsRoute';
import EcommerceOrdersRoute from '../../ecommerce/orders/EcommerceOrdersRoute';
import { actorRuntimeController } from '../../../services/auth/actorRuntimeController';
import { ROUTE_PERMISSIONS } from '../../../services/auth/routePermissions';

const mounted = vi.fn();
function ProtectedPage() { mounted(); return <div>Protected content</div>; }
const route = (path, Guard = PermissionRoute) => (
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path={path} element={<Guard permission={ROUTE_PERMISSIONS[path]}><ProtectedPage /></Guard>} />
    </Routes>
  </MemoryRouter>
);

const signInStaff = (permissions = { pos: true }) => {
  app.state = {
    currentDeviceRole: 'staff',
    currentAdminUser: null,
    currentStaffUser: { id: 'staff-a', permissions },
    licenseDetails: { valid: true, features: {
      ecommerce_portal_enabled: true, ecommerce_order_inbox: true, ai_agents: true
    } }
  };
  grantTestActor({ permissions });
};

beforeEach(() => {
  vi.useRealTimers();
  tenantState.current = { opaqueId: 'tenant-a', databaseName: 'LanzoDB_t_tenant-a', generation: 1 };
  mounted.mockClear();
  signInStaff();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('direct URLs and protected component mounting', () => {
  it('mounts POS for an authenticated POS-only Staff', () => {
    render(route('/'));
    expect(screen.getByText('Protected content')).toBeInTheDocument();
  });

  it.each([
    ['/caja', PermissionRoute], ['/productos', PermissionRoute], ['/clientes', PermissionRoute],
    ['/configuracion', SettingsRoute], ['/portal-online', EcommercePortalRoute],
    ['/ventas', SalesReportsRoute], ['/pedidos-online', EcommerceOrdersRoute],
    ['/agentes-ia', CommercialAIAgentsRoute]
  ])('allows a confirmed Admin on enabled route %s', (path, Guard) => {
    app.state.currentDeviceRole = 'admin';
    app.state.currentAdminUser = { id: 'owner' };
    app.state.currentStaffUser = null;
    grantTestActor({ actorType: 'admin', actorId: 'owner' });
    render(route(path, Guard));
    expect(screen.getByText('Protected content')).toBeInTheDocument();
  });

  it.each([
    ['/caja', PermissionRoute], ['/productos', PermissionRoute], ['/clientes', PermissionRoute],
    ['/pedidos', PermissionRoute], ['/configuracion', SettingsRoute],
    ['/portal-online', EcommercePortalRoute], ['/ventas', SalesReportsRoute],
    ['/pedidos-online', EcommerceOrdersRoute], ['/agentes-ia', CommercialAIAgentsRoute]
  ])('never mounts denied URL %s for POS-only Staff', (path, Guard) => {
    render(route(path, Guard));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(mounted).not.toHaveBeenCalled();
  });

  it.each(['products', 'inventory'])('keeps Products OR access for %s alone', (permission) => {
    signInStaff({ [permission]: true });
    render(route('/productos'));
    expect(mounted).toHaveBeenCalled();
  });

  it.each([
    [{ settings: true, ecommerce: false }, true],
    [{ settings: false, ecommerce: true }, true],
    [{ settings: true, ecommerce: true }, false]
  ])('denies the portal for insufficient permissions/plan %j %s', (permissions, feature) => {
    signInStaff(permissions);
    app.state.licenseDetails.features.ecommerce_portal_enabled = feature;
    render(route('/portal-online', EcommercePortalRoute));
    expect(mounted).not.toHaveBeenCalled();
  });

  it('allows Portal only with both Staff permissions and its commercial feature', () => {
    signInStaff({ settings: true, ecommerce: true });
    render(route('/portal-online', EcommercePortalRoute));
    expect(mounted).toHaveBeenCalled();
  });

  it('denies missing/invalid permission even to Admin', () => {
    app.state.currentDeviceRole = 'admin';
    app.state.currentAdminUser = { id: 'owner' };
    grantTestActor({ actorType: 'admin', actorId: 'owner' });
    render(<MemoryRouter><PermissionRoute><ProtectedPage /></PermissionRoute></MemoryRouter>);
    expect(mounted).not.toHaveBeenCalled();
  });

  it('does not mount while authentication or handoff is unfinished', () => {
    actorRuntimeController.lock();
    actorRuntimeController.beginAuthentication({ actorType: 'staff' });
    const view = render(route('/'));
    expect(mounted).not.toHaveBeenCalled();
    act(() => actorRuntimeController.beginHandoffCheck());
    view.rerender(route('/'));
    expect(mounted).not.toHaveBeenCalled();
  });

  it('unmounts Admin on logout and grants no inherited rights during Admin → Staff → Admin', () => {
    app.state.currentDeviceRole = 'admin';
    app.state.currentAdminUser = { id: 'owner' };
    grantTestActor({ actorType: 'admin', actorId: 'owner' });
    const view = render(route('/caja'));
    expect(screen.getByText('Protected content')).toBeInTheDocument();
    act(() => actorRuntimeController.lock('logout'));
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    mounted.mockClear();
    act(() => signInStaff());
    view.rerender(route('/caja'));
    expect(mounted).not.toHaveBeenCalled();
    app.state.currentDeviceRole = 'admin';
    app.state.currentAdminUser = { id: 'owner' };
    act(() => grantTestActor({ actorType: 'admin', actorId: 'owner' }));
    view.rerender(route('/caja'));
    expect(screen.getByText('Protected content')).toBeInTheDocument();
  });

  it('unmounts an idle Admin page when its offline authorization expires', () => {
    vi.useFakeTimers();
    app.state.currentDeviceRole = 'admin';
    app.state.currentAdminUser = { id: 'owner' };
    grantTestActor({ actorType: 'admin', actorId: 'owner' });
    render(route('/caja'));
    expect(screen.getByText('Protected content')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(60_001));
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it('denies a tenant switched behind the previously granted actor', () => {
    tenantState.current = { opaqueId: 'other', databaseName: 'LanzoDB_t_other', generation: 2 };
    render(route('/'));
    expect(mounted).not.toHaveBeenCalled();
  });
});


describe('safe access-denied destinations', () => {
  it.each([
    [{ pos: true }, '/', 'Ir al punto de venta'],
    [{ products: true }, '/productos', 'Ir a Productos'],
    [{ inventory: true }, '/productos', 'Ir a Productos'],
    [{ customers: true }, '/clientes', 'Ir a Clientes'],
    [{ reports: true }, '/ventas', 'Ir a Ventas'],
    [{ sync: true }, '/configuracion', 'Ir a Configuración'],
    [{ ecommerce: true }, '/pedidos-online', 'Ir a Pedidos Online'],
    [{}, '/acerca-de', 'Ir a Acerca de']
  ])('uses effective permissions %j to offer %s', (permissions, to, label) => {
    signInStaff(permissions);
    render(route('/caja'));
    expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', to);
    expect(mounted).not.toHaveBeenCalled();
  });

  it('does not infer a destination from historical permissions or an unconfirmed identity', () => {
    actorRuntimeController.lock();
    render(route('/caja'));
    expect(screen.getByRole('link')).toHaveAttribute('href', '/acerca-de');
  });

  it('changes its destination immediately on permission revocation and identity handoff', () => {
    const view = render(route('/caja'));
    expect(screen.getByRole('link')).toHaveAttribute('href', '/');
    app.state.currentStaffUser = { ...app.state.currentStaffUser, permissions: { products: true } };
    view.rerender(route('/caja'));
    // Products is stored, but the current runtime has only POS.
    expect(screen.getByRole('link')).toHaveAttribute('href', '/acerca-de');
    act(() => signInStaff({ products: true }));
    view.rerender(route('/caja'));
    expect(screen.getByRole('link')).toHaveAttribute('href', '/productos');
    app.state.currentStaffUser = { id: 'staff-b', permissions: { pos: true } };
    view.rerender(route('/caja'));
    expect(screen.getByRole('link')).toHaveAttribute('href', '/acerca-de');
  });

  it('does not select online orders if the license capability is disabled', () => {
    signInStaff({ ecommerce: true });
    app.state.licenseDetails.features.ecommerce_order_inbox = false;
    render(route('/caja'));
    expect(screen.getByRole('link')).toHaveAttribute('href', '/acerca-de');
  });
});
