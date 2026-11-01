# LANZO POS — Fase 1A.1: Auth nativo, ACL y revocación Realtime

Fecha: 2026-10-20, America/Mexico_City. Proyecto exclusivo: odlrhijtfyavryeqivaa.

**Resultado: AUTH_NATIVE_HOSTED_PROVEN / SHARED_DEPLOYMENT_HOLD. Fase 1A aún no cerrada; Fase 1B no iniciada.**

B-01 queda demostrado para emisión nativa y transporte con un rol PostgreSQL especializado de QA. B-02 sigue HOLD para aplicación compartida: la corrección funciona, pero cambia privilegios efectivos de otros roles. B-03 tiene mediciones reales de acceso residual; no hay revocación instantánea ni certificación de cierre al vencimiento natural del JWT. Se recomienda continuar con Auth nativo y concesiones Lanzo explícitas, bajo el contrato descrito abajo.

## 1. Preflight y alcance

Se leyeron el informe R2 completo, su candidata, generador, pruebas, evidencia, fixtures y rollback. R2 no se consideró desplegada. Se aplicaron las skills Supabase y Postgres Best Practices; no hubo delegación.

- Checkout principal preservado: C:/dev/Lanzo-POS-Git, main, HEAD 54c4f9e83068bf6d1578f785877f4cc85a90552a; 6 commits adelante y 34 detrás de origin/main. Archivos de recuperación sin seguimiento conservados.
- Fetch origin realizado antes de cambios. origin/main: f014a1f340ed78335d3e704eefff49cda8465115.
- Referencia R2: codex/ecom-realtime-auth-r2, HEAD 4e37703198caeb91531af1bd1a8ec5238b80da01.
- Worktree nueva: C:/dev/Lanzo-POS-ecom-auth-1a1; rama codex/ecom-realtime-auth-1a1, creada desde R2. No se halló AGENTS.md en árbol o padres comprobados.
- Ledger productivo antes y después: 312 versiones; máximo 20261008161409. Sin db push, repair o modificación de migraciones históricas.
- No se modificó src, store, api, paquetes, configuración comercial o migraciones ejecutables. Las dependencias locales se reutilizaron mediante junction node_modules, ignorada por Git.

[Estados GitHub consultados](evidence/ecom-realtime-auth-1a1/prs.json): #366 OPEN Draft, HEAD 11f6115afc843e55dcfa0780842c326db752bd90; #338 OPEN Draft, fef7205f76b173025f503e60d0968f446f741e78; #352 OPEN Draft, d758f69b2119f1bc346eb0ac86ba0a74c0265668, mergeable=false. No se alteraron sus ramas ni estados. No se creó PR de esta fase, no hubo push, merge, despliegue frontend o Edge.

## 2. B-01 — resultado real de Auth nativo

SDK instalados supabase-js/auth-js/realtime-js: 2.87.1; Node 24.18.1. El SDK incluye AdminUserAttributes.role. El servidor respondió GoTrue v2.197.0 en /auth/v1/health.

Se obtuvo la credencial administrativa ya disponible mediante la CLI autenticada, capturando su salida exclusivamente en memoria. Nunca se imprimieron valores de claves, contraseñas, access_token o refresh_token ni se enviaron al frontend comercial. No se extrajo una clave privada de firma.

La llamada real auth.admin.createUser, con email_confirm=true, contraseña aleatoria y role=qa_ecom_1a1_f748296e, creó exclusivamente el usuario sintético 7fbeaf5b-d4d5-4119-acad-eb0a66ee33fb. signInWithPassword emitió un JWT firmado por Auth con ese rol. Un cliente real, separado del publicador privilegiado, recibió qa_probe en un canal privado.

Claims observados: iss=https://odlrhijtfyavryeqivaa.supabase.co/auth/v1; aud=authenticated; sub=UUID de auth.users; session_id=UUID de auth.sessions; exp-iat=3600 segundos. El scope de QA está en app_metadata, no en el nivel superior. Una renovación mantuvo rol y session_id.

**Esto demuestra el camino nativo sin rotar claves, activar hooks o modificar configuración global. No despliega ni certifica el adaptador de claims R2.** R2 exige otro issuer/audience, sub=actor Lanzo, claims superiores y exp igual al grant de hasta 300s. Un JWT nativo ordinario no satisface ese contrato. No se debe cambiar sólo la comparación de issuer para hacerlo pasar.

Hosted asumió el rol sin concederlo a authenticator o supabase_realtime_admin. El rol NOLOGIN/NOINHERIT/NOBYPASSRLS carecía de roles heredados y privilegios de sistema. PostgreSQL creó automáticamente una membresía administrativa postgres→rol QA con inherit=false y set=false; no se amplió manualmente. Las pruebas SQL R2 sí añaden una membresía al runner dentro de una transacción revertida, igual que R2.

El primer join falló con MissingPartition. Se conservaron particiones/ACL y código oficial consultado; no se crearon/repararon particiones. El control service_role sobre el mismo topic y la repetición del receptor suscribieron después. No se atribuye una causa raíz no demostrada ni se oculta ese intento.

[Evidencia Auth/Realtime, incluyendo intentos](evidence/ecom-realtime-auth-1a1/native-auth.json). [Objetos QA realmente utilizados](evidence/ecom-realtime-auth-1a1/qa-setup.sql).

## 3. Autorización real y límites de cobertura

La prueba Hosted usa una allowlist QA privada con topic, auth user, auth session, scope, tenant sintético, revocación y expiración; RLS habilitado y sin lectura directa del receptor. Su helper SECURITY DEFINER sólo devuelve un booleano, tiene search_path vacío y EXECUTE explícito exclusivo. Comprueba sesión Auth viva, issuer/audience/role, app_metadata de ejecución y scope. El tenant de la fila es inventario; la autoridad de tenant/actor/dispositivo Lanzo sigue cubierta por las pruebas SQL R2, no por este helper de transporte.

| Caso ejecutado con cliente Realtime real | Resultado |
|---|---|
| Topic propio y qa_probe real | PASS; join observado 651 ms en una conexión, sin garantía de latencia máxima |
| Topic QA ajeno y topic con otro tenant nominal | PASS: Unauthorized; no equivale a integración con dos tenants Lanzo reales |
| Dos concesiones simultáneas, dos sesiones Auth, mismo usuario sintético | PASS: ambas suscriben y los cruces de topic se rechazan |
| Otro session_id, mismo usuario y rol | PASS: Unauthorized hasta vincular su concesión propia |
| Scope incorrecto en JWT realmente firmado por Auth | PASS: Unauthorized |
| Firma JWT manipulada | PASS: JwtSignatureError |
| Publicar Broadcast qa_probe / Presence desde receptor | PASS: ambas operaciones devuelven error |
| Tabla comercial REST | PASS de rechazo de gateway: 403/42501, permission denied to set role |
| RPC administrativa REST con firma correcta | PASS de rechazo de gateway: 403/42501; no demuestra que EXECUTE haya desaparecido |
| Autoridad Lanzo completa con JWT nativo adaptado | BLOCKED: adaptador y broker aún no implementados |
| Cambio real de actor/tenant Lanzo, sesión Admin reemplazada con socket | NOT RUN; negativos SQL R2 y sesiones Auth distintas no sustituyen esta integración |
| JWT firmado que vence naturalmente y reconexión posterior | NOT RUN: TTL nativo observado 3600s; no se modificó el global ni se esperó su vencimiento |

El primer intento REST de RPC usó nombres de parámetros incorrectos y devolvió PGRST202. Se repitió con p_admin_device_fingerprint y p_admin_security_token correctos; sólo el 403 posterior cuenta como rechazo de credencial. El runtime de QA se reinició por timeout de una consulta Git después de guardar la evidencia Auth y eliminar el usuario; no se usó ese timeout como prueba funcional.

Las tres políticas originales se mantuvieron para anon/authenticated y no aplican al rol especializado, que no es miembro de esos roles. La única política nueva era SELECT broadcast para el rol QA y se retiró. No hubo política INSERT/Presence ni acceso a tablas comerciales. Los ensayos R2 también verificaron los privilegios y una lectura SQL realmente denegada de licenses.

**La unidad de autorización es el topic.** La política SQL no filtra por event; el cliente de prueba escuchó broadcast con event='*'. Sólo se emitió qa_probe, como estaba autorizado. Por inspección de la política y funcionamiento documentado del caché, otro evento broadcast enviado a un topic autorizado quedaría dentro de ese permiso. No se emitió otro evento para pretender demostrarlo empíricamente. Un filtro UI no protege datos: el publicador debe permitir únicamente eventos y payloads aprobados, y no mezclar información sensible en esos topics.

## 4. B-02 — seis firmas, overloads y ACL efectiva

Se identificaron nueve overloads en total: los tres históricos de staff ya estaban restringidos a postgres/service_role; seis firmas vigentes heredaban EXECUTE de PUBLIC además de sus grants explícitos. Las firmas exactas y rollback son los de la candidata R2, que se conservaron sin modificación:

- [Seis REVOKE y gates explícitos](../../supabase/candidates/ecom-signal-auth-r2/public-rpc-acl-proposal.sql).
- [Rollback: restaurar únicamente esos seis grants PUBLIC](../../supabase/candidates/ecom-signal-auth-r2/public-rpc-acl-rollback.sql).

No se aplicó REVOKE global, coincidencia parcial ni cambio de cuerpos.

Consumidores inspeccionados: licenseService.js para listar/crear/editar staff; cashCloudRepository para estado/adopción y cierre administrativo; financialIntentLedger para estado de caja. Su autoridad sigue en parámetros y verificadores canónicos Lanzo, no en una sesión Auth sintética. No se certificaron clientes externos desconocidos ni una operación financiera real autorizada.

Se ejecutó otra vez la candidata y fixtures R2 íntegros con BEGIN/ROLLBACK: **88 PASS y 1 FAIL**, que sigue siendo el requisito de aislamiento PUBLIC. Después se simuló la propuesta y se compararon 33 roles × 6 firmas: cero SECURITY DEFINER públicas ejecutables por el receptor, y los 18 permisos de anon/authenticated/service_role permanecieron. postgres y supabase_admin también conservaron EXECUTE. En otro ensayo, seis invocaciones bajo un rol sin grants devolvieron realmente SQLSTATE 42501 tras el REVOKE, antes de poder usar la validación interna de las RPC. Todo fue revertido.

**Impacto pendiente:** 28 de los 33 roles pierden el permiso directo heredado en las seis firmas. Incluye authenticator, dashboard_user, supabase_auth_admin, supabase_realtime_admin, supabase_storage_admin y roles de mantenimiento. La lista y matriz completas están en la evidencia. Esto no significa que todos sean consumidores de esas RPC: authenticator puede seguir pasando a anon/authenticated/service_role, cuyos permisos se conservan. Tampoco permite afirmar compatibilidad universal sin revisar posibles llamadas directas. No se añadieron grants preventivos a todos ellos: eso daría autoridad innecesaria y podría reabrir la superficie.

**B-02: CORRECCIÓN_TRANSACCIONAL_PASS / APLICACIÓN_PERSISTENTE_HOLD.** Antes de aprobar aplicación, el propietario debe revisar ese delta y decidir los roles directos legítimos, documentar llamadas externas y completar regresión operativa autorizada. Los cuerpos y ACL de los nueve overloads volvieron al baseline. El rechazo actual de PostgREST por ausencia de membresía no elimina EXECUTE heredado por PUBLIC, y no satisface por sí solo el requisito estricto.

[Matriz completa](evidence/ecom-realtime-auth-1a1/acl-result.json), [resumen](evidence/ecom-realtime-auth-1a1/acl-summary.json), [ensayo SQL reproducible](evidence/ecom-realtime-auth-1a1/acl-transaction.sql), [seis rechazos efectivos](evidence/ecom-realtime-auth-1a1/acl-execution-denial.json).

## 5. B-03 — mediciones de revocación

Revocación de grant confirmada a 2026-10-20 17:59:34.216 America/Mexico_City (23:59:34.216 UTC). Se enviaron sondas desde el cliente servidor privilegiado, únicamente a topics QA, y se observaron recepciones posteriores:

| Nivel | Observación |
|---|---|
| Grant revocado, conexión existente | Recibió 3 qa_probe después del commit; el último a 23:59:37.967 UTC, unos 3.75s después del timestamp de revocación. Hay desfase de relojes/red no cuantificado; no es latencia máxima de revocación. |
| Grant revocado, nueva conexión | Unauthorized, aproximadamente 4.83s del intento de join. |
| Grant revocado, access_token nuevo | Canal observado closed; no se recibió la sonda posterior durante la ventana observada. No es garantía universal de tiempo de cierre. |
| Sesión Auth cerrada mediante Admin signOut(local) | Refresh rechazado: refresh_token_not_found; reconexión rechazada por el helper que consulta auth.sessions. |
| Socket antiguo tras signOut | Permaneció joined y recibió sondas después. Un primer muestreo de 800ms vio false; la captura posterior mostró la recepción tardía. El resultado definitivo es acceso residual, no expulsión. |
| Grant expirado por reloj real, JWT aún vigente | Socket joined y recibe qa_probe; conexión nueva rechazada. |
| Renovación Auth con grant vencido | Auth la admite: Auth desconoce el grant Lanzo. El broker deberá rechazarla antes de emitir al cliente. |
| Expiración natural de JWT de 3600s | NOT RUN; no hay medida exp→último evento/cierre. |

Las pruebas SQL R2 vuelven a rechazar renovación por sesión Lanzo revocada/expirada, actor/generaciones anteriores, dispositivo inactivo y licencia/permiso inválidos. Ese resultado no convierte Auth.refreshSession en un endpoint de renovación Lanzo autorizado.

**B-03: ACCESO_RESIDUAL_DEMOSTRADO / CIERRE_FORZOSO_Y_EXPIRACIÓN_NATURAL_PENDIENTES.** No se probaron exclusión atómica de futuras emisiones ni carreras revocación→selección→envío: aquí se publicó deliberadamente a topics revocados para medir el socket. Ese publicador es un instrumento de QA, no un fan-out comercial.

[Commit de revocación](evidence/ecom-realtime-auth-1a1/revoke-commit.json) y [trazas de recepción](evidence/ecom-realtime-auth-1a1/native-auth.json).

## 6. Decisión de arquitectura y ciclo de vida

**Ruta elegida para continuar: Auth nativo como firmante, con broker servidor y concesiones Lanzo como autoridad.** No se justifica rotación ni emisor externo sólo para emitir un JWT con rol especializado: ya funciona. No se incorpora Auth como un segundo login comercial permanente en esta fase.

Contrato propuesto, aún sin desplegar:

1. El broker valida online las credenciales Lanzo mediante el verificador canónico de R2. GRANTED local/offline no basta. Deriva tenant, dispositivo, actor, sesión y generaciones; el cliente no los elige como autoridad.
2. Identidad Auth sintética por sesión Lanzo y dispositivo, sin reutilizarla entre actores o tenants. Una identidad por actor compartida por todos los dispositivos dificulta aislamiento; una identidad por dispositivo atravesaría cambios de actor; una por grant multiplica registros y limpieza. Se propone identidad por sesión/dispositivo y sesiones Auth separadas por runtime/concesión, con inventario y límites. La selección final requiere probar concurrencia, coste y recolección.
3. Tabla privada de binding: grant_id→auth_user_id+auth_session_id, además de la identidad/generaciones canónicas del grant R2. El helper usa el sub y session_id nativos, valida issuer/audience/role/exp y scope de app_metadata administrada, consulta la sesión Auth y vuelve a comprobar authority_live. Los IDs Lanzo viven en el grant validado. user_metadata nunca decide autorización.
4. El JWT nativo se entrega sólo al cliente receptor aislado, que no hace signIn/setSession en el Supabase comercial. Password y refresh_token permanecen en el broker. La renovación pública del broker vuelve a validar Lanzo; Auth.refreshSession interno sólo se llama después y su éxito no equivale a autorización Lanzo.
5. Revocar/reemplazar sesión, actor o tenant invalida binding y grants; el broker cierra sesiones Auth, invalida refresh y limpia el usuario cuando ya no tiene bindings. Un job limitado recoge identidades huérfanas, con IDs propios y retención explícita. Los fallos parciales create-user/login/bind deben compensarse; ningún usuario QA o dispositivo real se reutiliza accidentalmente. Borrar usuario no invalida criptográficamente los JWT ya emitidos.
6. Cada grant tiene topic no reutilizable. El futuro publicador selecciona sólo grants vivos y revalida antes de enviar, con una barrera definida para carreras; al revocar deja de emitir a ese topic. Ésa es la defensa para el socket cacheado. No se ha implementado ni medido aún. Los payloads deberán ser señales mínimas y requerir RPC Lanzo para detalles.

El token nativo tiene 3600s aunque el grant R2 dure ≤300s. Acortar sólo expires_at del grant no acorta el permiso cacheado de una conexión. No se encontró/probó una API pública por usuario/concesión que emita un JWT Auth con TTL independiente. **Si el requisito de aceptación exige expulsión efectiva en ≤300s aun ante un publicador defectuoso, esta ruta permanece bloqueada con la configuración actual.** La decisión necesaria sería revisar confianza de un emisor externo con TTL corto, o una arquitectura de entrega con autorización por mensaje. Ambas son segmentos nuevos; no se configuraron. No se propone un hook global o cambio de jwt_exp como atajo.

Revisar también los endpoints Auth disponibles al poseedor del bearer sintético: acceso de autoservicio, cambios de credenciales y logout. No se certificaron en esta fase. La unión obligatoria al session_id y al grant debe impedir que una nueva sesión obtenida fuera del broker adquiera autoridad Lanzo.

## 7. Reconciliación del ledger, sin reparación

| Versión divergente | Procedencia y comparación | Acción pendiente |
|---|---|---|
| Remota 20260929091708, restaurant_payment_split_financial_r1 | Archivo de #338 con mismo ID; cuerpo LF coincide exactamente, MD5 41bebae3ef0ee16da6b09a919558aa9a. Historial de implementación flexible de Restaurante, incluido 460ae5e9c. | Incorporar su procedencia al manifiesto aprobado de despliegue; no reaplicar. |
| Remota 20261006224032, restaurant_atomic_settlement_3d1 | Corresponde al archivo local #338 20261006181758; origen 211d9b29e. 64447 vs 64445 caracteres; iguales tras trim; sin diferencia SQL demostrada aparte de espacios exteriores. | Resolver alias de IDs en la reconciliación de #338, no con repair automático. |
| Remota 20261008030859, restaurant_origin_cancel_contract_3d13 | Corresponde al archivo local #338 20261008013643; origen d397a523d. 8166 vs 8167 caracteres; iguales tras trim. | Documentar mapeo de IDs, no ejecutar ambas versiones. |
| Sólo main 20261008180000_create_legal_policy_previews | Introducida por 563dcb4215329ff033ad92d5684ea809f8c2f2d6; historial posterior 009f6ba6b y 31fadba8b. Crea estructura vacía de previews legales. Ledger y tabla productiva ausentes. | Decisión separada de despliegue/alcance legal; no arrastrarla con db push. |

La comparación de los tres cuerpos usa codex/pr338-main-reconciliation en HEAD fef7205f76b173025f503e60d0968f446f741e78. Se conservaron las dos sentencias remotas con IDs distintos en evidence, fuera de migrations. MD5 es identificador de comparación, no firma de seguridad.

**Ledger reconciliado en procedencia; historial remoto deliberadamente intacto y despliegue general todavía no habilitado.** No se creó una migración persistente nueva porque el contrato nativo y el alcance ACL siguen pendientes. Al aprobarlos, generar un ID propio con CLI, una migración aditiva y aplicación explícita de ese SQL; no db push de todo el árbol.

[Resumen y diferencias](evidence/ecom-realtime-auth-1a1/ledger-summary.json).

## 8. SQL, Auth y limpieza

La candidata R2 se instaló sólo dentro de la transacción de ensayo y se revirtió. Separadamente se instalaron temporalmente un rol/esquema QA únicos, una tabla de concesiones con dos filas, un helper booleano y una política SELECT privada. Esos objetos permitieron los clientes reales. **No es un despliegue persistente de la candidata.**

Se usó una identidad Auth sintética y dos sesiones. La primera se revocó localmente; al final se ejecutaron signOut(global), deleteUser y getUserById=404/user_not_found. La limpieza SQL selectiva sin CASCADE retiró política, helper, tabla, esquema, grants y rol. El ensayo adicional ACL creó otro rol sólo dentro de BEGIN/ROLLBACK.

Postflight: cero usuario/sesiones/identidades Auth de ese ID; roles/esquemas QA y R2 ausentes; cero licencias R2 sintéticas; las tres políticas originales; seis grants PUBLIC originales y hashes de los nueve overloads conservados; ledger 312. Los audit logs de Auth y registros QA de Broadcast pueden permanecer hasta su retención normal; no contienen credenciales en payloads. No se borró historial de auditoría ni mensajes globalmente.

[Inventario](evidence/ecom-realtime-auth-1a1/resource-inventory.json), [limpieza SQL](evidence/ecom-realtime-auth-1a1/qa-cleanup.sql), [postflight](evidence/ecom-realtime-auth-1a1/postflight.json).

## 9. QA y compatibilidad

**Vitest focal: 129 PASS / 0 FAIL / 0 pendientes, 12 archivos; exit 0. Node: 11 PASS / 0 FAIL.** Incluye los 9 archivos R2 y regresiones de ledger financiero, cierre administrativo y payload de cierre Cloud. Build y React Doctor no se repitieron: no hubo cambios React o de runtime.

La evidencia distingue transporte real, SQL y mocks. El recuento histórico R2 no se usa como ejecución nueva: aquí sí se repitieron las 89 comprobaciones SQL y los 11 contratos Node existentes. Las seis denegaciones EXECUTE y la matriz ACL son ensayos nuevos. Las pruebas de expiración de grant esperaron al reloj real; no equivalen a JWT nativo expirado.

Los resultados locales definitivos se registran en [local-validation.json](evidence/ecom-realtime-auth-1a1/local-validation.json). La repetición focal se ejecuta desde la worktree R2, cuyo runtime y lockfile son idénticos a esta rama; el primer intento desde la junction se detuvo sin resultado, no se contó como PASS. Los tests frontend usan mocks y no certifican Auth/Realtime/caja reales ni consumidores externos. No se hicieron ventas, cierres financieros, pedidos, inventario, checkout ni emisiones comerciales. No se habilitaron FREE Realtime, avisos ni Centro de Notificaciones. No se inició Fase 1B.

Compatibilidad de #366/#338/#352: no hay cambios de runtime/contratos compartidos en esta rama, por lo que esta entrega documental no interfiere con su código. No se certifica integración futura del broker o adaptador con esos PRs. Offline sigue sin conceder autoridad cloud; Staff, PRO y sesiones Lanzo conservan sus reglas.

## 10. Continuidad concreta para terminar Fase 1A

1. Revisar el delta de roles ACL y aprobar sólo los seis REVOKE exactos, con rollback revisado y consumidores legítimos identificados.
2. Acordar si se acepta revocación efectiva de entrega mediante topics que dejan de recibir emisiones, conservando una conexión residual hasta reautorización/TTL nativo, o si se exige un JWT con TTL ≤300s. Este último requisito necesita otra decisión de confianza/arquitectura.
3. Implementar y revisar el adaptador nativo/binding y el broker de ciclo de vida descritos, fuera del cliente comercial; no reutilizar Auth como sesión Admin.
4. Completar QA nativa con fixtures Lanzo reales: actor/tenant/dispositivo, reemplazo Admin, concurrencia/renovación, vencimiento natural del JWT, fan-out y carreras de revocación. Ensayar rollback completo y seguridad de endpoints Auth.
5. Con ledger/alcance aprobados, preparar la migración aditiva y pedir aprobación de aplicación compartida sobre el resultado revisable. Sólo después cerrar Fase 1A. Fase 1B y FREE comercial continúan HOLD.

Fuentes oficiales consultadas: [Auth Admin](https://github.com/supabase/auth/blob/master/internal/api/admin.go), [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization), [JWT claims](https://supabase.com/docs/guides/auth/jwt-fields), [sesiones Auth](https://supabase.com/docs/guides/auth/sessions), [código de autorización Realtime](https://github.com/supabase/realtime/blob/main/lib/realtime/tenants/authorization.ex), [códigos operacionales](https://github.com/supabase/realtime/blob/main/ERROR_CODES.md), [changelog](https://supabase.com/changelog). El changelog markdown se obtuvo por HTTP 200 después de que web.open rechazara su content-type; no se modificó configuración por sus avisos.
