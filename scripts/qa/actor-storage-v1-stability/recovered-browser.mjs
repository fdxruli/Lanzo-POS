// Isolated Chromium storage contract probe. Never opens Lanzo or real data.
// Requires playwright and ACTOR_QA_CHROMIUM_EXECUTABLE; neither is a product dependency.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const sourcePath = 'src/services/auth/actorScopedStorage.js';
const base = 'f48aab53634663438a06dc5187fa7e6d17b74fb3';
const original = execFileSync('git', ['show', `${base}:${sourcePath}`], { encoding: 'utf8' });
const candidate = readFileSync(sourcePath, 'utf8');
const modules = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
const { chromium } = await import(modules
  ? pathToFileURL(resolve(modules, 'playwright/index.mjs')).href : 'playwright');
const executablePath = process.env.ACTOR_QA_CHROMIUM_EXECUTABLE;
if (!executablePath) throw new Error('Set ACTOR_QA_CHROMIUM_EXECUTABLE to an isolated Chromium binary');
const server = createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.url.endsWith('.mjs')) {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(req.url === '/baseline.mjs' ? original : candidate);
  } else {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>Isolated actor storage fixture</title>');
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
const results = [];

const boot = async (context, version) => {
  const page = await context.newPage();
  await page.goto(url);
  await page.evaluate(async (version) => {
    window.actorStorage = await import(`/${version}.mjs`);
    window.fixtureTenant = { opaqueId: 't_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      databaseName: 'LanzoDB_t_t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', generation: 1 };
    window.contextKey = `lanzo:t:${window.fixtureTenant.opaqueId}:actor-runtime-context:v1`;
    window.mount = async (generation) => {
      const s = window.actorStorage;
      await s.prepareActorScopedStorage({ tenant: window.fixtureTenant, actorKey: 'admin:fixture-a', actorGeneration: generation });
      s.activateActorScopedStorage({ tenant: window.fixtureTenant, actorKey: 'admin:fixture-a', generation });
      s.resumeActorScopedStorageWrites();
      window.handle = s.captureActorScopedStorageHandle();
      return localStorage.getItem(window.contextKey);
    };
  }, version);
  return page;
};

try {
  for (const version of ['baseline', 'candidate']) {
    const context = await browser.newContext();
    const page = await boot(context, version);
    const old = await page.evaluate(() => window.mount(1));
    await page.evaluate(() => window.actorStorage.invalidateActorScopedStorage('fixture_expiry'));
    const durable = await page.evaluate(() => window.mount(3));
    const outcome = await page.evaluate(({ old, durable }) => {
      window.dispatchEvent(new StorageEvent('storage', { key: window.contextKey, newValue: old, storageArea: localStorage }));
      return { writesSuspended: window.actorStorage.getActorScopedStorageState().writesSuspended,
        durablePreserved: localStorage.getItem(window.contextKey) === durable };
    }, { old, durable });
    results.push({ case: `stale-event-${version}`, ...outcome,
      status: !outcome.writesSuspended && outcome.durablePreserved ? 'PASS' : 'FAIL' });
    await context.close();
  }

  // Real documents share localStorage but retain independent module bindings.
  // A's later logout/namespace cleanup must not clobber B's legitimate record.
  for (const [older, newer] of [['baseline', 'baseline'], ['candidate', 'candidate'], ['baseline', 'candidate']]) {
    const context = await browser.newContext();
    const a = await boot(context, older);
    const b = await boot(context, newer);
    await a.evaluate(() => window.mount(1));
    const durableB = await b.evaluate(() => window.mount(1)); // equal local generations are intentional
    const deniedOld = await a.evaluate(() => {
      try { window.handle.assertCurrent(); return false; } catch { return true; }
    });
    await a.evaluate(() => window.actorStorage.invalidateActorScopedStorage('late_actor_a_logout'));
    const outcome = await b.evaluate((durable) => {
      let handleCurrent;
      try { window.handle.assertCurrent(); handleCurrent = true; } catch { handleCurrent = false; }
      return { durableBPreserved: localStorage.getItem(window.contextKey) === durable,
        handleCurrent, durableStatus: JSON.parse(localStorage.getItem(window.contextKey)).status };
    }, durableB);
    results.push({ case: `LC-13-${older}-A-${newer}-B`, deniedOld, ...outcome,
      status: deniedOld && outcome.durableBPreserved && outcome.handleCurrent ? 'PASS' : 'FAIL' });
    await context.close();
  }
  console.log(JSON.stringify({ chromium: browser.version(), base, results }, null, 2));
  // Baseline failure is an attribution check; candidate security failures stay red.
  if (results.some((r) => r.case.includes('candidate') && r.status === 'FAIL')) process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
