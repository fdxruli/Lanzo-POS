# LANZO POS — Fase 1A.2: puente Auth nativo

Pruebas de producción: 2026-10-21. Cierre documental: 2026-10-22, America/Mexico_City. Proyecto autorizado: `odlrhijtfyavryeqivaa`.

**IMPLEMENTATION=REVIEWABLE_QA_FOUNDATION; MERGE=HOLD; PHASE_1B=BLOCKED.**
Hay código de broker, binding nativo, publicador transaccional QA y receptor aislado. Se probaron Auth y Realtime Hosted reales con fixtures sintéticos. El experimento no activa recepción comercial FREE. Los permisos PUBLIC compartidos no se corrigieron persistentemente.

## A–M: dictamen de entrega

| Apartado | Estado | Evidencia y límite |
|---|---|---|
| A. Git, rama, PR y archivos | PASS / Draft HOLD | Base local `94a8f7f3f8ed7496571880893b84493ad25bdab3`, rama `codex/ecom-realtime-auth-1a2`. El SHA final y URL se fijan en la entrega/PR; ningún merge. |
| B. Broker servidor | PASS QA / HOLD comercial | Edge Function propia; emisión, renovación, reserva exclusiva, vault cifrado, compensación y colector. |
| C. Binding Lanzo ↔ Auth | PASS QA | Identidad por dispositivo y sesión Lanzo; sesión Auth distinta por runtime; canonicalización online. |
| D. Claims y RLS | PASS QA / HOLD ACL | Issuer Auth real, aud authenticated, rol especializado, sub/session_id y app_metadata; no autoridad en user_metadata. |
| E. ACL | HOLD | Ensayo exacto de seis firmas: rechazo real y matriz 32×6; aplicación compartida pendiente de aprobación. |
| F. Realtime real | PASS parcial | Join, qa_probe, firma alterada, topic ajeno, sesiones sin binding, permisos de publicación/Presence y REST. No se certifica toda la matriz como PASS. |
| G. Revocación | PASS de la barrera QA | Socket joined tras revocar; nuevas emisiones excluidas. Carreras en ambos órdenes con espera transactionid observada. |
| H. Autoservicio Auth | HOLD | Sin escalada observada, pero el bearer puede cambiar su contraseña y crear sesiones Auth nuevas. MFA, linking y otras rutas no certificadas. |
| I. Escala y costos | HOLD | Límites QA explícitos; no hay aceptación comercial del modelo ni de sus cuotas/costo. |
| J. Migraciones y recursos | PASS | Cuatro entradas de auditoría QA; objetos, fixtures, identidades y endpoints QA retirados. Ledger conocido no reparado. |
| K. Regresiones/builds | HOLD parcial | 24 pruebas Node y 11 SQL PASS. Builds POS/Store anteriores PASS; después de actualizar main faltan resultados completos de Vitest/PWA/Store. Deno PASS; React Doctor 100/100. |
| L. Riesgos y merge | HOLD | ACL, escala, integración física/React, extremos Auth y JWT natural pendientes. |
| M. Fase 1B | BLOCKED | Servicio preparado para revisión; no integración global, bandeja, avisos ni order_created. |

## A. Base e impacto

Checkout principal preservado: `C:/dev/Lanzo-POS-Git`, `main` local `54c4f9e83068bf6d1578f785877f4cc85a90552a`, incluidos nueve informes/manifest y scripts/recovery sin seguimiento. Se creó `C:/dev/Lanzo-POS-ecom-auth-1a2` desde la evidencia 1A.1. Se actualizaron referencias remotas; main remoto observado fue `f014a1f340ed78335d3e704eefff49cda8465115`.

Antecedentes: informes R1 y FEASIBILITY.R1 de la worktree `ecommerce-free-order-signal-auth-r1`; [producción R2](ECOM.FREE.ORDERS.REALTIME.AUTH.PRODUCTION.R2.md), [Fase 1A.1](ECOM.FREE.ORDERS.REALTIME.AUTH.PHASE1A.1.md), ramas `codex/ecom-realtime-auth-r2` y `codex/ecom-realtime-auth-1a1`. `foundation.sql` conserva los guards de authority_live R2; no sustituye ese diseño por otro sin evidencia.

PRs inspeccionados: #366 OPEN/Draft, HEAD `0fa755c3f7b910a9377d63d8c95d0cb6469903f0`; #338 OPEN/Draft, `fef7205f76b173025f503e60d0968f446f741e78`; #352 OPEN/Draft, `d758f69b2119f1bc346eb0ac86ba0a74c0265668`, sobre la rama de #338. #366 modifica continuidad offline; el broker siempre exige comprobación online. No se editaron App.jsx, Layout.jsx, Actor Runtime, contratos financieros, Caja, catálogo, peso ni bandeja online.

Durante el cierre, #366 se cerró y main avanzó a `f48aab53634663438a06dc5187fa7e6d17b74fb3` con su continuidad Admin. Se actualizó exclusivamente esta rama todavía no publicada mediante rebase sobre ese main, conservando las ramas/worktrees anteriores. No hubo conflictos. #338 y #352 seguían OPEN/Draft con los mismos HEAD. Se repitió la validación focal sobre esa integración; no se hizo merge de este trabajo ni despliegue del frontend.

Archivos principales:

- `supabase/functions/lanzo-ecom-bridge-qa/{index.ts,broker.mjs}`.
- `supabase/candidates/ecom-signal-auth-1a2/`: foundation, bridge, rollback, instrumentación y driver QA; fuera de migrations.
- `src/services/ecommerce/ecomSignalReceiver.js`, sin consumidor global.
- `scripts/supabase/{prepare-ecom-native-qa,ecom-native-hosted-qa,ecom-native-bridge.node-test}.mjs`.
- [Evidencia de esta fase](evidence/ecom-realtime-auth-1a2/resource-inventory.json).

## B–D. Contrato implementado

El broker recibe únicamente licencia, fingerprint, token de dispositivo, token de actor, runtime_id y generaciones. Ignora IDs de tenant/actor/dispositivo libremente declarados. SQL resuelve el dispositivo y el actor con `private.resolve_device_actor_session`, comprueba entitlement canónico, portal/inbox, dispositivo activo, límite, owner Admin o Staff con Ecommerce. Staff no requiere settings. Los verificadores canónicos pueden actualizar sus timestamps de uso; únicamente se usaron sesiones sintéticas.

La cadena es tenant → dispositivo → actor → sesión Lanzo → identidad Auth → sesión Auth → grant → topic. La clave única de identidad es dispositivo+sesión Lanzo. Cada runtime recibe un grant y un session_id Auth propios. Las generaciones son datos de la captura, no prueba criptográfica de un browser confiable. Cambiarlas en un grant existente se rechaza; los callbacks antiguos se descartan localmente.

Prepare serializa el inventario QA y reserva una lease exclusiva por identidad. Operaciones concurrentes devuelven BUSY; no crean otro usuario. Una lease vencida se pone en cuarentena, no se roba. Grants revocados/vencidos son tombstones y no se renuevan. Finish vuelve a verificar lease, autoridad y sesión Auth; una respuesta vieja no puede completar otro contexto. El ensayo concurrente devolvió 409/200/409/409 y un único grant.

Auth Admin crea exclusivamente una identidad técnica nueva y etiquetada, con rol `lanzo_ecom_bridge_receiver`. Password se deriva en servidor por HMAC, con propósito propio, de la credencial privilegiada ya disponible en Edge. Refresh y access token se guardan cifrados AES-GCM en un esquema privado, con grant_id como contexto autenticado. El navegador recibe sólo access JWT, topic, URL/clave pública y expiraciones. No se instala un firmante, clave, hook ni cambio global de Auth. El vault v1 necesita drenaje antes de una futura rotación de su credencial raíz.

Abort se reconcilia con SQL antes de borrar Auth: si finish pudo haber hecho commit y se perdió su respuesta, un abort no aceptado conserva la identidad para reintento/colector. Cuando abort confirma, se cierra la sesión y se compensa el usuario recién creado. El fallo real inyectado entre Auth y binding dejó grant revocado/sin lease y ningún usuario huérfano. La pérdida de respuesta después de commit tiene prueba unitaria; no se cortó físicamente esa conexión en Hosted.

RLS usa `iss=https://odlrhijtfyavryeqivaa.supabase.co/auth/v1`, `aud=authenticated`, rol especializado, `sub`, `session_id`, `app_metadata.lanzo_bridge=qa_1a2` y binding_id administrado por servidor. Verifica auth.sessions, identidad, grant, expiración, topic exacto y autoridad Lanzo actual. No usa user_metadata. El rol no hereda anon/authenticated/authenticator; recibe sólo USAGE en el esquema propio/Realtime, SELECT messages y su helper booleano. No hay INSERT ni Presence.

El topic `ecom:qa-probe:1a2:<grant>` nunca se reutiliza para otra concesión. La autorización RLS es por topic, no por nombre de evento. Por eso el publicador tiene evento fijo qa_probe, payload sintético UUID y topic derivado; no acepta un payload o topic arbitrario. No ofrece un emisor comercial.

## E. Revisión ACL

La [matriz completa](evidence/ecom-realtime-auth-1a2/acl-matrix.json) ensaya seis firmas exactas y conserva overloads históricos. Se aplicó la propuesta R2 únicamente con BEGIN/ROLLBACK. Tras simular REVOKE, las seis llamadas reales bajo el receptor fallaron con 42501; no quedaron SECURITY DEFINER públicas ejecutables por ese rol. Los 18 permisos anon/authenticated/service_role permanecieron; postgres y supabase_admin también conservaron acceso. `admin_list_staff_users` con credenciales Lanzo sintéticas legítimas funcionó bajo anon después del cambio.

Se midieron 32 roles actuales y 27 perderían EXECUTE heredado, incluido el receptor. Entre ellos authenticator, dashboard_user, roles Supabase Auth/Realtime/Storage y mantenimiento. La matriz actual no se sustituyó por la histórica de 33 roles. No se concedieron permisos preventivos. La lista de staff, creación/edición y consumidores Caja se revisaron en los antecedentes; esta fase no ejecutó cierres, adopciones o operaciones financieras autorizadas ni certificó clientes externos.

La [propuesta](../../supabase/candidates/ecom-signal-auth-r2/public-rpc-acl-proposal.sql) y [rollback exacto](../../supabase/candidates/ecom-signal-auth-r2/public-rpc-acl-rollback.sql) permanecen separados. **No hay aprobación específica ni aplicación persistente.** El 403 de PostgREST por no poder asumir el rol receptor no elimina sus EXECUTEs heredados. Postflight conserva los seis PUBLIC originales.

## F–G. Realtime y revocación medidos

[Trazas Hosted sin credenciales](evidence/ecom-realtime-auth-1a2/native-hosted.json), [evidencia servidor](evidence/ecom-realtime-auth-1a2/server-evidence.json).

| Observación | Medición / resultado |
|---|---|
| Broker válido | 2060 ms en una emisión real |
| Join privado | 2421 ms, SUBSCRIBED |
| Publicación/recepción qa_probe | Encolado real; llamada 603 ms; señal recibida |
| Renovación broker | 692 ms; conserva grant y sesión Auth |
| Credenciales inválidas / sin Ecommerce / tenant ajeno | 403, ejemplos 753 / 294 / 613 ms |
| Dispositivo inactivo / sesión revocada | 403, 644 / 958 ms |
| Revocación confirmada | 2026-10-21 06:03:43.665814 UTC; llamada 510 ms |
| Publicador tras confirmar revocación | EXCLUDED, 299 ms; socket todavía joined |
| Nueva suscripción al grant revocado | Unauthorized, 4925 ms |
| Renovación del grant revocado | 403 |
| Firma manipulada | JwtSignatureError |
| Broadcast y Presence del receptor | error / error |
| RPC y tabla comercial con bearer | 403/42501, incluyendo firma correcta y credenciales sintéticas válidas |

Son observaciones, no percentiles ni máximos. Los relojes cliente/servidor tienen desfase visible; no se calcula una latencia unidireccional precisa a partir de ellos. Se conservaron todas las recepciones; no se observó ninguna después de confirmar la revocación del socket principal. Se cerraron ocho transportes de QA; los dos canales válidos seguían joined antes del cleanup.

Publish y revoke bloquean la MISMA fila hasta commit. La emisión usa `realtime.send` dentro de esa transacción. Además se bloquean filas canónicas de licencia, plan, dispositivo, actor y sesión durante la comprobación. No se integraron escritores compartidos ni se promete serialización de altas concurrentes de dispositivos hermanos frente al conteo max_devices.

Se probaron conexiones HTTP distintas con instrumentación QA temporal que mantiene el lock tres segundos. PostgreSQL mostró un backend esperando `Lock/transactionid` y su bloqueador en PgSleep en ambos órdenes:

1. Emisión primero: ENQUEUED a 06:19:12.972035 UTC; revoke esperando; barrera a 06:19:15.979011; llamada posterior EXCLUDED.
2. Revocación primero: barrera a 06:20:06.621707 UTC; publicación esperando; después del commit devuelve EXCLUDED.

El mensaje encolado por la primera transacción puede llegar después de confirmar revoke: transporte y commit son etapas distintas. No se debe etiquetar ese mensaje tardío como una nueva selección posterior. Un emisor con credenciales privilegiadas que evite el helper sigue pudiendo hacer Broadcast directo; el futuro emisor comercial deberá usar obligatoriamente esta barrera. No se presenta una consulta previa de elegibilidad como una garantía transaccional.

El grant Staff también venció por reloj real: socket joined, nueva suscripción Unauthorized, publicador EXCLUDED y GET Auth user 200 con JWT todavía vigente. **Grant 120s y JWT nativo 3600s son vigencias diferentes.** AUTH-28, expiración natural completa del JWT, permanece BLOCKED explícito.

## H. Autoservicio y límites de la certificación

Modificar role/app_metadata por `/auth/v1/user` fue denegado 403/not_admin. Cambiar user_metadata fue admitido, conservando el rol técnico y la app_metadata original. Cambiar contraseña y crear una nueva sesión Auth con esa contraseña también fue admitido. Esa nueva sesión no pudo unirse a un topic de grant todavía vigente: su session_id no tenía binding. Se cerró y luego se eliminó el usuario sintético.

No se observó escalada a permisos comerciales; sí existe capacidad residual de mutar la cuenta técnica y generar sesiones sin grant, con riesgo de disponibilidad/cuotas. No se certificaron MFA, identity linking, cambio de email u OAuth. No se intentaron envíos de correo. H sigue HOLD; no se propone un hook global como atajo.

El primer assertion del harness esperaba 200 al enviar metadata protegida y registró FAIL. La API respondió correctamente 403; se conservó ese intento y se corrigió la expectativa mediante una comprobación separada de user_metadata/rol protegido. No se oculta ese fallo del harness ni se interpreta como escalada.

## I. Escala y costos

Organización verificada: plan de infraestructura Free; no confundirlo con las licencias Lanzo FREE/PRO. SDK instalado y lockfile: supabase-js 2.87.1; no se modificaron dependencias versionadas. La candidata limita diez identidades en todo el experimento, cuatro runtimes por identidad, 20 solicitudes/dispositivo/minuto y 120 operaciones Auth/runtime. Sus tombstones y límites son deliberadamente de QA; no resuelven una implantación comercial indefinida.

Identidades aproximadas: tenants × dispositivos × sesiones Lanzo distintas. Pestañas multiplican sesiones Auth/grants/conexiones, no identidades. Renovación reutiliza el refresh de esa sesión; reconectar no crea otro usuario. Cambios rápidos de actor crean nuevas sesiones Lanzo y requieren retiro/colector. El colector es admin-only y acotado; no se instaló cron. Un inventario fuera de su ventana de escaneo debe reconciliarse expresamente.

Ejemplo de dimensionamiento, no consumo medido: 100 negocios × 2 dispositivos × 2 sesiones nuevas/día × 30 días son unas 12 000 identidades mensuales; cuatro pestañas por 200 dispositivos pueden demandar 800 conexiones. Free publica 50 000 MAU incluidos y 200 conexiones Realtime, 100 mensajes/s y 100 joins/s. Pro publica 100 000 MAU y USD 0.00325/MAU adicional; no se cambió el plan.

El broker actual refresca Auth al renovar fuera del caché corto. Cuatro pestañas renovando cada ~90s generan ~2.67 refresh/min/dispositivo. El límite Auth documentado por defecto de token es 150/5min/IP; muchas instancias detrás de una IP Edge pueden saturarlo. La configuración efectiva de esos límites y su consumo no se pudo leer con el conector; no se confunden los defaults con valores certificados del proyecto. Antes de producción se necesita presupuesto/retención, limpieza programada, límites por tenant, control de picos y evaluar reutilizar un JWT aún vigente para renovar sólo la concesión Lanzo. No se aceptó creación ilimitada de usuarios ni sostenibilidad comercial por simple extrapolación.

Fuentes consultadas: [límites Realtime](https://supabase.com/docs/guides/realtime/limits), [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits), [precios](https://supabase.com/pricing), [sesiones](https://supabase.com/docs/guides/auth/sessions), [autorización Realtime](https://supabase.com/docs/guides/realtime/authorization). Se revisó el changelog y el cambio TLS de noviembre; no exigió modificar esta implementación.

## J. Producción y limpieza

Se usaron dos tenants, dispositivos y actores sintéticos del inventario. No se reutilizaron identidades de consumidores. Hubo cinco bindings, catorce grants y cuatro usuarios Auth presentes antes del retiro. Dos intentos adicionales con fallo inyectado compensaron sus usuarios inmediatamente. El colector retiró cinco identidades privadas y borró los cuatro usuarios Auth restantes. Postflight confirmó cero usuarios, sesiones e identidades Auth de esos IDs, cero fixtures Lanzo, rol/esquema/funciones propios ausentes y las tres políticas Realtime originales.

El ledger pasó de 312 a 316 entradas, conservando explícitamente:

| Versión | Alcance |
|---|---|
| 20261021045416 | Fundación QA temporal |
| 20261021061233 | Instrumentación temporal de carrera |
| 20261021061734 | Ventana de ensayo reducida a 3s |
| 20261021062854 | Rollback de todos los objetos QA |

No son aprobación de un contrato comercial ni migraciones compartidas pendientes en el árbol ejecutable. Sus fuentes y rollback quedan en candidates. No se hizo db push, repair, CASCADE de objetos compartidos, rotación, hook o cambio de expiración. No se borró auditoría de Auth ni retención de mensajes QA de la plataforma.

La divergencia anterior sigue documentada: restaurante remoto 20260929091708; alias remotos 20261006224032 ↔ local 20261006181758 y 20261008030859 ↔ local 20261008013643; preview legal local 20261008180000 sin despliegue. Las cuatro entradas QA adicionales deben figurar en un manifiesto de reconciliación separado; no aplicar automáticamente Restaurante/legal ni esconder el experimento mediante repair.

[Inventario](evidence/ecom-realtime-auth-1a2/resource-inventory.json), [limpieza Auth](evidence/ecom-realtime-auth-1a2/auth-cleanup.json), [postflight](evidence/ecom-realtime-auth-1a2/postflight.json). Se confirmó la eliminación de ambos endpoints QA: sólo permanecen lanzo-ai-agent v46 y authorize-image-upload v28. El proyecto terminó ACTIVE_HEALTHY.

## K–M. Matriz integrada, riesgos y siguiente fase

| Casos | Estado / nivel real de cobertura |
|---|---|
| AUTH-01–06 | PASS broker Hosted; SQL canónico también probado |
| AUTH-07–10 | PASS Realtime real; firma, topic y sesión Auth sin binding |
| AUTH-11–13 | PASS reloj real, socket vivo, nueva emisión y renovación |
| AUTH-14 | HOLD integración React/actor físico; descarte de contexto PASS en servicio simulado |
| AUTH-15 | PASS de broker multitenant y rechazo de cruce Realtime; cambio físico de tenant NOT RUN |
| AUTH-16 | PASS concesiones broker para dos dispositivos; matriz completa de sockets físicos NOT RUN |
| AUTH-17 | PASS concurrencia Hosted y límite real de runtimes; liderazgo entre pestañas no implementado |
| AUTH-18–20 | PASS de servicio con dobles: cierre tardío, backoff y error autoritativo; render React/Strict Mode físico NOT RUN |
| AUTH-21–24 | PASS rechazo real Broadcast, Presence, RPC y tabla |
| AUTH-25 | PASS de negativos medidos; HOLD cobertura completa de autoservicio |
| AUTH-26 | PASS Auth real con fallo HTTP inyectado + compensación SQL; respuesta perdida tras commit sólo unitaria |
| AUTH-27 | PASS reintentos/concurrencia real, un solo grant/identidad |
| AUTH-28 | BLOCKED: no se esperó expiración natural de 3600s |

Las 13 pruebas nuevas de broker/receptor y los 11 contratos Node existentes pasaron, también sobre main integrado: 24 PASS, cero fallos. Las 11 comprobaciones SQL finales pasaron con ROLLBACK, incluido el aislamiento de las RPC propias por firma exacta. Deno check terminó con exit 0; lint focal exit 0; React Doctor 100/100, sin incidencias.

Antes de actualizar main, el build POS/PWA y postbuild verificó 24 assets y Store completó su build en 46.95s. Después del rebase, el bundle POS terminó, pero no se obtuvo confirmación completa de PWA/postbuild ni Store. El runner Vitest de seis archivos sólo registró RUN, sin reporte final. **Esos resultados incompletos siguen HOLD/NOT RUN, nunca PASS.** Deben completarse en CI/QA del SHA publicado. [Validación local y límites](evidence/ecom-realtime-auth-1a2/local-validation.json).

Intentos conservados: un SQL de test tenía un identificador ambiguo y se revirtió; el ensayo ACL necesitó permiso INSERT a su tabla temporal de resultados, sólo dentro de la transacción; un primer bundle recibió texto de timeout del ejecutor en lugar del archivo y fue rechazado antes de desplegar; imports/red del runner local fallaron y se cambió a la ruta real del SDK y resolución IPv4. La lease/grant inicial expirado no se reutilizó para fingir una emisión correcta. Las primeras carreras por un único conector SQL no demostraron simultaneidad; las decisivas usan HTTP independiente y pg_stat_activity. La instrumentación inicial de 8s terminó en HTTP 500: se conservó y redujo a 3s, sin atribuir una causa no probada. No se contó ningún intento sin resultado como PASS.

Condiciones de merge: aprobación específica de seis ACL y consumidores legítimos, regresiones operativas de esos consumidores, extremos Auth, expiración JWT natural, dimensionamiento/limpieza para producción, integración Actor Runtime/React con QA física, revisión de todos los escritores canónicos y del futuro emisor comercial. Un cliente con contexto local offline no obtiene autoridad cloud. No se integrará order_created ni avisos antes de cerrar esos gates. Fase 1B permanece bloqueada.
