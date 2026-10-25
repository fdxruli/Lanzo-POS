import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = resolve(process.argv[2] || 'scripts/qa/single-instance-f012d1/evidence');
const baselines = { base: '0f1625f46e6fe234e378487bb06f74f4bd1555e9', main: '52bb573e651529b323b6617e3161cd76ece14a39' };
const normalizations = [];
const normalize = (data, tag) => {
  const sample = data.testResults.find(suite => suite.name.includes('/src/'));
  const prefix = sample.name.slice(0, sample.name.indexOf('/src/'));
  // Runner dependency realpaths can point at the shared installation. Normalize
  // only the three known checkout prefixes, symmetrically on both sides.
  let text = JSON.stringify(data);
  const prefixes = [prefix, '/workspace/scratch/2a5709f8e222/Lanzo-POS', '/workspace/scratch/2a5709f8e222/Lanzo-baseline',
    '/workspace/scratch/2a5709f8e222/Lanzo-main', '/workspace/scratch/2a5709f8e222/Lanzo-candidate-validated'];
  for (const value of new Set(prefixes)) {
    const count = text.split(value).length - 1;
    if (count) { text = text.split(value).join('/tmp/lanzo-checkout'); normalizations.push({ tag, prefix: value, count }); }
  }
  return JSON.parse(text);
};
const counts = data => Object.fromEntries(['numPassedTests', 'numFailedTests', 'numPendingTests', 'numTotalTests'].map(k => [k, data[k]]));
const map = data => new Map(data.testResults.flatMap(suite => suite.assertionResults.map(test => [
  `${suite.name}::${test.fullName}`, { status: test.status, error: (test.failureMessages || []).join('\n').split('\n')[0] }
])));
const report = {};
for (const [tag, sha] of Object.entries(baselines)) {
  report[tag] = {};
  for (const file of ['regressions.json', 'global.json']) {
    const a = normalize(JSON.parse(readFileSync(join(root, tag, file))), `${tag}/${file}`);
    const b = normalize(JSON.parse(readFileSync(join(root, 'candidate', file))), `candidate/${file}`);
    const am = map(a), bm = map(b);
    const changed = [...am].filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(bm.get(key)));
    const added = [...bm].filter(([key]) => !am.has(key));
    report[tag][file] = { baseline: sha, base: counts(a), candidate: counts(b), changed, added };
    writeFileSync(join(root, 'differential.json'), JSON.stringify(report, null, 2));
    assert.equal(changed.length, 0, `Changed historical results: ${tag}/${file}`);
    assert(added.every(([, value]) => value.status === 'passed'), `Non-passing additions: ${tag}/${file}`);
    if (file === 'global.json') {
      const out = join(root, `pr127-${tag}`); mkdirSync(out, { recursive: true });
      writeFileSync(join(out, 'base.json'), JSON.stringify(a)); writeFileSync(join(out, 'candidate.json'), JSON.stringify(b));
      for (const args of [
        ['extract', '--candidate', join(out, 'candidate.json'), '--base', join(out, 'base.json'), '--output', join(out, 'phase-one.json')],
        ['classify', '--phase', join(out, 'phase-one.json'), '--base-focused', join(out, 'focused/base'), '--candidate-focused', join(out, 'focused/candidate'), '--output', join(out, 'final.json')]
      ]) {
        const result = spawnSync(process.execPath, ['scripts/ci/pr127-global-comparison.mjs', ...args], { encoding: 'utf8' });
        writeFileSync(join(out, `${args[0]}.log`), `${result.stdout}\n${result.stderr}`);
        assert.equal(result.status, 0, `Original PR127 ${tag}/${args[0]} failed`);
      }
    }
  }
}
writeFileSync(join(root, 'normalization.json'), JSON.stringify(normalizations, null, 2));
console.log(JSON.stringify(Object.fromEntries(Object.entries(report).map(([tag, files]) => [tag,
  Object.fromEntries(Object.entries(files).map(([file, value]) => [file, { ...value, changed: value.changed.length, added: value.added.length }]))
]))));
