create or replace function private.sales_final_report_source_metadata(
  p_profit_status text default null,
  p_stale boolean default false
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'mode', case when coalesce($2, false) then 'cache' else 'cloud' end,
    'official', jsonb_build_array('sales', 'cash', 'customer_credit', 'customers', 'products', 'inventory', 'cancellations', 'profit', 'audit'),
    'local', jsonb_build_array('waste'),
    'final', true,
    'phase', 'fase6f_consolidacion_reportes_finales_cloud',
    'warnings', case
      when coalesce($1, '') = 'incomplete' then jsonb_build_array('Utilidad incompleta: hay ventas o articulos sin costo confiable.')
      when coalesce($1, '') = 'estimated' then jsonb_build_array('Utilidad estimada: se usaron costos snapshot cuando no hubo movimiento de inventario con costo.')
      else jsonb_build_array()
    end
  )
$$;;
