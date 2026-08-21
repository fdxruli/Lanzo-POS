import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertCanonicalLedger, assertCurrentMainSha, remoteVersionsFromList, verify } from './verify-canonical-migration-ledger.mjs';

const fixture = (files, listing) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lanzo-ledger-'));
  const migrations = path.join(root, 'migrations');
  fs.mkdirSync(migrations);
  for (const file of files) fs.writeFileSync(path.join(migrations, file), '-- test\n');
  const list = path.join(root, 'list.txt');
  fs.writeFileSync(list, listing);
  return { root, migrations, list };
};

test('accepts the current CLI header and separator with one canonical pending version', () => {
  const x = fixture(['20260819085828_old.sql', '20260820165842_new.sql'], [
    'Local          | Remote         | Time (UTC)',
    '---------------|----------------|---------------------',
    '20260819085828 | 20260819085828 | 2026-08-20 12:00:00',
    '20260820165842 |                |',
  ].join('\n'));
  assert.deepEqual(verify({ migrationsDirectory: x.migrations, expectedVersions: '20260820165842', migrationListPath: x.list }), { pending: ['20260820165842'], remoteOnly: [] });
  fs.rmSync(x.root, { recursive: true, force: true });
});

test('rejects noncanonical filenames and remote drift', () => {
  const x = fixture(['bad_name.sql'], 'Local | Remote | Time (UTC)\n | 20260819084636 | 2026-08-19\n');
  assert.throws(() => verify({ migrationsDirectory: x.migrations, expectedVersions: '20260820123456', migrationListPath: x.list }), /invalid migration filename/);
  fs.rmSync(x.root, { recursive: true, force: true });
});

test('rejects remote-only migrations through assertCanonicalLedger', () => {
  assert.throws(
    () => assertCanonicalLedger({ local: ['20260819085828'], remote: ['20260819085828', '20260819090000'], expected: [] }),
    /unexpected remote-only versions: 20260819090000/,
  );
});

test('rejects arbitrary pipe rows and duplicate remote migrations', () => {
  assert.throws(
    () => remoteVersionsFromList('Local | Remote | Time (UTC)\ngarbage | nonsense | unexpected\n'),
    /unparseable migration list row: garbage \| nonsense \| unexpected/,
  );
  assert.throws(
    () => remoteVersionsFromList('Local | Remote | Time (UTC)\n20260819085828 | 20260819085828 | now\n20260819085828 | 20260819085828 | later\n'),
    /duplicate remote migration version/,
  );
});

test('accepts a fully applied expected set only after apply', () => {
  const x = fixture(['20260819084636_old.sql', '20260820123456_new.sql'], 'Local | Remote | Time (UTC)\n20260819084636 | 20260819084636 | 2026-08-19\n20260820123456 | 20260820123456 | 2026-08-20\n');
  assert.deepEqual(verify({ migrationsDirectory: x.migrations, expectedVersions: '20260820123456', migrationListPath: x.list, afterApply: true }), { pending: [], remoteOnly: [] });
  fs.rmSync(x.root, { recursive: true, force: true });
});

test('accepts NONE only with zero pending migrations', () => {
  const x = fixture(['20260819084636_old.sql'], 'Local | Remote | Time (UTC)\n20260819084636 | 20260819084636 | 2026-08-19\n');
  assert.deepEqual(verify({ migrationsDirectory: x.migrations, expectedVersions: 'NONE', migrationListPath: x.list }), { pending: [], remoteOnly: [] });
  fs.rmSync(x.root, { recursive: true, force: true });
});

test('rejects NONE with a pending migration and after apply', () => {
  const x = fixture(['20260819084636_old.sql', '20260820123456_new.sql'], 'Local | Remote | Time (UTC)\n20260819084636 | 20260819084636 | 2026-08-19\n20260820123456 | |\n');
  assert.throws(() => verify({ migrationsDirectory: x.migrations, expectedVersions: 'NONE', migrationListPath: x.list }), /unexpected pending versions/);
  assert.throws(() => verify({ migrationsDirectory: x.migrations, expectedVersions: 'NONE', migrationListPath: x.list, afterApply: true }), /NONE is invalid after apply/);
  fs.rmSync(x.root, { recursive: true, force: true });
});

test('accepts equal expected, checkout and remote main SHAs', () => {
  const sha = 'a'.repeat(40);
  assert.equal(assertCurrentMainSha({ expectedGitSha: sha, checkedOutSha: sha, currentRemoteMainSha: sha }), sha);
});

test('rejects a stale expected SHA and malformed expected SHA', () => {
  assert.throws(() => assertCurrentMainSha({ expectedGitSha: 'a'.repeat(40), checkedOutSha: 'a'.repeat(40), currentRemoteMainSha: 'b'.repeat(40) }), /not current main HEAD/);
  assert.throws(() => assertCurrentMainSha({ expectedGitSha: 'not-a-sha', checkedOutSha: 'a'.repeat(40), currentRemoteMainSha: 'a'.repeat(40) }), /not a full lowercase Git SHA/);
});
