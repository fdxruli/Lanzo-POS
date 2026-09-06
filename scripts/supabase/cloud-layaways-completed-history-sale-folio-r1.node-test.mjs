import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260906000110_cloud_layaways_completed_history_sale_folio_r1.sql'),
  'utf8'
);
const modal = fs.readFileSync(
  path.join(root, 'src/components/customers/LayawayModal.jsx'),
  'utf8'
);
const dashboard = fs.readFileSync(
  path.join(root, 'src/pages/DashboardPage.jsx'),
  'utf8'
);

test('completed-history folio migration preserves server authorization and tenant isolation', () => {
  assert.match(migration, /^begin;\s*$/imu);
  assert.match(migration, /^commit;\s*$/imu);
  assert.match(migration, /create\s+or\s+replace\s+function\s+public\.pos_get_sales_final_history\s*\(/iu);
  assert.match(migration, /security\s+definer/iu);
  assert.match(migration, /set\s+search_path\s*=\s*''/iu);
  assert.match(migration, /public\.pos_get_sales_final_history_unlimited\s*\(/u);
  assert.match(migration, /private\.validate_pos_sync_context\s*\(/u);
  assert.match(migration, /s\.license_id\s*=\s*v_license_id/u);
  assert.match(migration, /s\.id\s*=\s*history_row\.row_data->>'id'/u);
  assert.match(migration, /jsonb_build_object\('pos_folio',\s*s\.pos_folio\)/u);
  assert.doesNotMatch(migration, /\bto_jsonb\s*\(|\brow_to_json\s*\(/iu);
  assert.doesNotMatch(migration, /\b(drop|truncate|insert|update|delete)\b/iu);
  assert.doesNotMatch(migration, /request_hash|idempotency|device_fingerprint\s*:\s*s\.|security_token\s*:\s*s\./iu);
  assert.doesNotMatch(migration, /VITE_ENABLE_CLOUD_LAYAWAYS|--include-all|migration\s+repair|db\s+(push|pull)/iu);
});

test('frontend scopes only final history and keeps terminal cards without financial handlers', () => {
  assert.match(dashboard, /scope:\s*salesFinalHistoryScope/u);
  assert.match(dashboard, /getSalesFinalHistoryScope\(actorRuntime\)/u);
  assert.match(modal, /getByCustomer\(customer\.id, false\)/u);
  assert.match(modal, /scope:\s*salesHistoryScope/u);
  assert.match(modal, /isTerminalLayaway\(layaway\)/u);
  assert.match(modal, /!isHistorical\s*&&\s*\(/u);
  assert.match(modal, /Folio:\s*\{completionFolio\s*\|\|\s*'No disponible'\}/u);
  assert.doesNotMatch(modal, /request_hash|idempotency_key|security_token|fingerprint|metadata/u);
});
