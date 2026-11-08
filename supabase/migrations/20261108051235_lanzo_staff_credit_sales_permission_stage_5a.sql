-- LANZO POS Etapa 5A: permiso independiente para ventas que crean saldo.
-- This migration changes only Staff permission normalization and the shared
-- financial authorization boundary. It is canonical SQL for later review;
-- it must not be applied to Production without the owner's explicit approval.

begin;

do $permission_defaults$
declare
  v_oid oid := to_regprocedure('private.default_staff_permissions()')::oid;
  v_definition text;
  v_anchor text := $anchor$'pos', true,$anchor$;
begin
  if v_oid is null then
    raise exception 'STAFF_CREDIT_SALES_DEFAULTS_FUNCTION_MISSING' using errcode = 'P0001';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  if length(v_definition) - length(replace(v_definition, v_anchor, '')) <> length(v_anchor) then
    raise exception 'STAFF_CREDIT_SALES_DEFAULTS_CONTRACT_MISMATCH' using errcode = 'P0001';
  end if;

  -- The historical default granted POS and therefore credit sales. Keep that
  -- effective default for old callers that omit a permissions object.
  v_definition := replace(
    v_definition,
    v_anchor,
    $replacement$'pos', true,
    'pos_credit_sales', true,$replacement$
  );
  execute v_definition;
end;
$permission_defaults$;

do $permission_normalizer$
declare
  v_oid oid := to_regprocedure('private.normalize_staff_permissions(jsonb)')::oid;
  v_definition text;
  v_allowed_anchor text := $anchor$    'pos', 'orders', 'products', 'customers', 'reports', 'settings',$anchor$;
  v_allowed_replacement text := $replacement$    'pos', 'pos_credit_sales', 'orders', 'products', 'customers', 'reports', 'settings',$replacement$;
  v_loop_anchor text := $anchor$
  foreach v_key in array v_allowed_keys loop
    if p_permissions ? v_key and jsonb_typeof(p_permissions -> v_key) = 'boolean' then
      v_result := jsonb_set(v_result, array[v_key], p_permissions -> v_key, true);
    end if;
  end loop;$anchor$;
  v_loop_replacement text := $replacement$
  foreach v_key in array v_allowed_keys loop
    if p_permissions ? v_key and jsonb_typeof(p_permissions -> v_key) = 'boolean' then
      v_result := jsonb_set(v_result, array[v_key], p_permissions -> v_key, true);
    end if;
  end loop;

  -- Missing inherits only the verified legacy POS permission. Explicit false
  -- and malformed explicit values fail closed.
  if p_permissions ? 'pos_credit_sales' then
    if jsonb_typeof(p_permissions -> 'pos_credit_sales') <> 'boolean' then
      v_result := jsonb_set(v_result, '{pos_credit_sales}', 'false'::jsonb, true);
    end if;
  else
    v_result := jsonb_set(v_result, '{pos_credit_sales}', v_result->'pos', true);
  end if;

  if v_result->'pos' is distinct from 'true'::jsonb then
    v_result := jsonb_set(v_result, '{pos_credit_sales}', 'false'::jsonb, true);
  end if;$replacement$;
begin
  if v_oid is null then
    raise exception 'STAFF_CREDIT_SALES_NORMALIZER_FUNCTION_MISSING' using errcode = 'P0001';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  if length(v_definition) - length(replace(v_definition, v_allowed_anchor, '')) <> length(v_allowed_anchor)
     or length(v_definition) - length(replace(v_definition, v_loop_anchor, '')) <> length(v_loop_anchor)
     or position('pos_credit_sales' in v_definition) > 0 then
    raise exception 'STAFF_CREDIT_SALES_NORMALIZER_CONTRACT_MISMATCH' using errcode = 'P0001';
  end if;

  v_definition := replace(v_definition, v_allowed_anchor, v_allowed_replacement);
  v_definition := replace(v_definition, v_loop_anchor, v_loop_replacement);
  execute v_definition;
end;
$permission_normalizer$;

create or replace function private.assert_pos_credit_sale_permission(p_context jsonb)
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
  v_current_context jsonb;
begin
  if v_actor_type = 'admin' then
    return;
  end if;

  if v_actor_type <> 'staff' or v_license_id is null or v_staff_user_id is null then
    raise exception 'POS_PERMISSION_DENIED:pos_credit_sales' using errcode = 'P0001';
  end if;

  -- Serialize this authorization decision with an Admin's permission update.
  -- If the revocation commits first we see it; otherwise this sale commits
  -- before the revocation can update the same Staff row.
  select coalesce(s.permissions, '{}'::jsonb)
    into v_current_permissions
  from public.license_staff_users s
  where s.id = v_staff_user_id
    and s.license_id = v_license_id
    and s.is_active is true
  for share;

  if not found then
    raise exception 'POS_PERMISSION_DENIED:pos_credit_sales' using errcode = 'P0001';
  end if;

  v_current_context := p_context || jsonb_build_object(
    'actor_permissions', v_current_permissions,
    'staff_permissions', v_current_permissions
  );

  if private.has_pos_permission(v_current_context, 'pos') is not true then
    raise exception 'POS_PERMISSION_DENIED:pos_credit_sales' using errcode = 'P0001';
  end if;

  if v_current_permissions ? 'pos_credit_sales' then
    if jsonb_typeof(v_current_permissions->'pos_credit_sales') = 'boolean'
       and (v_current_permissions->>'pos_credit_sales')::boolean is true then
      return;
    end if;
  else
    -- Before this key existed, POS was sufficient. The legacy fallback is
    -- restricted to that current, verified POS grant.
    return;
  end if;

  raise exception 'POS_PERMISSION_DENIED:pos_credit_sales' using errcode = 'P0001';
end;
$function$;

revoke all on function private.assert_pos_credit_sale_permission(jsonb)
  from public, anon, authenticated, service_role;

comment on function private.assert_pos_credit_sale_permission(jsonb) is
  'Etapa 5A: checks current verified Staff POS and credit-sale grants under a row lock; completed idempotent receipts bypass this only in the shared sale authorizer.';

do $financial_authorizer$
declare
  v_oid oid := to_regprocedure(
    'private.r2b_authorize_sale_financial_request_v1(text,text,text,text,text,jsonb,jsonb,jsonb,text,text,text)'
  )::oid;
  v_definition text;
  v_anchor text := $anchor$  return jsonb_build_object(
    'license_id', v_license_id,$anchor$;
  v_insertion text := $insertion$  if p_operation_type = 'sale.credit' and v_total > v_payment_sum then
    perform private.assert_pos_credit_sale_permission(v_context);
  end if;

$insertion$;
begin
  if v_oid is null then
    raise exception 'STAFF_CREDIT_SALES_FINANCIAL_AUTHORIZER_MISSING' using errcode = 'P0001';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  if position(v_anchor in v_definition) = 0
     or position('idempotent_response' in v_definition) = 0
     or position('idempotency_processing' in v_definition) = 0
     or position('idempotent_response' in v_definition) > position(v_anchor in v_definition)
     or position('idempotency_processing' in v_definition) > position(v_anchor in v_definition)
     or position('assert_pos_credit_sale_permission' in v_definition) > 0 then
    raise exception 'STAFF_CREDIT_SALES_FINANCIAL_AUTHORIZER_CONTRACT_MISMATCH' using errcode = 'P0001';
  end if;

  if length(v_definition) - length(replace(v_definition, v_anchor, '')) <> length(v_anchor) then
    raise exception 'STAFF_CREDIT_SALES_FINANCIAL_AUTHORIZER_ANCHOR_AMBIGUOUS' using errcode = 'P0001';
  end if;

  v_definition := replace(v_definition, v_anchor, v_insertion || v_anchor);
  execute v_definition;
end;
$financial_authorizer$;

commit;
