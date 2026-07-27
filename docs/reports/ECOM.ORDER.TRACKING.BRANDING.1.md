# ECOM.ORDER.TRACKING.BRANDING.1 — reporte técnico

## Resumen

Se rediseñó la vista pública de seguimiento de pedidos para que el estado sea legible de un vistazo en escritorio y móvil. La vista ahora hereda la identidad visual segura del portal: nombre, logo, colores, tipografía y radios. También conserva la actualización, estados offline, revalidación en tiempo real y el contrato público de productos.

## Causa raíz

La página de seguimiento era una superficie aislada: usaba colores y tipografía fijos, no recibía el tema del portal y no liberaba el scroll que el shell del POS bloquea por defecto. En móvil la línea de tiempo vertical consumía el viewport y el contenido restante quedaba inaccesible.

## Supabase

La migración nueva `20260726200000_ecom_order_tracking_storefront_branding.sql` redefine únicamente `public.ecommerce_get_order_tracking(text, text)`.

- Conserva `SECURITY DEFINER`, `search_path = ''`, límites, hash del token, validación uniforme de inexistencia, autorización de realtime y grants mínimos para `anon`/`authenticated`.
- Extiende el payload ya público con un objeto allowlisted `storefront`: `name`, `logoUrl` y `theme` del portal resuelto por slug.
- Incluye `storefrontAvailable` desde el estado publicado y habilitación de pedidos del portal.
- No expone licencia, id interno, datos del cliente, dirección, teléfono, notas, token ni tablas directamente.
- No se aplicó directamente a producción; queda pendiente del flujo normal de migraciones después del merge.

## Frontend

- `PublicOrderTrackingPage` normaliza el tema recibido mediante `normalizeEcommercePortalTheme` y lo materializa con las mismas variables CSS del ecommerce público.
- Escritorio usa una trayectoria horizontal completa y una composición de dos columnas para detalle y productos.
- Móvil usa una trayectoria horizontal compacta, desplazable por toque, para adelantar el detalle y los productos.
- El mensaje configurado por el negocio se destaca como una instrucción identificada.
- El encabezado usa logo real o el fallback visual de Lanzo; el enlace de vuelta es una acción de texto, no un botón pesado.

## Validación

- PASS: `git diff --check` sin errores de whitespace.
- PENDIENTE: prueba visual en navegador para comparar los estados desktop y móvil. El entorno de automatización no expuso un navegador seleccionado para la captura.
- PENDIENTE: aplicar la migración en el entorno integrado y ejecutar los contratos SQL de tracking con un portal con y sin branding.

## Alcance

No se modifican las tablas, RLS, Storage, Edge Functions, checkout, catálogo, inventario ni el contrato privado de pedidos. Esta migración es aditiva a nivel de payload y mantiene las migraciones históricas intactas.
