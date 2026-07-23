create or replace function private.pos_fase6f_smoke_test()
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  return jsonb_build_object('success', true);
end;
$$;;
