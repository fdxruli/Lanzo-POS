-- Post-migration hardening for the cloud layaway foreign keys.
-- These indexes are additive only and do not alter the existing contract,
-- RLS policies, grants, feature flags, or rollout state.

begin;

create index if not exists idx_pos_layaways_created_by_device_id
  on public.pos_layaways (created_by_device_id);

create index if not exists idx_pos_layaways_created_by_staff_user_id
  on public.pos_layaways (created_by_staff_user_id);

create index if not exists idx_pos_layaway_payments_created_by_device_id
  on public.pos_layaway_payments (created_by_device_id);

create index if not exists idx_pos_layaway_payments_created_by_staff_user_id
  on public.pos_layaway_payments (created_by_staff_user_id);

create index if not exists idx_pos_layaway_reservations_created_by_device_id
  on public.pos_layaway_inventory_reservations (created_by_device_id);

create index if not exists idx_pos_layaway_reservations_created_by_staff_user_id
  on public.pos_layaway_inventory_reservations (created_by_staff_user_id);

commit;
