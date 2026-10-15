# LANZO-POS — Fase 4: comunicación de incidencias

- **Estado de desarrollo:** implementado; revalidación remota pendiente tras sincronizar la comprobación asíncrona de foco detectada en CI.
- **PR:** [#357 — feat: unified incident recovery and reporting](https://github.com/fdxruli/Lanzo-POS/pull/357)
- **Rama:** `feat/incident-recovery-center-r1`
- **HEAD inicial verificado:** `eb826a9c952dad6cb84e338cb83775fa6af7989c`
- **HEAD de implementación revisado por CI:** `329281a46b111283f3f4493d7e64346eb01297a6`. El siguiente commit contiene la espera determinista de foco y esta actualización de estado.
- **Producción:** sin cambios. No se aplicó migración Supabase. PR sin merge.

## Resumen

Fase 4 amplía el formulario existente del Centro de Recuperación. El usuario revisa un resumen técnico permitido, decide si copiarlo y selecciona Telegram o correo. La recepción del reporte técnico continúa separada del contacto externo: abrir un enlace no registra ni envía el reporte. Un folio solo pasa al mensaje cuando el reporter valida `success: true`, el formato `IR-XXXXXXXXXXXXXXXX`, la incidencia y el contexto vigente.

El mensaje de contacto usa una lista fija de campos. No añade texto libre, ni siquiera cuando el usuario lo incluyó voluntariamente en el reporte técnico. No se crea una cola de Telegram, bot, token o envío automático.

## Auditoría de Telegram

- El servicio anterior construía enlaces del canal con `https://t.me/LanzoPOS_Oficial?text=...`. Eso apuntaba al perfil del canal con un parámetro de texto; no demostraba que Telegram lo tratara como un mensaje directo al canal.
- Se verificó el formato oficial para compartir texto y URL: [Telegram Sharing Button](https://core.telegram.org/widgets/share). `https://t.me/share/url?url=...&text=...` abre el selector de Telegram para que la persona elija el chat, grupo o canal de destino y revise/edite el contenido. No demuestra que el destinatario reciba el mensaje.
- Telegram documenta la capacidad configurable de mensajes directos para canales en su [anuncio de mensajes directos en canales](https://telegram.org/blog/direct-to-channel-replies). No se pudo comprobar la configuración vigente del canal `@LanzoPOS_Oficial`; los mensajes directos de ese canal quedan **NO VERIFICADOS / NO CERTIFICADOS**.
- El enlace `https://t.me/LanzoPOS_Oficial` se mantiene como referencia pública. La UI no lo rotula como chat confirmado. El enlace de compartir abre el selector, no un mensaje dirigido automáticamente al canal.
- Si Telegram no está instalado o no se puede usar, se conserva el correo configurado por `getSupportEmail()` y su borrador `mailto:`. El usuario lo revisa y envía manualmente.

### Mensaje y enlaces

El resumen generado tiene esta estructura acotada:

```text
Hola, soporte de Lanzo POS.
Lanzo POS · [folio confirmado | diagnóstico local no registrado] · [código técnico] · [categoría] · [sección genérica]
[solicitud breve]
```

- Telegram: `https://t.me/share/url?url=https%3A%2F%2Ft.me%2FLanzoPOS_Oficial&text=...`
- Canal de referencia: `https://t.me/LanzoPOS_Oficial`
- Correo de soporte: valor de `VITE_SUPPORT_EMAIL` o el valor existente de respaldo `lanzocontacto@gmail.com`.
- Longitud del resumen: máximo 420 puntos de código Unicode.

## Arquitectura y archivos

El flujo permanece dentro de `IncidentReportForm`, bajo el Centro de Recuperación. `incidentReporter` conserva los estados y el consentimiento del reporte técnico. `incidentCommunication` produce un texto separado para el canal externo y `telegramContact` genera el selector documentado. La comunicación tiene estado independiente (`prepared`, `copied`, `telegram_open_requested`, `email_open_requested`, `error`, `copy_failed`); no existe estado `sent` para abrir Telegram.

Archivos modificados:

- `src/components/common/IncidentReportForm.jsx` y `.css`: preparación, revisión, copia, enlaces externos, estados accesibles y estilos responsivos con tokens del tema.
- `src/services/diagnostics/incidentCommunication.js`: lista de campos permitidos, límite de longitud y validación de folio/ID/contexto.
- `src/services/diagnostics/incidentReporter.js`: resumen de canal con etiqueta local y folio solo cuando se pasa confirmación explícita.
- `src/services/support/telegramContact.js`: API de compartir documentada y estado de DM no verificado.
- `src/pages/AboutPage.jsx`: textos del acceso existente actualizados para describir selector y canal de referencia.
- `vite.config.js`: se añade el chunk de `telegramContact` al precache del shell administrativo; builds verificados.
- Tests de `IncidentReportForm`, `incidentCommunication`, `telegramContact`, `AboutPage` y `IncidentReportEntry`.
- `docs/reports/INCIDENT.RECOVERY.CONTROLLED.FAILURE.QA.PLAN.md`: escenarios F4-01…F4-10 añadidos y diferidos.

## Folios y privacidad

El constructor acepta el folio solo si el estado técnico es `sent`, `contextIsCurrent === true`, `reportIncidentId` coincide con la incidencia actual y el folio satisface `IR-[A-F0-9]{16}`. El formulario además vincula el recibo al contexto capturado durante el envío. El cambio de incidencia, actor o tenant invalida el resumen preparado. `not_started`, `ready`, `sending`, `failed`, `offline` y `unavailable` generan la etiqueta «diagnóstico local no registrado» y no incluyen ningún folio.

La allowlist del mensaje externo limita los campos a producto, folio válido opcional, código técnico saneado, categoría, ruta genérica y solicitud fija. Se excluyen licencia, tokens, huellas, identificadores de actor/negocio, clientes, importes y ventas, filas de IndexedDB, stack, query string, cuerpos RPC y detalles internos de Supabase. El texto libre no se adjunta automáticamente. El textarea de mensaje está disponible para que el usuario lo revise antes de copiar o abrir un canal externo.

La descripción libre del formulario técnico conserva el contrato de Fase 3: si la persona la escribe, el consentimiento cubre expresamente ese texto para el servicio técnico de Lanzo. La copia y el mensaje de seguimiento externo omiten siempre esa descripción.

## Free / PRO y continuidad offline

| Capacidad | Lanzo Local / Free | Lanzo Nube / PRO |
|---|---|---|
| Ver, preparar y copiar diagnóstico local | Sí, sin backend ni cola | Sí |
| Reporte técnico remoto | Sí, con contexto autorizado, internet y consentimiento; sujeto a disponibilidad de la RPC | Sí, con los mismos controles |
| Mensaje externo por Telegram/correo | Sí; el reporte técnico no concede permisos comerciales | Sí; se conservan los permisos comerciales actuales |
| Tickets o funciones comerciales PRO | No se conceden | Se mantienen según las capacidades vigentes |

Offline: el incidente y el diagnóstico local siguen disponibles; el reporter informa `offline`; no se muestra un folio; preparar/copiar el resumen no necesita Supabase; no hay reintento automático ni persistencia de Telegram. El correo y el selector de Telegram requieren el dispositivo/red correspondientes, pero sus fallos quedan aislados del POS. El build administrativo precarga `telegramContact`; build y auditor de arranque pasan.

## Pruebas automatizadas y validación local

Cobertura TG-01…TG-18 en las pruebas del nuevo formatter, servicio de Telegram y formulario:

- Confirmación de folio real y ausencia de folio si no hay respuesta válida, contexto actual u otra incidencia.
- Estados offline, RPC ausente y fallido; texto externo no incluye secretos ni descripción libre.
- Copia confirmada únicamente después de éxito; selección manual del campo si el portapapeles falla.
- Abrir el selector no modifica el estado del reporter ni provoca otro envío; canal no verificado y fallback por correo.
- Aislamiento de actor/tenant, errores de canal aislados, controles Free/PRO, accesibilidad live/status y ausencia de acción financiera/PWA.
- Responsividad mediante reglas de 520 px y tokens de tema; verificación final en dispositivos reales queda en QA manual.

Resultados locales:

- Pruebas Fase 4 focales: **63/63 PASS** en cinco archivos.
- Regresión amplia de recuperación, ErrorBoundary, actor/tenant, Dexie/IndexedDB, sincronización, finanzas, ecommerce público y arquitectura PWA: **340/340 PASS** en 42 archivos.
- Contrato estático de migración técnica: **4/4 PASS**; no ejecuta ni aplica SQL remoto.
- ESLint focal: **PASS**.
- `npm run build` administrativo y auditor de precache: **PASS**; 24 recursos de arranque auditados y 0 rutas Local eagerly loaded.
- `npm run build:store`: **PASS**.
- `git diff --check`: **PASS** tras el ajuste de sincronización de foco y la actualización del informe.

Resultados remotos del HEAD `329281a46b111283f3f4493d7e64346eb01297a6`:

- PR127: **SUCCESS**; comparación reportó 99 fallos compartidos de base, 0 candidate-only, 0 nuevos y 1 resuelto.
- Actor Runtime: **SUCCESS**; dos suites completas comparadas, sin regresiones candidate-only. Los fallos persistentes del baseline fueron los mismos en base y candidato; los 121 tests añadidos elevan el total de candidato.
- Actor Scoped Storage: jobs focales, builds, suite completa del candidato, 50 repeticiones de cada uno de siete objetivos y 50 envíos duplicados: **SUCCESS**. El gate diferencial reportó una aserción de foco candidate-only que falló en la primera de dos pasadas y pasó en la segunda. Se actualizó la prueba para esperar el mismo foco accesible aplicado por el efecto React; la prueba focal pasó 10/10 corridas locales. El workflow completo debe repetirse sobre el nuevo HEAD y quedar terminal.
- Store Git Runtime, Ecommerce Public y Dexie Recovery: **SUCCESS**.
- Preview del commit de implementación revisado: [Vercel preview](https://lanzo-i5tm690ti-fdxrulis-projects.vercel.app), HTTP 200. El nuevo HEAD de prueba requerirá revisar su preview cuando termine el despliegue.

El único cambio posterior a este CI hace determinista la espera de esa misma expectativa de accesibilidad y actualiza este informe; no altera el comportamiento comercial. Un workflow reejecutándose todavía no cuenta como aprobado.

## Checklist QA manual de Telegram

Estado: **PREPARADO / NO EJECUTADO**. No se usaron folios simulados para afirmar recepción Supabase.

| Caso | Escenario | Resultado a comprobar | Estado |
|---|---|---|---|
| 1 | Android con Telegram instalado | Selector abre; destinatario y texto quedan bajo control del usuario; envío manual | PENDIENTE |
| 2 | Android sin Telegram, navegador | Fallback de compartir o mensaje de no disponibilidad; correo visible | PENDIENTE |
| 3 | Desktop con Telegram Web | Selector/enlace permite elegir o iniciar sesión; sin afirmar recepción | PENDIENTE |
| 4 | Copiar mensaje | Éxito solo con copia real; alternativa de selección manual al fallar | PENDIENTE |
| 5 | Abrir canal oficial | Canal mostrado solo como referencia | PENDIENTE |
| 6 | Revisar mensajes directos del canal | Confirmar configuración desde una sesión autorizada del canal; si no acepta DMs, BLOQUEADO / NO SOPORTADO y usar correo | BLOQUEADO: NO VERIFICADO |
| 7 | Usuario Free | Diagnóstico y reporte técnico autorizable sin ticket comercial PRO | PENDIENTE |
| 8 | Usuario PRO | Herramientas técnicas y permisos comerciales actuales conservados | PENDIENTE |
| 9 | Sin conexión | Diagnóstico y copia local; sin folio ni envío diferido | PENDIENTE |
| 10 | Backend de reportes no disponible | Estado no disponible; sin folio; correo/copia disponibles | PENDIENTE |
| 11 | Folio confirmado en adaptador QA aislado | Solo su incidente actual muestra el folio; no usarlo como evidencia de recepción productiva | PENDIENTE |
| 12 | Accesibilidad y responsive | Teclado, lector de pantalla, móvil/desktop, tema claro/oscuro | PENDIENTE |

## CI, preview y estado del PR

El PR `#357` permanece abierto y Draft, sin merge. El preview y cinco de los seis workflows de validación terminaron SUCCESS en el HEAD `329281a`. El gate diferencial de Actor Scoped Storage queda pendiente de repetición después de hacer estable la espera de foco; no se omite ni se acepta el fallo one-off.

## Certificación final y riesgos pendientes

La certificación controlada de fallos reales está `DEFERRED`. El plan actualizado contiene:

- Error real React → reporte → folio confirmado.
- Fallo Supabase → normalización → reporte.
- Pérdida de red → copia local y reconexión con envío iniciado conscientemente.
- Reporte confirmado → resumen externo Telegram.
- Fallo de Telegram sin afectar el POS.
- Incidente financiero ambiguo sin retry.
- Actor/tenant revocado sin envío con contexto antiguo.
- Free/PRO validado con base aislada.
- Idempotencia y retención verificadas contra PostgreSQL real aislado.

Estos escenarios requieren entorno aislado desechable, datos y credenciales ficticias, snapshot restaurable, acceso de red restringido y autorización de certificación separada. La migración `20261015134821_technical_incident_reporting_r1.sql` no se aplicó. El RPC remoto no se considera operativo. Las interacciones reales de Telegram, sus DMs, el preview y CI son límites pendientes hasta completar las comprobaciones.

```text
PHASE_4_STATUS: IMPLEMENTED; REMOTE REVALIDATION PENDING
PR_NUMBER: 357
PR_URL: https://github.com/fdxruli/Lanzo-POS/pull/357
HEAD_INITIAL: eb826a9c952dad6cb84e338cb83775fa6af7989c
HEAD_FINAL: PENDING REMOTE REVALIDATION
TELEGRAM_CONTACT_VERIFICATION: SHARE API VERIFIED; CHANNEL DM UNVERIFIED
TELEGRAM_INTEGRATION: MANUAL SHARE CHOOSER + EXISTING SUPPORT EMAIL
CONFIRMED_FOLIO_HANDLING: ONLY SUCCESSFUL RECEIPT FOR CURRENT INCIDENT AND CONTEXT
PRIVACY_REVIEW: EXPLICIT ALLOWLIST; NO FREE TEXT OR BUSINESS/FINANCIAL SECRETS
FREE_PRO_BEHAVIOR: TECHNICAL REPORT BOTH PLANS; COMMERCIAL PRO UNCHANGED
OFFLINE_BEHAVIOR: LOCAL DIAGNOSTIC AND COPY; NO QUEUE OR AUTOMATIC RETRY
AUTOMATED_TESTS: 340/340 PRIOR REGRESSION; FASE4 63/63; FOCUS 10/10; COMBINED 92/92
PR127_RESULT: SUCCESS (99 BASELINE / 0 CANDIDATE-ONLY / 0 NEW / 1 RESOLVED)
ACTOR_RUNTIME_RESULT: SUCCESS (NO CANDIDATE-ONLY; SHARED BASELINE FAILURES)
ACTOR_SCOPED_STORAGE_RESULT: BLOCKED; 1 ONE-OFF FOCUS ASSERTION, REVALIDATION PENDING
DEXIE_RESULT: SUCCESS
ECOMMERCE_RESULT: SUCCESS
PREVIEW_URL: https://lanzo-i5tm690ti-fdxrulis-projects.vercel.app (HTTP 200; source commit 329281a)
MANUAL_QA_STATUS: PREPARED / NOT RUN; CHANNEL DM BLOCKED / UNVERIFIED
CONTROLLED_FAILURE_QA_STATUS: DEFERRED
SUPABASE_MIGRATIONS_APPLIED: NONE
PRODUCTION_CHANGES: NONE
CRITICAL_BLOCKERS: ACTOR SCOPED STORAGE REMOTE REVALIDATION; ISOLATED REAL-FAILURE CERTIFICATION; TELEGRAM CHANNEL DM CONFIGURATION
READY_FOR_FINAL_CERTIFICATION: NO
READY_FOR_PRODUCTION: NO
MERGE_STATUS: NOT_MERGED
```
