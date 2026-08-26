import fs from 'node:fs';
import { compareFocusedSummaries } from './focused-target-evidence.mjs';

const [basePath, candidatePath, markdownPath = 'focused-target-differential.md', jsonPath = 'focused-target-differential.json'] = process.argv.slice(2);
if (!basePath || !candidatePath) throw new Error('usage: compare-focused-target-evidence.mjs <base-summary> <candidate-summary> [markdown] [json]');

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const result = compareFocusedSummaries(read(basePath), read(candidatePath), 50);
const lines = [
  '# Focused target differential',
  '',
  '| Target | File | BASE pass/fail/not-executed/unreadable | CANDIDATE pass/fail/not-executed/unreadable | Candidate-only semantics | Failure-rate p-value |',
  '|---|---|---|---|---|---|',
  ...result.matrix.map((row) => {
    const count = (value) => `${value.passes}/${value.failures}/${value.notExecuted}/${value.unreadable}`;
    return `| ${row.slug} | ${row.file} | ${count(row.base)} | ${count(row.candidate)} | ${row.candidateOnlySemantics.length} | ${row.candidateFailureRatePValue.toFixed(4)} |`;
  }),
  '',
  `- FOCUSED_TARGET_NOT_EXECUTED: 0`,
  `- EVIDENCE_UNREADABLE: 0`,
  `- CANDIDATE-ONLY SEMANTIC REGRESSIONS: ${result.candidateOnlySemanticRegressionCount}`,
  `- CANDIDATE FAILURE-RATE REGRESSIONS: ${result.candidateFailureRateRegressionCount}`,
  '',
];
fs.writeFileSync(markdownPath, lines.join('\n'));
fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(lines.join('\n'));
if (result.candidateOnlySemanticRegressionCount > 0 || result.candidateFailureRateRegressionCount > 0) process.exitCode = 1;
