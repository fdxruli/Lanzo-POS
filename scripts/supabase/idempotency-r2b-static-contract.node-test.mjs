import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrations = path.join(repoRoot, 'supabase', 'migrations');
const oldHelper = fs.readFileSync(path.join(migrations, '20260623204046_fase1_fix_idempotency_insert_rowcount.sql'), 'utf8');
const r2bHelper = fs.readFileSync(path.join(migrations, '20260824230045_admin_staff_rbac_r2b_sale_price_discount_server_authority.sql'), 'utf8');

function helperCalls(source) {
  const calls = [];
  const marker = 'private.insert_pos_idempotency_processing(';
  let offset = 0;
  while ((offset = source.indexOf(marker, offset)) >= 0) {
    let depth = 1;
    let cursor = offset + marker.length;
    let quoted = false;
    for (; cursor < source.length && depth; cursor += 1) {
      if (source[cursor] === "'" && source[cursor - 1] !== '\\') quoted = !quoted;
      if (!quoted && source[cursor] === '(') depth += 1;
      if (!quoted && source[cursor] === ')') depth -= 1;
    }
    calls.push(source.slice(offset + marker.length, cursor - 1));
    offset = cursor;
  }
  return calls;
}

function argumentCount(call) {
  let depth = 0;
  let quoted = false;
  let count = call.trim() ? 1 : 0;
  for (let index = 0; index < call.length; index += 1) {
    if (call[index] === "'" && call[index - 1] !== '\\') quoted = !quoted;
    if (quoted) continue;
    if (call[index] === '(') depth += 1;
    if (call[index] === ')') depth -= 1;
    if (call[index] === ',' && depth === 0) count += 1;
  }
  return count;
}

test('STATIC CONTRACT TEST: R2B preserves the optional request-hash signature', () => {
  assert.match(oldHelper, /p_request_hash\s+text\s+default\s+null/i);
  assert.match(r2bHelper, /p_request_hash\s+text\s+default\s+null/i);
  assert.match(r2bHelper, /p_request_hash is not null\s+and v_existing_hash is not null\s+and v_existing_hash is distinct from p_request_hash/i);
});

test('STATIC CONTRACT TEST: R2B only backfills a NULL hash while processing', () => {
  const backfill = r2bHelper.match(/if v_existing_hash is null[\s\S]*?end if;/i)?.[0] || '';
  assert.match(backfill, /v_existing_status = 'processing'/i);
  assert.match(backfill, /update public\.pos_idempotency_keys/i);
  assert.doesNotMatch(backfill, /v_existing_status = 'completed'/i);
});

test('STATIC CONTRACT TEST: existing five- and six-argument callers are syntactically compatible', () => {
  const calls = fs.readdirSync(migrations)
    .filter((file) => file.endsWith('.sql'))
    .flatMap((file) => helperCalls(fs.readFileSync(path.join(migrations, file), 'utf8')));
  assert.ok(calls.length >= 29, 'expected the repository to retain the idempotency caller inventory');
  assert.ok(calls.every((call) => [5, 6].includes(argumentCount(call))), 'callers must use the historic five args or the optional sixth hash argument');
});

test('STATIC CONTRACT TEST: sale hashes are generated after canonical R2B financial authorization', () => {
  const canonicalSaleIndex = r2bHelper.lastIndexOf('v_sale := (', r2bHelper.indexOf('v_request_hash := pg_catalog.md5'));
  const hashIndex = r2bHelper.indexOf('v_request_hash := pg_catalog.md5');
  assert.ok(canonicalSaleIndex >= 0 && hashIndex > canonicalSaleIndex, 'canonical financial normalization must precede R2B request hashing');
  assert.match(r2bHelper, /r2bClientUnitCostIgnored/i);
  assert.match(r2bHelper, /IDEMPOTENCY_CONFLICT/i);
});
