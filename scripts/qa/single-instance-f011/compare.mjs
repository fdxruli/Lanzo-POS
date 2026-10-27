import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
const directory = 'scripts/qa/single-instance-f011/evidence/';
const read = p => JSON.parse(existsSync(directory + p) ? readFileSync(directory + p) : gunzipSync(readFileSync(directory + p + '.gz')));
const assertions = data => data.testResults.flatMap(file => file.assertionResults.map(test => ({
  file: file.name.split('/src/')[1], name: test.fullName, status: test.status,
})));
const base = assertions(read('base/regressions.json')), candidate = assertions(read('regressions.json'));
const key = row => `${row.file}::${row.name}`;
const failures = rows => rows.filter(t => t.status === 'failed');
const old = new Set(failures(base).map(key));
const added = failures(candidate).filter(t => !old.has(key(t)));
const absent = base.filter(row => !candidate.some(c => key(c) === key(row)));
const summary = { base: { total: base.length, passed: base.filter(r => r.status === 'passed').length, failed: failures(base) },
  candidate: { total: candidate.length, passed: candidate.filter(r => r.status === 'passed').length, failed: failures(candidate) },
  newFailures: added, missingAssertions: absent, identicalStatuses: candidate.every(row => base.some(b => key(b) === key(row) && b.status === row.status)) };
writeFileSync(directory + 'baseline-comparison.json', JSON.stringify(summary, null, 2));
assert.equal(added.length, 0); assert.equal(absent.length, 0); assert(summary.identicalStatuses);
console.log(JSON.stringify({ base: base.length, candidate: candidate.length, sharedFailures: failures(base).length, newFailures: added.length }));
