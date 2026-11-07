-- SOLO LECTURA. Reemplazar licencia. No devuelve contraseñas ni tokens.
SELECT
  l.license_key,
  bp.business_name,
  bp.business_type,
  p.code AS plan_interno,
  l.status AS licencia_estado,
  l.max_devices,
  l.is_lifetime,
  e.lifecycle_state,
  e.is_entitled,
  (SELECT count(*) FROM public.license_periods lp
    WHERE lp.license_id=l.id AND lp.status='active') AS periodos_activos,
  (SELECT count(*) FROM public.business_profiles b
    WHERE b.license_id=l.id) AS perfiles,
  (SELECT count(*) FROM public.license_admin_users u
    WHERE u.license_id=l.id AND u.is_owner) AS propietarios_total,
  (SELECT count(*) FROM public.license_admin_users u
    WHERE u.license_id=l.id AND u.is_owner AND u.is_active) AS propietarios_activos,
  (SELECT count(*) FROM public.license_devices d
    WHERE d.license_id=l.id AND d.is_active) AS dispositivos_activos,
  (SELECT count(*) FROM public.license_admin_sessions s
    WHERE s.license_id=l.id AND s.revoked_at IS NULL AND s.expires_at > now()) AS sesiones_vigentes,
  (SELECT count(*) FROM private.license_onboarding_invitations i
    WHERE i.license_id=l.id AND i.consumed_at IS NULL AND i.revoked_at IS NULL
      AND i.expires_at > now()) AS invitaciones_pendientes,
  (SELECT count(*) FROM private.license_onboarding_invitations i
    WHERE i.license_id=l.id AND i.consumed_at IS NOT NULL) AS invitaciones_consumidas
FROM public.licenses l
JOIN public.plans p ON p.id=l.plan_id
LEFT JOIN public.business_profiles bp ON bp.license_id=l.id
CROSS JOIN LATERAL private.license_entitlement_state_v1(l.id) e
WHERE l.license_key='COLOCA_LICENCIA_AQUI';
-- Tras 01 (antes del código): entitlement true, 1 período activo, 1 perfil,
-- 0 propietario, 0 dispositivo, 0 invitación pendiente/consumida.
-- Tras 02 (antes del alta): 1 invitación pendiente.
-- Tras alta en Android: 1 propietario, 1 dispositivo, 1 invitación consumida.
