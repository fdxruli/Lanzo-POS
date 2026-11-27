-- Pharmacy catalog F01: tenant-scoped active ingredients and canonical composition writes.
-- Install only after the Production preflight documented in the delivery report.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '2min';

do $preflight$
begin
  if to_regclass('public.pos_products') is null
     or to_regclass('public.pos_product_batches') is null
     or to_regclass('public.pos_sync_events') is null
     or to_regclass('public.pos_idempotency_keys') is null
     or to_regprocedure('private.validate_pos_sync_context(text,text,text,text)') is null
     or to_regprocedure('private.assert_cloud_products_sync_enabled(jsonb)') is null
     or to_regprocedure('private.assert_pos_products_write_permission(jsonb)') is null
     or to_regprocedure('private.assert_pos_products_read_permission(jsonb)') is null
     or to_regprocedure('private.insert_pos_idempotency_processing(uuid,text,text,text,text,text)') is null
     or to_regprocedure('private.complete_pos_idempotency(uuid,text,jsonb)') is null
     or to_regprocedure('private.record_pos_sync_event(uuid,text,text,text,uuid,uuid,text,jsonb,integer)') is null
     or to_regprocedure('private.normalize_pos_product_name_key(text)') is null
     or to_regprocedure('private.pos_snapshot_reference_v1(uuid,bigint)') is null
     or to_regprocedure('private.pos_sync_safe_frontier_v1(uuid)') is null
     or to_regprocedure('private.pos_sync_empty_safe_pull_v1(text,bigint,bigint,boolean)') is null
     or to_regprocedure('private.pos_snapshot_decode_cursor_v1(jsonb,uuid,bigint,text,integer,integer)') is null
     or to_regprocedure('private.pos_snapshot_scope_hash_v1(jsonb,text)') is null
     or to_regprocedure('private.pos_snapshot_build_cursor_v1(uuid,bigint,text,integer,text)') is null
     or to_regprocedure('private.pos_category_to_jsonb(public.pos_categories)') is null
     or to_regprocedure('private.pos_product_to_jsonb(public.pos_products)') is null
     or to_regprocedure('private.pos_product_batch_to_jsonb(public.pos_product_batches)') is null
     or to_regprocedure('public.enforce_pos_rpc_rate_limit_v2(text,text,text,text,text,integer,integer,integer,text,jsonb)') is null
     or to_regprocedure('public.build_pos_rpc_rate_limited_response(jsonb)') is null
     or to_regprocedure('private.pos_fin01_rate_limit_v2(text,text,text,text,text,integer,integer,integer,text,jsonb)') is null then
    raise exception 'PHARMACY_CATALOG_F01_REQUIRED_OBJECT_MISSING';
  end if;
end;
$preflight$;

create table public.pos_active_ingredients (
  id text primary key,
  license_id uuid not null references public.licenses(id) on delete cascade,
  name text not null,
  name_key text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  server_version integer not null default 1 check (server_version >= 1),
  created_by_device_id uuid null references public.license_devices(id),
  updated_by_device_id uuid null references public.license_devices(id),
  created_by_staff_user_id uuid null references public.license_staff_users(id),
  updated_by_staff_user_id uuid null references public.license_staff_users(id),
  last_idempotency_key text null,
  metadata jsonb not null default '{}'::jsonb,
  constraint pos_active_ingredients_name_not_blank check (length(btrim(name)) > 0),
  constraint pos_active_ingredients_name_key_not_blank check (length(btrim(name_key)) > 0)
);

-- Keep one canonical identity for each normalized name, including archived rows.
create unique index pos_active_ingredients_license_name_key_uidx
  on public.pos_active_ingredients (license_id, name_key);
create index pos_active_ingredients_license_updated_idx
  on public.pos_active_ingredients (license_id, updated_at, id);

alter table public.pos_active_ingredients enable row level security;
revoke all on public.pos_active_ingredients from public, anon, authenticated, service_role;

create or replace function private.pos_active_ingredient_to_jsonb(p_row public.pos_active_ingredients)
returns jsonb
language sql stable set search_path = ''
as $function$
  select jsonb_build_object(
    'id', p_row.id,
    'license_id', p_row.license_id,
    'name', p_row.name,
    'name_key', p_row.name_key,
    'is_active', p_row.is_active,
    'created_at', p_row.created_at,
    'updated_at', p_row.updated_at,
    'deleted_at', p_row.deleted_at,
    'server_version', p_row.server_version,
    'metadata', p_row.metadata
  );
$function$;

create or replace function public.pos_upsert_active_ingredient_v1(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_active_ingredient jsonb default '{}'::jsonb,
  p_expected_version integer default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_requested_id text;
  v_name text;
  v_name_key text;
  v_requested_active boolean;
  v_existing public.pos_active_ingredients;
  v_saved public.pos_active_ingredients;
  v_event public.pos_sync_events;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
  v_changed boolean := false;
  v_response jsonb;
begin
  v_context := private.validate_pos_sync_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_pos_products_write_permission(v_context);
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  if jsonb_typeof(p_active_ingredient) is distinct from 'object' then
    raise exception 'ACTIVE_INGREDIENT_OBJECT_REQUIRED' using errcode = 'P0001';
  end if;
  v_requested_id := nullif(btrim(coalesce(p_active_ingredient->>'id', '')), '');
  v_name := nullif(btrim(coalesce(p_active_ingredient->>'name', '')), '');
  if v_requested_id is null then raise exception 'ACTIVE_INGREDIENT_ID_REQUIRED' using errcode = 'P0001'; end if;
  if v_name is null then raise exception 'ACTIVE_INGREDIENT_NAME_REQUIRED' using errcode = 'P0001'; end if;
  if length(v_name) > 160 then raise exception 'ACTIVE_INGREDIENT_NAME_TOO_LONG' using errcode = 'P0001'; end if;
  v_name_key := private.normalize_pos_product_name_key(v_name);
  if nullif(btrim(coalesce(p_active_ingredient->>'name_key', p_active_ingredient->>'nameKey', '')), '') is not null
     and coalesce(p_active_ingredient->>'name_key', p_active_ingredient->>'nameKey') is distinct from v_name_key then
    raise exception 'ACTIVE_INGREDIENT_NAME_KEY_MISMATCH' using errcode = 'P0001';
  end if;
  v_requested_active := coalesce(
    nullif(p_active_ingredient->>'is_active', '')::boolean,
    nullif(p_active_ingredient->>'isActive', '')::boolean,
    true
  );

  v_inserted_idem := private.insert_pos_idempotency_processing(
    v_license_id, p_idempotency_key, 'active_ingredient.upsert.v1',
    'active_ingredient', v_requested_id, null
  );
  if not v_inserted_idem then
    select * into v_idem from public.pos_idempotency_keys
     where license_id = v_license_id and idempotency_key = p_idempotency_key limit 1;
    if v_idem.status = 'completed' and v_idem.response_payload is not null then
      return v_idem.response_payload;
    end if;
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING',
      'message', 'La operación ya está en proceso.', 'idempotency_key', p_idempotency_key);
  end if;

  select * into v_existing from public.pos_active_ingredients
   where id = v_requested_id for update;
  if v_existing.id is not null and v_existing.license_id <> v_license_id then
    v_response := jsonb_build_object('success', false, 'code', 'ACTIVE_INGREDIENT_ID_COLLISION',
      'message', 'El identificador ya pertenece a otro negocio.', 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  if v_existing.id is not null then
    if v_existing.name_key is distinct from v_name_key then
      v_response := jsonb_build_object('success', false, 'code', 'ACTIVE_INGREDIENT_IDENTITY_IMMUTABLE',
        'message', 'El nombre normalizado de una identidad registrada no se puede cambiar.',
        'idempotency_key', p_idempotency_key);
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
      return v_response;
    end if;
    if v_existing.is_active is distinct from v_requested_active then
      if p_expected_version is null then
        v_response := jsonb_build_object('success', false, 'code', 'EXPECTED_VERSION_REQUIRED',
          'message', 'La reactivación o el archivo requiere la versión vigente.', 'idempotency_key', p_idempotency_key);
        perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
        return v_response;
      end if;
      if p_expected_version <> v_existing.server_version then
        v_response := jsonb_build_object('success', false, 'code', 'VERSION_CONFLICT',
          'message', 'El principio activo cambió en otro dispositivo.',
          'active_ingredient', private.pos_active_ingredient_to_jsonb(v_existing),
          'server_version', v_existing.server_version, 'idempotency_key', p_idempotency_key);
        perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
        return v_response;
      end if;
      update public.pos_active_ingredients
         set is_active = v_requested_active,
             deleted_at = null,
             updated_at = now(),
             server_version = server_version + 1,
             updated_by_device_id = v_device_id,
             updated_by_staff_user_id = v_staff_user_id,
             last_idempotency_key = p_idempotency_key
       where id = v_requested_id and license_id = v_license_id
       returning * into v_saved;
      v_changed := true;
    else
      v_saved := v_existing;
    end if;
  else
    select * into v_existing from public.pos_active_ingredients
     where license_id = v_license_id and name_key = v_name_key for update;
    if v_existing.id is not null then
      -- The unique name constraint is authoritative under concurrent creation.
      -- Different client IDs resolve to the already registered identity.
      v_saved := v_existing;
    else
      insert into public.pos_active_ingredients (
        id, license_id, name, name_key, is_active, created_at, updated_at,
        server_version, created_by_device_id, updated_by_device_id,
        created_by_staff_user_id, updated_by_staff_user_id, last_idempotency_key, metadata
      ) values (
        v_requested_id, v_license_id, v_name, v_name_key, v_requested_active,
        coalesce(nullif(p_active_ingredient->>'created_at', '')::timestamptz, now()),
        now(), 1, v_device_id, v_device_id, v_staff_user_id, v_staff_user_id,
        p_idempotency_key, coalesce(p_active_ingredient->'metadata', '{}'::jsonb)
      ) on conflict do nothing
      returning * into v_saved;
      v_changed := v_saved.id is not null;
      if v_saved.id is null then
        select * into v_saved from public.pos_active_ingredients
         where license_id = v_license_id and name_key = v_name_key;
      end if;
      if v_saved.id is null then
        select * into v_existing from public.pos_active_ingredients where id = v_requested_id;
        if v_existing.id is not null and v_existing.license_id <> v_license_id then
          v_response := jsonb_build_object('success', false, 'code', 'ACTIVE_INGREDIENT_ID_COLLISION',
            'message', 'El identificador ya pertenece a otro negocio.', 'idempotency_key', p_idempotency_key);
          perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
          return v_response;
        end if;
        if v_existing.id is not null and v_existing.name_key is distinct from v_name_key then
          v_response := jsonb_build_object('success', false, 'code', 'ACTIVE_INGREDIENT_IDENTITY_IMMUTABLE',
            'message', 'El identificador ya corresponde a otro principio activo.', 'idempotency_key', p_idempotency_key);
          perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
          return v_response;
        end if;
        v_saved := v_existing;
      end if;
      if v_saved.id is null then raise exception 'ACTIVE_INGREDIENT_CANONICAL_RESOLUTION_FAILED'; end if;
    end if;
  end if;

  if v_changed then
    v_event := private.record_pos_sync_event(
      v_license_id, 'active_ingredient', v_saved.id,
      case when v_saved.server_version = 1 then 'create' else 'update' end,
      v_device_id, v_staff_user_id, p_idempotency_key,
      jsonb_build_object('source', 'pos_upsert_active_ingredient_v1'), v_saved.server_version
    );
  end if;
  v_response := jsonb_build_object(
    'success', true,
    'active_ingredient', private.pos_active_ingredient_to_jsonb(v_saved)
      || jsonb_build_object('client_id', v_requested_id),
    'event', case when v_event.id is not null then to_jsonb(v_event) else null end,
    'server_version', v_saved.server_version,
    'idempotency_key', p_idempotency_key
  );
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$function$;

alter function private.pos_active_ingredient_to_jsonb(public.pos_active_ingredients) owner to postgres;
alter function public.pos_upsert_active_ingredient_v1(text,text,text,text,jsonb,integer,text) owner to postgres;
revoke all on function private.pos_active_ingredient_to_jsonb(public.pos_active_ingredients) from public, anon, authenticated, service_role;
revoke all on function public.pos_upsert_active_ingredient_v1(text,text,text,text,jsonb,integer,text) from public;
grant execute on function public.pos_upsert_active_ingredient_v1(text,text,text,text,jsonb,integer,text) to anon, authenticated, service_role;

comment on table public.pos_active_ingredients is
  'Business-scoped canonical pharmacy active-ingredient identities; intentionally separate from recipe ingredients.';

create or replace function private.pharmacy_composition_write_guard_v1()
returns trigger
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_old_metadata jsonb := coalesce(OLD.metadata, '{}'::jsonb);
  v_new_metadata jsonb := coalesce(NEW.metadata, '{}'::jsonb);
  v_old_pharmacy jsonb := coalesce(OLD.metadata->'pharmacy', '{}'::jsonb);
  v_new_pharmacy jsonb := coalesce(NEW.metadata->'pharmacy', '{}'::jsonb);
  v_old_composition jsonb := OLD.metadata->'pharmacy'->'composition';
  v_composition jsonb;
  v_item jsonb;
  v_old_item jsonb;
  v_ingredient public.pos_active_ingredients;
  v_license_id uuid := NEW.license_id;
  v_id text;
  v_name text;
  v_unit text;
  v_basis_unit text;
  v_amount numeric;
  v_basis_amount numeric;
  v_active_substance text := '';
  v_concentration text := '';
  v_base text;
  v_seen_ids text[] := array[]::text[];
  v_canonical_items jsonb := '[]'::jsonb;
  v_first boolean := true;
begin
  if tg_op = 'UPDATE'
     and jsonb_typeof(v_old_composition) = 'object'
     and v_old_composition ? 'version' then
    if not (v_new_pharmacy ? 'composition') then
      if jsonb_typeof(v_new_pharmacy) is distinct from 'object' then
        raise exception 'PHARMACY_LEGACY_METADATA_INVALID' using errcode = 'P0001';
      end if;
      if NEW.active_substance is distinct from OLD.active_substance then
        raise exception 'PHARMACY_LEGACY_ACTIVE_SUBSTANCE_CONTRADICTS_COMPOSITION' using errcode = 'P0001';
      end if;
      if v_new_pharmacy ? 'concentration'
         and (v_new_pharmacy->>'concentration') is distinct from (v_old_pharmacy->>'concentration') then
        raise exception 'PHARMACY_LEGACY_CONCENTRATION_CONTRADICTS_COMPOSITION' using errcode = 'P0001';
      end if;
      v_new_pharmacy := v_old_pharmacy || v_new_pharmacy
        || jsonb_build_object('composition', v_old_composition)
        || case when v_old_pharmacy ? 'concentration'
                then jsonb_build_object('concentration', v_old_pharmacy->'concentration')
                else '{}'::jsonb end;
      NEW.metadata := v_new_metadata || jsonb_build_object('pharmacy', v_new_pharmacy);
      NEW.active_substance := coalesce(NEW.active_substance, OLD.active_substance);
      return NEW;
    end if;

    if jsonb_typeof(v_new_pharmacy->'composition') = 'null' then
      if (NEW.active_substance is not null and btrim(NEW.active_substance) <> '')
         or (v_new_pharmacy ? 'concentration'
             and coalesce(v_new_pharmacy->>'concentration', '') <> '') then
        raise exception 'PHARMACY_LEGACY_PROJECTION_CONTRADICTS_COMPOSITION_DELETE' using errcode = 'P0001';
      end if;
      NEW.active_substance := null;
      NEW.metadata := v_new_metadata || jsonb_build_object(
        'pharmacy', (v_old_pharmacy || v_new_pharmacy)
          || jsonb_build_object('composition', null, 'concentration', '')
      );
      return NEW;
    end if;
  end if;

  if not (v_new_pharmacy ? 'composition') then return NEW; end if;
  v_composition := v_new_pharmacy->'composition';
  if jsonb_typeof(v_new_pharmacy) is distinct from 'object'
     or jsonb_typeof(v_composition) is distinct from 'object'
     or v_composition->>'version' is distinct from '1'
     or jsonb_typeof(v_composition->'activeIngredients') is distinct from 'array'
     or jsonb_array_length(v_composition->'activeIngredients') < 1
     or jsonb_array_length(v_composition->'activeIngredients') > 32 then
    raise exception 'PHARMACY_COMPOSITION_INVALID' using errcode = 'P0001';
  end if;

  for v_item in select value from jsonb_array_elements(v_composition->'activeIngredients') loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or jsonb_typeof(v_item->'amount') is distinct from 'number'
       or jsonb_typeof(v_item->'basisAmount') is distinct from 'number' then
      raise exception 'PHARMACY_COMPOSITION_INVALID' using errcode = 'P0001';
    end if;
    begin
      v_amount := (v_item->>'amount')::numeric;
      v_basis_amount := (v_item->>'basisAmount')::numeric;
    exception when others then
      raise exception 'PHARMACY_COMPOSITION_AMOUNT_INVALID' using errcode = 'P0001';
    end;
    v_id := nullif(btrim(coalesce(v_item->>'activeIngredientId', v_item->>'id', '')), '');
    v_name := nullif(btrim(coalesce(v_item->>'name', v_item->>'activeIngredientName', '')), '');
    v_unit := nullif(btrim(coalesce(v_item->>'unit', '')), '');
    v_basis_unit := nullif(btrim(coalesce(v_item->>'basisUnit', '')), '');
    if v_id is null or v_name is null or v_unit is null or v_basis_unit is null
       or length(v_name) > 160 or length(v_unit) > 64 or length(v_basis_unit) > 64
       or v_amount <= 0 or v_basis_amount <= 0 then
      raise exception 'PHARMACY_COMPOSITION_INVALID' using errcode = 'P0001';
    end if;
    if v_id = any(v_seen_ids) then raise exception 'PHARMACY_COMPOSITION_DUPLICATE_ACTIVE_INGREDIENT' using errcode = 'P0001'; end if;
    v_seen_ids := array_append(v_seen_ids, v_id);
    select * into v_ingredient from public.pos_active_ingredients ai
     where ai.license_id = v_license_id and ai.id = v_id;
    if v_ingredient.id is null then
      raise exception 'PHARMACY_ACTIVE_INGREDIENT_REFERENCE_INVALID' using errcode = 'P0001';
    end if;
    if not v_ingredient.is_active and not exists (
      select 1 from jsonb_array_elements(
        case when jsonb_typeof(v_old_composition->'activeIngredients') = 'array'
             then v_old_composition->'activeIngredients' else '[]'::jsonb end
      ) old_item
      where coalesce(old_item->>'activeIngredientId', old_item->>'id') = v_id
    ) then
      raise exception 'PHARMACY_ACTIVE_INGREDIENT_ARCHIVED' using errcode = 'P0001';
    end if;

    v_canonical_items := v_canonical_items || jsonb_build_array(jsonb_build_object(
      'activeIngredientId', v_id,
      'name', v_ingredient.name,
      'amount', v_amount,
      'unit', v_unit,
      'basisAmount', v_basis_amount,
      'basisUnit', v_basis_unit
    ));
    if not v_first then
      v_active_substance := v_active_substance || ', ';
      v_concentration := v_concentration || '; ';
    end if;
    v_first := false;
    v_active_substance := v_active_substance || v_ingredient.name;
    v_base := case when v_basis_amount = 1 then v_basis_unit
                   else trim_scale(v_basis_amount)::text || ' ' || v_basis_unit end;
    v_concentration := v_concentration || trim_scale(v_amount)::text || ' ' || v_unit || ' por ' || v_base;
  end loop;

  if NEW.active_substance is not null and NEW.active_substance is distinct from v_active_substance then
    raise exception 'PHARMACY_LEGACY_ACTIVE_SUBSTANCE_CONTRADICTS_COMPOSITION' using errcode = 'P0001';
  end if;
  if v_new_pharmacy ? 'concentration'
     and (v_new_pharmacy->>'concentration') is distinct from v_concentration then
    raise exception 'PHARMACY_LEGACY_CONCENTRATION_CONTRADICTS_COMPOSITION' using errcode = 'P0001';
  end if;
  v_composition := jsonb_build_object('version', 1, 'activeIngredients', v_canonical_items);
  NEW.active_substance := v_active_substance;
  NEW.metadata := v_new_metadata || jsonb_build_object(
    'pharmacy', coalesce(OLD.metadata->'pharmacy', '{}'::jsonb)
      || v_new_pharmacy
      || jsonb_build_object('composition', v_composition, 'concentration', v_concentration)
  );
  return NEW;
end;
$function$;

alter function private.pharmacy_composition_write_guard_v1() owner to postgres;
revoke all on function private.pharmacy_composition_write_guard_v1() from public, anon, authenticated, service_role;

drop trigger if exists pos_products_pharmacy_composition_write_guard_v1 on public.pos_products;
create trigger pos_products_pharmacy_composition_write_guard_v1
before insert or update on public.pos_products
for each row execute function private.pharmacy_composition_write_guard_v1();

comment on trigger pos_products_pharmacy_composition_write_guard_v1 on public.pos_products is
  'Preserves structured pharmacy composition for legacy writes and validates canonical composition references on all product write paths.';

create or replace function private.pos_snapshot_member_at_reference_v1(
  p_license_id uuid,
  p_entity_type text,
  p_entity_id text,
  p_reference bigint
)
returns boolean language sql stable security invoker set search_path = ''
as $function$
  select
    not exists (
      select 1 from public.pos_sync_events e
       where e.license_id = p_license_id
         and (
           (p_entity_type in ('category','active_ingredient','product','product_batch','customer','customer_ledger','cash_movement')
             and e.entity_type = p_entity_type and e.entity_id = p_entity_id)
           or (p_entity_type = 'sale' and (
             (e.entity_type = 'sale' and e.entity_id = p_entity_id)
             or (e.entity_type in ('sale_item','sale_payment') and e.metadata->>'sale_id' = p_entity_id)
           ))
           or (p_entity_type = 'cash_session' and (
             (e.entity_type = 'cash_session' and e.entity_id = p_entity_id)
             or (e.entity_type = 'cash_movement' and e.metadata->>'cash_session_id' = p_entity_id)
           ))
         )
    )
    or exists (
      select 1 from public.pos_sync_events e
       where e.license_id = p_license_id and e.change_seq <= p_reference
         and (
           (p_entity_type in ('category','active_ingredient','product','product_batch','customer','customer_ledger','cash_movement')
             and e.entity_type = p_entity_type and e.entity_id = p_entity_id)
           or (p_entity_type = 'sale' and (
             (e.entity_type = 'sale' and e.entity_id = p_entity_id)
             or (e.entity_type in ('sale_item','sale_payment') and e.metadata->>'sale_id' = p_entity_id)
           ))
           or (p_entity_type = 'cash_session' and (
             (e.entity_type = 'cash_session' and e.entity_id = p_entity_id)
             or (e.entity_type = 'cash_movement' and e.metadata->>'cash_session_id' = p_entity_id)
           ))
         )
    )
$function$;

create or replace function public.pos_pull_product_catalog_snapshot_v3(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_limit integer default 500,
  p_snapshot_reference_change_seq bigint default null,
  p_page_cursor jsonb default null
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_rate jsonb;
  v_limit integer := coalesce(p_limit, 500);
  v_reference bigint;
  v_safe bigint;
  v_deferred boolean;
  v_scope_hash text;
  v_position_rank integer := 0;
  v_position_id text;
  v_categories jsonb := '[]'::jsonb;
  v_active_ingredients jsonb := '[]'::jsonb;
  v_products jsonb := '[]'::jsonb;
  v_batches jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_cursor jsonb;
begin
  if v_limit < 1 or v_limit > 500 then raise exception 'POS_SNAPSHOT_LIMIT_INVALID' using errcode = '22023'; end if;
  v_rate := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key, p_device_fingerprint, p_staff_session_token,
    'pos_pull_product_catalog_snapshot_v3', 'SYNC_PULL', 30, 600, 300,
    'RPC_RATE_LIMITED', '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate)::jsonb
      || jsonb_build_object('snapshot_contract_version', 1, 'snapshot_complete', false,
                            'has_more', false, 'sync_deferred', false);
  end if;
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_pos_products_read_permission(v_context);
  v_license_id := (v_context->>'license_id')::uuid;
  v_scope_hash := private.pos_snapshot_scope_hash_v1(v_context, 'catalog-pharmacy:keyset-reference:v1');
  select r.snapshot_reference_change_seq, r.safe_change_seq, r.sync_deferred
    into v_reference, v_safe, v_deferred
    from private.pos_snapshot_reference_v1(v_license_id, p_snapshot_reference_change_seq) r;
  select c.position_rank, c.position_id into v_position_rank, v_position_id
    from private.pos_snapshot_decode_cursor_v1(p_page_cursor, v_license_id, v_reference, v_scope_hash, 1, 4) c;

  with candidates as (
    select 1 as rank, c.id as id, private.pos_category_to_jsonb(c) as payload
      from public.pos_categories c
     where c.license_id = v_license_id
       and (v_position_rank < 1 or (v_position_rank = 1 and c.id > v_position_id))
       and private.pos_snapshot_member_at_reference_v1(v_license_id, 'category', c.id, v_reference)
    union all
    select 2, ai.id, private.pos_active_ingredient_to_jsonb(ai)
      from public.pos_active_ingredients ai
     where ai.license_id = v_license_id
       and (v_position_rank < 2 or (v_position_rank = 2 and ai.id > v_position_id))
       and private.pos_snapshot_member_at_reference_v1(v_license_id, 'active_ingredient', ai.id, v_reference)
    union all
    select 3, p.id, private.pos_product_to_jsonb(p)
      from public.pos_products p
     where p.license_id = v_license_id
       and (v_position_rank < 3 or (v_position_rank = 3 and p.id > v_position_id))
       and private.pos_snapshot_member_at_reference_v1(v_license_id, 'product', p.id, v_reference)
    union all
    select 4, b.id, private.pos_product_batch_to_jsonb(b)
      from public.pos_product_batches b
     where b.license_id = v_license_id
       and (v_position_rank < 4 or (v_position_rank = 4 and b.id > v_position_id))
       and private.pos_snapshot_member_at_reference_v1(v_license_id, 'product_batch', b.id, v_reference)
  ), lookahead as materialized (
    select * from candidates order by rank, id limit v_limit + 1
  ), delivered as materialized (
    select * from lookahead order by rank, id limit v_limit
  ), last_delivered as (
    select rank, id from delivered order by rank desc, id desc limit 1
  )
  select
    coalesce((select jsonb_agg(d.payload order by d.id) from delivered d where d.rank = 1), '[]'::jsonb),
    coalesce((select jsonb_agg(d.payload order by d.id) from delivered d where d.rank = 2), '[]'::jsonb),
    coalesce((select jsonb_agg(d.payload order by d.id) from delivered d where d.rank = 3), '[]'::jsonb),
    coalesce((select jsonb_agg(d.payload order by d.id) from delivered d where d.rank = 4), '[]'::jsonb),
    (select count(*) > v_limit from lookahead),
    (select private.pos_snapshot_build_cursor_v1(v_license_id, v_reference, v_scope_hash, l.rank, l.id) from last_delivered l)
  into v_categories, v_active_ingredients, v_products, v_batches, v_has_more, v_cursor;

  return jsonb_build_object(
    'success', true,
    'snapshot_contract', 'keyset_reference_v1',
    'snapshot_contract_version', 1,
    'snapshot_reference_change_seq', v_reference,
    'safe_change_seq', v_safe,
    'sync_deferred', v_deferred,
    'categories', v_categories,
    'active_ingredients', v_active_ingredients,
    'products', v_products,
    'batches', v_batches,
    'limit', v_limit,
    'has_more', v_has_more,
    'snapshot_complete', not v_has_more,
    'next_page_cursor', case when v_has_more then v_cursor else null end
  );
end;
$function$;

create or replace function public.pos_pull_product_catalog_changes(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_since_change_seq bigint default 0,
  p_limit integer default 500
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_rate jsonb;
  v_limit integer;
  v_since bigint := greatest(coalesce(p_since_change_seq, 0), 0);
  v_safe bigint;
  v_sync_deferred boolean;
  v_events jsonb;
  v_categories jsonb;
  v_active_ingredients jsonb;
  v_products jsonb;
  v_batches jsonb;
  v_deleted_categories jsonb;
  v_deleted_active_ingredients jsonb;
  v_deleted_products jsonb;
  v_deleted_batches jsonb;
  v_latest_returned bigint;
  v_server_latest bigint;
begin
  v_rate := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key, p_device_fingerprint, p_staff_session_token,
    'pos_pull_product_catalog_changes', 'SYNC_PULL', 60, 600, 300,
    'RPC_RATE_LIMITED', '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate)::jsonb
      || jsonb_build_object('active_ingredients', '[]'::jsonb);
  end if;
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_pos_products_read_permission(v_context);
  v_license_id := (v_context->>'license_id')::uuid;
  v_limit := least(greatest(coalesce(p_limit, 500), 1), 1000);
  select f.safe_change_seq, f.sync_deferred into v_safe, v_sync_deferred
    from private.pos_sync_safe_frontier_v1(v_license_id) f;
  if v_safe is null then raise exception 'POS_SYNC_SAFE_FRONTIER_UNAVAILABLE' using errcode = '55000'; end if;
  if v_since > v_safe then
    return private.pos_sync_empty_safe_pull_v1('product', v_since, v_safe, v_sync_deferred)
      || jsonb_build_object('active_ingredients', '[]'::jsonb,
        'deleted_ids', jsonb_build_object('categories', '[]'::jsonb, 'active_ingredients', '[]'::jsonb,
          'products', '[]'::jsonb, 'batches', '[]'::jsonb));
  end if;

  with pulled as (
    select e.* from public.pos_sync_events e
     where e.license_id = v_license_id
       and e.entity_type in ('category','active_ingredient','product','product_batch')
       and e.change_seq > v_since
       and e.change_seq <= v_safe
     order by e.change_seq asc limit v_limit
  ), category_ids as (select distinct entity_id from pulled where entity_type = 'category'),
  active_ingredient_ids as (select distinct entity_id from pulled where entity_type = 'active_ingredient'),
  product_ids as (select distinct entity_id from pulled where entity_type = 'product'),
  batch_ids as (select distinct entity_id from pulled where entity_type = 'product_batch')
  select
    coalesce((select jsonb_agg(to_jsonb(pulled) order by pulled.change_seq asc) from pulled), '[]'::jsonb),
    coalesce((select max(pulled.change_seq) from pulled), v_since),
    coalesce((select jsonb_agg(private.pos_category_to_jsonb(c) order by c.updated_at, c.id)
      from public.pos_categories c join category_ids on category_ids.entity_id = c.id
      where c.license_id = v_license_id), '[]'::jsonb),
    coalesce((select jsonb_agg(private.pos_active_ingredient_to_jsonb(ai) order by ai.updated_at, ai.id)
      from public.pos_active_ingredients ai join active_ingredient_ids on active_ingredient_ids.entity_id = ai.id
      where ai.license_id = v_license_id), '[]'::jsonb),
    coalesce((select jsonb_agg(private.pos_product_to_jsonb(p) order by p.updated_at, p.id)
      from public.pos_products p join product_ids on product_ids.entity_id = p.id
      where p.license_id = v_license_id), '[]'::jsonb),
    coalesce((select jsonb_agg(private.pos_product_batch_to_jsonb(b) order by b.updated_at, b.id)
      from public.pos_product_batches b join batch_ids on batch_ids.entity_id = b.id
      where b.license_id = v_license_id), '[]'::jsonb),
    coalesce((select jsonb_agg(c.id) from public.pos_categories c join category_ids on category_ids.entity_id = c.id where c.license_id = v_license_id and c.deleted_at is not null), '[]'::jsonb),
    coalesce((select jsonb_agg(ai.id) from public.pos_active_ingredients ai join active_ingredient_ids on active_ingredient_ids.entity_id = ai.id where ai.license_id = v_license_id and ai.deleted_at is not null), '[]'::jsonb),
    coalesce((select jsonb_agg(p.id) from public.pos_products p join product_ids on product_ids.entity_id = p.id where p.license_id = v_license_id and p.deleted_at is not null), '[]'::jsonb),
    coalesce((select jsonb_agg(b.id) from public.pos_product_batches b join batch_ids on batch_ids.entity_id = b.id where b.license_id = v_license_id and b.deleted_at is not null), '[]'::jsonb)
  into v_events, v_latest_returned, v_categories, v_active_ingredients, v_products, v_batches,
       v_deleted_categories, v_deleted_active_ingredients, v_deleted_products, v_deleted_batches;

  select coalesce(max(e.change_seq), v_since) into v_server_latest
    from public.pos_sync_events e
   where e.license_id = v_license_id
     and e.entity_type in ('category','active_ingredient','product','product_batch')
     and e.change_seq <= v_safe;
  return jsonb_build_object(
    'success', true,
    'events', v_events,
    'categories', v_categories,
    'active_ingredients', v_active_ingredients,
    'products', v_products,
    'batches', v_batches,
    'deleted_ids', jsonb_build_object('categories', v_deleted_categories,
      'active_ingredients', v_deleted_active_ingredients, 'products', v_deleted_products, 'batches', v_deleted_batches),
    'latest_change_seq', v_latest_returned,
    'server_latest_change_seq', v_server_latest,
    'has_more', v_server_latest > v_latest_returned,
    'safe_change_seq', v_safe,
    'sync_deferred', coalesce(v_sync_deferred, false)
  );
end;
$function$;

alter function private.pos_snapshot_member_at_reference_v1(uuid,text,text,bigint) owner to postgres;
alter function public.pos_pull_product_catalog_snapshot_v3(text,text,text,text,integer,bigint,jsonb) owner to postgres;
alter function public.pos_pull_product_catalog_changes(text,text,text,text,bigint,integer) owner to postgres;
revoke all on function private.pos_snapshot_member_at_reference_v1(uuid,text,text,bigint) from public, anon, authenticated, service_role;
revoke all on function public.pos_pull_product_catalog_snapshot_v3(text,text,text,text,integer,bigint,jsonb) from public;
revoke all on function public.pos_pull_product_catalog_changes(text,text,text,text,bigint,integer) from public;
grant execute on function public.pos_pull_product_catalog_snapshot_v3(text,text,text,text,integer,bigint,jsonb) to anon, authenticated, service_role;
grant execute on function public.pos_pull_product_catalog_changes(text,text,text,text,bigint,integer) to anon, authenticated, service_role;

create or replace function public.pos_snapshot_sync_contract_v1(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_requested_contract integer default 1
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_rate jsonb;
  v_snapshots_installed boolean;
  v_active_ingredient_installed boolean;
  v_capabilities jsonb := jsonb_build_array(
    'historical_credit_preservation_v1',
    'customer_projection_safe_apply_v1',
    'snapshot_keyset_reference_v1'
  );
  v_endpoints jsonb := jsonb_build_array(
    'pos_pull_product_catalog_snapshot_v2',
    'pos_pull_customers_snapshot_v3',
    'pos_pull_customer_credit_snapshot_v3',
    'pos_pull_sales_snapshot_v2',
    'pos_pull_cash_snapshot_v2'
  );
begin
  v_context := private.validate_pos_sync_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  v_license_id := (v_context->>'license_id')::uuid;
  v_rate := private.pos_fin01_rate_limit_v2(
    p_license_key, p_device_fingerprint, p_staff_session_token,
    'pos_snapshot_sync_contract_v1', 'SYNC_PULL', 60, 600, 300,
    'RPC_RATE_LIMITED', '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    raise exception 'RPC_RATE_LIMITED' using errcode = 'P0001';
  end if;
  if p_requested_contract is distinct from 1 then
    return jsonb_build_object('contract_version', 1, 'contract_kind', 'SNAPSHOT_READ_ONLY',
      'server_status', 'UPDATE_REQUIRED', 'tenant_id', v_license_id, 'required_contract', 1);
  end if;
  v_snapshots_installed :=
    to_regprocedure('public.pos_pull_product_catalog_snapshot_v2(text,text,text,text,integer,bigint,jsonb)') is not null
    and to_regprocedure('public.pos_pull_customers_snapshot_v3(text,text,text,text,integer,bigint,jsonb,jsonb)') is not null
    and to_regprocedure('public.pos_pull_customer_credit_snapshot_v3(text,text,text,text,integer,bigint,jsonb,text,jsonb)') is not null
    and to_regprocedure('public.pos_pull_sales_snapshot_v2(text,text,text,text,integer,bigint,jsonb,timestamptz,timestamptz)') is not null
    and to_regprocedure('public.pos_pull_cash_snapshot_v2(text,text,text,text,text,integer,bigint,jsonb)') is not null;
  if not v_snapshots_installed then
    return jsonb_build_object('contract_version', 1, 'contract_kind', 'SNAPSHOT_READ_ONLY',
      'server_status', 'UPDATE_REQUIRED', 'tenant_id', v_license_id,
      'reason', 'SNAPSHOT_ENDPOINT_SET_INCOMPLETE');
  end if;
  v_active_ingredient_installed :=
    to_regclass('public.pos_active_ingredients') is not null
    and to_regprocedure('public.pos_upsert_active_ingredient_v1(text,text,text,text,jsonb,integer,text)') is not null
    and to_regprocedure('public.pos_pull_product_catalog_snapshot_v3(text,text,text,text,integer,bigint,jsonb)') is not null;
  if v_active_ingredient_installed then
    v_capabilities := v_capabilities || jsonb_build_array('pharmacy_active_ingredient_catalog_v1');
    v_endpoints := v_endpoints || jsonb_build_array('pos_pull_product_catalog_snapshot_v3');
  end if;
  return jsonb_build_object(
    'contract_version', 1,
    'contract_kind', 'SNAPSHOT_READ_ONLY',
    'server_status', 'SUPPORTED',
    'tenant_id', v_license_id,
    'capabilities', v_capabilities,
    'endpoint_families', jsonb_build_array('customer_directory', 'customer_credit', 'product_catalog', 'sales', 'cash_register'),
    'endpoints', v_endpoints
  );
end;
$function$;

alter function public.pos_snapshot_sync_contract_v1(text,text,text,text,integer) owner to postgres;
revoke all on function public.pos_snapshot_sync_contract_v1(text,text,text,text,integer) from public;
grant execute on function public.pos_snapshot_sync_contract_v1(text,text,text,text,integer) to anon, authenticated;

commit;
