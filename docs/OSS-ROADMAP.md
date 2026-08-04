# Roadmap OSS

Actualización: 2026-08-04.

| Tarea | Estado | Alcance |
| --- | --- | --- |
| OSS.1.4 | sin cambio | Mantener el estado previo de activos y sus bloqueos. |
| OSS.1.5 | `BLOCKED` | El autohospedaje completo aún no es reproducible. |
| OSS.1.5.1 | `BLOCKED` | Configuración local creada; Docker daemon no disponible para validar runtime. |
| OSS.1.5.2 | `NEXT` | Eliminar la dependencia de SQL externo en una migración. |
| OSS.2 | `BLOCKED` | No se desbloquea por esta configuración local. |
| AGPL | no activada | No se adopta ni se declara vigente en esta tarea. |

OSS.1.5.1 añade únicamente `supabase/config.toml`, más la documentación de la
configuración y su validación. No añade una función IA, no modifica SQL,
dependencias, código productivo o activos de marca, y no utiliza proyectos ni
secretos remotos.
