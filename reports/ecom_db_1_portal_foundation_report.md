# ECOM.DB.1 — Base segura del portal publico / ecommerce

## Resumen

Esta fase prepara la base de datos para el portal publico de ecommerce de Lanzo-POS.

No crea UI, no crea carrito, no procesa pagos, no convierte pedidos a venta POS y no afecta caja, inventario ni reportes de venta.

## Migracion

```txt
supabase/migrations/20260709000004_ecom_db_1_portal_foundation.sql
```

## Features por plan

### FREE (`free_trial`)

- `ecommerce_portal_enabled = true`
- `ecommerce_whatsapp_checkout = true`
- `ecommerce_order_inbox = true`
- `ecommerce_max_published_products = 10`
- `ecommerce_custom_slug = false`
- `ecommerce_branding_customization = basic`
- `ecommerce_layout_customization = template_only`
- `ecommerce_business_hours = true`
- `ecommerce_delivery_pickup_settings = basic`
- `ecommerce_stock_visibility = false`
- `ecommerce_stock_reservation = false`
- `ecommerce_realtime_orders = false`
- `ecommerce_cloud_catalog_source = false`
- `ecommerce_whatsapp_autosend = false`

### PRO (`pro_monthly`)

- `ecommerce_portal_enabled = true`
- `ecommerce_whatsapp_checkout = true`
- `ecommerce_order_inbox = true`
- `ecommerce_max_published_products = -1`
- `ecommerce_custom_slug = true`
- `ecommerce_branding_customization = advanced`
- `ecommerce_layout_customization = advanced`
- `ecommerce_business_hours = true`
- `ecommerce_delivery_pickup_settings = advanced`
- `ecommerce_stock_visibility = true`
- `ecommerce_stock_reservation = true`
- `ecommerce_realtime_orders = true`
- `ecommerce_cloud_catalog_source = true`
- `ecommerce_whatsapp_autosend = false`

`-1` representa productos publicados ilimitados para PRO.

## Tablas creadas

- `public.ecommerce_portals`
- `public.ecommerce_portal_hours`
- `public.ecommerce_portal_hour_exceptions`
- `public.ecommerce_published_products`
- `public.ecommerce_orders`
- `public.ecommerce_order_items`
- `public.ecommerce_order_events`

## Seguridad

- Todas las tablas ecommerce quedan con RLS activo.
- Se revoca acceso directo de tablas a `anon`, `authenticated` y `public`.
- No se otorgan grants directos de tablas a roles cliente.
- Se agregan policies defensivas cerradas para roles cliente.
- Los helpers internos quedan bajo esquema `private`.
- No se usa `license_key` en el contrato ecommerce.
- No se tocan ventas, caja, inventario ni reportes.

## Guardas defensivas

### Productos publicados

`private.ecommerce_published_product_guard()`:

- Asigna `license_id` desde el portal.
- Aplica limite de productos publicados por plan.
- FREE queda limitado a 10 productos.
- PRO queda ilimitado.
- Bloquea stock visible/reserva si la licencia no lo permite.

### Pedidos

`private.ecommerce_order_guard()`:

- Asigna `license_id` desde el portal.
- Bloquea reserva de stock si el plan no tiene `ecommerce_stock_reservation`.

### Items y eventos

Los triggers asignan `portal_id` y `license_id` desde el pedido para evitar payloads manipulados.

## Fuera de alcance

- UI publica `/tienda/:slug`.
- Configuracion visual en frontend.
- RPCs publicas.
- Carrito React.
- Bandeja de pedidos online.
- Realtime.
- Conversion a venta.
- Descuento o reserva real de inventario.
- Caja.
- Pagos en linea.
- WhatsApp Cloud API.

## Verificacion esperada

- FREE: maximo 10 productos publicados.
- PRO: productos publicados ilimitados.
- `anon`, `authenticated` y `public`: 0 grants directos sobre tablas ecommerce.
- No hay cambios en ventas/caja/inventario.
