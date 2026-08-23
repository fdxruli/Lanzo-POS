begin;

do $$
declare
  v_license_id uuid;
  v_incident_type text;
  v_entity_id text;
  v_first jsonb;
  v_repeat jsonb;
  v_resolved jsonb;
  v_reopened jsonb;
  v_first_id uuid;
  v_reopened_id uuid;
  v_list_def text;
  v_seen_def text;
  v_staff_gen_def text;
  v_sync_gen_def text;
begin
  select l.id
  into v_license_id
  from public.licenses l
  order by l.created_at, l.id
  limit 1;

  if v_license_id is null then
    raise exception 'notification hotfix fixture license missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'pos_notification_reads'
      and c.column_name = 'seen_at'
      and c.data_type = 'timestamp with time zone'
  ) then
    raise exception '1 seen_at actor-state column missing';
  end if;

  if exists (
    select 1
    from public.pos_notification_reads r
    where (r.read_at is not null or r.archived_at is not null)
      and r.seen_at is null
  ) then
    raise exception '2 read/archive must imply seen_at after backfill';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'pos_notification_reads'
      and t.tgname = 'trg_pos_notification_reads_seen_semantics'
      and not t.tgisinternal
  ) then
    raise exception '3 seen semantics trigger missing';
  end if;

  v_list_def := pg_get_functiondef(
    'public.list_pos_notifications(text,text,text,integer,integer,boolean,text)'::regprocedure
  );
  if position('admin_user_id' in v_list_def) = 0
     or position('staff_user_id' in v_list_def) = 0
     or position('seen_at' in v_list_def) = 0
     or position('unseen_count' in v_list_def) = 0 then
    raise exception '4 list RPC lost actor-scoped seen/read semantics';
  end if;

  v_seen_def := pg_get_functiondef(
    'public.mark_pos_notifications_seen(text,text,text,text)'::regprocedure
  );
  if position('private.get_pos_notification_context' in v_seen_def) = 0
     or position('v_admin_user_id' in v_seen_def) = 0
     or position('v_staff_user_id' in v_seen_def) = 0
     or position('pos_notification_target_allowed_v1' in v_seen_def) = 0
     or position('pos_notification_category_allowed_v1' in v_seen_def) = 0
     or position('read_at' in v_seen_def) > 0 then
    raise exception '5 seen RPC must use server actor and visibility without writing read_at';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants g
    where g.table_schema = 'private'
      and g.table_name = 'pos_notification_operational_incidents'
      and g.grantee in ('anon', 'authenticated', 'PUBLIC')
  ) then
    raise exception '6 private incident table exposed';
  end if;

  -- Exercise the exact four state-based operational incident types. Repeated
  -- refresh while active must reuse one incident; resolution then recurrence
  -- must open a distinct new incident.
  foreach v_incident_type in array array[
    'device_disabled',
    'staff_disabled',
    'device_limit_reached',
    'sync_errors_active'
  ]
  loop
    v_entity_id := case
      when v_incident_type in ('device_disabled', 'staff_disabled')
        then '__notification_hotfix_test_entity__'
      else null
    end;

    delete from private.pos_notification_operational_incidents
    where license_id = v_license_id
      and incident_type = v_incident_type
      and coalesce(entity_id, '') = coalesce(v_entity_id, '');

    v_first := private.set_pos_operational_incident_state(
      v_license_id,
      v_incident_type,
      v_entity_id,
      true,
      jsonb_build_object('test_revision', 1)
    );
    v_repeat := private.set_pos_operational_incident_state(
      v_license_id,
      v_incident_type,
      v_entity_id,
      true,
      jsonb_build_object('test_revision', 2)
    );

    v_first_id := nullif(v_first->>'incident_id', '')::uuid;
    if v_first_id is null
       or coalesce((v_first->>'newly_opened')::boolean, false) is false
       or nullif(v_repeat->>'incident_id', '')::uuid <> v_first_id
       or coalesce((v_repeat->>'newly_opened')::boolean, true) is true then
      raise exception '7 unresolved % incident was duplicated', v_incident_type;
    end if;

    v_resolved := private.set_pos_operational_incident_state(
      v_license_id,
      v_incident_type,
      v_entity_id,
      false,
      jsonb_build_object('test_revision', 3)
    );
    if coalesce((v_resolved->>'resolved')::boolean, false) is false then
      raise exception '8 % incident did not resolve', v_incident_type;
    end if;

    v_reopened := private.set_pos_operational_incident_state(
      v_license_id,
      v_incident_type,
      v_entity_id,
      true,
      jsonb_build_object('test_revision', 4)
    );
    v_reopened_id := nullif(v_reopened->>'incident_id', '')::uuid;
    if v_reopened_id is null
       or v_reopened_id = v_first_id
       or coalesce((v_reopened->>'newly_opened')::boolean, false) is false then
      raise exception '9 % recurrence did not create a new incident', v_incident_type;
    end if;

    if (
      select count(*)
      from private.pos_notification_operational_incidents i
      where i.license_id = v_license_id
        and i.incident_type = v_incident_type
        and coalesce(i.entity_id, '') = coalesce(v_entity_id, '')
        and i.resolved_at is null
    ) <> 1 then
      raise exception '10 more than one open % incident exists', v_incident_type;
    end if;
  end loop;

  v_staff_gen_def := pg_get_functiondef(
    'private.generate_staff_operational_notifications(uuid)'::regprocedure
  );
  v_sync_gen_def := pg_get_functiondef(
    'private.generate_sync_operational_notifications(uuid)'::regprocedure
  );

  if position('to_char(current_date' in v_staff_gen_def) > 0
     or position('v_today' in v_staff_gen_def) > 0
     or position('set_pos_operational_incident_state' in v_staff_gen_def) = 0
     or position('device_disabled:' in v_staff_gen_def) = 0
     or position('staff_disabled:' in v_staff_gen_def) = 0
     or position('device_limit_reached:' in v_staff_gen_def) = 0 then
    raise exception '11 staff/device generator still uses daily snapshot identity';
  end if;

  if position('to_char(current_date' in v_sync_gen_def) > 0
     or position('v_today' in v_sync_gen_def) > 0
     or position('set_pos_operational_incident_state' in v_sync_gen_def) = 0
     or position('sync_errors_active:' in v_sync_gen_def) = 0 then
    raise exception '12 sync generator still uses daily snapshot identity';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'private'
      and t.relname = 'pos_notification_operational_incidents'
      and c.conname = 'pos_notification_operational_incidents_notification_license_fkey'
      and position('FOREIGN KEY (notification_id, license_id)' in pg_get_constraintdef(c.oid)) > 0
  ) then
    raise exception '13 tenant-aware incident notification FK missing';
  end if;
end;
$$;

rollback;
