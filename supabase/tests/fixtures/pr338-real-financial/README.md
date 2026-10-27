# PR #338: laboratorio financiero PostgreSQL 17

Este fixture contiene únicamente definiciones de esquema y funciones, y datos sintéticos. Las 40 tablas, columnas, restricciones, índices, triggers, políticas RLS y permisos de funciones fueron obtenidos del catálogo de Production mediante SELECT; no contiene filas financieras de Production. `function-hashes.json` registra MD5 y SHA-256 de 267 funciones, normalizando CR. El runner genera SQL desde 02-function-sources.json para conservar los espacios y compara las definiciones instaladas con ese manifiesto antes de aplicar 3D.14.

Las hojas que modifican ventas, pagos, Caja, inventario, lotes, crédito, ledger y recibos son reales. Se emplea pgcrypto real. Los dispositivos sintéticos no tienen realtime_topic: no se invoca ni se simula la entrega externa realtime.send. Este laboratorio no prueba el servicio Realtime. El helper ecommerce_record_reservation_event, cuyo tipo pertenece a una tabla ajena al flujo probado, no se instala; tampoco se ejecuta. Ninguna función financiera se sustituye por un doble.

Se requiere un clúster PostgreSQL 17 nativo y desechable escuchando solo en 127.0.0.1, con una base vacía llamada `pr338_integrated_fixture`. No usar un clúster o base que contenga datos necesarios. El runner exige host, puerto, base, binario psql y directorio de evidencia explícitos; rechaza una base no vacía.

Ejemplo PowerShell, ajustando únicamente las rutas y el puerto del clúster aislado:

```powershell
$env:PGHOST = '127.0.0.1'
$env:PGPORT = '55487'
$env:PGUSER = 'postgres'
$env:PGDATABASE = 'pr338_integrated_fixture'
$env:PSQL_BIN = 'C:/ruta/a/postgresql-17/bin/psql.exe'
$env:PR338_LAB_EVIDENCE_DIR = 'C:/ruta/desechable/evidencia-pr338'
node scripts/supabase/restaurant-real-financial-lab.mjs --isolated-fixture
```

El runner instala el snapshot y la migración del checkout actual, crea datos sintéticos, verifica autoridad, recepción y replays, Caja, crédito, pagos y reversas. Las carreras usan procesos psql independientes, con observación de bloqueos y una barrera simultánea. Guarda SQL ejecutado, salidas, hashes y conteos en el directorio de evidencia. Las claves y tokens presentes en los fixtures son valores sintéticos exclusivos de laboratorio.

Una aprobación del laboratorio no autoriza escrituras en Production, QA financiera productiva, instalación de SQL ni merge.
