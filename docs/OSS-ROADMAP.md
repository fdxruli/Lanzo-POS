# Roadmap OSS

Actualización: 2026-08-04.

| Tarea | Estado | Alcance |
| --- | --- | --- |
| OSS.1.4 | sin cambio | Mantener el estado previo de activos y sus bloqueos. |
| OSS.1.5 | `BLOCKED` | El autohospedaje completo aún no es reproducible. |
| OSS.1.5.1 | `PASS WITH NOTES` | PR #173 integrado y configuración local creada; Docker daemon no disponible para validar runtime. |
| OSS.1.5.2 | `PASS WITH NOTES` | Migración ecommerce hermética, con SQL local equivalente; falta reset sobre una base vacía. |
| OSS.2 | `BLOCKED` | No se desbloquea por esta configuración local. |
| AGPL | no activada | No se adopta ni se declara vigente en esta tarea. |

OSS.1.5.1 añade únicamente `supabase/config.toml`, más la documentación de la
configuración y su validación. No añade una función IA, no modifica SQL,
dependencias, código productivo o activos de marca, y no utiliza proyectos ni
secretos remotos.

OSS.1.5.2 elimina la descarga de SQL en tiempo de ejecución de
`20260715190958_ecom_products_model_1.sql`. La fuente canónica fue recuperada
del historial Git, verificada por SHA-256 y comparada funcionalmente con el SQL
embebido. La siguiente tarea exacta es `lanzo-ai-agent`; el autohospedaje
completo, E2E, backup/restore y el reset desde cero siguen pendientes.
