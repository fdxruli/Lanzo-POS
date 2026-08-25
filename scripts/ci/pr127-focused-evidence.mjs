import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const targets = JSON.parse(fs.readFileSync(argument('--targets'), 'utf8'));
const outputDir = argument('--output-dir');
const repetitions = Number(argument('--repetitions') || 20);
const maxWorkers = Number(argument('--max-workers') || 4);

if (!Array.isArray(targets) || targets.length === 0) process.exit(0);
if (!Number.isInteger(repetitions) || repetitions < 10 || repetitions > 20) throw new Error('repetitions must be between 10 and 20');
if (!Number.isInteger(maxWorkers) || maxWorkers < 1) throw new Error('max-workers must be a positive integer');

for (const target of targets) {
  if (!target || typeof target.file !== 'string' || typeof target.testName !== 'string' || !/^src\/[A-Za-z0-9_./-]+$/.test(target.file) || target.file.includes('..') || !target.testName.trim()) {
    throw new Error('unsafe focused target metadata');
  }
}

fs.mkdirSync(outputDir, { recursive: true });
for (let repetition = 1; repetition <= repetitions; repetition += 1) {
  for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
    const target = targets[targetIndex];
    const suffix = targets.length === 1 ? `${repetition}` : `${repetition}-${targetIndex + 1}`;
    const outputFile = path.join(outputDir, `focused-${suffix}.json`);
    const logFile = path.join(outputDir, `focused-${suffix}.log`);
    const result = spawnSync(process.execPath, [
      './node_modules/vitest/vitest.mjs', 'run', target.file, '-t', target.testName,
      `--maxWorkers=${maxWorkers}`, '--reporter=json', `--outputFile=${outputFile}`,
    ], { encoding: 'utf8' });
    fs.writeFileSync(logFile, `${result.stdout || ''}${result.stderr || ''}`);
    fs.writeFileSync(path.join(outputDir, `focused-${suffix}.exit`), `${result.status ?? 1}\n`);
    if (result.error) throw result.error;
  }
}
