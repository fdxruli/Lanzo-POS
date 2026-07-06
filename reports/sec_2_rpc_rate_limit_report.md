# FASE SEC.2 — Rate limit server-side para RPCs críticas

Fecha de preparación: 2026-07-05  
Repositorio: `fdxruli/Lanzo-POS`  
Proyecto Supabase auditado: `odlrhijtfyavryeqivaa`  
Migración: `supabase/migrations/20260707000000_sec_2_rpc_rate_limits.sql`

## 1. Infraestructura encontrada

SEC.2 reutiliza la infraestructura previa de rate limit creada en `supabase/migrations/20260628142730_fase_6h_7_3_pos_rpc_rate_limits.sql`.

Infraestructura encontrada en Supabase:

- Tabla: `public.pos_rpc_rate_limits`.
- Helpers existentes:
  - `public.check_pos_rpc_rate_limit(text,text,text,text,integer,integer)`
  - `public.enforce_pos_rpc_rate_limit(text,text,text,text,integer,integer,integer)`
  - `public.build_pos_rpc_rate_limited_response(jsonb)`
  - `public.cleanup_pos_rpc_rate_limits(interval)`
  - `public.validate_pos_rpc_rate_limit_context(text,text,text,text)`
- Índices existentes:
  - `pos_rpc_rate_limits_pkey`
  - `pos_rpc_rate_limits_unique_window`
  - `idx_pos_rpc_rate_limits_cleanup`
  - `idx_pos_rpc_rate_limits_license_rpc`
- SEC.2 agrega columnas no sensibles:
  - `scope`
  - `blocked_until`
  - `last_limited_at`
  - `metadata`
- SEC.2 agrega índices:
  - `idx_pos_rpc_rate_limits_blocked`
  - `idx_pos_rpc_rate_limits_scope_cleanup`
  - `idx_pos_rpc_rate_limits_scope_rpc_window`

Retención/limpieza:

- `cleanup_pos_rpc_rate_limits(interval)` queda preservada, pero se ajusta para no borrar bloqueos todavía vigentes.
- No se agrega cron obligatorio en esta fase.
- La tabla sigue con RLS y sin grants directos para `PUBLIC`, `anon` o `authenticated`.

Secretos:

- No se agregan columnas para `security_token`, `staff_session_token`, password ni admin secret.
- `staff_session_token` se deriva a SHA-256 cuando aplica.
- `staff_login_on_device` usa `username_hash` derivado con SHA-256 para evitar guardar el username plano en metadata/scope.
- `activate_license_on_device` usa sentinel de activación por dispositivo para cubrir abuso con licencias inválidas o aleatorias antes de validar licencia.

Storage:

- Uploads de `storage.objects` quedan documentados para SEC.3/SEC.4.
- SEC.2 no implementa validación avanzada de uploads ni cambia policies de storage.

IA / Edge Function:

- El frontend invoca la Edge Function `lanzo-ai-agent` para `usage` y generación.
- En el repositorio no se encontró carpeta visible de Edge Functions para auditar rate limit interno de `lanzo-ai-agent`.
- SEC.2 agrega rate limit a `get_ai_agent_usage` si existe como RPC pública.
- La generación IA conserva su límite funcional de usos por periodo/licencia; SEC.2 solo agrega defensa anti-abuso de endpoint/usage cuando la RPC está presente.

## 2. Diseño aplicado

SEC.2 agrega `public.enforce_pos_rpc_rate_limit_v2(...)` con:

- Scope explícito por categoría.
- Bloqueo temporal con `blocked_until`.
- Respuestas controladas con códigos como:
  - `RPC_RATE_LIMITED`
  - `AUTH_RATE_LIMITED`
  - `STAFF_LOGIN_RATE_LIMITED`
  - `LICENSE_ACTIVATION_RATE_LIMITED`
  - `REPORT_RATE_LIMITED`
  - `AI_RATE_LIMITED`
- Metadata defensiva no sensible.
- Fallback cerrado con sentinels `__missing_license__` y `__missing_device__` para que contexto incompleto no omita el rate limit.

Patrón de wrappers:

1. Si `public.<rpc>_unlimited` no existe, se renombra la RPC actual a `public.<rpc>_unlimited`.
2. Se crea/reemplaza `public.<rpc>` con la misma firma, retorno y `SECURITY DEFINER`.
3. El wrapper aplica rate limit.
4. Si excede límite, devuelve JSON/JSONB controlado sin stack trace.
5. Si está permitido, delega a `public.<rpc>_unlimited(...)`.
6. Se revoca ejecución directa de `*_unlimited` a `PUBLIC`, `anon` y `authenticated`.
7. Se concede `EXECUTE` al wrapper público para `anon` y `authenticated`.

## 3. Matriz RPC

| RPC | Categoría | Límite | Scope | Validación contexto | Idempotencia | Rate limit antes | Estado SEC.2 |
|---|---:|---:|---|---|---|---:|---|
| `activate_license_on_device` | AUTH_LICENSE | 10 / 10 min; bloqueo 15 min | device_fingerprint + rpc_name (sentinel de activación para cubrir licencias inválidas) | Sí, validación propia existente | No aplica | No | Agregado en SEC.2 |
| `verify_device_license_unified` | AUTH_LICENSE | 60 / 10 min; bloqueo 5 min | license_key + device_fingerprint + rpc_name + scope | Sí, validación propia existente | No aplica | No | Agregado en SEC.2 |
| `create_free_trial_license` | AUTH_LICENSE | 3 / 1440 min; bloqueo 1440 min | device_fingerprint + rpc_name | Sí, validación propia existente | No aplica | No | Agregado en SEC.2 |
| `renew_license_free` | AUTH_LICENSE | 5 / 60 min; bloqueo 60 min | license_key + device_fingerprint + rpc_name + scope | Sí, validación propia existente | No aplica | No | Agregado en SEC.2 |
| `staff_login_on_device` | STAFF_AUTH | 10 / 10 min; bloqueo 15 min | license_key + device_fingerprint + username_hash + rpc_name | Sí, validación propia existente | No aplica | No | Agregado en SEC.2 |
| `verify_staff_session` | STAFF_AUTH | 60 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, validación propia existente | No aplica | No | Agregado en SEC.2 |
| `staff_logout_session` | STAFF_AUTH | 30 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, validación propia existente | No aplica | No | Agregado en SEC.2 |
| `save_business_profile_secure` | PROFILE | 30 / 10 min; bloqueo 10 min | license_key + device_fingerprint + rpc_name + scope | Sí, validación propia existente | No aplica | No | Agregado en SEC.2 |
| `get_business_profile_anon` | PROFILE | 60 / 10 min; bloqueo 5 min | license_key + sentinel profile_read + rpc_name | Sí, validación propia existente | No aplica | No | Agregado en SEC.2 |
| `register_term_acceptance` | PROFILE | 20 / 10 min; bloqueo 10 min | license_key + device_fingerprint + rpc_name + scope | Sí, validación propia existente | No aplica | No | Agregado en SEC.2 |
| `get_license_devices_anon` | DEVICE_ADMIN | 30 / 10 min; bloqueo 10 min | license_key + device_fingerprint + rpc_name + scope | Sí, validación propia existente | No aplica | No | Agregado en SEC.2 |
| `release_device_anon` | DEVICE_ADMIN | 10 / 10 min; bloqueo 10 min | license_key + device_fingerprint + rpc_name + scope | Sí, validación propia existente | No aplica | No | Agregado en SEC.2 |
| `deactivate_device_anon` | DEVICE_ADMIN | 10 / 10 min; bloqueo 10 min | license_key + device_fingerprint + rpc_name + scope | Sí, validación propia existente | No aplica | No | Agregado en SEC.2 |
| `pos_upsert_customer` | POS_WRITE | 120 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | Sí, p_idempotency_key cuando existe | No | Agregado en SEC.2 |
| `pos_delete_customer` | POS_WRITE | 120 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | Sí, p_idempotency_key cuando existe | No | Agregado en SEC.2 |
| `pos_upsert_category` | POS_WRITE | 120 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | Sí, p_idempotency_key cuando existe | No | Agregado en SEC.2 |
| `pos_delete_category` | POS_WRITE | 120 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | Sí, p_idempotency_key cuando existe | No | Agregado en SEC.2 |
| `pos_upsert_product` | POS_WRITE | 120 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | Sí, p_idempotency_key cuando existe | No | Agregado en SEC.2 |
| `pos_delete_product` | POS_WRITE | 120 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | Sí, p_idempotency_key cuando existe | No | Agregado en SEC.2 |
| `pos_toggle_product_status` | POS_WRITE | 120 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | Sí, p_idempotency_key cuando existe | No | Agregado en SEC.2 |
| `pos_upsert_product_batch` | POS_WRITE | 120 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | Sí, p_idempotency_key cuando existe | No | Agregado en SEC.2 |
| `pos_delete_product_batch` | POS_WRITE | 120 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | Sí, p_idempotency_key cuando existe | No | Agregado en SEC.2 |
| `pos_create_product_batch_from_parent_stock` | POS_WRITE | 120 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | Sí, p_idempotency_key cuando existe | No | Agregado en SEC.2 |
| `pos_adjust_product_stock_without_batch_zero` | POS_WRITE | 120 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | Sí, p_idempotency_key cuando existe | No | Agregado en SEC.2 |
| `pos_upsert_restaurant_order` | POS_WRITE | 120 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | Sí, p_idempotency_key cuando existe | No | Agregado en SEC.2 |
| `pos_update_restaurant_order_status` | POS_WRITE | 120 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | Sí, p_idempotency_key cuando existe | No | Agregado en SEC.2 |
| `pos_update_restaurant_order_item_status` | POS_WRITE | 120 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | Sí, p_idempotency_key cuando existe | No | Agregado en SEC.2 |
| `pos_archive_restaurant_order` | POS_WRITE | 120 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | Sí, p_idempotency_key cuando existe | No | Agregado en SEC.2 |
| `pos_register_expiration_waste` | POS_WRITE | 120 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | Sí, p_idempotency_key cuando existe | No | Agregado en SEC.2 |
| `pos_upsert_preparation_station` | POS_WRITE | 120 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | Sí, p_idempotency_key cuando existe | No | Agregado en SEC.2 |
| `pos_toggle_preparation_station` | POS_WRITE | 120 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | Sí, p_idempotency_key cuando existe | No | Agregado en SEC.2 |
| `pos_open_cash_session` | POS_WRITE | 60 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | Sí, p_idempotency_key cuando existe | No | Agregado en SEC.2 |
| `pos_close_cash_session` | POS_WRITE | 60 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | Sí, p_idempotency_key cuando existe | No | Agregado en SEC.2 |
| `pos_register_cash_movement` | POS_WRITE | 60 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | Sí, p_idempotency_key cuando existe | No | Agregado en SEC.2 |
| `pos_adjust_initial_cash_fund` | POS_WRITE | 60 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | Sí, p_idempotency_key cuando existe | No | Agregado en SEC.2 |
| `pos_upsert_sale_shadow` | POS_WRITE | 60 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | Sí, p_idempotency_key cuando existe | No | Agregado en SEC.2 |
| `pos_create_cloud_sale_cashier` | POS_WRITE | 60 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | Sí, p_idempotency_key cuando existe | No | Agregado en SEC.2 |
| `pos_create_cloud_sale_cashier_inventory` | POS_WRITE | 60 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | Sí, p_idempotency_key cuando existe | No | Agregado en SEC.2 |
| `pos_create_cloud_sale_credit` | POS_WRITE | 60 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | Sí, p_idempotency_key cuando existe | No | Agregado en SEC.2 |
| `pos_cancel_cloud_sale` | POS_WRITE | 60 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | Sí, p_idempotency_key cuando existe | No | Agregado en SEC.2 |
| `pos_close_restaurant_order_after_checkout` | POS_WRITE | 60 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | Sí, p_idempotency_key cuando existe | No | Agregado en SEC.2 |
| `pos_record_customer_payment` | POS_WRITE | 60 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | Sí, p_idempotency_key cuando existe | No | Agregado en SEC.2 |
| `pos_get_reports_overview` | POS_READ_HEAVY | 60 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | No aplica | Sí | Re-envuelto con SEC.2/v2 |
| `pos_get_reports_credit_overview` | POS_READ_HEAVY | 60 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | No aplica | Sí | Re-envuelto con SEC.2/v2 |
| `pos_get_report_timeseries` | POS_READ_HEAVY | 60 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | No aplica | Sí | Re-envuelto con SEC.2/v2 |
| `pos_get_sales_final_overview` | POS_READ_HEAVY | 60 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | No aplica | Sí | Re-envuelto con SEC.2/v2 |
| `pos_get_sales_final_timeseries` | POS_READ_HEAVY | 60 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | No aplica | Sí | Re-envuelto con SEC.2/v2 |
| `pos_get_cash_report` | POS_READ_HEAVY | 60 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | No aplica | Sí | Re-envuelto con SEC.2/v2 |
| `pos_get_product_catalog_report` | POS_READ_HEAVY | 60 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | No aplica | Sí | Re-envuelto con SEC.2/v2 |
| `pos_get_expiring_batches_report` | POS_READ_HEAVY | 60 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | No aplica | No | Agregado en SEC.2 |
| `pos_get_expiration_fefo_recommendations` | POS_READ_HEAVY | 60 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | No aplica | No | Agregado en SEC.2 |
| `pos_get_expiration_waste_history` | POS_READ_HEAVY | 60 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | No aplica | No | Agregado en SEC.2 |
| `pos_preview_cloud_sale_cancellation` | POS_READ_HEAVY | 60 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | No aplica | No | Agregado en SEC.2 |
| `pos_validate_cloud_sale_integrity` | POS_READ_HEAVY | 60 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | No aplica | No | Agregado en SEC.2 |
| `pos_get_sales_final_history` | POS_READ_HEAVY | 30 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | No aplica | Sí | Re-envuelto con SEC.2/v2 |
| `pos_get_sales_profit_report` | POS_READ_HEAVY | 30 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | No aplica | Sí | Re-envuelto con SEC.2/v2 |
| `pos_get_sales_audit_report` | POS_READ_HEAVY | 30 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | No aplica | Sí | Re-envuelto con SEC.2/v2 |
| `pos_get_customer_credit_report` | POS_READ_HEAVY | 30 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | No aplica | Sí | Re-envuelto con SEC.2/v2 |
| `pos_get_restaurant_orders_history` | POS_READ_HEAVY | 30 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | No aplica | No | Agregado en SEC.2 |
| `pos_export_report_data` | REPORT_EXPORT | 10 / 10 min; bloqueo 15 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | No aplica | Sí | Re-envuelto con SEC.2/v2 |
| `pos_export_sales_final` | REPORT_EXPORT | 10 / 10 min; bloqueo 15 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | No aplica | Sí | Re-envuelto con SEC.2/v2 |
| `pos_export_sales_shadow` | REPORT_EXPORT | 10 / 10 min; bloqueo 15 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | No aplica | No | Agregado en SEC.2 |
| `pos_pull_customers_snapshot` | SYNC_PULL | 30 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | No aplica | Sí | Re-envuelto con SEC.2/v2 |
| `pos_pull_product_catalog_snapshot` | SYNC_PULL | 30 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | No aplica | Sí | Re-envuelto con SEC.2/v2 |
| `pos_pull_cash_snapshot` | SYNC_PULL | 30 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | No aplica | Sí | Re-envuelto con SEC.2/v2 |
| `pos_pull_sales_snapshot` | SYNC_PULL | 30 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | No aplica | Sí | Re-envuelto con SEC.2/v2 |
| `pos_pull_customer_credit_snapshot` | SYNC_PULL | 30 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | No aplica | Sí | Re-envuelto con SEC.2/v2 |
| `pos_pull_customer_changes` | SYNC_PULL | 120 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | No aplica | No | Agregado en SEC.2 |
| `pos_pull_product_catalog_changes` | SYNC_PULL | 120 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | No aplica | No | Agregado en SEC.2 |
| `pos_pull_cash_changes` | SYNC_PULL | 120 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | No aplica | No | Agregado en SEC.2 |
| `pos_pull_sales_changes` | SYNC_PULL | 120 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | No aplica | No | Agregado en SEC.2 |
| `pos_pull_customer_credit_changes` | SYNC_PULL | 120 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | No aplica | No | Agregado en SEC.2 |
| `pos_pull_sync_events` | SYNC_PULL | 120 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | No aplica | No | Agregado en SEC.2 |
| `get_ai_agent_usage` | AI_USAGE | 30 / 10 min; bloqueo 5 min | license_key + device_fingerprint + staff_session_hash/null + rpc_name + scope | Sí, contexto RPC existente | No aplica | No | Agregado en SEC.2 |

## 4. Queries de verificación

### Funciones objetivo con rate limit

```sql
select
  n.nspname as schema,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as args,
  case
    when pg_get_functiondef(p.oid) ilike '%enforce_pos_rpc_rate_limit_v2%'
      or pg_get_functiondef(p.oid) ilike '%enforce_pos_rpc_rate_limit%'
      or pg_get_functiondef(p.oid) ilike '%check_pos_rpc_rate_limit%'
    then true
    else false
  end as has_rate_limit
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = any(array[
    'activate_license_on_device',
    'verify_device_license_unified',
    'staff_login_on_device',
    'verify_staff_session',
    'create_free_trial_license',
    'renew_license_free',
    'save_business_profile_secure',
    'get_license_devices_anon',
    'release_device_anon',
    'pos_create_cloud_sale_cashier',
    'pos_open_cash_session',
    'pos_register_cash_movement',
    'pos_get_reports_overview',
    'pos_export_sales_final',
    'get_ai_agent_usage'
  ])
order by p.proname;
```

### Rate limit table/indexes

```sql
select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'pos_rpc_rate_limits'
order by indexname;
```

### No secretos planos

```sql
select
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'pos_rpc_rate_limits'
order by ordinal_position;
```

Resultado esperado:

- No deben existir columnas `security_token`, `staff_session_token`, `password`, `admin_secret` ni equivalentes planos.
- Sí deben existir `staff_session_hash`, `scope`, `blocked_until`, `last_limited_at`, `metadata`.

### Wrappers cerrados

```sql
select
  n.nspname as schema,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as args,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname like '%\_unlimited' escape '\'
order by p.proname;
```

Resultado esperado:

- `anon_can_execute = false`
- `authenticated_can_execute = false`

### SEC.1 sigue cerrado

```sql
select
  n.nspname as schema,
  p.proname as function_name,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private')
  and (
    p.proname = 'save_business_profile_anon'
    or n.nspname = 'private'
    or p.proname like '%\_unlimited' escape '\'
  )
order by n.nspname, p.proname;
```

Resultado esperado:

- `save_business_profile_anon` sigue sin `EXECUTE` para clientes.
- `private.*` sigue cerrado.
- `*_unlimited` sigue cerrado.

## 5. Pruebas manuales

### Licencia/auth

- [ ] Activar licencia válida en dispositivo nuevo.
- [ ] Intentar licencia inválida repetidamente hasta recibir `LICENSE_ACTIVATION_RATE_LIMITED`.
- [ ] Revalidar licencia normal con `verify_device_license_unified` más de una vez al abrir la app.
- [ ] Confirmar que revalidación normal no se bloquea.
- [ ] Confirmar que el mensaje visible no muestra stack trace ni SQL.

### Staff

- [ ] Login staff correcto.
- [ ] Login staff incorrecto repetidamente hasta recibir `STAFF_LOGIN_RATE_LIMITED`.
- [ ] Verificar sesión staff normal con `verify_staff_session`.
- [ ] Cerrar sesión staff con `staff_logout_session`.
- [ ] Confirmar que no se guarda password ni staff token plano en `pos_rpc_rate_limits`.

### Perfil/dispositivos

- [ ] Guardar perfil con `save_business_profile_secure`.
- [ ] Listar dispositivos con `get_license_devices_anon`.
- [ ] Liberar dispositivo con `release_device_anon`.
- [ ] Desactivar dispositivo con `deactivate_device_anon`.
- [ ] Confirmar que `save_business_profile_anon` sigue cerrado.

### POS cloud

- [ ] Crear cliente cloud.
- [ ] Editar producto/categoría/lote cloud.
- [ ] Crear venta cloud.
- [ ] Crear venta cloud con retry legítimo usando la misma idempotency key.
- [ ] Confirmar que idempotencia sigue evitando duplicados.
- [ ] Abrir caja.
- [ ] Registrar movimiento de caja.
- [ ] Cerrar caja.
- [ ] Actualizar pedido restaurante.
- [ ] Cerrar pedido restaurante después de checkout.

### Reportes/exportaciones/sync

- [ ] Ejecutar dashboard/reportes normales.
- [ ] Ejecutar exportación normal.
- [ ] Ejecutar snapshot inicial en dispositivo PRO.
- [ ] Ejecutar pull incremental después de cambios.
- [ ] Confirmar que bootstrap/reconexión móvil no queda bloqueado.
- [ ] Repetir exportación hasta recibir `REPORT_RATE_LIMITED`.

### IA

- [ ] Consultar uso IA con `get_ai_agent_usage` si la RPC existe.
- [ ] Generar análisis IA normal desde Edge Function.
- [ ] Confirmar que el cupo funcional IA por periodo sigue intacto.
- [ ] Documentar en SEC.3/SEC.4 si `lanzo-ai-agent` necesita rate limit interno adicional dentro de la Edge Function.

## 6. Restricciones verificadas por diseño

- No cambia comportamiento FREE/PRO.
- No rediseña autenticación.
- No cambia contratos de frontend salvo códigos controlados de rate limit.
- No reabre `save_business_profile_anon`.
- No concede `private.*` a clientes.
- No elimina idempotencia.
- No guarda tokens planos.
- No toca precios, descuentos, split bill, inventario ni restaurante salvo wrappers de RPC.
- No modifica storage upload; queda para SEC.3/SEC.4.
- No aplica DDL directamente en producción desde este PR; la migración queda versionada para despliegue controlado.

## 7. Checklist de aceptación

- [ ] Auth/licencia/staff tienen rate limit server-side.
- [ ] POS cloud escrituras críticas tienen rate limit server-side o notice si alguna RPC no existe en el ambiente.
- [ ] Reportes/exportaciones pesadas tienen rate limit.
- [ ] Pull/snapshot cloud tienen límites razonables.
- [ ] No hay secretos planos en columnas nuevas.
- [ ] Idempotencia sigue funcionando.
- [ ] Permisos staff siguen funcionando.
- [ ] `private.*` sigue cerrado a cliente.
- [ ] `save_business_profile_anon` sigue cerrado.
- [ ] Admin RPCs y variantes `*_unlimited` siguen cerradas.
- [ ] Frontend compila sin cambios funcionales.
- [ ] Venta/caja/restaurante/productos/clientes/reportes/licencia siguen sin regresión.
