-- Fail-closed pilot stop. Keep schema and Auth inventory until collector verifies
-- exact tagged Auth users are gone; full object removal then uses 1A.4->1A.2.
begin;
do $guard$
begin
  if to_regclass('lanzo_ecom_bridge_qa.pilot_kill_switch') is null
     or to_regclass('lanzo_ecom_bridge_qa.grants') is null then
    raise exception 'ECOM_1A5_OBJECTS_NOT_INSTALLED';
  end if;
end;
$guard$;
update lanzo_ecom_bridge_qa.pilot_kill_switch
  set active = true, changed_at = clock_timestamp(), changed_by = 'server_control',
      change_reason = 'owner rollback';
update lanzo_ecom_bridge_qa.grants
  set revoked_at = coalesce(revoked_at,clock_timestamp()), vault = null,
      lease_id = null, lease_until = null
  where revoked_at is null;
commit;
