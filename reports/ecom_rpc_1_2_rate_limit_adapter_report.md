# ECOM.RPC.1.2 — Adaptador de rate limit para creación de pedidos ecommerce

## Resultado

**ECOM.RPC.1.2 PASS**

**ECOM.QA.1 RETRY PASS**

La integración de `public.ecommerce_create_order` con el rate limiter quedó corregida en Supabase producción y versionada en una migración nueva. La creación de pedidos, el replay idempotente, el límite FREE y la superficie de permisos fueron revalidados correctamente.

## Ejecución

- Proyecto Supabase: `odlrhijtfyavryeqivaa`
- Repositorio: `fdxruli/Lanzo-POS`
- Rama: `fase-ecom-rpc-1-2-rate-limit-adapter`
- Migración del repositorio: `supabase/migrations/20260710032739_ecom_rpc_1_2_rate_limit_adapter.sql`
- Migración aplicada en Supabase: `20260710032739_ecom_rpc_1_2_rate_limit_adapter`
- Método de aplicación: `apply_migration`
- `supabase db push`: no usado
- `migration repair`: no usado
- `--include-all`: no usado
- Frontend/React: no modificado
- Operaciones destructivas: ninguna
- Datos eliminados: ninguno

## 1. Problema corregido

`public.ecommerce_create_order` llamaba al rate limiter con seis argumentos posicionales:

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

La llamada no coincidía con la función instalada. PostgreSQL no podía resolver el overload y el bloque público `WHEN OTHERS` devolvía el error genérico `ECOMMERCE_ORDER_CREATE_FAILED`, impidiendo crear pedidos.

## 2. Firma real del rate limiter

La verificación predeploy confirmó la firma de diez argumentos:

```text
p_license_key text,
p_device_fingerprint text,
p_staff_session_token text,
p_rpc_name text,
p_scope text,
p_max_attempts integer,
p_window_seconds integer,
p_block_seconds integer,
p_code text,
p_metadata jsonb
```

Propiedades verificadas:

- retorno `jsonb`;
- `SECURITY DEFINER`;
- `search_path = ''`;
- el primer argumento se usa como identificador textual del bucket en `pos_rpc_rate_limits`;
- el limiter no exige resolver una licencia existente.

## 3. Helper privado creado

Se creó:

```sql
private.ecommerce_enforce_create_order_rate_limit(
  p_portal_id uuid,
  p_license_id uuid
) returns jsonb
```

Propiedades:

- `language plpgsql`;
- `SECURITY DEFINER`;
- `set search_path to ''`;
- devuelve el JSON original del rate limiter;
- rechaza contexto interno nulo;
- cerrado para `public`, `anon` y `authenticated`.

La llamada usa argumentos nombrados:

```sql
public.enforce_pos_rpc_rate_limit_v2(
  p_license_key := 'ecommerce-license:' || p_license_id::text,
  p_device_fingerprint := 'public-store-portal:' || p_portal_id::text,
  p_staff_session_token := null,
  p_rpc_name := 'ecommerce_create_order',
  p_scope := 'ECOMMERCE_CREATE_ORDER',
  p_max_attempts := 20,
  p_window_seconds := 600,
  p_block_seconds := 900,
  p_code := 'ECOMMERCE_RATE_LIMITED',
  p_metadata := jsonb_build_object(
    'source', 'ecommerce_public_store',
    'portal_id', p_portal_id,
    'license_id', p_license_id,
    'phase', 'ECOM.RPC.1.2'
  )
)
```

## 4. Protección de la credencial de licencia

**PASS**

- No se consultó una credencial real de licencia.
- No se leyó la tabla de licencias desde el helper.
- No se devolvió `license_id` ni una credencial en el contrato público.
- El argumento obligatorio del limiter recibe únicamente una clave sintética no sensible derivada del UUID interno.
- La revisión estática de la migración encontró la cadena reservada únicamente en el nombre de argumento requerido `p_license_key`.

Revisión estática de términos prohibidos en la migración:

- `pos_sales`: ausente
- `pos_sale_items`: ausente
- `pos_cash`: ausente
- `cash_session`: ausente
- `inventory`: ausente

## 5. Corrección de `ecommerce_create_order`

La RPC ahora ejecuta:

```sql
v_rate_limit := private.ecommerce_enforce_create_order_rate_limit(
  v_portal.id,
  v_portal.license_id
);
```

Verificaciones sobre la definición activa:

- adaptador privado presente: sí;
- llamada directa anterior al limiter: ausente;
- rate limit permanece antes del lookup idempotente y de las inserciones;
- manejo `unique_violation` preservado;
- reconsulta por `(portal_id, idempotency_key)` preservada;
- marcador/evento `order_idempotent_returned`: ausente;
- cálculo de precio conserva `v_product.price * v_quantity`;
- no hay referencias a ventas, caja o inventario POS.

La migración es idempotente:

- valida previamente ambas firmas;
- si la llamada nueva ya está instalada, no vuelve a modificar la RPC;
- si encuentra la llamada anterior, reemplaza únicamente ese fragmento;
- si no encuentra ninguno de los contratos esperados, aborta en lugar de aplicar un parche ambiguo.

## 6. Reintento de creación de pedido

Portal utilizado:

- `portal_id`: `7fb6e8fa-2e1c-4c7a-8b66-6ef7fca96c6a`
- `slug`: `qa-ecom-free-202607092110`
- producto base: `6dedb06f-d032-4f96-94dd-c164c0ef7185`
- precio publicado: `25.00 MXN`
- idempotency key: `qa-ecom-idem-rpc-1-2-202607092128`

Primer intento:

- `success = true`
- `idempotent = false`
- `order.id = 78bb8981-7f80-46e5-99f7-b10694b5948f`
- `order.code = EC-00000001`
- `order.total = 50.00`
- `order.status = new`
- `whatsapp.url`: no nula

**Resultado: PASS**

## 7. Idempotencia

Se repitió exactamente la misma llamada con la misma idempotency key.

Resultado:

- `success = true`
- `idempotent = true`
- mismo `order.id`: `78bb8981-7f80-46e5-99f7-b10694b5948f`
- pedidos con la clave: `1`
- items del pedido: `1`
- eventos del pedido: `1`
- evento único: `order_created`

Detalle persistido:

- producto: `Producto QA FREE`
- precio unitario: `25.00`
- cantidad: `2`
- total de línea: `50.00`
- subtotal: `50.00`
- total: `50.00`

No se creó un segundo pedido ni un segundo evento.

**Resultado: PASS**

## 8. Límite FREE de productos publicados

Estado inicial: `1` producto publicado.

Prueba ejecutada:

1. Se insertaron nueve productos QA adicionales con `metadata.test_data = true`, `metadata.phase = ECOM.RPC.1.2` y `metadata.purpose = free_product_limit`.
2. El portal llegó exactamente a `10` productos publicados.
3. Se intentó publicar el producto número `11`.
4. El trigger rechazó la operación con `ECOMMERCE_PRODUCT_LIMIT_REACHED`.

Resultado final:

- productos publicados: `10`
- productos QA adicionales conservados: `9`
- filas del intento rechazado: `0`

**Resultado: PASS**

## 9. Seguridad post-fix

### Grants directos sobre tablas ecommerce

- resultado para `anon`, `authenticated` y `public`: `0 rows`

### RPCs públicas

| Función | anon | authenticated | public |
|---|---:|---:|---:|
| `ecommerce_create_order` | true | true | false |
| `ecommerce_get_catalog` | true | true | false |
| `ecommerce_get_portal_by_slug` | true | true | false |

### Helpers privados ecommerce

- helpers encontrados: `21`
- execute para `anon`: `false` en todos
- execute para `authenticated`: `false` en todos
- execute para `public`: `false` en todos

### RLS

RLS continúa habilitado en las siete tablas ecommerce:

1. `ecommerce_order_events`
2. `ecommerce_order_items`
3. `ecommerce_orders`
4. `ecommerce_portal_hour_exceptions`
5. `ecommerce_portal_hours`
6. `ecommerce_portals`
7. `ecommerce_published_products`

**Resultado de seguridad: PASS**

## 10. Datos de prueba conservados

No se borraron datos.

Quedaron conservados:

- portal QA: `7fb6e8fa-2e1c-4c7a-8b66-6ef7fca96c6a`;
- 10 productos publicados de prueba en total;
- pedido ecommerce: `78bb8981-7f80-46e5-99f7-b10694b5948f`;
- un item de pedido;
- un evento `order_created`.

El portal quedó al final:

- `status = paused`;
- `metadata.phase = ECOM.RPC.1.2`;
- `metadata.qa_retry_result = PASS`;
- `metadata.qa_retry_started_at = 2026-07-10T03:27:52.871184+00:00`;
- `metadata.qa_retry_finished_at = 2026-07-10T03:29:31.314299+00:00`.

El resultado FAIL original de ECOM.QA.1 se conservó como historial y se añadió el resultado del reintento.

## 11. No afectación a POS

**PASS**

No se modificaron ni se usaron flujos de:

- ventas POS;
- items de venta POS;
- caja o sesiones de caja;
- inventario o lotes;
- reportes POS;
- frontend;
- React.

La RPC solo escribió en:

- `public.ecommerce_orders`;
- `public.ecommerce_order_items`;
- `public.ecommerce_order_events`;
- infraestructura existente del rate limiter.

No se creó venta POS, no se descontó inventario y no se registró movimiento de caja.

## 12. Riesgos pendientes

1. Por requisito de contrato, el rate limit se ejecuta antes del replay idempotente. Los reintentos idempotentes también consumen cuota del bucket de 20 solicitudes por 10 minutos.
2. El bucket sintético se segmenta por portal y licencia, no por IP del comprador. Un volumen alto compartirá el mismo límite del portal.
3. Los datos QA permanecen en producción intencionalmente. Están identificados mediante metadata y el portal está pausado.
4. El bloque público `WHEN OTHERS` sigue devolviendo un error genérico, como exige el contrato. Los diagnósticos internos deben apoyarse en pruebas SQL controladas y reportes.

## Conclusión

**ECOM.RPC.1.2 PASS**

**ECOM.QA.1 RETRY PASS**

La fase está lista para revisión y merge del PR. No se avanzó al frontend; el alcance quedó limitado a DB/RPC y QA controlado.
