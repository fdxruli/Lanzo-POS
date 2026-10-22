# LANZO POS — Fase 1A.3: hardening y certificación del bridge

Fecha de ejecución: 2026-10-22, America/Mexico_City. Proyecto exclusivo:
`odlrhijtfyavryeqivaa`. **Recomendación: HOLD_SECURITY.** Hay correcciones concretas
y pruebas Hosted nuevas; Fase 1A no está cerrada y Fase 1B permanece bloqueada.
El PR continúa OPEN / Draft / HOLD, sin merge ni activación comercial FREE.

## A. Git y PR

- Rama: `codex/ecom-realtime-auth-1a2`; HEAD inicial
  `692237efe717de008cf15ee6231cb7ae32fe1a3f`.
- `origin/main` actualizado y revalidado:
  `9ca65fc07804f40c2add5e59bee0e6edca940b8f`, posterior a #366 y a `f48aab536`.
- Se integró ese main exclusivamente en la rama de trabajo mediante el commit
  local `350920e273093b3b9c989b4ebac440d0afad5d8b`; no se fusionó ningún PR.
- Primer commit de implementación 1A.3:
  `3355288f5f59213443283475f3df5a7a7fde14ed`. Los resultados identificados con ese
  SHA no certifican por sí solos el commit que contiene el informe final.
- Se actualiza el [PR #368](https://github.com/fdxruli/Lanzo-POS/pull/368).
  El SHA final y los checks ejecutados sobre él se fijan en su descripción y en
  la entrega; el informe y manifiesto pertenecen a ese mismo historial.
- #338 sigue OPEN/Draft, `fef7205f76b173025f503e60d0968f446f741e78`;
  #352 sigue OPEN/Draft, `d758f69b2119f1bc346eb0ac86ba0a74c0265668`, sobre #338.
  No se modificaron sus ramas, estados o contratos de Restaurante.

El checkout principal `C:/dev/Lanzo-POS-Git`, sus archivos sin seguimiento y las
worktrees previas se conservaron. Se reutilizó la worktree 1A.2 y se creó una
worktree separada, detached, `C:/dev/Lanzo-POS-ecom-1a3-baseline`, para reproducir
los contratos de main. No hubo force push. Se leyeron R1, FEASIBILITY.R1, producción
R2, 1A.1, 1A.2, sus candidatas, ensayos y evidencia. Los antecedentes históricos
no se contabilizan como ejecuciones nuevas.

El diff funcional añade secretos/vault, recuperación y controles HTTP del bridge,
recibos de publicación, validación de sesión y un adaptador QA del Actor Runtime.
No monta el servicio en App/Layout, publica `order_created`, diseña avisos ni
modifica catálogo, checkout, peso, procesos financieros o almacenamiento local.

## B. Seguridad Auth

El JWT receptor conserva el rol técnico, `sub`, `session_id` y app_metadata
administrada. La autoridad sigue siendo Lanzo: licencia, dispositivo, actor y
sesión se resuelven en SQL. Campos declarados de tenant/actor/dispositivo y
user_metadata no conceden autoridad. Una sesión Auth nueva necesita su propio
binding; conocer un topic o poseer el bearer anterior no crea ese binding.

Se ejecutaron 27 comprobaciones del harness de hardening contra Auth/Realtime
Hosted y el broker servidor local. Sus PASS incluyen observaciones de una
capacidad residual; **no significan que Auth prohíba el autoservicio**.

| Endpoint/caso real | Observación | Interpretación |
|---|---|---|
| Contraseña y nuevo login | 200 / 200 | El bearer puede cambiar su contraseña y crear una sesión Auth sin binding. |
| Metadata ordinaria | 200 | Rol técnico y app_metadata privilegiada permanecieron iguales. |
| Rol/app_metadata privilegiada | 403 | No se observó escalada a service_role ni PRO. |
| Cambio de correo sintético | 400 | Sólo se observó rechazo actual; no se certifica un cambio de correo exitoso. |
| Recuperación por correo sintético | 400 | No se enviaron correos a usuarios reales; no demuestra todos los flujos SMTP. |
| MFA TOTP: enroll y verify | 200 / 200 | El bearer puede incorporar un factor verificado. No se usaron SMS. |
| Identity linking consultado | 404 | Ruta/configuración actual; no se completó un proveedor externo. |
| DELETE de autoservicio | 405 | Rechazo de esa ruta. Admin DELETE con receptor: 403. |
| Refresh de sesión propia | 200 | Auth no sustituye la autoridad Lanzo. |
| Replay de refresh antiguo | 400 `refresh_token_already_used` | Tres rotaciones y espera de 12 s antes del replay; no se entregó refresh al navegador. |
| Signup de identidad adicional | 429 | Límite observado, no prueba de un límite universal por identidad técnica. |
| Tablas, RPC Admin y RPC de binding | 403 | Rechazos REST reales; el rechazo del gateway no elimina EXECUTE heredado de PUBLIC. |
| Sesión Auth obtenida fuera del broker | Join denegado | No adquiere el topic previo ni un grant Lanzo. |
| Otro tenant y bearer sin credenciales Lanzo | Denegados | No permiten issue ni recovery. |

**Corrección implementada:** `action: recover` autentica primero las credenciales
Lanzo, pone la identidad en cuarentena y revoca todos sus grants bajo la barrera
del publicador. Después elimina exclusivamente el Auth user identificado por
inventario, rol técnico y app_metadata; no usa email/user_metadata mutables como
autoridad de borrado. Reset exige que el user anterior ya no exista y que no haya
grants sin revocar. El siguiente runtime obtiene otro Auth `sub` y otro topic.
Un fallo parcial conserva la cuarentena y permite reintentar. No destruye una
identidad ajena ni crea usuarios repetidamente para solucionar un error de red.

Se probó recuperación real después de contraseña modificada y MFA verificado;
el correo sintético fue rechazado, por lo que la limpieza con email ya modificado
se cubre por prueba unitaria, no por un cambio Hosted exitoso. Auth del usuario
anterior y nuevas emisiones a su topic quedaron denegados. Recovery exige un
runtime nuevo y puede interrumpir las otras pestañas de esa identidad QA.

**Pendiente P1:** las sesiones Auth sin binding pueden consumir recursos fuera
del cupo de grants. El broker puede retirar la identidad comprometida con
autoridad Lanzo, pero su límite de cuatro grants no limita el endpoint Auth de
login. Falta una política operativa de detección/contención/limpieza y aceptación
del riesgo o una solución de arquitectura revisada. No se instalaron hooks ni se
cambió Auth comercial para ocultar esta limitación.

[Resultados Hosted](evidence/ecom-realtime-auth-1a3/hosted-hardening.json).

## C. Secretos y vault

Se eliminó la derivación de contraseñas y cifrado desde service_role. AES-GCM usa
claves aleatorias dedicadas de 32 bytes; HMAC usa otra clave dedicada y propósito
versionado. El envelope `v2.key_id.iv.ciphertext` autentica versión, key ID y grant
como AAD. Faltantes, material corto/inválido, binding intercambiado, corrupción,
versiones desconocidas y reutilización entre contraseña y cifrado fallan cerrados.
No hay fallback a la clave compartida ni refresh/password en el cliente receptor.

La rotación conserva hasta tres versiones de lectura, selecciona una versión de
escritura y recifra un batch privado mediante compare-and-swap de ciphertext.
Una renovación/revocación concurrente no es sobrescrita. Se probaron lectura
vigente/anterior, retiro de clave, corrupción, conflicto CAS, fallo parcial y
recuperación. La rotación Hosted conservó JWT/grant y pudo leer el vault recifrado.
No se debe retirar la clave anterior por el éxito de un solo batch.

El vault v1 anterior necesita drenaje/migración explícita si alguna vez se
reintrodujera: no se descifra silenciosamente con la credencial compartida. Al
iniciar esta fase no quedaban vaults/usuarios QA de 1A.2 en producción. La rotación
de la clave de contraseñas se trata mediante drenaje y recovery de la identidad;
no se promete que una contraseña vieja cambie automáticamente.

Se aprovisionaron cinco secretos **QA nuevos**: `LANZO_ECOM_VAULT_KEYS`,
`LANZO_ECOM_VAULT_KEY_ID`, `LANZO_ECOM_PASSWORD_KEY`,
`LANZO_ECOM_PASSWORD_KEY_ID`, `LANZO_ECOM_QA_CONTROL_TOKEN`. El último controla
operaciones administrativas HTTP con una capacidad independiente, desactivadas
si falta. Ninguno llega al navegador; todos se retiraron al cerrar el ensayo.

La primera llamada HTTP de limpieza devolvió 403 con el control anterior basado
en comparación literal de la credencial. El colector local retiró 3 usuarios.
Se conservó el intento, se separó la capacidad administrativa, se añadieron tests
del límite HTTP/bytes y se comprobó HTTP 200 con la nueva capacidad: segunda
colección idempotente, 3 identidades retiradas, 0 borrados adicionales. No se
atribuye el rechazo a una rotación de claves no observada.

[Procedimiento completo y permisos](../../supabase/candidates/ecom-signal-auth-1a3/README.md).
[Verificación de secretos originales intactos](evidence/ecom-realtime-auth-1a3/secrets-postflight.json).

## D. ACL

La propuesta y rollback R2 siguen separados. No se aplicaron persistentemente
los seis REVOKE ni se cambiaron cuerpos. Se inspeccionaron nueve overloads,
grants explícitos, membresías y consumidores. Las seis firmas vigentes son:

```text
admin_list_staff_users(text,text,text,text)
admin_create_staff_user(text,text,text,text,text,text,jsonb,text,text)
admin_update_staff_user(text,text,text,uuid,text,jsonb,boolean,text,text,text)
pos_get_cash_station_state(text,text,text,text)
pos_admin_close_cash_session(text,text,text,text,text,text,numeric,numeric,text,text,integer,text)
pos_admin_adopt_legacy_cash_session(text,text,text,text,text,integer,text)
```

Ensayo nuevo BEGIN/ROLLBACK: **18/18 PASS**, matriz **32 roles × 6 firmas** y cuerpos
intactos. Seis invocaciones reales del receptor devolvieron SQLSTATE 42501 después
de los REVOKE simulados. Las doce positivas ejecutaron listar/crear/actualizar
Staff y consultar Caja con credenciales Lanzo sintéticas legítimas bajo anon,
authenticated y service_role. Las escrituras Staff/estación se revirtieron.

Los tres roles clientes conservan sus grants explícitos; postgres y supabase_admin
también conservan acceso. Otros 27 roles pierden el EXECUTE heredado, incluido el
receptor y roles de infraestructura. No se añadieron grants preventivos.
authenticator puede seguir adoptando los roles clientes, pero eso no certifica
un consumidor administrativo directo desconocido.

Consumidores conocidos: licenseService, cashCloudRepository y financialIntentLedger.
Los cuerpos/dependencias canónicas continúan intactos. **Cierre y adopción reales
de Caja, clientes administrativos externos y procesos cloud directos: NOT RUN.**
Por ello la corrección compartida continúa HOLD para revisión específica del
propietario, aunque el ensayo de catálogo/ejecución haya pasado.

[Matriz y llamadas](evidence/ecom-realtime-auth-1a3/acl-rehearsal.json).
[Propuesta exacta](../../supabase/candidates/ecom-signal-auth-r2/public-rpc-acl-proposal.sql).

## E. Revocación y emisiones

Se conserva la barrera por fila de grant: el publicador mantiene el lock hasta
encolar `realtime.send`; revoke y quarantine actualizan esas mismas filas. La
selección revalida licencia/plan, dispositivo, actor, sesión Lanzo, sesión Auth y
expiración. No depende de un filtro del navegador. Se agregaron recibos únicos
por grant/probe: un retry después de un commit observado devuelve ALREADY_ENQUEUED
sin duplicar la sonda. Si revoke ya confirmó, el retry devuelve EXCLUDED.

Dos HTTP independientes contra Hosted, instrumentación QA de 3 s:

| Orden | Resultado observado |
|---|---|
| Publish toma lock; luego revoke | ENQUEUED; revoke esperó ~3042 ms y confirmó; retry EXCLUDED. |
| Revoke toma lock; luego publish | REVOKED; publish esperó ~2779 ms y devolvió EXCLUDED. |
| Cuatro issue simultáneos del mismo runtime | 200 / 409 / 409 / 409, un grant. |
| Grant expirado, JWT todavía vigente | Socket joined; nuevo join CHANNEL_ERROR; publish EXCLUDED. |

El evento elegido antes de la barrera llegó cerca de la confirmación de revoke;
eso es entrega tardía de una emisión anterior. No se promete expulsión inmediata
del WebSocket. La garantía del publicador es excluir una selección nueva después
de confirmarse la barrera, en las carreras medidas.

Se ejecutaron además **21/21 checks SQL con rollback**, con bindings sintéticos
reales: sesión Admin revocada/vencida, retiro de Staff/permiso, dispositivo
liberado, licencia suspendida, capacidad retirada y grant expirado. El primer
ensayo dio 20/21 porque las mutaciones de licencia disparaban efectos sobre una
sesión Staff del siguiente caso. Se preservó ese resultado y se aislaron las
mutaciones en subtransacciones; los verificadores comerciales no se alteraron.
Reemplazo del mismo owner se cubre con revocación del ID previo y en Actor Runtime;
no se certifica un reemplazo físico de dos POS contra Hosted.

La inspección del catálogo encontró el publicador propio como único emisor
existente que contiene ese namespace 1A.2. El emisor separado de expiración sólo
acepta su allowlist `1a3-expiry` y se retiró. Las primitivas privilegiadas genéricas
Realtime siguen siendo una frontera de confianza del servidor: no se afirma que
service_role sea incapaz de usarlas directamente. No existe aquí un publicador
comercial `order_created` certificado. El futuro publicador debe pasar la barrera.

La primera repetición Edge falló al intentar usar una identidad Staff creada con
otra clave QA de contraseñas. El drenaje explícito recuperó esa identidad y la
repetición completa pasó 8/8. Se conserva el FAIL; no era permiso para rotar un
secreto compartido. El timeout físico posterior al commit sigue cubierto por el
doble de respuesta perdida y por idempotencia Hosted; no se cortó esa conexión
de red de forma física.

[Carreras](evidence/ecom-realtime-auth-1a3/edge-races.json).
[Autoridad SQL](evidence/ecom-realtime-auth-1a3/authority-final.json).

## F. JWT natural y renovación

Se esperó el TTL nativo real de **3600 s**, sin cambiar `jwt_exp`. Experimento de
transporte separado con el mismo rol técnico, una identidad sintética y allowlist
propia; no extendió un grant Lanzo de 120 s ni usó un firmante nuevo.

| Observación | America/Mexico_City, 2026-10-22 |
|---|---|
| Exp del JWT | 01:27:44.000 |
| Última sonda recibida | 01:27:41.607 |
| CLOSED observado | 01:27:44.281 |
| Rejoin con JWT vencido | CHANNEL_ERROR, InvalidJWTToken |
| Refresh Auth después de exp | 200 |
| Token nuevo + allowlist vencida | CHANNEL_ERROR, Unauthorized |
| Eliminación de la identidad de expiración | Confirmada 01:28:40.440 |

La diferencia exp→CLOSED fue **281 ms en esta observación**; no es una cota máxima.
Hubo errores/rejoins anteriores al intervalo final, con el mismo JWT y sin
refresh. La captura conserva todas las transiciones y el límite del ensayo.
No se atribuye una causa de red no demostrada ni se generaliza estabilidad/latencia.

Issue/renewal ahora reutiliza el JWT si conserva más de 90 s, pero siempre vuelve
a finalizar contra autoridad Lanzo. Cerca de exp, refresh debe conservar el
session_id vinculado. La prueba Hosted renovó el grant conservando exactamente
el access token y extendiendo sólo su concesión. Unit tests cubren broker caído,
respuesta perdida, scope/sesión intercambiados y refresh cercano a exp. El cliente
receptor no recibe ni persiste refresh tokens.

[Traza natural completa](evidence/ecom-realtime-auth-1a3/jwt-natural-expiry.json).

## G. Escala y costos

La Management API confirmó **plan Free**. Baseline observado: 0 usuarios y 0
sesiones Auth. Durante un snapshot QA había 4 usuarios/sesiones, 4 grants y 9380
bytes de vault; hubo creación/eliminación adicional durante recovery. Esto no es
MAU facturado ni un benchmark de carga. La cuota residual de AI/otras funciones,
mensajes comerciales y conexiones existentes no quedó disponible.

Modelo explícito: 2 dispositivos por negocio, 2 sesiones Lanzo por dispositivo
y día, 2 pestañas, 8 h/día, 30 días; renovación de grant cada ~90 s, 50 pedidos/día.
No supone liderazgo entre pestañas. Cuenta iniciales + renovaciones Edge y
emisión/entrega de futuras señales; no se emitieron pedidos para medirlo.

| Negocios | Conexiones pico adicionales | Identidades/MAU técnicos del modelo | Invocaciones broker/mes | Mensajes de señales/mes |
|---:|---:|---:|---:|---:|
| 10 | 40 | 1200 | 386400 | 120000 |
| 100 | 400 | 12000 | 3864000 | 1200000 |
| 500 | 2000 | 60000 | 19320000 | 6000000 |
| 1000 | 4000 | 120000 | 38640000 | 12000000 |

Free publica 200 conexiones simultáneas y 500000 invocaciones Edge incluidas;
con estos supuestos, ~12 negocios agotarían nominalmente el presupuesto Edge
antes de sumar consumo existente, retries y otras funciones. No es un umbral de
capacidad medido. A 100 negocios se superan ambos presupuestos del modelo Free.
Pro y cambios de límites requieren una decisión económica/configuración separada;
no se contrató, amplió ni modificó ningún plan.

Optimizado: identidad reutilizada durante la misma sesión Lanzo, JWT reutilizado,
single-flight SQL, un dueño por contexto JS, cierre de transporte anterior,
jitter/backoff y colector acotado por inventario. La capacidad QA permanece en
10 identidades globales y 4 grants activos por identidad: **no es configuración
comercial**. El scan de huérfanos tiene límite de 1000 usuarios, sin garantía de
recorrer una población comercial mayor. Faltan retención/purga paginada, liderazgo
entre pestañas, límites comerciales por tenant y recolección programada revisada.
No se instaló un cron productivo. Borrar usuarios no demuestra reducción del MAU
ya consumido. El diseño sigue HOLD_SCALE además del gate de seguridad.

[Modelo reproducible](evidence/ecom-realtime-auth-1a3/scale-model.json).
[Cuotas Realtime](https://supabase.com/docs/guides/realtime/limits),
[invocaciones Edge](https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations),
[MAU](https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users).

## H. Actor Runtime y React

Se añadió `ecomSignalActorAdapter.js` y `useEcomSignalQa.js`, **enabled=false** por
defecto y sin imports globales. El adaptador captura el handle actual, comprueba
la familia y sessionId de credenciales y revalida antes/después de cada await y
callback. GRANTED local/offline no equivale a autoridad cloud; offline/pestaña
oculta cierra el receptor y no afecta la sesión POS.

Un registro WeakMap evita dos dueños activos dentro del mismo contexto JS y sólo
conserva IDs de runtime/contexto, sin JWT/credenciales. Cleanup viejo no detiene al
dueño nuevo. Una respuesta autoritativa queda bloqueada para esa generación; no
se reintenta simplemente por focus/online. Los transportes y listeners previos
se descartan; las renovaciones incorporan jitter.

**12/12 casos React dedicados PASS**, incluido Strict Mode, Admin→Staff,
Staff→Admin, mismo owner con sesión reemplazada, tenant/logout con RPC tardía,
credenciales de otra sesión, dispositivo liberado, Staff sin Ecommerce, offline,
visibilidad, dos montajes y denegación sin rejoin. CI también ejecutó el controller
actual (20), bridge de sesión (10) y suites de actor scoped storage (30) con PASS.
React Doctor: 100/100, ocho archivos, sin diagnósticos.

Límite de integración: no se monta en un POS real ni se certifican Ventas/Caja
manuales o PWA física a 320/360/390/430/tablet/escritorio. Regreso tras una pausa
mayor que el grant necesita un runtime nuevo: un tombstone no se revive; el flujo
comercial de recuperación automática todavía no se entrega. Liderazgo real entre
pestañas tampoco está implementado. No se habilitó Centro de Notificaciones FREE
ni se cambió la autoridad local/Dexie para resolver Realtime.

## I. SQL, producción y rollback

Preflight: 316 entradas remotas, 3 políticas Realtime originales, cero recursos
QA de 1A.2. Las cuatro entradas QA anteriores se verificaron y conservaron.

| Archivo local preparado | Versión remota real | Nombre |
|---|---|---|
| 20261022062557 | 20261022062731 | qa_ecom_native_bridge_1a3_temporary |
| 20261022063248 | 20261022063527 | qa_ecom_native_bridge_1a3_hardening |
| 20261022070016 | 20261022070244 | qa_ecom_native_bridge_1a3_race |
| 20261022135551 | 20261022135736 | qa_ecom_native_bridge_1a3_cleanup |

Los SQL exactos están fuera de migrations. No se editaron migraciones históricas,
hizo db push/repair, reaplicaron aliases de Restaurante o instalaron previews
legales. Las divergencias comerciales conocidas siguen siendo las tres versiones
Restaurante y la preview legal sólo local; las cuatro entradas nuevas son auditoría
QA identificada, no una divergencia inexplicada ni un despliegue comercial.

Rollback ejecutado: colector, eliminación Auth por inventario, parada/retirada del
endpoint QA, borrado selectivo de los dos tenants sintéticos y sus dependencias,
retirada de políticas/helpers/tablas/esquemas/rol propios y de cinco secretos QA.
No se utilizó CASCADE sobre objetos compartidos ni se restauraron ACL que nunca
se aplicaron. La migración de cleanup exige el inventario esperado y ausencia de
usuarios Auth técnicos antes de retirar el esquema.

Postflight: **320 entradas de ledger; cero schemas/rol/RPC/tenants/users QA; tres
políticas originales; nueve cuerpos/ACL originales**. Dos Edge Functions originales
siguen ACTIVE con iguales hashes; sus revisiones avanzaron 46→49 y 28→31 durante
actualizaciones del entorno de secretos. No se cambió su código ni verify_jwt.
Los hashes de los trece secretos preexistentes coinciden y los cinco QA ya no
existen. El proyecto sigue ACTIVE_HEALTHY. Los asesores conservan los mismos hallazgos
preexistentes: 34 informativos RLS sin políticas, 7 search_path mutables y
181/182 funciones SECURITY DEFINER ejecutables por anon/authenticated.
No se aceptan como prueba de autorización comercial del receptor.

[Postflight](evidence/ecom-realtime-auth-1a3/postflight.json),
[Edge antes/después](evidence/ecom-realtime-auth-1a3/functions-postflight.json),
[rollback exacto](../../supabase/candidates/ecom-signal-auth-1a3/20261022135551_qa_ecom_native_bridge_1a3_cleanup.sql).
Los audit logs normales pueden permanecer según su retención; no se borró historia.

## J. Regresiones y QA

| Verificación | Resultado y alcance |
|---|---|
| Node focal broker/receiver/vault/HTTP final | PASS: 24/24 después de la corrección del control QA. |
| React dedicado | PASS: 12/12; también incluido en CI. |
| Hosted hardening local-servidor | PASS: 27 observaciones/checks; conservar límites SMTP/linking/signup descritos en B. |
| Edge y carreras repetidas | PASS: 8/8; primer intento FAIL conservado. |
| SQL de autoridad | PASS: 21/21; primer intento 20/21 conservado. |
| ACL simulada y consumidores conocidos | PASS: 18/18; aplicación compartida y operación de dos RPC de Caja HOLD. |
| Expiración JWT natural | PASS_OBSERVATION; una ejecución con reconexiones anteriores, sin cota universal. |
| Deno check y lint focal | PASS, sin omitir los fallos de tipos corregidos durante desarrollo. |
| React Doctor | PASS, 100/100. |
| POS/PWA/postbuild y Store sobre 3355288f5 | PASS en CI; local también terminó, pero su metadato de HEAD se capturó al finalizar y no certifica un árbol limpio. |
| Suites amplias focales CI sobre 3355288f5 | FAIL bruto: 1316 PASS / 10 FAIL; los diez emparejados con fallos compartidos de main. |
| PR127 sobre 3355288f5 | PASS diferencial: 99 fallos compartidos, 0 nuevos y 0 identidades sin resolver. |
| Actor Scoped Storage sobre 3355288f5 | PASS en workflow dedicado. |
| Node completo Windows | FAIL: 171 PASS / 12 FAIL; reproducción main de los cuatro archivos: 16 PASS / los mismos 12 FAIL. |
| Node completo Linux sobre 3355288f5 | FAIL: 182 PASS / 1 FAIL preexistente, contrato de downgrade financiero. |
| Lint completo | FAIL bruto: 159 errores / 177 warnings; cero diagnósticos en los archivos nuevos de cliente. Baseline reproducido: los mismos 159 errores / 177 warnings y cero diagnósticos nuevos, comparados por archivo, regla, línea y mensaje. |
| Focal amplio Windows | BLOCKED: no produjo JSON final; se detuvo sólo su árbol de procesos propio. No se contó como PASS. La cobertura Actor correspondiente sí corrió en CI. |
| QA manual de POS/PRO/móvil/PWA física y flujos financieros | NOT RUN. |

El registro definitivo del **HEAD final** está en los checks y descripción del
[PR #368](https://github.com/fdxruli/Lanzo-POS/pull/368), con SHA y URLs de cada run.
No se reutiliza un build anterior para cerrar ese gate. Las suites amplias y lint
pueden seguir rojas por baseline; se informa su resultado bruto y diferencial.
No se modificaron tests históricos ni sus umbrales para volverlos verdes.

[Atribución caso por caso](evidence/ecom-realtime-auth-1a3/ci-initial-summary.json),
[PR127 reproducible](evidence/ecom-realtime-auth-1a3/pr127-initial.json).
Los logs comprimidos y manifiesto están en la misma carpeta de evidencia.

## K. Riesgos pendientes

Bloqueantes: revisión/aplicación específica de las seis ACL con QA operativa de
cierre/adopción y consumidores externos; abuso y crecimiento de sesiones Auth sin
binding; política de detección y colección comercial; cuotas/costo reales del
proyecto Free; integración física y recuperación de runtimes después de pausas;
certificación final por SHA y resolución/aceptación de los gates compartidos.
No se observó escalada comercial, pero tampoco se declara contenido todo abuso
de recursos por el poseedor del bearer.

Optimizaciones posteriores: liderazgo entre pestañas, paginación/journal de
huérfanos, retención de tombstones/recibos, métricas de cuota y carga sostenida.
No sustituyen los bloqueantes ni autorizan un emisor comercial alternativo que
omita la barrera. Un portador de service_role sigue siendo servidor privilegiado.

## L. Recomendación

**HOLD_SECURITY**, con gates secundarios HOLD_SCALE/HOLD_INTEGRATION. El material
queda revisable y las pruebas/rollback son reproducibles; no se declara READY
con estos P1 pendientes. Mantener OPEN / Draft / HOLD, detener para revisión del
propietario y conservar Fase 1B bloqueada. FREE/PRO mantienen sus capacidades
comerciales; no hay nuevo aviso, order_created o receptor global activo.

Referencias de contrato: [sesiones Auth](https://supabase.com/docs/guides/auth/sessions),
[autorización Realtime](https://supabase.com/docs/guides/realtime/authorization),
[rate limits Auth](https://supabase.com/docs/guides/auth/rate-limits).
Se revisó el changelog vigente; el aviso de TLS CBC previsto desde noviembre no
motivó cambios de configuración global ni explica por sí solo errores del ensayo.
