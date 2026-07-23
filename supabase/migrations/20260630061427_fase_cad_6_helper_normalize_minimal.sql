create schema if not exists private;

create or replace function private.pos_cad6_normalize_text(p_value text)
returns text
language sql
immutable
set search_path to ''
as $$
  select lower(coalesce(p_value, ''));
$$;;
