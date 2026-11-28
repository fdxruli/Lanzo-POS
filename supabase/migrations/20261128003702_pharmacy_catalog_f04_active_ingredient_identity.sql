-- LANZO.FARMACIA.CATALOG.F04: canonical active-ingredient identity and concurrent RPC resolution.
begin;

create or replace function private.pos_active_ingredient_name_key_f04(p_name text)
returns text
language sql immutable parallel safe strict set search_path = ''
as $function$
  select lower(btrim(regexp_replace(
    regexp_replace(normalize(p_name, NFD), U&'[\0300-\036F]', '', 'g'),
    '[[:space:]]+', ' ', 'g'
  )))
$function$;

alter function private.pos_active_ingredient_name_key_f04(text) owner to postgres;
revoke all on function private.pos_active_ingredient_name_key_f04(text) from public, anon, authenticated, service_role;

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
  v_name_key := private.pos_active_ingredient_name_key_f04(v_name);
  -- Legacy clients may send the pre-F04 key; the name is authoritative.
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

  perform pg_advisory_xact_lock(
    hashtextextended(v_license_id::text || E'\n' || v_name_key, 0)
  );

  select * into v_existing from public.pos_active_ingredients
   where id = v_requested_id for update;
  if v_existing.id is not null and v_existing.license_id <> v_license_id then
    v_response := jsonb_build_object('success', false, 'code', 'ACTIVE_INGREDIENT_ID_COLLISION',
      'message', 'El identificador ya pertenece a otro negocio.', 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  if v_existing.id is not null
     and private.pos_active_ingredient_name_key_f04(v_existing.name) is distinct from v_name_key then
    v_response := jsonb_build_object('success', false, 'code', 'ACTIVE_INGREDIENT_IDENTITY_IMMUTABLE',
      'message', 'El nombre normalizado de una identidad registrada no se puede cambiar.',
      'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  select * into v_saved
    from public.pos_active_ingredients ai
   where ai.license_id = v_license_id
     and private.pos_active_ingredient_name_key_f04(ai.name) = v_name_key
   order by (ai.id = v_requested_id) desc, (ai.name_key = v_name_key) desc,
            ai.is_active desc, ai.created_at, ai.id
   limit 1
   for update;

  if v_saved.id is not null and v_saved.id <> v_requested_id then
    -- Older clients can retry an equivalent local identity. Return the canonical
    -- row with client_id so the existing sync reconciliation can rewrite local IDs.
    null;
  elsif v_existing.id is not null then
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
      if v_existing.id is not null
         and private.pos_active_ingredient_name_key_f04(v_existing.name) is distinct from v_name_key then
        v_response := jsonb_build_object('success', false, 'code', 'ACTIVE_INGREDIENT_IDENTITY_IMMUTABLE',
          'message', 'El identificador ya corresponde a otro principio activo.', 'idempotency_key', p_idempotency_key);
        perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
        return v_response;
      end if;
      v_saved := v_existing;
    end if;
    if v_saved.id is null then raise exception 'ACTIVE_INGREDIENT_CANONICAL_RESOLUTION_FAILED'; end if;
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

alter function public.pos_upsert_active_ingredient_v1(text,text,text,text,jsonb,integer,text) owner to postgres;
revoke all on function public.pos_upsert_active_ingredient_v1(text,text,text,text,jsonb,integer,text) from public;
grant execute on function public.pos_upsert_active_ingredient_v1(text,text,text,text,jsonb,integer,text) to anon, authenticated, service_role;

-- Advertise the new authority through the existing contract so F04 clients
-- defer active-ingredient writes while an F01 server is still installed.
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
    if to_regprocedure('private.pos_active_ingredient_name_key_f04(text)') is not null then
      v_capabilities := v_capabilities || jsonb_build_array('pharmacy_active_ingredient_identity_v1');
    end if;
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

comment on function private.pos_active_ingredient_name_key_f04(text) is
  'F04 identity key: case and whitespace normalization plus canonical Unicode decomposition and accent folding.';

commit;
