**LANZO POS — asignaciones de abonos Cloud V2. Candidata local, sin instalar.**

Base de trabajo: `9c26743b4ffe64d93db4e573981aaa032310b2ea`. No se creó PR, commit, push, merge ni despliegue. No se ejecutó SQL en Production ni se modificó el abono piloto de $5. Las pruebas de Dexie usan IndexedDB simulado y aislado; no se borró IndexedDB del usuario.

1. Diseño mínimo y contratos comprobados.

`pos_sales.balance_due` conserva el fiado originado en checkout: los reportes `pos_get_reports_credit_overview` y la creación de ventas lo usan como importe histórico. El cargo ledger representa el total vendido y el PAYMENT inicial representa el anticipo. Se conservan `total`, `amount_paid`, `balance_due`, los pagos de checkout y los recibos anteriores.

El saldo vigente se deriva de las nuevas asignaciones financieras verificadas, guardadas en el `allocation_payload` existente con marcador de servidor `sale_allocation_version = 1`. No se crean tablas, motores ni funciones adicionales. Se añaden `original_balance_due`, `assigned_payments_total`, `current_balance_due` y `credit_allocation_status` a la lectura de ventas. La base histórica de cada nota se comprueba contra sus cargos y anticipos ledger del mismo tenant, cliente y venta. Una base inconsistente queda sin saldo vigente confiable y no admite asignación.

El abono general aplica FIFO (`sold_at`, desempate por ID) entre notas elegibles. El específico exige que la suma seleccionada coincida exactamente con el pago, sin duplicados, valores no finitos, centavos fraccionarios, ventas ajenas, canceladas o sobreasignadas. Las cantidades anteriores/posteriores del navegador no se utilizan. La deuda general se toma del ledger, sin recuperar una deuda positiva desde una caché cuando el ledger ya está saldado.

Se conserva el almacén de idempotencia y sus respuestas. El lock de cliente serializa pagos y ventas a crédito. La admisión de cancelaciones toma ese mismo lock antes del preview para evitar una carrera con el pago. El resumen V2 también mantiene ese lock durante la lectura de deuda, notas y proyección.

2. Migración y archivos afectados.

Migración canónica candidata: `20261106025114_customer_payment_sale_allocations_v1.sql`.

SHA-256: `a9ef3aa0add6f4f799b5185f09c88266f1892d674243a832eeff071eba7055fc`.

Sólo reemplaza estas cuatro funciones existentes; comprueba sus definiciones anteriores mediante SHA-256 antes de hacerlo:

- `private.pos_sale_to_jsonb(public.pos_sales)`.
- `public.pos_record_customer_payment_unlimited(text,text,text,text,text,numeric,text,text,text,jsonb,text)`.
- `public.pos_cancel_cloud_sale_unlimited(text,text,text,text,text,text,text)`.
- `public.pos_get_customer_credit_summary_v2(text,text,text,text,text,jsonb)`.

`pos_record_customer_payment_v2` mantiene su delegación existente. El resumen V2 conserva la delegación legacy y enriquece el resultado con `credit_sales` y `pending_credit_sales` financieros; no redefine el resumen legacy sin disponer de su fuente versionada. La migración no cambia RLS, grants ni propietarios. El laboratorio compara ACL, propietario y SECURITY DEFINER antes/después; los JSON adjuntos registran el resultado.

Aplicación: `customerCreditRepository.js`, `customerCreditMapper.js`, `customerMessaging/adapters.js`, `salesCloudMapper.js`, `salesCloudLocalRepository.js`, `CustomersPage.jsx`, `AbonoModal.jsx`, `PurchaseHistoryModal.jsx`, `SalesHistory.jsx`, junto con sus pruebas focalizadas. Los dos runners nuevos viven en `scripts/fin01/`.

El modal Cloud no recurre a notas locales cuando faltan saldos financieros confiables. Una lista autorizada vacía permanece vacía. Antes de enviar un pago específico se verifica la capacidad del servidor. Los comprobantes usan las asignaciones confirmadas por el servidor. El historial distingue fiado original, abonos y saldo vigente, e incluye notas del servidor aunque se hayan creado en otro dispositivo.

Las ventas afectadas incrementan versión y publican eventos `sale/update` existentes. La respuesta inmediata también aplica su proyección. La caché local actualiza saldos de ventas ya confirmadas y rechaza respuestas o recibos con una versión anterior.

3. Pagos históricos y cancelaciones.

Los PAYMENT anteriores sin marcador verificable se conservan íntegros, incluso si contienen una descripción de asignaciones. No se infieren ni se redistribuyen. En una cuenta con esos pagos, el saldo individual es `null` y se muestra «Sin conciliar por nota»; el abono general sigue reduciendo deuda, pero queda explícitamente sin asignación, y el específico se bloquea. Por tanto el caso piloto existente mantiene deuda general $15 y su nota no se presenta como conciliada automáticamente.

El remanente de un pago nuevo que cubre deuda general sin notas elegibles queda registrado como `unallocated_amount`; no se inventa una venta para absorberlo.

Se conserva el bloqueo existente de cancelaciones con abonos posteriores independientes. Una venta con asignaciones verificadas tampoco se cancela automáticamente, incluso si sus fechas históricas no permitirían detectarlo por orden temporal. No se agregan devoluciones. La cancelación ordinaria sin abonos posteriores sigue revirtiendo cargo/anticipo y Caja una sola vez. Habilitar devoluciones de ventas ya abonadas sería otro contrato financiero y queda fuera de esta corrección.

4. Pruebas y alcance de evidencia.

- PostgreSQL 17.6 real, exclusivamente loopback y datos sintéticos: **20/20** escenarios; detalle en `postgres-results.json`.
- Aplicación: **104/104** pruebas en 9 suites, incluidas regresiones Local, proyección Dexie, modal e historial. Contrato estático V2: **7/7**. ESLint focalizado y `git diff --check`: sin diagnósticos. `npm run build`: aprobado; conserva advertencias de patrones glob del precache. Las pruebas de aplicación no sustituyen evidencia financiera de PostgreSQL.
- Se cubren $20 − $5 = $15, FIFO de dos ventas, selección específica, reintento secuencial/concurrente, pagos concurrentes generales y sobre una sola nota con deuda global suficiente, rollback después de insertar ledger, identidades/estado inválidos, deuda no finita, base ledger inconsistente, cancelación de venta abonada sin devolución, cancelación ordinaria con anticipo, carrera pago/cancelación, preservación histórica y pull por un segundo dispositivo.
- Se ejecuta el RPC real `pos_record_customer_payment_v2` como `anon`, con admisión V2, contexto, rate limiting y envelope reales. Los núcleos internos rechazan acceso directo de `anon`.
- El cuerpo exacto de la consulta nueva de enriquecimiento de resumen se ejecuta en PostgreSQL. **No** se simula el delegado `pos_get_customer_credit_summary_unlimited`: su definición no aparece en las capturas del repositorio. La delegación completa de ese endpoint sigue pendiente de comprobación en el entorno autorizado.
- Los snapshots de esquema/autoridad/finanzas son los ya versionados. `fixture-boundaries.json` conserva las FKs externas omitidas y el doble heredado de transporte Realtime. No se certifica entrega por el servicio Realtime ni un recorrido real de Vercel.

Reproducción financiera, desde un clúster nuevo y desechable con PostgreSQL 17 escuchando sólo en `127.0.0.1:55847`, usuario `postgres`, trust local, y base vacía `fin01_cert_allocations`:

```sh
node scripts/fin01/prepare-sale-allocation-fixture.mjs --isolated-fixture
node scripts/fin01/run-sale-allocation-tests.mjs
```

Los runners fijan el endpoint local; no aceptan URLs ni credenciales de Production. `prepare` rechaza una base no vacía. Los archivos generados se escriben en `work/fixture/`.

5. Compatibilidad y estado para revisión.

Local no cambia. Cloud conserva el mismo propósito FIFO/específico, con validación financiera más estricta para los requests específicos que genera el modal. V2 mantiene su envelope, identidad, admisión, proyecciones e idempotencia; añade campos financieros y eventos de venta compatibles. No se reinterpretan recibos históricos como saldos actuales.

La corrección está agrupada para una única revisión/PR futura. No apareció un bloqueo estructural que requiera rediseñar el ledger; se conserva el rechazo seguro de cancelaciones abonadas. Existe la brecha de evidencia del delegado legacy de resumen indicada arriba. Esta candidata **no está certificada para instalar ni se declara funcionalidad terminada**.

Una instalación futura requiere autorización expresa del propietario con esta versión, hash y alcance exactos, y que el mismo trabajo autorizado deje la migración trazable en Git/main. Después, el propietario debe comprobar el recorrido real en Vercel Production/Preview, incluidas notas pendientes y sincronización. No se debe instalar una variante manual que deje divergencia entre el repositorio y Production.
