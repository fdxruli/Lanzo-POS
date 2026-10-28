import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const out = resolve(process.argv[2]);
const scripts = process.argv.includes('--build') ? ['builds','run-regressions','global'] : ['run-regressions','global'];
for (const name of scripts) {
  const result = spawnSync(process.execPath, [`scripts/qa/single-instance-f012a/${name}.mjs`, out], { stdio: 'inherit' });
  console.log(JSON.stringify({ stage: name, exit: result.status }));
  // Preserve failing suites and still run the remaining checks.
}
