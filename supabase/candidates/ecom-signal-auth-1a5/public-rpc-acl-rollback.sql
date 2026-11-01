-- Exact rollback of public-rpc-acl-proposal.sql. Use only if that proposal was applied.
grant execute on function public.admin_list_staff_users(text,text,text,text) to public;
grant execute on function public.admin_create_staff_user(text,text,text,text,text,text,jsonb,text,text) to public;
grant execute on function public.admin_update_staff_user(text,text,text,uuid,text,jsonb,boolean,text,text,text) to public;
grant execute on function public.pos_get_cash_station_state(text,text,text,text) to public;
grant execute on function public.pos_admin_close_cash_session(text,text,text,text,text,text,numeric,numeric,text,text,integer,text) to public;
grant execute on function public.pos_admin_adopt_legacy_cash_session(text,text,text,text,text,integer,text) to public;
