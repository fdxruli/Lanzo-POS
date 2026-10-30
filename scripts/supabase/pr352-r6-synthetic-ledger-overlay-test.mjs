import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  fingerprintLedger,
  prepareSyntheticOverlay,
  verifyPreparedOverlay,
  withPrivateTempDirectory,
} from './pr352-r6-synthetic-ledger-overlay.mjs';

const ROWS = 333;
const CANDIDATE = '20260102000000_synthetic_bridge_probe.sql';
const results = [];

function evidenceFile() {
  return process.env.PR352_R6_OVERLAY_EVIDENCE_FILE
    || path.join(process.env.PR352_R6_EVIDENCE_DIR || path.join(os.tmpdir(), 'pr352-r6-evidence'), 'synthetic-overlay.json');
}

async function writeEvidence(report) {
  const outputPath = evidenceFile();
  await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'w' });
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function versionFor(index) {
  const seconds = index;
  const hour = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const minute = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const second = String(seconds % 60).padStart(2, '0');
  return '20260101' + hour + minute + second;
}

async function fixture(root) {
  const fetchedDirectory = path.join(root, 'synthetic-fetch', 'supabase', 'migrations');
  const candidateDirectory = path.join(root, 'synthetic-candidates');
  const docsDirectory = path.join(root, 'synthetic-manifest');
  await mkdir(fetchedDirectory, { recursive: true });
  await mkdir(candidateDirectory, { recursive: true });
  await mkdir(docsDirectory, { recursive: true });

  const entries = [];
  for (let index = 1; index <= ROWS; index += 1) {
    const version = versionFor(index);
    const name = 'synthetic_migration_' + String(index).padStart(4, '0');
    const contents = Buffer.from('select ' + index + ' as synthetic_step;\n', 'utf8');
    await writeFile(path.join(fetchedDirectory, version + '_' + name + '.sql'), contents, { flag: 'wx' });
    entries.push({
      version,
      name,
      fetch_sql_sha256: hash(contents),
      fetch_sql_bytes: contents.length,
    });
  }
  const manifest = {
    schemaVersion: 1,
    purpose: 'synthetic-only',
    observedLedgerRows: ROWS,
    latestVersion: entries.at(-1).version,
    canonicalFingerprint: fingerprintLedger(entries),
    rawSqlIncluded: false,
    sensitiveValuesIncluded: false,
    syntheticStatementsOnly: true,
    entries,
  };
  const manifestPath = path.join(docsDirectory, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest), { flag: 'wx' });

  const candidatePath = path.join(candidateDirectory, CANDIDATE);
  await writeFile(candidatePath, 'select 9001 as synthetic_overlay;\n', { flag: 'wx' });
  return { root, manifestPath, fetchedDirectory, candidateDirectory, candidatePath, manifest };
}

async function record(name, callback) {
  try {
    await callback();
    results.push({ name, status: 'PASS' });
    process.stdout.write('OVERLAY_CASE_PASS ' + name + '\n');
  } catch (error) {
    results.push({ name, status: 'FAIL', reason: String(error.message || error) });
    process.stderr.write('OVERLAY_CASE_FAIL ' + name + ' ' + String(error.message || error) + '\n');
  }
}

async function isolated(name, callback) {
  await withPrivateTempDirectory(async (root) => {
    const f = await fixture(root);
    await callback(f);
  });
}

async function run() {
  await record('333 harmless entries, deterministic order, exactly one candidate', () => isolated('positive', async (f) => {
    const prepared = await prepareSyntheticOverlay(f);
    assert.equal(prepared.evidence.ledgerRows, ROWS);
    assert.equal(prepared.evidence.pendingCount, 1);
    assert.equal(prepared.evidence.localMigrationFilesAfterOverlay, ROWS + 1);
    assert.equal(prepared.evidence.sqlContentsEmitted, false);
    assert.equal((await readdir(f.fetchedDirectory)).length, ROWS + 1);
    assert.deepEqual(await verifyPreparedOverlay({ ...f, snapshot: prepared.snapshot }), {
      status: 'PASS',
      checkedFiles: ROWS + 1,
      pendingCount: 1,
      sqlContentsEmitted: false,
    });
  }));

  await record('missing fetched version rejected', () => isolated('missing', async (f) => {
    await rm(path.join(f.fetchedDirectory, f.manifest.entries[23].version + '_' + f.manifest.entries[23].name + '.sql'));
    await assert.rejects(prepareSyntheticOverlay(f), /file set differs/);
  }));

  await record('duplicate ledger identity rejected', () => isolated('duplicate', async (f) => {
    f.manifest.entries[1].version = f.manifest.entries[0].version;
    f.manifest.canonicalFingerprint = fingerprintLedger(f.manifest.entries);
    await writeFile(f.manifestPath, JSON.stringify(f.manifest));
    await assert.rejects(prepareSyntheticOverlay(f), /duplicate synthetic migration version or name/);
  }));

  await record('renamed file identity rejected', () => isolated('rename', async (f) => {
    f.manifest.entries[9].name += '_renamed';
    f.manifest.canonicalFingerprint = fingerprintLedger(f.manifest.entries);
    await writeFile(f.manifestPath, JSON.stringify(f.manifest));
    await assert.rejects(prepareSyntheticOverlay(f), /file set differs/);
  }));

  await record('modified SQL bytes rejected by per-file fingerprint', () => isolated('sql-drift', async (f) => {
    const entry = f.manifest.entries[5];
    await writeFile(path.join(f.fetchedDirectory, entry.version + '_' + entry.name + '.sql'), 'select 999 as synthetic_step;\n');
    await assert.rejects(prepareSyntheticOverlay(f), /SQL fingerprint mismatch/);
  }));

  await record('reordered entries rejected even with a recomputed aggregate fingerprint', () => isolated('order-drift', async (f) => {
    f.manifest.entries.reverse();
    f.manifest.canonicalFingerprint = fingerprintLedger(f.manifest.entries);
    await writeFile(f.manifestPath, JSON.stringify(f.manifest));
    await assert.rejects(prepareSyntheticOverlay(f), /strict canonical version order/);
  }));

  await record('manifest fingerprint tamper rejected', () => isolated('manifest-drift', async (f) => {
    f.manifest.canonicalFingerprint = '0'.repeat(64);
    await writeFile(f.manifestPath, JSON.stringify(f.manifest));
    await assert.rejects(prepareSyntheticOverlay(f), /canonical ledger fingerprint mismatch/);
  }));

  await record('unexpected fetched migration rejected', () => isolated('extra-file', async (f) => {
    await writeFile(path.join(f.fetchedDirectory, '20260101001000_synthetic_unexpected.sql'), 'select 10000 as synthetic_step;\n');
    await assert.rejects(prepareSyntheticOverlay(f), /file set differs/);
  }));

  await record('older candidate version rejected', () => isolated('old-candidate', async (f) => {
    const oldPath = path.join(f.candidateDirectory, '20250101000000_synthetic_old_candidate.sql');
    await rm(f.candidatePath);
    await writeFile(oldPath, 'select 9001 as synthetic_overlay;\n');
    await assert.rejects(prepareSyntheticOverlay({ ...f, candidatePath: oldPath }), /candidate version must be newer/);
  }));

  await record('second pending candidate rejected', () => isolated('second-candidate', async (f) => {
    await writeFile(path.join(f.candidateDirectory, '20260102000001_synthetic_second_candidate.sql'), 'select 9002 as synthetic_overlay;\n');
    await assert.rejects(prepareSyntheticOverlay(f), /exactly one approved candidate migration/);
  }));

  await record('drift between validation and application rejected', () => isolated('post-validation-drift', async (f) => {
    const prepared = await prepareSyntheticOverlay(f);
    const entry = f.manifest.entries[77];
    await writeFile(path.join(f.fetchedDirectory, entry.version + '_' + entry.name + '.sql'), 'select 12345 as synthetic_step;\n');
    await assert.rejects(verifyPreparedOverlay({ ...f, snapshot: prepared.snapshot }), /SQL fingerprint mismatch/);
  }));

  await record('candidate source drift between validation and application rejected', () => isolated('candidate-source-drift', async (f) => {
    const prepared = await prepareSyntheticOverlay(f);
    await writeFile(f.candidatePath, 'select 9002 as synthetic_overlay;\n');
    await assert.rejects(verifyPreparedOverlay({ ...f, snapshot: prepared.snapshot }), /candidate source drift detected/);
  }));

  await record('temporary overlay removed after a thrown error', async () => {
    let tempPath;
    await assert.rejects(withPrivateTempDirectory(async (root) => {
      tempPath = root;
      throw new Error('controlled synthetic failure');
    }), /controlled synthetic failure/);
    await assert.rejects(import('node:fs/promises').then(({ lstat }) => lstat(tempPath)), { code: 'ENOENT' });
  });

  const failed = results.filter((row) => row.status !== 'PASS');
  const report = {
    schemaVersion: 1,
    suite: 'PR352_R6_LEDGER_OVERLAY',
    fixtureKind: 'synthetic-only',
    expectedLedgerRows: ROWS,
    canonicalSerialization: 'UTF-8 JSON array of version-sorted [version,name,byteLength,sha256] tuples without whitespace',
    cases: results,
    caseCount: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    sqlContentsEmitted: false,
    productionConnections: 0,
    cleanupFailures: results.filter((row) => row.name.includes('temporary overlay') && row.status !== 'PASS').length,
    status: failed.length === 0 ? 'PASS' : 'FAIL',
  };
  await writeEvidence(report);
  process.stdout.write('PR352_R6_LEDGER_OVERLAY_REPORT ' + JSON.stringify(report) + '\n');
  if (failed.length) process.exitCode = 1;
}

run().catch(async (error) => {
  const report = {
    schemaVersion: 1,
    suite: 'PR352_R6_LEDGER_OVERLAY',
    fixtureKind: 'synthetic-only',
    expectedLedgerRows: ROWS,
    status: 'FAIL',
    error: String(error.message || error),
    sqlContentsEmitted: false,
    productionConnections: 0,
  };
  await writeEvidence(report);
  process.stderr.write('PR352_R6_LEDGER_OVERLAY_FATAL ' + JSON.stringify(report) + '\n');
  process.exitCode = 1;
});
