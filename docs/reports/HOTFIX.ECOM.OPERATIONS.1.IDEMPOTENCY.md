# HOTFIX ECOM.OPERATIONS.1.IDEMPOTENCY

Fecha: 2026-07-15. Proyecto Supabase: `odlrhijtfyavryeqivaa`.

## 1. Resumen ejecutivo

**ESTADO: IMPLEMENTACIÓN COMPLETA — PR PENDIENTE DE REVISIÓN.**

Se aplicó una migración compensatoria que conserva la definición remota efectiva de `public.ecommerce_create_order(text,jsonb,jsonb,text)` y adelanta exclusivamente el lookup/retorno idempotente. La función ya devuelve el pedido existente antes de cualquier validación aplicable sólo a un pedido nuevo, incluido fulfillment y rate limit.

No hubo cambios frontend, Vercel, configuración, ramas remotas, PR ni merge.

## 2. Main y Git

`main` fue verificado contra GitHub antes del cambio: `913aa04c538bc7b9373e3ca78b0ede33bdb0dcf4` (`2026-07-15T13:09:35Z`, `fdxruli`, `Add files via upload`).

El workspace no contiene `.git`; siguiendo la instrucción, no se ejecutó `git init` ni se creó una rama local. Para subir los archivos mediante GitHub web, usar explícitamente:

`RAMA DESTINO: hotfix-ecom-operations-1-idempotency`

No se creó PR. Título previsto de draft: `HOTFIX ECOM.OPERATIONS.1 — Corregir recuperación idempotente de pedidos`.

## 3. Defecto y severidad

**Severidad: alta.** La definición remota anterior ejecutaba `private.ecommerce_enforce_create_order_rate_limit` antes del lookup por `(portal_id, idempotency_key)`; además validaba cliente/fulfillment antes del lookup. Por ello, un reintento de una orden existente podía responder `ECOMMERCE_PICKUP_NOT_AVAILABLE` o quedar expuesto al rate limit.

## 4. Migración compensatoria

Archivo local: `supabase/migrations/20260715170000_hotfix_ecom_operations_1_idempotency.sql`.

Aplicación remota registrada: `20260715164925_hotfix_ecom_operations_1_idempotency` (el servicio asignó su versión de historial al aplicar la migración). OPERATIONS.1 previa permanece intacta como `20260715061240_ecom_operations_1_business_hours`.

La migración usa `CREATE OR REPLACE FUNCTION` con la definición remota completa capturada antes de aplicar. No usa `replace()` ni un parche textual dinámico.

## 5. Firma, seguridad y grants

| Control | Resultado |
|---|---|
| Firma | `ecommerce_create_order(text,jsonb,jsonb,text)`; default de key conservado |
| Owner | `postgres` |
| SECURITY DEFINER | Sí |
| search_path | vacío (`search_path=""`) |
| Grants | `anon`, `authenticated`, `service_role`, `postgres` |

## 6. Orden anterior y corregido

Anterior: portal → key → cliente/fulfillment → rate limit → lookup existente → availability.

Corregido: portal → key → lookup existente → retorno idempotente → cliente/fulfillment → rate limit → guard availability inicial → carrito/productos → `FOR UPDATE` → guard pre-insert → insert.

La inspección final de la definición remota arroja posiciones crecientes: portal 990, key 1171, lookup existente 1483, retorno existente 1633, cliente 2015, rate limit 3463, primer guard 3721 y lock 8564.

## 7. Contratos preservados

La definición base remota completa conservó: resolución pública de portal, key truncada a 160 caracteres, validación de cliente/teléfono/fulfillment/dirección, order inbox, rate limit, disponibilidad, carrito, UUIDs, productos, cantidades, stock, mínimo, precios servidor, lock, insert de orders/items, tracking, WhatsApp, eventos/notificaciones, y handler seguro.

La inspección final confirma: 2 evaluaciones de availability, 1 `FOR UPDATE`, 1 insert principal de `ecommerce_orders` y 1 handler `unique_violation`. El segundo guard sigue después del lock; el handler de carrera permanece.

## 8. Matriz de regresión

| Escenario | Antes | Después |
|---|---|---|
| Misma key y pickup deshabilitado | Error pickup | Pedido existente |
| Misma key y cliente inválido | Error cliente | Pedido existente |
| Misma key y tienda pausada | Pedido existente | Pedido existente |
| Misma key y tienda cerrada | Pedido existente | Pedido existente |
| Key nueva y pickup deshabilitado | Error pickup | Error pickup |
| Key nueva y tienda pausada | Bloqueado | Bloqueado |
| Key nueva y tienda cerrada | Bloqueado | Bloqueado |

La prueba dedicada crea una orden sintética, conserva y compara ID, tracking token/path, reintenta con pickup deshabilitado y payload inválido, comprueba ausencia de duplicados/items adicionales y reintenta con ordering deshabilitado/cerrado. También conserva las comprobaciones de pausa, horarios, staff, stock, ventas y caja de OPERATIONS.1.

## 9. Pruebas SQL y residuos

| Prueba | Resultado |
|---|---|
| `supabase/tests/hotfix_ecom_operations_1_idempotency_test.sql` | PASS; transacción terminada en ROLLBACK |
| `supabase/tests/ecom_operations_1_business_hours_test.sql` | PASS; transacción terminada en ROLLBACK |
| Residuos: licencia/portal/pedido sintético | 0 / 0 / 0 |

| Control | Resultado |
|---|---|
| Lookup antes de cliente | PASS |
| Lookup antes de fulfillment | PASS |
| Lookup antes de rate limit | PASS |
| Lookup antes de availability | PASS |
| Dos guards availability | PASS |
| Guard después de lock | PASS |
| Unique violation conservado | PASS |
| Tracking conservado | PASS |
| WhatsApp conservado | PASS |
| Evento único | Conservado estructuralmente; la matriz no lo contó por fila |
| Notificación única | Conservada por flujo existente; no se contó por fila |
| Pedido único | PASS |
| Items únicos | PASS |
| Residuos | PASS |

## 10. Vercel y riesgos

No se ejecutó deployment manual, preview deliberado, promoción de alias ni cambio de configuración Vercel. No se aplicaron cambios React/CSS/servicios públicos o administrativos.

Riesgo residual: los tres archivos locales no están en una rama Git porque la copia no contiene metadata. Deben subirse sin alterar `main`, a `hotfix-ecom-operations-1-idempotency`, y revisarse en un único PR draft. La corrección server-side ya está aplicada; la migración en Git debe conservarse para reproducibilidad de entornos futuros.

## 11. Archivos

Creados:

* `supabase/migrations/20260715170000_hotfix_ecom_operations_1_idempotency.sql`
* `supabase/tests/hotfix_ecom_operations_1_idempotency_test.sql`
* `docs/reports/HOTFIX.ECOM.OPERATIONS.1.IDEMPOTENCY.md`

Modificados: ninguno.

## 12. Conclusión

El reintento idempotente ahora ignora correctamente validaciones destinadas a pedidos nuevos, sin perder los contratos de tracking, WhatsApp, items, eventos, notificaciones, stock, límites o los dos guards de disponibilidad. El servidor quedó corregido y está listo para revisión del PR draft; no está mergeado.
