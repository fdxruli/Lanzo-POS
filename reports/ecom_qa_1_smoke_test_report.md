# ECOM.QA.1 — Smoke test DB/RPC ecommerce

## Resultado

**ECOM.QA.1 FAIL (BLOCKED — autorización requerida)**

Este resultado no representa un fallo funcional confirmado en ecommerce. La fase quedó detenida en el Paso 2 porque no existe una licencia FREE claramente identificada como dato de prueba y las reglas de la fase prohíben usar una licencia real sin autorización previa.

## Ejecución

- Fecha/hora local: `2026-07-09 21:04:31` (`America/Mexico_City`)
- Fecha/hora UTC: `2026-07-10 03:04:31+00`
- Proyecto Supabase: `odlrhijtfyavryeqivaa`
- Repositorio: `fdxruli/Lanzo-POS`
- PR de referencia: `#78`, mergeado en `main`
- Alcance ejecutado: verificación inicial read-only y selección segura de licencia
- Frontend/React: no modificado
- Migraciones nuevas: no aplicadas
- Operaciones destructivas: ninguna
- Datos productivos modificados: ninguno

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

**PASS** — se encontraron:

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

## Paso 2 — Selección de licencia FREE segura

**BLOCKED**

Se encontraron 5 licencias `free_trial`, todas con estado `active`, pero ninguna está claramente marcada o nombrada como licencia de QA, test, demo o prueba.

Diferencia de esquema detectada:

- La consulta propuesta asumía `public.licenses.metadata`.
- La tabla real `public.licenses` no contiene una columna `metadata`.
- Por ello no fue posible validar `metadata.test_data = true` sobre licencias.

No se seleccionó ninguna licencia y no se consultó ni expuso `license_key`.

Conforme a las reglas de ECOM.QA.1, la ejecución se detuvo antes de crear portal, productos o pedidos.

## Pruebas no ejecutadas por el bloqueo

- Crear portal FREE de prueba.
- Publicar producto FREE de prueba.
- Probar `ecommerce_get_portal_by_slug`.
- Probar `ecommerce_get_catalog`.
- Probar `ecommerce_create_order`.
- Verificar pedido, items y evento.
- Probar idempotencia.
- Probar límite FREE de 10 productos.
- Verificar de forma dinámica la no afectación a POS.
- Pausar el portal de prueba.

## Identificadores de prueba

No generados:

- Licencia FREE usada: ninguna.
- `portal_id`: no generado.
- `slug`: no generado.
- `published_product_id`: no generado.
- `order_id`: no generado.
- `order_code`: no generado.

## Datos de prueba creados

**Ninguno.**

## Pendiente para continuar

Se requiere autorización explícita para usar una de las licencias FREE activas existentes, o bien proporcionar/crear por un proceso autorizado una licencia FREE claramente dedicada a QA.

Una vez autorizada una licencia, la fase debe reanudarse desde el Paso 3 y el presente reporte debe actualizarse con los resultados completos.

## Riesgos

- Usar una licencia FREE activa sin confirmar su propósito puede interferir con un usuario real.
- La ausencia de `licenses.metadata` impide aplicar literalmente el criterio de selección descrito en el prompt.
- No existe evidencia dinámica todavía sobre contrato público, creación de pedidos, idempotencia o límite de productos; únicamente quedó validada la superficie inicial de esquema, configuración, grants y RLS.
