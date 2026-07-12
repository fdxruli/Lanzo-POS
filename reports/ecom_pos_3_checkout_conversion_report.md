# FASE ECOM.POS.3 — Cobrar y convertir pedidos ecommerce en ventas POS

## Estado

**ECOM.POS.3 BLOCKED — CONTRATO REMOTO PENDIENTE**

**ECOM.POS.3.1 implementada en código y pendiente de validación ejecutable/remota.**

El PR `#90` debe permanecer como **draft**. La migración fue actualizada en el repositorio, pero no se aplicó en Supabase producción. No se ejecutó smoke test contra producción y no se utilizó Vercel como evidencia.

## Rama y PR

- Repositorio: `fdxruli/Lanzo-POS`
- Rama: `fase-ecom-pos-3`
- PR: `#90 — FASE ECOM.POS.3 — Cobrar y convertir pedidos ecommerce en ventas POS`
- Base: `main`
- Merge automático: no realizado
- Estado requerido del PR: draft
- HEAD final: consultar la descripción actualizada del PR #90 y la entrega de esta revisión; un archivo versionado no puede contener de forma autorreferencial el SHA del commit que lo contiene.

## Precondición histórica de ECOM.POS.3

Antes de crear la rama se confirmó:

- PR #89 mergeado;
- `main` con ECOM.POS.2, ECOM.POS.2.1 y ECOM.POS.2.1.1;
- ausencia de otra rama o PR abierto para ECOM.POS.3;
- creación de `fase-ecom-pos-3` desde `main` actualizado.

---

# ECOM.POS.3.1 — Recuperación e idempotencia fail-closed

## Objetivo correctivo

ECOM.POS.3.1 corrige tres bloqueantes:

1. recuperación insegura de `processing_sale` cuando la venta cloud existe pero aún no se materializó en Dexie;
2. reservas `pos_conversion_status = 'reserved'` huérfanas al liberar administrativamente un borrador;
3. lectura de idempotencia local fail-open cuando Dexie no puede determinar si ya existe una venta ecommerce.

La arquitectura original se conserva:

- checkout canónico;
- lock canónico;
- modal de pago y QuickCaja canónicos;
- `processSale` canónico;
- snapshot financiero inmutable;
- reserva remota antes de vender;
- confirmación ecommerce posterior a la venta;
- clave determinista `ecommerce:<ecommerceOrderId>`;
- guards condicionales únicamente para `order.origin === 'ecommerce'`.

## Archivos modificados por ECOM.POS.3.1

### Implementación

- `src/services/salesService.js`
- `src/services/salesCloud/salesCloudCashierService.js`
- `src/services/ecommerce/ecommercePosConversionService.js`
- `src/hooks/pos/useEcommercePosCheckoutGate.js`
- `supabase/migrations/20260711235900_ecom_pos_3_complete_conversion.sql`

### Pruebas

- `src/services/__tests__/salesService.ecommerce.test.js`
- `src/services/salesCloud/__tests__/salesCloudCashierService.ecommerce.test.js`
- `src/services/ecommerce/__tests__/ecommercePosConversionService.test.js`
- `src/hooks/pos/__tests__/useEcommercePosCheckoutGate.test.js`
- `supabase/tests/ecom_pos_3_1_recovery_release_test.sql`

### Documentación

- `reports/ecom_pos_3_checkout_conversion_report.md`
- descripción del PR #90

Durante la revisión se restauró además el comportamiento de `moveCancelledSaleToTrash` de `main`, porque el diff de ECOM.POS.3 había eliminado accidentalmente la validación que permite enviar a papelera únicamente ventas canceladas. Esta restauración evita una regresión ajena al alcance ecommerce.

---

## Bloqueante 1 — Recuperación segura de `processing_sale`

### Causa raíz

La recuperación anterior consultaba únicamente Dexie. Si no encontraba una venta, trataba la ausencia local como prueba de que el commit no ocurrió y cancelaba la reserva remota.

En el modo cloud existe una ventana válida:

1. el RPC cloud confirma la venta;
2. todavía no se guarda el snapshot local;
3. la aplicación se interrumpe;
4. Dexie aparece vacío aunque la venta sí existe remotamente.

Cancelar la reserva en esa ventana reabría la posibilidad de un cobro duplicado.

### Corrección

`recoverEcommercePosConversion(...)` ahora separa resultados y estados:

#### `validating` y `payment_pending`

Solo pueden liberar la reserva cuando se confirma positivamente:

- ausencia de venta local;
- ausencia de venta cloud cuando el modo sea cloud o desconocido;
- reserva remota todavía perteneciente al mismo `attemptId` y dispositivo;
- ausencia de conversión remota completada.

#### `processing_sale`

No libera la reserva por una lectura vacía de Dexie.

Orden de recuperación:

1. relee `ecommerce_get_pos_conversion_state(...)`;
2. consulta una venta local cerrada con la clave exacta;
3. si el modo fue cloud o es desconocido, consulta el módulo canónico `salesCloud` por:
   - `local_sale_id` / sale ID estable;
   - clave idempotente ecommerce;
   - paginación del snapshot cloud cuando la lectura directa no sea concluyente;
4. si encuentra la venta cloud, reconstruye el snapshot local con `salesCloudLocalRepository`;
5. conserva el mismo `saleId`;
6. pasa a `confirmation_pending`;
7. no abre pago ni ejecuta `processSale` otra vez.

### Resultado incierto

Cuando falla la lectura local, cloud o remota:

```text
ECOMMERCE_SALE_VERIFICATION_PENDING
```

Mensaje:

```text
No se pudo confirmar todavía si la venta fue registrada. El pedido permanece reservado para evitar un cobro duplicado.
```

Se conservan:

- `ecommerceConversionAttemptId`;
- `ecommerceCheckoutSnapshot`;
- `ecommerceConvertedSaleId`, cuando exista;
- reserva remota;
- borrador local.

El checkout queda bloqueado.

### Identidad cloud estable

Para ecommerce, el commit cloud utiliza directamente:

```text
ecommerce:<ecommerceOrderId>
```

No agrega sufijo por dispositivo. El backend cloud ya protege idempotencia por licencia + key.

Las ventas POS normales conservan el formato histórico con sufijo del dispositivo. No se modificó su contrato de idempotencia.

---

## Bloqueante 2 — Liberación administrativa y reservas huérfanas

### Causa raíz

La versión histórica de:

```text
ecommerce_admin_release_pos_draft(...)
```

limpiaba draft y claim, pero desconocía:

- `pos_conversion_status`;
- `pos_conversion_attempt_id`;
- `pos_conversion_sale_id`;
- `pos_conversion_key`;
- `pos_conversion_actor_ref`;
- `pos_conversion_started_at`.

Una reserva podía quedar permanentemente `reserved` después de liberar el borrador.

### Corrección aplicada en la migración

La misma firma pública fue redefinida de forma compatible.

La operación:

- autentica licencia, dispositivo y sesión mediante el helper vigente;
- bloquea la orden con `FOR UPDATE`;
- mantiene idempotencia para un draft ya liberado y conversión `idle`;
- rechaza cualquier liberación cuando:
  - `converted_sale_id is not null`;
  - `pos_conversion_status = 'completed'`;
  - `status = 'converted_to_sale'`;
- impide que un dispositivo normal libere una reserva perteneciente a otro dispositivo;
- consulta el read model remoto de ventas antes de limpiar una reserva;
- devuelve fail-closed cuando la verificación no está disponible:

```text
ECOMMERCE_POS_CONVERSION_REVIEW_REQUIRED
```

### Limpieza atómica autorizada

Cuando se demuestra ausencia de venta, la misma transacción limpia:

- draft y claim históricos;
- `pos_conversion_status = 'idle'`;
- `pos_conversion_attempt_id = null`;
- `pos_conversion_sale_id = null`;
- `pos_conversion_key = null`;
- `pos_conversion_actor_ref = null`;
- `pos_conversion_started_at = null`.

No se utiliza antigüedad como prueba de ausencia de venta.

### Auditoría

Cuando existía una reserva, se registra:

```text
pos_conversion_admin_released
```

Payload no sensible:

- razón;
- actor y dispositivo;
- intento anterior;
- sale ID reservado;
- clave de conversión;
- estado anterior del draft;
- estado anterior de conversión;
- timestamp.

No se almacenan claim tokens ni security tokens.

La operación también conserva el evento histórico:

```text
order_pos_draft_released
```

### Cancelación normal

`ecommerce_cancel_pos_conversion(...)` también consulta la venta remota antes de limpiar una reserva. Una venta encontrada o una verificación no concluyente bloquean la cancelación.

---

## Bloqueante 3 — Idempotencia local fail-closed

### Causa raíz

`salesService` capturaba errores de Dexie y devolvía `null`. Esto mezclaba:

- venta comprobada como inexistente;
- imposibilidad de leer ventas.

Después, `_processSaleInternal(...)` podía ejecutarse como si no existiera una venta anterior.

### Corrección

La lectura devuelve un resultado estructurado:

```js
{ success: true, sale: existingSale || null }
```

O, ante fallo:

```js
{
  success: false,
  code: 'ECOMMERCE_SALE_READ_FAILED'
}
```

Antes de vender:

- una lectura fallida impide llamar `_processSaleInternal` y `processSaleCore`;
- no se modifica caja;
- no se descuenta inventario ni lote;
- no se cancela automáticamente la reserva;
- se devuelve un error recuperable.

Después de un error interno:

- se realiza una segunda lectura idempotente;
- si encuentra venta, devuelve replay idempotente;
- si la lectura falla, devuelve `ECOMMERCE_SALE_READ_FAILED`;
- no interpreta el error original como evidencia de ausencia;
- no ejecuta un retry automático ecommerce.

Las ventas POS normales continúan usando el retry de `RACE_CONDITION` y no pasan por la lectura ecommerce.

---

## Contrato remoto vigente

El contrato requerido es:

```text
contractVersion = 2
```

Cuatro RPC públicas:

```text
ecommerce_get_pos_conversion_state(...)
ecommerce_begin_pos_conversion(...)
ecommerce_cancel_pos_conversion(...)
ecommerce_complete_pos_conversion(...)
```

Operación administrativa compatible:

```text
ecommerce_admin_release_pos_draft(...)
```

Helper privado añadido:

```text
private.ecommerce_pos_sale_lookup_v2(...)
```

El helper privado no tiene grants para `anon` ni `authenticated`. Las tablas ecommerce continúan sin acceso directo de clientes.

---

## Política final de recuperación

| Estado local | Venta encontrada | Consulta concluyente sin venta | Consulta fallida/incierta |
|---|---|---|---|
| `validating` | `confirmation_pending` | cancela reserva propia y libera lock | conserva reserva y bloquea |
| `payment_pending` | `confirmation_pending` | cancela reserva propia y libera lock | conserva reserva y bloquea |
| `processing_sale` | reconstruye local si es cloud; `confirmation_pending` | cancela solo tras ausencia local+cloud positiva | `ECOMMERCE_SALE_VERIFICATION_PENDING`; conserva todo |
| `sale_created` | `confirmation_pending` | no libera; requiere revisión | conserva reserva y bloquea |
| `confirmation_pending` | reintenta únicamente confirmación | no libera; requiere revisión | conserva reserva y bloquea |
| `completed` | limpia borrador residual | no aplica | no aplica |

---

## Pruebas añadidas o actualizadas

### `salesService.ecommerce.test.js`

- fallo Dexie antes de vender;
- `_processSaleInternal` no llamado;
- segunda lectura fallida después de error interno;
- reserva marcada para conservación;
- venta POS normal sin guard ecommerce;
- retry POS normal de `RACE_CONDITION` conservado.

### `salesCloudCashierService.ecommerce.test.js`

- ecommerce usa clave estable sin sufijo de dispositivo;
- POS normal conserva sufijo histórico;
- recuperación cloud por `local_sale_id`;
- reconstrucción local;
- ausencia cloud concluyente;
- consulta cloud incierta.

### `ecommercePosConversionService.test.js`

- `processing_sale` + venta cloud + Dexie vacío;
- reserva no cancelada;
- recuperación a `confirmation_pending`;
- consulta cloud incierta;
- lectura Dexie fallida;
- liberación únicamente después de ausencia positiva;
- `payment_pending` local recuperable.

### `useEcommercePosCheckoutGate.test.js`

- propiedad del lock por actor e intento;
- resultado incierto conserva snapshot e intento.

### `ecom_pos_3_1_recovery_release_test.sql`

Verifica estructuralmente:

- `FOR UPDATE`;
- rechazo de conversión completada;
- `ECOMMERCE_POS_CONVERSION_REVIEW_REQUIRED`;
- limpieza completa de campos;
- auditoría `pos_conversion_admin_released`;
- protección contra otro dispositivo;
- contractVersion 2;
- existencia de los cuatro RPC;
- grants compatibles;
- helper privado no ejecutable por roles cliente.

No se eliminaron ni debilitaron pruebas existentes. No se añadieron `.skip`, `.todo`, `eslint-disable` ni workflows temporales.

---

## Validación técnica

### Comandos solicitados

```text
npm ci
ESLint específico
Vitest específico
npm run build
npm run lint
npm run test:ci
git diff --check origin/main...HEAD
git status --short
```

### Resultado real disponible

No fue posible ejecutar los comandos Node en el entorno disponible porque no existía un checkout local y el intento de obtenerlo falló por red:

```text
git clone --depth 1 --branch fase-ecom-pos-3 https://github.com/fdxruli/Lanzo-POS.git
fatal: unable to access 'https://github.com/fdxruli/Lanzo-POS.git/': Could not resolve host: github.com
```

No se creó un workflow temporal para eludir esta limitación.

GitHub no reportó ejecuciones de Actions para el HEAD consultado durante esta revisión. El único contexto externo observado fue Vercel, que no se utilizó, promovió ni consideró evidencia.

Por honestidad, los siguientes resultados permanecen pendientes:

- `npm ci`: no ejecutado;
- ESLint específico: no ejecutado;
- Vitest específico: no ejecutado;
- build: no ejecutado;
- lint global: no ejecutado;
- `test:ci`: no ejecutado;
- `git diff --check`: no ejecutado sobre checkout real;
- `git status --short`: no disponible sin checkout.

Se realizó revisión estática del diff, contratos existentes de `salesCloud`, firma SQL, grants y rutas canónicas. Esta revisión no sustituye la validación ejecutable.

## Comparación contra `main`

La rama continúa basada en `main`, sin commits detrás en la comparación consultada durante la corrección. Los cambios correctivos se limitaron a recuperación, idempotencia, cloud cashier, migración, pruebas y documentación. También se restauró la validación de papelera exactamente conforme a `main`.

La comparación final exacta y el HEAD se registran en la descripción del PR y en la entrega de esta tarea después del último commit documental.

---

## Supabase

- Producción: **sin cambios**.
- Migración ECOM.POS.3/3.1: **solo versionada**.
- RPC aplicadas: **no**.
- RPC validadas en producción: **no**.
- Modificaciones manuales: **ninguna**.

## Vercel

- preview creado: no;
- preview forzado: no;
- promoción: no;
- validación manual: no;
- usado como evidencia: no.

## Smoke test

No se realizó smoke test real contra producción, conforme a la restricción de la tarea.

---

## Bloqueos pendientes

No se puede declarar `PASS` ni marcar el PR ready for review mientras falte:

1. validación ejecutable limpia de ESLint, Vitest, build, lint y `test:ci`;
2. aplicación autorizada de la migración;
3. validación de contractVersion 2 y los cuatro RPC;
4. pruebas SQL en entorno de prueba;
5. smoke test real autorizado;
6. verificación real de una sola venta, una sola caja y un solo descuento de inventario/lote.

## Resultado

**ECOM.POS.3.1 CORREGIDA EN CÓDIGO — VALIDACIÓN Y CONTRATO REMOTO PENDIENTES**

**ECOM.POS.3 BLOCKED — CONTRATO REMOTO PENDIENTE**

El PR #90 permanece draft y no debe mergearse todavía.
