-- NOTIF.PERMISSIONS.1
-- Persist category-level notification permissions without breaking older POS
-- clients that only know the master `notifications` flag.

begin;

create or replace function private.default_staff_permissions()
returns jsonb
language sql
stable
set search_path to ''
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
    -- Category defaults stay true behind the master switch. This preserves the
    -- historical behavior for older clients that set notifications=true but do
    -- not yet send the new category keys.
    'notifications_ecommerce', true,
    'notifications_support', true,
    'notifications_license', true,
    'notifications_operations', true,
    'notifications_system', true,
    'support_center', false
  );
$function$;

create or replace function private.normalize_staff_permissions(p_permissions jsonb)
returns jsonb
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_result jsonb := private.default_staff_permissions();
  v_key text;
  v_allowed_keys text[] := array[
    'pos', 'orders', 'products', 'customers', 'reports', 'settings',
    'devices', 'license', 'inventory', 'cash_register', 'discounts',
    'refunds', 'ecommerce', 'sync', 'notifications',
    'notifications_ecommerce', 'notifications_support',
    'notifications_license', 'notifications_operations',
    'notifications_system', 'support_center'
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

  return v_result;
end;
$function$;

commit;
