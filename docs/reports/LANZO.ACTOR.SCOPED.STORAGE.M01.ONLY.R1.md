# LANZO POS — FASE 3.2A.6 — M-01 ONLY

Fecha: 21 de octubre de 2026, America/Mexico_City.
Estado: **READY_FOR_OWNER_QA**. PR #367 **OPEN / Draft**, candidata `5ba07e42e52689e5f60825e3f6979f6ca7af047b`. Los tres workflows aplicables terminaron SUCCESS y su Preview está READY. QA físico: **PENDING**. Merge: **NOT AUTHORIZED / NOT PERFORMED**. Este cierre E es documental y conserva intacto el HEAD probado del PR.

## 1. Resultado y procedencia

Se implementa exclusivamente M-01: StorageEvent y BroadcastChannel solicitan una relectura del registro durable. Un aviso antiguo no bloquea una sesión nueva cuyo registro vigente coincide; una discrepancia vigente retira el acceso local y bloquea Runtime. Ningún mensaje concede autoridad ni renueva evidencia.

Main inicial/final consultado: `f48aab53634663438a06dc5187fa7e6d17b74fb3`, árbol `19f238828452198226159303bb24dfd832a53416`. Rama: `fix/actor-scoped-storage-stale-hints-m01-r1`.

Fuente focal exacta: `1cdc1cd029982e0279177ab29be1f8fffacb6ed8`. Los dos módulos de producto son idénticos a sus blobs: actorScopedStorage `61cda026` (prefijo) y bridge `dd9cbe8d`. Se contrastó la auditoría `dcfb59dd860b37ff2c7ce885dea099cea5b5dc80`; NO se copió el checkpoint combinado `93a9d6ef`. PR #365 y #366 están mergeados y sus controles permanecen en main.

Se revisaron los siete antecedentes PWA/late-context/stability. Sus resultados históricos se conservan como antecedentes; los contadores de este informe proceden de ejecuciones nuevas. Se usaron worktrees independientes; no se sobrescribieron otros checkouts. No hay AGENTS.md aplicable en el árbol.

## 2. Diff comercial y ausencia de M-03

Sólo dos archivos de producto, 31 líneas añadidas y 20 retiradas:

- `actorScopedStorage.js`: comparador exacto granted/tenant/token/actor opaco/generación; relectura durable al recibir hints; guarda de identidad del binding después de leer; token en evento interno; reutilización del comparador en asserts; storage clear también solicita relectura.
- `actorSessionRuntimeBridge.js`: importa el snapshot de storage y compara actorKey, generación y token después de getState antes de bloquear.

`invalidateActorScopedStorage()` tiene cuerpo **idéntico byte a byte a main**. Controller, handoff, política Admin, tenant storage, SW, App, esquema, RPC, finanzas, permisos Staff, licencias/dispositivos y migraciones no tienen diff. M-03, Authority v2, Web Locks, F-01 y F-02 visual: **NOT INCLUDED**.

No se hizo cherry-pick de commits experimentales. Los extras son tests, runner, informes y evidencia. El runner anterior fue adaptado para evaluar M-01-only: en particular LC13 secuencial vuelve a FAIL, no conserva el PASS de M-03.

## 3. EXP-F02-14 y revocación legítima

Main nuevo: 10 PASS / 1 FAIL en integración recuperada + storage existente. EXP14 conserva durable B pero cambia B de granted/session-b/generation6 a locked/sessionId=null/generation7; suspende writes. Focal original y candidata: 11/11 PASS; B conserva grant completo/generación/durable; los handles A rechazan; no se invoca de nuevo autorización.

Matriz M-01 añadida, sobre main: **5 PASS / 15 FAIL**; candidata: **20/20 PASS**. Además de falsos bloqueos históricos, main no relee durable ante un hint que lleva su propio token o ante clear. Esto no habilita escritura storage (sus asserts siguen existiendo), pero retrasa la invalidación Runtime. La candidata cierra esa ruta sin publicar otro hint.

`getState()` puede vencer Admin, publicar LOCKED e invalidar storage. El test dedicado vence durante foreign_context: queda locked por vencimiento, sube generación una vez y el handle anterior rechaza. La reentrada que retira el binding durante getItem no emite una decisión para un binding ya retirado. Los eventos internos con actor, tenant, generación o token anteriores no bloquean el actual. Reentrancia arbitraria de todas las rutas comerciales y logout completo con RPC siguen fuera de certificación.

El mock AUTH-25 antiguo omitía identidad/generación/token. Se corrigió conforme al emisor real, conservando la expectativa de bloqueo vigente. Se añadieron cuatro negativas (generación/token/actor/tenant anteriores). La suite final de recuperación Admin pasa 47/47; el global final también ejecuta sus 47 assertions.

## 4. Matriz M01-01…25

PASS significa frontera automatizada indicada; no QA comercial E2E. Estado candidato expresado como Runtime / durable / binding / handles. «Igual» significa iguales antes/después; «retirado» significa rechazo del acceso protegido. Los casos de política/handoff se ejecutan en sus suites existentes y no se atribuyen a una simulación de mensajes históricos que no realizan.

| ID | Caso / nivel | Baseline nuevo | Candidata / estados y límite |
| --- | --- | --- | --- |
| M01-01 | mismo Admin, nueva sesión; EXP14 jsdom/Chromium | FAIL | PASS: granted B / B / B / A rechaza, B escribe |
| M01-02 | sustitución real de sesión; storage/bridge | PASS ante aviso foreign; FAIL si hint lleva token propio | PASS: anterior locked / reemplazo / anterior suspendido / anterior rechaza |
| M01-03 | otro Admin; Chromium B→C | anterior rechaza en LC13, LC13 posterior FAIL | PASS: B locked / C / C / B rechaza, C escribe |
| M01-04 | evento duplicado; integración/Chromium | FAIL histórico | PASS: granted / igual / igual / vigente escribe |
| M01-05 | StorageEvent desordenado | FAIL | PASS: granted / igual / igual / vigente escribe |
| M01-06 | BC desordenado | FAIL integración | PASS integración y BC nativo: estados iguales |
| M01-07 | BC ausente | storage assert rechaza; Runtime no bloquea con hint vacío | PASS: locked ante mismatch / foreign / suspendido / rechaza |
| M01-08 | durable ausente | FAIL de callback Runtime | PASS: locked / ausente / suspendido / rechaza |
| M01-09 | corrupto/version incorrecta | FAIL de callback Runtime | PASS: locked / inválido / suspendido / rechaza |
| M01-10 | inaccesible | FAIL de callback Runtime | PASS: locked / inaccesible / suspendido / rechaza; acceso denegado instrumentado |
| M01-11 | tenant distinto | PASS evento no pertinente | PASS: propio igual; otro tenant no recibe writes; suites de aislamiento |
| M01-12 | generación antigua | evento mock anterior sin contrato; no equivalente | PASS: actual igual / igual / igual / restore actual permitido |
| M01-13 | token antiguo | FAIL EXP14 / BC | PASS: actual igual y handles anteriores rechazados |
| M01-14 | logout vigente | PASS | PASS: locked / locked / retirado / antiguo rechaza |
| M01-15 | Admin vencido | PASS lógica controller | PASS: locked por expiry / locked / retirado / rechaza |
| M01-16 | sesión válida tras vencimiento | FAIL EXP14 | PASS: B granted y plazo intacto; viejo handle no revive |
| M01-17 | Staff offline | política unchanged; suite global nueva | PASS evaluador real: denegado; flujo físico PENDING |
| M01-18 | Admin offline elegible | PASS restore previo al hint | PASS EXP14 con evaluador real; no renovación por hint |
| M01-19 | dispositivo distinto | política unchanged; suite global nueva | PASS evaluador real rechaza mismatch; registro real PENDING |
| M01-20 | handle anterior | PASS rechazo storage | PASS: A retirado; B no hereda A |
| M01-21 | handoff pendiente | suites existentes global PASS | PASS: nuevo actor no hereda pendiente; E2E PENDING |
| M01-22 | autenticación tardía | suite bridge global PASS | PASS: restore anterior rechaza sin bloquear grant nuevo |
| M01-23 | aviso durante transición | PASS caso sin active | PASS: authenticating permanece; sin grant por hint |
| M01-24 | getState causa expiry | lógica baseline; integración dedicada PASS | PASS: expiry bloquea una vez; no grant adicional |
| M01-25 | sin hints recursivos | no garantía ante aviso viejo | PASS: contadores BC invariables; foreign bloquea sólo localmente |

## 5. Matriz REV-01…10

| ID | Frontera y prueba nueva ejecutada | Resultado / límite |
| --- | --- | --- |
| REV-01 | sustitución storage, Chromium y bridge | PASS: anterior rechaza; reemplazo escribe |
| REV-02 | Admin B→C en Chromium | PASS: B locked; C actual |
| REV-03 | tenant storage + suites auth/tenant | PASS: namespaces aislados; no E2E dos negocios |
| REV-04 | expiry controller y callback getState | PASS: viejo aviso no renueva ni concede |
| REV-05 | evaluador Admin con mismatch device | PASS de política; dispositivo remoto no modificado |
| REV-06 | EXP14 viejo runtime/storage handle | PASS: A rechaza, no herencia |
| REV-07 | corrupto/version inválida | PASS: locked y write denegado |
| REV-08 | lectura denegada | PASS: locked y write denegado; no falla física de disco |
| REV-09 | sustitución sin BC | PASS durable assert antes del hint y bloqueo Runtime al StorageEvent |
| REV-10 | cambio real con hint propio/actual | PASS cinco campos y AUTH-25 vigente; no se descarta revocación |

## 6. LC13: defectos conservados

**LC13 NO RESUELTO.** M-01 no implementa exclusividad global ni fencing financiero transaccional.

| Caso | Main | M-01 | Evidencia / efecto |
| --- | --- | --- | --- |
| LC13-01 main/main | FAIL | referencia | A tardío publica locked sobre B |
| LC13-02 main/M-01 | FAIL | FAIL | escritor antiguo conserva la misma limitación |
| LC13-03 M-01/M-01; también M-01/main | FAIL de v1 | FAIL | sin M-03, misma conducta secuencial |
| LC13-04 publicación concurrente | FAIL | FAIL | B activa inmediatamente antes del setItem de A; B queda sobrescrito |
| LC13-05 cleanup pending | FAIL | FAIL | A pending publica locked sobre B posterior |
| LC13-06 logout/finally tardío | FAIL | FAIL | llamada de cleanup diferida real de storage; no logout completo comercial |

Todas las parejas main/main, main/M-01, M-01/main, M-01/M-01 y focal/focal se repiten sin freeze, con A congelado y con B congelado. Todas conservan FAIL secuencial. Freeze/thaw CDP no equivale a hibernación Windows.

Riesgos separados: invalidación secuencial; publicación concurrente sin CAS; pending cleanup; callbacks/finally tardíos que operan sobre singleton; clientes main antiguos; grants cercanos sin admisión atómica; callbacks Runtime que no consultan durable. El contador sintético V1-21 demuestra que storage rechazado no cerca todos los efectos Runtime antes del hint. No es una venta ni un bypass SQL demostrado. Ninguna variante LC13 mejora artificialmente ni añade un handle capaz de escribir después de la invalidación.

## 7. Chromium y fuentes

Chromium 143.0.7499.0: **34 observaciones: 11 PASS acotados, 22 FAIL conservados y 1 PASS_LIMITATION_DETECTED; cero HARNESS_ERROR**. Datos completos, hashes SHA-256 de módulos, token/contexto, actores, generaciones, bindings, handles, writes y snapshots: `chromium.json.gz`.

Un BrowserContext por escenario; sus documentos comparten origen/storage. Auth, dispositivo, readiness y SALES son proveedores sintéticos; módulos de controller/bridge/handoff/storage/tenant reales. BC nativo; StorageEvent nativo para publicación entre documentos; entrega histórica inyectada declarada. No se accedió a Supabase ni al perfil del propietario. SO físico, PWA instalada, BFCache/descarte y transporte comercial E2E: PENDING.

## 8. Validación local

| Grupo | Resultado nuevo |
| --- | --- |
| EXP14 + storage main | 10 PASS / 1 FAIL conservado |
| Focal original exacto | 11/11 PASS |
| Candidata EXP14 + storage | 11/11 PASS |
| Matriz añadida sobre main | 5 PASS / 15 FAIL |
| Matriz añadida candidata | 20/20 PASS |
| Auth/tenant/health antes de últimas 2 negativas | 280/280 PASS |
| Recuperación Admin final | 47/47 PASS, incluidas 4 negativas |
| Licencias/sesiones/mantenimiento/aislamiento | 118/118 PASS |
| Finanzas/handoff seleccionadas | 188/188 PASS |
| Dexie Recovery del workflow, archivos únicos | 127/127 PASS |
| PWA/precache/packaging tras builds | 48/48 PASS |
| ESLint focal y git diff --check | PASS, sin cambiar reglas |
| Admin + postbuild main y candidata | PASS; 24 startup assets, 0 core Local assets |
| Store y Store Vercel main y candidata | PASS |
| Global main | 5612 PASS / 75 FAIL / 52 SKIP / 5739 total |
| Global candidata | 5637 PASS / 75 FAIL / 52 SKIP / 5764 total |
| PR127 local oficial | 91 compartidas, 0 exclusivas/nuevas/sin resolver |

Los grupos se solapan; no sumar contadores. Fallos globales siguen rojos. PR127 normaliza únicamente prefijos absolutos de checkout y dependencia compartida con evidencia original intacta; diagnóstico raw: 13 identidades compartidas y 78 exclusivas por paths. Con roots canónicos: 91 compartidas y cero exclusivas. Targets=[]: ambos runners focales se invocaron, **cero repeticiones ejecutadas**, no 20 PASS.

Primer auth run: AUTH-25 falla por mock sin campos reales; se conserva y se corrige el fixture como se explicó. Primer ensayo ampliado: un test intentaba autenticar sobre granted y falla ACTOR_HANDOFF_REQUIRED; se corrigió la secuencia del fixture, sin producto. Primer test PWA se lanzó mientras Store reconstruía y obtuvo ENOENT dist-store/index.html; tras finalizar todos los builds la suite pasa 48/48. Se conservan salidas originales. Avisos build de imports mixtos/chunks/globs y baseline-browser-mapping no se ocultan ni cambian umbrales.

Regresiones financieras verifican repositorios reales con sus doubles/fake-IDB: sales, cash, customer credit, layaways, inventory, outbox actor/tenant, ledger, receipts, recovery, proyección y handoff. No se alteran originActor, idempotencia, intents/outbox ni contratos de confirmación; logout no cierra caja. No equivalen a venta/cobro comercial E2E o fencing integral.

## 9. PR Draft, CI y Preview

[PR #367](https://github.com/fdxruli/Lanzo-POS/pull/367): OPEN / Draft / mergeable al revalidar, sin merge. HEAD comercial probado y Preview SHA: `5ba07e42e52689e5f60825e3f6979f6ca7af047b`, árbol `46f8f162261a74b576e41128fd8e170bcfe57962`. Main permanece f48aab53.

| Workflow sobre D | Resultado exacto |
| --- | --- |
| [PR127 #39689600184](https://github.com/fdxruli/Lanzo-POS/actions/runs/39689600184) | SUCCESS: 99 identidades compartidas, 0 exclusivas/nuevas/sin resolver; cero targets focales |
| [Actor Runtime #39689600221](https://github.com/fdxruli/Lanzo-POS/actions/runs/39689600221) | SUCCESS: focal, dos globales por lado y diferencial; 93 observaciones preexistentes estables, 0 regresiones nuevas |
| [Actor Scoped #39689600173](https://github.com/fdxruli/Lanzo-POS/actions/runs/39689600173) | SUCCESS: focal, dos globales por lado, 50 repeticiones por target, IA/controles negativos y diferencial; 93 observaciones heredadas, 0 regresiones nuevas |
| HOTFIX Dexie | NOT_TRIGGERED_PATHS; no workflow_dispatch; no requerido por reglas. Su selección local pasa 127/127. No se declara SUCCESS remoto inexistente |
| Device Actor Auth / FREE Local | No activados por filtros de este diff; no son gates requeridos por reglas para este cambio |

Global en ambos workflows repetidos: cada BASE 5612 PASS / 75 FAIL / 52 SKIP; cada CANDIDATE 5637 PASS / 75 FAIL / 52 SKIP. Sus siete targets focales pasan 50/50 por lado (350 por lado y por workflow), sin targets no ejecutados/ilegibles. Scoped añade IA duplicate-submit 50/50 en BASE y CANDIDATE y NEG-01/02/03 PASS. No sumar repeticiones como tests únicos. Runtime omite su job de publicación idempotente porque está limitado a otra rama; ese SKIPPED no es PASS ni bloquea la validación/diferencial.

Los ocho fallos compartidos adicionales de PR127 remoto frente al local son ENOENT de artefactos ausentes en ambos checkouts sin build. Se conservaron los originales, se verificaron los hashes ZIP y se separan los contadores de comparadores (99 PR127 remoto, 91 PR127 local, 93 observaciones de cada gate repetido). Las suites brutas siguen rojas por fallos heredados.

[Preview D](https://lanzo-qg6zkdxqr-fdxrulis-projects.vercel.app): **READY**, deployment `dpl_LM4PivQcha1hf5aziPDptLapFqXb`, proyecto lanzo-pos `prj_tE5uWn6kLBYdS1eDFWVxRm449RUr`, team `team_buvft2mAJErTNR8gDhXcZGfS`, target Preview, rama/SHA D exactos. HTML Lanzo POS, 10 recursos iniciales JS/CSS, SW y manifiesto: HTTP 200 y MIME correcto. El bundle incluye el handler M-01; manifiesto scope=/ y start_url=/. No se valida la pantalla de protección como si fuera la app.

Host compilado de backend: `odlrhijtfyavryeqivaa.supabase.co`, producción. Se hicieron sólo lecturas estáticas autorizadas: cero login, registro de dispositivos, RPC o mutaciones comerciales. No se cambiaron variables de entorno. Production sigue READY en deployment `dpl_7E212PvkFiHe2DK8SaiTEn3ANxJ5`, SHA main f48aab53.

El cierre E se preserva aparte en `audit/actor-storage-m01-only-closure-r1`, descendiente de D y sólo documental/evidencia. El PR mantiene D y sus checks/Preview exactos; no se atribuyen a E checks de otro SHA. En el PR se enlazan los informes finales de E y sus checkpoints recuperables.

## 10. PR #338 / #352 y orden de integración

#338 OPEN/Draft, HEAD `fef7205f76b173025f503e60d0968f446f741e78`; #352 OPEN/Draft, HEAD `d758f69b2119f1bc346eb0ac86ba0a74c0265668`, apilado sobre #338. Ninguno fue modificado, mergeado ni rebasado.

Merge-tree de sólo objetos contra la candidata: #338 presenta conflicto en actorRuntimeController; #352 presenta 16 archivos con conflicto (detalle raw), incluidos controller, auth UI, App/main, SW, workflows y Vite. El bridge se fusiona textualmente, pero exige revisión semántica: las ramas antiguas omiten expiración Admin y otras guardas actuales; #352 también retira tickets/guardas asíncronas y generación de autenticación. Esto es drift de ramas, no regresión aplicada.

Orden recomendado: completar QA y decisión de M-01; si se autoriza su integración, actualizar #338 sobre main conservando expiración/168h/bindings/restores tardíos/M-01; después reconciliar #352 sobre #338 y main. Repetir suites auth/Staff/handoff/finanzas/SW/SQL apropiadas. No aceptar el archivo antiguo completo para resolver conflictos.

## 11. QA físico del propietario

Todos PENDING. No modificar reloj real ni datos de negocio para simular vencimiento. Los mensajes históricos y LC13 se ensayan en fixtures aislados. La Preview nueva tiene otro origen y no hereda IndexedDB ni dispositivo del origen estable.

| Caso | Chrome/Edge con Lanzo Local | Estado |
| --- | --- | --- |
| QA-M01-01 | Login Admin normal | PENDING |
| QA-M01-02 | Logout y nuevo login | PENDING |
| QA-M01-03 | Navegar entre secciones | PENDING |
| QA-M01-04 | Cambiar de pestaña y regresar | PENDING |
| QA-M01-05 | Suspender/reanudar equipo o navegador | PENDING |
| QA-M01-06 | Offline con evidencia Admin elegible | PENDING |
| QA-M01-07 | Reconectar internet | PENDING |
| QA-M01-08 | Carrito/pedidos conservados | PENDING |
| QA-M01-09 | Ventas/caja existentes intactas | PENDING |
| QA-M01-10 | Sin falsos bloqueos en sesión válida | PENDING |
| QA-M01-11 | Vencimiento/revocación real sigue bloqueando | PENDING; fixture para provocar vencimiento |
| QA-M01-12 | Móvil vertical/horizontal y navbar | PENDING; sin cambios visuales |

## 12. Checkpoints y restricciones

Checkpoints remotos recuperables (todos ancestros del PR #367):

| Etapa | SHA remoto | Árbol |
| --- | --- | --- |
| A: reproducción | `7343135ad841e3c65ff6a005a49496423a258745` | `fe5a3845002de7fe2cfbb23f148a724f13aa1a26` |
| B: implementación focal | `89c8f67cfdda071bcc58f484c5b32348478a05be` | `d8239edff92f2eb342806410c3c76664cdfed490` |
| C: pruebas finales | `9e98fd7fd5e6a0cf23e65e708bdecbd53134dbf7` | `b901b3869d874c59746862c7aa418ea64b62c0e4` |
| D: candidata Draft | `5ba07e42e52689e5f60825e3f6979f6ca7af047b` | `46f8f162261a74b576e41128fd8e170bcfe57962` |
| E: cierre | Commit que contiene este cierre, entregado en el PR | Sin cambio de producto |

Los commits locales originales 6f43f1ca/6363772a/9127d531/95468ca9/8e518ffd conservan los mismos árboles equivalentes. El push CLI carecía de credenciales; se usó el conector GitHub para crear blobs/árboles/commits y la rama final. La metadata de autor/fecha produce SHAs de commit distintos; los hashes de árbol coinciden, incluido el global final sobre el árbol C. No se publicó ningún tip incompleto ni se hizo force push.

MIGRATIONS=NONE; SUPABASE_CALLS=NONE; SUPABASE_PRODUCTION_WRITES=NONE; USER_IDB_CLEARED=NO; AUTO_CASH_CLOSE=NO. M-01 IMPLEMENTED; M-03/Authority v2/F-01/F-02 visual NOT INCLUDED. Sin merge.

Dictamen final: **READY_FOR_OWNER_QA**. M-01 mejora el falso bloqueo y conserva las revocaciones en las fronteras probadas. PR127 local/remoto y ambos gates repetidos no detectan regresiones nuevas. LC13, callbacks/cleanup tardíos, convivencia sin exclusividad nueva y fencing global permanecen abiertos. La candidata D está preparada para QA físico; valorar un merge requiere los resultados del propietario, revalidación de su HEAD/CI y autorización posterior expresa. No se ejecutó merge.
