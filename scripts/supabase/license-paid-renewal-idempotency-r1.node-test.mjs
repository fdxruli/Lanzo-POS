import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const migrationDirectory = join(process.cwd(), 'supabase', 'migrations');
const migrationName = readdirSync(migrationDirectory)
  .find((name) => name.endsWith('_license_paid_renewal_idempotency_r1.sql'));

assert.ok(migrationName, 'paid renewal migration must exist');
const migration = readFileSync(join(migrationDirectory, migrationName), 'utf8');
const sqlTest = readFileSync(
  join(process.cwd(), 'supabase', 'tests', 'license_upgrade_restoration_hardening_r1_test.sql'),
  'utf8'
);

const functionBody = (signature) => {
  const start = migration.indexOf(`create or replace function ${signature}`);
  assert.ok(start >= 0, `${signature} must exist`);
  const end = migration.indexOf('$function$;', start);
  assert.ok(end > start, `${signature} must have a body`);
  return migration.slice(start, end);
};

test('explicit paid renewal locks, keys retries, and creates one paid successor', () => {
  const body = functionBody('private.renew_active_paid_license_v1');
  const lock = body.indexOf('for update of l');
  const duplicateCheck = body.indexOf("'explicit_paid_renewal'", lock);

  assert.ok(lock >= 0, 'renewal must lock its license row');
  assert.ok(duplicateCheck > lock, 'idempotency must be checked after the row lock');
  assert.match(body, /IDEMPOTENCY_KEY_REQUIRED/u);
  assert.match(body, /code', 'ALREADY_RENEWED'/u);
  assert.match(body, /update public\.license_periods[\s\S]*status = 'closed'/u);
  assert.match(body, /insert into public\.license_periods/u);
  assert.match(body, /'PLAN_CHANGED'/u);
  assert.match(migration, /public\.admin_renew_active_paid_license_v1/u);
});

test('roundtrip SQL verifies an active renewal and its retry without a Free period', () => {
  for (const phrase of [
    'LICENSE_RENEWED',
    'ALREADY_RENEWED',
    'r4-active-renewal-key',
    'active paid renewal',
    'renew_active_paid_license_v1'
  ]) {
    assert.match(sqlTest, new RegExp(phrase, 'u'));
  }
});
