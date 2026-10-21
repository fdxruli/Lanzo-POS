# LANZO POS — FASE 3.2A.3 — Resumen ejecutivo

**Estado: TRANSITION_CONTRACT_UNRESOLVED. Arquitectura base D.**

El diseño financiero está documentado para revisión. No se activó autoridad v2, no hubo PR, Preview, merge, SQL, migración ni cambios de producción. Main sigue en `f48aab53634663438a06dc5187fa7e6d17b74fb3`.

La decisión central es mantener la restricción ya aprobada: **v2 no permite nuevas escrituras protegidas si no puede demostrar exclusividad**. Se conservan ventas, caja, carrito, reservas, intents y outbox; no se borran datos ni se repiten cobros ambiguos. Esto protege el comportamiento de v2, pero no demuestra que un cliente antiguo haya perdido su capacidad de escribir.

La arquitectura D puede ordenar autoridad y efectos locales en la misma transacción IndexedDB entre participantes actualizados. Actor Runtime conserva identidad, permisos y sesión. Los mensajes sólo avisan. Cloud necesita un fence y receipts propios en servidor. Local válidamente admitido continúa offline con la política actual: Admin hasta su vencimiento efectivo, máximo 168h; Staff sin autorización offline.

Se revisaron **91 rutas** con las **19 columnas exigidas**, incluyendo mutaciones indirectas: abonos, apartados, reservas, proyecciones, outbox, autoheal, import y CRUD genérico. El comentario de venta sobre outbox no sustituye verificar el scope: la TX enumera INVENTORY_EVENTS; inventoryEntryService sí incluye OUTBOX expresamente. El abono cloud directo también necesita un intent/receipt integrado. No basta añadir un assert alrededor del repositorio de ventas.

**Pruebas nuevas:** 71 asserts R3 repetidos, 18 nuevos de admisión/recuperación y 50 focales existentes en main pasan. Los primeros dos grupos incluyen contraejemplos y modelos condicionales. Chromium: **20 PASS acotados, 7 FAIL conocidos y 2 PENDING**. Los FAIL confirman límites legacy; un runner con exit 0 no los convierte en seguros. No hay certificación financiera integral, SQL live ni Windows/Android/LAN físicos.

T1 gradual no elimina supervivientes antiguos. T2 protege sólo fronteras instrumentadas, especialmente cloud. T3 puede investigarse para un entorno gestionado, pero cerrar ventanas voluntariamente, reiniciar sin control de restauración o consultar clientes SW no son una prueba suficiente. No se eligió una transición universal ni una flag de activación.

## Decisiones necesarias antes de implementar

1. **Alcance verificable de admisión:** decidir si se investiga un entorno gestionado/acotado y qué mecanismo impedirá realmente el reingreso legacy. Sin esa prueba, v2 permanece restringido.
2. **Recuperación cuando A no vuelve:** decidir si se diseña un procedimiento excepcional owner/support con evidencia independiente, audit trail y origen inmutable. Actualmente ese caso debe conservarse para conciliación manual.
3. **Alcance cloud separado:** revisar contratos actuales mediante catálogo/export autorizado antes de diseñar un fence SQL. El historial de migraciones no certifica bodies ni RLS/ACL. No se ejecutó SQL en esta fase.
4. **Candidata integral:** exigir commits protegidos, recovery, respaldo íntegro/rollback compatible y QA antes de activar. El backup actual de tres tablas no es respaldo integral de caja/intents/outbox.

La restricción conservadora ya está aprobada; no hace falta aprobarla otra vez. La próxima fase debe resolver y probar el contrato de transición, con revisión del propietario, antes de iniciar implementación comercial.

#338 y #352 siguen OPEN/Draft y sin modificar. Sus cambios de split, mesa/Staff, settlement y SW necesitan integración semántica posterior. Sus ramas antiguas no deben reemplazar la expiración Admin que main incorporó después.

[Diseño completo](LANZO.ACTOR.AUTHORITY.V2.INTEGRATION.TRANSITION.DESIGN.R1.md) · [Matriz financiera](LANZO.ACTOR.AUTHORITY.V2.COMMIT.MATRIX.R1.md)

Rama recuperable: `research/actor-authority-financial-admission-r1`. Checkpoint inicial: `3b362d3ffa0919ae1bf61d92a13e7a09d931dc99`. El checkpoint final se entrega por SHA y se registra en la constancia, sin circularidad con este archivo.
