**LANZO POS — conciliación de abonos Cloud V1/V2. Candidata corregida; instalación no autorizada ni ejecutada.**

Resultado vigente: **V1 PASS (16/16), V2 PASS (19/19)** en PostgreSQL 17.6 real. La auditoría se limita a este cambio; Production sólo se consultó mediante SELECT de catálogo, configuración de admisión y ledger de migraciones. No se leyeron ni modificaron filas de la licencia, venta o abono piloto.

1. Identificación y conservación.

Rama: `fix/customer-payment-sale-allocations-v1`. Base `main` final: `d87bfae3556878e0c78cc97cfed0a1f71cba1ac4`. Se integró el avance de main mediante merge normal, sin conflictos ni cambios ajenos en el diff del PR. La auditoría SQL se realizó sobre la base inicial `5e1b4303e942657c406d91237ffa7ff44db91cec`; el canónico y su paquete permanecen idénticos. El candidato inicial se conservaba exactamente con SHA-256 `a9ef3aa0add6f4f799b5185f09c88266f1892d674243a832eeff071eba7055fc`. Se preservan el SQL original como evidencia `.sql.txt`, su informe y su manifest en `compatibility/`; los 20 casos PostgreSQL, 104 pruebas de aplicación y 7 checks V2 anteriores se mantienen como evidencia histórica y no se suman a esta matriz.

2. Defectos demostrados y única iteración de corrección.

El laboratorio, con los wrappers públicos reales, reprodujo que el candidato original dejaba V1 sin notas financieras (`pending_credit_sales=[]`) y rechazaba sumas específicas parciales que el contrato anterior aceptaba. `compatibility/original-candidate-reproduction.json` registra los fallos, incluido el PASS del resumen V2 real.

La misma migración ahora enriquece `pos_get_customer_credit_summary_unlimited`, compartido por V1 y V2, conservando intactos ambos wrappers. Acepta asignaciones específicas cuya suma no exceda el abono. El remanente se registra como `unallocated_amount` y nunca se transforma en FIFO implícito. Si una asignación parcial deja dinero sin conciliar, las notas quedan explícitamente sin saldo vigente confiable; se publican las invalidaciones de todas las notas afectadas mediante los eventos existentes. No se reparan asignaciones históricas.

3. Contratos y seguridad verificados.

Las diez funciones solicitadas se recuperaron con `pg_get_functiondef`, incluidas la validación legacy y la definición real del resumen. Sus dependencias indispensables y los triggers de las tablas financieras se restauraron desde el catálogo actual: **96 definiciones**, cada una comprobada por SHA-256, propietario, SECURITY DEFINER, search_path y permisos efectivos. Los 12 tipos de fila financieros y sus checks/triggers relevantes coinciden con Production. Se mantuvo el doble heredado exclusivo del transporte externo Realtime; ninguna función financiera crítica se reemplazó por una simulación.

La cancelación V2 usa el dispatcher público real, su hash/origen y sus recibos. Su dependencia incondicional de admisión Restaurant y el tipo de fila declarado se reprodujeron con definiciones y esquema reales, únicamente para alcanzar `sale.cancel`; no se auditó ni cambió el flujo Restaurant. El estado `writes_paused=false` se leyó como dependencia indispensable de esa admisión. No se escribieron datos Restaurant en las pruebas.

`private.pos_sale_to_jsonb` conserva exactamente cada clave anterior y su significado; la comparación ejecuta el serializador original recuperado como referencia de lectura. `total`, `amount_paid` y `balance_due` siguen siendo importes originales. Los campos nuevos son `original_balance_due`, `assigned_payments_total`, `current_balance_due` y `credit_allocation_status`. Clientes antiguos pueden ignorarlos; no se redefine `balance_due` para forzar su interpretación como saldo vivo ni se les exige protocolo V2. La UI incluida consume los campos nuevos.

Se conservan firmas, defaults, ACL, propietarios y search_path. La migración no crea tablas, roles, grants, políticas RLS ni triggers. Los resúmenes conservan los campos legacy de deuda, ledger (máximo 100 filas), totales y último pago. El lock del cliente mantiene consistente la lectura entre deuda, notas y envelope V2. El ledger sigue siendo la autoridad de los nuevos abonos; la proyección de cliente se recalcula con los mecanismos existentes.

FIFO y selección específica validan tenant, cliente, estado, linaje ledger, saldo, duplicados y cantidades. Se mantienen idempotencia y atomicidad; una falla de proyección revierte todo. Los casos concurrentes usan conexiones PostgreSQL independientes. La cancelación de una venta abonada se rechaza con seguridad; la cancelación ordinaria conserva sus efectos originales y su idempotencia. No se agregan reembolsos automáticos.

4. Migración definitiva candidata.

Nombre: `customer_payment_sale_allocations_v1`. Versión: `20261106025114`.

Canónico: `supabase/migrations/20261106025114_customer_payment_sale_allocations_v1.sql`.

SHA-256: `f358cd97ef3463c7fb210f1c7ad6844cf56ee558d42d53d9e2f3df1e57deab62`.

Reemplaza sólo:

- `private.pos_sale_to_jsonb(public.pos_sales)`.
- `public.pos_record_customer_payment_unlimited(text,text,text,text,text,numeric,text,text,text,jsonb,text)`.
- `public.pos_cancel_cloud_sale_unlimited(text,text,text,text,text,text,text)`.
- `public.pos_get_customer_credit_summary_unlimited(text,text,text,text,text)`.

La instalación sólo cambia definiciones de esas funciones y registra una fila de esa versión en el ledger de migraciones; no ejecuta abonos ni actualiza ventas. Después de instalar, los nuevos pagos usan las tablas existentes de ledger, clientes, ventas, idempotencia, Caja y eventos. Los importes originales de venta permanecen intactos; sólo se versiona su proyección.

5. Evidencia nueva y reproducción.

- `compatibility/results.json`: **35/35**; V1 16 y V2 19. Incluye FIFO, selección, campos camelCase anteriores, asignación parcial, reintentos, cancelaciones, deuda histórica, validaciones, rollback, concurrencia, permisos de actor, aislamiento, serialización y segundo dispositivo V2 con eventos/cursores reales.
- `compatibility/installed-production-parity.json`: fuentes, atributos y permisos restaurados en el laboratorio.
- `compatibility/production-final-preflight.json`: Production todavía conserva los cuatro cuerpos originales y sus atributos/permisos; versión candidata ausente.
- `compatibility/installation-results.json`: postflight negativo revierte DDL y registro; registro exacto de versión; rechazo de instalación duplicada; ledger financiero intacto.
- Aplicación en la base inicial de la auditoría: **29/29** en cuatro suites focalizadas. Tras integrar el avance final de `main`: **69/69** en seis suites afectadas, ESLint y build aprobados; evidencia en `compatibility/main-refresh/`. No se repitió la matriz PostgreSQL porque el SQL no cambió y el preflight de Production volvió a aprobar en sólo lectura. Contrato estático V2 **7/7**, ESLint y build aprobados. Se conservan advertencias glob del precache; no son fallos financieros.

Desde un PostgreSQL 17 nuevo y desechable, sólo `127.0.0.1:55847`, usuario `postgres` con trust local y base vacía `fin01_cert_compatibility`:

```sh
node scripts/fin01/prepare-sale-allocation-compatibility.mjs --isolated-fixture
node scripts/fin01/run-sale-allocation-compatibility-tests.mjs
node scripts/fin01/build-sale-allocation-installation.mjs
node scripts/fin01/test-sale-allocation-installation.mjs --isolated-fixture
```

Los runners no aceptan URLs remotas. El preparador exige una base vacía salvo el flag explícito de reconstrucción de definiciones; no hay simulaciones de finanzas ni de autoridad. El snapshot heredado omite FKs de tablas externas al laboratorio (`fixture-boundaries.json`); los tipos, checks, triggers y rutas financieras ejercitadas se verifican contra el catálogo real.

6. Instalación posterior, límites y contingencia.

Estado: **READY_FOR_SQL_AUTHORIZATION**, sujeto a autorización expresa del propietario; este informe no instala, fusiona ni despliega nada. El paquete `installation/apply-exact-version.sql` está separado del canónico, tiene hash propio y contiene exclusivamente sus cuatro reemplazos, un registro canónico y comprobaciones dentro de la misma transacción. No usa `supabase db push` ni arrastra otras migraciones.

El preflight y postflight separados son sólo lectura. El paquete falla y hace rollback completo si detecta drift, permisos inesperados, versión ya instalada o postflight incorrecto. La prueba inyecta deliberadamente un hash posterior erróneo y demuestra que se recuperan las cuatro definiciones originales y queda ausente la fila del ledger, sin tocar movimientos.

Si una comprobación externa posterior al commit falla: detener nuevas pruebas/escrituras de QA y cualquier despliegue, conservar sus resultados y pedir decisión del propietario. `installation/restore-original-functions.sql.txt` conserva los cuatro cuerpos reales para una reversión de funciones expresamente autorizada; no debe ejecutarse automáticamente, borrar movimientos ni eliminar historia de migraciones. Una eventual reversión debe quedar trazable en Git/ledger mediante este mismo trabajo autorizado. La nueva UI puede mostrar temporalmente abonos generales sin conciliación por nota.

La autorización futura debe identificar versión, SHA del canónico, SHA del paquete y el commit revisado de este mismo PR. La incorporación del canónico a Git/main corresponde a este único PR; no debe instalarse una variante manual ni dejar divergencias de historia. El workflow de migraciones existente requiere dispatch manual: no se invoca en esta tarea.

La emisión y el pull de eventos sí se probaron; la entrega Realtime real y el QA en Vercel Preview conectado a `odlrhijtfyavryeqivaa` desde computadora/Android **NO se ejecutaron**. Requieren instalación SQL autorizada y recorrido posterior del propietario. El abono histórico de $5 permanece intacto y no se reinterpretará, cancelará ni duplicará. No se declara terminada la funcionalidad ni QA manual PASS.
