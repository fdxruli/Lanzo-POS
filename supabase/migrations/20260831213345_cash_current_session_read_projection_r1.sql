-- CASH CURRENT SESSION READ PROJECTION R1
-- A current-cash read must not update the session row. Financial mutations
-- retain the existing recalculation/update path; this read-only projection
-- removes row-lock contention from POS reads and keeps the cash payload exact.
begin;

create or replace function private.project_pos_cash_session_totals(
  p_license_id uuid,
  p_cash_session_id text
)
returns public.pos_cash_sessions
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_entries numeric := 0;
  v_exits numeric := 0;
  v_session public.pos_cash_sessions;
begin
  select *
    into v_session
    from public.pos_cash_sessions s
   where s.license_id = p_license_id
     and s.id = p_cash_session_id
   limit 1;

  if v_session.id is null then
    raise exception 'CASH_SESSION_NOT_FOUND' using errcode = 'P0001';
  end if;

  select
    coalesce(sum(case when m.type in ('entrada', 'ajuste_entrada') and m.deleted_at is null then m.amount else 0 end), 0),
    coalesce(sum(case when m.type in ('salida', 'ajuste_salida') and m.deleted_at is null then m.amount else 0 end), 0)
  into v_entries, v_exits
  from public.pos_cash_movements m
  where m.license_id = p_license_id
    and m.cash_session_id = p_cash_session_id;

  v_session.cash_entries_total := v_entries;
  v_session.cash_exits_total := v_exits;
  v_session.expected_cash_total := greatest(
    coalesce(v_session.opening_amount, 0)
    + coalesce(v_session.cash_sales_total, 0)
    + coalesce(v_session.customer_payments_total, 0)
    + v_entries
    - v_exits,
    0
  );

  return v_session;
end;
$function$;

revoke all on function private.project_pos_cash_session_totals(uuid, text)
  from public, anon, authenticated;

do $migration$
declare
  v_signature text := 'public.pos_get_current_cash_session(text,text,text,text)';
  v_definition text;
  v_marker text := 'CASH_CURRENT_SESSION_READ_PROJECTION_R1';
  v_old_recalc text := $old$
    v_session := private.recalculate_pos_cash_session_totals(v_license_id, v_session.id, false);
$old$;
  v_new_recalc text := $new$
    -- CASH_CURRENT_SESSION_READ_PROJECTION_R1: read-only cash projection.
    v_session := private.project_pos_cash_session_totals(v_license_id, v_session.id);
$new$;
  v_old_movements text := $old_movements$
    select coalesce(jsonb_agg(private.pos_cash_movement_to_jsonb(m) order by m.created_at desc), '[]'::jsonb)
      into v_movements
      from public.pos_cash_movements m
     where m.license_id = v_license_id
       and m.cash_session_id = v_session.id
       and m.deleted_at is null;
$old_movements$;
  v_new_movements text := $new_movements$
    with limited_movement_ids as (
      select m.id
        from public.pos_cash_movements m
       where m.license_id = v_license_id
         and m.cash_session_id = v_session.id
         and m.deleted_at is null
       order by m.created_at desc
       limit 100
    )
    select coalesce(jsonb_agg(private.pos_cash_movement_to_jsonb(m) order by m.created_at desc), '[]'::jsonb)
      into v_movements
      from public.pos_cash_movements m
      join limited_movement_ids lm on lm.id = m.id;
$new_movements$;
begin
  v_definition := replace(pg_get_functiondef(v_signature::regprocedure), chr(13), '');

  if position(v_marker in v_definition) = 0 then
    if position(v_old_recalc in v_definition) = 0
       or position(v_old_movements in v_definition) = 0 then
      raise exception 'CASH_CURRENT_SESSION_READ_PROJECTION_FUNCTION_SHAPE_UNEXPECTED'
        using errcode = 'P0001';
    end if;

    v_definition := replace(v_definition, v_old_recalc, v_new_recalc);
    v_definition := replace(v_definition, v_old_movements, v_new_movements);
    execute v_definition;
  end if;

  v_definition := replace(pg_get_functiondef(v_signature::regprocedure), chr(13), '');
  if position(v_marker in v_definition) = 0
     or position('private.project_pos_cash_session_totals' in v_definition) = 0
     or position('with limited_movement_ids as' in lower(v_definition)) = 0
     or position('limit 100' in lower(v_definition)) = 0
     or position(v_old_recalc in v_definition) > 0 then
    raise exception 'CASH_CURRENT_SESSION_READ_PROJECTION_CONTRACT_MISSING'
      using errcode = 'P0001';
  end if;
end;
$migration$;

commit;
