import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { parse } from '@babel/parser';
const out = resolve(process.argv[2] || 'scripts/qa/single-instance-f012d2/evidence');
mkdirSync(out, { recursive: true });
const baseline = 'ce03b04918347898396957c8b7f35eb955896b89';
const git = args => {
  const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 12 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr); return result.stdout;
};
const allowed = new Set([
  'src/hooks/useCaja.js', 'src/services/financial/financialCancellationProjection.js',
  'src/services/financial/financialProjectionRegistry.js', 'src/services/financial/financialIntentRecoveryCoordinator.js'
]);
const original = git(['ls-tree', '-r', baseline]).trim().split('\n').map(line => {
  const [metadata, path] = line.split('\t'); return { path, sha: metadata.split(' ')[2] };
}).filter(row => /^(src\/|public\/|store\/|supabase\/|\.github\/|package(?:-lock)?\.json$|vite.*\.js$|eslint.config.js$|vercel.json$)/.test(row.path));
const local = spawnSync('git', ['hash-object', '--stdin-paths'], { input: original.map(row => row.path).join('\n') + '\n', encoding: 'utf8' });
assert.equal(local.status, 0, local.stderr);
const hashes = local.stdout.trim().split('\n');
const changed = original.filter((row, i) => row.sha !== hashes[i]).map(row => row.path);
assert(changed.every(path => allowed.has(path)), 'Unexpected commercial source change');
assert.equal(changed.length, allowed.size);
const callbacks = text => {
  const found = new Map();
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'VariableDeclarator' && node.init?.callee?.name === 'useCallback') {
      found.set(node.id.name, text.slice(node.start, node.end));
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(parse(text, { sourceType: 'module', plugins: ['jsx'] }));
  return found;
};
const originalCallbacks = callbacks(git(['show', `${baseline}:src/hooks/useCaja.js`]));
const currentCallbacks = callbacks(readFileSync('src/hooks/useCaja.js', 'utf8'));
const symbols = [...originalCallbacks].map(([symbol, text]) => ({ symbol, identical: currentCallbacks.get(symbol) === text }));
assert.equal(currentCallbacks.size, originalCallbacks.size);
assert.deepEqual(symbols.filter(row => !row.identical).map(row => row.symbol), ['cargarEstadoCaja']);
writeFileSync(join(out, 'callsite-preservation.json'), JSON.stringify({ baseline, symbols }, null, 2));
const roots = ['dist', 'dist-store', '.vercel/output'];
const assets = [];
const walk = path => {
  for (const entry of readdirSync(path)) {
    const file = join(path, entry); if (statSync(file).isDirectory()) walk(file);
    else if (/\.(js|html|json)$/.test(file)) assets.push(file);
  }
};
for (const root of roots) { try { walk(root); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
// unknown_critical_work is also the preexisting bootstrapLifecycle default
// (commercial since F01-2B). Use the unique sync scope factory sentinel; do not
// mislabel the byte-identical older helper as new QA/scope-factory leakage.
const forbidden = /synthetic-sale|synthetic-cash|single-instance-f012d2|cancelled-but-queued|lanzo-pos-administrative-instance|SYNC_EXECUTION_QUIESCE_REQUIRED/;
const violations = assets.filter(file => forbidden.test(readFileSync(file, 'utf8')));
assert.equal(violations.length, 0, 'QA/coordinator/scope-factory leaked into commercial assets');
const newSource = 'src/services/financial/cancellationCashRefreshRoute.js';
const report = { baseline, preexistingFiles: original.length, unchanged: original.length - changed.length, changed,
  newSource: { path: newSource, sha256: createHash('sha256').update(readFileSync(newSource)).digest('hex') },
  originalScopeImplementationUnchanged: true, scannedAssets: assets.length, violations,
  gate: 'OFF: App/main/ready activation callers unchanged, no new scope constructed by the commercial graph. Optional route code is reachable; scoped ownership requires explicit injection. Legacy remains uncertified.',
  preserved: 'Actor Runtime/Scoped Storage, M01/F02, Admin168h/Staff policy, six reserved Caja financial callsites, durable financial contracts, SQL, dependencies, workflows, license/security realtime and Ecommerce topics/capabilities preserve baseline blobs.'
};
writeFileSync(join(out, 'audit.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
