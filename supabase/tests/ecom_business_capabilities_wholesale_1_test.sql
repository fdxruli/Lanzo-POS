begin;

do $$
declare
  v_portal public.ecommerce_portals%rowtype;
  v_product public.ecommerce_published_products%rowtype;
  v_simple public.ecommerce_published_products%rowtype;
  v_profile public.business_profiles%rowtype;
  v_before_groups bigint;
  v_after_groups bigint;
  v_result jsonb;
  v_definition text;
begin
  select p.* into v_portal
  from public.ecommerce_portals p
  join public.business_profiles bp on bp.license_id=p.license_id
  where p.deleted_at is null and bp.business_type @> array['abarrotes']::public.business_category[]
  order by p.id limit 1;
  if v_portal.id is null then raise exception 'fixture portal missing'; end if;

  select * into v_profile from public.business_profiles
  where license_id=v_portal.license_id;
  select * into v_product
  from public.ecommerce_published_products
  where portal_id=v_portal.id
    and business_capability_reason='RESTAURANT_MODIFIERS_NOT_SUPPORTED'
  order by id limit 1;
  select * into v_simple
  from public.ecommerce_published_products
  where portal_id=v_portal.id and configuration_type='simple'
  order by id limit 1;
  if v_product.id is null or v_simple.id is null then
    raise exception 'fixture products missing';
  end if;

  -- 1 restaurant permits groups.
  update public.business_profiles
  set business_type=array['food_service']::public.business_category[]
  where id=v_profile.id;
  if not private.ecommerce_business_supports_capability(v_portal.license_id,'restaurant_modifiers')
    then raise exception '1 restaurant modifiers'; end if;

  -- 2 grocery rejects groups.
  update public.business_profiles
  set business_type=array['abarrotes']::public.business_category[]
  where id=v_profile.id;
  if private.ecommerce_business_supports_capability(v_portal.license_id,'restaurant_modifiers')
    then raise exception '2 grocery modifiers'; end if;

  -- 3 multi-business permits groups.
  update public.business_profiles
  set business_type=array['abarrotes','food_service']::public.business_category[]
  where id=v_profile.id;
  if not private.ecommerce_business_supports_capability(v_portal.license_id,'restaurant_modifiers')
    then raise exception '3 multi modifiers'; end if;

  -- 4 restaurant -> grocery marks review.
  update public.business_profiles
  set business_type=array['abarrotes']::public.business_category[]
  where id=v_profile.id;
  select * into v_product from public.ecommerce_published_products where id=v_product.id;
  if v_product.business_capability_status<>'requires_review'
    then raise exception '4 review status'; end if;

  -- 5 incompatible product is absent from public catalog.
  v_result:=public.ecommerce_get_catalog(v_portal.slug,100,0);
  if exists(select 1 from jsonb_array_elements(v_result->'items') i
    where i->>'id'=v_product.id::text) then raise exception '5 public catalog'; end if;

  -- 6 incompatible product configuration cannot be read/bought.
  v_result:=public.ecommerce_get_product_configuration(v_portal.slug,v_product.id);
  if coalesce((v_result->>'success')::boolean,false)
    then raise exception '6 public configuration'; end if;

  -- 7 simple override permits simple publication without restoring options.
  update public.ecommerce_published_products
  set public_configuration_mode='simple_override',manual_available=true,is_available=true
  where id=v_product.id;
  perform private.ecommerce_reconcile_published_product_capability(v_product.id);
  select * into v_product from public.ecommerce_published_products where id=v_product.id;
  if v_product.business_capability_status<>'simple_override'
     or v_product.configuration_type<>'simple' or v_product.has_option_groups
    then raise exception '7 simple override'; end if;

  -- 8 old groups are soft deleted.
  if exists(select 1 from public.ecommerce_published_option_groups
    where published_product_id=v_product.id and deleted_at is null)
    then raise exception '8 group soft delete'; end if;

  -- 9 reconciliation is idempotent.
  select count(*) into v_before_groups from public.ecommerce_published_option_groups
    where published_product_id=v_product.id;
  perform private.ecommerce_reconcile_published_product_capability(v_product.id);
  select count(*) into v_after_groups from public.ecommerce_published_option_groups
    where published_product_id=v_product.id;
  if v_before_groups<>v_after_groups then raise exception '9 idempotency'; end if;

  -- 10 stale configuration revision guard remains installed.
  v_definition:=pg_get_functiondef('public.ecommerce_create_order(text,jsonb,jsonb,text)'::regprocedure);
  if position('ECOMMERCE_CONFIGURATION_CHANGED' in v_definition)=0
    then raise exception '10 revision guard'; end if;

  -- 11 disabled wholesale is not public.
  update public.ecommerce_published_products set wholesale_enabled=false where id=v_simple.id;
  if (private.ecommerce_product_public_jsonb(v_simple,false)->>'wholesaleEnabled')::boolean
    then raise exception '11 wholesale disabled'; end if;

  -- 12 active wholesale makes the normalized tier available.
  perform private.ecommerce_apply_wholesale_tiers(v_simple.id,true,
    '[{"sourceTierRef":"six","minQuantity":6,"unitPrice":21,"displayOrder":0,"sourceAvailable":true}]');
  if not exists(select 1 from public.ecommerce_published_wholesale_tiers
    where published_product_id=v_simple.id and min_quantity=6 and deleted_at is null)
    then raise exception '12 wholesale active'; end if;

  -- 13 below minimum has no applicable tier.
  if exists(select 1 from public.ecommerce_published_wholesale_tiers
    where published_product_id=v_simple.id and min_quantity<=5 and deleted_at is null)
    then raise exception '13 below minimum'; end if;

  -- 14 exactly minimum applies.
  if (select unit_price from public.ecommerce_published_wholesale_tiers
      where published_product_id=v_simple.id and min_quantity<=6
        and deleted_at is null order by min_quantity desc limit 1)<>21
    then raise exception '14 exact minimum'; end if;

  -- 15 greatest reached tier applies.
  perform private.ecommerce_apply_wholesale_tiers(v_simple.id,true,
    '[{"sourceTierRef":"six","minQuantity":6,"unitPrice":21,"displayOrder":0,"sourceAvailable":true},
      {"sourceTierRef":"twelve","minQuantity":12,"unitPrice":19,"displayOrder":1,"sourceAvailable":true}]');
  if (select unit_price from public.ecommerce_published_wholesale_tiers
      where published_product_id=v_simple.id and min_quantity<=13
        and deleted_at is null order by min_quantity desc limit 1)<>19
    then raise exception '15 greatest tier'; end if;

  -- 16 duplicate quantities are rejected.
  begin
    perform private.ecommerce_apply_wholesale_tiers(v_simple.id,true,
      '[{"sourceTierRef":"a","minQuantity":6,"unitPrice":21},
        {"sourceTierRef":"b","minQuantity":6,"unitPrice":20}]');
    raise exception '16 duplicate accepted';
  exception when others then
    if sqlerrm='16 duplicate accepted' then raise; end if;
  end;

  -- 17 negative prices are rejected.
  begin
    perform private.ecommerce_apply_wholesale_tiers(v_simple.id,true,
      '[{"sourceTierRef":"negative","minQuantity":2,"unitPrice":-1}]');
    raise exception '17 negative accepted';
  exception when others then
    if sqlerrm='17 negative accepted' then raise; end if;
  end;

  -- 18 price below replacement cost is unavailable.
  update public.pos_products set cost=25
  where license_id=v_simple.license_id and id=v_simple.local_product_ref;
  perform private.ecommerce_apply_wholesale_tiers(v_simple.id,true,
    '[{"sourceTierRef":"below-cost","minQuantity":2,"unitPrice":20,"sourceAvailable":true}]');
  if exists(select 1 from public.ecommerce_published_wholesale_tiers
    where published_product_id=v_simple.id and source_tier_ref='below-cost'
      and source_available and is_available)
    then raise exception '18 below cost'; end if;

  -- 19 checkout builds an authoritative validated item before persistence.
  if position('v_validated_item:=jsonb_build_object' in v_definition)=0
    then raise exception '19 authoritative item'; end if;

  -- 20 order snapshot includes authoritative pricing fields.
  if position('pricingMode' in v_definition)=0
     or position('appliedUnitPrice' in v_definition)=0
    then raise exception '20 order snapshot'; end if;

  -- 21 cross-license parent references are guarded.
  if position('ECOMMERCE_CONFIGURATION_CROSS_LICENSE_REFERENCE' in
    pg_get_functiondef('private.ecommerce_wholesale_tier_parent_guard()'::regprocedure))=0
    then raise exception '21 cross license'; end if;

  -- 22 checkout retains catalog/configuration revision validation.
  if position('configurationRevision' in v_definition)=0
    then raise exception '22 stale checkout'; end if;

  -- 23 direct application DML is revoked.
  if has_table_privilege('anon','public.ecommerce_published_wholesale_tiers','INSERT')
     or has_table_privilege('authenticated','public.ecommerce_published_wholesale_tiers','UPDATE')
     or has_table_privilege('service_role','public.ecommerce_published_wholesale_tiers','DELETE')
    then raise exception '23 direct dml'; end if;

  -- 24 original modifiers remain in POS.
  if not exists(select 1 from public.pos_products p
    where p.license_id=v_product.license_id and p.id=v_product.local_product_ref
      and jsonb_typeof(p.modifiers)='array' and jsonb_array_length(p.modifiers)>0)
    then raise exception '24 source modifiers'; end if;
end;
$$;

rollback;
