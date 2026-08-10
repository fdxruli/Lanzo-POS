import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationsDir = join(repoRoot, 'supabase', 'migrations');
const archiveDir = join(repoRoot, 'supabase', 'archive', 'unresolved-migrations');
const historicalFile = '20260801043000_ecom_catalog_legacy_timestamp_revision_repair.sql';
const historicalSha256 = 'a95243579b801d83efcabda4770ebabd0b155553cc16c853dda016f22f5c7023';

function sha256(path) {
  const canonicalBytes = Buffer.from(readFileSync(path, 'utf8').replace(/\r\n/gu, '\n'), 'utf8');
  return createHash('sha256').update(canonicalBytes).digest('hex');
}

test('archives the unresolved migration exactly once outside the executable ledger', () => {
  assert.equal(readdirSync(migrationsDir).includes(historicalFile), false);
  assert.equal(readdirSync(archiveDir).filter((name) => name === historicalFile).length, 1);
  assert.equal(sha256(join(archiveDir, historicalFile)), historicalSha256);
});

test('forward baseline preserves only the production schema contract', () => {
  const baselineFiles = readdirSync(migrationsDir).filter((name) =>
    /^\d{14}_ecom_catalog_revision_forward_baseline\.sql$/u.test(name)
  );
  assert.equal(baselineFiles.length, 1);

  const sql = readFileSync(join(migrationsDir, baselineFiles[0]), 'utf8');
  assert.match(sql, /create or replace function private\.ecommerce_source_revision_decision/u);
  assert.match(sql, /immutable\s+security definer\s+set search_path = ''/u);
  assert.match(sql, /owner to postgres/u);
  assert.match(sql, /to postgres, service_role/u);
  assert.match(sql, /no historical data backfill/u);
  assert.doesNotMatch(sql, /\b(?:insert|update|delete|merge)\b/iu);
  assert.doesNotMatch(sql, /ecommerce_published_products|3297bdee|a8afb4db|image_url/iu);
});
