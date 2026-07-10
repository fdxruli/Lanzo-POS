# ECOM.CHECKOUT.1 — Checkout público seguro, creación de pedido e integración WhatsApp

Fecha: 2026-07-10  
Repositorio: `fdxruli/Lanzo-POS`  
Rama: `fase-ecom-checkout-1`  
PR: `#84`  
Supabase: `odlrhijtfyavryeqivaa`

## 1. Contrato RPC real encontrado

El preflight consultó `pg_proc` y `pg_get_functiondef` directamente en producción. La firma instalada se confirmó como:

```sql
public.ecommerce_create_order(
  p_slug text,
  p_customer jsonb,
  p_items jsonb,
  p_idempotency_key text
) returns jsonb
```

`p_idempotency_key` conserva `DEFAULT NULL::text`. Las correcciones parten de la definición instalada para preservar ECOM.RPC.1.2, modalidad, dirección, duplicados, cantidades, idempotencia, rate limit, `SECURITY DEFINER` y `search_path=''`.

## 2. Problemas de integridad detectados

ECOM.CHECKOUT.1.1 detectó:

1. `p_items = NULL::jsonb` podía atravesar comparaciones SQL de tres valores y crear una orden sin artículos cuando el mínimo era cero;
2. `stock_mode='exact'` con `stock_snapshot=NULL` era mostrado como agotado por catálogo, pero la RPC todavía lo aceptaba;
3. el formulario React conservaba nombre, teléfono, dirección y notas después de un pedido exitoso en la misma pestaña.

## 3. Migraciones aplicadas

Se aplicaron de forma controlada y se versionaron:

- `20260710120000_ecom_rpc_1_3_checkout_integrity.sql`;
- `20260710133000_ecom_rpc_1_3_1_quantity_null_guard.sql`;
- `20260710141000_ecom_rpc_1_3_2_null_cart_exact_stock.sql`.

La tercera migración consulta `pg_get_functiondef`, reemplaza únicamente `public.ecommerce_create_order(text,jsonb,jsonb,text)` y no edita las dos migraciones previas. No se usaron `db push`, `migration repair`, drops, truncates ni deletes.

## 4. Dirección obligatoria

Delivery exige una dirección normalizada de al menos 5 caracteres. Pickup guarda `customer_address = null` y descarta cualquier dirección residual.

## 5. Productos duplicados

Los UUID repetidos se rechazan con `ECOMMERCE_DUPLICATE_PRODUCT`. No se suman líneas silenciosamente.

## 6. Cantidades enteras

La cantidad debe estar presente, ser finita, entera, positiva y no superar `portal.max_item_quantity`.

ECOM.RPC.1.3.1 corrigió `quantity` ausente/null dentro de una línea. Esto no cubría `p_items = SQL NULL`; ese caso se corrige en ECOM.RPC.1.3.2.

## 7. Stock status/exact

- `hidden`: sigue dependiendo de `is_available`.
- `status`: conserva la semántica previa; snapshot `NULL` no se redefine en esta fase.
- `exact`: `coalesce(stock_snapshot, 0)` alinea checkout y catálogo. `NULL` o cero se considera agotado; una cantidad superior al snapshot devuelve `ECOMMERCE_STOCK_LIMIT_EXCEEDED`.

No se reserva ni descuenta inventario.

## 8. Idempotencia

Se conserva la unicidad `portal_id + idempotency_key`. La repetición retorna la misma orden con `idempotent=true`, sin duplicar orden, items ni evento.

## 9. Estrategia de retry

El frontend mantiene llave criptográfica y hash SHA-256. Mismo payload reutiliza llave; payload distinto crea otra; intentos mayores de 24 horas rotan la llave.

## 10. Estado ambiguo de red

Timeout, red y `ECOMMERCE_ORDER_CREATE_FAILED` conservan llave, carrito y datos del formulario. El usuario puede reintentar sin perder información.

## 11. Payload frontend

Solo se envían slug, customer normalizado, items `{ productId, quantity }` y llave idempotente. No se envían precios, totales, stock, license ID ni portal ID.

## 12. Matriz de errores

Los errores públicos permanecen normalizados y no exponen mensajes internos de PostgREST o PostgreSQL.

## 13. Formulario

Se creó una única fábrica:

```js
const createEmptyForm = (portal) => ({
  name: '',
  phone: '',
  fulfillmentMethod: getInitialFulfillmentMethod(portal),
  address: '',
  notes: '',
});
```

Se usa para inicializar y limpiar el formulario después de éxito y cuando cambia `portal.slug`. Los errores recuperables conservan los datos. Delivery → pickup borra inmediatamente la dirección.

## 14. Confirmación

La confirmación usa `confirmedOrder`, no el formulario. Limpiar PII no elimina código, total, modalidad, fecha ni WhatsApp.

## 15. WhatsApp Click-to-Chat

Continúa requiriendo clic explícito y URL `https://wa.me` validada. No se afirma envío automático.

## 16. Separación respecto al POS

No se modificaron ni conectaron ventas, caja, clientes POS, comandas, inventario operativo, pagos, realtime, notificaciones o bandeja interna.

## 17. Pruebas SQL

Todas las escrituras se ejecutaron con `BEGIN ... ROLLBACK`.

Resultado PASS:

- `p_items = NULL::jsonb` → `ECOMMERCE_EMPTY_CART`, cero órdenes/items/eventos;
- `[]`, `{}`, texto, booleano y número → `ECOMMERCE_EMPTY_CART`;
- exact + `NULL` → `ECOMMERCE_PRODUCT_NOT_AVAILABLE`;
- exact + cero → `ECOMMERCE_PRODUCT_NOT_AVAILABLE`;
- exact 2 + quantity 3 → `ECOMMERCE_STOCK_LIMIT_EXCEEDED`;
- exact 2 + quantity 2 → éxito;
- pickup y delivery válidos;
- delivery sin dirección;
- método inválido;
- duplicado;
- quantity null y decimal;
- producto despublicado y de otro portal;
- pedido mínimo;
- idempotencia sin duplicados.

No quedaron pedidos QA persistentes.

## 18. Pruebas frontend

Resultado PASS en las suites específicas y regresión pública:

- error recuperable conserva nombre, teléfono, dirección y notas;
- error de red conserva carrito y llave;
- éxito limpia PII;
- segundo checkout abre vacío;
- cambio de portal limpia PII y recalcula modalidad;
- delivery → pickup borra dirección;
- confirmación permanece intacta;
- doble clic mantiene una RPC;
- éxito normal e idempotente vacían carrito;
- timeout/red no vacían carrito;
- servicio, idempotencia, carrito paginado, página pública, reglas de producto y routing público continúan pasando.

## 19. Grants

Validación posterior a ECOM.RPC.1.3.2:

- `SECURITY DEFINER=true`;
- `search_path=''`;
- anon/authenticated execute=true;
- public execute=false;
- guardas de carrito SQL NULL y exact NULL presentes;
- grants directos sobre tablas ecommerce: cero filas.

## 20. Lint, tests globales y build

Resultados reproducibles sobre el merge ref del PR:

- ESLint específico de todos los archivos checkout modificados: **PASS**;
- Vitest específico: **PASS**;
- regresión pública completa: **PASS**;
- `npm run build`: **PASS**;
- `package.json`: conserva `"build": "vite build"`;
- `npm run lint`: **FAIL heredado**, 156 errores y 226 warnings fuera del checkout;
- `npm run test:ci`: **FAIL heredado**, 28 archivos y 79 pruebas fallidas fuera del checkout; 69 archivos y 394 pruebas pasan.

Ejemplos de bloqueos heredados:

- `RecipeBuilder.jsx`: errores de reglas React y condición constante;
- scripts/diagnósticos con símbolos no definidos;
- pruebas React sin entorno DOM;
- expectativas desactualizadas en ventas, caja, inventario, backup, navegación y notificaciones.

`main` permanece exactamente en el SHA base `70d1fee8ed620eeca20a746d46d627398e05eb24`, por lo que estos fallos no provienen de cambios nuevos incorporados al merge ref. Corregirlos excede esta mini fase y, en varios casos, violaría la restricción de no modificar ventas, caja, inventario operativo, pagos o backup.

No se excluyeron suites ni se alteró `test:ci` para producir un verde artificial.

## 21. Preview

Vercel volvió a aceptar deployments. El commit `325b128dd0c8ae253ee42d6c30e8dd572ba8debe`, que contiene la implementación correctiva, reportes y validación auxiliar, obtuvo deployment `READY`:

`lanzo-e7u163h0l-fdxrulis-projects.vercel.app`

Después de retirar el workflow temporal se vuelve a comprobar el SHA final. No se dejaron pedidos reales persistentes.

## 22. Riesgos residuales

1. El snapshot ecommerce se valida, pero no se reserva.
2. El negocio debe confirmar manualmente el pedido.
3. Click-to-Chat no envía automáticamente.
4. La línea base global debe sanearse en una fase separada antes de poder afirmar `npm run lint` y `npm run test:ci` verdes.

## Corrección ECOM.CHECKOUT.1.1

### 1. Pedido vacío por `p_items=NULL`

La validación previa dependía de `jsonb_typeof(p_items) <> 'array'`. Con SQL NULL, la expresión producía NULL y no entraba al `IF`.

### 2. Semántica SQL de comparaciones con NULL

SQL usa lógica de tres valores. `NULL <> 'array'` y `NULL <= 0` producen NULL, no `true`.

### 3. Corrección de carrito

Se comprueba `p_items IS NULL`, tipo array y `coalesce(v_items_count, 0) <= 0` antes de insertar.

### 4. Stock exacto con snapshot nulo

Para `exact`, snapshot nulo equivale a cero y se rechaza como no disponible.

### 5. Diferencia entre catálogo y checkout anterior

El catálogo ya presentaba exact+NULL como agotado; la RPC no. ECOM.RPC.1.3.2 elimina la discrepancia.

### 6. Tercera migración

`20260710141000_ecom_rpc_1_3_2_null_cart_exact_stock.sql` conserva firma, default, rate limit, idempotencia, hardening, seguridad y grants.

### 7. Pruebas SQL

Matrices obligatorias y de regresión: PASS con rollback.

### 8. Limpieza de PII

PII se limpia solo después de éxito o cambio real de portal; no ante errores recuperables.

### 9. Prueba de segundo pedido

Un segundo checkout en la misma pestaña abre vacío y con modalidad inicial recalculada.

### 10. Regresión de idempotencia

Mismo payload, retry, timeout, red, éxito e idempotent success continúan con la semántica acordada.

### 11. Lint

Específico: PASS. Global: bloqueado por 156 errores heredados fuera de alcance.

### 12. Tests

Específicos y regresión pública: PASS. `test:ci` global: bloqueado por 79 fallos heredados fuera de alcance.

### 13. Build

Producción: PASS con `vite build`.

### 14. Deployment

Preview correctivo: READY. El head final se verifica después de retirar el workflow auxiliar.

## Integración posterior ECOM.ORDERS.1

ECOM.ORDERS.1 consume el contrato público de checkout sin modificar su semántica:

- `ecommerce_create_order` continúa creando una sola orden, sus items y un único evento `order_created` dentro de la transacción pública;
- la notificación PRO se conecta después del evento `order_created`, cuando los items y totales ya existen;
- la creación de notificación es deduplicada por `ecommerce_order_created:<order_id>`;
- un retry idempotente del checkout conserva una orden y una notificación;
- FREE crea el pedido pero no genera filas ecommerce en `pos_notifications`;
- ningún fallo interno de notificación revierte o expone errores al checkout;
- la bandeja administrativa consulta y muta pedidos únicamente mediante RPCs autenticadas;
- aceptar o rechazar no crea ventas, comandas, clientes POS, pagos, caja, movimientos de inventario ni reservas de stock;
- el pedido controlado `EC-00000010` no fue modificado ni recibió notificación retroactiva durante la implementación.

La validación detallada queda documentada en:

- `reports/ecom_rpc_2_order_management_report.md`;
- `reports/ecom_fe_orders_1_inbox_report.md`;
- `reports/ecom_notif_1_order_notifications_report.md`.

## Estado de cierre

- Implementación ECOM.RPC.1.3.2: terminada y validada en SQL.
- Implementación ECOM.FE.CHECKOUT.1.1: terminada y validada en frontend.
- Etiquetas formales `ECOM.RPC.1.3.2 PASS` y `ECOM.FE.CHECKOUT.1.1 PASS`: **no declaradas**, porque los criterios exigen `npm run lint` y `npm run test:ci` globales verdes y la línea base actual no los cumple.

## Corrección posterior ECOM.ORDERS.1.1

La mini fase corrigió exclusivamente permisos frontend, aislamiento de requests, pruebas y limpieza del PR de la bandeja administrativa. No modificó el checkout público, su RPC, idempotencia, carrito, stock, órdenes reales ni migraciones aplicadas. Las regresiones `PublicCheckoutDialog`, `PublicStoreCheckout`, `PublicStorePage`, `ecommercePublicService` y `ecommerceCheckoutIdempotency` permanecen en PASS.
