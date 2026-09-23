// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
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

vi.mock('../../../services/auth/useActorRuntimeSnapshot', () => ({
  useActorRuntimeSnapshot: () => actor.runtime
}));

vi.mock('../../../services/localInventoryOperationalAlerts', () => ({
  markCurrentLocalInventoryOperationalAlertsSeen: localMocks.markSeen,
  refreshLocalInventoryOperationalAlertsSnapshot: localMocks.refresh
}));

import LocalInventoryOperationalAlertsDrawer from '../LocalInventoryOperationalAlertsDrawer';

const snapshot = {
  status: 'ready',
  updatedAt: '2026-09-22T12:00:00.000Z',
  activeCount: 2,
  criticalCount: 1,
  warningCount: 1,
  outOfStockCount: 1,
  lowStockCount: 0,
  expiredCount: 0,
  expiringCount: 1,
  alerts: [
    {
      incidentId: 'inventory-stock:p1',
      productId: 'p1',
      productName: 'Producto agotado',
      type: 'out_of_stock',
      severity: 'critical',
      availableStock: 0,
      isSeen: false
    },
    {
      incidentId: 'inventory-expiry:b1',
      productId: 'p2',
      batchId: 'b1',
      productName: 'Producto próximo',
      type: 'expiring',
      severity: 'warning',
      expiryDate: '2026-09-24',
      daysUntilExpiry: 2,
      isSeen: true
    }
  ]
};

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

const renderDrawer = (props = {}) => render(
  <MemoryRouter initialEntries={['/']}>
    <LocationProbe />
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
    expect(screen.getByText('Producto agotado')).toBeInTheDocument();
    expect(screen.getByText('Producto próximo')).toBeInTheDocument();
  });

  it('navigates stock incidents to Reabastecimiento and closes', () => {
    const onClose = vi.fn();
    renderDrawer({ onClose });

    fireEvent.click(screen.getByRole('button', {
      name: 'Revisar Agotado de Producto agotado'
    }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('location')).toHaveTextContent('/ventas?tab=restock');
  });

  it('navigates expiry incidents to Caducidad and closes', () => {
    const onClose = vi.fn();
    renderDrawer({ onClose });

    fireEvent.click(screen.getByRole('button', {
      name: 'Revisar Próximo a caducar de Producto próximo'
    }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('location')).toHaveTextContent('/ventas?tab=expiration');
  });

  it('does not bypass report authorization for restricted Staff', () => {
    actor.runtime = {
      status: 'granted',
      actorType: 'staff',
      actorId: 'staff-1',
      sessionId: 'staff-session-1',
      permissions: ['products']
    };
    renderDrawer();

    expect(screen.getByText(/no tiene acceso a Ventas y Reportes/i)).toBeInTheDocument();
    screen.getAllByRole('button', { name: /^Revisar /i })
      .forEach((button) => expect(button).toBeDisabled());
    expect(screen.getByTestId('location')).toHaveTextContent('/');
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
