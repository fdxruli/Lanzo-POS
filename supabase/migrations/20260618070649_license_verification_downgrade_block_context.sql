create or replace function public.verify_device_license_unified(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
    v_license record;
    v_device record;
    v_staff_user record;
    v_new_token text;
    v_grace_days integer := 7;
    v_is_in_grace boolean := false;
    v_latest_term_id uuid;
    v_latest_term_version text;
    v_terms_accepted boolean := true;
    v_realtime_topic text;
    v_staff_roles_enabled boolean;
    v_staff_user_payload jsonb;
    v_block jsonb;
    v_block_reason text;
    v_block_message text;
begin
    select
      l.id,
      l.status,
      l.product_name,
      coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb) as effective_features,
      l.expires_at,
      l.license_key,
      coalesce(l.max_devices, p.max_devices, 1) as max_devices,
      p.code as plan_code,
      p.name as plan_name
    into v_license
    from public.licenses l
    left join public.plans p on p.id = l.plan_id
    where l.license_key = p_license_key;

    if v_license.id is null then
        return jsonb_build_object('valid', false, 'status', 'not_found', 'reason', 'LICENSE_NOT_FOUND');
    end if;

    v_staff_roles_enabled := coalesce((v_license.effective_features->>'staff_roles')::boolean, false);

    if v_license.status != 'active' then
        return jsonb_build_object('valid', false, 'status', 'suspended', 'reason', 'LICENSE_SUSPENDED');
    end if;

    if v_license.expires_at is not null and v_license.expires_at < now() then
        if v_license.expires_at > (now() - (v_grace_days || ' days')::interval) then
            v_is_in_grace := true;
        else
            return jsonb_build_object(
                'valid', false,
                'status', 'expired',
                'reason', 'LICENSE_EXPIRED',
                'expires_at', v_license.expires_at,
                'max_devices', v_license.max_devices,
                'plan_code', v_license.plan_code,
                'plan_name', v_license.plan_name
            );
        end if;
    end if;

    select id, device_name, security_token, previous_security_token, is_active, realtime_topic, device_role, staff_user_id, device_info
    into v_device
    from public.license_devices
    where license_id = v_license.id
      and device_fingerprint = p_device_fingerprint
    limit 1;

    if v_device.id is null then
        return jsonb_build_object(
          'valid', false,
          'status', 'device_banned',
          'reason', 'DEVICE_NOT_ALLOWED',
          'message', 'Este dispositivo no esta autorizado para esta licencia.',
          'plan_code', v_license.plan_code,
          'plan_name', v_license.plan_name
        );
    end if;

    v_block := coalesce(v_device.device_info->'license_block', '{}'::jsonb);
    v_block_reason := nullif(v_block->>'reason', '');
    v_block_message := nullif(v_block->>'message', '');

    if v_device.is_active = false then
        return jsonb_build_object(
          'valid', false,
          'status', 'device_banned',
          'reason', 'DEVICE_NOT_ALLOWED',
          'block_reason', coalesce(v_block_reason, 'DEVICE_NOT_ALLOWED'),
          'message', coalesce(v_block_message, 'Este dispositivo fue desactivado o ya no esta permitido en esta licencia.'),
          'license_key', v_license.license_key,
          'plan_code', v_license.plan_code,
          'plan_name', v_license.plan_name,
          'product_name', v_license.product_name,
          'max_devices', v_license.max_devices,
          'device_role', coalesce(v_device.device_role, 'staff')
        );
    end if;

    -- Defensa en profundidad: si por algun motivo un dispositivo staff quedo activo
    -- despues de bajar a un plan sin staff, se bloquea en la misma verificacion.
    if coalesce(v_device.device_role, 'staff') = 'staff' and not v_staff_roles_enabled then
        update public.license_devices d
        set
          is_active = false,
          security_token = null,
          previous_security_token = null,
          last_check_at = now(),
          device_info = coalesce(d.device_info, '{}'::jsonb) || jsonb_build_object(
            'license_block', jsonb_build_object(
              'reason', 'PLAN_DOWNGRADE_STAFF_NOT_INCLUDED',
              'message', 'Esta licencia cambio a un plan que no incluye usuarios staff. Cambia la licencia o pide al administrador actualizar el plan.',
              'plan_code', v_license.plan_code,
              'plan_name', v_license.plan_name,
              'blocked_at', now()
            )
          )
        where d.id = v_device.id;

        update public.license_staff_sessions s
        set
          revoked_at = coalesce(s.revoked_at, now()),
          metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object(
            'revoked_reason', 'PLAN_DOWNGRADE_STAFF_NOT_INCLUDED',
            'revoked_at', now(),
            'plan_code', v_license.plan_code,
            'plan_name', v_license.plan_name
          )
        where s.license_id = v_license.id
          and s.device_id = v_device.id
          and s.revoked_at is null;

        return jsonb_build_object(
          'valid', false,
          'status', 'device_banned',
          'reason', 'DEVICE_NOT_ALLOWED',
          'block_reason', 'PLAN_DOWNGRADE_STAFF_NOT_INCLUDED',
          'message', 'Esta licencia cambio a un plan que no incluye usuarios staff. Cambia la licencia para continuar en este equipo.',
          'license_key', v_license.license_key,
          'plan_code', v_license.plan_code,
          'plan_name', v_license.plan_name,
          'product_name', v_license.product_name,
          'max_devices', v_license.max_devices,
          'device_role', 'staff'
        );
    end if;

    if v_device.device_role = 'staff' and v_staff_roles_enabled then
        select id, username, display_name, role_name, permissions, is_active
        into v_staff_user
        from public.license_staff_users
        where id = v_device.staff_user_id
          and license_id = v_license.id;

        if v_device.staff_user_id is null or v_staff_user.id is null or v_staff_user.is_active = false then
            return jsonb_build_object(
              'valid', false,
              'status', 'staff_login_required',
              'reason', 'STAFF_LOGIN_REQUIRED',
              'staff_login_required', true,
              'device_role', 'staff'
            );
        end if;

        v_staff_user_payload := jsonb_build_object(
          'id', v_staff_user.id,
          'username', v_staff_user.username,
          'display_name', v_staff_user.display_name,
          'role_name', v_staff_user.role_name,
          'permissions', v_staff_user.permissions
        );
    else
        v_staff_user_payload := null;
    end if;

    if v_device.realtime_topic is null then
        update public.license_devices
        set realtime_topic = private.generate_license_realtime_topic()
        where id = v_device.id
        returning realtime_topic into v_realtime_topic;
    else
        v_realtime_topic := v_device.realtime_topic;
    end if;

    if v_device.security_token is not null then
        if p_security_token is null or p_security_token = '' then
            return jsonb_build_object('valid', false, 'status', 'token_required', 'reason', 'DEVICE_TOKEN_REQUIRED');
        elsif p_security_token = v_device.security_token then
            null;
        elsif p_security_token = v_device.previous_security_token then
            return jsonb_build_object(
                'valid', true,
                'status', case when v_is_in_grace then 'grace_period' else 'active' end,
                'license_status', v_license.status,
                'license_key', v_license.license_key,
                'product_name', v_license.product_name,
                'max_devices', v_license.max_devices,
                'plan_code', v_license.plan_code,
                'plan_name', v_license.plan_name,
                'features', coalesce(v_license.effective_features, '{}'::jsonb),
                'device_name', v_device.device_name,
                'device_role', coalesce(v_device.device_role, 'staff'),
                'staff_user', v_staff_user_payload,
                'expires_at', v_license.expires_at,
                'grace_period_ends', case when v_is_in_grace then v_license.expires_at + (v_grace_days || ' days')::interval else null end,
                'new_security_token', v_device.security_token,
                'realtime_topic', case
                  when coalesce((v_license.effective_features->>'realtime_license_sync') = 'true', false) then v_realtime_topic
                  else null
                end
            );
        else
            return jsonb_build_object('valid', false, 'status', 'cloned', 'reason', 'CLONING_DETECTED');
        end if;
    end if;

    v_new_token := extensions.gen_random_uuid()::text;
    update public.license_devices
    set previous_security_token = security_token,
        security_token = v_new_token,
        last_used_at = now(),
        last_check_at = now()
    where id = v_device.id;

    select id, version into v_latest_term_id, v_latest_term_version
    from public.legal_terms
    where type = 'terms_of_use' and is_active = true
    order by published_at desc
    limit 1;

    if v_latest_term_id is not null then
        select exists (
            select 1
            from public.legal_acceptances
            where license_id = v_license.id
              and term_id = v_latest_term_id
        ) into v_terms_accepted;
    end if;

    return jsonb_build_object(
        'valid', true,
        'status', case when v_is_in_grace then 'grace_period' else 'active' end,
        'license_status', v_license.status,
        'license_key', v_license.license_key,
        'product_name', v_license.product_name,
        'max_devices', v_license.max_devices,
        'plan_code', v_license.plan_code,
        'plan_name', v_license.plan_name,
        'features', coalesce(v_license.effective_features, '{}'::jsonb),
        'device_name', v_device.device_name,
        'device_role', coalesce(v_device.device_role, 'staff'),
        'staff_user', v_staff_user_payload,
        'expires_at', v_license.expires_at,
        'grace_period_ends', case when v_is_in_grace then v_license.expires_at + (v_grace_days || ' days')::interval else null end,
        'new_security_token', v_new_token,
        'realtime_topic', case
          when coalesce((v_license.effective_features->>'realtime_license_sync') = 'true', false) then v_realtime_topic
          else null
        end,
        'legal_status', jsonb_build_object(
            'has_updated_terms', not v_terms_accepted,
            'latest_version', v_latest_term_version,
            'term_id', v_latest_term_id
        )
    );
end;
$$;

comment on function public.verify_device_license_unified(text, text, text) is
'Verifica licencia/dispositivo. Incluye block_reason/message para dispositivos bloqueados por downgrade y bloquea staff activo en planes sin staff.';
;
