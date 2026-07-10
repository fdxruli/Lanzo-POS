# ECOM.FE.ORDERS.1 — Bandeja interna de pedidos ecommerce

Fecha: 2026-07-10  
Repositorio: `fdxruli/Lanzo-POS`  
Rama: `fase-ecom-orders-1`  
PR: `#85`

## Estado

La fase base `ECOM.FE.ORDERS.1` y la corrección `ECOM.ORDERS.1.1` permanecen implementadas. La mini fase `ECOM.ORDERS.1.2` quedó implementada en código y pruebas, pero este reporte **no declara PASS final** porque el entorno actual no dispone de un checkout instalable con las dependencias del proyecto para reproducir ESLint, Vitest y `vite build` completos sobre el head final.

El PR debe permanecer en **draft** hasta ejecutar y registrar esas validaciones locales obligatorias.

## Alcance funcional conservado

La bandeja continúa incluyendo:

- ruta protegida `/pedidos-online` y deep link `?order=<uuid>`;
- acceso para admin autorizado y staff con permiso `ecommerce=true`;
- listado, filtros, resumen, detalle y acciones aceptar/rechazar;
- PII únicamente dentro del detalle autorizado;
- TTL de lista de 30 segundos, resumen de 60 segundos y detalle de 15 segundos;
- invalidación por realtime PRO sobre el canal privado existente;
- aislamiento por licencia, actor, rol y permiso ecommerce;
- limpieza de lista, detalle, errores y PII en reset/logout/downgrade/revocación.

No se agregaron acciones operativas posteriores, conversión a venta, inventario, caja, pagos ni comandas.

## Corrección ECOM.ORDERS.1.1

Se conserva el cierre anterior:

- bootstrap de rol fail-closed;
- rol `null` o desconocido no se interpreta como admin;
- `requestEpoch` invalida respuestas de sesiones, licencias o permisos anteriores;
- mapas de promesas aíslan listado, resumen, detalle y acciones;
- reset elimina lista, conteos, detalle, errores y PII;
- mocks Vitest con `vi.hoisted`;
- `jest-dom`, `cleanup` y limpieza de listeners/timers configurados;
- sin workflows, `.validation`, logs, exit codes, markers o archivos temporales versionados.

Los resultados globales históricos de `ECOM.ORDERS.1.1` no se presentan como una validación nueva del head de `ECOM.ORDERS.1.2`.

## Corrección ECOM.ORDERS.1.2

### 1. Carrera de filtros y paginación

El slice incorpora una intención independiente para la lista:

- `listIntentEpoch`;
- `ecommerceOrdersActiveRequestKey`;
- llave estable por licencia, actor, filtro, límite y offset.

Antes de procesar éxito o error se valida simultáneamente:

- contexto vigente de sesión/licencia/actor/permiso;
- epoch de intención vigente;
- request key activa.

Una respuesta obsoleta no puede modificar:

- `ecommerceOrders`;
- `ecommerceOrderCounts`;
- `ecommerceOrdersPagination`;
- loading o refreshing;
- error;
- flags loaded/stale;
- timestamps de carga.

Se conserva:

- TTL de 30 segundos;
- deduplicación de solicitudes idénticas;
- lista anterior visible durante refresh en background;
- aislamiento por licencia y actor;
- resumen independiente, limitado a counts y metadata del resumen.

### 2. Carrera de detalle

El detalle incorpora una intención separada:

- `detailIntentEpoch`;
- `selectedEcommerceOrderRequestId`.

La intención se valida:

- después de `getEcommerceOrder`;
- después de `markEcommerceOrderSeen`;
- después de la recarga posterior a `markSeen`;
- antes de tocar lista/conteos por visto;
- antes de escribir errores, loading o detalle.

`clearSelectedEcommerceOrder` incrementa el epoch y limpia:

- pedido seleccionado;
- loading y error;
- timestamp;
- identidades de licencia y actor;
- request ID activo.

Así, cerrar el panel o seleccionar B invalida cualquier respuesta tardía de A.

### 3. Acciones aceptar/rechazar

Las acciones visibles requieren que el pedido solicitado coincida con:

- `selectedEcommerceOrder.id`;
- `selectedEcommerceOrderRequestId`;
- detalle sin transición de loading.

Aceptar y rechazar comparten una exclusión mutadora `status` por licencia, actor y pedido. Esto impide ejecutar ambas transiciones simultáneamente para el mismo pedido y conserva la deduplicación de una acción idéntica.

El refresh forzado del mismo pedido conserva la intención de detalle. Después del refresh se vuelve a validar la intención; si el usuario cambió a B, la acción de A devuelve `ECOMMERCE_ORDERS_STALE_RESPONSE`, no reabre A y no escribe errores sobre B.

### 4. Integración de página

`EcommerceOrdersPage.jsx` conserva:

- cada click de tarjeta llama la acción normal de apertura;
- cerrar detalle llama `clearSelectedEcommerceOrder`;
- deep links pasan por la misma acción de detalle y eliminan el query param;
- cambiar filtro limpia detalle y deep link anterior;
- aceptar/rechazar toman el ID visible al confirmar;
- ambos botones quedan deshabilitados durante carga de detalle o acción en curso.

### 5. Pruebas diferidas agregadas

`src/store/slices/__tests__/createEcommerceOrderSlice.test.js` cubre:

- segundo filtro responde primero;
- primer filtro responde primero;
- error de filtro antiguo;
- deduplicación de intención idéntica;
- offset antiguo contra paginación nueva;
- B responde antes que A;
- A responde antes que B;
- cerrar antes de respuesta;
- error antiguo de detalle;
- `markSeen` tardío;
- aceptación tardía;
- deduplicación del mismo detalle;
- reset, cambio de licencia, logout, revocación y PII tardía.

`src/pages/__tests__/EcommerceOrdersPage.test.jsx` cubre:

- apertura por tarjeta;
- deep link compartido;
- limpieza al cambiar filtro;
- cierre del detalle;
- ID visible en aceptar/rechazar;
- ausencia o deshabilitación de acciones durante transición/acción.

## Validación realizada en esta corrección

Resultados reproducidos en el entorno disponible:

- sintaxis JavaScript del slice: **PASS** mediante `node --check`;
- harness aislado de carreras del slice: **PASS**;
- filtro más reciente, error antiguo, paginación, detalle A/B, cierre, `markSeen`, aceptación tardía y deduplicación: **PASS**;
- exclusión compartida aceptar/rechazar: **PASS**;
- revisión del diff: sin nuevos workflows, `.validation`, logs, exit codes, markers ni archivos de disparo artificial.

Validaciones todavía no certificadas sobre el head final por falta de checkout/dependencias en el entorno actual:

- ESLint específico: **PENDIENTE**;
- Vitest específico: **PENDIENTE**;
- regresión ecommerce/notificaciones: **PENDIENTE**;
- `npm run build`: **PENDIENTE**;
- `npm run lint`: **NO REEJECUTADO**;
- `npm run test:ci`: **NO REEJECUTADO**.

No se modifica ni se presenta como verde la línea base global heredada.

## Vercel

Validación Vercel omitida por instrucción explícita. No se llamó la API de Vercel, Vercel CLI ni agentes de Vercel y no se intentó crear, promover, validar o forzar ningún deployment durante `ECOM.ORDERS.1.2`.

La finalización no depende de un preview ni de un check de Vercel.

## Supabase

Supabase permanece sin cambios durante esta corrección:

- no se aplicaron migraciones;
- no se editaron funciones o RPCs;
- no se crearon fixtures, pedidos o notificaciones;
- no se modificaron estados ni datos;
- no se tocó `EC-00000010`.

Las migraciones existentes no fueron editadas, renombradas ni reaplicadas.

## Estado de cierre

`ECOM.ORDERS.1.2` está **IMPLEMENTADO, VALIDACIÓN COMPLETA PENDIENTE**.

No marcar el PR como ready for review ni declarar `ECOM.ORDERS.1.2 PASS` hasta obtener:

- ESLint específico PASS;
- suites específicas y regresión con cero fallos;
- `npm run build` PASS;
- registro honesto de la línea base global;
- verificación de diff limpio.

No mergear automáticamente.
