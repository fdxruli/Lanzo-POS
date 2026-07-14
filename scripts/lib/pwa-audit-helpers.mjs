import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function getOpenPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

export async function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

export function assertLoopbackUrl(url, label = 'URL') {
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port) {
    throw new Error(`${label} must be an HTTP loopback URL with an explicit port.`);
  }
}

const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
});

export async function startSwitchableStaticServer(initialRoot) {
  let activeRoot = path.resolve(initialRoot);
  let rejectRequests = false;
  await stat(activeRoot);
  const requests = [];

  const server = http.createServer(async (request, response) => {
    if (rejectRequests) {
      request.socket.destroy();
      return;
    }
    try {
      const requestedUrl = new URL(request.url || '/', 'http://127.0.0.1');
      const pathname = decodeURIComponent(requestedUrl.pathname);
      const relativePath = pathname.replace(/^\/+/, '');
      let candidate = path.resolve(activeRoot, relativePath || 'index.html');
      const rootWithSeparator = `${activeRoot}${path.sep}`;
      if (candidate !== activeRoot && !candidate.startsWith(rootWithSeparator)) {
        response.writeHead(400).end();
        return;
      }

      let fileStat = null;
      try {
        fileStat = await stat(candidate);
      } catch {
        // Navigation fallbacks are handled below.
      }

      const acceptsHtml = String(request.headers.accept || '').includes('text/html');
      if (!fileStat?.isFile() && (acceptsHtml || path.extname(pathname) === '')) {
        candidate = path.join(activeRoot, 'index.html');
        fileStat = await stat(candidate);
      }

      if (!fileStat?.isFile()) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Not found');
        return;
      }

      const body = await readFile(candidate);
      const extension = path.extname(candidate).toLowerCase();
      const isIndex = path.basename(candidate).toLowerCase() === 'index.html';
      const source = isIndex && /^\/(?:tienda(?:\/|$)|conoce-lanzo(?:\/|$))/.test(pathname)
        ? 'network-public'
        : (isIndex ? 'network-admin' : 'network-asset');
      requests.push({ pathname, source, root: activeRoot });

      const headers = {
        'cache-control': path.basename(candidate) === 'sw.js' ? 'no-store' : 'no-cache',
        'content-length': body.length,
        'content-type': MIME_TYPES[extension] || 'application/octet-stream',
        'x-lanzo-navigation-source': source,
      };
      if (path.basename(candidate) === 'sw.js') headers['service-worker-allowed'] = '/';
      response.writeHead(200, headers);
      if (request.method === 'HEAD') response.end();
      else response.end(body);
    } catch {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Local audit server error');
    }
  });

  const port = await getOpenPort();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const baseUrl = new URL(`http://127.0.0.1:${port}`);
  assertLoopbackUrl(baseUrl);

  return {
    baseUrl,
    port,
    requests,
    async setRoot(nextRoot) {
      const resolved = path.resolve(nextRoot);
      await stat(resolved);
      activeRoot = resolved;
    },
    setOffline(offline) {
      rejectRequests = Boolean(offline);
    },
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function findBrowser() {
  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.ProgramFiles || '', 'Microsoft/Edge/Application/msedge.exe'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next installed local browser.
    }
  }
  throw new Error('Chrome or Edge was not found.');
}

async function waitForJson(url, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Browser is still starting.
    }
    await sleep(100);
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
      (this.listeners.get(message.method) || []).forEach((listener) => listener(message.params || {}));
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
    return () => this.listeners.set(method, (this.listeners.get(method) || []).filter((item) => item !== listener));
  }

  once(method, timeoutMs = 15_000) {
    return new Promise((resolve, reject) => {
      let remove = null;
      const timer = setTimeout(() => {
        remove?.();
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      remove = this.on(method, (params) => {
        clearTimeout(timer);
        remove();
        resolve(params);
      });
    });
  }
}

export async function launchBrowser(baseUrl, profilePrefix = 'lanzo-pwa1-chrome-') {
  assertLoopbackUrl(baseUrl);
  const browserPath = await findBrowser();
  const debugPort = await getOpenPort();
  const profileDirectory = await mkdtemp(path.join(os.tmpdir(), profilePrefix));
  const browser = spawn(browserPath, [
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
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true });

  const target = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`)
    .then((targets) => targets.find((candidate) => candidate.type === 'page'));
  if (!target?.webSocketDebuggerUrl) throw new Error('No Chrome page target was available.');

  const cdp = new CdpSession(target.webSocketDebuggerUrl);
  await cdp.open();
  await Promise.all([
    cdp.send('Page.enable'),
    cdp.send('Network.enable'),
    cdp.send('Runtime.enable'),
    cdp.send('ServiceWorker.enable'),
  ]);

  const records = [];
  const byId = new Map();
  const consoleErrors = [];
  const exceptions = [];

  cdp.on('Network.requestWillBeSent', ({ requestId, request, type }) => {
    const record = { requestId, url: request.url, method: request.method, type, failed: false };
    records.push(record);
    byId.set(requestId, record);
  });
  cdp.on('Network.responseReceived', ({ requestId, response }) => {
    const record = byId.get(requestId);
    if (!record) return;
    record.status = response.status;
    record.fromDiskCache = response.fromDiskCache === true;
    record.fromServiceWorker = response.fromServiceWorker === true;
    record.headers = Object.fromEntries(Object.entries(response.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
  });
  cdp.on('Network.loadingFinished', ({ requestId, encodedDataLength }) => {
    const record = byId.get(requestId);
    if (record) record.encodedBytes = Number(encodedDataLength) || 0;
  });
  cdp.on('Network.loadingFailed', ({ requestId, errorText }) => {
    const record = byId.get(requestId);
    if (!record) return;
    record.failed = true;
    record.errorText = String(errorText || '').slice(0, 120);
  });
  cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
    if (type !== 'error') return;
    consoleErrors.push(args.map((arg) => String(arg.value || arg.description || '')).join(' ').slice(0, 300));
  });
  cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    exceptions.push(String(exceptionDetails?.exception?.description || exceptionDetails?.text || '').slice(0, 300));
  });

  async function evaluate(expression) {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed.');
    }
    return result.result?.value;
  }

  async function navigate(pathname, timeoutMs = 8_000) {
    const startIndex = records.length;
    const load = cdp.once('Page.loadEventFired', timeoutMs).catch(() => null);
    const result = await cdp.send('Page.navigate', { url: new URL(pathname, baseUrl).href });
    await Promise.race([load, sleep(timeoutMs)]);
    await sleep(750);
    return { result, records: records.slice(startIndex) };
  }

  async function waitFor(expression, attempts = 100, intervalMs = 100) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        if (await evaluate(`Promise.resolve(${expression}).then((value) => Boolean(value))`)) return true;
      } catch {
        // The page may be transitioning between execution contexts.
      }
      await sleep(intervalMs);
    }
    return false;
  }

  async function close() {
    try {
      await cdp.send('Browser.close');
    } catch {
      browser.kill();
    }
    cdp.socket.close();
    await Promise.race([
      new Promise((resolve) => browser.once('exit', resolve)),
      sleep(2_000),
    ]);
    if (browser.exitCode === null) browser.kill();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await rm(profileDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        return { profileRemoved: true };
      } catch {
        await sleep(200);
      }
    }
    return { profileRemoved: false };
  }

  return {
    browserName: path.basename(browserPath),
    cdp,
    records,
    consoleErrors,
    exceptions,
    evaluate,
    navigate,
    waitFor,
    setOffline: (offline) => cdp.send('Network.emulateNetworkConditions', {
      offline,
      latency: 0,
      downloadThroughput: offline ? 0 : -1,
      uploadThroughput: offline ? 0 : -1,
      connectionType: offline ? 'none' : 'wifi',
    }),
    close,
  };
}

export function summarizeRequests(records, baseUrl) {
  const local = records.filter((record) => {
    try { return new URL(record.url).origin === baseUrl.origin; } catch { return false; }
  });
  const remote = records.filter((record) => {
    try { return /^https?:$/.test(new URL(record.url).protocol) && new URL(record.url).origin !== baseUrl.origin; } catch { return false; }
  });
  return {
    localRequests: local.length,
    manifestRequests: local.filter((record) => new URL(record.url).pathname === '/manifest.webmanifest').length,
    serviceWorkerResponses: local.filter((record) => record.fromServiceWorker).length,
    failedRequests: records.filter((record) => record.failed).length,
    remoteAttemptsBlocked: remote.length,
    localPaths: local.map((record) => new URL(record.url).pathname),
  };
}

export const CACHE_INVENTORY_EXPRESSION = `(async () => {
  const names = await caches.keys();
  const entries = [];
  for (const name of names) {
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      const response = await cache.match(request);
      entries.push({
        cacheName: name,
        path: new URL(request.url).pathname,
        bytes: response ? (await response.clone().arrayBuffer()).byteLength : 0
      });
    }
  }
  const precacheEntries = entries.filter((entry) => entry.cacheName.includes('-precache-'));
  return {
    cacheNames: names,
    entries,
    precache: {
      entries: precacheEntries.length,
      bytes: precacheEntries.reduce((total, entry) => total + entry.bytes, 0),
      javascript: precacheEntries.filter((entry) => entry.path.endsWith('.js')).length,
      css: precacheEntries.filter((entry) => entry.path.endsWith('.css')).length,
      lazy: precacheEntries.filter((entry) => /(PosPage|CajaPage|OrderPage|EcommerceOrdersPage|ProductsPage|CustomersPage|DashboardPage|SettingsPage|AboutPage|AssistantBot|ScannerModal)/i.test(entry.path)).length,
      workers: precacheEntries.filter((entry) => /\\.worker-/i.test(entry.path)).length,
      charts: precacheEntries.filter((entry) => /vendor_charts/i.test(entry.path)).length
    },
    runtime: {
      staticEntries: entries.filter((entry) => entry.cacheName === 'lanzo-admin-static-v1').length,
      mediaEntries: entries.filter((entry) => entry.cacheName === 'lanzo-admin-media-v1').length
    }
  };
})()`;
