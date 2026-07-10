# ECOM.FE.ORDERS.1 — Bandeja interna de pedidos ecommerce

Fecha: 2026-07-10  
Repositorio: `fdxruli/Lanzo-POS`  
Rama: `fase-ecom-orders-1`

## Estado del reporte

La bandeja, navegación, capacidad, estado y servicio quedaron implementados y corregidos. ESLint específico, suites de la fase, regresión ecommerce/notificaciones y build estándar pasan. La línea base global no presenta regresiones nuevas respecto de `main`.

## 1. Ruta y guarda

Se agregó la ruta protegida:

```text
/pedidos-online
/pedidos-online?order=<uuid>
```

Archivos principales:

- `src/App.jsx`;
- `src/components/ecommerce/orders/EcommerceOrdersRoute.jsx`;
- `src/pages/EcommerceOrdersPage.jsx`;
- `src/pages/EcommerceOrdersPage.css`.

La guarda local aplica la misma matriz visual que el servidor:

- admin + `ecommerce_order_inbox` → permitido;
- staff + `ecommerce=true` + inbox → permitido;
- staff `ecommerce=true`, `settings=false` → permitido;
- staff `ecommerce=false` → bloqueado;
- inbox deshabilitada → bloqueado.

La seguridad real sigue en las RPCs. Una navegación directa bloqueada no llama al servicio.

## 2. Capacidad operativa

Se creó:

```text
src/services/ecommerce/ecommerceOrderCapabilities.js
```

No usa username, `role_name`, usuario, licencia o plan hardcodeado. Lee features efectivas y permisos del staff actual. No exige `settings` ni `notifications`.

También expone la capacidad realtime, que requiere:

- acceso operativo a la bandeja;
- `ecommerce_realtime_orders=true`;
- topic privado existente.

## 3. Servicio frontend

Se creó:

```text
src/services/ecommerce/ecommerceOrderService.js
```

Características:

- usa `supabaseClient`;
- usa `buildPosSyncAuthContext`;
- no duplica lecturas de tokens desde `localStorage`;
- envía solamente license key, device fingerprint, security token y staff session token o `null`;
- nunca envía license ID, staff user ID, rol, permisos o actor type;
- implementa listado, detalle, visto, aceptación y rechazo;
- limita `p_limit` a 1–100 y `p_offset` a cero o mayor;
- normaliza estrictamente números, strings, items, eventos, timestamps y WhatsApp;
- descarta propiedades desconocidas;
- no propaga mensajes crudos de PostgREST;
- traduce códigos públicos a mensajes de interfaz seguros.

## 4. Estado y cache

Se creó:

```text
src/store/slices/createEcommerceOrderSlice.js
src/store/installEcommerceOrderStore.js
```

Estado incluido:

- lista y counts;
- loading y refreshing separados;
- error;
- filtro y paginación;
- pedido seleccionado;
- loading/error del detalle;
- acción en curso;
- flags stale;
- timestamps de carga;
- identidad de licencia.

TTL implementado:

- lista: 30 segundos;
- resumen/badge: 60 segundos;
- detalle: 15 segundos.

Controles de carga:

- una promesa activa para listado;
- una promesa activa para resumen;
- una promesa por detalle;
- una acción mutadora activa;
- invalidación explícita por realtime;
- refresh en background conserva la lista previa si falla;
- cambio de licencia, pérdida de capacidad o desmontaje limpia lista, detalle y PII.

## 5. Navegación y badge

Se agregó una entrada operativa global:

```text
src/components/ecommerce/orders/EcommerceOrdersNavShortcut.jsx
src/components/ecommerce/orders/EcommerceOrdersNavShortcut.css
```

La entrada:

- se muestra solo a admin autorizado o staff con ecommerce;
- enlaza a `/pedidos-online`;
- presenta el número de pedidos `new`;
- limita visualmente el contador a `99+`;
- funciona en escritorio, tablet y móvil.

El runtime se monta junto al layout principal:

```text
src/components/ecommerce/orders/EcommerceOrdersRuntime.jsx
```

FREE actualiza el resumen:

- al montar una sesión autorizada;
- al recuperar foco;
- al volver de background;
- al abrir la página;
- al pulsar actualizar;
- respetando TTL.

PRO añade invalidación por el canal realtime compartido.

## 6. Resumen y filtros

La página muestra:

- Nuevos;
- Vistos;
- Aceptados;
- Rechazados;
- Pendientes, calculado como `new + seen`.

Filtros:

- Todos;
- Pendientes;
- Nuevos;
- Vistos;
- Aceptados;
- Rechazados.

Cada cambio de filtro fuerza una consulta segura a la RPC y mantiene el orden `created_at desc` recibido del servidor.

## 7. Lista

Cada tarjeta presenta exclusivamente:

- código público;
- fecha y hora;
- nombre;
- modalidad;
- cantidad de artículos;
- total;
- estado;
- indicador Nuevo.

La lista no renderiza teléfono, dirección, notas, metadata o mensaje WhatsApp.

## 8. Detalle

El panel de detalle muestra:

- código;
- estado;
- fecha;
- modalidad;
- nombre, teléfono, dirección y notas;
- items con cantidad, precio unitario y subtotal;
- subtotal, envío, descuento, impuestos y total;
- estado de pago;
- historial sanitizado;
- botón WhatsApp cuando existe una URL `https://wa.me` validada.

WhatsApp requiere clic explícito, abre en una pestaña nueva y no afirma que se haya enviado un mensaje.

## 9. Deep link y visto

Cuando existe `?order=<uuid>`:

1. la guarda valida capacidad local;
2. se valida la forma UUID;
3. el detalle se solicita por RPC;
4. si el estado es `new`, el slice solicita `markEcommerceOrderSeen`;
5. se recarga el detalle definitivo;
6. se elimina el query param mediante navegación replace.

No se confía en el UUID del navegador: el servidor vuelve a validar licencia y visibilidad.

Abrir varias veces no duplica eventos porque la RPC de visto es idempotente.

## 10. Acciones

Para `new` y `seen` se muestran:

- Aceptar pedido;
- Rechazar pedido;
- Abrir WhatsApp, cuando aplica.

Para `accepted` solo se conserva WhatsApp.

No se muestran acciones para:

- Preparando;
- Listo;
- Completar;
- Cancelar;
- Convertir a venta;
- Crear comanda.

Aceptar usa un diálogo propio y explica que no crea venta ni afecta inventario o caja. Rechazar usa un diálogo propio con motivo obligatorio de 3–300 caracteres. No se usa `window.confirm`.

## 11. Realtime y control de requests

El navegador no se suscribe directamente a:

- `ecommerce_orders`;
- `ecommerce_order_items`;
- `ecommerce_order_events`.

Se reutiliza `notificationRealtimeService` y el topic privado existente. Los eventos ecommerce se convierten en un evento interno `lanzo:ecommerce-orders-changed`.

El runtime:

- invalida lista y resumen;
- agrupa ráfagas con debounce de 600 ms;
- refresca el badge siempre;
- refresca la lista solo cuando la página está abierta;
- reutiliza las promesas activas del slice para impedir duplicados.

FREE no inicia realtime ecommerce porque su feature es falsa.

## 12. Responsive y PWA

La interfaz contempla:

- grid de dos columnas en escritorio;
- lista de una columna en tablet y móvil;
- filtros con scroll horizontal controlado;
- detalle lateral en escritorio;
- detalle de ancho completo en móvil;
- acciones sticky y compatibles con `safe-area-inset-bottom`;
- diálogos sin overflow horizontal;
- navegación accesible con teclado y etiquetas ARIA.

## 13. Pruebas añadidas

### Servicio

`src/services/ecommerce/__tests__/ecommerceOrderService.test.js`

Cubre:

- argumentos auth exactos;
- staff token `null` para admin;
- token actual para staff en las mutaciones;
- normalización de listado y detalle;
- descarte de campos desconocidos;
- mapeo de errores seguros;
- ausencia de mensajes crudos de PostgREST.

### Capacidad

`src/services/ecommerce/__tests__/ecommerceOrderCapabilities.test.js`

Cubre admin, staff ecommerce, staff settings=false, staff bloqueado, feature deshabilitada y realtime.

### Slice

`src/store/slices/__tests__/createEcommerceOrderSlice.test.js`

Cubre deduplicación, TTL, invalidación, refresh forzado, conservación de lista previa, limpieza de PII y bloqueo local sin llamada RPC.

### Página

`src/pages/__tests__/EcommerceOrdersPage.test.jsx`

Cubre carga, privacidad de lista, deep link, marcado visto solicitado, filtros, actualización y ausencia de acciones fuera de alcance.

### Guarda

`src/components/ecommerce/orders/__tests__/EcommerceOrdersRoute.test.jsx`

Cubre admin, staff ecommerce con settings/notifications deshabilitados, staff sin ecommerce e inbox deshabilitada.

### Realtime

`src/services/notifications/__tests__/notificationRealtimeService.ecommerce.test.js`

Cubre FREE sin canal, PRO sobre el canal privado existente, transición ecommerce y notificación ecommerce.

## 14. Build y validación

Resultado reproducible de ECOM.ORDERS.1.1:

- ESLint específico de producción y tests modificados: **PASS**;
- 17 suites específicas y de regresión ecommerce/notificaciones: **PASS**, cero suites y pruebas fallidas;
- `npm run build`, conservando `vite build`: **PASS**;
- `npm run lint`: rama y `main` conservan la misma línea base heredada de **156 errores y 226 warnings**;
- `npm run test:ci`: rama **27 archivos / 76 pruebas fallidas**, `main` **28 archivos / 79 pruebas fallidas**;
- la rama aumenta los resultados verdes a 78 archivos y 448 pruebas, frente a 69 archivos y 394 pruebas en `main`;
- no se ocultaron suites, no se usaron `.skip`/`.todo` y no se versionaron logs o exit codes.

El workflow usado para la reproducción fue temporal y se elimina en el mismo commit de cierre.

## 15. Riesgos residuales

1. La navegación se presenta como acceso operativo global junto al layout; debe revisarse visualmente en el preview final para confirmar que no cubra controles en resoluciones particulares.
2. El frontend no convierte pedidos a ventas ni reserva inventario; esa separación es intencional.
3. Un conflicto de transición entre dispositivos se muestra con el error seguro del servidor y posterior refresh; no existe resolución automática fuera del estado definitivo.
4. El cierre formal depende de checks, regresión y preview.

## Corrección ECOM.ORDERS.1.1

### Bootstrap de rol fail-closed

La ausencia de `currentDeviceRole` ya no se interpreta como admin. Durante `_isInitializing=true`, la ruta muestra `Cargando permisos…`; fuera de bootstrap, un rol nulo o desconocido queda bloqueado. El runtime, el acceso directo, la página y el shortcut no llaman RPC ni muestran badge hasta resolver un rol autorizado.

### Aislamiento de respuestas tardías

El slice usa `requestEpoch` y contextos que incluyen identidad de licencia, rol, usuario staff y permiso ecommerce. Listado, resumen, detalle y acciones se deduplican con mapas por licencia/recurso. `resetEcommerceOrdersState` incrementa el epoch, limpia los mapas y elimina inmediatamente lista, conteos, detalle, errores y PII. Una respuesta de una licencia, sesión o permiso anterior devuelve `ECOMMERCE_ORDERS_STALE_RESPONSE` y no puede ejecutar `set`, refrescar la lista ni reabrir un detalle.

Las pruebas diferidas cubren cambio A→B, logout, revocación de ecommerce, detalle con teléfono/dirección y aceptación tardía.

### Pruebas y limpieza

Los mocks que participan en fábricas `vi.mock` usan `vi.hoisted`. Las pruebas React importan `@testing-library/jest-dom/vitest` y ejecutan `cleanup`; realtime elimina listeners, detiene el canal y restaura timers. El diff final no conserva workflows de validación, `.validation`, markers, logs, exit codes o archivos `tmp`.
