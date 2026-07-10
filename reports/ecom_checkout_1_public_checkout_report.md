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

También se consultaron las definiciones reales de:

- `private.ecommerce_public_error(text)`;
- `private.ecommerce_order_public_jsonb(public.ecommerce_orders)`;
- `private.ecommerce_build_whatsapp_message(...)`;
- `private.ecommerce_build_whatsapp_url(text,text)`;
- `private.ecommerce_enforce_create_order_rate_limit(uuid,uuid)`.

La implementación partió de la definición instalada para conservar el adaptador de rate limit de ECOM.RPC.1.2.

## 2. Problemas de integridad detectados

El RPC instalado presentaba estos bordes:

1. un método desconocido podía convertirse implícitamente en `pickup`;
2. delivery aceptaba dirección vacía;
3. el mismo producto podía repetirse en líneas separadas;
4. cantidades decimales no eran rechazadas de forma explícita;
5. no se revalidaba el límite del snapshot `exact` ni el agotamiento `status`;
6. una cantidad ausente/null terminaba en error genérico en vez de `ECOMMERCE_INVALID_QUANTITY`.

## 3. Migración aplicada

Se aplicaron de forma controlada y se versionaron:

- `supabase/migrations/20260710120000_ecom_rpc_1_3_checkout_integrity.sql`;
- `supabase/migrations/20260710133000_ecom_rpc_1_3_1_quantity_null_guard.sql`.

La segunda es una corrección idempotente que parte de la definición instalada y no edita la migración ya aplicada. No se ejecutaron `db push`, `migration repair`, drops, truncates ni deletes.

## 4. Dirección obligatoria

PostgreSQL acepta únicamente `pickup` o `delivery`.

Para delivery:

- normaliza y limita dirección a 500 caracteres;
- exige al menos 5 caracteres útiles;
- devuelve `ECOMMERCE_DELIVERY_ADDRESS_REQUIRED` si falta.

Para pickup:

- no exige dirección;
- guarda `customer_address = null`;
- descarta cualquier dirección residual enviada por el formulario.

## 5. Productos duplicados

Cada `productId` se convierte a UUID y se agrega a un conjunto lógico dentro del RPC. Si el UUID ya apareció, se devuelve `ECOMMERCE_DUPLICATE_PRODUCT`. No se suman silenciosamente líneas repetidas.

## 6. Cantidades enteras

El RPC exige:

- cantidad presente;
- valor numérico finito;
- `quantity > 0`;
- `quantity = trunc(quantity)`;
- `quantity <= portal.max_item_quantity`.

Cero, negativos, decimales, texto, NaN, infinidades y null se rechazan con `ECOMMERCE_INVALID_QUANTITY`.

## 7. Stock status/exact

La creación vuelve a leer `ecommerce_published_products`.

- `hidden`: no expone ni infiere cantidad; depende de `is_available`.
- `status`: snapshot menor o igual a cero devuelve `ECOMMERCE_PRODUCT_NOT_AVAILABLE`.
- `exact`: snapshot menor o igual a cero devuelve no disponible; una cantidad superior a `floor(stock_snapshot)` devuelve `ECOMMERCE_STOCK_LIMIT_EXCEEDED`.

No se descuenta ni reserva inventario.

## 8. Idempotencia

Se conserva la unicidad por `portal_id + idempotency_key`. Una repetición devuelve el mismo pedido con `success=true` e `idempotent=true`, sin insertar una segunda orden, items ni evento `order_created`.

## 9. Estrategia de retry

El frontend genera `web-<uuid>` con criptografía segura y calcula SHA-256 sobre:

- slug normalizado;
- cliente normalizado;
- items ordenados por `productId`;
- cantidades.

Mismo payload durante menos de 24 horas reutiliza llave. Cambiar cliente, carrito o modalidad genera una llave nueva.

## 10. Estado ambiguo de red

Timeout, error de red y `ECOMMERCE_ORDER_CREATE_FAILED` conservan la llave y el carrito. El retry vuelve a consultar la RPC con el mismo intento, permitiendo recuperar un pedido insertado cuya respuesta se perdió.

## 11. Payload frontend

`createPublicOrder` usa exclusivamente:

```js
client.rpc('ecommerce_create_order', {
  p_slug,
  p_customer,
  p_items: [{ productId, quantity }],
  p_idempotency_key,
});
```

No envía precio, nombre de producto, subtotal, total, stock, currency, license ID ni portal ID.

## 12. Matriz de errores

El servicio mapea mensajes seguros para:

- ordering deshabilitado;
- datos obligatorios del cliente;
- modalidad/dirección;
- métodos no disponibles;
- carrito vacío o excedido;
- duplicados;
- producto no encontrado/no disponible;
- cantidad y stock;
- mínimo;
- idempotencia;
- rate limit y límite diario;
- error ambiguo, timeout y red.

Nunca presenta `error.message` crudo de PostgREST.

## 13. Formulario

Se implementó `PublicCheckoutDialog` con:

- nombre, teléfono, modalidad, dirección y notas;
- límites 120/40/500/1000;
- `autocomplete` e `inputMode` apropiados;
- pickup o delivery preseleccionado cuando es el único método;
- pickup inicial cuando existen ambos;
- validación local de nombre, teléfono, dirección, carrito, mínimo y cantidades;
- copy de privacidad;
- estado responsive y accesible.

## 14. Confirmación

`PublicOrderConfirmation` muestra:

- “Pedido enviado”;
- “Pendiente de confirmación del negocio”;
- código público;
- total confirmado por servidor;
- modalidad;
- fecha/hora;
- estado pendiente.

No presenta el UUID como identificador principal ni afirma aceptación, preparación, pago o compra completada.

## 15. WhatsApp Click-to-Chat

La URL se acepta únicamente cuando:

- protocolo `https:`;
- host exacto `wa.me`;
- sin credenciales ni puerto.

El botón aparece solo con `features.whatsappCheckout=true` y URL válida. Usa `target="_blank"` y `rel="noopener noreferrer"`. Nunca se abre automáticamente ni se afirma que el mensaje fue enviado.

## 16. Separación respecto al POS

El checkout público no usa estado privado del POS ni crea:

- ventas;
- pagos POS;
- movimientos de caja;
- movimientos de inventario;
- clientes POS;
- comandas.

Los triggers actuales de tablas ecommerce son de guardas/timestamps y no conectan con venta o caja.

## 17. Pruebas SQL

La matriz se ejecutó dentro de `BEGIN ISOLATION LEVEL REPEATABLE READ` y terminó en `ROLLBACK`.

Resultado: **PASS** para pickup válido, dirección nula en pickup, repetición idempotente, delivery sin dirección, método inválido, duplicado, decimal, null, stock exacto insuficiente, status agotado, producto de otro portal, despublicado, mínimo y portal sin pedidos.

También se compararon contadores POS antes/después dentro de la transacción: sin cambios.

## 18. Pruebas frontend

Se agregaron suites para:

- contrato y errores del servicio;
- URL WhatsApp;
- hash/llave/expiración/crypto;
- formulario y modalidades;
- doble envío;
- retry con misma llave;
- limpieza o conservación del carrito;
- confirmación;
- gating de checkout;
- catálogo desactualizado.

La matriz específica incluyó las suites públicas existentes de carrito, página, reglas de producto y routing. Resultado final:

- ESLint específico: **PASS**;
- 8 archivos de prueba específicos/públicos: **PASS**;
- 61 pruebas específicas/públicas: **PASS**;
- restauración de carrito con catálogo mayor de 100 productos: **PASS**;
- doble clic: una sola llamada: **PASS**;
- timeout/error de red conserva carrito y llave: **PASS**;
- éxito normal e idempotente vacían carrito: **PASS**.

La primera ejecución instrumentada detectó dos aserciones ambiguas de las pruebas; se corrigieron sin cambiar lógica productiva y la repetición completa quedó verde.

## 19. Grants

Validación ejecutada:

- `ecommerce_create_order`: `SECURITY DEFINER=true`, `search_path=''`, anon/authenticated execute=true, public=false;
- helpers privados: anon/authenticated/public execute=false;
- grants directos sobre tablas `ecommerce_%` para anon/authenticated/public: **0 filas**.

## 20. Build

Resultados sobre el merge ref del PR:

- `npm run lint`: **PASS**;
- `npm run test:ci`: **PASS**;
- `npm run build`: **PASS**;
- build específico de checkout y regresión pública: **PASS**.

El workflow temporal usado para sustituir el bloqueo de cuota de Vercel fue retirado. `package.json` quedó nuevamente con el build estándar:

```json
"build": "vite build"
```

## 21. Preview

Vercel creó previews de la rama durante la implementación. Al intentar publicar el head final, la integración respondió `build-rate-limit` por cuota temporal del proyecto; por ello la validación definitiva se ejecutó en GitHub Actions sobre el merge ref del PR.

No se creó ningún pedido persistente para preview. La interacción completa quedó cubierta con mocks y la matriz SQL con rollback. El pedido real controlado queda reservado para el smoke posterior al merge.

## 22. Riesgos residuales

1. El snapshot ecommerce puede cambiar inmediatamente después de crear el pedido; esta fase valida pero no reserva stock.
2. El negocio todavía debe confirmar manualmente el pedido.
3. Click-to-Chat abre la conversación, no envía el mensaje.
4. No existe todavía bandeja interna, realtime, conversión a venta/comanda ni pagos.
5. El alias de preview final puede tardar en actualizarse mientras Vercel mantenga su cuota temporal de builds.
6. El smoke con pedido persistente real queda deliberadamente posterior al merge.

## Estado de cierre

- `ECOM.RPC.1.3 PASS`.
- `ECOM.FE.CHECKOUT.1 PASS`.
- PR #84 listo para revisión y sin merge automático.
