create or replace function private.rest_inv5_safety_probe()
returns text
language sql
as $$ select 'ok'::text $$;;
