-- ECOM.RPC.1.3.2 - Bloquea carrito SQL NULL y stock exacto sin snapshot.
-- Parte de la definicion instalada para conservar todos los hardening previos,
-- la firma publica, el parametro default y el adaptador de rate limit.
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
    and pg_get_function_identity_arguments(p.oid)
      = 'p_slug text, p_customer jsonb, p_items jsonb, p_idempotency_key text';

  if v_definition is null then
    raise exception 'ECOM_RPC_1_3_2_CREATE_ORDER_NOT_FOUND';
  end if;

  v_patched_definition := v_definition;

  if position('if p_items is null' in lower(v_patched_definition)) = 0 then
    v_patched_definition := replace(
      v_patched_definition,
      '  if jsonb_typeof(p_items) <> ''array'' then
    return private.ecommerce_public_error(''ECOMMERCE_EMPTY_CART'');
  end if;

  v_items_count := jsonb_array_length(p_items);

  if v_items_count <= 0 then',
      '  if p_items is null
    or jsonb_typeof(p_items) <> ''array'' then
    return private.ecommerce_public_error(''ECOMMERCE_EMPTY_CART'');
  end if;

  v_items_count := jsonb_array_length(p_items);

  if coalesce(v_items_count, 0) <= 0 then'
    );
  end if;

  if position('coalesce(v_product.stock_snapshot, 0) <= 0' in lower(v_patched_definition)) = 0 then
    v_patched_definition := replace(
      v_patched_definition,
      '    if v_product.stock_mode in (''status'', ''exact'')
      and v_product.stock_snapshot is not null
      and v_product.stock_snapshot <= 0 then
      return private.ecommerce_public_error(''ECOMMERCE_PRODUCT_NOT_AVAILABLE'');
    end if;

    if v_product.stock_mode = ''exact''
      and v_product.stock_snapshot is not null
      and v_quantity > floor(v_product.stock_snapshot) then
      return private.ecommerce_public_error(''ECOMMERCE_STOCK_LIMIT_EXCEEDED'');
    end if;',
      '    if v_product.stock_mode = ''status''
      and v_product.stock_snapshot is not null
      and v_product.stock_snapshot <= 0 then
      return private.ecommerce_public_error(''ECOMMERCE_PRODUCT_NOT_AVAILABLE'');
    end if;

    if v_product.stock_mode = ''exact''
      and coalesce(v_product.stock_snapshot, 0) <= 0 then
      return private.ecommerce_public_error(''ECOMMERCE_PRODUCT_NOT_AVAILABLE'');
    end if;

    if v_product.stock_mode = ''exact''
      and v_quantity > floor(coalesce(v_product.stock_snapshot, 0)) then
      return private.ecommerce_public_error(''ECOMMERCE_STOCK_LIMIT_EXCEEDED'');
    end if;'
    );
  end if;

  if position('if p_items is null' in lower(v_patched_definition)) = 0
    or position('if coalesce(v_items_count, 0) <= 0' in lower(v_patched_definition)) = 0
    or position('coalesce(v_product.stock_snapshot, 0) <= 0' in lower(v_patched_definition)) = 0
    or position('floor(coalesce(v_product.stock_snapshot, 0))' in lower(v_patched_definition)) = 0 then
    raise exception 'ECOM_RPC_1_3_2_PATCH_ANCHOR_NOT_FOUND';
  end if;

  if v_patched_definition <> v_definition then
    execute v_patched_definition;
  end if;
end;
$migration$;

revoke all on function public.ecommerce_create_order(text, jsonb, jsonb, text)
from public;

grant execute on function public.ecommerce_create_order(text, jsonb, jsonb, text)
to anon, authenticated;
