# QA manual — Local Backup Attention UX R1

Usar el Preview del PR (cuando esté disponible) con negocio sintético, o localhost en un perfil de navegador separado. Para localhost: instalar dependencias del lockfile con Node 24, ejecutar `npm run dev -- --host 127.0.0.1 --port 5187` y abrir la ruta POS. Abrir Configuración → Respaldos para configurar una carpeta desechable y un PIN exclusivo de prueba. No ejecutar restauraciones sobre negocios reales. Conservar la protección de acceso de Vercel.

En cada caso, sustituir «No ejecutado» por el resultado observado y añadir captura o evidencia solo después de ejecutar los pasos.

## Plan manual de QA

Todos los casos manuales están **BLOCKED / NO EJECUTADOS**. El propietario indicó «Continuar sin verificación visual». Las pruebas automatizadas se reportan por separado y no sustituyen estos resultados. Las precondiciones usan un negocio sintético en un perfil/origen local aislado o Preview; nunca datos financieros reales. La columna de resultado obtenido se incluye para no confundir el plan con certificación.

| Caso | Precondición | Pasos exactos | Resultado esperado | Obtenido / estado / evidencia |
| --- | --- | --- | --- | --- |
| QA-BACKUP-01 | Free, actor con sync, sin configuración ni preferencia | Abrir POS; esperar inicio del gestor | Recordatorio compacto único, sin PIN; productos accesibles | No ejecutado / BLOCKED / sin captura |
| QA-BACKUP-02 | Caso 01 visible | Pulsar Más tarde; abrir campana | Banner cerrado; condición consultable | No ejecutado / BLOCKED / sin captura |
| QA-BACKUP-03 | Caso 02 completado | Recargar POS | Mismo banner no reaparece | No ejecutado / BLOCKED / sin evidencia |
| QA-BACKUP-04 | Preferencia guardada | Cerrar navegador; reabrir y entrar con mismo actor/negocio | No reaparece la condición reconocida | No ejecutado / BLOCKED / sin evidencia |
| QA-BACKUP-05 | Respaldo configurado, nueva sesión bloqueada | Abrir campana; pulsar Desbloquear | Una entrada; navegación a tab=backup; PIN solo allí | No ejecutado / BLOCKED / sin evidencia |
| QA-BACKUP-06 | Configuración de prueba bloqueada | Introducir PIN válido y desbloquear | Gestor desbloqueado; estado actualizado; sin duplicados | No ejecutado / BLOCKED / sin evidencia |
| QA-BACKUP-07 | Configuración de prueba bloqueada | Introducir PIN inválido; después PIN válido | Error controlado; configuración y datos intactos | No ejecutado / BLOCKED / sin evidencia |
| QA-BACKUP-08 | Configurado en navegador compatible | Revocar autorización de carpeta de prueba; intentar automático | Permiso requerido/pendiente real, sin falso éxito | No ejecutado / BLOCKED / sin evidencia |
| QA-BACKUP-09 | Caso 08 | Desde Configuración, autorizar carpeta y generar respaldo | Estado actualizado tras confirmación real | No ejecutado / BLOCKED / sin evidencia |
| QA-BACKUP-10 | Adaptador aislado de escritura fallida | Producir fallo controlado de escritura; abrir/cerrar drawer | Un error activo; leer no resuelve ni crea alertas nuevas | No ejecutado / BLOCKED / sin evidencia |
| QA-BACKUP-11 | Error previo corregido en entorno sintético | Ejecutar respaldo exitoso; abrir campana | Error resuelto por gestor, no por preferencia | No ejecutado / BLOCKED / sin evidencia |
| QA-BACKUP-12 | Aviso reconocido; hay cambios sintéticos | Avanzar reloj controlado cuatro horas; inspeccionar invocación y archivo | Automático sigue funcionando sin banner visible | No ejecutado / BLOCKED / sin evidencia |
| QA-BACKUP-13 | Archivo cifrado sintético y negocio desechable | Generar manual; restaurar únicamente en negocio de prueba | PIN/backup preventivo/tenant guard conservados | No ejecutado / BLOCKED / sin evidencia |
| QA-BACKUP-14 | Alertas sintéticas de inventario, cajas y respaldo | Abrir campana; leer respaldo; navegar; reabrir | Inventario conserva activos; cajas suman un grupo; respaldo máximo uno | No ejecutado / BLOCKED / sin evidencia |
| QA-BACKUP-15 | Staff con inventario sin sync; luego Staff sync sin inventario | Entrar con cada actor; revisar campana y acciones | Sin ampliar permisos; respaldo independiente de inventario | No ejecutado / BLOCKED / sin evidencia |
| QA-BACKUP-16 | Dos negocios y dos actores sintéticos | Reconocer aviso en A; cambiar a B; volver a A; alternar actor | Sin herencia indebida, estados viejos ni escrituras tardías | No ejecutado / BLOCKED / sin evidencia |
| QA-BACKUP-17 | Segundo perfil/dispositivo de prueba | Abrir mismo negocio en otro almacenamiento; después limpiar solo preferencias o solo configuración | Aislamiento y ausencia de falso éxito; recuperación coherente | No ejecutado / BLOCKED / sin evidencia |
| QA-BACKUP-18 | Almacenamiento interceptado en entorno aislado | Denegar lecturas/escrituras; introducir preferencia corrupta; cerrar aviso | App funcional; fallback controlado; sin tormenta de avisos | No ejecutado / BLOCKED / sin evidencia |
| QA-BACKUP-19 | Free preparado offline; Preview/PWA de prueba | Desconectar; navegar POS/campana/Configuración; restaurar pestaña y actualizar PWA | Rutas locales útiles; preferencia coherente; sin dependencia nueva cloud | No ejecutado / BLOCKED / sin evidencia |
| QA-BACKUP-20 | Free y PRO sintéticos | Cambiar licencia Free/PRO; revisar campanas y copia local opcional | Local Free sin funciones cloud; PRO sin aviso local forzado | No ejecutado / BLOCKED / sin evidencia |
| QA-BACKUP-21 | Datos sintéticos y alertas activas | Recorrer 320×568, 360×640, 375×667, 390×844, 412×915, 768×1024, 1024×768, 1280×800, 1440×900; repetir claro/oscuro y horizontal | Sin scroll horizontal, recorte de acciones ni choque con navegación; controles táctiles adecuados | No ejecutado / BLOCKED / sin captura |
| QA-BACKUP-22 | Drawer abierto | Recorrer Tab/Shift+Tab; pulsar Escape; abrir otra vez y cerrar | Foco contenido y restaurado; cierre funcional; nombres accesibles | No ejecutado / BLOCKED / sin evidencia |
| QA-BACKUP-23 | Móvil físico en Configuración → Respaldos | Abrir teclado virtual; escribir PIN de prueba; cerrar teclado | Campos y acciones visibles y desplazables, safe-area respetada | No ejecutado / BLOCKED / sin evidencia |
| QA-BACKUP-24 | Niveles de riesgo sintéticos 1/2/3, transacción simulada | Revisar avisos por volumen y alerta de almacenamiento crítico | Umbrales intactos; recordatorio rutinario no elimina protecciones críticas | No ejecutado / BLOCKED / sin evidencia |
| QA-BACKUP-25 | Menús móvil/desktop y ruta desconocida | Revisar acciones; navegar a Configuración y 404; revisar recuperación disponible en main | Sin acción redundante de reabrir banner; actualización/instalación/acceso a respaldos conservados | No ejecutado / BLOCKED / sin evidencia |
