/**
 * Local-only browser audit for FASE ECOM.PUBLIC.ARCH.0.
 *
 * Prerequisites:
 *   npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
 *
 * The script launches an ephemeral headless Chrome profile, accepts only a
 * loopback base URL, and blocks DNS for every non-loopback host. Therefore the
 * public Supabase request can be observed as an attempted request without
 * reaching Supabase. It changes neither application files nor the local build.
 * A direct Service Worker registration is used only to reproduce the state of
 * a previously installed administrative worker without booting the POS.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const baseUrl = new URL(process.argv[2] || 'http://127.0.0.1:4173');
if (baseUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(baseUrl.hostname)) {
  throw new Error('Only a local loopback preview URL is allowed.');
}

const chromeCandidates = [
  path.join(process.env['ProgramFiles(x86)'] || '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
  path.join(process.env.ProgramFiles || '', 'Microsoft/Edge/Application/msedge.exe')
].filter(Boolean);

const { access } = await import('node:fs/promises');
let chromePath = null;
for (const candidate of chromeCandidates) {
  try {
    await access(candidate);
    chromePath = candidate;
    break;
  } catch {
    // Continue with the next local browser candidate.
  }
}
if (!chromePath) throw new Error('Chrome or Edge was not found.');

const debugPort = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : null;
    server.close((error) => (error ? reject(error) : resolve(port)));
  });
});

const profileDirectory = await mkdtemp(path.join(os.tmpdir(), 'lanzo-arch0-chrome-'));
const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-sync',
  '--metrics-recording-only',
  '--remote-debugging-address=127.0.0.1',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDirectory}`,
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
  'about:blank'
], { stdio: 'ignore', windowsHide: true });

async function waitForJson(url, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Chrome is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Chrome DevTools endpoint did not become ready: ${url}`);
}

class CdpSession {
  constructor(webSocketUrl) {
    this.socket = new WebSocket(webSocketUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      const listeners = this.listeners.get(message.method) || [];
      listeners.forEach((listener) => listener(message.params || {}));
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  once(method, timeoutMs = 15_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs);
      const listener = (params) => {
        clearTimeout(timer);
        const listeners = this.listeners.get(method) || [];
        this.listeners.set(method, listeners.filter((candidate) => candidate !== listener));
        resolve(params);
      };
      this.on(method, listener);
    });
  }
}

const target = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`)
  .then((targets) => targets.find((candidate) => candidate.type === 'page'));
if (!target?.webSocketDebuggerUrl) throw new Error('No Chrome page target was available.');

const cdp = new CdpSession(target.webSocketDebuggerUrl);
const requests = new Map();

function isLocalUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.origin === baseUrl.origin;
  } catch {
    return false;
  }
}

cdp.on('Network.requestWillBeSent', ({ requestId, request, type }) => {
  requests.set(requestId, {
    url: request.url,
    type,
    encodedBytes: 0,
    failed: false,
    fromDiskCache: false,
    fromServiceWorker: false
  });
});
cdp.on('Network.responseReceived', ({ requestId, response }) => {
  const record = requests.get(requestId);
  if (!record) return;
  record.fromDiskCache = response.fromDiskCache === true;
  record.fromServiceWorker = response.fromServiceWorker === true;
  record.status = response.status;
});
cdp.on('Network.loadingFinished', ({ requestId, encodedDataLength }) => {
  const record = requests.get(requestId);
  if (record) record.encodedBytes = Number(encodedDataLength) || 0;
});
cdp.on('Network.loadingFailed', ({ requestId, errorText }) => {
  const record = requests.get(requestId);
  if (!record) return;
  record.failed = true;
  record.errorText = errorText;
});

await cdp.open();
await Promise.all([
  cdp.send('Page.enable'),
  cdp.send('Network.enable'),
  cdp.send('Runtime.enable'),
  cdp.send('ServiceWorker.enable')
]);

async function navigate(pathname) {
  requests.clear();
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: new URL(pathname, baseUrl).href });
  await loaded;
  await new Promise((resolve) => setTimeout(resolve, 2_000));
}

async function evaluate(expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed.');
  return result.result?.value;
}

function requestMetrics() {
  const records = [...requests.values()];
  const local = records.filter((record) => isLocalUrl(record.url));
  const localJavaScript = local.filter((record) => new URL(record.url).pathname.endsWith('.js'));
  const localCss = local.filter((record) => new URL(record.url).pathname.endsWith('.css'));
  const adminPattern = /(App-|PosPage|Caja|Dashboard|Settings|ProductsPage|CustomersPage|OrderPage|AssistantBot|ScannerModal|vendor_charts)/i;
  return {
    totalRequests: records.length,
    localRequests: local.length,
    blockedRemoteAttempts: records.filter((record) => !isLocalUrl(record.url) && /^https?:/.test(record.url)).length,
    localTransferredBytes: local.reduce((total, record) => total + record.encodedBytes, 0),
    javascriptRequests: localJavaScript.length,
    javascriptTransferredBytes: localJavaScript.reduce((total, record) => total + record.encodedBytes, 0),
    cssRequests: localCss.length,
    cssTransferredBytes: localCss.reduce((total, record) => total + record.encodedBytes, 0),
    manifestRequests: local.filter((record) => new URL(record.url).pathname.endsWith('manifest.webmanifest')).length,
    administrativeNamedChunks: localJavaScript
      .map((record) => new URL(record.url).pathname.split('/').at(-1))
      .filter((name) => adminPattern.test(name)),
    diskCacheResponses: local.filter((record) => record.fromDiskCache).length,
    serviceWorkerResponses: local.filter((record) => record.fromServiceWorker).length,
    failedRequests: records.filter((record) => record.failed).length,
    localResourceNames: local.map((record) => new URL(record.url).pathname.split('/').at(-1))
  };
}

const testPath = `/tienda/mi-negocio`;
await navigate(testPath);
const cleanMetrics = requestMetrics();
const cleanState = await evaluate(`(async () => ({
  title: document.title,
  bodyTextLength: document.body.innerText.trim().length,
  hasContent: document.body.innerText.trim().length > 0,
  hasErrorOverlay: Boolean(document.querySelector('.vite-error-overlay, #webpack-dev-server-client-overlay')),
  manifestLinks: Array.from(document.querySelectorAll('link[rel="manifest"]')).map((link) => link.getAttribute('href')),
  pwaMeta: {
    themeColor: document.querySelector('meta[name="theme-color"]')?.content || null,
    appleCapable: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.content || null,
    mobileCapable: document.querySelector('meta[name="mobile-web-app-capable"]')?.content || null,
    appleTouchIcon: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href') || null
  },
  serviceWorkerRegistrations: (await navigator.serviceWorker.getRegistrations()).length,
  serviceWorkerControlled: Boolean(navigator.serviceWorker.controller),
  indexedDbNames: indexedDB.databases ? (await indexedDB.databases()).map((db) => db.name).filter(Boolean) : [],
  catalogVisible: Boolean(document.querySelector('[data-catalog-revision]')),
  checkoutAvailable: Boolean(document.querySelector('button.public-cart-checkout:not(:disabled)'))
}))()`);

await navigate(testPath);
const repeatedMetrics = requestMetrics();
const repeatedState = await evaluate(`(async () => ({
  serviceWorkerRegistrations: (await navigator.serviceWorker.getRegistrations()).length,
  serviceWorkerControlled: Boolean(navigator.serviceWorker.controller),
  indexedDbNames: indexedDB.databases ? (await indexedDB.databases()).map((db) => db.name).filter(Boolean) : [],
  catalogVisible: Boolean(document.querySelector('[data-catalog-revision]')),
  checkoutAvailable: Boolean(document.querySelector('button.public-cart-checkout:not(:disabled)'))
}))()`);

requests.clear();
const registrationState = await evaluate(`(async () => {
  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  return {
    scope: registration.scope,
    active: Boolean(registration.active),
    waiting: Boolean(registration.waiting),
    installing: Boolean(registration.installing)
  };
})()`);
await new Promise((resolve) => setTimeout(resolve, 2_000));
const installMetrics = requestMetrics();

await navigate(testPath);
const controlledMetrics = requestMetrics();
const controlledState = await evaluate(`(async () => ({
  serviceWorkerRegistrations: (await navigator.serviceWorker.getRegistrations()).length,
  serviceWorkerControlled: Boolean(navigator.serviceWorker.controller),
  controllerScript: navigator.serviceWorker.controller?.scriptURL
    ? new URL(navigator.serviceWorker.controller.scriptURL).pathname
    : null,
  cacheNames: await caches.keys(),
  precache: await (async () => {
    const names = await caches.keys();
    const entries = [];
    for (const name of names) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        entries.push({
          path: new URL(request.url).pathname,
          bytes: response ? (await response.clone().arrayBuffer()).byteLength : 0
        });
      }
    }
    const adminPattern = /(App-|PosPage|Caja|Dashboard|Settings|ProductsPage|CustomersPage|OrderPage|AssistantBot|ScannerModal|vendor_charts)/i;
    return {
      entries: entries.length,
      responseBodyBytes: entries.reduce((total, entry) => total + entry.bytes, 0),
      javascriptEntries: entries.filter((entry) => entry.path.endsWith('.js')).length,
      administrativeNamedEntries: entries.filter((entry) => adminPattern.test(entry.path)).length
    };
  })()
}))()`);

const report = {
  generatedAt: new Date().toISOString(),
  browser: path.basename(chromePath),
  safeguards: {
    ephemeralProfile: true,
    nonLoopbackDnsBlocked: true,
    remoteServicesReached: false,
    directServiceWorkerRegistrationIsControlledSimulation: true
  },
  cleanStoreVisit: {
    route: testPath,
    metrics: cleanMetrics,
    state: cleanState
  },
  repeatedStoreVisitWithoutPublicData: {
    route: testPath,
    metrics: repeatedMetrics,
    state: repeatedState
  },
  controlledAdministrativeServiceWorker: {
    registration: registrationState,
    installRequestObservation: installMetrics,
    revisitMetrics: controlledMetrics,
    revisitState: controlledState
  }
};

try {
  await cdp.send('Browser.close');
} catch {
  chrome.kill();
}
cdp.socket.close();
await Promise.race([
  new Promise((resolve) => chrome.once('exit', resolve)),
  new Promise((resolve) => setTimeout(resolve, 2_000))
]);
if (chrome.exitCode === null) chrome.kill();

for (let attempt = 0; attempt < 10; attempt += 1) {
  try {
    await rm(profileDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    break;
  } catch (error) {
    if (attempt === 9) report.safeguards.profileCleanupWarning = error.code || error.message;
    else await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

console.log(JSON.stringify(report, null, 2));
