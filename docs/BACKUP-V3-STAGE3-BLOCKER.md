# Respaldos V3, etapa 3: bloqueada antes de implementar la interfaz

Base verificada: `c67651f084def72d8cb55e87cfb6b6fee5ceb4a0` (main, PR #526).
No se implementa listado nuevo, descarga ni interfaz de recuperación: aplica la regla de parada del encargo.

## Evidencia

- `tenantRuntimeRouter.js`, `createOpaqueId`: asigna un UUID aleatorio al negocio local. En dispositivos limpios A y B, la misma licencia no garantiza el mismo nombre físico `LanzoDB_t_t_<uuid>`.
- `backup.worker.js`, `inspectBackup`: exige `archive.metadata.data.databaseName === context.databaseName`; de lo contrario produce `BACKUP_DATABASE_MISMATCH` después de descifrar y validar tenant.
- `backupRestore.js`, `restoreWhitelistedDatabase`: repite la comparación contra el nombre del destino antes de escribir. `acceptNameDiff: true` en la importación a staging no elimina esta guarda previa.
- La prueba añadida genera un archivo sintético V2 con nombre físico A y destino B. Verifica el rechazo y que catálogo y caja del destino no cambian. Prueba la barrera de importación, no una sesión OAuth ni el worker completo.
- Además, `validateBackupTenant` en el worker compara el fingerprint V2 de **todo** el conjunto de alias. `createTenantFingerprint` cambia si se enriquecen los alias; los hashes de alias de Drive permiten localizar una copia, pero no cambian esa regla del motor. Es un segundo caso a resolver explícitamente, sin relajar la identidad.

## Google Drive

La documentación de [scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) permite con `drive.file` archivos creados por la aplicación o compartidos con ella. La de [descargas](https://developers.google.com/workspace/drive/api/guides/manage-downloads) establece `files.get` con `alt=media` para binarios y la comprobación de `capabilities.canDownload`.

Conceptualmente una sesión nueva de la misma aplicación y cuenta puede acceder a los archivos creados por esa aplicación; el permiso no se vincula al dispositivo. Debe mantenerse la misma identidad de aplicación Google y la asociación tenant existente. No se ha ejecutado OAuth real A/B y no se certifica esa precondición. No se amplían scopes ni se consulta información de clientes.

## Opciones y costo

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

## Validación automatizada

- Tras `npm ci --ignore-scripts` (el entorno inicial no contenía `@noble/hashes`), `npx vitest run src/services/__test__/googleDriveService.test.js src/services/backup/__tests__/backupRestore.test.js src/services/backup/__tests__/backupFormat.test.js src/services/backup/__tests__/backupManager.session.test.js --maxWorkers=2`: **4 archivos, 61 pruebas aprobadas**.
- `npm run build`: aprobado, incluidos los dos auditores de postbuild.
- `npm run lint`: **162 errores y 162 advertencias**, en archivos no modificados por este Draft. No se amplía alcance para corregirlos.
- ESLint del único archivo JavaScript modificado: aprobado.
- `git diff --check`: aprobado.
- GitHub Actions: comprobar en el PR; los resultados locales no certifican los checks remotos.
