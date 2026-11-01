# LANZO POS — FASE 1A.0 R2 / producción

Fecha: 2026-10-20, America/Mexico_City. Proyecto único: `odlrhijtfyavryeqivaa`.

**Resultado: SQL_CANDIDATE_VALIDATED_NOT_DEPLOYED. Fase 1A y recepción comercial: HOLD.**

Se implementó una candidata SQL de autorización y se ejecutó contra PostgreSQL de
producción con identidades sintéticas y ROLLBACK. La ejecución final registra
**88 comprobaciones base PASS, 1 requisito de aislamiento FAIL y 2 comprobaciones
PASS de una propuesta ACL separada**. No es certificación Realtime.

No hay migraciones aplicadas, emisor JWT desplegado ni cliente nuevo. El resultado
no desbloquea B-01/B-02/B-03 ni autoriza Fase 1B. El material queda concreto y
revisable, fuera del directorio de migraciones ejecutables.

## A. Preflight y evidencia original

Se leyeron completos los informes `ECOM.FREE.ORDERS.REALTIME.AUTH.R1.md` y
`ECOM.FREE.ORDERS.REALTIME.AUTH.FEASIBILITY.R1.md` de la worktree previa
`C:/Users/pituf/.codex/worktrees/ecommerce-free-order-signal-auth-r1/Lanzo-POS-Git/docs/reports/`.
La autorización actual de producción reemplaza sus restricciones anteriores
sobre usar ese entorno; sus resultados históricos no se contaron como QA nueva.

| Recurso | Estado observado |
|---|---|
| `origin/main`, fetch y ls-remote | `f014a1f340ed78335d3e704eefff49cda8465115` |
| Checkout principal preservado | `C:/dev/Lanzo-POS-Git`, HEAD `54c4f9e83068bf6d1578f785877f4cc85a90552a` |
| Worktree nueva | `C:/Users/pituf/.codex/worktrees/ecom-realtime-auth-r2/Lanzo-POS-Git` |
| Rama | `codex/ecom-realtime-auth-r2` |
| Proyecto Supabase | Lanzo, ACTIVE_HEALTHY, us-east-2, PostgreSQL `17.6.1.063` |
| Edge Functions existentes | `lanzo-ai-agent` v46; `authorize-image-upload` v28; ninguna reemplazada |
| Realtime | RLS ya habilitado; tres políticas SELECT permisivas para anon/authenticated |
| Rol receptor inicial y final | Ausente; sólo existió dentro de transacciones revertidas |

Los nueve informes/manifest y `scripts/recovery/` sin seguimiento del checkout
principal conservan la misma lista inicial/final. No se editaron. No se encontró
AGENTS.md en el árbol o padres comprobados. Se usaron las skills Supabase y
Postgres Best Practices, sin delegación. No se creó/reactivó otro proyecto ni se
usó Docker.

Antes de los ensayos se guardaron definiciones y MD5 de once funciones existentes,
ACL de funciones/esquemas/tabla Realtime, memberships, políticas, atributos de
roles y el ledger. MD5 identifica cuerpos inspeccionados; no es una garantía
criptográfica ni una firma de autorización. Los artefactos llevan además un
manifiesto SHA-256 normalizado a LF.

- [Preflight con cuerpos, hashes y políticas](evidence/ecom-realtime-auth-r2/preflight.json).
- [Dependencias canónicas de autorización](evidence/ecom-realtime-auth-r2/authority-definitions.json).
- [Esquema, constraints y triggers de fixtures](evidence/ecom-realtime-auth-r2/fixture-schema.json).
- [Ledger y memberships originales](evidence/ecom-realtime-auth-r2/catalog.json).
- [Comparación final](evidence/ecom-realtime-auth-r2/comparison.json).

**Ledger: divergencia preexistente.** Producción tiene 312 versiones frente a 310
archivos ejecutables en main. Sólo remotas: `20260929091708`, `20261006224032`,
`20261008030859` (restaurante). Sólo local: `20261008180000_create_legal_policy_previews.sql`.
Esta comparación es por ID, no equivalencia de cuerpos. No se hizo `db push`,
repair ni modificación del historial. El máximo remoto sigue siendo
`20261008161409`. [Diferencia exacta](evidence/ecom-realtime-auth-r2/ledger-comparison.json).

## B. B-01 — emisor y confianza JWT

**BLOCKED / NO DEMOSTRADO. No se utilizó ningún mecanismo de firma para recepción real.**

El JWKS público publica una EC/ES256, kid
`a740bc90-1a67-4457-a6b3-2cb406524238`. Sólo se consultaron nombres de secretos
Edge; aparece `SUPABASE_JWKS`, no un secreto de firma disponible para este emisor.
No se extrajeron valores secretos, tokens de negocios ni claves privadas. No se
dedujo la clave activa de Auth sólo a partir del JWKS: su estado administrativo y
las integraciones OIDC no quedaron verificados. El intento de inventario del
navegador expiró, sin abrir/modificar configuración.
[Metadata y límites](evidence/ecom-realtime-auth-r2/jwt-metadata.json).

| Opción | Evaluación para este proyecto |
|---|---|
| A. Firmante ya confiable en servidor | No se identificó un emisor reutilizable ni una clave disponible sin extracción. JWKS y service_role no son una clave privada de firma. No se intentó obtener el secreto legacy. |
| B. Custom OIDC | Ruta oficial con discovery/JWKS HTTPS. Añade confianza de un emisor y requiere revisar configuración, custodia y alcance de roles; no configurada ni probada. |
| C. Importación asimétrica | La guía documenta importar standby y después activar mediante rotación. No se asumió que standby sea admitida por Hosted para este uso. No se importó, activó, rotó ni revocó ninguna clave. |
| D. Supabase Auth como firmante | El SDK instalado permite `AdminUserAttributes.role`; el código oficial Auth asigna ese rol. Puede evitar una clave externa, pero necesita identidades/sesiones puente, binding de app_metadata y un contrato diferente de claims/TTL/refresh. No se creó un usuario Auth ni se probó ese puente. |

La opción D **no se descarta como imposible ni como operación que necesariamente
requiera rotación**. No se validó un TTL independiente por concesión mediante sus
APIs públicas. Acoplar el canal al TTL y ciclo de sesiones de Auth o añadir un
hook global demanda un diseño específico antes de usarlo como solución. La
candidata SQL actual espera claims propios en el nivel superior y no es
compatible automáticamente con un JWT Auth convencional.

No se ha demostrado que una rotación global sea indispensable. Tampoco se
presenta aprobación de producción como permiso implícito para cambiar claves o
Auth compartido: las secciones 5 y 15 de la solicitud reservan esas operaciones
para análisis y aprobación posterior. El resto del trabajo seguro continuó.

### Análisis para una eventual decisión de firma

Antes de elegir C o una integración B, se necesita un snapshot administrativo de
claves/proveedores y determinar consumidores verificadores de Auth, Realtime,
REST y Edge. `authorize-image-upload` conserva verify_jwt=true; una transición
de firma exige verificar su compatibilidad. No basta que Lanzo use sesiones
propias: sus clientes todavía dependen del gateway y claves API.

Si se propusiera activar una importada: mantener la clave anterior confiable
durante toda la vigencia de tokens existentes y la propagación verificada;
no revocar claves legacy/API al mismo tiempo; probar callbacks y APIs; definir
la ventana a partir de la configuración real, hoy no inspeccionada. Rollback:
volver al firmante anterior y detener el emisor nuevo, sin destruir claves
previas; medir cachés y sockets pendientes. El compromiso de una clave confiable
puede permitir suplantar claims/roles más amplios que este receptor: el aislamiento
del bearer no limita criptográficamente al poseedor de la privada.

No hay ventana ni rollback de rotación certificados. La alternativa D merece
evaluación antes de solicitar una operación global; no se recomienda rotar por
conveniencia. Ningún cambio de claves forma parte de los SQL entregados.

## C. B-02 — rol, RLS y PUBLIC

**FAIL del requisito estricto en el ACL actual; candidato NO desplegable todavía.**

La candidata crea `lanzo_ecom_signal_receiver` NOLOGIN/NOINHERIT/NOBYPASSRLS,
sin superuser, creación de roles/DB, replicación ni roles heredados. Recibe
únicamente USAGE en su esquema y Realtime, SELECT en messages y EXECUTE de su
helper booleano. No recibe INSERT, tablas comerciales, enumeración de grants,
RPC emisora/revocadora ni membresía en anon/authenticated/authenticator.

Se eligió `lanzo_ecom_signal`, esquema propio no expuesto. Conceder USAGE en el
`private` existente abriría otras funciones con EXECUTE heredado; se evitó esa
ampliación. Las tablas de allowlist y concesiones tienen RLS y no ofrecen políticas
de acceso directo al receptor.

La política SELECT se limita a broadcast, `qa_probe`, issuer/audience/scope/versión,
topic por concesión y coincidencia de tenant, dispositivo, actor, sesión,
runtime y ambas generaciones. El helper vuelve a verificar licencia efectiva,
portal/inbox, dispositivo activo/límite, sesión vigente y owner o Ecommerce staff.
Staff no necesita settings para este canal; las RPC Ecommerce existentes no se
modifican. No se crean objetos en realtime ni se vuelve a habilitar su RLS.

### Seis funciones heredadas y consumidores

| RPC accesible mediante PUBLIC | Autoridad interna / consumidor observado |
|---|---|
| `admin_list_staff_users` | `require_active_admin_session`; licenseService.js |
| `admin_create_staff_user` | Mismo guard Admin; licenseService.js |
| `admin_update_staff_user` | Mismo guard Admin; licenseService.js |
| `pos_get_cash_station_state` | validate_pos_sync_context, Cloud Caja y permiso Caja; cashCloudRepository/financialIntentLedger |
| `pos_admin_close_cash_session` | Rate limit, contexto y sesión Admin del unlimited; cierre administrativo |
| `pos_admin_adopt_legacy_cash_session` | Rate limit, contexto y rol Admin del unlimited; cashCloudRepository |

Las seis tienen grants explícitos para anon/authenticated/service_role además de
PUBLIC y search_path vacío. Se inspeccionaron los guards y consumidores locales;
no existe telemetría exhaustiva de consumidores externos. Las seis llamadas bajo
el receptor, con credenciales sintéticas inválidas, fueron denegadas por autorización
interna. **Eso no elimina EXECUTE ni satisface el requisito estricto.** No se
demostró bypass ni se ejerció una operación financiera con autoridad válida.

La propuesta ACL separada revoca PUBLIC exclusivamente de seis firmas exactas.
No es REVOKE global ni altera cuerpos. Su ensayo transaccional dejó cero SECURITY
DEFINER públicas ejecutables por el receptor y preservó los grants efectivos de
los tres consumidores existentes en las seis funciones. Esto comprueba catálogo,
no todos los clientes externos ni comportamiento Hosted. Requiere revisión
específica antes de una aplicación persistente.

En el runner, SET ROLE inicialmente fue rechazado. Se añadió `GRANT receptor TO
postgres` sólo a la transacción de tests, nunca a la candidata: permite al runner
asumir el receptor sin que éste herede postgres. No prueba que Hosted Realtime
pueda asumir ese rol sin más configuración; ese punto queda BLOCKED.

## D. B-03 — expiración y revocación

**BLOCKED para transporte. Ventana residual de una conexión: NO MEDIDA.**

| Nivel | Resultado ejecutado | Límite |
|---|---|---|
| Nuevas concesiones/renovación | SQL deniega sesión revocada/vencida, permiso retirado, dispositivo inactivo, licencia suspendida/vencida y generaciones antiguas | No se ejecutó un endpoint emisor JWT |
| Elegibilidad antes de emitir | Helper SQL deniega concesión/autoridad inválidas y expiradas | No existe publicador/fan-out comercial ni se midió carrera selección/envío |
| Socket previamente autorizado | NOT RUN/BLOCKED | No hay JWT receptor aceptado ni conexión autorizada con la que medir caché o cierre |

Se generaron concesiones sintéticas de 60/120/300 segundos, se comprobó límite de
300 y expiración acotada por sesión. La revocación SQL seguida de evaluación
denegada tomó **0.517 ms** en la ejecución final. Es una observación dentro de una
transacción, sin commit intermedio: **no mide commit→último evento, WebSocket ni
un máximo universal**. Las expiraciones se comprobaron con filas/claims coherentes
fechados al pasado, no esperando a expirar una conexión real.

No se afirma revocación inmediata. La documentación describe autorización
cacheada al conectar/reautorizar; la conexión existente requiere medición real.
Pendientes: join/RTT, access_token nuevo, exp→cierre, recepción residual, renovación
concurrida, replay, pérdida de red, cierre durante join, cambio de actor/tenant y
reemplazo Admin con socket antiguo. Un bearer robado no se vincula criptográficamente
al hardware por contener device_id. La generación enviada es binding, no prueba
de una captura local auténtica del Actor Runtime.

## E. SQL y estado de aplicación

Identificador generado mediante `supabase migration new`:
`20261020220455_ecom_signal_authorization_qa_foundation_r2`.
**APPLIED=NONE.** Se movió a `supabase/candidates/ecom-signal-auth-r2/` antes de
entregar para impedir su instalación accidental mediante el ledger ordinario.

Objetos de la candidata: un rol, un esquema propio, dos tablas privadas,
dos índices, authority_live, can_receive, dos RPC exclusivas de service_role y
una política SELECT. Allowlist inicialmente vacía; sólo acepta licencias cuyo
prefijo sea `QA-ECOM-SIGNAL-R2-`. No cambia features/planes existentes ni admite
stage comercial. No guarda claves, fingerprints o tokens de sesión en grants.

Las operaciones se ejecutaron con BEGIN, statement_timeout=25s, lock_timeout=2s
y ROLLBACK final. Se revisaron dependencias, triggers y fixtures antes de los
ensayos. Se usaron UUID aleatorios y secretos sintéticos generados dentro de SQL,
sin imprimirlos. Los dispositivos sintéticos tenían realtime_topic nulo y no
capacidades PRO; las actualizaciones sólo alcanzaron IDs creados por el ensayo.
Los eventos auxiliares de licencia/rate limit también quedaron en la transacción.
No se escribieron pedidos, ventas, inventario ni cajas.

Después de los intentos fallidos y de la ejecución final se comprobó ausencia de
rol/esquema/fixtures. Las once definiciones y ACL inspeccionadas y las tres políticas
coinciden con el original. No se instalaron objetos fuera del ledger; no se
alteró el historial remoto para acomodar esta candidata.

## F. QA y evidencia reproducible

[Resultados finales, con FAIL visible](evidence/ecom-realtime-auth-r2/qa-final.json).
La simulación ACL añade dos PASS sin convertir el FAIL original en PASS.

| Verificación | Resultado |
|---|---|
| SQL canónico y claims, base final | 88 PASS / 1 FAIL: EXECUTE heredado de PUBLIC |
| Simulación separada de ACL | 2 PASS, rollback; cero SD públicas para receptor, grants de consumidores preservados |
| Lectura real de tabla comercial bajo rol | PASS: permission denied |
| Dos sesiones del mismo Admin, topics diferentes | PASS SQL; no prueba de dos WebSockets |
| Staff Ecommerce sin settings; staff sin Ecommerce | PASS SQL: permite/deniega respectivamente |
| Renovación por generación y sustitución de grant | PASS secuencial; concurrencia real NOT RUN |
| Rollback explícito de objetos y restauración ACL | PASS transaccional: cero objetos propios; tres políticas y seis grants PUBLIC originales |
| Regresiones Vitest | 77/77 PASS, nueve archivos; cero skipped |
| Contratos Node existentes | 11/11 PASS |
| npm ci | PASS, 701 paquetes; sin cambiar manifest/lockfile |
| Build POS/PWA/postbuild | PASS; audit de 24 startup assets y 0 core Local route assets |
| Sintaxis del generador y git diff --check | PASS |
| JWT válido/inválido/firma manipulada en Realtime | BLOCKED, sin prueba remota |
| Rol/scope/tenant/sesión/PRO/INSERT en Realtime | BLOCKED; las pruebas SQL no certifican el protocolo |
| Replay del bearer, red, desconexión y renovación concurrente | BLOCKED/NOT RUN |
| React Strict Mode del servicio nuevo | NOT RUN: no hay servicio cliente |
| QA manual POS/Admin/staff/offline y canales PRO vivos | NOT RUN; no se usaron sesiones reales |
| Build Store y suite global | NOT RUN en R2 |

Los fallos de implementación encontrados en los ensayos no se ocultaron:
SET ROLE del runner sin membresía de prueba; tiempo de statement anterior a la
emisión en un batch SQL largo (corregido a clock_timestamp con helpers VOLATILE);
gate ACL por nombre que incluía overloads históricos (corregido a firmas exactas).
Un ensayo de sólo sintaxis no se contó como QA.
[Intentos y correcciones](evidence/ecom-realtime-auth-r2/execution-attempts.json).

Reproducción:

```powershell
node scripts/supabase/prepare-ecom-signal-auth-r2.mjs --project-ref odlrhijtfyavryeqivaa
node scripts/supabase/prepare-ecom-signal-auth-r2.mjs --project-ref odlrhijtfyavryeqivaa --with-acl-proposal
```

El generador no conecta ni ejecuta. Sus SQL íntegros se ejecutan contra el proyecto
autorizado conservando ROLLBACK. Logs locales en `.tmp/ecom-signal-auth-r2/`:
`vitest-regression.json`, `node-regression.log`, `build-pos.log` y `npm-ci.log`.
Resumen versionado en [local-validation.json](evidence/ecom-realtime-auth-r2/local-validation.json).
Los warnings Workbox de globs sin coincidencia y Baseline mapping obsoleto del
main se conservaron; un build correcto no certifica disponibilidad offline física.

Logs productivos agregados, sin texto de queries ni datos de usuarios, en la
ventana 2026-10-20 15:45–16:20 America/Mexico_City: se observaron SQLSTATE 42501,
P0001 y 42809, además de LOG 00000. La ventana incluye otras actividades del
proyecto; no se atribuye todo al ensayo. El runner registró sus propios rechazos
esperados/errores corregidos. No se obtuvieron eventos realtime_logs en ese corte;
eso no acredita ausencia universal de errores Realtime. Advisors: 34 INFO RLS sin
política, 7 WARN search_path, 181 WARN SD anon y 182 WARN SD authenticated;
baseline observado, sin reparación global.
[Advisors y URLs oficiales de remediación](evidence/ecom-realtime-auth-r2/advisors-summary.json).

## G. Impacto en producción y FREE/PRO

Postflight: ACTIVE_HEALTHY, rol y esquema propios ausentes, cero licencias con
prefijo QA del ensayo, 312 migraciones, tres políticas originales y once cuerpos/ACL
originales. [Comprobación](evidence/ecom-realtime-auth-r2/postflight-final.json).

No se desplegó frontend, Edge Function, Auth hook o publicador. No hay diff frente
a main en src/store/api, paquetes o migraciones ejecutables. No se habilitaron
cloud_notifications, notification_center, support_realtime, cloud_pos_sync,
realtime_license_sync, sincronización de catálogo ni eventos comerciales FREE.
Checkout y productos por peso no se tocaron.

Esto confirma ausencia de persistencia de los objetos/filas inspeccionados y
regresiones focales aprobadas. **No constituye certificación manual de todos los
flujos, sesiones o dispositivos en producción.** No se accedió a tokens de Tío
Antonio ni a pedidos/clientes reales. Las llamadas de rechazo a Caja no ejecutaron
operaciones financieras autorizadas.

## H. Git y compatibilidad con PRs concurrentes

Commit de SQL/tests/evidencia: `08b676404ff6561c6131a38aef6744d77aa59d25`.
La entrega documental posterior referencia ese commit; `git log -1` identifica
el HEAD final de esta rama local. Base main vigente: `f014a1f340ed78335d3e704eefff49cda8465115`.

| PR | Último estado consultado | Compatibilidad |
|---|---|---|
| [#366](https://github.com/fdxruli/Lanzo-POS/pull/366) | OPEN Draft, HEAD `11f6115afc843e55dcfa0780842c326db752bd90`, base main | Su continuidad offline no autoriza grants cloud; futura integración debe verificar online y generaciones |
| [#338](https://github.com/fdxruli/Lanzo-POS/pull/338) | OPEN Draft, HEAD `fef7205f76b173025f503e60d0968f446f741e78`, base main | No se modificaron caja, venta, bridge ni runtime; ledger remoto incluye SQL restaurante ausente de main |
| [#352](https://github.com/fdxruli/Lanzo-POS/pull/352) | OPEN Draft, HEAD `d758f69b2119f1bc346eb0ac86ba0a74c0265668`, base rama #338 | Ningún cambio a transición SQL/PWA; no se tomaron sus definiciones como producción |

No se creó PR Draft ni se hizo push: la condición de la sección 13 (B-01/B-02/B-03
demostrados) no se cumple. No hubo merge, rebase o force push de ramas ajenas.
No hay certificación de integración de esta candidata con el código de esos PRs.

## I. Rollback y recursos QA

Rollback realmente usado: ROLLBACK de cada transacción, seguido de catálogo y
recuento del prefijo sintético. No quedan clientes, JWT receptores, claves QA,
sesiones o servicios remotos creados por esta ejecución.

Se ensayó además retirar la política, RPC, helpers, tablas, esquema y rol propios
y restaurar las seis ACL originales dentro de otra transacción que también se
revirtió. Resultado: cero objetos propios, tres políticas y seis PUBLIC grants.
[Evidencia del drill](evidence/ecom-realtime-auth-r2/rollback-drill.json).

Los scripts `rollback.sql` y `public-rpc-acl-rollback.sql` son concretos y separados,
sin CASCADE. No hace falta ejecutarlos ahora. Si se aplicaran cambios en el futuro:
detener emisor/publicador, revocar grants, tratar la ventana residual medida,
retirar sólo objetos propios y versionar el rollback como migración nueva.
No borrar historial ni tocar canales PRO. Dependencias inesperadas deben detener
la retirada. Una futura limpieza de filas persistidas usaría IDs/prefijo QA
registrados; hoy el recuento es cero y no se ejecutó DELETE de limpieza general.

## J. Próxima fase y decisión de revisión

**Contrato de Fase 1B: NO LISTO para consumir.** La candidata define IDs canónicos,
runtime/generaciones, grant, topic privado, scope y expiración de QA. No define
todavía un firmante confiable, prueba Hosted de rol, selector/fan-out ni servicio
cliente. Firmas, claims y TTL pueden necesitar adaptación si se elige Auth nativo.

Orden de continuidad: revisar primero la propuesta ACL y consumidores pendientes;
decidir/probar una ruta de firma compatible (incluida D antes de rotación global);
promover sólo SQL aprobado con ledger reconciliado; crear fixtures persistentes
selectivos y ejecutar la matriz real de JWT/RLS/expiración/revocación/replay.
Después implementar lifecycle del cliente aislado con Actor Runtime, Strict Mode,
cleanup y respuestas tardías. Hasta medir los tres niveles de revocación y completar
QA no emitir `order_created` ni habilitar FREE comercialmente.

La revisión requerida procede de los gates explícitos del propietario sobre
claves/Auth y políticas/ACL compartidas, no de una falta de autorización para
usar producción. La autorización productiva sí se aprovechó para los ensayos
reversibles documentados. No se solicita crear staging ni otro proyecto.

Fuentes oficiales consultadas: [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization),
[Signing Keys](https://supabase.com/docs/guides/auth/signing-keys),
[Edge secrets](https://supabase.com/docs/guides/functions/secrets),
[Custom OIDC](https://supabase.com/docs/guides/auth/third-party/custom-oidc),
[Auth Admin createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser),
[Auth Admin implementación](https://github.com/supabase/auth/blob/master/internal/api/admin.go)
y [token endpoint](https://github.com/supabase/auth/blob/master/internal/api/token.go).
El código oficial consultado no demuestra por sí solo la versión/configuración Hosted.
