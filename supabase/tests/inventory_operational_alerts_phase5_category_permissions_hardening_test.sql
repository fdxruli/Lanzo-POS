-- Phase 5 category/permission contract tests. Read-only assertions.

do $phase5$
declare
  v_default jsonb;
  v_normalized jsonb;
  v_def text;
  v_rpc text;
begin
  v_default := private.default_staff_permissions();
  if v_default->>'notifications_inventory' <> 'true' then
    raise exception 'default notifications_inventory must be true behind the master gate';
  end if;

  v_normalized := private.normalize_staff_permissions(
    '{"notifications":true,"notifications_operations":true}'::jsonb
  );
  if v_normalized->>'notifications_inventory' <> 'true' then
    raise exception 'legacy operations=true must grant inventory';
  end if;

  v_normalized := private.normalize_staff_permissions(
    '{"notifications":true,"notifications_operations":false}'::jsonb
  );
  if v_normalized->>'notifications_inventory' <> 'false' then
    raise exception 'legacy operations=false must deny inventory';
  end if;

  v_normalized := private.normalize_staff_permissions(
    '{"notifications":true}'::jsonb
  );
  if v_normalized->>'notifications_inventory' <> 'true' then
    raise exception 'very old notifications=true must preserve inventory access';
  end if;

  v_normalized := private.normalize_staff_permissions(
    '{"notifications":true,"notifications_inventory":"invalid"}'::jsonb
  );
  if v_normalized->>'notifications_inventory' <> 'false' then
    raise exception 'malformed explicit inventory permission must fail closed';
  end if;

  if private.pos_notification_category_v1(
    'inventory',
    '{"category":"operations"}'::jsonb
  ) <> 'inventory' then
    raise exception 'inventory type must be authoritative';
  end if;

  if private.pos_notification_category_v1(
    'system',
    '{"category":"inventory"}'::jsonb
  ) <> 'inventory' then
    raise exception 'inventory metadata must resolve to inventory';
  end if;

  if private.pos_notification_category_v1('cash', '{}'::jsonb) <> 'operations'
     or private.pos_notification_category_v1('sync', '{}'::jsonb) <> 'operations'
     or private.pos_notification_category_v1('staff', '{}'::jsonb) <> 'operations'
     or private.pos_notification_category_v1('operation', '{}'::jsonb) <> 'operations'
     or private.pos_notification_category_v1('operations', '{}'::jsonb) <> 'operations' then
    raise exception 'operations category scope changed unexpectedly';
  end if;

  if not private.pos_notification_category_allowed_v1(
    'inventory','{}'::jsonb,'admin','{}'::jsonb
  ) then
    raise exception 'Admin inventory must be allowed';
  end if;

  if private.pos_notification_category_allowed_v1(
    'inventory','{}'::jsonb,'staff',
    '{"notifications":false,"notifications_inventory":true}'::jsonb
  ) then
    raise exception 'master notifications=false must deny inventory';
  end if;

  if not private.pos_notification_category_allowed_v1(
    'inventory','{}'::jsonb,'staff',
    '{"notifications":true,"notifications_inventory":true}'::jsonb
  ) then
    raise exception 'explicit inventory=true must allow';
  end if;

  if private.pos_notification_category_allowed_v1(
    'inventory','{}'::jsonb,'staff',
    '{"notifications":true,"notifications_inventory":false}'::jsonb
  ) then
    raise exception 'explicit inventory=false must deny';
  end if;

  if not private.pos_notification_category_allowed_v1(
    'inventory','{}'::jsonb,'staff',
    '{"notifications":true,"notifications_operations":true}'::jsonb
  ) then
    raise exception 'legacy operations=true must allow';
  end if;

  if private.pos_notification_category_allowed_v1(
    'inventory','{}'::jsonb,'staff',
    '{"notifications":true,"notifications_operations":false}'::jsonb
  ) then
    raise exception 'legacy operations=false must deny';
  end if;

  if not private.pos_notification_category_allowed_v1(
    'inventory','{}'::jsonb,'staff',
    '{"notifications":true}'::jsonb
  ) then
    raise exception 'very old Staff must preserve inventory access';
  end if;

  if private.pos_notification_category_allowed_v1(
    'inventory','{}'::jsonb,'staff','{}'::jsonb
  ) then
    raise exception 'missing master notifications must deny inventory';
  end if;

  if has_function_privilege(
    'anon',
    'private.pos_notification_category_v1(text,jsonb)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'private.pos_notification_category_v1(text,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'private category classifier must not be executable by client roles';
  end if;

  foreach v_rpc in array array[
    'list_pos_notifications',
    'mark_pos_notifications_seen',
    'mark_all_pos_notifications_read',
    'mark_pos_notification_read',
    'archive_pos_notification'
  ] loop
    select pg_get_functiondef(p.oid)
    into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = v_rpc
    order by p.oid desc
    limit 1;

    if v_def is null or position('pos_notification_category_allowed_v1' in v_def) = 0 then
      raise exception '% must enforce category authorization server-side', v_rpc;
    end if;
  end loop;
end
$phase5$;
