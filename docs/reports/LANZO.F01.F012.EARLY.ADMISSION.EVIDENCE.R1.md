# LANZO POS — F01-2 — EARLY ADMISSION EVIDENCE R1

Fecha: 23 de octubre de 2026, America/Mexico_City. **HOLD_RECOVERY_INTEGRATION**. Referencia: el informe Implementation R1 de esta carpeta.

## Procedencia y conservación

Main inicial `52bb573e651529b323b6617e3161cd76ece14a39`; #372 OPEN/Draft `f1d69093ffe3ad180752773c178b7fbaefd92ce1`. Rama propia `feat/f01-early-admission-recovery-r1`, base PR `feat/f01-single-instance-coordinator-r1`. HEAD de entrega, PR, CI/Preview y verificación final remota quedan en el cuerpo del PR y remote-publication.json, separados de los hashes de estos archivos. Sin merge ni retarget ni Ready for Review.

Se leyeron los seis antecedentes identificados desde sus archivos vigentes y los dos informes F01-1 del repositorio. No se asumió publicación de sus ramas locales. IDs documentales consultados: Audit `libfile_146422c9ff408191905dc6130fa0d4e2`; Audit Evidence `libfile_5c5b58fe34308191a8b8f500bb7ce449`; Design `libfile_5d2292a72e588191a41b3bb8a3d65d63`; Design Evidence `libfile_681b35b690888191b9508a253c1b99ab`; F010 Decisions `libfile_8117722f36f88191a07cef580e880365`; F010 Evidence `libfile_e21477e05bc88191855a960f2c0d1408`. Estos son antecedentes, no tests nuevos ni producto activo.

Clon nuevo, sin AGENTS.md aplicable. Base diferencial separada y detached en el mismo #372. Node 24, React/React DOM 19.2.0, Vitest 4.0.14, Dexie/fake-indexeddb según package-lock sin editar, Chromium 143.0.7499.0 externo. Dependencias instaladas con npm ci --ignore-scripts. Sin Docker. Perfiles Chromium y bases fake-IDB efímeros; no se usa el perfil ni IndexedDB del propietario. No se instala software en su equipo.

## Resultados nuevos

Todos los paths de datos son relativos a `scripts/qa/single-instance-f012/evidence/`. Los JSON voluminosos se conservan losslessly como .json.gz; descomprimir con gzip -dc. Los runners regeneran JSON plano. No se suman repeticiones ni observaciones de categorías diferentes.

| Artefacto | Resultado | Interpretación |
| --- | --- | --- |
| probes.json | 5 assertions PASS, 0 FAIL | Reproducción de límites; NO cinco garantías de seguridad aprobadas |
| financial-traces.json | 4 COUNTEREXAMPLE + control RECOVERY-PRESERVED PASS | Timeout, ledger, inventario y recovery real; política receipt-first preservada |
| bootstrap-trace.json | CE-BOOT-01 COUNTEREXAMPLE | Bootstrap real, proveedores sintéticos: 2 restores secuenciales y 2 background tasks pendientes |
| chromium.json | 1 COUNTEREXAMPLE + 1 control PASS; 0 pageerrors | Web Locks/coordinador/timeout reales, transporte diferido sintético |
| browser-bundle-inputs.json | Sólo fixture, coordinador/protocolo/capacidades y timeout | No App, auth, tenant, ledger o conexión Supabase en este browser harness |
| coordinator-unit.json | 45/45 PASS | Tests F01-1 reejecutados; no nueva integración |
| f011-browser/chromium.json | 38 PASS / 1 COUNTEREXAMPLE / 1 PARTIAL; 0 pageerrors | Fundación reejecutada sin cambiar su runner; sólo salida redirigida |
| regression/regressions.json | 831: 827 PASS / 4 FAIL, exit 1 | Candidata, suite focal amplia |
| base/regressions.json | 831: 827 PASS / mismos 4 FAIL, exit 1 | Nueva ejecución baseline #372 |
| baseline-comparison.json | Estados y primer mensaje de fallo idénticos; 0 fallos nuevos | Diferencial focal, NO PR127 global |
| import-graph.json | 87 estáticos / 866 con dinámicos literales | Grafo anterior=posterior; coordinador inerte, no alcanzable desde main |
| preserved-source-hashes.json | 2.059 blobs iguales a #372 | Producto, configuración, SQL y workflows intactos |
| coordinator-source-hashes.json | SHA-256 de las tres fuentes F01-1 | Sin reescritura |
| build-production.json | 53 archivos, 24 assets iniciales, 0 faltantes/violaciones | Build local; sin despliegue en producción |
| build-preview.json | 67 archivos, 32 assets iniciales, 0 faltantes/violaciones | Build Preview local, no QA funcional de un gate |
| build-store.json | 11 archivos, 0 violaciones | Tienda independiente compilada |
| production/preview/store/store-vercel.log.gz | exit 0 | Cuatro variantes ejecutadas |
| lint.log.gz | exit 0 | Sin diagnósticos de código; aviso tooling baseline-browser-mapping |
| remote-preflight.json | HEAD/base y archivos de los cinco PR abiertos | Inspección, no compatibilidad certificada |
| artifact-hashes.json | SHA-256 de scripts, informes y evidencia, excluido sí mismo | Evidencia reproducible |

Las cinco assertions nuevas son CE-DRAIN-01, CE-DRAIN-02 (incluye RECOVERY-PRESERVED), CE-INVENTORY-01, CE-RECOVERY-04 y CE-BOOT-01. Su exit 0 significa que reprodujeron el comportamiento descrito. Las garantías refutadas siguen COUNTEREXAMPLE.

## Traza crítica y límites

CE-RECOVERY-04 usa `recoverFinancialIntent`, ledger, canonicalización, classifier, timeout y leases/transacciones reales, con Dexie real sobre fake-indexeddb. Proveedor de DB, handle de actor, contexto auth y RPC son sintéticos. PREPARED/0 → receipt NOT_FOUND → primer execute legítimo → timeout real 35s → receipt PROCESSING → PENDING_RECEIPT/dispatchAttemptCount=1/lease=null. En ese instante nativeActive=1. Se resuelve después el execute sintético; la fila permanece pendiente. No se realizó ni certificó un commit de servidor, doble venta, autenticación comercial o proyección E2E.

CE-DRAIN-02 usa override soportado DISPATCH_MS=30 para una repetición rápida y completa receipt-first posterior con COMPLETED. Compara ID/K/hash/origen original y executeCount=1. La prueba larga mantiene 35.000 ms de producción sin timers ni Date simulados; usa leaseMs=120.000 existente para no confundir timeout con lease expiry. No extrapolar ese lease de laboratorio al default comercial ni modificar el default.

El browser contrasta composición ingenua y propuesta, con dos documentos del mismo contexto/origen y recurso nativo estable. Al timeout la ingenua ve pendingExecutors=0/nativeActive=true; A libera y B adquiere. El control registra raw antes de iniciar y conserva pendingExecutors=1, A QUIESCING/nativeHeld=true y B SECONDARY hasta settlement. Native work es una promesa sintética. No es integración con el ledger de navegador ni petición de cobro.

CE-INVENTORY-01 inserta 60 pendientes del actor, BLOCKED, CONFLICT y otro actor: total63, consulta ordinaria retorna50, filas intactas. No implementa inventario paginado ni justifica apropiarse de las excluidas. CE-BOOT-01 sustituye Auth/tenant/storage/profile y bridge; prueba flujo de orquestación del bootstrap real, no política Staff. Los módulos Auth reales se cubren por regresiones independientes.

El hallazgo no demuestra imposibilidad: retención del lock por todo el documento o un registro explícito de raw lifecycle requieren diseño/validación. Sí refuta usar settlement público como evidencia de drenaje completo. La elección de detener la activación evita certificar ese supuesto.

## Regresión y fallos históricos

La selección exacta está en regression/selectors.json y base/selectors.json. Incluye Auth/Actor Runtime/Storage/M-01/F-02/Admin Offline, tenant/DB/Dexie, PWA/SW, bootstrap, Staff UI, finanzas, handoff y outbox. No es suite global completa ni todos los callers financieros. Base y candidata comparten fuentes byte a byte; ambos runs nuevos tienen 831 assertions, 827 PASS, mismos cuatro FAIL:

1. restaurantOrderCheckoutClose — saves pending split close when offline: esperaba1, recibió0.
2. saves pending split close when repository returns failure: esperaba1, recibió0.
3. retries pending split close without losing paymentSummary: closed1 frente a0.
4. does not evict legacy rows when adding a new tenant-scoped retry: 52 frente a51.

No se cambiaron aserciones, thresholds o contratos; exit1 preservado. Los 99 fallos compartidos del PR127 de F01-1 siguen siendo antecedentes, no resueltos aquí ni intercambiables con estos cuatro de la selección focal.

## Matriz F012-01..55 — aceptación integrada pendiente

**Todas las filas siguientes están NOT_TESTED como escenarios de F01-2 integrada.** No existe entrada/shell/bootstrap restringido activo que certificar. Las pruebas de módulos/fundación arriba no sustituyen esta matriz. Se prepara para la implementación posterior, no para pedir cobros manuales ahora.

| ID | Escenario de aceptación | Estado |
| --- | --- | --- |
| F012-01 | Pestaña única | NOT_TESTED |
| F012-02 | Dos pestañas secuenciales | NOT_TESTED |
| F012-03 | Apertura simultánea | NOT_TESTED |
| F012-04 | Tercera pestaña | NOT_TESTED |
| F012-05 | Cinco pestañas | NOT_TESTED |
| F012-06 | Recarga | NOT_TESTED |
| F012-07 | Cierre | NOT_TESTED |
| F012-08 | Crash | NOT_TESTED |
| F012-09 | Suspensión | NOT_TESTED |
| F012-10 | Reanudación | NOT_TESTED |
| F012-11 | Import mínimo | NOT_TESTED |
| F012-12 | Cero módulos comerciales secundarios | NOT_TESTED |
| F012-13 | Import dinámico después del lock | NOT_TESTED |
| F012-14 | Import pendiente | NOT_TESTED |
| F012-15 | Pérdida de ticket | NOT_TESTED |
| F012-16 | StrictMode | NOT_TESTED |
| F012-17 | Bootstrap único | NOT_TESTED |
| F012-18 | Sin sync prematuro | NOT_TESTED |
| F012-19 | Sin autoheal prematuro | NOT_TESTED |
| F012-20 | Tienda independiente | NOT_TESTED |
| F012-21 | Admin vigente | NOT_TESTED |
| F012-22 | Admin vencido | NOT_TESTED |
| F012-23 | Admin offline | NOT_TESTED |
| F012-24 | Staff online | NOT_TESTED |
| F012-25 | Staff offline denegado | NOT_TESTED |
| F012-26 | Cambio de actor | NOT_TESTED |
| F012-27 | Cambio de tenant | NOT_TESTED |
| F012-28 | Handoff | NOT_TESTED |
| F012-29 | M-01 | NOT_TESTED |
| F012-30 | F-02 | NOT_TESTED |
| F012-31 | Sin pendientes | NOT_TESTED |
| F012-32 | PREPARED sin intentos | NOT_TESTED |
| F012-33 | PREPARED con intentos | NOT_TESTED |
| F012-34 | PROCESSING | NOT_TESTED |
| F012-35 | PENDING_RECEIPT | NOT_TESTED |
| F012-36 | COMPLETED | NOT_TESTED |
| F012-37 | CONFLICT | NOT_TESTED |
| F012-38 | BLOCKED | NOT_TESTED |
| F012-39 | Receipt inaccesible | NOT_TESTED |
| F012-40 | Proyección pendiente | NOT_TESTED |
| F012-41 | Outbox | NOT_TESTED |
| F012-42 | Checkout ambiguo | NOT_TESTED |
| F012-43 | Handoff pendiente | NOT_TESTED |
| F012-44 | Otro actor | NOT_TESTED |
| F012-45 | Otro tenant | NOT_TESTED |
| F012-46 | Sin BroadcastChannel | NOT_TESTED |
| F012-47 | BroadcastChannel denegado | NOT_TESTED |
| F012-48 | Sin Web Locks | NOT_TESTED |
| F012-49 | Web Locks denegado | NOT_TESTED |
| F012-50 | HTTP por IP | NOT_TESTED |
| F012-51 | HTTPS | NOT_TESTED |
| F012-52 | Offline | NOT_TESTED |
| F012-53 | Service Worker anterior | NOT_TESTED |
| F012-54 | Legacy | NOT_TESTED |
| F012-55 | Recuperación después de crash | NOT_TESTED |

Callbacks tardíos, tareas nativas tras timeout/cancelación y drenaje tienen los contraejemplos adicionales detallados. BFCache, PWA Windows/Android, hibernación física, navegador Edge y teclado móvil real permanecen NOT_TESTED. La fundación sí ensaya StrictMode/import pendiente/pausa nativa en su alcance propio; no convertirlos en PASS de App integrada.

## Comandos y verificación

README del laboratorio contiene comandos completos. Ejecutados: npm ci; Vitest probes; 45 unitarios; browser nuevo; rerun-foundation-browser; run-regressions en candidata y base #372; inspect; ESLint focal; npm run build; VERCEL_ENV=preview npm run build; npm run build:store; npm run build:store:vercel; audit-build para production/preview/store; git diff --check. `inspect.mjs` comprueba la ausencia del coordinador en el arranque porque el gate NO se activó, no porque exista admisión temprana.

Los cuatro builds no necesitan credenciales para compilar. No se abre la aplicación contra Supabase. coreLocalRouteAssets=[] es literal del auditor existente: no se infiere arranque frío offline completo. Los marcadores F011/F012 no aparecen en assets/precache; los fixtures quedan sólo bajo scripts/qa. Build Production se repitió para obtener un snapshot de artefactos después de haber compilado Preview; no se suman ambas compilaciones como validaciones diferentes.

La primera ejecución del auditor F01-1 escribió su salida Preview en su carpeta histórica. Se redirigió el auditor nuevo a F012 y se retiró exclusivamente el JSON generado; el inventario F01-1 conserva sus blobs. No hubo cambio de fuente de producto. No fallaron las nuevas assertions ni se ajustaron para esconder una regresión.

CI remota se consulta sobre SHA exacto: PR127/Actor Runtime/ScopedStorage/Dexie no se presumen disparados, porque base apilada y diff docs/scripts quedan fuera de filtros. NOT_TRIGGERED o PENDING nunca equivalen a PASS. Si una Preview automática queda READY, contiene el POS actual sin gate F01-2 ni laboratorio nuevo; no se presenta como funcionalidad integrada ni QA manual aprobada. Estado exacto al cierre en publicación/PR.

## QA futura del propietario

No se requiere QA financiera sobre esta Preview para cerrar el hallazgo. Revisar primero CE-RECOVERY-04 y CE-NATIVE-DRAIN-03 y la alternativa de lifetime. Después de implementar el gate, ejecutar en Preview HTTPS identificada:

| QA | Preparación y pasos | Aceptación |
| --- | --- | --- |
| OWNER-01 | Perfil de pruebas sin pendiente incierto; abrir A/B/C del mismo host/navegador | Una admitida; secundarias con cero evaluaciones/restores/DB/sync/autoheal según instrumentación, no sólo aviso |
| OWNER-02 | Sin operación pendiente: reload/cerrar A, luego suspensión y reanudación | Cola nativa, sin takeover; una sola recuperación; vencimiento F-02 antes de remoto |
| OWNER-03 | Fixtures sintéticos de los 15 estados financieros y más de50 intents | Inventario estable completo; identidad conservada; receipt-first y restricciones por contrato; outbox no genera bloqueo global automático |
| OWNER-04 | Admin vigente/vencido/offline y Staff online/offline | Admin máximo168h y demás plazos; Staff denegado offline; ningún permiso por lock |
| OWNER-05 | 320/360/375/390px, tablet/escritorio, horizontal, zoom, teclado y lector | Shell sin navbar, scroll/foco/safe-area accesibles; acciones reales |
| OWNER-06 | Abrir ruta HTTP LAN actual de segunda laptop/teléfono, sólo diagnóstico | Registrar APIs y restricción futura; no instalar certificados ni cambiar flags; Preview HTTPS como QA principal |
| OWNER-07 | PWA/JS/SW antiguo y cliente nuevo en entorno controlado, sin cobros | Conservar contraejemplo legacy; no exigir actualización/cierre forzoso ni borrar almacenamiento |
| OWNER-08 | Documentos con tareas/transportes sintéticos pendientes; solicitar quiesce y cancelación | Lock retenido hasta finalización real, no promesa pública; native work incierto nunca equivale a cero |

Detener QA ante actor/tenant incorrecto, resultado incierto o doble UI operativa inesperada; conservar datos y no repetir cobro. No alterar reloj, liberar dispositivos, cerrar cajas ni limpiar IndexedDB para simular recuperación. Configuración HTTPS LAN requiere una tarea/autorización aparte.

## Rollout, rollback y cierre

Rollout HOLD: no gate activo ni integración comercial lista. No fallback BC-only, backend alternativo remoto, timeout de takeover ni nombre nuevo del recurso. Legacy y LC13 continúan abiertos. Rollback actual verificable: retirar solamente docs/scripts añadidos y comprobar diff comercial vacío. Para rollback futuro activo: drenar propios, preservar intents/receipts/outbox/SALES/checkout/origen, resolver ambigüedad por receipt; finalizar legítimamente documentos anteriores, conservar assets Local y repetir QA offline. Nunca revertir esquema ni borrar datos. La versión antigua restaura limitaciones conocidas del hook y no termina JS ya abierto.

Supabase calls/production writes NONE; migraciones NONE; operaciones financieras reales NONE; licencias/dispositivos NO; IndexedDB del propietario NO UTILIZADO; main NO MODIFICADO; #372 NO MODIFICADO; otros PR NO MODIFICADOS; certificados/ajustes NO; merge NOT PERFORMED. **HOLD_RECOVERY_INTEGRATION**, no READY_FOR_OWNER_QA.
