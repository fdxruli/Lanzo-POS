import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { auditAdminStartupPrecache } from '../../admin-startup-precache-audit.mjs';
const tag = process.argv[2], folder = process.argv[3] || 'dist';
if (!tag) throw Error('Supply an evidence tag and output folder');
const files = [];
function walk(dir) { for (const name of readdirSync(dir)) {const path = join(dir, name);if (statSync(path).isDirectory()) walk(path); else files.push(path);} }
walk(folder);
const violations = [];
for (const path of files.filter(p => /\.(js|html|json)$/.test(p))) {
  const content = readFileSync(path, 'utf8');
  if (/lanzo-pos-administrative-instance|f011-sentinel|Coordination laboratory|single-instance-f01[12]|CE-NATIVE-DRAIN|f012-original-key/.test(content)) violations.push(path);
}
const precache = folder === 'dist' ? await auditAdminStartupPrecache({ outDir: resolve(folder) }) : null;
const result = { tag, folder, fileCount: files.length, violations, precache,
  hashes: files.map(path => ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') })) };
writeFileSync(`scripts/qa/single-instance-f012/evidence/build-${tag}.json`, JSON.stringify(result, null, 2));
assert.equal(violations.length, 0);
console.log(JSON.stringify({ tag, files: files.length, violations: 0, precache }));
