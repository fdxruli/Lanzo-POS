# LANZO POS — FASE 3.2A.4 — SUPERVISED TRANSITION PILOT

Fecha: **21 de octubre de 2026, America/Mexico_City**.

**Estado general: ADMISSION_UNPROVEN. Arquitectura D.** La hipótesis de gestión parcial mediante distribución queda refutada en el laboratorio. No se construyó una frontera de gestión completa que permita declarar PILOT_PASS_SCOPED. Esta limitación no demuestra que una solución gestionada sea imposible.

## 1. Resumen ejecutivo

Se ejecutó un piloto reproducible con Chromium real, el módulo legacy exacto de main, el prototipo de investigación y datos completamente sintéticos. Se ensayaron dos dominios efectivos —sin gestión y con distribución parcialmente restringida— y se registró la ausencia de enforcement completo como **MANAGED_ENFORCEMENT_NOT_AVAILABLE**.

Los resultados separan las dos propiedades exigidas. **P1:** la entrada protegida experimental deniega escrituras sin admisión y no agrega efectos; esto se verificó en los casos legacy activo/congelado. No certifica la integración de permisos de Actor Runtime comercial. **P2:** los controles parciales no retiran al legacy: puede escribir después de thaw, volver a entrar tras cierre voluntario, ejecutar código cacheado aunque el servidor niegue descargarlo y reabrir el esquema sintético con Dexie 4.4.3. Proteger la fila v2 tampoco retira al writer anterior.

Resultado final de navegador: **20 casos T3: 3 PASS acotados, 12 FAIL de hipótesis de seguridad y 5 PENDING**. Además, cuatro observaciones de capacidades PASS y un dominio completamente gestionado UNPROVEN. Total del JSON: **7 PASS / 12 FAIL / 5 PENDING / 1 UNPROVEN**, sin errores de harness. No sumar los FAIL como garantías aprobadas.

Finanzas sintéticas: **9 FIN-T3 PASS y 1 PENDING**, más nueve fixtures de tipos de datos y diez comprobaciones del modelo de contención, todos favorables: **28 PASS / 1 PENDING**. Los **42 tests heredados** de prototipo/admisión se repitieron y pasaron; incluyen cinco detecciones de contraejemplos. No son las 71 pruebas históricas de integración Runtime ni pruebas comerciales de ventas.

**Recomendación:** no desplegar Authority v2. La siguiente decisión es si se investigará una instalación administrada con control externo permanente de ejecución/almacenamiento, o se mantendrá el alcance web sin conceder admisión v2. Un checklist voluntario, un worker nuevo, una versión de esquema o una flag no sustituyen ese control.

## 2. Main, ramas y recuperación

Main verificado inicialmente: `f48aab53634663438a06dc5187fa7e6d17b74fb3`, árbol `19f238828452198226159303bb24dfd832a53416`. Checkpoint anterior remoto: `c6d5e56afdbdb0e2d59dc479bdd5ada94d418f61`, árbol `f79b36e7f191a33b440dfb642e0fc1296652e882`. La referencia remota anterior se consultó y coincidió.

Rama nueva: `research/authority-v2-supervised-transition-r1`. No se modificó main ni las ramas restaurante. No había un checkout de esta tarea con cambios ajenos. El clon completo no se obtuvo: GitHub directo no terminó y el proxy Git no proporcionó un namespace utilizable. Se recuperaron el árbol remoto y los blobs inmutables necesarios mediante GitHub API. **No se presenta este directorio parcial como un clon completo.** Diecinueve blobs recuperados fueron verificados byte a byte contra sus hashes Git; no apareció AGENTS.md en el árbol remoto.

La recuperación inicial mediante parche añadió una línea final a algunos archivos locales. Se detectó antes de aceptar integridad; el hash del legacy impidió la primera ejecución. Se restauraron los bytes exactos. El primer ensayo completo utilizó una línea final adicional en los modelos heredados, registrada como límite de R2; la ejecución final usa los blobs exactos. No se cambiaron sus algoritmos.

## 3. Checkpoints remotos

| Etapa | Commit remoto | Contenido |
| --- | --- | --- |
| R0 | `f4528fbe890456402a4fc9b40a7fb03685936507` | Baseline, plan y exclusión de despliegues antes de crear la rama |
| R1 | `299d5212b375e617437a9566ab59de9250d6ba61` | Harness de versiones y fixtures aislados |
| R2 | `c1679a8ed711abf522d49f89fc495642150b6665` | Nota de primera ejecución; su JSON se detectó vacío y se restaura íntegro en el cierre R5.1 |
| R3 | `0289757cf4a08acf2ebfe526d9c677b12e566c0f` | Código final de navegador, caché, lifecycle y almacenamiento; snapshots y fuentes |
| R4 | `a92ecf9e048db4b5b3d9a2879b1e4ad8889b0290` | Evaluación, recuperación sintética, tests heredados, verificador y procedencia |
| R5 | `65b3da22862ccf9f8773e966898194684ede3547` | Informe, matriz legible y evidencia de cierre |
| R5.1 | Commit final de reparación; SHA entregado al propietario | Restaura JSON histórico R2 y verifica hashes de todos los artefactos |

R0–R5 se verificaron por Git Commit API, comprobando SHA, árbol y padre. Las referencias se avanzaron con expected_sha, sin force push. La comparación de hashes de R5 detectó un JSON histórico R2 vacío: una lectura asíncrona no había terminado antes de publicarlo. La copia local estaba intacta y se conserva completa en R5.1, sin reescribir la historia ni sumar pruebas nuevas. El commit final se verifica después de crearse; el archivo no intenta contener su propio hash. Todos son alcanzables desde la rama. `evidence/provenance.json` conserva los árboles previos.

## 4. Nueve antecedentes y separación de código

Se recuperaron los nueve informes exigidos. Los cuatro de PWA se leyeron completos de los archivos guardados identificados; los otros cinco, del checkpoint remoto. Los nombres, IDs de origen, hashes Git cuando aplican y límites de extracción están en provenance.json. No se afirman hashes de bytes originales para textos extraídos por el lector de archivos.

| Grupo | Antecedente conservado |
| --- | --- |
| Auditoría PWA 3.1 | F-01 disponibilidad y F-02 snapshot; originalmente revisión de lectura |
| Implementación 3.2 | El mutex nuevo no excluye al hook legacy; B-01 abierto |
| Resolución B-01 | Reinicio, ACK y listas SW no acreditan exclusión; HTTP/IP carece de ciertas APIs seguras |
| F02-only | Evento antiguo puede bloquear una sesión nueva; implementación original no publicada se perdió entonces |
| Late Context Hardening | Fix focal de hints no resuelve LC13: invalidación tardía sobrescribe el contexto posterior |
| Context Invalidation Architecture | D favorable entre participantes; legacy y esquema aislado no bastan |
| Integration/Transition Design | Admisión comercial positiva sin resolver; pendientes y recovery separados |
| Executive | Contener v2 no retira v1; sin activación automática |
| Commit Matrix | 91 rutas y 19 campos; inventario estático, no cobertura v2 ejecutada |

Código comercial: main exacto. Corrección focal heredada: actorScopedStorage, actorSessionRuntimeBridge y test actorLateContext; continúa sin aprobar. Prototipo: scripts/qa/actor-context-contract. Nuevo trabajo: scripts/qa/authority-v2-supervised-transition, estos informes y las dos exclusiones Vercel. **No hay nuevos cambios de src, package/lock, SW comercial o migraciones respecto del checkpoint anterior.**

## 5. Arquitectura D y sus límites

D mantiene head por dominio coordinado, contextos individuales, revocación dirigida y fence en la misma transacción local del efecto. Actor Runtime conserva identidad, permisos, sesión, dispositivo y vencimiento. El prototipo usa una sola DB sintética para authority/contexts/operations/effects. No se añade una segunda autoridad comercial.

Esa garantía exige participantes que atraviesen el fence. T3-14 confirma que un escritor directo a effects, fuera del contrato, puede escribir después de revocar el contexto v2. Es un escritor sintético; no se presenta como un exploit contra ventas de Lanzo.

## 6. Dominio experimental

| Elemento | Valor y alcance |
| --- | --- |
| Máquina/SO | Contenedor de QA de esta tarea, Linux 6.18.55 x86_64; no equipo del propietario |
| Navegador | Chromium 143.0.7499.0 headless, Playwright 1.62.1 |
| Perfil | BrowserContext nuevo por caso; particiones temporales aisladas, sin perfil existente |
| Origen | Puerto aleatorio HTTP 127.0.0.1; localhost; TLS local opcional |
| Instalación | ID `case-N` sintético; no prueba de identidad física o de dispositivo Lanzo |
| Service Worker | Fixture propio /sw.js, cachés synthetic-v1/v2; no Workbox comercial |
| DB | supervised-case-N; esquema Dexie synthetic-dexie-case-N; ninguna DB comercial |
| JavaScript | Legacy exacto, prototipo y cliente de pruebas; hashes SHA-256 en browser.json |
| Procesos controlados | Únicamente los hijos que inicia el harness; no inventario ni allowlist de todo el SO |
| Build antiguo | Disponible inicialmente; el servidor puede negar una descarga, sin retirar memoria/caché previa |
| Restauración | Cierre/reapertura simple probado; sesión desktop, BFCache acreditado y PWA instalada pendientes |
| Administración | Control del harness y fixtures; sin política MDM/GPO/App Control ni guardián de DB obligatorio |

Dos BrowserContexts no son dos perfiles físicos certificados. Demuestran separación de almacenamiento. Dos laptops tampoco comparten automáticamente IndexedDB por usar la misma URL.

## 7. Frontera de confianza y responsabilidades

| Frontera | Control disponible | Evidencia / carencia |
| --- | --- | --- |
| Artefacto legacy | Harness externo al documento | Blob Git verificado antes de servir; no confiar sólo en marcador de versión de UI |
| Procesos/perfiles | Harness, sólo sus hijos | No se controla todo ejecutable, perfil restaurable o PWA del SO |
| Distribución HTTP | Servidor de fixture | 410 observado; caché SW conserva 200 y código ejecutable |
| Memoria de documento | Chromium/CDP | Freeze/thaw real; JS anterior sigue operativo |
| DB física | Navegador IDB | TX serializa participantes; acceso directo no está mediado por v2 |
| Nuevas operaciones v2 | Wrapper de contención experimental | protectedWrite rechaza sin evidencia y conserva snapshot |
| Identidad/permisos | Actor Runtime comercial | No cargado en este piloto; no se reemplaza con el modelo |
| Pending/receipt | Prototipo/modelo de recovery | Origen se conserva; no ejecuta conciliación financiera real |
| Reingreso futuro | Ningún control externo permanente | MANAGED_ENFORCEMENT_NOT_AVAILABLE |

Un hash calculado por el harness acredita los bytes que éste preparó en su laboratorio; no constituye attestation comercial del proceso de un usuario. El marcador MAIN_EXACT_MODULE no es por sí solo evidencia de seguridad.

## 8. Comparación T3-A…T3-E

| Vía | Evaluación | Dictamen |
| --- | --- | --- |
| A: navegador/perfil gestionado | Políticas Chrome/Edge administran ámbitos concretos. No se instalaron ni certificaron políticas en esta ejecución; tampoco se demostró control de otros procesos/perfiles/restores | UNPROVEN para gestión real; no sustituirla por flags de lanzamiento |
| B: distribución administrada | Fixture niega descarga antigua; documento ya cargado y SW cacheado siguen escribiendo | PILOT_FAIL de la gestión parcial ensayada; no refutación de toda distribución administrada posible |
| C: frontera local de ejecución | Requeriría un reference monitor que todos los writers deban cruzar, incluida reapertura y recuperación. IDB del mismo origen permite transacciones que omiten el protocolo | Capacidad nueva propuesta; no existe en Lanzo ni se implementa comercialmente |
| D: dominio nuevo gestionado | DB vacía y nuevo contexto no impiden abrir legacy posteriormente. Hace falta procedencia positiva y control permanente de entrada/restauración | ADMISSION_UNPROVEN |
| E: contención sin admisión | Wrapper v2 deniega; datos y evidencia se conservan; no timeout ni botón que conceda | PASS experimental de contención; transición NO completada |

Las políticas de URL/startup pueden ser componentes de una solución, no la solución completa. La documentación de Edge explicita límites de URLBlocklist frente a cambios dinámicos y ámbitos por perfil; RestoreOnStartup tiene requisitos y plataformas propios. De ello se infiere que no se puede atribuirles control universal de procesos o commits. No se verificaron políticas Windows/Android físicamente.

## 9. Versiones y artefactos

Legacy: main SHA fijado, módulo actorScopedStorage blob `dcc09e7be2fcf2435801302c3199f8592e029edc`. Se ejecutan sus funciones reales de preparar/activar/capturar/assert/setItem/invalidate. No se sustituyen por un mock cooperativo con v2.

Cliente B: prototipo heredado con Runtime sintético. Para refutar una activación insuficiente, `write` fuerza deliberadamente el grant del prototipo sin verificador externo. `protectedWrite` representa la entrada restringida y lo deniega. El grant forzado **jamás** se clasifica ADMISSION_GRANTED comercial.

Dexie instalado y ejecutado: **4.4.3**. fake-indexeddb 6.2.5; Vitest 4.0.14; Node 24.19.0. Tooling Chromium externo al producto: @sparticuz/chromium 143.0.4. Su extracción automática falló por chown; se extrajo en la carpeta sintética con Brotli/tar sin cambiar propietario. No se cambió package.json ni lockfile comercial.

## 10. Control de ejecución, restauración y reingreso

T3-01/02/05/15 muestran writers de storage legacy y del prototipo simultáneamente capaces bajo la hipótesis rechazada de forzar v2. Con la entrada protegida sin verificador, B permanece restringido. Congelar A no lo retira; al reanudar conserva su ruta real de escritura.

T3-18 comprueba 410 del servidor y escritura desde memoria. T3-20 cierra A, prepara B y vuelve a abrir A: el legacy puede escribir de nuevo. No se afirma que se haya completado una transición segura antes de ese reingreso; se refuta que la ausencia puntual baste.

T3-03 y T3-11 permanecen pendientes: no se ejecutó restauración real de documento cerrado ni sesión desktop persistente. T3-08 no observó pageshow.persisted=true; el regreso por historial no se cuenta como BFCache. T3-07 PWA instalada pendiente. Ninguno se sustituye por reload.

## 11. Service Worker

T3-04 instaló un worker real del fixture y pobló CacheStorage. Después de negar descarga en servidor, una página nueva ejecutó el legacy cacheado: servidor 410, respuesta del SW 200, escritura permitida. Esto refuta el bloqueo de distribución aislado, sin afirmar que el worker comercial use exactamente esa política.

T3-09 conserva legacy operativo tras servir una versión nueva del worker. T3-10 intentó update/registro con URL de revisión nueva, pero no acreditó estado waiting. La operación sintética y el handle permanecieron intactos. Resultado **PENDING**, no FAIL de seguridad del producto. FIN-T3-09 también queda pendiente. No se forzó skipWaiting, reload ni limpieza para fabricar el estado.

Fuentes comerciales revisadas: sw.js y adminServiceWorker.js de main; conservan activación explícita y guard de recarga. No se cambiaron. La espera del worker no es un verificador de retiro de JavaScript antiguo.

## 12. IndexedDB y Dexie

T3-12 reproduce el contraejemplo de Dexie 4.4.3: A declara versión 1, B actualiza a 2, la conexión anterior se cierra por versionchange; A reabre y escribe mediante una referencia a tabla capturada. Ambas filas permanecen.

T3-13 conserva deliberadamente la conexión antigua rechazando versionchange. El upgrade queda blocked y A confirma una escritura con su tabla capturada antes de cerrar voluntariamente; después reabre también la versión posterior. Esto muestra la diferencia entre pedir un upgrade y retirar inmediatamente toda escritura. No es un fallo de atomicidad de IndexedDB.

Main conserva esquema Dexie 33 / nativo 330 y su preflight. No se cargó toda esa cadena en el ensayo, por lo que estos casos **no prueban una venta Lanzo que eludió preflight**. Sí refutan la afirmación aislada «incrementar esquema excluye todo código anterior».

## 13. Matriz T3-01…20

La matriz completa con condición inicial, expected/actual, control, perfil, versión, snapshots y límites está en el [informe de evidencia](LANZO.AUTHORITY.V2.SUPERVISED.TRANSITION.EVIDENCE.R1.md) y JSON de ejecución. No se agregan reejecuciones a los totales.

Doce FAIL corresponden a hipótesis refutadas: legacy activo/congelado/cacheado/concurrente; worker nuevo insuficiente; reopen y conexión antigua Dexie; writer directo; offline; reactivación legacy; descarga bloqueada con memoria viva y reingreso posterior. Los tres PASS T3 son separación de particiones, protección acotada de B frente a invalidación v1 y contención ante testigo inaccesible.

## 14. Matriz financiera y preservación

Nueve FIN-T3 favorables comprueban el prototipo/modelo: pending bloquea handoff sin adopción; receipt confirmado conserva A; resultado ambiguo no se reenvía; A ausente conserva operación; pérdida de UI no duplica efecto; resultado tardío no se atribuye a B; caja abierta no se cierra; outbox no cambia originActor; admisión no resuelta no modifica datos. FIN-T3-09 waiting permanece pendiente.

Se prepararon nueve clases sintéticas: venta preparada, venta local confirmada, pago en curso, receipt remoto pendiente, outbox confirmado localmente, caja abierta, crédito, apartado y checkout restaurante. Los cuatro estados de actividad incompatibles bloquean; los demás preservan evidencia. Crédito/apartado/caja como metadata aislada no acreditan ausencia de suboperaciones activas: el producto deberá inspeccionarlas. No se implementó un clasificador comercial nuevo.

Un outbox PENDING de efecto local confirmado no se confunde con pago ambiguo ni impone bloqueo eterno por nombre. El prototipo de esta fase representa esa evidencia por separado; no altera el criterio conservador del prototipo heredado para operations pending.

## 15. Conciliación conceptual

1. Autenticar al actor legítimo y comprobar tenant/dispositivo/permiso, sin adoptar la operación del anterior.
2. Leer intent original, K/H, efectos y receipts, conservando su origen.
3. Si está confirmado, proyectar/reimprimir el resultado bajo capacidad específica; no volver a cobrar.
4. Si hay dispatch o receipt ambiguo, conservar y consultar evidencia autoritativa cuando exista acceso; NOT_FOUND tras un intento no autoriza resend automático.
5. Si A no puede volver, clasificar MANUAL_RECONCILIATION_REQUIRED. No existe aquí bypass owner/support.
6. Resolver explícitamente y volver a comprobar pending, admisión y fence; recovery no concede por sí mismo nuevas ventas.

## 16. Política conservadora

Sin prueba externa suficiente, v2 deniega nuevas escrituras protegidas. No deduce autoridad por silencio, timeout, BC, lista SW vacía, bandera local, versión declarada, esquema, navegador nuevo ni DB vacía. Diez ensayos de claims de cliente preservan la restricción del modelo. No son diez ataques a un verificador externo implementado: tal verificador no existe.

Lectura sensible sigue protegida por actor/tenant. Mantener evidencia no significa exponer ventas/clientes a un usuario sin autorización. Los diagnósticos del piloto contienen sólo identidades sintéticas y hashes de artefactos.

## 17. Admisión positiva

No se emite ADMISSION_GRANTED real. Falta probar que todos los writers de una DB física estén obligados a atravesar el control y que ningún artefacto incompatible pueda regresar. Hash de artefacto, control de procesos del harness y flag del cliente no aportan esa prueba para una instalación histórica arbitraria.

Antes de conceder deberán acreditarse conjuntamente: versión realmente ejecutada; instalación/DB/origen; enforcement de cada writer; rechazo del reingreso legacy; pending compatible; Runtime/tenant/permisos vigentes; contrato de commit disponible; preservación sin borrado; recovery definido y revalidación posterior. El piloto sólo ejecuta algunos componentes de esa lista, sin convertirlos en una acreditación completa.

## 18. Local offline y disponibilidad

El fence participante opera localmente y las escrituras sintéticas siguen funcionando con el navegador offline. Esto confirma que un servidor no retira automáticamente una ruta Local antigua. No se usó Supabase como exclusión obligatoria.

La política comercial se mantiene intacta: Admin hasta su vencimiento efectivo, máximo **168 horas**, con sesión/licencia/evidencia/tenant/device y permisos; Staff online-only. Se revisó el módulo real adminOfflineAuthorization; este piloto no autentica ni vuelve a certificar toda esa política. Una futura admisión legítima deberá seguir disponible offline sin renovar plazos por foco o por head durable.

Si desaparece el componente gestor, el comportamiento futuro deberá denegar nuevas capacidades cuando no pueda verificar su frontera, preservando datos. La prueba T3-19 sólo inyecta indisponibilidad en el modelo: no existe un agente real al que se haya cortado energía.

## 19. HTTP, LAN y HTTPS

| Origen de QA | IDB | Seguro | Web Locks | BC | SW | crypto.subtle |
| --- | --- | --- | --- | --- | --- | --- |
| HTTP 127.0.0.1 | Sí | Sí | Sí | Sí | Sí | Sí |
| HTTP localhost | Sí | Sí | Sí | Sí | Sí | Sí |
| HTTP 192.168.250.10 sintético | Sí, DB abierta | No | No | Sí | No | No |
| HTTPS 127.0.0.1 local | Sí | Sí | Sí | Sí | Sí | Sí |

La IP privada se interceptó localmente: no hubo tráfico a una laptop. HTTPS usa TLS real con certificado descartable autofirmado aceptado por el fixture; no valida confianza pública ni del equipo del propietario. No se subió la clave a Git.

No se introduce Web Locks como puerta de entrada. La disponibilidad de getRandomValues del prototipo no certifica las dependencias criptográficas completas de login en HTTP/LAN. Otra laptop, puerto, perfil u origen implica almacenamiento distinto; no se migra automáticamente.

## 20. Riesgos Chrome, Edge, Android y restauración

Sólo Chromium Linux headless tiene evidencia ejecutada. Chrome/Edge Windows, Android/PWA instalada, hibernación, terminación por SO, cuota/evicción, recuperación de perfil y corte eléctrico permanecen sin certificar. CDP freeze es una prueba real de congelación del documento, no de Windows suspend. Una política de startup no cubre por inferencia todos los mecanismos de restauración.

## 21. Compatibilidad con #338 y #352

| PR | Estado/HEAD verificado | Relevancia |
| --- | --- | --- |
| #338 | OPEN/Draft, mergeable=false; `fef7205f76b173025f503e60d0968f446f741e78` | Split monetary/equal/custom, compensación del lock de checkout, settlement, idempotencia y transacciones |
| #352 | OPEN/Draft, mergeable=false; `d758f69b2119f1bc346eb0ac86ba0a74c0265668` | Apilado sobre #338; autoridad Staff por mesa, contrato/versionado cloud, bridge SQL y guardas SW |

Se revisaron los diffs recuperados y los contratos documentados, conservando los SHAs. Sus cuerpos descriptivos históricos no prueban el estado de sus heads actuales. No se hizo merge-tree, integración, rebase ni certificación financiera conjunta.

El Runtime de sus ramas antiguas presenta drift respecto a main con expiración Admin de #366. Una integración futura no puede perder esa política. El bridge SQL de restaurante protege su propio dominio/frames; no prueba admisión universal Local. La compensación de checkout debe seguir dirigida al intento original, sin desbloquear B. Split conserva K/H, cardinalidad y expected version. SW debe preservar pending y no recargar por la fuerza. No se incorporó ni modificó ningún PR.

## 22. UX conceptual Mobile-first

Mensaje base: **«Algunas operaciones permanecen temporalmente restringidas para proteger los datos de este equipo.»**

| Estado | Texto/acción conceptual con respaldo |
| --- | --- |
| Verificando versión | Estado visible y comprobación concreta, sin spinner infinito |
| Transición no acreditada | Datos conservados; ver diagnóstico y volver a verificar evidencia |
| Cliente antiguo detectado | Explicar versión incompatible; no prometer que cerrar una ventana basta |
| Operación pendiente | Verificar resultado/receipt si autorizado; nunca «cobrar de nuevo» por timeout |
| Recuperación disponible | Acción específica para intent/origen, sin grant de ventas nuevas |
| Intervención necesaria | Conservar evidencia y guiar a soporte; sin bypass ni botón inerte |
| Transición completada | Sólo después de evidencia positiva real; no se alcanza en este piloto |

Diseño conceptual, sin UI comercial: contenido legible a 320 px, botones verticales con wrap, targets de al menos 44 px, contraste AA, foco/teclado y aria-live polite; scroll en vertical/horizontal y espacio safe-area/navbar/teclado. Evitar banners permanentes invasivos. No hay QA visual ni declaración de conformidad AA de una interfaz implementada.

## 23. Respaldo integral

La allowlist actual de backupScope se revisó: menu, sales y customers. No es un respaldo integral del sistema. Antes de adopción se requieren ventas/inventario/clientes/caja/movimientos/ledger/intents/receipts/outbox/reservas/apartados/configuración tenant/metadatos de recuperación, más borradores locales y vínculos necesarios.

Definir export consistente por DB/incarnation/esquema y manifest con integridad, origen y estado; probar restore completo en un perfil sintético. No exportar credenciales como una capacidad operativa reusable. El respaldo no debe resucitar un grant durable ni permitir deshacer cobros posteriores mediante snapshot antiguo. No se modificó la función comercial de respaldos.

## 24. Rollback

Rollback conceptual = código compatible de lectura/recuperación y mutaciones restringidas, preservando toda operación posterior. No bajar esquema ni volver a un writer v1 que ignore nuevas reglas. No restaurar un snapshot como si las operaciones confirmadas después nunca hubieran ocurrido. No hay ensayo de rollback comercial ni cambio de esquema real en esta fase.

## 25. Supabase y Vercel

No se hizo ninguna llamada al proyecto Supabase: sin SQL, RPC, lectura de filas, migración, RLS/ACL, licencia o dispositivo. Se revisaron fuentes repo y changelog oficial; el índice Markdown no fue compatible con el lector, por lo que se consultó HTML. No se infiere el estado live de SQL por sus migraciones históricas.

POS y Store Production se consultaron por metadatos: ambos READY, SHA main fijado. IDs: POS `dpl_7E212PvkFiHe2DK8SaiTEn3ANxJ5`, Store `dpl_9NncrioVoguJwZS9LWFNYUAATEoX`. Los archivos vercel.json raíz y store/vercel.json ya contienen la exclusión exacta de esta rama en R0, antes de crear la referencia. Se conserva la de las tres ramas de investigación anteriores. La consulta posterior a R0 devolvió cero deployments de la rama; se repite al cierre. No se leyó ninguna variable secreta ni se publicó Preview.

## 26. Limitaciones y pruebas pendientes

No hay build completo A/B de la aplicación, prueba de permiso financiero real, SQL cloud, venta POS, pago, reconciliación productiva, navegador gestionado con políticas aplicadas, agente local ni control completo del SO. No se reclama certificación financiera por las filas de metadata sintética.

Cinco T3 permanecen pendientes: restauración de documento, PWA instalada, BFCache acreditado, SW waiting y reinicio/restauración desktop. La conservación de pending durante el intento SW es favorable, pero no sustituye acreditar waiting. Las diez claims del modelo son controles de contención, no pruebas de falsificación de un emisor real.

No se ejecutaron build comercial, PR127 ni CI de activación, porque no se crea candidata comercial. Syntax checks, hashes, dos suites heredadas y validador de evidencia son las comprobaciones pertinentes de investigación. No se presentan checks de otras fases como resultados nuevos.

## 27. Respuestas Q1…Q12

| Pregunta | Respuesta |
| --- | --- |
| Q1: componente que impida regreso antiguo | Un control externo permanente y verificable de ejecución/acceso a almacenamiento que cubra todos los writers; no está implementado aquí |
| Q2: ¿existe en navegador? | Existen políticas parciales, no se demostró la frontera completa; requiere gestión/software adicional y prueba del alcance |
| Q3: pestaña congelada | Sí: el módulo legacy ejecutado recuperó su escritura después de thaw |
| Q4: versión real sin autodeclaración | El harness verifica bytes/procedencia de sus módulos; no se creó attestation comercial de procesos arbitrarios |
| Q5: SW o esquema suficientes | No como controles aislados ensayados: caché/memoria y reopen los refutan |
| Q6: retirar todos writers de DB concreta | No demostrado; controlar los hijos del harness no acredita todo el SO ni restauraciones futuras |
| Q7: reentradas fuera de control | Sesión/profile restore, PWA, otros procesos/perfiles y artefactos cacheados/restaurados no cercados |
| Q8: pendientes de A ausente | Preservar origen/K/H/receipt y conciliación manual; no adopción por B ni bypass support |
| Q9: continuidad offline | Tras admisión válida, fence local más Runtime con límite efectivo Admin ≤168h; Staff online-only; nunca red como mutex Local obligatorio |
| Q10: viabilidad como función | Posible línea de investigación para instalaciones administradas; todavía no una función web universal lista para Lanzo |
| Q11: Chrome normal | Contención de v2 y garantías entre participantes compatibles; no retirada universal de legacy |
| Q12: antes de migrar | Enforcement y reingreso acreditados, todas rutas de commit, auth/pending/recovery, respaldo integral/restore/rollback, compatibilidad y QA de plataformas |

## 28. Decisiones pendientes del propietario

Elegir si se invierte en un dominio administrado con software externo y un perímetro soportado explícito. Si se elige, la siguiente investigación debe aportar un verificador positivo real y refutar rutas de reingreso/restauración, no sólo una pantalla o un instalador.

Definir por separado el procedimiento excepcional para actor original inaccesible y si se abrirá un proyecto de fence cloud. Nada de ello queda autorizado ni implementado por esta conclusión. La contención y conservación ya aprobadas se mantienen sin solicitar confirmación otra vez.

## 29. Recomendación de despliegue futuro

**No activar ni publicar Authority v2.** Mantener esta rama como investigación. No promover la corrección focal heredada como solución completa de LC13. No usar las pruebas sintéticas para mergear #338/#352 o para declarar finanzas certificadas.

Para un futuro piloto gestionado, exigir control externo de procesos/artefactos/perfiles/restauración, acceso a la DB sujeto a la misma frontera y revocación persistente del reingreso. Sólo entonces probar simultáneamente P1 y P2 con operaciones pendientes y rollback compatible. Si no existe esa capacidad, el resultado correcto sigue siendo ADMISSION_UNPROVEN, con v2 restringida.

## 30. Fuentes y cierre

Fuentes de implementación: main y checkpoint anterior fijados arriba; hashes y trazas en evidence. Referencias primarias consultadas: [Chrome Page Lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api), [Service Worker lifecycle](https://developer.chrome.com/docs/workbox/service-worker-lifecycle), [Edge URLBlocklist](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/URLBlocklist), [Edge RestoreOnStartup](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/RestoreOnStartup), [gestión de Chrome](https://support.google.com/chrome/a/answer/2657289?hl=en), [Dexie versionchange](https://dexie.org/docs/Dexie/Dexie.on.versionchange), [Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration). Las recomendaciones de arquitectura son inferencias de estas fuentes y de los contraejemplos ejecutados, no capacidades comerciales ya existentes.

Datos del propietario modificados: **NO**. Migraciones: **NONE**. Producción: **SIN CAMBIOS por esta fase**. PR: **NONE**. Preview: **NONE**. Merge: **NOT PERFORMED**. F-01/F-02: **NO INTEGRADOS**.

La investigación termina después de guardar y presentar estos resultados. No se inicia implementación ni activación automática; se espera revisión del propietario.
