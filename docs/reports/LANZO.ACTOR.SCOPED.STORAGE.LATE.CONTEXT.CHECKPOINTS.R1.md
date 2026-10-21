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

## Checkpoint B — corrección focal, NO CERTIFICADA
A remoto b9e6bb7ac7df0a1ea13325b8c6590e8a525192e6 / árbol 86624737a1ed49f98d784237a15212562596bf0e.
Eventos se interpretan como hints por tenant; se relee contexto durable y se compara identidad exacta. Se revalida binding antes de emitir y binding/generación en bridge antes de bloquear. StorageEvent de borrado/corrupción también relee/falla cerrado. Formato v1 intacto.
Prueba focal: EXP-F02-14 PASS + actorScopedStorage 10/10 PASS (11 únicos). Nueva sesión conserva generation6 y writesSuspended=false; no cambia registro ni vuelve a autorizar.
Invalidación durable todavía SIN CORREGIR, pruebas entre documentos y compatibilidad pendientes. No es candidata publicable. B no certifica LC13 ni ACT-ST07.

## Checkpoint C — bloqueo de seguridad reproducido; regresión ampliada NO EJECUTADA
B remoto 8867fd00f6241cfced326a198e3d32617953c9d3 / árbol eb180168866f7d077b247a4b5e1c056268f518f1.
Chromium real 143.0.7499.0, perfiles sintéticos aislados, dos documentos mismo origen.
Evento antiguo: baseline FAIL / checkpoint focal PASS.
LC13 main-main FAIL; candidato-candidato FAIL; main-candidato FAIL.
A había perdido validez durable (assertCurrent rechaza). Después B activa su contexto. Invalidación tardía de A publica locked y destruye B. durableBPreserved=false, handleCurrent=false, durableStatus=locked en las tres variantes.
Se activa HOLD obligatorio. NO se cambia invalidación por lectura + setItem (no es CAS), ni se cambia protocolo, ni se añade Web Locks. No se afirma solución integral.
ESLint focal y git diff --check PASS. Matriz restante, regresiones ampliadas/build/PR127/CI no ejecutados por detención.
No PR ni Preview. Checkpoint D será cierre documental HOLD, no candidata final aprobada.
