do $cad_6_1_pos_upsert_guard$
declare
  v_sql text;
  v_guard text;
begin
  select pg_get_functiondef('public.pos_upsert_product(text,text,text,text,jsonb,jsonb,integer,text)'::regprocedure)
  into v_sql;

  if v_sql is null then
    raise exception 'pos_upsert_product_not_found';
  end if;

  if position('INITIAL_BATCH_REQUIRED_FOR_EXPIRING_PRODUCT' in v_sql) = 0 then
    v_guard := $guard$
  if v_is_create
    and v_stock > 0
    and v_has_initial_batches is not true
    and (
      v_expiration_mode in ('STRICT','SHELF_LIFE')
      or (
        jsonb_typeof(coalesce(p_product->'batch_management', p_product->'batchManagement')) = 'boolean'
        and coalesce(p_product->'batch_management', p_product->'batchManagement') = 'true'::jsonb
      )
      or (
        jsonb_typeof(coalesce(p_product->'batch_management', p_product->'batchManagement')) = 'object'
        and (
          lower(coalesce(coalesce(p_product->'batch_management', p_product->'batchManagement')->>'enabled', '')) in ('true','1','yes','si','sí','enabled','active')
          or lower(coalesce(coalesce(p_product->'batch_management', p_product->'batchManagement')->>'batchManagement', '')) in ('true','1','yes','si','sí','enabled','active')
          or lower(coalesce(coalesce(p_product->'batch_management', p_product->'batchManagement')->>'manageBatches', '')) in ('true','1','yes','si','sí','enabled','active')
          or lower(coalesce(coalesce(p_product->'batch_management', p_product->'batchManagement')->>'useBatches', '')) in ('true','1','yes','si','sí','enabled','active')
          or lower(coalesce(coalesce(p_product->'batch_management', p_product->'batchManagement')->>'mode', '')) in ('batch','batches','lote','lotes','fefo')
        )
      )
    )
  then
    v_response := jsonb_build_object(
      'success', false,
      'code', 'INITIAL_BATCH_REQUIRED_FOR_EXPIRING_PRODUCT',
      'message', 'No se puede guardar stock inicial sin lote para productos con caducidad. Crea un lote inicial o guarda el producto sin stock.',
      'field', 'initialBatches',
      'idempotency_key', p_idempotency_key
    );
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

$guard$;

    v_sql := replace(
      v_sql,
      '  v_is_create := v_existing.id is null;' || chr(10) || chr(10) || '  if not v_is_create then',
      '  v_is_create := v_existing.id is null;' || chr(10) || v_guard || '  if not v_is_create then'
    );

    if position('INITIAL_BATCH_REQUIRED_FOR_EXPIRING_PRODUCT' in v_sql) = 0 then
      raise exception 'pos_upsert_product_guard_injection_failed';
    end if;

    execute v_sql;
  end if;
end;
$cad_6_1_pos_upsert_guard$;

comment on function public.pos_upsert_product(text,text,text,text,jsonb,jsonb,integer,text)
is 'CAD.6.1: bloquea creación cloud con stock inicial > 0 y caducidad/batch management sin lote inicial.';;
