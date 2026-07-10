# ECOM.QA.1 — Smoke test DB/RPC ecommerce

## Resultado

**ECOM.QA.1 FAIL**

La infraestructura base, el portal público y el catálogo funcionaron correctamente. La fase falló al ejecutar `public.ecommerce_create_order`.

No se aplicaron correcciones en producción. La ejecución se detuvo después del fallo, se realizaron únicamente consultas read-only de diagnóstico y se pausó el portal de prueba.

## Ejecución

- Fecha/hora local: `2026-07-09 21:11` (`America/Mexico_City`)
- Fecha/hora UTC: `2026-07-10 03:11+00`
- Proyecto Supabase: `odlrhijtfyavryeqivaa`
- Repositorio: `fdxruli/Lanzo-POS`
- PR de referencia: `#78`, mergeado en `main`
- Frontend/React: no modificado
- Migraciones nuevas: no aplicadas
- `supabase db push`: no usado
- `migration repair`: no usado
- Operaciones destructivas: ninguna
- Datos reales borrados: ninguno
- `license_key`: no consultada, usada ni expuesta

## Licencia FREE autorizada

- `license_id`: `364a3087-1b50-4633-b67b-c5be0a50b10f`
- Plan: `free_trial`
- Estado: `active`
- Producto: `Lanzo POS Free`
- Fecha de creación: `2026-07-07T04:10:31.273446+00:00`
- Portal ecommerce previo: no

El uso de esta licencia fue autorizado explícitamente por el propietario del proyecto.

## Paso 1 — Verificación inicial

### Tablas ecommerce

**PASS** — existen las 7 tablas esperadas:

1. `public.ecommerce_order_events`
2. `public.ecommerce_order_items`
3. `public.ecommerce_orders`
4. `public.ecommerce_portal_hour_exceptions`
5. `public.ecommerce_portal_hours`
6. `public.ecommerce_portals`
7. `public.ecommerce_published_products`

### Funciones ecommerce

**PASS**

- 20 helpers `private.ecommerce_*`.
- 3 RPCs públicas:
  - `public.ecommerce_get_portal_by_slug`
  - `public.ecommerce_get_catalog`
  - `public.ecommerce_create_order`

### Features FREE/PRO

**PASS**

#### `free_trial`

- `ecommerce_portal_enabled = true`
- `ecommerce_max_published_products = 10`
- `ecommerce_stock_visibility = false`
- `ecommerce_realtime_orders = false`
- `ecommerce_cloud_catalog_source = false`

#### `pro_monthly`

- `ecommerce_portal_enabled = true`
- `ecommerce_max_published_products = -1`
- `ecommerce_stock_visibility = true`
- `ecommerce_realtime_orders = true`
- `ecommerce_cloud_catalog_source = true`

### Grants directos peligrosos

**PASS** — `0 rows` para grants directos sobre tablas `public.ecommerce_*` a:

- `anon`
- `authenticated`
- `public`

### RLS

**PASS** — `relrowsecurity = true` en las 7 tablas ecommerce.

## Paso 3 — Portal FREE de prueba

**PASS**

- `portal_id`: `7fb6e8fa-2e1c-4c7a-8b66-6ef7fca96c6a`
- `slug`: `qa-ecom-free-202607092110`
- Estado durante prueba: `published`
- Estado final: `paused`
- `metadata.test_data = true`
- `metadata.phase = ECOM.QA.1`

## Paso 4 — Producto FREE de prueba

**PASS**

- `published_product_id`: `6dedb06f-d032-4f96-94dd-c164c0ef7185`
- Nombre: `Producto QA FREE`
- Precio: `25.00 MXN`
- Publicado: sí
- Disponible: sí
- `stock_mode = hidden`
- `metadata.test_data = true`
- `metadata.phase = ECOM.QA.1`

## Paso 5 — RPC pública de portal

**PASS**

`public.ecommerce_get_portal_by_slug('qa-ecom-free-202607092110')`:

- `success = true`
- devuelve portal
- devuelve features
- `stockVisibility = false`
- `realtimeOrders = false`
- no expone `license_id`
- no expone `license_key`
- no expone datos sensibles de la licencia

## Paso 6 — RPC pública de catálogo

**PASS**

`public.ecommerce_get_catalog('qa-ecom-free-202607092110', 20, 0)`:

- `success = true`
- aparece `Producto QA FREE`
- precio = `25.00`
- `stock.mode = hidden`
- `stock.quantity = null`
- no expone `license_id`
- no expone `license_key`

## Paso 7 — Crear pedido ecommerce

**FAIL**

Idempotency key utilizada:

- `qa-ecom-idem-202607092113`

Respuesta pública exacta:

```json
{
  "success": false,
  "error": {
    "code": "ECOMMERCE_ORDER_CREATE_FAILED",
    "message": "No se pudo confirmar el pedido. Intentalo de nuevo."
  }
}
```

No se generaron:

- `order_id`
- `order_code`
- URL de WhatsApp del pedido

## Causa raíz confirmada

`public.ecommerce_create_order` llama al rate limiter con una firma posicional de 6 argumentos:

```sql
public.enforce_pos_rpc_rate_limit_v2(
  'ECOMMERCE_CREATE_ORDER',
  v_portal.license_id::text,
  null,
  20,
  600,
  900
)
```

La única firma instalada en producción es:

```text
public.enforce_pos_rpc_rate_limit_v2(
  p_license_key text,
  p_device_fingerprint text,
  p_staff_session_token text,
  p_rpc_name text,
  p_scope text,
  p_max_attempts integer,
  p_window_seconds integer,
  p_block_seconds integer,
  p_code text default 'RPC_RATE_LIMITED',
  p_metadata jsonb default '{}'
)
```

Conclusiones:

- La firma de 6 argumentos no existe.
- La función instalada requiere como mínimo 8 argumentos.
- El orden y los tipos de los argumentos usados por ecommerce tampoco corresponden con la firma real.
- La resolución de la función falla en tiempo de ejecución.
- El bloque global `WHEN OTHERS` de `ecommerce_create_order` oculta el error interno y devuelve `ECOMMERCE_ORDER_CREATE_FAILED`.

Se verificó adicionalmente que:

- `ecommerce_orders.order_number` sí es una identidad válida.
- Existe `public.ecommerce_orders_order_number_seq`.
- `public_order_code` sí es una columna generada.
- Los helpers de mensaje y URL de WhatsApp funcionan.
- No existe un overload compatible de 6 argumentos.

## Pasos 8 y 9 — Pedido, items, evento e idempotencia

**NO EJECUTADOS / NO APLICAN**

Después del fallo se confirmó:

- pedidos creados para el portal: `0`
- items creados: `0`
- eventos creados: `0`
- pedidos con idempotency key `qa-ecom-idem-202607092113`: `0`

La transacción interna se revirtió completa; no quedó un pedido parcial.

La idempotencia no pudo probarse porque no se creó el primer pedido.

## Paso 10 — Límite FREE de 10 productos

**NO EJECUTADO**

La regla de la fase exigía detenerse ante el primer fallo. No se intentaron las inserciones adicionales.

El trigger `private.ecommerce_published_product_guard` sí contiene la validación `ECOMMERCE_PRODUCT_LIMIT_REACHED`, pero falta la comprobación dinámica del límite en ECOM.QA.1 después de corregir la RPC.

## Paso 11 — No afectación a POS

**PASS para esta ejecución**

- `ecommerce_create_order` no contiene referencias de escritura a `pos_sales`, `pos_sale_items`, caja o inventario.
- La definición solo contempla escrituras en:
  - `public.ecommerce_orders`
  - `public.ecommerce_order_items`
  - `public.ecommerce_order_events`
  - rate limiter existente
- El fallo ocurrió al resolver la llamada al rate limiter, antes de crear el pedido ecommerce.
- No se creó ninguna venta POS.
- No se creó ningún item de venta POS.
- No se modificó caja.
- No se modificó inventario.
- No se modificaron reportes POS.

## Paso 12 — Pausa del portal

**PASS**

Estado final:

- `portal_id`: `7fb6e8fa-2e1c-4c7a-8b66-6ef7fca96c6a`
- `slug`: `qa-ecom-free-202607092110`
- `status = paused`
- `metadata.test_data = true`
- `metadata.phase = ECOM.QA.1`
- `metadata.qa_result = FAIL`
- `metadata.qa_failure_code = ECOMMERCE_ORDER_CREATE_FAILED`
- `metadata.qa_finished_at = 2026-07-10T03:11:03.251977+00:00`

## Datos de prueba conservados

### Portal

- ID: `7fb6e8fa-2e1c-4c7a-8b66-6ef7fca96c6a`
- Slug: `qa-ecom-free-202607092110`
- Estado: `paused`

### Producto

- ID: `6dedb06f-d032-4f96-94dd-c164c0ef7185`
- Nombre: `Producto QA FREE`
- Precio: `25.00 MXN`
- Publicado: sí
- Acceso público efectivo: bloqueado porque el portal está pausado

### Pedidos

- Ninguno

### Items

- Ninguno

### Eventos

- Ninguno

No se borró ningún dato.

## Mini fase correctiva propuesta

### ECOM.RPC.1.2 — Corregir integración con rate limiter y revalidar creación de pedidos

Objetivos:

1. Corregir la llamada de `public.ecommerce_create_order` al rate limiter.
2. No leer ni exponer una `license_key` real.
3. Usar argumentos nombrados para impedir futuros errores por orden posicional.
4. Utilizar identificadores ecommerce no secretos derivados de `portal_id` o `license_id` para separar los buckets de rate limit.
5. Mantener `SECURITY DEFINER` y `search_path = ''`.
6. Mantener cerrados los helpers privados.
7. Conservar el contrato público de errores sin exponer errores SQL internos.
8. Agregar una comprobación pre-deploy que confirme la existencia de la firma invocada.
9. Versionar la corrección en una migración nueva e idempotente.
10. Reanudar ECOM.QA.1 desde la creación del pedido, usando una nueva idempotency key.
11. Después, probar replay idempotente, límite FREE de 10 productos y volver a dejar el portal pausado.

Recomendación técnica:

- Crear un helper privado dedicado, por ejemplo `private.ecommerce_enforce_create_order_rate_limit(...)`, que adapte el contexto público ecommerce a la firma real de `enforce_pos_rpc_rate_limit_v2`.
- No usar la licencia secreta; emplear una clave sintética no sensible basada en UUID de portal/licencia y metadata `phase = ECOM.RPC.1.2`.
- Evitar volver a introducir una llamada posicional abreviada.

## Riesgo actual

Mientras no se aplique ECOM.RPC.1.2:

- el portal y catálogo públicos funcionan;
- `ecommerce_create_order` falla para todos los portales que alcancen esa llamada;
- no pueden completarse pedidos públicos;
- el error público es genérico y no revela la causa real;
- no hay evidencia de afectación a ventas, caja o inventario POS.
