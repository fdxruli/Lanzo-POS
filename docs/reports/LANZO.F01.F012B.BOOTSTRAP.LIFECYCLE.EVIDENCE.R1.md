# LANZO POS — F01-2B — EVIDENCIA R1

Estado: **HOLD_BACKGROUND_LIFETIME**. PR #373 permanece OPEN / Draft / NOT MERGED.
El código final, incluido el refresco positivo Admin, terminó la ejecución
global en serie con **5.793 PASS / 88 FAIL históricos / 52 SKIP**. La repetición
de PR127 local conserva 104 identidades compartidas y ninguna nueva.
Se implementan fronteras focales y se conserva la ruta comercial por defecto.
No es certificación comercial, de servidor, de exclusión legacy ni de PWA física.

## Referencias y reproducción

Inicio #373: `5bfd0693224d92ae8957684bc85bc61ed6cbab90`; main:
`52bb573e651529b323b6617e3161cd76ece14a39`; #372/base:
`f1d69093ffe3ad180752773c178b7fbaefd92ce1`.
Los hashes finales y estado remoto se registran en el cuerpo del PR y en la
verificación de publicación; el hash de un commit no se incorpora dentro de sí mismo.

Directorio de evidencia: `scripts/qa/single-instance-f012b/evidence`.
Reproducción: `scripts/qa/single-instance-f012b/README.md`; runners nuevos `validate`,
`compare`, `baseline-probe`. Se reutilizan runners F01-2A inalterados para builds,
selección amplia y global. Node v24.22.1; dependencias del lockfile original sin
instalación/actualización de paquetes de producto. Fake-IDB y transport/Auth
sintéticos; ningún cliente conectado a proyectos Supabase.

## Resultado de validación

| Control | Baseline inicial #373 | Candidata |
| --- | --- | --- |
| BG-01..45 nuevos | No aplica | 45/45 PASS; repetición trazada 45/45 PASS |
| Focal final ampliado | Suites originales en global | 131/131 PASS |
| Selección amplia | 1.167 PASS / 4 FAIL / 50 SKIP (1.221) | Idéntico; cero diferencias |
| Global | 5.748 PASS / 88 FAIL / 52 SKIP (5.888) | 5.793 PASS / 88 FAIL / 52 SKIP (5.933) |
| PR127 local original | Comparación con HEAD inicial | 104 fallos compartidos; 0 exclusivos, nuevos o sin resolver |
| Production build local | PASS | PASS |
| Preview real VERCEL_ENV=preview | PASS | PASS |
| Store build local | PASS | PASS |
| Store Vercel build local | PASS | PASS en checkout limpio; EEXIST en workspace reutilizado preservado |
| Precache Production/Preview | Sin faltantes | Sin faltantes ni fixtures/coordinador |
| Chromium | No ejecutado en F01-2B | NOT_EXECUTED: binario de navegador no disponible |
| ESLint focal / diff-check | No alteración de configuración | Sin errores de código |

No suite global verde. Los 4 fallos de la selección son históricos de
`restaurantOrderCheckoutClose split bill support`: pending offline, fallo del
repositorio, reintento conservando paymentSummary y filas legacy al añadir retry.
Las 88 assertions fallidas globales y errores de archivo se conservan; PR127
contabiliza 104 identidades porque incluye errores de colección/archivo.

Las suites existentes ejercitan Auth/Admin/Staff, Actor Runtime, Actor Scoped
Storage, M-01, F-02, Admin offline, tenant, bootstrap, Dexie, PWA, handoff,
financial/receipt/proyecciones, outbox, caja, ventas y restaurante. El global
incluye además las 33 pruebas F01-2A y F01-1. Consultar JSON brutos para cada
assertion; no confundir los gates diferenciales con borrar fallos históricos.

El extract PR127 sobre JSON crudos primero rechazó 91 identidades aparentes:
su normalizador no reconoce `/workspace`, y una prueba parametrizada incluye
una traza DOMException con la ruta absoluta en su propio nombre. Se conserva
`raw-phase-one`, raw targets y el log inicial. `compare.mjs` sustituye **sólo el
prefijo absoluto del checkout** por el mismo `/tmp/lanzo-checkout` en ambos JSON.
No cambia estados, errores, contadores, nombres semánticos ni umbrales. El script
PR127 original entonces obtiene 104 compartidos y cero nuevos. `normalization.json`
registra prefijos y conteo de sustituciones; JSON crudos y normalizados preservados.
No hicieron falta focused repetitions de targets vacíos. El primer comparador
auxiliar también falló por el nombre DOMException absoluto; log conservado.

La última repetición global de candidata se guarda por separado antes de
reemplazar el checkpoint previo al ajuste de compatibilidad para `options=null`.
Ese ajuste, el refresco positivo Admin y la instrumentación de trazas se
comprobaron de nuevo; no se cambia
el baseline. Los resultados definitivos están en `candidate/global` y
`matrix-traced`, no en los intentos iniciales.

## Matriz BG-01..45

Cada fila enlaza un contrato ejecutable y tiene un registro en `bg-matrix.json`:
estado inicial, evento, generación/binding final cuando se ejercita, starts y
settlements de scopes registrados, restauraciones, verificaciones, efectos de
fondo, resultado y límites. `traces/*.json` conserva los snapshots reales de la
repetición; la autoridad de casos loader/transport se marca not_exercised, nunca
se inventa GRANTED. Los contadores de scopes corresponden sólo a trabajo registrado;
un unknown no es un task completado y un pending=0 no acredita drain.
Los tests de factories distinguen registered/started/finished. Los eventos y
providers concretos están en los cuerpos de las pruebas, con fake timers donde
se declara. No se presentan como trazas de producción.

| ID | Contrato sintético ejecutado | Resultado |
| --- | --- | --- |
| BG-01 | concurrent callers share one flight | PASS |
| BG-02 | sequential calls prove and verify current Admin without second restore | PASS |
| BG-03 | force uses normal restoration | PASS |
| BG-04 | preparation error permits retry | PASS |
| BG-05 | logout invalidates existing authority | PASS |
| BG-06 | legitimate reauthentication restores after logout | PASS |
| BG-07 | actor identity changes are reevaluated | PASS |
| BG-08 | license changes are reevaluated | PASS |
| BG-09 | plan change does not reuse previous result | PASS |
| BG-10 | store factories never share another stores flight | PASS |
| BG-11 | Staff still verifies online on sequential calls | PASS |
| BG-12 | Staff offline denies reuse | PASS |
| BG-13 | Admin offline still calls current authorization proof | PASS |
| BG-14 | expired Admin authority is never a reused success | PASS |
| BG-15 | a changed session requires normal reevaluation | PASS |
| BG-16 | a changed device requires normal reevaluation | PASS |
| BG-17 | stale verification cannot overwrite a new actor generation | PASS |
| BG-18 | tenant generation change cannot reuse actor | PASS |
| BG-19 | remote denial follows existing login-required policy | PASS |
| BG-20 | StrictMode repeated invocation shares flight and later proves authority | PASS |
| BG-21 | registers before a factory starts | PASS |
| BG-22 | public ready differs from background settled | PASS |
| BG-23 | quiesce denies new registration | PASS |
| BG-24 | invalidation before start blocks factory | PASS |
| BG-25 | guards reject stale continuations after await | PASS |
| BG-26 | late rejection is observed and removed | PASS |
| BG-27 | factory throws synchronously without leaking registry | PASS |
| BG-28 | unknown work never resolves drain by time | PASS |
| BG-29 | quiesce waits for already started work | PASS |
| BG-30 | lifecycle rejects post-quiesce bootstrap without locking authority | PASS |
| BG-31 | actual background public timeout retains registered validation and transport | PASS |
| BG-32 | actual background observes late rejection after public ready | PASS |
| BG-33 | stale health probe cannot write into a new generation | PASS |
| BG-34 | profile frontier is expressly unknown and cannot claim drain | PASS |
| BG-35 | background admission rejection is observed when callers detach | PASS |
| BG-36 | preparation never activates commercial services | PASS |
| BG-37 | commercial activation follows preparation once | PASS |
| BG-38 | existing default activation remains enabled | PASS |
| BG-39 | rejected loading never installs sync or recovery | PASS |
| BG-40 | DB preflight shares preparation without commercial activation | PASS |
| BG-41 | real revalidateLicense retains raw transport beyond its internal timeout | PASS |
| BG-42 | shared revalidation owner remains unknown instead of false drain | PASS |
| BG-43 | lifecycle observation cannot grant authority without a stored license | PASS |
| BG-44 | equivalent object key order does not duplicate restoration | PASS |
| BG-45 | quiesce between registration and start clears flight for legitimate retry | PASS |

Los rangos son una matriz adicional; integridad F01-1/F01-2A, LAN, rutas públicas,
M-01/F-02 y rollback se comprueban además mediante suites existentes y hashes
`source-preservation.json`. BG-41/42 ejercitan revalidate real con RPC sintético,
no transporte Supabase real. BG-36..40 usan loader sintético y no certifican una
App comercial montada restringida. F-02/168h usa su suite real del código vigente,
no solamente la prueba corta BG-14 con reloj simulado.

## Incidencias de ejecución preservadas

Durante la validación se solaparon builds locales del mismo checkout. El `dist`
mezcló assets Preview/Production y una repetición global obtuvo **5.792 PASS /
89 FAIL / 52 SKIP**: el FAIL adicional fue la assertion de precache para el
vendor_charts de Preview que sobraba junto al de Production. El artefacto mixto,
JSON y logs se conservan en `overlapped-artifacts`. No se modificó el test ni el
precache para ocultarlo. Una reconstrucción Production aislada dejó un único
chunk vendor_charts correctamente precacheado; después se repitió la secuencia
builds → selección → global sin builds paralelos en ese checkout.

El empaquetado Store Vercel continuó devolviendo EEXIST en el workspace reutilizado,
aun en la repetición en serie. Se conserva su **exit 1** en `candidate/builds.json`
y su log; el wrapper de serie también registra builds exit 1. La causa exacta
del EEXIST de ese directorio no se corrigió como parte de bootstrap. El mismo
empaquetador pasó en baseline y en un checkout nuevo con las seis fuentes finales
copiadas y SHA-256 idéntico (`fresh-store-vercel.json`, `fresh-build-sources.json`,
`fresh-store-vercel.log`). No se presenta el intento fallido como PASS ni se
modifica packaging fuera de alcance. La tabla distingue el PASS limpio del FAIL
local reutilizado. Las compilaciones POS y Store ordinaria pasaron.

## Contraejemplo, controles negativos y límites

`baseline-counterexample.json`: CE-BOOT-01 PASS como **reproducción del defecto**,
dos restores y generación distinta en dos inicializaciones secuenciales sobre el
HEAD inicial. BG-02 de candidata verifica un restore y nueva verificación en la
segunda llamada. No se conserva una promesa exitosa permanente.

El primer intento de la matriz obtuvo 29/30 por un capture con tenant obsoleto;
se corrigió el camino de reevaluación y se conserva ese fallo inicial. Los
primeros tests de transporte obtuvieron 0/2 porque no definían variables sintéticas
para crear el cliente mock; se corrigió el fixture, conservando los resultados.
Ni el código ni las variables de producción fueron utilizados para arreglarlo.
Las nuevas pruebas definitivas pasan, incluyendo un `options=null` compatible.

`chromium-environment.json` conserva el error real de launch: falta el ejecutable
headless de Playwright. No hay resultado Chromium F01-2B ni se reutiliza como
actual el PASS histórico F01-2A. La QA física Windows/Edge/Android, PWA instalada,
suspensión/hibernación y LAN entre dispositivos sigue pendiente.

Las suites globales escriben sus trazas históricas de finanzas/recovery. Sus
salidas se copian a `generated-legacy-traces` y se restauran **sólo esos archivos
generados por la ejecución**, evitando modificar evidencia F01-2/F01-2A preexistente.
Las políticas Admin/Staff se conservan. Los sources financieros, coordinator,
main/App, SW, workflows, migraciones y dependencias conservan sus blobs.

## Builds, CI y ausencia de activación

Las compilaciones locales son builds, no despliegues. Hay cuatro targets por
árbol y repeticiones de diagnóstico; Store Vercel requiere distinguir el intento
fallido del workspace reutilizado y el PASS del checkout limpio.
Preview usa `VERCEL_ENV=preview`, no solamente `--mode preview`. Production usa
`VERCEL_ENV=production`. Sus logs y auditorías están en `base/builds.json` y
`candidate/builds.json`. Auditoría final adicional inspecciona JS/HTML/JSON de
salida: no incorpora scripts QA ni la cadena del lock comercial. Se conservan
`coreLocalRouteAssets=[]`: la auditoría no certifica navegación offline completa.

PR127, Actor Runtime, Actor Scoped Storage y Dexie workflows filtran PR base
`main`; #373 conserva base #372. No se retargetea ni modifica filtro alguno.
Su estado remoto se consulta al publicar: si no hay runs del SHA, **NOT_TRIGGERED**,
no SUCCESS implícito. El PR127 citado arriba es una ejecución **local** del script
original; no es un workflow remoto verde. La consulta remota y sus estados exactos
quedan en el cuerpo actualizado de #373.

main.jsx/App.jsx no se modifican; no importan ni activan coordinador nuevo.
`preparePosReadyRuntime` no llama activate. La ruta comercial continúa usando
`activatePosReadyRuntime`, que instala los servicios actuales. Sin cambios a
HTTP LAN, SW, M-01, F-02, offline máximo Admin ni online-only Staff. Esto se
verifica por pruebas/hashes, sin operación real de negocio.

## Hold y salida

Persisten tareas críticas no cubiertas por registro completo: perfil/preferences/
Drive, processing de licencia→sync, recovery automático y pulls/outbox fuera
del scope optativo. Las rutas alcanzadas se marcan unknown y no permiten afirmar
drain. Se inventarían garantías si se activara el gate ahora. No se reescriben
esas dependencias en esta fase. LC13 **OPEN**; no Authority v2/M-03.

El informe principal contiene grafo, clasificación, invalidaciones, los seis
callsites de caja, diseño de recorrido tenant/paginación estable y rollback focal.
Revertir F01-2B no borra DB ni requiere SQL. F01-2A/F01-1 permanecen intactas.

Supabase project calls/writes NONE; migraciones NONE; operaciones reales NONE;
licencias/dispositivos SIN CAMBIOS; deploy producción NOT PERFORMED; merge
NOT PERFORMED. Mantener #373 Draft y #372 intacto.

Los logs crudos se archivan sin cambios como `.log.gz`; los JSON grandes como
`.json.gz`. `gzip -dc archivo.gz` recupera sus bytes originales. Las referencias
a nombres `.log`/`.json` indican esos mismos resultados, con el sufijo gzip
cuando corresponde. `artifact-hashes.json` registra nombres y SHA-256 exactos.
