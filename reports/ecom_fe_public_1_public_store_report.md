# ECOM.FE.PUBLIC.1 — Ruta pública, catálogo y carrito visual

Fecha de cierre inicial: 2026-07-09  
Corrección ECOM.FE.PUBLIC.1.1: 2026-07-09

## 1. Resultado consolidado

**ECOM.FE.PUBLIC.1.1 PASS — corrección aplicada sin errores nuevos dentro del alcance público.**

La tienda pública continúa aislada del shell POS y utiliza únicamente los contratos RPC autorizados. La mini fase correctiva resolvió dos defectos detectados después de la implementación inicial:

1. La restauración del carrito podía eliminar productos válidos ubicados en páginas posteriores del catálogo.
2. La interfaz podía inferir disponibilidad de stock no confirmada por la RPC.

Resultado final específico:

- ESLint de todos los archivos de la fase y la corrección: **PASS**.
- Vitest específico: **5 archivos / 32 pruebas PASS**.
- Las 32 pruebas públicas también pasan dentro de la corrida global de `test:ci`.
- Vite build de producción: **PASS**.
- Preview final de Vercel con script estándar: **READY**.
- `package.json` y `vercel.json`: sin cambios respecto de `main`.
- Supabase, RPC, migraciones y datos QA/producción: sin cambios.

La suite global del repositorio mantiene fallos heredados ajenos a esta fase; se documentan sin afirmar que la línea base completa esté verde.

## Corrección ECOM.FE.PUBLIC.1.1

### 1. Defecto detectado

La implementación inicial leía el carrito desde `sessionStorage` y lo reconciliaba inmediatamente contra los productos cargados en memoria.

En un catálogo paginado, la primera petición contiene como máximo 100 productos. Si un artículo persistido pertenecía a la página 2 o posterior, todavía no existía en `productMap` y el hook lo trataba como inexistente. El ID era eliminado antes de que la aplicación tuviera oportunidad de consultar la siguiente página.

Por lo tanto, la afirmación original de que la restauración del carrito estaba completamente validada era válida únicamente para productos ya presentes en el catálogo cargado. Esta corrección amplía la validación a catálogos paginados y evita reconciliación destructiva prematura.

### 2. Catálogo parcial frente a catálogo completo

`PublicStorePage.jsx` y `usePublicCart.js` ahora distinguen explícitamente entre:

- **catálogo parcial**: `pagination.hasMore === true`;
- **catálogo agotado**: catálogo listo y `pagination.hasMore === false`.

El hook expone:

- `hasStoredEntries`;
- `pendingProductIds`;
- `isReconciled`.

Mientras existan IDs persistidos no resueltos y el catálogo siga siendo parcial, el hook conserva las entradas originales y no actualiza destructivamente `sessionStorage`.

La depuración final solo ocurre cuando:

- todos los IDs persistidos fueron encontrados; o
- se agotaron todas las páginas disponibles.

### 3. Resolución automática de IDs en páginas posteriores

La página pública sigue cargando inicialmente:

- `limit = 100`;
- `offset = 0`.

Si el carrito contiene IDs pendientes y `hasMore === true`, la página solicita automáticamente el siguiente offset. Cada página se combina por ID mediante un `Map`, evitando productos duplicados.

El proceso se repite únicamente mientras existan IDs pendientes. Se detiene cuando:

- todos fueron resueltos;
- `hasMore` pasa a `false`;
- el siguiente offset no avanza;
- ocurre un error y se requiere reintento explícito.

Si no existe carrito persistido, no se descargan páginas adicionales automáticamente. El comportamiento permanece:

- primera página;
- botón `Cargar más` para el usuario.

### 4. Protecciones contra loops y resultados tardíos

La carga paginada incluye:

- `requestedOffsetsRef` para no pedir dos veces el mismo offset;
- uso de `offset` y `limit` devueltos por la RPC;
- detención si el siguiente offset es menor o igual al actual;
- detención con `hasMore === false`;
- `requestGenerationRef` para invalidar generaciones anteriores;
- `activeSlugRef` para validar la tienda activa;
- `mountedRef` para ignorar actualizaciones después de desmontar;
- reinicio de offsets y generación al cambiar de slug;
- combinación sin duplicados por ID.

Las respuestas tardías de una tienda anterior no pueden contaminar productos, paginación ni carrito de la tienda nueva.

### 5. Reglas finales de disponibilidad de stock

Se creó el helper puro compartido:

`src/services/ecommerce/ecommercePublicProductRules.js`

Funciones:

- `isPublicProductAvailable(product)`;
- `getPublicProductStockLabel(product)`;
- `getPublicProductExactQuantity(product)`;
- `getPublicProductMaxQuantity(product, portalMaxItemQuantity)`.

`PublicCatalog.jsx` y `usePublicCart.js` usan la misma definición.

#### `stock.mode === "hidden"`

- No muestra estado ni cantidad.
- Ignora `stock.status` y `stock.quantity` para no filtrar información oculta ni inferir inventario.
- El botón obedece únicamente `isAvailable`.

#### `stock.mode === "status"`

- `available`: muestra `Disponible`.
- `out_of_stock`: muestra `Agotado` y deshabilita agregar.
- `null`: no muestra ninguna etiqueta y respeta `isAvailable`.

#### `stock.mode === "exact"`

- cantidad positiva válida: muestra la cantidad exacta.
- cantidad `0`: muestra `Agotado` y deshabilita agregar aunque `status` sea nulo o inconsistente.
- `status === "out_of_stock"`: prevalece incluso si la cantidad recibida es positiva.
- no muestra `0 disponibles` como producto agregable.

No se infiere plan FREE/PRO y no se consulta inventario interno.

### 6. Límite efectivo por stock exacto

El máximo efectivo de cada línea es:

```text
min(portal.maxItemQuantity, floor(product.stock.quantity))
```

cuando el modo es `exact` y existe una cantidad válida.

Este máximo se aplica en:

- restauración desde `sessionStorage`;
- incremento con `+`;
- edición manual;
- atributo `max` del input;
- estado deshabilitado del botón `+`;
- intentos de agregar nuevamente el mismo producto.

El hook muestra un aviso cuando el usuario intenta superar el stock exacto confirmado. Esto no reserva inventario; el dato sigue siendo informativo y deberá revalidarse durante checkout.

### 7. Pruebas nuevas y ampliadas

La corrección agregó o amplió cobertura para:

1. producto persistido en la segunda página;
2. precio actual obtenido desde la página posterior;
3. producto inexistente eliminado solo después de agotar el catálogo;
4. producto agotado en una página posterior;
5. catálogo sin carrito guardado, sin precarga automática;
6. carga manual mediante `Cargar más`;
7. `status: null` sin etiqueta inventada;
8. stock exacto cero deshabilitado;
9. máximo efectivo por stock exacto en restauración, incremento y edición;
10. separación de carrito por slug;
11. respuesta tardía ignorada después de cambiar de slug;
12. stock oculto gobernado únicamente por `isAvailable`;
13. ausencia de llamada a `ecommerce_create_order`.

Resultado específico final:

- `ecommercePublicService.test.js`: 4 pruebas PASS.
- `ecommercePublicProductRules.test.js`: 5 pruebas PASS.
- `usePublicCart.test.jsx`: 6 pruebas PASS.
- `PublicStorePage.test.jsx`: 13 pruebas PASS.
- `publicStoreRouting.test.jsx`: 4 pruebas PASS.

**Total: 5 archivos / 32 pruebas PASS.**

Para estabilizar el escenario real de 100 tarjetas bajo la carga concurrente de la suite global se agregó configuración de pruebas:

- `asyncUtilTimeout: 15_000` para Testing Library;
- `testTimeout: 15_000` para Vitest.

No se relajaron aserciones ni se redujo el tamaño del escenario paginado.

### 8. Lint, test y build de la corrección

#### ESLint específico

**PASS** para todos los archivos públicos, helper, pruebas, configuración de pruebas y `vite.config.js`.

#### Vitest específico

**PASS — 32/32 pruebas.**

#### `npm run lint` global

**FAIL heredado**:

- 34 errores;
- 116 warnings.

Los hallazgos están en stores, utilidades y pruebas anteriores. Ninguno corresponde a los archivos de ECOM.FE.PUBLIC.1.1.

#### `npm run test:ci` global

Resultado actual:

- 91 archivos totales;
- 63 archivos PASS;
- 28 archivos FAIL heredados;
- 425 pruebas totales;
- 346 pruebas PASS;
- 79 pruebas FAIL heredadas.

Las cinco suites públicas y sus 32 pruebas pasan también dentro de esta corrida global. Los fallos restantes pertenecen a módulos anteriores, principalmente entornos jsdom/IndexedDB ausentes y expectativas heredadas de inventario, ventas, backup, settings y navegación.

#### `npm run build`

**PASS**.

Validación específica:

- 3268 módulos transformados;
- build en 20.68 segundos;
- PWA generada.

Build definitivo con script estándar restaurado:

- 3268 módulos transformados;
- build en 22.20 segundos;
- PWA generada;
- solo warnings heredados de chunking y Browserslist.

### 9. Deployment preview final

#### Preview de validación específica

- Deployment: `dpl_AvR4gVhGeHY2FvCUSHtyusm6tjwe`
- URL: `https://lanzo-c4fmsg6nc-fdxrulis-projects.vercel.app`
- Commit: `4ecf91714712d8e20e293aedb86f0177b9756a8c`
- Estado: **READY**
- ESLint específico, 32 pruebas y build ejecutados dentro del deployment.

#### Preview definitivo con script estándar

- Deployment: `dpl_7VtjKiDsHrhLrbS7WaeiwGpW5jnh`
- URL: `https://lanzo-b743k6ykd-fdxrulis-projects.vercel.app`
- Commit: `025178213265b0bd424838974d6bc7e28f649d09`
- Estado: **READY**

`package.json` quedó restaurado a `vite build`. No se dejó instrumentación temporal de validación.

## 2. Arquitectura de la ruta pública

Las rutas `/tienda` y `/tienda/:slug` se detectan antes del bootstrap POS mediante:

- `src/router/isPublicStorePath.js`;
- `src/router/publicStoreRoutes.jsx`;
- `src/router/preparePublicStoreDocument.js`.

La rama pública no importa ni monta `App`. Para las demás rutas, el POS se carga mediante imports dinámicos y conserva su flujo existente.

## 3. Aislamiento del shell y bootstrap POS

La tienda pública no monta:

- `WelcomeModal`;
- `SetupModal`;
- `StaffLoginModal`;
- `NavigationGuard`;
- `PermissionRoute`;
- `Layout`;
- navbar o ticker;
- `useSingleInstance`;
- notificaciones o realtime POS.

Tampoco ejecuta:

- `storageManager.initialize()`;
- Dexie/IndexedDB del POS;
- bootstrap de productos, ventas, caja o clientes;
- sync cloud POS;
- bloqueo de zoom del POS.

## 4. Contratos RPC utilizados

El frontend público utiliza exclusivamente:

- `public.ecommerce_get_portal_by_slug(p_slug text)`;
- `public.ecommerce_get_catalog(p_slug text, p_limit integer, p_offset integer)`.

No usa:

- service role;
- consultas directas a tablas;
- `license_key`;
- `device_fingerprint`;
- `security_token`;
- `useAppStore`;
- Dexie;
- `ecommerce_create_order`.

La búsqueda estática final no encontró `ecommerce_create_order` en los archivos productivos de la fase.

## 5. Funcionalidad pública consolidada

La página incluye:

- encabezado público del negocio;
- horarios y excepciones;
- métodos de entrega activos;
- catálogo responsive;
- imágenes seguras con fallback;
- búsqueda por nombre y descripción;
- filtro por categoría;
- paginación manual controlada;
- restauración paginada bajo demanda;
- carrito visual con `Big.js`;
- cantidades, eliminación y vaciado;
- subtotal y pedido mínimo;
- persistencia por slug en `sessionStorage`;
- estados loading, error, vacío y sin resultados;
- SEO básico y accesibilidad del drawer.

`Continuar pedido` permanece deshabilitado. No existe checkout real ni creación de pedidos.

## 6. Persistencia final del carrito

Clave:

`lanzo:ecommerce:cart:<slug>:v1`

Solo se persisten:

- ID;
- cantidad.

Nunca se persiste ni se confía en el precio. Después de resolver las páginas necesarias, el carrito:

1. usa el producto actual de la RPC;
2. reemplaza cualquier precio previo por el precio actual;
3. elimina artículos realmente inexistentes;
4. elimina artículos no disponibles o agotados;
5. aplica máximo de líneas vigente;
6. aplica máximo efectivo por producto;
7. actualiza `sessionStorage` solamente después de una reconciliación segura.

## 7. Seguridad y privacidad

Confirmado:

- cliente Supabase público dedicado y sin sesión persistente;
- sin service role ni credenciales POS;
- sin tablas directas;
- sin cambios en RLS, grants, RPC o migraciones;
- sin `dangerouslySetInnerHTML`;
- imágenes limitadas a `http`/`https`;
- sin analytics o fingerprinting;
- sin publicación, pausa o modificación de portales QA/producción;
- sin venta, caja, reserva o descuento de inventario.

## 8. Archivos adicionales de la corrección

Creados:

- `src/services/ecommerce/ecommercePublicProductRules.js`;
- `src/services/ecommerce/__tests__/ecommercePublicProductRules.test.js`;
- `src/test/setupTestingLibrary.js`.

Modificados por la corrección:

- `src/pages/PublicStorePage.jsx`;
- `src/hooks/ecommerce/usePublicCart.js`;
- `src/components/ecommerce/public/PublicCatalog.jsx`;
- `src/components/ecommerce/public/PublicCartDrawer.jsx`;
- `src/services/ecommerce/ecommercePublicService.js`;
- pruebas públicas existentes;
- `vite.config.js` para configuración de Vitest.

No se modificaron `vercel.json`, Supabase ni `package.json` en el diff final.

## 9. Riesgos residuales

1. No se ejecutó smoke visual contra un portal QA publicado porque el slug QA conocido sigue pausado y no se modificó producción sin autorización.
2. El preview de Vercel está protegido por SSO hasta el merge/despliegue de producción.
3. El stock exacto sigue siendo informativo y puede cambiar antes del futuro checkout.
4. La línea base global mantiene deuda preexistente de lint y pruebas.
5. El horario continúa siendo informativo y no bloquea el carrito, conforme al alcance original.

## 10. Pendientes para ECOM.FE.CHECKOUT.1

- formulario del cliente;
- método de entrega;
- validación final del mínimo;
- idempotency key;
- llamada segura a `ecommerce_create_order`;
- revalidación final de productos, precios y stock;
- confirmación y número de pedido;
- WhatsApp Click-to-Chat, si se aprueba;
- reglas de horario y pedidos programados;
- pruebas de creación, idempotencia y rate limiting.

## Criterios de aceptación finales

- ✅ producto de página posterior se restaura.
- ✅ precio de página posterior se revalida.
- ✅ producto inexistente se elimina solo al agotar el catálogo.
- ✅ no se descarga todo el catálogo sin carrito pendiente.
- ✅ no se repiten offsets ni existen loops de paginación.
- ✅ cambio de slug ignora respuestas tardías.
- ✅ `status: null` no se presenta como `Disponible`.
- ✅ stock exacto cero se considera agotado.
- ✅ stock oculto respeta únicamente `isAvailable`.
- ✅ stock exacto limita restauración, incremento y edición.
- ✅ no se llama `ecommerce_create_order`.
- ✅ pruebas específicas 32/32 PASS.
- ✅ ESLint específico PASS.
- ✅ build PASS.
- ✅ preview definitivo READY.
- ✅ no se tocó Supabase ni producción.
- ✅ PR no mergeado automáticamente.

**Conclusión: ECOM.FE.PUBLIC.1.1 PASS.**
