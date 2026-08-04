# Estado de autohospedaje

Fecha: 2026-08-04.

| Área | Estado | Nota |
| --- | --- | --- |
| OSS.1.5 | `BLOCKED` | La reproducibilidad completa aún no está demostrada. |
| OSS.1.5.1 | `BLOCKED` | `supabase/config.toml` existe y es aceptado, pero Docker daemon no está disponible. |
| OSS.1.5.2 | `NEXT` | Hacer hermética la migración que descarga SQL externo, en una tarea separada. |
| OSS.1.4 | sin cambio | Mantener el estado registrado por la revisión de activos; esta tarea no lo modifica. |
| OSS.2 | `BLOCKED` | Continúan pendientes los bloqueos del roadmap. |
| AGPL | no activada | No se creó `LICENSE` ni se cambió la licencia. |

## Handoff a OSS.1.5.2

Investigar `supabase/migrations/20260715190958_ecom_products_model_1.sql`.
La migración crea temporalmente la extensión `http`, descarga desde una URL de
GitHub la migración `20260715190000_ecom_products_model_1.sql` y comprueba un
SHA-256 antes de ejecutar el contenido. OSS.1.5.2 debe sustituir esa
dependencia por una fuente versionada/local y demostrar el reset desde cero.

No descargar el SQL para forzar esta tarea, no saltar la migración, no usar
`migration repair` y no cambiarla dentro de la rama de OSS.1.5.1.

## Límites

Esta tarea no añade `lanzo-ai-agent`, no cambia migraciones o Edge Functions,
no valida Auth/RLS/RPC/Storage/Realtime/E2E, no ejecuta backup/restore, no usa
Supabase remoto, no usa Vercel y no activa AGPL.
