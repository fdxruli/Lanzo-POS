do $$
declare
  v_sql text;
begin
  select pg_get_functiondef('public.pos_register_expiration_waste(text,text,text,text,text,numeric,text,text,text)'::regprocedure)
    into v_sql;
  v_sql := replace(v_sql, 'private.assert_pos_permission(v_context, ''pos'')', 'private.assert_pos_permission(v_context, ''products'')');
  execute v_sql;

  select pg_get_functiondef('public.pos_get_expiring_batches_report(text,text,text,text,integer,boolean)'::regprocedure)
    into v_sql;
  v_sql := replace(v_sql, 'private.assert_pos_permission(v_context, ''pos'')', 'private.assert_pos_permission(v_context, ''reports'')');
  execute v_sql;
end $$;

revoke all on function public.pos_register_expiration_waste(text,text,text,text,text,numeric,text,text,text) from public;
revoke all on function public.pos_get_expiring_batches_report(text,text,text,text,integer,boolean) from public;
grant execute on function public.pos_register_expiration_waste(text,text,text,text,text,numeric,text,text,text) to anon, authenticated;
grant execute on function public.pos_get_expiring_batches_report(text,text,text,text,integer,boolean) to anon, authenticated;

comment on function public.pos_register_expiration_waste(text,text,text,text,text,numeric,text,text,text)
is 'CAD.1.1: registra merma por caducidad. Requiere contexto valido y permiso products para staff; admin pasa por rol de dispositivo.';
comment on function public.pos_get_expiring_batches_report(text,text,text,text,integer,boolean)
is 'CAD.1.1: diagnostico de caducidad por lotes. Requiere contexto valido y permiso reports para staff; admin pasa por rol de dispositivo.';;
