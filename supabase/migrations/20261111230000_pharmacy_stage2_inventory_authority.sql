-- LANZO POS Pharmacy Stage 2. Canonical draft; NOT installed in Production.
-- Only the new pharmacy-specific inventory acquisition paths are restricted.
-- Historical amounts from initial cutover remain UNVERIFIED historical balances.
-- Read from Supabase Production on 2026-11-11; do not db push this migration.
create table if not exists private.pharmacy_inventory_cutovers_v1 (
  license_id uuid primary key references public.licenses(id),
  device_id uuid not null,
  batch_root text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz
);
create table if not exists private.pharmacy_inventory_import_items_v1 (
  license_id uuid not null references public.licenses(id),
  entity_kind text not null check(entity_kind in ('product','batch')),
  entity_id text not null,
  batch_id text not null,
  payload_hash text not null,
  initial_stock numeric not null check (initial_stock >= 0),
  created_at timestamptz not null default now(),
  primary key(license_id,entity_kind,entity_id)
);
alter table private.pharmacy_inventory_cutovers_v1 enable row level security;
alter table private.pharmacy_inventory_import_items_v1 enable row level security;
revoke all on table private.pharmacy_inventory_cutovers_v1 from public, anon, authenticated, service_role;
revoke all on table private.pharmacy_inventory_import_items_v1 from public, anon, authenticated, service_role;

create or replace function private.pharmacy_stage2_business(p_license_id uuid)
returns boolean language sql stable set search_path to ''
as $$
  select exists (
    select 1 from public.business_profiles bp
    where bp.license_id = p_license_id
      and 'farmacia'::public.business_category = any(bp.business_type)
  );
$$;

-- Server-only writes: a direct catalog RPC must not create undocumented stock.
-- The initial cutover uses a separate, limited, server-verified route.
create or replace function private.pharmacy_stage2_guard_product_upsert(
  p_context jsonb, p_product jsonb, p_initial_batches jsonb
) returns void language plpgsql security definer set search_path to ''
as $$
declare
  v_license_id uuid := (p_context->>'license_id')::uuid;
begin
  if not private.pharmacy_stage2_business(v_license_id) then return; end if;
  if exists (select 1 from public.pos_products p
             where p.license_id=v_license_id and p.id=nullif(p_product->>'id','')
               and p.deleted_at is null) then return; end if;
  if greatest(
      coalesce(nullif(p_product->>'stock','')::numeric,0),
      coalesce(nullif(p_product->>'committed_stock','')::numeric,0),
      coalesce(nullif(p_product->>'committedStock','')::numeric,0)
    ) > 0 or exists (
      select 1 from pg_catalog.jsonb_array_elements(
        case when pg_catalog.jsonb_typeof(p_initial_batches)='array'
             then p_initial_batches else '[]'::jsonb end
      ) as b(item)
      where coalesce(nullif(b.item->>'stock','')::numeric,0)>0
    ) then
    raise exception 'PHARMACY_INITIAL_STOCK_REQUIRES_DOCUMENTED_RECEIPT'
      using errcode='P0001';
  end if;
end;
$$;

create or replace function private.pharmacy_stage2_guard_batch_upsert(
  p_context jsonb,p_batch jsonb
) returns void language plpgsql security definer set search_path to ''
as $$
declare
 v_license_id uuid := (p_context->>'license_id')::uuid;
 v_old_stock numeric;
 v_new_stock numeric := coalesce(nullif(p_batch->>'stock','')::numeric,0);
begin
 if not private.pharmacy_stage2_business(v_license_id) then return; end if;
 if nullif(p_batch->>'id','') is null then
   raise exception 'BATCH_ID_REQUIRED' using errcode='P0001';
 end if;
 select b.stock into v_old_stock
 from public.pos_product_batches b
 where b.license_id=v_license_id and b.id=p_batch->>'id'
 for update;
 if v_new_stock > coalesce(v_old_stock,0) then
   raise exception 'PHARMACY_BATCH_STOCK_INCREASE_REQUIRES_DOCUMENTED_RECEIPT'
     using errcode='P0001';
 end if;
end;
$$;

-- One initial cutover per license, only while Cloud has no catalog, batches or
-- movements. Same licensed device and batch root, bounded server-side lease.
-- Each positive historical item may be processed only once (idempotent retry
-- of the identical item and batch is allowed). The client label is NOT authority.
create or replace function private.pharmacy_stage2_authorize_import_slice(
  p_context jsonb, p_batch_id text, p_products jsonb, p_batches jsonb
) returns void language plpgsql security definer set search_path to ''
as $$
declare
  v_license_id uuid := (p_context->>'license_id')::uuid;
  v_device_id uuid := (p_context->>'device_id')::uuid;
  v_root text;
  v_cutover private.pharmacy_inventory_cutovers_v1%rowtype;
  v_item jsonb;
  v_kind text;
  v_stock numeric;
  v_entity_id text;
  v_used private.pharmacy_inventory_import_items_v1%rowtype;
  v_has_stock boolean;
begin
  if not private.pharmacy_stage2_business(v_license_id) then return; end if;
  v_root := regexp_replace(coalesce(p_batch_id,''), '-(categories|products|batches)-[0-9]+$', '');
  v_has_stock := exists (
    select 1 from pg_catalog.jsonb_array_elements(p_products) e(x)
    where greatest(coalesce(nullif(e.x->>'stock','')::numeric,0),
      coalesce(nullif(e.x->>'committed_stock','')::numeric,0),
      coalesce(nullif(e.x->>'committedStock','')::numeric,0))>0
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements(p_batches) e(x)
    where coalesce(nullif(e.x->>'stock','')::numeric,0)>0
  );
  select * into v_cutover from private.pharmacy_inventory_cutovers_v1
   where license_id=v_license_id for update;
  if not found and p_batch_id ~ '^products-.+-(categories|products|batches)-[0-9]+$'
      and not exists(select 1 from public.pos_products where license_id=v_license_id)
      and not exists(select 1 from public.pos_product_batches where license_id=v_license_id)
      and not exists(select 1 from public.pos_inventory_movements where license_id=v_license_id) then
    perform private.assert_inventory_actor_authority(p_context);
    insert into private.pharmacy_inventory_cutovers_v1
      (license_id,device_id,batch_root,expires_at)
      values(v_license_id,v_device_id,v_root,now()+interval '24 hours')
      returning * into v_cutover;
  end if;
  if not v_has_stock then return; end if;
  perform private.assert_inventory_actor_authority(p_context);
  if v_cutover.license_id is null or v_cutover.device_id is distinct from v_device_id
     or v_cutover.batch_root is distinct from v_root or nullif(p_batch_id,'') is null then
    raise exception 'PHARMACY_HISTORICAL_IMPORT_NOT_AUTHORIZED'
      using errcode='P0001';
  end if;
  for v_kind, v_item in
    select 'product'::text, x from pg_catalog.jsonb_array_elements(p_products) e(x)
    union all
    select 'batch'::text, x from pg_catalog.jsonb_array_elements(p_batches) e(x)
  loop
    v_stock := greatest(coalesce(nullif(v_item->>'stock','')::numeric,0),
      case when v_kind='product' then
        greatest(coalesce(nullif(v_item->>'committed_stock','')::numeric,0),
                 coalesce(nullif(v_item->>'committedStock','')::numeric,0))
      else 0 end);
    if v_stock<=0 then continue; end if;
    v_entity_id := nullif(v_item->>'id','');
    if v_entity_id is null then
      raise exception 'PHARMACY_HISTORICAL_ITEM_ID_REQUIRED' using errcode='P0001';
    end if;
    select * into v_used from private.pharmacy_inventory_import_items_v1
     where license_id=v_license_id and entity_kind=v_kind and entity_id=v_entity_id for update;
    if found then
      if v_used.batch_id is distinct from p_batch_id
         or v_used.initial_stock is distinct from v_stock then
        raise exception 'PHARMACY_HISTORICAL_ITEM_ALREADY_IMPORTED'
          using errcode='P0001';
      end if;
      continue; -- exact idempotent retry of same operation, no new stock effect
    end if;
    if v_cutover.completed_at is not null or v_cutover.expires_at<=now() then
      raise exception 'PHARMACY_HISTORICAL_IMPORT_CLOSED' using errcode='P0001';
    end if;
    if (v_kind='product' and exists (
       select 1 from public.pos_products where license_id=v_license_id and id=v_entity_id))
       or (v_kind='batch' and exists (
       select 1 from public.pos_product_batches where license_id=v_license_id and id=v_entity_id)) then
      raise exception 'PHARMACY_HISTORICAL_IMPORT_ITEM_EXISTS' using errcode='P0001';
    end if;
    insert into private.pharmacy_inventory_import_items_v1
      (license_id,entity_kind,entity_id,batch_id,payload_hash,initial_stock)
    values(v_license_id,v_kind,v_entity_id,p_batch_id,md5(v_item::text),v_stock);
  end loop;
end;
$$;

-- The updated app closes the cutover immediately after successful bootstrap.
-- Legacy bootstrap does not call this: its one-time lease expires automatically.
create or replace function public.pos_complete_pharmacy_inventory_cutover(
 p_license_key text,p_device_fingerprint text,p_security_token text,
 p_staff_session_token text default null,p_batch_root text default null
) returns jsonb language plpgsql security definer set search_path to ''
as $$
declare
 v_context jsonb;
 v_license_id uuid;
 v_device_id uuid;
begin
 v_context := private.validate_product_inventory_actor(
   p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token);
 perform private.assert_cloud_products_sync_enabled(v_context);
 perform private.assert_product_actor_authority(v_context);
 v_license_id := (v_context->>'license_id')::uuid;
 v_device_id := (v_context->>'device_id')::uuid;
 if not private.pharmacy_stage2_business(v_license_id) then
   return jsonb_build_object('success',true,'skipped',true);
 end if;
 perform private.assert_inventory_actor_authority(v_context);
 update private.pharmacy_inventory_cutovers_v1
   set completed_at=coalesce(completed_at,now())
 where license_id=v_license_id and device_id=v_device_id
   and batch_root=p_batch_root and (completed_at is null or completed_at<=now());
 if not found then
   raise exception 'PHARMACY_HISTORICAL_IMPORT_NOT_AUTHORIZED' using errcode='P0001';
 end if;
 return jsonb_build_object('success',true,'closed',true);
end;
$$;

-- Product classification is read from the persisted row, never the browser.
create or replace function private.pharmacy_stage2_validate_receipt(
 p_license_id uuid,p_product public.pos_products,p_batch public.pos_product_batches,
 p_metadata jsonb,p_supplier text,p_manufacturer_batch_id text,
 p_expiry_date timestamptz,p_occurred_at timestamptz
) returns void language plpgsql security definer set search_path to ''
as $$
declare
 v_pharmacy jsonb := p_product.metadata->'pharmacy';
 v_receipt jsonb := p_metadata->'pharmacyReceipt';
 v_manufacturer text := coalesce(nullif(p_batch.manufacturer_batch_id,''),nullif(p_manufacturer_batch_id,''));
 v_expiry timestamptz := coalesce(p_batch.expiry_date,p_expiry_date);
begin
 if not private.pharmacy_stage2_business(p_license_id) then return; end if;
 if pg_catalog.jsonb_typeof(v_pharmacy) is distinct from 'object' then
   raise exception 'PHARMACY_CLASSIFICATION_REQUIRED' using errcode='P0001';
 end if;
 if v_pharmacy->>'kind'='other' then return; end if;
 if v_pharmacy->>'kind' is distinct from 'medicine'
    or v_pharmacy->>'status' is distinct from 'confirmed' then
   raise exception 'PHARMACY_CLASSIFICATION_REQUIRED' using errcode='P0001';
 end if;
 if coalesce(v_pharmacy->>'fraction','') not in ('IV','V','VI') then
   raise exception 'PHARMACY_SPECIAL_RECEIPT_NOT_AVAILABLE' using errcode='P0001';
 end if;
 if not private.product_uses_batches(p_product) then
   raise exception 'PHARMACY_BATCHES_REQUIRED' using errcode='P0001';
 end if;
 if pg_catalog.jsonb_typeof(v_receipt) is distinct from 'object'
   or v_receipt->>'version' is distinct from '1'
   or nullif(pg_catalog.btrim(coalesce(p_supplier,'')),'') is null
   or nullif(pg_catalog.btrim(coalesce(v_receipt->>'supplier','')),'') is null
   or pg_catalog.btrim(p_supplier) is distinct from pg_catalog.btrim(v_receipt->>'supplier')
   or coalesce(v_receipt->>'documentType','') not in ('factura','remision','otro')
   or nullif(pg_catalog.btrim(coalesce(v_receipt->>'documentReference','')),'') is null
   or p_occurred_at is null or nullif(v_receipt->>'receivedAt','') is null then
   raise exception 'PHARMACY_PROVENANCE_REQUIRED' using errcode='P0001';
 end if;
 if nullif(pg_catalog.btrim(coalesce(v_manufacturer,'')),'') is null or v_expiry is null
   or (v_expiry at time zone 'UTC')::date < current_date then
   raise exception 'PHARMACY_BATCH_IDENTITY_REQUIRED' using errcode='P0001';
 end if;
 if pg_catalog.lower(pg_catalog.btrim(v_manufacturer)) is distinct from
    pg_catalog.lower(pg_catalog.btrim(coalesce(v_receipt->>'manufacturerBatchId','')))
    or (v_expiry at time zone 'UTC')::date::text is distinct from v_receipt->>'expiryDate'
    or (v_receipt->>'receivedAt')::timestamptz is distinct from p_occurred_at then
   raise exception 'PHARMACY_RECEIPT_BATCH_MISMATCH' using errcode='P0001';
 end if;
 if p_batch.id is null and exists (
   select 1 from public.pos_product_batches b
    where b.license_id=p_license_id and b.product_id=p_product.id and b.deleted_at is null
      and pg_catalog.lower(pg_catalog.btrim(coalesce(b.manufacturer_batch_id,'')))=
          pg_catalog.lower(pg_catalog.btrim(v_manufacturer))
 ) then
   raise exception 'PHARMACY_EXISTING_BATCH_REQUIRED' using errcode='P0001';
 end if;
end;
$$;

-- Paginated read only, scoped to one product and authenticated license.
create or replace function public.pos_list_pharmacy_inventory_receipts(
 p_license_key text,p_device_fingerprint text,p_security_token text,
 p_staff_session_token text default null,p_product_id text default null,
 p_limit integer default 20,p_before_at timestamptz default null,
 p_before_id text default null
) returns jsonb language plpgsql security definer set search_path to ''
as $$
declare
 v_context jsonb;
 v_license_id uuid;
 v_limit integer := least(greatest(coalesce(p_limit,20),1),50);
 v_records jsonb;
begin
 v_context := private.validate_product_inventory_actor(
   p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token);
 perform private.assert_cloud_products_sync_enabled(v_context);
 perform private.assert_inventory_actor_authority(v_context);
 v_license_id := (v_context->>'license_id')::uuid;
 if nullif(pg_catalog.btrim(coalesce(p_product_id,'')),'') is null
    or not exists (select 1 from public.pos_products
         where license_id=v_license_id and id=p_product_id and deleted_at is null) then
   raise exception 'PRODUCT_NOT_FOUND' using errcode='P0001';
 end if;
 select coalesce(jsonb_agg(x.row_data order by x.created_at desc,x.id desc),'[]'::jsonb)
   into v_records from (
   select m.id,m.created_at,
      jsonb_build_object(
        'id',m.id,'operationId',m.idempotency_key,'productId',m.product_id,
        'batchId',m.batch_id,'quantity',m.quantity,'createdAt',m.created_at,
        'receipt',m.metadata->'pharmacyReceipt',
        'responsible',m.actor_name,'syncStatus','cloud'
      ) as row_data
   from public.pos_inventory_movements m
   where m.license_id=v_license_id and m.product_id=p_product_id
     and m.source='inventory_entry' and m.movement_type='manual_in'
     and pg_catalog.jsonb_typeof(m.metadata->'pharmacyReceipt')='object'
     and (p_before_at is null or
       (m.created_at,m.id)<(p_before_at,coalesce(p_before_id,'~')))
   order by m.created_at desc,m.id desc
   limit v_limit
 ) x;
 return jsonb_build_object('success',true,'receipts',v_records,'limit',v_limit);
end;
$$;

-- Existing signatures retained; wrappers reject direct undocumented writes.
CREATE OR REPLACE FUNCTION public.pos_upsert_product(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_product jsonb DEFAULT '{}'::jsonb, p_initial_batches jsonb DEFAULT '[]'::jsonb, p_expected_version integer DEFAULT NULL::integer, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context jsonb;
begin
  v_context := private.validate_product_inventory_actor(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_product_actor_authority(v_context);
  if jsonb_typeof(coalesce(p_initial_batches, '[]'::jsonb)) = 'array'
    and jsonb_array_length(coalesce(p_initial_batches, '[]'::jsonb)) > 0 then
    perform private.assert_inventory_actor_authority(v_context);
  end if;
  if not exists (
    select 1 from public.pos_products existing
    where existing.license_id = (v_context->>'license_id')::uuid
      and existing.id = nullif(p_product->>'id', '')
      and existing.deleted_at is null
  ) and greatest(
    coalesce(nullif(p_product->>'stock', '')::numeric, 0),
    coalesce(nullif(p_product->>'committed_stock', '')::numeric, 0),
    coalesce(nullif(p_product->>'committedStock', '')::numeric, 0)
  ) > 0 then
    perform private.assert_inventory_actor_authority(v_context);
  end if;
  perform private.pharmacy_stage2_guard_product_upsert(v_context,p_product,p_initial_batches);
  return public.pos_upsert_product_legacy_r2d(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, p_product, p_initial_batches, p_expected_version, p_idempotency_key);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.pos_upsert_product_batch(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_batch jsonb DEFAULT '{}'::jsonb, p_expected_version integer DEFAULT NULL::integer, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context jsonb;
begin
  v_context := private.validate_product_inventory_actor(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_inventory_actor_authority(v_context);
  perform private.pharmacy_stage2_guard_batch_upsert(v_context,p_batch);
  return public.pos_upsert_product_batch_legacy_r2d(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, p_batch, p_expected_version, p_idempotency_key);
end;
$function$
;

-- Imports use the same legacy rate-limited delegators, after server cutover checks.
CREATE OR REPLACE FUNCTION public.pos_migrate_local_product_catalog_unlimited(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_categories jsonb DEFAULT '[]'::jsonb, p_products jsonb DEFAULT '[]'::jsonb, p_batches jsonb DEFAULT '[]'::jsonb, p_batch_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context jsonb;
  v_item jsonb;
  v_results jsonb := jsonb_build_object('categories', '[]'::jsonb, 'products', '[]'::jsonb, 'batches', '[]'::jsonb);
  v_result jsonb;
  v_index integer := 0;
  v_key text;
begin
  v_context := private.validate_product_inventory_actor(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_product_actor_authority(v_context);
  if jsonb_typeof(coalesce(p_batches, '[]'::jsonb)) = 'array'
    and jsonb_array_length(coalesce(p_batches, '[]'::jsonb)) > 0 then
    perform private.assert_inventory_actor_authority(v_context);
  end if;
  if jsonb_typeof(coalesce(p_products, '[]'::jsonb)) = 'array'
    and exists (
      select 1
      from jsonb_array_elements(coalesce(p_products, '[]'::jsonb)) as product_item(item)
      where not exists (
        select 1 from public.pos_products existing
        where existing.license_id = (v_context->>'license_id')::uuid
          and existing.id = nullif(product_item.item->>'id', '')
          and existing.deleted_at is null
      )
      and greatest(
        coalesce(nullif(product_item.item->>'stock', '')::numeric, 0),
        coalesce(nullif(product_item.item->>'committed_stock', '')::numeric, 0),
        coalesce(nullif(product_item.item->>'committedStock', '')::numeric, 0)
      ) > 0
    ) then
    perform private.assert_inventory_actor_authority(v_context);
  end if;

  if coalesce(jsonb_typeof(p_categories), 'array') <> 'array' then raise exception 'CATEGORIES_ARRAY_REQUIRED' using errcode = 'P0001'; end if;
  if coalesce(jsonb_typeof(p_products), 'array') <> 'array' then raise exception 'PRODUCTS_ARRAY_REQUIRED' using errcode = 'P0001'; end if;
  if coalesce(jsonb_typeof(p_batches), 'array') <> 'array' then raise exception 'BATCHES_ARRAY_REQUIRED' using errcode = 'P0001'; end if;

  perform private.pharmacy_stage2_authorize_import_slice(v_context,p_batch_id,
    coalesce(p_products,'[]'::jsonb),coalesce(p_batches,'[]'::jsonb));

  v_index := 0;
  for v_item in select value from jsonb_array_elements(coalesce(p_categories, '[]'::jsonb)) loop
    v_index := v_index + 1;
    v_key := concat('migration:', coalesce(p_batch_id, 'default'), ':category:', coalesce(v_item->>'id', v_index::text));
    v_result := public.pos_upsert_category(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, v_item || jsonb_build_object('metadata', coalesce(v_item->'metadata', '{}'::jsonb) || jsonb_build_object('migration_batch_id', p_batch_id, 'inventory_origin', 'historical_import_unverified')), null, v_key);
    if coalesce((v_result->>'success')::boolean,false) is not true then
      raise exception 'PHARMACY_CUTOVER_%_FAILED: %', upper('categories'), coalesce(v_result->>'code','NESTED_UPSERT_FAILED') using errcode='P0001';
    end if;
    v_results := jsonb_set(v_results, '{categories}', (v_results->'categories') || jsonb_build_array(v_result));
  end loop;

  v_index := 0;
  for v_item in select value from jsonb_array_elements(coalesce(p_products, '[]'::jsonb)) loop
    v_index := v_index + 1;
    v_key := concat('migration:', coalesce(p_batch_id, 'default'), ':product:', coalesce(v_item->>'id', v_index::text));
    v_result := public.pos_upsert_product_legacy_r2d(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, v_item || jsonb_build_object('metadata', coalesce(v_item->'metadata', '{}'::jsonb) || jsonb_build_object('migration_batch_id', p_batch_id, 'inventory_origin', 'historical_import_unverified')), '[]'::jsonb, null, v_key);
    if coalesce((v_result->>'success')::boolean,false) is not true then
      raise exception 'PHARMACY_CUTOVER_%_FAILED: %', upper('products'), coalesce(v_result->>'code','NESTED_UPSERT_FAILED') using errcode='P0001';
    end if;
    v_results := jsonb_set(v_results, '{products}', (v_results->'products') || jsonb_build_array(v_result));
  end loop;

  v_index := 0;
  for v_item in select value from jsonb_array_elements(coalesce(p_batches, '[]'::jsonb)) loop
    v_index := v_index + 1;
    v_key := concat('migration:', coalesce(p_batch_id, 'default'), ':batch:', coalesce(v_item->>'id', v_index::text));
    v_result := public.pos_upsert_product_batch_legacy_r2d(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, v_item || jsonb_build_object('metadata', coalesce(v_item->'metadata', '{}'::jsonb) || jsonb_build_object('migration_batch_id', p_batch_id, 'inventory_origin', 'historical_import_unverified')), null, v_key);
    if coalesce((v_result->>'success')::boolean,false) is not true then
      raise exception 'PHARMACY_CUTOVER_%_FAILED: %', upper('batches'), coalesce(v_result->>'code','NESTED_UPSERT_FAILED') using errcode='P0001';
    end if;
    v_results := jsonb_set(v_results, '{batches}', (v_results->'batches') || jsonb_build_array(v_result));
  end loop;

  return jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'processed', jsonb_build_object(
      'categories', jsonb_array_length(coalesce(p_categories, '[]'::jsonb)),
      'products', jsonb_array_length(coalesce(p_products, '[]'::jsonb)),
      'batches', jsonb_array_length(coalesce(p_batches, '[]'::jsonb))
    ),
    'results', v_results
  );
end;
$function$
;

-- Additive inventory remains atomic and locked; metadata required for pharmacy.
CREATE OR REPLACE FUNCTION public.pos_add_inventory_entry(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_product_id text DEFAULT NULL::text, p_batch_id text DEFAULT NULL::text, p_quantity numeric DEFAULT NULL::numeric, p_input_unit text DEFAULT NULL::text, p_base_quantity numeric DEFAULT NULL::numeric, p_base_unit text DEFAULT NULL::text, p_unit_cost numeric DEFAULT NULL::numeric, p_supplier text DEFAULT NULL::text, p_manufacturer_batch_id text DEFAULT NULL::text, p_expiry_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_entry_kind text DEFAULT 'restock'::text, p_metadata jsonb DEFAULT '{}'::jsonb, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_rate_limit jsonb;
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_product public.pos_products;
  v_batch public.pos_product_batches;
  v_saved_batch public.pos_product_batches;
  v_saved_product public.pos_products;
  v_movement public.pos_inventory_movements;
  v_event public.pos_sync_events;
  v_batch_event public.pos_sync_events;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
  v_request jsonb;
  v_request_hash text;
  v_batch_id text;
  v_previous_stock numeric;
  v_new_stock numeric;
  v_previous_batch_stock numeric;
  v_new_batch_stock numeric;
  v_uses_batches boolean;
  v_is_variant boolean;
  v_has_variants boolean;
  v_response jsonb;
begin
  v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key, p_device_fingerprint, p_staff_session_token,
    'pos_add_inventory_entry', 'POS_WRITE', 60, 60, 60,
    'RPC_RATE_LIMITED', jsonb_build_object('operation', 'inventory_entry')
  );
  if coalesce((v_rate_limit->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate_limit);
  end if;

  v_context := private.validate_product_inventory_actor(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_inventory_actor_authority(v_context);
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_KEY_REQUIRED', 'message', 'operationId es obligatorio.');
  end if;
  if nullif(btrim(coalesce(p_product_id, '')), '') is null then
    return jsonb_build_object('success', false, 'code', 'PRODUCT_NOT_FOUND', 'message', 'El producto es obligatorio.');
  end if;
  if coalesce(p_quantity, 0) <= 0 or coalesce(p_base_quantity, 0) <= 0 then
    return jsonb_build_object('success', false, 'code', 'INVALID_QUANTITY', 'message', 'La cantidad debe ser mayor a cero.');
  end if;
  if abs(p_quantity - p_base_quantity) > 0.000001 then
    return jsonb_build_object('success', false, 'code', 'INVALID_UNIT_PRECISION', 'message', 'La conversión de unidades aún no está disponible.');
  end if;
  if p_unit_cost is not null and p_unit_cost < 0 then
    return jsonb_build_object('success', false, 'code', 'INVALID_UNIT_PRECISION', 'message', 'El costo no puede ser negativo.');
  end if;

  v_request := jsonb_build_object(
    'product_id', p_product_id, 'batch_id', p_batch_id, 'quantity', p_quantity,
    'input_unit', p_input_unit, 'base_quantity', p_base_quantity, 'base_unit', p_base_unit,
    'unit_cost', p_unit_cost, 'supplier', p_supplier, 'manufacturer_batch_id', p_manufacturer_batch_id,
    'expiry_date', p_expiry_date, 'occurred_at', p_occurred_at, 'entry_kind', p_entry_kind,
    'metadata', coalesce(p_metadata, '{}'::jsonb)
  );
  v_request_hash := md5(v_request::text);
  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'inventory.entry', 'inventory_entry', p_product_id, v_request_hash);
  if not v_inserted_idem then
    select * into v_idem from public.pos_idempotency_keys where license_id = v_license_id and idempotency_key = p_idempotency_key for update;
    if coalesce(v_idem.request_hash, '') <> v_request_hash then
      return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'message', 'operationId ya fue usado con otro payload.');
    end if;
    if v_idem.status = 'completed' and v_idem.response_payload is not null then return v_idem.response_payload; end if;
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'La operación ya está en proceso.');
  end if;

  select * into v_product from public.pos_products where license_id = v_license_id and id = p_product_id and deleted_at is null for update;
  if v_product.id is null then
    v_response := jsonb_build_object('success', false, 'code', 'PRODUCT_NOT_FOUND', 'message', 'El producto no existe o fue eliminado.');
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response); return v_response;
  end if;
  if v_product.track_stock is false then
    v_response := jsonb_build_object('success', false, 'code', 'STOCK_TRACKING_DISABLED', 'message', 'El producto no administra existencias.');
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response); return v_response;
  end if;
  if jsonb_typeof(coalesce(v_product.recipe, '[]'::jsonb)) = 'array' and jsonb_array_length(coalesce(v_product.recipe, '[]'::jsonb)) > 0 then
    v_response := jsonb_build_object('success', false, 'code', 'RECIPE_INVENTORY_ENTRY_NOT_ALLOWED', 'message', 'Los platillos con receta no admiten entradas directas.');
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response); return v_response;
  end if;

  v_uses_batches := private.product_uses_batches(v_product);
  v_previous_stock := greatest(coalesce(v_product.stock, 0), 0);
  if v_uses_batches then
    select exists (
      select 1 from public.pos_product_batches b where b.license_id = v_license_id and b.product_id = v_product.id
        and b.deleted_at is null and b.attributes is not null and b.attributes <> '{}'::jsonb
    ) into v_has_variants;
    if v_has_variants and nullif(btrim(coalesce(p_batch_id, '')), '') is null then
      v_response := jsonb_build_object('success', false, 'code', 'VARIANT_REQUIRED', 'message', 'Este producto requiere seleccionar una variante.');
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response); return v_response;
    end if;
    v_batch_id := nullif(btrim(coalesce(p_batch_id, '')), '');
    if v_batch_id is null then v_batch_id := 'batch-entry-' || regexp_replace(p_idempotency_key, '[^a-zA-Z0-9_-]', '-', 'g'); end if;
    select * into v_batch from public.pos_product_batches where license_id = v_license_id and id = v_batch_id and deleted_at is null for update;
    if v_batch.id is not null and v_batch.product_id <> v_product.id then
      v_response := jsonb_build_object('success', false, 'code', 'BATCH_PRODUCT_MISMATCH', 'message', 'El lote no pertenece al producto.');
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response); return v_response;
    end if;
    if v_has_variants and (v_batch.id is null or v_batch.attributes is null or v_batch.attributes = '{}'::jsonb) then
      v_response := jsonb_build_object('success', false, 'code', 'VARIANT_NOT_FOUND', 'message', 'La variante seleccionada ya no existe.');
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response); return v_response;
    end if;
    if v_product.expiration_mode = 'STRICT' and v_batch.id is null and nullif(btrim(coalesce(p_manufacturer_batch_id, '')), '') is null then
      v_response := jsonb_build_object('success', false, 'code', 'STRICT_MANUFACTURER_BATCH_REQUIRED', 'message', 'Se requiere lote del fabricante.');
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response); return v_response;
    end if;
    if v_product.expiration_mode = 'STRICT' and v_batch.id is null and p_expiry_date is null then
      v_response := jsonb_build_object('success', false, 'code', 'STRICT_EXPIRY_REQUIRED', 'message', 'Se requiere fecha de caducidad.');
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response); return v_response;
    end if;
    perform private.pharmacy_stage2_validate_receipt(
      v_license_id,v_product,v_batch,coalesce(p_metadata,'{}'::jsonb),
      p_supplier,p_manufacturer_batch_id,p_expiry_date,p_occurred_at);
    v_previous_batch_stock := greatest(coalesce(v_batch.stock, 0), 0);
    v_new_batch_stock := v_previous_batch_stock + p_base_quantity;
    if v_batch.id is null then
      insert into public.pos_product_batches (id, license_id, product_id, stock, committed_stock, cost, price, track_stock, is_active, status, active_stock_status, expiry_date, alert_target_date, alert_type, manufacturer_batch_id, supplier, attributes, notes, created_at, updated_at, server_version, created_by_device_id, updated_by_device_id, created_by_staff_user_id, updated_by_staff_user_id, last_idempotency_key, metadata)
      values (v_batch_id, v_license_id, v_product.id, v_new_batch_stock, 0, greatest(coalesce(p_unit_cost, v_product.cost, 0), 0), greatest(coalesce(v_product.price, 0), 0), true, true, 'active', 1, p_expiry_date, p_expiry_date, case when p_expiry_date is null then null else 'CADUCIDAD_LEGAL' end, nullif(btrim(coalesce(p_manufacturer_batch_id, '')), ''), nullif(btrim(coalesce(p_supplier, '')), ''), null, 'Entrada de inventario', coalesce(p_occurred_at, now()), now(), 1, v_device_id, v_device_id, v_staff_user_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'inventory_entry')) returning * into v_saved_batch;
    else
      update public.pos_product_batches set stock = v_new_batch_stock, cost = greatest(coalesce(p_unit_cost, cost, 0), 0), supplier = coalesce(nullif(btrim(coalesce(p_supplier, '')), ''), supplier), is_active = true, status = 'active', active_stock_status = 1, updated_at = now(), server_version = server_version + 1, updated_by_device_id = v_device_id, updated_by_staff_user_id = v_staff_user_id, last_idempotency_key = p_idempotency_key, metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('source', 'inventory_entry') where license_id = v_license_id and id = v_batch.id returning * into v_saved_batch;
    end if;
    v_saved_product := private.recalculate_pos_product_projection(v_license_id, v_product.id);
    v_new_stock := v_saved_product.stock;
    v_batch_event := private.record_pos_sync_event(v_license_id, 'product_batch', v_saved_batch.id, case when v_batch.id is null then 'create' else 'update' end, v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'inventory_entry', 'product_id', v_product.id), v_saved_batch.server_version);
  else
    perform private.pharmacy_stage2_validate_receipt(
      v_license_id,v_product,v_batch,coalesce(p_metadata,'{}'::jsonb),
      p_supplier,p_manufacturer_batch_id,p_expiry_date,p_occurred_at);
    v_new_stock := v_previous_stock + p_base_quantity;
    update public.pos_products set stock = v_new_stock, active_stock_status = case when is_active then 1 else 0 end, updated_at = now(), server_version = server_version + 1, updated_by_device_id = v_device_id, updated_by_staff_user_id = v_staff_user_id, last_idempotency_key = p_idempotency_key, metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('source', 'inventory_entry') where license_id = v_license_id and id = v_product.id returning * into v_saved_product;
  end if;

  v_movement := private.record_pos_inventory_movement(v_license_id, v_product.id, case when v_uses_batches then v_saved_batch.id else null end, null, null, 'manual_in', p_base_quantity, v_previous_stock, v_new_stock, case when v_uses_batches then v_previous_batch_stock else null end, case when v_uses_batches then v_new_batch_stock else null end, coalesce(p_unit_cost, v_saved_batch.cost, v_product.cost), coalesce(nullif(btrim(p_entry_kind), ''), 'restock'), 'inventory_entry', v_device_id, v_staff_user_id, private.resolve_cash_actor_key(v_context), private.resolve_cash_actor_name(v_context), p_idempotency_key, jsonb_build_object('entryKind', coalesce(nullif(btrim(p_entry_kind), ''), 'restock'), 'inputQuantity', p_quantity, 'inputUnit', p_input_unit, 'baseQuantity', p_base_quantity, 'baseUnit', p_base_unit) || coalesce(p_metadata, '{}'::jsonb));
  v_event := private.record_pos_sync_event(v_license_id, 'product', v_saved_product.id, 'update', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'inventory_entry', 'batch_id', case when v_uses_batches then v_saved_batch.id else null end), v_saved_product.server_version);
  perform private.record_pos_sync_event(v_license_id, 'inventory_movement', v_movement.id, 'create', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'inventory_entry', 'product_id', v_product.id), v_movement.server_version::integer);
  v_response := jsonb_build_object('success', true, 'product', private.pos_product_to_jsonb(v_saved_product), 'batch', case when v_uses_batches then private.pos_product_batch_to_jsonb(v_saved_batch) else null end, 'inventory_movement', private.pos_inventory_movement_to_jsonb(v_movement), 'event', to_jsonb(v_event), 'batch_event', case when v_uses_batches then to_jsonb(v_batch_event) else null end, 'idempotency_key', p_idempotency_key);
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$function$
;

revoke all on function private.pharmacy_stage2_business(uuid) from public,anon,authenticated,service_role;
revoke all on function private.pharmacy_stage2_guard_product_upsert(jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.pharmacy_stage2_guard_batch_upsert(jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.pharmacy_stage2_authorize_import_slice(jsonb,text,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.pharmacy_stage2_validate_receipt(uuid,public.pos_products,public.pos_product_batches,jsonb,text,text,timestamptz,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.pos_complete_pharmacy_inventory_cutover(text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.pos_complete_pharmacy_inventory_cutover(text,text,text,text,text) to anon,authenticated,service_role;
revoke all on function public.pos_list_pharmacy_inventory_receipts(text,text,text,text,text,integer,timestamptz,text) from public,anon,authenticated,service_role;
grant execute on function public.pos_list_pharmacy_inventory_receipts(text,text,text,text,text,integer,timestamptz,text) to anon,authenticated,service_role;
