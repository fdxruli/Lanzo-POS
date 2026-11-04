# PR #371 — R3: SQL V compatible y dispatcher real

**Dictamen: `PR371_R3_SQL_READY_LOCAL`.** V completa se ejecutó en PostgreSQL 17.11 aislado. Discovery, las once RPC v2 y el escenario financiero real pasaron. Esto no declara el PR listo para merge ni autoriza instalación, publicación o activación comercial.

## Referencias verificadas

- main remoto: `622f29a84bfc6b82e7230e7dbbebd93aa6f02828`.
- #371 OPEN / Draft, HEAD remoto `2f33cea480f3d478f797b495b168feac9aed483f`; sin retarget.
- Base local R2: `3e688654e7bcb985fe5c649e630ad6f04f454099`, árbol inicialmente limpio, con ambos padres originales del merge conservados. R3 añade un commit local normal sobre R2.
- #374 OPEN / Draft, HEAD `a3bce02de50c92bef9b93345a1fe1c511feab95e`, dependiente de #371; sin cambios.
- Production `odlrhijtfyavryeqivaa`: ledger leído mediante `list_migrations`; F `20261022135915` instalada, V `20261023033028` ausente y Q ausente según nombres/evidencia disponible. Las consultas adicionales fueron SELECT de catálogo: definiciones, hashes, seguridad y estructura de tres tablas. Sin filas de negocios ni RPC de aplicación.

Worktree reutilizado: `C:/Users/pituf/.codex/worktrees/cloud-sync-protocol-v2-fin01-r1/Lanzo-POS-Git`. Sin otro merge, rebase, push, cierre de PR ni modificación del checkout principal. Se conserva el stash de recuperación de R2.

## Las cinco compatibilidades

La lectura actual confirmó **44 hashes originales iguales y las mismas cinco diferencias** de R1/R2. Las cinco definiciones actuales coinciden con las que sustentaron aquel análisis semántico. Se reutilizó ese análisis y se verificaron sus contratos mediante ejecución; no se aceptaron hashes alternativos ni excepciones al guard.

| Dependencia | Contrato conservado y comprobación |
| --- | --- |
| `private.execute_split_sale_financial_v1` | Admisión compartida de transición antes de los locks de negocio. La llamada real durante pausa rechaza con `RESTAURANT_CONTRACT_MAINTENANCE`; cuerpo restante intacto. No se certifica un split completo exitoso. |
| `public.pos_close_restaurant_order_after_checkout_unlimited` | Admisión de transición antes del cierre. Rechaza durante pausa y ejecuta el cierre real del checkout autorizado. |
| `public.pos_create_cloud_sale_cashier` | Conserva rate limit, estación y guard de origen del dispatcher antes del core restringido. Rechaza venta directa de restaurante sin operación financiera; admite checkout real mediante v2. |
| `public.pos_create_cloud_sale_cashier_inventory` | Conserva esos controles y delegación al core de inventario restringido. La llamada real directa sin contexto financiero es rechazada. No se certifica una venta completa de inventario en R3. |
| `public.pos_execute_financial_operation_v1` | Conserva admisión de transición, aliases coherentes, lock del padre, validación de Caja/origen, reserva/replay y prevención de segundo cobro. Se comprobaron pausa, alias incompatible, checkout/replay y rechazo de nueva clave cuando ya existe la venta del pedido. |

V cambia únicamente los cinco hashes revisados y añade cinco dependencias exactas: los tres helpers de transición/origen y los dos cores `pos_create_cloud_sale_cashier[_inventory]_unlimited`. Comprueba además la presencia de `private.restaurant_cloud_contract_state` y las ACL restringidas de esas dependencias. **54/54 hashes** y **54/54 comparaciones de owner/search_path/EXECUTE de anon, authenticated y service_role** coinciden después de aplicar V.

La transformación dinámica continúa haciendo sólo tres sustituciones: nombre del dispatcher, llamada a crédito y llamada a cancelación. Exige una única aparición de cada marcador. En PostgreSQL se comparó la definición real del core creado con la definición actual v1 tras esas tres sustituciones: igualdad exacta. Se preservan `statement_timeout=45s`, `lock_timeout=20s`, permisos y controles actuales. No fue necesario reconstruir el dispatcher.

## Ejecución aislada y resultados

Se reutilizaron el clúster R2, su base `fin01_cert_r2`, esquema sintético y transporte PostgreSQL existente, en `127.0.0.1:55849`, PostgreSQL **17.11**. Se añadieron únicamente definiciones reales necesarias para V y los escenarios focales: 91 definiciones de funciones entre overlays/dependencias; las dos tablas de restaurante, auditoría de Caja, DDL original de las dos tablas F y estado original de transición. No se copió una base ni datos de Production. El ledger sintético representa F ya instalada; **no se volvió a ejecutar F**.

Las definiciones se enviaron conservando su texto original, incluidos finales de línea, para que los hashes representaran los cuerpos reales. El único doble externo heredado es `realtime.send`, transporte de notificación sin efectos; autorización, aritmética, locks, reservas, recibos e idempotencia usan funciones PostgreSQL reales. La preparación del baseline desactiva comprobación anticipada de cuerpos para cargar dependencias; la aplicación de V usa la comprobación normal habilitada.

| Comprobación | Resultado y alcance |
| --- | --- |
| SQL preparado | V candidato adaptado, sin cambios a F o Q. |
| Migración íntegra | **PASS**: se envió el archivo V completo, incluidos guards, transformación, owner/ACL, comentarios, NOTIFY y COMMIT. Sin recortar SQL ni saltar validaciones. |
| Discovery y once RPC | **PASS real**: discovery SUPPORTED y once endpoints anunciados; upsert, migración de directorio, delete, snapshots/changes de Clientes y crédito, resumen, pago, dispatcher y recibo ejecutados. |
| Seguridad de nuevas funciones | **PASS**: doce funciones públicas con postgres/SECURITY DEFINER/search_path vacío y grants explícitos; nueve privadas cerradas a anon/authenticated/service_role. Discovery y la operación financiera también se invocaron bajo rol anon. |
| Venta y pago | **PASS real**: dispatcher v2 creó una venta a crédito de $10; pago v2 posterior de $5 dejó `debt_cents=500`. No se precargó el recibo ni se simuló el dispatcher. |
| Recibo/replay | **PASS real**: tres consultas del recibo y tres retries del dispatcher mantuvieron clave/hash, resultado original con deuda 1000, estado completado y `OPERATION_RESULT` sin proyección vigente. Tres retries del pago conservaron el saldo 500. |
| Efectos | Antes/después de retries y rechazos: ventas **1/1**, ledger **2/2**, Caja **1/1**, operaciones financieras **1/1**, claves de idempotencia **5/5**, pagos de venta **0/0**, inventario **0/0**. Las cinco claves incluyen las acciones de directorio. El pago de cliente está en ledger/Caja. |
| Rechazos | Clave ausente, hash incorrecto, request cambiado con hash viejo o nuevo y misma clave, otra estación/dispositivo, otro actor/tenant, sesión inválida, permiso ausente y capacidad financiera ausente. Los recibos no autorizados no revelan el resultado. |
| Restaurante | Guards de los cinco contratos ejecutados según tabla anterior; checkout con cierre y replay completado válidos. Nueva clave tras venta existente exige `RESTAURANT_ORDER_SALE_RECONCILIATION_REQUIRED`, sin segunda venta ni operación residual. |
| Fail-closed de V | **4/4** pruebas reales de alteración aislada: owner, ACL, estado de transición ausente y hash cambiado. Cada ejecución completa abortó con el error esperado; cada alteración se revirtió. Después: 54/54 hashes intactos. |
| Legacy | El dispatcher v1 actual conserva definición y puede recuperar/repetir el recibo generado por v2 sin duplicar efectos. No se modificaron wrappers legacy. Corte por negocio y recuperación integral de PWA antiguas siguen pendientes. |
| Contrato estático | **7/7** pruebas Node existentes; separado de la ejecución real anterior. `git diff --check` sin errores. No se repitieron las 169 pruebas R2, build ni auditorías generales. |

La prueba SQL final devuelve `R3_FULL_V_DISPATCHER_PASS` con contadores JSON y revierte su transacción. No quedan ventas, pagos, pedidos o clientes de prueba R3. Los DDL del candidato se conservan en esa base sintética; el servidor aislado se detiene al finalizar.

Durante preparación se detectaron dependencias reales ausentes del fixture: función de restricción de estado de pedido, tipo de auditoría de Caja, cores actuales de F y un helper escalar de canonicalización. Se incorporaron desde DDL original/catálogo, sin stubs financieros. El primer pago de restaurante del test omitía `received_amount`; se corrigió el dato sintético. Esos intentos no se cuentan como PASS. El resultado corresponde al test final completo, no a agregar éxitos parciales.

Evidencia: `C:/dev/Lanzo-POS-Git/.tmp/pr371-r2/r3-*`: catálogo/dependencias/DDL, suplemento de baseline, compatibilidad de hashes, resultado de guards y salida financiera. Se conserva el trabajo R2; no hay un laboratorio adicional. El test reproducible es `supabase/tests/fin01_cloud_sync_v2_dispatcher_r3.sql`, ejecutable sólo sobre el fixture sintético compatible después de V.

## Archivos R3

- `supabase/migrations/20261023033028_fin01_cloud_sync_protocol_v2_r1.sql`: cinco hashes revisados, cinco dependencias indispensables y transformación exacta de tres marcadores.
- `supabase/tests/fin01_cloud_sync_v2_dispatcher_r3.sql`: comprobaciones reales de seguridad, once RPC, venta/pago/recibo/retry y protecciones de restaurante, con rollback.
- `docs/reports/PR371_R3_SQL_COMPATIBILITY.md`: evidencia, alcance y pendientes.

No se modifica cliente React, F, Q, otras migraciones ni #374. El commit R3 es local y su SHA se entrega al propietario.

## Legacy, riesgos y próxima acción

La transición por negocio sigue siendo viable de forma focal: V añade endpoints y core privado sin retirar v1 ni cambiar sus permisos. No se activó una política de piloto ni se deshabilitaron las 14 entradas legacy. **La contención todavía no está demostrada**: al diseñarla debe contemplarse que el core v2 aún llama wrappers públicos compartidos de Caja y cashier/inventario. Un rechazo ciego por negocio en esas llamadas bloquearía también v2. El gate deberá distinguir la admisión financiera validada del servidor y preservar sus cores/controles, además de retener las claves y recibos pendientes de clientes antiguos. No se implementa ese mecanismo aquí.

No se demostró inviabilidad estructural. La copia privada del dispatcher queda fijada a esta versión: futuras correcciones de v1 no se propagan automáticamente; deben revisarse junto con V. El ensayo cubre el escenario financiero mínimo y las protecciones afectadas, no todas las ramas de Caja, split, inventario o apartados, ni triggers/integraciones ajenos al fixture. No sustituye QA de aplicación/PostgREST/Preview, concurrencia entre procesos o prueba del corte de PWA.

**Siguiente acción mínima:** revisar con el propietario el gate piloto por negocio y sus llamadas internas, preparar su prueba de corte y autorizar QA funcional en un entorno adecuado. Publicar o instalar SQL requiere una decisión posterior. Production permanece sin modificaciones; no se cierra #371 y no se cambia #374.
