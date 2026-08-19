// @vitest-environment node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const readProjectFile = (relativePath) => readFile(path.join(projectRoot, relativePath), 'utf8');

describe('administrative startup version recovery architecture', () => {
  it('precache includes both dynamic modules required before the administrative app can mount', async () => {
    const config = await readProjectFile('vite.config.js');

    expect(config).toContain("'assets/databaseRuntime-*.js'");
    expect(config).toContain("'assets/PosApplicationBootstrap-*.{js,css}'");
  });

  it('detects stale imports in both startup phases and keeps the manual action on the same recovery path', async () => {
    const [main, bootstrap, recovery] = await Promise.all([
      readProjectFile('src/main.jsx'),
      readProjectFile('src/components/common/PosApplicationBootstrap.jsx'),
      readProjectFile('src/pwa/adminStartupRecovery.js'),
    ]);

    expect(main).toContain('isRecoverableAdminStartupError(error)');
    expect(main).toContain("renderStartupRecoveryScreen({ mode: 'recovering' })");
    expect(main).toContain('recoverAdminStartup({ error })');
    expect(main).toContain('recoverAdminStartup({ error, force: true })');
    expect(main).not.toContain('completeAdminStartupRecovery()');

    expect(bootstrap).toContain('isRecoverableAdminStartupError(error)');
    expect(bootstrap).toContain('const result = await recoverStartup({ error })');
    expect(bootstrap).toContain('force: true');
    expect(bootstrap).toContain('completeStartupRecovery();');
    expect(bootstrap).toContain('reloadPage = () => window.location.reload()');
    expect(bootstrap).toContain('const retryAdministrativeStart = () => reloadPage();');

    expect(recovery).toContain("const RECOVERY_ATTEMPT_KEY = 'lanzo:admin-startup-recovery:v1'");
    expect(recovery).toContain('function getSessionStorage(windowTarget)');
    expect(recovery).toContain('hasRecoveryQueryForCurrentBuild(windowTarget)');
    expect(recovery).toMatch(/Failed to fetch dynamically imported module/);
    expect(recovery).toMatch(/SKIP_WAITING/);
    expect(recovery).toMatch(/__lanzo_recovery/);
  });

  it('limits the hard reset to the root Lanzo worker and Lanzo-owned Cache Storage entries', async () => {
    const recovery = await readProjectFile('src/pwa/adminStartupRecovery.js');

    expect(recovery).toMatch(/scope\.origin === origin && scope\.pathname === '\/'/);
    expect(recovery).toMatch(/workbox-precache/);
    expect(recovery).toMatch(/lanzo-admin-\(\?:static\|media\)/);
    expect(recovery).not.toMatch(/indexedDB\.deleteDatabase|localStorage\.clear|sessionStorage\.clear/);
  });

  it('keeps actual static files and missing hashed assets outside the SPA fallback', async () => {
    const config = JSON.parse(await readProjectFile('vercel.json'));
    const fallback = config.rewrites.find(({ destination }) => destination === '/index.html');

    expect(fallback?.source).toContain('(?!assets/');
    expect(fallback?.source).toContain('sw\\.js$');
    expect(fallback?.source).toContain('workbox-');
    expect(fallback?.source).toContain('manifest\\.webmanifest$');
    expect(fallback?.source).not.toBe('/(.*)');
  });
});
