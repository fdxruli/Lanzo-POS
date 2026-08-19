import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verify } from './verify-canonical-migration-ledger.mjs';

const fixture = (files, listing) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lanzo-ledger-'));
  const migrations = path.join(root, 'migrations');
  fs.mkdirSync(migrations);
  for (const file of files) fs.writeFileSync(path.join(migrations, file), '-- test\n');
  const list = path.join(root, 'list.txt');
  fs.writeFileSync(list, listing);
  return { root, migrations, list };
};

test('accepts exactly one canonical pending version', () => {
  const x = fixture(['20260819084636_old.sql', '20260820123456_new.sql'], 'Local | Remote | Time (UTC)\n20260819084636 | 20260819084636 | 2026-08-19\n20260820123456 | |\n');
  assert.deepEqual(verify({ migrationsDirectory: x.migrations, expectedVersions: '20260820123456', migrationListPath: x.list }), { pending: ['20260820123456'], remoteOnly: [] });
  fs.rmSync(x.root, { recursive: true, force: true });
});

test('rejects noncanonical filenames and remote drift', () => {
  const x = fixture(['bad_name.sql'], 'Local | Remote | Time (UTC)\n | 20260819084636 | 2026-08-19\n');
  assert.throws(() => verify({ migrationsDirectory: x.migrations, expectedVersions: '20260820123456', migrationListPath: x.list }), /invalid migration filename/);
  fs.rmSync(x.root, { recursive: true, force: true });
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
