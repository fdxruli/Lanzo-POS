import fs from 'node:fs';
import path from 'node:path';

const read = (file) => fs.readFileSync(path.resolve(file), 'utf8');

const migration = read('supabase/migrations/20260824165839_sales_refunds_actor_authorization_r1.sql');
const sqlTest = read('supabase/tests/sales_refunds_actor_authorization_r1_test.sql');
const salesService = read('src/services/salesService.js');
const layawayService = read('src/services/layawayFinancialService.js');
const layawayRepository = read('src/services/db/layaways.js');
const cancellationCore = read('src/services/sales/cancelSaleCore.js');
const restoreCore = read('src/services/sales/restoreDeletedSaleCore.js');
const cloudService = read('src/services/salesCloud/salesCloudCancellationService.js');
const reportsRoute = read('src/components/common/SalesReportsRoute.jsx');

const requireFragments = (label, source, fragments) => {
  for (const fragment of fragments) {
    if (!source.includes(fragment)) {
      throw new Error(`${label} is missing required contract: ${fragment}`);
    }
  }
};

if (/^\s*(begin|commit)\s*;/im.test(migration)) {
  throw new Error('sales migration must remain composable inside a rollback-only validation transaction');
}

requireFragments('sales migration', migration, [
  'pos_preview_cloud_sale_cancellation_legacy_r1',
  'pos_cancel_cloud_sale_apply_fase6e_legacy_r1',
  'private.validate_pos_sync_context',
  "private.has_pos_permission(v_context, 'refunds')",
  "private.assert_pos_permission(v_context, 'refunds')",
  "private.assert_pos_permission(v_context, 'pos')",
  "private.has_pos_permission(v_context, 'sales_cancellations_global')",
  "set search_path = ''",
  'enforce_pos_rpc_rate_limit_v2',
  'from public, anon, authenticated, service_role',
  'to service_role',
  'to anon, authenticated, service_role',
  'R1_SALES_REFUNDS_ACL_INVALID',
  "notify pgrst, 'reload schema'"
]);

for (const legacyName of [
  'pos_preview_cloud_sale_cancellation_legacy_r1(text,text,text,text,text,text)',
  'pos_cancel_cloud_sale_apply_fase6e_legacy_r1(text,text,text,text,text,text,text)'
]) {
  const escaped = legacyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const revoke = new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${escaped}[\\s\\S]{0,120}from\\s+public,\\s*anon,\\s*authenticated,\\s*service_role`, 'i');
  if (!revoke.test(migration)) throw new Error(`legacy cancellation body is not fully revoked: ${legacyName}`);
}

requireFragments('sales service', salesService, [
  "label: 'sales.cancel'",
  "label: 'sales.restoreCancelled'",
  "label: 'sales.archiveCancelled'",
  "label: 'sales.permanentlyDeleteCancelled'",
  'runRefundsActorOperation',
  'assertActorCurrent: assertCurrent'
]);
requireFragments('layaway service', layawayService, [
  "label: 'layaway.cancelOrRefund'",
  'runRefundsActorOperation',
  'assertActorCurrent: assertCurrent'
]);
requireFragments('layaway repository', layawayRepository, [
  'requireRefundActorAssertion',
  "'layaway.beginRefund'",
  "'layaway.completeRefund'",
  "'layaway.cancel'"
]);
requireFragments('local cancellation core', cancellationCore, [
  "'ACTOR_SESSION_REQUIRED'",
  'typeof assertActorCurrent'
]);
requireFragments('local restore core', restoreCore, [
  "error.code = 'ACTOR_SESSION_REQUIRED'",
  'typeof assertActorCurrent'
]);
requireFragments('cloud cancellation service', cloudService, [
  "label: 'sales.cloudCancellationPreview'",
  "label: 'sales.cloudCancellationExecute'",
  'captureRefundsActorHandle'
]);
requireFragments('reports route', reportsRoute, [
  'canReadSalesReports(actorRuntime)',
  'useActorRuntimeSnapshot'
]);

requireFragments('transactional SQL test', sqlTest, [
  'SALES_R1_REPORTS_ONLY_PREVIEW_NOT_DENIED',
  'SALES_R1_REPORTS_ONLY_CANCEL_NOT_DENIED',
  'SALES_R1_REFUNDS_PREVIEW_NOT_ALLOWED',
  'SALES_R1_ADMIN_PREVIEW_NOT_ALLOWED',
  'SALES_R1_REFUNDS_CANCEL_NOT_ALLOWED',
  'SALES_R1_WRONG_OWNER_NOT_DENIED',
  'SALES_R1_MISSING_ACTOR_NOT_DENIED',
  'SALES_R1_REVOKED_ACTOR_NOT_DENIED',
  'SALES_R1_CROSS_LICENSE_NOT_DENIED',
  'SALES_R1_CROSS_DEVICE_NOT_DENIED',
  'rollback;'
]);

console.log('ADMIN.STAFF.SECTION.ISOLATION.R1 sales/refunds authorization contract: PASS');
