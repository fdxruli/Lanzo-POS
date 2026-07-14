/**
 * Read-only HTTP and Chrome DevTools Protocol audit for a Vercel storefront.
 *
 * Usage:
 *   node scripts/audit-remote-store-deployment.mjs https://<deployment>.vercel.app
 *
 * The script accepts one Vercel URL, uses an ephemeral browser profile, never
 * submits checkout, and emits one sanitized JSON document.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const distRoot = path.join(projectRoot, 'dist-store');
const safeSlug = 'slug-inexistente-seguro';
const safeTrackingToken = 'token-invalido-seguro';
const viewports = Object.freeze([
  { width: 375, height: 812, path: `/tienda/${safeSlug}/#catalogo`, expectedPath: `/tienda/${safeSlug}` },
  { width: 768, height: 1024, path: `/conoce-lanzo?tienda=${safeSlug}#inicio`, expectedPath: '/conoce-lanzo' },
  { width: 1440, height: 900, path: '/', expectedPath: '/' }
]);

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const normalizePath = (value) => value.replaceAll('\\', '/');
const sanitizeText = (value) => String(value || '')
  .replace(/https?:\/\/[^\s"')]+/gi, '[url]')
  .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt]')
  .replace(/\b(?:sb_(?:publishable|secret)_[A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9]+|vcp_[A-Za-z0-9_-]+)\b/g, '[credential]')
  .replace(/(\/pedido\/)[^/?#\s]+/gi, '$1[token]')
  .slice(0, 400);

function validateInput() {
  if (process.argv.length !== 3) throw new Error('Exactly one generated Vercel URL is required.');
  const url = new URL(process.argv[2]);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.vercel.app')) {
    throw new Error('The audit accepts only an HTTPS *.vercel.app URL.');
  }
  if (url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('The Vercel URL must contain only its origin.');
  }
  return url;
}

async function walk(directory, root = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolutePath, root));
    else if (entry.isFile()) {
      const metadata = await stat(absolutePath);
      files.push({
        absolutePath,
        bytes: metadata.size,
        path: normalizePath(path.relative(root, absolutePath))
      });
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function localReference(value) {
  if (!value || /^(?:data:|blob:|https?:|#|mailto:|tel:)/i.test(value)) return null;
  try {
    return decodeURIComponent(new URL(value, 'https://lanzo-store.invalid').pathname).replace(/^\//, '');
  } catch {
    return null;
  }
}

function extractAssetReferences(html) {
  const references = [
    ...Array.from(html.matchAll(/<(?:script|img|source)\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi), (match) => match[1]),
    ...Array.from(html.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi), (match) => match[1])
  ];
  return [...new Set(references.map(localReference).filter(Boolean))].sort();
}

async function fetchBody(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: options.redirect || 'follow' });
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { response, bytes };
}

const officialVercelHostname = (hostname) => hostname === 'vercel.com' || hostname.endsWith('.vercel.com');
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const sourceExposurePatterns = Object.freeze([
  /(?:^|[\\/])package(?:-lock)?\.json\b/i,
  /(?:^|[\\/])\.env(?:\.[A-Za-z0-9_-]+)?\b/i,
  /src[\\/]main-store\.jsx\b/i,
  /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/i,
  /service_role|SUPABASE_SERVICE_ROLE/i,
  /<title>\s*Tienda en línea\s*[—-]\s*Lanzo\s*<\/title>/i,
  /<div\s+id=["']root["']\s*>/i,
  /(?:directory listing|index of \/)/i
]);

export function classifyReservedSourceResponse({
  status,
  location = '',
  contentType = '',
  bytes = new Uint8Array(),
  localIndexSha256 = ''
}) {
  const body = Buffer.from(bytes).toString('utf8');
  const bodySha256 = sha256(bytes);
  const returnedIndex = Boolean(localIndexSha256 && bodySha256 === localIndexSha256);
  const exposureMarkers = sourceExposurePatterns
    .filter((pattern) => pattern.test(body))
    .map((pattern) => pattern.source);
  const violations = [];
  let destination = null;

  if (returnedIndex) violations.push('reserved-src-returned-public-index');
  if (exposureMarkers.length > 0) violations.push('reserved-src-exposed-package-content');

  if (status === 404) {
    return {
      accepted: violations.length === 0,
      classification: 'platform-reserved-not-found',
      status,
      location: '',
      destinationHostname: '',
      contentType: contentType.split(';')[0],
      returnedIndex,
      exposureMarkers,
      violations
    };
  }

  if (status !== 307 && status !== 308) {
    violations.push(`reserved-src-status:${status}`);
  }
  try {
    destination = new URL(location);
  } catch {
    violations.push('reserved-src-invalid-location');
  }
  if (destination) {
    if (destination.protocol !== 'https:') violations.push('reserved-src-location-not-https');
    if (!officialVercelHostname(destination.hostname)) violations.push('reserved-src-location-not-vercel');
    if (destination.username || destination.password || destination.port) {
      violations.push('reserved-src-location-credentials-or-port');
    }
  }

  return {
    accepted: violations.length === 0,
    classification: 'platform-reserved-redirect',
    status,
    location,
    destinationHostname: destination?.hostname || '',
    contentType: contentType.split(';')[0],
    returnedIndex,
    exposureMarkers,
    violations
  };
}

function routeIdentity(url) {
  return `${url.pathname}${url.search}`;
}

async function auditHttp(baseUrl) {
  const localFiles = await walk(distRoot);
  const localIndexFile = localFiles.find((file) => file.path === 'index.html');
  if (!localIndexFile) throw new Error('dist-store/index.html is missing.');
  const localIndex = await readFile(localIndexFile.absolutePath);
  const localIndexHash = sha256(localIndex);
  const directRoutes = [
    '/',
    '/tienda',
    `/tienda/${safeSlug}`,
    `/tienda/${safeSlug}/pedido/${safeTrackingToken}`,
    '/conoce-lanzo'
  ];
  const canonicalizationRoutes = [
    { path: '/tienda/', expected: '/tienda' },
    { path: `/tienda/${safeSlug}/`, expected: `/tienda/${safeSlug}` },
    {
      path: `/tienda/${safeSlug}/pedido/${safeTrackingToken}/`,
      expected: `/tienda/${safeSlug}/pedido/${safeTrackingToken}`
    },
    { path: '/conoce-lanzo/', expected: '/conoce-lanzo' },
    {
      path: `/tienda/${safeSlug}/?arch=cutover-1-1`,
      expected: `/tienda/${safeSlug}?arch=cutover-1-1`
    }
  ];
  const forbiddenRoutes = [
    '/sw.js',
    '/manifest.webmanifest',
    '/registerSW.js',
    '/workbox-fixture.js',
    '/.env',
    '/.env.local',
    '/package.json',
    '/package-lock.json',
    '/src',
    '/src/main-store.jsx',
    '/vite.config.js',
    '/vite.store.config.js',
    '/vercel.json',
    '/.git',
    '/node_modules',
    '/docs',
    '/scripts'
  ];
  const routes = [];
  const violations = [];

  for (const route of directRoutes) {
    const requestedUrl = new URL(route, baseUrl);
    const { response, bytes } = await fetchBody(requestedUrl, { redirect: 'manual' });
    const contentType = response.headers.get('content-type') || '';
    const location = response.headers.get('location') || '';
    const item = {
      path: route,
      initialStatus: response.status,
      location,
      expectedCanonicalUrl: routeIdentity(requestedUrl),
      finalStatus: response.status,
      finalContentType: contentType.split(';')[0],
      finalMatchesIndex: sha256(bytes) === localIndexHash,
      finalOriginMatches: new URL(response.url).origin === baseUrl.origin,
      xRobotsTag: response.headers.get('x-robots-tag') || '',
      cacheControl: response.headers.get('cache-control') || ''
    };
    routes.push(item);
    if (redirectStatuses.has(item.initialStatus) || item.location) violations.push(`route-unexpected-redirect:${route}`);
    if (item.finalStatus !== 200) violations.push(`route-status:${route}:${item.finalStatus}`);
    if (!item.finalOriginMatches) violations.push(`route-origin:${route}`);
    if (!item.finalContentType.includes('text/html')) violations.push(`route-content-type:${route}`);
    if (!item.finalMatchesIndex) violations.push(`route-index-hash:${route}`);
    if (item.xRobotsTag !== 'noindex, nofollow, noarchive') violations.push(`route-noindex:${route}`);
    if (item.cacheControl !== 'public, max-age=0, must-revalidate') violations.push(`route-index-cache:${route}`);
  }

  for (const route of canonicalizationRoutes) {
    const requestedUrl = new URL(route.path, baseUrl);
    const expectedUrl = new URL(route.expected, baseUrl);
    const initial = await fetchBody(requestedUrl, { redirect: 'manual' });
    const location = initial.response.headers.get('location') || '';
    let destination = null;
    try {
      destination = location ? new URL(location, requestedUrl) : null;
    } catch {
      destination = null;
    }

    let finalResponse = null;
    let finalBytes = new Uint8Array();
    if (destination && destination.origin === baseUrl.origin) {
      const final = await fetchBody(destination, { redirect: 'manual' });
      finalResponse = final.response;
      finalBytes = final.bytes;
    }

    const item = {
      path: route.path,
      initialStatus: initial.response.status,
      location,
      expectedCanonicalUrl: routeIdentity(expectedUrl),
      destinationUrl: destination ? routeIdentity(destination) : '',
      finalStatus: finalResponse?.status || null,
      finalContentType: (finalResponse?.headers.get('content-type') || '').split(';')[0],
      finalMatchesIndex: finalResponse ? sha256(finalBytes) === localIndexHash : false,
      finalOriginMatches: destination?.origin === baseUrl.origin,
      finalLocation: finalResponse?.headers.get('location') || '',
      initialXRobotsTag: initial.response.headers.get('x-robots-tag') || '',
      initialCacheControl: initial.response.headers.get('cache-control') || '',
      xRobotsTag: finalResponse?.headers.get('x-robots-tag') || '',
      cacheControl: finalResponse?.headers.get('cache-control') || ''
    };
    routes.push(item);
    if (item.initialStatus !== 308) violations.push(`canonical-status:${route.path}:${item.initialStatus}`);
    if (!item.location) violations.push(`canonical-location-missing:${route.path}`);
    if (!item.finalOriginMatches) violations.push(`canonical-origin:${route.path}`);
    if (item.destinationUrl !== item.expectedCanonicalUrl) violations.push(`canonical-target:${route.path}`);
    if (item.finalStatus !== 200) violations.push(`canonical-final-status:${route.path}:${item.finalStatus}`);
    if (redirectStatuses.has(item.finalStatus) || item.finalLocation) violations.push(`canonical-multiple-redirects:${route.path}`);
    if (!item.finalContentType.includes('text/html')) violations.push(`canonical-content-type:${route.path}`);
    if (!item.finalMatchesIndex) violations.push(`canonical-index-hash:${route.path}`);
    if (item.initialXRobotsTag !== 'noindex, nofollow, noarchive') {
      violations.push(`canonical-initial-noindex:${route.path}`);
    }
    if (item.initialCacheControl !== 'public, max-age=0, must-revalidate') {
      violations.push(`canonical-initial-cache:${route.path}`);
    }
    if (item.xRobotsTag !== 'noindex, nofollow, noarchive') violations.push(`canonical-noindex:${route.path}`);
    if (item.cacheControl !== 'public, max-age=0, must-revalidate') violations.push(`canonical-index-cache:${route.path}`);
  }

  const forbidden = [];
  for (const route of forbiddenRoutes) {
    const { response, bytes } = await fetchBody(new URL(route, baseUrl), { redirect: 'manual' });
    const item = {
      route,
      status: response.status,
      location: response.headers.get('location') || '',
      contentType: (response.headers.get('content-type') || '').split(';')[0],
      xRobotsTag: response.headers.get('x-robots-tag') || '',
      returnedIndex: sha256(bytes) === localIndexHash
    };
    forbidden.push(item);
    if (item.status !== 404) violations.push(`forbidden-status:${route}:${item.status}`);
    if (item.returnedIndex) violations.push(`forbidden-index-fallback:${route}`);
    if (item.contentType.includes('text/html')) violations.push(`forbidden-html:${route}`);
    if (item.xRobotsTag !== 'noindex, nofollow, noarchive') violations.push(`forbidden-noindex:${route}`);
  }

  const sourceResponse = await fetchBody(new URL('/_src', baseUrl), { redirect: 'manual' });
  const reservedSource = classifyReservedSourceResponse({
    status: sourceResponse.response.status,
    location: sourceResponse.response.headers.get('location') || '',
    contentType: sourceResponse.response.headers.get('content-type') || '',
    bytes: sourceResponse.bytes,
    localIndexSha256: localIndexHash
  });
  if (!reservedSource.accepted) {
    violations.push(...reservedSource.violations.map((violation) => `reserved-src:${violation}`));
  }

  const robots = await fetchBody(new URL('/robots.txt', baseUrl), { redirect: 'manual' });
  const robotsText = Buffer.from(robots.bytes).toString('utf8');
  const robotsResult = {
    status: robots.response.status,
    bodyMatches: robotsText === 'User-agent: *\nDisallow: /\n',
    xRobotsTag: robots.response.headers.get('x-robots-tag') || ''
  };
  if (robotsResult.status !== 200 || !robotsResult.bodyMatches) violations.push('robots-contract');
  if (robotsResult.xRobotsTag !== 'noindex, nofollow, noarchive') violations.push('robots-noindex');

  const localIndexText = localIndex.toString('utf8');
  const references = extractAssetReferences(localIndexText);
  const assets = [];
  for (const reference of references) {
    const localFile = localFiles.find((file) => file.path === reference);
    const { response, bytes } = await fetchBody(new URL(`/${reference}`, baseUrl), { redirect: 'manual' });
    const remoteHash = sha256(bytes);
    const localHash = localFile ? sha256(await readFile(localFile.absolutePath)) : null;
    const item = {
      path: reference,
      status: response.status,
      bytes: bytes.byteLength,
      sha256: remoteHash,
      matchesLocal: Boolean(localHash && localHash === remoteHash),
      cacheControl: response.headers.get('cache-control') || ''
    };
    assets.push(item);
    if (item.status !== 200) violations.push(`asset-status:${reference}:${item.status}`);
    if (!item.matchesLocal) violations.push(`asset-hash:${reference}`);
    if (item.cacheControl !== 'public, max-age=31536000, immutable') {
      violations.push(`asset-cache:${reference}`);
    }
  }

  const referencedPaths = new Set(['index.html', ...references]);
  const unreferencedLocalFiles = localFiles.map((file) => file.path).filter((file) => !referencedPaths.has(file));
  if (unreferencedLocalFiles.length > 0) violations.push(`unreferenced-local-files:${unreferencedLocalFiles.join(',')}`);

  return {
    https: baseUrl.protocol === 'https:',
    routes,
    forbidden,
    reservedRoutes: [{ path: '/_src', ...reservedSource }],
    robots: robotsResult,
    artifact: {
      localFiles: localFiles.length,
      remoteComparedFiles: 1 + assets.length,
      localBytes: localFiles.reduce((total, file) => total + file.bytes, 0),
      remoteComparedBytes: localIndex.byteLength + assets.reduce((total, asset) => total + asset.bytes, 0),
      indexSha256: localIndexHash,
      assets,
      unreferencedLocalFiles
    },
    violations
  };
}

async function getOpenPort() {
  const net = await import('node:net');
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
      // Continue to the next installed browser.
    }
  }
  throw new Error('Chrome or Edge was not found.');
}

async function waitForJson(url, attempts = 150) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Browser is still starting.
    }
    await sleep(100);
  }
  throw new Error('Chrome DevTools endpoint did not become ready.');
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
      for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
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

  once(method, timeoutMs = 20_000) {
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

async function launchBrowser() {
  const browserPath = await findBrowser();
  const debugPort = await getOpenPort();
  const profileDirectory = await mkdtemp(path.join(os.tmpdir(), 'lanzo-store-remote-chrome-'));
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
    'about:blank'
  ], { stdio: 'ignore', windowsHide: true });

  try {
    const target = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`)
      .then((targets) => targets.find((candidate) => candidate.type === 'page'));
    if (!target?.webSocketDebuggerUrl) throw new Error('No Chrome page target was available.');
    const cdp = new CdpSession(target.webSocketDebuggerUrl);
    await cdp.open();
    await Promise.all([
      cdp.send('Page.enable'),
      cdp.send('Network.enable'),
      cdp.send('Runtime.enable'),
      cdp.send('ServiceWorker.enable')
    ]);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__lanzoBeforeInstallPromptEvents = 0;
        addEventListener('beforeinstallprompt', () => { window.__lanzoBeforeInstallPromptEvents += 1; });`
    });
    return { browser, browserName: path.basename(browserPath), cdp, profileDirectory };
  } catch (error) {
    browser.kill();
    await rm(profileDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function closeBrowser(session) {
  try {
    await session.cdp.send('Browser.close');
  } catch {
    session.browser.kill();
  }
  session.cdp.socket.close();
  await Promise.race([
    new Promise((resolve) => session.browser.once('exit', resolve)),
    sleep(2_000)
  ]);
  if (session.browser.exitCode === null) session.browser.kill();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(session.profileDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return true;
    } catch {
      await sleep(200);
    }
  }
  return false;
}

async function auditBrowser(baseUrl) {
  const session = await launchBrowser();
  const { cdp } = session;
  const requests = [];
  const requestById = new Map();
  const consoleErrors = [];
  const exceptions = [];

  cdp.on('Network.requestWillBeSent', ({ requestId, request, type }) => {
    const parsed = new URL(request.url);
    const record = {
      requestId,
      url: request.url,
      origin: parsed.origin,
      path: parsed.pathname,
      method: request.method,
      type,
      failed: false,
      tokenInUrl: /(?:token|key|secret|password)=/i.test(parsed.search)
    };
    requests.push(record);
    requestById.set(requestId, record);
  });
  cdp.on('Network.responseReceived', ({ requestId, response }) => {
    const record = requestById.get(requestId);
    if (!record) return;
    record.status = response.status;
    record.mimeType = response.mimeType;
    record.fromServiceWorker = response.fromServiceWorker === true;
  });
  cdp.on('Network.loadingFinished', ({ requestId, encodedDataLength }) => {
    const record = requestById.get(requestId);
    if (record) record.encodedBytes = Number(encodedDataLength) || 0;
  });
  cdp.on('Network.loadingFailed', ({ requestId, errorText, blockedReason, corsErrorStatus }) => {
    const record = requestById.get(requestId);
    if (!record) return;
    record.failed = true;
    record.errorText = sanitizeText(errorText);
    record.blockedReason = blockedReason || '';
    record.corsError = corsErrorStatus?.corsError || '';
  });
  cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
    if (type === 'error') consoleErrors.push(sanitizeText(args.map((arg) => arg.value || arg.description || '').join(' ')));
  });
  cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    exceptions.push(sanitizeText(exceptionDetails?.exception?.description || exceptionDetails?.text));
  });

  async function evaluate(expression) {
    const response = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Evaluation failed.');
    }
    return response.result?.value;
  }

  async function navigate(pathname) {
    const load = cdp.once('Page.loadEventFired').catch(() => null);
    await cdp.send('Page.navigate', { url: new URL(pathname, baseUrl).href });
    await Promise.race([load, sleep(20_000)]);
    await sleep(1_000);
  }

  const viewportResults = [];
  let cleanState = null;
  let profileRemoved = false;
  try {
    for (const viewport of viewports) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: viewport.width < 600
      });
      await navigate(viewport.path);
      if (viewport.path.startsWith('/tienda/')) await sleep(3_000);
      const measurement = await evaluate(`(() => ({
        width: innerWidth,
        height: innerHeight,
        overflow: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0) > innerWidth + 1,
        brokenImages: Array.from(document.images).filter((image) => !image.complete || image.naturalWidth === 0).length,
        rootPresent: Boolean(document.querySelector('#root')),
        finalPath: location.pathname,
        finalSearch: location.search,
        finalHash: location.hash
      }))()`);
      viewportResults.push({
        ...viewport,
        ...measurement,
        canonicalPathMatches: measurement.finalPath === viewport.expectedPath
      });
      if (!cleanState) {
        cleanState = await evaluate(`(async () => ({
          manifestLinks: document.querySelectorAll('link[rel="manifest"]').length,
          serviceWorkerRegistrations: 'serviceWorker' in navigator ? (await navigator.serviceWorker.getRegistrations()).length : 0,
          controller: Boolean(navigator.serviceWorker?.controller),
          workboxGlobal: Boolean(window.workbox || window.Workbox),
          beforeInstallPromptEvents: window.__lanzoBeforeInstallPromptEvents || 0,
          adminShell: /iniciar sesi[oó]n|punto de venta|dashboard|caja/i.test(document.body?.innerText || ''),
          indexedDbNames: typeof indexedDB.databases === 'function'
            ? (await indexedDB.databases()).map((database) => database.name).filter(Boolean).sort()
            : [],
          localStorageKeys: Object.keys(localStorage).sort(),
          sessionStorageKeys: Object.keys(sessionStorage).sort(),
          cacheStorageNames: 'caches' in window ? (await caches.keys()).sort() : []
        }))()`);
      }
    }

    await navigate(`/tienda/${safeSlug}/pedido/${safeTrackingToken}`);
    await sleep(2_000);
    const finalStorage = await evaluate(`(async () => ({
      manifestLinks: document.querySelectorAll('link[rel="manifest"]').length,
      serviceWorkerRegistrations: 'serviceWorker' in navigator ? (await navigator.serviceWorker.getRegistrations()).length : 0,
      controller: Boolean(navigator.serviceWorker?.controller),
      indexedDbNames: typeof indexedDB.databases === 'function'
        ? (await indexedDB.databases()).map((database) => database.name).filter(Boolean).sort()
        : [],
      localStorageKeys: Object.keys(localStorage).sort(),
      sessionStorageKeys: Object.keys(sessionStorage).sort(),
      cacheStorageNames: 'caches' in window ? (await caches.keys()).sort() : []
    }))()`);
    const cookies = await cdp.send('Network.getAllCookies');
    const cookieNames = [...new Set((cookies.cookies || [])
      .filter((cookie) => baseUrl.hostname.endsWith(cookie.domain.replace(/^\./, '')))
      .map((cookie) => cookie.name))].sort();

    const sameOrigin = requests.filter((request) => request.origin === baseUrl.origin);
    const supabaseRequests = requests.filter((request) => request.origin.endsWith('.supabase.co'));
    const rpcRequests = supabaseRequests
      .filter((request) => request.path.includes('/rest/v1/rpc/'))
      .map((request) => ({
        rpc: request.path.split('/').pop(),
        method: request.method,
        status: request.status || null,
        failed: request.failed,
        corsError: request.corsError || ''
      }));
    const administrativeChunks = sameOrigin
      .filter((request) => /(?:App|PosPage|Caja|Dashboard|Settings|AssistantBot|ScannerModal|vendor_charts)/i.test(request.path))
      .map((request) => request.path);
    const violations = [];
    if (cleanState.manifestLinks !== 0 || finalStorage.manifestLinks !== 0) violations.push('manifest-link');
    if (cleanState.serviceWorkerRegistrations !== 0 || finalStorage.serviceWorkerRegistrations !== 0) violations.push('service-worker-registration');
    if (cleanState.controller || finalStorage.controller) violations.push('service-worker-controller');
    if (cleanState.workboxGlobal) violations.push('workbox-global');
    if (cleanState.beforeInstallPromptEvents !== 0) violations.push('beforeinstallprompt');
    if (cleanState.adminShell) violations.push('administrative-shell');
    if (administrativeChunks.length > 0) violations.push('administrative-chunks');
    if (consoleErrors.length > 0) violations.push('console-errors');
    if (exceptions.length > 0) violations.push('exceptions');
    if (sameOrigin.some((request) => request.status === 404 && /\.(?:js|css|svg|png|ico|woff2?)$/i.test(request.path))) {
      violations.push('required-asset-404');
    }
    if (requests.some((request) => request.url.startsWith('http:'))) violations.push('mixed-content');
    if (requests.some((request) => request.tokenInUrl)) violations.push('token-in-url');
    if (rpcRequests.some((request) => request.rpc === 'ecommerce_create_order')) violations.push('order-write-rpc');
    if (!rpcRequests.some((request) => request.rpc === 'ecommerce_get_portal_by_slug')) violations.push('portal-rpc-not-observed');
    if (rpcRequests.some((request) => request.corsError || request.failed)) violations.push('rpc-network-or-cors-error');
    if ([...cleanState.indexedDbNames, ...finalStorage.indexedDbNames].some((name) => name === 'LanzoDB1' || name === 'LanzoDB')) {
      violations.push('administrative-indexeddb');
    }
    if ([...cleanState.cacheStorageNames, ...finalStorage.cacheStorageNames].length > 0) violations.push('unexpected-cache-storage');
    if (viewportResults.some((viewport) => viewport.overflow || viewport.brokenImages > 0 || !viewport.rootPresent)) {
      violations.push('responsive-or-image-failure');
    }
    if (viewportResults.some((viewport) => !viewport.canonicalPathMatches)) {
      violations.push('browser-canonical-path');
    }
    if (cookieNames.some((name) => /lanzo|supabase|auth|session|staff|device/i.test(name))) violations.push('administrative-cookie');

    return {
      browser: session.browserName,
      origin: baseUrl.origin,
      viewportResults,
      cleanState,
      finalStorage,
      network: {
        requests: requests.length,
        sameOriginRequests: sameOrigin.length,
        javascriptTransferredBytes: sameOrigin
          .filter((request) => request.type === 'Script')
          .reduce((total, request) => total + (request.encodedBytes || 0), 0),
        cssTransferredBytes: sameOrigin
          .filter((request) => request.type === 'Stylesheet')
          .reduce((total, request) => total + (request.encodedBytes || 0), 0),
        requiredAsset404: sameOrigin
          .filter((request) => request.status === 404 && /\.(?:js|css|svg|png|ico|woff2?)$/i.test(request.path))
          .map((request) => request.path),
        mixedContentRequests: requests.filter((request) => request.url.startsWith('http:')).length,
        tokenInUrlRequests: requests.filter((request) => request.tokenInUrl).length,
        fromServiceWorkerResponses: requests.filter((request) => request.fromServiceWorker).length,
        administrativeChunks
      },
      supabase: {
        rpcRequests,
        portalReadObserved: rpcRequests.some((request) => request.rpc === 'ecommerce_get_portal_by_slug'),
        corsErrors: rpcRequests.filter((request) => request.corsError).length,
        writeRequests: rpcRequests.filter((request) => request.rpc === 'ecommerce_create_order').length,
        safeSlug
      },
      cookies: {
        names: cookieNames,
        administrativeNames: cookieNames.filter((name) => /lanzo|supabase|auth|session|staff|device/i.test(name))
      },
      consoleErrors,
      exceptions,
      violations
    };
  } finally {
    profileRemoved = await closeBrowser(session);
    if (!profileRemoved) throw new Error('The ephemeral browser profile could not be removed.');
  }
}

async function main() {
  const baseUrl = validateInput();
  const httpAudit = await auditHttp(baseUrl);
  const browserAudit = await auditBrowser(baseUrl);
  const violations = [
    ...httpAudit.violations.map((item) => `http:${item}`),
    ...browserAudit.violations.map((item) => `browser:${item}`)
  ];
  const report = {
    generatedAt: new Date().toISOString(),
    target: { origin: baseUrl.origin, safeSlug },
    http: httpAudit,
    browser: browserAudit,
    safety: {
      credentialsUsed: false,
      checkoutSubmitted: false,
      ordersCreated: 0,
      writesPerformed: 0,
      ephemeralProfileRemoved: true
    },
    compliance: { passed: violations.length === 0, violations }
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.compliance.passed) process.exitCode = 1;
}

const invokedAsScript = Boolean(process.argv[1])
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedAsScript) {
  main().catch((error) => {
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      compliance: { passed: false, violations: [`fatal:${sanitizeText(error.message || error)}`] }
    }, null, 2));
    process.exitCode = 1;
  });
}
