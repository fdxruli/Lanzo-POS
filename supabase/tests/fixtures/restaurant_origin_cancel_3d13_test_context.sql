-- Test-only auth context. It models the production validator's reject/accept
-- boundary; it does not validate credentials and must never be used in prod.
create or replace function private.validate_pos_sync_context(text,text,text,text)
returns jsonb language plpgsql as $fixture$
begin
  if nullif($1,'') is distinct from 'fixture-license'
    or nullif($2,'') is null or nullif($3,'') is distinct from 'valid' then
    raise exception 'DEVICE_AUTH_INVALID';
  end if;
  if $4 = 'invalid-staff' then raise exception 'STAFF_SESSION_INVALID'; end if;
  return jsonb_build_object('license_id','00000000-0000-0000-0000-000000000001',
    'device_id',case when $2='A' then '00000000-0000-0000-0000-00000000000a'
      else '00000000-0000-0000-0000-00000000000b' end,
    'actor_type',case when $4 is null then 'admin' else 'staff' end,
    'actor_permissions',jsonb_build_object('refunds',$4='refunds'));
end;
$fixture$;
