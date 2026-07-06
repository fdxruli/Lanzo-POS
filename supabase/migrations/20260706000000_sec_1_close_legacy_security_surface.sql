-- FASE SEC.1 — Cierre inmediato de superficie heredada y hardening básico de exposición Supabase
--
-- Objetivo:
-- - Cerrar RPC heredada insegura save_business_profile_anon.
-- - Evitar ejecución directa de helpers private.* por roles cliente.
-- - Eliminar vista smoke/test expuesta.
-- - Reducir exposición de storage.images.
-- - Revocar grants directos sobre tablas/sequences públicas.
-- - Preservar EXECUTE de RPCs públicas necesarias para el frontend.
--
-- Nota importante:
-- Postgres concede EXECUTE de funciones nuevas a PUBLIC por defecto. Para que
-- has_function_privilege('anon', ..., 'EXECUTE') quede en false no basta revocar
-- anon/authenticated: también hay que revocar PUBLIC.

-- SEC.1.1 Deprecate unsafe business profile RPC
create or replace function public.save_business_profile_anon(
  license_key_param text,
  profile_data jsonb
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
begin
  return json_build_object(
    'success', false,
    'error', 'RPC_DEPRECATED_USE_SAVE_BUSINESS_PROFILE_SECURE',
    'message', 'Esta operación requiere validación segura del dispositivo.'
  );
end;
$$;

revoke execute on function public.save_business_profile_anon(text, jsonb)
from public, anon, authenticated;

-- SEC.1.2 Revoke private schema function execution
--
-- Realtime usa políticas sobre realtime.messages. Antes de revocar EXECUTE en
-- private.*, se dejan wrappers no expuestos por PostgREST en esquema realtime para
-- conservar el flujo de Broadcast sin permitir llamadas directas a private.*.
create or replace function realtime.lanzo_can_access_license_realtime_topic(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_access_license_realtime_topic(p_topic);
$$;

create or replace function realtime.lanzo_can_access_pos_realtime_topic(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_access_pos_realtime_topic(p_topic);
$$;

revoke execute on function realtime.lanzo_can_access_license_realtime_topic(text)
from public, anon, authenticated;
revoke execute on function realtime.lanzo_can_access_pos_realtime_topic(text)
from public, anon, authenticated;

grant execute on function realtime.lanzo_can_access_license_realtime_topic(text)
to anon, authenticated;
grant execute on function realtime.lanzo_can_access_pos_realtime_topic(text)
to anon, authenticated;

drop policy if exists "Lanzo private license broadcast receive" on realtime.messages;
create policy "Lanzo private license broadcast receive"
on realtime.messages
for select
to anon, authenticated
using (
  extension = 'broadcast'
  and realtime.lanzo_can_access_license_realtime_topic((select realtime.topic()))
);

drop policy if exists "Lanzo private POS broadcast receive" on realtime.messages;
create policy "Lanzo private POS broadcast receive"
on realtime.messages
for select
to anon, authenticated
using (
  extension = 'broadcast'
  and realtime.lanzo_can_access_pos_realtime_topic((select realtime.topic()))
);

revoke all on schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;

alter default privileges in schema private
revoke execute on functions from public, anon, authenticated;

-- SEC.1.3 Drop smoke/test view
drop view if exists public.pos_fase6f_smoke_view;

-- SEC.1.4 Harden storage policies
--
-- Se elimina la policy SELECT global bucket_id='images' y se conserva lectura
-- pública solo para la ruta usada por el frontend: public_uploads/*.
drop policy if exists "Permitir ver imágenes públicamente" on storage.objects;
drop policy if exists "Permitir ver imágenes públicas en public_uploads" on storage.objects;

create policy "Permitir ver imágenes públicas en public_uploads"
on storage.objects
for select
to public
using (
  bucket_id = 'images'
  and name like 'public_uploads/%'
);

drop policy if exists "Permitir subir imágenes anónimamente a public_uploads" on storage.objects;

create policy "Permitir subir imágenes anónimamente a public_uploads"
on storage.objects
for insert
to public
with check (
  bucket_id = 'images'
  and name like 'public_uploads/%'
  and lower(name) ~ '\.(png|jpg|jpeg|webp|gif)$'
  and (
    coalesce(lower(metadata->>'mimetype'), '') = ''
    or lower(metadata->>'mimetype') in (
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif'
    )
  )
);

-- SEC.1.5 Revoke direct table/sequence grants
--
-- La arquitectura cloud usa RPCs SECURITY DEFINER como gateway. Las tablas
-- sensibles permanecen protegidas por RLS y ya no deben tener privilegios
-- directos heredados para roles cliente.
revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;

alter default privileges in schema public
revoke all on tables from public, anon, authenticated;

alter default privileges in schema public
revoke all on sequences from public, anon, authenticated;

-- Refuerzo: funciones administrativas y variantes *_unlimited deben seguir
-- cerradas a cliente aunque existan grants heredados o se creen overloads.
do $$
declare
  target_fn record;
begin
  for target_fn in
    select
      n.nspname as schema_name,
      p.proname as function_name,
      pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (
        p.proname = any(array[
          'admin_create_license',
          'admin_update_license',
          'admin_delete_license',
          'admin_get_global_logs',
          'admin_get_license_details',
          'admin_get_plans',
          'admin_kick_device',
          'admin_upsert_plan',
          'get_admin_dashboard_data'
        ])
        or p.proname like '%\_unlimited' escape '\'
      )
  loop
    execute format(
      'revoke execute on function %I.%I(%s) from public, anon, authenticated',
      target_fn.schema_name,
      target_fn.function_name,
      target_fn.args
    );
  end loop;
end $$;

-- SEC.1.6 Preserve required public RPC execute grants
--
-- No se revoca masivamente EXECUTE sobre public.* en SEC.1. Solo se asegura
-- que las RPCs usadas por frontend sigan ejecutables por clientes. La validación
-- real queda dentro de cada RPC SECURITY DEFINER.
do $$
declare
  required_functions text[] := array[
    -- licencia / staff / perfil
    'activate_license_on_device',
    'verify_device_license_unified',
    'staff_login_on_device',
    'verify_staff_session',
    'staff_logout_session',
    'get_license_devices_anon',
    'release_device_anon',
    'deactivate_device_anon',
    'save_business_profile_secure',
    'get_business_profile_anon',
    'get_active_legal_terms',
    'register_term_acceptance',
    'create_free_trial_license',
    'renew_license_free',

    -- IA
    'get_ai_agent_usage',

    -- clientes / productos / catálogo
    'pos_upsert_customer',
    'pos_delete_customer',
    'pos_pull_customers_snapshot',
    'pos_pull_customer_changes',
    'pos_upsert_category',
    'pos_delete_category',
    'pos_upsert_product',
    'pos_delete_product',
    'pos_toggle_product_status',
    'pos_upsert_product_batch',
    'pos_delete_product_batch',
    'pos_create_product_batch_from_parent_stock',
    'pos_adjust_product_stock_without_batch_zero',
    'pos_pull_product_catalog_snapshot',
    'pos_pull_product_catalog_changes',

    -- caja
    'pos_open_cash_session',
    'pos_close_cash_session',
    'pos_register_cash_movement',
    'pos_adjust_initial_cash_fund',
    'pos_get_current_cash_session',
    'pos_admin_list_cash_sessions',
    'pos_admin_get_cash_session_detail',
    'pos_get_cash_report',
    'pos_pull_cash_snapshot',
    'pos_pull_cash_changes',

    -- ventas / reportes
    'pos_upsert_sale_shadow',
    'pos_create_cloud_sale_cashier',
    'pos_create_cloud_sale_cashier_inventory',
    'pos_create_cloud_sale_credit',
    'pos_cancel_cloud_sale',
    'pos_preview_cloud_sale_cancellation',
    'pos_validate_cloud_sale_integrity',
    'pos_validate_sales_consistency',
    'pos_get_sale',
    'pos_pull_sales_snapshot',
    'pos_pull_sales_changes',
    'pos_get_reports_overview',
    'pos_get_reports_credit_overview',
    'pos_get_report_timeseries',
    'pos_export_report_data',
    'pos_export_sales_shadow',
    'pos_export_sales_final',
    'pos_get_sales_final_overview',
    'pos_get_sales_final_timeseries',
    'pos_get_sales_final_history',
    'pos_get_sales_profit_report',
    'pos_get_sales_audit_report',

    -- restaurante
    'pos_upsert_restaurant_order',
    'pos_get_restaurant_orders',
    'pos_get_restaurant_order_by_local_order',
    'pos_get_restaurant_orders_history',
    'pos_update_restaurant_order_status',
    'pos_update_restaurant_order_item_status',
    'pos_close_restaurant_order_after_checkout',
    'pos_archive_restaurant_order',
    'pos_get_preparation_stations',
    'pos_upsert_preparation_station',
    'pos_toggle_preparation_station',

    -- crédito
    'pos_record_customer_payment',
    'pos_get_customer_credit_summary',
    'pos_get_customer_credit_report',
    'pos_pull_customer_credit_snapshot',
    'pos_pull_customer_credit_changes',

    -- migraciones / sync
    'pos_migrate_local_customers',
    'pos_migrate_local_product_catalog',
    'pos_migrate_local_customer_credit',
    'pos_pull_sync_events',

    -- caducidades / inventario avanzado
    'pos_get_expiring_batches_report',
    'pos_get_expiration_fefo_recommendations',
    'pos_get_expiration_waste_history',
    'pos_register_expiration_waste'
  ];
  target_fn record;
begin
  for target_fn in
    select
      n.nspname as schema_name,
      p.proname as function_name,
      pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(required_functions)
  loop
    execute format(
      'grant execute on function %I.%I(%s) to anon, authenticated',
      target_fn.schema_name,
      target_fn.function_name,
      target_fn.args
    );
  end loop;
end $$;
