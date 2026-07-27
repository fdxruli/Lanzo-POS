# ECOM.ORDER.TRACKING.BRANDING.1 — reporte técnico

## Resumen

Se rediseñó la vista pública de seguimiento de pedidos para que el estado sea legible de un vistazo en escritorio y móvil. La vista ahora hereda la identidad visual segura del portal: nombre, logo, colores, tipografía y radios. También conserva la actualización, estados offline, revalidación en tiempo real y el contrato público de productos.

## Causa raíz y regresión corregida

Además del aislamiento visual original, la primera versión de la migración del PR redefinía la RPC desde una implementación anterior a `ECOM.ORDERS.2.2`. Usaba el resolver que exige un portal público, un único bucket antiguo y grants incompletos. Eso eliminaba el bucket pseudónimo por cliente, el bucket de capacidad del portal, el bucket de token válido, rompía el tracking de portales pausados y retiraba `service_role`.

## Supabase

La migración `20260726200000_ecom_order_tracking_storefront_branding.sql` parte de la definición real desplegada y de `20260713023529_ecom_orders_2_2_tracking_client_rate_limit.sql`.

- Conserva `SECURITY DEFINER`, `search_path = ''`, normalización de slug, identidad pseudónima, respuestas uniformes y los scopes `ECOMMERCE_ORDER_TRACKING_CLIENT`, `ECOMMERCE_ORDER_TRACKING_PORTAL` y `ECOMMERCE_ORDER_TRACKING_TOKEN`, con sus cantidades, ventanas, bloqueos y metadata de `ECOM.ORDERS.2.2`.
- Conserva el resolver `private.ecommerce_get_tracking_portal_by_slug_v1`, el aislamiento `token_hash + portal_id + license_id`, vencimiento/revocación, realtime por feature y el contrato de artículos `name + quantity`.
- Extiende el payload con `storefront.name`, `storefront.logoUrl` y las cuatro claves normalizadas de `storefront.theme`; nunca serializa la fila del portal.
- `storefrontAvailable` continúa dependiendo de `status = 'published'` y `ecommerce_portal_enabled`; el pedido sigue consultable cuando el portal está pausado.
- Revoca `PUBLIC`, concede ejecución a `anon`, `authenticated` y `service_role`, y conserva propietario `postgres`.
- No expone licencia, id interno, datos del cliente, dirección, teléfono, notas, token ni tablas directamente.
- No se aplicó directamente a producción; queda pendiente del flujo normal de migraciones después del merge.

## Frontend

- `PublicOrderTrackingPage` normaliza el tema recibido mediante `normalizeEcommercePortalTheme` y lo materializa con las mismas variables CSS del ecommerce público.
- Escritorio usa una trayectoria horizontal completa y una composición de dos columnas para detalle y productos.
- Móvil usa una trayectoria horizontal compacta, desplazable por toque, para adelantar el detalle y los productos.
- El mensaje configurado por el negocio se destaca como una instrucción identificada.
- El encabezado usa logo real o el fallback visual de Lanzo; el enlace de vuelta es una acción de texto, no un botón pesado.

## Validación

La cobertura focal valida estados terminales, ausencia de timeline normal, branding, logo seguro, normalización de tema, payload legado y portal pausado. La prueba SQL transaccional `ecom_orders_2_2_tracking_pos_authorization_test.sql` valida los tres buckets, respuestas uniformes, tracking publicado/pausado, allowlist de branding, defaults y privilegios; termina en `rollback`.

- PASS: 19/19 pruebas focales (`PublicOrderTrackingPage`, servicio de tracking y `OrderDiscountPanel.ecommerce`).
- PASS: lint focal, `git diff --check`, `npm run build` y `npm run build:store`.
- DEUDA HEREDADA: `npm run lint` global conserva 159 errores fuera del alcance.
- COMPARACIÓN GLOBAL: rama 114 fallos; `main` 119 fallos; fallos nuevos atribuibles al PR: 0.
- PASS SQL conectado y transaccional: `ecom_orders_2_2_tracking_pos_authorization_test.sql` y `ecom_orders_2_1_terminal_tracking_hardening_test.sql`, ambos ejecutados junto con la migración candidata y terminados en `rollback`.
- PENDIENTE VISUAL NO BLOQUEANTE: Vite no pudo iniciar en el runtime de captura (`uv_interface_addresses`); no se declara PASS visual.
- SUPABASE: la función desplegada se comparó antes de editar; la migración candidata fue validada sin persistirla. Producción conserva la versión desplegada de `ECOM.ORDERS.2.2` hasta el flujo normal de migraciones.

HEAD inicial: `2989528fae9e746a01bd6f1de8452666c3505263`. El HEAD final se registra en la entrega del PR después de publicar el commit.

## Alcance

No se modifican tablas, RLS, Storage, Edge Functions, checkout, catálogo, inventario, caja, cobro POS ni migraciones históricas. `OrderDiscountPanel` y su prueba se conservan sin cambios.
