-- FASE 6H.5.1 — Remaining FK indexes
-- Scope: database-only optimization.
-- This migration is intentionally idempotent and does not modify tables,
-- constraints, RLS policies, RPCs, or frontend behavior.

create index if not exists idx_ai_agent_usage_device_id_fk
on public.ai_agent_usage(device_id);

create index if not exists idx_ai_agent_usage_staff_user_id_fk
on public.ai_agent_usage(staff_user_id);

create index if not exists idx_license_periods_plan_id_fk
on public.license_periods(plan_id);
