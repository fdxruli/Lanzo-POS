# FASE ECOM.POS.3 — Cobrar y convertir pedidos ecommerce en ventas POS

## Estado

**ECOM.POS.3 BLOCKED — CONTRATO REMOTO PENDIENTE**

La implementación frontend/local y el contrato SQL quedaron versionados en la rama `fase-ecom-pos-3`, pero el checkout ecommerce permanece **fail-closed** hasta que la migración `20260711235900_ecom_pos_3_complete_conversion.sql` sea autorizada, aplicada y validada en Supabase producción.

No se declara `PASS` y el PR debe permanecer como **draft**.

## Precondición de `main`

Validación realizada antes de crear la rama:

- PR `#89 — FASE ECOM.POS.2 — Resolver inventario y lotes de pedidos preparados`: **mergeado**.
- `main` contiene `ECOM.POS.2`, `ECOM.POS.2.1` y `ECOM.POS.2.1.1`: **confirmado**.
- Rama o PR abierto previo para `ECOM.POS.3`: **no existía**.
- Rama creada desde el `main` actualizado: `fase-ecom-pos-3`.
- `main` no fue modificado directamente.

## Elegibilidad

Se agregó `getEcommerceCheckoutEligibility(order, context)` como función pura central.

Bloquea con códigos estructurados:

- `ECOMMERCE_DRAFT_NOT_PREPARED`
- `ECOMMERCE_CONTEXT_MISMATCH`
- `ECOMMERCE_PERMISSION_DENIED`
- `ECOMMERCE_INVENTORY_NOT_READY`
- `ECOMMERCE_INVENTORY_STALE`
- `ECOMMERCE_PRODUCT_MISSING`
- `ECOMMERCE_BATCH_MISSING`
- `ECOMMERCE_TOTAL_MISMATCH`
- `ECOMMERCE_CONVERSION_IN_PROGRESS`
- `ECOMMERCE_ALREADY_CONVERTED`
- `ECOMMERCE_CLAIM_LOST`
- `ECOMMERCE_REMOTE_CONVERSION_CONTRACT_PENDING`

La elegibilidad no depende únicamente de `ecommerceInventoryStatus === 'ready'`. También comprueba:

- borrador `prepared`;
- contexto POS actual;
- permisos vigentes `ecommerce + pos`;
- claim remoto vigente;
- contrato remoto versión 1;
- ausencia de venta anterior;
- ausencia de conversión en curso;
- todas las líneas mapeadas;
- cantidades positivas;
- `needsInventoryResolution === false`;
- `inventoryResolution.status === 'resolved'`;
- cantidad real de inventario disponible en la resolución;
- lote obligatorio presente en productos administrados por lote;
- subtotal, entrega, descuentos, impuestos, total y moneda aceptados.

## Estado de conversión

Se mantiene separado de `ecommerceDraftStatus`:

- `idle`
- `validating`
- `payment_pending`
- `processing_sale`
- `sale_created`
- `confirmation_pending`
- `completed`
- `error`

Metadatos locales utilizados:

- `ecommerceConversionAttemptId`
- `ecommerceConversionActorIdentity`
- `ecommerceConvertedSaleId`
- `ecommerceConversionStartedAt`
- `ecommerceConversionCompletedAt`
- `ecommerceConversionError`
- `ecommerceCheckoutSnapshot`
- `ecommerceRemoteContractVersion`

No se persisten teléfono, dirección, tokens de claim ni otros datos sensibles dentro del snapshot o de los metadatos de la venta.

## Snapshot inmutable

`buildEcommerceCheckoutSnapshot(...)` produce y congela profundamente:

- pedido y código ecommerce;
- identidad derivada del claim, sin guardar el token;
- identidad de licencia y actor;
- clave determinista de conversión;
- revisión y fecha de la orden;
- versión y fecha de resolución de inventario;
- subtotal, entrega, descuentos, impuestos, total y moneda aceptados;
- líneas con ID, item ecommerce, producto local, cantidad aceptada, precio aceptado, total de línea, lote y cantidad real de inventario.

El precio actual del catálogo no reemplaza el precio aceptado.

## Checkout lock

No se creó otro checkout.

`useEcommercePosCheckoutGate` envuelve `usePosCheckout` y reutiliza:

- snapshot canónico;
- lock canónico;
- modal de pago;
- validación de caja;
- `processSale`;
- flujo de inventario y lotes;
- persistencia de venta;
- efectos de caja.

`installEcommercePosActiveOrderGuards` permite el lock ecommerce únicamente cuando existe una autorización explícita del intento. Guardar venta abierta, pausar, cocina, split, apartado y edición libre continúan bloqueados.

El lock se libera por las rutas canónicas de cancelación, cierre permitido, fallo previo a venta y fallo de revalidación.

## Revalidación doble

### Después de adquirir el lock y antes de abrir pago

1. Verifica contrato remoto y claim.
2. Busca una venta previa por idempotencia.
3. Ejecuta `revalidateEcommerceDraftInventory(...)`.
4. Trata `READ_FAILED` y `STALE_RESPONSE` como bloqueo.
5. Recalcula elegibilidad.
6. Construye el snapshot inmutable.
7. Fija el total aceptado en el snapshot canónico.

### Después de confirmar el pago y antes de `processSale`

1. Revalida actor, permisos y contexto.
2. Vuelve a leer claim y conversión remota.
3. Revalida inventario exacto y lotes.
4. Busca una venta previa.
5. Reconstruye el snapshot.
6. Exige igualdad exacta con el snapshot bloqueado.
7. Solo entonces ejecuta el flujo canónico de venta.

Si cambia el pedido o inventario, no se crea venta, no se afecta caja y el borrador permanece recuperable.

## Política `STOCK_WARNING`

Para ecommerce:

- `STOCK_WARNING` y `RACE_CONDITION` se normalizan a `ECOMMERCE_INVENTORY_CHANGED`;
- no se presenta ni ejecuta “Sí, Vender Igual”;
- no se reintenta automáticamente la venta;
- el inventario vuelve a conflicto;
- se conserva el borrador;
- se libera el lock.

Para órdenes POS normales, el comportamiento histórico de `STOCK_WARNING`, override y cancelación no cambia.

## `processSale` canónico

No se creó una función paralela de venta ecommerce.

`processSaleCore` mantiene el mismo flujo de:

- validación de stock;
- carga y validación de lotes;
- `inventoryFlow`;
- transacción segura de venta;
- caja;
- post-efectos;
- shadow/cloud cuando corresponda.

La rama ecommerce únicamente agrega validación del snapshot financiero y metadatos mínimos:

- `origin: 'ecommerce'`
- `ecommerceOrderId`
- `ecommerceOrderCode`
- `ecommerceConversionKey`
- `idempotencyKey`
- totales aceptados y moneda

No hay decrementos ecommerce adicionales antes o después del flujo canónico.

## Idempotencia

Clave determinista:

```text
ecommerce:<ecommerceOrderId>
```

Protecciones:

- promesas concurrentes con la misma clave se coalescen;
- antes de vender se busca una venta cerrada por ID determinista o metadatos;
- una venta encontrada se devuelve como replay idempotente;
- doble clic no inicia dos ejecuciones de `processSale`;
- una recarga en `processing_sale`, `sale_created` o `confirmation_pending` busca la venta antes de permitir otra acción;
- la confirmación pendiente reutiliza el `saleId` y nunca vuelve a abrir pago.

## Contrato remoto

El repositorio no contenía una operación atómica para completar la conversión. Se versionó, sin aplicarla, la migración:

```text
supabase/migrations/20260711235900_ecom_pos_3_complete_conversion.sql
```

Agrega:

### `ecommerce_get_pos_conversion_state(...)`

- autentica licencia, dispositivo, token de seguridad y sesión staff;
- devuelve `contractVersion = 1`;
- valida pertenencia y vigencia del claim;
- devuelve venta convertida, clave y estado remoto.

### `ecommerce_complete_pos_conversion(...)`

- bloquea la fila con `FOR UPDATE`;
- valida licencia, pedido, estado, draft, claim, dispositivo y clave determinista;
- escribe atómicamente `converted_to_sale`, `converted_sale_id`, `converted_at` y `pos_conversion_key`;
- archiva la visibilidad del pedido;
- registra evento y broadcast;
- mismo `saleId` y misma clave: éxito idempotente;
- otro `saleId`: conflicto bloqueante.

El frontend interpreta RPC inexistente o schema cache sin actualizar como:

```text
ECOMMERCE_REMOTE_CONVERSION_CONTRACT_PENDING
```

Nunca lo interpreta como autorización.

## Recuperación y confirmación pendiente

Después de una venta creada:

1. conserva `ecommerceConvertedSaleId`;
2. marca `sale_created`;
3. intenta confirmación remota;
4. solo tras éxito marca `completed` y elimina el borrador local.

Si falla la confirmación:

- estado `confirmation_pending`;
- venta e inventario no se repiten;
- caja no se repite;
- borrador permanece local;
- UI muestra “Venta registrada / Confirmación del pedido online pendiente”;
- únicas acciones: `Reintentar confirmación` y `Ver venta`.

La recuperación tras recarga busca la venta cerrada por la clave idempotente. Si la encuentra, continúa únicamente con confirmación remota.

## Permisos

Se reutiliza el contrato vigente del POS:

- dispositivo admin; o
- staff con `ecommerce === true` y `pos === true`.

Los permisos, actor y contexto se revalidan:

- al determinar elegibilidad;
- antes de adquirir el lock;
- antes de `processSale`.

No se inventó un permiso nuevo incompatible con el modelo actual.

## UI

Se agregó un panel independiente que muestra:

- Estado del pedido
- Estado del inventario
- Estado de conversión

Comportamiento:

- inventario pendiente/conflict: `Cobrar pedido` deshabilitado;
- RPC pendiente: `Cobrar pedido` deshabilitado;
- contrato, claim, permisos e inventario válidos: checkout controlado habilitado;
- validando/procesando: interacciones duplicadas deshabilitadas;
- `confirmation_pending`: no muestra cobro; solo reintento y venta;
- cantidades y productos ecommerce son de solo lectura;
- descuentos, cocina, venta abierta, split y apartado permanecen ocultos o bloqueados.

## Pruebas agregadas

- `ecommercePosCheckoutConversion.test.js`
  - elegibilidad;
  - lotes;
  - contexto;
  - permisos;
  - claim;
  - contrato remoto;
  - totales;
  - snapshot inmutable;
  - estados de conversión.
- `processSaleCore.ecommerce.test.js`
  - precios aceptados;
  - cargos ecommerce;
  - cambios de cantidad/lote;
  - total autoritativo;
  - sanitización del payload interno.
- `EcommercePosConversionPanel.test.jsx`
  - conflict;
  - contrato remoto pendiente;
  - checkout habilitado;
  - procesamiento;
  - confirmación pendiente;
  - reintento sin volver a cobrar.
- `installEcommercePosActiveOrderGuards.test.js`
  - borrador ecommerce de solo lectura;
  - operaciones bloqueadas;
  - regresión de orden POS normal.

## Validación técnica

Estado al crear el reporte:

- checkout limpio / `npm ci`: **pendiente de ejecución en CI del PR**;
- ESLint específico: **pendiente**;
- Vitest específico: **pendiente**;
- build: **pendiente**;
- lint global: **pendiente**;
- `test:ci`: **pendiente**;
- `git diff --check`: **pendiente de comprobación final**;
- comparación contra `main`: rama creada desde el `main` requerido; sin divergencia observada al inicio.

Los resultados reales se actualizarán en este reporte y en la descripción del PR. No se declarará `PASS` por ausencia de evidencia.

## Smoke test

No se ejecuta un cobro real mientras el RPC no exista en producción. El comportamiento seguro esperado y verificable en código/pruebas es:

- pedido sin stock: bloqueado, sin venta ni caja;
- lote válido pero RPC ausente: inventario listo, checkout bloqueado por contrato remoto;
- cambio antes del pago: revalidación bloquea;
- cambio dentro del modal: `processSale` no se ejecuta;
- doble clic: una promesa/venta;
- fallo remoto después de venta: `confirmation_pending`;
- reintento: reutiliza `saleId`, sin pago ni descuento adicional de inventario;
- recuperación remota: completa y elimina únicamente el borrador local.

## Supabase

- Producción: **sin cambios**.
- Migración: **solo versionada**.
- Aplicación/validación del contrato: **requiere autorización explícita**.

## Vercel

- Preview manual: **no creado, intentado, forzado, promovido ni validado**.
- Vercel: **no utilizado como evidencia**.

## Criterio de cierre pendiente

Para cambiar a `ECOM.POS.3 PASS` se requiere:

1. autorizar y aplicar la migración remota;
2. validar ambos RPC en el entorno autorizado;
3. ejecutar smoke test real de una venta ecommerce;
4. confirmar una sola venta, un solo descuento de inventario/lote y una sola actualización de caja;
5. completar build, lint, Vitest y regresión sin fallos nuevos;
6. mantener el PR draft hasta cerrar todos los bloqueos.
