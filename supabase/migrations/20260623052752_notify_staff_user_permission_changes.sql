create or replace function private.notify_staff_user_permission_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_license_key text;
  v_changed_fields text[] := array[]::text[];
begin
  if old.display_name is distinct from new.display_name then
    v_changed_fields := array_append(v_changed_fields, 'display_name');
  end if;

  if old.role_name is distinct from new.role_name then
    v_changed_fields := array_append(v_changed_fields, 'role_name');
  end if;

  if old.permissions is distinct from new.permissions then
    v_changed_fields := array_append(v_changed_fields, 'permissions');
  end if;

  if old.is_active is distinct from new.is_active then
    v_changed_fields := array_append(v_changed_fields, 'is_active');
  end if;

  if array_length(v_changed_fields, 1) is null then
    return new;
  end if;

  select l.license_key
  into v_license_key
  from public.licenses l
  where l.id = new.license_id;

  if v_license_key is null then
    return new;
  end if;

  insert into public.license_events (license_key, event_type, metadata)
  values (
    v_license_key,
    'LICENSE_UPDATE',
    jsonb_strip_nulls(jsonb_build_object(
      'source', 'license_staff_users_update_trigger',
      'reason', 'STAFF_USER_UPDATED',
      'staff_user_id', new.id,
      'username', new.username,
      'display_name', new.display_name,
      'role_name', new.role_name,
      'is_active', new.is_active,
      'changed_fields', to_jsonb(v_changed_fields)
    ))
  );

  return new;
end;
$function$;

drop trigger if exists trg_notify_staff_user_permission_change on public.license_staff_users;

create trigger trg_notify_staff_user_permission_change
after update of display_name, role_name, permissions, is_active
on public.license_staff_users
for each row
execute function private.notify_staff_user_permission_change();;
