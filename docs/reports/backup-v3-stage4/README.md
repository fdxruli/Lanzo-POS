# Respaldos V3 · Etapa 4

PR Draft: https://github.com/fdxruli/Lanzo-POS/pull/532

Base inicial verificada: `7f32dd6b734d86895b5d9cb46d63f122bcba7298`.
Commit de implementación: `e0a4e6c190acb05ccbf5621fa06b47f49d8e5a90`.
Durante el trabajo main avanzó a `1fbe6fd615971a6906595c9c630a4a88d7346b30` (#531). Se verificó que no cambia estos componentes. El PR es combinable, sin merge realizado.

## Problemas corregidos y organización

Antes: el encabezado podía indicar «Cloud + local» sin respaldo configurado; fecha local ambigua; recuperación desde archivo dentro de la configuración local y listado Drive separado; resultados dependientes de avisos temporales; detalles consultivos antes de la acción de crear copia.

Después: estado verificable, crear/proteger y recuperar. El encabezado separa configuración, PIN, conexión Drive y fecha local. No hay fecha remota confirmada persistida fiable: se muestra «Sin información confirmada». El resultado de cada creación permanece en pantalla y distingue copia local, subida confirmada, verificación pendiente y limpieza pendiente. No es historial persistido.

La acción principal precede a los detalles de destino, permisos y recifrado. Drive y archivo local comparten el panel original de PIN, inspección y confirmación. Descargar no restaura; una inspección tampoco restaura. Se conservan las advertencias y requisitos de cobertura y copia preventiva. La escritura y la confirmación de restauración bloquean controles incompatibles; una consulta ordinaria permite crear una copia.

Free/Local conserva PIN y protección local como prioridad. Pro/Nube conserva la copia local opcional y aclara que sincronización Cloud y respaldo cifrado son mecanismos distintos; restaurar aquí no reconstruye todos los datos Cloud. No cambian licencias ni permisos de Staff.

## Alcance

Código: `BackupSettings.jsx`, `BackupSettings.css`, `GoogleDriveSettings.jsx` y `__tests__/BackupSettings.backupPro.test.jsx`, bajo `src/components/settings/`.

Esta carpeta contiene únicamente evidencia. No se modificaron motores, servicios, SQL, RLS, OAuth, cifrado, formato, retención ni infraestructura. Se reutilizan los controles de autorización, identidad del negocio, binding Drive, descarga cifrada, PIN, revisión, bloqueo financiero, copia preventiva, staging/transacción y revalidación existentes. No se encontró un defecto reproducible que requiriera modificar el motor.

## Validación ejecutada

```sh
VITE_GOOGLE_CLIENT_ID=synthetic-visual-only BACKUP_VISUAL_DIR=work/backup-stage4/after npx vitest run src/components/settings/__tests__/BackupSettings.backupPro.test.jsx src/components/settings/__tests__/GoogleDriveSettings.access.test.jsx src/services/backup/__tests__/backupRestore.test.js src/services/__test__/googleDriveService.test.js --maxWorkers=2
npx eslint src/components/settings/BackupSettings.jsx src/components/settings/GoogleDriveSettings.jsx src/components/settings/__tests__/BackupSettings.backupPro.test.jsx
npm run build
git diff --check
```

- Vitest: **4 archivos y 93 pruebas aprobadas**, 68.07 s. Incluye un exportador opcional de fixtures visuales. Los servicios y sesiones de los componentes están simulados; las pruebas de servicios verifican sus contratos sin una cuenta Google real.
- ESLint: salida vacía, código 0.
- Build y postbuild: código 0. Auditorías: 26 assets de arranque y 0 rutas Local centrales; 5 assets del bot y 23 dependencias estáticas. Advertencias de anotaciones PURE de zod y patrones PWA sin coincidencias; no se modificó su configuración.
- Chromium de sistema: **30 combinaciones** de 360/390/768/1024/1440 px × claro/oscuro × sin configurar/configurado/vista previa parcial. Sin desbordamiento horizontal ni botones visibles menores de 44 px en esas muestras. Se inspeccionaron capturas móviles y de escritorio.

| Estados solicitados | Evidencia automatizada |
| --- | --- |
| 1–4: sin configurar, desbloqueado, Drive desconectado y expirado | Componentes; expiración con temporizadores y bloqueo de consultas; frontera OAuth sin autorización |
| 5–8: local generado, remoto confirmado, pendiente y limpieza pendiente | Resultado local/Drive, progreso, errores y estados de subida con respuestas simuladas; contratos del servicio Drive |
| 9–12: vacío, varios archivos, nombre largo y descarga fallida | Componentes; listado, reintento y capturas con nombres largos |
| 13–15: archivo local, PIN incorrecto y cobertura parcial | Componentes; selección, inspección, advertencias e invalidación de revisión al cambiar PIN |
| 16–17: operaciones pendientes y copia preventiva | Controles bloqueados y advertencias; regresión de restauración |
| 18–19: confirmar, cancelar y acción repetida | Confirmación previa, una sola restauración, cancelación de consulta/descarga e ignorar resultados tardíos; bloqueo de creación repetida |
| 20–21: Staff y modalidades | Restauración ausente para Staff; frontera de acceso; textos Free/Local y Pro/Nube |
| 22: móvil sin desbordamiento | 30 comprobaciones de DOM/CSS real en Chromium controlado; resultados JSON adjuntos |

## Evidencia visual

Las capturas usan DOM de componentes reales y CSS del repositorio exportados desde Vitest; no son pantallas de un negocio real. Sesiones, archivos, fechas y respuestas son sintéticos. El estado inicial antes del cambio no tenía client ID OAuth en el fixture; la captura final usa un ID sintético y hook OAuth simulado para mostrar la conexión activa. Esto no verifica OAuth real. El pie de exportación existente se muestra como contexto y no se rediseñó.

- [Antes, móvil claro](antes-movil.png)
- [Después, móvil claro](despues-movil.png)
- [Vista previa parcial, escritorio oscuro](preview-escritorio.png)
- [Resultados de las 30 combinaciones](resultados-visuales.json)

## QA manual pendiente y Production

Pendiente recorrido real completo en Chrome Android, PWA Android y escritorio con negocio de prueba autorizado: configurar/desbloquear PIN, guardar archivo cifrado, OAuth real, subida/verificación/retención real, consultar y descargar desde Drive, revisar y confirmar restauración sobre un destino autorizado. Probar teclado, lector de pantalla y comportamiento físico del guardado/selección de archivos.

La evidencia controlada no acredita QA físico Android/PWA ni integración real con Drive. El QA integral real queda para el cierre del conjunto de etapas conforme a la decisión del propietario. Sin merge ni modificación de Production. El PR generó un preview Vercel mediante la integración existente.
