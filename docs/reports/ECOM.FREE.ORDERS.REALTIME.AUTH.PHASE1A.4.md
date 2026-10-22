# LANZO POS — Fase 1A.4

2026-10-22, America/Mexico_City. Proyecto exclusivo `odlrhijtfyavryeqivaa`.
**HOLD_SECURITY; HOLD_SCALE para la población amplia en infraestructura Free.**
No se cierra Fase 1A ni se activa recepción comercial FREE. La optimización ya
reduce llamadas y joins; el autoservicio Auth sigue necesitando una decisión
explícita. PR #368 permanece OPEN / Draft / HOLD, sin merge.

## 1. Referencias y preflight

HEAD inicial `6b077bd86235ac69051b6a3fae6c56af2e8c4d15`, rama exclusiva
`codex/ecom-realtime-auth-1a2`, worktree existente limpia al inicio
`C:/dev/Lanzo-POS-ecom-auth-1a2`. Main remoto revalidado
`9ca65fc07804f40c2add5e59bee0e6edca940b8f`. Se preservaron el checkout principal,
sus archivos de recuperación sin seguimiento y todas las otras worktrees.
No hubo nueva rama/PR paralelo, force push, Docker, staging, db push o repair.

Se leyeron completos R1, FEASIBILITY.R1 (1A.0), producción R2, 1A.1, 1A.2 y 1A.3,
con candidatas, ensayos y evidencia relevante. No se contabilizan como QA nueva.
#338 y #352 se volvieron a consultar: ambos OPEN/Draft; sus ramas no se editaron.
El SHA final y sus checks se fijan en la descripción del [PR #368](https://github.com/fdxruli/Lanzo-POS/pull/368)
y la entrega, evitando atribuir checks del SHA inicial al nuevo HEAD.

Producción inicial: ACTIVE_HEALTHY, PostgreSQL 17.6.1.063, organización Free,
ledger 320, cero usuarios/sesiones Auth, cero fixtures/esquemas/roles del bridge,
tres políticas Realtime originales. Los ocho registros QA históricos siguen en
el ledger. Edge original: lanzo-ai-agent v49 y authorize-image-upload v31, sin
broker QA desplegado. Se consultaron logs agregados y advisors antes del SQL.
El inventario anterior y sus Auth IDs ya estaban retirados.

El changelog vigente incluye la retirada de ciphers TLS CBC desde noviembre;
no justifica cambiar claves/Auth globales. Las APIs actuales se contrastaron con
documentación oficial y el SDK fijado en el lockfile, sin actualizar paquetes.

## 2. Comparación y decisión

| Alternativa | Seguridad / revocación | Infraestructura, invocaciones y Auth | WebSockets / latencia | Complejidad, offline, FREE/PRO y mantenimiento |
|---|---|---|---|---|
| A. Bridge optimizado, elegida | Binding actual y barrera por emisión; TTL no sustituye autoridad viva | 29 llamadas por receptor en sesión de 4h a TTL600, incluyendo fronteras JWT; 1 login + 4 refresh del modelo; MAU por sesión Lanzo | Un socket estable por dueño; JWT nuevo usa setAuth; señal rápida sin polling | Cambios acotados. Nuevo runtime/grant tras expiración; callback exige RPC actual. QA apagado para ambos planes |
| B. Separar identidad/sesión/grant más ampliamente | Seguro dentro del mismo contexto si se conserva binding; reutilizar entre sesiones/actores amplía el impacto de MFA/password/recovery | Ahorro adicional de MAU no demostrado sin compartir identidad entre autorizaciones; no se implementa esa reutilización | No elimina el socket requerido por dispositivo | Nuevas tablas de credenciales y recuperación por sesión elevarían complejidad. Se adopta sólo reutilización JWT/sesión dentro del grant vigente |
| C. Firmante externo / Custom OIDC admitido | Ruta oficial, pero agrega una raíz de confianza y custodia de firma con alcance mayor | Puede evitar usuarios GoTrue; costos de proveedor/MAU/hosting requieren cotización y prueba | Continúa necesitando sockets y emisión autorizada | Cambio de arquitectura/configuración que exige decisión; no hay un reemplazo seguro sin configuración en el alcance actual |
| D. RPC incremental como respaldo | Credenciales Lanzo actuales y cursor autoritativo | A 30s: 120 consultas/receptor/hora; no son Edge si van directamente a RPC | Hasta 30s + red de latencia; no cumple por sí sola recepción Realtime | Adecuada para reconciliar huecos al volver. No se instala polling ni se sustituye Realtime silenciosamente |

Fuentes: [autorización y caché Realtime](https://supabase.com/docs/guides/realtime/authorization),
[Custom OIDC](https://supabase.com/docs/guides/auth/third-party/custom-oidc),
[sesiones Auth](https://supabase.com/docs/guides/auth/sessions).
La alternativa A conserva el modelo ya demostrado y elimina el rejoin por cada
renovación. La futura bandeja debe tratar las señales como invalidaciones y
consultar su RPC Lanzo, no usar el JWT receptor como credencial administrativa.

## 3. Identidad y autorización

| Concepto | Alcance |
|---|---|
| Identidad Auth | Usuario técnico por dispositivo + sesión Lanzo; no por pestaña ni renovación |
| Sesión Auth | session_id firmado por Auth, vinculado exactamente a un grant/runtime |
| Sesión Lanzo | Autoridad canónica independiente; reemplazo Admin crea otra autorización |
| Actor | Admin o Staff con permiso Ecommerce del tenant; no se infiere del rol del dispositivo |
| Runtime | Captura local de actor/sesión/dispositivo/tenant/generaciones; no prueba criptográfica de identidad |
| Grant | Concesión viva, lease y binding; jamás se revive el runtime tombstone |
| Topic | Derivado de grant, privado, no es un secreto ni autoridad por sí solo |

Se conserva la identidad sólo dentro de la misma sesión Lanzo y dispositivo.
Una pausa con grant vencido solicita un runtime/grant nuevos, con validación
Lanzo completa, mismo usuario técnico si sigue autorizado y sesión Auth nueva.
El JWT anterior no adquiere el nuevo binding; el nuevo tampoco abre el topic viejo.
Entre sesiones consecutivas del mismo Admin se mantienen usuarios independientes.
Compartirlos reduciría MAU, pero permitiría que password/MFA/recovery de una sesión
afectara a otra. No se aumenta ese riesgo para mejorar una cifra económica.

El broker reutiliza el JWT vigente como en 1A.3 y refresca cerca de exp, conservando
session_id. No entrega refresh/password ni usa Auth setSession en el POS. Nuevas
sesiones Auth externas no adquieren grants; Admin/staff y tenants siguen separados.

## 4. Renovación y recuperación

TTL candidatos: 120/300/600/900 segundos, seleccionados exclusivamente en política
SQL QA; el cliente no escoge duración. Se propone **600s**, acotados además por
sesión Lanzo y entitlement. No se promueve automáticamente a comercial.

| TTL | Llamadas en sesión modelada de 4h | Login / refresh Auth | Join estable | Evidencia Hosted |
|---:|---:|---:|---:|---|
| 120s | 160 | 1 / 4 | 1 | TTL emitido, sonda, renovación y barrera |
| 300s | 54 | 1 / 4 | 1 | Lo mismo |
| 600s | 29 | 1 / 4 | 1 | Lo mismo |
| 900s | 21 | 1 / 4 | 1 | Lo mismo |

Modelo discreto: margen de renovación 30s, refresh cuando JWT conserva ≤90s,
JWT nativo 3600s. La frontera JWT introduce llamadas adicionales: dividir horas
sólo por TTL daría una estimación demasiado favorable. 900s ahorra ocho llamadas
por turno respecto de 600s, pero extiende cinco minutos la concesión residual.
600s es la candidata conservadora entre ambas, pendiente de aceptación del riesgo.

Los cuatro ensayos Hosted disparan el callback real después de 11s para salir del
caché SQL: comprueban continuidad del transporte y recepción real, **no** una
prueba de estabilidad de 5/10/15 minutos completos. La simulación controla reloj
y fronteras JWT; tampoco es un benchmark. Se esperó separadamente el vencimiento
natural de un grant de 120s, con JWT aún válido, y se recuperó con topic nuevo.
El vencimiento JWT de 3600s de 1A.3 es evidencia histórica: no se afirma haber
repetido esa espera en 1A.4.

El receptor conserva socket/topic durante renew, llama setAuth sólo si cambia
JWT, y conserva un transporte sano ante fallo temporal del broker hasta su
deadline. Reintentos son acotados. Una respuesta sin extensión de expiry no
genera una ráfaga de renovaciones por segundo al acercarse el fin de sesión.
403 queda bloqueado para esa captura; 410 distingue expiración y permite una
sola transición automática a runtime nuevo. Un segundo vencimiento sin join
espera otro evento de ciclo de vida. Se abortan solicitudes, descartan callbacks
tardíos y destruyen transportes anteriores al cambiar actor/tenant/dispositivo.
Un CHANNEL_ERROR del SDK también puede proceder de una pérdida de WebSocket:
sólo un rechazo explícito de autorización queda latched; errores sin clasificación
vuelven al broker con reintentos acotados. La prueba conserva el rechazo terminal
Unauthorized y agrega recuperación de un error de transporte sin mensaje.

Al join inicial, rejoin o topic nuevo, el callback `onReconcileRequired` requiere
una futura consulta incremental con autoridad actual. No recupera pedidos ni
genera avisos en esta etapa. La reconciliación comercial permanece por implementar
en el alcance posterior expresamente autorizado.

## 5. Pestañas, PWA y Runtime

Web Locks coordina un solo dueño para el mismo contexto capturado y origen/perfil.
Su nombre es SHA-256 de IDs de contexto, sin JWT, credenciales ni mensajes entre
pestañas. Cierre/crash libera el lock según el navegador; hidden/offline/pagehide/
freeze libera transporte y liderazgo, y online/visible/pageshow/resume revalida.
Un cambio de actor/tenant nunca recibe tokens del dueño anterior.

No hay garantía entre perfiles/orígenes, navegadores sin Web Locks o capturas con
generaciones distintas. En esos casos se mantiene la exclusión dentro de JS y
el límite QA de cuatro grants activos. No se roba un lock de una pestaña congelada
sin comprobar cierre: la detección/failover físico de PWA requiere QA real.
Los costos publican también el caso de dos receptores sin coordinación.
No se agrega otro bus de sincronización ni se bloquea Ventas, Caja o modo offline.
El hook continúa enabled=false y sin montaje App/Layout/global.

## 6. Autoservicio Auth: contención y límite

Se observó nuevamente password PUT=200 y login externo=200; una sesión sin binding
fue rechazada en Realtime. La siguiente emisión autenticada detectó la sesión
anómala, puso en cuarentena la identidad y excluyó publicaciones. También se
detectó el alta de un factor MFA. Recovery retiró sólo el Auth user inventariado
y permitió emitir otro sub con credenciales Lanzo vigentes.

Política operativa candidata: límites previos a bcrypt por dispositivo; inventario
inmutable; una lease por identidad; cuatro grants activos; cuarentena por sesiones
sin binding/MFA; recuperación específica por dueño; collector y retención
incrementales; métricas agregadas de sesiones sin binding, inventario, leases,
retiradas, fallos, backlog, latencia y presión de cuota. Secretos no entran en logs.
Los caps globales de diez identidades y 120 operaciones/grant siguen siendo QA,
no configuración suficiente para vender a cientos de negocios.

**P1 residual:** el poseedor del bearer puede actuar directamente contra Auth
antes de la comprobación, y puede repartir tráfico entre IPs. El broker no limita
ese tráfico. La documentación publica 150 solicitudes `/token` por 5min/IP,
con ráfagas, pero ese default no certifica la configuración del proyecto ni una
cota por identidad: nominalmente serían 300 solicitudes en 10min/IP, más ráfaga;
no se provocó esa carga. Con múltiples IPs no hay una cota finita demostrada.
La ventana termina por cuarentena/retirada o autoridad Lanzo expirada, no por un
rate limit inventado del broker. Sin monitor programado, el retiro no tiene SLA.

No se instalaron hooks ni cambios Auth globales. Falta la decisión explícita de
aceptar este riesgo de recursos con operación monitorizada y presupuesto, o
elegir otro modelo de firma. Por ello **no READY con seguridad P1 abierta**.
[Límites oficiales Auth](https://supabase.com/docs/guides/auth/rate-limits).

## 7. B-02 / decisión ACL

Se descarta ruta B como certificación suficiente: PUBLIC conserva EXECUTE sobre
las seis SECURITY DEFINER y USAGE en public. RLS de Realtime no revoca esa
autoridad; los 403 de gateway tampoco prueban aislamiento de toda superficie
accesible. No se observó escalada comercial, pero no se rebaja el estándar.

**Ruta A elegida y preparada, no aplicada persistentemente.** Rehearsal nuevo
BEGIN/ROLLBACK: **24/24 PASS**: seis rechazos SQLSTATE42501 del receptor y seis
operaciones positivas por cada rol anon/authenticated/service_role: listar,
crear/editar Staff, estado Caja, adopción legacy y cierre auditado de Caja.
Importes cero y filas sintéticas; todos los cambios financieros se revirtieron.
Cuerpos intactos, grants explícitos legítimos conservados y matriz por rol/firma.

La corrección y su rollback son exactamente los seis REVOKE/GRANT de la propuesta
R2 separada. Persiste el delta directo de infraestructura heredado de PUBLIC;
no se añaden grants preventivos ni se certifican clientes externos desconocidos.
El propietario debe aprobar específicamente ese cambio compartido y confirmar
consumidores directos externos. La QA operativa sintética pendiente en 1A.3 ya
está ejecutada; no se propone repetir simulaciones idénticas como sustituto.

## 8. Barrera, collector y retención

El publicador mantiene el lock de grant hasta encolar realtime.send y revalida
autoridad Lanzo/sesión Auth/expiry. Revoke y cuarentena usan las mismas filas.
Carreras Hosted independientes: publish primero encola y revoke espera; revoke
primero hace que publish espere y termine EXCLUDED. Un retry después de la barrera
también es EXCLUDED. No se revive un grant revocado. Una entrega ya encolada puede
llegar tarde; no se promete expulsión inmediata del socket cacheado.

El collector nuevo pagina por UUID sobre inventario propio; no elimina usuarios
mientras recorre páginas Auth por offset. Detecta orphans etiquetados con binding
inmutable y gracia de tres minutos; DELETE verifica de nuevo ID, rol y app_metadata.
Un 404 es éxito idempotente. Cada ack conserva progreso/intentos/backoff en SQL;
fallos vuelven a revisarse desde cursor null, y un cursor devuelto permite continuar
un sweep con presupuesto. Por defecto 25 × 4 filas, máximo configurable 100 × 10.
Además deja de iniciar trabajo tras 45s (máximo configurable 60s); el IO ya iniciado
conserva sus timeouts. No avanza cursor/ack de una identidad interrumpida por presupuesto.

Se corrigió un cruce de ciclo de vida: **grants vencidos no retiran por sí solos
una identidad con sesión Lanzo vigente**. Eso permite regresar después de una
pausa aun si el collector ya corrió. Se borran vaults vencidos en lotes, conservando
binding y tombstones; la identidad completa se retira al perder autoridad Lanzo,
entrar en cuarentena o ser un orphan comprobado. Recovery reinicia el progreso
de cleanup sólo después de verificar la ausencia del usuario anterior.

Retención: al menos 30 días después de completar Auth cleanup, ninguna sesión
Lanzo viva, Auth user, grant sin revocar, lease o vault. Se borran receipts antes
de grants e identidad; no se usa CASCADE. Ensayo SQL rollback-only: 1.001 identidades
en 11 lotes, ack durable y retención acotada/respeto de filas recientes.
No se ha esperado 30 días reales ni se borraron identidades comerciales.

No se instala cron. Un eventual worker cada cinco minutos sumaría 8.640 llamadas
Edge/mes y requiere revisar cuota/autoridad/SLA. Almacenamiento y sesiones Auth
residuales siguen vinculados al tiempo de vida real de sesiones Lanzo; borrar
usuarios no devuelve el MAU ya consumido.

## 9. Certificación económica

Plan real Supabase **Free**, distinto de los planes Lanzo. Máximos observados:
Local/FREE 1 dispositivo; Básico Legacy 2; Nube/PRO 5. Modelo: máximos ocupados,
2 sesiones Lanzo/día/dispositivo, 8h/día total divididas en turnos de 4h, 30 días,
2 pestañas baseline y 1 dueño optimizado, 50 pedidos/día/negocio. Las señales de
pedidos son sólo una proyección: no se emitió order_created.

| Negocios | FREE Edge antes / después | FREE sockets antes / después | PRO Edge antes / después | PRO sockets antes / después |
|---:|---:|---:|---:|---:|
| 10 | 193.200 / 17.400 | 20 / 10 | 966.000 / 87.000 | 100 / 50 |
| 25 | 483.000 / 43.500 | 50 / 25 | 2.415.000 / 217.500 | 250 / 125 |
| 50 | 966.000 / 87.000 | 100 / 50 | 4.830.000 / 435.000 | 500 / 250 |
| 100 | 1.932.000 / 174.000 | 200 / 100 | 9.660.000 / 870.000 | 1.000 / 500 |
| 500 | 9.660.000 / 870.000 | 1.000 / 500 | 48.300.000 / 4.350.000 | 5.000 / 2.500 |
| 1000 | 19.320.000 / 1.740.000 | 2.000 / 1.000 | 96.600.000 / 8.700.000 | 10.000 / 5.000 |

Antes usa la aritmética publicada 1A.3 (322 llamadas/día/receptor), normalizada a
los máximos reales. El modelo discreto actual, también publicado, calcula 320;
esa diferencia pequeña de baseline se muestra, no se oculta. El ahorro presentado
es aproximadamente **91%**, combinando TTL600 y eliminación de la segunda conexión.
Sin coordinación, duplicar las cifras optimizadas de Edge/sockets/joins/mensajes,
no MAU. TTL por sí solo reduce aproximadamente 82% de llamadas en el turno modelado.

Por dispositivo/mes, optimizado: 1.740 Edge, 60 logins Auth, 240 refresh Auth,
60 identidades/MAU técnicos modelados y 60 joins; mensajes de señales son
**3.000 por dispositivo/mes** (50 × 30 × emisión+entrega), antes de retries.
MAU no se reduce mediante tombstone cleanup ni liderazgo. FREE 1000 modela 60.000
MAU técnicos; PRO 1000, 300.000. Uso de usuarios y módulos existentes se suma.

Dos RPC broker por llamada no cacheada; no equivalen a dos sentencias físicas.
La autorización RLS cae de cada rejoin a join/JWT nuevo. El publicador mantiene
una comprobación y envío por destinatario/pedido; no se elimina para abaratar.
Vault histórico: ~2.345 bytes/grant vivo, sin índices/receipts/auditoría. El snapshot
Hosted nuevo y el modelo versionado separan observaciones y supuestos.

Free publica 500.000 Edge/mes, 2M mensajes/mes, 200 conexiones, 50.000 MAU,
100 mensajes/s y 100 joins/s. **No son cuotas residuales disponibles**. No se obtuvo
una factura/medición mensual completa de AI/otros módulos ni límites Auth configurados.
Los logs agregados de 24h no sustituyen billing. No se certificaría carga CPU/SQL
con cuatro probes: faltan percentiles sostenidos/picos reales.

Ejemplo de stress: añadir 10% retries y 8.640 llamadas de collector; 100 FREE
serían ~200.040 Edge y 100 sockets antes de otros módulos, o ~391.440 Edge y 200
sockets sin coordinación. A 50 PRO, 250 sockets ya exceden Free incluso con líder.
Una reconexión simultánea de 1.000 FREE demanda hasta 1.000 joins, no 100/s;
jitter local no garantiza una cota global. Reservar margen y escalonar despliegues.

**HOLD_SCALE para 500/1000 y para los escenarios PRO que exceden el plan actual.**
No se propone upgrade como única solución: primero se implementó el ahorro.
El mínimo de un socket/dispositivo exigido por recepción rápida sigue imponiendo
una cota de infraestructura que no desaparece por alargar TTL. Un piloto pequeño
podría presupuestarse sólo después de resolver seguridad/ACL/QA y medir saldo real.
[Modelo reproducible](evidence/ecom-realtime-auth-1a4/cost-model.json).

Fuentes oficiales: [Edge](https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations),
[Realtime límites](https://supabase.com/docs/guides/realtime/limits),
[contabilidad de mensajes](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages),
[precios/MAU](https://supabase.com/pricing). No se contrató otro plan.

## 10. QA, SHA final y producción

Resultados focales locales: **37/37 Node** y **57/57 React/Actor/bridge/storage**,
incluidos 17 casos del adaptador, Strict Mode, cambios Admin/staff/tenant,
sesión reemplazada, reconexión, suspensión, expiración, denegación y liderazgo.
Lint focal PASS. Los FAIL iniciales de un doble HTTP del collector se corrigieron
sin cambiar expectativas funcionales; no se ocultó una regresión histórica.
La ausencia de tormenta al expirar sesión tiene una prueba específica nueva.

React Doctor final: **91/100**, cero errores y tres advertencias en el broker
servidor: acceso al segmento JWT sin guard local (el caller captura el error) y
dos awaits secuenciales en el collector. Se conservan los awaits para respetar
orden, presupuesto y no generar ráfagas Auth; no se suprimen reglas. El escaneo
anterior dio 100/100 y no sustituye este resultado final. Node completo Windows:
**186 PASS / 12 FAIL**, main **149 PASS / los mismos 12 FAIL**, comparados por
archivo, posición y nombre: cero fallos nuevos. Lint completo: **159 errores /
177 warnings** en ambos árboles, cero diagnósticos nuevos; FAIL bruto preservado.
Deno check PASS. [Evidencia](evidence/ecom-realtime-auth-1a4/manifest.json).

Hosted nuevo: cuatro TTL con cinco checks cada uno; expiración/recuperación de
grant, aislamiento de sesión/tenant/Staff, autoservicio detectado y recovery,
dos carreras de publicación/revocación, collector y sesiones consecutivas.
Los JSON describen cada observación y sus límites. No se cuentan mocks como
Auth/Realtime real ni se presenta el servidor local como Edge desplegado.

Los checks definitivos POS/PWA/postbuild, Store, Deno, Node completo, suites
amplias, PR127 y Actor Scoped Storage deben leerse **por SHA final** en la
descripción del PR. Allí se publican URLs, resultados brutos y comparación con
main. Un workflow verde con pasos observacionales fallidos no es PASS global.
No se cambian tests/baselines para ocultar fallos. Los resultados del SHA inicial
siguen siendo históricos, no certificación del HEAD nuevo.

QA POS/PWA física y perfiles/dispositivos reales: **NOT RUN**. No hay montaje
comercial global; por tanto no se certifica interacción física con Ventas/Caja
o recuperación de bandeja comercial. No se modifican catálogo, gramos, checkout,
inventario ni procesos financieros. La única operación financiera nueva fue el
ensayo sintético ACL, íntegramente revertido.

Las migraciones QA exactas, versiones remotas, postflight, rollback y manifiesto
se incluyen en la evidencia final/PR. Todos los SQL comerciales siguen fuera de
migrations. No se cambiaron JWT keys, Auth global, secretos Edge originales,
planes o las seis ACL compartidas. El broker sólo se ejecutó como servidor QA
local contra Auth/Realtime Hosted; no hubo endpoint nuevo ni cron productivo.

| Versión remota 1A.4 | Operación |
|---|---|
| 20261022181812 | Instalación temporal explícita de foundation/bridge/hardening/lifecycle |
| 20261022182500 | Recovery del progreso y publicador QA de carreras |
| 20261022183458 | Collector conserva sesión Lanzo viva y poda vaults vencidos |
| 20261022184218 | Cleanup selectivo y retirada de objetos propios |

Ledger **320→324**; conserva las ocho entradas QA anteriores y las divergencias
históricas de Restaurante/legal. Antes del cleanup había cuatro identidades,
cuatro usuarios y nueve sesiones Auth: se retiraron los cuatro usuarios con sus
sesiones; segundo sweep no borró ninguno. Se adelantó únicamente created_at del
inventario sintético para ejercer la gracia del collector tras terminar su IO;
no se presenta eso como espera natural. La prueba de expiración del grant sí
esperó al reloj real. Postflight: cero usuarios/sesiones/fixtures/esquema/rol/RPC
QA, las tres políticas originales y nueve cuerpos/ACL originales iguales.
Las dos Edge originales conservan versiones, hashes y verify_jwt. Advisors:
34 INFO, 7 WARN search_path y 181/182 WARN SD, iguales al preflight; remediación
general fuera de alcance ([guía oficial](https://supabase.com/docs/guides/database/database-linter)).

## 11. Decisiones necesarias para cerrar Fase 1A

1. Aprobar o rechazar expresamente el riesgo residual de consumo Auth directo y
   su política operativa; si se exige una cota dura por identidad, elegir otro
   modelo de firma. Los cambios de esta fase no demuestran esa cota.
2. Aprobar específicamente las seis ACL exactas y confirmar los consumidores
   directos externos de infraestructura; QA sintética de Caja ya ejecutada.
3. Fijar población/presupuesto real con reserva de cuotas de otros módulos;
   infraestructura Free no cubre los escenarios amplios aun tras el ahorro.
4. Completar QA física del montaje exclusivamente QA, Web Locks/PWA y recuperación
   con RPC autoritativa antes de cualquier nueva señal comercial.

No se solicita automáticamente otra fase de hardening. Se entrega código concreto,
evidencia, propuesta de ACL y límites verificables para estas decisiones.
Mantener OPEN / Draft / HOLD y detener para revisión. FREE order_created y Centro
de Notificaciones cloud continúan desactivados.
