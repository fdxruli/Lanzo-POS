# QA manual: subida reanudable a Google Drive

**Estado:** pendiente de ejecutar con una cuenta Google y un negocio de prueba autorizados. Los mocks, CI y Preview no sustituyen esta comprobación.

## Preparación

- Usar Vercel Preview, una cuenta Google de pruebas y un negocio aislado con permiso de administrador.
- Confirmar que el respaldo `.lzbk` cifrado pesa más de 5 MiB y anotar su nombre y tamaño local.
- Conectar Google Drive desde **Configuración > Respaldos**. No usar archivos comerciales reales.

## Recorrido en navegador de escritorio

1. Generar el respaldo desde **Configuración > Respaldos** y comenzar la subida.
2. Confirmar que la interfaz pasa por preparación, subida y verificación, y que el porcentaje avanza con bytes que Drive ya confirmó.
3. Mientras la subida está activa, interrumpir la conexión a Internet por un momento. Esperar a que el navegador indique que reanuda la subida y restaurar la conexión.
4. Confirmar que el porcentaje continúa desde los bytes aceptados por Drive, sin volver al inicio ni mostrar 100 % antes de finalizar la transferencia.
5. En Google Drive, confirmar un solo archivo con el nombre y tamaño esperados. Confirmar también que las copias anteriores y cualquier archivo de otro negocio siguen intactos.
6. Descargar manualmente ese archivo desde Drive. Usar el validador de respaldo existente con el PIN de prueba para revisar el formato y la lectura; detenerse antes de restaurar o modificar datos activos.
7. Si la interfaz indica que la verificación está pendiente o falló, no volver a subir automáticamente. Revisar Drive y conservar las copias anteriores.

## Recorrido en Android

Repetir los pasos 1–7 en Chrome Android y, por separado, en la PWA instalada. Comprobar que bloquear y recuperar la conexión no cierra la aplicación ni duplica el archivo.

## Caja

En el negocio de prueba, cerrar una caja con la subida a Drive habilitada. Interrumpir la conexión durante el respaldo y confirmar que el cierre financiero se completa una sola vez y presenta una advertencia si la transferencia o la verificación quedan pendientes.

Registrar navegador y versión, tamaño del archivo, duración de la interrupción, bytes/porcentaje observados, resultado de Drive y si quedó alguna limpieza pendiente. No eliminar copias reales durante la prueba.

## Límites que se deben conservar

La verificación remota confirma ID, nombre, aliases de negocio y tamaño. Si Drive devuelve `sha256Checksum`, el servicio lo compara con un SHA-256 calculado por flujo sobre el Blob, sin crear un `ArrayBuffer` del archivo completo. Si Drive no devuelve ese campo, la verificación conserva los controles de identidad y tamaño, pero no demuestra criptográficamente que todos los bytes remotos coincidan con los locales.

La guía oficial incluye ejemplos JavaScript que leen `Location` y `Range`; el preflight efectivo desde `https://lanzo-pos.vercel.app` aceptó los métodos y encabezados de solicitud usados. No se obtuvo aquí una respuesta de sesión válida con OAuth para observar la exposición de esos encabezados en Chrome. Confírmala durante el recorrido real antes de dar por aprobado el flujo comercial.

Referencia: [Google Drive API: Manage uploads](https://developers.google.com/drive/api/guides/manage-uploads).
