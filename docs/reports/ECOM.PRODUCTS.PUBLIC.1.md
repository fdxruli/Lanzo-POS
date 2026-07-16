# FASE ECOM.PRODUCTS.PUBLIC.1 — Variantes, extras y configuración pública

Fecha: 2026-07-15/16 (America/Mexico_City)  
Repositorio: `fdxruli/Lanzo-POS`  
Proyecto Supabase: `odlrhijtfyavryeqivaa`  
Rama: `fase-ecom-products-public-1`  
Base: `main` en `5c9945c31b0c80e8b266e3bec22bf561ac4c1386`

## 1. Resumen ejecutivo

Se implementó la selección pública de variantes, grupos, opciones y extras, con precio estimado en cliente y autoridad completa en Supabase. El checkout conserva compatibilidad con productos simples, valida configuraciones por portal/licencia, agrega demanda de stock por producto o variante, guarda un snapshot inmutable en `ecommerce_order_items.options` y mantiene la recuperación idempotente antes de cualquier validación mutable.

La implementación funcional y la matriz SQL transaccional fueron validadas. La validación npm global queda pendiente porque el entorno de ejecución no pudo resolver GitHub para instalar dependencias; no se declara PASS de builds ni de ESLint global.

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

El payload legacy `{ productId, quantity }` continúa aceptado. No requiere variante ni selecciones y el precio sigue leyéndose del producto publicado.

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

Cada línea configurable conserva `lineKey`, `productId`, cantidad, variante, selecciones, versión, snapshot visible, precio estimado y máximo aplicable. El formato legacy del carrito sigue admitido.

## 16. Line key

`buildEcommerceConfiguredLineKey` usa `productId + variantId + optionIds` ordenados canónicamente. No depende de nombres, precios, tiempo ni posición del array.

## 17. Edición

El carrito reabre el selector con la configuración previa. Al guardar reemplaza la línea original y fusiona cantidades cuando la configuración resultante coincide con otra línea existente.

## 18. Checkout

Se reemplazó de forma compatible `public.ecommerce_create_order(text,jsonb,jsonb,text)`. El servidor reconstruye configuración, precio y snapshot exclusivamente desde tablas publicadas normalizadas.

## 19. Idempotencia

Orden efectivo preservado:

1. Resolver portal.
2. Normalizar clave.
3. Buscar `portal_id + idempotency_key`.
4. Devolver pedido existente.
5. Validar únicamente pedidos nuevos.

La matriz confirmó replay después de desactivar variante/opción, cambiar precio y cerrar pedidos.

## 20. Disponibilidad

Se mantiene `availability_source` como contrato. `unverified` falla cerrado; `not_tracked` se permite de forma explícita. Los productos configurables evitan el bloqueo temporal heredado del padre, pero sus variantes y opciones concretas siguen siendo autoridad.

## 21. Stock agregado

La demanda se acumula por producto y por variante. Dos líneas con extras diferentes no pueden evadir el stock de una misma variante. No se descuenta inventario durante creación del pedido.

## 22. Snapshot

`ecommerce_order_items.options` guarda versión, tipo de configuración, variante, `optionValues`, grupos, opciones y desglose de precio. No contiene referencias de ingredientes, costos ni source refs.

## 23. WhatsApp

El mensaje incluye producto, cantidad, variante, grupos/opciones, precio unitario, subtotal e indicaciones. No incluye UUID ni identificadores internos.

## 24. Free

Free conserva límite vigente de productos y puede usar recetas, variantes, extras y checkout configurable. La RPC devuelve estado seguro, pero oculta cantidad exacta de stock.

## 25. Pro

Pro conserva sincronización cloud y visibilidad de stock conforme a la feature vigente. No se añadió paywall a configuración ni se alteraron precios o límites.

## 26. Caché

El detalle se cachea por slug, producto, `catalogRevision` y `configurationVersion`. Se deduplican solicitudes concurrentes y se eliminan revisiones/versiones obsoletas. El esquema del caché de catálogo subió a versión 2 para no interpretar páginas antiguas sin resumen como productos simples.

## 27. Offline

Puede mostrarse catálogo y detalle guardado. No se permite confirmar pedidos sin conexión y se conserva el mensaje offline actual.

## 28. Accesibilidad

El selector usa diálogo modal, `fieldset`/`legend`, radio/checkbox, `aria-invalid`, `aria-describedby`, foco al primer error, Escape, focus trap, botones nombrados y textos explícitos de disponibilidad.

## 29. Seguridad

Las funciones son `SECURITY DEFINER` con `SET search_path = ''`. Los esquemas se califican. Las tablas no se conceden directamente. Los helpers privados se revocan a `PUBLIC`, `anon` y `authenticated`; la RPC pública y el checkout conservan grants intencionales.

## 30. Migración

Se crearon dos migraciones compensatorias nuevas sin editar MODEL.1:

- `20260716012251_ecom_products_public_1.sql`
- `20260716012935_ecom_products_public_1_parent_gate_fix.sql`

La segunda corrige el único bloqueo detectado después de la primera: MODEL.1 forzaba `manual_available=false` en el padre temporalmente bloqueado. PUBLIC.1 omite ese gate únicamente para el padre que exige configuración; no omite disponibilidad de variante/opción.

## 31. Historial remoto

Ambas versiones aparecen en el historial remoto de Supabase. Se verificaron definiciones efectivas, owner `postgres`, `SECURITY DEFINER`, `search_path=''` y ACL.

## 32. Pruebas SQL

`supabase/tests/ecom_products_public_1_test.sql` contiene `BEGIN/ROLLBACK` y una matriz de 50 controles: privacidad, Free/Pro, grupos, variantes cruzadas, opciones cruzadas, precio manipulado, delta/absolute, snapshot, WhatsApp, stock agregado, replay idempotente, delivery, compatibilidad simple y ausencia de efectos POS.

Una matriz funcional equivalente fue ejecutada directamente contra Supabase y terminó correctamente con `ROLLBACK`.

## 33. Pruebas JavaScript

Se añadieron cinco suites para utilidades, caché, servicio, modal y carrito. Cubren normalización, combinaciones, required/min/max, precios, lineKey, payload mínimo, deduplicación, retry seguro, restauración de edición, fusión y eliminación por cambio de versión.

## 34. Builds

- `npm ci`: no ejecutado; el entorno no pudo resolver GitHub para obtener el repositorio/dependencias.
- `npm run build`: no ejecutado.
- `npm run build:store`: no ejecutado.
- `npm run build:store:vercel`: no ejecutado.
- Validación de sintaxis JS/JSX: PASS mediante `node --check` y parser TypeScript local.

## 35. ESLint

ESLint enfocado y global no se ejecutaron por falta de instalación del workspace. No se añadieron `eslint-disable`, `.skip`, `.todo` ni timeouts artificiales.

## 36. Git

La rama nació del HEAD exacto de `main`: `5c9945c31b0c80e8b266e3bec22bf561ac4c1386`. Todas las escrituras se dirigieron a `fase-ecom-products-public-1`. No hubo escritura directa en `main`.

## 37. PR

PR draft nuevo con base `main` y head `fase-ecom-products-public-1`. No se reutilizó #98, no se marcó ready y no se mergeó. El número se registra al crear el PR.

## 38. Vercel

No hubo deployment manual, redeploy, promoción de alias, cambios de proyecto, dominios, variables, Root Directory, build command u output. No se creó preview deliberado.

## 39. Archivos

Creados: utilidades, caché de configuración, modal y estilos, cinco suites JavaScript, dos migraciones, prueba SQL y este reporte. Modificados: catálogo público, carrito, drawer, servicio público y caché de catálogo.

## 40. Riesgos

1. Queda pendiente ejecutar instalación, tests, ESLint y los tres builds dentro de un checkout con dependencias.
2. ECOM.PRODUCTS.POS.1 deberá interpretar el snapshot para conversión, lotes, comandas e inventario; no debe asumir todavía descuento de extras.
3. La prueba manual debe incluir productos reales de QA creados específicamente para esta fase, nunca pedidos de clientes.

## 41. Pruebas manuales

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
| 11 | Reintentar checkout | Mantiene clave del intento |
| 12 | Pedido idempotente | Devuelve el pedido original |
| 13 | Free | Configura sin cantidad exacta visible |
| 14 | Pro | Respeta visibilidad vigente |
| 15 | Móvil | Drawer casi completo y CTA fijo |
| 16 | Escritorio | Modal centrado y usable por teclado |
| 17 | Offline | Solo lectura; no confirma pedido |
| 18 | WhatsApp | Incluye variante, opciones e indicaciones |

## 42. Conclusión

Las variantes y extras pueden seleccionarse y editarse. El servidor conserva autoridad de precio, pertenencia, disponibilidad y stock. La idempotencia mantiene el orden crítico. Los productos simples conservan compatibilidad. La implementación queda en PR draft para revisión independiente y validación npm completa. No se inició ECOM.PRODUCTS.POS.1 ni personalización Pro.

## Matriz de producto

| Producto | Selección requerida | Fuente de precio | Fuente de disponibilidad |
|---|---|---|---|
| Simple | No | Producto | Directa |
| Recipe | No, salvo grupos | Producto + extras | Receta |
| Variant parent | Variante | Variante | Variante agregada |
| Configurable | Según grupos | Producto + extras | Producto o receta |
| Variante + extras | Variante y grupos | Variante + extras | Variante |

## Autoridad cliente/servidor

| Acción | Cliente | Servidor |
|---|---|---|
| Mostrar precio | Estimación | — |
| Confirmar precio | — | Autoridad |
| Validar grupos | UX | Autoridad |
| Validar variante | UX | Autoridad |
| Validar stock | Estado | Autoridad |
| Guardar snapshot | — | Autoridad |
| Descontar inventario | No | Fuera de alcance |

## Conteo

| Recurso | Cantidad |
|---|---:|
| Migraciones creadas | 2 |
| Migraciones aplicadas | 2 |
| RPC creadas/modificadas | 2 públicas; 5 helpers privados |
| Componentes creados | 1 modal + estilos |
| Tests SQL | 1 archivo / 50 controles |
| Tests JavaScript | 5 archivos |
| Pedidos residuales | 0 |
| Ventas residuales | 0 |
| Movimientos residuales | 0 |
| Deployments manuales | 0 |
| Previews deliberados | 0 |
