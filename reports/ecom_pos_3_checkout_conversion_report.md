# FASE ECOM.POS.3 — Cobrar y convertir pedidos ecommerce en ventas POS

## Estado actual

**CONTRATO REMOTO APLICADO EN PRODUCCIÓN**

**HISTORIAL LOCAL Y REMOTO ALINEADO**

**PR DRAFT — PRUEBAS FUNCIONALES PENDIENTES**

La implementación de ECOM.POS.3, ECOM.POS.3.1 y ECOM.POS.3.1.1 permanece en la rama `fase-ecom-pos-3`. Durante ECOM.POS.3.2 no se aplicaron migraciones, no se ejecutó SQL de escritura, no se modificó el historial remoto y no se utilizó Vercel como evidencia.

## Rama y PR

- Repositorio: `fdxruli/Lanzo-POS`
- Rama: `fase-ecom-pos-3`
- PR: `#90 — FASE ECOM.POS.3 — Cobrar y convertir pedidos ecommerce en ventas POS`
- Base: `main`
- Estado requerido: draft
- Merge automático: no realizado
- HEAD: consultar la descripción actualizada del PR; el reporte evita incluir de forma autorreferencial el SHA del commit que lo contiene

---

## Contrato de conversión ECOM.POS.3

La fase mantiene el flujo canónico:

1. preparar el pedido ecommerce como borrador POS;
2. resolver inventario y lotes;
3. reservar remotamente la conversión;
4. ejecutar el checkout POS canónico;
5. confirmar la venta local o cloud;
6. completar remotamente la conversión ecommerce;
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
ecommerce_admin_release_pos_draft(...)
```

Helper privado preservado:

```text
private.ecommerce_pos_sale_lookup_v2(...)
```

---

## ECOM.POS.3.1 — Recuperación e idempotencia fail-closed

Se conservan las correcciones previas:

- `processing_sale` no interpreta una lectura vacía de Dexie como prueba de que la venta no ocurrió;
- la recuperación consulta el estado remoto y, cuando corresponde, la venta cloud;
- una lectura local o cloud incierta conserva intento, snapshot, borrador y reserva;
- la lectura idempotente distingue ausencia confirmada de error de lectura;
- la clave cloud ecommerce permanece estable entre dispositivos;
- las ventas POS normales conservan su comportamiento histórico.

La cancelación controlada:

```text
ecommerce_cancel_pos_conversion(...)
```

continúa validando actor, `attemptId`, `saleId`, `conversionKey`, claim token, bloqueo `FOR UPDATE` y verificación remota mediante `private.ecommerce_pos_sale_lookup_v2(...)`.

---

## ECOM.POS.3.1.1 — Liberación administrativa fail-closed

La política final de:

```text
ecommerce_admin_release_pos_draft(...)
```

permanece intacta:

| Estado | Resultado administrativo |
|---|---|
| `idle` | puede liberar draft y claim |
| `reserved` | `ECOMMERCE_POS_CONVERSION_REVIEW_REQUIRED` |
| `completed` o pedido convertido | `ECOMMERCE_POS_CONVERSION_ALREADY_COMPLETED` |
| desconocido | `ECOMMERCE_POS_CONVERSION_REVIEW_REQUIRED` |

La ruta administrativa no consulta `private.ecommerce_pos_sale_lookup_v2(...)` ni usa la ausencia en `public.pos_sales` para autorizar la liberación de una reserva.

Cuando la conversión está `reserved`, permanecen sin cambios:

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

La liberación `idle` conserva el evento histórico:

```text
order_pos_draft_released
```

Una reserva bloqueada no crea:

```text
order_pos_draft_released
pos_conversion_admin_released
```

El frontend conserva el mensaje seguro:

```text
Este pedido tiene un cobro en revisión y no puede liberarse todavía. Verifica la venta antes de continuar.
```

No expone claim token, `attemptId`, `conversionKey` ni detalles internos de Supabase.

---

## ECOM.POS.3.2 — Alineación del historial de migraciones

### Motivo

El contrato fue preparado inicialmente como una migración monolítica del repositorio:

```text
20260711235900_ecom_pos_3_complete_conversion
```

La primera llamada monolítica fue bloqueada por la limitación de la herramienta antes de realizar cambios. Para aplicar el contrato, el SQL se dividió operativamente en siete migraciones ordenadas. Las siete devolvieron éxito y quedaron registradas en Supabase producción.

La versión monolítica `20260711235900` nunca fue registrada como aplicada.

Mantener el monolito en el repositorio habría producido drift: un futuro comando de migraciones podría considerarlo una migración local adicional aunque su contrato ya estuviera materializado mediante las siete versiones remotas.

### Historial remoto confirmado

Proyecto Supabase:

```text
odlrhijtfyavryeqivaa
```

Producción contiene exactamente:

```text
20260712032309  ecom_pos_3_conversion_schema
20260712032334  ecom_pos_3_conversion_state_rpc
20260712032400  ecom_pos_3_begin_conversion_rpc
20260712032421  ecom_pos_3_cancel_conversion_rpc
20260712032444  ecom_pos_3_complete_conversion_rpc
20260712032510  ecom_pos_3_admin_release_fail_closed
20260712032526  ecom_pos_3_conversion_grants
```

Producción no registra:

```text
20260711235900  ecom_pos_3_complete_conversion
```

### Alineación del repositorio

Se eliminó:

```text
supabase/migrations/20260711235900_ecom_pos_3_complete_conversion.sql
```

Se crearon exactamente:

```text
supabase/migrations/20260712032309_ecom_pos_3_conversion_schema.sql
supabase/migrations/20260712032334_ecom_pos_3_conversion_state_rpc.sql
supabase/migrations/20260712032400_ecom_pos_3_begin_conversion_rpc.sql
supabase/migrations/20260712032421_ecom_pos_3_cancel_conversion_rpc.sql
supabase/migrations/20260712032444_ecom_pos_3_complete_conversion_rpc.sql
supabase/migrations/20260712032510_ecom_pos_3_admin_release_fail_closed.sql
supabase/migrations/20260712032526_ecom_pos_3_conversion_grants.sql
```

No se creó una octava migración.

### Distribución del contrato

#### `20260712032309_ecom_pos_3_conversion_schema.sql`

Contiene exclusivamente:

- columnas de conversión;
- backfill de `pos_conversion_status`;
- constraint `ecommerce_orders_pos_conversion_status_valid`;
- índice `ux_ecommerce_orders_license_pos_conversion_key`.

#### `20260712032334_ecom_pos_3_conversion_state_rpc.sql`

Contiene exclusivamente:

```text
private.ecommerce_pos_sale_lookup_v2(...)
public.ecommerce_get_pos_conversion_state(...)
```

Conserva `SECURITY DEFINER`, `SET search_path TO ''` y `contractVersion = 2`.

#### `20260712032400_ecom_pos_3_begin_conversion_rpc.sql`

Contiene exclusivamente:

```text
public.ecommerce_begin_pos_conversion(...)
```

Conserva autorización, `FOR UPDATE`, claim, clave `ecommerce:<orderId>`, idempotencia, reserva, evento `pos_conversion_reserved` y versión 2.

#### `20260712032421_ecom_pos_3_cancel_conversion_rpc.sql`

Contiene exclusivamente:

```text
public.ecommerce_cancel_pos_conversion(...)
```

Conserva validación de actor/intento, lookup remoto fail-closed, evento `pos_conversion_cancelled` y limpieza exclusiva de los campos de reserva.

#### `20260712032444_ecom_pos_3_complete_conversion_rpc.sql`

Contiene exclusivamente:

```text
public.ecommerce_complete_pos_conversion(...)
```

Conserva `converted_to_sale`, `completed`, `converted_sale_id`, `converted_at`, archivo de visibilidad, evento y broadcast.

#### `20260712032510_ecom_pos_3_admin_release_fail_closed.sql`

Contiene exclusivamente la redefinición de:

```text
public.ecommerce_admin_release_pos_draft(...)
```

Conserva la política fail-closed de ECOM.POS.3.1.1 y no consulta el lookup remoto para autorizar una liberación administrativa.

#### `20260712032526_ecom_pos_3_conversion_grants.sql`

Contiene exclusivamente:

- revocación del helper privado;
- revocación inicial de las cinco RPC públicas;
- `GRANT EXECUTE` a `anon, authenticated` para las cinco RPC;
- revocación de acceso directo a `public.ecommerce_orders` y `public.ecommerce_order_events`.

### Verificación estructural

La revisión de los siete archivos confirmó:

- cada función se define una sola vez dentro del conjunto dividido;
- `contractVersion` permanece en `2`;
- admin release devuelve `REVIEW_REQUIRED` para `reserved`;
- admin release no llama `ecommerce_pos_sale_lookup_v2`;
- cancel conversion sí llama `ecommerce_pos_sale_lookup_v2`;
- el helper privado queda revocado para `public`, `anon` y `authenticated`;
- las cinco RPC públicas reciben `EXECUTE` para `anon` y `authenticated`;
- columnas, constraint e índice aparecen únicamente en la migración de esquema;
- el orden de dependencias local coincide con el orden remoto.

### Comparación local/remota

| Local | Remote | Estado |
|---|---|---|
| `20260712032309` | `20260712032309` | alineado |
| `20260712032334` | `20260712032334` | alineado |
| `20260712032400` | `20260712032400` | alineado |
| `20260712032421` | `20260712032421` | alineado |
| `20260712032444` | `20260712032444` | alineado |
| `20260712032510` | `20260712032510` | alineado |
| `20260712032526` | `20260712032526` | alineado |

No queda ninguna de estas siete versiones como `remote only` o `local only`.

### Herramientas y operaciones

El binario `supabase` no está instalado en el entorno de revisión, por lo que `supabase --version` y `supabase migration list --help` no pudieron devolver una versión. El historial remoto se verificó mediante la API oficial de solo lectura `list_migrations`; el historial local se verificó directamente sobre los archivos de la rama y el diff de GitHub.

Durante la alineación no se ejecutó:

```text
supabase db push
supabase migration repair
supabase db reset
supabase db pull
```

Tampoco se ejecutaron migraciones, DDL, `UPDATE`, `INSERT`, `DELETE` ni SQL manual contra producción.

---

## Pruebas SQL del repositorio

Se conserva sin cambios funcionales:

```text
supabase/tests/ecom_pos_3_1_recovery_release_test.sql
```

La prueba continúa validando el contrato final mediante firmas y comportamiento, no el nombre del archivo monolítico eliminado.

No se ejecutó la prueba contra producción durante ECOM.POS.3.2.

---

## Validación funcional

Las pruebas funcionales y smoke tests quedan pendientes y serán ejecutados por el usuario.

No se declara validación funcional `PASS`.

---

## Restricciones respetadas

- Supabase producción: **sin cambios adicionales**
- Migraciones ejecutadas durante ECOM.POS.3.2: **ninguna**
- SQL de escritura durante ECOM.POS.3.2: **ninguno**
- Historial remoto reparado o modificado: **no**
- `supabase db push`: **no utilizado**
- `supabase migration repair`: **no utilizado**
- Workflow temporal: **no creado**
- Vercel manual: **no utilizado**
- Preview Vercel: **no creado, forzado, promovido ni validado**
- `main`: **sin modificación directa**
- Nuevo PR: **no creado**
- Merge automático: **no realizado**
- Estado del PR: **draft**

---

## Resultado

```text
ECOM.POS.3.2 ALINEACIÓN DE MIGRACIONES PASS
CONTRATO REMOTO APLICADO EN PRODUCCIÓN
HISTORIAL LOCAL Y REMOTO ALINEADO
PR DRAFT — PRUEBAS FUNCIONALES PENDIENTES
```
