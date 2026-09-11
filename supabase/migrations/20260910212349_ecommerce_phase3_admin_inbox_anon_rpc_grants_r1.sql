-- ECOM.PHASE3.ADMIN.INBOX.ANON.RPC.GRANTS.R1
--
-- The Lanzo desktop client deliberately uses the Supabase anon transport role
-- and performs authorization inside these SECURITY DEFINER RPCs with its own
-- license, device, security-token and staff/admin-session contract.

do $verify$
declare
  v_signature regprocedure;
begin
  foreach v_signature in array array[
    'public.ecommerce_admin_list_orders(text,text,text,text,text,integer,integer)'::regprocedure,
    'public.ecommerce_admin_accept_order(text,text,text,uuid,text)'::regprocedure
  ]
  loop
    if not exists (
      select 1
      from pg_proc p
      where p.oid = v_signature
        and p.prosecdef is true
        and position($needle$SET search_path TO ''$needle$ in pg_get_functiondef(p.oid)) > 0
    ) then
      raise exception 'ECOMMERCE_ADMIN_INBOX_RPC_SECURITY_CONTRACT_MISSING: %', v_signature;
    end if;
  end loop;
end;
$verify$;

revoke all on function public.ecommerce_admin_list_orders(text, text, text, text, text, integer, integer) from public;
revoke all on function public.ecommerce_admin_accept_order(text, text, text, uuid, text) from public;

grant execute on function public.ecommerce_admin_list_orders(text, text, text, text, text, integer, integer) to anon, authenticated;
grant execute on function public.ecommerce_admin_accept_order(text, text, text, uuid, text) to anon, authenticated;

comment on function public.ecommerce_admin_list_orders(text, text, text, text, text, integer, integer) is
  'Administrative inbox RPC. Authorization is enforced internally by private.ecommerce_orders_authorize_v1; anon transport role is intentionally supported.';
comment on function public.ecommerce_admin_accept_order(text, text, text, uuid, text) is
  'Administrative acceptance RPC. Authorization is enforced internally by private.ecommerce_orders_authorize_v1; anon transport role is intentionally supported.';
