import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { splitAndTrim, transactionBody } from './supabase-migration-parser.mjs';

test('Supabase CLI v2.79.0 statement splitting respects comments, quotes, dollar tags and nested comments', () => {
  const sql = `-- comment ;\nselect ';' as quoted; /* outer ; /* nested ; */ done */\nselect $tag$; not a separator$tag$;\nselect 4; -- trailing ;\nselect 5`;
  assert.deepEqual(splitAndTrim(sql), [
    "-- comment ;\nselect ';' as quoted",
    '/* outer ; /* nested ; */ done */\nselect $tag$; not a separator$tag$',
    'select 4',
    '-- trailing ;\nselect 5'
  ]);
});

test('canonical F and PAY-N01 parse to the exact expected ledger statement groups', () => {
  const fPath = 'supabase/migrations/20261022135915_fin01_historical_credit_owner_authorization.sql';
  const payPath = 'supabase/migrations/20261029235906_fin01_pay_n01_atomic_rejection_v1.sql';
  const fStatements = splitAndTrim(fs.readFileSync(fPath, 'utf8'));
  const payStatements = splitAndTrim(fs.readFileSync(payPath, 'utf8'));
  assert.equal(fStatements.length, 20);
  assert.equal(transactionBody(fStatements, fPath).strippedOuterTransaction, true);
  assert.equal(transactionBody(fStatements, fPath).statements.length, 18);
  assert.equal(payStatements.length, 8);
  assert.equal(transactionBody(payStatements, payPath).strippedOuterTransaction, false);
  for (const [file, expected] of [[fPath, '855a25f313741d4181be90dede4925cbfdce59fce23a1ff34a5fff463eff5e9e'], [payPath, 'a53cc7865092737752949bfe5db455521290206c70907040e3b920223380b244']]) {
    assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'), expected);
  }
});

test('transaction wrapper removal refuses partial or embedded control statements', () => {
  assert.throws(() => transactionBody(['begin', 'select 1'], 'bad.sql'), /MIGRATION_TRANSACTION_WRAPPER_INCOMPLETE/);
  assert.throws(() => transactionBody(['select 1', 'commit'], 'bad.sql'), /MIGRATION_TRANSACTION_WRAPPER_INCOMPLETE/);
  assert.throws(() => transactionBody(['select 1', 'rollback'], 'bad.sql'), /MIGRATION_TRANSACTION_CONTROL_UNEXPECTED/);
});

test('synthetic ledger contains only version IDs and preserves the verified 333-row shape', () => {
  const source = JSON.parse(fs.readFileSync('docs/reports/fin01-r22/release-review/fixtures/production-ledger-versions.json', 'utf8'));
  assert.equal(source.remote_count, 333);
  assert.equal(source.versions.length, 333);
  assert.equal(new Set(source.versions).size, 333);
  assert.equal(source.remote_max, '20261026214837');
  assert.ok(source.versions.includes('20261006224032'));
  assert.ok(source.versions.includes('20261008030859'));
  assert.ok(!source.versions.includes('20261008180000'));
  assert.ok(!source.versions.includes('20261022135915'));
  assert.ok(!source.versions.includes('20261029235906'));
});
