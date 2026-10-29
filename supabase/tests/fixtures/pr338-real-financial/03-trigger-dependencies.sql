\set ON_ERROR_STOP on
SET check_function_bodies = off;
CREATE OR REPLACE FUNCTION private.assign_pos_sale_operational_folio_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.license_id is null
     or new.folio_sequence is null
     or lower(coalesce(new.source_mode, '')) <> 'cloud_committed'
     or lower(coalesce(new.sales_channel, 'local')) = 'ecommerce' then
    return new;
  end if;

  new.pos_folio := private.format_pos_operational_folio_v1(
    new.license_id,
    new.folio_sequence
  );

  if new.pos_folio is null then
    raise exception 'POS_OPERATIONAL_FOLIO_UNRESOLVED' using errcode = 'P0001';
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.broadcast_ecommerce_tracking_change_v1(p_order_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.ecommerce_orders%rowtype;
  v_tracking private.ecommerce_order_tracking_tokens%rowtype;
  v_topic text;
  v_payload jsonb;
begin
  if p_order_id is null then
    return jsonb_build_object('success', false, 'broadcasted', false);
  end if;

  select o.* into v_order
  from public.ecommerce_orders o
  where o.id = p_order_id
  limit 1;

  if v_order.id is null then
    return jsonb_build_object('success', false, 'broadcasted', false);
  end if;

  if private.ecommerce_license_feature_bool(
    v_order.license_id, 'ecommerce_realtime_orders', false
  ) is not true then
    return jsonb_build_object(
      'success', true, 'broadcasted', false, 'code', 'REALTIME_DISABLED'
    );
  end if;

  select t.* into v_tracking
  from private.ecommerce_order_tracking_tokens t
  where t.order_id = v_order.id
    and t.portal_id = v_order.portal_id
    and t.license_id = v_order.license_id
    and t.revoked_at is null
    and (t.expires_at is null or t.expires_at > now())
  limit 1;

  if v_tracking.order_id is null then
    return jsonb_build_object(
      'success', true, 'broadcasted', false, 'code', 'TRACKING_NOT_ISSUED'
    );
  end if;

  v_topic := private.ecommerce_tracking_topic_v1(v_tracking.token_hash);
  v_payload := jsonb_build_object(
    'event', 'tracking_changed',
    'reason', case
      when p_reason in ('order_status_changed','fulfillment_changed','payment_changed')
        then p_reason
      else 'order_changed'
    end,
    'version', greatest(v_order.fulfillment_version, 0),
    'created_at', now()
  );

  perform realtime.send(v_payload, 'tracking_changed', v_topic, true);
  return jsonb_build_object('success', true, 'broadcasted', true);
exception when others then
  return jsonb_build_object(
    'success', false,
    'broadcasted', false,
    'code', 'ECOMMERCE_TRACKING_BROADCAST_FAILED'
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION private.broadcast_license_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_target_fingerprint text;
  v_broadcast_all boolean;
  v_device record;
begin
  v_target_fingerprint := coalesce(
    new.metadata->>'fingerprint',
    new.metadata->>'target_fingerprint',
    new.metadata->>'device_fingerprint'
  );

  v_broadcast_all := new.event_type in (
    'LICENSE_UPDATE',
    'LICENSE_REVOKED',
    'LICENSE_SUSPENDED',
    'SUBSCRIPTION_UPDATED',
    'PLAN_CHANGED',
    'LICENSE_RENEWED',
    'BUSINESS_PROFILE_UPDATED'
  );

  for v_device in
    select d.realtime_topic, d.device_fingerprint
    from public.license_devices d
    join public.licenses l on l.id = d.license_id
    left join public.plans p on p.id = l.plan_id
    where l.license_key = new.license_key
      and d.realtime_topic is not null
      and private.license_realtime_enabled(p.features, l.features)
      and (
        (v_broadcast_all and d.is_active = true)
        or (v_target_fingerprint is not null and d.device_fingerprint = v_target_fingerprint)
      )
  loop
    perform realtime.send(
      jsonb_build_object(
        'event_type', new.event_type,
        'triggered_at', new.triggered_at,
        'metadata', coalesce(new.metadata, '{}'::jsonb)
      ),
      'license_event',
      v_device.realtime_topic,
      true
    );
  end loop;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.broadcast_notification_event(p_license_id uuid, p_event text DEFAULT 'notifications_changed'::text, p_reason text DEFAULT 'notification_created'::text, p_notification_id uuid DEFAULT NULL::uuid, p_ticket_id uuid DEFAULT NULL::uuid, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_features jsonb;
  v_topic text;
  v_topics_count integer := 0;
  v_payload jsonb;
  v_metadata jsonb;
begin
  if p_license_id is null then
    return jsonb_build_object('success', false, 'broadcasted', false, 'topics_count', 0, 'code', 'LICENSE_ID_REQUIRED');
  end if;

  select coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb)
  into v_features
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  where l.id = p_license_id
  limit 1;

  if v_features is null then
    return jsonb_build_object('success', false, 'broadcasted', false, 'topics_count', 0, 'code', 'LICENSE_NOT_FOUND');
  end if;

  if (v_features->>'notification_center') is distinct from 'true'
     or (v_features->>'cloud_notifications') is distinct from 'true'
     or (
       (v_features->>'support_realtime') is distinct from 'true'
       and (v_features->>'realtime_license_sync') is distinct from 'true'
     ) then
    return jsonb_build_object('success', true, 'broadcasted', false, 'topics_count', 0, 'code', 'REALTIME_DISABLED');
  end if;

  v_metadata := case
    when jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) = 'object' then coalesce(p_metadata, '{}'::jsonb)
    else '{}'::jsonb
  end;

  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'event', coalesce(nullif(p_event, ''), 'notifications_changed'),
    'notification_id', p_notification_id,
    'ticket_id', p_ticket_id,
    'reason', coalesce(nullif(p_reason, ''), 'notification_created'),
    'created_at', now(),
    'metadata', v_metadata
  ));

  for v_topic in
    select distinct d.realtime_topic
    from public.license_devices d
    where d.license_id = p_license_id
      and d.is_active is true
      and d.realtime_topic is not null
      and d.realtime_topic like 'license:%'
  loop
    perform realtime.send(v_payload, 'notification_event', v_topic, true);
    v_topics_count := v_topics_count + 1;
  end loop;

  return jsonb_build_object(
    'success', true,
    'broadcasted', v_topics_count > 0,
    'topics_count', v_topics_count
  );
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'broadcasted', false,
      'topics_count', coalesce(v_topics_count, 0),
      'code', 'BROADCAST_NOTIFICATION_EVENT_ERROR'
    );
end;
$function$
;
CREATE OR REPLACE FUNCTION private.broadcast_staff_notification_access_change_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if old.permissions is not distinct from new.permissions
     and old.is_active is not distinct from new.is_active then
    return new;
  end if;

  perform private.broadcast_notification_event(
    p_license_id => new.license_id,
    p_event => 'notifications_changed',
    p_reason => 'staff_notification_access_changed',
    p_metadata => jsonb_build_object(
      'scope', 'staff_notification_access',
      'access_changed', true
    )
  );

  return new;
exception
  when others then
    -- Permission persistence remains authoritative even if Realtime delivery is
    -- temporarily unavailable. The next RPC/TTL refresh still enforces access.
    return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.calculate_pos_shelf_life_target(p_base_date timestamp with time zone, p_shelf_life_value numeric, p_shelf_life_unit text DEFAULT 'days'::text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_base timestamptz := coalesce(p_base_date, now());
  v_value numeric := coalesce(p_shelf_life_value, 0);
  v_unit text := translate(lower(btrim(coalesce(p_shelf_life_unit, 'days'))), 'áéíóúü', 'aeiouu');
begin
  if v_value <= 0 then
    return null;
  end if;

  if v_unit in ('hour', 'hours', 'hora', 'horas') then
    return v_base + ((v_value::text || ' hours')::interval);
  elsif v_unit in ('month', 'months', 'mes', 'meses') then
    return v_base + ((v_value::text || ' months')::interval);
  end if;

  return v_base + ((v_value::text || ' days')::interval);
end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_broadcast_tracking_change_trigger_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reason text := 'order_changed';
begin
  if new.fulfillment_status is distinct from old.fulfillment_status
     or new.fulfillment_version is distinct from old.fulfillment_version
     or new.public_status_message is distinct from old.public_status_message then
    v_reason := 'fulfillment_changed';
  elsif new.payment_status is distinct from old.payment_status
     or new.converted_sale_id is distinct from old.converted_sale_id
     or new.pos_conversion_status is distinct from old.pos_conversion_status then
    v_reason := 'payment_changed';
  elsif new.status is distinct from old.status then
    v_reason := 'order_status_changed';
  else
    return new;
  end if;

  perform private.broadcast_ecommerce_tracking_change_v1(new.id, v_reason);
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_bump_catalog_revision_on_product_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_old_signature jsonb;
  v_new_signature jsonb;
  v_portal_id uuid;
begin
  if tg_op = 'INSERT' then
    v_old_signature := null;
    v_new_signature := private.ecommerce_product_public_signature(new);
    v_portal_id := new.portal_id;
  elsif tg_op = 'DELETE' then
    v_old_signature := private.ecommerce_product_public_signature(old);
    v_new_signature := null;
    v_portal_id := old.portal_id;
  else
    v_old_signature := private.ecommerce_product_public_signature(old);
    v_new_signature := private.ecommerce_product_public_signature(new);
    v_portal_id := new.portal_id;
  end if;

  if v_old_signature is distinct from v_new_signature then
    update public.ecommerce_portals
    set catalog_revision = catalog_revision + 1
    where id = v_portal_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_business_capability_parent_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if old.public_configuration_mode = 'simple_override' and new.public_configuration_mode = 'simple_override' then
    new.configuration_type := 'simple';
    new.has_option_groups := false;
    new.requires_configuration := new.has_variants;
  end if;
  if new.public_configuration_mode in ('requires_review', 'hidden_incompatible') then
    new.wholesale_enabled := false;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_business_supports_capability(p_license_id uuid, p_capability text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with types as (
    select unnest(private.ecommerce_normalized_business_types(p_license_id)) value
  )
  select case p_capability
    when 'restaurant_modifiers' then exists (
      select 1 from types where value = 'food_service'
    )
    when 'wholesale_pricing' then exists (
      select 1 from types
      where value in ('abarrotes','hardware','apparel','verduleria/fruteria')
    )
    when 'variants' then exists (
      select 1 from types
      where value in ('abarrotes','hardware','apparel','farmacia')
    )
    when 'bulk_sales' then exists (
      select 1 from types
      where value in ('abarrotes','hardware','verduleria/fruteria')
    )
    when 'prescription_fields' then exists (
      select 1 from types where value = 'farmacia'
    )
    when 'recipes' then exists (
      select 1 from types where value = 'food_service'
    )
    else false
  end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_convert_inventory_quantity(p_quantity numeric, p_from_unit text, p_to_unit text)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_from text := private.ecommerce_normalize_inventory_unit(p_from_unit);
  v_to text := private.ecommerce_normalize_inventory_unit(p_to_unit);
  v_base numeric;
begin
  if p_quantity is null or v_from is null or v_to is null
     or private.ecommerce_inventory_unit_family(v_from)
        is distinct from private.ecommerce_inventory_unit_family(v_to) then
    return null;
  end if;
  v_base := case v_from
    when 'kg' then p_quantity * 1000
    when 'lt' then p_quantity * 1000
    else p_quantity
  end;
  return case v_to
    when 'kg' then v_base / 1000
    when 'lt' then v_base / 1000
    else v_base
  end;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_finalize_order_stock_reservations(p_order_id uuid, p_license_id uuid, p_transition text, p_idempotency_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reservation public.ecommerce_order_inventory_reservations%rowtype;
  v_product public.pos_products%rowtype;
  v_batch public.pos_product_batches%rowtype;
  v_product_committed numeric(12,3);
  v_order public.ecommerce_orders%rowtype;
  v_key text;
begin
  if p_transition not in ('released', 'expired', 'consumed') then
    raise exception 'ECOMMERCE_RESERVATION_TRANSITION_INVALID' using errcode = 'P0001';
  end if;
  select * into v_order from public.ecommerce_orders
   where id = p_order_id and license_id = p_license_id for update;
  if v_order.id is null then return; end if;

  if p_transition = 'consumed' and exists (
    select 1 from public.ecommerce_order_inventory_reservations r
     where r.order_id = p_order_id and r.license_id = p_license_id
       and r.status = 'reserved'
       and coalesce(r.reservation_phase, 'checkout') <> 'fulfillment'
  ) then
    raise exception 'ECOMMERCE_FULFILLMENT_RESERVATION_REQUIRED' using errcode = 'P0001';
  end if;

  for v_reservation in
    select * from public.ecommerce_order_inventory_reservations
     where order_id = p_order_id and license_id = p_license_id and status = 'reserved'
     order by source_product_id, coalesce(batch_id, ''), id
     for update
  loop
    v_key := p_idempotency_key || ':' || v_reservation.id::text;
    select * into v_product from public.pos_products
     where id = v_reservation.source_product_id and license_id = p_license_id for update;
    if v_product.id is null then raise exception 'ECOMMERCE_RESERVATION_SOURCE_MISSING' using errcode = 'P0001'; end if;
    if v_reservation.batch_id is not null then
      select * into v_batch from public.pos_product_batches
       where id = v_reservation.batch_id and product_id = v_product.id and license_id = p_license_id for update;
      if v_batch.id is null then raise exception 'ECOMMERCE_RESERVATION_SOURCE_MISSING' using errcode = 'P0001'; end if;
      update public.pos_product_batches
         set committed_stock = greatest(committed_stock - v_reservation.quantity, 0),
             updated_at = now(), server_version = server_version + 1, last_idempotency_key = v_key
       where id = v_batch.id and license_id = p_license_id;
      select coalesce(sum(committed_stock), 0) into v_product_committed
        from public.pos_product_batches
       where product_id = v_product.id and license_id = p_license_id and deleted_at is null;
      update public.pos_products
         set committed_stock = v_product_committed, updated_at = now(),
             server_version = server_version + 1, last_idempotency_key = v_key
       where id = v_product.id and license_id = p_license_id;
    else
      update public.pos_products
         set committed_stock = greatest(committed_stock - v_reservation.quantity, 0),
             updated_at = now(), server_version = server_version + 1, last_idempotency_key = v_key
       where id = v_product.id and license_id = p_license_id;
    end if;
    update public.ecommerce_order_inventory_reservations
       set status = p_transition,
           released_at = case when p_transition in ('released', 'expired') then now() else released_at end,
           consumed_at = case when p_transition = 'consumed' then now() else consumed_at end,
           updated_at = now(),
           metadata = metadata || jsonb_build_object('finalizationKey', v_key, 'finalizationPhase', coalesce(v_reservation.reservation_phase, 'checkout'))
     where id = v_reservation.id;
    select * into v_reservation from public.ecommerce_order_inventory_reservations where id = v_reservation.id;
    perform private.ecommerce_record_reservation_event(v_reservation, p_transition, v_key);
  end loop;
  update public.ecommerce_orders
     set stock_reservation_status = p_transition, stock_reservation_phase = null,
         stock_reservation_expires_at = null, fulfillment_hold_expires_at = null, updated_at = now()
   where id = p_order_id and license_id = p_license_id and stock_reservation_status = 'reserved';
end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_initialize_order_fulfillment_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.status in ('accepted', 'converted_to_sale')
     and new.fulfillment_status is null then
    new.fulfillment_status := 'accepted';
    new.fulfillment_version := greatest(coalesce(new.fulfillment_version, 0), 1);
    new.fulfillment_updated_at := coalesce(new.accepted_at, new.updated_at, now());
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_inventory_unit_family(p_unit text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case private.ecommerce_normalize_inventory_unit(p_unit)
    when 'pza' then 'count'
    when 'kg' then 'mass'
    when 'g' then 'mass'
    when 'lt' then 'volume'
    when 'ml' then 'volume'
    else null
  end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_license_feature_bool(p_license_id uuid, p_feature_key text, p_default boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_value text;
begin
  v_value := private.ecommerce_license_feature_text(p_license_id, p_feature_key);

  if v_value is null then
    return p_default;
  end if;

  return v_value::boolean;
exception
  when others then
    return p_default;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_license_feature_int(p_license_id uuid, p_feature_key text, p_default integer DEFAULT 0)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_value text;
begin
  v_value := private.ecommerce_license_feature_text(p_license_id, p_feature_key);

  if v_value is null then
    return p_default;
  end if;

  return v_value::integer;
exception
  when others then
    return p_default;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_license_feature_text(p_license_id uuid, p_feature_key text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select entitlement.effective_features ->> p_feature_key
  from private.license_entitlement_state_v1(p_license_id) entitlement
  where entitlement.is_entitled
  limit 1;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_normalize_inventory_unit(p_unit text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case lower(btrim(coalesce(p_unit,'')))
    when 'pza' then 'pza' when 'pzas' then 'pza'
    when 'pieza' then 'pza' when 'piezas' then 'pza'
    when 'unidad' then 'pza' when 'unidades' then 'pza'
    when 'kg' then 'kg' when 'kgs' then 'kg'
    when 'kilo' then 'kg' when 'kilos' then 'kg'
    when 'kilogramo' then 'kg' when 'kilogramos' then 'kg'
    when 'g' then 'g' when 'gr' then 'g' when 'grs' then 'g'
    when 'gramo' then 'g' when 'gramos' then 'g'
    when 'l' then 'lt' when 'lt' then 'lt' when 'lts' then 'lt'
    when 'litro' then 'lt' when 'litros' then 'lt'
    when 'ml' then 'ml' when 'mililitro' then 'ml' when 'mililitros' then 'ml'
    else null
  end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_normalize_sync_config(p_config jsonb, p_fallback jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with source as (
    select case
      when jsonb_typeof(p_config) = 'object' then p_config
      when jsonb_typeof(p_fallback) = 'object' then p_fallback
      else '{}'::jsonb
    end as value
  )
  select jsonb_build_object(
    'name', case when value->>'name' = 'source' then 'source' else 'manual' end,
    'description', case when value->>'description' = 'source' then 'source' else 'manual' end,
    'category', case when value->>'category' = 'source' then 'source' else 'manual' end,
    'price', case when value->>'price' = 'source' then 'source' else 'manual' end,
    'image', case when value->>'image' = 'source' then 'source' else 'manual' end
  )
  from source;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_normalized_business_types(p_license_id uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(array_agg(distinct normalized order by normalized), '{}'::text[])
  from (
    select case lower(btrim(raw_type::text))
      when 'restaurante' then 'food_service'
      when 'darkitchen' then 'food_service'
      when 'antojitos' then 'food_service'
      when 'food_service' then 'food_service'
      when 'abarrotes' then 'abarrotes'
      when 'hardware' then 'hardware'
      when 'apparel' then 'apparel'
      when 'farmacia' then 'farmacia'
      when 'verduleria/fruteria' then 'verduleria/fruteria'
      else null
    end normalized
    from public.business_profiles bp,
         unnest(coalesce(bp.business_type, '{}'::public.business_category[])) raw_type
    where bp.license_id = p_license_id
  ) values_normalized
  where normalized is not null;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_order_fulfillment_terminal_v1(p_status text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(p_status in ('completed', 'cancelled'), false);
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_order_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_license_id uuid;
  v_stock_reservation_allowed boolean;
begin
  select p.license_id
  into v_license_id
  from public.ecommerce_portals p
  where p.id = new.portal_id
    and p.deleted_at is null;

  if v_license_id is null then
    raise exception 'ECOMMERCE_PORTAL_NOT_FOUND';
  end if;

  new.license_id := v_license_id;

  if new.stock_reservation_status <> 'not_applicable' then
    v_stock_reservation_allowed := private.ecommerce_license_feature_bool(new.license_id, 'ecommerce_stock_reservation', false);
    if v_stock_reservation_allowed is not true then
      raise exception 'ECOMMERCE_STOCK_RESERVATION_REQUIRES_PRO';
    end if;
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_order_item_enrich_variant_identity_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_variant_id uuid;
  v_variant public.ecommerce_published_product_variants%rowtype;
begin
  if jsonb_typeof(new.options) <> 'object' then
    return new;
  end if;

  begin
    v_variant_id := nullif(btrim(coalesce(new.options #>> '{variant,id}', '')), '')::uuid;
  exception
    when invalid_text_representation then
      return new;
  end;

  if v_variant_id is null or new.published_product_id is null then
    return new;
  end if;

  select v.*
    into v_variant
  from public.ecommerce_published_product_variants v
  where v.id = v_variant_id
    and v.published_product_id = new.published_product_id
    and v.portal_id = new.portal_id
    and v.license_id = new.license_id
    and v.deleted_at is null
  limit 1;

  if v_variant.id is null then
    return new;
  end if;

  new.options := jsonb_set(
    new.options,
    '{variant,sourceVariantRef}',
    to_jsonb(v_variant.source_variant_ref),
    true
  );
  new.options := jsonb_set(
    new.options,
    '{variant,sku}',
    coalesce(to_jsonb(v_variant.sku), 'null'::jsonb),
    true
  );

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_order_item_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order record;
begin
  select o.license_id, o.portal_id
  into v_order
  from public.ecommerce_orders o
  where o.id = new.order_id;

  if v_order.license_id is null then
    raise exception 'ECOMMERCE_ORDER_NOT_FOUND';
  end if;

  new.license_id := v_order.license_id;
  new.portal_id := v_order.portal_id;
  new.line_total := round((new.unit_price * new.quantity)::numeric, 2);

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_order_item_phase4_tenant_scope_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.published_product_id is not null
     and not exists (
       select 1
       from public.ecommerce_published_products p
       where p.id = new.published_product_id
         and p.portal_id = new.portal_id
         and p.license_id = new.license_id
     ) then
    raise exception 'ECOMMERCE_TENANT_SCOPE_MISMATCH' using errcode = '23514';
  end if;

  if private.ecommerce_reservation_variant_id(new.options) is not null
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

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_order_item_reservation_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.ecommerce_reserve_order_item_stock(new.id);
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_order_reservation_lifecycle_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if old.stock_reservation_status <> 'reserved' then return new; end if;
  if new.status in ('rejected', 'cancelled') or new.fulfillment_status = 'cancelled' then
    perform private.ecommerce_finalize_order_stock_reservations(new.id, new.license_id, 'released', 'ecommerce:cancel:' || new.id::text);
  elsif (new.status = 'converted_to_sale' and new.pos_conversion_status = 'completed' and new.converted_sale_id is not null)
     or (new.fulfillment_status = 'completed' and old.fulfillment_status is distinct from 'completed') then
    perform private.ecommerce_finalize_order_stock_reservations(
      new.id, new.license_id, 'consumed',
      'ecommerce:consume:' || coalesce(new.converted_sale_id, new.id::text)
    );
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_orders_block_terminal_pos_mutation_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if private.ecommerce_order_fulfillment_terminal_v1(old.fulfillment_status) then
    if (
      (
        new.pos_draft_status in ('claimed', 'prepared')
        and (
          new.pos_draft_status is distinct from old.pos_draft_status
          or new.pos_draft_id is distinct from old.pos_draft_id
          or new.pos_claim_token is distinct from old.pos_claim_token
          or new.pos_claim_request_key is distinct from old.pos_claim_request_key
          or new.pos_claim_expires_at is distinct from old.pos_claim_expires_at
          or new.pos_claim_actor_ref is distinct from old.pos_claim_actor_ref
        )
      )
      or (
        new.pos_conversion_status = 'reserved'
        and (
          new.pos_conversion_status is distinct from old.pos_conversion_status
          or new.pos_conversion_attempt_id is distinct from old.pos_conversion_attempt_id
          or new.pos_conversion_sale_id is distinct from old.pos_conversion_sale_id
          or new.pos_conversion_key is distinct from old.pos_conversion_key
          or new.pos_conversion_actor_ref is distinct from old.pos_conversion_actor_ref
        )
      )
      or (
        new.pos_conversion_status = 'completed'
        and old.pos_conversion_status is distinct from 'completed'
      )
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'ECOMMERCE_ORDER_FULFILLMENT_TERMINAL';
    end if;
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_product_public_jsonb(p_product ecommerce_published_products, p_allow_stock_visibility boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id', p_product.id, 'name', p_product.public_name,
    'description', p_product.public_description, 'categoryName', p_product.category_name,
    'price', p_product.price, 'currency', p_product.currency, 'imageUrl', p_product.image_url,
    'isAvailable', private.ecommerce_product_publicly_available(p_product),
    'displayOrder', p_product.display_order,
    'configuration', jsonb_build_object(
      'type', p_product.configuration_type, 'version', p_product.configuration_version,
      'hasVariants', p_product.has_variants, 'hasOptionGroups', p_product.has_option_groups,
      'requiresConfiguration', p_product.requires_configuration
    ),
    'wholesaleEnabled', p_product.wholesale_enabled,
    'wholesaleRevision', p_product.wholesale_revision,
    'wholesaleTiers', case when p_product.wholesale_enabled then coalesce((
      select jsonb_agg(jsonb_build_object('sourceTierRef', t.source_tier_ref, 'minQuantity', t.min_quantity, 'unitPrice', t.unit_price) order by t.min_quantity)
      from public.ecommerce_published_wholesale_tiers t
      where t.published_product_id = p_product.id and t.portal_id = p_product.portal_id
        and t.license_id = p_product.license_id and t.deleted_at is null
        and t.manual_available and t.source_available and t.is_available
    ), '[]'::jsonb) else '[]'::jsonb end,
    'stock', case
      when p_allow_stock_visibility is not true then jsonb_build_object('mode', 'hidden', 'status', null, 'quantity', null)
      when p_product.stock_mode = 'status' then jsonb_build_object(
        'mode', 'status', 'status', case
          when not private.ecommerce_product_publicly_available(p_product) or coalesce(p_product.stock_snapshot, 0) <= 0 then 'out_of_stock'
          when p_product.stock_snapshot <= 3 then 'low_stock' else 'available' end, 'quantity', null)
      when p_product.stock_mode in ('exact', 'reserve_on_confirm') then jsonb_build_object(
        'mode', 'exact', 'status', case
          when not private.ecommerce_product_publicly_available(p_product) or coalesce(p_product.stock_snapshot, 0) <= 0 then 'out_of_stock'
          when p_product.stock_snapshot <= 3 then 'low_stock' else 'available' end,
        'quantity', greatest(floor(coalesce(p_product.stock_snapshot, 0)), 0))
      else jsonb_build_object('mode', 'hidden', 'status', case when private.ecommerce_product_publicly_available(p_product) then 'available' else 'out_of_stock' end, 'quantity', null)
    end,
    'options', p_product.options
  )
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_product_public_signature(p_product ecommerce_published_products)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when p_product.id is null
      or p_product.deleted_at is not null
      or p_product.is_published is not true then null
    else private.ecommerce_product_public_jsonb(
      p_product,
      private.ecommerce_license_feature_bool(
        p_product.license_id,
        'ecommerce_stock_visibility',
        false
      )
    )
  end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_product_publicly_available(p_product ecommerce_published_products)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_product.id is null or p_product.deleted_at is not null
     or p_product.is_published is not true
     or p_product.manual_available is not true then return false; end if;
  if p_product.business_capability_status not in ('compatible','simple_override')
     or p_product.public_configuration_mode in ('requires_review','hidden_incompatible')
     then return false; end if;
  if p_product.requires_configuration is not true then
    return p_product.is_available is true;
  end if;
  if p_product.availability_source = 'unverified' then return false; end if;
  if p_product.has_variants is true then
    return exists(
      select 1 from public.ecommerce_published_product_variants v
      where v.published_product_id = p_product.id
        and v.portal_id = p_product.portal_id
        and v.license_id = p_product.license_id
        and v.deleted_at is null and v.manual_available
        and v.source_available and v.is_available
    );
  end if;
  if p_product.availability_source = 'not_tracked' then return true; end if;
  if p_product.source_available is not true then return false; end if;
  if p_product.stock_mode in ('status','exact','reserve_on_confirm')
     and p_product.stock_snapshot is not null
     and p_product.stock_snapshot <= 0 then return false; end if;
  return true;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_profile_capability_reconcile_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'INSERT'
     or old.business_type is distinct from new.business_type then
    perform private.ecommerce_reconcile_license_capabilities(new.license_id);
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_published_product_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_license_id uuid;
  v_limit integer;
  v_current_count integer;
  v_stock_allowed boolean;
begin
  select p.license_id
  into v_license_id
  from public.ecommerce_portals p
  where p.id = new.portal_id
    and p.deleted_at is null;

  if v_license_id is null then
    raise exception 'ECOMMERCE_PORTAL_NOT_FOUND';
  end if;

  new.license_id := v_license_id;

  if new.is_published is true and new.deleted_at is null then
    v_limit := private.ecommerce_license_feature_int(new.license_id, 'ecommerce_max_published_products', 0);

    if v_limit >= 0 then
      select count(*)
      into v_current_count
      from public.ecommerce_published_products pp
      where pp.portal_id = new.portal_id
        and pp.deleted_at is null
        and pp.is_published is true
        and (tg_op = 'INSERT' or pp.id <> new.id);

      if v_current_count >= v_limit then
        raise exception 'ECOMMERCE_PRODUCT_LIMIT_REACHED';
      end if;
    end if;
  end if;

  if new.stock_mode in ('status', 'exact', 'reserve_on_confirm') then
    v_stock_allowed := private.ecommerce_license_feature_bool(new.license_id, 'ecommerce_stock_visibility', false);
    if v_stock_allowed is not true then
      raise exception 'ECOMMERCE_STOCK_VISIBILITY_REQUIRES_PRO';
    end if;
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_published_product_sync_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  new.sync_config := private.ecommerce_normalize_sync_config(
    new.sync_config,
    case when tg_op = 'UPDATE' then old.sync_config else null end
  );

  if tg_op = 'INSERT' then
    new.manual_available := coalesce(new.is_available, new.manual_available, true);
    new.source_available := coalesce(new.source_available, true);
  elsif new.manual_available is not distinct from old.manual_available
        and new.source_available is not distinct from old.source_available
        and new.requires_configuration is not distinct from old.requires_configuration
        and new.is_available is distinct from old.is_available then
    new.manual_available := coalesce(new.is_available, old.manual_available, true);
  end if;

  new.manual_available := coalesce(new.manual_available, true);
  new.source_available := coalesce(new.source_available, true);
  new.requires_configuration := coalesce(new.requires_configuration, false);

  if new.source_state = 'not_tracked' then
    new.track_stock := false;
    new.stock_mode := 'hidden';
    new.stock_snapshot := null;
  end if;

  if tg_op = 'UPDATE' and new.source_state in ('unverified', 'source_missing') then
    new.public_name := old.public_name;
    new.public_description := old.public_description;
    new.category_name := old.category_name;
    new.price := old.price;
    new.image_url := old.image_url;
    new.stock_snapshot := old.stock_snapshot;
    new.stock_updated_at := old.stock_updated_at;
  end if;

  if tg_op = 'UPDATE' and new.source_state = 'unverified' then
    new.source_available := old.source_available;
    new.source_revision := old.source_revision;
    new.source_revision_kind := old.source_revision_kind;
    new.source_revision_order := old.source_revision_order;
    new.source_payload_hash := old.source_payload_hash;
  elsif tg_op = 'UPDATE' and new.source_state = 'source_missing' then
    new.source_state := 'unverified';
    new.source_available := old.source_available;
    new.source_revision := old.source_revision;
    new.source_revision_kind := old.source_revision_kind;
    new.source_revision_order := old.source_revision_order;
    new.source_payload_hash := old.source_payload_hash;
    new.sync_status := 'review';
    new.sync_error_code := 'SOURCE_UNVERIFIED';
    new.last_synced_at := old.last_synced_at;
  end if;

  new.is_available := new.manual_available
    and new.source_available
    and not new.requires_configuration;

  if new.sync_status not in ('synced', 'pending', 'review', 'error', 'manual') then
    new.sync_status := 'error';
    new.sync_error_code := 'INVALID_SYNC_STATUS';
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_recipe_capacity(p_license_id uuid, p_recipe jsonb, p_evaluation_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_component jsonb;
  v_ingredient public.pos_products%rowtype;
  v_ingredient_id text;
  v_ingredient_name text;
  v_quantity numeric;
  v_recipe_unit text;
  v_inventory_unit text;
  v_inventory_available numeric;
  v_available_in_recipe_unit numeric;
  v_capacity bigint;
  v_min_capacity bigint;
  v_limiting_id text;
  v_limiting_name text;
  v_components jsonb := '[]'::jsonb;
  v_diagnostics text[] := '{}'::text[];
  v_has_tracked boolean := false;
  v_has_unverified boolean := false;
  v_has_zero boolean := false;
  v_zero_id text;
  v_zero_name text;
begin
  if jsonb_typeof(p_recipe) <> 'array' or jsonb_array_length(p_recipe) = 0 then
    return jsonb_build_object(
      'verified', false, 'status', 'not_recipe', 'availableStock', null,
      'reasonCode', 'RECIPE_EMPTY', 'components', '[]'::jsonb
    );
  end if;

  for v_component in select value from jsonb_array_elements(p_recipe)
  loop
    v_ingredient_id := nullif(btrim(coalesce(
      v_component->>'ingredientId',
      v_component->>'ingredient_id',
      v_component->>'productId'
    )), '');
    v_quantity := nullif(coalesce(
      v_component->>'quantity',
      v_component->>'ingredientQuantity',
      v_component->>'ingredient_quantity'
    ), '')::numeric;

    if v_ingredient_id is null then
      v_has_unverified := true;
      v_diagnostics := array_append(v_diagnostics, 'RECIPE_INGREDIENT_MISSING');
      v_components := v_components || jsonb_build_array(jsonb_build_object(
        'ingredientId', null, 'verified', false,
        'reasonCode', 'RECIPE_INGREDIENT_MISSING'
      ));
      continue;
    end if;
    if v_quantity is null or v_quantity <= 0 then
      v_has_unverified := true;
      v_diagnostics := array_append(v_diagnostics, 'RECIPE_QUANTITY_INVALID');
      v_components := v_components || jsonb_build_array(jsonb_build_object(
        'ingredientId', v_ingredient_id, 'verified', false,
        'reasonCode', 'RECIPE_QUANTITY_INVALID'
      ));
      continue;
    end if;

    select p.* into v_ingredient
    from public.pos_products p
    where p.id = v_ingredient_id
      and p.license_id = p_license_id
      and p.deleted_at is null
    limit 1;

    if v_ingredient.id is null then
      v_has_unverified := true;
      v_diagnostics := array_append(v_diagnostics, 'RECIPE_INGREDIENT_MISSING');
      v_components := v_components || jsonb_build_array(jsonb_build_object(
        'ingredientId', v_ingredient_id, 'verified', false,
        'reasonCode', 'RECIPE_INGREDIENT_MISSING'
      ));
      continue;
    end if;

    v_ingredient_name := v_ingredient.name;
    if v_ingredient.is_active is not true then
      v_has_unverified := true;
      v_diagnostics := array_append(v_diagnostics, 'RECIPE_INGREDIENT_INACTIVE');
      v_components := v_components || jsonb_build_array(jsonb_build_object(
        'ingredientId', v_ingredient_id, 'ingredientName', v_ingredient_name,
        'verified', false, 'reasonCode', 'RECIPE_INGREDIENT_INACTIVE'
      ));
      continue;
    end if;

    if v_ingredient.track_stock is false then
      v_components := v_components || jsonb_build_array(jsonb_build_object(
        'ingredientId', v_ingredient_id, 'ingredientName', v_ingredient_name,
        'verified', true, 'tracked', false, 'capacity', null,
        'reasonCode', 'RECIPE_INGREDIENT_UNTRACKED'
      ));
      continue;
    end if;
    v_has_tracked := true;

    v_inventory_unit := private.ecommerce_normalize_inventory_unit(coalesce(
      v_ingredient.bulk_data #>> '{purchase,unit}',
      v_ingredient.bulk_data->>'unit',
      v_ingredient.metadata->>'unit',
      'pza'
    ));
    v_recipe_unit := private.ecommerce_normalize_inventory_unit(coalesce(
      v_component->>'unit',
      v_component->>'ingredientUnit',
      v_component->>'ingredient_unit',
      v_inventory_unit
    ));
    if v_inventory_unit is null or v_recipe_unit is null
       or private.ecommerce_inventory_unit_family(v_inventory_unit)
          is distinct from private.ecommerce_inventory_unit_family(v_recipe_unit) then
      v_has_unverified := true;
      v_diagnostics := array_append(v_diagnostics, 'RECIPE_UNIT_INCOMPATIBLE');
      v_components := v_components || jsonb_build_array(jsonb_build_object(
        'ingredientId', v_ingredient_id, 'ingredientName', v_ingredient_name,
        'verified', false, 'reasonCode', 'RECIPE_UNIT_INCOMPATIBLE'
      ));
      continue;
    end if;

    if coalesce((v_ingredient.batch_management->>'enabled')::boolean, false) then
      select coalesce(sum(greatest(b.stock - b.committed_stock, 0)),0)
      into v_inventory_available
      from public.pos_product_batches b
      where b.license_id = p_license_id
        and b.product_id = v_ingredient_id
        and b.deleted_at is null
        and b.is_active is true
        and lower(coalesce(b.status,'active')) not in (
          'inactive','blocked','quarantined','deleted','removed','archived'
        )
        and (b.expiry_date is null or b.expiry_date::date >= p_evaluation_date);
    else
      v_inventory_available := greatest(
        v_ingredient.stock - v_ingredient.committed_stock,
        0
      );
    end if;

    if v_inventory_available is null or v_inventory_available < 0 then
      v_has_unverified := true;
      v_diagnostics := array_append(v_diagnostics, 'RECIPE_STOCK_INVALID');
      v_components := v_components || jsonb_build_array(jsonb_build_object(
        'ingredientId', v_ingredient_id, 'ingredientName', v_ingredient_name,
        'verified', false, 'reasonCode', 'RECIPE_STOCK_INVALID'
      ));
      continue;
    end if;

    v_available_in_recipe_unit := private.ecommerce_convert_inventory_quantity(
      v_inventory_available, v_inventory_unit, v_recipe_unit
    );
    if v_available_in_recipe_unit is null then
      v_has_unverified := true;
      v_diagnostics := array_append(v_diagnostics, 'RECIPE_UNIT_INCOMPATIBLE');
      continue;
    end if;

    v_capacity := greatest(floor(v_available_in_recipe_unit / v_quantity),0)::bigint;
    v_components := v_components || jsonb_build_array(jsonb_build_object(
      'ingredientId', v_ingredient_id,
      'ingredientName', v_ingredient_name,
      'verified', true,
      'tracked', true,
      'inventoryUnit', v_inventory_unit,
      'recipeUnit', v_recipe_unit,
      'requiredPerUnit', v_quantity,
      'availableInventory', v_inventory_available,
      'capacity', v_capacity,
      'reasonCode', 'RECIPE_COMPONENT_CALCULATED'
    ));
    if v_capacity = 0 and not v_has_zero then
      v_has_zero := true;
      v_zero_id := v_ingredient_id;
      v_zero_name := v_ingredient_name;
    end if;
    if v_min_capacity is null or v_capacity < v_min_capacity then
      v_min_capacity := v_capacity;
      v_limiting_id := v_ingredient_id;
      v_limiting_name := v_ingredient_name;
    end if;
  end loop;

  if not v_has_tracked and not v_has_unverified then
    return jsonb_build_object(
      'verified', true, 'status', 'not_tracked', 'availableStock', null,
      'reasonCode', 'RECIPE_ALL_INGREDIENTS_UNTRACKED',
      'components', v_components
    );
  end if;
  if v_has_zero then
    return jsonb_build_object(
      'verified', true, 'status', 'out_of_stock', 'availableStock', 0,
      'limitingIngredientId', v_zero_id,
      'limitingIngredientName', v_zero_name,
      'reasonCode', 'RECIPE_CAPACITY_ZERO',
      'components', v_components,
      'diagnostics', to_jsonb(v_diagnostics)
    );
  end if;
  if v_has_unverified then
    return jsonb_build_object(
      'verified', false, 'status', 'unverified', 'availableStock', null,
      'reasonCode', coalesce(v_diagnostics[1], 'RECIPE_UNVERIFIED'),
      'components', v_components,
      'diagnostics', to_jsonb(v_diagnostics)
    );
  end if;
  return jsonb_build_object(
    'verified', true,
    'status', case when coalesce(v_min_capacity,0) > 0 then 'in_stock' else 'out_of_stock' end,
    'availableStock', greatest(coalesce(v_min_capacity,0),0),
    'limitingIngredientId', v_limiting_id,
    'limitingIngredientName', v_limiting_name,
    'reasonCode', 'RECIPE_CAPACITY_CALCULATED',
    'components', v_components
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object(
      'verified', false, 'status', 'unverified', 'availableStock', null,
      'reasonCode', 'RECIPE_QUANTITY_INVALID', 'components', v_components
    );
end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_reconcile_license_capabilities(p_license_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_portal_id uuid;
  v_product_id uuid;
  v_count integer := 0;
begin
  select id into v_portal_id
  from public.ecommerce_portals
  where license_id = p_license_id and deleted_at is null
  for update;
  if v_portal_id is null then return 0; end if;
  update public.ecommerce_portals
  set business_types_snapshot = private.ecommerce_normalized_business_types(p_license_id),
      updated_at = now()
  where id = v_portal_id;
  for v_product_id in
    select id from public.ecommerce_published_products
    where portal_id = v_portal_id and license_id = p_license_id
      and deleted_at is null
    order by id
    for update
  loop
    perform private.ecommerce_reconcile_published_product_capability(v_product_id);
    v_count := v_count + 1;
  end loop;
  if v_count > 0 then
    update public.ecommerce_portals
    set catalog_revision = catalog_revision + 1, updated_at = now()
    where id = v_portal_id;
  end if;
  return v_count;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_reconcile_published_product_capability(p_product_id uuid)
 RETURNS ecommerce_published_products
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_product public.ecommerce_published_products%rowtype;
  v_types text[];
  v_has_source_modifiers boolean := false;
  v_supports_modifiers boolean := false;
  v_supports_wholesale boolean := false;
  v_status text;
  v_reason text;
  v_mode text;
  v_wholesale boolean;
  v_is_published boolean;
begin
  select * into v_product
  from public.ecommerce_published_products
  where id = p_product_id and deleted_at is null
  for update;
  if v_product.id is null then return v_product; end if;

  v_types := private.ecommerce_normalized_business_types(v_product.license_id);
  v_supports_modifiers := private.ecommerce_business_supports_capability(
    v_product.license_id, 'restaurant_modifiers');
  v_supports_wholesale := private.ecommerce_business_supports_capability(
    v_product.license_id, 'wholesale_pricing');
  select coalesce(jsonb_typeof(p.modifiers) = 'array'
    and jsonb_array_length(p.modifiers) > 0, false)
  into v_has_source_modifiers
  from public.pos_products p
  where p.license_id = v_product.license_id
    and p.id = v_product.local_product_ref and p.deleted_at is null;

  v_wholesale := v_product.wholesale_enabled and v_supports_wholesale;
  if coalesce(array_length(v_types, 1), 0) = 0 then
    v_status := 'requires_review';
    v_reason := 'BUSINESS_TYPE_UNKNOWN';
    v_mode := case when v_product.public_configuration_mode = 'simple_override'
      then 'simple_override' else 'requires_review' end;
    v_wholesale := false;
  elsif v_has_source_modifiers and not v_supports_modifiers
        and v_product.public_configuration_mode <> 'simple_override' then
    v_status := 'requires_review';
    v_reason := 'RESTAURANT_MODIFIERS_NOT_SUPPORTED';
    v_mode := 'requires_review';
  elsif v_product.public_configuration_mode = 'simple_override' then
    v_status := 'simple_override';
    v_reason := case when v_has_source_modifiers and not v_supports_modifiers
      then 'RESTAURANT_MODIFIERS_NOT_SUPPORTED' end;
    v_mode := 'simple_override';
  else
    v_status := 'compatible';
    v_reason := null;
    v_mode := 'compatible';
  end if;

  v_is_published := v_product.is_published
    and v_status in ('compatible', 'simple_override')
    and v_mode in ('compatible', 'simple_override');

  update public.ecommerce_published_products
  set business_capability_status = v_status,
      business_capability_reason = v_reason,
      public_configuration_mode = v_mode,
      wholesale_enabled = v_wholesale,
      is_published = v_is_published,
      configuration_type = case when v_mode = 'simple_override'
        and not has_variants then 'simple' else configuration_type end,
      has_option_groups = case when v_mode = 'simple_override'
        then false else has_option_groups end,
      requires_configuration = case when v_mode = 'simple_override'
        then has_variants else requires_configuration end
  where id = v_product.id
    and (business_capability_status, business_capability_reason,
         public_configuration_mode, wholesale_enabled, is_published,
         configuration_type, has_option_groups, requires_configuration)
      is distinct from
        (v_status, v_reason, v_mode, v_wholesale, v_is_published,
         case when v_mode = 'simple_override' and not has_variants
           then 'simple' else configuration_type end,
         case when v_mode = 'simple_override' then false else has_option_groups end,
         case when v_mode = 'simple_override' then has_variants
           else requires_configuration end);

  if v_mode in ('simple_override','requires_review','hidden_incompatible') then
    update public.ecommerce_published_option_groups
    set deleted_at = now(), updated_at = now()
    where published_product_id = v_product.id and deleted_at is null;
    update public.ecommerce_published_options
    set deleted_at = now(), updated_at = now()
    where published_product_id = v_product.id and deleted_at is null;
  end if;
  if not v_wholesale then
    update public.ecommerce_published_wholesale_tiers
    set deleted_at = now(), updated_at = now()
    where published_product_id = v_product.id and deleted_at is null;
  end if;
  select * into v_product from public.ecommerce_published_products
  where id = p_product_id;
  return v_product;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_reconcile_recipe_projection()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_recipe jsonb;
  v_evaluation jsonb;
  v_status text;
  v_available boolean;
  v_stock numeric;
  v_incoming_state text;
  v_incoming_available boolean;
  v_incoming_stock numeric;
  v_mismatch boolean := false;
begin
  if new.deleted_at is not null
     or new.has_recipe is not true
     or new.availability_source is distinct from 'recipe' then
    return new;
  end if;

  select p.recipe into v_recipe
  from public.pos_products p
  where p.license_id = new.license_id
    and p.id = new.local_product_ref
    and p.deleted_at is null
  limit 1;

  if jsonb_typeof(v_recipe) <> 'array' or jsonb_array_length(v_recipe) = 0 then
    return new;
  end if;

  v_incoming_state := new.source_state;
  v_incoming_available := new.source_available;
  v_incoming_stock := new.stock_snapshot;
  v_evaluation := private.ecommerce_recipe_capacity(new.license_id, v_recipe, current_date);
  v_status := coalesce(v_evaluation->>'status', 'unverified');

  if v_status = 'in_stock' then
    v_available := true;
    v_stock := greatest(coalesce((v_evaluation->>'availableStock')::numeric, 0), 0);
  elsif v_status = 'out_of_stock' then
    v_available := false;
    v_stock := 0;
  elsif v_status = 'not_tracked' then
    v_available := true;
    v_stock := null;
  else
    v_status := 'unverified';
    v_available := old.source_available;
    v_stock := old.stock_snapshot;
  end if;

  v_mismatch := v_incoming_state is distinct from v_status
    or (v_status in ('in_stock', 'out_of_stock', 'not_tracked') and v_incoming_available is distinct from v_available)
    or (v_status in ('in_stock', 'out_of_stock') and v_incoming_stock is distinct from v_stock);

  new.source_state := v_status;
  new.source_available := v_available;
  new.stock_snapshot := v_stock;
  new.is_available := new.manual_available and coalesce(v_available, old.source_available, false);
  new.availability_reason_code := nullif(v_evaluation->>'reasonCode', '');
  new.limiting_source_product_id := nullif(v_evaluation->>'limitingIngredientId', '');
  new.limiting_source_name := nullif(v_evaluation->>'limitingIngredientName', '');

  if v_status in ('in_stock', 'out_of_stock') then
    new.stock_updated_at := now();
  end if;

  if v_status = 'unverified' then
    new.sync_status := 'review';
    new.sync_error_code := 'SOURCE_UNVERIFIED';
  elsif old.sync_error_code = 'ECOMMERCE_RECIPE_SOURCE_MISMATCH' then
    new.sync_status := 'synced';
    new.sync_error_code := null;
    new.metadata := coalesce(new.metadata, '{}'::jsonb)
      - 'recipe_projection_corrected_at'
      - 'recipe_projection_incoming_state'
      - 'recipe_projection_canonical_state';
  end if;

  if v_mismatch then
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'recipe_projection_last_reconciled_at', now(),
      'recipe_projection_incoming_state', v_incoming_state,
      'recipe_projection_canonical_state', v_status
    );
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_record_initial_fulfillment_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.status in ('accepted', 'converted_to_sale')
     and old.status is distinct from new.status
     and new.fulfillment_status = 'accepted'
     and new.fulfillment_version = 1 then
    insert into private.ecommerce_order_fulfillment_events (
      order_id, portal_id, license_id, version, from_status, to_status,
      event_key, public_message, actor_type, actor_staff_id, created_at
    ) values (
      new.id, new.portal_id, new.license_id, 1, null, 'accepted',
      case when new.status = 'converted_to_sale'
        then 'base-order-converted-accepted-v1'
        else 'base-order-accepted-v1'
      end,
      null, 'system', null,
      coalesce(new.accepted_at, new.fulfillment_updated_at, now())
    ) on conflict (order_id, version) do nothing;
  end if;
  return new;
end;
$function$
;
-- Unused ecommerce reservation row type is outside this lab.
CREATE OR REPLACE FUNCTION private.ecommerce_require_fulfillment_reservation_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_requires_reservation boolean;
  v_operational_transition boolean;
begin
  v_operational_transition := (
    new.status = 'converted_to_sale'
    or (new.fulfillment_status is distinct from old.fulfillment_status
      and new.fulfillment_status not in ('cancelled', null))
  );
  if not v_operational_transition then return new; end if;
  v_requires_reservation := private.ecommerce_reservation_feature_enabled(new.license_id)
    and exists (
      select 1 from public.ecommerce_order_inventory_reservations r
       where r.order_id = new.id and r.license_id = new.license_id
    );
  if v_requires_reservation
     and (old.stock_reservation_status <> 'reserved'
       or coalesce(old.stock_reservation_phase, 'checkout') <> 'fulfillment'
       or old.fulfillment_hold_expires_at is null
       or old.fulfillment_hold_expires_at <= now()) then
    raise exception 'ECOMMERCE_FULFILLMENT_RESERVATION_REQUIRED' using errcode = 'P0001';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_reservation_feature_enabled(p_license_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.ecommerce_license_feature_bool($1, 'ecommerce_stock_reservation', false)
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_reservation_variant_id(p_options jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
begin
  if jsonb_typeof(p_options) <> 'object' then return null; end if;
  return nullif(btrim(coalesce(p_options #>> '{variant,id}', '')), '')::uuid;
exception when invalid_text_representation then
  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_reserve_order_item_stock(p_order_item_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.ecommerce_orders%rowtype;
  v_item public.ecommerce_order_items%rowtype;
  v_publication public.ecommerce_published_products%rowtype;
  v_product public.pos_products%rowtype;
  v_batch public.pos_product_batches%rowtype;
  v_reservation public.ecommerce_order_inventory_reservations%rowtype;
  v_variant_id uuid;
  v_remaining numeric(12,3);
  v_allocate numeric(12,3);
  v_expires_at timestamptz;
  v_product_committed numeric(12,3);
  v_key text;
begin
  if p_order_item_id is null then
    raise exception 'ECOMMERCE_PRODUCT_UNAVAILABLE' using errcode = 'P0001';
  end if;

  select o.* into v_order
    from public.ecommerce_orders o
    join public.ecommerce_order_items i on i.order_id = o.id
   where i.id = p_order_item_id
   for update of o;
  if v_order.id is null then
    raise exception 'ECOMMERCE_PRODUCT_UNAVAILABLE' using errcode = 'P0001';
  end if;

  select * into v_item
    from public.ecommerce_order_items
   where id = p_order_item_id
     and order_id = v_order.id
     and portal_id = v_order.portal_id
     and license_id = v_order.license_id
   for update;
  if v_item.id is null or v_item.quantity <= 0 then
    raise exception 'ECOMMERCE_PRODUCT_UNAVAILABLE' using errcode = 'P0001';
  end if;

  if private.ecommerce_reservation_feature_enabled(v_order.license_id) is not true then
    return;
  end if;

  select pp.* into v_publication
    from public.ecommerce_published_products pp
   where pp.id = v_item.published_product_id
     and pp.portal_id = v_order.portal_id
     and pp.license_id = v_order.license_id
     and pp.deleted_at is null
     and pp.is_published is true
   for share;
  if v_publication.id is null or v_item.source_product_id is null then
    raise exception 'ECOMMERCE_PRODUCT_UNAVAILABLE' using errcode = 'P0001';
  end if;

  select * into v_product
    from public.pos_products p
   where p.id = v_item.source_product_id
     and p.license_id = v_order.license_id
     and p.deleted_at is null
     and p.is_active is true
   for update;
  if v_product.id is null then
    raise exception 'ECOMMERCE_PRODUCT_UNAVAILABLE' using errcode = 'P0001';
  end if;
  if v_product.track_stock is not true then return; end if;

  v_variant_id := private.ecommerce_reservation_variant_id(v_item.options);
  v_expires_at := now() + interval '15 minutes';
  v_key := 'ecommerce:' || v_order.id::text || ':' || v_item.id::text;
  v_remaining := v_item.quantity;

  if private.product_uses_batches(v_product) then
    for v_batch in
      select b.*
        from public.pos_product_batches b
       where b.license_id = v_order.license_id
         and b.product_id = v_product.id
         and b.deleted_at is null
         and b.is_active is true
         and b.status = 'active'
         and b.track_stock is true
         and b.stock > b.committed_stock
         and (b.expiry_date is null or b.expiry_date::date >= current_date)
       order by b.expiry_date nulls last, b.created_at, b.id
       for update
    loop
      exit when v_remaining <= 0;
      v_allocate := least(v_remaining, v_batch.stock - v_batch.committed_stock);
      if v_allocate <= 0 then continue; end if;

      update public.pos_product_batches
         set committed_stock = committed_stock + v_allocate,
             updated_at = now(), server_version = server_version + 1,
             last_idempotency_key = v_key || ':batch:' || v_batch.id
       where id = v_batch.id and license_id = v_order.license_id
       returning * into v_batch;

      insert into public.ecommerce_order_inventory_reservations (
        order_id, order_item_id, portal_id, license_id, published_product_id, published_variant_id,
        source_product_id, batch_id, quantity, status, reservation_phase, stock_before, stock_after,
        committed_before, committed_after, idempotency_key, expires_at, metadata
      ) values (
        v_order.id, v_item.id, v_order.portal_id, v_order.license_id, v_publication.id, v_variant_id,
        v_product.id, v_batch.id, v_allocate, 'reserved', 'checkout', v_batch.stock, v_batch.stock,
        v_batch.committed_stock - v_allocate, v_batch.committed_stock, v_key || ':batch:' || v_batch.id,
        v_expires_at, jsonb_build_object('source', 'ecommerce_phase3', 'stockSource', 'batch', 'reservationPhase', 'checkout')
      ) returning * into v_reservation;
      perform private.ecommerce_record_reservation_event(v_reservation, 'reserved', v_reservation.idempotency_key);
      v_remaining := v_remaining - v_allocate;
    end loop;
    if v_remaining > 0 then
      raise exception 'ECOMMERCE_INSUFFICIENT_STOCK' using errcode = 'P0001';
    end if;

    select coalesce(sum(b.committed_stock), 0) into v_product_committed
      from public.pos_product_batches b
     where b.license_id = v_order.license_id
       and b.product_id = v_product.id
       and b.deleted_at is null;
    update public.pos_products
       set committed_stock = v_product_committed, updated_at = now(),
           server_version = server_version + 1, last_idempotency_key = v_key
     where id = v_product.id and license_id = v_order.license_id;
  else
    if v_product.stock - v_product.committed_stock < v_remaining then
      raise exception 'ECOMMERCE_INSUFFICIENT_STOCK' using errcode = 'P0001';
    end if;
    update public.pos_products
       set committed_stock = committed_stock + v_remaining, updated_at = now(),
           server_version = server_version + 1, last_idempotency_key = v_key
     where id = v_product.id
       and license_id = v_order.license_id
       and stock - committed_stock >= v_remaining
     returning * into v_product;
    if v_product.id is null then
      raise exception 'ECOMMERCE_INSUFFICIENT_STOCK' using errcode = 'P0001';
    end if;
    insert into public.ecommerce_order_inventory_reservations (
      order_id, order_item_id, portal_id, license_id, published_product_id, published_variant_id,
      source_product_id, batch_id, quantity, status, reservation_phase, stock_before, stock_after,
      committed_before, committed_after, idempotency_key, expires_at, metadata
    ) values (
      v_order.id, v_item.id, v_order.portal_id, v_order.license_id, v_publication.id, v_variant_id,
      v_product.id, null, v_remaining, 'reserved', 'checkout', v_product.stock, v_product.stock,
      v_product.committed_stock - v_remaining, v_product.committed_stock, v_key, v_expires_at,
      jsonb_build_object('source', 'ecommerce_phase3', 'stockSource', 'product', 'reservationPhase', 'checkout')
    ) returning * into v_reservation;
    perform private.ecommerce_record_reservation_event(v_reservation, 'reserved', v_reservation.idempotency_key);
  end if;

  update public.ecommerce_orders
     set stock_reservation_status = 'reserved',
         stock_reservation_phase = 'checkout',
         fulfillment_hold_expires_at = null,
         stock_reservation_expires_at = greatest(coalesce(stock_reservation_expires_at, v_expires_at), v_expires_at),
         updated_at = now()
   where id = v_order.id and license_id = v_order.license_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_resolve_order_item_source_product_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_variant_id uuid;
begin
  new.source_product_id := null;

  if new.published_product_id is null
     or new.portal_id is null
     or new.license_id is null then
    return new;
  end if;

  begin
    v_variant_id := nullif(btrim(coalesce(new.options #>> '{variant,id}', '')), '')::uuid;
  exception when invalid_text_representation then
    v_variant_id := null;
  end;

  if v_variant_id is not null then
    select coalesce(v.source_product_id, v.local_product_ref)
      into new.source_product_id
      from public.ecommerce_published_product_variants v
     where v.id = v_variant_id
       and v.published_product_id = new.published_product_id
       and v.portal_id = new.portal_id
       and v.license_id = new.license_id
       and v.deleted_at is null;
  end if;

  if new.source_product_id is null then
    select coalesce(pp.product_id, pp.local_product_ref)
      into new.source_product_id
      from public.ecommerce_published_products pp
     where pp.id = new.published_product_id
       and pp.portal_id = new.portal_id
       and pp.license_id = new.license_id
       and pp.deleted_at is null;
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_sync_published_stock_projection(p_license_id uuid, p_source_product_id text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_product public.pos_products%rowtype;
  v_available numeric(12,3);
  v_changed integer := 0;
  v_variant_changed integer := 0;
begin
  if p_license_id is null
     or nullif(btrim(coalesce(p_source_product_id, '')), '') is null then
    raise exception 'ECOMMERCE_STOCK_PROJECTION_SCOPE_INVALID' using errcode = 'P0001';
  end if;

  -- The transition has already locked this product before changing
  -- committed_stock. FOR SHARE preserves that lock order for a direct call and
  -- serializes the bounded migration repair with a concurrent transition.
  select p.*
    into v_product
    from public.pos_products p
   where p.id = p_source_product_id
     and p.license_id = p_license_id
     and p.deleted_at is null
   for share;
  if v_product.id is null then
    raise exception 'ECOMMERCE_RESERVATION_SOURCE_MISSING' using errcode = 'P0001';
  end if;

  -- Untracked inventory preserves its existing publication contract.
  if v_product.track_stock is not true then
    return 0;
  end if;

  if private.product_uses_batches(v_product) then
    select coalesce(sum(greatest(b.stock - b.committed_stock, 0)), 0)
      into v_available
      from public.pos_product_batches b
     where b.license_id = p_license_id
       and b.product_id = v_product.id
       and b.deleted_at is null
       and b.is_active is true
       and b.status = 'active'
       and b.track_stock is true
       and (b.expiry_date is null or b.expiry_date::date >= current_date);
  else
    v_available := greatest(v_product.stock - v_product.committed_stock, 0);
  end if;

  -- A direct publication may be exposed through more than one portal under the
  -- same license. They share the same authoritative POS product, so each is
  -- updated atomically without crossing license boundaries.
  update public.ecommerce_published_products pp
     set stock_snapshot = v_available,
         source_available = v_available > 0,
         source_state = case when v_available > 0 then 'in_stock' else 'out_of_stock' end,
         stock_updated_at = now()
   where pp.license_id = p_license_id
     and pp.local_product_ref = v_product.id
     and pp.deleted_at is null
     and pp.availability_source = 'direct'
     and pp.configuration_type <> 'variant_parent'
     and (
       pp.stock_snapshot,
       pp.source_available,
       pp.source_state
     ) is distinct from (
       v_available,
       v_available > 0,
       case when v_available > 0 then 'in_stock' else 'out_of_stock' end
     );
  get diagnostics v_changed = row_count;

  -- Configured products project the source product into the concrete variant;
  -- the existing child trigger then refreshes its parent aggregate and revision.
  update public.ecommerce_published_product_variants v
     set stock_snapshot = v_available,
         source_available = v_available > 0
   where v.license_id = p_license_id
     and v.source_product_id = v_product.id
     and v.deleted_at is null
     and (
       v.stock_snapshot,
       v.source_available
     ) is distinct from (
       v_available,
       v_available > 0
     );
  get diagnostics v_variant_changed = row_count;
  v_changed := v_changed + v_variant_changed;

  -- Existing guards derive is_available from manual_available AND
  -- source_available. Existing catalog-revision triggers run only when the
  -- public signature changed, invalidating the revision-keyed public cache.
  return v_changed;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_sync_published_stock_projection_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.committed_stock is distinct from old.committed_stock then
    perform private.ecommerce_sync_published_stock_projection(new.license_id, new.id);
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_tracking_topic_v1(p_token_hash bytea)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select 'ecom-track:' || left(encode(p_token_hash, 'hex'), 48);
$function$
;
CREATE OR REPLACE FUNCTION private.ecommerce_variant_parent_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_active_count integer := 0;
  v_source_available boolean := false;
  v_stock_snapshot numeric := 0;
begin
  if new.deleted_at is not null or new.configuration_type <> 'variant_parent' then
    return new;
  end if;

  select
    count(*)::integer,
    coalesce(bool_or(
      v.manual_available is true
      and v.source_available is true
      and v.is_available is true
    ), false),
    coalesce(sum(
      case
        when v.manual_available is true
         and v.source_available is true
         and v.is_available is true
          then greatest(coalesce(v.stock_snapshot, 0), 0)
        else 0
      end
    ), 0)
  into
    v_active_count,
    v_source_available,
    v_stock_snapshot
  from public.ecommerce_published_product_variants v
  where v.published_product_id = new.id
    and v.deleted_at is null;

  new.has_variants := v_active_count > 0;
  new.requires_configuration := true;
  new.availability_source := 'variant_aggregate';
  new.availability_reason_code := case
    when v_active_count = 0 then 'APPAREL_VARIANTS_UNAVAILABLE'
    else 'CONFIGURATION_REQUIRED'
  end;
  new.source_available := v_source_available;
  new.source_state := case
    when v_source_available then 'in_stock'
    else 'out_of_stock'
  end;
  new.stock_snapshot := greatest(v_stock_snapshot, 0);
  new.stock_updated_at := now();
  new.is_available := false;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.emit_business_profile_updated_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_license_key text;
  v_profile_revision bigint;
begin
  if tg_op = 'UPDATE'
     and row(
       old.business_name,
       old.phone_number,
       old.address,
       old.logo_url,
       old.business_type
     ) is not distinct from row(
       new.business_name,
       new.phone_number,
       new.address,
       new.logo_url,
       new.business_type
     ) then
    return new;
  end if;

  select l.license_key
  into v_license_key
  from public.licenses l
  where l.id = new.license_id;

  if v_license_key is null then
    return new;
  end if;

  v_profile_revision := floor(
    extract(epoch from coalesce(new.updated_at, new.created_at, now())) * 1000
  )::bigint;

  insert into public.license_events (
    license_key,
    event_type,
    metadata
  ) values (
    v_license_key,
    'BUSINESS_PROFILE_UPDATED',
    jsonb_build_object(
      'profile_id', new.id,
      'updated_at', new.updated_at,
      'profile_revision', v_profile_revision,
      'business_type', to_jsonb(
        coalesce(new.business_type, array[]::public.business_category[])
      )
    )
  );

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.ensure_license_device_mode()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.device_mode is null then
    new.device_mode := case new.device_role
      when 'admin' then 'admin_only'
      when 'staff' then 'staff_only'
      else null
    end;
  end if;

  if new.device_mode not in ('shared', 'admin_only', 'staff_only') then
    raise exception 'DEVICE_MODE_INVALID' using errcode = 'P0001';
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.fill_pos_sale_item_batch_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_batch public.pos_product_batches;
begin
  if new.batch_id is null then
    return new;
  end if;

  select * into v_batch
  from public.pos_product_batches b
  where b.license_id = new.license_id
    and b.id = new.batch_id
  limit 1;

  if v_batch.id is not null then
    new.batch_sku := coalesce(new.batch_sku, v_batch.sku);
    new.batch_expiry_date := coalesce(new.batch_expiry_date, v_batch.expiry_date::date);
    new.metadata := coalesce(new.metadata, '{}'::jsonb)
      || jsonb_strip_nulls(jsonb_build_object(
        'batchSku', v_batch.sku,
        'batchExpiryDate', v_batch.expiry_date::date
      ));
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.license_realtime_enabled(p_plan_features jsonb, p_license_features jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(
    ((coalesce(p_plan_features, '{}'::jsonb) || coalesce(p_license_features, '{}'::jsonb))->>'realtime_license_sync') = 'true',
    false
  );
$function$
;
CREATE OR REPLACE FUNCTION private.notify_staff_user_permission_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_license_key text;
  v_changed_fields text[] := array[]::text[];
begin
  if old.display_name is distinct from new.display_name then
    v_changed_fields := array_append(v_changed_fields, 'display_name');
  end if;

  if old.role_name is distinct from new.role_name then
    v_changed_fields := array_append(v_changed_fields, 'role_name');
  end if;

  if old.permissions is distinct from new.permissions then
    v_changed_fields := array_append(v_changed_fields, 'permissions');
  end if;

  if old.is_active is distinct from new.is_active then
    v_changed_fields := array_append(v_changed_fields, 'is_active');
  end if;

  if array_length(v_changed_fields, 1) is null then
    return new;
  end if;

  select l.license_key
  into v_license_key
  from public.licenses l
  where l.id = new.license_id;

  if v_license_key is null then
    return new;
  end if;

  insert into public.license_events (license_key, event_type, metadata)
  values (
    v_license_key,
    'LICENSE_UPDATE',
    jsonb_strip_nulls(jsonb_build_object(
      'source', 'license_staff_users_update_trigger',
      'reason', 'STAFF_USER_UPDATED',
      'staff_user_id', new.id,
      'username', new.username,
      'display_name', new.display_name,
      'role_name', new.role_name,
      'is_active', new.is_active,
      'changed_fields', to_jsonb(v_changed_fields)
    ))
  );

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.pos_cash_movement_station_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session public.pos_cash_sessions;
begin
  if tg_op = 'UPDATE' then
    if new.cash_session_id <> old.cash_session_id
       or coalesce(new.cash_station_id, '') <> coalesce(old.cash_station_id, '')
       or new.license_id <> old.license_id
       or coalesce(new.performed_by_actor_key, '') <> coalesce(old.performed_by_actor_key, '') then
      raise exception 'CASH_SESSION_STATION_IMMUTABLE' using errcode = 'P0001';
    end if;
    return new;
  end if;

  select * into v_session
  from public.pos_cash_sessions s
  where s.license_id = new.license_id
    and s.id = new.cash_session_id
    and s.deleted_at is null
  limit 1;

  if v_session.id is null or v_session.cash_station_id is null then
    raise exception 'CASH_STATION_UNRESOLVED' using errcode = 'P0001';
  end if;
  if new.cash_station_id is not null and new.cash_station_id <> v_session.cash_station_id then
    raise exception 'CASH_SESSION_STATION_MISMATCH' using errcode = 'P0001';
  end if;

  new.cash_station_id := v_session.cash_station_id;
  new.actor_key := coalesce(new.actor_key, v_session.actor_key);
  new.performed_by_actor_key := coalesce(
    new.performed_by_actor_key,
    nullif(new.metadata->>'performed_by_actor_key', ''),
    nullif(new.metadata->>'performedByActorKey', ''),
    new.actor_key,
    v_session.actor_key
  );
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.pos_product_batch_shelf_life_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_product public.pos_products;
  v_target_date timestamptz;
begin
  if greatest(coalesce(new.stock, 0) - coalesce(new.committed_stock, 0), 0) <= 0 then
    return new;
  end if;

  select * into v_product
  from public.pos_products
  where license_id = new.license_id
    and id = new.product_id;

  if v_product.expiration_mode <> 'SHELF_LIFE' then
    return new;
  end if;

  if new.expiry_date is not null or new.alert_target_date is not null then
    new.expiry_date := coalesce(new.expiry_date, new.alert_target_date);
    new.alert_target_date := coalesce(new.alert_target_date, new.expiry_date);
    return new;
  end if;

  v_target_date := private.calculate_pos_shelf_life_target(
    coalesce(new.created_at, now()),
    v_product.shelf_life_value,
    v_product.shelf_life_unit
  );

  if v_target_date is null then
    raise exception 'SHELF_LIFE_VALUE_REQUIRED: Indica una vida util valida para crear inventario con caducidad estimada.'
      using errcode = 'P0001';
  end if;

  new.expiry_date := v_target_date;
  new.alert_target_date := v_target_date;
  new.alert_type := 'VIDA_UTIL_ESTIMADA';
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.pos_sale_try_uuid(p_value text)
 RETURNS uuid
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
begin
  if nullif(btrim(coalesce(p_value, '')), '') is null then
    return null;
  end if;
  return btrim(p_value)::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.pos_sales_normalize_ecommerce_traceability()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_metadata jsonb := coalesce(new.metadata, '{}'::jsonb);
  v_requested_order_id uuid;
  v_requested_order_code text;
  v_order_id uuid;
  v_order_code text;
  v_conversion_key text;
  v_ecommerce_intent boolean;
begin
  v_requested_order_id := coalesce(
    new.ecommerce_order_id,
    private.pos_sale_try_uuid(v_metadata->>'ecommerceOrderId'),
    private.pos_sale_try_uuid(v_metadata->>'ecommerce_order_id')
  );
  v_requested_order_code := coalesce(
    nullif(btrim(new.ecommerce_order_code), ''),
    nullif(btrim(v_metadata->>'ecommerceOrderCode'), ''),
    nullif(btrim(v_metadata->>'ecommerce_order_code'), '')
  );
  v_conversion_key := coalesce(
    nullif(btrim(new.idempotency_key), ''),
    nullif(btrim(v_metadata->>'ecommerceConversionKey'), ''),
    nullif(btrim(v_metadata->>'idempotencyKey'), '')
  );

  if v_requested_order_id is null
     and v_conversion_key like 'ecommerce:%' then
    v_requested_order_id := private.pos_sale_try_uuid(substring(v_conversion_key from 11));
  end if;

  v_ecommerce_intent := coalesce((
    coalesce(new.sales_channel, '') = 'ecommerce'
    or coalesce(v_metadata->>'origin', '') = 'ecommerce'
    or new.ecommerce_order_id is not null
    or nullif(btrim(new.ecommerce_order_code), '') is not null
    or v_metadata ? 'ecommerceOrderId'
    or v_metadata ? 'ecommerce_order_id'
    or v_metadata ? 'ecommerceOrderCode'
    or v_metadata ? 'ecommerce_order_code'
    or v_metadata ? 'ecommerceConversionKey'
    or v_conversion_key like 'ecommerce:%'
  ), false);

  if not v_ecommerce_intent then
    new.sales_channel := 'local';
    new.ecommerce_order_id := null;
    new.ecommerce_order_code := null;
    return new;
  end if;

  if v_requested_order_id is not null then
    select o.id, o.public_order_code
    into v_order_id, v_order_code
    from public.ecommerce_orders o
    where o.license_id = new.license_id
      and o.id = v_requested_order_id;
  elsif v_requested_order_code is not null then
    select o.id, o.public_order_code
    into v_order_id, v_order_code
    from public.ecommerce_orders o
    where o.license_id = new.license_id
      and o.public_order_code = v_requested_order_code;
  elsif v_conversion_key is not null then
    select o.id, o.public_order_code
    into v_order_id, v_order_code
    from public.ecommerce_orders o
    where o.license_id = new.license_id
      and o.pos_conversion_key = v_conversion_key;
  end if;

  if v_order_id is null or v_order_code is null then
    raise exception 'ECOMMERCE_ORDER_NOT_FOUND'
      using errcode = 'P0001',
        detail = format(
          'license_id=%s order_id=%s order_code=%s conversion_key=%s',
          new.license_id,
          v_requested_order_id,
          v_requested_order_code,
          v_conversion_key
        );
  end if;

  new.ecommerce_order_id := v_order_id;
  new.ecommerce_order_code := v_order_code;
  new.sales_channel := 'ecommerce';
  new.metadata := v_metadata || jsonb_build_object(
    'origin', 'ecommerce',
    'ecommerceOrderId', v_order_id,
    'ecommerceOrderCode', v_order_code
  );

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.protect_restaurant_paid_sale_id_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if lower(coalesce(old.payment_status, '')) = 'paid' and nullif(btrim(old.paid_sale_id), '') is not null and new.paid_sale_id is distinct from old.paid_sale_id then raise exception 'RESTAURANT_ORDER_PAID_SALE_IMMUTABLE' using errcode = 'P0001'; end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.protect_restaurant_pos_cancellation_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if old.status = 'cancelled' and old.metadata->>'cancelledFromPos' = 'true'
    and (new.status is distinct from 'cancelled'
      or new.fulfillment_status is distinct from 'cancelled'
      or new.cancelled_at is distinct from old.cancelled_at
      or new.payment_status is distinct from old.payment_status
      or new.metadata->>'cancelledFromPos' is distinct from 'true') then
    raise exception 'RESTAURANT_ORDER_ALREADY_CANCELLED' using errcode = 'P0001';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.touch_license_staff_user_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_license_plan_limits_after_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_plan_code text;
  v_plan_name text;
  v_features jsonb;
  v_staff_roles_enabled boolean;
  v_max_devices integer;
  v_active_before integer := 0;
  v_active_after integer := 0;
  v_staff_blocked integer := 0;
  v_staff_sessions_revoked integer := 0;
  v_staff_device_sessions_revoked integer := 0;
  v_admin_sessions_revoked integer := 0;
  v_over_limit_blocked integer := 0;
  v_staff_blocked_device_ids uuid[] := array[]::uuid[];
  v_over_limit_device_ids uuid[] := array[]::uuid[];
  v_blocked_device_ids uuid[] := array[]::uuid[];
  v_active_device_ids uuid[] := array[]::uuid[];
  v_now timestamptz := now();
begin
  select p.code, p.name, coalesce(p.features, '{}'::jsonb) || coalesce(new.features, '{}'::jsonb)
    into v_plan_code, v_plan_name, v_features
    from public.plans p
   where p.id = new.plan_id;

  v_staff_roles_enabled := coalesce((v_features->>'staff_roles')::boolean, false);
  v_max_devices := greatest(coalesce(new.max_devices, 1), 0);

  select count(*)
    into v_active_before
    from public.license_devices d
   where d.license_id = new.id
     and d.is_active is true;

  if not v_staff_roles_enabled then
    with blocked as (
      update public.license_devices d
         set is_active = false,
             security_token = null,
             previous_security_token = null,
             last_check_at = v_now,
             device_info = coalesce(d.device_info, '{}'::jsonb) || jsonb_build_object(
               'license_block', jsonb_build_object(
                 'reason', 'PLAN_DOWNGRADE_STAFF_NOT_INCLUDED',
                 'message', 'Esta licencia cambio a un plan que no incluye usuarios staff.',
                 'plan_code', v_plan_code,
                 'plan_name', v_plan_name,
                 'blocked_at', v_now
               )
             )
       where d.license_id = new.id
         and d.is_active is true
         and d.device_mode = 'staff_only'
      returning d.id
    )
    select coalesce(array_agg(id order by id), array[]::uuid[]), count(*)
      into v_staff_blocked_device_ids, v_staff_blocked
      from blocked;

    with revoked as (
      update public.license_staff_sessions s
         set revoked_at = coalesce(s.revoked_at, v_now),
             metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object(
               'revoked_reason', 'PLAN_DOWNGRADE_STAFF_NOT_INCLUDED',
               'revoked_at', v_now,
               'plan_code', v_plan_code,
               'plan_name', v_plan_name
             )
       where s.license_id = new.id
         and s.revoked_at is null
      returning s.id
    )
    select count(*) into v_staff_sessions_revoked from revoked;
  end if;

  with ranked_devices as (
    select d.id,
           row_number() over (
             order by
               case d.device_mode
                 when 'admin_only' then 0
                 when 'shared' then 1
                 else 2
               end,
               d.activated_at asc nulls last,
               d.last_used_at desc nulls last,
               d.id asc
           ) as keep_rank
      from public.license_devices d
     where d.license_id = new.id
       and d.is_active is true
  ), blocked as (
    update public.license_devices d
       set is_active = false,
           security_token = null,
           previous_security_token = null,
           last_check_at = v_now,
           device_info = coalesce(d.device_info, '{}'::jsonb) || jsonb_build_object(
             'license_block', jsonb_build_object(
               'reason', 'PLAN_DOWNGRADE_DEVICE_LIMIT',
               'message', 'Esta licencia cambio a un plan con menos dispositivos permitidos.',
               'plan_code', v_plan_code,
               'plan_name', v_plan_name,
               'max_devices', v_max_devices,
               'blocked_at', v_now
             )
           )
      from ranked_devices ranked
     where d.id = ranked.id
       and ranked.keep_rank > v_max_devices
    returning d.id
  )
  select coalesce(array_agg(id order by id), array[]::uuid[]), count(*)
    into v_over_limit_device_ids, v_over_limit_blocked
    from blocked;

  select coalesce(array_agg(distinct blocked_id order by blocked_id), array[]::uuid[])
    into v_blocked_device_ids
    from unnest(v_staff_blocked_device_ids || v_over_limit_device_ids) as blocked(blocked_id);

  if coalesce(cardinality(v_blocked_device_ids), 0) > 0 then
    with revoked as (
      update public.license_admin_sessions s
         set revoked_at = coalesce(s.revoked_at, v_now),
             metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object(
               'revoked_reason', coalesce(d.device_info #>> '{license_block,reason}', 'PLAN_DOWNGRADE_DEVICE_REMOVED'),
               'revoked_at', v_now,
               'plan_code', v_plan_code,
               'plan_name', v_plan_name
             )
        from public.license_devices d
       where s.license_id = new.id
         and s.device_id = d.id
         and d.license_id = new.id
         and d.id = any(v_blocked_device_ids)
         and s.revoked_at is null
      returning s.id
    )
    select count(*) into v_admin_sessions_revoked from revoked;

    with revoked as (
      update public.license_staff_sessions s
         set revoked_at = coalesce(s.revoked_at, v_now),
             metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object(
               'revoked_reason', coalesce(d.device_info #>> '{license_block,reason}', 'PLAN_DOWNGRADE_DEVICE_REMOVED'),
               'revoked_at', v_now,
               'plan_code', v_plan_code,
               'plan_name', v_plan_name
             )
        from public.license_devices d
       where s.license_id = new.id
         and s.device_id = d.id
         and d.license_id = new.id
         and d.id = any(v_blocked_device_ids)
         and s.revoked_at is null
      returning s.id
    )
    select count(*) into v_staff_device_sessions_revoked from revoked;

    v_staff_sessions_revoked := v_staff_sessions_revoked + v_staff_device_sessions_revoked;
  end if;

  select count(*),
         coalesce(array_agg(d.id order by d.id), array[]::uuid[])
    into v_active_after, v_active_device_ids
    from public.license_devices d
   where d.license_id = new.id
     and d.is_active is true;

  if v_staff_blocked > 0
     or v_staff_sessions_revoked > 0
     or v_admin_sessions_revoked > 0
     or v_over_limit_blocked > 0 then
    insert into public.license_events (license_key, event_type, metadata)
    values (
      new.license_key,
      'LICENSE_UPDATE',
      jsonb_build_object(
        'source', 'enforce_license_plan_limits_after_change',
        'reason', 'PLAN_LIMITS_ENFORCED',
        'plan', v_plan_code,
        'plan_name', v_plan_name,
        'staff_devices_blocked', v_staff_blocked,
        'staff_sessions_revoked', v_staff_sessions_revoked,
        'admin_sessions_revoked', v_admin_sessions_revoked,
        'over_limit_devices_blocked', v_over_limit_blocked,
        'blocked_device_ids', to_jsonb(v_blocked_device_ids),
        'active_device_ids_after', to_jsonb(v_active_device_ids),
        'active_devices_before', v_active_before,
        'active_devices_after', v_active_after,
        'max_devices', v_max_devices
      )
    );
  end if;

  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.notify_device_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_license_key text;
BEGIN
    SELECT l.license_key
    INTO v_license_key
    FROM public.licenses l
    WHERE l.id = COALESCE(NEW.license_id, OLD.license_id);

    IF (TG_OP = 'UPDATE' AND OLD.is_active = true AND NEW.is_active = false) THEN
        INSERT INTO public.license_events (license_key, event_type, metadata)
        VALUES (
            v_license_key,
            'DEVICE_BANNED',
            jsonb_build_object('fingerprint', NEW.device_fingerprint)
        );
    END IF;

    IF (TG_OP = 'DELETE') THEN
        INSERT INTO public.license_events (license_key, event_type, metadata)
        VALUES (
            v_license_key,
            'DEVICE_DELETED',
            jsonb_build_object('fingerprint', OLD.device_fingerprint)
        );
    END IF;

    RETURN NULL;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.notify_license_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_changed_fields text[] := array[]::text[];
    v_event_type text;
    v_metadata jsonb;
    v_old_plan_code text;
    v_new_plan_code text;
    v_old_plan_name text;
    v_new_plan_name text;
begin
    if old.plan_id is distinct from new.plan_id then
        v_changed_fields := array_append(v_changed_fields, 'plan_id');
    end if;

    if old.max_devices is distinct from new.max_devices then
        v_changed_fields := array_append(v_changed_fields, 'max_devices');
    end if;

    if old.product_name is distinct from new.product_name then
        v_changed_fields := array_append(v_changed_fields, 'product_name');
    end if;

    if old.status is distinct from new.status then
        v_changed_fields := array_append(v_changed_fields, 'status');
    end if;

    if old.expires_at is distinct from new.expires_at then
        v_changed_fields := array_append(v_changed_fields, 'expires_at');
    end if;

    if old.features is distinct from new.features then
        v_changed_fields := array_append(v_changed_fields, 'features');
    end if;

    if array_length(v_changed_fields, 1) is null then
        return new;
    end if;

    select p.code, p.name
    into v_old_plan_code, v_old_plan_name
    from public.plans p
    where p.id = old.plan_id;

    select p.code, p.name
    into v_new_plan_code, v_new_plan_name
    from public.plans p
    where p.id = new.plan_id;

    v_event_type := case
        when old.plan_id is distinct from new.plan_id then 'PLAN_CHANGED'
        else 'LICENSE_UPDATE'
    end;

    v_metadata := jsonb_build_object(
        'source', 'licenses_update_trigger',
        'changed_fields', to_jsonb(v_changed_fields),
        'status', new.status,
        'plan', v_new_plan_code,
        'plan_name', v_new_plan_name,
        'max_devices', new.max_devices,
        'product_name', new.product_name
    );

    if old.plan_id is distinct from new.plan_id then
        v_metadata := v_metadata || jsonb_build_object(
            'from_plan', v_old_plan_code,
            'to_plan', v_new_plan_code,
            'from_plan_name', v_old_plan_name,
            'to_plan_name', v_new_plan_name
        );
    end if;

    if old.max_devices is distinct from new.max_devices then
        v_metadata := v_metadata || jsonb_build_object(
            'old_max_devices', old.max_devices,
            'new_max_devices', new.max_devices
        );
    end if;

    insert into public.license_events (license_key, event_type, metadata)
    values (new.license_key, v_event_type, v_metadata);

    return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_license_plan_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_plan record;
  v_free_plan_id uuid;
  v_should_sync boolean := false;
  v_existing_features jsonb;
  v_base_features jsonb;
  v_plan_features jsonb;
  v_plan_feature_keys text[] := array[]::text[];
begin
  if tg_op = 'INSERT' then
    v_should_sync := true;
  else
    v_should_sync :=
      new.plan_id is distinct from old.plan_id
      or (
        new.license_type is distinct from old.license_type
        and lower(coalesce(new.license_type, '')) in ('trial', 'free_trial')
      );
  end if;

  if not v_should_sync then
    return new;
  end if;

  if lower(coalesce(new.license_type, '')) in ('trial', 'free_trial')
     and (tg_op = 'INSERT' or new.plan_id is not distinct from old.plan_id) then
    select p.id
      into v_free_plan_id
      from public.plans p
     where p.code = 'free_trial'
       and p.is_active is true
     limit 1;

    if v_free_plan_id is not null then
      new.plan_id := v_free_plan_id;
    end if;
  end if;

  if new.plan_id is null then
    return new;
  end if;

  select *
    into v_plan
    from public.plans p
   where p.id = new.plan_id;

  if v_plan.id is null then
    return new;
  end if;

  select coalesce(array_agg(distinct plan_key.feature_key), array[]::text[])
    into v_plan_feature_keys
    from public.plans candidate
    cross join lateral jsonb_object_keys(coalesce(candidate.features, '{}'::jsonb))
      as plan_key(feature_key);

  v_existing_features := coalesce(new.features, '{}'::jsonb);
  v_plan_features := coalesce(v_plan.features, '{}'::jsonb);
  v_base_features :=
    (v_existing_features - v_plan_feature_keys - 'max_rubros' - 'allowed_rubros')
    || jsonb_build_object(
      'full_access', coalesce((v_existing_features->>'full_access')::boolean, true),
      'max_rubros', 1,
      'allowed_rubros', jsonb_build_array('*')
    );

  new.features := v_base_features || v_plan_features;
  new.max_devices := coalesce(v_plan.max_devices, new.max_devices, 1);
  new.price := coalesce(v_plan.price, new.price);
  new.product_name := case
    when v_plan.code = 'free_trial' then 'Lanzo POS Free'
    when v_plan.code = 'basic_monthly' then 'Lanzo POS Basico'
    when v_plan.code = 'pro_monthly' then 'Lanzo POS Pro'
    else coalesce(nullif(trim(new.product_name), ''), 'Lanzo POS - ' || v_plan.name)
  end;
  new.license_type := case
    when v_plan.code = 'free_trial' then 'free'
    when v_plan.code like '%monthly' then 'subscription'
    else coalesce(nullif(trim(new.license_type), ''), v_plan.code)
  end;

  return new;
end;
$function$
;