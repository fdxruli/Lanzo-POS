# ECOM.RPC.1 — RPCs publicas seguras para portal, catalogo y creacion de pedidos

## Resumen

Esta fase expone contratos publicos controlados para el portal ecommerce.

No abre tablas al cliente. No crea UI. No toca ventas, caja, inventario ni reportes POS.

## Migracion

```txt
supabase/migrations/20260709000005_ecom_rpc_1_public_contracts.sql
```

## RPCs publicas

- `public.ecommerce_get_portal_by_slug(p_slug text)`
- `public.ecommerce_get_catalog(p_slug text, p_limit integer, p_offset integer)`
- `public.ecommerce_create_order(p_slug text, p_customer jsonb, p_items jsonb, p_idempotency_key text)`

Las 3 RPCs son `SECURITY DEFINER` y tienen `set search_path to ''`.

## Helpers privados

Incluye helpers para:

- errores publicos controlados;
- normalizacion de slug;
- obtencion de portal publico;
- serializacion publica del portal;
- serializacion publica de horarios;
- serializacion publica de productos;
- sanitizacion de telefono WhatsApp;
- construccion de mensaje WhatsApp;
- encode de URL;
- respuesta publica de pedido;
- validaciones de features ecommerce.

## Datos publicos devueltos

La capa publica devuelve solo informacion necesaria para la tienda:

- slug;
- nombre;
- descripcion/headline;
- template/theme publico;
- logo/cover publicos;
- telefono WhatsApp publicado;
- direccion publica;
- horarios;
- productos publicados;
- precio publico;
- disponibilidad publica;
- carrito/pedido confirmado.

## Datos que NO se devuelven

- `license_id`;
- `license_key`;
- `plan_id`;
- `device_id`;
- `staff_user_id`;
- costos;
- metadata interna sensible;
- stock exacto en FREE;
- datos de caja/venta/inventario.

## Creacion de pedido

`public.ecommerce_create_order(...)`:

- exige `p_idempotency_key`;
- valida cliente;
- valida metodo `pickup`/`delivery` contra configuracion del portal;
- valida items;
- no toma precio del frontend;
- recalcula precio desde `public.ecommerce_published_products.price`;
- calcula subtotal/total en Supabase;
- crea `ecommerce_orders`;
- crea `ecommerce_order_items`;
- crea evento `order_created`;
- genera WhatsApp Click-to-Chat;
- no toca `pos_sales`, `pos_sale_items`, caja, inventario ni reportes.

## ECOM.RPC.1.1 — Correccion de idempotencia concurrente y replay seguro

Se corrige el flujo de idempotencia para evitar fallos en carrera concurrente:

- el rate limit ocurre antes de escrituras de pedido/items/eventos;
- replay idempotente por `(portal_id, idempotency_key)` devuelve el pedido existente con `idempotent = true`;
- replay idempotente no inserta eventos repetidos;
- si ocurre `unique_violation` durante el insert de pedido, la funcion reconsulta por `(portal_id, idempotency_key)`;
- si encuentra el pedido existente, lo devuelve con `idempotent = true`;
- si no encuentra el pedido tras la colision, devuelve JSON controlado `ECOMMERCE_ORDER_CREATE_FAILED`.

## WhatsApp

Esta fase usa Click-to-Chat:

- crea/guarda el pedido primero;
- genera mensaje de WhatsApp;
- devuelve URL `https://wa.me/...`;
- el cliente debe enviar el mensaje manualmente.

No se implementa WhatsApp Cloud API real.

## Stock

- FREE no ve stock exacto.
- PRO puede ver stock segun `stock_mode` y feature `ecommerce_stock_visibility`.
- `stock_snapshot <= 0` queda como dato informativo en esta fase.
- No se descuenta ni reserva inventario todavia.
- La validacion estricta de stock/reserva queda para `ECOM.STOCK.1`.

## Rate limit

`ecommerce_create_order` usa el rate limiter aprobado `public.enforce_pos_rpc_rate_limit_v2` cuando esta disponible en la migracion.

## Grants

- Se revoca `EXECUTE` de `PUBLIC` sobre helpers/RPCs antes de conceder lo necesario.
- `anon` y `authenticated` solo reciben `EXECUTE` sobre las 3 RPCs publicas.
- No se conceden permisos directos sobre tablas ecommerce a roles cliente.

## Fuera de alcance

- UI publica `/tienda/:slug`.
- Carrito React.
- Configuracion visual del portal.
- Bandeja de pedidos dentro del POS.
- Realtime.
- Conversion a venta.
- Descuento/reserva real de inventario.
- Caja.
- Pagos en linea.
- WhatsApp Cloud API.

## Verificacion esperada

- 3 RPCs publicas ejecutables por `anon` y `authenticated`.
- Helpers privados no ejecutables por roles cliente.
- 0 grants directos de tablas ecommerce a `anon`, `authenticated` o `public`.
- Respuestas publicas sin `license_id` ni `license_key`.
- Pedidos no afectan ventas/caja/inventario.
