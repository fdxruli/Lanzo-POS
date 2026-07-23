create or replace function public.cad6_count_products_test()
returns integer
language sql
set search_path to ''
as $$ select count(*)::integer from public.pos_products; $$;;
