-- Forward-only compatibility for the historical Restaurante enum alias.
-- No backfill: existing profiles are not rewritten by this migration.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function private.canonicalize_restaurant_profile_category_v1()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.business_type && array['restaurante','food_service']::public.business_category[] then
    new.business_type := array(
      select canonical_type
      from (
        select case when item = 'restaurante'::public.business_category
          then 'food_service'::public.business_category else item end as canonical_type,
          ordinal
        from unnest(new.business_type) with ordinality as types(item, ordinal)
      ) normalized
      group by canonical_type
      order by min(ordinal)
    );
  end if;
  return new;
end;
$$;
revoke all on function private.canonicalize_restaurant_profile_category_v1() from public, anon, authenticated;

-- Covers the secure writer and older/administrative writers at the table boundary.
-- Existing AFTER triggers see the canonical array, including realtime/capabilities.
create trigger business_profile_restaurant_category_canonical_v1
before insert or update of business_type on public.business_profiles
for each row execute function private.canonicalize_restaurant_profile_category_v1();

-- Preserve the original missing-profile behavior and all authorization upstream.
-- Accept only this verified historical alias; unrelated rubros remain rejected.
create or replace function private.assert_restaurant_orders_food_service(p_license_id uuid)
returns void language plpgsql stable set search_path = '' as $$
begin
  if exists (select 1 from public.business_profiles bp where bp.license_id = p_license_id)
     and not exists (
       select 1 from public.business_profiles bp
       cross join unnest(bp.business_type) as business_type_item
       where bp.license_id = p_license_id
         and business_type_item in ('food_service'::public.business_category, 'restaurante'::public.business_category)
     ) then
    raise exception 'RESTAURANT_ORDERS_FOOD_SERVICE_REQUIRED' using errcode = 'P0001';
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
