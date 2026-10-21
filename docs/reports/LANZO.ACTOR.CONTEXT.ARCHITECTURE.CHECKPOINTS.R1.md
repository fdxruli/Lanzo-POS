# Investigación 3.2A.2 — checkpoints

Main f48aab53634663438a06dc5187fa7e6d17b74fb3.
Recuperado D 1cdc1cd029982e0279177ab29be1f8fffacb6ed8 / árbol 38f3efbe011055580f572830330252341177011e.
A/B/C/D anteriores verificados y alcanzables. Rama original intacta.
Rama research/actor-context-invalidation-contract-r1 con auto despliegues desactivados tanto en raíz como store.
No se modifica src ni runtime comercial en esta investigación. Sólo prototipos aislados y documentación.
No PR de implementación, Preview, merge ni cambios Supabase.
R0: preparación recuperable; prototipos y validación pendientes.

## R1 — prototipo e hipótesis ejecutadas
R0 remoto 2e5eabfdf7a4d5cc0e1bc8ac52bc812a464de76b / árbol fdf61b35c8cb94d54e5952be0d937813bbba26b1.
Prototipo v2 aislado: IndexedDB, propietario esperado, registros por contexto, revocación dirigida y efectos sintéticos en el mismo dominio transaccional. No es implementación comercial ni autenticación real.
Primer conjunto: 22 Vitest PASS (incluye 3 contraejemplos con propiedad de seguridad FAIL). Se añadió un cuarto contraejemplo sobre writers que omiten el fence; resultados finales se guardarán en R2.
Chromium 143.0.7499.0: ARCH01..25 ejecutados excepto PWA instalada; matriz completa y evidencia se guardan en R2. FAIL de convivencia legacy y FAIL de usar sólo upgrade de esquema como fence. Dexie instalado 4.4.3 reabre y permite efecto sintético tras upgrade.
Sin cambios src, dependencias de producto, PR, Preview, merge o Supabase.

## R2 — evidencia reproducible
R1 remoto 911c8992913a5dfd09960ff89b3f212001ae924d / árbol 97636fd23906b8e5b373e96860622501be1d4f2a.
69 Vitest PASS: 46 tests existentes recuperados + 19 propiedades del prototipo + 4 contraejemplos detectados (sus propiedades de seguridad son FAIL). Baseline original EXP14 sigue FAIL en worktree A con única adición de test respecto de src main.
Chromium: 27 observaciones, 19 PASS acotados, 7 FAIL de arquitectura/legacy, 1 PENDING PWA instalada. Incluye CDP freeze/thaw, HTTP IP sintético, TLS local autocertificado y Dexie instalado 4.4.3. No QA física ni venta real.
Runner registra durable antes/después, handles, runtime de modelo o NOT_LOADED y writes de frontera sintéticos. Sin erros de harness en ejecución final. Primer arranque requirió fallback de enumeración NIC; no se ocultó como resultado de producto.
ESLint scripts PASS. Fuentes comerciales src y package/lock permanecen idénticos a D.
Estado de arquitectura: requiere decisión de transición; no garantía universal para writers v1 sin actualizar.

## R3 — cierre documental y código final de investigación
R2 remoto 2bd8f5cbee3bc50fc2a43deff1b28c794fa82072 / árbol 9441b8f8363358e827b1498a51b054eab3608c3f.
Resultados finales: 71 aserciones Vitest (46 existentes, 20 propiedades positivas de prototipo, 5 detecciones de contraejemplo). Chromium 29 observaciones: 21 PASS acotados, 7 FAIL, 1 PENDING. Sin errores finales de harness. No se suman reejecuciones.
Informes de arquitectura y evidencia completos; README de reproducción, estados, invariantes, ARCH01..25, carrerasR1..R8, finanzas, transición y roadmap.
Estado ARCHITECTURE_DECISION_REQUIRED. Arquitectura D recomendada sólo con condiciones; legacy no certificado. No implementación definitiva ni activación.
El SHA/árbol de R3 se verifican contra GitHub y Git local y se entregan en la constancia de cierre.
Sin cambios comerciales respecto a D ni PR/Preview/merge/SQL/migraciones/datos de producción.
