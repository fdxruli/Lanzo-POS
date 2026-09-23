-- Phase 4 navigation hardening.
-- Inventory notifications carry domain state, not an authoritative route. Current
-- clients derive the CTA from the authenticated actor's live permissions.

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
        p_action_label => null,
        p_action_route => null,
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


do $phase4_action_hardening$
declare
  v_license_id uuid;
begin
  for v_license_id in
    select distinct n.license_id
    from public.pos_notifications n
    where n.type = 'inventory'
      and n.metadata->>'phase' = 'INVENTORY.ALERTS.4'
      and (n.action_label is not null or n.action_route is not null)
  loop
    update public.pos_notifications n
    set action_label = null,
        action_route = null,
        updated_at = now()
    where n.license_id = v_license_id
      and n.type = 'inventory'
      and n.metadata->>'phase' = 'INVENTORY.ALERTS.4';

    perform private.broadcast_notification_event(
      p_license_id => v_license_id,
      p_event => 'notifications_changed',
      p_reason => 'inventory_action_contract_hardened',
      p_notification_id => null,
      p_metadata => jsonb_build_object(
        'type', 'inventory',
        'category', 'inventory'
      )
    );
  end loop;
end
$phase4_action_hardening$;
