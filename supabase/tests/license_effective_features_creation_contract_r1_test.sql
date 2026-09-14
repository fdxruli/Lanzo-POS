-- Creation/revalidation parity regression. Synthetic rows are rolled back.
begin;

do $test$
declare
  v_suffix text := lower(substr(md5(random()::text || clock_timestamp()::text), 1, 12));
  v_fingerprint text := 'effective-features-' || v_suffix;
  v_result jsonb;
  v_license_id uuid;
  v_expected jsonb;
begin
  v_result := public.create_free_trial_license_unlimited(
    v_fingerprint,
    'Effective feature contract test',
    '{}'::jsonb
  );

  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'EFFECTIVE_FEATURES_CREATE_FAILED: %', v_result;
  end if;

  if v_result->'features' is distinct from v_result->'details'->'features' then
    raise exception 'EFFECTIVE_FEATURES_CREATE_DETAILS_MISMATCH';
  end if;

  select id into v_license_id
    from public.licenses
   where license_key = v_result->>'license_key';

  select coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb)
    into v_expected
    from public.licenses l
    left join public.plans p on p.id = l.plan_id
   where l.id = v_license_id;

  if v_result->'features' is distinct from v_expected then
    raise exception 'EFFECTIVE_FEATURES_CREATE_NOT_PLAN_PLUS_LICENSE';
  end if;

  if coalesce((v_result->'features'->>'ecommerce_portal_enabled')::boolean, false) is not true
     or coalesce((v_result->'features'->>'ecommerce_order_inbox')::boolean, false) is not true
     or coalesce((v_result->'features'->>'ecommerce_business_hours')::boolean, false) is not true then
    raise exception 'EFFECTIVE_FEATURES_ECOMMERCE_CAPABILITIES_MISSING';
  end if;
end;
$test$;

rollback;
