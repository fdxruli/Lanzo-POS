import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const out = resolve(process.argv[2]);
const stages = process.argv.includes('--build') ? ['builds', 'run-regressions', 'global'] : ['run-regressions', 'global'];
for (const stage of stages) {
  // Absolute runner path permits using the identical harness against main,
  // where the F01 scripts do not exist. Commands/config still use cwd's tree.
  const script = fileURLToPath(new URL(`../single-instance-f012a/${stage}.mjs`, import.meta.url));
  const result = spawnSync(process.execPath, [script, out], { stdio: 'inherit' });
  console.log(JSON.stringify({ stage, exit: result.status, error: result.error?.message }));
  if (result.status !== 0) process.exitCode = 1;
}
