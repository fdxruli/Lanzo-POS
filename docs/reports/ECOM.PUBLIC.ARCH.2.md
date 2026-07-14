## 1. Resumen ejecutivo

ECOM.PUBLIC.ARCH.2 queda **COMPLETA** en la copia local `C:\dev\Lanzo-POS-main`. La paridad funcional de las rutas públicas quedó demostrada contra `dist` y `dist-store` con fixtures sintéticos, Chrome DevTools Protocol (CDP), red externa bloqueada y todas las RPC públicas interceptadas antes de la red.

Los siete fallos heredados quedaron resueltos. La batería pública dirigida terminó con 16 archivos y 102/102 tests PASS, sin `.skip`, `.todo` ni tests pendientes. Ambos builds pasan, el build público conserva exactamente las métricas de ARCH.1 y la auditoría final registra cero assets 404, cero errores de consola, cero excepciones, cero recursos administrativos solicitados y cero pedidos reales.

`npm run lint` no pasa por deuda previa fuera del alcance: 382 hallazgos globales (158 errores y 224 warnings). El lint dirigido de todos los archivos creados o modificados sí pasa. No se alteraron los archivos ajenos señalados por el lint global.

## 2. Alcance

Se validaron tienda, portal PRO/FREE, catálogo, paginación, búsqueda, categorías, carrito, revisión, reconciliación, Dexie, offline, pickup, delivery, idempotencia, tracking, landing, fallback público, assets, responsive y accesibilidad esencial.

Los únicos ajustes de producción fueron en el HTML administrativo compartido: referencia explícita al favicon existente y eliminación del bloqueo de zoom que también afectaba a rutas públicas. El resto son correcciones de tests, fixtures y auditorías locales opt-in. No se iniciaron PWA.1, deploy, dominio, cutover ni optimizaciones generales.

## 3. Restricciones cumplidas

- Trabajo exclusivamente local; `.git` continúa ausente.
- Cero comandos Git/GitHub y cero metadata Git creada.
- Cero despliegues o cambios en Vercel; `vercel.json` no se modificó.
- Cero cambios, escrituras o consultas a datos remotos de Supabase.
- Cero RPC reales de creación, aceptación, rechazo, cobro, inventario o tracking.
- Cero pedidos reales; los intentos de checkout del auditor fueron interceptados localmente.
- Cero cambios de firmas RPC, precios, mínimos, límites, idempotencia, estados o reglas de fulfillment.
- Cero cambios al manifest, Service Worker administrativo, scope, precache o configuración PWA.
- Cero dependencias agregadas o actualizadas; `package.json` permanece sin cambios.
- Cero flags de mock en producción; fixtures e interceptores viven sólo en tests/scripts.

## 4. Estado inicial

La línea base se registró el 13 de julio de 2026 a las 19:50:15, zona `Central Standard Time (Mexico)` / `America/Mexico_City`.

| Señal inicial | Resultado |
|---|---:|
| Directorio | `C:\dev\Lanzo-POS-main` |
| `.git` | Ausente |
| Node | v22.12.0 |
| npm | 10.9.0 |
| `dist` | 76 archivos; 6,340,653 B |
| `dist-store` | 9 archivos; 722,887 B |
| JS `dist-store` | 663,757 B |
| CSS `dist-store` | 57,675 B |
| Entry `dist-store` | 87,471 B |
| `npm run build` | PASS |
| `npm run build:store` | PASS |
| Auditoría estática `dist` | PASS de lectura |
| Auditoría estática `dist-store` | PASS; cero violaciones |
| Batería pública preexistente | 82 PASS, 7 FAIL, 89 total |

Los siete fallos iniciales fueron exactamente: cuatro de tracking por matchers jest-dom, uno de copy de landing, uno de restauración de segunda página y uno de privacidad por substring numérico.

## 5. Metodología de paridad

La comparación usa señales semánticas, no snapshots completos: encabezados, productos, categorías, precios, disponibilidad, carrito, checkout, tracking, requests lógicas, IndexedDB, sessionStorage, manifest, Service Worker, viewport, overflow, controles accesibles y recursos cargados.

`scripts/audit-public-parity.mjs` inicia ambos previews, abre un perfil efímero de Chrome/Edge por target, acepta únicamente orígenes loopback, bloquea DNS no loopback e intercepta `OPTIONS`/`POST` de las RPC con CDP Fetch. Las URLs de fixture externas también se interceptan. Al finalizar cierra navegador, elimina el perfil temporal y detiene previews.

La herramienta `agent-browser` no estaba instalada en el entorno; se utilizó el fallback permitido de Chrome/Edge local mediante CDP, sin instalar paquetes.

## 6. Fixtures utilizados

`scripts/fixtures/public-parity-fixtures.mjs` contiene exclusivamente datos sintéticos marcados como fixtures:

- portal PRO activo/publicado, pickup y delivery, mínimo 50, stock exacto, horarios, branding, MXN y `America/Mexico_City`;
- portal FREE con personalización básica, delivery deshabilitado, stock oculto y límites menores;
- dos páginas, dos revisiones y productos con precio decimal, máximo, agotado, sin imagen, imagen interceptada y reconciliación;
- slugs ausente, inactivo, no publicado, inválido, rate limited y offline sin caché;
- seis modos de error de checkout;
- nueve estados reales soportados de tracking: `received`, `accepted`, `preparing`, `ready`, `out_for_delivery`, `completed`, `cancelled`, `attention` y `rejected`;
- tracking no encontrado, token inválido, red y respuesta malformada.

No se inventó un estado separado para “visto” porque el contrato actual no lo expone. No hay nombres, teléfonos, direcciones, pedidos, tokens ni secretos reales. Los fixtures no entraron a `dist-store`, cuya huella quedó idéntica a ARCH.1.

## 7. Comparación dist frente a dist-store

| Función | dist administrativo | dist-store | Paridad |
|---|---|---|---|
| Tienda inicial | PASS | PASS | Sí |
| Catálogo | PASS | PASS | Sí |
| Paginación | PASS | PASS | Sí |
| Búsqueda | PASS | PASS | Sí |
| Categorías | PASS | PASS | Sí |
| Carrito | PASS | PASS | Sí |
| Revisión nueva | PASS | PASS | Sí |
| Offline | PASS | PASS | Sí |
| Pickup | PASS | PASS | Sí |
| Delivery | PASS | PASS | Sí |
| Idempotencia | PASS | PASS | Sí |
| Tracking | PASS | PASS | Sí |
| Landing | PASS | PASS | Sí |
| Ruta desconocida | PASS | PASS | Sí |

Las diferencias esperadas se conservan: `dist` incluye manifest, SW y chunks administrativos; `dist-store` usa HTML/entry públicos, no registra SW y no contiene chunks administrativos. Durante las rutas públicas auditadas de `dist` no se solicitó ningún recurso administrativo.

## 8. Tienda pública

Ambos previews muestran identidad “Tienda Fixture PRO”, primera página de cuatro productos, precios MXN, categorías y stock exacto. El producto agotado permanece deshabilitado y el portal FREE oculta stock.

El escenario inicial confirmó shell administrativo ausente, imágenes correctas o fallback seguro, cero controles visibles sin nombre accesible y cero errores no controlados. Portal ausente, inactivo, no publicado, inválido y rate limited producen estados públicos controlados.

## 9. Catálogo y paginación

La primera página usa offset 0/limit 100 y la segunda offset 100. “Postre Fixture” se agrega al final, sin duplicados y preservando orden. Las categorías no se pierden y el carrito no se corrompe.

Las pruebas cubren stock exacto/oculto, cantidad cero, producto inexistente en una página posterior, error de catálogo, reintento, respuesta inválida, red y cambio de revisión. El fixture de segunda página del test heredado se redujo a un elemento representativo, conservando la semántica de paginación y eliminando renderizado artificial de 100 tarjetas.

## 10. Búsqueda y categorías

La búsqueda por “Taco Fixture” deja un resultado; una búsqueda inexistente muestra el estado vacío controlado. Limpiar búsqueda restaura el catálogo. El filtro “Bebidas” muestra únicamente “Agua Fixture” y regresar a “Todas” restaura los productos.

El mismo comportamiento y los mismos nombres se observaron en ambos builds.

## 11. Carrito

Se validaron agregar, aumentar, reducir, máximo de stock, subtotal decimal de 79.80 MXN, persistencia tras navegación/recarga, Escape para cerrar el panel y aislamiento por slug. El carrito PRO de dos unidades no aparece al navegar al portal FREE.

Los tests de hook cubren además eliminación, persistencia, producto realmente ausente, reconciliación y agotamiento de paginación. Un producto no disponible no queda habilitado para compra.

## 12. Revisión y reconciliación

Con revisión A se agregó “Reconciliar Fixture”. Al cambiar el fixture a revisión B y disparar revalidación por foco, el producto cambió de 55.50 a 59.50, pasó a no disponible, se cargaron páginas B y el carrito incompatible quedó vacío.

No se reutilizaron páginas de A para B y no quedó checkout abierto con datos incompatibles. Las pruebas de caché verifican limpieza/aislamiento por revisión.

## 13. Caché Dexie

Ambos targets crearon `lanzo-public-store-cache`. La visita repetida conservó IndexedDB, realizó una llamada lógica al portal y cero llamadas de catálogo para páginas compatibles cacheadas.

Se mantienen `pages`, `portals`, `catalogRevision`, offset/limit, schemaVersion, fresh TTL de 300 s, max stale de 86,400 s, máximo de 12 tiendas y máximo de 240 páginas. No se modificó el contrato productivo de caché.

## 14. Offline

Con caché compatible se mostraron cuatro productos y señal explícita de desconexión; checkout quedó bloqueado y no hubo invocación de orden. Sin caché, la tienda mostró “No se pudo cargar la tienda”, sin POS, checkout ni loading infinito.

La simulación mantiene loopback disponible para recargar el preview, pero hace fallar las RPC externas interceptadas y expone `navigator.onLine=false`. Así se prueba el comportamiento offline sin contactar servicios remotos.

## 15. Checkout pickup

Pickup no exige dirección. Nombre y teléfono fixture se normalizaron localmente y el payload interceptado sólo incluyó fulfillment e items admitidos; no incluyó precios/totales manipulables.

El primer intento simuló red fallida y conservó formulario, carrito e idempotency key. El reintento devolvió confirmación sintética “Pedido enviado”. Ninguna llamada llegó a Supabase.

## 16. Checkout delivery

Delivery mostró el campo de dirección y bloqueó localmente una dirección vacía/corta sin ejecutar RPC. Con “Calle Delivery Fixture 123” se interceptó un payload con `fulfillmentMethod=delivery` y dirección presente.

El diálogo permaneció abierto, usable y sin overflow a 375×812, 768×1024 y 1440×900. Los totales visibles provinieron de las reglas actuales; no se cambió cálculo alguno.

## 17. Idempotencia

El intento con fallo de red y el reintento exitoso reutilizaron la misma clave local. Dos clics consecutivos durante una promesa activa produjeron una sola solicitud adicional: dos llamadas interceptadas en total para la secuencia red+éxito, no tres.

Las claves, tokens y datos personales se sanitizan en la salida del auditor. La respuesta idempotente simulada conserva la orden del servidor y limpia el carrito como el éxito normal.

## 18. Tracking público

Los nueve estados soportados se renderizaron con etiquetas actuales: Pedido recibido, Pedido aceptado, En preparación, Listo, En camino, Completado, Cancelado, Requiere atención y Rechazado.

También pasaron no encontrado, token inválido, fallo de red, respuesta malformada, privacidad y polling/actualización. Tracking permaneció legible y sin overflow en los tres viewports. Las respuestas públicas no incluyeron checkout privado, dirección, correo ni teléfono privado completo.

## 19. Landing pública

`/conoce-lanzo?tienda=fixture-pro` mostró el copy vigente “Todo lo que necesitas para vender, controlar y crecer.” y un enlace de retorno a `/tienda/fixture-pro`.

La landing no montó shell POS y no presentó overflow horizontal en 375×812, 768×1024 ni 1440×900.

## 20. Ruta desconocida

El fallback público compartido se validó con `/tienda?arch2=fallback`: ambos builds mostraron “Esta tienda no está disponible” y no montaron shell administrativo.

Se eligió la ruta pública incompleta que ambos entries reconocen. Una ruta raíz arbitraria sigue perteneciendo deliberadamente a la aplicación administrativa de `dist`, por lo que no se alteró ese despacho. Query params, trailing slash y rutas profundas están cubiertos por routing tests y previews.

## 21. Assets y publicDir false

`publicDir` continúa en `false` para el build público. La auditoría estática extrae referencias locales de HTML y `url(...)` CSS, valida su existencia y reporta cero faltantes en ambos artefactos.

Se añadió al HTML administrativo la referencia explícita `/logIcon.svg`, eliminando el 404 implícito de `/favicon.ico`. `PublicSafeImage` quedó cubierto para URL HTTPS válida, URL inválida/privada (`file:`, `data:`, `javascript:`), error de carga, fallback y ausencia de URL visible.

Navegación final: 0 assets locales 404, 0 imágenes rotas, 0 errores de carga y 0 warnings de consola. `dist-store` contiene únicamente su SVG hasheado y assets públicos generados.

## 22. Responsive y accesibilidad

Los viewports 375×812, 768×1024 y 1440×900 pasaron para tienda, checkout, tracking y landing, sin overflow horizontal. Botones e inputs visibles tienen nombre/label accesible y Escape cierra el carrito.

Una pulsación Tab real enviada por CDP dejó un control en `:focus-visible` con outline/sombra visible. Se eliminó de `index.html` el bloqueo `maximum-scale=1, user-scalable=no`; tanto el HTML administrativo compartido como el HTML público permiten zoom. No se rediseñaron estilos.

## 23. Corrección de los siete tests heredados

| Suite | Antes | Después | Resultado |
|---|---:|---:|---|
| Tracking jest-dom | 4 fallos | 4/4 PASS | Matchers globales Vitest + cleanup explícito |
| Copy landing | 1 fallo | 1/1 PASS | Copy vigente y específico |
| Restauración segunda página | 1 fallo | 1/1 PASS | Fixture paginado mínimo; 1.801 s final |
| Privacidad | 1 fallo | 2/2 PASS | Claves/valores completos, positivo y negativo |
| Total público | 7 fallos heredados | 102/102 PASS | 0 fallos, 0 omitidos, 0 pendientes |

`@testing-library/jest-dom/vitest` se carga desde el setup existente. Tracking añadió cleanup para impedir contaminación DOM. La privacidad detecta teléfono privado completo, checkout, dirección y correo, pero permite el teléfono público ficticio que sólo contiene una subsecuencia coincidente.

## 24. Supabase de solo lectura

No se realizó inspección remota: no existe en la documentación/variables/fixtures un slug remoto de desarrollo inequívocamente autorizado. No se enumeraron tiendas ni datos de terceros.

Toda validación usó fixtures deterministas. CDP interceptó las rutas RPC antes de red; `remoteServicesReached=false`. Se confirman cero lecturas de datos productivos, cero escrituras, cero `service_role` y cero pedidos reales. Una validación remota con slug seguro queda pendiente manual no bloqueante.

## 25. Pruebas automatizadas

La batería dirigida se ejecutó en dos lotes equivalentes porque el proceso monolítico alcanzó el límite externo de 244.1 s sin emitir resultado. Los lotes finalizaron completos:

| Lote | Archivos | Tests | Fallos | Omitidos |
|---|---:|---:|---:|---:|
| Arquitectura/servicios | 7 | 41 PASS | 0 | 0 |
| UI/routing/hooks | 9 | 61 PASS | 0 | 0 |
| Total | 16 | 102 PASS | 0 | 0 |

Comandos principales:

```text
npm exec vitest run -- <7 archivos de arquitectura/servicios> --maxWorkers=2
npm exec vitest run -- <9 archivos de UI/routing/hooks> --maxWorkers=2
npm exec eslint -- <todos los archivos creados/modificados>
```

La búsqueda dirigida confirmó cero `.skip`, cero `.todo` y cero `eslint-disable`. Se agregaron 13 casos: cinco códigos de checkout, cinco variantes de imagen segura y tres contratos de fixtures.

## 26. Auditoría de navegador

Comando final: `node scripts/audit-public-parity.mjs --compact`. Resultado: PASS en 103.579 s.

- 11/11 escenarios PASS por target; 22/22 en total.
- 38 requests RPC lógicas por target, todas interceptadas.
- 3 intentos de orden por target (fallo de red, reintento y delivery), todos locales; 0 remotos.
- 249 requests locales por target; 0 HTTP 404.
- 0 recursos administrativos solicitados en rutas públicas.
- 0 errores de consola, 0 excepciones y 0 errores de intercepción.
- manifest presente sólo en `dist`; 0 registros/control SW en el perfil efímero.
- Dexie `lanzo-public-store-cache` presente en ambos.
- paridad semántica PASS para initial, repeat, catalog, cart, revision, offline, pickup, delivery, tracking, landing y unavailable.

Los comandos exactos de preview también se ejecutaron: rutas profundas y fallback devolvieron HTTP 200 en 4173/4174. Ambos procesos fueron detenidos y ambos puertos quedaron libres.

## 27. Lint

Lint dirigido final: PASS, exit 0. Incluyó setup, tests, fixtures y ambos scripts de auditoría.

`npm run lint`: FAIL en 135.526 s con 382 problemas preexistentes (158 errores, 224 warnings) repartidos por la aplicación administrativa, por ejemplo `RecipeBuilder.jsx`, `RestaurantWizard.jsx`, `useDismissibleHistoryLayer.js`, stores y tests antiguos sin globals. Ninguno pertenece a los archivos creados/modificados por ARCH.2. No se declara PASS global y no se amplió el alcance para corregir deuda ajena.

React Doctor no se repitió, conforme a la instrucción de la fase.

## 28. Builds finales

- `npm run build`: PASS; última ejecución 146.321 s; 76 archivos; 6,340,679 B.
- `npm run build:store`: PASS; última ejecución 42.196 s; 9 archivos; 722,887 B.
- `node scripts/audit-public-delivery.mjs dist`: PASS; cero referencias locales faltantes.
- `node scripts/audit-public-delivery.mjs dist-store`: PASS; cero violaciones y cero referencias locales faltantes.

El build administrativo conserva manifest, SW, Workbox, POS y sus chunks esperados. No se modificó su configuración PWA. El build público conserva entry, router, cliente Supabase mínimo, Dexie, carrito, checkout, tracking y landing independientes.

## 29. Comparación de tamaños

| Métrica | ARCH.1 | ARCH.2 |
|---|---:|---:|
| Archivos dist-store | 9 | 9 |
| Tamaño total | 722,887 B | 722,887 B |
| JavaScript | 663,757 B | 663,757 B |
| CSS | 57,675 B | 57,675 B |
| Entry | 87,471 B | 87,471 B |
| Assets 404 | No medido completo | 0 |
| Chunks administrativos | 0 | 0 |
| Manifest | 0 | 0 |
| Service Worker | 0 | 0 |

El crecimiento público es exactamente 0 B y 0 %. Los fixtures/scripts no entraron al bundle. `dist` cambió de 6,340,653 B a 6,340,679 B (+26 B netos) por favicon explícito y simplificación del meta viewport.

## 30. Hallazgos y correcciones

1. Setup Vitest sin jest-dom efectivo: import global corregido.
2. Contaminación DOM en tracking/routing: cleanup explícito.
3. Copy de landing obsoleto en test: assertion actualizada al copy aprobado.
4. Restauración lenta: fixture de página posterior mínimo y determinista, sin aumentar timeout.
5. Privacidad por substring: detector estructural de claves/valores completos con casos positivos/negativos.
6. Auditoría estática sin verificación de referencias: extracción HTML/CSS y `missingLocalAssets` añadidos.
7. Favicon administrativo implícito ausente: referencia al asset existente.
8. Zoom bloqueado en rutas públicas de `dist`: meta viewport corregido.
9. Falta de auditoría end-to-end: harness CDP con interceptores, sanitización, perfiles efímeros y cierre de procesos.

No se encontró una regresión productiva en reglas de negocio ni fue necesario modificar componentes/servicios de producción.

## 31. Riesgos residuales

- El lint global sigue rojo por deuda previa administrativa; el riesgo está aislado del cambio y el lint dirigido pasa.
- No hubo validación contra un slug remoto porque no existe uno seguro y autorizado; la evidencia es local con fixtures representativos.
- `dist` conserva intencionalmente el SW administrativo antiguo y manifest con scope actual. Su transición pertenece a PWA.1 y no fue tocada.
- La auditoría prueba Chrome/Edge local; no constituye una matriz multi-browser completa.

Ninguno impide la paridad funcional local de ARCH.2.

## 32. Validaciones manuales pendientes

Pendiente no bloqueante: repetir lectura funcional contra un slug demo/desarrollo explícitamente autorizado cuando exista, sin crear pedidos y sin mostrar datos privados.

Pendiente no bloqueante: smoke visual humano en otros motores/navegadores si el equipo mantiene una matriz formal. No quedan validaciones manuales obligatorias para declarar completa esta fase local.

## 33. Rollback local

No ejecutar automáticamente. Para regresar al estado aceptado de ARCH.1 sin Git:

1. Eliminar los archivos nuevos `scripts/audit-public-parity.mjs`, `scripts/fixtures/public-parity-fixtures.mjs`, `src/architecture/__tests__/publicParityFixtures.test.js` y este reporte.
2. En `index.html`, eliminar el link de favicon añadido y restaurar el meta viewport con `maximum-scale=1, user-scalable=no`.
3. En `src/test/setupTestingLibrary.js`, retirar el import de `@testing-library/jest-dom/vitest` agregado por ARCH.2.
4. En `PublicOrderTrackingPage.unpublished.test.jsx` y `publicStoreRouting.test.jsx`, retirar el cleanup/afterEach añadido; en routing restaurar el copy esperado de ARCH.1.
5. En `PublicStorePage.test.jsx`, restaurar el arreglo de 100 productos usado por el test de segunda página.
6. En `ecommercePublicCatalogCache.test.js`, restaurar la comprobación regex anterior y retirar el caso positivo/negativo agregado.
7. En `ecommercePublicService.test.js` y `PublicSafeImage.test.jsx`, retirar los casos nuevos de errores/imágenes.
8. En `scripts/audit-public-delivery.mjs`, retirar la extracción/verificación `assetAudit` agregada.
9. `package.json` no requiere rollback porque no cambió.
10. Regenerar `dist` y `dist-store` desde las fuentes restauradas con `npm run build` y `npm run build:store`; ambos directorios son artefactos regenerables.

La restauración exacta del contenido previo debe hacerse desde la copia/archivo aceptado de ARCH.1, ya que esta copia no contiene historial Git. No se borró ningún archivo del usuario.

## 34. Criterios para iniciar ECOM.PUBLIC.PWA.1

Las condiciones técnicas quedan satisfechas: paridad pública verde, siete fallos cerrados, cero assets rotos, checkout/tracking sin regresiones, ambos builds PASS, caché preservada y `dist-store` sin PWA ni código administrativo.

El riesgo residual arquitectónico relevante es el SW administrativo antiguo y el futuro corte de origen. Por tanto PWA.1 puede planificarse tras revisión humana de este reporte, pero no se inició en esta fase.

## 35. Conclusión

Existe paridad funcional completa y demostrable entre las rutas públicas de `dist` y `dist-store` bajo fixtures locales representativos. Los siete fallos heredados quedaron resueltos sin ocultarlos, aumentar timeouts globales ni debilitar privacidad.

`dist-store` sigue independiente: 9 archivos, 722,887 B, sin manifest, SW, Workbox, App, POS, caja, dashboard, settings, AssistantBot, ScannerModal, charts, workers ni contratos administrativos. No hubo Supabase, Vercel, GitHub, Git, deploy ni fase posterior. ARCH.2 queda lista para revisión.
