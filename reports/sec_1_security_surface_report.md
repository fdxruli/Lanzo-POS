# FASE SEC.1 — Cierre de superficie heredada Supabase

Fecha objetivo de migración: `2026-07-06`

Branch: `fase-sec-1-close-legacy-security-surface`

Migración propuesta: `supabase/migrations/20260706000000_sec_1_close_legacy_security_surface.sql`

> Este reporte documenta la evidencia previa observada en el proyecto Supabase `odlrhijtfyavryeqivaa`, los cambios incluidos en la migración y las queries de verificación que deben ejecutarse después de aplicar la migración.

## Alcance

SEC.1 cierra superficie heredada sin rediseñar autenticación ni cambiar flujos de ventas, caja, restaurante, inventario, licencias, FREE/PRO o IA.

Cambios incluidos:

- Depreca y cierra `public.save_business_profile_anon(text,jsonb)`.
- Mantiene `public.save_business_profile_secure(...)` como única RPC activa para guardado seguro de perfil.
- Revoca ejecución directa de funciones `private.*` para `PUBLIC`, `anon` y `authenticated`.
- Mantiene políticas Realtime mediante wrappers en esquema `realtime`, para no depender de ejecución directa de `private.*` desde roles cliente.
- Elimina `public.pos_fase6f_smoke_view`.
- Sustituye policy pública global de lectura del bucket `images` por policy limitada a `public_uploads/%`.
- Conserva upload anónimo solo a `public_uploads/%` con extensiones permitidas y MIME de imagen cuando esté disponible.
- Revoca grants directos sobre tablas/sequences públicas para `PUBLIC`, `anon` y `authenticated`.
- Reafirma `EXECUTE` de RPCs públicas necesarias para el frontend.
- Reafirma cierre de funciones admin y variantes `*_unlimited`.

## Evidencia observada antes de la migración

| Check | Resultado observado | Estado |
|---|---:|---|
| `save_business_profile_anon` ejecutable por `anon` | `true` | FAIL |
| `save_business_profile_anon` ejecutable por `authenticated` | `true` | FAIL |
| Funciones `private.*` ejecutables por cliente | Múltiples funciones con `anon_execute=true` y `authenticated_execute=true` | FAIL |
| `public.pos_fase6f_smoke_view` | Existe | FAIL |
| Storage `images` policy pública global | `Permitir ver imágenes públicamente` con `qual = bucket_id = 'images'` | FAIL |
| Grants directos sobre tablas públicas | `anon=63`, `authenticated=63` privilegios directos observados | FAIL |
| RPCs públicas frontend necesarias | Ejecutables por `anon/authenticated` | PASS |
| Funciones admin nombradas | Cerradas para `anon/authenticated` | PASS |
| Frontend `saveBusinessProfile` | Usa `save_business_profile_secure` con `license_key_param`, `device_fingerprint_param`, `security_token_param`, `profile_data` | PASS |
| Uso activo frontend de `save_business_profile_anon` | No encontrado | PASS |
| `service_role` en frontend | No encontrado por búsqueda de código | PASS |

## Queries de verificación post-migración

### 1. `save_business_profile_anon` sin execute

```sql
select
  has_function_privilege('anon', 'public.save_business_profile_anon(text,jsonb)', 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', 'public.save_business_profile_anon(text,jsonb)', 'EXECUTE') as authenticated_can_execute;
```

Resultado esperado:

```txt
anon_can_execute = false
authenticated_can_execute = false
```

Estado esperado: `PASS`

### 2. `private.*` sin execute para `anon/authenticated`

```sql
select
  n.nspname as schema,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as args,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'private'
order by p.proname, args;
```

Resultado esperado:

```txt
anon_execute = false
authenticated_execute = false
```

para todas las funciones `private`.

Estado esperado: `PASS`

### 3. Vista smoke/test eliminada

```sql
select to_regclass('public.pos_fase6f_smoke_view') as smoke_view;
```

Resultado esperado:

```txt
smoke_view = null
```

Estado esperado: `PASS`

### 4. Policies de `storage.objects`

```sql
select
  policyname,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
order by policyname;
```

Resultado esperado:

- No debe existir `Permitir ver imágenes públicamente` con `qual = bucket_id = 'images'`.
- Debe existir lectura pública restringida a:

```sql
bucket_id = 'images'
and name like 'public_uploads/%'
```

- Debe existir upload público/anónimo restringido a:

```sql
bucket_id = 'images'
and name like 'public_uploads/%'
and lower(name) ~ '\.(png|jpg|jpeg|webp|gif)$'
```

Estado esperado: `PASS`

### 5. Grants directos restantes a `anon/authenticated`

```sql
select
  table_schema,
  table_name,
  grantee,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;
```

Resultado esperado:

```txt
0 rows
```

Si aparece algún grant residual, marcar `REVIEW` y justificar explícitamente por qué existe.

Estado esperado: `PASS` o `REVIEW` justificado.

### 6. RPCs públicas necesarias siguen con execute

```sql
with required(name) as (
  values
    ('activate_license_on_device'),
    ('verify_device_license_unified'),
    ('staff_login_on_device'),
    ('verify_staff_session'),
    ('staff_logout_session'),
    ('get_license_devices_anon'),
    ('release_device_anon'),
    ('save_business_profile_secure'),
    ('get_business_profile_anon'),
    ('get_active_legal_terms'),
    ('register_term_acceptance'),
    ('create_free_trial_license'),
    ('renew_license_free'),
    ('pos_upsert_customer'),
    ('pos_delete_customer'),
    ('pos_pull_customers_snapshot'),
    ('pos_pull_customer_changes'),
    ('pos_upsert_product'),
    ('pos_delete_product'),
    ('pos_toggle_product_status'),
    ('pos_upsert_product_batch'),
    ('pos_delete_product_batch'),
    ('pos_pull_product_catalog_snapshot'),
    ('pos_pull_product_catalog_changes'),
    ('pos_open_cash_session'),
    ('pos_close_cash_session'),
    ('pos_register_cash_movement'),
    ('pos_adjust_initial_cash_fund'),
    ('pos_get_current_cash_session'),
    ('pos_pull_cash_snapshot'),
    ('pos_pull_cash_changes'),
    ('pos_upsert_sale_shadow'),
    ('pos_create_cloud_sale_cashier'),
    ('pos_create_cloud_sale_cashier_inventory'),
    ('pos_create_cloud_sale_credit'),
    ('pos_cancel_cloud_sale'),
    ('pos_preview_cloud_sale_cancellation'),
    ('pos_validate_cloud_sale_integrity'),
    ('pos_get_sale'),
    ('pos_pull_sales_snapshot'),
    ('pos_pull_sales_changes'),
    ('pos_upsert_restaurant_order'),
    ('pos_get_restaurant_orders'),
    ('pos_get_restaurant_order_by_local_order'),
    ('pos_update_restaurant_order_status'),
    ('pos_update_restaurant_order_item_status'),
    ('pos_close_restaurant_order_after_checkout'),
    ('pos_archive_restaurant_order'),
    ('pos_record_customer_payment'),
    ('pos_get_customer_credit_summary'),
    ('pos_get_customer_credit_report'),
    ('pos_pull_customer_credit_snapshot'),
    ('pos_pull_customer_credit_changes')
)
select
  r.name,
  count(p.oid) as overloads,
  bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')) as anon_execute_any,
  bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')) as authenticated_execute_any
from required r
left join pg_proc p on p.proname = r.name
left join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
where p.oid is null or n.nspname = 'public'
group by r.name
order by r.name;
```

Resultado esperado:

- `overloads >= 1` para cada RPC existente esperada.
- `anon_execute_any = true`.
- `authenticated_execute_any = true`.

Estado esperado: `PASS`

### 7. Funciones admin siguen cerradas

```sql
select p.proname,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = any(array[
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
order by p.proname;
```

Resultado esperado:

```txt
anon_execute = false
authenticated_execute = false
```

Estado esperado: `PASS`

### 8. Variantes `_unlimited` siguen cerradas

```sql
select p.proname,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname like '%\_unlimited' escape '\'
order by p.proname;
```

Resultado esperado:

```txt
anon_execute = false
authenticated_execute = false
```

Estado esperado: `PASS`

### 9. Realtime policies no dependen de ejecución directa `private.*`

```sql
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'realtime'
  and tablename = 'messages'
order by policyname;
```

Resultado esperado:

- Las policies `Lanzo private license broadcast receive` y `Lanzo private POS broadcast receive` deben usar wrappers `realtime.lanzo_can_access_*_realtime_topic(...)`.
- `private.*` debe estar cerrado a cliente por la query del check 2.

Estado esperado: `PASS`

## Pruebas funcionales manuales obligatorias

Ejecutar después de aplicar la migración en ambiente de prueba/staging o en ventana controlada:

1. Activar licencia existente.
2. Revalidar licencia.
3. Guardar perfil de negocio desde frontend.
4. Iniciar sesión staff.
5. Verificar sesión staff al recargar.
6. Crear cliente cloud PRO.
7. Crear/editar producto cloud PRO.
8. Abrir caja cloud.
9. Registrar movimiento de caja.
10. Crear venta cloud cajero.
11. Crear venta restaurante si aplica.
12. Subir imagen de producto/logo.
13. Consultar imágenes públicas ya subidas.
14. Confirmar que Realtime de licencia/POS sigue recibiendo eventos.

## Riesgos cerrados en SEC.1

- Se cierra modificación de perfil por licencia conocida vía RPC heredada.
- Se elimina ejecución directa de helpers `private.*` por roles cliente.
- Se elimina vista smoke/test expuesta en `public`.
- Se reduce enumeración pública del bucket `images` fuera de `public_uploads/%`.
- Se reduce exposición por grants directos de tablas/sequences públicas.
- Se conserva el patrón RPC gateway para operaciones cloud/PRO.

## Riesgos pendientes para fases posteriores

### SEC.2

- Rate limit general por RPC crítica, especialmente activación, login staff, operaciones cloud y uploads.
- Auditoría de intentos fallidos por licencia/dispositivo/IP cuando aplique.
- Revisión de abuso por `license_key` como identificador público.

### SEC.3 / SEC.4

- Validación más fuerte de uploads: tamaño máximo, MIME real, procesamiento seguro de imágenes y posible separación de buckets por tipo.
- Revisión de caducidad/rotación de tokens y lifetime de sesiones staff.
- Revisión completa de Edge Functions y secretos fuera del frontend.
