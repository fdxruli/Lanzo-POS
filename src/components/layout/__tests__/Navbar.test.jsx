// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  app: null
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => selector(state.app))
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
  default: () => <button type="button" aria-label="Notificaciones" />
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
  canAccess: vi.fn(() => true),
  licenseDetails: {
    features: {
      cloud_pos_sync: false,
      ecommerce_order_inbox: true
    }
  },
  currentDeviceRole: 'admin',
  currentStaffUser: null,
  ecommerceOrderCounts: { new: 0 },
  ...overrides
});

function renderNavbar(entry = '/') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Navbar />
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
});

describe('Navbar mobile menu', () => {
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
    const aboutLink = within(drawer).getByRole('link', { name: /Acerca de/i });

    expect(document.activeElement).toBe(closeButton);

    aboutLink.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(closeButton);

    closeButton.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(aboutLink);

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
      currentStaffUser: { permissions: { ecommerce: true } }
    });
    renderNavbar();

    expect(getOnlineOrderLinks()).toHaveLength(2);
  });

  it('hides the link from staff without ecommerce permission', () => {
    state.app = createAppState({
      currentDeviceRole: 'staff',
      currentStaffUser: { permissions: { ecommerce: false } },
      canAccess: vi.fn((permission) => permission !== 'ecommerce')
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
