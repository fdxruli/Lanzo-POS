import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const run = (args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.error && result.status === null) throw result.error;
  if (result.status !== 0) throw new Error(`GIT_COMMAND_FAILED:${args.join(' ')}:${result.stderr || result.stdout}`);
  return result.stdout.trim();
};
const base = process.env.FIN01_MAIN_SHA ?? '1a0d758d09310f2914c475c37d358c4cf885cc01';
const product = process.env.FIN01_PRODUCT_SHA;
const productTree = process.env.FIN01_PRODUCT_TREE_SHA;
const head = run(['rev-parse', 'HEAD']);
assert.equal(base, '1a0d758d09310f2914c475c37d358c4cf885cc01', 'APPROVED_MAIN_SHA_CHANGED');
assert.ok(product && /^[0-9a-f]{40}$/u.test(product), 'FIN01_PRODUCT_SHA_REQUIRED');
assert.ok(productTree && /^[0-9a-f]{40}$/u.test(productTree), 'FIN01_PRODUCT_TREE_SHA_REQUIRED');
assert.equal(run(['rev-parse', `${base}^{tree}`]), '6e5e6f1c77a55cec4cafee016cbe277aab89bf30', 'APPROVED_MAIN_TREE_CHANGED');
assert.equal(run(['rev-parse', `${product}^{tree}`]), productTree, 'PUBLISHED_PRODUCT_TREE_MISMATCH');
assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', base, product], { cwd: root }).status, 0, 'PRODUCT_NOT_BASED_ON_APPROVED_MAIN');
assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', product, head], { cwd: root }).status, 0, 'PRODUCT_COMMIT_NOT_ANCESTOR_OF_CI_SHA');
assert.equal(run(['rev-parse', 'origin/main']), base, 'MAIN_MOVED_FROM_APPROVED_SHA');

const manifestPath = 'docs/reports/fin01-r22/release-review/release-candidate-sha256.json';
const manifest = JSON.parse(await fs.readFile(path.join(root, manifestPath), 'utf8'));
assert.equal(manifest.base_sha, base, 'CANDIDATE_MANIFEST_BASE_SHA_MISMATCH');
assert.equal(manifest.staged_file_count, 27, 'CANDIDATE_FILE_COUNT_MISMATCH');
assert.equal(manifest.published_review_branch, 'review/fin01-f-pay-n01-release-r1', 'PUBLISHED_BRANCH_MANIFEST_MISMATCH');
assert.equal(manifest.published_product_commit_sha, product, 'PUBLISHED_PRODUCT_SHA_MANIFEST_MISMATCH');
assert.equal(manifest.published_product_tree_sha, productTree, 'PUBLISHED_PRODUCT_TREE_MANIFEST_MISMATCH');
const entries = manifest.files;
assert.equal(entries.length, 27, 'CANDIDATE_MANIFEST_ENTRY_COUNT_MISMATCH');
const expectedPaths = entries.map((entry) => entry.path).sort();
const publishedPaths = run(['diff', '--name-only', `${base}..${product}`]).split('\n').filter(Boolean).sort();
assert.deepEqual(publishedPaths, expectedPaths, 'PRODUCT_COMMIT_PATH_SET_MISMATCH');
assert.ok(entries.every((entry) => entry.path.startsWith('src/') || entry.path.startsWith('supabase/migrations/')), 'PRODUCT_PATH_OUT_OF_SCOPE');
assert.equal(run(['diff', '--name-only', `${product}..${head}`, '--', 'src', 'supabase/migrations']), '', 'RELEASE_CODE_CHANGED_AFTER_PRODUCT_COMMIT');

const secretMarkers = [
  /sb_secret_[A-Za-z0-9_-]{20,}/iu,
  /service_role_key\s*[:=]\s*['"][^'"]{20,}/iu,
  /postgres(?:ql)?:\/\/[^\s'"]+/iu,
  /eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/u
];
const secretHits = [];
for (const entry of entries) {
  const content = await fs.readFile(path.join(root, entry.path));
  const actualSha = createHash('sha256').update(content).digest('hex');
  assert.equal(actualSha, entry.sha256, `CANDIDATE_SHA256_MISMATCH:${entry.path}`);
  assert.equal(content.byteLength, entry.bytes, `CANDIDATE_BYTE_COUNT_MISMATCH:${entry.path}`);
  const text = content.toString('utf8');
  for (const marker of secretMarkers) if (marker.test(text)) secretHits.push(entry.path);
}
assert.deepEqual(secretHits, [], 'CANDIDATE_SECRET_MARKERS_FOUND');

const migrations = [
  ['supabase/migrations/20261022135915_fin01_historical_credit_owner_authorization.sql','855a25f313741d4181be90dede4925cbfdce59fce23a1ff34a5fff463eff5e9e'],
  ['supabase/migrations/20261029235906_fin01_pay_n01_atomic_rejection_v1.sql','a53cc7865092737752949bfe5db455521290206c70907040e3b920223380b244']
];
for (const [file, expected] of migrations) {
  const bytes = await fs.readFile(path.join(root, file));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, `RELEASE_MIGRATION_HASH_MISMATCH:${file}`);
}

const applier = await fs.readFile(path.join(root, 'scripts/fin01/release-review/selective-apply-lab.mjs'), 'utf8');
const workflow = await fs.readFile(path.join(root, '.github/workflows/fin01-release-review.yml'), 'utf8');
const fixturePrep = await fs.readFile(path.join(root, 'scripts/fin01/release-review/prepare-lab.sh'), 'utf8');
const financialOperationsFixture = await fs.readFile(path.join(root, 'scripts/fin01/release-review/render-financial-operations-fixture.mjs'), 'utf8');
const post3d14ReplayVerifier = await fs.readFile(path.join(root, 'scripts/fin01/release-review/verify-post3d14-replay.mjs'), 'utf8');
const gateTest = await fs.readFile(path.join(root, 'src/services/sync/__tests__/syncConstants.fin01Gate.test.js'), 'utf8');
assert.ok(!applier.includes('scripts/fin01/fin01-pay-n01-candidate.sql'), 'LEGACY_PAY_HELPER_REFERENCED');
assert.ok(gateTest.includes('isFin01HistoricalCreditImportEnabled') && gateTest.includes('toBe(false)'), 'FIN01_GATE_DEFAULT_OFF_TEST_MISSING');
assert.ok(!workflow.includes('scripts/fin01/fin01-pay-n01-candidate.sql'), 'LEGACY_PAY_HELPER_REFERENCED_BY_WORKFLOW');
assert.match(workflow, /branches:\s*\n\s*- review\/fin01-f-pay-n01-release-r1/u, 'WORKFLOW_BRANCH_SCOPE_MISMATCH');
assert.ok(!/^\s*(pull_request|pull_request_target|workflow_dispatch|schedule):/mu.test(workflow), 'UNEXPECTED_WORKFLOW_TRIGGER');
assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/u, 'WORKFLOW_WRITE_PERMISSION_PRESENT');
assert.ok(!/secrets\.|SUPABASE_(?:ACCESS_TOKEN|DB_PASSWORD|PROJECT_REF)|DATABASE_URL|VERCEL_TOKEN/u.test(workflow), 'SECRET_OR_PRODUCTION_CONNECTION_IN_WORKFLOW');
assert.ok(workflow.includes("postgres: '17.11'") && workflow.includes("postgres: '17.6'"), 'BOTH_POSTGRES_TARGETS_REQUIRED');
assert.ok(workflow.includes("node-version: '24.19.0'") && workflow.includes('--maxWorkers=1'), 'PINNED_SERIAL_RELEVANT_FRONTEND_TESTS_REQUIRED');
assert.ok(workflow.includes('run-dispatcher-focus.mjs') && workflow.includes('Exercise the 3D14 dispatcher guard after F and PAY-N01'), 'POST_MIGRATION_3D14_DISPATCHER_FOCUS_REQUIRED');
assert.ok(fixturePrep.includes('verify-post3d14-replay.mjs') && fixturePrep.includes('20261026214837_restaurant_sale_dispatcher_guard_3d14.sql'), 'CANONICAL_3D14_REPLAY_REQUIRED');
assert.ok(fixturePrep.includes('9853236a31d55d9cb6542364c30e9e06be6eddd3') && fixturePrep.includes('fd4975ea8b525f2e0b1a812e91142b24fd435dc3'), 'IMMUTABLE_PUBLIC_SOURCE_COMMITS_REQUIRED');
assert.ok(fixturePrep.includes('render-financial-operations-fixture.mjs'), 'SHARED_TERMINAL_5A_FIXTURE_REQUIRED');
const fixtureMigrationPath = 'supabase/migrations/20260820165842_shared_terminal_financial_receipt_contract.sql';
const fixtureMigrationBytes = await fs.readFile(path.join(root, fixtureMigrationPath));
const fixtureMigrationSha = createHash('sha256').update(fixtureMigrationBytes).digest('hex');
assert.equal(fixtureMigrationSha, '23a93e388cbb82c9079efc508e8491bc5e0d9b5d8760bfddd6ee1102da73df9e', 'SHARED_TERMINAL_5A_CANONICAL_SOURCE_HASH_MISMATCH');
const dispatcherFixturePath = 'supabase/tests/fixtures/restaurant_sale_dispatcher_guard_3d14_setup.sql';
const dispatcherFixtureBytes = await fs.readFile(path.join(root, dispatcherFixturePath));
const dispatcherFixtureSha = createHash('sha256').update(dispatcherFixtureBytes).digest('hex');
assert.equal(dispatcherFixtureSha, '5adb0261a49d8dccae5e9fbe292f4612cb8e5ce1f8db6692595e1ec0be4bd22c', 'DISPATCHER_FIXTURE_CANONICAL_SOURCE_HASH_MISMATCH');
assert.ok(financialOperationsFixture.includes("'23a93e388cbb82c9079efc508e8491bc5e0d9b5d8760bfddd6ee1102da73df9e'"), 'SHARED_TERMINAL_5A_SOURCE_HASH_PIN_REQUIRED');
assert.ok(financialOperationsFixture.includes("'5adb0261a49d8dccae5e9fbe292f4612cb8e5ce1f8db6692595e1ec0be4bd22c'"), 'DISPATCHER_FIXTURE_SOURCE_HASH_PIN_REQUIRED');
assert.ok(financialOperationsFixture.includes('SHARED_TERMINAL_FINANCIAL_RECEIPT_FIXTURE_PREREQUISITE_MISSING')
  && financialOperationsFixture.includes('FINANCIAL_RECEIPT_FIXTURE_SECURITY_PROFILE_MISMATCH')
  && financialOperationsFixture.includes('RESTAURANT_DISPATCHER_FIXTURE_PROFILE_MISMATCH'), 'SHARED_TERMINAL_5A_FIXTURE_MUST_FAIL_CLOSED');
assert.ok(!workflow.includes('docker logs') && !workflow.includes('postgres-${{ matrix.postgres }}.log'), 'POSTGRES_SERVICE_SQL_LOG_MUST_NOT_BE_UPLOADED');
assert.ok(post3d14ReplayVerifier.includes('POST_3D14_REPLAY_PROFILE_MISMATCH') && post3d14ReplayVerifier.includes('02eafa69f7a91343890ecc3cb2515cb37d4fcddb1de0f0fe187aa3db9a26a18b'), 'CANONICAL_3D14_REPLAY_MUST_FAIL_CLOSED');
assert.ok(workflow.includes('npm audit --omit=dev --audit-level=high'), 'PRODUCTION_DEPENDENCY_SECURITY_AUDIT_REQUIRED');
assert.ok(!workflow.includes('release-review/fixtures/**'), 'RUNTIME_FIXTURE_BODY_MUST_NOT_BE_UPLOADED');
assert.ok(!workflow.includes('pg17.11-post-pay.dump') && !workflow.includes('pg17.6-post-pay.dump'), 'SYNTHETIC_CATALOG_DUMP_MUST_NOT_BE_UPLOADED');

const labPaths = run(['diff', '--name-only', `${product}..${head}`]).split('\n').filter(Boolean).sort();
assert.ok(labPaths.length > 0, 'LAB_CERTIFICATION_FILES_REQUIRED');
assert.ok(labPaths.every((file) => file === '.github/workflows/fin01-release-review.yml'
  || file.startsWith('scripts/fin01/release-review/')
  || file.startsWith('docs/reports/fin01-r22/release-review/')), 'POST_PRODUCT_CHANGE_OUT_OF_LAB_SCOPE');
assert.ok(labPaths.every((file) => !file.startsWith('src/') && !file.startsWith('supabase/migrations/')), 'PRODUCT_CHANGED_AFTER_CERTIFIED_COMMIT');
const runtimeOnlyFixtureNames = [
  'docs/reports/fin01-r22/release-review/fixtures/extra-functions.sql',
  'docs/reports/fin01-r22/release-review/fixtures/fixture-functions.json',
  'docs/reports/fin01-r22/release-review/fixtures/fixture-tables.json',
  'docs/reports/fin01-r22/release-review/fixtures/isolated-schema.sql',
  'docs/reports/fin01-r22/release-review/fixtures/isolated-cancel-payment.sql',
  'docs/reports/fin01-r22/release-review/fixtures/fixture-final-dependencies.json',
  'docs/reports/fin01-r22/release-review/fixtures/pre-3d14-source-functions.sql'
];
assert.ok(runtimeOnlyFixtureNames.every((file) => !labPaths.includes(file)), 'PUBLIC_FIXTURE_OR_FUNCTION_BODY_DUPLICATED');
assert.ok(!labPaths.some((file) => file.startsWith('docs/reports/fin01-r22/release-review/evidence/') && file.endsWith('.json')), 'FULL_CATALOG_CAPTURE_MUST_NOT_BE_REPUBLISHED');
const labSecretMarkers = [
  /sb_secret_[A-Za-z0-9_-]{20,}/iu,
  /service_role_key\s*[:=]\s*['"][^'"]{20,}/iu,
  /postgres(?:ql)?:\/\/[^\s:@/]+:[^@\s/]+@[^/\s]+/iu,
  /eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/u,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u
];
const labSecretHits = [];
for (const file of labPaths) {
  if (file === 'scripts/fin01/release-review/verify-release-contract.mjs') continue;
  const bytes = await fs.readFile(path.join(root, file));
  const text = bytes.toString('utf8');
  for (const marker of labSecretMarkers) if (marker.test(text)) labSecretHits.push(file);
}
assert.deepEqual(labSecretHits, [], 'LAB_SECRET_MARKERS_FOUND');

const summary = {
  result: 'PASS',
  code_sha: head,
  base_sha: base,
  product_sha: product,
  product_tree_sha: productTree,
  candidate_files: entries.length,
  candidate_sha256_verified: true,
  secret_markers: 0,
  lab_files: labPaths.length,
  lab_secret_markers: labSecretHits.length,
  migration_hashes: Object.fromEntries(migrations.map(([file, hash]) => [file, hash])),
  workflow: { branch_only: true, triggers: ['push'], permissions: 'contents:read', production_secrets: false },
  pay_migration_source: 'release branch canonical supabase/migrations path'
};
await fs.mkdir(path.join(root, 'artifacts/fin01'), { recursive: true });
await fs.writeFile(path.join(root, 'artifacts/fin01/release-contract.json'), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary)}\n`);
