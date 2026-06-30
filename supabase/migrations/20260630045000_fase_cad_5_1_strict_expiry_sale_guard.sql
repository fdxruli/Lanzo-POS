-- FASE CAD.5.1 — Blindaje de venta para productos STRICT sin lote vigente.
-- Objetivo: mantener SHELF_LIFE como advertencia/rotacion y normalizar el rechazo
-- cloud de productos STRICT cuando el lote esta vencido o no existe lote vigente.

create schema if not exists private;

comment on function private.is_pos_batch_expired_for_sale(timestamptz)
is 'CAD.5.1: considera vencido solo si expiry_date::date < current_date; un lote que vence hoy sigue vendible hoy. SHELF_LIFE no usa esta funcion como bloqueo obligatorio.';

do $cad_5_1$
declare
  v_sql text;
begin
  select pg_get_functiondef('private.resolve_sale_inventory_allocations(uuid,jsonb,text)'::regprocedure)
  into v_sql;

  if v_sql is null then
    raise exception 'resolve_sale_inventory_allocations_not_found';
  end if;

  v_sql := replace(v_sql, '''EXPIRED_BATCH_BLOCKED''', '''STRICT_EXPIRED_BATCH_BLOCKED''');
  v_sql := replace(v_sql, '''INSUFFICIENT_NON_EXPIRED_STOCK''', '''STRICT_EXPIRED_BATCH_BLOCKED''');
  v_sql := replace(
    v_sql,
    '''Este lote ya esta vencido y no puede venderse.''',
    '''Este producto no tiene lote vigente disponible. Revisa Caducidad/Merma antes de venderlo.'''
  );
  v_sql := replace(
    v_sql,
    '''No hay stock vigente suficiente para completar esta venta.''',
    '''Este producto no tiene lote vigente disponible. Revisa Caducidad/Merma antes de venderlo.'''
  );

  execute v_sql;
end;
$cad_5_1$;

comment on function private.resolve_sale_inventory_allocations(uuid,jsonb,text)
is 'CAD.5.1: preflight transaccional de inventario cloud. En STRICT no asigna lotes vencidos y devuelve STRICT_EXPIRED_BATCH_BLOCKED cuando no hay lote vigente disponible. SHELF_LIFE permanece como monitoreo/rotacion, no bloqueo obligatorio.';
