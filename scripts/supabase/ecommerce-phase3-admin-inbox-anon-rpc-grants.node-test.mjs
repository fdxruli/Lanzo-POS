import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const migrationUrl = new URL(
  '../../supabase/migrations/20260910212349_ecommerce_phase3_admin_inbox_anon_rpc_grants_r1.sql',
  import.meta.url
);
const [migration, mainClient, orderService] = await Promise.all([
  readFile(migrationUrl, 'utf8'),
  readFile(new URL('../../src/services/supabase.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/services/ecommerce/ecommerceOrderServiceBase.js', import.meta.url), 'utf8')
]);

test('grants anon only to the required administrative inbox signatures', () => {
  assert.match(migration, /grant execute on function public\.ecommerce_admin_list_orders\(text, text, text, text, text, integer, integer\) to anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.ecommerce_admin_accept_order\(text, text, text, uuid, text\) to anon, authenticated/i);
  assert.doesNotMatch(migration, /all functions in schema/i);
  assert.doesNotMatch(migration, /grant .* on schema/i);
});

test('fails closed unless both public RPCs remain SECURITY DEFINER with an empty search path', () => {
  assert.match(migration, /p\.prosecdef is true/i);
  assert.match(migration, /SET search_path TO ''/i);
  assert.match(migration, /ECOMMERCE_ADMIN_INBOX_RPC_SECURITY_CONTRACT_MISSING/i);
});

test('keeps Lanzo authorization in RPC parameters instead of a Supabase Auth session', () => {
  assert.match(mainClient, /persistSession:\s*false/i);
  assert.match(mainClient, /autoRefreshToken:\s*false/i);
  assert.match(orderService, /buildPosSyncAuthContext/i);
  assert.match(orderService, /ecommerce_admin_list_orders/i);
  assert.match(orderService, /ecommerce_admin_accept_order/i);
});
