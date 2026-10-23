# LANZO POS — F01-1 — COORDINATOR EVIDENCE R1

Fecha: 23 de octubre de 2026, America/Mexico_City. **IMPLEMENTED_READY_FOR_OWNER_REVIEW / HOLD_MERGE.** Repositorio `fdxruli/Lanzo-POS`, base/main inicial/final `52bb573e651529b323b6617e3161cd76ece14a39`, rama `feat/f01-single-instance-coordinator-r1`. PR/HEAD publicado/CI exacto: se añaden después de publicar el primer commit. Merge NOT PERFORMED.

## Procedencia y reproducción

Se recuperaron y leyeron íntegros los seis antecedentes desde sus archivos identificados; no se buscaron sus checkpoints como ramas remotas. El adjunto actual autoriza sólo infraestructura F01-1 y PR Draft. Clon limpio propio y baseline worktree separada. No se encontraron AGENTS.md aplicables ni se modificaron otros worktrees. `evidence/remote-preflight.json` conserva los cinco PR abiertos y checks iniciales; #366/#367/#369 MERGED. Los informes de antecedentes no se cuentan como tests de esta implementación.

Código nuevo, scripts y evidencia están en el mismo commit del PR. El README del laboratorio contiene comandos reproducibles. Node 24.19.0; dependencias exactas de package-lock vía npm ci --ignore-scripts, sin cambios de manifiestos. React/React DOM 19.2.0, Vitest 4.0.14. Playwright externo 1.62.1; Chromium externo 143.0.7499.0. No Docker. BrowserContexts efímeros, datos sintéticos, servidor sólo de fixture. Ningún perfil o IndexedDB del propietario. No Supabase.

## Resultados brutos y artefactos

Todos los paths siguientes son relativos a `scripts/qa/single-instance-f011/evidence/`.

| Archivo | Evidencia y resultado |
| --- | --- |
| unit.json | 45/45 assertions nuevas PASS; identidad, singleton, protocolo, transiciones, cancelación, fallos API, retry, tickets y drain |
| chromium.json | 40 escenarios: 38 PASS / 1 COUNTEREXAMPLE / 1 PARTIAL; cero pageerrors; snapshots y contadores por documento |
| regressions.json | Candidata, 831 assertions: 827 PASS / 4 FAIL, exit 1 preservado |
| base/regressions.json | Main exacto independiente: 827 PASS / mismos 4 FAIL, exit 1 |
| baseline-comparison.json | Igualdad por archivo+fullName+estado; cero fallos nuevos, cero assertions ausentes |
| selectors.json | Selección ejecutada, sin excluir tests rojos |
| import-graph.json | Grafo AST, 87 archivos estáticos / 866 con dinámicos literales; coordinador no alcanzable; clausura propia de tres módulos |
| preserved-source-hashes.json | 2.055 blobs preexistentes idénticos a main |
| coordinator-source-hashes.json | SHA-256 de las tres fuentes probadas |
| build-production.json | 53 archivos emitidos, 24 assets iniciales precacheados, cero faltantes/violaciones F011 |
| build-preview.json | 67 archivos, 32 assets iniciales precacheados, cero faltantes/violaciones F011 |
| build-store.json | 11 archivos, cero coordinador/fixtures F011 |
| *.log.gz | Logs de unidades, lint, Chromium, builds e instalación; sin suma de repeticiones |
| remote-preflight.json | Metadatos y CI previos de PR ajenos, no se atribuyen como CI del nuevo PR |

ESLint focal final exit 0; único aviso de tooling: baseline-browser-mapping desactualizado. No se modificó dependencia para quitarlo. Builds Production/Preview/Store/Store Vercel exit 0. Vite/Workbox emiten avisos de chunking/globs opcionales existentes, conservados en logs. `coreLocalRouteAssets=[]` es el retorno literal de la auditoría; no se presenta como QA de todas las rutas offline. La producción nueva no contiene QA; Preview conserva sólo el laboratorio anterior separado del código comercial. Ningún fixture F011 entra en assets o precache.

## Matriz F011-01..40

PASS acredita la expectativa acotada descrita; COUNTEREXAMPLE conserva una garantía refutada. PARTIAL no certifica transporte ni dispositivos físicos.

| ID | Resultado | Prueba y límite |
| --- | --- | --- |
| 01 | PASS | Una pestaña, una adquisición y bootstrap sintético |
| 02 | PASS | Dos documentos secuenciales comparten contexto/origen; uno espera |
| 03 | PASS | Dos aperturas concurrentes, exactamente una propietaria |
| 04 | PASS | Tres secuenciales, una propietaria |
| 05 | PASS | Cinco documentos, una propietaria |
| 06 | PASS | Tercera no desaloja a la principal ni altera su identidad |
| 07 | PASS | Reload crea documento/ID nuevos; B en cola adquiere antes de la nueva A |
| 08 | PASS | Cierre normal libera eventualmente; B adquiere |
| 09 | PASS | CDP Page.crash real, B adquiere; sin operación financiera |
| 10 | PASS | Cierre de secundaria conserva principal |
| 11 | PASS | Cancelación explícita de cola deja RELEASED y cero bootstrap |
| 12 | PASS acotado | Freeze CDP y Debugger.paused confirmado; B espera. No hibernación física |
| 13 | PASS acotado | Reanudación tardía mantiene documento propietario. No OS suspendido |
| 14 | PASS instrumentado | Envelope histórico inyectado al receptor, nonce antiguo ignorado |
| 15 | PASS instrumentado | Duplicados inyectados, sin transición de propiedad |
| 16 | PASS instrumentado | Sequence fuera de orden/epoch posterior no aceptada |
| 17 | PASS instrumentado | Solicitud ajena ignorada |
| 18 | PASS instrumentado | Destinatario ajeno ignorado |
| 19 | PASS instrumentado | Versión incompatible ignorada |
| 20 | PASS | BC omitido por adaptador; Web Locks nativo sigue operando y failover |
| 21 | PASS | Constructor BC denegado por fixture; lock y cola se conservan |
| 22 | PASS | Locks omitido por adaptador: ERROR, cero bootstrap |
| 23 | PASS | Request rechaza SecurityError sintético: ERROR, cero bootstrap |
| 24 | PASS acotado | Documentos cargados y red offline; coordinación local. Cold start comercial no probado |
| 25 | PASS | React 19 StrictMode real setup/cleanup/setup y unmount: un request, un bootstrap; lock retenido |
| 26 | PASS | Callback tardío con ticket revocado: efecto=0, INSTANCE_COORDINATION_STALE |
| 27 | PASS | Asset de import ESM real retenido: QUIESCING conserva lock; evalúa=1, bootstrap tardío=0; luego B adquiere |
| 28 | PASS | Drain de operación sintética mantiene candidato en espera hasta terminar |
| 29 | COUNTEREXAMPLE | Legacy sintético activo y nueva propietaria coexisten; exclusión universal FAIL, cero I_AM_HERE emitidos por nuevo protocolo |
| 30 | PASS de límite | Segundo proceso Chromium/perfil independiente admite su propia propietaria; no exclusión entre perfiles |
| 31 | PASS de límite | localhost y 127.0.0.1 son orígenes independientes, dos propietarias legítimas en ámbitos distintos |
| 32 | PARTIAL | HTTP IP 192.0.2.10 interceptado: contexto inseguro/locks ausente, ERROR, bootstrap=0; LAN física NOT_TESTED |
| 33 | PASS | Ambas APIs ausentes: ERROR y ningún bootstrap sintético |
| 34 | PASS | Epoch aumenta, señal se aborta y ticket deja de ser vigente síncronamente |
| 35 | PASS | Release explícito y candidata en cola: sólo adquiere tras drain/settlement |
| 36 | PASS | Veinte start del mismo documento generan un request nativo |
| 37 | PASS | Primer request denegado y retry explícito, segundo request nativo adquiere |
| 38 | PASS acotado | Sentinel sintético localStorage conservado tras cierre; ningún borrado. No DB del propietario |
| 39 | PASS | Ticket válido no habilita autoridad sintética denegada; ningún actor real |
| 40 | PASS | Metafile de bundle del coordinador: exactamente tres módulos, cero fuentes comerciales |

Los casos 14..19 usan inyección explícita de envelopes al receptor real: no se afirma que BC reproduzca historial durable ni se miden retrasos de red. Las APIs ausentes/denegadas usan adaptadores del fixture; el arbitraje positivo siempre es Web Locks nativo. Los snapshots de documentos cerrados/crashed no se reconstruyen como estado posterior; la adquisición de B y evidencia específica sustentan ese resultado. F011-30 usa un proceso adicional; los competidores de 01..28/35/etc comparten contexto y origen.

## Fallos históricos y ausencia de regresión

Archivo `src/services/__test__/restaurant/restaurantOrderCheckoutClose.test.js`, mismos nombres y expectativas en base y candidata:

1. saves pending split close when offline — esperaba 1 fila, recibe 0.
2. saves pending split close when repository returns failure — 1 frente a 0.
3. retries pending split close without losing paymentSummary — closed=1 frente a 0.
4. does not evict legacy rows when adding a new tenant-scoped retry — 52 filas frente a 51.

El comparador normaliza sólo el prefijo absoluto del checkout. Los errores completos permanecen en los JSON. No se cambia assertion, timeout, gate ni test comercial. Las 831 assertions por lado no son 1.662 casos únicos; la repetición de Chromium tampoco se suma como otra matriz. No se ejecutó suite global local completa. CI PR127 puede cubrir una selección diferente y debe registrarse separadamente por SHA.

## Errores y refinamientos del laboratorio

La primera extracción con Python no encontró brotli; se usó zlib nativo de Node. Tar no pudo aplicar ownership del paquete de fonts a uid/gid 1000 en este host; el ejecutable Chromium y librerías necesarias sí se extrajeron y el runner final completo pasó. No se instaló ni alteró software del propietario. El README permite usar un Chromium externo ya instalado sin esa ruta local.

ESLint inicial detectó un let que debía ser const sólo en un test; se corrigió. Primera unidad: 43/43; se añadieron dos fronteras útiles, hasta 45/45 final. Se reforzó el rechazo de RELEASE de epoch ajeno antes de actualizar orden informativo, y se probó shutdown reentrante ante error inesperado. Ambas ejecuciones Chromium tuvieron los mismos 38/1/1 resultados; se conserva log inicial y JSON final, no se suman repeticiones. El runner final usa sólo flags de proceso efímero Linux --no-sandbox/--disable-dev-shm-usage; no cambia confianza de contexto HTTP, certificados ni preferencias del navegador del propietario.

## Seguridad, riesgos y QA pendiente

Sin auth/tenant/store/Supabase/Dexie/finanzas en la clausura del nuevo módulo. Sin listeners de lifecycle ni integración en App/entrypoint. Sin cambios Actor Runtime/Storage, M-01/F-02, 168h Admin, Staff online-only o autoridad financiera. Tickets locales no son grants ni CAS. Tareas registradas que no terminan pueden mantener restricción; no timeout/steal/fallback para eludirlo. Un ejecutor que omita checks puede efectuar su efecto antes de detectar obsolescencia al retornar; no se afirma fencing universal.

Legacy, otros perfiles/dispositivos/orígenes y LC13 siguen fuera de exclusión conjunta. Recuperación financiera real, callbacks comerciales, actualización SW, inventario completo de pendientes y activación temprana pertenecen a F01-2. No se permite un bootstrap parcial sin recuperación segura.

QA posterior: Chrome/Edge Windows, Android, PWA instalada y su partición efectiva, HTTPS real, LAN física confiable, BFCache/hibernación/descarte, offline frío y futuras barreras comerciales. Son OWNER_QA_REQUIRED/NOT_TESTED; no bloquean entregar la infraestructura aislada para revisión, sí impiden certificar integración comercial o esos entornos.

Supabase calls/production writes NONE; SQL/migraciones NONE; licencias/dispositivos SIN CAMBIOS; operaciones financieras reales NONE; datos locales propietario NO UTILIZADOS/NO ALTERADOS; main NO MODIFICADO; bootstrap comercial actual SIN CAMBIOS; merge NOT PERFORMED.

## Publicación y cierre

Se completará con PR Draft, SHAs y resultados remotos exactos después del push. El HOLD de merge se mantiene independientemente de checks verdes. Ver el informe Implementation para contratos, transiciones, UX futura y dependencias F01-2.
