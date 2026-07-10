# ECOM.FE.PUBLIC.1 — Ruta pública, catálogo y carrito visual

Fecha de cierre inicial: 2026-07-09  
Corrección ECOM.FE.PUBLIC.1.1: 2026-07-09  
Integración ECOM.CHECKOUT.1: 2026-07-10

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

Solo se guardan:

- `productId`;
- `quantity`.

No se persisten precios ni totales. Al restaurar, el frontend obtiene el producto y precio actuales desde `ecommerce_get_catalog`. Mientras existan IDs pendientes y `pagination.hasMore=true`, solicita páginas posteriores sin eliminar prematuramente entradas válidas. Los productos inexistentes o no disponibles se eliminan únicamente al agotar el catálogo.

## Aislamiento del POS

La ruta pública no monta `App`, `Layout`, `WelcomeModal`, `StaffLoginModal`, `NavigationGuard`, notificaciones, realtime POS ni bootstrap local. Tampoco inicializa IndexedDB/Dexie del POS ni consulta ventas, caja, inventario, clientes o comandas.

## Seguridad pública base

Antes de ECOM.CHECKOUT.1, el frontend público utilizaba exclusivamente:

- `ecommerce_get_portal_by_slug`;
- `ecommerce_get_catalog`.

No realizaba consultas directas a tablas. La disponibilidad y los máximos del carrito se presentaban como UX, dejando la revalidación definitiva para PostgreSQL.

## Integración ECOM.CHECKOUT.1

ECOM.CHECKOUT.1 habilita el botón `Continuar pedido` únicamente cuando:

- el carrito está reconciliado;
- contiene productos;
- alcanza el pedido mínimo;
- `portal.orderingEnabled=true`;
- `features.orderInbox=true`;
- existe al menos una modalidad `pickup` o `delivery`;
- no hay un envío activo.

La nueva integración agrega:

- formulario público para nombre, teléfono, modalidad, dirección y notas;
- dirección visible y obligatoria únicamente para delivery;
- llamada productiva a `ecommerce_create_order` mediante `ecommercePublicClient`;
- payload mínimo de productos `{ productId, quantity }`;
- precio, subtotal y total calculados nuevamente por PostgreSQL;
- llave idempotente criptográfica `web-<uuid>`;
- hash SHA-256 de payload canónico;
- intento persistido solo en `sessionStorage`, sin datos personales en ese registro;
- reutilización de llave ante timeout, error de red o resultado ambiguo;
- llave nueva cuando cambia cliente, carrito o expiran 24 horas;
- doble guard de envío mediante estado, botón deshabilitado, `useRef` y una promesa activa;
- confirmación con código público, total de servidor, modalidad, fecha y estado pendiente;
- WhatsApp Click-to-Chat únicamente mediante clic explícito y URL `https://wa.me` validada;
- acción `Actualizar carrito` para errores de catálogo desactualizado;
- limpieza del carrito solo después de éxito normal o idempotente.

El checkout no conecta el pedido con ventas POS, caja, inventario, clientes POS, comandas, pagos ni reportes. No descuenta ni reserva stock.

### Backend asociado

La migración ECOM.RPC.1.3 conserva el contrato público existente y endurece:

- modalidad estricta `pickup|delivery`;
- dirección delivery mínima;
- dirección nula en pickup;
- rechazo de productos repetidos;
- cantidades enteras positivas y dentro del máximo;
- vigencia y pertenencia del producto al portal;
- stock publicado `status` y `exact`;
- pedido mínimo con precios del servidor;
- idempotencia por portal y llave;
- rate limiter privado de ECOM.RPC.1.2;
- mensajes públicos seguros y grants mínimos.

Una migración complementaria ECOM.RPC.1.3.1 agrega la validación explícita de `quantity` ausente/null sin editar la migración ya aplicada.

### Regresión pública

Las suites existentes de `PublicStorePage`, `usePublicCart`, `ecommercePublicService`, reglas de producto y routing público permanecen incluidas en la matriz específica de checkout. La restauración de carritos con productos ubicados después de los primeros 100 continúa siendo una condición obligatoria de aprobación.

### Fuera de alcance preservado

No se implementan todavía bandeja interna, aceptar/rechazar, realtime de pedidos, notificaciones internas, conversión a venta o comanda, descuento de inventario, caja, pagos, pedidos programados, tracking, cancelación pública ni WhatsApp Cloud API.

El detalle de migración, SQL, grants, pruebas, build, preview y riesgos queda documentado en:

`reports/ecom_checkout_1_public_checkout_report.md`
