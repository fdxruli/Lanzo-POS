#!/usr/bin/env python3
"""Execute the exact migration and existing catalog engines in disposable PostgreSQL 17.

The fixture supplies synthetic actor contexts and no-op realtime/rate-limit boundaries.
It does not use a connection URL, a linked project, or Production records.
"""
import concurrent.futures
import json
from pathlib import Path
import re
import subprocess
import sys

MIGRATIONS = Path('supabase/migrations')
CORE = '20260624013300_fase2_productos_catalogo_cloud.sql'
SYNC = '20260623192708_fase0_motor_sync_pro_base.sql'
RBAC = '20260826010000_admin_staff_rbac_r2d_product_inventory_authority.sql'
PHARMACY = '20261111230000_pharmacy_stage2_inventory_authority.sql'
TARGET = '20261123193853_recover_local_product_group.sql'


def function(file, name):
    source = (MIGRATIONS / file).read_text()
    pattern = rf'create or replace function {re.escape(name)}\(.*?\bas (\$[\w]*\$).*?\1\s*;'
    return re.search(pattern, source, re.IGNORECASE | re.DOTALL)[0]


def pg(sql, expected_error=None):
    result = subprocess.run(
        ['docker', 'exec', '-i', 'lanzo-catalog-recovery-pg',
         'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
        input=sql, text=True, capture_output=True, check=False
    )
    if expected_error:
        assert result.returncode and expected_error in result.stderr, (expected_error, result)
    else:
        assert not result.returncode, result.stderr
    return result.stdout.strip()


def fixture():
    sync = (MIGRATIONS / SYNC).read_text()
    catalog = (MIGRATIONS / CORE).read_text()
    return '\n'.join([
        """
        create schema private;
        create role anon;
        create role authenticated;
        create role service_role;
        create table public.licenses(id uuid primary key);
        create table public.license_devices(id uuid primary key);
        create table public.license_staff_users(id uuid primary key);
        create table public.ecommerce_published_products(license_id uuid, local_product_ref text,
          source_type text, is_published boolean, deleted_at timestamptz);
        create table public.pos_layaway_inventory_reservations(license_id uuid, product_id text, status text);
        create table public.ecommerce_order_inventory_reservations(license_id uuid, source_product_id text, status text);
        create type public.business_category as enum ('farmacia');
        create table public.business_profiles(license_id uuid, business_type public.business_category[]);
        insert into public.licenses values
          ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
        insert into public.business_profiles values ('00000000-0000-0000-0000-000000000001', '{farmacia}');
        create function public.validate_pos_rpc_rate_limit_context(text,text,text,text) returns jsonb
        language sql as $$
          select case
            when $2 not in ('device-a', 'device-b') or $3 is distinct from ('token-' || $1)
              or $1 not in ('one', 'two', 'free')
              then '{"success":false,"code":"ACTOR_CONTEXT_INVALID"}'::jsonb
            else jsonb_build_object(
              'success', true, 'features', jsonb_build_object('cloud_pos_sync', $1 <> 'free', 'cloud_products_sync', $1 <> 'free'),
              'license_id', case when $1 = 'two' then '00000000-0000-0000-0000-000000000002'
                else '00000000-0000-0000-0000-000000000001' end,
              'actor_type', case when $4 is null then 'admin' else 'staff' end,
              'actor_permissions', case when $4 = 'products' then '{"products":true}'::jsonb else '{}'::jsonb end
            )
          end;
        $$;
        create function private.validate_pos_sync_context(text,text,text,text) returns jsonb
        language plpgsql as $$
        begin
          return private.validate_product_inventory_actor($1,$2,$3,$4)
            || jsonb_build_object('device_role', case when $4 is null then 'admin' else 'staff' end,
                                  'staff_permissions', case when $4 = 'products' then '{"products":true}'::jsonb else '{}'::jsonb end);
        end;
        $$;
        create function public.enforce_pos_rpc_rate_limit_v2(
          p_license_key text, p_device_fingerprint text, p_staff_session_token text, p_rpc_name text,
          p_scope text, p_max_attempts integer, p_window_seconds integer, p_block_seconds integer,
          p_code text, p_metadata jsonb
        ) returns jsonb language sql as $$ select '{"allowed":true}'::jsonb $$;
        create function public.build_pos_rpc_rate_limited_response(jsonb) returns jsonb
          language sql as $$ select '{"success":false,"code":"RPC_RATE_LIMITED"}'::jsonb $$;
        create function private.broadcast_pos_event(uuid,jsonb) returns void language sql as $$ select $$;
        """,
        sync[sync.lower().index('create sequence'):sync.lower().index('create table if not exists public.pos_sync_clients')]
            if 'create table if not exists public.pos_sync_clients' in sync.lower() else
            sync[sync.lower().index('create sequence'):sync.lower().index('alter table public.pos_sync_events')],
        catalog[catalog.index('create table'):catalog.lower().index('alter table public.pos_categories')],
        *(function(SYNC, f'private.{name}') for name in ['next_pos_change_seq', 'record_pos_sync_event']),
        *(function('20260623204031_fase1_clientes_directorio_cloud.sql', f'private.{name}')
          for name in ['complete_pos_idempotency', 'assert_cloud_pos_sync_enabled']),
        function('20260824230045_admin_staff_rbac_r2b_sale_price_discount_server_authority.sql', 'private.insert_pos_idempotency_processing'),
        *(function(RBAC, f'private.{name}') for name in [
            'has_product_inventory_permission', 'validate_product_inventory_actor',
            'assert_product_actor_authority', 'assert_inventory_actor_authority'
        ]),
        *(function(CORE, f'private.{name}') for name in [
            'normalize_pos_product_name_key', 'normalize_pos_sku_key', 'normalize_pos_barcode_key',
            'assert_cloud_products_sync_enabled', 'pos_product_to_jsonb', 'pos_product_batch_to_jsonb',
            'recalculate_pos_product_projection', 'pos_category_to_jsonb', 'has_pos_permission',
            'assert_pos_products_read_permission'
        ]),
        function('20260630193600_fase_cad_6_2_shelf_life_initial_batch_regularization.sql', 'private.calculate_pos_shelf_life_target'),
        function(RBAC, 'public.pos_upsert_product_unlimited')
        .replace('public.pos_upsert_product_unlimited(', 'public.pos_upsert_product_legacy_r2d(', 1),
        *(function(PHARMACY, f'private.{name}') for name in [
            'pharmacy_stage2_business', 'pharmacy_stage2_protected_product', 'pharmacy_stage2_guard_product_upsert'
        ]),
        function(PHARMACY, 'public.pos_upsert_product'),
        function(CORE, 'public.pos_pull_product_catalog_snapshot'),
        (MIGRATIONS / TARGET).read_text()
    ])


def json_literal(value):
    return "$json$" + json.dumps(value) + "$json$::jsonb"


def group(product_id, *, sku=None, committed=0):
    return (
        dict(id=product_id, name=product_id, sku=sku or product_id, stock=4,
             committed_stock=committed, cost=5, price=10, category_id='apparel',
             created_at='2026-08-01T00:00:00Z', server_version=0,
             metadata={'rubro_context': 'apparel'}, batch_management={'enabled': True}),
        [dict(id='lot-' + product_id, product_id=product_id, stock=4, committed_stock=committed,
              cost=5, price=10, status='active', created_at='2026-08-01T00:00:00Z',
              attributes={'size': 'M'}, server_version=0)]
    )


def recovery(product, batches, key, *, tenant='one', device='device-a', token=None, staff='null'):
    return (f"select public.pos_recover_local_product_group_v1('{tenant}', '{device}', "
            f"'{token or 'token-' + tenant}', {staff}, {json_literal(product)}, "
            f"{json_literal(batches)}, 'catalog-recovery:{key:032x}');")


def main():
    pg(fixture())
    readiness = pg("select public.pos_recover_local_product_group_v1('one','device-a','token-one',null,null,'[]',null);")
    assert json.loads(readiness) == {'success': True, 'contract_version': 1}
    assert pg('select count(*) from public.pos_idempotency_keys;') == '0'
    pg("""
      insert into public.pos_categories (id,license_id,name,name_key)
        values ('apparel','00000000-0000-0000-0000-000000000001','Apparel','apparel');
      insert into public.pos_products (id,license_id,name,name_key,sku,sku_key,stock,committed_stock)
        select 'cloud-'||i,'00000000-0000-0000-0000-000000000001','Cloud '||i,'cloud '||i,
          'cloud-'||i,'cloud-'||i,7,2 from generate_series(1,13) i;
    """)
    pg(recovery(*group('duplicate', sku='cloud-1'), 1), 'DUPLICATE_SKU')
    pg("""insert into public.ecommerce_published_products values
      ('00000000-0000-0000-0000-000000000001', 'published-snapshot', 'local_snapshot', true, null);""")
    pg(recovery(*group('published-snapshot'), 122), 'RECOVERY_PUBLISHED_SOURCE_REQUIRES_SELECTION')

    for index in range(23):
        receipt = json.loads(pg(recovery(*group(f'apparel-{index}'), index + 2)))
        assert receipt['product']['metadata']['rubro_context'] == 'apparel'
        assert receipt['product']['stock'] == receipt['batches'][0]['stock'] == 4
        assert receipt['product']['committed_stock'] == receipt['batches'][0]['committed_stock'] == 0
    assert pg("select count(*) from public.pos_products; select count(*) from public.pos_product_batches;") == '36\n23'
    assert pg("select count(*) from public.pos_products where id like 'cloud-%' and stock = 7 and committed_stock = 2 and stock - committed_stock = 5 and server_version = 1;") == '13'
    snapshot = json.loads(pg("select public.pos_pull_product_catalog_snapshot('one','device-b','token-one',null,'product');"))
    assert len(snapshot['products']) == 36
    assert any(row['id'] == 'apparel-22' and row['stock'] == 4 for row in snapshot['products'])
    assert json.loads(pg("select public.pos_pull_product_catalog_snapshot('two','device-b','token-two',null,'product');"))['products'] == []
    medicine, lots = group('medicine')
    medicine['metadata'] = {'pharmacy': {'kind': 'medicine'}}
    pg(recovery(medicine, lots, 100), 'PHARMACY_DOCUMENTED_RECEIPT_REQUIRED')
    pg(recovery(*group('committed', committed=1), 101), 'RECOVERY_RESERVATION_OR_BATCH_HISTORY_UNVERIFIED')
    pg("""insert into public.pos_layaway_inventory_reservations values
        ('00000000-0000-0000-0000-000000000001', 'pending-hold', 'reserved');""")
    pg(recovery(*group('pending-hold'), 121), 'RECOVERY_RESERVATION_OR_BATCH_HISTORY_UNVERIFIED')
    assert pg("select count(*) from public.pos_layaway_inventory_reservations where status = 'reserved';") == '1'

    product, lots = group('mismatch')
    lots[0]['stock'] = 3
    pg(recovery(product, lots, 102), 'RECOVERY_PHYSICAL_PROJECTION_MISMATCH')
    pg(recovery(*group('other-tenant'), 103, tenant='two', token='token-one'), 'ACTOR_CONTEXT_INVALID')
    pg(recovery(*group('other-tenant'), 103, tenant='two'), 'RECOVERY_CATEGORY_UNCONFIRMED')
    pg(recovery(*group('staff-denied'), 104, staff="'none'"), 'POS_PERMISSION_DENIED:products.write')
    pg(recovery(*group('staff-denied'), 104, staff="'products'"), 'POS_PERMISSION_DENIED:inventory.write')
    pg(recovery(*group('free-denied'), 105, tenant='free'), 'CLOUD_POS_SYNC_DISABLED')
    sql = recovery(*group('apparel-0'), 2)
    assert json.loads(pg(sql)) == json.loads(pg(recovery(*group('apparel-0'), 2, device='device-b')))
    assert pg("select count(*) from public.pos_sync_events where entity_id in ('apparel-0','lot-apparel-0');") == '2'
    item, batches = group('apparel-0')
    item['price'] = 20
    pg(recovery(item, batches, 2), 'IDEMPOTENCY_CONFLICT')
    # A legacy edit is still accepted. The old receipt can no longer authorize
    # the device to overwrite the newer canonical projection.
    legacy = json.loads(pg(f"""select public.pos_upsert_product('one','device-b','token-one',null,
      {json_literal(item)},'[]',2,'legacy-price');"""))
    assert legacy['product']['price'] == 20
    pg(sql, 'RECOVERY_PRODUCT_VERSION_CONFLICT')
    pg("update public.pos_products set deleted_at = now() where id = 'apparel-1';")
    pg(recovery(*group('apparel-1'), 3), 'PRODUCT_DELETED')
    pg(recovery(*group('apparel-1'), 110), 'PRODUCT_DELETED')
    # Force a late rollback: the canonical upsert recalculates weighted cost.
    product, lots = group('rollback')
    lots[0]['attributes'] = {}
    lots[0]['cost'] = 9
    pg(recovery(product, lots, 111), 'RECOVERY_PARENT_CONFIRMATION_INVALID')
    assert pg("select count(*) from public.pos_products where id = 'rollback';"
              "select count(*) from public.pos_sync_events where entity_id like '%rollback';") == '0\n0'
    # Both devices enter separate PostgreSQL transactions and contend for the
    # same absent ID. Exactly one commits, independent of scheduling order.
    def contend(index):
        statement = recovery(*group('concurrent'), 200 + index, device=['device-a', 'device-b'][index])
        try:
            return json.loads(pg(statement))['outcome']
        except AssertionError as error:
            assert any(code in str(error) for code in ('RECOVERY_PRODUCT_ALREADY_EXISTS', 'DUPLICATE_PRODUCT_KEY', 'INITIAL_BATCHES_CREATE_ONLY'))
            return 'conflict'
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = sorted(pool.map(contend, range(2)))
        assert outcomes in (['conflict', 'created'], ['created', 'existing']), outcomes
    assert pg("select stock || ':' || committed_stock from public.pos_products where id = 'concurrent';"
              "select count(*) from public.pos_product_batches where product_id = 'concurrent';") == '4:0\n1'
    print('PASS PostgreSQL 17: mixed catalog, pharmacy, versions, replay, rollback, permissions and concurrent creation')


if __name__ == '__main__':
    if len(sys.argv) != 1:
        raise SystemExit('Run only against a fresh disposable container named lanzo-catalog-recovery-pg')
    main()
