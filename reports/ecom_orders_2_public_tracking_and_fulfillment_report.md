# ECOM.ORDERS.2 — Seguimiento público y ciclo operativo del pedido

## Estado

**ECOM.ORDERS.2.2 quedó implementado en código y Supabase. Las pruebas SQL enfocadas pasaron con `ROLLBACK`. Vitest, ESLint, build y pruebas manuales continúan pendientes; por tanto no se declara PASS global y el PR debe permanecer draft.**

- Repositorio: `fdxruli/Lanzo-POS`
- Rama: `fase-ecom-orders-2`
- PR: `#94 — FASE ECOM.ORDERS.2 — Seguimiento público y ciclo operativo del pedido`
- HEAD inicial verificado para ECOM.ORDERS.2.2: `0ff0e7b89f861fc20527a093378376c0eb9dfc13`
- HEAD funcional final previo al commit documental: `3607c5be2a351a63cb9a5ed12cc4cbe0af20ad3b`
- Estado del PR: `DRAFT`
- Merge: `NO REALIZADO`
- Ready for review: `NO`
- `supabase db push`: no utilizado
- `supabase migration repair`: no utilizado
- Vercel manual: no utilizado
- Preview manual: no creado, promovido, redeployado ni validado

El HEAD final del PR se verifica después del commit documental en la descripción del PR y en la entrega, evitando una referencia autorreferencial dentro de este mismo archivo.

## Restricciones respetadas

No se modificaron:

- `processSale`;
- reservas de inventario;
- FEFO;
- movimientos de caja;
- movimientos de inventario;
- `conversionKey`;
- `checkoutAttemptId`;
- confirmación remota;
- las diez migraciones previamente aplicadas de ECOM.ORDERS.2 y ECOM.ORDERS.2.1.

No se crearon workflows temporales ni se intentó evadir `build-rate-limit`.

## Diez migraciones anteriores conservadas

Ninguno de estos archivos fue editado:

1. `20260712235439_ecom_orders_2_tracking_schema.sql`
2. `20260712235807_ecom_orders_2_tracking_rpc.sql`
3. `20260713000133_ecom_orders_2_fulfillment_state_machine.sql`
4. `20260713000326_ecom_orders_2_grants_realtime_hardening.sql`
5. `20260713002329_ecom_orders_2_conversion_independence_hardening.sql`
6. `20260713003008_ecom_orders_2_converted_fulfillment_visibility.sql`
7. `20260713011641_ecom_orders_2_1_terminal_fulfillment_policy.sql`
8. `20260713011837_ecom_orders_2_1_terminal_operational_visibility.sql`
9. `20260713012025_ecom_orders_2_1_pos_terminal_guards.sql`
10. `20260713012117_ecom_orders_2_1_tracking_resolver_rate_limit.sql`

## ECOM.ORDERS.2.2 — Rate limit público y autorización POS única

### Migraciones compensatorias nuevas

#### 1. Tracking por cliente y respuesta pública uniforme

- Archivo local: `supabase/migrations/20260713023529_ecom_orders_2_2_tracking_client_rate_limit.sql`
- Historial remoto: `20260713023529_ecom_orders_2_2_tracking_client_rate_limit`
- Aplicación: directa mediante migración versionada de Supabase
- Resultado: aplicada sin error; timestamp local y remoto coinciden

#### 2. Autorización POS única

- Archivo local: `supabase/migrations/20260713024130_ecom_orders_2_2_pos_single_authorization.sql`
- Historial remoto: `20260713024130_ecom_orders_2_2_pos_single_authorization`
- Aplicación: directa mediante migración versionada de Supabase
- Resultado: aplicada sin error; timestamp local y remoto coinciden

No se continuó a la segunda migración hasta verificar la primera.

## Rate limit público: anterior y nuevo

### Política anterior

- bucket compartido por portal;
- scope `ECOMMERCE_ORDER_TRACKING_PORTAL`;
- 600 solicitudes / 10 minutos;
- bloqueo de 5 minutos;
- tokens inválidos podían agotar ese bucket compartido;
- el error público `ECOMMERCE_TRACKING_RATE_LIMITED` permitía distinguir un portal existente de un slug inexistente.

### Identidad server-side del cliente

Se agregó `private.ecommerce_tracking_client_identity_v1()`.

La identidad se deriva exclusivamente de `current_setting('request.headers', true)` y aplica esta prioridad explícita:

1. `cf-connecting-ip`;
2. `x-real-ip`;
3. primer valor de `x-forwarded-for`.

Cada candidato se valida y normaliza como `inet`. La RPC no acepta IP, fingerprint ni identidad de cliente como argumento del frontend.

La IP normalizada se transforma server-side mediante SHA-256 con un namespace estable y se conserva únicamente como:

```text
tracking-client:<40 caracteres hexadecimales>
```

Cuando no existen headers utilizables se usa:

```text
tracking-client:anonymous
```

Ese fallback es compartido y deliberadamente más conservador; la consulta no falla y el token nunca se usa como identidad primaria.

### Política nueva de tres niveles

#### Nivel 1 — Cliente

- scope: `ECOMMERCE_ORDER_TRACKING_CLIENT`;
- cliente con IP confiable: 60 solicitudes / 10 minutos;
- fallback anónimo: 30 solicitudes / 10 minutos;
- bloqueo: 5 minutos;
- se consume antes de resolver portal o token;
- tokens y slugs distintos del mismo cliente comparten el mismo bucket.

#### Nivel 2 — Techo global del portal

- scope: `ECOMMERCE_ORDER_TRACKING_PORTAL`;
- 5000 solicitudes / 10 minutos;
- bloqueo: 5 minutos;
- se consume después de resolver el portal;
- funciona como techo de capacidad, no como límite individual.

El límite global es más de 83 veces el límite individual normal. Un solo cliente queda bloqueado en 60 solicitudes antes de acercarse al techo de 5000, por lo que ya no puede agotar fácilmente el seguimiento de todos los clientes de la tienda.

#### Nivel 3 — Token válido

- scope: `ECOMMERCE_ORDER_TRACKING_TOKEN`;
- 120 solicitudes / 10 minutos;
- bloqueo: 5 minutos;
- solo se crea después de resolver un token válido;
- identidad basada en una huella parcial del hash SHA-256;
- el token plano no se almacena.

### Orden de la RPC

`public.ecommerce_get_order_tracking(text,text)` ejecuta:

1. normalización de slug y token;
2. identidad server-side del cliente;
3. bucket individual;
4. resolución del portal;
5. respuesta uniforme si no existe;
6. techo global del portal;
7. validación de formato del token;
8. resolución del token válido;
9. bucket secundario del token;
10. payload público allowlisted.

### Respuesta pública uniforme

Portal inexistente, portal eliminado/no resoluble, token inválido, revocado o expirado, cliente limitado y portal limitado devuelven externamente:

```json
{
  "success": false,
  "error": {
    "code": "ECOMMERCE_TRACKING_NOT_FOUND",
    "message": "No se pudo encontrar este seguimiento."
  }
}
```

No se devuelven `retryAfterSeconds`, bucket, scope, portal, licencia, IP ni hashes.

El bloqueo continúa registrado internamente por `pos_rpc_rate_limits`, sin revelar públicamente si el portal existe.

### Privacidad

La metadata nueva contiene únicamente:

```text
source = ecommerce_public_tracking
phase = ECOM.ORDERS.2.2
bucket = client | portal | valid_token
```

No almacena:

- IP en texto plano;
- slug;
- token en texto plano;
- headers completos;
- cookies;
- authorization;
- user-agent.

Las filas antiguas del tracking se retiraron únicamente para los scopes versionados y `source=ecommerce_public_tracking`, evitando que un bloqueo del límite anterior de 600 sobreviva al cambio de política.

## Autorización POS: antes y después

### Antes

Cada wrapper público llamaba a `private.ecommerce_pos_terminal_guard_v1(...)`.

Ese guard ejecutaba `private.ecommerce_pos_draft_authorize_v1(...)` y adquiría un lock. Después el wrapper delegaba en una implementación privada que volvía a:

- autorizar;
- validar sesión/contexto;
- consumir `ECOM_ORDERS`;
- buscar y bloquear el pedido.

Resultado: dos autorizaciones y dos consumos de rate limit por operación, además de una ventana entre locks.

### Después

Se agregaron helpers privados autenticados:

- `private.ecommerce_admin_claim_pos_draft_authorized_v1(...)`;
- `private.ecommerce_admin_confirm_pos_draft_authorized_v1(...)`;
- `private.ecommerce_begin_pos_conversion_authorized_v1(...)`;
- `private.ecommerce_complete_pos_conversion_authorized_v1(...)`.

Cada RPC pública ahora:

1. ejecuta `private.ecommerce_pos_draft_authorize_v1(...)` una sola vez;
2. pasa el contexto `jsonb` ya autorizado al helper privado;
3. obtiene el pedido mediante `SELECT ... FOR UPDATE`;
4. valida fulfillment terminal bajo ese mismo lock;
5. ejecuta la mutación o replay idempotente sin volver a autorizar.

### Consumo medido

| Operación | Antes | Después verificado |
|---|---:|---:|
| claim POS | 2 | 1 |
| confirm POS | 2 | 1 |
| begin conversion | 2 | 1 |
| complete conversion | 2 | 1 |
| intento terminal bloqueado | 2 | 1 |

Las firmas públicas no cambiaron.

Se conservaron:

- idempotencia;
- códigos de error;
- ownership del claim;
- recuperación y replay de conversión;
- separación entre venta y fulfillment;
- eventos y broadcasts existentes;
- trigger terminal como defensa adicional.

### Otras rutas POS revisadas

No se agregaron wrappers ni doble autorización a:

- `public.ecommerce_admin_release_pos_draft`;
- `public.ecommerce_cancel_pos_conversion`;
- `public.ecommerce_get_pos_conversion_state`.

La política permanece:

- release puede limpiar claim/borrador residual autorizado;
- cancel puede liberar una reserva válida cuando no existe venta;
- get state continúa disponible como lectura, incluso para fulfillment terminal;
- ninguna de estas rutas inicia ni completa una nueva operación POS terminal.

## Hardening de funciones

Verificación posterior a cada migración:

- owner `postgres`;
- `SECURITY DEFINER`;
- `search_path=''`;
- helpers privados con ACL únicamente para `postgres`;
- cero `EXECUTE` para `PUBLIC`, `anon` o `authenticated` en helpers nuevos;
- grants públicos conservados para `anon`, `authenticated` y `service_role` en las RPC públicas;
- cada wrapper público contiene exactamente una llamada a autorización;
- los helpers autorizados contienen cero llamadas a autorización;
- los helpers no llaman al guard anterior ni a las implementaciones que reautorizaban;
- cada helper tiene `FOR UPDATE` y guard terminal;
- trigger `ecommerce_orders_block_terminal_pos_mutation` presente y habilitado.

## Pruebas SQL

Se agregó y ejecutó:

```text
supabase/tests/ecom_orders_2_2_tracking_pos_authorization_test.sql
```

La suite usa `BEGIN`, fixtures temporales y `ROLLBACK`.

Cobertura de tracking:

- tokens distintos del mismo cliente comparten bucket individual;
- slugs distintos del mismo cliente comparten bucket individual;
- clientes distintos generan buckets distintos;
- fallback anónimo conservador;
- tokens inválidos no crean buckets de token;
- token válido crea bucket secundario;
- portal inexistente devuelve contrato uniforme;
- cliente limitado devuelve contrato uniforme;
- portal limitado devuelve contrato uniforme;
- IP, authorization, cookies y token no quedan en metadata ni fingerprint en texto plano;
- portal pausado conserva tracking válido y marca `storefrontAvailable=false`.

Cobertura POS:

- claim exitoso consume una autorización;
- confirm exitoso consume una autorización;
- begin conversion consume una autorización;
- complete conversion consume una autorización;
- operación terminal queda bloqueada sin doble consumo;
- trigger terminal permanece habilitado;
- helpers privados carecen de grants públicos;
- release, cancel y get state no recibieron el wrapper terminal anterior.

**Resultado: PASS SQL con `ROLLBACK`. No quedaron fixtures persistentes.**

También se ejecutaron previamente dos pruebas transaccionales parciales de tracking y POS; ambas terminaron sin excepciones y con rollback.

## Frontend

No fue necesario modificar el servicio ni la página: el contrato existente ya trata `ECOMMERCE_TRACKING_NOT_FOUND` como:

```text
No se pudo encontrar este seguimiento.
```

Se amplió:

```text
src/pages/__tests__/PublicOrderTrackingPage.unpublished.test.jsx
```

La prueba confirma que el contrato público uniforme muestra el mensaje anterior y no presenta texto de “demasiadas solicitudes”, “límite” o “espera”.

## Validación ejecutable pendiente

No existe checkout autenticado ni dependencias instaladas en este entorno; `gh` tampoco está disponible y el acceso de red de Git falló por resolución DNS. Por ello no se ejecutaron:

```bash
npx eslint \
  src/services/ecommerce/ecommerceOrderTrackingService.js \
  src/services/ecommerce/ecommerceOrderFulfillmentService.js \
  src/pages/PublicOrderTrackingPage.jsx \
  src/components/ecommerce/orders/EcommerceFulfillmentPanel.jsx

npx vitest run \
  src/services/ecommerce/__tests__/ecommerceOrderTrackingService.test.js \
  src/services/ecommerce/__tests__/ecommerceOrderFulfillmentService.test.js \
  src/pages/__tests__/PublicOrderTrackingPage.unpublished.test.jsx \
  src/components/ecommerce/orders/EcommerceFulfillmentPanel.test.jsx

npm run build
git diff --check
git status --short
```

No se declaran PASS estas validaciones únicamente porque las pruebas estén escritas.

## Archivos modificados por ECOM.ORDERS.2.2

- `supabase/migrations/20260713023529_ecom_orders_2_2_tracking_client_rate_limit.sql`
- `supabase/migrations/20260713024130_ecom_orders_2_2_pos_single_authorization.sql`
- `supabase/tests/ecom_orders_2_2_tracking_pos_authorization_test.sql`
- `src/pages/__tests__/PublicOrderTrackingPage.unpublished.test.jsx`
- `reports/ecom_orders_2_public_tracking_and_fulfillment_report.md`

## Pendientes

- ejecutar las cuatro suites Vitest enfocadas;
- ejecutar ESLint enfocado;
- ejecutar build real;
- ejecutar `git diff --check` y verificar el árbol;
- pruebas manuales pickup/delivery, concurrencia, responsive, accesibilidad, offline y realtime;
- revisión técnica y de seguridad independiente.

## Estado final obligatorio

```text
PR #94: DRAFT
Merge: NO REALIZADO
Ready for review: NO, salvo revisión posterior independiente
PASS global: NO DECLARADO
```
