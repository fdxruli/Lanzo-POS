import fs from 'node:fs';
import path from 'node:path';

const VERSION_RE = /^(\d{14})_[A-Za-z0-9][A-Za-z0-9_-]*\.sql$/;
const GIT_SHA_RE = /^[0-9a-f]{40}$/;

const fail = (message) => {
  throw new Error(`CANONICAL_MIGRATION_GUARD: ${message}`);
};

export const parseExpectedVersions = (value) => {
  if (String(value || '').trim() === 'NONE') return [];
  const versions = String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (!versions.length) fail('expected migration version set is required');
  if (new Set(versions).size !== versions.length) fail('expected migration version set contains duplicates');
  for (const version of versions) {
    if (!/^\d{14}$/.test(version)) fail(`invalid expected version: ${version}`);
  }
  return versions.sort();
};

export const assertCurrentMainSha = ({ expectedGitSha, checkedOutSha, currentRemoteMainSha }) => {
  for (const [label, sha] of Object.entries({ expectedGitSha, checkedOutSha, currentRemoteMainSha })) {
    if (!GIT_SHA_RE.test(String(sha || ''))) fail(`${label} is not a full lowercase Git SHA`);
  }
  if (checkedOutSha !== expectedGitSha || currentRemoteMainSha !== expectedGitSha) {
    fail(`expected_git_sha is not current main HEAD: expected=${expectedGitSha} checked_out=${checkedOutSha} current_remote_main=${currentRemoteMainSha}`);
  }
  return expectedGitSha;
};

export const localMigrationVersions = (directory) => {
  const names = fs.readdirSync(directory).filter((name) => name.endsWith('.sql')).sort();
  const versions = names.map((name) => {
    const match = name.match(VERSION_RE);
    if (!match) fail(`invalid migration filename: ${name}`);
    return match[1];
  });
  if (new Set(versions).size !== versions.length) fail('duplicate canonical migration version in Git');
  return versions;
};

// `supabase migration list --linked` is a three-column table: Local | Remote | Time.
// This parser intentionally accepts only rows whose first two fields are either blank
// or a 14-digit version; unexpected output fails closed rather than being guessed.
export const remoteVersionsFromList = (output) => {
  const remote = [];
  for (const rawLine of String(output).split(/\r?\n/)) {
    if (!rawLine.includes('|')) continue;
    const columns = rawLine.split('|').map((value) => value.trim());
    if (columns.length < 2) fail('unparseable migration list row');
    const [local, remoteVersion] = columns;
    const isVersionOrEmpty = (value) => value === '' || /^\d{14}$/.test(value);
    const isTableSeparator = (value) => /^-+$/.test(value);
    if (!isVersionOrEmpty(local) || !isVersionOrEmpty(remoteVersion)) {
      if (/^local$/i.test(local) && /^remote$/i.test(remoteVersion)) continue;
      if (isTableSeparator(local) && isTableSeparator(remoteVersion)) continue;
      fail(`unparseable migration list row: ${rawLine}`);
    }
    if (remoteVersion) remote.push(remoteVersion);
  }
  if (!remote.length) fail('migration list contains no parseable remote versions');
  if (new Set(remote).size !== remote.length) fail('duplicate remote migration version');
  return remote.sort();
};

export const assertCanonicalLedger = ({ local, remote, expected, afterApply = false }) => {
  const localSet = new Set(local);
  const remoteSet = new Set(remote);
  const expectedSet = new Set(expected);
  const remoteOnly = remote.filter((version) => !localSet.has(version));
  const pending = local.filter((version) => !remoteSet.has(version));
  const expectedAlreadyApplied = expected.filter((version) => remoteSet.has(version));
  const unexpectedPending = pending.filter((version) => !expectedSet.has(version));
  const missingExpected = expected.filter((version) => !pending.includes(version) && !remoteSet.has(version));
  if (remoteOnly.length) fail(`unexpected remote-only versions: ${remoteOnly.join(',')}`);
  if (afterApply) {
    if (!expected.length) fail('NONE is invalid after apply');
    if (expectedAlreadyApplied.length !== expected.length) fail(`applied version missing from remote ledger: ${expected.filter((version) => !remoteSet.has(version)).join(',')}`);
    if (pending.length) fail(`migration remains pending after apply: ${pending.join(',')}`);
  } else {
    if (expectedAlreadyApplied.length) fail(`expected version already applied: ${expectedAlreadyApplied.join(',')}`);
    if (unexpectedPending.length) fail(`unexpected pending versions: ${unexpectedPending.join(',')}`);
    if (missingExpected.length) fail(`missing expected versions: ${missingExpected.join(',')}`);
    if (pending.length !== expected.length || pending.some((version, index) => version !== expected[index])) {
      fail(`pending set differs from expected set: pending=${pending.join(',')} expected=${expected.join(',')}`);
    }
  }
  return { pending, remoteOnly };
};

export const verify = ({ migrationsDirectory, expectedVersions, migrationListPath, afterApply = false }) => {
  const expected = parseExpectedVersions(expectedVersions);
  const local = localMigrationVersions(migrationsDirectory);
  const remote = remoteVersionsFromList(fs.readFileSync(migrationListPath, 'utf8'));
  return assertCanonicalLedger({ local, remote, expected, afterApply });
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const [migrationsDirectory, expectedVersions, migrationListPath, mode] = process.argv.slice(2);
  if (!migrationsDirectory || !expectedVersions || !migrationListPath) {
    fail('usage: verify-canonical-migration-ledger.mjs <migrations-dir> <expected-versions> <migration-list-output>');
  }
  if (mode && mode !== 'after-apply') fail(`unknown mode: ${mode}`);
  const result = verify({ migrationsDirectory: path.resolve(migrationsDirectory), expectedVersions, migrationListPath, afterApply: mode === 'after-apply' });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
