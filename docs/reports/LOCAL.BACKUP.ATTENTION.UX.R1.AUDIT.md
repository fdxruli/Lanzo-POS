# Auditoría previa — Local Backup Attention UX R1

Documento de la fase previa a cambios. Sus propuestas se contrastan con la implementación y los resultados finales en LOCAL.BACKUP.ATTENTION.UX.R1.md. El propietario autorizó continuar sin verificación visual.

## Referencias y aislamiento

- Repositorio: https://github.com/fdxruli/Lanzo-POS
- `origin/main`, después de fetch y contrastado con `git ls-remote`: `bca323cddebac97678f6b388d7abbdf7d3cfc730`.
- Checkout original: `C:/dev/Lanzo-POS-Git`, rama `codex/about-free-mobile-first-r1`, HEAD `dd12f03aeb471700d1f73c344fadc630a5e943d9`.
- Los archivos de aplicación se inspeccionaron mediante `git show origin/main:<ruta>`, evitando atribuir al main vigente el contenido del checkout original.
- El checkout original ya tenía informes de restauración y `scripts/recovery/` sin seguimiento. Se preservaron; no se cambiaron ramas ni archivos de aplicación.
- Se creó y registró una copia administrada desde `origin/main`. Operación `1b698b93-5a64-4c01-bf39-8295e9dc19be`, revisión final 103, estado completed, sin error de registro. Ruta: `C:/Users/pituf/.codex/worktrees/local-backup-attention-ux-r1/Lanzo-POS-Git`, sobre el SHA de main citado. No se utilizó para implementar.
- Rama preparada desde main: `feat/local-backup-attention-ux-r1`.
- No se aplicaron migraciones, restauraciones ni escrituras a Supabase, y no se modificaron datos productivos.

## PR abiertos: estado comprobado

Se consultó el conector de GitHub y `gh pr list --state open --limit 100`, incluyendo ramas, SHAs, bases, archivos y estado de integración. La lista devolvió tres PR abiertos. Los SHAs de base de la respuesta individual de un PR se conservan como metadatos de ese PR; el main vigente utilizado en las simulaciones es `bca323cd...`.

| PR | HEAD | Base | Estado de GitHub |
| --- | --- | --- | --- |
| [#357](https://github.com/fdxruli/Lanzo-POS/pull/357) | `feat/incident-recovery-center-r1` / `fbef877583a20f87b69fff293642623ec7ef73b0` | `main` | OPEN, Draft, CONFLICTING / DIRTY |
| [#338](https://github.com/fdxruli/Lanzo-POS/pull/338) | `feat/restaurant-split-flexible-payments-r1` / `fb17e9a43929d54087ab937cb760a8cd6e087c36` | `main` | OPEN, Draft, CONFLICTING / DIRTY |
| [#352](https://github.com/fdxruli/Lanzo-POS/pull/352) | `feat/restaurant-admin-supervision-r1` / `d758f69b2119f1bc346eb0ac86ba0a74c0265668` | `feat/restaurant-split-flexible-payments-r1` | OPEN, Draft, MERGEABLE / CLEAN respecto de su base |

Las simulaciones se ejecutaron con Git 2.53 mediante `merge-tree --write-tree --name-only`. No se ejecutó merge ni se modificaron índices o checkouts. El Git 2.35 del PATH no soporta esa variante; se utilizó el Git incluido en el runtime.

Conflictos reales obtenidos contra el main vigente:

- #357: `src/components/common/PostDowngradeRecoveryBanner.jsx`.
- #338: `.github/workflows/shared-terminal-actor-scoped-storage.yml`, `src/App.jsx`, `src/store/slices/license/licenseBackgroundValidationActions.js`, `src/store/slices/license/licenseIntegrityActions.js`, `src/store/slices/license/licenseProcessingActions.js`.
- #352: su estado limpio corresponde a #338; no significa integración limpia con main ni certificación operativa.

Por tanto, el `mergeable: false` de #357 y #338 corresponde a conflictos de contenido reproducidos, además de que ambos son Draft. No se atribuyó únicamente a checks, protecciones o condición Draft.

Ningún PR listado modifica los archivos principales previstos para esta mejora: BackupRuntime, backupRuntimeNotice, NotificationBell, LocalInventoryOperationalAlertsDrawer, notificationCapabilities o createUISlice. El alcance propuesto evita App, Layout, main, recuperación, licencias y workflows. Revalidar las intersecciones y los SHAs antes de publicar un candidato. **Todavía no existe candidato cuya integración pueda certificarse.**

## Auditoría funcional del main

Archivos examinados: `BackupRuntime.jsx` y su CSS, `BackupReminder.jsx`, `BackupRiskEvaluator.js`, `backupRuntimeNotice.js` y sus pruebas, `backupManager.js`, `backupConfigDb.js`, `useBackupManager.js`, `createUISlice.js`, `Navbar.jsx`, `NotificationBell.jsx`, `LocalInventoryOperationalAlertsDrawer.jsx`, `NotificationCenter.css`, `notificationCapabilities.js`, `postDowngradeCashAttention.js`, `usePostDowngradeCashPending.js`, `BackupSettings.jsx`, `SettingsPage.jsx`, `useSettingsAccess.js`, `settingsAccessPolicy.js`, `useActorRuntimeSnapshot.js`, `tenantWorkerContext.js`, y partes pertinentes del router de bases de tenant y de App. Se identificaron las suites relacionadas y el workflow PR127.

1. La configuración cifrada reside en Dexie `LanzoBackupConfig`, tabla settings, registro `primary`. Incluye configuración, handle de carpeta, resultado, pendiente y bloqueo automático. La tabla secrets contiene CryptoKey y metadatos de reanudación. **No se propone modificar esta base ni su esquema.**
2. La reanudación exige coincidencia entre el marcador de sesión del navegador y el registro persistido, además de verifier, salt e iteraciones. En una nueva sesión se descarta una clave no correspondiente. No se debe persistir PIN ni extender la vigencia de la autorización para resolver este problema UX.
3. `BackupRuntime` mantiene un temporizador de inactividad de cuatro horas y listeners de actividad/visibilidad. El retorno `null` de su UI no desmonta sus efectos. El cambio debe conservar el componente montado y probar que el temporizador sigue invocando al gestor después de cerrar el aviso.
4. `backupManager.backup` rechaza contexto tenant ausente, sesión bloqueada y operación concurrente; valida vigencia de tenant antes y después del trabajo del Worker. La restauración exige respaldo preventivo y vuelve a validar el contexto. Estas guardas deben permanecer intactas.
5. En navegadores con File System Access, `queryPermission` determina el permiso. Un respaldo automático sin autorización marca `cronPending`; no fuerza un diálogo. En navegadores sin esa API, el automático marca pendiente de descarga; el manual permite el modo Blob. **No se puede prometer respaldo automático en todos los móviles.**
6. Un fallo real registrado conserva `lastResult: error` y `lastError`; puede bloquear el cron. Un éxito confirmado limpia pendiente/bloqueo y registra fecha y archivo. Leer una alerta no equivale a ese éxito.
7. El aviso actual se prioriza así: reautorización Drive; silencio durante inicio/ocupado; configuración; cron bloqueado; desbloqueo; permiso; pendiente. El desbloqueo precede al permiso incluso si ambos faltan. Una nueva política debe explicar prioridades, no inferir éxito de la ausencia de banner.
8. `createUISlice` guarda un único cierre en `sessionStorage`. `BackupRuntime` lo limpia cuando no hay aviso, incluida la transición busy. Eso permite perder el cierre ante cambios transitorios, además de no sobrevivir a una sesión nueva.
9. El banner actual contiene PIN, acción directa de permiso y enlaces de configuración a `tab=maintenance`. La pestaña `tab=backup` existe y se autoriza mediante `sync`; su flujo ya utiliza guardas de actor. La acción del recordatorio debe dirigirse allí sin duplicar PIN en otras superficies.
10. Navbar permite reabrir el banner tanto en móvil como en desktop. Esas dos acciones son las candidatas a retirar. Los accesos a Configuración, actualización, instalación y los indicadores de riesgo/almacenamiento son independientes y deben conservarse.
11. La campana local cuenta incidencias activas de inventario y agrega una incidencia por el grupo de cajas pendientes, no una por caja. Su contador tiene semántica de activos, distinta a las notificaciones nuevas de nube. La alerta de respaldo debe añadir como máximo una incidencia activa y no alterar los contadores cloud.
12. La campana local está actualmente condicionada por capacidad de inventario y permiso products/inventory. Respaldos requiere autorización independiente conforme a `useSettingsAccess().canAccessSection('backup')`; no se debe ampliar el permiso sync ni dar a inventario acceso implícito a respaldos.
13. App monta BackupRuntime y BackupReminder exclusivamente cuando la licencia no usa sincronización POS cloud. PRO conserva la copia local opcional en Configuración. No hace falta modificar App para mantener esa separación.
14. BackupRiskEvaluator mide volumen sin respaldar: niveles a 50, 100 y 300 mutaciones; posponer desplaza el límite 100 mutaciones. BackupReminder conserva el nivel alto y lo degrada a banner durante transacciones. Estos avisos de riesgo no son el recordatorio rutinario del PIN.
15. El drawer ya contiene Escape, ciclo de Tab, restauración de foco y bloqueo de scroll de body. Su CSS incluye 100dvh y safe-area. Esto es evidencia de código, **no prueba visual o de accesibilidad**. Con una sección adicional hay que comprobar que todas las secciones sigan siendo desplazables en ventanas de poca altura.

## Matriz de estados y prioridades propuesta, previa a implementación

La prioridad se evalúa exclusivamente con contexto de actor/tenant autorizado y capacidades locales de respaldo habilitadas, sin activar el centro cloud. El objeto de alerta activo es único por contexto. No persistir el texto libre de errores del gestor en preferencias.

| Prioridad / estado | Evidencia verificable | Campana / acción propuesta | Recordatorio inicial |
| --- | --- | --- | --- |
| Contexto inválido o permiso ausente | Actor no concedido, identidad no coincidente, tenant no vigente o falta de sync | Ocultar datos y acciones; invalidar resultados asíncronos previos | No mostrar ni grabar preferencias |
| Inicializando | `initialized` falso | Estado desconocido; nunca «Protección activa» | Esperar estado estable |
| Ocupado | `busy` verdadero | Conservar la última condición estable del mismo contexto o mostrar progreso; no resolver incidentes | No reiniciar historial ni crear duplicados |
| Error real | `lastResult === error` o `cronBlocked` con estado del gestor | «Los respaldos necesitan atención» / Revisar problema | Una nueva gravedad actualiza la entrada; no reactiva un aviso ya reconocido |
| Sin configurar | `configured` falso | «Configura tus respaldos» / Ir a respaldos | Compacto, una vez por condición/contexto |
| Permiso requerido | Configurado, API compatible, permiso distinto de granted | «Se necesita autorizar la carpeta» / Autorizar carpeta en Configuración | Una vez para esa condición/contexto |
| Bloqueado | Configurado y `unlocked` falso | «Respaldos cifrados bloqueados» / Desbloquear en Configuración | Nueva sesión no equivale a incidente nuevo |
| Pendiente | `cronPending`, sin error o condición de mayor prioridad | «Hay un respaldo pendiente» / Revisar | Sin repetición al navegar o reconectar |
| Operativo / último respaldo confirmado | Inicializado, configurado, sin bloqueo/pendiente/error y éxito verificable, según soporte real del navegador | Mostrar estado actualizado sin incidencia urgente; diferenciar descarga manual de automático disponible | No mostrar |
| Drive requiere reautorización | `needsDriveReauth` real | Conservar su semántica específica sin introducir avisos locales en PRO | No mezclar el ciclo Drive con desbloqueo local |

Esta tabla es una decisión de diseño técnico propuesta. La prioridad definitiva y los estados de descarga/manual deberán fijarse en pruebas antes de cambiar el selector existente.

## Persistencia, lectura y resolución propuestas

- Preferencia local versionada por negocio/almacenamiento local vigente, actor y dispositivo/instalación. Identificador opaco mediante hash, sin licencia, PIN, token, username ni identificador de actor en texto claro. Reutilizar la autoridad canónica de Settings y del runtime tenant; no crear otra fuente de autoridad.
- Registrar por separado presentación/reconocimiento y lectura; no usar ninguno de ellos como evidencia de respaldo realizado. La preferencia no contiene el estado autoritativo del gestor.
- Conservar reconocimiento de la condición habitual a través de reinicios; no incorporar sessionId o generación efímera en la identidad persistente. Usar generación/handle solo para rechazar respuestas asíncronas obsoletas.
- Solo una entrada activa por contexto de respaldo. Cambiar severity o estado actualiza esa entrada. Busy, reconexión, rerender y reapertura del drawer no crean incidencias.
- Las preferencias no deciden si un respaldo se ejecuta. Cerrar el recordatorio jamás llama lock, clearSettings, ni desactiva cron.
- Considerar `postDowngradeCashAttention` como referencia de hash y fallback a memoria, conservando el ciclo de vida propio de respaldos. No reutilizar su frontera de downgrade.
- Almacenamiento bloqueado/corrupto: fallback seguro en memoria, sin impedir operaciones ni crear un bucle de banners. La persistencia entre cierres no puede garantizarse si el navegador impide guardar; documentar esa limitación.
- Limpieza parcial, reinstalación, storage event y cambios de tenant requieren pruebas explícitas; ninguna preferencia antigua debe producir un falso éxito ni aparecer durante un cambio de actor.
- Sin consultas nuevas ni suscripciones permanentes a Supabase para preferencias locales.
