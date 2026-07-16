# FASE ECOM.PRODUCTS.PUBLIC.1 — Variantes, extras y configuración pública

Fecha: 2026-07-15/16 (America/Mexico_City)  
Repositorio: `fdxruli/Lanzo-POS`  
Proyecto Supabase: `odlrhijtfyavryeqivaa`  
Rama: `fase-ecom-products-public-1`  
Base: `main` en `5c9945c31b0c80e8b266e3bec22bf561ac4c1386`

## 1. Resumen ejecutivo

Se implementó la selección pública de variantes, grupos, opciones y extras, con precio estimado en cliente y autoridad completa en Supabase. El checkout conserva compatibilidad con productos simples, valida configuraciones por portal/licencia, agrega demanda de stock por producto o variante, guarda un snapshot inmutable en `ecommerce_order_items.options` y mantiene la recuperación idempotente antes de cualquier validación mutable.

La implementación funcional y las matrices SQL transaccionales fueron validadas. La validación npm global continúa pendiente porque el entorno de ejecución no pudo resolver GitHub para obtener un checkout instalable; no se declara PASS de Vitest, ESLint ni builds.

## 2. Estado heredado

El PR #98 de `ECOM.PRODUCTS.MODEL.1` estaba mergeado antes de iniciar. `main` contenía el modelo `simple`, `recipe`, `variant_parent`, `configurable`, las tablas normalizadas de variantes/grupos/opciones, `availability_source`, sincronización manual/Pro, snapshot e idempotencia de configuración. Las migraciones MODEL.1 también figuraban en el historial remoto.

## 3. Alcance

Incluye contrato público de detalle, selector mobile-first, variantes concretas, grupos `single`/`multiple`, `required`, `minSelect`, `maxSelect`, precio dinámico, identidad configurable del carrito, edición, payload mínimo, validación server-side, snapshot, WhatsApp, caché por revisión/versión, pruebas SQL y JavaScript.

## 4. Fuera de alcance

No se implementaron descuentos reales de inventario o ingredientes, lotes durante conversión POS, comandas configurables, impresión de cocina, conversión definitiva a venta POS, personalización Pro, entrega, pagos online, programación, mapas, conductores, SEO avanzado ni múltiples sucursales.

## 5. Arquitectura pública

El catálogo conserva un resumen ligero de configuración. El detalle pesado se obtiene bajo demanda mediante una RPC dedicada. El selector se carga con `React.lazy`, descarga la configuración una vez, valida localmente para UX y el servidor revalida todo durante checkout.

## 6. RPC de detalle

Se creó `public.ecommerce_get_product_configuration(text, uuid)`. Resuelve el portal por slug, exige portal y producto publicados, aísla por portal/licencia, aplica rate limit, omite hijos eliminados, ordena variantes/grupos/opciones y aplica la visibilidad de stock del plan.

## 7. Contrato seguro

Expone identificadores públicos, nombres, valores de atributos, semántica de precio, imagen, disponibilidad y orden. No expone `source_product_id`, `local_product_ref`, ingredientes, cantidades de receta, `license_id`, costos, tokens, dispositivos, staff ni metadata privada.

## 8. Producto simple

El payload legacy `{ productId, quantity }` continúa aceptado. No requiere variante, selecciones ni `configurationRevision`; el precio sigue leyéndose del producto publicado.

## 9. Recipe

La disponibilidad publicada derivada continúa siendo autoridad. Varias líneas del mismo producto acumulan demanda antes de comparar capacidad. Los grupos opcionales u obligatorios pueden complementar el producto sin modificar inventario en esta fase.

## 10. Variant parent

La variante concreta es obligatoria. El servidor verifica pertenencia al producto, portal y licencia, estado activo y disponibilidad. Color y talla no se tratan como inventarios independientes.

## 11. Configurable

Los grupos se validan por contrato normalizado. `requires_configuration` no se elimina ni convierte al padre en producto simple. El padre solo puede comprarse mediante una configuración completa y válida.

## 12. Selector de variantes

La UI deriva ejes desde `optionValues`, muestra valores por atributo, deshabilita combinaciones sin variante disponible, conserva selecciones compatibles, limpia únicamente atributos incompatibles y actualiza imagen, precio y disponibilidad de la variante concreta.

## 13. Selector de opciones

Los grupos `single` usan radio y los `multiple` checkbox. Se respetan `required`, `minSelect`, `maxSelect`, máximo de una opción para `single` y disponibilidad por opción. Los mensajes son públicos y no incluyen códigos internos.

## 14. Precio

El cliente calcula una estimación:

`producto + ajuste de variante + extras = precio unitario`.

El servidor ignora precios, subtotales y totales enviados. Soporta `base`, `delta` y `absolute`, redondea a dos decimales y rechaza resultados negativos.

## 15. Carrito

Cada línea configurable conserva `lineKey`, `productId`, cantidad, variante, selecciones, versión de esquema, revisión de contenido, snapshot visible, precio estimado y máximo aplicable. El formato legacy del carrito sigue admitido.

## 16. Line key

`buildEcommerceConfiguredLineKey` usa únicamente `productId + variantId + optionIds` ordenados canónicamente. No depende de nombres, precios, tiempo, posición del array ni `configurationRevision`.

## 17. Edición

El carrito reabre el selector con la configuración previa. Al guardar reemplaza la línea original y fusiona cantidades cuando la configuración resultante coincide con otra línea existente. Una revisión nueva conserva la identidad de línea, pero reemplaza la revisión obsoleta antes de confirmar.

## 18. Checkout

Se reemplazó de forma compatible `public.ecommerce_create_order(text,jsonb,jsonb,text)`. El servidor reconstruye configuración, precio y snapshot exclusivamente desde tablas publicadas normalizadas.

## 19. Idempotencia

Orden efectivo preservado:

1. Resolver portal.
2. Normalizar clave.
3. Buscar `portal_id + idempotency_key`.
4. Devolver pedido existente.
5. Validar únicamente pedidos nuevos.

La matriz confirmó replay después de cambiar precio y revisión: una orden ya creada vuelve con su mismo ID, total y snapshot.

## 20. Disponibilidad

Se mantiene `availability_source` como contrato. `unverified` falla cerrado; `not_tracked` se permite de forma explícita. Para todo producto, `manual_available=true` es obligatorio. En padres configurables se omite únicamente el `is_available` técnico del padre; la configuración concreta sigue validando variante, opción, fuente y stock.

## 21. Stock agregado

La demanda se acumula por producto y por variante. Dos líneas con extras diferentes no pueden evadir el stock de una misma variante. No se descuenta inventario durante creación del pedido.

## 22. Snapshot

`ecommerce_order_items.options` guarda versión, `configurationVersion`, `configurationRevision`, tipo de configuración, variante, `optionValues`, grupos, opciones y desglose de precio. No contiene referencias de ingredientes, costos ni source refs.

## 23. WhatsApp

El mensaje incluye producto, cantidad, variante, grupos/opciones, precio unitario, subtotal e indicaciones. No incluye UUID ni identificadores internos.

## 24. Free

Free conserva límite vigente de productos y puede usar recetas, variantes, extras y checkout configurable. La RPC devuelve estado seguro, pero oculta cantidad exacta de stock.

## 25. Pro

Pro conserva sincronización cloud y visibilidad de stock conforme a la feature vigente. No se añadió paywall a configuración ni se alteraron precios o límites.

## 26. Caché

El detalle se cachea por slug, producto, `catalogRevision` y `configurationVersion`; la entrada también conserva `configurationRevision` y se invalida cuando la revisión de contenido cambia. Se deduplican solicitudes concurrentes y se eliminan revisiones/versiones obsoletas. El esquema del caché de catálogo permanece en versión 2 para no interpretar páginas antiguas sin resumen como productos simples.

## 27. Offline

Puede mostrarse catálogo y detalle guardado. No se permite confirmar pedidos sin conexión. `offlineCatalog` se propaga desde el estado React, incluso cuando `navigator.onLine` todavía indique `true`.

## 28. Accesibilidad

El selector usa diálogo modal, `fieldset`/`legend`, radio/checkbox, `aria-invalid`, `aria-describedby`, foco al primer error, Escape, focus trap, botones nombrados y textos explícitos de disponibilidad.

## 29. Seguridad

Las funciones son `SECURITY DEFINER` con `SET search_path = ''`. Los esquemas se califican. Las tablas no se conceden directamente. Los helpers privados se revocan a `PUBLIC`, `anon` y `authenticated`; la RPC pública y el checkout conservan grants intencionales.

## 30. Migraciones iniciales de PUBLIC.1

Se crearon y aplicaron:

- `20260716012251_ecom_products_public_1.sql`
- `20260716012935_ecom_products_public_1_parent_gate_fix.sql`

### Rectificación documental

La afirmación anterior de que MODEL.1 “forzaba `manual_available=false`” era incorrecta. El defecto real estaba en la función de disponibilidad creada por PUBLIC.1: al tratar un padre configurable, omitía indebidamente `manual_available` junto con el gate técnico de `is_available`. La corrección PUBLIC.1.1 separa ambas dimensiones: `manual_available` vuelve a ser siempre autoritativo y solamente se omite el `is_available` técnico del padre cuando `requires_configuration=true`.

## 31. Historial remoto inicial

Las dos versiones iniciales aparecen en el historial remoto de Supabase. Se verificaron definiciones efectivas, owner `postgres`, `SECURITY DEFINER`, `search_path=''` y ACL.

## 32. Pruebas SQL iniciales

`supabase/tests/ecom_products_public_1_test.sql` contiene `BEGIN/ROLLBACK` y una matriz de controles de privacidad, Free/Pro, grupos, variantes cruzadas, opciones cruzadas, precio manipulado, delta/absolute, snapshot, WhatsApp, stock agregado, replay idempotente, delivery, compatibilidad simple y ausencia de efectos POS.

## 33. Pruebas JavaScript iniciales

Se añadieron suites para utilidades, caché, servicio, modal y carrito. Cubren normalización, combinaciones, required/min/max, precios, lineKey, payload mínimo, deduplicación, retry seguro, restauración de edición y fusión.

## 34. Builds

- `npm ci`: no ejecutado; el entorno no pudo resolver `github.com` para obtener un checkout instalable.
- `npm run build`: no ejecutado.
- `npm run build:store`: no ejecutado.
- `npm run build:store:vercel`: no ejecutado.

No se usa Vercel como sustituto de estas validaciones.

## 35. ESLint

ESLint enfocado y global no se ejecutaron por falta de instalación del workspace. No se añadieron `eslint-disable`, `.skip`, `.todo`, snapshots gigantes ni timeouts artificiales.

## 36. Git

La rama nació del HEAD exacto de `main`: `5c9945c31b0c80e8b266e3bec22bf561ac4c1386`. Todas las escrituras se dirigieron a `fase-ecom-products-public-1`. No hubo escritura directa en `main`.

## 37. PR

PR #99 con base `main` y head `fase-ecom-products-public-1`. Continúa abierto, draft, sin merge y no se marcó ready.

## 38. Vercel

No hubo deployment manual, redeploy, promoción de alias, cambios de proyecto, dominios, variables, Root Directory, build command u output. No se creó preview deliberado.

## 39. Riesgos generales

1. Queda pendiente ejecutar instalación, Vitest, ESLint y los tres builds dentro de un checkout con dependencias.
2. ECOM.PRODUCTS.POS.1 deberá interpretar el snapshot para conversión, lotes, comandas e inventario; no debe asumir todavía descuento de extras.
3. La prueba manual debe incluir productos de QA creados específicamente para esta fase, nunca pedidos de clientes.

## 40. Pruebas manuales base

| # | Caso | Resultado esperado |
|---:|---|---|
| 1 | Producto simple | Agrega directo y checkout legacy funciona |
| 2 | Hamburguesa recipe | Disponibilidad deriva de receta |
| 3 | Hamburguesa con extra | Extra cambia precio y snapshot |
| 4 | Grupo obligatorio | Botón bloqueado y mensaje público |
| 5 | Producto con talla | Variante concreta seleccionada |
| 6 | Color y talla | Combinaciones inválidas deshabilitadas |
| 7 | Variante agotada | No seleccionable; checkout rechaza cambio tardío |
| 8 | Opción agotada | No seleccionable; checkout rechaza cambio tardío |
| 9 | Dos configuraciones | Permanecen como líneas distintas |
| 10 | Editar línea | Restaura y reemplaza sin fantasma |
| 11 | Reintentar checkout | Mantiene clave si el payload no cambió |
| 12 | Pedido idempotente | Devuelve el pedido original |
| 13 | Free | Configura sin cantidad exacta visible |
| 14 | Pro | Respeta visibilidad vigente |
| 15 | Móvil | Drawer casi completo y CTA fijo |
| 16 | Escritorio | Modal centrado y usable por teclado |
| 17 | Offline | Solo lectura; no confirma pedido |
| 18 | WhatsApp | Incluye variante, opciones e indicaciones |

# ECOM.PRODUCTS.PUBLIC.1.1 — Bloqueantes de disponibilidad, revisión y rate limit

## 41. Estado heredado de la corrección

HEAD inicial revisado de la rama: `56e1d30001493af29c1451802db12f35438bd4c8`.  
HEAD de `main`: `5c9945c31b0c80e8b266e3bec22bf561ac4c1386`.

Se conservaron selector, grupos, opciones, precio server-side, lineKey, edición, snapshot, WhatsApp, compatibilidad simple, caché e idempotencia. No se inició ECOM.PRODUCTS.POS.1 ni personalización Pro.

## 42. Bloqueante `manual_available`

### Comportamiento anterior

`private.ecommerce_product_publicly_available` permitía que un padre configurable con variante disponible apareciera disponible aunque el negocio hubiera establecido `manual_available=false`.

### Regla final

1. Producto eliminado o no publicado: bloqueado.
2. `manual_available=false`: bloqueado siempre.
3. Producto no configurable: exige `is_available=true`.
4. Producto configurable: puede omitir únicamente el `is_available` técnico del padre.
5. Padre con variantes: exige al menos una variante pública válida.
6. Producto sin variantes: aplica `availability_source`, `source_available` y stock.

El checkout repite el gate autoritativo de `manual_available` antes de validar una configuración nueva.

## 43. `configurationVersion` y `configurationRevision`

`configurationVersion` conserva su significado original: versión del esquema de datos.  
`configurationRevision` representa el contenido público concreto revisado por el cliente.

La revisión se calcula mediante `SHA-256` hexadecimal canónico en:

`private.ecommerce_product_configuration_revision(uuid)`.

### Campos incluidos

Producto:

- id público;
- nombre y descripción públicos;
- imagen pública;
- tipo y versión de configuración;
- precio y moneda;
- flags de variantes, grupos y configuración requerida;
- fuente de disponibilidad;
- disponibilidad manual, de fuente, técnica y pública;
- modo de stock.

Variantes activas, con `ORDER BY` explícito:

- id;
- nombre público;
- `optionValues`;
- `priceMode`;
- `priceValue`;
- imagen;
- estados de disponibilidad;
- modo de stock;
- orden visual.

Grupos y opciones activos, con `ORDER BY` explícito:

- ids;
- nombres públicos;
- tipo de selección;
- required/min/max;
- `priceDelta`;
- estados de disponibilidad;
- orden visual.

### Campos excluidos

- `source_product_id`;
- `local_product_ref`;
- `source_ingredient_id`;
- cantidades de receta;
- costos;
- license keys;
- datos de staff;
- tokens;
- cantidad exacta volátil de stock.

Cambiar stock exacto de 20 a 19 sin cambio de estado público no modifica la revisión.

## 44. RPC, carrito y payload

La RPC de detalle devuelve:

- `product.configurationVersion`;
- `product.configurationRevision`.

La línea configurable conserva ambos valores en memoria, `sessionStorage` y `configurationSnapshot`.

El payload mínimo configurado contiene:

```json
{
  "productId": "...",
  "quantity": 1,
  "variantId": "...",
  "selections": [],
  "configurationVersion": 1,
  "configurationRevision": "<sha256>"
}
```

No envía precios, nombres, total, snapshot, costos, stock ni source IDs.

`configurationRevision` no forma parte de `lineKey`. Una revisión nueva mantiene la identidad de selección, pero reemplaza el estado obsoleto antes de confirmar.

## 45. Checkout e idempotencia

Para productos con variantes, grupos o configuración requerida, el checkout exige una revisión válida de 64 caracteres y la compara con el hash vigente antes de validar variante, opciones, precio y stock.

Falta o diferencia devuelve:

`ECOMMERCE_CONFIGURATION_CHANGED`.

El snapshot server-side guarda la revisión vigente. La firma del intento de checkout incorpora variante, selecciones, versión de esquema y revisión de contenido:

- mismo payload: reutiliza idempotency key;
- revisión nueva: genera una key nueva;
- pedido ya creado con key anterior: replay devuelve el pedido original antes de toda validación mutable.

## 46. Rate limit anterior

El bucket anterior era:

`public-store-product:<portal_id>:<product_id>`

con 120 solicitudes compartidas por todos los visitantes del producto.

## 47. Señal confiable e identidad privada

Se inspeccionó el mecanismo existente del proyecto que lee `current_setting('request.headers', true)` y normaliza, en orden:

1. `cf-connecting-ip`;
2. `x-real-ip`;
3. primer valor de `x-forwarded-for`.

La sesión administrativa del conector no incluye cabeceras de una petición pública real; el contrato se validó de forma transaccional mediante `set_config('request.headers', ..., true)`. La implementación reutiliza la convención ya instalada para cabeceras de proxy y no acepta UUID, localStorage, user-agent, query params ni fingerprints enviados por el navegador como autoridad.

La IP se normaliza como `inet` y se convierte en identidad mediante HMAC-SHA256 con:

- dirección normalizada;
- portal;
- producto;
- secreto privado generado en la base.

El secreto se almacena en `private.ecommerce_public_rate_limit_secret`, tiene 32 bytes, no está en el repositorio ni en JavaScript y no concede `SELECT` ni siquiera a `service_role`.

## 48. Límites finales

### Individual

- bucket HMAC por cliente, portal y producto;
- 60 solicitudes por 10 minutos;
- bloqueo de 15 minutos.

### Global

- bucket por portal y producto;
- 1200 solicitudes por 10 minutos;
- bloqueo de 15 minutos.

La respuesta pública no identifica qué nivel bloqueó ni devuelve hashes.

## 49. Privacidad del rate limit

Las pruebas confirmaron:

- misma señal produce hash estable;
- clientes distintos producen hashes distintos;
- producto o portal distinto produce hash distinto;
- no se persiste IP literal;
- no se persiste el header completo;
- metadata contiene únicamente fase, fuente y nivel;
- helpers privados no son ejecutables por `anon` ni `authenticated`.

## 50. Contexto React

`PublicStorePage` pasa explícitamente a `PublicCatalog`:

```jsx
catalogRevision={catalogRevision}
offline={offlineCatalog}
maxItemQuantity={portal.maxItemQuantity}
```

`PublicCatalog` dejó de consultar `.public-store-shell` y dejó de usar `navigator.onLine` como vía principal. El estado React es la fuente autoritativa. El selector recibe la revisión actual, respeta el máximo real del portal y trata un catálogo de caché como offline aunque el navegador reporte conexión.

## 51. Migraciones correctivas

Se crearon y aplicaron, sin editar las dos migraciones previas:

- `20260716045221_ecom_products_public_1_availability_revision_fix.sql`;
- `20260716045242_ecom_products_public_1_checkout_revision_fix.sql`;
- `20260716045301_ecom_products_public_1_rate_limit_isolation.sql`.

Los filenames locales coinciden con las versiones remotas.

## 52. Seguridad efectiva

Verificado después de aplicar:

- owner `postgres`;
- `SECURITY DEFINER`;
- `search_path=''`;
- helpers privados: ACL `postgres` y `service_role`;
- RPC públicas: `anon`, `authenticated`, `service_role`;
- tabla de secreto: ACL exclusiva de `postgres`;
- una fila singleton de secreto de 32 bytes;
- cero acceso directo a variantes, grupos, opciones, hashes o rate limits.

## 53. Pruebas SQL PUBLIC.1.1

Se añadió `supabase/tests/ecom_products_public_1_1_blockers_test.sql`, íntegramente dentro de `BEGIN/ROLLBACK`.

La matriz remota ejecutada cubrió:

- manual false en padre configurable;
- detalle público no disponible;
- checkout bloqueado;
- manual true con gate técnico y variante válida;
- revisión estable;
- cambios de precio de variante, `priceDelta` y grupo;
- stock 20→19 sin invalidación;
- revisión ausente y obsoleta;
- revisión vigente;
- snapshot con revisión;
- precio manipulado ignorado;
- simple legacy;
- replay idempotente antiguo;
- clientes A/B separados;
- A bloqueado no bloquea B;
- límite global;
- separación por producto/portal;
- privacidad de IP;
- ausencia de ventas, caja e inventario.

Resultado: PASS.  
Después del rollback: 0 licencias, 0 portales, 0 productos, 0 pedidos, 0 partidas y 0 filas de rate limit sintéticas.

## 54. Pruebas JavaScript PUBLIC.1.1

Se añadieron:

- `src/services/ecommerce/__tests__/ecommercePublicRevision.test.js`;
- `src/hooks/ecommerce/__tests__/usePublicCart.configurationRevision.test.jsx`;
- `src/pages/__tests__/PublicStorePage.configurationContext.test.jsx`.

Cubren normalización, lineKey independiente de revisión, snapshot, payload mínimo, productos simples, servicio público, persistencia, restauración, edición, firma idempotente y propagación explícita de contexto.

No se declaran PASS porque Vitest no pudo ejecutarse sin workspace instalado.

## 55. ESLint y builds de PUBLIC.1.1

Pendientes por la misma limitación de entorno:

- ESLint enfocado;
- `npm run lint`;
- Vitest dirigido;
- `npm run test:ci`;
- `npm run build`;
- `npm run build:store`;
- `npm run build:store:vercel`.

Error de conectividad observado:

`fatal: unable to access 'https://github.com/fdxruli/Lanzo-POS.git/': Could not resolve host: github.com`

## 56. Vercel PUBLIC.1.1

- deployments manuales: 0;
- previews deliberados: 0;
- promociones: 0;
- cambios de configuración: 0.

## 57. Archivos de la corrección

### Modificados

- `src/pages/PublicStorePage.jsx`;
- `src/components/ecommerce/public/PublicCatalog.jsx`;
- `src/hooks/ecommerce/usePublicCart.js`;
- `src/services/ecommerce/ecommercePublicService.js`;
- `src/services/ecommerce/ecommercePublicConfigurationCache.js`;
- `src/services/ecommerce/ecommerceCheckoutIdempotency.js`;
- `src/utils/ecommerceConfiguredProduct.js`;
- `docs/reports/ECOM.PRODUCTS.PUBLIC.1.md`.

### Creados

- tres migraciones correctivas;
- una matriz SQL PUBLIC.1.1;
- tres suites JavaScript PUBLIC.1.1.

## 58. Riesgos residuales

1. Falta ejecutar Vitest, ESLint y los tres builds en un checkout con dependencias.
2. La presencia exacta de cada header de proxy en una petición pública real debe observarse durante QA de infraestructura; la sesión administrativa no los expone.
3. La conversión POS, consumo de ingredientes, lotes, comandas e impresión siguen fuera de alcance.
4. El PR debe permanecer draft hasta una revisión independiente y validación local completa.

## 59. Estado del PR

PR #99 continúa abierto, draft, base `main`, head `fase-ecom-products-public-1`, sin merge y sin marcar ready automáticamente.

## 60. Conclusión

- `manual_available` vuelve a ser autoritativo para todo producto;
- el gate técnico del padre configurable omite únicamente `is_available`;
- `configurationVersion` mantiene significado de esquema;
- existe `configurationRevision` real de contenido;
- el cliente conserva y envía la revisión;
- el checkout exige y guarda la revisión;
- el replay idempotente conserva el orden crítico;
- un visitante ya no consume el límite individual de otro;
- existe un límite global mayor contra abuso distribuido;
- no se almacena IP ni secreto en el repositorio;
- `PublicStorePage` propaga el contexto correcto;
- el código está implementado y el backend está validado con rollback;
- la validación local npm, ESLint y builds continúa pendiente.

Estado de la fase correctiva:

**IMPLEMENTACIÓN COMPLETA — VALIDACIÓN LOCAL PENDIENTE**

No se inició ECOM.PRODUCTS.POS.1. No se inició personalización Pro. El PR permanece draft para revisión.
