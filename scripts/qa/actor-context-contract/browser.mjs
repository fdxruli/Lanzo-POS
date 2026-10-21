// RESEARCH ONLY: isolated origins/profiles; no Supabase, app bootstrap or user data.
import { createServer as http } from 'node:http';
import { createServer as https } from 'node:https';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = 'scripts/qa/actor-context-contract';
const base = 'f48aab53634663438a06dc5187fa7e6d17b74fb3';
const sources = {
  '/prototype.mjs': readFileSync(`${root}/prototype.mjs`, 'utf8'),
  '/main.mjs': execFileSync('git', ['show', `${base}:src/services/auth/actorScopedStorage.js`], { encoding: 'utf8' }),
  '/focal.mjs': readFileSync('src/services/auth/actorScopedStorage.js', 'utf8'),
  '/dexie.mjs': readFileSync('node_modules/dexie/dist/dexie.mjs', 'utf8')
};
const handler = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', sources[req.url] ? 'text/javascript' : 'text/html');
  res.end(sources[req.url] || '<!doctype html><title>Actor contract research fixture</title>');
};
const server = http(handler); await new Promise((r) => server.listen(0, '0.0.0.0', r));
const local = `http://127.0.0.1:${server.address().port}`;
let ip;
try { ip = Object.values(networkInterfaces()).flat().find((i) => i.family === 'IPv4' && !i.internal)?.address; } catch { /* lab restricts NIC enumeration */ }
const modules = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
const { chromium } = await import(modules ? pathToFileURL(resolve(modules, 'playwright/index.mjs')).href : 'playwright');
const browser = await chromium.launch({ executablePath: process.env.ACTOR_QA_CHROMIUM_EXECUTABLE,
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-proxy-server'] });
const results = []; let fixtureId = 0; let tlsServer;
const boot = async (context, version = 'prototype', origin = local, id = 'shared') => {
  const page = await context.newPage(); await page.goto(`${origin}/?fixture=${id}`);
  await page.evaluate(async ({ version, id }) => {
    window.fixtureVersion = version;
    window.proto = await import('/prototype.mjs');
    window.db = await window.proto.openPrototype(`actor-research-${id}`);
    window.identity = { tenant: 'synthetic-T', actor: 'admin:A', session: 'session-A', device: 'device-A' };
    window.legacyKey = 'lanzo:t:t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:actor-runtime-context:v1';
    if (version === 'prototype') {
      window.channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(`research-${id}`);
      window.client = window.proto.createClient(window.db, window.identity, { notify: (hint) => {
        window.channel?.postMessage(hint);
        localStorage.setItem('researchHint', JSON.stringify({ ...hint, nonce: Math.random() }));
      } });
      window.channel?.addEventListener('message', (e) => { void window.client.onHint(e.data); });
      window.addEventListener('storage', (e) => { if (e.key === 'researchHint') void window.client.onHint(JSON.parse(e.newValue)); });
      window.mount = async (expected = null) => {
        window.handle = await window.client.grant(window.client.prepare(), expected); return window.handle.binding.token;
      };
      window.invalidate = () => window.client.invalidate(window.handle);
    } else {
      window.legacy = await import(`/${version}.mjs`);
      const tenant = { opaqueId: 't_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', databaseName: 'LanzoDB_t_t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', generation: 1 };
      window.mount = async (generation = 1) => {
        await window.legacy.prepareActorScopedStorage({ tenant, actorKey: 'admin:fixture', actorGeneration: generation });
        window.legacy.activateActorScopedStorage({ tenant, actorKey: 'admin:fixture', generation });
        window.legacy.resumeActorScopedStorageWrites();
        window.handle = window.legacy.captureActorScopedStorageHandle(); return window.handle.binding.contextToken;
      };
      window.invalidate = () => window.legacy.invalidateActorScopedStorage('late-A');
    }
    window.probe = async () => {
      let current = false; let error;
      try { await window.handle.assertCurrent(); current = true; } catch (e) { error = e.code || e.name; }
      return { current, error, runtime: window.client?.state() || { status: 'NOT_LOADED_storage_only' },
        legacy: localStorage.getItem(window.legacyKey), durable: await window.proto.snapshot(window.db) };
    };
    window.writeProbe = async (id = 'probe') => {
      try {
        if (window.client) {
          await window.client.beginOperation(window.handle, id); await window.client.commit(window.handle, id, id);
        } else window.handle.setItem('commercial-ai-sales-profitability-history-v1', 'synthetic-write');
        return true;
      } catch { return false; }
    };
  }, { version, id }); return page;
};
const run = async (id, versions, execute, options = {}) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: Boolean(options.tls) });
  if (options.noBC) await context.addInitScript(() => { delete globalThis.BroadcastChannel; });
  if (options.intercept) await context.route('http://192.168.250.10/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({ status: 200, contentType: sources[path] ? 'text/javascript' : 'text/html',
      body: sources[path] || '<!doctype html><title>Synthetic IP-origin lab</title>' });
  });
  const unique = String(++fixtureId);
  try {
    const pages = await Promise.all(versions.map((v) => boot(context, v, options.origin || local, unique)));
    const observed = await execute(...pages, context);
    results.push({ id, versions, ...observed, limitation: observed.limitation || 'Synthetic coordination/effect boundary; not POS financial E2E or physical device QA.' });
  } catch (e) { results.push({ id, versions, status: 'ERROR', error: e.message }); }
  finally { await context.close(); }
};
const replaced = async (a, b) => {
  const ta = await a.evaluate(() => window.mount());
  const before = await a.evaluate(() => window.probe());
  await b.evaluate((t) => window.mount(t), ta);
  const bBefore = await b.evaluate(() => window.probe()); await a.evaluate(() => window.invalidate());
  const afterA = await a.evaluate(() => window.probe()); const afterB = await b.evaluate(() => window.probe());
  return { before, bBefore, afterA, afterB, status: !afterA.current && afterB.current ? 'PASS' : 'FAIL' };
};
try {
  for (const [id, versions] of [['ARCH-01', ['main', 'main']], ['ARCH-02', ['main', 'focal']], ['ARCH-03', ['focal', 'focal']]]) {
    await run(id, versions, async (a, b) => {
      await a.evaluate(() => window.mount()); const before = await a.evaluate(() => window.probe());
      await b.evaluate(() => window.mount()); const bBefore = await b.evaluate(() => window.probe());
      await a.evaluate(() => window.invalidate()); const afterA = await a.evaluate(() => window.probe()); const afterB = await b.evaluate(() => window.probe());
      return { before, bBefore, afterA, afterB, expected: 'B remains current; A denied', status: afterB.current ? 'PASS' : 'FAIL' };
    });
  }
  await run('ARCH-04/R1', ['prototype', 'prototype'], replaced);
  for (const [id, versions] of [['ARCH-05/R7', ['main', 'prototype']], ['ARCH-06/R7', ['prototype', 'main']]]) {
    await run(id, versions, async (a, b) => {
      await a.evaluate(() => window.mount()); await b.evaluate(() => window.mount());
      const beforeA = await a.evaluate(() => window.probe()); const beforeB = await b.evaluate(() => window.probe());
      const writeA = await a.evaluate(() => window.writeProbe()); const writeB = await b.evaluate(() => window.writeProbe());
      return { beforeA, beforeB, writeA, writeB, expected: 'Replacement retires former authority', status: beforeA.current && beforeB.current ? 'FAIL' : 'PASS',
        limitation: 'Counterexample to ignoring legacy. Both handle boundaries permit writes; no sale/payment RPC executed.' };
    });
  }
  await run('ARCH-07/R7', ['main', 'prototype'], async (a, b, context) => {
    await a.evaluate(() => window.mount()); const cdp = await context.newCDPSession(a);
    await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
    await b.evaluate(() => window.mount()); await cdp.send('Page.setWebLifecycleState', { state: 'active' });
    const afterA = await a.evaluate(() => window.probe()); const afterB = await b.evaluate(() => window.probe());
    return { afterA, afterB, status: afterA.current && afterB.current ? 'FAIL' : 'PASS', limitation: 'Actual CDP freeze/thaw, not Windows suspend; legacy not participating in IDB.' };
  });
  await run('ARCH-08/R7', ['main', 'prototype'], async (a, b, context) => {
    await a.evaluate(() => window.mount()); await b.evaluate(() => window.mount());
    const cdp = await context.newCDPSession(b); await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
    await a.evaluate(() => window.invalidate()); await cdp.send('Page.setWebLifecycleState', { state: 'active' });
    const afterB = await b.evaluate(() => window.probe());
    return { afterB, status: afterB.current ? 'PASS' : 'FAIL', limitation: 'B survives old invalidation in separate authority. This alone does not exclude legacy reauthentication (ARCH05/06).' };
  });
  await run('ARCH-09/R8', ['prototype', 'prototype'], async (a, b) => {
    const outcomes = await Promise.allSettled([a.evaluate(() => window.mount()), b.evaluate(() => window.mount())]);
    return { outcomes: outcomes.map((r) => ({ status: r.status, value: r.value, error: r.reason?.message })),
      durable: await a.evaluate(() => window.proto.snapshot(window.db)), status: outcomes.filter((r) => r.status === 'fulfilled').length === 1 ? 'PASS' : 'FAIL' };
  });
  await run('ARCH-10', ['prototype'], async (a) => {
    await a.evaluate(() => window.mount()); await a.evaluate(() => Promise.all([window.invalidate(), window.invalidate()]));
    const after = await a.evaluate(() => window.probe()); return { after, status: !after.current && after.durable.authority[0].status === 'locked' ? 'PASS' : 'FAIL' };
  });
  for (const order of ['revoke-first', 'grant-first']) await run(`ARCH-11/R2/${order}`, ['prototype', 'prototype'], async (a, b) => {
    const t = await a.evaluate(() => window.mount());
    // Barrier: complete first operation before releasing the second, testing both legal serial orders.
    if (order === 'revoke-first') { await a.evaluate(() => window.invalidate()); await b.evaluate((t) => window.mount(t), t); }
    else { await b.evaluate((t) => window.mount(t), t); await a.evaluate(() => window.invalidate()); }
    const afterA = await a.evaluate(() => window.probe()); const afterB = await b.evaluate(() => window.probe());
    return { afterA, afterB, status: !afterA.current && afterB.current ? 'PASS' : 'FAIL' };
  });
  await run('ARCH-12', ['prototype'], async (a) => {
    await a.evaluate(() => window.mount()); await a.evaluate(() => window.proto.transaction(window.db, ['authority'], 'readwrite', (tx) => tx.put('authority', 'synthetic-T', { bad: true })));
    const after = await a.evaluate(() => window.probe()); return { after, status: !after.current ? 'PASS' : 'FAIL' };
  });
  await run('ARCH-13/R4', ['prototype'], async (a) => {
    await a.evaluate(() => window.mount()); await a.evaluate(() => window.client.blockStorage());
    const after = await a.evaluate(() => window.probe()); const write = await a.evaluate(() => window.writeProbe());
    return { after, write, status: !after.current && !write ? 'PASS' : 'FAIL', limitation: 'Injected unavailable provider; not browser quota/policy/eviction.' };
  });
  for (const [id, change] of [['ARCH-14/R5', { tenant: 'synthetic-U' }], ['ARCH-15', { device: 'device-B' }]]) await run(id, ['prototype'], async (a) => {
    await a.evaluate(() => window.mount()); await a.evaluate((change) => window.client.changeIdentity(change), change);
    const after = await a.evaluate(() => window.probe()); return { after, status: !after.current ? 'PASS' : 'FAIL' };
  });
  await run('ARCH-16', ['prototype'], async (a) => {
    const result = await a.evaluate(() => { window.client.prepare(); let denied; try { window.client.capture(); denied = false; } catch { denied = true; } return { denied, runtime: window.client.state() }; });
    return { ...result, status: result.denied ? 'PASS' : 'FAIL' };
  });
  await run('ARCH-17', ['prototype', 'prototype'], async (a, b) => {
    const t = await a.evaluate(() => window.mount()); await a.evaluate(() => window.client.beginOperation(window.handle, 'pending-payment'));
    const pending = await a.evaluate(() => window.proto.snapshot(window.db)); let rejected = false;
    try { await b.evaluate((t) => window.mount(t), t); } catch { rejected = true; }
    const after = await a.evaluate(() => window.proto.snapshot(window.db));
    return { pending, after, handoffRejected: rejected, status: rejected && after.effects.length === 0 && after.operations[0].owner.token === t ? 'PASS' : 'FAIL' };
  });
  await run('ARCH-18', ['prototype'], async (a) => {
    await a.evaluate(() => window.mount()); const before = await a.evaluate(() => window.probe()); await a.reload();
    const restored = await a.evaluate(async () => {
      const p = await import('/prototype.mjs'); const db = await p.openPrototype('actor-research-' + new URL(location).searchParams.get('fixture'));
      const durable = await p.snapshot(db);
      db.close(); return { hasHandle: Boolean(window.handle), hasClient: Boolean(window.client), durable };
    });
    return { before, restored, status: !restored.hasHandle && !restored.hasClient ? 'PASS' : 'FAIL', limitation: 'Reload destroys module memory; actual OS discard/BFCache and authorized recovery remain PENDING.' };
  });
  results.push({ id: 'ARCH-19', versions: ['prototype', 'prototype'], status: 'PENDING', limitation: 'Installed PWA/Android/Windows not available. No installed-PWA claim from headless pages.' });
  await run('ARCH-20', ['prototype', 'prototype'], replaced, { noBC: true });
  if (ip) await run('ARCH-21', ['prototype', 'prototype'], async (a, b) => ({ ...await replaced(a, b), capabilities: await a.evaluate(() => ({ secure: isSecureContext, idb: Boolean(indexedDB), locks: Boolean(navigator.locks), subtle: Boolean(crypto.subtle) })) }), { origin: `http://${ip}:${server.address().port}` });
  else await run('ARCH-21', ['prototype', 'prototype'], async (a, b) => ({ ...await replaced(a, b),
    capabilities: await a.evaluate(() => ({ secure: isSecureContext, idb: Boolean(indexedDB), locks: Boolean(navigator.locks), subtle: Boolean(crypto.subtle) })),
    limitation: 'Private IP origin intercepted locally; real LAN transport/laptop/Android PENDING. No NIC enumeration permitted in lab.' }), { origin: 'http://192.168.250.10', intercept: true });
  if (process.env.ACTOR_QA_TLS_KEY && process.env.ACTOR_QA_TLS_CERT) {
    tlsServer = https({ key: readFileSync(process.env.ACTOR_QA_TLS_KEY), cert: readFileSync(process.env.ACTOR_QA_TLS_CERT) }, handler);
    await new Promise((r) => tlsServer.listen(0, '127.0.0.1', r));
    await run('ARCH-22', ['prototype', 'prototype'], async (a, b) => ({ ...await replaced(a, b), secure: await a.evaluate(() => isSecureContext) }), { origin: `https://localhost:${tlsServer.address().port}`, tls: true });
  } else results.push({ id: 'ARCH-22', status: 'PENDING', limitation: 'Set local TLS fixture certificate paths.' });
  await run('ARCH-23/R3', ['prototype', 'prototype'], async (a, b) => {
    const t = await a.evaluate(() => window.mount()); await b.evaluate((t) => window.mount(t), t);
    await b.evaluate(() => Promise.all([window.client.onHint({ tenant: 'synthetic-T', token: 'stale' }), window.client.onHint({ tenant: 'synthetic-T', token: 'stale' })]));
    const after = await b.evaluate(() => window.probe()); return { after, status: after.current ? 'PASS' : 'FAIL' };
  });
  await run('ARCH-24', ['prototype', 'prototype'], replaced);
  await run('ARCH-25', ['prototype'], async (a) => {
    await a.evaluate(() => window.mount()); await a.evaluate(() => window.invalidate()); const after = await a.evaluate(() => window.probe());
    return { after, write: await a.evaluate(() => window.writeProbe()), status: !after.current ? 'PASS' : 'FAIL' };
  });
  await run('EXTRA-IDB-UPGRADE-FENCE', ['prototype'], async (page) => {
    const outcome = await page.evaluate(async () => {
      const { default: Dexie } = await import('/dexie.mjs');
      const old = new Dexie('synthetic-schema-fence'); old.version(1).stores({ effects: 'id' }); await old.open();
      await old.table('effects').put({ id: 'before', synthetic: true });
      const next = new Dexie('synthetic-schema-fence'); next.version(1).stores({ effects: 'id' }); next.version(2).stores({ authority: 'tenant' });
      await next.open(); let reopened = false; let error;
      try { await old.open(); await old.table('effects').put({ id: 'after-upgrade', synthetic: true }); reopened = true; } catch (e) { error = e.name; }
      const rows = await next.table('effects').toArray(); const result = { reopened, error, dexieVersion: Dexie.semVer, oldVersion: old.verno, nextVersion: next.verno, rows };
      old.close(); next.close(); return result;
    });
    return { ...outcome, status: outcome.reopened ? 'FAIL' : 'PASS', limitation: 'Actual installed Dexie fallback tested on synthetic schema. Lanzo cold-start preflight separately rejects unsupported versions; no complete schema cutover proven.' };
  });
  console.log(JSON.stringify({ chromium: browser.version(), base, protocol: 'RESEARCH_ONLY_v2', results }, null, 2));
  // Expected counterexamples remain FAIL in evidence. Only harness errors are unexpected.
  if (results.some((r) => r.status === 'ERROR')) process.exitCode = 2;
} finally {
  await browser.close(); await new Promise((r) => server.close(r));
  if (tlsServer) await new Promise((r) => tlsServer.close(r));
}
