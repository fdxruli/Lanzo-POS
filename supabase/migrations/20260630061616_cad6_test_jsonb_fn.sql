create or replace function private.cad6_test_jsonb_fn()
returns jsonb
language sql
set search_path to ''
as $$ select jsonb_build_object('success', true); $$;;
