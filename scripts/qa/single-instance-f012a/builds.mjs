import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { auditAdminStartupPrecache } from '../../admin-startup-precache-audit.mjs';
const out = resolve(process.argv[2]); mkdirSync(out, { recursive: true });
const results = [];
for (const [name, cmd, args] of [
  ['preview', 'node', ['node_modules/vite/bin/vite.js', 'build']],
  ['production', 'npm', ['run', 'build']],
  ['store', 'npm', ['run', 'build:store']],
  ['store-vercel', 'npm', ['run', 'build:store:vercel']],
]) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, env: { ...process.env, VERCEL_ENV: name === 'preview' ? 'preview' : 'production' } });
  writeFileSync(join(out, `build-${name}.log.gz`), gzipSync(`${r.stdout || ''}\n${r.stderr || ''}`));
  let audit = null;
  if (r.status === 0 && ['production', 'preview'].includes(name)) {
    audit = await auditAdminStartupPrecache({ outDir: resolve('dist') });
    const files = []; const walk = dir => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p); else files.push(p); } }; walk('dist');
    const violations = files.filter(p => /\.(js|html|json)$/.test(p) && /lanzo-pos-administrative-instance|single-instance-f012a|f012a-original-key|CE-NATIVE-DRAIN/.test(readFileSync(p, 'utf8')));
    audit = { ...audit, fixtureOrCoordinatorViolations: violations };
  }
  results.push({ name, command: [cmd, ...args], vercelEnv: name === 'preview' ? 'preview' : 'production', exitCode: r.status, error: r.error?.message, audit });
  writeFileSync(join(out, 'builds.json'), JSON.stringify(results, null, 2));
  if (r.status !== 0) process.exitCode = 1;
}
