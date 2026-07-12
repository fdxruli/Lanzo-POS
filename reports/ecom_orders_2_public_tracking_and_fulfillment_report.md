# ECOM.ORDERS.2 — Seguimiento público y ciclo operativo del pedido

## Estado

**Implementación en curso. PR debe permanecer draft. No mergear.**

- Repositorio: `fdxruli/Lanzo-POS`
- HEAD inicial verificado de `main`: `c5d38b43f92b936c195f677fbd30a062091bbcb9`
- Precondición: PR `#93` confirmado como mergeado
- Rama creada: `fase-ecom-orders-2`
- Base exacta de la rama: `c5d38b43f92b936c195f677fbd30a062091bbcb9`
- Vercel manual: no utilizado
- Preview manual: no creado
- Merge: no realizado

## Arquitectura elegida para tokens

Se utilizará un token opaco determinístico firmado con HMAC-SHA-256:

1. secreto versionado por portal en `private.ecommerce_order_tracking_keys`;
2. material firmado compuesto exclusivamente por identificadores server-side;
3. token con prefijo/version y firma codificada base64url;
4. almacenamiento exclusivo de `SHA-256(token)` y `token_last4`;
5. recomputación con la versión de clave registrada para devolver el mismo token en reintentos idempotentes;
6. revocación mediante `revoked_at`, sin almacenar el token plano.

El token no se persistirá en tablas públicas, metadata, notificaciones ni logs.

## Modelo operativo

Campos aditivos en `public.ecommerce_orders`:

- `fulfillment_status`
- `fulfillment_version`
- `fulfillment_updated_at`
- `public_status_message`

Estados:

`accepted`, `preparing`, `ready`, `out_for_delivery`, `completed`, `cancelled`, `attention`.

El estado base `new/seen/accepted/rejected` no se reutiliza como estado operativo. La venta POS y la entrega permanecen separadas.

## Contratos RPC previstos

- Pública: `ecommerce_get_order_tracking(p_slug, p_tracking_token)`
- Administrativa: `ecommerce_admin_update_order_fulfillment(...)`

Ambas serán `SECURITY DEFINER` con `SET search_path = ''`. La RPC pública devolverá solamente un payload allowlisted y usará un error uniforme para token inválido, revocado o de otro portal.

## Archivos modificados

Se actualizará esta sección durante la implementación.

- `reports/ecom_orders_2_public_tracking_and_fulfillment_report.md`

## Migraciones

### Migración 1 — tracking schema y columnas operativas

**Objetivo**

Crear estructuras privadas de claves/tokens/eventos, columnas operativas aditivas, constraints, índices, backfill conservador y trigger de inicialización al aceptar.

**Precondiciones**

- `main` y PR #93 verificados.
- Proyecto Supabase `odlrhijtfyavryeqivaa` activo.
- `pgcrypto` disponible en esquema `extensions`.
- No existe ninguna migración ECOM.ORDERS.2 en historial remoto.
- SQL completo revisado.
- Preflight transaccional con `BEGIN`/`ROLLBACK`: **PASS**.

**SQL aplicado**

Pendiente de aplicación. El nombre/timestamp remoto se registrará inmediatamente después de `apply_migration`.

**Resultado**

Pendiente.

**Historial remoto**

Pendiente.

**Verificaciones previstas**

- columnas y defaults;
- constraints validados;
- índices no duplicados;
- tablas privadas con RLS;
- cero grants directos para `anon` y `authenticated`;
- backfill exclusivo de pedidos aceptados;
- pedidos rechazados y ventas sin modificación.

**Riesgos**

- Backfill de pedidos aceptados existentes: mitigado con estado conservador `accepted`, nunca `completed`.
- Claves y hashes: permanecen en esquema privado sin acceso Data API.

**Rollback disponible**

DDL aditivo reversible antes de uso, preservando datos de pedidos. No se ejecutará rollback destructivo sin incidente documentado.

### Migración 2 — generación y lookup seguro

Pendiente.

### Migración 3 — máquina de estados administrativa

Pendiente.

### Migración 4 — grants, realtime y hardening

Pendiente.

## Rate limits

Pendiente de implementación y verificación.

## Pruebas SQL

- Preflight transaccional de migración 1: **PASS**, finalizó con `ROLLBACK`.

## Pruebas frontend

Pendientes.

## Build local

Pendiente. El entorno de ejecución disponible no tiene checkout local ni conectividad Git para clonar; se documentará sin sustituirlo por Vercel.

## Fallos heredados

No evaluados todavía.

## Riesgos pendientes

- Validación frontend y build local.
- Pruebas manuales de pickup/delivery.
- Revisión técnica y de seguridad.
- Confirmación de historial local/remoto tras cada migración.

## Pruebas manuales

Pendientes en desarrollo local.

## Estado del PR

Pendiente de creación; deberá crearse como draft y permanecer así.
