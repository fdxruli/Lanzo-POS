import { readFile } from 'node:fs/promises';

function fail(message) {
  throw new Error(message);
}

function asSortedUniqueStrings(value, field, source) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item)) {
    fail(`${source}: ${field} must be an array of non-empty strings`);
  }

  const normalized = [...new Set(value)].sort((left, right) => left.localeCompare(right));
  if (normalized.length !== value.length || normalized.some((item, index) => item !== value[index])) {
    fail(`${source}: ${field} must be sorted and deduplicated`);
  }

  return normalized;
}

function asNonNegativeInteger(value, field, source) {
  if (!Number.isInteger(value) || value < 0) {
    fail(`${source}: summary.${field} must be a non-negative integer`);
  }

  return value;
}

function validateManifest(manifest, source) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail(`${source}: manifest must be an object`);
  }

  if (!manifest.summary || typeof manifest.summary !== 'object' || Array.isArray(manifest.summary)) {
    fail(`${source}: summary must be an object`);
  }

  const summary = {
    totalSuites: asNonNegativeInteger(manifest.summary.totalSuites, 'totalSuites', source),
    failedSuites: asNonNegativeInteger(manifest.summary.failedSuites, 'failedSuites', source),
    totalTests: asNonNegativeInteger(manifest.summary.totalTests, 'totalTests', source),
    failedTests: asNonNegativeInteger(manifest.summary.failedTests, 'failedTests', source),
  };
  const failedSuites = asSortedUniqueStrings(manifest.failedSuites, 'failedSuites', source);
  const failedTests = asSortedUniqueStrings(manifest.failedTests, 'failedTests', source);

  if (failedTests.length !== summary.failedTests) {
    fail(`${source}: failedTests does not match summary.failedTests`);
  }
  return { summary, failedSuites, failedTests };
}

async function loadManifest(path) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    fail(`Unable to read ${path}: ${error.message}`);
  }

  return validateManifest(parsed, path);
}

function difference(left, right) {
  const rightValues = new Set(right);
  return left.filter((value) => !rightValues.has(value));
}

if (process.argv.length !== 4) {
  console.error('Usage: node scripts/ci/compare-vitest-baseline.mjs <base-manifest> <pr-manifest>');
  process.exitCode = 2;
} else {
  try {
    const base = await loadManifest(process.argv[2]);
    const pr = await loadManifest(process.argv[3]);
    const newFailures = difference(pr.failedTests, base.failedTests);
    const resolvedFailures = difference(base.failedTests, pr.failedTests);
    const sharedFailures = pr.failedTests.filter((value) => base.failedTests.includes(value));

    let classification = 'COMPARISON_INCONCLUSIVE';
    if (newFailures.length > 0) {
      classification = 'PR_REGRESSION_CONFIRMED';
    } else if (pr.summary.failedTests < base.summary.failedTests) {
      classification = 'PR_SUITE_IMPROVED';
    } else if (pr.summary.failedTests === base.summary.failedTests && resolvedFailures.length === 0) {
      classification = 'INHERITED_GLOBAL_FAILURES_IDENTICAL';
    }

    console.log(JSON.stringify({
      classification,
      newFailures,
      resolvedFailures,
      sharedFailures,
      baseSummary: base.summary,
      prSummary: pr.summary,
    }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
