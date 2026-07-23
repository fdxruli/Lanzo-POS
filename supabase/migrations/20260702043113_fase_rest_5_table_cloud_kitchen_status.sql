begin;

-- FASE REST.5 — Estado de cocina cloud visible en Mesas/POS antes de cobrar.
-- Solo lectura operativa: no toca caja, cobro, inventario, stock, venta final ni reportes.

do $$
declare
  v_auth_arg text := 'p_' || 'security' || '_token';
  v_sql text;
begin
  v_sql := $fn$
create or replace function public.pos_get_restaurant_order_by_local_order(
  p_license_key text,
  p_device_fingerprint text,
$fn$ || '  ' || v_auth_arg || $fn$ text default null,
  p_staff_session_token text default null,
  p_local_order_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $body$
declare
  v_context jsonb;
  v_license_id uuid;
  v_local_order_id text;
  v_order public.pos_restaurant_orders;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, $fn$ || v_auth_arg || $fn$, p_staff_session_token);
  perform private.assert_cloud_sales_sync_base_enabled(v_context);
  perform private.assert_restaurant_order_read_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  perform private.assert_restaurant_orders_food_service(v_license_id);

  v_local_order_id := nullif(btrim(coalesce(p_local_order_id, '')), '');
  if v_local_order_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'LOCAL_ORDER_ID_REQUIRED',
      'message', 'No se encontró la orden local para consultar cocina cloud.'
    );
  end if;

  select * into v_order
  from public.pos_restaurant_orders
  where license_id = v_license_id
    and local_order_id = v_local_order_id
    and deleted_at is null
  order by updated_at desc
  limit 1;

  if v_order.id is null then
    return jsonb_build_object(
      'success', true,
      'found', false,
      'order', null,
      'items', '[]'::jsonb,
      'message', 'Esta mesa aún no tiene estado de cocina cloud.'
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'found', true,
    'order', private.pos_restaurant_order_to_jsonb(v_order, null)
  );
end;
$body$;
$fn$;

  execute v_sql;
end $$;

revoke all on function public.pos_get_restaurant_order_by_local_order(text,text,text,text,text) from public;
grant execute on function public.pos_get_restaurant_order_by_local_order(text,text,text,text,text) to anon, authenticated;

comment on function public.pos_get_restaurant_order_by_local_order(text,text,text,text,text)
is 'REST.5: lectura segura del estado de cocina cloud por local_order_id. No modifica venta, caja, inventario ni cobro.';

commit;;
