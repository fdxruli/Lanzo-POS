-- LICENSE.IDENTITY.1 regression coverage.
-- Synthetic rows and rate-limit evidence are rolled back.

begin;

do $test$
declare
  v_suffix text := lower(substr(md5(random()::text || clock_timestamp()::text), 1, 12));
  v_fingerprint text := 'neutral-license-' || v_suffix;
  v_legacy_fingerprint text := 'neutral-legacy-' || v_suffix;
  v_result jsonb;
  v_legacy_result jsonb;
  v_period record;
begin
  v_result := public.create_free_license_unlimited(
    v_fingerprint,
    'Neutral identity contract test',
    '{}'::jsonb
  );

  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'NEUTRAL_LICENSE_CREATE_FAILED: %', v_result;
  end if;

  if (v_result->>'license_key') !~ '^LANZO-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$' then
    raise exception 'NEUTRAL_LICENSE_KEY_FORMAT_INVALID: %', v_result->>'license_key';
  end if;

  if (v_result->>'license_key') ~ '^LANZO-(FREE|TRIAL|PRO)-' then
    raise exception 'NEUTRAL_LICENSE_KEY_ENCODES_PLAN: %', v_result->>'license_key';
  end if;

  if v_result->>'license_type' <> 'free'
     or coalesce((v_result->>'is_lifetime')::boolean, false) is not true
     or v_result->>'expires_at' is not null
     or v_result->>'license_kind' <> 'free_lifetime'
     or v_result->>'identity_version' <> 'LANZO.IDENTITY.1' then
    raise exception 'NEUTRAL_LICENSE_LIFETIME_CONTRACT_INVALID: %', v_result;
  end if;

  select p.period_type, p.metadata
    into v_period
    from public.license_periods p
    join public.licenses l on l.id = p.license_id
   where l.license_key = v_result->>'license_key'
   order by p.created_at desc
   limit 1;

  if v_period.period_type <> 'trial' then
    raise exception 'LEGACY_PERIOD_TYPE_COMPATIBILITY_CHANGED: %', v_period.period_type;
  end if;

  if v_period.metadata->>'source' <> 'create_free_license'
     or v_period.metadata->>'license_kind' <> 'free_lifetime'
     or v_period.metadata->>'identity_version' <> 'LANZO.IDENTITY.1' then
    raise exception 'NEUTRAL_LICENSE_PERIOD_METADATA_INVALID: %', v_period.metadata;
  end if;

  -- The legacy admin/test alias must create the same new neutral identity.
  v_legacy_result := public.create_free_trial_license_unlimited(
    v_legacy_fingerprint,
    'Legacy neutral identity alias test',
    '{}'::jsonb
  );

  if coalesce((v_legacy_result->>'success')::boolean, false) is not true
     or (v_legacy_result->>'license_key') !~ '^LANZO-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$' then
    raise exception 'LEGACY_ALIAS_NOT_NEUTRAL: %', v_legacy_result;
  end if;

  if has_function_privilege('anon', 'public.create_free_license(text,text,jsonb)', 'EXECUTE') is not true
     or has_function_privilege('authenticated', 'public.create_free_license(text,text,jsonb)', 'EXECUTE') is not true then
    raise exception 'CANONICAL_FREE_LICENSE_RPC_NOT_EXPOSED';
  end if;

  if has_function_privilege('anon', 'public.create_free_license_unlimited(text,text,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.create_free_license_unlimited(text,text,jsonb)', 'EXECUTE') then
    raise exception 'UNLIMITED_FREE_LICENSE_RPC_EXPOSED';
  end if;
end;
$test$;

rollback;
