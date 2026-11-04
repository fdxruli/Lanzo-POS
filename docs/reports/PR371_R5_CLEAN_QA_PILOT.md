# PR #371 — R5: piloto v2 en negocio QA nuevo

**Dictamen: `PR371_R5_PILOT_READY_LOCAL`.** El candidato permite un piloto expresamente autorizado, creado desde cero. La instalación es inerte: no activa v2 para ningún negocio. Se ejecutó V completa y la prueba focal en PostgreSQL 17.11 aislado. No se publicó código, no se instaló SQL remoto y no se creó ni activó un negocio en Production. Falta QA funcional real antes de considerar merge.

## Referencias y trazabilidad

- main remoto: `622f29a84bfc6b82e7230e7dbbebd93aa6f02828`.
- #371 OPEN / Draft, HEAD remoto `2f33cea480f3d478f797b495b168feac9aed483f`. Su base remota sigue siendo `fix/financial-credit-limit-enforcement-r1`; no se retargeteó.
- #374 OPEN / Draft, HEAD `a3bce02de50c92bef9b93345a1fe1c511feab95e`, base #371, sin modificaciones.
- HEAD local inicial R4: `2ec1eedb34f877f6e782742e4ae960efa5efd6e0`, árbol limpio. R5 prepara un commit normal sobre él; su SHA se entrega aparte. Se conservan R3 `4d803d48d2843ce19fc586fefa7a72e91fa4e815`, R2 `3e688654e7bcb985fe5c649e630ad6f04f454099` y el merge normal con main.
- Worktree reutilizado: `C:/Users/pituf/.codex/worktrees/cloud-sync-protocol-v2-fin01-r1/Lanzo-POS-Git`. Checkout principal y stash de recuperación R2 preservados.
- Production `odlrhijtfyavryeqivaa`: `list_migrations` confirmó F `20261022135915` instalada y V `20261023033028` ausente; Q ausente según la evidencia disponible. R5 no ejecutó SQL en Production, ni siquiera consultas de catálogo. No cambió licencias, dispositivos ni datos remotos.

## Gate mínimo y estado inicial

V canónica incorpora dos tablas privadas con owner postgres, RLS y sin permisos para PUBLIC, anon, authenticated o service_role. Una registra protocolo, generación y referencias de autorización; la otra acredita la admisión temporal de una llamada v2. No hay backfill, licencia habilitada por defecto, nueva RPC pública de activación ni migración Q.

Un trigger de creación de licencia registra solamente protocolo 1 y su transacción de nacimiento. La función administrativa privada `pos_fin01_set_clean_qa_protocol_v2(uuid,integer,bigint,text)` es SECURITY INVOKER y sólo el owner puede ejecutarla. Las capacidades y features del cliente no conceden esta autoridad.

La primera activación a 2 exige la **misma transacción que insertó la licencia nueva**, generación 1, referencia explícita y ausencia de dispositivos, clientes, deuda/ledger, ventas/pagos, Caja, inventario financiero, operaciones, claves, eventos y autorizaciones/recibos históricos. Una licencia existente o ya confirmada en v1 no puede convertirse en piloto con este mecanismo, aunque parezca vacía. No se borra nada para satisfacer el requisito. La transacción de creación impide que la nueva identidad haya estado antes disponible para una PWA autorizada desconectada.

El helper de entrada resuelve tenant, dispositivo y sesión mediante el validador existente y comprueba la política del servidor. Cada una de las once RPC conserva después sus autorizaciones, permisos y controles financieros originales. El servidor inserta una admisión privada por transacción y tenant; no acepta una bandera de origen ni un GUC como acreditación. El envelope elimina la admisión al retornar; una excepción revierte su inserción. Se comprobó que no queda permiso residual tras éxito, replay ni error.

Una única función de trigger contiene escrituras INSERT/UPDATE/DELETE en ocho tablas compartidas: clientes, ledger, ventas, ítems, pagos de venta, sesiones de Caja, movimientos de Caja y operaciones financieras. Rechaza escrituras del piloto sin admisión v2 con `CLOUD_CLIENT_UPDATE_REQUIRED` / SQLSTATE P0001, detalle `QA_PILOT_REQUIRES_V2`. También revisa ambos tenants si cambia `license_id`. Así cubre las variantes públicas compartidas sin reescribir los catorce wrappers ni revocar sus permisos globalmente. El error aborta los efectos de la sentencia financiera; no se fabrica éxito.

La admisión toma un lock compartido por tenant y el cambio administrativo toma el exclusivo. Discovery/entrada bloquean además la fila de política durante su lectura. La desactivación espera las llamadas admitidas; la primera activación sólo admite la identidad recién creada. El test R5 es secuencial: no se declara certificación de carreras entre procesos.

## Desactivación y recuperación

El owner puede pasar a protocolo 1 usando la generación esperada y una referencia de cambio. No se borran claves, recibos ni operaciones; se conserva la autorización de activación inicial por separado del motivo del último cambio. Una orden administrativa con generación vieja se rechaza.

Un piloto detenido anuncia `RECOVERY_ONLY`: únicamente recibos v2, con la misma identidad y hash. Los nuevos writes v2 se rechazan tanto en discovery del cliente como directamente en el servidor. No hay fallback automático a v1. Las rutas v1 recuperan su comportamiento autorizado y el replay v1 de una operación ya completada conserva el resultado original.

Esta reversión no autoriza reactivar a 2 un tenant usado. Para repetir el piloto se crea otra identidad QA limpia; volver a habilitar un negocio con posibles pendientes requiere la recuperación adicional fuera de R5. Antes de una desactivación operativa se debe detener la generación de trabajo y comprobar los pendientes de los dispositivos del piloto. Un intento sin recibo no se convierte en éxito ni se reenvía con una clave nueva: conserva su evidencia y queda pendiente de recuperación.

## Pruebas efectivamente ejecutadas

Se reutilizaron el clúster R2/R3 y `fin01_cert_r2`, PostgreSQL **17.11**, loopback `127.0.0.1:55849`. Se envió el archivo V íntegro con sus guards, DDL, transformación del dispatcher, ACL, NOTIFY y COMMIT, sustituyendo transaccionalmente sólo objetos R5 candidatos vacíos del ensayo anterior. No se omitió ningún guard. No se copió Production ni se volvió a ejecutar F.

El fixture conserva funciones financieras reales del catálogo R3 y datos exclusivamente sintéticos. Se añadió una dependencia real que faltaba para la ruta compartida de Caja: `private.cash_audit_allowed(jsonb)`, tomada de `supabase/migrations/20260624045720_fase3_caja_cloud_pro.sql`. El único doble externo heredado es `realtime.send`; no se simuló autorización, dispatcher, cálculo financiero, recibos o idempotencia.

| Comprobación | Resultado |
| --- | --- |
| V íntegra | PASS en PostgreSQL aislado; aplicación completa del candidato actual. |
| Gate apagado / negocio anterior | Discovery no concede v2. Venta v1 autorizada real genera deuda $10. No se activa automáticamente ninguna licencia. |
| Proveniencia limpia | Nueva licencia sintética, cero dispositivos, historial y claves antes de activación. Tenant anterior y nuevo tenant con un dispositivo son rechazados sin borrar ese dispositivo. |
| Activación / permisos privados | Cliente anon no puede activar ni insertar admisión. Dos tablas con RLS y cinco helpers cerrados a los tres roles cliente/servicio; owner y search_path comprobados. |
| Discovery y once RPC | PASS real: directorio upsert/batch/delete/snapshot/changes, crédito summary/snapshot/changes/payment, dispatcher y recibo. Las doce funciones públicas conservan postgres, SECURITY DEFINER, search_path vacío y grants explícitos. |
| Coexistencia simultánea | Mientras el piloto está en 2, una escritura pública v1 de Caja de otro tenant sigue funcionando bajo anon. |
| Legacy del piloto | Rechazados upsert compartido, movimiento público de Caja y dispatcher v1 antes de efectos financieros persistidos; sin reservas residuales de sus claves. GUCs de origen inventados no permiten eludirlo. |
| Llamadas internas compartidas | Dispatcher v2 bajo anon abre Caja usando funciones compartidas reales; venta a crédito y pago v2 completan sus efectos sin bloqueo por el gate. |
| Recibo y saldo | Venta $10, pago posterior $5, saldo vigente 500 centavos. Tres consultas y tres retries de la venta preservan K/H y resultado original con deuda 1000; tres retries del pago dejan saldo 500. |
| Duplicados | Contadores antes/después de retries: ventas 1/1, ledger 2/2, movimientos de Caja 1/1, operaciones 2/2 y claves 6/6. Las dos operaciones son apertura de Caja y venta. El abono usa ledger/Caja. |
| Fronteras | Otro dispositivo no obtiene el recibo; hash incompatible no devuelve resultado; execute con hash incorrecto se rechaza. Sesión y token de dispositivo inválidos, permiso de staff ausente, tenant sin activar y capacidad financiera ausente son rechazados. |
| Cliente de otro tenant | Pago devuelve el rechazo de negocio persistido `CUSTOMER_NOT_FOUND`, sin cambiar deuda, ledger, Caja u operaciones. Puede conservar una clave adicional de ese rechazo: no es un efecto financiero ni un duplicado. |
| Stop / replay | Generación vieja rechazada; stop conserva aprobación inicial, recibo v2 y replay v1 originales; bloquea nuevas escrituras v2 y reactivación de tenant usado. |
| Dependencias anteriores | 54/54 hashes y 54/54 comparaciones owner/search_path/ACL de anon/authenticated/service_role sin cambios. Cuatro alteraciones negativas (owner, ACL, estado restaurante, hash) abortan V y se revierten. |
| Cliente automatizado | **19/19 Vitest** del contrato v2: incluye gate no activado sin write/fallback y recuperación tras stop con execute ausente. |
| Contrato estático | **7/7 Node**; se distingue de la ejecución PostgreSQL anterior. ESLint focal y `git diff --check` sin errores. |

El SQL reproducible `supabase/tests/fin01_cloud_sync_v2_clean_qa_pilot_r5.sql` devuelve `R5_CLEAN_QA_PILOT_PASS` y revierte íntegramente su transacción. La prueba representa dos identidades autorizadas de dispositivo, **no dos PWA reales**. El esquema candidato permanece sólo en la base aislada; no quedan tenants ni admisiones R5. Se detiene el servidor aislado al finalizar.

Durante la preparación, el primer ensayo de Caja detectó el helper real ausente del fixture. Otro intento negativo esperaba una excepción donde el contrato de pago devuelve un error de negocio; se corrigió la aserción y se comprobó ausencia de efectos. Ninguno de esos intentos se contabiliza como PASS; los resultados corresponden a la ejecución final completa.

Evidencia local conservada en `C:/dev/Lanzo-POS-Git/.tmp/pr371-r2/`: `r5-apply.log`, `r5-sql.log`, transporte R3 reutilizado, suplemento real de Caja y resultados de los 54 guards. No se ejecutaron las 169 pruebas R2, builds generales ni una auditoría adicional.

## Archivos y siguiente acción

- V canónica `supabase/migrations/20261023033028_fin01_cloud_sync_protocol_v2_r1.sql`: política privada inerte, admisión, triggers compartidos y discovery/recuperación por tenant. No modifica los cuerpos v1 ni reconstruye el dispatcher.
- `supabase/tests/fin01_cloud_sync_v2_clean_qa_pilot_r5.sql`: prueba real focal, sintética y con rollback.
- `src/services/sync/__tests__/cloudSyncProtocolV2.test.js`: dos casos de negociación del gate; sin cambio al runtime del cliente.
- Este informe: evidencia, condiciones del negocio nuevo y límites.

F queda intacta, Q no se implementa y el informe/pruebas R4 se conservan. **Los negocios existentes permanecen en v1**; R5 no certifica su migración, drenaje universal ni recuperación de PWA antiguas con operaciones ambiguas. Tampoco certifica todos los flujos de apartados, split, inventario, integraciones o restaurante; las dependencias actuales y sus protecciones no se modificaron. No se demostró un bloqueo estructural para este piloto limpio.

La preparación local puede presentarse al propietario para autorizar publicación y QA posterior. La siguiente acción mínima es revisar este commit y aprobar un destino de prueba/instalación controlada de V. Sólo después, con autorización explícita separada, provisionar un negocio PRO/Nube nuevo y activar la política **en la misma transacción administrativa de creación, antes de dispositivos o datos**, documentando su identidad y aprobación. Si el provisionador actual no conserva esa transacción, no activar un QA existente como atajo: preparar esa operación administrativa focal.

Todos los dispositivos del futuro piloto deben empezar con perfiles/datos locales nuevos y cliente v2 comprobado; una licencia nueva no demuestra por sí sola que un navegador reutilizado no arrastra colas locales ajenas. Registrar los dispositivos después de activar y comprobar que sus colas están vacías antes del primer uso. Luego ejecutar QA real de sincronización entre dispositivos, desconexión/reconexión, recibos y retries. Ninguno de esos pasos remotos está ejecutado o autorizado por esta entrega. **No está listo para merge ni lanzamiento comercial.**
