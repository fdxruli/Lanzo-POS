# LANZO_ACCOUNT_RECOVERY_V2_PRODUCTION_INSTALL_REPORT

**Instalación correcta. Postflight estructural aprobado. QA manual pendiente.**

Registro: 6 de noviembre de 2026, aproximadamente 19:16, Ciudad de México
(`2026-11-07 01:16 UTC`). La instalación no demuestra todavía el flujo de una
cuenta real; el propietario debe ejecutar el recorrido del punto 14.

## 1. Proyecto Productivo utilizado

Supabase **Lanzo**, referencia **`odlrhijtfyavryeqivaa`**, región `us-east-2`.
El proyecto se confirmó mediante API antes de escribir, estado `ACTIVE_HEALTHY`.
La conexión administrativa ejecutó como `postgres` en la base `postgres`.
No se accedió a otro proyecto Supabase.

## 2. PR, rama y HEAD comprobados

- [PR #410](https://github.com/fdxruli/Lanzo-POS/pull/410): abierto, **Draft**, sin merge.
- Rama: `feat/account-recovery-support-v2`.
- HEAD de código/SQL autorizado y comprobado:
  **`5afcb00650d3b0ab09d3acda8fa121b8c760aea0`**.
- Se comprobó que el HEAD remoto recuperado y los bytes de trabajo coincidían.
- Este reporte y la actualización de estados del manual se añaden después de instalar,
  en la misma rama y PR. Son cambios documentales; el SQL instalado queda inmutable.
  El HEAD documental vigente se consulta en #410.
- La migración sigue pendiente de integración a `main` mediante este PR cuando
  el propietario autorice merge. No se atribuye al instalador autorización para fusionar.

## 3. Archivo SQL instalado

[`supabase/migrations/20261107004310_account_recovery_support_v2.sql`](../supabase/migrations/20261107004310_account_recovery_support_v2.sql)

Se leyó el archivo completo desde el commit autorizado: **37 836 bytes**, UTF-8.
Se ejecutó su contenido íntegro, incluidos `BEGIN`, `COMMIT` y la notificación de
recarga de PostgREST. No se cambió ni se creó una variante del archivo.

## 4. SHA-256 antes de instalar

```text
c602268d7872ea5d9d49b0825599fb68a65adc5959215588cad3d72f9c9b3a60
```

Coincidió con la autorización. Después se volvió a calcular sobre el contenido
canónico almacenado en el ledger: mismo SHA-256 y mismos 37 836 bytes.

## 5. Método real de instalación

Se utilizó la conexión administrativa autenticada de Supabase mediante
**`execute_sql`**, fijando explícitamente el proyecto correcto. No se utilizó
`apply_migration`: esa herramienta no permite seleccionar la versión exacta.
Tampoco se utilizó `db push`, ni se ejecutó la migración V1 de nuevo.

La envoltura de instalación:

1. Abrió una transacción, con límites locales de espera de locks y ejecución.
2. Bloqueó el ledger para serializar su registro.
3. Volvió a exigir V1 instalada, V2 ausente y ausencia de instalación parcial.
4. Contrastó las huellas de las 12 funciones base revisadas antes de instalar.
5. Insertó exactamente versión/nombre y `statements = ARRAY[archivo_canónico_completo]`.
6. Comprobó SHA-256 del texto del ledger dentro de la transacción.
7. Ejecutó a continuación **los bytes originales del archivo**. Su `BEGIN` conserva
   la transacción ya abierta; su `COMMIT` confirma conjuntamente esquema y ledger.
8. Consultó el resultado confirmado, sin invocar operaciones de recuperación.

El comportamiento de esta envoltura, incluidos commit y rollback ante error,
se comprobó previamente en una base PostgreSQL local desechable. El `BEGIN`
anidado puede producir el aviso habitual de transacción ya abierta; no crea
una segunda transacción ni confirma cambios intermedios. No se imprimieron credenciales.

## 6. Registro en el ledger

| Campo | Resultado |
|---|---|
| `version` | `20261107004310` |
| `name` | `account_recovery_support_v2` |
| Filas para esa versión | **1** |
| `statements` | Un elemento: archivo canónico íntegro |
| SHA-256 de `statements[1]` | Idéntico al autorizado |
| V1 `20261106201326` | Ya estaba instalada; no se repitió |

No se asignó una versión alternativa ni se añadieron migraciones ajenas.

## 7. Resultado transaccional

La llamada de instalación terminó correctamente; la consulta posterior encontró
ledger y tabla nueva confirmados. Un postflight independiente volvió a confirmar
ambos. No se registraron errores de instalación ni objetos parciales pendientes.

Las siete tablas comprobadas conservaron **conteo y huella de ID/versión MVCC de
cada fila** antes y después: usuarios, contactos, sesiones Admin, licencias,
dispositivos, desafíos y auditoría. No se extrajeron contraseñas, hashes de
contraseñas, códigos o tokens para esta comparación.

La tabla nueva tenía **cero casos**, y la auditoría tenía **cero referencias a casos
V2** tras instalar. No se abrieron expedientes ni se emitieron códigos para QA.

## 8. RLS, ACL, restricciones y funciones

- RLS activo en las cuatro tablas privadas de recuperación, incluida
  `private.admin_recovery_cases`.
- `anon`, `authenticated` y `service_role`: sin SELECT/INSERT/UPDATE/DELETE ni
  permisos de lectura/actualización por columna en esas tablas. ACL de tablas
  limitada a su propietario `postgres`; sin concesión a `PUBLIC`.
- Los siete helpers privados nuevos y los dos privados V1 revisados son
  `SECURITY INVOKER`, `search_path` vacío, sin EXECUTE para esos roles o `PUBLIC`.
- Nueva RPC `public.admin_request_recovery_contact_change(text,text,text,text,text,text)`:
  propietario `postgres`, `SECURITY DEFINER`, `search_path` vacío; EXECUTE para
  `anon` y `authenticated`, sin EXECUTE para `PUBLIC` o `service_role`, conforme al
  modelo de autenticación propio de LANZO.
- La huella de su cuerpo coincide con el archivo aprobado. Ese cuerpo comprueba
  sesión Admin real con `require_active_admin_session`, propietario activo,
  contraseña actual mediante bcrypt y límite de intentos. No se simuló una sesión
  ni se llamó la RPC con una cuenta real durante el postflight.
- Los cuerpos de las **11 funciones creadas/reemplazadas** coinciden con el archivo.
- **12 restricciones** de la tabla nueva validadas; **7 índices** relevantes válidos
  (incluye PK y el índice nuevo de auditoría). La unicidad parcial permite un solo
  expediente activo por licencia. Se confirmó FK de auditoría y propósitos nuevos.

## 9. Compatibilidad observada con V1

Se confirmaron firmas y ACL anteriores. Nueve funciones base no reemplazadas
conservan sus cuerpos. Incluyen login, autoridad de sesión, creación de sesión,
rate limit, solicitud/vinculación inicial y restablecimiento de contraseña.

Las tres funciones V1 reemplazadas coinciden exactamente con la ampliación autorizada:

- Emisor: guard de expediente activo.
- Verificador: guard tras validar el código, preservando protección contra enumeración.
- Estado: campo aditivo `pending_change`.

Esto demuestra correspondencia estructural con el candidato probado. No sustituye
un nuevo canje manual en Production. El PASS histórico de V1 sigue siendo histórico.

## 10. Desviaciones o fallos reales

No hubo diferencia de proyecto, archivo, SHA-256 o alcance autorizado. No hubo
fallo de instalación, renombrado de versión ni ejecución de otra migración.

Se eligió SQL administrativo para conservar la identidad canónica que la herramienta
de migración automática no permite fijar. No se modificó el SQL para adaptarlo.
No se detectó una regresión que exigiera cambios de código durante esta instalación.

## 11. CI y Preview

El HEAD autorizado dispone de:

- [CI de recuperación aprobada](https://github.com/fdxruli/Lanzo-POS/actions/runs/42321910828):
  **28 pruebas PostgreSQL reales, 166 pruebas UI/transporte/offline, build y precaché**.
- [Comparación global aprobada](https://github.com/fdxruli/Lanzo-POS/actions/runs/42321910817).
- Validación focalizada de ActorRuntime/tenant/auth/lint/builds aprobada en
  [Shared Terminal Actor Runtime Validation](https://github.com/fdxruli/Lanzo-POS/actions/runs/42321910859).
  Las repeticiones globales observacionales seguían ejecutándose al registrar ese estado;
  no se declaran aprobadas anticipadamente.

[Preview comprobado del HEAD autorizado](https://lanzo-yuz9lfwqg-fdxrulis-projects.vercel.app):
`READY`, commit `5afcb00650d3b0ab09d3acda8fa121b8c760aea0`, proyecto `lanzo-pos`.
Se comprobó mediante acceso autenticado HTML LANZO **HTTP 200** y bundle **HTTP 200**.
El bundle contiene únicamente el destino Supabase
`https://odlrhijtfyavryeqivaa.supabase.co`.

Los cambios posteriores de esta entrega son documentales y pueden generar otro
Preview automático. El resultado final indica el HEAD/Preview vigente comprobado.
No se desactivó Deployment Protection ni se hizo despliegue manual a Production.

## 12. Estado de QA manual

**PENDIENTE.** No se ejecutó cambio de contacto, recuperación, bloqueo, emisión de
códigos o revocación con una cuenta real. Tampoco se enviaron correos al cliente.
Instalación, CI aprobada y prueba manual del propietario son resultados diferentes.

## 13. Merge y escrituras sobre cuentas

- No hubo merge ni force push. Se conserva el único PR Draft #410.
- No hubo modificaciones de contraseñas, contactos existentes, sesiones, licencias,
  planes, permisos Staff o datos comerciales durante la instalación.
- La única escritura de datos realizada fue el registro autorizado del ledger;
  las otras escrituras fueron DDL del archivo aprobado.
- No se ejecutaron scripts operativos de soporte ni pruebas destructivas.
- El mismo archivo instalado permanece en #410 con el hash aprobado. Su llegada
  a `main` continúa pendiente de autorización de merge; no se oculta esa diferencia.

## 14. Primer QA manual detallado: cambio autenticado confirmando ambos correos

**Responsables:** propietario del negocio autorizado y operador de soporte.
**Ruta:** caso D del [manual operativo](soporte-recuperacion-cuentas.md).
El instalador no ejecutó estos pasos sobre ninguna cuenta.

### Antes de comenzar

1. Elegir expresamente un negocio autorizado para QA. El propietario debe conocer
   usuario/contraseña y controlar tanto el correo verificado actual como el nuevo.
   No usar otro negocio ni prestar sesiones Staff.
2. Usar el Preview comprobado del commit indicado, con conexión. Un origen Preview
   tiene almacenamiento local propio y puede ocupar cupo de dispositivo; conservar
   las reglas FREE/PRO y no liberar equipos como atajo.
3. Soporte ejecuta [01-buscar.sql](../scripts/support/account-recovery/01-buscar.sql)
   con una búsqueda real, identifica `license_id` y propietario inequívocos, y ejecuta
   [02-diagnosticar.sql](../scripts/support/account-recovery/02-diagnosticar.sql).
   Debe haber contacto verificado y no un caso activo que se esté atendiendo.
4. Registrar referencia de QA, commit/URL, operador, usuario original y datos visibles
   de negocio/plan/dispositivo. No registrar contraseña, códigos ni tokens.
   Si falta contacto verificado, no forzarlo por SQL: preparar primero la vinculación V1.

### Solicitar el cambio desde LANZO

5. Propietario inicia sesión Admin y abre **Configuración → Licencia y Rubros →
   Recuperación → Cambiar correo con ayuda de soporte**.
6. Introduce el correo nuevo y su contraseña actual. Pulsa **Solicitar cambio de correo**.
   Conserva esa sesión abierta y comunica a soporte el **UUID de caso**, nunca su contraseña.
7. Soporte ejecuta [07-historial-caso.sql](../scripts/support/account-recovery/07-historial-caso.sql)
   con ese UUID. Comprobar `kind=authenticated`, `state=open`, propietario y correo
   propuesto correctos, y evento `contact_change_requested_with_password`.
   El contacto anterior debe seguir vigente.

### Verificar el correo nuevo

8. En [05-emitir-correo-caso.sql](../scripts/support/account-recovery/05-emitir-correo-caso.sql),
   completar `p_case_id`, `p_target='new'`, operador y referencia de entrega.
   Ejecutar una sola vez y comprobar `success=true`.
9. Enviar manualmente el código **solo a `delivery_email`**. Es un código de cambio
   de contacto, dura 15 minutos y no debe guardarse en capturas, tickets o informe.
10. El propietario devuelve ese código de contacto exclusivamente al canal oficial
    de soporte. No devuelve códigos de contraseña ni su contraseña actual.
11. En [06-tramitar-caso.sql](../scripts/support/account-recovery/06-tramitar-caso.sql),
    completar caso, `p_action='verify_new'`, operador, referencia y `p_code` con el
    código recibido. Comprobar éxito. 07 debe mostrar `new_verified_at`.
    Todavía no debe haberse reemplazado el contacto.

### Avisar y confirmar el correo anterior

12. Enviar al correo anterior un aviso real del cambio solicitado y cómo oponerse.
    Registrar referencia y resultado con 06: `p_action='notice'`, `p_code=null`.
13. Esperar **al menos 60 segundos entre emisiones**. Se comparten los límites:
    tres códigos por hora y cinco por día por licencia. Si aparece rate limit,
    respetar su ventana; no cambiar fechas o límites por SQL.
14. Ejecutar 05 para el mismo caso con `p_target='old'`; entregar exclusivamente
    al `delivery_email` anterior devuelto.
15. Propietario devuelve ese código de contacto; soporte usa 06 `verify_old` y
    comprueba éxito y `old_confirmed_at` mediante 07.

### Completar y comprobar acceso real

16. Solo cuando consten buzón nuevo, anterior, aviso y sesión original vigente,
    usar 06 con `p_action='complete'`, operador, referencia de cierre y `p_code=null`.
    Esperar `success=true,state=completed`. Repetir por una respuesta perdida
    devuelve `already_completed=true`; consultar historial antes de repetir.
17. **Efecto esperado del QA:** al completar se reemplaza el contacto y se revocan
    las sesiones Admin anteriores. Este efecto no ocurrió durante la instalación;
    forma parte de la prueba que realizará el propietario con su negocio autorizado.
18. Propietario vuelve al login e inicia sesión con su **usuario y contraseña originales**.
    Esta ruta cambia correo, no contraseña. Comprobar entrada real al POS y correo
    nuevo verificado en Recuperación. La sesión anterior debe rechazarse al validarla
    de nuevo online; no se promete cierre inmediato de equipos offline.
19. Soporte consulta 07: `state=completed`, `completed_at` y un evento `case_complete`.
    Comparar identidad, plan, dispositivos y datos visibles del paso 4. Enviar aviso
    de finalización al nuevo y al anterior cuando sea posible.
20. Registrar resultados reales de cada paso, errores y tiempos, sin secretos.
    Solo después de ejecutarlo se podrá declarar aprobado este QA.

**Por qué no espera 24 horas en esta prueba:** el caso D confirma ambos buzones y
la contraseña/sesión original; es la regla aprobada del producto, no un bypass de QA.
Si no se confirma el anterior, usar C y esperar las 24 horas reales desde el aviso.
La excepción E/F conserva segunda revisión y 48 horas reales desde aprobación.
No modificar `not_before`, sesiones, contactos o verificaciones por UPDATE.

**Si falla:** consultar la tabla de errores del manual y 07. Sesión original caducada
exige cancelar/reautenticar/solicitar nuevamente; no cambiar su ID. Correo incorrecto
exige corregir mediante nueva solicitud controlada. Código vencido o cinco intentos
agotados exige reemisión conforme a límites. Una respuesta de red perdida exige
consultar estado y probar acceso antes de asumir que el cambio no sucedió.

## 15. Próxima acción concreta

**El propietario debe ejecutar el QA del punto 14 con un único negocio expresamente
autorizado y ambos buzones bajo su control, acompañado por soporte.** El merge
se solicitará aparte cuando exista evidencia de ese recorrido y checks adecuados.
