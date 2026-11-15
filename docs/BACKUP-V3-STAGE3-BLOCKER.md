# Respaldos V3, etapa 3: portabilidad del motor V2

## Estado actualizado: corrección focalizada

La autorización posterior permite corregir los dos bloqueos documentados abajo dentro del mismo PR #527. La evidencia inicial se conserva como historial; ya no describe el comportamiento del flujo V2 autorizado. La prueba original de rechazo continúa vigente para consumidores sin autorización portable: cambiar un nombre de origen o pasar un booleano no autoriza la importación.

### Regla concreta

El worker descifra con el PIN original y autentica AES-GCM antes de usar el fingerprint. `backupRestoreIdentity.js` acepta exclusivamente alias canónicos del contexto autorizado, con máximo un `license-id` no vacío y un `license-key-sha256` hexadecimal de 64 caracteres. Rechaza tipos desconocidos, múltiples identidades del mismo tipo y contradicciones con el binding local. Compara el fingerprint autenticado con el conjunto actual y, cuando hay dos tipos, con cada singleton histórico: máximo tres candidatos. No incorpora alias declarados por el archivo ni intenta adivinar alias ausentes.

Una copia que se creó con ambos alias no puede recuperarse si el destino solo conoce uno y no puede reconstruir el conjunto original. Se rechaza; la alternativa segura es que el flujo de activación existente reconozca todos los alias originales verificados. No se cambia aquí la autoridad de licencia ni se promete que todos los históricos sean recuperables.

V2 exige nombres físicos de origen y destino con la estructura existente `LanzoDB_t_t_<32 hex>`, pero permite que sean diferentes después de verificar la identidad comercial. El permiso interno es opaco, vive en un WeakMap y se vincula al Blob descifrado inmutable y ambos nombres. El importador exige también la revalidación del worker y que el destino sea la base realmente abierta. Conserva staging, whitelist y transacción; no abre ni renombra la base de origen y no modifica el archivo. V1 conserva la igualdad física y su identidad anterior, incluso en un contenedor recifrado V2 de archivo V1.

Inspección y restauración comparten validación de identidad, nombre y manifiesto de cobertura. Restaurar descifra y valida otra vez; la vista previa no es un permiso del worker. El manager vincula cada vista previa al File/Blob y al actor/contexto que la inspeccionaron; un archivo distinto, una vista previa ajena o un actor revocado exige una nueva revisión. No conserva el PIN en ese vínculo.

El worker consulta al manager la autoridad de actor administrador, sesión y tenant vigente al iniciar la operación, antes de escribir y antes de terminar la transacción. La respuesta se vincula a la operación pendiente; timeout o revocación fallan cerrados. `Dexie.waitFor` mantiene la transacción mientras se valida. Revalida también binding y fingerprint dentro de la transacción; comprueba pendientes y que un destino antes vacío no haya adquirido datos durante staging. Una revocación durante escritura provoca rollback. La copia preventiva permanece a cargo del manager y su fallo impide invocar la restauración.

### Evidencia automatizada de la corrección

`backup.portability.test.js` ejecuta los comandos reales del worker con Dexie, el esquema canónico e IndexedDB sintética; no sustituye cifrado, exportación, inspección ni importación. El transporte del worker y las respuestas de autoridad se simulan en proceso, sin certificar un Web Worker de navegador real.

- A genera V2; se elimina su base física antes de crear B. B inspecciona y recupera catálogo, lotes, clientes, ventas, ledger, caja cerrada, movimientos y folios con el PIN original; compara registros y referencias. Se comprueba que no reaparece la base A ni quedan bases de staging.
- Se prueban alias iguales, enriquecimiento desde cada tipo de singleton y compatibilidad con el mismo nombre físico. Se conservan las tablas excluidas del destino y no se importan credenciales, binding ni colas del origen. Caja mantiene la sanitización existente.
- Se rechazan negocio ajeno aun con PIN conocido, fingerprint ajeno autenticado, fingerprint alterado, alias desconocidos/ambiguos/contradictorios, conjunto histórico no reconstruible, nombre físico inválido, PIN erróneo, ciphertext dañado y manifiesto de cobertura incompatible.
- Se verifican pendientes financieros, revocación antes de escribir y antes del commit, fallo de importación a staging con limpieza y destino intacto, copia preventiva obligatoria/fallida en manager, y rollback transaccional con las pruebas existentes.
- Se conserva recuperación V1 en la misma base y rechazo V1 entre bases diferentes. No se amplía su cobertura.

La interfaz y descarga Google Drive quedan fuera de esta corrección. La guía de QA integral más abajo sigue pendiente del propietario. Production sigue sin cambios.

### Resultados actuales

- `npx vitest run src/workers/__tests__/backup.portability.test.js src/services/backup/__tests__/backupRestore.test.js src/services/backup/__tests__/backupFormat.test.js src/services/backup/__tests__/backupManager.session.test.js src/services/backup/__tests__/backupScope.test.js src/services/db/__tests__/tenantRuntimeRouter.test.js src/services/__test__/googleDriveService.test.js --maxWorkers=2`: **7 archivos, 128 pruebas aprobadas**. Incluye regresiones de exportación, caja, tenant, V1, staging, rollback y manager.
- `npx eslint` sobre `backupRestoreIdentity.js`, `backupRestore.js`, `backupManager.js`, `backup.worker.js`, `backup.portability.test.js` y `backupManager.session.test.js`: **aprobado, sin diagnósticos**. La prueba de reproducción original no cambió en esta corrección y ya había aprobado ESLint.
- `npm run build`: **aprobado**, incluidos los auditores `admin-startup-precache-audit` y `audit-bot-precache`. Advertencias de tamaño de bundle y anotaciones de dependencias no bloqueantes; no se alteran esas dependencias para silenciarlas.
- `git diff --check`: **aprobado**.
- El lint global de la revisión inicial (162 errores y 162 advertencias en archivos ajenos) se conserva abajo como evidencia histórica, no como resultado del ESLint focalizado actual. No se declara CI remoto verde a partir de checks locales; consultar el HEAD actualizado del PR.
- QA manual en Chrome Android, PWA Android y escritorio: **pendiente**. El transporte simulado del worker no certifica comportamiento en dispositivos reales ni descarga desde Drive.

Base verificada: `c67651f084def72d8cb55e87cfb6b6fee5ceb4a0` (main, PR #526).
No se implementa listado nuevo, descarga ni interfaz de recuperación: aplica la regla de parada del encargo.

## Evidencia inicial del bloqueo (antes de la corrección)

- `tenantRuntimeRouter.js`, `createOpaqueId`: asigna un UUID aleatorio al negocio local. En dispositivos limpios A y B, la misma licencia no garantiza el mismo nombre físico `LanzoDB_t_t_<uuid>`.
- `backup.worker.js`, `inspectBackup`: exige `archive.metadata.data.databaseName === context.databaseName`; de lo contrario produce `BACKUP_DATABASE_MISMATCH` después de descifrar y validar tenant.
- `backupRestore.js`, `restoreWhitelistedDatabase`: repite la comparación contra el nombre del destino antes de escribir. `acceptNameDiff: true` en la importación a staging no elimina esta guarda previa.
- La prueba añadida genera un archivo sintético V2 con nombre físico A y destino B. Verifica el rechazo y que catálogo y caja del destino no cambian. Prueba la barrera de importación, no una sesión OAuth ni el worker completo.
- Además, `validateBackupTenant` en el worker compara el fingerprint V2 de **todo** el conjunto de alias. `createTenantFingerprint` cambia si se enriquecen los alias; los hashes de alias de Drive permiten localizar una copia, pero no cambian esa regla del motor. Es un segundo caso a resolver explícitamente, sin relajar la identidad.

## Google Drive

La documentación de [scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) permite con `drive.file` archivos creados por la aplicación o compartidos con ella. La de [descargas](https://developers.google.com/workspace/drive/api/guides/manage-downloads) establece `files.get` con `alt=media` para binarios y la comprobación de `capabilities.canDownload`.

Conceptualmente una sesión nueva de la misma aplicación y cuenta puede acceder a los archivos creados por esa aplicación; el permiso no se vincula al dispositivo. Debe mantenerse la misma identidad de aplicación Google y la asociación tenant existente. No se ha ejecutado OAuth real A/B y no se certifica esa precondición. No se amplían scopes ni se consulta información de clientes.

## Opciones y costo identificados antes de la autorización de corrección

1. Corregir primero la portabilidad en el motor V2 existente: separar identidad comercial verificada del nombre físico local, validar origen y destino, y permitir la importación al destino solo después de establecer identidad inequívoca. Revisar también la variación legítima de alias. Requiere una decisión explícita sobre prueba de identidad para archivos existentes cuyo encabezado solo conserva un fingerprint; no basta con quitar comparaciones. Costo acotado pero mayor que un cambio en Drive: worker, validación de archivo y pruebas de aislamiento, alias, staging, rollback y copia preventiva. No se implementa en este PR ni se propone un formato nuevo sin autorización.
2. Reducir alcance a recuperación sobre la misma base física: no cumple el objetivo de dispositivo nuevo.
3. Posponer etapa 3 hasta resolver portabilidad: recomendación actual. La importación manual existente permanece, pero también está sujeta a las guardas del motor; no se promete como solución A/B.

## QA integral pendiente para el propietario

Ejecutar después de corregir el bloqueo y terminar las etapas, únicamente con negocios sintéticos y destinos descartables:

1. En A crear productos, categorías, lotes, clientes, ventas, abonos y una caja cerrada; registrar conteos y relaciones.
2. Crear y subir una copia cifrada con PIN conocido.
3. En B limpio activar la misma licencia y conectar la misma cuenta con la misma aplicación OAuth y `drive.file`.
4. Localizar la copia de A; comprobar exclusión de otro negocio y de legacy ambiguos.
5. Descargar, inspeccionar con el PIN original y revisar versión, fecha, cobertura, conteos, pendientes y riesgo del destino.
6. Confirmar restauración; comparar todos los datos, lotes, vínculos financieros, folios y ausencia de duplicados.
7. Repetir negativos: PIN incorrecto, otro negocio, archivo alterado/eliminado, token vencido, descarga interrumpida y cambio de sesión/licencia.
8. Verificar bloqueo por pendientes, copia preventiva obligatoria con datos existentes y ausencia de cambios cuando falla. Probar doble clic e importación manual.
9. Repetir en Chrome Android, PWA Android instalada y escritorio.

QA manual: pendiente, sin certificación. Production: sin cambios. No merge ni despliegue.

## Validación automatizada inicial del Draft

- Tras `npm ci --ignore-scripts` (el entorno inicial no contenía `@noble/hashes`), `npx vitest run src/services/__test__/googleDriveService.test.js src/services/backup/__tests__/backupRestore.test.js src/services/backup/__tests__/backupFormat.test.js src/services/backup/__tests__/backupManager.session.test.js --maxWorkers=2`: **4 archivos, 61 pruebas aprobadas**.
- `npm run build`: aprobado, incluidos los dos auditores de postbuild.
- `npm run lint`: **162 errores y 162 advertencias**, en archivos no modificados por este Draft. No se amplía alcance para corregirlos.
- ESLint del único archivo JavaScript modificado: aprobado.
- `git diff --check`: aprobado.
- GitHub Actions: comprobar en el PR; los resultados locales no certifican los checks remotos.
