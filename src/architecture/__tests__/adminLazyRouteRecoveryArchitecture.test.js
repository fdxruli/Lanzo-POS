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
    const lazyEnd = app.indexOf('const PosPage', lazyStart);
    const lazySource = app.slice(lazyStart, lazyEnd);

    expect(app).toContain("from './pwa/adminLazyRouteRecovery'");
    expect(lazySource).toContain('await prepareAdminLazyRoute()');
    expect(lazySource).toContain('await recoverAdminLazyRoute({ error })');
    expect(lazySource).toContain('force: true');
    expect(lazySource).not.toMatch(/MAX_RETRIES|GLOBAL_COOLDOWN_MS|lazy_retry_last_time/);
    expect(lazySource).not.toContain('window.location.reload()');
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
