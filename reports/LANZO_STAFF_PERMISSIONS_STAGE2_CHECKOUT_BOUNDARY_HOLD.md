# Etapa 2 — revisión de la frontera del checkout

**Resultado: detenido por la regla de parada de la segunda solicitud. No hay solución funcional implementada.**

Esta revisión retoma `fix/staff-live-permissions` desde `88fc766a`. Se ejecutó `git fetch origin main`; el remoto sigue en `ff7f3b248a0b958967d7257749f7a20136244d41`. No se creó otra rama.

## Qué se revisó

Sólo el recorrido necesario para resolver el snapshot y la revocación durante un cobro: `usePosCheckout` → propiedad de `actorOperationalHandoff` → `salesService.processSale` → commit de venta local o cobro Cloud. No se repitió la auditoría general ni se consultaron datos de Production.

El diagnóstico y las tres reproducciones de la entrega anterior siguen siendo la evidencia del comportamiento previo. No se atribuye a esta revisión una nueva reproducción real de El Balón.

## Por qué mover el snapshot no basta

La propiedad persistida contiene pedido, actor y generación; `checkoutAttemptId` también se persiste. El snapshot mutable de UI sigue dentro del hook. Conservarlo al desmontar puede abordarse de forma acotada utilizando el módulo de propiedad existente, pero eso **no satisface** la exigencia de impedir completar operaciones después de revocar POS.

La inspección focal identifica estas fronteras:

| Fuente | Comportamiento actual | Consecuencia para el cambio solicitado |
| --- | --- | --- |
| `src/services/auth/actorOperationalHandoff.js:226` | `runCheckoutActorOperation` usa el handle del propietario o captura otro sin permiso requerido | Tener propiedad no equivale a tener POS vigente; conservar el snapshot no revoca el cobro |
| `src/services/salesService.js:205` | `processSale` pasa ese handle como `actorContext` al procesamiento | Los checks actuales de este recorrido validan identidad/binding, sin exigir POS |
| `src/services/sales/processSaleCore.js:591` | Comprueba el handle antes y después de `executeSaleTransactionSafe` | Exigir POS en el handle sin distinguir fases puede devolver fallo después de un commit válido |
| `src/services/db/index.js:132` y `src/services/db/sales.js:679` | La API recibe venta y deducciones; la transacción no recibe el comprobador del permiso del actor | Un guard previo al await no permite detener de forma segura una revocación que llegue durante la transacción |
| `src/services/salesCloud/salesCloudCashierService.js:1047` | El cobro Cloud captura un handle de identidad antes de preparar el envío | Una comprobación sólo en UI deja sin cubrir los awaits previos al envío |
| `src/services/financial/financialIntentLedger.js:1018` | Dispatch, recibo y persistencia usan el handle; existen estados durables y recuperación con origen propio | No se puede sustituir indiscriminadamente ese handle por otro que exija POS también al registrar el resultado de un envío ya realizado |

Estas son conclusiones de lectura del código vigente, **no una reproducción ejecutada de un doble pago ni de una carrera de commit**. La implementación actual del ledger ya conserva idempotencia y recuperación; no se afirma que sus protecciones estén rotas. El riesgo está en introducir la revocación en caliente sin separar correctamente las fases.

## Regla aplicada

La solicitud dice: «Si resolver el snapshot exige rediseñar ampliamente el checkout, cambiar el contrato de autoridad o intervenir múltiples subsistemas financieros, detenerse».

El snapshot aislado no es el impedimento definitivo. El bloqueo es cumplir simultáneamente la revocación durante awaits, no completar pagos con POS retirado y conservar resultados financieros ya confirmados. Para ello hay que intervenir tanto la venta local como el envío/resultado Cloud, además del ciclo de vida del checkout. Eso supera una corrección limitada al snapshot y al refresco Staff.

No se escribió código de aplicación ni se añadieron pruebas después de identificar esa frontera. Tampoco se publicó un refresco parcial de permisos: dejaría un bloqueo operativo inseguro o una cobertura de revocación incompleta.

## Costo mínimo técnico para resolverlo

Se requiere una ampliación explícita y acotada del alcance a estas tres fronteras, con sus regresiones:

1. **Checkout y autoridad de la misma sesión.** Conservar el snapshot junto a su propiedad existente, verificar Staff con `verifyStaffSession` y comprobar identidad, tenant, dispositivo y sesión antes de publicar permisos. No cambiar de propietario ni iniciar un nuevo intento para recuperar uno anterior. Una UI desmontada debe poder recuperar el mismo intento bajo autoridad válida.
2. **Venta local.** Propagar la comprobación de POS hasta el interior de la transacción, de forma que una revocación observada antes del commit aborte atómicamente. Una vez confirmado el commit, conservar su resultado como venta confirmada; no reinterpretarlo como un permiso para iniciar otro pago ni como un fallo que invite a repetirlo. Esto afecta a la interfaz entre `processSaleCore`, la API de DB y el repositorio de ventas.
3. **Cobro Cloud y recuperación.** Exigir POS vigente hasta el envío de una nueva operación, conservando el binding de identidad y origen para registrar o consultar el resultado de un envío ya realizado. Reutilizar el ledger, su idempotencia y su recuperación; no crear otro sistema financiero. La recuperación no debe despachar un cobro pendiente usando un POS revocado. No se propone habilitar a otro actor para adoptar el intento.

No se estima un número de horas sin implementar y probar esas fronteras. El costo mínimo es una modificación coordinada de esos contratos y sus pruebas, no sólo mover un `useRef` o añadir una llamada RPC. No requiere necesariamente SQL ni cambios en RPC; no se investigó ni autorizó modificarlos.

La alternativa dentro del alcance actual es **posponer la Etapa 2**, conservando el comportamiento de `main`. No satisface el requisito de permisos en vivo; evita introducir una actualización parcial con cobros abiertos. No se propone conservar temporalmente permisos retirados para terminar cobrando.

## Pruebas y aceptación

- En esta segunda revisión no se ejecutaron tests nuevos, build ni un E2E después de una implementación, porque no hubo implementación y se activó la regla de parada.
- Las 124 pruebas de la entrega anterior pertenecen exclusivamente al diagnóstico previo. No se reutilizan como PASS de esta solicitud.
- El recorrido obligatorio de nueve pasos **no se completó**. En particular, no se han demostrado la recuperación autorizada, el bloqueo durante una operación asíncrona ni la reconcesión POS de la misma sesión con la solución propuesta.
- Identidad diferente, desconexión y sesión inválida: sin regresiones nuevas en esta revisión. Los módulos existentes no se modificaron.
- QA manual en Preview: **NO EJECUTADO**.

## Entrega local

Único archivo nuevo de esta revisión: `reports/LANZO_STAFF_PERMISSIONS_STAGE2_CHECKOUT_BOUNDARY_HOLD.md`. Cero líneas de código productivo modificadas. El diagnóstico anterior y su parche permanecen en la rama.

Sin SQL, migraciones, RLS, RPC, cambios de Production, estilos, navegación, push, merge, PR ni despliegue. Los archivos de `work/` son intermedios preexistentes de la investigación anterior y no se incluyen en el commit.
