// @vitest-environment jsdom
import { grantTestActor } from '../../../services/auth/__tests__/actorAccessTestHarness';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  app: null,
  actorRuntime: null,
  postDowngradeCash: null,
  showMenuBell: true
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => selector(state.app))
}));

vi.mock('../../../services/auth/useActorRuntimeSnapshot', () => ({
  useActorRuntimeSnapshot: () => state.actorRuntime
}));

vi.mock('../../../hooks/usePostDowngradeCashPending', () => ({
  default: () => state.postDowngradeCash
}));

vi.mock('../../../hooks/useFeatureConfig', () => ({
  useFeatureConfig: () => ({ hasKDS: false })
}));

vi.mock('../../../hooks/useBackupManager', () => ({
  useBackupManager: () => ({ status: null })
}));

vi.mock('../../../hooks/usePersistentStorage', () => ({
  default: () => ({ isVolatile: false })
}));

vi.mock('../../../services/BackupRiskEvaluator', () => ({
  useBackupRiskStore: vi.fn((selector) => selector({ riskLevel: 0 }))
}));

vi.mock('../../../utils/backupRuntimeNotice', () => ({
  getBackupRuntimeNotice: () => null
}));

vi.mock('../../common/Logo', () => ({
  default: () => <div aria-label="Lanzo" />
}));

vi.mock('../../notifications/NotificationBell', () => ({
  default: ({ className = '', localOnly = false, showLabel = false, onOpen }) => (
    localOnly || state.showMenuBell ? (
      <button
        type="button"
        className={className}
        data-local-only={localOnly ? 'true' : 'false'}
        aria-label={localOnly ? 'Alertas locales de inventario' : 'Notificaciones'}
        onClick={onOpen}
      >
        {showLabel && <span className="notification-bell__label">Notificaciones</span>}
      </button>
    ) : null
  )
}));

import Navbar from '../Navbar';

const createAppState = (overrides = {}) => ({
  isVolatileDismissed: false,
  setVolatileDismissed: vi.fn(),
  updateAvailable: false,
  isInstallable: false,
  isIOS: false,
  isUpdating: false,
  isInstalling: false,
  isBackupLoading: false,
  runUpdate: vi.fn(),
  requestInstall: vi.fn(),
  needsDriveReauth: false,
  dismissedBackupNotice: null,
  showBackupNotice: vi.fn(),
  licenseDetails: {
    features: {
      cloud_pos_sync: false,
      ecommerce_order_inbox: true,
      ecommerce_portal_enabled: true
    }
  },
  currentDeviceRole: 'admin',
  currentAdminUser: { id: 'admin-1' },
  currentStaffUser: null,
  ecommerceOrderCounts: { new: 0 },
  ...overrides
});

const boundAdminActor = {
  status: 'granted',
  actorType: 'admin',
  actorId: 'admin-1',
  actorKey: 'admin:admin-1',
  sessionId: 'admin-session-1',
  deviceRef: 'device-1',
  permissions: ['*'],
  tenant: { opaqueId: 'tenant-1', databaseName: 'LanzoDB_t_tenant-1', generation: 1 }
};

function renderNavbar(entry = '/', isSuppressed = false) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Navbar isSuppressed={isSuppressed} />
    </MemoryRouter>
  );
}

const getOnlineOrderLinks = () => (
  [...document.querySelectorAll('a[href="/pedidos-online"]')]
);

const openMobileDrawer = () => {
  const menuButton = screen.getByRole('button', { name: 'Abrir menú principal' });
  fireEvent.click(menuButton);
  return {
    menuButton,
    drawer: screen.getByRole('dialog', { name: 'Menú principal' })
  };
};

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  state.app = createAppState();
  state.showMenuBell = true;
  state.postDowngradeCash = {
    eligible: false,
    pendingCount: null,
    status: 'idle'
  };
  state.actorRuntime = grantTestActor({ actorType: 'admin', actorId: 'admin-1' });
});

describe('Navbar Settings shell access', () => {
  it('closes the mobile menu when applying a pending update', async () => {
    const runUpdate = vi.fn(async () => true);
    state.app = createAppState({ updateAvailable: true, runUpdate });
    renderNavbar();
    const { drawer } = openMobileDrawer();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Actualizar sistema' }));
    expect(screen.getByRole('button', { name: 'Abrir menú principal' })).toHaveAttribute('aria-expanded', 'false');
    expect(runUpdate).toHaveBeenCalledOnce();
  });

  it('keeps manual update checks out of the menu and retains pending-update actions', () => {
    state.app = createAppState({ updateAvailable: true });
    renderNavbar();
    openMobileDrawer();

    expect(screen.queryByRole('button', { name: /Buscar actualizaciones/i })).not.toBeInTheDocument();
    expect(document.querySelector('.drawer-system-action--update')).toBeInTheDocument();
    expect(document.querySelector('.desktop-sidebar [aria-label="Actualizar sistema"]')).toBeInTheDocument();
  });

  it('does not show a pending-action indicator when there is no update or install', () => {
    renderNavbar();
    expect(document.querySelector('.drawer-system-actions')).not.toBeInTheDocument();
    expect(screen.queryByText('Hay acciones pendientes en el menú')).not.toBeInTheDocument();
  });

  it('suppresses mobile and desktop navigation only when the route requests it', () => {
    renderNavbar('/', true);

    expect(document.querySelector('.mobile-top-bar')).toBeNull();
    expect(document.querySelector('.mobile-bottom-nav')).toBeNull();
    expect(document.querySelector('.desktop-sidebar')).toBeNull();
  });
  it('uses the canonical Settings policy instead of products permission', () => {
    state.app = createAppState({
      currentDeviceRole: 'staff',
      currentAdminUser: null,
      currentStaffUser: { id: 'staff-a', permissions: { products: true } },
    });
    state.actorRuntime = grantTestActor({ actorId: 'staff-a', permissions: ['products'] });

    renderNavbar();

    expect(document.querySelector('.desktop-sidebar a[href="/productos"]')).not.toHaveAttribute('hidden');
    expect(document.querySelector('.desktop-sidebar a[href="/configuracion"]')).toHaveAttribute('hidden');
    openMobileDrawer();
    expect(document.querySelector('#mobile-main-menu a[href="/configuracion"]')).toBeNull();
  });

  it('removes Settings immediately when the canonical actor snapshot locks', () => {
    const view = renderNavbar();
    expect(document.querySelector('.desktop-sidebar a[href="/configuracion"]')).not.toHaveAttribute('hidden');

    state.actorRuntime = { status: 'locked' };
    view.rerender(
      <MemoryRouter initialEntries={['/']}>
        <Navbar />
      </MemoryRouter>
    );

    expect(document.querySelector('.desktop-sidebar a[href="/configuracion"]')).toHaveAttribute('hidden');
  });
});

describe('Navbar sales report access', () => {
  it('does not infer report navigation from refunds', () => {
    state.actorRuntime = {
      status: 'granted',
      actorType: 'staff',
      actorId: 'staff-refunds',
      sessionId: 'staff-session-refunds',
      permissions: ['refunds']
    };

    renderNavbar();

    expect(document.querySelector('.mobile-bottom-nav a[href="/ventas"]')).toHaveAttribute('hidden');
    expect(document.querySelector('.desktop-sidebar a[href="/ventas"]')).toHaveAttribute('hidden');
  });

  it('removes report navigation as soon as ActorRuntime locks', () => {
    const view = renderNavbar();
    expect(document.querySelector('.desktop-sidebar a[href="/ventas"]')).not.toHaveAttribute('hidden');

    state.actorRuntime = {
      status: 'locked',
      actorType: null,
      actorId: null,
      sessionId: null,
      permissions: []
    };
    view.rerender(
      <MemoryRouter initialEntries={['/']}>
        <Navbar />
      </MemoryRouter>
    );

    expect(document.querySelector('.desktop-sidebar a[href="/ventas"]')).toHaveAttribute('hidden');
  });
});

describe('Navbar mobile menu', () => {
  it('uses a compact visual heading while preserving the accessible dialog name', () => {
    renderNavbar();
    const { drawer } = openMobileDrawer();

    expect(within(drawer).getByRole('heading', { name: 'Menú principal' }))
      .toHaveTextContent(/^Menú$/);
    expect(drawer.querySelector('.drawer-handle')).toBeNull();
    expect(drawer.querySelector('.drawer-eyebrow')).toBeNull();
    expect(drawer.querySelector('.drawer-header')).toBe(drawer.firstElementChild);
    expect(drawer.querySelector('.drawer-notification-slot').nextElementSibling)
      .toBe(drawer.querySelector('.drawer-links'));
  });

  it('keeps the alert entry above modules and closes on opening its panel', () => {
    renderNavbar();
    const { menuButton, drawer } = openMobileDrawer();
    const slot = drawer.querySelector('.drawer-notification-slot');

    expect(within(slot).getByRole('button', { name: 'Notificaciones' }))
      .toHaveTextContent('Notificaciones');
    fireEvent.click(within(slot).getByRole('button', { name: 'Notificaciones' }));
    expect(menuButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('does not leave a visible placeholder when notification entry is unavailable', () => {
    state.showMenuBell = false;
    renderNavbar();
    const { drawer } = openMobileDrawer();
    expect(drawer.querySelector('.drawer-notification-slot')).toBeEmptyDOMElement();
  });

  it('closes on a downward touch swipe beginning in the header', () => {
    renderNavbar();
    const { menuButton, drawer } = openMobileDrawer();
    const header = drawer.querySelector('.drawer-header');

    fireEvent.pointerDown(header, {
      pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0,
      clientX: 90, clientY: 100
    });
    fireEvent.pointerMove(header, {
      pointerId: 1, pointerType: 'touch', clientX: 94, clientY: 205
    });
    expect(drawer).toHaveClass('is-dragging');
    fireEvent.pointerUp(header, {
      pointerId: 1, pointerType: 'touch', clientX: 94, clientY: 205
    });

    expect(menuButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('resets short and horizontal header swipes without closing', () => {
    renderNavbar();
    const { menuButton, drawer } = openMobileDrawer();
    const header = drawer.querySelector('.drawer-header');

    fireEvent.pointerDown(header, {
      pointerId: 2, pointerType: 'touch', isPrimary: true, button: 0,
      clientX: 90, clientY: 100
    });
    fireEvent.pointerMove(header, {
      pointerId: 2, pointerType: 'touch', clientX: 90, clientY: 135
    });
    fireEvent.pointerUp(header, {
      pointerId: 2, pointerType: 'touch', clientX: 90, clientY: 135
    });
    expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    expect(drawer).not.toHaveClass('is-dragging');
    expect(drawer.style.getPropertyValue('--drawer-drag-y')).toBe('');

    fireEvent.pointerDown(header, {
      pointerId: 3, pointerType: 'touch', isPrimary: true, button: 0,
      clientX: 90, clientY: 100
    });
    fireEvent.pointerMove(header, {
      pointerId: 3, pointerType: 'touch', clientX: 180, clientY: 115
    });
    fireEvent.pointerUp(header, {
      pointerId: 3, pointerType: 'touch', clientX: 180, clientY: 115
    });
    expect(menuButton).toHaveAttribute('aria-expanded', 'true');
  });

  it('never interprets module scrolling or closing-button touches as drawer drags', () => {
    renderNavbar();
    const { menuButton, drawer } = openMobileDrawer();
    const links = drawer.querySelector('.drawer-links');
    const headerClose = within(drawer).getByRole('button', { name: 'Cerrar menú' });

    fireEvent.pointerDown(links, {
      pointerId: 4, pointerType: 'touch', isPrimary: true, button: 0,
      clientX: 90, clientY: 100
    });
    fireEvent.pointerMove(links, {
      pointerId: 4, pointerType: 'touch', clientX: 90, clientY: 210
    });
    fireEvent.pointerUp(links, {
      pointerId: 4, pointerType: 'touch', clientX: 90, clientY: 210
    });
    expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    expect(drawer).not.toHaveClass('is-dragging');

    fireEvent.pointerDown(headerClose, {
      pointerId: 5, pointerType: 'touch', isPrimary: true, button: 0,
      clientX: 90, clientY: 100
    });
    fireEvent.pointerMove(headerClose, {
      pointerId: 5, pointerType: 'touch', clientX: 90, clientY: 210
    });
    expect(drawer).not.toHaveClass('is-dragging');
    fireEvent.click(headerClose);
    expect(menuButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows the confirmed historical cash count only for the eligible owner', () => {
    state.postDowngradeCash = {
      eligible: true,
      pendingCount: 7,
      status: 'success'
    };

    renderNavbar();

    const cajaLinks = screen.getAllByRole('link', {
      name: 'Caja, 7 cajas anteriores pendientes de conciliación'
    });
    expect(cajaLinks).toHaveLength(2);
    expect(cajaLinks[0]).toHaveTextContent('Caja');
    expect(cajaLinks[0]).toHaveTextContent('7');
    expect(cajaLinks[1]).toHaveTextContent('7');
  });

  it('does not expose a pending cash count to an ineligible actor', () => {
    state.postDowngradeCash = {
      eligible: false,
      pendingCount: 7,
      status: 'hidden'
    };

    renderNavbar();

    expect(screen.getAllByRole('link', { name: 'Caja' })).toHaveLength(2);
    expect(document.querySelectorAll('.cash-nav-count')).toHaveLength(0);
  });

  it('hides the indicator only after the authoritative count reaches zero', () => {
    state.postDowngradeCash = {
      eligible: true,
      pendingCount: 0,
      status: 'success'
    };

    renderNavbar();

    expect(screen.getAllByRole('link', { name: 'Caja' })).toHaveLength(2);
    expect(document.querySelectorAll('.cash-nav-count')).toHaveLength(0);
  });

  it('keeps the last confirmed count visible through offline and query-error states', () => {
    state.postDowngradeCash = {
      eligible: true,
      pendingCount: 7,
      status: 'offline_known'
    };

    const view = renderNavbar();
    expect(screen.getAllByRole('link', {
      name: 'Caja, 7 cajas anteriores pendientes de conciliación'
    })).toHaveLength(2);

    state.postDowngradeCash = {
      eligible: true,
      pendingCount: 7,
      status: 'error'
    };
    view.rerender(
      <MemoryRouter initialEntries={['/']}>
        <Navbar />
      </MemoryRouter>
    );

    expect(screen.getAllByRole('link', {
      name: 'Caja, 7 cajas anteriores pendientes de conciliación'
    })).toHaveLength(2);
  });

  it('keeps the local inventory bell visible in the mobile top bar without opening Menu', () => {
    renderNavbar();

    const topBell = document.querySelector(
      '.mobile-top-bar .notification-bell--mobile-top'
    );
    expect(topBell).toBeInTheDocument();
    expect(topBell).toHaveAttribute('data-local-only', 'true');
    expect(screen.getByRole('button', { name: 'Abrir menú principal' }))
      .toHaveAttribute('aria-expanded', 'false');
  });

  it('opens as a dialog and closes with Escape', () => {
    renderNavbar();

    const menuButton = screen.getByRole('button', { name: 'Abrir menú principal' });
    const drawer = document.getElementById('mobile-main-menu');

    expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    expect(drawer).toHaveAttribute('aria-hidden', 'true');
    expect(drawer).toHaveAttribute('inert');

    fireEvent.click(menuButton);

    expect(screen.getByRole('dialog', { name: 'Menú principal' }))
      .toHaveAttribute('aria-hidden', 'false');
    const closeButton = screen.getByRole('button', { name: 'Cerrar menú' });
    const lastAction = [...drawer.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')].at(-1);
    expect(lastAction).toBeTruthy();
    expect(within(drawer).queryByRole('button', { name: /Buscar actualizaciones/i })).not.toBeInTheDocument();

    expect(document.activeElement).toBe(closeButton);

    lastAction.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(closeButton);

    closeButton.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(lastAction);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(menuButton);
  });

  it('closes when the backdrop is pressed', () => {
    renderNavbar();

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú principal' }));
    fireEvent.click(document.querySelector('.mobile-drawer-overlay'));

    expect(screen.getByRole('button', { name: 'Abrir menú principal' }))
      .toHaveAttribute('aria-expanded', 'false');
  });

  it('shows Pedidos online inside the drawer and closes after navigation', () => {
    renderNavbar();
    const { menuButton, drawer } = openMobileDrawer();
    const onlineLink = within(drawer).getByRole('link', { name: /Pedidos online/i });

    expect(onlineLink).toHaveTextContent('Pedidos recibidos desde la tienda');
    fireEvent.click(onlineLink);

    expect(menuButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows Portal online beside its orders in the drawer', () => {
    renderNavbar();
    const { drawer } = openMobileDrawer();
    const portalLink = drawer.querySelector('a[href="/portal-online"]');

    expect(portalLink).toHaveAttribute('href', '/portal-online');
    expect(portalLink).toHaveTextContent('Configura tu tienda, catálogo y horarios');
    expect(within(drawer).getByRole('heading', { name: 'Portal online' })).toBeInTheDocument();
    expect(drawer.querySelector('.drawer-context-divider')).toBeInTheDocument();
  });

  it('does not add Pedidos online to the mobile bottom navigation', () => {
    renderNavbar();
    const bottomNav = document.querySelector('.mobile-bottom-nav');

    expect(bottomNav.querySelector('a[href="/pedidos-online"]')).toBeNull();
  });
});

describe('Navbar ecommerce orders access', () => {
  it('groups online orders and portal settings in a desktop section', () => {
    renderNavbar();
    const labels = [...document.querySelectorAll('.desktop-sidebar .sidebar-links > a')]
      .map((link) => link.textContent.replace(/\s+/g, ' ').trim());

    expect(labels.slice(0, 3)).toEqual(['Punto de Venta', 'Caja', 'Productos']);
    expect(screen.getByRole('heading', { name: 'Portal online' })).toBeInTheDocument();
    expect(document.querySelector('.desktop-sidebar a[href="/pedidos-online"]'))
      .toHaveTextContent('Pedidos online');
    expect(document.querySelector('.desktop-sidebar a[href="/portal-online"]'))
      .toHaveTextContent('Configurar portal');
  });

  it('does not render a badge when the new count is zero', () => {
    renderNavbar();

    expect(getOnlineOrderLinks()).toHaveLength(2);
    expect(document.querySelectorAll('.ecommerce-nav-badge')).toHaveLength(0);
  });

  it('shows the numeric badge in desktop and drawer', () => {
    state.app = createAppState({ ecommerceOrderCounts: { new: 7 } });
    renderNavbar();

    const badges = [...document.querySelectorAll('.ecommerce-nav-badge')];
    expect(badges).toHaveLength(2);
    badges.forEach((badge) => expect(badge).toHaveTextContent('7'));
  });

  it('caps the badge at 99+', () => {
    state.app = createAppState({ ecommerceOrderCounts: { new: 100 } });
    renderNavbar();

    const badges = [...document.querySelectorAll('.ecommerce-nav-badge')];
    expect(badges).toHaveLength(2);
    badges.forEach((badge) => expect(badge).toHaveTextContent('99+'));
  });

  it('blocks online-order navigation while a backup is running', () => {
    state.app = createAppState({ isBackupLoading: true });
    renderNavbar();

    const desktopLink = document.querySelector(
      '.desktop-sidebar a[href="/pedidos-online"]'
    );

    expect(desktopLink).toHaveAttribute('aria-disabled', 'true');
    expect(desktopLink).toHaveAttribute('tabindex', '-1');
    expect(fireEvent.click(desktopLink)).toBe(false);
    expect(screen.getByRole('button', { name: 'Abrir menú principal' })).toBeDisabled();
  });

  it('shows the link to staff with ecommerce permission', () => {
    state.app = createAppState({
      currentDeviceRole: 'staff',
      currentAdminUser: null,
      currentStaffUser: { id: 'staff-a', permissions: { ecommerce: true } }
    });
    state.actorRuntime = grantTestActor({ actorId: 'staff-a', permissions: ['ecommerce'] });
    renderNavbar();

    expect(getOnlineOrderLinks()).toHaveLength(2);
  });

  it('hides the link from staff without ecommerce permission', () => {
    state.app = createAppState({
      currentDeviceRole: 'staff',
      currentStaffUser: { permissions: { ecommerce: false } },
    });
    renderNavbar();

    expect(getOnlineOrderLinks()).toHaveLength(0);
    expect(document.querySelectorAll('a[href="/portal-online"]')).toHaveLength(0);
  });

  it('hides the link while the device role is unresolved', () => {
    state.app = createAppState({ currentDeviceRole: null });
    renderNavbar();

    expect(getOnlineOrderLinks()).toHaveLength(0);
  });

  it('hides the link when ecommerce_order_inbox is disabled', () => {
    state.app = createAppState({
      licenseDetails: {
        features: {
          cloud_pos_sync: false,
          ecommerce_order_inbox: false
        }
      }
    });
    renderNavbar();

    expect(getOnlineOrderLinks()).toHaveLength(0);
  });
});

describe('Navbar AI capability discovery', () => {
  it('shows the PRO discovery badge in the desktop sidebar and mobile drawer for Free', () => {
    state.app = createAppState({
      licenseDetails: { valid: true, plan_code: 'free', features: { ai_agents: false, cloud_pos_sync: false } }
    });
    state.actorRuntime = grantTestActor({ actorType: 'admin', actorId: 'admin-1' });
    renderNavbar('/agentes-ia');

    const desktopLink = document.querySelector('.desktop-sidebar a[href="/agentes-ia"]');
    expect(desktopLink).not.toHaveAttribute('hidden');
    expect(desktopLink).toHaveClass('active');
    expect(desktopLink).toHaveTextContent('Agentes IA');
    expect(desktopLink.querySelector('.nav-pro-badge')).toHaveTextContent('PRO');
    expect(desktopLink).toHaveTextContent('disponible con Lanzo Nube');

    const { drawer } = openMobileDrawer();
    const drawerLink = drawer.querySelector('a[href="/agentes-ia"]');
    expect(drawerLink).not.toBeNull();
    expect(drawerLink).toHaveClass('active');
    expect(drawerLink).toHaveTextContent('PRO');
    expect(drawerLink.querySelector('.nav-pro-badge')).toBeInTheDocument();
    expect(drawerLink).toHaveTextContent('Ventas, rentabilidad y estrategia comercial');
  });

  it('keeps an entitled Nube entry direct and without a discovery badge', () => {
    state.app = createAppState({
      licenseDetails: { valid: true, plan_code: 'nube', features: { ai_agents: true, cloud_pos_sync: true } }
    });
    state.actorRuntime = grantTestActor({ actorType: 'admin', actorId: 'admin-1' });
    renderNavbar('/agentes-ia');

    const desktopLink = document.querySelector('.desktop-sidebar a[href="/agentes-ia"]');
    expect(desktopLink).not.toHaveAttribute('hidden');
    expect(desktopLink).toHaveClass('active');
    expect(desktopLink.querySelector('.nav-pro-badge')).toBeNull();

    const { drawer } = openMobileDrawer();
    expect(drawer.querySelector('a[href="/agentes-ia"] .nav-pro-badge')).toBeNull();
  });

  it('does not expose the AI entry or badge to an actor without permission', () => {
    state.app = createAppState({
      currentDeviceRole: 'staff',
      currentAdminUser: null,
      currentStaffUser: { id: 'staff-a', permissions: { ai_agents: false } },
      licenseDetails: { valid: true, plan_code: 'free', features: { ai_agents: false, cloud_pos_sync: false } }
    });
    state.actorRuntime = { ...boundAdminActor, actorType: 'staff', permissions: ['pos'] };
    renderNavbar('/agentes-ia');

    const desktopLink = document.querySelector('.desktop-sidebar a[href="/agentes-ia"]');
    expect(desktopLink).toHaveAttribute('hidden');
    expect(desktopLink.querySelector('.nav-pro-badge')).toBeNull();

    const { drawer } = openMobileDrawer();
    expect(drawer.querySelector('a[href="/agentes-ia"]')).toBeNull();
  });
});

describe('Navbar session authority on a shared device', () => {
  it('shows only POS to Staff even when the persisted device record says Admin', () => {
    state.app.currentDeviceRole = 'staff';
    state.app.currentAdminUser = null;
    state.app.currentStaffUser = { id: 'staff-a', permissions: { pos: true } };
    state.app.licenseDetails = { ...state.app.licenseDetails, device_mode: 'shared', device_role: 'admin' };
    state.actorRuntime = grantTestActor({ actorId: 'staff-a', permissions: ['pos'] });
    renderNavbar();
    for (const selector of ['.desktop-sidebar', '.mobile-bottom-nav']) {
      expect(document.querySelector(`${selector} a[href="/"]`)).not.toHaveAttribute('hidden');
      for (const path of ['/caja', '/productos', '/ventas']) {
        expect(document.querySelector(`${selector} a[href="${path}"]`)).toHaveAttribute('hidden');
      }
    }
    openMobileDrawer();
    for (const path of ['/clientes', '/configuracion', '/portal-online', '/pedidos-online']) {
      expect(document.querySelector(`#mobile-main-menu a[href="${path}"]`)).toBeNull();
    }
    expect(document.querySelectorAll('a[href="/portal-online"]')).toHaveLength(0);
  });

  it('removes all protected navigation when the runtime locks despite a remaining Admin identity', () => {
    state.actorRuntime = { status: 'locked' };
    renderNavbar();
    for (const path of ['/', '/caja', '/productos', '/clientes', '/configuracion', '/ventas']) {
      expect(document.querySelector(`.desktop-sidebar a[href="${path}"]`)).toHaveAttribute('hidden');
    }
    expect(document.querySelectorAll('a[href="/portal-online"], a[href="/pedidos-online"]')).toHaveLength(0);
  });

  it('denies an Admin runtime whose active store identity is missing', () => {
    state.app.currentAdminUser = null;
    renderNavbar();
    expect(document.querySelector('.desktop-sidebar a[href="/caja"]')).toHaveAttribute('hidden');
    expect(document.querySelector('.desktop-sidebar a[href="/configuracion"]')).toHaveAttribute('hidden');
  });
});
