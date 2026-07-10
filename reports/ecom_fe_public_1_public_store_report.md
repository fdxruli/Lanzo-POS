# ECOM.FE.PUBLIC.1 — Ruta pública, catálogo y carrito visual

Fecha de cierre inicial: 2026-07-09  
Corrección ECOM.FE.PUBLIC.1.1: 2026-07-09  
Integración ECOM.CHECKOUT.1: 2026-07-10  
Corrección ECOM.CHECKOUT.1.1: 2026-07-10

## Resultado consolidado

**ECOM.FE.PUBLIC.1.1 PASS.**

La tienda pública continúa aislada del shell POS y utiliza el cliente Supabase público dedicado, sin sesión persistente, service role, credenciales POS, Dexie ni `useAppStore`.

La implementación base mantiene:

- ruta pública `/tienda/:slug`;
- portal, horarios y métodos de entrega;
- catálogo paginado de 100 elementos por página;
- búsqueda y filtro por categoría;
- carrito visual por slug en `sessionStorage`;
- subtotal con precios actuales del catálogo;
- pedido mínimo;
- máximo de productos distintos y máximo por producto;
- restauración de productos ubicados después de la primera página;
- reconciliación no destructiva hasta agotar el catálogo;
- protección contra offsets repetidos y respuestas tardías;
- reglas coherentes para stock `hidden`, `status` y `exact`.

## Persistencia y reconciliación del carrito

La clave es:

`lanzo:ecommerce:cart:<slug>:v1`

Solo se guardan `productId` y `quantity`. No se persisten precios ni totales. Al restaurar, el frontend obtiene el producto y precio actuales desde `ecommerce_get_catalog`. Mientras existan IDs pendientes y `pagination.hasMore=true`, solicita páginas posteriores sin eliminar prematuramente entradas válidas. Los productos inexistentes o no disponibles se eliminan únicamente al agotar el catálogo.

## Aislamiento del POS

La ruta pública no monta `App`, `Layout`, `WelcomeModal`, `StaffLoginModal`, `NavigationGuard`, notificaciones, realtime POS ni bootstrap local. Tampoco inicializa IndexedDB/Dexie del POS ni consulta ventas, caja, inventario, clientes o comandas.

## Seguridad pública base

Antes de ECOM.CHECKOUT.1, el frontend público utilizaba exclusivamente `ecommerce_get_portal_by_slug` y `ecommerce_get_catalog`. No realizaba consultas directas a tablas. La disponibilidad y los máximos del carrito se presentaban como UX, dejando la revalidación definitiva para PostgreSQL.

## Integración ECOM.CHECKOUT.1

ECOM.CHECKOUT.1 habilita `Continuar pedido` únicamente cuando el carrito está reconciliado, contiene productos, alcanza el mínimo, el portal acepta pedidos, `orderInbox` está habilitado, existe una modalidad disponible y no hay un envío activo.

La integración agrega:

- formulario público para nombre, teléfono, modalidad, dirección y notas;
- dirección obligatoria únicamente para delivery;
- llamada productiva a `ecommerce_create_order` mediante `ecommercePublicClient`;
- payload mínimo `{ productId, quantity }`;
- precio y total calculados por PostgreSQL;
- llave idempotente criptográfica y hash SHA-256;
- intento persistido solo en `sessionStorage`, sin PII;
- retry con la misma llave ante timeout, red o resultado ambiguo;
- doble guard de envío;
- confirmación con código público, total de servidor, modalidad, fecha y estado pendiente;
- WhatsApp Click-to-Chat mediante clic explícito y URL validada;
- actualización de carrito ante catálogo desactualizado;
- limpieza del carrito únicamente después de éxito normal o idempotente.

El checkout no conecta el pedido con ventas POS, caja, inventario, clientes POS, comandas, pagos ni reportes. No descuenta ni reserva stock.

### Backend asociado

ECOM.RPC.1.3 conserva el contrato público y endurece modalidad, dirección, duplicados, cantidades, vigencia de producto, stock, mínimo, idempotencia, rate limit, mensajes y grants. ECOM.RPC.1.3.1 agrega la validación explícita de `quantity` ausente/null dentro de una línea.

### Corrección ECOM.CHECKOUT.1.1

ECOM.RPC.1.3.2 corrige dos discrepancias adicionales:

- `p_items = SQL NULL`, arrays vacíos y JSON no-array se rechazan con `ECOMMERCE_EMPTY_CART` antes de cualquier inserción;
- `stock_mode='exact'` con `stock_snapshot=NULL` se trata como agotado, igual que en el catálogo público.

La interfaz pública también centraliza un formulario vacío y elimina nombre, teléfono, dirección y notas después de un pedido exitoso o al cambiar `portal.slug`. Los datos se conservan durante errores recuperables para permitir retry, y cambiar delivery a pickup sigue borrando la dirección inmediatamente. La confirmación permanece intacta porque depende de la respuesta del servidor, no del estado del formulario.

Las pruebas incluyen un segundo pedido en la misma pestaña y confirman que el checkout vuelve a abrir sin PII.

### Regresión pública

Las suites de `PublicStorePage`, `usePublicCart`, `ecommercePublicService`, reglas de producto y routing público permanecen incluidas. La restauración de carritos con productos después de los primeros 100 continúa siendo obligatoria.

### Fuera de alcance preservado

No se implementan bandeja interna, aceptar/rechazar, realtime de pedidos, notificaciones internas, conversión a venta o comanda, descuento/reserva de inventario, caja, pagos, pedidos programados, tracking, cancelación pública ni WhatsApp Cloud API.

El detalle de migración, SQL, grants, pruebas, build, preview y riesgos queda documentado en:

`reports/ecom_checkout_1_public_checkout_report.md`
