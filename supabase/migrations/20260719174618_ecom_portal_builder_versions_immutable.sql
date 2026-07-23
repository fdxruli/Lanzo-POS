create or replace function private.ecommerce_site_prevent_version_mutation()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  raise exception 'ECOMMERCE_SITE_VERSION_IMMUTABLE';
end;
$$;
drop trigger if exists ecommerce_site_versions_immutable on public.ecommerce_site_versions;
create trigger ecommerce_site_versions_immutable
before update or delete on public.ecommerce_site_versions
for each row execute function private.ecommerce_site_prevent_version_mutation();
revoke all on function private.ecommerce_site_prevent_version_mutation() from public, anon, authenticated;

;
