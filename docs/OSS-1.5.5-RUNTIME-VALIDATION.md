# OSS.1.5.5 Runtime Validation

## Classification

- `OSS.1.5.5 — FAIL WITH DOCUMENTED LIMITATION`.
- Self-hosting: `FRESH INSTALL NOT CURRENTLY SUPPORTED`.
- Existing hosted deployment: `NOT INVALIDATED`.
- Cause: `FOUNDATIONAL SCHEMA PREDATES VERSIONED MIGRATION HISTORY`.

La primera migración versionada, `20260614224210_harden_public_tables_and_pos_rpcs.sql`,
presupone un esquema fundacional histórico que ya existía en el proyecto
Supabase original y que no está representado por migraciones anteriores en
este repositorio. El intento remoto aislado conserva la evidencia de ese
supuesto y no autoriza a reconstruir el baseline dentro de esta tarea.

Esta conclusión no afirma que producción esté dañada, que Lanzo no funcione ni
que las migraciones incrementales sean inútiles. El proyecto Supabase actual
puede seguir funcionando y las migraciones incrementales continúan siendo
útiles para instalaciones existentes; lo que no está soportado actualmente es
una instalación limpia desde una base vacía.

## Environment

- Tipo: proyecto Supabase remoto desechable y aislado.
- Nombre: `lanzo-pos-oss-validation`.
- Project ref aislado: `lbszfrur…zemh`.
- Project ref producción excluido: `odlrhij…eqivaa`.
- Organización: `mvxjptarjussdpasqtln`.
- Región aislada: `ca-central-1`.
- Estado observado: `ACTIVE_HEALTHY`.
- Creación observada: `2026-08-05T12:54:53Z`.
- Supabase CLI: `2.51.0`.
- Commit Git base: `cfb5876692463a259ac71901c0e12f4b9ab6b20d`.
- Rama: `test/oss-supabase-runtime-validation`.
- Datos reales: no encontrados; `auth.users=0` y `storage.objects=0`.
- No se imprimieron ni almacenaron secretos, claves, contraseñas o connection strings.

## Safety gates

- Producción excluida: PASS. El proyecto enlazado se verificó por ref y nombre antes de cualquier operación de base de datos.
- Proyecto aislado vacío: PASS. Las tablas de licencias, ventas, clientes, productos y pedidos no existían antes del reset; Auth y Storage tenían cero filas.
- Reset autorizado: PASS. La tarea fue reanudada explícitamente con el proyecto aislado y la autorización de ejecución automática.
- Ref enlazado: PASS. `supabase/.temp/project-ref` coincidió con el ref aislado.
- No se usó Docker, PostgreSQL local, Vercel, despliegue de aplicación ni Edge Function.
- La CLI mostraba producción como enlace previo; sólo se consultó `supabase projects list` en ese estado. No se ejecutó SQL ni una mutación antes de enlazar el ref aislado.

## Migration inventory

- Migraciones rastreadas: 216.
- Primera: `20260614224210_harden_public_tables_and_pos_rpcs.sql`.
- Última: `20260802073907_ecommerce_site_version_deletion.sql`.
- Timestamps duplicados: 0.
- Nombres fuera de formato: 0.
- Archivos vacíos: 0.
- Referencias a archivos externos requeridos: 0.
- Llamadas HTTP desde migraciones: 0. Se encontraron 8 literales `https://` usados sólo para validación de URLs, no para ejecutar red.
- Migraciones con SQL dinámico: 11; no se identificó dependencia externa requerida.
- AI usage: `20260619204242_create_ai_agent_usage_table.sql`, `20260619204304_create_ai_agent_usage_rpcs.sql`, `20260620062018_add_ai_agent_usage_lookup_rpc.sql`, `20260620080954_fix_ai_agent_begin_for_update_nullable_join.sql`, `20260620081024_fix_ai_agent_usage_rpc_staff_session_and_features.sql`, `20260621000000_oss_bootstrap_license_period_schema.sql`, `20260624063444_optimize_ai_agent_usage_staff_session_lookup.sql`.
- Bootstrap de periodos/licencias: `20260621000000_oss_bootstrap_license_period_schema.sql`.
- Resultado: `MIGRATION INVENTORY: PASS`.

## Fresh install

Previsualización:

- `supabase migration list --linked`: 216 migraciones locales y 0 remotas.
- `supabase db push --linked --dry-run`: identificó las 216 migraciones como pendientes.
- No se ejecutó `supabase migration repair`.

Reset reproducible:

```text
supabase db reset --linked --no-seed
Applying migration 20260614224210_harden_public_tables_and_pos_rpcs.sql...
ERROR: relation "public.plans" does not exist (SQLSTATE 42P01)
At statement: 4
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY
```

Resultado: `FRESH DATABASE MIGRATION REPLAY: FAIL`.

La primera migración rastreada presupone objetos base (`public.plans`, entre
otros) que no son creados por ninguna migración anterior del historial local.
No se modificó la migración defectuosa.

## Post-failure state

La verificación de sólo lectura posterior al fallo observó:

- Migraciones aplicadas: 0.
- `public.plans`: ausente.
- `public.license_periods`: ausente.
- `public.ai_agent_usage`: ausente.
- `auth.users`: 0.
- `storage.objects`: 0.

El fallo no dejó migraciones aplicadas ni fixtures sintéticos.

## Existing install

- Dry-run posterior: no ejecutado; la instalación desde cero falló y las instrucciones exigen detenerse.
- `supabase db push`: no ejecutado.
- Resultado: `NOT EXECUTED — blocked by demonstrated migration failure`.

## Existing hosted deployment

`EXISTING HOSTED DEPLOYMENT NOT INVALIDATED`.

La validación sólo ejecutó el intento autorizado sobre el proyecto remoto
aislado. No se enlazó producción para operaciones de base de datos ni se
ejecutaron cambios sobre un despliegue alojado existente. El fallo de
instalación limpia no demuestra que el proyecto Supabase actual esté dañado.

## Schema

No se ejecutaron las assertions estructurales porque el historial no llegó a
crear el esquema de aplicación. No se puede declarar resultado para
`license_periods`, `ai_agent_usage.period_id`, FK, índices, RLS, policies,
owners, `search_path`, grants o revokes.

## Backfill

No ejecutado. No se crearon licencias, periodos ni filas de AI usage porque la
base no superó la instalación inicial.

## RPC

No ejecutado. `ensure_current_license_period`, `get_ai_agent_usage`,
`begin_ai_agent_analysis` y `complete_ai_agent_analysis` no fueron invocados.

## Idempotency

- Replay del bootstrap: no ejecutado; la instalación inicial falló antes de llegar al bootstrap.
- Resultado: `NOT EXECUTED`.

## Partial state

- Escenarios de estado parcial: no ejecutados.
- Resultado: `NOT EXECUTED`.

## pgTAP

- `supabase test db --linked`: no ejecutado porque las migraciones fallaron antes de instalar el esquema.
- Tests totales: 0.
- Tests pass: 0.
- Tests fail: 0; el fallo ocurrió en el replay de migraciones, no en pgTAP.

## Cleanup

- Fixtures sintéticos restantes: 0.
- Usuarios restantes: 0.
- Objetos Storage restantes: 0.
- Reset final: no ejecutado después del fallo, para no repetir una operación destructiva ya reproducida.
- Resultado: `NOT EXECUTED — no fixtures were created`.

## Result

`OSS.1.5.5 — FAIL WITH DOCUMENTED LIMITATION`

Motivo: el historial completo no puede instalarse desde cero en PostgreSQL
real porque la primera migración versionada referencia `public.plans` antes de
que exista, y ninguna migración local anterior crea esa tabla. El esquema
fundacional histórico precede al historial de migraciones versionadas.

## Limitations

- No fue posible validar esquema, backfill, RPC, RLS, grants, idempotencia ni estados parciales después del fallo inicial.
- No se realizó una corrección silenciosa, no se reconstruyó el esquema fundacional y no se modificaron migraciones, funciones o código productivo.
- No se repitió el reset remoto ni se ejecutaron pruebas adicionales.
- El proyecto aislado permanece como evidencia del intento de reproducción y no debe recibir tráfico ni datos reales.
- El repositorio no debe presentarse actualmente como self-hostable desde cero.

## Migration history conclusion

- El proyecto Supabase actual puede seguir funcionando.
- Las migraciones incrementales continúan siendo útiles para instalaciones existentes.
- Una instalación limpia desde una base vacía no está soportada actualmente.
- Reconstruir el baseline histórico queda fuera del alcance inmediato.
- No es obligatorio reconstruir el baseline antes de licenciar el código.

## Roadmap disposition

`SELF-HOSTING.FOUNDATION — FUTURE, NON-BLOCKING FOR LICENSE`.

Esta tarea futura deberá reconstruir y validar un baseline fundacional completo
para instalaciones nuevas. Queda diferida y no bloquea el trabajo de OSS.2
sobre alcance de licencia, exclusión de activos oficiales, creación de
`LICENSE`, notices y documentación de limitaciones de self-hosting.

OSS.1.5 permanece `BLOCKED WITH DOCUMENTED LIMITATION`.

## Scope evidence

- Producción no fue enlazada para operaciones de base de datos ni modificada.
- No se utilizó Docker, `supabase start`, `supabase db start`, PostgreSQL local, Vercel, deploy, API de OpenAI, Gemini ni Edge Functions.
- No se creó `LICENSE`, no se activó AGPL y no se reescribió historial Git.
