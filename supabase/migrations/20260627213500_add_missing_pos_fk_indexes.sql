-- FASE 6H.5 — Optimize POS database indexes
-- Scope: database-only optimization.
-- This migration is intentionally idempotent and does not modify tables,
-- constraints, RLS policies, RPCs, or frontend behavior.

-- -----------------------------------------------------------------------------
-- Missing FK indexes reported by Supabase Performance Advisor in critical POS
-- cash/sales/cancellation tables.
--
-- Note: several existing hot-query indexes start with license_id, which is good
-- for RPC filters, but they do not cover FK checks where the FK column must be
-- the leftmost index prefix.
-- -----------------------------------------------------------------------------

create index if not exists idx_pos_cash_sessions_device_id_fk
on public.pos_cash_sessions(device_id);

create index if not exists idx_pos_cash_sessions_staff_user_id_fk
on public.pos_cash_sessions(staff_user_id);

create index if not exists idx_pos_cash_sessions_opened_by_device_id_fk
on public.pos_cash_sessions(opened_by_device_id);

create index if not exists idx_pos_cash_sessions_opened_by_staff_user_id_fk
on public.pos_cash_sessions(opened_by_staff_user_id);

create index if not exists idx_pos_cash_sessions_closed_by_device_id_fk
on public.pos_cash_sessions(closed_by_device_id);

create index if not exists idx_pos_cash_sessions_closed_by_staff_user_id_fk
on public.pos_cash_sessions(closed_by_staff_user_id);

create index if not exists idx_pos_cash_movements_cash_session_id_fk
on public.pos_cash_movements(cash_session_id);

create index if not exists idx_pos_cash_movements_device_id_fk
on public.pos_cash_movements(device_id);

create index if not exists idx_pos_cash_movements_staff_user_id_fk
on public.pos_cash_movements(staff_user_id);

create index if not exists idx_pos_cash_movements_created_by_device_id_fk
on public.pos_cash_movements(created_by_device_id);

create index if not exists idx_pos_cash_movements_created_by_staff_user_id_fk
on public.pos_cash_movements(created_by_staff_user_id);

create index if not exists idx_pos_sales_device_id_fk
on public.pos_sales(device_id);

create index if not exists idx_pos_sales_staff_user_id_fk
on public.pos_sales(staff_user_id);

create index if not exists idx_pos_sales_cancelled_by_device_id_fk
on public.pos_sales(cancelled_by_device_id);

create index if not exists idx_pos_sales_cancelled_by_staff_user_id_fk
on public.pos_sales(cancelled_by_staff_user_id);

create index if not exists idx_pos_sale_items_sale_id_fk
on public.pos_sale_items(sale_id);

create index if not exists idx_pos_sale_payments_sale_id_fk
on public.pos_sale_payments(sale_id);

create index if not exists idx_pos_sale_cancellations_sale_id_fk
on public.pos_sale_cancellations(sale_id);

-- Additional POS FK indexes confirmed by the FK audit query / Performance Advisor.
-- Kept in scope because they support cancellation/cash audit paths and do not
-- change any business logic.

create index if not exists idx_pos_sale_cancellations_actor_device_id_fk
on public.pos_sale_cancellations(actor_device_id);

create index if not exists idx_pos_sale_cancellations_actor_staff_user_id_fk
on public.pos_sale_cancellations(actor_staff_user_id);

create index if not exists idx_pos_cash_audit_events_cash_session_id_fk
on public.pos_cash_audit_events(cash_session_id);

create index if not exists idx_pos_cash_audit_events_actor_device_id_fk
on public.pos_cash_audit_events(actor_device_id);

create index if not exists idx_pos_cash_audit_events_actor_staff_user_id_fk
on public.pos_cash_audit_events(actor_staff_user_id);

-- -----------------------------------------------------------------------------
-- Additional non-redundant hot-query indexes.
-- -----------------------------------------------------------------------------

-- Pull incremental filtered by entity_type, used by cash-specific pulls.
-- Existing indexes cover (license_id, change_seq) and (license_id, entity_type,
-- entity_id), but not this exact filter/order pattern.
create index if not exists idx_pos_sync_events_license_entity_seq
on public.pos_sync_events(license_id, entity_type, change_seq);

-- Final sales reports frequently filter by license + optional cash_session_id
-- and order/filter by sale date. Existing indexes cover license/sold_at and
-- license/staff/device/customer/status/sold_at, but not cash session + date.
create index if not exists idx_pos_sales_license_cash_session_sold_at
on public.pos_sales(license_id, cash_session_id, sold_at desc)
where deleted_at is null and cash_session_id is not null;
