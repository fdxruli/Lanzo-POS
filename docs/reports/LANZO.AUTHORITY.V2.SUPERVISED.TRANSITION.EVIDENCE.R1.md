# LANZO POS — SUPERVISED TRANSITION — EVIDENCE R1

Fecha: 21 de octubre de 2026, America/Mexico_City. **ADMISSION_UNPROVEN. SYNTHETIC_BOUNDARY_ONLY.**

## Identidad y procedencia

- Main: `f48aab53634663438a06dc5187fa7e6d17b74fb3`.
- Parent research: `c6d5e56afdbdb0e2d59dc479bdd5ada94d418f61`.
- Código de navegador: checkpoint R3 `0289757cf4a08acf2ebfe526d9c677b12e566c0f`; cliente, prototipo y fuentes se contrastan por hashes abajo.
- Chromium: `143.0.7499.0`; Linux headless; Playwright 1.62.1; Node `v24.19.0`.
- Ejecución final: `2026-10-21T18:03:56.011Z` UTC; no fechas del reloj de negocio modificadas.
- Legacy exacto: Git blob `dcc09e7be2fcf2435801302c3199f8592e029edc`. La comprobación se hace antes de arrancar.
- Runtime comercial legacy: NOT_LOADED_storage_only. Runtime v2: modelo sintético. No full app, pago, venta POS ni RPC.
- Dominios: unmanaged, partial (servidor de distribución), fully-managed UNPROVEN.
- Perfiles/orígenes/condiciones por caso están en browser.json. BrowserContext es una partición sintética, no un perfil físico certificado.

## Fuentes efectivamente servidas

| Recurso | SHA-256 |
| --- | --- |
| /main.mjs | `d07c40382ed27cda698a5df3761b0509f822659fbeea0d25e47154a0f8f248af` |
| /client.mjs | `602c9455017f3dbf68dfa1de6284552637cfd472dd31cf5524eb6d2aadec5cc8` |
| /prototype.mjs | `c9606591508bcb013b11478fdf12f9af4bd5ca3ed3120b890e3897372579d5d1` |
| /admission.mjs | `997c9209405d5b55896071eb0331d4865689f5b868145af2d25965a58ad4977b` |
| /dexie.mjs | `58475a95e77cb746f9248999886b7c87049837df7ec1e1e508cb231625da5acc` |

Dexie 4.4.3 real se sirvió del tooling instalado. Hash no equivale a attestation de un proceso arbitrario. El harness fija/proporciona los bytes de su dominio; MAIN_EXACT_MODULE es sólo un marcador auxiliar.

## Matriz T3-01…20

PASS sólo aprueba la propiedad limitada indicada. FAIL conserva el contraejemplo de seguridad; no es PASS por haber sido esperado. PENDING no se suma como aprobado.

| ID | Dominio / resultado | Objetivo y esperado | Observado y límite |
| --- | --- | --- | --- |
| T3-01 | unmanaged / **FAIL** | Legacy abierto antes de B. B protegido restringido; si se fuerza B, A debe quedar retirado. | A y B forzado escriben. protectedWrite B rechaza y conserva durable. |
| T3-02 | unmanaged / **FAIL** | Legacy congelado por CDP. A no debe recuperar escritura incompatible tras thaw. | A vuelve a escribir; contención B sí deniega. No suspensión física. |
| T3-03 | partial / **PENDING** | Restauración de documento cerrado. Restauración real con identificación de artefacto. | No ejecutada; no se sustituye por reload. |
| T3-04 | partial / **FAIL** | Legacy desde CacheStorage/SW. Bloqueo de distribución debe impedir reejecución si se pretende usar como frontera. | Servidor 410, SW 200, legacy exacto ejecutado y write permitido. |
| T3-05 | unmanaged / **FAIL** | Apertura concurrente. No dos rutas operables por orden casual. | Ambas escrituras sintéticas confirman bajo hipótesis de forzar v2. |
| T3-06 | unmanaged / **PASS** | Otra partición/perfil. Determinar si comparte DB física. | BrowserContexts separados: efectos B no aparecen en DB A. Perfil físico no probado. |
| T3-07 | partial / **PENDING** | PWA instalada. Ensayar instalación real adicional. | No disponible; una página headless no acredita instalación. |
| T3-08 | unmanaged / **PENDING** | BFCache. pageshow.persisted=true antes de atribuir efecto a BFCache. | Navegación y vuelta realizadas; persisted no verdadero. PENDING. |
| T3-09 | partial / **FAIL** | Worker anterior y recursos nuevos. Publicar SW nuevo no debe contarse como retiro de JS antiguo. | Legacy sigue escribiendo tras servir nuevo worker. No se afirma activación nueva acreditada. |
| T3-10 | partial / **PENDING** | Worker waiting con intent. Acreditar waiting, conservar pending sin reload. | No se observó waiting tras registro/update; intent y handle intactos. PENDING. |
| T3-11 | partial / **PENDING** | Reinicio/restauración de sesión. Reiniciar y restaurar documentos desde perfil persistente real. | No ejecutado. Cerrar contexto no se presenta como restart con restore. |
| T3-12 | unmanaged / **FAIL** | Reapertura Dexie 4.4.3. Upgrade aislado no debe aceptarse si A puede reabrir. | V1 reabre DB V2 y confirma after-upgrade mediante tabla capturada. |
| T3-13 | unmanaged / **FAIL** | Conexión/tabla antiguas abiertas. Comprobar upgrade blocked y capacidad real de A. | A rechaza versionchange; confirma mientras upgrade blocked; cierra voluntariamente y puede reabrir. |
| T3-14 | unmanaged / **FAIL** | Writer que ignora coordinador. Ningún write fuera del fence si se pretende mediación completa. | Writer IDB sintético confirma effects tras revoke. No es ruta financiera POS. |
| T3-15 | unmanaged / **FAIL** | Legacy offline. Servidor no se acepta como fence obligatorio Local. | Red browser offline; ambas rutas sintéticas escriben. No backend configurado. |
| T3-16 | unmanaged / **FAIL** | Legacy con nueva activación sintética. No asumir retiro si A puede activar storage otra vez. | A activa de nuevo storage y escribe; B conserva su head. Sin autenticación real. |
| T3-17 | unmanaged / **PASS** | Invalidación v1 tardía. Proteger head B sin confundirlo con retiro de A. | B conserva head y confirma efecto; v1 cambia su llave propia a locked. PASS sólo separación P1. |
| T3-18 | partial / **FAIL** | Descarga de build antiguo. Probar bloqueo de distribución frente a memoria ya ejecutando. | Descarga 410, A ya cargado sigue confirmando payload. |
| T3-19 | partial / **PASS** | Mecanismo gestor indisponible. Denegar nuevas capacidades y no borrar datos. | Entrada storage unavailable del modelo restringe, snapshot igual. No agente real apagado. |
| T3-20 | partial / **FAIL** | Reingreso posterior. Cierre voluntario no prueba exclusión permanente. | A se cierra; B abre; A vuelve a abrir y escribe. Ninguna transición segura declarada. |

**Conteo T3 final:** 3 PASS / 12 FAIL / 5 PENDING. P1 contención se registra adicionalmente en T3-01/02 como containment=PASS con protectedWrite denegado y snapshot intacto; no se cuenta de nuevo. P2 falla en las hipótesis indicadas.

## Dominio 3 y admisión positiva

`DOMAIN-3 = UNPROVEN`, `MANAGED_ENFORCEMENT_NOT_AVAILABLE`. No hay política OS/MDM de allowlist, guardián obligatorio de DB ni protección contra restaurar una versión/perfil anterior. No se creó un cliente C comercial ni se inyectó una hipótesis como si fuese verificador. **ADMISSION_GRANTED real: ninguno.**

Integridad de publicación: R5 `65b3da22862ccf9f8773e966898194684ede3547` coincidió con 16 de 17 artefactos locales; detectó que browser-r2.json había quedado vacío en R2. R5.1 restaura sus 65,694 bytes desde la copia local intacta y vuelve a contrastar todos los hashes. No cambia resultados ni reescribe checkpoints previos.

## Evidencia especial de Service Worker e IndexedDB

### T3-04

```json
{
  "serverDenial": 410,
  "swResponse": {
    "status": 200,
    "controller": "http://127.0.0.1:39863/sw.js",
    "caches": [
      "synthetic-v1"
    ]
  },
  "executed": "MAIN_EXACT_MODULE",
  "write": {
    "committed": true
  }
}
```

### T3-10

```json
{
  "worker": {
    "active": "activated",
    "hasHandle": true
  }
}
```

### T3-12

```json
{
  "dexieVersion": "4.4.3",
  "stateAfterUpgrade": false,
  "oldVersion": 1,
  "nextVersion": 2,
  "blocked": false,
  "heldWrite": false,
  "rows": [
    {
      "id": "after-upgrade",
      "synthetic": true
    },
    {
      "id": "before",
      "synthetic": true
    }
  ]
}
```

### T3-13

```json
{
  "dexieVersion": "4.4.3",
  "stateAfterUpgrade": false,
  "oldVersion": 1,
  "nextVersion": 2,
  "blocked": true,
  "heldWrite": true,
  "rows": [
    {
      "id": "after-upgrade",
      "synthetic": true
    },
    {
      "id": "before",
      "synthetic": true
    },
    {
      "id": "while-upgrade-blocked",
      "synthetic": true
    }
  ]
}
```

T3-10: la ausencia de waiting observado en este fixture no demuestra un defecto del worker de Lanzo. El registro previo R2 lo clasificó FAIL del ensayo de waiting; esa interpretación se corrige a PENDING, manteniendo el original y la explicación. No se añadió skipWaiting ni reload.

## FIN-T3-01…10

Todas las filas son SYNTHETIC_BOUNDARY_ONLY; metadata de caja/crédito/apartado no ejecuta esos repositorios reales.

| ID | Resultado final | Propiedad y evidencia |
| --- | --- | --- |
| FIN-T3-01 | **PASS** | B no hereda la venta preparada; HANDOFF_PENDING y snapshot igual. |
| FIN-T3-02 | **PASS** | A confirma; handoff posterior conserva receipt y owner A. |
| FIN-T3-03 | **PASS** | Dispatch ambiguo bloquea handoff; NOT_FOUND después de intento conserva, sin resend. |
| FIN-T3-04 | **PASS** | A ausente: pending queda con A y clasificación manual; no bypass implementado. |
| FIN-T3-05 | **PASS** | UI pierde respuesta: repetir commit con misma K devuelve mismo efecto; cardinalidad 1. |
| FIN-T3-06 | **PASS** | Receipt tardío de A no se proyecta como B; nueva sesión del mismo A puede inspeccionar modelo sin cambiar origen. |
| FIN-T3-07 | **PASS** | Metadata de caja permanece OPEN tras handoff; no cierre automático. |
| FIN-T3-08 | **PASS** | Metadata outbox PENDING de efecto local completo conserva originActor/K; no adopción. |
| FIN-T3-09 | **PENDING** | SW waiting no acreditado en T3-10; intent intacto no sustituye la prueba faltante. |
| FIN-T3-10 | **PASS** | Admisión restringida conserva intent/datos; ninguna capacidad operativa nueva. |

**Conteos separados:** FIN 9 PASS / 1 PENDING; nueve fixtures de clases de datos PASS; diez claims de policy model rechazadas PASS. Total financiero/modelado: 28 PASS / 1 PENDING. No sumar estas últimas como pruebas de pagos ni de falsificación de un testigo externo real.

## Pruebas heredadas repetidas

`prototype.test.mjs` y `admission.test.mjs`: 42/42 PASS, cero skips/fallos. Incluyen cuatro detecciones de contraejemplos en el prototipo y una de writer no coordinado en admisión. Su PASS significa detección, no aceptación de la propiedad refutada. No se ejecutó el resto de la suite Runtime histórica ni se atribuyen sus recuentos a esta fase. Config Vitest temporal: entorno node y esos dos includes; producto sin modificaciones.

## Capacidades por origen

| Caso | Secure | IDB | Locks | BC | SW | Subtle | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CAP-127.0.0.1 | True | True | True | True | True | True | PASS |
| CAP-localhost | True | True | True | True | True | True | PASS |
| CAP-IP | False | True | False | True | False | False | PASS |
| CAP-HTTPS | True | True | True | True | True | True | PASS |

IP privada interceptada; ningún dispositivo LAN contactado. TLS local real con certificado descartable y ignoreHTTPSErrors; no confianza pública. getRandomValues estuvo disponible en los cuatro documentos; no equivale a toda la criptografía del producto.

## Comprobaciones y límites del harness

El verificador comprueba hashes de las cuatro fuentes propias, los doce contraejemplos esperados, observaciones favorables, control de contención, heldWrite/blocked de Dexie, ausencia de ERROR, conteo heredado y ausencia de admisión positiva. Syntax checks de scripts PASS. Exit cero del navegador por sí solo no certifica seguridad; verify.mjs exige conservar la interpretación de los resultados.

Incidencias de tooling conservadas conceptualmente: clon no disponible; extracción Chromium automática por chown; primer hash bloqueó un salto de línea adicional; preparación legacy inicial usó un nombre de binding incompatible y se corrigió al formato exigido; hubo una carrera al arrancar la prueba TLS antes de terminar de crear el certificado. Esos intentos no se cuentan como pruebas del producto. Los resultados finales no contienen errores de harness. No se debilitó ninguna aserción de seguridad para aprobar una hipótesis fallida.

## Archivos reproducibles y registros completos

| Archivo | Contenido |
| --- | --- |
| [browser.json](../../scripts/qa/authority-v2-supervised-transition/evidence/browser.json) | Ejecución final; versiones, manifest, snapshots y límites |
| [browser-r2.json](../../scripts/qa/authority-v2-supervised-transition/evidence/browser-r2.json) | Pasada anterior conservada; NO se agrega a totales |
| [financial.json](../../scripts/qa/authority-v2-supervised-transition/evidence/financial.json) | Fixtures, recovery y before/after |
| [inherited-tests.json](../../scripts/qa/authority-v2-supervised-transition/evidence/inherited-tests.json) | Resultado completo de Vitest |
| [matrix.json](../../scripts/qa/authority-v2-supervised-transition/evidence/matrix.json) | Campos normalizados y referencias al trace íntegro |
| [baseline.json](../../scripts/qa/authority-v2-supervised-transition/evidence/baseline.json) | Main, PR, despliegues y separación de árboles |
| [provenance.json](../../scripts/qa/authority-v2-supervised-transition/evidence/provenance.json) | Nueve informes, blobs, checkpoints y fuentes |
| [validation.json](../../scripts/qa/authority-v2-supervised-transition/evidence/validation.json) | Conteos finales y dictamen |
| [README](../../scripts/qa/authority-v2-supervised-transition/README.md) | Reproducción y variables de tooling externo |

## Checkpoints y alcance final

R0 f4528fbe890456402a4fc9b40a7fb03685936507; R1 299d5212b375e617437a9566ab59de9250d6ba61; R2 c1679a8ed711abf522d49f89fc495642150b6665; R3 0289757cf4a08acf2ebfe526d9c677b12e566c0f; R4 a92ecf9e048db4b5b3d9a2879b1e4ad8889b0290. R5 contiene esta evidencia y se entrega por SHA verificable. No hay circularidad de hash propio.

**Datos del propietario: no modificados. Supabase: sin llamadas. Migraciones: NONE. Runtime comercial: sin nuevos cambios. PR/Preview/merge: NONE.** La rama heredada sigue conteniendo un fix focal no aprobado; no debe desplegarse.

El estado ADMISSION_UNPROVEN identifica falta de prueba positiva. Las hipótesis parciales refutadas no se convierten en una demostración universal de imposibilidad.
