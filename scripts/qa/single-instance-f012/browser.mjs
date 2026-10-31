import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const tooling = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
const { chromium } = await import(tooling ? pathToFileURL(join(tooling, 'playwright/index.mjs')).href : 'playwright');
const root = resolve('scripts/qa/single-instance-f012');
const output = join(root, 'evidence'); await mkdir(output, { recursive: true });
const generated = await mkdtemp(join(tmpdir(), 'lanzo-f012-'));
const asset = join(generated, 'fixture.js');
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
  for (const trackRaw of [false, true]) {
    const context = await browser.newContext();
    try {
      const a = await context.newPage(); const b = await context.newPage();
      for (const page of [a, b]) page.on('pageerror', error => pageErrors.push(String(error)));
      await a.goto(origin); await waitState(a, 'COORDINATOR_HELD');
      await b.goto(origin); await waitState(b, 'SECONDARY');
      await a.evaluate(track => fixture.begin(track), trackRaw);
      const atTimeout = await state(a);
      assert.equal(atTimeout.publicSettled, true); assert.equal(atTimeout.nativeActive, true);
      assert.equal(atTimeout.pendingExecutors, trackRaw ? 1 : 0);
      await a.evaluate(() => { void fixture.release(); });
      if (trackRaw) {
        await waitState(a, 'QUIESCING');
        assert.equal((await state(a)).nativeHeld, true);
        assert.equal((await state(b)).state, 'SECONDARY');
      } else {
        await waitState(a, 'RELEASED'); await waitState(b, 'COORDINATOR_HELD');
        assert.equal((await state(a)).nativeActive, true);
      }
      const beforeNativeCompletion = { a: await state(a), b: await state(b) };
      await a.evaluate(() => fixture.completeNative());
      await waitState(a, 'RELEASED'); await waitState(b, 'COORDINATOR_HELD');
      results.push({ id: trackRaw ? 'RAW-TRACKING-PROPOSAL' : 'CE-NATIVE-DRAIN-03', result: trackRaw ? 'PASS' : 'COUNTEREXAMPLE', atTimeout, beforeNativeCompletion, afterNativeCompletion: { a: await state(a), b: await state(b) }, scope: 'real coordinator + real timeout + native Web Locks; raw transport is a synthetic deferred promise; no commercial bootstrap or actor' });
    } finally { await context.close(); }
  }
} finally {
  await writeFile(join(output, 'chromium.json'), JSON.stringify({ version: browser.version(), origin, results, pageErrors }, null, 2));
  await browser.close(); await new Promise(done => server.close(done));
}
assert.equal(results.length, 2); assert.deepEqual(pageErrors, []);
console.log(JSON.stringify({ results: results.map(({ id, result }) => ({ id, result })), pageErrors }));
