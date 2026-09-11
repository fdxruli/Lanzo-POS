-- ECOM.PHASE4.TENANT.HARDENING.R1
-- Metadata and live-data assertions only. No fixtures are created.
begin;

do $test$
declare
  v_constraint text;
  v_expected text[] := array[
    'ecommerce_orders_portal_license_fkey',
    'ecommerce_order_items_portal_license_fkey',
    'ecommerce_order_items_order_scope_fkey',
    'ecommerce_order_events_portal_license_fkey',
    'ecommerce_order_events_order_scope_fkey',
    'ecommerce_order_inventory_reservations_portal_license_fkey',
    'ecommerce_order_inventory_reservations_order_scope_fkey',
    'ecommerce_order_inventory_reservations_order_item_scope_fkey',
    'ecommerce_order_inventory_reservations_product_scope_fkey',
    'ecommerce_order_inventory_reservation_events_portal_license_fk',
    'ecommerce_reservation_events_scope_fk',
    'ecommerce_order_inventory_reservation_events_order_scope_fkey',
    'ecommerce_published_products_portal_license_fkey',
    'ecommerce_published_product_variants_portal_license_fkey',
    'ecommerce_published_product_variants_product_scope_fkey',
    'ecommerce_published_option_groups_portal_license_fkey',
    'ecommerce_published_option_groups_product_scope_fkey',
    'ecommerce_published_options_portal_license_fkey',
    'ecommerce_published_options_group_scope_fkey',
    'ecommerce_published_options_product_scope_fkey',
    'ecommerce_published_wholesale_tiers_portal_license_fkey',
    'ecommerce_published_wholesale_tiers_product_scope_fkey'
  ];
begin
  foreach v_constraint in array v_expected loop
    if not exists (
      select 1
      from pg_constraint
      where conname = v_constraint
        and convalidated is true
    ) then
      raise exception 'PHASE4_TEST: missing or unvalidated constraint %', v_constraint;
    end if;
  end loop;

  if exists (
    select 1
    from public.ecommerce_orders o
    join public.ecommerce_portals p on p.id = o.portal_id
    where p.license_id <> o.license_id
  ) then
    raise exception 'PHASE4_TEST: orders contain a cross-tenant scope';
  end if;

  if exists (
    select 1
    from public.ecommerce_order_items i
    join public.ecommerce_orders o on o.id = i.order_id
    where i.portal_id <> o.portal_id or i.license_id <> o.license_id
  ) then
    raise exception 'PHASE4_TEST: order items contain a cross-tenant scope';
  end if;

  if exists (
    select 1
    from public.ecommerce_order_inventory_reservations r
    join public.ecommerce_orders o on o.id = r.order_id
    join public.ecommerce_order_items i on i.id = r.order_item_id
    where r.portal_id <> o.portal_id or r.license_id <> o.license_id
       or r.portal_id <> i.portal_id or r.license_id <> i.license_id
  ) then
    raise exception 'PHASE4_TEST: reservations contain a cross-tenant scope';
  end if;

  if exists (
    select 1
    from public.ecommerce_published_options o
    join public.ecommerce_published_option_groups g on g.id = o.group_id
    join public.ecommerce_published_products p on p.id = o.published_product_id
    where o.portal_id <> g.portal_id or o.license_id <> g.license_id
       or o.portal_id <> p.portal_id or o.license_id <> p.license_id
  ) then
    raise exception 'PHASE4_TEST: options contain a cross-tenant scope';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname like 'ecommerce_%'
      and c.relrowsecurity is not true
  ) then
    raise exception 'PHASE4_TEST: an ecommerce table has RLS disabled';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in (
        'ecommerce_portal_hour_exceptions',
        'ecommerce_portal_hours',
        'ecommerce_published_wholesale_tiers',
        'ecommerce_site_documents',
        'ecommerce_site_versions'
      )
      and grantee in ('anon', 'authenticated')
  ) then
    raise exception 'PHASE4_TEST: an RPC-only ecommerce table is directly granted to a client role';
  end if;

  if (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'ecommerce_portal_hour_exceptions',
        'ecommerce_portal_hours',
        'ecommerce_published_wholesale_tiers',
        'ecommerce_site_documents',
        'ecommerce_site_versions'
      )
      and policyname in (
        'ecommerce_portal_hour_exceptions_no_direct_client_access',
        'ecommerce_portal_hours_no_direct_client_access',
        'ecommerce_published_wholesale_tiers_no_direct_client_access',
        'ecommerce_site_documents_no_direct_client_access',
        'ecommerce_site_versions_no_direct_client_access'
      )
  ) <> 5 then
    raise exception 'PHASE4_TEST: expected explicit direct-client deny policies are missing';
  end if;

  if has_function_privilege('anon', 'private.ecommerce_phase4_tenant_scope_guard()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.ecommerce_phase4_tenant_scope_guard()', 'EXECUTE') then
    raise exception 'PHASE4_TEST: tenant guard is client-callable';
  end if;

  if position('license_id' in pg_get_functiondef(
    'private.ecommerce_portal_public_jsonb(public.ecommerce_portals)'::regprocedure
  )) > 0 then
    raise exception 'PHASE4_TEST: public portal allowlist references license_id';
  end if;
end;
$test$;

rollback;
