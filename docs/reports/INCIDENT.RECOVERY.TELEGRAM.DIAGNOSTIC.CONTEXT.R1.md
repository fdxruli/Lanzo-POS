# LANZO-POS — Mini-fase 4.4: Telegram y diagnóstico contextual

**PR:** [#357 — Centro de Recuperación](https://github.com/fdxruli/Lanzo-POS/pull/357)
**Rama:** `feat/incident-recovery-center-r1`
**HEAD inicial auditado:** `59196ccae666d8c03ecb1e4a552adc466a167bd7`
**HEAD de implementación publicado:** `fa48d62f61d3f06e75387f7fce00c87d647e7fb1`
**Estado:** OPEN / Draft · no mergeado

## 1. Diagnóstico del problema de Telegram

El enlace `https://t.me/share/url` es un enlace de compartición: Telegram presenta un selector «Reenviar a» para que la persona escoja un destinatario. No identifica a Lanzo como destinatario de soporte ni abre un chat fijo. Por eso se quitó del acceso principal de ambos formularios de incidencias; se conserva el helper de compartición para los mensajes comerciales que lo usan.

## 2. Deep Links y destinatarios

Se consultó la [documentación oficial de Deep Links](https://core.telegram.org/api/links) y el anuncio oficial de [mensajes directos para canales](https://telegram.org/blog/direct-to-channel-trim-voice-and-more).

- Un nombre público de usuario puede abrir su perfil/chat; el borrador `?text=` solo tiene sentido cuando la persona puede escribir a ese chat. `profile` abre el perfil y no es adecuado como acceso al chat.
- `?direct` es para mensajes directos del canal cuando el propietario habilitó la función asociada al canal. No se asumió compatibilidad de `&text=` con este enlace.
- `t.me/share/url` solicita escoger un destinatario; no es un chat fijo.
- `@LanzoPOS_Oficial` es el canal público oficial conocido. No se comprobó que tenga DMs habilitados y no hay cuenta privada de soporte verificada.

Resultado: `DIRECT_TELEGRAM_SUPPORT_UNVERIFIED`. No se construye ni etiqueta un chat directo supuesto; tampoco se solicita guardar un teléfono. Android, iOS y Telegram Desktop no se han verificado físicamente en esta fase.

## 3. Estrategia del primer contacto y fallback

El formulario prepara y previsualiza el diagnóstico, ofrece copiarlo y abre el canal público solo como referencia. El texto indica que el canal no es un chat de recepción verificado y que copiar/abrir no entrega el reporte. El correo continúa siendo el medio funcional para contactar a soporte; el borrador se revisa y envía manualmente.

No se muestra «Mensaje enviado». Si Telegram no se abre, la persona puede copiar el texto o usar correo. La apertura no crea una segunda pestaña automática ni intenta redirigir repetidamente. Las pruebas de usuario sin contacto previo verifican el fallback de interfaz, no una entrega real.

## 4. Contrato de diagnóstico contextual

La resolución central usa enums de superficie confiable y rutas exactas conocidas. No consume query, hash, URL completa, mensajes de excepción ni stacks.

| Contexto de recuperación | Área funcional | Pantalla afectada | Ruta | Componente supervisado |
| --- | --- | --- | --- | --- |
| `welcome` en `/` | Acceso a Lanzo POS | Bienvenida y activación de licencia | `/` | `WelcomeModal` |
| `pos` en `/` (límite autenticado) | Punto de Venta | Operación del POS | `/` | No determinado |
| `sales` en `/ventas` | Ventas | Panel de Ventas | `/ventas` | No determinado |
| `settings` en `/configuracion` | Configuración | Configuración general | `/configuracion` | No determinado |
| `application` | Aplicación general | No determinada | ruta allowlisted o No determinada | No determinado |
| Sin contexto confiable en `/` | Aplicación general | No determinada | `/` | No determinado |

Las demás rutas registradas (`/caja`, `/clientes`, `/pedidos`, `/pedidos-online`, `/productos`, `/agentes-ia`, `/portal-online`, `/acerca-de`, `/renovacion-urgente`) se nombran mediante un catálogo estático. Un path desconocido se presenta como «No determinada». El POS no se deduce de `/` por sí sola: solo el `ErrorBoundary` autenticado ofrece el contexto `pos`.

La captura local añade `recovery_surface` y `navigation_path`; el helper actualiza esos metadatos locales al deduplicar una falla de otro límite, manteniendo ID, clave y fingerprint. El payload remoto allowlisted y el esquema SQL reservado no incorporan esos dos campos.

## 5. Información técnica avanzada

«Detalles del problema» muestra área, pantalla, ruta sanitizada y componente supervisado. «Información técnica adicional» permanece plegada e incluye límite de recuperación, componente, archivo asociado conocido desde un catálogo estático y origen exacto de la excepción como «No determinado».

El ejemplo Welcome asocia `src/components/common/WelcomeModal.jsx` porque el límite confiable supervisa ese modal. No significa que el modal sea el origen exacto del error. No se interpreta `componentStack`; no se comparte stack, mensaje interno ni ruta local. La copia avanzada es local y requiere una acción explícita aparte.

## 6. Auditoría de privacidad y seguridad

- El generador técnico conserva allowlist; la descripción libre es opcional, excluida por defecto y requiere opt-in.
- Se conservan la guarda de actor/tenant, la invalidación del borrador al cambiar el contexto y la preparación/copia offline.
- No se leen IndexedDB ni registros locales; no se incluyen ventas, importes, clientes, licencias, credenciales, URLs completas ni paths privados.
- Los campos de contexto UI quedan fuera de `createIncidentReportPayload`; no se cambia el contrato SQL.
- No se persiste un borrador comercial, no hay mensajes automáticos ni señal de envío al abrir/cerrar/cambiar visibilidad/copiar.
- La clasificación financiera, gravedad crítica y bloqueo de operaciones ambiguas no se modifican.

## 7. Compatibilidad con PR #365

Al auditar inicialmente #365 estaba OPEN / Draft en `b88ff1fa117c9249ee4893108adda39b7e7db56b`; el SHA aportado por el propietario (`cfab27d…`) ya era histórico. El run anterior [39329923466](https://github.com/fdxruli/Lanzo-POS/actions/runs/39329923466) registró una observación candidato-only aislada en la repetición 2 de `BackupRuntime.attention.test.jsx` (estado leído/no leído después de recuperación). BASE pasó ambas repeticiones; candidato pasó la primera. No era evidencia suficiente de regresión determinista ni permitía atribuir causa.

La revalidación previa a publicar encontró #365 aún OPEN / Draft, ahora en HEAD `13bb52f8226f83ffe56fc2ad6f2fd903ed8c5a38`. En [Actor Runtime 39339317006](https://github.com/fdxruli/Lanzo-POS/actions/runs/39339317006), [Actor Scoped Storage 39339316777](https://github.com/fdxruli/Lanzo-POS/actions/runs/39339316777) y [Device Actor Auth 39339316907](https://github.com/fdxruli/Lanzo-POS/actions/runs/39339316907), los artefactos diferenciales reportan 0 regresiones nuevas, 0 flakies y 94 fallos candidatos preexistentes estables. BASE repitió 5,278 PASS / 75 FAIL / 52 SKIP; candidato repitió 5,330 PASS / 75 FAIL / 52 SKIP. La observación de `BackupRuntime.attention.test.jsx` no aparece en ninguno de los tres resultados actuales; la causa anterior sigue sin demostrarse y #365 no se modificó.

Los demás checks consultados sobre ese HEAD incluyen [PR127 39339317014](https://github.com/fdxruli/Lanzo-POS/actions/runs/39339317014), Dexie/focal-quality y builds focales, todos PASS. En la nueva repetición de PR127 para #357 (véase §10.1) reapareció de forma intermitente la misma aserción de `BackupRuntime.attention.test.jsx`: el candidato falló 3/20 veces y BASE 1/20. Esto prueba que la observación también ocurre en BASE, pero la frecuencia distinta no permite descartarla como regresión ni atribuirle causa. No se modifica este flujo ni #365. El único solapamiento de archivos entre #357 y #365 sigue siendo `src/components/common/AdminLoginModal.jsx`, con zonas de parche separadas; este diff no modifica ese archivo. Tampoco modifica StaffLoginModal, Supabase, licencias, coordinadores, respaldos, notificaciones ni autenticación.

## 8. Compatibilidad con PR #338 y #352

Ambos permanecen OPEN / Draft, sin cambios de esta fase. #338 (`fb17e9a…`) corresponde a cobros/división de restaurante: su check comparativo global y los dos gates diferenciales observados siguen FAIL, mientras otros checks focales pasan. #352 (`d758f69…`, basado en #338) corresponde a supervisión administrativa y solo presenta checks de Vercel PASS en esta consulta. Ninguno comparte archivos con este diff; no se mezclan parches ni se hace cherry-pick.

## 9. Tests automatizados

La cobertura agregada/actualizada incluye:

- Telegram: destino fijo de referencia sin `/share/url`, sin `?direct`, sin prellenado al canal y sin destino arbitrario; los formularios de incidencia anuncian el chat privado no verificado y preservan copiar/correo.
- Diagnóstico DIAG-01–18: Welcome, POS, Ventas, aplicación, configuración, rutas desconocidas, query maliciosa, stacks/rutas locales, componente supervisado vs. origen, mensajes Telegram/correo, gravedad financiera, registros antiguos, deduplicación y contrato remoto.
- ErrorBoundary: copia del diagnóstico con contexto Welcome, panel plegado, archivo estático conocido y copia avanzada local.
- Laboratorio QA: superficie `sales`/`settings`, mensaje de fallback honesto, sin acciones externas ni transporte comercial.
- **Ejecución focal local: 13 archivos, 165/165 tests PASS.** Incluye ambos formularios, Telegram, diagnóstico, comunicación, reporter/payload remoto, centro de eventos asíncronos, ErrorBoundary/copia, recuperación UX y laboratorio QA.
- **Compatibilidad comercial Telegram:** suite de Acerca de y helper en 2 archivos, 27/27 tests PASS; confirma que su vista previa con selector explícito de destinatario permanece independiente del contacto de incidencias.
- **ESLint focal: PASS, 0 errores.** Emitió solo el aviso informativo de que `baseline-browser-mapping` está desactualizado.
- **Build administrativo: PASS.** `postbuild` verificó 23 assets de inicio y 0 assets de rutas core Local. Vite mantuvo avisos de importación mixta y de patrones opcionales de precache sin archivos coincidentes.
- **Build público `build:store:vercel`: PASS.** Auditoría de compliance pasó con 0 violaciones; artefactos públicos preparados localmente, sin publicar/deployar.
- **React Doctor (scope changed):** escaneó 98 archivos; reportó 55 hallazgos (28 mantenibilidad, 5 accesibilidad, 20 bugs y 2 rendimiento). No mostró score porque la revisión de lint/mantenibilidad quedó incompleta. El error `no-ref-current-in-render` apunta a `IncidentReportForm.jsx:83`, línea no modificada en este diff; no se amplió esta fase para refactorizar el guard de identidad existente. Los demás hallazgos se registran como señales del análisis, no como regresiones atribuidas a esta fase.
- `git diff --check`: PASS. CI del commit funcional `fa48d62` pasó los workflows enumerados en §10. La reejecución documental posterior está detallada en §10.1, incluida una observación intermitente que mantiene fallido PR127.

Los saltos a Telegram Android/iOS/Desktop requieren pruebas manuales; construir una URL en test no certifica cliente físico. No se publica ninguna inyección de error.

## 10. Resultados CI del HEAD de implementación `fa48d62f6`

- [PR127 Global Comparison 39343358876](https://github.com/fdxruli/Lanzo-POS/actions/runs/39343358876): SUCCESS. El artefacto reporta 99 fallos compartidos, 0 candidate-only, 0 nuevos, 0 identidades semánticas sin resolver y 1 resuelto.
- [Actor Scoped Storage 39343358926](https://github.com/fdxruli/Lanzo-POS/actions/runs/39343358926): SUCCESS. BASE repitió 5,278 PASS / 75 FAIL / 52 SKIP; candidato 5,457 PASS / 75 FAIL / 52 SKIP. El diferencial reporta 0 regresiones nuevas, 93 fallos candidatos preexistentes estables, 0 candidatos flaky y 1 observación incidental solo en BASE (`src/tests/ErrorBoundary.test.jsx`, `expect is not defined` en ambas repeticiones de BASE; ausente del candidato, causa no determinada).
- [Actor Runtime 39343358882](https://github.com/fdxruli/Lanzo-POS/actions/runs/39343358882): SUCCESS. BASE y candidato repitieron 5,278/75/52 y 5,457/75/52 respectivamente; el diferencial reporta 0 regresiones nuevas, 93 fallos candidatos preexistentes estables, 0 candidatos flaky y la misma observación incidental solo en BASE descrita arriba.
- [Dexie Recovery / focal-quality 39343358888](https://github.com/fdxruli/Lanzo-POS/actions/runs/39343358888): SUCCESS; ocho matrices focales y validación de calidad pasan.
- [Incident Recovery QA Lab 39343358850](https://github.com/fdxruli/Lanzo-POS/actions/runs/39343358850): SUCCESS; `isolated-lab` PASS. La auditoría arquitectura/producción de la suite confirma exclusión de artefactos QA.
- [Store Git Runtime 39343358801](https://github.com/fdxruli/Lanzo-POS/actions/runs/39343358801) y [Ecommerce Public 39343358969](https://github.com/fdxruli/Lanzo-POS/actions/runs/39343358969): SUCCESS.
- Vercel PR Preview terminó SUCCESS; es Preview del PR, no producción. El build público local también pasó compliance sin publicar/deployar.

Los diferenciales comparan BASE y candidato por dos repeticiones completas; los fallos compartidos no se atribuyen a este cambio. Un resultado de BASE ausente del candidato se conserva como observación sin inventar causa.

### 10.1 Reejecución del HEAD documental `4853d5df8`

El commit `4853d5df8b72c3af920f06bb236dddc48b5d1df9` solo modifica este informe. GitHub lanzó una nueva serie de gates sobre ese SHA:

- [PR127 Global Comparison 39346400127](https://github.com/fdxruli/Lanzo-POS/actions/runs/39346400127): **FAILURE**. BASE y candidato tuvieron 100 fallos cada uno y 99 compartidos; la comparación clasificó una observación candidata-only en `BackupRuntime.attention.test.jsx`, sobre el estado leído/no leído luego de recuperación. Las pruebas enfocadas de seguimiento repitieron ese caso 20 veces: BASE falló 1 vez y candidato 3 veces. Como también aparece en BASE, es intermitente y no hay cambios de #357 en respaldos; con todo, el diferencial de esta corrida queda **sin resolver**, no se declara PASS ni se atribuye causa.
- El mismo artefacto marca como resuelto en candidato el fallo BASE-only `src/tests/ErrorBoundary.test.jsx` (`expect is not defined`), observado en las corridas completas previas.
- En la última consulta, los otros checks focales, Vercel, laboratorio aislado, Ecommerce, contratos y validación estaban PASS; las repeticiones completas observacionales BASE/candidato de Actor Runtime y Actor Scoped Storage seguían `IN_PROGRESS`. Los estados corresponden a la consulta del 20 oct 2026, no a una certificación final de esos cuatro jobs.
- Esta observación es compatible con la señal histórica del PR #365, pero no se demostró que tenga la misma causa ni que #357 la introduzca. No se cambian tests, aserciones, código de backups ni archivos del PR #365 para intentar resolverla.

## 11. Evidencia visual

La distribución aprobada de Mini-fase 4.3 sigue sin cambios: panel superior, formulario inferior a ancho completo, dos columnas internas solo donde corresponde, formulario móvil de una columna y detalles avanzados plegados. Las cuatro capturas de esa fase sirven como referencia de composición, no como evidencia de los nuevos textos contextuales. La verificación de campos y estados nuevos queda respaldada por las suites DOM indicadas arriba; no se ha aprobado QA visual manual.

Referencia visual histórica:

- [Escritorio claro, 1440×1000](./incident-recovery-contact-ux-r1/screenshots/desktop-light.jpg)
- [Escritorio oscuro, 1440×1000](./incident-recovery-contact-ux-r1/screenshots/desktop-dark.jpg)
- [Móvil claro, 390×844](./incident-recovery-contact-ux-r1/screenshots/mobile-light.jpg)
- [Móvil oscuro, 390×844](./incident-recovery-contact-ux-r1/screenshots/mobile-dark.jpg)

## 12. Checklist de localhost del propietario

Usar una copia de trabajo separada; no cambiar/restaurar la carpeta que conserva inyecciones intencionales. En PowerShell:

```powershell
git clone -b feat/incident-recovery-center-r1 https://github.com/fdxruli/Lanzo-POS.git Lanzo-POS-mini-phase-4-4
cd Lanzo-POS-mini-phase-4-4
npm ci
git rev-parse HEAD
npm run dev
```

Después de instalar, `npm run dev` permite revisar el producto desde localhost. Abrir `http://localhost:5173/__qa/incident-recovery` (o el puerto que Vite indique) para los fallos controlados; el laboratorio usa adaptadores en memoria, nunca ventas reales ni cuentas productivas. Checklist:

1. Provocar el fallo de Welcome en el entorno QA.
2. Copiar el diagnóstico técnico y comprobar Área de acceso, pantalla de bienvenida y ruta `/`.
3. Preparar el mensaje de Telegram y revisar la vista previa antes de copiarlo.
4. Abrir Telegram en Android sin tener guardado un contacto de Lanzo.
5. Confirmar que se abre chat directo verificado o, mientras siga no verificado, que se muestra el fallback honesto de canal/copia/correo.
6. Pegar y enviar manualmente solo a un destinatario privado verificado; la copia no es envío.
7. Confirmar que Lanzo nunca muestra una confirmación de entrega.
8. Probar el correo electrónico como medio funcional.
9. Provocar el fallo de Ventas con el laboratorio QA y revisar Área Ventas, pantalla Panel de Ventas y `/ventas`.
10. Revisar tema claro y oscuro.
11. Revisar anchos 320, 360, 390, 430, 768 y 1440 px.
12. Abrir «Información técnica adicional» y comprobar el archivo asociado conocido y el origen como no determinado.
13. Confirmar que no hay nombres privados, stacks, rutas locales, datos comerciales ni credenciales.
14. Probar foco, navegación por teclado, textarea y cierre/restauración del foco.
15. Cambiar actor/tenant durante la preparación y confirmar que se invalida el borrador anterior.
16. Repetir preparación y copia offline; no ejecutar operaciones de venta.

El QA físico de Android no sustituye al fallback: mientras no exista destinatario o DM verificado, marcar chat directo **BLOCKED** y verificar copia/correo por separado. No usar cuentas productivas para provocar errores de sesión ni ejecutar ventas.

## 13. Limitaciones y decisión

- Falta verificar que el canal oficial reciba DMs o disponer de una cuenta privada de soporte autorizada. No se habilita `?direct` sin esa comprobación.
- Android, iOS y Desktop Telegram no se han probado en dispositivo/cliente real.
- La QA visual/manual del propietario y la QA de localhost siguen pendientes.
- El QA del chat directo queda `BLOCKED` hasta verificar que el canal acepta mensajes directos o recibir autorización para una cuenta privada dedicada; copiar/correo sí están implementados.
- La certificación automatizada del HEAD final se completa después del push y antes de cerrar esta nota.

```text
DIRECT_TELEGRAM_SUPPORT: BLOCKED_UNVERIFIED_RECIPIENT
TELEGRAM_CHANNEL_REFERENCE_FALLBACK: IMPLEMENTED
EMAIL_FALLBACK: PRESERVED
OWNER_LOCALHOST_QA: PENDING
READY_FOR_OWNER_QA: YES (fallback y diagnóstico; chat directo bloqueado)
READY_FOR_PRODUCTION: NO
SUPABASE_CHANGES: NONE
MIGRATIONS_APPLIED: NONE
PRODUCTION_CHANGES: NONE
MERGE_STATUS: NOT_MERGED
```
