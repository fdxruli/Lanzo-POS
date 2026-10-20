# INCIDENT.RECOVERY.PREMERGE.HARDENING.R1

Fecha: 2026-10-19/20

PR: [#357 — Incident Recovery Center R1](https://github.com/fdxruli/Lanzo-POS/pull/357)
Estado: Draft, sin merge a producción.

## Alcance y cambios

- `IncidentReportEntry` no muestra botones de reporte si falta el incidente o un callback real.
- `AdminIncidentNotice` abre un formulario de contacto manual bajo demanda. Copiar y correo usan el flujo aprobado de Telegram/email; no se agregó envío automático ni RPC. La acción vuelve a validar el contexto capturado de actor, sesión y tenant y administra el foco al abrir y cerrar.
- Los avisos de operaciones financieras críticas no ofrecen contacto/reporte ni habilitan reintento. `DatabaseRecoveryGate` conserva el bloqueo duro de IndexedDB y las opciones existentes de copiar/correo; se eliminó la acción de reporte inerte.
- La migración `20261015134821_technical_incident_reporting_r1.sql` se movió sin cambios a `supabase/archive/unresolved-migrations/`. SHA-256: `20631989505E71636590B001F0E1D70B562D94DB6F970EC108BB00B57ECDDCC5`. El contrato verifica que no exista dentro de `supabase/migrations` y que sí permanezca archivada. No se aplicó DDL ni se modificó una base de datos.
- La integración con `main` emitió `supportContact-*.js` como dependencia compartida del entry QA de preview. Se añadió al precache del shell administrativo; el helper contiene el flujo manual de contacto y no incluye el runtime comercial del laboratorio.

## Integración aislada

- PR #365 ya está en `main` en `a09b224cc1aff671f4a29152f21b9d9d12173f20`.
- Merge-base de PR #357 y `main`: `31fadba8bdb4f92725d07572e2696f9af20c47ca`.
- Merge temporal probado en `C:\dev\Lanzo-POS-PR357-Integration`: `e6b4106be996de240bd130e1d1d800f1df9e9c0e`; terminó sin conflictos. La corrección PWA fue aplicada después como `715e7a7f4` en ese árbol integrado.
- El checkout inicial y el worktree existente de PR #357 no se usaron para la integración. La rama de PR no contiene el merge de `main`; no se ejecutó merge a producción.
- Commits de hardening en la rama de trabajo: `1ed82351b219196d04b002aee3e71589260ce1bb` y `d33142c4f`.

## Validación local

| Comprobación | Resultado |
|---|---|
| Contrato SQL de reporte técnico | PASS — 5/5 |
| Suite integrada de recuperación, aviso, gate de base local, ErrorBoundary y contexto | PASS — 9 archivos, 93/93 |
| Compatibilidad auth/ActorRuntime/IndexedDB/login/licencia y `BackupRuntime.attention` | PASS — 8 archivos, 143/143; `BackupRuntime.attention`: 16/16 |
| Transición de licencia disponible en el repo (`modernFreeLegacyCutover.transition`) | PASS — 1/1. La ruta solicitada `licenseSessionTransitions.test.js` no existe en este checkout. |
| Ecommerce public y contacto pausado | PASS — 2 archivos, 41/41 |
| Contratos seleccionados de ecommerce public service | PASS — 4/4; 34 casos fuera del filtro |
| Store Git Runtime, tres pruebas de endpoints y alcance | PASS — 3 archivos, 58/58 |
| ESLint focal integrado | PASS — solo advertencia conocida de `baseline-browser-mapping` desactualizado |
| `git diff --check` | PASS |
| `npm run build` production + postbuild de precache | PASS — 24 assets de arranque y 0 rutas Local core adicionales |
| QA audit production | PASS — 45 ejecutables, `qaArtifacts: 0` |
| `VERCEL_ENV=preview npm run build` + postbuild | PASS — 32 assets de arranque; PWA precache de 42 entradas |
| QA audit preview | PASS — 10 chunks estáticos, `commercialRuntimeModules: 0` |
| `npm run build:store` | PASS |
| `npm run build:store:vercel` | PASS — compliance true, artefactos byte-identical, `deployed: false` |
| Full `store/tests/social-preview` | NO VERDE LOCAL — rerun con `npx` terminó 737/739; dos casos de `storeBuildOutputAudit.test.js` excedieron 15 s. Rerun aislado de ese archivo: 57/61; cuatro timeouts de 10–15 s. La primera invocación directa de Vitest también falló porque no define `npm_execpath`; `npx` corrigió ese caso. No se modificaron esos tests. |
| React Doctor (`npx -y react-doctor@latest . --verbose --diff`) | SIN RESULTADO — dos intentos sin salida durante más de dos minutos; cancelado. |

Los builds reportan advertencias Vite preexistentes de imports dinámicos/estáticos y patrones PWA sin coincidencias, además de `baseline-browser-mapping` antiguo. No bloquearon los builds finales.

## Estado pre-merge

```text
PR357_PREMERGE_STATUS: NOT_READY_LOCAL_GATES
PR357_DRAFT: YES
MERGE_STATUS: NOT_MERGED
DATABASE_DDL_APPLIED: NO
PRODUCTION_DEPLOYED: NO
OWNER_QA_PRESERVED: YES
```

La suite completa de Store Git Runtime requiere un rerun en CI o en un host sin estos timeouts antes de declarar todas las gates verdes. React Doctor tampoco produjo diagnóstico. El PR permanece Draft; revisar los checks remotos después del push y no marcarlo ready mientras siga fallando una gate requerida.
