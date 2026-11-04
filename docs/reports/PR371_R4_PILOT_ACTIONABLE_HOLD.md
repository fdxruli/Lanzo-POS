# PR #371 — R4: HOLD por recuperación del cliente desconectado

**Dictamen: `PR371_R4_ACTIONABLE_HOLD`.** No se implementó ni activó un gate parcial. El escenario exigido de PWA desconectada con una operación intentada y sin recibo confirmado no se resuelve con actualización + drenaje de los equipos conectados. Se conserva el candidato R3 y se detiene la ampliación según la condición especial de R4. Esto no demuestra inviabilidad estructural de v2.

## Referencias e integridad

- main remoto verificado: `622f29a84bfc6b82e7230e7dbbebd93aa6f02828`.
- #371 OPEN / Draft, HEAD remoto `2f33cea480f3d478f797b495b168feac9aed483f`; sin cambios remotos.
- HEAD local inicial R3: `4d803d48d2843ce19fc586fefa7a72e91fa4e815`, árbol limpio. Se conservan su padre R2 `3e688654e7bcb985fe5c649e630ad6f04f454099` y el merge normal previo.
- #374 OPEN / Draft, HEAD `a3bce02de50c92bef9b93345a1fe1c511feab95e`, sin modificaciones.
- `list_migrations` de Production confirma F `20261022135915` y ausencia de V `20261023033028`; Q sigue ausente según evidencia disponible. **R4 no ejecutó SQL en Production**, ni siquiera consultas de catálogo. No se leyeron datos reales de negocios.

Worktree: `C:/Users/pituf/.codex/worktrees/cloud-sync-protocol-v2-fin01-r1/Lanzo-POS-Git`. Los únicos cambios R4 son dos pruebas diagnósticas y este informe. No cambian V, F, Q ni funciones del cliente en ejecución. Se prepara un commit local de evidencia sobre R3; su SHA se entrega por separado.

## Bloqueo concreto comprobado

La recuperación distingue una operación nunca intentada de una operación ambigua. En `src/services/financial/financialIntentRecovery.js`, la rama `NOT_FOUND` sólo permite primer envío de `PREPARED` con cero intentos o retry explícito de una venta `BLOCKED`. Una operación ya intentada en `PENDING_RECEIPT`/`DISPATCHING` permanece `PENDING_RECEIPT`, con `FINANCIAL_RECOVERY_RECEIPT_NOT_FOUND_AFTER_ATTEMPT`, aunque el usuario solicite retry explícito. No se borra ni cambia de clave.

Se añadieron dos pruebas del escenario de actualización: se retiene la evidencia con forma durable v1 (`ledgerVersion`/`requestContractVersion` 1), se renueva la sesión del mismo actor/dispositivo/tenant y se consulta un recibo `NOT_FOUND`. Resultado: **cero redispatches, misma clave/hash/petición/origen, un registro conservado, recuperación pendiente**. Al aparecer después un recibo `COMPLETED`, la recuperación termina sin ejecutar otra vez. La sesión renovada no es el bloqueo.

La suite también comprueba que el retry explícito de Caja no está disponible y que un `BLOCKED` no se reenvía en background. No se generalizaron esas transiciones ni se cambió `PENDING_RECEIPT` a `BLOCKED` para forzar un envío: eso debilitaría una protección financiera existente.

En PostgreSQL real se obtuvo `NOT_FOUND` para K/H y después se ejecutó una venta v1 autorizada con esos mismos K/H; el recibo v2 pasó a `COMPLETED`. Es una prueba secuencial en una transacción sintética revertida, **no un ensayo de concurrencia**. Demuestra que el recibo actual es una consulta puntual; no acredita cierre de admisión legacy ni que una petición antigua no pueda llegar después.

Por tanto, añadir solamente una lista de pilotos y devolver `UPDATE_REQUIRED` no demuestra la vía de recuperación exigida para todos los pendientes. Retener el registro evita pérdida de evidencia; no equivale a poder terminar una operación que nunca obtuvo recibo y permanece ambigua.

## Drenaje y mecanismo mínimo evaluado

El mínimo de servidor sigue siendo una política privada por `license_id` resuelto mediante los validadores existentes, con estado inicial v1 y cambio exclusivo autorizado por el propietario. Necesita admisión compartida por negocio y cierre exclusivo durante la transición, sin confiar en capacidades del frontend, parámetros de origen o GUCs. Debe conservar íntegros auth, actor, dispositivo, sesión, permisos, locks y el ledger K/H.

El drenaje previo basta **sólo si todos los dispositivos/pestañas relevantes están actualizados, disponibles y sin operaciones ambiguas pendientes**. Drenar los conectados no puede demostrar qué conserva una PWA desconectada. Excluir ese caso requeriría una decisión explícita del propietario que cambie la condición de esta entrega; no se presupone.

Además, las 14 entradas legacy iniciales no son toda la frontera financiera: en el catálogo aislado existente también tienen EXECUTE para anon `pos_open_cash_session`, `pos_register_cash_movement` y `pos_create_cloud_sale_cashier`, entre las llamadas públicas compartidas conocidas por R3. Contener sólo el dispatcher v1 deja esas entradas fuera; bloquearlas sin distinguir la admisión interna afecta a v2. El origen v2 debe acreditarse mediante una frontera privada del servidor y acotada a la llamada, sin una bandera enviada por el cliente o una configuración PostgreSQL manipulable.

Para cubrir la PWA desconectada manteniendo el comportamiento actual de recuperación hace falta definir y comprobar un cierre de admisión efectivo que cubra esas variantes y una prueba de recuperación vinculada a K/H/origen. También debe decidirse cómo puede consumirla la recuperación de un intento ambiguo sin recibo y la de Caja. **Eso amplía el contrato de admisión/recuperación; no es sólo un guard SQL de negocio.** No se crea en R4 una infraestructura de permisos internos, nuevos estados de recuperación o adaptaciones sucesivas de wrappers para aparentar cierre.

La alternativa mínima inmediata es **aplazar la activación y mantener v1**, conservando R3. El propietario debe decidir si acepta un piloto restringido al drenaje total previo o si mantiene el caso desconectado y permite concretar ese contrato adicional. No se propone borrar pendientes, recrear claves ni reintentar por ausencia de recibo.

## Pruebas ejecutadas y estado de A–E

| Verificación | Resultado real |
| --- | --- |
| Vitest focal | **27/27** en `financialIntentExplicitRetry.test.js`: 25 existentes y dos diagnósticos R4. Usa el modelo de almacenamiento/RPC de la suite; no ejecuta una PWA ni acredita persistencia de un navegador real. |
| PostgreSQL | **17.11**, clúster/base R3 reutilizados: `127.0.0.1:55849`, `fin01_cert_r2`. Funciones reales de v1, recibo v2 y autorización; sin mocks financieros nuevos ni reaplicar V. |
| Diagnóstico SQL | `R4_BASELINE_NOT_FOUND_IS_NOT_CUTOVER_PROOF`: `NOT_FOUND` → venta v1 real → `COMPLETED`, mismos K/H, venta única y deuda 1000 centavos. Otro dispositivo/tenant no recibe el resultado; sesión inválida rechazada. |
| Limpieza | ROLLBACK ejecutado; comprobados cero clientes, ventas y operaciones financieras con prefijo R4. Servidor aislado detenido. |
| Intento inicial SQL | El transporte loopback agotó su tiempo; PostgreSQL canceló la sentencia y revirtió la transacción. No se cuenta PASS. Se ejecutó después el archivo con psql nativo y `ON_ERROR_STOP=1`, exit 0. |
| Lint | ESLint del único archivo JS modificado: exit 0. `git diff --check`: sin errores. No se repitieron las 169 pruebas, builds ni auditorías generales. |
| A — Negocio v1 | Se comprobó una escritura v1 autorizada en el baseline R3 sin gate. **No certifica su coexistencia con un gate R4 instalado.** |
| B — Piloto v2 | No implementado/probado como piloto. La certificación financiera R3 se conserva; no se presenta como una prueba nueva de activación R4. |
| C — Rechazo legacy recuperable | **No satisfecho.** Hay conservación del pendiente, pero no una recuperación terminable demostrada del intento ambiguo `NOT_FOUND` tras corte. |
| D — Llamadas compartidas | No se instalaron guards R4; no se declara PASS de llamadas bajo contención. Se conserva la implementación y evidencia R3. |
| E — Reversión | No hay mecanismo R4 de activación/reversión implementado ni probado. Las pruebas no borran ni cambian K/H, pero no sustituyen la prueba de reversión del gate. |

Evidencia local: `C:/dev/Lanzo-POS-Git/.tmp/pr371-r2/r4-recovery.json`, `r4-sql.log` (primer intento fallido), `r4-sql-summary.json` (resultado psql observado) y el test SQL versionado. Los resultados positivos del diagnóstico no son un PASS de transición. QA manual de PWA, Preview y PostgREST sigue pendiente.

## Archivos y entrega

- `src/services/financial/__tests__/financialIntentExplicitRetry.test.js`: dos casos R4 que conservan evidencia tras renovar sesión y documentan el límite de recuperación; sin cambios al código productivo.
- `supabase/tests/fin01_cloud_sync_v2_cutover_blocker_r4.sql`: diagnóstico PostgreSQL reproducible, sintético y con rollback; no contiene un gate ni activa un piloto.
- `docs/reports/PR371_R4_PILOT_ACTIONABLE_HOLD.md`: bloqueo, evidencia, alternativa mínima y límites.

**Próximo paso concreto:** mantener el piloto desactivado y pedir la decisión del propietario sobre la condición de dispositivos desconectados. No instalar/publicar V ni presentar la rama como lista para merge. No hubo push, merge, retarget, nuevos PRs, Q, cambios de licencias/dispositivos/datos reales ni cierre de #371; #374 permanece intacto.
