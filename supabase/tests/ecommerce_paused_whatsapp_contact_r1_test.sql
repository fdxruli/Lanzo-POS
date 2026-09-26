-- Synthetic public-contract fixtures. Run as one transaction; leave no rows behind.
begin;

do $test$
declare
  v_pro uuid := gen_random_uuid();
  v_pro_null uuid := gen_random_uuid();
  v_free uuid := gen_random_uuid();
  v_draft uuid := gen_random_uuid();
  v_deleted uuid := gen_random_uuid();
  v_invalid uuid := gen_random_uuid();
  v_legacy uuid := gen_random_uuid();
  v_published record;
  v_result jsonb;
  v_missing jsonb;
begin
  insert into public.licenses (id, license_key, license_type, status, expires_at, plan_id, features)
  select fixture.id, fixture.license_key, fixture.license_type, 'active', now() + interval '1 day', p.id,
         '{"ecommerce_portal_enabled":true}'::jsonb
    from (values
      (v_pro, 'phase3-fixture-pro-phone', 'pro', 'pro_monthly'),
      (v_pro_null, 'phase3-fixture-pro-null', 'pro', 'pro_monthly'),
      (v_free, 'phase3-fixture-free-phone', 'free', 'free_trial'),
      (v_draft, 'phase3-fixture-draft', 'pro', 'pro_monthly'),
      (v_deleted, 'phase3-fixture-deleted', 'pro', 'pro_monthly'),
      (v_invalid, 'phase3-fixture-invalid', 'pro', 'pro_monthly'),
      (v_legacy, 'phase3-fixture-legacy', 'basic', 'basic_monthly')
    ) fixture(id, license_key, license_type, plan_code)
    join public.plans p on p.code = fixture.plan_code;
  if (select count(*) from public.licenses where id in (v_pro, v_pro_null, v_free, v_draft, v_deleted, v_invalid, v_legacy)) <> 7 then
    raise exception 'synthetic fixture licenses unavailable';
  end if;

  insert into public.ecommerce_portals (license_id, slug, name, status, whatsapp_phone)
  values
    (v_pro, 'phase3-fixture-pro-phone', 'Rollback fixture', 'paused', '+52 (961) 000-0000'),
    (v_pro_null, 'phase3-fixture-pro-null', 'Rollback fixture', 'paused', null),
    (v_free, 'phase3-fixture-free-phone', 'Rollback fixture', 'paused', '+52 (961) 000-0000'),
    (v_invalid, 'phase3-fixture-invalid', 'Rollback fixture', 'paused', 'javascript:alert(1)'),
    (v_legacy, 'phase3-fixture-legacy', 'Rollback fixture', 'paused', '+52 (961) 000-0000'),
    (v_draft, 'phase3-fixture-draft', 'Rollback fixture', 'draft', '+52 (961) 000-0000');
  insert into public.ecommerce_portals (license_id, slug, name, status, whatsapp_phone, deleted_at)
  values (v_deleted, 'phase3-fixture-deleted', 'Rollback fixture', 'draft', '+52 (961) 000-0000', clock_timestamp());

  v_result := public.ecommerce_get_portal_by_slug_v2('phase3-fixture-pro-phone');
  if v_result <> '{"success":false,"error":{"code":"ECOMMERCE_PORTAL_PAUSED"},"pausedContact":{"whatsappPhone":"529610000000"}}'::jsonb then
    raise exception 'Pro paused minimal contact contract failed';
  end if;
  if public.ecommerce_get_portal_by_slug('phase3-fixture-pro-phone') <> v_result then
    raise exception 'legacy and v2 paused contracts differ';
  end if;
  if public.ecommerce_get_portal_by_slug_v2('phase3-fixture-pro-null') <> '{"success":false,"error":{"code":"ECOMMERCE_PORTAL_PAUSED"}}'::jsonb then
    raise exception 'Pro without phone exposed contact';
  end if;
  if public.ecommerce_get_portal_by_slug_v2('phase3-fixture-free-phone') <> '{"success":false,"error":{"code":"ECOMMERCE_PORTAL_PAUSED"}}'::jsonb then
    raise exception 'Free exposed contact';
  end if;
  if public.ecommerce_get_portal_by_slug_v2('phase3-fixture-invalid') <> '{"success":false,"error":{"code":"ECOMMERCE_PORTAL_PAUSED"}}'::jsonb then
    raise exception 'invalid contact leaked';
  end if;
  v_missing := public.ecommerce_get_portal_by_slug_v2('phase3-fixture-nonexistent');
  if public.ecommerce_get_portal_by_slug_v2('phase3-fixture-legacy') #>> '{error,code}' not in
      ('ECOMMERCE_PORTAL_PAUSED', 'ECOMMERCE_PORTAL_NOT_FOUND')
     or public.ecommerce_get_portal_by_slug_v2('phase3-fixture-legacy') ? 'pausedContact' then
    raise exception 'legacy feature absence leaked contact';
  end if;
  if v_missing #>> '{error,code}' <> 'ECOMMERCE_PORTAL_NOT_FOUND'
     or public.ecommerce_get_portal_by_slug_v2('phase3-fixture-draft') <> v_missing
     or public.ecommerce_get_portal_by_slug_v2('phase3-fixture-deleted') <> v_missing then
    raise exception 'nonpublic portal leaked contact';
  end if;
  if private.ecommerce_license_feature_bool(gen_random_uuid(), 'ecommerce_paused_contact_whatsapp', false) then
    raise exception 'absent feature must fail closed';
  end if;
  if has_function_privilege('anon', 'private.ecommerce_site_public_payload(text,boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.ecommerce_site_public_payload(text,boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'private.ecommerce_resolve_public_portal_status(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.ecommerce_resolve_public_portal_status(text)', 'EXECUTE') then
    raise exception 'private helper has client EXECUTE grant';
  end if;
  if public.ecommerce_get_catalog('phase3-fixture-pro-phone', 1, 0) #>> '{error,code}' <> 'ECOMMERCE_PORTAL_NOT_FOUND' then
    raise exception 'paused operational gate changed';
  end if;
  for v_published in
    select slug from public.ecommerce_portals where status = 'published' and deleted_at is null
  loop
    v_result := public.ecommerce_get_portal_by_slug_v2(v_published.slug);
    if v_result->>'success' <> 'true' or not (v_result ? 'portal') or (v_result ? 'pausedContact') then
      raise exception 'published portal contract changed';
    end if;
  end loop;
end;
$test$;

rollback;
