// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runtime: null,
  loadStats: vi.fn(),
  loadSales: vi.fn(),
  loadProducts: vi.fn(),
  assistantImporter: null,
  reconcileOrders: vi.fn().mockResolvedValue({ count: 0 }),
  runtimeMounts: { orders: 0, stock: 0, catalog: 0, localAlerts: 0, navbar: 0, ticker: 0, assistant: 0 },
  runtimeUnmounts: { orders: 0, stock: 0, catalog: 0, localAlerts: 0, navbar: 0, ticker: 0, assistant: 0 },
  app: {
    showAssistantBot: true,
    showTicker: false,
    licenseStatus: 'active',
  },
}));

vi.mock('../../../pwa/adminOptionalLazy', async () => {
  const { lazy } = await import('react');

  return {
    createOptionalAdminLazy: (importer) => {
      const trackedImporter = vi.fn(importer);
      mocks.assistantImporter = trackedImporter;
      return lazy(trackedImporter);
    },
  };
});

vi.mock('../../../services/auth/useActorRuntimeSnapshot', () => ({
  useActorRuntimeSnapshot: () => mocks.runtime,
}));

vi.mock('../../../store/useStatsStore', () => ({
  useStatsStore: (selector) => selector({ loadStats: mocks.loadStats }),
}));

vi.mock('../../../store/useSalesStore', () => ({
  useSalesStore: (selector) => selector({ loadRecentSales: mocks.loadSales }),
}));

vi.mock('../../../store/useInventoryCatalogStore', () => ({
  useInventoryCatalogStore: (selector) => selector({ loadInitialProducts: mocks.loadProducts }),
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: Object.assign(
    (selector) => selector(mocks.app),
    {
      // Match the bound Zustand store API consumed by ErrorBoundary and Layout.
      getState: () => mocks.app,
      subscribe: vi.fn(() => () => {}),
    }
  ),
}));

vi.mock('../../../store/useOrderStore', () => ({ useOrderStore: vi.fn() }));
vi.mock('../../../hooks/pos/useActiveOrders', () => ({
  useActiveOrders: (selector) => selector({ reconcileOrphanedOrders: mocks.reconcileOrders }),
}));

vi.mock('../../../services/auth/actorOperationalHandoff', () => ({
  registerActorOperationalActiveOrders: vi.fn(),
  registerActorOperationalOrderStore: vi.fn(),
}));

vi.mock('../../../services/db/dexie', () => ({ db: {}, STORES: {} }));
vi.mock('../../../services/db/utils', () => ({ getAvailableStock: vi.fn() }));
vi.mock('../../../services/sales/inventoryFlow', () => ({ getSortedBatchesForProduct: vi.fn() }));
vi.mock('../../../services/products/commercialVariants', () => ({ isCommercialVariantProduct: vi.fn() }));
vi.mock('../../../config/botContext', () => ({
  GLOBAL_ALERT: { active: true, id: 'test' },
  hasAcknowledgedGlobalAlert: () => false,
  isGlobalAlertEligible: (_alert, { licenseDetails } = {}) => Boolean(
    licenseDetails?.created_at === '2026-03-01T00:00:00.000Z'
  ),
}));

vi.mock('../Navbar', async () => {
  const { useEffect } = await import('react');
  return {
    default: function MockSurface({ isSuppressed }) {
      useEffect(() => {
        mocks.runtimeMounts.navbar += 1;
        return () => { mocks.runtimeUnmounts.navbar += 1; };
      }, []);
      if (isSuppressed) return null;
      return (
        <>
          <div className="mobile-top-bar">Mobile top</div>
          <nav className="mobile-bottom-nav">Mobile bottom</nav>
          <aside className="desktop-sidebar">Desktop sidebar</aside>
        </>
      );
    }
  };
});
vi.mock('../Ticker', async () => {
  const { useEffect } = await import('react');
  return {
    default: function MockSurface({ isSuppressed }) {
      useEffect(() => {
        mocks.runtimeMounts.ticker += 1;
        return () => { mocks.runtimeUnmounts.ticker += 1; };
      }, []);
      return isSuppressed ? null : <div data-testid="ticker">Ticker</div>;
    }
  };
});
vi.mock('../../common/MessageModal', () => ({ default: () => null }));
vi.mock('../../common/PostDowngradeRecoveryBanner', () => ({
  default: ({ isSuppressed }) => (isSuppressed ? null : <div data-testid="recovery-banner" />)
}));
vi.mock('../../common/DataSafetyModal', () => ({ default: () => null }));
vi.mock('../../inventory/LocalInventoryOperationalAlertsRuntime', async () => {
  const { useEffect } = await import('react');
  return { default: function MockSurface() {
    useEffect(() => {
      mocks.runtimeMounts.localAlerts += 1;
      return () => { mocks.runtimeUnmounts.localAlerts += 1; };
    }, []);
    return <div data-testid="local-alerts-runtime" />;
  } };
});
vi.mock('../../ecommerce/orders/EcommerceOrdersRuntime', async () => {
  const { useEffect } = await import('react');
  return { default: function MockSurface() {
    useEffect(() => {
      mocks.runtimeMounts.orders += 1;
      return () => { mocks.runtimeUnmounts.orders += 1; };
    }, []);
    return <div data-testid="orders-runtime" />;
  } };
});
vi.mock('../../ecommerce/EcommercePublishedStockAlertRuntime', async () => {
  const { useEffect } = await import('react');
  return { default: function MockSurface() {
    useEffect(() => {
      mocks.runtimeMounts.stock += 1;
      return () => { mocks.runtimeUnmounts.stock += 1; };
    }, []);
    return <div data-testid="published-stock-runtime" />;
  } };
});
vi.mock('../../ecommerce/EcommerceCatalogSyncRuntime', async () => {
  const { useEffect } = await import('react');
  return { default: function MockSurface() {
    useEffect(() => {
      mocks.runtimeMounts.catalog += 1;
      return () => { mocks.runtimeUnmounts.catalog += 1; };
    }, []);
    return <div data-testid="catalog-runtime" />;
  } };
});
vi.mock('../../common/AssistantBot', async () => {
  const { useEffect } = await import('react');
  return {
    default: function MockSurface({ reportsAllowed, globalAlertEligible, isSuppressed }) {
      useEffect(() => {
        mocks.runtimeMounts.assistant += 1;
        return () => { mocks.runtimeUnmounts.assistant += 1; };
      }, []);
      if (isSuppressed) return null;
      return (
        <div
          data-testid="assistant"
          data-reports-allowed={String(reportsAllowed)}
          data-global-alert={String(globalAlertEligible)}
        />
      );
    }
  };
});

import Layout from '../Layout';
import NotFoundPageForLayoutTest from '../../../pages/NotFoundPage';

const LayoutNavigationControls = () => {
  const navigate = useNavigate();
  return (
    <>
      <main data-testid="valid-route-content">POS</main>
      <button type="button" onClick={() => navigate('/productos')}>Abrir productos</button>
      <button type="button" onClick={() => navigate('/ruta-que-no-existe')}>Abrir 404</button>
    </>
  );
};

const renderLayoutIsolation = () => render(
  <MemoryRouter initialEntries={['/']}>
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<LayoutNavigationControls />} />
        <Route path="productos" element={<LayoutNavigationControls />} />
        <Route path="*" element={<NotFoundPageForLayoutTest />} />
      </Route>
    </Routes>
  </MemoryRouter>
);

const adminRuntime = (generation = 1) => ({
  status: 'granted',
  actorType: 'admin',
  actorId: 'admin-1',
  sessionId: 'admin-session-1',
  permissions: ['*'],
  generation,
});

const staffRuntime = (permissions, generation = 1) => ({
  status: 'granted',
  actorType: 'staff',
  actorId: 'staff-1',
  sessionId: 'staff-session-1',
  permissions,
  generation,
});

const renderLayoutTree = () => (
  <MemoryRouter initialEntries={['/']}>
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<LayoutNavigationControls />} />
        <Route path="productos" element={<main>Productos</main>} />
      </Route>
    </Routes>
  </MemoryRouter>
);
const renderLayout = () => render(renderLayoutTree());

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(mocks.runtimeMounts).forEach((key) => {
    mocks.runtimeMounts[key] = 0;
    mocks.runtimeUnmounts[key] = 0;
  });
  localStorage.clear();
  window.scrollTo = vi.fn();
  HTMLElement.prototype.scrollTo = vi.fn();
  mocks.runtime = adminRuntime();
  mocks.app = {
    showAssistantBot: true,
    showTicker: false,
    licenseStatus: 'active',
  };
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('Layout report authorization', () => {
  it.each(['restaurante', 'apparel'])('shows the general timezone notice for %s businesses', async (businessType) => {
    const user = userEvent.setup();
    mocks.app.licenseDetails = { license_key: 'TEST-PROFILE' };
    mocks.app.companyProfile = { license_key: 'TEST-PROFILE', timezone: null, business_type: businessType };
    mocks.app.currentDeviceRole = 'admin';
    mocks.app.currentAdminUser = { id: 'admin-1' };
    renderLayout();

    expect(screen.getByText('POS')).toBeVisible();
    expect(screen.getAllByRole('complementary', { name: 'Zona horaria pendiente' })).toHaveLength(1);
    expect(screen.getByText('Configura la zona horaria de tu negocio. Es necesaria para algunas funciones que utilizan fechas y horarios')).toBeInTheDocument();
    expect(screen.queryByText(/apartados|apparel/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir a Configuración' })).toHaveAttribute('href', '/configuracion?tab=general');

    await user.click(screen.getByRole('button', { name: 'Cerrar aviso' }));
    expect(screen.queryByRole('complementary', { name: 'Zona horaria pendiente' })).not.toBeInTheDocument();
    expect(mocks.app.companyProfile.timezone).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Abrir productos' }));
    expect(screen.getByText('Productos')).toBeVisible();
    expect(screen.queryByRole('complementary', { name: 'Zona horaria pendiente' })).not.toBeInTheDocument();
  });

  it('shows the banner again for a new session or business and hides it after a valid timezone is confirmed', async () => {
    const user = userEvent.setup();
    mocks.app.licenseDetails = { license_key: 'TEST-PROFILE' };
    mocks.app.companyProfile = { license_key: 'TEST-PROFILE', timezone: 'America/Inexistente' };
    mocks.app.currentDeviceRole = 'admin';
    mocks.app.currentAdminUser = { id: 'admin-1' };
    const view = renderLayout();

    expect(screen.getByRole('complementary', { name: 'Zona horaria pendiente' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cerrar aviso' }));
    expect(screen.queryByRole('complementary', { name: 'Zona horaria pendiente' })).not.toBeInTheDocument();

    mocks.runtime = { ...mocks.runtime, sessionId: 'admin-session-2' };
    view.rerender(renderLayoutTree());
    expect(screen.getByRole('complementary', { name: 'Zona horaria pendiente' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cerrar aviso' }));

    mocks.app.licenseDetails = { license_key: 'OTHER-PROFILE' };
    mocks.app.companyProfile = { license_key: 'OTHER-PROFILE', timezone: null };
    view.rerender(renderLayoutTree());
    expect(screen.getByRole('complementary', { name: 'Zona horaria pendiente' })).toBeInTheDocument();

    mocks.app.companyProfile = { ...mocks.app.companyProfile, timezone: 'America/Merida' };
    view.rerender(renderLayoutTree());
    expect(screen.queryByRole('complementary', { name: 'Zona horaria pendiente' })).not.toBeInTheDocument();
  });

  it('does not show the configuration reminder to Staff', () => {
    mocks.runtime = staffRuntime(['products', 'notifications']);
    mocks.app.licenseDetails = { license_key: 'TEST-PROFILE' };
    mocks.app.companyProfile = { license_key: 'TEST-PROFILE', timezone: null };
    mocks.app.currentDeviceRole = 'staff';
    mocks.app.currentAdminUser = null;
    mocks.app.currentStaffUser = { id: 'staff-1', permissions: ['products', 'notifications'] };

    renderLayout();

    expect(screen.queryByRole('complementary', { name: 'Zona horaria pendiente' })).not.toBeInTheDocument();
  });

  it('hides route chrome on 404 without unmounting operational runtimes, then restores it', async () => {
    const user = userEvent.setup();
    mocks.app.showTicker = true;
    renderLayoutIsolation();

    expect(document.querySelector('.mobile-top-bar')).toBeInTheDocument();
    expect(document.querySelector('.mobile-bottom-nav')).toBeInTheDocument();
    expect(document.querySelector('.desktop-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('ticker')).toBeInTheDocument();
    expect(await screen.findByTestId('assistant')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Abrir 404' }));

    expect(screen.getByRole('heading', { name: 'Parece que esta página no existe' })).toBeInTheDocument();
    expect(document.querySelector('.mobile-top-bar')).not.toBeInTheDocument();
    expect(document.querySelector('.mobile-bottom-nav')).not.toBeInTheDocument();
    expect(document.querySelector('.desktop-sidebar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ticker')).not.toBeInTheDocument();
    expect(screen.queryByTestId('assistant')).not.toBeInTheDocument();
    expect(screen.getByTestId('orders-runtime')).toBeInTheDocument();
    expect(screen.getByTestId('published-stock-runtime')).toBeInTheDocument();
    expect(screen.getByTestId('catalog-runtime')).toBeInTheDocument();
    expect(screen.getByTestId('local-alerts-runtime')).toBeInTheDocument();
    expect(mocks.runtimeMounts.orders).toBe(1);
    expect(mocks.runtimeUnmounts.orders).toBe(0);
    expect(mocks.runtimeMounts.assistant).toBe(1);
    expect(mocks.runtimeUnmounts.assistant).toBe(0);
    expect(mocks.loadProducts).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Volver al inicio' }));

    expect(screen.getByTestId('valid-route-content')).toBeInTheDocument();
    expect(document.querySelector('.desktop-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('ticker')).toBeInTheDocument();
    expect(screen.getByTestId('assistant')).toBeInTheDocument();
    expect(mocks.runtimeMounts.orders).toBe(1);
    expect(mocks.runtimeUnmounts.orders).toBe(0);
    expect(mocks.runtimeMounts.assistant).toBe(1);
    expect(mocks.runtimeUnmounts.assistant).toBe(0);
    expect(mocks.loadProducts).toHaveBeenCalledTimes(1);
  });
  it('loads report stores and mounts the assistant for a current Admin', async () => {
    renderLayout();

    await waitFor(() => {
      expect(mocks.loadStats).toHaveBeenCalledTimes(1);
      expect(mocks.loadSales).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByTestId('assistant')).toHaveAttribute('data-reports-allowed', 'true');
    expect(mocks.loadProducts).toHaveBeenCalledTimes(1);
  });

  it('loads operational help for Staff without loading report data', async () => {
    mocks.runtime = staffRuntime(['refunds']);
    renderLayout();

    await waitFor(() => expect(mocks.loadProducts).toHaveBeenCalledTimes(1));
    expect(mocks.loadStats).not.toHaveBeenCalled();
    expect(mocks.loadSales).not.toHaveBeenCalled();
    expect(await screen.findByTestId('assistant')).toHaveAttribute('data-reports-allowed', 'false');
  });

  it('does not infer reports from refunds and recomputes after an actor switch', async () => {
    const view = renderLayout();
    expect(await screen.findByTestId('assistant')).toBeInTheDocument();

    mocks.runtime = staffRuntime(['refunds'], 2);
    view.rerender(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<main>POS</main>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByTestId('assistant')).toHaveAttribute('data-reports-allowed', 'false'));
  });

  it('allows a current Staff actor with reports to load and view report surfaces', async () => {
    mocks.runtime = staffRuntime(['reports']);
    renderLayout();

    await waitFor(() => {
      expect(mocks.loadStats).toHaveBeenCalledTimes(1);
      expect(mocks.loadSales).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByTestId('assistant')).toHaveAttribute('data-reports-allowed', 'true');
  });

  it('fails closed while actor authority is locked', async () => {
    mocks.runtime = {
      status: 'locked',
      actorType: null,
      actorId: null,
      sessionId: null,
      permissions: [],
      generation: 3,
    };
    renderLayout();

    await waitFor(() => expect(mocks.loadProducts).toHaveBeenCalledTimes(1));
    expect(mocks.loadStats).not.toHaveBeenCalled();
    expect(mocks.loadSales).not.toHaveBeenCalled();
    expect(screen.queryByTestId('assistant')).not.toBeInTheDocument();
  });

  it('OFFLINE-LAZY-07 does not import AssistantBot when it is disabled and no global alert is eligible', async () => {
    mocks.app = {
      showAssistantBot: false,
      showTicker: false,
      licenseStatus: 'active',
      licenseDetails: {
        plan_code: 'free_trial',
        created_at: '2026-03-01T00:00:00.000Z',
      },
      currentDeviceRole: 'admin',
      currentStaffUser: null,
    };

    renderLayout();

    await waitFor(() => expect(mocks.loadProducts).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('assistant')).not.toBeInTheDocument();
    expect(mocks.assistantImporter).not.toHaveBeenCalled();
  });

  it('allows an eligible historical alert after the protection notice is acknowledged', async () => {
    localStorage.setItem('lanzo_data_safety_ack', 'true');
    mocks.app = {
      showAssistantBot: false,
      showTicker: false,
      licenseStatus: 'active',
      licenseDetails: {
        plan_code: 'free_trial',
        created_at: '2026-03-01T00:00:00.000Z',
      },
      currentDeviceRole: 'admin',
      currentStaffUser: null,
    };

    renderLayout();

    expect(await screen.findByTestId('assistant')).toHaveAttribute('data-global-alert', 'true');
  });
});
