# LANZO POS — FASE 3.2A.7 — F-02 ONLY

Fecha: 22 de octubre de 2026, America/Mexico_City.
Estado de este checkpoint: **READY_FOR_OWNER_QA**. QA físico PENDING; merge NOT PERFORMED.

## 1. Resultado y baseline

F-02 reconstruido sobre `main` `9ca65fc07804f40c2add5e59bee0e6edca940b8f`, que integra M-01 mediante PR #367. No se recuperó ni usó el commit local perdido 11888796. Se verificaron GitHub, los PR abiertos y los worktrees. Clon nuevo y worktrees independientes; un checkout anterior tenía cambios ajenos, y los worktrees históricos de M-01 apuntaban a un gitdir desaparecido. No se alteraron. No hay AGENTS.md aplicable en el árbol.

Rama: `fix/admin-pwa-resume-expiry-f02-r2`. Main inicial/final reconsultado: el mismo SHA anterior. Los checkpoints remotos y su correspondencia de árboles están en el informe de evidencia. Git push carecía de credenciales; los objetos/commits se preservan mediante el conector GitHub, sin force push. A está referenciado por `audit/admin-resume-f02-r2-checkpoints`; B/C son predecesores recuperables por SHA y quedan alcanzables desde la publicación final.

Antecedentes consultados: auditoría PWA 3, implementación 3.2, resolución B-01, F02 R1, Late Context Hardening, V1 Stability Audit/Evidence y M01 Only/Evidence. Los informes PWA y hardening se leyeron desde sus copias previas; los de estabilidad desde sus archivos actuales identificados en Library. M-01 y sus pruebas se leyeron en el main actual, junto con el PR #367 mergeado. Los resultados históricos no certifican esta candidata.

## 2. Reproducción nueva y separación de estados

El fixture usa controller singleton, bridge, storage actor/tenant, evaluador Admin offline, health action y hook React reales. Readiness/DB, credenciales/evidencia de entrada y dispositivo son sintéticos; el evaluador de evidencia es real. No se conecta al backend ni se usa el perfil del propietario.

Admin A/session-a/device-a/tenant `t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`, con sesión que vence START+1000ms. React se monta en GRANTED; el reloj sintético pasa al vencimiento; se llama health sin operación previa. Main nuevo: **4 PASS / 6 FAIL** en integración F02 + EXP14 existente. Los seis fallos corresponden a snapshot GRANTED ante salidas por falta de timestamp, inicialización, app no ready, tenant no ready, inactividad corta y realtime. EXP14 ya pasa por M-01. No es el baseline anterior a #367.

Antes de consultar getState, React conserva el último snapshot; ello no crea autoridad nueva. La consulta directa de controller sí detecta expiración, publica LOCKED y retira los handles. El durable refleja la invalidación del subscriber del bridge. El test evita getState entre avance de tiempo y health para no ocultar el fallo. Chromium confirma el mismo defecto para focus/pageshow/online/resume/visibilitychange: cinco FAIL de main, cinco PASS de candidata. El snapshot React puede conservarse durante el turno síncrono del evento; se actualiza al commit React, sin esperar el debounce/remoto. El durable LOCKED inmediato acredita la publicación síncrona.

## 3. Diff de producto y contrato de autoridad

Sólo tres archivos de producto:

1. `src/store/slices/license/licenseMaintenanceActions.js`: getState al inicio, antes de leer el store y de cualquier salida temprana. Reutiliza semántica vigente de vencimiento.
2. `src/pwa/adminResumeChecks.js`: extracción focal del agrupador existente, evaluación local síncrona en cada señal visible, debounce remoto de 250ms, single-flight por montaje, fencing del callback diferido por snapshot canónico, cancelación/cleanup y captura de errores del health check.
3. `src/App.jsx`: el efecto instala el helper una vez y obtiene la acción del store vigente al ejecutar.

No cambian controller, bridge, actorScopedStorage, useActorRuntimeSnapshot, evaluador, Staff, tenant, handoff, esquemas Dexie, SW, licencias/dispositivos, RPC, SQL, RLS/ACL ni módulos financieros. No hay nuevos grants, refresh de evidencia, extensión de 168h o renovación por evento. M-01 se preserva byte a byte. F-01/M-03/Authority v2 no incluidos.

`getState()` es stateful: en Admin vencido publica LOCKED, incrementa generación y dispara la invalidación de storage. La reentrada del subscriber y las ráfagas se prueban: una publicación por vencimiento; la sesión válida conserva identidad/generación/sesión/device/deadline/durable/handles. El hook mantiene el único estado de UI suscrito al controller y no se modifica.

El snapshot del helper sólo decide si debe descartarse trabajo de salud diferido; no es una autoridad de UI/escritura. Se comparan generación, status, actor, sesión, device y binding tenant completo. Si cambia el contexto antes de disparar el timer, se descarta ese trabajo. Durante un remoto pendiente cada evento todavía evalúa localmente; no inicia otra llamada desde este montaje. La protección de resultados remotos y los single-flight globales siguen perteneciendo a los servicios existentes; el helper no puede cancelar ni certificar un RPC ya enviado por otro componente.

## 4. Ciclo de vida auditado y carreras

| Señal | Responsable / acción | Cleanup y límites |
| --- | --- | --- |
| visibilitychange visible | helper: evaluación síncrona y agenda health | Oculto cancela timer y marca inactividad best effort |
| focus / pageshow / online | helper: evaluación síncrona, coalescencia | `online` conserva prioridad dentro de una ráfaga; no prueba conectividad |
| document resume | helper: misma evaluación | Escucha opcional compatible con browsers que no emitan evento |
| pagehide | helper: timestamp y cancelación | Sin RPC, cierre de caja ni commit financiero |
| freeze / suspensión OS | navegador detiene ejecución | CDP freeze/thaw probado; no se presume cierre ni QA física |
| descarte / restauración fría | bootstrap vigente | Sin segundo bootstrap desde helper; página descartada necesita arranque normal |
| actualización SW | coordinador/monitor existentes | Helper no activa worker ni reload; los listeners de actualización tienen otra finalidad y cuotas propias |

Readiness y `_isInitializing` bloquean sólo trabajo remoto; el controller puede evaluar la evidencia ya conocida incluso antes. No se infiere tenant a partir del reason. Un callback agenda el contexto actual y se descarta si cambia antes del timer. El callback de App consulta el store vigente. Una respuesta tardía conserva los tickets/handles/guardas de actor/tenant existentes; se ejecutan sus regresiones. No se resuelven callbacks/finally arbitrarios ni LC13 mediante este filtro.

El helper limpia todos sus listeners/timer; cancela al ocultar/pagehide y vuelve a comprobar visibilidad al disparar. StrictMode deja una sola instalación efectiva. No hay polling, lock de navegador, segundo bootstrap, recarga, escritura comercial ni protocolo de almacenamiento nuevo. El desmontaje no puede cancelar un remoto que ya comenzó; no instala callbacks de UI posteriores y contiene el rechazo de la promesa.

## 5. EXP-F02-01…16

Convenciones: START=`2026-10-01T00:00:00Z`; A=`admin-a`, tenant T=`t_aaaa…`, sesión a, dispositivo a. G es la generación capturada del grant real, no un reloj global. LOCKED retira identidad/sesión/tenant/permisos del snapshot y aumenta a G+1. El JSON Chromium contiene snapshots completos antes/después, durable, binding y handles; el JSON Vitest conserva todas las aserciones y su resultado. «PASS» es la frontera indicada, no una venta E2E.

| ID | Estado inicial / plazo / evento | Estado final, generación, UI y handle | Resultado y frontera |
| --- | --- | --- | --- |
| 01 | A/T/a/device-a GRANTED G, START+1s, focus offline antes de vencer | Grant/durable iguales, G, React GRANTED, handle válido | PASS health + hook reales |
| 02 | Mismo grant; exactamente START+1s, health offline sin timestamp | LOCKED G+1, React LOCKED, durable locked, handle rechaza | PASS seis early-return variantes |
| 03 | A/T/a/device-a; oculto hasta vencer, visible/focus/pageshow/online/resume | Publicación local inmediata; React LOCKED tras render; cero remoto | PASS jsdom y Chromium cinco eventos |
| 04 | Deadline D: D-1, D y D+1 | GRANTED G antes; LOCKED G+1 exacto/después; sin bucle | PASS sesión/ventana/licencia |
| 05 | Evidencia START, sesión/licencia 30d, límite START+168h | Antes válido; al límite LOCKED, handle rechaza | PASS evaluador + bridge + lifecycle; no extensión |
| 06 | Sesión START+1s, ventana 168h | Prevalece +1s; LOCKED G+1, UI bloquea | PASS integración |
| 07 | localExpiry START+500ms, sesión 30d | Prevalece +500ms; LOCKED G+1 | PASS integración; comercial/gracia además en suite de política |
| 08 | Admin vigente, retroceso wall y avance monotónico | LOCKED al elapsed efectivo; restauración con rollback rechaza | PASS controller/política existentes ejecutados; no reloj físico |
| 09 | Evidencia UTC equivalente con offset distinto | Mismo epoch/plazo, elegibilidad conservada | PASS política existente ejecutada; no cambio de zona OS |
| 10 | Familia Staff / intento offline | Política DENIED; no grant Admin ni permisos nuevos | PASS política/Staff suites; no login Staff live |
| 11 | A/T bloqueado por revocación conocida, focus | Snapshot LOCKED igual; cero nueva autorización | PASS integración; denial/released/device en suites |
| 12 | A vigente; navigator.onLine=true, transporte rechaza | Grant/deadline intactos, error contenido por helper; no falsa revocación | PASS promesa sintética + suites verificación |
| 13 | A vence; ráfaga y observer reentrante | Una publicación, G+1, UI/handle bloqueados | PASS integración; no grant adicional |
| 14 | A vence por resume; nuevo B/session-b legítimo; hint histórico | B GRANTED, G_B/deadline/durable/binding iguales; handles A rechazan, B válidos | PASS F02+M01, EXP14 existente, parejas Chromium con/sin BC |
| 15 | Timer de A/T; transición explícita a B/T_B/device-b antes de ejecutarlo | Grant B intacto, sin health de A; viejo trabajo descartado | PASS helper + controller; grant B sintético directo, no login B E2E |
| 16 | Handle A, callback pendiente; A vence antes de resolver | Handle rechaza; contador de commit cero | PASS frontera protegida sintética; regresiones financieras separadas |

El reloj monotónico existente es por documento y depende del navegador; no aporta tiempo confiable persistente tras cierre ni garantiza medir sueño en todos los OS si también retrocede wall. Los tests no certifican hardware/OS. La expiración responde al deadline efectivo ya concedido, sin inventar evidencia nueva.

## 6. RESUME-01…10

| ID | Prueba ejecutada / estado | Límite |
| --- | --- | --- |
| 01 | PASS: cinco señales, evaluación local por señal, un health a 250ms | Coalescencia de este montaje; servicios conservan sus guards |
| 02 | PASS: cleanup previo al timer, señales posteriores ignoradas | Un remoto ya iniciado no se cancela por desmontaje |
| 03 | PASS: hidden al timer sin evento y pagehide cancelan | No se obliga a ejecutar en background |
| 04 | PASS: montaje/desmontaje StrictMode, un health | No significa una instancia exclusiva entre tabs |
| 05 | PASS: throw/rechazo, reintento manual por evento posterior | Warning acotado sin payload ni secretos |
| 06 | PASS: online/resume mientras pendiente evalúan local y no duplican remoto | No coordina llamadas iniciadas fuera del helper |
| 07 | PASS: handle vencido impide efecto diferido; suites bridge/login descartan respuestas actor/tenant antiguas | RPC live y cada intercalación arbitraria no certificados |
| 08 | PASS: avance de 4h con promesa de transporte pendiente, resume bloquea inmediatamente, rechazo no revierte LOCKED | Transporte/horas sintéticos; físico PENDING |
| 09 | PASS: bridge AUTHENTICATING pendiente, focus/resume no duplican restore ni bootstrap | Readiness/DB sintéticos; regresiones bootstrap separadas |
| 10 | PASS: coordinador SW real con registration sintético waiting y operación Actor real pendiente; resume conserva pending, sin postMessage/reload | No instalación SW física ni despliegue durante cobro live |

## 7. M-01, convivencia y LC13

EXP14 existente y variante F02 pasan: A expira y queda inválido; la sesión B nueva mantiene su binding y generación pese al aviso histórico. Una sustitución durable actual sigue bloqueando la sesión anterior. Se conservaron todos los módulos M-01 sin cambios.

Chromium lifecycle: 20 observaciones, 15 PASS y 5 FAIL esperados de la reproducción base; cero HARNESS_ERROR. Parejas main/main, main/candidata, candidata/main y candidata/candidata con/sin BC preservan B frente a hint antiguo y rechazan B ante sustitución actual. Incluye dispositivo sintético distinto, storage inaccesible y CDP freeze válido/vencido. El runner de compatibilidad de storage añade 34 observaciones: 12 PASS acotados, 21 FAIL LC13 y 1 PASS_LIMITATION_DETECTED; cero HARNESS_ERROR. Se usa BrowserContext compartido por pareja, mismo origen, documentos reales; proveedores de identidad/DB sintéticos.

**LC13 sigue abierto**: invalidación secuencial/concurrente, cleanup pending y finally tardío pueden sobrescribir un durable posterior; probado en main y candidata. No hay CAS, exclusividad universal mixed-version ni fencing financiero integral. La generación es local, no un reloj compartido. Un documento congelado no se considera cerrado. F02 acelera el momento de evaluar un vencimiento que ya tenía efectos de invalidación; no cambia ese contrato ni lo presenta como resuelto. Estos FAIL previos no se reclasifican como PASS ni se modifica M-01/M-03 para ocultarlos.

## 8. Finanzas, tenant, recuperación, PWA y builds

Finanzas/handoff: 188/188 PASS, con repositorios y fake-IDB/doubles existentes: ventas, caja local, crédito, apartados, inventario, outbox actor/tenant, ledger, receipts, recovery y proyección. El primer comando de selección pasó 161 tests pero omitía por filtros cuatro rutas mal indicadas; se conservó, se corrigieron las rutas y se ejecutó la selección completa de 188. No se suman como únicos.

FIN-01/02/04…10 conservan contratos/diff y regresiones existentes: no crear venta/cobro/retry/cierre desde health, no borrar outbox, no transferir originActor, no perder receipts ni revivir sesión revocada; no cambia exclusividad de dispositivos. FIN-03 se prueba además con el handle real vencido y cero efecto protegido posterior. No es E2E comercial ni nueva garantía global de fencing.

Dexie Recovery: 127/127 PASS en archivos únicos del workflow, sin cambios de schema. Arquitectura/precache/packaging: 70/70 PASS tras finalizar builds. Admin+postbuild, Store y Store Vercel: PASS tanto base como candidata; auditoría Admin verifica 24 startup assets, 0 core Local route assets. PWA/worker/upgrade bridge se incluyen en auth-license-pwa y arquitectura, sin modificar SW. ESLint focal y diff-check PASS; avisos externos npm proxy/baseline-browser-mapping y avisos Vite preexistentes conservados. No se cambian dependencias/lockfile, thresholds, exclusiones o comparadores.

Global inicial: base 5637 PASS / 75 FAIL / 52 SKIP / 5764 total; candidata 5675 PASS / 75 FAIL / 52 SKIP / 5802 total. Se repitió candidata al añadir tres tests de interleavings: final 5678 PASS / 75 FAIL / 52 SKIP / 5805 total; PR127 final OK con 91 compartidas y cero nuevas/exclusivas/sin resolver. Auth/tenant/license/PWA final 614/614; F02/helper 41/41. El diferencial inicial oficial muestra 91 identidades compartidas, 0 exclusivas/nuevas/sin resolver. Los fallos globales no son verde; identities incluyen file failures. Targets=[]: cero repeticiones focales, no veinte PASS inventados.

## 9. Integración con PR #338 / #352

#338 OPEN/Draft, `fef7205f76b173025f503e60d0968f446f741e78`, base main. #352 OPEN/Draft, `d758f69b2119f1bc346eb0ac86ba0a74c0265668`, apilado sobre #338. Ninguno modificado, rebasado ni mergeado.

Merge-tree contra candidata de producto: #338 conflicto en controller; #352 conflictos en 16 archivos, incluidos App, controller, main, auth UI, SW, workflows y Vite. Se guardan salidas/diffs de sólo lectura. Las ramas antiguas omiten expiración Admin, tokens de autenticación y otras guardas modernas; al integrarlas conservar M-01, deadline/168h, online-only Staff, tickets de actor/tenant, handoff y la separación de reload financiero. Conservar además la revalidación F02 y un único registro de listeners al reconciliar App. No resolver conflictos aceptando archivos antiguos enteros. No hay certificación conjunta financiera/restaurante/SQL en esta fase.

## 10. Remoto y Preview

Verificado sobre el SHA candidato exacto D: los cuatro workflows terminaron SUCCESS. Los gates aplicables son Actor Runtime, Actor Scoped Storage y PR127; Dexie también se dispara por src/App.jsx, src/pwa/** y src/store/**; se observó su run para este HEAD. Un workflow omitido/no disparado no se declarará SUCCESS. No se modifican workflows ni triggers para obtener verde.

Proyecto confirmado: lanzo-pos `prj_tE5uWn6kLBYdS1eDFWVxRm449RUr`, team `team_buvft2mAJErTNR8gDhXcZGfS`, repositorio conectado correcto. Sólo Preview, nunca Production. Se acreditarán rama/SHA/READY, HTML, assets, SW y manifest. Si el bundle apunta al Supabase de producción se harán únicamente lecturas estáticas; no login, device registration, licencias ni operaciones reales. Los fixtures de QA no se añaden al entrypoint ni al precache comercial. La auditoría de assets finales debe verificar esa separación.

## 11. QA físico del propietario

Todos **PENDING**. Usar la Preview certificada y un negocio autorizado para ese origen. No cambiar el reloj real, fechas Supabase, dispositivos, IndexedDB ni cajas para forzar expiración. Un origen Preview nuevo tiene almacenamiento/sesión distintos. Las expiraciones efectivas se ensayan en los fixtures aislados.

| Caso | Acción / resultado esperado |
| --- | --- |
| QA-F02-01 | Login Admin normal y navegación sin bloqueo indebido |
| QA-F02-02 | Bloquear Windows y regresar; sesión todavía vigente continúa |
| QA-F02-03 | Minimizar Chrome/Edge unos minutos y regresar |
| QA-F02-04 | Suspender/despertar laptop, sin reload o nuevo bootstrap indebido |
| QA-F02-05 | Reanudar sin internet con evidencia vigente; operación local conserva límites |
| QA-F02-06 | Wi-Fi activo y transporte bloqueado sólo en entorno QA seguro; no falsa revocación |
| QA-F02-07 | Reconectar, continuidad sin validaciones/acciones comerciales repetidas |
| QA-F02-08 | Autoridad válida no solicita login innecesario |
| QA-F02-09 | Carrito, ventas, caja y pendientes existentes permanecen |
| QA-F02-10 | Móvil vertical/horizontal, UI de bloqueo usable |
| QA-F02-11 | Cambiar pestaña y volver sin bloqueos falsos |
| QA-F02-12 | Expiración fixture: interfaz pasa a bloqueo al recibir evento, sin presentar una nueva autorización |

No automatizar estas acciones contra producción ni reducir plazos reales. Las pruebas de Windows/Edge/Android/PWA instalada, BFCache/descarte físico y pérdida de energía no se sustituyen por Chromium headless.

## 12. Criterios, riesgos y decisión

F02 IMPLEMENTED; M01 PRESERVED; M03/F01/Authority v2 NOT INCLUDED. AC01…12 y AC14…19/22…24 se respaldan por los tests/diff señalados dentro de sus fronteras. AC13 requiere distinguir resultados remotos protegidos por servicios de callbacks arbitrarios; los primeros tienen regresiones PASS, los segundos no reciben una garantía nueva. AC20/21 dependen de diferencial final y CI/Preview exactos.

MIGRATIONS=NONE; SUPABASE_CALLS=NONE; SUPABASE_PRODUCTION_WRITES=NONE; USER_IDB_CLEARED=NO; AUTO_CASH_CLOSE=NO; FINANCIAL_LIVE_OPERATIONS=NONE. QA físico PENDING. Merge NOT PERFORMED y NO AUTORIZADO en este encargo.

Riesgos residuales: LC13/legacy, relojes por documento y sueño según OS, notificación/render React tras el evento, inexistencia de evaluación periódica mientras no llega señal ni operación, remoto iniciado fuera del helper, almacenamiento inaccesible y QA física pendiente. No se infiere exclusividad de ausencia de BC ni de una generación nueva. Si CI o Preview no se acreditan, cerrar HOLD_CI/HOLD_PREVIEW, nunca READY_FOR_OWNER_QA por resultados históricos.

## 13. Cierre remoto — observaciones verificadas

PR [#369](https://github.com/fdxruli/Lanzo-POS/pull/369), OPEN/Draft, mergeable al consultar, sin merge. HEAD exacto D `eb9edff47cf16dad17f1bb80c5bca288edab0dbf`, árbol `850daba0d3134ed1c1baf81ccd0238cc08a51926`, idéntico al checkpoint local D `0da89325`. Remotos A/B/C conservan asimismo árboles idénticos a sus homólogos locales. E es cierre documental descendiente de D; no mueve el HEAD del PR ni atribuye a E la CI de D.

- PR127 [39736113437](https://github.com/fdxruli/Lanzo-POS/actions/runs/39736113437): **SUCCESS**. Artefacto 12407945362, digest SHA-256 `f2a763b2bdeb956d00c2eb4dbfed8455b7c40ae9ef80372762347d4604532348` verificado tras descargar. Comparador OK: 99 identidades compartidas, 0 exclusivas/nuevas/sin resolver; targets vacíos. Las 99 remotas y 91 locales proceden de sus entornos respectivos; no se presentan como tests diferentes o cero fallos globales.
- Dexie Recovery [39736113220](https://github.com/fdxruli/Lanzo-POS/actions/runs/39736113220): **SUCCESS**, incluidas ocho selecciones focales, calidad, builds y arquitectura. Checkout por defecto del merge temporal GitHub `51c3ee36064c3c27584844064215870571dd706c`, con padres main y D; árbol **exactamente idéntico** a D, comprobado mediante Git API. La asociación del workflow es al HEAD D; no es un merge del PR realizado por esta tarea.
- Runtime [39736113232](https://github.com/fdxruli/Lanzo-POS/actions/runs/39736113232): **SUCCESS** agregado, incluidas dos suites globales por lado y diferencial; siete targets 50/50 por lado. Publicación idempotente de informe **SKIPPED** por filtro de rama, no se presenta como PASS.
- Scoped Storage [39736113552](https://github.com/fdxruli/Lanzo-POS/actions/runs/39736113552): **SUCCESS** agregado: dos suites globales por lado, 350 repeticiones focales por lado, Lía 50/50 por lado y controles NEG-01/02/03 PASS. Diferencial: 93 observaciones heredadas estables compartidas y cero regresiones nuevas. Su selección POS observacional conserva 11 fallos brutos conocidos (document undefined/historial móvil); el éxito del job no se interpreta como todas sus suites verdes. La atribución queda acreditada por los diferenciales repetidos y PR127; los 11 fallos POS coinciden con sharedFailures remotos.

Preview [lanzo-e9rhyjwha-fdxrulis-projects.vercel.app](https://lanzo-e9rhyjwha-fdxrulis-projects.vercel.app/), deployment `dpl_GBfvM63LcyG1VfSV9rphPkowF1Sf`, proyecto lanzo-pos, target Preview (`target:null` en API), **READY**, rama y SHA D exactos verificados. HTML + diez recursos iniciales + SW + manifest responden HTTP 200 con MIME correcto; no se observan marcadores de fixtures F02 en esos recursos. Auditoría local de producción: 36 archivos JS/HTML/JSON revisados, cero marcadores de fixtures. No se añade una ruta QA al build comercial.

El entry compilado apunta a `https://odlrhijtfyavryeqivaa.supabase.co`, backend de producción. Sólo se hicieron GET estáticos de recursos y lecturas de metadatos: ningún login, registro/liberación de dispositivo, RPC, licencia ni operación financiera. No se ejecutó la aplicación comercial en un perfil real para estas comprobaciones. Los módulos de producto siguen siendo los tres declarados; no se añaden funcionalidades comerciales. CI/Preview de Store no se inventan: se certifican localmente sus dos builds y la Preview administrativa real.

QA-F02-01..12 permanece PENDING; LC13 permanece abierto. Las conclusiones agregadas Runtime/Scoped son SUCCESS y la Preview está acreditada: estado general **READY_FOR_OWNER_QA**.

La reconsulta de PR abiertos también identifica #368, OPEN/Draft/HOLD, rama `codex/ecom-realtime-auth-1a2`, HEAD inicial observado `692237efe717de008cf15ee6231cb7ae32fe1a3f`, actualizado externamente a `3355288f5f59213443283475f3df5a7a7fde14ed` al cierre. Se revisó su inventario actualizado: ecomSignalReceiver, ecomSignalActorAdapter, useEcomSignalQa, tests/workflow de validación, tooling, candidatos SQL, función QA e informes; no solapa los tres archivos de producto F02. No se integró ni modificó esa rama ni se ejecutó su SQL/función. Esto no certifica sus cambios Auth/Realtime ni levanta su HOLD.

Los 11 fallos POS observacionales del job Scoped se atribuyeron por archivo/nombre a sharedFailures del PR127 remoto: **11/11 coinciden**, cero sin atribuir. La evidencia remote-scoped-pos-attribution.json conserva el cruce; no transforma esos fallos brutos en assertions aprobadas.

## 14. Entrega obligatoria — estado del cierre

**LANZO POS — FASE 3.2A.7 — F-02 ONLY**

Estado: READY_FOR_OWNER_QA.

Repositorio: fdxruli/Lanzo-POS.

Main HEAD inicial: 9ca65fc07804f40c2add5e59bee0e6edca940b8f.

Main HEAD final: 9ca65fc07804f40c2add5e59bee0e6edca940b8f.

Rama: fix/admin-pwa-resume-expiry-f02-r2.

PR Draft: #369 OPEN/Draft, sin merge.

HEAD candidata: eb9edff47cf16dad17f1bb80c5bca288edab0dbf.

Checkpoint recuperable: A/B/C/D remotos, D en la rama anterior; E documental identificado en entrega.

**Alcance**

F-02: IMPLEMENTED. M-01: PRESERVED. M-03: NOT INCLUDED. F-01: NOT INCLUDED. Authority v2: NOT INCLUDED.

**Seguridad**

Admin vigente: PASS, grant/deadline/durable/handles intactos.

Admin vencido: PASS, LOCKED local al evento, publicación canónica/React.

Límite 168h: PASS sin ampliar, prevalece deadline más corto.

Staff offline: DENIED por política existente, sin permisos nuevos.

EXP-F02-14: PASS F02+M01, sesión posterior preservada.

Revocación vigente: PASS, sustitución durable actual bloquea anterior.

LC13: OPEN / FAIL PREEXISTING secuencial/concurrente/pending/finally; no fencing global.

Tenant: PASS fronteras probadas; timer obsoleto descartado.

Respuestas tardías: PASS guards existentes y efecto protegido diferido; no garantía nueva sobre callbacks arbitrarios.

Operaciones pendientes: PASS tracked/persistencia de suites; sin transferencia, borrado o reload.

**Validación**

EXP-F02 01..16: PASS en fronteras automatizadas de matriz, con límites físicos/E2E explícitos.

RESUME 01..10: PASS en helper/integraciones declaradas.

Chromium: lifecycle 15 PASS/5 FAIL baseline; compatibilidad 12 PASS/21 FAIL LC13/1 limitación; 0 errores harness.

Auth/tenant: 614/614 PASS grupo auth/tenant/licencia/PWA.

Finanzas: 188/188 PASS, no venta E2E live.

Dexie Recovery: local 127/127 PASS; remoto SUCCESS.

PWA: suites lifecycle/SW/upgrade incluidas; arquitectura/precache/packaging 70/70 PASS.

Build Admin: PASS base/candidata + postbuild.

Build Store: PASS base/candidata.

Build Store Vercel: PASS base/candidata.

PR127 local: OK, 91 compartidas, 0 nuevas/exclusivas/sin resolver.

PR127 remoto: SUCCESS, 99 compartidas, 0 nuevas/exclusivas/sin resolver.

Actor Runtime remoto: SUCCESS; publicación condicional SKIPPED por rama.

Actor Scoped Storage remoto: SUCCESS, diferencial y controles negativos incluidos.

Otros workflows: Dexie SUCCESS; publicación condicional Runtime SKIPPED por filtro de rama, no PASS. No se observaron otros workflows aplicables para D.

Preview URL: https://lanzo-e9rhyjwha-fdxrulis-projects.vercel.app/ — READY, Preview, lanzo-pos.

Preview SHA: eb9edff47cf16dad17f1bb80c5bca288edab0dbf.

**Integración**

PR #338: OPEN/Draft, intacto; drift/conflicto controller.

PR #352: OPEN/Draft, intacto; conflictos auth/App/SW/workflows, integración posterior separada.

También #368 OPEN/Draft/HOLD, intacto y sin solapamiento directo de archivos de producto F02.

Migraciones: NONE. Supabase production writes: NONE. QA físico: PENDING. Merge: NOT PERFORMED.

**Conclusión**

1. ¿La interfaz reconoce vencimiento después de reanudarse? Sí, mediante publicación canónica y suscripción React, sin red.
2. ¿Se conserva Admin vigente? Sí, sin nueva concesión/evidencia ni extensión por la evaluación local.
3. ¿M-01 impide el falso bloqueo de sesiones posteriores? Sí en las fronteras EXP14/mensajería probadas; LC13 sigue separado.
4. ¿Se preservan autorizaciones y offline? Sí, dentro de las políticas y límites existentes.
5. ¿Nuevas regresiones? Ninguna en diferencial local, PR127 remoto y diferenciales repetidos Runtime/Scoped; se conservan los fallos heredados.
6. ¿Lista para QA propietario? Sí: READY_FOR_OWNER_QA. QA físico permanece pendiente y no hay autorización de merge.


## 15. Verificación final y conservación E

Los cuatro workflows agregados del HEAD D están SUCCESS: PR127 39736113437, Dexie 39736113220, Actor Runtime 39736113232 y Actor Scoped Storage 39736113552. En Runtime y Scoped, los siete targets pasan 50/50 en ambos lados; cada lado ejecutó además dos globales con los mismos 75 tests fallidos y 52 omitidos. Sus diferenciales conservan 93 observaciones heredadas estables, cero nuevas, cero semánticas exclusivas y cero incremento significativo de fallos. Scoped añade Lía 50/50 en ambos lados y NEG-01/02/03 PASS. Los grupos y repeticiones no se suman como tests únicos.

E conserva los ZIP originales de base/candidata/diferencial de Runtime y Scoped, el ZIP PR127, evidencia Dexie y metadatos, junto con hashes SHA-256. Su branch `audit/admin-resume-f02-r2-closure` desciende de D y sólo cambia informes/evidencia; no modifica fuentes, tests o configuración. No se atribuye a E una ejecución nueva de CI. El PR y su Preview permanecen en D. Main final reconsultado sigue en 9ca65fc0; #338/#352 conservan sus HEAD y Draft, y #369 sigue OPEN/Draft/mergeable, sin merge.

El SHA E se entrega con estos informes después de crear el commit; no se inserta un hash circular en su propio contenido. Los checkpoints A/B/C/D quedan alcanzables desde E y desde la rama del PR. El propietario debe realizar QA-F02-01..12 y revisar los límites LC13 antes de autorizar cualquier integración posterior.
