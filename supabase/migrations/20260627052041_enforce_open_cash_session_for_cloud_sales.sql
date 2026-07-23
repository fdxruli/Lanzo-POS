do $$
declare
  v_sql text;
  v_old text;
  v_new text;
begin
  -- 1) Ventas cloud cashier / inventory: exigir turno abierto para cualquier venta,
  -- no solo cuando exista componente de efectivo. La función inventory llama a esta core.
  select pg_get_functiondef(p.oid)
  into v_sql
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'pos_create_cloud_sale_cashier'
  limit 1;

  if v_sql is null then
    raise exception 'FUNCTION_NOT_FOUND: public.pos_create_cloud_sale_cashier';
  end if;

  v_old := $old_cashier$
  if v_has_cash then
    perform private.assert_cash_permission(v_context);
  end if;

  if v_has_cash then
    if p_cash_session_id is not null and btrim(p_cash_session_id) <> '' then
      v_cash_session_candidate := p_cash_session_id;
    else
      select s.id into v_cash_session_candidate
      from public.pos_cash_sessions s
      where s.license_id = v_license_id
        and s.actor_key = v_actor_key
        and s.status = 'open'
        and s.deleted_at is null
      order by s.opened_at desc
      limit 1;
    end if;

    if v_cash_session_candidate is null then
      raise exception 'CLOUD_CASH_SESSION_REQUIRED' using errcode = 'P0001';
    end if;
  else
    if p_cash_session_id is not null and btrim(p_cash_session_id) <> '' then
      v_cash_session_candidate := p_cash_session_id;
    else
      select s.id into v_cash_session_candidate
      from public.pos_cash_sessions s
      where s.license_id = v_license_id
        and s.actor_key = v_actor_key
        and s.status = 'open'
        and s.deleted_at is null
      order by s.opened_at desc
      limit 1;
    end if;
  end if;
$old_cashier$;

  v_new := $new_cashier$
  if v_has_cash then
    perform private.assert_cash_permission(v_context);
  end if;

  if p_cash_session_id is not null and btrim(p_cash_session_id) <> '' then
    v_cash_session_candidate := p_cash_session_id;
  else
    select s.id into v_cash_session_candidate
    from public.pos_cash_sessions s
    where s.license_id = v_license_id
      and s.actor_key = v_actor_key
      and s.status = 'open'
      and s.deleted_at is null
    order by s.opened_at desc
    limit 1;
  end if;

  if v_cash_session_candidate is null then
    raise exception 'CLOUD_CASH_SESSION_REQUIRED' using errcode = 'P0001';
  end if;
$new_cashier$;

  if position(v_old in v_sql) = 0 then
    raise exception 'PATCH_ANCHOR_NOT_FOUND: cashier_session_resolution';
  end if;

  v_sql := replace(v_sql, v_old, v_new);
  execute v_sql;

  -- 2) Ventas fiadas cloud: exigir turno abierto también para fiado puro,
  -- fiado con transferencia/tarjeta y fiado con efectivo. Además, enlazar la venta al turno.
  select pg_get_functiondef(p.oid)
  into v_sql
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'pos_create_cloud_sale_credit'
  limit 1;

  if v_sql is null then
    raise exception 'FUNCTION_NOT_FOUND: public.pos_create_cloud_sale_credit';
  end if;

  v_old := $old_credit_session$
  if v_cash_component > 0 then
    perform private.assert_cash_permission(v_context);
    if p_cash_session_id is not null and btrim(p_cash_session_id) <> '' then
      v_cash_session_candidate := p_cash_session_id;
    else
      select s.id into v_cash_session_candidate
      from public.pos_cash_sessions s
      where s.license_id = v_license_id and s.actor_key = v_actor_key and s.status = 'open' and s.deleted_at is null
      order by s.opened_at desc
      limit 1;
    end if;
    if v_cash_session_candidate is null then raise exception 'CLOUD_CASH_SESSION_REQUIRED' using errcode = 'P0001'; end if;

    select * into v_cash_session
    from public.pos_cash_sessions s
    where s.license_id = v_license_id and s.id = v_cash_session_candidate and s.deleted_at is null
    for update;

    if v_cash_session.id is null then raise exception 'CASH_SESSION_NOT_FOUND' using errcode = 'P0001'; end if;
    if v_cash_session.status <> 'open' then raise exception 'CASH_SESSION_NOT_OPEN' using errcode = 'P0001'; end if;
    if v_cash_session.actor_key <> v_actor_key then raise exception 'CASH_SESSION_FORBIDDEN' using errcode = 'P0001'; end if;
  end if;
$old_credit_session$;

  v_new := $new_credit_session$
  if v_cash_component > 0 then
    perform private.assert_cash_permission(v_context);
  end if;

  if p_cash_session_id is not null and btrim(p_cash_session_id) <> '' then
    v_cash_session_candidate := p_cash_session_id;
  else
    select s.id into v_cash_session_candidate
    from public.pos_cash_sessions s
    where s.license_id = v_license_id and s.actor_key = v_actor_key and s.status = 'open' and s.deleted_at is null
    order by s.opened_at desc
    limit 1;
  end if;
  if v_cash_session_candidate is null then raise exception 'CLOUD_CASH_SESSION_REQUIRED' using errcode = 'P0001'; end if;

  select * into v_cash_session
  from public.pos_cash_sessions s
  where s.license_id = v_license_id and s.id = v_cash_session_candidate and s.deleted_at is null
  for update;

  if v_cash_session.id is null then raise exception 'CASH_SESSION_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_cash_session.status <> 'open' then raise exception 'CASH_SESSION_NOT_OPEN' using errcode = 'P0001'; end if;
  if v_cash_session.actor_key <> v_actor_key then raise exception 'CASH_SESSION_FORBIDDEN' using errcode = 'P0001'; end if;
$new_credit_session$;

  if position(v_old in v_sql) = 0 then
    raise exception 'PATCH_ANCHOR_NOT_FOUND: credit_session_resolution';
  end if;
  v_sql := replace(v_sql, v_old, v_new);

  v_old := '    case when v_cash_component > 0 then v_cash_session.id else null end, null, null,';
  v_new := '    v_cash_session.id, null, null,';
  if position(v_old in v_sql) = 0 then
    raise exception 'PATCH_ANCHOR_NOT_FOUND: credit_insert_cash_session';
  end if;
  v_sql := replace(v_sql, v_old, v_new);

  v_old := $old_credit_final_update$
  end if;

  update public.pos_sales
  set cash_session_id = case when v_cash_component > 0 then v_cash_session.id else null end,
$old_credit_final_update$;

  v_new := $new_credit_final_update$
  end if;

  update public.pos_cash_sessions s
  set sales_total = coalesce(s.sales_total, 0) + v_total,
      sales_count = coalesce(s.sales_count, 0) + 1,
      non_cash_sales_total = coalesce(s.non_cash_sales_total, 0) + v_non_cash_component,
      updated_at = now(),
      server_version = s.server_version + 1,
      last_idempotency_key = v_idempotency_key
  where s.license_id = v_license_id and s.id = v_cash_session.id
  returning * into v_cash_session;

  perform private.record_pos_sale_audit_event(
    v_license_id,
    v_sale.id,
    'sale.credit_cash_session_totals_updated',
    v_device_id,
    v_staff_user_id,
    v_actor_name,
    jsonb_build_object(
      'sale_id', v_sale.id,
      'folio', v_cloud_folio,
      'cash_session_id', v_cash_session.id,
      'sales_total_delta', v_total,
      'non_cash_delta', v_non_cash_component,
      'idempotency_key', v_idempotency_key
    )
  );

  perform private.record_pos_sync_event(
    v_license_id,
    'cash_session',
    v_cash_session.id,
    'update',
    v_device_id,
    v_staff_user_id,
    v_idempotency_key,
    jsonb_build_object('sale_id', v_sale.id, 'reason', 'sale_credit_turn_totals_updated'),
    v_cash_session.server_version
  );

  update public.pos_sales
  set cash_session_id = v_cash_session.id,
$new_credit_final_update$;

  if position(v_old in v_sql) = 0 then
    raise exception 'PATCH_ANCHOR_NOT_FOUND: credit_turn_totals_update';
  end if;
  v_sql := replace(v_sql, v_old, v_new);

  execute v_sql;
end $$;;
