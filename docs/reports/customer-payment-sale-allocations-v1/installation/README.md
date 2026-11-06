**Paquete de autorización futura — NO EJECUTADO EN PRODUCTION.**

Proyecto: `odlrhijtfyavryeqivaa`. Nombre: `customer_payment_sale_allocations_v1`. Versión: `20261106025114`.

Canónico SHA-256: `f358cd97ef3463c7fb210f1c7ad6844cf56ee558d42d53d9e2f3df1e57deab62`.

Paquete exacto SHA-256: `37744fd2159589340d9627e1aa7365a91fe4c3aa61f40b81d917dc15a0d3a8c5`.

- `preflight.sql`: SELECT de catálogo/ledger; exige cuatro fuentes y permisos originales y versión ausente.
- `apply-exact-version.sql`: una transacción, cuatro reemplazos existentes, una fila del ledger con el canónico completo y las fuentes originales para trazabilidad. Contiene preflight/postflight internos que abortan antes de COMMIT ante discrepancias. No ejecuta otras migraciones ni funciones de pago/cancelación.
- `postflight.sql`: SELECT de catálogo/ledger; exige cuerpos finales, ACL/atributos conservados y el SQL canónico exacto almacenado en la versión correcta.
- `restore-original-functions.sql.txt`: evidencia del SQL original para una contingencia autorizada; no es una segunda migración ni una orden de ejecución.

La instalación requiere autorización expresa del propietario por estos hashes y el commit revisado, sobre el proyecto indicado. La prueba aislada del mismo paquete aprobó rollback atómico por postflight fallido, registro exacto, rechazo de duplicado e invariancia de todos los movimientos financieros sintéticos. No hay instalación en Staging ni Production.

Si el postflight dentro de la transacción falla, dejar que PostgreSQL revierta todo y conservar el error; no hacer reparaciones de dinero. Si falla una comprobación externa después de COMMIT, detener QA y despliegues, registrar el estado y solicitar decisión del propietario antes de cualquier reversión. Mantener trazabilidad en Git/main y ledger mediante este mismo PR; no eliminar movimientos, recibos ni historia de migraciones.
