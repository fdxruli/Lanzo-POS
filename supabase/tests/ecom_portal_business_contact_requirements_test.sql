begin;

-- Contract checks only; no portal or license data is mutated.
do $$
declare
  v_upsert_definition text;
  v_admin_json_definition text;
  v_public_json_definition text;
  v_whatsapp_constraint text;
  v_address_constraint text;
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
    raise exception 'business contact or structured address columns are missing';
  end if;

  select pg_get_functiondef(
    'public.ecommerce_admin_upsert_portal(text,text,text,text,jsonb)'::regprocedure
  ) into v_upsert_definition;
  select pg_get_functiondef(
    'private.ecommerce_admin_portal_jsonb(public.ecommerce_portals)'::regprocedure
  ) into v_admin_json_definition;
  select pg_get_functiondef(
    'private.ecommerce_portal_public_jsonb(public.ecommerce_portals)'::regprocedure
  ) into v_public_json_definition;

  if position('ECOMMERCE_NAME_LOCKED' in v_upsert_definition) = 0 then
    raise exception 'business name immutability is not enforced by the admin RPC';
  end if;
  if position('ECOMMERCE_WHATSAPP_REQUIRED_TO_PUBLISH' in v_upsert_definition) = 0
    or position('ECOMMERCE_ADDRESS_STREET_REQUIRED_TO_PUBLISH' in v_upsert_definition) = 0
    or position('ECOMMERCE_ADDRESS_NEIGHBORHOOD_REQUIRED_TO_PUBLISH' in v_upsert_definition) = 0
    or position('ECOMMERCE_ADDRESS_MUNICIPALITY_REQUIRED_TO_PUBLISH' in v_upsert_definition) = 0
    or position('ECOMMERCE_ADDRESS_STATE_REQUIRED_TO_PUBLISH' in v_upsert_definition) = 0
    or position('ECOMMERCE_ADDRESS_POSTAL_CODE_REQUIRED_TO_PUBLISH' in v_upsert_definition) = 0 then
    raise exception 'publication requirements are not enforced by the admin RPC';
  end if;
  if position('ECOMMERCE_CONTACT_EMAIL_INVALID' in v_upsert_definition) = 0 then
    raise exception 'contact email validation is missing from the admin RPC';
  end if;
  if lower(v_admin_json_definition) !~ '''contactemail''[[:space:]]*,[[:space:]]*p_portal.contact_email'
    or lower(v_public_json_definition) !~ '''contactemail''[[:space:]]*,[[:space:]]*p_portal.contact_email'
    or lower(v_admin_json_definition) !~ '''addresspostalcode''[[:space:]]*,[[:space:]]*p_portal.address_postal_code'
    or lower(v_public_json_definition) !~ '''addresspostalcode''[[:space:]]*,[[:space:]]*p_portal.address_postal_code' then
    raise exception 'business contact fields are missing from an ecommerce portal JSON contract';
  end if;

  select pg_get_constraintdef(oid)
  into v_whatsapp_constraint
  from pg_constraint
  where conname = 'ecommerce_portals_published_whatsapp_required'
    and conrelid = 'public.ecommerce_portals'::regclass;

  select pg_get_constraintdef(oid)
  into v_address_constraint
  from pg_constraint
  where conname = 'ecommerce_portals_published_structured_address_required'
    and conrelid = 'public.ecommerce_portals'::regclass;

  if v_whatsapp_constraint is null
    or position('status' in lower(v_whatsapp_constraint)) = 0
    or position('whatsapp_phone' in lower(v_whatsapp_constraint)) = 0 then
    raise exception 'published WhatsApp database constraint is missing';
  end if;
  if v_address_constraint is null
    or position('status' in lower(v_address_constraint)) = 0
    or position('address_street' in lower(v_address_constraint)) = 0
    or position('address_neighborhood' in lower(v_address_constraint)) = 0
    or position('address_municipality' in lower(v_address_constraint)) = 0
    or position('address_state' in lower(v_address_constraint)) = 0
    or position('address_postal_code' in lower(v_address_constraint)) = 0 then
    raise exception 'published structured address database constraint is missing';
  end if;

  if has_table_privilege('anon', 'public.ecommerce_portals', 'UPDATE')
    or has_table_privilege('authenticated', 'public.ecommerce_portals', 'UPDATE') then
    raise exception 'direct ecommerce_portals write grant regression';
  end if;
end;
$$;

rollback;
