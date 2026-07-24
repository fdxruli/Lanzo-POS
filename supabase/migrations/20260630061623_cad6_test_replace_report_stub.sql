create or replace function private.cad6_report_stub()
returns jsonb
language plpgsql
set search_path to ''
as $$
begin
  return jsonb_build_object('success', true, 'items', '[]'::jsonb);
end;
$$;;
