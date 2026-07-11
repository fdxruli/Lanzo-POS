# FASE ECOM.POS.1 — Preparar pedidos aceptados como borradores POS

- Fecha: 2026-07-10 (`America/Merida`)
- Repositorio: `fdxruli/Lanzo-POS`
- Rama: `fase-ecom-pos-1`
- Base: `main` en `b7dc505` (merge del PR #86)
- Proyecto Supabase: `odlrhijtfyavryeqivaa`
- Migración local: `20260711022044_ecom_pos_1_prepare_order_draft.sql`
- Migración aplicada: `20260711024125 / ecom_pos_1_prepare_order_draft`

## Estado

`ECOM.POS.1 PASS`.

Un pedido `accepted` puede reclamarse con exclusión mutua, convertirse en una orden activa local determinística y revisarse dentro del POS. La preparación no llama `processSale`, no crea una venta y no afecta caja, inventario, lotes, clientes, crédito, comandas, pagos, `converted_sale_id` ni el estado principal del pedido.

## Arquitectura

El flujo implementado es:

1. La bandeja obtiene el detalle autorizado, incluidos `sourceProductId`, `publishedProductId` y el estado seguro de `posDraft`.
2. `ecommerce_admin_claim_pos_draft` bloquea la fila con `FOR UPDATE`, valida `accepted`, permiso y aislamiento por licencia, y crea un claim de 15 minutos.
3. `ecommercePosDraftService` resuelve todos los artículos contra `useProductStore.getState().menu`.
4. Si falta un producto, se libera el claim y no se crea ningún borrador parcial.
5. `useActiveOrders.upsertEcommerceDraft` inserta atómicamente la orden `ecom-<order_uuid>` o activa la pestaña ya existente.
6. `ecommerce_admin_confirm_pos_draft` cambia únicamente `pos_draft_status` a `prepared` y registra el evento.
7. El POS muestra procedencia, modalidad, total esperado y advertencias de conciliación.
8. El checkout se bloquea tanto al iniciar el pago como dentro de `handleProcessOrder`.
9. La liberación llama primero a Supabase; solo después del éxito elimina la orden local.

## Modelo de datos

Se agregaron nueve columnas a `public.ecommerce_orders`:

- `pos_draft_status text not null default 'none'`;
- `pos_draft_id text`;
- `pos_claim_token uuid`;
- `pos_claim_request_key text`;
- `pos_claimed_at timestamptz`;
- `pos_claim_expires_at timestamptz`;
- `pos_claim_actor_type text`;
- `pos_claim_actor_ref text`;
- `pos_draft_prepared_at timestamptz`.

Los constraints permiten exclusivamente `none`, `claimed`, `prepared` y `released`, y exigen coherencia completa entre token, request key, actor, draft ID y timestamps. El índice `ix_ecommerce_orders_license_pos_draft_expiry` cubre `(license_id, pos_draft_status, pos_claim_expires_at)`.

## RPC e idempotencia

### `ecommerce_admin_claim_pos_draft`

- usa `SECURITY DEFINER` y `SET search_path=''`;
- reutiliza la autorización custom-auth existente;
- requiere `ecommerce=true` y `pos=true` para staff;
- filtra siempre por el `license_id` autorizado;
- usa `FOR UPDATE`;
- acepta solo `status='accepted'` y `converted_sale_id is null`;
- devuelve el mismo token para el mismo request key y dispositivo;
- bloquea un segundo dispositivo con `ECOMMERCE_POS_DRAFT_IN_PROGRESS`;
- reemplaza claims `claimed` vencidos;
- nunca reemplaza `prepared` sin liberación explícita.

El token se genera con `extensions.gen_random_uuid()`. `pos_claim_actor_ref` guarda el UUID interno del dispositivo, no el fingerprint.

### `ecommerce_admin_confirm_pos_draft`

Valida token, dueño, vigencia, licencia y estado; luego escribe exclusivamente los campos del borrador y el evento `order_pos_draft_prepared`. La misma combinación `order_id + token + draft_id` es idempotente.

### `ecommerce_admin_release_pos_draft`

Permite liberar `claimed` o `prepared` al dispositivo dueño, o mediante una operación administrativa autorizada. Limpia todos los campos del claim, deja `pos_draft_status='released'`, conserva `status='accepted'` y registra `order_pos_draft_released`.

## Detalle y eventos

`ecommerce_admin_get_order` ahora expone por artículo:

- `sourceProductId`;
- `publishedProductId`;
- nombre, precio, cantidad, total y opciones aceptadas.

También expone `posDraft` con estado, draft ID y timestamps. `claimToken` solo aparece para el mismo dispositivo dueño con permiso POS vigente.

El historial reconoce:

- `order_pos_draft_claimed`;
- `order_pos_draft_prepared`;
- `order_pos_draft_released`.

El payload público permite únicamente `draftId`, `deviceRole` y `reasonCode`. No contiene fingerprint, claim token, security token, staff token ni PII.

## Grants y seguridad

Verificación de producción:

- tres RPC nuevas: `anon=true`, `authenticated=true`, `PUBLIC=false`;
- tres RPC nuevas: `SECURITY DEFINER=true`, `search_path=''`;
- helpers `ecommerce_pos_draft_authorize_v1` y `ecommerce_order_pos_snapshot_v1`: cerrados para `anon`, `authenticated` y `PUBLIC`;
- cero `SELECT` directo cliente sobre pedidos, artículos, eventos, dispositivos, usuarios staff o sesiones staff;
- nueve columnas, dos constraints y el índice nuevo presentes.

Los advisors reportan las seis advertencias esperadas por RPC `SECURITY DEFINER` ejecutable por `anon/authenticated`. Son intencionales: Lanzo usa la publishable key sin Supabase Auth y cada RPC ejecuta la autorización custom de licencia, dispositivo, security token, sesión staff, permisos, feature flag, rate limit y `license_id`. El advisor también marca el índice nuevo como no usado inmediatamente después de su creación; es informativo y esperado.

Referencias de los advisors: [RPC SECURITY DEFINER para anon](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [RPC SECURITY DEFINER para authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [índice aún no usado](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

## Mapeo local y PII

`ecommercePosDraftService`:

- exige `sourceProductId` para todos los artículos;
- rechaza productos inexistentes, eliminados, archivados o inactivos;
- construye líneas desde el producto POS real;
- conserva `item.unitPrice` como precio visible;
- guarda `currentPosPrice` para conciliación;
- agrega snapshot, opciones, origen y `priceSource='ecommerce_snapshot'`;
- marca `needsInventoryResolution` para productos con lotes;
- no selecciona ni compromete lotes;
- no modifica permanentemente productos locales.

La orden persistida no contiene nombre del cliente, teléfono, dirección, notas ni URL de WhatsApp. `ecommerceLicenseIdentity` es una identidad local compuesta de 128 bits derivada de licencia y actor; no contiene la clave de licencia en claro.

## Aislamiento y carreras

La preparación captura una identidad de licencia/actor/permisos. Antes de escribir y después de cada await comprueba que siga vigente. Logout, cambio de licencia, cambio de staff o revocación de `ecommerce/pos` invalida la respuesta y libera el claim cuando corresponde.

`EcommerceOrdersRuntime` elimina fail-closed los borradores de otro contexto. El servicio colapsa doble click por `context + order_id`, y `useActiveOrders` reutiliza la pestaña determinística sin duplicar artículos.

## UI y bloqueo de checkout

La bandeja muestra:

- `Preparar en Punto de Venta` para `none/released`;
- `Continuar preparación` para claim propio;
- `En preparación en otro dispositivo` para claim ajeno;
- `Abrir en Punto de Venta` y `Liberar borrador` para `prepared`.

El POS muestra un banner sin PII con código, modalidad, total esperado y estado. Advierte diferencias de subtotal/precio y lotes pendientes, y permite volver al detalle autorizado.

`useCheckoutFlow` bloquea `handleInitiateCheckout`, `handleProcessOrder` y el retorno desde caja rápida con el código estable `ECOMMERCE_POS_CHECKOUT_NOT_ENABLED`. Las órdenes POS normales conservan el flujo de pago.

## Pruebas SQL

Se ejecutó primero la migración completa dentro de `BEGIN/ROLLBACK`; después de aplicarla se repitió `supabase/tests/ecom_pos_1_prepare_draft_test.sql` dentro de otra transacción con rollback.

Resultado: `ECOM.POS.1 SQL PASS`.

Casos cubiertos:

- admin y staff `ecommerce+pos` reclaman;
- staff sin uno de los dos permisos queda bloqueado;
- sesión inválida bloqueada;
- `new`, `rejected` y `converted_to_sale` bloqueados;
- request key idempotente;
- segundo dispositivo bloqueado;
- claim vencido reemplazable;
- token incorrecto bloqueado;
- confirmación válida y repetida;
- liberación válida, administrativa y ajena bloqueada;
- grants públicos/privados exactos;
- tablas cerradas.

La verificación final confirmó que `EC-00000010`, `EC-00000011` y `EC-00000012` conservaron sus estados previos, `converted_sale_id=NULL`, `pos_draft_status='none'`, token nulo, cero dispositivos temporales y cero eventos temporales.

## Pruebas frontend y regresión

Suites específicas nuevas/modificadas: **6 PASS, 46 pruebas PASS**.

La regresión ampliada ejecutó ecommerce, bandeja/ruta, catálogo/checkout público, navegación, órdenes activas, checkout, ventas, inventario y notificaciones:

- **22 suites PASS**;
- **175 pruebas PASS**;
- cuatro fallos heredados en `inventoryFlow` y `processSaleCore` se reprodujeron idénticos en `main`.

`npm run test:ci`:

| Checkout | Suites | Pruebas | Resultado |
| --- | ---: | ---: | --- |
| `main` | 81 pass / 26 fail | 484 pass / 74 fail | baseline heredado |
| `fase-ecom-pos-1` | 84 pass / 26 fail | 502 pass / 74 fail | +3 suites y +18 pruebas; mismos fallos |

Los 26 archivos fallidos son exactamente los mismos en ambos checkouts.

## ESLint y build

ESLint específico de toda la superficie modificada: **PASS**, cero errores y cero warnings.

`npm run lint`:

| Checkout | Errores | Warnings | Comparación |
| --- | ---: | ---: | --- |
| `main` | 156 | 226 | baseline |
| `fase-ecom-pos-1` | 156 | 226 | cero nuevos |

`npm run build`:

- rama: **PASS**, 3,285 módulos transformados, PWA generada;
- `main`: **PASS**, 3,283 módulos transformados, PWA generada.

## Efectos financieros y operativos

No se llamó `processSale` durante preparación. No se creó venta local/cloud, pago, movimiento de caja, reserva permanente, descuento de inventario, lote definitivo, cliente, deuda, crédito, comanda, WhatsApp automático ni conversión ecommerce.

## Vercel

Vercel no fue utilizado manualmente. No se creó ni validó preview, no se usó API/CLI/agente, no se promovió deployment y ningún check automático se usó como evidencia.

## Resultado final

```text
ECOM.POS.1 PASS

Claim seguro: PASS
Idempotencia: PASS
Mapeo de productos: PASS
Orden activa POS: PASS
Aislamiento de licencia: PASS
Protección de PII: PASS
Checkout bloqueado: PASS
Efectos financieros: NINGUNO
Supabase: PASS
Build global: PASS
Vercel manual: NO UTILIZADO
```
