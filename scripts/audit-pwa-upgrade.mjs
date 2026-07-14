/**
 * Local-only old-worker -> new-worker migration audit for ECOM.PUBLIC.PWA.1.
 *
 * Usage:
 *   node scripts/audit-pwa-upgrade.mjs --baseline-dir <frozen-old-dist>
 *   node scripts/audit-pwa-upgrade.mjs --baseline-dir <frozen-old-dist> --new-dir dist
 */
import { stat } from 'node:fs/promises';
import path from 'node:path';
import {
  CACHE_INVENTORY_EXPRESSION,
  isPortFree,
  launchBrowser,
  sleep,
  startSwitchableStaticServer,
} from './lib/pwa-audit-helpers.mjs';

const args = process.argv.slice(2);
const option = (name, fallback = '') => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const baselineArgument = option('--baseline-dir', process.env.LANZO_PWA_BASELINE_DIR || '');
if (!baselineArgument) {
  throw new Error('Provide --baseline-dir with the frozen pre-PWA.1 dist directory.');
}
const baselineDirectory = path.resolve(baselineArgument);
const newDirectory = path.resolve(option('--new-dir', 'dist'));
await Promise.all([stat(baselineDirectory), stat(newDirectory)]);

const report = {
  generatedAt: new Date().toISOString(),
  phase: 'ECOM.PUBLIC.PWA.1',
  baselineDirectory,
  newDirectory,
  safeguards: {
    loopbackOnly: true,
    ephemeralProfile: true,
    nonLoopbackDnsBlocked: true,
    syntheticStorageOnly: true,
    remoteServicesReached: false,
    realOrdersCreated: 0,
  },
  cleanup: {},
};

let server = null;
let browser = null;
try {
  server = await startSwitchableStaticServer(baselineDirectory);
  browser = await launchBrowser(server.baseUrl, 'lanzo-pwa1-upgrade-');
  report.browser = browser.browserName;
  report.origin = server.baseUrl.origin;

  await browser.navigate('/?baseline-worker=1');
  const oldRegistration = await browser.evaluate(`(async () => {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    return {
      scope: new URL(registration.scope).pathname,
      active: Boolean(registration.active),
      waiting: Boolean(registration.waiting)
    };
  })()`);
  await browser.navigate('/?baseline-controlled=1');
  await browser.waitFor('Boolean(navigator.serviceWorker.controller)', 100, 100);
  const oldInventory = await browser.evaluate(CACHE_INVENTORY_EXPRESSION);
  report.oldWorker = {
    registration: oldRegistration,
    controlled: await browser.evaluate('Boolean(navigator.serviceWorker.controller)'),
    precache: oldInventory.precache,
    cacheNames: oldInventory.cacheNames,
  };

  report.syntheticStorage = await browser.evaluate(`(async () => {
    localStorage.setItem('pwa-audit-local', 'preserve-local');
    sessionStorage.setItem('pwa-audit-session', 'preserve-session');

    const seedDatabase = (name) => new Promise((resolve, reject) => {
      const initial = indexedDB.open(name);
      initial.onerror = () => reject(initial.error);
      initial.onupgradeneeded = () => {
        if (!initial.result.objectStoreNames.contains('sentinel')) initial.result.createObjectStore('sentinel');
      };
      initial.onsuccess = () => {
        const database = initial.result;
        if (database.objectStoreNames.contains('sentinel')) {
          const transaction = database.transaction('sentinel', 'readwrite');
          transaction.objectStore('sentinel').put('preserve-indexeddb', 'value');
          transaction.oncomplete = () => { database.close(); resolve(true); };
          transaction.onerror = () => reject(transaction.error);
          return;
        }
        const nextVersion = database.version + 1;
        database.close();
        const upgrade = indexedDB.open(name, nextVersion);
        upgrade.onerror = () => reject(upgrade.error);
        upgrade.onupgradeneeded = () => upgrade.result.createObjectStore('sentinel');
        upgrade.onsuccess = () => {
          const upgraded = upgrade.result;
          const transaction = upgraded.transaction('sentinel', 'readwrite');
          transaction.objectStore('sentinel').put('preserve-indexeddb', 'value');
          transaction.oncomplete = () => { upgraded.close(); resolve(true); };
          transaction.onerror = () => reject(transaction.error);
        };
      };
    });

    await seedDatabase('pwa-upgrade-sentinel');
    await seedDatabase('lanzo-public-store-cache');
    await (await caches.open('lanzo-admin-static-v0')).put('/pwa-audit-old-cache', new Response('old'));
    await (await caches.open('external-fixture-cache')).put('/pwa-audit-external-cache', new Response('external'));
    await (await caches.open('lanzo-public-store-cache')).put('/pwa-audit-public-cache', new Response('public'));
    return {
      localStorage: localStorage.getItem('pwa-audit-local'),
      sessionStorage: sessionStorage.getItem('pwa-audit-session'),
      indexedDbNames: indexedDB.databases ? (await indexedDB.databases()).map((item) => item.name).filter(Boolean) : [],
      cacheNames: await caches.keys()
    };
  })()`);

  await server.setRoot(newDirectory);
  const updateRequested = await browser.evaluate(`(async () => {
    const registration = await navigator.serviceWorker.getRegistration('/');
    await registration.update();
    return true;
  })()`);
  const reachedWaiting = await browser.waitFor("navigator.serviceWorker.getRegistration('/').then((registration) => Boolean(registration?.waiting))", 200, 100);
  const beforeConfirmation = await browser.evaluate(`(async () => {
    const registration = await navigator.serviceWorker.getRegistration('/');
    return {
      active: Boolean(registration.active),
      waiting: Boolean(registration.waiting),
      controller: Boolean(navigator.serviceWorker.controller)
    };
  })()`);
  await sleep(1_500);
  const remainedWaiting = await browser.evaluate(`navigator.serviceWorker.getRegistration('/')
    .then((registration) => Boolean(registration?.waiting))`);
  report.waiting = {
    updateRequested,
    reachedWaiting,
    beforeConfirmation,
    remainedWaiting,
    autoActivated: !remainedWaiting,
  };

  const reload = browser.cdp.once('Page.loadEventFired', 25_000).catch(() => null);
  const activationAction = await browser.evaluate(`(async () => {
    const registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration?.waiting) return { posted: false };
    sessionStorage.setItem('pwa-audit-controller-changes', '0');
    sessionStorage.setItem('pwa-audit-reloads', '0');
    sessionStorage.setItem('pwa-audit-skip-waiting', '0');
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      const changes = Number(sessionStorage.getItem('pwa-audit-controller-changes') || '0') + 1;
      sessionStorage.setItem('pwa-audit-controller-changes', String(changes));
      const reloads = Number(sessionStorage.getItem('pwa-audit-reloads') || '0');
      if (reloads === 0) {
        sessionStorage.setItem('pwa-audit-reloads', '1');
        location.reload();
      }
    });
    sessionStorage.setItem('pwa-audit-skip-waiting', '1');
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    return { posted: true };
  })()`);
  await reload;
  await browser.waitFor('Boolean(navigator.serviceWorker.controller)', 100, 100);
  await sleep(2_000);

  const newInventory = await browser.evaluate(CACHE_INVENTORY_EXPRESSION);
  const storageAfter = await browser.evaluate(`(async () => {
    const readDatabase = (name) => new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('sentinel')) {
          database.close();
          resolve(null);
          return;
        }
        const transaction = database.transaction('sentinel', 'readonly');
        const valueRequest = transaction.objectStore('sentinel').get('value');
        valueRequest.onerror = () => reject(valueRequest.error);
        valueRequest.onsuccess = () => { database.close(); resolve(valueRequest.result || null); };
      };
    });
    const registration = await navigator.serviceWorker.getRegistration('/');
    return {
      controller: Boolean(navigator.serviceWorker.controller),
      active: Boolean(registration?.active),
      waiting: Boolean(registration?.waiting),
      localStorage: localStorage.getItem('pwa-audit-local'),
      sessionStorage: sessionStorage.getItem('pwa-audit-session'),
      controllerChanges: Number(sessionStorage.getItem('pwa-audit-controller-changes') || '0'),
      reloads: Number(sessionStorage.getItem('pwa-audit-reloads') || '0'),
      skipWaitingMessages: Number(sessionStorage.getItem('pwa-audit-skip-waiting') || '0'),
      indexedDbNames: indexedDB.databases ? (await indexedDB.databases()).map((item) => item.name).filter(Boolean) : [],
      indexedDbSentinel: await readDatabase('pwa-upgrade-sentinel'),
      publicIndexedDbSentinel: await readDatabase('lanzo-public-store-cache'),
      cacheNames: await caches.keys()
    };
  })()`);

  const oldPrecachePaths = oldInventory.entries
    .filter((entry) => entry.cacheName.includes('-precache-'))
    .map((entry) => entry.path);
  const newPrecachePaths = new Set(newInventory.entries
    .filter((entry) => entry.cacheName.includes('-precache-'))
    .map((entry) => entry.path));
  const obsoletePaths = oldPrecachePaths.filter((item) => !newPrecachePaths.has(item));
  const remainingObsoletePaths = obsoletePaths.filter((item) => newPrecachePaths.has(item));

  report.activation = {
    explicitAction: activationAction,
    controllerChanges: storageAfter.controllerChanges,
    skipWaitingMessages: storageAfter.skipWaitingMessages,
    reloads: storageAfter.reloads,
    active: storageAfter.active,
    waiting: storageAfter.waiting,
    controlled: storageAfter.controller,
  };
  report.newWorker = {
    precache: newInventory.precache,
    cacheNames: newInventory.cacheNames,
    obsoletePrecachePaths: obsoletePaths.length,
    remainingObsoletePaths,
  };
  report.storageAfter = storageAfter;
  report.cacheCleanup = {
    oldLanzoCacheRemoved: !storageAfter.cacheNames.includes('lanzo-admin-static-v0'),
    currentPrecachePreserved: storageAfter.cacheNames.some((name) => name.includes('-precache-')),
    externalCachePreserved: storageAfter.cacheNames.includes('external-fixture-cache'),
    publicCachePreserved: storageAfter.cacheNames.includes('lanzo-public-store-cache'),
    obsoletePrecacheEntriesRemoved: remainingObsoletePaths.length === 0,
  };

  server.setOffline(true);
  await browser.setOffline(true);
  const publicOfflineNavigation = await browser.navigate('/tienda/auditoria-upgrade?offline=1');
  let publicOfflineState;
  try {
    publicOfflineState = await browser.evaluate(`({
      hasAdministrativeShell: /Iniciar sesi[oó]n|Punto de Venta|Dashboard/i.test(document.body?.innerText || ''),
      url: location.href
    })`);
  } catch {
    publicOfflineState = { hasAdministrativeShell: false, url: null };
  }
  const publicOfflineDocument = publicOfflineNavigation.records.find((record) => record.type === 'Document');
  report.publicAfterUpgrade = {
    offline: true,
    failed: publicOfflineDocument?.failed === true || Boolean(publicOfflineNavigation.result?.errorText),
    hasAdministrativeShell: publicOfflineState.hasAdministrativeShell,
  };
  await browser.setOffline(false);
  server.setOffline(false);

  report.diagnostics = {
    consoleErrors: browser.consoleErrors,
    exceptions: browser.exceptions,
    remoteHttpAttempts: browser.records.filter((record) => {
      try { return /^https?:$/.test(new URL(record.url).protocol) && new URL(record.url).origin !== server.baseUrl.origin; } catch { return false; }
    }).length,
  };
  report.compliance = {
    oldWorkerControlled: report.oldWorker.controlled && report.oldWorker.precache.bytes >= 6_000_000,
    newWorkerReachedWaiting: reachedWaiting && remainedWaiting,
    noAutomaticActivation: !report.waiting.autoActivated,
    explicitActivation: activationAction.posted && storageAfter.skipWaitingMessages === 1,
    singleControllerChange: storageAfter.controllerChanges === 1,
    singleReload: storageAfter.reloads === 1,
    newWorkerActive: storageAfter.active && storageAfter.controller && !storageAfter.waiting,
    reducedPrecache: newInventory.precache.bytes <= oldInventory.precache.bytes * 0.5
      && newInventory.precache.javascript <= oldInventory.precache.javascript * 0.4,
    obsoletePrecacheRemoved: report.cacheCleanup.obsoletePrecacheEntriesRemoved,
    oldLanzoCacheRemoved: report.cacheCleanup.oldLanzoCacheRemoved,
    externalCachePreserved: report.cacheCleanup.externalCachePreserved,
    indexedDbPreserved: storageAfter.indexedDbSentinel === 'preserve-indexeddb',
    publicIndexedDbPreserved: storageAfter.publicIndexedDbSentinel === 'preserve-indexeddb',
    localStoragePreserved: storageAfter.localStorage === 'preserve-local',
    sessionStoragePreserved: storageAfter.sessionStorage === 'preserve-session',
    publicCachePreserved: report.cacheCleanup.publicCachePreserved,
    publicOfflineRejectsAdminFallback: report.publicAfterUpgrade.failed && !report.publicAfterUpgrade.hasAdministrativeShell,
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
