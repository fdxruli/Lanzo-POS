begin;

do $$
declare
  v_context_def text;
  v_list_def text;
  v_read_def text;
  v_all_def text;
  v_archive_def text;
  v_actor_check text;
begin
  v_context_def := pg_get_functiondef(
    'private.get_pos_notification_context(text,text,text,text,text)'::regprocedure
  );

  if position('private.validate_pos_sync_context' in v_context_def) = 0
     or position('v_device_role = ''admin''' in v_context_def) = 0
     or position('v_admin_user_id is null' in v_context_def) = 0
     or position('POS_NOTIFICATION_ADMIN_ACTOR_REQUIRED' in v_context_def) = 0 then
    raise exception '1 notification context does not fail closed for unresolved admin actor';
  end if;

  v_list_def := pg_get_functiondef(
    'public.list_pos_notifications(text,text,text,integer,integer,boolean,text)'::regprocedure
  );
  v_read_def := pg_get_functiondef(
    'public.mark_pos_notification_read(text,text,text,uuid,text)'::regprocedure
  );
  v_all_def := pg_get_functiondef(
    'public.mark_all_pos_notifications_read(text,text,text,text)'::regprocedure
  );
  v_archive_def := pg_get_functiondef(
    'public.archive_pos_notification(text,text,text,uuid,text)'::regprocedure
  );

  if position('private.get_pos_notification_context' in v_list_def) = 0
     or position('private.get_pos_notification_context' in v_read_def) = 0
     or position('private.get_pos_notification_context' in v_all_def) = 0
     or position('private.get_pos_notification_context' in v_archive_def) = 0 then
    raise exception '2 an actor-state RPC bypasses the hardened server context';
  end if;

  select pg_get_constraintdef(c.oid)
  into v_actor_check
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'pos_notification_reads'
    and c.conname = 'pos_notification_reads_actor_check';

  if v_actor_check is null
     or position('admin_user_id' in v_actor_check) = 0
     or position('staff_user_id' in v_actor_check) = 0
     or position('device_fingerprint' in v_actor_check) = 0 then
    raise exception '3 exactly-one-actor state constraint missing';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'pos_notification_reads'
      and c.conname = 'pos_notification_reads_admin_license_fkey'
  ) then
    raise exception '4 tenant-aware admin actor foreign key missing';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'pos_notification_reads'
      and c.conname = 'pos_notification_reads_staff_license_fkey'
  ) then
    raise exception '5 tenant-aware staff actor foreign key missing';
  end if;
end;
$$;

rollback;
