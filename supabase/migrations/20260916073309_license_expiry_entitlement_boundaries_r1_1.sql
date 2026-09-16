-- LICENSE.LIFECYCLE.1.1
-- Close residual admission/realtime boundaries without re-declaring their
-- large, independently hardened implementations. The guarded replacement is
-- fail-fast: every target must contain exactly the known pre-contract expiry
-- predicate, or the migration aborts atomically.

create or replace function private.ecommerce_order_notifications_enabled(p_license_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_features jsonb;
  v_realtime_license_sync boolean := false;
  v_notification_center boolean := false;
  v_cloud_notifications boolean := false;
begin
  select entitlement.effective_features
  into v_features
  from private.license_entitlement_state_v1(p_license_id) entitlement
  where entitlement.is_entitled
  limit 1;

  if v_features is null then
    return false;
  end if;

  if coalesce((v_features->>'ecommerce_order_inbox')::boolean, false) is not true
     or coalesce((v_features->>'ecommerce_realtime_orders')::boolean, false) is not true then
    return false;
  end if;

  v_realtime_license_sync := coalesce((v_features->>'realtime_license_sync')::boolean, false);
  v_notification_center := case
    when v_features ? 'notification_center'
      then coalesce((v_features->>'notification_center')::boolean, false)
    else v_realtime_license_sync
  end;
  v_cloud_notifications := case
    when v_features ? 'cloud_notifications'
      then coalesce((v_features->>'cloud_notifications')::boolean, false)
    else v_realtime_license_sync
  end;

  return v_notification_center and v_cloud_notifications;
exception
  when others then
    return false;
end;
$function$;

do $migration$
declare
  v_signature text;
  v_definition text;
  v_replaced text;
  v_standard_pattern text :=
    'if\s+v_license\.status\s*<>\s*''active''\s+or\s+\(v_license\.expires_at\s+is\s+not\s+null\s+and\s+v_license\.expires_at\s*<\s*now\(\)\)\s+then';
  v_standard_replacement text :=
    E'if not exists (\n' ||
    E'    select 1\n' ||
    E'    from private.license_entitlement_state_v1(v_license.id) entitlement\n' ||
    E'    where entitlement.is_entitled\n' ||
    E'  ) then';
begin
  foreach v_signature in array array[
    'private.admin_create_staff_user_impl(uuid,uuid,text,text,text,jsonb,text)',
    'public.activate_license_on_device_unlimited(text,text,text,jsonb)',
    'public.admin_enroll_owner_on_device(text,text,text,text,text,text)',
    'public.admin_login_on_device(text,text,text,text,text,jsonb)',
    'public.staff_login_on_device_unlimited(text,text,text,jsonb,text,text)'
  ] loop
    select pg_get_functiondef(v_signature::regprocedure)
      into v_definition;

    if position('license_entitlement_state_v1' in v_definition) > 0 then
      continue;
    end if;

    v_replaced := regexp_replace(
      v_definition,
      v_standard_pattern,
      v_standard_replacement,
      'i'
    );

    if v_replaced = v_definition then
      raise exception 'LICENSE.LIFECYCLE.1.1 expected predicate not found in %', v_signature;
    end if;
    if regexp_replace(v_replaced, v_standard_pattern, '', 'i') <> v_replaced then
      raise exception 'LICENSE.LIFECYCLE.1.1 multiple predicates remain in %', v_signature;
    end if;

    execute v_replaced;
  end loop;

  v_signature := 'public.verify_staff_session_unlimited(text,text,text)';
  select pg_get_functiondef(v_signature::regprocedure)
    into v_definition;

  if position('license_entitlement_state_v1' in v_definition) = 0 then
    v_replaced := regexp_replace(
      v_definition,
      'if\s+v_license\.license_status\s*<>\s*''active''\s+or\s+\(v_license\.license_expires_at\s+is\s+not\s+null\s+and\s+v_license\.license_expires_at\s*<\s*now\(\)\)\s+then',
      E'if not exists (\n' ||
      E'    select 1\n' ||
      E'    from private.license_entitlement_state_v1(v_license.license_id) entitlement\n' ||
      E'    where entitlement.is_entitled\n' ||
      E'  ) then',
      'i'
    );

    if v_replaced = v_definition then
      raise exception 'LICENSE.LIFECYCLE.1.1 expected predicate not found in %', v_signature;
    end if;

    execute v_replaced;
  end if;
end;
$migration$;

comment on function private.ecommerce_order_notifications_enabled(uuid) is
  'LICENSE.LIFECYCLE.1.1 ecommerce realtime/order notification capability resolved from canonical effective entitlement.';
