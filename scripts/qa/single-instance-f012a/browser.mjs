import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const tooling = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
const { chromium } = await import(tooling ? pathToFileURL(join(tooling, 'playwright/index.mjs')).href : 'playwright');
const root = resolve('scripts/qa/single-instance-f012a'), output = join(root, 'evidence'); await mkdir(output, { recursive: true });
const generated = await mkdtemp(join(tmpdir(), 'lanzo-f012a-')), asset = join(generated, 'fixture.js');
const bundle = await build({ entryPoints: [join(root, 'drain-fixture.js')], outfile: asset, bundle: true, format: 'esm', platform: 'browser', metafile: true });
await writeFile(join(output, 'browser-bundle-inputs.json'), JSON.stringify(Object.keys(bundle.metafile.inputs), null, 2));
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(await readFile(asset)); }
  else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><body><script type="module" src="/fixture.js"></script></body></html>'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.ACTOR_QA_CHROMIUM_EXECUTABLE, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const results = [], pageErrors = [];
const state = page => page.evaluate(() => fixture.snapshot());
const waitState = (page, wanted) => page.waitForFunction(value => window.fixture?.coordinator.getSnapshot().state === value, wanted, { timeout: 5000 });
try {
  for (const abruptClose of [false, true]) {
    const context = await browser.newContext();
    try {
      const a = await context.newPage(), b = await context.newPage();
      for (const p of [a, b]) p.on('pageerror', e => pageErrors.push(String(e)));
      await a.goto(origin); await waitState(a, 'COORDINATOR_HELD'); await b.goto(origin); await waitState(b, 'SECONDARY');
      await a.evaluate(() => fixture.begin()); const atTimeout = await state(a);
      assert.equal(atTimeout.publicSettled, true); assert.equal(atTimeout.transportActive, true); assert.equal(atTimeout.pendingExecutors, 1);
      const durable = atTimeout.durable;
      if (abruptClose) {
        await a.close(); await waitState(b, 'COORDINATOR_HELD'); const afterClose = await state(b);
        assert.deepEqual(afterClose.durable, durable); assert.equal(afterClose.dispatchCount, 0);
        results.push({ id: 'LIFE-25-NATIVE-DOCUMENT-CLOSE', result: 'PASS_BOUNDARY', atTimeout, afterClose,
          scope: 'Real document close releases native lock with synthetic durable ambiguous evidence preserved. Not a server crash/receipt test. Recovery reopen tested separately.' });
      } else {
        await a.evaluate(() => { void fixture.release(); }); await waitState(a, 'QUIESCING');
        await b.waitForTimeout(80); const beforeTransportCompletion = { a: await state(a), b: await state(b) };
        assert.equal(beforeTransportCompletion.a.nativeHeld, true); assert.equal(beforeTransportCompletion.b.state, 'SECONDARY');
        await a.evaluate(() => fixture.completeTransport()); await a.waitForFunction(() => fixture.snapshot().localActive);
        await b.waitForTimeout(80); const afterTransportCompletion = { a: await state(a), b: await state(b) };
        assert.equal(afterTransportCompletion.a.pendingExecutors, 1); assert.equal(afterTransportCompletion.a.nativeHeld, true);
        assert.equal(afterTransportCompletion.a.executionSettled, false); assert.equal(afterTransportCompletion.b.state, 'SECONDARY');
        await a.evaluate(() => fixture.completeLocal()); await waitState(a, 'RELEASED'); await waitState(b, 'COORDINATOR_HELD');
        const final = { a: await state(a), b: await state(b) }; assert.equal(final.a.executionSettled, true);
        assert.equal(final.a.dispatchCount, 1); assert.equal(final.b.dispatchCount, 0); assert.deepEqual(final.a.durable, durable);
        results.push({ id: 'CE-NATIVE-DRAIN-03-CANDIDATE', result: 'PASS', atTimeout, beforeTransportCompletion, afterTransportCompletion, final,
          scope: 'Real financial timeout/observer/coordinator + native Web Locks, synthetic transport and local continuation. No commercial gate, server or payment.' });
      }
    } finally { await context.close(); }
  }
} finally {
  await writeFile(join(output, 'chromium.json'), JSON.stringify({ version: browser.version(), origin, results, pageErrors }, null, 2));
  await browser.close(); await new Promise(done => server.close(done));
}
assert.equal(results.length, 2); assert.deepEqual(pageErrors, []);
console.log(JSON.stringify({ results: results.map(({ id, result }) => ({ id, result })), pageErrors }));
