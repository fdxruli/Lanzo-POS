# LANZO-POS — Fase 4: comunicación de incidencias

- **Estado de desarrollo:** implementación completa; CI remoto y preview del HEAD de código aprobados. QA manual de dispositivos y certificación de fallos reales permanecen pendientes.
- **PR:** [#357 — feat: unified incident recovery and reporting](https://github.com/fdxruli/Lanzo-POS/pull/357)
- **Rama:** `feat/incident-recovery-center-r1`
- **HEAD inicial verificado:** `eb826a9c952dad6cb84e338cb83775fa6af7989c`
- **HEAD de código validado:** `307c9d307eb05726fb629ac72835a7880f5312a5`. Este informe se actualiza en un commit documental posterior; no modifica el código probado.
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

Resultados remotos del HEAD de código `307c9d307eb05726fb629ac72835a7880f5312a5`:

- PR127 Global Comparison: **SUCCESS**; 99 fallos compartidos de base, 0 candidate-only, 0 nuevos, 1 resuelto, 0 observaciones flaky y 0 identidades pendientes. [Run 38825734754](https://github.com/fdxruli/Lanzo-POS/actions/runs/38825734754).
- Actor Runtime: **SUCCESS**. BASE y CANDIDATE completaron dos suites idénticas por lado: BASE 5,114 PASS / 75 FAIL / 52 SKIP; CANDIDATE 5,235 PASS / 75 FAIL / 52 SKIP. El diferencial encontró 0 regresiones nuevas y 93 fallos persistentes de baseline; 1 observación existió solo en BASE. El objetivo PublicStore repetido pasó 50/50 en cada lado. [Run 38825734760](https://github.com/fdxruli/Lanzo-POS/actions/runs/38825734760).
- Actor Scoped Storage: **SUCCESS**. BASE y CANDIDATE completaron dos suites completas por lado, con los mismos totales y 0 regresiones nuevas; 93 fallos persistentes de baseline. Los siete objetivos PublicStore/Ecommerce pasaron 50/50 en BASE y CANDIDATE; el test de envío duplicado pasó 50/50 en ambos lados. [Run 38825734757](https://github.com/fdxruli/Lanzo-POS/actions/runs/38825734757).
- Dexie Recovery: **SUCCESS**, incluidos tests `admin-login-modal`, builds y quality. [Run 38825734765](https://github.com/fdxruli/Lanzo-POS/actions/runs/38825734765).
- Ecommerce Public: **SUCCESS**. [Run 38825734774](https://github.com/fdxruli/Lanzo-POS/actions/runs/38825734774).
- Store Git Runtime: **SUCCESS**. [Run 38825734766](https://github.com/fdxruli/Lanzo-POS/actions/runs/38825734766).
- La observación one-off de `AdminLoginModal.recovery.test.jsx` detectada en el run previo desapareció tras esperar el efecto React sin quitar la aserción de foco. La expectativa se mantiene; pasó 10/10 ejecuciones locales, y las nuevas suites remotas completaron correctamente.
- Preview Vercel para el HEAD validado: [https://lanzo-lovhjsguu-fdxrulis-projects.vercel.app](https://lanzo-lovhjsguu-fdxrulis-projects.vercel.app), READY y HTTP 200.

El cambio posterior al run fallido solo hizo determinista la espera de la expectativa de accesibilidad y actualizó este informe. No modifica permisos ni comportamiento comercial. Todos los workflows enumerados terminaron; ninguno se cuenta mientras está en ejecución.

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

El PR permanece abierto y Draft, sin merge. En el HEAD de código 307c9d3, los seis workflows solicitados terminaron SUCCESS y el preview responde HTTP 200. La última actualización de este informe es solo documental y conserva ese SHA como la fuente de implementación validada.

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

Estos escenarios requieren entorno aislado desechable, datos y credenciales ficticias, snapshot restaurable, acceso de red restringido y autorización de certificación separada. La migración `20261015134821_technical_incident_reporting_r1.sql` no se aplicó. El RPC remoto no se considera operativo. Las interacciones reales de Telegram y su configuración de mensajes directos siguen sin certificarse; el QA manual y la certificación de fallos reales están pendientes. El preview y CI del código están aprobados.

```text
PHASE_4_STATUS: IMPLEMENTED; SIX WORKFLOWS AND PREVIEW PASS; MANUAL QA PENDING
PR_NUMBER: 357
PR_URL: https://github.com/fdxruli/Lanzo-POS/pull/357
HEAD_INITIAL: eb826a9c952dad6cb84e338cb83775fa6af7989c
HEAD_FINAL: 307c9d307eb05726fb629ac72835a7880f5312a5 (VALIDATED CODE HEAD; REPORT UPDATE IS DOCS-ONLY)
TELEGRAM_CONTACT_VERIFICATION: SHARE API VERIFIED; CHANNEL DM UNVERIFIED
TELEGRAM_INTEGRATION: MANUAL SHARE CHOOSER + EXISTING SUPPORT EMAIL
CONFIRMED_FOLIO_HANDLING: ONLY SUCCESSFUL RECEIPT FOR CURRENT INCIDENT AND CONTEXT
PRIVACY_REVIEW: EXPLICIT ALLOWLIST; NO FREE TEXT OR BUSINESS/FINANCIAL SECRETS
FREE_PRO_BEHAVIOR: TECHNICAL REPORT BOTH PLANS; COMMERCIAL PRO UNCHANGED
OFFLINE_BEHAVIOR: LOCAL DIAGNOSTIC AND COPY; NO QUEUE OR AUTOMATIC RETRY
AUTOMATED_TESTS: FASE4 63/63; BROAD 340/340; FOCUS 10/10; COMBINED 92/92; SQL STATIC 4/4
PR127_RESULT: SUCCESS (99 SHARED BASELINE / 0 CANDIDATE-ONLY / 0 NEW / 1 RESOLVED)
ACTOR_RUNTIME_RESULT: SUCCESS (2X FULL SUITE; 75 SHARED FAILS; 0 NEW; 50/50 FOCUSED)
ACTOR_SCOPED_STORAGE_RESULT: SUCCESS (2X FULL SUITE; 75 SHARED FAILS; 0 NEW; 7X50 + DUPLICATE 50/50)
DEXIE_RESULT: SUCCESS
ECOMMERCE_RESULT: SUCCESS
STORE_GIT_RUNTIME_RESULT: SUCCESS
PREVIEW_URL: https://lanzo-lovhjsguu-fdxrulis-projects.vercel.app (READY; HTTP 200; source commit 307c9d3)
MANUAL_QA_STATUS: PREPARED / NOT RUN; CHANNEL DM BLOCKED / UNVERIFIED
CONTROLLED_FAILURE_QA_STATUS: DEFERRED
SUPABASE_MIGRATIONS_APPLIED: NONE
PRODUCTION_CHANGES: NONE
CRITICAL_BLOCKERS: MANUAL DEVICE QA; ISOLATED REAL-FAILURE CERTIFICATION; TELEGRAM CHANNEL DM CONFIGURATION
READY_FOR_FINAL_CERTIFICATION: NO
READY_FOR_PRODUCTION: NO
MERGE_STATUS: NOT_MERGED
```
