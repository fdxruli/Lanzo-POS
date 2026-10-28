# FIN-01 — Implementación y evidencia de Mini-fase 2.2R

Los logs originales y SQL de fixture están empaquetados sin alterar en `raw-evidence.zip`; extraer en esta carpeta dentro de una copia nueva para reproducir. Los JSON, fallos incluidos, están disponibles sin comprimir.

Evidencia de validación local previa a publicación. Los metadatos de commit, Draft, CI y Preview constan en la descripción del PR y en el reporte final entregado al propietario. No autoriza merge ni despliegue SQL.

## Seguridad e importación autorizada

La aprobación actual del propietario autoriza los saldos declarados. El hash no acredita que Dexie fuera históricamente inalterado.

La RPC `pos_historical_credit_batch_v1` reutiliza `private.validate_pos_sync_context` y `private.require_active_admin_session`; comprueba `license_admin_users.is_owner`, actividad, tenant, dispositivo y sesión vigentes. Un Admin no propietario no adquiere esta autoridad. Staff con permiso de clientes tampoco. Se retienen y vuelven a comprobar bajo bloqueo los vínculos de la autorización. La visibilidad del botón no sustituye estas comprobaciones SQL.

El manifiesto v1 incluye tenant, UUID estable de fuente, UUID de lote, cliente de origen y destino, importes enteros positivos en centavos, cantidad y total. Se rechazan campos desconocidos, duplicados, fracciones, rangos fuera de integer, tenant ajeno y totales inconsistentes. El servidor normaliza identificadores y ordena destinos con collation C; calcula SHA-256 sobre JSONB canónico. El contenido canónico excluye `batch_id`: cambiarlo no constituye otra deuda. Límites: 500 clientes y 1 MiB por lote; cada importe debe caber en integer. El total se almacena como bigint.

`preview` solo inspecciona. `authorize` exige confirmación explícita y persiste manifiesto/hash, propietario, sesión, aprobación, vigencia, resultados y auditoría. La vigencia pendiente no supera 24 horas ni el vencimiento de sesión. Un propietario con nueva sesión debe revisar y aprobar explícitamente de nuevo; reintentar no renueva la aprobación. La caducidad no invalida recibos consumidos. `status` puede recuperar por contenido la respuesta de aprobación perdida, incluso antes de que el navegador conozca el UUID de autorización.

El consumo exige manifiesto exacto, autorización y sesión correspondientes. Un advisory lock por tenant y bloqueos ordenados de clientes serializan la importación. Las unicidades `(tenant, cliente destino)` y `(tenant, fuente, cliente origen)` impiden duplicar cambiando lote, dispositivo o mapeo. Solo un recibo previo con identidad e importe exactos permite reconocer importación idéntica. Cualquier ledger Cloud previo sin esa identidad, incluso con saldo cero, produce conflicto visible; no se suma ni sobrescribe. Una diferencia de importe genera conflicto específico.

Cada saldo admitido crea INITIAL_BALANCE, proyección, recibo y eventos de auditoría dentro de la misma transacción. No crea ventas, pagos, Caja ni inventario. Los resultados parciales conservan conflictos y no informan éxito financiero global. La API legacy conserva su firma y devuelve PENDING_AUTHORIZATION sin modificar deuda. No hay flag de bypass.

## Integridad Local, Dexie y recuperación

Se utiliza el store tenant-owned `sync_cache`, sin versión nueva ni reconstrucción de Dexie. `historicalCreditSnapshot` conserva importe exacto, identidad, fuente estable, tenant, nombre de base, referencias, registro original con estado de sincronización y movimientos originales del ledger. Los datos son durables contra sobrescritura accidental; el dueño del dispositivo puede modificar almacenamiento local.

La migración de directorio preserva antes de su primera petición Cloud, también al reanudar checkpoints antiguos. `applyCloudCustomer` crea snapshot y aplica directorio en una transacción Dexie compartida: un fallo revierte ambos. Nombre/teléfono/dirección pueden actualizarse mientras el saldo pendiente permanece local. La proyección Cloud sustituye saldo solo cuando existe confirmación compatible o un checkpoint Cloud reconocido. Los clientes de versiones anteriores con proyección legítima sincronizada se archivan como CLOUD_PROJECTION, evitando importarlos otra vez o congelar su sincronización habitual.

Los escritores Local de ventas y abonos marcan su origen. Actividad Local posterior a una importación/proyección confirmada queda como CONFLICT_LOCAL_ACTIVITY; se conservan tanto el original como los datos posteriores. Un recibo Cloud no descarta esa actividad ni informa éxito local global. La captura original nunca se reemplaza por un error, retry o conflicto.

Después de un recibo confirmado, el INITIAL_BALANCE Cloud representa los movimientos Local capturados. `historicalCreditLedgerView` evita sumarlos otra vez al conciliar o mostrar el ledger activo. Los originales permanecen físicamente en Dexie y en el snapshot. Los movimientos Local posteriores permanecen activos. Si la respuesta de consumo llega antes de descargar el ledger Cloud, la conciliación utiliza el importe confirmado como base, sin inventar asientos ni depender de red. Una conciliación exclusivamente Cloud conserva ese origen y no inventa un conflicto Local. Se probaron ambas secuencias con Dexie real; un snapshot confirmado antiguo sin identidades preservadas exige revisión en lugar de inferir qué movimientos descartar.

El lote se persiste antes de autorizar; un timeout se registra como estado incierto. `resumeImport` consulta primero estado, reconoce confirmaciones previas y conserva identidad idempotente. Cada respuesta se valida frente a cliente, origen, importe y ledger; CONSUMED requiere todos los recibos. Un cambio de generación/actor descarta la respuesta antes de persistir en otro contexto. Un lote consumido se archiva de forma durable antes de preparar el siguiente grupo de clientes pendientes, que requiere otra revisión y aprobación. Los conflictos no se limpian ni se reintentan automáticamente.

El arranque/reconexión solo preserva y cuenta pendientes. No autoriza, importa ni marca la migración financiera completa por haber sincronizado directorio. No se borra ni altera el outbox existente. Las operaciones Local no migradas permanecen disponibles; su reconciliación financiera ante un conflicto posterior requiere revisión. `getPreservedBalance` permite recuperar el importe original sin crear automáticamente otro asiento ni reemplazar el saldo actual. Restauración física integral de backup: NOT_TESTED.

## Crédito e integridad Cloud

El upsert ordinario crea deuda cero. Para clientes nuevos, payloads antiguos con deuda positiva/malformada se rechazan antes de devolver una proyección cero que pudiera pisar historial Local. El mapper actualizado omite campos financieros. Editar directorio conserva deuda Cloud. Modificar límite exige autoridad efectiva de propietario; Staff no obtiene autoridad financiera por poder editar clientes.

El leaf compartido `pos_create_cloud_sale_credit_legacy_r2b` conserva firmas, ACL y replay anterior al nuevo guard. Bajo bloqueo del cliente calcula saldo canónico y deuda neta de total comercial y pagos efectivamente aplicados. Usa centavos exactos y valida rangos/valores finitos antes del cast. Límite cero bloquea exposición positiva; igualdad exacta se permite; sobrelímite genera CREDIT_LIMIT_EXCEEDED antes de folio, venta, ledger, Caja o inventario. El efectivo recibido y el cambio no se cuentan como pago aplicado adicional.

Las deudas antiguas, incluso superiores al límite, permanecen íntegras. Se comprobaron abonos y cancelación autorizada con funciones reales después de reducir límite a cero. Un replay confirmado devuelve su recibo aunque el límite se haya reducido. La UX muestra advertencia y exige confirmación al reducir límite individual bajo saldo. El cambio global advierte que mantiene deuda y bloquea nuevos cargos. Una operación Fiado completamente pagada se envía por la ruta pagada, sin exposición nueva ni exigencia de fecha de crédito. Apartados conserva su contrato.

El mensaje remoto de límite es comprensible y utiliza el manejo existente de error/reintento que conserva borrador. La prueba PostgreSQL demuestra rechazo sin efectos; los tests frontend demuestran presentación/mapeo, no atomicidad remota.

## SQL, permisos y despliegue futuro

Migración: `20261022135915_fin01_historical_credit_owner_authorization.sql`, generada mediante Supabase CLI local 2.51.0. El timestamp inicial 20261022060113 se actualizó con `migration new` tras avanzar el máximo remoto por otra tarea; el SQL funcional se conserva. Máximo del repositorio base: 20261008180000. Máximo Production inicial observado: 20261021062854; revalidación posterior: 20261022135736, limpieza QA Ecommerce ajena a FIN-01. Las cinco dependencias financieras/de autoridad mantuvieron sus hashes.

Una sola transacción forward-only crea dos tablas privadas de autorizaciones/recibos, un canonicalizador privado y una RPC pública POS autenticada internamente; sustituye tres funciones existentes preservando sus firmas. Las precondiciones MD5 de los cinco contratos abortan con FIN01_DEPENDENCY_DRIFT ante cambios no revisados. No aplica ni repara migraciones anteriores.

Las tablas pertenecen a postgres, tienen RLS activa y carecen de grants a PUBLIC/anon/authenticated/service_role. El canonicalizador no es SECURITY DEFINER y no admite ejecución de clientes. La RPC nueva es SECURITY DEFINER, `search_path=''`, con timeouts acotados; PUBLIC no recibe EXECUTE y anon/authenticated reciben únicamente el contrato POS que autentica propietario/tenant/sesión en backend. Las tres funciones internas reemplazadas siguen sin EXECUTE para anon/authenticated. No se guarda token ni secreto en autorizaciones. Verificación de catálogo y pruebas reales de permisos en `fin01-r22/final-function-parity.json` y reportes PostgreSQL.

El rollback de una excepción revierte asientos/proyecciones/recibos de esa transacción; no se presenta como constancia persistida lo que fue revertido. Después de importar deuda real, un rollback operativo no debe eliminar asientos ni recibos: requiere una corrección forward-only revisada. No se ejecutó rollback remoto.

Drift histórico conservado: Atomic Settlement Git #338 20261006181758 / Production 20261006224032; Origin Cancel Git #338 20261008013643 / Production 20261008030859. No se hizo migration repair ni se reejecutaron versiones históricas.

Procedimiento futuro, sujeto a autorización separada:

1. Fijar SHA aprobado y revalidar hashes, ACL/RLS, ledger remoto y dependencias. Si hay drift, detener y revisar; no omitir las precondiciones.
2. Ensayar en staging aislado la migración exacta, restauración de backup y recuperación de dispositivos. Inventariar frontends antiguos: la importación automática legacy quedará bloqueada y los clientes nuevos con deuda declarada exigirán actualización.
3. Preparar backup verificable y ventana de aplicación selectiva de esta única versión. Resolver explícitamente diferencias del ledger histórico; no usar db push indiscriminado.
4. Aplicar solo tras aprobación de despliegue independiente, confirmar objetos/grants/hash y máxima versión. No generar ventas ni abonos de validación en datos operativos.
5. Publicar frontend compatible con preservación antes de habilitar importación; exigir revisión individual del propietario. Monitorizar conflictos y conservar snapshots. Si se revierte frontend, mantener protección SQL y recibos; no reabrir el import legacy.

El workflow `supabase-production-migrations.yml` solo admite workflow_dispatch, exige main exacto, versiones exactas y confirmación APPLY; push/pull_request no lo invocan. Los workflows del diff no cambian. Ninguno de los comandos ejecutados por esta tarea fue db push, repair ni un RPC financiero remoto.

## Evidencia PostgreSQL 17 y límites

Se utilizó PostgreSQL nativo 17.11, exclusivamente loopback 127.0.0.1:55847 y datos sintéticos. Production usa 17.6: se certifica la major 17 en este fixture, no equivalencia de patch ni entorno completo de Supabase/PostgREST. No se utilizó Docker ni filas personales de Production.

El fixture contiene las funciones capturadas reales de contexto, propietario, autorización comercial, precios/pagos, leaf financiero, ledger, Caja, inventario, abonos y cancelaciones. El único transporte externo reemplazado es `realtime.send`, sin efectos financieros. Se omitieron FKs a tablas externas no incluidas; el inventario exacto está en `fixture-boundaries.json`. Las funciones de seguridad/finanzas no son mocks. Baseline real reprodujo deuda 800 + 300 = 1100 con límite 1000 antes del fix.

La ejecución final completa aprobó 61/61 escenarios SQL, y una instalación nueva de la migración íntegra en `fin01_cert_release` repitió 61/61. Son 61 casos distintos, no 122. La paridad exacta de los cinco cuerpos de función se verificó sobre esa instalación nueva. La prueba de locks inversos induce un deadlock con dos sesiones: exactamente una transacción sobrevive, la otra revierte sin efectos parciales y su retry rechaza el exceso de crédito. Esto demuestra rollback/reintento seguro de ese caso; no demuestra ausencia general de deadlocks ni prueba el dispatcher padre #338.

La corrida anterior ejecutó 56: 50 PASS y seis FAIL por statement_timeout bajo contención del equipo. Se conservan íntegros. Un retry focal de nueve casos aprobó los seis fallidos y tres casos nuevos; no se aumentaron timeouts. La consolidación final está en `postgres-consolidated.json`. Los intentos antiguos del runner psql, errores corregidos del fixture y procesos interrumpidos no se suman como PASS. Un reinicio del ejecutor interrumpió procesos propios; se conservaron logs, se recuperó el cluster y se repitieron las verificaciones. La regresión que no avanzaba con forks se ejecutó con threads y un worker, sin alterar aserciones ni timeouts. PostgreSQL propio se detuvo ordenadamente al finalizar, preservando sus bases sintéticas.

## Matriz FIN-01A–T recuperada

Se preserva el documento original en `fin01-r22/FIN01A-T-original.md`; esta tabla informa cobertura, sin convertir escenarios parciales en PASS completo.

| ID | Resultado y alcance |
|---|---|
| A | PASS SQL: 800 + 150 = 950, límite 1000 |
| B | PASS SQL: igualdad exacta 1000 |
| C | PASS SQL: un centavo sobre límite, sin efectos |
| D | PASS SQL: deuda ya sobre límite, nuevo incremento rechazado |
| E | PASS SQL: abono permitido sobre límite |
| F | PASS SQL/UI: límite cero impide deuda; pago completo permitido |
| G | PASS: dos sesiones reales, una venta 150 admitida y otra rechazada; saldo 950 |
| H | PASS SQL: replay sin duplicados, incluso tras reducir límite |
| I | PASS SQL: misma key con contenido diferente rechazada |
| J | PASS SQL: pagos mixtos/parciales aplicados canónicos |
| K | PASS SQL: recibido/cambio no reducen deuda dos veces |
| L | PARCIAL: dos hojas reales en transacción comparten cliente; dispatcher padre #338 completo NOT_TESTED |
| M | NOT_TESTED: carrera de dispatcher Split padre completo contra venta normal; carrera de hojas reales sí probada |
| N | PASS SQL: cliente de tenant ajeno rechazado |
| O | PASS SQL: sesión revocada/expirada rechazada por helpers reales |
| P | PASS SQL: cancelación autorizada restaura deuda con límite reducido |
| Q | PASS SQL: fallo inyectado tras stock revierte venta/stock/ledger/Caja |
| R | PARCIAL: replay SQL y recuperación timeout frontend probados por separado; pérdida real de respuesta PostgREST NOT_TESTED |
| S | PASS SQL: Caja cerrada rechaza sin efectos parciales |
| T | PARCIAL: Dexie real preserva/reabre/reanuda; instalación física offline/reconexión/SW NOT_TESTED |

## Compatibilidad, concurrencia y pendientes

Las carreras reales cubren venta/venta, venta/abono, límite/venta, importación/venta y consumo desde dos dispositivos. El bloqueo del cliente no se presenta como ausencia general de deadlocks. La RPC histórica tiene advisory lock por tenant y orden de clientes; el leaf heredado conserva variantes de adquisición de Caja/cliente.

Para integrar posteriormente #338: adquirir en el dispatcher el conjunto completo de clientes de hijos, ordenado por ID, respetando un único protocolo global padre/Caja/productos/clientes antes de llamar las hojas; revisar rutas con Caja implícita que adquieren cliente antes de Caja. Mantener replay antes de reevaluar límite y revertir el padre completo si un hijo falla. No añadir una excepción de límite en Split. #352 deberá revalidarse sobre la integración resultante, sin modificarlo en esta tarea.

P0/P1 nuevos confirmados en las verificaciones ejecutadas: ninguno. Se corrigió antes de publicación el riesgo de sumar otra vez ledger Local ya representado por el saldo inicial Cloud. No se certifica una ausencia global de defectos. P2 y límites de despliegue: QA física móvil claro/oscuro y teclado/scroll/táctil, SW antiguo/recarga offline, corte frontend/SQL, backup/restauración integral, dispatcher padre #338 y carga de deadlocks de todas las variantes legacy. El patrón anterior de ejecución pública POS autenticada internamente sigue siendo deliberado; las tablas privadas no se exponen.

## GitHub, pruebas y campos de cierre

| Área | Ejecutadas | PASS | FAIL | SKIP | Evidencia |
|---|---:|---:|---:|---:|---|
| PostgreSQL 17, casos únicos finales | 61 | 61 | 0 | 0 | postgres-release.json, release-fresh-install.log, release-function-parity.json |
| Snapshot/Dexie/flujo/UI/pago completo, únicos | 32 | 32 | 0 | 0 | frontend-consolidated.json |
| Regresión focal, 15 archivos | 215 | 214 | 1 heredado | 0 | focused-regression-release.json, regression-attribution.json |
| PWA, artefactos Admin y Store | 15 | 15 | 0 | 0 | pwa-release.json |
| Reproducción de fallo en main, solo atribución | 5 | 4 | 1 | 0 | inventory-baseline-final.json |

Los 5 casos de atribución baseline no se suman a candidato. Las corridas de preservación de ledger repiten casos de repositorio y flujo: se deduplican por archivo y nombre completo. No se suman los intentos anteriores como pruebas únicas adicionales. Los escenarios completos NOT_TESTED están detallados en la matriz; no aparecen como pruebas PASS ni como skips de Vitest.

El fallo heredado `inventoryFlow committed stock / reserva lotes y sincroniza committedStock del padre` reproduce exactamente en main: el objeto incluye `batchSku:null` y `expiryDate:null`, ausentes en la expectativa. No se modificó esa expectativa ni su implementación. La primera corrida PWA encontró `dist-store` ausente; se conservó y se construyó el artefacto antes de repetir el gate completo.

ESLint global: baseline 1432 archivos, 159 errores y 177 warnings; candidato final 1439 archivos, mismos 159/177. Se compararon multisets de ruta relativa/regla/severidad/mensaje, sin convertir desplazamientos de línea en regresiones. El último ajuste se reanalizó en los 22 JS/JSX de fuente cambiados y reemplazó esos resultados en el conjunto global: 0 errores focales y 3 warnings no-console heredados. Resultado: 0 candidate-only. Evidencia compacta: lint-diagnostics-baseline.json, lint-diagnostics-candidate.json y lint-differential-final.json. No se desactivaron reglas.

Production y Preview locales incluyen build Vite, generación SW y auditoría de precache, sin relajar presupuestos. El build público adicional proporciona el artefacto exigido por PWA. React Doctor final: exit 0, 25 archivos, 78/100, dos warnings de rendimiento: Intl.NumberFormat por llamada en la lista de importación y await dentro del loop de preservación. El segundo es intencional: los snapshots comparten la creación de la identidad de fuente y se serializan dentro de una transacción Dexie. No se suprimió la regla ni se paralelizaron esas escrituras dependientes. La optimización del formateador queda P2; no es una alerta de autoridad o integridad. Las corridas anteriores 100/100 tenían otro alcance y no reemplazan este resultado final. Ejecutar build no despliega frontend ni SQL.
