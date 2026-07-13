# ECOM.ORDERS.2.3.1 — Revalidación del panel operativo abierto

## Causa raíz

`EcommerceOrdersRuntime` ya recibía `lanzo:ecommerce-orders-changed`, pero sólo invalidaba y refrescaba resumen, contadores y lista. El detalle seleccionado y el estado interno de `EcommerceFulfillmentPanel` no recibían una invalidación propia, por lo que el panel podía conservar `accepted`, una versión antigua y la acción `Iniciar preparación` después de que POS hubiera cambiado el pedido a `preparing`.

El backend seguía rechazando acciones con versión obsoleta, pero la interfaz no reconsultaba oportunamente la fuente autoritativa.

## Arquitectura aplicada

Se eligió una única coordinación versionada en el store. El panel no escucha realtime directamente.

El store incorpora:

- `ecommerceSelectedOrderStale`;
- `ecommerceSelectedOrderRefreshRevision`;
- `ecommerceSelectedOrderRefreshOrderId`;
- acciones para marcar stale, solicitar una revisión monotónica y marcar fresh;
- `selectedEcommerceOrderRefreshing` para distinguir un refresh silencioso de la carga inicial.

`EcommerceOrdersRuntime` filtra el evento, marca stale el pedido seleccionado y agrupa la revalidación. Al ejecutarla:

1. incrementa la revisión del panel;
2. reabre silenciosamente el detalle con `force: true`, `markSeen: false` y `background: true`;
3. mantiene el drawer, la selección, el filtro y el contenido anterior;
4. marca fresh sólo después de una respuesta vigente y si no quedó otra invalidación pendiente.

`EcommerceFulfillmentPanel` observa la revisión del store y vuelve a consultar `getEcommerceOrderFulfillment`. El payload realtime nunca se usa para derivar status, versión, pago, acciones ni mensaje público.

## Contrato del CustomEvent

El evento navegador se origina en `notificationRealtimeService` y conserva el evento normalizado dentro de `CustomEvent.detail`.

El identificador se resuelve en este orden:

1. `event.detail.orderId`;
2. `event.detail.order_id`;
3. `event.detail.metadata.order_id`.

El contrato real observado para las notificaciones ecommerce usa principalmente `event.detail.metadata.order_id`.

Si existe un ID y corresponde a otro pedido, sólo se invalidan lista, resumen y contadores. El panel abierto no consulta fulfillment.

Si el evento no incluye un ID confiable, se utiliza el pedido seleccionado como fallback seguro y se reconsulta la RPC. Ningún campo `status`, `reason`, versión o payload de fulfillment se aplica directamente a la UI.

## Debounce, coalescing y single-flight

- Debounce del detalle/panel seleccionado: 300 ms.
- Debounce existente de lista/resumen: 600 ms.
- Una ráfaga de eventos para el mismo pedido genera una única revalidación dentro de la ventana.
- Runtime mantiene una sola consulta de detalle en curso para el pedido seleccionado.
- Si llega una invalidación mientras la consulta está activa, marca el vuelo como `dirty` y ejecuta como máximo un follow-up al terminar.
- El panel mantiene su propio single-flight para la consulta de fulfillment. Las revisiones concurrentes comparten la promesa activa y dejan como máximo una reconsulta posterior.
- No se agregó polling rápido.

## Protección contra respuestas obsoletas

Antes de aplicar una respuesta del panel se comprueba:

- epoch de solicitud;
- pedido seleccionado actual;
- ID visible;
- identidad de licencia;
- rol de dispositivo;
- identidad y permiso ecommerce del staff;
- solicitud activa actual;
- componente todavía montado.

Una respuesta de A no puede sobrescribir B. Un cambio de licencia o staff invalida la respuesta anterior. Listeners, timers y vuelos lógicos se limpian al desmontar o cambiar contexto/ruta.

Durante una revalidación silenciosa se conserva el último contenido visible. Un error mantiene el estado anterior y muestra feedback no destructivo. Un mensaje público editado localmente no se sobrescribe por el refresh silencioso.

Después de una transición manual, el resultado de la RPC se aplica inmediatamente y se invalida cualquier GET anterior. El evento realtime posterior sólo confirma el estado mediante una consulta silenciosa; no repite la transición ni duplica el mensaje de éxito.

## Archivos modificados

- `src/components/ecommerce/orders/EcommerceOrdersRuntime.jsx`
- `src/components/ecommerce/orders/EcommerceFulfillmentPanel.jsx`
- `src/services/ecommerce/ecommerceOrderRealtimeEvent.js`
- `src/services/notifications/notificationRealtimeService.js`
- `src/store/slices/createEcommerceOrderSlice.js`
- `src/components/ecommerce/orders/EcommerceOrdersRuntime.test.jsx`
- `src/components/ecommerce/orders/EcommerceFulfillmentPanel.test.jsx`
- `src/store/slices/__tests__/createEcommerceOrderSlice.test.js`
- `reports/ecom_orders_2_3_1_open_fulfillment_panel_revalidation_report.md`

`EcommerceOrdersPage.jsx` y `ecommerceOrderFulfillmentService.js` fueron revisados. No requirieron cambios funcionales adicionales para este hotfix.

No se modificaron migraciones, RPC, máquina de estados, cobro, inventario, caja, reservas, tracking público ni Supabase remoto.

## Pruebas Vitest enfocadas

Comando ejecutado:

```text
npx vitest run src/components/ecommerce/orders/EcommerceFulfillmentPanel.test.jsx src/components/ecommerce/orders/EcommerceOrdersRuntime.test.jsx src/pages/__tests__/EcommerceOrdersPage.test.jsx src/store/slices/__tests__/createEcommerceOrderSlice.test.js src/services/notifications/__tests__/notificationRealtimeService.ecommerce.test.js
```

Resultado: PASS, 5 archivos y 64 pruebas.

Cobertura relevante:

- evento del mismo pedido y estado visible final `preparing`;
- acción visible `Marcar como listo` y nueva versión remota;
- evento de otro pedido sin GET de fulfillment seleccionado;
- fallback de evento sin ID;
- ráfaga agrupada;
- single-flight y un solo follow-up dirty;
- cambio de selección A → B;
- cambio de contexto staff;
- limpieza de listener y timer al desmontar;
- revalidación stale al recuperar foco;
- acción manual seguida de realtime sin duplicación;
- pago registrado sin completar el fulfillment;
- terminal remoto sin acciones;
- conservación del mensaje público local;
- detalle conservado durante refresh silencioso.

## ESLint y React Doctor

ESLint focalizado sobre Runtime, Panel, Page, slice, normalizador de evento y servicio realtime: PASS, 0 errores y 0 warnings.

`npm run lint` global fue ejecutado con timeout de 600 segundos. No produjo salida ni código final antes del timeout, por lo que se registra como TIMEOUT y no como PASS.

React Doctor fue ejecutado. Resultado global del árbol local: 68/100, 92 hallazgos. No señaló los archivos nuevos o las líneas de esta corrección. Los hallazgos corresponden al baseline local preexistente y fuera del alcance de este hotfix.

## test:ci y build

`npm run test:ci` fue ejecutado con timeout de 900 segundos. No produjo salida ni código final antes del timeout, por lo que se registra como TIMEOUT y no como PASS. Las suites enfocadas sí terminaron y pasaron.

`npm run build`: PASS.

- Vite 7.3.6;
- 3323 módulos transformados;
- build de producción y artefactos PWA generados;
- sólo se conservaron warnings informativos existentes de imports dinámicos/estáticos y datos de browsers desactualizados.

`git diff --check`: PASS (código 0). Git informó únicamente avisos de normalización LF/CRLF sobre el árbol local previamente modificado; no detectó errores de whitespace.

`git status --short`: ejecutado. El workspace ya contenía numerosos cambios y archivos sin seguimiento ajenos a este hotfix; no se limpiaron ni alteraron deliberadamente.

## Pruebas manuales

No se ejecutaron transiciones reales de pedidos, cobros o caja durante esta revisión porque no se proporcionó un fixture o entorno operativo aislado. No se modificaron pedidos ni datos de clientes.

Pendientes manuales reales:

- preparar desde POS con el drawer abierto;
- dos pestañas administrativas sobre el mismo pedido;
- pago desde POS con panel abierto;
- evento identificado de otro pedido observado en DevTools;
- ráfaga real observada en Network.

## Riesgos residuales

- El resultado global de `test:ci` y lint global permanece desconocido por timeout del entorno local/OneDrive; no se declara PASS.
- La entrega realtime depende del canal privado y del contrato existente. Si una señal histórica no contiene order ID, el fallback revalida el pedido seleccionado de forma conservadora.
- Falta verificación manual autenticada con datos de prueba aislados.
