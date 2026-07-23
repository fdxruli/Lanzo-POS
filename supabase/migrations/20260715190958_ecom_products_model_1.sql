create extension if not exists http with schema extensions;

do $migration$
declare
  v_response extensions.http_response;
  v_sql text;
begin
  select * into v_response
  from extensions.http_get('https://raw.githubusercontent.com/fdxruli/Lanzo-POS/ba92582c45f88582e01294137b65411efe80b642/supabase/migrations/20260715190000_ecom_products_model_1.sql');

  if v_response.status <> 200 then
    raise exception 'ECOM_MODEL1_FETCH_FAILED: HTTP %', v_response.status;
  end if;

  v_sql := v_response.content;
  if encode(extensions.digest(v_sql, 'sha256'), 'hex')
     <> '1d434996aa3dd79c7e98a2857f475fa4a6c760aed081df877cb238d161205091' then
    raise exception 'ECOM_MODEL1_HASH_MISMATCH';
  end if;

  execute v_sql;
end;
$migration$;

drop extension if exists http;;
