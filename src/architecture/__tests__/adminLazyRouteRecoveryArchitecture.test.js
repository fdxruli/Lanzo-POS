// @vitest-environment node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const readProjectFile = (relativePath) => readFile(path.join(projectRoot, relativePath), 'utf8');

describe('administrative lazy route recovery architecture', () => {
  it('routes every lazy page failure through the strong version recovery without a global cooldown', async () => {
    const app = await readProjectFile('src/App.jsx');
    const lazyStart = app.indexOf('const lazyRetry');
    const lazyEnd = app.indexOf('const EcommerceOrdersPage', lazyStart);
    const lazySource = app.slice(lazyStart, lazyEnd);

    expect(app).toContain("from './pwa/adminLazyRouteRecovery'");
    expect(lazySource).toContain('await prepareAdminLazyRoute()');
    expect(lazySource).toContain('await recoverAdminLazyRoute({ error })');
    expect(lazySource).toContain('force: true');
    expect(lazySource).not.toMatch(/MAX_RETRIES|GLOBAL_COOLDOWN_MS|lazy_retry_last_time/);
    expect(lazySource).not.toContain('window.location.reload()');
  });


  it('keeps core Local routes eager and reserves lazy recovery for cloud-only surfaces', async () => {
    const app = await readProjectFile('src/App.jsx');

    const eagerImports = [
      "import PosPage from './pages/PosPage';",
      "import CajaPage from './pages/CajaPage';",
      "import OrdersPage from './pages/OrderPage';",
      "import ProductsPage from './pages/ProductsPage';",
      "import CustomersPage from './pages/CustomersPage';",
      "import DashboardPage from './pages/DashboardPage';",
      "import SettingsPage from './pages/SettingsPage';",
      "import AboutPage from './pages/AboutPage';",
    ];

    eagerImports.forEach((statement) => expect(app).toContain(statement));

    expect(app).not.toContain("lazyRetry(() => import('./pages/PosPage')");
    expect(app).not.toContain("lazyRetry(() => import('./pages/CajaPage')");
    expect(app).not.toContain("lazyRetry(() => import('./pages/OrderPage')");
    expect(app).not.toContain("lazyRetry(() => import('./pages/ProductsPage')");
    expect(app).not.toContain("lazyRetry(() => import('./pages/CustomersPage')");
    expect(app).not.toContain("lazyRetry(() => import('./pages/DashboardPage')");
    expect(app).not.toContain("lazyRetry(() => import('./pages/SettingsPage')");
    expect(app).not.toContain("lazyRetry(() => import('./pages/AboutPage')");

    expect(app).toContain("lazyRetry(() => import('./pages/EcommerceOrdersPage')");
    expect(app).toContain("lazyRetry(() => import('./components/ai/CommercialAIAgentsPage')");
    expect(app).toContain("lazyRetry(() => import('./pages/EcommercePortalPage')");
  });

  it('shares one recovery promise and delegates destructive shell work to adminStartupRecovery', async () => {
    const recovery = await readProjectFile('src/pwa/adminLazyRouteRecovery.js');

    expect(recovery).toContain('activeLazyRouteRecoveryPromise');
    expect(recovery).toContain('isRecoverableAdminStartupError(error)');
    expect(recovery).toContain('recoverStartup({ error, force })');
    expect(recovery).not.toMatch(/caches\.delete|unregister\(|location\.reload|location\.replace/);
  });

  it('checks for updates before route imports and while the installed app resumes', async () => {
    const [main, monitor] = await Promise.all([
      readProjectFile('src/main.jsx'),
      readProjectFile('src/pwa/adminServiceWorkerUpdateMonitor.js'),
    ]);

    expect(main).toContain('startAdminServiceWorkerUpdateMonitor');
    expect(monitor).toContain('requestAdminServiceWorkerUpdateCheck');
    expect(monitor).toMatch(/5 \* 60 \* 1000/);
    expect(monitor).toMatch(/60 \* 1000/);
    expect(monitor).toContain("addEventListener?.('visibilitychange'");
    expect(monitor).toContain("addEventListener?.('focus'");
    expect(monitor).toContain("addEventListener?.('online'");
    expect(monitor).toContain("addEventListener?.('pageshow'");
  });
});
