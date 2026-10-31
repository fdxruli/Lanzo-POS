import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const base = process.env.FIN01_MAIN_SHA ?? '1a0d758d09310f2914c475c37d358c4cf885cc01';
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
assert.equal(base, '1a0d758d09310f2914c475c37d358c4cf885cc01');
if (process.env.GITHUB_SHA) assert.equal(head, process.env.GITHUB_SHA, 'ESLINT_HEAD_SHA_MISMATCH');

const changed = execFileSync('git', ['diff', '--name-only', `${base}..${head}`, '--', 'src/'], { cwd: root, encoding: 'utf8' })
  .split('\n').filter((file) => /\.(?:js|jsx|mjs|cjs)$/u.test(file)).sort();
assert.ok(changed.length > 0, 'NO_CHANGED_SOURCE_FILES_FOR_LINT');
const eslint = new ESLint({ cwd: root, overrideConfigFile: path.join(root, 'eslint.config.js') });
const differences = [];
const total = { base_errors: 0, base_warnings: 0, candidate_errors: 0, candidate_warnings: 0 };
const diagnosticCounts = (messages) => {
  const counts = new Map();
  for (const item of messages) {
    const key = `${item.severity}|${item.ruleId ?? 'parse-error'}|${item.message}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

for (const relativePath of changed) {
  const absolutePath = path.join(root, relativePath);
  const candidateText = await fs.readFile(absolutePath, 'utf8');
  const candidateResult = (await eslint.lintText(candidateText, { filePath: absolutePath }))[0];
  const baseTextResult = spawnSync('git', ['show', `${base}:${relativePath}`], { cwd: root, encoding: 'utf8' });
  const baseText = baseTextResult.status === 0 ? baseTextResult.stdout : '';
  const baseResult = (await eslint.lintText(baseText, { filePath: absolutePath }))[0];
  const baseCounts = diagnosticCounts(baseResult.messages);
  const candidateCounts = diagnosticCounts(candidateResult.messages);
  for (const message of baseResult.messages) {
    if (message.severity === 2) total.base_errors += 1;
    if (message.severity === 1) total.base_warnings += 1;
  }
  for (const message of candidateResult.messages) {
    if (message.severity === 2) total.candidate_errors += 1;
    if (message.severity === 1) total.candidate_warnings += 1;
  }
  for (const [key, count] of candidateCounts) {
    const oldCount = baseCounts.get(key) ?? 0;
    if (count > oldCount) differences.push({ path: relativePath, diagnostic: key, baseline_count: oldCount, candidate_count: count });
  }
}

assert.deepEqual(differences, [], 'NEW_ESLINT_DIAGNOSTICS_ON_CHANGED_FILES');
const report = { result: 'PASS', base_sha: base, code_sha: head, files: changed.length, changed_paths: changed, diagnostics: total, new_diagnostics: differences };
await fs.mkdir(path.join(root, 'artifacts/fin01'), { recursive: true });
await fs.writeFile(path.join(root, 'artifacts/fin01/eslint-differential.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report)}\n`);
