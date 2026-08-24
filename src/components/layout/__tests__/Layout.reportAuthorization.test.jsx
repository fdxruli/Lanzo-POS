// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runtime: null,
  loadStats: vi.fn(),
  loadSales: vi.fn(),
  loadProducts: vi.fn(),
  reconcileOrders: vi.fn().mockResolvedValue({ count: 0 }),
  app: {
    showAssistantBot: true,
    showTicker: false,
    licenseStatus: 'active',
  },
}));

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
  useAppStore: (selector) => selector(mocks.app),
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
vi.mock('../../../config/botContext', () => ({ GLOBAL_ALERT: { active: false, id: 'test' } }));

vi.mock('../Navbar', () => ({ default: () => <nav>Navbar</nav> }));
vi.mock('../Ticker', () => ({ default: () => <div>Ticker</div> }));
vi.mock('../../common/MessageModal', () => ({ default: () => null }));
vi.mock('../../common/DataSafetyModal', () => ({ default: () => null }));
vi.mock('../../ecommerce/orders/EcommerceOrdersRuntime', () => ({ default: () => null }));
vi.mock('../../ecommerce/EcommercePublishedStockAlertRuntime', () => ({ default: () => null }));
vi.mock('../../ecommerce/EcommerceCatalogSyncRuntime', () => ({ default: () => null }));
vi.mock('../../common/AssistantBot', () => ({
  default: ({ reportsAllowed }) => (
    <div data-testid="assistant" data-reports-allowed={String(reportsAllowed)} />
  ),
}));

import Layout from '../Layout';

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

const renderLayout = () => render(
  <MemoryRouter initialEntries={['/']}>
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<main>POS</main>} />
      </Route>
    </Routes>
  </MemoryRouter>
);

beforeEach(() => {
  vi.clearAllMocks();
  window.scrollTo = vi.fn();
  HTMLElement.prototype.scrollTo = vi.fn();
  mocks.runtime = adminRuntime();
  mocks.app = {
    showAssistantBot: true,
    showTicker: false,
    licenseStatus: 'active',
  };
});

afterEach(() => cleanup());

describe('Layout report authorization', () => {
  it('loads report stores and mounts the assistant for a current Admin', async () => {
    renderLayout();

    await waitFor(() => {
      expect(mocks.loadStats).toHaveBeenCalledTimes(1);
      expect(mocks.loadSales).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByTestId('assistant')).toHaveAttribute('data-reports-allowed', 'true');
    expect(mocks.loadProducts).toHaveBeenCalledTimes(1);
  });

  it('does not query or present report surfaces to Staff without reports', async () => {
    mocks.runtime = staffRuntime(['refunds']);
    renderLayout();

    await waitFor(() => expect(mocks.loadProducts).toHaveBeenCalledTimes(1));
    expect(mocks.loadStats).not.toHaveBeenCalled();
    expect(mocks.loadSales).not.toHaveBeenCalled();
    expect(screen.queryByTestId('assistant')).not.toBeInTheDocument();
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

    await waitFor(() => expect(screen.queryByTestId('assistant')).not.toBeInTheDocument());
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
});
