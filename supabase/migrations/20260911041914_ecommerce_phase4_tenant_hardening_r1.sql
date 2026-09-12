-- ECOM.PHASE4.TENANT.HARDENING.R1
--
-- Forward-only tenant hardening for ecommerce-owned tables.  This migration
-- deliberately does not touch POS, sales, cash, licenses, actors, or secrets.

begin;

-- Fail closed if production ever contains a row that cannot satisfy the
-- composite scope below.  The preflight found zero such rows; keep the checks
-- in the migration so future replays cannot silently widen tenant scope.
do $preflight$
begin
  if exists (
    select 1
    from public.ecommerce_orders o
    left join public.ecommerce_portals p on p.id = o.portal_id
    where p.id is null or p.license_id <> o.license_id
  ) then
    raise exception 'ECOMMERCE_PHASE4_INCONSISTENT_SCOPE:ecommerce_orders';
  end if;

  if exists (
    select 1
    from public.ecommerce_order_items i
    left join public.ecommerce_portals p on p.id = i.portal_id
    where p.id is null or p.license_id <> i.license_id
  ) then
    raise exception 'ECOMMERCE_PHASE4_INCONSISTENT_SCOPE:ecommerce_order_items';
  end if;

  if exists (
    select 1
    from public.ecommerce_order_events e
    left join public.ecommerce_portals p on p.id = e.portal_id
    where p.id is null or p.license_id <> e.license_id
  ) then
    raise exception 'ECOMMERCE_PHASE4_INCONSISTENT_SCOPE:ecommerce_order_events';
  end if;

  if exists (
    select 1
    from public.ecommerce_order_inventory_reservations r
    left join public.ecommerce_portals p on p.id = r.portal_id
    where p.id is null or p.license_id <> r.license_id
  ) then
    raise exception 'ECOMMERCE_PHASE4_INCONSISTENT_SCOPE:ecommerce_order_inventory_reservations';
  end if;

  if exists (
    select 1
    from public.ecommerce_order_inventory_reservation_events e
    left join public.ecommerce_portals p on p.id = e.portal_id
    where p.id is null or p.license_id <> e.license_id
  ) then
    raise exception 'ECOMMERCE_PHASE4_INCONSISTENT_SCOPE:ecommerce_order_inventory_reservation_events';
  end if;

  if exists (
    select 1
    from public.ecommerce_published_products p
    left join public.ecommerce_portals portal on portal.id = p.portal_id
    where portal.id is null or portal.license_id <> p.license_id
  ) then
    raise exception 'ECOMMERCE_PHASE4_INCONSISTENT_SCOPE:ecommerce_published_products';
  end if;

  if exists (
    select 1
    from public.ecommerce_published_product_variants v
    left join public.ecommerce_published_products p on p.id = v.published_product_id
    where p.id is null or p.portal_id <> v.portal_id or p.license_id <> v.license_id
  ) then
    raise exception 'ECOMMERCE_PHASE4_INCONSISTENT_SCOPE:ecommerce_published_product_variants';
  end if;

  if exists (
    select 1
    from public.ecommerce_published_option_groups g
    left join public.ecommerce_published_products p on p.id = g.published_product_id
    where p.id is null or p.portal_id <> g.portal_id or p.license_id <> g.license_id
  ) then
    raise exception 'ECOMMERCE_PHASE4_INCONSISTENT_SCOPE:ecommerce_published_option_groups';
  end if;

  if exists (
    select 1
    from public.ecommerce_published_options o
    left join public.ecommerce_published_option_groups g on g.id = o.group_id
    left join public.ecommerce_published_products p on p.id = o.published_product_id
    where g.id is null or p.id is null
       or g.portal_id <> o.portal_id or g.license_id <> o.license_id
       or p.portal_id <> o.portal_id or p.license_id <> o.license_id
  ) then
    raise exception 'ECOMMERCE_PHASE4_INCONSISTENT_SCOPE:ecommerce_published_options';
  end if;

  if exists (
    select 1
    from public.ecommerce_published_wholesale_tiers t
    left join public.ecommerce_published_products p on p.id = t.published_product_id
    where p.id is null or p.portal_id <> t.portal_id or p.license_id <> t.license_id
  ) then
    raise exception 'ECOMMERCE_PHASE4_INCONSISTENT_SCOPE:ecommerce_published_wholesale_tiers';
  end if;

  if exists (
    select 1
    from public.ecommerce_order_items i
    join public.ecommerce_orders o on o.id = i.order_id
    where i.portal_id <> o.portal_id or i.license_id <> o.license_id
  ) then
    raise exception 'ECOMMERCE_PHASE4_INCONSISTENT_RELATION:order_items_order';
  end if;

  if exists (
    select 1
    from public.ecommerce_order_events e
    join public.ecommerce_orders o on o.id = e.order_id
    where e.portal_id <> o.portal_id or e.license_id <> o.license_id
  ) then
    raise exception 'ECOMMERCE_PHASE4_INCONSISTENT_RELATION:order_events_order';
  end if;

  if exists (
    select 1
    from public.ecommerce_order_inventory_reservations r
    join public.ecommerce_orders o on o.id = r.order_id
    join public.ecommerce_order_items i on i.id = r.order_item_id
    where r.portal_id <> o.portal_id or r.license_id <> o.license_id
       or r.portal_id <> i.portal_id or r.license_id <> i.license_id
  ) then
    raise exception 'ECOMMERCE_PHASE4_INCONSISTENT_RELATION:reservations_order_item';
  end if;

  if exists (
    select 1
    from public.ecommerce_order_inventory_reservation_events e
    join public.ecommerce_order_inventory_reservations r on r.id = e.reservation_id
    join public.ecommerce_orders o on o.id = e.order_id
    where e.portal_id <> r.portal_id or e.license_id <> r.license_id
       or e.portal_id <> o.portal_id or e.license_id <> o.license_id
  ) then
    raise exception 'ECOMMERCE_PHASE4_INCONSISTENT_RELATION:reservation_events';
  end if;
end;
$preflight$;

-- Composite referenced keys make portal_id the canonical store identity while
-- requiring the duplicated license_id to be the portal's license.
alter table public.ecommerce_portals
  add constraint ecommerce_portals_id_license_id_key unique (id, license_id);

alter table public.ecommerce_orders
  add constraint ecommerce_orders_id_portal_id_license_id_key
  unique (id, portal_id, license_id);

alter table public.ecommerce_order_items
  add constraint ecommerce_order_items_id_portal_id_license_id_key
  unique (id, portal_id, license_id);

alter table public.ecommerce_order_inventory_reservations
  add constraint ecommerce_order_inventory_reservations_scope_key
  unique (id, portal_id, license_id);

alter table public.ecommerce_published_products
  add constraint ecommerce_published_products_id_portal_id_license_id_key
  unique (id, portal_id, license_id);

alter table public.ecommerce_published_product_variants
  add constraint ecommerce_published_product_variants_scope_key
  unique (id, portal_id, license_id);

alter table public.ecommerce_published_option_groups
  add constraint ecommerce_published_option_groups_id_portal_id_license_id_key
  unique (id, portal_id, license_id);

-- Parent/product scope is non-null on these rows, so composite FKs are safe.
alter table public.ecommerce_orders
  add constraint ecommerce_orders_portal_license_fkey
  foreign key (portal_id, license_id)
  references public.ecommerce_portals (id, license_id)
  not valid;

alter table public.ecommerce_order_items
  add constraint ecommerce_order_items_portal_license_fkey
  foreign key (portal_id, license_id)
  references public.ecommerce_portals (id, license_id)
  not valid,
  add constraint ecommerce_order_items_order_scope_fkey
  foreign key (order_id, portal_id, license_id)
  references public.ecommerce_orders (id, portal_id, license_id)
  on delete cascade
  not valid;

alter table public.ecommerce_order_events
  add constraint ecommerce_order_events_portal_license_fkey
  foreign key (portal_id, license_id)
  references public.ecommerce_portals (id, license_id)
  not valid,
  add constraint ecommerce_order_events_order_scope_fkey
  foreign key (order_id, portal_id, license_id)
  references public.ecommerce_orders (id, portal_id, license_id)
  on delete cascade
  not valid;

alter table public.ecommerce_order_inventory_reservations
  add constraint ecommerce_order_inventory_reservations_portal_license_fkey
  foreign key (portal_id, license_id)
  references public.ecommerce_portals (id, license_id)
  not valid,
  add constraint ecommerce_order_inventory_reservations_order_scope_fkey
  foreign key (order_id, portal_id, license_id)
  references public.ecommerce_orders (id, portal_id, license_id)
  on delete cascade
  not valid,
  add constraint ecommerce_order_inventory_reservations_order_item_scope_fkey
  foreign key (order_item_id, portal_id, license_id)
  references public.ecommerce_order_items (id, portal_id, license_id)
  on delete cascade
  not valid,
  add constraint ecommerce_order_inventory_reservations_product_scope_fkey
  foreign key (published_product_id, portal_id, license_id)
  references public.ecommerce_published_products (id, portal_id, license_id)
  not valid;

alter table public.ecommerce_order_inventory_reservation_events
  add constraint ecommerce_order_inventory_reservation_events_portal_license_fk
  foreign key (portal_id, license_id)
  references public.ecommerce_portals (id, license_id)
  not valid,
  add constraint ecommerce_reservation_events_scope_fk
  foreign key (reservation_id, portal_id, license_id)
  references public.ecommerce_order_inventory_reservations (id, portal_id, license_id)
  on delete cascade
  not valid,
  add constraint ecommerce_order_inventory_reservation_events_order_scope_fkey
  foreign key (order_id, portal_id, license_id)
  references public.ecommerce_orders (id, portal_id, license_id)
  on delete cascade
  not valid;

alter table public.ecommerce_published_products
  add constraint ecommerce_published_products_portal_license_fkey
  foreign key (portal_id, license_id)
  references public.ecommerce_portals (id, license_id)
  on delete cascade
  not valid;

alter table public.ecommerce_published_product_variants
  add constraint ecommerce_published_product_variants_portal_license_fkey
  foreign key (portal_id, license_id)
  references public.ecommerce_portals (id, license_id)
  on delete cascade
  not valid,
  add constraint ecommerce_published_product_variants_product_scope_fkey
  foreign key (published_product_id, portal_id, license_id)
  references public.ecommerce_published_products (id, portal_id, license_id)
  on delete cascade
  not valid;

alter table public.ecommerce_published_option_groups
  add constraint ecommerce_published_option_groups_portal_license_fkey
  foreign key (portal_id, license_id)
  references public.ecommerce_portals (id, license_id)
  on delete cascade
  not valid,
  add constraint ecommerce_published_option_groups_product_scope_fkey
  foreign key (published_product_id, portal_id, license_id)
  references public.ecommerce_published_products (id, portal_id, license_id)
  on delete cascade
  not valid;

alter table public.ecommerce_published_options
  add constraint ecommerce_published_options_portal_license_fkey
  foreign key (portal_id, license_id)
  references public.ecommerce_portals (id, license_id)
  on delete cascade
  not valid,
  add constraint ecommerce_published_options_group_scope_fkey
  foreign key (group_id, portal_id, license_id)
  references public.ecommerce_published_option_groups (id, portal_id, license_id)
  on delete cascade
  not valid,
  add constraint ecommerce_published_options_product_scope_fkey
  foreign key (published_product_id, portal_id, license_id)
  references public.ecommerce_published_products (id, portal_id, license_id)
  on delete cascade
  not valid;

alter table public.ecommerce_published_wholesale_tiers
  add constraint ecommerce_published_wholesale_tiers_portal_license_fkey
  foreign key (portal_id, license_id)
  references public.ecommerce_portals (id, license_id)
  on delete cascade
  not valid,
  add constraint ecommerce_published_wholesale_tiers_product_scope_fkey
  foreign key (published_product_id, portal_id, license_id)
  references public.ecommerce_published_products (id, portal_id, license_id)
  on delete cascade
  not valid;

-- Nullable product/variant references cannot use ON DELETE SET NULL with the
-- non-null tenant columns.  This trigger supplies the same scope guarantee
-- without changing the existing deletion semantics.
create or replace function private.ecommerce_phase4_tenant_scope_guard()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if tg_table_name = 'ecommerce_order_items'
     and new.published_product_id is not null
     and not exists (
       select 1
       from public.ecommerce_published_products p
       where p.id = new.published_product_id
         and p.portal_id = new.portal_id
         and p.license_id = new.license_id
     ) then
    raise exception 'ECOMMERCE_TENANT_SCOPE_MISMATCH' using errcode = '23514';
  end if;

  if tg_table_name = 'ecommerce_order_items'
     and private.ecommerce_reservation_variant_id(new.options) is not null
     and not exists (
       select 1
       from public.ecommerce_published_product_variants v
       where v.id = private.ecommerce_reservation_variant_id(new.options)
         and v.published_product_id = new.published_product_id
         and v.portal_id = new.portal_id
         and v.license_id = new.license_id
     ) then
    raise exception 'ECOMMERCE_TENANT_SCOPE_MISMATCH' using errcode = '23514';
  end if;

  if tg_table_name = 'ecommerce_order_inventory_reservations'
     and new.published_variant_id is not null
     and not exists (
       select 1
       from public.ecommerce_published_product_variants v
       where v.id = new.published_variant_id
         and v.published_product_id = new.published_product_id
         and v.portal_id = new.portal_id
         and v.license_id = new.license_id
     ) then
    raise exception 'ECOMMERCE_TENANT_SCOPE_MISMATCH' using errcode = '23514';
  end if;

  return new;
end;
$function$;

alter function private.ecommerce_phase4_tenant_scope_guard() owner to postgres;
revoke all on function private.ecommerce_phase4_tenant_scope_guard() from public, anon, authenticated;

drop trigger if exists ecommerce_order_items_phase4_tenant_scope_guard
  on public.ecommerce_order_items;
create trigger ecommerce_order_items_phase4_tenant_scope_guard
before insert or update on public.ecommerce_order_items
for each row execute function private.ecommerce_phase4_tenant_scope_guard();

drop trigger if exists ecommerce_reservations_phase4_tenant_scope_guard
  on public.ecommerce_order_inventory_reservations;
create trigger ecommerce_reservations_phase4_tenant_scope_guard
before insert or update on public.ecommerce_order_inventory_reservations
for each row execute function private.ecommerce_phase4_tenant_scope_guard();

-- Composite-FK support indexes keep cross-tenant lookups bounded as the
-- catalogue and order volume grow.
create index ecommerce_orders_portal_license_created_idx
  on public.ecommerce_orders (portal_id, license_id, created_at desc);
create index ecommerce_order_items_order_scope_idx
  on public.ecommerce_order_items (order_id, portal_id, license_id);
create index ecommerce_order_items_product_scope_idx
  on public.ecommerce_order_items (published_product_id, portal_id, license_id)
  where published_product_id is not null;
create index ecommerce_order_events_order_scope_idx
  on public.ecommerce_order_events (order_id, portal_id, license_id, created_at desc);
create index ecommerce_order_inventory_reservations_order_scope_idx
  on public.ecommerce_order_inventory_reservations (order_id, portal_id, license_id, status);
create index ecommerce_order_inventory_reservations_item_scope_idx
  on public.ecommerce_order_inventory_reservations (order_item_id, portal_id, license_id);
create index ecommerce_order_inventory_reservations_product_scope_idx
  on public.ecommerce_order_inventory_reservations (published_product_id, portal_id, license_id);
create index ecommerce_reservation_events_reservation_scope_idx
  on public.ecommerce_order_inventory_reservation_events (reservation_id, portal_id, license_id, created_at desc);
create index ecommerce_order_inventory_reservation_events_order_scope_idx
  on public.ecommerce_order_inventory_reservation_events (order_id, portal_id, license_id, created_at desc);
create index ecommerce_published_product_variants_product_scope_idx
  on public.ecommerce_published_product_variants (published_product_id, portal_id, license_id)
  where deleted_at is null;
create index ecommerce_published_option_groups_product_scope_idx
  on public.ecommerce_published_option_groups (published_product_id, portal_id, license_id, display_order)
  where deleted_at is null;
create index ecommerce_published_options_group_scope_idx
  on public.ecommerce_published_options (group_id, portal_id, license_id, display_order)
  where deleted_at is null;
create index ecommerce_published_wholesale_tiers_product_scope_idx
  on public.ecommerce_published_wholesale_tiers (published_product_id, portal_id, license_id, min_quantity)
  where deleted_at is null;

-- Make tables that are intentionally RPC-only explicit: RLS remains enabled,
-- and anon/authenticated receive a visible deny policy rather than relying on
-- the less-obvious no-policy behavior.
create policy ecommerce_portal_hour_exceptions_no_direct_client_access
  on public.ecommerce_portal_hour_exceptions
  for all to anon, authenticated using (false) with check (false);
create policy ecommerce_portal_hours_no_direct_client_access
  on public.ecommerce_portal_hours
  for all to anon, authenticated using (false) with check (false);
create policy ecommerce_published_wholesale_tiers_no_direct_client_access
  on public.ecommerce_published_wholesale_tiers
  for all to anon, authenticated using (false) with check (false);
create policy ecommerce_site_documents_no_direct_client_access
  on public.ecommerce_site_documents
  for all to anon, authenticated using (false) with check (false);
create policy ecommerce_site_versions_no_direct_client_access
  on public.ecommerce_site_versions
  for all to anon, authenticated using (false) with check (false);

-- Stable portal identity is needed by the browser cache and cart namespace.
-- portal_id is the store identity; license_id is intentionally not returned.
create or replace function private.ecommerce_portal_public_jsonb(
  p_portal public.ecommerce_portals
)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object(
    'portalId', p_portal.id,
    'slug', p_portal.slug,
    'name', p_portal.name,
    'headline', p_portal.headline,
    'description', p_portal.description,
    'templateCode', p_portal.template_code,
    'customizationLevel', p_portal.customization_level,
    'theme', p_portal.theme,
    'logoUrl', p_portal.logo_url,
    'coverImageUrl', p_portal.cover_image_url,
    'whatsappPhone', p_portal.whatsapp_phone,
    'contactEmail', p_portal.contact_email,
    'address', p_portal.address,
    'addressStreet', p_portal.address_street,
    'addressNeighborhood', p_portal.address_neighborhood,
    'addressMunicipality', p_portal.address_municipality,
    'addressState', p_portal.address_state,
    'addressPostalCode', p_portal.address_postal_code,
    'businessType', case
      when cardinality(coalesce(p_portal.business_types_snapshot, '{}'::text[])) > 0
        then to_jsonb(p_portal.business_types_snapshot)
      else coalesce(to_jsonb(p_portal.business_type), '[]'::jsonb)
    end,
    'orderingEnabled', p_portal.ordering_enabled,
    'pickupEnabled', p_portal.pickup_enabled,
    'deliveryEnabled', p_portal.delivery_enabled,
    'scheduledOrdersEnabled', p_portal.scheduled_orders_enabled,
    'minOrderTotal', p_portal.min_order_total,
    'maxOrderItems', p_portal.max_order_items,
    'maxItemQuantity', p_portal.max_item_quantity,
    'stockMode', p_portal.stock_mode,
    'settings', p_portal.settings
  );
$function$;

alter function private.ecommerce_portal_public_jsonb(public.ecommerce_portals) owner to postgres;
revoke all on function private.ecommerce_portal_public_jsonb(public.ecommerce_portals) from public, anon, authenticated;

-- Keep the browser cache schema independent from the site document schema.
-- Both legacy and v2 public portal RPCs use this payload helper.
create or replace function private.ecommerce_site_public_payload(
  p_slug text,
  p_legacy boolean
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_portal public.ecommerce_portals%rowtype;
  v_version public.ecommerce_site_versions%rowtype;
  v_document jsonb;
  v_error text;
  v_version_id uuid := null;
  v_version_number bigint := null;
  v_mode text := 'default';
begin
  v_portal := private.ecommerce_get_public_portal_by_slug(p_slug);
  if v_portal.id is null then
    return private.ecommerce_public_error('ECOMMERCE_PORTAL_NOT_FOUND');
  end if;

  select v.*
    into v_version
    from public.ecommerce_site_documents d
    join public.ecommerce_site_versions v
      on v.id = d.published_version_id
     and v.portal_id = d.portal_id
   where d.portal_id = v_portal.id;

  if v_version.id is not null then
    v_document := case
      when v_version.schema_version = 2 then v_version.document
      else private.ecommerce_site_migrate_document_v1_to_v2(
        v_version.document,
        v_portal.template_code,
        v_portal.theme,
        v_portal.logo_url,
        v_portal.cover_image_url
      )
    end;
    v_error := private.ecommerce_site_document_error(v_document);
    if v_error is null then
      v_version_id := v_version.id;
      v_version_number := v_version.version_number;
      v_mode := coalesce(
        nullif(v_version.document_mode, ''),
        private.ecommerce_site_document_mode_v2(v_document)
      );
    else
      v_document := null;
    end if;
  end if;

  if v_document is null then
    v_document := private.ecommerce_site_default_document_v2(
      v_portal.template_code,
      v_portal.theme,
      v_portal.logo_url,
      v_portal.cover_image_url
    );
    v_version_id := null;
    v_version_number := null;
    v_mode := 'default';
  end if;

  if p_legacy then
    v_document := private.ecommerce_site_project_document_v2_to_v1(v_document);
  end if;

  return jsonb_build_object(
    'success', true,
    'portal', private.ecommerce_portal_public_jsonb(v_portal),
    'hours', private.ecommerce_portal_hours_jsonb(v_portal.id),
    'availability', private.ecommerce_public_availability_jsonb(v_portal, clock_timestamp()),
    'features', jsonb_build_object(
      'whatsappCheckout', private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_whatsapp_checkout', false),
      'orderInbox', private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_order_inbox', false),
      'customSlug', private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_custom_slug', false),
      'brandingCustomization', coalesce(private.ecommerce_license_feature_text(v_portal.license_id, 'ecommerce_branding_customization'), 'basic'),
      'layoutCustomization', coalesce(private.ecommerce_license_feature_text(v_portal.license_id, 'ecommerce_layout_customization'), 'template_only'),
      'businessHours', private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_business_hours', true),
      'deliveryPickupSettings', coalesce(private.ecommerce_license_feature_text(v_portal.license_id, 'ecommerce_delivery_pickup_settings'), 'basic'),
      'stockVisibility', private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_stock_visibility', false),
      'realtimeOrders', private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_realtime_orders', false)
    ),
    'catalogRevision', v_portal.catalog_revision,
    'site', jsonb_build_object(
      'schemaVersion', case when p_legacy then 1 else 2 end,
      'versionId', v_version_id,
      'versionNumber', v_version_number,
      'documentMode', v_mode,
      'document', v_document
    ),
    'cachePolicy', jsonb_build_object(
      'schemaVersion', 3,
      'freshSeconds', 300,
      'maxStaleSeconds', 86400
    )
  );
exception
  when others then
    return private.ecommerce_public_error('ECOMMERCE_PORTAL_NOT_FOUND');
end;
$function$;

alter function private.ecommerce_site_public_payload(text, boolean) owner to postgres;
revoke all on function private.ecommerce_site_public_payload(text, boolean) from public, anon, authenticated;

-- Validate after all constraints and triggers exist.  New writes were already
-- protected from the moment each NOT VALID FK was added.
alter table public.ecommerce_orders
  validate constraint ecommerce_orders_portal_license_fkey;
alter table public.ecommerce_order_items
  validate constraint ecommerce_order_items_portal_license_fkey,
  validate constraint ecommerce_order_items_order_scope_fkey;
alter table public.ecommerce_order_events
  validate constraint ecommerce_order_events_portal_license_fkey,
  validate constraint ecommerce_order_events_order_scope_fkey;
alter table public.ecommerce_order_inventory_reservations
  validate constraint ecommerce_order_inventory_reservations_portal_license_fkey,
  validate constraint ecommerce_order_inventory_reservations_order_scope_fkey,
  validate constraint ecommerce_order_inventory_reservations_order_item_scope_fkey,
  validate constraint ecommerce_order_inventory_reservations_product_scope_fkey;
alter table public.ecommerce_order_inventory_reservation_events
  validate constraint ecommerce_order_inventory_reservation_events_portal_license_fk,
  validate constraint ecommerce_reservation_events_scope_fk,
  validate constraint ecommerce_order_inventory_reservation_events_order_scope_fkey;
alter table public.ecommerce_published_products
  validate constraint ecommerce_published_products_portal_license_fkey;
alter table public.ecommerce_published_product_variants
  validate constraint ecommerce_published_product_variants_portal_license_fkey,
  validate constraint ecommerce_published_product_variants_product_scope_fkey;
alter table public.ecommerce_published_option_groups
  validate constraint ecommerce_published_option_groups_portal_license_fkey,
  validate constraint ecommerce_published_option_groups_product_scope_fkey;
alter table public.ecommerce_published_options
  validate constraint ecommerce_published_options_portal_license_fkey,
  validate constraint ecommerce_published_options_group_scope_fkey,
  validate constraint ecommerce_published_options_product_scope_fkey;
alter table public.ecommerce_published_wholesale_tiers
  validate constraint ecommerce_published_wholesale_tiers_portal_license_fkey,
  validate constraint ecommerce_published_wholesale_tiers_product_scope_fkey;

comment on constraint ecommerce_orders_portal_license_fkey on public.ecommerce_orders is
  'Phase 4 tenant scope: portal_id canonically determines license_id.';
comment on function private.ecommerce_phase4_tenant_scope_guard() is
  'Phase 4 defense-in-depth for nullable ecommerce product and variant references.';

commit;
