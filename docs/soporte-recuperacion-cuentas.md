# Manual operativo de recuperación de cuentas — LANZO POS

**Manual vigente.** Versión candidata V2. La recuperación normal V1 del PR #407
está instalada y fue comprobada manualmente por el propietario. V2 está preparada
para revisión: **no usar sus funciones en Production hasta instalar exactamente
la migración autorizada**. El reporte de esta entrega registra los estados por separado.

## Guía rápida

Todos los archivos están en [`scripts/support/account-recovery`](../scripts/support/account-recovery/).
Abrir el archivo, copiarlo al SQL Editor, sustituir sus marcadores y ejecutar
**una operación cada vez**. No ejecutar la carpeta completa como un lote.

| Problema | Script / acción | Comprobación | Resultado esperado |
|---|---|---|---|
| Encontrar negocio | [01-buscar.sql](../scripts/support/account-recovery/01-buscar.sql) | UUID, nombre, contacto y propietario correctos | Una cuenta inequívoca; aún no acredita propiedad |
| Revisar cuenta | [02-diagnosticar.sql](../scripts/support/account-recovery/02-diagnosticar.sql) | Contacto verificado, casos, sesiones, estado | Elegir ruta sin secretos |
| Olvidó usuario o contraseña y controla correo | [03-emitir-normal.sql](../scripts/support/account-recovery/03-emitir-normal.sql), `password` | Entrega exclusiva a `delivery_email` | Canje en login devuelve usuario original |
| Primera vinculación con credenciales | Pantalla Recuperación + 03, `contact` | Solicitud backend, misma sesión | Cliente verifica correo en LANZO |
| Cambiar correo con credenciales | Pantalla Recuperación → solicitar cambio; 05 y 06 | Contraseña comprobada, buzón nuevo, aviso y plazo o buzón anterior | Contacto reemplazado al completar; nuevo login |
| Perdió todos los factores | [04-abrir-excepcional.sql](../scripts/support/account-recovery/04-abrir-excepcional.sql), 06 `approve`, 05, 06 | Dos fuentes externas verificadas, otro revisor, buzón nuevo, aviso, 48 h | Contacto nuevo; después 03 `password` |
| Verificar correo propuesto | [05-emitir-correo-caso.sql](../scripts/support/account-recovery/05-emitir-correo-caso.sql); [06-tramitar-caso.sql](../scripts/support/account-recovery/06-tramitar-caso.sql), `verify_new` | Código recibido de ese buzón | Solo registra posesión; todavía no sustituye contacto |
| Sospecha / disputa | [08-bloquear-sospecha.sql](../scripts/support/account-recovery/08-bloquear-sospecha.sql) o 06 `block` en caso abierto | Referencia a hechos y revisión | Recuperación congelada; sesiones Admin revocadas |
| Consultar resultado / respuesta perdida | [07-historial-caso.sql](../scripts/support/account-recovery/07-historial-caso.sql) | `state`, `completed_at`, auditoría | Saber si se completó antes de repetir |
| Falta identidad original o evidencia | Detener; registrar negativa en expediente restringido externo | No existe prueba fiable | Cuenta bloqueada; no crear propietario sustituto |
| Perdió dispositivo FREE | Recuperar cuenta si procede; procedimiento de dispositivos separado | ¿Existe respaldo o sincronización real? | Acceso no equivale a recuperar IndexedDB perdida |

01 y 03 funcionan con V1. Los demás scripts requieren V2. Durante la preparación
se permite ejecutar solo consultas de lectura en Production. Toda operación real
sobre contactos, credenciales o sesiones exige el caso y autorización correspondientes.

## 1. Qué recupera y qué necesita soporte

Recupera el acceso a la **identidad administrativa original** de un propietario
con correo verificado, y permite cambiar ese contacto mediante controles explícitos.
Sirve para FREE/Local y PRO/Nube. Soporte usa SQL Editor administrativo de Supabase,
correo manual oficial de LANZO y un archivo de evidencias restringido. No necesita
un panel Super Admin, una API de soporte, un servicio de correo pagado ni tickets nuevos.

No recupera automáticamente un dispositivo, ni amplía cupos, licencias o planes.
No reconstruye ventas, inventario u otros datos exclusivamente locales de un equipo
perdido. No crea identidades para negocios antiguos. Una contraseña nueva no anula
una suspensión comercial ni garantiza que una licencia vencida pueda iniciar sesión.

Trabajar en el proyecto Production acordado y comprobar nombre/referencia en el
Dashboard antes de ejecutar. Usar una identidad personal reconocible de operador;
no compartir contraseñas administrativas SQL. La cuenta SQL tiene facultades elevadas:
los procedimientos son controles para soporte, no una protección contra un DBA malicioso.

### Estado de la evidencia histórica

La revisión de esquema y conteos, sin modificar cuentas, encontró `licenses.owner_email`,
`organization_name`, identidad administrativa, perfil comercial, `license_events` y
`subscriptions` con proveedor y referencia. En la revisión del 6 de noviembre de 2026,
Production tenía **cero suscripciones y cero referencias de proveedor en esa tabla**.
Solo dos licencias tenían correo histórico y no era una prueba de correo verificado.
Había 23 licencias y 11 propietarios activos; esos conteos no establecen una relación
uno a uno ni acreditan personas.

`pos_sale_payments` y `pos_layaway_payments` son pagos de los clientes del negocio:
**no son pagos del negocio a LANZO**. Los eventos técnicos prueban operaciones,
no identidad civil ni titularidad contractual. No existe en el esquema revisado
un archivo de contratos/pagos verificados de LANZO que resuelva por sí solo E/F.
Soporte debe buscar originales preexistentes fuera de la aplicación. Si no existen,
la recuperación excepcional permanece bloqueada.

## 2. Identificar la cuenta correcta

Ejecutar 01 cambiando únicamente `BUSQUEDA` por una licencia exacta, UUID interno,
parte del nombre (mínimo tres caracteres) o correo completo. Las búsquedas no
interpretan `%` y `_` como comodines. Devuelve hasta 50 filas; refinar si es necesario.
No pegar contraseñas, tokens o códigos en la búsqueda. También busca correos históricos
con verificación consumida y correos de suscripción registrados. Encontrar una cuenta
por un contacto anterior no vuelve a autorizarlo: `recovery_email` siempre muestra
el contacto vigente y 03 solo entrega allí. Revisar historial/suscripciones en 02
para explicar una coincidencia histórica; nunca enviar al correo de búsqueda por
el simple hecho de haber localizado una cuenta.

| Campo | Uso |
|---|---|
| `license_id` | UUID interno de la cuenta. Usarlo en 02/03/04; no confundirlo con la clave comercial |
| `license_key` | Clave de licencia; sirve para localizar y para el login, no acredita al solicitante |
| `business_name` | Nombre de perfil; si falta, organización o producto registrado |
| `license_status` / `expires_at` | Estado comercial y vencimiento; no se modifican en recuperación |
| `owner_id` / `owner_username` | Identidad original activa. Nunca cambiarla por una cuenta nueva |
| `recovery_email` / `verified_at` | Contacto cuya posesión se verificó mediante código; canal normal autorizado |
| `historical_email_unverified` | Dato histórico de licencia, **no verificado** y no apto por sí solo para enviar un código |

Dos negocios pueden llamarse igual y un buzón puede pertenecer a varios negocios.
Elegir explícitamente UUID de licencia y propietario; contrastar el contexto con
registros anteriores de LANZO sin divulgar datos de otras cuentas. No entregar
al solicitante toda la lista de coincidencias ni el usuario antes del canje normal.

02 devuelve `account`, `cases`, `requests`, `active_admin_sessions`, `active_devices`,
`subscription_references` e `history`. `requests` distingue emitido, vencido,
consumido e invalidado, con sus cinco intentos. Los conteos de dispositivos/sesiones
son informativos, no autorizan liberar equipos. `subscription_references` solo
orienta una investigación externa. Un resultado nulo significa cuenta no encontrada.
No contiene hashes, códigos, contraseñas ni tokens.

Un caso lleva `id`, `kind` (`authenticated`, `exceptional` o `security_hold`), `state`, correos,
solicitud/sesión original, evidencias, revisor, referencias de aviso y fechas.
`not_before` es el primer momento posible de cierre, **no una aprobación**.
`expires_at` termina el plazo operativo de siete días. Un caso expirado o bloqueado
sigue congelando la recuperación normal hasta que soporte lo cancele explícitamente.
La auditoría conserva `case_id`, `challenge_id`, operador declarado, actor SQL y fecha.

### Consultas compatibles con V1 antes de instalar V2

01 puede usarse inmediatamente. Para diagnosticar contacto/solicitudes V1 sin V2:

```sql
with cuenta as (select 'UUID_LICENCIA'::uuid as id)
select c.license_id,c.admin_user_id,c.email,c.verified_at
from private.admin_recovery_contacts c join cuenta x on x.id=c.license_id;
```

```sql
select id as request_id,purpose,email,requested_at,issued_at,expires_at,
       failed_attempts,consumed_at,invalidated_at
from private.admin_recovery_challenges
where license_id='UUID_LICENCIA'::uuid order by requested_at desc;
```

No usar `select *` sobre usuarios, sesiones o dispositivos: contienen secretos.

## 3. Árbol de decisiones

1. **¿Hay señales de correo comprometido o disputa de propiedad?** Sí → H; no
   emitir contraseña al buzón cuestionado. No → continuar.
2. **¿Existe propietario administrativo original activo?** No → bloquear E/F,
   buscar registros históricos; esta entrega no crea ni migra identidades.
3. **¿Controla el contacto de recuperación verificado?** Sí y perdió credenciales
   → A/B, código normal; no necesita recordar usuario ni crear cuenta nueva.
4. **¿Puede autenticarse como propietario y recuerda su contraseña actual?** Sí
   y necesita cambiar contacto → C/D. Si todavía no vinculó correo, usar vinculación V1.
   Una sesión aislada sin contraseña no basta.
5. **¿Perdió contraseña y correo, o nunca vinculó correo?** → E/F. Buscar dos
   fuentes independientes reales de titularidad y una segunda revisión humana.
   Si faltan, bloquear. Si existen, expediente excepcional → correo nuevo → espera
   y aprobación → completar → recuperación normal de contraseña.
6. **¿El problema es un teléfono perdido/cupo de dispositivos?** → G; aplicar
   además el procedimiento existente de dispositivos sin alterar límites desde estos scripts.
7. **¿Hubo error, duplicación o respuesta de red perdida?** → I y consultar historial
   antes de repetir una mutación.

## 4. Procedimientos A–I

### A. Olvidó únicamente contraseña

**Cuándo:** tiene contacto verificado, lo controla y no hay sospecha de compromiso.

1. Ejecutar 01 y 02 (o diagnóstico V1); elegir cuenta original y comprobar contacto.
   Confirmar que la solicitud corresponde a esa cuenta. No pedir su contraseña anterior.
2. Copiar 03. Completar `p_license_id`, operador y referencia al caso de atención.
   Mantener `p_purpose='password'`, `p_request_id=null`.
3. Esperar `success=true`, `delivery_email`, `code`, `request_id`, `expires_at`.
   Si `success=false`, resolver el error antes de enviar nada.
4. Enviar el código **exclusivamente a `delivery_email`** desde el correo oficial.
   No reenviar a WhatsApp, a otro buzón propuesto ni a un tercero.
5. Cliente abre login → **¿Olvidaste tus datos de acceso?**, introduce código,
   contraseña nueva y confirmación. No se la envía a soporte. El resultado muestra
   el usuario original y le permite volver al login.
6. Cliente inicia sesión con la nueva contraseña. Comprobar en historial
   `password_recovered_sessions_revoked`; verificar rechazo de contraseña anterior
   y revocación de sesiones en el QA autorizado. Comparar datos visibles anteriores.
7. Si falla, usar tabla de errores e I. No cambiar hashes por SQL, no crear usuario
   alternativo, no marcar contacto verificado a mano.

### B. Olvidó usuario y contraseña

Usar exactamente A. La búsqueda es administrativa y no necesita usuario recordado.
El canje correcto devuelve el usuario administrativo original. Enviar el mensaje
de código temporal y luego el de recuperación completada. Si aparece un usuario
inesperado, detener el acceso y verificar selección de cuenta/historial; nunca
renombrar la identidad para corregir la selección. Están prohibidas la creación
de una segunda cuenta y la entrega anticipada del usuario a una persona no acreditada.

### Vinculación inicial V1, cuando todavía conserva credenciales

Cliente inicia sesión Admin y abre **Configuración → Licencia y Rubros → Recuperación**.
Introduce correo y contraseña actual, pulsa **Solicitar vinculación**, y comparte
con soporte la referencia UUID. Soporte comprueba solicitud de propósito `contact`,
reciente, no invalidada/consumida, evento `contact_requested_with_password`, sesión
no revocada/vencida y dispositivo activo Admin/compartido. 03 con `p_purpose='contact'`
y `p_request_id` igual al UUID comprueba nuevamente las condiciones en backend.
Enviar solo a `delivery_email`. Cliente canjea desde la misma sesión en Recuperación.
Comprobar `contact_verified` y contacto en 02. Si caduca la sesión, iniciar otra y
solicitar nueva vinculación con contraseña. No convertir esta ruta en recuperación
excepcional ni reemplazar un contacto ya verificado.

### C. Perdió correo anterior, recuerda usuario y contraseña

**Antes:** confirmar que realmente puede autenticarse como propietario. Staff,
una sesión vencida o una captura de pantalla no autorizan el cambio.

1. Cliente entra en Recuperación y abre **Cambiar correo con ayuda de soporte**.
   Introduce nuevo correo y contraseña actual. Pulsa **Solicitar cambio de correo**.
   La pantalla muestra UUID de caso; al recargar se conserva desde backend.
2. Soporte ejecuta 07 con ese UUID. Comprobar `kind=authenticated`, evento
   `contact_change_requested_with_password`, correo nuevo correcto, sesión real
   y contacto anterior conservado. No pedir contraseña ni token del cliente.
3. Ejecutar 05 con UUID de caso y `p_target='new'`; completar operador y referencia.
   Enviar código únicamente al buzón devuelto. El mensaje debe explicar que este
   código **autoriza un cambio de correo**, no es un restablecimiento de contraseña.
4. Cliente devuelve este código de verificación al canal oficial de soporte en el
   mismo caso. Ejecutar 06 `verify_new`, `p_code='CODIGO_RECIBIDO'`. Comprobar
   `new_verified_at`; aún no cambia el contacto. No usar códigos de contraseña aquí.
5. Intentar aviso al correo anterior indicando solicitud, nuevo contacto propuesto,
   referencia y cómo oponerse. No enviar código de contraseña ni datos comerciales.
   Registrar referencia al mensaje y entrega/rebote mediante 06 `notice`.
   Si no es posible enviar, documentar el intento y razón real. No inventar recepción.
6. Esperar **24 horas desde el primer aviso registrado** y revisar si hubo disputa.
   Consultar `not_before`. Si hay disputa, 06 `block` y ruta H.
7. Con sesión original todavía válida, 06 `complete`, operador y referencia de
   cierre. Esperar `success=true,state=completed`. En una sola transacción sustituye
   contacto, invalida códigos pendientes, revoca sesiones Admin y deja auditoría.
8. Enviar aviso de cambio completado al nuevo y al anterior cuando sea posible.
   Cliente inicia sesión otra vez con **sus mismas credenciales**. Verificar correo
   nuevo en Recuperación e historial `case_complete`. No hubo cambio de contraseña.
9. Si caducó/revocó la sesión original, no completar por excepción improvisada:
   cancelar caso, iniciar sesión y crear nueva solicitud con contraseña. Se repiten
   pruebas y plazo. Si ya no puede autenticarse, evaluar E.
10. Prohibido cerrar antes de verificar buzón/plazo, ignorar disputa, editar tablas,
    enviar códigos al solicitante por otro canal o usar una sesión Staff.

La contraseña actual + sesión válida + buzón nuevo son pruebas concretas.
La espera/aviso protege contra apropiación silenciosa cuando no se puede confirmar
el contacto anterior. No se exige una prueba contractual adicional en esta ruta.

### D. Controla el correo anterior y quiere cambiarlo

Seguir C pasos 1–5. Después de verificar el nuevo buzón, esperar al menos 60 segundos
entre emisiones y usar 05 con `p_target='old'`. Enviar exclusivamente al correo
anterior devuelto; explicar que confirmar autoriza el cambio. Cliente devuelve
ese código a soporte; 06 `verify_old`, completar `p_code` y comprobar `old_confirmed_at`.

Con ambos buzones confirmados, contraseña comprobada, misma sesión vigente y aviso
registrado, 06 `complete` puede cerrar **sin esperar las 24 horas**. Se revocan
sesiones Admin y se informa a ambos contactos; cliente vuelve a iniciar sesión.
Si no recibe el correo anterior, investigar entrega; no simular confirmación.
Puede seguir C con aviso, 24 horas y sesión vigente si perdió control de ese buzón.
Nunca dispensar contraseña porque una sesión esté abierta.

### E. Perdió contraseña y acceso al contacto verificado

**Ruta excepcional, sin automatizar una identidad que no podemos comprobar.**

1. Localizar con 01, diagnosticar con 02. Registrar motivo, solicitante, contacto
   anterior y propietario original. No emitir código normal al correo fuera de control.
2. Buscar **dos tipos de fuentes independientes** de la tabla siguiente. Contrastar
   originales preexistentes de LANZO/proveedor, no solo archivos enviados por solicitante.
   Registrar referencias de archivo restringido y qué registro independiente se contrastó.
3. Si no alcanza: bloquear la solicitud de atención sin modificar cuenta. Guardar
   qué falta y enviar mensaje de negativa/pruebas adicionales. No rellenar evidencia ficticia.
4. Si alcanza: completar 04 con licencia, correo nuevo, operador, motivo y arreglo
   de evidencias. Cambiar cada `independently_checked` a `true` **solo tras comprobarlo**.
   Esperar `success=true,case_id`. Esto congela emisión/canje normal durante el caso,
   pero aún no cambia contacto, contraseña ni revoca sesiones.
5. Otro operador real vuelve a revisar las fuentes y autoriza con 06 `approve`,
   su identidad personal y referencia a su revisión. No puede ser el creador; nombres
   no distinguen identidades por sí mismos: el control humano debe existir de verdad.
6. 05 `new` → código solo al buzón propuesto → cliente devuelve código → 06 `verify_new`.
   Confirmar `new_verified_at`. No almacenar el código en expediente o capturas.
7. Intentar aviso al contacto anterior cuando exista; 06 `notice` registra referencia
   y resultado, incluido rebote. Si falta contacto histórico, documentar esa ausencia
   y fuentes alternativas en la revisión; no inventar un destinatario.
8. Esperar **48 horas como mínimo desde la segunda aprobación**, revisar disputas
   y mantener aprobación vigente. Confirmar fecha `not_before` en 07. Control del
   buzón anterior no reduce la espera excepcional.
9. 06 `complete`. Verifica identidad original activa, que el contacto anterior no
   cambió desde abrir el caso, buzón nuevo, revisión, aviso y plazo. Reemplaza contacto,
   invalida códigos y revoca sesiones Admin en una transacción. No toca contraseña aún.
10. Volver a 03 `password`, usando la licencia que muestra 07. Respetar límites de
    emisión compartidos. Entregar código nuevo al `delivery_email` ahora verificado.
    Cliente realiza A en LANZO; comprobar evento de contraseña recuperada y login real.
11. Avisar del cierre a contactos pertinentes. Registrar resultado sin contraseñas,
    códigos o tokens. Si falla, I. Prohibido aprobarse con alias, aceptar una referencia
    de texto como prueba, forzar verificación por UPDATE o crear otra identidad.

| `kind` permitido | Qué se contrasta fuera de SQL | Qué no basta |
|---|---|---|
| `provider_payment` | Cobro original de LANZO con proveedor/receptor y referencia histórica vinculable al titular y licencia | Captura o número de operación sin contrastar; ventas del POS |
| `prior_contract` | Contrato anterior a la solicitud en archivo original de LANZO y datos de contratación consistentes | Documento creado para esta recuperación o solo enviado por solicitante |
| `prior_verified_channel` | Contacto preexistente cuya verificación/uso legítimo histórico consta independientemente y se comprueba nuevamente | `licenses.owner_email` sin verificación; nuevo teléfono declarado |
| `prior_ownership_record` | Registro preexistente fiable de titularidad de LANZO que identifique propietario y negocio | Nombre comercial, dirección pública, inventario o licencia conocida |

`reference` apunta al documento restringido; `checked_against` describe la fuente
independiente contrastada. Dos archivos derivados del mismo comprobante **no son
dos pruebas independientes**. El sistema valida estructura y dos tipos diferentes;
la autenticidad, independencia y legitimidad son responsabilidad humana. Si hay
un único operador disponible, no puede completar una excepción: obtener segundo
revisor autorizado o dejar bloqueado. No existe bypass de QA para ese requisito.

### F. Olvidó todo y nunca vinculó correo

1. Buscar por licencia/nombre con 01. Eso localiza; no acredita.
2. 02: ¿existe propietario original activo? Si no, detener y documentar ausencia de
   identidad administrativa. No crear usuario ni asociar la licencia a otro propietario.
3. Si existe, buscar dos pruebas independientes preexistentes como en E. FREE puede
   carecer de pago/contrato: no se le exige inventar uno, pero necesita otras fuentes
   fiables de la tabla. Si nunca se registró titularidad ni contacto comprobable,
   documentar exactamente eso y rechazar acceso administrativo.
4. Con prueba suficiente, E completo. En ausencia de contacto anterior no hay código
   `old` ni aviso a un buzón inexistente. Permanecen segunda revisión, nuevo buzón y 48 h.
5. Cliente restablece contraseña en LANZO mediante A y obtiene su usuario original.
   Comprobar login y auditoría. Si falla, I; no relajar evidencia por antigüedad o plan.
6. En negativa, enviar el mensaje de imposibilidad y conservar referencia externa
   de atención. La función no abre casos sin identidad o evidencia suficiente;
   no hay fila de auditoría de cuenta cuando no puede existir propietario seguro.
   La bitácora externa restringida registra esa negativa y qué comprobación falta.

Para prevenir casos futuros, un propietario que aún puede entrar debe vincular
correo por V1 y conservar contratación/respaldo. Esto no prueba retroactivamente
la titularidad de un solicitante ya bloqueado.

### G. Teléfono perdido o dispositivo nuevo

Separar tres cuestiones: credenciales, autorización del equipo y datos.

1. Si perdió credenciales, A/B o E/F según factores reales. Si todavía las conoce,
   probar el login existente sin emitir recuperaciones innecesarias.
2. Revisar estado/cupos con 02. Los scripts no activan, liberan o transfieren
   dispositivos. Conservar reglas FREE/PRO y seguir el procedimiento de dispositivos
   existente; si exige aprobación de soporte, tramitarla por su cauce separado.
3. Preguntar si datos estaban sincronizados realmente o existe un respaldo válido.
   Una pantalla Preview tiene otro origen y otra IndexedDB; no demuestra pérdida
   ni comparte automáticamente datos de la PWA instalada.
4. Datos solo en Dexie/IndexedDB del equipo perdido no están en Supabase y no se
   pueden reconstruir por recuperar contraseña. No borrar, reinstalar, importar
   bases ni prometer una migración offline con esta entrega.
5. Enviar mensaje del límite local; comprobar acceso y datos que sí existen. Registrar
   por separado recuperación de cuenta lograda y recuperación de datos imposible/pendiente.

### H. Correo comprometido, sesión antigua o intento de apropiación

Una licencia conocida o información comercial no basta. Correo verificado es un
factor de la recuperación normal: un atacante que realmente lo controla puede
canjear un código que soporte entregue allí. Ningún procedimiento de correo único
puede distinguir automáticamente al titular del atacante del buzón. Ante indicios
concretos, **no emitir código normal** y pasar a revisión excepcional.

1. Registrar hechos verificables y disputa, no conclusiones basadas en una captura.
2. Si hay caso activo, 06 `block` o 08: conserva contacto/contraseña, congela canjes
   y nuevas emisiones normales y revoca sesiones Admin. Si no hay caso, ejecutar
   08 con licencia correcta, operador y referencia concreta a la sospecha.
3. 08 abre un expediente `security_hold` bloqueado, sin correo propuesto ni prueba
   de propiedad inventada. Invalida códigos pendientes y revoca sesiones Admin.
   No requiere pruebas para conceder acceso porque **no concede acceso**. Puede
   perjudicar disponibilidad: reservarlo a incidentes justificados y revisados,
   no usarlo ante cualquier consulta de contraseña. No puede aprobarse, verificar
   buzones, emitir códigos ni completar contacto. Solo se puede cancelar después
   de resolver el incidente. Si falta incluso la identidad original, escalar al
   responsable sin crear propietario. No ejecutar UPDATE ad hoc como atajo.
4. Un caso bloqueado no puede aprobarse ni completarse. Tras resolver la disputa,
   06 `cancel`, con justificación; crear caso nuevo con nuevas revisiones si procede.
   Cancelar no recupera sesiones revocadas ni reactiva códigos invalidados.
5. Si se aprobó E, cambiar contacto y recuperar contraseña mediante E completo.
   Avisar a contactos cuando sea posible. Contraseña recuperada conserva usuario.
6. Consultar historial e informar al titular de límites offline. Sesión antigua
   revocada falla al volver al servidor; no se puede apagar remotamente un navegador
   que permanece desconectado. La autorización offline existente puede durar hasta
   siete días desde validación, acotada por vencimientos vigentes. Operaciones
   remotas protegidas requieren validación; no se revierten operaciones ya en curso.

Emisiones comparten por licencia: 60 segundos entre códigos, máximo tres por hora
y cinco al día. Cinco errores agotan un código; reemitir invalida el anterior.
Los códigos tienen 128 bits de secreto y referencia aleatoria de 48 bits; duran
15 minutos y solo se almacena hash SHA-256. Repetidos errores o presión para cambiar
canal requieren revisión, no incrementar límites ni usar una contraseña universal.

### I. Incidentes operativos

| Incidente | Qué hacer | ¿Código nuevo? |
|---|---|---|
| Código vencido | Comprobar destinatario/caso; reemitir respetando límites | Sí |
| Código incorrecto | Copiar completo; comprobar licencia y propósito; no adivinar | Solo si persiste, revisar antes |
| Cinco intentos agotados | Investigar errores/sospecha; reemitir si está autorizado | Sí |
| Reemisión | Entregar última emisión; anterior deja de servir | Solo el más reciente |
| Código usado | Ver historial y probar acceso; no asumir fallo | Solo si se necesita otra recuperación legítima |
| Solicitud duplicada | Consultar 02/07 y usar referencia vigente | No automáticamente |
| Correo mal escrito | No verificar. Cancelar caso y crear uno correcto con nuevas pruebas; vinculación V1 puede renovarse con contraseña | Después de corregir |
| Correo nunca recibido | Ver `delivery_email`, spam/rebote; no cambiar destinatario por mensaje posterior | Tras comprobar entrega y límites |
| Solicitud invalidada | Identificar cuál la reemplazó/canceló; no reactivar filas | Según nueva solicitud autorizada |
| Sesión caducada al vincular | Nueva sesión + contraseña + nueva solicitud V1; cambio C/D exige nuevo caso | Sí, nueva referencia |
| Se pierde conexión al canjear | Resultado incierto; consultar historial y probar login nuevo antes de repetir | No inmediatamente |
| Respuesta perdida tras cambio | 07: `completed` prueba cierre; iniciar sesión, consultar contacto | No |
| Dos operadores | Mismo UUID de caso; coordinar entrega; ver historial antes de actuar | Una emisión válida; límites serializados |
| Dos solicitudes concurrentes | Solo un caso activo por licencia; `RECOVERY_CASE_ACTIVE` conduce al caso existente | No crear duplicados |
| Nombres iguales | Seleccionar UUID por registros correctos y contacto | No sin selección inequívoca |
| Un correo, varios negocios | Recuperación separada por licencia/propietario | Solo para cuenta seleccionada |
| Licencia vencida/suspendida | No cambia el estado comercial; login mantiene sus reglas. Escalar vigencia aparte | Recuperar contacto no renueva licencia |
| Sin propietario registrado | Mantener bloqueado; falta identidad original, no crear nueva | No |
| Sesiones offline revocadas | Explicar límite; comprobar rechazo al reconectar; no prometer cierre inmediato | No por ese motivo |
| Caso expirado | Consultar, cancelar explícitamente y rehacer pruebas/aprobación si procede | No reutilizar anteriores |

## 5. Scripts y respuestas sin ambigüedad

Los marcadores `UUID_LICENCIA` y `UUID_CASO` son distintos. 01 elige la licencia;
04 o la pantalla devuelve el caso. Después usar únicamente UUID del caso en 05/06/07.
SQL Editor debe usar un rol administrativo con permisos originales, nunca claves
`anon`, `authenticated` o `service_role` para soporte.

Ejemplo de **acción de aprobación**, con UUID ficticio y referencia ficticia:

```sql
select private.support_recovery_case_action(
  p_case_id => '00000000-0000-4000-8000-000000000123'::uuid,
  p_action => 'approve',
  p_operator => 'revisor.segundo@example.invalid',
  p_reference => 'DEMO-123: fuentes originales revisadas por segunda persona',
  p_code => null
);
```

Para `verify_new` / `verify_old`, 06 necesita el código temporal de verificación
recibido del buzón correspondiente. Reemplazar `p_action` y `p_code` en la copia
operativa. No incluir un código real en manuales, informes, tickets, commits,
capturas o logs. No pegar una contraseña ni un token de sesión en ningún script.
Los códigos de contraseña nunca deben volver a soporte.

`success=false` es una respuesta de negocio válida: no significa que SQL Editor
haya fallado. Leer `code`, corregir causa y comprobar historial. SQL Editor también
puede devolver errores SQL (`42501` por permisos, `22P02` por UUID mal copiado,
`40P01` por deadlock, `40001` por serialización). Ante errores transitorios consultar
estado y reintentar la operación correspondiente; no ejecutar UPDATE ni otorgar grants.

### Protección de códigos en SQL Editor

La emisión muestra el secreto una sola vez para entrega manual. La verificación
por SQL recibe un código temporal de cambio de contacto y lo consume en la misma
transacción. SQL Editor y la infraestructura de PostgreSQL pueden conservar texto
consultado y resultados en su historial/logs según configuración: **esta solución
no promete borrar ese historial**. Restringir acceso a SQL Editor, no compartir sus
consultas de emisión/verificación, no exportarlas y retirar el texto del editor
tras uso conforme a la política operativa. Un código correctamente consumido ya
no sirve; uno expuesto antes del consumo requiere cancelar/reemitir y revisar el caso.
La auditoría de aplicación conserva referencias y resultados, nunca códigos.

## 6. Mensajes modelo para el cliente

Usar nombres ficticios/marcadores y completar solo información de su propia cuenta.
No incluir secretos en la referencia del caso.

**Identificar negocio**

> Para localizar tu cuenta, indícanos el nombre del negocio y su licencia o el correo
> que habías registrado. Esos datos sirven para buscar; todavía tendremos que comprobar
> que eres la persona autorizada. No nos envíes contraseñas ni tokens.

**Comprobar titularidad**

> Antes de cambiar el contacto necesitamos comprobar la titularidad. Revisaremos
> registros anteriores de LANZO y las pruebas disponibles. Conocer la licencia o
> el nombre del negocio no permite cambiar el acceso por sí solo.

**Enviar código normal**

> Solicitaste recuperar el acceso a [NEGOCIO]. Tu código temporal es [CODIGO_TEMPORAL].
> Vence a las [HORA_Y_ZONA], dura como máximo 15 minutos y solo se usa una vez.
> Introdúcelo en LANZO, en «¿Olvidaste tus datos de acceso?», y elige una contraseña
> nueva. No nos envíes tu contraseña ni nos devuelvas este código. Si no lo solicitaste,
> avisa inmediatamente a soporte.

**Código para cambio de contacto**

> Caso [REFERENCIA]: este código comprueba el buzón [NUEVO/ANTERIOR] y autoriza el
> cambio de contacto solicitado para [NEGOCIO]. Código: [CODIGO_TEMPORAL]. Caduca en
> 15 minutos. Devuélvelo únicamente al canal oficial de soporte en este mismo caso
> si tú solicitaste el cambio. No es un código de contraseña. Si no lo solicitaste,
> no lo compartas y avisa para bloquear el caso.

**Aviso al contacto anterior**

> Recibimos la solicitud [REFERENCIA] para cambiar el correo de recuperación de
> [NEGOCIO] a [NUEVO_CONTACTO]. El cambio sigue pendiente de sus controles.
> Si no lo autorizaste, responde al canal oficial de soporte para detener la revisión.
> No te pediremos contraseñas ni códigos de recuperación de contraseña.

**Recuperación completada**

> Se completó el restablecimiento de tu acceso. LANZO muestra tu usuario original
> al terminar el canje. Inicia sesión con la contraseña que elegiste. Las sesiones
> administrativas anteriores se revocaron en el servidor. Un equipo desconectado
> conocerá la revocación al volver a validar su sesión.

**Correo cambiado**

> Caso [REFERENCIA]: el contacto de recuperación de [NEGOCIO] cambió a [CORREO_NUEVO]
> después de completar las comprobaciones. Vuelve a iniciar sesión. Si no reconoces
> esta operación, contacta inmediatamente al canal oficial de soporte.

**Pedir pruebas adicionales**

> No hemos podido contrastar suficientes fuentes independientes. Necesitamos
> [REGISTRO_ORIGINAL_FALTANTE] para compararlo con nuestros registros previos.
> Una captura, datos comerciales o la licencia por sí solos no bastan. Envíalo
> únicamente por el canal restringido acordado; no envíes contraseñas.

**No se puede acreditar**

> No podemos recuperar esta cuenta con las pruebas disponibles sin poner en riesgo
> al propietario. Falta [IDENTIDAD_ORIGINAL/REGISTRO_PREVIO/SEGUNDA_FUENTE]. La solicitud
> queda detenida. Si aparecen registros originales que podamos comprobar, podemos
> volver a revisarla. No cambiaremos el contacto ni crearemos otro propietario.

**Datos locales perdidos**

> Podemos revisar la recuperación de tu acceso. Los datos guardados únicamente en
> el teléfono perdido no están en Supabase si nunca se sincronizaron o respaldaron.
> Recuperar la contraseña no los reconstruye ni elimina los límites de dispositivos.
> Revisaremos por separado qué respaldo o información sincronizada existe realmente.

## 7. Errores de las funciones

| Código | Causa | Solución / reintento |
|---|---|---|
| `RECOVERY_OPERATOR_EVIDENCE_REQUIRED` | Operador/referencia inválidos o propósito/destino no permitido | Identidad 3–160 caracteres, referencia 10–500, acción/destino válidos; corregir y repetir |
| `RECOVERY_OWNER_UNAVAILABLE` | Falta propietario original activo | Detener; investigar registros. No crear sustituto |
| `RECOVERY_VERIFIED_CONTACT_REQUIRED` | No existe contacto autorizado | Vinculación V1 con credenciales o E/F; no emitir contraseña |
| `RECOVERY_VERIFIED_REQUEST_REQUIRED` | Solicitud inicial inexistente, caducada, invalidada o sesión/dispositivo inválidos | Nueva solicitud del propietario; no sustituir UUID arbitrariamente |
| `RECOVERY_CONTACT_ALREADY_VERIFIED` | V1 no reemplaza un contacto existente | Usar C/D o E; no repetir vinculación |
| `RECOVERY_EMAIL_INVALID` | Dirección con formato/tamaño inválido | Corregir; reintentar antes de verificar |
| `RECOVERY_REAUTH_REQUIRED` | Contraseña actual incorrecta | Propietario la reintroduce en LANZO; no soporte |
| `RECOVERY_RATE_LIMITED` | Emisión 60 s/3 h/5 día o reautenticación 5 intentos/15 min | Esperar ventana correspondiente. El texto genérico de UI no sustituye límites SQL |
| `RECOVERY_CODE_INVALID` | Mal copiado, otro propósito/licencia, invalidado o referencia desconocida | Comprobar cuenta/emisión; no adivinar. Reemitir si procede |
| `RECOVERY_CODE_EXPIRED` | Pasaron 15 minutos | Emitir nuevo con límites |
| `RECOVERY_ATTEMPTS_EXHAUSTED` | Cinco errores para esa referencia | Revisar sospecha y reemitir con autorización |
| `RECOVERY_CODE_USED` | Ya consumido | Consultar historial, probar login/estado; no repetir ciegamente |
| `RECOVERY_REQUEST_SESSION_REQUIRED` | Otra sesión o sesión original ya inválida | Nueva solicitud autenticada; nunca sustituir sesión por UPDATE |
| `RECOVERY_PASSWORD_WEAK` | Menos de 8 caracteres, sin letra/número o más de 72 bytes UTF-8 | Elegir otra en LANZO; código no consumido |
| `RECOVERY_PASSWORD_UNCHANGED` | Igual a contraseña anterior | Otra contraseña; no consume código |
| `RECOVERY_CASE_ACTIVE` | Ya existe caso abierto/aprobado/bloqueado | Consultar 02/07 y seguirlo; cancelar explícitamente si corresponde |
| `RECOVERY_EMAIL_UNCHANGED` | Nuevo contacto igual al anterior | Usar recuperación normal o corregir correo |
| `RECOVERY_INDEPENDENT_EVIDENCE_REQUIRED` | Faltan dos tipos permitidos, referencias o comprobación humana | Mantener bloqueado hasta pruebas reales; nunca inventarlas |
| `RECOVERY_SECOND_REVIEW_REQUIRED` | Falta segunda aprobación o intenta aprobar creador | Otro revisor real contrasta fuentes; después reintentar |
| `RECOVERY_CASE_NOT_ACTIONABLE` | Caso inexistente, expirado o estado incompatible | Consultar 07; cancelación explícita/nuevo caso si procede |
| `RECOVERY_MAILBOX_ALREADY_VERIFIED` | Ya se comprobó ese buzón en el caso | Consultar fecha y continuar; no emitir otra vez |
| `RECOVERY_ACTION_INVALID` | Acción fuera de lista | Corregir según 06 |
| `RECOVERY_NEW_MAILBOX_REQUIRED` | Falta consumo válido del código nuevo | 05 `new` y 06 `verify_new` |
| `RECOVERY_OLD_NOTICE_REQUIRED` | No consta intento de aviso al contacto anterior | Avisar/registrar intento real con 06 `notice` |
| `RECOVERY_SAFETY_WAIT` | Aún no llega `not_before` | Esperar/revisar disputa; solo D confirmado evita espera autenticada |
| `RECOVERY_CONTACT_CHANGED` | Contacto cambió desde abrir expediente | Detener; investigar, cancelar y volver a evaluar |
| `RECOVERY_SUPPORT_HOLD` | Caso activo congela recuperación normal | Revisar/cerrar o cancelar justificadamente; no modificar filas |

Las RPC de sesión propagan errores del login existente. Entre ellos:
`LICENSE_NOT_ACTIVE`, `LICENSE_EXPIRED`, `ADMIN_SESSION_REQUIRED`, `ADMIN_SESSION_INVALID`,
`ADMIN_SESSION_EXPIRED`, `ADMIN_DEVICE_REQUIRED`. Comprobar licencia, dispositivo,
rol y sesión mediante login ordinario; soporte no modifica planes o permisos para
eludirlos. El login además puede devolver `INVALID_ADMIN_CREDENTIALS`,
`ADMIN_LOGIN_INVALID_REQUEST`, `ADMIN_LOGIN_RATE_LIMITED`, `DEVICE_MODE_ADMIN_NOT_ALLOWED`,
`DEVICE_LIMIT_REACHED` y `FREE_DEVICE_TAKEOVER_REQUIRED`: corregir credenciales,
esperar rate limit o seguir la autorización de dispositivo existente, respectivamente. La UI también puede mostrar `ONLINE_REQUIRED`, `RECOVERY_UNAVAILABLE`
(SQL no instalado/RPC ausente), `RECOVERY_UNCONFIRMED` (resultado de red incierto)
y `ACTOR_CONTEXT_STALE` (cambió actor). Reconectar/volver a autenticar y consultar
estado antes de repetir; no declarar éxito basándose solo en la pantalla.

## 8. Seguridad, auditoría y fallos parciales

Guardar en archivo restringido de atención: referencia de caso, cuenta inequívoca,
solicitud/motivo, fuentes preexistentes contrastadas, resultado de cada comprobación,
identidades reales de operadores, aprobación, destinatarios y referencias a avisos,
fechas y resultado final. Preferir enlaces internos con acceso limitado a copiar
identificaciones/comprobantes completos a PostgreSQL. No incluir enlaces públicos
a documentos personales. SQL conserva referencias, revisión declarada y actor SQL.

No guardar contraseñas, códigos utilizables, hashes, tokens, cookies, capturas de
resultados de emisión o exportaciones de sesiones. Nunca pedir esos secretos al
cliente. Excepción explícita: los códigos **de cambio de contacto** vuelven a soporte
para consumirlos por 06; nunca se registran en la auditoría de aplicación ni se
usan como prueba contractual. Los códigos normales de contraseña solo los usa LANZO.

No hay grants de soporte para `PUBLIC`, `anon`, `authenticated` o `service_role`.
Los helpers son `SECURITY INVOKER` en `private`, con RLS y ACL cerradas. Solo la
solicitud autenticada de cambio es RPC nueva, expuesta por necesidad del cliente,
con sesión Admin real y contraseña. Ningún helper administrativo es RPC comercial.
La base no puede demostrar que dos nombres escritos por un DBA correspondan a dos
personas: el segundo revisor y sus comprobaciones se exigen operativamente, con
referencias de trazabilidad. No suplantar revisores mediante alias.

Cada mutación bloquea primero licencia y luego expediente/identidad. Verificar
código consume y audita en una transacción. Completar contacto, invalidar códigos,
revocar sesiones y auditar también es atómico: una excepción SQL revierte ese paso.
Pasos anteriores del expediente permanecen registrados para reanudar con seguridad.

**Si se corta la conexión:**

- Tras abrir caso: 02 busca caso existente; no volver a abrir uno a ciegas.
- Tras emitir: consultar `issued_at/expires_at`. No se puede recuperar el código
  desde su hash; coordinar nueva emisión cuando lo permitan límites.
- Tras verificar buzón: 07 muestra `new_verified_at/old_confirmed_at` y `case_verify_*`.
  Si el código aparece usado y esas fechas existen, seguir al siguiente paso.
- Tras completar: `state=completed` y `case_complete` confirman el resultado.
  Repetir `complete` sobre el mismo caso devuelve `already_completed=true` y no
  vuelve a cambiar nada. No reinicia plazos ni produce nueva revocación.
- Tras restablecer contraseña: probar primero login con la nueva contraseña; buscar
  `password_recovered_sessions_revoked`. El código usado puede significar éxito
  anterior con respuesta perdida. Solo solicitar otro si realmente se necesita.

No existe rollback que permita recuperar la contraseña olvidada o restaurar una
sesión revocada. Un contacto cambiado requiere otro procedimiento acreditado para
corregirlo; cancelar un expediente completado no deshace el cambio. No eliminar
migraciones ni repetirlas para corregir una atención de cliente.

## 9. Ejemplos ficticios completos

Todos los nombres/correos/referencias de esta sección son ficticios. Los dominios
`.invalid` no reciben correo; en una atención real se usan buzones reales comprobados.

### 1. Contraseña olvidada: «Abarrotes Aurora»

01 busca el nombre; 02 identifica propietario activo y correo verificado controlado.
Operadora documenta `DEMO-A1`, ejecuta 03 `password` y envía solo al destinatario
retornado. Propietaria canjea en LANZO, elige contraseña, ve usuario original e
inicia sesión. Historial confirma recuperación y sesiones previas revocadas.
No se cambia identidad, inventario, plan ni correo. Si código caduca, reemitir tras
límites; nunca pedir contraseña elegida.

### 2. Perdió correo pero conserva sesión: «Papelería Río»

Propietario recuerda contraseña y solicita cambio en Recuperación. 07 confirma
caso autenticado. 05 `new` entrega a `rio.nuevo@example.invalid`; en el ejemplo se
simula entrega con buzón real solo durante QA autorizado, nunca al dominio ficticio.
Cliente devuelve código de contacto, 06 `verify_new`; soporte intenta aviso anterior
con referencia `DEMO-C2-aviso`, 06 `notice`. Espera 24 h, revisa disputas y vigencia
de sesión, 06 `complete`. Cliente vuelve a entrar con la misma contraseña. Si sesión
venció, cancelar y crear solicitud nueva; no activar vía excepcional automáticamente.

### 3. Perdió todo, nunca vinculó: «Ferretería Horizonte»

01/02 confirman identidad original. Archivo de LANZO conserva contrato firmado
anterior y registro de cobro contrastado con receptor/proveedor. Primera persona
registra ambos originales en 04 bajo `DEMO-F3`. Segunda revisa y 06 `approve`.
05 `new` y 06 `verify_new` prueban buzón. No hay contacto anterior: se documenta
su ausencia sin inventar aviso. Tras 48 h desde aprobación y sin disputa, 06 `complete`.
03 `password` lleva al restablecimiento y login original. Si realmente faltaran
esos archivos, este ejemplo no sería ejecutable: se aplica ejemplo 5.

### 4. Correo comprometido: «Café Nube»

Titular comunica indicios verificables. Soporte detiene códigos normales, usa 08
para congelar y revocar sesiones, y registra `DEMO-H4`. Contrasta contrato y pago
originales durante la disputa. El bloqueo no permite completar contacto. Tras resolución,
cancela con referencia de la decisión y crea un nuevo caso excepcional, dos revisores,
verificación nueva y 48 h. Completa, recupera contraseña por V1 y comprueba login.
Si no se puede acreditar al titular, no cambia contacto. Equipos desconectados
pueden conservar autorización local temporal hasta próxima validación/límite vigente.

### 5. No consigue acreditar: «Tienda Centro»

Solicitante conoce licencia y ventas aproximadas, presenta captura y ofrece un
buzón nuevo. No hay contrato, cobro contrastable ni canal histórico verificado.
Soporte registra negativa `DEMO-F5` fuera de SQL, explica qué fuentes faltan y no
abre caso ni emite código. No crea propietario, no usa correo histórico no verificado
ni acepta una declaración como prueba. Si surge un original comprobable, reevalúa;
una sola fuente todavía no satisface la excepción.

### 6. FREE perdió teléfono y todo era local: «Kiosco Sol»

Titular controla correo verificado: 01/02/03 y canje recuperan credenciales. El
nuevo equipo todavía debe cumplir el cupo FREE y autorización normal de dispositivos.
No existe sincronización ni respaldo del teléfono anterior. Soporte registra acceso
recuperado pero datos locales irrecuperables por esta vía; envía mensaje del límite
local. No promete que Supabase contenga ventas nunca enviadas y no altera Dexie.

## 10. QA manual del candidato con el propietario

Ejecutar solo después de autorización e instalación exacta de V2 y Preview que apunte
al proyecto correcto. Usar cuenta expresamente autorizada, buzones controlados,
operadores reales y tiempos reales. No añadir bypass para saltar 24/48 horas.

1. Registrar commit/URL Preview, plan, propietario, dispositivos, sesión original,
   datos visibles de inventario, ventas, caja, clientes y permisos; sin secretos.
2. Repetir A: código V1, canje, usuario original, login nuevo, rechazo contraseña
   anterior y sesiones revocadas. El PASS histórico de #407 no demuestra este candidato.
3. Con contraseña vigente solicitar cambio D, verificar nuevo y anterior mediante
   SQL/correo, registrar aviso y completar. Comprobar contacto, login con misma
   contraseña, rechazo sesión vieja y datos conservados.
4. Probar C con aviso y espera real de 24 h. Antes debe devolver `RECOVERY_SAFETY_WAIT`.
   Al completar, comprobar nueva sesión y contacto. Si no se ejecuta, marcar pendiente.
5. En cuenta autorizada con evidencias reales, E/F con segundo revisor y espera real
   de 48 h; antes debe fallar cierre. Después cambiar contacto, emitir V1 y entrar.
   No usar una cuenta real de cliente sin su autorización para simular pérdida total.
6. Intento sin pruebas debe rechazarse; Staff no debe cargar la pantalla ni autorizar
   solicitud backend. Otra licencia no debe canjear códigos. Registrar fallos esperados.
7. Simular pérdida de respuesta solo en recorrido autorizado y comprobar historial
   antes de repetir; no duplicar expedientes. Comprobar PWA/móvil y origen correcto.
8. Comparar identidad, plan, dispositivos, datos y permisos del paso 1. Registrar
   resultados por caso, fechas, revisores y limitaciones. Un login real exitoso es
   necesario: no basta `success=true` en una función.

Las pruebas locales de PostgreSQL manipulan tiempos únicamente en fixtures desechables
para comprobar límites. Eso no autoriza UPDATE de plazos ni un bypass en Production.
