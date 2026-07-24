# HOTFIX.DEXIE.PRIMARY.KEY.RECOVERY

Fecha: 2026-07-23

Repositorio: `fdxruli/Lanzo-POS`

Rama: `hotfix/dexie-primary-key-recovery-admin-bootstrap`

PR: `#127`

Base inicial y merge-base: `4ab2abb719319728426ca0936233a04f8614687e`

## 1. Resumen ejecutivo

Se implementó un hotfix preservador para la incompatibilidad estructural de `LanzoDB1` donde instalaciones históricas conservan:

```text
sales          keyPath=timestamp
deleted_sales  keyPath=timestamp
```

mientras el esquema Dexie actual espera:

```text
sales          keyPath=id
deleted_sales  keyPath=id
```

El error raíz era:

```text
UpgradeError: Not yet support for changing primary key
```

La solución no elimina la base, no cambia su nombre y no limpia almacenamiento auxiliar. Antes de abrir Dexie se inspecciona la estructura mediante IndexedDB nativo. Si existe la divergencia, se ejecuta una migración de dos `versionchange` atómicos: primero respaldo y después reconstrucción. Los stores de respaldo permanecen en esta versión.

El bootstrap, login administrativo, ProductStore, POS Sync Meta, StorageManager y el worker de mantenimiento fueron adaptados para distinguir un fallo estructural de los errores en cascada y para abandonar estados de carga de forma recuperable.

## 2. Cronología del incidente

1. Un segundo dispositivo intentó iniciar sesión administrativa.
2. Dexie intentó abrir y actualizar `LanzoDB1`.
3. IndexedDB existente tenía primary keys `timestamp` en `sales` y `deleted_sales`.
4. El esquema declarado esperaba primary keys `id`.
5. Dexie rechazó el upgrade con `UpgradeError`.
6. La conexión quedó cerrada y los consumidores posteriores produjeron `DatabaseClosedError`.
7. El modal no liberó `loading`, por lo que quedó permanentemente en `Verificando...`.
8. Eventos `focus`, `visibilitychange`, `pageshow` y mecanismos de invalidación volvieron a ejecutar accesos contra una base cerrada.
9. POS Sync Meta y la identidad local intentaron leer o escribir sobre la misma conexión no disponible.
10. El rechazo de `navigator.storage.persist()` apareció en la misma cronología, pero era un aviso independiente.

## 3. Error raíz

El error raíz es exclusivamente la incompatibilidad de primary key durante el upgrade:

```text
UpgradeError: Not yet support for changing primary key
```

Dexie puede agregar o retirar índices mediante `version().stores(...)`, pero no puede transformar en sitio la primary key de un object store ya creado. La reparación exige crear un respaldo, eliminar y recrear el object store dentro de una transacción de upgrade, y restaurar los registros.

## 4. Errores en cascada

Los siguientes mensajes no son causas independientes en este incidente:

- `DatabaseClosedError` con `UpgradeError` interno.
- Error de re-fetch e invalidación de ProductStore.
- Fallos al guardar `pos_realtime_status` y `pos_sync_enabled`.
- Fallo al leer identidad desde IndexedDB.
- Fallo al persistir un ID de dispositivo nuevo en IndexedDB.
- Fallo al cargar perfil local después de una autenticación remota válida.

El hotfix clasifica estos casos como derivados de un estado estructural y evita reintentos repetitivos.

## 5. Advertencias independientes

`navigator.storage.persist()` es best-effort. Puede devolver `false`, rechazar la promesa o no estar disponible mientras IndexedDB continúa funcionando correctamente.

El estado `persistenceState=denied` o `volatile`:

- no marca la base como corrupta;
- no bloquea login;
- no bloquea bootstrap;
- no se convierte en `DatabaseClosedError`;
- no dispara recuperación estructural;
- conserva una advertencia útil para usuarios FREE con datos exclusivamente locales.

Se retiraron mensajes genéricos que atribuían el rechazo a Safari sin detectar realmente ese navegador.

## 6. Tabla exacta de keyPaths relevantes

| Store | Esquema histórico observado | Esquema canónico | autoIncrement | Acción del hotfix |
|---|---|---|---:|---|
| `sales` | `timestamp` | `id` | `false` | Respaldo, reconstrucción y restauración |
| `deleted_sales` | `timestamp` | `id` | `false` | Respaldo, reconstrucción y restauración |
| `menu` | `id` | `id` | `false` | Sin reconstrucción |
| `customers` | `id` | `id` | `false` | Sin reconstrucción |
| `cajas` | `id` | `id` | `false` | Sin reconstrucción |
| `movimientos_caja` | `id` | `id` | `false` | Sin reconstrucción |

El preflight también obtiene, sin leer registros, `nativeVersion`, `storeName`, `keyPath`, `autoIncrement` e `indexNames` para todos los stores presentes.

## 7. Historia de versiones

### Historia legacy nativa

El commit histórico `520cbbd8ef792c3c6a67632596d483274aaad796` eliminó un adaptador IndexedDB nativo anterior. El diff conserva evidencia de que ese adaptador creaba:

```text
sales          keyPath=timestamp
deleted_sales  keyPath=timestamp
```

En ese snapshot el adaptador declaraba versión nativa `10`. Dispositivos reales posteriores fueron observados en versión nativa `110` conservando las mismas primary keys.

### Historia Dexie

`src/services/db/dexie.js` registra la historia principal de Dexie v1-v23. Las declaraciones actuales esperan `id` para ambos stores.

El commit `c4dea2af7c901939006cf455a774ff3ca1343d61` consolidó el esquema cloud de `sales` en Dexie v24. Antes del hotfix, `syncDexieBootstrap.js` registraba v24 como efecto lateral de import y ejecutaba el registro al cargarse.

### Relación Dexie / IndexedDB nativo

Dexie escala su número lógico por diez al abrir IndexedDB:

| Dexie | IndexedDB nativo esperado |
|---:|---:|
| `11` | `110` |
| `23` | `230` |
| `24` | `240` |
| `30` | `300` |

Por ello, `DB_VERSION = 110` no era una versión Dexie válida para un worker ni una descripción de la versión lógica actual. Era una constante legacy de versión nativa. El hotfix la renombra conceptualmente como `LEGACY_DB_VERSION` y documenta que no debe usarse para abrir workers ni registrar upgrades.

### Versiones reservadas por el hotfix

- Dexie v24: POS Sync y sus índices cloud, ahora registrados por el módulo canónico.
- Dexie v30: esquema final del hotfix, stores de respaldo y metadata de recuperación.
- Durante reparación de una base nativa existente se usan dos versiones nativas consecutivas libres: `N+1` para respaldo y `N+2` para reconstrucción. En el caso observado de versión `110`, son `111` y `112`. Después, Dexie continúa su historia normal hasta la versión nativa `300`.

## 8. Causa de la divergencia

No se encontró evidencia de que una misma versión Dexie publicada hubiera sido redefinida intencionalmente con otro esquema. La divergencia provino de dos historias distintas sobre el mismo nombre `LanzoDB1`:

1. una historia IndexedDB nativa legacy, con primary keys `timestamp`;
2. una historia Dexie posterior, que esperaba primary keys `id`.

La constante nativa `110`, la equivalencia Dexie `11 -> 110` y el registro tardío de v24 hicieron que una base histórica pudiera entrar a una ruta de upgrade Dexie incompatible.

El orden de imports también era un riesgo adicional: v24 se registraba desde `syncDexieBootstrap.js`, no como parte obligatoria del runtime previo a `db.open()`.

## 9. Estrategia de respaldo

El preflight detecta únicamente la estructura. Si confirma la divergencia reparable:

1. abre una versión nativa superior;
2. crea:
   - `__lanzo_sales_backup_v30`;
   - `__lanzo_deleted_sales_backup_v30`;
   - `__lanzo_db_recovery`;
3. limpia únicamente los stores de respaldo incompletos de un intento previo;
4. recorre `sales` y `deleted_sales` mediante cursor;
5. copia cada registro completo junto con:
   - `legacyKey` técnico;
   - primary key de origen;
   - ID de destino calculado;
6. registra conteos y hashes FNV de claves/IDs, sin imprimir contenido de ventas, clientes o productos;
7. guarda el marcador `backup_complete`;
8. conserva intactos los stores de origen.

La operación completa ocurre dentro de un único `versionchange`. Si el navegador se cierra, IndexedDB aborta esa transacción y la base conserva el estado anterior.

## 10. Estrategia de reconstrucción

Solo después de existir un respaldo completo:

1. se abre otra versión nativa superior;
2. dentro del mismo `versionchange` se eliminan `sales` y `deleted_sales`;
3. se recrean con primary key `id` e índices actuales;
4. se restauran los registros desde los backups mediante `add`, no `put`;
5. se conservan IDs existentes válidos;
6. se generan IDs deterministas cuando no existen;
7. cualquier colisión aborta la transacción, sin sobrescribir registros;
8. se comparan conteos de origen y destino;
9. se marca `rebuild_complete`.

Los stores de respaldo no se eliminan en este PR.

## 11. Idempotencia

La migración cumple las siguientes propiedades:

- una base compatible no se migra;
- una base nueva no recorre la reparación legacy;
- `backup_complete` permite continuar directamente con reconstrucción;
- `rebuild_complete` impide repetir la migración;
- el respaldo se recrea desde cero únicamente mientras el origen sigue siendo la copia autoritativa;
- la restauración usa `add`, por lo que no sobrescribe IDs en colisión;
- los IDs generados dependen de la primary key histórica única;
- una segunda apertura no duplica registros.

IDs deterministas:

```text
sales          legacy-sale:<timestamp>
deleted_sales  legacy-deleted-sale:<timestamp>
```

Si `record.id` ya existe y es válido, se conserva.

## 12. Recuperación tras interrupción

### Cierre durante respaldo

El `versionchange` se aborta. El store original no se elimina y el siguiente intento repite el respaldo.

### Cierre después de respaldo

El marcador `backup_complete` y ambos backups permanecen. El siguiente intento continúa con reconstrucción.

### Cierre durante reconstrucción

El segundo `versionchange` se aborta atómicamente. La versión previa, los stores originales y los backups siguen disponibles. El siguiente intento repite la reconstrucción.

### Cierre después de reconstrucción

El marcador `rebuild_complete` impide una segunda migración.

## 13. Cambios en login administrador

`AdminLoginModal.jsx` ahora usa obligatoriamente:

```javascript
try {
  // login
} catch (error) {
  // mensaje recuperable
} finally {
  setLoading(false);
}
```

Se distinguen:

- credenciales inválidas;
- error de red;
- base bloqueada;
- primary key incompatible;
- timeout de apertura;
- base cerrada por error estructural.

La prueba focal confirma que `UpgradeError`, `DatabaseClosedError`, `DatabaseOpenTimeoutError`, credenciales inválidas y éxito liberan el estado `Verificando...`.

## 14. Cambios en ProductStore

Se instala una guarda antes de iniciar la aplicación POS. Mientras exista recuperación pendiente:

- `invalidateAndReset` se convierte en no-op;
- `isInvalidating` se libera;
- `isLoading` se libera;
- los eventos de foco, visibilidad, pageshow y BroadcastChannel no alcanzan el invalidator original;
- el comportamiento normal se reactiva al limpiar el estado de recuperación.

La prueba dispara cuatro invalidaciones equivalentes y verifica cero llamadas al invalidator original durante recuperación y una llamada normal después de recuperarse.

## 15. Cambios en POS Sync

`syncMetaService` consulta el estado estructural antes de abrir o escribir IndexedDB:

- no escribe metadata durante recuperación;
- no inicia una apertura indirecta;
- emite un único aviso agregado;
- devuelve fallbacks seguros de lectura;
- se reactiva después de recuperar la base.

El arranque POS Sync también se difiere desde `main.jsx` si el preflight no termina correctamente.

La lógica de identidad estable no fue reemplazada ni se limpió `localStorage`. Al impedir aperturas/escrituras durante recuperación se evita generar y persistir repetidamente IDs derivados del mismo fallo estructural.

## 16. Cambios en StorageManager

StorageManager quedó como servicio best-effort e idempotente:

- comparte una promesa de inicialización concurrente;
- solicita persistencia como máximo una vez por sesión de página;
- `persist() => true` marca `granted`;
- `persist() => false` marca `denied`, sin bloquear;
- una promesa rechazada marca modo volátil, sin bloquear;
- API ausente marca `unsupported`, sin bloquear;
- no confunde persistencia denegada con IndexedDB cerrada;
- no presenta mensajes Safari cuando no se detectó Safari.

## 17. Cambios en initializeApp

El coordinador mantiene estados conceptuales:

```text
idle
running
ready
failed
recovery_required
```

Las llamadas concurrentes comparten exactamente la misma promesa. La guarda se libera en `finally`. Un error Dexie estructural no deja `running`, conserva el diagnóstico y cambia a `local_database_recovery_required`. Un reintento explícito puede volver a ejecutar el preflight.

La búsqueda del repositorio encontró una llamada productiva desde `App.jsx`; React StrictMode puede montar/ejecutar efectos dos veces en desarrollo. La prueba reproduce dos llamadas concurrentes y confirma una sola preparación de base.

## 18. Riesgo para FREE / Lanzo Local

Riesgo principal: pérdida de la única copia local si se aplicara una estrategia destructiva. Este hotfix evita ese riesgo:

- no usa `indexedDB.deleteDatabase()` en producción;
- no elimina productos, ventas, clientes, caja ni movimientos;
- mantiene backups de los dos stores reconstruidos;
- no depende de Supabase para restaurar datos;
- valida conteos antes de completar.

La validación manual con una copia real de una base FREE con actividad sigue siendo obligatoria antes del merge.

## 19. Riesgo para PRO / Lanzo Nube

Riesgos principales:

- repetir autenticación y consumir cupos de dispositivo;
- iniciar Realtime/Pull antes de disponer de la base;
- cerrar una sesión remota válida por un fallo local.

Mitigaciones:

- la autenticación remota se separa del bootstrap local;
- el resultado remoto válido se conserva como sesión pendiente;
- el reintento reutiliza ese resultado sin una segunda llamada de login;
- no se ejecuta logout automático;
- POS Sync se difiere;
- la aplicación no se marca `ready` hasta que la base esté utilizable.

## 20. Pruebas automatizadas

Fixtures y suites agregadas:

1. Base nueva.
2. Legacy vacía.
3. Legacy con ventas/eliminadas con y sin `id`.
4. Segunda ejecución idempotente.
5. Registro de esquema en órdenes diferentes.
6. `UpgradeError` en modal.
7. `DatabaseClosedError` con `UpgradeError` interno.
8. `DatabaseOpenTimeoutError`.
9. Credenciales inválidas.
10. Login exitoso.
11. Sesión remota válida con fallo local posterior.
12. Reintento sin repetir autenticación remota.
13. Promesa singleton de `initializeApp`.
14. Tormenta de invalidaciones ProductStore.
15. Pausa y reactivación de POS Sync Meta.
16. StorageManager: true, false, rechazo y API ausente.

## 21. Resultados

GitHub Actions `HOTFIX Dexie Recovery Validation`, ejecución final de código `30062142741`:

| Job | Resultado |
|---|---|
| Dexie recovery + schema order | PASS |
| AdminLoginModal | PASS |
| Admin session + bootstrap | PASS |
| ProductStore + POS Meta | PASS |
| StorageManager | PASS |
| ESLint focal | PASS |
| `git diff --check` | PASS |
| Build de producción | PASS |

Conteos del fixture legacy con datos:

| Store | Registros antes | Registros después | Backup conservado |
|---|---:|---:|---:|
| `sales` | 2 | 2 | 2 |
| `deleted_sales` | 2 | 2 | 2 |

Fixture legacy vacío:

| Store | Registros antes | Registros después | Backup conservado |
|---|---:|---:|---:|
| `sales` | 0 | 0 | 0 |
| `deleted_sales` | 0 | 0 | 0 |

Los importes, timestamps, clientes, estados y campos opcionales del fixture se conservaron; los IDs existentes se mantuvieron y los ausentes se generaron determinísticamente.

## 22. Limitaciones

- No se ejecutó todavía la matriz manual en Chrome/Edge desktop, PWA instalada, incógnito y dos pestañas reales.
- No se migró una base real del usuario desde esta sesión; las garantías verificadas corresponden a fixtures `fake-indexeddb` y a transacciones estándar de IndexedDB.
- No se inspeccionó un checkout local del usuario. La rama se creó directamente desde el SHA remoto confirmado, por lo que no se tocaron su árbol de trabajo ni sus stashes; su estado local no puede certificarse desde el conector.
- `src/services/deviceFingerprint.js` no existe en el HEAD auditado. La identidad estable está implementada en servicios existentes de Supabase/utilidades; no se modificó `src/services/supabase.js`.
- No se ejecutó una suite global ajena al hotfix. Las pruebas focales, lint focal, diff y build son verdes.

## 23. Pasos manuales de recuperación

Para una base bloqueada:

1. cerrar todas las demás pestañas y ventanas de Lanzo;
2. cerrar la PWA instalada si está abierta;
3. volver a la pantalla de recuperación;
4. pulsar `Reintentar recuperación`;
5. permitir que la página recargue después de completar.

Para una base con esquema legacy:

1. no borrar datos del sitio;
2. no limpiar localStorage ni caché;
3. cerrar otras conexiones;
4. iniciar la recuperación explícita;
5. comprobar que el marcador final sea `rebuild_complete`;
6. comparar conteos reportados por el marcador;
7. validar ventas, caja y movimientos desde la interfaz.

Solo para un dispositivo confirmado vacío puede considerarse, como procedimiento técnico manual externo a este hotfix, borrar exclusivamente `LanzoDB1` después de una confirmación humana explícita. La aplicación no ofrece ni ejecuta ese borrado automáticamente.

## 24. Plan futuro para retirar backups

Los backups deben retirarse en una actualización separada, nunca en este despliegue. Condiciones previas sugeridas:

1. completar validación manual en FREE y PRO;
2. mantener el hotfix durante un periodo suficiente;
3. comprobar `rebuild_complete` y conteos iguales;
4. verificar que no existen reportes de colisión o pérdida;
5. publicar una versión Dexie nueva, no reutilizada;
6. retirar únicamente los stores `__lanzo_*_backup_v30` y su metadata;
7. agregar una prueba de upgrade desde v30;
8. documentar rollback y conservación previa.

## 25. Confirmaciones de alcance

- PR #126 permanece integrado; no se revirtió su cutover.
- No se modificó Supabase ni se crearon migraciones PostgreSQL.
- No se ejecutó `supabase db push`.
- No se ejecutó despliegue manual de Vercel.
- No se cambió el nombre `LanzoDB1`.
- No se borró IndexedDB automáticamente.
- No se limpiaron localStorage, Cache Storage ni credenciales.
- No se activó auto-merge.
- PR #127 permanece abierto, en draft y sin merge.
