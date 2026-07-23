do $cad_6_1_report_shelf_life_warning_patch$
declare
  v_sql text;
begin
  select pg_get_functiondef('public.pos_get_expiring_batches_report(text,text,text,text,integer,boolean)'::regprocedure)
  into v_sql;

  if v_sql is null then
    raise exception 'pos_get_expiring_batches_report_not_found';
  end if;

  v_sql := replace(v_sql, 'case when p.shelf_life_expired_for_sale then', 'case when (p.shelf_life_target_date is not null and p.shelf_life_target_date < current_date) then');
  v_sql := replace(v_sql, 'where p.shelf_life_expired_for_sale or (p.requires_current_batch and p.has_current_active_batch is not true)', 'where (p.shelf_life_target_date is not null and p.shelf_life_target_date < current_date) or (p.requires_current_batch and p.has_current_active_batch is not true)');

  execute v_sql;
end;
$cad_6_1_report_shelf_life_warning_patch$;

comment on function public.pos_get_expiring_batches_report(text,text,text,text,integer,boolean)
is 'CAD.6.1: reporte extendido. Incluye lotes, productos sin lote vigente y SHELF_LIFE vencido como advertencia aunque no sea bloqueo de venta global.';;
