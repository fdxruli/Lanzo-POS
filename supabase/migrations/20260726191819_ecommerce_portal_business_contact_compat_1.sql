-- ECOM.PORTAL.BUSINESS.CONTACT.COMPAT.1
-- Preserve legacy admin payloads, regularize historical publication state,
-- and finish validating the business-contact constraints.

create or replace function private.ecommerce_pause_nonconforming_portals()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_paused integer;
begin
  update public.ecommerce_portals p
  set
    status = 'paused',
    metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object(
      'publicationPausedReason', 'missing_required_business_contact',
      'publicationPausedByMigration', 'ECOM.PORTAL.BUSINESS.CONTACT.COMPAT.1'
    )
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
    );

  get diagnostics v_paused = row_count;
  return v_paused;
end;
$function$;

revoke all on function private.ecommerce_pause_nonconforming_portals()
  from public, anon, authenticated, service_role;

select private.ecommerce_pause_nonconforming_portals();

alter table public.ecommerce_portals
  validate constraint ecommerce_portals_contact_email_valid;

alter table public.ecommerce_portals
  validate constraint ecommerce_portals_published_whatsapp_required;

alter table public.ecommerce_portals
  validate constraint ecommerce_portals_address_postal_code_valid;

alter table public.ecommerce_portals
  validate constraint ecommerce_portals_published_structured_address_required;

-- Keep the audited implementation intact as a private implementation detail.
-- The public wrapper below enriches only absent compatibility keys before
-- delegating to it, so authorization and all Free/Pro rules remain unchanged.
alter function public.ecommerce_admin_upsert_portal(text, text, text, text, jsonb)
  set schema private;

alter function private.ecommerce_admin_upsert_portal(text, text, text, text, jsonb)
  rename to ecommerce_admin_upsert_portal_business_contact_v1;

revoke all on function private.ecommerce_admin_upsert_portal_business_contact_v1(
  text, text, text, text, jsonb
) from public, anon, authenticated, service_role;

create or replace function public.ecommerce_admin_upsert_portal(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_license_id uuid;
  v_existing public.ecommerce_portals%rowtype;
  v_compat_payload jsonb;
  v_result jsonb;
  v_saved public.ecommerce_portals%rowtype;
  v_structured_address_present boolean;
  v_legacy_address text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return private.ecommerce_admin_error('ECOMMERCE_PORTAL_SAVE_FAILED');
  end if;

  select l.id
  into v_license_id
  from public.licenses l
  where l.license_key = p_license_key
  limit 1;

  if v_license_id is not null then
    select p.*
    into v_existing
    from public.ecommerce_portals p
    where p.license_id = v_license_id
      and p.deleted_at is null
    limit 1;
  end if;

  v_structured_address_present :=
    p_payload ? 'addressStreet'
    or p_payload ? 'addressNeighborhood'
    or p_payload ? 'addressMunicipality'
    or p_payload ? 'addressState'
    or p_payload ? 'addressPostalCode';

  -- jsonb_build_object deliberately retains JSON null. Concatenating the
  -- original payload on the right lets an explicit null/empty value win while
  -- absent keys inherit their stored value.
  v_compat_payload := jsonb_build_object(
    'name', v_existing.name,
    'whatsappPhone', v_existing.whatsapp_phone,
    'contactEmail', v_existing.contact_email,
    'addressStreet', v_existing.address_street,
    'addressNeighborhood', v_existing.address_neighborhood,
    'addressMunicipality', v_existing.address_municipality,
    'addressState', v_existing.address_state,
    'addressPostalCode', v_existing.address_postal_code
  ) || p_payload;

  v_result := private.ecommerce_admin_upsert_portal_business_contact_v1(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    v_compat_payload
  );

  if coalesce((v_result->>'success')::boolean, false) is false
    or v_license_id is null
    or v_structured_address_present then
    return v_result;
  end if;

  v_legacy_address := case
    when p_payload ? 'address'
      then nullif(btrim(p_payload->>'address'), '')
    else v_existing.address
  end;

  update public.ecommerce_portals p
  set address = v_legacy_address
  where p.license_id = v_license_id
    and p.deleted_at is null
  returning p.* into v_saved;

  if v_saved.id is not null then
    v_result := jsonb_set(
      v_result,
      '{portal}',
      private.ecommerce_admin_portal_jsonb(v_saved),
      true
    );
  end if;

  return v_result;
end;
$function$;

create or replace function public.ecommerce_admin_upsert_portal(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  return public.ecommerce_admin_upsert_portal(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    null::text,
    p_payload
  );
end;
$function$;

revoke all on function public.ecommerce_admin_upsert_portal(
  text, text, text, text, jsonb
) from public, anon, authenticated;
revoke all on function public.ecommerce_admin_upsert_portal(
  text, text, text, jsonb
) from public, anon, authenticated;

grant execute on function public.ecommerce_admin_upsert_portal(
  text, text, text, text, jsonb
) to anon, authenticated, service_role;
grant execute on function public.ecommerce_admin_upsert_portal(
  text, text, text, jsonb
) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
