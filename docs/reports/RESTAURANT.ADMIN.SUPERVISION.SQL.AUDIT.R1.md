# PR #352: auditoría crítica SQL y decisión de despliegue

Nota posterior: este documento conserva la reproducción histórica. El hotfix y
sus límites actuales se documentan en
[HOTFIX P0 R1](RESTAURANT.ADMIN.SUPERVISION.HOTFIX.P0.R1.md). La compatibilidad
de cutover y el despliegue continúan HOLD; el bypass se endurece en el SQL propuesto.

Fecha: 2026-10-10, America/Mexico_City. Proyecto auditado: Lanzo,
`odlrhijtfyavryeqivaa`. **DEPLOYMENT_DECISION = HOLD.** No se aplicó SQL en
producción, no se publicaron frontends, no se modificaron negocios ni se hicieron merges.

Esta auditoría sustituye cualquier interpretación de los gates del informe inicial
como certificación de despliegue. Los fixtures SQL siguen usando autenticación y
efectos financieros controlados; no certifican el circuito integrado de Supabase.

## Bloqueos demostrados

1. **Frontend Production incompatible.** Vercel Production READY
   `dpl_3MseVxJuZHHMZsKvBzUgjcQBLEmK`, proyecto `lanzo-pos`, publica el SHA
   `2457c1716eb4b001b720743d15fd3f6761226ad0`, rama main. Su mapper de comanda
   no envía `expectedParentVersion`. La función vigente acepta una actualización
   legítima sin ese campo; la propuesta rechaza la misma forma de payload con
   `RESTAURANT_ORDER_VERSION_REQUIRED`. Se reprodujo con la definición vigente de
   `pg_get_functiondef`, contexto de actor controlado y sin invocar efectos financieros.
   #338 tampoco envía ese campo. La actualización Admin de una mesa Staff también
   exige `interventionReason`, ausente en esos frontends. No se relajaron versiones.
2. **Ruta legacy de cancelación fuera del contrato.** La definición vigente de
   `public.pos_update_restaurant_order_status_unlimited` permite a Staff con permiso
   de comanda cambiar una mesa ajena a `cancelled`. No comprueba propietario,
   motivo, versión ni registra `restaurant_table_interventions`. Se reprodujo
   cargando la definición real y los helpers de los dos triggers terminales reales
   en el fixture. El resultado es cancelación exitosa y cero intervenciones. Sus
   wrappers permanecen accesibles. El cambio de estados KDS ya existía, pero esta
   vía de cancelar el parent impide certificar que Staff ajeno sólo pueda consultar.
   La cancelación legacy tampoco escribe `metadata.cancelledFromPos`, requerido
   para la nueva reconciliación durable de reservas POS.
3. **QA integrada sin certificación.** Staging
   `jdnbmvaphvjunwhnxowo` está INACTIVE. El daemon Docker local no está disponible;
   la CLI instalada es 2.51.0. Se preparó PostgreSQL 17.11 temporal en loopback,
   pero no una instancia con Auth/Realtime, permisos, Caja, crédito, Ecommerce e
   inventario reales completos. No se usó producción para ventas de prueba ni se
   copiaron datos personales. Todos esos circuitos integrados siguen UNVERIFIED.
4. **Recuperación de producción no certificada.** `supabase backups list
   --project-ref odlrhijtfyavryeqivaa --output json` devolvió `backups: []`,
   `physical_backup_data: {}`, `pitr_enabled: false`, `walg_enabled: true`.
   Esto no prueba que no existan backups lógicos externos; no identifica un backup
   recuperable ni demuestra una restauración. BACKUP_READINESS = UNVERIFIED.
5. La restauración local de las siete definiciones y ACL pasó, conserva las tablas
   de evidencia y revoca capacidades nuevas. No certifica la continuidad después
   de ventas reales confirmadas ni permite restaurar automáticamente producción.

## Correcciones focales realizadas

Se reprodujo una carrera real entre dos sesiones con el mismo ID de línea y
parents distintos: la comprobación inicial no veía el INSERT no confirmado de
la otra sesión; `ON CONFLICT(id) DO UPDATE` terminaba cambiando su línea. Se añadió
la condición de licencia/parent al propio `ON CONFLICT`, bajo su bloqueo de fila,
y un rechazo `RESTAURANT_TABLE_SCOPE_DENIED` cuando no se actualiza ninguna fila.
Las regresiones de dos sesiones para parent distinto y tenant distinto rechazan
sin alterar la línea víctima ni crear una intervención.

El dispatcher ahora utiliza los identificadores normalizados de la petición
canónica. El helper R2B verifica `id`, `cloud_sale_id`, `cloudSaleId`,
`local_sale_id`, `localSaleId` según los mismos helpers que consume el motor de
efectos, y exige permiso del parent declarado en metadata de un child Split.
Un alias o marcador aportado por el cliente nunca crea un permiso de settlement.
Las pruebas directas de Staff ajeno y Admin sin permiso transaccional rechazan.

El harness de las siete carreras usa sesiones persistentes y libera la primera
únicamente después de observar que la segunda está bloqueada. Sustituye la
ventana frágil de `pg_sleep(1)`; no aumenta umbrales ni omite comprobaciones.
Una ejecución intermedia con la ventana antigua falló bajo concurrencia local,
clasificada como ENVIRONMENT_FAILURE del harness; la repetición con barrera pasó.

La ruta legacy de Cocina se conserva como bloqueo explícito. Corregirla requiere
definir la separación entre estados operativos KDS y cancelación del parent,
retirar o endurecer esa transición, y probar el flujo publicado. No se reemplazan
funciones compartidas adicionales sin ampliar ese diseño y su prueba integrada.

## Línea base y dependencias

| Referencia | SHA inicial comprobado |
| --- | --- |
| #352 OPEN / Draft | `030534197a996bdcae55167357c1ac3ca6872ee4` |
| #338 OPEN / Draft | `fb17e9a43929d54087ab937cb760a8cd6e087c36` |
| main / Production | `2457c1716eb4b001b720743d15fd3f6761226ad0` |

El proyecto informó ACTIVE_HEALTHY, Postgres 17.6; la consulta de salud observó
seis conexiones y cero deadlocks acumulados. Se conservaron definiciones, firmas,
defaults, retornos, `prosecdef`, `proconfig`, propietarios y ACL de cada función
reemplazada. `pg_depend` de PL/pgSQL registra principalmente lenguaje/esquema:
se complementó con lectura del cuerpo, referencias y callers textuales; el catálogo
de dependencias por sí solo no descubre todas las llamadas dinámicas.

| Migración del repositorio | Versión instalada | Comprobación |
| --- | --- | --- |
| `20260929091708_restaurant_payment_split_financial_r1` | `20260929091708` | Historial + definición Split real |
| `20261006181758_restaurant_atomic_settlement_3d1` | `20261006224032` | Historial + dispatcher/lock/trigger de paid ID |
| `20261008013643_restaurant_origin_cancel_contract_3d13` | `20261008030859` | Historial + RPC cancelación + trigger terminal |

Los números de archivo y del historial difieren en las dos últimas dependencias.
No se compararon únicamente sus nombres. La migración objetivo
`20261010013258_restaurant_admin_supervision_r1` estaba ausente. Las dependencias
estructurales están instaladas; ello no hace compatible la política nueva con el
frontend publicado. #338 permanece sin merge y sin cambios de su rama.

## Inventario y seguridad

El inventario detallado de objetos se conserva en
`RESTAURANT.ADMIN.SUPERVISION.SQL.OBJECTS.R1.md`, con las diez propiedades requeridas,
firmas, permisos, cambios, riesgo, retornos y configuración.

La migración contiene dos CREATE TABLE, dos ALTER TABLE ENABLE RLS, once
CREATE OR REPLACE FUNCTION y revokes/grant explícitos. Crea cuatro funciones,
reemplaza siete, no crea/reemplaza triggers ni ejecuta CREATE INDEX explícitos.
Los primary keys/unique constraints de las tablas nuevas generan índices y la
columna identity genera su secuencia; no se crean índices sobre ventas existentes.

Las firmas, defaults, retornos, SECURITY DEFINER/INVOKER y search_path de las
siete funciones anteriores se conservan. CREATE OR REPLACE conserva sus ACL.
Las tablas nuevas son privadas, tienen RLS sin policies y no acceso de
PUBLIC/anon/authenticated. Los helpers privados revocan EXECUTE a esos roles.
Capacidades está en public, se concede a anon/authenticated y usa la autenticación
propia de Lanzo: licencia + dispositivo + token + sesión vigente, antes de revelar
una mesa del tenant. El default ACL vigente de postgres en public también concede
EXECUTE a service_role. Un grant a anon no sustituye la validación de sesión.

Las tablas existentes `pos_restaurant_orders`, `pos_restaurant_order_items` y
`pos_financial_operations` tienen RLS y sólo postgres/service_role en su ACL,
sin policies para clientes. Se preservan ambos triggers existentes. La migración
no cambia sesiones, licencias, planes, datos históricos, importes ni creadores al
aplicarse. Sus INSERT/UPDATE/DELETE están dentro de funciones para futuras llamadas.

La identidad Staff/Admin viene de `validate_pos_sync_context` vigente, no de
user_metadata ni de una propiedad de payload. La función real valida licencia,
device/token, modo del terminal, hash de sesión, revocación, caducidad y usuario
activo. Los permisos Staff se consultan en la fila vigente. La sesión Admin se
verifica mediante `require_active_admin_session`; el helper nuevo comprueba la
consistencia de IDs y tenant. Se auditaron esas definiciones reales, pero las
pruebas locales de autoridad siguen usando un contexto controlado.

Los advisors de producción conservan hallazgos previos: 34 INFO de RLS sin policy,
7 WARN de search_path mutable y WARN de funciones públicas SECURITY DEFINER
accesibles a anon/authenticated. No se corrigieron ni ampliaron privilegios fuera
del alcance. Esos avisos requieren evaluación según la autenticación propia, no
un revoke masivo que rompería los RPC publicados.

## Matriz obligatoria de frontends

| Combinación | Resultado y límite |
| --- | --- |
| Production + SQL vigente | Contrato de update sin versión reproducido; QA integral UNVERIFIED |
| Production + SQL nuevo | **FAIL**: update de comanda sin expectedParentVersion; checkout también carece de contexto de versión obligatorio |
| #338 + SQL nuevo | **FAIL**: update sin expectedParentVersion; política de propiedad/Admin motivo aún ausente |
| #352 + SQL nuevo | PASS focal con fixtures; **UNVERIFIED** integrado; ruta legacy fuera del contrato |

Prohibir a Staff cobrar mesas ajenas es un cambio deliberado de autorización.
No se presenta como compatibilidad retroactiva. También se deniega Staff en mesas
históricas sin creador Staff, sin reasignar automáticamente ese creador.

## Finanzas, Caja, inventario y rubros

Las ramas cash.open/movement/close/admin_close, abonos/layaways/cancel y la
canonicalización previa se compararon contra la definición desplegada. Las
adiciones del dispatcher se acotan a cashier/inventory/credit/split de un parent
Restaurant identificado. En R2B no se reescribe el cálculo de precios, descuentos,
impuestos, Ecommerce, batches, crédito o pagos; se añade el permiso de Restaurant.
Las funciones comparten rubros, por lo que comparación estática y Vitest no bastan
para asegurar ausencia de regresión financiera.

| Circuito | Evidencia disponible | Certificación integrada |
| --- | --- | --- |
| Normal checkout, pagos y Caja | Dispatcher real + leaves controlados; suites JS/CI | UNVERIFIED |
| Cloud inventory, lotes, recetas, fraccionados | Comparación R2B + suites locales | UNVERIFIED |
| Crédito/Fiado y abonos | Comparación branch/autoridad + CI | UNVERIFIED |
| Split platos/monetario/mixto | Parent lock real; leaf Split controlado; suites JS | UNVERIFIED |
| Apertura y cierre de Caja | Contratos compartidos preservados estáticamente; CI | UNVERIFIED |
| Ecommerce/Apartados/otros rubros | Cálculos y ramas conservados; suites JS/CI | UNVERIFIED |
| Cancel origin/Admin remoto | SQL cancel real, audit/version/idem + local receipt tests | UNVERIFIED en dos dispositivos reales |

Los siete conflictos serializan parent/advisory lock antes de Caja/ledger,
dejando como máximo un efecto controlado y una auditoría, sin permisos residuales.
Esto no prueba movimientos reales, cargos de crédito o liberación real de stock.
Se preservan conflictos de versión, paid/cancelled, idempotencia y permisos.

Cancel Admin por la RPC nueva confirma Cloud y escribe evidencia; no libera
reservas del otro dispositivo. El origen guarda un recibo durable antes de la
transacción que libera sus reservas. Crash/rollback conserva ese recibo; replay
de limpieza se limita a las reservas pendientes y shadows no poseen holds.
Staff sin refunds o sesión caducada deja pendiente la reconciliación. Permanecen
pendientes pruebas reales con productos simples, lotes, fraccionados, recetas,
insumos compartidos, refresh/reconexión y crashes antes/después de commit.
`ADMIN_REMOTE_EDIT = BLOCKED_PENDING_INVENTORY_CONTRACT`.

## Reversión y operación

Se preservó un rollback compensatorio que restaura las siete definiciones y sus
permisos efectivos en una transacción, revoca la nueva consulta de capacidades,
y conserva las tablas/evidencia en vez de eliminarlas. Se ejecutó en la base
temporal: definición exacta y EXECUTE anon/authenticated/service_role coincidieron
7/7 con la captura, y el contador de intervenciones no cambió. La actualización
legacy volvió a funcionar. No se restaura ni se rebaja seguridad automáticamente
en producción; después de operaciones confirmadas requiere contención de nuevas
escrituras, inventario de settlements y reconciliación financiera.

CREATE OR REPLACE toma locks de catálogo y convive con llamadas activas; el archivo
no lleva un lock_timeout global de migración ni garantiza duración de despliegue.
No realiza escaneos/rewrite de ventas o índices sobre tablas grandes. Se requiere
ventana coordinada, hash/ACL/dependencias revalidados y mecanismo versionado único.
No existe ejecución parcial autorizada. La estabilidad de las siete definiciones
se reconsulta con fingerprints y ACL, pero no elimina la necesidad de una última
revalidación inmediatamente antes de un futuro despliegue.

## Reproducción y cierre

Usar PostgreSQL temporal 17 en 127.0.0.1, base dedicada vacía
`lanzo_admin_supervision_fixture`, con PGPORT/PGUSER/PSQL_BIN. Exportar previamente
las siete definiciones/ACL reales y las funciones legacy/helpers, sólo con SELECT.

```powershell
node scripts/supabase/restaurant-admin-supervision-test.mjs --isolated-fixture
node scripts/supabase/restaurant-admin-supervision-audit-test.mjs --isolated-fixture --baseline production-functions.json --legacy legacy-functions.json
```

El segundo script restituye las funciones antiguas únicamente en el fixture al
probar rollback; no usar después esa base como si siguiera teniendo el SQL nuevo.
Su resultado esperado incluye los **FAIL** de compatibilidad/legacy: que el
script termine exitosamente significa que reprodujo el bloqueo, no que certificó
el despliegue.

El informe externo de cierre registra el SHA final exacto, SHA256 del blob de
migración, resultados de las nuevas ejecuciones CI, fallos heredados/candidate-only/
entorno, builds, evidencias y todos los campos solicitados. No se reutiliza el
SUCCESS antiguo cuando una repetición nueva falla. Ningún umbral ni gate se relaja.

Acciones necesarias: resolver el contrato y secuencia frontend/SQL para clientes
vigentes, cerrar la cancelación legacy del parent conservando KDS autorizado,
preparar QA integral aislada, verificar backup recuperable y recuperación completa,
volver a auditar el HEAD resultante y pasar los tres gates. Sólo entonces vuelve
a ser evaluable la autorización condicional de producción. Ambos PR siguen Draft.
