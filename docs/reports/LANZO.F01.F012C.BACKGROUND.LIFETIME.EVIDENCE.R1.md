# LANZO POS — F01-2C — BACKGROUND LIFETIME EVIDENCE R1

Fecha: 24 de octubre de 2026, America/Mexico_City.
**BACKGROUND_LIFETIME_PARTIAL / HOLD_BACKGROUND_LIFETIME.** PR #373 OPEN/Draft,
base #372, sin gate comercial ni cierre de LC13.

## Procedencia y reproducción

Baseline exacto `d007bfe1cc2569391a2959ddff73bb2ed1e9c8ff`; main
`52bb573e651529b323b6617e3161cd76ece14a39`; #372
`f1d69093ffe3ad180752773c178b7fbaefd92ce1`. HEAD final publicado, árbol exacto y
CI quedan registrados en el cuerpo del PR. Reproducción en README del laboratorio
`scripts/qa/single-instance-f012c`. No modificar main/#372 para repetir pruebas.

Node 24.22.1, dependencias originales por symlink a instalación del mismo lockfile.
Sin paquetes ni lockfile nuevos, sin Docker. Vitest/jsdom/fake-indexeddb del repo;
Playwright externo del runtime para intento de navegador. Test fixtures no usan
perfiles, IndexedDB ni cuentas del propietario. RPC, Auth, DB provider, actor y
tenant de la matriz BGX son sintéticos. Se prueban implementaciones reales de
profile/UI/Drive slice, revalidate, processing y lifecycle. Autorización real,
Actor Storage, políticas y finanzas se comprueban en suites separadas; nunca se
atribuye al mock GRANTED autoridad real.

La skill Supabase y documentación RPC/changelog oficial fueron consultadas.
La lectura directa del changelog Markdown fue rechazada por el extractor debido
al content-type; se consultó el índice oficial de breaking changes. No se cambia
SDK/protocolo ni esquema. No se llama a ningún proyecto Supabase, Drive ni servidor
financiero real. No se usa documentación como sustituto de tests del repositorio.

## Resultados definitivos

| Control | Baseline d007bfe1 | Candidata final |
| --- | --- | --- |
| BGX-01..60 + 11 extras | Probes separados | 71/71 PASS |
| Focal final ampliado | Suites originales en global | 194/194 PASS (F01-1/A/B + BGX) |
| Probes de límites antiguos | 4/4 reproducciones PASS | Correcciones en matriz; sync conserva UNKNOWN |
| Selección amplia | 1.167 PASS / 4 FAIL / 50 SKIP / 1.221 total | Idéntica; cero diferencias |
| Global | 5.793 PASS / 88 FAIL / 52 SKIP / 5.933 total | 5.864 PASS / mismos 88 FAIL / 52 SKIP / 6.004 total |
| PR127 local original | Comparación exacta contra baseline | OK; 104 fallos compartidos, 0 nuevos/exclusivos/sin resolver |
| Production / Preview real | PASS / PASS | PASS / PASS |
| Store / Store Vercel | PASS / PASS | PASS / PASS limpio; EEXIST reutilizado preservado |
| Precache/bundles | Sin faltantes ni fixtures/coordinador | Sin faltantes ni fixtures/coordinador |
| ESLint focal + scripts / diff-check | Configuración intacta | PASS |
| Chromium F01-2C | No ejecución nueva de baseline | NOT_EXECUTED: falta binario |
| GitHub Actions SHA exacto | No se usa CI de otros SHAs como resultado | Estado consultado al publicar, en cuerpo de #373 |

No suite global verde. La selección amplia conserva los cuatro fallos históricos
`restaurantOrderCheckoutClose split bill support`: pending offline, failure del
repositorio, retry/paymentSummary y conservación de legacy rows. PR127 contabiliza
identidades de archivo/colección además de assertions: no confundir sus unidades
con los 88 FAIL de tests. Se usa el comparador original del repositorio sin editarlo.

`compare.mjs` normaliza sólo el prefijo absoluto de cada checkout a la misma ruta
`/tmp/lanzo-checkout`, también dentro del nombre de la prueba parametrizada que
incluye una traza DOMException. Mantiene intactos errores, estados, contadores,
assertions, umbrales y demás texto. Normalization manifest, JSON crudos y entradas
normalizadas PR127 se conservan. No se repiten targets vacíos artificialmente.

Los builds usan VERCEL_ENV=production/preview explícitos, ejecutados en serie por
checkout. Baseline y candidata aislados pueden trabajar en paralelo. Se preservan
builds intermedios, diferenciados de la certificación de fuentes finales. El
wrapper de validación continúa ante fallos históricos: su exit final no es PASS
implícito; consultar JSON/exit de cada etapa. `coreLocalRouteAssets=[]` es el valor
literal de la auditoría y no prueba de navegación offline completa.

## Matriz BGX-01..60 y extras

`bgx-matrix.json` enlaza cada assertion con contexto inicial, actor, tenant, tarea
raíz, hijos, promesa pública, estado de transporte acreditado por assertions,
momento de invalidación, checkpoints de pending/actor/tenant, continuaciones,
writes locales y resultado de drain/UNKNOWN. Los checkpoints se capturan tras los
avances explícitos de reloj del fixture. No son trazas de producción ni un orden
total de todos los microtasks. `afterEach` puede conservar task.state=run antes de
que Vitest publique el estado definitivo: el JSON de resultados es la autoridad.

Los once extras prueban cambio de actor entre invocación y factory, callback
onPrepared async que sigue UNKNOWN, recuperación de token ante cambio de actor y
tenant, y recuperación legítima del token. Los 60 BGX se mantienen identificables;
no se suman repeticiones ni suites solapadas como nuevos casos únicos.

| ID | Assertion | Result |
| --- | --- | --- |
| BGX-01 | BGX-01 PROF-01 no cache: raw RPC, both local writes and publication settle | PASSED |
| BGX-02 | BGX-02 PROF-02 fresh memory cache avoids remote work | PASSED |
| BGX-03 | BGX-03 PROF-03 slow raw RPC keeps root and transport pending | PASSED |
| BGX-04 | BGX-04 PROF-04 quiesce before transport admission starts no RPC | PASSED |
| BGX-05 | BGX-05 PROF-05 public profile timeout leaves transport pending without late publication | PASSED |
| BGX-06 | BGX-06 PROF-06 tenant change rejects old remote response before writes | PASSED |
| BGX-07 | BGX-07 PROF-07 actor change rejects old remote response before writes | PASSED |
| BGX-08 | BGX-08 PROF-08 logout rejects old remote response before writes | PASSED |
| BGX-09 | BGX-09 PROF-09 new profile wins over previous request | PASSED |
| BGX-10 | BGX-10 PROF-10 asynchronous preference substitute is observed and remains UNKNOWN | PASSED |
| BGX-11 | BGX-11 PROF-11 asynchronous refresh rejection is observed | PASSED |
| BGX-12 | BGX-12 PROF-12 invalidated request never invokes onPrepared | PASSED |
| BGX-13 | BGX-13 PROF-13 offline Admin profile uses tenant cache without extending authorization | PASSED |
| BGX-14 | BGX-14 PROF-14 profile observation cannot authorize a locked Staff | PASSED |
| BGX-15 | BGX-15 PROF-15 final local cache continuation is part of drain | PASSED |
| BGX-16 | BGX-16 Drive refresh is synchronous and issues no network request | PASSED |
| BGX-17 | BGX-17 Drive local token rehydrates only through existing cache permission | PASSED |
| BGX-18 | BGX-18 locking Drive hides token without deleting credentials | PASSED |
| BGX-19 | BGX-19 expired Drive session retains existing reauth behavior | PASSED |
| BGX-20 | BGX-20 malformed Drive session is safely cleared as before | PASSED |
| BGX-21 | BGX-21 async Drive replacement keeps UNKNOWN until its own contract exists | PASSED |
| BGX-22 | BGX-22 pending profile cannot refresh Drive after tenant switch at local guard | PASSED |
| BGX-23 | BGX-23 UI preference refresh is synchronous tenant-local policy read | PASSED |
| BGX-24 | BGX-24 permission-denied preference refresh falls back to manual | PASSED |
| BGX-25 | BGX-25 profile and Drive refresh never auto-backup or mutate remote credentials | PASSED |
| BGX-26 | BGX-26 SHARED-01 owner and consumer join one raw lifetime | PASSED |
| BGX-27 | BGX-27 SHARED-02 two consumers share owner without additional transport | PASSED |
| BGX-28 | BGX-28 SHARED-03 public owner timeout does not settle either lifetime | PASSED |
| BGX-29 | BGX-29 SHARED-04 consumer quiesce never cancels shared transport | PASSED |
| BGX-30 | BGX-30 SHARED-05 public deadline plus raw reject records late failure in both consumers | PASSED |
| BGX-31 | BGX-31 SHARED-06 logout blocks shared old continuations | PASSED |
| BGX-32 | BGX-32 SHARED-07 tenant switch blocks shared old continuations | PASSED |
| BGX-33 | BGX-33 SHARED-08 late shared rejection has no unhandled promise | PASSED |
| BGX-34 | BGX-34 SHARED-09 new actor cannot reuse old actor validation | PASSED |
| BGX-35 | BGX-35 SHARED-10 originally unobserved owner remains conservatively UNKNOWN | PASSED |
| BGX-36 | BGX-36 processing settlement retains delegated sync UNKNOWN | PASSED |
| BGX-37 | BGX-37 processing waits for profile public result but cannot infer child raw settlement | PASSED |
| BGX-38 | BGX-38 context invalidated during profile never starts subsequent sync refresh | PASSED |
| BGX-39 | BGX-39 context invalidated during persistence never publishes result | PASSED |
| BGX-40 | BGX-40 stale processing before admission has no effects | PASSED |
| BGX-41 | BGX-41 processing persistence errors remain failures without sync side effects | PASSED |
| BGX-42 | BGX-42 pending sync refresh remains pending processing without confirmation | PASSED |
| BGX-43 | BGX-43 processing can settle while a subscriber child is still running | PASSED |
| BGX-44 | BGX-44 asynchronous store-triggered work is a reproducible unknown counterexample | PASSED |
| BGX-45 | BGX-45 processing UNKNOWN prevents a false SYNC_QUIESCED drain | PASSED |
| BGX-46 | BGX-46 joining an owned promise registers synchronously | PASSED |
| BGX-47 | BGX-47 quiesced consumer cannot join or start more work | PASSED |
| BGX-48 | BGX-48 context invalidation before profile factory blocks all providers | PASSED |
| BGX-49 | BGX-49 two stores do not invalidate each others profile generation | PASSED |
| BGX-50 | BGX-50 license cleared without actor update still rejects old profile | PASSED |
| BGX-51 | BGX-51 timeout before validation transport suppresses later RPC and observes deadline rejection | PASSED |
| BGX-52 | BGX-52 raw profile rejection after timeout remains observed | PASSED |
| BGX-53 | BGX-53 unknown profile substitute cannot claim complete drain | PASSED |
| BGX-54 | BGX-54 scope invalidation after raw result blocks profile publication | PASSED |
| BGX-55 | BGX-55 successful profile RPC clears its public deadline timer | PASSED |
| BGX-56 | BGX-56 default non-observed profile still publishes usable profile | PASSED |
| BGX-57 | BGX-57 default non-observed revalidation preserves server denial result | PASSED |
| BGX-58 | BGX-58 no license cannot acquire authority through lifecycle | PASSED |
| BGX-59 | BGX-59 no ready tenant skips background profile and all refresh providers | PASSED |
| BGX-60 | BGX-60 observer and default queries keep identical public profile values | PASSED |
| EXTRA-01 context captured at invocation blocks actor replacement before factory | EXTRA-01 context captured at invocation blocks actor replacement before factory | PASSED |
| EXTRA-02 asynchronous onPrepared callback stays observed and UNKNOWN | EXTRA-02 asynchronous onPrepared callback stays observed and UNKNOWN | PASSED |
| EXTRA-TOKEN-actor credential recovery rechecks context before persisting | EXTRA-TOKEN-actor credential recovery rechecks context before persisting | PASSED |
| EXTRA-TOKEN-tenant credential recovery rechecks context before persisting | EXTRA-TOKEN-tenant credential recovery rechecks context before persisting | PASSED |
| EXTRA-TOKEN-valid credential recovery preserves legitimate persistence | EXTRA-TOKEN-valid credential recovery preserves legitimate persistence | PASSED |
| EXTRA-LATE-refreshTenantUiPreferences synchronous quiesce retains unknown continuation and rejection | EXTRA-LATE-refreshTenantUiPreferences synchronous quiesce retains unknown continuation and rejection | PASSED |
| EXTRA-LATE-refreshTenantUiPreferences synchronous invalidate retains unknown continuation and rejection | EXTRA-LATE-refreshTenantUiPreferences synchronous invalidate retains unknown continuation and rejection | PASSED |
| EXTRA-LATE-refreshDriveSession synchronous quiesce retains unknown continuation and rejection | EXTRA-LATE-refreshDriveSession synchronous quiesce retains unknown continuation and rejection | PASSED |
| EXTRA-LATE-refreshDriveSession synchronous invalidate retains unknown continuation and rejection | EXTRA-LATE-refreshDriveSession synchronous invalidate retains unknown continuation and rejection | PASSED |
| EXTRA-LATE-onPrepared synchronous quiesce retains unknown continuation and rejection | EXTRA-LATE-onPrepared synchronous quiesce retains unknown continuation and rejection | PASSED |
| EXTRA-LATE-onPrepared synchronous invalidate retains unknown continuation and rejection | EXTRA-LATE-onPrepared synchronous invalidate retains unknown continuation and rejection | PASSED |

PROF-01..15 corresponden a BGX-01..15. SHARED-01..10 corresponden a BGX-26..35;
BGX-30 y 33 cubren ambos el rechazo tardío, con assertions de consumidores y de
finalización local. BGX-14 comprueba que observar perfil no crea grant; la política
Staff offline real se valida por las suites originales, no por ese fixture.
BGX-43/44/45 conservan UNKNOWN de sync como resultado correcto, no como drain PASS.
BGX-10/11/21 y EXTRA-02 tampoco se convierten en drenaje completo al terminar
la promesa de un provider sustituido sin contrato de sus continuaciones.

## Contraejemplos de baseline

`baseline-probe.json`: **4/4 PASS de reproducción**, no cuatro garantías aprobadas.
El runner verifica HEAD exacto, crea un test temporal sólo en la worktree propia
baseline, usa sus fuentes reales y retira el test al terminar.

| Contraejemplo | Reproducción y comparación |
| --- | --- |
| CE-PROFILE-ACTOR-01 | Misma licencia/tenant, actor cambia con RPC pendiente: perfil inicial llama dos persistencias bajo el actor nuevo del provider. Candidata BGX-07 rechaza antes de escribir. Es decisión del profile slice con DB sintética, no escritura cruzada E2E certificada en DB real |
| CE-PROFILE-RAW-03 | Llamada directa al perfil baseline ignora scope: su resultado público vence y scope vacío drena mientras raw sigue pendiente. BGX-05 candidata conserva raw. El caller antiguo de bootstrap marcaba UNKNOWN; no se le atribuye una certificación falsa que no hacía |
| CE-SHARED-OWNER-02 | Incluso con owner observado, consumidor baseline recibe shared_owner UNKNOWN. Candidata BGX-26..34 une completion real; el origen inicialmente no observado conserva UNKNOWN en BGX-35 |
| CE-TOKEN-04 | Tras lectura vacía pendiente, cambio de actor y token de licencia antiguo: helper baseline llama a persistir antes del rechazo de contexto posterior. Dos extras candidata bloquean ese write y el RPC; el extra válido conserva recuperación |

Los probes usan transporte/DB/actor sintéticos; no se filtran ni usan tokens reales.
CE-PROFILE-ACTOR-01 y CE-TOKEN-04 no certifican el comportamiento completo de
Actor Scoped Storage/durable ni un exploit de servidor. Identifican llamadas
locales tardías que esta fase impide antes de alcanzar esas capas.

## Fronteras y propiedad

El informe principal contiene clasificación de las seis UNKNOWN iniciales,
transportes, cache, preparación, graph de sync, guards, finalización local y HOLD.
El objeto privado de revalidación posee ledger compatible con el helper original;
observe une completion y no concede cancelación. Quiesce/drain no tienen timeout,
force-release ni relación de autorización con Web Locks. Una task que no termina
continúa pendiente; unknown sigue siendo terminal para el scope. Ninguna tarea
unknown se considera resuelta sólo porque haya pending=0.

La raíz de processing y sus hijos perfil registrados son observables; subscripciones
store/actor, license timers/realtime, pulls/outbox/recovery siguen fuera del contrato.
No se certifica SYNC_QUIESCED ni REMOTE_STATE_CONFIRMED. El HOLD de esa parte exige
F01-2D con alcance propio, no un cambio provisional al sync normal.

## Intentos y limitaciones preservados

### Cierre adicional de frontera tardía y recertificación

La copia local inicial aún no estaba publicada. Se verificaron sus 120 hashes y
las siete fuentes probadas antes de continuar. La repetición inicial independiente
BGX dio 65/65. Tres contraejemplos añadidos después detectaron que un provider o
onPrepared podía quiescer el scope síncronamente y devolver una promesa: el rechazo
de markUnobservable omitía la marca UNKNOWN. Se preserva late-counterexample.json.gz:
65 PASS / 3 FAIL, sobre la candidata intermedia, no sobre baseline d007bfe1.

markUnobservable ahora permite registrar evidencia tras quiesce/invalidation, sin
admitir tareas ni conferir autoridad. Los rechazos de retornos async se observan
antes de que observe pueda rechazar admisión. track y observe siguen cerrados para
altas nuevas. Seis extras finales cruzan preferencias/Drive/onPrepared con quiesce
e invalidación; el rechazo tardío no drena ni queda unhandled. Focal ampliado nuevo:
194/194 PASS, incluidos F01-1 45, F01-2A 33, F01-2B 45 y BGX 71.

Se repitieron las suites amplias y globales de ambos árboles, y PR127 original.
Los conteos definitivos de la tabla proceden de esas ejecuciones; no se atribuye
la corrección tardía a la global anterior de 65 casos. before-late-boundary
preserva las fuentes/docs/tests iniciales en source-snapshot.json.gz y la evidencia
anterior. before-current-baseline conserva la primera ejecución base.

Los nuevos builds Preview, Production y Store pasaron. Store Vercel reprodujo el
EEXIST histórico en el staging reutilizado. Su cleanup dejó ausentes artefactos
y la selección obtuvo 1.162 PASS / 9 FAIL / 50 SKIP; global 5.859 PASS / 93 FAIL /
52 SKIP. Las cinco diferencias fueron de empaquetado/arquitectura, preservadas en
reused-packaging-attempt, no eliminadas ni declaradas PASS.

El empaquetador intacto pasó en una worktree limpia con las siete fuentes finales
idénticas por SHA-256: clean-packaging.json y clean-packaging.log.gz. Se copiaron
sólo dist-store, store/dist y store/generated de esa compilación comprobada, antes
de repetir selección/global candidata. No se modificaron assertions, packaging ni
fuentes. La última repetición confirma los mismos cuatro/88 fallos históricos y
cero diferencias de PR127. candidate/builds.json distingue los tres builds del
checkout y el Store Vercel limpio; el intento reutilizado sigue separado.

El intento Chromium se repitió en este cierre: NOT_EXECUTED por ejecutable ausente.
ESLint focal/scripts y diff-check volvieron a pasar. Los hashes finales incluyen
los informes, sources y evidencia definitivos; no cambios de producto después de
sus pruebas/builds. Los logs completos nuevos y anteriores permanecen comprimidos
sin pérdida. La consulta CI sobre el SHA publicado se documenta en el PR, con su
alcance literal de eventos, sin presentar ausencia de runs como SUCCESS.


- `initial-focal`: dos diferencias iniciales de compatibilidad. Se conservó la
  llamada default de perfil con un argumento, y se propagó el estado rejected de
  raw al completion compartido; los BG anteriores pasan sin alterar assertions.
- `bgx-initial`: mock Supabase se inicializaba antes de variables sintéticas;
  cliente null y mocks que conservaban implementaciones. Se corrigió setup del
  harness mediante env hoisted/resetAllMocks, no entorno real. `bgx-second` tenía
  tres expectativas de texto en vez de error.code; se corrigieron para comprobar
  ACTOR_CONTEXT_STALE manteniendo cero writes/publicación. Intentos preservados.
- `processing-final`: llamada default offline recibía `{lifecycle:undefined}`;
  se conserva exactamente su firma legacy cuando no hay scope. El rerun
  `processing-compatible` pasó 116/116. No se cambió la suite original.
- La comparación previa al guard de preparación de token ya tenía cero diferencias
  y 62 pruebas nuevas PASS. Se conserva separada como `before-token-guard` y
  `before-token-guard-comparison`. La revisión posterior descubrió el write interno
  del helper de credenciales; se añadieron guard y tres pruebas, y se repitió
  la validación final. No se atribuye la primera global a esa corrección posterior.
- `verify.mjs` inicial agotó el buffer por una imagen grande preexistente. Se amplió
  únicamente maxBuffer del auditor; no se alteró el asset. El comparador auxiliar
  tuvo un paréntesis de más, corregido antes de ejecutarlo. Sin cambio a PR127.
- Chromium launch real falla por ejecutable ausente. `chromium.json` conserva
  mensaje exacto: NOT_EXECUTED. Se incluye runner de dos documentos con helper y
  locks nativos para un entorno posterior; aquí no corrió su escenario. Resultados
  de F01-1/F01-2A no cuentan como navegador ejecutado en F01-2C.

Los tests heredados regeneran trazas financieras/recovery/bootstrap. Sus bytes
nuevos se preservan en `generated-legacy-traces` y sólo esos paths históricos se
restauran a sus blobs anteriores antes de commit. No se modifica evidencia histórica
para presentar nuevos resultados. Los archivos grandes se comprimen losslessly con
gzip; `.json.gz`/`.log.gz` conservan exactamente sus entradas originales. Hashes
finales en `artifact-hashes.json`, excluyendo el propio manifiesto.

## Seguridad, CI, QA y rollback

Auditoría por hashes de **2.060 archivos de producto/config preexistentes**:
**2.053 idénticos y exactamente siete fuentes autorizadas cambiadas**.
El coordinador, App/main, Actor Runtime/Storage, M-01/F-02, tenant, seis callsites
financieros de caja, outbox/SW, SQL y workflows mantienen sus blobs. Auditor adicional
busca marcadores QA/coordinador en JS/HTML/JSON de Production/Store/staging; cero
violaciones. No se importa ningún fixture nuevo en el producto.

Checks remotos se consultan sobre el SHA publicado. Los filtros PR base main
pueden dejar PR127/Actor Runtime/Actor Scoped Storage/Dexie NOT_TRIGGERED para
#373 apilado. No se modifican filtros ni base, y cero runs no es SUCCESS.
El cuerpo del PR conserva el último estado remoto exacto y enlaces de los informes.
Una Preview automática no es QA física ni prueba del gate, que permanece OFF.

QA física pendiente: Chrome/Edge Windows, PWA instalada Windows/Android,
suspensión/hibernación/BFCache, offline frío y LAN/HTTPS real del propietario.
No hace falta iniciar pagos, abrir backups personales, alterar reloj, liberar
dispositivos ni borrar IDB para esta entrega. La futura integración comercial
requiere sus pruebas específicas, seis callsites e inventario completo.

Rollback focal descrito en el informe principal: revertir sólo F01-2C sin tocar
F01-1/A/B ni datos. No hay SQL, recibos ni credenciales reales que revertir.
Supabase project calls/writes NONE; migraciones NONE; Google Drive real NO
MODIFICADO; operaciones financieras reales NONE; licencias/dispositivos SIN CAMBIOS;
main/#372 SIN CAMBIOS; producción NOT DEPLOYED; merge NOT PERFORMED. LC13 OPEN.
