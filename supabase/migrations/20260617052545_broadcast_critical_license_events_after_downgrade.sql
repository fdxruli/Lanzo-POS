create or replace function private.broadcast_license_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_target_fingerprint text;
  v_broadcast_all boolean;
  v_bypass_feature_gate boolean;
  v_device record;
  v_safe_metadata jsonb;
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
    'LICENSE_RENEWED'
  );

  -- Eventos que deben avisarse incluso si el cambio dejó la licencia sin Realtime.
  -- Ejemplo crítico: Pro -> Free. Después del UPDATE la feature ya es false,
  -- pero los clientes que estaban conectados como Pro deben recibir el aviso,
  -- revalidar y apagar su canal Realtime.
  v_bypass_feature_gate := new.event_type in (
    'LICENSE_UPDATE',
    'LICENSE_REVOKED',
    'LICENSE_SUSPENDED',
    'SUBSCRIPTION_UPDATED',
    'PLAN_CHANGED',
    'LICENSE_RENEWED',
    'DEVICE_BANNED',
    'DEVICE_DELETED',
    'DEVICE_RELEASED'
  );

  -- Payload mínimo. Evita reenviar metadata arbitraria completa a clientes.
  v_safe_metadata := jsonb_strip_nulls(jsonb_build_object(
    'source', new.metadata->>'source',
    'reason', new.metadata->>'reason',
    'status', new.metadata->>'status',
    'plan', new.metadata->>'plan',
    'plan_name', new.metadata->>'plan_name',
    'from_plan', new.metadata->>'from_plan',
    'to_plan', new.metadata->>'to_plan',
    'from_plan_name', new.metadata->>'from_plan_name',
    'to_plan_name', new.metadata->>'to_plan_name',
    'product_name', new.metadata->>'product_name',
    'changed_fields', new.metadata->'changed_fields',
    'max_devices', new.metadata->'max_devices',
    'old_max_devices', new.metadata->'old_max_devices',
    'new_max_devices', new.metadata->'new_max_devices',
    'fingerprint', case when new.event_type in ('DEVICE_BANNED', 'DEVICE_DELETED', 'DEVICE_RELEASED') then v_target_fingerprint else null end,
    'target_fingerprint', case when new.event_type in ('DEVICE_BANNED', 'DEVICE_DELETED', 'DEVICE_RELEASED') then v_target_fingerprint else null end
  ));

  for v_device in
    select d.realtime_topic, d.device_fingerprint
    from public.license_devices d
    join public.licenses l on l.id = d.license_id
    left join public.plans p on p.id = l.plan_id
    where l.license_key = new.license_key
      and d.realtime_topic is not null
      and (
        v_bypass_feature_gate
        or private.license_realtime_enabled(p.features, l.features)
      )
      and (
        (v_broadcast_all and d.is_active = true)
        or (v_target_fingerprint is not null and d.device_fingerprint = v_target_fingerprint)
      )
  loop
    perform realtime.send(
      jsonb_build_object(
        'event_type', new.event_type,
        'triggered_at', new.triggered_at,
        'metadata', coalesce(v_safe_metadata, '{}'::jsonb)
      ),
      'license_event',
      v_device.realtime_topic,
      true
    );
  end loop;

  return new;
end;
$function$;;
