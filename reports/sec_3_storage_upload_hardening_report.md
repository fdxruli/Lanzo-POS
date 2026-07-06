# FASE SEC.3 — Hardening de Storage / Uploads del bucket `images`

## 1. Estado previo

Revisión directa en Supabase producción `odlrhijtfyavryeqivaa` antes del cambio:

- Bucket revisado: `images`.
- Objetos existentes: `3`.
- Todos los objetos existentes están bajo `public_uploads/`.
- No hay objetos fuera de `public_uploads/`.
- Rutas legacy observadas: `public_uploads/logo-*.webp`.
- Existía lectura pública para `images/public_uploads/%`.
- Existía escritura pública directa para `images/public_uploads/%` con validación básica de extensión y mimetype.

Riesgo principal: cualquier cliente con anon key podía intentar escribir rutas nuevas bajo `public_uploads/%` si cumplía controles básicos. La ruta final seguía bajo control del cliente.

## 2. Usos Storage encontrados en frontend

Términos auditados: `supabase.storage`, `storage.from`, `images`, `public_uploads`, `upload`, `remove`, `getPublicUrl`, `createSignedUrl`, `logo`, `avatar`, `product image`, `business image`.

Uso confirmado en `main`:

| Archivo | Uso previo | Cambio SEC.3 |
| --- | --- | --- |
| `src/services/supabase.js` | `uploadFile(file, type)` subía directo a `storage.from('images').upload(...)` con ruta `public_uploads/{type}-{timestamp}-{random}.{ext}`. | El flujo activo de perfil deja de usarlo. |
| `src/store/slices/createProfileSlice.js` | Setup y actualización de perfil llamaban `uploadFile(..., 'logo')`. | Ahora usan `uploadImageFile(...)` con purpose `business-logo`. |
| `src/services/storage/imageUploadService.js` | No existía. | Servicio centralizado para autorización, upload firmado y URL pública. |

## 3. Riesgos cerrados

- Escrituras directas amplias sobre `images/public_uploads/%`.
- Rutas elegidas libremente por cliente.
- Traversal, doble slash, separadores manuales, `%2f`, `%5c`, `%00`, espacios y caracteres de control.
- Extensiones peligrosas como `svg`, `html`, `js`, `json`, `pdf`, `exe`, `php`, `sql`, `xml`, `heic`, `avif`.
- Mimetypes peligrosos como `image/svg+xml`, `text/html`, `application/javascript`, `application/json`, `application/pdf`, `application/octet-stream`.
- Sobrescritura por nombres generados en cliente con timestamp/random.
- Falta de auditoría mínima de autorizaciones de upload.
- Dispositivo staff sin sesión staff activa intentando autorizar uploads.

## 4. Contrato nuevo de rutas

Los uploads nuevos se generan server-side con este contrato:

```txt
public_uploads/{license_hash}/{purpose}/{uuid}.{ext}
```

Reglas:

- `license_hash` es SHA-256 estable de la licencia, no la licencia en texto plano.
- `purpose` debe estar en allowlist.
- `uuid` se genera server-side.
- `ext` se normaliza en minúsculas.
- El frontend no decide la ruta final.

## 5. Purposes permitidos

```txt
business-logo
business-cover
product-image
category-image
restaurant-item-image
profile-image
misc
```

Alias frontend documentados:

- `logo` → `business-logo`
- `product` → `product-image`
- `category` → `category-image`
- `restaurant` → `restaurant-item-image`
- `avatar` / `profile` → `profile-image`

## 6. Extensiones y mimetypes permitidos

Extensiones:

```txt
jpg
jpeg
png
webp
gif
```

Mimetypes:

```txt
image/jpeg
image/png
image/webp
image/gif
```

También se valida coherencia entre extensión y mimetype.

## 7. Tamaños máximos

| Purpose | Límite |
| --- | ---: |
| `business-logo` | 2 MB |
| `business-cover` | 5 MB |
| `product-image` | 4 MB |
| `category-image` | 4 MB |
| `restaurant-item-image` | 4 MB |
| `profile-image` | 2 MB |
| `misc` | 4 MB |

La validación se aplica en frontend para UX y en Edge Function como control autoritativo.

## 8. Migración SQL

Archivo:

```txt
supabase/migrations/20260708000000_sec_3_storage_upload_hardening.sql
```

Incluye:

- Tabla `public.storage_upload_audit` con RLS habilitado.
- Acceso cerrado a `anon` y `authenticated`.
- Escritura reservada para runtime server-side.
- Hashes SHA-256 para identificadores sensibles.
- Helpers internos `private.sec3_storage_image_*` cerrados a roles cliente.
- Eliminación de policies previas relacionadas con `images` / `public_uploads`.
- Nueva policy pública solo de lectura para `images/public_uploads/%`.
- Sin policies públicas de `INSERT`, `UPDATE` o `DELETE` sobre `images`.
- `NOTIFY pgrst, 'reload schema';`.

## 9. Edge Function

Archivo:

```txt
supabase/functions/authorize-image-upload/index.ts
```

Responsabilidades:

1. Validar licencia, dispositivo y sesión staff cuando aplique.
2. Aplicar rate limit `STORAGE_UPLOAD`: 30 uploads / 10 min, bloqueo 15 min.
3. Validar purpose, extensión, mimetype, tamaño y filename.
4. Generar path canónico server-side.
5. Crear signed upload URL para `images`.
6. Registrar auditoría sin datos sensibles planos.
7. Devolver `bucket`, `path`, `token`, `public_url_path`, `max_size_bytes`, `mime_type`.

## 10. Frontend

Archivo:

```txt
src/services/storage/imageUploadService.js
```

Responsabilidades:

- Centralizar uploads de imágenes.
- Validar localmente tipo y tamaño.
- Solicitar autorización server-side.
- Subir con `uploadToSignedUrl(...)`.
- Generar URL pública con `getPublicUrl(...)`.
- Devolver errores amigables.

Errores implementados:

| Código | Mensaje |
| --- | --- |
| `STORAGE_UPLOAD_RATE_LIMITED` | Demasiados intentos al subir imágenes. Espera unos minutos e intenta de nuevo. |
| `INVALID_IMAGE_TYPE` | El archivo debe ser una imagen JPG, PNG, WEBP o GIF. |
| `IMAGE_TOO_LARGE` | La imagen es demasiado grande. Reduce el tamaño e intenta de nuevo. |
| `INVALID_IMAGE_PATH` | No se pudo preparar la ruta segura de la imagen. |
| `STORAGE_UPLOAD_NOT_ALLOWED` | No tienes permiso para subir esta imagen. |
| `STORAGE_UPLOAD_FAILED` | No se pudo subir la imagen. Revisa tu conexión e intenta de nuevo. |

## 11. Compatibilidad legacy

SEC.3 no borra ni migra objetos existentes.

Las URLs legacy `public_uploads/logo-*.webp` siguen visibles porque la policy de lectura mantiene `public_uploads/%`.

Diferencia clave:

- Legacy: lectura permitida.
- Legacy: nuevos uploads directos bloqueados.
- Nuevo flujo: autorización server-side + signed upload URL.

## 12. Queries de verificación

### Policies del bucket `images`

```sql
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and (
    policyname ilike '%images%'
    or coalesce(qual, '') ilike '%images%'
    or coalesce(with_check, '') ilike '%images%'
    or policyname ilike '%public_uploads%'
    or coalesce(qual, '') ilike '%public_uploads%'
    or coalesce(with_check, '') ilike '%public_uploads%'
  )
order by policyname;
```

Esperado: solo `SELECT` público controlado. Ningún `INSERT`, `UPDATE` o `DELETE` público sobre `images`.

### No INSERT amplio sobre `images`

```sql
select policyname, roles, cmd, with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and cmd = 'INSERT'
  and (
    coalesce(with_check, '') ilike '%images%'
    or coalesce(with_check, '') ilike '%public_uploads%'
  )
order by policyname;
```

Esperado: `0 filas`.

### Auditoría cerrada a cliente

```sql
select
  has_table_privilege('anon', 'public.storage_upload_audit', 'SELECT') as anon_select,
  has_table_privilege('anon', 'public.storage_upload_audit', 'INSERT') as anon_insert,
  has_table_privilege('authenticated', 'public.storage_upload_audit', 'SELECT') as authenticated_select,
  has_table_privilege('authenticated', 'public.storage_upload_audit', 'INSERT') as authenticated_insert;
```

Esperado: `false / false / false / false`.

### Helpers cerrados

```sql
select n.nspname, p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','private')
  and p.proname ilike '%storage%'
order by n.nspname, p.proname;
```

Esperado: helpers internos `private.sec3_storage_image_*` cerrados a roles cliente.

### Lectura pública controlada

```sql
select policyname, roles, cmd, qual
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and cmd = 'SELECT'
  and (
    coalesce(qual, '') ilike '%images%'
    or coalesce(qual, '') ilike '%public_uploads%'
  )
order by policyname;
```

Esperado: lectura solo para `images/public_uploads/%`, no todo el bucket.

## 13. Pruebas manuales pendientes post-deploy

1. Subir logo `.png` válido.
2. Subir imagen `.jpg` en flujos futuros de producto/restaurante que usen el servicio centralizado.
3. Rechazar `.svg`.
4. Rechazar `.pdf`.
5. Rechazar imagen mayor al límite.
6. Rechazar filename con `../`.
7. Confirmar URL pública visible de imagen nueva.
8. Confirmar que las imágenes legacy siguen visibles.
9. Confirmar que FREE/PRO no cambian fuera del upload.
10. Confirmar que staff sin sesión activa no autoriza upload.
11. Confirmar rate limit `STORAGE_UPLOAD_RATE_LIMITED`.

## 14. Riesgos residuales / SEC.4

- Implementar `authorize-image-delete` si alguna UI necesita borrar/reemplazar imágenes.
- Retirar o convertir cualquier helper legacy que todavía permita upload directo si se reutiliza en nuevos módulos.
- Añadir permisos finos por purpose para staff: settings/productos/restaurante.
- Añadir limpieza de auditoría antigua y objetos huérfanos autorizados pero no referenciados.
