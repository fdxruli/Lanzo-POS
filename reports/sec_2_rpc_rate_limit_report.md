# FASE SEC.2 — Rate limit server-side para RPCs críticas

Fecha de preparación: 2026-07-05  
Corrección SEC.2.1: 2026-07-05  
Repositorio: `fdxruli/Lanzo-POS`  
Proyecto Supabase auditado: `odlrhijtfyavryeqivaa`

Migraciones del PR:

- `supabase/migrations/20260707000000_sec_2_rpc_rate_limits.sql`
- `supabase/migrations/20260707000001_sec_2_1_fix_license_contract_and_rpc_coverage.sql`

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

## 2. Corrección SEC.2.1: contrato de `verify_device_license_unified`

La RPC `verify_device_license_unified` no usa el contrato genérico de `success`. El frontend espera principalmente:

- `data.valid`
- `data.reason`

Por eso SEC.2.1 agrega:

```sql
public.build_license_validation_rate_limited_response(p_rate_limit jsonb)
```

Cuando `verify_device_license_unified` es rate-limited, el wrapper devuelve:

```json
{
  "valid": false,
  "success": false,
  "reason": "AUTH_RATE_LIMITED",
  "code": "AUTH_RATE_LIMITED",
  "message": "Demasiados intentos. Espera unos minutos e intenta de nuevo.",
  "retry_after_seconds": 300,
  "is_rate_limited": true
}
```

`AUTH_RATE_LIMITED` no equivale a licencia inválida permanente. No debe tratarse como `DEVICE_NOT_ALLOWED`, `CLONING_DETECTED`, `LICENSE_EXPIRED`, `DEVICE_TOKEN_INVALID` ni ningún rechazo real de licencia. Es un bloqueo temporal defensivo por volumen.

## 3. Cobertura adicional SEC.2.1

Supabase confirmó que las siguientes RPCs existen activas en `public` y retornan `jsonb`; SEC.2.1 las agrega a la cobertura de wrappers con `enforce_pos_rpc_rate_limit_v2(...)` si existen en el ambiente donde corre la migración:

| RPC | Categoría | Límite | Código | Estado SEC.2.1 |
|---|---:|---:|---|---|
| `pos_get_current_cash_session` | POS_READ_HEAVY | 120 / 10 min; bloqueo 5 min | `RPC_RATE_LIMITED` | Agregado |
| `pos_admin_list_cash_sessions` | POS_READ_HEAVY | 60 / 10 min; bloqueo 5 min | `REPORT_RATE_LIMITED` | Agregado |
| `pos_admin_get_cash_session_detail` | POS_READ_HEAVY | 60 / 10 min; bloqueo 5 min | `REPORT_RATE_LIMITED` | Agregado |
| `pos_validate_sales_consistency` | POS_READ_HEAVY | 30 / 10 min; bloqueo 5 min | `REPORT_RATE_LIMITED` | Agregado |
| `pos_get_restaurant_orders` | POS_READ_HEAVY | 120 / 10 min; bloqueo 5 min | `RPC_RATE_LIMITED` | Agregado |
| `pos_get_restaurant_order_by_local_order` | POS_READ_HEAVY | 120 / 10 min; bloqueo 5 min | `RPC_RATE_LIMITED` | Agregado |
| `pos_get_preparation_stations` | POS_READ_HEAVY | 120 / 10 min; bloqueo 5 min | `RPC_RATE_LIMITED` | Agregado |
| `pos_get_customer_credit_summary` | POS_READ_HEAVY | 60 / 10 min; bloqueo 5 min | `REPORT_RATE_LIMITED` | Agregado |
| `pos_get_sale` | POS_READ_HEAVY | 120 / 10 min; bloqueo 5 min | `RPC_RATE_LIMITED` | Agregado |
| `pos_migrate_local_customers` | SYNC_PULL | 10 / 10 min; bloqueo 15 min | `RPC_RATE_LIMITED` | Agregado |
| `pos_migrate_local_product_catalog` | SYNC_PULL | 10 / 10 min; bloqueo 15 min | `RPC_RATE_LIMITED` | Agregado |
| `pos_migrate_local_customer_credit` | SYNC_PULL | 10 / 10 min; bloqueo 15 min | `RPC_RATE_LIMITED` | Agregado |

## 4. Matriz resumida de cobertura SEC.2

| Grupo | RPCs cubiertas | Límite base |
|---|---|---|
| AUTH_LICENSE | `activate_license_on_device`, `verify_device_license_unified`, `create_free_trial_license`, `renew_license_free` | 3–60 por ventana según riesgo |
| STAFF_AUTH | `staff_login_on_device`, `verify_staff_session`, `staff_logout_session` | 10–60 por 10 min |
| PROFILE | `save_business_profile_secure`, `get_business_profile_anon`, `register_term_acceptance` | 20–60 por 10 min |
| DEVICE_ADMIN | `get_license_devices_anon`, `release_device_anon`, `deactivate_device_anon` | 10–30 por 10 min |
| POS_WRITE | clientes, productos, lotes, caja monetaria, ventas, restaurante, crédito, caducidad y preparación | 60–120 por 10 min |
| POS_READ_HEAVY | reportes, históricos, caja actual/admin, restaurante activo, venta individual, preparación y crédito | 30–120 por 10 min |
| REPORT_EXPORT | exportaciones | 10 por 10 min |
| SYNC_PULL | snapshots, pulls incrementales y migraciones locales | 10–120 por 10 min |
| AI_USAGE | `get_ai_agent_usage` si existe | 30 por 10 min |

## 5. Queries de verificación

### Contrato especial de `verify_device_license_unified`

```sql
select
  p.proname,
  pg_get_functiondef(p.oid) ilike '%build_license_validation_rate_limited_response%' as uses_license_rate_limited_contract,
  pg_get_functiondef(p.oid) ilike '%AUTH_RATE_LIMITED%' as returns_auth_rate_limited,
  pg_get_functiondef(p.oid) ilike '%verify_device_license_unified_unlimited%' as delegates_to_unlimited
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'verify_device_license_unified';
```

Resultado esperado:

- `uses_license_rate_limited_contract = true`
- `returns_auth_rate_limited = true`
- `delegates_to_unlimited = true`

### Cobertura SEC.2.1

```sql
select
  p.proname,
  pg_get_functiondef(p.oid) ilike '%enforce_pos_rpc_rate_limit_v2%' as has_sec2_rate_limit,
  pg_get_functiondef(p.oid) ilike '%_unlimited%' as delegates_to_unlimited
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = any(array[
    'verify_device_license_unified',
    'pos_get_current_cash_session',
    'pos_admin_list_cash_sessions',
    'pos_admin_get_cash_session_detail',
    'pos_validate_sales_consistency',
    'pos_get_restaurant_orders',
    'pos_get_restaurant_order_by_local_order',
    'pos_get_preparation_stations',
    'pos_get_customer_credit_summary',
    'pos_get_sale',
    'pos_migrate_local_customers',
    'pos_migrate_local_product_catalog',
    'pos_migrate_local_customer_credit'
  ])
order by p.proname;
```

Resultado esperado para RPCs existentes:

- `has_sec2_rate_limit = true`
- `delegates_to_unlimited = true`

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

## 6. Pruebas manuales obligatorias

### Contrato de licencia y caché seguro

- [ ] Forzar rate limit de `verify_device_license_unified`.
- [ ] Confirmar respuesta:
  - `valid = false`
  - `success = false`
  - `reason = 'AUTH_RATE_LIMITED'`
  - `code = 'AUTH_RATE_LIMITED'`
  - `is_rate_limited = true`
- [ ] Confirmar que `AUTH_RATE_LIMITED` no se muestra como licencia inválida permanente.
- [ ] Confirmar que el usuario no queda expulsado como si fuera `DEVICE_NOT_ALLOWED`, `CLONING_DETECTED`, `LICENSE_EXPIRED` o `DEVICE_TOKEN_INVALID`.
- [ ] Confirmar que `last_valid_license_state` no se borra por un rate limit temporal.

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
- [ ] Consultar caja actual con `pos_get_current_cash_session`.
- [ ] Registrar movimiento de caja.
- [ ] Consultar caja admin con `pos_admin_list_cash_sessions` y `pos_admin_get_cash_session_detail`.
- [ ] Cerrar caja.
- [ ] Consultar pedidos restaurante activos.
- [ ] Actualizar pedido restaurante.
- [ ] Cerrar pedido restaurante después de checkout.
- [ ] Consultar estaciones de preparación.
- [ ] Consultar venta individual con `pos_get_sale`.
- [ ] Consultar resumen de crédito cliente.

### Reportes/exportaciones/sync

- [ ] Ejecutar dashboard/reportes normales.
- [ ] Ejecutar `pos_validate_sales_consistency`.
- [ ] Ejecutar exportación normal.
- [ ] Ejecutar snapshot inicial en dispositivo PRO.
- [ ] Ejecutar pull incremental después de cambios.
- [ ] Ejecutar migraciones locales de clientes/productos/crédito en escenario controlado.
- [ ] Confirmar que bootstrap/reconexión móvil no queda bloqueado.
- [ ] Repetir exportación hasta recibir `REPORT_RATE_LIMITED`.

### IA

- [ ] Consultar uso IA con `get_ai_agent_usage` si la RPC existe.
- [ ] Generar análisis IA normal desde Edge Function.
- [ ] Confirmar que el cupo funcional IA por periodo sigue intacto.
- [ ] Documentar en SEC.3/SEC.4 si `lanzo-ai-agent` necesita rate limit interno adicional dentro de la Edge Function.

## 7. Restricciones verificadas por diseño

- No cambia comportamiento FREE/PRO.
- No rediseña autenticación.
- No cambia contratos de respuestas válidas.
- No reabre `save_business_profile_anon`.
- No concede `private.*`.
- No elimina idempotencia.
- No guarda tokens planos.
- No toca precios, descuentos, split bill, inventario ni restaurante salvo wrappers de RPC.
- No modifica storage upload; queda para SEC.3/SEC.4.
- No aplica DDL directamente en producción desde este PR; las migraciones quedan versionadas para despliegue controlado.

## 8. Checklist de aceptación SEC.2 + SEC.2.1

- [ ] Auth/licencia/staff tienen rate limit server-side.
- [ ] `verify_device_license_unified` rate-limited devuelve `valid:false`, `reason:'AUTH_RATE_LIMITED'`, `code:'AUTH_RATE_LIMITED'`, `is_rate_limited:true`.
- [ ] `AUTH_RATE_LIMITED` no se trata como licencia inválida permanente.
- [ ] `last_valid_license_state` no se borra por rate limit temporal.
- [ ] `pos_get_current_cash_session` queda cubierto.
- [ ] `pos_admin_list_cash_sessions` queda cubierto.
- [ ] `pos_admin_get_cash_session_detail` queda cubierto.
- [ ] `pos_validate_sales_consistency` queda cubierto.
- [ ] RPCs activas adicionales de restaurante/preparación/crédito/venta/migraciones quedan cubiertas.
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
