# Transición frontend/SQL de restaurante — PR #352

Preparado el 2026-10-10 para `fdxruli/Lanzo-POS`, rama
`feat/restaurant-admin-supervision-r1`, Draft apilado sobre #338. HEAD inicial
`6b2c6d826508c26616fc061c14adaf7b9ab68340`; base #338
`fb17e9a43929d54087ab937cb760a8cd6e087c36`. Production frontend y main observados:
`a8547bfc34f483d1d72020114510c8ebea74aace`. La evidencia final por SHA, resultados
CI, Preview y los campos obligatorios se entregan en el cierre de esta tarea;
este documento describe el código y el procedimiento propuestos.

**HOLD de despliegue y merge.** Implementación candidata con pruebas locales y
SQL real aislado; Auth/Realtime/Caja/Fiado/inventario integrados, restauración de
backup y actualización de dispositivos requieren una fase autorizada posterior.
No se ejecutaron migraciones, escrituras de datos ni despliegues en Production
o staging. #338 y main permanecen fuera del alcance de edición.

## Contrato y límites de convivencia

`BRIDGE_SQL` es `20261010013257_restaurant_cloud_transition_bridge_v1.sql`.
Se creó con `supabase migration new restaurant_cloud_transition_bridge_v1` y se
ordenó inmediatamente antes de la migración final todavía **no aplicada**
`20261010013258_restaurant_admin_supervision_r1.sql`. Sólo se renombró el archivo
nuevo; ninguna migración histórica aplicada fue modificada. La final se modifica
para depender del puente, activar versión estricta bajo el lock de corte y
mantener Admin desactivado por licencia.

La lectura `pos_restaurant_cloud_contract_v1` autentica dispositivo y sesión
Admin/Staff con `validate_pos_sync_context`; valida plan y rubro. Su respuesta
contiene `contractVersion`, `minimumSupportedClientVersion`,
`strictParentVersionRequired`, `versionedWritesAvailable`,
`versionedParentVersionRequired`, `adminSupervisionAvailable`,
`legacyWritesAllowed`, `kitchenTerminalGuardEnabled`, `writesPaused` y
`serverCapabilityGeneration`. No contiene credenciales, mesas ni licencias
ajenas. Los roles de transporte anon/authenticated sólo pueden ejecutar la
lectura con el contrato de sesión propio de la aplicación. Ningún booleano ni
campo enviado por el navegador autoriza una escritura.

En puente, versión/minimum son 1; ofrece una RPC de escritura versionada para el
cliente 2 y conserva los payloads legítimos del mapper antiguo en el origen.
Las escrituras legacy históricas todavía carecen de concurrencia optimista:
**no se certifica convivencia de edición comercial simultánea vieja/nueva**.
Esta ventana requiere coordinación operativa; no puede prolongarse como modo
permanente. Se endurecen tenant, dueño, IDs físicos, cancelación terminal y
rechazo completo de Cocina antes de activar Admin. Estos cierres de rutas
inseguras pueden cambiar comportamientos antiguos que nunca fueron seguros.

En final, versión/minimum son 2 y `legacyWritesAllowed=false`. El upsert exige
marcador de contrato 2 y, si existe parent, su versión exacta. El marcador sirve
para reconocer el payload, no para demostrar identidad, permisos ni actualidad.
Los cobros antiguos que ya usaban el settlement atómico versionado conservan su
contrato; no se altera su clave ni su hash financiero. Las rutas directas sin
evidencia de settlement continúan bloqueadas.

`pos_restaurant_transition_table_capabilities_v1` mantiene el formato v1 de las
capacidades de mesa, independiente de la generación global del servidor. Admin
ajeno sólo recibe capacidades después de habilitación explícita por licencia
en contrato 2. Los owners Admin de mesas sin Staff conservan sus operaciones
normales. Edición remota permanece bloqueada para todo actor. Staff remoto dueño
puede cobrar/dividir bajo el contrato financiero; cancelar requiere el origen.

En SQL actual sin puente, el cliente transicional admite lecturas existentes y
preservación de borradores locales, pero **bloquea nuevas escrituras Cloud** al
detectar ausencia del endpoint. No cae al upsert antiguo ni infiere una versión.
`PGRST202` es incompatibilidad, no sesión o licencia inválida. Un error de red
tampoco concede permiso ni provoca SetupModal. Free/Local no consulta el nuevo
contrato y conserva sus ramas offline.

## Auditoría de consumidores

Los mappers Production y #338 de los fixtures proceden de sus SHAs indicados;
sólo tienen ajustes de imports relativos. La prueba de exportación ejecuta esos
archivos y el mapper común candidato: el harness SQL consume sus salidas reales,
variando únicamente los inputs de identidad/token del escenario. No reconstruye
manualmente un payload legacy.

| OPERATION / RPC | CALLER / CURRENT_PAYLOAD / EXPECTED_SQL_CONTRACT | ACTOR_AUTHORITY / VERSION_SOURCE / IDEMPOTENCY_SOURCE | OFFLINE_BEHAVIOR / COMPATIBILITY_RISK |
| --- | --- | --- | --- |
| Crear/editar, `pos_upsert_restaurant_order_versioned_v1` → wrapper rate limited → unlimited | `restaurantOrdersRepository`, `useTableManagement`, consumidores del mapper común de Cocina; order/items con identidad local, token y motivo explícitos | Contexto capturado de sesión/tenant, POS/dueño/origen en SQL; token exacto del parent validado; clave de upsert propia, generada antes de esperas | Borrador durable preservado; sin endpoint/red/version bloquea, sin fallback legacy |
| Leer/recuperar, `pos_get_restaurant_orders`, `pos_get_restaurant_order_by_local_order` | Repository, `useActiveOrders`, `restaurantTableHydration`, estados Cloud y reconciliación | Sólo lecturas autenticadas; no convierte `updatedAt` de Dexie en token; respuesta vinculada a actor/tenant | Mesas locales y shadows existentes preservados; una terminal no se recupera abierta |
| Preflight, `pos_restaurant_transition_table_capabilities_v1` y lectura forzada por local ID | `restaurantSplitCloudPreflight`, `restaurantTableAuthority`, `useTableManagement`, `usePosCheckout`, Split y Cashier | Capacidades de servidor vinculadas a actor/session/generation/tenant/order; comparación comercial antes de aceptar token operativo más nuevo | Cache o transporte no son autorización; conflictos conservan borrador y requieren reconciliación |
| Cobro normal/mixto/inventario/fiado, `pos_execute_financial_operation_v1` | `salesCloudCashierService`, `salesCloudRepository`, `usePosCheckout`, ventas; request financiero previo, settlement con parent/version | Auth/Caja/dueño/permiso/versión/parent lock y permisos transaccionales en dispatcher; identidad, K/H/request del ledger durable | No cobro local sustituto en mesa que requiere Cloud; recibo recuperable sin nueva identidad |
| Apertura QuickCaja, RPC existentes de Caja | `usePosCheckout`, repository de Caja; abrir/asegurar sesión por estación, luego retomar snapshot original | Se revalida mesa antes del pago y se vuelve a validar dentro del servicio/RPC; misma orden/checkout; no cambia K por contrato | Una Caja abierta conserva su sesión; mantenimiento preserva checkout y vuelve a mostrar pago; sin reload automático |
| Dividir, dispatcher `sale.split` → `execute_split_sale_financial_v1` | `splitOrderService`, `restaurantSplitCloudPreflight`, servicios financieros; parent token, grupo e IDs de hijos estables | Versión comercial validada + permisos y lock compartido con cobro/cancelación; intent durable y recibo | Reconexión no convierte error Cloud en Split local; reconciliar resultado antes de repetir |
| Cancelar, `pos_cancel_restaurant_order_from_pos_v1` | Repository y cancelación administrativa; ID local, versión, razón, clave | Refunds, dueño/origen o Admin habilitado, versión/lock/idempotencia y permit privado; evidencia/auditoría durable | Reservas sólo se liberan en origen después del recibo; no se copian holds remotos |
| Estado/ítem de Cocina, `pos_update_restaurant_order_status`, `pos_update_restaurant_order_item_status` | Consumidores KDS y repository; estados operativos y clave existente | Permiso de comanda existente y tenant; cada ítem elegible avanza versión parent; no puede cancelar parent | Rechazar último producto mantiene mesa POS abierta; UI nueva niega cancelación terminal legacy antes de RPC |
| Cierre posterior/recibo/reconciliación, `pos_close_restaurant_order_after_checkout`, `pos_get_financial_operation_receipt` | Helpers de cierre y ledger financiero; IDs y respuesta de cobro ya confirmada | Evidencia de settlement/receipt; conserva K/H y parent original; lectura de recibo permitida en pausa | No nuevo cobro ni liberación repetida; confirmar antes de recargar/reintentar |
| Archivo, `pos_archive_restaurant_order` → `_unlimited` | Historial Cocina, payload histórico | Contrato existente, permiso comanda, tenant/idempotencia; gate de mantenimiento y guard del parent | Archivar historia confirmada conserva evidencia; no esconder parent entregado impago |

No cambian precios, cálculos Money, asignación FEFO, retención física, venta fiada,
abonos ni lógica de otros rubros. El dispatcher sólo considera Restaurant los
parents/aliases explícitos o existentes dentro de la licencia autenticada.

## Locks, actores y SQL

Cada writer instrumentado toma el advisory lock **compartido** global de política
antes de parent/Caja/ledger. `private.set_restaurant_transition_policy_v1` toma
el mismo lock **exclusivo**, drena las transacciones que ya lo poseen y cambia
pausa/generación o activación de una licencia. No es una RPC pública; PUBLIC,
anon y authenticated carecen de EXECUTE. La pausa afecta las escrituras Cloud
Restaurant de todas las licencias; la activación Admin sí es gradual por licencia.

El nuevo upsert toma además el parent lock existente, valida sesión/tenant/
dueño/origen, identidad, versión y las filas físicas existentes antes de delegar
al wrapper real con su rate limit. El mapper no envía IDs físicos; alias físicos
que podrían redirigir un ON CONFLICT se rechazan. Padres nuevos usan el ID
generado por el servidor; no se calcula un supuesto ID a partir del dispositivo.

El puente instrumenta definiciones realmente instaladas con `pg_get_functiondef`
y `CREATE OR REPLACE`, conservando firmas/configuración/ACL. Writers: upsert,
status, item status, close, archive (nombre verificado `_archive_restaurant_order_`),
dispatcher, cancel; private R2B y split. Reemplaza agregación con la protección
del hotfix y añade guard/limpieza de permisos terminales. Se exige formato de
cuerpo PL/pgSQL conocido; otro formato aborta la migración, no se omite en silencio.
La final repone sus cuerpos completos y añade el gate a sus entradas relevantes.

Una llamada legacy ya compilada puede esperar mientras se reemplaza su caller.
El helper de upsert del puente vuelve a comprobar modo estricto **después** del
lock: exige contrato 2 y token real, por lo que ese frame antiguo también se
rechaza. Una RPC nueva no instrumenta retroactivamente un frame **anterior a la
instalación del puente**. El procedimiento debe cerrar ingreso y demostrar
quiescencia antes de instalar el puente y antes del corte final; si no puede
demostrarse, **no avanzar**. Esta condición es un gate operativo pendiente de QA.

Todas las tablas privadas nuevas tienen RLS y REVOKE de roles navegador. Helpers
SECURITY DEFINER nuevos usan `search_path=''` y referencias calificadas; privados
sin EXECUTE de navegador. Las RPC públicas conservan el transporte anon/
authenticated requerido por las sesiones custom, validando identidad dentro.
Producción se consultó sólo mediante SELECT de catálogo: parent e items tienen
RLS, ACL postgres/service_role y **cero INSERT/UPDATE/DELETE** para anon y
authenticated. La lectura de capacidades no abre DML ni crea permisos privados.

Las dos familias de permits de cancelación se coordinan en el trigger del
puente: la futura tabla final sólo se consulta si existe. Limpiar permisos y
auditoría ocurre dentro de la misma transacción; fallos revierten sus efectos.
Padres pagados/cancelados, aliases terminales y archivo impago siguen protegidos.

## Matriz y pruebas

| Frontend | Backend | Resultado aislado / límite |
| --- | --- | --- |
| Production y #338 | Actual | Crear/actualizar con sus mappers reales PASS; comportamiento histórico sin token, no certificación de seguridad antigua |
| Production | Puente | Origen crea/actualiza PASS; Admin nuevo OFF; IDs físicos, Staff ajeno y cancelación terminal insegura bloqueados; edición concurrente legacy no se certifica |
| Transicional | Actual | Ausencia detectada, lecturas/borrador permitidos, escritura Cloud bloqueada; indisponibilidad explícita, no compatibilidad operativa completa |
| Transicional | Puente | RPC versionada, descubrimiento, ownership, origen y conflicto PASS |
| Transicional | Final | Versiones estrictas PASS, Admin apagado por defecto |
| #352 | Final habilitado | Capacidades/checkout/split/cancel Admin dentro de licencia PASS en fixtures; edición remota bloqueada; integración pendiente |
| Bundle antiguo | Final | Payload incompatible rechazado incluso si espera a través del DDL; actualización coordinada necesaria |
| Free/Local | Sin Cloud | Ramas locales y suite POS/ventas no reciben nuevo endpoint; ver ampliado/CI y certificación offline real pendiente |

Las diez carreras anteriores se mantienen sin retirar assertions, barreras ni
timeouts. El harness final activa explícitamente Admin para conservar sus casos.
El nuevo `restaurant-transition-test.mjs` ejecuta siete carreras reales:
old/new + DDL, POS/Cocina, Staff/Admin, cobro/política, Split/cancel, reintento K
idéntica, snapshot viejo tras intervención Admin. Usa `pg_stat_activity`/locks
para demostrar bloqueo antes de soltar al ganador. El corte old/new incluye una
tercera sesión legacy ya esperando durante el reemplazo.

La matriz ejecuta writers/upsert/wrappers/Kitchen capturados de Production y el
dispatcher real de la migración. Auth, rate limit y los efectos financieros
terminales son controlados. El modelo durable prueba una venta/movimiento/
liberación y el mismo recibo por intento, pero **no certifica** Caja/Fiado/
inventario reales. Los tests Dexie ejecutan transacciones locales reales con
fake IndexedDB; el transporte es simulado. Nunca se llama esto QA integrada.

| TR | Evidencia candidata / lo que falta |
| --- | --- |
| 01 | SQL con payload real Production crea en backend actual |
| 02–05 | Matrix SQL: token válido, stale y legacy estricto rechazados; mapper común conserva token exacto |
| 06–08 | Repository: ausencia/PGRST202 sin recovery de actor ni fallback; SetupModal integrado pendiente |
| 09 | Hook con Dexie: mesa/cart/reserva preservados por upgrade, mantenimiento y conflicto |
| 10 | Rehidratación local existente y Preview por SHA; reload autenticado de Preview preservando mesa real NO EJECUTADO |
| 11 | Repository redescubre política al reconectar; offline real integrado pendiente |
| 12–17 | SQL ownership, Admin habilitado, tenant y remote-edit; diez carreras existentes |
| 18–20 | Carrera POS/Kitchen, rechazo último ítem, bypass/aliases/archivo impago y guard terminal |
| 21 | Hook: misma mesa Cloud tras QuickCaja, cambio de contrato impide processSale y preserva checkout |
| 22 | Split/Dexie/recibo existentes y SQL split/cancel; reconexión integrada pendiente |
| 23–24 | Dispatcher + ledger durable controlado: respuesta perdida/retry/corte, una venta/cash; Cash real pendiente |
| 25 | Suite fiado existente, sin código financiero cambiado; fiado durante corte integrado NO CERTIFICADO |
| 26 | Modelo de una liberación + suites de reservas/proyección; stock real integrado NO CERTIFICADO |
| 27–28 | Diez carreras previas + reintento/Split/cancel/Staff-Admin con PostgreSQL real |
| 29 | Payload de bundle viejo rechazado; SW antiguo físico/resume en dispositivo NO EJECUTADO |
| 30–31 | Actor recovery, respuestas tardías, tenant y scoped handoff; suites focales/ampliadas |
| 32–33 | Guards SQL y terminal recovery: pagada/cancelada no se reabre |
| 34–35 | Suites POS/ventas/otros rubros y CI diferencial; operación integrada offline todavía pendiente |
| 36–40 | Versiones/generaciones unsupported, K/H durable inmutable, stale commercial, redescubrimiento por llamada, activación gradual sin grants prematuros |

## CI y PublicStore

La transición también protege la actualización del frontend: el coordinador SW
consulta un guard síncrono instalado por POS y no recarga si existe ownership de
checkout u operación de actor pendiente. Ausencia/excepción del guard bloquea la
recarga. Se comprueba otra vez al recibir controllerchange, incluso si otra
pestaña activó el worker o el cobro empezó después de solicitar actualizar.
La recarga aplazada conserva el aviso y permite la acción manual tras recuperar
el resultado financiero; no hay borrado de almacenamiento. Esto protege el
bundle transicional; no modifica JavaScript antiguo ya cargado.

La prueba financiera durable de mantenimiento verifica que el reintento conserva
SALE_ID, K/H, payload y un único intent Dexie. QuickCaja vuelve a consultar la
autoridad/contrato antes del cobro; los bloqueos conservan checkout, snapshot,
ownership, mesa y reservas. El servidor conserva la decisión final.

Observación ampliada local: 974 tests, 957 PASS y 17 FAIL. Trece fallos se
reprodujeron en el SHA inicial (entorno document en Ecommerce y expectativas
antiguas de WhatsApp); cuatro fallos de transición móvil sólo aparecieron en
contexto ampliado y siguen SIN ATRIBUIR. El focal de esos cuatro pasó en BASE;
no se declaran baseline sin un diferencial equivalente. ESLint completo inicial
tiene 154 errores y 178 warnings; la clasificación final y CI se registran en
el cierre por SHA. No se aumentan umbrales ni se cambian pruebas ajenas.

Actor Runtime manual tenía jobs completos condicionados sólo a pull_request.
Se habilita la comparación completa también en workflow_dispatch, con `base_ref`
obligatorio y resolución única a SHA, whitespace blocking y el gate diferencial
existente. Scoped Storage manual atribuía al SHA histórico aunque BASE ejecutaba
otra referencia: focused y diferencial ahora usan el mismo SHA resuelto de BASE.
El baseline histórico conserva su comprobación observacional; no se alteran
umbrales, repetitions, timeouts ni tests existentes. Dos tests Node verifican
estos contratos de workflow.

El fallo previo de PublicStore (pageshow / ECOMMERCE_PORTAL_NOT_FOUND) se revisó
contra BASE y CANDIDATE. El producto y ese caso no se modificaron en esta fase.
Los listeners se registran por efecto dependiente de portal/recovery/revision y
se limpian con intervalos/timer; el test dispara al ver el heading, sin observar
registro. Eso es una **hipótesis**, no causalidad probada. Los cuatro estados
focus/pageshow pasaron en la suite focal local. Se añade el caso exacto fallido a
las 50 repeticiones explícitas del gate, sin retirar los siete targets previos.
Si el diferencial reproduce una regresión nueva, permanece HOLD hasta demostrar
y corregir su causa por una vía autorizada. Un focal PASS no sustituye al gate.

## Backup, rollback y rollout futuro

**BACKUP_READINESS=UNVERIFIED; ROLLBACK_READINESS=HOLD.** No existe evidencia de
una copia recuperable/restauración integral reciente de Production. Los snapshots
de funciones son inventario de código, no backup financiero. Según
[Supabase Database Backups](https://supabase.com/docs/guides/platform/backups),
Storage requiere respaldo separado de sus objetos, y restaurar causa una ventana
de indisponibilidad. No se infiere el plan, disponibilidad PITR ni retención del
proyecto a partir de esa documentación. Para lógica de copia/restauración usar
[la guía oficial](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
y adaptar esquemas managed, roles, objetos, Vault/keys y secretos mediante el
procedimiento autorizado; nunca poner credenciales en el repositorio o logs.

1. **Preparar y cerrar gates.** Revalidar SHAs/Production/schema/ACL/funciones.
   Inventariar todos los dispositivos, pestañas y SW por negocio/origen, mesas
   abiertas, Caja, drafts Split, intents pendientes y recibos confirmados.
   Preservar stores/actor/tenant sin borrar IndexedDB/LocalStorage. Aprobar y
   habilitar un entorno integrado sin envío externo; probar Auth/Realtime,
   transporte anon/authenticated, Free/offline, QuickCaja, mixto, crédito/abonos,
   holds, permisos, Kitchen y todos los TR pendientes.
2. **Respaldar y ensayar.** Copia recuperable de datos/esquemas/roles/ACL/RLS/
   funciones/triggers/seq/ledger/auditoría, checksum y cifrado con acceso acotado;
   objetos Storage y estado/configuración externos por separado. Restaurar en
   destino aislado autorizado con webhooks/cron/sync externos detenidos. Comparar
   conteos/PK/FK/saldos/cash/fiado/settlements/K/H, owners, pagos, mesas, permisos,
   eventos y holds por licencia. Verificar recibos y recuperación de sesión/mesa.
   Establecer punto de corte, RPO/RTO y responsable. Si falta evidencia, no avanzar.
3. **Puente (autorización separada).** Detener ingreso Restaurant para clientes
   antiguos y drenar todas las llamadas ya en curso antes de instalar el puente,
   incluyendo frames anteriores a su gate. Resolver resultados financieros por
   recibo/K/H. Instalar únicamente bridge en una transacción; confirmar schema,
   wrappers/ACL, versión 1, Admin OFF y origen viejo compatible. Probar rechazo
   Kitchen/terminal y detenerse ante diferencias. No habilitar final/Admin todavía.
4. **Distribuir frontend transicional (autorización separada).** Publicar el SHA
   aprobado, verificar assets/manifest/SW y recepción por cada dispositivo.
   Terminar o recuperar checkout mediante recibo antes de actualizar la pestaña.
   La pestaña anterior puede no mostrar el aviso nuevo: avisar operativamente y
   no depender de reload automático. Conservar todos sus datos locales. En old
   SQL el cliente bloquea Cloud; aplicar bridge antes para reducir esa ventana.
   Excluir edición simultánea antigua/nueva mientras legacy siga admitido.
5. **Pausa y final (autorización separada).** Cerrar ingreso y tomar la política
   exclusiva `set_restaurant_transition_policy_v1(true)`. Confirmar escrituras
   drenadas, cero intents incompatibles sin resolver y ausencia de llamadas
   antiguas previas al bridge. Pausa explícita de Cloud Restaurant en todas las
   licencias; lecturas/recibos permanecen. Aplicar final dentro de **una sola
   transacción**, confirmar contrato 2/legacy OFF/versions/tenant/owners/Kitchen/
   grants. Si falla, rollback DDL completo y mantener pausa/corte; no improvisar
   un fallback sin versiones. Retomar sólo con clientes verificados y smoke tests.
6. **Activar Admin por licencia (autorización separada).** Después de QA final,
   operador habilita explícitamente esa licencia bajo el lock exclusivo; comprobar
   nueva generación, checkout/Split/cancel auditados, Staff ajeno denegado y
   edición remota bloqueada. No habilitar a partir de un campo del navegador.
7. **Certificar/monitorizar.** Medir errores de versión/upgrade/maintenance/Auth,
   recibos repetidos, duplicados Cash/Fiado, parent/audit/events y reservas por
   origen. Verificar dispositivos reanudados y SW antiguos. Decidir merge y
   producción por separado después de integrar #338 conforme a autorización.

**Si hay que retroceder:** pausar y cerrar ingreso primero; reconciliar cada
operación aceptada con su recibo e inventario antes de tocar funciones/datos.
Restaurar sólo siete definiciones no revierte el puente, guards, permisos y
auditoría. Inventariar todos los objetos nuevos y reemplazados de ambas etapas;
ensayar reversión de final y bridge en copia aislada y sin perder ventas nuevas.
Después de efectos financieros, preferir reparación hacia adelante o replay
durable validado: restaurar un snapshot anterior borraría ventas confirmadas.
Mantener recibos/intervenciones/eventos y owners; recuperar sesiones por
reauth/handoff existente, no copiando tokens; reconciliar mesas/holds en origen.
Nunca reabrir legacy inseguro ni el bypass P0-B para recuperar disponibilidad.
Si no se garantiza integridad completa, mantener HOLD/pausa y escalar al
responsable; no hacer rollback destructivo a ciegas.
