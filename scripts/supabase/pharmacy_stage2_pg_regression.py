#!/usr/bin/env python3
"""PR #478 focused SQL regression on disposable PostgreSQL 17, never Production."""
import os
import subprocess
from pathlib import Path

if (os.getenv("PGHOST"), os.getenv("PGPORT"), os.getenv("PGUSER"), os.getenv("PGDATABASE")) != (
    "127.0.0.1", "55432", "postgres", "postgres"
):
    raise SystemExit("REFUSE_NON_ISOLATED_POSTGRES")

sql = Path("supabase/migrations/20261111230000_pharmacy_stage2_inventory_authority.sql").read_text()
names = [
    "pharmacy_stage2_business", "pharmacy_stage2_protected_product",
    "pharmacy_stage2_guard_product_upsert", "pharmacy_stage2_guard_batch_upsert",
    "pharmacy_stage2_validate_receipt",
]
def read_function(name):
    start = sql.lower().index("create or replace function private." + name + "(")
    end = sql.index("$$;", start)
    return sql[start:end + 3]

fixture = """
create schema private;
create type public.business_category as enum ('farmacia','food_service');
create table public.business_profiles(license_id uuid,business_type public.business_category[]);
create table public.pos_products(
 id text,license_id uuid,deleted_at timestamptz,metadata jsonb,
 requires_prescription boolean,prescription_type text,batch_management jsonb,
 primary key(license_id,id)
);
create table public.pos_product_batches(
 id text,license_id uuid,product_id text,stock numeric,
 manufacturer_batch_id text,expiry_date timestamptz,deleted_at timestamptz,
 primary key(license_id,id)
);
create or replace function private.product_uses_batches(p public.pos_products)
 returns boolean language sql stable as $$
 select coalesce(p.batch_management->>'enabled','false')='true';
$$;
insert into public.business_profiles values
 ('00000000-0000-0000-0000-000000000001',array['farmacia'::public.business_category]),
 ('00000000-0000-0000-0000-000000000002',array['food_service'::public.business_category]);
insert into public.pos_products values
 ('iv','00000000-0000-0000-0000-000000000001',null,
  '{"pharmacy":{"kind":"medicine","status":"confirmed","fraction":"IV"}}',true,null,'{"enabled":true}'),
 ('ii','00000000-0000-0000-0000-000000000001',null,
  '{"pharmacy":{"kind":"medicine","status":"confirmed","fraction":"II"}}',true,'controlled','{"enabled":true}'),
 ('other','00000000-0000-0000-0000-000000000001',null,
  '{"pharmacy":{"kind":"other","status":"pending"}}',false,'otc','{"enabled":true}'),
 ('misclassified','00000000-0000-0000-0000-000000000001',null,
  '{"pharmacy":{"kind":"other","status":"pending"}}',true,'prescription','{"enabled":true}'),
 ('food','00000000-0000-0000-0000-000000000002',null,
  '{}',false,'otc','{"enabled":true}');
insert into public.pos_product_batches values
 ('b-iv','00000000-0000-0000-0000-000000000001','iv',10,'AMX-1','2028-12-30',null),
 ('b-other','00000000-0000-0000-0000-000000000001','other',10,null,null,null),
 ('b-food','00000000-0000-0000-0000-000000000002','food',10,null,null,null);
create or replace function private.expect_block(label text,statement text,expected text)
returns void language plpgsql as $$
begin
  begin
    execute statement;
    raise exception 'EXPECTED_REJECTION_MISSING: %',label;
  exception when others then
    if position(expected in SQLERRM)=0 then raise; end if;
  end;
end; $$;
"""
license_ph = "00000000-0000-0000-0000-000000000001"
license_food = "00000000-0000-0000-0000-000000000002"
ctx = "'" + '{"license_id":"' + license_ph + '"}' + "'::jsonb"
ctx_food = "'" + '{"license_id":"' + license_food + '"}' + "'::jsonb"
def query(expr):
    return "select " + expr + ";"
def expect(label, expr, expected):
    return ("select private.expect_block('" + label + "', $cmd$" +
            query(expr) + "$cmd$,'" + expected + "');")
def product(label, stock, metadata):
    return ("private.pharmacy_stage2_guard_product_upsert(" + ctx +
            ",'{\"id\":\"" + label + "\",\"stock\":" + str(stock) +
            ",\"metadata\":{\"pharmacy\":{\"kind\":\"" + metadata +
            "\"}}}'::jsonb,'[]'::jsonb)")
def batch(context, bid, pid, stock=None):
    val = '{"id":"' + bid + '","product_id":"' + pid + '"'
    if stock is not None:
        val += ',"stock":' + str(stock)
    return "private.pharmacy_stage2_guard_batch_upsert(" + context + ",'" + val + "}'::jsonb)"
receipt = '{"pharmacyReceipt":{"version":1,"supplier":"QA Supplier","documentType":"factura","documentReference":"QA-FAC-1","receivedAt":"2026-11-11T14:00:00Z","manufacturerBatchId":"AMX-1","expiryDate":"2028-12-30"}}'
def recv(pid, meta):
    return ("private.pharmacy_stage2_validate_receipt('" + license_ph +
            "'::uuid,(select p from public.pos_products p where p.id='" + pid +
            "'),(select b from public.pos_product_batches b where b.id='b-iv')," +
            "'" + meta + "'::jsonb,'QA Supplier',null,null," +
            "'2026-11-11T14:00:00Z'::timestamptz)")
test = [
    "do $$ begin if private.pharmacy_stage2_protected_product('" + license_ph +
    "','iv','{\"metadata\":{\"pharmacy\":{\"kind\":\"other\"}}}'::jsonb) is not true then " +
    "raise exception 'CLASSIFICATION_DOWNGRADE_BYPASS'; end if; end $$;",
    expect("iv_new_stock", product("new-iv", 10, "medicine"),
           "PHARMACY_INITIAL_STOCK_REQUIRES_DOCUMENTED_RECEIPT"),
    # An existing medicine may edit its attributes, but cannot add stock via initial batches.
    query("private.pharmacy_stage2_guard_product_upsert(" + ctx +
          ",'{\"id\":\"iv\",\"stock\":10}'::jsonb,'[]'::jsonb)"),
    expect("existing_iv_initial_batch_stock",
           "private.pharmacy_stage2_guard_product_upsert(" + ctx +
           ",'{\"id\":\"iv\"}'::jsonb,'[{\"id\":\"new-batch\",\"stock\":5}]'::jsonb)",
           "PHARMACY_INITIAL_STOCK_REQUIRES_DOCUMENTED_RECEIPT"),
    query(product("new-other", 10, "other")),
    query("private.pharmacy_stage2_guard_product_upsert(" + ctx_food +
          ",'{\"id\":\"restaurant\",\"stock\":10}'::jsonb,'[]'::jsonb)"),
    expect("iv_increment", batch(ctx, "b-iv", "iv", 15),
           "PHARMACY_BATCH_STOCK_CHANGE_REQUIRES_DOCUMENTED_MOVEMENT"),
    expect("iv_decrease", batch(ctx, "b-iv", "iv", 9),
           "PHARMACY_BATCH_STOCK_CHANGE_REQUIRES_DOCUMENTED_MOVEMENT"),
    query(batch(ctx, "b-iv", "iv")),
    expect("batch_mismatch", batch(ctx, "b-iv", "other", 10), "BATCH_PRODUCT_MISMATCH"),
    query(batch(ctx, "b-other", "other", 15)),
    query(batch(ctx_food, "b-food", "food", 15)),
    expect("iv_receipt_without_document", recv("iv", "{}"), "PHARMACY_PROVENANCE_REQUIRED"),
    query(recv("iv", receipt)),
    expect("ii_special", recv("ii", receipt), "PHARMACY_SPECIAL_RECEIPT_NOT_AVAILABLE"),
    # Persisted kind='other' must not defeat protected legacy prescription indicators.
    expect("legacy_conflicting_kind", recv("misclassified", "{}"),
           "PHARMACY_CLASSIFICATION_REQUIRED"),
    query(recv("other", "{}")),
    "select 'PASS postgres17 pharmacy_stage2_guard_scope' as result;",
]
full = fixture + "\n".join(read_function(n) for n in names) + "\nbegin;\n" + "\n".join(test) + "\nrollback;\n"
result = subprocess.run(
    ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-q"],
    input=full, text=True, capture_output=True, check=False, timeout=120
)
print(result.stdout)
print(result.stderr)
if result.returncode:
    raise SystemExit(result.returncode)
