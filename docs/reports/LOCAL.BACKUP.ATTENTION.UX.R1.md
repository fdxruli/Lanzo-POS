# LANZO-POS — Local Backup Attention UX R1

El POS deja de pedir el PIN en un banner recurrente. Presenta un aviso compacto inicial y conserva los estados de respaldo en la campana local existente. El PIN, la autorización de carpeta y la resolución del problema se atienden en Configuración → Respaldos.

## Comportamiento implementado

- Una presentación o reconocimiento inicial por contexto de negocio/instalación, actor y dispositivo. El bloqueo normal de una nueva sesión, cambios de gravedad, navegación y rerenders no reinician esa presentación.
- Preferencia local versionada con presentedAt, readStates, errorReadAt y postponedAt. La clave combina el namespace físico del tenant, actor y dispositivo mediante SHA-256; no persiste licencias, PIN, tokens ni identidades en claro. Si falta hashing, usa una clave opaca solo en memoria. Si storage falla, conserva la decisión en memoria. Esa modalidad no garantiza persistencia después de cerrar el navegador.
- Lectura separada de resolución: marcar leída mantiene la incidencia activa. Solo el estado real del gestor decide error, permiso, bloqueo, pendiente o disponibilidad. Un respaldo sin copia confirmada no se muestra como éxito. Navegadores sin API de carpeta reciben instrucciones de descarga manual.
- Un éxito confirmado reinicia exclusivamente la lectura del error anterior. La fecha del último éxito frente a errorReadAt permite reconocer un error nuevo incluso si la recuperación ocurrió con este actor ausente. Se conserva presentedAt y la lectura del bloqueo habitual de PIN: no se reactiva el banner ni se crean duplicados.
- Una incidencia de respaldo como máximo en el contador de activos local, junto al inventario y el grupo de cajas pendientes. Los contadores unread/unseen cloud no cambian.
- La pestaña de respaldos exige sync según la autoridad existente de Settings, independientemente de products/inventory. El handle de Settings se revalida tras generar la clave y antes de actualizar la preferencia o navegar. Los resultados asíncronos de otro actor/generación se descartan.
- Sin un segundo centro de notificaciones. El drawer existente incorpora Protección de datos / Respaldos, conserva Escape/Tab/restauración de foco y permite desplazar sus secciones en ventanas bajas. Su callback de cierre es estable para conservar foco al leer una alerta.
- Se retiraron las acciones móvil y desktop que únicamente reabrían el banner, así como su estado en sessionStorage y estilos obsoletos. Configuración, instalación, actualización e indicadores de riesgo continúan disponibles.

## Protección de datos y alcance

BackupRuntime sigue montado con su inicialización y temporizador de cuatro horas, aunque su interfaz devuelva null. No se modificaron backupManager, backupConfigDb, Workers, cifrado, restauración, umbrales de BackupRiskEvaluator, BackupReminder, App, Layout, main, ventas, inventario, caja, licencias ni el sistema de recuperación. PRO conserva su centro cloud y copia local opcional; la suscripción nueva no inicializa el gestor local en modo cloud. No hay consultas nuevas a Supabase, migraciones o cambios de producción.

La configuración criptográfica sigue siendo la configuración local existente del gestor; esta mejora no migra ni redefine su almacenamiento. La preferencia de atención no contiene ni suplanta su estado autoritativo.

## Auditoría y compatibilidad

Base fijada: bca323cddebac97678f6b388d7abbdf7d3cfc730. Rama: feat/local-backup-attention-ux-r1.

La [auditoría previa](LOCAL.BACKUP.ATTENTION.UX.R1.AUDIT.md) documenta la matriz antes de editar, los tres PR abiertos y las simulaciones merge-tree: #357 entra en conflicto en PostDowngradeRecoveryBanner; #338 en App, un workflow y validaciones de licencia; #352 depende de #338. No se incorporó código de esos PR. Los archivos elegidos de respaldos/campana no tenían intersección directa con sus listas de cambios. La revalidación final y los SHAs se registran en la descripción del PR.

## Validación y límites

Los resultados definitivos, HEAD y enlaces de CI se registran en la descripción del PR, evitando que el propio informe deba contener el SHA del commit que lo incluye. No se atribuyen al HEAD final resultados de un commit anterior.

Confirmado durante desarrollo: selector nuevo 9/9; persistencia 8/8; runtime 13/13 (incluye temporizador tras cierre, actores, Staff sync sin inventario, generaciones y clics obsoletos); lint focal de aplicación y pruebas 0 errores/advertencias. Los cambios posteriores requieren la suite focal final indicada en el PR.

El build de producción con service worker y postbuild completó exit 0: 21 assets de arranque verificados. Conserva advertencias de chunks/importaciones y patrones de precache sin coincidencia; no se modificó su configuración para ocultarlas. La validación final del candidato y los gates se registran por separado.

La regresión amplia encontró fallos de base: rollback en backupRestore (reproducido con la misma assertion en main), ausencia de localStorage en la suite existente de BackupRiskEvaluator (también reproducida en main), y una API IndexedDB ausente en backupConfigDb, que requiere comparación completa antes de atribución definitiva. No se cambiaron esas pruebas o servicios para conseguir verde. La suite global no se declara libre de fallos.

La instalación local con npm ci se interrumpió por demora del entorno. Se comprobó igualdad byte a byte del package-lock.json y se reutilizaron las dependencias ya instaladas de la copia original mediante junctions para candidato y baseline; el lockfile y paquetes no se modificaron. El runner forks se quedó esperando en este host; las pruebas locales se ejecutan con pool threads, sin aumentar timeouts ni modificar assertions. Se conserva el contrato original en CI.

**QA visual/responsive, teclado virtual y QA manual: NO EJECUTADOS**, por indicación explícita del propietario: «Continuar sin verificación visual». Las pruebas DOM no certifican contraste, dispositivos físicos, safe-area ni la matriz de resoluciones.

El [plan QA-BACKUP-01 a QA-BACKUP-25](LOCAL.BACKUP.ATTENTION.UX.R1.QA.md) contiene precondiciones, pasos, resultados esperados y campos de resultado/evidencia. Todas las casillas manuales siguen pendientes. Utilizar únicamente negocios sintéticos y carpetas desechables.

MERGE_STATUS: NOT_MERGED. Publicación únicamente como Draft; aprobación visual y funcional del propietario pendiente.
