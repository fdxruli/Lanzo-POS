-- Lanzo POS - Hardening de licencias, renovacion, terminos y Storage
-- Aplicado desde ChatGPT/Supabase MCP.

-- ============================================================
-- 1) Storage: limitar bucket public images sin romper subidas actuales
-- ============================================================
update storage.buckets
set
  file_size_limit = 5242880, -- 5 MB
  allowed_mime_types = array[
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif'
  ]::text[],
  updated_at = now()
where id = 'images';

-- La app actual sube con upsert=false, por lo que UPDATE anonimo no es necesario.
drop policy if exists "Permitir actualizar imágenes anónimamente" on storage.objects;
drop policy if exists "Permitir subir imágenes anónimamente" on storage.objects;
drop policy if exists "Permitir subir imágenes anónimamente a public_uploads" on storage.objects;

create policy "Permitir subir imágenes anónimamente a public_uploads"
on storage.objects
for insert
to public
with check (
  bucket_id = 'images'
  and name like 'public_uploads/%'
  and lower(name) ~ '\.(png|jpg|jpeg|webp|gif)$'
);

-- ============================================================
-- 2) Realtime: retirar tablas sensibles de la publicacion general
--    Se conserva license_events porque el frontend actual lo usa.
-- ============================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname='public' and tablename='business_profiles') then
      alter publication supabase_realtime drop table public.business_profiles;
    end if;
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname='public' and tablename='legal_acceptances') then
      alter publication supabase_realtime drop table public.legal_acceptances;
    end if;
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname='public' and tablename='legal_terms') then
      alter publication supabase_realtime drop table public.legal_terms;
    end if;
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname='public' and tablename='license_devices') then
      alter publication supabase_realtime drop table public.license_devices;
    end if;
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname='public' and tablename='licenses') then
      alter publication supabase_realtime drop table public.licenses;
    end if;
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname='public' and tablename='subscriptions') then
      alter publication supabase_realtime drop table public.subscriptions;
    end if;
  end if;
end $$;

-- ============================================================
-- 3) Integridad legal: una aceptacion por licencia y termino
-- ============================================================
create unique index if not exists legal_acceptances_license_term_key
on public.legal_acceptances (license_id, term_id);

-- ============================================================
-- 4) Backfill: dispositivos activos sin token de seguridad
-- ============================================================
update public.license_devices
set security_token = encode(extensions.gen_random_bytes(32), 'hex')
where is_active = true
  and (security_token is null or security_token = '');

-- ============================================================
-- 5) Activacion: generar y devolver token inicial de dispositivo
-- ============================================================
create or replace function public.activate_license_on_device(
  license_key_param text,
  device_fingerprint_param text,
  device_name_param text,
  device_info_param jsonb
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_license_record public.licenses%rowtype;
  v_device_record record;
  v_current_count int;
  v_security_token text;
begin
  select * into v_license_record
  from public.licenses
  where license_key = license_key_param
  for update;

  if v_license_record.id is null then
    return json_build_object('success', false, 'error', 'Licencia no encontrada.');
  end if;

  if v_license_record.status <> 'active' then
    return json_build_object('success', false, 'error', 'La licencia no está activa o ha sido suspendida.');
  end if;

  if v_license_record.expires_at is not null and v_license_record.expires_at < now() then
    return json_build_object('success', false, 'error', 'La licencia ha caducado.');
  end if;

  if v_license_record.expires_at is null
     and coalesce(v_license_record.is_lifetime, false) = false
     and v_license_record.duration_months is not null then
    update public.licenses
    set expires_at = now() + (v_license_record.duration_months || ' months')::interval
    where id = v_license_record.id;

    v_license_record.expires_at := now() + (v_license_record.duration_months || ' months')::interval;
  end if;

  select * into v_device_record
  from public.license_devices
  where license_id = v_license_record.id
    and device_fingerprint = device_fingerprint_param;

  if v_device_record is not null then
    return json_build_object(
      'success', false,
      'error', '⛔️ ACCESO DENEGADO: Esta licencia ya fue utilizada y cerrada en este dispositivo. Por seguridad, no se permite su reutilización.'
    );
  end if;

  select count(*) into v_current_count
  from public.license_devices
  where license_id = v_license_record.id
    and is_active = true;

  if (v_current_count + 1) > v_license_record.max_devices then
    return json_build_object('success', false, 'error', 'Límite de dispositivos alcanzado para esta licencia.');
  end if;

  v_security_token := encode(extensions.gen_random_bytes(32), 'hex');

  begin
    insert into public.license_devices (
      license_id,
      device_fingerprint,
      device_name,
      device_info,
      is_active,
      security_token,
      last_check_at
    ) values (
      v_license_record.id,
      device_fingerprint_param,
      device_name_param,
      device_info_param,
      true,
      v_security_token,
      now()
    );
  exception when unique_violation then
    return json_build_object(
      'success', false,
      'error', 'Error: Este dispositivo ya está registrado. No se puede duplicar el uso.'
    );
  end;

  insert into public.license_usage_logs (license_id, device_fingerprint, action, metadata)
  values (v_license_record.id, device_fingerprint_param, 'ACTIVATE', coalesce(device_info_param, '{}'::jsonb));

  return json_build_object(
    'success', true,
    'message', 'Licencia activada correctamente',
    'device_security_token', v_security_token,
    'details', json_build_object(
      'license_key', license_key_param,
      'product_name', v_license_record.product_name,
      'expires_at', v_license_record.expires_at,
      'max_devices', v_license_record.max_devices,
      'features', v_license_record.features,
      'security_token', v_security_token,
      'token', v_security_token
    )
  );
end;
$$;

-- ============================================================
-- 6) Trial: claves mas largas, token inicial y errores genericos
-- ============================================================
create or replace function public.create_free_trial_license(
  device_fingerprint_param text,
  device_name_param text,
  device_info_param jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_count integer;
  new_license_id uuid;
  new_key text;
  trial_plan_id uuid;
  v_security_token text;
  trial_features jsonb := '{
    "full_access": true,
    "max_rubros": 1,
    "allowed_rubros": ["*"]
  }'::jsonb;
  attempts integer := 0;
begin
  if device_fingerprint_param is null or length(trim(device_fingerprint_param)) < 8 then
    return jsonb_build_object('success', false, 'error', 'DEVICE_FINGERPRINT_INVALID');
  end if;

  select count(*) into existing_count
  from public.license_devices
  where device_fingerprint = device_fingerprint_param;

  if existing_count > 0 then
    return jsonb_build_object('success', false, 'error', 'Este dispositivo ya ha utilizado una licencia anteriormente.');
  end if;

  select id into trial_plan_id
  from public.plans
  where code = 'free_trial'
    and is_active = true
  limit 1;

  if trial_plan_id is null then
    return jsonb_build_object('success', false, 'error', 'TRIAL_PLAN_NOT_AVAILABLE');
  end if;

  loop
    attempts := attempts + 1;
    new_key := 'LANZO-TRIAL-' || upper(encode(extensions.gen_random_bytes(8), 'hex'));

    begin
      insert into public.licenses (
        license_key,
        plan_id,
        license_type,
        max_devices,
        duration_months,
        status,
        expires_at,
        product_name,
        features
      ) values (
        new_key,
        trial_plan_id,
        'trial',
        1,
        3,
        'active',
        now() + interval '3 months',
        'Lanzo POS (FREE-TRIAL)',
        trial_features
      ) returning id into new_license_id;

      exit;
    exception when unique_violation then
      if attempts >= 5 then
        return jsonb_build_object('success', false, 'error', 'LICENSE_KEY_GENERATION_FAILED');
      end if;
    end;
  end loop;

  v_security_token := encode(extensions.gen_random_bytes(32), 'hex');

  begin
    insert into public.license_devices (
      license_id,
      device_fingerprint,
      device_name,
      device_info,
      is_active,
      security_token,
      last_check_at
    ) values (
      new_license_id,
      device_fingerprint_param,
      device_name_param,
      coalesce(device_info_param, '{}'::jsonb),
      true,
      v_security_token,
      now()
    );
  exception when unique_violation then
    delete from public.licenses where id = new_license_id;
    return jsonb_build_object('success', false, 'error', 'Este dispositivo ya ha utilizado una licencia anteriormente.');
  end;

  insert into public.license_usage_logs (license_id, device_fingerprint, action, metadata)
  values (new_license_id, device_fingerprint_param, 'CREATE_FREE_TRIAL', coalesce(device_info_param, '{}'::jsonb));

  insert into public.license_events (license_key, event_type, metadata)
  values (
    new_key,
    'TRIAL_CREATED',
    jsonb_build_object('fingerprint', device_fingerprint_param, 'created_at', now())
  );

  return jsonb_build_object(
    'success', true,
    'license_key', new_key,
    'expires_at', now() + interval '3 months',
    'features', trial_features,
    'product_name', 'Lanzo POS (FREE-TRIAL)',
    'max_devices', 1,
    'device_security_token', v_security_token,
    'security_token', v_security_token,
    'details', jsonb_build_object(
      'license_key', new_key,
      'expires_at', now() + interval '3 months',
      'features', trial_features,
      'product_name', 'Lanzo POS (FREE-TRIAL)',
      'max_devices', 1,
      'security_token', v_security_token,
      'token', v_security_token
    )
  );
exception when others then
  return jsonb_build_object('success', false, 'error', 'TRIAL_CREATION_FAILED');
end;
$$;

-- ============================================================
-- 7) Renovacion free: endurecida y ejecutable por cliente actual
-- ============================================================
create or replace function public.renew_license_free(
  license_key_param text,
  device_fingerprint_param text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_license_id uuid;
  v_current_expiry timestamptz;
  v_current_status text;
  v_license_type text;
  v_is_lifetime boolean;
  v_new_expiry timestamptz;
  v_device_authorized boolean;
begin
  select id, expires_at, status, license_type, coalesce(is_lifetime, false)
  into v_license_id, v_current_expiry, v_current_status, v_license_type, v_is_lifetime
  from public.licenses
  where license_key = license_key_param;

  if v_license_id is null then
    return jsonb_build_object('success', false, 'message', 'Licencia no encontrada');
  end if;

  if v_current_status <> 'active' then
    return jsonb_build_object('success', false, 'message', 'La licencia no está activa para renovación');
  end if;

  if v_is_lifetime then
    return jsonb_build_object('success', false, 'message', 'La licencia vitalicia no requiere renovación');
  end if;

  if v_license_type <> 'trial' then
    return jsonb_build_object('success', false, 'message', 'Esta renovación gratuita solo aplica a licencias de prueba');
  end if;

  select exists (
    select 1
    from public.license_devices
    where license_id = v_license_id
      and device_fingerprint = device_fingerprint_param
      and is_active = true
  ) into v_device_authorized;

  if not v_device_authorized then
    return jsonb_build_object('success', false, 'message', 'Dispositivo no autorizado para esta licencia');
  end if;

  if v_current_expiry is not null and v_current_expiry > (now() + interval '7 days') then
    return jsonb_build_object(
      'success', false,
      'message', 'La licencia aún no está cerca de vencer. Podrás renovar cuando falten menos de 7 días.',
      'current_expiry', v_current_expiry
    );
  end if;

  if v_current_expiry is null or v_current_expiry < now() then
    v_new_expiry := now() + interval '3 months';
  else
    v_new_expiry := v_current_expiry + interval '3 months';
  end if;

  update public.licenses
  set expires_at = v_new_expiry,
      status = 'active'
  where id = v_license_id;

  insert into public.license_events (license_key, event_type, metadata)
  values (
    license_key_param,
    'LICENSE_RENEWED_FREE',
    jsonb_build_object(
      'fingerprint', device_fingerprint_param,
      'previous_expiry', v_current_expiry,
      'new_expiry', v_new_expiry,
      'promo', '3_MONTHS_FREE',
      'renewed_at', now()
    )
  );

  insert into public.license_usage_logs (license_id, device_fingerprint, action, metadata)
  values (
    v_license_id,
    device_fingerprint_param,
    'RENEW_FREE',
    jsonb_build_object('promo', '3_MONTHS_FREE', 'new_expiry', v_new_expiry)
  );

  return jsonb_build_object(
    'success', true,
    'message', '¡Renovación exitosa! Tu licencia se ha extendido por 3 meses más.',
    'new_expiry', v_new_expiry,
    'newExpiry', v_new_expiry,
    'previous_expiry', v_current_expiry,
    'status', 'active'
  );
exception when others then
  return jsonb_build_object('success', false, 'message', 'Error al procesar la renovación');
end;
$$;

grant execute on function public.renew_license_free(text, text) to anon, authenticated;

-- ============================================================
-- 8) Terminos legales: idempotencia real y sin revelar SQLERRM
-- ============================================================
create or replace function public.register_term_acceptance(
  p_license_key text,
  p_term_id uuid,
  p_device_fingerprint text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_license_id uuid;
  v_device_valid boolean;
begin
  select l.id into v_license_id
  from public.licenses l
  where l.license_key = p_license_key
    and l.status = 'active'
    and (l.expires_at is null or l.expires_at >= now());

  if v_license_id is null then
    return jsonb_build_object('success', false, 'error', 'LICENSE_NOT_FOUND_OR_INACTIVE');
  end if;

  select exists (
    select 1
    from public.license_devices d
    where d.license_id = v_license_id
      and d.device_fingerprint = p_device_fingerprint
      and d.is_active = true
  ) into v_device_valid;

  if not v_device_valid then
    return jsonb_build_object('success', false, 'error', 'DEVICE_NOT_AUTHORIZED');
  end if;

  insert into public.legal_acceptances (
    license_id,
    term_id,
    device_fingerprint,
    accepted_at,
    metadata
  ) values (
    v_license_id,
    p_term_id,
    p_device_fingerprint,
    now(),
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (license_id, term_id) do nothing;

  return jsonb_build_object('success', true);
exception when foreign_key_violation then
  return jsonb_build_object('success', false, 'error', 'TERM_NOT_FOUND');
when others then
  return jsonb_build_object('success', false, 'error', 'TERM_ACCEPTANCE_FAILED');
end;
$$;

-- ============================================================
-- 9) Perfil negocio: version legacy endurecida + version segura nueva
-- ============================================================
create or replace function public.save_business_profile_anon(
  license_key_param text,
  profile_data jsonb
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_license_id uuid;
begin
  select id into v_license_id
  from public.licenses
  where license_key = license_key_param
    and status = 'active'
    and (expires_at is null or expires_at >= now());

  if v_license_id is null then
    return json_build_object('success', false, 'error', 'Licencia inválida o inactiva');
  end if;

  insert into public.business_profiles (
    license_id,
    business_name,
    phone_number,
    address,
    logo_url,
    business_type,
    updated_at
  ) values (
    v_license_id,
    nullif(trim(profile_data->>'name'), ''),
    nullif(trim(profile_data->>'phone'), ''),
    nullif(trim(profile_data->>'address'), ''),
    nullif(trim(profile_data->>'logo_url'), ''),
    array(select jsonb_array_elements_text(coalesce(profile_data->'business_type', '[]'::jsonb)))::public.business_category[],
    now()
  )
  on conflict (license_id) do update set
    business_name = excluded.business_name,
    phone_number = excluded.phone_number,
    address = excluded.address,
    logo_url = excluded.logo_url,
    business_type = excluded.business_type,
    updated_at = now();

  return json_build_object('success', true);
exception when not_null_violation then
  return json_build_object('success', false, 'error', 'Datos de negocio incompletos');
when others then
  return json_build_object('success', false, 'error', 'No se pudo guardar el perfil del negocio');
end;
$$;

create or replace function public.save_business_profile_secure(
  license_key_param text,
  device_fingerprint_param text,
  security_token_param text,
  profile_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_license_id uuid;
  v_device_valid boolean;
begin
  select id into v_license_id
  from public.licenses
  where license_key = license_key_param
    and status = 'active'
    and (expires_at is null or expires_at >= now());

  if v_license_id is null then
    return jsonb_build_object('success', false, 'error', 'LICENSE_INVALID_OR_INACTIVE');
  end if;

  select exists (
    select 1
    from public.license_devices d
    where d.license_id = v_license_id
      and d.device_fingerprint = device_fingerprint_param
      and d.is_active = true
      and security_token_param is not null
      and security_token_param <> ''
      and (d.security_token = security_token_param or d.previous_security_token = security_token_param)
  ) into v_device_valid;

  if not v_device_valid then
    return jsonb_build_object('success', false, 'error', 'DEVICE_TOKEN_INVALID');
  end if;

  insert into public.business_profiles (
    license_id,
    business_name,
    phone_number,
    address,
    logo_url,
    business_type,
    updated_at
  ) values (
    v_license_id,
    nullif(trim(profile_data->>'name'), ''),
    nullif(trim(profile_data->>'phone'), ''),
    nullif(trim(profile_data->>'address'), ''),
    nullif(trim(profile_data->>'logo_url'), ''),
    array(select jsonb_array_elements_text(coalesce(profile_data->'business_type', '[]'::jsonb)))::public.business_category[],
    now()
  )
  on conflict (license_id) do update set
    business_name = excluded.business_name,
    phone_number = excluded.phone_number,
    address = excluded.address,
    logo_url = excluded.logo_url,
    business_type = excluded.business_type,
    updated_at = now();

  return jsonb_build_object('success', true);
exception when not_null_violation then
  return jsonb_build_object('success', false, 'error', 'BUSINESS_PROFILE_INCOMPLETE');
when others then
  return jsonb_build_object('success', false, 'error', 'BUSINESS_PROFILE_SAVE_FAILED');
end;
$$;

grant execute on function public.save_business_profile_secure(text, text, text, jsonb) to anon, authenticated;
;
