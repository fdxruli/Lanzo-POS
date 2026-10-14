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
  vi.useRealTimers();
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


describe('Ticker Pro cloud inventory summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actorRuntime = adminRuntime;
    mocks.ticker = { catalogSize: 0, alerts: [] };
    mocks.app = createAppState({
      licenseDetails: {
        features: {
          ticker_enabled: true,
          ticker_mode: 'summary',
          local_inventory_alerts: true,
          notification_center: true,
          cloud_notifications: true
        }
      },
      notifications: [{
        id: 'cloud-inventory-1',
        type: 'inventory',
        severity: 'warning',
        title: 'Stock bajo',
        body: 'Producto prueba tiene 3 disponibles; mínimo configurado: 5.',
        metadata: {
          category: 'inventory',
          classification: 'low_stock'
        },
        is_read: false,
        is_archived: false
      }],
      notificationsUnreadCount: 1
    });
  });

  it('uses an inventory-specific cloud summary instead of the device/staff fallback', () => {
    renderTicker();

    const inventorySummary = screen.getByRole('button', {
      name: /Inventario requiere atención.*Centro de Notificaciones/i
    });
    expect(inventorySummary).toBeInTheDocument();
    expect(screen.queryByText(/dispositivos o staff/i)).not.toBeInTheDocument();

    fireEvent.click(inventorySummary);
    expect(mocks.app.openNotificationCenter).toHaveBeenCalledTimes(1);
  });

  it('uses the Inventory ticker preference independently from Operations', () => {
    mocks.app = {
      ...mocks.app,
      notificationPreferences: {
        tickerCategories: {
          inventory: false,
          operations: true
        }
      }
    };

    renderTicker();

    expect(screen.queryByText(/Inventario requiere atención/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Lanzo Nube activo/i)).toBeInTheDocument();
  });

  it('does not let Operations=false suppress an Inventory warning', () => {
    mocks.app = {
      ...mocks.app,
      notificationPreferences: {
        tickerCategories: {
          inventory: true,
          operations: false
        }
      }
    };

    renderTicker();

    expect(screen.getByText(/Inventario requiere atención/i)).toBeInTheDocument();
  });

  it('does not let Inventory=false suppress a cash warning', () => {
    mocks.app = {
      ...mocks.app,
      notificationPreferences: {
        tickerCategories: {
          inventory: false,
          operations: true
        }
      },
      notifications: [{
        id: 'cloud-cash-1',
        type: 'cash',
        severity: 'warning',
        title: 'Caja',
        body: 'Caja requiere atención.',
        metadata: { category: 'cash' },
        is_read: false,
        is_archived: false
      }]
    };

    renderTicker();

    expect(screen.getByText(/alerta de caja cloud/i)).toBeInTheDocument();
    expect(screen.queryByText(/Inventario requiere atención/i)).not.toBeInTheDocument();
  });

  it('keeps critical Inventory visible even when its ticker preference is disabled', () => {
    mocks.app = {
      ...mocks.app,
      notificationPreferences: {
        tickerCategories: {
          inventory: false,
          operations: true
        }
      },
      notifications: [{
        ...mocks.app.notifications[0],
        severity: 'critical'
      }]
    };

    renderTicker();

    expect(screen.getByText(/Inventario requiere atención/i)).toBeInTheDocument();
  });
});


describe('Ticker license lifecycle copy', () => {
  const makeProLicense = ({
    status,
    expiresAt,
    gracePeriodEnds,
    administrativeStatus = 'active',
    isInGrace
  }) => ({
    ...localLicense,
    status,
    license_status: administrativeStatus,
    plan_code: 'pro_monthly',
    plan_name: 'Lanzo Nube',
    valid: true,
    is_entitled: true,
    is_in_grace: isInGrace,
    expires_at: expiresAt,
    grace_period_ends: gracePeriodEnds,
    effective_lifecycle_validation: {
      source: 'server_validation',
      status,
      valid: true,
      is_entitled: true,
      is_in_grace: isInGrace,
      validated_at: '2026-09-20T17:00:00.000Z',
      expires_at: expiresAt,
      grace_period_ends: gracePeriodEnds
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-20T18:00:00.000Z'));
    mocks.actorRuntime = adminRuntime;
    mocks.ticker = { catalogSize: 0, alerts: [] };
  });

  it('shows active PRO without grace or downgrade copy', () => {
    mocks.app = createAppState({
      licenseStatus: 'active',
      licenseDetails: makeProLicense({
        status: 'active',
        expiresAt: '2026-09-30T18:00:00.000Z',
        gracePeriodEnds: '2026-10-07T18:00:00.000Z',
        isInGrace: false
      })
    });

    renderTicker();

    expect(screen.queryByText(/Tu plan Lanzo Nube terminó/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Lanzo Local/i)).not.toBeInTheDocument();
  });

  it('keeps confirmed grace operational and explains the later Lanzo Local transition', () => {
    mocks.app = createAppState({
      licenseStatus: 'grace_period',
      gracePeriodEnds: '2026-09-25T18:00:00.000Z',
      licenseDetails: makeProLicense({
        status: 'grace_period',
        expiresAt: '2026-09-18T18:00:00.000Z',
        gracePeriodEnds: '2026-09-25T18:00:00.000Z',
        isInGrace: true
      })
    });

    renderTicker();

    expect(screen.getAllByText(/Tu plan Lanzo Nube terminó/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Lanzo Local/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/el sistema se bloqueará/i)).not.toBeInTheDocument();
  });

  it('does not present ended grace as operational or promise a later transition', () => {
    vi.setSystemTime(new Date('2026-10-01T18:00:00.000Z'));
    mocks.app = createAppState({
      licenseStatus: 'grace_period',
      gracePeriodEnds: '2026-09-25T18:00:00.000Z',
      licenseDetails: makeProLicense({
        status: 'grace_period',
        expiresAt: '2026-09-18T18:00:00.000Z',
        gracePeriodEnds: '2026-09-25T18:00:00.000Z',
        isInGrace: true
      })
    });

    renderTicker();

    expect(screen.queryByText(/Tu plan Lanzo Nube terminó/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Tu período de gracia continúa/i)).not.toBeInTheDocument();
  });

  it('does not show operational grace copy for an administratively blocked PRO license', () => {
    mocks.app = createAppState({
      licenseStatus: 'grace_period',
      gracePeriodEnds: '2026-09-25T18:00:00.000Z',
      licenseDetails: makeProLicense({
        status: 'grace_period',
        expiresAt: '2026-09-18T18:00:00.000Z',
        gracePeriodEnds: '2026-09-25T18:00:00.000Z',
        administrativeStatus: 'administratively_blocked',
        isInGrace: true
      })
    });

    renderTicker();

    expect(screen.queryByText(/Tu plan Lanzo Nube terminó/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Tu período de gracia continúa/i)).not.toBeInTheDocument();
  });
});
