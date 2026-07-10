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

El parámetro `p_idempotency_key` conserva `DEFAULT NULL::text`. También se consultaron las definiciones reales de los helpers privados de respuesta, serialización, WhatsApp y rate limit. Todas las correcciones partieron de la definición instalada para conservar el adaptador de ECOM.RPC.1.2 y los hardening acumulados.

## 2. Problemas de integridad detectados

El RPC original presentaba bordes de modalidad, dirección, productos duplicados, cantidades y stock que fueron corregidos por ECOM.RPC.1.3 y ECOM.RPC.1.3.1.

La revisión posterior de ECOM.CHECKOUT.1.1 detectó además:

1. `p_items = NULL::jsonb` podía atravesar comparaciones SQL de tres valores y crear una orden sin artículos cuando el mínimo era cero;
2. `stock_mode='exact'` con `stock_snapshot=NULL` era mostrado como agotado por catálogo, pero la RPC todavía lo aceptaba;
3. el formulario React conservaba nombre, teléfono, dirección y notas después de un pedido exitoso en la misma pestaña.

## 3. Migraciones aplicadas

Se aplicaron de forma controlada y se versionaron:

- `supabase/migrations/20260710120000_ecom_rpc_1_3_checkout_integrity.sql`;
- `supabase/migrations/20260710133000_ecom_rpc_1_3_1_quantity_null_guard.sql`;
- `supabase/migrations/20260710141000_ecom_rpc_1_3_2_null_cart_exact_stock.sql`.

La tercera migración consulta `pg_get_functiondef` y modifica únicamente la función pública instalada. No edita las dos migraciones previas ni reconstruye el RPC desde una versión histórica. No se ejecutaron `db push`, `migration repair`, drops, truncates ni deletes.

## 4. Dirección obligatoria

PostgreSQL acepta únicamente `pickup` o `delivery`. Delivery exige una dirección normalizada de al menos 5 caracteres. Pickup guarda `customer_address = null` y descarta cualquier dirección residual.

## 5. Productos duplicados

Cada `productId` se convierte a UUID y se agrega a un conjunto lógico dentro del RPC. Si el UUID ya apareció, se devuelve `ECOMMERCE_DUPLICATE_PRODUCT`. No se suman silenciosamente líneas repetidas.

## 6. Cantidades enteras

El RPC exige una cantidad presente, finita, entera, mayor que cero y dentro de `portal.max_item_quantity`.

ECOM.RPC.1.3.1 corrigió específicamente `quantity` ausente o `null` dentro de una línea de producto. Esto no era equivalente a `p_items = SQL NULL`; ese segundo caso se detectó y corrigió en ECOM.RPC.1.3.2.

## 7. Stock status/exact

La creación vuelve a leer `ecommerce_published_products`.

- `hidden`: depende únicamente de `is_available` y no revela cantidad.
- `status`: mantiene la semántica contractual previa; solo rechaza snapshot no nulo menor o igual a cero.
- `exact`: `NULL` se interpreta como cero; `NULL` o cero devuelve `ECOMMERCE_PRODUCT_NOT_AVAILABLE`; una cantidad superior a `floor(coalesce(stock_snapshot, 0))` devuelve `ECOMMERCE_STOCK_LIMIT_EXCEEDED`.

No se descuenta ni reserva inventario.

## 8. Idempotencia

Se conserva la unicidad por `portal_id + idempotency_key`. Una repetición devuelve el mismo pedido con `success=true` e `idempotent=true`, sin insertar una segunda orden, items ni evento `order_created`.

## 9. Estrategia de retry

El frontend genera `web-<uuid>` con criptografía segura y calcula SHA-256 sobre slug, cliente normalizado e items ordenados. El mismo payload durante menos de 24 horas reutiliza llave; cambiar cliente, carrito o modalidad genera una llave nueva.

## 10. Estado ambiguo de red

Timeout, error de red y `ECOMMERCE_ORDER_CREATE_FAILED` conservan la llave, el carrito y los datos del formulario. El retry usa el mismo intento y puede recuperar una orden cuya respuesta se perdió.

## 11. Payload frontend

`createPublicOrder` envía exclusivamente slug, customer normalizado, items `{ productId, quantity }` y llave idempotente. No envía precios, nombres, subtotal, total, stock, currency, license ID ni portal ID.

## 12. Matriz de errores

El servicio mapea mensajes seguros para ordering, cliente, modalidad, dirección, carrito, productos, cantidades, stock, mínimo, idempotencia, rate limit, límite diario, timeout y red. Nunca presenta `error.message` crudo de PostgREST.

## 13. Formulario

`PublicCheckoutDialog` incluye nombre, teléfono, modalidad, dirección y notas, con límites, autocompletado, validación UX y copy de privacidad. Delivery muestra dirección; cambiar a pickup la elimina inmediatamente.

## 14. Confirmación

La confirmación depende exclusivamente de `confirmedOrder`, no del estado del formulario. Muestra pedido enviado, estado pendiente, código público, total del servidor, modalidad, fecha y WhatsApp cuando corresponde.

## 15. WhatsApp Click-to-Chat

La URL se acepta solo con protocolo `https:`, host exacto `wa.me`, sin credenciales ni puerto. El botón requiere clic explícito, abre una pestaña nueva y no afirma que el mensaje fue enviado.

## 16. Separación respecto al POS

El checkout público no usa estado privado del POS ni crea ventas, pagos POS, movimientos de caja, movimientos de inventario, clientes POS o comandas. Los triggers ecommerce actuales no conectan con venta o caja.

## 17. Pruebas SQL

Todas las escrituras QA se ejecutaron con `BEGIN ... ROLLBACK`.

ECOM.RPC.1.3.2 validó:

- `p_items = NULL::jsonb` → `ECOMMERCE_EMPTY_CART`, cero órdenes/items/eventos;
- `[]`, `{}`, texto, booleano y número → `ECOMMERCE_EMPTY_CART`;
- exact + snapshot `NULL` → `ECOMMERCE_PRODUCT_NOT_AVAILABLE`;
- exact + cero → `ECOMMERCE_PRODUCT_NOT_AVAILABLE`;
- exact 2 + quantity 3 → `ECOMMERCE_STOCK_LIMIT_EXCEEDED`;
- exact 2 + quantity 2 → éxito con un item y un evento.

La regresión confirmó pickup válido, delivery válido, delivery sin dirección, método inválido, producto duplicado, quantity null, quantity decimal, producto despublicado, producto de otro portal, pedido mínimo e idempotencia sin duplicados.

## 18. Pruebas frontend

Las suites cubren contrato del servicio, URL WhatsApp, hash/llave, formulario, doble envío, retry, carrito, confirmación, gating y catálogo desactualizado.

ECOM.CHECKOUT.1.1 añadió pruebas para:

- conservar nombre, teléfono, dirección y notas ante error recuperable;
- conservar carrito y llave idempotente ante error de red;
- limpiar PII al recibir confirmación;
- mantener código, total, modalidad, fecha y WhatsApp después de limpiar el formulario;
- limpiar PII y recalcular modalidad al cambiar `portal.slug`;
- borrar dirección al pasar de delivery a pickup;
- iniciar un segundo checkout vacío en la misma pestaña.

La validación específica y la regresión pública se ejecutaron sobre el merge ref del PR mediante GitHub Actions.

## 19. Grants

Validación posterior a ECOM.RPC.1.3.2:

- `SECURITY DEFINER=true`;
- `search_path=''`;
- anon/authenticated execute=true;
- public execute=false;
- guardas de carrito nulo y exact nulo presentes en la definición instalada;
- grants directos sobre tablas `ecommerce_%` para anon/authenticated/public: cero filas.

## 20. Build

`package.json` conserva el comando estándar:

```json
"build": "vite build"
```

La validación ejecuta ESLint específico, Vitest específico, regresión pública, `npm run lint`, `npm run test:ci` y `npm run build`. El workflow auxiliar se retira al cerrar la fase.

## 21. Preview

Vercel volvió a aceptar deployments después del bloqueo temporal previo. Se obtuvo un preview `READY` para un commit que contiene la tercera migración, la corrección de PII y las pruebas correctivas. Tras retirar el workflow auxiliar y cerrar documentación se verifica nuevamente que el alias de rama corresponda al head final; el resultado definitivo se registra en la descripción del PR y en el cierre de revisión.

No se crearon pedidos persistentes para preview. La interacción se validó con mocks y las reglas de base de datos con transacciones rollback.

## 22. Riesgos residuales

1. El snapshot ecommerce puede cambiar después de crear el pedido; esta fase valida pero no reserva stock.
2. El negocio todavía debe confirmar manualmente el pedido.
3. Click-to-Chat abre la conversación, no envía el mensaje.
4. No existe todavía bandeja interna, realtime, conversión a venta/comanda ni pagos.
5. El smoke con pedido persistente real queda deliberadamente posterior al merge.

## Corrección ECOM.CHECKOUT.1.1

### 1. Pedido vacío por `p_items=NULL`

La validación previa dependía de `jsonb_typeof(p_items) <> 'array'`. Cuando `p_items` era SQL `NULL`, la expresión no evaluaba a `true`; devolvía `NULL` y el flujo continuaba.

### 2. Semántica SQL de comparaciones con NULL

SQL utiliza lógica de tres valores. Comparaciones como `NULL <> 'array'` y `NULL <= 0` no son verdaderas ni falsas: producen `NULL`, por lo que un bloque `IF` no se ejecuta.

### 3. Corrección de carrito

El RPC ahora comprueba primero `p_items IS NULL`, luego exige tipo array y usa `coalesce(v_items_count, 0) <= 0`. Todo valor nulo, vacío o no-array devuelve `ECOMMERCE_EMPTY_CART` antes de insertar.

### 4. Stock exacto con snapshot nulo

Para `exact`, `coalesce(stock_snapshot, 0)` alinea la RPC con el catálogo: snapshot nulo equivale a agotado. `status`, `hidden` y cualquier modo futuro no fueron redefinidos.

### 5. Diferencia entre catálogo y checkout anterior

El catálogo ya convertía exact+NULL a `out_of_stock` y cantidad cero. El checkout anterior exigía `stock_snapshot IS NOT NULL`, creando una discrepancia explotable mediante llamada directa. La tercera migración elimina esa diferencia.

### 6. Tercera migración

`20260710141000_ecom_rpc_1_3_2_null_cart_exact_stock.sql` parte de la función instalada, reemplaza únicamente `public.ecommerce_create_order` y conserva firma, default, rate limit, idempotencia, hardening, SECURITY DEFINER, search_path y grants.

### 7. Pruebas SQL

Las matrices obligatorias y de regresión terminaron en PASS con rollback. No quedaron pedidos QA persistentes.

### 8. Limpieza de PII

Se centralizó `createEmptyForm(portal)`. Nombre, teléfono, dirección y notas se limpian después de éxito y al cambiar de portal. Los errores recuperables conservan los datos para permitir corrección o retry.

### 9. Prueba de segundo pedido

Después de confirmar y pulsar “Seguir comprando”, un segundo checkout abre con nombre, teléfono, dirección y notas vacíos, y con la modalidad inicial permitida por el portal.

### 10. Regresión de idempotencia

Mismo payload reutiliza llave; payload distinto crea otra; timeout/red conservan llave; éxito elimina intento; doble clic mantiene una RPC; éxito normal o idempotente vacía carrito.

### 11. Lint

ESLint específico de checkout y pruebas pasó. La ejecución global se realiza sobre el mismo merge ref.

### 12. Tests

Pruebas de componente, integración, idempotencia, servicio y regresión pública pasan sobre el código correctivo. Los resultados globales se registran al cierre del workflow.

### 13. Build

El build final usa `vite build`; no se modificó `package.json` ni se dejó runner temporal allí.

### 14. Deployment

Se generó preview Vercel `READY` durante la corrección y se verifica nuevamente el SHA final después de retirar el workflow temporal. No se afirma un head final READY hasta comprobar la coincidencia exacta.

## Estado de cierre

- `ECOM.RPC.1.3 PASS`.
- `ECOM.FE.CHECKOUT.1 PASS`.
- ECOM.RPC.1.3.2 y ECOM.FE.CHECKOUT.1.1 quedan sujetos al cierre verde de lint, tests, build y deployment del head final.
