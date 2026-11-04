# PR370_DIRECTORY_BRIDGE_READY_FOR_PUBLICATION

Fecha: 2026-11-03. Candidato local, sin publicación ni merge del PR.

La integración conserva main `4b688b69a1ceb085042d5287726394019b824b8b` y el HEAD publicado de #370 `18d14fc9ae3ce5e619abd5cd948903da7d393622` como padres de un merge local normal. #376 está fusionado; #370 sigue Draft en GitHub. No se usó rebase ni force push. El worktree existente es `C:/dev/Lanzo-POS-fin01-r1`; su evidencia previa sin seguimiento se conservó.

## Resolución de los siete conflictos

| Archivo | Resolución |
| --- | --- |
| `src/components/customers/CustomerForm.jsx` | Formulario de #376 con teléfono obligatorio, validación monetaria y conciliación por campo; se conserva la confirmación FIN-01 para reducir el límite por debajo de la deuda. Cambiar la deuda observada invalida esa confirmación. |
| `src/services/customerCredit/customerCreditLocalRepository.js` | Guard de #376 antes de aplicar ledger Cloud, con las tablas de su transacción; se conserva la vista FIN-01 que evita sumar dos veces el historial representado por un recibo. |
| `src/services/customerCredit/customerCreditMigrationService.js` | Arranque protegido con `HISTORICAL_DEBT_PRESERVATION_REQUIRED`; se mantienen revisión, hash, autorización, status y consume explícitos. Se agrega la acción separada de preparación. |
| `src/services/customerCredit/historicalCreditSnapshot.js` | Se combina la detección de movimientos Locales e inconsistencias de #376 con snapshots y recibos FIN-01. Un recibo confirmado con importe intacto y sin movimientos nuevos no se reclasifica como actividad Local solo por conservar temporalmente `financialSource=local`. La actividad posterior sigue bloqueada. |
| `src/services/customers/customerLocalRepository.js` | Se mantienen guard histórico, versiones y borradores de #376. Solo una proyección de crédito tras recibo confirmado puede resolver el conflicto histórico, sin quitar conflictos de edición pendientes. Un ack ordinario de directorio no sustituye la deuda. |
| `src/services/customers/customerMapper.js` | Se mantienen íntegros los contratos de #376: versión Local nula cuando falta, versión Cloud positiva y validación monetaria antes de generar el payload ordinario. |
| `src/services/customers/customerMigrationService.js` | Se mantiene el bloqueo de #376 antes del RPC legacy y se conserva la preservación FIN-01 previa de snapshots. |

Los cambios ya aprobados de #376 se incorporan por historial, sin volver a implementarlos.

## Puente explícito de directorio

La revisión financiera detecta `CONFLICT_CUSTOMER_MISSING`. Solo entonces la UI ofrece **Preparar directorio Cloud faltante**, separada de **Autorizar e importar estos saldos**. El método exige revisión previa, permiso de Clientes, administrador vigente y contexto de propietario confirmado por FIN-01. También verifica licencia, tenant y capacidades actuales.

`historicalCreditDirectory.js` reutiliza `pullCustomerSnapshot` y `upsertCustomer`. Mapea el mismo ID mediante el mapper de #376 y envía solo nombre, teléfono validado y su clave derivada, dirección, límite, timestamps y los metadatos fijos del directorio. No envía deuda, ledger, pagos o Caja. No crea nuevas tablas, outbox, scheduler ni mecanismo de sincronización.

La solicitud se guarda en el `sync_cache` del tenant antes de enviarse, con payload e idempotencia estables. Una fila Cloud compatible se verifica sin escribirla; datos incompatibles, borrado, versión inválida o tenant distinto producen conflicto. Un reintento de red conserva el mismo payload y clave. Una respuesta de creación nunca se aplica como saldo cero sobre el cliente Local.

La creación usa **`expectedVersion: 0`**, sin fallback a null ni a la versión Cloud encontrada. Se verificó en Production, exclusivamente mediante lectura de catálogo, que el contrato instalado:

- acepta el ID original;
- crea con deuda y centavos en cero;
- comprueba una versión esperada no nula bajo lock antes de actualizar una fila existente;
- tiene `CHECK (server_version >= 1)` y PK global de ID.

Así se rechaza una fila que aparezca entre la lectura y la escritura; una inserción concurrente también queda protegida por unicidad. El contrato puede comunicar una colisión de ID como `DUPLICATE_PHONE`; la UI informa conflicto de teléfono o identificador y no intenta actualizarlo. No se requieren SQL ni permisos nuevos.

Hashes SHA-256 de las definiciones leídas:

- `pos_upsert_customer_unlimited`: `a49cf0ac6081aae29b64ef142376c2bf849010529114f84cbd859b040fb56b5b`.
- `pos_historical_credit_batch_v1`: `77bc0cdcfbcb4cfc58ea45fcb260e39c7ea81d179500fb611a6fb5ea1ac77486`.

La preparación invalida la revisión financiera anterior. Una nueva vista previa conserva el manifiesto y obtiene su hash del servidor. Los directorios preparados se vuelven a verificar antes de autorizar, para que una colisión o una respuesta incierta no se conviertan en permiso financiero. La importación se bloquea mientras falte el directorio y conserva el mecanismo de autorización y unicidad de FIN-01. No se llama a `migrateLocalCredit`.

Si el propietario abandona el flujo después de preparar, Cloud puede conservar el directorio con saldo cero; el saldo y los movimientos Locales permanecen preservados y sin autorización financiera.

## Pruebas y límites de la evidencia

**164/164 casos únicos PASS en 14 archivos, sin casos pendientes, exit 0.** El recorrido principal es **simulado**: Dexie y el esquema de tenant son reales, la API IndexedDB usa `fake-indexeddb`, y los contratos Cloud/financieros son dobles controlados. No constituye QA de navegador/dispositivo, ejecución real de las funciones PostgreSQL ni QA de Production.

El caso principal comprueba Local $10 con movimiento original → ausencia Cloud → bloqueo automático → preparación explícita con el mismo ID y saldo Cloud $0 → revisión/hash → autorización independiente → un solo `INITIAL_BALANCE` y proyección $10 → replay sin duplicación. Verifica el movimiento original intacto, snapshot preservado, cero movimientos de Caja y rechazo de un ack tardío de saldo cero.

Las regresiones cubren: cliente Cloud existente, Local sin deuda, respuesta perdida después de crear, respuesta perdida antes de llegar al servidor con reuso de idempotencia, reapertura, colisiones de identidad/tenant/versión/borrado, carrera de ID, pull y ack durante preparación, sesión y permisos, alta/edición Cloud normal, límite y formulario de #376. Los 40 casos de la repetición previa de dos archivos están incluidos en los 164; no se suman como casos distintos.

Comando final:

```powershell
node node_modules/vitest/vitest.mjs run src/services/customerCredit/__tests__ src/services/customers/__tests__ src/components/customers/__tests__/HistoricalCreditImport.test.jsx src/components/customers/__tests__/CustomerForm.phoneRequired.test.jsx src/components/common/__tests__/QuickAddCustomerModal.test.jsx src/components/common/__tests__/PaymentModal.test.jsx src/services/db/__tests__/customerCreditRepository.test.js src/services/db/__tests__/customerCreditRepository.autoHealLifecycle.test.js src/services/sync/__tests__/syncConstants.fin01Gate.test.js --pool=threads --maxWorkers=1 --reporter=json --outputFile=.tmp/pr370-directory-bridge/focused-final.json
```

- Instalación reproducible: `npm ci --ignore-scripts`, Node 24.18.1, Vitest 4.1.12 y Vite 7.3.7 del lockfile. Sin cambios de dependencias o lockfile.
- ESLint final: 15 archivos, **0 errores / 0 advertencias**, exit 0.
- `vite build --mode preview`: **PASS**, exit 0; build repetido después del último cambio de código. Hay advertencias de tamaño de chunks y globs sin coincidencia, sin errores de compilación.
- `admin-startup-precache-audit.mjs`: **PASS**, 24 assets de arranque verificados. No demuestra funcionamiento offline físico.
- React Doctor: **77/100, 21 advertencias, exit 0**, sobre archivos cambiados. Los awaits secuenciales conservan el orden y los checks de contexto; el reset de confirmación al cambiar la deuda es intencional y está probado. Las advertencias de complejidad/tamaño, formatter y callbacks no se usaron para iniciar una limpieza general ni se suprimieron.

Se conserva la evidencia negativa: reproducción previa al puente con método ausente; intentos iniciales con mock de actor incompleto; primera corrida con 115 PASS, 2 FAIL y 5 errores de arranque de workers. Los dos fallos eran fixtures: identidad de licencia distinta del tenant sintético y expectativa de fiado/vencimiento para una venta ya liquidada tras integrar #376. Se corrigieron los fixtures, manteniendo las comprobaciones de saldo parcial y de pago completo; no se cambió lógica financiera para satisfacerlos. La corrida serial final pasó completa. Los timeouts no se cuentan como PASS.

Raw logs y JSON permanecen localmente en `C:/dev/Lanzo-POS-fin01-r1/.tmp/pr370-directory-bridge/`. `validation-summary.json` registra la selección final y hashes de evidencia.

## Archivos de implementación y pruebas

Además de los siete archivos de conflicto anteriores, se modificaron/agregaron:

- `src/services/customerCredit/historicalCreditDirectory.js` — puente y verificación de directorios preparados.
- `src/components/customers/HistoricalCreditImport.jsx` — acción separada, bloqueo previo a preparación y mensajes de conflicto.
- `src/services/customerCredit/__tests__/historicalCreditDirectoryBridge.test.js` — 14 casos del puente y sus límites.
- `src/services/customerCredit/__tests__/historicalCreditCloudApply.test.js` — fixtures con versiones Cloud válidas y expectativas de preservación de #376.
- `src/services/customerCredit/__tests__/historicalCreditMigration.workflow.test.js` — guard de arranque vigente y mock de actor compatible con la integración.
- `src/components/customers/__tests__/HistoricalCreditImport.test.jsx` — acción explícita y confirmación financiera independiente.
- `src/components/customers/__tests__/CustomerForm.phoneRequired.test.jsx` — confirmación de reducción e invalidación al cambiar la deuda observada.
- `src/components/common/__tests__/PaymentModal.test.jsx` — expectativa reconciliada de vencimiento para saldo parcial y pago completo sin deuda nueva.

La lista completa del diferencial de integración, incluidos archivos heredados de #376 y este informe, está en `validation-summary.json`.

## Alcance operativo y siguiente acción

**SQL nuevo/modificado en esta iteración: ninguno.** No se reinstaló FIN-01 F, no se ejecutó `db push`, no se escribieron datos Productivos ni se cambiaron licencias, capacidades o dispositivos. Las consultas Production solo leyeron definiciones, restricciones y metadatos de columnas. No se tocaron los datos del navegador o dispositivo del propietario.

No se hizo push, merge del PR, otro PR ni despliegue manual. Tío Antonio no fue usado para QA. Las referencias remotas se revalidaron antes de cerrar y permanecían en los SHAs iniciales.

Siguiente acción: el propietario revisa el diferencial y autoriza, por separado, el push normal del commit local a la rama existente de #370. Después se fija un único Preview del SHA publicado. La deuda de prueba debe crearse y migrarse en ese mismo origen, navegador y dispositivo. El cambio de licencia/capacidades y la importación real requieren las autorizaciones posteriores previstas; este candidato no las ejecuta ni las certifica.
