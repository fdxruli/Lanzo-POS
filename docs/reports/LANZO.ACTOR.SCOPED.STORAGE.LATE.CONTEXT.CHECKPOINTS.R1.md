# Checkpoint 0 — preparación durable

Base: f48aab53634663438a06dc5187fa7e6d17b74fb3.
Rama: fix/actor-scoped-storage-stale-events-r1.
Sólo preparación; no solución certificada. PR/Preview/merge no autorizados hasta superar gates.
Las dos configuraciones Vercel desactivan despliegues automáticos únicamente en esta rama para poder guardar checkpoints inseguros sin desplegarlos. No se modifica configuración de producción ni política de runtime.
Checkpoint A/B/C/D aún pendientes. No hay cambios de producto.

## Checkpoint A — reproducción confirmada
Fixture RECONSTRUIDO, sólo EXP-F02-14. Producto idéntico a main f48aab53.
Comando: npx vitest run src/services/auth/__tests__/actorLateContext.integration.test.js --maxWorkers=1.
Resultado: 1 FAIL sin expected-failure. Antes granted/session-b/generation6; después locked/sessionIdnull/generation7; reason actor_context_changed_in_other_tab; durableNewRecordPreserved=true; writesSuspended=true.
Preparación remota 34116673cea8bb2ae4ab081d8ed6e386196c2c22 / árbol 9a9af344ef37d7a580f4f3563cdcbe14406203d9.
No PR/Preview/merge. B/C/D pendientes.
