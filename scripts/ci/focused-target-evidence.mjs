import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveSemanticFailureFromLog } from './pr127-global-comparison.mjs';

export const TARGET_EXECUTED_PASS = 'TARGET_EXECUTED_PASS';
export const TARGET_EXECUTED_FAIL = 'TARGET_EXECUTED_FAIL';
export const TARGET_NOT_EXECUTED = 'TARGET_NOT_EXECUTED';
export const EVIDENCE_UNREADABLE = 'EVIDENCE_UNREADABLE';
const clean = (v = '') => String(v).replace(/\s+/g, ' ').trim();

export const normalizeFile = (v = '') => {
  const normalized = String(v).replaceAll('\\', '/');
  const index = normalized.lastIndexOf('/src/');
  return index >= 0 ? normalized.slice(index + 1) : normalized.replace(/^\.\//, '');
};

export function validateTarget(target) {
  if (!target || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(target.slug || '')) throw new Error('invalid focused target slug');
  if (!/^src\/[A-Za-z0-9_./-]+$/.test(target.file || '') || target.file.includes('..')) throw new Error(`invalid focused target file: ${target.slug}`);
  if (typeof target.testName !== 'string' || !target.testName.trim()) throw new Error(`missing focused target testName: ${target.slug}`);
  return target;
}

const matchesName = (a, name) => clean(a.title) === clean(name)
  || clean(a.fullName || [...(a.ancestorTitles || []), a.title].filter(Boolean).join(' ')) === clean(name);
const failureText = (a, f) => [...(a.failureMessages || []), a.failureMessage, a.error?.message, f.message, f.failureMessage].filter(Boolean).join('\n');

export function semanticFailure(message = '') {
  const value = String(message).replace(/\u001b\[[0-9;]*m/g, '');
  let errorClass = 'OtherError';
  if (/\b(?:Test )?timed out\b|\bTimeout(?:Error)?\b/i.test(value)) errorClass = 'Timeout';
  else if (/\bAssertionError\b|\bexpect\(.+\)\.(?:to|not)\b|\bexpected\b.+\b(?:to be|to equal|to match)\b/i.test(value)) errorClass = 'AssertionError';
  else {
    const named = ['TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'URIError', 'Error'].find((name) => new RegExp(`\\b${name}\\b`).test(value));
    if (named) errorClass = named;
  }
  const signature = value.replaceAll('\\', '/')
    .replace(/[A-Za-z]:\/[^\s)]+/g, '<workspace-path>')
    .replace(/\/(?:home|tmp|runner|github|__w)\/[^\s)]+/g, '<workspace-path>')
    .replace(/:\d+:\d+\b/g, ':<line>:<column>')
    .replace(/\b\d+(?:\.\d+)?(?:ms|s)\b/gi, '<duration>')
    .split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    .find((line) => !/^at\s/.test(line) && !/node_modules\/(?:@vitest|vitest)/.test(line)) || 'missing failure message';
  return { errorClass, signature: clean(signature).slice(0, 2000) };
}

const semanticEvidence = (message, logText) => {
  const json = semanticFailure(message);
  if (!/STACK_TRACE_ERROR|missing failure message/i.test(json.signature)) return json;
  const log = deriveSemanticFailureFromLog(logText);
  return log.semanticSource === 'UNRESOLVED'
    ? json
    : { errorClass: log.semanticErrorClass, signature: log.semanticSignature };
};

export function classifyFocusedTargetReport(report, target, logText = '') {
  validateTarget(target);
  if (!report || typeof report !== 'object' || !Array.isArray(report.testResults)) {
    return { status: EVIDENCE_UNREADABLE, diagnostic: 'Vitest JSON does not contain testResults' };
  }
  const files = report.testResults.filter((file) => normalizeFile(file.name || file.testFilePath) === normalizeFile(target.file));
  const matches = files.flatMap((file) => (file.assertionResults || [])
    .filter((assertion) => matchesName(assertion, target.testName))
    .map((assertion) => ({ assertion, file })));
  const executed = matches.filter(({ assertion }) => ['passed', 'failed'].includes(assertion.status));
  if (!executed.length) return {
    status: TARGET_NOT_EXECUTED,
    diagnostic: matches.length ? 'target was only skipped/pending' : 'target file/assertion pair absent',
    matchedAssertions: matches.length,
  };
  const failed = executed.filter(({ assertion }) => assertion.status === 'failed');
  return failed.length ? {
    status: TARGET_EXECUTED_FAIL,
    executedAssertions: executed.length,
    failures: failed.map(({ assertion, file }) => semanticEvidence(failureText(assertion, file), logText)),
  } : { status: TARGET_EXECUTED_PASS, executedAssertions: executed.length, failures: [] };
}

export function readAndClassifyFocusedTarget(jsonPath, target, logText = '') {
  try {
    return classifyFocusedTargetReport(JSON.parse(fs.readFileSync(jsonPath, 'utf8')), target, logText);
  } catch (error) {
    return { status: EVIDENCE_UNREADABLE, diagnostic: error instanceof Error ? error.message : String(error) };
  }
}

const counts = (runs) => ({
  passes: runs.filter((run) => run.status === TARGET_EXECUTED_PASS).length,
  failures: runs.filter((run) => run.status === TARGET_EXECUTED_FAIL).length,
  notExecuted: runs.filter((run) => run.status === TARGET_NOT_EXECUTED).length,
  unreadable: runs.filter((run) => run.status === EVIDENCE_UNREADABLE).length,
});

export function summarizeFocusedRuns(targets, runs, repetitions, maxWorkers) {
  return { schemaVersion: 1, repetitions, maxWorkers, targets: targets.map((target) => {
    const targetRuns = runs.filter((run) => run.slug === target.slug);
    return { ...target, runs: targetRuns, counts: counts(targetRuns) };
  }) };
}

const logFactorial = [0];
const logChoose = (n, k) => {
  if (k < 0 || k > n) return Number.NEGATIVE_INFINITY;
  for (let index = logFactorial.length; index <= n; index += 1) logFactorial[index] = logFactorial[index - 1] + Math.log(index);
  return logFactorial[n] - logFactorial[k] - logFactorial[n - k];
};

export function candidateFailureRatePValue(baseFailures, candidateFailures, runsPerSide) {
  const totalFailures = baseFailures + candidateFailures;
  const maximum = Math.min(runsPerSide, totalFailures);
  let probability = 0;
  for (let candidateCount = candidateFailures; candidateCount <= maximum; candidateCount += 1) {
    probability += Math.exp(logChoose(runsPerSide, candidateCount)
      + logChoose(runsPerSide, totalFailures - candidateCount)
      - logChoose(runsPerSide * 2, totalFailures));
  }
  return Math.min(1, probability);
}
export function compareFocusedSummaries(base, candidate, minimumRepetitions = 50) {
  if (!base || !candidate || !Array.isArray(base.targets) || !Array.isArray(candidate.targets)) throw new Error('focused evidence summary missing/corrupt');
  if (base.repetitions !== candidate.repetitions || base.maxWorkers !== candidate.maxWorkers) throw new Error('BASE/CANDIDATE focused profiles differ');
  if (base.repetitions < minimumRepetitions) throw new Error(`focused evidence requires ${minimumRepetitions} repetitions; found ${base.repetitions}`);
  const candidateBySlug = new Map(candidate.targets.map((target) => [target.slug, target]));
  const matrix = base.targets.map((baseTarget) => {
    const candidateTarget = candidateBySlug.get(baseTarget.slug);
    if (!candidateTarget || candidateTarget.file !== baseTarget.file || candidateTarget.testName !== baseTarget.testName) throw new Error(`target metadata differs: ${baseTarget.slug}`);
    for (const [label, target] of [['BASE', baseTarget], ['CANDIDATE', candidateTarget]]) {
      if (target.runs.length !== base.repetitions) throw new Error(`${label} ${target.slug} has ${target.runs.length}/${base.repetitions} runs`);
      if (target.counts.notExecuted) throw new Error(`FOCUSED_TARGET_NOT_EXECUTED: ${label} ${target.slug}=${target.counts.notExecuted}`);
      if (target.counts.unreadable) throw new Error(`EVIDENCE_UNREADABLE: ${label} ${target.slug}=${target.counts.unreadable}`);
    }
    const semantics = (target) => new Set(target.runs.flatMap((run) => (run.failures || []).map((failure) => `${failure.errorClass}::${failure.signature}`)));
    const baseSemantics = semantics(baseTarget);
    const candidateSemantics = semantics(candidateTarget);
    return {
      slug: baseTarget.slug, file: baseTarget.file, testName: baseTarget.testName,
      base: baseTarget.counts, candidate: candidateTarget.counts,
      baseSemantics: [...baseSemantics], candidateSemantics: [...candidateSemantics],
      candidateOnlySemantics: [...candidateSemantics].filter((semantic) => !baseSemantics.has(semantic)),
      candidateFailureRatePValue: candidateFailureRatePValue(baseTarget.counts.failures, candidateTarget.counts.failures, base.repetitions),
      candidateFailureRateRegression: candidateTarget.counts.failures > baseTarget.counts.failures
        && candidateFailureRatePValue(baseTarget.counts.failures, candidateTarget.counts.failures, base.repetitions) < 0.05,
    };
  });
  return {
    matrix,
    candidateOnlySemanticRegressionCount: matrix.reduce((sum, row) => sum + row.candidateOnlySemantics.length, 0),
    candidateFailureRateRegressionCount: matrix.filter((row) => row.candidateFailureRateRegression).length,
  };
}

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};

function main() {
  const targetsPath = arg('--targets');
  const outputDir = path.resolve(arg('--output-dir') || '.');
  const subjectDir = path.resolve(arg('--subject-dir') || '.');
  const repetitions = Number(arg('--repetitions') || 50);
  const maxWorkers = Number(arg('--max-workers') || 4);
  if (!targetsPath) throw new Error('missing --targets');
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 100) throw new Error('repetitions must be 1..100');
  if (!Number.isInteger(maxWorkers) || maxWorkers < 1) throw new Error('max-workers must be positive');
  const targets = JSON.parse(fs.readFileSync(targetsPath, 'utf8')).map(validateTarget);
  if (!targets.length || new Set(targets.map((target) => target.slug)).size !== targets.length) throw new Error('targets must have unique slugs');
  fs.mkdirSync(outputDir, { recursive: true });
  const runs = [];
  for (const target of targets) for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    const stem = `public-store-${target.slug}-${repetition}`;
    const jsonPath = path.join(outputDir, `${stem}.json`);
    const result = spawnSync(process.execPath, [
      './node_modules/vitest/vitest.mjs', 'run', target.file, '-t', target.testName,
      `--maxWorkers=${maxWorkers}`, '--reporter=json', `--outputFile=${jsonPath}`,
    ], { cwd: subjectDir, encoding: 'utf8' });
    fs.writeFileSync(path.join(outputDir, `${stem}.log`), `${result.stdout || ''}${result.stderr || ''}`);
    fs.writeFileSync(path.join(outputDir, `${stem}.exit`), `${result.status ?? 1}\n`);
    const classification = readAndClassifyFocusedTarget(jsonPath, target, (result.stdout || '') + (result.stderr || ''));
    runs.push({ slug: target.slug, repetition, exitCode: result.status ?? 1, ...classification });
    console.log(`${target.slug} repetition ${repetition}: ${classification.status}`);
  }
  const summary = summarizeFocusedRuns(targets, runs, repetitions, maxWorkers);
  fs.writeFileSync(path.join(outputDir, 'focused-target-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  if (summary.targets.some((target) => target.counts.notExecuted || target.counts.unreadable)) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) main();
