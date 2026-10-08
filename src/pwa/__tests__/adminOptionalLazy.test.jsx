// @vitest-environment jsdom
import React, { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import CommercialAIAgentsRoute from '../../components/ai/CommercialAIAgentsRoute';

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  recover: vi.fn(),
  warn: vi.fn(),
  app: null,
  actorSnapshot: null,
}));

vi.mock('../adminLazyRouteRecovery', () => ({
  prepareAdminLazyRoute: mocks.prepare,
  recoverAdminLazyRoute: mocks.recover,
}));

vi.mock('../../services/Logger', () => ({
  default: { warn: mocks.warn },
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: (selector) => selector(mocks.app),
}));

vi.mock('../../services/auth/useActorRuntimeSnapshot', () => ({
  useActorRuntimeSnapshot: () => mocks.actorSnapshot,
}));

import { createOptionalAdminLazy } from '../adminOptionalLazy';

const makeBotModule = () => ({
  default: () => <div data-testid="assistant">AssistantBot</div>,
});

class GlobalErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <div data-testid="global-error">{this.state.error.message}</div>;
    }

    return this.props.children;
  }
}

function TestLayout({ AssistantBot, showAssistantBot = true }) {
  return (
    <div data-testid="layout-shell">
      <Outlet />
      {showAssistantBot && (
        <Suspense fallback={null}>
          <AssistantBot />
        </Suspense>
      )}
    </div>
  );
}

function renderLayout({
  importer,
  online = true,
  showAssistantBot = true,
  route = <main data-testid="main-route">POS route</main>,
  initialPath = '/',
}) {
  vi.stubGlobal('navigator', { onLine: online });
  const AssistantBot = createOptionalAdminLazy(importer, { surfaceName: 'AssistantBot' });

  return render(
    <GlobalErrorBoundary>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            element={(
              <TestLayout
                AssistantBot={AssistantBot}
                showAssistantBot={showAssistantBot}
              />
            )}
          >
            <Route path="*" element={route} />
          </Route>
        </Routes>
      </MemoryRouter>
    </GlobalErrorBoundary>
  );
}

describe('optional admin lazy surfaces', () => {
  beforeEach(() => {
    mocks.prepare.mockReset().mockResolvedValue(undefined);
    mocks.recover.mockReset().mockResolvedValue({ status: 'preserved' });
    mocks.warn.mockReset();
    mocks.app = {
      licenseDetails: { valid: true, plan_code: 'free', features: { ai_agents: false } },
      companyProfile: { name: 'Local test business' },
    };
    mocks.actorSnapshot = {
      status: 'granted',
      actorType: 'admin',
      actorId: 'admin-local-test',
      actorKey: 'admin:local-test',
      sessionId: 'session-local-test',
      deviceRef: 'device-local-test',
      permissions: ['*'],
      tenant: { opaqueId: 'tenant-local-test', databaseName: 'LanzoDB_local-test', generation: 1 },
    };
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('OFFLINE-LAZY-01 loads AssistantBot normally when online', async () => {
    renderLayout({ importer: vi.fn().mockResolvedValue(makeBotModule()) });

    expect(await screen.findByTestId('assistant')).toBeInTheDocument();
    expect(screen.getByTestId('main-route')).toBeInTheDocument();
    expect(screen.queryByTestId('global-error')).not.toBeInTheDocument();
  });

  it('OFFLINE-LAZY-02 skips a missing AssistantBot CSS asset offline and keeps the route mounted', async () => {
    const error = new Error('Unable to preload CSS for /assets/AssistantBot-test.css');
    const importer = vi.fn().mockRejectedValue(error);
    const licenseDetails = mocks.app.licenseDetails;
    const actorSnapshot = mocks.actorSnapshot;

    renderLayout({ importer, online: false });

    expect(await screen.findByTestId('main-route')).toBeInTheDocument();
    await waitFor(() => expect(mocks.warn).toHaveBeenCalledOnce());
    expect(screen.queryByTestId('assistant')).not.toBeInTheDocument();
    expect(screen.queryByTestId('global-error')).not.toBeInTheDocument();
    expect(mocks.recover).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith(
      '[AssistantBot] No disponible temporalmente sin conexión; Lanzo continúa en modo Local.'
    );
    expect(mocks.app.licenseDetails).toBe(licenseDetails);
    expect(mocks.actorSnapshot).toBe(actorSnapshot);
  });

  it('OFFLINE-LAZY-03 omits a module that failed to fetch while offline', async () => {
    renderLayout({
      importer: vi.fn().mockRejectedValue(
        new TypeError('Failed to fetch dynamically imported module: /assets/AssistantBot.js')
      ),
      online: false,
    });

    expect(await screen.findByTestId('main-route')).toBeInTheDocument();
    await waitFor(() => expect(mocks.warn).toHaveBeenCalledOnce());
    expect(screen.queryByTestId('assistant')).not.toBeInTheDocument();
    expect(screen.queryByTestId('global-error')).not.toBeInTheDocument();
    expect(mocks.recover).not.toHaveBeenCalled();
  });

  it('OFFLINE-LAZY-04 omits a ChunkLoadError while offline', async () => {
    renderLayout({
      importer: vi.fn().mockRejectedValue(
        Object.assign(new Error('Loading chunk AssistantBot failed'), { name: 'ChunkLoadError' })
      ),
      online: false,
    });

    expect(await screen.findByTestId('main-route')).toBeInTheDocument();
    await waitFor(() => expect(mocks.warn).toHaveBeenCalledOnce());
    expect(screen.queryByTestId('assistant')).not.toBeInTheDocument();
    expect(screen.queryByTestId('global-error')).not.toBeInTheDocument();
    expect(mocks.recover).not.toHaveBeenCalled();
  });

  it('OFFLINE-LAZY-05 runs online version recovery and leaves a failed asset error observable', async () => {
    const error = new TypeError('Failed to fetch dynamically imported module: /assets/AssistantBot-old.js');
    mocks.recover.mockResolvedValue({ status: 'preserved' });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    renderLayout({ importer: vi.fn().mockRejectedValue(error), online: true });

    expect(await screen.findByTestId('global-error')).toHaveTextContent(error.message);
    expect(mocks.recover).toHaveBeenCalledWith({ error });
    expect(screen.queryByTestId('assistant')).not.toBeInTheDocument();
  });

  it('OFFLINE-LAZY-06 lets an unrelated offline programming error reach the global boundary', async () => {
    const error = new TypeError('unexpected code bug');
    vi.spyOn(console, 'error').mockImplementation(() => {});

    renderLayout({ importer: vi.fn().mockRejectedValue(error), online: false });

    expect(await screen.findByTestId('global-error')).toHaveTextContent(error.message);
    expect(mocks.recover).not.toHaveBeenCalled();
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it('OFFLINE-LAZY-07 does not import an optional surface when it is disabled', async () => {
    const importer = vi.fn().mockResolvedValue(makeBotModule());

    renderLayout({ importer, showAssistantBot: false });

    expect(screen.getByTestId('main-route')).toBeInTheDocument();
    expect(screen.queryByTestId('assistant')).not.toBeInTheDocument();
    expect(importer).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it('OFFLINE-LAZY-09 keeps the Free Agentes IA showcase visible when AssistantBot fails offline', async () => {
    renderLayout({
      importer: vi.fn().mockRejectedValue(
        new Error('Unable to preload CSS for /assets/AssistantBot-test.css')
      ),
      online: false,
      route: <CommercialAIAgentsRoute />,
      initialPath: '/agentes-ia',
    });

    expect(await screen.findByRole('heading', { name: 'Agentes IA de Lanzo' })).toBeInTheDocument();
    expect(screen.getByText('Disponible con Lanzo Nube')).toBeInTheDocument();
    expect(screen.getByTestId('layout-shell')).toBeInTheDocument();
    expect(screen.queryByTestId('assistant')).not.toBeInTheDocument();
    expect(screen.queryByTestId('global-error')).not.toBeInTheDocument();
    expect(mocks.recover).not.toHaveBeenCalled();
  });

  it('OFFLINE-LAZY-10 does not change local identity or route state after an offline asset failure', async () => {
    const appSnapshot = { ...mocks.app };
    const licenseSnapshot = mocks.app.licenseDetails;
    const companySnapshot = mocks.app.companyProfile;
    const actorSnapshot = mocks.actorSnapshot;

    renderLayout({
      importer: vi.fn().mockRejectedValue(
        new Error('Unable to preload CSS for /assets/AssistantBot-test.css')
      ),
      online: false,
    });

    await waitFor(() => expect(mocks.warn).toHaveBeenCalledOnce());
    expect(screen.getByTestId('main-route')).toBeInTheDocument();
    expect(screen.queryByTestId('global-error')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.app).toEqual(appSnapshot);
    expect(mocks.app.licenseDetails).toBe(licenseSnapshot);
    expect(mocks.app.companyProfile).toBe(companySnapshot);
    expect(mocks.actorSnapshot).toBe(actorSnapshot);
  });
});
