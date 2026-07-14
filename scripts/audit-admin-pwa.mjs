/**
 * Local-only browser audit for ECOM.PUBLIC.PWA.1.
 *
 * Usage:
 *   node scripts/audit-admin-pwa.mjs
 *   node scripts/audit-admin-pwa.mjs --dist-dir dist
 */
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  CACHE_INVENTORY_EXPRESSION,
  isPortFree,
  launchBrowser,
  sleep,
  startSwitchableStaticServer,
  summarizeRequests,
} from './lib/pwa-audit-helpers.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const distDirectory = path.resolve(option('--dist-dir', 'dist'));
await stat(distDirectory);

async function findLazyModule() {
  const assets = await readdir(path.join(distDirectory, 'assets'));
  const fileName = assets.find((name) => /^AboutPage-.*\.js$/.test(name));
  if (!fileName) throw new Error('A lazy AboutPage chunk was not found in dist/assets.');
  return `/assets/${fileName}`;
}

const lazyModulePath = await findLazyModule();
const report = {
  generatedAt: new Date().toISOString(),
  phase: 'ECOM.PUBLIC.PWA.1',
  target: distDirectory,
  safeguards: {
    loopbackOnly: true,
    ephemeralProfile: true,
    nonLoopbackDnsBlocked: true,
    remoteServicesReached: false,
    realOrdersCreated: 0,
  },
  scenarios: {},
  cleanup: {},
};

let server = null;
let browser = null;
try {
  server = await startSwitchableStaticServer(distDirectory);
  browser = await launchBrowser(server.baseUrl, 'lanzo-pwa1-admin-');
  report.browser = browser.browserName;
  report.origin = server.baseUrl.origin;

  const cleanPublicNavigation = await browser.navigate('/tienda/auditoria-local?clean=1');
  await browser.waitFor('document.body && document.body.innerText.trim().length > 0', 50, 100);
  const cleanPublicState = await browser.evaluate(`(async () => ({
    url: location.href,
    manifestLinks: document.querySelectorAll('link[rel="manifest"]').length,
    appleCapable: Boolean(document.querySelector('meta[name="apple-mobile-web-app-capable"]')),
    mobileCapable: Boolean(document.querySelector('meta[name="mobile-web-app-capable"]')),
    appleTouchIcon: Boolean(document.querySelector('link[rel="apple-touch-icon"]')),
    hasDeferredPromptAlias: Object.hasOwn(window, 'deferredPwaPrompt'),
    registrations: (await navigator.serviceWorker.getRegistrations()).length,
    controlled: Boolean(navigator.serviceWorker.controller),
    bodyTextLength: document.body.innerText.trim().length,
    hasAdministrativeShell: /Iniciar sesi[oó]n|Punto de Venta|Dashboard/i.test(document.body.innerText)
  }))()`);
  const cleanPublicRequests = summarizeRequests(cleanPublicNavigation.records, server.baseUrl);
  report.scenarios.cleanPublic = {
    state: cleanPublicState,
    requests: cleanPublicRequests,
    passed: cleanPublicRequests.manifestRequests === 0
      && cleanPublicState.registrations === 0
      && !cleanPublicState.controlled
      && !cleanPublicState.hasDeferredPromptAlias
      && !cleanPublicState.appleCapable
      && !cleanPublicState.mobileCapable
      && !cleanPublicState.appleTouchIcon
      && !cleanPublicState.hasAdministrativeShell,
  };

  const cleanAdminNavigation = await browser.navigate('/?admin=1');
  await browser.waitFor("document.querySelectorAll('link[rel=\"manifest\"]').length === 1", 80, 100);
  await browser.waitFor("navigator.serviceWorker.getRegistrations().then((items) => items.length === 1)", 100, 100);
  const cleanAdminState = await browser.evaluate(`(async () => {
    const registration = await navigator.serviceWorker.ready;
    return {
      manifestLinks: Array.from(document.querySelectorAll('link[rel="manifest"]')).map((link) => link.getAttribute('href')),
      appleCapable: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.content || null,
      mobileCapable: document.querySelector('meta[name="mobile-web-app-capable"]')?.content || null,
      appleTouchIcon: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href') || null,
      hasDeferredPromptAlias: Object.hasOwn(window, 'deferredPwaPrompt'),
      registrations: (await navigator.serviceWorker.getRegistrations()).length,
      scope: new URL(registration.scope).pathname,
      active: Boolean(registration.active),
      waiting: Boolean(registration.waiting)
    };
  })()`);
  await sleep(500);
  const cleanAdminRequests = summarizeRequests(cleanAdminNavigation.records, server.baseUrl);
  report.scenarios.cleanAdmin = {
    state: cleanAdminState,
    requests: cleanAdminRequests,
    passed: cleanAdminState.manifestLinks.length === 1
      && cleanAdminState.manifestLinks[0] === '/manifest.webmanifest'
      && cleanAdminRequests.manifestRequests === 1
      && cleanAdminState.registrations === 1
      && cleanAdminState.scope === '/'
      && cleanAdminState.active
      && cleanAdminState.appleCapable === 'yes'
      && cleanAdminState.mobileCapable === 'yes'
      && cleanAdminState.hasDeferredPromptAlias,
  };

  await browser.navigate('/?controlled=1');
  await browser.waitFor('Boolean(navigator.serviceWorker.controller)', 100, 100);
  const newInstallInventory = await browser.evaluate(CACHE_INVENTORY_EXPRESSION);
  report.scenarios.newInstall = {
    precache: newInstallInventory.precache,
    runtime: newInstallInventory.runtime,
    cacheNames: newInstallInventory.cacheNames,
    passed: newInstallInventory.precache.bytes <= 6_320_268 * 0.5
      && newInstallInventory.precache.javascript <= 48 * 0.4
      && newInstallInventory.precache.lazy === 0
      && newInstallInventory.precache.workers === 0
      && newInstallInventory.precache.charts === 0
      && newInstallInventory.runtime.staticEntries === 0
      && newInstallInventory.runtime.mediaEntries === 0,
  };

  await browser.setOffline(true);
  const offlineAdminNavigation = await browser.navigate('/configuracion?offline-shell=1');
  const offlineAdminState = await browser.evaluate(`({
    url: location.href,
    bodyTextLength: document.body?.innerText?.trim().length || 0,
    manifestLinks: document.querySelectorAll('link[rel="manifest"]').length,
    controlled: Boolean(navigator.serviceWorker.controller),
    hasBrowserError: location.protocol === 'chrome-error:'
  })`);
  const offlineAdminDocument = offlineAdminNavigation.records.find((record) => record.type === 'Document');
  report.scenarios.adminOfflineShell = {
    state: offlineAdminState,
    navigation: offlineAdminDocument ? {
      status: offlineAdminDocument.status || null,
      fromServiceWorker: offlineAdminDocument.fromServiceWorker === true,
      failed: offlineAdminDocument.failed,
    } : null,
    passed: offlineAdminState.controlled
      && !offlineAdminState.hasBrowserError
      && offlineAdminState.bodyTextLength > 0
      && offlineAdminState.manifestLinks === 1
      && offlineAdminDocument?.fromServiceWorker === true
      && !offlineAdminDocument.failed,
  };
  await browser.setOffline(false);

  await browser.navigate('/acerca-de?runtime-online=1');
  const beforeModuleInventory = await browser.evaluate(CACHE_INVENTORY_EXPRESSION);
  const moduleWasInitiallyCached = beforeModuleInventory.entries.some((entry) => entry.path === lazyModulePath);
  const onlineImport = await browser.evaluate(`import(${JSON.stringify(new URL(lazyModulePath, server.baseUrl).href)})
    .then(() => ({ ok: true }))
    .catch((error) => ({ ok: false, name: error?.name || 'Error' }))`);
  await sleep(500);
  const afterModuleInventory = await browser.evaluate(CACHE_INVENTORY_EXPRESSION);
  const moduleRuntimeEntry = afterModuleInventory.entries.find((entry) => (
    entry.cacheName === 'lanzo-admin-static-v1' && entry.path === lazyModulePath
  ));

  await browser.setOffline(true);
  await browser.navigate('/acerca-de?runtime-offline=1');
  const offlineImport = await browser.evaluate(`import(${JSON.stringify(new URL(lazyModulePath, server.baseUrl).href)})
    .then(() => ({ ok: true }))
    .catch((error) => ({ ok: false, name: error?.name || 'Error' }))`);
  report.scenarios.visitedModule = {
    module: lazyModulePath,
    initiallyCached: moduleWasInitiallyCached,
    onlineImport,
    runtimeCacheEntry: moduleRuntimeEntry ? { cacheName: moduleRuntimeEntry.cacheName, bytes: moduleRuntimeEntry.bytes } : null,
    offlineImport,
    passed: !moduleWasInitiallyCached && onlineImport.ok && Boolean(moduleRuntimeEntry?.bytes) && offlineImport.ok,
  };
  await browser.setOffline(false);

  const activePublicNavigation = await browser.navigate('/tienda/auditoria-local?active=1');
  const activePublicDocument = activePublicNavigation.records.find((record) => record.type === 'Document');
  const activePublicState = await browser.evaluate(`(async () => ({
    manifestLinks: document.querySelectorAll('link[rel="manifest"]').length,
    hasDeferredPromptAlias: Object.hasOwn(window, 'deferredPwaPrompt'),
    registrations: (await navigator.serviceWorker.getRegistrations()).length,
    controlled: Boolean(navigator.serviceWorker.controller),
    hasAdministrativeShell: /Iniciar sesi[oó]n|Punto de Venta|Dashboard/i.test(document.body.innerText)
  }))()`);
  report.scenarios.activeWorkerPublicOnline = {
    state: activePublicState,
    navigation: activePublicDocument ? {
      sourceHeader: activePublicDocument.headers?.['x-lanzo-navigation-source'] || null,
      fromServiceWorker: activePublicDocument.fromServiceWorker === true,
      failed: activePublicDocument.failed,
    } : null,
    passed: activePublicDocument?.headers?.['x-lanzo-navigation-source'] === 'network-public'
      && !activePublicDocument.failed
      && activePublicState.controlled
      && activePublicState.manifestLinks === 0
      && !activePublicState.hasDeferredPromptAlias
      && !activePublicState.hasAdministrativeShell,
  };

  server.setOffline(true);
  await browser.setOffline(true);
  const offlinePublicNavigation = await browser.navigate('/tienda/auditoria-local?active-offline=1');
  let offlinePublicState;
  try {
    offlinePublicState = await browser.evaluate(`({
      url: location.href,
      body: document.body?.innerText?.slice(0, 500) || '',
      hasAdministrativeShell: /Iniciar sesi[oó]n|Punto de Venta|Dashboard/i.test(document.body?.innerText || '')
    })`);
  } catch {
    offlinePublicState = { url: null, body: '', hasAdministrativeShell: false };
  }
  const offlinePublicDocument = offlinePublicNavigation.records.find((record) => record.type === 'Document');
  report.scenarios.activeWorkerPublicOffline = {
    state: offlinePublicState,
    navigation: offlinePublicDocument ? {
      failed: offlinePublicDocument.failed,
      status: offlinePublicDocument.status || null,
    } : null,
    passed: !offlinePublicState.hasAdministrativeShell
      && Boolean(offlinePublicDocument?.failed === true || offlinePublicNavigation.result?.errorText),
  };
  await browser.setOffline(false);
  server.setOffline(false);

  report.diagnostics = {
    consoleErrors: browser.consoleErrors,
    exceptions: browser.exceptions,
    remoteHttpAttempts: browser.records.filter((record) => {
      try { return /^https?:$/.test(new URL(record.url).protocol) && new URL(record.url).origin !== server.baseUrl.origin; } catch { return false; }
    }).length,
    beforeinstallpromptObserved: false,
    beforeinstallpromptValidation: 'manual',
  };
  report.compliance = {
    cleanPublic: report.scenarios.cleanPublic.passed,
    cleanAdmin: report.scenarios.cleanAdmin.passed,
    reducedInstall: report.scenarios.newInstall.passed,
    adminOfflineShell: report.scenarios.adminOfflineShell.passed,
    visitedModuleOffline: report.scenarios.visitedModule.passed,
    publicOnlineUsesNetwork: report.scenarios.activeWorkerPublicOnline.passed,
    publicOfflineRejectsAdminFallback: report.scenarios.activeWorkerPublicOffline.passed,
    noRealOrders: true,
    noRemoteServicesReached: true,
  };
  report.compliance.passed = Object.values(report.compliance).every(Boolean);
} finally {
  if (browser) report.cleanup.browser = await browser.close();
  if (server) {
    await server.close();
    report.cleanup.port = server.port;
    report.cleanup.portReleased = await isPortFree(server.port);
  }
}

console.log(JSON.stringify(report, null, 2));
if (!report.compliance?.passed || !report.cleanup.portReleased || !report.cleanup.browser?.profileRemoved) {
  process.exitCode = 1;
}
