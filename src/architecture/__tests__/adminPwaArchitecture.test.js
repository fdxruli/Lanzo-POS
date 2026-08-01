// @vitest-environment node
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const readProjectFile = (relativePath) => readFile(path.join(projectRoot, relativePath), 'utf8');

async function walk(relativeDirectory) {
  const directory = path.join(projectRoot, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(relativePath));
    else if (entry.isFile()) files.push(relativePath.replaceAll('\\', '/'));
  }
  return files;
}

async function precacheInventory() {
  const source = await readProjectFile('dist/sw.js');
  const urls = Array.from(source.matchAll(/[,{](?:url|"url"):"([^"]+)"/g), (match) => match[1]);
  const uniqueUrls = [...new Set(urls)];
  const files = await Promise.all(uniqueUrls.map(async (url) => {
    const filePath = path.join(projectRoot, 'dist', url);
    return { url, bytes: (await stat(filePath)).size, extension: path.extname(url) };
  }));
  return { urls, uniqueUrls, files };
}

describe('ECOM.PUBLIC.PWA.1 architecture', () => {
  it('keeps the shared source HTML free of globally requested PWA identity', async () => {
    const html = await readProjectFile('index.html');

    expect(html).not.toMatch(/rel=["']manifest|beforeinstallprompt|appinstalled/i);
    expect(html).not.toMatch(/apple-mobile-web-app-capable|mobile-web-app-capable|apple-touch-icon/i);
  });

  it('disables plugin HTML injection while preserving an emitted administrative manifest', async () => {
    const config = await readProjectFile('vite.config.js');

    expect(config).toMatch(/injectRegister:\s*false/);
    expect(config).toMatch(/manifest:\s*false/);
    expect(config).toContain("fileName: 'manifest.webmanifest'");
    expect(config).toMatch(/strategies:\s*'injectManifest'/);
  });

  it('fails the production build when the generated startup closure is not completely precached', async () => {
    const [config, audit] = await Promise.all([
      readProjectFile('vite.config.js'),
      readProjectFile('scripts/admin-startup-precache-audit.mjs'),
    ]);

    expect(config).toContain('createAdminStartupPrecacheAuditPlugin()');
    expect(audit).toContain('findMissingStartupPrecacheAssets');
    expect(audit).toContain('Administrative startup assets are missing from the Service Worker precache');
    expect(audit).toMatch(/async closeBundle\(\)[\s\S]*auditAdminStartupPrecache/);
  });

  it('starts install and worker infrastructure only in the administrative branch', async () => {
    const main = await readProjectFile('src/main.jsx');
    const publicStart = main.indexOf('if (isPublicStorePath');
    const adminStart = main.indexOf('} else {', publicStart);
    const publicBranch = main.slice(publicStart, adminStart);
    const adminBranch = main.slice(adminStart);

    expect(publicStart).toBeGreaterThanOrEqual(0);
    expect(adminStart).toBeGreaterThan(publicStart);
    expect(publicBranch).not.toMatch(/installAdminPwaDocument\(|startAdminInstallPromptCapture\(|startAdminServiceWorker\(/);
    expect(publicBranch).toContain('updateExistingAdminWorkerOnPublicRoute()');
    expect(adminBranch).toMatch(/installAdminPwaDocument\(\)[\s\S]*startAdminInstallPromptCapture\(\)[\s\S]*startAdminServiceWorker\(\)/);
  });

  it('mounts the recovery bootstrap before business runtime and keeps the public route isolated', async () => {
    const [main, bootstrap] = await Promise.all([
      readProjectFile('src/main.jsx'),
      readProjectFile('src/components/common/PosApplicationBootstrap.jsx')
    ]);
    const renderStart = main.indexOf('async function renderPosApplication');
    const routeStart = main.indexOf('if (isPublicStorePath');
    const renderPosSource = main.slice(renderStart, routeStart);
    const publicStart = routeStart;
    const adminStart = main.indexOf('} else {', publicStart);
    const publicBranch = main.slice(publicStart, adminStart);
    const staticBootstrapImports = bootstrap.slice(0, bootstrap.indexOf('export const loadPosReadyRuntime'));

    expect(renderStart).toBeGreaterThanOrEqual(0);
    expect(renderPosSource).toContain("import('./services/db/databaseRuntime')");
    expect(renderPosSource).toContain("import('./components/common/PosApplicationBootstrap')");
    expect(renderPosSource).toMatch(/ReactDOM\.createRoot\(rootElement\)\.render\([\s\S]*PosApplicationBootstrap/);
    expect(renderPosSource).not.toMatch(/prepareLocalDatabase\(|import\('\.\/App|posSyncBootstrapAutoCoordinator|productStoreRecoveryGuard/);
    expect(publicBranch).not.toMatch(/databaseRuntime|PosApplicationBootstrap|DatabaseRecoveryGate|App\.jsx/);
    expect(staticBootstrapImports).not.toMatch(/App\.jsx|useAppStore|useProductStore|posSyncBootstrapAutoCoordinator|productStoreRecoveryGuard/);
    expect(bootstrap).toContain("import('../../App.jsx')");
    expect(bootstrap).toContain("import('../../services/sync/posSyncBootstrapAutoCoordinator')");
    expect(bootstrap).toMatch(/recovery\.status !== DATABASE_RECOVERY_STATUS\.READY/);
  });

  it('generates a valid Lanzo POS manifest without injecting it into dist HTML', async () => {
    const [html, manifestSource] = await Promise.all([
      readProjectFile('dist/index.html'),
      readProjectFile('dist/manifest.webmanifest'),
    ]);
    const manifest = JSON.parse(manifestSource);

    expect(html.match(/rel=["']manifest/gi) || []).toHaveLength(0);
    expect(manifest).toMatchObject({ name: 'Lanzo POS', scope: '/', start_url: '/', display: 'standalone' });
    expect(manifest.icons).toHaveLength(3);
  });

  it('keeps the public standalone build completely PWA-free', async () => {
    const files = await walk('dist-store');
    const joined = files.join('\n');
    const html = await readProjectFile('dist-store/index.html');

    expect(joined).not.toMatch(/(?:^|\/)sw\.js$|workbox-|manifest\.webmanifest/i);
    expect(html).not.toMatch(/rel=["']manifest|beforeinstallprompt|appinstalled|serviceWorker/i);
  });

  it('keeps prompt activation while limiting forced takeover to one completed bridge', async () => {
    const [registration, worker, bridge] = await Promise.all([
      readProjectFile('src/pwa/adminServiceWorker.js'),
      readProjectFile('src/pwa/sw.js'),
      readProjectFile('src/pwa/adminUpgradeBridge.js'),
    ]);

    expect(registration).toMatch(/scope:\s*['"]\/['"]/);
    expect(worker).toMatch(/event\.data\?\.type !== 'SKIP_WAITING'[\s\S]*self\.skipWaiting\(\)/);
    expect(worker).toContain('requestAdminUpgradeBridgeInstall');
    expect(worker).toContain('activateAdminUpgradeBridge');
    expect(bridge).toContain("lanzo-admin-upgrade-bridge-v1");
    expect(bridge).toMatch(/registration\?\.active/);
    expect(bridge).toContain("reason: 'already-completed'");
    expect(bridge).toContain('await clients.claim()');
    expect(bridge).toContain('PUBLIC_NAVIGATION_DENYLIST');
  });

  it('uses anchored public, api, and auth exclusions plus explicit NetworkOnly', async () => {
    const [policy, worker] = await Promise.all([
      readProjectFile('src/pwa/publicNavigationPolicy.js'),
      readProjectFile('src/pwa/sw.js'),
    ]);

    expect(policy).toMatch(/\^\\\/api/);
    expect(policy).toMatch(/\^\\\/auth/);
    expect(policy).toMatch(/\^\\\/tienda/);
    expect(policy).toMatch(/\^\\\/conoce-lanzo/);
    expect(worker).toMatch(/isPublicNavigationRequest[\s\S]*new NetworkOnly\(\)/);
  });

  it('reduces precache bodies by at least 50% and JavaScript count by at least 55%', async () => {
    const inventory = await precacheInventory();
    const bytes = inventory.files.reduce((total, file) => total + file.bytes, 0);
    const javascriptCount = inventory.files.filter((file) => file.extension === '.js').length;

    expect(bytes).toBeLessThanOrEqual(6_320_268 * 0.5);
    expect(javascriptCount).toBeLessThanOrEqual(48 * 0.45);
    expect(inventory.urls).toHaveLength(inventory.uniqueUrls.length);
  });

  it('precache includes the minimum shell and excludes lazy pages, workers, and charts', async () => {
    const inventory = await precacheInventory();
    const joined = inventory.uniqueUrls.join('\n');

    expect(inventory.uniqueUrls).toContain('index.html');
    expect(inventory.uniqueUrls).toContain('manifest.webmanifest');
    expect(joined).toMatch(/assets\/index-.*\.js/);
    expect(joined).toMatch(/assets\/App-.*\.js/);
    expect(joined).toMatch(/assets\/databaseRuntime-.*\.js/);
    expect(joined).toMatch(/assets\/PosApplicationBootstrap-.*\.js/);
    expect(joined).toMatch(/assets\/useMessageStore-.*\.js/);
    expect(joined).toMatch(/assets\/useInventoryCatalogStore-.*\.js/);
    expect(joined).toMatch(/assets\/productStoreRecoveryGuard-.*\.js/);
    expect(joined).toMatch(/assets\/DevConsole-.*\.js/);
    expect(joined).toMatch(/assets\/DevConsole-.*\.css/);
    expect(joined).not.toMatch(/PosPage|CajaPage|OrderPage|EcommerceOrdersPage|ProductsPage|CustomersPage|DashboardPage|SettingsPage|AboutPage/);
    expect(joined).not.toMatch(/\.worker-|vendor_charts|AssistantBot|ScannerModal/);
  });

  it('defines bounded versioned runtime caches and status-200-only writes', async () => {
    const [worker, runtimePolicy] = await Promise.all([
      readProjectFile('src/pwa/sw.js'),
      readProjectFile('src/pwa/adminRuntimeCache.js'),
    ]);

    expect(runtimePolicy).toContain('lanzo-admin-static-v1');
    expect(runtimePolicy).toContain('lanzo-admin-media-v1');
    expect(worker).toMatch(/maxEntries:\s*60/);
    expect(worker).toMatch(/maxEntries:\s*30/);
    expect(worker).toMatch(/maxAgeSeconds:/);
    expect(worker).toMatch(/statuses:\s*\[200\]/);
  });

  it('does not unregister the PWA or broadly clear origin caches from App recovery', async () => {
    const app = await readProjectFile('src/App.jsx');

    expect(app).not.toMatch(/registration\.unregister|getRegistrations\(/);
    expect(app).toContain('clearCurrentAdminRuntimeCaches(window.caches)');
  });

  it('preserves explicit waiting activation in UpdatePrompt without virtual auto registration', async () => {
    const prompt = await readProjectFile('src/components/common/UpdatePrompt.jsx');

    expect(prompt).toContain('activateAdminServiceWorkerUpdate');
    expect(prompt).toContain('workerState.waiting');
    expect(prompt).not.toMatch(/virtual:pwa-register|useRegisterSW/);
  });
});
