# Evidencia observada — 2026-11-06 UTC

Código del actualizador probado: `4d75fe118680165b76268ff6de3bbea49dc6e336`. El commit `e15b6dafb91e7827a738474499232f6c56eb1967` solo agrega la hoja global de estilos al fixture de navegador; la lógica del producto es idéntica. La evidencia de navegador se generó sobre ese segundo commit, con árbol limpio.

## Automatización local

| Verificación | Resultado observado |
| --- | --- |
| Vitest: actualizador, UI, registro/activación, offline, actor/checkout, persistencia de carritos, Caja, ledger financiero, timeouts y sincronización | **513/513**, 49 archivos; `focused-tests.txt` |
| Arquitectura PWA y recuperación, sobre builds completos de admin y tienda | **22/22**, 2 archivos; `architecture-tests.txt` |
| ESLint de los archivos de implementación modificados y fixture | Sin errores ni warnings |
| `git diff --check` | Sin errores |
| Build admin + auditoría de precache startup/Local + bot | Exitosos; grafo completo con valores públicos **sintéticos**, sin backend: 39 entradas, 5758.59 KiB; 27 recursos startup y cierre del bot comprobados |
| Build de tienda (`npm run build:store`) | Exitoso |
| Chromium 141 / Playwright 1.56.1 / dos builds reales y mismo servidor/origen | Cinco recorridos verificados; JSON y capturas adjuntos |

La primera compilación sin variables públicas eliminaba parte del código por el guard de configuración. **No se usa esa compilación como evidencia del grafo completo.** Se repitió con:

```sh
VITE_SUPABASE_URL=https://update-qa.invalid \
VITE_SUPABASE_PUBLISHABLE_KEY=synthetic-update-qa-public-key npm run build
npm run build:store
npx vitest run src/architecture/__tests__/adminPwaArchitecture.test.js src/architecture/__tests__/adminLazyRouteRecoveryArchitecture.test.js --maxWorkers=2
```

La nueva workflow aplica esos mismos valores sintéticos únicamente al build de validación; no provisiona ni llama a Supabase. El build informa warnings existentes de anotaciones zod, imports estáticos/dinámicos y globs opcionales no emitidos; las auditorías de cierre pasan.

## Recorridos en navegador: alcance exacto

A y B son dos builds **del candidato**, sobre el mismo commit, con distintas fechas/IDs. Se reemplazó el directorio servido sin cambiar el origen del navegador. El JSON contiene ambos identificadores y las peticiones reales. El worker es el de `src/pwa/sw.js`, compilado e inyectado por Vite PWA/Workbox. UI, coordinador, monitor y slice PWA son código de producción; el store comercial se sustituye exclusivamente en el runner por una slice aislada, y los registros IndexedDB son ficticios.

| Aceptación | Observación | Estado del objetivo completo |
| --- | --- | --- |
| A / E: navegador e identidad | A detectó B por red, mostró pendiente, aplicó B una vez, verificó current y recibo de completada. SHA exacto + fechas distintas; registro IDB conservado. La aplicación ya descargada se aplicó **offline**, y la comprobación final se hizo tras reconectar. | Integración verificada; recorrido dentro del POS con tenant real de prueba pendiente. |
| B: posponer, cerrar/reabrir | Más tarde conservó el pendiente y otra comprobación no reabrió el mismo aviso. Al cerrar el último cliente y reabrir, Chromium ejecutó B y retornó current. | Navegador verificado; **PWA instalada en Android no probada**. |
| C: operación activa | Un guard sintético bloqueó la recarga; se conservaron carrito/reserva/importe ficticios en IDB. Al liberar guard se pudo aplicar B. Complementado por tests de transacciones Dexie completas/abortadas y de RPC que sobrevive su timeout, más regresiones de actor/cobro y ledger. | Integración y regresión verificadas; cobro Local/Cloud comercial de prueba pendiente. |
| D: offline | Recarga sin red sirvió el shell **del fixture** desde Workbox, se leyó el registro local y Buscar retornó offline. El grafo completo de recursos de la aplicación se comprobó estáticamente en postbuild. | Fixture real offline verificado; trabajar en POS Local autenticado offline pendiente. |
| F: múltiples pestañas | Dos ventanas sobre A; la segunda mantuvo guard activo. Desde la primera se intentó activar B: el worker negó la activación y ninguna se recargó. Cerrar la segunda permitió actualizar la primera a B. | Integración verificada; PWA + Chrome real y pestaña suspendida pendientes. |

Capturas móviles del **fixture aislado**, no de una cuenta de negocio: [disponible](mobile-update.png), [actualizada](mobile-current.png), [offline](mobile-offline.png).

## Reproducir integración

Desde la raíz, con dependencias del repositorio instaladas y un navegador Playwright disponible:

```sh
npm install --prefix /tmp/lanzo-update-qa playwright@1.56.1
/tmp/lanzo-update-qa/node_modules/.bin/playwright install chromium
node scripts/qa/pwa-updates/browser.mjs
```

Por defecto genera builds, `evidence.json` y capturas en `/tmp/lanzo-update-browser`. `UPDATE_QA_PLAYWRIGHT` y `UPDATE_QA_OUTPUT` permiten elegir otras rutas. No se agregan paquetes al manifest/lockfile del producto. La workflow guarda los resultados del SHA del PR como artifact `updater-browser-evidence`.

## Pendiente y entorno remoto

El PR debe permanecer **Draft**. Los estados de CI y Preview del SHA publicado se consultan al entregar el PR; READY no prueba los recorridos de Android ni operaciones comerciales. El checklist Android/Chrome/migración legacy está en [README.md](README.md#qa-manual-antes-de-production).

No se hizo merge, despliegue manual de Production, SQL, modificación de Supabase, ni venta/cobro real. La aceptación completa en Production **no se declara cumplida**.


La primera ejecución remota de la workflow dedicada pasó regresiones, build completo y arquitectura; falló al instalar Playwright 1.56.1 porque `ubuntu-latest` ya corresponde a Ubuntu 26.04, no soportado por esa versión. Se fijó el runner en `ubuntu-24.04` y se incluyó también el build de tienda para ejecutar todos los contratos de arquitectura. No se alteró código del producto por este ajuste. El resultado del nuevo run se informa en el PR.


## Corrección de las dos regresiones del PR #399

HEAD de partida: `9f64f430512894e5e835683a484fdb7ff73734eb`. `main` verificado: `9d36e133aae04e00daf00b4c5725bc03832ea36f` (PR #395), posterior a la base original `e7a85fcb96d00f57d1414af8b8908785a7e50fbe`.

Los dos archivos reportados se ejecutaron sin mocks adicionales ni omisiones:

| Árbol probado | Resultado focal |
| --- | --- |
| Candidato inicial `9f64f430…` | 28/30; fallan reescritura Vercel e importación fría |
| Base original `e7a85fcb…` | 30/30 |
| `main` vigente `9d36e133…`, sin parche | 30/30 |
| Candidato corregido | 30/30 |

**Reescrituras:** el test conservaba literalmente el contrato anterior. Se actualizó su expectativa para incluir `build-info.json` junto con las exclusiones existentes. No se cambió `vercel.json` ni se revirtió esa exclusión. El fallback SPA, assets/worker/manifest y la independencia del target de tienda mantienen sus contratos.

**Importación fría:** el nuevo import paralelo de `posSyncOrchestrator` iniciaba otra raíz de evaluación que entra en este ciclo estático: coordinador → posRealtime → supabase → database → db/index → layawayFinancialService → cashRepository → cashSyncHandler → coordinador. El handler de Caja intentaba registrar sus entidades antes de inicializarse el export del coordinador (`TypeError: ... registerEntitySyncHandler`). Ahora se obtiene ese módulo después de terminar la evaluación del grafo existente App/bootstrap. No se omiten handlers, se capturan errores para ocultarlos ni se abre el acceso al negocio; el guard de sincronización permanece.

El test frío comprueba también `indexedDB.open` nativo, además de `Dexie.open`, y vuelve a exigir `TENANT_RUNTIME_NOT_READY` al acceder a `sales` después de cargar el POS. Ambos casos focales se incorporaron a la workflow dedicada existente. Al ejecutar estas regresiones juntas se observó una carrera del test de aborto de IndexedDB: `setTimeout(0)` podía adelantarse al evento nativo. Se sustituyó esa espera por el propio evento `abort`, sin modificar el guard del producto.

Validación relacionada, sin repetir una auditoría general:

- Rama corregida: **204/204** pruebas, 21 archivos (los casos focales están incluidos).
- Copia temporal de `main` vigente + parche completo del candidato aplicado sin conflictos: **204/204** en la misma selección; **37/37** focales de importación/IndexedDB e integración de pagos del `main` nuevo; **49/49** de arquitectura PWA, recuperación y despliegue prebuilt.
- Builds admin y tienda de esa combinación: correctos, con valores públicos sintéticos y sin backend. Postbuild verifica 27 recursos startup y el cierre del bot; 39 entradas / 5763.08 KiB de precache.
- ESLint focal y comparación de whitespace: correctos. La compatibilidad se comprobó en una copia separada; no se hizo merge, rebase ni cambio de historia de la rama.

Los resultados remotos del nuevo SHA se enlazan en el PR y en la entrega. No se ejecutó QA manual nuevo de Android, ventas, cobros o instalación PWA, ni se modificó Production.
