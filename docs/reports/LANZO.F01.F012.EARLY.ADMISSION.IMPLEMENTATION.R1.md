# LANZO POS — F01-2 — EARLY ADMISSION / RESTRICTED RECOVERY R1

Fecha: 23 de octubre de 2026, America/Mexico_City.

**HOLD_RECOVERY_INTEGRATION. La integración comercial NO está implementada ni activada.** Se detuvo antes de modificar el arranque conforme a las cláusulas de detención de las etapas D y de la instrucción final del encargo. Este informe de implementación registra una fase detenida, no una entrega READY_FOR_OWNER_QA.

## Identidad y alcance de la entrega

| Campo | Valor |
| --- | --- |
| Repositorio | fdxruli/Lanzo-POS |
| Main inicial | 52bb573e651529b323b6617e3161cd76ece14a39 |
| PR base obligatorio | #372, OPEN / Draft / sin merge |
| HEAD base exacto | f1d69093ffe3ad180752773c178b7fbaefd92ce1 |
| Rama nueva | feat/f01-early-admission-recovery-r1 |
| Base del nuevo PR Draft | feat/f01-single-instance-coordinator-r1 |
| HEAD candidato / PR / Preview | Registro exacto en el cuerpo del PR y en remote-publication.json al cierre; no hash autorreferente en este archivo |
| Producto modificado | NO; 2.059 archivos comerciales/configuración/workflows conservan blobs frente a #372 |
| Delta exclusivo F01-2 | Estos dos informes y scripts/qa/single-instance-f012/ |
| F01-1 heredada | Coordinador inerte, sus tres fuentes, tests, laboratorio e informes, sin cambios |
| Merge / Production deploy | NOT PERFORMED / NOT PERFORMED |

Clon aislado y rama nueva creados desde el HEAD exacto verificado. No se encontraron AGENTS.md aplicables. No se modificó otra copia de trabajo. Se creó un worktree detached propio del mismo SHA para diferencial; sus dependencias usan la instalación de la candidata sin modificar el lockfile. No Docker. GitHub conectado se usa para publicar sólo la rama nueva; no se actualiza #372 ni main. La rama remota nueva se crea fijada al SHA, no siguiendo una base móvil.

Se consultaron los seis informes F01 Audit/Evidence, Design/Evidence y F01-0 Decisions/Evidence identificados, y los dos F01-1 del repositorio. Sus resultados históricos no cuentan como ejecuciones nuevas. Los checkpoints locales de investigación no se presumen publicados. Los antecedentes proponían una recuperación componible; no acreditaban el drenaje de los transportes comerciales actuales.

## Bloqueo reproducido y decisión

La promesa retornada por `withFinancialTimeout` es una carrera entre operación y timer. Su rechazo no detiene ni expone la finalización de la operación original. Por ello el settlement de `recoverFinancialIntent` o del ledger no acredita que terminó un RPC ya iniciado. `runExecutor` drena exactamente las promesas que se le registran; no descubre trabajo oculto por otras promesas.

1. **CE-RECOVERY-04:** ledger/recovery reales, Dexie real sobre fake-indexeddb y transporte sintético. Un PREPARED sin intentos obtiene receipt NOT_FOUND y realiza su primer dispatch legítimo. Se conserva el timeout real de 35.000 ms, sin reloj ni timers simulados; lease existente configurable de 120.000 ms para aislar la prueba de la expiración. A los 35.032 ms la promesa de recuperación rechazó, la fila quedó PENDING_RECEIPT con un intento y lease liberado, y el transporte seguía activo. Su siguiente receipt PROCESSING no autorizó otro envío.
2. **CE-DRAIN-02:** la ruta real `executeNewFinancialIntent`, con override de timeout de 30 ms explícitamente permitido, presenta la misma diferencia. Resolver tarde el transporte no cambia artificialmente la fila a éxito. Recovery receipt-first posterior completa con el receipt y conserva ID, K, hash y origen; executeCount permanece 1.
3. **CE-NATIVE-DRAIN-03:** Chromium y Web Locks nativos, coordinador y timeout reales. En la composición ingenua que registra sólo la promesa pública, pendingExecutors llega a 0 mientras nativeActive=1. La liberación voluntaria permite que B adquiera mientras esa tarea sintética sigue activa en A. **COUNTEREXAMPLE**, no aprobación de seguridad ni doble venta demostrada.
4. Control **RAW-TRACKING-PROPOSAL:** registrar además la promesa subyacente conserva A en QUIESCING y B en SECONDARY hasta resolverla. Sólo demuestra el mecanismo del laboratorio: las API financieras actuales no entregan esa referencia al orquestador.

No se atribuye un defecto al coordinador F01-1 por drenar únicamente las tareas declaradas ni se modifica su contrato. Tampoco se declara defectuosa la política receipt-first: conserva correctamente la ambigüedad y no reenvía. La garantía refutada es que envolver la promesa pública baste para cumplir el drenaje solicitado en F01-2.

**Motivo del HOLD:** activar la integración con ese supuesto incumpliría el requisito de no liberar mientras continúan ejecutores propios críticos. Exponer/registrar lifetimes subyacentes obliga a entrar en timeout/ledger/recovery y sus callers, con validación específica de cada fase. No se improvisa ese cambio transversal junto con autenticación y bootstrap ni se elimina el timeout para conseguir una prueba verde. Es una decisión conservadora de integración basada en evidencia, no una prueba de imposibilidad de implementar F01-2.

Retener el lock hasta la terminación del documento es otra alternativa que puede evitar liberaciones voluntarias posteriores a imports comerciales. No cancela un commit remoto ni acredita inventario/recovery. Requiere definir y probar explícitamente qué salidas quedan prohibidas; no se presenta como equivalente ya implementado al contrato completo de drenaje pedido. Cierre/crash siempre puede liberar el recurso sin detener trabajo aceptado por un servidor: la recuperación receipt-first sigue siendo necesaria bajo cualquier opción.

## Frontera de arranque real, anterior y posterior

El grafo no cambia: 87 archivos locales estáticos desde main y 866 recorriendo imports dinámicos literales; no incluye internals npm ni imports no literales. No representa un orden total ESM ante ciclos.

| Frontera actual | Efecto / consecuencia |
| --- | --- |
| main → recoveryContext → actorRuntimeController | Singleton Runtime alcanzable antes del cuerpo de main |
| main → recoveryContext → tenantRuntimeRouter → tenantScopedStorage → actorScopedStorage | Almacenamiento/listeners/canales alcanzables antes de admisión; instanciar Dexie no equivale a abrir siempre una DB |
| main → imports dinámicos databaseRuntime / PosApplicationBootstrap | Promise.all no impone la serialización que sugiere el comentario |
| PosApplicationBootstrap → READY DB → activatePosReadyRuntime | Inicializa guard tenant, importa App/stores, activa coordinadores antes del montaje de App |
| runtime.activate → startPosSyncAutoBootstrap | Instala recovery general con reacción a GRANTED/online |
| App → initializeApp / autoheal / licencia / notificaciones / F-02 | Sus efectos actuales no constituyen una barrera restringida |
| initializeApp | Prepara tenant/DB, verifica sesión, restaura actor y continúa a perfil/validación de fondo |

**CE-BOOT-01:** bootstrap de licencia real con proveedores sintéticos devuelve ready mientras dos validaciones de fondo siguen pendientes después de dos invocaciones secuenciales. Dos invocaciones concurrentes sí comparten promesa; una nueva después del settlement vuelve a restaurar. Por tanto una preparación previa seguida de App sin adaptar duplicaría restore. No se atribuye esta prueba a autorización Staff real ni a un bug nuevo.

Minimal Entry: NO IMPLEMENTADA. Admitted Entry: NO IMPLEMENTADA. Shell secundario: NO IMPLEMENTADO. No se añade un gate parcial que importe negocio antes de adquirir ni un gate que bloquee permanentemente todos los accesos. El coordinador conserva su nombre estable e inactividad en el producto. La tienda pública y la entrada independiente Store no cambian.

## Contratos de recuperación y activación

| Área | Estado real de esta entrega |
| --- | --- |
| Admisión / tickets | F01-1 intacta; composición de laboratorio con Web Locks nativo; sin wiring productivo |
| COORDINATION_HELD / RECOVERY_RESTRICTED / COMMERCIAL_READY | Separación requerida documentada; no máquina comercial implementada |
| Bootstrap restringido | No se reutiliza initializeApp como si fuera restringido; requiere separación explícita de completion/background |
| Admin | Verificación existente, autorización offline y plazo máximo 168h preservados; no restore directo desde cache ni bridge aislado |
| Staff | Online-only preservado; los proveedores sintéticos no acreditan autenticación online |
| Tenant / DB | Contratos/generaciones/hidratación y apertura intactos; nuevo inventario tenant no implementado |
| Financial Intent | Ledger/recovery/hash/leases reales ensayados con transporte sintético; políticas intactas |
| Receipts | PROCESSING mantiene pendiente; COMPLETED posterior confirma sin segundo envío; no se inventa resultado |
| Inventario | CE-INVENTORY-01: 63 filas persistidas, consulta habitual retorna 50; excluye BLOCKED, CONFLICT, otro actor y diez filas por cap. No es inventario completo |
| Paginación estable | Requerida por tenant/tabla con claves estables y barrera de generación; NO IMPLEMENTADA. No usar offset sobre una lista mutable para certificar ausencia |
| Handoff / checkout | Origen y bloqueos preservados; suites existentes ejecutadas; no nueva ruta que transfiera ownership ni borre pendientes |
| Outbox | Sin flush en laboratorio nuevo, sin modificación de filas/reglas productivas; suites de origen/tenant incluidas en regresión |
| Proyecciones | No se sustituye un handler comercial por éxito ficticio; no se certifica proyección E2E |
| Sync / autoheal | Producto intacto; no se presenta su secuencia actual como barrera nueva |
| Efectos asíncronos / drain | Diferencia public/native reproducida; falta contrato de lifecycle subyacente para integración |
| Montaje App / StrictMode | No cambia; fundación reejecutada cubre singleton/StrictMode sintético, no App bajo gate productivo |
| SW / actualizaciones | Sin registro nuevo, force update, limpieza o cambios de guard; suites/builds/precache existentes verificados |

PREPARED sin intentos conserva su primer dispatch legítimo; PREPARED con intentos, DISPATCHING, PENDING_RECEIPT y PROCESSING no adquieren permiso de reenvío por coordinación. COMPLETED conserva identidad/proyección aplicable. BLOCKED/CONFLICT mantienen intervención existente. Receipt inaccesible no crea K nueva. Una fila outbox pendiente por sí sola no justifica bloqueo global perpetuo. Esos contratos continúan vigentes; no se afirma haberlos integrado en una barrera nueva.

## Alternativa de menor riesgo, propuesta concreta para revisión

Preparar primero un alcance focal de **lifetime de ejecutores**, sin activar el gate ni cambiar las decisiones financieras:

1. En financialTimeout y sus callers, separar observación pública con timeout de finalización subyacente. Registrar la tarea antes de iniciarla; completar su registro únicamente al terminar esa tarea. Registrar fallos también sin crear unhandled rejections.
2. Mantener exactamente timeout, errores ambiguos, receipts, leases, K/hash/origen y firmas de autoridad. La espera de UI no debe convertirse en una espera indefinida sólo por observar lifecycle.
3. Comprobar dispatch y receipt; preflight nativo/DB, import ESM, proyección, handoff y outbox deben declarar sus límites propios. Una promesa que jamás termina no permite timeout de drenaje que ceda acceso.
4. Probar timeout antes/después de respuesta, rechazo tardío, operación que continúa tras cancelación, pérdida de ticket/actor/tenant, leases y cleanup. El control Chromium debe conservar lock hasta finalización observada; crash debe seguir receipt-first.
5. Después, separar initializeApp en preparación/autorización y completion explícitas, incluir sus rutas de reautenticación/onboarding y evitar segunda restauración. Sólo entonces activar entrada mínima, inventario paginado y servicios comerciales.

Esto no solicita M-03, Authority v2, SQL ni un rediseño de la matemática financiera. El contrato de lifecycle debe revisarse antes de aplicarlo a las rutas financieras. Esta entrega deja la alternativa documentada y reproducible; no autoriza a sí misma cambios adicionales ni declara garantizada su cobertura universal.

## UX, LAN, legacy y seguridad

No hay shell nuevo que pueda revisarse visualmente. Queda especificado: 320/360/375/390px, tablet/escritorio, horizontal, zoom, teclado, safe-area, scroll y lectores de pantalla; sin navbar comercial, botones mínimo 44px, foco visible y estados anunciados. Preparando/esperando/otra ventana/recuperando/pendiente/coordinación no disponible deben tener acciones reales; nunca forzar acceso, borrar datos, liberar dispositivos o reenviar cobros. QA visual: NOT_TESTED, no PASS por especificación.

M-01 y F-02 mantienen fuentes y regresiones; no se extienden garantías a callbacks no cercados. LC13 sigue OPEN. Admin offline máximo 168h y Staff online-only intactos. HTTP LAN actual sigue funcionando conforme al producto existente porque no se activó el gate. La futura integración exige Web Locks/contexto seguro; HTTP por IP quedaría restringido. Preview HTTPS es la ruta principal de QA futura; HTTPS LAN y certificados requieren configuración/autorización separadas. No se instalaron certificados ni se cambiaron políticas del navegador.

Legacy no toma el nuevo lock; PWA/SW anterior puede ejecutar JS anterior. El contraejemplo F011 legacy permanece COUNTEREXAMPLE. Otros navegadores/perfiles/orígenes tienen arbitraje independiente. No se certifica exclusión universal, no hay fallback BC-only ni cambio de backend en caliente, steal o takeover por timeout. No se responde indiscriminadamente al hook viejo.

## Git, PR abiertos y CI

#338 fef7205f76b173025f503e60d0968f446f741e78: bridge/controller/handoff/finanzas. #352 d758f69b2119f1bc346eb0ac86ba0a74c0265668, apilado sobre #338: SW/restaurante/autoridad. #368 a7eb0932906df4348610f275f0f1d4b9180f43cc: lifecycle/leadership Ecommerce. #370 b31bbd80bf398d956890debced5b20de7b0c928d: crédito/autoheal/repositorios. #371 2f33cea480f3d478f797b495b168feac9aed483f, sobre #370: ledger/outbox/orquestador. Inventarios completos en remote-preflight.json. No se fusionan ni se importan sus cambios; sus cuerpos pueden citar SHA viejos, prevalece head_sha.

Sin fuente comercial modificada no hay conflicto textual introducido aquí, pero eso no certifica compatibilidad futura de contratos. Revalidar todos estos HEAD antes de retomar. No modificar rama/base del stack si cambia #372 sin una nueva revisión.

PR127, Actor Runtime, Actor Scoped Storage y Dexie tienen filtros de rama/path: esta rama apilada con sólo docs/scripts no debe presentarlos como PASS si no se disparan. Su estado exacto se consulta al cierre. No se modifica un workflow para simular certificación. El workflow SQL de producción es workflow_dispatch separado; no se invoca. Una Preview automática del Draft, si se genera, conserva la aplicación antigua: no sirve para QA del gate ausente.

## Validación, rollout y rollback

Evidencia nueva: cinco tests de probes PASS como assertions de reproducción (sus garantías refutadas siguen COUNTEREXAMPLE); 45/45 unitarios F01-1; Chromium nuevo 1 COUNTEREXAMPLE + 1 control PASS; fundación 38 PASS / 1 COUNTEREXAMPLE / 1 PARTIAL, cero pageerrors. Diferencial nuevo base/candidata 831 por lado: 827 PASS y mismos cuatro FAIL históricos; cero nuevas diferencias en estados o primer mensaje de fallo. No se suman repeticiones ni observaciones Chromium como tests únicos.

Build Production, Preview, Store y Store Vercel ejecutados; postbuild verifica 24/32 assets administrativos respectivamente, sin faltantes. coreLocalRouteAssets=[] es el retorno literal del auditor actual, no prueba de navegación offline completa. Auditor adicional busca marcadores F011/F012: no fixtures en bundles/precache. Lint focal sin errores de código; aviso heredado de baseline-browser-mapping. El informe Evidence conserva comandos, resultados brutos, hashes y las 55 filas NOT_TESTED de integración.

Rollout actual: mantener HOLD; no hay gate nuevo que desplegar comercialmente. Rollout futuro: identificar cohortes/build y resolver pendientes con identidad original antes de finalizar legítimamente documentos viejos; conservar assets offline; QA sintética, luego Preview y QA física antes de considerar merge. Ningún flag debe saltarse admisión ni activar BC-only. La observación de ausencia legacy nunca equivale a prueba universal.

Rollback de esta entrega: retirar únicamente los archivos aditivos de docs y laboratorio en la rama propia; la aplicación es idéntica. No hay esquema/datos que revertir. Rollback futuro de una integración activa: detener tareas nuevas y drenar tareas propias observables antes de release; preservar intents/receipts/outbox/checkout, claves e identidades. Resultado remoto incierto exige receipt-first, no limpieza ni retry con K nueva. Revertir código no termina documentos abiertos. Volver al hook anterior restaura sus defectos de bloqueo mutuo y sus límites de instancia única. Probar ese procedimiento en perfiles sintéticos antes de proponer merge.

## Estado final

**HOLD_RECOVERY_INTEGRATION; no READY_FOR_OWNER_QA.** Próximo paso recomendado: revisión del contrato de lifetime propuesto y de los contraejemplos, antes de retomar la separación del bootstrap y activar F01-2. La QA manual del gate todavía no procede; su matriz se entrega preparada para la implementación futura.

Supabase production writes: NONE. Llamadas Supabase reales: NONE. Migraciones: NONE. Operaciones financieras reales: NONE. Licencias/dispositivos modificados: NO. IndexedDB del propietario usado/borrado: NO. Main modificado: NO. PR #372 modificado: NO. Merge: NOT PERFORMED.
