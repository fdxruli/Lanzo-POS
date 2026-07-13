# ECOM.ORDERS.2 — Seguimiento público y ciclo operativo del pedido

## Estado

**ECOM.ORDERS.2.1 implementado en código y Supabase. Validación frontend local, build y pruebas manuales pendientes. El PR debe permanecer draft. No mergear.**

- Repositorio: `fdxruli/Lanzo-POS`
- Rama: `fase-ecom-orders-2`
- PR: `#94 — FASE ECOM.ORDERS.2 — Seguimiento público y ciclo operativo del pedido`
- HEAD remoto verificado antes de iniciar ECOM.ORDERS.2.1: `64cb06e6e5cbb4e5f9164074d4b313e00d127dc9`
- HEAD funcional antes de este commit documental: `c9add7393cb3edec8634cb8e9a1ee6fa3ab5481a`
- Estado del PR: `DRAFT`
- Merge: `NO REALIZADO`
- `supabase db push`: no utilizado
- `supabase migration repair`: no utilizado
- Vercel manual: no utilizado
- Preview manual: no creado, promovido, redeployado ni validado

## Alcance de ECOM.ORDERS.2.1

Se corrigieron dos bloqueantes y dos defectos funcionales:

1. pedidos con fulfillment terminal todavía podían iniciar o continuar trabajo POS;
2. el rate limit público podía evadirse rotando tokens inválidos;
3. el tracking dejaba de resolver al pausar o despublicar el portal;
4. pedidos terminales no convertidos permanecían en la bandeja y contadores operativos.

La solución conserva separados:

- estado base del pedido;
- estado operativo de fulfillment;
- estado de conversión POS;
- estado de pago.

`converted_to_sale` no se interpreta como entregado.

## Restricciones respetadas

No se modificaron:

- `processSale`;
- FEFO;
- reservas ni movimientos de inventario;
- movimientos de caja;
- `checkoutAttemptId`;
- `conversionKey`;
- confirmación remota;
- las seis migraciones originales ya aplicadas.

Las rutas POS existentes se conservaron como implementaciones privadas y se envolvieron con guards server-side estrictos.

## Migraciones originales conservadas

Estas seis migraciones no fueron editadas:

1. `20260712235439_ecom_orders_2_tracking_schema.sql`
2. `20260712235807_ecom_orders_2_tracking_rpc.sql`
3. `20260713000133_ecom_orders_2_fulfillment_state_machine.sql`
4. `20260713000326_ecom_orders_2_grants_realtime_hardening.sql`
5. `20260713002329_ecom_orders_2_conversion_independence_hardening.sql`
6. `20260713003008_ecom_orders_2_converted_fulfillment_visibility.sql`

## Migraciones compensatorias aplicadas

### 1. Política terminal atómica

**Archivo e historial remoto**

`20260713011641_ecom_orders_2_1_terminal_fulfillment_policy.sql`

**Objetivo**

- definir `completed` y `cancelled` como fulfillment terminal;
- aplicar la política segura de cancelación bajo el mismo lock de fila;
- impedir por defensa en profundidad que se inicie trabajo POS después de terminalizar;
- archivar pedidos terminales;
- devolver errores estables y controlados.

**Precondiciones y preflight**

- timestamp inexistente local/remotamente antes de aplicar;
- SQL revisado por bloques;
- helpers, trigger y RPC compilados dentro de `BEGIN/ROLLBACK`;
- el primer preflight monolítico fue rechazado por el límite de tamaño del conector antes de ejecutar SQL; no hubo cambios.

**Política aplicada**

- sin claim, borrador ni conversión: permite terminalizar y archiva;
- claim activo sin draft preparado: libera el claim atómicamente y limpia sus campos;
- draft preparado: bloquea con `ECOMMERCE_ORDER_POS_DRAFT_PREPARED`;
- conversión reservada/en progreso: bloquea con `ECOMMERCE_ORDER_POS_CONVERSION_IN_PROGRESS`;
- fulfillment ya terminal: bloquea con `ECOMMERCE_ORDER_FULFILLMENT_TERMINAL`;
- pedido ya convertido: permite continuar/cancelar fulfillment sin revertir venta, pago, caja o inventario.

**Verificación**

- trigger `ecommerce_orders_block_terminal_pos_mutation` presente;
- owner `postgres`;
- `SECURITY DEFINER` y `search_path=''`;
- cero grants directos a helpers privados;
- pedidos terminales visibles después del backfill: `0`.

**Rollback compensatorio disponible**

Una migración nueva podría restaurar la versión anterior de la RPC y retirar el trigger. No se ejecutó rollback destructivo.

### 2. Visibilidad operativa e historial explícito

**Archivo e historial remoto**

`20260713011837_ecom_orders_2_1_terminal_operational_visibility.sql`

**Objetivo**

- excluir terminales del listado, filtros y contadores operativos;
- conservar convertidos no terminales en la bandeja;
- permitir recuperar un pedido terminal mediante detalle explícito por ID y licencia.

**Preflight**

La redefinición de snapshot, detalle y listado compiló dentro de `BEGIN/ROLLBACK`.

**Verificación**

- `all`, `pending`, `accepted` y conteos excluyen `completed/cancelled`;
- `accepted` incluye `accepted` y `converted_to_sale` no terminales;
- detalle explícito no depende de `pos_visibility_status`;
- owner, grants y `search_path` conservados.

**Rollback compensatorio disponible**

Una migración nueva podría restaurar los filtros anteriores sin eliminar pedidos ni eventos.

### 3. Guards terminales en rutas POS

**Archivo e historial remoto**

`20260713012025_ecom_orders_2_1_pos_terminal_guards.sql`

**Objetivo**

Aplicar lock y guard terminal antes de iniciar o continuar las rutas POS relevantes.

**Funciones envueltas**

- `ecommerce_admin_claim_pos_draft`;
- `ecommerce_admin_confirm_pos_draft`;
- `ecommerce_begin_pos_conversion`;
- `ecommerce_complete_pos_conversion`;
- `ecommerce_get_pos_conversion_state`.

Las implementaciones canónicas anteriores fueron movidas al esquema privado y continúan ejecutándose detrás de los wrappers. La liberación de borrador y cancelación de reserva permanecen disponibles como limpieza segura; el trigger defensivo impide que creen nuevo trabajo terminal.

**Preflight**

Renombrado, cambio de esquema, wrappers y firmas compilaron dentro de `BEGIN/ROLLBACK`.

**Verificación**

- wrappers con owner `postgres`, `SECURITY DEFINER`, `search_path=''`;
- implementaciones privadas sin `EXECUTE` para `PUBLIC`, `anon` o `authenticated`;
- firmas públicas mantienen grants esperados;
- recuperación idempotente de una conversión ya completada conserva su contrato.

**Rollback compensatorio disponible**

Una migración nueva podría retirar wrappers y devolver las implementaciones privadas al esquema público.

### 4. Resolver de tracking y rate limit estable

**Archivo e historial remoto**

`20260713012117_ecom_orders_2_1_tracking_resolver_rate_limit.sql`

**Objetivo**

- resolver pedidos existentes aunque el portal esté pausado/despublicado;
- mantener bloqueados catálogo y pedidos nuevos;
- impedir evasión del rate limit rotando tokens;
- conservar respuesta pública allowlisted y uniforme.

**Resolver**

`private.ecommerce_get_tracking_portal_by_slug_v1(...)` exige:

- slug normalizado;
- portal no eliminado lógicamente;
- licencia no revocada, eliminada, deshabilitada ni bloqueada.

No exige `status = published`, por lo que solo el tracking existente usa esta excepción.

**Rate limit por capas**

Bucket obligatorio, antes de validar el token:

- scope: `ECOMMERCE_ORDER_TRACKING_PORTAL`;
- identidad: licencia + portal;
- límite: 600 solicitudes / 600 segundos;
- bloqueo: 300 segundos.

Bucket secundario, únicamente después de resolver un token válido:

- scope: `ECOMMERCE_ORDER_TRACKING_TOKEN`;
- identidad: hash parcial del token;
- límite: 120 solicitudes / 600 segundos;
- bloqueo: 300 segundos.

El token plano no se persiste en metadata ni logs. Las filas del scope antiguo dependiente del token fueron eliminadas mediante la migración versionada.

**Payload**

Se agregó `storefrontAvailable`, booleano allowlisted. La UI puede mantener el tracking y ocultar enlaces de catálogo/nuevo pedido cuando la tienda está pausada.

**Preflight y verificación**

- resolver y RPC compilaron dentro de `BEGIN/ROLLBACK`;
- owner `postgres`, `SECURITY DEFINER`, `search_path=''`;
- helper privado sin grants directos;
- scope anterior persistente: `0` filas.

**Rollback compensatorio disponible**

Una migración nueva podría restaurar el resolver anterior y retirar los scopes nuevos. No se ejecutó rollback destructivo.

## Pruebas SQL ejecutadas

### Suite transaccional original

`supabase/tests/ecom_orders_2_public_tracking_and_fulfillment_test.sql`

Se conserva sin debilitar.

### Suite correctiva

`supabase/tests/ecom_orders_2_1_terminal_tracking_hardening_test.sql`

La suite crea dentro de una transacción:

- licencia temporal;
- dispositivo admin temporal;
- portal temporal;
- ocho pedidos con estados y conflictos distintos.

Todas las operaciones finalizan con `ROLLBACK`.

**Casos ejecutados**

- accepted sin claim → cancelled → claim POS bloqueado;
- claim activo → cancelación libera claim atómicamente;
- draft preparado → cancelación bloqueada;
- conversión reservada → cancelación bloqueada;
- completed → claim bloqueado;
- cancelled → begin conversion bloqueado;
- expected version obsoleta;
- replay idempotente sin evento duplicado;
- misma llave con otra transición bloqueada;
- tres tokens inválidos distintos consumen un único bucket de portal;
- token válido crea bucket secundario;
- token plano no queda en metadata;
- payload sin PII, secretos, IDs internos ni token;
- tracking funciona con portal `paused`;
- creación de pedido nuevo continúa bloqueada con portal pausado;
- token revocado deja de resolver;
- portal eliminado lógicamente deja de resolver;
- terminales no aparecen en lista/conteos;
- convertido no terminal permanece visible.

**Incidentes de prueba documentados**

1. primer fixture falló porque `order_number` es `GENERATED ALWAYS`; transacción revertida;
2. segundo fixture falló porque `public_order_code` es generado; transacción revertida;
3. se creó un helper temporal que inserta únicamente columnas no generadas/no identity;
4. ejecución final terminó sin excepciones y con `ROLLBACK`.

**Resultado**

PASS para la suite SQL correctiva. No quedaron licencias fixture persistentes (`0`).

## Cambios frontend

### Servicio de fulfillment

- mensajes controlados para terminal, draft preparado y conversión POS en progreso;
- no aplica cambios optimistas;
- conserva versión esperada e idempotency key en el contrato.

### Panel de fulfillment

- conflictos server-side provocan refetch del estado autoritativo;
- al completar/cancelar, actualiza lista y contadores;
- cierra el detalle terminal si sigue seleccionado;
- terminales no muestran acciones.

### Tracking público

- normaliza `storefrontAvailable`;
- el cache mantiene solo payload allowlisted bajo clave derivada por hash;
- realtime continúa siendo solamente una señal de refetch;
- si el portal está pausado, mantiene el tracking y oculta acceso al catálogo/nuevo pedido.

## Pruebas frontend agregadas o actualizadas

- `src/services/ecommerce/__tests__/ecommerceOrderFulfillmentService.test.js`
- `src/services/ecommerce/__tests__/ecommerceOrderTrackingService.test.js`
- `src/components/ecommerce/orders/EcommerceFulfillmentPanel.test.jsx`
- `src/pages/__tests__/PublicOrderTrackingPage.unpublished.test.jsx`

Cubren:

- errores `ECOMMERCE_ORDER_FULFILLMENT_TERMINAL`;
- draft preparado y conversión POS en progreso;
- terminales sin acciones;
- retiro del pedido terminal y actualización de contadores;
- tracking con portal despublicado;
- error uniforme;
- realtime usado solo como señal;
- ausencia de controles de catálogo cuando `storefrontAvailable=false`.

**Estado de ejecución**

Las pruebas fueron escritas y revisadas estáticamente, pero no pudieron ejecutarse en este entorno. No se declaran PASS.

## Validación local

No se dispone de checkout autenticado ni dependencias instaladas en el entorno conectado. `gh` tampoco está disponible. Por ello no se ejecutaron:

```bash
npm ci
npx eslint <archivos modificados>
npx vitest run <suites enfocadas>
npm run build
git diff --check
git status --short
```

**Resultado parcial**

- migraciones y SQL: ejecutados y verificados;
- frontend: implementación y pruebas añadidas, no ejecutadas;
- build/lint/diff local: pendientes;
- validación manual: pendiente.

No se utiliza el check automático de Vercel como sustituto del build local.

## Verificación final de Supabase

- cuatro migraciones correctivas presentes en historial remoto;
- trigger terminal presente;
- terminales con visibilidad operativa distinta de `archived`: `0`;
- licencias fixture persistentes: `0`;
- filas legacy de rate limit de tracking: `0`;
- funciones críticas con owner `postgres`;
- funciones críticas con `SECURITY DEFINER` y `search_path=''`;
- grants directos de helpers privados para `PUBLIC/anon/authenticated`: `0`;
- grants públicos de RPC conservados para los roles esperados.

## Archivos añadidos o modificados por ECOM.ORDERS.2.1

- `reports/ecom_orders_2_public_tracking_and_fulfillment_report.md`
- `src/components/ecommerce/orders/EcommerceFulfillmentPanel.jsx`
- `src/components/ecommerce/orders/EcommerceFulfillmentPanel.test.jsx`
- `src/pages/PublicOrderTrackingPage.jsx`
- `src/pages/PublicOrderTrackingPage.css`
- `src/pages/__tests__/PublicOrderTrackingPage.unpublished.test.jsx`
- `src/services/ecommerce/ecommerceOrderFulfillmentService.js`
- `src/services/ecommerce/ecommerceOrderTrackingService.js`
- `src/services/ecommerce/__tests__/ecommerceOrderFulfillmentService.test.js`
- `src/services/ecommerce/__tests__/ecommerceOrderTrackingService.test.js`
- `supabase/migrations/20260713011641_ecom_orders_2_1_terminal_fulfillment_policy.sql`
- `supabase/migrations/20260713011837_ecom_orders_2_1_terminal_operational_visibility.sql`
- `supabase/migrations/20260713012025_ecom_orders_2_1_pos_terminal_guards.sql`
- `supabase/migrations/20260713012117_ecom_orders_2_1_tracking_resolver_rate_limit.sql`
- `supabase/tests/ecom_orders_2_1_terminal_tracking_hardening_test.sql`

## Riesgos residuales y validaciones pendientes

- ejecutar Vitest enfocado y regresiones POS/ecommerce;
- ejecutar ESLint enfocado;
- ejecutar build local real;
- verificar `git diff --check` y árbol limpio;
- probar manualmente pickup y delivery;
- probar conflicto entre dos sesiones autorizadas;
- probar responsive, focus visible, offline y realtime en navegador;
- confirmar recuperación histórica de terminales desde la navegación disponible;
- revisión técnica y de seguridad independiente.

## Estado final requerido

```text
PR #94: DRAFT
Merge: NO REALIZADO
Ready for review: NO
PASS global: NO DECLARADO
```
