import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, realpath, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const FETCHED_NAME_RE = /^(\d{14})_([A-Za-z0-9][A-Za-z0-9_-]*)\.sql$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const SYNTHETIC_SQL_RE = /^select \d+ as synthetic_(step|overlay);\n$/;

function fail(message) {
  throw new Error('PR352_R6_SYNTHETIC_OVERLAY: ' + message);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// Canonical representation: UTF-8 JSON of a version-sorted array of
// [version, name, byteLength, sha256] tuples, with no insignificant whitespace.
export function canonicalLedgerRepresentation(entries) {
  return JSON.stringify(entries.map((entry) => [
    entry.version,
    entry.name,
    entry.fetch_sql_bytes,
    entry.fetch_sql_sha256,
  ]));
}

export function fingerprintLedger(entries) {
  return sha256(Buffer.from(canonicalLedgerRepresentation(entries), 'utf8'));
}

async function loadAndValidateManifest(manifestPath, expectedRows) {
  const manifestBytes = await readFile(manifestPath);
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8').replace(/^\uFEFF/, ''));
  } catch {
    fail('manifest is not valid JSON');
  }

  if (manifest.schemaVersion !== 1 || manifest.purpose !== 'synthetic-only'
    || manifest.rawSqlIncluded !== false || manifest.sensitiveValuesIncluded !== false
    || manifest.syntheticStatementsOnly !== true) {
    fail('manifest must be marked synthetic-only and data-minimized');
  }
  if (!Number.isSafeInteger(expectedRows) || expectedRows < 1
    || manifest.observedLedgerRows !== expectedRows
    || !Array.isArray(manifest.entries) || manifest.entries.length !== expectedRows) {
    fail('manifest cardinality does not match the required synthetic ledger size');
  }
  if (!SHA256_RE.test(manifest.canonicalFingerprint || '')
    || fingerprintLedger(manifest.entries) !== manifest.canonicalFingerprint) {
    fail('canonical ledger fingerprint mismatch');
  }

  const seenVersions = new Set();
  const seenNames = new Set();
  let previousVersion = '';
  for (const entry of manifest.entries) {
    if (!/^\d{14}$/.test(entry.version)
      || !/^synthetic_[A-Za-z0-9][A-Za-z0-9_-]*$/.test(entry.name)
      || !Number.isSafeInteger(entry.fetch_sql_bytes) || entry.fetch_sql_bytes < 1
      || !SHA256_RE.test(entry.fetch_sql_sha256)) {
      fail('invalid synthetic migration identity or fingerprint');
    }
    if (seenVersions.has(entry.version) || seenNames.has(entry.name)) {
      fail('duplicate synthetic migration version or name');
    }
    if (previousVersion && entry.version <= previousVersion) {
      fail('manifest entries are not in strict canonical version order');
    }
    seenVersions.add(entry.version);
    seenNames.add(entry.name);
    previousVersion = entry.version;
  }

  const latestVersion = manifest.entries.at(-1).version;
  if (manifest.latestVersion !== latestVersion) fail('declared latest version differs from canonical entries');
  return {
    manifest,
    manifestBytes,
    manifestHash: sha256(manifestBytes),
    latestVersion,
    expectedFiles: manifest.entries.map((entry) => entry.version + '_' + entry.name + '.sql'),
  };
}

async function assertPrivateDirectory(directoryPath) {
  const info = await lstat(directoryPath);
  if (!info.isDirectory() || info.isSymbolicLink()) fail('temporary root must be a real directory');
  if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) {
    fail('temporary root permissions are broader than 0700');
  }
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) {
    fail('temporary root owner differs from the runner user');
  }
}

export async function createPrivateTempDirectory(prefix = 'pr352-r6-overlay-') {
  const directoryPath = await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), prefix)));
  try {
    await assertPrivateDirectory(directoryPath);
    return directoryPath;
  } catch (error) {
    await rm(directoryPath, { recursive: true, force: true });
    throw error;
  }
}

export async function withPrivateTempDirectory(callback) {
  const directoryPath = await createPrivateTempDirectory();
  let callbackError = null;
  let result;
  try {
    result = await callback(directoryPath);
  } catch (error) {
    callbackError = error;
  }

  let cleanupError = null;
  try {
    await rm(directoryPath, { recursive: true, force: false });
    try {
      await lstat(directoryPath);
      cleanupError = new Error('temporary root still exists after removal');
    } catch (error) {
      if (error.code !== 'ENOENT') cleanupError = error;
    }
  } catch (error) {
    cleanupError = error;
  }

  if (cleanupError) {
    if (callbackError) throw new AggregateError([callbackError, cleanupError], 'callback failed and temporary cleanup also failed');
    throw cleanupError;
  }
  if (callbackError) throw callbackError;
  return result;
}

async function listSqlFiles(directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const names = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.sql')) {
      fail('migration directory contains a non-regular or non-SQL entry');
    }
    if (!FETCHED_NAME_RE.test(entry.name)) fail('migration filename is not canonical: ' + entry.name);
    names.push(entry.name);
  }
  return names.sort();
}

async function verifyFileSet(directoryPath, expectedFiles) {
  const actualFiles = await listSqlFiles(directoryPath);
  if (actualFiles.length !== expectedFiles.length
    || actualFiles.some((name, index) => name !== expectedFiles[index])) {
    const expected = new Set(expectedFiles);
    fail('migration file set differs; missing='
      + expectedFiles.filter((name) => !actualFiles.includes(name)).length
      + ', extra=' + actualFiles.filter((name) => !expected.has(name)).length);
  }
  return actualFiles;
}

async function verifyFetchedBodies(directoryPath, manifest) {
  for (const entry of manifest.entries) {
    const filename = entry.version + '_' + entry.name + '.sql';
    const contents = await readFile(path.join(directoryPath, filename));
    if (contents.length !== entry.fetch_sql_bytes || sha256(contents) !== entry.fetch_sql_sha256) {
      fail('fetched SQL fingerprint mismatch: ' + filename);
    }
    if (!SYNTHETIC_SQL_RE.test(contents.toString('utf8'))) {
      fail('fixture statement is not the allowed harmless synthetic SELECT: ' + filename);
    }
  }
}

async function validateCandidateSet(candidateDirectory, candidatePath, candidateName) {
  const candidates = await listSqlFiles(candidateDirectory);
  if (candidates.length !== 1 || candidates[0] !== candidateName) {
    fail('exactly one approved candidate migration must be present');
  }
  const candidateStat = await lstat(candidatePath);
  if (!candidateStat.isFile() || candidateStat.isSymbolicLink()) fail('candidate must be a regular checked-out file');
  const candidateContents = await readFile(candidatePath);
  if (!SYNTHETIC_SQL_RE.test(candidateContents.toString('utf8'))) {
    fail('candidate must use the harmless synthetic SELECT body');
  }
  const match = candidateName.match(FETCHED_NAME_RE);
  if (!match) fail('candidate filename is not canonical');
  return { candidateBytes: candidateContents, candidateHash: sha256(candidateContents), candidateVersion: match[1] };
}

export async function prepareSyntheticOverlay({
  manifestPath,
  fetchedDirectory,
  candidateDirectory,
  candidatePath,
  expectedRows = 333,
}) {
  const manifestState = await loadAndValidateManifest(manifestPath, expectedRows);
  const fetchedRoot = await realpath(fetchedDirectory);
  const candidateRoot = await realpath(candidateDirectory);
  const candidateRealPath = await realpath(candidatePath);
  const candidateName = path.basename(candidatePath);
  if (candidateRealPath === candidateRoot || path.dirname(candidateRealPath) !== candidateRoot) {
    fail('candidate must be a direct child of its approved candidate directory');
  }
  const relative = path.relative(fetchedRoot, candidateRealPath);
  if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    fail('candidate must remain outside the fetched synthetic history');
  }

  const candidate = await validateCandidateSet(candidateDirectory, candidatePath, candidateName);
  if (candidate.candidateVersion <= manifestState.latestVersion) {
    fail('candidate version must be newer than the synthetic ledger head');
  }
  const fetchedFiles = await verifyFileSet(fetchedDirectory, manifestState.expectedFiles);
  await verifyFetchedBodies(fetchedDirectory, manifestState.manifest);

  await copyFile(candidatePath, path.join(fetchedDirectory, candidateName), fsConstants.COPYFILE_EXCL);
  const localFilesAfterOverlay = await verifyFileSet(
    fetchedDirectory,
    [...manifestState.expectedFiles, candidateName].sort(),
  );
  const copied = await readFile(path.join(fetchedDirectory, candidateName));
  if (sha256(copied) !== candidate.candidateHash || !copied.equals(candidate.candidateBytes)) {
    fail('copied candidate differs from the reviewed source bytes');
  }

  return {
    evidence: {
      status: 'PASS',
      fixtureKind: 'synthetic-only',
      ledgerRows: fetchedFiles.length,
      latestVersion: manifestState.latestVersion,
      canonicalFingerprint: manifestState.manifest.canonicalFingerprint,
      candidateName,
      candidateSha256: candidate.candidateHash,
      pendingCount: localFilesAfterOverlay.length - fetchedFiles.length,
      localMigrationFilesAfterOverlay: localFilesAfterOverlay.length,
      sqlContentsEmitted: false,
    },
    snapshot: {
      manifestHash: manifestState.manifestHash,
      canonicalFingerprint: manifestState.manifest.canonicalFingerprint,
      expectedRows,
      expectedFiles: manifestState.expectedFiles,
      candidateName,
      candidateHash: candidate.candidateHash,
      candidatePath: candidateRealPath,
      candidateDirectory: candidateRoot,
      fetchedDirectory: fetchedRoot,
    },
  };
}

export async function verifyPreparedOverlay({ manifestPath, fetchedDirectory, candidateDirectory, candidatePath, snapshot }) {
  assert.ok(snapshot && snapshot.candidateName, 'prepared overlay snapshot is required');
  const manifestState = await loadAndValidateManifest(manifestPath, snapshot.expectedRows);
  if (manifestState.manifestHash !== snapshot.manifestHash
    || manifestState.manifest.canonicalFingerprint !== snapshot.canonicalFingerprint) {
    fail('manifest drift detected after validation');
  }
  const candidate = await validateCandidateSet(candidateDirectory, candidatePath, snapshot.candidateName);
  if (candidate.candidateHash !== snapshot.candidateHash
    || await realpath(candidatePath) !== snapshot.candidatePath) {
    fail('candidate source drift detected after validation');
  }
  const expectedFiles = [...snapshot.expectedFiles, snapshot.candidateName].sort();
  await verifyFileSet(fetchedDirectory, expectedFiles);
  await verifyFetchedBodies(fetchedDirectory, manifestState.manifest);
  const copiedCandidate = await readFile(path.join(fetchedDirectory, snapshot.candidateName));
  if (sha256(copiedCandidate) !== snapshot.candidateHash) {
    fail('overlaid candidate drift detected before application');
  }
  return {
    status: 'PASS',
    checkedFiles: expectedFiles.length,
    pendingCount: 1,
    sqlContentsEmitted: false,
  };
}