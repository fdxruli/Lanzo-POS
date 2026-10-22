# LANZO POS — Guía del propietario: QA física Realtime 1A.5

**Estado de esta guía:** preparada, **todas las pruebas NOT RUN**. El piloto todavía está `BLOCKED`; no empezar hasta completar el checklist de habilitación.

**Informe de preflight:** [ECOM.FREE.ORDERS.REALTIME.AUTH.PILOT.READINESS.1A.5.md](ECOM.FREE.ORDERS.REALTIME.AUTH.PILOT.READINESS.1A.5.md).

## No iniciar todavía

La Production actual no incluye el receptor, una pantalla de diagnóstico ni el broker QA. El rol receptor, allowlist, grants y funciones QA no existen en Supabase Production. Las seis RPC compartidas conservan `EXECUTE` vía `PUBLIC`, y no se ha seleccionado una combinación de negocio/dispositivo controlada por el propietario. Esta guía describe cómo ejecutar las pruebas **después** del cierre de esos gates; no es una autorización para conectarse ahora.

No intentes habilitar el receptor desde DevTools, llamar el broker manualmente, copiar credenciales, usar una Preview como si fuera Production ni emitir pedidos. Si al abrir Production no aparece la superficie QA aprobada y un estado `AUTHORIZED`, detente: no hay prueba física válida.

## Habilitación requerida antes de QA-01

Completar y registrar todos los puntos:

- [ ] El propietario confirmó una de las dos licencias FREE elegibles y un dispositivo físico bajo su control. No se incluyeron nombres, IDs ni huellas en este informe.
- [ ] Se revisaron consumidores directos y externos de las seis RPC; el propietario aprobó o rechazó explícitamente la propuesta ACL separada y su rollback exacto.
- [ ] Se aceptó expresamente el riesgo residual de Auth para QA acotada o se aprobó una arquitectura alternativa.
- [ ] Los objetos QA son aditivos, versionados, revisados y están instalados solo en el proyecto Supabase autorizado. La allowlist contiene un negocio, dispositivo, actor y sesión actuales.
- [ ] Broker QA desplegado y postflight PASS: licencias/dispositivos/actores ajenos rechazados; Staff sin Ecommerce rechazado; grants viejos no renovables; topic no reutilizable; receptor no puede publicar; RPC administrativas no accesibles con bearer.
- [ ] Se configuró el secreto dedicado del operador en servidor; ninguna contraseña, JWT, refresh token, fingerprint o control token se entrega al propietario/navegador.
- [ ] Kill switch server-side ejecutado en prueba: detiene nuevas emisiones, concesiones y renovaciones, invalida allowlist y permite cleanup sin afectar Caja, Ventas, offline o canales PRO existentes.
- [ ] Se certificaron los checks del SHA con el montaje QA; se revisó compatibilidad con PR #369.
- [ ] Se autorizó el deployment exacto a Vercel Production. Abrir `https://lanzo-pos.vercel.app` solo después de verificar que entrega ese SHA y la superficie QA aprobada. Una Preview no cuenta.
- [ ] Se capturó baseline Supabase Usage justo antes del ensayo. Piloto: 1 negocio, 1 dispositivo, 1 sesión por contexto, 1 líder cuando Web Locks exista, máximo 10 `qa_probe` por día.
- [ ] Se confirmó que `order_created`, `notifications_changed`, `cloud_pos_sync`, `support_realtime`, `realtime_license_sync` y funciones PRO no se activan.

**Límites de parada:** advertir al 70% de una cuota compartida; apagar preventivamente al 80%; apagar inmediatamente ante cruce de tenant, privilegio no autorizado, aumento Auth anómalo, solicitudes reiteradas de autorización o receptores duplicados descontrolados. Un socket puede recibir una entrega ya encolada después de revocar; eso no equivale a una publicación nueva posterior a la barrera.

## Instrucciones para el propietario cuando se habilite

1. **URL:** `https://lanzo-pos.vercel.app`. Confirma en el panel QA el SHA aprobado y que el entorno sea Production. Si el SHA no coincide o aparece Vercel Preview, detente.
2. **Negocio:** utiliza únicamente el negocio FREE que el propietario haya confirmado para el ensayo. El informe no elige uno porque no puede asociar el dispositivo físico al propietario.
3. **Usuario/rol:** usa el Admin propietario confirmado; para QA-02/03 usa Staff sintético preparado para esta prueba, una cuenta con Ecommerce y otra sin Ecommerce. No se guardan ni solicitan contraseñas aquí.
4. **Dispositivo:** empieza en el equipo o teléfono del propietario indicado al cerrar el gate. Conserva el dispositivo Admin normal activo; no lo liberes para probar.
5. **Conexión:** abre el panel discreto QA solo visible al Admin allowlisted. Debe mostrar autorización vigente, conexión suscrita, grant vigente, líder Web Locks y una sola conexión del contexto. Topic solo abreviado; nunca tokens.
6. **Primera sonda:** solicita al operador que emita un único `qa_probe` sintético por la función/operación server-side aprobada. El navegador no publica. No mandes ningún secreto por chat, consola, URL o captura.
7. **Evidencia:** captura pantalla recortada con estado, reloj UTC, SHA y QA ID. Redacta negocio, actor, dispositivo, session ID y topic completo. Adjunta errores de consola solo después de revisar que no contengan credenciales o datos personales.
8. **Detener:** usa el kill switch server-side indicado en la entrega de habilitación; confirma que el panel pase a detenido y que no se acepten publicaciones/renovaciones. No confíes solo en cerrar la pestaña.
9. **Recuperar:** si hay falla, mantiene offline/local, sign-out normal de la identidad sintética y pausa. Pide al operador revisar el estado; no reinicies sesiones del propietario, no borres dispositivos y no repitas un intento indefinidamente.

**Registro privado por caso:** fecha/hora UTC; SHA Production; QA-xx; PASS/FAIL/BLOCKED; dispositivo descrito de forma no identificable; resultado mostrado; captura saneada. No subas secretos, nombres de clientes, teléfonos, direcciones, pedidos, pagos, fingerprints o logs sin revisar a GitHub.

---

## Grupo A — sesiones y permisos

### QA-01 — Admin online y conexión inicial

**Objetivo:** comprobar que solo el Admin del negocio allowlisted puede conectar.

**Dispositivo / inicio:** equipo principal del propietario, navegador actualizado, online; Admin de prueba ya seleccionado.

**Pasos:** 1) Abre la URL Production y verifica el SHA autorizado. 2) Inicia sesión como Admin. 3) Abre la sección Ecommerce autorizada y el panel QA discreto. 4) Espera la respuesta del broker sin recargar repetidamente.

**Esperado / PASS:** autorización `AUTHORIZED`, grant vigente, conexión `SUBSCRIBED`, un líder y una conexión en el contexto. No se muestra ningún token.

**FAIL:** grant para otra licencia/dispositivo, más de una conexión, secreto visible, error repetido o modo Preview.

**Evidencia:** panel QA saneado, SHA y UTC antes/después del join.

**Recuperación:** cierra el receptor con la UI y sign-out; ante cualquier scope ajeno activa kill switch y no vuelvas a iniciar.

### QA-02 — Staff con permiso Ecommerce

**Objetivo:** comprobar que un Staff autorizado recibe solo el alcance Ecommerce permitido.

**Dispositivo / inicio:** mismo dispositivo de QA; sesión Admin cerrada; Staff sintético activo con permiso Ecommerce explícito.

**Pasos:** 1) Inicia sesión como ese Staff. 2) Confirma que el runtime cambió de actor/generación. 3) Abre Ecommerce y observa diagnóstico. 4) Confirma que el Admin anterior no conserva callbacks.

**Esperado / PASS:** el broker autoriza el actor Staff actual y una sola conexión; no hereda permisos Admin ni PRO.

**FAIL:** permiso comodín, token/sesión del Admin anterior o acceso a tenant ajeno.

**Evidencia:** rol/permisos redacted y estado del runtime/conexión.

**Recuperación:** detén receptor, sign-out del Staff de prueba y activa kill switch si permanece autoridad antigua.

### QA-03 — Staff sin Ecommerce debe rechazarse

**Objetivo:** validar rechazo en servidor para un Staff sin permiso Ecommerce.

**Dispositivo / inicio:** Staff sintético separado con permiso Ecommerce explícitamente falso; online; sin otra sesión activa.

**Pasos:** 1) Inicia sesión con ese Staff. 2) Intenta entrar al contexto QA permitido por la interfaz normal. 3) Observa el estado y registra el código seguro de rechazo.

**Esperado / PASS:** rechazo 403/denegado, sin grant ni socket; Ventas/Caja siguen disponibles según su autorización normal.

**FAIL:** el receptor se conecta o el diagnóstico concede permisos nuevos.

**Evidencia:** rechazo seguro sin bearer, IDs o credenciales.

**Recuperación:** sign-out de la cuenta sintética; si conecta, kill switch inmediato y suspender todas las pruebas.

### QA-04 — FREE sin capacidades PRO adicionales

**Objetivo:** certificar el entitlement efectivo sin cambiar plan ni activar funciones comerciales.

**Dispositivo / inicio:** negocio FREE elegido; Admin autorizado; antes de emitir cualquier sonda.

**Pasos:** 1) Registra el tipo/estado de licencia sin copiar su clave. 2) Comprueba la vista de permisos actual. 3) Verifica que QA solo enumere `qa_probe`. 4) Confirma que el estado de Notificaciones PRO no cambió.

**Esperado / PASS:** ninguna concesión PRO nueva; ningún cambio de plan/features; el receptor no consulta ni procesa pedidos.

**FAIL:** cambio a PRO, `order_created`, notificación cloud o entitlement alterado.

**Evidencia:** pantalla redacted de licencia/features y salida de postflight.

**Recuperación:** detén receptor y kill switch; solicita rollback de cualquier cambio de entitlements antes de continuar.

## Grupo B — navegación y operación

### QA-05 — Navegación por Ventas

**Objetivo:** comprobar que Ventas sigue siendo utilizable con el receptor activo.

**Dispositivo / inicio:** sesión autorizada activa; sin transacciones nuevas.

**Pasos:** 1) Abre Ventas. 2) Revisa solo listas y vistas existentes. 3) Regresa a Ecommerce. 4) Comprueba que no se creó ningún pedido/venta durante la navegación.

**Esperado / PASS:** UI estable, una conexión QA y ninguna mutación financiera o señal comercial.

**FAIL:** caja bloqueada, venta creada, listener duplicado o error de tenant.

**Evidencia:** pantalla de diagnóstico y contador técnico, sin datos de clientes/ventas.

**Recuperación:** detén el receptor; deja el POS en local/offline y reporta antes de cualquier otra acción.

### QA-06 — Operar Caja sin interferencias

**Objetivo:** comprobar que el receptor no interfiere con Caja.

**Dispositivo / inicio:** sesión QA activa; sesión de caja ya en estado normal conocido. No cierres ni abras cajas durante el test.

**Pasos:** 1) Abre la vista Caja. 2) Consulta el estado existente sin registrar movimientos. 3) Vuelve al panel QA.

**Esperado / PASS:** Caja responde como antes; no hay cierre, ajuste, pago, conciliación o escritura de efectivo.

**FAIL:** operación financiera inesperada, lock de caja o servicio financiero desmontado.

**Evidencia:** hora, estado Caja redacted y estado del receptor.

**Recuperación:** pausa QA y conserva la sesión de caja; no intentes cerrar/reconciliar para “limpiar” el test.

### QA-07 — Ecommerce, Configuración y otras secciones

**Objetivo:** comprobar el ciclo de navegación sin montar receptores extra.

**Dispositivo / inicio:** Admin QA autorizado, conectado y con panel visible.

**Pasos:** 1) Cambia entre Ecommerce y Configuración. 2) Abre una sección no relacionada permitida. 3) Vuelve a Ecommerce. 4) Observa el número de receptores.

**Esperado / PASS:** una conexión por contexto y callbacks válidos; ninguna pantalla ajena activa un segundo receptor.

**FAIL:** conexiones acumuladas, autorización reusada tras cambio de contexto o crash visual.

**Evidencia:** panel antes/después y log seguro de estados.

**Recuperación:** vuelve a Ecommerce, detén receiver; si queda socket huérfano, kill switch y pausa.

### QA-08 — Sin avisos comerciales ni errores visuales

**Objetivo:** confirmar que el QA no introduce avisos o fallos de UI a usuarios.

**Dispositivo / inicio:** Admin de prueba en Production y panel QA habilitado por servidor.

**Pasos:** 1) Recorre inicio, Ecommerce y navegación principal. 2) Revisa banners/toasts/console. 3) Confirma que los errores muestran códigos seguros sin datos sensibles.

**Esperado / PASS:** no aparecen promociones de pedidos/notificaciones ni error boundary; consola sin excepciones nuevas.

**FAIL:** aviso comercial, render roto, token/PII en error o una excepción repetida.

**Evidencia:** capturas redacted y conteo de errores por pantalla.

**Recuperación:** cierra el panel QA y activa el apagado si se filtra un secreto; conserva offline funcionando.

## Grupo C — pestañas y liderazgo

### QA-09 — Dos pestañas del mismo contexto

**Objetivo:** verificar Web Locks con dos pestañas del mismo negocio/actor/sesión.

**Dispositivo / inicio:** un navegador y perfil; Admin de prueba; una pestaña líder conectada.

**Pasos:** 1) Duplica la pestaña en el mismo perfil. 2) Espera el estado de liderazgo en ambas. 3) Comprueba que la segunda no recibe token ni abre otro socket.

**Esperado / PASS:** un líder, un receptor y una conexión; la pestaña secundaria permanece sin autoridad propia.

**FAIL:** dos líderes simultáneos, dos sockets sin fallback documentado o credenciales distribuidas.

**Evidencia:** capturas de las dos pestañas con el mismo QA ID y horas.

**Recuperación:** cierra la pestaña secundaria; si siguen dos conexiones, apaga servidor y pausa.

### QA-10 — Cierre de la pestaña líder

**Objetivo:** comprobar failover controlado al cerrar la líder.

**Dispositivo / inicio:** QA-09 PASS, una líder y una secundaria elegida.

**Pasos:** 1) Cierra solo la pestaña líder. 2) Espera la liberación de Web Lock. 3) Observa la pestaña sobreviviente. 4) Confirma una conexión.

**Esperado / PASS:** la sobreviviente toma liderazgo en tiempo acotado, vuelve a validar servidor y no duplica autoridad.

**FAIL:** liderazgo atascado, dos sockets o uso de grant antiguo sin validar.

**Evidencia:** hora de cierre y tiempos de liberación/join.

**Recuperación:** cierra la pestaña secundaria y vuelve a abrir Production una vez; si no se estabiliza, kill switch.

### QA-11 — Regreso a pestaña suspendida

**Objetivo:** comprobar recuperación de una pestaña que el navegador suspendió.

**Dispositivo / inicio:** QA-09 estable; una líder y una secundaria suspendible.

**Pasos:** 1) Cambia a otra aplicación durante al menos 1 minuto. 2) Vuelve a la pestaña secundaria. 3) Revisa generación, liderazgo y conexión. 4) Asegura que la pestaña no usa un grant anterior.

**Esperado / PASS:** revalida contexto y recupera liderazgo solo si está libre; una conexión como máximo.

**FAIL:** callback tardío restaura actor anterior o se produce reconexión en bucle.

**Evidencia:** hora de background/foreground y estados redacted.

**Recuperación:** sign-out de la identidad sintética; no fuerces refresh masivo; pausa si persiste.

## Grupo D — conectividad

### QA-12 — Desconexión de internet

**Objetivo:** medir desconexión sin bloquear POS offline.

**Dispositivo / inicio:** Admin QA conectado; no hay operación de venta/caja en curso.

**Pasos:** 1) Apaga Wi-Fi o usa modo avión por 30–60 s. 2) Observa el cierre del socket y los intentos acotados. 3) Navega una pantalla local no financiera.

**Esperado / PASS:** bridge se desconecta/reintenta con límite; ventas y caja no quedan bloqueadas; no hay tormenta de requests.

**FAIL:** bloqueo offline, reintentos infinitos, múltiples conexiones o publicación offline.

**Evidencia:** hora de desconexión, estado y conteo de intentos.

**Recuperación:** restaura internet; deja la aplicación en local si no se recupera. Detén QA si persisten reintentos.

### QA-13 — Lanzo Local offline

**Objetivo:** verificar que Local no depende del receptor cloud.

**Dispositivo / inicio:** red desconectada y modo Local accesible; solo lecturas o navegación sin cambios financieros.

**Pasos:** 1) Abre Lanzo Local. 2) Navega las pantallas requeridas sin crear venta/pedido. 3) Observa que no aparezca grant cloud `GRANTED`.

**Esperado / PASS:** modo local continúa; no se emite ni reutiliza autoridad cloud.

**FAIL:** Local espera al broker, se bloquea o presenta grant offline como cloud activo.

**Evidencia:** vista local y estado de red/bridge.

**Recuperación:** sigue offline, sign-out normal; no repitas acciones que puedan crear colas financieras.

### QA-14 — Reconexión y nueva autorización

**Objetivo:** validar recuperación online con autoridad fresca.

**Dispositivo / inicio:** QA-12 dejó el receptor desconectado y POS local operativo.

**Pasos:** 1) Restaura internet. 2) Espera sin pulsar reintentar. 3) Confirma que el broker revalida sesión, dispositivo y grant. 4) Confirma una conexión.

**Esperado / PASS:** `AUTHORIZED` vigente y `SUBSCRIBED` en un solo líder; backoff termina después del éxito.

**FAIL:** reutiliza topic/grant vencido, crea tormenta o expone una excepción con datos.

**Evidencia:** línea temporal de desconexión, recuperación y latencia.

**Recuperación:** detén QA y conserva modo Local; solicitar revisión antes de otro intento.

### QA-15 — Suspender y reanudar PWA

**Objetivo:** validar suspensión/reanudación de la PWA en un teléfono real.

**Dispositivo / inicio:** teléfono del propietario, PWA instalada, sesión sintética/QA, red estable.

**Pasos:** 1) Envía la app al background durante 2–5 min. 2) Bloquea/desbloquea pantalla si es habitual. 3) Reanuda PWA. 4) Observa autorización y liderazgo, sin emitir pedidos.

**Esperado / PASS:** runtime vuelve a validar; conserva como máximo un receptor y aplica renovación limitada.

**FAIL:** token viejo aceptado, doble socket o PWA no responde.

**Evidencia:** modelo general de dispositivo/OS, duración y estados; no número telefónico ni huella.

**Recuperación:** cierra la PWA, espera cleanup y vuelve a abrir una vez; si queda autoridad antigua, kill switch.

## Grupo E — identidad

### QA-16 — Cambio Admin a Staff

**Objetivo:** confirmar que Admin A pierde autoridad al pasar a Staff B.

**Dispositivo / inicio:** identidad Staff sintética con Ecommerce; Admin QA conectado.

**Pasos:** 1) Bloquea/cierra sesión Admin según el flujo normal. 2) Inicia Staff. 3) Intenta observar desde el callback anterior mediante diagnóstico seguro. 4) Confirma que solo el actor actual recibe sonda futura.

**Esperado / PASS:** se cierra receptor Admin, cambia generación, Staff recibe solo sus permisos.

**FAIL:** callback Admin tardío, token antiguo o acceso de Admin desde Staff.

**Evidencia:** transiciones actor/generación en forma redacted.

**Recuperación:** sign-out Staff; limpia solo identidad/grant de QA mediante broker y vuelve al estado offline.

### QA-17 — Cambio Staff a Admin

**Objetivo:** confirmar que Staff no limita ni contamina un Admin posterior.

**Dispositivo / inicio:** QA-02 en Staff; Admin propietario/sintético confirmado disponible.

**Pasos:** 1) Cierra sesión Staff. 2) Inicia Admin. 3) Espera nueva verificación del servidor y grant. 4) Confirma que la sesión Staff quedó cerrada.

**Esperado / PASS:** Admin obtiene solo su propia conexión tras autorización nueva; no hereda topic ni runtime Staff.

**FAIL:** topic compartido, sesión Staff todavía activa o conexión Admin antes de autorización.

**Evidencia:** cambio de estado y grant IDs abreviados.

**Recuperación:** sign-out normal, detén bridge, no toques sesiones de otros dispositivos.

### QA-18 — Cerrar sesión y cleanup

**Objetivo:** validar cleanup local y selectivo al sign-out.

**Dispositivo / inicio:** una identidad exclusivamente QA conectada.

**Pasos:** 1) Ejecuta sign-out desde Lanzo. 2) Observa desconexión y remoción del canal. 3) Comprueba que el panel QA se oculta. 4) Operador verifica que no queda grant vivo para esa sesión de QA.

**Esperado / PASS:** socket/channel se limpia y el grant queda revocado/tombstone; no se eliminan dispositivos/usuarios de producción ajenos.

**FAIL:** socket activo, grant revivido o cleanup amplio.

**Evidencia:** pantalla sin sesión y resultado agregado del operador.

**Recuperación:** ejecuta cleanup selectivo de la identidad QA; nunca uses cleanup global.

### QA-19 — Reemplazo o invalidación de sesión Admin

**Objetivo:** asegurar rechazo del contexto anterior tras invalidación.

**Dispositivo / inicio:** Admin sintético de QA con dos sesiones/dispositivos restaurables. No usar la única sesión del propietario.

**Pasos:** 1) Conecta el Admin de QA en dispositivo A. 2) Operador reemplaza/invalida solo la sesión sintética desde el mecanismo revisado. 3) Envía una sonda controlada y observa el dispositivo A.

**Esperado / PASS:** contexto anterior recibe rechazo y cleanup; no toma identidad nueva por callback tardío.

**FAIL:** contexto viejo obtiene grant, conserva autoridad o se afecta una cuenta no sintética.

**Evidencia:** resultado de rechazo y alias de sesión redacted.

**Recuperación:** detén QA; reactiva únicamente la identidad sintética mediante procedimiento de recuperación. No liberes el dispositivo real del propietario.

## Grupo F — Realtime

### QA-20 — Recibir un `qa_probe` privado una sola vez

**Objetivo:** medir transporte privado y recepción única.

**Dispositivo / inicio:** QA-01 PASS; un negocio/dispositivo allowlisted; baseline Usage capturado.

**Pasos:** 1) Operador genera un `probe_id` aleatorio sin PII. 2) Operador publica una vez mediante la operación server-side autorizada. 3) Mide latencia desde publicación hasta callback. 4) Comprueba que otro tenant no participa.

**Esperado / PASS:** solo `qa_probe`, una recepción en el receptor esperado, payload sintético mínimo y topic privado.

**FAIL:** publicación desde navegador, duplicado, dato comercial, recepción cruzada o receiver con capacidad de publicar.

**Evidencia:** hora de publicación/recepción, `probe_id` sintético y Usage antes/después.

**Recuperación:** revoca el grant y pausa; si existe cruce o dato no sintético, kill switch inmediato.

### QA-21 — Revocar grant con socket abierto

**Objetivo:** verificar la barrera entre publicación y revocación.

**Dispositivo / inicio:** grant de QA sintético y socket abierto; operador preparado para controlar el orden.

**Pasos:** 1) Operador inicia revocación. 2) Programa/publica una sonda seleccionada después de confirmar la barrera. 3) Opcionalmente observa una entrega ya encolada antes de la barrera. 4) Intenta renovar el grant antiguo.

**Esperado / PASS:** la publicación seleccionada después de la barrera se excluye y renovación antigua se deniega. Un evento ya encolado antes puede llegar; no se cuenta como emisión nueva. El socket puede tardar en cerrarse.

**FAIL:** nueva publicación posterior aceptada, grant tombstone revivido o permiso en otro tenant.

**Evidencia:** orden temporal de barrera, emisión, revocación y respuesta; sin payload sensible.

**Recuperación:** kill switch; revoca grants de QA y no dependas de desconexión instantánea del socket.

### QA-22 — Expirar grant y recuperar con runtime nuevo

**Objetivo:** comprobar que un grant expirado no reutiliza el topic anterior.

**Dispositivo / inicio:** sesión Admin QA sintética; TTL de servidor documentado (candidato 600 s); sin otra prueba activa.

**Pasos:** 1) Conecta y registra solo un identificador abreviado del topic. 2) Espera expiración natural sin solicitudes repetidas. 3) Confirma que el grant viejo deja de aceptar sondas. 4) Cierra/recupera un runtime nuevo y solicita autorización fresca. 5) Verifica topic nuevo.

**Esperado / PASS:** topic viejo no se reutiliza; el runtime nuevo obtiene un grant vigente tras revalidación; una conexión como máximo.

**FAIL:** el cliente amplía TTL, revive tombstone, reusa topic, entra en loop o usa JWT viejo como autorización Lanzo.

**Evidencia:** tiempos de expiración y recuperación, topics abreviados distintos.

**Recuperación:** cierra el runtime, revoca la identidad sintética y deja offline; no reduzcas el TTL ni repitas sin autorización del operador.

---

## Registro de resultados

| Caso | Estado inicial | Resultado / UTC | Evidencia saneada | Observaciones |
|---|---|---|---|---|
| QA-01…QA-22 | NOT RUN; piloto bloqueado | — | — | Completar un renglón por caso cuando el gate esté abierto. |

**Cierre del ensayo:** detener el receptor con el kill switch, comprobar que no se aceptan nuevas concesiones/renovaciones/publicaciones, capturar Usage y errores post-test, y mantener únicamente los recursos sintéticos que el propietario haya decidido conservar y que tengan expiración/cleanup verificados. No limpiar infraestructura útil a QA física antes de entregar resultados; no conservar nada que no tenga límite, seguridad y apagado probado.
