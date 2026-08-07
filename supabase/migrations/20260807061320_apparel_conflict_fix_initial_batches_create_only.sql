do $apparel_initial_batches_create_only$
declare
  v_sql text;
  v_guard text := $guard$
  if not v_is_create and v_has_initial_batches then
    v_response := jsonb_build_object(
      'success', false,
      'code', 'INITIAL_BATCHES_CREATE_ONLY',
      'message', 'Los lotes iniciales solo se permiten al crear un producto. Edita las variantes mediante el catálogo de lotes.',
      'field', 'initialBatches',
      'idempotency_key', p_idempotency_key
    );
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

$guard$;
begin
  select pg_get_functiondef('public.pos_upsert_product(text,text,text,text,jsonb,jsonb,integer,text)'::regprocedure)
    into v_sql;

  if v_sql is null then
    raise exception 'pos_upsert_product_not_found';
  end if;

  if position('INITIAL_BATCHES_CREATE_ONLY' in v_sql) = 0 then
    v_sql := replace(
      v_sql,
      '  v_is_create := v_existing.id is null;' || chr(10),
      '  v_is_create := v_existing.id is null;' || chr(10) || v_guard
    );

    if position('INITIAL_BATCHES_CREATE_ONLY' in v_sql) = 0 then
      raise exception 'pos_upsert_product_initial_batches_guard_injection_failed';
    end if;

    execute v_sql;
  end if;
end;
$apparel_initial_batches_create_only$;

comment on function public.pos_upsert_product(text,text,text,text,jsonb,jsonb,integer,text)
is 'APPAREL-CONFLICT-FIX: p_initial_batches se acepta solo al crear; una edición fallida no puede mutar parcialmente el producto padre.';
