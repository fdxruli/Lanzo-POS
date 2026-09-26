-- Read-only contract verification against existing portal states.
begin;

do $test$
declare
  p record;
  v_result jsonb;
  v_missing jsonb;
  v_checked integer := 0;
begin
  v_missing := public.ecommerce_get_portal_by_slug_v2('phase1-definitely-missing-000000');
  if v_missing #>> '{error,code}' <> 'ECOMMERCE_PORTAL_NOT_FOUND' then
    raise exception 'missing portal contract failed';
  end if;

  -- Synthetic deleted fixture. The enclosing transaction always rolls back.
  insert into public.ecommerce_portals (license_id, slug, name, status, deleted_at)
  select license_id, 'phase1-deleted-contract-000000', 'Phase 1 rollback fixture', 'draft', clock_timestamp()
    from public.ecommerce_portals
   limit 1;
  if public.ecommerce_get_portal_by_slug_v2('phase1-deleted-contract-000000') <> v_missing then
    raise exception 'deleted portal differs from nonexistent';
  end if;

  for p in
    select id, slug, status
      from public.ecommerce_portals
     where deleted_at is null
       and status in ('published', 'paused', 'draft', 'disabled')
  loop
    v_checked := v_checked + 1;
    v_result := public.ecommerce_get_portal_by_slug_v2(p.slug);
    if p.status = 'published' then
      if v_result->>'success' <> 'true'
         or not (v_result ?& array['portal', 'hours', 'availability', 'features', 'catalogRevision', 'site', 'cachePolicy']) then
        raise exception 'published portal contract failed';
      end if;
      if v_result #>> '{portal,portalId}' <> p.id::text then
        raise exception 'published portal crossed tenant identity';
      end if;
    elsif p.status = 'paused' then
      if v_result <> '{"success":false,"error":{"code":"ECOMMERCE_PORTAL_PAUSED"}}'::jsonb then
        raise exception 'paused payload must contain only its public error code';
      end if;
      if public.ecommerce_get_catalog(p.slug, 1, 0) #>> '{error,code}' <> 'ECOMMERCE_PORTAL_NOT_FOUND'
         or public.ecommerce_get_product_configuration(p.slug, gen_random_uuid()) #>> '{error,code}' <> 'ECOMMERCE_PORTAL_NOT_FOUND'
         or public.ecommerce_create_order(p.slug, '{}'::jsonb, '[]'::jsonb, gen_random_uuid()::text) #>> '{error,code}' <> 'ECOMMERCE_PORTAL_NOT_FOUND' then
        raise exception 'paused operational gate failed';
      end if;
    elsif v_result <> v_missing then
      raise exception 'nonpublic portal differs from nonexistent';
    end if;
  end loop;
  if v_checked = 0 then
    raise exception 'no production portal state was checked';
  end if;
end;
$test$;

rollback;
