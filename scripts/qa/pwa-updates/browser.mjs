// Two real Vite/Workbox builds, real Chromium SW/cache/network, production UI
// and coordinator. Isolated Zustand slice and synthetic business IDB records:
// integration evidence, not Android installation or commercial checkout QA.
import { build } from 'vite';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, cp, symlink } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = process.cwd();
const output = resolve(process.env.UPDATE_QA_OUTPUT || '/tmp/lanzo-update-browser');
await mkdir(output, { recursive: true });
const baselineRef = process.env.UPDATE_QA_BASELINE_REF || 'origin/main';
const baselineCommit = execFileSync('git', ['rev-parse', `${baselineRef}^{commit}`], { encoding: 'utf8' }).trim();
const candidateCommit = process.env.UPDATE_QA_CANDIDATE_REF
  ? execFileSync('git', ['rev-parse', `${process.env.UPDATE_QA_CANDIDATE_REF}^{commit}`], { encoding: 'utf8' }).trim()
  : execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const baselineRoot = resolve(output, 'baseline-worktree');
try { execFileSync('git', ['worktree', 'remove', '--force', baselineRoot], { stdio: 'ignore' }); } catch { /* no prior worktree */ }
await mkdir(output, { recursive: true });
execFileSync('git', ['worktree', 'add', '--detach', baselineRoot, baselineCommit], { stdio: 'ignore' });
await cp(resolve(root, 'scripts/qa/pwa-updates/fixture.jsx'), resolve(baselineRoot, 'scripts/qa/pwa-updates/fixture.jsx'));
await cp(resolve(root, 'scripts/qa/pwa-updates/store.js'), resolve(baselineRoot, 'scripts/qa/pwa-updates/store.js'));
await symlink(resolve(root, 'node_modules'), resolve(baselineRoot, 'node_modules'), 'dir');
const builds = {};
const priorBuildCommit = process.env.VERCEL_GIT_COMMIT_SHA;
const priorWorkingDirectory = process.cwd();
try {
  for (const [label, buildRoot, commit] of [
    ['A', baselineRoot, baselineCommit],
    ['B', root, candidateCommit]
  ]) {
    const directory = resolve(output, label);
    process.env.VERCEL_GIT_COMMIT_SHA = commit;
    process.chdir(buildRoot);
    await build({ root: buildRoot, configFile: resolve(buildRoot, 'vite.config.js'), logLevel: 'error',
      define: { 'import.meta.env.VITE_UPDATE_QA_LEGACY_SYNC_BLOCKER': JSON.stringify(label === 'A') },
      plugins: [{ name: 'isolated-update-fixture', enforce: 'pre',
        resolveId(source) {
          if (source.endsWith('/store/useAppStore')) return resolve(buildRoot, 'scripts/qa/pwa-updates/store.js');
        },
        transformIndexHtml: { order: 'pre', handler(html) {
          return html.replace('/src/main.jsx', '/scripts/qa/pwa-updates/fixture.jsx');
        } },
      }],
      build: { outDir: directory, emptyOutDir: true },
    });
    builds[label] = JSON.parse(await readFile(resolve(directory, 'build-info.json'), 'utf8'));
  }
} finally {
  process.chdir(priorWorkingDirectory);
  if (priorBuildCommit === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
  else process.env.VERCEL_GIT_COMMIT_SHA = priorBuildCommit;
  execFileSync('git', ['worktree', 'remove', '--force', baselineRoot], { stdio: 'ignore' });
}
assert.notEqual(builds.A.buildId, builds.B.buildId);
assert.equal(builds.A.commit, baselineCommit);
assert.equal(builds.B.commit, candidateCommit);

const businessFixture = {
  session: [{ id: 'authorized-session', state: 'authorized', businessId: 'qa-business' }],
  businesses: [{ id: 'qa-business', access: 'authorized', plan: 'cloud' }],
  customers: [{ id: 'customer-qa-1', name: 'Fixture Customer', phone: '5557000001', phoneKey: '5557000001', debtCents: 12000 }],
  products: [{ id: 'product-qa-1', sku: 'QA-SKU-1', name: 'Fixture Product', stock: 8, priceCents: 24500 }],
  sales: [{ id: 'sale-qa-1', customerId: 'customer-qa-1', status: 'paid', totalCents: 24500, paymentCents: 24500 }],
  customerLedger: [{ id: 'ledger-qa-1', customerId: 'customer-qa-1', type: 'HISTORICAL_BALANCE', amountCents: 12000 }],
  outbox: [{ id: 'outbox-qa-1', idempotencyKey: 'outbox-qa-key-1', state: 'pending', operation: 'upsert', entityId: 'customer-qa-1', payload: { debtCents: 12000 } }],
  syncMeta: [
    { id: 'global-cursor', changeSeq: 91 },
    { id: 'customers-cursor', changeSeq: 44 },
    { id: 'deferred-customer-read', pending: true, retryAt: new Date(Date.now() + 60000).toISOString() },
    { id: 'http-reconciliation', scheduled: true, nextAt: new Date(Date.now() + 300000).toISOString(), intervalMs: 300000 }
  ]
};

let deployed = 'A';
const requests = [];
let pendingReadObserved = false;
let pendingReadWasAborted = false;
let resolvePendingReadObserved;
let resolvePendingReadAborted;
const pendingReadObservedPromise = new Promise(resolve => { resolvePendingReadObserved = resolve; });
const pendingReadAbortedPromise = new Promise(resolve => { resolvePendingReadAborted = resolve; });
const mime = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  requests.push({ deployed, pathname });
  if (pathname === '/qa-pending-read') {
    pendingReadObserved = true;
    resolvePendingReadObserved();
    res.on('close', () => {
      if (!res.writableEnded) {
        pendingReadWasAborted = true;
        resolvePendingReadAborted();
      }
    });
    return;
  }
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  try {
    const contents = await readFile(resolve(output, deployed, file));
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(contents);
  } catch { res.writeHead(404); res.end('missing'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const playwrightPath = process.env.UPDATE_QA_PLAYWRIGHT || '/tmp/lanzo-update-qa/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const results = [];
const record = (scenario, evidence) => { results.push({ scenario, evidence }); console.log(scenario, JSON.stringify(evidence)); };
const open = async context => {
  const page = await context.newPage();
  page.on('pageerror', error => console.error('PAGEERROR', error.message));
  await page.goto(origin);
  await page.waitForFunction(() => window.qa && document.querySelector('.update-controls'));
  return page;
};
const check = page => page.evaluate(() => window.qa.monitor.requestAdminServiceWorkerUpdateCheck({ force: true }));
const workerBuilds = page => page.evaluate(async () => {
  const registration = await navigator.serviceWorker.getRegistration('/');
  const readBuildId = worker => new Promise(resolve => {
    if (!worker || !window.MessageChannel) return resolve(null);
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); resolve(null); }, 1500);
    channel.port1.onmessage = event => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(event.data?.buildId || null);
    };
    worker.postMessage({ type: 'ADMIN_BUILD_INFO' }, [channel.port2]);
  });
  return {
    runningBundle: window.qa.buildId,
    activeServiceWorker: await readBuildId(navigator.serviceWorker.controller),
    waitingServiceWorker: await readBuildId(registration?.waiting)
  };
});
const readFixture = page => page.evaluate(() => window.qa.readFixture());
const canonicalFixture = fixture => Object.fromEntries(Object.entries(fixture).map(([store, records]) => (
  [store, [...records].sort((left, right) => String(left.id).localeCompare(String(right.id)))]
)));

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  let page = await open(context);
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await page.evaluate(records => window.qa.persistFixture(records), businessFixture);
  const browserSession = JSON.stringify({ state: 'authorized', businessId: 'qa-business', actor: 'qa-fixture' });
  await page.evaluate(value => localStorage.setItem('qa-auth-session', value), browserSession);
  const originalFixture = await readFixture(page);
  assert.deepEqual(originalFixture, canonicalFixture(businessFixture));
  assert.equal((await check(page)).status, 'current');
  assert.equal(await page.evaluate(() => localStorage.getItem('qa-auth-session')), browserSession);

  deployed = 'B';
  assert.equal((await check(page)).status, 'available');
  const beforeApplyBuilds = await workerBuilds(page);
  assert.equal(beforeApplyBuilds.runningBundle, builds.A.buildId);
  assert.equal(beforeApplyBuilds.activeServiceWorker, builds.A.buildId);
  assert.equal(beforeApplyBuilds.waitingServiceWorker, builds.B.buildId);
  await page.screenshot({ path: resolve(output, 'mobile-update.png') });
  await page.getByRole('button', { name: 'Más tarde' }).click();
  assert.equal(await page.evaluate(() => window.qa.store.getState().updateAvailable), true);
  await check(page);
  assert.equal(await page.locator('.update-prompt').count(), 0);

  await page.evaluate(() => { window.qa.protected = true; });
  await page.locator('.update-controls').getByRole('button', { name: 'Actualizar ahora' }).click();
  await page.waitForFunction(() => window.qa.store.getState().updateError?.includes('cobro'));
  assert.deepEqual(await readFixture(page), originalFixture);
  record('C1: protected checkout guard', { blocked: true, fixturePreserved: true });
  await page.evaluate(() => { window.qa.protected = false; });

  await page.evaluate(() => window.qa.beginTrackedWrite());
  await page.waitForFunction(() => window.qa.hasTrackedWrite());
  const trackedWriteBeforeApply = await page.evaluate(() => window.qa.hasTrackedWrite());
  assert.equal(trackedWriteBeforeApply, true);
  await page.locator('.update-controls').getByRole('button', { name: 'Actualizar ahora' }).click();
  await page.waitForFunction(() => window.qa.store.getState().updateError?.includes('guardando'));
  assert.equal(await page.evaluate(() => window.qa.buildId), builds.A.buildId);
  assert.deepEqual(await readFixture(page), originalFixture);
  record('C2: active IndexedDB write guard', { blocked: true, trackedReadWriteTransaction: trackedWriteBeforeApply, runningBuildUnchanged: true, fixturePreserved: true });
  const releasedWrite = await page.evaluate(() => window.qa.finishTrackedWrite());
  assert.equal(releasedWrite?.error, undefined, JSON.stringify(releasedWrite));
  await page.waitForFunction(() => !window.qa.hasTrackedWrite());

  // Reproduce PR #600's guard against its actual start/pull/outbox flags. The
  // hung HTTP read is non-mutating; closing the last A document aborts it and
  // lets the already-downloaded waiting worker activate by normal SW lifecycle.
  await page.evaluate(() => window.qa.beginLegacyPendingRead());
  await Promise.race([pendingReadObservedPromise, new Promise((_, reject) => setTimeout(() => reject(new Error('legacy pending HTTP read was not observed')), 5000))]);
  await page.locator('.update-controls').getByRole('button', { name: 'Actualizar ahora' }).click();
  await page.waitForFunction(() => window.qa.store.getState().updateError?.includes('sincronización'));
  assert.equal(await page.evaluate(() => window.qa.buildId), builds.A.buildId);
  assert.deepEqual(await readFixture(page), originalFixture);
  record('A→B recovery: PR #600 pending HTTP read blocks while active', {
    fromCommit: builds.A.commit, waitingCommit: builds.B.commit,
    legacyReadGuardBlocked: true, durableFixturePreserved: true
  });

  await page.close();
  await Promise.race([pendingReadAbortedPromise, new Promise((_, reject) => setTimeout(() => reject(new Error('legacy pending HTTP read was not aborted on close')), 5000))]);
  assert.equal(pendingReadWasAborted, true);
  page = await open(context);
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  const recoveredOldBundle = await workerBuilds(page);
  assert.equal(recoveredOldBundle.runningBundle, builds.B.buildId);
  assert.equal(recoveredOldBundle.activeServiceWorker, builds.B.buildId);
  assert.equal(recoveredOldBundle.waitingServiceWorker, null);
  assert.deepEqual(await readFixture(page), originalFixture);
  assert.equal(await page.evaluate(() => localStorage.getItem('qa-auth-session')), browserSession);
  assert.equal((await check(page)).status, 'current');
  const recoveredApply = await workerBuilds(page);
  assert.equal(recoveredApply.activeServiceWorker, builds.B.buildId);
  assert.deepEqual(await readFixture(page), originalFixture);
  record('A→B recovery: close last A client; waiting worker activates normally; reopen succeeds', {
    restartedBundle: recoveredOldBundle.runningBundle,
    activeAfterApply: recoveredApply.activeServiceWorker,
    waitingAfterApply: recoveredApply.waitingServiceWorker,
    durableSessionBusinessCustomersProductsOutboxCursorsFinanceDeferredRead: true
  });

  const completedCheck = await check(page);
  assert.equal(completedCheck.status, 'current');
  const afterApplyBuilds = await workerBuilds(page);
  assert.equal(afterApplyBuilds.runningBundle, builds.B.buildId);
  assert.equal(afterApplyBuilds.activeServiceWorker, builds.B.buildId);
  assert.equal(afterApplyBuilds.waitingServiceWorker, null);
  assert.deepEqual(await readFixture(page), originalFixture);
  assert.equal(await page.evaluate(() => localStorage.getItem('qa-auth-session')), browserSession);
  await page.screenshot({ path: resolve(output, 'mobile-current.png') });
  record('A/E: browser same-origin build replacement', {
    from: builds.A, to: builds.B, beforeApply: beforeApplyBuilds, afterApply: afterApplyBuilds,
    current: true, browserSessionPreserved: true, businessFixturePreserved: true,
    durable: { session: true, businessAuthorization: true, customers: true, products: true, outbox: true, cursors: true, financialData: true, deferredRead: true, scheduledReconciliation: true },
    appliedFromDownloadedCacheWhileOffline: false,
    legacyPendingHttpReadAbortedOnClose: pendingReadWasAborted
  });

  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.qa && document.querySelector('.update-controls'));
  assert.equal((await check(page)).status, 'offline');
  assert.deepEqual(await readFixture(page), originalFixture);
  await page.screenshot({ path: resolve(output, 'mobile-offline.png') });
  record('D: offline cached fixture shell and local records', { offline: true, businessFixturePreserved: true });
  await context.setOffline(false);
  await context.close();

  // Independent browser context avoids an automatic downgrade of B to A.
  deployed = 'A';
  const multi = await browser.newContext();
  const first = await open(multi);
  await first.waitForFunction(() => navigator.serviceWorker.controller);
  const second = await open(multi);
  await second.evaluate(() => { window.qa.protected = true; });
  deployed = 'B';
  assert.equal((await check(first)).status, 'available');
  await first.locator('.update-controls').getByRole('button', { name: 'Actualizar ahora' }).click();
  await first.waitForFunction(() => window.qa.store.getState().updateError?.includes('otras pestañas'));
  assert.equal(await second.evaluate(() => window.qa.buildId), builds.A.buildId);
  assert.equal(await second.evaluate(() => window.qa.protected), true);
  await second.close();
  await first.locator('.update-controls').getByRole('button', { name: 'Actualizar ahora' }).click();
  await first.waitForFunction(expected => window.qa?.buildId === expected, builds.B.buildId);
  record('F: other window prevents activation', { otherWindowStayedOnA: true, appliedAfterClosingOtherWindow: true });
  await multi.close();

  deployed = 'A';
  const reopened = await browser.newContext();
  let window = await open(reopened);
  await window.waitForFunction(() => navigator.serviceWorker.controller);
  deployed = 'B';
  assert.equal((await check(window)).status, 'available');
  await window.getByRole('button', { name: 'Más tarde' }).click();
  await window.close();
  window = await open(reopened);
  await window.waitForFunction(expected => window.qa?.buildId === expected, builds.B.buildId);
  assert.equal((await check(window)).status, 'current');
  record('B-partial: close/reopen browser lifecycle', { runningB: true, androidInstallationTested: false });
  await reopened.close();
} finally {
  await writeFile(resolve(output, 'evidence.json'), JSON.stringify({ builds, businessFixture, results, requests }, null, 2));
  await browser.close();
  server.close();
}
