-- Synthetic-only dependency for the real bridge authorization laboratory.
-- The captured Production writer invokes this helper before its Restaurant
-- order logic; station provisioning itself is outside this test's scope.
create or replace function private.ensure_default_preparation_station(
  p_license_id uuid,
  p_device_id uuid,
  p_staff_user_id uuid
)
returns void
language plpgsql
security definer
set search_path to ''
as $fixture$
begin
  return;
end;
$fixture$;
revoke all on function private.ensure_default_preparation_station(uuid,uuid,uuid)
  from public, anon, authenticated;
