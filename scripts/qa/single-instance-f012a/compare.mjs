import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve(process.argv[2] || 'scripts/qa/single-instance-f012a/evidence');
const entries = tag => {
  const result = JSON.parse(readFileSync(join(root, tag, 'regressions.json'), 'utf8'));
  const tests = new Map();
  for (const suite of result.testResults) for (const test of suite.assertionResults) {
    const file = suite.name.slice(suite.name.indexOf('/src/') + 1);
    tests.set(`${file}::${test.fullName}`, { status: test.status, firstError: (test.failureMessages || []).join('\n').split('\n')[0] });
  }
  const counts = Object.fromEntries(['numPassedTests', 'numFailedTests', 'numPendingTests', 'numTotalTests'].map(k => [k, result[k]]));
  return { tests, counts };
};
const base = entries('base'), candidate = entries('candidate');
const differences = [...new Set([...base.tests.keys(), ...candidate.tests.keys()])].filter(k => JSON.stringify(base.tests.get(k)) !== JSON.stringify(candidate.tests.get(k)));
const report = { baseline: '7d9f4562a4b12efdcdfb8d5fbb77a4ff9d81ec50', baselineCounts: base.counts, candidateCounts: candidate.counts, assertions: candidate.tests.size, differences };
writeFileSync(join(root, 'differential-final.json'), JSON.stringify(report, null, 2));
assert.deepEqual(differences, []);
console.log(JSON.stringify(report));
