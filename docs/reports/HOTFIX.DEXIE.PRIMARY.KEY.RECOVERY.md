# HOTFIX.DEXIE.PRIMARY.KEY.RECOVERY

Fecha de cierre técnico: 2026-07-24

Repositorio: `fdxruli/Lanzo-POS`

PR: `#127`

Rama: `hotfix/dexie-primary-key-recovery-admin-bootstrap`

Base y merge-base verificados: `4ab2abb719319728426ca0936233a04f8614687e`

HEAD anterior auditado: `5faf5220cd540f878a612b5f608b2b907d663396`

HEAD parcial dejado por la sesión interrumpida: `c54e4e275fa7716a10572ced7e66d067429827a9`

HEAD de implementación validado: `5cabe66548e4fcb4b157bcafeae9c27ea636e9a5`

Los cambios posteriores a ese HEAD dentro de este informe son exclusivamente documentales.

## 1. Resumen ejecutivo

El hotfix resuelve de forma preservadora una incompatibilidad estructural de `LanzoDB1`:

```text
legacy:
  sales          keyPath=timestamp
  deleted_sales  keyPath=timestamp

actual:
  sales          keyPath=id
  deleted_sales  keyPath=id
```

El error raíz era:

```text
UpgradeError: Not yet support for changing primary key
```

La solución:

- no elimina IndexedDB;
- no cambia el nombre `LanzoDB1`;
- no limpia `localStorage`, Cache Storage ni credenciales;
- no modifica Supabase;
- no crea migraciones SQL;
- conserva respaldos técnicos dentro de IndexedDB;
- coordina una sola preparación activa;
- permite reanudar la sesión administrativa sin repetir el login remoto ni consumir otro cupo.

## 2. Cronología de la sesión interrumpida

1. El PR estaba abierto, draft, sin merge, con base `main`.
2. El HEAD previamente revisado era `5faf522…`.
3. La sesión interrumpida agregó quince commits y avanzó hasta `c54e4e2…`.
4. Esa sesión alcanzó a crear `pendingAdminSession.js` y modificaciones parciales en acciones de licencia y runtime de base local.
5. También dejó un mecanismo temporal formado por cuatro fragmentos Base64 y dos workflows con escritura del repositorio.
6. El workflow intentó concatenar, decodificar y extraer un tarball para generar código y hacer commit automáticamente.
7. Ese mecanismo falló y no completó los bloqueantes.
8. La continuación auditó primero los archivos fuente y los payloads, trasladó cualquier corrección útil a archivos normales y eliminó todos los residuos autoescritores.
9. Desde ese punto, cada cambio se realizó mediante commits normales sobre la rama existente.
10. El PR permaneció draft y nunca se activó auto-merge.

## 3. Workflows temporales fallidos y limpieza

Se eliminaron:

```text
.github/pr127-residual/part00
.github/pr127-residual/part01
.github/pr127-residual/part02
.github/pr127-residual/part03
.github/workflows/pr127-apply-residual.yml
.github/workflows/pr127-source-snapshot.yml
```

La validación legítima quedó en:

```text
.github/workflows/hotfix-dexie-validation.yml
```

Y la comparación global read-only en:

```text
.github/workflows/pr127-global-comparison.yml
```

Ambos workflows tienen exclusivamente:

```yaml
permissions:
  contents: read
```

No generan código, no escriben commits y no usan payloads Base64 o tarballs.

## 4. Sesión administrativa pendiente ligada a licencia

La estructura pendiente final es:

```javascript
{
  licenseKey,
  adminUserId,
  deviceId,
  sessionIdentity,
  authenticatedAt,
  result
}
```

Propiedades verificadas:

- se liga a una sola licencia;
- normaliza y valida `licenseKey`;
- valida `adminUserId`, `deviceId` y `sessionIdentity` contra el resultado remoto cuando existen;
- no inventa identificadores ausentes;
- no almacena contraseña;
- no reutiliza una sesión de otra licencia;
- no repite `adminLoginOnDevice` al reanudar la misma sesión válida;
- se limpia después de completar `_loadProfile` y el bootstrap local.

## 5. Transiciones y limpieza de sesión

El pending administrativo se limpia en los flujos de:

- logout administrativo;
- logout general;
- cambio de licencia;
- confirmación de cambio de licencia requerido;
- `_requireLicenseChange`;
- selección de acceso staff;
- credenciales rechazadas;
- identidad pendiente alterada o incompatible.

La transición obligatoria fue cubierta:

```text
LIC-A
→ login remoto correcto
→ error estructural local
→ recuperación
→ LIC-A se reanuda sin segundo RPC
```

También:

```text
LIC-A
→ pending admin
→ logout/cambio
→ LIC-B
→ login remoto nuevo para LIC-B
```

No se reutilizan `result`, admin, dispositivo ni identidad de sesión de LIC-A.

## 6. Recuperación administrativa después de recarga

Después de recuperar la base:

1. el sistema verifica la sesión persistida mediante el flujo normal;
2. no solicita otra vez usuario y contraseña cuando la sesión administrativa sigue siendo válida;
3. no consume otro cupo de dispositivo;
4. no repite enrolamiento;
5. completa `_loadProfile`;
6. limpia `pendingAdminSessionResult`;
7. establece `appStatus` correctamente;
8. inicia POS Sync únicamente cuando la base está lista.

La contraseña nunca se persiste como mecanismo de recuperación.

## 7. Timeout de apertura separado de migración

`openNativeDatabase()` ahora distingue:

```text
opening
blocked
upgrading
succeeded
failed
aborted
```

El timeout genérico opera únicamente durante `opening`.

Cuando comienza `onupgradeneeded`:

- se cancela el timeout de apertura;
- el estado cambia a `upgrading`;
- la duración del backup, cursor copy, rebuild, restore y validación no puede producir un falso `DB_OPEN_TIMEOUT`;
- la promesa permanece activa hasta éxito, error o aborto confirmado.

Existe una prueba determinista que inicia el upgrade, espera más que el timeout configurado y después completa `onsuccess` sin falso fallo.

También existe una prueba independiente para una apertura que realmente nunca responde.

## 8. Solicitudes bloqueadas y coordinación de reintentos

Cuando ocurre `onblocked`:

- se publica `DB_BLOCKED` con una instrucción para cerrar otra pestaña;
- no se rechaza ni reemplaza la solicitud nativa activa;
- la misma solicitud continúa cuando se cierra la conexión bloqueante;
- no se crean backups o rebuilds paralelos;
- el diagnóstico se emite una sola vez por operación.

Además, `indexedDbPreflightCoordinator.js` coordina la preparación completa por fábrica y nombre de base.

Varios clics o llamadas concurrentes reciben exactamente la misma promesa de:

```text
inspection → backup → rebuild → validation
```

La propiedad se libera únicamente cuando la preparación completa termina realmente.

## 9. Respaldo preservador

Durante el primer `versionchange` se crean o reutilizan:

```text
__lanzo_sales_backup_v30
__lanzo_deleted_sales_backup_v30
__lanzo_db_recovery
```

Cada entrada contiene:

```javascript
{
  legacyKey,
  sourceKey,
  originalId,
  migratedId,
  idRemapped,
  remapReason,
  record
}
```

Los valores de `remapReason` son:

```text
missing_id
duplicate_id
secondary_collision
null
```

Se registran únicamente metadatos técnicos, conteos y hashes; no se imprimen ventas, clientes ni contenido sensible.

## 10. Resolución determinista de IDs duplicados

La decisión de ID se toma y fija durante el backup, por store:

1. un `record.id` válido y único se conserva;
2. un ID faltante o vacío se genera desde el store y `sourceKey`;
3. un ID duplicado se genera desde `originalId`, store y `sourceKey`;
4. una colisión secundaria genera un candidato determinista adicional;
5. se comprueba unicidad antes de continuar.

No se utilizan:

```text
Math.random()
Date.now()
crypto.randomUUID()
```

Los mismos registros producen exactamente los mismos IDs en ejecuciones repetidas.

La restauración usa exclusivamente `backupEntry.migratedId`; no recalcula decisiones.

## 11. Validación atómica de restauración

La reconstrucción compara:

- conteo de origen;
- conteo de backup;
- conteo de destino;
- hash de claves de origen;
- hash de IDs migrados;
- unicidad de IDs.

La restauración usa `add`, no `put`, para impedir sobrescrituras silenciosas.

Cualquier discrepancia o colisión:

- aborta atómicamente el `versionchange`;
- conserva el estado anterior y los backups;
- propaga un error estructurado;
- no se degrada a un `AbortError` genérico.

## 12. Interrupción y reanudación

### Durante backup

La transacción se aborta y los stores originales siguen siendo autoritativos.

### Después de `backup_complete`

El siguiente intento conserva los `migratedId` ya fijados y continúa con rebuild.

### Durante rebuild

La transacción de reconstrucción se aborta atómicamente; los backups permanecen disponibles.

### Después de `rebuild_complete`

El marcador final impide repetir la migración.

## 13. Versión superior y esquema compatible incompleto

Una base con versión nativa superior a la soportada:

- no intenta downgrade;
- no se elimina;
- devuelve `DB_UNSUPPORTED_NATIVE_VERSION`;
- se marca como no reparable automáticamente.

Una base con primary keys correctas pero stores o índices compatibles faltantes no se clasifica como primary-key mismatch; se permite que Dexie aplique su upgrade compatible normal.

## 14. DatabaseRecoveryGate

El árbol de la aplicación no se monta durante:

```text
checking
migrating
recovery_required
failed
```

La UI muestra:

- `Comprobando la base local...` en checking;
- `Actualizando la base local de forma segura...` en migrating;
- fase, stores, sourceCounts y targetCounts cuando existen;
- reintento en `recovery_required`;
- diagnóstico no destructivo en `failed`.

Los clics repetidos de reintento se colapsan en una sola operación. La recarga ocurre únicamente después de que la preparación termina, Dexie abre y el estado es `ready`.

## 15. ProductStore interno

La protección no depende únicamente de un wrapper externo.

Dentro del propietario de `isInvalidating` y `pendingInvalidation`, un error estructural:

- limpia `pendingInvalidation`;
- establece `isInvalidating=false`;
- establece `isLoading=false`;
- no programa otro reintento;
- convierte wake-ups en no-op durante recuperación;
- emite un diagnóstico agregado;
- no registra falsamente `Invalidation complete`.

Se cubren eventos de:

```text
focus
visibilitychange
pageshow
BroadcastChannel
lanzo:products-sync-updated
```

El comportamiento normal se reanuda cuando la base vuelve a `ready`.

## 16. StorageManager, POS Sync y bootstrap

- StorageManager trata `navigator.storage.persist()` como best-effort independiente del estado estructural.
- POS Sync Meta evita lecturas y escrituras mientras la recuperación está pendiente.
- El bootstrap POS Sync se difiere hasta que la base local está lista.
- La definición Dexie canónica se registra antes de abrir la base.
- El worker de migración no usa la versión nativa legacy como si fuera una versión lógica Dexie.

## 17. Pruebas focales

El workflow final ejecuta:

- recuperación Dexie y registro de esquema;
- duplicados, IDs faltantes y numéricos;
- migración lenta determinista;
- volumen de 500 registros;
- base bloqueada y cierre posterior;
- reintentos concurrentes;
- interrupción después de backup;
- versión nativa superior;
- esquema compatible incompleto;
- DatabaseRecoveryGate;
- AdminLoginModal;
- acciones administrativas existentes;
- transiciones admin/staff existentes;
- recuperación administrativa local;
- coordinador de bootstrap;
- ProductStore estructural;
- POS Sync Meta;
- StorageManager.

Run final:

```text
HOTFIX Dexie Recovery Validation
run_id: 30139096070
head:   5cabe66548e4fcb4b157bcafeae9c27ea636e9a5
result: success
```

Todos los jobs focales y el agregador terminaron en success.

## 18. Quality, diff y builds

En el mismo run `30139096070` pasaron:

```text
Focal ESLint                          PASS
git diff --check origin/main...HEAD   PASS
residual self-writing grep            PASS
npm run build                         PASS
npm run build:store                   PASS
admin PWA architecture                PASS
```

## 19. Comparación global contra main

Workflow final:

```text
PR127 Global Comparison
run_id: 30139096067
head:   5cabe66548e4fcb4b157bcafeae9c27ea636e9a5
result: success
```

Resultados normalizados:

```text
PR failures:       149
main failures:     149
shared failures:   149
new failures:        0
resolved failures:   0
```

La suite global completa continúa roja tanto en el PR como en `main` por deuda heredada. El hotfix no introduce fallos globales nuevos y no modifica deuda ajena.

## 20. Riesgo FREE

En FREE, IndexedDB es la fuente local principal. Por ello el riesgo de pérdida por una reparación destructiva sería alto.

Mitigaciones aplicadas:

- cero borrado automático;
- backup previo obligatorio;
- transacciones `versionchange` atómicas;
- hashes y conteos;
- IDs deterministas;
- reanudación después de interrupción;
- gate que impide montar consumidores mientras la base no está lista.

Riesgo residual: debe validarse manualmente una copia real de una instalación histórica antes del lanzamiento general.

## 21. Riesgo PRO

En PRO existen datos cloud y sesiones administrativas/dispositivos, pero la base local sigue participando en POS, perfil y sincronización.

Mitigaciones aplicadas:

- la sesión remota válida se conserva;
- no se consume un segundo cupo al reanudar;
- POS Sync espera a DB ready;
- no se modifican tablas, RPC, RLS ni datos Supabase;
- no se repite enrolamiento.

Riesgo residual: validar manualmente inicio en un segundo dispositivo, recuperación con dos pestañas y reanudación de sync contra una cuenta PRO de prueba.

## 22. Limitaciones reales

- `fake-indexeddb` valida semántica, concurrencia y atomicidad, pero no sustituye una prueba en Chrome/Edge con una base histórica real.
- No se simuló corte físico de energía; se cubrieron estados equivalentes de transacción e interrupción mediante marcadores.
- Los stores de backup se conservan intencionalmente en esta versión.
- Una versión nativa futura superior no se repara automáticamente.
- El workflow global refleja deuda heredada de `main`; no se corrigió fuera del alcance del hotfix.
- GitHub no expone stashes locales; no se ejecutó ninguna operación sobre stashes.

## 23. Validación manual pendiente

Antes del merge se recomienda ejecutar en una copia controlada:

1. instalación FREE legacy con ventas y eliminadas duplicadas;
2. login admin remoto válido seguido de fallo local y recuperación;
3. LIC-A → logout/cambio → LIC-B;
4. dos pestañas abiertas y cierre posterior de la bloqueante;
5. recarga después de `backup_complete`;
6. recarga después de un rebuild abortado;
7. verificación de montos, timestamps, clientes y estados;
8. cuenta PRO con sync reanudado únicamente después de DB ready;
9. build administrativo y tienda pública en navegador real.

## 24. Salvaguardas verificadas

El diff del PR no agrega:

```text
indexedDB.deleteDatabase()
localStorage.clear()
caches.delete()
Supabase
migraciones SQL
deploy manual
auto-merge
workflows contents: write
```

Las llamadas destructivas presentes únicamente dentro de pruebas crean o limpian bases efímeras de test y no forman parte del runtime productivo.

## 25. Estado de entrega

- PR abierto.
- PR draft.
- PR sin merge.
- Sin aprobación automática.
- Sin Supabase.
- Sin borrado automático.
- Sin workflows escritores.
- Listo para una nueva auditoría externa y validación manual, no para aprobación automática.

## 26. DB_OPEN_TIMEOUT y liquidación tardía de la solicitud nativa

`openNativeDatabase()` separa ahora de forma explícita dos ciclos de vida:

- la promesa pública puede quedar rechazada con `DB_OPEN_TIMEOUT`;
- la solicitud nativa `indexedDB.open()` puede seguir viva y todavía disparar
  `onsuccess`, `onerror`, `onblocked` u `onupgradeneeded`.

Una solicitud `indexedDB.open()` que todavía no dispone de transacción no se
puede cancelar. Por esa razón no se elimina del registro al vencer el timeout:
se conserva el single-flight y se representa como
`timed_out_waiting_native_settlement` hasta su liquidación real.

El registro `activeNativeOpenOperations` publica un snapshot congelado que solo
cambia de referencia ante una mutación real. La suscripción notifica el alta,
las transiciones `opening`, `blocked`, `upgrading`, timeout, éxito, fallo o
aborto, y la eliminación final. El snapshot solo contiene `key` y `state`; no
expone ventas ni datos de negocio.

`DatabaseRecoveryGate` consume ese snapshot mediante `useSyncExternalStore`.
Mientras una solicitud posterior al timeout siga viva:

- `Reintentar recuperación` permanece deshabilitado;
- se explica que el navegador conserva la solicitud;
- `Recargar Lanzo` permanece disponible y solo ejecuta
  `window.location.reload()` por acción explícita del usuario.

Cuando la solicitud termina tarde, la eliminación del registro emite una
notificación, React renderiza de nuevo y el reintento queda habilitado sin
necesitar un cambio de pestaña. Si la solicitud nunca termina, la recarga sigue
siendo una salida visible que no borra IndexedDB ni otros almacenamientos y no
inicia una segunda apertura dentro de la página actual.

`DB_BLOCKED` mantiene su semántica independiente: se pide cerrar las demás
pestañas y la solicitud original continúa, sin ofrecer un reintento paralelo.
Además, `retryLocalDatabaseRecovery()` rechaza defensivamente con un error
estructurado si una solicitud nativa sigue activa.

La estabilidad contra React error #185 se cubre montando el gate bajo
`React.StrictMode`, publicando varias transiciones y verificando snapshots con
referencia persistente, renders finitos y cleanup completo de listeners.

La prueba de cleanup de service workers de desarrollo confirma que un retorno
`false` detiene `prepareLocalDatabase`, no monta App y deja el estado de prueba
resuelto explícitamente después de solicitar la recarga.

Validación local de la corrección:

```text
Pruebas focales seleccionadas   83/83 PASS
Prueba focal timeout/store      35/35 PASS
ESLint focal                    PASS
git diff --check                PASS
npm run build (Node 22)         PASS
npm run build:store (Node 22)   PASS
adminPwaArchitecture            13/13 PASS
```

El resultado final de CI y la comparación global corresponden a los runs
nuevos enlazados en el cuerpo del PR. La validación manual controlada continúa
pendiente.
