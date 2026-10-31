import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.env.PR378_DIAGNOSTIC_ARTIFACTS || 'pr378-diagnostic-artifacts');
let summary;
try { summary = JSON.parse(readFileSync(resolve(root, 'summary.json'), 'utf8')); }
catch {
  console.error('PR378 diagnostic summary missing or unreadable.');
  process.exit(1);
}
const failures = summary.runs.filter(run => run.nativeExitCode !== 0);
if (failures.length) {
  console.error('Native Vitest exit codes were non-zero for:');
  for (const run of failures) console.error(run.side + '/' + run.variant + ': ' + run.nativeExitCode);
  process.exit(1);
}
console.log('All recorded native Vitest exit codes were zero.');
