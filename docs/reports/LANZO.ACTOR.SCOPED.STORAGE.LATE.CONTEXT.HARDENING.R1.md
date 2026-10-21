# LANZO POS — FASE 3.2A.1 — LATE CONTEXT HARDENING

Fecha: 2026-10-21 UTC. Repositorio: `fdxruli/Lanzo-POS`.

## 1. Dictamen ejecutivo

**HOLD.** La corrección focal elimina F02-LATE-CONTEXT-01 en la integración reconstruida EXP-F02-14 y en el ensayo de StorageEvent en Chromium. No está certificada como solución integral: se confirmó un segundo defecto, **LC13-LATE-INVALIDATION**, que ya existe en main. Una invalidación local tardía de A sobrescribe el registro durable de B y revoca de hecho su handle de almacenamiento. Se reproduce con dos documentos reales, tanto main/main como candidata/candidata y main/candidata.

Se activa la condición explícita del encargo: «Una invalidación tardía sobrescribe una autoridad posterior». Se detiene la implementación. No hay PR, Preview, merge, modificación de Supabase ni candidata aprobada. El cambio focal y las pruebas se conservan en una rama remota de desarrollo con despliegues automáticos desactivados para esa rama. Checkpoint D es cierre documental HOLD, no una candidata aprobada.

## 2. Estado inicial y aislamiento

Main verificado por GitHub y clon local: `f48aab53634663438a06dc5187fa7e6d17b74fb3`, árbol `19f238828452198226159303bb24dfd832a53416`, igual a la referencia del encargo. PR #365 y #366 ya forman parte del baseline. Se leyó el encargo adjunto y los cuatro informes antecedentes: auditoría 3.1, implementación parcial 3.2, resolución B-01 y F02-only 3.2A. No se usan sus recuentos de tests como evidencia nueva.

Se creó un clon independiente desde main, inicialmente limpio, con un único worktree y sin stash. No se modificaron checkouts ajenos. La búsqueda no destructiva de `adminResumeExpiry.f02.integration.test.jsx` en scratch no recuperó el fixture original. Tampoco se presupuso que el commit local perdido `11888796957efc620e0f19f8b8ca4f49451a4144` estuviera publicado. No había AGENTS.md aplicable en el código del clon.

## 3. PR abiertos y rama

| PR | Estado observado | HEAD | Base |
| --- | --- | --- | --- |
| #338 | Open, Draft | `fef7205f76b173025f503e60d0968f446f741e78` | main |
| #352 | Open, Draft | `d758f69b2119f1bc346eb0ac86ba0a74c0265668` | feat/restaurant-split-flexible-payments-r1 |

Ambos permanecen intactos. Rama nueva: `fix/actor-scoped-storage-stale-events-r1`. No incorpora commits F-01, F-02 ni restaurante. HEAD de código focal evaluado: `8867fd00f6241cfced326a198e3d32617953c9d3`; evidencia posterior: `de931651532ba4b99338e6f682f885cc9a26d1f8`. El cierre documental D es el commit que contiene este informe; su SHA se entrega junto al informe y se verifica contra GitHub.

## 4. Auditoría del contrato actual

Se inspeccionaron actorScopedStorage, actorSessionRuntimeBridge, actorRuntimeController, actorOperationalHandoff, tenantScopedStorage, tenantRuntimeRouter y sus pruebas focales. Las funciones siguientes explican los dos defectos:

- `handleForeignContext` original decide con el token del mensaje, sin releer la evidencia durable. El bridge aplica su decisión al actor actualmente granted del mismo tenant.
- `assertActiveContextCurrent` exige un registro granted que coincida con el binding. Se mantiene esa barrera antes de writes, resume y operaciones con handle.
- `invalidateActorScopedStorage` retira primero la autoridad local y luego publica incondicionalmente `locked` usando el tenant y generación del binding retirado. No comprueba a quién pertenece el registro durable vigente.
- El bridge evita publicar locked desde su subscriber foreign_context, pero conserva el binding de almacenamiento suspendido. Una invalidación posterior explícita, de expiración o de limpieza tenant todavía puede publicar sobre el contexto nuevo.
- `getState` puede expirar Admin, incrementar generación y llamar subscribers; no es siempre una lectura sin efectos. El bridge vuelve a comprobar identidad/generación antes de aplicar la decisión.
- Preparación/restauración verifica autenticación, tenant y generación tras awaits; mantiene comparación de sesión y dispositivo. Handoff conserva barreras para operaciones pendientes y checkout persistido. No se modifica ninguna de esas políticas.
- Tenant runtime mantiene su proxy de generación y readiness; cambiar/limpiar namespace llama invalidación de actor. No se cambian Dexie ni sus contratos.

## 5. Fixture reconstruido y reproducción EXP-F02-14

Archivo nuevo: `src/services/auth/__tests__/actorLateContext.integration.test.js`. **RECONSTRUIDO**, sólo EXP-F02-14 y dependencias necesarias. No incorpora health check, hook visual, listeners de reanudación ni implementación F-02.

Usa los módulos reales de controller, bridge, almacenamiento de actor/tenant, handoff y evaluador Admin offline. Sustituye únicamente readiness/DB, evidencia/credenciales y proveedor de dispositivo con fixtures sintéticos. La DB ofrece sync_cache y una lista vacía de checkouts; no es una prueba financiera Dexie. localStorage/sessionStorage pertenecen al jsdom aislado. navigator.onLine=false; no hay llamadas a Supabase.

Secuencia: conceder Admin A/session-a; capturar handles; avanzar reloj sintético hasta vencimiento; consultar controller y confirmar bloqueo; conservar registro locked anterior; restaurar legítimamente A con session-b y evidencia elegible; conservar el nuevo registro; entregar StorageEvent viejo sin sobrescribirlo. Comprobar grant, generación, handles, ausencia de renovación y estado de writes.

Comando: `npx vitest run src/services/auth/__tests__/actorLateContext.integration.test.js --maxWorkers=1`.

Baseline con producto idéntico a main: **1 FAIL**. Antes granted/session-b/generation6; después locked/sessionId=null/generation7, reason `actor_context_changed_in_other_tab`; durableNewRecordPreserved=true; writesSuspended=true. No se usa it.fails, skip ni se suaviza la aserción.

Con corrección focal: **PASS**. Conserva todo el grant, generación 6, registro nuevo y handles nuevos; handles anteriores rechazan; writesSuspended=false; no se vuelve a evaluar autorización. La atribución al baseline queda confirmada.

## 6. Corrección focal conservada, todavía no certificada

`actorScopedStorage.js` introduce una comparación común de status, tenant, token, actor opaco y generación. El mensaje BC sólo identifica el tenant afectado; el StorageEvent identifica la clave, incluyendo borrado/clear. El handler relee el registro durable: si coincide exactamente con el binding capturado, termina sin suspender, publicar ni conceder nada. Si falta, no puede leerse, es inválido o no coincide, suspende y emite foreign_context para ese binding.

Comprueba que el objeto de binding siga siendo el capturado después de leer. El evento interno incluye contextToken. En el bridge se comprueba actorKey, generación y token activo después de getState antes de bloquear. No se añade un await en el handler ni una fuente alternativa de autoridad.

Se mantiene `assertActiveContextCurrent` en los límites de escritura y resume, reutilizando la comparación exacta. Los mensajes no crean GRANTED, no renuevan evidencia y no ejecutan autenticación. No se comparan generaciones entre documentos ni se usa updatedAt como reloj global.

Estas afirmaciones describen el código; sólo los casos ejecutados de la matriz tienen resultado PASS. Las variantes de corrupción, acceso denegado y reentrancia no se certificaron automáticamente antes del HOLD.

## 7. Invalidación durable: defecto confirmado y límite de la solución

Runner: `scripts/qa/actor-late-context-browser.mjs`. Sirve exclusivamente el módulo de almacenamiento original y el focal en un origen localhost temporal. Crea perfiles Chromium sintéticos que se destruyen al terminar. No abre Lanzo, no registra dispositivos y no lee almacenamiento del propietario.

En cada pareja de documentos A/B:

1. A prepara y activa un binding legítimo de almacenamiento.
2. B prepara y activa otro binding para el mismo tenant; ambos usan generación local 1 deliberadamente.
3. El handle A rechaza al releer el registro B: la sustitución vigente sí invalida el handle anterior.
4. A llama posteriormente a la función real `invalidateActorScopedStorage('late_actor_a_logout')`, modelando una invalidación de logout/cleanup posterior al cambio durable.
5. B consulta su registro y su handle.

Resultado **en las tres parejas**: durableBPreserved=false, handleCurrent=false y durableStatus=locked. El runner termina con exit code 1. No se modificó manualmente el registro B para causar este resultado: lo sobrescribe la función real de A. La secuencia confirma invalidación tardía; no pretende reproducir un sleep físico durante una instrucción ni la intercalación exacta del subscriber de vencimiento.

| Versión A | Versión B | LC13 |
| --- | --- | --- |
| main | main | FAIL preexistente |
| checkpoint focal | checkpoint focal | FAIL bloqueante |
| main | checkpoint focal | FAIL de convivencia |

El fix de notificaciones no cambia esta función y **no resuelve ACT-ST-07/AC-07**. No se implementa una falsa solución mediante readContextRecord seguido de setItem: entre ambas operaciones otro documento puede publicar. La API no ofrece CAS ni una transacción entre esas llamadas. El estándar aconseja asumir ausencia de locking entre agentes; véase [HTML Web Storage](https://html.spec.whatwg.org/multipage/webstorage.html#introduction). Esto es una limitación de garantía, además del fallo determinista ya observado.

## 8. Contrato adicional y transición necesarios

La corrección mínima conceptual sería invalidar únicamente el contexto del que se posee autoridad, mediante una publicación condicional **atómica** o un diseño de revocación por token que no escriba sobre el contexto de otro. Esa propiedad no existe en el protocolo v1 actual. Una lectura previa sólo reduce una intercalación; no demuestra la garantía.

No se afirma que IndexedDB por sí solo solucione la convivencia: todos los escritores autoritativos tendrían que participar en el contrato nuevo. Un cliente antiguo sigue pudiendo escribir locked sobre la clave v1, como demuestra main-A/candidata-B. Mantener la clave v1 como autoridad obligatoria hará fallar B; ignorarla en una versión nueva cambiaría la barrera frente a clientes antiguos y requiere otra prueba de transición. Copiar de vuelta el registro B tampoco demuestra autoridad ni evita carreras.

Antes de seguir se requiere definir el contrato de publicación/revocación y una transición verificable de clientes antiguos (incluidos documentos suspendidos) sin transferir operaciones pendientes ni forzar actualizaciones durante operaciones. Alternativas para revisión: coordinación transaccional compartida por todos los participantes; o registros por contexto con revocación dirigida y un plan explícito para retirar escritores v1. Son propuestas, no garantías certificadas ni cambios implementados. No se justifica por ahora ninguna migración SQL.

Web Locks como gate del POS no se implementa. Una exclusión que sólo respetan clientes nuevos no detendría al antiguo y repetiría el problema B-01. No se reabre F-01. La retirada/coordinación de versiones requiere un encargo separado o un alcance revisado antes de avanzar.

## 9. Web Storage, BroadcastChannel y compatibilidad

Se conservan clave `actor-runtime-context:v1`, version=1, estructura de registros y canal `lanzo-actor-storage-v1`. Sólo el evento interno al subscriber añade contextToken. El flujo actual sigue comprobando durable aunque no llegue mensajería. El manejo de storage no se basa en newValue como autoridad. El BC focal usa tenant para solicitar relectura; no se ensayó la matriz BC antigua/ausente antes del HOLD.

No se añade una API que requiera contexto seguro al arranque, ni cambia main/useSingleInstance. Se conserva la dependencia anterior de crypto para preparar actor. El ensayo de navegador usa HTTP localhost; **no** demuestra HTTP/LAN inseguro ni Chrome/Edge físicos ni PWA instalada. La compatibilidad de seguridad integral entre versiones está **FAIL**, por LC13, pese a que el formato durable sea igual.

## 10. Matriz LATE-CONTEXT de esta ejecución

PASS se limita al nivel indicado; PENDING no equivale a aprobado. El HOLD evita ampliar la implementación o presentar certificación parcial como completa.

| Caso | Estado | Evidencia / límite |
| --- | --- | --- |
| LC-01 mismo Admin/nueva sesión | PASS focal | Integración EXP-F02-14 real con fixtures |
| LC-02 extranjero vigente | PASS storage; runtime PENDING | Test existente y handle A de Chromium rechazan; subscriber runtime integrado pendiente |
| LC-03 otro Admin | PENDING | No ejecutado |
| LC-04 otro tenant | PENDING | No certificada variante de evento tardío |
| LC-05 dispositivo | PENDING | Sólo device-a sintético en EXP14 |
| LC-06 fuera de orden | PENDING | No ejecutado |
| LC-07 duplicado | PENDING | No ejecutado |
| LC-08 BC antiguo | PENDING | No ejecutado; no extrapolar StorageEvent |
| LC-09 StorageEvent antiguo | PASS focal | jsdom y Chromium; entrega sintética, durable real conservado |
| LC-10 durable reemplazado | PASS storage | 10 tests existentes incluyen extranjero vigente; handles A rechazan en dos documentos |
| LC-11 acceso denegado | PENDING | Código fail-closed conservado, matriz no ejecutada |
| LC-12 corrupción | PENDING | Código no concede por falta de match; prueba pendiente |
| LC-13 invalidación tardía | FAIL | Tres parejas Chromium, incluida convivencia main/focal |
| LC-14 handoff en curso | PENDING | No ejecutado |
| LC-15 RPC tardía | PENDING | No ejecutado |
| LC-16 operación financiera diferida | PENDING | No ejecutado; no transferencia demostrada ni descartada por este fixture |
| LC-17 suspensión/reanudación | PENDING | No freeze ni OS suspend probados |
| LC-18 dos documentos | FAIL aceptación | Harness real ejecutado, muestra LC13; no E2E POS |
| LC-19 sin BC | PENDING | No ejecutado |
| LC-20 offline | PASS focal | navigator.onLine=false, proveedor sintético sin red; transporte Supabase físico no probado |

## 11. Tests, navegador y regresiones

Comando focal: `npx vitest run src/services/auth/__tests__/actorLateContext.integration.test.js src/services/auth/__tests__/actorScopedStorage.test.js --maxWorkers=1`.

Resultado: **2 archivos, 11 tests PASS únicos**. No se suma la reproducción roja del baseline ni reejecuciones. Incluye diez tests existentes de storage: carts Admin/Staff y tenant, namespace opaco, no atribución de legacy, filtrado de ventas compartidas, payload inválido y handles retirados/foreign context. No equivale a la suite completa tenant/actor/finanzas.

Chromium real **143.0.7499.0** ejecutado headless vía Playwright y binario aislado. Dos ensayos de evento tardío: baseline FAIL y focal PASS. Tres ensayos LC13: FAIL. Son cinco observaciones, no cinco PASS. Se usa un BrowserContext por ensayo, con dos páginas compartiendo origen/storage para LC13; no dos perfiles aislados que impedirían compartir storage. Dependencias del runner fuera del package.json del producto.

ESLint focal de ambos archivos de producto, integración y runner: **PASS**. Aviso baseline-browser-mapping externo sin actualizar dependencias. `git diff --check`: PASS. Salidas textuales completas y JSON: `LANZO.ACTOR.SCOPED.STORAGE.LATE.CONTEXT.EVIDENCE.R1.md`.

Suites completas controller/bridge/handoff/Admin offline/Admin-Staff/revocación/device/tenant/Dexie/outbox/checkout/procesamiento de ventas/idempotencia/sync/SW/startup recovery: **NO EJECUTADAS después del HOLD**. No se atribuye un resultado financiero a la ausencia de diff comercial. No hay evidencia de doble cobro o pérdida comercial en estos fixtures; tampoco se certifica que estén descartados por esta ejecución.

## 12. Build, PR127, CI y publicación

Build producción, postbuild PWA, manifests y comparación PR127 Base/Candidate: **NO EJECUTADOS por condición de detención**. No se reutilizan recuentos históricos. Shared Terminal Actor Runtime, Actor Scoped Storage y HOTFIX Dexie Recovery: **NO EJECUTADOS para esta candidata**. No se declara CI verde.

PR: **NO CREADO**. Preview: **NO PUBLICADA**. Merge: **NOT PERFORMED**. La consulta Vercel de la rama después de los primeros checkpoints devolvió cero despliegues; se vuelve a comprobar al cierre. Ninguna Preview anterior se presenta como la de este HEAD.

Las configuraciones raíz y store añaden exclusivamente `git.deploymentEnabled` false para esta rama. Es una excepción de frontera justificada antes de editar: permite cumplir checkpoints remotos sin desplegar código inseguro. No se cambian ajustes de producción ni rutas. Debe revisarse antes de una futura entrega; no se habilitará Preview mientras siga el HOLD. Referencia: [Vercel Git Configuration](https://vercel.com/docs/project-configuration/git-configuration).

## 13. Checkpoints persistentes

| Etapa | Commit remoto | Árbol verificado | Estado |
| --- | --- | --- | --- |
| Preparación | `34116673cea8bb2ae4ab081d8ed6e386196c2c22` | `9a9af344ef37d7a580f4f3563cdcbe14406203d9` | Configuración de no despliegue y nota |
| A | `b9e6bb7ac7df0a1ea13325b8c6590e8a525192e6` | `86624737a1ed49f98d784237a15212562596bf0e` | Reproducción roja preservada |
| B | `8867fd00f6241cfced326a198e3d32617953c9d3` | `eb180168866f7d077b247a4b5e1c056268f518f1` | Fix focal no certificado |
| C | `de931651532ba4b99338e6f682f885cc9a26d1f8` | `abe7dbca28c1d82e66f96fd3cf7246a268f9257a` | Evidencia crítica FAIL, regresiones ampliadas pendientes |
| D | Commit que contiene este informe, SHA entregado al cierre | Verificado contra índice Git y GitHub al guardar | Cierre HOLD; NO candidata final aprobada |

Se crearon árboles/commits mediante GitHub y se avanzó la referencia con expected_sha. Se verificó cada referencia remotamente y los árboles locales contra los remotos; no son commits exclusivamente locales. Los predecesores siguen alcanzables desde la rama, incluso si scratch desaparece. Test, fuentes focales, runner, evidencia, checkpoints e informe están incluidos en Git. No hay secretos ni datos reales en los fixtures.

Recuperación: clonar el repositorio y hacer checkout de `fix/actor-scoped-storage-stale-events-r1`, o del SHA específico A/B/C/D registrado. A permite repetir baseline rojo con fuentes de producto main. B/C conservan el arreglo parcial, no son una autorización de despliegue.

## 14. Alcance, riesgos y PR #338/#352

Producto modificado: sólo actorScopedStorage y actorSessionRuntimeBridge. Nuevos: un test de integración focal, un runner de navegador, notas/evidencia/informe. Excepción justificada: dos configuraciones Vercel para desactivar despliegue de la rama. No se modifican useSingleInstance, main.jsx, UI F-02, Service Worker, política de 168 horas, Staff online-only, cálculos, ventas, repositorios financieros, RPC ni RLS.

Riesgos abiertos: LC13 confirmado, convivencia v1 no certificable con el fix focal, matriz incompleta, falta de regresión financiera/build/CI, posibles casos de reentrancia y almacenamiento inaccesible pendientes. El handler sólo prueba correspondencia en el momento de su lectura; los asserts posteriores siguen siendo necesarios. No se afirma exclusividad financiera entre pestañas ni atomicidad de una lectura y posterior write.

#338/#352 no fueron incorporados ni editados. No se ejecutó integración/merge de sus ramas con este checkpoint. Sus áreas de Actor Runtime/handoff/finanzas exigirán una revisión aparte cuando haya contrato aprobado; no se certifica compatibilidad sólo porque este diff sea pequeño.

## 15. Supabase, migraciones y QA físico

`MIGRATIONS_CREATED = NONE`, `MIGRATIONS_APPLIED = NONE`, `PRODUCTION_SQL_WRITES = NONE`, `PRODUCTION_DATA_WRITES = NONE`. No se realizaron DDL, DML, consultas a filas de negocio, cambio de sesión/licencia/dispositivo, registro o liberación de dispositivo. No se solicita una migración para esta fase.

Todos los casos siguientes permanecen **PENDING**, sin ejecutar contra producción ni una Preview insegura:

| QA | Acción futura en Chrome/Edge, cuando se levante HOLD |
| --- | --- |
| QA-LC-01 | Login Admin normal |
| QA-LC-02 | Logout y nuevo login legítimo |
| QA-LC-03 | Cambiar de pestaña y regresar |
| QA-LC-04 | Bloquear Windows y reanudar |
| QA-LC-05 | Offline con evidencia válida |
| QA-LC-06 | Reconectar y comprobar continuidad |
| QA-LC-07 | Verificar ventas, productos y caja intactos |
| QA-LC-08 | Nuevo login sin falso bloqueo por evento antiguo |
| QA-LC-09 | Ausencia de dos instancias financieras indebidas |
| QA-LC-10 | Laptop y pantalla móvil |

También pendientes Chrome/Edge físicos, PWA instalada, suspensión/hibernación, documento descartado y HTTP/LAN. No cambiar reloj real ni datos/fechas de producción para ensayar vencimientos. No se registran dispositivos automáticamente.

## 16. Recomendación de integración

**No integrar ni desplegar este checkpoint.** Revisar primero el contrato de invalidación dirigida/atómica y la transición de escritores v1. Conservar los dos defectos como pruebas de aceptación: EXP14 ya pasa con el fix focal; LC13 debe pasar también en convivencia antes de certificar. Después ejecutar toda la matriz, regresiones, build/PWA y CI sobre main vigente antes de crear un PR Draft independiente.

Se termina esta mini-fase en HOLD con trabajo recuperable. F-01 y F-02 no se inician. Se espera revisión del propietario.
