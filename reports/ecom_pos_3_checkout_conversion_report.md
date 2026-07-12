# FASE ECOM.POS.3 — Cobrar y convertir pedidos ecommerce en ventas POS

## Estado actual

**ECOM.POS.3.1.1 CORREGIDA EN CÓDIGO**

**VALIDACIÓN SQL PENDIENTE**

**CONTRATO REMOTO NO APLICADO**

**PR #90 DRAFT**

La corrección puntual está versionada en la rama `fase-ecom-pos-3`. La migración no fue aplicada en Supabase producción, no se ejecutó SQL manual contra producción y no se utilizó Vercel como evidencia.

## Rama y PR

- Repositorio: `fdxruli/Lanzo-POS`
- Rama: `fase-ecom-pos-3`
- PR: `#90 — FASE ECOM.POS.3 — Cobrar y convertir pedidos ecommerce en ventas POS`
- Base: `main`
- Estado requerido: draft
- Merge automático: no realizado
- HEAD: consultar el PR; este reporte no incorpora el SHA del commit que lo contiene para evitar autorreferencia

## Precondiciones verificadas

Antes de reescribir la migración se confirmó:

- el PR #90 continuaba abierto y en draft;
- `contractVersion` continuaba en `2`;
- las cuatro RPC de conversión continuaban definidas;
- Supabase producción no registraba la migración `20260711235900_ecom_pos_3_complete_conversion`;
- no existía obligación de crear una migración correctiva posterior porque la migración aún no había sido aplicada en el entorno compartido relevante.

Por esa razón la corrección se realizó directamente sobre:

```text
supabase/migrations/20260711235900_ecom_pos_3_complete_conversion.sql
```

La migración permanece sin aplicar.

---

# ECOM.POS.3 — Contrato de conversión

La fase mantiene el flujo canónico:

1. preparar un pedido ecommerce como borrador POS;
2. resolver inventario y lotes;
3. reservar remotamente la conversión;
4. ejecutar el checkout POS canónico;
5. confirmar la venta local o cloud;
6. confirmar remotamente la conversión ecommerce;
7. archivar el pedido como `converted_to_sale`.

La clave de negocio continúa siendo:

```text
ecommerce:<ecommerceOrderId>
```

El contrato remoto continúa en:

```text
contractVersion = 2
```

RPC públicas preservadas:

```text
ecommerce_get_pos_conversion_state(...)
ecommerce_begin_pos_conversion(...)
ecommerce_cancel_pos_conversion(...)
ecommerce_complete_pos_conversion(...)
```

La firma administrativa compatible continúa disponible:

```text
ecommerce_admin_release_pos_draft(...)
```

---

# ECOM.POS.3.1 — Recuperación e idempotencia fail-closed

ECOM.POS.3.1 conserva las correcciones previas:

- `processing_sale` no interpreta una lectura vacía de Dexie como prueba de que la venta no ocurrió;
- la recuperación consulta estado remoto y, cuando corresponde, venta cloud;
- una lectura local o cloud incierta conserva el intento y bloquea otro cobro;
- la lectura idempotente de Dexie distingue ausencia confirmada de error de lectura;
- la clave cloud ecommerce permanece estable entre dispositivos;
- las ventas POS normales conservan su comportamiento histórico.

La cancelación controlada:

```text
ecommerce_cancel_pos_conversion(...)
```

no fue debilitada. Continúa validando:

- actor;
- `attemptId`;
- `saleId`;
- `conversionKey`;
- claim token;
- bloqueo `FOR UPDATE`;
- verificación remota existente.

---

# ECOM.POS.3.1.1 — Liberación administrativa fail-closed

## Problema de seguridad

La versión anterior de:

```text
ecommerce_admin_release_pos_draft(...)
```

permitía liberar una reserva activa cuando no encontraba una venta en:

```text
public.pos_sales
```

Esa ausencia remota no demuestra ausencia local.

El flujo POS puede completar primero la transacción local:

```text
executeSaleTransactionSafe(...)
→ commit de venta en Dexie
→ inventario descontado
→ caja afectada
→ respuesta success
→ syncSaleShadowAfterLocalCommit(...) asíncrono
```

Existe por tanto una ventana válida en la que:

1. la venta ecommerce ya existe localmente;
2. caja e inventario ya fueron afectados;
3. el shadow remoto todavía no se ejecutó o falló;
4. `public.pos_sales` no conoce aún la venta;
5. una liberación administrativa basada en esa ausencia permitiría volver a cobrar el pedido.

La ausencia en `public.pos_sales` no puede utilizarse como prueba de que la venta no existe en Dexie.

## Política final

### Conversión completada

Cuando se cumple cualquiera de estas condiciones:

```text
converted_sale_id is not null
pos_conversion_status = 'completed'
status = 'converted_to_sale'
```

la RPC devuelve:

```text
ECOMMERCE_POS_CONVERSION_ALREADY_COMPLETED
```

No modifica ninguna columna.

### Reserva activa

Cuando:

```text
pos_conversion_status = 'reserved'
```

la RPC devuelve siempre:

```text
ECOMMERCE_POS_CONVERSION_REVIEW_REQUIRED
```

La rama se evalúa antes del `UPDATE` de liberación y no llama:

```text
private.ecommerce_pos_sale_lookup_v2(...)
```

No se libera por:

- antigüedad;
- claim vencido;
- dispositivo desconectado;
- ausencia en `public.pos_sales`;
- ausencia de `converted_sale_id`.

Se conservan sin cambios:

```text
pos_draft_status
pos_draft_id
pos_claim_token
pos_claim_request_key
pos_claimed_at
pos_claim_expires_at
pos_claim_actor_type
pos_claim_actor_ref
pos_draft_prepared_at
pos_conversion_status
pos_conversion_attempt_id
pos_conversion_sale_id
pos_conversion_key
pos_conversion_actor_ref
pos_conversion_started_at
```

Esto mantiene bloqueado un segundo cobro hasta que exista una recuperación separada y controlada.

### Conversión idle

Solo cuando:

```text
coalesce(pos_conversion_status, 'idle') = 'idle'
```

se permite el comportamiento histórico:

- liberar el draft;
- limpiar el claim;
- dejar la conversión en `idle`;
- registrar `order_pos_draft_released`;
- emitir el broadcast histórico.

### Estado desconocido

Cualquier estado distinto de:

```text
idle
reserved
completed
```

retorna:

```text
ECOMMERCE_POS_CONVERSION_REVIEW_REQUIRED
```

No se corrige automáticamente.

## Auditoría

Una liberación `idle` crea:

```text
order_pos_draft_released
```

Una reserva `reserved` bloqueada no crea:

```text
order_pos_draft_released
pos_conversion_admin_released
```

La auditoría falsa de liberación fue retirada de la ruta administrativa.

## Mensaje frontend

`src/services/ecommerce/ecommerceOrderService.js` incorpora el mensaje seguro:

```text
Este pedido tiene un cobro en revisión y no puede liberarse todavía. Verifica la venta antes de continuar.
```

La normalización ignora el mensaje crudo de la RPC y no expone:

- claim token;
- `attemptId`;
- `conversionKey`;
- detalles internos de Supabase.

---

# Pruebas

## Prueba SQL estructural y transaccional

Archivo:

```text
supabase/tests/ecom_pos_3_1_recovery_release_test.sql
```

La prueba se ejecuta dentro de una transacción y termina con `ROLLBACK`.

Cobertura versionada:

1. draft `prepared` + conversión `idle`:
   - libera correctamente;
   - limpia draft y claim;
   - mantiene conversión `idle`;
   - crea únicamente `order_pos_draft_released`;
2. draft ya `released` + conversión `idle`:
   - `success = true`;
   - `changed = false`;
   - `idempotent = true`;
   - no duplica auditoría;
3. conversión `reserved` sin venta remota:
   - confirma primero la ausencia en el read model;
   - devuelve `ECOMMERCE_POS_CONVERSION_REVIEW_REQUIRED`;
   - conserva draft, claim y todos los campos de reserva;
4. conversión `reserved` con venta remota:
   - devuelve exactamente el mismo código;
   - no modifica el pedido;
   - no registra liberación;
5. conversión completada:
   - devuelve `ECOMMERCE_POS_CONVERSION_ALREADY_COMPLETED`;
   - no modifica el pedido;
6. estado inesperado:
   - habilitado temporalmente dentro de la transacción de prueba;
   - devuelve revisión requerida;
   - no modifica el pedido;
7. contrato estructural:
   - `reserved` se bloquea antes del `UPDATE`;
   - la función administrativa no contiene la llamada al lookup remoto;
   - la cancelación normal conserva dicha verificación;
   - `contractVersion` permanece en `2`;
   - las cuatro RPC continúan presentes;
   - los grants compatibles continúan presentes.

La prueba SQL está versionada pero no fue ejecutada contra producción. Su ejecución permanece pendiente en una base de prueba autorizada con las migraciones aplicadas temporalmente.

## Prueba frontend

Archivo:

```text
src/services/ecommerce/__tests__/ecommerceOrderService.test.js
```

Se agregó cobertura para confirmar que:

- `ECOMMERCE_POS_CONVERSION_REVIEW_REQUIRED` se mapea al mensaje seguro;
- el mensaje crudo del servidor se descarta;
- no se exponen `attemptId`, `conversionKey` ni claim token.

---

# Archivos modificados por ECOM.POS.3.1.1

```text
supabase/migrations/20260711235900_ecom_pos_3_complete_conversion.sql
supabase/tests/ecom_pos_3_1_recovery_release_test.sql
src/services/ecommerce/ecommerceOrderService.js
src/services/ecommerce/__tests__/ecommerceOrderService.test.js
reports/ecom_pos_3_checkout_conversion_report.md
```

No se modificaron:

- checkout;
- `processSale`;
- inventario;
- caja;
- lotes;
- servicios cloud;
- contratos de venta POS normal.

---

# Regresión esperada

La corrección no cambia:

- claim de pedidos;
- preparación de borradores;
- liberación de drafts `idle`;
- checkout ecommerce;
- recuperación `processing_sale`;
- confirmación remota;
- idempotencia cloud;
- ventas POS normales;
- caja;
- inventario;
- lotes.

---

# Validación

## Confirmado estáticamente

- PR #90 permanece draft;
- migración de ECOM.POS.3 no aparece aplicada en producción;
- `contractVersion` continúa en `2`;
- las cuatro RPC permanecen definidas y con grants compatibles;
- `reserved` retorna antes del `UPDATE`;
- la función administrativa ya no consulta `private.ecommerce_pos_sale_lookup_v2`;
- `idle` conserva liberación e idempotencia;
- `completed` permanece protegido;
- auditoría falsa retirada;
- mensaje frontend seguro agregado.

## Pendiente de ejecución

El entorno disponible no pudo obtener un checkout íntegro por fallo de resolución DNS hacia GitHub y no dispone del binario `gh`. Por ello no se simulan resultados para:

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

También permanece pendiente la prueba SQL en un entorno autorizado con las migraciones aplicadas dentro de una transacción o base de prueba.

No se creó ningún workflow temporal para sustituir esta validación.

---

# Restricciones respetadas

- Supabase producción: **sin cambios**
- SQL manual contra producción: **no ejecutado**
- Migración aplicada: **no**
- Vercel manual: **no utilizado**
- Preview Vercel: **no creado, forzado, promovido ni validado**
- Workflow temporal: **no creado**
- `main`: **sin modificación directa**
- Nuevo PR: **no creado**
- Merge automático: **no realizado**
- Estado del PR: **draft**

---

# Resultado

```text
ECOM.POS.3.1.1 CORREGIDA EN CÓDIGO
VALIDACIÓN SQL PENDIENTE
CONTRATO REMOTO NO APLICADO
PR DRAFT
```

La política administrativa final es:

| Estado de conversión | Liberación administrativa |
|---|---|
| `idle` | permitida |
| `reserved` sin venta remota | bloqueada |
| `reserved` con venta remota | bloqueada |
| `completed` | bloqueada |
| desconocido | bloqueada |

`public.pos_sales` no autoriza liberar una reserva activa.
