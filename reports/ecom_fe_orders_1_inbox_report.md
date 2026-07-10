# ECOM.FE.ORDERS.1 — Bandeja interna de pedidos ecommerce

Fecha: 2026-07-10  
Repositorio: `fdxruli/Lanzo-POS`  
Rama: `fase-ecom-orders-1`  
PR: `#85`

## Estado

`ECOM.FE.ORDERS.1 PASS` con las correcciones acumuladas `ECOM.ORDERS.1.1` y `ECOM.ORDERS.1.2`.

La bandeja conserva autorización fail-closed, listado sin PII, detalle autorizado, TTL, deduplicación por licencia/actor/recurso y limpieza completa después de logout, cambio de licencia, downgrade o revocación de permisos.

## Corrección ECOM.ORDERS.1.1

Se conserva el cierre anterior:

- rol nulo o desconocido no se interpreta como admin;
- `requestEpoch` invalida respuestas de sesiones, licencias o permisos anteriores;
- reset elimina lista, conteos, detalle, errores y PII;
- mocks Vitest, `jest-dom`, cleanup, listeners y timers corregidos;
- sin workflows temporales, `.validation`, logs, exit codes, markers o archivos `tmp`.

## Corrección ECOM.ORDERS.1.2

### Carrera de filtros y paginación

El slice incorpora una intención independiente para la lista:

- `listIntentEpoch`;
- `ecommerceOrdersActiveRequestKey`;
- clave estable por licencia, actor, filtro, límite y offset.

Antes de procesar tanto éxito como error se valida:

- contexto vigente de sesión/licencia/actor/permiso;
- epoch de intención vigente;
- request key activa.

Una respuesta obsoleta no puede modificar lista, conteos, paginación, loading, refreshing, error, flags stale/loaded ni timestamps. Se conservan el TTL de 30 segundos, la deduplicación de solicitudes idénticas, la lista previa durante refresh en background y el aislamiento por licencia y actor.

`loadEcommerceOrderSummary` conserva su mapa independiente y solo actualiza conteos y metadata del resumen.

### Carrera de detalle

El detalle incorpora una intención independiente:

- `detailIntentEpoch`;
- `selectedEcommerceOrderRequestId`.

La intención se comprueba después de `getEcommerceOrder`, después de `markEcommerceOrderSeen`, después de la recarga posterior a visto y antes de escribir lista, conteos, errores, loading o PII.

Abrir B invalida A inmediatamente. `clearSelectedEcommerceOrder` incrementa el epoch y limpia la selección, por lo que una respuesta tardía no puede reabrir el panel.

### Acciones aceptar y rechazar

Las acciones requieren que el ID coincida con el pedido visible y que el detalle no esté cambiando. Aceptar y rechazar comparten una exclusión mutadora `status` por licencia, actor y pedido, evitando acciones opuestas simultáneas.

Después del refresh se vuelve a comprobar la intención. Si el usuario cambió a B, el resultado de A devuelve `ECOMMERCE_ORDERS_STALE_RESPONSE`, no reabre A y no escribe errores sobre B.

### Integración de página

`EcommerceOrdersPage.jsx`:

- crea una nueva intención con cada click de tarjeta;
- usa la misma lógica para deep links;
- elimina el query param al consumir el deep link;
- limpia detalle y deep link al cambiar filtro;
- llama `clearSelectedEcommerceOrder` al cerrar;
- usa el ID actualmente visible para aceptar o rechazar;
- oculta o deshabilita acciones durante carga de detalle u operación activa.

### Pruebas diferidas

`createEcommerceOrderSlice.test.js` cubre:

- segundo filtro responde primero;
- primer filtro responde primero;
- error de filtro antiguo;
- deduplicación de intención idéntica;
- offset antiguo frente a paginación nueva;
- B responde antes que A;
- A responde antes que B;
- cierre antes de respuesta;
- error antiguo de detalle;
- `markSeen` tardío;
- aceptación tardía;
- detalle idéntico deduplicado;
- reset, cambio de licencia, logout, revocación y PII tardía;
- exclusión mutua aceptar/rechazar.

`EcommerceOrdersPage.test.jsx` cubre tarjetas, deep link, cambio de filtro, cierre, ID visible en acciones y estados disabled/loading.

## Validación ECOM.ORDERS.1.2

### ESLint específico

Ejecutado sobre:

- `src/store/slices/createEcommerceOrderSlice.js`;
- `src/store/slices/__tests__/createEcommerceOrderSlice.test.js`;
- `src/pages/EcommerceOrdersPage.jsx`;
- `src/pages/__tests__/EcommerceOrdersPage.test.jsx`.

Resultado:

```text
PASS
0 errores
0 warnings
```

### Vitest específico y regresión acoplada

Ejecutadas conjuntamente sobre el head validado:

- `createEcommerceOrderSlice.test.js`;
- `EcommerceOrdersPage.test.jsx`;
- `EcommerceOrdersRoute.test.jsx`;
- `ecommerceOrderCapabilities.test.js`;
- `ecommerceOrderService.test.js`;
- `notificationRealtimeService.ecommerce.test.js`.

Resultado:

```text
6 suites PASS
62 pruebas PASS
0 suites fallidas
0 pruebas fallidas
```

Las suites ecommerce/notificaciones restantes de la regresión completa de `ECOM.ORDERS.1.1` no fueron modificadas por esta mini fase. Sus archivos conservan los blobs previamente validados; las seis superficies acopladas al cambio sí se reejecutaron sobre el head actual.

### Build local

Se ejecutó `npm run build`, conservando el script `vite build`, con los blobs exactos modificados y las versiones del proyecto.

```text
vite v7.2.2
1701 módulos transformados
PASS
```

### Línea base global

La línea base heredada no se declara verde. La última comparación completa permanece documentada:

- `npm run lint`: 156 errores y 226 warnings tanto en la rama como en `main`;
- `npm run test:ci`: 76 pruebas fallidas en la rama frente a 79 en `main`.

Los cuatro archivos modificados por `ECOM.ORDERS.1.2` pasan ESLint y las suites acopladas pasan sin fallos; no se introdujeron regresiones nuevas en la superficie corregida.

## Vercel

Validación Vercel omitida por instrucción explícita.  
No se creó ni intentó ningún deployment durante ECOM.ORDERS.1.2.  
La validación se realizó mediante ESLint, Vitest y vite build local.

No se llamó la API de Vercel, Vercel CLI ni agentes de Vercel y la finalización no depende de un preview o check de Vercel.

## Supabase

Supabase permanece sin cambios:

- no se consultó ni modificó el proyecto;
- no se aplicaron migraciones;
- no se editaron funciones o RPCs;
- no se crearon fixtures, pedidos o notificaciones;
- no se modificaron estados ni datos;
- no se tocó `EC-00000010`.

## Limpieza

El diff final no incorpora workflows temporales, `.validation/`, `tmp/`, logs, exit codes, markers, evidencias crudas ni archivos para disparar CI o deployments.

## Estado de cierre

`ECOM.ORDERS.1.2 PASS`.

No mergear automáticamente.
