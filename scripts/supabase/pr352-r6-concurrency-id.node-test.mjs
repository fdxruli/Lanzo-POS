import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { countOpenSessions, statusUpdateSql } from './pr352-r6-concurrency.mjs';

test('Set session cleanup counts only children that have not closed', () => {
  const open = { closed: false };
  const sessions = new Set([{ closed: true }, open]);
  assert.equal(countOpenSessions(sessions), 1);
  open.closed = true;
  assert.equal(countOpenSessions(sessions), 0);
});

test('status writer submits the internal id and fails when the RPC rejects it', () => {
  const sql = statusUpdateSql("rest_order_o'brien", 'preparing', 'test-key');
  assert.match(sql, /pos_update_restaurant_order_status_unlimited\([^;]*'rest_order_o''brien','preparing','test-key'\)/);
  assert.match(sql, /receipt->>'success'/);
  assert.match(sql, /receipt->'order'->>'id' is distinct from 'rest_order_o''brien'/);
  assert.match(sql, /raise exception 'R6_STATUS_UPDATE_FAILED: %',receipt/);
  assert.match(sql, /raise notice 'R6_STATUS_UPDATE_ACCEPTED:%',receipt/);
});

test('seed receipt supplies internal ids to both concurrency writers and replay', async () => {
  const runner = await readFile(new URL('./pr352-r6-real-bridge-pg176-test.mjs', import.meta.url), 'utf8');
  const concurrency = await readFile(new URL('./pr352-r6-concurrency.mjs', import.meta.url), 'utf8');
  assert.match(runner, /assert\.notEqual\(result\.order\.id, localOrderId/);
  assert.match(runner, /return result\.order\.id/);
  assert.match(concurrency, /const commitOrderId = await createLegacyOrder\(commitOrder,/);
  assert.match(concurrency, /holder\.send\(statusUpdateSql\(commitOrderId,/);
  assert.match(concurrency, /const rollbackOrderId = await createLegacyOrder\(rollbackOrder,/);
  assert.match(concurrency, /rollbackHolder\.send\(statusUpdateSql\(rollbackOrderId,/);
  assert.equal((concurrency.match(/quote\(rollbackOrderId\) \+ ",'preparing','r6-inflight-rollback-replay'/g) || []).length, 2);
  assert.doesNotMatch(concurrency, /sessions\.filter\(/);
});
