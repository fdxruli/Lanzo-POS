-- ECOM.RPC.1.3.1 - Guard complementario para quantity ausente/null.
-- No edita la migracion ya aplicada. Parte de la definicion instalada y
-- agrega exclusivamente la validacion explicita de NULL al RPC publico.
do $migration$
declare
  v_definition text;
  v_patched_definition text;
begin
  select pg_get_functiondef(p.oid)
  into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'ecommerce_create_order'
    and pg_get_function_identity_arguments(p.oid) = 'p_slug text, p_customer jsonb, p_items jsonb, p_idempotency_key text';

  if v_definition is null then
    raise exception 'ECOM_RPC_1_3_1_CREATE_ORDER_NOT_FOUND';
  end if;

  if position('if v_quantity is null' in lower(v_definition)) > 0 then
    return;
  end if;

  v_patched_definition := replace(
    v_definition,
    '    if v_quantity::text in (''NaN'', ''Infinity'', ''-Infinity'')',
    '    if v_quantity is null
      or v_quantity::text in (''NaN'', ''Infinity'', ''-Infinity'')'
  );

  if v_patched_definition = v_definition then
    raise exception 'ECOM_RPC_1_3_1_PATCH_ANCHOR_NOT_FOUND';
  end if;

  execute v_patched_definition;
end;
$migration$;

revoke all on function public.ecommerce_create_order(text, jsonb, jsonb, text)
from public;

grant execute on function public.ecommerce_create_order(text, jsonb, jsonb, text)
to anon, authenticated;
