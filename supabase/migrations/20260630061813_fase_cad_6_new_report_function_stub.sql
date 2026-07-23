create or replace function public.pos_get_expiring_batches_report_cad6()
returns jsonb
language sql
set search_path to ''
as $$ select jsonb_build_object('success', true); $$;;
