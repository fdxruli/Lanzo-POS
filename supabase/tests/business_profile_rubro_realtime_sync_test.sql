begin;

do $$
declare
  v_profile public.business_profiles%rowtype;
  v_license_key text;
  v_before_events bigint;
  v_after_events bigint;
  v_event public.license_events%rowtype;
  v_result jsonb;
  v_definition text;
begin
  select bp.*
  into v_profile
  from public.business_profiles bp
  join public.licenses l on l.id = bp.license_id
  order by bp.updated_at desc nulls last, bp.id
  limit 1;

  if v_profile.id is null then
    raise exception 'fixture business profile missing';
  end if;

  select l.license_key
  into v_license_key
  from public.licenses l
  where l.id = v_profile.license_id;

  select count(*)
  into v_before_events
  from public.license_events e
  where e.license_key = v_license_key
    and e.event_type = 'BUSINESS_PROFILE_UPDATED';

  update public.business_profiles
  set business_type = case
    when business_type @> array['hardware']::public.business_category[]
      then array['abarrotes']::public.business_category[]
    else array['hardware']::public.business_category[]
  end,
  updated_at = now()
  where id = v_profile.id;

  select count(*)
  into v_after_events
  from public.license_events e
  where e.license_key = v_license_key
    and e.event_type = 'BUSINESS_PROFILE_UPDATED';

  if v_after_events <> v_before_events + 1 then
    raise exception '1 profile update event count';
  end if;

  select e.*
  into v_event
  from public.license_events e
  where e.license_key = v_license_key
    and e.event_type = 'BUSINESS_PROFILE_UPDATED'
  order by e.triggered_at desc, e.id desc
  limit 1;

  if coalesce((v_event.metadata->>'profile_revision')::bigint, 0) <= 0 then
    raise exception '2 profile revision metadata';
  end if;

  if jsonb_typeof(v_event.metadata->'business_type') <> 'array' then
    raise exception '3 business type metadata';
  end if;

  v_result := public.get_business_profile_anon_unlimited(v_license_key)::jsonb;

  if coalesce((v_result->>'success')::boolean, false) is false then
    raise exception '4 profile rpc success';
  end if;

  if coalesce((v_result#>>'{data,profile_revision}')::bigint, 0) <= 0 then
    raise exception '5 profile rpc revision';
  end if;

  if nullif(v_result#>>'{data,updated_at}', '') is null then
    raise exception '6 profile rpc updated_at';
  end if;

  v_definition := pg_get_functiondef(
    'private.broadcast_license_event()'::regprocedure
  );

  if position('BUSINESS_PROFILE_UPDATED' in v_definition) = 0 then
    raise exception '7 broadcast allowlist';
  end if;
end;
$$;

rollback;
