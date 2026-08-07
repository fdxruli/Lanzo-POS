-- Ejecutar después de aplicar las migraciones, dentro de una base de pruebas.
-- El guard debe aparecer antes de cualquier UPDATE del producto padre; por tanto
-- una respuesta INITIAL_BATCHES_CREATE_ONLY no puede incrementar server_version.
begin;

do $test$
declare
  v_definition text;
  v_wrapper_definition text;
  v_guard_position integer;
  v_is_create_position integer;
  v_update_position integer;
begin
  select pg_get_functiondef('public.pos_upsert_product_unlimited(text,text,text,text,jsonb,jsonb,integer,text)'::regprocedure)
    into v_definition;
  select pg_get_functiondef('public.pos_upsert_product(text,text,text,text,jsonb,jsonb,integer,text)'::regprocedure)
    into v_wrapper_definition;

  v_guard_position := position('INITIAL_BATCHES_CREATE_ONLY' in v_definition);
  v_is_create_position := position('v_is_create := v_existing.id is null' in v_definition);
  v_update_position := position('update public.pos_products' in lower(v_definition));

  if v_guard_position = 0 then
    raise exception 'INITIAL_BATCHES_CREATE_ONLY guard is missing';
  end if;
  if v_is_create_position = 0 or v_guard_position < v_is_create_position then
    raise exception 'INITIAL_BATCHES_CREATE_ONLY guard must follow v_is_create';
  end if;
  if v_update_position = 0 or v_guard_position > v_update_position then
    raise exception 'INITIAL_BATCHES_CREATE_ONLY guard must precede parent product update';
  end if;
  if position('pos_upsert_product_unlimited' in lower(v_wrapper_definition)) = 0 then
    raise exception 'pos_upsert_product wrapper must delegate to pos_upsert_product_unlimited';
  end if;
  if position('enforce_pos_rpc_rate_limit_v2' in lower(v_wrapper_definition)) = 0 then
    raise exception 'pos_upsert_product wrapper must retain enforce_pos_rpc_rate_limit_v2';
  end if;
end;
$test$;

rollback;
