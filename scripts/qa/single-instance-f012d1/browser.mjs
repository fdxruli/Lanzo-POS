import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const out = resolve(process.argv[2] || 'scripts/qa/single-instance-f012d1/evidence');
await mkdir(out, { recursive: true });
let browser;
try {
  const modules = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
  const { chromium } = await import(modules ? pathToFileURL(join(modules, 'playwright/index.mjs')).href : 'playwright');
  // No disabled browser sandbox, certificate bypass or substituted LockManager.
  browser = await chromium.launch({ headless: true, chromiumSandbox: true,
    ...(process.env.ACTOR_QA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.ACTOR_QA_CHROMIUM_EXECUTABLE } : {}) });
} catch (error) {
  await writeFile(join(out, 'chromium.json'), JSON.stringify({ status: 'NOT_EXECUTED', cause: error.message,
    scope: 'actual scope and POS Realtime producer; controlled transport; native Web Locks; same-origin documents' }, null, 2));
  console.log('Chromium NOT_EXECUTED: ' + error.message.split('\n')[0]); process.exit(0);
}
const html = `<!doctype html><script type="module">
import {createSyncExecutionScope} from '/scope.js';
import {startPosRealtimeListener} from '/provider.js';
window.channels=[];window.removed=0;window.callbacks=0;window.held=false;window.drained=false;
window.client={channel(){const c={on(_t,_f,fn){c.change=fn;return c;},subscribe(fn){c.status=fn;return c;}};channels.push(c);return c;},
  removeChannel(){removed++;return new Promise(r=>window.finishRemoval=()=>r('ok'));}};
window.owner=createSyncExecutionScope();
window.acquire=()=>navigator.locks.request('f012d1-real-producer',async()=>{
  held=true;await new Promise(resolve=>window.release=async()=>{owner.quiesce();await owner.drain();drained=true;resolve();});held=false;});
window.start=()=>startPosRealtimeListener({posTopic:'pos:synthetic-browser',executionScope:owner,
  callbacks:{onPosChangeAvailable:()=>{callbacks++;}}});
window.ready=true;
</script>`;
const server = createServer(async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    let content;
    if (req.url === '/scope.js') content = await readFile('src/services/sync/syncExecutionScope.js', 'utf8');
    else if (req.url === '/provider.js') content = (await readFile('src/services/posRealtime.js', 'utf8'))
      .replace("'./supabase'", "'/transport.js'").replace("'./Logger'", "'/logger.js'")
      .replace("'./sync/syncConstants'", "'/constants.js'").replace("'./sync/scopedPosRealtimeListener'", "'/scoped.js'");
    else if (req.url === '/scoped.js') content = await readFile('src/services/sync/scopedPosRealtimeListener.js', 'utf8');
    else if (req.url === '/constants.js') content = (await readFile('src/services/sync/syncConstants.js', 'utf8')).replaceAll('import.meta.env', '({})');
    else if (req.url === '/transport.js') content = 'export const supabaseClient={channel(...args){return window.client.channel(...args)},removeChannel(...args){return window.client.removeChannel(...args)}};';
    else if (req.url === '/logger.js') content = 'export default {log(){},warn(){}};';
    if (content !== undefined) { res.setHeader('Content-Type', 'application/javascript'); res.end(content); }
    else { res.setHeader('Content-Type', 'text/html'); res.end(html); }
  } catch (error) { res.statusCode = 500; res.end(String(error)); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`, results = [], errors = [];
try {
  for (const scenario of ['connecting-stop', 'late-channel-callback', 'never-settling-removal']) {
    const context = await browser.newContext(), a = await context.newPage(), b = await context.newPage();
    for (const page of [a, b]) { page.on('pageerror', e => errors.push(String(e))); await page.goto(origin); await page.waitForFunction(() => window.ready); }
    await a.evaluate(() => { void acquire(); start(); }); await a.waitForFunction(() => held && channels.length === 1);
    await b.evaluate(() => { void acquire(); }); await a.evaluate(() => { void release(); });
    await a.waitForFunction(() => removed === 1); assert.equal(await b.evaluate(() => held), false);
    await a.evaluate(() => { channels[0].status('SUBSCRIBED'); channels[0].status('CLOSED'); channels[0].change({}); });
    assert.equal(await a.evaluate(() => callbacks), 0);
    if (scenario === 'never-settling-removal') {
      await a.waitForTimeout(100); assert.equal(await b.evaluate(() => held), false);
      assert.equal(await a.evaluate(() => drained), false); results.push({ scenario, status: 'PASS_PENDING', limit: 'finite observation' });
    } else {
      await a.evaluate(() => finishRemoval()); await b.waitForFunction(() => held);
      assert.equal(await a.evaluate(() => drained), true); results.push({ scenario, status: 'PASS' });
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(join(out, 'chromium.json'), JSON.stringify({ status: 'PASS', version: browser.version(), results, errors,
    limit: 'Actual producer plus controlled transport, native same-origin lock. Not App/commercial gate, server confirmation or physical PWA QA.' }, null, 2));
} finally { await browser.close(); await new Promise(r => server.close(r)); }
