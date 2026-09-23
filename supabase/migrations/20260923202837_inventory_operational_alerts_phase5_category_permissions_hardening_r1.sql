-- Phase 5: make Inventory a first-class cloud notification category.
-- This migration changes classification and Staff authorization only.
-- It does not mutate existing notifications, incident lifecycle rows, inventory, or financial data.

create or replace function private.default_staff_permissions()
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select jsonb_build_object(
    'pos', true,
    'orders', true,
    'products', false,
    'customers', false,
    'reports', false,
    'settings', false,
    'devices', false,
    'license', false,
    'inventory', false,
    'cash_register', true,
    'discounts', false,
    'refunds', false,
    'ecommerce', false,
    'sync', false,
    'notifications', false,
    'notifications_ecommerce', true,
    'notifications_support', true,
    'notifications_license', true,
    'notifications_inventory', true,
    'notifications_operations', true,
    'notifications_system', true,
    'support_center', false,
    'ai_agents', false
  );
$function$;

create or replace function private.normalize_staff_permissions(p_permissions jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_result jsonb := private.default_staff_permissions();
  v_key text;
  v_allowed_keys text[] := array[
    'pos', 'orders', 'products', 'customers', 'reports', 'settings',
    'devices', 'license', 'inventory', 'cash_register', 'discounts',
    'refunds', 'ecommerce', 'sync', 'notifications',
    'notifications_ecommerce', 'notifications_support',
    'notifications_license', 'notifications_inventory', 'notifications_operations',
    'notifications_system', 'support_center', 'ai_agents'
  ];
begin
  if p_permissions is null or jsonb_typeof(p_permissions) <> 'object' then
    return v_result;
  end if;

  foreach v_key in array v_allowed_keys loop
    if p_permissions ? v_key and jsonb_typeof(p_permissions -> v_key) = 'boolean' then
      v_result := jsonb_set(v_result, array[v_key], p_permissions -> v_key, true);
    end if;
  end loop;

  if p_permissions ? 'notifications_inventory' then
    if jsonb_typeof(p_permissions -> 'notifications_inventory') <> 'boolean' then
      v_result := jsonb_set(v_result, '{notifications_inventory}', 'false'::jsonb, true);
    end if;
  elsif p_permissions ? 'notifications_operations' then
    if jsonb_typeof(p_permissions -> 'notifications_operations') = 'boolean' then
      v_result := jsonb_set(
        v_result,
        '{notifications_inventory}',
        p_permissions -> 'notifications_operations',
        true
      );
    else
      v_result := jsonb_set(v_result, '{notifications_inventory}', 'false'::jsonb, true);
    end if;
  elsif p_permissions ? 'notifications'
        and jsonb_typeof(p_permissions -> 'notifications') = 'boolean' then
    v_result := jsonb_set(
      v_result,
      '{notifications_inventory}',
      p_permissions -> 'notifications',
      true
    );
  end if;

  return v_result;
end;
$function$;

create or replace function private.pos_notification_category_v1(
  p_type text,
  p_metadata jsonb default '{}'::jsonb
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_type text := lower(coalesce(nullif(btrim(p_type), ''), 'system'));
  v_metadata_category text := lower(coalesce(nullif(btrim(coalesce(p_metadata->>'category', '')), ''), ''));
begin
  if v_type = 'inventory' or v_metadata_category = 'inventory' then
    return 'inventory';
  end if;
  if v_type = 'ecommerce' or v_metadata_category = 'ecommerce' then
    return 'ecommerce';
  end if;
  if v_type = 'support' or v_metadata_category = 'support' then
    return 'support';
  end if;
  if v_type = 'license' or v_metadata_category = 'license' then
    return 'license';
  end if;
  if v_type in ('cash', 'sync', 'staff', 'operation', 'operations')
     or v_metadata_category in ('cash', 'sync', 'staff', 'operation', 'operations') then
    return 'operations';
  end if;
  return 'system';
end;
$function$;

create or replace function private.pos_notification_category_allowed_v1(
  p_type text,
  p_metadata jsonb,
  p_device_role text,
  p_staff_permissions jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_category text;
  v_permission text;
  v_permissions jsonb := coalesce(p_staff_permissions, '{}'::jsonb);
begin
  if coalesce(p_device_role, '') = 'admin' then
    return true;
  end if;
  if coalesce(p_device_role, '') <> 'staff' then
    return false;
  end if;
  if jsonb_typeof(v_permissions -> 'notifications') <> 'boolean'
     or (v_permissions->>'notifications')::boolean is not true then
    return false;
  end if;

  v_category := private.pos_notification_category_v1(p_type, p_metadata);

  if v_category = 'inventory' then
    if v_permissions ? 'notifications_inventory' then
      return jsonb_typeof(v_permissions -> 'notifications_inventory') = 'boolean'
        and (v_permissions->>'notifications_inventory')::boolean is true;
    end if;

    if v_permissions ? 'notifications_operations' then
      return jsonb_typeof(v_permissions -> 'notifications_operations') = 'boolean'
        and (v_permissions->>'notifications_operations')::boolean is true;
    end if;

    return true;
  end if;

  v_permission := case v_category
    when 'ecommerce' then 'notifications_ecommerce'
    when 'support' then 'notifications_support'
    when 'license' then 'notifications_license'
    when 'operations' then 'notifications_operations'
    else 'notifications_system'
  end;

  if not (v_permissions ? v_permission) then
    return true;
  end if;

  return jsonb_typeof(v_permissions -> v_permission) = 'boolean'
    and (v_permissions->>v_permission)::boolean is true;
exception
  when others then
    return false;
end;
$function$;

revoke all on function private.default_staff_permissions() from public, anon, authenticated;
revoke all on function private.normalize_staff_permissions(jsonb) from public, anon, authenticated;
revoke all on function private.pos_notification_category_v1(text, jsonb) from public, anon, authenticated;
revoke all on function private.pos_notification_category_allowed_v1(text, jsonb, text, jsonb) from public, anon, authenticated;

comment on function private.default_staff_permissions() is
  'Canonical Staff permission defaults; notification category flags remain behind the master notifications permission.';
comment on function private.normalize_staff_permissions(jsonb) is
  'Canonical Staff permission normalizer with Phase 5 inventory notification backward compatibility.';
comment on function private.pos_notification_category_v1(text, jsonb) is
  'Canonical cloud notification category classifier; inventory is a first-class category.';
comment on function private.pos_notification_category_allowed_v1(text, jsonb, text, jsonb) is
  'Actor category authorization with master notification gate and legacy inventory-to-operations permission inheritance.';
