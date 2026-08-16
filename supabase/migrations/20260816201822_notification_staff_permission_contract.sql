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

-- Server authorization already reads the current staff row on every RPC. This
-- trigger closes the remaining UI/cache window: connected devices receive a
-- generic notification invalidation as soon as an admin changes permissions or
-- deactivates a staff user, then refetch through the authoritative RPC filter.
create or replace function private.broadcast_staff_notification_access_change_v1()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if old.permissions is not distinct from new.permissions
     and old.is_active is not distinct from new.is_active then
    return new;
  end if;

  perform private.broadcast_notification_event(
    p_license_id => new.license_id,
    p_event => 'notifications_changed',
    p_reason => 'staff_notification_access_changed',
    p_metadata => jsonb_build_object(
      'scope', 'staff_notification_access',
      'access_changed', true
    )
  );

  return new;
exception
  when others then
    -- Permission persistence remains authoritative even if Realtime delivery is
    -- temporarily unavailable. The next RPC/TTL refresh still enforces access.
    return new;
end;
$function$;

revoke all on function private.broadcast_staff_notification_access_change_v1()
  from public, anon, authenticated;

drop trigger if exists trg_license_staff_notification_access_changed
  on public.license_staff_users;

create trigger trg_license_staff_notification_access_changed
after update of permissions, is_active
on public.license_staff_users
for each row
when (
  old.permissions is distinct from new.permissions
  or old.is_active is distinct from new.is_active
)
execute function private.broadcast_staff_notification_access_change_v1();

commit;