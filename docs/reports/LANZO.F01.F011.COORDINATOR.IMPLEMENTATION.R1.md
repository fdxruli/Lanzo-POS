# LANZO POS — F01-1 — DETERMINISTIC INSTANCE COORDINATOR R1

Fecha: 23 de octubre de 2026, America/Mexico_City. Repositorio: `fdxruli/Lanzo-POS`.

**IMPLEMENTED_READY_FOR_OWNER_REVIEW / HOLD_MERGE.** Implementación aditiva del coordinador; inerte en el producto actual. No se integra F01-2 ni se certifica exclusión financiera universal. LC13 permanece abierto. Sólo las instancias compatibles que adquieren el mismo recurso nativo, dentro del mismo ámbito efectivo del navegador, comparten la exclusión.

Main inicial/final verificado: `52bb573e651529b323b6617e3161cd76ece14a39`. Rama: `feat/f01-single-instance-coordinator-r1`. El SHA de implementación es el commit que añade estos archivos; el SHA publicado/PR y los checks exactos se registran al cierre en Evidence y en el PR, evitando hashes autorreferentes. PR: [PR Draft #372](https://github.com/fdxruli/Lanzo-POS/pull/372), OPEN/Draft/NOT MERGED. HEAD de implementación: `f48c8c2c027ffddc08e06df5175a5f4fe34d91d4`; el commit posterior sólo cierra documentación/evidencia. Merge: NOT PERFORMED.

## Alcance y antecedentes

Se leyeron completos los seis informes F01 LC13 Audit/Evidence, Design/Evidence y F010 Decisions/Evidence proporcionados. Sus checkpoints son locales, no se presume que existan en GitHub. Los resultados anteriores permanecen como antecedentes; las pruebas aquí descritas son nuevas. Las cuatro decisiones aprobadas del encargo actual sustituyen el HOLD de implementación de esos antecedentes, exclusivamente para F01-1.

Clon independiente desde main vigente, inicialmente limpio; no había AGENTS.md aplicable. Worktree adicional propia y separada en el mismo SHA para baseline. No se cambian otras copias de trabajo. #366/#367/#369 confirmados MERGED. #338/#352/#368/#370/#371 permanecen OPEN/Draft. `remote-preflight.json.gz` conserva HEAD, archivos y checks consultados. Se revisaron las fronteras bridge/authority-recovery de #338, actualización SW de #352, leadership Ecommerce de #368, migración de crédito de #370 y outbox Cloud v2 de #371. No hay archivos de implementación compartidos con esos PR; sus contratos deberán revalidarse en F01-2 si se integran. No se fusionan ni copian esas ramas. Un diff sin solapamiento no certifica compatibilidad comercial conjunta.

## Archivos

Tres fuentes nuevas bajo `src/services/instance/`: `instanceCoordinator.js`, `instanceProtocol.js`, `instanceCapabilities.js`. Esta estructura separa lifecycle, envelope validable y capacidades sin crear una arquitectura mayor. Errores y tickets pertenecen al coordinador, no requieren otros módulos.

Pruebas unitarias en `src/services/instance/__tests__/instanceCoordinator.test.js`; laboratorio independiente, scripts reproducibles y evidencia en `scripts/qa/single-instance-f011/`. Dos informes en `docs/reports/`. **Ningún archivo preexistente del repositorio se modifica.** No hay adaptador comercial, componente conectado, flag, entrada Vite, SQL ni dependencia nueva de producto. Playwright/Chromium son tooling externo del laboratorio.

## API y propiedad del documento

`getDocumentInstanceCoordinator(target=globalThis)` requiere documento y conserva el servicio en una propiedad no enumerable con `Symbol.for` estable. Invocaciones repetidas, incluso desde bundles compatibles o efectos StrictMode, obtienen el mismo objeto. El import del módulo no inicia servicio, canal, lock o listener de navegador.

`start()` es single-flight y resuelve al adquirir, fallar o cancelar; una secundaria puede esperar indefinidamente. Su resolución es una observación, no un permiso reutilizable: capturar y comprobar ticket al continuar. `getSnapshot()` devuelve snapshot inmutable; `subscribe()` devuelve únicamente la baja de la vista. Desmontar React no libera el lock. `retry()` sólo admite ERROR y espera que termine el intento previo; dos retries concurrentes comparten el nuevo intento. RELEASED es terminal para ese documento. `probe()` sólo renueva una ronda informativa; nunca recarga, adquiere por timeout o fuerza acceso.

La exclusión usa exactamente `lanzo-pos-administrative-instance`, modo `exclusive`, con AbortSignal de la solicitud. El nombre no incluye versión, tenant, actor, sesión, licencia ni dispositivo. Se mantiene la promesa del callback nativo hasta el cierre controlado. No se usa `steal`, `ifAvailable` ni temporizador de admisión. La cola nativa decide el orden; recargar A no conserva prioridad frente a B que esperaba. Cancelar un request pendiente no revoca un lock ya adquirido.

No hay listeners de blur/visibility/freeze/unload/pagehide. Perder foco, minimizar, ocultar o pausar JS no libera voluntariamente. El navegador decide la terminación abrupta y la liberación eventual. No se simula cleanup financiero durante crash. BFCache, descarte y suspensión física requieren QA posterior.

## Máquina de estados y transiciones

| Origen | Destino / evento | Efectos, cleanup, error y recuperación |
| --- | --- | --- |
| STARTING | CHECKING / start | Crea un intento, incrementa epoch; sin autoridad comercial |
| ERROR | CHECKING / retry explícito | Espera intento previo, conserva identidad del documento; epoch nuevo; no revive tickets |
| CHECKING | ERROR / falta de capacidad | Diagnóstico acotado, cero request/canal comercial, sin fallback BC; retry explícito |
| CHECKING | SECONDARY / request permitido | Abre mensajería opcional y pide lock; SECONDARY significa esperando arbitraje, no prueba de que exista otra propietaria |
| SECONDARY | RECOVERING / callback nativo válido | Posee recurso; todavía sin ticket disponible; cero auth/DB/finanzas |
| RECOVERING | COORDINATOR_HELD / preparación local | Crea AbortController de tickets; emite estado dirigido a peers conocidos |
| CHECKING o SECONDARY | ERROR / API rechazada | Cierra canal, diagnóstico fijo; no concede propiedad ni bootstrap |
| STARTING/CHECKING/SECONDARY/RECOVERING/HELD/ERROR | QUIESCING / salida explícita | Revoca tickets síncronamente, incrementa epoch, rechaza nuevos ejecutores, aborta cola; retiene propiedad mientras drena |
| HELD | QUIESCING / fallo inesperado de API | Revoca continuación propia; drena antes de ERROR o finaliza salida explícita concurrente; no afirma conservar propiedad nativa perdida externamente |
| QUIESCING | RELEASED / drain y request nativo terminados | Aviso dirigido, resuelve promesa hold, espera settlement nativo, cierra canal/caches; tickets anteriores obsoletos |
| QUIESCING | ERROR / fallo nativo sin cierre explícito | Sólo tras invalidación y drain; recuperación por retry explícito |
| Cualquier estado | Sin transición / mensajes, foco, hidden, freeze, silencio | Mensajes cambian sólo observación informativa; no revocan actor, ticket o lock |
| RELEASED | Ninguna / terminal | start/retry rechazados; documento nuevo requiere identidad nueva |

Todas las transiciones son locales y funcionan sin internet. Epoch invalida tickets en cada intento y salida; la adquisición no concede actor, sesión, tenant, licencia, caja, permiso de cobro ni ausencia de pendientes. RECOVERING aquí sólo prepara coordinación local; la recuperación comercial restringida es F01-2.

## Protocolo y límites de memoria

Canal exclusivo nuevo: `lanzo-pos-administrative-coordination`. Versión de mensajes 1. No se abre `lanzo_pos_instance` ni se emiten CHECK_EXISTING/I_AM_HERE. IDs de instancia y solicitudes: 128 bits de `crypto.getRandomValues`, sin sessionStorage. `messageId=instanceId:sequence`; sequence y epoch son locales, no relojes globales.

Envelope plano exacto: `v,type,from,to,requestId,messageId,epoch,mode,state`; sin payload libre. IDs de 32 hex, secuencia/epoch enteros seguros y longitudes acotadas, versión/tipo/modo/estado permitidos, destinatario y nonce exactos. Objetos con campos adicionales o anidados, tipos desconocidos, remitente propio, request antiguo, destinatario ajeno y versión incompatible se rechazan.

| Mensaje | Dirección y efecto permitido |
| --- | --- |
| PROBE | Único broadcast a `to:null`; pide información, registra peer acotado |
| STATUS | Sólo propietario nativo responde al solicitante/nonce; state HELD o QUIESCING, epoch de propiedad capturada |
| CANDIDATE | Esperante responde dirigido con estado de no propietaria; no reclama liderazgo |
| RELEASE | Sólo hint dirigido al peer conocido, correlación y propietario/epoch observados exactos; no concede recurso |

Dedup: máximo 512 messageIds. Orden: máximo 128 emisores con última sequence/epoch. Peers de respuesta: máximo 128, reemplazo acotado; prueba con 2.000 probes conserva 128 destinatarios de release. Replays expulsados de caches pueden volver a producir información, nunca autoridad. No hay autenticación contra scripts maliciosos del mismo origen; BC no es frontera de seguridad. Ausencia/constructor denegado/postMessage fallido/messageerror cierra sólo mensajería, conservando arbitraje nativo. No hay elección BC-only ni downgrade en caliente.

## Tickets, cancelación y drain

`captureTicket()` entrega objeto congelado `{instanceId,localEpoch,mode,signal}` sólo en HELD. `isCurrent` y `assertCurrent` exigen identidad del ticket emitido, epoch actual, señal no abortada, estado HELD y propiedad local. Una copia fabricada no pasa. `quiesceAndRelease()` invalida síncronamente, cancela solicitudes pendientes y es single-flight. Espera todos los ejecutores registrados antes de resolver hold; no tiene timeout que conceda permiso.

`runExecutor(callback)` captura ticket y registra la promesa antes de ejecutar callback; verifica antes de invocarlo y al finalizar. El callback debe volver a comprobar tras await y antes de cada efecto. `waitForExecutors()` drena los registrados; el cierre ya impide altas nuevas. No esperar el propio cierre desde dentro del ejecutor que éste debe drenar: solicitarlo desde fuera o sin aguardar y terminar el callback.

Los fixtures demuestran callback tardío rechazado sin efecto y un **import ESM real pendiente** que sigue evaluándose al llegar el asset. A conserva el lock hasta terminar ese import; su ticket obsoleto impide el bootstrap sintético posterior. Sólo entonces B adquiere. Esto no cancela evaluación ESM, no dispone mágicamente listeners importados y no cerca callbacks comerciales existentes. Una tarea que no termina puede mantener QUIESCING indefinidamente; se conserva restricción y propiedad en lugar de forzar cesión.

El ticket no sustituye Actor Runtime, handle financiero, generaciones actor/tenant, CAS durable ni fencing SQL. No cierra LC13. No hay registro/drain de ejecutores comerciales reales en F01-1.

## Compatibilidad, continuidad y seguridad

Chromium 143.0.7499.0 Linux headless, React 19.2.0 y APIs nativas: probados. Chrome/Edge Windows, Android y PWA instalada: OWNER_QA_REQUIRED; BFCache/hibernación real y HTTPS físico también pendientes. Loopback HTTP es el transporte real del laboratorio. HTTP IP se intercepta conservando origen inseguro; F011-32 PARTIAL, no red física. No se configura HTTPS LAN ni se instalan certificados. El desarrollo LAN HTTP actual sigue intacto por ausencia de integración.

Sin Web Locks o contexto seguro: ERROR y cero bootstrap sintético. Sin BC: lock y cola siguen operativos. Con ambas APIs ausentes: ERROR. Offline: coordinación entre documentos cargados probada; no arranque frío comercial. Perfiles/procesos u orígenes distintos pueden tener propietarios independientes. Se probó un segundo proceso Chromium para el límite de perfiles, no se confunde un BrowserContext aislado con una pestaña competidora.

F011-29 conserva **COUNTEREXAMPLE / exclusión universal FAIL**: legacy sintético ignora lock y sigue operativo junto a la propietaria nueva; nuevo protocolo no responde I_AM_HERE a legacy. No se ejecuta el POS antiguo completo ni ventas. El silencio legacy no demuestra cierre. El rollback futuro no termina código ya cargado.

Grafo AST: 87 archivos locales estáticos desde main (incluye CSS/JSON), 866 al recorrer además imports dinámicos literales; no se recorren internals npm ni imports no literales. Ninguna ruta alcanza `src/services/instance/`. Clausura del coordinador: exactamente sus tres fuentes, sin negocio. 2.055 archivos preexistentes de src/public/store/Supabase/workflows/config conservan blobs exactos frente a main. Los builds confirman ausencia de coordinador/fixtures F011 en todos sus assets; Production sin laboratorio y Preview mantiene únicamente el laboratorio previo aislado del repositorio. No se agrega fixture al precache.

Actor Runtime, Actor Scoped Storage, M-01, F-02, Admin 168h, Staff online-only, tenant, finanzas, sesiones, licencias/dispositivos, sincronización, navegación, tienda y datos locales del propietario: sin modificaciones. Supabase calls/writes: NONE. Migraciones/operaciones financieras reales: NONE. LC13 invalidaciones tardías, pending/finally, carreras intradocumento y legacy: OPEN. M-03 y Authority v2: no incluidos.

## Validación y aceptación

45/45 unitarios y ESLint focal PASS. Chromium: 38 PASS, 1 COUNTEREXAMPLE, 1 PARTIAL; cero pageerrors/FAIL inesperados. Regresión seleccionada: candidata **827 PASS / 4 FAIL**, baseline mismo SHA **827 PASS / mismos 4 FAIL**, 831 assertions por lado, cero nuevas o ausentes. Los cuatro split-close históricos conservan assertions/errores y exit 1; no se declara suite global verde. Selección incluye auth/Staff/M01/F02, tenant/DB/Dexie, PWA/SW, bootstrap, handoff, intents y outbox. Tests unitarios y Chromium no se suman entre sí.

Builds Production, Preview, Store y Store Vercel PASS. Precache: 24 assets iniciales Production y 32 Preview, cero faltantes; `coreLocalRouteAssets=[]` es el resultado literal del auditor actual, no evidencia de probar todas las rutas offline. CI/PR127 y Preview exactos se registran en el cierre de Evidence, sin atribuir checks de otros PR.

AC-F011-01..28: implementados/verificados dentro del alcance documentado. AC-04/07 limitados a cohorte nativa compatible; AC-18/19 preservan explícitamente legacy/LC13. AC-26/27 probados mediante preservación del arranque y build, no mediante login LAN físico. AC-29/30 verificados: PR #372 OPEN/Draft y merged=false. La matriz física pendiente no se convierte en PASS.

¿Lista para revisión del propietario? Sí, infraestructura aislada con límites explícitos. ¿Puede mergearse aisladamente? **HOLD_OWNER_REVIEW**: la revisión debe considerar aislamiento, diferencial, CI exacto, build/precache y alcance aceptado; pasar sólo el coordinador no autoriza merge. Este encargo prohíbe merge y Ready for Review automático.

## Diseño UX para F01-2 (especificación, sin componente conectado)

Pantalla mínima sin navbar/layout comercial, ancho fluido hasta 36rem, padding mínimo 16px con safe-area, contenido con scroll, sin altura fija ni recorte. Validar 320/360/375/390px, tablet, escritorio y ambas orientaciones. Botones de al menos 44px, foco visible y texto envolvente; título asociado y aria-live polite para cambios. No exponer IDs internos ni ofrecer enfocar otra ventana sin handle real.

| Estado | Texto orientativo | Acción futura con contrato real |
| --- | --- | --- |
| Preparando | Estamos preparando esta ventana. | Sin CTA de acceso anticipado |
| Esperando arbitraje | Estamos comprobando qué ventana puede continuar. | Reconsulta informativa con probe |
| Otra propietaria observada | Lanzo POS ya está abierto en otra ventana de este navegador. | Volver a comprobar; orientar al usuario a su ventana |
| Sin respuesta observable | La otra ventana podría estar suspendida. Puedes volver a ella o esperar. | Mantener cola; ausencia de respuesta no es cierre |
| Recuperando coordinación | Estamos recuperando la disponibilidad de esta ventana. | Esperar barrera real de F01-2 |
| Capacidad/error | No pudimos comprobar la disponibilidad de esta ventana. | Reintentar sólo desde ERROR o diagnóstico compatible |

No habrá Forzar acceso, reload automático, botones inertes ni limpieza de datos. Aquí no se construye ni certifica visualmente esa pantalla.

## Dependencias F01-2 y riesgos

Separar la entrada mínima antes de imports comerciales; recuperar tenant/auth legítimos mediante contratos actuales sin activar sync/autoheal; inventario completo de pendientes/handoff/intents/outbox sin apropiarse del origen; comprobar tickets y handles tras awaits; registrar/drenar ejecutores reales; mantener SW/update y assets Local; adaptar UI secundaria accesible. Revalidar los PR abiertos si llegan a main y ejecutar QA de Preview HTTPS y dispositivos antes de activación. No usar un flag que permita saltar el gate.

Rollback de F01-1: revertir sólo archivos aditivos; no hay esquema/datos que revertir. Si F01-2 llegase a activarse, su rollback exige política propia de cohortes y drain: éste no lo autoriza. No se promete compatibilidad universal ni exclusión financiera, ni se inicia la siguiente fase.

Fuentes primarias verificadas: [W3C Web Locks](https://www.w3.org/TR/web-locks/) — promesa de callback, cola, cancelación y ámbito. La garantía de producto se restringe a la evidencia nueva y no amplía la especificación a clientes no participantes.
