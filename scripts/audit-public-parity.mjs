/**
 * Local-only functional parity audit for ECOM.PUBLIC.ARCH.2.
 *
 * By default it starts both Vite previews, drives a local Chrome/Edge instance
 * through CDP, intercepts every public RPC with deterministic fixtures, then
 * stops the browser and preview processes. No request is allowed to reach a
 * non-loopback host.
 *
 * Usage:
 *   node scripts/audit-public-parity.mjs
 *   node scripts/audit-public-parity.mjs --compact
 *   node scripts/audit-public-parity.mjs --no-start
 *   node scripts/audit-public-parity.mjs --admin-url http://127.0.0.1:4173 --store-url http://127.0.0.1:4174
 */
import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  PARITY_FIXTURE_REVISIONS,
  PARITY_FIXTURE_SLUGS,
  PARITY_FIXTURE_TOKENS,
  PARITY_TRACKING_STATUSES,
  PUBLIC_PARITY_FIXTURE_SUMMARY,
  createCatalogFixture,
  createFreePortalFixture,
  createOrderErrorFixture,
  createOrderSuccessFixture,
  createProPortalFixture,
  createTrackingFixture
} from './fixtures/public-parity-fixtures.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const shouldStartPreviews = !args.includes('--no-start');
const compactOutput = args.includes('--compact');
const scenarioLimit = Math.max(0, Number(option('--scenario-limit', '0')) || 0);
const onlyScenario = option('--only', '');
const adminUrl = new URL(option('--admin-url', 'http://127.0.0.1:4173'));
const storeUrl = new URL(option('--store-url', 'http://127.0.0.1:4174'));
const projectRoot = process.cwd();

function assertLoopbackUrl(url, label) {
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error(`${label} must be an HTTP loopback URL.`);
  }
  if (!url.port) throw new Error(`${label} must include an explicit port.`);
}
assertLoopbackUrl(adminUrl, '--admin-url');
assertLoopbackUrl(storeUrl, '--store-url');
if (adminUrl.origin === storeUrl.origin) throw new Error('The two preview URLs must use different origins.');

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const sanitizeText = (value) => String(value || '')
  .replace(/https?:\/\/[^\s"')]+/gi, '[url]')
  .replace(/trk1_[A-Za-z0-9_-]{43}/g, '[tracking-token]')
  .replace(/web-[a-f0-9-]{20,}/gi, '[idempotency-key]')
  .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email]')
  .slice(0, 500);

const sanitizeLocalPath = (value) => String(value || '')
  .replace(/(\/pedido\/)[^/?#]+/gi, '$1[tracking-token]')
  .replace(/(\/rpc\/ecommerce_track_order\/)[^/?#]+/gi, '$1[tracking-token]');

async function getOpenPort() {
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

async function waitForHttp(url, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.ok) return;
    } catch {
      // Preview is still starting.
    }
    await sleep(100);
  }
  throw new Error(`Preview did not become ready: ${url.origin}`);
}

function startPreview(url, configFile = '') {
  const viteBin = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  const previewArgs = [
    viteBin,
    'preview',
    '--host',
    url.hostname,
    '--port',
    url.port,
    '--strictPort'
  ];
  if (configFile) previewArgs.push('--config', configFile);
  return spawn(process.execPath, previewArgs, {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
}

async function stopProcess(processRef) {
  if (!processRef || processRef.exitCode !== null) return;
  processRef.kill();
  await Promise.race([
    new Promise((resolve) => processRef.once('exit', resolve)),
    sleep(2_000)
  ]);
  if (processRef.exitCode === null) processRef.kill('SIGKILL');
}

async function findBrowser() {
  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.ProgramFiles || '', 'Microsoft/Edge/Application/msedge.exe')
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue with the next installed browser candidate.
    }
  }
  throw new Error('Chrome or Edge was not found.');
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
      for (const listener of this.listeners.get(message.method) || []) {
        try {
          listener(message.params || {});
        } catch {
          // Scenario assertions report failures without crashing the event loop.
        }
      }
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
        this.listeners.set(method, listeners.filter((entry) => entry !== listener));
        resolve(params);
      };
      this.on(method, listener);
    });
  }
}

async function waitForJson(url, attempts = 100) {
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

const jsonHeaders = (origin) => [
  { name: 'Content-Type', value: 'application/json; charset=utf-8' },
  { name: 'Access-Control-Allow-Origin', value: origin },
  { name: 'Access-Control-Allow-Headers', value: '*' },
  { name: 'Access-Control-Allow-Methods', value: 'POST, OPTIONS' },
  { name: 'Access-Control-Allow-Private-Network', value: 'true' },
  { name: 'Cache-Control', value: 'no-store' }
];
const fixturePng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nkwAAAAASUVORK5CYII=';

function parseJson(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

function sanitizeRpcParams(name, params) {
  if (name === 'ecommerce_get_portal_by_slug') return { slug: params.p_slug || '' };
  if (name === 'ecommerce_get_catalog') {
    return {
      slug: params.p_slug || '',
      limit: Number(params.p_limit) || 0,
      offset: Number(params.p_offset) || 0,
      catalogRevision: Number(params.p_catalog_revision) || null
    };
  }
  if (name === 'ecommerce_create_order') {
    return {
      slug: params.p_slug || '',
      fulfillmentMethod: params.p_customer?.fulfillmentMethod || '',
      addressPresent: Boolean(params.p_customer?.address),
      itemCount: Array.isArray(params.p_items) ? params.p_items.length : 0,
      quantity: Array.isArray(params.p_items)
        ? params.p_items.reduce((total, item) => total + (Number(item.quantity) || 0), 0)
        : 0,
      idempotencyKeyPresent: typeof params.p_idempotency_key === 'string'
    };
  }
  if (name === 'ecommerce_get_order_tracking') return { slug: params.p_slug || '', tokenPresent: true };
  return {};
}

function createFixtureState() {
  return {
    revision: PARITY_FIXTURE_REVISIONS.A,
    offline: false,
    orderMode: 'success',
    orderDelayMs: 0,
    trackingStatus: 'received',
    logicalRequests: [],
    receivedOrders: [],
    trackingResponses: [],
    remoteAttempts: 0,
    remotePaths: [],
    interceptedFixtureImages: 0
  };
}

async function launchAuditBrowser({ baseUrl, browserPath, label }) {
  const debugPort = await getOpenPort();
  const profileDirectory = await mkdtemp(path.join(os.tmpdir(), `lanzo-arch2-${label}-`));
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
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
    'about:blank'
  ], { stdio: 'ignore', windowsHide: true });

  const target = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`)
    .then((targets) => targets.find((candidate) => candidate.type === 'page'));
  if (!target?.webSocketDebuggerUrl) throw new Error('No Chrome page target was available.');

  const cdp = new CdpSession(target.webSocketDebuggerUrl);
  const fixtureState = createFixtureState();
  const networkRecords = new Map();
  const consoleErrors = [];
  const consoleWarnings = [];
  const exceptions = [];
  const interceptionErrors = [];
  let offlineScriptIdentifier = null;

  await cdp.open();
  cdp.on('Runtime.consoleAPICalled', ({ type, args: consoleArgs = [] }) => {
    const message = sanitizeText(consoleArgs.map((entry) => entry.value ?? entry.description ?? '').join(' '));
    if (type === 'error') consoleErrors.push(message);
    if (type === 'warning') consoleWarnings.push(message);
  });
  cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    exceptions.push(sanitizeText(exceptionDetails?.exception?.description || exceptionDetails?.text));
  });
  cdp.on('Network.requestWillBeSent', ({ requestId, request, type }) => {
    networkRecords.set(requestId, {
      url: request.url,
      type,
      status: null,
      failed: false,
      fromServiceWorker: false
    });
  });
  cdp.on('Network.responseReceived', ({ requestId, response }) => {
    const record = networkRecords.get(requestId);
    if (!record) return;
    record.status = response.status;
    record.fromServiceWorker = response.fromServiceWorker === true;
  });
  cdp.on('Network.loadingFailed', ({ requestId, errorText }) => {
    const record = networkRecords.get(requestId);
    if (!record) return;
    record.failed = true;
    record.errorText = sanitizeText(errorText);
  });

  const fulfillJson = (requestId, value, code = 200) => cdp.send('Fetch.fulfillRequest', {
    requestId,
    responseCode: code,
    responseHeaders: jsonHeaders(baseUrl.origin),
    body: Buffer.from(JSON.stringify(value)).toString('base64')
  });

  const handlePausedRequest = async ({ requestId, request }) => {
    const url = new URL(request.url);
    if (url.origin === baseUrl.origin) {
      await cdp.send('Fetch.continueRequest', { requestId });
      return;
    }

    fixtureState.remoteAttempts += 1;
    fixtureState.remotePaths.push(`${request.method} ${url.pathname}`);
    if (url.hostname === 'fixtures.lanzo.invalid' && /\.(?:png|jpg|jpeg|webp)$/i.test(url.pathname)) {
      fixtureState.interceptedFixtureImages += 1;
      await cdp.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 200,
        responseHeaders: [
          { name: 'Content-Type', value: 'image/png' },
          { name: 'Access-Control-Allow-Origin', value: '*' },
          { name: 'Cache-Control', value: 'no-store' }
        ],
        body: fixturePng
      });
      return;
    }

    const rpcMatch = url.pathname.match(/\/rest\/v1\/rpc\/([^/]+)$/);
    if (!rpcMatch) {
      await cdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
      return;
    }

    if (request.method === 'OPTIONS') {
      await cdp.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 204,
        responseHeaders: jsonHeaders(baseUrl.origin)
      });
      return;
    }

    const rpcName = rpcMatch[1];
    const params = parseJson(request.postData);
    fixtureState.logicalRequests.push({
      name: rpcName,
      params: sanitizeRpcParams(rpcName, params)
    });

    if (fixtureState.offline) {
      await cdp.send('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' });
      return;
    }

    if (rpcName === 'ecommerce_get_portal_by_slug') {
      const slug = params.p_slug;
      if (slug === PARITY_FIXTURE_SLUGS.pro) {
        await fulfillJson(requestId, createProPortalFixture(fixtureState.revision));
        return;
      }
      if (slug === PARITY_FIXTURE_SLUGS.free) {
        await fulfillJson(requestId, createFreePortalFixture());
        return;
      }
      if (slug === PARITY_FIXTURE_SLUGS.rateLimited) {
        await fulfillJson(requestId, createOrderErrorFixture('ECOMMERCE_RATE_LIMITED'));
        return;
      }
      if (slug === PARITY_FIXTURE_SLUGS.invalid) {
        await fulfillJson(requestId, { success: 'invalid', portal: null });
        return;
      }
      await fulfillJson(requestId, {
        success: false,
        error: { code: 'ECOMMERCE_PORTAL_NOT_FOUND', message: 'Synthetic fixture only.' }
      });
      return;
    }

    if (rpcName === 'ecommerce_get_catalog') {
      await fulfillJson(requestId, createCatalogFixture({
        revision: fixtureState.revision,
        offset: Number(params.p_offset) || 0,
        slug: params.p_slug
      }));
      return;
    }

    if (rpcName === 'ecommerce_create_order') {
      fixtureState.receivedOrders.push({
        key: params.p_idempotency_key || '',
        fulfillmentMethod: params.p_customer?.fulfillmentMethod || '',
        addressPresent: Boolean(params.p_customer?.address),
        items: Array.isArray(params.p_items) ? params.p_items.length : 0
      });
      if (fixtureState.orderDelayMs > 0) await sleep(fixtureState.orderDelayMs);
      if (fixtureState.orderMode === 'network') {
        await cdp.send('Fetch.failRequest', { requestId, errorReason: 'ConnectionFailed' });
        return;
      }
      if (fixtureState.orderMode === 'malformed') {
        await fulfillJson(requestId, { success: true, order: { code: '' } });
        return;
      }
      if (fixtureState.orderMode !== 'success') {
        await fulfillJson(requestId, createOrderErrorFixture(fixtureState.orderMode));
        return;
      }
      const response = createOrderSuccessFixture();
      response.order.fulfillmentMethod = params.p_customer?.fulfillmentMethod === 'delivery'
        ? 'delivery'
        : 'pickup';
      await fulfillJson(requestId, response);
      return;
    }

    if (rpcName === 'ecommerce_get_order_tracking') {
      const token = params.p_tracking_token;
      if (token === PARITY_FIXTURE_TOKENS.notFound) {
        fixtureState.trackingResponses.push({ mode: 'not-found' });
        await fulfillJson(requestId, {
          success: false,
          error: { code: 'ECOMMERCE_TRACKING_NOT_FOUND', message: 'Synthetic fixture only.' }
        });
        return;
      }
      if (token === PARITY_FIXTURE_TOKENS.networkError) {
        fixtureState.trackingResponses.push({ mode: 'network-error' });
        await cdp.send('Fetch.failRequest', { requestId, errorReason: 'ConnectionFailed' });
        return;
      }
      if (token === PARITY_FIXTURE_TOKENS.malformed) {
        fixtureState.trackingResponses.push({ mode: 'malformed' });
        await fulfillJson(requestId, {
          success: true,
          tracking: {
            status: 'unsupported-private-state',
            customerEmail: 'fixture-private@example.test',
            deliveryAddress: 'Private Fixture Address',
            items: 'invalid'
          }
        });
        return;
      }
      fixtureState.trackingResponses.push({ mode: 'status', status: fixtureState.trackingStatus });
      await fulfillJson(requestId, createTrackingFixture(fixtureState.trackingStatus));
      return;
    }

    await fulfillJson(requestId, { success: false, error: { code: 'FIXTURE_RPC_NOT_SUPPORTED' } }, 404);
  };

  cdp.on('Fetch.requestPaused', (params) => {
    void handlePausedRequest(params).catch((error) => {
      interceptionErrors.push(sanitizeText(error.message));
      void cdp.send('Fetch.failRequest', {
        requestId: params.requestId,
        errorReason: 'Failed'
      }).catch(() => {});
    });
  });

  await Promise.all([
    cdp.send('Page.enable'),
    cdp.send('Network.enable'),
    cdp.send('Runtime.enable'),
    cdp.send('ServiceWorker.enable'),
    cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
  ]);

  async function evaluate(expression) {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Evaluation failed.');
    }
    return result.result?.value;
  }

  async function waitFor(expression, timeoutMs = 15_000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await evaluate(`Boolean(${expression})`)) return true;
      await sleep(100);
    }
    throw new Error(`Timed out waiting for browser condition: ${sanitizeText(expression)}`);
  }

  async function navigate(pathname, waitExpression = 'document.body.innerText.trim().length > 0') {
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: new URL(pathname, baseUrl).href });
    await loaded;
    await waitFor(waitExpression);
  }

  async function clickButton(label) {
    return evaluate(`(() => {
      const label = ${JSON.stringify(label)};
      const button = Array.from(document.querySelectorAll('button, a')).find((entry) =>
        (entry.getAttribute('aria-label') || entry.textContent || '').trim().includes(label)
      );
      if (!button || button.disabled) return false;
      button.click();
      return true;
    })()`);
  }

  async function clickSelector(selector) {
    return evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element || element.disabled) return false;
      element.click();
      return true;
    })()`);
  }

  async function setField(selector, value) {
    return evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return false;
      const prototype = element.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : element.tagName === 'SELECT'
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)});
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
  }

  async function collectSemantics() {
    return evaluate(`(async () => {
      const visible = (element) => Boolean(element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length));
      const buttons = Array.from(document.querySelectorAll('button')).filter(visible);
      const fields = Array.from(document.querySelectorAll('input, select, textarea')).filter(visible);
      const products = Array.from(document.querySelectorAll('.public-product-card')).map((card) => ({
        name: card.querySelector('h3')?.textContent.trim() || '',
        category: card.querySelector('.public-product-card__category')?.textContent.trim() || '',
        price: card.querySelector('.public-product-card__footer strong')?.textContent.trim() || '',
        stock: card.querySelector('.public-product-card__stock')?.textContent.trim() || '',
        disabled: Boolean(card.querySelector('button')?.disabled)
      }));
      const registrations = navigator.serviceWorker
        ? await navigator.serviceWorker.getRegistrations()
        : [];
      const indexedDbNames = await (async () => {
        try {
          return indexedDB.databases ? (await indexedDB.databases()).map((entry) => entry.name).filter(Boolean) : [];
        } catch {
          return [];
        }
      })();
      const storageKeys = (() => {
        try {
          return Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index)).filter(Boolean).sort();
        } catch {
          return [];
        }
      })();
      return {
        documentUrl: location.href,
        route: location.pathname + location.search,
        title: document.title,
        headings: Array.from(document.querySelectorAll('h1, h2, h3')).filter(visible).map((entry) => entry.textContent.trim()),
        products,
        categories: Array.from(document.querySelectorAll('.public-catalog__category option')).map((entry) => entry.textContent.trim()),
        cart: {
          trigger: document.querySelector('.public-store-cart-button')?.getAttribute('aria-label') || '',
          drawerTitle: document.querySelector('#public-cart-title')?.textContent.trim() || '',
          subtotal: document.querySelector('.public-cart-summary strong')?.textContent.trim() || '',
          checkoutDisabled: document.querySelector('.public-cart-checkout')?.disabled ?? null
        },
        checkout: {
          open: Boolean(document.querySelector('.public-checkout-dialog')),
          confirmed: document.querySelector('#public-order-confirmation-title')?.textContent.trim() || '',
          error: document.querySelector('.public-checkout-error p')?.textContent.trim() || ''
        },
        tracking: {
          orderCode: document.querySelector('#public-tracking-title')?.textContent.trim() || '',
          status: document.querySelector('.public-tracking-status h2')?.textContent.trim() || '',
          network: document.querySelector('.public-tracking-network')?.textContent.trim() || ''
        },
        manifest: Array.from(document.querySelectorAll('link[rel="manifest"]')).map((entry) => entry.getAttribute('href')),
        serviceWorker: {
          registrations: registrations.length,
          controlled: Boolean(navigator.serviceWorker?.controller)
        },
        indexedDb: indexedDbNames,
        sessionStorageKeys: storageKeys,
        brokenImages: Array.from(document.images).filter((image) => image.complete && image.naturalWidth === 0).map((image) => image.alt || 'unnamed'),
        unlabeledButtons: buttons.filter((button) => !(button.textContent || '').trim() && !button.getAttribute('aria-label') && !button.title).length,
        unlabeledFields: fields.filter((field) => !field.getAttribute('aria-label') && !field.labels?.length && !field.title).length,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        hasAdministrativeShell: /StaffLoginModal|WelcomeModal|Dashboard|Punto de venta|Configuraci\u00f3n/.test(document.body.innerText)
      };
    })()`);
  }

  async function setViewport(width, height) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 600
    });
    await sleep(100);
  }

  async function setOffline(offline) {
    fixtureState.offline = offline;
    if (offline) {
      if (!offlineScriptIdentifier) {
        const result = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
          source: `Object.defineProperty(Navigator.prototype, 'onLine', {
            configurable: true,
            get: () => false
          });`
        });
        offlineScriptIdentifier = result.identifier;
      }
      await evaluate(`(() => {
        Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false });
        window.dispatchEvent(new Event('offline'));
      })()`);
      return;
    }
    if (offlineScriptIdentifier) {
      await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: offlineScriptIdentifier });
      offlineScriptIdentifier = null;
    }
    await evaluate(`(() => {
      Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => true });
      window.dispatchEvent(new Event('online'));
    })()`);
  }

  async function close() {
    try {
      await Promise.race([
        cdp.send('Browser.close'),
        sleep(1_000)
      ]);
    } catch {
      browser.kill();
    }
    cdp.socket.close();
    await Promise.race([
      new Promise((resolve) => browser.once('exit', resolve)),
      sleep(2_000)
    ]);
    if (browser.exitCode === null) browser.kill();
    await rm(profileDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }

  return {
    baseUrl,
    browser,
    cdp,
    fixtureState,
    networkRecords,
    consoleErrors,
    consoleWarnings,
    exceptions,
    interceptionErrors,
    evaluate,
    waitFor,
    navigate,
    clickButton,
    clickSelector,
    setField,
    collectSemantics,
    setViewport,
    setOffline,
    close
  };
}

const trackingLabels = Object.freeze({
  received: 'Pedido recibido',
  accepted: 'Pedido aceptado',
  preparing: 'En preparaci\u00f3n',
  ready: 'Listo',
  out_for_delivery: 'En camino',
  completed: 'Completado',
  cancelled: 'Cancelado',
  attention: 'Requiere atenci\u00f3n',
  rejected: 'Rechazado'
});

function addCheck(scenario, name, passed, detail = '') {
  scenario.checks.push({ name, passed: Boolean(passed), detail: sanitizeText(detail) });
  if (!passed) scenario.passed = false;
}

async function auditTarget({ baseUrl, browserPath, label }) {
  const context = await launchAuditBrowser({ baseUrl, browserPath, label });
  const report = {
    label,
    origin: baseUrl.origin,
    browser: path.basename(browserPath),
    safeguards: {
      loopbackOnly: true,
      ephemeralProfile: true,
      nonLoopbackDnsBlocked: true,
      rpcInterception: 'CDP Fetch',
      remoteServicesReached: false,
      realOrdersCreated: 0
    },
    scenarios: [],
    semanticDigest: {}
  };

  const scenario = async (name, operation) => {
    if (onlyScenario && name !== onlyScenario) return null;
    if (scenarioLimit > 0 && report.scenarios.length >= scenarioLimit) return null;
    const entry = { name, passed: true, checks: [] };
    const rpcStart = context.fixtureState.logicalRequests.length;
    const orderStart = context.fixtureState.receivedOrders.length;
    try {
      await operation(entry);
    } catch (error) {
      addCheck(entry, 'scenario completed', false, error.message);
      try {
        entry.diagnostic = await context.collectSemantics();
      } catch (diagnosticError) {
        entry.diagnosticError = sanitizeText(diagnosticError.message);
      }
    }
    entry.logicalRequests = context.fixtureState.logicalRequests.slice(rpcStart);
    entry.interceptedOrderCalls = context.fixtureState.receivedOrders.length - orderStart;
    report.scenarios.push(entry);
    return entry;
  };

  try {
    context.fixtureState.revision = PARITY_FIXTURE_REVISIONS.A;
    await scenario('initial-pro-store', async (entry) => {
      await context.navigate(
        `/tienda/${PARITY_FIXTURE_SLUGS.pro}?arch2=initial`,
        `document.querySelectorAll('.public-product-card').length === 4`
      );
      const state = await context.collectSemantics();
      addCheck(entry, 'business identity', state.headings.includes('Tienda Fixture PRO'));
      addCheck(entry, 'first catalog page', state.products.length === 4);
      addCheck(entry, 'categories', ['Bebidas', 'Comida', 'Especiales'].every((item) => state.categories.includes(item)));
      addCheck(entry, 'exact stock visible', state.products.some((item) => item.stock.includes('2')));
      addCheck(entry, 'sold out disabled', state.products.some((item) => item.name === 'Agotado Fixture' && item.disabled));
      addCheck(entry, 'no administrative shell', !state.hasAdministrativeShell);
      addCheck(entry, 'accessible controls', state.unlabeledButtons === 0 && state.unlabeledFields === 0);
      addCheck(entry, 'images loaded or safe fallback', state.brokenImages.length === 0, state.brokenImages.join(', '));
      await context.evaluate(`document.activeElement?.blur()`);
      await context.cdp.send('Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9
      });
      await context.cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9
      });
      const accessibility = await context.evaluate(`(() => {
        const viewport = document.querySelector('meta[name="viewport"]')?.content || '';
        const focused = document.activeElement;
        const style = focused ? getComputedStyle(focused) : null;
        return {
          zoomAllowed: !/user-scalable\\s*=\\s*no/i.test(viewport)
            && !/maximum-scale\\s*=\\s*1(?:\\D|$)/i.test(viewport),
          focusVisible: Boolean(focused && focused !== document.body
            && focused.matches(':focus-visible')
            && (parseFloat(style.outlineWidth) > 0 || style.boxShadow !== 'none'))
        };
      })()`);
      addCheck(entry, 'public HTML allows zoom', accessibility.zoomAllowed);
      addCheck(entry, 'keyboard focus indicator visible', accessibility.focusVisible);
      const responsive = [];
      for (const [width, height] of [[375, 812], [768, 1024], [1440, 900]]) {
        await context.setViewport(width, height);
        const viewportState = await context.collectSemantics();
        responsive.push({ width, height, horizontalOverflow: viewportState.horizontalOverflow });
      }
      addCheck(entry, 'responsive viewports', responsive.every((item) => !item.horizontalOverflow));
      entry.state = { ...state, responsive };
      report.semanticDigest.initial = {
        heading: 'Tienda Fixture PRO',
        products: state.products.map((item) => item.name),
        categories: state.categories,
        prices: state.products.map((item) => item.price)
      };
    });

    await scenario('repeat-same-revision', async (entry) => {
      const logicalStart = context.fixtureState.logicalRequests.length;
      await context.navigate(
        `/tienda/${PARITY_FIXTURE_SLUGS.pro}?arch2=repeat`,
        `document.querySelectorAll('.public-product-card').length === 4`
      );
      const state = await context.collectSemantics();
      await sleep(300);
      const requests = context.fixtureState.logicalRequests.slice(logicalStart);
      const portalCalls = requests.filter((request) => request.name === 'ecommerce_get_portal_by_slug').length;
      const catalogCalls = requests.filter((request) => request.name === 'ecommerce_get_catalog').length;
      addCheck(entry, 'one logical portal call', portalCalls === 1, `portal=${portalCalls}`);
      addCheck(entry, 'zero cached catalog calls', catalogCalls === 0, `catalog=${catalogCalls}`);
      addCheck(entry, 'catalog remains visible', state.products.length === 4);
      report.semanticDigest.repeat = { products: state.products.map((item) => item.name), portalCalls, catalogCalls };
    });

    await scenario('pagination-search-categories', async (entry) => {
      addCheck(entry, 'load more action available', await context.clickSelector('.public-catalog__load-more button'));
      await context.waitFor(`Array.from(document.querySelectorAll('.public-product-card h3')).some((entry) => entry.textContent.includes('Postre Fixture'))`);
      const paged = await context.collectSemantics();
      const names = paged.products.map((item) => item.name);
      addCheck(entry, 'second page loaded', names.includes('Postre Fixture'));
      addCheck(entry, 'no duplicate products', new Set(names).size === names.length);
      addCheck(entry, 'order preserved', names.at(-1) === 'Postre Fixture');
      await context.setField('input[type="search"]', 'Taco Fixture');
      await context.waitFor(`document.querySelectorAll('.public-product-card').length === 1`);
      const searchCount = (await context.collectSemantics()).products.length;
      await context.setField('input[type="search"]', 'Sin resultados fixture');
      await context.waitFor(`document.body.innerText.includes('No encontramos productos')`);
      const emptyState = await context.evaluate(`document.body.innerText.includes('No encontramos productos')`);
      await context.setField('input[type="search"]', '');
      await context.setField('.public-catalog__category select', 'Bebidas');
      await context.waitFor(`document.querySelectorAll('.public-product-card').length === 1`);
      const categoryNames = (await context.collectSemantics()).products.map((item) => item.name);
      await context.setField('.public-catalog__category select', 'all');
      addCheck(entry, 'search by name', searchCount === 1);
      addCheck(entry, 'controlled empty state', emptyState);
      addCheck(entry, 'category filter', categoryNames.length === 1 && categoryNames[0] === 'Agua Fixture');
      report.semanticDigest.catalog = { names, searchCount, categoryNames, emptyState };
    });

    await scenario('cart-persistence-isolation', async (entry) => {
      await context.evaluate(`sessionStorage.removeItem('lanzo:ecommerce:cart:${PARITY_FIXTURE_SLUGS.pro}:v1')`);
      await context.navigate(`/tienda/${PARITY_FIXTURE_SLUGS.pro}`, `document.querySelectorAll('.public-product-card').length === 4`);
      await context.clickButton('Agregar Taco Fixture');
      await context.waitFor(`document.querySelector('.public-store-cart-button')?.getAttribute('aria-label').includes('1 unidades')`);
      await context.clickButton('Ver carrito');
      await context.waitFor(`Boolean(document.querySelector('#public-cart-title'))`);
      await context.clickButton('Aumentar cantidad de Taco Fixture');
      await context.waitFor(`document.querySelector('input[aria-label="Cantidad de Taco Fixture"]')?.value === '2'`);
      const maxDisabled = await context.evaluate(`document.querySelector('button[aria-label="Aumentar cantidad de Taco Fixture"]')?.disabled === true`);
      await context.clickButton('Disminuir cantidad de Taco Fixture');
      await context.waitFor(`document.querySelector('input[aria-label="Cantidad de Taco Fixture"]')?.value === '1'`);
      await context.clickButton('Aumentar cantidad de Taco Fixture');
      const cart = await context.collectSemantics();
      addCheck(entry, 'quantity maximum respected', maxDisabled);
      addCheck(entry, 'subtotal precise', cart.cart.subtotal.includes('79.80'), cart.cart.subtotal);
      await context.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
      await context.waitFor(`!document.querySelector('#public-cart-title')`);
      await context.navigate(`/tienda/${PARITY_FIXTURE_SLUGS.pro}`, `document.querySelector('.public-store-cart-button')?.getAttribute('aria-label').includes('2 unidades')`);
      const persisted = await context.collectSemantics();
      await context.navigate(`/tienda/${PARITY_FIXTURE_SLUGS.free}`, `document.querySelectorAll('.public-product-card').length === 1`);
      const isolated = await context.collectSemantics();
      addCheck(entry, 'cart persisted on reload', persisted.cart.trigger.includes('2 unidades'));
      addCheck(entry, 'cart isolated by slug', isolated.cart.trigger.includes('0 unidades'));
      addCheck(entry, 'free stock hidden', isolated.products.every((item) => item.stock === ''));
      report.semanticDigest.cart = {
        subtotal: cart.cart.subtotal,
        persistedUnits: persisted.cart.trigger,
        isolatedUnits: isolated.cart.trigger
      };
    });

    await scenario('catalog-revision-reconciliation', async (entry) => {
      await context.evaluate(`sessionStorage.removeItem('lanzo:ecommerce:cart:${PARITY_FIXTURE_SLUGS.pro}:v1')`);
      context.fixtureState.revision = PARITY_FIXTURE_REVISIONS.A;
      await context.navigate(`/tienda/${PARITY_FIXTURE_SLUGS.pro}`, `document.querySelectorAll('.public-product-card').length === 4`);
      await context.clickButton('Agregar Reconciliar Fixture');
      await context.waitFor(`document.querySelector('.public-store-cart-button')?.getAttribute('aria-label').includes('1 unidades')`);
      context.fixtureState.revision = PARITY_FIXTURE_REVISIONS.B;
      await context.evaluate(`window.dispatchEvent(new Event('focus'))`);
      await context.waitFor(`document.querySelector('.public-store-shell')?.dataset.catalogRevision === '${PARITY_FIXTURE_REVISIONS.B}'`);
      await context.waitFor(`document.querySelector('.public-store-cart-button')?.getAttribute('aria-label').includes('0 unidades')`);
      const state = await context.collectSemantics();
      addCheck(entry, 'revision B loaded', state.products.some((item) => item.name === 'Reconciliar Fixture' && item.disabled));
      addCheck(entry, 'incompatible cart item removed', state.cart.trigger.includes('0 unidades'));
      addCheck(entry, 'checkout cannot use stale data', !state.checkout.open);
      report.semanticDigest.revision = { revision: PARITY_FIXTURE_REVISIONS.B, cart: state.cart.trigger };
    });

    await scenario('offline-compatible-and-empty', async (entry) => {
      context.fixtureState.revision = PARITY_FIXTURE_REVISIONS.B;
      context.fixtureState.offline = false;
      await context.navigate(
        `/tienda/${PARITY_FIXTURE_SLUGS.pro}?arch2=offline-prime`,
        `document.querySelectorAll('.public-product-card').length === 4`
      );
      await sleep(300);
      await context.setOffline(true);
      await context.navigate(`/tienda/${PARITY_FIXTURE_SLUGS.pro}`, `document.body.innerText.includes('Sin conexi\\u00f3n')`);
      const cached = await context.collectSemantics();
      addCheck(entry, 'cached catalog visible', cached.products.length === 4);
      addCheck(entry, 'offline state explicit', cached.headings.includes('Tienda Fixture PRO'));
      await context.clickButton('Ver carrito');
      const offlineCheckoutDisabled = await context.evaluate(`document.querySelector('.public-cart-checkout')?.disabled !== false`);
      addCheck(entry, 'checkout blocked offline', offlineCheckoutDisabled);
      await context.navigate(`/tienda/${PARITY_FIXTURE_SLUGS.offlineEmpty}`, `document.body.innerText.includes('No se pudo cargar la tienda')`);
      const empty = await context.collectSemantics();
      addCheck(entry, 'offline empty cache controlled', empty.headings.includes('No se pudo cargar la tienda'));
      addCheck(entry, 'no infinite loading', !empty.headings.some((item) => item.includes('Cargando')));
      await context.setOffline(false);
      report.semanticDigest.offline = {
        cachedProducts: cached.products.map((item) => item.name),
        emptyHeading: empty.headings[0] || '',
        checkoutDisabled: offlineCheckoutDisabled
      };
    });

    await scenario('pickup-idempotency-success', async (entry) => {
      context.fixtureState.revision = PARITY_FIXTURE_REVISIONS.A;
      context.fixtureState.orderMode = 'network';
      context.fixtureState.orderDelayMs = 0;
      await context.navigate(`/tienda/${PARITY_FIXTURE_SLUGS.pro}`, `document.querySelectorAll('.public-product-card').length === 4`);
      await context.evaluate(`sessionStorage.clear()`);
      await context.navigate(`/tienda/${PARITY_FIXTURE_SLUGS.pro}`, `document.querySelectorAll('.public-product-card').length === 4`);
      await context.clickButton('Agregar Taco Fixture');
      await context.clickButton('Ver carrito');
      await context.waitFor(`Boolean(document.querySelector('#public-cart-title'))`);
      await context.clickButton('Aumentar cantidad de Taco Fixture');
      await context.waitFor(`document.querySelector('.public-cart-checkout')?.disabled === false`);
      await context.clickButton('Continuar pedido');
      await context.waitFor(`Boolean(document.querySelector('#public-checkout-title'))`);
      await context.setField('input[name="name"]', 'Cliente Fixture');
      await context.setField('input[name="phone"]', '5500000000');
      const checkoutResponsive = [];
      for (const [width, height] of [[375, 812], [768, 1024], [1440, 900]]) {
        await context.setViewport(width, height);
        const viewportState = await context.collectSemantics();
        checkoutResponsive.push({
          width,
          height,
          open: viewportState.checkout.open,
          horizontalOverflow: viewportState.horizontalOverflow
        });
      }
      addCheck(entry, 'checkout responsive', checkoutResponsive.every((item) => item.open && !item.horizontalOverflow));
      const firstOrderIndex = context.fixtureState.receivedOrders.length;
      await context.clickButton('Confirmar pedido');
      await context.waitFor(`Boolean(document.querySelector('.public-checkout-error'))`);
      const failedAttempt = context.fixtureState.receivedOrders[firstOrderIndex];
      context.fixtureState.orderMode = 'success';
      context.fixtureState.orderDelayMs = 300;
      await context.evaluate(`(() => {
        const button = document.querySelector('.public-checkout-submit');
        button.click();
        button.click();
      })()`);
      await context.waitFor(`Boolean(document.querySelector('#public-order-confirmation-title'))`);
      const successfulAttempt = context.fixtureState.receivedOrders[firstOrderIndex + 1];
      const attemptCalls = context.fixtureState.receivedOrders.length - firstOrderIndex;
      const state = await context.collectSemantics();
      addCheck(entry, 'pickup excludes address', failedAttempt?.fulfillmentMethod === 'pickup' && !failedAttempt.addressPresent);
      addCheck(entry, 'idempotency key reused', Boolean(failedAttempt?.key) && failedAttempt.key === successfulAttempt?.key);
      addCheck(entry, 'double click single-flight', attemptCalls === 2, `network+success calls=${attemptCalls}`);
      addCheck(entry, 'simulated order confirmed', state.checkout.confirmed === 'Pedido enviado');
      addCheck(entry, 'public code visible', state.headings.includes('Pedido enviado'));
      report.semanticDigest.pickup = {
        confirmed: state.checkout.confirmed,
        idempotencyReused: failedAttempt?.key === successfulAttempt?.key,
        doubleClickSuppressed: attemptCalls === 2,
        payload: successfulAttempt ? {
          fulfillmentMethod: successfulAttempt.fulfillmentMethod,
          addressPresent: successfulAttempt.addressPresent,
          items: successfulAttempt.items
        } : null
      };
    });

    await scenario('delivery-validation-success', async (entry) => {
      context.fixtureState.orderMode = 'success';
      context.fixtureState.orderDelayMs = 0;
      await context.clickButton('Seguir comprando');
      await context.waitFor(`!document.querySelector('.public-checkout-dialog')`);
      await context.clickButton('Agregar Taco Fixture');
      await context.clickButton('Ver carrito');
      await context.waitFor(`Boolean(document.querySelector('#public-cart-title'))`);
      await context.clickButton('Aumentar cantidad de Taco Fixture');
      await context.waitFor(`document.querySelector('.public-cart-checkout')?.disabled === false`);
      await context.clickButton('Continuar pedido');
      await context.waitFor(`Boolean(document.querySelector('#public-checkout-title'))`);
      await context.setField('input[name="name"]', 'Cliente Delivery Fixture');
      await context.setField('input[name="phone"]', '5500000001');
      await context.setField('input[value="delivery"]', 'delivery');
      await context.evaluate(`document.querySelector('input[value="delivery"]')?.click()`);
      await context.waitFor(`Boolean(document.querySelector('textarea[name="address"]'))`);
      const beforeValidation = context.fixtureState.receivedOrders.length;
      await context.clickButton('Confirmar pedido');
      await context.waitFor(`document.body.innerText.includes('direcci\\u00f3n de al menos 5 caracteres')`);
      addCheck(entry, 'address required locally', context.fixtureState.receivedOrders.length === beforeValidation);
      await context.setField('textarea[name="address"]', 'Calle Delivery Fixture 123');
      await context.clickButton('Confirmar pedido');
      await context.waitFor(`Boolean(document.querySelector('#public-order-confirmation-title'))`);
      const deliveryAttempt = context.fixtureState.receivedOrders.at(-1);
      addCheck(entry, 'delivery payload selected', deliveryAttempt?.fulfillmentMethod === 'delivery');
      addCheck(entry, 'delivery address present', deliveryAttempt?.addressPresent === true);
      report.semanticDigest.delivery = {
        addressValidationBlockedRpc: context.fixtureState.receivedOrders.length === beforeValidation + 1,
        payload: deliveryAttempt ? {
          fulfillmentMethod: deliveryAttempt.fulfillmentMethod,
          addressPresent: deliveryAttempt.addressPresent,
          items: deliveryAttempt.items
        } : null
      };
    });

    await scenario('tracking-contract', async (entry) => {
      const statuses = [];
      for (let index = 0; index < PARITY_TRACKING_STATUSES.length; index += 1) {
        const status = PARITY_TRACKING_STATUSES[index];
        context.fixtureState.trackingStatus = status;
        const token = `trk1_${String(index + 1).padStart(43, 'A')}`;
        await context.navigate(
          `/tienda/${PARITY_FIXTURE_SLUGS.pro}/pedido/${token}`,
          `Boolean(document.querySelector('#public-tracking-title'))`
        );
        const state = await context.collectSemantics();
        statuses.push({ status, label: state.tracking.status });
      }
      const trackingResponsive = [];
      for (const [width, height] of [[375, 812], [768, 1024], [1440, 900]]) {
        await context.setViewport(width, height);
        const viewportState = await context.collectSemantics();
        trackingResponsive.push({
          width,
          height,
          legible: Boolean(viewportState.tracking.orderCode && viewportState.tracking.status),
          horizontalOverflow: viewportState.horizontalOverflow
        });
      }
      addCheck(entry, 'tracking responsive', trackingResponsive.every((item) => item.legible && !item.horizontalOverflow));
      addCheck(entry, 'all supported statuses', statuses.every((item) => item.label === trackingLabels[item.status]));
      await context.navigate(
        `/tienda/${PARITY_FIXTURE_SLUGS.pro}/pedido/${PARITY_FIXTURE_TOKENS.notFound}`,
        `document.body.innerText.includes('No se encontr\\u00f3 el seguimiento')`
      );
      const notFound = await context.collectSemantics();
      await context.navigate(
        `/tienda/${PARITY_FIXTURE_SLUGS.pro}/pedido/token-invalido`,
        `document.body.innerText.includes('No se encontr\\u00f3 el seguimiento')`
      );
      const invalid = await context.collectSemantics();
      await context.navigate(
        `/tienda/${PARITY_FIXTURE_SLUGS.pro}/pedido/${PARITY_FIXTURE_TOKENS.networkError}`,
        `document.body.innerText.includes('No se pudo cargar el seguimiento')`
      );
      const networkError = await context.collectSemantics();
      await context.navigate(
        `/tienda/${PARITY_FIXTURE_SLUGS.pro}/pedido/${PARITY_FIXTURE_TOKENS.malformed}`,
        `Boolean(document.querySelector('#public-tracking-title'))`
      );
      const malformed = await context.collectSemantics();
      addCheck(entry, 'uniform not found', notFound.headings[0] === invalid.headings[0]);
      addCheck(entry, 'network error controlled', networkError.headings.includes('No se pudo cargar el seguimiento'));
      addCheck(entry, 'malformed response allowlisted', malformed.tracking.orderCode === 'Pedido' && malformed.tracking.status === 'Pedido recibido');
      addCheck(entry, 'private malformed fields absent', !JSON.stringify(malformed).includes('fixture-private'));
      report.semanticDigest.tracking = {
        statuses,
        notFound: notFound.headings[0] || '',
        invalid: invalid.headings[0] || '',
        networkError: networkError.headings[0] || '',
        malformed: malformed.tracking
      };
    });

    await scenario('landing-fallback-responsive', async (entry) => {
      await context.navigate(`/conoce-lanzo?tienda=${PARITY_FIXTURE_SLUGS.pro}`, `Boolean(document.querySelector('#public-lanzo-title'))`);
      const landing = await context.collectSemantics();
      const returnPath = await context.evaluate(`document.querySelector('.public-lanzo-nav__back')?.getAttribute('href') || ''`);
      const responsive = [];
      for (const [width, height] of [[375, 812], [768, 1024], [1440, 900]]) {
        await context.setViewport(width, height);
        const state = await context.collectSemantics();
        responsive.push({ width, height, horizontalOverflow: state.horizontalOverflow });
      }
      addCheck(entry, 'current landing copy', landing.headings.includes('Todo lo que necesitas para vender, controlar y crecer.'));
      addCheck(entry, 'store return link', returnPath === `/tienda/${PARITY_FIXTURE_SLUGS.pro}`);
      addCheck(entry, 'landing responsive', responsive.every((item) => !item.horizontalOverflow));
      // /tienda without a slug is the shared public fallback understood by both
      // entries; arbitrary root paths intentionally remain administrative in dist.
      await context.navigate('/tienda?arch2=fallback', `document.body.innerText.includes('Esta tienda no est\\u00e1 disponible')`);
      const fallback = await context.collectSemantics();
      addCheck(entry, 'safe public fallback', fallback.headings.includes('Esta tienda no est\u00e1 disponible'));
      addCheck(entry, 'fallback excludes admin shell', !fallback.hasAdministrativeShell);
      report.semanticDigest.landing = {
        heading: landing.headings[0] || '',
        returnPath,
        responsive,
        fallback: fallback.headings[0] || ''
      };
    });

    await scenario('unavailable-portal-matrix', async (entry) => {
      const outcomes = [];
      for (const slug of [
        PARITY_FIXTURE_SLUGS.missing,
        PARITY_FIXTURE_SLUGS.inactive,
        PARITY_FIXTURE_SLUGS.unpublished,
        PARITY_FIXTURE_SLUGS.invalid,
        PARITY_FIXTURE_SLUGS.rateLimited
      ]) {
        await context.navigate(`/tienda/${slug}`, `!document.body.innerText.includes('Cargando tienda')`);
        const state = await context.collectSemantics();
        outcomes.push({ slug, heading: state.headings[0] || '' });
      }
      addCheck(entry, 'all unavailable modes controlled', outcomes.every((item) => [
        'Esta tienda no est\u00e1 disponible',
        'No se pudo cargar la tienda'
      ].includes(item.heading)));
      report.semanticDigest.unavailable = outcomes.map((item) => item.heading);
    });

    const localRecords = [...context.networkRecords.values()].filter((record) => {
      try { return new URL(record.url).origin === baseUrl.origin; } catch { return false; }
    });
    report.audit = {
      logicalRpcRequests: context.fixtureState.logicalRequests.length,
      interceptedOrderCalls: context.fixtureState.receivedOrders.length,
      interceptedFixtureImages: context.fixtureState.interceptedFixtureImages,
      localRequests: localRecords.map((record) => sanitizeLocalPath(new URL(record.url).pathname)),
      local404: localRecords
        .filter((record) => record.status === 404)
        .map((record) => sanitizeLocalPath(new URL(record.url).pathname)),
      administrativeResources: localRecords
        .map((record) => new URL(record.url).pathname)
        .filter((value) => /(App-|PosPage|Caja|Dashboard|Settings|AssistantBot|ScannerModal|vendor_charts|\.worker-)/i.test(value)),
      serviceWorkerResponses: localRecords.filter((record) => record.fromServiceWorker).length,
      consoleErrors: context.consoleErrors,
      consoleWarnings: context.consoleWarnings,
      exceptions: context.exceptions,
      interceptionErrors: context.interceptionErrors,
      remoteHttpAttempts: context.fixtureState.remoteAttempts,
      remotePaths: [...new Set(context.fixtureState.remotePaths)],
      trackingResponses: context.fixtureState.trackingResponses,
      remoteHttpRequestsAllowed: 0
    };
    report.compliance = {
      scenariosPassed: report.scenarios.every((entry) => entry.passed),
      zeroLocal404: report.audit.local404.length === 0,
      zeroConsoleErrors: report.audit.consoleErrors.length === 0,
      zeroExceptions: report.audit.exceptions.length === 0,
      zeroInterceptionErrors: report.audit.interceptionErrors.length === 0,
      zeroRealOrders: true
    };
    report.compliance.passed = Object.values(report.compliance).every(Boolean);
  } finally {
    await context.close();
  }
  return report;
}

function compareDigests(admin, store) {
  const areas = ['initial', 'repeat', 'catalog', 'cart', 'revision', 'offline', 'pickup', 'delivery', 'tracking', 'landing', 'unavailable'];
  return areas.map((area) => {
    const left = JSON.stringify(admin.semanticDigest[area] ?? null);
    const right = JSON.stringify(store.semanticDigest[area] ?? null);
    return { area, parity: left === right };
  });
}

const previews = [];
let output;
try {
  if (shouldStartPreviews) {
    previews.push(startPreview(adminUrl));
    previews.push(startPreview(storeUrl, 'vite.store.config.js'));
    await Promise.all([waitForHttp(adminUrl), waitForHttp(storeUrl)]);
  } else {
    await Promise.all([waitForHttp(adminUrl), waitForHttp(storeUrl)]);
  }

  const browserPath = await findBrowser();
  const admin = await auditTarget({ baseUrl: adminUrl, browserPath, label: 'dist' });
  const store = await auditTarget({ baseUrl: storeUrl, browserPath, label: 'dist-store' });
  const parity = compareDigests(admin, store);
  output = {
    generatedAt: new Date().toISOString(),
    phase: 'ECOM.PUBLIC.ARCH.2',
    fixtures: PUBLIC_PARITY_FIXTURE_SUMMARY,
    previewManagement: {
      startedByAudit: shouldStartPreviews,
      stoppedByAudit: shouldStartPreviews
    },
    targets: { admin, store },
    parity,
    compliance: {
      adminPassed: admin.compliance.passed,
      storePassed: store.compliance.passed,
      semanticParity: parity.every((entry) => entry.parity),
      zeroRemoteWrites: true,
      zeroRealOrders: true
    }
  };
  output.compliance.passed = Object.values(output.compliance).every(Boolean);
} finally {
  await Promise.all(previews.map(stopProcess));
}

const printableOutput = compactOutput && output ? {
  generatedAt: output.generatedAt,
  phase: output.phase,
  fixtures: output.fixtures,
  previewManagement: output.previewManagement,
  targets: Object.fromEntries(Object.entries(output.targets).map(([name, target]) => [name, {
    label: target.label,
    safeguards: target.safeguards,
    initialRuntime: (() => {
      const state = target.scenarios.find((scenario) => scenario.name === 'initial-pro-store')?.state;
      return state ? {
        title: state.title,
        route: state.route,
        manifest: state.manifest,
        serviceWorker: state.serviceWorker,
        indexedDbNames: state.indexedDb,
        sessionStorageKeys: state.sessionStorageKeys,
        viewport: state.viewport,
        horizontalOverflow: state.horizontalOverflow,
        unlabeledButtons: state.unlabeledButtons,
        unlabeledFields: state.unlabeledFields
      } : null;
    })(),
    scenarios: target.scenarios.map((scenario) => ({
      name: scenario.name,
      passed: scenario.passed,
      failedChecks: scenario.checks.filter((check) => !check.passed),
      logicalRequestCount: scenario.logicalRequests.length,
      interceptedOrderCalls: scenario.interceptedOrderCalls
    })),
    audit: {
      logicalRpcRequests: target.audit.logicalRpcRequests,
      interceptedOrderCalls: target.audit.interceptedOrderCalls,
      interceptedFixtureImages: target.audit.interceptedFixtureImages,
      localRequestCount: target.audit.localRequests.length,
      local404: target.audit.local404,
      administrativeResources: target.audit.administrativeResources,
      serviceWorkerResponses: target.audit.serviceWorkerResponses,
      consoleErrors: target.audit.consoleErrors,
      exceptions: target.audit.exceptions,
      interceptionErrors: target.audit.interceptionErrors,
      remoteHttpAttempts: target.audit.remoteHttpAttempts,
      remotePaths: target.audit.remotePaths,
      trackingResponses: target.audit.trackingResponses
    },
    compliance: target.compliance
  }])),
  parity: output.parity,
  compliance: output.compliance
} : output;

console.log(JSON.stringify(printableOutput, null, 2));
if (!output?.compliance?.passed) process.exitCode = 1;
