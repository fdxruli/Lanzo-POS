# LANZO_ACCOUNT_RECOVERY_SUPPORT_V2_REPORT

Fecha de revisión: 6 de noviembre de 2026, hora de Ciudad de México.
**Candidato preparado y probado. SQL V2 sin instalar. QA manual V2 pendiente.**

## 1. Objetivo demostrado

Soporte puede localizar cuentas sin leer tablas sensibles completas y conducir la
recuperación normal ya existente. El candidato añade cambio de contacto con
credenciales y una excepción documentada con pruebas externas, segunda revisión,
verificación de buzón y espera. Conserva el propietario original. Una sospecha puede
congelar recuperaciones sin conceder acceso ni cambiar contacto.

Los flujos nuevos están demostrados mediante PostgreSQL real local y pruebas de
interfaz/transporte. Su funcionamiento con un propietario real en Preview conectado
a Production **todavía no está demostrado**: depende de autorizar la migración exacta
y ejecutar el recorrido manual del manual. No se declara cumplida la entrega operativa V2.

## 2. Matriz A–I

| Caso | Estado del candidato | Límite / paso operativo |
|---|---|---|
| A: contraseña olvidada, correo controlado | Ya existente V1; regresión SQL aprobada | 01 → diagnóstico → 03 `password` → canje en LANZO |
| B: usuario y contraseña | Ya existente V1 | Mismo recorrido; devuelve usuario original tras canje |
| C: perdió correo, conserva credenciales | Implementado V2; manual pendiente | Solicitud Admin + contraseña; verificar nuevo; aviso y 24 h; sesión original vigente |
| D: controla ambos correos | Implementado V2; manual pendiente | Contraseña/sesión y ambos buzones; aviso; cierre inmediato permitido |
| E: perdió contraseña y correo | Implementado condicional V2; manual pendiente | Dos fuentes reales, segundo revisor, buzón nuevo, aviso y 48 h; después V1 |
| F: perdió todo, sin correo | Implementado condicional; bloqueado si faltan pruebas/identidad | No crear propietario ni inventar contratación; falta de evidencia exige negativa |
| G: teléfono/dispositivo perdido | Procedimiento documentado; contratos existentes conservados | Recuperar cuenta no autoriza equipo ni reconstruye IndexedDB perdida |
| H: compromiso/apropiación | Bloqueo preventivo V2 y controles documentados | Invalida códigos, revoca Admin, congela recuperación; no puede convertirse en excepción |
| I: fallos operativos | Implementado/documentado; base SQL probada | Historial, códigos, límites, concurrencia, repetición y rollback; red/PWA reales pendientes |

## 3. Decisiones técnicas

- Búsqueda por contacto vigente, correo verificado anterior o correo histórico de
  licencia/suscripción; encontrar por historia no habilita entrega a ese buzón.
- Reutiliza contactos, desafíos, auditoría, criptografía, bloqueo de licencia y canje
  V1. No reemplaza autenticación ni implementa otro sistema de propietarios.
- Un expediente privado por licencia activa simplifica selección y concurrencia.
  Estados: abierto, aprobado, bloqueado, completado, cancelado; expiración de siete días.
- El código de cambio de contacto se devuelve al soporte oficial y se consume por SQL.
  El código de contraseña sigue siendo canjeado exclusivamente en LANZO por el cliente.
- Confirmar ambos buzones con contraseña/sesión evita una espera innecesaria en D.
  Sin buzón anterior: 24 h desde aviso; excepción: 48 h desde segunda aprobación.
- La referencia escrita no acredita identidad automáticamente. La autenticidad de
  documentos y la identidad real de revisores se comprueban fuera de PostgreSQL.
- `security_hold` admite únicamente bloqueo/cancelación. Su ausencia de evidencia
  no permite emitir códigos, verificar buzón, aprobar ni completar un cambio.

## 4. Cambios

- [Migración canónica](../supabase/migrations/20261107004310_account_recovery_support_v2.sql).
- [Ocho scripts SQL de soporte](../scripts/support/account-recovery/).
- [Manual completo](soporte-recuperacion-cuentas.md), con decisiones, A–I, errores,
  mensajes, evidencias, fallos, seis ejemplos y prueba manual.
- [Referencia V1](admin-support-recovery.md): corrige estado histórico y señala manual vigente.
- `src/components/settings/RecoveryContactSettings.jsx`: solicitud de cambio con
  contraseña y referencia de caso, sin panel administrativo.
- `src/services/auth/adminRecoveryService.js`: transporte con autoridad Admin existente;
  sin persistir contraseñas ni registrar códigos.
- Runner PostgreSQL, fixture, pruebas UI/transporte y workflow focalizado ampliados.
- No se cambiaron permisos Staff, datos comerciales, dispositivos, planes o Dexie.
  Base: `main` `3cc574d833a4f962247c462e3212ddb4c6a03910`, que ya incluye #408.

## 5. SQL exacto para autorización

- Archivo: `supabase/migrations/20261107004310_account_recovery_support_v2.sql`.
- Versión: **`20261107004310`**, creada mediante CLI de Supabase.
- SHA-256: **`c602268d7872ea5d9d49b0825599fb68a65adc5959215588cad3d72f9c9b3a60`**.
- Alcance: una tabla privada de casos y cinco índices; `case_id` e índice en auditoría;
  dos propósitos adicionales de desafío; siete helpers privados y una RPC nuevos.
  Actualiza emisor/verificador V1 con guard de casos y status con campo aditivo.
  Instalación transaccional; recarga de esquema al commit. No cambia cuentas existentes.
- Dependencias: V1 instalada, `private`/`extensions`, pgcrypto, tablas de licencias,
  identidad/sesiones/dispositivos, perfiles/suscripciones y helpers de autoridad/rate limit.
- Se compararon las huellas del cuerpo de **12 funciones base** con Production:
  coincidencia completa. No se extrajeron hashes de contraseñas ni tokens.
- Privilegios: siete helpers privados sin grants a PUBLIC/anon/authenticated/service_role;
  tabla privada con RLS y ACL cerradas. Solo la nueva RPC propietaria se concede a
  anon/authenticated, por el modelo de login personalizado de LANZO; comprueba sesión
  Admin y contraseña en backend. No hay nuevo grant a funciones privadas de soporte.

**No ejecutar todavía.** Tras autorización explícita: volver a consultar ledger,
verificar SHA exacto, instalar únicamente este archivo en el proyecto acordado y
registrar exactamente la versión canónica. No usar `db push` general, no repetir V1
ni permitir una versión renombrada silenciosamente. Verificar catálogo/ACL/RLS,
contenido instalado y ledger. Si la herramienta asigna otro nombre/versión, detenerse
antes de aplicar y resolver el procedimiento. Conservar este archivo idéntico en
el mismo PR y llevarlo a main cuando se autorice merge; no cerrar la entrega con
ledger/main divergentes.

## 6. Seguridad

Aislamiento por licencia/propietario, bloqueo de licencia antes de mutaciones,
contacto anterior capturado y comprobado al cierre, códigos aleatorios de un uso,
hash SHA-256, 15 minutos y cinco intentos. Emisiones comparten límite V1:
60 segundos, tres por hora y cinco por día. Una sola solicitud activa por licencia.

Canje/cambio y auditoría son atómicos; error revierte efectos. Completar o bloquear
revoca sesiones Admin e invalida desafíos pendientes. No se promete cierre offline
inmediato: conserva el máximo local existente de siete días desde validación,
acotado por vencimientos. No cambia sesiones Staff ni permisos comerciales.

La función pública de canje solo revela un hold tras validar un código real,
conservando protección contra consultas de estado con una licencia conocida.
SQL Editor puede conservar consultas/resultados según su configuración; restringir
acceso, no compartir/exportar códigos y retirar texto operativo del editor después
del uso. La auditoría de aplicación no guarda secretos. El emisor SQL es una
facultad administrativa confiada; no pretende proteger contra un DBA malicioso.

## 7. Pruebas y límites

- **27/27 PostgreSQL 17.6 real local**, más cuatro pruebas focalizadas finales de
  búsqueda/ACL (una nueva): **28 pruebas únicas cubiertas**. Cobertura: V1, FREE/PRO, cambio C/D, excepción E/F,
  rechazo de evidencia, propietarios ausentes, aislamiento, códigos incorrectos,
  vencimiento, cinco intentos, reemisión, límites, casos simultáneos, canjes concurrentes,
  doble cierre idempotente, rollback por fallo de auditoría, ACL y Staff,
  sesión caducada, contacto cambiado, licencias suspendidas/vencidas y bloqueo preventivo.
- **166/166 pruebas de nueve suites UI/transporte/autoridad/offline aprobadas en CI**.
  Las seis pruebas de Recuperación también se ejecutaron localmente tras su ajuste final.
- CI focalizada del código inicial y del commit documental posterior: aprobada
  (PostgreSQL, UI/transporte/offline, build y precaché). El ajuste SQL final amplía
  únicamente búsqueda histórica; sus cuatro pruebas locales pasaron. Consultar CI
  del HEAD final para confirmar su ejecución completa.
- ESLint de cuatro archivos JS/JSX modificados; build y verificaciones de precaché: aprobados.
- HTTP autenticado del Preview: HTML LANZO 200 y bundle 200. Bundle contiene
  `https://odlrhijtfyavryeqivaa.supabase.co`. No se modificó Deployment Protection.
- La fixture local delimita tablas comerciales y entitlement. No sustituye el
  esquema completo ni prueba recepción real de correo, móviles/PWA reales o tiempos
  reales de 24/48 h. En fixture se adelantan fechas; no existe bypass productivo.
- QA manual V1 histórico: confirmado por propietario según contexto de entrega #407.
  QA manual de este candidato V2: **no ejecutado**. Recorrido detallado en manual.

Comando reproducible, con psql y PostgreSQL local:

```sh
RECOVERY_TEST_PGURL=postgresql://postgres@127.0.0.1:55432/postgres \
  node --test scripts/supabase/admin-support-recovery.node-test.mjs
```

El runner rechaza hosts remotos y crea/elimina una base temporal propia.

## 8. GitHub

- Rama única: `feat/account-recovery-support-v2`.
- PR único: [#410 — Draft](https://github.com/fdxruli/Lanzo-POS/pull/410).
- Commit inicial de implementación probado y desplegado en Preview:
  `5a8e63688f38e2c86ac64c605a0f259b431b37f9`.
- La revisión final añade búsqueda por contactos históricos/suscripción, prueba
  focalizada y este informe con el SHA SQL definitivo. El HEAD exacto se obtiene
  del PR; el hash del punto 5 identifica el SQL candidato final.
- Sin merge ni force push. Las CI iniciales focalizadas aprobaron; los checks
  globales y la ejecución completa del HEAD deben consultarse en #410.
  No se despachó ninguna migración.

## 9. Vercel

- [Preview probado por HTTP](https://lanzo-hp0y4at3p-fdxrulis-projects.vercel.app).
- Proyecto `lanzo-pos`, estado **READY**, entorno Preview (`target=null`).
- Commit: `5a8e63688f38e2c86ac64c605a0f259b431b37f9`.
- Protegido por acceso habitual de Vercel; se consultó mediante herramienta autenticada.
- Conectado al proyecto Supabase Production correcto según bundle servido.
- Push Git generó Preview automáticamente; no se desplegó ni promovió Production.

## 10. Production

Proyecto `odlrhijtfyavryeqivaa`. Último ledger observado: **`20261106201326`**.
V1 instalada. **V2 no instalada ni autorizada.** Consultas de preparación de solo
lectura: ledger, catálogo, ACL, conteos y huellas de cuerpos de funciones. No se
cambiaron contraseñas, contactos o sesiones reales. main/ledger conservan V1;
la migración pendiente está únicamente en el Draft.

## 11. Manual

[Manual operativo completo de soporte LANZO POS](https://github.com/fdxruli/Lanzo-POS/blob/feat/account-recovery-support-v2/docs/soporte-recuperacion-cuentas.md).
Incluye guía rápida, campos de búsqueda, decisiones A–I, scripts existentes,
mensajes, errores, evidencias, fallos parciales y seis ejemplos ficticios.

## 12. Uso inmediato

Primer script: [01-buscar.sql](../scripts/support/account-recovery/01-buscar.sql),
solo lectura y compatible con V1. Sustituir `BUSQUEDA` por licencia, nombre parcial,
correo completo o UUID. Seleccionar cuenta inequívoca; ese dato no acredita propiedad.

Después de instalar V2: 02 diagnostica. A/B usa 03 y canje en LANZO; C/D empieza
en Recuperación con contraseña y sigue 05/06/07; E/F usa 04, segunda aprobación
06, código 05, verificación/aviso/espera/cierre 06 y después 03. H usa 08 para
congelar y 07 para revisar, sin conceder acceso. G sigue dispositivos/datos por
procedimiento separado. I consulta historial antes de repetir operaciones inciertas.

## 13. Bloqueos y riesgos comprobados

- Production tiene cero suscripciones/referencias de proveedor en la tabla revisada;
  no permite verificar pagos de contratación internamente. Se requieren originales
  externos preexistentes. Correo histórico y datos comerciales no acreditan titularidad.
- Sin propietario administrativo original activo o dos fuentes independientes:
  E/F bloqueados. No hay migración histórica de identidades en esta entrega.
- Sin segundo revisor real: excepción bloqueada; dos alias no satisfacen el control humano.
- SQL Editor/logs pueden conservar códigos escritos/mostrados. Acceso restringido y
  códigos consumidos/expirados acotan el riesgo; no se promete ausencia en logs de infraestructura.
- Sesiones offline y datos locales perdidos conservan los límites existentes.
- Instalación productiva y QA manual faltantes impiden declarar V2 operativa hoy.

## 14. Próxima acción

**Autorizar instalar únicamente la migración V2 identificada en el punto 5, con ese
SHA-256, en el proyecto Production acordado.** Después se verificará instalación
y se ejecutará el recorrido manual con el propietario; merge se autoriza aparte.
