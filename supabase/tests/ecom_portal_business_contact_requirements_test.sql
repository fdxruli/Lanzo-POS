-- ECOM.PORTAL.BUSINESS.CONTACT.COMPAT.1 regression matrix.
-- All fixtures, constraint simulations, and RPC effects are rolled back.
begin;

do $test$
declare
  v_suffix text := lower(substr(md5(random()::text || clock_timestamp()::text), 1, 12));
  v_license uuid := extensions.gen_random_uuid();
  v_historical_license uuid := extensions.gen_random_uuid();
  v_conforming_license uuid := extensions.gen_random_uuid();
  v_portal uuid := extensions.gen_random_uuid();
  v_historical_portal uuid := extensions.gen_random_uuid();
  v_conforming_portal uuid := extensions.gen_random_uuid();
  v_device uuid := extensions.gen_random_uuid();
  v_key text := 'ECOM-CONTACT-COMPAT-' || v_suffix;
  v_fingerprint text := 'ecom-contact-device-' || v_suffix;
  v_token text := 'ecom-contact-token-' || v_suffix;
  v_result jsonb;
  v_before public.ecommerce_portals%rowtype;
  v_after public.ecommerce_portals%rowtype;
  v_paused integer;
  v_signature regprocedure;
begin
  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ecommerce_portals'
      and column_name in (
        'contact_email',
        'address_street',
        'address_neighborhood',
        'address_municipality',
        'address_state',
        'address_postal_code'
      )
  ) <> 6 then
    raise exception 'TEST_01_BUSINESS_CONTACT_COLUMNS_MISSING';
  end if;

  insert into public.licenses(
    id, license_key, license_type, status, expires_at, features
  )
  values
    (
      v_license,
      v_key,
      'pro',
      'active',
      clock_timestamp() + interval '1 day',
      jsonb_build_object(
        'ecommerce_portal_enabled', true,
        'ecommerce_custom_slug', true,
        'ecommerce_branding_customization', 'advanced'
      )
    ),
    (
      v_historical_license,
      'ECOM-CONTACT-HISTORICAL-' || v_suffix,
      'free',
      'active',
      clock_timestamp() + interval '1 day',
      '{"ecommerce_portal_enabled":true}'::jsonb
    ),
    (
      v_conforming_license,
      'ECOM-CONTACT-CONFORMING-' || v_suffix,
      'free',
      'active',
      clock_timestamp() + interval '1 day',
      '{"ecommerce_portal_enabled":true}'::jsonb
    );

  insert into public.license_devices(
    id, license_id, device_fingerprint, device_name,
    security_token, is_active, device_role
  )
  values (
    v_device,
    v_license,
    v_fingerprint,
    'Ecommerce contact compatibility fixture',
    v_token,
    true,
    'admin'
  );

  -- Recreate the pre-compensation state transactionally so the data migration
  -- itself is exercised without leaving schema or fixture changes behind.
  alter table public.ecommerce_portals
    drop constraint ecommerce_portals_contact_email_valid,
    drop constraint ecommerce_portals_published_whatsapp_required,
    drop constraint ecommerce_portals_address_postal_code_valid,
    drop constraint ecommerce_portals_published_structured_address_required;

  insert into public.ecommerce_portals(
    id, license_id, slug, status, name, template_code,
    whatsapp_phone, contact_email, address, address_street,
    address_neighborhood, address_municipality, address_state,
    address_postal_code, ordering_enabled, pickup_enabled, metadata
  )
  values
    (
      v_historical_portal,
      v_historical_license,
      'ecom-contact-historical-' || v_suffix,
      'published',
      'Historical contact fixture',
      'classic',
      null,
      null,
      'Domicilio legado conservado',
      null,
      null,
      null,
      null,
      null,
      true,
      true,
      '{"existing":"preserved"}'::jsonb
    ),
    (
      v_conforming_portal,
      v_conforming_license,
      'ecom-contact-conforming-' || v_suffix,
      'published',
      'Conforming contact fixture',
      'classic',
      '9991112233',
      'conforming@example.test',
      'Calle Uno, Centro, Mérida, Yucatán, C.P. 97000',
      'Calle Uno',
      'Centro',
      'Mérida',
      'Yucatán',
      '97000',
      true,
      true,
      '{}'::jsonb
    ),
    (
      v_portal,
      v_license,
      'ecom-contact-rpc-' || v_suffix,
      'published',
      'RPC contact fixture',
      'classic',
      '9992223344',
      'rpc@example.test',
      'Calle Inicial, Centro, Mérida, Yucatán, C.P. 97000',
      'Calle Inicial',
      'Centro',
      'Mérida',
      'Yucatán',
      '97000',
      true,
      true,
      '{}'::jsonb
    );

  alter table public.ecommerce_portals
    add constraint ecommerce_portals_contact_email_valid
      check (
        contact_email is null
        or (
          length(contact_email) <= 254
          and contact_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        )
      ) not valid,
    add constraint ecommerce_portals_published_whatsapp_required
      check (
        status <> 'published'
        or length(regexp_replace(coalesce(whatsapp_phone, ''), '[^0-9]', '', 'g')) >= 8
      ) not valid,
    add constraint ecommerce_portals_address_postal_code_valid
      check (
        address_postal_code is null
        or address_postal_code ~ '^[0-9]{5}$'
      ) not valid,
    add constraint ecommerce_portals_published_structured_address_required
      check (
        status <> 'published'
        or (
          length(btrim(coalesce(address_street, ''))) > 0
          and length(btrim(coalesce(address_neighborhood, ''))) > 0
          and length(btrim(coalesce(address_municipality, ''))) >= 2
          and btrim(address_municipality) !~* '^(s/?n|sin n[uú]mero)$'
          and length(btrim(coalesce(address_state, ''))) > 0
          and btrim(address_state) !~* '^(s/?n|sin n[uú]mero)$'
          and coalesce(address_postal_code, '') ~ '^[0-9]{5}$'
        )
      ) not valid;

  v_paused := private.ecommerce_pause_nonconforming_portals();
  if v_paused <> 1 then
    raise exception 'TEST_02_HISTORICAL_PAUSE_COUNT_FAILED: %', v_paused;
  end if;
  if (select status from public.ecommerce_portals where id = v_historical_portal) <> 'paused'
    or (select address from public.ecommerce_portals where id = v_historical_portal)
      <> 'Domicilio legado conservado'
    or (select metadata->>'existing' from public.ecommerce_portals where id = v_historical_portal)
      <> 'preserved'
    or (select metadata->>'publicationPausedReason' from public.ecommerce_portals where id = v_historical_portal)
      <> 'missing_required_business_contact'
    or (select metadata->>'publicationPausedByMigration' from public.ecommerce_portals where id = v_historical_portal)
      <> 'ECOM.PORTAL.BUSINESS.CONTACT.COMPAT.1' then
    raise exception 'TEST_03_HISTORICAL_PORTAL_NOT_SAFELY_PAUSED';
  end if;
  if (select status from public.ecommerce_portals where id = v_conforming_portal) <> 'published' then
    raise exception 'TEST_04_CONFORMING_PORTAL_CHANGED';
  end if;

  alter table public.ecommerce_portals
    validate constraint ecommerce_portals_contact_email_valid;
  alter table public.ecommerce_portals
    validate constraint ecommerce_portals_published_whatsapp_required;
  alter table public.ecommerce_portals
    validate constraint ecommerce_portals_address_postal_code_valid;
  alter table public.ecommerce_portals
    validate constraint ecommerce_portals_published_structured_address_required;

  if exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.ecommerce_portals'::regclass
      and conname in (
        'ecommerce_portals_contact_email_valid',
        'ecommerce_portals_published_whatsapp_required',
        'ecommerce_portals_address_postal_code_valid',
        'ecommerce_portals_published_structured_address_required'
      )
      and convalidated is false
  ) then
    raise exception 'TEST_05_CONSTRAINT_VALIDATION_FAILED';
  end if;
  if exists (
    select 1
    from public.ecommerce_portals p
    where p.status = 'published'
      and (
        length(regexp_replace(coalesce(p.whatsapp_phone, ''), '[^0-9]', '', 'g')) < 8
        or length(btrim(coalesce(p.address_street, ''))) = 0
        or length(btrim(coalesce(p.address_neighborhood, ''))) = 0
        or length(btrim(coalesce(p.address_municipality, ''))) < 2
        or btrim(p.address_municipality) ~* '^(s/?n|sin n[uú]mero)$'
        or length(btrim(coalesce(p.address_state, ''))) = 0
        or btrim(p.address_state) ~* '^(s/?n|sin n[uú]mero)$'
        or coalesce(p.address_postal_code, '') !~ '^[0-9]{5}$'
      )
  ) then
    raise exception 'TEST_06_NONCONFORMING_PUBLISHED_PORTAL_REMAINS';
  end if;

  -- Missing new keys preserve the existing structured contact data.
  select * into v_before from public.ecommerce_portals where id = v_portal;
  v_result := public.ecommerce_admin_upsert_portal(
    v_key, v_fingerprint, v_token, null,
    jsonb_build_object('name', v_before.name, 'description', 'Cliente anterior')
  );
  if coalesce((v_result->>'success')::boolean, false) is false then
    raise exception 'TEST_07_LEGACY_SAVE_REJECTED: %', v_result;
  end if;
  select * into v_after from public.ecommerce_portals where id = v_portal;
  if v_after.contact_email is distinct from v_before.contact_email
    or v_after.address is distinct from v_before.address
    or v_after.address_street is distinct from v_before.address_street
    or v_after.address_neighborhood is distinct from v_before.address_neighborhood
    or v_after.address_municipality is distinct from v_before.address_municipality
    or v_after.address_state is distinct from v_before.address_state
    or v_after.address_postal_code is distinct from v_before.address_postal_code then
    raise exception 'TEST_08_MISSING_KEYS_ERASED_CONTACT_DATA';
  end if;

  -- A legacy address updates only the legacy projection.
  v_result := public.ecommerce_admin_upsert_portal(
    v_key, v_fingerprint, v_token, null,
    jsonb_build_object('name', v_after.name, 'address', 'Domicilio legado nuevo')
  );
  select * into v_after from public.ecommerce_portals where id = v_portal;
  if coalesce((v_result->>'success')::boolean, false) is false
    or v_after.address <> 'Domicilio legado nuevo'
    or v_after.address_street <> 'Calle Inicial'
    or v_after.address_neighborhood <> 'Centro'
    or v_after.address_municipality <> 'Mérida'
    or v_after.address_state <> 'Yucatán'
    or v_after.address_postal_code <> '97000' then
    raise exception 'TEST_09_LEGACY_ADDRESS_COMPAT_FAILED: %', v_result;
  end if;

  -- Explicit null clears the optional email and nothing else.
  select * into v_before from public.ecommerce_portals where id = v_portal;
  v_result := public.ecommerce_admin_upsert_portal(
    v_key, v_fingerprint, v_token, null,
    jsonb_build_object('name', v_before.name, 'contactEmail', null)
  );
  select * into v_after from public.ecommerce_portals where id = v_portal;
  if coalesce((v_result->>'success')::boolean, false) is false
    or v_after.contact_email is not null
    or v_after.whatsapp_phone is distinct from v_before.whatsapp_phone
    or v_after.address is distinct from v_before.address
    or v_after.address_street is distinct from v_before.address_street
    or v_after.address_neighborhood is distinct from v_before.address_neighborhood
    or v_after.address_municipality is distinct from v_before.address_municipality
    or v_after.address_state is distinct from v_before.address_state
    or v_after.address_postal_code is distinct from v_before.address_postal_code then
    raise exception 'TEST_10_EXPLICIT_EMAIL_CLEAR_FAILED: %', v_result;
  end if;

  -- A partial structured update retains every omitted structured field.
  v_result := public.ecommerce_admin_upsert_portal(
    v_key, v_fingerprint, v_token, null,
    jsonb_build_object('name', v_after.name, 'addressStreet', 'Calle Parcial')
  );
  select * into v_after from public.ecommerce_portals where id = v_portal;
  if coalesce((v_result->>'success')::boolean, false) is false
    or v_after.address_street <> 'Calle Parcial'
    or v_after.address_neighborhood <> 'Centro'
    or v_after.address_municipality <> 'Mérida'
    or v_after.address_state <> 'Yucatán'
    or v_after.address_postal_code <> '97000'
    or v_after.address not like 'Calle Parcial%' then
    raise exception 'TEST_11_PARTIAL_STRUCTURED_ADDRESS_FAILED: %', v_result;
  end if;

  -- Saving an unrelated field does not mutate contact data.
  select * into v_before from public.ecommerce_portals where id = v_portal;
  v_result := public.ecommerce_admin_upsert_portal(
    v_key, v_fingerprint, v_token,
    jsonb_build_object('name', v_before.name, 'description', 'Solo descripción')
  );
  select * into v_after from public.ecommerce_portals where id = v_portal;
  if coalesce((v_result->>'success')::boolean, false) is false
    or v_after.whatsapp_phone is distinct from v_before.whatsapp_phone
    or v_after.contact_email is distinct from v_before.contact_email
    or v_after.address is distinct from v_before.address
    or v_after.address_street is distinct from v_before.address_street
    or v_after.address_neighborhood is distinct from v_before.address_neighborhood
    or v_after.address_municipality is distinct from v_before.address_municipality
    or v_after.address_state is distinct from v_before.address_state
    or v_after.address_postal_code is distinct from v_before.address_postal_code then
    raise exception 'TEST_12_UNRELATED_SAVE_MUTATED_CONTACT_DATA';
  end if;

  -- Publication requirements execute against the effective stored + payload
  -- state, including older clients that omit the new keys.
  update public.ecommerce_portals
  set status = 'draft', whatsapp_phone = null
  where id = v_portal;
  v_result := public.ecommerce_admin_upsert_portal(
    v_key, v_fingerprint, v_token, null,
    jsonb_build_object('name', v_after.name, 'status', 'published')
  );
  if v_result->>'code' <> 'ECOMMERCE_WHATSAPP_REQUIRED_TO_PUBLISH' then
    raise exception 'TEST_13_PUBLISH_WITHOUT_WHATSAPP_ACCEPTED: %', v_result;
  end if;

  update public.ecommerce_portals
  set whatsapp_phone = '9992223344', address_street = null
  where id = v_portal;
  v_result := public.ecommerce_admin_upsert_portal(
    v_key, v_fingerprint, v_token, null,
    jsonb_build_object('name', v_after.name, 'status', 'published')
  );
  if v_result->>'code' <> 'ECOMMERCE_ADDRESS_STREET_REQUIRED_TO_PUBLISH' then
    raise exception 'TEST_14_PUBLISH_WITHOUT_STREET_ACCEPTED: %', v_result;
  end if;

  update public.ecommerce_portals
  set address_street = 'Calle Final', address_neighborhood = null
  where id = v_portal;
  v_result := public.ecommerce_admin_upsert_portal(
    v_key, v_fingerprint, v_token, null,
    jsonb_build_object('name', v_after.name, 'status', 'published')
  );
  if v_result->>'code' <> 'ECOMMERCE_ADDRESS_NEIGHBORHOOD_REQUIRED_TO_PUBLISH' then
    raise exception 'TEST_15_PUBLISH_WITHOUT_NEIGHBORHOOD_ACCEPTED: %', v_result;
  end if;

  update public.ecommerce_portals
  set address_neighborhood = 'Centro', address_municipality = null
  where id = v_portal;
  v_result := public.ecommerce_admin_upsert_portal(
    v_key, v_fingerprint, v_token, null,
    jsonb_build_object('name', v_after.name, 'status', 'published')
  );
  if v_result->>'code' <> 'ECOMMERCE_ADDRESS_MUNICIPALITY_REQUIRED_TO_PUBLISH' then
    raise exception 'TEST_16_PUBLISH_WITHOUT_MUNICIPALITY_ACCEPTED: %', v_result;
  end if;

  update public.ecommerce_portals
  set address_municipality = 'Mérida', address_state = null
  where id = v_portal;
  v_result := public.ecommerce_admin_upsert_portal(
    v_key, v_fingerprint, v_token, null,
    jsonb_build_object('name', v_after.name, 'status', 'published')
  );
  if v_result->>'code' <> 'ECOMMERCE_ADDRESS_STATE_REQUIRED_TO_PUBLISH' then
    raise exception 'TEST_17_PUBLISH_WITHOUT_STATE_ACCEPTED: %', v_result;
  end if;

  update public.ecommerce_portals
  set address_state = 'Yucatán', address_postal_code = null
  where id = v_portal;
  v_result := public.ecommerce_admin_upsert_portal(
    v_key, v_fingerprint, v_token, null,
    jsonb_build_object('name', v_after.name, 'status', 'published')
  );
  if v_result->>'code' <> 'ECOMMERCE_ADDRESS_POSTAL_CODE_REQUIRED_TO_PUBLISH' then
    raise exception 'TEST_18_PUBLISH_WITHOUT_POSTAL_CODE_ACCEPTED: %', v_result;
  end if;
  v_result := public.ecommerce_admin_upsert_portal(
    v_key, v_fingerprint, v_token, null,
    jsonb_build_object(
      'name', v_after.name,
      'status', 'published',
      'addressPostalCode', 'ABCDE'
    )
  );
  if v_result->>'code' <> 'ECOMMERCE_ADDRESS_POSTAL_CODE_INVALID' then
    raise exception 'TEST_19_PUBLISH_WITH_INVALID_POSTAL_CODE_ACCEPTED: %', v_result;
  end if;

  v_result := public.ecommerce_admin_upsert_portal(
    v_key, v_fingerprint, v_token, null,
    jsonb_build_object(
      'name', v_after.name,
      'status', 'published',
      'addressPostalCode', '97000'
    )
  );
  if coalesce((v_result->>'success')::boolean, false) is false
    or (select status from public.ecommerce_portals where id = v_portal) <> 'published' then
    raise exception 'TEST_20_COMPLETE_PORTAL_NOT_PUBLISHED: %', v_result;
  end if;

  -- The no-session overload still delegates to the authorized primary RPC,
  -- and an old published client can save without the new keys.
  v_result := public.ecommerce_admin_upsert_portal(
    v_key, v_fingerprint, v_token,
    jsonb_build_object('name', v_after.name, 'description', 'Overload compatible')
  );
  if coalesce((v_result->>'success')::boolean, false) is false
    or (select address_street from public.ecommerce_portals where id = v_portal) <> 'Calle Final'
    or (select address_postal_code from public.ecommerce_portals where id = v_portal) <> '97000' then
    raise exception 'TEST_21_NO_SESSION_OVERLOAD_COMPAT_FAILED: %', v_result;
  end if;

  -- Authorization and privilege contracts remain executable, not textual.
  v_result := public.ecommerce_admin_upsert_portal(
    'INVALID-' || v_suffix,
    'invalid-device-' || v_suffix,
    'invalid-token-' || v_suffix,
    jsonb_build_object('name', 'Unauthorized')
  );
  if coalesce((v_result->>'success')::boolean, true) is true then
    raise exception 'TEST_22_REAL_AUTHORIZATION_BYPASSED: %', v_result;
  end if;
  if has_table_privilege('anon', 'public.ecommerce_portals', 'UPDATE')
    or has_table_privilege('authenticated', 'public.ecommerce_portals', 'UPDATE') then
    raise exception 'TEST_23_DIRECT_UPDATE_GRANT_REGRESSION';
  end if;

  foreach v_signature in array array[
    'public.ecommerce_admin_upsert_portal(text,text,text,text,jsonb)'::regprocedure,
    'public.ecommerce_admin_upsert_portal(text,text,text,jsonb)'::regprocedure
  ]
  loop
    if not (
      select p.prosecdef and p.proconfig @> array['search_path=""']::text[]
      from pg_catalog.pg_proc p
      where p.oid = v_signature
    ) then
      raise exception 'TEST_24_RPC_SECURITY_CONFIGURATION_FAILED: %', v_signature;
    end if;
  end loop;

  if has_function_privilege(
      'anon',
      'private.ecommerce_pause_nonconforming_portals()',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'private.ecommerce_pause_nonconforming_portals()',
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      'private.ecommerce_admin_upsert_portal_business_contact_v1(text,text,text,text,jsonb)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'private.ecommerce_admin_upsert_portal_business_contact_v1(text,text,text,text,jsonb)',
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      'private.ecommerce_admin_authorize_v2(text,text,text,text,text)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'private.ecommerce_admin_authorize_v2(text,text,text,text,text)',
      'EXECUTE'
    ) then
    raise exception 'TEST_25_PRIVATE_HELPER_EXPOSED';
  end if;
end;
$test$;

rollback;
