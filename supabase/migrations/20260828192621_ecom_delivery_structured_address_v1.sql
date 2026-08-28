alter table public.ecommerce_orders
  add column if not exists customer_delivery_address jsonb;

comment on column public.ecommerce_orders.customer_delivery_address is
  'Canonical structured delivery address for public ecommerce orders; legacy customer_address remains supported.';

create or replace function private.ecommerce_normalize_delivery_address_v1(p_address jsonb)
returns jsonb
language plpgsql
immutable
security definer
set search_path = ''
as $function$
declare
  v_field text;
  v_street text;
  v_exterior_number text;
  v_interior_number text;
  v_neighborhood text;
  v_municipality text;
  v_state text;
  v_postal_code text;
  v_reference text;
  v_street_line text;
  v_formatted text;
begin
  if p_address is null or jsonb_typeof(p_address) <> 'object' then
    return jsonb_build_object(
      'success', false,
      'errorCode', 'ECOMMERCE_DELIVERY_ADDRESS_INVALID'
    );
  end if;

  foreach v_field in array array[
    'street', 'exteriorNumber', 'interiorNumber', 'neighborhood',
    'municipality', 'state', 'postalCode', 'reference'
  ] loop
    if p_address ? v_field
       and jsonb_typeof(p_address -> v_field) <> 'string' then
      return jsonb_build_object(
        'success', false,
        'errorCode', 'ECOMMERCE_DELIVERY_ADDRESS_INVALID'
      );
    end if;
  end loop;

  v_street := btrim(coalesce(p_address ->> 'street', ''));
  v_exterior_number := btrim(coalesce(p_address ->> 'exteriorNumber', ''));
  v_interior_number := btrim(coalesce(p_address ->> 'interiorNumber', ''));
  v_neighborhood := btrim(coalesce(p_address ->> 'neighborhood', ''));
  v_municipality := btrim(coalesce(p_address ->> 'municipality', ''));
  v_state := btrim(coalesce(p_address ->> 'state', ''));
  v_postal_code := btrim(coalesce(p_address ->> 'postalCode', ''));
  v_reference := btrim(coalesce(p_address ->> 'reference', ''));

  if v_street = '' then
    return jsonb_build_object(
      'success', false,
      'errorCode', 'ECOMMERCE_DELIVERY_STREET_REQUIRED'
    );
  end if;
  if v_neighborhood = '' then
    return jsonb_build_object(
      'success', false,
      'errorCode', 'ECOMMERCE_DELIVERY_NEIGHBORHOOD_REQUIRED'
    );
  end if;
  if char_length(v_municipality) < 2 then
    return jsonb_build_object(
      'success', false,
      'errorCode', 'ECOMMERCE_DELIVERY_MUNICIPALITY_REQUIRED'
    );
  end if;
  if v_state = '' then
    return jsonb_build_object(
      'success', false,
      'errorCode', 'ECOMMERCE_DELIVERY_STATE_REQUIRED'
    );
  end if;
  if v_postal_code = '' then
    return jsonb_build_object(
      'success', false,
      'errorCode', 'ECOMMERCE_DELIVERY_POSTAL_CODE_REQUIRED'
    );
  end if;
  if v_postal_code !~ '^[0-9]{5}$' then
    return jsonb_build_object(
      'success', false,
      'errorCode', 'ECOMMERCE_DELIVERY_POSTAL_CODE_INVALID'
    );
  end if;

  if char_length(v_street) > 160
     or char_length(v_exterior_number) > 40
     or char_length(v_interior_number) > 40
     or char_length(v_neighborhood) > 160
     or char_length(v_municipality) > 120
     or char_length(v_state) > 80
     or char_length(v_reference) > 500 then
    return jsonb_build_object(
      'success', false,
      'errorCode', 'ECOMMERCE_DELIVERY_ADDRESS_INVALID'
    );
  end if;

  v_street_line := v_street;
  if v_exterior_number <> '' then
    v_street_line := v_street_line || ' #' || v_exterior_number;
  end if;
  if v_interior_number <> '' then
    v_street_line := v_street_line || ' Int. ' || v_interior_number;
  end if;
  v_formatted := concat_ws(
    ', ',
    v_street_line,
    v_neighborhood,
    v_municipality,
    v_state,
    'CP ' || v_postal_code
  );
  if char_length(v_formatted) > 500 then
    return jsonb_build_object(
      'success', false,
      'errorCode', 'ECOMMERCE_DELIVERY_ADDRESS_INVALID'
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'address', jsonb_build_object(
      'street', v_street,
      'exteriorNumber', v_exterior_number,
      'interiorNumber', v_interior_number,
      'neighborhood', v_neighborhood,
      'municipality', v_municipality,
      'state', v_state,
      'postalCode', v_postal_code,
      'reference', v_reference
    ),
    'formatted', v_formatted
  );
end;
$function$;

alter function private.ecommerce_normalize_delivery_address_v1(jsonb) owner to postgres;
revoke all on function private.ecommerce_normalize_delivery_address_v1(jsonb)
  from public, anon, authenticated;

do $patch_public_error$
declare
  v_definition text;
  v_before text := $fragment$
when 'ECOMMERCE_DELIVERY_ADDRESS_REQUIRED' then 'Escribe la direccion de entrega para continuar.'
when 'ECOMMERCE_DELIVERY_NOT_AVAILABLE' then 'Este negocio no tiene entrega a domicilio disponible.'$fragment$;
  v_after text := $fragment$
when 'ECOMMERCE_DELIVERY_ADDRESS_REQUIRED' then 'Escribe la direccion de entrega para continuar.'
when 'ECOMMERCE_DELIVERY_STREET_REQUIRED' then 'Escribe la calle, avenida o camino de entrega.'
when 'ECOMMERCE_DELIVERY_NEIGHBORHOOD_REQUIRED' then 'Escribe la colonia, barrio, ejido o localidad.'
when 'ECOMMERCE_DELIVERY_MUNICIPALITY_REQUIRED' then 'Escribe el municipio o ciudad de entrega.'
when 'ECOMMERCE_DELIVERY_STATE_REQUIRED' then 'Escribe el estado de entrega.'
when 'ECOMMERCE_DELIVERY_POSTAL_CODE_REQUIRED' then 'Escribe el codigo postal de entrega.'
when 'ECOMMERCE_DELIVERY_POSTAL_CODE_INVALID' then 'Escribe un codigo postal valido de 5 digitos.'
when 'ECOMMERCE_DELIVERY_ADDRESS_INVALID' then 'Revisa los datos de la direccion de entrega.'
when 'ECOMMERCE_DELIVERY_NOT_AVAILABLE' then 'Este negocio no tiene entrega a domicilio disponible.'$fragment$;
begin
  select pg_get_functiondef(p.oid)
  into v_definition
  from pg_proc p
  where p.oid = 'private.ecommerce_public_error(text)'::regprocedure;

  if v_definition is null then
    raise exception 'ECOMMERCE_DELIVERY_ADDRESS_MIGRATION_PUBLIC_ERROR_FUNCTION_MISSING';
  end if;
  if position(v_before in v_definition) = 0 then
    raise exception 'ECOMMERCE_DELIVERY_ADDRESS_MIGRATION_PUBLIC_ERROR_MISMATCH';
  end if;
  v_definition := replace(v_definition, v_before, v_after);
  execute v_definition;
end;
$patch_public_error$;

do $patch_create_order$
declare
  v_definition text;
begin
  select pg_get_functiondef(p.oid)
  into v_definition
  from pg_proc p
  where p.oid = 'public.ecommerce_create_order(text,jsonb,jsonb,text)'::regprocedure;

  if v_definition is null then
    raise exception 'ECOMMERCE_DELIVERY_ADDRESS_MIGRATION_CREATE_FUNCTION_MISSING';
  end if;

  if position('v_customer_notes text;v_fulfillment_method text;' in v_definition) = 0 then
    raise exception 'ECOMMERCE_DELIVERY_ADDRESS_MIGRATION_CREATE_DECLARATION_MISMATCH';
  end if;
  v_definition := replace(
    v_definition,
    'v_customer_notes text;v_fulfillment_method text;',
    'v_customer_notes text;v_customer_delivery_address jsonb;v_delivery_address_result jsonb;v_has_structured_delivery_address boolean:=false;v_fulfillment_method text;'
  );

  if position(
    'v_customer_name:=left(btrim(coalesce(p_customer->>''name'','''')),120);v_customer_phone:=left(btrim(coalesce(p_customer->>''phone'','''')),40);v_customer_address:=left(btrim(coalesce(p_customer->>''address'','''')),500);v_customer_notes:=left(btrim(coalesce(p_customer->>''notes'','''')),1000);v_fulfillment_method:=lower(btrim(coalesce(p_customer->>''fulfillmentMethod'','''')));'
    in v_definition
  ) = 0 then
    raise exception 'ECOMMERCE_DELIVERY_ADDRESS_MIGRATION_CREATE_NORMALIZATION_MISMATCH';
  end if;
  v_definition := replace(
    v_definition,
    'v_customer_name:=left(btrim(coalesce(p_customer->>''name'','''')),120);v_customer_phone:=left(btrim(coalesce(p_customer->>''phone'','''')),40);v_customer_address:=left(btrim(coalesce(p_customer->>''address'','''')),500);v_customer_notes:=left(btrim(coalesce(p_customer->>''notes'','''')),1000);v_fulfillment_method:=lower(btrim(coalesce(p_customer->>''fulfillmentMethod'','''')));',
    'v_customer_name:=left(btrim(coalesce(p_customer->>''name'','''')),120);v_customer_phone:=left(btrim(coalesce(p_customer->>''phone'','''')),40);v_customer_address:=left(btrim(coalesce(p_customer->>''address'','''')),500);v_customer_notes:=left(btrim(coalesce(p_customer->>''notes'','''')),1000);v_fulfillment_method:=lower(btrim(coalesce(p_customer->>''fulfillmentMethod'','''')));v_has_structured_delivery_address:=coalesce((jsonb_typeof(p_customer)=''object'' and p_customer ? ''deliveryAddress''),false);'
  );

  if position(
    'if v_fulfillment_method=''delivery'' then if length(v_customer_address)<5 then return private.ecommerce_public_error(''ECOMMERCE_DELIVERY_ADDRESS_REQUIRED'');end if;else v_customer_address:=null;end if;'
    in v_definition
  ) = 0 then
    raise exception 'ECOMMERCE_DELIVERY_ADDRESS_MIGRATION_CREATE_VALIDATION_MISMATCH';
  end if;
  v_definition := replace(
    v_definition,
    'if v_fulfillment_method=''delivery'' then if length(v_customer_address)<5 then return private.ecommerce_public_error(''ECOMMERCE_DELIVERY_ADDRESS_REQUIRED'');end if;else v_customer_address:=null;end if;',
    'if v_fulfillment_method=''delivery'' then if v_has_structured_delivery_address then v_delivery_address_result:=private.ecommerce_normalize_delivery_address_v1(p_customer->''deliveryAddress'');if coalesce((v_delivery_address_result->>''success'')::boolean,false)is not true then return private.ecommerce_public_error(coalesce(v_delivery_address_result->>''errorCode'',''ECOMMERCE_DELIVERY_ADDRESS_INVALID''));end if;v_customer_delivery_address:=v_delivery_address_result->''address'';v_customer_address:=left(v_delivery_address_result->>''formatted'',500);elsif length(v_customer_address)<5 then return private.ecommerce_public_error(''ECOMMERCE_DELIVERY_ADDRESS_REQUIRED'');end if;else v_customer_address:=null;v_customer_delivery_address:=null;end if;'
  );

  if position('customer_phone,customer_address,customer_notes,subtotal' in v_definition) = 0
     or position('v_customer_phone,v_customer_address,nullif(v_customer_notes,'''')' in v_definition) = 0 then
    raise exception 'ECOMMERCE_DELIVERY_ADDRESS_MIGRATION_CREATE_INSERT_MISMATCH';
  end if;
  v_definition := replace(
    v_definition,
    'customer_phone,customer_address,customer_notes,subtotal',
    'customer_phone,customer_address,customer_delivery_address,customer_notes,subtotal'
  );
  v_definition := replace(
    v_definition,
    'v_customer_phone,v_customer_address,nullif(v_customer_notes,'''')',
    'v_customer_phone,v_customer_address,v_customer_delivery_address,nullif(v_customer_notes,'''')'
  );

  if position('''address'',v_customer_address,''notes'',v_customer_notes' in v_definition) = 0 then
    raise exception 'ECOMMERCE_DELIVERY_ADDRESS_MIGRATION_CREATE_WHATSAPP_MISMATCH';
  end if;
  v_definition := replace(
    v_definition,
    '''address'',v_customer_address,''notes'',v_customer_notes',
    '''address'',v_customer_address,''reference'',coalesce(v_customer_delivery_address->>''reference'',''''),''notes'',v_customer_notes'
  );

  execute v_definition;
end;
$patch_create_order$;

alter function public.ecommerce_create_order(text,jsonb,jsonb,text) owner to postgres;
revoke all on function public.ecommerce_create_order(text,jsonb,jsonb,text) from public;
grant execute on function public.ecommerce_create_order(text,jsonb,jsonb,text)
  to anon, authenticated, service_role;

do $patch_whatsapp$
declare
  v_definition text;
  v_before text := $fragment$
    || 'Entrega: ' || coalesce(p_fulfillment_method, '') || E'\n'
    || case
      when nullif(btrim(coalesce(p_customer ->> 'notes', '')), '') is not null
        then 'Indicaciones: ' || left(p_customer ->> 'notes', 1000)
      else 'Indicaciones: Ninguna'
    end,$fragment$;
  v_after text := $fragment$
    || 'Entrega: ' || coalesce(p_fulfillment_method, '') || E'\n'
    || case
      when lower(btrim(coalesce(p_fulfillment_method, ''))) = 'delivery'
        and nullif(btrim(coalesce(p_customer ->> 'address', '')), '') is not null
        then 'Direccion de entrega: ' || left(p_customer ->> 'address', 500) || E'\n'
      else ''
    end
    || case
      when lower(btrim(coalesce(p_fulfillment_method, ''))) = 'delivery'
        and nullif(btrim(coalesce(p_customer ->> 'reference', '')), '') is not null
        then 'Referencia para llegar: ' || left(p_customer ->> 'reference', 500) || E'\n'
      else ''
    end
    || case
      when nullif(btrim(coalesce(p_customer ->> 'notes', '')), '') is not null
        then 'Indicaciones: ' || left(p_customer ->> 'notes', 1000)
      else 'Indicaciones: Ninguna'
    end,$fragment$;
begin
  select pg_get_functiondef(p.oid)
  into v_definition
  from pg_proc p
  where p.oid = 'private.ecommerce_build_whatsapp_message(text,text,jsonb,jsonb,numeric,text)'::regprocedure;

  if v_definition is null then
    raise exception 'ECOMMERCE_DELIVERY_ADDRESS_MIGRATION_WHATSAPP_FUNCTION_MISSING';
  end if;
  if position(v_before in v_definition) = 0 then
    raise exception 'ECOMMERCE_DELIVERY_ADDRESS_MIGRATION_WHATSAPP_MISMATCH';
  end if;
  v_definition := replace(v_definition, v_before, v_after);
  execute v_definition;
end;
$patch_whatsapp$;

alter function private.ecommerce_build_whatsapp_message(text,text,jsonb,jsonb,numeric,text) owner to postgres;
revoke all on function private.ecommerce_build_whatsapp_message(text,text,jsonb,jsonb,numeric,text)
  from public, anon, authenticated;

do $patch_snapshot$
declare
  v_definition text;
  v_before text := $fragment$
    'customer', jsonb_build_object(
      'name', v_order.customer_name,
      'phone', v_order.customer_phone,
      'address', v_order.customer_address,
      'notes', v_order.customer_notes
    ),$fragment$;
  v_after text := $fragment$
    'customer', jsonb_build_object(
      'name', v_order.customer_name,
      'phone', v_order.customer_phone,
      'address', v_order.customer_address,
      'notes', v_order.customer_notes,
      'deliveryAddress', v_order.customer_delivery_address
    ),$fragment$;
begin
  select pg_get_functiondef(p.oid)
  into v_definition
  from pg_proc p
  where p.oid = 'private.ecommerce_order_pos_snapshot_v1(uuid,uuid,jsonb)'::regprocedure;

  if v_definition is null then
    raise exception 'ECOMMERCE_DELIVERY_ADDRESS_MIGRATION_SNAPSHOT_FUNCTION_MISSING';
  end if;
  if position(v_before in v_definition) = 0 then
    raise exception 'ECOMMERCE_DELIVERY_ADDRESS_MIGRATION_SNAPSHOT_MISMATCH';
  end if;
  v_definition := replace(v_definition, v_before, v_after);
  execute v_definition;
end;
$patch_snapshot$;

alter function private.ecommerce_order_pos_snapshot_v1(uuid,uuid,jsonb) owner to postgres;
revoke all on function private.ecommerce_order_pos_snapshot_v1(uuid,uuid,jsonb)
  from public, anon, authenticated;
