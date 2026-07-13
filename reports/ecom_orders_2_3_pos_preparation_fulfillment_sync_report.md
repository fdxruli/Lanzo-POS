# ECOM.ORDERS.2.3 — Sincronización de preparación POS y fulfillment

## Estado inicial y causa raíz

Se confirmó la inconsistencia entre la preparación POS y el fulfillment público: la confirmación del borrador cambiaba `pos_draft_status` a `prepared`, pero no cambiaba `fulfillment_status`, su versión ni sus marcas de tiempo. Antes del backfill había 9 pedidos con la inconsistencia exacta permitida por este hotfix: 4 con `status = accepted` y 5 con `status = converted_to_sale`; todos tenían borrador preparado y fulfillment en `accepted`.

## Implementación aplicada

- Migración: `supabase/migrations/20260713061218_ecom_orders_2_3_pos_preparation_fulfillment_sync.sql`.
- Timestamp local y remoto: `20260713061218`.
- Historial remoto: migración `ecom_orders_2_3_pos_preparation_fulfillment_sync` registrada en el proyecto configurado `odlrhijtfyavryeqivaa`.
- Helper privado nuevo: `private.ecommerce_ensure_pos_preparing_fulfillment_v1`.
- Funciones reemplazadas:
  - `private.ecommerce_admin_confirm_pos_draft_authorized_v1`
  - `private.ecommerce_begin_pos_conversion_authorized_v1`
  - `private.ecommerce_complete_pos_conversion_authorized_v1`

El helper asume la autorización y el bloqueo de fila ya establecidos. Sólo realiza `accepted → preparing` cuando el borrador ya está preparado y el pedido se encuentra en el estado conocido. Actualiza la versión una vez, registra los eventos privado y público con una llave determinística sin secretos, y conserva el mensaje público existente.

La confirmación del borrador llama al helper dentro de la misma transacción y bajo el mismo `SELECT ... FOR UPDATE`. El comienzo y la finalización de la conversión contienen la reparación defensiva únicamente para pedidos heredados `accepted + prepared + fulfillment accepted`; el cobro sigue separado y no infiere `ready`, `out_for_delivery` ni `completed`.

## Idempotencia, concurrencia y no regresión

- Un replay con el mismo borrador ya preparado no incrementa `fulfillment_version`, no crea eventos ni cambia timestamps de fulfillment.
- Sólo puede ocurrir `accepted → preparing`.
- `preparing`, `ready`, `out_for_delivery`, `attention`, `completed` y `cancelled` no retroceden a `preparing`.
- Los guards terminales existentes continúan bloqueando confirmaciones tardías.
- La transición y la reserva de conversión se serializan con el mismo bloqueo de fila, por lo que una transición posterior a `ready` no puede revertirse por una confirmación POS tardía.

## Backfill

El backfill se limitó a `pos_draft_status = prepared`, `fulfillment_status = accepted` y `status IN ('accepted', 'converted_to_sale')`.

- Filas corregidas: 9.
- Eventos privados insertados: 9.
- Eventos públicos insertados: 9.
- Inconsistencias exactas restantes: 0.
- Pedidos ya convertidos que quedaron en `preparing`: 5.

No se tocaron estados `ready`, `out_for_delivery`, `completed`, `cancelled` ni `attention`, ni ventas, caja, inventario, reservas, lotes, pagos, claims o llaves de conversión.

## Seguridad y actualización pública

- Helper y funciones privadas: owner `postgres`, `SECURITY DEFINER` y `search_path = ''` verificados.
- El helper no tiene `EXECUTE` para `PUBLIC`, `anon` ni `authenticated`.
- Las RPC públicas conservan sus grants previstos y consumen una sola autorización POS.
- Se verificó que los triggers `ecommerce_orders_block_terminal_pos_mutation` y `ecommerce_orders_broadcast_public_tracking` siguen presentes.
- La señal realtime sigue siendo un aviso de revalidación: el seguimiento consulta de nuevo `ecommerce_get_order_tracking`.

## Pruebas SQL

Archivo: `supabase/tests/ecom_orders_2_3_pos_preparation_fulfillment_sync_test.sql`.

La prueba se ejecutó dentro de `BEGIN`/`ROLLBACK` y pasó. Cubre confirmación normal, replay idempotente, fulfillment ya `preparing`, no regresión desde `ready` y `out_for_delivery`, bloqueos terminales, reparación al iniciar conversión, preservación de fulfillment al completar conversión, backfill equivalente y concurrencia lógica. No dejó fixtures persistentes.

También se ejecutó un preflight de la migración completa dentro de una transacción con `ROLLBACK` antes de aplicarla.

## Frontend y pruebas de servicio actualizados

- `src/services/ecommerce/ecommerceOrderService.js`: normaliza y expone fulfillment en el detalle del pedido.
- `src/services/ecommerce/ecommercePosDraftService.js`: propaga el fulfillment confirmado al snapshot local POS.
- `src/components/pos/EcommercePosConversionPanel.jsx`: muestra `Estado operativo` sin confundirlo con `Inventario`.
- Se actualizaron pruebas de borrador POS, fulfillment, panel POS y seguimiento público para comprobar `En preparación`, `Marcar como listo` y `Pago registrado` sin completar falsamente el fulfillment.

## Validación local

| Comprobación | Resultado |
| --- | --- |
| Sintaxis Node de los dos servicios JS modificados | PASS |
| Prueba SQL transaccional | PASS |
| Preflight SQL de migración | PASS |
| `git diff --check` | PASS (sólo avisos de fin de línea en cambios preexistentes) |
| Vitest focalizado | PASS: 49/49 pruebas en 5 archivos |
| ESLint focalizado sobre los archivos de la corrección | PASS: 0 errores; 1 warning preexistente |
| `npm run lint` global | NO EJECUTADO en esta revisión incremental |
| `npm run test:ci` global | NO EJECUTADO en esta revisión incremental |
| Build de producción con Vite | PASS: 3322 módulos transformados |
| React Doctor | Ejecutado; reporta problemas globales ajenos a este hotfix |
| Pruebas manuales pickup/delivery/doble confirmación/dos pestañas | PENDIENTES |

Se intentó `npm ci` usando el lockfile del proyecto. No pudo finalizar porque procesos de desarrollo existentes mantienen ocupado el binario de esbuild. No se detuvieron procesos del usuario ni se modificó el lockfile. Posteriormente se recuperaron suficientes dependencias locales, sin scripts de instalación, para ejecutar Vitest focalizado, ESLint focalizado y el build directamente desde sus entradas Node; el `npm ci` exacto continúa pendiente.

El árbol de trabajo ya contenía un volumen grande de modificaciones y archivos sin seguimiento ajenos a este hotfix; se preservaron y no se realizaron operaciones remotas de control de versiones.

Las pruebas manuales no se ejecutaron: el proyecto Supabase configurado está activo y no se proporcionaron fixtures ni una cuenta de prueba para crear, cobrar y completar pedidos sin afectar datos operativos. La comprobación visual no mutante de la app local tampoco pudo completarse porque el navegador local agotó el tiempo de carga del servidor existente.

## Riesgos residuales y siguiente paso

La corrección server-side, el backfill, las pruebas SQL, las suites focalizadas y el build están verificados. Permanecen pendientes la ejecución global exacta de `npm run lint` y `npm run test:ci`, además de los flujos manuales pickup, delivery, replay y dos pestañas con datos de prueba autorizados. No se declara PASS para esas comprobaciones pendientes.

## Corrección frontend posterior: acciones operativas y modal de pago móvil

Durante la verificación real posterior se localizaron dos problemas independientes de la migración:

1. `EcommerceFulfillmentPanel` se montaba como elemento flotante con `z-index: 45`, mientras el detalle del pedido usa el nivel modal `1100`. La acción válida `Marcar como listo` existía, pero quedaba detrás del drawer y no era accesible, especialmente en móvil.
2. Al iniciar el cobro móvil se cerraba el carrito mediante `history.back()` y se abría inmediatamente el modal de pago. El `popstate` pendiente del carrito podía ejecutarse después y cerrar la nueva capa de pago.

Correcciones aplicadas:

- El panel de fulfillment se renderiza dentro del detalle seleccionado en `EcommerceOrdersPage` y dejó de montarse como overlay desde `EcommerceOrdersRuntime`.
- El panel usa ahora un layout embebido y conserva la acción `preparing → ready` con la etiqueta `Marcar como listo`.
- `useDismissibleHistoryLayer` admite el cierre explícito con reemplazo de la entrada actual, sin navegación ni `popstate` tardío.
- `useMobileCartModal` expone `closeCartForModalTransition`, y el checkout lo usa antes de abrir pago o receta. Los cierres normales mantienen el comportamiento del botón Atrás.
- No se cambió el significado de inventario listo ni se añadió ninguna transición automática a `ready`, `out_for_delivery` o `completed`.

Archivos funcionales de esta corrección:

- `src/pages/EcommerceOrdersPage.jsx`
- `src/components/ecommerce/orders/EcommerceOrdersRuntime.jsx`
- `src/components/ecommerce/orders/EcommerceFulfillmentPanel.css`
- `src/hooks/useDismissibleHistoryLayer.js`
- `src/hooks/pos/usePosModals.js`
- `src/hooks/pos/usePosCheckout.js`

Pruebas de regresión añadidas o actualizadas:

- `src/hooks/pos/__tests__/usePosModals.mobileTransition.test.jsx`
- `src/hooks/pos/__tests__/usePosCheckout.ecommerce.test.jsx`
- `src/components/ecommerce/orders/EcommerceFulfillmentPanel.test.jsx`
- `src/pages/__tests__/EcommerceOrdersPage.test.jsx`

Resultados de la revisión incremental:

- Vitest de interfaz, checkout e historial móvil: 38/38 PASS.
- Vitest del servicio de fulfillment: 11/11 PASS.
- ESLint focalizado: 0 errores; permanece un warning anterior en `stripLayerState`.
- Build Vite: PASS, 3322 módulos transformados y PWA generada.
- `git diff --check`: PASS.
- React Doctor: ejecutado; 68/100 y 92 hallazgos en el árbol local. No señaló las líneas nuevas de esta corrección; sus errores corresponden a cambios preexistentes y fuera de alcance.
- Prueba manual autenticada en móvil: pendiente. No se crearon pedidos ni cobros reales durante esta revisión.
