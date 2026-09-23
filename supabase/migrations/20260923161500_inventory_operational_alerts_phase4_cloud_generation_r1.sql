-- Phase 4: cloud inventory operational alerts for entitled Lanzo Nube tenants.
-- This migration projects (does not replace) the JavaScript Phase 1 SSOT into
-- PostgreSQL so cloud inventory data can materialize into the existing
-- notification center and operational incident lifecycle.

create or replace function private.validate_inventory_operational_business_date_v1(
  p_business_date text
)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_date date;
  v_utc_date date := (now() at time zone 'UTC')::date;
  v_text text := btrim(coalesce(p_business_date, ''));
begin
  if v_text = '' or v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return null;
  end if;

  begin
    v_date := v_text::date;
  exception
    when others then
      return null;
  end;

  if to_char(v_date, 'YYYY-MM-DD') <> v_text then
    return null;
  end if;

  -- A real civil calendar date anywhere on Earth can only differ from UTC's
  -- current date by one day. This prevents an authenticated client from
  -- forcing arbitrary future/past expiry classifications.
  if abs(v_date - v_utc_date) > 1 then
    return null;
  end if;

  return v_date;
end;
$function$;

revoke all on function private.validate_inventory_operational_business_date_v1(text)
  from public, anon, authenticated, service_role;


create or replace function private.inventory_operational_alert_candidates_v1(
  p_license_id uuid,
  p_business_date date
)
returns table(
  entity_kind text,
  entity_id text,
  incident_type text,
  classification text,
  severity text,
  product_id text,
  batch_id text,
  product_name text,
  available_stock numeric,
  physical_stock numeric,
  committed_stock numeric,
  min_stock numeric,
  min_stock_source text,
  expiry_date date,
  days_until_expiry integer,
  expires_today boolean
)
language sql
stable
security definer
set search_path = ''
as $function$
  with product_source as (
    select
      p.id,
      p.name,
      p.stock,
      p.committed_stock,
      p.min_stock,
      p.track_stock,
      p.is_active,
      p.deleted_at,
      case
        when lower(p.stock::text) in ('nan', 'infinity', '-infinity')
          or lower(p.committed_stock::text) in ('nan', 'infinity', '-infinity')
          then null
        else p.stock - p.committed_stock
      end as available_stock,
      case
        when p.min_stock is null then 5::numeric
        when lower(p.min_stock::text) in ('nan', 'infinity', '-infinity') then null
        when p.min_stock < 0 then null
        else p.min_stock
      end as operational_min_stock,
      case
        when p.min_stock is null then 'legacy_fallback'
        when lower(p.min_stock::text) in ('nan', 'infinity', '-infinity') or p.min_stock < 0 then 'invalid'
        else 'configured'
      end as min_stock_source
    from public.pos_products p
    where p.license_id = p_license_id
      and p.deleted_at is null
      and p.is_active is true
      and p.track_stock is true
  ),
  stock_candidates as (
    select
      'product'::text as entity_kind,
      p.id::text as entity_id,
      case
        when p.available_stock <= 0 then 'inventory_out_of_stock'
        else 'inventory_low_stock'
      end::text as incident_type,
      case
        when p.available_stock <= 0 then 'out_of_stock'
        else 'low_stock'
      end::text as classification,
      case
        when p.available_stock <= 0 then 'critical'
        else 'warning'
      end::text as severity,
      p.id::text as product_id,
      null::text as batch_id,
      coalesce(nullif(p.name, ''), 'Producto sin nombre')::text as product_name,
      p.available_stock,
      p.stock as physical_stock,
      p.committed_stock,
      p.operational_min_stock as min_stock,
      p.min_stock_source,
      null::date as expiry_date,
      null::integer as days_until_expiry,
      false as expires_today
    from product_source p
    where p.available_stock is not null
      and (
        p.available_stock <= 0
        or (
          p.available_stock > 0
          and p.operational_min_stock is not null
          and p.available_stock <= p.operational_min_stock
        )
      )
  ),
  expiry_source as (
    select
      b.id::text as batch_id,
      b.product_id::text as product_id,
      coalesce(nullif(p.name, ''), 'Producto sin nombre')::text as product_name,
      b.stock as physical_stock,
      b.committed_stock,
      case
        when lower(b.stock::text) in ('nan', 'infinity', '-infinity')
          or lower(b.committed_stock::text) in ('nan', 'infinity', '-infinity')
          then null
        else b.stock - b.committed_stock
      end as available_stock,
      (
        coalesce(b.alert_target_date, b.expiry_date)
        at time zone 'UTC'
      )::date as expiry_date
    from public.pos_product_batches b
    join public.pos_products p
      on p.license_id = b.license_id
     and p.id = b.product_id
    where b.license_id = p_license_id
      and p_business_date is not null
      and p.deleted_at is null
      and p.is_active is true
      and p.track_stock is true
      and b.deleted_at is null
      and b.is_active is true
      and lower(coalesce(b.status, 'active')) <> 'inactive'
      and b.active_stock_status <> 0
      and lower(b.stock::text) not in ('nan', 'infinity', '-infinity')
      and b.stock > 0
      and coalesce(b.alert_target_date, b.expiry_date) is not null
  ),
  expiry_candidates as (
    select
      'batch'::text as entity_kind,
      e.batch_id as entity_id,
      case
        when e.expiry_date < p_business_date then 'inventory_expired'
        when e.expiry_date = p_business_date then 'inventory_expiring_critical'
        else 'inventory_expiring_warning'
      end::text as incident_type,
      case
        when e.expiry_date < p_business_date then 'expired'
        else 'expiring'
      end::text as classification,
      case
        when e.expiry_date <= p_business_date then 'critical'
        else 'warning'
      end::text as severity,
      e.product_id,
      e.batch_id,
      e.product_name,
      e.available_stock,
      e.physical_stock,
      e.committed_stock,
      null::numeric as min_stock,
      null::text as min_stock_source,
      e.expiry_date,
      (e.expiry_date - p_business_date)::integer as days_until_expiry,
      e.expiry_date = p_business_date as expires_today
    from expiry_source e
    where e.expiry_date <= p_business_date + 7
  ),
  all_candidates as (
    select * from stock_candidates
    union all
    select * from expiry_candidates
  )
  select *
  from all_candidates
  order by
    case severity when 'critical' then 0 else 1 end,
    case
      when classification = 'expired' then 0
      when classification = 'out_of_stock' then 1
      when classification = 'expiring' and expires_today then 2
      when classification = 'low_stock' then 3
      when classification = 'expiring' then 4
      else 99
    end,
    coalesce(days_until_expiry, 2147483647),
    product_name,
    entity_id;
$function$;

revoke all on function private.inventory_operational_alert_candidates_v1(uuid,date)
  from public, anon, authenticated, service_role;


create or replace function private.resolve_inventory_operational_incident_v1(
  p_license_id uuid,
  p_incident_type text,
  p_entity_id text,
  p_current_state jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_resolution jsonb;
  v_notification_id uuid;
  v_expired boolean := false;
begin
  v_resolution := private.set_pos_operational_incident_state(
    p_license_id,
    p_incident_type,
    p_entity_id,
    false,
    coalesce(p_current_state, '{}'::jsonb)
  );

  if coalesce((v_resolution->>'success')::boolean, false) is false then
    return v_resolution;
  end if;

  if coalesce((v_resolution->>'resolved')::boolean, false) is not true then
    return v_resolution || jsonb_build_object('notification_expired', false);
  end if;

  v_notification_id := nullif(v_resolution->>'notification_id', '')::uuid;

  if v_notification_id is not null then
    update public.pos_notifications n
    set expires_at = clock_timestamp(),
        updated_at = clock_timestamp()
    where n.id = v_notification_id
      and n.license_id = p_license_id
      and (n.expires_at is null or n.expires_at > clock_timestamp());

    v_expired := found;

    if v_expired then
      perform private.broadcast_notification_event(
        p_license_id => p_license_id,
        p_event => 'notifications_changed',
        p_reason => 'inventory_incident_resolved',
        p_notification_id => v_notification_id,
        p_metadata => jsonb_build_object(
          'type', 'inventory',
          'source', 'system',
          'category', 'inventory',
          'event', p_incident_type
        )
      );
    end if;
  end if;

  return v_resolution || jsonb_build_object('notification_expired', v_expired);
end;
$function$;

revoke all on function private.resolve_inventory_operational_incident_v1(uuid,text,text,jsonb)
  from public, anon, authenticated, service_role;


create or replace function private.generate_inventory_operational_notifications(
  p_license_id uuid,
  p_business_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_entitlement record;
  v_open record;
  v_candidate record;
  v_expected_type text;
  v_resolution jsonb;
  v_incident jsonb;
  v_incident_id uuid;
  v_notification_id uuid;
  v_once jsonb;
  v_state jsonb;
  v_metadata jsonb;
  v_title text;
  v_body text;
  v_action_route text;
  v_generated integer := 0;
  v_resolved integer := 0;
  v_active integer := 0;
  v_events jsonb := '[]'::jsonb;
begin
  if p_license_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'LICENSE_ID_REQUIRED',
      'generated', 0,
      'resolved', 0,
      'events', '[]'::jsonb
    );
  end if;

  select *
  into v_entitlement
  from private.license_entitlement_state_v1(p_license_id)
  limit 1;

  if not found then
    return jsonb_build_object(
      'success', false,
      'code', 'LICENSE_NOT_FOUND',
      'generated', 0,
      'resolved', 0,
      'events', '[]'::jsonb
    );
  end if;

  if coalesce(v_entitlement.is_entitled, false) is not true
     or (v_entitlement.effective_features->>'notification_center') is distinct from 'true'
     or (v_entitlement.effective_features->>'cloud_notifications') is distinct from 'true' then
    return jsonb_build_object(
      'success', true,
      'skipped', true,
      'code', 'INVENTORY_CLOUD_NOTIFICATIONS_DISABLED',
      'lifecycle_state', v_entitlement.lifecycle_state,
      'generated', 0,
      'resolved', 0,
      'active', 0,
      'events', '[]'::jsonb,
      'expiry_evaluated', p_business_date is not null
    );
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_license_id::text || ':inventory-operational-alerts:v1', 0)
  );

  -- Resolve stock incidents whose material state no longer matches the current
  -- canonical projection. This covers healthy/inactive/deleted products and
  -- low_stock <-> out_of_stock transitions.
  for v_open in
    select i.incident_type, i.entity_id
    from private.pos_notification_operational_incidents i
    where i.license_id = p_license_id
      and i.resolved_at is null
      and i.incident_type in ('inventory_low_stock', 'inventory_out_of_stock')
    order by i.opened_at, i.id
  loop
    select c.incident_type
    into v_expected_type
    from private.inventory_operational_alert_candidates_v1(
      p_license_id,
      p_business_date
    ) c
    where c.entity_kind = 'product'
      and c.entity_id = coalesce(v_open.entity_id, '')
    limit 1;

    if v_expected_type is distinct from v_open.incident_type then
      v_resolution := private.resolve_inventory_operational_incident_v1(
        p_license_id,
        v_open.incident_type,
        v_open.entity_id,
        jsonb_strip_nulls(jsonb_build_object(
          'reason', 'state_changed',
          'next_incident_type', v_expected_type,
          'business_date', p_business_date,
          'generator_version', 'INVENTORY.ALERTS.4'
        ))
      );

      if coalesce((v_resolution->>'resolved')::boolean, false) then
        v_resolved := v_resolved + 1;
        v_events := v_events || jsonb_build_array(jsonb_build_object(
          'event', 'inventory_incident_resolved',
          'incident_type', v_open.incident_type,
          'entity_kind', 'product',
          'notification_expired', coalesce((v_resolution->>'notification_expired')::boolean, false)
        ));
      end if;
    end if;
  end loop;

  -- Expiry incidents can only be authoritatively advanced/resolved when the
  -- authenticated client supplied a valid civil business date. Missing or
  -- rejected dates fail safe: stock still refreshes, expiry state is untouched.
  if p_business_date is not null then
    for v_open in
      select i.incident_type, i.entity_id
      from private.pos_notification_operational_incidents i
      where i.license_id = p_license_id
        and i.resolved_at is null
        and i.incident_type in (
          'inventory_expiring_warning',
          'inventory_expiring_critical',
          'inventory_expired'
        )
      order by i.opened_at, i.id
    loop
      select c.incident_type
      into v_expected_type
      from private.inventory_operational_alert_candidates_v1(
        p_license_id,
        p_business_date
      ) c
      where c.entity_kind = 'batch'
        and c.entity_id = coalesce(v_open.entity_id, '')
      limit 1;

      if v_expected_type is distinct from v_open.incident_type then
        v_resolution := private.resolve_inventory_operational_incident_v1(
          p_license_id,
          v_open.incident_type,
          v_open.entity_id,
          jsonb_strip_nulls(jsonb_build_object(
            'reason', 'state_changed',
            'next_incident_type', v_expected_type,
            'business_date', p_business_date,
            'generator_version', 'INVENTORY.ALERTS.4'
          ))
        );

        if coalesce((v_resolution->>'resolved')::boolean, false) then
          v_resolved := v_resolved + 1;
          v_events := v_events || jsonb_build_array(jsonb_build_object(
            'event', 'inventory_incident_resolved',
            'incident_type', v_open.incident_type,
            'entity_kind', 'batch',
            'notification_expired', coalesce((v_resolution->>'notification_expired')::boolean, false)
          ));
        end if;
      end if;
    end loop;
  end if;

  for v_candidate in
    select *
    from private.inventory_operational_alert_candidates_v1(
      p_license_id,
      p_business_date
    )
  loop
    v_state := jsonb_strip_nulls(jsonb_build_object(
      'classification', v_candidate.classification,
      'severity', v_candidate.severity,
      'entity_kind', v_candidate.entity_kind,
      'product_id', v_candidate.product_id,
      'batch_id', v_candidate.batch_id,
      'available_stock', v_candidate.available_stock,
      'physical_stock', v_candidate.physical_stock,
      'committed_stock', v_candidate.committed_stock,
      'min_stock', v_candidate.min_stock,
      'min_stock_source', v_candidate.min_stock_source,
      'expiry_date', v_candidate.expiry_date,
      'days_until_expiry', v_candidate.days_until_expiry,
      'expires_today', v_candidate.expires_today,
      'business_date', p_business_date,
      'generator_version', 'INVENTORY.ALERTS.4'
    ));

    v_incident := private.set_pos_operational_incident_state(
      p_license_id,
      v_candidate.incident_type,
      v_candidate.entity_id,
      true,
      v_state
    );

    if coalesce((v_incident->>'success')::boolean, false) is false then
      return jsonb_build_object(
        'success', false,
        'code', 'INVENTORY_INCIDENT_STATE_FAILED',
        'generated', v_generated,
        'resolved', v_resolved,
        'events', v_events
      );
    end if;

    v_incident_id := nullif(v_incident->>'incident_id', '')::uuid;
    v_notification_id := nullif(v_incident->>'notification_id', '')::uuid;

    v_title := case v_candidate.incident_type
      when 'inventory_out_of_stock' then 'Producto agotado'
      when 'inventory_low_stock' then 'Stock bajo'
      when 'inventory_expired' then 'Producto vencido'
      when 'inventory_expiring_critical' then 'Producto vence hoy'
      else 'Producto próximo a caducar'
    end;

    v_body := case v_candidate.incident_type
      when 'inventory_out_of_stock' then
        v_candidate.product_name || ' no tiene stock disponible.'
      when 'inventory_low_stock' then
        v_candidate.product_name || ' tiene ' ||
        v_candidate.available_stock::text ||
        ' disponibles; mínimo configurado: ' ||
        v_candidate.min_stock::text || '.'
      when 'inventory_expired' then
        'Un lote de ' || v_candidate.product_name ||
        ' está vencido y requiere revisión.'
      when 'inventory_expiring_critical' then
        'Un lote de ' || v_candidate.product_name ||
        ' vence hoy y requiere revisión.'
      else
        'Un lote de ' || v_candidate.product_name ||
        ' está próximo a caducar y requiere revisión.'
    end;

    v_action_route := case
      when v_candidate.entity_kind = 'product' then '/ventas?tab=restock'
      else '/ventas?tab=expiration'
    end;

    v_metadata := jsonb_strip_nulls(
      jsonb_build_object(
        'category', 'inventory',
        'event', v_candidate.incident_type,
        'incident_id', v_incident_id,
        'entity_kind', v_candidate.entity_kind,
        'product_id', v_candidate.product_id,
        'batch_id', v_candidate.batch_id,
        'classification', v_candidate.classification,
        'available_stock', v_candidate.available_stock,
        'physical_stock', v_candidate.physical_stock,
        'committed_stock', v_candidate.committed_stock,
        'min_stock', v_candidate.min_stock,
        'min_stock_source', v_candidate.min_stock_source,
        'expiry_date', v_candidate.expiry_date,
        'days_until_expiry', v_candidate.days_until_expiry,
        'expires_today', v_candidate.expires_today,
        'business_date', p_business_date,
        'phase', 'INVENTORY.ALERTS.4',
        'generated_by', 'INVENTORY.ALERTS.4'
      )
    );

    if v_notification_id is null then
      v_once := private.create_pos_notification_once(
        p_license_id => p_license_id,
        p_event_key => 'inventory:' || v_incident_id::text,
        p_type => 'inventory',
        p_severity => v_candidate.severity,
        p_title => v_title,
        p_body => v_body,
        p_action_label => 'Revisar',
        p_action_route => v_action_route,
        p_metadata => v_metadata,
        p_source => 'system',
        p_expires_at => null
      );

      if coalesce((v_once->>'success')::boolean, false) is false then
        return jsonb_build_object(
          'success', false,
          'code', 'INVENTORY_NOTIFICATION_CREATE_FAILED',
          'generated', v_generated,
          'resolved', v_resolved,
          'events', v_events
        );
      end if;

      v_notification_id := nullif(v_once->>'notification_id', '')::uuid;

      if v_notification_id is not null then
        update private.pos_notification_operational_incidents i
        set notification_id = v_notification_id,
            updated_at = now()
        where i.id = v_incident_id
          and i.license_id = p_license_id;
      end if;

      if coalesce((v_once->>'created')::boolean, false) then
        v_generated := v_generated + 1;
      end if;
    else
      -- Keep the same incident and notification for non-material changes while
      -- refreshing dynamic copy/metadata without emitting a new notification.
      update public.pos_notifications n
      set body = v_body,
          metadata = n.metadata || v_metadata,
          updated_at = now()
      where n.id = v_notification_id
        and n.license_id = p_license_id;

      v_once := jsonb_build_object(
        'success', true,
        'created', false,
        'notification_id', v_notification_id,
        'event_key', 'inventory:' || v_incident_id::text
      );
    end if;

    v_active := v_active + 1;

    v_events := v_events || jsonb_build_array(jsonb_build_object(
      'event', v_candidate.incident_type,
      'classification', v_candidate.classification,
      'severity', v_candidate.severity,
      'entity_kind', v_candidate.entity_kind,
      'created', coalesce((v_once->>'created')::boolean, false),
      'incident_id', v_incident_id,
      'notification_id', v_notification_id
    ));
  end loop;

  return jsonb_build_object(
    'success', true,
    'generated', v_generated,
    'resolved', v_resolved,
    'active', v_active,
    'events', v_events,
    'expiry_evaluated', p_business_date is not null,
    'business_date', p_business_date
  );
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'code', 'GENERATE_INVENTORY_OPERATIONAL_NOTIFICATIONS_ERROR',
      'generated', 0,
      'resolved', 0,
      'active', 0,
      'events', '[]'::jsonb
    );
end;
$function$;

revoke all on function private.generate_inventory_operational_notifications(uuid,date)
  from public, anon, authenticated, service_role;


-- New five-argument overload used by current clients. The fifth argument is
-- required so PostgREST can resolve legacy four-argument callers without an
-- ambiguous defaulted overload.
create or replace function public.refresh_operational_notifications(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_business_date text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license record;
  v_device record;
  v_features jsonb;
  v_actor jsonb;
  v_permissions jsonb := '{}'::jsonb;
  v_generation jsonb;
  v_sync_generation jsonb;
  v_cash_generation jsonb;
  v_staff_generation jsonb;
  v_inventory_generation jsonb;
  v_inventory_business_date date;
  v_generated integer := 0;
  v_events jsonb := '[]'::jsonb;
begin
  perform public.enforce_pos_rpc_rate_limit_v2(
    p_license_key,
    p_device_fingerprint,
    p_staff_session_token,
    'refresh_operational_notifications',
    'notifications',
    60,
    60,
    120,
    'OPERATIONAL_NOTIFICATIONS_RATE_LIMITED',
    jsonb_build_object('phase', 'SHARED.TERMINAL.2')
  );

  if p_license_key is null or btrim(p_license_key) = '' then
    return jsonb_build_object('success', false, 'code', 'LICENSE_KEY_REQUIRED', 'message', 'Falta licencia.');
  end if;
  if p_device_fingerprint is null or btrim(p_device_fingerprint) = '' then
    return jsonb_build_object('success', false, 'code', 'DEVICE_FINGERPRINT_REQUIRED', 'message', 'Falta identificador del dispositivo.');
  end if;

  select
    l.id,
    l.license_key,
    l.status,
    l.expires_at,
    coalesce(p.code, l.license_type::text) as plan_code,
    p.name as plan_name,
    coalesce(p.features, '{}'::jsonb) as plan_features,
    coalesce(l.features, '{}'::jsonb) as license_features
  into v_license
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  where l.license_key = p_license_key
  limit 1;

  if v_license.id is null then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_FOUND', 'message', 'Licencia no encontrada.');
  end if;

  if coalesce(v_license.status, '') not in ('active', 'expired', 'grace', 'blocked') then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_ACTIVE', 'message', 'La licencia no esta activa.');
  end if;

  select d.id, d.security_token, d.previous_security_token, d.is_active, d.device_mode
  into v_device
  from public.license_devices d
  where d.license_id = v_license.id
    and d.device_fingerprint = p_device_fingerprint
  limit 1;

  if v_device.id is null then
    return jsonb_build_object('success', false, 'code', 'DEVICE_NOT_ALLOWED', 'message', 'Este dispositivo no esta autorizado.');
  end if;
  if v_device.is_active is not true then
    return jsonb_build_object('success', false, 'code', 'DEVICE_NOT_ACTIVE', 'message', 'Este dispositivo esta desactivado.');
  end if;
  if v_device.security_token is null or nullif(p_security_token, '') is null then
    return jsonb_build_object('success', false, 'code', 'DEVICE_TOKEN_REQUIRED', 'message', 'Falta token seguro del dispositivo.');
  end if;
  if p_security_token <> v_device.security_token
     and (v_device.previous_security_token is null or p_security_token <> v_device.previous_security_token) then
    return jsonb_build_object('success', false, 'code', 'DEVICE_TOKEN_INVALID', 'message', 'Token seguro del dispositivo invalido.');
  end if;

  v_features := coalesce(v_license.plan_features, '{}'::jsonb)
    || coalesce(v_license.license_features, '{}'::jsonb);

  if (v_features->>'notification_center') is distinct from 'true'
     or (v_features->>'cloud_notifications') is distinct from 'true' then
    return jsonb_build_object(
      'success', false,
      'code', 'CLOUD_NOTIFICATIONS_DISABLED',
      'message', 'Este plan no incluye notificaciones cloud.',
      'generated', 0,
      'events', '[]'::jsonb
    );
  end if;

  v_actor := private.resolve_device_actor_session(
    v_license.id,
    v_device.id,
    v_device.device_mode,
    p_staff_session_token
  );

  if coalesce((v_actor->>'success')::boolean, false) is false then
    return jsonb_build_object(
      'success', false,
      'code', coalesce(v_actor->>'code', 'ACTOR_SESSION_INVALID'),
      'message', 'No se pudo validar la sesion del actor.',
      'generated', 0,
      'events', '[]'::jsonb
    );
  end if;

  v_permissions := coalesce(v_actor->'actor_permissions', '{}'::jsonb);
  if v_actor->>'actor_type' = 'staff'
     and coalesce((v_permissions->>'notifications')::boolean, false) is not true then
    return jsonb_build_object(
      'success', false,
      'code', 'STAFF_NOTIFICATIONS_DISABLED',
      'message', 'Tu usuario staff no tiene acceso al Centro de Notificaciones.',
      'generated', 0,
      'events', '[]'::jsonb
    );
  end if;

  v_inventory_business_date :=
    private.validate_inventory_operational_business_date_v1(p_business_date);

  v_generation := private.generate_license_operational_notifications(v_license.id);
  if v_generation->>'success' = 'false' then return v_generation; end if;
  v_generated := v_generated + coalesce((v_generation->>'generated')::integer, 0);
  v_events := v_events || coalesce(v_generation->'events', '[]'::jsonb);

  v_sync_generation := private.generate_sync_operational_notifications(v_license.id);
  if v_sync_generation->>'success' = 'false' then return v_sync_generation; end if;
  v_generated := v_generated + coalesce((v_sync_generation->>'generated')::integer, 0);
  v_events := v_events || coalesce(v_sync_generation->'events', '[]'::jsonb);

  v_cash_generation := private.generate_cash_operational_notifications(v_license.id);
  if v_cash_generation->>'success' = 'false' then return v_cash_generation; end if;
  v_generated := v_generated + coalesce((v_cash_generation->>'generated')::integer, 0);
  v_events := v_events || coalesce(v_cash_generation->'events', '[]'::jsonb);

  v_staff_generation := private.generate_staff_operational_notifications(v_license.id);
  if v_staff_generation->>'success' = 'false' then return v_staff_generation; end if;
  v_generated := v_generated + coalesce((v_staff_generation->>'generated')::integer, 0);
  v_events := v_events || coalesce(v_staff_generation->'events', '[]'::jsonb);

  v_inventory_generation := private.generate_inventory_operational_notifications(
    v_license.id,
    v_inventory_business_date
  );
  if v_inventory_generation->>'success' = 'false' then return v_inventory_generation; end if;
  v_generated := v_generated + coalesce((v_inventory_generation->>'generated')::integer, 0);
  v_events := v_events || coalesce(v_inventory_generation->'events', '[]'::jsonb);

  return jsonb_build_object(
    'success', true,
    'generated', v_generated,
    'events', v_events,
    'actor_type', v_actor->>'actor_type',
    'actor_key', v_actor->>'actor_key',
    'inventory', v_inventory_generation,
    'inventory_business_date_valid', v_inventory_business_date is not null
  );
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'code', case
        when sqlerrm = 'STAFF_NOTIFICATIONS_DISABLED' then 'STAFF_NOTIFICATIONS_DISABLED'
        else 'REFRESH_OPERATIONAL_NOTIFICATIONS_ERROR'
      end,
      'message', case
        when sqlerrm = 'STAFF_NOTIFICATIONS_DISABLED'
          then 'Tu usuario staff no tiene acceso al Centro de Notificaciones.'
        else 'No se pudieron refrescar las notificaciones operativas.'
      end,
      'generated', 0,
      'events', '[]'::jsonb
    );
end;
$function$;

revoke all on function public.refresh_operational_notifications(text,text,text,text,text)
  from public;
grant execute on function public.refresh_operational_notifications(text,text,text,text,text)
  to anon, authenticated, service_role;


-- Preserve the legacy four-argument RPC contract. It delegates through the same
-- authorization/pipeline but does not advance expiry incidents without a
-- validated civil date. Stock incidents still materialize.
create or replace function public.refresh_operational_notifications(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select public.refresh_operational_notifications(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    null::text
  );
$function$;

revoke all on function public.refresh_operational_notifications(text,text,text,text)
  from public;
grant execute on function public.refresh_operational_notifications(text,text,text,text)
  to anon, authenticated, service_role;

comment on function private.inventory_operational_alert_candidates_v1(uuid,date) is
  'Phase 4 server-side projection of the Phase 1 JavaScript inventory operational alert contract.';
comment on function private.generate_inventory_operational_notifications(uuid,date) is
  'Materializes entitled cloud inventory incidents into the existing POS notification center without modifying inventory.';
comment on function public.refresh_operational_notifications(text,text,text,text,text) is
  'Authorized operational notification refresh with validated client civil date for cloud inventory expiry parity.';
