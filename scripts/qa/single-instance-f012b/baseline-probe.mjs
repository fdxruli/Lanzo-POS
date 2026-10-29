import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const baseline = resolve(process.argv[2]), out = resolve(process.argv[3]);
const fixtureDirectory = join(baseline, 'scripts/qa/single-instance-f012b');
const fixture = join(fixtureDirectory, 'baseline-probe.test.js');
mkdirSync(fixtureDirectory, { recursive: true }); mkdirSync(out, { recursive: true });
const setup = readFileSync('scripts/qa/single-instance-f012b/bootstrap.test.js', 'utf8')
  .split("describe('F01-2B")[0]
  .replace("import { createBootstrapLifecycle, installTraceRecorder } from './trace.mjs';", '')
  .replace('beforeEach, afterEach, describe,', 'beforeEach, afterEach,');
writeFileSync(fixture, setup + `
it('CE-BOOT-01 baseline sequential initialization restores twice', async () => {
  const state = setup(); await state.initializeApp(); const first = actor.getState().generation;
  await state.initializeApp(); const second = actor.getState().generation;
  expect(mocks.restore).toHaveBeenCalledTimes(2); expect(second).toBeGreaterThan(first);
});\n`);
try {
  const run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', fixture, '--maxWorkers=1', '--reporter=json', `--outputFile=${join(out,'baseline-counterexample.json')}`], { cwd: baseline, encoding: 'utf8' });
  writeFileSync(join(out,'baseline-counterexample.log'), `${run.stdout}\n${run.stderr}`);
  process.exitCode = run.status;
} finally { rmSync(fixture); }
