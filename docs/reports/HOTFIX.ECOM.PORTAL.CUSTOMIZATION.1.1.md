# HOTFIX ECOM.PORTAL.CUSTOMIZATION.1.1

## Resumen

Corrige la persistencia de logo y portada mediante intenciones explícitas (`preserve`, `set`, `clear`), elimina `window.alert` del panel y corrige la actualización de `slug_source` en la RPC administrativa. No incorpora el constructor visual futuro.

## Causa raíz

`EcommercePortalCustomizationPanel` expresaba una desvinculación con `logoUrl = null`, pero `EcommercePortalSettings` construía el payload con `customization.logoUrl ?? publicUrl(candidate.logoUrl)`. El operador `??` trataba el `null` explícito como ausencia y restauraba el valor anterior o el logo del perfil.

## Git

- HEAD inicial remoto `main`: `ddf1cd24990928e14486c594f1f38d8232f54024`.
- Rama: `hotfix-ecom-portal-customization-1-1`, creada exclusivamente desde `origin/main`.
- Merge-base: `ddf1cd24990928e14486c594f1f38d8232f54024`.
- HEAD final y PR: se actualizan al crear el commit y el PR draft.
- PR #121: confirmado `MERGED`, con merge commit igual al HEAD inicial.

## Modelo de intención

Cada imagen ahora es `{ value, intent }`:

- `preserve`: en un portal existente se omite la propiedad del payload.
- `set`: se envía exclusivamente una URL pública HTTPS.
- `clear`: se envía explícitamente `null`.

Un portal nuevo puede recibir el logo HTTPS válido del perfil como valor inicial si el control no fue tocado. Nunca se modifica el logo general del perfil. `Restablecer` restablece plantilla/tema y marca solo la portada para eliminar; no borra objetos de Storage ni desvincula el logo.

Al fallar un upload se restaura valor e intención previos, se revoca el Object URL temporal y se muestra un toast no bloqueante. El upload anterior al guardado puede dejar un objeto huérfano si la edición se abandona; no se borra automáticamente sin una política autoritativa.

## Migración

`20260719150457_ecom_portal_customization_image_intent_and_slug_source_fix.sql`:

- mantiene las migraciones históricas inmutables;
- conserva autorización v2, rate limits, `SECURITY DEFINER`, `search_path = ''` y grants mínimos;
- conserva campo JSON ausente frente a `null` para imágenes;
- marca `slug_source = custom` únicamente cuando PRO cambia realmente el slug;
- conserva `slug_source` al reenviar el mismo slug o al omitirlo;
- conserva Free como `system` y rechaza cambios no permitidos;
- hace que la sobrecarga legacy sin sesión staff delegue a la implementación canónica con sesión `null`.

La migración anterior `20260719070213_ecom_portal_pro_customization_hardening` está aplicada en producción `odlrhijtfyavryeqivaa`. Esta migración nueva queda pendiente de merge y despliegue por el flujo normal del repositorio; no se aplicó directamente a producción.

## Pruebas y validaciones

- PASS: panel de personalización, 6 casos focalizados.
- PASS: integración de settings, 11 casos focalizados.
- PASS: `ecommerceAdminService` y tema del portal en ejecución focalizada.
- PASS: lint focalizado de los archivos React modificados.
- PASS: `npm run build`.
- PASS: `npm run build:store`.
- NO CONCLUYENTE: `npm run lint` global excedió 2 minutos sin salida.
- NO CONCLUYENTE: `npm run test:ci` excedió 10 minutos; el proceso terminó por timeout/EPIPE. La ejecución focalizada de `PublicStorePage` además reveló dos fallos existentes/ajenos: un timeout y una expectativa obsoleta de nombre accesible (`Agregar Alitas BBQ` frente a `Agregar: Alitas BBQ`).
- NO CONCLUYENTE: prueba SQL transaccional real: el workspace no está enlazado a una base local y la nueva migración no se aplica a producción antes del merge. Se agregó el script SQL transaccional de contrato para la ejecución posterior a la migración.
- PASS: `git diff --check`.

Los asesores de seguridad y rendimiento de Supabase se consultaron. Devuelven avisos informativos preexistentes (RLS sin policy en tablas `private` e índices sin uso); no se introdujo un aviso atribuible a este hotfix.

## Matriz manual pendiente de entorno integrado

- PRO: desvincular/subir logo y portada, guardar, recargar y comprobar la tienda pública.
- Portal nuevo: confirmar herencia del logo del perfil y desvinculación posterior sin cambiar el perfil.
- PRO: cambiar slug, guardar dos veces y comprobar que conserva `slug_source = custom`.
- Free: confirmar plantilla clásica, slug no editable y ausencia de portada avanzada.
- Offline: upload muestra toast, conserva la imagen anterior y nunca envía `blob:`.

## Alcance confirmado

No se modificaron catálogo, sincronización PRO, inventario, pedidos, caja, ventas, `catalogRevision`, ni la importación dinámica de `buildPosSyncAuthContext` incorporada por PR #120. No hubo merge automático, deployment manual de Vercel ni implementación de ECOM.PORTAL.BUILDER.
