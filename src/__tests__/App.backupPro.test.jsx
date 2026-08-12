import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

const storeMock = vi.hoisted(() => {
  const appState = {};
  const useAppStore = vi.fn((selector) => selector(appState));
  useAppStore.getState = () => appState;
  useAppStore.setState = vi.fn((partial) => Object.assign(appState, partial));
  return { appState, useAppStore };
});

vi.mock('../store/useAppStore', () => ({
  useAppStore: storeMock.useAppStore
}));

vi.mock('../hooks/useSingleInstance', () => ({
  useSingleInstance: () => false
}));

vi.mock('../components/common/ErrorBoundary', () => ({
  default: ({ children }) => <>{children}</>
}));

vi.mock('../components/common/NavigationGuard', () => ({
  default: () => <div data-testid="navigation-guard" />
}));

vi.mock('../components/layout/Layout', () => ({
  default: ({ children }) => <div data-testid="layout">{children}</div>
}));

vi.mock('../components/common/WelcomeModal', () => ({
  default: () => <div />
}));

vi.mock('../components/common/StaffLoginModal', () => ({
  default: () => <div />
}));

vi.mock('../components/common/LicenseChangeRequiredModal', () => ({
  default: () => <div />
}));

vi.mock('../components/common/RenewalModal', () => ({
  default: () => <div />
}));

vi.mock('../components/common/SetupModal', () => ({
  default: () => <div />
}));

vi.mock('../components/common/PermissionRoute', () => ({
  default: ({ children }) => <>{children}</>
}));

vi.mock('../components/common/ServerStatusBanner', () => ({
  default: () => <div data-testid="server-status-banner" />
}));

vi.mock('../components/common/UpdatePrompt', () => ({
  default: () => <div />
}));

vi.mock('../components/common/InstallPrompt', () => ({
  default: () => <div />
}));

vi.mock('../components/common/PersistenceWarningBanner', () => ({
  default: () => <div />
}));

vi.mock('../components/common/BackupReminder', () => ({
  default: () => <div data-testid="backup-reminder" />
}));

vi.mock('../components/common/BackupRuntime', () => ({
  default: () => <div data-testid="backup-runtime" />
}));

vi.mock('../components/common/TermsAndConditionsModal', () => ({
  default: () => <div />
}));

vi.mock('../pages/PosPage', () => ({ default: () => <div /> }));
vi.mock('../pages/CajaPage', () => ({ default: () => <div /> }));
vi.mock('../pages/OrderPage', () => ({ default: () => <div /> }));
vi.mock('../pages/ProductsPage', () => ({ default: () => <div /> }));
vi.mock('../pages/CustomersPage', () => ({ default: () => <div /> }));
vi.mock('../pages/DashboardPage', () => ({ default: () => <div /> }));
vi.mock('../pages/SettingsPage', () => ({ default: () => <div /> }));
vi.mock('../pages/AboutPage', () => ({ default: () => <div /> }));

function renderApp() {
  return renderToStaticMarkup(
    <MemoryRouter>
      <App />
    </MemoryRouter>
  );
}

function setReadyState(licenseDetails) {
  Object.assign(storeMock.appState, {
    appStatus: 'ready',
    initializeApp: vi.fn(),
    pendingTermsUpdate: null,
    startLicenseSync: vi.fn(),
    stopLicenseSync: vi.fn(),
    performSystemHealthCheck: vi.fn(),
    licenseDetails
  });
}

describe('App local backup runtime gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'anon-key');
    Object.keys(storeMock.appState).forEach((key) => delete storeMock.appState[key]);
  });

  it('mounts BackupRuntime and BackupReminder for FREE/local licenses', () => {
    setReadyState({ features: { cloud_pos_sync: false } });

    const markup = renderApp();

    expect(markup).toContain('data-testid="backup-runtime"');
    expect(markup).toContain('data-testid="backup-reminder"');
  });

  it('does not mount BackupRuntime or BackupReminder for PRO/cloud licenses', () => {
    setReadyState({ features: { cloud_pos_sync: true } });

    const markup = renderApp();

    expect(markup).not.toContain('data-testid="backup-runtime"');
    expect(markup).not.toContain('data-testid="backup-reminder"');
  });

  it('renders the local tenant blocker without mounting any tenant-owned runtime', () => {
    Object.assign(storeMock.appState, {
      appStatus: 'local_tenant_mismatch',
      initializeApp: vi.fn(),
      pendingTermsUpdate: null,
      startLicenseSync: vi.fn(),
      stopLicenseSync: vi.fn(),
      performSystemHealthCheck: vi.fn(),
      licenseDetails: null,
      localTenantIsolation: {
        code: 'LOCAL_TENANT_MISMATCH',
        hasTenantOwnedData: true
      },
      leaveLocalTenantMismatch: vi.fn()
    });

    const markup = renderApp();

    expect(markup).toMatch(/Este navegador contiene datos de otra licencia/i);
    expect(markup).not.toContain('data-testid="layout"');
    expect(markup).not.toContain('data-testid="backup-runtime"');
    expect(markup).not.toContain('data-testid="backup-reminder"');
    expect(storeMock.appState.startLicenseSync).not.toHaveBeenCalled();
  });
});
