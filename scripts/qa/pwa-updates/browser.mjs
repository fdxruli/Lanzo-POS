// Two real Vite/Workbox builds, real Chromium SW/cache/network, production UI
// and coordinator. Isolated Zustand slice and synthetic IDB records: this is
// integration evidence, not Android installation or commercial checkout QA.
import { build } from 'vite';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const root = process.cwd();
const output = resolve(process.env.UPDATE_QA_OUTPUT || '/tmp/lanzo-update-browser');
await mkdir(output, { recursive: true });
const builds = {};
for (const label of ['A', 'B']) {
  const directory = resolve(output, label);
  await build({ configFile: resolve(root, 'vite.config.js'), logLevel: 'error',
    plugins: [{ name: 'isolated-update-fixture', enforce: 'pre',
      resolveId(source) {
        if (source.endsWith('/store/useAppStore')) return resolve(root, 'scripts/qa/pwa-updates/store.js');
      },
      transformIndexHtml: { order: 'pre', handler(html) {
        return html.replace('/src/main.jsx', '/scripts/qa/pwa-updates/fixture.jsx');
      } },
    }],
    build: { outDir: directory, emptyOutDir: true },
  });
  builds[label] = JSON.parse(await readFile(resolve(directory, 'build-info.json'), 'utf8'));
}
assert.notEqual(builds.A.buildId, builds.B.buildId);
let deployed = 'A';
const requests = [];
const mime = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  requests.push({ deployed, pathname });
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
const idb = async (page, write = false) => page.evaluate(async write => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('update-qa-business', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('sales', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const tx = db.transaction('sales', write ? 'readwrite' : 'readonly');
  const table = tx.objectStore('sales');
  const fixture = { id: 'sale-1', cart: [{ sku: 'qa', quantity: 2 }], total: 245, reservation: 'pending', cash: 100 };
  if (write) table.put(fixture);
  const row = await new Promise(resolve => { const request = table.get('sale-1'); request.onsuccess = () => resolve(request.result); });
  await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
  db.close();
  return row;
}, write);
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await open(context);
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  const originalRecord = await idb(page, true);
  assert.equal((await check(page)).status, 'current');
  deployed = 'B';
  assert.equal((await check(page)).status, 'available');
  await page.screenshot({ path: resolve(output, 'mobile-update.png') });
  await page.getByRole('button', { name: 'Más tarde' }).click();
  assert.equal(await page.evaluate(() => window.qa.store.getState().updateAvailable), true);
  // Same build check must not undo postponement.
  await check(page);
  assert.equal(await page.locator('.update-prompt').count(), 0);
  await page.evaluate(() => { window.qa.protected = true; });
  await page.getByRole('button', { name: 'Actualizar ahora' }).click();
  await page.waitForFunction(() => window.qa.store.getState().updateError?.includes('cobro'));
  assert.equal(await page.evaluate(() => window.qa.buildId), builds.A.buildId);
  assert.deepEqual(await idb(page), originalRecord);
  record('C: protected operation (synthetic guard)', { blocked: true, recordPreserved: true });
  await page.evaluate(() => { window.qa.protected = false; });
  await context.setOffline(true);
  await page.locator('.update-controls').getByRole('button', { name: 'Actualizar ahora' }).click();
  await page.waitForFunction(expected => window.qa?.buildId === expected, builds.B.buildId);
  await context.setOffline(false);
  const completedCheck = await check(page);
  assert.equal(completedCheck.status, 'current');
  assert.equal(completedCheck.completed, true);
  assert.deepEqual(await idb(page), originalRecord);
  await page.screenshot({ path: resolve(output, 'mobile-current.png') });
  record('A/E: browser same-origin build replacement', { from: builds.A, to: builds.B, current: true, recordPreserved: true, appliedFromDownloadedCacheWhileOffline: true });
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.qa && document.querySelector('.update-controls'));
  assert.equal((await check(page)).status, 'offline');
  assert.deepEqual(await idb(page), originalRecord);
  await page.screenshot({ path: resolve(output, 'mobile-offline.png') });
  record('D: offline cached fixture shell and local record', { offline: true, recordPreserved: true });
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
  // Browser naturally activates a waiting worker after its final client closes.
  window = await open(reopened);
  await window.waitForFunction(expected => window.qa?.buildId === expected, builds.B.buildId);
  assert.equal((await check(window)).status, 'current');
  record('B-partial: close/reopen browser lifecycle', { runningB: true, androidInstallationTested: false });
  await reopened.close();
} finally {
  await writeFile(resolve(output, 'evidence.json'), JSON.stringify({ builds, results, requests }, null, 2));
  await browser.close();
  server.close();
}
