# FASE ECOM.POS.1 — Preparar pedidos aceptados como borradores POS

- Fecha de corrección: 2026-07-11 (`America/Mexico_City`)
- Repositorio: `fdxruli/Lanzo-POS`
- Rama: `fase-ecom-pos-1`
- PR: `#88 — FASE ECOM.POS.1 — Preparar pedidos aceptados como órdenes activas del POS`
- Base: `main`
- Proyecto Supabase: `odlrhijtfyavryeqivaa`
- Estado del PR: `draft`

## Estado actual

`ECOM.POS.1.1 PENDING GLOBAL VALIDATION`.

La corrección funcional, la alineación de migraciones, las pruebas SQL transaccionales y la verificación read-only de Supabase están completas. El PR **no** se declara listo para revisión porque este entorno no pudo ejecutar `npm ci`, ESLint, Vitest, `npm run build`, `npm run lint` ni `npm run test:ci`: no existe un checkout local accesible, la red del contenedor no resuelve `github.com` y el commit actual no tiene GitHub Actions disponibles. El check automático de Vercel no se usa como evidencia.

No se debe conservar ni reutilizar la declaración anterior `ECOM.POS.1 PASS`, porque fue emitida antes de detectar que los pedidos creados por el checkout real no contenían `source_product_id`.

## Corrección ECOM.POS.1.1

### Drift de migración corregido

La migración ya aplicada en producción estaba registrada como:

```text
20260711024125 / ecom_pos_1_prepare_order_draft
```

El archivo local se renombró sin modificar su contenido:

```text
supabase/migrations/20260711024125_ecom_pos_1_prepare_order_draft.sql
```

Se eliminó el nombre local incorrecto `20260711022044_ecom_pos_1_prepare_order_draft.sql`.

No se reaplicó esta migración y no se ejecutó `migration repair`, `db push` ni `--include-all`.

### Migración correctiva de mapeo

Producción ya registraba antes de esta corrección:

```text
20260711122554 / ecom_pos_1_1_product_mapping_and_guards
```

La rama ahora contiene el archivo correspondiente:

```text
supabase/migrations/20260711122554_ecom_pos_1_1_product_mapping_and_guards.sql
```

No se reaplicó una versión ya registrada.

La migración correctiva:

- confirma que `source_product_id`, `product_id` y `local_product_ref` son `text`;
- completa artículos existentes con `coalesce(product_id, local_product_ref)`;
- valida simultáneamente `published_product_id`, `portal_id` y `license_id`;
- instala un trigger servidor `BEFORE INSERT OR UPDATE` para futuras filas;
- no confía en un ID enviado por el navegador;
- deja `source_product_id=NULL` cuando la publicación no tiene vínculo local;
- actualiza `private.ecommerce_order_pos_snapshot_v1` con fallback defensivo y join aislado por portal/licencia;
- mantiene los helpers privados sin `EXECUTE` para `PUBLIC`, `anon` y `authenticated`.

## Evidencia real de producto

Verificación read-only de producción:

```text
ecommerce_order_items totales: 4
con source_product_id: 4
mapeables todavía en NULL: 0

publicaciones activas: 11
con product_id: 0
con local_product_ref: 11
```

Los snapshots de `EC-00000010`, `EC-00000011` y `EC-00000012` devolvieron un artículo cada uno y todos incluyeron `sourceProductId`.

## Protección centralizada de efectos

Se agregó `src/services/ecommerce/ecommercePosDraftGuards.js` como contrato único:

```text
isEcommercePosDraft(order) => order?.origin === 'ecommerce'
isEcommercePosEffectBlocked(order) => mismo criterio
ECOMMERCE_POS_CHECKOUT_NOT_ENABLED
```

Durante `ECOM.POS.1`, cualquier orden con `origin='ecommerce'` permanece bloqueada sin depender de `ecommerceDraftStatus`.

### Checkout y caja

`useCheckoutFlow` bloquea antes de cualquier efecto:

- `handleInitiateCheckout`;
- `handleProcessOrder`;
- `handleQuickCajaSubmit`.

El guard se ejecuta antes de abrir pago/caja rápida, verificar sesión o llamar `processSale`.

Estados cubiertos por pruebas añadidas:

- `claimed`;
- `prepared`;
- estado faltante;
- estado desconocido;
- regresión de una orden POS normal.

### Operaciones de órdenes activas

Se añadió una capa central instalada por `EcommerceOrdersRuntime` sobre:

- `saveOrderAsOpen`;
- `closeOrder`;
- `lockOrderForCheckout`.

Para ecommerce devuelve:

```text
success: false
code: ECOMMERCE_POS_CHECKOUT_NOT_ENABLED
```

Las implementaciones originales no se invocan, por lo que no se escribe en `STORES.SALES`, no se cierra una venta y no se toma un lock de checkout.

`EcommerceOrdersRuntime` está montado desde `Layout`, por lo que la protección se instala en el runtime global del POS.

### Restaurante, cocina y división de cuenta

`useTableManagement` bloquea al inicio de:

- `handleSaveAsOpen`;
- reconciliaciones previas a split/cobro de mesa;
- `handleQuickTableAction`;
- `handleOpenSplitBill`;
- `handleConfirmSplitBill`.

El bloqueo ocurre antes de:

- prompt de mesa;
- `saveOrderAsOpen`;
- escritura de `fulfillmentStatus='pending'`;
- lectura/escritura de venta abierta;
- `restaurantOrdersRepository.upsertRestaurantOrderFromLocalSale`;
- `splitOpenTableOrder`;
- cierre cloud posterior al split.

### Apartados

`useLayawayFlow` bloquea tanto `handleInitiateLayaway` como `handleConfirmLayaway`.

Una orden ecommerce no abre el modal, no llama `layawayRepo.create`, no registra pago inicial, no mueve caja y no limpia la orden como si el apartado hubiera sido creado.

### UI y móvil

`OrderSummary` muestra el banner ecommerce y conserva la acción segura `Liberar borrador` y el regreso al detalle.

Para ecommerce se ocultan visualmente:

- cobrar;
- guardar/enviar a cocina;
- dividir cuenta;
- apartar;
- identificador/acceso de mesa;
- descuentos embebidos;
- acciones de edición operativa.

`MobilePosCart` reutiliza `OrderSummary` y ahora también omite el `OrderDiscountPanel` separado cuando la orden activa es ecommerce.

`PosFloatingBar` únicamente abre el carrito o la bandeja de mesas; no ejecuta cobro. Las acciones posteriores siguen atravesando los guards lógicos.

## Estado remoto como fuente de verdad

`prepareEcommerceOrderPosDraft` ya no abre una copia local solo por existir.

La reutilización local exige simultáneamente:

- pedido remoto `accepted`;
- remoto `posDraft.status='prepared'`;
- `isClaimedByCurrentActor=true`;
- claim token remoto presente;
- `draftId` remoto igual al determinístico local;
- mismo `ecommerceOrderId`;
- misma identidad local de licencia/actor;
- mismo claim token;
- estado local `prepared`.

Comportamiento fail-closed:

- remoto `released`: elimina la copia local, reclama de nuevo y confirma con token nuevo;
- remoto `claimed` por otro dispositivo: no abre y no intenta un claim redundante;
- remoto `prepared` por otro dispositivo: no abre;
- token diferente: no reutiliza la copia;
- `draftId` diferente: conflicto y recarga;
- pedido ya no `accepted`: elimina/invalida la copia;
- estado remoto desconocido: oculta acciones y devuelve conflicto.

## Propiedad del claim en la bandeja

La UI distingue:

- `prepared` propio con token y `draftId`: `Abrir en Punto de Venta` + `Liberar borrador`;
- `prepared` ajeno para staff: mensaje informativo, sin abrir ni liberar;
- `prepared` ajeno para admin: liberación administrativa con confirmación explícita;
- `claimed` propio con token: `Continuar preparación`;
- `claimed` ajeno: mensaje informativo;
- estado desconocido: acciones ocultas y mensaje de conflicto/recarga.

La liberación administrativa omite token únicamente para administrador, conforme al contrato de la RPC.

## Fallos compensatorios y recuperación

Si falla contexto, mapeo, upsert o confirmación, el servicio intenta liberar remotamente antes de retirar la copia local.

Si también falla la liberación compensatoria:

- la orden conserva `origin='ecommerce'`;
- queda en `ecommerceDraftStatus='error_releasing'`;
- conserva el claim token necesario;
- marca `ecommerceReleaseRecoveryRequired=true`;
- todos los guards financieros/operativos continúan bloqueándola;
- `retryReleaseEcommerceDraft` permite reintentar la liberación;
- una liberación exitosa elimina después la copia local.

No se convierte en una orden normal.

## Protección de PII

El borrador local conserva únicamente datos operativos del pedido y del claim.

No persiste:

- nombre del cliente;
- teléfono;
- dirección;
- notas;
- URL de WhatsApp.

Las pruebas añadidas construyen el detalle remoto con PII y verifican que no aparezca en el borrador serializado.

## Pruebas SQL

Se actualizó:

```text
supabase/tests/ecom_pos_1_prepare_draft_test.sql
```

La prueba reproduce el checkout real con `published_product_id` definido y `source_product_id=NULL`.

Casos ejecutados en producción dentro de `BEGIN/ROLLBACK`:

- trigger servidor resuelve `local_product_ref`;
- backfill deja cero artículos mapeables sin resolver;
- publicación de otra licencia no mapea;
- publicación de otro portal no mapea;
- publicación sin vínculo queda sin mapping;
- snapshot usa fallback seguro;
- helpers privados continúan cerrados;
- tablas continúan sin grants directos;
- `PUBLIC` no ejecuta la RPC;
- claim idempotente;
- segundo dispositivo bloqueado;
- confirmación idempotente;
- liberación propia y administrativa controlada;
- cero efectos financieros;
- rollback completo.

Resultado final:

```text
ECOM.POS.1.1 SQL PASS
```

La primera iteración del fixture de portal falló por el guard que exige portal activo; la transacción se revirtió. El fixture se corrigió sin relajar producción y la ejecución final pasó.

## Pruebas frontend añadidas o ampliadas

Se añadieron/ampliaron pruebas para:

- `ecommercePosDraftService` y contrato real de mapping;
- reconciliación remoto/local;
- confirmación fallida + liberación fallida + reintento;
- checkout fail-closed para todos los estados;
- wrappers centrales de órdenes activas;
- restaurante/cocina/split;
- apartados;
- propiedad del claim en `EcommerceOrdersPage`;
- carrito móvil y panel de descuentos;
- PII ausente del borrador.

Archivos relevantes:

```text
src/services/ecommerce/__tests__/ecommercePosDraftService.test.js
src/services/ecommerce/__tests__/installEcommercePosActiveOrderGuards.test.js
src/hooks/pos/__tests__/useCheckoutFlow.ecommerce.test.jsx
src/hooks/pos/__tests__/useTableManagement.ecommerce.test.jsx
src/hooks/pos/__tests__/useLayawayFlow.ecommerce.test.jsx
src/pages/__tests__/EcommerceOrdersPage.claimOwnership.test.jsx
src/components/pos/__tests__/MobilePosCart.ecommerce.test.jsx
src/components/pos/__tests__/EcommercePosDraftBanner.test.jsx
```

### Estado de ejecución frontend

```text
ESLint específico: NO EJECUTADO EN ESTE ENTORNO
Vitest específico: NO EJECUTADO EN ESTE ENTORNO
Regresión: NO EJECUTADA EN ESTE ENTORNO
npm run build: NO EJECUTADO EN ESTE ENTORNO
npm run lint: NO EJECUTADO EN ESTE ENTORNO
npm run test:ci: NO EJECUTADO EN ESTE ENTORNO
comparación global contra main: PENDIENTE
```

Motivo verificable:

- el contenedor no pudo clonar el repositorio: `Could not resolve host: github.com`;
- no existe checkout local disponible;
- el commit no tiene GitHub Actions asociados;
- no se creó ningún workflow temporal;
- no se usó Vercel como sustituto.

Los resultados históricos del reporte anterior no deben tratarse como validación de los cambios de `ECOM.POS.1.1`.

## Verificación final de Supabase

Producción, read-only:

- migración `20260711024125` registrada: PASS;
- migración `20260711122554` registrada: PASS;
- archivo local con versiones coincidentes: PASS;
- 4/4 artículos reales con `source_product_id`: PASS;
- 0 artículos mapeables todavía nulos: PASS;
- snapshots de `EC-00000010–12` con `sourceProductId`: PASS;
- trigger de mapping presente: PASS;
- `PUBLIC` sin `EXECUTE` sobre claim: PASS;
- helpers privados cerrados: PASS;
- grants directos cliente sobre tablas: 0;
- claims residuales en `EC-00000010–12`: 0;
- estados de pedidos reales no modificados durante la verificación read-only.

## Vercel

No se invocó manualmente Vercel mediante API, CLI o agentes. No se creó, forzó, promovió ni validó preview. La integración automática de GitHub puede registrar un check, pero no se utiliza como evidencia.

## Estado de aceptación

```text
Mapeo de pedidos reales: PASS
Migraciones alineadas: PASS
Checkout fail-closed implementado: PASS DE REVISIÓN ESTÁTICA
Venta abierta bloqueada implementada: PASS DE REVISIÓN ESTÁTICA
Cocina y split bloqueados implementados: PASS DE REVISIÓN ESTÁTICA
Apartados bloqueados implementados: PASS DE REVISIÓN ESTÁTICA
Reconciliación remoto/local implementada: PASS DE REVISIÓN ESTÁTICA
Protección de PII: PASS DE REVISIÓN ESTÁTICA + COBERTURA AÑADIDA
Supabase: PASS
SQL: PASS
ESLint: PENDIENTE
Vitest: PENDIENTE
Build global: PENDIENTE
Línea base main: PENDIENTE
Vercel manual: NO UTILIZADO
```

El PR #88 debe permanecer en draft. No marcar `ready for review`, no declarar `ECOM.POS.1.1 PASS` y no mergear hasta ejecutar la validación frontend/global íntegra y corregir únicamente regresiones introducidas por esta rama.
