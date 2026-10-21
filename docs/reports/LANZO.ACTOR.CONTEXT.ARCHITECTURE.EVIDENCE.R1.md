# LANZO.ACTOR.CONTEXT.ARCHITECTURE.EVIDENCE.R1

Fecha: 21 de octubre de 2026, America/Mexico_City. **Investigación aislada, no candidata comercial.**

## Alcance y significado de PASS

Los datos son sintéticos. No hay negocio, licencia, token de sesión real, dispositivo registrado, venta, pago, RPC ni SQL. Context tokens aleatorios son exclusivamente identificadores del fixture. No se guardan claves TLS de prueba en el repositorio.

Un test de contraejemplo PASA cuando reproduce la propiedad insegura. Esa propiedad permanece **FAIL** en el análisis. El runner browser conserva siete resultados FAIL; exit 0 indica que el experimento reprodujo lo esperado, no que la transición legacy esté aprobada. Fallos inesperados de un caso positivo producen exit 1 y errores del harness exit 2.

## Fuentes de evidencia reproducible

| Archivo bajo scripts/qa/actor-context-contract/evidence/ | Qué conserva |
| --- | --- |
| chromium.json | 29 observaciones con versiones, expectativa, estado durable inicial/intermedio/final, handles, Runtime de modelo o NOT_LOADED y resultados de writes reales de fixture |
| vitest.json | Assertions, duración y estado de las 71 pruebas finales |
| architecture-vitest.log | Resumen de siete archivos y salida EXP14 focal |
| baseline-exp14.json | EXP14 sobre A: un FAIL sin suavizar la aserción |
| architecture-baseline.log | Granted session-b gen6 → locked gen7, durable conservado |
| baseline-browser.json | Reejecución del runner C: evento viejo baseline/focal y LC13 en tres parejas |
| consumer-inventory.txt | 197 referencias textuales en 67 archivos, incluyendo harness/comentarios |
| research-eslint.log | ESLint focal sin errores de código |

## Resumen de ejecuciones nuevas

| Ejecución | Resultado |
| --- | --- |
| Baseline EXP14 | 1 FAIL: atribución confirmada |
| Tests existentes recuperados (controller/bridge/handoff/storage/EXP14 focal) | 46 PASS |
| Propiedades positivas prototipo | 20 PASS |
| Contraejemplos de arquitectura detectados | 4 assertions PASS; las propiedades refutadas no están aceptadas |
| Counterexample Runtime real vs storage | 1 assertion PASS; callback de contador, sin DB financiera/bridge |
| Total Vitest final | **71 PASS, siete archivos** |
| Chromium 143.0.7499.0 | **21 PASS acotados, 7 FAIL, 1 PENDING** |
| ESLint / diff check | PASS |
| Cambios src/package/lock en 3.2A.2 | NONE respecto a checkpoint D |

No se suman repeticiones intermedias de 22/23/69/70 assertions. `numTotalTestSuites` del JSON de Vitest cuenta suites anidadas; no usarlo como número de archivos. No se declara CI/build comercial ni E2E financiero.

## Observaciones de seguridad FAIL

| Caso | Resultado observado |
| --- | --- |
| ARCH01 main/main | Invalidación tardía destruye B; ambos probes finales rechazados |
| ARCH02 main/focal | Mismo LC13; focal no preserva B |
| ARCH03 focal/focal | Mismo LC13 |
| ARCH05 main/v2 | Ambos handles current; writes A/B true/true |
| ARCH06 v2/main | Ambos handles current; writes true/true |
| ARCH07 v1 congelado/v2 | Al thaw ambos handles y writes permanecen válidos |
| EXTRA-IDB-UPGRADE-FENCE | Dexie **4.4.3** reabre esquema nuevo y escribe `after-upgrade` en el store sintético existente |

No se afirma que dos grants de almacenamiento equivalgan a dos ventas. Los FAIL de convivencia impiden presentar D como transición universal certificada.

## Observaciones positivas del prototipo

ARCH04/24: A→B y revoke A preservan token B; A no cruza su frontera y B sí. ARCH09 y EXTRA-R8: un solo owner tras solicitudes concurrentes en documentos reales. ARCH10/25: revoke vigente niega operación y no resucita por hints. ARCH11: ambos órdenes grant/revoke dan un resultado definido. ARCH12/13: corrupción/acceso inyectado rechazan. ARCH14/15/16: cambios y preparación incompleta no heredan handle. ARCH17: pending A impide handoff B y conserva origen. ARCH20: sin BC conserva asserts durables. ARCH23: hints viejos/duplicados no cambian B. EXTRA-NATIVE-ABORT: rollback de publicación y de efecto en IndexedDB real.

ARCH18 sólo prueba recarga: durable persiste y JS nuevo no tiene handle. Descarte real/OS/BFCache permanece PENDING. ARCH19, PWA instalada, no se ejecutó. ARCH21 opera sobre origen IP privado sintético interceptado; secure=false, IDB=true, locks=false, subtle=false. No fue una segunda laptop/LAN real. ARCH22 utilizó TLS local y certificado de fixture aceptado por ignoreHTTPSErrors; no fue Vercel ni certificación de cadena pública.

## Carreras y pruebas negativas

- R1: lectura anterior A no se usa como permiso de publicación; invalidate reconsulta en la TX. El modelo v1 read/set queda locked-A después de publicar B.
- R2: transacciones solapadas de grant/revoke y barreras que ensayan ambos órdenes.
- R3: hint no escribe autoridad; revocación usa token exacto.
- R4: provider inaccesible falla cerrado; no es test de quota/policy nativa.
- R5: un hook síncrono cambia tenant después de las lecturas y aborta la publicación. No se espera una RPC dentro de la TX.
- R6: ticket sintético entregado después de otra generación se rechaza. No hay RPC real.
- R7: writer v1 no coordinado conserva frontera válida. Un writer que omite la fila de autoridad en su TX de efectos puede escribir pese al head nuevo.
- R8: dos conexiones y tres documentos con grants/revokes; un solo ganador participante. No se deriva atomicidad de una frecuencia estadística.

## Reproducir sin tocar datos del usuario

Instrucciones y variables en `scripts/qa/actor-context-contract/README.md`. Usar las DB/perfiles aislados del runner. No apuntarlo al origen de Lanzo ni a un perfil personal. Las rutas originales A–D están preservadas; la rama de investigación no tiene auto despliegue.

La hipótesis que queda abierta es la transición con enforcement de todos los writers, no la viabilidad básica de una revocación dirigida entre participantes nuevos. El informe de arquitectura contiene alternativas, invariantes, roadmap y decisiones del propietario.
