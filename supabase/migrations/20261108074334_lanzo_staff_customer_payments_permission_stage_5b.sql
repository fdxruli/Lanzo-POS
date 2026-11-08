-- LANZO POS Etapa 5B: permiso independiente para registrar abonos.
-- Changes only Staff permission normalization and the existing payment guard.
-- The payment ledger, idempotency key, sync envelope, and financial rules stay intact.

begin;

do $permission_defaults$
declare
  v_oid oid := to_regprocedure('private.default_staff_permissions()')::oid;
  v_definition text;
  v_anchor text := $anchor$'customers', false,$anchor$;
begin
  if v_oid is null then
    raise exception 'STAFF_CUSTOMER_PAYMENTS_DEFAULTS_FUNCTION_MISSING' using errcode = 'P0001';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  if position('customer_payments' in v_definition) > 0
     or length(v_definition) - length(replace(v_definition, v_anchor, '')) <> length(v_anchor) then
    raise exception 'STAFF_CUSTOMER_PAYMENTS_DEFAULTS_CONTRACT_MISMATCH' using errcode = 'P0001';
  end if;

  v_definition := replace(
    v_definition,
    v_anchor,
    $replacement$'customers', false,
    'customer_payments', false,$replacement$
  );
  execute v_definition;
end;
$permission_defaults$;

do $permission_normalizer$
declare
  v_oid oid := to_regprocedure('private.normalize_staff_permissions(jsonb)')::oid;
  v_definition text;
  v_allowed_anchor text := $anchor$    'pos', 'pos_credit_sales', 'orders', 'products', 'customers', 'reports', 'settings',$anchor$;
  v_allowed_replacement text := $replacement$    'pos', 'pos_credit_sales', 'orders', 'products', 'customers', 'customer_payments', 'reports', 'settings',$replacement$;
  v_legacy_anchor text := $anchor$  if v_result->'pos' is distinct from 'true'::jsonb then
    v_result := jsonb_set(v_result, '{pos_credit_sales}', 'false'::jsonb, true);
  end if;$anchor$;
  v_legacy_replacement text := $replacement$  if v_result->'pos' is distinct from 'true'::jsonb then
    v_result := jsonb_set(v_result, '{pos_credit_sales}', 'false'::jsonb, true);
  end if;

  -- Older permission maps treated Customers as the authority for payments.
  -- Preserve that grant only when the new key is absent; explicit false wins.
  if p_permissions ? 'customer_payments' then
    if jsonb_typeof(p_permissions -> 'customer_payments') <> 'boolean' then
      v_result := jsonb_set(v_result, '{customer_payments}', 'false'::jsonb, true);
    end if;
  else
    v_result := jsonb_set(v_result, '{customer_payments}', v_result->'customers', true);
  end if;

  if v_result->'customers' is distinct from 'true'::jsonb then
    v_result := jsonb_set(v_result, '{customer_payments}', 'false'::jsonb, true);
  end if;$replacement$;
begin
  if v_oid is null then
    raise exception 'STAFF_CUSTOMER_PAYMENTS_NORMALIZER_FUNCTION_MISSING' using errcode = 'P0001';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  if position('customer_payments' in v_definition) > 0
     or length(v_definition) - length(replace(v_definition, v_allowed_anchor, '')) <> length(v_allowed_anchor)
     or length(v_definition) - length(replace(v_definition, v_legacy_anchor, '')) <> length(v_legacy_anchor) then
    raise exception 'STAFF_CUSTOMER_PAYMENTS_NORMALIZER_CONTRACT_MISMATCH' using errcode = 'P0001';
  end if;

  v_definition := replace(v_definition, v_allowed_anchor, v_allowed_replacement);
  v_definition := replace(v_definition, v_legacy_anchor, v_legacy_replacement);
  execute v_definition;
end;
$permission_normalizer$;

create or replace function private.assert_customer_payment_permission(p_context jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_type text := private.resolve_pos_actor_type(p_context);
  v_license_id uuid := nullif(p_context->>'license_id', '')::uuid;
  v_staff_user_id uuid := nullif(p_context->>'staff_user_id', '')::uuid;
  v_current_permissions jsonb;
begin
  if v_actor_type = 'admin' then
    return;
  end if;

  if v_actor_type <> 'staff' or v_license_id is null or v_staff_user_id is null then
    raise exception 'POS_PERMISSION_DENIED:customer_payments' using errcode = 'P0001';
  end if;

  -- Serialize the current authorization with Admin permission updates.
  -- Whichever transaction locks the Staff row first commits first.
  select coalesce(s.permissions, '{}'::jsonb)
    into v_current_permissions
  from public.license_staff_users s
  where s.id = v_staff_user_id
    and s.license_id = v_license_id
    and s.is_active is true
  for share;

  if not found then
    raise exception 'POS_PERMISSION_DENIED:customer_payments' using errcode = 'P0001';
  end if;

  if v_current_permissions->'customers' is distinct from 'true'::jsonb then
    raise exception 'POS_PERMISSION_DENIED:customers' using errcode = 'P0001';
  end if;

  if v_current_permissions ? 'customer_payments' then
    if jsonb_typeof(v_current_permissions->'customer_payments') = 'boolean'
       and v_current_permissions->'customer_payments' = 'true'::jsonb then
      return;
    end if;
  else
    -- Legacy permission maps with Customers keep their previous payment access.
    return;
  end if;

  raise exception 'POS_PERMISSION_DENIED:customer_payments' using errcode = 'P0001';
end;
$function$;

alter function private.assert_customer_payment_permission(jsonb) owner to postgres;
revoke all on function private.assert_customer_payment_permission(jsonb)
  from public, anon, authenticated, service_role;

comment on function private.assert_customer_payment_permission(jsonb) is
  'Etapa 5B: requires current Staff Customers and customer_payments grants under a row lock; completed payment idempotency responses bypass this guard.';

do $payment_route_preflight$
declare
  v_payment_core oid := to_regprocedure(
    'public.pos_record_customer_payment_unlimited(text,text,text,text,text,numeric,text,text,text,jsonb,text)'
  )::oid;
  v_payment_v2 oid := to_regprocedure(
    'public.pos_record_customer_payment_v2(text,text,text,text,text,numeric,text,text,text,jsonb,text,jsonb)'
  )::oid;
  v_legacy record;
  v_legacy_sha256 text;
  v_actual_sha256 text;
begin
  if v_payment_core is null or v_payment_v2 is null then
    raise exception 'STAFF_CUSTOMER_PAYMENTS_RPC_CONTRACT_MISSING' using errcode = 'P0001';
  end if;

  select encode(
    extensions.digest(
      convert_to(replace(pg_catalog.pg_get_functiondef(v_payment_core), E'\r', ''), 'UTF8'),
      'sha256'
    ),
    'hex'
  ) into v_actual_sha256;
  if v_actual_sha256 is distinct from 'd27598d86ea58a94cd1d86aa3e8e30a183fc760e7773d0da790a484a456388bd' then
    raise exception 'STAFF_CUSTOMER_PAYMENTS_PAYMENT_CORE_CONTRACT_MISMATCH' using errcode = 'P0001';
  end if;

  if has_function_privilege('anon', v_payment_core, 'EXECUTE')
     or has_function_privilege('authenticated', v_payment_core, 'EXECUTE') then
    raise exception 'STAFF_CUSTOMER_PAYMENTS_INTERNAL_CORE_EXPOSED' using errcode = 'P0001';
  end if;
  if not has_function_privilege('anon', v_payment_v2, 'EXECUTE')
     or not has_function_privilege('authenticated', v_payment_v2, 'EXECUTE') then
    raise exception 'STAFF_CUSTOMER_PAYMENTS_V2_GRANTS_MISSING' using errcode = 'P0001';
  end if;

  -- The legacy public RPC is still callable by old clients. Permit only its
  -- verified rate-limited wrapper, which delegates to the same protected
  -- unlimited payment core. Other callable overloads or altered wrappers
  -- must fail closed; do not change any existing EXECUTE grants.
  for v_legacy in
    select p.oid
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'pos_record_customer_payment'
  loop
    if has_function_privilege('anon', v_legacy.oid, 'EXECUTE')
       or has_function_privilege('authenticated', v_legacy.oid, 'EXECUTE') then
      if v_legacy.oid is distinct from to_regprocedure(
        'public.pos_record_customer_payment(text,text,text,text,text,numeric,text,text,text,jsonb,text)'
      )::oid then
        raise exception 'STAFF_CUSTOMER_PAYMENTS_LEGACY_RPC_ROUTE_MISMATCH' using errcode = 'P0001';
      end if;

      -- Pinned definition includes enforce_pos_rpc_rate_limit_v2 and a direct
      -- call to public.pos_record_customer_payment_unlimited, not another
      -- unguarded path. Stop on any change to that financial boundary.
      select encode(
        extensions.digest(
          convert_to(replace(pg_catalog.pg_get_functiondef(v_legacy.oid), E'\r', ''), 'UTF8'),
          'sha256'
        ),
        'hex'
      ) into v_legacy_sha256;
      if v_legacy_sha256 is distinct from
         'da5ca36d00b29a3163907fed17786a7853805e79561ee4da173bd8681c90300c' then
        raise exception 'STAFF_CUSTOMER_PAYMENTS_LEGACY_RPC_CONTRACT_MISMATCH' using errcode = 'P0001';
      end if;
    end if;
  end loop;
end;
$payment_route_preflight$;

do $payment_core_guard$
declare
  v_oid oid := to_regprocedure(
    'public.pos_record_customer_payment_unlimited(text,text,text,text,text,numeric,text,text,text,jsonb,text)'
  )::oid;
  v_definition text;
  v_anchor text := $anchor$  select * into v_customer
  from public.pos_customers c
  where c.license_id = v_license_id
    and c.id = p_customer_id
  for update;$anchor$;
  v_insertion text := $insertion$  perform private.assert_customer_payment_permission(v_context);

$insertion$;
  v_completed_position integer;
  v_processing_position integer;
  v_guard_position integer;
  v_anchor_position integer;
begin
  if v_oid is null then
    raise exception 'STAFF_CUSTOMER_PAYMENTS_PAYMENT_CORE_MISSING' using errcode = 'P0001';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  if position('private.assert_customer_payment_permission' in v_definition) > 0
     or length(v_definition) - length(replace(v_definition, v_anchor, '')) <> length(v_anchor) then
    raise exception 'STAFF_CUSTOMER_PAYMENTS_PAYMENT_CORE_ANCHOR_MISMATCH' using errcode = 'P0001';
  end if;

  v_completed_position := position($needle$if v_idem.status = 'completed' and v_idem.response_payload is not null then$needle$ in v_definition);
  v_processing_position := position($needle$return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING'$needle$ in v_definition);
  v_anchor_position := position(v_anchor in v_definition);
  if v_completed_position = 0 or v_processing_position = 0
     or v_completed_position > v_anchor_position or v_processing_position > v_anchor_position then
    raise exception 'STAFF_CUSTOMER_PAYMENTS_IDEMPOTENCY_BOUNDARY_MISMATCH' using errcode = 'P0001';
  end if;

  v_definition := replace(v_definition, v_anchor, v_insertion || v_anchor);
  execute v_definition;

  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  v_guard_position := position('perform private.assert_customer_payment_permission(v_context);' in v_definition);
  v_anchor_position := position(v_anchor in v_definition);
  if v_guard_position = 0 or v_guard_position >= v_anchor_position
     or length(v_definition) - length(replace(v_definition, 'perform private.assert_customer_payment_permission(v_context);', ''))
       <> length('perform private.assert_customer_payment_permission(v_context);') then
    raise exception 'STAFF_CUSTOMER_PAYMENTS_PAYMENT_CORE_POSTFLIGHT_MISMATCH' using errcode = 'P0001';
  end if;
end;
$payment_core_guard$;

do $payment_permission_postflight$
declare
  v_owner text;
  v_config text[];
  v_v2 oid := to_regprocedure(
    'public.pos_record_customer_payment_v2(text,text,text,text,text,numeric,text,text,text,jsonb,text,jsonb)'
  )::oid;
begin
  select pg_catalog.pg_get_userbyid(p.proowner), p.proconfig
    into v_owner, v_config
  from pg_catalog.pg_proc p
  where p.oid = 'private.assert_customer_payment_permission(jsonb)'::regprocedure;

  if v_owner is distinct from 'postgres'
     or not coalesce(v_config @> array['search_path=""']::text[], false)
     or has_function_privilege('anon', 'private.assert_customer_payment_permission(jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.assert_customer_payment_permission(jsonb)', 'EXECUTE')
     or not has_function_privilege('anon', v_v2, 'EXECUTE')
     or not has_function_privilege('authenticated', v_v2, 'EXECUTE') then
    raise exception 'STAFF_CUSTOMER_PAYMENTS_SECURITY_POSTFLIGHT_MISMATCH' using errcode = 'P0001';
  end if;
end;
$payment_permission_postflight$;

commit;
