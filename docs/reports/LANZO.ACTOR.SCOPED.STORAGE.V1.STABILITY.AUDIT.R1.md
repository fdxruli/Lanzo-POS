# LANZO POS — FASE 3.2A.5 — ACTOR STORAGE V1 STABILITY

Fecha: 21 de octubre de 2026, America/Mexico_City.

**Estado: ARCHITECTURAL_LIMITATION. Mitigaciones experimentales parciales preservadas; sin autorización de publicación comercial.**

## 1. Resultado ejecutivo

Se reprodujeron ambos defectos de main y se recuperó el fix focal remoto exacto. M-01 conserva la sesión nueva frente a notificaciones históricas sin ignorar una sustitución durable vigente. Se añadió M-03 acotada: una invalidación de un binding **ya activado** que observa otro propietario durable se retira localmente y no publica otro `locked` sobre B. Los handles de A siguen rechazando y un logout del propietario vigente sigue publicando `locked`.

Esto mejora dos secuencias concretas, pero **no cierra LC13**. Chromium ejecutó una intercalación nativa donde B activa entre la lectura de A y su escritura: A todavía sobrescribe B. El cleanup anterior a activación continúa con el contrato original y también puede sobrescribir B. Un cliente main antiguo tampoco incorpora la comprobación nueva. La candidata no permite presentar exclusión atómica ni protección financiera integral.

Recomendación: conservar esta rama como evidencia, revisar por separado la conveniencia de un PR exclusivamente M-01 y aceptar expresamente sus límites antes de abrirlo. No incluir automáticamente M-03 en ese futuro PR. Authority v2 permanece pausada; F-01 y F-02 visual siguen fuera del cambio. Ningún fallo conocido se convirtió en PASS por ser esperado.

## 2. Referencias y checkpoints

| Fuente | Referencia verificada |
| --- | --- |
| MAIN_ACTUAL | `f48aab53634663438a06dc5187fa7e6d17b74fb3`, árbol `19f238828452198226159303bb24dfd832a53416` |
| FIX_FOCAL_EXPERIMENTAL | `fix/actor-scoped-storage-stale-events-r1`, `1cdc1cd029982e0279177ab29be1f8fffacb6ed8` |
| PROTOTIPO_AUTHORITY_V2 | `research/authority-v2-supervised-transition-r1`, `67c0a81ca41a2117beefb54f1a2c7f2555b02402`; sólo antecedente, no incorporado |
| NUEVO_TRABAJO_V1 | `audit/actor-scoped-storage-v1-stability-r1`, creada desde main, sin heredar la rama investigativa |
| A remoto | `f7ab095cbb2f874a0b9aa5fbed0195e9dc44a2de`: baseline y reproducciones rojas |
| B remoto | `b2322dc6284d597d3fd2b4759e45c574db2dd9ef`: focal anterior exacto y evaluación |
| C remoto | `93a9d6ef4fed76f964761951230afe50c70ebda1`: M-01/M-03 y contraejemplos |
| D remoto | Commit que contiene este informe y la evidencia final; su SHA se entrega al cierre, sin circularidad de hash propio |

Se clonó el repositorio, sin borrar worktrees existentes. No hay AGENTS.md en el árbol recuperado. Se usó un worktree separado para main exacto. Se compararon refs, blobs y contratos de fuentes; no se reconstruyó el fix desde memoria. Los checkpoints no crean PR ni habilitan Preview. Las configuraciones raíz y Store desactivan exclusivamente el despliegue de esta rama antes de crear su referencia remota.

Main reportó Vercel POS/Store SUCCESS y checks de Pages build/report/deploy SUCCESS. Eso acredita sus estados remotos, no la validación de esta candidata. Sólo permanecen abiertos #338 y #352, ambos Draft. No se modificaron main, los experimentos anteriores ni las ramas restaurante.

## 3. Antecedentes y procedencia

Se recuperaron los once informes del encargo. Los cuatro PWA provienen de los archivos persistentes identificados; los otros siete se extrajeron del checkpoint remoto de investigación. Sus límites siguen vigentes: informes anteriores no son nuevas ejecuciones, un fixture no equivale a un cobro, CDP freeze no es hibernación Windows y un JSON con detecciones favorables no certifica la propiedad refutada.

Los antecedentes PWA identifican F-01/B-01 y F-02; F02-only documenta el falso bloqueo EXP14. Late Context Hardening demuestra que el fix focal no cambia LC13. Context Invalidation Architecture distingue storage de Runtime y refuta read/write como CAS. Integration Design/Executive/Commit Matrix enumeran 91 rutas que necesitaría otra arquitectura; no se modificaron. Supervised Transition Pilot/Evidence conserva ADMISSION_UNPROVEN: no se reanudó esa implementación ni se supone que un despliegue/SW retire clientes antiguos.

El test EXP14 y el runner inicial se recuperaron byte a byte de la rama focal. El nuevo runner carga fuentes main/focal/candidata diferenciadas y registra SHA-256 de los módulos efectivamente servidos.

## 4. Arquitectura v1 y funciones auditadas

Actor Runtime conserva identidad, sesión, dispositivo, tenant, permisos, generación y plazo Admin en memoria. Actor Scoped Storage guarda un único registro v1 por tenant y protege carrito/historial mediante token y binding. Tenant Runtime selecciona la DB física y su generación. Handoff conserva pendientes/checkout. Ninguna de esas capas convierte por sí sola todas las transacciones comerciales en una frontera interdocumento atómica.

Las generaciones son locales: dos documentos legítimamente pueden tener generación igual. BC/StorageEvent notifican; no conceden autoridad. El durable no autentica ni permite reconstruir un handle Runtime desde JSON.

| Función/ruta | Identidad que usa y efectos síncronos | Durable/avisos y tratamiento tardío | Fallo de storage, pendientes y riesgo del cambio |
| --- | --- | --- | --- |
| prepareActorScopedStorage | Recibe tenant/actor/generación; SHA async y assert del ticket; suspende, elimina active y crea pending | Inspecciona legacy, emite prepared; no publica grant | No atribuye legacy; preparación obsoleta debe descartarse. Sin cambio nuevo |
| activateActorScopedStorage | Exige pending coincidente con grant; token nuevo y active suspendido | Publica granted v1, BC best effort, activated | Publicación fallida lanza; bridge conserva su manejo. No prueba exclusión entre grants |
| readContextRecord | Tenant explícito; lectura puntual sin reserva | Parse v1 o null | Ausencia/corrupción/acceso fallido niegan correspondencia; no conceden |
| publishContextRecord | Usa registro proporcionado por caller | setItem y después BC; sin comparación atómica | Es la ventana de LC13; una lectura previa no la elimina |
| handleForeignContext | M-01 captura binding activo, relee durable y compara tenant/token/actor/generación | Hint histórico con durable propio se descarta; discrepancia suspende y emite foreign_context ligado al binding | Missing/corrupt/unreadable falla cerrado. No publica grants ni inicia loops |
| assertActiveContextCurrent | Usa active actual y verifica durable exacto | Relectura antes del acceso protegido; suspende ante discrepancia | Lanza stale; no protege una transacción financiera que no lo llama |
| suspend/resume | Flag singleton local; resume exige correspondencia actual | No publican autoridad | Suspender no equivale a logout ni cierre de caja; resume no renueva sesión |
| invalidateActorScopedStorage | Captura active o pending al entrar, suspende y los elimina antes de I/O | M-03 omite locked si el active token ya no coincide; propietario vigente mantiene publicación; pending conserva conducta anterior | No recibe referencia del caller anterior a un await. Lectura/escritura no atómicas; pending y callers tardíos siguen sin resolver |
| captureActorScopedStorageHandle | Copia inmutable del binding; asserts comparan token/actor/generaciones/tenant | Cada operación relee durable | Handle viejo nunca se transfiere a B; la captura no es una capacidad financiera universal |
| lockActorRuntime | Opera sobre singleton actual; suspende, publica lock Runtime e invalida storage | Sin target histórico del caller | Reentrancia/callers async requieren prueba propia. Sin modificación M-02 global |
| subscriber foreign del bridge | Lee Runtime, comprueba tenant/actor/generación y token del evento | Lock local únicamente; no vuelve a publicar locked durable | getState puede expirar; comparación posterior evita aplicar una decisión para otro binding |
| subscriber expiración Admin | Snapshot locked con reason de expiración; suspende e invalida storage actual | M-03 sólo reduce overwrite extranjero observable de un active | No se rediseña entrega/reentrancia de snapshots ni se extiende plazo |
| set/clear tenant namespace | Singleton de namespace; invalida actor, cambia ready/suspensión | No borra payloads; notifica namespace/cleared | Cleanup tardío no recibe target original. M-03 no certifica todo teardown async |
| tenantRuntimeRouter open/close | Identidad/DB física/generación tenant; cierre defensivo previo al switch | Preflight, hidratación, namespace y aviso tenant | DB conserva datos ante error. No cambia esquema ni abre fallback ajeno |
| grant/restore bridge | Ticket de autenticación y comprobaciones tras awaits; sesión/device canónicos | Handoff, lectura de checkout, preparación, hidratación, grant y activación | Catch viejo comprueba pertenencia antes de invalidar. No se retiró ninguna guarda |
| logout Admin/Staff | Lock Runtime inmediato antes de stopLicenseSync/logout remoto | Finalmente llama lockLocalTenantAccess y teardown | Finally usa estado actual de tenant; no se certifica que no afecte un sucesor. Requiere prueba caller específica, no guard global |
| actorOperationalHandoff | Handles capturados y registros de pending/checkout con origen | guardedWrite vuelve a validar Runtime; persistencia de ownership en SALES | Pending bloquea handoff; no se transfiere ni elimina al invalidar storage |
| useActorRuntimeSnapshot | React observa snapshots; lectura inicial y tras suscripción | No programa vencimiento propio | F-02 visual sigue pendiente; no se cambió el hook |
| licenseMaintenanceActions | Health check puede retornar por readiness/inactividad/offline | En main no fuerza getState antes de esos retornos | No se añadió corrección visual ni renovación remota |

También se revisaron consumidores de login/restauración/licencia, limpieza de tenant, carrito/historial, DB, operaciones financieras y PWA. El inventario reproducible está en evidence. No se sustituyeron 91 rutas financieras ni se mezcló código de Authority v2.

## 5. getState y reentrancia

getState no es una lectura pura: al vencer Admin publica LOCKED, elimina identidad/tenant/permisos y avanza generación. La publicación recorre subscribers síncronos; el bridge puede invalidar durable en ese mismo stack. Un subscriber puede volver a consultar estado. Expirar una vez deja el estado locked y evita un ciclo normal de expiraciones.

EXP14 ejercita expiración real, invalidación, nuevo login y posterior notificación vieja. La comparación del subscriber focal se mantiene después de getState porque esa llamada tiene efectos. No se añadió un coordinador ni se cambió controller/publicación. Reemplazo reentrante arbitrario durante callbacks no queda certificado por una prueba de login posterior: esa garantía permanece pendiente. No se implementó M-04 sin una reproducción de una ruta comercial que justifique alterar ese contrato.

## 6. Reproducciones antes/después

| Ensayo nuevo | Main | Focal anterior exacto | Candidata |
| --- | --- | --- | --- |
| EXP-F02-14 con bridge/controller/evaluador reales en jsdom | FAIL: B pasa de granted a locked con durable B intacto | PASS | PASS; old handles rechazan, sin grant adicional ni incremento espurio |
| Evento antiguo en Chromium | FAIL | PASS | PASS |
| LC13 secuencial, A/B ambos participantes de la versión | FAIL | FAIL | PASS para A activado que observa durable B |
| A main / B candidata | FAIL | No mejora del writer antiguo | FAIL; formato compatible, disponibilidad no garantizada |
| A candidata / B main | No aplica | No mitigación LC13 | PASS secuencial; A no publica sobre B |
| LC13 entre lectura A y escritura A | Sin CAS | Sin CAS | FAIL confirmado con dos documentos y barrera síncrona |
| Cleanup de pending A tras grant B | Conducta original | Conducta original | FAIL en fixture; deliberadamente sin modificar |

No se suman reejecuciones ni resultados históricos. El baseline inicial contiene únicamente el fixture recuperado y reglas de no despliegue; producto main intacto. El runner recuperado llama candidate al working tree incluso en A, donde ambos slots son main; se conserva el JSON original y se explica esa etiqueta.

La carrera nativa nueva usa un getItem instrumentado que conserva la lectura de A y una XHR síncrona hacia el servidor del fixture. Mientras A espera, el servidor pide a B ejecutar su activación real en otro documento. Al volver, A publica locked. Es una intercalación controlada sobre Storage nativo, sin fingir que la escritura es atómica. B se prepara directamente a nivel storage en ese caso: su Runtime no se presenta como autenticado. Los ensayos secuenciales/EXP14 sí cargan Runtime/bridge/handoff reales con proveedores sintéticos.

## 7. Alternativas M-01…05

| Mitigación | Decisión y beneficio | Límite/riesgo |
| --- | --- | --- |
| M-01 relectura durable | Reutilizada exactamente y comprobada antes/después; preserva B ante hints históricos, retira A ante sustitución vigente | Lectura puntual; no CAS ni fence de todo efecto. Cliente main aún interpreta hints como autoridad |
| M-02 invalidación dirigida | NO_SAFE_V1_CHANGE_DEMONSTRATED para aplicar globalmente a los callers async; no se añadió parámetro pretendidamente capturado ni singleton alternativo | Capturar previous al entrar a invalidate no equivale a capturar el contexto al iniciar logout/RPC. Tenant teardown y Runtime lock requieren tratamiento propio |
| M-03 sólo retirada local de active obsoleto | Experimental, acotada a token activado; conserva B en secuencias observables y sigue retirando A | Carrera read/write, cleanup pending, escritor main y finally tardío no resueltos. No incluir automáticamente en futuro PR M-01 |
| M-04 getState | Auditoría y pruebas existentes de expiración; sin rediseño | No certificar reentrancia arbitraria ni F-02 visual |
| M-05 dejar rutas intactas | Se preservan pending cleanup, logout/tenant async y contratos financieros | Conservan riesgos preexistentes documentados; no se ocultan para generar un PR |

M-03 no permite que un handle retirado vuelva a escribir. Si no se puede leer durable, se elimina capacidad local; no se inventa confirmación de revocación durable. Un registro `granted` aislado no concede un handle a otro documento. Esto tampoco demuestra que todos los callbacks Runtime de una instancia ya sustituida se hayan detenido.

## 8. Matriz V1-01…28

PASS en fixture está acotado a las fronteras indicadas, no a la aplicación comercial completa. Las limitaciones detectadas no se agregan a PASS de seguridad.

| ID | Resultado | Evidencia y alcance |
| --- | --- | --- |
| V1-01 sesión nueva mismo Admin | PASS en fixture | EXP14 real jsdom y Chromium |
| V1-02 sustitución vigente otra pestaña | PASS en fixture | replacement-C; B locked, handle storage rechazado; C conserva escritura |
| V1-03 otro Admin | PASS en fixture | B/C de actores distintos; autenticación provista sintéticamente |
| V1-04 tenant | PASS en fixture / integración PENDING | Scoped/Runtime tests existentes ejecutados; app con dos tenants no certificada |
| V1-05 logout tardío | PASS parcial / FAIL residual | LC13 active secuencial pasa; pending/async finally no quedan resueltos |
| V1-06 expiración Admin | PASS en fixture | Controller y EXP14; plazo efectivo, handles previos rechazan |
| V1-07 login posterior | PASS en fixture | Sesión B después de expirar A preservada |
| V1-08 StorageEvent duplicado | PASS en fixture | durable-duplicate, generación y registro conservados |
| V1-09 fuera de orden StorageEvent | PASS en fixture | EXP14 y durable-out-of-order; delivery inyectado |
| V1-10 BC fuera de orden | PASS en fixture | Mensaje nativo desde otro objeto BC, durable reconsultado |
| V1-11 sin BC | PASS en fixture | replacement-C-noBC; StorageEvent real y handles, no exclusividad inferida |
| V1-12 durable ausente | PASS en fixture | Runtime locked y storage write rechazado |
| V1-13 corrupto | PASS en fixture | Mismo cierre seguro; no reconstrucción de grant |
| V1-14 inaccesible | PASS en fixture | Getter denegado durante hint; ninguna capacidad adicional; no quota física |
| V1-15 logout A/grant B concurrentes | FAIL — limitación arquitectónica confirmada | Chromium nativo y Node intercalan B entre lectura/escritura |
| V1-16 grants cercanos | PASS eventual en fixture / atomicidad no demostrada | Dos grants en Promise.all; después de hints sólo un storage handle escribe, pero ambos retornaron granted. No es CAS ni fence financiero |
| V1-17 documento congelado | PASS parcial / FAIL legacy | Freeze CDP A y B; versión main mantiene LC13. No equivale a cierre ni hibernación |
| V1-18 documento antiguo despierta | PASS parcial / FAIL legacy | Cand A no sobrescribe B tras thaw; main A sí. Reingreso arbitrario PENDING |
| V1-19 main/candidata | FAIL de garantía global; formato compatible | A main/B candidata falla; dirección inversa secuencial pasa |
| V1-20 candidata/candidata | PASS secuencial; FAIL concurrente | Tres variantes con freeze pasan; carrera controlada sigue fallando |
| V1-21 Runtime válido/durable distinto | LIMITACIÓN CONFIRMADA | Storage rechaza pero callback Runtime sintético ejecuta 1 efecto antes del hint; no es una venta |
| V1-22 handle viejo tras login | PASS en fixture | EXP14 oldRuntime y oldStorage rechazan |
| V1-23 dispositivo cambia | PASS en fixture / registro real PENDING | Evaluador/Runtime y validación de binding en suites; no se registra/libera dispositivo |
| V1-24 Admin offline elegible | PASS en fixture | EXP14 usa evaluador real offline; política ≤168h intacta |
| V1-25 Staff offline | PASS del evaluador / bootstrap físico PENDING | Variantes Staff y credenciales ambiguas; no se amplía permiso ni se afirma PWA física |
| V1-26 respuesta tardía | PASS en fixture / RPC real PENDING | Bridge rechaza restore viejo sin bloquear actor nuevo; proveedores diferidos, no servidor real |
| V1-27 handoff pendiente | PASS en fixture | Suites reales conservan ownership y rechazan guardedWrite obsoleto; finanzas E2E PENDING |
| V1-28 vencimiento/reanudación | PASS lógica / UI PENDING | getState rechaza vencido; F-02 visual deliberadamente no integrado |

## 9. Chromium y alcance financiero

Chromium **143.0.7499.0**: **29 observaciones**, 17 PASS acotados / 11 FAIL de garantías conservados / 1 detección favorable de limitación Runtime. Cero errores de harness. No sumar esa detección a las garantías aprobadas. La prueba de grants cercanos observa un único handle storage vigente después de entregar hints, pero ambas llamadas pueden haber retornado GRANTED: no prueba CAS de admisión.

Un BrowserContext nuevo por caso, con dos o más páginas del mismo origen cuando corresponde: comparten localStorage y conservan bindings propios. No se usaron dos perfiles separados para simular comunicación. Hay freeze/thaw real vía CDP, BC nativo, StorageEvent nativo para cambios entre documentos y delivery sintético declarado para avisos históricos. Runtime, bridge, scoped storage, tenant storage y handoff son comerciales; tenant readiness, sesión, dispositivo, autorización y SALES vacías son proveedores de fixture. No se accede al origen del propietario, Supabase ni datos comerciales.

La observación V1-21 usa controller/runWithActorHandle reales: un mismatch durable ya impide el write de storage, pero antes de la notificación el Runtime todavía admite un contador sintético. Refuta una certificación financiera basada sólo en estos handles. No demuestra doble venta ni bypass SQL.

Se preservan FIN-01…10: no diff en cálculos/transacciones, originActor, outbox, receipts, caja o retries. Las suites seleccionadas ejercitan repositorios/ledger/recuperación reales con sus fixtures y fake-IDB; no son E2E de caja/pago contra Supabase. Invalidación no confirma, cancela, cierra caja, borra outbox ni transfiere operaciones. `originActor` y resultados ambiguos permanecen bajo sus contratos existentes. No se añadió fencing integral a las ventas.

## 10. Validación y atribución

| Grupo | Resultado nuevo |
| --- | --- |
| Auth/controller/bridge/storage/handoff/tenant/health focal | 260/260 PASS; incluye EXP14 y dos negativas de binding obsoleto |
| Finanzas seleccionadas | 188/188 PASS; hay solapamiento con handoff del grupo anterior: no sumar como total único |
| Dexie Recovery focal del workflow | 127/127 PASS; solapa con otros grupos |
| Arquitectura/PWA/deployment packaging después de builds finales | 33 PASS / 0 FAIL / 50 omitidos; no se cuentan como PASS |
| Node storage | 5 asserts PASS; 2 son detecciones de propiedades FAIL (concurrente y pending) |
| ESLint focal + runner final / diff check | PASS; aviso externo baseline-browser-mapping, sin actualizar dependencias |
| Build Admin + postbuild, Store, Store Vercel | PASS en main y candidata; repetidos al cierre en C; 24 assets de arranque verificados, warning de glob eager también en main |
| Global main, repeticiones 1 y 2 | Cada una: 5612 PASS / 75 FAIL / 52 omitidos / 5739 total |
| Global candidata, repeticiones 1 y 2 | Cada una: 5615 PASS / 75 FAIL / 52 omitidos / 5742 total |
| Diferencial repetido local, comparador sin cambios | 93 observaciones de fallo estables compartidas, 0 nuevas; suite bruta sigue roja |
| PR127 local, herramientas sin cambios | 91 identidades compartidas, 0 candidate-only, 0 nuevas, 0 sin resolver. Sin targets focales: no se inventan 20 repeticiones PASS |
| Workflows remotos Runtime/Scoped/Dexie/PR127 | NOT_DISPATCHED; no se declaran SUCCESS ni se certifican sus gates completos |
| QA Windows/Edge/Android/PWA instalada/LAN y finanzas E2E | PENDING / no ejecutada |

Los comparadores cuentan identidades distintas (93 observaciones repetidas frente a 91 identidades semánticas PR127); no son 93 tests fallidos adicionales. Se normalizaron sólo prefijos absolutos de checkout y dependencias compartidas por symlink, preservando los JSON originales comprimidos. El primer intento conservaba main/pr en tres mensajes file-level y produjo 3 POSSIBLE_PR_REGRESSION por rutas distintas. Se verificó que eran los mismos errores de paquete ausente/archivo sin suite; el diferencial con prefijo común, igual al checkout subject de los workflows, da 0. No se cambió semántica, stack restante, umbral, tiempo ni comparador. La evidencia conserva el diagnóstico inicial.

El primer sondeo global se ejecutó sin todos los builds previos y no se usa como certificación. La comparación final usa main exacto y la misma fuente candidata, con builds Admin/Store/Store Vercel previos y umbrales intactos. No se copiaron recuentos históricos.

Hubo un fallo focal inicial AUTH-25: el mock invocaba `foreign_context` sin identidad/generación/token, campos que el emisor real proporciona. Se actualizó el mock al evento real y se añadieron dos pruebas negativas para generación/token antiguos. El evento vigente sigue bloqueando y los obsoletos no bloquean. No se relajó la aserción ni se ignoró una revocación legítima. Un error de harness de acceso denegado intentaba eliminar el getter nativo; se corrigió restaurando su descriptor y se repitió el navegador. La ejecución final conserva cero errores de harness.

Los workflows remotos Shared Terminal Actor Runtime, Actor Scoped Storage, HOTFIX Dexie Recovery y PR127 no se atribuyen como SUCCESS a esta rama. Sus triggers no se activan con estos checkpoints y no se abrió PR; los conectores disponibles no exponen workflow_dispatch. Las comprobaciones locales y el diferencial se reportan separados. Los contadores no sustituyen los jobs remotos, repeticiones focales obligatorias de cada gate ni QA física.

## 11. Compatibilidad con #338/#352

| PR | HEAD / estado | Contratos y riesgo comprobado por diff |
| --- | --- | --- |
| #338 | `fef7205f76b173025f503e60d0968f446f741e78`, OPEN/Draft, base main | Controller/bridge de rama antigua carecen de autorización Admin extendida y expiración de main; añade diagnósticos y recuperación de autoridad. Handoff incorpora compensación privada del checkout adquirido, sin reenviar cobros. Integración futura debe conservar expiración, binding y origen del intento |
| #352 | `d758f69b2119f1bc346eb0ac86ba0a74c0265668`, OPEN/Draft, apilado sobre #338 | Además retira avance de generación al beginAuthentication y varias comprobaciones de ticket/asíncronas del bridge; prepare no acepta assertCurrent. Mesa/Staff, contrato versionado, SQL bridge y SW tienen fronteras distintas |

Es drift entre ramas, no una regresión ya aplicada a producción. Se leyeron diffs de cuerpos, no sólo nombres. Los contratos de hint y la nueva guarda del subscriber deben combinarse con main, sin recuperar implementaciones viejas del bridge/controller por resolver un conflicto textual. #352 añade cambios a actorScopedStorage.prepare; #338 solapa semánticamente bridge/handoff. El merge/QA financiero conjunto no se ejecutó ni se certifica. No se integraron commits, alteraron PRs ni aplicaron sus migraciones. Sus bodies históricos no sustituyen sus HEAD actuales.

## 12. Producción y preservación

Sin llamadas a Supabase en esta fase. Sin SQL, migraciones, RPC, RLS, licencias, cambios de dispositivo, eliminación de sesiones, datos, cajas o IndexedDB del propietario. Sin operaciones financieras reales. Sin cambio de esquema Dexie, AuthorityHead/ActorContext/OperationalIntent v2, Web Locks obligatorio, coordinador SW, permisos Staff ni modelo de login. F-01/F-02 visual y sus fuentes permanecen intactos.

Consultas Vercel de sólo metadatos confirmaron cero deployments de la rama para POS/Store. La excepción de no despliegue es por rama y no altera rutas ni producción. Los checkpoints sólo preservan la investigación autorizada. La revisión automática inicial de C interpretó equivocadamente la autorización como local; se comprobó la instrucción explícita de checkpoints remotos y se usó una lista limitada de fuentes/fixtures revisados, con ambas exclusiones verificadas. El checkpoint se completó sin PR ni Preview.

## 13. Respuestas R1…R10 y decisión

| Pregunta | Respuesta sustentada |
| --- | --- |
| R1 evitar EXP14 sin debilitar revocaciones | Sí, en las fronteras probadas: relectura preserva B y sustitución vigente sigue bloqueando; no es certificación de toda intercalación |
| R2 reducir LC13 secuencial sin otra carrera | Sí para active cuyo durable ya es extranjero. No hay una nueva concesión; persiste la ventana preexistente read/write y no se promete ausencia de toda carrera |
| R3 qué concurrencia sigue sin garantía | B entre getItem/setItem de A; dos grants sin CAS; pending cleanup; finally tardío dirigido al singleton y reentrancia arbitraria sin target capturado |
| R4 reutilizar focal anterior | Sus dos módulos se recuperaron y pasaron EXP14/revocación actual. Puede revisarse como M-01 parcial, no como cierre de LC13 |
| R5 clientes main antiguos | Mismo durable/canal/formato; A antiguo aún puede sobrescribir B y bloquear por un hint viejo. No se impide ni revoca mágicamente a clientes congelados |
| R6 disponibilidad | Mejora demostrada en EXP14 y LC13 active secuencial de A actualizado. No se midió disponibilidad comercial ni se garantiza continuidad con writer antiguo |
| R7 garantía financiera | Se mantienen guardas/ownership/idempotencia existentes y regresiones seleccionadas; storage no instala fence en cada TX. V1-21 impide exagerar la conclusión |
| R8 PR Draft sólo notificaciones | Conviene revisar esa propuesta acotada, después de atribuir los gates y aceptar expresamente LC13/mixed/pending. No abrir automáticamente ni incluir M-03 por defecto |
| R9 LC13 documentado con v2 pausada | Sí. Mantener test concurrente y pending como defectos abiertos; no llamarlos resueltos por una lectura previa |
| R10 retomar F-02 visual | Puede prepararse separadamente después de revisar el alcance M-01 y los riesgos v1, completar atribución/CI y acordar criterio de integración. F-02 debe preservar plazos/handles y tener QA de resume; esta fase no lo implementa |

**Próxima decisión recomendada:** revisar M-01 como posible entrega independiente de disponibilidad, con LC13 concurrente, pending y writers antiguos expresamente abiertos. Mantener M-03 en evaluación. No reactivar Authority v2 ni modificar las rutas financieras para cerrar esta mini-fase. No abrir PR/Preview ni integrar hasta revisión del propietario.

## 14. Entrega obligatoria

- Estado: **ARCHITECTURAL_LIMITATION**.
- Main HEAD: `f48aab53634663438a06dc5187fa7e6d17b74fb3`.
- Rama: `audit/actor-scoped-storage-v1-stability-r1`.
- Checkpoint remoto: A/B/C arriba; D corresponde a este informe y se identifica en la entrega.
- EXP-F02-14: PASS focal, FAIL main reproducido.
- LC13 secuencial: PASS para active actualizado; pending y A main siguen FAIL.
- LC13 concurrente: FAIL — limitación confirmada.
- Revocación extranjera vigente: PASS en fixture.
- Compatibilidad main/candidata: formato conservado, garantía global FAIL.
- Pruebas: tablas de validación/evidencia; sin certificación financiera E2E.
- Mitigaciones: M-01 y M-03 experimental; M-02/M-04 globales no implementadas.
- PR creado: NO. Preview: NO. Migraciones: NONE.
- Producción: SIN CAMBIOS. Merge: NOT PERFORMED.

Comandos, hashes, logs y JSON: [LANZO.ACTOR.SCOPED.STORAGE.V1.STABILITY.EVIDENCE.R1.md](LANZO.ACTOR.SCOPED.STORAGE.V1.STABILITY.EVIDENCE.R1.md). La fase termina en evidencia y recomendación, sin integración comercial automática.
