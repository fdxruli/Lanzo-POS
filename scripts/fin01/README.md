# FIN-01: fixture PostgreSQL nativo

Ejecutar desde la raíz del worktree. Solo datos sintéticos y un cluster nuevo dedicado; no usar un servicio existente ni credenciales de Production. PostgreSQL 17.11 fue la versión ejecutada. `fixture-boundaries.json` enumera las FKs externas omitidas y el único doble de transporte Realtime.

En una copia nueva del repositorio, extraer primero `docs/reports/fin01-r22/raw-evidence.zip` dentro de esa misma carpeta. Incluye los SQL capturados y logs originales byte por byte, incluso fallos e interrupciones. Los JSON de resultados se conservan también sin comprimir. No sobrescribir evidencias de una ejecución posterior.

1. Crear un directorio vacío dedicado fuera de cualquier base real. Inicializarlo con `initdb -U postgres -A trust`, usando los binarios nativos PG17.
2. Configurar únicamente `listen_addresses='127.0.0.1'` y `port=55847`. Arrancar con `pg_ctl -D <directorio propio> -l <log propio> -w start`.
3. Crear **fin01_cert_final** en ese cluster con `createdb -h 127.0.0.1 -p 55847 -U postgres fin01_cert_final`. El runner no acepta endpoints remotos ni toma una URL de variables de entorno.
4. Aplicar con `psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55847 -U postgres -d fin01_cert_final -f <archivo>` cada archivo, en este orden:

   - `docs/reports/fin01-r22/isolated-schema.sql`
   - `docs/reports/fin01-r22/extra-functions.sql`
   - `docs/reports/fin01-r22/isolated-cancel-payment.sql`
   - `scripts/fin01/seed.sql`
   - `supabase/migrations/20261022135915_fin01_historical_credit_owner_authorization.sql`

5. Ejecutar `node scripts/fin01/run-postgres-tests.mjs --report=postgres-reproduction`. Se conservan resultados por escenario en JSON y el proceso falla si alguna aserción falla. Cada conexión es real; las carreras abren dos sesiones PostgreSQL independientes. La prueba de locks inversos induce intencionalmente un deadlock y comprueba que solo sobrevive una transacción, que no quedan efectos parciales y que el retry reevalúa el límite.
6. Conservar evidencia y detener únicamente ese directorio propio con `pg_ctl -D <directorio propio> -m fast -w stop`. No eliminar datos de otras bases.

`build-isolated-fixture.mjs` reconstruye el esquema base a partir de los catálogos capturados, sin conexiones remotas. Los archivos extra de cancelación complementan ese esquema; no reemplazan funciones de autoridad o finanzas por mocks. Para reproducir el defecto anterior, aplicar primero solo esquema/dependencias/seed y ejecutar una venta sintética antes de la nueva migración; `baseline-reproduction.json` conserva el caso 800 + 300 > límite 1000.

Los filtros `--only=<regex>` sirven para diagnóstico. No ejecutar aislados los casos que reutilizan la autorización creada por el escenario anterior. Una repetición focal no se suma como casos nuevos. Los errores de fixture, timeouts e interrupciones permanecen en los logs originales y no se convierten en PASS por omisión.
