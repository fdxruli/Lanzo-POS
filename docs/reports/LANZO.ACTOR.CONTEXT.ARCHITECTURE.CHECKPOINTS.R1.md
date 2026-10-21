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
