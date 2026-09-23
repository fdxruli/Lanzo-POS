// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const actor = vi.hoisted(() => ({
  runtime: {
    status: 'granted',
    actorType: 'admin',
    actorId: 'admin-1',
    sessionId: 'session-1',
    permissions: ['*']
  }
}));

const localMocks = vi.hoisted(() => ({
  markSeen: vi.fn(),
  refresh: vi.fn(async () => ({ status: 'ready' }))
}));

const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn()
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => routerMocks.navigate
  };
});

vi.mock('../../../services/auth/useActorRuntimeSnapshot', () => ({
  useActorRuntimeSnapshot: () => actor.runtime
}));

vi.mock('../../../services/localInventoryOperationalAlerts', () => ({
  markCurrentLocalInventoryOperationalAlertsSeen: localMocks.markSeen,
  refreshLocalInventoryOperationalAlertsSnapshot: localMocks.refresh
}));

import LocalInventoryOperationalAlertsDrawer from '../LocalInventoryOperationalAlertsDrawer';

const makeStockAlert = (index, type = 'low_stock') => ({
  incidentId: `inventory-stock:p${index}`,
  productId: `p${index}`,
  productName: `Producto stock ${index}`,
  type,
  severity: type === 'out_of_stock' ? 'critical' : 'warning',
  availableStock: type === 'out_of_stock' ? 0 : 1,
  minStock: 5,
  isSeen: false
});

const makeExpiryAlert = (index, type = 'expiring') => ({
  incidentId: `inventory-expiry:b${index}`,
  productId: `expiry-p${index}`,
  batchId: `b${index}`,
  productName: `Producto caducidad ${index}`,
  type,
  severity: type === 'expired' ? 'critical' : 'warning',
  expiryDate: '2026-09-24',
  daysUntilExpiry: type === 'expired' ? -1 : 2,
  isSeen: index % 2 === 0
});

const buildSnapshot = ({
  outOfStockCount = 0,
  lowStockCount = 0,
  expiredCount = 0,
  expiringCount = 0,
  alerts = []
} = {}) => ({
  status: 'ready',
  updatedAt: '2026-09-22T12:00:00.000Z',
  activeCount: outOfStockCount + lowStockCount + expiredCount + expiringCount,
  criticalCount: outOfStockCount + expiredCount,
  warningCount: lowStockCount + expiringCount,
  outOfStockCount,
  lowStockCount,
  expiredCount,
  expiringCount,
  alerts
});

const snapshot = buildSnapshot({
  outOfStockCount: 1,
  expiringCount: 1,
  alerts: [
    makeStockAlert(1, 'out_of_stock'),
    makeExpiryAlert(1)
  ]
});

const renderDrawer = (props = {}) => render(
  <MemoryRouter>
    <LocalInventoryOperationalAlertsDrawer
      isOpen
      onClose={vi.fn()}
      snapshot={snapshot}
      {...props}
    />
  </MemoryRouter>
);

describe('LocalInventoryOperationalAlertsDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actor.runtime = {
      status: 'granted',
      actorType: 'admin',
      actorId: 'admin-1',
      sessionId: 'session-1',
      permissions: ['*']
    };
  });

  afterEach(() => cleanup());

  it('marks current alerts seen on open without removing active incidents', async () => {
    renderDrawer();

    await waitFor(() => expect(localMocks.markSeen).toHaveBeenCalledTimes(1));
    expect(screen.getByText('2 alertas activas')).toBeInTheDocument();
    expect(screen.getByText('Producto stock 1')).toBeInTheDocument();
    expect(screen.getByText('Producto caducidad 1')).toBeInTheDocument();
  });

  it('shows only the Reabastecimiento CTA when only stock categories have counts', () => {
    renderDrawer({
      snapshot: buildSnapshot({
        outOfStockCount: 2,
        lowStockCount: 3,
        alerts: [makeStockAlert(1, 'out_of_stock'), makeStockAlert(2)]
      })
    });

    expect(screen.getByRole('button', {
      name: 'Revisar 5 alertas de reabastecimiento'
    })).toBeInTheDocument();
    expect(screen.queryByRole('button', {
      name: /alertas? de caducidad/i
    })).not.toBeInTheDocument();
  });

  it('shows only the Caducidad CTA when only expiry categories have counts', () => {
    renderDrawer({
      snapshot: buildSnapshot({
        expiredCount: 1,
        expiringCount: 4,
        alerts: [makeExpiryAlert(1, 'expired'), makeExpiryAlert(2)]
      })
    });

    expect(screen.getByRole('button', {
      name: 'Revisar 5 alertas de caducidad'
    })).toBeInTheDocument();
    expect(screen.queryByRole('button', {
      name: /alertas? de reabastecimiento/i
    })).not.toBeInTheDocument();
  });

  it('shows both category CTAs when stock and expiry alerts coexist', () => {
    renderDrawer();

    expect(screen.getByRole('button', {
      name: 'Revisar 1 alerta de reabastecimiento'
    })).toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: 'Revisar 1 alerta de caducidad'
    })).toBeInTheDocument();
  });

  it('keeps Reabastecimiento reachable when stock alerts are outside the first 12 cards', () => {
    const expiryAlerts = Array.from({ length: 13 }, (_, index) => makeExpiryAlert(index + 1));
    const stockAlert = makeStockAlert(99);
    renderDrawer({
      snapshot: buildSnapshot({
        lowStockCount: 1,
        expiringCount: 13,
        alerts: [...expiryAlerts, stockAlert]
      })
    });

    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(12);
    expect(within(list).queryByText('Producto stock 99')).not.toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: 'Revisar 1 alerta de reabastecimiento'
    })).toBeInTheDocument();
    expect(screen.getByText('+2 alertas activas adicionales.')).toBeInTheDocument();
  });

  it('keeps Caducidad reachable when expiry alerts are outside the first 12 cards', () => {
    const stockAlerts = Array.from({ length: 13 }, (_, index) => makeStockAlert(index + 1));
    const expiryAlert = makeExpiryAlert(99);
    renderDrawer({
      snapshot: buildSnapshot({
        lowStockCount: 13,
        expiringCount: 1,
        alerts: [...stockAlerts, expiryAlert]
      })
    });

    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(12);
    expect(within(list).queryByText('Producto caducidad 99')).not.toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: 'Revisar 1 alerta de caducidad'
    })).toBeInTheDocument();
  });

  it('closes before navigating from the Reabastecimiento category CTA', () => {
    const onClose = vi.fn();
    renderDrawer({ onClose });

    fireEvent.click(screen.getByRole('button', {
      name: 'Revisar 1 alerta de reabastecimiento'
    }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(routerMocks.navigate).toHaveBeenCalledWith('/ventas?tab=restock');
    expect(onClose.mock.invocationCallOrder[0])
      .toBeLessThan(routerMocks.navigate.mock.invocationCallOrder[0]);
  });

  it('closes before navigating from the Caducidad category CTA', () => {
    const onClose = vi.fn();
    renderDrawer({ onClose });

    fireEvent.click(screen.getByRole('button', {
      name: 'Revisar 1 alerta de caducidad'
    }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(routerMocks.navigate).toHaveBeenCalledWith('/ventas?tab=expiration');
    expect(onClose.mock.invocationCallOrder[0])
      .toBeLessThan(routerMocks.navigate.mock.invocationCallOrder[0]);
  });

  it('keeps category and item navigation disabled for restricted Staff', () => {
    actor.runtime = {
      status: 'granted',
      actorType: 'staff',
      actorId: 'staff-1',
      sessionId: 'staff-session-1',
      permissions: ['products']
    };
    renderDrawer();

    expect(screen.getByText(/no tiene acceso a Ventas y Reportes/i)).toBeInTheDocument();

    const restockCta = screen.getByRole('button', {
      name: 'Revisar 1 alerta de reabastecimiento'
    });
    const expiryCta = screen.getByRole('button', {
      name: 'Revisar 1 alerta de caducidad'
    });

    expect(restockCta).toBeDisabled();
    expect(expiryCta).toBeDisabled();
    fireEvent.click(restockCta);
    fireEvent.click(expiryCta);

    screen.getAllByRole('button', { name: /^Revisar /i })
      .forEach((button) => expect(button).toBeDisabled());
    expect(routerMocks.navigate).not.toHaveBeenCalled();
  });

  it('derives category labels from complete snapshot counts, not visible cards', () => {
    renderDrawer({
      snapshot: buildSnapshot({
        outOfStockCount: 2,
        lowStockCount: 3,
        alerts: [makeStockAlert(1, 'out_of_stock')]
      })
    });

    expect(screen.getByRole('button', {
      name: 'Revisar 5 alertas de reabastecimiento'
    })).toHaveTextContent('Reabastecimiento · 5 alertas');
  });

  it('navigates stock incident cards to Reabastecimiento and closes', () => {
    const onClose = vi.fn();
    renderDrawer({ onClose });

    fireEvent.click(screen.getByRole('button', {
      name: 'Revisar Agotado de Producto stock 1'
    }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(routerMocks.navigate).toHaveBeenCalledWith('/ventas?tab=restock');
  });

  it('navigates expiry incident cards to Caducidad and closes', () => {
    const onClose = vi.fn();
    renderDrawer({ onClose });

    fireEvent.click(screen.getByRole('button', {
      name: 'Revisar Próximo a caducar de Producto caducidad 1'
    }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(routerMocks.navigate).toHaveBeenCalledWith('/ventas?tab=expiration');
  });

  it('closes with Escape and backdrop', () => {
    const onClose = vi.fn();
    renderDrawer({ onClose });

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    const closeControls = screen.getAllByRole('button', {
      name: 'Cerrar alertas operativas de inventario'
    });
    fireEvent.click(closeControls[0]);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('moves focus into the drawer and traps keyboard focus', async () => {
    renderDrawer();

    const drawer = screen.getByRole('dialog', { name: 'Inventario requiere atención' });
    const closeButton = drawer.querySelector('.notification-center-close');
    await waitFor(() => expect(document.activeElement).toBe(closeButton));

    const actions = within(drawer).getAllByRole('button', { name: /^Revisar /i });
    const lastAction = actions.at(-1);
    lastAction.focus();
    fireEvent.keyDown(document, { key: 'Tab' });

    expect(document.activeElement).toBe(closeButton);
  });

  it('renders explicit loading, empty and error states', () => {
    const view = render(
      <MemoryRouter>
        <LocalInventoryOperationalAlertsDrawer
          isOpen
          onClose={vi.fn()}
          snapshot={{ ...snapshot, status: 'loading', updatedAt: null, activeCount: 0, alerts: [] }}
        />
      </MemoryRouter>
    );
    expect(screen.getByText('Revisando inventario…')).toBeInTheDocument();

    view.rerender(
      <MemoryRouter>
        <LocalInventoryOperationalAlertsDrawer
          isOpen
          onClose={vi.fn()}
          snapshot={{ ...snapshot, status: 'ready', activeCount: 0, alerts: [] }}
        />
      </MemoryRouter>
    );
    expect(screen.getByText('Tu inventario no tiene alertas operativas activas.')).toBeInTheDocument();

    view.rerender(
      <MemoryRouter>
        <LocalInventoryOperationalAlertsDrawer
          isOpen
          onClose={vi.fn()}
          snapshot={{ ...snapshot, status: 'error', activeCount: 0, alerts: [] }}
        />
      </MemoryRouter>
    );
    expect(screen.getByText('No pudimos revisar las alertas locales de inventario.'))
      .toBeInTheDocument();
  });
});
