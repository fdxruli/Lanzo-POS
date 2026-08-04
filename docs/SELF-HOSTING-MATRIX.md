# Matriz de autohospedaje

Fecha de esta actualización: 2026-08-04.

Estados permitidos: `VERIFIED`, `VERIFIED WITH NOTES`, `PARTIAL`, `NOT
VERIFIED`, `BLOCKED`, `NOT REQUIRED`.

| Componente | Configuración/evidencia | Estado | Bloqueo o siguiente prueba |
| --- | --- | --- | --- |
| Supabase CLI | `2.51.0`; parseó TOML y reconoció `lanzo-pos-local` | VERIFIED WITH NOTES | repetir `status` con Docker |
| Docker | CLI `28.3.2`; `docker info` no accede a `desktop-linux` | BLOCKED | iniciar Docker Desktop manualmente |
| PostgreSQL | puerto configurado `54322`, major `17` | BLOCKED | `supabase start` |
| API | puerto configurado `54321` | BLOCKED | comprobar endpoint local |
| Auth | habilitado; site URL local y redirects locales | BLOCKED | comprobar Auth tras `start` |
| Storage | habilitado; límite `50MiB`; bucket esperado `images` en migraciones | BLOCKED | comprobar bucket/RLS/function |
| Realtime | habilitado | BLOCKED | comprobar conexión/publicaciones |
| Studio | habilitado en `54323` | BLOCKED | abrir Studio local |
| Inbucket | habilitado en `54324` | BLOCKED | comprobar correo local |
| Edge Runtime | habilitado; `authorize-image-upload` versionada | BLOCKED | iniciar runtime y revisar función |
| Analytics | deshabilitado intencionalmente | NOT REQUIRED | no necesario para OSS.1.5.1 |
| Migraciones | 215 encontradas; migración ecommerce hermética, hash y equivalencia verificados; no ejecutadas | VERIFIED WITH NOTES | reset aislado desde cero |
| Reset local | no ejecutado; no hubo stack | BLOCKED | ejecutar sólo con Docker local |
| `lanzo-ai-agent` | no existe en `supabase/functions` | BLOCKED | tarea posterior, fuera de OSS.1.5.1 |
| Migración externa | `20260715190958_ecom_products_model_1.sql` versionada localmente; no usa GitHub, red ni extensión `http` | VERIFIED WITH NOTES | validar reset aislado |
| E2E, backup y restore | fuera del alcance de esta tarea | NOT VERIFIED | tareas posteriores |

La configuración local no contiene project refs oficiales, URLs de producción,
claves ni credenciales. La ausencia del daemon impide distinguir servicios
configurados de contenedores/endpoint realmente saludables.
