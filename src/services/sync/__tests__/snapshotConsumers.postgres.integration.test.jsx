// Run against an isolated PostgreSQL database with Block 1–3 migrations and
// the synthetic B2-VOLUME fixture. RPC transport is a local psql process;
// repositories, snapshot handlers, tenant context, and Dexie remain real.
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({ rpc: vi.fn(), auth: null }));

vi.mock('../../supabase', () => ({ supabaseClient: { rpc: harness.rpc } }));
vi.mock('../posSyncClient', () => ({
  buildPosSyncAuthContext: vi.fn(async ({ licenseKey }) => ({ ...harness.auth, licenseKey }))
}));
vi.mock('../posSyncOrchestrator', () => ({ posSyncOrchestrator: { registerEntitySyncHandler: vi.fn() } }));
vi.mock('../../auth/actorRuntimeController', async (importOriginal) => {
  const actual = await importOriginal();
  const { getActiveTenantRuntime } = await import('../../db/tenantRuntimeRouter');
  return { ...actual, actorRuntimeController: actual.createActorRuntimeController({
    getTenantAuthority: getActiveTenantRuntime
  }) };
});
vi.mock('../../salesCloud/salesCloudShadowService', () => ({
  salesCloudShadowService: { retryPendingShadowSales: vi.fn().mockResolvedValue(0) }
}));

import { useAppStore } from '../../../store/useAppStore';
import { openTestTenantRuntime, closeTestTenantRuntime } from '../../../test/tenantRuntimeTestHarness';
import { db, STORES } from '../../db/dexie';
import { getActiveTenantRuntime } from '../../db/tenantRuntimeRouter';
import { actorRuntimeController } from '../../auth/actorRuntimeController';
import { customerMigrationService } from '../../customers/customerMigrationService';
import { customerCreditSyncHandler } from '../../customerCredit/customerCreditSyncHandler';
import { salesCloudSyncHandler } from '../../salesCloud/salesCloudSyncHandler';
import { cashSyncHandler } from '../../cash/cashSyncHandler';

const LICENSE_KEY = 'B2-VOLUME';
const DEVICE_FINGERPRINT = 'volume-reader';
const ADMIN_SESSION_TOKEN = 'b4-volume-reader-token';
const STAFF_FINGERPRINT = 'staff-cash';
const STAFF_SESSION_TOKEN = 'b4-block4-staff-cash-session';
const STAFF_SESSION_ID = '00000000-0000-0000-0000-00000000b127';
const CASH_STATION = 'cash_station_device_550e8400-e29b-41d4-a716-446655440000';
const LICENSE_DETAILS = {
  license_key: LICENSE_KEY,
  plan_code: 'pro',
  valid: true,
  features: {
    cloud_pos_sync: true,
    cloud_cash_sync: true,
    cloud_customer_credit_sync: true,
    cloud_sales_sync_base: true
  }
};

const sqlText = (value) => value === null || value === undefined
  ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
const sqlNumber = (value) => value === null || value === undefined ? 'null' : String(Number(value));
const sqlJson = (value) => value === null || value === undefined
  ? 'null::jsonb' : `${sqlText(JSON.stringify(value))}::jsonb`;
const sqlTimestamptz = (value) => value === null || value === undefined
  ? 'null::timestamptz' : `${sqlText(value)}::timestamptz`;

const runPsql = (query) => execFileSync('docker', [
  'exec', 'lanzo-pos-b1-pg176', 'psql', '-U', 'postgres', '-d', process.env.LANZO_BLOCK3_PG_DB,
  '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-c', query
], { encoding: 'utf8' }).trim();

const prepareCashStaffSnapshotFixture = () => runPsql(`
  insert into public.pos_cash_stations(id,license_id,station_key,status,binding_mode,metadata)
  values (${sqlText(CASH_STATION)},'00000000-0000-0000-0000-00000000b111'::uuid,
          ${sqlText(CASH_STATION)},'active','device_default','{}'::jsonb)
  on conflict (license_id,id) do nothing;

  insert into public.license_staff_sessions(
    id,license_id,staff_user_id,device_id,session_token_hash,created_at,expires_at,last_seen_at,metadata
  )
  select ${sqlText(STAFF_SESSION_ID)}::uuid,l.id,d.staff_user_id,d.id,
         extensions.crypt(${sqlText(STAFF_SESSION_TOKEN)},extensions.gen_salt('bf')),
         now(),now()+interval '1 day',now(),'{}'::jsonb
    from public.license_devices d join public.licenses l on l.id=d.license_id
   where l.license_key=${sqlText(LICENSE_KEY)} and d.device_fingerprint=${sqlText(STAFF_FINGERPRINT)}
  on conflict (id) do update set
    session_token_hash=excluded.session_token_hash,expires_at=excluded.expires_at,revoked_at=null;

  with device as materialized (
    select l.id as license_id,d.id as device_id,d.staff_user_id
      from public.license_devices d join public.licenses l on l.id=d.license_id
     where l.license_key=${sqlText(LICENSE_KEY)} and d.device_fingerprint=${sqlText(STAFF_FINGERPRINT)}
  ), template as materialized (
    select to_jsonb(s) as row_data from public.pos_cash_sessions s
     where s.license_id='00000000-0000-0000-0000-00000000b111'::uuid limit 1
  ), inserted as (
    insert into public.pos_cash_sessions
    select (jsonb_populate_record(null::public.pos_cash_sessions,t.row_data || jsonb_build_object(
      'id','b4-staff-cash-session-'||lpad(n::text,4,'0'),
      'license_id',d.license_id,
      'device_id',d.device_id,
      'staff_user_id',d.staff_user_id,
      'device_role','staff',
      'scope','staff',
      'actor_key','staff:'||d.staff_user_id::text,
      'status','closed',
      'opened_at',clock_timestamp(),
      'closed_at',clock_timestamp(),
      'opening_amount',20,
      'opening_counted_amount',20,
      'opening_suggested_amount',20,
      'opening_difference',0,
      'closing_counted_amount',null,
      'next_shift_fund',0,
      'cash_sales_total',0,
      'customer_payments_total',0,
      'cash_entries_total',0,
      'cash_exits_total',0,
      'expected_cash_total',20,
      'cash_difference',null,
      'responsible_name','Block 4 QA staff',
      'opened_by_device_id',d.device_id,
      'opened_by_staff_user_id',d.staff_user_id,
      'closed_by_device_id',d.device_id,
      'closed_by_staff_user_id',d.staff_user_id,
      'closed_by_admin_user_id',null,
      'admin_user_id',null,
      'closing_mode',null,
      'reconciliation_status',null,
      'closure_reason_code',null,
      'cash_station_id',${sqlText(CASH_STATION)},
      'opened_by_actor_key','staff:'||d.staff_user_id::text,
      'closed_by_actor_key','staff:'||d.staff_user_id::text,
      'server_version',1,
      'deleted_at',null,
      'created_at',clock_timestamp(),
      'updated_at',clock_timestamp()
    ))).* from device d cross join template t cross join generate_series(1,501) n
    on conflict (id) do nothing
    returning license_id,id,server_version
  ), recorded as (
    select (private.record_pos_sync_event(i.license_id,'cash_session',i.id,'upsert',null,null,
      'block4-cash-session-'||i.id,jsonb_build_object('id',i.id),i.server_version)).change_seq as seq
      from inserted i
  ) select count(*) from recorded;

  with device as materialized (
    select l.id as license_id,d.id as device_id,d.staff_user_id
      from public.license_devices d join public.licenses l on l.id=d.license_id
     where l.license_key=${sqlText(LICENSE_KEY)} and d.device_fingerprint=${sqlText(STAFF_FINGERPRINT)}
  ), inserted as (
    insert into public.pos_cash_movements(
      id,license_id,cash_session_id,device_id,staff_user_id,actor_key,type,amount,concept,source,
      created_by_device_id,created_by_staff_user_id,actor_name,created_at,server_version,metadata,
      cash_station_id,performed_by_actor_key
    )
    select 'b4-staff-cash-movement-'||lpad(n::text,4,'0'),d.license_id,
      'b4-staff-cash-session-'||lpad(n::text,4,'0'),d.device_id,d.staff_user_id,
      'staff:'||d.staff_user_id::text,'entrada',10,'Block 4 snapshot fixture','manual',
      d.device_id,d.staff_user_id,'Block 4 QA staff',clock_timestamp(),1,'{}'::jsonb,
      ${sqlText(CASH_STATION)},'staff:'||d.staff_user_id::text
    from device d cross join generate_series(1,501) n
    on conflict (id) do nothing
    returning license_id,id,server_version
  ), recorded as (
    select (private.record_pos_sync_event(i.license_id,'cash_movement',i.id,'upsert',null,null,
      'block4-cash-movement-'||i.id,jsonb_build_object('id',i.id),i.server_version)).change_seq as seq
      from inserted i
  ) select count(*) from recorded;
`);

const authArgs = () => [
  sqlText(LICENSE_KEY), sqlText(harness.auth.deviceFingerprint), sqlText(harness.auth.securityToken),
  sqlText(harness.auth.staffSessionToken)
];

const callPostgresRpc = (rpcName, args) => {
  const common = authArgs();
  if (rpcName === 'pos_snapshot_sync_contract_v1') {
    return runPsql(`select public.${rpcName}(${[
      ...common, sqlNumber(args.p_requested_contract)
    ].join(',')})::text`);
  }
  if (rpcName === 'pos_pull_customers_snapshot_v3') {
    return runPsql(`select public.${rpcName}(${[
      ...common, sqlNumber(args.p_limit), sqlNumber(args.p_snapshot_reference_change_seq),
      sqlJson(args.p_page_cursor), sqlJson(args.p_sync_contract)
    ].join(',')})::text`);
  }
  if (rpcName === 'pos_pull_customer_credit_snapshot_v3') {
    return runPsql(`select public.${rpcName}(${[
      ...common, sqlNumber(args.p_limit), sqlNumber(args.p_snapshot_reference_change_seq),
      sqlJson(args.p_page_cursor), sqlText(args.p_customer_id), sqlJson(args.p_sync_contract)
    ].join(',')})::text`);
  }
  if (rpcName === 'pos_pull_sales_snapshot_v2') {
    return runPsql(`select public.${rpcName}(${[
      ...common, sqlNumber(args.p_limit), sqlNumber(args.p_snapshot_reference_change_seq),
      sqlJson(args.p_page_cursor), sqlTimestamptz(args.p_date_from), sqlTimestamptz(args.p_date_to)
    ].join(',')})::text`);
  }
  if (rpcName === 'pos_pull_cash_snapshot_v2') {
    return runPsql(`select public.${rpcName}(${[
      ...common, sqlText(args.p_scope), sqlNumber(args.p_limit),
      sqlNumber(args.p_snapshot_reference_change_seq), sqlJson(args.p_page_cursor)
    ].join(',')})::text`);
  }
  throw new Error(`Unexpected PostgreSQL RPC in snapshot consumer integration: ${rpcName}`);
};

describe('Block 4 PostgreSQL-to-Dexie snapshot consumers', () => {
  beforeEach(async () => {
    if (!process.env.LANZO_BLOCK3_PG_DB) return;
    // Establish a known admin session only in the disposable local fixture.
    runPsql(`update public.license_admin_sessions
       set session_token_hash=extensions.crypt(${sqlText(ADMIN_SESSION_TOKEN)},extensions.gen_salt('bf'))
     where device_id=(select d.id from public.license_devices d
       join public.licenses l on l.id=d.license_id
      where l.license_key=${sqlText(LICENSE_KEY)} and d.device_fingerprint=${sqlText(DEVICE_FINGERPRINT)})`);
    prepareCashStaffSnapshotFixture();
    const securityToken = runPsql(`select d.security_token from public.license_devices d
      join public.licenses l on l.id=d.license_id
     where l.license_key=${sqlText(LICENSE_KEY)} and d.device_fingerprint=${sqlText(DEVICE_FINGERPRINT)}`);
    harness.auth = {
      licenseKey: LICENSE_KEY,
      deviceFingerprint: DEVICE_FINGERPRINT,
      securityToken,
      staffSessionToken: ADMIN_SESSION_TOKEN
    };
    harness.rpc.mockReset().mockImplementation(async (rpcName, args) => ({
      data: JSON.parse(callPostgresRpc(rpcName, args)),
      error: null
    }));

    await openTestTenantRuntime();
    useAppStore.setState({ licenseDetails: LICENSE_DETAILS, currentDeviceRole: 'admin' });
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    actorRuntimeController.lock('block4_snapshot_fixture_reset');
    actorRuntimeController.beginAuthentication({ actorType: 'admin', deviceRef: 'block4-snapshot-device' });
    actorRuntimeController.grant({
      actorType: 'admin', actorId: 'block4-snapshot-admin', sessionId: 'block4-snapshot-session',
      deviceRef: 'block4-snapshot-device', permissions: ['*'],
      tenantOpaqueId: getActiveTenantRuntime().opaqueId,
      authorizationExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    });
  });

  afterEach(async () => {
    actorRuntimeController.lock('block4_snapshot_fixture_closed');
    useAppStore.setState({ licenseDetails: null, currentDeviceRole: 'admin' });
    await closeTestTenantRuntime();
    vi.clearAllMocks();
  });

  it.skipIf(!process.env.LANZO_BLOCK3_PG_DB)(
    'negotiates read-only snapshots and applies multipage customer, credit, sales, and cash projections to Dexie',
    async () => {
      const actorHandle = actorRuntimeController.capture('customers');
      const customers = await customerMigrationService.pullFullSnapshot(LICENSE_KEY, actorHandle);
      expect(customers).toMatchObject({ success: true, consistent: true, recoveryPending: true });
      expect(customers.pages).toBe(2);
      expect(await db.table(STORES.CUSTOMERS).count()).toBe(501);
      const firstCustomer = (await db.table(STORES.CUSTOMERS).toArray())[0];
      expect(firstCustomer).toMatchObject({ id: expect.any(String), serverVersion: expect.any(Number) });

      const credit = await customerCreditSyncHandler.onStart({
        licenseDetails: LICENSE_DETAILS, licenseKey: LICENSE_KEY, reason: 'manual', force: true
      });
      expect(credit).toMatchObject({ success: true, consistent: true, recoveryPending: true, pages: 2 });
      expect(await db.table(STORES.CUSTOMER_LEDGER).count()).toBe(501);

      const sales = await salesCloudSyncHandler.onStart({
        licenseDetails: LICENSE_DETAILS, licenseKey: LICENSE_KEY, reason: 'manual', force: true
      });
      expect(sales).toMatchObject({ success: true, consistent: true, recoveryPending: true, pages: 2 });
      const cachedSales = await db.table(STORES.SYNC_CACHE).toCollection()
        .filter((row) => String(row.key || '').startsWith('cloud_sale:')).toArray();
      expect(cachedSales).toHaveLength(501);
      expect(cachedSales[0].value).toMatchObject({ sale: { id: expect.any(String) }, items: [expect.any(Object)], payments: [expect.any(Object)] });

      // Exercise cash as a Staff actor with the narrow `mine` scope. The
      // synthetic legacy Admin cash rows carry noncanonical station labels;
      // they remain untouched and are outside this actor's authorized scope.
      actorRuntimeController.lock('block4_switch_to_staff_cash');
      actorRuntimeController.beginAuthentication({ actorType: 'staff', deviceRef: 'block4-staff-cash-device' });
      actorRuntimeController.grant({
        actorType: 'staff', actorId: '00000000-0000-0000-0000-00000000c107',
        sessionId: STAFF_SESSION_ID, deviceRef: 'block4-staff-cash-device', permissions: ['cash_register'],
        tenantOpaqueId: getActiveTenantRuntime().opaqueId,
        authorizationExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
      });
      useAppStore.setState({ licenseDetails: LICENSE_DETAILS, currentDeviceRole: 'staff' });
      harness.auth = {
        licenseKey: LICENSE_KEY,
        deviceFingerprint: STAFF_FINGERPRINT,
        securityToken: runPsql(`select d.security_token from public.license_devices d
          join public.licenses l on l.id=d.license_id
         where l.license_key=${sqlText(LICENSE_KEY)} and d.device_fingerprint=${sqlText(STAFF_FINGERPRINT)}`),
        staffSessionToken: STAFF_SESSION_TOKEN
      };
      const cash = await cashSyncHandler.onStart({
        licenseDetails: LICENSE_DETAILS, licenseKey: LICENSE_KEY, reason: 'manual', force: true
      });
      expect(cash).toMatchObject({ success: true, consistent: true, recoveryPending: true, pages: 3, scope: 'mine' });
      expect(await db.table(STORES.CAJAS).count()).toBe(501);
      expect(await db.table(STORES.MOVIMIENTOS_CAJA).count()).toBe(501);

      const discovered = harness.rpc.mock.calls.filter(([name]) => name === 'pos_snapshot_sync_contract_v1');
      const pageCalls = harness.rpc.mock.calls.filter(([name]) => name.endsWith('_snapshot_v2') || name.endsWith('_snapshot_v3'));
      expect(discovered).toHaveLength(4);
      expect(pageCalls).toHaveLength(9);
      expect(pageCalls.some(([name]) => name === 'pos_pull_customers_snapshot_v3')).toBe(true);
      expect(pageCalls.some(([name]) => name === 'pos_pull_customer_credit_snapshot_v3')).toBe(true);
      expect(pageCalls.some(([name]) => name === 'pos_pull_sales_snapshot_v2')).toBe(true);
      expect(pageCalls.some(([name]) => name === 'pos_pull_cash_snapshot_v2')).toBe(true);
      expect(pageCalls.every(([, args]) => Number(args.p_limit) <= 500)).toBe(true);
    },
    60_000
  );
});
