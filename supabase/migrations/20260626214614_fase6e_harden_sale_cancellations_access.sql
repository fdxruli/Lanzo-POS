-- FASE 6E hardening: no direct client writes/maintenance on sale cancellations.
-- All writes must go through public.pos_cancel_cloud_sale SECURITY DEFINER.

alter table public.pos_sale_cancellations enable row level security;

revoke all on table public.pos_sale_cancellations from anon;
revoke all on table public.pos_sale_cancellations from authenticated;

-- Keep service_role/admin access for operational maintenance and RPC owner execution path.
grant select, insert, update, delete on table public.pos_sale_cancellations to service_role;

-- Avoid broad PUBLIC execution; expose only to expected Supabase roles.
revoke all on function public.pos_cancel_cloud_sale(text, text, text, text, text, text, text) from public;
grant execute on function public.pos_cancel_cloud_sale(text, text, text, text, text, text, text) to anon, authenticated, service_role;

comment on table public.pos_sale_cancellations is 'Auditable cloud sale cancellations. Direct client access is revoked; mutations must use public.pos_cancel_cloud_sale.';;
