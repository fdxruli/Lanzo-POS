// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  app: null,
  actorRuntime: null,
  ticker: { catalogSize: 0, alerts: [] },
  navigate: vi.fn()
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => selector(mocks.app))
}));

vi.mock('../../../hooks/useTickerAlerts', () => ({
  useTickerAlerts: () => mocks.ticker
}));

vi.mock('../../../services/auth/useActorRuntimeSnapshot', () => ({
  useActorRuntimeSnapshot: () => mocks.actorRuntime
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useNavigate: () => mocks.navigate
  };
});

import Ticker from '../Ticker';

const localLicense = {
  features: {
    ticker_enabled: true,
    ticker_mode: 'local',
    local_inventory_alerts: true,
    notification_center: false,
    cloud_notifications: false
  }
};

const createAppState = (overrides = {}) => ({
  licenseStatus: 'active',
  gracePeriodEnds: null,
  licenseDetails: localLicense,
  currentDeviceRole: 'admin',
  currentStaffUser: null,
  canAccess: vi.fn(() => true),
  notifications: [],
  notificationsUnreadCount: 0,
  supportTickets: [],
  notificationPreferences: {},
  openNotificationCenter: vi.fn(),
  loadNotifications: vi.fn(),
  ...overrides
});

const adminRuntime = {
  status: 'granted',
  actorType: 'admin',
  actorId: 'admin-1',
  sessionId: 'admin-session-1',
  permissions: ['*']
};

const stockAlert = {
  id: 'stock-p1',
  incidentId: 'inventory-stock:p1',
  source: 'inventory',
  canonicalOrder: 0,
  severity: 'critical',
  type: 'out-of-stock',
  productId: 'p1',
  productName: 'Producto agotado',
  availableStock: 0,
  minStock: 5,
  urgency: 0
};

const expiryAlert = {
  id: 'expiry-b1',
  incidentId: 'inventory-expiry:b1',
  source: 'inventory',
  canonicalOrder: 0,
  severity: 'critical',
  type: 'expired',
  productId: 'p1',
  productName: 'Producto vencido',
  batchId: 'b1',
  expiryDays: -1,
  urgency: 0
};

const renderTicker = () => render(
  <MemoryRouter>
    <Ticker />
  </MemoryRouter>
);

afterEach(() => {
  cleanup();
});

describe('Ticker inventory priority navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.app = createAppState();
    mocks.actorRuntime = adminRuntime;
    mocks.ticker = { catalogSize: 1, alerts: [stockAlert] };
  });

  it('sends an authorized Admin stock alert to Reabastecimiento', () => {
    renderTicker();

    fireEvent.click(screen.getByRole('link', {
      name: /Sin stock disponible.*Producto agotado/i
    }));

    expect(mocks.navigate).toHaveBeenCalledWith('/ventas?tab=restock');
  });

  it('sends an authorized Admin expiry alert to Caducidad', () => {
    mocks.ticker = { catalogSize: 1, alerts: [expiryAlert] };

    renderTicker();

    fireEvent.click(screen.getByRole('link', {
      name: /Producto vencido.*requiere revisión/i
    }));

    expect(mocks.navigate).toHaveBeenCalledWith('/ventas?tab=expiration');
  });

  it('does not grant /ventas to Staff without reports and falls back to Products when authorized', () => {
    mocks.app = createAppState({
      currentDeviceRole: 'staff',
      currentStaffUser: {
        id: 'staff-products',
        permissions: { reports: false, products: true, inventory: false }
      },
      canAccess: vi.fn((permission) => permission === 'products')
    });
    mocks.actorRuntime = {
      status: 'granted',
      actorType: 'staff',
      actorId: 'staff-products',
      sessionId: 'staff-session-products',
      permissions: { reports: false, products: true, inventory: false }
    };

    renderTicker();
    fireEvent.click(screen.getByRole('link', {
      name: /Sin stock disponible.*Producto agotado/i
    }));

    expect(mocks.navigate).toHaveBeenCalledWith('/productos');
    expect(mocks.navigate).not.toHaveBeenCalledWith('/ventas?tab=restock');
  });

  it('keeps an inventory message non-clickable when the actor has no valid destination', () => {
    mocks.app = createAppState({
      currentDeviceRole: 'staff',
      currentStaffUser: {
        id: 'staff-restricted',
        permissions: { reports: false, products: false, inventory: false }
      },
      canAccess: vi.fn(() => false)
    });
    mocks.actorRuntime = {
      status: 'granted',
      actorType: 'staff',
      actorId: 'staff-restricted',
      sessionId: 'staff-session-restricted',
      permissions: { reports: false, products: false, inventory: false }
    };

    renderTicker();

    const text = screen.getByText(/Sin stock disponible.*Producto agotado/i);
    expect(text.closest('.ticker-item')).not.toHaveAttribute('role');
    fireEvent.click(text);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
