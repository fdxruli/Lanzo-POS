import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const tooling = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
const { chromium } = await import(tooling ? pathToFileURL(join(tooling, 'playwright/index.mjs')).href : 'playwright');
const root = resolve('scripts/qa/single-instance-f011');
const output = join(root, 'evidence'); await mkdir(output, { recursive: true });
const generated = await mkdtemp(join(tmpdir(), 'lanzo-f011-'));
for (const [entry, outfile] of [['fixture.js', 'fixture.js'], ['strict-view.jsx', 'strict.js']]) {
  await build({ entryPoints: [join(root, entry)], outfile: join(generated, outfile), bundle: true, format: 'esm', platform: 'browser', define: { 'process.env.NODE_ENV': '"development"' } });
}
const html = '<!doctype html><html><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
const delayed = [];
const server = createServer(async (req, res) => {
  if (req.url.startsWith('/delayed.js')) { delayed.push(res); return; }
  res.setHeader('Cache-Control', 'no-store');
  if (req.url === '/fixture.js' || req.url === '/strict.js') {
    res.setHeader('Content-Type', 'application/javascript'); res.end(await readFile(join(generated, req.url.slice(1))));
  } else { res.setHeader('Content-Type', 'text/html'); res.end(html); }
});
await new Promise(done => server.listen(0, '0.0.0.0', done));
const port = server.address().port;
const origin = `http://127.0.0.1:${port}`;
const options = { executablePath: process.env.ACTOR_QA_CHROMIUM_EXECUTABLE, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'] };
const browser = await chromium.launch(options);
const results = [], pageErrors = [];
const state = page => page.evaluate(() => fixture.snapshot());
const waitState = (page, expected) => page.waitForFunction(wanted => window.fixture?.coordinator.getSnapshot().state === wanted, expected, { timeout: 6000 });
const pageIn = async (context, query = '', url = origin) => {
  const page = await context.newPage(); page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(`${url}/?${query}`); await page.waitForFunction(() => Boolean(window.fixture)); return page;
};
const assertGroup = async (pages, holders = 1) => {
  const snapshots = await Promise.all(pages.map(state));
  assert.equal(snapshots.filter(s => s.state === 'COORDINATOR_HELD').length, holders);
  assert(snapshots.every(s => ['COORDINATOR_HELD', 'SECONDARY'].includes(s.state)));
  return snapshots;
};
async function test(n, title, run, classification = 'PASS') {
  const context = await browser.newContext(); const pages = [];
  const open = async (query = '', url = origin) => { const p = await pageIn(context, query, url); pages.push(p); return p; };
  try {
    const evidence = await run({ context, open, pages });
    const snapshots = [];
    for (const p of pages) if (!p.isClosed()) { try { snapshots.push(await state(p)); } catch { /* renderer crash recorded in evidence */ } }
    results.push({ id: `F011-${String(n).padStart(2, '0')}`, title, result: classification, evidence, snapshots });
    process.stdout.write(`${results.at(-1).id} ${classification}\n`);
  } catch (error) {
    results.push({ id: `F011-${String(n).padStart(2, '0')}`, title, result: 'FAIL', error: String(error), stack: error.stack });
    process.stdout.write(`${results.at(-1).id} FAIL ${error}\n`);
  } finally { await context.close(); }
  await writeFile(join(output, 'chromium.json'), JSON.stringify({ version: browser.version(), origin, results, pageErrors }, null, 2));
}
try {
  await test(1, 'one document', async ({ open }) => { const a = await open(); await waitState(a, 'COORDINATOR_HELD'); assert.equal((await state(a)).counters.bootstrap, 1); });
  await test(2, 'two sequential', async ({ open, pages }) => { await waitState(await open(), 'COORDINATOR_HELD'); await open(); await assertGroup(pages); });
  await test(3, 'two simultaneous', async ({ context }) => { const pages = await Promise.all([pageIn(context), pageIn(context)]); await Promise.all(pages.map(p => p.waitForFunction(() => ['SECONDARY', 'COORDINATOR_HELD'].includes(fixture.coordinator.getSnapshot().state)))); return await assertGroup(pages); });
  await test(4, 'three sequential', async ({ open, pages }) => { await waitState(await open(), 'COORDINATOR_HELD'); await open(); await open(); await assertGroup(pages); });
  await test(5, 'five documents', async ({ open, pages }) => { await waitState(await open(), 'COORDINATOR_HELD'); for (let i = 0; i < 4; i++) await open(); await assertGroup(pages); });
  await test(6, 'third cannot evict incumbent', async ({ open, pages }) => { const a = await open(); await waitState(a, 'COORDINATOR_HELD'); const id = (await state(a)).instanceId; await open(); await open(); await assertGroup(pages); assert.equal((await state(a)).instanceId, id); assert.equal((await state(a)).state, 'COORDINATOR_HELD'); });
  await test(7, 'reload respects actual arbitration order', async ({ open, pages }) => { const a = await open(); await waitState(a, 'COORDINATOR_HELD'); const id = (await state(a)).instanceId; const b = await open(); await a.reload(); await waitState(b, 'COORDINATOR_HELD'); await waitState(a, 'SECONDARY'); assert.notEqual((await state(a)).instanceId, id); await assertGroup(pages); });
  await test(8, 'normal document close', async ({ open }) => { const a = await open(); await waitState(a, 'COORDINATOR_HELD'); const b = await open(); await a.close(); await waitState(b, 'COORDINATOR_HELD'); });
  await test(9, 'renderer crash eventual release', async ({ open, context }) => { const a = await open(); await waitState(a, 'COORDINATOR_HELD'); const b = await open(); const cdp = await context.newCDPSession(a); const crash = cdp.send('Page.crash').catch(() => {}); await Promise.race([crash, new Promise(done => setTimeout(done, 500))]); await waitState(b, 'COORDINATOR_HELD'); await a.close().catch(() => {}); return { crash: 'CDP Page.crash, no financial task' }; });
  await test(10, 'secondary close', async ({ open }) => { const a = await open(); await waitState(a, 'COORDINATOR_HELD'); const b = await open(); await b.close(); assert.equal((await state(a)).state, 'COORDINATOR_HELD'); });
  await test(11, 'cancel queued request', async ({ open }) => { const a = await open(); await waitState(a, 'COORDINATOR_HELD'); const b = await open(); await b.evaluate(() => fixture.release()); await waitState(b, 'RELEASED'); await a.close(); assert.equal((await state(b)).counters.bootstrap, 0); });
  for (const [n, title] of [[12, 'frozen principal keeps native ownership'], [13, 'late resume keeps same ownership']]) {
    await test(n, title, async ({ open, context }) => {
      const a = await open(); await waitState(a, 'COORDINATOR_HELD'); const before = await state(a); const cdp = await context.newCDPSession(a);
      await cdp.send('Debugger.enable'); const paused = new Promise(done => cdp.once('Debugger.paused', done));
      void cdp.send('Runtime.evaluate', { expression: 'debugger' }).catch(() => {}); await paused;
      await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
      const b = await open(); await b.waitForTimeout(300); assert.equal((await state(b)).state, 'SECONDARY');
      await cdp.send('Page.setWebLifecycleState', { state: 'active' }); await cdp.send('Debugger.resume');
      await waitState(a, 'COORDINATOR_HELD'); assert.equal((await state(a)).instanceId, before.instanceId);
      return { freeze: 'CDP lifecycle plus confirmed Debugger.paused; not physical OS hibernation' };
    });
  }
  for (const [n, kind] of [[14, 'historical'], [15, 'duplicate'], [16, 'reordered'], [17, 'other-request'], [18, 'other-recipient'], [19, 'wrong-version']]) {
    await test(n, `${kind} messages never transfer ownership`, async ({ open }) => {
      const a = await open(); await waitState(a, 'COORDINATOR_HELD'); const b = await open();
      const evidence = await b.evaluate(kind => {
        const c = fixture.coordinator, req = c.probe(), own = c.getSnapshot().instanceId, from = 'e'.repeat(32);
        const make = (serial, extra = {}) => ({ v: 1, type: 'STATUS', from, to: own, requestId: req, messageId: `${from}:${serial}`, epoch: 1, mode: 'web-locks', state: 'COORDINATOR_HELD', ...extra });
        const first = make(10);
        if (kind === 'historical' || kind === 'other-request') fixture.inject(make(11, { requestId: 'f'.repeat(32) }));
        if (kind === 'duplicate') { fixture.inject(first); fixture.inject(first); }
        if (kind === 'reordered') { fixture.inject(first); fixture.inject(make(9, { epoch: 2 })); }
        if (kind === 'other-recipient') fixture.inject(make(11, { to: 'f'.repeat(32) }));
        if (kind === 'wrong-version') fixture.inject(make(11, { v: 99 }));
        const after = c.getSnapshot();
        if (after.state !== 'SECONDARY') throw Error('hint admitted a secondary');
        if (['historical', 'other-request', 'other-recipient', 'wrong-version'].includes(kind) && after.observedOwner) throw Error('invalid hint changed observation');
        if (kind === 'reordered' && after.observedOwner.epoch !== 1) throw Error('reordered epoch accepted');
        return { injected: kind, stateImmediatelyAfterInjection: after.state, owner: after.observedOwner };
      }, kind);
      assert.equal((await state(a)).state, 'COORDINATOR_HELD'); return evidence;
    });
  }
  for (const [n, query] of [[20, 'noBC'], [21, 'denyBC']]) await test(n, query, async ({ open }) => { const a = await open(query); await waitState(a, 'COORDINATOR_HELD'); const b = await open(query); await waitState(b, 'SECONDARY'); assert.equal((await state(a)).messaging, 'unavailable'); await a.close(); await waitState(b, 'COORDINATOR_HELD'); });
  for (const [n, query] of [[22, 'noLocks'], [23, 'denyLocks']]) await test(n, query, async ({ open }) => { const a = await open(query); await waitState(a, 'ERROR'); assert.equal((await state(a)).counters.bootstrap, 0); assert.equal((await state(a)).nativeHeld, false); });
  await test(24, 'offline loaded documents still coordinate', async ({ open, context }) => { const a = await open(); await waitState(a, 'COORDINATOR_HELD'); const b = await open(); await context.setOffline(true); await b.evaluate(() => fixture.coordinator.probe()); await a.close(); await waitState(b, 'COORDINATOR_HELD'); return { coldOfflineBootstrap: 'not tested' }; });
  await test(25, 'real React StrictMode subscriptions', async ({ open }) => { const a = await open(); await waitState(a, 'COORDINATOR_HELD'); await a.addScriptTag({ url: `${origin}/strict.js`, type: 'module' }); await a.waitForFunction(() => window.strictStats?.setup === 2); await a.evaluate(() => unmountStrict()); const s = await state(a); assert.equal(s.counters.requests, 1); assert.equal(s.counters.bootstrap, 1); assert.equal(s.nativeHeld, true); return await a.evaluate(() => strictStats); });
  await test(26, 'late callback rejects revoked ticket', async ({ open }) => { const a = await open(); await waitState(a, 'COORDINATOR_HELD'); await a.evaluate(() => fixture.beginWork()); await a.evaluate(() => fixture.release()); await waitState(a, 'QUIESCING'); await a.evaluate(() => fixture.finishWork()); await waitState(a, 'RELEASED'); const s = await state(a); assert.equal(s.counters.lateEffect, 0); assert(s.counters.errors.includes('INSTANCE_COORDINATION_STALE')); });
  await test(27, 'pending real ESM import drains before release', async ({ open }) => {
    const a = await open(); await waitState(a, 'COORDINATOR_HELD'); const b = await open(); await a.evaluate(() => fixture.beginWork('import'));
    await a.waitForFunction(() => fixture.coordinator.getSnapshot().pendingExecutors === 1);
    for (let tries = 0; !delayed.length && tries < 50; tries++) await a.waitForTimeout(20);
    assert(delayed.length); await a.evaluate(() => fixture.release()); await waitState(a, 'QUIESCING'); assert.equal((await state(b)).state, 'SECONDARY');
    for (const response of delayed.splice(0)) { response.setHeader('Content-Type', 'application/javascript'); response.end('window.fixture.counters.evaluations++; export const synthetic = true;'); }
    await waitState(a, 'RELEASED'); await waitState(b, 'COORDINATOR_HELD'); const s = await state(a); assert.equal(s.counters.evaluations, 1); assert.equal(s.counters.lateBootstrap, 0);
  });
  await test(28, 'synthetic drain keeps queued candidate waiting', async ({ open }) => { const a = await open(); await waitState(a, 'COORDINATOR_HELD'); await a.evaluate(() => fixture.beginWork()); const b = await open(); await a.evaluate(() => fixture.release()); await waitState(a, 'QUIESCING'); await b.waitForTimeout(150); assert.equal((await state(b)).state, 'SECONDARY'); assert.equal((await state(a)).nativeHeld, true); await a.evaluate(() => fixture.finishWork()); await waitState(b, 'COORDINATOR_HELD'); });
  await test(29, 'legacy ignores lock: universal exclusion refuted', async ({ open, context }) => { const legacy = await context.newPage(); await legacy.goto(`${origin}/legacy`); await legacy.waitForFunction(() => window.fixture); await legacy.evaluate(async () => { await fixture.coordinator.quiesceAndRelease(); window.legacyOperating = true; window.legacyReplies = 0; window.oldChannel = new BroadcastChannel('lanzo_pos_instance'); oldChannel.onmessage = event => { if (event.data.type === 'I_AM_HERE') legacyReplies++; }; oldChannel.postMessage({ type: 'CHECK_EXISTING' }); }); const a = await open(); await waitState(a, 'COORDINATOR_HELD'); await legacy.evaluate(() => oldChannel.postMessage({ type: 'CHECK_EXISTING' })); await a.waitForTimeout(150); assert.equal(await legacy.evaluate(() => legacyOperating && legacyReplies === 0), true); return { exclusionGuarantee: 'FAIL', legacy: 'synthetic old protocol, no financial operations', legacyOperational: true, newHolder: true }; }, 'COUNTEREXAMPLE');
  await test(30, 'two independent browser processes', async ({ open }) => { const a = await open(); await waitState(a, 'COORDINATOR_HELD'); const other = await chromium.launch(options); try { const context = await other.newContext(); const b = await pageIn(context); await waitState(b, 'COORDINATOR_HELD'); return { separateProfiles: true, crossProfileExclusion: false, otherSnapshot: await state(b) }; } finally { await other.close(); } });
  await test(31, 'two independent origins', async ({ open, pages }) => { await waitState(await open(), 'COORDINATOR_HELD'); await waitState(await open('', `http://localhost:${port}`), 'COORDINATOR_HELD'); await assertGroup(pages, 2); });
  await test(32, 'HTTP IP origin capability fixture', async ({ context }) => { await context.route('http://192.0.2.10/**', async route => { const url = new URL(route.request().url()); await route.fulfill({ status: 200, contentType: url.pathname === '/fixture.js' ? 'application/javascript' : 'text/html', body: url.pathname === '/fixture.js' ? await readFile(join(generated, 'fixture.js'), 'utf8') : html }); }); const a = await pageIn(context, '', 'http://192.0.2.10'); await waitState(a, 'ERROR'); const s = await state(a); assert.equal(s.capabilities.secureContext, false); assert.equal(s.capabilities.webLocks, false); assert.equal(s.counters.bootstrap, 0); return { ...s, limitation: 'intercepted HTTP IP; physical owner LAN NOT_TESTED' }; }, 'PARTIAL');
  await test(33, 'both APIs absent never starts synthetic bootstrap', async ({ open }) => { const a = await open('noLocks&noBC'); await waitState(a, 'ERROR'); assert.equal((await state(a)).counters.bootstrap, 0); });
  await test(34, 'local epoch revokes issued ticket', async ({ open }) => { const a = await open(); await waitState(a, 'COORDINATOR_HELD'); return await a.evaluate(async () => { const c = fixture.coordinator, ticket = c.captureTicket(); const before = ticket.localEpoch; const release = c.quiesceAndRelease(); if (c.isCurrent(ticket) || !ticket.signal.aborted || c.getSnapshot().localEpoch <= before) throw Error('ticket not revoked synchronously'); await release; return { before, after: c.getSnapshot().localEpoch }; }); });
  await test(35, 'explicit release with candidate queued', async ({ open }) => { const a = await open(); await waitState(a, 'COORDINATOR_HELD'); const b = await open(); await a.evaluate(() => fixture.release()); await waitState(a, 'RELEASED'); await waitState(b, 'COORDINATOR_HELD'); });
  await test(36, 'multiple start calls one native request', async ({ open }) => { const a = await open(); await waitState(a, 'COORDINATOR_HELD'); await a.evaluate(() => Promise.all(Array.from({ length: 20 }, () => fixture.coordinator.start()))); assert.equal((await state(a)).counters.requests, 1); });
  await test(37, 'retry after transient request error', async ({ open }) => { const a = await open('transient'); await waitState(a, 'ERROR'); await a.evaluate(() => fixture.coordinator.retry()); await waitState(a, 'COORDINATOR_HELD'); assert.equal((await state(a)).counters.requests, 2); });
  await test(38, 'recovery preserves existing storage', async ({ open }) => { const a = await open(); await waitState(a, 'COORDINATOR_HELD'); await a.evaluate(() => localStorage.setItem('f011-sentinel', 'preserved')); const b = await open(); await a.close(); await waitState(b, 'COORDINATOR_HELD'); assert.equal(await b.evaluate(() => localStorage.getItem('f011-sentinel')), 'preserved'); });
  await test(39, 'coordination ticket is not synthetic actor authority', async ({ open }) => { const a = await open(); await waitState(a, 'COORDINATOR_HELD'); const result = await a.evaluate(() => { const ticket = fixture.coordinator.captureTicket(); fixture.coordinator.assertCurrent(ticket); const actorAuthorized = false; return { coordinated: true, actorAuthorized, allowed: actorAuthorized && fixture.coordinator.isCurrent(ticket) }; }); assert.equal(result.allowed, false); return result; });
  await test(40, 'zero business module closure in coordinator', async () => { const bundled = await build({ entryPoints: ['src/services/instance/instanceCoordinator.js'], bundle: true, write: false, metafile: true }); const inputs = Object.keys(bundled.metafile.inputs); assert.equal(inputs.length, 3); assert(inputs.every(p => p.startsWith('src/services/instance/'))); return { inputs }; });
} finally {
  await writeFile(join(output, 'chromium.json'), JSON.stringify({ version: browser.version(), origin, results, pageErrors }, null, 2));
  await browser.close(); server.closeAllConnections(); await new Promise(done => server.close(done));
}
if (results.some(r => r.result === 'FAIL') || pageErrors.length) process.exitCode = 1;
